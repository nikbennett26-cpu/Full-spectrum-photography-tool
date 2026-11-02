// node libraw-wasm-gpl3/test_pre_wb.mjs  -- build 256: white balance before demosaic.
// A synthetic infrared-like Bayer frame (red ten times green and blue) with sharp grey edges.
// Checks: every photosite keeps its own value after the balance is divided back out; nothing is
// NaN; the gains point the right way; and the false colour along the edges goes down.
import { balancedDemosaic } from './glue/pre-wb.mjs';

const W = 256, H = 256, filters = 0x94949494 >>> 0;   // RGGB
const FC = (r, c) => { const v = (filters >>> ((((r << 1) & 14) + (c & 1)) << 1)) & 3; return v === 3 ? 1 : v; };
const light = [1, 0.1, 0.12];   // the "illuminant" the sensor sees: strong red
const scene = (x, y) => {       // grey stripes and a disc: true colour is neutral everywhere
  const s = ((Math.floor(x / 9) + Math.floor(y / 13)) & 1) ? 0.8 : 0.15;
  const d = Math.hypot(x - 128, y - 128) < 50 ? 0.5 : 1;
  return s * d;
};
const mos = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mos[y * W + x] = scene(x, y) * light[FC(y, x)];
// first pass stand-in: planes holding the photosite values at their own colour
const mk = () => ({ R: new Float32Array(W * H), G: new Float32Array(W * H), B: new Float32Array(W * H) });
const planes = mk();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; planes['RGB'[FC(y, x)]][i] = mos[i]; }

let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
for (const qual of ['amaze', 'rcd']) {
  const p = mk(); p.R.set(planes.R); p.G.set(planes.G); p.B.set(planes.B);
  const p0 = mk(); p0.R.set(planes.R); p0.G.set(planes.G); p0.B.set(planes.B);
  const r0 = await balancedDemosaic(p0, W, H, filters, qual, { gains: [1, 1, 1] });   // what the demosaic gives unbalanced
  const r = await balancedDemosaic(p, W, H, filters, qual);
  ok(r.gains[0] < r.gains[2] && r.gains[0] < 0.5, qual + ': gains damp the strong red channel ' + JSON.stringify(r.gains.map(v => +v.toFixed(3))));
  let maxNative = 0, finite = true;
  for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
    const i = y * W + x, v = r['RGB'[FC(y, x)]][i];
    if (!Number.isFinite(r.R[i] + r.G[i] + r.B[i])) finite = false;
    maxNative = Math.max(maxNative, Math.abs(v - mos[i]));
  }
  ok(finite, qual + ': no NaN or infinity');
  ok(maxNative < 1e-5, qual + ': every photosite keeps its own value (max error ' + maxNative.toExponential(1) + ')');
  // false colour: after neutralising the known light, a grey scene should have R = G = B
  const falseColour = q => { let fc = 0, n = 0;
    for (let y = 8; y < H - 8; y++) for (let x = 8; x < W - 8; x++) {
      const i = y * W + x, R = q.R[i] / light[0], G = q.G[i] / light[1], B = q.B[i] / light[2], m = (R + G + B) / 3;
      if (m > 0.01) { fc += (Math.abs(R - m) + Math.abs(G - m) + Math.abs(B - m)) / m; n++; }
    }
    return fc / n; };
  const a = falseColour(r0), bb = falseColour(r);
  ok(bb < a * 0.8, qual + ': false colour on the edges drops (' + a.toFixed(4) + ' unbalanced, ' + bb.toFixed(4) + ' balanced first)');
}
process.exit(fails ? 1 : 0);
