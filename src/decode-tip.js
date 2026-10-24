'use strict';
/* irlab editor: js/decode-tip.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- Decode choice before the first RAW (builds 209-210) ----------
   The decode choices are read the moment a RAW is decoded, and they sit on the start page where they are easy to
   miss. So when a RAW is opened while no decode option has been picked yet, loadFile() waits on decodeTipAsk(): a
   short card shows the two choices that matter (colour rebuild, full sensor or quick preview) BEFORE anything is
   decoded. Open decodes with what is shown; Cancel opens nothing. Once Open is tapped, or any decode option is
   changed anywhere, it is not asked again. Only RAW files: decode settings do nothing for a JPEG or PNG. */
const DECODE_TIP_KEY = 'irlab.decodeTipDone';
function decodeTipDone() { try { return localStorage.getItem(DECODE_TIP_KEY) === '1'; } catch (e) { return false; } }
function decodeTipMarkDone() { try { localStorage.setItem(DECODE_TIP_KEY, '1'); } catch (e) {} }
['cr2PreferPreview', 'camSpaceSwap', 'demosaicSel', 'cr2PreferPreviewEditor', 'camSpaceSwapEditor', 'demosaicSelEd']
  .forEach(id => { const e = $(id); if (e) e.addEventListener('change', e2 => { if (e2.isTrusted) decodeTipMarkDone(); }); });

let decodeTipOpen = null;   // the pending card's resolver, so a second file picked while it is up replaces it
function decodeTipAsk(file) {
  const ext = ((file && file.name || '').split('.').pop() || '').toUpperCase();
  if (!RAW_EXT.includes(ext) || decodeTipDone()) return Promise.resolve(true);
  if ((typeof sessionRestoring !== 'undefined' && sessionRestoring) || window.__keepEditsOnLoad || window.__selftestRunning) return Promise.resolve(true);
  if (decodeTipOpen) decodeTipOpen(false);
  return new Promise(resolve => {
    const q = $('cr2PreferPreview');
    let dm = typeof demosaicPref === 'function' ? demosaicPref() : 'amaze';
    let quick = !!(q && q.checked);
    const box = document.createElement('div');
    box.id = 'decodeTip'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'decodeTipT');
    box.innerHTML =
        '<p id="decodeTipT">How should this RAW be decoded?</p>'
      + '<p class="dtFile noTr"></p>'
      + '<div class="dtRow"><span class="dtLbl">Colour rebuild</span><div class="dtSeg" data-k="dm">'
      +   '<button type="button" data-v="amaze">AMaZE</button><button type="button" data-v="rcd">RCD</button></div></div>'
      + '<p class="dtHint">AMaZE keeps the finest detail. RCD is a little softer and cleaner on noisy files.</p>'
      + '<div class="dtRow"><span class="dtLbl">Decode</span><div class="dtSeg" data-k="q">'
      +   '<button type="button" data-v="0">Full sensor</button><button type="button" data-v="1">Quick preview</button></div></div>'
      + '<p class="dtHint">Full sensor uses every pixel the camera recorded. Quick preview uses the small JPEG inside the file: faster, with fewer RAW-only tools.</p>'
      + '<p class="dtHint">You can change these later on the start page, or under Export, Decode settings, in Advanced.</p>'
      + '<div class="dtBtns"><button type="button" class="dtCancel">Cancel</button><button type="button" class="dtOk">Open</button></div>';
    box.querySelector('.dtFile').textContent = file.name;
    const paint = () => {
      box.querySelectorAll('.dtSeg[data-k="dm"] button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === dm ? 'true' : 'false'));
      box.querySelectorAll('.dtSeg[data-k="q"] button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.v === '1') === quick ? 'true' : 'false'));
    };
    box.querySelectorAll('.dtSeg button').forEach(b => b.addEventListener('click', () => {
      if (b.parentElement.dataset.k === 'dm') dm = b.dataset.v; else quick = b.dataset.v === '1';
      paint();
    }));
    paint();
    const veil = document.createElement('div'); veil.id = 'decodeTipVeil';
    const finish = ok => {
      if (decodeTipOpen !== done) return;
      decodeTipOpen = null; box.remove(); veil.remove(); document.removeEventListener('keydown', onKey, true);
      if (ok) {
        decodeTipMarkDone();
        // write the choices into the real controls without a change event on the demosaic selects, which would
        // re-decode a photo that is already open
        try { localStorage.setItem('irlab.demosaic', dm); } catch (e) {}
        ['demosaicSel', 'demosaicSelEd'].forEach(id => { const s = $(id); if (s) s.value = dm; });
        const ql = $('ltDecoder'); if (ql) ql.textContent = dm === 'rcd' ? 'RCD' : 'AMaZE';
        if (q) { q.checked = quick; q.dispatchEvent(new Event('change')); }   // syncs the editor copy and the start-page summary
      }
      resolve(ok);
    };
    const done = ok => finish(ok);
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
    box.querySelector('.dtOk').addEventListener('click', () => finish(true));
    box.querySelector('.dtCancel').addEventListener('click', () => finish(false));
    veil.addEventListener('click', () => finish(false));
    document.addEventListener('keydown', onKey, true);
    decodeTipOpen = done;
    document.body.appendChild(veil); document.body.appendChild(box);
    box.querySelector('.dtOk').focus({ preventScroll: true });
  });
}
