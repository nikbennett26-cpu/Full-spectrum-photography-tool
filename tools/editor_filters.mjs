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

/* Build 391: each 10nm step holds the filter's MEAN transmission across that step (l-5 to l+5, 1nm trapezoid), not its
   value at the one wavelength. The editor adds these steps up, so the mean is the quantity it needs, and a point sample
   was badly wrong for anything narrower than the grid: a 3nm laser-line filter centred between two steps read as passing
   nothing, one centred on a step as passing a full 10nm (40 filters were out by more than 20%, 80 by more than 5%).
   Smooth curves are unchanged to within rounding. */
const bandMean = (l, f) => {
  let sum = 0;
  for (let k = -5; k <= 5; k++) { const v = X.filterTBase(l + k, f); sum += (Number.isFinite(v) ? Math.max(0, v) : 0) * (k === -5 || k === 5 ? 0.5 : 1); }
  return sum / 10;
};
const filters = X.FILTERS.filter(f => f.g !== 'Custom').map(f => {
  const c = X.dataConfidence(f), p = X.provenanceOf(f), s = p.s && X.SOURCES[p.s];
  return [f.id, f.n, c.label, s ? s.who : '', WL.map(l => q(bandMean(l, f))), f.d || ''];   // [5] short description, searched by the editor's filter picker (build 180)
});
const sensors = {};
for (const [name, key] of [['Generic CMOS (approximation)', 'CMOS sensor'], ['Kodak KAF-8300 CCD (real, astronomy)', 'KAF 8300 CCD']]) {
  const s = X.CAMERA_QE_REAL[key];
  const m = Math.max(...['R', 'G', 'B'].flatMap(ch => s[ch].filter(Number.isFinite)));
  sensors[name] = Object.fromEntries(['R', 'G', 'B'].map(ch => [ch, WL.map(l => q(at(s[ch], l) / m))]));
}
/* Converted cameras measured 300-800nm by Dr Jonathan Crowther (JMC Scientific Consulting Ltd), traced into
   tools/sensors/*.json, each of which records how:
     Sony A7III multispectral (J. Imaging 2022, 8:54, Figure 1f; crowther2022_a7iii.json)
     Canon EOS 5DS R multispectral (Imaging Science Journal 2019, 67:268, Figure 5b; crowther2019_5dsr.json; build 267)
   Past 800nm neither paper has a measurement, so each is extended under two stated, sourced assumptions: (1) the colour
   filter dyes become equally transparent for all three channels beyond about 800nm (J. Imaging 2022, Figure 7b; the 2019
   paper notes the channels closing up through 700-800nm), so the channels converge on the red channel's 800nm level
   over 800-860nm; (2) the common level then falls with silicon's response, taken from the real KAF-8300 sensor curve
   (its three channels also converge there). */
function crowtherSensor(file) {
  const A = JSON.parse(fs.readFileSync(path.join(here, 'sensors', file), 'utf8'));
  const kaf = sensors['Kodak KAF-8300 CCD (real, astronomy)'];
  const kmean = WL.map((l, i) => (kaf.R[i] + kaf.G[i] + kaf.B[i]) / 3);
  const k800 = kmean[WL.indexOf(800)];
  const peak = Math.max(...A.R, ...A.G, ...A.B);
  const lerp = (xs, ys, x) => { for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[ys.length - 1]; };
  const r800 = A.R[A.R.length - 1];
  return Object.fromEntries(['R', 'G', 'B'].map(ch => [ch, WL.map((l, i) => {
    if (l <= 800) return q(lerp(A.wavelength_nm, A[ch], l) / peak);
    const own = A[ch][A[ch].length - 1], w = Math.max(0, 1 - (l - 800) / 60);
    return q((w * own + (1 - w) * r800) * (kmean[i] / k800) / peak);
  })]));
}
sensors['Sony A7III full spectrum (measured to 800nm)'] = crowtherSensor('crowther2022_a7iii.json');
const CANON_5DSR = 'Canon 5DS R full spectrum (measured to 800nm)';
sensors[CANON_5DSR] = crowtherSensor('crowther2019_5dsr.json');
/* Build 249: four converted cameras measured 375-1000nm by MaxMax (LDP LLC), traced into
   tools/sensors/maxmax_spectral_response.json (which records how, and the caveats). Below 380nm the response is taken
   down to nothing by 340nm (the measurement starts at 375nm and every yellow-to-red stack blocks that region anyway).
   Past 1000nm each channel follows the fall-off SurfLabX measured on a modern full-spectrum sensor (to 0.38 at 1050nm and
   0.14 at 1100nm, geometric in between), which fades more slowly than the astronomy CCD used for the Sony extension. */
const MAXMAX_NAMES = { 'Canon 40D': 'Canon 40D full spectrum (MaxMax, measured 375-1000nm)', 'Nikon D300': 'Nikon D300 full spectrum (MaxMax, measured 375-1000nm)', 'Nikon D200': 'Nikon D200 full spectrum (MaxMax, measured 375-1000nm)', 'Nikon D700': 'Nikon D700 full spectrum (MaxMax, measured 375-1000nm)' };
{
  const M = JSON.parse(fs.readFileSync(path.join(here, 'sensors', 'maxmax_spectral_response.json'), 'utf8'));
  const wl = M.wavelength_nm, f50 = M.extension_past_1000nm.factor_1050, f100 = M.extension_past_1000nm.factor_1100;
  for (const [cam, data] of Object.entries(M.cameras)) {
    const peak = Math.max(...data.R, ...data.G, ...data.B);
    const read = (arr, l) => { if (l <= wl[0]) return arr[0]; for (let i = 1; i < wl.length; i++) if (l <= wl[i]) return arr[i - 1] + (arr[i] - arr[i - 1]) * (l - wl[i - 1]) / (wl[i] - wl[i - 1]); return arr[arr.length - 1]; };
    sensors[MAXMAX_NAMES[cam]] = Object.fromEntries(['R', 'G', 'B'].map(ch => [ch, WL.map(l => {
      const a = data[ch];
      if (l < 380) return q(Math.max(0, (l - 340) / 40) * a[0] / peak);
      if (l <= 1000) return q(read(a, l) / peak);
      const e = a[a.length - 1], k = l <= 1050 ? Math.pow(f50, (l - 1000) / 50) : f50 * Math.pow(f100 / f50, (l - 1050) / 50);
      return q(e * k / peak);
    })]));
  }
}
const sensorNotes = {
  'Sony A7III full spectrum (measured to 800nm)': 'Measured 300-800nm on a real converted body by JMC Scientific Consulting Ltd (Dr Jonathan Crowther), published in J. Imaging 2022, 8, 54 (doi:10.3390/jimaging8030054, CC BY 4.0); traced from the paper\u2019s Figure 1f. Past 800nm it is modelled: the colour filters stop separating the channels (same paper) and the response falls with silicon\u2019s.',
  [CANON_5DSR]: 'Measured 300-800nm on a real converted body (internal UV/IR filter removed, colour filter array kept) by Dr Jonathan Crowther (JMC Scientific Consulting Ltd), published in The Imaging Science Journal 2019, 67, 268-276 (doi:10.1080/13682199.2019.1638664); traced from the paper\u2019s Figure 5b. Past 800nm it is modelled the same way as the Sony A7III. The one to use for a converted Canon.',
  'Generic CMOS (approximation)': 'A generic approximation, not a measured camera; no data past 1000nm.',
  'Kodak KAF-8300 CCD (real, astronomy)': 'A real measured sensor, but an astronomy CCD, not a camera body.',
  ...Object.fromEntries(Object.values(MAXMAX_NAMES).map(n => [n, 'Measured on a real converted body by MaxMax (LDP LLC) with a monochromator, 375-1000nm, and traced from their published chart; past 1000nm it follows the fall-off SurfLabX measured on a modern full-spectrum sensor. Use with care: above about 840nm its three channels do not come together, which the direct measurements of other converted cameras show they should (Crowther 2022, Sony A7 III; Aphalo 2024, Olympus E-M1), so the values were probably read after white balance or a colour conversion in Photoshop. The default Sony A7 III curve is the safer choice.' + (/Canon/.test(n) ? ' For a converted Canon, the Canon 5DS R curve (measured directly) is the safer choice.' : '')]))
};
const illKey = Object.keys(X.ILLUMINANTS_REAL)[0];
const ill = X.ILLUMINANTS_REAL[illKey], im = Math.max(...ill.filter(Number.isFinite));
const out = {
  note: 'Generated by tools/editor_filters.mjs from src-filters. Transmission is on-axis, 0-1; sensors normalised to their own peak.',
  wl: [300, 1100, 10], illuminant: illKey, sensorNotes, ill: WL.map(l => q(at(ill, l) / im)), sensors, filters,
};
const order = ['Sony A7III full spectrum (measured to 800nm)', CANON_5DSR, MAXMAX_NAMES['Canon 40D'], MAXMAX_NAMES['Nikon D300'], MAXMAX_NAMES['Nikon D200'], MAXMAX_NAMES['Nikon D700'], 'Generic CMOS (approximation)', 'Kodak KAF-8300 CCD (real, astronomy)'];
out.sensors = Object.fromEntries(order.map(k => [k, sensors[k]]));
fs.writeFileSync(path.join(here, '..', 'filter-data.json'), JSON.stringify(out));
console.log(`filter-data.json: ${filters.length} filters, ${Object.keys(sensors).length} sensors`);
