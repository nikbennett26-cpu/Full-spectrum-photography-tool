'use strict';
/* irlab editor: js/raw-process.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- Demosaic choice: AMaZE or RCD (Bayer RAWs) ----------
   One setting behind two selects (home page and the editor's Decode settings). Changing it while a Bayer RAW is
   open decodes that same photo again with the other method and puts every edit back, so the two can be compared
   directly. X-Trans files always use Markesteijn, so nothing is re-decoded for them. */
(function wireDemosaicChoice() {
  const sels = [$('demosaicSel'), $('demosaicSelEd')].filter(Boolean);
  const sync = () => sels.forEach(s => { s.value = demosaicPref(); });
  sync();
  let busy = false;
  async function redecode() {
    if (busy || !document.body.classList.contains('has-image') || !document.body.classList.contains('rawOpen')) return;
    const f = rawEngine.source, last = rawEngine.lastResult;
    if (!f) return;
    if (last && last.cfa && last.cfa[0] === 9) { toast('Fuji X-Trans files always use Markesteijn'); return; }
    busy = true;
    const snap = captureState();
    window.__keepEditsOnLoad = true;
    try { await loadFile(f); } finally { window.__keepEditsOnLoad = false; busy = false; }
    try { applyState(snap); } catch (e) { console.warn('could not restore edits after re-decode', e); }
    toast('Re-decoded with ' + demosaicPrefName());
  }
  window.__redecodeForDemosaic = redecode;
  sels.forEach(s => s.addEventListener('change', () => {
    try { localStorage.setItem('irlab.demosaic', s.value === 'rcd' ? 'rcd' : 'amaze'); } catch (e) {}
    sync();
    redecode();
  }));
})();


/* ---------- GPL-3 RAW sensor decoder (lazy) ----------

   PLAN_0 step 0.7. The bundled libraw-wasm-gpl3 artifact (LibRaw unpack +
   RawTherapee demosaic, GPL-3) is pulled in ONLY when something actually asks
   for real sensor data. Dropping a RAW does NOT fetch ~800 KB of WASM or spin
   up a worker on its own — the app still opens the camera's embedded preview
   (or, for CR2, this tool's own native sensor decoder) for display. The heavy
   decode, when requested, runs in a Web Worker so a full-sensor pass never
   blocks the UI.

   The demosaiced, camera-native LINEAR RGB comes back as three Float32 planes
   (plus CFA / black / white / cam_mul / rgb_cam metadata) and is cached on
   rawEngine.lastResult — the defined hand-off point for PLAN_A Phase 3's
   white-balance / channel-swap work. Nothing in the current preview-based
   pipeline depends on this; it is a purely additive capability.

   As of this port, the qual options beyond 'bilinear' (amaze/lmmse/rcd/igv/
   ahd) still fall back to bilinear inside the WASM artifact itself — the
   RawTherapee ports are scaffolded but not yet wired in on the native side.
   Asking rawEngine for 'amaze' today silently gets bilinear back; that is a
   property of the artifact, not of this hook, and needs no change here when
   the ports land. */
/* ---------- RAW noise reduction: RawTherapee's wavelet denoise (FTblockDN.cc), ported ----------
   A port of the wavelet core of RawTherapee's Noise Reduction (Emil Martinec's FTblockDN.cc, RGB method,
   "standard" quality), with the wavelet transform from RawTherapee's cplx_wavelet_dec / cplx_wavelet_level (both
   GPL-3, compatible with this file's AGPL-3). What it does, as RawTherapee does it:
     1. puts R, G, B on RawTherapee's 0-65535 scale and through its denoise gamma (1.7, with a linear toe);
     2. splits them into luminance L = G' and two colour differences a = R' - G', b = G' - B';
     3. decomposes each with a Daubechies-6 wavelet (first level decimated, deeper levels undecimated Haar);
     4. measures the noise in every band from the data itself (median absolute deviation);
     5. shrinks luminance coefficients by RawTherapee's ShrinkAllL rule and colour coefficients by ShrinkAllAB
        (which also listens to the luminance band, so real colour edges that coincide with real detail survive),
        each shrink map smoothed by a box blur before use, exactly as in the original;
     6. rebuilds, undoes the gamma and returns R, G, B.
   Left out: the DCT block stage ("Detail recovery"), the median filters, noise curves and auto-chroma. They are the
   slowest parts and the least needed here.
   Unlike the original, it runs on the RAW data in white-balanced proportions BEFORE the camera matrix, the channel
   swap and every other colour step, so it works on the noise as the sensor delivered it rather than after the swap
   and saturation have spread and amplified it. Big images are done in overlapping tiles (1024 px, 128 px overlap,
   as RawTherapee does) so memory stays bounded. Every function here is self-contained so the lot can run in a
   Web Worker. */
function rtDnFilters() {
  const lo = [0, 0, 0.235233605, 0.57055846, 0.3251825, -0.09546721, -0.060416105, 0.02490875];   // Daub4_anal8 (Daub6)
  const hi = [-0.02490875, -0.060416105, 0.09546721, 0.3251825, -0.57055846, 0.235233605, 0, 0];
  return { taps: 8, offset: 2, aLo: lo, aHi: hi, sLo: lo.slice().reverse(), sHi: hi.slice().reverse() };
}
function rtWavDecompose(src, W, H, maxlvl) {
  const F = rtDnFilters(), taps = F.taps, off = F.offset, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const levels = []; let cur = src, cw = W, ch = H;
  for (let lvl = 0; lvl < maxlvl; lvl++) {
    const sub = lvl === 0, skip = lvl === 0 ? 1 : (1 << (lvl - 1));   // subsampling = 1: only the first level is decimated
    const w2 = sub ? (cw + 1) >> 1 : cw, h2 = sub ? (ch + 1) >> 1 : ch;
    const dst = new Float32Array(w2 * h2), c1 = new Float32Array(w2 * h2), c2 = new Float32Array(w2 * h2), c3 = new Float32Array(w2 * h2);
    const tLo = new Float32Array(cw), tHi = new Float32Array(cw);
    if (sub) {
      const hidx = new Int32Array(w2 * taps);   // horizontal tap positions, clamped at the edges (RawTherapee's rule)
      for (let i = 0; i < cw; i += 2) for (let j = 0; j < taps; j++) hidx[(i >> 1) * taps + j] = clamp(i + skip * (off - j), 0, cw - 1);
      const a0 = F.aLo[0], a1 = F.aLo[1], a2 = F.aLo[2], a3 = F.aLo[3], a4 = F.aLo[4], a5 = F.aLo[5], a6 = F.aLo[6], a7 = F.aLo[7];
      const b0 = F.aHi[0], b1 = F.aHi[1], b2 = F.aHi[2], b3 = F.aHi[3], b4 = F.aHi[4], b5 = F.aHi[5], b6 = F.aHi[6], b7 = F.aHi[7];
      for (let row = 0; row < ch; row += 2) {
        const r0 = clamp(row + skip * off, 0, ch - 1) * cw, r1 = clamp(row + skip * (off - 1), 0, ch - 1) * cw, r2_ = clamp(row + skip * (off - 2), 0, ch - 1) * cw, r3 = clamp(row + skip * (off - 3), 0, ch - 1) * cw;
        const r4 = clamp(row + skip * (off - 4), 0, ch - 1) * cw, r5 = clamp(row + skip * (off - 5), 0, ch - 1) * cw, r6 = clamp(row + skip * (off - 6), 0, ch - 1) * cw, r7 = clamp(row + skip * (off - 7), 0, ch - 1) * cw;
        for (let k = 0; k < cw; k++) {   // AnalysisFilterSubsampVertical
          const s0 = cur[r0 + k], s1 = cur[r1 + k], s2 = cur[r2_ + k], s3 = cur[r3 + k], s4 = cur[r4 + k], s5 = cur[r5 + k], s6 = cur[r6 + k], s7 = cur[r7 + k];
          tLo[k] = a0 * s0 + a1 * s1 + a2 * s2 + a3 * s3 + a4 * s4 + a5 * s5 + a6 * s6 + a7 * s7;
          tHi[k] = b0 * s0 + b1 * s1 + b2 * s2 + b3 * s3 + b4 * s4 + b5 * s5 + b6 * s6 + b7 * s7;
        }
        const r2 = (row >> 1) * w2;
        for (let o = 0; o < w2; o++) {   // AnalysisFilterSubsampHorizontal, for both halves
          let l1 = 0, h1 = 0, l2 = 0, h2v = 0; const hb = o * taps;
          for (let j = 0; j < taps; j++) { const a = hidx[hb + j], x = tLo[a], y = tHi[a]; l1 += F.aLo[j] * x; h1 += F.aHi[j] * x; l2 += F.aLo[j] * y; h2v += F.aHi[j] * y; }
          dst[r2 + o] = l1; c1[r2 + o] = h1; c2[r2 + o] = l2; c3[r2 + o] = h2v;
        }
      }
    } else {
      for (let row = 0; row < ch; row++) {   // AnalysisFilterHaarVertical
        const o = row < ch - skip ? row + skip : row - skip, b0 = row * cw, b1 = o * cw;
        if (row < ch - skip) { for (let j = 0; j < cw; j++) { tLo[j] = 0.25 * (cur[b0 + j] + cur[b1 + j]); tHi[j] = 0.25 * (cur[b0 + j] - cur[b1 + j]); } }
        else { for (let j = 0; j < cw; j++) { tLo[j] = 0.25 * (cur[b0 + j] + cur[b1 + j]); tHi[j] = 0.25 * (cur[b0 + j] - cur[b1 + j]); } }
        const rb = row * cw;
        for (let i = 0; i < cw - skip; i++) { dst[rb + i] = tLo[i] + tLo[i + skip]; c1[rb + i] = tLo[i] - tLo[i + skip]; c2[rb + i] = tHi[i] + tHi[i + skip]; c3[rb + i] = tHi[i] - tHi[i + skip]; }
        for (let i = Math.max(cw - skip, skip); i < cw; i++) { dst[rb + i] = tLo[i] + tLo[i - skip]; c1[rb + i] = tLo[i] - tLo[i - skip]; c2[rb + i] = tHi[i] + tHi[i - skip]; c3[rb + i] = tHi[i] - tHi[i - skip]; }
      }
    }
    levels.push({ w: cw, h: ch, w2: w2, h2: h2, skip: skip, sub: sub, c: [null, c1, c2, c3] });
    cur = dst; cw = w2; ch = h2;
  }
  return { levels: levels, coeff0: cur };
}
function rtWavReconstruct(dec) {
  const F = rtDnFilters(), taps = F.taps, off = F.offset, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  let c0 = dec.coeff0;
  for (let lvl = dec.levels.length - 1; lvl >= 0; lvl--) {
    const L = dec.levels[lvl], skip = L.skip, c = L.c;
    if (!L.sub) {   // Haar synthesis, horizontal then vertical, in place on the low-pass
      const w = L.w, h = L.h, tLo = new Float32Array(w * h), tHi = new Float32Array(w * h);
      for (let k = 0; k < h; k++) {
        const b = k * w;
        for (let i = 0; i < Math.min(skip, w); i++) { tHi[b + i] = c[2][b + i] + c[3][b + i]; tLo[b + i] = c0[b + i] + c[1][b + i]; }
        for (let i = skip; i < w; i++) {
          tHi[b + i] = 0.5 * (c[2][b + i] + c[3][b + i] + c[2][b + i - skip] - c[3][b + i - skip]);
          tLo[b + i] = 0.5 * (c0[b + i] + c[1][b + i] + c0[b + i - skip] - c[1][b + i - skip]);
        }
      }
      const out = new Float32Array(w * h);
      for (let i = 0; i < Math.min(skip, h); i++) for (let j = 0; j < w; j++) out[i * w + j] = tLo[i * w + j] + tHi[i * w + j];
      for (let i = skip; i < h; i++) { const b = i * w, p = (i - skip) * w; for (let j = 0; j < w; j++) out[b + j] = 0.5 * (tLo[b + j] + tHi[b + j] + tLo[p + j] - tHi[p + j]); }
      c0 = out;
    } else {   // decimated Daubechies synthesis (SynthesisFilterSubsampHorizontal, then ...Vertical with the 4x)
      const sw = L.w2, sh = L.h2, dw = L.w, dh = L.h, shift = skip * (taps - off - 1), half = taps >> 1;
      const tLo = new Float32Array(dw * sh), tHi = new Float32Array(dw * sh);
      // per output column: its four source positions (clamped) and the four filter taps, worked out once
      const hI = new Int32Array(dw * half), hL = new Float32Array(dw * half), hH = new Float32Array(dw * half);
      for (let i = 0; i < dw; i++) {
        const is = (i + shift) >> 1, begin = (i + shift) & 1;
        for (let t = 0, j = begin, l = 0; t < half; t++, j += 2, l += skip) { hI[i * half + t] = clamp(is - l, 0, sw - 1); hL[i * half + t] = F.sLo[j]; hH[i * half + t] = F.sHi[j]; }
      }
      const C1 = c[1], C2 = c[2], C3 = c[3];
      for (let k = 0; k < sh; k++) {
        const sb = k * sw, db = k * dw;
        for (let i = 0, q = 0; i < dw; i++, q += half) {
          let lo = 0, hi = 0;
          for (let t = 0; t < half; t++) {
            const a = sb + hI[q + t], fl = hL[q + t], fh = hH[q + t];
            lo += fl * c0[a] + fh * C1[a];
            hi += fl * C2[a] + fh * C3[a];
          }
          tLo[db + i] = lo; tHi[db + i] = hi;
        }
      }
      const out = new Float32Array(dw * dh);
      for (let i = 0; i < dh; i++) {
        const is = (i + shift) >> 1, begin = (i + shift) & 1, ob = i * dw;
        const r0 = clamp(is, 0, sh - 1) * dw, r1 = clamp(is - skip, 0, sh - 1) * dw, r2 = clamp(is - 2 * skip, 0, sh - 1) * dw, r3 = clamp(is - 3 * skip, 0, sh - 1) * dw;
        const l0 = 4 * F.sLo[begin], l1 = 4 * F.sLo[begin + 2], l2 = 4 * F.sLo[begin + 4], l3 = 4 * F.sLo[begin + 6];
        const h0 = 4 * F.sHi[begin], h1 = 4 * F.sHi[begin + 2], h2 = 4 * F.sHi[begin + 4], h3 = 4 * F.sHi[begin + 6];
        for (let k = 0; k < dw; k++) {
          out[ob + k] = l0 * tLo[r0 + k] + h0 * tHi[r0 + k] + l1 * tLo[r1 + k] + h1 * tHi[r1 + k] + l2 * tLo[r2 + k] + h2 * tHi[r2 + k] + l3 * tLo[r3 + k] + h3 * tHi[r3 + k];
        }
      }
      c0 = out;
    }
  }
  return c0;
}
function rtMadRgb(data, histo) {   // RawTherapee's MadRgb: median absolute deviation from a 65536-bin histogram
  const n = data.length; if (n <= 1) return 0;
  histo.fill(0);
  for (let i = 0; i < n; i++) { let v = data[i]; v = v < 0 ? -v : v; histo[v >= 65535 ? 65535 : v | 0]++; }
  let lmedian = 0, count = 0; const half = n >> 1;
  while (count < half) { count += histo[lmedian]; lmedian++; }
  const count_ = count - histo[lmedian - 1];
  return ((lmedian - 1) + (half - count_) / Math.max(1, count - count_)) / 0.6745;
}
function rtBoxBlur(src, dst, r, W, H) {   // separable box blur, window shrinking at the edges (RawTherapee boxblur)
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const b = y * W; let s = 0, n = 0;
    for (let x = 0; x <= Math.min(r, W - 1); x++) { s += src[b + x]; n++; }
    for (let x = 0; x < W; x++) {
      tmp[b + x] = s / n;
      const add = x + r + 1, rem = x - r;
      if (add < W) { s += src[b + add]; n++; }
      if (rem >= 0) { s -= src[b + rem]; n--; }
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let y = 0; y <= Math.min(r, H - 1); y++) { s += tmp[y * W + x]; n++; }
    for (let y = 0; y < H; y++) {
      dst[y * W + x] = s / n;
      const add = y + r + 1, rem = y - r;
      if (add < H) { s += tmp[add * W + x]; n++; }
      if (rem >= 0) { s -= tmp[rem * W + x]; n--; }
    }
  }
}
function rtDenoiseTile(Rt, Gt, Bt, W0, H0, luma, chroma) {
  const gam = 1.7, thr = 0.001, slope = Math.exp(Math.log(thr) / gam) / thr;   // RawTherapee's denoise gamma and toe
  const igam = 1 / gam, ithr = thr * slope, islope = 1 / slope;
  const fwdX = v => { const x = v / 65535; return (x <= thr ? x * slope : Math.exp(Math.log(x) / gam)) * 32768; };
  const invX = v => { const x = v / 32768; return (x <= ithr ? x * islope : Math.exp(Math.log(x) / igam)) * 65535; };
  const NL = 16384, fL = new Float32Array(NL + 2), iL = new Float32Array(NL + 2);   // tables with linear interpolation
  for (let i = 0; i <= NL + 1; i++) { fL[i] = fwdX(i * 65535 / NL); iL[i] = invX(i * 32768 / NL); }
  const fwd = v => { if (v >= 65535) return fwdX(v); const f = v * (NL / 65535), i = f | 0; return fL[i] + (fL[i + 1] - fL[i]) * (f - i); };
  const inv = v => { if (v >= 32768) return invX(v); const f = v * (NL / 32768), i = f | 0; return iL[i] + (iL[i + 1] - iL[i]) * (f - i); };
  const noisevarL = Math.pow((luma / 125) * (1 + luma / 25), 2);
  let real = chroma / 10; if (real <= 0) real = 0.001;
  const noisevarAB = real * real;
  const doL = noisevarL > 0.00001, doAB = noisevarAB > 0.001;
  let levwav = real < 8 ? 5 : real < 10 ? 6 : real < 15 ? 7 : 8;
  const minside = Math.min(W0, H0); let maxlev2 = 8;
  if (minside < 256) maxlev2 = 7; if (minside < 128) maxlev2 = 6; if (minside < 64) maxlev2 = 5;
  levwav = Math.min(maxlev2, levwav);
  /* Mirror padding wider than the deepest level reaches. The transform's clamped edges do not rebuild exactly when
     there is fine detail (or noise) at a border; with the real pixels kept well inside, every one of them is in the
     part of the transform that rebuilds exactly, and the padding is cropped off again at the end. */
  const P = (1 << levwav) + 24, W = W0 + 2 * P, H = H0 + 2 * P;
  const refl = (i, N) => { if (N === 1) return 0; const period = 2 * N; i = ((i % period) + period) % period; return i < N ? i : period - 1 - i; };
  const n = W * H, Lp = new Float32Array(n), Ap = new Float32Array(n), Bp = new Float32Array(n);
  const xm = new Int32Array(W); for (let x = 0; x < W; x++) xm[x] = refl(x - P, W0);
  for (let y = 0; y < H; y++) {
    const sb = refl(y - P, H0) * W0, db = y * W;
    for (let x = 0; x < W; x++) {
      const si = sb + xm[x];
      const X = fwd(Rt[si] > 0 ? Rt[si] : 0), Y = fwd(Gt[si] > 0 ? Gt[si] : 0), Z = fwd(Bt[si] > 0 ? Bt[si] : 0);
      Lp[db + x] = Y; Ap[db + x] = X - Y; Bp[db + x] = Y - Z;
    }
  }
  const histo = new Int32Array(65536), eps = 0.01;
  const Ld = rtWavDecompose(Lp, W, H, levwav);
  const madL = Ld.levels.map(lv => [0, 1, 2, 3].map(d => d === 0 ? 0 : Math.pow(rtMadRgb(lv.c[d], histo), 2)));
  const shrinkAB = (src) => {   // WaveletDenoiseAllAB -> ShrinkAllAB, every level
    const D = rtWavDecompose(src, W, H, levwav);
    for (let lvl = 0; lvl < D.levels.length; lvl++) {
      const lv = D.levels[lvl], N = lv.w2 * lv.h2, sf = new Float32Array(N), sfd = new Float32Array(N);
      for (let dir = 1; dir < 4; dir++) {
        const cab = lv.c[dir], cL = Ld.levels[lvl].c[dir], madLv = Math.max(1e-9, madL[lvl][dir]);
        const madab = Math.max(1e-9, Math.pow(rtMadRgb(cab, histo), 2) * noisevarAB);
        for (let i = 0; i < N; i++) { const mL = cL[i] * cL[i], mab = cab[i] * cab[i]; sf[i] = 1 - Math.exp(-(mab / madab) - mL / (9 * madLv)); }
        rtBoxBlur(sf, sfd, lvl + 2, lv.w2, lv.h2);
        for (let i = 0; i < N; i++) { const a = sf[i], b = sfd[i]; cab[i] *= (b * b + a * a) / (b + a + eps); }
      }
    }
    return rtWavReconstruct(D);
  };
  const Aout = doAB ? shrinkAB(Ap) : Ap, Bout = doAB ? shrinkAB(Bp) : Bp;
  let Lout = Lp;
  if (doL) {   // WaveletDenoiseAllL -> ShrinkAllL, first five levels
    const maxl = Math.min(Ld.levels.length, 5);
    for (let lvl = 0; lvl < maxl; lvl++) {
      const lv = Ld.levels[lvl], N = lv.w2 * lv.h2, sf = new Float32Array(N), sfd = new Float32Array(N);
      for (let dir = 1; dir < 4; dir++) {
        const cL = lv.c[dir], lf = madL[lvl][dir] * 5 / (lvl + 1), t = Math.max(1e-12, lf * noisevarL);
        for (let i = 0; i < N; i++) { const mag = cL[i] * cL[i]; sf[i] = mag / (mag + t * Math.exp(-mag / (9 * t)) + eps); }
        rtBoxBlur(sf, sfd, lvl + 2, lv.w2, lv.h2);
        for (let i = 0; i < N; i++) { const a = sf[i], b = sfd[i]; cL[i] *= (b * b + a * a) / (b + a + eps); }
      }
    }
    Lout = rtWavReconstruct(Ld);
  }
  const n0 = W0 * H0, Ro = new Float32Array(n0), Go = new Float32Array(n0), Bo = new Float32Array(n0);
  for (let y = 0; y < H0; y++) {
    const sb = (y + P) * W + P, db = y * W0;
    for (let x = 0; x < W0; x++) {
      const i = sb + x, Y = Lout[i], X = Aout[i] + Y, Z = Y - Bout[i];
      Ro[db + x] = X > 0 ? inv(X) : 0; Go[db + x] = Y > 0 ? inv(Y) : 0; Bo[db + x] = Z > 0 ? inv(Z) : 0;
    }
  }
  return [Ro, Go, Bo];
}
/* Whole image: balance by the white-balance gains, scale to 0-65535, denoise tile by tile with overlapping,
   feathered seams (RawTherapee: 1024 px tiles, 128 px overlap), then undo the scale and the balance. */
function rtDenoisePlanes(R, G, B, W, H, opts, onProgress) {
  const luma = +opts.luma || 0, chroma = +opts.chroma || 0, wb = opts.wb || [1, 1, 1];
  const n = W * H, oR = new Float32Array(n), oG = new Float32Array(n), oB = new Float32Array(n), wsum = new Float32Array(n);
  const TS = 1536, OV = 128;   // RawTherapee uses 1024; larger tiles waste less on overlap and padding, memory still bounded
  const tilesX = W <= TS + OV ? 1 : Math.ceil((W - OV) / TS), tilesY = H <= TS + OV ? 1 : Math.ceil((H - OV) / TS);
  const stepX = tilesX > 1 ? Math.ceil((W - OV) / tilesX) : W, stepY = tilesY > 1 ? Math.ceil((H - OV) / tilesY) : H;
  const total = tilesX * tilesY; let done = 0;
  const sR = 65535 * wb[0], sG = 65535 * wb[1], sB = 65535 * wb[2];
  for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
    const x0 = tilesX > 1 ? Math.min(tx * stepX, W - 1) : 0, y0 = tilesY > 1 ? Math.min(ty * stepY, H - 1) : 0;
    const x1 = tilesX > 1 ? (tx === tilesX - 1 ? W : Math.min(W, x0 + stepX + OV)) : W;
    const y1 = tilesY > 1 ? (ty === tilesY - 1 ? H : Math.min(H, y0 + stepY + OV)) : H;
    const tw = x1 - x0, th = y1 - y0, tn = tw * th;
    const Rt = new Float32Array(tn), Gt = new Float32Array(tn), Bt = new Float32Array(tn);
    for (let y = 0; y < th; y++) { const s = (y0 + y) * W + x0, d = y * tw; for (let x = 0; x < tw; x++) { Rt[d + x] = R[s + x] * sR; Gt[d + x] = G[s + x] * sG; Bt[d + x] = B[s + x] * sB; } }
    const out = rtDenoiseTile(Rt, Gt, Bt, tw, th, luma, chroma);
    const ramp = (p, len, lead, trail) => {   // raised-cosine feather across the overlap on edges shared with a neighbour
      let w = 1;
      if (lead && p < OV) w *= 0.5 - 0.5 * Math.cos(Math.PI * (p + 0.5) / OV);
      if (trail && p >= len - OV) w *= 0.5 - 0.5 * Math.cos(Math.PI * (len - p - 0.5) / OV);
      return w;
    };
    for (let y = 0; y < th; y++) {
      const wy = ramp(y, th, ty > 0, ty < tilesY - 1), d = y * tw, s = (y0 + y) * W + x0;
      for (let x = 0; x < tw; x++) {
        const wgt = wy * ramp(x, tw, tx > 0, tx < tilesX - 1);
        oR[s + x] += out[0][d + x] * wgt; oG[s + x] += out[1][d + x] * wgt; oB[s + x] += out[2][d + x] * wgt; wsum[s + x] += wgt;
      }
    }
    done++; if (onProgress) onProgress(done / total);
  }
  for (let i = 0; i < n; i++) { const w = wsum[i] > 1e-6 ? wsum[i] : 1; oR[i] = oR[i] / w / sR; oG[i] = oG[i] / w / sG; oB[i] = oB[i] / w / sB; }
  return { R: oR, G: oG, B: oB };
}

/* ---------- RAW highlight reconstruction: "inpaint opposed" (darktable, as carried in RawTherapee's hilite_recon.cc) ----------
   Where a channel clips, its value is estimated from the two OTHER channels around it: the mean of each channel over
   the 3x3 neighbourhood is taken in a cube-root space, the clipped channel's estimate is the mean of the other two,
   cubed back. A global colour correction is then added, measured from unclipped pixels right next to the clipped
   areas, which keeps reconstructed highlights from drifting toward a cast. Values are only ever raised, never
   lowered, and nothing below the clip threshold changes. Works in white-balanced proportions, with RawTherapee's
   default threshold (0.987 / 1.2 of the sensor's white). One deliberate difference from RawTherapee's port: its
   colour-correction sum compares each unclipped pixel with itself, so it is always zero; darktable's original, which
   this follows, compares it with the opposed estimate for that pixel, as the method describes. */
function rtHlOpposed(R, G, B, W, H, wb, clipLv) {
  // build 192: each channel's measured clip point (rawClipFor); the fixed level assumed every camera clips at 1.0
  const cl = clipLv || [1, 1, 1], clipRaw = 0.987 / 1.2, P = [R, G, B];
  const clips = [clipRaw * cl[0] * wb[0], clipRaw * cl[1] * wb[1], clipRaw * cl[2] * wb[2]];
  const clipdark = [0.03 * clips[0], 0.125 * clips[1], 0.03 * clips[2]];
  let x1 = W, y1 = H, x2 = -1, y2 = -1;
  for (let y = 0; y < H; y++) { const b = y * W; for (let x = 0; x < W; x++) { const i = b + x; if (R[i] >= clipRaw * cl[0] || G[i] >= clipRaw * cl[1] || B[i] >= clipRaw * cl[2]) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; } } }
  if (x2 < 0) return false;
  x1 = Math.max(x1 - 4, 0); x2 = Math.min(x2 + 4, W - 1); y1 = Math.max(y1 - 4, 0); y2 = Math.min(y2 + 4, H - 1);
  const cW = x2 - x1 + 1, cH = y2 - y1 + 1, cN = cW * cH, BD = 8, pw = cW + 2 * BD, ph = cH + 2 * BD, pN = pw * ph;
  const V = [new Float32Array(cN), new Float32Array(cN), new Float32Array(cN)];   // balanced, non-negative
  for (let y = 0; y < cH; y++) for (let x = 0; x < cW; x++) { const si = (y + y1) * W + x + x1, j = y * cW + x; for (let c = 0; c < 3; c++) { const v = P[c][si] * wb[c]; V[c][j] = v > 0 ? v : 0; } }
  // opposed estimate per pixel: cube-root means over 3x3, the other two channels averaged, cubed back
  const ref = [new Float32Array(cN), new Float32Array(cN), new Float32Array(cN)], has = new Uint8Array(cN);
  for (let y = 1; y < cH - 1; y++) for (let x = 1; x < cW - 1; x++) {
    const j = y * cW + x; const m = [0, 0, 0];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = j + dy * cW + dx; m[0] += V[0][k]; m[1] += V[1][k]; m[2] += V[2][k]; }
    const r0 = Math.cbrt(m[0] / 9), r1 = Math.cbrt(m[1] / 9), r2 = Math.cbrt(m[2] / 9);
    const a = 0.5 * (r1 + r2), b = 0.5 * (r0 + r2), c = 0.5 * (r0 + r1);
    ref[0][j] = a * a * a; ref[1][j] = b * b * b; ref[2][j] = c * c * c; has[j] = 1;
  }
  // masks of clipped samples, then dilated (darktable's test_dilate, up to three pixels out)
  const mask = [new Int32Array(pN), new Int32Array(pN), new Int32Array(pN)];
  for (let y = 0; y < cH; y++) for (let x = 0; x < cW; x++) { const j = y * cW + x; if (!has[j]) continue; for (let c = 0; c < 3; c++) if (V[c][j] >= clips[c]) mask[c][(y + BD) * pw + x + BD] = 1; }
  const dil = mask.map(img => {
    const o = new Int32Array(pN), w1 = pw, w2 = 2 * pw, w3 = 3 * pw;
    for (let row = BD; row < ph - BD; row++) for (let col = BD; col < pw - BD; col++) {
      const i = row * pw + col;
      let r = img[i - w1 - 1] | img[i - w1] | img[i - w1 + 1] | img[i - 1] | img[i] | img[i + 1] | img[i + w1 - 1] | img[i + w1] | img[i + w1 + 1];
      if (!r) r = img[i - w2 - 1] | img[i - w2] | img[i - w2 + 1] | img[i - w1 - 2] | img[i - w1 + 2] | img[i - 2] | img[i + 2] | img[i + w1 - 2] | img[i + w1 + 2] | img[i + w2 - 1] | img[i + w2] | img[i + w2 + 1];
      if (!r) r = img[i - w3 - 2] | img[i - w3 - 1] | img[i - w3] | img[i - w3 + 1] | img[i - w3 + 2] | img[i - w2 - 3] | img[i - w2 - 2] | img[i - w2 + 2] | img[i - w2 + 3] | img[i - w1 - 3] | img[i - w1 + 3] | img[i - 3] | img[i + 3] | img[i + w1 - 3] | img[i + w1 + 3] | img[i + w2 - 3] | img[i + w2 - 2] | img[i + w2 + 2] | img[i + w2 + 3] | img[i + w3 - 2] | img[i + w3 - 1] | img[i + w3] | img[i + w3 + 1] | img[i + w3 + 2];
      o[i] = r;
    }
    return o;
  });
  // global colour correction from unclipped pixels next to the clipped areas
  const chroma = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let sum = 0, cnt = 0;
    for (let y = 1; y < cH - 1; y++) for (let x = 1; x < cW - 1; x++) {
      const j = y * cW + x, v = V[c][j];
      if (dil[c][(y + BD) * pw + x + BD] && v > clipdark[c] && v < clips[c]) { sum += v - ref[c][j]; cnt++; }
    }
    chroma[c] = sum / Math.max(1, cnt);
  }
  // raise each clipped sample to its estimate (never lower it), back to camera proportions
  for (let y = 0; y < cH; y++) for (let x = 0; x < cW; x++) {
    const j = y * cW + x; if (!has[j]) continue;
    const si = (y + y1) * W + x + x1;
    for (let c = 0; c < 3; c++) { const v = V[c][j]; if (v >= clips[c]) { const nv = Math.max(v, ref[c][j] + chroma[c]); P[c][si] = nv / wb[c]; } }
  }
  return true;
}
/* Richardson-Lucy deconvolution (build 227): sharpening that undoes the lens-and-demosaic blur, instead of boosting edges.
   The blur is modelled as a Gaussian of `deconvSigma` pixels and RL's own iteration (est = est x (PSF-flipped * (data /
   (PSF * est)))) works it backwards, which gives back real fine detail where unsharp masking only adds contrast at edges.
   The idea and the automatic blur radius come from ART (GPL-3.0, src/engine/deconvautoradius.cc and RawTherapee's capture
   sharpening). It runs on the brightness only (0.25 R + 0.5 G + 0.25 B, in camera space, before white balance) and carries
   the result to the three channels as a gain, so no colour fringes appear. RL also amplifies noise, so the change is faded
   in only where the local contrast stands clearly above the frame's own noise, and faded out toward clipped highlights, where
   it would ring. A small offset (0.003) keeps the ratios steady in the dark. Returns new planes; the inputs are not changed. */
function rtDeconvPlanes(R, G, B, W, H, opts, onProgress) {
  const n = W * H, amt = Math.max(0, Math.min(1, (+opts.deconv || 0) / 100)), sigma = Math.max(0.3, +opts.deconvSigma || 0.8);
  const iters = Math.max(4, Math.min(40, (opts.deconvIter | 0) || 12)), EPS = 0.003;
  const rad = Math.max(1, Math.ceil(sigma * 3)), K = new Float32Array(2 * rad + 1); let ks = 0;
  for (let i = -rad; i <= rad; i++) { K[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma)); ks += K[i + rad]; }
  for (let i = 0; i < K.length; i++) K[i] /= ks;
  const tmp = new Float32Array(n);
  const blur = (src, dst) => {   // separable, edge pixels repeated
    for (let y = 0; y < H; y++) {
      const b = y * W;
      for (let x = 0; x < W; x++) {
        let a = 0;
        if (x >= rad && x < W - rad) { for (let k = -rad; k <= rad; k++) a += K[k + rad] * src[b + x + k]; }
        else { for (let k = -rad; k <= rad; k++) { let q = x + k; q = q < 0 ? 0 : q >= W ? W - 1 : q; a += K[k + rad] * src[b + q]; } }
        tmp[b + x] = a;
      }
    }
    for (let y = 0; y < H; y++) {
      const interior = y >= rad && y < H - rad, b = y * W;
      for (let x = 0; x < W; x++) {
        let a = 0;
        if (interior) { for (let k = -rad; k <= rad; k++) a += K[k + rad] * tmp[b + k * W + x]; }
        else { for (let k = -rad; k <= rad; k++) { let q = y + k; q = q < 0 ? 0 : q >= H ? H - 1 : q; a += K[k + rad] * tmp[q * W + x]; } }
        dst[b + x] = a;
      }
    }
  };
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.25 * R[i] + 0.5 * G[i] + 0.25 * B[i] + EPS;
  const est = Float32Array.from(L), bl = new Float32Array(n), q = new Float32Array(n);
  for (let it = 0; it < iters; it++) {
    blur(est, bl);
    for (let i = 0; i < n; i++) q[i] = L[i] / (bl[i] > 1e-6 ? bl[i] : 1e-6);
    blur(q, bl);
    for (let i = 0; i < n; i++) { const v = est[i] * bl[i]; est[i] = v > 8 ? 8 : v; }
    if (onProgress) onProgress((it + 1) / (iters + 1));
  }
  // where to apply it: local contrast against the frame's own noise
  blur(L, bl);
  const d = new Float32Array(n), step = Math.max(1, Math.floor(Math.sqrt(n / 30000))), sm = [];
  for (let i = 0; i < n; i++) d[i] = Math.abs(L[i] - bl[i]);
  for (let y = 2; y < H - 2; y += step) for (let x = 2; x < W - 2; x += step) sm.push(d[y * W + x]);
  sm.sort((a, b) => a - b);
  const sn = Math.max(1e-4, 1.4826 * sm[sm.length >> 1]);
  blur(d, q);   // q = local contrast, d smoothed over the same radius
  const iR = opts.clip && isFinite(1 / opts.clip[0]) ? 1 / opts.clip[0] : 1, iG = opts.clip && isFinite(1 / opts.clip[1]) ? 1 / opts.clip[1] : 1, iB = opts.clip && isFinite(1 / opts.clip[2]) ? 1 / opts.clip[2] : 1;
  const oR = new Float32Array(n), oG = new Float32Array(n), oB = new Float32Array(n), ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) {
    const w = ss(2.5 * sn, 8 * sn, q[i]) * (1 - ss(0.8, 0.97, Math.max(R[i] * iR, G[i] * iG, B[i] * iB)));
    let g = 1 + amt * w * ((est[i] / L[i]) - 1);
    g = g < 0.5 ? 0.5 : g > 2 ? 2 : g;
    oR[i] = R[i] * g; oG[i] = G[i] * g; oB[i] = B[i] * g;
  }
  if (onProgress) onProgress(1);
  return { R: oR, G: oG, B: oB };
}
/* The RAW steps the worker runs, in RawTherapee's order: highlights first, then noise reduction, then (build 227) deconvolution. */
function rtProcessPlanes(R, G, B, W, H, opts, onProgress) {
  let hlDone = false;
  const dec = (+opts.deconv || 0) > 0, part = dec ? 0.6 : 1;
  if (opts.hl === 1) { R = R.slice(); G = G.slice(); B = B.slice(); rtHlOpposed(R, G, B, W, H, opts.wb || [1, 1, 1], opts.clip); hlDone = true; }
  if ((+opts.luma || 0) > 0 || (+opts.chroma || 0) > 0) { const o = rtDenoisePlanes(R, G, B, W, H, opts, onProgress ? (p => onProgress(p * part)) : null); R = o.R; G = o.G; B = o.B; }
  else if (onProgress) onProgress(part);
  if (dec) { const o = rtDeconvPlanes(R, G, B, W, H, opts, onProgress ? (p => onProgress(0.6 + 0.4 * p)) : null); R = o.R; G = o.G; B = o.B; }
  else if (onProgress) onProgress(1);
  return { R: R, G: G, B: B, hlDone: hlDone };
}

/* Runs the denoise in a Web Worker built from the functions above, so the page stays responsive; the input planes
   are copied (the originals stay intact for re-use) and the results transferred back. Falls back to running on the
   page if a worker cannot be made. */
const RAWNR_FUNCS = [rtDnFilters, rtWavDecompose, rtWavReconstruct, rtMadRgb, rtBoxBlur, rtDenoiseTile, rtDenoisePlanes, rtHlOpposed, rtDeconvPlanes, rtProcessPlanes];
let rawNrWorkerUrl = null;
function runRawNr(R, G, B, W, H, opts, onProgress) {
  return new Promise((resolve, reject) => {
    let wk = null;
    try {
      if (!rawNrWorkerUrl) {
        const src = RAWNR_FUNCS.map(f => f.toString()).join('\n') +
          '\nself.onmessage = e => { const d = e.data; try { const o = rtProcessPlanes(d.R, d.G, d.B, d.W, d.H, d.opts, p => self.postMessage({ progress: p })); self.postMessage({ done: true, R: o.R, G: o.G, B: o.B, hlDone: o.hlDone }, [o.R.buffer, o.G.buffer, o.B.buffer]); } catch (err) { self.postMessage({ error: String(err && err.message || err) }); } };';
        rawNrWorkerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      }
      wk = new Worker(rawNrWorkerUrl);
    } catch (e) { wk = null; }
    if (!wk) {   // no worker: do it here, after letting the page show the busy state
      setTimeout(() => { try { resolve(rtProcessPlanes(R, G, B, W, H, opts, onProgress)); } catch (e) { reject(e); } }, 30);
      return;
    }
    wk.onmessage = e => {
      const d = e.data || {};
      if (d.progress !== undefined) { if (onProgress) onProgress(d.progress); return; }
      wk.terminate();
      if (d.error) reject(new Error(d.error)); else resolve({ R: d.R, G: d.G, B: d.B, hlDone: !!d.hlDone });
    };
    wk.onerror = e => { wk.terminate(); reject(new Error((e && e.message) || 'noise reduction worker failed')); };
    const r = R.slice(), g = G.slice(), b = B.slice();
    wk.postMessage({ R: r, G: g, B: b, W: W, H: H, opts: opts }, [r.buffer, g.buffer, b.buffer]);
  });
}
function rawNrValues() {
  const l = $('rawNrL'), c = $('rawNrC'), h = $('rawHl'), da = $('rawDeconv'), dr = $('rawDeconvR'), au = $('rawDeconvAuto');
  return { L: l ? +l.value || 0 : 0, C: c ? +c.value || 0 : 0, HL: h ? (+h.value === 1 ? 1 : 0) : 0,
    DA: da ? +da.value || 0 : 0, DR: dr ? +dr.value || 12 : 12, DAuto: au ? (+au.value === 1 ? 1 : 0) : 1 };
}
function rawNrKey() { const v = rawNrValues(); return v.L + '|' + v.C + '|' + v.HL + (v.DA > 0 ? '|d' + v.DA + '|' + (v.DAuto ? 'a' : v.DR) : ''); }
function rawProcActive(v) { return v.L > 0 || v.C > 0 || v.HL === 1 || v.DA > 0; }
/* The same box-filter downscale rawEngineResultToCanvas does to reach the working size, done once per decode and
   kept, so the denoise runs at preview size and the canvas built from its result is pixel-for-pixel the same size. */
function rawWorkingPlanes(res) {
  if (res.__ds) return res.__ds;
  const srcW = res.width, srcH = res.height, R = res.R, G = res.G, B = res.B;
  const scale = Math.min(1, WORKING_MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale)), h = Math.max(1, Math.round(srcH * scale)), box = 1 / scale;
  if (scale === 1) { res.__ds = { R: R, G: G, B: B, width: w, height: h }; return res.__ds; }
  const oR = new Float32Array(w * h), oG = new Float32Array(w * h), oB = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * box), sy1 = Math.min(srcH, Math.max(sy0 + 1, Math.ceil((y + 1) * box)));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * box), sx1 = Math.min(srcW, Math.max(sx0 + 1, Math.ceil((x + 1) * box)));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let yy = sy0; yy < sy1; yy++) { const rb = yy * srcW; for (let xx = sx0; xx < sx1; xx++) { const si = rb + xx; sr += R[si]; sg += G[si]; sb += B[si]; n++; } }
      const q = y * w + x; oR[q] = sr / n; oG[q] = sg / n; oB[q] = sb / n;
    }
  }
  res.__ds = { R: oR, G: oG, B: oB, width: w, height: h };
  return res.__ds;
}
/* Build 192: where each channel really clips, measured from the file. The decoder scales the data by the white level the
   camera's metadata gives, but some bodies record good data well above it: a Canon 1200D file states 14274 and fills to
   16383, so its highlights ran to about 1.17 on this scale and everything from 0.96 up was being treated as clipped,
   while the real clip, where values pile up on a plateau, sat higher. A channel that never piles up is not clipped and
   gets Infinity. Measured once per decode, on a sample of the full planes. */
function rawClipFor(res) {
  if (res.__clip) return res.__clip;
  const n = res.R.length, stride = Math.max(1, Math.floor(n / 400000)), BIN = 0.0025, LO = 0.5, NB = Math.ceil(2.5 / BIN);
  res.__clip = [res.R, res.G, res.B].map(P => {
    const h = new Uint32Array(NB); let cnt = 0;
    for (let i = 0; i < n; i += stride) { cnt++; const v = P[i]; if (v >= LO && v < LO + NB * BIN) h[((v - LO) / BIN) | 0]++; }
    let best = -1, bc = 0;
    for (let b = Math.ceil((0.9 - LO) / BIN); b < NB; b++) if (h[b] > bc) { bc = h[b]; best = b; }
    if (best < 0 || bc < Math.max(20, cnt * 0.002)) return Infinity;
    let below = 0, nb = 0; for (let b = best - 40; b < best - 8; b++) if (b >= 0) { below += h[b]; nb++; }
    if (nb && bc < 5 * (below / nb)) return Infinity;   // no plateau: a smooth falloff of bright pixels, not a clip
    return LO + best * BIN;
  });
  return res.__clip;
}
/* Build 192: which white balance a RAW opens with. 'camera' (the default) is the one set in the camera, the same one its
   JPEG uses; on a converted body that is usually a custom white balance taken through the filter, and it is what the
   photographer expects to see. 'auto' is the estimate from the picture (Cheng, Prasad and Brown's eigenvector method),
   which is made for daylight colour photos: on a UV or IR frame it can land far from anything sensible (red x1.58, blue
   x0.29 on a UV frame whose camera setting was red x0.93, blue x0.33), which tinted the frame and pushed its sky past
   white. Either way the before-swap grey picker still overrides it. */
function rawWbMode() { try { return localStorage.getItem('irlab.rawWb') === 'auto' ? 'auto' : 'camera'; } catch (e) { return 'camera'; } }
function rawWbCompute(res) {
  if (typeof rawWbCustom !== 'undefined' && rawWbCustom) {   // build 197: Temperature + Green set on the RAW (src/raw-wb.js)
    const g = rawWbCustom.wb ? rawWbCustom.wb.slice() : rtwbGains(res, rawWbCustom.t, rawWbCustom.g);   // a pick keeps its exact multipliers
    if (g) return { wb: g, source: 'custom' };
  }
  const cam = pp_wbGain(res.camMul), camOk = res.camMul && res.camMul.length >= 3 && res.camMul[0] > 0 && res.camMul[1] > 0 && res.camMul[2] > 0;
  if (rawWbMode() === 'camera' && camOk) return { wb: cam, source: 'camera' };
  const e = chengPCAGains(res.R, res.G, res.B);
  if (e[0] === 1 && e[1] === 1 && e[2] === 1) return { wb: cam, source: 'camera meter' };
  return { wb: e, source: 'eigenvector' };
}
function rawWbFor(res) {   // the white balance rawEngineResultToCanvas applies, computed once per decode
  // the decode's own result is recomputed when the choice changes; copies made for noise reduction or export carry the
  // white balance they were built with (no __wbKey) and keep it
  if (!res.__wb || (res.__wbKey !== undefined && res.__wbKey !== rawWbKey())) { const w = rawWbCompute(res); res.__wb = w.wb; res.__wbSrc = w.source; res.__wbKey = rawWbKey(); }
  return res.__wb;
}

const rawEngine = (function () {
  let clientP = null;      // memoised dynamic import of the worker client
  let sourceFile = null;   // the RAW File the app currently has open

  function supported() {
    return typeof Worker === 'function' && typeof WebAssembly === 'object';
  }
  function loadClient() {
    if (!clientP) clientP = import(new URL('libraw-wasm-gpl3/glue/libraw-gpl3.client.mjs', document.baseURI).href)   /* resolved against the page: import() in a script file is relative to the script */;
    return clientP;
  }

  return {
    supported,
    lastResult: null,
    // Recorded by loadFile() when a RAW is opened, so demosaic() can act on
    // the file already in hand without a second file picker.
    setSource(file) { sourceFile = file || null; },
    get source() { return sourceFile; },

    /* Decode + demosaic a RAW to camera-native linear RGB. Defaults to the
       file the app currently has open. qual is any supported method:
       'bilinear' | 'amaze' | 'lmmse' | 'dcb' | 'dht' | 'rcd' | 'igv' | 'ahd'.

       Disposes the worker after every call, success or failure. WASM linear
       memory only ever grows \u2014 it has no mechanism to shrink back down once
       allocated \u2014 so a worker kept alive across multiple large RAW decodes
       accumulates memory for the rest of the tab's life with no way back.
       On a phone, that is a very plausible explanation for "works for the
       first file or two, then everything stops working, including plain
       JPEGs": the tab as a whole runs low on memory, not just this decode
       path. The client module lazily respawns a fresh worker on the next
       call regardless, so this costs a little startup time per RAW rather
       than accumulating it. */
    async demosaic(qual = 'amaze', file = sourceFile) {
      if (!supported()) throw new Error('this browser lacks Web Worker / WebAssembly support');
      if (!file) throw new Error('no RAW file is currently open to decode');
      const { demosaicRawInWorker, disposeWorker } = await loadClient();
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        const res = await demosaicRawInWorker(bytes, qual);
        this.lastResult = res;
        this.lastGen = loadToken;   // which photo it belongs to: nothing may rebuild a later photo from it
        this.nrPrev = null;
        if (typeof document !== 'undefined') document.body.classList.add('rawOpen');
        return res;
      } finally {
        if (typeof disposeWorker === 'function') disposeWorker();
      }
    },
  };
})();
if (typeof window !== 'undefined') window.rawEngine = rawEngine;

/* ---------- TIFF reader ----------
   Browsers cannot decode TIFF natively, which is the only reason this is
   hand-written. The point is to accept the standard interchange file that
   every raw developer exports — full resolution and full bit depth — rather
   than the ~2048px JPEG preview buried inside a RAW.

   Handles what raw converters actually emit: 8/16-bit, RGB or greyscale,
   contiguous or planar, uncompressed / Deflate / LZW, single or multi-strip.
   Deliberately does NOT handle tiled TIFFs or JPEG-in-TIFF — rare from a raw
   developer, and it reports them clearly rather than producing garbage. */
function tiffDecode(buf){
  const dv=new DataView(buf), u8=new Uint8Array(buf);
  const bo=String.fromCharCode(u8[0],u8[1]);
  if(bo!=='II'&&bo!=='MM') throw new Error('not a TIFF');
  const LE=bo==='II';
  if(dv.getUint16(2,LE)!==42) throw new Error('not a TIFF (bad magic)');
  const g16=o=>dv.getUint16(o,LE), g32=o=>dv.getUint32(o,LE);

  let ifd=g32(4);
  const T={};
  const n=g16(ifd);
  for(let i=0;i<n;i++){
    const e=ifd+2+i*12, tag=g16(e), type=g16(e+2), cnt=g32(e+4);
    const sz={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8}[type]||1;
    const total=sz*cnt;
    const off= total<=4 ? e+8 : g32(e+8);
    const rd=k=>type===3?g16(off+k*2):type===4?g32(off+k*4):u8[off+k];
    T[tag]= cnt===1 ? rd(0) : Array.from({length:Math.min(cnt,8)},(_,k)=>rd(k));
    if(cnt>1) T[tag+'_all']=Array.from({length:cnt},(_,k)=>rd(k));
  }
  const w=T[256], h=T[257];
  const bits=Array.isArray(T[258])?T[258][0]:(T[258]||8);
  const comp=T[259]||1;
  const spp=T[277]||1;
  const planar=T[284]||1;
  if(T[322]) throw new Error('tiled TIFFs are not supported — re-export as strips');
  if(comp===6||comp===7) throw new Error('JPEG-compressed TIFF is not supported — re-export uncompressed, LZW or ZIP');
  if(bits!==8&&bits!==16) throw new Error(bits+'-bit TIFF is not supported — use 8 or 16');
  const offs=T[273+'_all']||[T[273]], counts=T[279+'_all']||[T[279]];
  const rps=T[278]||h;
  return {w,h,bits,comp,spp,planar,offs,counts,rps,LE,u8,
          predictor:T[317]||1, photometric:T[262]};
}

/* LZW as TIFF specifies it: variable code width 9..12, early change, and
   codes emitted MSB-first. Written out rather than pulled from a library
   because it is only ~40 lines and this is the one compression a raw
   developer is likely to pick that the browser cannot do for us. */
function lzwDecode(src){
  const out=[];
  let dict=[], dictSize=258, codeLen=9, prev=null;
  const reset=()=>{dict=[];for(let i=0;i<256;i++)dict[i]=[i];dictSize=258;codeLen=9;prev=null;};
  reset();
  let bitPos=0;
  const readCode=()=>{
    let v=0;
    for(let i=0;i<codeLen;i++){
      const byte=src[bitPos>>3];
      if(byte===undefined) return 257;
      v=(v<<1)|((byte>>(7-(bitPos&7)))&1);
      bitPos++;
    }
    return v;
  };
  for(;;){
    const code=readCode();
    if(code===257) break;
    if(code===256){ reset(); continue; }
    let entry;
    if(dict[code]) entry=dict[code];
    else if(prev) entry=prev.concat([prev[0]]);
    else break;
    out.push(...entry);
    if(prev) dict[dictSize++]=prev.concat([entry[0]]);
    prev=entry;
    if(dictSize+1>=(1<<codeLen) && codeLen<12) codeLen++;   // early change
  }
  return new Uint8Array(out);
}

async function tiffToCanvas(buf){
  const t=tiffDecode(buf);
  const {w,h,bits,comp,spp,offs,counts,rps,LE,u8}=t;
  const bytesPer=bits/8;
  const rowBytes=w*spp*bytesPer;
  const full=new Uint8Array(h*rowBytes);
  let written=0;
  for(let s=0;s<offs.length;s++){
    const raw=u8.subarray(offs[s], offs[s]+counts[s]);
    let dec;
    if(comp===1) dec=raw;
    else if(comp===5) dec=lzwDecode(raw);
    else if(comp===8||comp===32946){
      // Deflate via the browser's own decompressor — no library needed
      const ds=new DecompressionStream('deflate');
      const ab=await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
      dec=new Uint8Array(ab);
    } else throw new Error('TIFF compression '+comp+' is not supported');
    full.set(dec.subarray(0, Math.min(dec.length, full.length-written)), written);
    written+=dec.length;
  }
  /* Horizontal differencing predictor (tag 317 = 2). LZW and ZIP TIFFs from
     raw developers very often use it, and skipping it does not fail loudly —
     it produces a smeared image, so it has to be undone explicitly. */
  if(t.predictor===2){
    for(let y=0;y<h;y++){
      const ro=y*rowBytes;
      if(bits===8){
        for(let x=spp;x<w*spp;x++) full[ro+x]=(full[ro+x]+full[ro+x-spp])&0xFF;
      } else {
        const dvv=new DataView(full.buffer,full.byteOffset+ro,rowBytes);
        for(let x=spp;x<w*spp;x++){
          const cur=dvv.getUint16(x*2,LE), pre=dvv.getUint16((x-spp)*2,LE);
          dvv.setUint16(x*2,(cur+pre)&0xFFFF,LE);
        }
      }
    }
  }
  // to 8-bit RGBA for the canvas; 16-bit is scaled down, not truncated
  const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx=cv.getContext('2d');
  const img=ctx.createImageData(w,h);
  const d=img.data;
  const dvF=new DataView(full.buffer, full.byteOffset, full.byteLength);
  for(let i=0;i<w*h;i++){
    let r,g,b;
    if(bits===8){
      const o=i*spp;
      r=full[o]; g=spp>1?full[o+1]:r; b=spp>2?full[o+2]:r;
    } else {
      const o=i*spp*2;
      r=dvF.getUint16(o,LE)>>8;
      g=spp>1?dvF.getUint16(o+2,LE)>>8:r;
      b=spp>2?dvF.getUint16(o+4,LE)>>8:r;
    }
    const q=i*4; d[q]=r; d[q+1]=g; d[q+2]=b; d[q+3]=255;
  }
  ctx.putImageData(img,0,0);
  return cv;
}

const TIFF_EXT = ['TIF','TIFF'];

/* Guards against two loads running at once. A CR2 decode takes many seconds
   and deliberately yields to keep the UI alive, which means a second file can
   be picked while the first is still going. Both then race to write the same
   globals — src, camCoef, the working canvas, the engine's textures — and
   whichever finishes last wins piecemeal, so the picture, the fit and the
   readouts can end up describing different files. Worse, the older load can
   finish AFTER the newer one and quietly overwrite it, which reads as
   "nothing happened when I picked a new file".

   Each load takes a ticket. After every await it checks whether a newer load
   has started and bails out if so, leaving the newest one to finish alone. */
let loadToken = 0;

/* A plain `new Promise(r => cv.toBlob(r, 'image/png'))` has no failure
   path at all: if toBlob never calls its callback — seen on some browsers
   under memory pressure with a very large canvas, which a full-sensor
   decode produces (tens of megapixels, PNG at that size is a real
   memory spike) — the await just hangs forever with no error, no toast
   update, nothing in the console. That reads as "it decoded, said
   preparing image, then nothing happened", because from the outside a
   silent hang and a silent early-return look identical.

   Downscales to WORKING_MAX_DIM before encoding, not just after timing
   out: this tool's own native CR2 decoder (cr2ToCanvas) builds a full-
   sensor-resolution canvas exactly the same way the AMaZE path did before
   that got fixed — the earlier fix only touched the AMaZE side, so the
   native decoder was still funnelling a full-size canvas through the same
   unprotected encode. One fix here covers every caller instead of one
   path at a time. drawImage's own downscale is the browser's native,
   hardware-accelerated resize — far cheaper than re-decoding smaller. */
function canvasToBlobSafe(cv, label, timeoutMs = 30000, allowFullRes = false) {
  let src = cv;
  const longEdge = Math.max(cv.width, cv.height);
  if (!allowFullRes && typeof WORKING_MAX_DIM === 'number' && longEdge > WORKING_MAX_DIM) {
    const scale = WORKING_MAX_DIM / longEdge;
    const w = Math.max(1, Math.round(cv.width * scale)), h = Math.max(1, Math.round(cv.height * scale));
    const small = document.createElement('canvas');
    small.width = w; small.height = h;
    small.getContext('2d').drawImage(cv, 0, 0, w, h);
    console.info(label + ': downscaled ' + cv.width + '\u00d7' + cv.height + ' \u2192 ' + w + '\u00d7' + h + ' before encoding');
    src = small;
  }
  console.info(label + ': encoding ' + src.width + '\u00d7' + src.height +
               ' (' + ((src.width * src.height) / 1e6).toFixed(1) + ' MP) to PNG\u2026');
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(label + ': toBlob did not complete within ' + (timeoutMs / 1000) + 's \u2014 likely out of memory at this resolution'));
    }, timeoutMs);
    src.toBlob(blob => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (blob) resolve(blob);
      else reject(new Error(label + ': toBlob returned null (canvas may be tainted or exceed this browser\u2019s max canvas size)'));
    }, 'image/png');
  });
}

/* body.imgLoading is on for as long as a photo is being opened, so the home page's file slot can show work happening. */
async function loadFile(file) {
  if (!file) return;
  // build 210: a RAW opened before any decode option was picked asks how to decode it first (src/decode-tip.js)
  if (typeof decodeTipAsk === 'function' && !(await decodeTipAsk(file))) return;
  document.body.classList.add('imgLoading');
  try { return await loadFileInner(file); }
  finally { document.body.classList.remove('imgLoading'); }
}
async function loadFileInner(file) {
  const myToken = ++loadToken;
  const stale = () => myToken !== loadToken;
  if (RAW_EXT.includes((file.name.split('.').pop() || '').toUpperCase())) rawProgStart(0, file.name);   // build 156
  /* Build 150: take the bytes into memory now, once. On Android a picked File is only a reference to the provider's
     content, and that permission can lapse later (after the app goes to the background, or simply a while after the
     pick). Every later read then threw NotReadableError: the full-sensor decode after the preview, a re-decode when a
     setting changed, and the copy saved for session restore, which then failed on the next visit ("RAW sensor decode
     failed ... permission problems", falling back to the preview). Reading it straight away and working from the copy
     makes all of those independent of the provider. Done after the token bump, which restoreSession() relies on
     happening synchronously. */
  try {
    file = new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified });
  } catch (e) {
    if (stale()) return;
    rawProgEnd();
    if (sessionRestoring) {
      idbPut('image', null);   // a saved photo that can no longer be read will not become readable; stop offering it
      toast('The saved photo can no longer be read on this device — open it again to carry on');
    } else {
      rawProgEnd(); alert('This file could not be read (' + (e.name || 'error') + '). The phone may have withdrawn access to it — pick it again from the file picker.');
    }
    return;
  }
  if (stale()) return;
  /* A new photo: the previous RAW's cached sensor data must go. It used to stay, and every Undo, Reset or preset
     re-applied the camera-space swap from it, replacing a JPEG opened afterwards with the previous RAW (in the new
     photo's orientation). A RAW decoded below caches its own. */
  rawEngine.lastResult = null; rawEngine.lastGen = -1; rawEngine.builtKey = null; rawWbCustom = null; rawWbDrag = null; rawWbBuilt = null; rawEngine.fullKey = null; rawEngine.nrPrev = null; rawEngine.builtNr = '0|0|0'; rawEngine.autoWb = false;
  { const fx = $('rawFix'), fc = $('rawFixChk'); if (fx) fx.value = '1'; if (fc) fc.checked = true; if ($('rawFixStatus')) $('rawFixStatus').textContent = ''; }   // build 225: a new photo starts without the cleanup
  document.body.classList.remove('rawOpen');
  LAST_LINEAR_FLOAT = null;   // belongs to the previous photo; a RAW decoded below parks its own

  /* RAW files are resolved to their embedded camera preview before anything
     else touches them. Everything downstream — the working canvas, the
     original-resolution export path, the EXIF copy — then operates on an
     ordinary JPEG and needs no knowledge that a RAW was ever involved. */
  let src = file;
  // 1 for ordinary images: browsers already rotate those from their own EXIF
  let exifOrient = 1;
  /* Cleared per load, before the format branches below decide anything: a
     fit belongs to one specific file, and leaving the previous one armed
     would apply one image's camera rendering to a different photo. */
  camCoef = null;
  if ($('camMatchRow')) $('camMatchRow').style.display = 'none';
  if ($('camMatch')) { $('camMatch').checked = false; $('camMatch').disabled = false; }
  /* Everything below used to be three narrow, separate fixes (the matrix
     cells, then a preset's own button-highlight and hue, added once each
     was separately found leaking into a fresh photo -- Before/After
     disagreeing right after load, then a previous "H.H. 1978" recipe
     still visibly colouring an untouched new file). Once camMatch above
     is included, that's most of a full reset already, piece by piece,
     which is exactly the sign it should just be one: "Apply previous
     settings to next photo" (off by default) is the actual answer --
     fresh photo, fresh start, unless the user deliberately asks to carry
     a look across a shoot, which resetAllControls() itself is also what
     "Reset all" runs. White balance is included here too, unlike those
     three earlier fixes, since a bare RAW load establishes its own
     correct auto-WB moments after this runs regardless (finishLoad, a
     few lines down) -- there's no carried-over WB left for this to
     clobber the way there would be resetting it mid-session. */
  if (!($('applyPreviousSettings') && $('applyPreviousSettings').checked) && !window.__keepEditsOnLoad) {
    resetAllControls();
  }
  let ext = (file.name.split('.').pop() || '').toUpperCase();
  /* Some Android providers hand back a generic name ("image", "content", or
     no extension at all) even when the bytes are a CR2. Extension is the only
     routing signal here, so such a file would skip the RAW branches entirely
     and be handed to the browser as an ordinary image, which cannot decode it
     — surfacing much later as an unhelpful "couldn't read that file". The
     first bytes settle it: every CR2/NEF/ARW/DNG is a TIFF-rooted container
     starting II*\0 or MM\0*, and Canon writes "CR" at offset 8. */
  try {
    const known = RAW_EXT.includes(ext) || TIFF_EXT.includes(ext) ||
                  ['JPG','JPEG','PNG','WEBP','AVIF','GIF','BMP'].includes(ext);
    if (!known) {
      const h = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const tiffish = (h[0]===0x49 && h[1]===0x49 && h[2]===0x2A && h[3]===0x00) ||
                      (h[0]===0x4D && h[1]===0x4D && h[2]===0x00 && h[3]===0x2A);
      if (tiffish) {
        const t = new Uint8Array(await file.slice(8, 10).arrayBuffer());
        ext = (t[0]===0x43 && t[1]===0x52) ? 'CR2' : 'TIF';
        console.info('File had no usable extension; identified as', ext, 'from its header');
      }
    }
  } catch (e) { /* unreadable header: carry on with the name alone */ }
  /* TIFF first: it is the format a raw developer exports, so this is the
     route to full resolution and full bit depth without the ~2048px JPEG
     preview a RAW hands over. Decoded to a canvas and then converted to a
     PNG blob, so everything downstream — working canvas, full-size export,
     session restore — keeps treating it as an ordinary lossless image and
     needs no knowledge that a TIFF was involved. */
  if (TIFF_EXT.includes(ext)) {
    // Already-developed pixel data, not a sensor mosaic — nothing for the
    // RAW decoder to act on, same as an ordinary JPEG/PNG.
    rawEngine.setSource(null);
    toast('Reading TIFF\u2026');
    let cv = null;
    try { cv = await tiffToCanvas(await file.arrayBuffer()); }
    catch (e) {
      rawProgEnd(); alert('This TIFF could not be read.\n\n' + e.message + '\n\nRe-export as uncompressed, LZW or ZIP, 8 or 16-bit, untiled.');
      return;
    }
    if (stale()) return;
    try {
      src = await canvasToBlobSafe(cv, 'TIFF');
    } catch (e) {
      console.error(e);
      rawProgEnd(); alert('The TIFF could not be prepared \u2014 ' + e.message);
      return;
    }
    if (stale()) return;
    toast('Loaded TIFF \u2014 ' + cv.width + '\u00d7' + cv.height + ' (full resolution)');
    setDecoderBadge('TIFF \u2014 already developed', false);
  } else if (CR2_EXT.includes(ext)) {
    /* CR2 goes to the real sensor decoder, not the embedded-preview path,
       unless the tick box on the intro screen asked for the preview
       specifically — a deliberate choice to skip the ~15s decode and get
       the camera's own processed colour straight away, not a failure path.
       When it's not checked, tried first so a Canon raw never falls
       through to the JPEG preview it also contains; if the decode fails
       for any reason the catch below drops back to that preview rather
       than refusing the file outright — verified against a Canon 6D file,
       but other CR2-shaped bodies vary. */
    const preferPreview = $('cr2PreferPreview') && $('cr2PreferPreview').checked;
    // A genuine camera RAW either way this branch goes — hand it to the
    // lazy GPL-3 decoder so rawEngine.demosaic() has something to act on
    // later, independent of which display path (native decode or embedded
    // preview) this particular load ends up taking.
    rawEngine.setSource(file);
    /* Shown for every CR2, whatever happens next. The fit needs the sensor
       decode, so it genuinely cannot be offered on the preview path — but
       hiding the control in that case is indistinguishable from the feature
       not existing, which is exactly how it read. It now always appears and
       says which of the two it is. */
    if ($('camMatchRow')) $('camMatchRow').style.display = '';
    const camFail = (why) => {
      camCoef = null;
      if ($('camMatch')) { $('camMatch').checked = false; $('camMatch').disabled = true; }
      if ($('camMatchNote')) $('camMatchNote').textContent = why;
    };
    camFail('Needs the raw sensor decode \u2014 it learns the colour by comparing that against the camera\u2019s JPEG, so there is nothing to compare on the preview path.');
    let cv = null, amazeErr = null, res = null;
    /* AMaZE (via LibRaw + RawTherapee) is now the only real-sensor-decode
       path \u2014 this tool's own from-scratch bilinear decoder (cr2ToCanvas)
       is no longer called from here. No longer gated behind a checkbox
       either: the only real choice left for CR2 is preview vs real decode,
       and "real decode" now unconditionally means AMaZE. cr2ToCanvas
       itself is left defined but unused rather than deleted outright \u2014
       still reachable if this ever needs reverting, costs nothing sitting
       idle. */
    console.info('CR2 decoder decision: preferPreview=' + preferPreview +
                 ' rawEngine.supported()=' + rawEngine.supported() +
                 ' \u2192 will attempt AMaZE: ' + (!preferPreview && rawEngine.supported()));
    if (!preferPreview && rawEngine.supported()) {
      rawProgStart(1, demosaicPrefName());
      await new Promise(r => setTimeout(r, 30));
      try {
        // res was previously `const`, block-scoped to just this try —
        // out of scope by the time the background full-res IIFE further
        // down tried to read it (a plain ReferenceError, confirmed via a
        // real toast on a real device), which is exactly why every CR2
        // export and Expand silently fell back to working size. Assigning
        // the outer-scoped `res` declared above instead of shadowing it
        // here is the fix -- same value, now actually reachable later.
        res = await rawEngine.demosaic(demosaicPref(), file);
        if (stale()) {
          console.warn('AMaZE: load went stale after demosaic() resolved \u2014 a newer load started while this one was decoding, so this result was discarded.');
          return;
        }
        rawProgStart(2);
        cv = rawEngineResultToCanvas(res, $('camSpaceSwap') && $('camSpaceSwap').checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName());
      } catch (e) {
        console.warn('AMaZE decode failed:', e);
        amazeErr = e && e.message ? e.message : String(e);
        cv = null;
      }
    } else if (!preferPreview && !rawEngine.supported()) {
      amazeErr = 'this browser lacks Web Worker / WebAssembly support';
    }
    if (!cv && amazeErr) {
      // A toast here gets overwritten by the embedded-preview path's own
      // status update a fraction of a second later regardless of any
      // duration setting \u2014 an alert can't be silently stomped on the same
      // way, and stays up until it's actually dismissed.
      rawProgEnd(); alert('RAW sensor decode failed for this file:\n\n' + amazeErr + '\n\nFalling back to the embedded preview now.');
    }
    if (cv) {
      /* A raw sensor decode arrives badly unbalanced and it is not a small
         effect: behind an IR filter the blue channel receives a fraction of
         what red and green do \u2014 measured on a real frame, a neutral road
         reads (112, 95, 47). Every channel-mix preset in this tool assumes
         balanced input, so on an unbalanced decode they all produce the wrong
         colour: the film presets came out gold instead of pink, and no amount
         of adjusting them fixed it because the fault was upstream. With a
         neutral set first the same preset puts foliage at hue 348 and sky at
         208, which is Aerochrome.

         So the decode now balances itself, the way any raw converter does.
         Grey-world on the middle of the histogram: the brightest and darkest
         eighth are excluded because specular highlights and black shadows are
         not neutral references, and the result is clamped by the same
         spread limit the manual picker uses. It is a starting point, not a
         verdict \u2014 the WB picker still overrides it completely.

         Skipped entirely when rawEngineResultToCanvas already applied LibRaw's
         own measured camera matrix and as-shot white balance \u2014 running a
         generic grey-world guess ON TOP of real per-camera calibration would
         be strictly worse than the calibration alone, not a refinement of it. */
      if (!cv.__hasCameraWB) autoWhiteBalanceRaw(cv);
      toast('Loaded CR2 sensor data \u2014 ' + cv.width + '\u00d7' + cv.height +
            (cv.__hasCameraWB ? ' (' + (cv.__demosaicName || demosaicPrefName()) + ', camera-matrix developed' + (cv.__camSpaceSwapApplied ? ', ' + cv.__camSpaceSwapName + ' in ProPhoto)' : ')') : ' (' + (cv.__demosaicName || demosaicPrefName()) + ', auto white balanced)'));
      setDecoderBadge((cv.__demosaicName || demosaicPrefName()) + ' (WASM, GPL-3)', true);
      renderRawPlaneReport(cv.__rawReport);
      /* Both halves of the file are in hand right here — the sensor decode
         just produced, and the camera's own JPEG of the same frame — which
         is the only moment they can be matched against each other. Fitted
         now and kept for the session; the toggle decides whether it is
         applied, so nothing changes for anyone who leaves it off. */
      /* Fast path from here: cv is already a fully-decoded, correctly-sized
         canvas (AMaZE or this tool's own native decoder \u2014 both qualify) with
         real pixels sitting in it right now. The old code encoded it to a
         PNG here, then immediately decoded that PNG again via an Image
         element just to get it on screen \u2014 compress, then decompress, pure
         round-trip cost for an image that was already perfectly drawable.
         finishLoad() accepts a canvas directly and does its own resize via
         drawImage, so none of that encode/decode pair is needed for what
         you actually see.

         origFile/session-restore still need a real blob eventually \u2014
         "export at original resolution" and "restore last session" both
         need a real file to hand back later \u2014 that still happens, in the
         same non-blocking background task as before, which now also feeds
         saveSessionImage once it succeeds rather than needing a second,
         separate blob just for that. */
      const decoderLabel = cv.__demosaicName || 'native';
      const savedName = file.name.replace(/\.[^.]+$/, '') + '_preview.jpg';
      const camFit = async () => {
        try {
          const found = await extractPreview(file);
          if (!found || !found.blob) {
            camFail('Unavailable for this file \u2014 no embedded camera JPEG was found inside it to learn the colour from.');
          } else {
            toast('Matching camera colour\u2026');
            await new Promise(r => setTimeout(r, 0));
            const fit = await fitCameraColour(cv, found.blob);
            if (stale()) return;
            if (fit) {
              camCoef = fit.coef;
              if ($('camMatch')) $('camMatch').disabled = false;
              if ($('camMatchNote')) $('camMatchNote').textContent =
                'Fitted from this file \u2014 average error ' + fit.rmse.toFixed(1) + '/255 against the camera\u2019s own JPEG.';
            } else {
              camFail('Unavailable for this file \u2014 too few usable pixels in common between the sensor data and the camera\u2019s JPEG to fit a reliable mapping.');
            }
          }
        } catch (e) {
          console.warn('Camera-colour fit skipped:', e);
          camFail('Unavailable for this file \u2014 the camera\u2019s JPEG could not be read (' + e.message + ').');
        }
      };
      const buildFull = async () => {
        try {
          /* cv above is deliberately capped at WORKING_MAX_DIM (see the
             comment on rawEngineResultToCanvas itself) -- reusing it here
             was the actual bug: this blob was labelled "full-res" but was
             really the same capped canvas the live preview already had,
             so origW/origH ended up equal to the preview size and the
             export resolution choice silently never appeared. Re-running
             the decode with forceFullRes=true is the only way to get a
             genuine full-resolution canvas -- the initial downscale point-
             samples straight into a smaller buffer, so there is no detail
             left in cv to recover by upscaling it back up. This does mean
             decoding twice per load rather than once, but it happens here,
             in the background, after the fast capped preview is already on
             screen -- the same place this "best effort" work already ran,
             just actually producing what it claimed to. */
          const fullCv = rawEngineResultToCanvas(res, $('camSpaceSwap') && $('camSpaceSwap').checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName(), true);
          rawEngine.fullKey = camSwapKey(!!($('camSpaceSwap') && $('camSpaceSwap').checked), getCamSpaceSwapMatrix(), getCamSpaceSwapName()) + '|' + rawWbKey();   // which swap the saved full-size copy has
          const fullBlob = await canvasToBlobSafe(fullCv, 'CR2 (' + decoderLabel + ', full-res)', 45000, true);
          if (stale()) return;
          origFile = fullBlob; origW = fullCv.width; origH = fullCv.height;
          if (typeof updateExportResOptions === 'function') updateExportResOptions();
          /* renderFullscreenHQ bails out immediately if origFile isn't set
             yet (nothing to render at higher quality) and never retries on
             its own -- opening "Expand" before this background decode
             finishes left the fullscreen view permanently stuck on its
             working-resolution placeholder, even minutes later, since
             nothing ever told it origFile had since arrived. If Expand is
             open right now, this is that missed retry. */
          if ($('previewFullscreen') && $('previewFullscreen').classList.contains('on') && typeof renderFullscreenHQ === 'function') renderFullscreenHQ();
        } catch (e) {
          // Was console.warn only -- invisible to an actual user, so this
          // failure mode (real resolution never becomes available, working
          // size silently stands in for it everywhere, forever, for this
          // load) looked identical to a working-as-designed cap. A toast
          // costs nothing when this never fires; it's the only way to
          // actually confirm or rule out this exact failure the next time
          // it's suspected, rather than guessing again.
          console.warn('Full-resolution encode skipped \u2014 export at original resolution and session restore will be unavailable for this load:', e);
          toast('Full-resolution version failed to build (' + (e && e.message ? e.message : 'see console') + ') \u2014 export and Expand will use working size only for this photo');
        }
      };
      /* Build 152: the photo goes on screen first. The camera-colour fit and the full-resolution copy used to run
         before it: the fit was awaited, and the full-size canvas (21 MP on a 5D Mk II) was built synchronously at the
         start of what was meant to be a background task. On a phone that added tens of seconds to every RAW. Both
         now start once the working-size picture is showing. Session restore keeps the original RAW instead of a
         21 MP PNG, which was the slowest single step and lossy in nothing but time: restoring re-decodes it. */
      saveSessionImage(file, file.name);   // so a discarded tab can be recovered
      await finishLoad(cv, cv.width, cv.height, rawFlipToExif(res && res.flip), null, savedName);   // upright, as the camera recorded it
      if (typeof rawNrAuto === 'function' && !stale()) rawNrAuto();   // build 226: RAW noise reduction starts on (src/controls.js)
      // full-size copy first (export at original size and Expand wait on it), then the camera-colour fit
      setTimeout(async () => { if (stale()) return; await buildFull(); if (stale()) return; await camFit(); }, 60);
      return;
    } else {
      let found = null, prevErr = null;
      try { found = await extractPreview(file); } catch (e) { prevErr = e && e.message ? e.message : String(e); }
      if (!found) {
        /* Both routes failed, which is worth separating from either failing
           alone: the sensor decoder is fussy about which bodies it knows, but
           EVERY CR2 carries a JPEG preview, so failing to find one too points
           at the file rather than at the decoder — most often a part-downloaded
           copy from a cloud folder, which has a valid header and no image data
           further in. Reporting both reasons is what makes that separable
           instead of a dead end. */
        const parts = [];
        if (amazeErr) parts.push('Sensor decode: ' + amazeErr);
        if (prevErr) parts.push('Preview search: ' + prevErr);
        else parts.push('Preview search: no embedded JPEG found');
        rawProgEnd(); alert('This CR2 could not be opened.\n\n' + parts.join('\n') +
              '\n\nFile size: ' + (file.size/1048576).toFixed(1) + ' MB' +
              '\n\nIf that size looks short for a raw file, it is probably only part-downloaded \u2014 open it once in a file manager, or re-download it, and try again.');
        return;
      }
      src = found.blob; exifOrient = found.orient || 1;
      /* The preview's colour was stored at a quarter of its brightness
         resolution; rebuild it before anything downstream sees the pixels,
         since the swap and the saturation stages are exactly what turn the
         leftover 2x2 blocks into visible streaks. Best-effort: if anything
         here fails the original blob is still in `src` and the load carries
         on as it did before. */
      if (found.subsampled) {
        try {
          toast('Rebuilding preview colour\u2026');
          await new Promise(r => setTimeout(r, 0));
          const bmp = await createImageBitmap(found.blob);
          const cvc = document.createElement('canvas');
          cvc.width = bmp.width; cvc.height = bmp.height;
          cvc.getContext('2d').drawImage(bmp, 0, 0);
          reconstructChroma(cvc, frac => {
            toast('Rebuilding preview colour\u2026 ' + Math.round(frac * 100) + '%');
          });
          src = await new Promise(r => cvc.toBlob(r, 'image/png'));
          if (stale()) return;
          /* Build 234: this used to set the orientation to "upright as drawn", on the belief that drawing the bitmap had
             already turned it. It had not: a RAW's embedded preview is a bare JPEG with no orientation of its own (the
             camera's lives in the RAW header, readTiffOrientation), so nothing rotated it and portrait or upside-down
             frames opened turned. Only a preview that carries its own EXIF orientation is turned by the browser. */
          if (await jpegOwnOrientation(found.blob) > 1) exifOrient = 1;
        } catch (e) {
          console.warn('Chroma reconstruction failed, using the preview as-is:', e);
        }
      }
      toast(preferPreview
        ? 'Loaded CR2 embedded preview \u2014 ' + found.w + '\u00d7' + found.h + ' (camera rendering, not raw sensor data)'
        : 'CR2 sensor decode failed \u2014 using the embedded preview instead');
      setDecoderBadge('Camera preview (not sensor data)', false);
      renderRawPlaneReport(found.rawPlane);
    }
  } else if (RAW_EXT.includes(ext)) {
    // A real camera RAW that only has this tool's generic preview-extraction
    // path (no native sensor decoder like CR2 has) — still exactly the kind
    // of file rawEngine.demosaic() exists for.
    rawEngine.setSource(file);
    const preferPreview = $('cr2PreferPreview') && $('cr2PreferPreview').checked;
    let decodedQuality = false;
    if (!preferPreview && rawEngine.supported()) {
      rawProgStart(1, demosaicPrefName());
      await new Promise(r => setTimeout(r, 30));   // let the toast paint first
      try {
        const res = await rawEngine.demosaic(demosaicPref(), file);
        if (stale()) {
          console.warn(ext + ' AMaZE: load went stale after demosaic() resolved \u2014 a newer load started while this one was decoding, so this result was discarded.');
          return;
        }
        rawProgStart(2);
        const cv = rawEngineResultToCanvas(res, $('camSpaceSwap') && $('camSpaceSwap').checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName());
        if (stale()) return;
        // Same reasoning as the CR2 sensor path: a raw demosaic arrives
        // unbalanced (no white balance applied), so it needs the same
        // self-balancing step before anything downstream sees it \u2014 unless
        // rawEngineResultToCanvas already applied LibRaw's own measured
        // camera matrix, in which case a generic grey-world guess on top
        // would only make real calibration worse.
        if (!cv.__hasCameraWB) autoWhiteBalanceRaw(cv);
        toast('Loaded ' + ext + ' sensor data \u2014 ' + cv.width + '\u00d7' + cv.height +
              (cv.__hasCameraWB ? ' (' + (cv.__demosaicName || demosaicPrefName()) + ', camera-matrix developed' + (cv.__camSpaceSwapApplied ? ', ' + cv.__camSpaceSwapName + ' in ProPhoto)' : ')') : ' (' + (cv.__demosaicName || demosaicPrefName()) + ', auto white balanced)'));
        setDecoderBadge((cv.__demosaicName || demosaicPrefName()) + ' (WASM, GPL-3)', true);
        renderRawPlaneReport(cv.__rawReport);
        /* Fast path, same reasoning as the CR2 branch: cv already has real
           pixels in it, so finishLoad() can draw it directly \u2014 no PNG
           encode/decode round trip just to get it on screen. origFile and
           session-restore are still handled, in the same non-blocking
           background task as before. */
        const savedName = file.name.replace(/\.[^.]+$/, '') + '_preview.jpg';
        const buildFull = async () => {
          try {
            // Same fix, same reasoning as the CR2 branch above: cv is
            // capped at WORKING_MAX_DIM, so reusing it here was the actual
            // bug this RAF report traced back to -- re-decode once more
            // with forceFullRes=true to get a genuine full-resolution
            // canvas instead of mislabelling the already-capped one.
            const fullCv = rawEngineResultToCanvas(res, $('camSpaceSwap') && $('camSpaceSwap').checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName(), true);
          rawEngine.fullKey = camSwapKey(!!($('camSpaceSwap') && $('camSpaceSwap').checked), getCamSpaceSwapMatrix(), getCamSpaceSwapName()) + '|' + rawWbKey();   // which swap the saved full-size copy has
            const fullBlob = await canvasToBlobSafe(fullCv, ext + ' (' + (fullCv.__demosaicName || demosaicPrefName()) + ', full-res)', 45000, true);
            if (stale()) return;
            origFile = fullBlob; origW = fullCv.width; origH = fullCv.height;
            if (typeof updateExportResOptions === 'function') updateExportResOptions();
            // Same retry-trigger as the CR2 branch above -- see its comment
            // for why this is needed: renderFullscreenHQ never retries on
            // its own once origFile finally arrives.
            if ($('previewFullscreen') && $('previewFullscreen').classList.contains('on') && typeof renderFullscreenHQ === 'function') renderFullscreenHQ();
          } catch (e) {
            // Same reasoning as the CR2 branch above -- see its comment.
            console.warn('Full-resolution encode skipped \u2014 export at original resolution and session restore will be unavailable for this load:', e);
            toast('Full-resolution version failed to build (' + (e && e.message ? e.message : 'see console') + ') \u2014 export and Expand will use working size only for this photo');
          }
        };
        saveSessionImage(file, file.name);   // build 152: the original RAW, not a full-size PNG (see the CR2 branch)
        await finishLoad(cv, cv.width, cv.height, rawFlipToExif(res && res.flip), null, savedName);   // upright, as the camera recorded it
      if (typeof rawNrAuto === 'function' && !stale()) rawNrAuto();   // build 226: RAW noise reduction starts on (src/controls.js)
        setTimeout(() => { if (!stale()) buildFull(); }, 60);
        return;
      } catch (e) {
        // Falls through to the embedded-preview path below, same as CR2's
        // sensor decode failing does \u2014 a failed quality decode should not
        // refuse the file outright when a perfectly usable preview exists.
        const msg = e && e.message ? e.message : String(e);
        console.warn('rawEngine quality decode failed, falling back to embedded preview:', e);
        // Same reasoning as the CR2 path: a toast here gets overwritten by
        // the very next status update a moment later regardless of any
        // duration setting, and (unlike the CR2 case) this one wasn't even
        // including the actual error text before.
        rawProgEnd(); alert('RAW sensor decode failed for this ' + ext + ':\n\n' + msg + '\n\nFalling back to the embedded preview now.');
      }
    }
    if (!decodedQuality) {
      if (preferPreview) toast('Reading ' + ext + ' preview\u2026');
      let found = null;
      try { found = await extractPreview(file); } catch (e) { found = null; }
      if (!found) {
        rawProgEnd(); alert(ext + " opened, but no usable preview image was found inside it.\n\nSome bodies only embed a small thumbnail, and a few formats store it in a way this can't reach. Export a JPEG from Lightroom instead.");
        return;
      }
      src = found.blob;
      exifOrient = found.orient || 1;
      toast('Loaded ' + ext + ' preview \u2014 ' + found.w + '\u00d7' + found.h + ' (camera rendering, not raw sensor data)');
      setDecoderBadge('Camera preview (not sensor data)', false);
      renderRawPlaneReport(found.rawPlane);
    }
  } else {
    if ($('rawPlanePanel')) $('rawPlanePanel').style.display = 'none';   // an ordinary JPEG/PNG has no sensor plane to report on
    setDecoderBadge(null);   // not a RAW load at all, nothing to mark
    // Not a RAW at all (or a TIFF, already-developed pixel data rather than
    // a mosaic) — nothing for the decoder to act on.
    rawEngine.setSource(null);
  }

  const img = new Image();
  /* Shared by every load path, not just the img.onload one below: takes
     whatever source is already decoded and ready to draw \u2014 an Image
     element from the normal load flow, OR (new) a Canvas straight from
     rawEngineResultToCanvas for the AMaZE fast path, which needs the exact
     same undo/redo/origFile/EXIF/render bookkeeping without first paying
     for a PNG encode + decode round trip it doesn't need just to get pixels
     that are already sitting in a canvas onto the screen. drawImage() works
     with either source type identically, which is what makes sharing this
     safe rather than a special case. */
  async function finishLoad(source, natW, natH, orientHint, sessionBlob, sessionName) {
    if (stale()) return;
    /* A new photo starts with every tool folded shut (build 229). The dock layouts open a panel with its tab, so there only the groups inside are folded. */
    try { const dock = document.documentElement.classList.contains('dockOn') || document.documentElement.classList.contains('studioOn');
      document.querySelectorAll(dock ? 'details.dGrp' : 'details.stepPanel, details.dGrp').forEach(d => { if (d.id !== 'resPanel' && d.id !== 'fmtGrp' && d.id !== 'exportSection') d.open = false; }); } catch (e) {}
    undoStack = []; redoStack = []; preChangeSnapshot = null; undoBmps = []; redoBmps = []; preChangeBmp = null; refSource = undefined;
    if (typeof updateUndoButton === 'function') updateUndoButton();
    /* The interactive WB panel's own state (preWBM) is otherwise completely
       unaware that rawEngineResultToCanvas already computed and baked in a
       real white balance for this photo \u2014 without resetting it here, a
       fresh load would keep showing whatever a PREVIOUS photo's manual
       eyedropper pick left preWBM at, or the old "Auto \u2714 (Bradford)" label
       from a pass that did not actually run for this load. Resets to
       IDENTITY specifically, not to this photo's own wb value: wb is
       already correctly baked into the canvas above (before the matrix,
       the standard order), and copying the same value in here too was
       the actual double-correction bug \u2014 "After" started from an
       already-wb'd canvas and then multiplied wb in a second time on
       top, roughly squaring it with no visible cause ("the eigenvector
       correction doubled up", per Phil). The status text below still
       reports what ran, for the WB panel and the IMPLICIT stamp \u2014
       informing the user is correct; re-applying the number behind
       their back is what was wrong. */
    if (source && source.__hasCameraWB && source.__wbGains) {
      preWBM = IDENTITY3;
      if ($('wbPreStatus')) $('wbPreStatus').textContent = source.__wbSource === 'eigenvector'
        ? 'Auto \u2714 (estimated) \u2014 pick a neutral to override it'
        : 'Camera \u2714 (as shot) \u2014 pick a neutral to override it';
      /* No automatic Vibrance push on load, deliberately -- an earlier
         flat 20% default oversaturated ordinary, well-separated RAW
         files; a later adaptive version (measuring each photo's actual
         chromaticity variance) fixed that specific case, but Vibrance is
         designed to weight its boost toward pixels that are STILL MUTED
         (see the tool's own note under the slider) -- so even a small,
         well-reasoned nonzero default still produced a large, visible
         shift concentrated in naturally muted areas (an overcast sky,
         confirmed directly on a real photo: sky went from grey-green to
         vivid blue/purple at only 12% while the already-colourful
         foreground barely moved). Any nonzero default, however
         carefully computed, breaks the actual requirement -- Before and
         After must be pixel-identical until the user makes a real edit.
         Left at the input's own HTML default (0) instead. A photo that
         genuinely needs a vibrance push (confirmed useful earlier this
         session on a genuinely colour-starved full-spectrum capture)
         still gets one -- the user applies it themselves, same as any
         other creative choice on this screen. */
    }
    const maxDim = WORKING_MAX_DIM;
    let w = natW, h = natH;
    origFile = sessionBlob; origW = natW; origH = natH;
    if (sessionBlob) saveSessionImage(sessionBlob, sessionName);   // so a discarded tab can be recovered
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    sourceImg = source;
    srcOrient = orientHint;
    drawOriented(rawCanvas, source, w, h, srcOrient);
    carryLinearFloat(rawCanvas, source, srcOrient);
    w = rawCanvas.width; h = rawCanvas.height;   // a quarter turn swaps them
    loadedImage = rawCanvas;
    rawPixels = rawCtx.getImageData(0, 0, w, h).data;
    contrastPivot = medianLuminance(rawPixels);

    exifSegment = null;
    extractExifFromFile(file).then(seg => { exifSegment = seg; });

    $('emptyStateGroup').style.display = 'none';
    $('main').classList.add('on');
    document.body.classList.add('has-image'); applyZoom();;
    /* Built here rather than at parse time: the strip measures panel
       positions for its scroll-spy, and those are all zero while #main is
       still display:none. Defaults are captured in the same call, before the
       user can touch anything. */
    if (typeof buildStepStrip === 'function') requestAnimationFrame(buildStepStrip);

    try {
      if (!engine) engine = new WebGLEngine($('preview'));
      engine.setImage(dustPrepare(rawCanvas));
      engine.setLUT(currentLUT); engine.setLUTPre(preLUTUser || decodeFilmLUT());
      updatePrecisionNote();
      buildChannelStrip();
      zoom = 1; panX = panY = 0; applyZoom();
      $('holdHint').textContent = 'hold to compare';
      $('holdHint').classList.add('on');
      setTimeout(() => { if (!holding) $('holdHint').classList.remove('on'); }, 2600);

      initFloatingPreview();
      setupCompareOverlay();
      updateExportResOptions();
      render();
      rawProgEnd();
      // a look opened from a shared link lands on the first photo (src/share.js); a session restore applies it itself
      if (typeof applyPendingLook === 'function' && !sessionRestoring) setTimeout(applyPendingLook, 0);
    } catch (err) {
      rawProgEnd();
      showLoadError(err);
    }
  }

  img.onload = async () => {
    // was only revoked in onerror, so every successfully loaded image leaked
    // its blob URL for the lifetime of the tab
    URL.revokeObjectURL(img.src);
    /* Save under a name matching what the blob actually IS, not what it came
       from. For a RAW load, src is the extracted JPEG — storing it as
       "IMG_1234.CR2" meant the restore saw a .CR2 extension and tried to
       extract a preview from a file that was already a plain JPEG, which
       failed with "no usable preview image was found inside it". */
    const savedName = (src === file) ? file.name
      : file.name.replace(/\.[^.]+$/, '') + '_preview.jpg';
    await finishLoad(img, img.width, img.height, exifOrient, src, savedName);
  };
  // Browsers can only decode what they natively support — JPEG, PNG, WEBP and
  // (mostly) AVIF. They CANNOT decode TIFF or camera RAW, so a 16-bit TIFF
  // exported from Lightroom will fail here. Without this handler that failure
  // was completely silent: tapping a TIFF simply did nothing, with no clue why.
  img.onerror = () => {
    URL.revokeObjectURL(img.src);
    const ext = (file.name.split('.').pop() || '').toUpperCase();
    const known = ['TIF','TIFF','HEIC','HEIF'];
    if (known.includes(ext)) {
      rawProgEnd(); alert(ext + " files can't be opened directly — web browsers have no decoder for them.\n\nExport as JPEG or PNG instead (16-bit TIFF is still available for EXPORTING from this tool, just not for loading).");
    } else {
      rawProgEnd(); alert("Couldn't read that file — it may be corrupt or in a format this browser can't decode. Try JPEG or PNG.");
    }
  };
  img.src = URL.createObjectURL(src);
}

/* The picker firing with nothing attached is not always a cancel. On Android
   a chooser can hand back a URI the input's accept filter then rejects, or a
   provider (Photos, Drive, some file managers) can return a stub with no
   readable bytes — the event fires, files is empty or the file is 0 bytes,
   and loadFile's `if (!file) return` swallowed it. From the outside that is
   indistinguishable from the app ignoring the tap, which is exactly how it
   was reported. Say something instead, and name the workaround that gets
   round a provider that will not hand the file over. */
function pickedFile(e, fn) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;                       // a real cancel: the user chose nothing
  if (f.size === 0) {
    rawProgEnd(); alert("That file came back empty.\n\nThis usually means the app you picked from (Google Photos, Drive, or a cloud folder) handed over a placeholder rather than the file itself \u2014 often because it is not downloaded to the device yet.\n\nTry picking it from Files/Downloads instead, or download it locally first.");
    return;
  }
  fn(f);
}
/* Last-resort net for anything that throws where nobody is listening.
   Several of this tool's async entry points are deliberately fire-and-forget
   — a paste, a drop, a session restore, a background save — and a rejection
   inside one of those goes nowhere at all: no console line the user can see,
   no message, the app simply does not do the thing. That failure mode has
   cost real debugging time on this project more than once, and on a phone
   there is no devtools to fall back on. This makes it visible.

   Deliberately quiet about it: a short toast, not an alert, because some of
   what lands here is harmless (an aborted fetch, a decode of a file the user
   already replaced) and blocking the interface for those would be worse than
   the silence. The full detail goes to the console for anyone who can read
   it. */
(function () {
  let lastMsg = '', lastAt = 0;
  const report = (what, detail) => {
    const msg = String(detail && detail.message || detail || 'unknown error');
    const now = Date.now();
    // the same error firing in a loop should not bury the interface in toasts
    if (msg === lastMsg && now - lastAt < 4000) return;
    lastMsg = msg; lastAt = now;
    console.error(what, detail);
    if (typeof toast === 'function') toast('Something failed: ' + msg.slice(0, 90));
  };
  window.addEventListener('unhandledrejection', e => report('Unhandled promise rejection:', e.reason));
  window.addEventListener('error', e => {
    // resource load failures (a missing icon) surface here too and are not
    // worth interrupting anyone over
    if (e.target && e.target !== window) return;
    report('Uncaught error:', e.error || e.message);
  });
})();

/* Wires up the mobile accordion described in the CSS. Runs once; the media
   query does the rest, so on desktop these classes are present and inert
   rather than needing a resize listener to add and remove them.

   Only panels whose header is a direct .pt child are touched — 06 Export is
   already a <details> and manages itself, and the readout strips are not
   numbered steps. A click on a button INSIDE a header (Auto tone lives in the
   White Balance one) must not also collapse the panel, so those are excluded
   explicitly rather than relying on the event order. */
(function () {
  /* Skips the numbered step panels. Those are real <details> elements now,
     which collapse themselves natively -- keyboard, screen reader and browser
     find-in-page all understand them, and none of that works with a class
     that sets display:none. Running both systems on the same panel meant two
     independent notions of "collapsed" fighting each other, which is exactly
     what put empty headers on screen: the class hid the contents while the
     element still reported itself open. This one now only handles any
     remaining legacy panel that is not a stepPanel. */
  const panels = [...document.querySelectorAll('.panel')].filter(p => {
    if (p.classList.contains('stepPanel') || p.tagName === 'DETAILS') return false;
    const h = p.firstElementChild;
    return h && h.classList.contains('pt') && p.querySelector('.stepChip');
  });
  /* Collapsing works on every screen; only the starting state differs. A
     phone opens 02 alone, because there the panels are stacked in one column
     and everything else is scrolling. A wide screen has two columns and room
     to show them, so nothing starts collapsed \u2014 the control is there to tidy
     away what you are not using, not to hide things you can already see. */
  const narrow = window.matchMedia('(max-width:1099px)').matches;
  panels.forEach(p => {
    p.classList.add('collapsible');
    const chip = p.querySelector('.stepChip');
    if (narrow && chip && chip.textContent.trim() !== '02') p.classList.add('collapsed');
    const head = p.firstElementChild;
    head.addEventListener('click', e => {
      if (e.target.closest('button, input, select, a, label')) return;
      p.classList.toggle('collapsed');
      // opening a panel low down leaves it off-screen behind the pinned
      // preview; bring its header to just under it
      if (!p.classList.contains('collapsed')) {
        const sticky = document.getElementById('previewSticky');
        const pad = sticky ? sticky.getBoundingClientRect().height : 0;
        const y = window.scrollY + head.getBoundingClientRect().top - pad - 8;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
      haptic('select');
    });
  });
})();


/* One tap for the two settings that decide how a photo survives being
   posted. Not a guess at what looks good \u2014 just the pair that avoids the
   two ways this export panel quietly degrades a picture:

   FORMAT -> JPEG at q100. WhatsApp and Instagram both re-encode everything
   they receive, so a 100MB TIFF is recompressed to a JPEG at the far end
   regardless; sending one only costs upload time and gains nothing.

   RESOLUTION -> original, not working size. Working size is capped at 2048px
   so the live preview stays smooth, and it is the DEFAULT \u2014 exporting it
   gives a soft file from a sensor that shot far more detail. */
function applySocialPreset() {
  const fmt = document.querySelector('input[name=fmt][value="jpeg"]');
  if (fmt) { fmt.checked = true; fmt.dispatchEvent(new Event('change', {bubbles:true})); }
  const res = document.querySelector('input[name=res][value="original"]');
  // the resolution panel only exists when the working size differs from the
  // original; on a small photo there is nothing to choose and that is fine
  const hasChoice = res && $('resPanel') && $('resPanel').style.display !== 'none';
  if (hasChoice) { res.checked = true; res.dispatchEvent(new Event('change', {bubbles:true})); }
  if (typeof updateExportResOptions === 'function') updateExportResOptions();
  haptic('confirm');
  toast(hasChoice
    ? 'JPEG at full quality, original size \u2014 ready to post'
    : 'JPEG at full quality \u2014 this photo is already at its original size');
}
$('btnSocialPreset').onclick = applySocialPreset;

/* Step buttons on every slider. Dragging is fine for finding a look, but
   hopeless for landing on an exact number \u2014 on a trackpad especially, a
   one-unit change means fighting the pointer, and overshooting then coming
   back is how a value gets nudged twice and undone once.

   Built here rather than in the markup so every slider gets them, including
   any added later, and so the range element itself is untouched: the fill
   painting, drag-scrub, undo arming and value readout all still key off the
   same input, which is why the buttons dispatch real input/change events
   instead of setting the value quietly. */
(function () {
  document.querySelectorAll('.sl > input[type=range]').forEach(el => {
    const step = +el.step || 1;
    const row = document.createElement('div');
    row.className = 'slStep';
    el.parentNode.insertBefore(row, el);
    const mk = (dir, glyph, label) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'stepBtn'; b.textContent = glyph;
      b.setAttribute('aria-label', label + ' ' + (el.getAttribute('aria-label') || ''));
      b.tabIndex = -1;                      // keep tab order on the slider itself
      let timer = null, delay = null;
      const bump = () => {
        // build 190: Temperature and Tint sit on a curve; their buttons move the shown value by one, not the position
        const curved = typeof WB_CURVE !== 'undefined' && WB_CURVE[el.id];
        let v = curved ? wbPos(Math.round(wbEff(el.value)) + dir) : (+el.value || 0) + dir * step;
        if (curved && v === +el.value) v += dir;
        v = Math.max(+el.min, Math.min(+el.max, v));
        if (v === +el.value) return stop();
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const stop = () => { clearTimeout(delay); clearInterval(timer); timer = delay = null; };
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (typeof armUndoCapture === 'function') armUndoCapture();
        bump();
        // hold to repeat, because ranges like Temperature span 1200 units
        delay = setTimeout(() => { timer = setInterval(bump, 60); }, 420);
        b.setPointerCapture(e.pointerId);
      });
      const end = () => {
        if (!timer && !delay) return;
        stop();
        // one undo entry per press, however many repeats it fired
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof haptic === 'function') haptic('tick');
      };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
      b.addEventListener('pointerleave', end);
      return b;
    };
    row.appendChild(mk(-1, '\u2212', 'decrease'));
    row.appendChild(el);
    row.appendChild(mk(1, '+', 'increase'));
  });
})();

/* Returns the interface to the opening screen. Exposed because after an
   export the job is finished, and the next thing anyone does is start
   another photo — but "New image" opens the file picker straight away, so
   the opening screen (and the CR2 decode choice that lives on it) was
   unreachable without reloading the page. Only the view is reset: the
   sliders, matrix and preset stay exactly as they were, so the same look can
   be applied to the next file. */
/* A prompt, not an automatic jump. Exporting does not always mean finished —
   people export a JPEG to check it and carry on adjusting — so throwing the
   view away unasked would destroy work in progress. This offers the trip back
   and does nothing if ignored. */
function offerLanding() {
  // toast() creates the element on first use, so call it BEFORE reaching for
  // it — otherwise the very first export of a session finds nothing there and
  // the offer silently never appears
  toast('Saved.');
  const t = $('toast');
  if (!t) return;
  t.textContent = 'Saved. ';
  const link = document.createElement('button');
  link.type = 'button';
  link.textContent = 'Start a new photo';
  link.style.cssText = 'background:none;border:0;color:var(--accent);font:inherit;text-decoration:underline;cursor:pointer;padding:0';
  link.onclick = () => { backToLanding(); t.classList.remove('on'); };
  t.appendChild(link);
  t.classList.add('on');
  clearTimeout(t.__timer);
  // longer than an ordinary toast: it has to be readable AND tappable
  t.__timer = setTimeout(() => t.classList.remove('on'), 9000);
}

function backToLanding() {
  $('emptyStateGroup').style.display = '';
  $('main').classList.remove('on');
  document.body.classList.remove('has-image');
  if ($('previewFullscreen')) $('previewFullscreen').classList.remove('on');
  window.scrollTo(0, 0);
}
$('fi').onchange = e => pickedFile(e, loadFile);
// build 218: copy the list BEFORE clearing the input -- clearing it empties the same FileList, so batch saw no files
$('fiBatch').onchange = e => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) runBatch(fs); };
$('fi2').onchange = e => pickedFile(e, loadFile);

/* The orientation tag inside a JPEG's own EXIF block (APP1), or 1 when it has none. Browsers turn a JPEG by this tag when
   they decode it, so a preview carrying one needs no further turn. */
async function jpegOwnOrientation(blob) {
  try {
    const buf = await blob.slice(0, 131072).arrayBuffer(), dv = new DataView(buf);
    if (dv.getUint16(0) !== 0xFFD8) return 1;
    let p = 2;
    while (p + 4 < dv.byteLength) {
      const m = dv.getUint16(p), len = dv.getUint16(p + 2);
      if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) break;
      if (m === 0xFFE1 && p + 10 < dv.byteLength && dv.getUint32(p + 4) === 0x45786966) return readTiffOrientation(buf.slice(p + 10, p + 2 + len));
      p += 2 + len;
    }
  } catch (e) {}
  return 1;
}
