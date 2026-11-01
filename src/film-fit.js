/* ---------- Fit the film to your camera and filters (build 240) ----------
   Works out the channel mix that makes YOUR camera, through YOUR filter stack, record what Kodak's colour infrared film
   recorded, the approach Nick Spiker took with measured equipment, done here from published data.

   Film side: Ektachrome Infrared Aero 8443 as tabulated in NASA Interagency Report 146 (Figure 2, constructed from Fritz
   1967): the fraction of each dye layer's exposure in each 50nm band, behind the minus-blue filter the film was always
   used with. Cyan forms from infrared, magenta from red, yellow from green, and the dyes put them out as red, green and
   blue, so the target is IR -> red, red -> green, green -> blue, each layer at its own spectral weighting. The same table
   the 8443 film preset was derived from; here it is fitted to your stack instead of a generic one.

   Camera side: filter transmission x sensor response x daylight (AM1.5), from the filter database (filter-data.json).

   The fit: for a set of realistic, smooth reflectance spectra (random pigment-like steps and bumps, plus the surfaces
   below), find the 3x3 mix that makes the camera's white-balanced channels give the film's layer exposures. Fitting
   on spectra rather than on the curves' shapes is what lets a narrow-band filter (the MidOpt triple band) be judged
   fairly: on smooth real-world surfaces a spike at 850nm stands in well for the film's broad infrared band even though
   the shapes look nothing alike. A grey stays grey (a weighted condition), and the mix is regularised so no output
   channel draws on more than about 2x the input (it is noise and clipping, not colour, that a bigger fit buys).

   Test surfaces: leaves, conifers, grass, stressed and autumn leaves from the PROSPECT-D leaf model with the SAIL
   canopy model (via the prosail package); bare soil from that package's soil spectrum; asphalt, clear water, red paint,
   a yellow flower and clear sky modelled from their usual shapes. Modelled, not measured, and said so in the panel.

   Using the result needs the camera's own channels, so on a RAW it switches the decode to Camera native (as the
   Infrared Ektachrome IE look does) and the mix runs in the Standard swap space, unwidened. Then a grey pick with the
   RAW white balance finishes it. On a JPEG the camera's colour is already baked in, so the fit is only approximate. */
const FF_8443 = [[500, .52, .04, .01], [550, .48, .13, .03], [600, 0, .50, .08], [650, 0, .33, .14], [700, 0, 0, .25], [750, 0, 0, .21], [800, 0, 0, .20], [850, 0, 0, .08]];   // band start nm, yellow, magenta, cyan
const FF_SURF = {"foliage":[0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.022,0.022,0.022,0.022,0.021,0.022,0.022,0.022,0.022,0.025,0.035,0.057,0.08,0.085,0.083,0.076,0.062,0.049,0.043,0.039,0.035,0.031,0.029,0.026,0.023,0.021,0.019,0.019,0.025,0.068,0.144,0.233,0.329,0.41,0.455,0.485,0.51,0.521,0.522,0.522,0.522,0.523,0.522,0.522,0.522,0.522,0.523,0.522,0.522,0.522,0.522,0.521,0.519,0.516,0.508,0.5,0.497,0.498,0.5,0.503,0.506,0.51,0.514,0.517,0.519,0.52,0.521,0.521,0.52,0.519],"conifer":[0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.016,0.022,0.035,0.047,0.049,0.048,0.045,0.037,0.031,0.027,0.025,0.023,0.02,0.019,0.017,0.015,0.013,0.012,0.012,0.016,0.042,0.08,0.121,0.162,0.194,0.211,0.222,0.232,0.236,0.237,0.238,0.239,0.239,0.24,0.24,0.24,0.24,0.241,0.241,0.241,0.241,0.241,0.241,0.24,0.238,0.235,0.231,0.23,0.231,0.231,0.233,0.234,0.236,0.238,0.239,0.24,0.241,0.241,0.241,0.241,0.24],"grass":[0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.022,0.022,0.022,0.023,0.023,0.023,0.024,0.029,0.041,0.067,0.095,0.105,0.105,0.099,0.081,0.065,0.057,0.052,0.047,0.041,0.038,0.034,0.028,0.025,0.021,0.021,0.032,0.09,0.177,0.272,0.365,0.436,0.474,0.497,0.516,0.525,0.526,0.526,0.527,0.528,0.528,0.528,0.529,0.529,0.53,0.53,0.53,0.53,0.53,0.53,0.528,0.525,0.518,0.51,0.508,0.509,0.511,0.514,0.518,0.522,0.526,0.529,0.531,0.532,0.533,0.533,0.532,0.531],"stressed":[0.025,0.025,0.025,0.025,0.025,0.025,0.025,0.025,0.025,0.025,0.025,0.025,0.025,0.025,0.025,0.026,0.027,0.029,0.029,0.032,0.039,0.052,0.072,0.093,0.11,0.121,0.122,0.113,0.102,0.095,0.092,0.087,0.08,0.077,0.072,0.06,0.051,0.038,0.037,0.071,0.151,0.224,0.279,0.321,0.35,0.368,0.382,0.394,0.405,0.413,0.42,0.427,0.433,0.439,0.443,0.448,0.453,0.457,0.46,0.463,0.466,0.468,0.47,0.471,0.472,0.472,0.47,0.471,0.473,0.475,0.479,0.482,0.484,0.487,0.49,0.491,0.493,0.494,0.495,0.495,0.495],"autumn":[0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.023,0.024,0.025,0.026,0.027,0.032,0.04,0.057,0.086,0.137,0.214,0.264,0.254,0.242,0.235,0.232,0.226,0.215,0.212,0.203,0.182,0.163,0.13,0.127,0.204,0.309,0.372,0.409,0.433,0.449,0.458,0.466,0.472,0.478,0.482,0.486,0.49,0.493,0.496,0.498,0.5,0.502,0.504,0.506,0.507,0.508,0.509,0.509,0.509,0.507,0.502,0.496,0.495,0.496,0.498,0.501,0.505,0.508,0.512,0.515,0.517,0.518,0.519,0.519,0.519,0.518],"soil":[0.238,0.238,0.238,0.238,0.238,0.238,0.238,0.238,0.238,0.238,0.238,0.234,0.23,0.225,0.222,0.222,0.223,0.225,0.227,0.229,0.233,0.239,0.244,0.249,0.254,0.259,0.264,0.268,0.273,0.278,0.283,0.288,0.294,0.299,0.303,0.308,0.315,0.321,0.327,0.332,0.336,0.342,0.347,0.354,0.358,0.363,0.369,0.373,0.377,0.382,0.386,0.391,0.396,0.401,0.403,0.408,0.411,0.415,0.419,0.423,0.425,0.428,0.432,0.437,0.439,0.442,0.444,0.446,0.449,0.452,0.457,0.458,0.46,0.462,0.463,0.463,0.464,0.467,0.468,0.47,0.472],"asphalt":[0.07,0.07,0.07,0.07,0.07,0.07,0.07,0.07,0.07,0.07,0.07,0.07,0.071,0.071,0.072,0.072,0.073,0.073,0.074,0.074,0.075,0.075,0.076,0.076,0.077,0.077,0.078,0.079,0.079,0.08,0.08,0.081,0.081,0.082,0.082,0.083,0.083,0.084,0.084,0.085,0.085,0.086,0.086,0.086,0.087,0.087,0.088,0.088,0.089,0.089,0.09,0.09,0.091,0.091,0.092,0.092,0.093,0.093,0.094,0.095,0.095,0.096,0.096,0.097,0.097,0.098,0.098,0.099,0.099,0.1,0.1,0.101,0.101,0.102,0.102,0.102,0.103,0.103,0.104,0.104,0.105],"water":[0.045,0.045,0.045,0.045,0.045,0.045,0.045,0.045,0.045,0.045,0.045,0.046,0.047,0.048,0.049,0.05,0.049,0.047,0.045,0.044,0.043,0.041,0.04,0.038,0.036,0.035,0.032,0.029,0.026,0.023,0.02,0.019,0.018,0.016,0.015,0.014,0.013,0.012,0.01,0.009,0.008,0.007,0.006,0.005,0.004,0.003,0.003,0.002,0.002,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001],"redpaint":[0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.051,0.052,0.058,0.072,0.114,0.211,0.375,0.539,0.636,0.678,0.693,0.698,0.699,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7],"yellowflower":[0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.051,0.053,0.058,0.074,0.118,0.223,0.4,0.577,0.682,0.726,0.742,0.747,0.749,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75],"sky":[0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.321,0.294,0.27,0.249,0.23,0.212,0.196,0.182,0.169,0.157,0.146,0.136,0.127,0.118,0.111,0.104,0.097,0.091,0.086,0.08,0.076,0.071,0.067,0.063,0.06,0.057,0.053,0.051,0.048,0.045,0.043,0.041,0.039,0.037,0.035,0.033,0.032,0.03,0.029,0.028,0.026,0.025,0.024,0.023,0.022,0.021,0.02,0.019,0.018,0.018,0.017,0.016,0.016,0.015,0.014,0.014,0.013,0.013,0.012,0.012,0.011,0.011,0.011,0.01,0.01],"grey":[0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18]};
const FF_SURF_NAMES = { foliage: 'Healthy leaves', conifer: 'Conifers', grass: 'Grass', stressed: 'Stressed plants', autumn: 'Autumn leaves', soil: 'Bare soil', asphalt: 'Asphalt', water: 'Clear water', redpaint: 'Red paint', yellowflower: 'Yellow flower', sky: 'Blue sky', grey: 'Grey card' };

function ffWl() { const [lo, hi, st] = fpData.wl, a = []; for (let w = lo; w <= hi + 1e-6; w += st) a.push(w); return a; }
/* the film's three layers on the database's wavelength grid: rows cyan (out red), magenta (out green), yellow (out blue).
   Build 241: the film can be put behind a different yellow or orange filter. The table is for the film behind the
   minus-blue filter Kodak specified, taken here as the Wratten 12; for any other filter each band is reweighted by that
   filter's average transmission over the Wratten 12's in the same band. An approximation at 50nm resolution, but it is
   what lets a Wratten 16 on the lens be judged against film shot through a Wratten 16 rather than through a 12.
   Build 244: the layers are no longer each rescaled to keep grey grey. That threw away exactly what deeper filters did
   to the film: behind a Wratten 25 the green-sensitive layer gets about 1% of its usual light, which is where the
   cherry-red foliage and greenish skies film shooters describe came from. Now only overall exposure is evened out (the
   infrared layer is kept at its Wratten 12 level, as the film would be metered), the cast stays, and the fit is asked
   to reproduce it (its grey condition aims at the film's grey, not at neutral). Only filters that cut on at or above the
   Wratten 12 are offered: below it blue reaches the film, and the table has no data for the film's blue sensitivity. */
const FF_FILM_FILTERS = [['w12', 'Wratten 12 (Kodak\u2019s data)'], ['w16', 'Wratten 16'], ['w21', 'Wratten 21 (orange)'], ['w25', 'Wratten 25 (red)'],
  ['bw023', 'B+W 023 (deep yellow)'], ['bw040', 'B+W 040 (yellow-orange)'], ['bw041', 'B+W 041 (orange)'], ['bw090', 'B+W 090 (red)'],
  ['hyg_y52', 'Y52 glass (as Nikon Y52)'], ['hyg_o56', 'O56 glass (as Nikon O56)']];
/* Build 245: Aerochrome III 1443, the film most people mean by "Aerochrome": the three layer sensitivity curves from
   Kodak's data sheet (KODAK 2006, Aerial Data AS-77, density 1.0 END, process AR-5), digitised for this from the copy
   of the chart reproduced in Lillesand et al. and posted by Andrea B. on UltravioletPhotography.com. log10 sensitivity
   every 10nm from 400 to 900nm; null where the curve is below the chart's -1.0 floor. Below about 560nm the magenta and
   cyan curves cross and both sit near the floor, so those few values are the least certain; behind any yellow filter
   that part of the spectrum barely reaches the film. Unlike the 8443 table, these curves have no filter or daylight in
   them, so the chosen filter and light are applied exactly rather than by band. */
const FF_1443 = {
  Y: [1.27, 1.25, 1.22, 1.19, 1.15, 1.15, 1.09, 1.06, 1.0, 0.94, 0.96, 1.02, 1.12, 1.19, 1.21, 1.23, 1.23, 1.14, 0.88, 0.34, -0.33, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  M: [1.05, 1.08, 1.14, 1.16, 1.16, 1.04, 0.92, 0.79, 0.63, 0.39, 0.06, -0.14, -0.21, -0.25, -0.22, -0.13, 0.01, 0.24, 0.4, 0.55, 0.7, 0.82, 0.98, 1.14, 1.33, 1.43, 1.3, 0.86, 0.04, -0.59, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  C: [0.55, 0.57, 0.62, 0.66, 0.68, 0.67, 0.62, 0.54, 0.42, 0.23, -0.02, -0.14, -0.11, 0.09, 0.02, -0.22, -0.27, -0.23, -0.18, -0.15, -0.09, -0.04, 0.02, 0.06, 0.11, 0.15, 0.19, 0.23, 0.27, 0.32, 0.35, 0.36, 0.39, 0.4, 0.39, 0.36, 0.32, 0.28, 0.26, 0.23, 0.22, 0.22, 0.19, 0.18, 0.13, 0.08, 0.01, -0.1, -0.26, -0.51, null]
};
const FF_FILMS = [['1443', 'Aerochrome III 1443 (Kodak data sheet)'], ['8443', 'Ektachrome Infrared Aero 8443 (NASA data)']];
/* Build 245: the light. The filter database's daylight is AM1.5 global, a sunny midday. The others are MODELLED from it
   with the textbook physics, and labelled so: low sun puts the light through about five atmospheres instead of one and a
   half (Rayleigh scattering, tau = 0.0088 lambda^-4.05 with lambda in micrometres, plus a light haze, 0.1 (lambda/0.55)^-1.3),
   which strips blue and leaves infrared, the reason infrared glows at golden hour; open shade is lit by blue sky alone,
   scattered light that falls off steeply into the red and infrared (taken as lambda^-3, between pure Rayleigh's -4 and
   a hazy sky); overcast is cloud-scattered light, nearly neutral, with a slight lean to blue (lambda^-0.6). */
const FF_LIGHTS = [['sun', 'Sun, midday'], ['low', 'Low sun (modelled)'], ['overcast', 'Overcast (modelled)'], ['shade', 'Open shade (modelled)']];
function ffIll(wl, light) {
  const base = fpData.ill;
  return base.map((v, i) => {
    const um = wl[i] / 1000, r = wl[i] / 550;
    if (light === 'low') { const tau = 0.0088 * Math.pow(um, -4.05) + 0.1 * Math.pow(r, -1.3); return v * Math.exp(-tau * (5 - 1.5)); }
    if (light === 'shade') return v * Math.pow(r, -3);
    if (light === 'overcast') return v * Math.pow(r, -0.6);
    return v;
  });
}
function ffFilm(wl, behind, film, light) {
  const T = id => fpData && fpData.byId[id] ? fpData.byId[id][4] : null, T12 = T('w12'), Tx = T(behind || 'w12') || T12;
  const I0 = fpData.ill, Ix = ffIll(wl, light || 'sun');
  let F;
  if (film === '8443') {
    F = [new Array(wl.length).fill(0), new Array(wl.length).fill(0), new Array(wl.length).fill(0)];
    const bandMean = (f, b) => { let s = 0, n = 0; wl.forEach((w, i) => { if (w >= b && w < b + 50) { s += f(i); n++; } }); return n ? s / n : 0; };
    FF_8443.forEach(([b, y, m, c]) => {
      // the table already holds the Wratten 12 and daylight; another filter or light reweights each band by the ratio
      const k = (T12 ? bandMean(i => Tx[i] * Ix[i], b) / Math.max(1e-9, bandMean(i => T12[i] * I0[i], b)) : 1);
      const n = wl.filter(w => w >= b && w < b + 50).length || 1;
      wl.forEach((w, i) => { if (w >= b && w < b + 50) { F[0][i] += k * c / n; F[1][i] += k * m / n; F[2][i] += k * y / n; } });
    });
  } else {
    const S = ['C', 'M', 'Y'].map(k => wl.map(w => { const j = Math.round((w - 400) / 10), v = (w >= 400 && w <= 900) ? FF_1443[k][j] : null; return v == null ? 0 : Math.pow(10, v); }));
    // balanced as Kodak intended it, behind a Wratten 12 in sunlight: each layer scaled so a grey gives the same exposure
    const g12 = S.map(s => s.reduce((a, v, i) => a + v * T12[i] * I0[i], 0) || 1);
    F = S.map((s, l) => s.map((v, i) => v * Tx[i] * Ix[i] / g12[l]));
  }
  const ir = F[0].reduce((a, v) => a + v, 0) || 1;   // even out exposure on the infrared layer, keep the cast
  F.forEach(f => f.forEach((v, i) => { f[i] = v / ir; }));
  F.grey = F.map(f => f.reduce((a, v) => a + v, 0));   // what a flat grey gives on the film: 1, 1, 1 behind a Wratten 12 in sun
  return F;
}
/* which filter the film is imagined behind: the one in your stack when it is one of these, else Kodak's Wratten 12 */
function ffFilmFilterDefault(stack) { const hit = FF_FILM_FILTERS.find(([id]) => stack.includes(id)); return hit ? hit[0] : 'w12'; }
let ffTrainCache = null;
function ffTrain(wl) {
  if (ffTrainCache && ffTrainCache.n === wl.length) return ffTrainCache.set;
  let s = 7 >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const U = (a, b) => a + (b - a) * rnd(), set = [];
  for (let k = 0; k < 600; k++) {
    const r = new Array(wl.length).fill(U(0.02, 0.3)), parts = 1 + Math.floor(rnd() * 3);
    for (let p = 0; p < parts; p++) {
      if (rnd() < 0.5) { const a = U(-0.3, 0.6), c = U(420, 950), w = U(6, 40); wl.forEach((x, i) => { r[i] += a / (1 + Math.exp(-(x - c) / w)); }); }
      else { const a = U(0, 0.5), c = U(400, 1000), w = U(25, 150); wl.forEach((x, i) => { r[i] += a * Math.exp(-0.5 * ((x - c) / w) ** 2); }); }
    }
    set.push(r.map(v => Math.min(1, Math.max(0.005, v))));
  }
  Object.values(FF_SURF).forEach(v => { if (v.length === wl.length) for (let k = 0; k < 15; k++) set.push(v); });
  ffTrainCache = { n: wl.length, set };
  return set;
}
/* what each camera channel records per wavelength: filters x sensor x daylight */
function ffKernel(stack, sensor, light) {
  const d = fpData, s = d.sensors[sensor] || d.sensors[Object.keys(d.sensors)[0]], n = d.ill.length, T = new Array(n).fill(1), I = ffIll(ffWl(), light || 'sun');
  stack.forEach(id => { const f = d.byId[id]; if (f) f[4].forEach((t, i) => { T[i] *= t; }); });
  return ['R', 'G', 'B'].map(c => s[c].map((v, i) => v * T[i] * I[i]));
}
const ffDot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
function ffOklab(c) {
  const [r, g, b] = c.map(v => Math.max(0, v));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function ffDE(a, b) { const p = ffOklab(a), q = ffOklab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100; }

function ffFit(stack, sensor, maxGain, behind, film, light) {
  maxGain = maxGain || 2.0;
  film = film || '1443'; light = light || 'sun';
  const wl = ffWl(), F = ffFilm(wl, behind || 'w12', film, light), K = ffKernel(stack, sensor, light);
  const g = K.map(k => k.reduce((a, b) => a + b, 0));
  if (g.some(v => !(v > 1e-9))) return { error: 'This stack lets almost nothing through to one of the channels.' };
  const Kn = K.map((k, c) => k.map(v => v / g[c]));   // white balanced: a flat grey gives 1, 1, 1
  const train = ffTrain(wl), X = train.map(r => Kn.map(k => ffDot(k, r))), Y = train.map(r => F.map(f => ffDot(f, r))), N = X.length;
  const XtX = [0, 0, 0, 0, 0, 0, 0, 0, 0]; X.forEach(x => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) XtX[i * 3 + j] += x[i] * x[j]; });
  const Wt = 200;
  const XtY = [0, 1, 2].map(l => [0, 1, 2].map(i => X.reduce((a, x, n) => a + x[i] * Y[n][l], 0) + Wt * F.grey[l]));
  const solve = lam => [0, 1, 2].map(l => {
    const Mi = bfMat3inv(XtX.map((v, k) => v + Wt + ((k % 4 === 0) ? lam * N : 0))), rhs = XtY[l];
    return [0, 1, 2].map(i => Mi[i * 3] * rhs[0] + Mi[i * 3 + 1] * rhs[1] + Mi[i * 3 + 2] * rhs[2]);
  });
  const big = A => Math.max(...A.map(r => Math.hypot(...r)));
  let A = solve(0);
  if (big(A) > maxGain) {
    let lo = 1e-9, hi = 10;
    for (let k = 0; k < 60; k++) { const mid = Math.sqrt(lo * hi); if (big(solve(mid)) > maxGain) lo = mid; else hi = mid; }
    A = solve(hi);
  }
  const r2 = [0, 1, 2].map(l => {
    const mean = Y.reduce((a, y) => a + y[l], 0) / N; let se = 0, st = 0;
    X.forEach((x, n) => { const p = ffDot(A[l], x); se += (p - Y[n][l]) ** 2; st += (Y[n][l] - mean) ** 2; });
    return 1 - se / st;
  });
  const surfaces = Object.keys(FF_SURF_NAMES).filter(k => FF_SURF[k] && FF_SURF[k].length === wl.length).map(k => {
    const r = FF_SURF[k], film = F.map(f => ffDot(f, r)), x = Kn.map(c => ffDot(c, r)), cam = A.map(a => ffDot(a, x));
    return { key: k, name: FF_SURF_NAMES[k], film, cam, de: ffDE(film, cam) };
  });
  const meanDE = surfaces.reduce((a, s) => a + s.de, 0) / surfaces.length;
  // where the light it records comes from: blue the film never saw, and infrared past the film's reach
  const tot = g.reduce((a, b) => a + b, 0);
  const share = (lo, hi) => K.reduce((a, k) => a + k.reduce((s, v, i) => s + (wl[i] >= lo && wl[i] < hi ? v : 0), 0), 0) / tot;
  return { A, r2, surfaces, meanDE, blue: share(0, 490), farIR: share(910, 2000), behind: behind || 'w12', film, light, filmGrey: F.grey.slice() };
}

function ffSwatch(rgb) {
  const enc = v => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
  return 'rgb(' + rgb.map(enc).join(',') + ')';
}
let ffLast = null, ffMark = null;
function ffApplied() { return !!(ffMark && typeof PRESET_LAYER !== 'undefined' && PRESET_LAYER === ffMark); }
function ffRender() {
  const out = $('ffOut'); if (!out) return;
  const st = $('ffStack'); if (st) st.textContent = (typeof fpStackNames === 'function' && fpStack.length) ? fpStackNames().join(' + ') : 'none set';
  if (!ffLast) { out.hidden = true; return; }
  const f = ffLast; out.hidden = false;
  if (f.error) { out.innerHTML = '<p class="note">' + f.error + '</p>'; return; }
  const verdict = f.meanDE < 2.5 ? 'Close to the film' : f.meanDE < 4.5 ? 'A fair match' : 'A loose match';
  const pct = v => Math.max(0, Math.round(v * 100)) + '%';
  const warn = [];
  if (!fpStack.length) warn.push('No filters set. The film was always used behind a yellow filter; without one, blue light reaches every channel.');
  else if (f.blue > 0.03) warn.push('This stack lets blue through (' + Math.round(f.blue * 100) + '% of what the camera records), which the film never saw.');
  if (f.r2[0] < 0.9) warn.push('Much of the 700 to 900nm infrared the film’s red layer recorded is blocked, so infrared-bright things will not come out as strongly.');
  const fg = f.filmGrey || [1, 1, 1];
  if (Math.max(...fg.map(v => Math.abs(v - 1))) > 0.08) warn.push('Behind this filter the film itself came out tinted (see its grey card): ' + (fg[2] < 0.5 ? 'blue all but gone, so skies turn olive and foliage pure red' : 'warmer, with greener skies and redder foliage') + '. The fit keeps that, as the film showed it.');
  if (f.farIR > 0.25) warn.push('A lot of what the camera records is infrared beyond 900nm, past where the film could see.');
  const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  out.innerHTML =
    '<p style="margin:6px 0 2px"><b>' + verdict + '</b> · average difference ' + f.meanDE.toFixed(1) + ' over the test surfaces, against ' + (f.film === '8443' ? '8443' : 'Aerochrome III') + ' behind a ' + esc(((FF_FILM_FILTERS.find(x => x[0] === f.behind) || [, 'Wratten 12'])[1]).replace(/ \(.*\)/, '')) + (f.light && f.light !== 'sun' ? ', ' + esc(((FF_LIGHTS.find(x => x[0] === f.light) || [, ''])[1]).replace(/ \(.*\)/, '').toLowerCase()) : '') + '</p>' +
    '<p class="note" style="margin:0 0 4px">How well your camera can follow each film layer: infrared ' + pct(f.r2[0]) + ', red ' + pct(f.r2[1]) + ', green ' + pct(f.r2[2]) + '</p>' +
    warn.map(w => '<p class="note ffWarn" style="margin:0 0 4px">' + esc(w) + '</p>').join('') +
    '<div class="ffGrid"><span></span><span class="ffH">Film</span><span class="ffH">Yours</span><span class="ffH">Diff.</span>' +
    f.surfaces.map(s => '<span class="ffN">' + esc(s.name) + '</span><span class="ffSw" style="background:' + ffSwatch(s.film) + '"></span><span class="ffSw" style="background:' + ffSwatch(s.cam) + '"></span><span class="ffD">' + s.de.toFixed(1) + '</span>').join('') +
    '</div>' +
    '<p class="note" style="margin:4px 0 6px">The surfaces are modelled (a published leaf model and typical shapes), not measured, and the sensor curve is a model too unless your camera matches it, so take this as the shape of the answer.</p>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" id="ffApply" class="btnGhost">Apply to the photo</button>' +
    (ffApplied() ? '<button type="button" id="ffOff" class="btnGhost">Take it off</button>' : '') + '</div>';
  $('ffApply').onclick = ffApply;
  if ($('ffOff')) $('ffOff').onclick = () => { armUndoCapture(); clearPreset(); commitUndoCapture(); ffRender(); };
}
function ffStale() { ffLast = null; if (fpData) ffSensors(); ffRender(); }
function ffApply() {
  if (!ffLast || ffLast.error) return;
  if (!loadedImage) { toast('Open a photo first'); return; }
  const m = [].concat(...ffLast.A).map(v => Math.round(v * 1000) / 10);
  applyUserPreset({ tv: 4, m, mOff: [0, 0, 0], sliders: {} }, {
    extra: () => {
      if ($('swapSpace')) { $('swapSpace').value = '0'; if (typeof syncWidenFromSelect === 'function') syncWidenFromSelect(); }
      setCamNativeDecode('Fitted. Now tap Pick under RAW white balance and tap something grey to finish.');
    }
  });
  ffMark = PRESET_LAYER;
  ffRender();
}
let ffBehindChosen = false;   // once the person picks the film's filter themselves, stop following the stack
function ffSensors() {
  const sel = $('ffSensor');
  if (sel && fpData && !sel.options.length) Object.keys(fpData.sensors).forEach(k => { const o = document.createElement('option'); o.value = o.textContent = k; sel.appendChild(o); });
  const fb = $('ffBehind');
  if (fb && !fb.options.length) FF_FILM_FILTERS.forEach(([id, n]) => { const o = document.createElement('option'); o.value = id; o.textContent = n; fb.appendChild(o); });
  if (fb && !ffBehindChosen) fb.value = ffFilmFilterDefault(fpStack);
  [['ffFilm', FF_FILMS], ['ffLight', FF_LIGHTS]].forEach(([id, list]) => { const e = $(id); if (e && !e.options.length) list.forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; e.appendChild(o); }); });
  return sel;
}
function ffRun() {
  fpLoad().then(() => {
    const sel = ffSensors();
    const sensor = sel && sel.value ? sel.value : Object.keys(fpData.sensors)[0];
    const behind = $('ffBehind') && $('ffBehind').value || ffFilmFilterDefault(fpStack);
    const film = ($('ffFilm') && $('ffFilm').value) || '1443', light = ($('ffLight') && $('ffLight').value) || 'sun';
    try { ffLast = ffFit(fpStack.slice(), sensor, 0, behind, film, light); } catch (e) { console.error(e); ffLast = { error: 'The fit failed: ' + (e && e.message || e) }; }
    ffRender();
  }).catch(() => { ffLast = { error: 'Could not load the filter database.' }; ffRender(); });
}
(function ffWire() {
  if (!$('ffRun')) return;
  $('ffRun').addEventListener('click', ffRun);
  if ($('ffSensor')) $('ffSensor').addEventListener('change', () => { if (ffLast) ffRun(); });
  if ($('ffBehind')) $('ffBehind').addEventListener('change', () => { ffBehindChosen = true; if (ffLast) ffRun(); });
  ['ffFilm', 'ffLight'].forEach(id => { if ($(id)) $(id).addEventListener('change', () => { if (ffLast) ffRun(); }); });
  /* Build 243: Change opens the filter picker right here instead of sending you to the Export panel. There is one
     picker (its stack is the same one export records and the IR leak estimate reads), so it is moved into this box while
     you edit and goes back to its place in Export when you press Done, fold this group, or open the Export panel. */
  const pick = $('fpPick'), slot = $('ffPickHere');
  if ($('ffEdit') && pick && slot) {
    const home = document.createComment('fpPick home'); pick.parentNode.insertBefore(home, pick);
    const here = () => slot.contains(pick);
    const putBack = () => { if (!here()) return; home.parentNode.insertBefore(pick, home.nextSibling); slot.hidden = true; $('ffEdit').textContent = 'Change'; };
    $('ffEdit').addEventListener('click', () => {
      if (here()) { putBack(); if (ffLast === null && fpStack.length) ffRun(); return; }
      slot.appendChild(pick); slot.hidden = false; $('ffEdit').textContent = 'Done';
      setTimeout(() => { const s = $('fpSearch'); if (s) s.focus(); }, 50);
    });
    if (fg0()) fg0().addEventListener('toggle', () => { if (!fg0().open) putBack(); });
    document.querySelectorAll('button[data-tab="export"]').forEach(b => b.addEventListener('click', putBack));
    const ex = $('exportSection'); if (ex) ex.addEventListener('toggle', () => { if (ex.open) putBack(); });
  }
  function fg0() { return $('filmPresetGroup'); }
  const fg = $('filmPresetGroup'); if (fg) fg.addEventListener('toggle', () => { ffRender(); if (fg.open && typeof fpLoad === 'function') fpLoad().then(ffSensors).catch(() => {}); });
  ffRender();
})();
