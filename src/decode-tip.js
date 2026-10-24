'use strict';
/* irlab editor: js/decode-tip.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- Decode tip (build 209) ----------
   The decode choices (colour rebuild, quick preview, wide-gamut swap) are read the moment a RAW opens, and they sit
   on the start page where they are easy to miss. So the first time a RAW opens while none of them has been picked,
   a short card says what the photo was decoded with and where to change it. It stops appearing once any decode
   option is changed, or once "Got it" is tapped. Only RAW files: decode settings do nothing for a JPEG or PNG. */
(function decodeTip() {
  const KEY = 'irlab.decodeTipDone';
  const done = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const markDone = () => { try { localStorage.setItem(KEY, '1'); } catch (e) {} };
  ['cr2PreferPreview', 'camSpaceSwap', 'demosaicSel', 'cr2PreferPreviewEditor', 'camSpaceSwapEditor', 'demosaicSelEd']
    .forEach(id => { const e = $(id); if (e) e.addEventListener('change', () => { markDone(); close(); }); });

  let box = null;
  function close() { if (box) { box.remove(); box = null; } }
  function openSettings() {
    if (typeof setEditorMode === 'function') setEditorMode('advanced', true);
    const t = document.querySelector('#dock button[data-tab="export"], button[data-tab="export"]');
    if (t && t.getAttribute('aria-pressed') !== 'true') t.click();
    const g = $('decodeGrp');
    if (g) { g.open = true; setTimeout(() => g.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80); }
  }
  function show() {
    if (box || done()) return;
    const sum = ($('labDecSumTxt') && $('labDecSumTxt').textContent.trim()) || 'AMaZE · full sensor';
    box = document.createElement('div');
    box.id = 'decodeTip'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-labelledby', 'decodeTipT');
    box.innerHTML = '<p id="decodeTipT"><span>Decoded with</span> <b class="noTr"></b></p>'
      + '<p class="dtBody">Decode settings change how a RAW is turned into a picture. Set them on the start page before you open a photo, or under Export, Decode settings, in Advanced.</p>'
      + '<div class="dtBtns"><button type="button" class="dtChange">Change settings</button><button type="button" class="dtOk">Got it</button></div>';
    box.querySelector('b').textContent = sum;
    box.querySelector('.dtOk').addEventListener('click', () => { markDone(); close(); });
    box.querySelector('.dtChange').addEventListener('click', () => { markDone(); close(); openSettings(); });
    document.body.appendChild(box);
    box.querySelector('.dtOk').focus({ preventScroll: true });
  }
  document.addEventListener('keydown', e => { if (box && e.key === 'Escape') close(); });
  // a RAW has opened when body gains .rawOpen; a reload restoring the last photo or a re-decode does not count
  let was = document.body.classList.contains('rawOpen');
  new MutationObserver(() => {
    const now = document.body.classList.contains('rawOpen');
    if (now && !was) {
      const quiet = (typeof sessionRestoring !== 'undefined' && sessionRestoring) || window.__keepEditsOnLoad;
      if (!quiet) setTimeout(show, 400);
    }
    if (!now) close();
    was = now;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
