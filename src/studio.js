'use strict';
/* irlab editor: src/studio.js. One of the editor's scripts, joined into editor.js by tools/build.py (one shared global scope).

   Build 366: the left panel of the desktop studio (src/dock.js turns the studio on at 1100px and wider and calls
   studioLeftOn / studioLeftOff). Everything in it is the same controls and data the rest of the editor uses:

   - Spectrum: the filter picker (the card that used to open Looks, moved here whole, so it behaves exactly as before)
     and a chart of what the stack passes and what each sensor channel records behind it. The curves are the database's
     own measured curves, multiplied the way src/filter-wb.js and src/ir-leak.js do: channel = sensor x stack x sunlight.
   - What this stack does: plain readouts worked out from those same curves (where it cuts on, peak, UV, infrared) and
     how much of each channel's signal is UV, visible or infrared.
   - Source channels: the existing card, moved.
   - History: the undo stack as a list. The steps are the ones Undo and Redo already use; each is named by what changed
     against the step before it, and a click walks there with the same Undo and Redo buttons.
   - Aerochrome trichrome: opens the existing trichrome tool.
   Everything goes back where it came from when the window narrows. */
(function studioLeft() {
  const root = document.documentElement;
  let left = null, built = false, homes = {}, fileName = '';

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = v => (v >= 0.995 ? '100' : v >= 0.1 ? Math.round(v * 100) : v >= 0.01 ? (v * 100).toFixed(1) : v >= 0.001 ? (v * 100).toFixed(2) : '0') + '%';

  /* ---------- the spectrum ---------- */
  const SPEC_LO = 350, SPEC_HI = 1000;
  function sensorKey() {
    const d = fpData, names = Object.keys(d.sensors);
    const cam = (typeof irlCameraModel === 'function' ? irlCameraModel() : '') || '';
    const est = names.find(k => /^Canon 1200D/.test(k));
    if (est && /1200D|T5\b/i.test(cam)) return est;
    const sel = $('ffSensor');
    if (sel && sel.value && d.sensors[sel.value]) return sel.value;
    return names.find(k => /^Generic CMOS/.test(k)) || names[0];
  }
  function sensorLabel(k) { return k.replace(/\s*\(.*$/, '') + (/estimated/i.test(k) ? ' (estimated curve)' : /^Generic/.test(k) ? ' (generic curve)' : ''); }
  function wlRGB(l) {
    let r = 0, g = 0, b = 0;
    if (l >= 380 && l < 440) { r = -(l - 440) / 60; b = 1; } else if (l < 490) { g = (l - 440) / 50; b = 1; } else if (l < 510) { g = 1; b = -(l - 510) / 20; }
    else if (l < 580) { r = (l - 510) / 70; g = 1; } else if (l < 645) { r = 1; g = -(l - 645) / 65; } else if (l <= 700) { r = 1; }
    else if (l <= 1000) { r = Math.max(.25, 1 - (l - 700) / 400) * .72; }
    else r = .15;
    const f = l < 420 ? .35 + .65 * (l - 380) / 40 : l > 700 ? 1 : 1;
    return 'rgb(' + [r, g, b].map(v => Math.round(255 * Math.pow(Math.max(0, v) * Math.max(0, f), .8))).join(',') + ')';
  }
  function specCompute() {
    if (typeof fpData === 'undefined' || !fpData || !fpData.sensors) return null;
    const d = fpData, wl = ffWl(), n = wl.length, T = new Array(n).fill(1), stack = (typeof fpStack !== 'undefined' && fpStack) || [];
    stack.forEach(id => { const f = d.byId[id]; if (f && f[4]) f[4].forEach((t, i) => { T[i] *= t; }); });
    const key = sensorKey(), S = d.sensors[key], ill = ffIll(wl, 'sun');
    const E = ['R', 'G', 'B'].map(c => wl.map((_, i) => (S[c][i] || 0) * T[i] * ill[i]));
    const mean = (a, lo, hi) => { let s = 0, k = 0; wl.forEach((w, i) => { if (w >= lo && w <= hi) { s += a[i]; k++; } }); return k ? s / k : 0; };
    let peak = 0, pi = 0; wl.forEach((w, i) => { if (w >= SPEC_LO && w <= SPEC_HI && T[i] > peak) { peak = T[i]; pi = i; } });
    const half = peak * 0.5; let cuton = null, cutoff = null;
    if (peak > 0.01) {
      if (T[wl.indexOf(SPEC_LO)] < half) for (let i = 0; i < n; i++) if (wl[i] >= SPEC_LO && T[i] >= half) { cuton = wl[i]; break; }
      for (let i = pi; i < n; i++) if (wl[i] <= SPEC_HI && T[i] < half) { cutoff = wl[i]; break; }
    }
    const comp = E.map(e => { const u = e.reduce((s, v, i) => s + (wl[i] < 400 ? v : 0), 0), v = e.reduce((s, x, i) => s + (wl[i] >= 400 && wl[i] <= 700 ? x : 0), 0), ir = e.reduce((s, x, i) => s + (wl[i] > 700 ? x : 0), 0), t = u + v + ir || 1; return { uv: u / t, vis: v / t, ir: ir / t }; });
    return { wl, T, E, key, stack, peak, cuton, cutoff, uv: mean(T, SPEC_LO, 400), vis: mean(T, 400, 700), nir: mean(T, 700, SPEC_HI), comp,
      names: stack.map(id => (d.byId[id] && d.byId[id][1]) || id) };
  }
  function drawSpectrum(R) {
    const cv = $('stSpecCv'); if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 260, H = cv.clientHeight || 110;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const cs = getComputedStyle(cv), line = (cs.getPropertyValue('--st-hair') || '').trim() || 'rgba(255,255,255,.07)', dim = (cs.getPropertyValue('--st-dim') || '').trim() || '#a3a097';
    const padL = 2, padR = 2, top = 6, barH = 5, lab = 14, plotB = H - barH - lab - 3, plotH = plotB - top;
    const X = w => padL + (w - SPEC_LO) / (SPEC_HI - SPEC_LO) * (W - padL - padR);
    ctx.font = '10px ui-sans-serif,system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    [400, 500, 600, 700, 800, 900, 1000].forEach(w => { const x = Math.round(X(w)) + .5; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, plotB); ctx.stroke(); ctx.fillStyle = dim; ctx.textAlign = w === 1000 ? 'right' : 'center'; if (w % 200 === 0) ctx.fillText(String(w), w === 1000 ? W - 1 : x, H - 2); });
    ctx.beginPath(); ctx.moveTo(padL, plotB + .5); ctx.lineTo(W - padR, plotB + .5); ctx.stroke();
    const g = ctx.createLinearGradient(X(SPEC_LO), 0, X(SPEC_HI), 0);
    for (let w = SPEC_LO; w <= SPEC_HI; w += 25) g.addColorStop((w - SPEC_LO) / (SPEC_HI - SPEC_LO), wlRGB(w));
    ctx.fillStyle = g; ctx.fillRect(padL, plotB + 3, W - padL - padR, barH);
    const idx = []; R.wl.forEach((w, i) => { if (w >= SPEC_LO && w <= SPEC_HI) idx.push(i); });
    // the stack itself, filled
    if (R.stack.length) {
      ctx.beginPath(); ctx.moveTo(X(R.wl[idx[0]]), plotB);
      idx.forEach(i => ctx.lineTo(X(R.wl[i]), plotB - R.T[i] * plotH * .92));
      ctx.lineTo(X(R.wl[idx[idx.length - 1]]), plotB); ctx.closePath();
      ctx.fillStyle = 'rgba(194,67,27,.16)'; ctx.fill();
      ctx.beginPath(); idx.forEach((i, k) => { const x = X(R.wl[i]), y = plotB - R.T[i] * plotH * .92; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = '#c2431b'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    // what each channel records behind it
    let mx = 0; R.E.forEach(e => idx.forEach(i => { if (e[i] > mx) mx = e[i]; })); mx = mx || 1;
    const cols = ['#d63a3a', '#6fae7f', '#6f9fc7'];
    R.E.forEach((e, c) => {
      ctx.beginPath(); idx.forEach((i, k) => { const x = X(R.wl[i]), y = plotB - Math.min(1, e[i] / mx) * plotH * .92; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = cols[c]; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
    });
  }
  function specLead(R) {
    if (!R.stack.length) return 'No filters picked. The sensor sees UV, visible light and infrared just as it is.';
    const p = [];
    if (R.cuton && R.cuton >= 420) p.push('blocks light below about ' + R.cuton + ' nm'); else if (R.uv < 0.03) p.push('blocks UV');
    if (R.cutoff && R.cutoff < SPEC_HI) p.push('stops light above about ' + R.cutoff + ' nm');
    else if (R.nir > 0.5) p.push('passes infrared (average ' + pct(R.nir) + ')'); else if (R.nir < 0.03) p.push('blocks infrared');
    const name = R.names.length > 2 ? R.names.length + ' filters' : R.names.join(' + ');
    return '<b>' + esc(name) + '</b> ' + (p.length ? p.join(' and ') : 'passes most of the spectrum') + '.';
  }
  function renderSpecInfo(R) {
    const el = $('stSpecInfo'); if (!el) return;
    const cards = [['cuts on', R.cuton ? R.cuton + ' nm' : 'none'], ['peak', pct(R.peak)], ['UV', pct(R.uv)], ['infrared', pct(R.nir)]];
    const nm = ['R', 'G', 'B'], cl = ['#d63a3a', '#6fae7f', '#6f9fc7'];
    const irMost = R.comp.map((c, i) => c.ir > 0.5 ? nm[i] : null).filter(Boolean);
    el.innerHTML = '<p class="stLead">' + specLead(R) + '</p>' +
      '<div class="stCards">' + cards.map(c => '<div><small>' + c[0] + '</small><span>' + c[1] + '</span></div>').join('') + '</div>' +
      '<div class="stComp">' + R.comp.map((c, i) => '<div class="stCR"><b style="background:' + cl[i] + '"></b><span class="stCN">' + nm[i] + '</span>' +
        '<span class="stBar"><i class="u" style="width:' + (c.uv * 100).toFixed(1) + '%"></i><i class="v" style="width:' + (c.vis * 100).toFixed(1) + '%"></i><i class="r" style="width:' + (c.ir * 100).toFixed(1) + '%"></i></span>' +
        '<span class="stCP">' + pct(c.ir) + ' IR</span></div>').join('') + '</div>' +
      '<div class="stKey"><span><i class="u"></i>UV</span><span><i class="v"></i>visible</span><span><i class="r"></i>infrared</span><em>what each channel records</em></div>' +
      (irMost.length ? '<p class="stNote">Mostly infrared in the ' + irMost.join(' and ') + ' channel' + (irMost.length > 1 ? 's' : '') + ' on this sensor.</p>' : '');
    const sn = $('stSpecSensor'); if (sn) sn.textContent = 'Wavelength in nm · channels: ' + sensorLabel(R.key);
  }
  let specTimer = 0;
  function refreshSpectrum() {
    clearTimeout(specTimer);
    specTimer = setTimeout(() => {
      if (!built || !root.classList.contains('studioOn')) return;
      fpLoad().then(() => { const R = specCompute(); if (!R) return; drawSpectrum(R); renderSpecInfo(R); }).catch(() => {});
    }, 60);
  }

  /* ---------- history ---------- */
  const sliderName = id => { const v = $('v_' + id), l = v && v.closest('label'); const t = l && l.childNodes[0] ? l.childNodes[0].textContent.trim() : ''; return t || id; };
  function stepLabel(a, b) {
    if (!a) return 'Original';
    if (a.activePreset !== b.activePreset && b.activePreset) return 'Look: ' + b.activePreset;
    const diffs = [];
    HASH_SLIDERS.forEach((id, i) => { if (a.s && b.s && a.s[i] !== b.s[i]) diffs.push([id, b.s[i] > a.s[i] ? '↑' : '↓']); });
    if (diffs.length === 1) return sliderName(diffs[0][0]) + ' ' + diffs[0][1];
    if (diffs.length > 1 && diffs.length <= 3) return diffs.map(d => sliderName(d[0])).join(', ');
    if (diffs.length > 3) return 'Look or preset';
    if (JSON.stringify(a.m) !== JSON.stringify(b.m) || JSON.stringify(a.mOff) !== JSON.stringify(b.mOff)) return 'Channel swap';
    if (JSON.stringify(a.curves) !== JSON.stringify(b.curves)) return 'Tone curve';
    if (JSON.stringify(a.crop) !== JSON.stringify(b.crop)) return 'Crop';
    if (JSON.stringify(a.preWB) !== JSON.stringify(b.preWB) || JSON.stringify(a.postWB) !== JSON.stringify(b.postWB) || JSON.stringify(a.rawWb || null) !== JSON.stringify(b.rawWb || null)) return 'White balance';
    if (JSON.stringify(a.masks) !== JSON.stringify(b.masks)) return 'Mask';
    if (a.swapSpace !== b.swapSpace) return 'Swap space';
    if (JSON.stringify(a.irLeak) !== JSON.stringify(b.irLeak)) return 'IR leak';
    if (a.filmOn !== b.filmOn) return 'Film';
    return 'Edit';
  }
  const labelCache = new WeakMap();
  let histSig = '';
  function renderHistory() {
    const list = $('stHist'); if (!list || !built || !root.classList.contains('studioOn') || typeof captureState !== 'function') return;
    let cur; try { cur = captureState(); } catch (e) { return; }
    const states = [...undoStack, cur, ...redoStack.slice().reverse()], at = undoStack.length;
    const rows = states.map((s, i) => {
      let lab;
      if (i === 0) lab = 'Original';
      else if (i === at) lab = stepLabel(states[i - 1], s);
      else { lab = labelCache.get(s); if (!lab) { lab = stepLabel(states[i - 1], s); labelCache.set(s, lab); } }
      return lab;
    });
    const sig = rows.join('|') + '#' + at;
    if (sig === histSig) return; histSig = sig;
    list.innerHTML = rows.map((l, i) => '<button type="button" class="stHI' + (i === at ? ' on' : i > at ? ' fut' : '') + '" data-i="' + i + '"><i>' + i + '</i><span>' + esc(l) + '</span></button>').join('');
    const cnt = $('stHistN'); if (cnt) cnt.textContent = String(states.length - 1);
    const on = list.querySelector('.on'); if (on && on.scrollIntoView) { const lr = list.getBoundingClientRect(), or = on.getBoundingClientRect(); if (or.bottom > lr.bottom || or.top < lr.top) list.scrollTop += or.top - lr.top - lr.height / 2; }
  }
  function histJump(j) {
    const at = undoStack.length, u = $('btnUndo'), r = $('btnRedo');
    for (let k = 0; k < Math.abs(j - at); k++) { const b = j < at ? u : r; if (!b || b.disabled) break; b.click(); }
    histSig = ''; renderHistory();
  }

  /* ---------- the panel ---------- */
  const sec = (id, title, extra, body, open) => '<details class="stSec" id="' + id + '"' + (open ? ' open' : '') + '><summary class="stH"><span>' + title + '</span>' + (extra || '') + '</summary><div class="stB">' + body + '</div></details>';
  function park(el, key) {
    if (!el || homes[key]) return;
    const mark = document.createComment('studio:' + key); el.parentNode.insertBefore(mark, el); homes[key] = mark;
  }
  function unpark(el, key) {
    const mark = homes[key]; if (!mark || !el) return;
    if (mark.parentNode) mark.parentNode.insertBefore(el, mark); mark.remove(); delete homes[key];
  }
  function build() {
    left = document.createElement('aside'); left.id = 'studioLeft'; left.setAttribute('aria-label', 'Spectrum, channels and history');
    left.innerHTML =
      sec('stSecSpec', 'Spectrum', '', '<div id="stSpecPick"></div><canvas id="stSpecCv" aria-label="What the filter stack passes and what each sensor channel records behind it"></canvas>' +
        '<div class="stKey"><span><i class="f"></i>filters pass</span><span><i class="cr"></i>R</span><span><i class="cg"></i>G</span><span><i class="cb"></i>B</span></div><p class="stNote" id="stSpecSensor"></p>', true) +
      sec('stSecInfo', 'What this stack does', '', '<div id="stSpecInfo"><p class="stLead">Loading the filter data…</p></div>', true) +
      '<div id="stChanHome"></div>' +
      sec('stSecHist', 'History', '<span class="stN" id="stHistN">0</span>', '<div id="stHist" class="stHist" role="list"></div><div class="stBtns"><button type="button" id="stReset">Reset all</button></div>', true) +
      sec('stSecTri', 'Aerochrome trichrome', '', '<p class="stNote" style="margin:0 0 8px">Red Aerochrome from three shots: infrared, red-filter and green-filter.</p><button type="button" id="stTri" class="stWide">Open the trichrome tool</button>', true);
    document.body.appendChild(left);
    $('stHist').addEventListener('click', e => { const b = e.target.closest('.stHI'); if (b) histJump(+b.dataset.i); });
    $('stReset').addEventListener('click', () => { const b = $('bReset'); if (b) b.click(); });
    $('stTri').addEventListener('click', () => { const b = $('triStart'); if (b) b.click(); });
    const obs = new MutationObserver(renderHistory);
    [$('btnUndo'), $('btnRedo')].forEach(b => { if (b) obs.observe(b, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] }); });
    const fp = $('fpStack'); if (fp) new MutationObserver(refreshSpectrum).observe(fp, { childList: true, subtree: true });
    const fs = $('ffSensor'); if (fs) fs.addEventListener('change', refreshSpectrum);
    if (window.ResizeObserver) new ResizeObserver(refreshSpectrum).observe($('stSpecCv'));
    built = true;
  }
  /* ---------- hide the side panels to give the photo the whole stage ([ and ] too) ---------- */
  const PK = 'irlab.stPanels';
  function panelsLoad() { try { const o = JSON.parse(localStorage.getItem(PK) || '{}'); root.classList.toggle('stNoL', !!o.l); root.classList.toggle('stNoR', !!o.r); } catch (e) {} }
  function panelsSave() { try { localStorage.setItem(PK, JSON.stringify({ l: root.classList.contains('stNoL'), r: root.classList.contains('stNoR') })); } catch (e) {} }
  function panelToggle(side) { root.classList.toggle(side === 'l' ? 'stNoL' : 'stNoR'); panelsSave(); setTimeout(() => { window.dispatchEvent(new Event('resize')); refreshSpectrum(); }, 60); }
  function addToggles() {
    const ps = $('previewSticky'); if (!ps || $('stTogL')) return;
    const tb = document.querySelector('.toolbar');
    if (tb && !$('stHdrL')) [['l', 'stHdrL', 'Hide or show the left panel ( [ )', '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M8 3.5v13"/>'], ['r', 'stHdrR', 'Hide or show the right panel ( ] )', '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M12 3.5v13"/>']].forEach(a => {
      const b = document.createElement('button'); b.type = 'button'; b.id = a[1]; b.className = 'stHdrTog'; b.title = a[2]; b.setAttribute('aria-label', a[2]);
      b.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true">' + a[3] + '</svg>'; b.addEventListener('click', () => panelToggle(a[0])); tb.appendChild(b);
    });
    [['l', 'stTogL', 'Hide or show the left panel ( [ )', 'M7 2L3 5l4 3'], ['r', 'stTogR', 'Hide or show the right panel ( ] )', 'M3 2l4 3-4 3']].forEach(a => {
      const b = document.createElement('button'); b.type = 'button'; b.id = a[1]; b.className = 'stTog'; b.title = a[2]; b.setAttribute('aria-label', a[2]);
      b.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="' + a[3] + '"/></svg>'; b.addEventListener('click', () => panelToggle(a[0])); ps.appendChild(b);
    });
  }
  document.addEventListener('keydown', e => {
    if (!root.classList.contains('studioOn') || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target; if (t && t.closest && t.closest('input,textarea,select,[contenteditable]')) return;
    if (e.key === '[') { panelToggle('l'); e.preventDefault(); } else if (e.key === ']') { panelToggle('r'); e.preventDefault(); }
  });

  /* ---------- slider fill: from the centre on sliders that run both ways, from the left on the rest ---------- */
  function fillOne(el) {
    const mn = +el.min || 0, mx = el.max === '' ? 100 : +el.max, v = +el.value, span = mx - mn; if (!(span > 0)) return;
    const pos = (v - mn) / span * 100, c = mn < 0 && mx > 0 ? -mn / span * 100 : 0;
    const lo = Math.min(c, pos).toFixed(2), hi = Math.max(c, pos).toFixed(2);
    if (el.style.getPropertyValue('--lo') !== lo) el.style.setProperty('--lo', lo);
    if (el.style.getPropertyValue('--hi') !== hi) el.style.setProperty('--hi', hi);    /* build 394: a slider away from its starting value marks its row, so what has been edited shows at a glance */
    const row = el.closest('.sl'); if (row) row.classList.toggle('chg', Math.abs(v - (+el.defaultValue)) > 1e-9 && el.defaultValue !== '');
  }
  function fillAll() {
    const z = $('reorderZone'); if (!z) return;
    z.querySelectorAll('.sl:not(.wb) input[type=range]').forEach(fillOne);
    z.querySelectorAll('details.dGrp').forEach(g => {   // build 394: how many sliders in each group have been moved
      const t = g.querySelector(':scope > summary .dT'); if (!t) return;
      const n = g.querySelectorAll('.sl.chg').length, v = n ? String(n) : '';
      if ((t.dataset.chg || '') !== v) { if (v) t.dataset.chg = v; else delete t.dataset.chg; }
    });
  }
  document.addEventListener('input', e => { if (e.target && e.target.matches && e.target.matches('#reorderZone input[type=range]')) fillOne(e.target); }, true);
  document.addEventListener('change', () => fillSoon(), true);
  document.addEventListener('click', () => { if (root.classList.contains('studioOn')) setTimeout(fillAll, 120); }, true);
  let fillT = 0;
  const fillSoon = () => { clearTimeout(fillT); fillT = setTimeout(fillAll, 40); };
  new MutationObserver(ms => { if (ms.some(m => m.target.matches && m.target.matches('input[type=range]') && !(m.oldValue || '').includes('--lo'))) fillSoon(); else if (ms.some(m => m.target.matches && m.target.matches('input[type=range]'))) fillSoon(); })
    .observe(document.getElementById('reorderZone') || document.body, { attributes: true, attributeFilter: ['style', 'value'], subtree: true });

  /* Build 394: a hidden side panel leaves a slim rail of icons on that edge of the photo; one click brings the panel back
     on the section asked for. */
  function addRails() {
    const cw = $('cw'); if (!cw || $('stRailL')) return;
    const mk = (id, items, label) => {
      const r = document.createElement('div'); r.id = id; r.className = 'stRail'; r.setAttribute('role', 'toolbar'); r.setAttribute('aria-label', label);
      items.forEach(it => { const b = document.createElement('button'); b.type = 'button'; b.title = it[0]; b.setAttribute('aria-label', it[0]); b.innerHTML = it[1]; b.addEventListener('click', it[2]); r.appendChild(b); });
      cw.appendChild(r);
    };
    const svg = p => '<svg viewBox="0 0 20 20" aria-hidden="true">' + p + '</svg>';
    const openL = secId => () => { root.classList.remove('stNoL'); panelsSave(); const d = $(secId); if (d) { d.open = true; setTimeout(() => { try { d.scrollIntoView({ block: 'nearest' }); } catch (e) {} }, 80); } setTimeout(() => { window.dispatchEvent(new Event('resize')); refreshSpectrum(); }, 60); };
    mk('stRailL', [
      ['Spectrum', svg('<path d="M2.5 15c2.5 0 3-9 5.5-9s2.5 6 4.5 6 2.5-4 5-4"/>'), openL('stSecSpec')],
      ['Source channels', svg('<circle cx="7.5" cy="8" r="4.5"/><circle cx="12.5" cy="8" r="4.5"/><circle cx="10" cy="12.5" r="4.5"/>'), openL('stChanHome')],
      ['History', svg('<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 4v3h3M10 6.5V10l2.5 1.5"/>'), openL('stSecHist')]
    ], 'Left panel');
    const dock = $('dock');
    const tabs = dock ? [...dock.querySelectorAll('button[data-tab]')] : [];
    mk('stRailR', tabs.map(t => {
      const ic = t.querySelector('svg'); const name = (t.textContent || t.dataset.tab).trim();
      return [name, ic ? ic.outerHTML : svg('<circle cx="10" cy="10" r="3"/>'), () => { root.classList.remove('stNoR'); panelsSave(); t.click(); if (!t.classList.contains('on')) t.click(); setTimeout(() => window.dispatchEvent(new Event('resize')), 60); }];
    }), 'Right panel');
  }
  /* Build 394: a quiet line with what the camera recorded (body, lens, ISO, shutter, aperture, focal length), read from
     the file's own EXIF. Works on JPEG and on the TIFF-based RAW formats; says nothing when the file carries none. */
  function exifText(buf) {
    try {
      const dv = new DataView(buf); let t0 = -1;
      if (dv.getUint16(0) === 0xFFD8) {   // JPEG: find the APP1 "Exif" block
        let o = 2;
        while (o + 4 < dv.byteLength) { const m = dv.getUint16(o), n = dv.getUint16(o + 2); if (m === 0xFFE1 && dv.getUint32(o + 4) === 0x45786966) { t0 = o + 10; break; } if ((m & 0xFF00) !== 0xFF00) break; o += 2 + n; }
      } else if (dv.getUint16(0) === 0x4949 || dv.getUint16(0) === 0x4D4D) t0 = 0;
      if (t0 < 0) return '';
      const le = dv.getUint16(t0) === 0x4949, u16 = o => dv.getUint16(t0 + o, le), u32 = o => dv.getUint32(t0 + o, le);
      const SZ = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
      const out = {};
      const readIfd = (off, want) => {
        if (!off || t0 + off + 2 > dv.byteLength) return;
        const n = u16(off);
        for (let i = 0; i < n; i++) {
          const e = off + 2 + i * 12; if (t0 + e + 12 > dv.byteLength) return;
          const tag = u16(e), type = u16(e + 2), cnt = u32(e + 4); if (!(tag in want)) continue;
          const len = (SZ[type] || 1) * cnt, vo = len > 4 ? u32(e + 8) : e + 8; if (t0 + vo + len > dv.byteLength) continue;
          let v;
          if (type === 2) { v = ''; for (let k = 0; k < cnt; k++) { const c = dv.getUint8(t0 + vo + k); if (!c) break; v += String.fromCharCode(c); } v = v.trim(); }
          else if (type === 3) v = u16(vo); else if (type === 4) v = u32(vo);
          else if (type === 5) { const d = u32(vo + 4); v = d ? u32(vo) / d : 0; }
          else continue;
          out[want[tag]] = v;
        }
      };
      readIfd(u32(4), { 0x010F: 'make', 0x0110: 'model', 0x8769: 'exif' });
      if (out.exif) readIfd(out.exif, { 0x829A: 'exp', 0x829D: 'fn', 0x8827: 'iso', 0x920A: 'fl', 0xA434: 'lens' });
      const bits = [];
      if (out.model) { const mk = (out.make || '').split(' ')[0]; bits.push(mk && out.model.toLowerCase().indexOf(mk.toLowerCase()) < 0 ? mk + ' ' + out.model : out.model); }
      if (out.lens && /[a-z]{2}/i.test(out.lens) && out.lens.indexOf('65535') < 0) bits.push(out.lens);   // adapted lenses write a placeholder
      if (out.iso) bits.push('ISO ' + out.iso);
      if (out.exp) bits.push(out.exp >= 0.4 ? (Math.round(out.exp * 10) / 10) + 's' : '1/' + Math.round(1 / out.exp) + 's');
      if (out.fn) bits.push('f/' + (Math.round(out.fn * 10) / 10));
      if (out.fl) bits.push(Math.round(out.fl) + 'mm');
      return bits.join('  \u00b7  ');
    } catch (e) { return ''; }
  }
  window.stPhotoInfo = async function (file) {
    let txt = '';
    try { if (file && file.slice) txt = exifText(await file.slice(0, 262144).arrayBuffer()); } catch (e) {}
    window._stInfoText = txt; showInfo();
  };
  function showInfo() {
    const cw = $('cw'); if (!cw) return;
    let el = $('stInfo');
    if (!el) { el = document.createElement('div'); el.id = 'stInfo'; cw.appendChild(el); }
    el.textContent = window._stInfoText || ''; el.hidden = !window._stInfoText;
  }
  /* Build 378: a visible zoom control on the photo (the mouse wheel already zooms; nothing on screen said so) */
  function addZoom() {
    /* build 395: one floating bar at the bottom of the photo: compare, view, zoom. The compare control itself stays where
       the layout code keeps it (#cmpBar) and is laid over the bar's first segment; the view buttons drive the real ones in
       the Looks tab, so the two always agree. */
    const cw = $('cw'); if (!cw || $('stBar')) return;
    const d = document.createElement('div'); d.id = 'stBar';
    d.innerHTML = '<div class="stBarCmp" aria-hidden="true"></div>'
      + '<div class="stBarG" id="stView" role="group" aria-label="View">' + [['0', 'Photo'], ['1', 'NDVI'], ['2', 'NGB'], ['3', 'IR map']].map(v => '<button type="button" data-v="' + v[0] + '">' + v[1] + '</button>').join('') + '</div>'
      + '<div class="stBarG" id="stZoom" role="group" aria-label="Zoom"><button type="button" id="stZm" aria-label="Zoom out" title="Zoom out">−</button><button type="button" id="stZf" title="Fit the whole photo (double-click the photo)">Fit</button><button type="button" id="stZp" aria-label="Zoom in" title="Zoom in (or scroll over the photo)">+</button></div>';
    cw.appendChild(d);
    const mid = f => { const r = $('preview').getBoundingClientRect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); };
    $('stZm').addEventListener('click', () => mid(1 / 1.5));
    $('stZp').addEventListener('click', () => mid(1.5));
    $('stZf').addEventListener('click', () => { zoom = 1; panX = panY = 0; applyZoom(); });
    window.stZoomSync = z => { const f = $('stZf'); if (f) f.textContent = z <= 1.001 ? 'Fit' : (z < 10 ? z.toFixed(1) : Math.round(z)) + '×'; };
    window.stZoomSync(zoom);
    const real = v => document.querySelector('.idxBtn[data-idx="' + v + '"]');
    const viewSync = () => { d.querySelectorAll('#stView button').forEach(b => { const r = real(b.dataset.v); b.classList.toggle('on', !!(r && r.classList.contains('on'))); }); };
    d.querySelector('#stView').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; const r = real(b.dataset.v); if (r) r.click(); setTimeout(viewSync, 30); });
    document.addEventListener('click', () => { if ($('stBar')) setTimeout(viewSync, 140); }, true);
    viewSync();
  }
  window.studioLeftOn = function () {
    panelsLoad(); addToggles(); addZoom(); addRails(); showInfo(); fillAll();
    if (!built) build();
    const fd = $('filtersDetails'); if (fd) { park(fd, 'filters'); $('stSpecPick').appendChild(fd); }
    const cd = $('channelDetails'); if (cd) { park(cd, 'channels'); $('stChanHome').appendChild(cd); cd.classList.add('stSec'); }
    histSig = ''; renderHistory(); refreshSpectrum(); studioFile();
  };
  window.studioLeftOff = function () {
    if (!built) return;
    ['stTogL', 'stTogR', 'stHdrL', 'stHdrR', 'stBar', 'stRailL', 'stRailR', 'stInfo'].forEach(id => { const b = $(id); if (b) b.remove(); });
    const fd = $('filtersDetails'); if (fd) unpark(fd, 'filters');
    const cd = $('channelDetails'); if (cd) { cd.classList.remove('stSec'); unpark(cd, 'channels'); }
  };

  /* ---------- the file line in the top bar ---------- */
  function studioFile() {
    const el = $('studioFile'); if (!el) return;
    const bits = [];
    if (typeof origW !== 'undefined' && origW) bits.push(origW + ' × ' + origH);
    const cam = typeof irlCameraModel === 'function' ? irlCameraModel() : ''; if (cam) bits.push(cam);
    const nm = fileName ? '<span class="sfN">' + esc(fileName) + '</span>' : '';
    const html = nm + (bits.length ? '<small>' + esc(bits.join(' · ')) + '</small>' : '');
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  ['fi', 'fi2'].forEach(id => { const i = $(id); if (i) i.addEventListener('change', () => { const f = i.files && i.files[0]; if (f) { fileName = f.name; studioFile(); setTimeout(studioFile, 1500); setTimeout(studioFile, 4000); } }, true); });
  new MutationObserver(() => { studioFile(); setTimeout(studioFile, 1200); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.studioFile = studioFile;

  /* the Light tab opens with its cards open (exposure, tone, black and white point, tone curve): on a desktop there is room */
  let lightOpened = false;
  function openLight() {
    if (lightOpened || !root.classList.contains('studioOn')) return;
    const z = $('reorderZone'); if (!z) return; lightOpened = true;
    z.querySelectorAll('[data-dock="light"] details').forEach(d => { if (!d.open) d.open = true; });
  }
  let colourOpened = false;
  function openColour() { if (colourOpened || !root.classList.contains('studioOn')) return; const g = $('wbTempGrp'); if (g) { colourOpened = true; g.open = true; } }
  new MutationObserver(() => { const t = root.getAttribute('data-tab'); if (t === 'light') openLight(); else if (t === 'colour') openColour(); }).observe(root, { attributes: true, attributeFilter: ['data-tab'] });

  /* after the whole bundle has run (fpStack and the rest are declared later in it) */
  setTimeout(() => { if (root.classList.contains('studioOn')) window.studioLeftOn(); }, 0);
})();
