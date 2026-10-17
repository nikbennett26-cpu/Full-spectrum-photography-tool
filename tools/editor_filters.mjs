// Build filter-data.json: the filter database, sensor responses and daylight spectrum the editor's
// "Predict from your filters" panel needs, without the editor loading the whole filters page.
//   node tools/editor_filters.mjs        (tools/build.py runs it on every build)
// Everything comes from the same sources the filters page uses: each filter's on-axis transmission from
// src-filters (so the editor and the filters page can never disagree), and the sensor and illuminant curves
// from src-filters/spectral.js (CheeseCube312's Filter-Plotter-Data). Sampled every 10nm from 300 to 1100nm.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src-filters');
const WL = []; for (let l = 300; l <= 1100; l += 10) WL.push(l);

const stub = () => new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : stub(), apply: () => stub(), construct: () => stub(), set: () => true });
const ctx = { console, Math, JSON, Set, Map, Array, Object, String, Number, RegExp, Error, parseFloat, parseInt, isNaN, isFinite,
  document: stub(), localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en' }, location: { search: '', hash: '' },
  addEventListener() {}, setTimeout: () => 0, $: () => null };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
let code = '';
for (const f of ['model', 'schott', 'data', 'thorlabs', 'edmund', 'provenance'])
  code += '\n' + fs.readFileSync(path.join(SRC, f + '.js'), 'utf8').replace(/^'use strict';\n/, '');
const spectral = fs.readFileSync(path.join(SRC, 'spectral.js'), 'utf8');
code += '\n' + spectral.slice(spectral.indexOf('const CAMERA_QE_REAL'), spectral.indexOf('const REFLECTORS_REAL'));
code += '\n;globalThis.__out={FILTERS,REAL_CURVES,filterTBase,dataConfidence,provenanceOf,SOURCES,CAMERA_QE_REAL,ILLUMINANTS_REAL};';
vm.runInContext(code, ctx, { filename: 'src-filters' });
const X = ctx.__out;

const q = v => (v == null || !Number.isFinite(v)) ? 0 : Math.round(Math.max(0, v) * 1000) / 1000;
const at = (arr, l) => arr[l - 300];   // spectral.js curves sit on a 300-1100nm, 1nm grid

const filters = X.FILTERS.filter(f => f.g !== 'Custom').map(f => {
  const c = X.dataConfidence(f), p = X.provenanceOf(f), s = p.s && X.SOURCES[p.s];
  return [f.id, f.n, c.label, s ? s.who : '', WL.map(l => q(X.filterTBase(l, f)))];
});
const sensors = {};
for (const [name, key] of [['Generic CMOS (approximation)', 'CMOS sensor'], ['Kodak KAF-8300 CCD (real, astronomy)', 'KAF 8300 CCD']]) {
  const s = X.CAMERA_QE_REAL[key];
  const m = Math.max(...['R', 'G', 'B'].flatMap(ch => s[ch].filter(Number.isFinite)));
  sensors[name] = Object.fromEntries(['R', 'G', 'B'].map(ch => [ch, WL.map(l => q(at(s[ch], l) / m))]));
}
/* Sony A7III multispectral conversion, measured 300-800nm (Crowther 2022, J. Imaging 8:54, Figure 1f; traced into
   tools/sensors/crowther2022_a7iii.json, which records how). Past 800nm the paper has no measurement, so it is
   extended under two stated, sourced assumptions: (1) the colour filter dyes become equally transparent for all three
   channels beyond about 800nm (the same paper, Figure 7b), so the channels converge on the red channel's 800nm level
   over 800-860nm; (2) the common level then falls with silicon's response, taken from the real KAF-8300 sensor curve
   (its three channels also converge there). */
{
  const A = JSON.parse(fs.readFileSync(path.join(here, 'sensors', 'crowther2022_a7iii.json'), 'utf8'));
  const kaf = sensors['Kodak KAF-8300 CCD (real, astronomy)'];
  const kmean = WL.map((l, i) => (kaf.R[i] + kaf.G[i] + kaf.B[i]) / 3);
  const k800 = kmean[WL.indexOf(800)];
  const peak = Math.max(...A.R, ...A.G, ...A.B);
  const lerp = (xs, ys, x) => { for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[ys.length - 1]; };
  const r800 = A.R[A.R.length - 1];
  sensors['Sony A7III full spectrum (measured to 800nm)'] = Object.fromEntries(['R', 'G', 'B'].map(ch => [ch, WL.map((l, i) => {
    if (l <= 800) return q(lerp(A.wavelength_nm, A[ch], l) / peak);
    const own = A[ch][A[ch].length - 1], w = Math.max(0, 1 - (l - 800) / 60);
    return q((w * own + (1 - w) * r800) * (kmean[i] / k800) / peak);
  })]));
}
const sensorNotes = {
  'Sony A7III full spectrum (measured to 800nm)': 'Measured 300-800nm on a real converted body (Crowther 2022, J. Imaging 8:54, CC BY 4.0), traced from the paper\u2019s figure. Past 800nm it is modelled: the colour filters stop separating the channels (same paper) and the response falls with silicon\u2019s.',
  'Generic CMOS (approximation)': 'A generic approximation, not a measured camera; no data past 1000nm.',
  'Kodak KAF-8300 CCD (real, astronomy)': 'A real measured sensor, but an astronomy CCD, not a camera body.'
};
const illKey = Object.keys(X.ILLUMINANTS_REAL)[0];
const ill = X.ILLUMINANTS_REAL[illKey], im = Math.max(...ill.filter(Number.isFinite));
const out = {
  note: 'Generated by tools/editor_filters.mjs from src-filters. Transmission is on-axis, 0-1; sensors normalised to their own peak.',
  wl: [300, 1100, 10], illuminant: illKey, sensorNotes, ill: WL.map(l => q(at(ill, l) / im)), sensors, filters,
};
const order = ['Sony A7III full spectrum (measured to 800nm)', 'Generic CMOS (approximation)', 'Kodak KAF-8300 CCD (real, astronomy)'];
out.sensors = Object.fromEntries(order.map(k => [k, sensors[k]]));
fs.writeFileSync(path.join(here, '..', 'filter-data.json'), JSON.stringify(out));
console.log(`filter-data.json: ${filters.length} filters, ${Object.keys(sensors).length} sensors`);
