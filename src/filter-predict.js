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

   Sensors (build 149): a real converted Sony A7III, measured 300-800nm by Crowther (J. Imaging 2022, 8:54) and
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

function fpRender() {
  const out = $('fpOut');
  const chips = $('fpStack');
  chips.innerHTML = fpStack.map((id, i) => {
    const f = fpData.byId[id];
    return '<span class="fpChip">' + f[1] + ' <small>' + f[2] + '</small><button type="button" data-i="' + i + '" aria-label="Remove ' + f[1] + '">×</button></span>';
  }).join('');
  const sensor = $('fpSensor').value, r = fpCompute(fpStack, sensor);
  if (r.peakT < 0.005) { out.innerHTML = '<p class="note">This stack blocks essentially everything between 300 and 1100nm.</p>'; return; }
  const pct = v => Math.round(v * 100) + '%';
  const name = { R: 'Red', G: 'Green', B: 'Blue' };
  const rows = r.res.map(c => '<tr><td><b>' + c.ch + '</b></td><td>' + (c.rel > 0.02 ? Math.round(c.centre) + 'nm' : '—') + '</td><td>' +
    pct(c.uv) + '</td><td>' + pct(c.vis) + '</td><td>' + pct(c.ir) + '</td><td>' + pct(c.rel) + '</td></tr>').join('');
  const g = r.res.map(c => c.gain), gn = g.map(x => (x / g[1]));
  /* Build 152: one suggestion again, with its reasoning. The six swap buttons already live in the Swap & mix panel, so
     listing them here as well only duplicated them. The suggestion is the wavelength-ordered swap (longest band in red,
     shortest in blue: the colour infrared film convention), and it says where foliage (bright in near-IR, dark in
     visible red and blue) and blue sky (bright in blue and UV, dark in IR) will tend to land, so it is clear what is
     being suggested and why. It is a starting point; the look stays the photographer's. */
  const OUT = ['red', 'green', 'blue'];
  const band = c => c.ir >= 0.6 ? 'mostly IR' : c.uv >= 0.5 ? 'mostly UV' : c.vis >= 0.6 ? 'mostly visible' : 'mixed';
  const LABEL = { '012': 'No swap', '210': 'R\u2194B', '021': 'G\u2194B', '102': 'R\u2194G', '120': 'Rotate \u21bb', '201': 'Rotate \u21ba' };
  const irs = r.res.map(c => c.ir), irSpread = Math.max(...irs) - Math.min(...irs);
  const mostIR = irs.indexOf(Math.max(...irs));
  const leastIR = r.res.map((c, i) => [c.ir + c.centre / 1e4, i]).sort((x, y) => x[0] - y[0])[0][1];
  let swaps;
  if (r.spread < 15) swaps = '<p class="note">All three channels record nearly the same band (centres within ' + Math.round(r.spread) +
    'nm), so any swap only reshuffles small differences: expect a near-monochrome result whatever you choose.</p>';
  else {
    const perm = r.perm;
    const shows = OUT.map((o, i) => { const c = r.res[+perm[i]]; return o + ' shows ' + c.ch + ' (' + band(c) + ')'; }).join(' \u00b7 ');
    let hint = '';
    if (irSpread > 0.15) {
      const fol = OUT[perm.indexOf(String(mostIR))], sky = OUT[perm.indexOf(String(leastIR))];
      hint = ' Foliage tends toward ' + fol + (fol === sky ? '' : ' and blue sky toward ' + sky) + '.';
    }
    swaps = '<p class="note">Suggested: <b>' + LABEL[perm] + '</b> \u2014 channels in wavelength order, longest in red and shortest in blue, ' +
      'the colour infrared film convention. ' + shows + '.' + hint + ' A starting point; any other swap is one tap away in Swap &amp; mix.</p>';
    if (perm !== '012') swaps += '<button type="button" class="swapBtn fpPerm" data-perm="' + perm + '">Apply ' + LABEL[perm] + '</button>';
  }
  out.innerHTML = (fpStack.length ? '' : '<p class="note">No filter added: this is the bare full-spectrum sensor. Add the filter(s) on your lens.</p>') +
    '<table class="fpTbl"><thead><tr><th></th><th>centre</th><th>UV</th><th>visible</th><th>IR</th><th>strength</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    swaps +
    '<p class="note">A grey card in daylight should need gains of about R ' + gn[0].toFixed(2) + ' · G 1.00 · B ' + gn[2].toFixed(2) +
    ' before the swap; the grey picker measures the real figure for your camera.</p>' +
    '<p class="note">Filter curves from the database (badges show what each rests on). Sensor: ' + sensor + '. ' +
    ((fpData.sensorNotes || {})[sensor] || '') + ' Daylight: ' + fpData.illuminant + '. Your own body will differ somewhat, ' +
    'so read this as the shape of the answer and let the grey picker set the exact balance.</p>';
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
  $('fpOut').addEventListener('click', e => { const b = e.target.closest('.fpPerm'); if (b && typeof mxApplyPerm === 'function') mxApplyPerm(b.dataset.perm); });
}
fpInit();
