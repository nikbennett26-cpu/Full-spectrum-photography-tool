/* ---------- Filter stack picker (was Predict from your filters, build 148; the prediction card was removed in build 183) ----------
   Pick the filters on the lens and this works out, from their measured curves, what each sensor channel actually
   records, then suggests the swap that puts the channels in wavelength order. Data: filter-data.json, generated from
   the filters page's own database at build time (tools/editor_filters.mjs), so both pages always agree. Fetched only
   when the panel is first opened.

   The physics, per channel c:   signal_c(l) = filter(l) x sensor_c(l) x daylight(l)
   From that: how much of the channel's signal is UV (<400nm), visible or infrared (>700nm), the signal-weighted
   centre wavelength, the channel's relative strength, and the gains a grey card would need (what the grey picker
   will find). The suggested swap (build 152) is the wavelength-ordered one, the colour infrared film convention,
   stated with where foliage and sky will tend to land; it is a starting point, not a verdict.

   Sensors (build 149): a real converted Sony A7III, measured 300-800nm by JMC Scientific Consulting Ltd (Dr Jonathan Crowther; J. Imaging 2022, 8:54; credited as he asked) and
   extended past 800nm under the assumptions stated in tools/editor_filters.mjs; a generic CMOS approximation; one
   real astronomy sensor. Each sensor's note says which it is. Treat the numbers as the shape of the answer, not your
   camera's exact response. */
let fpData = null, fpLoading = null, fpStack = [];

function fpLoad() {
  if (fpData) return Promise.resolve(fpData);
  if (!fpLoading) {
    const b = (document.querySelector('meta[name="irlab-build"]') || {}).content || '';
    fpLoading = fetch('filter-data.json?b=' + b).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { fpData = d; d.byId = Object.fromEntries(d.filters.map(f => [f[0], f])); return d; });
  }
  return fpLoading;
}

/* Build 158: the stack is remembered between visits (a converted camera usually wears the same filters for a whole
   shoot) and is what export writes into each file's metadata (src/look-export.js). Names are kept beside the ids so the
   export line can show them before the filter database has been fetched. */
const FP_KEY = 'irlab.fpStack';
function fpSave() {
  try { localStorage.setItem(FP_KEY, JSON.stringify(fpStack.map(id => [id, fpData && fpData.byId[id] ? fpData.byId[id][1] : (fpNames[id] || id)]))); } catch (e) {}
  if (typeof stackMetaRefresh === 'function') stackMetaRefresh();
}
let fpNames = {};
try { (JSON.parse(localStorage.getItem(FP_KEY) || '[]') || []).forEach(([id, n]) => { if (id) { fpStack.push(id); fpNames[id] = n; } }); } catch (e) {}
function fpStackNames() { return fpStack.map(id => fpData && fpData.byId[id] ? fpData.byId[id][1] : (fpNames[id] || id)); }

/* Build 180: search. Matches on name, short description and id with spaces and punctuation ignored, so "tiffen12",
   "Tiffen 12" and "#12" all work, and a number on its own finds every filter carrying it. Tiffen (and most US makers)
   number their contrast filters by the Wratten system, so "Tiffen 12" also offers Wratten 12. */
const fpNorm = t => String(t || '').toLowerCase().replace(/[‐-―]/g, '-').replace(/[^a-z0-9+]+/g, '');
function fpTokens(q) {
  return String(q).toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z]{2,})/g, '$1 $2')
    .split(/[^a-z0-9+]+/).filter(Boolean);
}
function fpSearch(q) {
  if (!fpData) return { hits: [], exact: true };
  const qn = fpNorm(q); if (!qn) return { hits: [], exact: true };
  let toks = fpTokens(q);
  const wr = /(?:tiffen|kodak|wratten|#)\s*#?\s*(\d+[a-z]?)/i.exec(q);
  const alias = wr ? 'wratten' + wr[1].toLowerCase() : null;
  const scored = [];
  fpData.filters.forEach(f => {
    const nm = fpNorm(f[1]), hay = nm + ' ' + fpNorm(f[0]) + ' ' + fpNorm(f[5]);
    let sc = 0;
    if (nm === qn) sc = 100;
    else if (nm.startsWith(qn)) sc = 80;
    else if (nm.includes(qn)) sc = 70;
    else if (alias && nm.startsWith(alias) && !/\d/.test(nm.slice(alias.length, alias.length + 1))) sc = 75;
    else if (hay.includes(qn)) sc = 50;
    else {
      const got = toks.filter(t => /^\d/.test(t) ? new RegExp('(^|[^0-9])' + t + '($|[^0-9])').test(f[1].toLowerCase() + ' ' + f[0]) : hay.includes(t)).length;
      if (got === toks.length) sc = 40; else if (got) sc = 10 * got / toks.length;
    }
    if (sc) scored.push([sc, f]);
  });
  scored.sort((x, y) => y[0] - x[0] || x[1][1].length - y[1][1].length);
  const exact = scored.length && scored[0][0] >= 40;
  const hits = scored.filter(x => exact ? x[0] >= 40 : true).slice(0, 8).map(x => x[1]);
  return { hits, exact, alias: alias && /tiffen/i.test(q) && hits.some(f => fpNorm(f[1]).startsWith(alias)) ? wr[1] : null };
}
const fpEsc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fpRenderResults() {
  const box = $('fpResults'), q = $('fpSearch').value.trim();
  if (!q) { box.innerHTML = ''; return; }
  if (!fpData) { box.innerHTML = '<p class="note">Loading the filter database…</p>'; return; }
  const { hits, exact, alias } = fpSearch(q);
  if (!hits.length) { box.innerHTML = '<p class="note fpNone">No match for “' + fpEsc(q) + '”. Try the number on the ring, e.g. 12 or 720.</p>'; return; }
  box.innerHTML = (exact ? '' : '<p class="note fpNone">No exact match for “' + fpEsc(q) + '”. Closest:</p>') +
    (alias ? '<p class="note fpAlias">Tiffen ' + fpEsc(alias) + ' = Wratten ' + fpEsc(alias) + '</p>' : '') +
    hits.map(f => {
      const on = fpStack.includes(f[0]);
      return '<button type="button" class="fpHit' + (on ? ' on' : '') + '" role="option" aria-selected="' + on + '" data-id="' + fpEsc(f[0]) + '">' +
        '<span class="fpHitN">' + fpEsc(f[1]) + '</span><span class="fpHitD">' + fpEsc(f[5] || '') + '</span>' +
        '<span class="fpHitA">' + (on ? '✓ on lens' : '+ Add') + '</span></button>';
    }).join('');
}

function fpRender() {
  fpStack = fpStack.filter(id => fpData.byId[id]);   // a filter since removed from the database drops out
  $('fpStack').innerHTML = fpStack.map((id, i) => {
    const f = fpData.byId[id];
    return '<span class="fpChip">' + fpEsc(f[1]) + '<button type="button" data-i="' + i + '" aria-label="Remove ' + fpEsc(f[1]) + '">×</button></span>';
  }).join('');
  $('fpClear').hidden = fpStack.length < 2;
  fpRenderResults();
}

/* Build 183: the Predict card is gone. What is left is the filter picker in the Export panel, which records the stack in
   the exported file and feeds the IR leak estimate. The database loads the first time the search box is used. */
function fpInit() {
  const sIn = $('fpSearch'); if (!sIn) return;
  let ready = false;
  const boot = () => { if (ready) return; fpLoad().then(() => { ready = true; fpRender(); }).catch(() => {}); };
  const add = id => {
    if (!fpData || !fpData.byId[id]) return;
    const i = fpStack.indexOf(id);
    if (i >= 0) fpStack.splice(i, 1); else fpStack.push(id);   // tapping a filter already added takes it off
    fpRender(); fpSave();
    if (typeof haptic === 'function') haptic('select');
  };
  sIn.addEventListener('focus', boot);
  sIn.addEventListener('input', () => { boot(); fpRenderResults(); });
  sIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const h = $('fpResults').querySelector('.fpHit:not(.on)') || $('fpResults').querySelector('.fpHit'); if (h) { add(h.dataset.id); sIn.value = ''; fpRenderResults(); } }
    else if (e.key === 'Escape') { sIn.value = ''; fpRenderResults(); }
  });
  $('fpResults').addEventListener('click', e => { const b = e.target.closest('.fpHit'); if (b) add(b.dataset.id); });
  $('fpStack').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) { fpStack.splice(+b.dataset.i, 1); if (fpData) fpRender(); fpSave(); } });
  $('fpClear').addEventListener('click', () => { fpStack = []; if (fpData) fpRender(); fpSave(); });
  // show the remembered stack straight away; names are stored beside the ids, so this needs no database
  $('fpStack').innerHTML = fpStack.map((id, i) => '<span class="fpChip">' + fpEsc(fpNames[id] || id) + '<button type="button" data-i="' + i + '" aria-label="Remove">×</button></span>').join('');
}
fpInit();
