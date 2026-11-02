/* ---------- Digital Aerochrome (advanced) and filters (build 240) ----------
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

   Test surfaces (build 246): MEASURED reflectance from the USGS Spectral Library Version 7 (Kokaly et al. 2017,
   doi:10.5066/F7RR1WDJ, splib07a ASCII data): a fresh oak leaf, green lawn grass, lodgepole pine needles, a yellow aspen
   leaf, golden dry grass, bare earth (dry marsh sediment, the library's closest to ordinary soil; build 247), an old
   asphalt road, a concrete road, red building brick, open sea water, melting snow (build 247), cadmium red and
   Hansa yellow paint. Modified here only by averaging into 10nm steps from 300 to 1100nm (below each instrument's first
   channel the first value is held) and clipping to 0-1. The blue sky (build 247) is clear-sky light relative to sunlight, estimated from G173 itself: the light scattered
   out of the direct beam (extraterrestrial minus direct, a single-scattering estimate), with a power law fitted over
   the windows free of gas absorption (400-700 and 860-890nm) so the water-vapour bands, where light is absorbed rather
   than scattered, do not count as sky; scaled to a typical brightness. The flat grey card is a model.

   Using the result needs the camera's own channels, so on a RAW it switches the decode to Camera native (as the
   Infrared Ektachrome IE look does) and the mix runs in the Standard swap space, unwidened. Then a grey pick with the
   RAW white balance finishes it. On a JPEG the camera's colour is already baked in, so the fit is only approximate. */
const FF_8443 = [[500, .52, .04, .01], [550, .48, .13, .03], [600, 0, .50, .08], [650, 0, .33, .14], [700, 0, 0, .25], [750, 0, 0, .21], [800, 0, 0, .20], [850, 0, 0, .08]];   // band start nm, yellow, magenta, cyan
const FF_SURF = {"foliage":[0.11,0.11,0.11,0.11,0.11,0.109,0.104,0.099,0.097,0.096,0.096,0.095,0.096,0.096,0.097,0.097,0.097,0.098,0.098,0.098,0.099,0.105,0.12,0.144,0.162,0.172,0.174,0.159,0.141,0.132,0.127,0.122,0.116,0.112,0.11,0.105,0.101,0.098,0.098,0.106,0.157,0.27,0.402,0.538,0.661,0.747,0.796,0.818,0.828,0.833,0.837,0.84,0.843,0.846,0.849,0.853,0.856,0.859,0.862,0.863,0.863,0.863,0.862,0.861,0.857,0.849,0.835,0.825,0.823,0.824,0.83,0.839,0.844,0.851,0.857,0.862,0.866,0.868,0.869,0.868,0.865],"grass":[0.02,0.02,0.02,0.02,0.025,0.022,0.025,0.024,0.021,0.022,0.025,0.027,0.03,0.031,0.032,0.035,0.036,0.036,0.037,0.037,0.039,0.046,0.062,0.083,0.093,0.096,0.095,0.085,0.073,0.066,0.063,0.06,0.056,0.054,0.05,0.045,0.042,0.039,0.039,0.047,0.096,0.164,0.256,0.372,0.496,0.591,0.649,0.676,0.688,0.693,0.697,0.7,0.703,0.703,0.706,0.708,0.704,0.704,0.702,0.706,0.705,0.704,0.701,0.697,0.691,0.68,0.663,0.658,0.659,0.66,0.667,0.671,0.68,0.686,0.692,0.695,0.698,0.699,0.699,0.698,0.695],"conifer":[0.09,0.09,0.09,0.09,0.09,0.089,0.087,0.085,0.084,0.083,0.084,0.085,0.09,0.099,0.111,0.121,0.127,0.133,0.137,0.141,0.148,0.16,0.178,0.191,0.193,0.199,0.205,0.206,0.205,0.202,0.196,0.189,0.186,0.187,0.18,0.168,0.16,0.15,0.153,0.183,0.246,0.324,0.398,0.452,0.491,0.518,0.537,0.551,0.56,0.568,0.576,0.583,0.591,0.599,0.606,0.614,0.62,0.626,0.632,0.637,0.64,0.643,0.645,0.648,0.651,0.654,0.655,0.654,0.651,0.648,0.649,0.652,0.656,0.659,0.663,0.666,0.67,0.673,0.676,0.678,0.68],"autumn":[0.042,0.042,0.042,0.042,0.042,0.042,0.042,0.042,0.042,0.042,0.042,0.042,0.043,0.045,0.05,0.052,0.055,0.058,0.06,0.064,0.081,0.137,0.236,0.315,0.362,0.391,0.406,0.418,0.426,0.431,0.435,0.437,0.437,0.437,0.438,0.434,0.426,0.407,0.401,0.433,0.463,0.471,0.473,0.474,0.474,0.474,0.474,0.475,0.475,0.476,0.476,0.476,0.476,0.477,0.477,0.477,0.477,0.477,0.477,0.478,0.479,0.479,0.479,0.479,0.478,0.476,0.474,0.472,0.469,0.467,0.464,0.465,0.467,0.468,0.469,0.469,0.469,0.469,0.469,0.468,0.467],"drygrass":[0.025,0.025,0.025,0.025,0.025,0.025,0.025,0.027,0.03,0.035,0.042,0.051,0.061,0.07,0.08,0.089,0.097,0.105,0.113,0.12,0.127,0.135,0.142,0.149,0.155,0.162,0.169,0.176,0.184,0.19,0.196,0.202,0.208,0.215,0.221,0.226,0.231,0.235,0.24,0.247,0.254,0.261,0.266,0.271,0.275,0.28,0.284,0.288,0.291,0.295,0.298,0.301,0.304,0.307,0.309,0.312,0.314,0.316,0.318,0.32,0.322,0.324,0.325,0.327,0.329,0.331,0.332,0.333,0.334,0.335,0.336,0.337,0.338,0.34,0.342,0.343,0.345,0.346,0.348,0.349,0.351],"soil":[0.061,0.061,0.061,0.061,0.061,0.061,0.064,0.067,0.073,0.078,0.083,0.087,0.092,0.097,0.102,0.107,0.111,0.115,0.119,0.123,0.127,0.131,0.135,0.14,0.144,0.148,0.152,0.155,0.158,0.161,0.163,0.165,0.167,0.169,0.171,0.173,0.175,0.177,0.179,0.182,0.186,0.189,0.194,0.198,0.201,0.204,0.206,0.21,0.212,0.215,0.217,0.22,0.222,0.224,0.226,0.228,0.229,0.231,0.233,0.235,0.237,0.238,0.24,0.241,0.242,0.244,0.246,0.248,0.249,0.251,0.252,0.254,0.255,0.257,0.259,0.26,0.262,0.263,0.265,0.267,0.268],"asphalt":[0.055,0.055,0.055,0.055,0.055,0.055,0.055,0.055,0.057,0.058,0.06,0.062,0.063,0.065,0.067,0.069,0.07,0.071,0.072,0.074,0.075,0.077,0.079,0.081,0.083,0.085,0.088,0.09,0.093,0.095,0.096,0.098,0.099,0.1,0.101,0.103,0.104,0.105,0.106,0.108,0.109,0.111,0.112,0.113,0.115,0.116,0.117,0.119,0.12,0.121,0.121,0.122,0.123,0.124,0.125,0.126,0.126,0.127,0.128,0.129,0.129,0.13,0.131,0.132,0.133,0.134,0.135,0.136,0.137,0.138,0.138,0.139,0.14,0.14,0.141,0.142,0.143,0.144,0.145,0.146,0.147],"concrete":[0.153,0.153,0.153,0.153,0.153,0.153,0.155,0.16,0.168,0.176,0.184,0.192,0.199,0.207,0.216,0.224,0.229,0.234,0.239,0.244,0.251,0.259,0.266,0.273,0.279,0.286,0.292,0.298,0.302,0.306,0.308,0.31,0.311,0.312,0.313,0.314,0.315,0.315,0.316,0.317,0.317,0.317,0.318,0.318,0.318,0.318,0.318,0.318,0.318,0.317,0.317,0.316,0.316,0.315,0.314,0.313,0.313,0.312,0.312,0.311,0.311,0.31,0.31,0.31,0.31,0.31,0.31,0.309,0.31,0.31,0.31,0.31,0.31,0.31,0.31,0.31,0.31,0.31,0.31,0.311,0.311],"brick":[0.083,0.083,0.083,0.083,0.083,0.083,0.082,0.081,0.08,0.079,0.078,0.078,0.077,0.077,0.078,0.078,0.079,0.079,0.08,0.081,0.082,0.084,0.085,0.087,0.091,0.099,0.113,0.138,0.169,0.194,0.211,0.222,0.228,0.232,0.234,0.236,0.238,0.241,0.243,0.246,0.249,0.251,0.253,0.254,0.254,0.254,0.253,0.251,0.249,0.247,0.244,0.242,0.24,0.238,0.236,0.235,0.234,0.234,0.233,0.234,0.234,0.235,0.236,0.237,0.238,0.239,0.241,0.242,0.243,0.244,0.245,0.245,0.246,0.246,0.247,0.247,0.247,0.247,0.248,0.248,0.248],"water":[0.036,0.037,0.039,0.04,0.041,0.042,0.043,0.044,0.046,0.047,0.048,0.049,0.048,0.047,0.045,0.044,0.043,0.042,0.041,0.039,0.035,0.031,0.029,0.028,0.027,0.026,0.025,0.024,0.023,0.022,0.021,0.021,0.021,0.021,0.021,0.021,0.021,0.021,0.021,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.019,0.019,0.019],"snow":[0.817,0.817,0.817,0.817,0.817,0.821,0.816,0.812,0.808,0.81,0.818,0.828,0.831,0.833,0.834,0.833,0.833,0.833,0.833,0.833,0.832,0.832,0.832,0.832,0.832,0.832,0.833,0.832,0.832,0.831,0.83,0.829,0.827,0.825,0.823,0.822,0.82,0.818,0.818,0.817,0.816,0.814,0.813,0.811,0.809,0.805,0.799,0.79,0.782,0.776,0.772,0.772,0.773,0.774,0.771,0.765,0.754,0.74,0.724,0.71,0.701,0.697,0.693,0.687,0.678,0.661,0.639,0.617,0.59,0.561,0.534,0.516,0.507,0.507,0.515,0.533,0.554,0.572,0.582,0.584,0.578],"redpaint":[0.016,0.016,0.016,0.016,0.016,0.015,0.014,0.014,0.014,0.014,0.014,0.013,0.013,0.013,0.013,0.013,0.013,0.013,0.013,0.013,0.013,0.013,0.013,0.014,0.015,0.015,0.016,0.016,0.018,0.022,0.04,0.091,0.175,0.281,0.376,0.452,0.51,0.554,0.588,0.612,0.629,0.64,0.648,0.654,0.659,0.663,0.667,0.67,0.672,0.675,0.677,0.68,0.682,0.684,0.686,0.688,0.691,0.693,0.695,0.698,0.699,0.701,0.702,0.703,0.704,0.704,0.705,0.706,0.706,0.706,0.706,0.707,0.707,0.708,0.708,0.708,0.708,0.708,0.708,0.708,0.709],"yellowpaint":[0.011,0.011,0.011,0.011,0.011,0.011,0.011,0.011,0.011,0.011,0.011,0.011,0.011,0.011,0.01,0.01,0.01,0.011,0.012,0.017,0.036,0.095,0.196,0.302,0.396,0.469,0.513,0.541,0.561,0.574,0.585,0.595,0.605,0.614,0.622,0.628,0.634,0.638,0.642,0.645,0.648,0.651,0.653,0.655,0.657,0.659,0.661,0.662,0.664,0.665,0.666,0.667,0.668,0.669,0.67,0.67,0.67,0.67,0.671,0.671,0.671,0.672,0.673,0.673,0.673,0.673,0.673,0.672,0.671,0.67,0.669,0.669,0.668,0.669,0.669,0.669,0.669,0.669,0.668,0.666,0.663],"sky":[0.8617,0.8011,0.7465,0.6972,0.6525,0.6118,0.5746,0.5407,0.5096,0.481,0.4547,0.4304,0.408,0.3872,0.3679,0.35,0.3333,0.3178,0.3032,0.2897,0.2769,0.265,0.2538,0.2433,0.2334,0.2241,0.2153,0.207,0.1991,0.1917,0.1847,0.178,0.1717,0.1657,0.16,0.1546,0.1494,0.1445,0.1399,0.1354,0.1311,0.1271,0.1232,0.1195,0.1159,0.1125,0.1092,0.1061,0.1031,0.1002,0.0975,0.0948,0.0923,0.0898,0.0875,0.0852,0.083,0.0809,0.0789,0.0769,0.075,0.0732,0.0714,0.0698,0.0681,0.0665,0.065,0.0635,0.0621,0.0607,0.0594,0.0581,0.0568,0.0556,0.0544,0.0533,0.0522,0.0511,0.05,0.049,0.048],"grey":[0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18,0.18]};
const FF_SURF_NAMES = { foliage: 'Leaves (oak)', grass: 'Lawn grass', conifer: 'Pine needles', autumn: 'Autumn leaves (aspen)', drygrass: 'Dry grass', soil: 'Bare earth', asphalt: 'Asphalt road', concrete: 'Concrete road', brick: 'Red brick', water: 'Open water', snow: 'Snow', redpaint: 'Red paint', yellowpaint: 'Yellow paint', sky: 'Blue sky', grey: 'Grey card' };

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
const FF_FILM_FILTERS = [['w12', 'Wratten 12 (Kodak\u2019s data)'], ['w15', 'Wratten 15'], ['w16', 'Wratten 16'], ['w21', 'Wratten 21 (orange)'], ['w25', 'Wratten 25 (red)'],
  ['bw023', 'B+W 023 (deep yellow)'], ['bw040', 'B+W 040 (yellow-orange)'], ['bw041', 'B+W 041 (orange)'], ['bw090', 'B+W 090 (red)'],
  ['hyg_y52', 'Y52 glass (as Nikon Y52)'], ['hyg_o56', 'O56 glass (as Nikon O56)']];
/* Aerochrome III 1443, the film most people mean by "Aerochrome". Build 247: the three layer sensitivity curves are
   read exactly from the vector drawing in Kodak's own data sheet (KODAK AEROCHROME III Infrared Film 1443, publication
   AS-77, TI2562, minor revision 11-05; Process AR-5, density 1.0 END), placed against the chart's own gridlines. This
   replaces the build 245 tracing of a screenshot, which had the cyan and magenta layers' blue-sensitive ends swapped
   (below about 500nm, where the yellow filter blocks almost everything, so earlier fits barely moved). log10
   sensitivity every 10nm from 400 to 900nm; null where the curve is below the chart's -1.0 floor. These curves have
   no filter or daylight in them, so the chosen filter and light are applied exactly rather than by band. */
const FF_1443 = {
  Y: [1.04, 1.09, 1.14, 1.17, 1.17, 1.15, 1.11, 1.06, 1.02, 0.96, 0.98, 1.03, 1.11, 1.18, 1.22, 1.23, 1.22, 1.11, 0.82, 0.28, -0.38, -0.88, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  M: [0.53, 0.57, 0.62, 0.66, 0.68, 0.67, 0.63, 0.56, 0.43, 0.25, 0.06, -0.1, -0.17, -0.22, -0.2, -0.1, 0.05, 0.24, 0.42, 0.58, 0.72, 0.86, 1.01, 1.18, 1.35, 1.42, 1.24, 0.7, -0.01, -0.64, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  C: [1.26, 1.26, 1.23, 1.2, 1.14, 1.06, 0.94, 0.79, 0.6, 0.38, 0.14, -0.09, -0.11, 0.08, 0.03, -0.19, -0.24, -0.22, -0.17, -0.12, -0.07, -0.02, 0.03, 0.08, 0.12, 0.16, 0.21, 0.25, 0.29, 0.33, 0.36, 0.38, 0.4, 0.4, 0.39, 0.36, 0.32, 0.29, 0.26, 0.25, 0.24, 0.22, 0.2, 0.18, 0.13, 0.08, -0.02, -0.13, -0.29, -0.54, -0.87]
};
const FF_FILMS = [['1443', 'Aerochrome III 1443 (Kodak AS-77)'], ['eir', 'Ektachrome Infrared EIR (Kodak TI-2323)'], ['8443', 'Ektachrome Infrared Aero 8443 (NASA data)']];
/* The light. Midday sun is the filter database's AM1.5 global daylight. Build 247: open shade and low sun now come from
   the ASTM G173-03 reference spectra as published by NREL (derived from the SMARTS v2.9.2 radiative transfer model for
   air mass 1.5, a sun-facing surface tilted 37 degrees, rural aerosol): open shade is global minus direct beam, that is
   sky light plus a little light bounced off the ground (the standard models a light soil); low sun is the G173 direct
   beam taken from 1.5 to 5 atmospheres by Beer-Lambert scaling of its own transmission (direct / extraterrestrial), plus
   half that sky light. Overcast is still a model, cloud-scattered light leaning slightly blue (lambda^-0.6). Shapes
   only: every use here normalises the overall level away. 10nm averages, 300 to 1100nm. */
const FF_G173 = {
  shade: [0.0049, 0.106, 0.3474, 0.6695, 0.7015, 0.7278, 0.6977, 0.8004, 0.7233, 0.6737, 0.8609, 1.0, 0.9786, 0.8421, 0.9346, 0.9823, 0.965, 0.9034, 0.8793, 0.7891, 0.7774, 0.753, 0.6936, 0.6914, 0.6729, 0.6586, 0.6278, 0.5992, 0.5887, 0.5571, 0.5504, 0.5462, 0.5308, 0.5094, 0.5226, 0.5038, 0.4805, 0.5034, 0.4951, 0.4184, 0.4492, 0.4568, 0.3733, 0.3654, 0.4038, 0.4038, 0.2523, 0.3248, 0.3586, 0.3361, 0.3192, 0.3004, 0.2402, 0.2553, 0.2756, 0.2632, 0.2635, 0.25, 0.2447, 0.2338, 0.1714, 0.1635, 0.1673, 0.1117, 0.0635, 0.0718, 0.0865, 0.135, 0.1436, 0.1665, 0.165, 0.1583, 0.153, 0.1485, 0.1436, 0.1376, 0.1316, 0.1259, 0.1207, 0.1124, 0.0962],
  low: [0.0008, 0.0153, 0.0516, 0.1045, 0.1163, 0.1301, 0.1362, 0.1734, 0.1757, 0.1867, 0.2712, 0.3603, 0.4018, 0.3929, 0.4932, 0.5826, 0.6398, 0.663, 0.7055, 0.6998, 0.7382, 0.7623, 0.7506, 0.7785, 0.7945, 0.8097, 0.8023, 0.7747, 0.7902, 0.7628, 0.7988, 0.8514, 0.8523, 0.8162, 0.921, 0.8962, 0.8774, 0.9858, 1.0, 0.6755, 0.8676, 0.9481, 0.6114, 0.6319, 0.9067, 0.9799, 0.2758, 0.6714, 0.952, 0.8824, 0.8478, 0.785, 0.4779, 0.6118, 0.8035, 0.8184, 0.8441, 0.8188, 0.8156, 0.7675, 0.3575, 0.3346, 0.3858, 0.1278, 0.033, 0.0475, 0.0872, 0.3126, 0.3976, 0.633, 0.6647, 0.6478, 0.6365, 0.6302, 0.6168, 0.5937, 0.5638, 0.5411, 0.5165, 0.4645, 0.3233]
};
const FF_LIGHTS = [['sun', 'Sun, midday'], ['low', 'Low sun (G173, air mass 5)'], ['overcast', 'Overcast (modelled)'], ['shade', 'Open shade (G173 sky light)']];
function ffIll(wl, light) {
  const base = fpData.ill;
  if ((light === 'shade' || light === 'low') && FF_G173[light].length === base.length) return FF_G173[light].slice();
  if (light === 'overcast') return base.map((v, i) => v * Math.pow(wl[i] / 550, -0.6));
  return base.slice();
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
    const SRC = film === 'eir' ? FF_FM.sensEIR : FF_1443;   // build 250: EIR's own layer curves (TI-2323)
    const S = ['C', 'M', 'Y'].map(k => wl.map(w => { const j = Math.round((w - 400) / 10), v = (w >= 400 && w <= 900) ? SRC[k][j] : null; return v == null ? 0 : Math.pow(10, v); }));
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

/* ---------- The film as it printed (build 250) ----------
   Up to build 249 "the film" meant its three layer exposures mapped straight onto red, green and blue. Real colour
   infrared film then turned each exposure into dye through its characteristic curve, and its three dyes overlap in
   colour, which is a large part of why foliage comes out magenta rather than pure red. This models that from Kodak's own
   published curves, read from the vector charts in the data sheets: the characteristic curves (density against log
   exposure, Process AR-5, Status A) for Aerochrome III 1443 (AS-77) and Ektachrome Infrared EIR (TI-2323), and the
   spectral dye densities (normalised so the three dyes at density 1 make a neutral of 1, viewing illuminant D5000) from
   AS-77. TI-2323 publishes no dye curves, and Kodak states the Ektachrome films share one dye set, so EIR uses the 1443
   dyes; 8443, with no published curves here, uses the 1443 characteristic and dyes.
     exposure -> density: each layer's curve is placed so an 18% grey behind a Wratten 12 in sun lands at density 1.0,
       the level the sensitivity curves themselves are defined at (1.0 END); deeper filters and other light shift it,
       which is the film's own cast;
     density -> colour: the light through the three dyes (amount = layer density, an approximation of Status A density
       to dye amount), viewed in D50 (for Kodak's D5000), CIE 1931 2-degree observer, Bradford-adapted to sRGB, with the
       clear film base (minimum density) as white, the way a slide is projected or scanned.
   The fit cannot reproduce the curve's S-shape with a 3x3 mix (that is what the tone sliders are for), so it fits in
   the film's own linear terms: each output is mapped back through the film's grey-scale response, and the camera side
   is sent forward through the same response before the swatches are compared. CMFs and D50 from the colour-science
   package; Kodak data from AS-77 (TI2562, 11-05) and TI-2323 (2005). */
const FF_FM = {"cmf":{"x":[0.01431,0.04351,0.13438,0.2839,0.34828,0.3362,0.2908,0.19536,0.09564,0.03201,0.0049,0.0093,0.06327,0.1655,0.2904,0.43345,0.5945,0.7621,0.9163,1.0263,1.0622,1.0026,0.85445,0.6424,0.4479,0.2835,0.1649,0.0874,0.04677,0.0227,0.01136],"y":[0.0004,0.00121,0.004,0.0116,0.023,0.038,0.06,0.09098,0.13902,0.20802,0.323,0.503,0.71,0.862,0.954,0.99495,0.995,0.952,0.87,0.757,0.631,0.503,0.381,0.265,0.175,0.107,0.061,0.032,0.017,0.00821,0.0041],"z":[0.06785,0.2074,0.6456,1.3856,1.74706,1.77211,1.6692,1.28764,0.81295,0.46518,0.272,0.1582,0.07825,0.04216,0.0203,0.00875,0.0039,0.0021,0.00165,0.0011,0.0008,0.00034,0.00019,5e-05,2e-05,-0.0,0.0,0.0,0.0,0.0,0.0]},"d50":[49.31,56.51,60.03,57.82,74.82,87.25,90.61,91.37,95.11,91.96,95.72,96.61,97.13,102.1,100.76,102.32,100.0,97.74,98.92,93.5,97.69,99.27,99.04,95.72,98.86,95.67,98.19,103.0,99.13,87.38,91.6],"char1443":{"C":[3.513,3.513,3.513,3.513,3.513,3.513,3.513,3.513,3.513,3.513,3.513,3.513,3.472,3.451,3.449,3.445,3.418,3.367,3.309,3.26,3.173,2.932,2.584,2.215,1.82,1.437,1.109,0.849,0.652,0.502,0.395,0.326,0.28,0.243,0.213,0.189,0.174,0.162,0.152,0.141,0.141],"M":[3.657,3.657,3.657,3.657,3.657,3.657,3.657,3.657,3.657,3.657,3.657,3.657,3.597,3.542,3.472,3.347,3.191,3.019,2.793,2.527,2.241,1.938,1.636,1.351,1.095,0.849,0.62,0.44,0.321,0.253,0.22,0.205,0.196,0.187,0.179,0.174,0.17,0.167,0.163,0.158,0.158],"Y":[3.31,3.31,3.31,3.31,3.31,3.31,3.31,3.31,3.31,3.31,3.31,3.31,3.299,3.283,3.262,3.239,3.198,3.124,3.008,2.787,2.409,1.956,1.482,1.082,0.802,0.58,0.413,0.312,0.249,0.212,0.193,0.181,0.17,0.161,0.155,0.149,0.145,0.14,0.134,0.128,0.128]},"charEIR":{"C":[3.536,3.536,3.536,3.536,3.536,3.536,3.536,3.536,3.536,3.536,3.536,3.536,3.496,3.471,3.466,3.463,3.442,3.397,3.333,3.278,3.211,2.979,2.666,2.3,1.885,1.507,1.195,0.918,0.7,0.541,0.433,0.357,0.306,0.265,0.231,0.206,0.191,0.181,0.172,0.16,0.16],"M":[3.682,3.682,3.682,3.682,3.682,3.682,3.682,3.682,3.682,3.682,3.682,3.682,3.619,3.565,3.509,3.38,3.229,3.06,2.845,2.592,2.31,2.003,1.69,1.393,1.142,0.905,0.68,0.486,0.35,0.277,0.244,0.226,0.215,0.206,0.197,0.191,0.188,0.185,0.181,0.176,0.176],"Y":[3.328,3.328,3.328,3.328,3.328,3.328,3.328,3.328,3.328,3.328,3.328,3.328,3.322,3.306,3.281,3.261,3.223,3.156,3.057,2.848,2.507,2.05,1.582,1.16,0.865,0.633,0.449,0.344,0.278,0.235,0.213,0.199,0.187,0.179,0.173,0.167,0.163,0.158,0.153,0.146,0.146]},"dye":{"C":[0.209,0.187,0.15,0.112,0.083,0.056,0.035,0.024,0.014,0.01,0.014,0.017,0.037,0.062,0.087,0.136,0.184,0.265,0.349,0.436,0.527,0.619,0.713,0.777,0.841,0.882,0.913,0.925,0.917,0.896,0.874],"M":[0.061,0.076,0.1,0.122,0.137,0.15,0.161,0.192,0.249,0.334,0.439,0.578,0.71,0.82,0.897,0.922,0.893,0.816,0.705,0.582,0.46,0.35,0.251,0.181,0.122,0.086,0.056,0.035,0.025,0.015,0.004],"Y":[0.625,0.693,0.773,0.84,0.884,0.88,0.841,0.756,0.636,0.51,0.382,0.275,0.187,0.119,0.07,0.046,0.022,0.011,0.004,0.003,0.003,0.002,0.001,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0]},"sensEIR":{"C":[1.271,1.256,1.232,1.194,1.139,1.048,0.926,0.771,0.584,0.338,0.075,-0.122,-0.064,0.167,-0.065,-0.224,-0.214,-0.179,-0.137,-0.086,-0.036,0.01,0.055,0.1,0.146,0.187,0.226,0.266,0.305,0.339,0.368,0.394,0.409,0.413,0.401,0.366,0.324,0.295,0.271,0.259,0.25,0.234,0.212,0.182,0.135,0.072,-0.02,-0.16,-0.352,-0.67,null],"M":[0.529,0.582,0.635,0.673,0.69,0.681,0.638,0.549,0.417,0.216,0.007,-0.119,-0.187,-0.211,-0.178,-0.058,0.113,0.29,0.464,0.611,0.747,0.885,1.026,1.181,1.336,1.431,1.289,0.6,-0.196,-0.809,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"Y":[1.052,1.099,1.146,1.168,1.17,1.15,1.115,1.069,1.015,0.953,0.975,1.055,1.136,1.188,1.226,1.23,1.219,1.06,0.802,0.187,-0.584,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]}};
const FF_M_D50_SRGB = (() => {   // Bradford D50 -> D65, then XYZ -> linear sRGB
  const B = [0.9555766, -0.0230393, 0.0631636, -0.0282895, 1.0099416, 0.0210077, 0.0122982, -0.0204830, 1.3299098];
  const S = [3.2404542, -1.5371385, -0.4985314, -0.9692660, 1.8760108, 0.0415560, 0.0556434, -0.2040259, 1.0572252];
  return bfMat3mul(S, B);
})();
function ffCharOf(film) { return film === 'eir' ? FF_FM.charEIR : FF_FM.char1443; }
function ffCharAt(curve, le) { const x = (le + 3) / 0.1, i = Math.max(0, Math.min(curve.length - 2, Math.floor(x))), f = Math.max(0, Math.min(1, x - i)); return curve[i] + (curve[i + 1] - curve[i]) * f; }
function ffCharX1(curve) { for (let i = 0; i < curve.length - 1; i++) if (curve[i] >= 1 && curve[i + 1] < 1) return -3 + 0.1 * (i + (curve[i] - 1) / (curve[i] - curve[i + 1])); return -0.5; }
/* exposures (each layer; an 18% grey behind a Wratten 12 in sun gives 0.18) -> linear sRGB as the slide shows it */
function ffMakeRender(film) {
  const ch = ffCharOf(film), keys = ['C', 'M', 'Y'], x1 = keys.map(k => ffCharX1(ch[k])), dye = keys.map(k => FF_FM.dye[k]);
  const n = FF_FM.d50.length, wY = FF_FM.cmf.y.reduce((a, v, i) => a + v * FF_FM.d50[i], 0);
  const raw = D => {
    let X = 0, Y = 0, Z = 0;
    for (let i = 0; i < n; i++) { const t = Math.pow(10, -(D[0] * dye[0][i] + D[1] * dye[1][i] + D[2] * dye[2][i])) * FF_FM.d50[i]; X += t * FF_FM.cmf.x[i]; Y += t * FF_FM.cmf.y[i]; Z += t * FF_FM.cmf.z[i]; }
    const v = [X / wY, Y / wY, Z / wY], M = FF_M_D50_SRGB;
    return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
  };
  const base = raw(keys.map(k => ch[k][ch[k].length - 1]));   // clear film: minimum density, shown as white
  const dens = e => keys.map((k, l) => ffCharAt(ch[k], Math.log10(Math.max(1e-6, e[l]) / 0.18) + x1[l]));
  const render = e => raw(dens(e)).map((v, c) => v / base[c]);
  // the film's grey-scale response, for mapping its output back to linear terms and the camera's forward
  // one curve per output channel (a neutral exposure series), so a film whose blue is all but gone behind a red filter
  // still maps back and forth channel by channel rather than through one brightness curve
  const S = [], L = [[], [], []];
  for (let k = 0; k <= 240; k++) { const v = 0.18 * Math.pow(10, -2.5 + 4 * k / 240), o = render([v, v, v]); S.push(v); o.forEach((x, c) => L[c].push(x)); }
  const fwd = (v, c) => { const Lc = L[c]; if (v <= S[0]) return Lc[0]; for (let k = 1; k < S.length; k++) if (v <= S[k]) return Lc[k - 1] + (Lc[k] - Lc[k - 1]) * (v - S[k - 1]) / (S[k] - S[k - 1]); return Lc[Lc.length - 1]; };
  const inv = (o, c) => { const Lc = L[c]; if (o <= Lc[0]) return S[0]; for (let k = 1; k < Lc.length; k++) if (o <= Lc[k]) return S[k - 1] + (S[k] - S[k - 1]) * (o - Lc[k - 1]) / Math.max(1e-9, Lc[k] - Lc[k - 1]); return S[S.length - 1]; };
  return { render, fwd, inv };
}
const ffRenderCache = {};
function ffRenderer(film) { return ffRenderCache[film] || (ffRenderCache[film] = ffMakeRender(film)); }
function ffFit(stack, sensor, maxGain, behind, film, light) {
  maxGain = maxGain || 2.0;
  film = film || '1443'; light = light || 'sun';
  const wl = ffWl(), F = ffFilm(wl, behind || 'w12', film, light), K = ffKernel(stack, sensor, light);
  const g = K.map(k => k.reduce((a, b) => a + b, 0));
  if (g.some(v => !(v > 1e-9))) return { error: 'This stack lets almost nothing through to one of the channels.' };
  const Kn = K.map((k, c) => k.map(v => v / g[c]));   // white balanced: a flat grey gives 1, 1, 1
  const R = ffRenderer(film), toLin = o => o.map((v, c) => R.inv(v, c)), fromLin = v => v.map((x, c) => R.fwd(x, c));
  const filmLin = r => toLin(R.render(F.map(f => ffDot(f, r))));   // the slide, in the film's own linear terms
  const train = ffTrain(wl), X = train.map(r => Kn.map(k => ffDot(k, r))), Y = train.map(filmLin), N = X.length;
  const greyLin = toLin(R.render(F.grey.map(v => 0.18 * v))).map(v => v / 0.18);
  const XtX = [0, 0, 0, 0, 0, 0, 0, 0, 0]; X.forEach(x => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) XtX[i * 3 + j] += x[i] * x[j]; });
  /* Build 250: the grey condition is exact (a Lagrange constraint), not a heavy weight. A weight was overpowered by the
     regularisation whenever the channels were nearly alike (behind a red filter), and the grey card came out tinted. */
  const XtY = [0, 1, 2].map(l => [0, 1, 2].map(i => X.reduce((a, x, n) => a + x[i] * Y[n][l], 0)));
  const solve = lam => [0, 1, 2].map(l => {
    const Mi = bfMat3inv(XtX.map((v, k) => v + ((k % 4 === 0) ? lam * N + 1e-9 : 0))), rhs = XtY[l];
    const mul = v => [0, 1, 2].map(i => Mi[i * 3] * v[0] + Mi[i * 3 + 1] * v[1] + Mi[i * 3 + 2] * v[2]);
    const a0 = mul(rhs), u = mul([1, 1, 1]), k = (greyLin[l] - (a0[0] + a0[1] + a0[2])) / (u[0] + u[1] + u[2]);
    return a0.map((v, i) => v + k * u[i]);
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
    const r = FF_SURF[k], filmOut = R.render(F.map(f => ffDot(f, r))), x = Kn.map(c => ffDot(c, r)), cam = fromLin(A.map(a => ffDot(a, x)));
    return { key: k, name: FF_SURF_NAMES[k], film: filmOut, cam, de: ffDE(filmOut, cam) };
  });
  const meanDE = surfaces.reduce((a, s) => a + s.de, 0) / surfaces.length;
  // where the light it records comes from: blue the film never saw, and infrared past the film's reach
  const tot = g.reduce((a, b) => a + b, 0);
  const share = (lo, hi) => K.reduce((a, k) => a + k.reduce((s, v, i) => s + (wl[i] >= lo && wl[i] < hi ? v : 0), 0), 0) / tot;
  return { A, r2, surfaces, meanDE, blue: share(0, 490), farIR: share(910, 2000), behind: behind || 'w12', film, light, sensor, filmGrey: F.grey.slice(), filmOutGrey: R.render(F.grey.map(v => 0.18 * v)) };
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
    '<p style="margin:6px 0 2px"><b>' + verdict + '</b> · average difference ' + f.meanDE.toFixed(1) + ' over the test surfaces, against ' + (f.film === '8443' ? '8443' : f.film === 'eir' ? 'EIR' : 'Aerochrome III') + ' behind a ' + esc(((FF_FILM_FILTERS.find(x => x[0] === f.behind) || [, 'Wratten 12'])[1]).replace(/ \(.*\)/, '')) + (f.light && f.light !== 'sun' ? ', ' + esc(((FF_LIGHTS.find(x => x[0] === f.light) || [, ''])[1]).replace(/ \(.*\)/, '').toLowerCase()) : '') + '</p>' +
    '<p class="note" style="margin:0 0 4px">How well your camera can follow each film layer: infrared ' + pct(f.r2[0]) + ', red ' + pct(f.r2[1]) + ', green ' + pct(f.r2[2]) + '</p>' +
    warn.map(w => '<p class="note ffWarn" style="margin:0 0 4px">' + esc(w) + '</p>').join('') +
    '<div class="ffGrid"><span></span><span class="ffH">Film</span><span class="ffH">Yours</span><span class="ffH">Diff.</span>' +
    f.surfaces.map(s => '<span class="ffN">' + esc(s.name) + '</span><span class="ffSw" style="background:' + ffSwatch(s.film) + '"></span><span class="ffSw" style="background:' + ffSwatch(s.cam) + '"></span><span class="ffD">' + s.de.toFixed(1) + '</span>').join('') +
    '</div>' +
    ((fpData && fpData.sensorNotes && f.sensor && fpData.sensorNotes[f.sensor]) ? '<p class="note" style="margin:4px 0 2px">Sensor: ' + esc(fpData.sensorNotes[f.sensor]) + '</p>' : '') +
    '<p class="note" style="margin:4px 0 2px">Film swatches are the slide as printed: Kodak&rsquo;s characteristic curves and dyes. The fit matches its colours; tick the box below to take the film&rsquo;s contrast too.</p>' +
    '<p class="note" style="margin:4px 0 6px">Surfaces are measured (USGS Spectral Library; the sky from the ASTM G173 solar spectra; the grey card is flat). The sensor curve is a model unless your camera matches it, so take this as the shape of the answer.</p>' +
    '<label class="ffRow" title="Sets the tone curve (R, G and B) to the film&rsquo;s own characteristic curve, so the photo takes the slide&rsquo;s contrast as well as its colours. Edit or flatten it in Curves afterwards."><input type="checkbox" id="ffTone"' + (ffToneOn ? ' checked' : '') + '> Include the film&rsquo;s contrast</label>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><button type="button" id="ffApply" class="btnGhost">Apply to the photo</button>' +
    (ffApplied() ? '<button type="button" id="ffOff" class="btnGhost">Take it off</button>' : '') + '</div>';
  $('ffApply').onclick = ffApply;
  if ($('ffTone')) $('ffTone').onchange = e => { ffToneOn = e.target.checked; };
  if ($('ffOff')) $('ffOff').onclick = () => { armUndoCapture(); clearPreset(); commitUndoCapture(); ffRender(); };
}
function ffStale() { ffLast = null; if (fpData) ffSensors(); ffRender(); }
/* Build 251: the film's contrast, as irlab tone curves. The fit leaves the camera's output in the film's own linear terms
   (an 18% grey at 0.18); the slide is that pushed through the film's characteristic curve and dyes. So each channel
   gets a curve from display value in to display value out: decode, run through the film's grey-scale response for that
   channel (the same one the swatches use), encode. The RGB curve stays straight. They are ordinary curve points, so the
   curve editor shows and edits them, and taking the fit off puts your own curves back. */
let ffToneOn = true;
function ffToneCurves(film) {
  const R = ffRenderer(film);
  const dec = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4), enc = v => { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
  const xs = [0, 0.06, 0.12, 0.19, 0.27, 0.36, 0.46, 0.57, 0.69, 0.81, 0.91, 1];
  const ch = c => xs.map(x => [x, Math.round(enc(R.fwd(Math.max(1e-4, dec(x)), c)) * 1000) / 1000]);
  return { master: [[0, 0], [1, 1]], r: ch(0), g: ch(1), b: ch(2) };
}
function ffApply() {
  if (!ffLast || ffLast.error) return;
  if (!loadedImage) { toast('Open a photo first'); return; }
  const m = [].concat(...ffLast.A).map(v => Math.round(v * 1000) / 10);
  applyUserPreset({ tv: 4, m, mOff: [0, 0, 0], sliders: {} }, {
    extra: () => {
      if ($('swapSpace')) { $('swapSpace').value = '0'; if (typeof syncWidenFromSelect === 'function') syncWidenFromSelect(); }
      setCamNativeDecode('Digital Aerochrome applied. Now tap Pick under RAW white balance and tap something grey to finish.');
      if (ffToneOn && typeof curveState !== 'undefined') {
        const t = ffToneCurves(ffLast.film || '1443');
        curveState = Object.assign(curveDefault(), t);
        if (typeof curveChanged === 'function') curveChanged();
      }
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
  /* Build 261: the filters are picked only in Looks > Filters on this photo; the name here is a link there (data-fp-go). */
  const fg = $('filmPresetGroup'); if (fg) fg.addEventListener('toggle', () => { ffRender(); if (fg.open && typeof fpLoad === 'function') fpLoad().then(ffSensors).catch(() => {}); });
  ffRender();
})();
