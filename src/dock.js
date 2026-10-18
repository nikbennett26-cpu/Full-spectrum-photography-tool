'use strict';
/* irlab editor: js/dock.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- phone dock and sheet ----------
   On a phone held upright the controls live in a sheet that slides up over the
   bottom of the screen, and a five-tab dock chooses what it shows: Looks
   (channel swap and presets), Light, Colour (white balance, colour, targeted
   colour), Detail, and Export (crop, export, decode settings). The sheet has
   three rests: closed, so the photo gets the whole screen; a peek, so the
   photo and the sliders fit together; and tall. Drag the grip or tap a tab.
   This file only does the choosing and the sizing; the panels, their sliders
   and everything that reads them are exactly the ones used everywhere else. */
(function dockController() {
  const root = document.documentElement, dock = $('dock'), grip = $('sheetGrip'), zone = $('reorderZone');
  if (!dock || !grip || !zone) return;
  /* see "a phone that has been given a wide page" in the styles */
  function updateUiZoom() {
    const iw = window.innerWidth, ih = window.innerHeight;
    const wide = navigator.maxTouchPoints > 0 && iw >= 800 && ih / iw >= 1.7;
    const z = wide ? Math.min(4, Math.max(1.5, iw / 390)) : 1;
    const was = root.classList.contains('uiZoom');
    root.classList.toggle('uiZoom', wide);
    root.style.setProperty('--uiz', z.toFixed(3));
    const k = wide ? Math.min(2.2, z * 0.8) : 1;
    BASE = Math.round(46 * k); CLOSED_HIST = Math.round(106 * k);
    return was !== wide;
  }
  let BASE = 46, CLOSED_HIST = 106;
  updateUiZoom();
  const mq = window.matchMedia('(max-width:1099px) and (orientation:portrait) and (min-height:480px)');
  const MIN_SHEET = 0.27, FULL = 0.74, GAP = 8;
  let tab = 'looks', H = 0, rest = 'peek', inited = false;
  const px = f => Math.round(window.innerHeight * f);

  function classify() {
    [...zone.children].forEach(el => {
      let t = null, o = 0;
      const step = el.dataset && el.dataset.step;
      if (step === 'swap') { t = 'looks'; o = 2; }
      else if (step === 'light') { t = 'light'; o = 1; }
      else if (step === 'wb') { t = 'colour'; o = 1; }
      else if (step === 'colour') { t = 'colour'; o = 2; }
      else if (step === 'targeted') { t = 'colour'; o = 3; }
      else if (step === 'detail') { t = 'detail'; o = 1; }
      else if (el.id === 'rawPlanePanel') { t = 'looks'; o = 3; }
      else if (el.tagName === 'FOOTER') { t = 'export'; o = 4; }
      else if (el.classList && el.classList.contains('panel')) {
        if (el.querySelector('#bDl')) { t = 'export'; o = 1; }
        else if (el.classList.contains('tier-work')) { t = 'export'; o = 2; }
        else { t = 'looks'; o = 1; }
      }
      if (t) { el.setAttribute('data-dock', t); el.style.order = o; }
    });
    zone.querySelectorAll('[data-step="light"],[data-step="detail"]').forEach(e => e.setAttribute('data-solo', ''));
  }
  /* Everything above the sheet is measured, then the sheet takes whatever is left. A
     landscape photo is only as tall as the screen is wide, so it leaves room, and that room
     goes to the controls rather than sitting empty: the photo stays at the top (it is the
     sticky block), the sheet's top edge sits right under the last thing above it, and hiding
     the histogram makes the sheet taller again. A portrait photo takes what it needs and
     the sheet keeps a comfortable minimum. */
  function metrics() {
    const cw = $('cw'), cmp = $('cmpBar'), st = document.querySelector('#previewSticky > .ptStamps');
    return {
      dh: Math.round(dock.getBoundingClientRect().height) || 64,
      top: cw ? Math.round(cw.getBoundingClientRect().top + window.scrollY) : 120,
      cmpH: cmp && cmp.offsetParent ? Math.round(cmp.getBoundingClientRect().height) + 8 : 0,
      stH: st && st.offsetParent ? Math.round(st.getBoundingClientRect().height) + 5 : 0,
      scopes: !root.classList.contains('scopesOff'),
    };
  }
  function naturalPhoto() {
    const cw = $('cw'), cv = (window.engine && engine.canvas) || $('preview');
    const w = (cw ? cw.clientWidth : 340) - 4, a = cv && cv.width ? cv.height / cv.width : 0.67;
    return Math.round(w * a);
  }
  function computePeek(m) {
    const base = window.innerHeight - m.top - GAP - m.dh - m.cmpH - m.stH;
    const minSheet = Math.round(window.innerHeight * MIN_SHEET);
    // the photo is sized as if the histogram were showing, so hiding the histogram never changes it:
    // all of the room it frees goes to the controls
    const photo = Math.max(150, Math.min(naturalPhoto(), base - (BASE + 6) - minSheet));
    return { photo: photo, sheet: Math.max(minSheet, Math.min(px(FULL), base - (m.scopes ? BASE + 6 : 0) - photo)) };
  }
  /* True when the photo is already shown at its full natural size with the controls at their usual height, which is
     what a landscape photo does on a phone. Then lowering the controls cannot make the photo any bigger, it only opens
     an empty gap between them, so they stay put: a swipe on the panel scrolls it instead of moving it, and a drag on
     the handle either closes it or springs back. A portrait photo still gets taller as the controls come down. */
  function photoFits(m) { return computePeek(m || metrics()).photo >= naturalPhoto() - 2; }
  function layout() {
    if (!root.classList.contains('dockOn')) return;
    const m = metrics(), closed = root.classList.contains('sheetClosed');
    if (rest === 'custom' && !closed && photoFits(m)) rest = 'peek';   // e.g. lowered for a portrait photo, then a landscape one opened
    root.style.setProperty('--dockH', m.dh + 'px');
    let photoMax;
    if (rest === 'peek' && !closed) {
      const p = computePeek(m);
      if (Math.abs(p.sheet - H) > 1) { H = p.sheet; root.style.setProperty('--sheetH', H + 'px'); }
      photoMax = p.photo;
    } else {
      const scp = $('scopeDetails'), scpH = closed ? (scp && scp.offsetParent ? scp.offsetHeight + 6 : 0) : (m.scopes ? BASE + 6 : 0);
      photoMax = Math.max(150, window.innerHeight - m.top - GAP - H - m.dh - m.cmpH - scpH - m.stH);
    }
    root.style.setProperty('--photoMax', photoMax + 'px');
    const histH = closed ? CLOSED_HIST : BASE;
    root.style.setProperty('--histH', histH + 'px');
    /* The histogram canvas is sized by drawHistogram (to the screen's pixel density). This used to force it to a
       different size on every pass, and a pass runs for every step of a sheet drag; each resize clears a canvas, so
       the histogram went black until the drag stopped and a redraw caught up. Now it is only redrawn, and only when
       the strip's height actually changed (closing or opening the sheet). */
    if (layout._histH !== histH) { layout._histH = histH; if (typeof scheduleHistogram === 'function') scheduleHistogram(); }
  }
  /* What sits between the photo and the controls on a phone costs photo. So
     while the dock is on: rotate and full-size join the top button row, the
     before/after slider floats over the top of the photo, and the scopes move
     into the Light tab, where you are looking at them anyway. Each goes back
     where it came from when the layout changes back. Only the position in the
     page changes, the elements and everything attached to them are the same. */
  const moved = {};
  let scopesWereOpen = false;
  function quiet(fn) { window.__dockSwitching = true; fn(); setTimeout(() => { window.__dockSwitching = false; }, 120); }
  function toDock() {
    const tb = document.querySelector('.toolbar'), tools = document.querySelector('#previewTools .ptTools'), theme = $('themeBtn');
    if (tb && tools && !moved.tools) { moved.tools = true; tb.insertBefore(tools, theme || null); }
    const stamps = document.querySelector('#previewTools .ptStamps'), psx = $('previewSticky');
    if (stamps && psx && !moved.stamps) { moved.stamps = true; psx.appendChild(stamps); }
    const sc = $('scopeDetails'), hist = $('histogram');
    if (sc && hist && !moved.scopes) {
      moved.scopes = true;
      scopesWereOpen = sc.open;
      quiet(() => { sc.open = true; });
      if (!hist.__dockTap) {
        hist.__dockTap = true;
        hist.addEventListener('click', () => { if (root.classList.contains('dockOn') && typeof setScopeMode === 'function') setScopeMode(scopeMode === 'hist' ? 'parade' : 'hist'); });
      }
      setTimeout(() => { if (typeof drawHistogram === 'function') drawHistogram(); }, 150);
    }
  }
  function fromDock() {
    const tools = document.querySelector('.toolbar .ptTools'), holder = $('previewTools');
    if (moved.tools && tools && holder) { holder.appendChild(tools); moved.tools = false; }
    const stp = document.querySelector('#previewSticky > .ptStamps'), hold = $('previewTools');
    if (moved.stamps && stp && hold) { hold.insertBefore(stp, hold.firstChild); moved.stamps = false; }
    const sc = $('scopeDetails');
    if (moved.scopes && sc) {
      quiet(() => { sc.open = scopesWereOpen; });
      const hist = $('histogram'); if (hist) { hist.width = 512; hist.height = 110; }   // the desktop size
      moved.scopes = false;
      setTimeout(() => { if (typeof drawHistogram === 'function') drawHistogram(); }, 150);
    }
  }
  function apply() {
    root.style.setProperty('--sheetH', H + 'px');
    root.classList.toggle('sheetClosed', H < 28);
    layout();
    setTimeout(layout, 320);   // again once the sheet has finished moving and the scopes have settled at their new size
  }
  /* The controls never rise above their normal height any more: covering the photo to show more sliders made it
     impossible to see what they were doing. They can be pulled DOWN to any height to give the photo more room, stay
     where they are left, and close fully near the bottom. A tap on the handle toggles closed and open. */
  const peekH = () => computePeek(metrics()).sheet;
  function setRest(r) {
    if (r === 'full') r = 'peek';
    rest = r;
    if (r === 'closed') H = 0; else H = Math.max(H, px(MIN_SHEET));
    apply();
  }
  function setSheet(h) {   // pixel height; the named rests are chosen when it lands on one
    h = Math.max(0, Math.round(h));
    if (h < 28) { setRest('closed'); return; }
    if (h >= peekH() - 2 || photoFits()) { setRest('peek'); return; }
    rest = 'custom'; H = h; apply();
  }
  function settleAt(h, top) {   // where a drag or swipe lets go
    if (h < 60) setRest('closed');
    else if (h >= top - 8 || photoFits()) setRest('peek');
    else { rest = 'custom'; H = Math.round(h); apply(); }
  }
  function setTab(t) {
    tab = t; root.dataset.tab = t;
    dock.querySelectorAll('button[data-tab]').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    zone.querySelectorAll('[data-dock="' + t + '"]').forEach(p => {
      if (p.tagName === 'DETAILS') p.open = true;
      // the desktop layout shows one tab at a time, so a panel the old layout had folded shut is opened with its tab
      if (root.classList.contains('studioOn')) p.classList.remove('collapsed');
      const es = p.querySelector && p.querySelector(':scope > details#exportSection');   // the export panel keeps its options inside this one
      if (es) es.open = true;
    });
    zone.scrollTop = 0;
  }
  dock.querySelectorAll('button[data-tab]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tab;
    if (root.classList.contains('studioOn')) { setTab(t); return; }
    if (H < 28) { setTab(t); setRest('peek'); }
    else if (t === tab) setRest('closed');
    else setTab(t);
    if (typeof haptic === 'function') haptic('select');
  }));
  let g = null;
  grip.addEventListener('pointerdown', e => { g = { y: e.clientY, h: H, moved: false, top: peekH() }; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointermove', e => {
    if (!g) return;
    const dy = g.y - e.clientY;
    if (Math.abs(dy) > 6) { g.moved = true; root.classList.add('sheetDrag'); }
    if (g.moved) { rest = 'custom'; H = Math.min(g.top, Math.max(0, g.h + dy)); apply(); }
  });
  const endGrip = () => {
    if (!g) return;
    root.classList.remove('sheetDrag');
    if (g.moved) settleAt(H, g.top);
    else setRest(H < 28 ? 'peek' : 'closed');
    g = null;
  };
  grip.addEventListener('pointerup', endGrip); grip.addEventListener('pointercancel', endGrip);

  /* The grip is a small target, so the sheet itself can also be pulled down: when it is
     scrolled to the very top, a downward swipe on any plain part of it moves the sheet, the
     same as dragging the grip, and lets go to the nearest rest. Sliders, buttons, canvases
     and anything else you can interact with are left alone, and a swipe that starts while
     the sheet is scrolled down just scrolls it. */
  let sw = null;
  zone.addEventListener('touchstart', e => {
    if (!root.classList.contains('dockOn') || e.touches.length !== 1) { sw = null; return; }
    const t = e.target;
    /* Build 159: a whole slider row counts as a control, not just the thin track. A touch that landed beside the track
       (between it and the - and + buttons, or just above or below the thumb) used to start a pull on the sheet, so with
       the panel scrolled to the top, adjusting a slider kept collapsing the controls instead. */
    if (t && t.closest && t.closest('input,canvas,select,textarea,button,a,label,summary,[contenteditable],.sl,.slStep,.wbrow,.ctl,[role=tablist],[role=slider]')) { sw = null; return; }
    sw = { x: e.touches[0].clientX, y: e.touches[0].clientY, h: H, active: false, atTop: zone.scrollTop <= 0 };
  }, { passive: true });
  zone.addEventListener('touchmove', e => {
    if (!sw) return;
    const y = e.touches[0].clientY, dy = y - sw.y;
    if (!sw.active) {
      const dx = Math.abs(e.touches[0].clientX - sw.x);
      if (dx > 12 && dx > dy) { sw = null; return; }   // a sideways gesture is someone working a control, never a pull
      // a deliberate pull: 28px down and clearly more down than sideways (was 14px, any direction)
      if (sw.atTop && zone.scrollTop <= 0 && dy > 28 && dy > 2 * dx && !photoFits()) { sw.active = true; sw.y = y; sw.h = H; sw.top = peekH(); root.classList.add('sheetDrag'); }
      else return;
    }
    e.preventDefault();
    rest = 'custom'; H = Math.min(sw.top, Math.max(0, sw.h - (y - sw.y))); apply();
  }, { passive: false });
  const endSwipe = () => {
    if (!sw) return;
    const was = sw.active, top = sw.top; sw = null;
    if (!was) return;
    root.classList.remove('sheetDrag');
    settleAt(H, top);
  };
  zone.addEventListener('touchend', endSwipe); zone.addEventListener('touchcancel', endSwipe);

  /* Hide or show the histogram. Hiding it also closes the scopes panel, so nothing keeps
     drawing in the background, and the sheet grows into the freed room. */
  const SC_KEY = 'irlab.dockScopes', scBtn = $('btnScopesToggle');
  function setScopes(on, persist) {
    root.classList.toggle('scopesOff', !on);
    if (scBtn) scBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const sc = $('scopeDetails');
    if (sc && moved.scopes) quiet(() => { sc.open = on; });
    if (persist) { try { localStorage.setItem(SC_KEY, on ? '1' : '0'); } catch (e) {} }
    layout(); setTimeout(layout, 120);
    if (on) setTimeout(() => { if (typeof drawHistogram === 'function') drawHistogram(); }, 160);
  }
  let scopesPref = true; try { scopesPref = localStorage.getItem(SC_KEY) !== '0'; } catch (e) {}
  if (scBtn) scBtn.addEventListener('click', () => { setScopes(root.classList.contains('scopesOff'), true); if (typeof haptic === 'function') haptic('select'); });

  /* The Looks tab holds three long groups (the channel matrix, the swap presets, and the film
     stocks and recipes, which is where Fedia's Triple Band Aerochrome sits). Stacked open, the
     film group starts about 1,300px down a sheet that shows 200px of it. On a phone they work as
     an accordion instead: all three start closed so their three headers show together, opening
     one closes the others and brings it to the top of the sheet. Desktop gets its old open
     state back when the phone layout is left. */
  const LOOKS_GROUPS = ['matrixDetails', 'swapPresetsGroup', 'filmPresetGroup'];
  const looksWere = {};
  function looksAccordion(on, openFirst) {
    LOOKS_GROUPS.forEach(id => {
      const d = $(id); if (!d) return;
      if (on) {
        const first = !(id in looksWere);
        if (first) looksWere[id] = d.open;
        if (first) d.open = !!(openFirst && id === 'matrixDetails');
        if (!d.__acc) {
          d.__acc = true;
          d.addEventListener('toggle', () => {
            if (!root.classList.contains('dockOn') || !d.open) return;
            LOOKS_GROUPS.forEach(o => { const x = $(o); if (x && x !== d && x.open) x.open = false; });
            setTimeout(() => { zone.scrollTo({ top: Math.max(0, d.getBoundingClientRect().top - zone.getBoundingClientRect().top + zone.scrollTop - 14), behavior: 'smooth' }); }, 60);
          });
        }
      } else if (id in looksWere) { d.open = looksWere[id]; delete looksWere[id]; }
    });
  }
  /* Build 160: any tool you open snaps to the top of the sheet, the way the Looks groups already did. Opening a card
     near the bottom used to leave most of it below the fold, so the next move was always a scroll. Only a tap on a
     card's own header does this (not a tab switch or a reset opening cards in code), it waits for the card to finish
     opening, and it does nothing when the card already starts near the top. */
  let lastSummaryTap = 0;
  zone.addEventListener('click', e => { if (e.target.closest && e.target.closest('summary')) lastSummaryTap = performance.now(); }, true);
  zone.addEventListener('toggle', e => {
    const d = e.target;
    if (!root.classList.contains('dockOn') || !d || d.tagName !== 'DETAILS' || !d.open) return;
    if (performance.now() - lastSummaryTap > 800) return;
    if (LOOKS_GROUPS.includes(d.id)) return;   // these have their own handler above
    setTimeout(() => {
      const off = d.getBoundingClientRect().top - zone.getBoundingClientRect().top;
      if (Math.abs(off - 6) < 12) return;
      zone.scrollTo({ top: Math.max(0, off + zone.scrollTop - 6), behavior: 'smooth' });
    }, 60);
  }, true);
  function sync() {
    const on = mq.matches;
    root.classList.toggle('dockOn', on);
    if (!on) { root.classList.remove('sheetClosed', 'sheetDrag', 'scopesOff'); fromDock(); looksAccordion(false); return; }
    toDock();
    looksAccordion(true);
    if (!inited) { inited = true; classify(); setTab('looks'); setScopes(scopesPref, false); setRest('peek'); }
    else { root.classList.toggle('scopesOff', !scopesPref && !root.classList.contains('scopesOff') ? false : root.classList.contains('scopesOff')); setRest(rest === 'custom' ? 'peek' : rest); }
    layout();
  }
  if (mq.addEventListener) mq.addEventListener('change', sync); else mq.addListener(sync);
  window.addEventListener('resize', () => { if (root.classList.contains('dockOn')) setRest(rest === 'custom' ? 'peek' : rest); });
  window.addEventListener('orientationchange', () => setTimeout(() => { updateUiZoom(); sync(); }, 250));
  window.addEventListener('resize', () => { if (updateUiZoom() && root.classList.contains('dockOn')) { layout(); setTimeout(layout, 200); } });
  if ($('scopeDetails')) $('scopeDetails').addEventListener('toggle', () => setTimeout(layout, 0));
  new MutationObserver(() => setTimeout(layout, 60)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('load', () => setTimeout(layout, 300));

  /* ---------- desktop studio ----------
     At 1100px and wider the same tabs drive a three-part layout: tool rail, stage, inspector.
     Moving things is the same trick as on the phone: the histogram goes to the top of the inspector,
     the before/after bar floats over the foot of the photo, undo, redo, rotate and full-size join the
     top bar, and the decode and white balance notes sit on the photo. Each goes back where it came
     from when the window narrows. */
  const mqS = window.matchMedia('(min-width:1000px) and (orientation:landscape), (min-width:1100px)');
  let studioInit = false, studioScopesWere = false;
  const movedS = {};
  /* Build 127: the same IR badge and 'irlab / darkroom' wordmark as the home page header. */
  const BRAND = '<svg class="labBadge" viewBox="0 0 64 64" width="24" height="24" aria-hidden="true"><circle cx="32" cy="32" r="24" fill="none" stroke="#ee6a2c" stroke-width="4"/><path d="M21.95 42.14V21.86Q21.95 21.71 22.05 21.61Q22.16 21.5 22.3 21.5H25.81Q25.96 21.5 26.07 21.61Q26.18 21.71 26.18 21.86V42.14Q26.18 42.29 26.07 42.39Q25.96 42.5 25.81 42.5H22.3Q22.16 42.5 22.05 42.39Q21.95 42.29 21.95 42.14ZM37.7 42.2 35.39 33.92Q35.34 33.8 35.24 33.8H34.23Q34.07 33.8 34.07 33.95V42.14Q34.07 42.29 33.97 42.39Q33.86 42.5 33.71 42.5H30.2Q30.05 42.5 29.95 42.39Q29.84 42.29 29.84 42.14V21.86Q29.84 21.71 29.95 21.61Q30.05 21.5 30.2 21.5H36.27Q37.91 21.5 39.2 22.3Q40.49 23.09 41.2 24.53Q41.91 25.97 41.91 27.83Q41.91 29.6 41.23 30.95Q40.55 32.3 39.35 33.05Q39.3 33.08 39.27 33.12Q39.23 33.17 39.27 33.23L42.02 42.08L42.05 42.2Q42.05 42.5 41.72 42.5H38.12Q37.8 42.5 37.7 42.2ZM34.07 25.28V30.41Q34.07 30.56 34.23 30.56H35.57Q36.5 30.56 37.09 29.83Q37.67 29.09 37.67 27.86Q37.67 26.6 37.09 25.87Q36.5 25.13 35.57 25.13H34.23Q34.07 25.13 34.07 25.28Z" fill="#eceae4"/></svg><span class="sbWord"><b>ir</b>lab <span class="sbPath">/ darkroom</span></span>';
  function studioHistSize() {
    const hist = $('histogram'); if (!hist || !root.classList.contains('studioOn')) return;
    const w = hist.clientWidth || 360, hh = Math.max(40, Math.round(512 * 92 / w));
    if (hist.width !== 512 || hist.height !== hh) { hist.width = 512; hist.height = hh; setTimeout(() => { if (typeof drawHistogram === 'function') drawHistogram(); }, 30); }
  }
  function toStudio() {
    const tb = document.querySelector('.toolbar'), theme = $('themeBtn');
    if (tb && !$('studioBrand')) { const b = document.createElement('div'); b.id = 'studioBrand'; b.innerHTML = BRAND; tb.insertBefore(b, tb.firstChild); }
    if (tb && !$('btnStudioExport')) {
      const e = document.createElement('button'); e.type = 'button'; e.id = 'btnStudioExport'; e.className = 'keyBtn keyDown keySm'; e.textContent = 'Export';
      e.addEventListener('click', () => { const t = dock.querySelector('button[data-tab="export"]'); if (t) t.click(); });
      tb.appendChild(e);
    }
    const undo = $('btnUndo'), redo = $('btnRedo');
    if (tb && undo && redo && !movedS.ur) { movedS.ur = true; tb.insertBefore(undo, theme || null); tb.insertBefore(redo, theme || null); }
    const tools = document.querySelector('#previewTools .ptTools');
    if (tb && tools && !movedS.tools) { movedS.tools = true; tb.insertBefore(tools, theme || null); }
    const cw = $('cw'), cmp = $('cmpBar'), st = document.querySelector('#previewTools .ptStamps');
    if (cw && cmp && !movedS.cmp) { movedS.cmp = true; cw.appendChild(cmp); }
    const sc = $('scopeDetails');
    if (sc && !movedS.scopes) {
      movedS.scopes = true; studioScopesWere = sc.open;
      zone.insertBefore(sc, zone.firstChild); sc.setAttribute('data-dock', 'all');
      quiet(() => { sc.open = true; });
    }
    // decode / WB readouts go under the histogram in the inspector's sticky header, not over the photo
    if (sc && st && !movedS.stamps) { movedS.stamps = true; sc.appendChild(st); }
    setTimeout(studioHistSize, 80);
  }
  function fromStudio() {
    const undo = $('btnUndo'), redo = $('btnRedo'), zb = $('zoomBadge'), zi = $('zoomInfo');
    if (movedS.ur && undo && redo && zb) { zb.insertBefore(undo, zi || null); zb.insertBefore(redo, zi || null); movedS.ur = false; }
    const tools = document.querySelector('.toolbar .ptTools'), hold = $('previewTools');
    if (movedS.tools && tools && hold) { hold.appendChild(tools); movedS.tools = false; }
    const st = document.querySelector('#scopeDetails > .ptStamps');
    if (movedS.stamps && st && hold) { hold.insertBefore(st, hold.firstChild); movedS.stamps = false; }
    const ps = $('previewSticky'), sc = $('scopeDetails'), cmp = $('cmpBar');
    if (movedS.scopes && sc && ps) {
      ps.appendChild(sc); sc.removeAttribute('data-dock'); sc.style.order = '';
      quiet(() => { sc.open = studioScopesWere; });
      const hist = $('histogram'); if (hist) { hist.width = 512; hist.height = 110; }
      movedS.scopes = false;
      setTimeout(() => { if (typeof drawHistogram === 'function') drawHistogram(); }, 150);
    }
    if (movedS.cmp && cmp && ps) { ps.insertBefore(cmp, sc && sc.parentElement === ps ? sc : null); movedS.cmp = false; }
  }
  function syncStudio() {
    const on = mqS.matches;
    root.classList.toggle('studioOn', on);
    if (!on) { fromStudio(); looksAccordion(false); return; }
    if (!studioInit) { studioInit = true; classify(); setTab('looks'); }
    toStudio();
    looksAccordion(true, true);
  }
  if (mqS.addEventListener) mqS.addEventListener('change', syncStudio); else mqS.addListener(syncStudio);
  window.addEventListener('resize', () => { if (root.classList.contains('studioOn')) studioHistSize(); });
  document.addEventListener('keydown', e => {
    if (!root.classList.contains('studioOn') || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target; if (t && t.closest && t.closest('input,textarea,select,[contenteditable]')) return;
    const fs = $('previewFullscreen'); if (fs && getComputedStyle(fs).display !== 'none') return;
    const map = { '1': 'looks', '2': 'light', '3': 'colour', '4': 'detail', '5': 'export' };
    if (map[e.key]) { setTab(map[e.key]); e.preventDefault(); }
  });
  dock.querySelectorAll('button[data-tab]').forEach(b => { const n = { looks: 1, light: 2, colour: 3, detail: 4, export: 5 }[b.dataset.tab]; b.title = b.textContent.trim() + ' (' + n + ')'; });
  sync();
  syncStudio();
  window.__dock = { setTab: setTab, setSheet: setSheet, setRest: setRest, setScopes: setScopes, layout: layout, state: () => ({ tab: tab, H: H, rest: rest }) };
})();

/* ---------- custom channel-swap space ----------
   The named swap spaces are three fixed matrices. The Widening slider blends the sRGB-to-
   ProPhoto matrix with the identity: 0 is sRGB, 1 is ProPhoto, and values past 1 push further.
   Measured on test images, about 0.78 lands within 0.006 OKLab of Rec2020, so the slider covers
   the named choices and what lies between and just beyond them. The blended matrix is inverted
   here, not in the shader, and handed over as a pair; 3x3 arrays are column-major as WebGL
   wants them. Choosing a named space still uses its own exact matrices, unchanged. */
const SW_PROPHOTO = [0.529377, 0.098376, 0.016879, 0.330109, 0.873450, 0.117656, 0.140557, 0.028163, 0.865257];
function mat3InvCol(m) {
  const a = m[0], b = m[3], c = m[6], d = m[1], e = m[4], f = m[7], g = m[2], h = m[5], i = m[8];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const r = [[(e * i - f * h), -(b * i - c * h), (b * f - c * e)], [-(d * i - f * g), (a * i - c * g), -(a * f - c * d)], [(d * h - e * g), -(a * h - b * g), (a * e - b * d)]];
  const out = new Float32Array(9);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) out[col * 3 + row] = r[row][col] / det;
  return out;
}
let _swA = -1, _swC = null;
function swapBlend(alpha) {
  if (alpha === _swA && _swC) return _swC;
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1], T = new Float32Array(9);
  for (let k = 0; k < 9; k++) T[k] = (1 - alpha) * I[k] + alpha * SW_PROPHOTO[k];
  _swA = alpha; _swC = { T: T, Ti: mat3InvCol(T) };
  return _swC;
}
function swapWidenPos(v) { return v === '0' ? 0 : v === '1' ? 78 : 100; }
function syncWidenFromSelect() {
  const sel = $('swapSpace'), sl = $('swapWiden'); if (!sel || !sl || sel.value === '3' || sel.value === '4') return;
  const pos = swapWidenPos(sel.value); sl.value = pos;
  const lbl = $('v_swapWiden'); if (lbl) lbl.textContent = pos;
  if (typeof syncSliderFill === 'function') syncSliderFill(sl);
}
(function wireSwapWiden() {
  const sel = $('swapSpace'), sl = $('swapWiden'); if (!sel || !sl) return;
  sl.addEventListener('input', () => { if (sel.value !== '3') sel.value = '3'; });
  sel.addEventListener('change', syncWidenFromSelect);
})();

/* ---------- in-page dialogs ----------
   The browser's own prompt() and confirm() boxes are unreliable on phones: Chrome on Android offers to
   suppress further dialogs from a page after the first one, honours that, and the next "Save preset" then
   silently does nothing, which looks like saving only works once. These two do the same job inside the page,
   in the app's own colours, and cannot be suppressed. */
function stDialog(opts) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,6,8,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)';
    const card = document.createElement('div');
    card.style.cssText = 'width:100%;max-width:380px;background:var(--bg,#141518);color:var(--paper,#eceae4);border:1px solid var(--line2,#3d4048);border-radius:16px;padding:22px 22px 18px;box-shadow:0 30px 80px -20px rgba(0,0,0,.7);font:500 15px/1.4 ui-sans-serif,system-ui,sans-serif';
    const h = document.createElement('div'); h.textContent = opts.title; h.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:' + (opts.input ? '14px' : '8px');
    card.appendChild(h);
    if (opts.message) { const m = document.createElement('div'); m.textContent = opts.message; m.style.cssText = 'color:var(--paper-dim,#a3a097);font-size:13.5px;margin-bottom:16px;white-space:pre-wrap'; card.appendChild(m); }
    let inp = null;
    if (opts.input) {
      inp = document.createElement('input'); inp.type = 'text'; inp.value = opts.value || ''; inp.maxLength = 60; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.setAttribute('aria-label', opts.title);
      inp.style.cssText = 'width:100%;box-sizing:border-box;height:46px;padding:0 14px;border-radius:10px;border:1px solid var(--line2,#3d4048);background:var(--surface,#1b1d21);color:var(--paper,#eceae4);font:500 16px ui-sans-serif,system-ui,sans-serif;outline:none;margin-bottom:16px';
      inp.addEventListener('focus', () => { inp.style.borderColor = 'var(--safelight,#c2431b)'; }); inp.addEventListener('blur', () => { inp.style.borderColor = 'var(--line2,#3d4048)'; });
      card.appendChild(inp);
    }
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
    const mk = (label, primary) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.style.cssText = 'min-width:92px;height:44px;padding:0 20px;border-radius:999px;cursor:pointer;font:600 14px ui-sans-serif,system-ui,sans-serif;' + (primary ? 'border:none;color:#fff;background:linear-gradient(180deg,#f0702f,#c9461a)' : 'border:1px solid var(--line2,#3d4048);background:transparent;color:var(--paper,#eceae4)'); return b; };
    const cancel = mk(opts.cancelLabel || 'Cancel', false), ok = mk(opts.okLabel || 'OK', true);
    row.appendChild(cancel); row.appendChild(ok); card.appendChild(row); wrap.appendChild(card);
    const prevFocus = document.activeElement;
    const done = v => { document.removeEventListener('keydown', onKey, true); wrap.remove(); try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {} resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(opts.input ? null : false); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(opts.input ? inp.value : true); } };
    cancel.addEventListener('click', () => done(opts.input ? null : false));
    ok.addEventListener('click', () => done(opts.input ? inp.value : true));
    wrap.addEventListener('pointerdown', e => { if (e.target === wrap) done(opts.input ? null : false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    setTimeout(() => { (inp || ok).focus(); if (inp) inp.select(); }, 30);
  });
}
const askText = (title, value, okLabel) => stDialog({ title: title, input: true, value: value, okLabel: okLabel || 'Save' });
const askConfirm = (title, message, okLabel) => stDialog({ title: title, message: message, okLabel: okLabel || 'OK' });

/* ---------- "desktop site" notice ----------
   A phone whose browser has "Desktop site" switched on lays the page out about 980px wide and shrinks it to fit,
   so every label is tiny and the layout is the tablet one. The page cannot change that from inside, but it can say
   what is happening. Shown only for a touch-only device with a small physical screen that is being given a wide page. */
(function desktopSiteNotice() {
  try {
    if (localStorage.getItem('irlab.dsHint2') === '1') return;
    const coarse = matchMedia('(pointer:coarse)').matches && !matchMedia('(any-pointer:fine)').matches;
    const small = true;   // the shape test below is the real one; some browsers report the screen as wide as the page
    /* Some browsers report the physical screen as wide as the page they are showing, so also accept the shape: a phone is tall
       and narrow (about 2:1), a tablet or desktop window is not. */
    const tall = window.innerHeight / window.innerWidth >= 1.7;
    if (!(navigator.maxTouchPoints > 0 && tall && window.innerWidth >= 800)) return;
    const bar = document.createElement('div');
    bar.id = 'dsNotice'; bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:10px;right:10px;top:10px;z-index:99990;display:flex;gap:14px;align-items:center;padding:14px 16px;border-radius:14px;background:#1b1d21;color:#eceae4;border:1px solid #3d4048;box-shadow:0 18px 50px -14px rgba(0,0,0,.7);font:500 ' + Math.round(window.innerWidth / 24) + 'px/1.35 ui-sans-serif,system-ui,sans-serif';
    bar.innerHTML = '<span style="flex:1">Your browser is showing the <b>desktop</b> version of this page, so the app has enlarged its controls to compensate. For the best result switch it off: in Chrome open the &#8942; menu and untick <b>Desktop site</b>. If you added IR Lab to your home screen, remove it and add it again from Chrome with Desktop site off.</span>';
    const x = document.createElement('button'); x.type = 'button'; x.textContent = 'Got it';
    x.style.cssText = 'flex:none;border:none;border-radius:999px;padding:.6em 1.2em;background:linear-gradient(180deg,#f0702f,#c9461a);color:#fff;font:600 1em ui-sans-serif,system-ui,sans-serif;cursor:pointer';
    x.addEventListener('click', () => { try { localStorage.setItem('irlab.dsHint2', '1'); } catch (e) {} bar.remove(); });
    bar.appendChild(x); document.body.appendChild(bar);
    if (document.documentElement.classList.contains('uiZoom')) bar.style.zoom = getComputedStyle(document.documentElement).getPropertyValue('--uiz') || 1;
  } catch (e) {}
})();

/* ---------- no page zoom ----------
   The viewport tag and touch-action stop pinch and double-tap zoom on Android and on current iOS. These two
   catch the rest: Safari's own pinch gesture, and a trackpad pinch (which browsers report as ctrl + wheel) or
   ctrl + wheel anywhere except over the photo, where the photo's own zoom takes it. Browser zoom from the
   keyboard (ctrl and plus or minus) is left alone: that is a deliberate act. */
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  if (e.target && e.target.closest && e.target.closest('#cw,#previewFullscreen')) return;   // these zoom the photo themselves
  e.preventDefault();
}, { passive: false });

/* ---- Build 139: the phone rail shows icons only, so a long press on one shows its name in a small bubble under it,
   and that press does not also fire the button. A quick tap works as before. ---- */
(function railNames() {
  const SEL = '.toolbar > [data-lbl], .toolbar .ptTools > [data-lbl]';
  let timer = 0, startX = 0, startY = 0, shownFor = null, bubble = null;
  const onRail = () => document.documentElement.classList.contains('dockOn') && document.body.classList.contains('has-image');
  function hide() { if (bubble) bubble.remove(); bubble = null; }
  function show(el) {
    hide();
    let name = el.getAttribute('data-lbl') || el.getAttribute('aria-label') || '';
    const long = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    // the full name reads better than the one-word label when it is short enough (e.g. "Filter database")
    if (long && long.length <= 24) name = long;
    if (window.irlabTr && irlabTr.lang !== 'en') { const t = irlabTr.lookup(name); if (t) name = t; }
    bubble = document.createElement('div');
    bubble.className = 'railName noTr'; bubble.textContent = name; bubble.setAttribute('role', 'status');
    document.body.appendChild(bubble);
    const r = el.getBoundingClientRect(), bw = bubble.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left + r.width / 2 - bw / 2));
    bubble.style.left = left + 'px'; bubble.style.top = (r.bottom + 6) + 'px';
    if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {}
  }
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest && e.target.closest(SEL);
    if (!el || !onRail() || e.pointerType === 'mouse') return;
    clearTimeout(timer); startX = e.clientX; startY = e.clientY; shownFor = null;
    timer = setTimeout(() => { shownFor = el; show(el); }, 450);
  }, true);
  document.addEventListener('pointermove', e => {
    if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) { clearTimeout(timer); timer = 0; }
  }, true);
  const end = () => { clearTimeout(timer); timer = 0; if (bubble) setTimeout(hide, 900); };
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  // the release after a long press must not also press the button (or open the file picker / link)
  document.addEventListener('click', e => {
    if (!shownFor) return;
    const el = e.target.closest && e.target.closest(SEL);
    if (el === shownFor) { e.preventDefault(); e.stopPropagation(); }
    shownFor = null;
  }, true);
  document.addEventListener('contextmenu', e => { if (onRail() && e.target.closest && e.target.closest(SEL)) e.preventDefault(); }, true);
  window.addEventListener('scroll', hide, { passive: true, capture: true });
})();
