// SPDX-License-Identifier: GPL-3.0-or-later
//
// White balance BEFORE demosaic (build 256), for Bayer sensors.
//
// AMaZE and RCD both assume the three colours on the mosaic are roughly balanced: they compare a
// photosite with its differently coloured neighbours to decide which way an edge runs. On an
// infrared or UV frame one channel can be ten times the others, so those comparisons go wrong and
// leave coloured fringes and zipper patterns on edges, which a channel swap then makes louder.
// RawTherapee and darktable white-balance the mosaic before demosaicing for exactly this reason.
//
// The LibRaw module's demosaic takes no gains, so this works around it:
//   1. A first pass (RCD, the faster of the two) is run only to recover the mosaic: AMaZE and RCD
//      both hand back every photosite's own value unchanged (checked to 6e-8 on a Nikon D610 NEF).
//   2. The light's colour is estimated on the mosaic itself, from 2x2 superpixels, with the same
//      Cheng, Prasad & Brown (2014) PCA method as the app's RAW Auto white balance.
//   3. Each photosite is scaled by its colour's gain (the largest gain is 1, so nothing new clips),
//      and the chosen demosaic runs again on the balanced mosaic in dist/demosaic-only.wasm, the
//      same AMaZE and RCD source built on its own. AMaZE gets the lowest channel's scaled white as
//      its clip point, as RawTherapee passes it.
//   4. The gains are divided back out, so everything after this -- the app's white balance, As
//      shot, Auto, every edit -- sees the same numbers as before, only demosaiced better.

let modP = null;
async function loadModule() {
  if (modP) return modP;
  modP = (async () => {
    const url = new URL('../dist/demosaic-only.wasm', import.meta.url);
    let bytes;
    if (typeof process !== 'undefined' && process.versions && process.versions.node && url.protocol === 'file:') {
      const fs = await import('fs');
      bytes = fs.readFileSync(url);
    } else {
      bytes = await (await fetch(url)).arrayBuffer();
    }
    // The module was built for WASI but never prints or opens anything; these only satisfy its imports.
    const nosys = () => 52;
    const { instance } = await WebAssembly.instantiate(bytes, {
      wasi_snapshot_preview1: { fd_close: nosys, fd_seek: nosys, fd_write: nosys },
    });
    if (instance.exports._initialize) instance.exports._initialize();
    return instance.exports;
  })();
  try { return await modP; } catch (e) { modP = null; throw e; }
}

// Colour of each photosite: 0 red, 1 green, 2 blue (LibRaw's second green, 3, folded into green).
function fcOf(filters) {
  return (row, col) => { const c = (filters >>> ((((row << 1) & 14) + (col & 1)) << 1)) & 3; return c === 3 ? 1 : c; };
}

/* Cheng, Prasad & Brown (2014), the same estimate as chengPCAGains in src/wb-lut.js (copied: this
   runs in the decode worker, which does not load the app's scripts). Gains with green = 1. */
export function chengPCAGains(R, G, B, pct = 0.035) {
  const n = R.length;
  const stride = Math.max(1, Math.floor(n / 200000));
  const idx = [];
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i += stride) {
    const r = R[i], g = G[i], b = B[i];
    const mx = Math.max(r, g, b);
    if (mx <= 1e-4 || mx >= 0.98) continue;
    idx.push(i); mr += r; mg += g; mb += b;
  }
  const m = idx.length;
  if (m < 16) return [1, 1, 1];
  const em = Math.hypot(mr, mg, mb) || 1;
  const ex = mr / em, ey = mg / em, ez = mb / em;
  const proj = new Float64Array(m);
  for (let k = 0; k < m; k++) { const i = idx[k]; proj[k] = R[i] * ex + G[i] * ey + B[i] * ez; }
  const order = Array.from(proj.keys()).sort((a, b) => proj[a] - proj[b]);
  const take = Math.max(1, Math.floor(m * pct));
  const sel = order.slice(0, take).concat(order.slice(m - take));
  let s00 = 0, s01 = 0, s02 = 0, s11 = 0, s12 = 0, s22 = 0;
  for (const k of sel) {
    const i = idx[k], r = R[i], g = G[i], b = B[i];
    s00 += r * r; s01 += r * g; s02 += r * b; s11 += g * g; s12 += g * b; s22 += b * b;
  }
  let vx = ex, vy = ey, vz = ez;
  for (let it = 0; it < 64; it++) {
    const nx = s00 * vx + s01 * vy + s02 * vz, ny = s01 * vx + s11 * vy + s12 * vz, nz = s02 * vx + s12 * vy + s22 * vz;
    const nn = Math.hypot(nx, ny, nz) || 1;
    vx = nx / nn; vy = ny / nn; vz = nz / nn;
  }
  if (vx + vy + vz < 0) { vx = -vx; vy = -vy; vz = -vz; }
  const ir = Math.max(vx, 1e-6), ig = Math.max(vy, 1e-6), ib = Math.max(vz, 1e-6);
  return [ig / ir, 1, ig / ib];
}

/* planes: the first pass's {R, G, B} (any Bayer demosaic that keeps photosite values). Returns new
   {R, G, B, gains} demosaiced with `qual` on the balanced mosaic, gains divided back out. */
export async function balancedDemosaic(planes, w, h, filters, qual, opts = {}) {   // opts.gains: fixed gains (tests)
  const X = await loadModule();
  const n = w * h, FC = fcOf(filters >>> 0);

  // 1. the mosaic, straight into the module's memory
  const pIn = X.dm_malloc(n * 4);
  if (!pIn) throw new Error('pre-demosaic balance: out of memory');
  let mos = new Float32Array(X.memory.buffer, pIn, n);
  for (let y = 0; y < h; y++) {
    const c0 = FC(y, 0), c1 = FC(y, 1), base = y * w;
    for (let x = 0; x < w; x++) {
      const i = base + x, c = (x & 1) ? c1 : c0;
      const v = c === 0 ? planes.R[i] : c === 2 ? planes.B[i] : planes.G[i];
      mos[i] = v > 0 ? (v < 1 ? v : 1) : 0;
    }
  }
  planes.R = planes.G = planes.B = null;   // let the first pass go

  // 2. the light's colour, from 2x2 superpixels of the mosaic
  const sw = w >> 1, sh = h >> 1, sr = new Float32Array(sw * sh), sg = new Float32Array(sw * sh), sb = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let r = 0, g = 0, b = 0, ng = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const yy = 2 * y + dy, xx = 2 * x + dx, c = FC(yy, xx), v = mos[yy * w + xx];
      if (c === 0) r = v; else if (c === 2) b = v; else { g += v; ng++; }
    }
    const o = y * sw + x; sr[o] = r; sg[o] = ng ? g / ng : 0; sb[o] = b;
  }
  let gains = opts.gains ? opts.gains.slice() : chengPCAGains(sr, sg, sb);
  if (!gains.every(v => isFinite(v) && v > 0)) gains = [1, 1, 1];
  // nothing is allowed past a 64x spread: a near-empty channel must not be multiplied into noise
  const gmax = Math.max(...gains), g = gains.map(v => Math.max(v / gmax, 1 / 64));

  // 3. balance and demosaic again
  for (let y = 0; y < h; y++) {
    const k0 = g[FC(y, 0)], k1 = g[FC(y, 1)], base = y * w;
    for (let x = 0; x < w; x++) mos[base + x] *= (x & 1) ? k1 : k0;
  }
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  const ir = 1 / g[0], ig = 1 / g[1], ib = 1 / g[2];
  const cl = v => v > 0 ? (v < 1 ? v : 1) : 0;
  if (qual === 'rcd' || qual === 5) {
    const pR = X.dm_malloc(n * 4), pG = X.dm_malloc(n * 4), pB = X.dm_malloc(n * 4);
    if (!pR || !pG || !pB) throw new Error('pre-demosaic balance: out of memory');
    if (!X.dm_rcd(pIn, pR, pG, pB, w, h, filters >>> 0)) throw new Error('pre-demosaic balance: RCD failed');
    const oR = new Float32Array(X.memory.buffer, pR, n), oG = new Float32Array(X.memory.buffer, pG, n), oB = new Float32Array(X.memory.buffer, pB, n);
    for (let i = 0; i < n; i++) { R[i] = cl(oR[i] * ir); G[i] = cl(oG[i] * ig); B[i] = cl(oB[i] * ib); }
    X.dm_free(pR); X.dm_free(pG); X.dm_free(pB);
  } else {
    const pOut = X.dm_malloc(n * 16);
    if (!pOut) throw new Error('pre-demosaic balance: out of memory');
    if (!X.dm_amaze(pIn, pOut, w, h, filters >>> 0, Math.min(g[0], g[1], g[2]))) throw new Error('pre-demosaic balance: AMaZE failed');
    const o = new Float32Array(X.memory.buffer, pOut, n * 4);
    for (let i = 0, j = 0; i < n; i++, j += 4) { R[i] = cl(o[j] * ir); G[i] = cl(o[j + 1] * ig); B[i] = cl(o[j + 2] * ib); }
    X.dm_free(pOut);
  }
  X.dm_free(pIn);
  mos = null;
  return { R, G, B, gains };
}
