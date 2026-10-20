/* ---------- Simple / Advanced (build 171) ----------
   Simple shows the tools most photos need; Advanced shows everything. Switching only HIDES tools, it never resets or
   disables them, so a look renders the same in either mode. When something set in an Advanced tool is still affecting
   the photo while Simple is on, a note under the switch names it and takes you to Advanced in one tap.

   First visit starts in Simple. Anyone who has used irlab before (any saved irlab setting) starts in Advanced, so the
   tools they already know do not vanish on them; either way the choice is remembered. */
const MODE_KEY = 'irlab.mode';
// tool cards that only show in Advanced, with the short name the note uses
const ADV_TOOLS = {
  channelDetails: 'Source channels',
  maskDetails: 'Local adjustments', hslDetails: 'Colour by band', colCal: 'Calibration', colSpace: 'Swap working space',
  lutDetails: 'LUT', lensDetails: 'Hotspot removal', epdGrp: 'Tone mapping', fringeDetails: 'Colour fringing',
  decodeGrp: 'Decode settings', batchPanel: 'Batch'
};
// these change without the user touching them (a preset sets the mix), so they never count as "in use"
// Swap & mix stays in Simple (the swap buttons are core), but its mix grid, fine bar, lift and brightness weighting are Advanced
const ADV_PARTS = '#lumaWDetails, #mx, #mxFine, #matrixDetails .mxHint, #mxOff';
const ADV_SILENT = ['channelDetails', 'decodeGrp', 'batchPanel'];
let editorMode = 'simple';
try {
  const m = localStorage.getItem(MODE_KEY);
  if (m === 'simple' || m === 'advanced') editorMode = m;
  else if (Object.keys(localStorage).some(k => /^irlab[.\-_]/.test(k) && k !== 'irlab.curveMode')) editorMode = 'advanced';   // someone who has used irlab before
} catch (e) {}
function advancedInUse() {
  const names = [];
  Object.keys(ADV_TOOLS).forEach(id => {
    const d = $(id); if (!d || ADV_SILENT.includes(id)) return;
    if (d.classList.contains('mod')) names.push(ADV_TOOLS[id]);
  });
  try { if (typeof masks !== 'undefined' && masks.length && !names.includes(ADV_TOOLS.maskDetails)) names.push(ADV_TOOLS.maskDetails); } catch (e) {}
  try { if ((typeof currentLUT !== 'undefined' && currentLUT) || (typeof preLUTUser !== 'undefined' && preLUTUser)) { if (!names.includes('LUT')) names.push('LUT'); } } catch (e) {}
  try { if (typeof curveState !== 'undefined' && ['master', 'r', 'g', 'b'].some(k => !curvePtsIdentity(curveState[k]))) names.push('Tone curve points'); } catch (e) {}
  return names;
}
function updateModeNote() {
  const n = $('modeNote'); if (!n) return;
  const used = editorMode === 'simple' ? advancedInUse() : [];
  n.hidden = !used.length;
  if (used.length) {   // three nodes so the page translator handles the words; the tool names are fixed constants
    n.textContent = '';
    const a = document.createElement('span'); a.textContent = 'Also in use'; n.appendChild(a);
    const b = document.createElement('span'); b.className = 'noTr'; b.textContent = ': ' + used.join(', ') + ' \u00b7 '; n.appendChild(b);
    const c = document.createElement('span'); c.textContent = 'show'; n.appendChild(c);
  }
}
function setEditorMode(m, persist) {
  editorMode = m === 'advanced' ? 'advanced' : 'simple';
  document.documentElement.classList.toggle('simpleMode', editorMode === 'simple');
  document.querySelectorAll('#modeBar button[data-mode]').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === editorMode ? 'true' : 'false'));
  if (persist) { try { localStorage.setItem(MODE_KEY, editorMode); } catch (e) {} }
  // the curve's Points editor is an Advanced tool: Simple keeps the Regions sliders in view
  if (editorMode === 'simple' && typeof setCurveMode === 'function' && typeof curveMode !== 'undefined' && curveMode === 'points') setCurveMode('regions');
  updateModeNote();
}
(function wireMode() {
  Object.keys(ADV_TOOLS).forEach(id => { const d = $(id); if (d) d.classList.add('adv'); });
  const cm = $('curveModeRow'); if (cm) cm.classList.add('adv');
  document.querySelectorAll(ADV_PARTS).forEach(el => el.classList.add('adv'));
  document.querySelectorAll('#modeBar button[data-mode]').forEach(b => b.addEventListener('click', () => { setEditorMode(b.dataset.mode, true); if (typeof haptic === 'function') haptic('select'); }));
  const n = $('modeNote'); if (n) n.addEventListener('click', () => setEditorMode('advanced', true));
  setEditorMode(editorMode, false);
})();
