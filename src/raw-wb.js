/* Build 197: RAW white balance as Temperature (Kelvin) and Green, RawTherapee's model (src/rt-wb.js).

   This is the RAW's own white balance, set before anything else -- before highlight rebuild, the camera matrix and the
   channel swap -- the same place the camera's as-shot setting goes. The Temperature & tint sliders further down are
   unchanged: a +/-600 cast applied after the swap.

   Edit state: rawWbCustom is null (the file opens as the As shot / Auto choice says) or { t: Kelvin, g: Green }, or,
   after a pick, also { wb: [r, 1, b] }: a picked grey's exact camera multipliers, which on a filtered shot can sit
   beyond the Kelvin scale (t and g are then the nearest reading). Stored by value, so a saved edit or undo step gives
   the same light on the same file. The readout always shows the white balance in effect.

   Build 199 laid the card out in pipeline order (index.html #wbTempGrp): 1 Camera (this), 2 the channel swap as a
   link, 3 the cast after the swap.

   While a slider is dragged the change is previewed as channel gains on the already-built picture, exact for neutrals
   and close for colours; letting go rebuilds the RAW preview with the new white balance, which is exact (and redoes
   the highlight rebuild in the new balance, as RawTherapee does). */
let rawWbCustom = null;
let rawWbBuilt = null;     // the white balance the RAW preview on screen was built with
let rawWbDrag = null;      // the white balance being previewed during a drag, or null

/* The camera multipliers (green 1) that balance for this light: LibRaw's daylight multipliers divided by the camera's
   response to it in its D65-balanced space (RawTherapee's RawImageSource::getImage). */
function rtwbGains(res, temp, green) {
  const cam = wbkCamera(res); if (!cam) return null;
  const L = rtwbLight(temp, green);
  const resp = wbkMulV(cam.rcInv, L);
  if (!(resp[0] > 0 && resp[1] > 0 && resp[2] > 0)) return null;
  const g = [cam.preMul[0] / resp[0], cam.preMul[1] / resp[1], cam.preMul[2] / resp[2]];
  return [g[0] / g[1], 1, g[2] / g[1]];
}
/* And back: the Temperature and Green that a set of camera multipliers balances for (RawTherapee's camera_wb). */
function rtwbFromGains(res, wb) {
  const cam = wbkCamera(res); if (!cam || !wb) return null;
  const resp = [cam.preMul[0] / wb[0], cam.preMul[1] / wb[1], cam.preMul[2] / wb[2]];
  const L = wbkMulV(cam.rc, resp);
  // as RawTherapee: temperature from blue/red, Green from what's left and clamped to its range -- a UV or IR custom
  // white balance often needs a Green below 0.02 (even a negative one), which nothing on this scale reaches; As shot
  // still gets it back exactly
  if (!(L[0] > 0 && L[2] > 0)) return null;
  if (!(L[1] > 0)) return Object.assign(rtwbTempOf([L[0], 1e-9, L[2]]), { green: RTWB_GMIN, off: true });
  const a = rtwbTempOf(L), back = rtwbGains(res, a.temp, a.green);
  if (back && wb.some((v, i) => Math.abs(Math.log(back[i] / v)) > 0.02)) a.off = true;   // clamped: the sliders can't show it exactly
  return a;
}

function rawWbKey() {
  if (!rawWbCustom) return rawWbMode();
  return rawWbCustom.wb ? 'wb' + rawWbCustom.wb.map(v => v.toFixed(5)).join(',') : Math.round(rawWbCustom.t) + '/' + rawWbCustom.g.toFixed(4);
}

/* Slider positions. Temperature runs on a mired scale, which is how a change of light looks to the eye (the same push
   either side of 5000 K looks about the same), so 3000-7000 K gets a good share of the travel. Green runs on a log
   scale, 0.1 to 10, centred on 1. */
const RTWB_POS = 1000;
function rtwbTempToPos(t) { const m = 1e6 / t, m0 = 1e6 / RTWB_MIN, m1 = 1e6 / RTWB_MAX; return Math.round(RTWB_POS * (m0 - m) / (m0 - m1)); }
function rtwbPosToTemp(p) { const m0 = 1e6 / RTWB_MIN, m1 = 1e6 / RTWB_MAX; return 1e6 / (m0 - (p / RTWB_POS) * (m0 - m1)); }
/* Green is shown as Tint, the way Lightroom does: green on the left, magenta on the right, 0 = Green 1. RawTherapee's
   Green multiplier runs the other way (below 1 is more magenta), which made "Green 0.100" sit at the magenta end.
   Tint = -100 x log10(Green): +100 is Green 0.1, -100 is Green 10. */
function rtwbGreenToTint(g) { return -100 * Math.log10(g); }
function rtwbTintToGreen(t) { return Math.pow(10, -t / 100); }
function rtwbGreenToPos(g) { return Math.round(Math.max(-1000, Math.min(1000, 10 * rtwbGreenToTint(g)))); }
function rtwbPosToGreen(p) { return rtwbTintToGreen(p / 10); }
function rtwbFmtT(t) { return String(Math.round(t)); }   // the big readout; its K is a separate span
function rtwbFmtG(g) { const t = Math.round(rtwbGreenToTint(g)); return (t > 0 ? '+' : '') + t; }

/* The RAW on screen, if it is one and its camera is known. */
function rtwbRes() {
  try {
    if (typeof rawEngine === 'undefined' || !rawEngine.lastResult || rawEngine.lastGen !== loadToken) return null;
    return wbkCamera(rawEngine.lastResult) ? rawEngine.lastResult : null;
  } catch (e) { return null; }
}

/* The change from the preview on screen (built with rawWbBuilt) to one balanced with the new white balance, as a matrix
   on the built picture's linear sRGB: back through the camera matrix, rescale the camera channels, forward again
   (M . diag(new/built) . M^-1). Exact for every colour, not just greys, as long as nothing clipped in between. */
function rtwbPreviewMatrix() {
  const res = rtwbRes(), wb = rawWbDrag || (res && rawWbFor(res));   // during a drag the dragged value; afterwards the committed one, until its rebuild lands
  if (!res || !wb || !rawWbBuilt) return null;
  const r = [wb[0] / rawWbBuilt[0], wb[1] / rawWbBuilt[1], wb[2] / rawWbBuilt[2]];
  if (Math.abs(r[0] - 1) < 1e-6 && Math.abs(r[1] - 1) < 1e-6 && Math.abs(r[2] - 1) < 1e-6) return null;   // nothing pending
  const M = (typeof pp_camToSrgbLin === 'function') ? pp_camToSrgbLin(pp_rgbCam3x3(res.rgbCam)) : pp_rgbCam3x3(res.rgbCam);
  const Mi = wbkInv3(M); if (!Mi) return null;
  const P = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let v = 0; for (let k = 0; k < 3; k++) v += M[i * 3 + k] * r[k] * Mi[k * 3 + j]; P.push(v); }
  return P;
}
function rtwbPreviewGains() {   // the diagonal stand-in, for the per-channel picker path
  const P = rtwbPreviewMatrix(); if (!P) return null;
  const d = [P[0] + P[1] + P[2], P[3] + P[4] + P[5], P[6] + P[7] + P[8]];   // what a grey becomes
  return d.every(v => v > 0) ? d : null;
}

/* Show the controls for a RAW whose camera is known, with the white balance in effect. */
function rtwbSyncUi() {
  const box = $('rawWbBox'); if (!box) return;
  const res = rtwbRes();
  if (box.hidden === !!res) box.hidden = !res;
  const sw = $('wbSwapStep'); if (sw && sw.hidden === !!res) sw.hidden = !res;
  const grp = $('wbTempGrp'); if (grp) grp.classList.toggle('wbRaw', !!res);
  if (!res) return;
  rtwbGpuWarm();
  rtwbSyncSwap();
  if (rawWbDrag) return;
  const eff = rtwbFromGains(res, rawWbFor(res)) || { temp: 5000, green: 1 };
  const t = rawWbCustom && !rawWbCustom.wb ? rawWbCustom.t : eff.temp, g = rawWbCustom && !rawWbCustom.wb ? rawWbCustom.g : eff.green;
  const ts = $('rawTemp'), gs = $('rawGreen');
  if (ts && !ts.matches(':active')) ts.value = rtwbTempToPos(t);
  if (gs && !gs.matches(':active')) { gs.value = rtwbGreenToPos(g); if (typeof syncSliderFill === 'function') syncSliderFill(gs); }
  const lt = $('v_rawTemp'), lg = $('v_rawGreen');
  const approx = !!eff.off && !(rawWbCustom && !rawWbCustom.wb);
  if (lt && !lt.dataset.editing) { const v = (approx ? '\u2248' : '') + rtwbFmtT(t); if (lt.textContent !== v) lt.textContent = v; }
  if (lg && !lg.dataset.editing) { const v = (approx ? '\u2248' : '') + rtwbFmtG(g); if (lg.textContent !== v) lg.textContent = v; }
  const mode = rawWbMode();
  const on = (id, v) => { const e = $(id); if (e) { e.classList.toggle('on', v); e.setAttribute('aria-pressed', v ? 'true' : 'false'); } };
  on('rawWbShot', !rawWbCustom && mode === 'camera');
  on('rawWbAuto', !rawWbCustom && mode === 'auto');
  on('rawWbPick', !!(rawWbCustom && rawWbCustom.wb));
  const off = $('rawWbOff'); if (off) { const o = approx; if (off.hidden === o) off.hidden = !o; }
  rtwbPaintTracks(res, t, g);
}

/* Build 201: the two tracks drawn from the photo. Each stop is the colour that what is grey at the slider's setting
   would become with the slider there, carried through the rest of the colour work -- the picker, the channel swap in its working space, the
   cast -- at a fixed brightness, so the track shows what landing there does to this picture. The fixed blue-to-orange
   strip it replaces is right for an ordinary photo but says nothing true about a swapped infrared one. */
let rtwbTrackKey = '';
function rtwbPaintTracks(res, t, g) {
  const ts = $('rawTemp'), gs = $('rawGreen'); if (!ts || !gs) return;
  // measured from the slider's own setting, so the thumb sits on grey and each side shows which way it pushes; on a
  // shot whose as-shot is beyond the scale, measuring from that made the whole track one solid colour
  const now = rtwbGains(res, t, g) || rawWbFor(res);
  let P = null; try { P = currentParams(); } catch (e) { return; }
  const key = [now.map(v => v.toFixed(4)), Math.round(t), g.toFixed(3), P.matrix, P.swapSpace, P.preWBM, P.postWBM, P.tempTint].join('|');
  if (key === rtwbTrackKey) return;
  rtwbTrackKey = key;
  const M = (typeof pp_camToSrgbLin === 'function') ? pp_camToSrgbLin(pp_rgbCam3x3(res.rgbCam)) : pp_rgbCam3x3(res.rgbCam);
  const mul = (m, v) => wbkMulV(m, v);
  const wide = [1, 2, 3].includes(+P.swapSpace) && typeof SRGB_LIN_TO_PROPHOTO_LIN !== 'undefined';
  const enc = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const colourFor = wb => {
    if (!wb) return null;
    let c = mul(M, [wb[0] / now[0], wb[1] / now[1], wb[2] / now[2]]);   // a grey now, balanced with wb instead
    if (P.preWBM && P.preWBM.length === 9) c = mul(P.preWBM, c);
    if (P.matrix && P.matrix.length === 9) c = wide ? mul(PROPHOTO_LIN_TO_SRGB_LIN, mul(P.matrix, mul(SRGB_LIN_TO_PROPHOTO_LIN, c))) : mul(P.matrix, c);
    if (P.postWBM && P.postWBM.length === 9) c = mul(P.postWBM, c);
    if (P.tempTint) c = c.map((v, i) => v * P.tempTint[i]);
    c = c.map(v => Math.max(0, v));
    const mx = Math.max(c[0], c[1], c[2]); if (!(mx > 0)) return '#808080';
    const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const k = Math.min(0.32 / Math.max(y, 1e-6), 0.92 / mx);   // a mid brightness, without clipping the strongest channel
    return '#' + c.map(v => Math.round(255 * Math.min(1, enc(v * k)))).map(v => v.toString(16).padStart(2, '0')).join('');
  };
  const stops = (n, f) => { const out = []; for (let i = 0; i <= n; i++) { const col = f(i / n); if (col) out.push(col + ' ' + (100 * i / n).toFixed(1) + '%'); } return out.length > 1 ? 'linear-gradient(to right,' + out.join(',') + ')' : ''; };
  const tg = stops(24, f => colourFor(rtwbGains(res, rtwbPosToTemp(f * RTWB_POS), g)));
  const gg = stops(16, f => colourFor(rtwbGains(res, t, rtwbPosToGreen(-1000 + 2000 * f))));
  if (tg) ts.style.setProperty('--wbGrad', tg);
  if (gg) gs.style.setProperty('--wbGrad', gg);
}

/* Step 2: what the swap is doing, in a word, as a link to it. */
function rtwbSyncSwap() {
  const el = $('wbSwapSum'); if (!el) return;
  const btn = document.querySelector('.swapBtn[data-perm].on');
  const word = k => { const w = document.querySelector('#wbSwapWords [data-k="' + k + '"]'); return w ? w.textContent.trim() : k; };   // translated with the page
  const none = !!(btn && btn.dataset.perm === '012');
  let name = none ? word('none') : btn ? btn.textContent.trim() : word('mix');
  const sp = $('swapSpace'), spaces = { '0': 'sRGB', '1': 'Rec 2020', '2': 'ProPhoto', '3': 'Custom', '4': 'Encoded' };
  const v = name + (!none && sp ? ' \u00b7 ' + (spaces[sp.value] || '') : '') + ' \u203a';
  if (el.textContent !== v) el.textContent = v;
}

/* Commit a white balance: an undo step, then rebuild the RAW preview with it. */
function rtwbSet(next) {
  const res = rtwbRes(); if (!res) return;
  if (typeof armUndoCapture === 'function') armUndoCapture();
  rawWbCustom = next ? { t: Math.min(RTWB_MAX, Math.max(RTWB_MIN, next.t)), g: Math.min(RTWB_GMAX, Math.max(RTWB_GMIN, next.g)) } : null;
  if (next && next.wb) rawWbCustom.wb = next.wb.slice();
  rawWbDrag = null;
  if (typeof commitUndoCapture === 'function') commitUndoCapture();
  reapplyCamSpaceSwap();
  rtwbSyncUi();
  render();
}

(function wireRawWbSliders() {
  const ts = $('rawTemp'), gs = $('rawGreen'); if (!ts || !gs) return;
  // the white balance in effect; the slider being moved replaces just its own half, so a Green outside the slider's
  // 0.1-10 (a UV frame's as-shot can be) survives a Temperature change
  const cur = () => rtwbCur();
  let base = null;
  const now = el => { const b = base || cur(); return el === ts ? { t: rtwbPosToTemp(+ts.value), g: b.g } : { t: b.t, g: rtwbPosToGreen(+gs.value) }; };
  const live = ev => {
    const res = rtwbRes(); if (!res) return;
    if (!base) base = cur();
    const v = now(ev.target);
    $('v_rawTemp').textContent = rtwbFmtT(v.t); $('v_rawGreen').textContent = rtwbFmtG(v.g);
    $('rawWbOff').hidden = true;
    rawWbDrag = rtwbGains(res, v.t, v.g);
    render(true);
    rtwbLiveBuild();
  };
  [ts, gs].forEach(el => {
    el.addEventListener('input', live);
    el.addEventListener('change', () => { const v = now(el); base = null; rtwbSet(v); });
  });
  const mode = m => { try { localStorage.setItem('irlab.rawWb', m); } catch (e) {} };
  $('rawWbShot').addEventListener('click', () => { mode('camera'); rtwbSet(null); });
  $('rawWbAuto').addEventListener('click', () => { mode('auto'); rtwbSet(null); });
  $('rawWbPick').addEventListener('click', () => pickMode === 'rawWb' ? exitPick() : enterPick('rawWb'));

  // +/-50 K: a press is one step and one undo entry; held, it repeats, previewed until let go
  [['rawWbCool', -1], ['rawWbWarm', 1]].forEach(([id, dir]) => {
    const b = $(id); let hold = null;
    const step = () => {
      const res = rtwbRes(); if (!res || !hold) return;
      hold.t = Math.min(RTWB_MAX, Math.max(RTWB_MIN, Math.round(hold.t / 50) * 50 + dir * 50));
      $('v_rawTemp').textContent = rtwbFmtT(hold.t); $('rawWbOff').hidden = true;
      ts.value = rtwbTempToPos(hold.t);
      rawWbDrag = rtwbGains(res, hold.t, hold.g);
      render(true);
      rtwbLiveBuild();
    };
    b.addEventListener('pointerdown', e => {
      if (!rtwbRes()) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) {}
      hold = rtwbCur(); hold.timer = null;
      step();
      hold.delay = setTimeout(() => { if (hold) hold.timer = setInterval(step, 90); }, 420);
    });
    const end = () => {
      if (!hold) return;
      clearTimeout(hold.delay); clearInterval(hold.timer);
      const v = { t: hold.t, g: hold.g }; hold = null;
      rtwbSet(v);
      if (typeof haptic === 'function') haptic('tick');
    };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const c = rtwbCur(); rtwbSet({ t: Math.round(c.t / 50) * 50 + dir * 50, g: c.g }); } });
  });


  // step 2: open the swap where it lives (the Looks tab on a phone)
  $('wbSwapRow').addEventListener('click', () => {
    const tab = document.querySelector('button[data-tab="looks"]');
    if (tab && document.body.querySelector('[data-dock]') && !tab.classList.contains('on')) tab.click();
    const d = $('matrixDetails'); if (!d) return;
    for (let e = d; e; e = e.parentElement) if (e.tagName === 'DETAILS') e.open = true;
    setTimeout(() => d.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  });
})();

/* The white balance in effect as Temperature + Green (the nearest reading when it is beyond the scale). */
function rtwbCur() {
  if (rawWbCustom && !rawWbCustom.wb) return { t: rawWbCustom.t, g: rawWbCustom.g };
  const res = rtwbRes(), a = res && rtwbFromGains(res, rawWbFor(res));
  return a ? { t: a.temp, g: a.green } : { t: 5000, g: 1 };
}

/* Pick: the tapped grey, back in camera space, sets the camera multipliers that make it neutral -- the RAW's own white
   balance, as a camera's custom white balance does, not a correction on top. */
function rtwbDoPick(clientX, clientY) {
  const res = rtwbRes();
  if (!res || !rawWbBuilt || typeof rawPixels === 'undefined' || !rawPixels) { exitPick(); return; }
  const cv = $('preview'), rect = cv.getBoundingClientRect();
  const x = Math.round((Math.max(rect.left, Math.min(rect.right, clientX)) - rect.left) / rect.width * cv.width);
  const y = Math.round((Math.max(rect.top, Math.min(rect.bottom, clientY)) - rect.top) / rect.height * cv.height);
  const rad = Math.max(6, Math.round(cv.width * 0.02));
  const e = sampleAvgFrom(rawPixels, rawCanvas.width, rawCanvas.height, x, y, rad);
  const lin = e.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const M = (typeof pp_camToSrgbLin === 'function') ? pp_camToSrgbLin(pp_rgbCam3x3(res.rgbCam)) : pp_rgbCam3x3(res.rgbCam);
  const Mi = wbkInv3(M), c = Mi && wbkMulV(Mi, lin);
  exitPick();
  if (!c || !(c[0] > 1e-4 && c[1] > 1e-4 && c[2] > 1e-4)) { if (typeof toast === 'function') toast('That spot has a channel at black: pick a lighter grey', true); return; }
  if (Math.max(...e) >= 254) { if (typeof toast === 'function') toast('That spot is clipped: pick a grey that isn\u2019t blown', true); return; }
  const wb = [rawWbBuilt[0] / c[0], rawWbBuilt[1] / c[1], rawWbBuilt[2] / c[2]];
  const n = [wb[0] / wb[1], 1, wb[2] / wb[1]];
  const tg = rtwbFromGains(res, n) || { temp: 5000, green: 1 };
  if (typeof haptic === 'function') haptic('select');
  rtwbSet({ t: tg.temp, g: tg.green, wb: n });
}

/* The picker stage with the drag preview folded in, applied first (it stands in for the RAW white balance). */
function rtwbPreWB(pw) { const d = rtwbPreviewGains(); return d ? [pw[0] * d[0], pw[1] * d[1], pw[2] * d[2]] : pw; }
function rtwbPreWBM(m) {   // the picker matrix runs after the RAW white balance would have, so it goes on the left
  const P = rtwbPreviewMatrix(); if (!P || !m || m.length < 9) return m;
  const o = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let v = 0; for (let k = 0; k < 3; k++) v += m[i * 3 + k] * P[k * 3 + j]; o.push(v); }
  return o;
}

/* Long-press on the readout: type Kelvin, or Green. */
function rtwbTypeOpen(id, bEl) {
  const res = rtwbRes(); if (!res || bEl.dataset.editing) return;
  const a = rawWbCustom ? { temp: rawWbCustom.t, green: rawWbCustom.g } : (rtwbFromGains(res, rawWbFor(res)) || { temp: 5000, green: 1 });
  const isT = id === 'rawTemp';
  bEl.dataset.editing = '1';
  const prev = bEl.textContent;
  const inp = document.createElement('input');
  inp.type = 'number'; inp.className = 'vedit';
  inp.min = isT ? RTWB_MIN : Math.round(rtwbGreenToTint(RTWB_GMAX)); inp.max = isT ? RTWB_MAX : Math.round(rtwbGreenToTint(RTWB_GMIN)); inp.step = 1;
  inp.value = isT ? Math.round(a.temp) : Math.round(rtwbGreenToTint(a.green));
  bEl.textContent = ''; bEl.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const close = commit => {
    if (done) return; done = true;
    delete bEl.dataset.editing;
    bEl.textContent = prev;
    if (commit && inp.value !== '' && isFinite(+inp.value) && (!isT || +inp.value > 0)) {
      const v = +inp.value;
      rtwbSet(isT ? { t: v, g: a.green } : { t: a.temp, g: rtwbTintToGreen(v) });
    }
  };
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); close(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
  });
  inp.addEventListener('blur', () => close(true));
}

/* Build 200: while a slider is dragged (or -50/+50 held), the picture is really rebuilt with the white balance being set,
   as often as the device manages, from the working-size sensor planes cached for the decode -- the same downscale the
   normal build uses, so the result is the one letting go gives. The matrix preview above only bridges the gap between
   two builds. It used to be all there was, and on a filtered shot it could not be right: a UV frame going from its
   as-shot balance to 3000 K multiplies red about 5x and blue about 12x, and the built picture had already lost what
   that needs (channels pushed below zero were stored as zero, blown areas were repaired for the old balance), so the
   colour jumped when the rebuild landed. */
let rtwbLiveBusy = false, rtwbLiveAgain = false;
function rtwbLiveBuild() {
  if (!rawWbDrag) return;
  if (rtwbGpuBuild()) return;   // build 204: on the GPU, in step with the finger
  if (rtwbLiveBusy) { rtwbLiveAgain = true; return; }
  rtwbLiveBusy = true;
  setTimeout(() => {
    try {
      const base = rawEngine.lastResult, wb = rawWbDrag;
      if (base && wb && rawEngine.lastGen === loadToken) {
        // noise reduction on: its cached planes, else the plain working-size ones
        const nr = rawEngine.nrPrev && rawEngine.nrPrev.gen === loadToken ? rawEngine.nrPrev.res : null;
        const full = nr ? { R: nr.R, G: nr.G, B: nr.B, width: nr.width, height: nr.height } : rawWorkingPlanes(base);
        const ds = rtwbHalf(full);   // build 201: half size each way while dragging, a quarter of the work
        const res = Object.assign({}, base, { R: ds.R, G: ds.G, B: ds.B, width: ds.width, height: ds.height, __wb: wb.slice(), __ds: null,
          __hlDone: nr ? !!nr.__hlDone : false, __clip: rawClipFor(base) });
        const checked = !!($('camSpaceSwap') && $('camSpaceSwap').checked);
        rawEngine.builtWbKey = 'drag';   // whatever is let go of, the real build still runs
        // build 201: only the float data the shader reads, oriented and put straight into the texture
        const out = rawEngineResultToCanvas(res, checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName(), false, true);
        const up = rtwbDouble(out.floatBuf, out.w, out.h, full.width, full.height);
        const buf = orientLinearFloat(up, full.width, full.height, srcOrient);
        const sw = srcOrient >= 5 && srcOrient <= 8, W = sw ? full.height : full.width, H = sw ? full.width : full.height;
        if (engine && engine.updateLinearFloat(buf, W, H)) render(true);
        else {   // a size or path it can't take: the full install
          const keepKey = rawEngine.builtKey;
          const cv = rawEngineResultToCanvas(res, checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName());
          rawEngine.builtKey = keepKey; rawEngine.builtWbKey = 'drag';
          installRawPreview(cv, false);
        }
      }
    } catch (e) { console.warn('live white balance build', e); }
    rtwbLiveBusy = false;
    if (rtwbLiveAgain && rawWbDrag) { rtwbLiveAgain = false; rtwbLiveBuild(); } else rtwbLiveAgain = false;
  }, 0);
}

/* Half-size planes (2x2 averages), cached on the planes they came from, and the float result doubled back up to the
   working size (each value into its 2x2 block): the drag preview at a quarter of the work. A phone shows the 2048-pixel
   picture a fifth of that size across, so the difference does not show; letting go builds at full size. */
function rtwbHalf(ds) {
  if (ds.__half) return ds.__half;
  const W = ds.width, H = ds.height, w = Math.max(1, W >> 1), h = Math.max(1, H >> 1);
  const R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const a = (2 * y) * W, b = Math.min(H - 1, 2 * y + 1) * W;
    for (let x = 0; x < w; x++) {
      const x0 = 2 * x, x1 = Math.min(W - 1, x0 + 1), q = y * w + x;
      R[q] = (ds.R[a + x0] + ds.R[a + x1] + ds.R[b + x0] + ds.R[b + x1]) * 0.25;
      G[q] = (ds.G[a + x0] + ds.G[a + x1] + ds.G[b + x0] + ds.G[b + x1]) * 0.25;
      B[q] = (ds.B[a + x0] + ds.B[a + x1] + ds.B[b + x0] + ds.B[b + x1]) * 0.25;
    }
  }
  ds.__half = { R, G, B, width: w, height: h };
  return ds.__half;
}
let rtwbUpBuf = null;
function rtwbDouble(src, w, h, W, H) {
  if (!rtwbUpBuf || rtwbUpBuf.length !== W * H * 4) rtwbUpBuf = new Float32Array(W * H * 4);
  const out = rtwbUpBuf;
  for (let Y = 0; Y < H; Y++) {
    const sy = Math.min(h - 1, Y >> 1), sr = sy * w, dr = Y * W;
    for (let X = 0; X < W; X++) {
      const s4 = (sr + Math.min(w - 1, X >> 1)) * 4, d4 = (dr + X) * 4;
      out[d4] = src[s4]; out[d4 + 1] = src[s4 + 1]; out[d4 + 2] = src[s4 + 2]; out[d4 + 3] = 1;
    }
  }
  return out;
}

/* Build 204: the drag build on the GPU (engine.rawDevelop): the same planes, white balance, clip points and camera matrix
   as the CPU build, run per pixel by the graphics chip straight into the picture's texture. */
/* Compile the program and upload the planes while nothing is happening, so the first drag doesn't pay for it. */
let rtwbWarmFor = null;
function rtwbGpuWarm() {
  const base = rawEngine.lastResult;
  if (!engine || !base || rtwbWarmFor === base || rawEngine.lastGen !== loadToken) return;
  rtwbWarmFor = base;
  const go = () => { try { if (rawEngine.lastResult !== base) return; const full = rawWorkingPlanes(base);
    engine.rawDevelop({ planes: full, w: full.width, h: full.height, orient: srcOrient || 1, prepareOnly: true }); } catch (e) {} };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 800);
}
function rtwbGpuBuild() {
  try {
    const base = rawEngine.lastResult, wb = rawWbDrag;
    if (!engine || !base || !wb || rawEngine.lastGen !== loadToken || !base.__M) return false;
    const nr = rawEngine.nrPrev && rawEngine.nrPrev.gen === loadToken ? rawEngine.nrPrev.res : null;
    const full = nr ? (nr.__planes || (nr.__planes = { R: nr.R, G: nr.G, B: nr.B, width: nr.width, height: nr.height })) : rawWorkingPlanes(base);
    const clip = rawClipFor(base);
    const ok = engine.rawDevelop({ planes: full, w: full.width, h: full.height, orient: srcOrient || 1, wb: wb,
      iclip: clip.map(c => (isFinite(c) && c > 0) ? 1 / c : 0), M: base.__M, hlDone: nr ? !!nr.__hlDone : false });
    if (!ok) return false;
    rawWbBuilt = wb.slice();             // the texture now holds this balance, so the matrix preview stands down
    rawEngine.builtWbKey = 'drag';       // letting go still runs the full build
    render(true);
    return true;
  } catch (e) { return false; }
}
