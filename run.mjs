// Colour-pipeline regression suite for irlab.
//   node run.mjs --update      write golden.json from the current build (do this once you are
//                              happy with how it looks, and again after any intended change)
//   node run.mjs               compare the current build to golden.json and run the property tests
//   node run.mjs --file ../other/index.html   test a different build
// Rendering uses software WebGL (SwiftShader) so results do not depend on your GPU.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases, properties } from './cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const update = args.includes('--update');
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : path.join(here, '..', 'index.html');
const goldenPath = path.join(here, args.includes('--golden') ? args[args.indexOf('--golden') + 1] : 'golden.json');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

let pptr;
try { pptr = (await import('puppeteer')).default; } catch { pptr = (await import('puppeteer-core')).default; }
const launchOpts = {
  headless: process.env.CHROME_HEADLESS || true,
  args: process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS)
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'],
};
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;

// ---- thresholds, in OKLab units (1 is black to white; ~0.02 is a just-noticeable difference) ----
const MEAN_TOL = 0.003, P99_TOL = 0.02, GRID_W = 80, GRID_H = 60;

// ---- colour helpers (Node side) ----
const s2l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
function toOKLab(r, g, b) {
  r = s2l(r); g = s2l(g); b = s2l(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function deltaE(a, b) {   // a, b: Uint8 RGB arrays of equal length
  const n = a.length / 3, ds = new Float64Array(n); let sum = 0, max = 0;
  for (let i = 0; i < n; i++) {
    const p = toOKLab(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]), q = toOKLab(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]);
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); ds[i] = d; sum += d; if (d > max) max = d;
  }
  const sorted = Array.from(ds).sort((x, y) => x - y);
  return { mean: sum / n, p99: sorted[Math.floor(n * 0.99)], max };
}

const browser = await pptr.launch(launchOpts);
const fixtures = {};
async function openFixture(name) {
  if (fixtures[name]) return fixtures[name];
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 1400 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + path.resolve(fileArg), { waitUntil: 'load' });
  await (await page.$('#fi')).uploadFile(path.join(here, 'fixtures', name + '.png'));
  await page.waitForFunction(() => typeof loadedImage !== 'undefined' && loadedImage && typeof engine !== 'undefined' && engine, { timeout: 60000 });
  await new Promise(r => setTimeout(r, 600));
  await page.evaluate(() => { window.__irl = {
    set(s) { for (const id in (s || {})) { const el = document.getElementById(id); if (el) { el.value = s[id]; el.dispatchEvent(new Event('input', { bubbles: true })); } } },
    clear() { resetAllControls(); },
    grid(w, h) {
      const p = Object.assign(currentParams(), { dither: false, clipView: false, gamutDrag: false });
      engine.render(p);
      const px = engine.readPixels(), W = engine.canvas.width, H = engine.canvas.height, out = new Uint8Array(w * h * 3);
      const bx = W / w, by = H / h;
      for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = Math.floor(gy * by); y < Math.floor((gy + 1) * by); y++) for (let x = Math.floor(gx * bx); x < Math.floor((gx + 1) * bx); x++) { const i = (y * W + x) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
        const o = (gy * w + gx) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
      }
      return Array.from(out);
    },
  }; });
  fixtures[name] = { page, errors };
  return fixtures[name];
}
async function render(fx, spec) {
  const { page } = fx;
  return page.evaluate((spec, GW, GH) => {
    const I = window.__irl;
    I.clear();
    if (spec.hueSpace && typeof hueSpace !== 'undefined') hueSpace = spec.hueSpace;
    if (spec.m) MCELLS.forEach((id, i) => { const el = document.getElementById(id); el.value = spec.m[i]; el.dispatchEvent(new Event('input', { bubbles: true })); });
    if (typeof curveState !== 'undefined') {
      curveState = curveDefault();
      for (const k in (spec.curves || {})) curveState[k] = spec.curves[k];
    }
    I.set(spec.s);
    return I.grid(GW, GH);
  }, spec, GRID_W, GRID_H);
}

let golden = {};
if (!update) {
  if (!fs.existsSync(goldenPath)) { console.error('No golden.json yet. Run with --update first.'); await browser.close(); process.exit(2); }
  golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
}
const results = []; const newGolden = {};
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  const fx = await openFixture(c.img);
  const got = await render(fx, c);
  newGolden[c.name] = got;
  if (update) { results.push({ name: c.name, status: 'written' }); continue; }
  const g = golden[c.name];
  if (!g) { results.push({ name: c.name, status: 'NEW (no golden)' }); continue; }
  const d = deltaE(g, got);
  const pass = d.mean <= MEAN_TOL && d.p99 <= P99_TOL;
  results.push({ name: c.name, status: pass ? 'pass' : 'FAIL', mean: +d.mean.toFixed(5), p99: +d.p99.toFixed(4), max: +d.max.toFixed(4) });
}
if (update) { fs.writeFileSync(goldenPath, JSON.stringify(Object.assign(only ? golden : {}, newGolden))); console.log('golden.json written:', Object.keys(newGolden).length, 'cases'); }

// ---- property tests ----
const propResults = [];
if (!update) for (const pr of properties) {
  if (only && !pr.name.includes(only)) continue;
  const fx = await openFixture(pr.img);
  const P = {
    render: (s, extra) => render(fx, Object.assign({ s }, extra || {})),
    deltaE,
    meanLuma: async (s) => { const g = await render(fx, { s }); let t = 0; for (let i = 0; i < g.length; i += 3) t += toOKLab(g[i], g[i + 1], g[i + 2])[0]; return t / (g.length / 3); },
    lampChroma: async (s) => {
      const base = await render(fx, {}), g = await render(fx, { s }); let t = 0, n = 0;
      for (let i = 0; i < base.length; i += 3) { const L = toOKLab(base[i], base[i + 1], base[i + 2]); if (L[0] > 0.6 && Math.hypot(L[1], L[2]) > 0.08) { const o = toOKLab(g[i], g[i + 1], g[i + 2]); t += Math.hypot(o[1], o[2]); n++; } }
      return n ? t / n : 0;
    },
  };
  try { const r = await pr.run(P); propResults.push({ name: pr.name, ok: r.ok, detail: r.detail }); }
  catch (e) { propResults.push({ name: pr.name, ok: false, detail: String(e) }); }
}

let failed = 0;
if (!update) {
  console.log('\nGolden comparison (OKLab delta E; mean tol ' + MEAN_TOL + ', 99th pct tol ' + P99_TOL + ')');
  for (const r of results) { console.log((r.status === 'pass' ? '  ok   ' : '  ' + r.status.padEnd(5)) + ' ' + r.name.padEnd(28) + (r.mean !== undefined ? ' mean ' + r.mean + '  p99 ' + r.p99 + '  max ' + r.max : '')); if (r.status !== 'pass') failed++; }
  console.log('\nProperties');
  for (const r of propResults) { console.log((r.ok ? '  ok   ' : '  FAIL ') + r.name + '  ' + JSON.stringify(r.detail)); if (!r.ok) failed++; }
  for (const k in fixtures) if (fixtures[k].errors.length) console.log('\nPage errors on ' + k + ':', fixtures[k].errors.slice(0, 3));
  console.log('\n' + (failed ? failed + ' problem(s)' : 'All good'));
}
await browser.close();
process.exit(failed ? 1 : 0);
