/* Second pass, for Edmund products whose page has no interactive curve, only a "Curve" PDF (most of the hard-coated
   bandpass range). Those PDFs are Excel charts saved as PDF, so the plotted line is stored as exact vector
   coordinates: this reads the line, calibrates it against the chart's own axis labels and gridlines, and keeps the
   transmission series. Run after collect.js, on an edmundoptics.co.uk page; results go to localStorage irlab_ed2_pdf. */
(() => {
const KEY = 'irlab_ed2_pdf'; const sleep = ms => new Promise(r => setTimeout(r, ms)); const num = parseFloat;
const main = JSON.parse(localStorage.getItem('irlab_ed2'));
const store = JSON.parse(localStorage.getItem(KEY) || '{"items":{},"docs":{}}');
const save = () => localStorage.setItem(KEY, JSON.stringify(store));
async function pdfContent(url) {
  const b = new Uint8Array(await (await fetch(url)).arrayBuffer()); const s = new TextDecoder('latin1').decode(b); let best = '';
  if (!/^%PDF/.test(s)) return { notPdf: true };
  for (const m of s.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)) {
    if (/DCTDecode|\/Subtype\/Image|XRef/.test(s.slice(Math.max(0, m.index - 250), m.index + m[0].length))) continue;
    const L = +m[1], st = m.index + m[0].length;
    const txt = await Promise.race([new Response(new Blob([b.slice(st, st + L)]).stream().pipeThrough(new DecompressionStream('deflate'))).text().catch(() => ''), sleep(3000).then(() => '')]);
    if (txt.length > best.length && / re\b/.test(txt)) best = txt; }
  return { t: best };
}
function extract(t) {
  const labels = [...t.matchAll(/BT([\s\S]*?)ET/g)].map(m => { const tm = m[1].match(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm/); const txt = [...m[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map(x => x[1].replace(/\\(.)/g, '$1')).join(''); return { x: tm ? num(tm[5]) : 0, y: tm ? num(tm[6]) : 0, rot: tm ? Math.abs(num(tm[2])) > 0.5 : false, txt }; });
  const numL = labels.filter(l => /^-?\d+(\.\d+)?$/.test(l.txt) && !l.rot);
  const rects = [...t.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)].map(m => m.slice(1, 5).map(num)).filter(r => r[2] > 150 && r[3] > 100).sort((a, b) => a[2] * a[3] - b[2] * b[3]);
  const pr = rects[0]; if (!pr) return { error: 'no plot area' };
  const [px, py, pw, ph] = pr;
  const segs = [...t.matchAll(/([-\d.]+) ([-\d.]+) m\s+([-\d.]+) ([-\d.]+) l/g)].map(m => m.slice(1, 5).map(num));
  const hor = segs.filter(s => Math.abs(s[1] - s[3]) < 0.01 && Math.abs(s[2] - s[0]) > pw * 0.8).map(s => s[1]);
  const vtick = segs.filter(s => Math.abs(s[0] - s[2]) < 0.01 && Math.abs(s[1] - s[3]) < 10 && Math.min(s[1], s[3]) < py).map(s => s[0]);
  const vgrid = segs.filter(s => Math.abs(s[0] - s[2]) < 0.01 && Math.abs(s[1] - s[3]) > ph * 0.8).map(s => s[0]);
  const yl = numL.filter(l => l.x < px && l.y > py - 6).sort((a, b) => a.y - b.y);
  const xl = numL.filter(l => l.y < py - 6).sort((a, b) => a.x - b.x);
  const yPos = [...new Set([py, ...hor.filter(y => y > py + 1 && y < py + ph - 1), py + ph].map(v => +v.toFixed(2)))].sort((a, b) => a - b);
  let xPos = [...new Set((vtick.length ? vtick : vgrid).map(v => +v.toFixed(2)))].sort((a, b) => a - b);
  if (xPos.length !== xl.length) xPos = [...new Set([px, ...vgrid, px + pw].map(v => +v.toFixed(2)))].sort((a, b) => a - b);
  if (xPos.length !== xl.length) xPos = xl.map((l, i) => px + pw * i / (xl.length - 1));
  if (yl.length < 2 || xl.length < 2) return { error: 'axis labels not found' };
  if (yl.length !== yPos.length) return { error: 'y axis ' + yl.length + ' labels vs ' + yPos.length + ' lines' };
  const fit = (P, V) => { const n = P.length, mx = P.reduce((a, b) => a + b) / n, mv = V.reduce((a, b) => a + b) / n; let sxx = 0, sxv = 0; P.forEach((p, i) => { sxx += (p - mx) ** 2; sxv += (p - mx) * (V[i] - mv); }); const a = sxv / sxx; return { a, b: mv - a * mx, resid: Math.max(...P.map((p, i) => Math.abs(a * p + (mv - a * mx) - V[i]))) }; };
  const fy = fit(yPos, yl.map(l => num(l.txt))), fx = fit(xPos, xl.map(l => num(l.txt)));
  if (fx.resid > 2 || fy.resid > 1) return { error: 'axis calibration off' };
  const ymax = Math.max(...yl.map(l => num(l.txt)));
  const series = [];
  for (const m of t.matchAll(/([\d.]+ [\d.]+ [\d.]+) RG([\s\S]*?)\bS\b/g)) {
    const xs = [], ys = []; for (const op of m[2].matchAll(/((?:[-\d.]+ ){2,6})(m|l|c)\b/g)) { const v = op[1].trim().split(/\s+/).map(num); xs.push(fx.a * v[v.length - 2] + fx.b); ys.push(fy.a * v[v.length - 1] + fy.b); }
    if (xs.length > 50) series.push({ colour: m[1], xs, ys }); }
  const ylabel = labels.filter(l => l.rot).map(l => l.txt).join(' / ');
  const title = labels.filter(l => !numL.includes(l) && l.y > py + ph).map(l => l.txt).join(' | ');
  return { ymax, ylabel, title, series, resid: [+fx.resid.toFixed(2), +fy.resid.toFixed(3)] };
}
function thin(xs, ys, unit) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter(p => isFinite(p[0]) && isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  const at = l => { if (l <= pts[0][0]) return pts[0][1]; if (l >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]; let a = 0, b = pts.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (pts[m][0] <= l) a = m; else b = m; } const [x0, y0] = pts[a], [x1, y1] = pts[b]; return y0 + (l - x0) / (x1 - x0 || 1) * (y1 - y0); };
  const g = []; for (let l = 280; l <= 1100; l++) g.push([l, Math.max(0, Math.min(1, at(l) / unit))]);
  const keep = new Uint8Array(g.length); keep[0] = keep[g.length - 1] = 1;
  const dp = (i, j) => { let md = 0, mi = -1; const [x0, y0] = g[i], [x1, y1] = g[j]; for (let k = i + 1; k < j; k++) { const y = y0 + (g[k][0] - x0) / (x1 - x0) * (y1 - y0); const d = Math.abs(g[k][1] - y); if (d > md) { md = d; mi = k; } } if (md > 0.01) { keep[mi] = 1; dp(i, mi); dp(mi, j); } };
  dp(0, g.length - 1); const c = []; g.forEach((p, i) => { if (keep[i]) c.push(p[0], +p[1].toFixed(4)); });
  return { range: [+pts[0][0].toFixed(1), +pts[pts.length - 1][0].toFixed(1)], curve: c };
}
async function run() {
  // products with no interactive transmission curve, one per size group
  const groups = {};
  for (const [F, fam] of Object.entries(main.fams)) for (const [P, it] of Object.entries(fam.items || {})) {
    if ((it.curves || []).some(c => /transmi/i.test(c) && !/block|reflect|optical density/i.test(c))) continue;
    const k = F + '|' + (it.slug || '').replace(/-?\d+(\.\d+)?(mm|in)(-(dia|diameter|sq|x-\d+(\.\d+)?mm))?/g, '').replace(/-+/g, '-');
    if (!groups[k] || /25mm|25-mm/.test(it.slug)) groups[k] = { F, P, ...it }; }
  for (const [k, g] of Object.entries(groups)) {
    if (store.items[k]) continue;
    let rec = { fam: g.F, part: g.P, stock: g.stock, slug: g.slug };
    try {
      const h = await (await fetch('/Catalog/PartNumber/_Documents?materialNumber=' + (g.stock || '').replace('-', '') + '&partNumberID=' + g.P)).text();
      const m = h.match(/href="([^"]+)"[^>]*>\s*Curve\s*</i);
      if (!m) rec.error = 'no curve';
      else if (store.docs[m[1]]) rec.dupOf = store.docs[m[1]];
      else { store.docs[m[1]] = k; rec.doc = m[1];
        const pc = await pdfContent(m[1]);
        if (pc.notPdf) rec.error = 'not a PDF'; else if (!pc.t) rec.error = 'image only';
        else { const ex = extract(pc.t); if (ex.error) rec.error = ex.error;
          else { rec.title = ex.title; rec.ylabel = ex.ylabel; rec.resid = ex.resid; rec.series = ex.series.map(s => ({ colour: s.colour, n: s.xs.length, ...thin(s.xs, s.ys, ex.ymax > 1.5 ? 100 : 1) })); } } }
    } catch (e) { rec.error = String(e); }
    store.items[k] = rec; save(); await sleep(150);
  }
  store.done = true; save();
}
if (!window.__pdfRunning) { window.__pdfRunning = true; run().finally(() => { window.__pdfRunning = false; }); }
return 'pdf pass started';
})()
