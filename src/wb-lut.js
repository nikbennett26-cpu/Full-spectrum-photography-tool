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
  if ($('btnAddBand')) $('btnAddBand').classList.remove('armed');
  ['btnMaskPick'].forEach(id => { if ($(id)) $(id).classList.remove('armed'); });
}

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
  [swap, swapEd].forEach(el => el.addEventListener('change', () => { showHide(); reapplyCamSpaceSwap(); }));
  showHide();
  sel.addEventListener('change', () => { selEd.value = sel.value; reapplyCamSpaceSwap(); });
  selEd.addEventListener('change', () => { sel.value = selEd.value; reapplyCamSpaceSwap(); });
})();
/* Reads whichever of the two dropdowns actually has a selection \u2014 they're
   kept in sync above, so either one reflects the true current choice.
   Values are 0-100 scale, same as the Channel Swap panel's own MCELLS, so
   /100 here matches exactly how getMatrixUI() converts them. */
function getCamSpaceSwapMatrix() {
  const sel = $('camSpaceSwapPreset') || $('camSpaceSwapPresetEditor');
  if (!sel || sel.value === '') return null;
  const preset = CAM_SPACE_SWAP_PRESETS[+sel.value];
  return preset ? preset.m.map(v => v / 100) : null;
}
function getCamSpaceSwapName() {
  const sel = $('camSpaceSwapPreset') || $('camSpaceSwapPresetEditor');
  if (!sel || sel.value === '') return null;
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
  if (swapSame && rawNrKey() === (rawEngine.builtNr || '0|0|0')) return;
  if (rawNrKey() !== '0|0|0') { rebuildRawPreview(); return; }   // the noise-reduced path, which handles the swap too
  rawNrRun++;   // cancels any noise reduction still running: it is off now
  const cv2 = rawEngineResultToCanvas(rawEngine.lastResult, checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName());
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
}
async function rebuildRawPreview() {
  if (!rawEngine.lastResult || rawEngine.lastGen !== loadToken) return;
  const my = ++rawNrRun, token = loadToken, base = rawEngine.lastResult;
  const v = rawNrValues(), key = rawNrKey();
  const checked = !!($('camSpaceSwap') && $('camSpaceSwap').checked);
  const swapSame = camSwapKey(checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName()) === rawEngine.builtKey;
  let res = base;
  if (rawProcActive(v)) {
    if (!(rawEngine.nrPrev && rawEngine.nrPrev.key === key && rawEngine.nrPrev.gen === token)) {
      setRawNrBusy(true, (v.L > 0 || v.C > 0) ? 'Reducing noise\u2026' : 'Rebuilding highlights\u2026');
      const ds = rawWorkingPlanes(base), wb = rawWbFor(base);
      let out;
      try {
        out = await runRawNr(ds.R, ds.G, ds.B, ds.width, ds.height, { luma: v.L, chroma: v.C, hl: v.HL, wb: wb, clip: rawClipFor(rawEngine.lastResult) },
          p => { if (my === rawNrRun) setRawNrBusy(true, 'Reducing noise\u2026 ' + Math.round(p * 100) + '%'); });
      } catch (e) {
        if (my === rawNrRun) { setRawNrBusy(false, ''); toast('RAW noise reduction failed (' + (e && e.message || e) + ')', true); }
        return;
      }
      if (my !== rawNrRun || token !== loadToken || rawEngine.lastResult !== base) return;   // superseded
      rawEngine.nrPrev = { key: key, gen: token, res: Object.assign({}, base, { R: out.R, G: out.G, B: out.B, width: ds.width, height: ds.height, __wb: wb, __ds: null, __hlDone: !!out.hlDone, __clip: rawClipFor(base) }) };
    }
    res = rawEngine.nrPrev.res;
  }
  if (my !== rawNrRun) return;
  const cv2 = rawEngineResultToCanvas(res, checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName());
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
const FILM_LUT_B64 = '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';
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
    const bin = atob(FILM_LUT_B64);
    const packed = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) packed[i] = bin.charCodeAt(i);
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
  };
}

function applyUserPreset(look) {
  armUndoCapture();
  resetLookBeforeRecipe();
  MCELLS.forEach((id, i) => { const el = $(id); if (el && look.m) el.value = look.m[i]; });
  MOFFCELLS.forEach((id, i) => { const el = $(id); if (el && look.mOff) el.value = look.mOff[i]; });
  mxSync();
  Object.keys(look.sliders || {}).forEach(id => {
    const el = $(id); if (!el) return;
    let pv = look.sliders[id];
    if (!look.tv && LIGHT_TAPER[id]) pv = taperPos(id, pv);   // a preset saved before the weighted sliders
    if (look.tv === 2 && BW_TAPER_V2[id]) pv = bwFromV2(id, pv);
    if (!(look.tv >= 4) && WB_CURVE[id]) pv = wbPos(pv);   // build 190
    el.value = pv;
    const lbl = $('v_' + id); if (lbl) lbl.textContent = fmtSliderValue(id, pv);
  });

  targetedBands = (look.targetedBands || []).map(b => ({...b}));
  bandRenderList();
  filmOn = !!look.filmOn; if ($('filmOn')) $('filmOn').checked = filmOn;
  filmToneOn = !!look.filmToneOn;
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
