/* Build 197: RAW white balance as Temperature + Green, ported from RawTherapee (rtengine/colortemp.cc: temp2mulxyz,
   temp2mul, mul2temp, blackbody_spect, daylight_spect, the 2-degree observer table; rtengine/iccmatrices.h:
   sRGBd65_xyz). GPL-3, see THIRD_PARTY_NOTICES.md. Copyright RawTherapee contributors (J. Desmis and others).

   A temperature becomes a light: below 4000 K a blackbody, from 4000 K the CIE daylight model (with RawTherapee's own
   adjustment above 25000 K), each integrated over 350-830 nm against the 2-degree observer. Its colour in linear sRGB is
   the "multiplier" RawTherapee works with; Green divides the green one. To white-balance a RAW, RawTherapee takes the
   camera's response to that light in its D65-balanced space (cam_rgb times it) and divides LibRaw's daylight
   multipliers (pre_mul) by it -- rtwbGains in src/raw-wb.js. Our decoder doesn't hand pre_mul over, but it is fixed by
   the camera's matrix in LibRaw's table, which src/wb-kelvin.js already finds for each file.

   Same range as RawTherapee, 1500-60000 K: below about 1550 K the light's blue goes negative in sRGB and the blue/red
   test mul2temp runs on stops being monotonic, which is why RawTherapee stops there. Converted cameras that need more
   cooling than that use the Temperature cast after the swap, which still runs to +/-600. */
const RTWB_MIN = 1500, RTWB_MAX = 60000, RTWB_GMIN = 0.02, RTWB_GMAX = 100;
const RTWB_CMF2 = [0.0,0.0,0.0,0.0,0.0,0.0,0.0001299,0.0003917,0.0006061,0.0002321,6.965e-06,0.001086,0.0004149,1.239e-05,0.001946,0.0007416,2.202e-05,0.003846,0.001368,3.9e-05,0.006450001,0.002236,6.4e-05,0.01054999,0.004243,0.00012,0.02005001,0.00765,0.000217,0.03621,0.01431,0.000396,0.06785001,0.02319,0.00064,0.1102,0.04351,0.00121,0.2074,0.07763,0.00218,0.3713,0.13438,0.004,0.6456,0.21477,0.0073,1.0390501,0.2839,0.0116,1.3856,0.3285,0.01684,1.62296,0.34828,0.023,1.74706,0.34806,0.0298,1.7826,0.3362,0.038,1.77211,0.3187,0.048,1.7441,0.2908,0.06,1.6692,0.2511,0.0739,1.5281,0.19536,0.09098,1.28764,0.1421,0.1126,1.0419,0.09564,0.13902,0.8129501,0.05795001,0.1693,0.6162,0.03201,0.20802,0.46518,0.0147,0.2586,0.3533,0.0049,0.323,0.272,0.0024,0.4073,0.2123,0.0093,0.503,0.1582,0.0291,0.6082,0.1117,0.06327,0.71,0.07824999,0.1096,0.7932,0.05725001,0.1655,0.862,0.04216,0.2257499,0.9148501,0.02984,0.2904,0.954,0.0203,0.3597,0.9803,0.0134,0.4334499,0.9949501,0.008749999,0.5120501,1.0,0.005749999,0.5945,0.995,0.0039,0.6784,0.9786,0.002749999,0.7621,0.952,0.0021,0.8425,0.9154,0.0018,0.9163,0.87,0.001650001,0.9786,0.8163,0.0014,1.0263,0.757,0.0011,1.0567,0.6949,0.001,1.0622,0.631,0.0008,1.0456,0.5668,0.0006,1.0026,0.503,0.00034,0.9384,0.4412,0.00024,0.8544499,0.381,0.00019,0.7514,0.321,0.0001,0.6424,0.265,4.999999e-05,0.5419,0.217,3e-05,0.4479,0.175,2e-05,0.3608,0.1382,1e-05,0.2835,0.107,0.0,0.2187,0.0816,0.0,0.1649,0.061,0.0,0.1212,0.04458,0.0,0.0874,0.032,0.0,0.0636,0.0232,0.0,0.04677,0.017,0.0,0.0329,0.01192,0.0,0.0227,0.00821,0.0,0.01584,0.005723,0.0,0.01135916,0.004102,0.0,0.008110916,0.002929,0.0,0.005790346,0.002091,0.0,0.004109457,0.001484,0.0,0.002899327,0.001047,0.0,0.00204919,0.00074,0.0,0.001439971,0.00052,0.0,0.0009999493,0.0003611,0.0,0.0006900786,0.0002492,0.0,0.0004760213,0.0001719,0.0,0.0003323011,0.00012,0.0,0.0002348261,8.48e-05,0.0,0.0001661505,6e-05,0.0,0.000117413,4.24e-05,0.0,8.307527e-05,3e-05,0.0,5.870652e-05,2.12e-05,0.0,4.150994e-05,1.499e-05,0.0,2.935326e-05,1.06e-05,0.0,2.067383e-05,7.4657e-06,0.0,1.455977e-05,5.2578e-06,0.0,1.025398e-05,3.7029e-06,0.0,7.221456e-06,2.60778e-06,0.0,5.085868e-06,1.8366e-06,0.0,3.581652e-06,1.2934e-06,0.0,2.522525e-06,9.1093e-07,0.0,1.776509e-06,6.4153e-07,0.0,1.251141e-06,4.5181e-07,0.0];   // 350..830 nm, 5 nm, x y z
const RTWB_S0 = [61.8,61.65,61.5,65.15,68.8,66.1,63.4,64.6,65.8,80.3,94.8,99.8,104.8,105.35,105.9,101.35,96.8,105.35,113.9,119.75,125.6,125.55,125.5,123.4,121.3,121.3,121.3,117.4,113.5,113.3,113.1,111.95,110.8,108.65,106.5,107.65,108.8,107.05,105.3,104.85,104.4,102.2,100.0,98.0,96.0,95.55,95.1,92.1,89.1,89.8,90.5,90.4,90.3,89.35,88.4,86.2,84.0,84.55,85.1,83.5,81.9,82.25,82.6,83.75,84.9,83.1,81.3,76.6,71.9,73.1,74.3,75.35,76.4,69.85,63.3,67.5,71.7,74.35,77.0,71.1,65.2,56.45,47.7,58.15,68.6,66.8,65.0,65.5,66.0,63.5,61.0,57.15,53.3,56.1,58.9,60.4,61.9];
const RTWB_S1 = [41.6,39.8,38.0,40.2,42.4,40.45,38.5,36.75,35.0,39.2,43.4,44.85,46.3,45.1,43.9,40.5,37.1,36.9,36.7,36.3,35.9,34.25,32.6,30.25,27.9,26.1,24.3,22.2,20.1,18.15,16.2,14.7,13.2,10.9,8.6,7.35,6.1,5.15,4.2,3.05,1.9,0.95,0.0,-0.8,-1.6,-2.55,-3.5,-3.5,-3.5,-4.65,-5.8,-6.5,-7.2,-7.9,-8.6,-9.05,-9.5,-10.2,-10.9,-10.8,-10.7,-11.35,-12.0,-13.0,-14.0,-13.8,-13.6,-12.8,-12.0,-12.65,-13.3,-13.1,-12.9,-11.75,-10.6,-11.1,-11.6,-11.9,-12.2,-11.2,-10.2,-9.0,-7.8,-9.5,-11.2,-10.8,-10.4,-10.5,-10.6,-10.15,-9.7,-9.0,-8.3,-8.8,-9.3,-9.55,-9.8];
const RTWB_S2 = [6.7,6.0,5.3,5.7,6.1,4.55,3.0,2.1,1.2,0.05,-1.1,-0.8,-0.5,-0.6,-0.7,-0.95,-1.2,-1.9,-2.6,-2.75,-2.9,-2.85,-2.8,-2.7,-2.6,-2.6,-2.6,-2.2,-1.8,-1.65,-1.5,-1.4,-1.3,-1.25,-1.2,-1.1,-1.0,-0.75,-0.5,-0.4,-0.3,-0.15,0.0,0.1,0.2,0.35,0.5,1.3,2.1,2.65,3.2,3.65,4.1,4.4,4.7,4.9,5.1,5.9,6.7,7.0,7.3,7.95,8.6,9.2,9.8,10.0,10.2,9.25,8.3,8.95,9.6,9.05,8.5,7.75,7.0,7.3,7.6,7.8,8.0,7.35,6.7,5.95,5.2,6.3,7.4,7.1,6.8,6.9,7.0,6.7,6.4,5.95,5.5,5.8,6.1,6.3,6.5];
const RTWB_SRGB_XYZ = [3.2404542, -1.5371385, -0.4985314, -0.9692660, 1.8760108, 0.0415560, 0.0556434, -0.2040259, 1.0572252];

function rtwbXYZ(temp) {   // white point of the light, as X/Y and Z/Y (temp2mulxyz)
  let X = 0, Y = 0, Z = 0;
  if (temp <= 4000) {
    for (let i = 0; i < 97; i++) {
      const wlm = (350 + 5 * i) * 1e-9;
      const me = (3.7417715247e-16 / Math.pow(wlm, 5)) / (Math.exp(1.438786e-2 / (wlm * temp)) - 1);
      X += me * RTWB_CMF2[i * 3]; Y += me * RTWB_CMF2[i * 3 + 1]; Z += me * RTWB_CMF2[i * 3 + 2];
    }
  } else {
    let xD;
    if (temp <= 7000) xD = -4.6070e9 / (temp * temp * temp) + 2.9678e6 / (temp * temp) + 0.09911e3 / temp + 0.244063;
    else if (temp <= 25000) xD = -2.0064e9 / (temp * temp * temp) + 1.9018e6 / (temp * temp) + 0.24748e3 / temp + 0.237040;
    else xD = -2.0064e9 / (temp * temp * temp) + 1.9018e6 / (temp * temp) + 0.24748e3 / temp + 0.237040 - ((temp - 25000) / 25000) * 0.025;
    const yD = -3.0 * xD * xD + 2.87 * xD - 0.275;
    const interm = 0.0241 + 0.2562 * xD - 0.734 * yD;
    const m1 = (-1.3515 - 1.7703 * xD + 5.9114 * yD) / interm, m2 = (0.03 - 31.4424 * xD + 30.0717 * yD) / interm;
    for (let i = 0; i < 97; i++) {
      const me = RTWB_S0[i] + m1 * RTWB_S1[i] + m2 * RTWB_S2[i];
      X += me * RTWB_CMF2[i * 3]; Y += me * RTWB_CMF2[i * 3 + 1]; Z += me * RTWB_CMF2[i * 3 + 2];
    }
  }
  const sum = X + Y + Z, x = X / sum, y = Y / sum;
  return [x / y, (1 - x - y) / y];
}
/* temp2mul: the light's colour in linear sRGB, largest channel 1, green divided by Green. */
function rtwbLight(temp, green) {
  temp = Math.min(RTWB_MAX, Math.max(RTWB_MIN, temp)); green = Math.min(RTWB_GMAX, Math.max(RTWB_GMIN, green));
  const [Xw, Zw] = rtwbXYZ(temp), M = RTWB_SRGB_XYZ;
  const r = M[0] * Xw + M[1] + M[2] * Zw, b = M[6] * Xw + M[7] + M[8] * Zw;
  const g = (M[3] * Xw + M[4] + M[5] * Zw) / green;
  const mx = Math.max(r, g, b);
  return [r / mx, g / mx, b / mx];
}
/* mul2temp: temperature from the blue/red ratio by bisection, Green from what is left over. */
function rtwbTempOf(light) {
  const r = light[0], g = light[1], b = light[2];
  let lo = RTWB_MIN, hi = RTWB_MAX, temp = (lo + hi) / 2, t;
  while (hi - lo > 1) {
    t = rtwbLight(temp, 1);
    if (t[2] / t[0] > b / r) hi = temp; else lo = temp;
    temp = (lo + hi) / 2;
  }
  t = rtwbLight(temp, 1);
  const green = (t[1] / t[0]) / (g / r);
  return { temp: Math.min(RTWB_MAX, Math.max(RTWB_MIN, temp)), green: Math.min(RTWB_GMAX, Math.max(RTWB_GMIN, green)) };
}
