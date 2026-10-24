'use strict';
/* irlab editor: js/view.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ============================ HISTOGRAM ============================
   Sampled from a downscaled copy rather than the full preview. A histogram
   only needs the DISTRIBUTION of tones, not every pixel, and reading back
   four megapixels on every slider frame would stall the GPU pipeline for no
   visible gain. drawImage from the WebGL canvas works because the context is
   created with preserveDrawingBuffer.

   Debounced rather than run per frame: while a slider is moving, the shape
   is changing faster than anyone can read it. */
const HIST_W = 320;
let scopeMode = 'hist', paradeCv = null;
function setScopeMode(m) {
  scopeMode = m;
  $('btnScopeHist').classList.toggle('on', m === 'hist');
  $('btnScopeParade').classList.toggle('on', m === 'parade');
  drawHistogram();
}
/* RGB parade: the image's columns run left to right, and each channel gets
   its own panel showing the value of every pixel in that column. Where a
   histogram says how much of each level there is, the parade says WHERE in
   the frame each channel sits, which is what makes a channel swap's balance
   readable. Brightness is the pixel count in each cell, on a square-root
   scale so thin tails stay visible. */
function drawParade(ctx, d, W, H, hh) {
  const cw = HIST_W, ch = 128, gap = 3, tw = cw * 3 + gap * 2;
  const counts = [new Uint16Array(cw * ch), new Uint16Array(cw * ch), new Uint16Array(cw * ch)];
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      for (let c = 0; c < 3; c++) {
        const row = ch - 1 - ((d[i + c] * (ch - 1) / 255 + 0.5) | 0);
        counts[c][row * cw + x]++;
      }
    }
  }
  const img = new ImageData(tw, ch);
  const cols = [[255, 92, 64], [104, 224, 132], [96, 160, 255]];
  const pk = Math.max(2, hh * 0.05);
  for (let c = 0; c < 3; c++) {
    const ox = c * (cw + gap);
    for (let row = 0; row < ch; row++) for (let x = 0; x < cw; x++) {
      const n = counts[c][row * cw + x]; if (!n) continue;
      const t = Math.min(1, Math.sqrt(n / pk)), o = (row * tw + ox + x) * 4;
      img.data[o] = cols[c][0] * t; img.data[o + 1] = cols[c][1] * t; img.data[o + 2] = cols[c][2] * t; img.data[o + 3] = 255;
    }
  }
  for (let c = 0; c < 2; c++) for (let row = 0; row < ch; row++) img.data[(row * tw + (c + 1) * cw + c * gap) * 4 + 3] = 0;
  if (!paradeCv) paradeCv = document.createElement('canvas');
  paradeCv.width = tw; paradeCv.height = ch;
  paradeCv.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(paradeCv, 0, 0, W, H);
  ctx.strokeStyle = 'rgba(84,64,42,.55)'; ctx.lineWidth = 1;
  for (let q = 1; q < 4; q++) { const gy = Math.round(H * q / 4) + .5; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
  [1, 2].forEach(q => { const gx = Math.round(W * (q * (cw + gap) - gap / 2) / tw) + .5; ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); });
}
document.addEventListener('DOMContentLoaded', () => {
  const a = $('btnScopeHist'), b = $('btnScopeParade');
  if (a) a.addEventListener('click', () => setScopeMode('hist'));
  if (b) b.addEventListener('click', () => setScopeMode('parade'));
});
let histSrc = null, histCtx = null, histTimer = null;
function scheduleHistogram() {
  if (typeof scheduleCurveHist === 'function') scheduleCurveHist();   // build 169: the histogram behind the Points curve
  if (typeof updateModeNote === 'function') setTimeout(updateModeNote, 120);   // build 171: after the modified dots refresh
  if (histTimer) clearTimeout(histTimer);
  histTimer = setTimeout(() => { if (gamutWarnShown || maskViewIndex() >= 0) return; drawHistogram(); }, 90);
}
function drawHistogram() {
  const cv = $('histogram'), pv = $('preview');
  if (!cv || !loadedImage || !pv.width) return;
  // Collapsed means the readback, the downscale and the 256-bin pass are all
  // wasted work on every render — skip the lot rather than drawing into a
  // hidden element.
  if (!$('scopeDetails').open) return;
  if (!histSrc) { histSrc = document.createElement('canvas'); histCtx = histSrc.getContext('2d', { willReadFrequently: true }); }
  const hh = Math.max(1, Math.round(HIST_W * pv.height / pv.width));
  histSrc.width = HIST_W; histSrc.height = hh;

  /* With Show clipping on, the preview canvas carries red and blue hatching
     painted over the image — and this function samples that canvas. The
     histogram was therefore measuring the warning overlay along with the
     photograph, inventing spikes at the overlay's own colours and inflating
     the very clipping percentages it was drawing. Re-render clean, sample,
     then put the overlay back. Only costs anything while the scope panel is
     open AND clipping is on. */
  const clipOn = !!($('chkClip') && $('chkClip').checked);
  if (clipOn) engine.render(exportParams());
  /* drawImage(pv, ...) reads whatever is CURRENTLY on the canvas -- fine
     when preserveDrawingBuffer held (the common case), since the browser
     hasn't cleared the default framebuffer since the last render. But this
     function runs off a 90ms debounce timer (scheduleHistogram above), a
     real async gap from whatever render() call last drew the canvas -- on
     the devices where WebGL2 could only be obtained WITHOUT
     preserveDrawingBuffer (see the constructor's own comment), the canvas
     may already be blank by the time this runs. Force one fresh,
     synchronous render immediately before reading in that case, and read
     via readPixels() (a direct gl.readPixels() call, unaffected by
     preserveDrawingBuffer either way) instead of drawImage(). */
  if (engine && !engine.hasPreserveBuffer) {
    engine.render(clipOn ? exportParams() : currentParams());
    const px = engine.readPixels();   // already a Uint8ClampedArray, matching pv's own dimensions since pv IS engine.canvas
    const id = new ImageData(px, pv.width, pv.height);
    const tmp = document.createElement('canvas');
    tmp.width = pv.width; tmp.height = pv.height;
    tmp.getContext('2d').putImageData(id, 0, 0);
    histCtx.drawImage(tmp, 0, 0, HIST_W, hh);
    if (clipOn) engine.render(currentParams());
  } else {
    histCtx.drawImage(pv, 0, 0, HIST_W, hh);
    if (clipOn) engine.render(currentParams());
  }

  const d = histCtx.getImageData(0, 0, HIST_W, hh).data;
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  /* Counted per PIXEL, not per channel. The old count took the largest
     single-channel bin-0 total, so one saturated yellow area — B = 0 across
     every pixel of it — reported as a large percentage "at black" while
     nothing in the image was anywhere near black. A pixel is only clipped if
     it has run out of room in all three channels at once. */
  let allBlack = 0, allWhite = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    bins[0][r]++; bins[1][g]++; bins[2][b]++;
    if (r === 0 && g === 0 && b === 0) allBlack++;
    else if (r === 255 && g === 255 && b === 255) allWhite++;
  }

  /* Match the backing store to the element's actual CSS size at device
     resolution, then draw in CSS pixels via setTransform. Without this the
     canvas keeps its 512x110 authored size and the browser rescales it to fit
     — which both blurs the strokes and distorts them, badly so on a wide
     desktop column where the element is 800+ CSS px across. */
  const ctx = cv.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || 512, H = cv.clientHeight || 104;
  const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, W, H);
  if (scopeMode === 'parade') { drawParade(ctx, d, W, H, hh); return; }

  // Ignore bin 0 and bin 255 when scaling. A large flat area of pure black or
  // pure white — which is exactly what heavy channel swapping produces —
  // otherwise creates one enormous spike that squashes everything else into
  // an unreadable flat line.
  let peak = 1;
  for (let c = 0; c < 3; c++) for (let v = 1; v < 255; v++) if (bins[c][v] > peak) peak = bins[c][v];

  ctx.strokeStyle = 'rgba(84,64,42,.5)'; ctx.lineWidth = 1;
  for (let q = 1; q < 4; q++) { const x = Math.round(W * q / 4) + .5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }

  const cols = ['#c2543a', '#6fab8a', '#5f8fa8'];
  ctx.globalCompositeOperation = 'lighter';
  for (let c = 0; c < 3; c++) {
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let v = 0; v < 256; v++) {
      // sqrt keeps the long thin tails visible next to the tall midtone mass
      const y = H - Math.min(1, Math.sqrt(bins[c][v] / peak)) * (H - 2);
      ctx.lineTo(v / 255 * W, y);
    }
    ctx.lineTo(W, H); ctx.closePath();
    ctx.fillStyle = cols[c] + '66'; ctx.fill();
    ctx.strokeStyle = cols[c] + 'cc'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Count only what's genuinely pinned at the ends, and report it as a
  // percentage — the number you actually act on.
  const tot = HIST_W * hh;
  const pct = n => (n / tot * 100);
  const parts = [];
  if (pct(allBlack) > 0.05) parts.push(pct(allBlack).toFixed(1) + '% at black');
  if (pct(allWhite) > 0.05) parts.push(pct(allWhite).toFixed(1) + '% at white');
  /* Reported separately from the two above, because a single pinned channel
     is a different problem with a different fix: it is where hue starts to
     shift, long before the pixel goes white. */
  let anyHi = 0;
  for (let c = 0; c < 3; c++) anyHi = Math.max(anyHi, bins[c][255]);
  if (pct(anyHi) > 0.05 && pct(anyHi) - pct(allWhite) > 0.05)
    parts.push(pct(anyHi).toFixed(1) + '% one channel pinned');
  if (parts.length) {
    ctx.font = '11px ui-monospace,Consolas,monospace';
    ctx.fillStyle = '#a89372'; ctx.textAlign = 'right';
    ctx.fillText(parts.join('  ·  '), W - 6, 14);
  }
}
/* Captured once at startup, before anything can change them. Shared by the
   double-tap reset and by the centre detent. */
const sliderDefaults = {};
document.querySelectorAll('.sl input[type=range]').forEach(r => { sliderDefaults[r.id] = r.value; });

/* ---------- slider gesture gate ----------

   touch-action:pan-y alone does not fix accidental slider edits, because a
   native range input sets its value on POINTERDOWN — it jumps the thumb to
   wherever you touched, before any movement has happened. A finger landing on
   a slider while scrolling has already changed the image by the time the
   browser works out that the gesture was a scroll.

   So every touch on a slider starts undecided. The value is remembered, and
   'input' events are swallowed in the capture phase so nothing renders yet.
   The first 8px of movement decides: mostly horizontal means a real
   adjustment and everything is released; mostly vertical means a scroll, and
   the original value is put straight back.

   A touch that never moves is treated as a scroll too. Tapping a thin slider
   to set a value is imprecise on a phone anyway, and it is exactly the
   gesture that fires accidentally during momentum scrolling. Mouse and pen
   are exempt entirely — they are precise, and clicking a track to jump is
   expected behaviour there. */
/* Pulled out of the old self-contained IIFE so dynamically-created sliders
   (targeted-colour bands, added after page load) can opt into the exact same
   gesture handling via wireSliderGesture() below, rather than a second,
   drifting copy of this logic. */
(function () {
  let g = null;

  // capture phase, so the element's own 'input' handlers never run while the
  // gesture is still undecided or has been rejected
  document.addEventListener('input', e => {
    if (g && e.target === g.el && !g.released) { e.stopPropagation(); }
  }, true);

  function restore() {
    if (!g) return;
    g.el.value = g.value;
    const lab = $('v_' + g.el.id);
    if (lab) lab.textContent = g.value;
    // the fill was already pushed ahead by the pointermove sync above; put
    // it back with the value or it's left pointing at a drag that didn't happen
    const min = +g.el.min || 0, max = +g.el.max || 100, v = +g.el.value || 0;
    g.el.style.setProperty('--val', max > min ? (v - min) / (max - min) * 100 : 0);
  }
  function release() {
    if (!g || g.released) return;
    g.released = true;
    // fire once so the label and preview catch up with the final value
    g.el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---- detents while dragging ----

     A slider that buzzes as it moves needs spacing, not frequency. Input
     events arrive at display rate, and navigator.vibrate CANCELS whatever is
     already running when you call it again — so firing every frame produces
     one long unbroken buzz rather than a series of ticks, and the motor never
     completes a pulse.

     Trimmed after feedback that dragging a slider buzzed continuously: the
     individual pulse was fine, the density was not. Fewer notches (16 rather
     than 24) and a longer floor between pulses (65ms rather than 45ms) means
     a fast swipe ticks noticeably less often, without losing the centre
     detent — which still gets a longer pulse than an ordinary notch, so zero
     is still findable by feel. */
  const DETENTS = 16, MIN_GAP = 65;
  let lastNotch = null, lastTickAt = 0;

  function detentTick(el) {
    const min = +el.min || 0, max = +el.max || 100, v = +el.value;
    const notch = Math.round((v - min) / ((max - min) / DETENTS));
    if (notch === lastNotch) return;
    lastNotch = notch;
    const now = performance.now();
    if (now - lastTickAt < MIN_GAP) return;
    lastTickAt = now;
    const def = sliderDefaults[el.id];
    haptic(def !== undefined && String(v) === String(def) ? 22 : 14);
  }

  /* ---- fine adjustment ----

     A phone slider is ~280px wide and Exposure alone has 600 steps, so one
     pixel of finger travel is two or three steps and landing on an exact
     value by dragging is close to impossible. Precision mode slows the
     thumb down while the drag is in progress:

       mouse / pen : hold Shift          -> 10% speed
       touch       : drag the finger up or down away from the slider while
                     holding -> 25% speed, further away -> 8% speed
       keyboard    : Shift + arrow keys  -> 10 steps at a time

     Once precision mode engages it tracks the pointer by DELTA from then on
     until release, so letting go of Shift or sliding back toward the track
     never makes the thumb jump to wherever the pointer happens to be. The
     native control still wants to set the value from the pointer position,
     so a capture-phase 'input' hook puts our value back before any of the
     slider's own listeners read it. */
  let fineSt = null;
  document.addEventListener('input', e => {
    if (fineSt && fineSt.engaged && e.target === fineSt.el) e.target.value = fineSt.applied;
  }, true);
  function fineEnd() {
    if (!fineSt) return;
    const row = fineSt.el.closest && fineSt.el.closest('.sl');
    if (row) { row.classList.remove('fine'); row.removeAttribute('data-f'); }
    fineSt = null;
  }
  window.addEventListener('pointerup', fineEnd, true);
  window.addEventListener('pointercancel', fineEnd, true);

  function fireInput(el, alsoChange) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (alsoChange) el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function stepInfo(el) {
    const min = el.min === '' ? 0 : +el.min, max = el.max === '' ? 100 : +el.max;
    const step = +el.step > 0 ? +el.step : 1;
    const dec = (String(el.step || '').split('.')[1] || '').length;
    return { min: min, max: max, step: step, dec: dec };
  }
  function wireFine(el) {
    el.addEventListener('pointerdown', e => {
      fineEnd();
      fineSt = { el: el, lastX: e.clientX, startY: e.clientY, cur: 0, f: 1, engaged: false, applied: el.value };
    });
    el.addEventListener('pointermove', e => {
      const s = fineSt;
      if (!s || s.el !== el) return;
      const touch = e.pointerType === 'touch';
      if (touch) {
        // until the scroll-vs-drag gate has decided, just keep the reference point current
        if (!g || g.el !== el || !g.released) { s.lastX = e.clientX; return; }
      } else if (!(e.buttons & 1)) return;
      const dx = e.clientX - s.lastX;
      s.lastX = e.clientX;
      let f = 1;
      if (touch) {
        const dy = Math.abs(e.clientY - s.startY);
        f = dy > 120 ? 0.08 : dy > 50 ? 0.25 : 1;
      } else if (e.shiftKey) f = 0.1;
      if (!s.engaged) {
        if (f === 1) return;
        s.engaged = true;
        s.cur = +el.value;
        haptic(12);
      }
      if (f !== s.f) {
        s.f = f;
        const row = el.closest('.sl');
        if (row) { row.classList.toggle('fine', f < 1); row.setAttribute('data-f', String(f)); row.setAttribute('data-ft', (I18N[uiLang] || I18N.en).fineTag || 'fine'); }
      }
      if (!dx) return;
      const r = stepInfo(el);
      const track = Math.max(40, el.getBoundingClientRect().width - 20);
      s.cur = Math.min(r.max, Math.max(r.min, s.cur + dx / track * (r.max - r.min) * f));
      let v = r.min + Math.round((s.cur - r.min) / r.step) * r.step;
      v = +Math.min(r.max, Math.max(r.min, v)).toFixed(r.dec);
      if (String(v) !== el.value) {
        s.applied = String(v);
        el.value = s.applied;
        fireInput(el, false);
      } else {
        s.applied = el.value;
      }
    });
    el.addEventListener('keydown', e => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      let dir = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') dir = 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') dir = -1;
      if (!dir) return;
      e.preventDefault();
      const r = stepInfo(el);
      let v = +el.value + dir * r.step * 10;
      v = r.min + Math.round((v - r.min) / r.step) * r.step;
      v = +Math.min(r.max, Math.max(r.min, v)).toFixed(r.dec);
      if (String(v) === el.value) return;
      el.value = String(v);
      fireInput(el, true);
    });
  }

  function wire(el) {
    wireFine(el);
    el.addEventListener('input', () => { if (g && g.el === el && g.released) detentTick(el); });
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') { g = null; return; }
      g = { el: el, value: el.value, x: e.clientX, y: e.clientY, released: false, done: false };
      lastNotch = null; lastTickAt = 0;
    });
    el.addEventListener('pointermove', e => {
      if (!g || g.el !== el || g.done) return;
      // Cosmetic only, and deliberately outside the 8px gate below: the
      // browser moves the native thumb the instant a finger drags over it,
      // gate decision or not, so the fill needs to track it just as
      // immediately or the two visibly disagree for the first few pixels
      // of every touch. Reading el.value here is always safe — this never
      // writes app state, only redraws where the track thinks "already
      // past" ends.
      const min = +el.min || 0, max = +el.max || 100, v = +el.value || 0;
      el.style.setProperty('--val', max > min ? (v - min) / (max - min) * 100 : 0);
      const dx = Math.abs(e.clientX - g.x), dy = Math.abs(e.clientY - g.y);
      if (Math.max(dx, dy) < 8) return;
      g.done = true;
      if (dx > dy) release();          // deliberate horizontal drag
      else { haptic('revert'); restore(); }   // a scroll: put the value back
    });
    const end = () => {
      if (!g || g.el !== el) return;
      if (!g.done) { restore(); haptic('revert'); }   // never moved: treat as a scroll
      else if (g.released) { if (!preChangeSnapshot) armUndoCapture(); commitUndoCapture(); }   // the step was armed at touch-down with the state BEFORE the drag; re-arming here recorded the state after it, so a finger drag never made an undo step (and Before never moved)
      g = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  document.querySelectorAll('.sl input[type=range]').forEach(wire);
  window.wireSliderGesture = wire;   // for sliders created after this ran — see targetedHSL's band list
})();

/* ---------- Auto tone ----------

   Per-channel histogram stretch measured from the CURRENT rendered result,
   which is the same thing most auto-levels/auto-colour tools do:
   find where each channel actually starts and stops, and pull those to the
   ends of the range. Doing it per channel is what removes a colour cast,
   because a channel that never gets bright is being told it should.

   Measured after the swap rather than before, matching where the original
   action applied it — the rotation happens first, then the correction. It
   replaces postWBM outright with a fresh, absolute gain each time, rather
   than composing onto whatever was already there — pressing it repeatedly
   lands on the same result instead of compounding brighter each time (an
   earlier version multiplied into the existing gains, which did compound).

   Crucially this MOVES THE EXISTING SLIDERS rather than applying a hidden
   correction. You can see what it decided, undo it, or adjust from there. An
   auto button whose workings you cannot inspect is the thing that made the
   original action impossible to port in the first place. */
const AUTO_CLIP = 0.001;   // ignore the extreme 0.1% at each end, as is standard practice

function autoTone() {
  if (!engine || !loadedImage) return;
  const W = 320;
  const H = Math.max(1, Math.round(W * loadedImage.height / loadedImage.width));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d', { willReadFrequently: true });
  /* Reads loadedImage (the raw, un-edited decode) rather than the live
     $('preview') element. Auto Tone is meant to answer "what's the best
     correction for this photo", a question with one absolute answer that
     shouldn't depend on whatever the sliders currently happen to be set
     to -- reading the LIVE, already-adjusted preview instead meant each
     click analysed an image already brightened by the previous click,
     compounding indefinitely with repeated presses (Phil: "hit it again,
     hit it again... it boosts X% on top of whatever it originally
     decided"). Same reasoning applies to composing onto postWBM below. */
  cx.drawImage(loadedImage, 0, 0, W, H);
  const d = cx.getImageData(0, 0, W, H).data;

  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < d.length; i += 4) { hist[0][d[i]]++; hist[1][d[i+1]]++; hist[2][d[i+2]]++; }
  const total = W * H, cut = Math.max(1, Math.floor(total * AUTO_CLIP));

  const lows = [], highs = [];
  for (let ch = 0; ch < 3; ch++) {
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[ch][v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[ch][v]; if (acc > cut) { hi = v; break; } }
    lows.push(lo); highs.push(Math.max(hi, lo + 1));
  }

  armUndoCapture();

  /* Stretch EACH channel to full range independently. That is what Auto
     Levels does, and the distinction matters enormously.

     An earlier version normalised every channel to the STRONGEST one, so the
     brightest channel got a gain of 1.0 and the image was never lifted at
     all — only its cast corrected. That is fine on an ordinary photo and
     useless after an IR subtraction, where the whole point is that the
     surviving signal is a small difference between two channels and needs
     stretching by a factor of three or four before it looks like anything.
     The EIR preset produced a nearly black frame and Auto tone did nothing
     to rescue it, because lifting was exactly what it refused to do. */
  const gains = highs.map(h => 255 / h);
  // a cap, not a normalisation: it only bites on a channel that is almost
  // entirely empty, where a huge gain would just amplify noise
  const mg = Math.max.apply(null, gains);
  const capped = mg > 12 ? gains.map(g => g * 12 / mg) : gains;
  /* Replaces postWBM outright rather than composing onto it (bfMat3mul
     with the existing matrix) — see the note above the drawImage call
     above: reading the raw source but then still building on top of
     whatever correction was already in place would leave the same
     compounding behaviour, just one step removed. Auto Tone is meant to
     be idempotent — pressing it twice in a row with no other edits in
     between should land on the same result both times, not a stronger
     one. The Bradford eyedropper below is a genuinely different
     operation (refining a manually-picked point against the CURRENT
     image) and composing there remains correct; this is specifically
     about the automatic, no-input case. */
  postWBM = [capped[0],0,0, 0,capped[1],0, 0,0,capped[2]];

  // Black point is a single global control, so take the least aggressive of
  // the three - clipping to the darkest channel would crush the other two.
  const bp = Math.min.apply(null, lows);
  $('blackPt').value = Math.min(60, bp);
  $('v_blackPt').textContent = $('blackPt').value;

  $('wbPostStatus').textContent = 'Auto \u2713 R:' + capped[0].toFixed(2) + ' G:' + capped[1].toFixed(2) + ' B:' + capped[2].toFixed(2);
  $('pickMarkerPost').style.display = 'none';
  ['R','G','B'].forEach((c, i) => {
    const el = $('autoGain' + c); if (!el) return;
    el.value = capped[i].toFixed(2);
    const lbl = $('v_autoGain' + c); if (lbl) lbl.textContent = capped[i].toFixed(2);
  });
  render();
  commitUndoCapture();
  haptic('confirm');
  toast('Auto: gains ' + capped.map(g => g.toFixed(2)).join('/') + ', black point ' + Math.round(lightVal('blackPt')));
}
$('btnAuto').onclick = autoTone;

$('bHome').onclick = () => { backToLanding(); haptic('select'); };
$('chkClip').addEventListener('change', e => render(e));   // render is defined in controls.js, which loads later
$('chkFilmTone').addEventListener('change', () => {
  armUndoCapture();
  filmToneOn = $('chkFilmTone').checked;
  // the strength slider is meaningless with the effect off, so it only
  // appears alongside it rather than sitting there doing nothing
  $('filmToneRow').style.display = $('chkFilmTone').checked ? '' : 'none';
  render(); commitUndoCapture(); haptic('select');
});
// the CMYK warning is drawn inside the clipping overlay, so it needs that on too
$('chkCmyk').addEventListener('change', () => { if ($('chkCmyk').checked && !$('chkClip').checked) $('chkClip').checked = true; render(); });

/* Manual rotation.

   Redraws the working canvas from the decoded source rather than rotating the
   canvas we already have, so repeated turns never compound resampling — four
   rotations get you back to a pixel-identical image. EXIF handles most files;
   this is for the ones tagged wrongly, and for RAW previews from bodies that
   record no orientation at all. */
function applyRotation(dir) {
  if (!sourceImg || !loadedImage) return;
  srcOrient = rotateOrient(srcOrient, dir);
  if (typeof dustRotate === 'function') dustRotate(dir);   // build 185: spots turn with the photo
  const iw = sourceImg.naturalWidth || sourceImg.width;
  const ih = sourceImg.naturalHeight || sourceImg.height;
  const scale = Math.min(1, WORKING_MAX_DIM / Math.max(iw, ih));
  drawOriented(rawCanvas, sourceImg, Math.round(iw * scale), Math.round(ih * scale), srcOrient);
  carryLinearFloat(rawCanvas, sourceImg, srcOrient);   // keep the raw headroom attached
  rawPixels = rawCtx.getImageData(0, 0, rawCanvas.width, rawCanvas.height).data;
  loadedImage = rawCanvas;
  if (engine) engine.setImage(dustPrepare(rawCanvas));
  buildChannelStrip();
  setupCompareOverlay();
  updateExportResOptions();
  zoom = 1; panX = panY = 0; applyZoom();
  render();
  haptic('tick');
}
$('btnRotL').onclick = () => applyRotation(-1);
$('btnRotR').onclick = () => applyRotation(1);

/* Double-tap a slider's value to put it back to its default.

   Accidental slider nudges are the most likely thing to go wrong on a phone,
   and hunting for "what was this before?" across fifteen controls is worse
   than the nudge itself. Undo covers a change you noticed; this covers one
   you didn't. Defaults are read from the markup at startup, so they can never
   drift out of step with the HTML. */
(function () {
  const defaults = sliderDefaults;
  document.querySelectorAll('.sl label b').forEach(bEl => {
    const id = bEl.id.replace(/^v_/, '');
    if (!(id in defaults)) return;
    bEl.title = 'Double-tap to reset to ' + defaults[id];
    bEl.addEventListener('dblclick', ev => {
      ev.preventDefault();
      const r = $(id);
      if (!r || r.value === defaults[id]) return;
      armUndoCapture();
      r.value = defaults[id];
      bEl.textContent = defaults[id];
      render();
      commitUndoCapture();
      haptic('tick');
    });
  });
})();
/* Long-press a slider's number to type an exact value.

   Dragging is limited by fingertip width, not by step size: the hue slider
   spans 360 degrees across roughly 900 CSS pixels, so even at half-degree
   steps a fingertip covers several of them and the fine ones are unreachable
   by dragging alone. Typing is the only way to actually land on them.

   Long-press rather than tap, because a double-tap already resets to default
   and a single-tap handler would swallow the first of those two taps. */
(function () {
  document.querySelectorAll('.sl label b').forEach(bEl => {
    const id = bEl.id.replace(/^v_/, '');
    const range = $(id);
    if (!range || range.type !== 'range') return;
    bEl.title = (bEl.title ? bEl.title + ' · ' : '') + 'Long-press to type a value';

    let timer = null, startXY = null;

    const open = () => {
      if (bEl.dataset.editing) return;
      bEl.dataset.editing = '1';
      haptic('tick');
      const prev = bEl.textContent;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.className = 'vedit';
      if ((id === 'rawTemp' || id === 'rawGreen') && typeof rtwbTypeOpen === 'function') { delete bEl.dataset.editing; rtwbTypeOpen(id, bEl); return; }   // build 197
      const curved = typeof WB_CURVE !== 'undefined' && WB_CURVE[id];   // build 190: typed in the units shown
      inp.min = curved ? -600 : range.min; inp.max = curved ? 600 : range.max;
      inp.step = curved ? 1 : (range.step || 'any');
      inp.value = curved ? Math.round(wbEff(range.value)) : range.value;
      bEl.textContent = '';
      bEl.appendChild(inp);
      inp.focus(); inp.select();

      let done = false;
      const close = commit => {
        if (done) return; done = true;
        delete bEl.dataset.editing;
        let v = prev;
        if (commit && inp.value !== '' && isFinite(+inp.value)) {
          // clamp to the slider's own limits so typing can't produce a state
          // dragging could never reach
          const lo = curved ? -600 : +range.min, hi = curved ? 600 : +range.max;
          v = String(Math.min(hi, Math.max(lo, +inp.value)));
        }
        bEl.textContent = v;
        if (commit && v !== prev) {
          armUndoCapture();
          range.value = curved ? wbPos(v) : v;
          bEl.textContent = curved ? fmtSliderValue(id, range.value) : range.value;   // let the input re-snap it to its step
              render();
          commitUndoCapture();
        }
      };
      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); close(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
      });
      inp.addEventListener('blur', () => close(true));
    };

    /* Build 202: the box opens when the finger LIFTS after a long press, not while it is still down. A phone only counts
       a touch as the person's own action at the lift, and it will not raise the keyboard for a box focused before
       that, so on Android the box used to open with no keyboard and close again: long-press to type did nothing. */
    let armed = false;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } armed = false; };
    bEl.addEventListener('pointerdown', ev => {
      if (bEl.dataset.editing) return;
      startXY = [ev.clientX, ev.clientY];
      cancel();
      if (ev.pointerType === 'mouse') { timer = setTimeout(open, 500); return; }   // a mouse can focus straight away
      timer = setTimeout(() => { timer = null; armed = true; haptic('tick'); }, 500);
    });
    // a press that turns into a drag or a scroll is not a long-press
    bEl.addEventListener('pointermove', ev => {
      if (!startXY) return;
      if (Math.hypot(ev.clientX - startXY[0], ev.clientY - startXY[1]) > 8) cancel();
    });
    bEl.addEventListener('pointerup', () => { const go = armed; cancel(); if (go) open(); });
    ['pointercancel','pointerleave'].forEach(e => bEl.addEventListener(e, cancel));
    // stop the long-press turning into a text selection or context menu
    bEl.addEventListener('contextmenu', ev => { if (timer || bEl.dataset.editing) ev.preventDefault(); });
  });
})();

(function(){ const e=$('chStretch'); if(e) e.addEventListener('change', buildChannelStrip); })();
// the histogram is sized from its element, so a layout change needs a redraw
window.addEventListener('resize', scheduleHistogram);

/* Open by default only where there's vertical room to spare. On desktop the
   preview lives in a fixed 68vh column, so anything below it comes straight
   out of the image — on a short window the scopes are not worth that trade
   unless asked for. An explicit choice is remembered and always wins. */
/* ===================== GOOGLE ANALYTICS 4 =====================

   >>> PUT YOUR MEASUREMENT ID HERE. It looks like G-XXXXXXXXXX and is in
   >>> the GA4 admin under Data Streams. Until it's filled in, nothing loads
   >>> and the consent bar stays hidden — so the page is safe to deploy
   >>> as-is.

   The tag is injected only after Accept. Loading gtag.js first and then
   showing a banner is the common drop-in pattern and it is the wrong way
   round: the cookies are already set by the time anyone is asked. Here the
   request to googletagmanager.com is never made unless consent exists. */
const GA_MEASUREMENT_ID = 'G-CSQ28MD35N';
const CONSENT_KEY = 'irlab.consent';

// The placeholder is a valid-LOOKING id, so it has to be excluded explicitly
// or an unedited file would show the banner and request a bogus tag.
function gaConfigured() {
  return /^G-[A-Z0-9]{6,}$/i.test(GA_MEASUREMENT_ID) && !/^G-X+$/i.test(GA_MEASUREMENT_ID);
}
function readConsent() {
  // 'cookieAck' was filters.html's original key; honour it so anyone who
  // dismissed the notice there isn't asked again here
  try { return localStorage.getItem(CONSENT_KEY) || localStorage.getItem('cookieAck'); } catch (e) { return null; }
}
function writeConsent(v) { try { localStorage.setItem(CONSENT_KEY, v); } catch (e) {} }

let gaLoaded = false;
function loadGA() {
  if (gaLoaded || !gaConfigured()) return;
  gaLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag('js', new Date());
  // anonymised as far as GA4 allows, and no ad personalisation
  gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
  const sc = document.createElement('script');
  sc.async = true;
  sc.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
  document.head.appendChild(sc);
}

/* Notice, not a consent gate: analytics runs and the bar simply tells people
   so, with one button to dismiss it. Dismissal is remembered so it appears
   once rather than on every visit.

   NOTE the comment style throughout this file deliberately never spells out
   the script closing tag. HTML terminates a script element at the first
   occurrence of that sequence regardless of JavaScript context — inside a
   comment or a string makes no difference — and one in a comment here
   silently ended the script early and dumped the remaining source onto the
   page as visible text. */
/* ---------- Web Share Target ----------

   Android hands a shared file to the service worker, which stashes it and
   redirects here with ?shared=1. Poll briefly rather than reading once: the
   worker replies to the share sheet immediately and finishes writing the file
   afterwards, so on a large image this page can easily arrive first.

   Android only. Safari has never implemented share targets, so on iOS this
   simply never fires and the normal Choose image path is used. */
if (location.search.indexOf('shared') !== -1) {
  (async () => {
    const KEY = '/__shared-image';
    const deadline = Date.now() + 6000;
    let res = null;
    while (Date.now() < deadline) {
      try {
        const cache = await caches.open('irlab-share');
        res = await cache.match(KEY);
        if (res) { await cache.delete(KEY); break; }
      } catch (e) { break; }
      await new Promise(r => setTimeout(r, 120));
    }
    // tidy the URL so a refresh doesn't try to re-open a file that's gone
    history.replaceState(null, '', location.pathname);
    if (!res) { toast('Shared image could not be read \u2014 try Choose image instead'); return; }
    const blob = await res.blob();
    let name = 'shared.jpg';
    try { name = decodeURIComponent(res.headers.get('X-Filename') || name); } catch (e) {}
    // wrap as a File so the extension survives — that is what decides whether
    // the RAW preview-extraction path runs
    loadFile(new File([blob], name, { type: blob.type || 'image/jpeg' }));
  })();
}

/* ---------- installable app ----------

   Registering the service worker is what makes the tool work with no
   connection — worth having on its own, and also a prerequisite if this is
   ever wrapped as a Trusted Web Activity for Play, which requires a valid
   manifest and a registered worker.

   Registration is deferred to the load event so it never competes with
   fetching the page itself. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // file:// and sandboxed previews have no worker support; the app simply
      // runs without offline capability rather than erroring
    });
  });
}

/* ---------- updates ----------
   The service worker already fetches the page network-first, so anyone who OPENS the app gets the current build. The
   gap is people who never close it: an installed app kept in the background, or a tab left open for days, keeps
   running the build it loaded. So the page asks the server what the latest build is, in three ways: when it has been
   open a little while, when it comes back to the foreground after a long gap, and when the arrow beside the version
   is tapped. If there is a newer one, a bar offers the update. Updating saves the edit in progress (the app
   already restores it on the next open), clears the cached copies, and reloads. */
const BUILD_NO = +((document.querySelector('meta[name="irlab-build"]') || {}).content) || 0;
const UPD = { latest: 0, last: 0, busy: false, dismissed: 0 };
function updAvailable() { return UPD.latest > BUILD_NO; }
async function updFetchLatest() {
  if (!/^https?:$/.test(location.protocol)) throw new Error('not online');
  // Accept: text/html sends this through the worker's network-first branch (anything else would be answered from its
  // cache), and no-store skips the browser's own HTTP cache, which GitHub Pages lets hold a page for ten minutes
  const r = await fetch(location.origin + '/index.html', { cache: 'no-store', headers: { Accept: 'text/html' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const m = (await r.text()).match(/<meta name="irlab-build" content="(\d+)"/);
  if (!m) throw new Error('no build number in the page');
  return +m[1];
}
function updSyncUi() {
  document.querySelectorAll('.updBtn').forEach(b => {
    b.classList.toggle('has', updAvailable());
    b.title = updAvailable() ? 'A newer version (build ' + UPD.latest + ') is ready: tap to update' : 'Check for a newer version';
    b.textContent = UPD.busy ? '\u21bb Checking\u2026' : (updAvailable() ? '\u2b06 Update to build ' + UPD.latest : '\u21bb');
  });
  const bar = $('updateBar');
  if (bar) bar.classList.toggle('on', updAvailable() && UPD.dismissed !== UPD.latest);
  const t = $('updateBarText'); if (t) t.textContent = 'Update available';
}
async function updCheck(manual) {
  if (UPD.busy) return;
  UPD.busy = true; updSyncUi();
  try {
    UPD.latest = await updFetchLatest(); UPD.last = Date.now();
    if (manual) {
      if (updAvailable()) { UPD.dismissed = 0; toast('Build ' + UPD.latest + ' is available'); }
      else toast('You are on the latest version (build ' + BUILD_NO + ')');
    }
  } catch (e) {
    if (manual) toast('Could not check for updates (' + (e && e.message || 'offline') + ')', true);
  } finally { UPD.busy = false; updSyncUi(); }
}
async function updApply() {
  // save the edit NOW and wait for it: the normal save waits 800 ms, which a reload would beat
  try { if (!SELFTEST && loadedImage) await idbPut('state', { state: captureState(), ts: Date.now() }); } catch (e) {}
  toast('Updating\u2026');
  try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.update().catch(() => {}))); } catch (e) {}
  try { const keys = await caches.keys(); await Promise.all(keys.filter(k => k !== 'irlab-share').map(k => caches.delete(k))); } catch (e) {}
  try { await fetch(location.origin + '/index.html', { cache: 'reload', headers: { Accept: 'text/html' } }); } catch (e) {}
  location.reload();
}
(function wireUpdates() {
  ['buildStamp', 'buildStampHome'].forEach(id => {
    const host = $(id); if (!host || host.querySelector('.updBtn')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'updBtn'; b.textContent = '\u21bb';
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (updAvailable()) updApply(); else updCheck(true); });
    host.appendChild(b);
  });
  const bar = document.createElement('div'); bar.id = 'updateBar'; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span id="updateBarText"></span><button type="button" class="ubGo">Update</button><button type="button" class="ubClose" aria-label="Dismiss">\u00d7</button>';
  document.body.appendChild(bar);
  bar.querySelector('.ubGo').addEventListener('click', updApply);
  bar.querySelector('.ubClose').addEventListener('click', () => { UPD.dismissed = UPD.latest; updSyncUi(); });
  setTimeout(() => updCheck(false), 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - UPD.last > 15 * 60 * 1000) updCheck(false); });
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - UPD.last > 30 * 60 * 1000) updCheck(false); }, 5 * 60 * 1000);
  updSyncUi();
})();

/* Chrome fires beforeinstallprompt only when the install criteria are met, so
   capturing it is the only honest way to know whether an install is actually
   possible. The button stays hidden otherwise rather than offering something
   that would do nothing. */
(function () {
  /* Two buttons: one on the landing page and one in the footer. The footer is
     inside #main, which stays hidden until an image is loaded — so a
     footer-only button was invisible to exactly the people most likely to
     want it, i.e. first-time visitors who haven't loaded anything yet. */
  const btns = [$('btnInstall'), $('btnInstallTop')].filter(Boolean);
  if (!btns.length) return;
  let deferred = null;
  const show = on => btns.forEach(b => b.style.display = on ? 'inline-block' : 'none');

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    window.__bipFired = true;
    deferred = e;
    show(true);
  });
  btns.forEach(b => b.onclick = async () => {
    if (!deferred) return;
    show(false);
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
  });
  window.addEventListener('appinstalled', () => { show(false); deferred = null; });

  /* iOS detection, kept narrow and behaviour-based rather than sniffing for
     "Safari": iPadOS reports itself as a Mac, so the touch-point check is what
     separates a real iPad from a desktop. navigator.standalone is Apple's own
     flag for "already added to the home screen" — if it's set, don't tell them
     to add it again. */
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const alreadyInstalled = navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const note = $('iosInstall');
  if (note && iOS && !alreadyInstalled) note.style.display = 'block';
})();

(function () {
  const bar = $('consentBar'), ok = $('consentYes');
  // guard: a missing element must never throw at top level, or every
  // statement after this point in the script stops running
  if (!bar || !ok) return;

  if (gaConfigured()) {
    loadGA();
    if (readConsent() !== '1') bar.classList.add('on');
  }

  ok.onclick = () => { writeConsent('1'); bar.classList.remove('on'); };

  const reopen = $('consentReopen');
  if (reopen) reopen.onclick = e => {
    e.preventDefault();
    if (!gaConfigured()) { toast('No analytics is configured on this site'); return; }
    bar.classList.add('on');
  };
})();

(function () {
  const det = $('scopeDetails');
  const KEY = 'irlab.scopes';
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode, sandboxed frame */ }
  det.open = saved === null ? (window.innerWidth >= 1100 && window.innerHeight >= 780) : saved === '1';
  det.addEventListener('toggle', () => {
    if (window.__dockSwitching) return;   // the phone layout opens and closes this itself; not the person's choice
    try { localStorage.setItem(KEY, det.open ? '1' : '0'); } catch (e) {}
    if (det.open) { drawHistogram(); return; }
    // Never leave the clipping overlay on with its control hidden — the image
    // would stay covered in hatching with nothing on screen to explain it.
    if ($('chkClip').checked) { $('chkClip').checked = false; render(); }
  });
})();

/* ======================= SOURCE CHANNEL INSPECTOR =======================
   Built once per image from the cached source pixels. Each channel is drawn
   as greyscale so it can be judged on its own, with its mean level printed —
   a channel averaging in the low teens is essentially noise, and promoting it
   into a visible slot amplifies that noise rather than revealing detail. */
function buildChannelStrip() {
  if (!rawPixels || !loadedImage) return;
  const sw = rawCanvas.width, sh = rawCanvas.height;
  /* Fit inside a box rather than capping width alone. Capping only the width
     meant a tall portrait frame produced a 260x390 thumbnail — bigger than it
     can ever be shown at, and three of them. Constrain the LONG edge. */
  const LONG = 200;
  const k = Math.min(1, LONG / Math.max(sw, sh));
  const tw = Math.max(1, Math.round(sw * k)), th = Math.max(1, Math.round(sh * k));
  const ids = ['chR', 'chG', 'chB'], means = ['chRm', 'chGm', 'chBm'], ranges = ['chRr', 'chGr', 'chBr'];
  const stretch = !!($('chStretch') && $('chStretch').checked);

  /* Box-averaged straight down into thumbnail-sized buffers. Building a
     full-resolution greyscale canvas per channel and letting drawImage scale
     it would allocate ~11 MB three times over on a 2048px working image, at
     the exact moment the WebGL texture and both preview canvases are already
     resident — enough memory pressure on a phone to push the browser into
     reduced-resolution rasterising. This never allocates more than the
     thumbnail. */
  const xs = sw / tw, ys = sh / th;
  const stats = [];
  for (let c = 0; c < 3; c++) {
    const cv = $(ids[c]);
    cv.width = tw; cv.height = th;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(tw, th), o = img.data;
    const vals = new Float32Array(tw * th);
    let total = 0, mn = 255, mx = 0;
    for (let y = 0; y < th; y++) {
      const y0 = (y * ys) | 0, y1 = Math.max(y0 + 1, ((y + 1) * ys) | 0);
      for (let x = 0; x < tw; x++) {
        const x0 = (x * xs) | 0, x1 = Math.max(x0 + 1, ((x + 1) * xs) | 0);
        let sum = 0, n = 0;
        for (let yy = y0; yy < y1; yy++) {
          let base = (yy * sw + x0) * 4 + c;
          for (let xx = x0; xx < x1; xx++, base += 4) { sum += rawPixels[base]; n++; }
        }
        const v = sum / n;
        vals[y * tw + x] = v;
        total += v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    /* Optional per-channel stretch. Above roughly 700nm every sensor channel
       sees much the same infrared, so all three thumbnails legitimately look
       alike — and if they are also dark, they look alike AND featureless,
       which is indistinguishable from a broken panel. Stretching each channel
       across its own range makes whatever difference exists visible. It
       changes only this display; nothing downstream uses it. */
    const lo = stretch ? mn : 0, hi = stretch ? mx : 255;
    const span = Math.max(1e-6, hi - lo);
    for (let i = 0; i < vals.length; i++) {
      const v = stretch ? Math.max(0, Math.min(255, (vals[i] - lo) / span * 255)) : vals[i];
      const d = i * 4;
      o[d] = o[d+1] = o[d+2] = v; o[d+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const mean = total / (tw * th);
    stats.push({ mean: mean, mn: mn, mx: mx });
    $(means[c]).textContent = Math.round(mean);
    if ($(ranges[c])) $(ranges[c]).textContent = Math.round(mn) + '\u2013' + Math.round(mx);
  }

  /* Say plainly whether the channels actually differ. "They look the same" is
     a real and correct result for a 720nm capture and a symptom of a problem
     for a 550nm one, and no amount of staring at three dark thumbnails
     distinguishes the two. The numbers do. */
  const v = $('chVerdict');
  if (v) {
    const ms = stats.map(s => s.mean);
    const spread = Math.max.apply(null, ms) - Math.min.apply(null, ms);
    if (spread < 1.5) {
      v.textContent = 'The three channels are near-identical (means within ' + spread.toFixed(1) +
        ' levels). That is normal above roughly 700nm, where every sensor channel sees much the same infrared — a swap will do very little. Below that, expect them to differ.';
    } else {
      v.textContent = 'Channel means differ by ' + spread.toFixed(1) + ' levels, so there is real separation to work with.';
    }
  }
}

/* ============================== LOUPE ==============================
   Magnifies whichever buffer the picker is actually sampling: the untouched
   source for pre-swap WB, the rendered result for post-swap. Showing the
   wrong one would be worse than showing nothing, since the two can differ
   enormously after a swap. */
function showLoupe(mode, clientX, clientY) {
  const lp = $('loupe'), pv = $('preview'), cwEl = $('cw');
  // pickSnapshot (see enterPick) stands in for pv specifically when
  // preserveDrawingBuffer wasn't available to read pv live -- same
  // resolution, same content, just captured once at pick-start instead of
  // read fresh on every pointer move.
  const src = (mode === 'pre' || mode === 'targeted' || mode === 'index') ? rawCanvas : (pickSnapshot || pv);
  // vignette centre is picked on the graded preview, not the raw source —
  // the darkening you're centring on is what the swap and grade produced
  if (!src || !src.width) return;
  const rect = pv.getBoundingClientRect(), cwr = cwEl.getBoundingClientRect();
  const fx = (clientX - rect.left) / rect.width, fy = (clientY - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) { hideLoupe(); return; }

  const span = 26;                       // source pixels across the loupe
  const sx = fx * src.width - span / 2, sy = fy * src.height - span / 2;
  const ctx = lp.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, lp.width, lp.height);
  ctx.drawImage(src, sx, sy, span, span, 0, 0, lp.width, lp.height);

  const mid = lp.width / 2, box = lp.width / span * 3;
  ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineWidth = 3;
  ctx.strokeRect(mid - box/2, mid - box/2, box, box);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  ctx.strokeRect(mid - box/2, mid - box/2, box, box);

  // keep it inside the preview box, and flip below the finger near the top
  const lw = 110, pad = 6;
  let lx = clientX - cwr.left - lw / 2;
  let ly = clientY - cwr.top - lw - 26;
  if (ly < pad) ly = clientY - cwr.top + 26;
  lx = Math.max(pad, Math.min(cwr.width - lw - pad, lx));
  ly = Math.max(pad, Math.min(cwr.height - lw - pad, ly));
  lp.style.left = lx + 'px'; lp.style.top = ly + 'px';
  lp.classList.add('on');
}
function hideLoupe() { $('loupe').classList.remove('on'); }

/* ========================== ZOOM AND PAN ==========================
   Fine detail is invisible at fit-to-screen, so there was no way to confirm
   what the pixel-level controls had done. Transform lives on
   #previewWrap, which means the pick markers and the compare overlay scale
   with the image automatically, and getBoundingClientRect (which every
   coordinate calculation here already uses) accounts for the transform — so
   picking stays accurate at any zoom with no extra maths. */
let zoom = 1, panX = 0, panY = 0;
const ZOOM_MAX = 12;
function applyZoom() {
  const wrap = $('previewWrap');
  if (zoom <= 1.001) { zoom = 1; panX = panY = 0; }
  clampPan();
  wrap.style.transform = zoom === 1 ? '' : `translate(${panX}px,${panY}px) scale(${zoom})`;
  wrap.classList.toggle('zoomed', zoom !== 1);
  $('zoomBadge').classList.add('on');   /* always visible when image loaded */
  const zi = $('zoomInfo'); if (zi) zi.style.display = zoom !== 1 ? 'contents' : 'none';
  $('zoomLevel').textContent = Math.round(zoom * 100) + '%';
  /* At 1:1 the page must still scroll when you drag over the preview, so only
     horizontal gestures and pinch are claimed. Once zoomed in, every direction
     belongs to panning. */
  $('cw').style.touchAction = zoom === 1 ? 'pan-y' : 'none';
}
function clampPan() {
  const pv = $('preview');
  if (!pv.width) return;
  // limit travel to the overhang the scaling created, so the image can't be
  // dragged off into empty space
  const maxX = pv.clientWidth * (zoom - 1) / 2, maxY = pv.clientHeight * (zoom - 1) / 2;
  panX = Math.max(-maxX, Math.min(maxX, panX));
  panY = Math.max(-maxY, Math.min(maxY, panY));
}
function zoomAt(factor, clientX, clientY) {
  const pv = $('preview'), r = pv.getBoundingClientRect();
  const prev = zoom;
  zoom = Math.max(1, Math.min(ZOOM_MAX, zoom * factor));
  if (zoom === prev) return;
  // keep the point under the cursor/fingers fixed while the scale changes
  const cx = clientX - (r.left + r.width / 2), cy = clientY - (r.top + r.height / 2);
  const k = zoom / prev;
  panX = cx - (cx - panX) * k;
  panY = cy - (cy - panY) * k;
  applyZoom();
}
$('btnZoomReset').onclick = () => { zoom = 1; panX = panY = 0; applyZoom(); };

$('cw').addEventListener('wheel', ev => {
  // Plain wheel is left alone so the page still scrolls normally with the
  // cursor over the preview — the preview is most of the screen on desktop,
  // and hijacking it would be worse than the feature is worth. Ctrl/Cmd+wheel
  // zooms, which is also exactly what a trackpad pinch reports, so pinch works
  // on a laptop with no extra handling.
  // The desktop studio layout is the exception: there the photo sits in a fixed pane and the page never scrolls,
  // so a plain mouse wheel over the photo zooms it (in toward the cursor, back out to fit).
  const studio = document.documentElement.classList.contains('studioOn');
  if (!loadedImage || !(ev.ctrlKey || ev.metaKey || studio)) return;
  if (!(ev.ctrlKey || ev.metaKey) && ev.target.closest && ev.target.closest('#cmpBar')) return;   // wheel over the compare bar is not a zoom
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey) { zoomAt(Math.pow(0.988, ev.deltaY), ev.clientX, ev.clientY); return; }   // pinch / ctrl+wheel, as before
  const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;   // lines/pages to px
  zoomAt(Math.pow(0.9985, Math.max(-300, Math.min(300, dy))), ev.clientX, ev.clientY);   // ~15% per mouse-wheel notch
}, { passive: false });

/* Pinch zoom.

   The non-passive touchmove listener is attached ONLY for the duration of an
   actual two-finger gesture, and torn down the moment it ends. This matters a
   great deal: a permanently-registered non-passive touchmove forces the
   browser to run JavaScript before it is allowed to scroll, which takes
   scrolling off the compositor and onto the main thread. Because the preview
   is pinned by a JS transform rather than position:sticky, a main-thread
   scroll makes the pin visibly lag the page — the shearing / rolling-shutter
   effect. With the listener absent during ordinary one-finger scrolling, the
   browser can scroll on the compositor as before. */
let pinch = null;
function pinchMove(ev) {
  if (!pinch || ev.touches.length !== 2) return;
  ev.preventDefault();
  const [a, b] = ev.touches;
  const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  zoomAt(d / pinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
  pinch.d = d;
}
function endPinch() {
  if (!pinch) return;
  pinch = null;
  $('cw').removeEventListener('touchmove', pinchMove);
}
$('cw').addEventListener('touchstart', ev => {
  if (ev.touches.length !== 2 || pinch) return;
  cancelHoldCompare();
  press = null;
  const [a, b] = ev.touches;
  pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
  $('cw').addEventListener('touchmove', pinchMove, { passive: false });
}, { passive: true });
$('cw').addEventListener('touchend', ev => { if (ev.touches.length < 2) endPinch(); }, { passive: true });
$('cw').addEventListener('touchcancel', endPinch, { passive: true });

/* =============== PAN AND HOLD-TO-COMPARE (shared gesture) ===============
   One pointer press has to resolve into one of three things, and it can't
   know which until it sees what happens next:
     - moves while zoomed          -> pan
     - stays still for 220ms       -> hold-to-compare
     - released quickly, in pick   -> the existing tap-to-pick handler
   So the press starts a timer and watches for movement; whichever condition
   fires first wins and cancels the other. */
let press = null, holdTimer = null, holding = false;
function cancelHoldCompare() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  if (!holding) return;
  holding = false;
  // previewOrig is permanently display:block once an image loads; the split is
  // purely clip-path, so hold-to-compare only has to widen it to full and put
  // it back afterwards — no display juggling, which would fight the slider.
  $('previewWrap').classList.remove('comparing');
  $('cmpHandle').style.visibility = '';
  $('holdHint').classList.remove('on');
}
function beginHoldCompare() {
  if (!loadedImage || pickMode || holding) return;
  holding = true;
  $('previewWrap').classList.add('comparing');
  $('cmpHandle').style.visibility = 'hidden';
  $('holdHint').textContent = refIsOriginal ? 'showing original' : 'showing before your last change';
  $('holdHint').classList.add('on');
  haptic('select');
}
$('cw').addEventListener('pointerdown', ev => {
  if (!loadedImage || ev.pointerType === 'mouse' && ev.button !== 0) return;
  if (pinch) return;
  if (ev.target.classList.contains('pickmarker')) return;   // marker drag owns this
  // On desktop the before/after bar (and the readouts) sit inside #cw: a press on a control there is that control's,
  // not a pan or a hold-to-compare -- dragging the compare slider while zoomed used to slide the photo along with it
  if (ev.target.closest && ev.target.closest('#cmpBar, .ptStamps, button, input, select, a, label')) return;
  press = { x: ev.clientX, y: ev.clientY, px: panX, py: panY, id: ev.pointerId, moved: false, panning: false };
  if (!pickMode) {
    holdTimer = setTimeout(() => { holdTimer = null; if (press && !press.moved) beginHoldCompare(); }, 220);
  }
});
$('cw').addEventListener('pointermove', ev => {
  if (!press || press.id !== ev.pointerId) return;
  const dx = ev.clientX - press.x, dy = ev.clientY - press.y;
  if (!press.moved && Math.hypot(dx, dy) > 8) {
    press.moved = true;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (zoom > 1 && !pickMode && !holding) { press.panning = true; $('previewWrap').classList.add('panning'); }
  }
  if (press.panning) {
    ev.preventDefault();
    panX = press.px + dx; panY = press.py + dy;
    applyZoom();
  }
});
const endPress = ev => {
  if (!press || press.id !== ev.pointerId) return;
  if (press.panning) $('previewWrap').classList.remove('panning');
  press = null;
  cancelHoldCompare();
};
$('cw').addEventListener('pointerup', endPress);
$('cw').addEventListener('pointercancel', endPress);
$('cw').addEventListener('pointerleave', endPress);

/* ---------- keyboard shortcuts (desktop) ----------

   All of them share ONE guard: if focus is inside a text field, a number
   input, a button, or anything contentEditable, every shortcut here is
   skipped entirely. That is not just for the letter keys — it matters just
   as much for Ctrl+Z. A focused number input already has its OWN native
   undo for the last keystroke typed into it; intercepting Ctrl+Z globally
   regardless of focus would hijack that and undo the whole app's last
   colour edit instead of fixing a typo in a matrix cell, which is a worse
   experience than having no shortcut at all. */
function shortcutsBlocked(ev) {
  const t = ev.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable);
}

// reuses each preset button's own onclick rather than duplicating what it
// does, so a keyboard cycle behaves identically to a real click — same
// undo step, same haptic, same matrix write
function cyclePreset(dir) {
  const all = Array.from(document.querySelectorAll('.pb'));
  if (!all.length) return;
  const activeIdx = all.findIndex(b => b.classList.contains('on'));
  const next = activeIdx === -1 ? (dir > 0 ? 0 : all.length - 1) : (activeIdx + dir + all.length) % all.length;
  all[next].click();
}

window.addEventListener('keydown', ev => {
  if (shortcutsBlocked(ev)) return;
  const mod = ev.ctrlKey || ev.metaKey;
  const fsOpen = $('previewFullscreen').classList.contains('on');

  if (mod && !ev.altKey && (ev.key === 'z' || ev.key === 'Z')) {
    ev.preventDefault();
    if (ev.shiftKey) $('btnRedo').click(); else $('btnUndo').click();
    return;
  }
  if (mod && !ev.altKey && !ev.shiftKey && (ev.key === 'y' || ev.key === 'Y')) {
    ev.preventDefault(); $('btnRedo').click(); return;   // the Windows-convention alternative to Ctrl+Shift+Z
  }
  if (mod) return;   // everything below is a bare key — leave Ctrl/Cmd+anything-else to the browser

  if (ev.key === 'f' || ev.key === 'F') {
    if (!loadedImage) return;
    ev.preventDefault();
    fsOpen ? closePreviewFullscreen() : openPreviewFullscreen();
    return;
  }
  if (ev.key === 'Escape' && fsOpen) { closePreviewFullscreen(); return; }
  if (ev.key === '[' ) { ev.preventDefault(); cyclePreset(-1); return; }
  if (ev.key === ']' ) { ev.preventDefault(); cyclePreset(1); return; }

  // zoom only means anything with the fullscreen view open — the working
  // preview has its own zoom already reachable by pinch/ctrl+wheel, and
  // overloading bare +/-/0 there would fight with typing in nearby fields
  if (fsOpen) {
    if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); fsZoomAt(1.3, innerWidth/2, innerHeight/2); return; }
    if (ev.key === '-') { ev.preventDefault(); fsZoomAt(1/1.3, innerWidth/2, innerHeight/2); return; }
    if (ev.key === '0') { ev.preventDefault(); resetFsZoom(); return; }
  }
});

// desktop: space is the conventional hold-to-compare key
window.addEventListener('keydown', ev => {
  if (ev.code !== 'Space' || ev.repeat || holding) return;
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
  ev.preventDefault();
  beginHoldCompare();
});
window.addEventListener('keyup', ev => { if (ev.code === 'Space') cancelHoldCompare(); });
/* If the window loses focus mid-hold — alt-tab, a click into another app —
   the pointerup or keyup that would have ended it never arrives, and the
   preview stays frozen on the original with no way to tell why. */
window.addEventListener('blur', cancelHoldCompare);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelHoldCompare(); });

/* ---------- working-preview zoom (desktop) ----------

   Ctrl/Cmd + wheel to zoom about the cursor, drag to pan, double-click or the
   reset button to return to fit. Bare wheel is left alone deliberately: the
   preview sits in a scrolling page and hijacking plain scroll over it would
   trap the page. Ctrl+wheel is also what the browser itself uses for zoom, so
   it is the gesture people already reach for.

   Disabled below 900px. On a phone the preview is pinned and the controls are
   underneath it, so there is no "watch the slider while zoomed" workflow to
   support, and a pan gesture there would fight the page scroll. */
(function initPreviewZoom(){
  const wrap = document.getElementById('previewWrap');
  const cw = document.getElementById('cw');
  const hud = document.getElementById('zoomHud');
  const pct = document.getElementById('zoomPct');
  if (!wrap || !cw) return;

  let z = 1, tx = 0, ty = 0, dragging = false, sx = 0, sy = 0, stx = 0, sty = 0;
  const MIN = 1, MAX = 8;
  const wide = () => window.matchMedia('(min-width:900px)').matches;

  function apply(){
    wrap.style.transform = z === 1 ? '' : 'translate(' + tx + 'px,' + ty + 'px) scale(' + z + ')';
    wrap.classList.toggle('zoomed', z > 1);
    wrap.classList.toggle('hard', z > 1.5);
    cw.classList.toggle('zoomed', z > 1);
    if (pct) pct.textContent = Math.round(z * 100) + '%';
    if (hud) hud.style.display = z > 1 && wide() ? 'flex' : 'none';
  }
  /* Keeps the panned image from being dragged off into empty space: at any
     zoom the visible area can only move by the overhang that zoom created. */
  function clamp(){
    const r = wrap.getBoundingClientRect();
    const maxX = Math.max(0, (r.width * (z - 1)) / (2 * z));
    const maxY = Math.max(0, (r.height * (z - 1)) / (2 * z));
    tx = Math.min(maxX * z, Math.max(-maxX * z, tx));
    ty = Math.min(maxY * z, Math.max(-maxY * z, ty));
  }
  function zoomAt(factor, cx, cy){
    const prev = z;
    z = Math.min(MAX, Math.max(MIN, z * factor));
    if (z === prev) return;
    if (z === 1) { tx = 0; ty = 0; }
    else {
      const r = wrap.getBoundingClientRect();
      // keep whatever sits under the cursor pinned while the scale changes
      const ox = cx - (r.left + r.width / 2);
      const oy = cy - (r.top + r.height / 2);
      tx -= ox * (z / prev - 1);
      ty -= oy * (z / prev - 1);
      clamp();
    }
    apply();
  }

  wrap.addEventListener('wheel', e => {
    if (!wide() || !(e.ctrlKey || e.metaKey)) return;   // bare scroll still scrolls the page
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY);
  }, { passive: false });

  wrap.addEventListener('pointerdown', e => {
    if (!wide() || z <= 1 || e.pointerType === 'touch') return;
    if (wrap.classList.contains('pick')) return;        // colour picking owns the click
    dragging = true; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty;
    wrap.classList.add('dragging');
    try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
  });
  wrap.addEventListener('pointermove', e => {
    if (!dragging) return;
    tx = stx + (e.clientX - sx); ty = sty + (e.clientY - sy);
    clamp(); apply();
  });
  ['pointerup','pointercancel','pointerleave'].forEach(ev =>
    wrap.addEventListener(ev, () => { dragging = false; wrap.classList.remove('dragging'); }));
  wrap.addEventListener('dblclick', e => {
    if (!wide()) return;
    e.preventDefault();
    z > 1 ? (z = 1, tx = 0, ty = 0, apply()) : zoomAt(2, e.clientX, e.clientY);
  });
  const rb = document.getElementById('zoomReset');
  if (rb) rb.addEventListener('click', () => { z = 1; tx = 0; ty = 0; apply(); });
  /* A zoomed preview would otherwise stay zoomed behind the fullscreen view
     and be waiting, still zoomed, when it closes. */
  window.addEventListener('resize', () => { if (!wide() && z !== 1) { z = 1; tx = 0; ty = 0; apply(); } });
  window.__resetPreviewZoom = () => { z = 1; tx = 0; ty = 0; apply(); };
})();

/* ---------- fullscreen preview ----------
   #preview's actual pixel buffer is the full working resolution, shown
   shrunk via CSS to fit the page. "Expand" just copies the already-rendered
   pixels onto a bigger canvas and lets CSS scale that up to fill the
   screen, rather than re-rendering anything. drawImage() works with any
   canvas as its source regardless of context type, and the WebGL context
   was created with preserveDrawingBuffer:true specifically so a snapshot
   like this can read back what's currently on screen. */
/* ---------- fullscreen = full quality, not just full screen ----------

   This used to just canvas-copy the SAME working-resolution frame (capped at
   WORKING_MAX_DIM, 2048px) into a bigger element — "view full size" made the
   existing pixels bigger, it never showed a single pixel of real detail
   beyond what the interactive preview already had. On any file above 2048px
   on its long edge, which is nearly all of them, tapping expand changed
   nothing about what you could actually see.

   The interactive preview has to stay fast — every slider drag re-renders
   it, so it is deliberately downscaled and 8-bit, the same tradeoff every
   editor makes. But there is no reason a MOMENT LIKE THIS, someone
   deliberately stopping to look closely, should be bound by that same
   budget. So fullscreen now does two passes: paint the working-resolution
   frame instantly (unchanged, so there's no blank screen while anything
   loads), then render the actual original file at its own resolution, at
   whatever precision the device supports, in the background, and swap it in
   once ready. Exactly the render the export path already does — this reuses
   it rather than inventing a second copy of it — just displayed instead of
   downloaded.

   This is also the reusable half of "real RAW support": once actual sensor
   pixels are decodable, they plug into this SAME slow-but-careful pass. The
   fast/slow split this creates is the split that will be needed either way. */
let fsRenderGen = 0, fsCacheKey = '', fsCachePx = null, fsCacheWH = null;

/* Must cover EVERY control that changes the render, or the fullscreen view
   serves a stale cached image. HASH_SLIDERS sweeps the sliders, but anything
   living in a plain JS variable has to be listed by hand — and each of the
   toggles below was added after this function was written, so none of them
   invalidated the cache: turning the film LUT on in fullscreen redrew the
   image it had already cached from before, which looks exactly like the
   toggle doing nothing. */
/* Sweeps every control in the editing column automatically instead of
   listing them by hand.

   The hand-written list was wrong again: camMatch, chStretch, chkFilmTone and
   the camera-space swap controls all change the render and none of them were
   hashed, so fullscreen could serve a frame cached from before you touched
   them. That is the same failure the comment above describes happening with
   the film LUT, which is the tell: a list that has to be updated by hand
   every time a control is added will be out of date again by the next one.
   Reading the DOM means a new control is covered the moment it exists.

   Export-only controls are excluded deliberately -- they change the saved
   file, not what is on screen, so hashing them would throw away a valid
   cache for no reason. */
const FS_KEY_EXCLUDE = new Set(['exportProPhoto', 'applyPreviousSettings', 'exportFormat', 'exportQuality']);
function fsControlsKey() {
  const zone = document.getElementById('reorderZone');
  if (!zone) return '';
  return [...zone.querySelectorAll('input, select')]
    .filter(el => el.id && !FS_KEY_EXCLUDE.has(el.id) && el.type !== 'file' && el.type !== 'button')
    .map(el => el.id + ':' + (el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? 1 : 0) : el.value))
    .join(',');
}
function fsStateKey() {
  return fsControlsKey() + '|' +
    MCELLS.map(id => $(id).value).join(',') + '|' +
    HASH_SLIDERS.map(id => { const e = $(id); return e ? e.value : ''; }).join(',') +
    '|' + preWB.join(',') + '|' + postWB.join(',') +
    '|' + (currentLUT ? currentLUT.data.length + ':' + currentLUT.size : 'noLUT') +
    '|' + srcOrient +
    '|' + (filmOn ? 1 : 0) +
    '|' + (lumPreserve ? 1 : 0) +
    '|' + wbMethod + '|' + hueSpace + '|' + indexMode +
    '|' + preWBM.join(',') + '|' + postWBM.join(',') +
    '|' + vigCentre.join(',') +
    '|' + JSON.stringify(targetedBands);
}

function openPreviewFullscreen(){
  const src=$('preview'),full=$('previewFull');
  if(!src.width||!src.height)return; // nothing loaded yet
  fsFullId = null; fsFitId = null; fsShown = '';   // the last full-size render belongs to old settings; the placeholder shows until the new one lands
  full.width=src.width;full.height=src.height;
  /* drawImage(src,...) reads whatever is currently on the WebGL canvas --
     relies on preserveDrawingBuffer, same as the histogram's own comment
     explains, and for the same reason: the browser may have already
     composited/cleared the default framebuffer by the time someone taps
     Expand, since there's no guarantee this runs right after a render().
     On devices where WebGL2 could only be had WITHOUT
     preserveDrawingBuffer, force one fresh render and readPixels() instead
     -- this is only ever a brief placeholder anyway (renderFullscreenHQ
     below replaces it a moment later), so the extra render here is cheap
     and one-off, not a per-frame cost. */
  if (engine && !engine.hasPreserveBuffer && loadedImage) {
    engine.render(currentParams());
    const px = engine.readPixels();
    const id = new ImageData(px, src.width, src.height);
    full.getContext('2d').putImageData(id, 0, 0);
  } else {
    full.getContext('2d').drawImage(src,0,0);
  }
  resetFsZoom();
  $('previewFullscreen').classList.add('on');
  document.body.classList.add('fs-open');
  $('fsBadge').textContent = src.width + '\u00d7' + src.height + ' \u00b7 preview resolution';
  renderFullscreenHQ();
}

let fsDebounceTimer = null;
function scheduleFullscreenHQ() {
  // debounced, same reasoning as scheduleTriLevels: this is expensive enough
  // (a full original-resolution render) that running it on every frame of a
  // slider drag would make dragging feel awful while fullscreen is open
  if (fsDebounceTimer) clearTimeout(fsDebounceTimer);
  fsDebounceTimer = setTimeout(renderFullscreenHQ, 200);
}

async function renderFullscreenHQ() {
  if (!origFile) return;                          // nothing to render at higher quality
  const gen = ++fsRenderGen;                       // discard this result if superseded
  const key = fsStateKey();

  if (key === fsCacheKey && fsCachePx && fsCacheWH) {
    paintFullscreenResult(fsCachePx, fsCacheWH[0], fsCacheWH[1]);
    return;
  }

  $('fsBadge').textContent = 'Rendering full resolution\u2026';
  $('fsBadge').classList.add('busy');
  let out;
  try { out = await renderAtOriginalRes(); }
  catch (e) { out = null; }                        // stay on the working-res copy already shown
  if (gen !== fsRenderGen) return;                  // settings changed or fullscreen closed meanwhile
  $('fsBadge').classList.remove('busy');
  if (!out) { $('fsBadge').textContent = $('preview').width + '\u00d7' + $('preview').height + ' \u00b7 preview resolution'; return; }

  fsCacheKey = key; fsCachePx = out.px; fsCacheWH = [out.w, out.h];
  paintFullscreenResult(out.px, out.w, out.h);
}

/* Build 108. Fitted to the screen, a full-size render used to be shrunk by the browser, which on phones samples a few
   pixels out of every block instead of averaging them: a 5202-pixel-tall picture shown 900 pixels tall kept nearly the
   full per-pixel noise, so a sky looked about twice as grainy as the same file does when properly reduced (as any
   viewer, or an export opened later, shows it). Fitted, the view now shows an area-averaged copy at the screen's own
   resolution; zoomed in, it switches to the full-size pixels. */
let fsFullId = null, fsFitId = null, fsShown = '';
function fsAreaDown(src, w, h, tw, th) {
  const out = new ImageData(tw, th), d = out.data, acc = new Float64Array(tw * 3), cnt = new Uint32Array(tw);
  const xs = new Uint32Array(w); for (let x = 0; x < w; x++) xs[x] = Math.min(tw - 1, Math.floor(x * tw / w));
  let ty = 0, rows = 0;
  for (let y = 0; y <= h; y++) {
    const ny = y < h ? Math.min(th - 1, Math.floor(y * th / h)) : -1;
    if (ny !== ty || y === h) {
      for (let x = 0; x < tw; x++) { const n = cnt[x] || 1, o = (ty * tw + x) * 4; d[o] = acc[x * 3] / n; d[o + 1] = acc[x * 3 + 1] / n; d[o + 2] = acc[x * 3 + 2] / n; d[o + 3] = 255; }
      acc.fill(0); cnt.fill(0); ty = ny; rows = 0;
      if (y === h) break;
    }
    const r = y * w * 4;
    for (let x = 0; x < w; x++) { const i = r + x * 4, j = xs[x] * 3; acc[j] += src[i]; acc[j + 1] += src[i + 1]; acc[j + 2] += src[i + 2]; cnt[xs[x]]++; }
    rows++;
  }
  return out;
}
function fsShowFor(zoom) {
  const full = $('previewFull'), want = (zoom > 1.001 || !fsFitId) ? 'full' : 'fit';
  if (want === fsShown || !fsFullId) return;
  const id = want === 'full' ? fsFullId : fsFitId;
  if (full.width !== id.width || full.height !== id.height) { full.width = id.width; full.height = id.height; }
  full.getContext('2d').putImageData(id, 0, 0);
  fsShown = want;
}
function paintFullscreenResult(px, w, h) {
  const full = $('previewFull');
  full.width = w; full.height = h;
  const is16 = px instanceof Uint16Array;
  const ctx = full.getContext('2d');
  const id = ctx.createImageData(w, h);
  id.data.set(is16 ? quantize8(px, w, h) : px);      // same dither used for PNG/JPEG export, not a new path
  ctx.putImageData(id, 0, 0);
  fsFullId = id; fsFitId = null; fsShown = 'full';
  { const box = $('previewFullscreen'), dpr = window.devicePixelRatio || 1;
    const k = Math.min((box.clientWidth || innerWidth) * dpr / w, (box.clientHeight || innerHeight) * dpr / h);
    if (k < 0.75) { try { fsFitId = fsAreaDown(id.data, w, h, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))); } catch (e) { fsFitId = null; } } }
  fsShowFor(fsZoom);
  $('fsBadge').textContent = w + '\u00d7' + h + (is16 ? ' \u00b7 16-bit render' : ' \u00b7 8-bit render');
  // re-clamp against the new element size rather than reset it — zoom/pan
  // should survive the placeholder-to-HQ swap so a spot you zoomed in on
  // simply gets sharper, it doesn't jump back to fit-to-screen underneath you
  applyFsZoom();
}

/* ---------- zoom/pan in the fullscreen view ----------

   Rendering the real resolution was the point of the last change; this is
   what makes it possible to actually LOOK at that resolution rather than
   just see the same shape slightly less compressed. Without this, a
   6000-pixel render was still only ever seen shrunk to fit a 1080px screen.

   Deliberately simpler than the main preview's zoom: that one has to
   distinguish a pinch/pan from the page trying to scroll behind it, because
   the preview sits inline in a scrolling document. This overlay is
   position:fixed;inset:0 with nothing scrollable behind it, so panning can
   just always win once zoomed in — no gesture disambiguation needed. */
let fsZoom = 1, fsPanX = 0, fsPanY = 0;
const FS_ZOOM_MAX = 12;

function applyFsZoom() {
  const el = $('previewFull');
  if (fsZoom <= 1.001) { fsZoom = 1; fsPanX = fsPanY = 0; }
  const maxX = el.clientWidth * (fsZoom - 1) / 2, maxY = el.clientHeight * (fsZoom - 1) / 2;
  fsPanX = Math.max(-maxX, Math.min(maxX, fsPanX));
  fsPanY = Math.max(-maxY, Math.min(maxY, fsPanY));
  el.style.transform = fsZoom === 1 ? '' : `translate(${fsPanX}px,${fsPanY}px) scale(${fsZoom})`;
  fsShowFor(fsZoom);
}
function fsZoomAt(factor, clientX, clientY) {
  const el = $('previewFull'), r = el.getBoundingClientRect();
  const prev = fsZoom;
  fsZoom = Math.max(1, Math.min(FS_ZOOM_MAX, fsZoom * factor));
  if (fsZoom === prev) return;
  const cx = clientX - (r.left + r.width / 2), cy = clientY - (r.top + r.height / 2);
  const k = fsZoom / prev;
  fsPanX = cx - (cx - fsPanX) * k;
  fsPanY = cy - (cy - fsPanY) * k;
  applyFsZoom();
}
function resetFsZoom() { fsZoom = 1; fsPanX = fsPanY = 0; applyFsZoom(); }

$('previewFull').addEventListener('wheel', ev => {
  ev.preventDefault();
  fsZoomAt(Math.pow(0.988, ev.deltaY), ev.clientX, ev.clientY);
}, { passive: false });
$('previewFull').addEventListener('dblclick', resetFsZoom);

let fsPinch = null, fsDrag = null;
$('previewFull').addEventListener('touchstart', ev => {
  if (ev.touches.length === 2) {
    const [a, b] = ev.touches;
    fsPinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
  }
}, { passive: true });
$('previewFull').addEventListener('touchmove', ev => {
  if (fsPinch && ev.touches.length === 2) {
    ev.preventDefault();
    const [a, b] = ev.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    fsZoomAt(d / fsPinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    fsPinch.d = d;
  }
}, { passive: false });
$('previewFull').addEventListener('touchend', ev => { if (ev.touches.length < 2) fsPinch = null; });

$('previewFull').addEventListener('pointerdown', ev => {
  if (fsZoom <= 1.001 || fsPinch) return;          // nothing to drag at 1:1
  ev.preventDefault();
  $('previewFull').setPointerCapture(ev.pointerId);
  $('previewFull').classList.add('panning');
  fsDrag = { x: ev.clientX, y: ev.clientY, px: fsPanX, py: fsPanY, id: ev.pointerId };
});
$('previewFull').addEventListener('pointermove', ev => {
  if (!fsDrag || fsDrag.id !== ev.pointerId) return;
  ev.preventDefault();
  fsPanX = fsDrag.px + (ev.clientX - fsDrag.x);
  fsPanY = fsDrag.py + (ev.clientY - fsDrag.y);
  applyFsZoom();
});
const endFsDrag = ev => {
  if (!fsDrag || fsDrag.id !== ev.pointerId) return;
  try { $('previewFull').releasePointerCapture(ev.pointerId); } catch (e) {}
  $('previewFull').classList.remove('panning');
  fsDrag = null;
};
$('previewFull').addEventListener('pointerup', endFsDrag);
$('previewFull').addEventListener('pointercancel', endFsDrag);

function closePreviewFullscreen(){
  $('previewFullscreen').classList.remove('on');
  document.body.classList.remove('fs-open');
  fsRenderGen++;                                     // abandon any in-flight HQ render
}
$('btnExpandPreview').addEventListener('click',ev=>{ev.stopPropagation();openPreviewFullscreen();});
$('btnCloseFullscreen').addEventListener('click',closePreviewFullscreen);
$('previewFullscreen').addEventListener('click',ev=>{if(ev.target.id==='previewFullscreen')closePreviewFullscreen();});

// 3. Matrix & Render Logic
/* Scale each row so its entries total 100%, which is what leaves the
   channel's brightness unchanged.

   This previously divided by the sum of the ABSOLUTE values, which is a
   different number as soon as a row contains a negative — and every IR-sub
   preset does. Row [0, 100, -30] nets to 70: it deliberately darkens that
   channel by 30%. Normalizing is supposed to bring it back to 100. Dividing
   by the absolute total of 130 instead gave [0, 76.9, -23.1], a net of 54 —
   so ticking the box made the row darker still, the opposite of both its
   name and its description. Dividing by the signed total gives
   [0, 142.9, -42.9], which nets to exactly 100.

   A row netting to near zero cannot be normalised at all — there is no
   scale factor that turns 0 into 100, and dividing by it would explode or
   flip the row's sign. Those are left alone. */

function getMatrixUI() {
  const raw = MCELLS.map(id => (+$(id).value || 0) / 100);
  return raw;
}
/* Offsets, scaled to a useful range. The cells read in the same 0-100 units
   as the gains so the row reads consistently, but a constant of 1.0 in
   linear light is blinding \u2014 0.25 at full slider is a strong but usable
   lift, which keeps the column worth having without making every value near
   the top useless. */
function getMatrixOffsetUI() {
  return MOFFCELLS.map(id => ((+$(id).value || 0) / 100) * 0.25);
}

// Temperature/tint as RGB gains, normalised so LUMINANCE stays constant —
// these shift colour only, they don't brighten or darken. Temperature moves
// red against blue (warm/cool); tint moves green against red+blue
// (green/magenta), which is the axis Lightroom's tint slider works on.
// suppressTempTint is set while the WB picker samples, so the picker
// measures a clean neutral rather than trying to cancel a deliberate cast.
let suppressTempTint = false;
/* Contrast slider -> S-curve strength. The default is now 0, which maps to
   strength exactly 1.0 — a true mathematical no-op, so an untouched slider
   leaves tone completely alone and every bit of contrast in the result is
   something you asked for. (It previously defaulted to 25, baking in a
   permanent 1.18 S-curve that had to be dialled back out.) The two slopes
   differ because flattening is far more visually aggressive than adding
   contrast, so the negative side is deliberately gentler. */
/* Mean luminance of the source, for the contrast pivot.
   RawTherapee pivots its contrast S-curve on the image's actual mean
   luminance (computed from the histogram after prior adjustments). We do
   the same: a 256-bin histogram, subsampled every 4th pixel, gives tens of
   thousands of samples — stable to well under a bin, and runs once on load.

   Using the MEAN rather than the median, and removing the old min(0.50) cap,
   lets the pivot track bright IR images correctly. An IR conversion with
   lots of white foliage typically measures ~0.65–0.72; capping at 0.50
   put the pivot well below the actual midtones and made contrast crush
   shadows instead of bending around the image's real grey point. The lower
   clamp (0.15) stays: a near-black frame should still use a sane pivot. */
function medianLuminance(px) {
  if (!px || !px.length) return 0.5;
  const bins = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < px.length; i += 16) {
    const y = (0.2126 * px[i] + 0.7152 * px[i+1] + 0.0722 * px[i+2]) | 0;
    bins[y < 0 ? 0 : y > 255 ? 255 : y]++; n++;
  }
  if (!n) return 0.5;
  /* Weighted mean — same as RT's avg computation over histogram bins. */
  let sum = 0;
  for (let b = 0; b < 256; b++) sum += bins[b] * b;
  const mean = sum / (n * 255);
  return Math.max(0.15, Math.min(0.85, mean));
}
/* Contrast slider -> sCurve exponent.

   Steepened because the old scaling topped out at an exponent of 1.72, which
   is a mild S \u2014 measured across the full slider it moved the frame mean only
   from 157 to 130. Lightroom-style contrast at maximum sits nearer 2.3-3.0.
   Now 2.30 at +100 and 0.40 at -100, so both ends of the slider do something
   worth the travel. The negative side is scaled more gently than the positive
   because flattening runs out of usefulness faster than steepening does. */
function contrastStrength(v) {
  /* Positive slope reduced from 0.013 to 0.009: at +100 the old strength
     of 2.30 crushed a 0.1 shadow to 0.012 (nearly black). 0.009 gives 1.90,
     which is closer to what a moderate S-curve should do at its extreme.
     Negative slope also eased: 0.006 -> 0.005. */
  v = (v === undefined || v === null) ? 0 : v;
  return v >= 0 ? 1 + v * 0.009 : 1 + v * 0.005;
}
function tempTintGains() {
  if (suppressTempTint) return [1, 1, 1];
  const t = wbEff($('temp') ? $('temp').value : 0) / 100;   // build 190: the sliders hold a position on a curve
  const m = wbEff($('tint') ? $('tint').value : 0) / 100;
  ['temp', 'tint'].forEach(id => { const l = $('v_' + id), el = $(id); if (l && el && !l.dataset.editing) { const s = String(fmtSliderValue(id, el.value)); if (l.textContent !== s) l.textContent = s; } });
  if (typeof rtwbSyncUi === 'function') rtwbSyncUi();   // build 197: the RAW white balance readout
  if (t === 0 && m === 0) return [1, 1, 1];
  /* Exponential rather than linear. The old form subtracted from 1, so blue
     hit zero at slider 357 and went negative past it — which is why the range
     could not simply be widened. exp() cannot produce a negative gain at any
     value, so the slider can now run as far as it is useful.

     Deliberately the same coefficients: exp(x) and 1+x agree closely at this
     scale, so the response through the old range is effectively unchanged —
     R/B at full temp reads 1.75 against the old 1.78 — and every saved
     session, preset and .cube keeps meaning what it meant. */
  let r = Math.exp( 0.28 * t + 0.12 * m);
  let g = Math.exp(          - 0.16 * m);
  let b = Math.exp(-0.28 * t + 0.12 * m);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / lum, g / lum, b / lum];
}
