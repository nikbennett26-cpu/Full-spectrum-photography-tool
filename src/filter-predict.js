/* ---------- Predict from your filters (build 148) ----------
   Pick the filters on the lens and this works out, from their measured curves, what each sensor channel actually
   records, then suggests the swap that puts the channels in wavelength order. Data: filter-data.json, generated from
   the filters page's own database at build time (tools/editor_filters.mjs), so both pages always agree. Fetched only
   when the panel is first opened.

   The physics, per channel c:   signal_c(l) = filter(l) x sensor_c(l) x daylight(l)
   From that: how much of the channel's signal is UV (<400nm), visible or infrared (>700nm), the signal-weighted
   centre wavelength, the channel's relative strength, and the gains a grey card would need (what the grey picker
   will find). The suggested swap sorts channels by centre wavelength and sends the longest to red, the shortest to
   blue, which is how colour infrared film maps bands to colours. Behind a 590 or 720nm filter that ordering comes out
   as the familiar red/blue swap; it is derived here, not assumed.

   Honest limits, stated in the panel too: there is no measured sensor curve for real converted camera bodies in any
   open dataset yet, so this uses a generic CMOS approximation (or one real astronomy sensor). Treat the numbers as
   the shape of the answer, not your camera's exact response. */
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

function fpRender() {
  const out = $('fpOut'), apply = $('fpApply');
  const chips = $('fpStack');
  chips.innerHTML = fpStack.map((id, i) => {
    const f = fpData.byId[id];
    return '<span class="fpChip">' + f[1] + ' <small>' + f[2] + '</small><button type="button" data-i="' + i + '" aria-label="Remove ' + f[1] + '">×</button></span>';
  }).join('');
  const sensor = $('fpSensor').value, r = fpCompute(fpStack, sensor);
  if (r.peakT < 0.005) { out.innerHTML = '<p class="note">This stack blocks essentially everything between 300 and 1100nm.</p>'; apply.style.display = 'none'; return; }
  const pct = v => Math.round(v * 100) + '%';
  const name = { R: 'Red', G: 'Green', B: 'Blue' };
  const rows = r.res.map(c => '<tr><td><b>' + c.ch + '</b></td><td>' + (c.rel > 0.02 ? Math.round(c.centre) + 'nm' : '—') + '</td><td>' +
    pct(c.uv) + '</td><td>' + pct(c.vis) + '</td><td>' + pct(c.ir) + '</td><td>' + pct(c.rel) + '</td></tr>').join('');
  const permTxt = r.perm === '012' ? 'no swap' :
    ['R', 'G', 'B'].map((o, i) => o + '←' + 'RGB'[+r.perm[i]]).filter((t, i) => +r.perm[i] !== i).join(', ');
  const g = r.res.map(c => c.gain), gn = g.map(x => (x / g[1]));
  let verdict;
  if (r.spread < 15) verdict = 'All three channels record nearly the same band (centres within ' + Math.round(r.spread) +
    'nm), so any swap only reshuffles small differences: expect a near-monochrome result whatever you choose.';
  else verdict = 'Suggested: <b>' + permTxt + '</b>. This puts the channels in wavelength order, longest in red and shortest in blue, ' +
    'the way colour infrared film maps bands to colours. Centres span ' + Math.round(r.spread) + 'nm.';
  out.innerHTML = (fpStack.length ? '' : '<p class="note">No filter added: this is the bare full-spectrum sensor. Add the filter(s) on your lens.</p>') +
    '<table class="fpTbl"><thead><tr><th></th><th>centre</th><th>UV</th><th>visible</th><th>IR</th><th>strength</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p class="note">' + verdict + '</p>' +
    '<p class="note">A grey card in daylight should need gains of about R ' + gn[0].toFixed(2) + ' · G 1.00 · B ' + gn[2].toFixed(2) +
    ' before the swap; the grey picker measures the real figure for your camera.</p>' +
    '<p class="note">Filter curves from the database (badges show what each rests on). Sensor: ' + sensor +
    ', daylight: ' + fpData.illuminant + '. No open dataset has a measured converted camera body yet, so read this as the ' +
    'shape of the answer, not your exact camera.</p>';
  apply.style.display = (r.spread >= 15 && r.perm !== '012') ? '' : 'none';
  apply.dataset.perm = r.perm;
}

function fpInit() {
  const wrap = $('fpWrap'); if (!wrap) return;
  let ready = false;
  wrap.addEventListener('toggle', () => {
    if (!wrap.open || ready) return;
    $('fpOut').innerHTML = '<p class="note">Loading the filter database…</p>';
    fpLoad().then(d => {
      ready = true;
      $('fpList').innerHTML = d.filters.map(f => '<option value="' + f[1].replace(/"/g, '&quot;') + '">').join('');
      $('fpSensor').innerHTML = Object.keys(d.sensors).map(k => '<option>' + k + '</option>').join('');
      fpRender();
    }).catch(() => { $('fpOut').innerHTML = '<p class="note">Could not load the filter database (offline before it was ever opened?).</p>'; });
  });
  const add = () => {
    const v = $('fpSearch').value.trim().toLowerCase(); if (!v || !fpData) return;
    const f = fpData.filters.find(x => x[1].toLowerCase() === v) || fpData.filters.find(x => x[1].toLowerCase().includes(v));
    if (!f) return;
    fpStack.push(f[0]); $('fpSearch').value = ''; fpRender();
  };
  $('fpSearch').addEventListener('change', add);
  $('fpSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  $('fpStack').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) { fpStack.splice(+b.dataset.i, 1); fpRender(); } });
  $('fpSensor').addEventListener('change', () => fpData && fpRender());
  $('fpApply').addEventListener('click', () => { if (typeof mxApplyPerm === 'function') mxApplyPerm($('fpApply').dataset.perm); });
}
fpInit();
