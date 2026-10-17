(() => {
const FAM = location.pathname.replace(/^\/|\/$/g, '');
const KEY = 'irlab_' + FAM;
const store = JSON.parse(localStorage.getItem(KEY) || '{"items":{},"done":false}');
const save = () => localStorage.setItem(KEY, JSON.stringify(store));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function xlsx(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer()); const dv = new DataView(buf.buffer);
  let e = buf.length - 22; while (e > 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  const cnt = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = {};
  for (let i = 0; i < cnt; i++) { const meth = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    files[new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl))] = { meth, csz, off }; p += 46 + nl + xl + cl; }
  const read = async n => { const f = files[n]; if (!f) return null; const lnl = dv.getUint16(f.off + 26, true), lxl = dv.getUint16(f.off + 28, true); const d = buf.subarray(f.off + 30 + lnl + lxl, f.off + 30 + lnl + lxl + f.csz);
    if (f.meth === 0) return new TextDecoder().decode(d); return await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); };
  const ss = await read('xl/sharedStrings.xml'); const strs = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => m[1].replace(/<[^>]+>/g, '')) : [];
  const out = [];
  for (const sn of Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()) { const x = await read(sn); const rows = [];
    for (const rm of x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) { const row = {};
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) { const v = (cm[3] || '').match(/<v>([\s\S]*?)<\/v>/); let val = v ? v[1] : ''; if (/t="s"/.test(cm[2])) val = strs[+val]; else if (/t="inlineStr"/.test(cm[2])) val = (cm[3] || '').replace(/<[^>]+>/g, ''); row[cm[1]] = val; }
      rows.push(row); }
    out.push(rows); }
  return out; }
// every transmission column in the file becomes a curve (some files hold several filters or polarisations)
async function curves(url, lo = 250, hi = 1200, tol = 0.01) {
  const sheets = await xlsx(url); const meta = {}; const res = [];
  for (const rows of sheets) {
    for (const r of rows) { const vals = Object.values(r).map(String); const i = vals.findIndex(v => /^Item #/.test(v)); if (i >= 0 && !meta.item) meta.item = vals[i + 1]; }
    const ri0 = rows.findIndex(r => Object.values(r).some(v => /Product Raw Data/.test(v))); if (ri0 >= 0 && !meta.desc && rows[ri0 + 1]) meta.desc = Object.values(rows[ri0 + 1]).find(v => v && v.length > 3);
    for (let ri = 0; ri < Math.min(40, rows.length); ri++) { const r = rows[ri]; const ks = Object.keys(r); const wk = ks.find(k => /wavelength/i.test(r[k])); if (!wk) continue;
      const tks = ks.filter(k => k !== wk && /transmi/i.test(r[k]) && !/density|OD/i.test(r[k])); if (!tks.length) continue;
      for (const tk of tks) { const raw = []; for (const rr of rows.slice(ri + 1)) { const w = parseFloat(rr[wk]), t = parseFloat(rr[tk]); if (isFinite(w) && isFinite(t)) raw.push([w, t]); }
        if (raw.length < 5) continue; let unit = /%/.test(r[tk]) ? 100 : (Math.max(...raw.map(p => p[1])) > 1.5 ? 100 : 1); raw.sort((a, b) => a[0] - b[0]);
        const at = l => { if (l <= raw[0][0]) return raw[0][1]; if (l >= raw[raw.length - 1][0]) return raw[raw.length - 1][1]; let a = 0, b = raw.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (raw[m][0] <= l) a = m; else b = m; } const [x0, y0] = raw[a], [x1, y1] = raw[b]; return y0 + (l - x0) / (x1 - x0 || 1) * (y1 - y0); };
        const a = Math.max(lo, Math.ceil(raw[0][0])), b = Math.min(hi, Math.floor(raw[raw.length - 1][0])); if (b - a < 20) continue;
        const g = []; for (let l = a; l <= b; l++) g.push([l, Math.max(0, Math.min(1, at(l) / unit))]);
        const keep = new Uint8Array(g.length); keep[0] = keep[g.length - 1] = 1;
        const dp = (i, j) => { let md = 0, mi = -1; const [x0, y0] = g[i], [x1, y1] = g[j]; for (let k = i + 1; k < j; k++) { const y = y0 + (g[k][0] - x0) / (x1 - x0) * (y1 - y0); const d = Math.abs(g[k][1] - y); if (d > md) { md = d; mi = k; } } if (md > tol) { keep[mi] = 1; dp(i, mi); dp(mi, j); } };
        dp(0, g.length - 1); const c = []; g.forEach((p, i) => { if (keep[i]) c.push(p[0], +p[1].toFixed(4)); });
        res.push({ col: r[tk], range: [raw[0][0], raw[raw.length - 1][0]], curve: c }); }
      break; } }
  return { ...meta, curves: res }; }
async function run() {
  const ids = [...new Set([...document.querySelectorAll('a[onclick*="infoIcon"]')].map(a => (a.getAttribute('onclick').match(/infoIcon\('([^']+)'/) || [])[1]).filter(Boolean))];
  store.ids = ids; save();
  const seenUrl = new Set(Object.values(store.items).map(v => v.url));
  for (const id of ids) {
    if (store.items[id]) continue;
    infoIcon(id); const t0 = Date.now(); let u = null;
    while (Date.now() - t0 < 4500) { const a = [...document.querySelectorAll('a[href*=".xls"],a[href*=".csv"],a[href*=".txt"]')].find(a => a.href.toLowerCase().includes(id.toLowerCase()) || a.closest('[role=dialog]')); if (a && !seenUrl.has(a.href)) { u = a.href; break; } await sleep(250); }
    // the popup's own text (title and any spec lines) is kept with the data
    const dlg = [...document.querySelectorAll('[role=dialog]')].map(d => d.innerText).join(' | ').replace(/\s+/g, ' ').slice(0, 400);
    document.querySelectorAll('[aria-label="Close"],button.close,.tl-dialog__close').forEach(b => { try { b.click(); } catch (e) {} });
    if (!u) { store.items[id] = { url: null, dlg }; save(); continue; }
    seenUrl.add(u);
    try { store.items[id] = { url: u, dlg, ...(await curves(u)) }; } catch (e) { store.items[id] = { url: u, dlg, error: String(e) }; }
    save(); await sleep(150);
  }
  store.done = true; save();
}
if (!window.__irlabRunning) { window.__irlabRunning = true; run().finally(() => { window.__irlabRunning = false; }); }
return { family: FAM, have: Object.keys(store.items).length };
})()
