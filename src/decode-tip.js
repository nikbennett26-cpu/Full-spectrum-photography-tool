'use strict';
/* irlab editor: js/decode-tip.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- Decode choice before each RAW (builds 209-210, 264) ----------
   The decode choices are read the moment a RAW is decoded, and they sit on the start page where they are easy to
   miss. So when a RAW is opened, loadFile() waits on decodeTipAsk(): a short card shows the two choices that matter
   (colour rebuild, full sensor or quick preview) as they are set right now, BEFORE anything is decoded. Open decodes
   with what is shown; Cancel opens nothing. Build 264: it asks every time (it used to stop after the first Open), until
   Don't ask again is ticked on the card or Ask how to decode each RAW is unticked on the start page; ticking that
   brings it back. Only RAW files: decode settings do nothing for a JPEG or PNG. */
const DECODE_ASK_KEY = 'irlab.decodeAsk2';   // '0' = opted out. Build 272: a new key, so an opt-out ticked while the card was being tested (build 264) no longer hides it
function decodeAskOn() { try { return localStorage.getItem(DECODE_ASK_KEY) !== '0'; } catch (e) { return true; } }
function decodeAskSet(on) {
  try { localStorage.setItem(DECODE_ASK_KEY, on ? '1' : '0'); } catch (e) {}
  const c = $('decodeAskEach'); if (c && c.checked !== on) c.checked = on;
}
(function () {
  const c = $('decodeAskEach'); if (!c) return;
  c.checked = decodeAskOn();
  c.addEventListener('change', () => decodeAskSet(c.checked));
})();

let decodeTipOpen = null;   // the pending card's resolver, so a second file picked while it is up replaces it
async function decodeTipAsk(file) {
  // asked before the picker opened (build 270): counts once, for the next file, and only for a while (a picker left open
  // and cancelled must not stop a photo dropped in later from being asked about)
  const askedFirst = decodeAskedFirst && Date.now() - decodeAskedFirst < 10 * 60 * 1000; decodeAskedFirst = 0;
  let ext = ((file && file.name || '').split('.').pop() || '').toUpperCase();
  /* Build 268: Android's picker (the installed app especially) often names a file just "image", so a RAW went past this
     card unasked. Unknown names are identified from their first bytes, the same way loadFile does it. */
  if (!RAW_EXT.includes(ext) && !TIFF_EXT.includes(ext) && !IMG_EXT.includes(ext) && typeof sniffFileExt === 'function') {
    try { ext = (await sniffFileExt(file)) || ext; } catch (e) {}
  }
  if (!RAW_EXT.includes(ext) || !decodeAskOn()) return true;
  if ((typeof sessionRestoring !== 'undefined' && sessionRestoring) || window.__keepEditsOnLoad || window.__selftestRunning) return true;
  if (askedFirst) return true;
  return decodeTipCard(file.name, 'Open');
}
/* Build 270: the card comes up when Open photo (or New image) is tapped, BEFORE the file picker opens, so the decode is
   settled before a photo is chosen. Open there opens the picker; Cancel opens nothing. A file dropped or shared in has
   no picker, so it is still asked about once it arrives (decodeTipAsk above). JPEGs and PNGs ignore the choices. */
var decodeAskedFirst = 0;   // when the card was last answered before a picker opened
(function () {
  ['fi', 'fi2'].forEach(id => {
    const inp = $(id); if (!inp) return;
    let pass = false;
    const ask = e => {
      if (pass) { pass = false; return; }
      if (!decodeAskOn() || window.__selftestRunning) return;
      e.preventDefault(); e.stopPropagation();
      decodeTipCard(null, 'Choose photo').then(ok => {
        if (!ok) return;
        decodeAskedFirst = Date.now(); pass = true;
        inp.click();   // still inside the tap on Choose photo, so the browser lets the picker open
        setTimeout(() => { pass = false; }, 1000);
      });
    };
    /* Build 271: caught on the label that wraps the input as well as on the input. On Android (the installed app in
       particular) a tap on the label could open the picker without the cancellable click on the input this relied on,
       so the card never showed. Stopping the label's own click stops it from reaching the input at all. */
    const lab = inp.closest('label');
    if (lab) lab.addEventListener('click', e => { if (e.target === inp) return; ask(e); }, true);
    inp.addEventListener('click', ask, true);   // programmatic clicks, and anything that reaches the input directly
  });
})();
function decodeTipCard(fileName, okLabel) {
  if (decodeTipOpen) decodeTipOpen(false);
  return new Promise(resolve => {
    const q = $('cr2PreferPreview');
    let dm = typeof demosaicPref === 'function' ? demosaicPref() : 'amaze';
    let quick = !!(q && q.checked);
    const box = document.createElement('div');
    box.id = 'decodeTip'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'decodeTipT');
    box.innerHTML =
        '<p id="decodeTipT">' + (fileName ? 'How should this RAW be decoded?' : 'How should RAW photos be decoded?') + '</p>'
      + '<p class="dtFile noTr"></p>'
      + '<div class="dtRow"><span class="dtLbl">Colour rebuild</span><div class="dtSeg" data-k="dm">'
      +   '<button type="button" data-v="amaze">AMaZE</button><button type="button" data-v="rcd">RCD</button></div></div>'
      + '<p class="dtHint">AMaZE keeps the finest detail. RCD is a little softer and cleaner on noisy files.</p>'
      + '<div class="dtRow"><span class="dtLbl">Decode</span><div class="dtSeg" data-k="q">'
      +   '<button type="button" data-v="0">Full sensor</button><button type="button" data-v="1">Quick preview</button></div></div>'
      + '<p class="dtHint">Full sensor uses every pixel the camera recorded. Quick preview uses the small JPEG inside the file: faster, with fewer RAW-only tools.</p>'
      + '<p class="dtHint">You can change these later on the start page, or under Export, Decode settings, in Advanced.</p>'
      + '<label class="dtNever"><input type="checkbox"> Don\u2019t ask again</label>'
      + '<div class="dtBtns"><button type="button" class="dtCancel">Cancel</button><button type="button" class="dtOk">Open</button></div>';
    box.querySelector('.dtFile').textContent = fileName || 'Only matters for RAW files; a JPEG or PNG opens as it is.';
    box.querySelector('.dtOk').textContent = okLabel || 'Open';
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
        if (box.querySelector('.dtNever input').checked) decodeAskSet(false);   // only an Open counts; Cancel changes nothing
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
