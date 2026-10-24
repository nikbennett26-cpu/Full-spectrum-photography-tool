'use strict';
/* irlab editor: js/ui.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- drag and drop, anywhere on the page ----------

   This used to be bound to #dropzone alone, which has two consequences worth
   spelling out. #dropzone lives inside #emptyStateGroup and is hidden the
   moment an image loads, so once you were working there was nowhere to drop a
   replacement. And a file dropped anywhere ELSE hit the browser default,
   which is to navigate the tab to that file — losing the session outright.
   Preventing the default at window level is not a nicety; without it the page
   throws away your work if you miss a target you cannot even see. */
const dz = $('dropzone');

function dropCard() {
  let el = document.getElementById('dropOverlay');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'dropOverlay';
  el.innerHTML = '<div>Drop to open</div>';
  document.body.appendChild(el);
  return el;
}

let dragDepth = 0;   // enter/leave fire for every child element, so count them
function dragShow(on) {
  dropCard().classList.toggle('on', on);
  if (dz) dz.classList.toggle('dragover', on);
}

// only react to an actual file drag, not text selections being dragged about
function hasFiles(e) {
  const dt = e.dataTransfer;
  if (!dt) return false;
  if (dt.types) return Array.prototype.indexOf.call(dt.types, 'Files') !== -1;
  return true;
}

window.addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dragShow(true);
});
window.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();                     // required, or the drop never fires
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', e => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dragShow(false);
});
window.addEventListener('drop', e => {
  e.preventDefault();                     // stop the browser navigating to the file
  dragDepth = 0;
  dragShow(false);
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

/* Paste an image straight in. Screenshots and copied files both arrive on the
   clipboard as files, and reaching for a file picker to open something already
   on the clipboard is a step nobody wants. Ignored while typing in a field. */
window.addEventListener('paste', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const items = e.clipboardData && e.clipboardData.files;
  if (items && items.length) { e.preventDefault(); loadFile(items[0]); }
});

function resetAllControls() {
  const identity = [100,0,0, 0,100,0, 0,0,100];
  MCELLS.forEach((id, i) => $(id).value = identity[i]);
  /* The three matrix OFFSET cells were never cleared here: only the nine matrix numbers were. The H.H. recipe sets offsets
     (it folds its Levels steps into them), so after it, Reset all and, worse, simply opening the next photo (which runs this
     function) left them in place: an identity swap with a fifth of the range taken off every channel, which is a dark picture
     with the blue crushed to nothing, the olive-green cast, on a photo nobody had touched. */
  MOFFCELLS.forEach(id => { const e = $(id); if (e) e.value = 0; });
  window.__hhPrev = null; window.__eirOn = false;   // no recipe is in force after a full reset (its other settings are reset below)
  if (typeof presetMixClear === 'function') presetMixClear();
  mxSync();
  preWB = [1, 1, 1]; postWB = [1, 1, 1]; preWBM = IDENTITY3; postWBM = IDENTITY3;
  resetAutoGainSliders();
  wbMethod = 'bradford';
  hueSpace = 'perceptual'; syncHueSpaceButtons();
  lumPreserve = false; $('lumPreserve').checked = false;
  [['lumaR',21],['lumaG',72],['lumaB',7]].forEach(([id,v]) => {
    const el = $(id); if (el) { el.value = v; const lbl = $('v_'+id); if (lbl) lbl.textContent = fmtSliderValue(id, v); }
  });
  filmOn = false; $('filmOn').checked = false;
  if ($('swapSpace')) $('swapSpace').value = '2';   // ProPhoto, the default
  if ($('swapWiden')) { $('swapWiden').value = 100; if ($('v_swapWiden')) $('v_swapWiden').textContent = 100; if (typeof syncSliderFill === 'function') syncSliderFill($('swapWiden')); }
  /* The three toggles added after this handler was written, each of which
     changes the rendered image and so belongs in a reset. They were missed
     when they were added, which left them ticked after a Reset all while
     every slider around them went to zero — the image kept a look the
     controls said it no longer had.

     Their JS mirrors have to be cleared too, not just the checkboxes: the
     mirrors are what currentParams reads, so clearing only the boxes would
     have reset the interface and left the render untouched. */
  filmToneOn = false; if ($('chkFilmTone')) $('chkFilmTone').checked = false;
  if ($('filmToneRow')) $('filmToneRow').style.display = 'none';
  if ($('filmToneAmt')) { $('filmToneAmt').value = 0; $('v_filmToneAmt').textContent = 0; }
  camMatchOn = false; if ($('camMatch')) $('camMatch').checked = false;
  if (typeof irLeakOn !== 'undefined') { irLeakOn = false; irLeakAmt = 1; irlSync(); }   // build 172
  if (typeof dustSpots !== 'undefined' && dustSpots.length) { dustSpots = []; dustSel = -1; dustRefresh(); }   // build 185
  targetedBands = []; bandRenderList();
  ['hotR','hotG','hotB','caR','caB','bright','hue','brightness','blackPt','whitePt','noiseReduction','sharpen','noiseColour','temp','tint','satPreserve','contrast','highlights','shadows','vigAmt','vibrance',
   'clarity','dehaze','calRH','calGH','calBH','calRS','calGS','calBS','calST','rawNrL','rawNrC','rawHl','epdAmt','debandAmt','skyDeep','crimsonFol','orton']
    .forEach(id => { const el = $(id); if (!el) return; el.value = 0; const lbl = $('v_' + id); if (lbl) lbl.textContent = 0; });
  HSL_IDS.forEach(id => { const el = $(id); if (!el) return; el.value = 0; const lbl = $('v_' + id); if (lbl) lbl.textContent = 0; });
  ['hiRange', 'shRange'].forEach(id => { const el = $(id); if (!el) return; el.value = 50; const lbl = $('v_' + id); if (lbl) lbl.textContent = 50; });
  [['epdEdge', 140], ['epdScale', 100], ['ortonSoft', 50]].forEach(([id, v]) => { const el = $(id); if (el) el.value = v; const lbl = $('v_' + id); if (lbl && id === 'ortonSoft') lbl.textContent = v; });
  if (typeof syncEpdLabels === 'function') syncEpdLabels();
  if (typeof syncRangeToggle === 'function') syncRangeToggle();
  /* Radius and Masking do not reset to zero, unlike every other slider here.
     They are not amounts, they are settings that describe HOW the sharpening
     works, and both have meaningful non-zero defaults -- radius 0 would be
     below the slider's own minimum and masking 0 means "sharpen the noise
     too", neither of which is a neutral state. Reset returns them to their
     defaults instead, with Amount at zero doing the actual disabling. */
  [['sharpenRadius', 10, '1.0'], ['sharpenMask', 35, '35']].forEach(([id, v, label]) => {
    $(id).value = v; $('v_' + id).textContent = label;
  });
  $('vigFall').value = 20; $('v_vigFall').textContent = '2.0';
  $('hotSize').value = 35; $('v_hotSize').textContent = 35;
  curveState = curveDefault(); drawCurveEditor();
  cropRect = null; drawCropOverlay();
  masks = []; maskSel = -1; if ($('mShow')) $('mShow').checked = false; maskRenderList(); maskSyncEditor(); drawMaskOverlay();
  $('vigSpread').value = 55; $('v_vigSpread').textContent = 55;
  vigCentre = [0.5, 0.5]; $('vigCentreNote').textContent = 'Centre: 0.50, 0.50 (default)';
  $('sat').value = 100; $('v_sat').textContent = 100;
  $('wbPreStatus').textContent = 'Pre-WB: Not set';
  $('wbPostStatus').textContent = 'Post-WB: Not set';
  // the markers previously stayed on screen after their gains had been reset
  // to identity, implying a white balance that was no longer applied
  $('pickMarkerPre').style.display = 'none';
  $('pickMarkerPost').style.display = 'none';
  $('chkClip').checked = false;
  if ($('chkCmyk')) $('chkCmyk').checked = false;
  clearLUT();
  const lm = $('lutMix'); if (lm) { lm.value = 100; $('v_lutMix').textContent = 100; }
  exitPick();
  document.querySelectorAll('.pb').forEach(x => x.classList.remove('on'));
  updateClearPresetBtn();
}
$('bReset').onclick = () => {
  // Reset is a state change like any other, so it belongs on the undo stack —
  // a mis-tap here used to wipe a whole session's work irrecoverably.
  armUndoCapture();
  resetAllControls();
  /* These four live here, not in resetAllControls() itself, and that's
     deliberate: both are "check the box, THEN choose the file" controls
     -- their whole point is being set BEFORE a decode reads them, for
     the file about to load, not carried over from the one before it.
     resetAllControls() also runs automatically at the start of every new
     file load (see loadFile) when "Apply previous settings" is off; if
     these were inside it, checking the swap box and then picking a file
     would have the box silently unchecked again before its own decode
     ever ran -- exactly backwards, wiping a choice the user just made
     for the file currently being opened. Reset all is a different,
     explicit action taken on an already-loaded photo, so clearing them
     here is correct; clearing them on every load is not. */
  if ($('cr2PreferPreview')) $('cr2PreferPreview').checked = false;
  if ($('cr2PreferPreviewEditor')) $('cr2PreferPreviewEditor').checked = false;
  if ($('camSpaceSwap')) $('camSpaceSwap').checked = false;
  if ($('camSpaceSwapEditor')) $('camSpaceSwapEditor').checked = false;
  if (typeof rawWbCustom !== 'undefined') rawWbCustom = null;   // build 197: back to the file's own white balance
  /* Setting .checked in JS, unlike an actual click, does not fire a
     'change' event -- so the listener that keeps the displayed image in
     sync with this checkbox (reapplyCamSpaceSwap, wired to 'change')
     never ran. The box above visibly unchecked itself, but the
     already-swapped pixels stayed exactly as they were: Reset all
     LOOKED like it reverted the swap and did not actually do so. Calling
     it directly here is the fix -- same function a real click already
     triggers, just invoked explicitly since this click didn't originate
     on the checkbox itself. */
  if (typeof reapplyCamSpaceSwap === 'function') reapplyCamSpaceSwap();
  /* Reset all clears the pre-swap white balance to identity. For a RAW without camera calibration that identity is the
     raw sensor's own green-heavy balance, so the whole picture went green until something re-ran the automatic balance.
     Rebuilding the preview used to do that as a side effect; since the rebuild now only happens when the swap or the RAW
     noise reduction really changes, it has to be asked for here. */
  restoreImplicitRawWB();
  render();
  commitUndoCapture();
};
function restoreImplicitRawWB() {
  if (!rawEngine.autoWb || !rawEngine.lastResult || rawEngine.lastGen !== loadToken) return;
  if (typeof rawCanvas !== 'undefined' && rawCanvas && rawCanvas.width) autoWhiteBalanceRaw(rawCanvas);
}

$('wbPre').addEventListener('click', () => pickMode === 'pre' ? exitPick() : enterPick('pre'));
$('wbPost').addEventListener('click', () => pickMode === 'post' ? exitPick() : enterPick('post'));
$('wbPreReset').onclick = () => { armUndoCapture(); preWB = [1,1,1]; preWBM = IDENTITY3; $('wbPreStatus').textContent = 'Pre-WB: Not set'; $('pickMarkerPre').style.display = 'none'; commitUndoCapture(); render(); };
$('wbPostReset').onclick = () => { armUndoCapture(); postWB = [1,1,1]; postWBM = IDENTITY3; $('wbPostStatus').textContent = 'Post-WB: Not set'; $('pickMarkerPost').style.display = 'none'; resetAutoGainSliders(); commitUndoCapture(); render(); };
// Shared by the Post-Swap Neutral eyedropper (sampleAt) and Clear Post
// above -- both replace postWBM with something these three sliders can't
// represent (a full Bradford matrix, or identity), so showing them at
// 1.00 is accurate; leaving them at a stale auto-tone number would look
// like it's still active when it no longer is.
function resetAutoGainSliders() {
  ['R','G','B'].forEach(c => {
    const el = $('autoGain' + c); if (!el) return;
    el.value = '1.00';
    const lbl = $('v_autoGain' + c); if (lbl) lbl.textContent = '1.00';
  });
}
['R','G','B'].forEach((c, i) => {
  const el = $('autoGain' + c);
  if (!el) return;
  el.addEventListener('input', () => {
    const lbl = $('v_autoGain' + c); if (lbl) lbl.textContent = (+el.value).toFixed(2);
    const g = ['R','G','B'].map(cc => +($('autoGain' + cc) && $('autoGain' + cc).value) || 1);
    postWBM = [g[0],0,0, 0,g[1],0, 0,0,g[2]];
    $('wbPostStatus').textContent = 'Manual — R:' + g[0].toFixed(2) + ' G:' + g[1].toFixed(2) + ' B:' + g[2].toFixed(2);
    render();
  });
  // Undo arm/commit for these three is handled by the shared HASH_SLIDERS
  // loop further down (pointerdown/focus arm, change/pointerup commit) --
  // this listener only needs to do the actual work, same division as
  // every other slider in that list.
});

function syncHueSpaceButtons() {
  document.querySelectorAll('.hueSpaceBtn').forEach(b => b.classList.toggle('on', b.dataset.space === hueSpace));
  const hint = $('hueSpaceHint');
  if (hint) hint.style.display = hueSpace === 'channel' ? 'inline-flex' : 'none';
}
document.querySelectorAll('.hueSpaceBtn').forEach(b => {
  b.addEventListener('click', () => {
    if (hueSpace === b.dataset.space) return;
    /* No reset here, unlike the WB method toggle: the hue VALUE stays
       meaningful across both spaces — it is the same angle, just measured
       differently — so switching is a live comparison rather than a fresh
       start. */
    armUndoCapture();
    hueSpace = b.dataset.space;
    syncHueSpaceButtons();
    commitUndoCapture();
    render();
    haptic('select');
  });
});

// ---------- undo ----------
// Range sliders are the classic mobile-scroll trap: a swipe that starts on
// or near a slider thumb can get hijacked as a drag instead of a page
// scroll, silently changing a value while you were just trying to scroll
// past it. This snapshots the full adjustable state right before each
// change settles, so one tap on Undo cleanly reverts exactly that.
const UNDO_MAX = 100;
let undoStack = [];
let redoStack = [];
let preChangeSnapshot = null;
/* 'defringe' is dead — the control was removed — but its slot stays. This
   array is positional: applyState reads snap.s[i] by index, so deleting an
   entry from the middle would shift every later slider's value by one when
   restoring any session or link saved before the removal. The lookup is
   guarded (`if (!el) return`), so a name with no element simply skips while
   keeping every later index aligned. */
/* ---------- workflow step navigation & modified indicators ----------

   Two problems this solves, both of which came from the control column being
   a long unbroken scroll:

   1. Nothing showed which stages you had actually changed. With this many
      controls you had to open each step and compare against memory.
   2. There was no way to reach a stage except scrolling past every stage
      before it.

   "Modified" is decided by comparing each control against the value it had at
   load, captured once before anything can touch it. That is deliberately not
   the same as comparing against zero: several controls have meaningful
   non-zero defaults (sharpening radius, masking), and a preset legitimately
   moves things -- what the dot reports is "this differs from where you
   started", which is the question being asked. */
const STEP_DEFS = [
  ['swap',     '01', 'Swap'],
  ['wb',       '03', 'WB'],
  ['light',    '04', 'Light'],
  ['colour',   '05', 'Colour'],
  ['detail',   '06', 'Detail'],
  ['export',   '07', 'Export'],
];
let _stepDefaults = null;

function stepPanelFor(key) {
  if (key === 'export') return document.getElementById('exportSection');
  return document.querySelector('.stepPanel[data-step="' + key + '"]');
}
function stepControls(panel) {
  if (!panel) return [];
  return [...panel.querySelectorAll('input[type=range], input[type=checkbox], input[type=number], select')];
}
function captureStepDefaults() {
  _stepDefaults = new Map();
  STEP_DEFS.forEach(([key]) => {
    stepControls(stepPanelFor(key)).forEach(el => {
      _stepDefaults.set(el, el.type === 'checkbox' ? el.checked : el.value);
    });
  });
}
function stepIsModified(key) {
  if (!_stepDefaults) return false;
  return stepControls(stepPanelFor(key)).some(el => {
    if (!_stepDefaults.has(el)) return false;
    const was = _stepDefaults.get(el);
    return (el.type === 'checkbox' ? el.checked : el.value) !== was;
  });
}
function refreshStepIndicators() {
  if (_stepDefaults) document.querySelectorAll('details.dGrp').forEach(g => {
    g.classList.toggle('mod', stepControls(g).some(el => _stepDefaults.has(el) && (el.type === 'checkbox' ? el.checked : el.value) !== _stepDefaults.get(el)));
  });
  STEP_DEFS.forEach(([key]) => {
    const panel = stepPanelFor(key);
    const mod = stepIsModified(key);
    if (panel) panel.classList.toggle('modified', mod);
    const btn = document.querySelector('#stepStrip button[data-jump="' + key + '"]');
    if (btn) btn.classList.toggle('mod', mod);
  });  if (typeof updateModeNote === 'function') updateModeNote();   // build 171
}
function buildStepStrip() {
  const strip = document.getElementById('stepStrip');
  if (!strip) return;
  strip.innerHTML = '';
  STEP_DEFS.forEach(([key, num, label]) => {
    const panel = stepPanelFor(key);
    if (!panel) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.jump = key;
    b.textContent = num + ' ' + label;
    b.title = 'Jump to ' + label + (key === 'export' ? '' : ' — a dot means you have changed something here');
    b.addEventListener('click', () => {
      // opening it first means the scroll lands on real content, not a
      // collapsed header that then expands underneath the viewport
      panel.open = true;
      if (typeof panel.scrollIntoView === 'function') {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    strip.appendChild(b);
  });
  /* On a phone the controls are one long single column, so opening every
     step at once means a very long scroll before you reach anything. Open the
     first step and collapse the rest; on a wide screen there are two columns
     and room to show them all, and collapsing is there to tidy away what you
     are not using rather than to hide what you can already see.

     Previously this logic lived elsewhere and keyed on the step NUMBERED 02,
     which was Channel Swap until the steps were reordered -- after which a
     phone opened Targeted Colour, the one panel most photos never need, and
     collapsed the headline feature. Keying on the step's name instead of its
     printed number means renumbering cannot silently repoint it again. */
  /* Build 170: not when the tabbed layout (phone dock, or the desktop studio) is on. There each tab shows its own
     sections and the dock opens them; this ran again after every photo load, so opening a photo while on the Light or
     Detail tab closed that tab's only section and left an empty panel until something reopened it. */
  const tabbed = document.documentElement.classList.contains('dockOn') || document.documentElement.classList.contains('studioOn');
  if (!tabbed && window.matchMedia && window.matchMedia('(max-width:1099px)').matches) {
    STEP_DEFS.forEach(([key]) => {
      const p = stepPanelFor(key);
      if (p && p.tagName === 'DETAILS') p.open = (key === 'swap');
    });
  }

  captureStepDefaults();
  refreshStepIndicators();

  /* Scroll-spy: highlights whichever step is currently at the top of the
     column. Uses the scroll container rather than the viewport, since on
     desktop the controls scroll inside #reorderZone and the page itself
     never moves. */
  const zone = document.getElementById('reorderZone');
  if (zone) {
    let queued = false;
    const spy = () => {
      queued = false;
      let cur = null;
      STEP_DEFS.forEach(([key]) => {
        const p = stepPanelFor(key);
        if (!p) return;
        const r = p.getBoundingClientRect(), z = zone.getBoundingClientRect();
        if (r.top - z.top <= 80) cur = key;
      });
      document.querySelectorAll('#stepStrip button').forEach(b =>
        b.classList.toggle('cur', b.dataset.jump === cur));
    };
    zone.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(spy); } }, { passive: true });
    window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(spy); } }, { passive: true });
    spy();
  }
}
/* A <summary> toggles its <details> on any click inside it, including on a
   control that happens to live in the header. White Balance keeps its "Auto
   tone" button there, so pressing it would both run auto-tone AND collapse
   the panel out from under you. Suppressing the toggle for interactive
   descendants is the same exception the previous collapse code made, and it
   is needed for the same reason. */
document.addEventListener('click', e => {
  const sum = e.target.closest && e.target.closest('summary.stepHdr');
  if (!sum) return;
  if (e.target.closest('button, input, select, a, label')) e.preventDefault();
}, true);

/* Any control change anywhere refreshes the dots. Delegated, so controls that
   are created later (colour bands, batch rows) are covered without needing to
   be registered. */
document.addEventListener('input', refreshStepIndicators);
document.addEventListener('change', refreshStepIndicators);

/* sRGB 0-255 to OKLab. Used by the colour-range mask picker, and by the self-test (src/selftest.js), which is built
   into its own file and only loaded for ?selftest, so these must live here in the editor itself. */
const stS2L = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
function stOKLab(r, g, b) { return stOKLabLin(stS2L(r), stS2L(g), stS2L(b)); }
function stOKLabLin(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const HASH_SLIDERS = ['hue', 'sat', 'bright', 'blackPt', 'lutMix', 'temp', 'tint', 'defringe', 'contrast', 'highlights', 'shadows', 'vigAmt', 'vigFall', 'vigSpread', 'shHue', 'shSat', 'hiHue', 'hiSat', 'splitBal', 'triMix', 'triA', 'triB', 'triC', 'triSat', 'satPreserve', 'vibrance', 'filmToneAmt', 'lumaR', 'lumaG', 'lumaB', 'brightness', 'autoGainR', 'autoGainG', 'autoGainB', 'whitePt', 'noiseReduction','clarity','dehaze','sharpen','sharpenRadius','sharpenMask','noiseColour','halation','calRH','calGH','calBH','calRS','calGS','calBS','calST', 'hotR', 'hotG', 'hotB', 'hotSize', 'caR', 'caB', 'swapWiden', 'rawNrL', 'rawNrC', 'rawHl', 'hiRange', 'shRange', 'hslH0', 'hslH1', 'hslH2', 'hslH3', 'hslH4', 'hslH5', 'hslH6', 'hslH7', 'hslS0', 'hslS1', 'hslS2', 'hslS3', 'hslS4', 'hslS5', 'hslS6', 'hslS7', 'hslL0', 'hslL1', 'hslL2', 'hslL3', 'hslL4', 'hslL5', 'hslL6', 'hslL7', 'epdAmt', 'epdEdge', 'epdScale', 'debandAmt', 'skyDeep', 'crimsonFol', 'orton', 'ortonSoft'];

/* ---------- haptics ----------

   Named intents rather than raw millisecond values, so the whole feel of the
   app can be tuned in one place and every call site says WHY it buzzes rather
   than how long for.

   Kept deliberately sparse. Haptics earn their keep by confirming things you
   cannot see happening or would otherwise have to check — a value snapping
   back, a pick landing, an export finishing. Buzzing on every slider frame is
   the fast route to people turning it off at the OS level, which costs you the
   feedback that was actually useful.

   navigator.vibrate is Android and desktop Chrome only. iOS has never
   supported it in Safari, so on an iPhone or iPad these are silent no-ops —
   nothing breaks, there is simply no feedback available to give. */
/* Durations are set by what a phone can physically produce, not by what
   reads nicely as a number. The linear resonant actuator in a modern handset
   needs roughly 20-30ms just to spin up and settle; ask for 8ms and the motor
   never really starts, so the pulse is silent. An earlier version used 8 and
   12ms and felt broken — nothing on a tap, something only on a long press,
   because only the longer patterns were clearing the threshold. Nothing here
   is under 20ms for that reason. */
const HAPTIC = {
  // trimmed after feedback that the previous set was too strong. Still just
  // above the ~20ms an LRA actuator needs to actually spin up (below that
  // the motor never articulates and the pulse is silent), but roughly a
  // third lighter across the board.
  tick:    16,            // a small discrete change landed
  select:  20,            // a preset, a toggle, a button
  confirm: [18, 40, 24],  // something completed: export, batch, restore
  revert:  [16, 35, 16],  // a value was put back — deliberately unlike select
  warn:    [26, 55, 26]   // refused or failed
};
let hapticOn = true;
function haptic(kind) {
  if (!hapticOn || !navigator.vibrate) return;
  const p = (typeof kind === 'number') ? kind : HAPTIC[kind];
  if (p == null) return;
  try { navigator.vibrate(p); } catch (e) {}
}
function toast(msg, sticky) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t);
    // Tap to dismiss early, mainly useful for sticky ones \u2014 no reason to
    // make someone wait out a message they've already read.
    t.addEventListener('click', () => { t.style.opacity = '0'; clearTimeout(t._t); });
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._t);
  /* Sticky, not a longer timeout: a fixed duration is still a guess at how
     long someone needs, and an error worth screenshotting is exactly the
     kind of thing that shouldn't have a clock running against it. Stays up
     until tapped, or until the next toast (sticky or not) replaces it. */
  if (!sticky) t._t = setTimeout(() => { t.style.opacity = '0'; }, 1800);
}
/* ---------- crop ----------
   Non-destructive: cropRect is a rectangle in normalised image space (y down,
   0..1) and the preview keeps showing the whole frame with the outside
   dimmed. Only the export paths cut pixels (applyCropToPixels), so the
   rendering pipeline, pickers, zoom and every reader of the preview canvas
   are untouched by it. null means no crop. */
let cropRect = null, cropAspect = 0;   // aspect: 0 = free, -1 = the image's own, else width / height
function cropCopy(r) { return r ? { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 } : null; }
function cropRatio() {
  if (cropAspect === -1) { const pv = $('preview'); return pv && pv.height ? pv.width / pv.height : 1; }
  return cropAspect;
}
function cropNormalize() {
  if (!cropRect) return;
  if (cropRect.x0 <= 0.001 && cropRect.y0 <= 0.001 && cropRect.x1 >= 0.999 && cropRect.y1 >= 0.999) cropRect = null;
}
function cropFit() {
  const ratio = cropRatio(), pv = $('preview');
  if (!ratio || !pv.width) return;
  const W = pv.width, H = pv.height;
  const r = cropRect || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  let wN = r.x1 - r.x0, hN = r.y1 - r.y0;
  if ((wN * W) / (hN * H) > ratio) wN = hN * H * ratio / W; else hN = wN * W / ratio / H;
  let x0 = cx - wN / 2, y0 = cy - hN / 2;
  x0 = Math.max(0, Math.min(1 - wN, x0)); y0 = Math.max(0, Math.min(1 - hN, y0));
  cropRect = { x0: x0, y0: y0, x1: x0 + wN, y1: y0 + hN };
  cropNormalize();
}
function cropEditing() { return !!($('cropDetails') && $('cropDetails').open) && !pickMode; }
function drawCropOverlay() {
  const cv = $('cropOverlay'), wrap = $('previewWrap'), pv = $('preview');
  if (!cv || !wrap || !pv || !pv.width) return;
  const editing = cropEditing();
  cv.classList.toggle('editing', editing);
  const Wc = wrap.offsetWidth, Hc = wrap.offsetHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bw = Math.max(1, Math.round(Wc * dpr)), bh = Math.max(1, Math.round(Hc * dpr));
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, Wc, Hc);
  if (!cropRect) return;
  const ox = pv.offsetLeft, oy = pv.offsetTop, pw = pv.offsetWidth, ph = pv.offsetHeight;
  const x = ox + cropRect.x0 * pw, y = oy + cropRect.y0 * ph, w = (cropRect.x1 - cropRect.x0) * pw, h = (cropRect.y1 - cropRect.y0) * ph;
  ctx.fillStyle = 'rgba(0,0,0,.58)';
  ctx.beginPath(); ctx.rect(ox, oy, pw, ph); ctx.rect(x, y, w, h); ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(232,217,184,.95)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  if (editing) {
    ctx.strokeStyle = 'rgba(232,217,184,.35)'; ctx.lineWidth = 1;
    for (let q = 1; q < 3; q++) {
      ctx.beginPath(); ctx.moveTo(x + w * q / 3, y); ctx.lineTo(x + w * q / 3, y + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y + h * q / 3); ctx.lineTo(x + w, y + h * q / 3); ctx.stroke();
    }
    ctx.fillStyle = '#e8d9b8';
    const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    if (!cropRatio()) pts.push([x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]);
    pts.forEach(q => ctx.fillRect(q[0] - 5, q[1] - 5, 10, 10));
  }
}
function applyCropToPixels(px, w, h) {
  if (!cropRect) return { px: px, w: w, h: h };
  const x0 = Math.max(0, Math.min(w - 1, Math.round(cropRect.x0 * w)));
  const y0 = Math.max(0, Math.min(h - 1, Math.round(cropRect.y0 * h)));
  const x1 = Math.max(x0 + 1, Math.min(w, Math.round(cropRect.x1 * w)));
  const y1 = Math.max(y0 + 1, Math.min(h, Math.round(cropRect.y1 * h)));
  const cw = x1 - x0, ch = y1 - y0;
  if (cw === w && ch === h) return { px: px, w: w, h: h };
  const out = new px.constructor(cw * ch * 4);
  for (let y = 0; y < ch; y++) { const src = ((y0 + y) * w + x0) * 4; out.set(px.subarray(src, src + cw * 4), y * cw * 4); }
  return { px: out, w: cw, h: ch };
}
(function wireCrop() {
  const cv = $('cropOverlay'); if (!cv) return;
  let drag = null;
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const uv = e => { const r = $('preview').getBoundingClientRect(); return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height, r: r }; };
  function hitTest(u, v, r) {
    if (!cropRect) return null;
    const c = cropRect, px = (a) => a * r.width, py = (a) => a * r.height;
    const nearX = (x) => Math.abs(px(u - x)) <= 24, nearY = (y) => Math.abs(py(v - y)) <= 24;
    const l = nearX(c.x0), rt = nearX(c.x1), t = nearY(c.y0), b = nearY(c.y1);
    if (t && l) return 'tl'; if (t && rt) return 'tr'; if (b && l) return 'bl'; if (b && rt) return 'br';
    if (!cropRatio()) {
      const inX = u > c.x0 && u < c.x1, inY = v > c.y0 && v < c.y1;
      if (l && inY) return 'l'; if (rt && inY) return 'r'; if (t && inX) return 't'; if (b && inX) return 'b';
    }
    if (u > c.x0 && u < c.x1 && v > c.y0 && v < c.y1) return 'move';
    return null;
  }
  function setFromCorner(ax, ay, u, v, W, H) {
    // anchor corner (ax, ay) fixed; the dragged corner follows the pointer, shape locked if a ratio is set
    const ratio = cropRatio();
    u = clamp01(u); v = clamp01(v);
    let wN = Math.abs(u - ax), hN = Math.abs(v - ay);
    const sx = u >= ax ? 1 : -1, sy = v >= ay ? 1 : -1;
    if (ratio) {
      const hFromW = wN * W / ratio / H;
      if (hFromW <= hN) hN = hFromW; else wN = hN * H * ratio / W;
      const maxW = sx > 0 ? 1 - ax : ax, maxH = sy > 0 ? 1 - ay : ay;
      const k = Math.min(1, maxW / Math.max(wN, 1e-9), maxH / Math.max(hN, 1e-9));
      wN *= k; hN *= k;
    }
    const nx = ax + sx * wN, ny = ay + sy * hN;
    return { x0: Math.min(ax, nx), y0: Math.min(ay, ny), x1: Math.max(ax, nx), y1: Math.max(ay, ny) };
  }
  cv.addEventListener('pointerdown', e => {
    if (!cropEditing()) return;
    e.preventDefault();
    const { u, v, r } = uv(e), pv = $('preview');
    armUndoCapture();
    let mode = hitTest(u, v, r);
    if (!mode) { mode = 'new'; }
    drag = { mode: mode, su: u, sv: v, start: cropCopy(cropRect), W: pv.width, H: pv.height };
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const { u, v } = uv(e), s = drag.start, W = drag.W, H = drag.H;
    const m = drag.mode;
    if (m === 'new') {
      if (Math.abs(u - drag.su) * W + Math.abs(v - drag.sv) * H < 8) return;
      cropRect = setFromCorner(clamp01(drag.su), clamp01(drag.sv), u, v, W, H);
    } else if (m === 'move') {
      let dx = u - drag.su, dy = v - drag.sv;
      dx = Math.max(-s.x0, Math.min(1 - s.x1, dx)); dy = Math.max(-s.y0, Math.min(1 - s.y1, dy));
      cropRect = { x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy };
    } else if (m.length === 2) {
      const ax = m[1] === 'l' ? s.x1 : s.x0, ay = m[0] === 't' ? s.y1 : s.y0;
      cropRect = setFromCorner(ax, ay, u, v, W, H);
    } else {
      const c = cropCopy(s), minS = 0.04;
      if (m === 'l') c.x0 = Math.min(s.x1 - minS, clamp01(u));
      if (m === 'r') c.x1 = Math.max(s.x0 + minS, clamp01(u));
      if (m === 't') c.y0 = Math.min(s.y1 - minS, clamp01(v));
      if (m === 'b') c.y1 = Math.max(s.y0 + minS, clamp01(v));
      cropRect = c;
    }
    drawCropOverlay();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    if (cropRect && (cropRect.x1 - cropRect.x0 < 0.03 || cropRect.y1 - cropRect.y0 < 0.03)) cropRect = null;
    cropNormalize();
    commitUndoCapture(); drawCropOverlay(); saveSessionState();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  document.querySelectorAll('#cropRow button[data-asp]').forEach(b => b.addEventListener('click', () => {
    armUndoCapture();
    cropAspect = +b.getAttribute('data-asp');
    document.querySelectorAll('#cropRow button[data-asp]').forEach(o => o.classList.toggle('on', o === b));
    if (cropAspect !== 0) cropFit();
    commitUndoCapture(); drawCropOverlay(); saveSessionState();
  }));
  $('btnCropReset').addEventListener('click', () => {
    armUndoCapture(); cropRect = null; commitUndoCapture(); drawCropOverlay(); saveSessionState();
  });
  $('cropDetails').addEventListener('toggle', drawCropOverlay);
  window.addEventListener('resize', drawCropOverlay);
  if (window.ResizeObserver) new ResizeObserver(drawCropOverlay).observe($('preview'));
})();

/* ---------- local adjustments ----------
   Up to four masks, each a linear gradient, a radial ellipse or a luminosity
   range, each carrying its own exposure / contrast / saturation /
   temperature / tint. All geometry is stored normalised to the image
   (0..1, y down) so it survives resizing, export at original resolution and
   batch. The shader applies them last, in linear light (see
   applyLocalAdjust); this side keeps the list, builds the uniforms and draws
   the handles. */
const MASK_MAX = 4, MASK_TYPES = ['linear', 'radial', 'lum', 'color', 'ir'];
let masks = [], maskSel = -1;
function maskNew(type) {
  const base = { type: type, inv: false, feather: 50, exp: 0, con: 0, sat: 0, temp: 0, tint: 0 };
  const pv = $('preview'), asp = pv && pv.height ? pv.width / pv.height : 1;
  if (type === 'linear') return Object.assign(base, { x0: 0.5, y0: 0.15, x1: 0.5, y1: 0.65 });
  if (type === 'radial') return Object.assign(base, { cx: 0.5, cy: 0.5, rx: 0.25, ry: Math.min(0.5, 0.25 * asp) });
  if (type === 'color') return Object.assign(base, { L0: 0.6, a0: 0.1, b0: 0.05, range: 30, sw: '#b05a50' });
  // foliage by vegetation index (build 153): index from/to on a -100..100 scale (= -1..1), NDVI by default
  if (type === 'ir') return Object.assign(base, { nlo: 20, nhi: 100, ngb: false, feather: 40 });
  return Object.assign(base, { lo: 0, hi: 0.35 });
}
function maskViewIndex() {
  const sh = $('mShow');
  return (sh && sh.checked && maskSel >= 0 && maskSel < masks.length) ? maskSel : -1;
}
function maskUniformData() {
  const n = Math.min(MASK_MAX, masks.length);
  const geom = new Float32Array(16), info = new Float32Array(16), adj = new Float32Array(16), adj2 = new Float32Array(16);
  for (let i = 0; i < MASK_MAX; i++) {
    adj[i * 4 + 1] = 1; adj[i * 4 + 2] = 1;
    if (i >= n) continue;
    const m = masks[i];
    if (m.type === 'linear') { geom[i * 4] = m.x0; geom[i * 4 + 1] = m.y0; geom[i * 4 + 2] = m.x1; geom[i * 4 + 3] = m.y1; }
    else if (m.type === 'radial') { geom[i * 4] = m.cx; geom[i * 4 + 1] = m.cy; geom[i * 4 + 2] = m.rx; geom[i * 4 + 3] = m.ry; }
    else if (m.type === 'color') { geom[i * 4] = m.L0; geom[i * 4 + 1] = m.a0; geom[i * 4 + 2] = m.b0; geom[i * 4 + 3] = 0.01 + (m.range / 100) * 0.25; }
    else if (m.type === 'ir') { geom[i * 4] = m.nlo / 100; geom[i * 4 + 1] = m.nhi / 100; geom[i * 4 + 2] = m.ngb ? 1 : 0; }
    else { geom[i * 4] = m.lo; geom[i * 4 + 1] = m.hi; }
    info[i * 4] = MASK_TYPES.indexOf(m.type); info[i * 4 + 1] = m.feather / 100; info[i * 4 + 2] = m.inv ? 1 : 0;
    adj[i * 4] = m.exp; adj[i * 4 + 1] = contrastStrength(m.con); adj[i * 4 + 2] = Math.max(0, 1 + m.sat / 100); adj[i * 4 + 3] = m.temp / 100 * 2;
    adj2[i * 4] = m.tint / 100 * 2;
  }
  return { n: n, geom: geom, info: info, adj: adj, adj2: adj2 };
}
function maskLabel(type) { const d = I18N[uiLang] || I18N.en; return d[type === 'linear' ? 'maskLinear' : type === 'radial' ? 'maskRadial' : type === 'color' ? 'maskColour' : type === 'ir' ? 'maskIr' : 'maskLum'] || type; }
function maskRenderList() {
  const box = $('maskChips'); if (!box) return;
  box.innerHTML = '';
  masks.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btnGhostSmall maskChip' + (i === maskSel ? ' on' : '');
    b.textContent = (i + 1) + ' ' + maskLabel(m.type);
    b.addEventListener('click', () => { maskSel = i; maskRenderList(); maskSyncEditor(); drawMaskOverlay(); if (maskViewIndex() >= 0) render(); });
    box.appendChild(b);
  });
  ['btnMaskLinear', 'btnMaskRadial', 'btnMaskLum', 'btnMaskColour', 'btnMaskIr'].forEach(id => { const e = $(id); if (e) e.disabled = masks.length >= MASK_MAX; });
}
const MASK_SLIDERS = { mExp: 'exp', mCon: 'con', mSat: 'sat', mTemp: 'temp', mTint: 'tint', mFeather: 'feather', mLo: 'lo', mHi: 'hi', mRange: 'range', mNlo: 'nlo', mNhi: 'nhi' };
function maskSyncEditor() {
  const ed = $('maskEditor'); if (!ed) return;
  const m = masks[maskSel];
  ed.style.display = m ? 'block' : 'none';
  if (!m) return;
  $('maskLumRow').style.display = m.type === 'lum' ? 'block' : 'none';
  $('maskColorRow').style.display = m.type === 'color' ? 'block' : 'none';
  if ($('maskIrRow')) { $('maskIrRow').style.display = m.type === 'ir' ? 'block' : 'none'; $('mNgb').checked = !!m.ngb; }
  $('mSwatch').style.background = m.sw || '#888';
  $('mInvert').checked = !!m.inv;
  Object.keys(MASK_SLIDERS).forEach(id => {
    const k = MASK_SLIDERS[id], el = $(id); if (!el) return;
    el.value = (k === 'lo' || k === 'hi') ? Math.round((m[k] || 0) * 100) : (m[k] == null ? el.defaultValue : m[k]);
    const lbl = $('v_' + id); if (lbl) lbl.textContent = el.value;
    syncSliderFill(el);
  });
}
function maskEditing() {
  const m = masks[maskSel];
  return !!($('maskDetails') && $('maskDetails').open) && !pickMode && !!m && (m.type === 'linear' || m.type === 'radial');
}
function drawMaskOverlay() {
  const cv = $('maskOverlay'), wrap = $('previewWrap'), pv = $('preview');
  if (!cv || !wrap || !pv || !pv.width) return;
  const editing = maskEditing();
  cv.classList.toggle('editing', editing);
  const Wc = wrap.offsetWidth, Hc = wrap.offsetHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  const bw = Math.max(1, Math.round(Wc * dpr)), bh = Math.max(1, Math.round(Hc * dpr));
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, Wc, Hc);
  if (!editing) return;
  const m = masks[maskSel], ox = pv.offsetLeft, oy = pv.offsetTop, pw = pv.offsetWidth, ph = pv.offsetHeight;
  const X = u => ox + u * pw, Y = v => oy + v * ph;
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(232,217,184,.95)'; ctx.fillStyle = '#e8d9b8';
  const sq = (x, y) => { ctx.fillRect(x - 5, y - 5, 10, 10); };
  if (m.type === 'linear') {
    const ax = X(m.x0), ay = Y(m.y0), bx = X(m.x1), by = Y(m.y1);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, L = Math.max(pw, ph);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([6, 5]);
    [[ax, ay], [bx, by]].forEach(q => { ctx.beginPath(); ctx.moveTo(q[0] - nx * L, q[1] - ny * L); ctx.lineTo(q[0] + nx * L, q[1] + ny * L); ctx.stroke(); });
    ctx.setLineDash([]);
    sq(ax, ay); sq(bx, by);
  } else if (m.type === 'radial') {
    const cx = X(m.cx), cy = Y(m.cy), rx = m.rx * pw, ry = m.ry * ph;
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, 6.2832); ctx.stroke();
    sq(cx, cy); sq(cx + rx, cy); sq(cx - rx, cy); sq(cx, cy + ry); sq(cx, cy - ry);
  }
}
(function wireMasks() {
  if (!$('maskDetails')) return;
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const uvOf = e => { const r = $('preview').getBoundingClientRect(); return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height, r: r }; };
  function addMask(type) {
    if (masks.length >= MASK_MAX) { toast('Up to ' + MASK_MAX + ' masks'); return; }
    armUndoCapture();
    masks.push(maskNew(type)); maskSel = masks.length - 1;
    maskRenderList(); maskSyncEditor(); drawMaskOverlay();
    commitUndoCapture(); render(); saveSessionState();
  }
  $('btnMaskLinear').addEventListener('click', () => addMask('linear'));
  $('btnMaskRadial').addEventListener('click', () => addMask('radial'));
  $('btnMaskLum').addEventListener('click', () => addMask('lum'));
  if ($('btnMaskIr')) $('btnMaskIr').addEventListener('click', () => addMask('ir'));
  if ($('mNgb')) $('mNgb').addEventListener('change', () => {
    const m = masks[maskSel]; if (!m || m.type !== 'ir') return;
    armUndoCapture(); m.ngb = $('mNgb').checked; commitUndoCapture(); render(); saveSessionState();
  });
  $('btnMaskColour').addEventListener('click', () => {
    addMask('color');
    if (masks.length && masks[maskSel] && masks[maskSel].type === 'color') { enterPick('maskColor'); toast('Tap a colour in the photo'); }
  });
  $('btnMaskPick').addEventListener('click', () => pickMode === 'maskColor' ? exitPick() : enterPick('maskColor'));
  $('btnMaskDelete').addEventListener('click', () => {
    if (!masks[maskSel]) return;
    armUndoCapture();
    masks.splice(maskSel, 1); maskSel = Math.min(maskSel, masks.length - 1);
    maskRenderList(); maskSyncEditor(); drawMaskOverlay();
    commitUndoCapture(); render(); saveSessionState();
  });
  $('mInvert').addEventListener('change', () => {
    const m = masks[maskSel]; if (!m) return;
    armUndoCapture(); m.inv = $('mInvert').checked; commitUndoCapture(); render(); saveSessionState();
  });
  $('mShow').addEventListener('change', () => { render(); scheduleHistogram(); drawMaskOverlay(); });
  Object.keys(MASK_SLIDERS).forEach(id => {
    const el = $(id); if (!el) return;
    el.addEventListener('pointerdown', armUndoCapture);
    el.addEventListener('focus', armUndoCapture);
    el.addEventListener('change', commitUndoCapture);
    el.addEventListener('pointerup', () => setTimeout(commitUndoCapture, 0));
    el.addEventListener('pointercancel', () => { preChangeSnapshot = null; });
    el.addEventListener('input', () => {
      const m = masks[maskSel]; if (!m) return;
      const k = MASK_SLIDERS[id];
      let v = +el.value;
      if (k === 'lo') { v = Math.min(v, Math.round(m.hi * 100)); el.value = v; m.lo = v / 100; }
      else if (k === 'hi') { v = Math.max(v, Math.round(m.lo * 100)); el.value = v; m.hi = v / 100; }
      else if (k === 'nlo') { v = Math.min(v, m.nhi); el.value = v; m.nlo = v; }
      else if (k === 'nhi') { v = Math.max(v, m.nlo); el.value = v; m.nhi = v; }
      else m[k] = v;
      const lbl = $('v_' + id); if (lbl) lbl.textContent = el.value;
      syncSliderFill(el); render(true); saveSessionState();
    });
  });

  // ---- drawing and handles on the preview ----
  const ov = $('maskOverlay');
  let drag = null;
  const dist = (r, u1, v1, u2, v2) => Math.hypot((u1 - u2) * r.width, (v1 - v2) * r.height);
  function segDist(r, u, v, a, b) {
    const px = u * r.width, py = v * r.height, ax = a[0] * r.width, ay = a[1] * r.height, bx = b[0] * r.width, by = b[1] * r.height;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function hit(m, u, v, r) {
    const T = 26;
    if (m.type === 'linear') {
      if (dist(r, u, v, m.x0, m.y0) < T) return 'a';
      if (dist(r, u, v, m.x1, m.y1) < T) return 'b';
      if (segDist(r, u, v, [m.x0, m.y0], [m.x1, m.y1]) < 20) return 'move';
      return null;
    }
    if (dist(r, u, v, m.cx, m.cy) < T) return 'move';
    if (dist(r, u, v, m.cx + m.rx, m.cy) < T || dist(r, u, v, m.cx - m.rx, m.cy) < T) return 'rx';
    if (dist(r, u, v, m.cx, m.cy + m.ry) < T || dist(r, u, v, m.cx, m.cy - m.ry) < T) return 'ry';
    const d = Math.hypot((u - m.cx) / Math.max(m.rx, 0.01), (v - m.cy) / Math.max(m.ry, 0.01));
    return d < 1 ? 'move' : null;
  }
  ov.addEventListener('pointerdown', e => {
    if (!maskEditing()) return;
    e.preventDefault();
    const m = masks[maskSel], { u, v, r } = uvOf(e);
    armUndoCapture();
    let mode = hit(m, u, v, r);
    if (!mode) {
      mode = 'new';
      if (m.type === 'linear') { m.x0 = clamp01(u); m.y0 = clamp01(v); m.x1 = m.x0; m.y1 = m.y0; }
      else { m.cx = clamp01(u); m.cy = clamp01(v); m.rx = 0.02; m.ry = 0.02; }
    }
    drag = { mode: mode, su: u, sv: v, start: JSON.parse(JSON.stringify(m)) };
    try { ov.setPointerCapture(e.pointerId); } catch (err) {}
    sliderDragging = true; draggedSliderId = 'mask';
    render(true); drawMaskOverlay();
  });
  ov.addEventListener('pointermove', e => {
    if (!drag) return;
    const m = masks[maskSel], s = drag.start, { u, v } = uvOf(e), md = drag.mode;
    if (m.type === 'linear') {
      if (md === 'a') { m.x0 = clamp01(u); m.y0 = clamp01(v); }
      else if (md === 'b' || md === 'new') { m.x1 = clamp01(u); m.y1 = clamp01(v); }
      else if (md === 'move') {
        const dx = Math.max(-Math.min(s.x0, s.x1), Math.min(1 - Math.max(s.x0, s.x1), u - drag.su));
        const dy = Math.max(-Math.min(s.y0, s.y1), Math.min(1 - Math.max(s.y0, s.y1), v - drag.sv));
        m.x0 = s.x0 + dx; m.x1 = s.x1 + dx; m.y0 = s.y0 + dy; m.y1 = s.y1 + dy;
      }
    } else {
      if (md === 'move') { m.cx = clamp01(s.cx + (u - drag.su)); m.cy = clamp01(s.cy + (v - drag.sv)); }
      else if (md === 'rx') m.rx = Math.max(0.02, Math.min(1, Math.abs(u - s.cx)));
      else if (md === 'ry') m.ry = Math.max(0.02, Math.min(1, Math.abs(v - s.cy)));
      else if (md === 'new') { m.rx = Math.max(0.02, Math.min(1, Math.abs(u - s.cx))); m.ry = Math.max(0.02, Math.min(1, Math.abs(v - s.cy))); }
    }
    render(true); drawMaskOverlay();
  });
  const end = () => {
    if (!drag) return;
    const m = masks[maskSel];
    // a tap that never drew anything leaves the mask as it was
    if (drag.mode === 'new' && m) {
      if (m.type === 'linear' && Math.hypot(m.x1 - m.x0, m.y1 - m.y0) < 0.02) Object.assign(m, { x0: drag.start.x0, y0: drag.start.y0, x1: drag.start.x1, y1: drag.start.y1 });
      if (m.type === 'radial' && (m.rx <= 0.021 && m.ry <= 0.021)) Object.assign(m, { cx: drag.start.cx, cy: drag.start.cy, rx: drag.start.rx, ry: drag.start.ry });
    }
    drag = null;
    sliderDragging = false; settleFullRes(); draggedSliderId = '';
    commitUndoCapture(); drawMaskOverlay(); saveSessionState();
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', end);

  // the two overlays share the preview, so only one panel edits at a time
  $('maskDetails').addEventListener('toggle', () => { if ($('maskDetails').open && $('cropDetails') && $('cropDetails').open) $('cropDetails').open = false; drawMaskOverlay(); });
  if ($('cropDetails')) $('cropDetails').addEventListener('toggle', () => { if ($('cropDetails').open && $('maskDetails').open) $('maskDetails').open = false; drawMaskOverlay(); });
  window.addEventListener('resize', drawMaskOverlay);
  if (window.ResizeObserver) new ResizeObserver(drawMaskOverlay).observe($('preview'));
  const langSel = $('uiLang'); if (langSel) langSel.addEventListener('change', maskRenderList);
  maskRenderList();
})();

/* Colour of the picture at a tap, as the pipeline produces it, averaged over a
   7 x 7 patch so one noisy pixel does not decide. `opts` switches stages off
   for this one render (for example the stage being edited) and the normal
   frame is drawn again afterwards. */
function samplePipelineAt(clientX, clientY, opts) {
  const cv = engine.canvas, rect = $('preview').getBoundingClientRect();
  const x = Math.round((clientX - rect.left) / rect.width * cv.width), y = Math.round((clientY - rect.top) / rect.height * cv.height);
  engine.render(Object.assign(currentParams(), { dither: false, clipView: false, gamutDrag: false, maskView: -1, bandPreview: null }, opts || {}));
  const px = engine.readPixels(), W = cv.width, H = cv.height, R = 3;
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
    const xx = Math.max(0, Math.min(W - 1, x + i)), yy = Math.max(0, Math.min(H - 1, y + j)), k = (yy * W + xx) * 4;
    r += px[k]; g += px[k + 1]; b += px[k + 2]; n++;
  }
  render();
  return [r / n, g / n, b / n];
}
function maskColorDoPick(clientX, clientY) {
  const m = masks[maskSel];
  if (!m || m.type !== 'color') { exitPick(); return; }
  armUndoCapture();
  const c = samplePipelineAt(clientX, clientY, { masks: { n: 0 } }), lab = stOKLab(c[0], c[1], c[2]);
  m.L0 = lab[0]; m.a0 = lab[1]; m.b0 = lab[2]; m.sw = rgbToHex(c[0], c[1], c[2]);
  maskSyncEditor(); commitUndoCapture(); render(); haptic('tick'); exitPick(); saveSessionState();
}
/* Value bubble: while a slider is being dragged, its number floats above the
   thumb, since a finger covers the label. Shown only once the value actually
   moves, so a scroll that starts on a slider does not flash it. */
(function wireValueBubble() {
  const b = document.createElement('div'); b.id = 'valBubble'; b.style.display = 'none'; document.body.appendChild(b);
  let cur = null;
  document.addEventListener('pointerdown', e => { cur = (e.target && e.target.matches && e.target.matches('.sl input[type=range]')) ? e.target : null; }, true);
  const hide = () => { cur = null; b.style.display = 'none'; };
  window.addEventListener('pointerup', hide, true);
  window.addEventListener('pointercancel', hide, true);
  document.addEventListener('input', e => {
    if (!cur || e.target !== cur) return;
    requestAnimationFrame(() => {
      if (!cur) return;
      const r = cur.getBoundingClientRect(), min = +cur.min || 0, max = +cur.max || 100;
      const f = (+cur.value - min) / Math.max(1e-9, max - min), lab = document.getElementById('v_' + cur.id);
      b.textContent = lab ? lab.textContent : cur.value;
      b.style.left = (r.left + 9 + f * Math.max(0, r.width - 18)) + 'px';
      b.style.top = Math.max(40, r.top - 22) + 'px';
      b.style.display = 'block';
    });
  }, true);
})();

/* ---------- tone curve ----------
   State is four point lists (RGB, R, G, B) of [x, y] pairs in 0..1, endpoints
   pinned at x = 0 and x = 1. Each is turned into a smooth monotone curve
   (Fritsch-Carlson cubic Hermite, so dragging a point can never make the
   curve overshoot or fold back on itself), the RGB curve is composed in
   front of the three channel curves, and the result is baked into one
   1024-entry table per channel for the shader. */
const CURVE_N = 1024;
const CURVE_CH = ['master', 'r', 'g', 'b'];
function curveDefault() { const id = () => [[0, 0], [1, 1]]; return { master: id(), r: id(), g: id(), b: id() }; }
let curveState = curveDefault(), curveChan = 'master';
function curveCopy(c) { return JSON.parse(JSON.stringify(c)); }
function curvePtsIdentity(pts) { for (const q of pts) if (Math.abs(q[0] - q[1]) > 1e-6) return false; return true; }
function curveAllIdentity() { return CURVE_CH.every(k => curvePtsIdentity(curveState[k]) && !curveParamActive(k)); }
/* ---------- Region sliders (build 168) ----------
   Highlights, Lights, Darks and Shadows bend the curve for you, per channel, the way Lightroom's parametric curve does.
   Each slider moves one control point (at 12.5%, 37.5%, 62.5% and 87.5% of the range) by up to 0.11 either way, and the
   curve through them is the same monotone spline the point editor uses. The points sit 0.25 apart and move at most 0.22
   relative to each other, so the curve can only ever rise: it cannot fold back on itself whatever the sliders say.
   Stored as curveState.param[channel] = {h, l, d, s} (-1..1), applied BEFORE that channel's point curve, so both can be
   used together. Absent means untouched, so every curve saved before this renders exactly as it did. */
const CURVE_REGIONS = ['h', 'l', 'd', 's'];
const CURVE_REG_AMP = 0.11;
function curveParam(ch) { return (curveState.param && curveState.param[ch]) || null; }
function curveParamActive(ch) { const p = curveParam(ch); return !!p && CURVE_REGIONS.some(k => Math.abs(p[k] || 0) > 1e-6); }
function makeParamFn(ch) {
  if (!curveParamActive(ch)) return null;
  const p = curveParam(ch), a = CURVE_REG_AMP;
  return makeCurveFn([[0, 0], [0.125, 0.125 + (p.s || 0) * a], [0.375, 0.375 + (p.d || 0) * a], [0.625, 0.625 + (p.l || 0) * a], [0.875, 0.875 + (p.h || 0) * a], [1, 1]]);
}
function makeChanFn(ch) { const f = makeCurveFn(curveState[ch]), pf = makeParamFn(ch); return pf ? (x => f(pf(x))) : f; }
function makeCurveFn(pts) {
  const n = pts.length, xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  if (n < 2) return x => x;
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], sq = a * a + b * b;
    if (sq > 9) { const t = 3 / Math.sqrt(sq); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return function (x) {
    if (x <= xs[0]) return Math.max(0, Math.min(1, ys[0]));
    if (x >= xs[n - 1]) return Math.max(0, Math.min(1, ys[n - 1]));
    let k = 0; while (k < n - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
    return Math.max(0, Math.min(1, y));
  };
}
let _curveCache = { key: '', lut: null };
function getCurveLut() {
  const key = JSON.stringify(curveState);
  if (_curveCache.key === key) return _curveCache;
  const fm = makeChanFn('master'), fr = makeChanFn('r'), fg = makeChanFn('g'), fb = makeChanFn('b');   // build 168: region sliders included
  const lut = new Float32Array(CURVE_N * 4);
  const lumMode = !!curveState.lum;
  for (let i = 0; i < CURVE_N; i++) {
    const x = i / (CURVE_N - 1);
    if (lumMode) {   // RGB = channel curves alone; alpha = the RGB curve, applied to luminance in the shader
      lut[i * 4] = fr(x); lut[i * 4 + 1] = fg(x); lut[i * 4 + 2] = fb(x); lut[i * 4 + 3] = fm(x);
    } else {
      const mx = fm(x);
      lut[i * 4] = fr(mx); lut[i * 4 + 1] = fg(mx); lut[i * 4 + 2] = fb(mx); lut[i * 4 + 3] = 1;
    }
  }
  _curveCache = { key: key, lut: lut };
  return _curveCache;
}
const CURVE_PAD = 12;
/* Build 169: a small histogram of the preview for the Points curve, refreshed a moment after each render while the
   Points tab is open. Read with drawImage from the preview canvas, so it costs nothing on devices without a preserved
   drawing buffer (where it is simply not drawn). */
let curveHist = null, curveHistTimer = null, curveHistCv = null;
function scheduleCurveHist() {
  if (curveHistTimer) clearTimeout(curveHistTimer);
  curveHistTimer = setTimeout(() => {
    curveHistTimer = null;
    const det = $('curveDetails'), pts = $('curvePoints'), pv = $('preview');
    if (!det || !det.open || !pts || pts.hidden || !loadedImage || !pv || !pv.width || !engine || !engine.hasPreserveBuffer) return;
    try {
      if (!curveHistCv) curveHistCv = document.createElement('canvas');
      const w = 128, h = Math.max(1, Math.round(128 * pv.height / pv.width));
      curveHistCv.width = w; curveHistCv.height = h;
      const cx = curveHistCv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(pv, 0, 0, w, h);
      const d = cx.getImageData(0, 0, w, h).data, N = 64;
      const hs = { l: new Float32Array(N), r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N) };
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        hs.r[r >> 2]++; hs.g[g >> 2]++; hs.b[b >> 2]++;
        hs.l[Math.min(63, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) >> 2)]++;
      }
      curveHist = hs; drawCurveEditor();
    } catch (e) { curveHist = null; }
  }, 160);
}
const CURVE_COL = { master: '#d8c8ad', r: '#e0664a', g: '#6fc08a', b: '#6aa0e0' };
function drawCurveEditor() {
  try { syncCurveRegions(); } catch (e) {}   // build 168: undo, reset and loaded looks redraw through here
  const cv = $('curveCv'); if (!cv) return;
  let W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;   // collapsed
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, W, H);
  /* Build 167: the graph sits CURVE_PAD px inside the canvas, so a point at black, white or the top and bottom edges
     is drawn whole instead of being cut in half by the border. */
  const P = CURVE_PAD;
  ctx.save(); ctx.translate(P, P); W -= 2 * P; H -= 2 * P;
  /* Build 169: the photo's histogram behind the curve (luminance for RGB, the channel itself for R, G or B), so you can
     see which tones a point will move. Square-root scaled so thin shadows and highlights still show. */
  if (curveHist) {
    const hb = curveHist[curveChan === 'master' ? 'l' : curveChan], n = hb.length;
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, hb[i]);
    if (mx > 0) {
      ctx.fillStyle = curveChan === 'master' ? 'rgba(163,160,151,.28)' : CURVE_COL[curveChan] + '40';
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let i = 0; i < n; i++) ctx.lineTo((i + 0.5) / n * W, H - Math.sqrt(hb[i] / mx) * H * 0.9);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(84,64,42,.55)'; ctx.lineWidth = 1;
  ctx.strokeRect(.5, .5, W - 1, H - 1);
  for (let q = 1; q < 4; q++) {
    const gx = Math.round(W * q / 4) + .5, gy = Math.round(H * q / 4) + .5;
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(168,147,114,.35)'; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke(); ctx.setLineDash([]);
  const order = ['r', 'g', 'b', 'master'].filter(k => k !== curveChan).concat([curveChan]);
  order.forEach(k => {
    const pts = curveState[k];
    if (k !== curveChan && curvePtsIdentity(pts) && !curveParamActive(k)) return;
    const fn = makeCurveFn(pts);
    if (k === curveChan && curveParamActive(k)) {   // build 168: the full result, region sliders included, dashed behind the point curve
      const full = makeChanFn(k);
      ctx.globalAlpha = 0.6; ctx.strokeStyle = CURVE_COL[k]; ctx.lineWidth = 1.25; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let px = 0; px <= W; px += 2) { const y = H - full(px / W) * H; if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = k === curveChan ? 1 : 0.35;
    ctx.strokeStyle = CURVE_COL[k]; ctx.lineWidth = k === curveChan ? 2 : 1.25;
    ctx.beginPath();
    for (let px = 0; px <= W; px += 2) { const y = H - fn(px / W) * H; if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y); }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = CURVE_COL[curveChan]; ctx.strokeStyle = '#0b0c0e'; ctx.lineWidth = 1.5;
  curveState[curveChan].forEach((q, i) => {
    ctx.beginPath(); ctx.arc(q[0] * W, H - q[1] * H, i === curveSel ? 7 : 5, 0, 6.2832); ctx.fill(); ctx.stroke();
    if (i === curveSel) { ctx.beginPath(); ctx.arc(q[0] * W, H - q[1] * H, 11, 0, 6.2832); ctx.strokeStyle = CURVE_COL[curveChan]; ctx.lineWidth = 1.5; ctx.stroke(); ctx.strokeStyle = '#0b0c0e'; }
  });
  ctx.restore();
  const lc = $('curveLum'); if (lc) lc.checked = !!curveState.lum;
  syncCurvePointRow();
}
/* The point being edited, for the exact-value fields under the curve. -1 means none. */
let curveSel = -1;
function syncCurvePointRow() {
  const fin = $('curveIn'), fout = $('curveOut'); if (!fin || !fout) return;
  const pts = curveState[curveChan];
  if (curveSel < 0 || curveSel >= pts.length) { curveSel = -1; fin.disabled = fout.disabled = true; fin.value = fout.value = ''; const del = $('btnCurveDel'); if (del) del.disabled = true; return; }
  const q = pts[curveSel], end = curveSel === 0 || curveSel === pts.length - 1;
  fin.disabled = end; fout.disabled = false;   // the two end points stay at the left and right edges
  const del = $('btnCurveDel'); if (del) del.disabled = end;   // build 169: the end points cannot be deleted
  if (document.activeElement !== fin) fin.value = Math.round(q[0] * 255);
  if (document.activeElement !== fout) fout.value = Math.round(q[1] * 255);
}
const CURVE_PRESETS = {
  linear: [[0, 0], [1, 1]],
  medium: [[0, 0], [64 / 255, 56 / 255], [128 / 255, 128 / 255], [192 / 255, 199 / 255], [1, 1]],
  strong: [[0, 0], [64 / 255, 46 / 255], [128 / 255, 128 / 255], [192 / 255, 210 / 255], [1, 1]],
};
function curveChanged() { drawCurveEditor(); if (typeof syncCurveRegions === 'function') syncCurveRegions(); render(true); }
(function wireCurveEditor() {
  const cv = $('curveCv'); if (!cv) return;
  const clamp01 = v => Math.max(0, Math.min(1, v));
  // the graph's own box, inside the padding (see drawCurveEditor)
  const box = () => { const r = cv.getBoundingClientRect(); return { left: r.left + CURVE_PAD, top: r.top + CURVE_PAD, width: r.width - 2 * CURVE_PAD, height: r.height - 2 * CURVE_PAD, right: r.right, bottom: r.bottom }; };
  const pos = e => { const r = box(); return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height, r]; };
  let drag = null, lastTap = { t: 0 };
  function nearest(pts, x, y, r) {
    let best = -1, bd = 1e9;
    pts.forEach((q, i) => { const dd = Math.hypot((q[0] - x) * r.width, (q[1] - y) * r.height); if (dd < bd) { bd = dd; best = i; } });
    return { i: best, d: bd };
  }
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    const pts = curveState[curveChan], [x, y, r] = pos(e);
    armUndoCapture();
    let { i, d } = nearest(pts, x, y, r);
    /* Double-tap removes a point. Done here rather than with the dblclick
       event, which touch screens do not reliably fire; this behaves the same
       for mouse, pen and finger. A second tap on the same point within
       450ms removes it, including a point that the first tap just added. */
    const nowT = performance.now();
    if (d <= 18 && i > 0 && i < pts.length - 1 && lastTap.i === i && lastTap.ch === curveChan && nowT - lastTap.t < 450) {
      pts.splice(i, 1); lastTap = { t: 0 }; curveSel = -1;
      commitUndoCapture(); curveChanged();
      return;
    }
    lastTap = d <= 18 ? { t: nowT, i: i, ch: curveChan } : { t: 0 };
    if (d > 18) {
      const nx = Math.min(0.99, Math.max(0.01, x));
      let ins = pts.findIndex(q => q[0] > nx); if (ins < 0) ins = pts.length;
      if ((ins > 0 && nx - pts[ins - 1][0] < 0.02) || (ins < pts.length && pts[ins][0] - nx < 0.02)) { preChangeSnapshot = null; return; }
      pts.splice(ins, 0, [nx, clamp01(y)]); i = ins;
      lastTap = { t: nowT, i: ins, ch: curveChan };
    }
    drag = { i: i }; curveSel = i;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    sliderDragging = true; draggedSliderId = 'curve';   // reuse the draft-quality render while dragging
    curveChanged();
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const pts = curveState[curveChan], [x, y] = pos(e), i = drag.i, n = pts.length;
    const nx = (i === 0 || i === n - 1) ? pts[i][0] : Math.max(pts[i - 1][0] + 0.01, Math.min(pts[i + 1][0] - 0.01, x));
    pts[i] = [nx, clamp01(y)];
    curveChanged();
  });
  const end = e => {
    if (!drag) return;
    const pts = curveState[curveChan], r = cv.getBoundingClientRect(), i = drag.i;
    if (i > 0 && i < pts.length - 1 && (e.clientX < r.left - 24 || e.clientX > r.right + 24)) { pts.splice(i, 1); curveSel = -1; }
    drag = null;
    sliderDragging = false; settleFullRes(); draggedSliderId = '';
    commitUndoCapture();
    curveChanged();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  document.querySelectorAll('#curveTabs button[data-ch]').forEach(b => b.addEventListener('click', () => {
    curveChan = b.getAttribute('data-ch'); curveSel = -1;
    document.querySelectorAll('#curveTabs button[data-ch]').forEach(o => o.classList.toggle('on', o === b));
    drawCurveEditor();
  }));
  $('btnCurveReset').addEventListener('click', () => {
    armUndoCapture(); curveState = curveDefault(); curveSel = -1; commitUndoCapture(); curveChanged();
  });
  // starting curves, for whichever channel is showing
  document.querySelectorAll('#curvePresets button[data-cp]').forEach(b => b.addEventListener('click', () => {
    armUndoCapture(); curveState[curveChan] = JSON.parse(JSON.stringify(CURVE_PRESETS[b.dataset.cp])); curveSel = -1;
    commitUndoCapture(); curveChanged();
  }));
  // luminance-only mode for the RGB curve
  $('curveLum').addEventListener('change', () => { armUndoCapture(); curveState.lum = $('curveLum').checked; if (!curveState.lum) delete curveState.lum; commitUndoCapture(); curveChanged(); });
  // exact values for the selected point, 0-255 like most editors show them
  const applyPointFields = () => {
    const pts = curveState[curveChan]; if (curveSel < 0 || curveSel >= pts.length) return;
    const i = curveSel, n = pts.length, end = i === 0 || i === n - 1;
    let x = Math.max(0, Math.min(255, +$('curveIn').value || 0)) / 255, y = Math.max(0, Math.min(255, +$('curveOut').value || 0)) / 255;
    if (end) x = pts[i][0]; else x = Math.max(pts[i - 1][0] + 1 / 255, Math.min(pts[i + 1][0] - 1 / 255, x));
    armUndoCapture(); pts[i] = [x, y]; commitUndoCapture(); curveChanged();
  };
  ['curveIn', 'curveOut'].forEach(id => { $(id).addEventListener('change', applyPointFields); $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyPointFields(); e.target.blur(); } }); });
  $('curveDetails').addEventListener('toggle', () => { drawCurveEditor(); scheduleCurveHist(); });
  window.addEventListener('resize', drawCurveEditor);
  const del = $('btnCurveDel');
  if (del) del.addEventListener('click', () => {
    const pts = curveState[curveChan], i = curveSel;
    if (i <= 0 || i >= pts.length - 1) return;
    armUndoCapture(); pts.splice(i, 1); curveSel = -1; commitUndoCapture(); curveChanged();
  });
})();

/* ---------- Region sliders and the Regions / Points switch (build 168) ---------- */
const CURVE_MODE_KEY = 'irlab.curveMode';
let curveMode = 'regions';
try { if (localStorage.getItem(CURVE_MODE_KEY) === 'points') curveMode = 'points'; } catch (e) {}
function drawCurveMini() {
  const cv = $('curveMini'); if (!cv) return;
  const W0 = cv.clientWidth, H0 = cv.clientHeight; if (!W0 || !H0) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W0 * dpr) || cv.height !== Math.round(H0 * dpr)) { cv.width = Math.round(W0 * dpr); cv.height = Math.round(H0 * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, W0, H0);
  const P = 8, W = W0 - 2 * P, H = H0 - 2 * P; ctx.save(); ctx.translate(P, P);
  // the four regions, the one being dragged lit
  CURVE_REGIONS.slice().reverse().forEach((k, i) => {   // s, d, l, h from left to right
    ctx.fillStyle = 'rgba(111,171,150,' + (curveMiniHot === k ? 0.22 : (i % 2 ? 0.10 : 0.05)) + ')';
    ctx.fillRect(W * i / 4, 0, W / 4, H);
  });
  ctx.strokeStyle = 'rgba(168,147,114,.35)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke(); ctx.setLineDash([]);
  const fn = makeChanFn(curveChan);
  ctx.strokeStyle = CURVE_COL[curveChan]; ctx.lineWidth = 2; ctx.beginPath();
  for (let px = 0; px <= W; px += 1) { const y = H - fn(px / W) * H; if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y); }
  ctx.stroke(); ctx.restore();
}
let curveMiniHot = '';
function syncCurveRegions() {
  const p = curveParam(curveChan) || {};
  CURVE_REGIONS.forEach(k => {
    const el = $('crg_' + k); if (!el) return;
    const v = Math.round((p[k] || 0) * 100);
    if (document.activeElement !== el || +el.value !== v) el.value = v;
    const out = $('v_crg_' + k); if (out) out.textContent = (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v);
    if (typeof syncSliderFill === 'function') syncSliderFill(el);
  });
  drawCurveMini();
}
function setCurveMode(m, persist) {
  curveMode = m;
  if (persist) { try { localStorage.setItem(CURVE_MODE_KEY, m); } catch (e) {} }   // only a user's own choice is remembered
  document.querySelectorAll('#curveModeRow button[data-cm]').forEach(b => { const on = b.dataset.cm === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  const r = $('curveRegions'), pt = $('curvePoints');
  if (r) r.hidden = m !== 'regions';
  if (pt) pt.hidden = m !== 'points';
  if (m === 'points') { drawCurveEditor(); scheduleCurveHist(); } else syncCurveRegions();
}
function setCurveChan(ch) {
  curveChan = ch; curveSel = -1;
  document.querySelectorAll('#curveTabs button[data-ch], #curveTabsR button[data-ch]').forEach(o => { const on = o.getAttribute('data-ch') === ch; o.classList.toggle('on', on); o.setAttribute('aria-selected', on ? 'true' : 'false'); });
  drawCurveEditor(); syncCurveRegions();
}
(function wireCurveRegions() {
  if (!$('curveRegions')) return;
  document.querySelectorAll('#curveModeRow button[data-cm]').forEach(b => b.addEventListener('click', () => setCurveMode(b.dataset.cm, true)));
  document.querySelectorAll('#curveTabsR button[data-ch]').forEach(b => b.addEventListener('click', () => setCurveChan(b.getAttribute('data-ch'))));
  // the point editor's own tabs keep the two views on the same channel
  document.querySelectorAll('#curveTabs button[data-ch]').forEach(b => b.addEventListener('click', () => setCurveChan(b.getAttribute('data-ch'))));
  CURVE_REGIONS.forEach(k => {
    const el = $('crg_' + k); if (!el) return;
    el.addEventListener('input', () => {
      if (!curveState.param) curveState.param = {};
      const p = curveState.param[curveChan] || (curveState.param[curveChan] = {});
      p[k] = (+el.value || 0) / 100;
      if (!CURVE_REGIONS.some(q => Math.abs(p[q] || 0) > 1e-6)) delete curveState.param[curveChan];
      if (curveState.param && !Object.keys(curveState.param).length) delete curveState.param;
      curveMiniHot = k; syncCurveRegions(); render(true);
    });
    // one undo step per completed adjustment, like every other slider
    el.addEventListener('pointerdown', armUndoCapture);
    el.addEventListener('focus', armUndoCapture);
    el.addEventListener('pointerup', () => setTimeout(commitUndoCapture, 0));
    el.addEventListener('pointercancel', () => { preChangeSnapshot = null; });
    el.addEventListener('change', () => { curveMiniHot = ''; drawCurveMini(); commitUndoCapture(); });
  });
  $('curveDetails').addEventListener('toggle', () => setCurveMode(curveMode));
  window.addEventListener('resize', drawCurveMini);
  setCurveMode(curveMode);
})();

function captureState() {
  return {
    tv: 4,   // slider-weight version: none = straight-line; 2 = weighted incl. Black/White point; 3 = weighted except Black/White point; 4 = Temperature/Tint on their curve (build 190)
    curves: curveCopy(curveState),
    crop: cropCopy(cropRect),
    masks: JSON.parse(JSON.stringify(masks)),
    m: MCELLS.map(id => +$(id).value || 0),
    mOff: MOFFCELLS.map(id => +$(id).value || 0),
    s: HASH_SLIDERS.map(id => { const el = $(id); return el ? +el.value || 0 : 0; }),
    preWB: [...preWB], postWB: [...postWB], preWBM: [...preWBM], postWBM: [...postWBM], wbMethod: wbMethod, hueSpace: hueSpace,
    // read straight from the <select>, same as hueSpace's own mirror
    // variable would be if it had one -- no JS variable needed since
    // collectParams() already reads this element live at render time
    swapSpace: ($('swapSpace') && $('swapSpace').value) || '2',
    // the vignette CENTRE is edit state like any slider — it changes the
    // rendered output and is baked into exports — but it lives in a JS
    // variable rather than an <input>, so it is not covered by the
    // HASH_SLIDERS sweep above and has to be captured explicitly
    vigCentre: [...vigCentre],
    rawWb: rawWbCustom ? Object.assign({ t: rawWbCustom.t, g: rawWbCustom.g }, rawWbCustom.wb ? { wb: rawWbCustom.wb.slice() } : {}) : null,   // build 197: RAW Temperature + Green (src/raw-wb.js)
    indexMode: indexMode,
    lumPreserve: lumPreserve,
    filmOn: filmOn,
    /* Checkboxes added later that change the rendered image and so belong in
       an undo step, but are not <input type=range> and therefore invisible to
       the HASH_SLIDERS sweep above. Each was missed when it was added, which
       is precisely the failure this comment exists to stop repeating: undo
       silently stepped over them, so a toggle could not be taken back.
       camMatch's fitted coefficients are NOT stored — they belong to the
       loaded file, not to an edit, and a snapshot from before the fit existed
       would otherwise wipe them. Only the on/off state travels. */
    camMatch: camMatchOn,
    irLeak: (typeof irLeakOn !== 'undefined') ? { on: irLeakOn, amt: irLeakAmt } : undefined,   // build 172
    dust: (typeof dustSpots !== 'undefined') ? JSON.parse(JSON.stringify(dustSpots)) : undefined,   // build 185
    filmTone: filmToneOn,
    /* The experimental ProPhoto swap checkbox and its preset dropdown were
       missing from here entirely, not just uncaptured by the HASH_SLIDERS
       sweep -- unlike the toggles in the comment above, this one is baked
       in at DECODE time (rawEngineResultToCanvas), not read live by the
       render pipeline, so restoring it needs an explicit reapply after
       the value is set back, same as Reset all needed once fixed. See
       applyState below for that call. */
    camSpaceSwap: !!($('camSpaceSwap') && $('camSpaceSwap').checked),
    camSpaceSwapPreset: ($('camSpaceSwapPreset') && $('camSpaceSwapPreset').value) || '',
    // deep-copied, not just spread — these are edited in place by the
    // per-band sliders, so a shallow reference here would let a LATER edit
    // silently rewrite a snapshot that undo is already holding onto
    bands: targetedBands.map(b => ({...b})),
    lut: currentLUT,
    preLUT: preLUTUser,
    lumaW: ['lumaR','lumaG','lumaB'].map(id => +($(id) && $(id).value) || 0),   // raw 0-100 slider values, not getLumaW()'s fractions -- applyState writes these straight back into the sliders
    lutStatusText: $('lutStatus').textContent,
    activePreset: (document.querySelector('.pb.on b') || {}).textContent || null,
  };
}
function applyState(snap) {
  curveState = snap.curves ? curveCopy(snap.curves) : curveDefault(); drawCurveEditor();
  cropRect = snap.crop ? cropCopy(snap.crop) : null; drawCropOverlay();
  masks = snap.masks ? JSON.parse(JSON.stringify(snap.masks)) : [];
  maskSel = Math.min(maskSel, masks.length - 1); maskRenderList(); maskSyncEditor(); drawMaskOverlay();
  MCELLS.forEach((id, i) => $(id).value = snap.m[i]);
  // older snapshots predate the offset column, so default it rather than
  // writing undefined into the cells
  MOFFCELLS.forEach((id, i) => $(id).value = (snap.mOff && snap.mOff[i]) || 0);
  mxSync();
  HASH_SLIDERS.forEach((id, i) => {
    const el = $(id); if (!el) return;
    // snap.s[i] can be undefined when restoring a session saved before this
    // slider existed — appended at the END of HASH_SLIDERS specifically so
    // that only ITS OWN index goes missing on an old session, rather than
    // silently shifting every later slider's value by one position
    // a slider newer than the snapshot gets its own default (the ranges sit at 50), not 0
    let sv = snap.s[i] !== undefined ? snap.s[i] : ((id in sliderDefaults) ? +sliderDefaults[id] : 0);
    if (!snap.tv && LIGHT_TAPER[id]) sv = taperPos(id, sv);   // an older session: its numbers were effects, so move them to where the thumb now sits
    if (snap.tv === 2 && BW_TAPER_V2[id]) sv = bwFromV2(id, sv);   // saved while Black/White point were weighted
    if (!(snap.tv >= 4) && WB_CURVE[id]) sv = wbPos(sv);   // build 190: saved as an effect, now a position on the curve
    el.value = sv;
    const lbl = $('v_' + id); if (lbl) lbl.textContent = fmtSliderValue(id, el.value);
  });
  targetedBands = (snap.bands || []).map(b => ({...b}));
  bandRenderList();
  wbMethod = 'bradford';   // forced, not read from the snapshot — 'simple' no longer exists as a render mode, so an old saved session or undo entry carrying it must not be trusted
  if (snap.vigCentre) {
    vigCentre = [...snap.vigCentre];
    if ($('vigCentreNote')) $('vigCentreNote').textContent =
      (vigCentre[0] === 0.5 && vigCentre[1] === 0.5)
        ? 'Centre: 0.50, 0.50 (default)'
        : 'Centre: ' + vigCentre[0].toFixed(2) + ', ' + vigCentre[1].toFixed(2);
  }
  hueSpace = snap.hueSpace || 'perceptual';
  syncHueSpaceButtons();
  if ($('swapSpace')) $('swapSpace').value = snap.swapSpace !== undefined ? snap.swapSpace : '2';
  syncWidenFromSelect();   // a saved state with a named space (or none) puts the slider where that space sits
  lumPreserve = !!snap.lumPreserve;
  if ($('lumPreserve')) $('lumPreserve').checked = lumPreserve;
  // older snapshots predate this control; default to Rec.709 rather than
  // writing undefined into the sliders
  const lw = snap.lumaW || [21, 72, 7];
  ['lumaR','lumaG','lumaB'].forEach((id,i) => {
    const el = $(id); if (!el) return;
    el.value = lw[i]; const lbl = $('v_'+id); if (lbl) lbl.textContent = lw[i];
  });
  filmOn = !!snap.filmOn;
  if ($('filmOn')) $('filmOn').checked = filmOn;
  // see captureState: these three are not sliders, so they need restoring by
  // hand or undo walks straight past them
  camMatchOn = !!snap.camMatch;
  if (typeof irLeakOn !== 'undefined') { irLeakOn = !!(snap.irLeak && snap.irLeak.on); irLeakAmt = snap.irLeak && isFinite(snap.irLeak.amt) ? snap.irLeak.amt : 1; irlSync(); }   // build 172
  if (typeof dustSpots !== 'undefined') { const nd = Array.isArray(snap.dust) ? JSON.parse(JSON.stringify(snap.dust)) : []; if (JSON.stringify(nd) !== JSON.stringify(dustSpots)) { dustSpots = nd; dustSel = -1; dustRefresh(); } }   // build 185
  if ($('camMatch') && !$('camMatch').disabled) $('camMatch').checked = camMatchOn;
  filmToneOn = !!snap.filmTone;
  if ($('chkFilmTone')) {
    $('chkFilmTone').checked = filmToneOn;
    // the strength slider only exists alongside its checkbox
    if ($('filmToneRow')) $('filmToneRow').style.display = snap.filmTone ? '' : 'none';
  }
  indexMode = snap.indexMode || 0;
  document.querySelectorAll('.idxBtn').forEach(x => x.classList.toggle('on', +x.dataset.idx === indexMode));
  if ($('idxLegend')) $('idxLegend').style.display = indexMode ? 'inline-flex' : 'none';
  if ($('idxTools')) $('idxTools').style.display = indexMode ? 'block' : 'none';
  if (snap.vigCentre) {
    vigCentre = [...snap.vigCentre];
    const isDefault = vigCentre[0] === 0.5 && vigCentre[1] === 0.5;
    $('vigCentreNote').textContent = isDefault
      ? 'Centre: 0.50, 0.50 (default)'
      : 'Centre: ' + vigCentre[0].toFixed(2) + ', ' + vigCentre[1].toFixed(2);
  }
  if (snap.preWBM) {
    preWBM = [...snap.preWBM];
    const set = preWBM.some((v,i) => v !== IDENTITY3[i]);
    $('wbPreStatus').textContent = set ? 'Set ✓ (Bradford)' : 'Pre-WB: Not set';
    // undoing back past the pick left the marker visible over a WB that was
    // no longer applied
    if (!set) $('pickMarkerPre').style.display = 'none';
  }
  if (snap.postWBM) {
    postWBM = [...snap.postWBM];
    const set = postWBM.some((v,i) => v !== IDENTITY3[i]);
    $('wbPostStatus').textContent = set ? 'Set ✓ (Bradford)' : 'Post-WB: Not set';
    if (!set) $('pickMarkerPost').style.display = 'none';
  }
  if ('lut' in snap) {
    currentLUT = snap.lut;
    preLUTUser = snap.preLUT || null;
    if (engine) { engine.setLUT(currentLUT); engine.setLUTPre(preLUTUser || decodeFilmLUT()); }   // the atlas lives on the GPU now, so undo has to re-upload it
    $('lutStatus').textContent = snap.lutStatusText || LUT_EMPTY_MSG;
    $('lutControls').style.display = currentLUT ? 'block' : 'none';
    $('lutClear').style.display = currentLUT ? 'inline-block' : 'none';
  }
  document.querySelectorAll('.pb').forEach(p => {
    p.classList.toggle('on', snap.activePreset && p.querySelector('b') && p.querySelector('b').textContent === snap.activePreset);
  });
  updateClearPresetBtn();
  /* See captureState's comment on these two: baked in at decode time, not
     read live by the render pipeline, so setting .checked/.value back
     here (a plain property assignment, not a real click) does not by
     itself change what's on screen -- same reason Reset all needed an
     explicit call after it stopped working. Older snapshots predate
     these two fields; camSpaceSwap defaults to false and
     camSpaceSwapPreset to '' via the || fallbacks in captureState, so an
     old undo entry restores to "no swap" rather than throwing on an
     undefined value. */
  if ($('camSpaceSwap')) $('camSpaceSwap').checked = !!snap.camSpaceSwap;
  if ($('camSpaceSwapEditor')) $('camSpaceSwapEditor').checked = !!snap.camSpaceSwap;
  if ($('camSpaceSwapPreset')) $('camSpaceSwapPreset').value = snap.camSpaceSwapPreset || '';
  if ($('camSpaceSwapPresetEditor')) $('camSpaceSwapPresetEditor').value = snap.camSpaceSwapPreset || '';
  rawWbCustom = snap.rawWb && snap.rawWb.t > 0 && snap.rawWb.g > 0 ? { t: +snap.rawWb.t, g: +snap.rawWb.g } : null;   // build 197
  if (rawWbCustom && Array.isArray(snap.rawWb.wb) && snap.rawWb.wb.length === 3 && snap.rawWb.wb.every(v => v > 0)) rawWbCustom.wb = snap.rawWb.wb.map(Number);   // build 199: a pick
  if (typeof reapplyCamSpaceSwap === 'function') reapplyCamSpaceSwap();
  if (typeof syncRangeToggle === 'function') syncRangeToggle();
  if (typeof syncEpdLabels === 'function') syncEpdLabels();
  render();
  updateUndoButton();
}
function updateUndoButton() {
  const btn = $('btnUndo');
  if (!btn) return;   // guard: buttons may not exist in DOM at first call
  btn.disabled = undoStack.length === 0;
  btn.textContent = undoStack.length ? '↶ Undo (' + undoStack.length + ')' : '↶ Undo';
  const rbtn = $('btnRedo');
  if (!rbtn) return;
  rbtn.disabled = redoStack.length === 0;
  rbtn.textContent = redoStack.length ? '↷ Redo (' + redoStack.length + ')' : '↷ Redo';
  /* Nothing to undo or redo: the pill over the photo has nothing to offer, so it steps out of the way (see .urIdle). */
  const zb = $('zoomBadge'); if (zb) zb.classList.toggle('urIdle', btn.disabled && rbtn.disabled);
}
/* Cheap comparison key. The old code JSON.stringify'd the whole snapshot —
   including currentLUT, whose `data` is a Float32Array, which stringify
   expands into an object with one numeric key per entry: ~108,000 keys for a
   33³ LUT, serialised TWICE, on every single pointerup and slider release.
   The LUT is immutable once parsed, so identity comparison is both correct
   and free. */
/* Must list EVERY field captureState records. commitUndoCapture decides
   whether to push a snapshot by comparing two stateKeys, so anything absent
   here is invisible to that comparison — the state gets captured and can be
   restored, but the push never happens, and the control silently has no
   undo at all. That is exactly how the WB method, hue space, vignette
   centre and index mode ended up unprotected: all four were in
   captureState, none were here. */
function stateKey(s) {
  return JSON.stringify({
    m: s.m, mOff: s.mOff, s: s.s, preWB: s.preWB, postWB: s.postWB, bands: s.bands,
    activePreset: s.activePreset, curves: s.curves, crop: s.crop, masks: s.masks,
    preWBM: s.preWBM, postWBM: s.postWBM, wbMethod: s.wbMethod,
    hueSpace: s.hueSpace, swapSpace: s.swapSpace, vigCentre: s.vigCentre, indexMode: s.indexMode, rawWb: s.rawWb || null,
    lumPreserve: s.lumPreserve, filmOn: s.filmOn,
    /* Anything captureState stores MUST be compared here too. This function
       is what decides whether a change happened at all — if a field is
       missing, commitUndoCapture sees two identical keys, concludes nothing
       changed, and never pushes the snapshot. The control then has no undo
       entry, which looks like undo skipping it rather than never recording
       it. Adding a field to captureState without adding it here is silent:
       nothing breaks, the state simply stops being undoable. */
    camMatch: s.camMatch, filmTone: s.filmTone,
    // same failure this whole function exists to prevent, found on the
    // experimental swap checkbox and its preset this time -- both were in
    // captureState/applyState but not compared here, so toggling the swap
    // produced two identical keys and never reached the undo stack at all
    camSpaceSwap: s.camSpaceSwap, camSpaceSwapPreset: s.camSpaceSwapPreset,
    irLeak: s.irLeak,   // build 172
    dust: s.dust,   // build 185
    /* The LUT, identified rather than serialised. captureState has always
       stored it and applyState has always restored it, but it was never
       compared here \u2014 so loading or clearing a LUT produced two identical
       keys, commitUndoCapture concluded nothing had changed, and the change
       got no undo entry at all. Exactly the failure this comment describes,
       found again on a LUT rather than a checkbox.

       Compared by size and first few samples, not by the whole table: a
       32-cube is 98k floats and JSON-stringifying that on every single
       change would be its own problem. Size plus a fingerprint distinguishes
       every LUT this tool can actually load. */
    lut: s.lut ? [s.lut.size, s.lut.data[0], s.lut.data[1], s.lut.data[2],
                  s.lut.data[s.lut.data.length - 1]] : null,
    lumaW: s.lumaW,   // added here on purpose \u2014 see the comment above this function
    // the early-stage user LUT, same fingerprint approach as the late one
    preLUT: s.preLUT ? [s.preLUT.size, s.preLUT.data[0], s.preLUT.data[1],
                        s.preLUT.data[s.preLUT.data.length - 1]] : null
  });
}
/* ---------- what "Before" shows ----------
   By default Before is the picture as it was just before your last change, so the slider (or hold-to-compare)
   answers "what did that last move do?". Tapping the word Before switches it to the original photo, which is
   what it always used to show; the choice is remembered. Each undo step keeps a copy of the preview from before
   its change (only the most recent few, to keep memory modest), so Undo and Redo move the reference with you:
   after an Undo, Before is the picture from before the change that is now on top. Until the first change, and
   whenever a stored copy no longer matches the photo's shape (after a rotate), it falls back to the original. */
let compareMode = 'last';
try { if (localStorage.getItem('irlab.compareRef') === 'original') compareMode = 'original'; } catch (e) {}
let undoBmps = [], redoBmps = [], preChangeBmp = null, refIsOriginal = true, refSource = null;
const REF_KEEP = 6;
function grabPreview() {
  const pv = (typeof engine !== 'undefined' && engine) ? engine.canvas : null; if (!pv || !pv.width || !pv.height) return null;
  const k = Math.min(1, 1400 / Math.max(pv.width, pv.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(pv.width * k)); c.height = Math.max(1, Math.round(pv.height * k));
  try { c.getContext('2d').drawImage(pv, 0, 0, c.width, c.height); } catch (e) { return null; }
  return c;
}
function trimBmps() { for (let i = 0; i < undoBmps.length - REF_KEEP; i++) undoBmps[i] = null; for (let i = 0; i < redoBmps.length - REF_KEEP; i++) redoBmps[i] = null; }
function refreshCompareRef() {
  const po = $('previewOrig'); if (!po || typeof rawCanvas === 'undefined' || !rawCanvas || !rawCanvas.width) return;
  let src = null;
  if (compareMode === 'last' && undoBmps.length) {
    const b = undoBmps[undoBmps.length - 1], pv = (typeof engine !== 'undefined' && engine) ? engine.canvas : null;
    // a stored picture only counts if it was taken during this photo's own load (a different photo's must never show)
    if (b && b.__gen === loadToken && pv && pv.width && Math.abs(b.width / b.height - pv.width / pv.height) < 0.02) src = b;
  }
  if (src !== refSource || !src) {
    const draw = src || rawCanvas;
    if (po.width !== draw.width || po.height !== draw.height) { po.width = draw.width; po.height = draw.height; }
    const ctx = po.getContext('2d'); ctx.clearRect(0, 0, po.width, po.height); ctx.drawImage(draw, 0, 0);
    refSource = src;
  }
  refIsOriginal = !src;
  const lbl = $('cmpRefLabel'); if (lbl) lbl.textContent = '\u25c0 ' + (refIsOriginal ? 'Original' : 'Before');
}
function toggleCompareRef() {
  compareMode = compareMode === 'last' ? 'original' : 'last';
  try { localStorage.setItem('irlab.compareRef', compareMode); } catch (e) {}
  refSource = undefined; refreshCompareRef();
  toast(compareMode === 'last' ? (undoBmps.length ? 'Before = your last change' : 'Before = your last change (nothing changed yet, so the original)') : 'Before = the original photo');
}
(function wireCompareRefLabel() {
  const l = $('cmpRefLabel'); if (!l) return;
  l.addEventListener('click', toggleCompareRef);
  l.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCompareRef(); } });
})();

function armUndoCapture() { preChangeSnapshot = captureState(); preChangeBmp = grabPreview(); if (preChangeBmp) preChangeBmp.__gen = loadToken; }
function commitUndoCapture() {
  if (!preChangeSnapshot) return;
  const now = captureState();
  const changed = now.lut !== preChangeSnapshot.lut ||
                  stateKey(now) !== stateKey(preChangeSnapshot);
  if (changed) {
    undoStack.push(preChangeSnapshot); undoBmps.push(preChangeBmp);
    if (undoStack.length > UNDO_MAX) { undoStack.shift(); undoBmps.shift(); }
    // a genuinely new committed change invalidates whatever redo history
    // existed — the same rule every editor follows, since "redo" after a
    // fresh edit would restore a future that no longer follows from the present
    redoStack = []; redoBmps = [];
    trimBmps(); refreshCompareRef();
    updateUndoButton();
  }
  preChangeSnapshot = null;
}
// arm on the first touch/click of an interaction, commit once it settles —
// one undo step per completed adjustment, not one per pixel of drag.
[...MCELLS, ...MOFFCELLS, ...HASH_SLIDERS].forEach(id => {
  const el = $(id); if (!el) return;
  el.addEventListener('pointerdown', armUndoCapture);
  el.addEventListener('focus', armUndoCapture);
  el.addEventListener('change', commitUndoCapture);
  el.addEventListener('pointerup', () => setTimeout(commitUndoCapture, 0));
  el.addEventListener('pointercancel', () => { preChangeSnapshot = null; });
});
/* btnUndo / btnRedo addEventListener moved to end of <body>
   so the buttons exist in the DOM when the wiring runs. The bar HTML
   was moved to body-level to fix position:fixed under transforms, which
   put it after this script; wiring here then crashed on null. */

$('btnExportLUT').addEventListener('click', async () => {
  if (!loadedImage) { toast('Load an image first'); return; }
  try {
    const { text, name } = bakeCubeGPU(33) || buildCubeLUT(32);   // build 158: the GPU bake is the real shader; the CPU copy is only a fallback
    /* Auto-generated name (e.g. "ChannelSwap_Aerochrome.cube") was
       downloading immediately with no chance to rename or reconsider —
       every export from the same look landed in Downloads under the
       same auto-generated name, silently overwriting or duplicating
       ("(1)", "(2)"...) with no way to tell which was which later.
       A prompt seeded with the default name lets the user keep it,
       rename it, or cancel the export outright. */
    let chosen = await askText('Save LUT as', name, 'Save');
    if (chosen === null) return;               // cancelled
    chosen = chosen.trim();
    if (!chosen) chosen = name;                 // blank input falls back to the default
    if (!/\.cube$/i.test(chosen)) chosen += '.cube';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = chosen;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('LUT saved — ' + chosen);
  } catch (e) { toast('LUT export failed: ' + e.message, true); }
});
$('btnExportIRL').addEventListener('click', async () => {
  if (!loadedImage) { toast('Load an image first'); return; }
  try {
    const { bytes, name } = bakeIrlForCamera();
    let chosen = await askText('Save camera LUT as (8 letters max)', name, 'Save');
    if (chosen === null) return;               // cancelled
    chosen = irlCameraName(chosen.trim() || name);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = chosen;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Camera LUT saved — ' + chosen + '. Copy it to ML/LUTS on the card.');
  } catch (e) { toast('Camera LUT export failed: ' + e.message, true); }
});
/* ---------- RAW decode progress (build 156) ----------
   Decoding a RAW can take many seconds on a phone, and a toast that vanished after two seconds left a frozen-looking
   screen. This stays up for the whole decode, names the stage (1 Reading file, 2 Decoding sensor, 3 Building preview)
   and counts the seconds. The bar is indeterminate on purpose: the decoder gives no progress to report. It hides itself
   if another photo is opened meanwhile (loadToken moves on). */
const RAWPROG_STEPS = ['Reading file', 'Decoding sensor data', 'Building preview'];
let rawProgS = null;
function rawProgStart(step, detail) {
  let el = $('rawProg');
  if (!el) {
    el = document.createElement('div'); el.id = 'rawProg'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="rpTop"><b class="rpStage"></b><span class="rpTime"></span></div><div class="rpSteps"></div><div class="rpBar"></div>';
    document.body.appendChild(el);
  }
  if (!rawProgS || rawProgS.token !== loadToken) {
    if (rawProgS) clearInterval(rawProgS.iv);
    rawProgS = { token: loadToken, t0: performance.now(), iv: setInterval(rawProgTick, 250) };
  }
  rawProgS.step = step;
  el.querySelector('.rpStage').textContent = RAWPROG_STEPS[step] + '…';
  // two nodes so the page translator can match 'step N of 3' (an existing template); the detail (file or decoder name) stays as is
  const st = el.querySelector('.rpSteps'); st.textContent = '';
  const n = document.createElement('span'); n.textContent = 'step ' + (step + 1) + ' of 3'; st.appendChild(n);
  if (detail) { const d = document.createElement('span'); d.className = 'noTr'; d.textContent = ' · ' + detail; st.appendChild(d); }
  el.hidden = false; rawProgTick();
}
function rawProgTick() {
  const el = $('rawProg'); if (!el || !rawProgS) return;
  if (rawProgS.token !== loadToken) { rawProgEnd(); return; }
  if (performance.now() - rawProgS.t0 > 300000) { rawProgEnd(); return; }   // a safety net for any exit path that forgot to close it
  el.querySelector('.rpTime').textContent = Math.floor((performance.now() - rawProgS.t0) / 1000) + 's';
}
function rawProgEnd() {
  if (rawProgS) clearInterval(rawProgS.iv);
  rawProgS = null;
  const el = $('rawProg'); if (el) el.hidden = true;
}
