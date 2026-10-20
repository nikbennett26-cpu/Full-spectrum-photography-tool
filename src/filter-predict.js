/* ---------- Predict from your filters (build 148) ----------
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

function fpCompute(ids, sensorName) {
  const d = fpData, [lo, , step] = d.wl, s = d.sensors[sensorName];
  const n = d.ill.length, T = new Array(n).fill(1);
  ids.forEach(id => { const f = d.byId[id]; if (f) f[4].forEach((t, i) => { T[i] *= t; }); });
  const res = ['R', 'G', 'B'].map(ch => {
    let tot = 0, uv = 0, ir = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      const l = lo + i * step, v = T[i] * s[ch][i] * d.ill[i];
      tot += v; wsum += v * l;
      if (l < 400) uv += v; else if (l > 700) ir += v;
    }
    return { ch, tot, uv: tot ? uv / tot : 0, ir: tot ? ir / tot : 0, vis: tot ? 1 - (uv + ir) / tot : 0, centre: tot ? wsum / tot : 0 };
  });
  const max = Math.max(...res.map(r => r.tot));
  res.forEach(r => { r.rel = max ? r.tot / max : 0; r.gain = r.tot ? max / r.tot : Infinity; });
  // wavelength order: longest centre -> output red, shortest -> output blue (only among channels with real signal)
  const order = [0, 1, 2].sort((a, b) => res[b].centre - res[a].centre);
  const perm = order.join('');
  const live = res.filter(r => r.rel > 0.02);
  const spread = live.length > 1 ? Math.max(...live.map(r => r.centre)) - Math.min(...live.map(r => r.centre)) : 0;
  return { res, perm, spread, peakT: Math.max(...T) };
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
  if (!hits.length) { box.innerHTML = '<p class="note fpNone">No filter matches “' + fpEsc(q) + '”. Try the number on the ring (e.g. 12, 720, 093) or the glass (e.g. BG38).</p>'; return; }
  box.innerHTML = (exact ? '' : '<p class="note fpNone">No exact match for “' + fpEsc(q) + '”. Closest:</p>') +
    (alias ? '<p class="note fpAlias">Tiffen numbers its filters by the Wratten system, so Tiffen ' + fpEsc(alias) + ' is Wratten ' + fpEsc(alias) + '.</p>' : '') +
    hits.map(f => {
      const on = fpStack.includes(f[0]);
      return '<button type="button" class="fpHit' + (on ? ' on' : '') + '" role="option" aria-selected="' + on + '" data-id="' + fpEsc(f[0]) + '">' +
        '<span class="fpHitN">' + fpEsc(f[1]) + '</span><span class="fpHitD">' + fpEsc(f[5] || '') + '</span>' +
        '<span class="fpHitA">' + (on ? '✓ on lens' : '+ Add') + '</span></button>';
    }).join('');
}

function fpRender() {
  fpStack = fpStack.filter(id => fpData.byId[id]);   // a filter since removed from the database drops out
  const out = $('fpOut');
  $('fpStack').innerHTML = fpStack.length ? fpStack.map((id, i) => {
    const f = fpData.byId[id];
    return '<span class="fpChip">' + fpEsc(f[1]) + ' <small>' + f[2] + '</small><button type="button" data-i="' + i + '" aria-label="Remove ' + fpEsc(f[1]) + '">×</button></span>';
  }).join('') : '<p class="note fpEmpty">Nothing yet: the readout below is the bare full-spectrum sensor.</p>';
  $('fpClear').hidden = fpStack.length < 2;
  fpRenderResults();
  const sensor = $('fpSensor').value, r = fpCompute(fpStack, sensor);
  if (r.peakT < 0.005) { out.innerHTML = '<p class="note">This stack blocks essentially everything between 300 and 1100nm: check you haven’t combined a filter that passes only infrared with one that blocks it.</p>'; return; }
  const pct = v => Math.round(v * 100) + '%';
  const rows = r.res.map(c => '<tr><td><b>' + c.ch + '</b></td><td>' + (c.rel > 0.02 ? Math.round(c.centre) + 'nm' : '—') + '</td><td>' +
    pct(c.uv) + '</td><td>' + pct(c.vis) + '</td><td>' + pct(c.ir) + '</td><td>' + pct(c.rel) + '</td></tr>').join('');
  const g = r.res.map(c => c.gain), gn = g.map(x => (x / g[1]));
  /* Build 180: the answer first, in words: what each channel of the camera records. The suggestion (build 152) is the
     wavelength-ordered swap, the colour infrared film convention, with where foliage and sky will tend to land. The
     numbers and sources fold away underneath. */
  const OUT = ['red', 'green', 'blue'];
  const band = c => c.rel <= 0.02 ? 'almost nothing' : c.ir >= 0.6 ? 'mostly infrared' : c.uv >= 0.5 ? 'mostly UV' : c.vis >= 0.6 ? 'mostly visible light' : 'a mix of ' + [c.uv >= 0.2 ? 'UV' : '', c.vis >= 0.2 ? 'visible' : '', c.ir >= 0.2 ? 'infrared' : ''].filter(Boolean).join(' and ');
  const LABEL = { '012': 'No swap', '210': 'R↔B', '021': 'G↔B', '102': 'R↔G', '120': 'Rotate ↻', '201': 'Rotate ↺' };
  const NAME = { R: 'Red', G: 'Green', B: 'Blue' };
  const sees = '<ul class="fpSees">' + r.res.map(c => '<li><b class="rl-' + c.ch.toLowerCase() + '">' + NAME[c.ch] + '</b> records ' + band(c) +
    (c.rel > 0.02 ? ' <span>around ' + Math.round(c.centre) + 'nm' + (c.rel < 0.25 ? ', weak' : '') + '</span>' : '') + '</li>').join('') + '</ul>';
  const irs = r.res.map(c => c.ir), irSpread = Math.max(...irs) - Math.min(...irs);
  const mostIR = irs.indexOf(Math.max(...irs));
  const leastIR = r.res.map((c, i) => [c.ir + c.centre / 1e4, i]).sort((x, y) => x[0] - y[0])[0][1];
  let swaps;
  if (r.spread < 15) swaps = '<p class="note fpSug">All three channels record nearly the same band, so swapping only reshuffles small differences: expect a near-monochrome result whatever you choose.</p>';
  else {
    const perm = r.perm;
    let hint = '';
    if (irSpread > 0.15) {
      const fol = OUT[perm.indexOf(String(mostIR))], sky = OUT[perm.indexOf(String(leastIR))];
      hint = ' Foliage will tend toward ' + fol + (fol === sky ? '' : ', blue sky toward ' + sky) + '.';
    }
    swaps = '<p class="note fpSug">Suggested swap: <b>' + LABEL[perm] + '</b>. It puts the channels in wavelength order (longest in red, shortest in blue), the colour infrared film convention.' + hint + '</p>';
    if (perm !== '012') swaps += '<button type="button" class="swapBtn fpPerm" data-perm="' + perm + '">Apply ' + LABEL[perm] + '</button>';
  }
  out.innerHTML = sees + swaps +
    '<details class="fpMore"><summary>Numbers and sources</summary>' +
    '<table class="fpTbl"><thead><tr><th></th><th>centre</th><th>UV</th><th>visible</th><th>IR</th><th>strength</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p class="note">A grey card in daylight should need gains of about R ' + gn[0].toFixed(2) + ' · G 1.00 · B ' + gn[2].toFixed(2) +
    ' before the swap; the grey picker measures the real figure for your camera.</p>' +
    '<p class="note">Filter curves from the database (badges show what each rests on). Sensor: ' + sensor + '. ' +
    ((fpData.sensorNotes || {})[sensor] || '') + ' Daylight: ' + fpData.illuminant + '. Your own body will differ somewhat, ' +
    'so read this as the shape of the answer and let the grey picker set the exact balance.</p></details>';
}

function fpInit() {
  const wrap = $('fpWrap'); if (!wrap) return;
  let ready = false;
  const boot = () => {
    if (ready) return;
    $('fpOut').innerHTML = '<p class="note">Loading the filter database…</p>';
    fpLoad().then(d => {
      ready = true;
      $('fpSensor').innerHTML = Object.keys(d.sensors).map(k => '<option>' + k + '</option>').join('');
      fpRender();
    }).catch(() => { $('fpOut').innerHTML = '<p class="note">Could not load the filter database (offline before it was ever opened?).</p>'; });
  };
  wrap.addEventListener('toggle', () => { if (wrap.open) boot(); });
  const add = id => {
    if (!fpData || !fpData.byId[id]) return;
    const i = fpStack.indexOf(id);
    if (i >= 0) fpStack.splice(i, 1); else fpStack.push(id);   // tapping a filter already on the lens takes it off
    fpRender(); fpSave();
    if (typeof haptic === 'function') haptic('select');
  };
  const sIn = $('fpSearch');
  sIn.addEventListener('input', () => { boot(); fpRenderResults(); });
  sIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const h = $('fpResults').querySelector('.fpHit:not(.on)') || $('fpResults').querySelector('.fpHit'); if (h) { add(h.dataset.id); sIn.value = ''; fpRenderResults(); } }
    else if (e.key === 'Escape') { sIn.value = ''; fpRenderResults(); }
  });
  // results: tap adds and keeps the search, so a second filter from the same search is one more tap
  $('fpResults').addEventListener('click', e => { const b = e.target.closest('.fpHit'); if (b) add(b.dataset.id); });
  $('fpStack').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) { fpStack.splice(+b.dataset.i, 1); fpRender(); fpSave(); } });
  $('fpClear').addEventListener('click', () => { fpStack = []; fpRender(); fpSave(); });
  $('fpSensor').addEventListener('change', () => fpData && fpRender());
  // build 172: one-tap example stacks, real combinations people use (build 180: plain names, no people)
  document.querySelectorAll('#fpExamples button[data-stack]').forEach(b => b.addEventListener('click', () => {
    if (!fpData) return;
    fpStack = b.dataset.stack.split(',').filter(id => fpData.byId[id]); fpRender(); fpSave();
  }));
  $('fpOut').addEventListener('click', e => { const b = e.target.closest('.fpPerm'); if (b && typeof mxApplyPerm === 'function') mxApplyPerm(b.dataset.perm); });
}
fpInit();
