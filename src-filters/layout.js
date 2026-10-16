/* filters page: the editor-style layout (tabs, rail, chart on top). Runs first, before the page's own code. */
/* Layout (build 123): the page is arranged like the editor. The chart takes the place of the photo, the rail above it
   holds the chart tools, and everything else sits in four tabs (Find, Stack, Camera, Data). Existing elements are moved,
   not rebuilt, so every id the code below relies on is unchanged. */
(function fLayout() {
  const $ = id => document.getElementById(id), body = document.body;
  const pFind = $('filterList').closest('.panel'), pStack = $('chartWrap').closest('.panel');
  const pCrgb = $('crgbDetails') && $('crgbDetails').closest('.panel'), pLook = $('lookQuery') && $('lookQuery').closest('.panel');
  const zoneRef = document.querySelector('.zone-ref'), zoneDiv = document.querySelector('.zone-divider'), foot = document.querySelector('body > footer');
  const ctlBar = $('logScale').closest('.bar'), expBar = $('exportPngBtn').parentElement;

  const chart = document.createElement('section'); chart.id = 'fChart'; chart.setAttribute('aria-label', 'Your stack');
  const sticky = $('stickyStack'); chart.appendChild(sticky);
  const hdr = document.createElement('div'); hdr.id = 'fChartHdr';
  hdr.appendChild($('stackName')); chart.appendChild(hdr);
  const zoomNote = $('chartWrap').nextElementSibling;
  chart.appendChild($('chartWrap'));
  if (zoomNote && zoomNote.classList.contains('note')) zoomNote.remove();
  chart.appendChild($('readout'));

  const panes = document.createElement('div'); panes.id = 'fPanes';
  const pane = (k, title) => { const d = document.createElement('section'); d.className = 'fPane'; d.dataset.pane = k; d.setAttribute('aria-label', title); panes.appendChild(d); return d; };
  const find = pane('find', 'Find'), stack = pane('stack', 'Stack'), cam = pane('camera', 'Camera'), data = pane('data', 'Data');
  find.appendChild(pFind); if (pLook) find.appendChild(pLook);
  const sCard = document.createElement('div'); sCard.className = 'panel';
  ['stackSummary', 'plainSummary', 'stackAdvice', 'legend', 'leakWarn', 'behaviour'].forEach(id => { const e = $(id); if (e) sCard.appendChild(e); });
  sCard.appendChild(expBar); expBar.classList.add('fExport');
  stack.appendChild(sCard);
  const cCard = document.createElement('div'); cCard.className = 'panel';
  const cT = document.createElement('div'); cT.className = 'pt'; cT.textContent = 'Chart and camera'; cCard.appendChild(cT);
  cCard.appendChild(ctlBar); cam.appendChild(cCard); if (pCrgb) cam.appendChild(pCrgb);
  const langPanel = $('fLangPanel'); if (langPanel) data.appendChild(langPanel);   // build 136: language first in Data
  if (zoneDiv) zoneDiv.remove(); if (zoneRef) data.appendChild(zoneRef); if (foot) data.appendChild(foot);
  chart.appendChild($('clearBtn'));   // hidden; the rail's Clear presses it
  [...pStack.children].forEach(c => { if (c.querySelector && (c.id || c.querySelector('[id]'))) sCard.appendChild(c); });
  pStack.remove();

  const shell = document.createElement('div'); shell.id = 'fShell';
  const head = $('fHead'); head.parentNode.insertBefore(shell, head);
  const left = document.createElement('div'); left.id = 'fLeft'; left.appendChild(head); left.appendChild(chart);
  const right = document.createElement('div'); right.id = 'fRight'; right.appendChild($('fTabs')); right.appendChild(panes);
  shell.appendChild(left); shell.appendChild(right);

  let cur = 'find';
  try { const t = sessionStorage.getItem('irlab.fPane'); if (t && panes.querySelector('[data-pane="' + t + '"]')) cur = t; } catch (e) {}
  function show(k) {
    cur = k; body.dataset.pane = k;
    $('fTabs').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.pane === k ? 'true' : 'false'));
    try { sessionStorage.setItem('irlab.fPane', k); } catch (e) {}
    requestAnimationFrame(() => { try { if (typeof draw === 'function') draw(); if (typeof drawStrip === 'function') drawStrip(); if (k === 'camera' && typeof crgbUpdate === 'function') crgbUpdate(); } catch (e) {} });
  }
  $('fTabs').addEventListener('click', e => { const b = e.target.closest('button[data-pane]'); if (!b) return; show(b.dataset.pane); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  show(cur);

  $('railClear').addEventListener('click', () => $('clearBtn').click());
  $('railZoomIn').addEventListener('click', () => $('zoomInBtn').click());
  $('railZoomOut').addEventListener('click', () => $('zoomOutBtn').click());
  $('railExport').addEventListener('click', () => $('exportPngBtn').click());
  const log = $('logScale'), rl = $('railLog');
  const syncLog = () => rl.setAttribute('aria-pressed', log.checked ? 'true' : 'false');
  rl.addEventListener('click', () => { log.checked = !log.checked; log.dispatchEvent(new Event('change', { bubbles: true })); log.dispatchEvent(new Event('input', { bubbles: true })); syncLog(); });
  log.addEventListener('change', syncLog); syncLog();
  window.irlabShowPane = show;
})();

/* Build 136: the language menu. Saves the same setting as the editor's menu (uiLang), translates the page through
   i18n/tr.js, and redraws the chart, whose labels are drawn into the canvas. */
(function fLanguage() {
  const sel = document.getElementById('fLang');
  if (!sel || !window.irlabTr) return;
  sel.value = irlabTr.lang;
  sel.addEventListener('change', () => {
    try { localStorage.setItem('uiLang', sel.value); } catch (e) {}
    // once the language's table has loaded and the page is translated, redraw the chart for its canvas labels
    irlabTr.set(sel.value, () => { try { if (typeof draw === 'function') draw(); if (typeof drawStrip === 'function') drawStrip(); } catch (e) {} });
  });
})();
