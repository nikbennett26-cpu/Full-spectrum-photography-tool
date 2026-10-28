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

/* The picture the maps are measured on: linear RGB averaged down to at most TONE_BASE_EDGE px on the long edge. */
function toneProxy(img) {
  const W = img && img.width, H = img && img.height;
  if (!W || !H) return null;
  const k = Math.min(1, TONE_BASE_EDGE / Math.max(W, H)), w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k)), n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), lf = img.__linearFloat;
  if (lf && lf.length >= W * H * 4) {
    /* a RAW's linear float copy: the real light, headroom above 1.0 included */
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * H / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * H / h));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * W / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * W / w));
        let r = 0, g = 0, b = 0, c = 0;
        for (let yy = y0; yy < y1; yy++) { let i = (yy * W + x0) * 4; for (let xx = x0; xx < x1; xx++, i += 4) { r += lf[i]; g += lf[i + 1]; b += lf[i + 2]; c++; } }
        const o = y * w + x; R[o] = r / c; G[o] = g / c; B[o] = b / c;
      }
    }
  } else {
    /* an 8-bit picture: shrink on a canvas, then decode sRGB to linear light */
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data, lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 255; lut[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    for (let i = 0; i < n; i++) { R[i] = lut[d[i * 4]]; G[i] = lut[d[i * 4 + 1]]; B[i] = lut[d[i * 4 + 2]]; }
  }
  return { w: w, h: h, R: R, G: G, B: B };
}

/* log2 of the edge-aware base luminance, for Highlights and Shadows (see the header above). */
function toneBaseFromProxy(pr) {
  const w = pr.w, h = pr.h, n = w * h, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.log2(Math.max(0.2126 * pr.R[i] + 0.7152 * pr.G[i] + 0.0722 * pr.B[i], 1 / 4096));
  const r = Math.max(2, Math.round(TONE_BASE_SIGMA * Math.max(w, h) * 1.73));   // a box of this radius smooths about as much as a Gaussian of 1.5% of the long edge
  return toneBaseGuided(L, w, h, r, TONE_BASE_EPS);
}
function toneBaseCompute(img) { const pr = toneProxy(img); return pr ? { w: pr.w, h: pr.h, data: toneBaseFromProxy(pr) } : null; }

/* ---------- Haze transmission map for Dehaze (build 223) ----------
   Dehaze used to estimate haze from a handful of taps within ten pixels, which cannot tell a hazy sky from a clear one
   beside a dark building. This is the dark channel prior of He, Sun and Tang (CVPR 2009) the way PhotoCraft applies it
   (MIT OR Apache-2.0, crates/algo/src/camera_raw.rs, `dehaze`): the darkest channel in a window is the haze (a clear scene
   has some channel near zero everywhere), measured against the atmospheric light, which is the average colour of the haziest
   0.1% of the picture; the dark channel is then OPENED (a maximum filter after the minimum) so a dark object does not grow
   into the sky beside it and leave a bright halo, and the transmission is refined with a guided filter on the luminance so
   it follows real edges. Measured in encoded (sRGB) values, as Dehaze is applied; returns Float32Array t, 1 = clear, lower =
   hazier, at the proxy's size. Per-channel scale does not matter (each channel is divided by its own atmospheric light), so a
   channel-swapped or unbalanced IR frame is judged on its own terms. */
function toneRankFilter(src, w, h, r, pickMin) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = pickMin ? Infinity : -Infinity;
    for (let xx = Math.max(0, x - r), x1 = Math.min(w - 1, x + r); xx <= x1; xx++) { const q = src[y * w + xx]; if (pickMin ? q < v : q > v) v = q; }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = pickMin ? Infinity : -Infinity;
    for (let yy = Math.max(0, y - r), y1 = Math.min(h - 1, y + r); yy <= y1; yy++) { const q = tmp[yy * w + x]; if (pickMin ? q < v : q > v) v = q; }
    out[y * w + x] = v;
  }
  return out;
}
function toneGuidedPair(I, P, w, h, r, eps) {
  /* the guided filter with a separate guide I (He, Sun, Tang 2010): P smoothed along I's edges */
  const n = w * h, II = new Float32Array(n), IP = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * P[i]; }
  const mI = toneBaseBox(I, w, h, r), mP = toneBaseBox(P, w, h, r), mII = toneBaseBox(II, w, h, r), mIP = toneBaseBox(IP, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { a[i] = (mIP[i] - mI[i] * mP[i]) / (Math.max(mII[i] - mI[i] * mI[i], 0) + eps); b[i] = mP[i] - a[i] * mI[i]; }
  const ma = toneBaseBox(a, w, h, r), mb = toneBaseBox(b, w, h, r), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ma[i] * I[i] + mb[i];
  return out;
}
function dehazeFromProxy(pr) {
  const w = pr.w, h = pr.h, n = w * h, enc = v => { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), minc = new Float32Array(n), luma = new Float32Array(n);
  for (let i = 0; i < n; i++) { R[i] = enc(pr.R[i]); G[i] = enc(pr.G[i]); B[i] = enc(pr.B[i]); minc[i] = Math.min(R[i], G[i], B[i]); luma[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; }
  const r = Math.max(2, Math.round(Math.max(w, h) / 60));
  const dark = toneRankFilter(minc, w, h, r, true);
  /* atmospheric light: the mean colour of the haziest 0.1% (the brightest dark-channel values) */
  const idx = new Int32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
  const sorted = Array.from(idx).sort((p, q) => dark[q] - dark[p]), top = Math.max(1, Math.floor(n / 1000)), air = [0, 0, 0];
  for (let k = 0; k < top; k++) { const i = sorted[k]; air[0] += R[i] / top; air[1] += G[i] / top; air[2] += B[i] / top; }
  for (let c = 0; c < 3; c++) air[c] = Math.max(air[c], 0.2);
  const ratio = new Float32Array(n); for (let i = 0; i < n; i++) ratio[i] = Math.min(R[i] / air[0], G[i] / air[1], B[i] / air[2]);
  const normDark = toneRankFilter(ratio, w, h, r, true), opened = toneRankFilter(normDark, w, h, r, false);
  let mN = 0, mO = 0; for (let i = 0; i < n; i++) { mN += normDark[i]; mO += opened[i]; }
  const weight = 0.95 * (mN / n) / Math.max(mO / n, 1e-6), tRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) tRaw[i] = 1 - weight * opened[i];
  const t = toneGuidedPair(luma, tRaw, w, h, r * 2, 1e-3);
  for (let i = 0; i < n; i++) t[i] = Math.max(0.1, Math.min(1, t[i]));
  return t;
}
