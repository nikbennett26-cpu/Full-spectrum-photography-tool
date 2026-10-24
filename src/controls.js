'use strict';
/* irlab editor: js/controls.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- slider weight ----------
   Brightness, Contrast, Highlights, Shadows, Black point and White point do not respond in a straight line to the
   thumb. Near the middle a lot of travel gives a little change, and the response builds toward the ends, so the
   first stretch is fine control and the ends stay strong. The slider position is what is stored and shown; the
   effect is taper(position), and 100 still gives the full effect it always did. Anything saved before this change
   holds the old, straight-line effect, so it is converted on load and keeps its look. */
const TAPER_G = 1.4;
const LIGHT_TAPER = { brightness: { p: 100, n: 100 }, contrast: { p: 100, n: 100 }, highlights: { p: 100, n: 100 }, shadows: { p: 100, n: 100 } };
/* Black and White point went back to their original form: 0 to 120, one-way, straight-line. Sessions and presets
   saved while they were weighted and signed (version 2) hold weighted positions for them; this turns those back
   into plain values (a negative setting, which no longer exists, becomes 0). */
const BW_TAPER_V2 = { blackPt: { p: 120, n: 60 }, whitePt: { p: 120, n: 60 } };
function bwFromV2(id, pos) {
  const t = BW_TAPER_V2[id]; if (!t || !isFinite(pos)) return pos;
  if (pos <= 0) return 0;
  return Math.round(t.p * Math.pow(Math.min(1, pos / 100), TAPER_G));
}
function taperEff(id, pos) {
  const t = LIGHT_TAPER[id]; if (!t || !isFinite(pos)) return pos;
  const side = pos >= 0 ? t.p : t.n, a = Math.min(1, Math.abs(pos) / 100);
  return (pos < 0 ? -1 : 1) * side * Math.pow(a, TAPER_G);
}
function taperPos(id, eff) {
  const t = LIGHT_TAPER[id]; if (!t || !isFinite(eff)) return eff;
  const side = eff >= 0 ? t.p : t.n, a = Math.min(1, Math.abs(eff) / side);
  return Math.round((eff < 0 ? -1 : 1) * 100 * Math.pow(a, 1 / TAPER_G));
}
function lightVal(id) { const el = $(id); return el ? taperEff(id, +el.value || 0) : 0; }

// Single source of truth for reading the contrast slider — this exact
// inline IIFE was previously duplicated in three places, each of which had
// to independently remember that the default is 25 and not 0.
function contrastUI() { return lightVal('contrast'); }

// Every consumer of the pipeline (live preview, original-res export, .cube
// bake) must read the SAME set of controls, or they diverge silently — which
// is exactly how temp/tint went missing from full-res exports.
/* Weight vector for "hold brightness through the swap". Ratio-invariant by
   construction: preserveLuma only ever computes yBefore/yAfter with this
   same vector on both sides, so it does not matter whether the three
   sliders sum to 100 \u2014 doubling all three changes nothing. Left unnormalised
   deliberately, so the sliders can stay simple percentages rather than
   fighting each other to stay balanced. */
function getLumaW() {
  const r = (+($('lumaR') && $('lumaR').value) || 0) / 100;
  const g = (+($('lumaG') && $('lumaG').value) || 0) / 100;
  const b = (+($('lumaB') && $('lumaB').value) || 0) / 100;
  return [r, g, b];
}

/* ---------- clipping while you drag ----------
   While Exposure, White point or Black point is being dragged (or its - / + held), the clipping view switches on by
   itself, so the areas going to pure white or pure black show up as you move, and it clears when you let go. If
   the clipping view is already ticked it simply stays on. Never reaches an export: exports force it off. */
let clipPeek = false;
(function wireClipPeek() {
  const start = () => { if (!clipPeek) { clipPeek = true; render(true); } };
  ['bright', 'whitePt', 'blackPt'].forEach(id => {
    const el = $(id); if (!el) return;
    const zone = el.closest('.slStep') || el;
    zone.addEventListener('pointerdown', start);
    zone.addEventListener('touchstart', start, { passive: true });
  });
  const stop = () => { if (clipPeek) { clipPeek = false; render(); } };
  ['pointerup', 'pointercancel', 'touchend', 'touchcancel'].forEach(t => document.addEventListener(t, stop));
  window.addEventListener('blur', stop);
})();

/* ---------- range controls and colour bands ---------- */
/* The two range sliders stay tucked away until asked for, and always show when either is away from 50 so a
   setting that changes the picture is never hidden. The open/closed choice is remembered. */
let rangesOpen = false;
try { rangesOpen = localStorage.getItem('irlab.showRanges') === '1'; } catch (e) {}
function syncRangeToggle() {
  const P = document.querySelector('details.stepPanel[data-step="light"]'), b = $('btnRangeToggle'); if (!P || !b) return;
  const hi = $('hiRange'), sh = $('shRange');
  const changed = !!((hi && +hi.value !== 50) || (sh && +sh.value !== 50));
  const open = rangesOpen || changed;
  P.classList.toggle('showRanges', open);
  b.setAttribute('aria-expanded', open ? 'true' : 'false');
  b.textContent = (open ? '\u25be ' : '\u25b8 ') + 'Range controls' + (changed && !rangesOpen ? ' (in use)' : '');
}
(function wireRawNr() {
  ['rawNrL', 'rawNrC'].forEach(id => { const e = $(id); if (e) e.addEventListener('change', () => reapplyCamSpaceSwap()); });
  const chk = $('rawHlChk');
  if (chk) chk.addEventListener('change', () => {
    const h = $('rawHl'); if (!h) return; const v = chk.checked ? '1' : '0'; if (h.value === v) return;
    armUndoCapture(); h.value = v; commitUndoCapture();
    if ($('rawHlStatus')) $('rawHlStatus').textContent = v === '1' ? 'Rebuilding\u2026' : '';
    syncRawHlButtons(); reapplyCamSpaceSwap();
  });
})();
function syncRawHlButtons() {   // keeps the tick box in step with the saved value (undo, redo, presets, reset, a restored session)
  const h = $('rawHl'), v = h ? h.value : '0', c = $('rawHlChk');
  if (c) c.checked = v === '1';
  if (v !== '1' && $('rawHlStatus')) $('rawHlStatus').textContent = '';
}
(function wireRangeToggle() {
  const b = $('btnRangeToggle'); if (!b) return;
  b.addEventListener('click', () => { rangesOpen = !rangesOpen; try { localStorage.setItem('irlab.showRanges', rangesOpen ? '1' : '0'); } catch (e) {} syncRangeToggle(); });
  ['hiRange', 'shRange'].forEach(id => { const e = $(id); if (e) e.addEventListener('input', syncRangeToggle); });
  syncRangeToggle();
})();
function rangeHiPivot() { const e = $('hiRange'); const v = e ? +e.value : 50; return 0.10 * Math.pow(3, (50 - (isFinite(v) ? v : 50)) / 50); }
function rangeShW() { const e = $('shRange'); const v = e ? +e.value : 50; return Math.pow(1.6, ((isFinite(v) ? v : 50) - 50) / 50); }
const HSL_IDS = ["hslH0", "hslH1", "hslH2", "hslH3", "hslH4", "hslH5", "hslH6", "hslH7", "hslS0", "hslS1", "hslS2", "hslS3", "hslS4", "hslS5", "hslS6", "hslS7", "hslL0", "hslL1", "hslL2", "hslL3", "hslL4", "hslL5", "hslL6", "hslL7"];
function hslParams() {
  const g = id => { const e = $(id); return e ? (+e.value || 0) / 100 : 0; };
  const H = [0,1,2,3,4,5,6,7].map(i => g('hslH' + i)), S = [0,1,2,3,4,5,6,7].map(i => g('hslS' + i)), L = [0,1,2,3,4,5,6,7].map(i => g('hslL' + i));
  return { on: H.concat(S, L).some(v => v !== 0), H: H, S: S, L: L };
}
(function wireHsl() {
  const rows = $('hslRows'); if (!rows) return;
  document.querySelectorAll('#hslTabs button[data-g]').forEach(b => b.addEventListener('click', () => {
    rows.dataset.g = b.dataset.g;
    document.querySelectorAll('#hslTabs button[data-g]').forEach(o => o.classList.toggle('on', o === b));
  }));
  $('btnHslReset').addEventListener('click', () => {
    armUndoCapture();
    HSL_IDS.forEach(id => { const e = $(id); if (!e) return; e.value = 0; const l = $('v_' + id); if (l) l.textContent = 0; if (typeof syncSliderFill === 'function') syncSliderFill(e); });
    render(); commitUndoCapture();
  });
})();

/* ---------- Auto Levels: RawTherapee's getAutoExp (improcfun.cc), ported ----------
   Reads a histogram of linear luminance (65536 >> histcompr bins, covering 0..65535) and works out an exposure
   compensation (EV), a black level, brightness, contrast and a highlight compression, from the median and the
   octiles of the histogram and how far the clip points sit from the ends. Numbers are kept at the same precision
   (32-bit floats, the same integer truncations) as the original so it gives the same answers; the original is GPL-3,
   as is this. Pure function: no access to the page. */
function rtAutoExp(hist, histcompr, clip) {
  const F = Math.fround, scale = 65536, midgray = 0.1842, imax = 65536 >> histcompr, n = hist.length;
  const out = { expcomp: 0, bright: 0, contr: 0, black: 0, hlcompr: 0, hlcomprthresh: 0 };
  const g2 = x => x <= 0.00304 ? x * 12.92310 : 1.055 * Math.exp(Math.log(x) / 2.4) - 0.055;
  const ig2 = x => x <= 0.03928 ? x / 12.92310 : Math.exp(Math.log((x + 0.055) / 1.055) * 2.4);
  const g2curve = v => { const idx = Math.trunc(v); if (v < 0) return F(g2(0) * 65535); if (idx >= 65535) return F(g2(1) * 65535); const d0 = F(g2(idx / 65535) * 65535), d1 = F(g2((idx + 1) / 65535) * 65535), diff = F(v - idx); return F(F(1 - diff) * d0 + F(diff * d1)); };
  let sum = 0, ave = 0;
  for (let i = 0; i < n; i++) { ave = F(ave + F(i * hist[i])); sum = F(sum + hist[i]); }
  ave = F(ave / sum);
  let median = 0, count = hist[0];
  while (count < sum / 2) { median++; count += hist[median]; }
  if (median === 0 || ave < 1) return out;   // probably a black frame
  const octile = [0, 0, 0, 0, 0, 0, 0, 0]; let ospread = 0, losum = 0, hisum = 0; count = 0; let j = 0;
  const upto = Math.min(Math.trunc(ave), imax);
  const step = (jj) => { if (count < 8) { octile[count] = F(octile[count] + hist[jj]); if (octile[count] > F(sum / 8) || (count === 7 && octile[count] > F(sum / 16))) { octile[count] = F(F(Math.log(F(1 + jj))) / Math.LN2); count++; } } };
  for (; j < upto; ++j) { step(j); losum = F(losum + hist[j]); }
  for (; j < imax; ++j) { step(j); hisum = F(hisum + hist[j]); }
  if (losum === 0 || hisum === 0) return out;
  let overex = 0; const lim = F(F(Math.log1p(imax)) / 1);
  if (octile[6] > lim) { octile[6] = F(1.5 * octile[5] - 0.5 * octile[4]); overex = 2; }
  if (octile[7] > lim) { octile[7] = F(1.5 * octile[6] - 0.5 * octile[5]); overex = 1; }
  const oct6 = octile[6], oct7 = octile[7];
  for (let i = 1; i < 8; i++) if (octile[i] === 0) octile[i] = octile[i - 1];
  for (let i = 1; i < 6; i++) ospread = F(ospread + F((octile[i + 1] - octile[i]) / Math.max(0.5, (i > 2 ? (octile[i + 1] - octile[3]) : (octile[3] - octile[i])))));
  ospread = F(ospread / 5);
  if (ospread <= 0) return out;
  let clipped = 0, rawmax = imax - 1;
  while (hist[rawmax] + clipped <= 0 && rawmax > 1) { clipped += hist[rawmax]; rawmax--; }
  const clippable = Math.trunc(sum * clip / 100);
  clipped = 0; let whiteclip = imax - 1;
  while (whiteclip > 1 && (hist[whiteclip] + clipped) <= clippable) { clipped += hist[whiteclip]; whiteclip--; }
  clipped = 0; let shc = 0;
  while (shc < whiteclip - 1 && hist[shc] + clipped <= clippable) { clipped += hist[shc]; shc++; }
  rawmax = rawmax * (1 << histcompr); whiteclip = whiteclip * (1 << histcompr); ave = F(ave * (1 << histcompr)); median = median * (1 << histcompr); shc = shc * (1 << histcompr);
  const expcomp1 = F(Math.log(F(midgray * scale / F(ave - shc + midgray * shc))) / F(Math.log(2)));
  let expcomp2;
  if (overex === 0) expcomp2 = F(0.5 * ((15.5 - histcompr - (2 * oct7 - oct6)) + Math.log(scale / rawmax) / F(Math.log(2))));
  else expcomp2 = F(0.5 * ((15.5 - histcompr - (2 * octile[7] - octile[6])) + Math.log(scale / rawmax) / F(Math.log(2))));
  let expcomp;
  if (Math.abs(expcomp1) - Math.abs(expcomp2) > 1) expcomp = (expcomp1 * Math.abs(expcomp2) + expcomp2 * Math.abs(expcomp1)) / (Math.abs(expcomp1) + Math.abs(expcomp2));
  else expcomp = 0.5 * expcomp1 + 0.5 * expcomp2;
  const gain = F(Math.exp(F(expcomp * F(Math.log(2)))));
  const corr = F(Math.sqrt(F(F(gain * scale) / rawmax)));
  let black = Math.trunc(shc * corr);
  const comp = (gain * whiteclip / scale - 1) * 2.3;
  let hlcompr = Math.trunc(100 * comp / (Math.max(0, expcomp) + 1));
  hlcompr = Math.max(0, Math.min(100, hlcompr));
  const midtmp = F(F(gain * F(Math.sqrt(F(median * ave)))) / scale);
  let bright;
  if (midtmp < 0.1) bright = Math.trunc(F(F(F(midgray - midtmp) * 15) / midtmp));
  else bright = Math.trunc(F(F(F(midgray - midtmp) * 15) / F(0.10833 - F(0.0833 * midtmp))));
  bright = Math.trunc(0.25 * Math.max(0, bright));
  let contr = Math.trunc(F(50 * F(1.1 - ospread)));
  contr = Math.max(0, Math.min(100, contr));
  let whiteclipg = Math.trunc(g2(whiteclip * corr / 65536) * 65536);
  let gavg = 0, val = 0; const increment = F(corr * (1 << histcompr));
  for (let i = 0; i < (65536 >> histcompr); i++) { gavg = F(gavg + F(hist[i] * g2curve(val))); val = F(val + increment); }
  gavg = F(gavg / sum);
  if (black < gavg) { const maxwhiteclip = Math.trunc(F(F(F(gavg - black) * 4) / 3) + black); if (whiteclipg < maxwhiteclip) whiteclipg = maxwhiteclip; }
  whiteclipg = ig2(whiteclipg / 65535) * 65535;
  black = Math.trunc((65535 * black) / whiteclipg);
  if (expcomp < -5) expcomp = -5;
  if (expcomp > 12) expcomp = 12;
  bright = Math.max(-100, Math.min(bright, 100));
  out.expcomp = expcomp; out.bright = bright; out.contr = contr; out.black = black; out.hlcompr = hlcompr; out.hlcomprthresh = 0;
  return out;
}

/* How RawTherapee's numbers become this app's sliders. Exposure (EV) and the black level are the same physical
   operations here as there, so they are carried over exactly (black is a linear level; this app's Black point works
   on the encoded value, so it is converted). Brightness, Contrast and highlight compression are different curves
   from RawTherapee's, so they are scaled to land at a comparable strength; the factors are the three constants below. */
const AUTO_MAP = { bright: 1.0, contrast: 1.0, highlights: 1.0, blackMax: 40 };
function autoLevelsHistogram() {
  if (typeof engine === 'undefined' || !engine) return null;
  // the picture as it is NOW, but with the five sliders Auto Levels sets put back to neutral (it works out what they
  // should be from the picture without them); everything else, swap, white balance, colour, curves, masks, stays on
  const p = Object.assign({}, currentParams(), { exposure: 0, brightness: 0, contrast: 0, highlights: 0, blackPt: 0, clipView: false, dither: false });
  const n = engine.canvas.width * engine.canvas.height, hist = new Float64Array(8192);
  let px = null;
  try { px = engine.renderHiPrec(p); } catch (e) { px = null; }
  const lin16 = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) { const x = i / 65535; lin16[i] = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
  if (px && px.length >= n * 4) {
    for (let i = 0, q = 0; i < n; i++, q += 4) {
      const y = 0.2126 * lin16[px[q]] + 0.7152 * lin16[px[q + 1]] + 0.0722 * lin16[px[q + 2]];
      const v = (y * 65535) | 0; hist[(v > 65535 ? 65535 : v) >> 3]++;
    }
  } else {
    engine.render(p); const b8 = engine.readPixels();
    const l8 = new Float32Array(256); for (let i = 0; i < 256; i++) l8[i] = lin16[Math.round(i * 257)];
    for (let i = 0, q = 0; i < n; i++, q += 4) { const y = 0.2126 * l8[b8[q]] + 0.7152 * l8[b8[q + 1]] + 0.0722 * l8[b8[q + 2]]; const v = (y * 65535) | 0; hist[(v > 65535 ? 65535 : v) >> 3]++; }
  }
  return hist;
}
function autoLevelsCompute() {
  const hist = autoLevelsHistogram(); if (!hist) return null;
  const r = rtAutoExp(hist, 3, 0.02);
  const g2 = x => x <= 0.00304 ? x * 12.92310 : 1.055 * Math.exp(Math.log(x) / 2.4) - 0.055;
  const M = AUTO_MAP;
  return {
    raw: r,
    exposure: Math.max(-3, Math.min(3, Math.round(r.expcomp * 100) / 100)),
    blackPt: Math.max(0, Math.min(M.blackMax, Math.round(255 * g2(r.black / 65535)))),
    brightness: Math.max(0, Math.min(100, Math.round(r.bright * M.bright))),
    contrast: Math.max(0, Math.min(100, Math.round(r.contr * M.contrast))),
    highlights: -Math.max(0, Math.min(100, Math.round(r.hlcompr * M.highlights))),
    nothing: r.expcomp === 0 && r.bright === 0 && r.contr === 0 && r.black === 0 && r.hlcompr === 0
  };
}
function autoLevels() {
  if (typeof engine === 'undefined' || !engine || !loadedImage) return;
  const a = autoLevelsCompute();
  if (!a || a.nothing) { toast('Nothing to auto-adjust in this picture'); return; }
  armUndoCapture();
  const put = (id, v) => { const e = $(id); if (!e) return; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
  put('bright', a.exposure.toFixed(2));
  put('blackPt', a.blackPt);
  put('brightness', taperPos('brightness', a.brightness));
  put('contrast', taperPos('contrast', a.contrast));
  put('highlights', taperPos('highlights', a.highlights));
  commitUndoCapture();
  const f = n => (n > 0 ? '+' : '') + n;
  toast('Auto levels: exposure ' + f(a.exposure.toFixed(2)) + ' EV, black ' + a.blackPt + ', brightness ' + a.brightness + ', contrast ' + a.contrast + ', highlights ' + a.highlights);
}

/* ---------- Edge-preserving tone mapping: RawTherapee's EdgePreservingDecomposition, ported ----------
   RawTherapee's Tone Mapping (EPD). A smooth, edge-stopping "base" layer of the log lightness is found by solving a
   weighted smoothness problem (a sparse symmetric system on the pixel grid) with preconditioned conjugate gradient,
   an incomplete Cholesky (fill 1) preconditioner and a fixed number of iterations, exactly as the original does.
   The compression then scales the base and boosts the detail around it. Only the base layer is solved here, at a
   reduced size; the final per-pixel step runs in the shader at full resolution (see the epd stage there), so the
   detail it works on is the picture's own pixels. The original is GPL-3, as is this. */
function rtEpdBlur(g, w, h, Scale, EdgeStopping, Iterates) {
  const n = w * h;
  if (Scale === 0) return Float32Array.from(g);
  const a = new Float32Array(n), w1 = w - 1, h1 = h - 1, sqreps = 0.0004;
  for (let y = 0; y < h1; y++) {
    const base = w * y;
    for (let x = 0; x < w1; x++) {
      const i = base + x, gx = (g[i + 1] - g[i]) + (g[i + w + 1] - g[i + w]), gy = (g[i + w] - g[i]) + (g[i + w + 1] - g[i + 1]);
      a[i] = Scale * Math.pow(0.5 * Math.sqrt(gx * gx + gy * gy + sqreps), -EdgeStopping);
    }
  }
  // the matrix: main diagonal and four lower diagonals at offsets 1, w-1, w, w+1 (symmetric, so the upper ones are the same)
  const a0 = new Float32Array(n), A1 = new Float32Array(n), Aw1 = new Float32Array(n), Aw = new Float32Array(n), Awp1 = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    let i = y * w;
    for (let x = 0; x < w; x++, i++) {
      let ac, a0temp = 0.25;
      if (x > 0 && y > 0) { ac = a[i - w - 1] / 6; Awp1[i - w - 1] -= 2 * ac; Aw[i - w] -= ac; A1[i - 1] -= ac; a0temp += ac; }
      if (x < w1 && y > 0) { ac = a[i - w] / 6; Aw[i - w] -= ac; Aw1[i - w + 1] -= 2 * ac; a0temp += ac; }
      if (x > 0 && y < h1) { ac = a[i - 1] / 6; A1[i - 1] -= ac; a0temp += ac; }
      if (x < w1 && y < h1) a0temp += a[i] / 6;
      a0[i] = 4 * a0temp;
    }
  }
  const S = [1, w - 1, w, w + 1], AD = [A1, Aw1, Aw, Awp1];
  // incomplete Cholesky factorization with fill 1: L has diagonals at 1, w-2, w-1, w, w+1; D on the main one
  const K = [1, w - 2, w - 1, w, w + 1], m = K.length, L = [], d = new Float32Array(n);
  for (let s = 0; s < m; s++) L.push(new Float32Array(n));
  const findmap = K.map(k => S.indexOf(k));
  const pm = []; const maxIdx = [];   // the same flat pair table as the original, including its shared running index
  for (let s = 0; s < m; s++) { for (let u = 0; u < m; u++) { const t = K.indexOf(K[s] + K[u]); if (t >= 0) pm.push({ ss: u, sss: t, k: K[u] }); } maxIdx.push(pm.length - 1); }
  for (let j = 0; j < n; j++) {
    let dj = a0[j];
    for (let s = 0; s < m; s++) { const k = K[s]; if (k > j) break; const v = L[s][j - k]; dj -= v * v * d[j - k]; }
    if (dj === 0) return Float32Array.from(g);   // not decomposable: leave unsmoothed
    d[j] = dj; const id = 1 / dj; let mapindex = 0; const jMax = n - j;
    for (let s = 0; s < m; s++) {
      if (K[s] >= jMax) break;
      let temp = 0, k;
      while (mapindex <= maxIdx[s] && (k = pm[mapindex].k) <= j) { const e = pm[mapindex]; temp -= L[e.sss][j - k] * L[e.ss][j - k] * d[j - k]; mapindex++; }
      const sss = findmap[s];
      L[s][j] = id * (sss < 0 ? temp : (AD[sss][j] + temp));
    }
  }
  const mul = (P, x) => {   // P = A x
    for (let j = 0; j < n; j++) {
      let v = a0[j] * x[j];
      for (let q = 0; q < 4; q++) { const s = S[q], Dg = AD[q]; if (j - s >= 0) v += Dg[j - s] * x[j - s]; if (j + s < n) v += Dg[j] * x[j + s]; }
      P[j] = v;
    }
  };
  const pre = (x, b) => {   // solve (L D L^T) x = b
    for (let j = 0; j < n; j++) { let sub = b[j]; for (let i = 0; i < m; i++) { const c = j - K[i]; if (c < 0) break; sub -= L[i][c] * x[c]; } x[j] = sub; }
    for (let j = 0; j < n; j++) x[j] = x[j] / d[j];
    for (let j = n - 1; j >= 0; j--) { let sub = x[j]; for (let i = 0; i < m; i++) { const c = j + K[i]; if (c >= n) break; sub -= L[i][j] * x[c]; } x[j] = sub; }
  };
  // preconditioned conjugate gradient, starting from the source itself, for a fixed number of iterations
  const x = Float32Array.from(g), r = new Float32Array(n), sv = new Float32Array(n), dv = new Float32Array(n), ax = new Float32Array(n);
  mul(r, x); for (let i = 0; i < n; i++) r[i] = g[i] - r[i];
  pre(sv, r);
  const dot = (p, q) => { let t = 0; for (let i = 0; i < n; i++) t += p[i] * q[i]; return t; };
  let rs = dot(r, sv); dv.set(sv);
  for (let it = 0; it < Iterates; it++) {
    mul(ax, dv); let ab = dot(dv, ax); if (ab === 0) break;
    ab = rs / ab; const abf = Math.fround(ab);
    for (let i = 0; i < n; i++) { x[i] += abf * dv[i]; r[i] -= abf * ax[i]; }
    pre(sv, r);
    const old = rs; rs = dot(r, sv); const bt = Math.fround(rs / old);
    for (let i = 0; i < n; i++) dv[i] = sv[i] + bt * dv[i];
  }
  return x;
}
/* The whole RawTherapee step on a normalised lightness image (used for checking against the original and for the base) */
function rtEpdCompress(Ln, w, h, Scale, EdgeStopping, Compression, DetailBoost, Iterates) {
  const n = w * h, eps = 0.0001, src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = Math.log(Math.max(Ln[i], 0) + eps);
  const u = rtEpdBlur(src, w, h, Scale, EdgeStopping, Iterates);
  let temp;
  if (DetailBoost > 0) { const betemp = Math.exp(-(2 - DetailBoost + 0.693147)) - 1; temp = 1.2 * Math.log(-betemp); } else temp = Compression - 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const ce = Math.exp(src[i] + u[i] * temp) - eps, ue = Math.exp(u[i]) - eps, se = Math.exp(src[i]) - eps; out[i] = ce + DetailBoost * (se - ue); }
  return { out: out, base: u };
}
function rtEpdBase(Ln, w, h, Scale, EdgeStopping, Iterates) {
  const n = w * h, eps = 0.0001, src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = Math.log(Math.max(Ln[i], 0) + eps);
  return rtEpdBlur(src, w, h, Scale, EdgeStopping, Iterates);
}

/* Runs the base solve in a Web Worker, so the page stays responsive. */
let epdWorkerUrl = null;
function runEpdWorker(Ln, w, h, scale, edge, iters) {
  return new Promise((resolve, reject) => {
    let wk = null;
    try {
      if (!epdWorkerUrl) {
        const src = rtEpdBlur.toString() + '\n' + rtEpdBase.toString() +
          '\nself.onmessage = e => { const d = e.data; try { const u = rtEpdBase(d.Ln, d.w, d.h, d.scale, d.edge, d.iters); self.postMessage({ u: u }, [u.buffer]); } catch (err) { self.postMessage({ error: String(err && err.message || err) }); } };';
        epdWorkerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      }
      wk = new Worker(epdWorkerUrl);
    } catch (e) { wk = null; }
    if (!wk) { setTimeout(() => { try { resolve(rtEpdBase(Ln, w, h, scale, edge, iters)); } catch (e) { reject(e); } }, 30); return; }
    wk.onmessage = e => { const d = e.data || {}; wk.terminate(); if (d.error) reject(new Error(d.error)); else resolve(d.u); };
    wk.onerror = e => { wk.terminate(); reject(new Error((e && e.message) || 'tone mapping worker failed')); };
    wk.postMessage({ Ln: Ln, w: w, h: h, scale: scale, edge: edge, iters: iters }, [Ln.buffer]);
  });
}
/* ---------- Deep sky and Crimson foliage: the sky selection ----------
   Found once per picture from the decoded picture itself (before any swap or edit, so changing the swap does not move it): on a
   small copy a region is grown from the top edge through colours that change smoothly, refusing warm colours and bright neutrals,
   so branches, walls and clouds are left out. The result is softened and handed to the shader as a small texture, where the
   pixel-level colour test trims it again. */
const EIR = { mask: null, gen: -1, imgGen: -1, id: 0, show: false, coverage: 0 };
function skyMaskCompute() {
  /* Two maps from a small copy of the picture, both decided on SMOOTHED colour so that sensor noise cannot flip a pixel in or
     out (the first version decided per pixel in the shader, which turned noisy cloud pixels into pink speckle and left holes
     in the sky that showed as blotches):
       R: the sky, a smooth area grown from the top edge, with small holes closed;
       G: the foliage, coloured purples, magentas and reds that are not sky.
     It also notes the typical lightness of the sky, so anything clearly brighter than that (cloud, haze) is left alone. */
  const src = (typeof rawCanvas !== 'undefined' && rawCanvas && rawCanvas.width) ? rawCanvas : null; if (!src) return null;
  const k = Math.min(1, 320 / Math.max(src.width, src.height)), w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, n = w * h, L0 = new Float32Array(n), A0 = new Float32Array(n), B0 = new Float32Array(n);
  const s2l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  for (let i = 0; i < n; i++) {
    const r = s2l(d[i * 4]), g = s2l(d[i * 4 + 1]), b = s2l(d[i * 4 + 2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), sv = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    L0[i] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * sv; A0[i] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * sv; B0[i] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * sv;
  }
  const box = (src0, rad) => { const out = new Float32Array(n), tmp = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { let sm = 0, cn = 0; for (let dx = -rad; dx <= rad; dx++) { const x2 = xx + dx; if (x2 >= 0 && x2 < w) { sm += src0[y * w + x2]; cn++; } } tmp[y * w + xx] = sm / cn; }
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { let sm = 0, cn = 0; for (let dy = -rad; dy <= rad; dy++) { const y2 = y + dy; if (y2 >= 0 && y2 < h) { sm += tmp[y2 * w + xx]; cn++; } } out[y * w + xx] = sm / cn; }
    return out; };
  const L = box(L0, 1), A = box(A0, 1), B = box(B0, 1), Cc = new Float32Array(n), Hh = new Float32Array(n);
  for (let i = 0; i < n; i++) { Cc[i] = Math.hypot(A[i], B[i]); let hd = Math.atan2(B[i], A[i]) * 180 / Math.PI; if (hd < 0) hd += 360; Hh[i] = hd; }
  // the sky: smooth, not warm-coloured, not near-white; grown from the top rows
  const C0 = new Float32Array(n), H0 = new Float32Array(n);
  for (let i = 0; i < n; i++) { C0[i] = Math.hypot(A0[i], B0[i]); let hd = Math.atan2(B0[i], A0[i]) * 180 / Math.PI; if (hd < 0) hd += 360; H0[i] = hd; }
  /* The region itself grows on the thumbnail as it is, not smoothed: smoothing let it creep across low-contrast edges into
     walls, rock and trees. The thumbnail is already an average of many preview pixels, which is what tames the noise. */
  const ok = i => { const warm = C0[i] > 0.035 && (H0[i] > 340 || H0[i] < 130); return !warm && L0[i] < 0.80; };
  const flat = (i, xx, y) => { for (let q = 0; q < 4; q++) { const nx = xx + (q === 0 ? 1 : q === 1 ? -1 : 0), ny = y + (q === 2 ? 1 : q === 3 ? -1 : 0); if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue; const j = ny * w + nx; if (Math.hypot(L[j] - L[i], A[j] - A[i], B[j] - B[i]) > 0.03) return false; } return true; };   // seeds judged on the smoothed copy, so grain does not stop a sky from starting
  let mask = new Uint8Array(n); const seen = new Uint8Array(n), queue = new Int32Array(n); let qh = 0, qt = 0, cnt = 0, sumL = 0, sumA = 0, sumB = 0;
  const rows = Math.max(2, Math.floor(h * 0.05));
  for (let y = 0; y < rows; y++) for (let xx = 0; xx < w; xx++) { const i = y * w + xx; if (ok(i) && flat(i, xx, y)) { mask[i] = 1; seen[i] = 1; queue[qt++] = i; sumL += L0[i]; sumA += A0[i]; sumB += B0[i]; cnt++; } }
  let skyL = 0.5, skyLab = [0.5, 0, 0];
  /* How grainy is the sky? Measured where the region starts, as the typical step between neighbouring top-row pixels, so a
     noisy RAW sky can still be grown across while a real edge (a roof line, a tree, the horizon) still stops it. */
  let stepTol = 0.022;
  if (cnt) {
    const st = []; for (let y = 0; y < rows; y++) for (let xx = 0; xx < w - 1; xx++) { const i = y * w + xx; if (mask[i] && mask[i + 1]) st.push(Math.hypot(L0[i + 1] - L0[i], A0[i + 1] - A0[i], B0[i + 1] - B0[i])); }
    st.sort((p, q) => p - q); if (st.length > 20) stepTol = Math.max(0.022, Math.min(0.05, 3.2 * st[Math.floor(st.length / 2)]));
  }
  if (cnt) {
    const mL = sumL / cnt, mA = sumA / cnt, mB = sumB / cnt;
    while (qh < qt) {
      const i = queue[qh++], y = (i / w) | 0, xx = i - y * w;
      for (let q = 0; q < 4; q++) {
        const nx = xx + (q === 0 ? 1 : q === 1 ? -1 : 0), ny = y + (q === 2 ? 1 : q === 3 ? -1 : 0);
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue; const j = ny * w + nx; if (seen[j]) continue; seen[j] = 1;
        const step = Math.hypot(L0[j] - L0[i], A0[j] - A0[i], B0[j] - B0[i]);
        if (step < stepTol && ok(j) && Math.hypot(0.4 * (L0[j] - mL), A0[j] - mA, B0[j] - mB) < 0.16) { mask[j] = 1; queue[qt++] = j; }   // lightness counts for less: haze makes the sky much lighter toward the horizon without changing its colour, and it is still sky
      }
    }
    // close small holes left by noise and wisps: grow by 2 pixels, then shrink by 2
    const morph = (m0, grow) => { const o = new Uint8Array(n); for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { let any = grow ? 0 : 1; for (let dy = -2; dy <= 2 && (grow ? !any : any); dy++) for (let dx = -2; dx <= 2; dx++) { const y2 = Math.min(h - 1, Math.max(0, y + dy)), x2 = Math.min(w - 1, Math.max(0, xx + dx)); const v = m0[y2 * w + x2]; if (grow && v) { any = 1; break; } if (!grow && !v) { any = 0; break; } } o[y * w + xx] = any; } return o; };
    mask = morph(morph(mask, true), false);
    const ls = []; for (let i = 0; i < n; i++) if (mask[i]) ls.push(L[i]); ls.sort((p, q) => p - q); if (ls.length) skyL = ls[Math.floor(ls.length / 2)];
    { let sL = 0, sA = 0, sB = 0, c2 = 0; for (let i = 0; i < n; i++) if (mask[i] && L[i] < skyL + 0.06) { sL += L[i]; sA += A[i]; sB += B[i]; c2++; } if (c2) skyLab = [sL / c2, sA / c2, sB / c2]; }
  }
  // soft sky edge
  const skyF = box(box(Float32Array.from(mask), 2), 2);
  // foliage: from the smoothed colour, coloured purples through reds, minus the sky; softened the same way
  const fol0 = new Float32Array(n);
  const sstep = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) { const hh = Hh[i] < 180 ? Hh[i] + 360 : Hh[i]; const win = sstep(292, 306, hh) * (1 - sstep(402, 422, hh)); fol0[i] = win * sstep(0.03, 0.065, Cc[i]) * (1 - skyF[i]); }
  const folF = fol0;   // no extra softening: the texture's own interpolation is enough, and grey rock inside foliage stays grey
  // the selection widened by 3 pixels of this small copy (about 1% of the width) for the border band the shader refines by colour
  const wide = new Uint8Array(n); for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { let on = 0; for (let dy = -3; dy <= 3 && !on; dy++) for (let dx = -3; dx <= 3; dx++) { const x2 = xx + dx, y2 = y + dy; if (x2 >= 0 && x2 < w && y2 >= 0 && y2 < h && mask[y2 * w + x2]) { on = 1; break; } } wide[y * w + xx] = on; }
  const wideF = box(Float32Array.from(wide), 1);
  /* The local sky colour: around each point, the average colour of the sky pixels near it (a wide box over the selection),
     falling back to the overall sky colour where no sky is near. Packed as L, (a+0.25)*2, (b+0.25)*2 into 0..1. */
  const rad = Math.max(4, Math.round(w * 0.03)), mF = Float32Array.from(mask), mL0 = new Float32Array(n), mA0 = new Float32Array(n), mB0 = new Float32Array(n);
  for (let i = 0; i < n; i++) { if (mask[i]) { mL0[i] = L0[i]; mA0[i] = A0[i]; mB0[i] = B0[i]; } }
  const sM = box(mF, rad), sLs = box(mL0, rad), sAs = box(mA0, rad), sBs = box(mB0, rad), col = new Uint8Array(n * 4);
  /* The sky's own lightness around each point, with clouds left out: a wide average over the sky, then again without the
     pixels clearly brighter than that first average. Haze that brightens the sky toward the horizon is part of this level,
     so it is darkened with the rest of the sky; only things brighter than the sky around them (clouds) are kept. Judging
     clouds against one level for the whole sky treated the brighter band above the horizon as cloud and left it light: the
     glowing line between sky and land. */
  const radL = Math.max(6, Math.round(w * 0.06)), mW1 = new Float32Array(n), mL1 = new Float32Array(n);
  for (let i = 0; i < n; i++) if (mask[i]) { mW1[i] = 1; mL1[i] = L[i]; }
  const bW1 = box(mW1, radL), bL1 = box(mL1, radL), mW2 = new Float32Array(n), mL2 = new Float32Array(n);
  for (let i = 0; i < n; i++) { const base = bW1[i] > 0.02 ? bL1[i] / bW1[i] : skyL; if (mask[i] && L[i] <= base + 0.08) { mW2[i] = 1; mL2[i] = L[i]; } }
  const bW2 = box(mW2, radL), bL2 = box(mL2, radL);
  for (let i = 0; i < n; i++) {
    const q = v => Math.round(Math.max(0, Math.min(1, v)) * 255);
    const local = bW2[i] > 0.02 ? bL2[i] / bW2[i] : (bW1[i] > 0.02 ? bL1[i] / bW1[i] : skyL);
    col[i * 4] = q(L[i]); col[i * 4 + 1] = q((A[i] + 0.25) * 2); col[i * 4 + 2] = q((B[i] + 0.25) * 2); col[i * 4 + 3] = q(local);   // RGB: the guide, this pixel's own (lightly smoothed) colour; A: the sky's level around it
  }
  const data = new Uint8Array(n * 4); let cover = 0;
  /* The selection is grown by one pixel of the small copy before it is used as the yes/no answer for the full-size edge:
     the pixels straddling the skyline are part sky, and leaving them out made the sky right against the land a shade lighter.
     The colour match in the shader keeps the land side out, because land pixels match the pure-land pixels beyond. */
  const grown = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { let on = 0; for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) { const x2 = xx + dx, y2 = y + dy; if (x2 >= 0 && x2 < w && y2 >= 0 && y2 < h && mask[y2 * w + x2]) { on = 1; break; } } grown[y * w + xx] = on; }
  for (let i = 0; i < n; i++) { const cl = v => Math.round(Math.max(0, Math.min(1, v)) * 255); data[i * 4] = mask[i] ? 255 : 0; data[i * 4 + 1] = cl(folF[i]); data[i * 4 + 2] = 0; data[i * 4 + 3] = 255; cover += mask[i]; }
  return { w: w, h: h, data: data, col: col, coverage: cover / n, skyL: skyL, skyLab: skyLab };
}
function eirParams() {
  return null;   // Deep sky and Crimson foliage are removed from the app; their inputs stay (hidden) only so saved sessions keep their slots
  const sky = (+($('skyDeep') && $('skyDeep').value) || 0) / 100, fol = (+($('crimsonFol') && $('crimsonFol').value) || 0) / 100;
  if (!(sky > 0 || fol > 0 || EIR.show)) return null;
  if (!EIR.mask || EIR.gen !== loadToken || EIR.imgGen !== epdImageGen) {
    const m = skyMaskCompute(); if (!m) return null;
    EIR.mask = { id: ++EIR.id, w: m.w, h: m.h, data: m.data, col: m.col, skyL: m.skyL, skyLab: m.skyLab }; EIR.coverage = m.coverage; EIR.gen = loadToken; EIR.imgGen = epdImageGen;
  }
  return { sky: sky, fol: fol, show: EIR.show, mask: EIR.mask };
}
(function wireEirShow() { const sh = $('chkSkyShow'); if (sh) sh.addEventListener('change', () => { EIR.show = sh.checked; render(); }); })();

/* ---------- tone mapping (EPD): state, and when the base has to be worked out again ----------
   Strength is live: it only changes three numbers. The base layer depends on the picture, so it is worked out again
   (in the background, a moment after you stop) when Edge stopping or Scale change, when a new picture or a new
   version of it (rotate, RAW rebuild) appears, and when something that comes before it in the pipeline changes (the
   swap, white balance, local contrast, noise reduction). Until the new one arrives the old one stays on screen,
   unless the picture itself has changed shape, in which case the effect waits for the new base. */
let epdImageGen = 0, epdSeq = 0, epdBusy = false, epdTimer = null, epdBaseId = 0;
const epdState = { base: null, norm: 1, key: '', gen: -1, imgGen: -1, refEV: 0 };
const EPD_ITERATES = 5, EPD_WORK_EDGE = 1024;
function epdStrength() { return 0; }   // build 202: tone mapping removed (too slow on a phone); saved edits that used it now open without it
function epdKey(P) {
  return JSON.stringify([P.matrix, P.mOffset, P.preWB, P.postWB, P.preWBM, P.postWBM, P.camCoef, P.wbMethod, P.lumPreserve, P.filmOn, P.lumaW, P.tempTint,
    P.noiseReduction, P.noiseColour, P.deband, P.sharpen, P.clarity, P.dehaze, (typeof dustSpots !== "undefined" ? JSON.stringify(dustSpots) : ""), P.swapSpace, P.swapWiden, P.indexMode, P.hotspot, P.hotSize, P.caR, P.caB,
    P.calRH, P.calGH, P.calBH, P.calRS, P.calGS, P.calBS, P.calST, P.bands, P.hueSpace,
    $('epdEdge') ? $('epdEdge').value : '', $('epdScale') ? $('epdScale').value : '',
    // raising exposure above what the base was measured at may clip more; lowering it never does
    (epdState.base && (+P.exposure || 0) > epdState.refEV + 0.0005) ? 'ex' + (+P.exposure).toFixed(3) : 'ok']);
}
function epdParams() {
  const st = epdStrength(), S = epdState;
  if (!st || !S.base || S.gen !== loadToken || S.imgGen !== epdImageGen) return null;
  const comp = Math.exp(-st), boost = Math.max(st, 0);
  let temp; if (boost > 0) { const bt = Math.exp(-(2 - boost + 0.693147)) - 1; temp = 1.2 * Math.log(-bt); } else temp = comp - 1;
  const k = Math.pow(comp, 1.5856), sat = (1 + 38.7889) * k / (1 + 38.7889 * k);
  return { on: true, temp: temp, boost: boost, s: sat, norm: S.norm, base: S.base, ref: Math.pow(2, S.refEV) };
}
function setEpdStatus(t) { const e = $('epdStatus'); if (e) e.textContent = t || ''; }
function epdWatch(P) {
  if (!epdStrength() || epdBusy || !engine || !engine.isWebGL2) return;
  const S = epdState;
  if (S.base && S.gen === loadToken && S.imgGen === epdImageGen && S.key === epdKey(P)) return;
  scheduleEpd();
}
function scheduleEpd(delay) {
  if (epdTimer) clearTimeout(epdTimer);
  epdTimer = setTimeout(() => { epdTimer = null; if (sliderDragging) { scheduleEpd(300); return; } runEpd(); }, delay === undefined ? 450 : delay);
}
/* the lightness image the tone mapping sees, reduced to working size and normalised to its own maximum */
function epdMeasure(px, cw, ch) {
  let mx = 0; const n = cw * ch;
  for (let i = 0; i < n; i++) { const v = px[i * 4]; if (v > mx) mx = v; }
  if (mx <= 0) return null;
  const f = Math.max(1, Math.ceil(Math.max(cw, ch) / EPD_WORK_EDGE)), lw = Math.max(8, Math.floor(cw / f)), lh = Math.max(8, Math.floor(ch / f));
  const Ln = new Float32Array(lw * lh);
  for (let y = 0; y < lh; y++) {
    const y0 = Math.floor(y * ch / lh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ch / lh));
    for (let x = 0; x < lw; x++) {
      const x0 = Math.floor(x * cw / lw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * cw / lw));
      let sum = 0, cnt = 0;
      for (let yy = y0; yy < y1; yy++) { const b = yy * cw; for (let xx = x0; xx < x1; xx++) { sum += px[(b + xx) * 4]; cnt++; } }
      Ln[y * lw + x] = sum / (cnt * mx);
    }
  }
  return { Ln: Ln, w: lw, h: lh, mx: mx };
}
function epdProbePixels() {
  const P0 = currentParams(), refEV = Math.max(0, +P0.exposure || 0);
  const probe = Object.assign({}, P0, { exposure: refEV, epdRef: Math.pow(2, refEV), epd: null, epdProbe: true, clipView: false, dither: false, maskView: -1, bandPreview: null, gamutDrag: false });
  const cw = engine.canvas.width, ch = engine.canvas.height;
  let px = null; try { px = engine.renderHiPrec(probe); } catch (e) { px = null; }
  if (!px) {   // no 16-bit render here: the 8-bit canvas will do, coarser in the deepest shadows
    engine.render(probe); const b8 = engine.readPixels(); px = new Uint16Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) { const s = (ch - 1 - y) * cw * 4, d = y * cw * 4; for (let i = 0; i < cw * 4; i++) px[d + i] = b8[s + i] * 257; }
  }
  render();   // put the real picture back on the canvas
  return { px: px, cw: cw, ch: ch, P0: P0, refEV: refEV };
}
async function runEpd() {
  if (!engine || !loadedImage || epdBusy || !engine.isWebGL2) return;
  epdBusy = true; const my = ++epdSeq, gen = loadToken, img = epdImageGen;
  setEpdStatus('Working out the tone map\u2026');
  try {
    const pr = epdProbePixels(), m = epdMeasure(pr.px, pr.cw, pr.ch);
    if (!m) { epdState.base = null; return; }
    const origLong = Math.max(origW || 0, origH || 0, pr.cw, pr.ch), skip = Math.max(1, origLong / Math.max(m.w, m.h));
    const scale = ((+$('epdScale').value || 100) / 100) / skip, edge = (+$('epdEdge').value || 140) / 100;
    const u = await runEpdWorker(m.Ln, m.w, m.h, scale, edge, EPD_ITERATES);
    if (my !== epdSeq || gen !== loadToken || img !== epdImageGen) return;   // superseded
    epdState.base = { id: ++epdBaseId, data: u, w: m.w, h: m.h }; epdState.norm = 65535 / m.mx; epdState.refEV = pr.refEV;
    epdState.key = epdKey(pr.P0); epdState.gen = gen; epdState.imgGen = img;
  } catch (e) { toast('Tone mapping failed (' + (e && e.message || e) + ')', true); }
  finally {
    epdBusy = false; setEpdStatus('');
    if (my === epdSeq) render();
  }
}
/* Synchronous version of the base solve, for the built-in self-test only (the app itself always uses the worker). */
function epdComputeSync() {
  const pr = epdProbePixels(), m = epdMeasure(pr.px, pr.cw, pr.ch); if (!m) return false;
  const skip = Math.max(1, Math.max(pr.cw, pr.ch) / Math.max(m.w, m.h));
  const u = rtEpdBase(m.Ln, m.w, m.h, ((+$('epdScale').value || 100) / 100) / skip, (+$('epdEdge').value || 140) / 100, EPD_ITERATES);
  epdState.base = { id: ++epdBaseId, data: u, w: m.w, h: m.h }; epdState.norm = 65535 / m.mx; epdState.refEV = pr.refEV;
  epdState.key = epdKey(pr.P0); epdState.gen = loadToken; epdState.imgGen = epdImageGen; return true;
}
(function wireEpd() {
  const amt = $('epdAmt'), edge = $('epdEdge'), scl = $('epdScale'); if (!amt) return;
  amt.addEventListener('change', () => { if (epdStrength() && !epdParams()) scheduleEpd(0); });
  [edge, scl].forEach(e => e && e.addEventListener('change', () => { epdState.key = ''; if (epdStrength()) scheduleEpd(0); }));
  const lab = () => { if ($('v_epdEdge')) $('v_epdEdge').textContent = ((+edge.value || 0) / 100).toFixed(2); if ($('v_epdScale')) $('v_epdScale').textContent = ((+scl.value || 0) / 100).toFixed(2); if ($('v_epdAmt')) $('v_epdAmt').textContent = ((+amt.value || 0) / 100).toFixed(2); };
  [amt, edge, scl].forEach(e => e.addEventListener('input', lab)); lab(); window.syncEpdLabels = lab;
})();

/* ---------- per-panel reset ----------
   Each step panel has a "Reset panel" button at its top. It puts just that panel back to how it starts, as one
   undo step, and leaves every other panel alone. */
const PANEL_STEPS = ['swap', 'targeted', 'wb', 'light', 'colour', 'detail'];
const PANEL_NAMES = { swap: 'Channel swap', targeted: 'Targeted colour', wb: 'White balance', light: 'Light', colour: 'Colour', detail: 'Detail' };
function panelEl(step) { return document.querySelector('details.stepPanel[data-step="' + step + '"]'); }
function inPanel(el, step) { const P = panelEl(step); return !!(P && el && P.contains(el)); }
const qs = sel => sel[0] === '.' || sel[0] === '[' ? document.querySelector(sel) : $(sel);
/* Reset one panel: take what Reset all would give, but keep it only for the settings this panel owns. */
const PANEL_FIELDS = [
  [['m', 'mOff'], 'm00'], [['lumPreserve'], 'lumPreserve'], [['lumaW'], 'lumaR'], [['filmOn'], 'filmOn'], [['filmTone'], 'chkFilmTone'],
  [['indexMode'], '.idxBtn'], [['activePreset'], '.pb'], [['bands'], 'bandList'], [['preWB', 'postWB', 'preWBM', 'postWBM', 'wbMethod'], 'wbPreStatus'], [['rawWb'], '#rawWbBox'],
  [['curves'], 'curveCv'], [['masks'], 'maskDetails'], [['swapSpace'], 'swapSpace'], [['hueSpace'], '.hueSpaceBtn'], [['lut', 'preLUT', 'lutStatusText'], 'lutStatus'],
  [['vigCentre'], 'vigCentreNote'], [['camMatch'], 'camMatch'], [['camSpaceSwap', 'camSpaceSwapPreset'], 'camSpaceSwap'],
];
function resetPanel(step) {
  const P = panelEl(step); if (!P || !loadedImage) return;
  const keepClip = $('chkClip') ? $('chkClip').checked : false, keepCmyk = $('chkCmyk') ? $('chkCmyk').checked : false;
  armUndoCapture();
  const S = captureState();
  resetAllControls();
  const D = captureState();
  const M = Object.assign({}, S); M.s = S.s.slice();
  PANEL_FIELDS.forEach(([fields, sel]) => { const el = qs(sel); if (el && P.contains(el)) fields.forEach(f => { M[f] = D[f]; }); });
  HASH_SLIDERS.forEach((id, i) => { if (inPanel($(id), step)) M.s[i] = D.s[i]; });
  ['lumaR', 'lumaG', 'lumaB'].forEach(() => {});
  applyState(M);
  if ($('chkClip')) $('chkClip').checked = keepClip;
  if ($('chkCmyk')) $('chkCmyk').checked = keepCmyk;
  commitUndoCapture();
  toast(PANEL_NAMES[step] + ' reset');
}


(function addPanelTools() {
  PANEL_STEPS.forEach(step => {
    const P = panelEl(step); if (!P || P.querySelector('.panelTools')) return;
    const bar = document.createElement('div'); bar.className = 'panelTools';
    bar.innerHTML = (step === 'light' ? '<button type="button" class="ptAutoBtn" title="RawTherapee\u2019s Auto Levels: reads the picture\u2019s histogram and sets Exposure, Black point, Brightness, Contrast and Highlights. Shadows, White point, the tone curve and masks are left as they are. One undo step.">\u2726 Auto levels</button>' : '') + '<button type="button" class="ptResetBtn" title="Put just this panel back to how it starts (one undo step)">\u21ba Reset panel</button>';
    const sum = P.querySelector(':scope > summary');
    P.insertBefore(bar, sum ? sum.nextSibling : P.firstChild);
    bar.querySelector('.ptResetBtn').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); resetPanel(step); });
    const ab = bar.querySelector('.ptAutoBtn'); if (ab) ab.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); autoLevels(); });
  });
})();

/* Build 127: the folded Decode line on the home page says what is set. */
(function labDecSummary() {
  const out = $('labDecSumTxt'); if (!out) return;
  const q = $('cr2PreferPreview'), w = $('camSpaceSwap'), d = $('demosaicSel');
  const upd = () => {
    const t = (I18N[uiLang] || I18N.en), parts = [d && d.value === 'rcd' ? 'RCD' : 'AMaZE'];
    parts.push(q && q.checked ? (t.decQuick || 'quick preview') : (t.decFull || 'full sensor'));
    if (w && w.checked) parts.push(t.decWide || 'wide-gamut swap');
    out.textContent = parts.join(' \u00b7 ');
  };
  [q, w, d].forEach(e => e && e.addEventListener('change', upd));
  const ls = $('uiLang'); if (ls) ls.addEventListener('change', () => setTimeout(upd, 0));
  document.addEventListener('DOMContentLoaded', () => setTimeout(upd, 0));
  upd();
})();
/* Build 126: the home prompt's status line names the RAW decoder currently chosen. */
(function ltDecoderName() {
  const out = $('ltDecoder'), sel = $('demosaicSel'); if (!out) return;
  const upd = () => { const v = sel ? sel.value : (typeof demosaicPref === 'function' ? demosaicPref() : 'amaze'); out.textContent = v === 'rcd' ? 'RCD' : 'AMaZE'; };
  if (sel) sel.addEventListener('change', upd);
  upd();
})();
/* Build 121: each section's Reset panel (and Light's Auto levels) moves into its header as small buttons, so it no longer
   takes a row of its own. The handlers stay on the same buttons. */
(function panelToolsIntoHeader() {
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  PANEL_STEPS.forEach(step => {
    const P = panelEl(step); if (!P) return;
    const sum = P.querySelector(':scope > summary'), bar = P.querySelector(':scope > .panelTools'); if (!sum || !bar) return;
    const acts = document.createElement('span'); acts.className = 'hdrActs';
    const ab = bar.querySelector('.ptAutoBtn'); if (ab) { ab.textContent = '\u2726 Auto'; ab.setAttribute('data-i18n', 'autoShort'); acts.appendChild(ab); }
    const rb = bar.querySelector('.ptResetBtn');
    if (rb) { rb.innerHTML = icon; rb.setAttribute('aria-label', 'Reset ' + PANEL_NAMES[step].toLowerCase()); rb.title = 'Reset ' + PANEL_NAMES[step].toLowerCase() + ' (one undo step)'; acts.appendChild(rb); }
    const dot = sum.querySelector('.stepDot');
    sum.insertBefore(acts, dot || null);
    bar.remove();
  });
  /* On a phone, Light and Detail are the only section in their tab: their header is a label, not a fold. */
  document.addEventListener('click', e => {
    const s = e.target.closest && e.target.closest('#reorderZone > [data-solo] > summary');
    if (s && (document.documentElement.classList.contains('dockOn') || document.documentElement.classList.contains('studioOn')) && !e.target.closest('button')) e.preventDefault();
  }, true);
})();
/* Build 121: the decode / white-balance stamp, shown in Export > Decode settings instead of over the photo on a phone. */
(function decodeInfoMirror() {
  const out = $('decodeInfo'), a = $('decoderBadge'), b = $('implicitStamp'); if (!out || !a || !b) return;
  const upd = () => { out.textContent = [a.textContent.trim(), b.textContent.trim()].filter(Boolean).join('  \u00b7  '); };
  const mo = new MutationObserver(upd);
  [a, b].forEach(e => mo.observe(e, { childList: true, characterData: true, subtree: true }));
  upd();
})();
if (typeof WebGLEngine !== 'undefined') {
  const _epdSetImage = WebGLEngine.prototype.setImage;
  WebGLEngine.prototype.setImage = function (img) { if (typeof engine !== 'undefined' && this === engine) epdImageGen++; return _epdSetImage.call(this, img); };
}
function currentParams() {
  return {
    matrix: getMatrixUI(),
    mOffset: getMatrixOffsetUI(),
    bands: targetedBands,
    preWB: rtwbPreWB(preWB),   // build 197: a RAW white balance mid-change, previewed as gains until the rebuild lands
    postWB: postWB,
    preWBM: rtwbPreWBM(preWBM),
    postWBM: postWBM,
    // only applied when the toggle is on AND a fit exists for this file
    camCoef: (camCoef && camMatchOn) ? camCoef : null,
    wbMethod: wbMethod,
    hueSpace: hueSpace,
    lumPreserve: lumPreserve,
    filmOn: filmOn,
    preLUTUser: !!preLUTUser,   // gates the early LUT stage for a user LUT
    lumaW: getLumaW(),   // drives the u_lumaW upload each render
    tempTint: tempTintGains(),
    exposure: +$('bright').value || 0,
    brightness: lightVal('brightness'),
    hue: +$('hue').value || 0,
    /* +v || 100, not (+v)||100 — Saturation 0 is a real, meaningful value
       (fully desaturated), but 0 is falsy in JS, so || silently substituted
       100 the moment the slider hit its own minimum. That produced two
       confusing symptoms from one bug: dragging to 0 snapped back to full
       colour, and depending on exactly where a drag released, the low end
       could read as either "stuck at full colour" or "suddenly grey" since
       nothing between the true 0 and 1 was ever actually reachable at 0
       itself. isFinite is what "did this field parse", not truthiness. */
    sat: (v => isFinite(v) ? v : 100)(+$('sat').value),
    blackPt: lightVal('blackPt'),
    whitePt: lightVal('whitePt'),
    noiseReduction: +$('noiseReduction').value || 0,
    /* Without this the uniform was uploaded as (undefined || 0) on every
       render, so the shader's recovery block never ran and the slider did
       nothing at all. The shader, the uniform location and the upload were
       all correct; the value simply never left the DOM. */
    sharpen: +$('sharpen').value || 0,
    sharpenRadius: +$('sharpenRadius').value,
    sharpenMask: +$('sharpenMask').value,
    clarity: +$('clarity').value || 0,
    dehaze:    +($('dehaze')    ? $('dehaze').value    : 0) || 0,
    orton:     ($('orton') ? +$('orton').value : 0) / 100,                       // build 184
    ortonSoft: ($('ortonSoft') ? +$('ortonSoft').value : 50) / 100,
    calRH:     +($('calRH')    ? $('calRH').value    : 0) || 0,
    calGH:     +($('calGH')    ? $('calGH').value    : 0) || 0,
    calBH:     +($('calBH')    ? $('calBH').value    : 0) || 0,
    calRS:     +($('calRS')    ? $('calRS').value    : 0) || 0,
    calGS:     +($('calGS')    ? $('calGS').value    : 0) || 0,
    calBS:     +($('calBS')    ? $('calBS').value    : 0) || 0,
    calST:     +($('calST')    ? $('calST').value    : 0) || 0,
    swapSpace: $('swapSpace') ? +$('swapSpace').value : 2,
    swapWiden: $('swapWiden') ? (+$('swapWiden').value) / 100 : 1,
    noiseColour: +$('noiseColour').value || 0,
    satPreserve: +($('satPreserve') && $('satPreserve').value) || 0,
    vibrance: +($('vibrance') && $('vibrance').value) || 0,
    contrast: contrastUI(),
    highlights: lightVal('highlights'),
    shadows: lightVal('shadows'),
    vigAmt: 0,   // Vignette was removed (build 110); a value from an old session or preset is ignored
    vigFall: (v => isFinite(v) ? v : 20)(+($('vigFall') && $('vigFall').value)) / 10,
    vigSpread: (v => isFinite(v) ? v : 55)(+($('vigSpread') && $('vigSpread').value)) / 100,
    vigCX: vigCentre[0], vigCY: vigCentre[1],
    contrastPivot: contrastPivot,
    indexMode: indexMode,
    lutMix: lutMixUI(),
    clipView: !!(($('chkClip') && $('chkClip').checked) || clipPeek),
    // checkbox gates it, slider sets how far — off means zero regardless
    filmTone: filmToneOn ? (+($('filmToneAmt') && $('filmToneAmt').value) || 0) : 0,
    cmykWarn: !!($('chkCmyk') && $('chkCmyk').checked),
    gamutDrag: gamutDragActive(),
    dither: true,
    dustView: typeof dustShow !== 'undefined' && dustShow,   // build 185, preview only
    masks: maskUniformData(), maskView: maskViewIndex(),
    curveOn: !curveAllIdentity(), curveKey: getCurveLut().key, curveLut: getCurveLut().lut,
    caR: ((+($('caR') && $('caR').value) || 0) / 100) * 0.005,
    caB: ((+($('caB') && $('caB').value) || 0) / 100) * 0.005,
    hotspot: [(+($('hotR') && $('hotR').value) || 0) / 100, (+($('hotG') && $('hotG').value) || 0) / 100, (+($('hotB') && $('hotB').value) || 0) / 100],
    hotSize: (+($('hotSize') && $('hotSize').value) || 35) / 100,
    bandPreview: bandPreviewIndex,
    hiPivot: rangeHiPivot(), shW: rangeShW(),
    epd: epdParams(),
    deband: (+($('debandAmt') && $('debandAmt').value) || 0) / 100,
    eir: eirParams(),
    curveLum: !!curveState.lum,
    hsl: hslParams(),
    irSub: (typeof irLeakMatrix === 'function') ? irLeakMatrix() : null   // build 172
  };
}

// The overlay is a diagnostic, never an output. Every export path renders
// through this instead of currentParams() so a forgotten checkbox can't
// silently write red hatching into someone's TIFF.
function exportParams() { return Object.assign(currentParams(), { preWB: preWB, preWBM: preWBM, clipView: false, gamutDrag: false, dither: false, dustView: false, maskView: -1, bandPreview: null }); }
function lutMixUI() { const e = $('lutMix'); return (e ? (+e.value || 0) : 100) / 100; }

/* Keeps every slider's fill in sync with its value. The native accent-color
   fill this replaced updated itself automatically no matter how a value
   changed — dragging, a preset, undo, the long-press numeric editor, Reset
   all. A hand-drawn fill has no such built-in awareness, and the ~24 places
   in this file that can set a slider's .value are not a list anyone wants
   to keep finding and re-visiting one at a time. render() already runs
   after every one of them, so this rides along with it instead: one place,
   correct regardless of which of the 24 actually fired. */
function syncSliderFill(el) {
  if (!el) return;
  const min = +el.min || 0, max = +el.max || 100, v = +el.value || 0;
  const pct = max > min ? (v - min) / (max - min) * 100 : 0;
  el.style.setProperty('--val', pct);
}
/* Full pass: only needed when many sliders change at once (load, reset,
   undo/redo, preset). The per-slider input listener updates just its own
   track, so a drag no longer rewrites ~50 elements' styles per event. */
function syncSliderFills() {
  document.querySelectorAll('input[type=range]').forEach(syncSliderFill);
}
/* render() is frame-coalesced. A slider drag fires 'input' at 60-120 Hz,
   but the display only shows one frame per vsync -- every engine.render()
   beyond the last in a frame is GPU work nobody sees. Callers keep calling
   render() as before; the actual draw happens once in the next animation
   frame. renderNow() is the synchronous path for anything that must read
   the result immediately (export, measurement). */
let renderPending = false, renderNeedsFillSync = false;

/* ---- draft rendering while a slider is held ----
   While any range slider is being dragged the preview is drawn at the
   size it is shown on screen instead of
   the full canvas resolution, and a full-quality frame is drawn the moment
   the finger or mouse is released — or after the drag has paused for a
   moment, so stopping on a value to judge it always shows the real thing.
   Images already no larger than that are left alone. */
let sliderDragging = false, draggedSliderId = '', draftShown = false, draftIdleTimer = null, gamutWarnShown = false;
const GAMUT_DRAG_IDS = ['sat', 'vibrance', 'hue', 'satPreserve'];
function gamutDragActive() { return sliderDragging && GAMUT_DRAG_IDS.indexOf(draggedSliderId) >= 0; }
function draftScale() {
  if (!engine || !engine.canvas) return 1;
  const W = engine.canvas.width, H = engine.canvas.height;
  const r = engine.canvas.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return 1;   // hidden canvas: nothing to size against
  /* Build 131: at the size it is shown, not 0.75 of it. A draft below screen resolution, stretched up with smoothing,
     had about 30% less brightness grain and 40% less colour grain on screen than the real frame, so grain popped back
     in when the slider was let go. At screen size, stretched without smoothing (renderScaled), the draft's grain
     measures within about 4% of the final frame's. It is still about a third of the work of a full-size frame. */
  const shown = Math.max(r.width, r.height) * (window.devicePixelRatio || 1);
  const s = Math.max(W, H) > 0 ? shown / Math.max(W, H) : 1;
  return s > 0.85 ? 1 : Math.max(0.25, s);
}
function settleFullRes() {
  if (draftIdleTimer) { clearTimeout(draftIdleTimer); draftIdleTimer = null; }
  if ((!draftShown && !gamutWarnShown) || !engine || !loadedImage) { draftShown = false; gamutWarnShown = false; return; }
  draftShown = false; gamutWarnShown = false;
  engine.render(currentParams());
  scheduleHistogram();
}
document.addEventListener('pointerdown', e => {
  if (e.target && e.target.matches && e.target.matches('.sl input[type=range]')) { sliderDragging = true; draggedSliderId = e.target.id; }
}, true);
['pointerup', 'pointercancel'].forEach(t => window.addEventListener(t, () => {
  if (!sliderDragging) return;
  sliderDragging = false;
  settleFullRes();
  draggedSliderId = '';
}, true));

function render(fromSlider) {
  /* Slider listeners already synced their own track; every other caller
     (undo, reset, preset, load) may have changed many sliders at once. */
  if (!fromSlider) renderNeedsFillSync = true;
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(renderNow);
}
function renderNow() {
  renderPending = false;
  if (renderNeedsFillSync) { renderNeedsFillSync = false; syncSliderFills(); }
  updateImplicitStamp();
  if (!engine || !loadedImage) return;
  const dsc = sliderDragging ? draftScale() : 1;
  const P = currentParams();
  epdWatch(P);
  if (dsc < 1 && engine.renderScaled) {
    engine.renderScaled(P, dsc);
    draftShown = true;
    if (draftIdleTimer) clearTimeout(draftIdleTimer);
    draftIdleTimer = setTimeout(settleFullRes, 220);
  } else {
    engine.render(P);
    draftShown = false;
  }
  gamutWarnShown = gamutDragActive();
  scheduleHistogram();
  saveSessionState();
  if ($('previewFullscreen').classList.contains('on')) scheduleFullscreenHQ();
}
/* Build 212: the white balance card (readout, buttons, tracks painted from the photo) and the working-space words are
   refreshed a moment after the render parameters are built, and not at all while a slider is held: the tracks are worked out from the whole
   colour pipeline, which is too much to redo on every frame of a drag. */
let wbUiTimer = null, wbUiRunning = false;
function wbUiSoon() {   // called from tempTintGains(), so every path that builds the render parameters schedules it
  if (wbUiRunning || wbUiTimer) return;   // already due (the parameters are read often, so a reset timer never fired),
  wbUiTimer = setTimeout(function run() {   // and the refresh itself reads the parameters without scheduling another
    if (sliderDragging) { wbUiTimer = setTimeout(run, 150); return; }
    wbUiTimer = null; wbUiRunning = true;
    try { if (typeof rtwbSyncUi === 'function') rtwbSyncUi(); } catch (e) {}
    try { if (typeof wsTabsSync === 'function') wsTabsSync(); } catch (e) {}
    wbUiRunning = false;
  }, 120);
}
/* Build 214: the Kelvin and Tint card used to appear because the card was refreshed on every frame. Now it is
   refreshed when a RAW opens, and again every 300 ms (for up to 15 s) until the RAW's sensor data is ready, so it no
   longer waits for something else to happen first. */
(function wbUiOnRawOpen() {
  let tries = 0, t = null;
  const poll = () => {
    t = null;
    if (!document.body.classList.contains('rawOpen')) return;
    let ready = false; try { ready = typeof rtwbRes === 'function' && !!rtwbRes(); } catch (e) {}
    if (ready && !wbUiRunning) { wbUiRunning = true; try { rtwbSyncUi(); wsTabsSync(); } catch (e) {} wbUiRunning = false; }
    const box = $('rawWbBox');
    if (ready && box && !box.hidden) return;
    if (++tries < 50) t = setTimeout(poll, 300);
  };
  let was = false;
  new MutationObserver(() => {
    const now = document.body.classList.contains('rawOpen');
    if (now && !was) { tries = 0; if (t) clearTimeout(t); t = setTimeout(poll, 50); }
    was = now;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();

// See the CSS comment on #implicitStamp for why this exists. wbPreStatus's
// own text already distinguishes the three states this cares about ("Auto
// ..." on load, "Set ✓ ..." after an explicit pick, "Pre-WB: Not set"
// after Clear Pre) -- reading it here instead of tracking a separate flag
// means this can't drift out of sync with what that text already says.
function updateImplicitStamp() {
  const el = $('implicitStamp');
  const status = $('wbPreStatus');
  if (!el || !status) return;
  const text = status.textContent || '';
  if (text.indexOf('Auto') === 0) {
    // wbPreStatus already spells out which technique ran, e.g.
    // "Auto ✔ (eigenvector) — pick a neutral to override it" -- read it
    // from there directly rather than tracking a second copy of the same
    // fact, which is exactly the kind of duplication that caused the
    // eigenvector-doubling bug earlier this session.
    const m = text.match(/\(([^)]+)\)/);
    const technique = m ? m[1].toUpperCase() : 'AUTO';
    el.textContent = 'IMPLICIT: ' + technique + ' WB';
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

/* Sharpening radius is stored in tenths of a texel so the range slider can
   step finely, but it reads as a radius in pixels -- 10 on the element means
   1.0 on screen, matching how every other tool labels this. Everything else
   displays its raw value. */
/* Build 190: Temperature and Tint run on a curve. Both sliders reach +-600, but most real settings sit within +-100, which
   was the middle sixth of the slider, a few millimetres of thumb on a phone. The slider now stores a POSITION
   (-600..600) and the effect is a cubic of it: about 9 positions per unit near zero, half the travel covering +-100, the
   outer half running on to +-600. The number shown, typed and used everywhere is the effect; saved sessions, presets and
   share links from before (slider-weight version below 4) hold effects and are moved to the matching position on load. */
const WB_CURVE = { temp: 1, tint: 1 };
const WB_A = 0.1111;   // linear share: 600 * (0.5a + 0.125(1-a)) = 100 at half travel
function wbEff(pos) { const u = Math.max(-1, Math.min(1, (+pos || 0) / 600)); return 600 * (WB_A * u + (1 - WB_A) * u * u * u); }
function wbPos(eff) {
  const e = Math.max(-600, Math.min(600, +eff || 0)) / 600; let u = e;
  for (let k = 0; k < 30; k++) { const f = WB_A * u + (1 - WB_A) * u * u * u - e, d = WB_A + 3 * (1 - WB_A) * u * u; u -= f / d; }
  return Math.round(600 * Math.max(-1, Math.min(1, u)));
}
function fmtSliderValue(id, v) {
  if (WB_CURVE[id]) return Math.round(wbEff(v));
  return id === 'sharpenRadius' ? (v / 10).toFixed(1) : v;
}
['orton','ortonSoft','hotR','hotG','hotB','hotSize','caR','caB','swapWiden','bright','hue','sat','vibrance','filmToneAmt','blackPt','whitePt','noiseReduction','clarity','dehaze','sharpen','sharpenRadius','sharpenMask','noiseColour','temp','tint','satPreserve','contrast','highlights','shadows','vigAmt','vigFall','vigSpread','lumaR','lumaG','lumaB','brightness','calRH','calGH','calBH','calRS','calGS','calBS','calST','hiRange','shRange','rawNrL','rawNrC','hslH0','hslH1','hslH2','hslH3','hslH4','hslH5','hslH6','hslH7','hslS0','hslS1','hslS2','hslS3','hslS4','hslS5','hslS6','hslS7','hslL0','hslL1','hslL2','hslL3','hslL4','hslL5','hslL6','hslL7'].forEach(id => {
  $(id).addEventListener('input', () => { const el = $(id); $('v_' + id).textContent = fmtSliderValue(id, el.value); syncSliderFill(el); render(true); });
});
MCELLS.forEach(id => $(id).addEventListener('input', () => { render(); mxSync(); }));
MOFFCELLS.forEach(id => $(id).addEventListener('input', () => { render(); mxSync(); }));

/* ---------- matrix: permutations, drag-scrub, live preview ---------- */

/* A permutation is written as which SOURCE channel feeds each output row, so
   '210' means R out takes B, G out takes G, B out takes R. Writing the nine
   cells from that keeps the buttons and the grid as one truth: the matrix is
   still fully editable afterwards and the button simply un-highlights once
   the numbers stop matching it. */
function mxApplyPerm(perm) {
  armUndoCapture();
  if (window.__eirOn) { eirUndo(); document.querySelectorAll('.pb').forEach(x => x.classList.remove('on')); }
  /* These buttons set the nine matrix numbers and nothing else. After the H.H. recipe that left its offsets (about a fifth of
     the range taken off every channel), the Encoded swap space, its bands, curve and tone settings all in place, so
     choosing Identity gave a dark picture with the blue channel crushed to zero: the olive-green cast. Picking a plain swap
     now leaves the recipe the same way picking another preset does. */
  if (typeof presetMixClear === 'function') presetMixClear();
  if (window.__hhPrev) {
    hhUndoExtras();
    document.querySelectorAll('.pb').forEach(x => x.classList.remove('on'));
    if (typeof activePresetName !== 'undefined') activePresetName = null;
    if (typeof updateClearPresetBtn === 'function') updateClearPresetBtn();
  }
  for (let r = 0; r < 3; r++) {
    const src = +perm[r];
    for (let c = 0; c < 3; c++) $('m' + r + c).value = (c === src) ? 100 : 0;
  }
  render(); mxSync();
  commitUndoCapture();
  haptic('select');
}
document.querySelectorAll('.swapBtn[data-perm]').forEach(b => {
  b.addEventListener('click', () => mxApplyPerm(b.dataset.perm));
});

/* Index mode replaces the whole image with a measurement, so the rest of the
   colour controls stop meaning anything while it is on. Rather than disable
   them all, the mode is a visible three-way switch that reads as a different
   view, and it is excluded from export the same way the clipping overlay is. */
document.querySelectorAll('.idxBtn').forEach(b => {
  b.addEventListener('click', () => {
    if (indexMode === +b.dataset.idx) return;
    armUndoCapture();
    indexMode = +b.dataset.idx;
    document.querySelectorAll('.idxBtn').forEach(x => x.classList.toggle('on', x === b));
    $('idxLegend').style.display = indexMode ? 'inline-flex' : 'none';
    $('idxTools').style.display = indexMode ? 'block' : 'none';
    indexSamples = []; renderIndexSamples();   // values are mode-specific
    if (!indexMode && pickMode === 'index') exitPick();
    render();
    commitUndoCapture();
    haptic('select');
  });
});

/* Horizontal drag scrubs a cell. Every other control in the tool moved to
   drag gestures; this panel was still nine number fields, which on a phone
   means the keyboard covering the image you are trying to judge. Vertical
   movement is left to the page so a scroll that starts on a cell still
   scrolls, matching the sliders' own rule.

   The offset cells (MOFFCELLS) get the same treatment, added when the
   fourth column was — they were still keyboard-only, the one thing left in
   this panel a phone made awkward. They get their own, gentler mapping
   rather than reusing the gain one: gains sweep ±200 across a phone width,
   and the offset is scaled down before it ever reaches the shader (full
   slider is a strong lift, see getMatrixOffsetUI), so the same 2 units/px
   would make it flick between barely-there and blown out inside a few
   millimetres of drag. */
function wireMatrixDrag(ids, range, unitsPerPixel) {
  ids.forEach(id => {
    const el = $(id);
    let g = null;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      g = { x: e.clientX, y: e.clientY, start: +el.value || 0, active: false };
    });
    el.addEventListener('pointermove', e => {
      if (!g) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.active) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) { g = null; return; }  // a scroll
        if (Math.abs(dx) < 6) return;
        g.active = true;
        el.setPointerCapture(e.pointerId);
      }
      const v = Math.max(-range, Math.min(range, Math.round((g.start + dx * unitsPerPixel) / 5) * 5));
      if (v !== +el.value) { el.value = v; render(); mxSync(); haptic('tick'); }
      e.preventDefault();
    });
    const end = e => {
      if (g && g.active) { armUndoCapture(); commitUndoCapture(); }
      if (g && g.active && el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      g = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  });
}
$('btnLumaReset')?.addEventListener('click', () => {
  armUndoCapture();
  [['lumaR',21],['lumaG',72],['lumaB',7]].forEach(([id,v]) => {
    const el = $(id); el.value = v; const lbl = $('v_'+id); if (lbl) lbl.textContent = fmtSliderValue(id, v);
  });
  render(); commitUndoCapture(); haptic('select');
});
wireMatrixDrag(MCELLS, 200, 2);      // full -200..200 across roughly a phone width
wireMatrixDrag(MOFFCELLS, 100, 0.6); // gentler: the whole 0..100 needs more travel to reach

/* ---- Compact mix: select a cell, fine-tune it on one bar (build 115) ----
   On touch the first tap only selects (the cell is made read-only for that
   tap so the keyboard stays down); tapping the selected cell again types
   into it. Mouse and keyboard users can still click and type straight away. */
let mxSel = 'm00';
function mxFineSync() {
  const el = $(mxSel), r = $('mxFineR'); if (!el || !r) return;
  MCELLS.forEach(id => $(id)?.classList.toggle('sel', id === mxSel));
  const i = MCELLS.indexOf(mxSel), C = ['R','G','B'], K = ['rl-r','rl-g','rl-b'];
  const ro = (i / 3) | 0, co = i % 3;
  const lb = $('mxFineLbl');
  if (lb) lb.innerHTML = '<b class="' + K[ro] + '">' + C[ro] + '</b> &larr; <b class="' + K[co] + '">' + C[co] + '</b>';
  if (document.activeElement !== r) r.value = +el.value || 0;
  r.setAttribute('aria-label', C[ro] + ' out from ' + C[co] + ' in');
  const os = $('mxOffSum');
  if (os) { const o = MOFFCELLS.map(id => Math.round(+$(id).value || 0)); os.textContent = o.join(' \u00b7 '); os.classList.toggle('on', o.some(v => v !== 0)); }
}
function mxSelect(id) { mxSel = id; mxFineSync(); }
function mxSetSel(v) {
  const el = $(mxSel); if (!el) return;
  v = Math.max(-200, Math.min(200, Math.round(v / 5) * 5));
  if (v === +el.value) return;
  el.value = v; render(); mxSync(); haptic('tick');
}
MCELLS.forEach(id => {
  const el = $(id); if (!el) return;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (mxSel !== id) { el.readOnly = true; mxSelect(id); }
      else if (el.readOnly) { el.readOnly = false; }
    } else mxSelect(id);
  });
  el.addEventListener('focus', () => { if (mxSel !== id) mxSelect(id); });
  el.addEventListener('blur', () => { el.readOnly = false; });
  el.addEventListener('dblclick', () => { el.readOnly = false; el.focus(); el.select?.(); });
});
$('mxFineR')?.addEventListener('input', e => mxSetSel(+e.target.value));
$('mxFineR')?.addEventListener('change', () => { armUndoCapture(); commitUndoCapture(); });
[['mxFineDn', -5], ['mxFineUp', 5]].forEach(([b, d]) => $(b)?.addEventListener('click', () => {
  mxSetSel((+$(mxSel).value || 0) + d); armUndoCapture(); commitUndoCapture();
}));

/* Reference colours run through the current matrix, shown source over result.
   Deliberately includes a neutral grey and a foliage green: those are the two
   the photo often cannot tell you about, and they are exactly where a matrix
   with rows that do not sum to 100% shows its cast. */
const MX_REF = [
  [220, 40, 40], [40, 190, 60], [40, 90, 220],
  [225, 205, 60], [180, 180, 180], [120, 150, 90]
];
function mxSync() {
  const wrap = $('mxPreview'); if (!wrap) return;
  mxFineSync();
  const m = MCELLS.map(id => (+$(id).value || 0) / 100);
  /* Cell weighting. Tint comes from the SOURCE channel (the column), because
     the question a cell answers is "how much of THIS input goes here". Scaled
     against the largest magnitude present rather than a fixed 100, so a
     gentle matrix is still readable instead of nine barely-there bars. */
  /* Row totals. Sum of the three GAIN cells only \u2014 the offset is excluded
     deliberately, because it answers a different question: the total is
     about whether this row changes exposure, and an offset always does. */
  for (let r = 0; r < 3; r++) {
    const el = $('mt' + r); if (!el) continue;
    const t = Math.round((+$(MCELLS[r*3]).value || 0) + (+$(MCELLS[r*3+1]).value || 0) + (+$(MCELLS[r*3+2]).value || 0));
    el.textContent = t;
    el.classList.toggle('neutral', t === 100);
    el.classList.toggle('hot', t !== 100);
    el.title = t === 100
      ? 'Row sums to 100: changes this channel\u2019s colour without changing its exposure.'
      : 'Row sums to ' + t + ': this row changes exposure as well as colour. 100 would be colour only.';
  }
  const TINT = ['rgba(224,72,52,.38)', 'rgba(63,178,74,.38)', 'rgba(58,124,232,.40)'];
  const peak = Math.max(1, ...m.map(Math.abs));
  MCELLS.forEach((id, i) => {
    const el = $(id); if (!el) return;
    const v = m[i];
    el.style.setProperty('--w', Math.min(1, Math.abs(v) / peak).toFixed(3));
    el.style.setProperty('--tint', TINT[i % 3]);
    el.classList.toggle('neg', v < 0);
    el.classList.toggle('zero', v === 0);
  });
  if (!wrap.children.length) {
    MX_REF.forEach(() => {
      const d = document.createElement('div');
      d.innerHTML = '<i></i><b></b>';
      wrap.appendChild(d);
    });
  }
  MX_REF.forEach((c, i) => {
    // matched to the shader: the mix happens in linear light, not on sRGB
    const lin = c.map(v => srgbToLinearF(v / 255));
    const out = [0, 1, 2].map(r =>
      linearToSrgbF(Math.max(0, m[r*3] * lin[0] + m[r*3+1] * lin[1] + m[r*3+2] * lin[2])));
    const px = out.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255));
    const d = wrap.children[i];
    d.children[0].style.background = 'rgb(' + c.join(',') + ')';
    d.children[1].style.background = 'rgb(' + px.join(',') + ')';
    d.title = c.join(',') + ' \u2192 ' + px.join(',');
  });
  // highlight whichever permutation button the grid currently matches
  const perm = [0,1,2].map(r => {
    const row = [0,1,2].map(c => m[r*3+c]);
    const hot = row.findIndex(v => Math.abs(v - 1) < 0.001);
    return (hot >= 0 && row.filter(v => Math.abs(v) > 0.001).length === 1) ? String(hot) : 'x';
  }).join('');
  // [data-perm] only: the index buttons share the .swapBtn class for styling
  // but own their own 'on' state, and an unscoped toggle here would clear it
  // on every matrix change.
  document.querySelectorAll('.swapBtn[data-perm]').forEach(b => b.classList.toggle('on', b.dataset.perm === perm));
}

/* The colour a preset turns foliage into, for its cassette swatch. Uses the
   same linear-light path as the shader rather than mixing the sRGB numbers
   directly, so the swatch matches what the preset actually produces. */
function presetTone(m) {
  const foliage = [0.68, 0.53, 0.99];              // typical IR foliage, sRGB
  const lin = foliage.map(srgbToLinearF);
  const out = [0, 1, 2].map(r =>
    linearToSrgbF(Math.max(0, (m[r*3]*lin[0] + m[r*3+1]*lin[1] + m[r*3+2]*lin[2]) / 100)));
  const px = out.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255));
  return 'rgb(' + px.join(',') + ')';
}


/* ---------- H.H. 1978 recipe, from IR_TIFFEN_12.atn ----------
   The action runs, in Photoshop, on gamma-encoded values: Levels (Auto), three Channel Mixers, Levels (Auto), Brightness/
   Contrast +74, Vibrance +50 / Saturation +10, Colour Balance, and Hue/Saturation on two custom hue ranges.
   Clicking the preset used to set only the composed mixer matrix, in linear light, which is a different colour from what
   the action makes and leaves out everything after the mixers: the deep navy skies and dark crimson foliage come from
   those later steps. Now it sets the whole look with this tool's own controls:
     - the swap runs in the Encoded space (the mixers act on gamma-encoded values, as in Photoshop);
     - both Levels (Auto) steps are measured on the picture (per channel, 0.1% clipped at each end) and folded into the
       matrix and its offset, since a per-channel stretch before and after a 3x3 is itself one matrix and offset;
     - Contrast, Vibrance and Saturation, the three Colour Balance ranges as per-channel curve points, and the two
       Hue/Saturation ranges as Colour by band values, fitted to Photoshop's ranges (mean difference about 3 on a 0-100 colour scale).
   Photoshop's own contrast, vibrance and colour-balance maths is not published, so those three are matched by judgement,
   not by measurement; the mixers, the Levels and the Hue/Saturation ranges are the parts reproduced to numbers. */
const HH_M1 = [[0, 0, 1], [1, 0, 0], [0, 1, 0]], HH_M2 = [[1, 0, 0], [-0.2, 1, 0], [-0.09, 0, 1]], HH_M3 = [[0.63, 0.48, 0], [0.01, 0.89, 0.07], [0.22, -0.35, 1.23]];
const HH_TONE = { contrast: 85, vibrance: 50, sat: 110 };
/* The Hue/Saturation ranges as fitted to Photoshop's, then pulled a further way apart on the RAW look: sky away from violet
   toward blue (about 260 to 246 degrees), foliage away from magenta toward pink-red (about 334 to 342). Measured on two real RAW
   frames against the reference colours; sky now lands in the reference's navy range, foliage is closer in hue but still paler
   than the reference crimson. */
const HH_BANDS = {"H": [-25, -10, 0, 0, -5, -40, -70, 100], "S": [25, 0, 0, 0, 27, -20, 20, 60], "L": [-10, 0, 0, 0, 15, -54, -84, -75]};
/* Colour Balance: shadows (-21,-14,+14), midtones (0,-3,+15), highlights (+18,+11,+32) as R, G, B shifts. A slider point is
   taken as ~0.30 of the range at full scale, applied at the lightness each range is centred on. */
const HH_BALANCE = { sh: [-21, -14, 14], mid: [0, -3, 15], hi: [18, 11, 32], at: [0.2, 0.5, 0.8], k: 0.30 };
function hhMat3(a, b) { const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i][j] += a[i][k] * b[k][j]; return o; }
function hhThumb() {
  const src = (typeof rawCanvas !== 'undefined' && rawCanvas && rawCanvas.width) ? rawCanvas : null; if (!src) return null;
  const k = Math.min(1, 512 / Math.max(src.width, src.height)), w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, n = w * h, out = new Float32Array(n * 3);
  /* The picture the swap actually receives is the decoded one AFTER the pre-swap white balance (the automatic one on a
     RAW without camera calibration, or a picked neutral), because the shader applies that in linear light first. The action
     was written for a picture that already had its balance, so Levels and the mixers have to be measured on that, in
     encoded form and clamped, as Photoshop would hold it. Without this a RAW's levels were measured on the unbalanced
     canvas and the folded matrix pushed the real picture far too dark. */
  const bf = (wbMethod === 'bradford') ? preWBM : [preWB[0], 0, 0, 0, preWB[1], 0, 0, 0, preWB[2]];
  for (let i = 0; i < n; i++) {
    const r = srgbToLinearF(d[i * 4] / 255), g = srgbToLinearF(d[i * 4 + 1] / 255), b = srgbToLinearF(d[i * 4 + 2] / 255);
    out[i * 3] = linearToSrgbF(bf[0] * r + bf[1] * g + bf[2] * b);
    out[i * 3 + 1] = linearToSrgbF(bf[3] * r + bf[4] * g + bf[5] * b);
    out[i * 3 + 2] = linearToSrgbF(bf[6] * r + bf[7] * g + bf[8] * b);
  }
  return out;
}
function hhAutoLevels(px, clip) {   // per channel: the values that clip 0.1% at each end, from the 8-bit histogram, as Photoshop's Auto does
  const n = px.length / 3, lo = [0, 0, 0], hi = [1, 1, 1];
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, Math.round(px[i * 3 + c] * 255)))]++;
    const cut = n * clip; let a = 0, l = 0, h = 255; for (; l < 255; l++) { a += hist[l]; if (a > cut) break; }
    a = 0; for (; h > 0; h--) { a += hist[h]; if (a > cut) break; }
    if (h - l < 8) { l = 0; h = 255; }   // a nearly flat channel: leave it alone rather than stretch noise
    lo[c] = l / 255; hi[c] = h / 255;
  }
  return { lo: lo, hi: hi };
}
function hhFold() {
  const px = hhThumb(); if (!px) return null;
  const n = px.length / 3, L1 = hhAutoLevels(px, 0.001), s1 = L1.lo.map((l, c) => 1 / Math.max(0.1, L1.hi[c] - l));
  const M = hhMat3(HH_M3, hhMat3(HH_M2, HH_M1));
  // Photoshop clamps after every step; measure the second Levels on exactly that chain
  const mid = new Float32Array(n * 3), cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  for (let i = 0; i < n; i++) {
    let v = [0, 1, 2].map(c => cl((px[i * 3 + c] - L1.lo[c]) * s1[c]));
    for (const m of [HH_M1, HH_M2, HH_M3]) v = [0, 1, 2].map(r => cl(m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]));
    mid[i * 3] = v[0]; mid[i * 3 + 1] = v[1]; mid[i * 3 + 2] = v[2];
  }
  const L5 = hhAutoLevels(mid, 0.001), s5 = L5.lo.map((l, c) => 1 / Math.max(0.1, L5.hi[c] - l));
  // x5 = S5 (M S1 (x - lo1) - lo5)
  const A = [0, 1, 2].map(r => [0, 1, 2].map(c => s5[r] * M[r][c] * s1[c]));
  const b = [0, 1, 2].map(r => -s5[r] * (M[r][0] * s1[0] * L1.lo[0] + M[r][1] * s1[1] * L1.lo[1] + M[r][2] * s1[2] * L1.lo[2]) - s5[r] * L5.lo[r]);
  return { A: A, b: b, levels1: L1, levels5: L5 };
}
function hhBalanceCurves() {
  const B = HH_BALANCE, cs = { r: [[0, 0]], g: [[0, 0]], b: [[0, 0]] };
  ['r', 'g', 'b'].forEach((ch, c) => {
    let last = 0;
    [[B.at[0], B.sh[c]], [B.at[1], B.mid[c]], [B.at[2], B.hi[c]]].forEach(([x, v]) => {
      let y = Math.max(last + 0.01, Math.min(0.99, x + (v / 100) * B.k * 1.0)); if (Math.abs(v) < 1) y = x;
      cs[ch].push([x, y]); last = y;
    });
    cs[ch].push([1, 1]);
  });
  return cs;
}
function hhApplyExtras() {
  const set = (id, v) => { const e = $(id); if (!e) return; e.value = v; const l = $('v_' + id); if (l) l.textContent = e.value; };
  const f = hhFold();
  window.__hhPrev = { space: ($('swapSpace') && $('swapSpace').value) || '2' };
  if ($('swapSpace')) $('swapSpace').value = '4';
  if (f) {
    MCELLS.forEach((id, i) => { $(id).value = (Math.round(f.A[(i / 3) | 0][i % 3] * 1000) / 10); });
    MOFFCELLS.forEach((id, i) => { $(id).value = Math.round(f.b[i] / 0.25 * 1000) / 10; });
  }
  set('contrast', taperPos('contrast', HH_TONE.contrast)); set('vibrance', HH_TONE.vibrance); set('sat', HH_TONE.sat);
  for (let i = 0; i < 8; i++) { set('hslH' + i, HH_BANDS.H[i]); set('hslS' + i, HH_BANDS.S[i]); set('hslL' + i, HH_BANDS.L[i]); }
  const cs = hhBalanceCurves(); curveState = curveDefault(); curveState.r = cs.r; curveState.g = cs.g; curveState.b = cs.b;
  if (typeof curveChanged === 'function') curveChanged();
  mxSync();
}
/* Anything the recipe changed that Reset-before-a-recipe does not already clear: put it back when another preset (or no
   preset) takes over, without touching a swap space the person chose themselves for ordinary presets. */
function hhUndoExtras() {
  if (!window.__hhPrev) return;
  if ($('swapSpace')) $('swapSpace').value = window.__hhPrev.space;
  // the tone steps and the matrix offsets are part of the recipe too, so taking the recipe away takes them with it
  [['contrast', 0], ['vibrance', 0], ['sat', 100]].forEach(([id, v]) => { const e = $(id); if (e) { e.value = v; const l = $('v_' + id); if (l) l.textContent = v; } });
  MOFFCELLS.forEach(id => { const e = $(id); if (e) e.value = 0; });
  for (let i = 0; i < 8; i++) ['hslH', 'hslS', 'hslL'].forEach(k => { const e = $(k + i); if (e) { e.value = 0; const l = $('v_' + k + i); if (l) l.textContent = 0; } });
  curveState = curveDefault(); if (typeof curveChanged === 'function') curveChanged();
  window.__hhPrev = null;
}

/* ---------- EIR base: a starting point for the reference look ----------
   Not the Photoshop action (that is the H.H. recipe, whose result depends on the channel balance of the picture it is given) but
   the palette the reference pictures end up with, built from this tool's own controls: a swap-free base, a strong tone curve, a
   saturation push so sky and foliage carry colour, then Deep sky and Crimson foliage, which pull those two families to the
   reference colours whatever the day did to them. Everything it sets is an ordinary slider, so the time of day is tuned with
   Deep sky (how dark the sky goes), Crimson foliage, Exposure, Contrast and Saturation. On a RAW it also turns on a moderate
   RAW colour noise reduction, because the push that makes the colour is what makes colour noise show. */
const EIR_BASE = { contrast: 40, sat: 130, vibrance: 30, blackPt: 6, rawNrC: 60, rawNrL: 45 };   // RAW noise reduction set higher than before (colour 50 / luminance 15): on a simulated noisy RAW, 60 / 45 kept the fine land texture, 80 / 80 started to smear it
function eirApply() {
  const set = (id, v) => { const e = $(id); if (!e) return; e.value = v; const l = $('v_' + id); if (l) l.textContent = e.value; };
  window.__eirOn = true;
  set('contrast', taperPos('contrast', EIR_BASE.contrast)); set('sat', EIR_BASE.sat); set('vibrance', EIR_BASE.vibrance); set('blackPt', EIR_BASE.blackPt);
  if (document.body.classList.contains('rawOpen')) { set('rawNrC', EIR_BASE.rawNrC); set('rawNrL', EIR_BASE.rawNrL); if (typeof reapplyCamSpaceSwap === 'function') reapplyCamSpaceSwap(); }
}
function eirUndo() {
  if (!window.__eirOn) return;
  ['skyDeep', 'crimsonFol', 'rawNrC', 'rawNrL', 'blackPt', 'contrast', 'vibrance'].forEach(id => { const e = $(id); if (e) { e.value = 0; const l = $('v_' + id); if (l) l.textContent = 0; } });
  const sat = $('sat'); if (sat) { sat.value = 100; const l = $('v_sat'); if (l) l.textContent = 100; }
  window.__eirOn = false;
  if (document.body.classList.contains('rawOpen') && typeof reapplyCamSpaceSwap === 'function') reapplyCamSpaceSwap();
}

function buildPresetButtons(list, containerId) {
  list.forEach(p => {
    const b = document.createElement('button');
    b.className = 'pb';
    // name stays in <b> on its own: captureState() identifies the active
    // preset by that element's textContent
    /* A film-roll mark on presets derived from published measurements, so the
       provenance is visible on the button rather than buried in a tooltip.
       Its absence is meaningful too: H.H. 1978 is a darkroom recipe, not a
       stock, and never had sensitivity curves to derive from. */
    /* A 35mm cassette, tinted with the colour THIS preset turns foliage into.
       Not Kodak's packaging — that artwork is theirs, and a row of identical
       yellow boxes would say nothing anyway. The tint is computed from the
       preset's own matrix, run on a typical IR foliage pixel through the same
       linear-light maths the shader uses, so the swatch is a genuine preview
       rather than decoration: 8443 and the two 1443 processes come out golds
       a shade apart, H.H. lands pink, and CIR -> natural goes green because
       it runs the swap backwards. The label band is the tint; the body stays
       neutral so the shape still reads as a cassette at 13px. */
    const roll = p.src === 'data'
      ? '<svg class="srcmark" viewBox="0 0 16 16" aria-hidden="true" style="--tone:' + presetTone(p.m) + '">' +
        '<path d="M4.6 2.2h6.8a1 1 0 0 1 1 1v9.6a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1z" class="body"/>' +
        '<rect x="3.6" y="5.6" width="8.8" height="4.6" class="band"/>' +
        '<rect x="6.5" y="0.6" width="3" height="1.8" rx=".5" class="body"/>' +
        '</svg>'
      : '';
    b.innerHTML = '<b>' + p.n + roll + '</b>' + (p.s ? '<span class="psub">' + p.s + '</span>' : '');
    if (p.t) b.title = p.t;   // build 156: caveats live in the tooltip, the card says only what the preset does
    b.onclick = () => {
      armUndoCapture();
      // Clicking the ALREADY-selected preset clears it. Previously the only
      // way back out of a preset was Reset all, which also threw away every
      // slider and white balance you'd set on top of it.
      if (b.classList.contains('on')) { clearPreset(); commitUndoCapture(); return; }
      /* Same reset every recipe function already calls before applying
         itself (applyE4Recipe, applyAerochromeRecipe,
         applyAeroRecipe) -- this plain swap preset handler was the one
         place that never did, so switching FROM a recipe TO an ordinary
         preset was the one direction that still leaked: sat, contrast,
         vibrance, targeted bands, and the recipe's own post-swap white
         balance all lingered, because this handler only ever reset its
         own matrix and hue, never anything a RECIPE might have set.
         Every preset click now starts from the same clean baseline,
         recipe or not -- "a different preset should be its own, not a
         preset of the previous preset." Sets matrix and hue AFTER this,
         same as before, since resetLookBeforeRecipe zeroes both first. */
      hhUndoExtras(); eirUndo();
      resetLookBeforeRecipe();
      const mixBase = captureState();
      b.classList.add('on');
      MCELLS.forEach((id, i) => $(id).value = p.m[i]);
      MOFFCELLS.forEach(id => { $(id).value = 0; });
      mxSync();
      if (p.recipe === 'hh') hhApplyExtras();
      if (p.recipe === 'eir') eirApply();
      // a preset may carry a hue offset — that's what distinguishes e.g. 550nm
      // from Aerochrome, which share the same matrix. Presets without one
      // explicitly reset hue to 0 so a previous preset's offset can't linger.
      const hv = p.hue || 0;
      $('hue').value = hv; $('v_hue').textContent = hv;
      haptic('select');   // before render(), not after: a full-frame render can
                          // take tens of milliseconds on a large image, and a
                          // buzz that arrives after it feels like lag
      updateClearPresetBtn();
      presetMixSet(mixBase, captureState());
      render();
      commitUndoCapture();
    };
    $(containerId).appendChild(b);
  });
}
buildPresetButtons(UV_PRESETS, 'pgUV');
/* Paint the cell weights once at startup. mxSync only ran on a change, so a
   fresh page showed the identity matrix with no bars at all — the one state
   where the visual is most useful for saying "nothing is being moved yet". */
mxSync();
/* Split by kind, not by hand-maintained lists: anything documented as a film
   stock, a named recipe or the reverse transform goes to the film group, the
   rest stay as everyday swaps. Keeping it a predicate means adding a preset
   above puts it in the right place on its own. */
const FILM_NAMES = /Aerochrome|EIR|Colour IR|H\.H\.|CIR |Lomo/i;
buildPresetButtons(IR_PRESETS.filter(p => !p.hidden && !FILM_NAMES.test(p.n)), 'pgIR');
buildPresetButtons(IR_PRESETS.filter(p => !p.hidden &&  FILM_NAMES.test(p.n)), 'pgFilm');


/* Deselect the filter and return the matrix to identity, WITHOUT touching
   exposure, white balance or anything else. That separation is the point:
   people want to try a different starting matrix while keeping the work they
   did on top of it. */
function clearPreset() {
  presetMixClear();
  hhUndoExtras(); eirUndo();
  document.querySelectorAll('.pb').forEach(x => x.classList.remove('on'));
  const identity = [100, 0, 0, 0, 100, 0, 0, 0, 100];
  MCELLS.forEach((id, i) => $(id).value = identity[i]);
  mxSync();
  $('hue').value = 0; $('v_hue').textContent = 0;
  updateClearPresetBtn();
  render();
}

/* ---------- preset strength ----------
   When a preset or recipe is picked, the state just before it (after the clean-up every preset does) and the state with it
   fully applied are both kept. The slider then sets each setting the preset changed to a point between the two: the nine
   matrix numbers and offsets, every slider, and the curve channels it bent (toward the straight line). Anything the preset
   did not touch is taken from the picture as it is now, so edits made afterwards elsewhere survive moving the slider.
   On-off choices (the swap space, tick boxes) stay as the preset set them, which is safe because an identity matrix in any
   space changes nothing. The RAW noise reduction settings are left at the preset's values: rebuilding the RAW on every
   step of a drag would be far too slow. */
const PRESET_MIX = { base: null, target: null };
const PRESET_MIX_FIXED = new Set(['rawNrL', 'rawNrC', 'rawHl', 'epdEdge', 'epdScale']);
function presetMixSet(base, target) {
  PRESET_MIX.base = base; PRESET_MIX.target = target;
  const e = $('presetStrength'); if (e) { e.value = 100; } if ($('v_presetStrength')) $('v_presetStrength').textContent = 100;
  if ($('presetStrengthBox')) $('presetStrengthBox').style.display = base ? '' : 'none';
}
function presetMixClear() { presetMixSet(null, null); }
function presetMixApply(pct) {
  const B = PRESET_MIX.base, T = PRESET_MIX.target; if (!B || !T) return;
  const t = Math.max(0, Math.min(1, pct / 100)), lerp = (a, b) => a + (b - a) * t;
  const st = captureState();
  st.m = T.m.map((v, i) => v !== B.m[i] ? Math.round(lerp(B.m[i], v) * 10) / 10 : st.m[i]);
  st.mOff = T.mOff.map((v, i) => v !== B.mOff[i] ? Math.round(lerp(B.mOff[i], v) * 10) / 10 : st.mOff[i]);
  st.s = T.s.map((v, i) => { const id = HASH_SLIDERS[i]; if (v === B.s[i] || PRESET_MIX_FIXED.has(id)) return st.s[i]; const el = $(id), step = el && el.step && el.step !== 'any' ? +el.step : 1; return Math.round(lerp(B.s[i], v) / step) * step; });
  if (T.curves && B.curves) {
    st.curves = JSON.parse(JSON.stringify(st.curves));
    Object.keys(T.curves).forEach(k => {
      const tc = T.curves[k], bc = B.curves[k]; if (!Array.isArray(tc) || JSON.stringify(tc) === JSON.stringify(bc)) return;
      const straight = Array.isArray(bc) && bc.length === 2 && bc[0][0] === 0 && bc[0][1] === 0 && bc[1][0] === 1 && bc[1][1] === 1;
      st.curves[k] = straight ? tc.map(([x, y]) => [x, x + (y - x) * t]) : (t >= 0.5 ? tc : bc);
    });
  }
  applyState(st);
  if ($('v_presetStrength')) $('v_presetStrength').textContent = Math.round(pct);
}
(function wirePresetStrength() {
  const e = $('presetStrength'); if (!e) return;
  e.addEventListener('pointerdown', () => armUndoCapture());
  e.addEventListener('input', () => presetMixApply(+e.value));
  e.addEventListener('change', () => { presetMixApply(+e.value); commitUndoCapture(); });
})();

function updateClearPresetBtn() {
  const btn = $('btnClearPreset');
  if (btn) btn.style.display = document.querySelector('.pb.on') ? 'inline-block' : 'none';
}
$('btnClearPreset').onclick = () => { armUndoCapture(); clearPreset(); commitUndoCapture(); haptic('select'); };

// 4. File Loading
