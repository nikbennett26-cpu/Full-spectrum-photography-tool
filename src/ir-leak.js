/* ---------- IR leak removal (build 172) ----------
   For Aerochrome-style stacks that block blue, the sensor's blue channel records infrared alone, while red and green
   record their visible band PLUS some infrared leaking through their dyes. A plain swap carries that leak into the
   result (muddy foliage, glowing edges). The fix, as in the RYE converter discussed on ultravioletphotography.com, is to
   subtract the right fraction of the IR-only channel from red and green, in the camera's own raw space:

       raw R' = R - kR * B        raw G' = G - kG * B

   k is a property of the camera's colour filter dyes, not of the filter stack in front of it, so it is set once per
   camera. Two ways to get it:
     1. ESTIMATED (no effort): from the sensor curve the filter predictor uses, over the infrared your stack passes
        (or 820-880nm when no stack is set). Approximate, because the curve is not your exact camera.
     2. MEASURED (once): open any photo shot through an ~850nm infrared filter and press Measure. Above ~830nm every
        channel sees only infrared, so the ratio of the channels in that frame IS k. Stored per camera model.

   Applied in the shader right after the source is linearised (before white balance and the swap) as ONE 3x3 matrix.
   A RAW is developed here as  out = M * D * raw  (M the camera matrix, D the white balance), so the raw-space
   subtraction L becomes  C = M D L D^-1 M^-1  in the image as irlab holds it: exact for RAWs with camera calibration,
   an approximation (C = L) for JPEGs and other files without it. */
const IRL_KEY = 'irlab.irLeak';
let irLeakOn = false, irLeakAmt = 1;   // the edit's own state (undo, saved looks)
function irlStore() { try { return JSON.parse(localStorage.getItem(IRL_KEY) || '{}') || {}; } catch (e) { return {}; } }
function irlSave(o) { try { localStorage.setItem(IRL_KEY, JSON.stringify(o)); } catch (e) {} }

/* The camera model from the photo's EXIF (tag 0x0110 in IFD0), used to keep one measurement per camera. */
function irlCameraModel() {
  try {
    const s = exifSegment; if (!s || s.length < 20) return '';
    const t = 10, le = s[t] === 0x49, u16 = o => le ? s[o] | (s[o + 1] << 8) : (s[o] << 8) | s[o + 1];
    const u32 = o => le ? (s[o] | (s[o + 1] << 8) | (s[o + 2] << 16) | (s[o + 3] << 24)) >>> 0 : ((s[o] << 24) | (s[o + 1] << 16) | (s[o + 2] << 8) | s[o + 3]) >>> 0;
    const ifd = t + u32(t + 4), n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === 0x0110) {
        const cnt = u32(e + 4), off = cnt <= 4 ? e + 8 : t + u32(e + 8);
        let str = ''; for (let k = 0; k < cnt && s[off + k]; k++) str += String.fromCharCode(s[off + k]);
        return str.trim();
      }
    }
  } catch (e) {}
  return '';
}

/* k estimated from the sensor curve: the infrared each channel records relative to blue, over what the stack passes. */
function irlEstimate() {
  if (typeof fpData === 'undefined' || !fpData) return null;
  const d = fpData, [lo, , step] = d.wl;
  const sensor = ($('fpSensor') && $('fpSensor').value) || Object.keys(d.sensors)[0], s = d.sensors[sensor];
  if (!s) return null;
  const n = d.ill.length, T = new Array(n).fill(1);
  const stack = (typeof fpStack !== 'undefined') ? fpStack : [];
  stack.forEach(id => { const f = d.byId[id]; if (f) f[4].forEach((t, i) => { T[i] *= t; }); });
  const acc = { R: 0, G: 0, B: 0 };
  for (let i = 0; i < n; i++) {
    const l = lo + i * step;
    const inBand = stack.length ? l > 700 : (l >= 820 && l <= 880);
    if (!inBand) continue;
    ['R', 'G', 'B'].forEach(c => { acc[c] += T[i] * s[c][i] * d.ill[i]; });
  }
  if (acc.B <= 1e-9) return null;
  return { kR: acc.R / acc.B, kG: acc.G / acc.B, how: 'estimated from ' + sensor + (stack.length ? ' and your filter stack' : ' at 820–880nm') };
}
function irlMeasured() { const m = irlCameraModel() || 'this camera'; const v = irlStore()[m]; return v ? { kR: v.kR, kG: v.kG, how: 'measured for ' + m } : null; }
function irlK() { return irlMeasured() || irlEstimate(); }

/* The camera->image step for the photo on screen, when it is a calibrated RAW. */
function irlBasis() {
  try {
    const r = rawEngine.lastResult;
    if (r && rawEngine.lastGen === loadToken && r.__M && r.__wb) return { M: r.__M, wb: r.__wb };
  } catch (e) {}
  return null;
}
/* The 3x3 for the shader (column-major), or null when off. */
function irLeakMatrix() {
  if (!irLeakOn) return null;
  const k = irlK(); if (!k) return null;
  const a = Math.max(0, irLeakAmt);
  const L = [1, 0, -k.kR * a, 0, 1, -k.kG * a, 0, 0, 1];
  let C = L;
  const b = irlBasis();
  if (b) {
    const D = [b.wb[0], 0, 0, 0, b.wb[1], 0, 0, 0, b.wb[2]];
    const MD = bfMat3mul(b.M, D);
    C = bfMat3mul(bfMat3mul(MD, L), bfMat3inv(MD));
  }
  return new Float32Array([C[0], C[3], C[6], C[1], C[4], C[7], C[2], C[5], C[8]]);
}

/* Measure k from the photo on screen, which must be shot through an ~850nm (or longer) infrared filter. */
function irlMeasure() {
  if (!loadedImage || !rawPixels) { toast('Open a photo taken through an 850nm filter first'); return; }
  const W = rawCanvas.width, H = rawCanvas.height, lin = v => srgbToLinearF(v / 255);
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = Math.floor(H * 0.2); y < Math.floor(H * 0.8); y += 2) for (let x = Math.floor(W * 0.2); x < Math.floor(W * 0.8); x += 2) {
    const i = (y * W + x) * 4, r = rawPixels[i], g = rawPixels[i + 1], bl = rawPixels[i + 2];
    if (Math.max(r, g, bl) > 250 || Math.min(r, g, bl) < 6) continue;   // clipped or too dark to trust
    sr += lin(r); sg += lin(g); sb += lin(bl); n++;
  }
  if (n < 500) { toast('Not enough usable pixels: the frame is too dark or clipped'); return; }
  let v = [sr / n, sg / n, sb / n];
  const b = irlBasis();
  if (b) {   // back to raw: raw = D^-1 M^-1 out
    const MD = bfMat3mul(b.M, [b.wb[0], 0, 0, 0, b.wb[1], 0, 0, 0, b.wb[2]]), inv = bfMat3inv(MD);
    v = [inv[0] * v[0] + inv[1] * v[1] + inv[2] * v[2], inv[3] * v[0] + inv[4] * v[1] + inv[5] * v[2], inv[6] * v[0] + inv[7] * v[1] + inv[8] * v[2]];
  }
  if (!(v[2] > 1e-6)) { toast('The blue channel is empty in this photo'); return; }
  const kR = v[0] / v[2], kG = v[1] / v[2];
  if (!(kR > 0.05 && kR < 20 && kG > 0.05 && kG < 20)) { toast('These ratios look wrong for an 850nm frame (R ' + kR.toFixed(2) + ', G ' + kG.toFixed(2) + ')', true); return; }
  const m = irlCameraModel() || 'this camera', st = irlStore(); st[m] = { kR: +kR.toFixed(4), kG: +kG.toFixed(4), at: Date.now() }; irlSave(st);
  toast('Measured for ' + m + ': red ' + kR.toFixed(2) + '×, green ' + kG.toFixed(2) + '× the infrared in blue' + (b ? '' : ' (approximate: not a calibrated RAW)'), true);
  irlStatus();
}
function irlStatus() {
  const el = $('irLeakStatus'); if (!el) return;
  const k = irlK();
  el.textContent = k ? 'Red loses ' + k.kR.toFixed(2) + '× and green ' + k.kG.toFixed(2) + '× the blue (infrared) channel · ' + k.how + (irlBasis() ? '' : ' · approximate on this file (not a calibrated RAW)') : 'Open the filter database once (Predict from your filters) or measure an 850nm frame to set it up.';
  const clr = $('irLeakForget'); if (clr) clr.hidden = !irlMeasured();
}
function irlSync() {
  const c = $('irLeakOn'), a = $('irLeakAmt'), v = $('v_irLeakAmt');
  if (c) c.checked = irLeakOn;
  if (a) { a.value = Math.round(irLeakAmt * 100); if (typeof syncSliderFill === 'function') syncSliderFill(a); }
  if (v) v.textContent = Math.round(irLeakAmt * 100) + '%';
  irlStatus();
}
(function wireIrLeak() {
  const c = $('irLeakOn'); if (!c) return;
  c.addEventListener('change', async () => {
    armUndoCapture(); irLeakOn = c.checked;
    if (irLeakOn && !irlK() && typeof fpLoad === 'function') { try { await fpLoad(); } catch (e) {} }
    commitUndoCapture(); irlSync(); render();
  });
  const a = $('irLeakAmt');
  a.addEventListener('pointerdown', armUndoCapture);
  a.addEventListener('input', () => { irLeakAmt = (+a.value || 0) / 100; $('v_irLeakAmt').textContent = a.value + '%'; render(true); });
  a.addEventListener('change', () => { commitUndoCapture(); render(); });
  $('irLeakMeasure').addEventListener('click', () => { irlMeasure(); render(); });
  $('irLeakForget').addEventListener('click', () => { const m = irlCameraModel() || 'this camera', st = irlStore(); delete st[m]; irlSave(st); irlStatus(); render(); });
  const det = $('irLeakDetails');
  if (det) det.addEventListener('toggle', () => { if (det.open && typeof fpLoad === 'function') fpLoad().then(irlStatus).catch(() => {}); irlStatus(); });
  irlSync();
})();
