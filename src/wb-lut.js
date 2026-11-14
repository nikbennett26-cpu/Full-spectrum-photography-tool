'use strict';
/* irlab editor: js/wb-lut.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

// ---------- white balance picking ----------
// core sampling logic, shared by first-tap placement and by dragging.
// baseWBM (post mode only) is a fixed reference snapshotted at drag-start, so
// every point along a drag is evaluated fresh from that base rather than
// compounding onto whatever the previous drag frame happened to produce.
function sampleAvgFrom(pixels, w, h, cx, cy, rad) {
  let r = 0, g = 0, b = 0, n = 0;
  const x0 = Math.max(0, cx - rad), x1 = Math.min(w - 1, cx + rad);
  const y0 = Math.max(0, cy - rad), y1 = Math.min(h - 1, cy + rad);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = (y * w + x) * 4;
      r += pixels[p]; g += pixels[p+1]; b += pixels[p+2]; n++;
    }
  }
  return n ? [r/n, g/n, b/n] : [128,128,128];
}
/* Read back ONLY the patch under the picker. The post-swap picker used to
   call engine.readPixels(), which pulls the entire framebuffer — a full GPU
   pipeline stall plus two multi-megabyte allocations — and it did that on
   every rAF of a drag. A ~40px patch is all the sample ever needed.
   Note the Y flip: GL's origin is bottom-left, the picker's is top-left. */
function readbackPatch(x, y, rad) {
  const gl = engine.gl, w = engine.canvas.width, h = engine.canvas.height;
  const x0 = Math.max(0, x - rad), x1 = Math.min(w - 1, x + rad);
  const y0 = Math.max(0, y - rad), y1 = Math.min(h - 1, y + rad);
  const pw = x1 - x0 + 1, ph = y1 - y0 + 1;
  if (pw <= 0 || ph <= 0) return [128, 128, 128];
  const buf = new Uint8Array(pw * ph * 4);
  gl.readPixels(x0, h - 1 - y1, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  // the whole buffer IS the patch, so average all of it
  return sampleAvgFrom(buf, pw, ph, (pw / 2) | 0, (ph / 2) | 0, Math.max(pw, ph));
}
function sampleAt(mode, clientX, clientY, baseWBM) {
  const cv = $('preview'), rect = cv.getBoundingClientRect();
  const cx = Math.max(rect.left, Math.min(rect.right, clientX));
  const cy = Math.max(rect.top, Math.min(rect.bottom, clientY));
  const x = Math.round((cx - rect.left) / rect.width * cv.width);
  const y = Math.round((cy - rect.top) / rect.height * cv.height);
  // larger sample patch so an imprecise fingertip tap/drag still averages
  // the intended neutral surface rather than a single stray pixel
  const rad = Math.max(6, Math.round(cv.width * 0.02));
  if (mode === 'pre') {
    if (!loadedImage || !rawPixels) return false;
    // pre-swap WB samples the ORIGINAL unprocessed image, from the buffer
    // cached at load time rather than re-reading the whole canvas per frame
    let [r,g,b] = sampleAvgFrom(rawPixels, rawCanvas.width, rawCanvas.height, x, y, rad);
    /* Run the sample through the film LUT first when it is on. Pre-WB sits
       AFTER that stage in the shader, so the colour actually arriving at the
       white balance is the LUT'd one — sampling the untouched source meant
       the picker solved for a colour that no longer exists in the pipeline,
       and produced byte-identical gains whether the film was on or off. */
    if (filmOn) {
      const fl = decodeFilmLUT();
      if (fl) {
        const o = sampleLUT(fl, r/255, g/255, b/255);
        r = o[0]*255; g = o[1]*255; b = o[2]*255;
      }
    }
    preWBM = bradfordAdaptMatrix(r, g, b);
    // was a fixed string that never checked for clamping at all, so a
    // limited correction reported success with no sign anything happened
    $('wbPreStatus').textContent = bradfordAdaptMatrix.clamped
      ? 'Set ✓ (Bradford) — limited: that point has almost no blue to work with, so a full correction would have blown the frame. Try a lighter grey.'
      : 'Set ✓ (Bradford) — drag the dot to fine-tune';
  } else {
    // post-swap WB must sample the ACTUAL RENDERED result — the whole point
    // is correcting a cast that only exists after the channel swap — so this
    // reads back real WebGL output via readPixels(), not the source image
    suppressTempTint = true;
    const baseM = baseWBM || postWBM;
    postWBM = baseM; renderNow();
    const [r,g,b] = readbackPatch(x, y, rad);
    suppressTempTint = false;
    // compose the new adaptation ON TOP of whatever was already there,
    // same idea as the gain path multiplying onto its base
    postWBM = bfMat3mul(bradfordAdaptMatrix(r, g, b), baseM);
    resetAutoGainSliders();   // this picker sets a full matrix, not a pure
                              // diagonal gain — see the sliders' own note
    $('wbPostStatus').textContent = bradfordAdaptMatrix.clamped
      ? 'Set ✓ (Bradford) — limited: that point has almost no blue to work with, so a full correction would have blown the frame. Try a lighter grey.'
      : 'Set ✓ (Bradford) — drag the dot to fine-tune';
  }
  positionMarker(mode, cx-rect.left, cy-rect.top, rect.width, rect.height);
  /* Synchronous render, not the coalesced render(): this runs once per
     drag frame (already rAF-gated by scheduleDragSample's own loop), so
     deferring to a SECOND animation frame here just adds a frame of lag
     between finger and marker on every single drag step -- the flicker
     and "floaty" feel this replaces. sampleAt is also called from a plain
     click/tap (doPick), where the same immediacy is correct. */
  renderNow();
  return true;
}
/* Gains must be computed in LINEAR light, because that is where they are
   applied — rgb *= u_preWB happens after srgbToLinear. Taking ratios of the
   8-bit encoded values instead and applying those to linear data does not
   neutralise anything: picking a grey on a warm frame left it at 151,104,82,
   still visibly orange, where the correct gains land it on exactly
   130,130,130. The two spaces are related by a 2.4 power curve, so ratios
   from one are simply not valid in the other. */
/* Grey-world balance for a freshly decoded sensor image. See the call site
   for why this is necessary rather than merely nice. */
function autoWhiteBalanceRaw(cv) {
  rawEngine.autoWb = true;   // this RAW is balanced by the grey-world pass, so Reset all has to restore it (see restoreImplicitRawWB)
  try {
    const N = 220;
    const t = document.createElement('canvas');
    t.width = N; t.height = N;
    t.getContext('2d').drawImage(cv, 0, 0, N, N);
    const d = t.getContext('2d').getImageData(0, 0, N, N).data;
    const lum = [];
    for (let i = 0; i < d.length; i += 4) lum.push(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
    lum.sort((a, b) => a - b);
    const lo = lum[Math.floor(lum.length * 0.125)], hi = lum[Math.floor(lum.length * 0.875)];
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      if (L < lo || L > hi) continue;
      r += d[i]; g += d[i+1]; b += d[i+2]; n++;
    }
    if (n < 100) return;
    const gains = gainsFor(r/n, g/n, b/n);
    /* Written to preWBM as a diagonal matrix, not to the preWB gain array.
       This used to assign preWB directly, which only ever rendered under
       the old Simple WB method. Now that Bradford is the only method, the
       shader always reads preWBM — a gain landing in preWB would leave the
       raw decode unbalanced exactly as described above, silently, since
       nothing checks it against the image. Runs at load time before any
       manual pick, so this is a straight assignment rather than composed
       onto a base, same as a fresh manual pick starts from identity. */
    preWBM = [gains[0],0,0, 0,gains[1],0, 0,0,gains[2]];
    if ($('wbPreStatus')) $('wbPreStatus').textContent =
      `Auto \u2714 (grey-world) \u2014 pick a neutral to set it yourself`;
  } catch (e) { /* leave it unbalanced rather than fail the load */ }
}

/* Gains to make one pixel neutral, with a ceiling on how far they may go.

   Without the ceiling this is unusable on a raw sensor decode. Behind an IR
   filter the blue channel receives almost nothing \u2014 measured on a real
   decode, sky reads (124, 122, 14) \u2014 so asking to neutralise it demands a
   blue gain of 31x, which multiplies that channel's noise by the same amount
   and floods the frame blue-white. The picked pixel does go neutral; every
   other pixel is destroyed doing it.

   MAX_SPREAD caps the ratio between the largest and smallest gain rather
   than any single gain, because it is the imbalance that does the damage.
   8x is well past anything an ordinary photograph needs while still allowing
   the genuinely large corrections an IR conversion does. Beyond that the
   gains are compressed toward their geometric mean, which keeps the
   direction of the correction and limits its violence \u2014 the result is not
   a perfect neutral, but it is a picture. */
const WB_MAX_SPREAD = 8;

function gainsFor(r,g,b){
  const lr=srgbToLinearF(r/255), lg=srgbToLinearF(g/255), lb=srgbToLinearF(b/255);
  const grey=(lr+lg+lb)/3;
  const s=v=>v<1e-5?1:grey/v;
  let out=[s(lr),s(lg),s(lb)];
  const lo=Math.min(...out), hi=Math.max(...out);
  if (lo>0 && hi/lo > WB_MAX_SPREAD) {
    // compress about the geometric mean so the correction keeps its direction
    const mid=Math.pow(out[0]*out[1]*out[2], 1/3);
    const k=Math.log(WB_MAX_SPREAD)/Math.log(hi/lo);
    out=out.map(v=>mid*Math.pow(v/mid,k));
    gainsFor.clamped=true;
  } else {
    gainsFor.clamped=false;
  }
  return out;
}

/* ---------- Bradford chromatic adaptation ----------
   The default WB is per-channel gains on linear RGB — scale R, G and B
   independently until the picked pixel reads grey. That is the simplest
   member of the von Kries family, not a true cone-space adaptation, and
   for a shift as large as IR conversions need it can drift hue in a way a
   proper adaptation would not.

   Bradford does the same job — "make this pixel neutral" — in LMS (cone
   response) space instead of RGB directly: RGB to XYZ, XYZ to LMS via the
   Bradford matrix, scale each LMS channel toward D65 white, then invert
   back through the same two matrices. Every step is linear, so the whole
   chain collapses into one 3x3 built once per pick, applied per pixel at
   the same cost as the gains it replaces.

   Offered as a second METHOD rather than a replacement — it was fit
   empirically over roughly 2000-25000K, and a picked IR neutral is often
   equivalent to something far outside that range. The matrix still
   computes out there, but it is extrapolating past where it was validated,
   so whether it actually looks better on IR material is a real question,
   not a given — hence sitting alongside the existing method for a
   side-by-side rather than replacing it. */
const BRADFORD_M  = [ 0.8951,0.2664,-0.1614,  -0.7502,1.7135,0.0367,  0.0389,-0.0685,1.0296 ];
const SRGB2XYZ_M   = [ 0.4124564,0.3575761,0.1804375,  0.2126729,0.7151522,0.0721750,  0.0193339,0.1191920,0.9503041 ];
const D65_XYZ = [0.95047, 1.0, 1.08883];

function bfMat3vec(A, v) {
  return [
    A[0]*v[0]+A[1]*v[1]+A[2]*v[2],
    A[3]*v[0]+A[4]*v[1]+A[5]*v[2],
    A[6]*v[0]+A[7]*v[1]+A[8]*v[2],
  ];
}
function bfMat3mul(A, B) {   // A * B, both row-major 9-arrays
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i*3+j] = A[i*3]*B[j] + A[i*3+1]*B[3+j] + A[i*3+2]*B[6+j];
  return r;
}
function bfMat3inv(A) {
  const [a,b,c,d,e,f,g,h,i] = A;
  const det = a*(e*i-f*h) - b*(d*i-f*g) + c*(d*h-e*g);
  const id = 1 / (Math.abs(det) > 1e-12 ? det : 1e-12);
  return [
    (e*i-f*h)*id, (c*h-b*i)*id, (b*f-c*e)*id,
    (f*g-d*i)*id, (a*i-c*g)*id, (c*d-a*f)*id,
    (d*h-e*g)*id, (b*g-a*h)*id, (a*e-b*d)*id,
  ];
}
const XYZ2SRGB_M = bfMat3inv(SRGB2XYZ_M);
const BRADFORD_MI = bfMat3inv(BRADFORD_M);

/* ---------- Camera-matrix develop (ported from webraw-extravisual/color.js) ----------
   Real per-camera colorimetry for the AMaZE path specifically, since that's
   the one that actually carries LibRaw's measured rgb_cam matrix and
   camMul white-balance multipliers \u2014 the native from-scratch decoder has
   neither, so it stays on the existing grey-world auto-WB guess.

   Reuses this file's own bfMat3vec/bfMat3mul/bfMat3inv (row-major, same
   convention color.js uses) rather than re-deriving them. The only new
   pieces are the ProPhoto primaries themselves and the two compositions
   that turn "camera RGB" into "linear sRGB, properly white-balanced and
   chromatically adapted" \u2014 real measured colour instead of a guess. */
function pp_xyToXyz(wx, wy) { return [wx / wy, 1, (1 - wx - wy) / wy]; }

function pp_rgbToXyzMatrix(p, w) {
  const Xr = p.rx / p.ry, Yr = 1, Zr = (1 - p.rx - p.ry) / p.ry;
  const Xg = p.gx / p.gy, Yg = 1, Zg = (1 - p.gx - p.gy) / p.gy;
  const Xb = p.bx / p.by, Yb = 1, Zb = (1 - p.bx - p.by) / p.by;
  const M = [Xr, Xg, Xb, Yr, Yg, Yb, Zr, Zg, Zb];
  const S = bfMat3vec(bfMat3inv(M), pp_xyToXyz(w.wx, w.wy));
  return [
    Xr * S[0], Xg * S[1], Xb * S[2],
    Yr * S[0], Yg * S[1], Yb * S[2],
    Zr * S[0], Zg * S[1], Zb * S[2],
  ];
}

const PROPHOTO_PRIMARIES = { rx: 0.7347, ry: 0.2653, gx: 0.1596, gy: 0.8404, bx: 0.0366, by: 0.0001 };
const PP_D50 = { wx: 0.34567, wy: 0.3585 };
const PP_D65 = { wx: 0.3127, wy: 0.329 };
const PROPHOTO_RGB_TO_XYZ_D50 = pp_rgbToXyzMatrix(PROPHOTO_PRIMARIES, PP_D50);

// Bradford D65->D50, a fixed one-time adaptation \u2014 distinct from this tool's
// per-pixel Bradford WB picker, which adapts toward whatever a tapped point
// says is neutral. This one just moves between two fixed standard white
// points, using the BRADFORD_M/BRADFORD_MI just defined above.
function pp_bradfordFixed(srcWhite, dstWhite) {
  const cs = bfMat3vec(BRADFORD_M, pp_xyToXyz(srcWhite.wx, srcWhite.wy));
  const cd = bfMat3vec(BRADFORD_M, pp_xyToXyz(dstWhite.wx, dstWhite.wy));
  const D = [cd[0]/cs[0],0,0, 0,cd[1]/cs[1],0, 0,0,cd[2]/cs[2]];
  return bfMat3mul(BRADFORD_MI, bfMat3mul(D, BRADFORD_M));
}
const PP_BRADFORD_D65_TO_D50 = pp_bradfordFixed(PP_D65, PP_D50);

// Linear sRGB (D65) -> linear ProPhoto (D50). SRGB2XYZ_M already exists in
// this file for the sRGB side; only the ProPhoto side and the D65->D50
// bridge are new.
const SRGB_LIN_TO_PROPHOTO_LIN = bfMat3mul(bfMat3inv(PROPHOTO_RGB_TO_XYZ_D50), bfMat3mul(PP_BRADFORD_D65_TO_D50, SRGB2XYZ_M));
const PROPHOTO_LIN_TO_SRGB_LIN = bfMat3inv(SRGB_LIN_TO_PROPHOTO_LIN);

/* LibRaw's rgb_cam maps white-balanced camera RGB -> linear sRGB (D65).
   Composed here directly to linear sRGB rather than stopping at ProPhoto,
   since that's the space this tool's own pipeline still works in \u2014 the
   colorimetric benefit (real measured primaries + correct D65<->D50
   adaptation, rather than an assumed/guessed one) is in how camToOutput is
   built, not in which RGB space the number happens to be labelled. */
function pp_camToSrgbLin(rgbCam3x3Matrix) {
  const camToProPhoto = bfMat3mul(SRGB_LIN_TO_PROPHOTO_LIN, rgbCam3x3Matrix);
  return bfMat3mul(PROPHOTO_LIN_TO_SRGB_LIN, camToProPhoto);
}

/** Extract the 3x3 (row-major) from LibRaw's rgb_cam 3x4 (row-major, 12 floats). */
function pp_rgbCam3x3(rgbCam12) {
  if (!rgbCam12 || rgbCam12.length < 12) return [1,0,0, 0,1,0, 0,0,1];
  const m = rgbCam12;
  const out = [m[0],m[1],m[2], m[4],m[5],m[6], m[8],m[9],m[10]];
  if (out.reduce((a,b) => a + Math.abs(b), 0) < 1e-6) return [1,0,0, 0,1,0, 0,0,1];
  return out;
}

/** Per-channel camera white-balance gains (green normalised to 1). */
function pp_wbGain(camMul) {
  if (!camMul || camMul.length < 3) return [1, 1, 1];
  const g = camMul[1] > 0 ? camMul[1] : 1;
  return [camMul[0] / g, 1, camMul[2] / g];
}

/* ---------- eigenvector white balance (ported from webraw-extravisual/color.js) ----------
   Cheng, Prasad & Brown (2014), "Illuminant Estimation for Color Constancy: Why
   spatial-domain methods work and the role of the color distribution" \u2014 the
   illuminant lies along the principal axis of the colours that sit at the
   extremes of the distribution (its brightest and darkest points projected
   onto the mean direction), found via power iteration rather than a full
   eigendecomposition since only the dominant eigenvector is needed.

   Copied verbatim, not re-derived \u2014 this is already the exact working
   implementation, source-identical to the one used elsewhere. Made the new
   default (see rawEngineResultToCanvas below): unlike camMul (which just
   repeats whatever the camera's own meter decided) or grey-world (which
   assumes the average of the whole frame is neutral, wrong for anything
   dominated by one colour \u2014 exactly the case for IR/UV, where foliage or
   sky can fill most of the frame), this estimates from the SHAPE of the
   colour distribution instead of a single average, which is the whole
   argument in the paper's own title. */
function chengPCAGains(R, G, B, pct = 0.035) {
  const n = R.length;
  const stride = Math.max(1, Math.floor(n / 200000)); // ~200k samples is plenty
  const idx = [];
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i += stride) {
    const r = R[i], g = G[i], b = B[i];
    const mx = Math.max(r, g, b);
    if (mx <= 1e-4 || mx >= 0.98) continue; // skip black & near-saturated
    idx.push(i); mr += r; mg += g; mb += b;
  }
  const m = idx.length;
  if (m < 16) return [1, 1, 1];
  const em = Math.hypot(mr, mg, mb) || 1;
  const ex = mr / em, ey = mg / em, ez = mb / em; // unit mean direction
  const proj = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const i = idx[k];
    proj[k] = R[i] * ex + G[i] * ey + B[i] * ez;
  }
  const order = Array.from(proj.keys()).sort((a, b) => proj[a] - proj[b]);
  const take = Math.max(1, Math.floor(m * pct));
  const sel = order.slice(0, take).concat(order.slice(m - take)); // darkest + brightest
  let s00 = 0, s01 = 0, s02 = 0, s11 = 0, s12 = 0, s22 = 0;
  for (const k of sel) {
    const i = idx[k], r = R[i], g = G[i], b = B[i];
    s00 += r * r; s01 += r * g; s02 += r * b;
    s11 += g * g; s12 += g * b; s22 += b * b;
  }
  // Dominant eigenvector of the 3x3 scatter = illuminant direction (power iteration).
  let vx = ex, vy = ey, vz = ez;
  for (let it = 0; it < 64; it++) {
    const nx = s00 * vx + s01 * vy + s02 * vz;
    const ny = s01 * vx + s11 * vy + s12 * vz;
    const nz = s02 * vx + s12 * vy + s22 * vz;
    const nn = Math.hypot(nx, ny, nz) || 1;
    vx = nx / nn; vy = ny / nn; vz = nz / nn;
  }
  if (vx + vy + vz < 0) { vx = -vx; vy = -vy; vz = -vz; }
  const ir = Math.max(vx, 1e-6), ig = Math.max(vy, 1e-6), ib = Math.max(vz, 1e-6);
  return [ig / ir, 1, ig / ib]; // gains neutralise the illuminant, green = 1
}

/* Row-major, as written above, transposed to column-major only at the point
   of upload — see the WebGL1 note beside uniformMatrix3fv. */
function toGLMat3(m) {
  return new Float32Array([m[0],m[3],m[6], m[1],m[4],m[7], m[2],m[5],m[8]]);
}

function bradfordAdaptMatrix(r, g, b) {
  const lin = [srgbToLinearF(r/255), srgbToLinearF(g/255), srgbToLinearF(b/255)];
  const srcXYZ = bfMat3vec(SRGB2XYZ_M, lin);
  const Ysrc = Math.max(srcXYZ[1], 1e-6);
  // destination: D65 chromaticity at the SAME luminance as the source pixel
  // — matching gainsFor's convention of correcting colour without also
  // jumping the whole frame's exposure to a fixed target brightness
  const dstXYZ = [D65_XYZ[0]*Ysrc, D65_XYZ[1]*Ysrc, D65_XYZ[2]*Ysrc];
  const srcLMS = bfMat3vec(BRADFORD_M, srcXYZ);
  const dstLMS = bfMat3vec(BRADFORD_M, dstXYZ);
  let d = [dstLMS[0]/Math.max(srcLMS[0],1e-6),
           dstLMS[1]/Math.max(srcLMS[1],1e-6),
           dstLMS[2]/Math.max(srcLMS[2],1e-6)];
  /* Same ceiling as gainsFor, and for the identical reason: a pixel behind
     an IR filter carries almost no blue, so its LMS S-gain can demand the
     same runaway correction the RGB version needed capping against. This
     path was missed the first time \u2014 Simple and Bradford compute the gain
     differently but both can still see a near-zero blue channel, so both
     need the same limit. */
  const lo=Math.min(...d), hi=Math.max(...d);
  if (lo>0 && hi/lo > WB_MAX_SPREAD) {
    const mid=Math.pow(d[0]*d[1]*d[2], 1/3);
    const k=Math.log(WB_MAX_SPREAD)/Math.log(hi/lo);
    d=d.map(v=>mid*Math.pow(v/mid,k));
    bradfordAdaptMatrix.clamped=true;
  } else {
    bradfordAdaptMatrix.clamped=false;
  }
  const D = [d[0],0,0, 0,d[1],0, 0,0,d[2]];
  const adaptXYZ = bfMat3mul(BRADFORD_MI, bfMat3mul(D, BRADFORD_M));
  return bfMat3mul(XYZ2SRGB_M, bfMat3mul(adaptXYZ, SRGB2XYZ_M));   // linear RGB -> linear RGB
}

function rgbToHex(r, g, b) {
  const h = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}
function positionMarker(mode, px, py, cw, ch) {
  const m = $(mode === 'pre' ? 'pickMarkerPre' : 'pickMarkerPost');
  m.style.left = (px/cw*100) + '%';
  m.style.top = (py/ch*100) + '%';
  m.style.display = 'block';
}
function doPick(clientX, clientY) {
  if (!pickMode) return;
  // targeted-colour bands are a different kind of pick from pre/post WB —
  // they sample the raw source only, never touch preWB/postWB, and each tap
  // adds a new band rather than moving one existing marker — so it's
  // handled entirely separately
  if (pickMode === 'targeted') { targetedDoPick(clientX, clientY); return; }
  if (pickMode === 'index') { indexDoPick(clientX, clientY); return; }
  if (pickMode === 'vignette') { vigDoPick(clientX, clientY); return; }
  if (pickMode === 'maskColor') { maskColorDoPick(clientX, clientY); return; }
  if (pickMode === 'rawWb') { rtwbDoPick(clientX, clientY); return; }   // build 199: the RAW's own white balance (src/raw-wb.js)
  const mode = pickMode;
  // A fresh tap starts from IDENTITY, not from the current correction —
  // otherwise each new tap multiplies on top of the last one, so moving the
  // picker to a different spot compounds instead of re-evaluating cleanly.
  // (Dragging is different: it passes its own baseWBM, snapshotted once at
  // drag-start, so a continuous drag re-evaluates from that fixed point
  // rather than compounding frame by frame.)
  const baseWBM = mode === 'post' ? IDENTITY3 : null;
  armUndoCapture();
  if (!sampleAt(mode, clientX, clientY, baseWBM)) { preChangeSnapshot = null; return; }
  haptic('select');
  commitUndoCapture();
  hideLoupe();
  exitPick();
  attachDrag(mode);
}
$('preview').addEventListener('pointermove', ev => { if (pickMode) showLoupe(pickMode, ev.clientX, ev.clientY); });
$('preview').addEventListener('pointerleave', hideLoupe);
$('preview').addEventListener('click', ev => doPick(ev.clientX, ev.clientY));
$('preview').addEventListener('touchend', ev => {
  if (!pickMode) return;
  ev.preventDefault();
  const t = ev.changedTouches[0];
  doPick(t.clientX, t.clientY);
}, { passive: false });

// draggable marker: once a neutral point has been placed the first time,
// grab the marker itself at any point afterward to nudge it — the preview
// updates live as you move, same math as the initial pick, just
// continuously re-evaluated at the new position.
let dragState = null, dragLatestX = 0, dragLatestY = 0, dragRafPending = false;
function scheduleDragSample() {
  if (dragRafPending || !dragState) return;
  dragRafPending = true;
  requestAnimationFrame(() => {
    dragRafPending = false;
    if (!dragState) return;
    sampleAt(dragState.mode, dragLatestX, dragLatestY, dragState.baseWBM);
  });
}
function attachDrag(mode) {
  const m = $(mode === 'pre' ? 'pickMarkerPre' : 'pickMarkerPost');
  if (m._dragBound) return;
  m._dragBound = true;
  m.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    m.setPointerCapture(ev.pointerId);
    m.classList.add('dragging');
    showLoupe(mode, ev.clientX, ev.clientY);
    haptic('select');
    armUndoCapture();
    // identity base, same as a fresh tap — the marker's POSITION alone should
    // determine the white balance, so dragging re-evaluates cleanly rather
    // than stacking onto whatever the initial tap produced
    dragState = { mode, baseWBM: mode === 'post' ? IDENTITY3 : null, pointerId: ev.pointerId };
  });
  m.addEventListener('pointermove', ev => {
    if (!dragState || dragState.pointerId !== ev.pointerId) return;
    ev.preventDefault();
    dragLatestX = ev.clientX; dragLatestY = ev.clientY;
    showLoupe(dragState.mode, ev.clientX, ev.clientY);
    scheduleDragSample();
  });
  const endDrag = ev => {
    if (!dragState || dragState.pointerId !== ev.pointerId) return;
    try { m.releasePointerCapture(ev.pointerId); } catch (e) {}
    m.classList.remove('dragging');
    hideLoupe();
    dragState = null;
    commitUndoCapture();
  };
  m.addEventListener('pointerup', endDrag);
  m.addEventListener('pointercancel', endDrag);
}
let pickSnapshot = null;   // see enterPick/showLoupe -- a one-time readback cache, only populated when preserveDrawingBuffer isn't available
function enterPick(m) {
  pickMode = m;
  $('preview').classList.add('pick');
  $('wbPre').classList.toggle('armed', m === 'pre');
  $('wbPost').classList.toggle('armed', m === 'post');
  if ($('rawWbPick')) $('rawWbPick').classList.toggle('armed', m === 'rawWb');
  if ($('btnAddBand')) $('btnAddBand').classList.toggle('armed', m === 'targeted');
  if ($('btnIdxSample')) $('btnIdxSample').classList.toggle('armed', m === 'index');
  if ($('btnVigPick')) $('btnVigPick').classList.toggle('armed', m === 'vignette');
  if ($('btnMaskPick')) $('btnMaskPick').classList.toggle('armed', m === 'maskColor');
  /* showLoupe (below) draws from the live WebGL canvas on every pointer
     move -- fine when preserveDrawingBuffer held, since the canvas always
     has real content whenever it's read. On devices where WebGL2 could
     only be had without it (see the constructor's own comment), forcing a
     fresh render+readPixels() on every pointer move would be a real,
     visible performance cost, unlike the histogram/fullscreen cases which
     only ever run debounced or once. The image isn't changing while
     someone is just moving their finger around to pick a point, so one
     snapshot taken here, at the moment picking starts, covers the whole
     pick session -- cleared in exitPick below. */
  if (engine && !engine.hasPreserveBuffer && loadedImage && m !== 'pre' && m !== 'targeted' && m !== 'index') {
    engine.render(currentParams());
    const px = engine.readPixels();
    const tmp = document.createElement('canvas');
    tmp.width = $('preview').width; tmp.height = $('preview').height;
    tmp.getContext('2d').putImageData(new ImageData(px, tmp.width, tmp.height), 0, 0);
    pickSnapshot = tmp;
  } else {
    pickSnapshot = null;
  }
}
function exitPick() {
  pickMode = null;
  pickSnapshot = null;
  $('preview').classList.remove('pick');
  $('wbPre').classList.remove('armed');
  $('wbPost').classList.remove('armed');
  if ($('rawWbPick')) $('rawWbPick').classList.remove('armed');
  if ($('btnAddBand')) $('btnAddBand').classList.remove('armed');
  ['btnMaskPick'].forEach(id => { if ($(id)) $(id).classList.remove('armed'); });
}
/* Build 406: Esc puts an armed picker down (white balance, targeted colour, sample, centre, mask colour, RAW white
   balance, and dust spots), the way every desktop editor lets you back out of a tool. Before, the only way out was to
   find and press the same button again. Typing in a field is left alone, and Esc still closes fullscreen first. */
window.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape' || ev.defaultPrevented) return;
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if ($('previewFullscreen') && $('previewFullscreen').classList.contains('on')) return;   // that Esc belongs to fullscreen (src/view.js)
  let done = false;
  if (pickMode) { exitPick(); hideLoupe(); done = true; }
  if (typeof dustArmed !== 'undefined' && (dustArmed || dustSrcFor >= 0)) { dustSrcFor = -1; dustSetArmed(false); if (typeof dustRenderList === 'function') dustRenderList(); done = true; }
  if (done) ev.preventDefault();
});

/* ---------- Targeted colour bands ----------
   One tap adds one band, sampled from the untouched source — same rawPixels
   buffer the pre-swap WB picker already reads, so no fresh canvas read is
   needed. The hue is computed in OKLab, matching targetedHSL()/targetedHSLF()
   exactly, so the band centres on the same hue value the shader will compare
   against rather than an HSL or HSV approximation of it. */
function targetedDoPick(clientX, clientY) {
  if (!loadedImage || !rawPixels) { exitPick(); return; }
  if (targetedBands.length >= BAND_MAX) { exitPick(); return; }
  const cv = $('preview'), rect = cv.getBoundingClientRect();
  const cx = Math.max(rect.left, Math.min(rect.right, clientX));
  const cy = Math.max(rect.top, Math.min(rect.bottom, clientY));
  const x = Math.round((cx - rect.left) / rect.width * cv.width);
  const y = Math.round((cy - rect.top) / rect.height * cv.height);
  const rad = Math.max(6, Math.round(cv.width * 0.02));
  const [r, g, b] = sampleAvgFrom(rawPixels, rawCanvas.width, rawCanvas.height, x, y, rad);
  const lin = [srgbToLinearF(r / 255), srgbToLinearF(g / 255), srgbToLinearF(b / 255)];
  const [L, A, B] = linearToOklabF(lin[0], lin[1], lin[2]);
  const hue = hueDegOfF(A, B);
  armUndoCapture();
  // Collapsing every existing band down to just its swatch when a new one
  // is added — rather than leaving all of them, each with 4 sliders, open
  // at once — is what actually keeps this tidy with more than one colour
  // picked. The one just added stays open, since tuning it is the next
  // thing you're about to do.
  targetedBands.forEach(b => b.collapsed = true);
  targetedBands.push({ id: bandNextId++, hue, width: 30, dH: 0, dS: 0, dL: 0, swatch: rgbToHex(r, g, b), collapsed: false, pa: A, pb: B, pc: Math.hypot(A, B) });   // build 163: picked colour, for near-grey picks
  commitUndoCapture();
  bandRenderList();
  haptic('select');
  exitPick();
  render();
}
/* Numeric index readout. The colour ramp answers "where is it denser"; it
   cannot answer "do these two materials actually differ", because once
   values pin near the top of the range everything above the threshold gets
   the same colour and the display stops discriminating. Sampling the number
   directly separates a genuine measurement problem from a presentation one
   — bare wood and live foliage should be far apart in the data, and if they
   are not, no ramp change will help.

   Computed exactly as the shader does: pre-swap white balance applied, then
   the ratio, on the source pixels rather than the rendered output. */
function indexDoPick(clientX, clientY) {
  if (!loadedImage || !rawPixels) { exitPick(); return; }
  const cv = $('preview'), rect = cv.getBoundingClientRect();
  const cx = Math.max(rect.left, Math.min(rect.right, clientX));
  const cy = Math.max(rect.top, Math.min(rect.bottom, clientY));
  const x = Math.round((cx - rect.left) / rect.width * rawCanvas.width);
  const y = Math.round((cy - rect.top) / rect.height * rawCanvas.height);
  const rad = Math.max(4, Math.round(rawCanvas.width * 0.012));
  const [r, g, b] = sampleAvgFrom(rawPixels, rawCanvas.width, rawCanvas.height, x, y, rad);

  const lin = [srgbToLinearF(r / 255), srgbToLinearF(g / 255), srgbToLinearF(b / 255)];
  // mirrors the shader: pre-swap WB is a matrix now that Bradford is the
  // only method, not the gain array this used to read (which stays fixed
  // at identity and would silently drop pre-swap WB out of the index calc)
  const wb = bfMat3vec(preWBM, lin);
  const nir = Math.max(wb[0], 0);
  const other = Math.max(indexMode === 1 ? wb[1] : wb[2], 0);
  const denom = nir + other;
  const idx = denom > 0.0001 ? (nir - other) / denom : 0;

  indexSamples.push({ idx, rgb: [r|0, g|0, b|0], nir, other });
  if (indexSamples.length > 6) indexSamples.shift();
  renderIndexSamples();
  haptic('tick');
  exitPick();
}
let vigCentre = [0.5, 0.5];
function vigDoPick(clientX, clientY) {
  const cv = $('preview'), rect = cv.getBoundingClientRect();
  const cx = Math.max(rect.left, Math.min(rect.right, clientX));
  const cy = Math.max(rect.top, Math.min(rect.bottom, clientY));
  armUndoCapture();
  vigCentre = [(cx - rect.left) / rect.width, (cy - rect.top) / rect.height];
  $('vigCentreNote').textContent = 'Centre: ' + vigCentre[0].toFixed(2) + ', ' + vigCentre[1].toFixed(2);
  render();
  commitUndoCapture();
  haptic('tick');
  exitPick();
}
let indexSamples = [];
function renderIndexSamples() {
  const el = $('idxSamples'); if (!el) return;
  if (!indexSamples.length) { el.innerHTML = ''; return; }
  const rows = indexSamples.map(s =>
    '<div style="display:flex;gap:8px;align-items:center;margin-top:3px">' +
    '<span style="width:14px;height:14px;border-radius:2px;flex:none;background:rgb(' + s.rgb.join(',') + ')"></span>' +
    '<b style="color:var(--phosphor);min-width:4.5em">' + s.idx.toFixed(3) + '</b>' +
    '<span style="color:var(--muted)">NIR ' + s.nir.toFixed(3) + ' &middot; ' +
    (indexMode === 1 ? 'G ' : 'B ') + s.other.toFixed(3) + '</span></div>').join('');
  const vals = indexSamples.map(s => s.idx);
  const spread = Math.max(...vals) - Math.min(...vals);
  el.innerHTML = rows +
    '<div style="margin-top:6px;color:' + (spread < 0.05 ? 'var(--safelight)' : 'var(--muted)') + '">' +
    'spread ' + spread.toFixed(3) +
    (spread < 0.05 ? ' — these samples are not separating' : '') + '</div>';
}
let bandPreviewTimer = null;
function bandShowPreview(i) {
  if (i < 0) return;
  bandPreviewIndex = i;
  clearTimeout(bandPreviewTimer);
  bandPreviewTimer = setTimeout(() => { bandPreviewIndex = null; render(); }, 1400);
}
function bandRenderList() {
  const wrap = $('bandList');
  wrap.innerHTML = '';
  targetedBands.forEach(band => {
    const row = document.createElement('div');
    row.className = 'bandRow';

    const head = document.createElement('div');
    head.className = 'bandHead';
    const sw = document.createElement('div');
    sw.className = 'bandSwatch';
    sw.style.background = band.swatch;
    sw.title = 'Sampled: ' + band.swatch;
    head.appendChild(sw);
    const title = document.createElement('div');
    title.className = 'bandTitle';
    title.textContent = 'Hue ' + Math.round(band.hue) + '°';
    title.style.cursor = 'pointer';
    head.appendChild(title);
    // A chevron, not the whole row, is the toggle — the row also holds the
    // remove button, and stretching the tap target that far would make
    // deleting a band an easy accident while trying to collapse it.
    const chev = document.createElement('button');
    chev.type = 'button'; chev.className = 'bandChev';
    chev.textContent = '▸';
    chev.title = band.collapsed ? 'Expand' : 'Collapse';
    chev.setAttribute('aria-expanded', String(!band.collapsed));
    if (!band.collapsed) chev.classList.add('open');
    const toggle = () => {
      band.collapsed = !band.collapsed;
      bandRenderList();
    };
    chev.onclick = toggle;
    title.onclick = toggle;
    head.appendChild(chev);
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'bandRemove'; rm.textContent = '×';
    rm.title = 'Remove this band';
    rm.onclick = () => {
      armUndoCapture();
      targetedBands = targetedBands.filter(x => x.id !== band.id);
      commitUndoCapture();
      bandRenderList();
      render();
    };
    head.appendChild(rm);
    row.appendChild(head);
    /* Preview was also firing on any touch anywhere in the row, so it came up
       for Hue, Saturation and Lightness too — sitting over the very colour
       change being made, which is what read as the hue lagging. It is now
       raised only from the Width slider below, where "which pixels did I
       grab" is actually the question being asked. */
    if (band.collapsed) { wrap.appendChild(row); return; }

    // key, min, max, step, value, format, apply
    const specs = [
      ['dH', -180, 180, 1, band.dH, v => Math.round(v) + '°', v => band.dH = v],
      ['dS', -100, 100, 1, band.dS * 100, v => Math.round(v) + '%', v => band.dS = v / 100],
      ['dL', -100, 100, 1, band.dL * 100, v => (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v / 50).toFixed(1) + ' EV', v => band.dL = v / 100],   // build 162: exposure-style, the full slider is \u00b12 stops
      ['width', 5, 90, 1, band.width, v => Math.round(v) + '°', v => band.width = v],
      // 0 = the tool's usual behaviour: widen up to 3x on desaturated pixels,
      // since hue is mostly noise there. 100 = trust the Width exactly as
      // set regardless of chroma \u2014 for splitting two real hues that sit only
      // a few degrees apart in a desaturated raw capture, where that
      // widening is exactly what was smearing one band into the other.
      ['selectivity', 0, 100, 1, (band.selectivity || 0) * 100, v => Math.round(v) + '%', v => band.selectivity = v / 100],
    ];
    const labels = { dH: 'Hue', dS: 'Saturation', dL: 'Lightness', width: 'Width', selectivity: 'Selectivity' };
    // A visible note, not a title="" tooltip: hover tooltips don't fire on
    // touch at all, and every screenshot this app has actually been tested
    // from in the field has been a phone — a hover-only explanation is
    // close to no explanation for that audience. Only Selectivity gets one;
    // Hue/Saturation/Lightness/Width already read fine from ordinary
    // photo-editing vocabulary, so a note on every slider would be more
    // clutter than help. This was shipping with NO explanation anywhere in
    // the UI at all before this — the reasoning existed only in code
    // comments a user never sees.
    const SELECTIVITY_NOTE = 'Raise this if two real, different colours near each other are getting blended together (a band bleeding into a colour it shouldn\u2019t). Leave at 0 for ordinary use \u2014 it trades away some noise tolerance to gain that precision.';
    specs.forEach(([key, min, max, step, val, fmt, apply]) => {
      const id = 'band' + band.id + '_' + key;
      const sl = document.createElement('div');
      sl.className = 'sl';
      sl.innerHTML = '<label>' + labels[key] + ' <b id="v_' + id + '">' + fmt(val) + '</b></label>' +
        '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">';
      row.appendChild(sl);
      if (key === 'selectivity') {
        const note = document.createElement('p');
        note.className = 'note';
        note.style.margin = '-4px 0 6px';
        note.textContent = SELECTIVITY_NOTE;
        row.appendChild(note);
      }
      const el = sl.querySelector('input');
      el.addEventListener('input', () => {
        apply(+el.value);
        $('v_' + id).textContent = fmt(+el.value);
        if (key !== 'width') title.textContent = 'Hue ' + Math.round(band.hue) + '°';
        /* Show this band's selection while its controls are being touched and
           drop it shortly after. Tying it to the interaction rather than a
           toggle means it appears exactly when it answers a question — what
           did I just grab — and is never left on to be mistaken for the edit. */
        if (key === 'width') bandShowPreview(targetedBands.indexOf(band));
        render();
      });
      wireSliderGesture(el);
    });

    wrap.appendChild(row);
  });
  $('btnAddBand').disabled = targetedBands.length >= BAND_MAX;
  $('bandLimitNote').style.display = targetedBands.length >= BAND_MAX ? 'block' : 'none';
}
$('btnIdxSample').addEventListener('click', () => {
  pickMode === 'index' ? exitPick() : enterPick('index');
});
$('btnIdxClear').addEventListener('click', () => { indexSamples = []; renderIndexSamples(); });
$('btnVigPick').addEventListener('click', () => {
  pickMode === 'vignette' ? exitPick() : enterPick('vignette');
});
$('btnVigReset').addEventListener('click', () => {
  armUndoCapture();
  vigCentre = [0.5, 0.5];
  $('vigCentreNote').textContent = 'Centre: 0.50, 0.50 (default)';
  render();
  commitUndoCapture();
  haptic('tick');
});
$('vigFall').addEventListener('input', () => { $('v_vigFall').textContent = (+$('vigFall').value / 10).toFixed(1); });
$('lumPreserve').addEventListener('change', () => {
  armUndoCapture();
  lumPreserve = $('lumPreserve').checked;
  render();
  commitUndoCapture();
  haptic('select');
});
$('camMatch').addEventListener('change', () => {
  armUndoCapture();
  camMatchOn = $('camMatch').checked;
  render();
  commitUndoCapture();
  haptic('select');
});
/* Keep the landing-screen tick box and its editor twin in step, so the
   setting reads the same wherever you happen to be looking at it. */
(function () {
  const a = $('cr2PreferPreview'), b = $('cr2PreferPreviewEditor');
  if (!a || !b) return;
  a.addEventListener('change', () => { b.checked = a.checked; });
  b.addEventListener('change', () => { a.checked = b.checked; });
})();
/* Keep the ProPhoto swap tick box and its editor twin in step. Used to be a
   4-checkbox sync coordinating this against AMaZE's own checkbox too, with
   a reentrancy guard against a hard-freeze risk if a browser ever fired
   'change' from a programmatic .checked assignment. AMaZE is no longer a
   separate checkbox \u2014 it's the only real decode path now, not an opt-in
   \u2014 so this is back to the same plain two-way sync every other landing
   screen / editor pair on this page already uses. */
(function () {
  const a = $('camSpaceSwap'), b = $('camSpaceSwapEditor');
  if (!a || !b) return;
  a.addEventListener('change', () => { b.checked = a.checked; });
  b.addEventListener('change', () => { a.checked = b.checked; });
})();
/* The ProPhoto swap's own preset list \u2014 only the pure 3x3-matrix presets
   from the Channel Swap panel, pulled from those exact arrays rather than
   retyped, so a choice here is genuinely identical to the same name there.
   Film-stock recipes that do more than a 3x3 (LUTs, curves) are deliberately
   excluded: this stage only ever had matrix-multiply scope. */
const CAM_NATIVE_VALUE = 'native';   // build 237: see camNativeMatrix below
const CAM_SPACE_SWAP_PRESETS = (typeof IR_PRESETS !== 'undefined' ? IR_PRESETS.filter(p => p.m && !p.src && !p.noCam) : [])
  .concat(typeof UV_PRESETS !== 'undefined' ? UV_PRESETS.filter(p => p.m) : []);
(function () {
  const sel = $('camSpaceSwapPreset'), selEd = $('camSpaceSwapPresetEditor');
  const swap = $('camSpaceSwap'), swapEd = $('camSpaceSwapEditor');
  if (!sel || !selEd || !swap || !swapEd) return;
  [sel, selEd].forEach(s => {
    CAM_SPACE_SWAP_PRESETS.forEach((p, i) => {
      if (p.hidden) return;   // hidden presets get no option; the others keep their numbers, so a saved choice still means the same thing
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = p.n;
      s.appendChild(opt);
    });
    const nat = document.createElement('option');   // build 237
    nat.value = CAM_NATIVE_VALUE; nat.textContent = 'Camera native (no colour profile)';
    s.appendChild(nat);
  });
  function showHide() {
    const on = swap.checked || swapEd.checked;
    sel.style.display = selEd.style.display = on ? 'block' : 'none';
  }
  /* Was previously read-only at decode time: toggling the checkbox or
     changing the preset here did nothing to an already-loaded photo.
     Only way to see the effect was to re-load the same file, which ran
     the ENTIRE finishLoad() pipeline again -- wiping undo/redo history,
     the WB panel's state, zoom, and pan, as if it were a brand new
     photo, while ALSO looking like "loading twice" and showing a
     different image once the setting finally took. Wiring these four
     controls to reapplyCamSpaceSwap() instead reuses the already-decoded
     rawEngine.lastResult and only touches the pixel source -- no reset
     of anything else the user has already changed. */
  [swap, swapEd].forEach(el => el.addEventListener('change', e => { if (e.isTrusted && typeof camNativeByLook !== 'undefined') camNativeByLook = false; showHide(); reapplyCamSpaceSwap(); }));
  showHide();
  sel.addEventListener('change', e => { if (e.isTrusted && typeof camNativeByLook !== 'undefined') camNativeByLook = false; selEd.value = sel.value; reapplyCamSpaceSwap(); });
  selEd.addEventListener('change', e => { if (e.isTrusted && typeof camNativeByLook !== 'undefined') camNativeByLook = false; sel.value = selEd.value; reapplyCamSpaceSwap(); });
})();
/* Reads whichever of the two dropdowns actually has a selection \u2014 they're
   kept in sync above, so either one reflects the true current choice.
   Values are 0-100 scale, same as the Channel Swap panel's own MCELLS, so
   /100 here matches exactly how getMatrixUI() converts them. */
/* Build 237: "Camera native (no colour profile)". Not a swap: the matrix that, put through the swap's own route
   (camera -> ProPhoto -> this -> sRGB), cancels the camera's colour matrix, so the picture carries the sensor's own white
   balanced channels, the way a raw developer shows them with no camera profile. Worked out per file from that file's
   rgb_cam, which is why it is not a row in CAM_SPACE_SWAP_PRESETS. Used by the Infrared Ektachrome IE preset. */
function camNativeMatrix() {
  const r = typeof rawEngine !== 'undefined' && rawEngine.lastResult;
  const R = pp_rgbCam3x3(r && r.rgbCam);
  return bfMat3mul(SRGB_LIN_TO_PROPHOTO_LIN, bfMat3mul(bfMat3inv(R), PROPHOTO_LIN_TO_SRGB_LIN));
}
function getCamSpaceSwapMatrix() {
  const sel = $('camSpaceSwapPreset') || $('camSpaceSwapPresetEditor');
  if (!sel || sel.value === '') return null;
  if (sel.value === CAM_NATIVE_VALUE) return camNativeMatrix();
  const preset = CAM_SPACE_SWAP_PRESETS[+sel.value];
  return preset ? preset.m.map(v => v / 100) : null;
}
function getCamSpaceSwapName() {
  const sel = $('camSpaceSwapPreset') || $('camSpaceSwapPresetEditor');
  if (!sel || sel.value === '') return null;
  if (sel.value === CAM_NATIVE_VALUE) return 'Camera native';
  const preset = CAM_SPACE_SWAP_PRESETS[+sel.value];
  return preset ? preset.n : null;
}
/* Live re-apply for the experimental ProPhoto swap and its preset dropdown.
   No-ops if this photo wasn't decoded via rawEngine (a plain JPEG/PNG/WebP
   load, or a RAW that fell back to its embedded preview) -- there is no
   cached sensor result to reapply a swap to in that case, matching how the
   checkbox/preset are only meaningful for an AMaZE sensor decode to begin
   with. Recomputes the canvas from the SAME cached rawEngine.lastResult
   (no re-decode, no worker spin-up, no file re-read) and only touches the
   pixel source -- current working size, current manual rotation, current
   zoom/pan/undo/WB-panel state are all left exactly as they were. */
function reapplyCamSpaceSwap() {
  // only the RAW that is open now, and only when the swap choice (or the RAW noise reduction) really differs from what
  // its preview was built with: Undo, Reset and presets call this every time, and rebuilding without a change used to
  // cost a full re-render, throw away a picked pre-swap white balance on files without camera white balance, and could
  // swap the photo itself
  if (!rawEngine.lastResult || rawEngine.lastGen !== loadToken) return;
  const checked = !!($('camSpaceSwap') && $('camSpaceSwap').checked);
  const swapSame = camSwapKey(checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName()) === rawEngine.builtKey;
  if (typeof syncRawHlButtons === 'function') syncRawHlButtons();
  if (typeof syncRawDeconv === 'function') syncRawDeconv();
  if (typeof rawFixWanted === 'function') {   // build 225: hot pixels and line noise, fixed on the sensor data first
    syncRawFixTick();
    if (rawFixWanted() !== !!rawEngine.lastResult.__fixOn) { rawFixRun(); return; }
  }
  const wbSame = rawWbKey() === rawEngine.builtWbKey;   // build 197: the RAW white balance is baked in too
  if (swapSame && wbSame && rawNrKey() === (rawEngine.builtNr || '0|0|0')) return;
  if (!wbSame) rawEngine.nrPrev = null;
  if (rawNrKey() !== '0|0|0') { rebuildRawPreview(); return; }   // the noise-reduced path, which handles the swap too
  rawNrRun++;   // cancels any noise reduction still running: it is off now
  /* Build 200: from the working-size planes cached for this decode rather than the full sensor: the same downscale, so
     the same picture, without reading every sensor pixel again on each swap or white balance change. */
  const base = rawEngine.lastResult, ds = rawWorkingPlanes(base);
  const wres = Object.assign({}, base, { R: ds.R, G: ds.G, B: ds.B, width: ds.width, height: ds.height, __wb: rawWbFor(base).slice(), __ds: null, __clip: rawClipFor(base) });
  const cv2 = rawEngineResultToCanvas(wres, checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName());
  base.__M = wres.__M;   // the IR leak correction reads it from the decode (src/ir-leak.js)
  rawEngine.builtNr = '0|0|0';
  installRawPreview(cv2, !swapSame);
  if (typeof setRawNrBusy === 'function') setRawNrBusy(false, '');
}
/* Puts a freshly built RAW canvas on screen. The automatic white balance is only redone when the colours changed
   (a different swap), never for noise reduction alone, so a picked pre-swap white balance survives. */
function installRawPreview(cv2, coloursChanged) {
  if (coloursChanged && !cv2.__hasCameraWB) autoWhiteBalanceRaw(cv2);
  const maxDim = WORKING_MAX_DIM;
  let w = cv2.width, h = cv2.height;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  sourceImg = cv2;
  drawOriented(rawCanvas, cv2, w, h, srcOrient);
  carryLinearFloat(rawCanvas, cv2, srcOrient);
  loadedImage = rawCanvas;
  rawPixels = rawCtx.getImageData(0, 0, rawCanvas.width, rawCanvas.height).data;
  contrastPivot = medianLuminance(rawPixels);
  if (engine) engine.setImage(dustPrepare(rawCanvas));
  /* The Original side of Before/After is drawn from rawCanvas, and nothing redrew it when the decode was rebuilt (swap box
     unticked by Reset all, noise reduction, highlight rebuild): the left half kept showing the previous decode while the
     right half showed the new one, which read as the app having wrecked the picture. */
  if (typeof refreshCompareRef === 'function') { refSource = undefined; refreshCompareRef(); }
  render();
}
/* The noise-reduced preview: the working-size planes are denoised in a worker (cached, so a swap change afterwards
   does not redo it), then built and shown like any other RAW preview. A newer request, or a new photo, cancels the
   result of an older one. */
let rawNrRun = 0;
function setRawNrBusy(on, text) {
  const box = $('rawNrBox'), st = $('rawNrStatus');
  if (box) box.classList.toggle('busy', !!on);
  if (st) st.textContent = text || '';
  const dn = $('rawDeconvNote'); if (dn) dn.textContent = on ? (text || 'Working\u2026') : '';   // build 231: shown beside the deconvolution slider too
}
async function rebuildRawPreview() {
  if (!rawEngine.lastResult || rawEngine.lastGen !== loadToken) return;
  const my = ++rawNrRun, token = loadToken, base = rawEngine.lastResult;
  const v = rawNrValues(), key = rawNrKey();
  const checked = !!($('camSpaceSwap') && $('camSpaceSwap').checked);
  const swapSame = camSwapKey(checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName()) === rawEngine.builtKey;
  let res = base;
  if (rawProcActive(v)) {
    if (!(rawEngine.nrPrev && rawEngine.nrPrev.key === key && rawEngine.nrPrev.gen === token && rawEngine.nrPrev.wbKey === rawWbKey())) {
      setRawNrBusy(true, (v.L > 0 || v.C > 0) ? 'Reducing noise\u2026' : (v.DA > 0 && v.HL !== 1) ? 'Sharpening\u2026' : 'Rebuilding highlights\u2026');
      const ds = rawWorkingPlanes(base), wb = rawWbFor(base);
      let out;
      try {
        out = await runRawNr(ds.R, ds.G, ds.B, ds.width, ds.height, Object.assign({ luma: v.L, chroma: v.C, hl: v.HL, wb: wb, clip: rawClipFor(rawEngine.lastResult) }, rawDeconvOpts(rawEngine.lastResult, ds.width)),
          p => { if (my === rawNrRun) setRawNrBusy(true, (!(v.DA > 0) || ((v.L > 0 || v.C > 0) && p < 0.6) ? 'Reducing noise\u2026 ' : 'Sharpening\u2026 ') + Math.round(p * 100) + '%'); });
      } catch (e) {
        if (my === rawNrRun) { setRawNrBusy(false, ''); toast('RAW noise reduction failed (' + (e && e.message || e) + ')', true); }
        return;
      }
      if (my !== rawNrRun || token !== loadToken || rawEngine.lastResult !== base) return;   // superseded
      rawEngine.nrPrev = { key: key, wbKey: rawWbKey(), gen: token, res: Object.assign({}, base, { R: out.R, G: out.G, B: out.B, width: ds.width, height: ds.height, __wb: wb, __ds: null, __hlDone: !!out.hlDone, __clip: rawClipFor(base) }) };
    }
    res = rawEngine.nrPrev.res;
  }
  if (my !== rawNrRun) return;
  const cv2 = rawEngineResultToCanvas(res, checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName());
  /* Build 237: the noise-reduced copy is what got the matrix, but the RAW white balance picker, its drag preview and the
     IR leak correction all read it from the decode itself. Without this they went on using the matrix from before a
     swap (or the camera-native option) was switched on, whenever RAW noise reduction was on, which it is by default. */
  if (res !== base && base) base.__M = res.__M;
  rawEngine.builtNr = key;
  installRawPreview(cv2, !swapSame);
  setRawNrBusy(false, (v.L > 0 || v.C > 0) ? 'Applied' : '');
  if (v.HL === 1 && $('rawHlStatus')) $('rawHlStatus').textContent = 'Applied';
}
$('filmOn').addEventListener('change', () => {
  armUndoCapture();
  filmOn = $('filmOn').checked;
  render();
  commitUndoCapture();
  haptic('select');
});
if ($('wideWork')) $('wideWork').addEventListener('change', () => {   // build 253
  armUndoCapture();
  render();
  commitUndoCapture();
  haptic('select');
});
if ($('swapSpace')) $('swapSpace').addEventListener('change', () => {
  armUndoCapture();
  syncWidenFromSelect();
  render();
  commitUndoCapture();
  haptic('select');
});
$('btnAddBand').addEventListener('click', () => {
  pickMode === 'targeted' ? exitPick() : enterPick('targeted');
});



// ---------- LUT (.cube) support ----------
// Standard Adobe/Resolve .cube format: a text file with a LUT_3D_SIZE header
// and N^3 lines of "R G B" floats (0..1). Applied CPU-side to the pixels read
// back from the WebGL canvas, at export time only — the shader itself doesn't
// sample LUTs live, so the on-screen preview shows the swap/WB/exposure/hue/
// sat/black-point result without the grade; the exported file has it baked in.
/* Aerochrome film emulation, supplied by Fedia and embedded rather than
   loaded, at his request: it stands in for the channel swap and so belongs
   at the START of the workflow, which a user-imported .cube cannot reach.

   Stored as a 64-cube of 8-bit RGB, base64. LOSSLESS here rather than an
   approximation: the source .cube's values are already multiples of 1/255,
   so 8 bits captures it exactly — verified round-trip error 0.0001 levels.
   A 32-cube would have saved 350KB but cost up to 21 levels of error on
   pale warm highlights, exactly the tones this LUT is used on, so the full
   grid is kept. */
/* Build 320: the film LUT's bytes (delta-encoded, deflated, as described below) live in data/film-lut.bin and are
   fetched in the background once the page has loaded, instead of sitting in editor.js as 136 KB of base64. That was
   about a quarter of everything the browser had to download before the editor could start, for a look most visits
   never use. Nothing else changes: the Triple Band Aerochrome box stays greyed out until it has arrived, exactly as
   it already did while the old copy was being decoded. */
const FILM_LUT_URL = 'data/film-lut.bin';
let filmLUT = null;
/* The film LUT is stored delta-encoded then deflated, not as flat bytes.
   A 64^3 LUT is 786KB raw, which base64 inflates to 1.05MB — on its own
   about 70% of this entire file. But a LUT is smooth by nature: each entry
   is very close to its neighbour along any axis, so storing the DIFFERENCE
   from the previous slice leaves mostly zeros and near-zeros, which deflate
   crushes. 1,048,576 base64 characters becomes 135,696 for exactly the same
   numbers back out — verified byte-identical, not approximated. Downsampling
   to 32^3 would have saved a comparable amount but is lossy, and this is
   Fedia's measured transform rather than a look someone eyeballed.

   Decoding needs DecompressionStream, which is async, while all six callers
   are synchronous and one of them is the per-pixel LUT bake. So it is
   decoded once at startup and cached; this stays sync and hands back the
   cache, or null in the brief window before it is ready. */
function decodeFilmLUT() { return filmLUT; }

/* Massinissa's Aerochrome, captured from his Lightroom Look. The .xmp holds
   the whole grade as an embedded table in Adobe's own encoding, which is
   undocumented and did not yield to decoding, so this came the other way
   round: an identity HALD (every colour in a 32^3 cube laid out as an image)
   was run through the Look in Lightroom and handed back, which makes the
   result the lookup table itself.

   This grade CLIPS, and that is the look rather than a defect in the capture.
   Measured on a real frame at full mix: 59.8% of pixels end with a channel
   at 0 or 255, and a sky gradient shows 1094 steps of 3+ levels against 447
   untouched. At 75% mix nothing clips at all. Blurring the lookup table was
   tried first, on the theory that JPEG grain in the capture was the cause;
   it moved the stepping by four counts out of eleven hundred and cost real
   accuracy, so it was reverted. The stepping is the grade reaching the edge
   of the gamut, which no amount of smoothing the table can change - pulling
   Mix back is the only thing that does.

   Captured at FULL strength. A first attempt was made with Lightroom's
   profile amount slider left part-way along, which produced a visibly
   weaker grade \u2014 the same transform in the same direction (0.96 agreement)
   but only 1.20x short of it. Worth knowing if this is ever recaptured: the
   slider must read 100, or the look is quietly diluted.

   Stored delta-encoded then deflated, exactly like the film LUT above, for
   the same reason \u2014 57KB instead of the 864KB the .cube text would add.
   Verified byte-identical through the round trip.

   Sits beside Triple Band Aerochrome rather than replacing it: that one is
   Fedia's measurement of his triple-bandpass filter, this one is
   Massinissa's Lightroom grade, and they are different claims about what
   Aerochrome looks like — one from a filter stack, one from a colourist. */


/* AerochromeSingle. Unlike its sibling this one is a raw camera profile: it
   acts before demosaic, so Lightroom will not apply it to an ordinary RGB
   image and the HALD trick cannot reach it at all. Captured instead from a
   before/after pair of the same CR2 \u2014 one export neutral, one with the
   profile on \u2014 and a cubic fitted between them across half a million
   usable pixel pairs.

   That fit lands at 1.08/255 RMSE, against 3.78 for the best affine one,
   which is the measurement that says the profile really is non-linear and
   worth 20 terms rather than 12. It is a FIT, not the profile itself: it can
   only be right about colours the source frame actually contained, and any
   part of the profile's behaviour that depends on sensor data rather than
   RGB cannot survive the trip. Accurate on that frame's range, honest
   guesswork outside it. */


let filmLUTReady = (async () => {
  try {
    if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
    const resp = await fetch(FILM_LUT_URL, { priority: 'low' });
    if (!resp.ok) throw new Error('film LUT ' + resp.status);
    const packed = new Uint8Array(await resp.arrayBuffer());
    const ds = new DecompressionStream('deflate');
    const buf = await new Response(new Blob([packed]).stream().pipeThrough(ds)).arrayBuffer();
    const d = new Uint8Array(buf);
    const size = Math.round(Math.cbrt(d.length / 3));
    const stride = size * size * 3;          // one slice along the first axis
    // undo the delta: each slice is stored as its difference from the one
    // before it, wrapped into a byte, so it walks back the same way
    const flat = new Uint8Array(d.length);
    flat.set(d.subarray(0, stride));
    for (let i = stride; i < d.length; i++) flat[i] = (flat[i - stride] + d[i]) & 255;
    const data = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) data[i] = flat[i] / 255;
    filmLUT = { size, domainMin: [0,0,0], domainMax: [1,1,1], data };
    if ($('filmOn')) $('filmOn').disabled = false;
    if (filmOn && engine) { engine.setLUTPre(filmLUT); render(); }
    return filmLUT;
  } catch (e) {
    console.warn('Film LUT decode failed:', e);
    if ($('filmOn')) { $('filmOn').disabled = true; $('filmOn').checked = false; }
    return null;
  }
})();
function parseCubeLUT(text){
  const lines=text.split(/\r?\n/);
  let size=0,domainMin=[0,0,0],domainMax=[1,1,1];
  const data=[];
  for(const raw of lines){
    const line=raw.trim();
    if(!line||line.startsWith('#'))continue;
    if(/^TITLE/i.test(line))continue;
    if(/^LUT_3D_SIZE/i.test(line)){size=parseInt(line.split(/\s+/)[1],10);continue;}
    if(/^DOMAIN_MIN/i.test(line)){domainMin=line.split(/\s+/).slice(1).map(Number);continue;}
    if(/^DOMAIN_MAX/i.test(line)){domainMax=line.split(/\s+/).slice(1).map(Number);continue;}
    if(/^LUT_1D_SIZE/i.test(line))throw new Error('1D LUTs aren\u2019t supported \u2014 only 3D .cube files');
    const parts=line.split(/\s+/).map(Number);
    if(parts.length===3&&parts.every(n=>!isNaN(n)))data.push(parts[0],parts[1],parts[2]);
  }
  if(!size||data.length!==size*size*size*3)throw new Error('invalid or incomplete .cube file');
  /* Force the domain to exactly three finite components. These go straight
     into a vec3 uniform now that the LUT is sampled on the GPU, and a file
     with a truncated or malformed DOMAIN line would otherwise throw inside
     uniform3fv rather than at parse time, where it can be reported. */
  const fix=(a,def)=>[0,1,2].map(i=>Number.isFinite(a[i])?a[i]:def);
  domainMin=fix(domainMin,0);domainMax=fix(domainMax,1);
  return{size,domainMin,domainMax,data:new Float32Array(data)};
}
function sampleLUT(lut,r,g,b){
  const N=lut.size,d=lut.data;
  const nr=Math.max(0,Math.min(1,(r-lut.domainMin[0])/((lut.domainMax[0]-lut.domainMin[0])||1)));
  const ng=Math.max(0,Math.min(1,(g-lut.domainMin[1])/((lut.domainMax[1]-lut.domainMin[1])||1)));
  const nb=Math.max(0,Math.min(1,(b-lut.domainMin[2])/((lut.domainMax[2]-lut.domainMin[2])||1)));
  const fx=nr*(N-1),fy=ng*(N-1),fz=nb*(N-1);
  const x0=Math.floor(fx),y0=Math.floor(fy),z0=Math.floor(fz);
  const x1=Math.min(x0+1,N-1),y1=Math.min(y0+1,N-1),z1=Math.min(z0+1,N-1);
  const dx=fx-x0,dy=fy-y0,dz=fz-z0;
  const idx=(x,y,z)=>((z*N+y)*N+x)*3;
  const out=[0,0,0];
  for(let c=0;c<3;c++){
    const c000=d[idx(x0,y0,z0)+c],c100=d[idx(x1,y0,z0)+c];
    const c010=d[idx(x0,y1,z0)+c],c110=d[idx(x1,y1,z0)+c];
    const c001=d[idx(x0,y0,z1)+c],c101=d[idx(x1,y0,z1)+c];
    const c011=d[idx(x0,y1,z1)+c],c111=d[idx(x1,y1,z1)+c];
    const c00=c000*(1-dx)+c100*dx,c10=c010*(1-dx)+c110*dx;
    const c01=c001*(1-dx)+c101*dx,c11=c011*(1-dx)+c111*dx;
    const c0=c00*(1-dy)+c10*dy,c1=c01*(1-dy)+c11*dy;
    out[c]=c0*(1-dz)+c1*dz;
  }
  return out;
}
// applyLutPixel() removed: the LUT is applied by the shader now, in float,
// before quantisation — the old CPU loop ran on already-8-bit pixels and so
// re-quantised the grade at every step.
const LUT_EMPTY_MSG='No LUT loaded \u2014 a film-style grade layered on top of the channel swap, shown live in the preview.';
function applyLUT(lut,label){
  currentLUT=lut;
  if(engine)engine.setLUT(lut);
  const prec=engine&&engine.isWebGL2?'16-bit atlas':'8-bit atlas';
  $('lutStatus').textContent='\u2713 '+label+' \u2014 '+lut.size+'\u00b3 grid, '+prec;
  $('lutControls').style.display='block';
  $('lutClear').style.display='inline-block';
  render();
}
function clearLUT(){
  currentLUT=null;
  if(engine)engine.setLUT(null);
  $('lutStatus').textContent=LUT_EMPTY_MSG;
  $('lutControls').style.display='none';
  $('lutClear').style.display='none';
  render();
}
// lutMix now drives the live shader, so it needs the same input wiring as
// every other slider — it was previously read only at export time.
(function(){
  const e=$('lutMix'); if(!e)return;
  e.addEventListener('input',()=>{$('v_lutMix').textContent=e.value;render();});
})();

/* The H.H. action end to end. Its channel mixers are the matrix preset; the
   values here are the stages that follow them, read out of the .atn:
   Brightness/Contrast +74, Vibrance +10, and a closing Hue/Saturation.

   That last hue is set to +20, not the +18 the file contains. The people who
   actually shoot this action say +20 is what gets the reds right, and on a
   real frame it is the difference between foliage at hue 352 (pink) and hue 2
   (red) \u2014 small, but it is the whole point of the step. Checked for damage
   before adopting: even the action's full +74 contrast only moves clipping
   from 2.6% to 3.6%, so nothing here needed softening the way the film
   presets did. */
/* See the button's own comment for where these numbers come from: they are
   fitted to Mosse's published foliage colour, sampled off his work, rather
   than chosen by eye. */
/* See the button comment for the sourcing. Values fitted to the measured
   foliage of published E-4 survey work: hue 348, saturation 57, lightness
   48% \u2014 against Mosse's 322/50/75%. The negative exposure and raised
   contrast are what produce the darkness, which is as much the signature of
   this process as the hue is. */
/* Every recipe starts from a known state.

   A recipe describes a complete look, so it has to clear whatever the last
   one left behind rather than layering on top of it. Setting only the values
   a recipe cares about meant switching between them inherited the previous
   one's exposure, contrast, bands and toggles \u2014 and the result looked like
   the recipe was broken when it was really just building on a foundation it
   never asked for.

   This clears everything that changes the LOOK: the sliders, the targeted
   bands, and the toggles that are easy to forget because they live in
   other panels (Triple Band, the tone response, and any loaded LUT). It
   deliberately does NOT touch white balance, crop, or the CR2 preview
   preference \u2014 those describe the FILE rather than the look, and
   throwing away a white balance someone set by hand would be its own bug. */
/* Nik's own Aerochrome LUT \u2014 a 3x3x3 cube, hand-authored rather than
   captured or fitted. Tiny (27 entries, 116 characters compressed) because
   at that size the LUT is describing the SHAPE of a colour transform and
   letting trilinear interpolation fill in everything between, which is all
   a channel-swap-style look actually needs.

   What it does, measured: greys stay exactly neutral at every level (0, 0.5
   and 1.0 all pass through untouched), visible red maps to magenta at hue
   326 \u2014 the same figure measured off the nine reference frames \u2014 and blue
   maps to yellow. Green foliage goes cyan-blue, which is why this reads as
   a different take on the same film rather than a copy of the E-6 recipe.

   Kept as a LUT rather than converted into a recipe: it is a lookup, and
   flattening it into a matrix plus sliders would lose the parts that are
   not expressible that way.

   Packed in FILE ORDER, with no axis transpose. The first embedding applied
   a (2,1,0) transpose copied from the other embedded LUTs, which scrambled
   this one \u2014 the tool's own .cube loader keeps file order, so a transpose
   here made the embedded copy disagree with the same file loaded normally.
   The tell was the first entries: 0,0,0 / 0.8,0.8,0 in the file against
   0,0,0 / 0,0.502,0 after the transpose. If another LUT is ever added, check
   it against loading the .cube directly rather than assuming the packing. */
function resetLookBeforeRecipe() {
  const set = (id, v) => {
    const el = $(id); if (!el) return;
    el.value = v;
    const lbl = $('v_' + id); if (lbl) lbl.textContent = v;
  };
  ['hue','sat','vibrance','bright','brightness','contrast','satPreserve','blackPt','whitePt','noiseReduction','sharpen','sharpenRadius','sharpenMask','noiseColour',
   'highlights','shadows','temp','tint','filmToneAmt','vigAmt'].forEach(id => {
    if (!$(id)) return;
    set(id, id === 'sat' ? 100 : 0);
  });
  targetedBands = [];
  [['lumaR',21],['lumaG',72],['lumaB',7]].forEach(([id,v]) => {
    const el = $(id); if (el) { el.value = v; const lbl = $('v_'+id); if (lbl) lbl.textContent = v; }
  });
  /* The channel-swap matrix and the active preset button. These were the
     last things still leaking: a recipe that wants NO swap (a LUT carrying
     its own transform) inherited whatever swap ran before it, and a recipe
     that wants a swap had its own cleared by a preceding LUT. Both showed up
     as two failures in an all-pairs test \u2014 E-4 then E-6 v2, and E-4 then the
     Aerochrome tri-tone recipe.

     Reset to identity here; any recipe that wants a swap sets it immediately
     afterwards, so clearing first is always safe. */
  MCELLS.forEach((id, i) => { const el = $(id); if (el) el.value = (i % 4 === 0) ? 100 : 0; });
  MOFFCELLS.forEach(id => { const el = $(id); if (el) el.value = 0; });
  if (typeof FF_POLY !== 'undefined') FF_POLY = null;   // build 334
  document.querySelectorAll('.pb').forEach(x => x.classList.remove('on'));
  if (typeof activePresetName !== 'undefined') activePresetName = null;
  mxSync();
  // toggles in other panels that silently survive a recipe otherwise
  filmOn = false;            if ($('filmOn')) $('filmOn').checked = false;
  filmToneOn = false;        if ($('chkFilmTone')) $('chkFilmTone').checked = false;
  if ($('filmToneRow')) $('filmToneRow').style.display = 'none';
  /* The post-swap white balance, but NOT the pre-swap one.

     These are different in kind. Pre-swap WB is a property of the FILE \u2014 it
     is how you told the tool to read this particular camera and filter, and
     throwing it away when someone tries a preset would destroy real work.
     Post-swap WB is part of the LOOK: the Aerochrome tri-tone recipe sets it
     via autoTone(), so leaving it in place meant every recipe pressed
     afterwards inherited that recipe's white balance. That was the last
     leak, and it showed up as all four "after Aero recipe" failures in the
     all-pairs test. */
  postWB = [1, 1, 1];
  postWBM = IDENTITY3;
  if ($('wbPostStatus')) $('wbPostStatus').textContent = 'Post-WB: Not set';
  currentLUT = null;
  preLUTUser = null;
  if (engine) { engine.setLUT(null); engine.setLUTPre(null); }
  if ($('lutMix')) { $('lutMix').value = 0; if ($('v_lutMix')) $('v_lutMix').textContent = '0'; }
  if ($('lutClear')) $('lutClear').style.display = 'none';
  if ($('lutStatus')) $('lutStatus').textContent =
    'No LUT loaded \u2014 a film-style grade layered on top of the channel swap, shown live in the preview.';
}

/* User-saved presets. Mirrors resetLookBeforeRecipe's own definition of
   "the look" exactly -- same slider list, same matrix, same exclusions
   (no white balance, no LUT) -- because a saved preset needs to survive
   being applied through that exact same reset, the same way every
   built-in recipe already does. Stored in localStorage as one JSON
   object keyed by name; see the HTML comment above the My Presets
   section for why localStorage rather than IndexedDB, and why this is
   per-browser rather than synced anywhere. */
const USER_PRESETS_KEY = 'irlab_user_presets';
const USER_PRESET_SLIDER_IDS = ['skyDeep','crimsonFol','debandAmt','epdAmt','epdEdge','epdScale','hiRange','shRange','hslH0','hslH1','hslH2','hslH3','hslH4','hslH5','hslH6','hslH7','hslS0','hslS1','hslS2','hslS3','hslS4','hslS5','hslS6','hslS7','hslL0','hslL1','hslL2','hslL3','hslL4','hslL5','hslL6','hslL7','hue','sat','vibrance','bright','brightness','contrast','satPreserve','blackPt','whitePt','noiseReduction','sharpen','sharpenRadius','sharpenMask','noiseColour',
  'highlights','shadows','temp','tint','filmToneAmt','vigAmt',
  'lumaR','lumaG','lumaB'];

function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem(USER_PRESETS_KEY) || '{}'); }
  catch (e) { return {}; }   // corrupt or private-mode storage -- behave as if none are saved, not a crash
}
function saveUserPresetsToStorage(obj) {
  try { localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(obj)); } catch (e) {}
}

function captureLookForUserPreset() {
  return {
    tv: 4,
    m: MCELLS.map(id => +($(id) && $(id).value) || 0),
    mOff: MOFFCELLS.map(id => +($(id) && $(id).value) || 0),
    sliders: Object.fromEntries(USER_PRESET_SLIDER_IDS.map(id => [id, +($(id) && $(id).value) || 0])),
    targetedBands: targetedBands.map(b => ({...b})),
    filmOn: filmOn, filmToneOn: filmToneOn,
    // part of the look, not the file -- same reasoning resetLookBeforeRecipe
    // already documents for why post-swap WB travels with a recipe and
    // pre-swap WB never does
    postWB: [...postWB], postWBM: [...postWBM],
    poly: (typeof ffPolyActive === 'function' && ffPolyActive()) ? { c: FF_POLY.c, eps: FF_POLY.eps } : undefined,   // build 334: the curved Digital Aerochrome mapping, when it is in force
  };
}

/* Build 236: goes on top of the edit, like the swap presets (presetLayerBegin in src/controls.js): a setting the look
   carries is set, anything it does not carry is left as you had it. opts.fresh keeps the old clean start (a look opened
   from a shared link, which should come out as it was sent); opts.extra runs a final step of the look's own (the auto
   white balance of Full-spectrum natural) before it is recorded, so taking the look off takes that off too. */
function applyUserPreset(look, opts) {
  opts = opts || {};
  armUndoCapture();
  if (typeof presetMixClear === 'function') presetMixClear();
  let layerBase = null;
  if (opts.fresh) { hhUndoExtras(); eirUndo(); resetLookBeforeRecipe(); PRESET_LAYER = null; }
  else layerBase = presetLayerBegin();
  MCELLS.forEach((id, i) => { const el = $(id); if (el && look.m) el.value = look.m[i]; });
  MOFFCELLS.forEach((id, i) => { const el = $(id); if (el && look.mOff) el.value = look.mOff[i]; });
  mxSync();
  /* build 334: a look carries the curved mapping only if it was made with one; either way what was there is replaced, and it
     is tied to the matrix cells as they stand now (ffPolySig), so anything that changes a cell later switches it off */
  if (typeof FF_POLY !== 'undefined') FF_POLY = (look.poly && typeof ffPolySig === 'function') ? { c: look.poly.c, eps: look.poly.eps, sig: ffPolySig() } : null;
  Object.keys(look.sliders || {}).forEach(id => {
    const el = $(id); if (!el) return;
    let pv = look.sliders[id];
    if (!look.tv && LIGHT_TAPER[id]) pv = taperPos(id, pv);   // a preset saved before the weighted sliders
    if (look.tv === 2 && BW_TAPER_V2[id]) pv = bwFromV2(id, pv);
    if (!(look.tv >= 4) && WB_CURVE[id]) pv = wbPos(pv);   // build 190
    el.value = pv;
    const lbl = $('v_' + id); if (lbl) lbl.textContent = fmtSliderValue(id, pv);
  });

  if (look.targetedBands || opts.fresh) { targetedBands = (look.targetedBands || []).map(b => ({...b})); bandRenderList(); }
  if ('filmOn' in look || opts.fresh) { filmOn = !!look.filmOn; if ($('filmOn')) $('filmOn').checked = filmOn; }
  if ('filmToneOn' in look || opts.fresh) filmToneOn = !!look.filmToneOn;
  if ($('chkFilmTone')) {
    $('chkFilmTone').checked = filmToneOn;
    if ($('filmToneRow')) $('filmToneRow').style.display = filmToneOn ? '' : 'none';
  }
  if (look.postWB) postWB = [...look.postWB];
  if (look.postWBM) {
    postWBM = [...look.postWBM];
    const set = postWBM.some((v, i) => v !== IDENTITY3[i]);
    if ($('wbPostStatus')) $('wbPostStatus').textContent = set ? 'Set \u2714 (Bradford)' : 'Post-WB: Not set';
  }
  if (opts.extra) opts.extra();
  if (opts.mark) opts.mark();
  if (layerBase) presetLayerEnd(layerBase);
  haptic('select');
  render();
  commitUndoCapture();
}

function renderUserPresetButtons() {
  const grid = $('pgUser'); if (!grid) return;
  const presets = loadUserPresets();
  const names = Object.keys(presets);
  grid.innerHTML = '';
  if (!names.length) {
    grid.innerHTML = '<p class="note" style="margin:0">No saved presets yet \u2014 use the button below to save the current look.</p>';
    return;
  }
  const esc = s => s.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  names.forEach(name => {
    const b = document.createElement('button');
    b.className = 'pb';
    b.style.position = 'relative';
    b.innerHTML = '<b>' + esc(name) + '</b>';
    b.onclick = () => applyUserPreset(presets[name]);
    // a small delete control on each card rather than a separate "manage
    // presets" screen -- there is no size limit or clutter problem this
    // needs to solve for yet, and a screen for a handful of buttons would
    // be more interface than the feature warrants
    const del = document.createElement('span');
    del.textContent = '\u00d7';
    del.title = 'Delete this preset';
    del.style.cssText = 'position:absolute;top:4px;right:6px;color:var(--muted);font-size:14px;line-height:1;padding:2px 4px;cursor:pointer';
    del.onclick = async ev => {
      ev.stopPropagation();   // otherwise this click also lands on the button underneath and applies the preset it's about to delete
      if (!(await askConfirm('Delete “' + name + '”?', 'This cannot be undone.', 'Delete'))) return;
      const p = loadUserPresets();
      delete p[name];
      saveUserPresetsToStorage(p);
      renderUserPresetButtons();
    };
    b.appendChild(del);
    grid.appendChild(b);
  });
}

if ($('btnSaveUserPreset')) {
  $('btnSaveUserPreset').addEventListener('click', async () => {
    const existing = loadUserPresets();
    let n = Object.keys(existing).length + 1;
    while (('Look ' + n) in existing) n++;
    const raw = await askText('Name this preset', 'Look ' + n, 'Save');
    if (raw === null) return;
    const name = raw.trim();
    if (!name) return;
    if (name in existing && !(await askConfirm('Replace “' + name + '”?', 'A preset with that name already exists.', 'Replace'))) return;
    const presets = loadUserPresets();
    presets[name] = captureLookForUserPreset();
    saveUserPresetsToStorage(presets);
    renderUserPresetButtons();
    haptic('confirm');
    toast('Saved \u201c' + name + '\u201d');
  });
}
renderUserPresetButtons();

$('fiLut').addEventListener('change',async e=>{
  const f=e.target.files&&e.target.files[0];
  e.target.value='';
  if(!f)return;
  $('lutStatus').textContent='Reading '+f.name+'\u2026';
  try{
    armUndoCapture();
    const text=await f.text();
    const lut=parseCubeLUT(text);
    applyLUT(lut,f.name.replace(/\.cube$/i,''));
    commitUndoCapture();
  }catch(err){
    preChangeSnapshot=null;
    $('lutStatus').textContent='Couldn\u2019t read that LUT ('+err.message+'). Make sure it\u2019s a standard 3D .cube file.';
    $('lutControls').style.display='none';
  }
});
$('lutClear').addEventListener('click',()=>{armUndoCapture();clearLUT();commitUndoCapture();});
