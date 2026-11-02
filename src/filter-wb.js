/* ---------- RAW white balance from your filters (build 258) ----------

   Pizzamancer's pitch: the app knows the filter stack (Your filters), so it can say which wavelengths each channel
   is catching and set the white balance a photo through that recipe generally wants, instead of only measuring the
   scene. Auto (Cheng PCA) measures the scene, so a frame full of leaves or sky can pull it; this does not look at the
   picture at all, so the same recipe always starts in the same place.

   The physics, per channel c, on the filter database's 10 nm grid (300-1100 nm):
     through your stack:   r_c = sum  sensor_c(l) x stack(l) x sun(l) x target(l)
     unconverted camera:   b_c = sum  sensor_c(l) x hot mirror(l) x sun(l) x grey
   sensor_c is a measured converted-camera response (the one chosen in Digital Aerochrome (advanced); the Sony A7 III by
   default), sun is ASTM G173 global daylight, target is the USGS oak leaf (Leaves neutral: the classic infrared "white
   balance on the foliage") or a flat grey card. The camera's own daylight white balance (its colour profile at 5500 K)
   is calibrated for b; the filter's effect is b_c / r_c, and that ratio is put on top of YOUR camera's daylight
   multipliers. Only the ratio comes from the model sensor, so the model camera's own channel strengths cancel out and
   your camera's calibration is kept.

   "Auto adjusts for the light": the model assumes midday sun. With it on, the scene's own Cheng PCA estimate is
   compared with what the model predicts for a grey card through this stack in sun; that difference is the light (shade,
   low sun, cloud), and it is applied to the recipe's white balance, at most half a stop per channel, so a strange frame
   cannot drag the recipe away. That is the "PCA offset" with the recipe as the anchor. */

let fwbTarget = 'foliage', fwbAuto = true;
try { fwbTarget = localStorage.getItem('irlab.fwbTarget') === 'grey' ? 'grey' : 'foliage'; fwbAuto = localStorage.getItem('irlab.fwbAuto') !== 'off'; } catch (e) {}

/* A camera's own hot mirror and UV cut, as a smooth window (50% at 395 nm and 660 nm). */
function fwbHotMirror(wl) { return wl.map(l => 1 / (1 + Math.exp(-(l - 395) / 6)) / (1 + Math.exp((l - 660) / 12))); }

function fwbSensorName() {
  const sel = $('ffSensor'), names = fpData ? Object.keys(fpData.sensors) : [];
  return sel && sel.value && fpData.sensors[sel.value] ? sel.value : names[0];
}

/* Camera-space multipliers (green = 1) for this stack and target, or { error }. */
function fwbGains(res, stack, target, sensorName) {
  if (!fpData) return { error: 'The filter data has not loaded yet.' };
  if (!stack || !stack.length) return { error: 'Add the filters on your lens first (Filters \u203a Add).' };
  const wl = ffWl(), n = wl.length, S = fpData.sensors[sensorName] || fpData.sensors[Object.keys(fpData.sensors)[0]];
  const sun = ffIll(wl, 'sun'), T = new Array(n).fill(1), V = fwbHotMirror(wl);
  stack.forEach(id => { const f = fpData.byId[id]; if (f) f[4].forEach((t, i) => { T[i] *= t; }); });
  const rho = target === 'grey' ? FF_SURF.grey : FF_SURF.foliage;
  if (!rho || rho.length !== n) return { error: 'Surface data missing.' };
  const sum = (c, k) => { let s = 0; for (let i = 0; i < n; i++) s += S[c][i] * k(i); return s; };
  const r = ['R', 'G', 'B'].map(c => sum(c, i => T[i] * sun[i] * rho[i]));
  const rg = ['R', 'G', 'B'].map(c => sum(c, i => T[i] * sun[i] * 0.18));
  const b = ['R', 'G', 'B'].map(c => sum(c, i => V[i] * sun[i] * 0.18));
  const peak = Math.max(...r);
  if (!(peak > 0) || r.some(v => v < peak * 1e-4)) return { error: 'This stack leaves a channel with almost nothing, so there is no white balance to work out.' };
  const day = rtwbGains(res, 5500, 1);
  if (!day) return { error: 'This camera has no colour profile to start from.' };
  const k = b.map((v, c) => v / r[c]), kg = b.map((v, c) => v / rg[c]);
  const norm = g => [g[0] / g[1], 1, g[2] / g[1]];
  return { wb: norm(day.map((v, c) => v * k[c])), greyWb: norm(day.map((v, c) => v * kg[c])), sensor: sensorName };
}

/* The light correction: the scene's PCA estimate against the model's grey-card prediction, half a stop at most. */
function fwbLightNudge(res, greyWb) {
  if (typeof chengPCAGains !== 'function' || !res || !res.R) return [1, 1, 1];
  const e = chengPCAGains(res.R, res.G, res.B);
  if (!e || (e[0] === 1 && e[1] === 1 && e[2] === 1)) return [1, 1, 1];
  const lim = Math.SQRT2;   // half a stop
  return [0, 1, 2].map(c => Math.min(lim, Math.max(1 / lim, (e[c] / e[1]) / greyWb[c])));
}

/* Build 259: the picker opens right here in the white balance card, so the filters never have to be set in Export first.
   Build 260: these settings sit in their own small box that only shows while Filters is the white balance or its picker is
   open, so As shot, Auto and Pick keep a clean card. */
const fwbOwner = { slot: null, onReturn: () => { const e = $('fwbEdit'); if (e) e.textContent = fpStack.length ? 'Change' : 'Add'; fwbBoxSync(); } };
function fwbBoxSync() {
  const box = $('fwbBox'); if (!box) return;
  const show = (typeof rawWbCustom !== 'undefined' && rawWbCustom && rawWbCustom.src === 'filters') || fpLentTo(fwbOwner);
  if (box.hidden === show) box.hidden = !show;
}
function fwbOpenPicker() { fwbOwner.slot = $('fwbPickHere'); if (!fwbOwner.slot) return; fpLend(fwbOwner); const e = $('fwbEdit'); if (e) e.textContent = 'Done'; fwbBoxSync(); }
function fwbSyncStack() {
  const st = $('fwbStack'); if (st) st.textContent = fpStack.length ? (typeof fpStackNames === 'function' ? fpStackNames().join(' + ') : fpStack.join(' + ')) : 'none yet';
  const e = $('fwbEdit'); if (e && !fpLentTo(fwbOwner)) e.textContent = fpStack.length ? 'Change' : 'Add';
}

function fwbApply() {
  const res = rtwbRes(); if (!res) return;
  if (!fpStack.length) { fwbOpenPicker(); if (typeof toast === 'function') toast('Add the filters on your lens, then press Done'); return; }
  const go = () => {
    const out = fwbGains(res, fpStack, fwbTarget, fwbSensorName());
    if (out.error) { if (typeof toast === 'function') toast(out.error, true); return; }
    let wb = out.wb;
    if (fwbAuto) { const k = fwbLightNudge(res, out.greyWb); wb = [wb[0] * k[0], 1, wb[2] * k[2]]; }
    const tg = rtwbFromGains(res, wb) || { temp: 5000, green: 1 };
    if (typeof haptic === 'function') haptic('select');
    rtwbSet({ t: tg.temp, g: tg.green, wb: wb, src: 'filters' });
    if (typeof toast === 'function') toast('White balance from ' + fpStackNames().join(' + ') + (fwbTarget === 'grey' ? ', grey card' : ', leaves neutral') + (fwbAuto ? ', adjusted for the light' : ''));
  };
  if (fpData) go(); else fpLoad().then(go).catch(() => { if (typeof toast === 'function') toast('The filter data could not load.', true); });
}

/* The stack changed while the white balance came from it: follow the new stack. */
function fwbStackChanged() { fwbSyncStack(); if (!fpLentTo(fwbOwner) && typeof rawWbCustom !== 'undefined' && rawWbCustom && rawWbCustom.src === 'filters' && fpStack.length) fwbApply(); }

(function wireFilterWb() {
  const b = $('rawWbFilt'); if (!b) return;
  b.addEventListener('click', fwbApply);
  const ed = $('fwbEdit'); if (ed) ed.addEventListener('click', () => { if (fpLentTo(fwbOwner)) { fpReturn(fwbOwner); if (fpStack.length) fwbApply(); } else fwbOpenPicker(); });   // Done applies it
  fwbSyncStack();
  const t = $('fwbTarget'), a = $('fwbAuto');
  if (t) { t.value = fwbTarget; t.addEventListener('change', () => { fwbTarget = t.value === 'grey' ? 'grey' : 'foliage'; try { localStorage.setItem('irlab.fwbTarget', fwbTarget); } catch (e) {} if (rawWbCustom && rawWbCustom.src === 'filters') fwbApply(); }); }
  if (a) { a.checked = fwbAuto; a.addEventListener('change', () => { fwbAuto = a.checked; try { localStorage.setItem('irlab.fwbAuto', fwbAuto ? 'on' : 'off'); } catch (e) {} if (rawWbCustom && rawWbCustom.src === 'filters') fwbApply(); }); }
})();
