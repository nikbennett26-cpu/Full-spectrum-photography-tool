'use strict';
/* irlab editor: js/tone-base.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- Edge-aware base layer for Highlights and Shadows (build 222) ----------
   Highlights and Shadows used to judge each pixel against a ring of neighbours a few pixels away, so a big bright area
   (a sky) was never seen as one region: its edges could glow and its inside was treated pixel by pixel. LightCraft
   (MIT OR Apache-2.0, crates/pipeline/src/local.rs) instead takes a smooth picture of the scene's brightness that stops at
   edges, and lets that decide how much of the tone curve a region gets, while each pixel keeps its own ratio to it. This
   is the same recipe: the self-guided filter of He, Sun and Tang (2010) on the log2 luminance of a small copy of the
   photo, radius about 1.5% of the long edge, epsilon 0.35 EV^2 (so an edge of more than roughly 0.6 stops is kept).
   Done on a copy about 384 px long: the filter's cost depends on that size, not on the photo's, so it takes a few
   milliseconds on a phone, and the result goes to the shader as a small half-float texture that is sampled smoothly at
   full size. Measured on the source (linear light, before any edit); the shader carries it to each pixel's current level.
   Returns { w, h, data } with data = log2 of the base luminance (row 0 at the top, like the source texture), or null. */
const TONE_BASE_EDGE = 384, TONE_BASE_SIGMA = 0.015, TONE_BASE_EPS = 0.35;

function toneBaseBox(src, w, h, r) {
  /* mean over a (2r+1) square window, clamped at the edges (divided by the pixels actually inside), by running sums */
  const out = new Float32Array(w * h), tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w; let sum = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x];
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r);
      tmp[row + x] = sum / (hi - lo + 1);
      if (x + r + 1 < w) sum += src[row + x + r + 1];
      if (x - r >= 0) sum -= src[row + x - r];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r);
      out[y * w + x] = sum / (hi - lo + 1);
      if (y + r + 1 < h) sum += tmp[(y + r + 1) * w + x];
      if (y - r >= 0) sum -= tmp[(y - r) * w + x];
    }
  }
  return out;
}

/* The self-guided filter on one plane: smooths where the neighbourhood is flat (variance below eps) and leaves an edge alone. */
function toneBaseGuided(L, w, h, r, eps) {
  const n = w * h, L2 = new Float32Array(n);
  for (let i = 0; i < n; i++) L2[i] = L[i] * L[i];
  const mean = toneBaseBox(L, w, h, r), corr = toneBaseBox(L2, w, h, r), a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = Math.max(corr[i] - mean[i] * mean[i], 0); a[i] = v / (v + eps); b[i] = mean[i] * (1 - a[i]); }
  const ma = toneBaseBox(a, w, h, r), mb = toneBaseBox(b, w, h, r), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ma[i] * L[i] + mb[i];
  return out;
}

function toneBaseCompute(img) {
  const W = img && img.width, H = img && img.height;
  if (!W || !H) return null;
  const k = Math.min(1, TONE_BASE_EDGE / Math.max(W, H)), w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k)), n = w * h;
  const lum = new Float32Array(n), lf = img.__linearFloat;
  if (lf && lf.length >= W * H * 4) {
    /* a RAW's linear float copy: the real light, headroom above 1.0 included */
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * H / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * H / h));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * W / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * W / w));
        let s = 0, c = 0;
        for (let yy = y0; yy < y1; yy++) { let i = (yy * W + x0) * 4; for (let xx = x0; xx < x1; xx++, i += 4) { s += 0.2126 * lf[i] + 0.7152 * lf[i + 1] + 0.0722 * lf[i + 2]; c++; } }
        lum[y * w + x] = s / c;
      }
    }
  } else {
    /* an 8-bit picture: shrink on a canvas, then decode sRGB to linear light */
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data, lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 255; lut[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    for (let i = 0; i < n; i++) lum[i] = 0.2126 * lut[d[i * 4]] + 0.7152 * lut[d[i * 4 + 1]] + 0.0722 * lut[d[i * 4 + 2]];
  }
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.log2(Math.max(lum[i], 1 / 4096));
  const r = Math.max(2, Math.round(TONE_BASE_SIGMA * Math.max(w, h) * 1.73));   // a box of this radius smooths about as much as a Gaussian of 1.5% of the long edge
  return { w: w, h: h, data: toneBaseGuided(L, w, h, r, TONE_BASE_EPS) };
}
