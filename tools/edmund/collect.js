/* Run in the browser console on any edmundoptics.co.uk page (set window.IRLAB_ED_FAMS to a list of product-family ids
   first). Edmund's product pages draw their curves from a JSON endpoint, and this uses the same three requests the
   site itself makes:
     /Catalog/ProductFamily/_ProductGrid/?productFamilyID=F    the family's products (and stock numbers)
     /Catalog/PartNumber/_CurveData/?partNumberID=P&...         the curves listed for one product
     /Catalog/PartNumber/GetChartData/?curveIds=C               one curve's measured/design data points
   Products in different sizes share a curve, so each curve id is fetched once. Only transmission curves are kept
   (not blocking/OD or reflection), resampled to 1nm over 280-1100nm and thinned to within 1 percentage point.
   Progress is kept in localStorage under irlab_ed2, so it can be stopped and restarted. See README.md. */
(() => {
const FAMS = window.IRLAB_ED_FAMS;
const KEY = 'irlab_ed2';
const store = JSON.parse(localStorage.getItem(KEY) || '{"fams":{},"curves":{}}');
const save = () => localStorage.setItem(KEY, JSON.stringify(store));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function thin(xs, ys, pct) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter(p => isFinite(p[0]) && isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  const unit = pct ? 100 : 1;
  const at = l => { if (l <= pts[0][0]) return pts[0][1]; if (l >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]; let a = 0, b = pts.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (pts[m][0] <= l) a = m; else b = m; } const [x0, y0] = pts[a], [x1, y1] = pts[b]; return y0 + (l - x0) / (x1 - x0 || 1) * (y1 - y0); };
  const g = []; for (let l = 280; l <= 1100; l++) g.push([l, Math.max(0, Math.min(1, at(l) / unit))]);
  const keep = new Uint8Array(g.length); keep[0] = keep[g.length - 1] = 1;
  const dp = (i, j) => { let md = 0, mi = -1; const [x0, y0] = g[i], [x1, y1] = g[j]; for (let k = i + 1; k < j; k++) { const y = y0 + (g[k][0] - x0) / (x1 - x0) * (y1 - y0); const d = Math.abs(g[k][1] - y); if (d > md) { md = d; mi = k; } } if (md > 0.01) { keep[mi] = 1; dp(i, mi); dp(mi, j); } };
  dp(0, g.length - 1); const c = []; g.forEach((p, i) => { if (keep[i]) c.push(p[0], +p[1].toFixed(4)); });
  return { range: [pts[0][0], pts[pts.length - 1][0]], curve: c };
}
async function family(F) {
  const fam = store.fams[F] || (store.fams[F] = { parts: null, done: false });
  if (fam.done) return;
  if (!fam.parts) {
    const g = await (await fetch('/Catalog/ProductFamily/_ProductGrid/?productFamilyID=' + F + '&isPreviewMode=False&previewCode=')).text();
    const doc = new DOMParser().parseFromString(g, 'text/html');
    const parts = {};
    doc.querySelectorAll('tr').forEach(tr => { const a = tr.querySelector('a[href*="/p/"]'); if (!a) return; const m = a.getAttribute('href').match(/\/p\/([^/]+)\/(\d+)/); if (!m) return; const stock = (tr.innerText.match(/#\s?(\d{2,3}-\d{3})/) || [])[1] || ''; parts[m[2]] = { slug: m[1], stock }; });
    [...g.matchAll(/\/p\/([a-z0-9.\-]+)\/(\d+)/gi)].forEach(m => { if (!parts[m[2]]) parts[m[2]] = { slug: m[1], stock: '' }; });
    fam.parts = parts; fam.items = {}; save(); }
  for (const [P, info] of Object.entries(fam.parts)) {
    if (fam.items[P]) continue;
    try {
      const h = await (await fetch('/Catalog/PartNumber/_CurveData/?partNumberID=' + P + '&productFamilyID=' + F + '&previewCode=')).text();
      const curves = [...h.matchAll(/GetChartData\((\d+)\);"[^>]*>\s*([^<]*?)\s*</g)].map(m => ({ id: m[1], name: m[2].replace(/&#\d+;|&\w+;/g, s => new DOMParser().parseFromString(s, 'text/html').body.textContent) }));
      fam.items[P] = { ...info, curves: curves.map(c => c.id + ':' + c.name) };
      for (const c of curves) {
        if (store.curves[c.id] || !/transmi/i.test(c.name) || /block|reflect|optical density/i.test(c.name)) continue;
        const j = await (await fetch('/Catalog/PartNumber/GetChartData/?curveIds=' + c.id + '&min=&max=')).json();
        const it = j.lineChartItems && j.lineChartItems[0];
        if (!it || !it.xDataList || !it.xDataList.length) { store.curves[c.id] = { name: c.name, error: 'no data' }; continue; }
        const pct = it.isPercentage || /%/.test(it.curve.ylabel || '') || Math.max(...it.yDataList) > 1.5;
        store.curves[c.id] = { name: c.name, fam: F, part: P, stock: info.stock, slug: info.slug, ylabel: it.curve.ylabel, n: it.xDataList.length, ...thin(it.xDataList, it.yDataList, pct) };
        save(); await sleep(150);
      }
    } catch (e) { fam.items[P] = { ...info, error: String(e) }; }
    save(); await sleep(100);
  }
  fam.done = true; save();
}
async function run() { for (const f of FAMS) await family(f); store.allDone = true; save(); }
if (!window.__edRunning) { window.__edRunning = true; run().finally(() => { window.__edRunning = false; }); }
return { fams: FAMS.length };
})()
