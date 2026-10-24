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
function rtwbGreenToPos(g) { return Math.round(1000 * Math.log(Math.min(10, Math.max(0.1, g))) / Math.log(10)); }
function rtwbPosToGreen(p) { return Math.pow(10, p / 1000); }
function rtwbFmtT(t) { return String(Math.round(t)); }   // the big readout; its K is a separate span
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
  if (box.hidden === !!res) box.hidden = !res;
  const sw = $('wbSwapStep'); if (sw && sw.hidden === !!res) sw.hidden = !res;
  const grp = $('wbTempGrp'); if (grp) grp.classList.toggle('wbRaw', !!res);
  if (!res) return;
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

  // the big number: long-press (or Enter) to type a value
  const big = $('v_rawTemp'); let lp = null;
  big.addEventListener('pointerdown', () => { clearTimeout(lp); lp = setTimeout(() => { if (typeof haptic === 'function') haptic('tick'); rtwbTypeOpen('rawTemp', big); }, 450); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => big.addEventListener(ev, () => clearTimeout(lp)));
  big.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rtwbTypeOpen('rawTemp', big); } });

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
  if (rtwbLiveBusy) { rtwbLiveAgain = true; return; }
  rtwbLiveBusy = true;
  setTimeout(() => {
    try {
      const base = rawEngine.lastResult, wb = rawWbDrag;
      if (base && wb && rawEngine.lastGen === loadToken) {
        // noise reduction on: its cached planes, else the plain working-size ones
        const nr = rawEngine.nrPrev && rawEngine.nrPrev.gen === loadToken ? rawEngine.nrPrev.res : null;
        const ds = nr ? { R: nr.R, G: nr.G, B: nr.B, width: nr.width, height: nr.height } : rawWorkingPlanes(base);
        const res = Object.assign({}, base, { R: ds.R, G: ds.G, B: ds.B, width: ds.width, height: ds.height, __wb: wb.slice(), __ds: null,
          __hlDone: nr ? !!nr.__hlDone : false, __clip: rawClipFor(base) });
        const checked = !!($('camSpaceSwap') && $('camSpaceSwap').checked);
        const keepKey = rawEngine.builtKey;
        const cv = rawEngineResultToCanvas(res, checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName());
        rawEngine.builtKey = keepKey;
        rawEngine.builtWbKey = 'drag';   // whatever is let go of, the real build still runs
        installRawPreview(cv, false);
      }
    } catch (e) { console.warn('live white balance build', e); }
    rtwbLiveBusy = false;
    if (rtwbLiveAgain && rawWbDrag) { rtwbLiveAgain = false; rtwbLiveBuild(); } else rtwbLiveAgain = false;
  }, 0);
}
