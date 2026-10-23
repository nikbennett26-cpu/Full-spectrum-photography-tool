/* Build 197: RAW white balance as Temperature (Kelvin) and Green, RawTherapee's model (src/rt-wb.js).

   This is the RAW's own white balance, set before anything else -- before highlight rebuild, the camera matrix and the
   channel swap -- the same place the camera's as-shot setting goes. The Temperature & tint sliders further down are
   unchanged: a +/-600 cast applied after the swap.

   Edit state: rawWbCustom is null (the file opens as the White balance choice under Highlight recovery says: as shot,
   or estimated) or { t: Kelvin, g: Green }. Stored by value, so a saved edit or undo step gives the same light on the
   same file. The sliders always show the white balance in effect, so on a fresh file they read the as-shot setting.

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

function rawWbKey() { return rawWbCustom ? Math.round(rawWbCustom.t) + '/' + rawWbCustom.g.toFixed(4) : rawWbMode(); }

/* Slider positions. Temperature runs on a mired scale, which is how a change of light looks to the eye (the same push
   either side of 5000 K looks about the same), so 3000-7000 K gets a good share of the travel. Green runs on a log
   scale, 0.1 to 10, centred on 1. */
const RTWB_POS = 1000;
function rtwbTempToPos(t) { const m = 1e6 / t, m0 = 1e6 / RTWB_MIN, m1 = 1e6 / RTWB_MAX; return Math.round(RTWB_POS * (m0 - m) / (m0 - m1)); }
function rtwbPosToTemp(p) { const m0 = 1e6 / RTWB_MIN, m1 = 1e6 / RTWB_MAX; return 1e6 / (m0 - (p / RTWB_POS) * (m0 - m1)); }
function rtwbGreenToPos(g) { return Math.round(1000 * Math.log(Math.min(10, Math.max(0.1, g))) / Math.log(10)); }
function rtwbPosToGreen(p) { return Math.pow(10, p / 1000); }
function rtwbFmtT(t) { return Math.round(t) + ' K'; }
function rtwbFmtG(g) { return g.toFixed(3); }

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
  box.hidden = !res;
  if (!res || rawWbDrag) return;
  const tg = rawWbCustom || rtwbFromGains(res, rawWbFor(res)) || { temp: 5000, green: 1 };
  const t = rawWbCustom ? rawWbCustom.t : tg.temp, g = rawWbCustom ? rawWbCustom.g : tg.green;
  const ts = $('rawTemp'), gs = $('rawGreen');
  if (ts && !ts.matches(':active')) { ts.value = rtwbTempToPos(t); if (typeof syncSliderFill === 'function') syncSliderFill(ts); }
  if (gs && !gs.matches(':active')) { gs.value = rtwbGreenToPos(g); if (typeof syncSliderFill === 'function') syncSliderFill(gs); }
  const lt = $('v_rawTemp'), lg = $('v_rawGreen');
  if (lt && !lt.dataset.editing) lt.textContent = rtwbFmtT(t);
  if (lg && !lg.dataset.editing) lg.textContent = rtwbFmtG(g);
  const b = $('rawWbShot'); if (b) b.disabled = !rawWbCustom;
  const off = $('rawWbOff'); if (off) { const o = !rawWbCustom && !!tg.off; if (off.hidden === o) off.hidden = !o; }
}

/* Commit a white balance: an undo step, then rebuild the RAW preview with it. */
function rtwbSet(next) {
  const res = rtwbRes(); if (!res) return;
  if (typeof armUndoCapture === 'function') armUndoCapture();
  rawWbCustom = next ? { t: Math.min(RTWB_MAX, Math.max(RTWB_MIN, next.t)), g: Math.min(RTWB_GMAX, Math.max(RTWB_GMIN, next.g)) } : null;
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
  const cur = () => { const res = rtwbRes(); if (rawWbCustom) return { ...rawWbCustom }; const a = res && rtwbFromGains(res, rawWbFor(res)); return a ? { t: a.temp, g: a.green } : { t: 5000, g: 1 }; };
  let base = null;
  const now = el => { const b = base || cur(); return el === ts ? { t: rtwbPosToTemp(+ts.value), g: b.g } : { t: b.t, g: rtwbPosToGreen(+gs.value) }; };
  const live = ev => {
    const res = rtwbRes(); if (!res) return;
    if (!base) base = cur();
    const v = now(ev.target);
    $('v_rawTemp').textContent = rtwbFmtT(v.t); $('v_rawGreen').textContent = rtwbFmtG(v.g);
    rawWbDrag = rtwbGains(res, v.t, v.g);
    render(true);
  };
  [ts, gs].forEach(el => {
    el.addEventListener('input', live);
    el.addEventListener('change', () => { const v = now(el); base = null; rtwbSet(v); });
  });
  const shot = $('rawWbShot');
  if (shot) shot.addEventListener('click', () => rtwbSet(null));
})();

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
  inp.min = isT ? RTWB_MIN : RTWB_GMIN; inp.max = isT ? RTWB_MAX : RTWB_GMAX; inp.step = isT ? 10 : 0.001;
  inp.value = isT ? Math.round(a.temp) : a.green.toFixed(3);
  bEl.textContent = ''; bEl.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const close = commit => {
    if (done) return; done = true;
    delete bEl.dataset.editing;
    bEl.textContent = prev;
    if (commit && inp.value !== '' && isFinite(+inp.value) && +inp.value > 0) {
      const v = +inp.value;
      rtwbSet(isT ? { t: v, g: a.green } : { t: a.temp, g: v });
    }
  };
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); close(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
  });
  inp.addEventListener('blur', () => close(true));
}
