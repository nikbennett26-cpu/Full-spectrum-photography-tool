/* ---------- Sharing (build 139) ----------
   Three things, all in the Export section:
   1. Share: the edited photo as a full-quality JPEG, handed to the phone's own share sheet, which is where Instagram,
      Facebook, WhatsApp and the rest live. (Facebook's web "sharer" only takes links, and Instagram has none at all, so
      the share sheet is the only route that carries the actual picture.) Where the browser cannot share files, the
      JPEG is saved instead.
   2. Before | after: the original and the edit in one picture, side by side for an upright photo and one above the
      other for a wide one, so the result stays a sensible shape for a feed. Shared the same way.
   3. Look link: the current look (swap, colour, tone, detail, post-swap white balance: the same things a saved preset
      keeps) packed into a link. Opening the link applies the look to the next photo and keeps it in My presets. */

/* the edited photo at working size, cropped, as a canvas */
function shareAfterCanvas() {
  const ep = exportParams();
  let px = engine.renderHiPrec(ep), w = $('preview').width, h = $('preview').height;
  if (!px) { engine.render(ep); px = engine.readPixels(); }
  render();
  ({ px, w, h } = applyCropToPixels(px, w, h));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const id = c.getContext('2d').createImageData(w, h);
  id.data.set(px instanceof Uint16Array ? quantize8(px, w, h) : px);
  c.getContext('2d').putImageData(id, 0, 0);
  return c;
}
/* the photo as it came in, the same size and crop as the edit */
function shareBeforeCanvas(w0, h0) {
  const src = rawCanvas, c = document.createElement('canvas');
  c.width = w0; c.height = h0;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0, w0, h0);
  let px = x.getImageData(0, 0, w0, h0).data, w = w0, h = h0;
  ({ px, w, h } = applyCropToPixels(px, w, h));
  const o = document.createElement('canvas'); o.width = w; o.height = h;
  const id = o.getContext('2d').createImageData(w, h); id.data.set(px); o.getContext('2d').putImageData(id, 0, 0);
  return o;
}
function shareTr(en) { return (window.irlabTr && irlabTr.lang !== 'en' && irlabTr.lookup(en)) || en; }
function beforeAfterCanvas() {
  const after = shareAfterCanvas();
  const before = shareBeforeCanvas($('preview').width, $('preview').height);
  const w = after.width, h = after.height, wide = w > h * 1.05;
  const gap = Math.round(Math.max(w, h) * 0.008);
  const c = document.createElement('canvas');
  c.width = wide ? w : w * 2 + gap; c.height = wide ? h * 2 + gap : h;
  const x = c.getContext('2d');
  x.fillStyle = '#0b0c0e'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(before, 0, 0, w, h);
  const ax = wide ? 0 : w + gap, ay = wide ? h + gap : 0;
  x.drawImage(after, ax, ay);
  // small labels in the top-left corner of each half
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.035)), pad = Math.round(fs * 0.6);
  x.font = '700 ' + fs + 'px ui-monospace, Menlo, Consolas, monospace'; x.textBaseline = 'top';
  [[shareTr('Before').toUpperCase(), 0, 0], [shareTr('After').toUpperCase(), ax, ay]].forEach(([t, ox, oy]) => {
    const tw = x.measureText(t).width;
    x.fillStyle = 'rgba(5,5,6,.72)'; x.fillRect(ox + pad, oy + pad, tw + pad * 2, fs + pad * 1.2);
    x.fillStyle = '#eceae4'; x.fillText(t, ox + pad * 2, oy + pad * 1.6);
  });
  return c;
}
const canvasJpeg = c => new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.95));

/* Hand a file to the share sheet. A share must start from a tap; building the file can take long enough on a slow
   phone that the browser no longer counts it as one, so if it refuses, a small dialog offers a fresh tap. */
async function shareFile(blob, name) {
  const file = new File([blob], name, { type: 'image/jpeg' });
  const can = navigator.canShare && navigator.share && navigator.canShare({ files: [file] });
  if (!can) { deliverBlob(blob, name); toast('Sharing is not available here — the file was saved instead'); return; }
  try { await navigator.share({ files: [file] }); haptic('confirm'); }
  catch (e) {
    if (e && e.name === 'AbortError') return;   // closed the share sheet
    if (e && e.name === 'NotAllowedError') {
      if (await askConfirm('Ready to share', '', 'Share')) {
        try { await navigator.share({ files: [file] }); haptic('confirm'); } catch (e2) { if (!e2 || e2.name !== 'AbortError') deliverBlob(blob, name); }
      }
      return;
    }
    deliverBlob(blob, name);
  }
}
async function runShare(btn, build, name) {
  if (!engine || !loadedImage) { toast('Load an image first'); return; }
  if (btn.disabled) return;
  btn.disabled = true; btn.classList.add('busy');
  try {
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    const blob = await canvasJpeg(build());
    if (!blob) throw new Error('no image');
    let buf = new Uint8Array(await blob.arrayBuffer());
    if (exifSegment) { try { buf = spliceExifIntoJpegBytes(buf, normalizeExifOrientation(exifSegment)); } catch (e) {} }
    await shareFile(new Blob([buf], { type: 'image/jpeg' }), name + '-' + Date.now() + '.jpg');
  } catch (e) { toast('Something failed: ' + String(e && e.message || e).slice(0, 90), true); }
  finally { btn.disabled = false; btn.classList.remove('busy'); }
}
if ($('bShare')) $('bShare').onclick = () => runShare($('bShare'), shareAfterCanvas, 'irlab');
if ($('bPair')) $('bPair').onclick = () => runShare($('bPair'), beforeAfterCanvas, 'irlab-before-after');

/* ---------- look links ----------
   #look=<code>. The code is the look as compact JSON (only what differs from a fresh start), deflated and written in
   URL-safe base64, prefixed "z". Browsers without CompressionStream write it undeflated, prefixed "j". */
const LOOK_ROUND = v => Math.round(v * 1e5) / 1e5;
function lookDefault(id) {
  if (typeof sliderDefaults !== 'undefined' && id in sliderDefaults) return +sliderDefaults[id];
  const el = $(id); return el ? +el.defaultValue || 0 : 0;
}
function packLook() {
  const L = captureLookForUserPreset(), o = { v: 1, u: 4 };   // u: slider-weight version (4 = Temperature/Tint on their curve, build 190)
  const ident = L.m.every((v, i) => v === ((i % 4 === 0) ? 100 : 0));
  if (!ident) o.m = L.m;
  if (L.mOff.some(v => v)) o.o = L.mOff;
  const s = {};
  Object.keys(L.sliders).forEach(id => { if (L.sliders[id] !== lookDefault(id)) s[id] = L.sliders[id]; });
  if (Object.keys(s).length) o.s = s;
  if (L.targetedBands.length) o.b = L.targetedBands;
  if (L.filmOn) o.f = 1;
  if (L.filmToneOn) o.t = 1;
  if (L.postWBM.some((v, i) => Math.abs(v - IDENTITY3[i]) > 1e-6)) { o.w = L.postWBM.map(LOOK_ROUND); o.g = L.postWB.map(LOOK_ROUND); }
  return o;
}
function unpackLook(o) {
  if (!o || o.v !== 1) throw new Error('not a look');
  const sliders = {};
  USER_PRESET_SLIDER_IDS.forEach(id => { if ($(id)) sliders[id] = (o.s && id in o.s) ? +o.s[id] : lookDefault(id); });
  return {
    tv: o.u >= 4 ? 4 : 3,   // a link made before build 190 holds Temperature/Tint as effects
    m: Array.isArray(o.m) ? o.m.map(Number) : MCELLS.map((_, i) => (i % 4 === 0) ? 100 : 0),
    mOff: Array.isArray(o.o) ? o.o.map(Number) : MOFFCELLS.map(() => 0),
    sliders,
    targetedBands: Array.isArray(o.b) ? o.b : [],
    filmOn: !!o.f, filmToneOn: !!o.t,
    postWB: Array.isArray(o.g) ? o.g.map(Number) : [1, 1, 1],
    postWBM: Array.isArray(o.w) && o.w.length === 9 ? o.w.map(Number) : [...IDENTITY3],
  };
}
const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
async function streamThrough(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
async function encodeLook(o) {
  const raw = new TextEncoder().encode(JSON.stringify(o));
  if (typeof CompressionStream === 'function') { try { return 'z' + b64u(await streamThrough(raw, new CompressionStream('deflate-raw'))); } catch (e) {} }
  return 'j' + b64u(raw);
}
async function decodeLook(code) {
  const kind = code[0], bytes = unb64u(code.slice(1));
  let raw;
  if (kind === 'z') raw = await streamThrough(bytes, new DecompressionStream('deflate-raw'));
  else if (kind === 'j') raw = bytes;
  else throw new Error('unknown look code');
  return JSON.parse(new TextDecoder().decode(raw));
}
async function lookLink() {
  const code = await encodeLook(packLook());
  return location.origin + location.pathname + '#look=' + code;
}
async function shareLook(btn) {
  if (btn) btn.disabled = true;
  try {
    const url = await lookLink();
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share) {
      try { await navigator.share({ title: 'irlab look', url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); haptic('confirm'); toast('Look copied — anyone with the link opens it in irlab'); }
    catch (e) { await askText('Copy this link', url, 'Done'); }
  } finally { if (btn) btn.disabled = false; }
}
if ($('bLookLink')) $('bLookLink').onclick = () => shareLook($('bLookLink'));
if ($('btnShareUserPreset')) $('btnShareUserPreset').onclick = () => shareLook($('btnShareUserPreset'));

/* opening a look link */
let pendingLook = null;
function applyPendingLook() {
  if (!pendingLook || !engine || !loadedImage) return;
  const look = pendingLook; pendingLook = null;
  try { applyUserPreset(look); toast('Look applied from the link'); } catch (e) { console.error(e); }
}
(async function readLookLink() {
  const m = /[#&]look=([A-Za-z0-9_-]+)/.exec(location.hash || '');
  if (!m) return;
  // take it out of the address bar, so a reload or a bookmark does not apply it again
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  let look;
  try { look = unpackLook(await decodeLook(m[1])); }
  catch (e) { console.warn('look link', e); toast('This look link could not be read', true); return; }
  // kept in My presets, so it is still there after this photo
  try {
    const presets = loadUserPresets(); let n = 1, name = 'Shared look';
    while (name in presets) name = 'Shared look ' + (++n);
    presets[name] = look; saveUserPresetsToStorage(presets); renderUserPresetButtons();
  } catch (e) {}
  if (document.body.classList.contains('has-image') && engine && loadedImage && !sessionRestoring) { pendingLook = look; applyPendingLook(); }
  else { pendingLook = look; toast('Look from the link saved to My presets — it goes on the next photo you open'); }
})();
