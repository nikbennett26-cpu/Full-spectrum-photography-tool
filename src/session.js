'use strict';
/* irlab editor: js/session.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- minimal store-only ZIP writer ----------

   No compression, deliberately. Every format this exports — JPEG, PNG, and
   TIFF carrying already-quantised image data — is either compressed already
   or incompressible, so DEFLATE would cost seconds per file and megabytes of
   library for savings in the low single-digit percent. "Stored" entries are
   a handful of byte-packed headers and are read by every unzip tool there is.

   ZIP32 only: fine below 4 GB total, which a batch of stills will not reach. */

// crc32() is defined further down for PNG chunk writing; the ZIP format uses
// the identical polynomial, so it is reused rather than duplicated here.


// MS-DOS packed date/time, which is what the ZIP format stores
function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

function buildZip(entries) {
  const enc = new TextEncoder();
  const now = dosDateTime(new Date());
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = e.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);      // local file header signature
    lv.setUint16(4, 20, true);              // version needed
    lv.setUint16(6, 0x0800, true);          // flag: filename is UTF-8
    lv.setUint16(8, 0, true);               // method 0 = stored
    lv.setUint16(10, now.time, true);
    lv.setUint16(12, now.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);    // compressed size
    lv.setUint32(22, data.length, true);    // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);              // extra field length
    local.set(nameBytes, 30);

    parts.push(local, data);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);      // central directory signature
    cv.setUint16(4, 20, true);              // version made by
    cv.setUint16(6, 20, true);              // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, now.time, true);
    cv.setUint16(14, now.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);         // offset of local header
    cen.set(nameBytes, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);        // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return [...parts, ...central, end];
}

/* ---------- batch ----------

   Runs entirely off-screen on its own WebGL context. The visible preview,
   the loaded image and every slider are untouched, so a batch can be started
   without losing the state you are in the middle of.

   Strictly sequential. Decoding, uploading and reading back several
   multi-megapixel frames at once is the quickest way to have a phone kill
   the tab, and the work is GPU-bound anyway so concurrency buys nothing. */
let batchRunning = false;

function batchDecode(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode failed')); };
    im.src = url;
  });
}

function safeName(name, ext) {
  const base = (name.replace(/\.[^.]+$/, '') || 'image').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  return base + '_irswap.' + ext;
}

async function runBatch(fileList) {
  if (batchRunning) return;
  const files = Array.from(fileList || []);
  if (!files.length) return;
  batchRunning = true;

  const prog = $('batchProgress'), bar = $('batchBarInner'), status = $('batchStatus');
  prog.style.display = 'block';
  const fmt = document.querySelector('input[name=fmt]:checked').value;
  const ext = fmt === 'tiff16' ? 'tif' : fmt === 'png' ? 'png' : 'jpg';
  const params = exportParams();
  const xmp = buildXmpPacket();   // build 158: the same filter-stack record as a single export

  /* Every finished file is held in memory until the whole batch is zipped —
     a zip has to be built in one piece, so there is nowhere to put them in
     the meantime. At full size a 16-bit TIFF is about 100 MB, so ten of them
     is a gigabyte held at once, which a phone cannot survive: the tab dies
     partway through and everything already processed is lost with it.
     Warned about up front rather than discovered at file seven, and the
     estimate uses the ACTUAL pixel count of the loaded image where there is
     one, since guessing full-frame for a batch of small files would nag for
     no reason. */
  const perFileMB = (fmt === 'tiff16' ? 6 : fmt === 'png' ? 2 : 0.6) *
                    ((origW && origH ? origW * origH : 5184 * 3456) / 1048576);
  const projectedMB = perFileMB * files.length;
  if (projectedMB > 400) {
    const ok = await askConfirm('Large batch', (
      'This batch needs roughly ' + Math.round(projectedMB) + ' MB of memory, because every file has to be held until the .zip is built.\n\n' +
      'On a phone that is likely to crash the tab and lose the whole run.\n\n' +
      (fmt === 'tiff16' ? 'Switching Export format to JPEG or PNG cuts it dramatically, or split' : 'Split') +
      ' this into smaller batches.\n\nCarry on anyway?'), 'Carry on');
    if (!ok) { prog.style.display = 'none'; batchRunning = false; return; }
  }

  const canvas = document.createElement('canvas');
  let eng = null, entries = [], failed = [];

  try {
    eng = new WebGLEngine(canvas);
    eng.setLUT(currentLUT); eng.setLUTPre(preLUTUser || decodeFilmLUT());
    const maxTex = eng.gl.getParameter(eng.gl.MAX_TEXTURE_SIZE);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      status.textContent = 'Processing ' + (i + 1) + ' of ' + files.length + ' — ' + f.name;
      bar.style.width = (i / files.length * 100) + '%';
      // yield to the browser so the progress bar actually paints between files
      await new Promise(r => setTimeout(r, 0));

      try {
        let src = f;
        const fext = (f.name.split('.').pop() || '').toUpperCase();
        // Single-image loading already used AMaZE for every RAW format, not
        // just CR2; batch previously only tried a real decode for CR2 (via
        // the now-removed native decoder) and silently used the embedded
        // preview for everything else. Now consistent with single-image
        // loading: AMaZE for any RAW format, unless the preview box is
        // ticked or AMaZE genuinely can't run in this browser.
        const preferPreview = $('cr2PreferPreview') && $('cr2PreferPreview').checked;
        if ((CR2_EXT.includes(fext) || RAW_EXT.includes(fext)) && !preferPreview && rawEngine.supported()) {
          /* Build 218: decoding a RAW sets the engine's state for "the photo that is open" (its sensor data, the white
             balance it was built with, its float twin, body.rawOpen). Batch used to leave the LAST batch file there, so
             the next full-size export or rebuild of the open photo used a different picture. Saved and put back. The
             grey-world auto white balance that used to run here wrote the open photo's preWBM and never reached the
             batch output (params are read once above), so it is gone. */
          const keep = { lr: rawEngine.lastResult, lg: rawEngine.lastGen, nr: rawEngine.nrPrev, bk: rawEngine.builtKey,
            bwk: rawEngine.builtWbKey, aw: rawEngine.autoWb, built: rawWbBuilt, llf: LAST_LINEAR_FLOAT,
            rawOpen: document.body.classList.contains('rawOpen') };
          try {
            const res = await rawEngine.demosaic(demosaicPref(), f);
            const cv2 = rawEngineResultToCanvas(res, false, null, null, true);   // build 218: full size, as a single export is
            src = await new Promise(r => cv2.toBlob(r, 'image/png'));
          } catch (e) {
            console.warn('Batch: AMaZE decode failed for ' + f.name + ', using embedded preview:', e);
            const found = await extractPreview(f);
            if (!found) throw new Error('no usable data in this file');
            src = found.blob;
          } finally {
            rawEngine.lastResult = keep.lr; rawEngine.lastGen = keep.lg; rawEngine.nrPrev = keep.nr; rawEngine.builtKey = keep.bk;
            rawEngine.builtWbKey = keep.bwk; rawEngine.autoWb = keep.aw; rawWbBuilt = keep.built; LAST_LINEAR_FLOAT = keep.llf;
            document.body.classList.toggle('rawOpen', keep.rawOpen);
          }
        } else if (CR2_EXT.includes(fext) || RAW_EXT.includes(fext)) {
          const found = await extractPreview(f);
          if (!found) throw new Error('no embedded preview');
          src = found.blob;
        }
        const im = await batchDecode(src);
        let w = im.naturalWidth, h = im.naturalHeight;
        // an image past the GPU's texture limit is scaled to fit rather than
        // skipped — a slightly smaller file beats a missing one
        const over = Math.max(w, h) / maxTex;
        if (over > 1) { w = Math.round(w / over); h = Math.round(h / over); }

        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        tmp.getContext('2d').drawImage(im, 0, 0, w, h);

        eng.setImage(tmp);
        let px = eng.renderHiPrec(params);
        if (!px) { eng.render(params); px = eng.readPixels(); }
        ({ px, w, h } = applyCropToPixels(px, w, h));   // same crop for every file in the batch

        let blob;
        if (fmt === 'tiff16') {
          blob = await encodeTIFF16(px, w, h, false, xmp);
        } else {
          const oc = document.createElement('canvas');
          oc.width = w; oc.height = h;
          const id = oc.getContext('2d').createImageData(w, h);
          id.data.set(px instanceof Uint16Array ? quantize8(px, w, h) : px);
          oc.getContext('2d').putImageData(id, 0, 0);
          blob = await new Promise(r => oc.toBlob(r, fmt === 'png' ? 'image/png' : 'image/jpeg', fmt === 'jpeg' ? 1.0 : undefined));
          if (xmp) {
            const b0 = new Uint8Array(await blob.arrayBuffer());
            blob = new Blob([fmt === 'png' ? spliceXmpIntoPngBytes(b0, xmp) : spliceXmpIntoJpegBytes(b0, xmp)], { type: blob.type });
          }
        }
        entries.push({ name: safeName(f.name, ext), data: new Uint8Array(await blob.arrayBuffer()) });
      } catch (err) {
        failed.push(f.name);
      }
    }

    if (!entries.length) { toast('Nothing could be processed'); return; }

    status.textContent = 'Building archive\u2026';
    bar.style.width = '100%';
    await new Promise(r => setTimeout(r, 0));

    const zip = new Blob(buildZip(entries), { type: 'application/zip' });
    deliverBlob(zip, 'irswap_batch_' + Date.now() + '.zip');   // a batch always outlasts the tap, so this usually asks
    status.textContent = entries.length + ' file' + (entries.length === 1 ? '' : 's') + ' exported' +
      (failed.length ? ' \u2014 ' + failed.length + ' skipped: ' + failed.slice(0, 3).join(', ') + (failed.length > 3 ? '\u2026' : '') : '');
  } catch (err) {
    status.textContent = 'Batch failed: ' + err.message;
  } finally {
    // free the extra context immediately; browsers allow only a handful
    if (eng) { const lc = eng.gl.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext(); }
    entries = null;
    batchRunning = false;
  }
}

/* Reports a setup failure where it can actually be read: on the page, with
   the real message and the first line of the stack. There is no console on a
   phone, and an installed PWA has no address bar to reach one. */
function showLoadError(err) {
  const msg = (err && (err.message || String(err))) || 'unknown error';
  const where = (err && err.stack ? String(err.stack).split('\n')[1] || '' : '').trim();
  let box = document.getElementById('loadErrBox');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'loadErrBox';
    box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:400;max-height:50vh;overflow:auto;' +
      'white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:11px;' +
      'line-height:1.5;color:#ffd9cf;background:rgba(40,8,4,.97);border:1px solid #c2431b;border-radius:4px;padding:10px;margin:0';
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  }
  box.textContent = 'Preview setup failed\n\n' + msg + (where ? '\n' + where : '') +
    '\n\nWebGL2: ' + (!!document.createElement('canvas').getContext('webgl2')) +
    '\nWebGL1: ' + (!!document.createElement('canvas').getContext('webgl')) +
    '\nonline: ' + navigator.onLine +
    '\n\n(tap to dismiss)';
}

/* ---------- session persistence ----------

   Mobile browsers discard background tabs under memory pressure, and this
   page is an expensive tab to keep alive: a WebGL context plus two
   full-size canvases. Open the filter database, come back, and Chrome has
   often thrown the whole thing away and reloaded from the landing screen
   with the image gone. Opening the calculator in a new tab does not help,
   because it is the BACKGROUNDED tab that gets discarded.

   So the source image and the settings are written to IndexedDB. Nothing
   leaves the device — IndexedDB is per-origin local storage, the same as the
   rest of the tool's privacy model.

   Restoring is offered rather than automatic: silently reopening someone's
   last photo when they came back to start a new one would be worse than the
   problem it solves. */
const SESSION_DB = 'irlab', SESSION_STORE = 'session';
function idb() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('no indexedDB'));
    const rq = indexedDB.open(SESSION_DB, 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains(SESSION_STORE)) d.createObjectStore(SESSION_STORE);
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbPut(key, val) {
  try {
    const d = await idb();
    await new Promise((res, rej) => {
      const tx = d.transaction(SESSION_STORE, 'readwrite');
      tx.objectStore(SESSION_STORE).put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) { /* private mode, quota, unsupported — persistence is a bonus */ }
}
async function idbGet(key) {
  try {
    const d = await idb();
    return await new Promise((res, rej) => {
      const tx = d.transaction(SESSION_STORE, 'readonly');
      const rq = tx.objectStore(SESSION_STORE).get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  } catch (e) { return undefined; }
}

let sessionSaveTimer = null;
function saveSessionState() {
  if (SELFTEST) return;
  // debounced: a slider drag would otherwise write on every frame
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    if (!loadedImage) return;
    try { idbPut('state', { state: captureState(), ts: Date.now() }); } catch (e) {}
  }, 800);
}
function saveSessionImage(blob, name) {
  if (SELFTEST) return;
  // the SOURCE blob, not the rendered canvas: restoring then runs the normal
  // load path, so there is no re-encoding and no quality loss
  idbPut('image', { blob: blob, name: name || 'image', ts: Date.now() });
}

async function restoreSession(rec) {
  /* loadToken is bumped once per loadFile() call (see loadFile's own
     stale() closure). Snapshot it BEFORE awaiting anything here: if the
     user picks a real file of their own while this auto-restore is still
     in flight -- entirely possible, since this runs unattended in the
     background on every page load -- loadFile() bumps loadToken again for
     their pick. Comparing after both awaits tells us whether we're still
     the most recent request.

     Without this, applyState(st.state) ran unconditionally afterward
     regardless of what had happened in the meantime: a restored look from
     up to 30 minutes ago could land on top of a brand-new image the user
     had just picked themselves, appearing as an unexplained single undo
     entry and a colour cast on a file that should have opened untouched. */
  sessionRestoring = true;
  try { await restoreSessionInner(rec); } finally { sessionRestoring = false; }
  // a look opened from a shared link goes on top of the restored photo (src/share.js)
  if (typeof applyPendingLook === 'function') applyPendingLook();
}
var sessionRestoring = false;
async function restoreSessionInner(rec) {
  const myToken = loadToken;
  const st = await idbGet('state');
  if (myToken !== loadToken) return;   // the person picked a photo themselves while the saved one was being read
  const loading = loadFile(new File([rec.blob], rec.name || 'restored.jpg', { type: rec.blob.type || 'image/jpeg' }));
  /* loadFile bumps loadToken synchronously, as its very first act, so the token to compare against is the one it
     just made, taken right after calling it. This used to compare with the value from BEFORE the call, which is
     never equal afterwards, so the check always said "someone else loaded something" and returned: the photo
     came back after a reload, but none of its edits ever did. */
  const mine = loadToken;
  await loading;
  if (mine !== loadToken) return;   // a newer load (the user's own pick) has since started
  // settings applied after the image, since applyState triggers a render
  if (st && st.state) { try { applyState(st.state); } catch (e) {} }
}

/* Recent sessions come back automatically; older ones are offered.

   The distinction is what the person is most likely to be doing. Coming back
   from the filter calculator a minute later, they never meant to leave — the
   tab was discarded out from under them, and being asked to press a button to
   undo something they didn't do is just the same interruption with an extra
   step. Opening the tool the next morning is a different intention entirely,
   and silently reopening yesterday's photo would be presumptuous.

   Thirty minutes is the cutoff, and an automatic restore always says so and
   offers a way out, so it is never a surprise you cannot undo. */
const SESSION_AUTO_MS = 30 * 60 * 1000;

async function offerSessionRestore() {
  const rec = await idbGet('image');
  if (!rec || !rec.blob) return;
  const age = Date.now() - (rec.ts || 0);

  if (age < SESSION_AUTO_MS) {
    await restoreSession(rec);
    toast('Picked up where you left off \u2014 use New image to start fresh');
    haptic('confirm');
    return;
  }

  const wrap = $('restoreSlot') || $('landingLinks');
  if (!wrap) return;
  const mins = Math.round(age / 60000);
  const when = mins < 90 ? mins + ' min ago' : Math.round(mins / 60) + ' h ago';
  const btn = document.createElement('button');
  btn.id = 'btnRestore';
  btn.type = 'button';
  btn.innerHTML = '<span>\u21ba Restore</span><span class="rsWhen">' + when + '</span>';
  btn.setAttribute('aria-label', 'Restore last image (' + when + ')');
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Restoring\u2026';
    await restoreSession(rec);
  };
  wrap.insertBefore(btn, wrap.firstChild);
}

/* Invoked HERE, immediately after its own definitions, not earlier in the
   file. Function declarations hoist, so calling it near the top looked fine —
   but SESSION_DB and SESSION_STORE are `const`, and a const is in the
   temporal dead zone until its declaration is reached. Opening the database
   therefore threw on every load, and the try/catch that exists to tolerate
   private mode swallowed it and reported "no saved session". The restore
   never ran, and nothing anywhere said so. */
if (!SELFTEST) offerSessionRestore();

/* Build 130: on a phone, or in the installed app, the filter database opens in this window instead of a new one. A
   new window from the installed app starts a second copy of the app, which could hang on its launch screen. The
   photo and edits are saved right away (not after the usual short pause), and coming back within 30 minutes picks
   them up automatically (offerSessionRestore above). On a desktop browser the link still opens a new tab. */
(function filtersSameWindow() {
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const narrow = () => document.documentElement.classList.contains('dockOn');
  ['filterDbBtn', 'lnkFilters', 'lnkFilters2'].forEach(id => {
    const a = $(id); if (!a) return;
    a.addEventListener('click', async e => {
      if (!(standalone() || narrow())) return;     // desktop browser: the new tab is fine
      e.preventDefault();
      if (loadedImage && !SELFTEST) {
        if (sessionSaveTimer) { clearTimeout(sessionSaveTimer); sessionSaveTimer = null; }
        try { await idbPut('state', { state: captureState(), ts: Date.now() }); } catch (err) {}
        try { const rec = await idbGet('image'); if (rec) await idbPut('image', Object.assign({}, rec, { ts: Date.now() })); } catch (err) {}
      }
      location.href = a.getAttribute('href');
    });
  });
})();

/* Build 114: the White Balance header shows what is set (auto, picked, or Auto tone's gains) so the card can stay closed. */
(function wbHeaderSummary() {
  const out = $('wbSum'), pre = $('wbPreStatus'), post = $('wbPostStatus'); if (!out || !pre || !post) return;
  const short = t => {
    t = (t || '').trim();
    if (!t || /not set/i.test(t)) return '';
    if (/eigenvector|auto/i.test(t) && !/R:/.test(t)) return 'auto';
    const m = t.match(/R:\s*([\d.]+)\s*G:\s*([\d.]+)\s*B:\s*([\d.]+)/);
    if (m) return 'R ' + m[1] + ' G ' + m[2] + ' B ' + m[3];
    if (/set|bradford|manual/i.test(t)) return 'picked';
    return '';
  };
  const upd = () => { const a = short(pre.textContent), b = short(post.textContent);
    out.textContent = [a && ('before: ' + a), b && ('after: ' + b)].filter(Boolean).join(' · '); };
  const mo = new MutationObserver(upd);
  [pre, post].forEach(e => mo.observe(e, { childList: true, characterData: true, subtree: true }));
  upd();
})();


/* Build 116: the slim White Balance rows show a short state taken from the full status lines. */
(function wbRowShort() {
  const pairs = [['wbPreStatus', 'wbPreShort'], ['wbPostStatus', 'wbPostShort']];
  const short = t => {
    t = (t || '').trim();
    if (!t || /not set/i.test(t)) return '';
    const m = t.match(/R:\s*([\d.]+)\s*G:\s*([\d.]+)\s*B:\s*([\d.]+)/);
    if (m) return 'auto \u2713 R ' + m[1] + ' G ' + m[2] + ' B ' + m[3];
    const how = (t.match(/\(([^)]+)\)/) || [])[1];
    if (/eigenvector|auto/i.test(t)) return 'auto \u2713';
    return how ? how + ' \u2713' : 'set \u2713';
  };
  pairs.forEach(([src, dst]) => {
    const a = $(src), b = $(dst); if (!a || !b) return;
    const upd = () => { const v = short(a.textContent); b.textContent = v || ((I18N[uiLang] || I18N.en).notSet || 'not set'); b.closest('.wbRow')?.classList.toggle('on', !!v); };
    new MutationObserver(upd).observe(a, { childList: true, characterData: true, subtree: true });
    upd();
  });
})();

/* Build 113: keep the folded Channel gains line showing the three values, whichever way they change (a drag, Auto tone,
   undo, a reset), by watching the readouts the sliders already keep up to date. */
(function wbGainsSummary() {
  const out = $('wbGainsSum'), ids = ['v_autoGainR', 'v_autoGainG', 'v_autoGainB'];
  if (!out || ids.some(id => !$(id))) return;
  const upd = () => { out.textContent = ids.map(id => $(id).textContent).join(' · '); };
  const mo = new MutationObserver(upd);
  ids.forEach(id => mo.observe($(id), { childList: true, characterData: true, subtree: true }));
  upd();
})();
