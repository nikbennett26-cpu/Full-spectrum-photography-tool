// Each case: which fixture, and a set of control values. Anything a case does not
// mention stays at its default. Controls that do not exist in the page being tested
// (an older build, say) are skipped, so the same suite can be run against old and new.
export const cases = [
  { name: 'defaults-scene',        img: 'scene' },
  { name: 'defaults-lamps',        img: 'lamps' },
  { name: 'exposure+1',            img: 'scene', s: { bright: 1 } },
  { name: 'exposure-1',            img: 'scene', s: { bright: -1 } },
  { name: 'exposure+2-lamps',      img: 'lamps', s: { bright: 2 } },
  { name: 'contrast+60',           img: 'scene', s: { contrast: 60 } },
  { name: 'contrast-40',           img: 'scene', s: { contrast: -40 } },
  { name: 'brightness+40',         img: 'scene', s: { brightness: 40 } },
  { name: 'brightness-40',         img: 'scene', s: { brightness: -40 } },
  { name: 'brightness+40-lamps',   img: 'lamps', s: { brightness: 40 } },
  { name: 'highlights-70',         img: 'scene', s: { highlights: -70 } },
  { name: 'shadows+70',            img: 'scene', s: { shadows: 70 } },
  { name: 'blackpoint-whitepoint', img: 'scene', s: { blackPt: 30, whitePt: 25 } },
  { name: 'sat150',                img: 'scene', s: { sat: 150 } },
  { name: 'sat50',                 img: 'scene', s: { sat: 50 } },
  { name: 'vibrance80',            img: 'scene', s: { vibrance: 80 } },
  { name: 'hue+60',                img: 'scene', s: { hue: 60 } },
  { name: 'hue+120-channel',       img: 'scene', s: { hue: 120 }, hueSpace: 'channel' },
  { name: 'hue+180-lamps',         img: 'lamps', s: { hue: 180 } },
  { name: 'hue+180-lamps-keepsat', img: 'lamps', s: { hue: 180, satPreserve: 100 } },
  { name: 'sat180-lamps',          img: 'lamps', s: { sat: 180 } },
  { name: 'sat180-lamps-keepsat',  img: 'lamps', s: { sat: 180, satPreserve: 100 } },
  { name: 'temp+300-tint-200',     img: 'scene', s: { temp: 300, tint: -200 } },
  { name: 'swap-rb',               img: 'scene', m: [0, 0, 100, 0, 100, 0, 100, 0, 0] },
  { name: 'swap-rb-lamps',         img: 'lamps', m: [0, 0, 100, 0, 100, 0, 100, 0, 0] },
  { name: 'swap-cyclic',           img: 'scene', m: [0, 100, 0, 0, 0, 100, 100, 0, 0] },
  { name: 'curve-s-master',        img: 'scene', curves: { master: [[0, 0], [0.25, 0.15], [0.75, 0.88], [1, 1]] } },
  { name: 'curve-red-only',        img: 'scene', curves: { r: [[0, 0], [0.5, 0.3], [1, 1]] } },
  { name: 'hotspot-red',           img: 'scene', s: { hotR: 70, hotSize: 40 } },
  { name: 'ca-red-blue',           img: 'scene', s: { caR: 100, caB: -100 } },
  { name: 'vignette+60',           img: 'scene', s: { vigAmt: 60 } },
  { name: 'sharpen+clarity',       img: 'scene', s: { sharpen: 60, clarity: 40 } },
  { name: 'dehaze+40',             img: 'scene', s: { dehaze: 40 } },
  { name: 'noise-reduction',       img: 'scene', s: { noiseReduction: 50, noiseColour: 50 } },
  { name: 'split-tone',            img: 'scene', s: { shSat: 40, hiSat: 40 } },
  { name: 'kitchen-sink',          img: 'lamps', s: { bright: 0.5, contrast: 30, sat: 120, vibrance: 30, temp: 100, highlights: -30, shadows: 30 } },
];

// Properties that must hold whatever the exact pixel values are. Each gets the render
// function and OKLab helpers from run.mjs (evaluated inside the page).
export const properties = [
  {
    name: 'exposure is monotonic (brighter with higher EV)',
    img: 'scene',
    run: async (P) => {
      const a = await P.meanLuma({ bright: -1 }), b = await P.meanLuma({ bright: 0 }), c = await P.meanLuma({ bright: 1 });
      return { ok: a < b && b < c, detail: [a, b, c].map(v => +v.toFixed(3)) };
    },
  },
  {
    name: 'saturation 100 and hue 0 leave the image unchanged',
    img: 'scene',
    run: async (P) => {
      const base = await P.render({}), same = await P.render({ sat: 100, hue: 0, vibrance: 0 });
      const d = P.deltaE(base, same);
      return { ok: d.max < 0.002, detail: d };
    },
  },
  {
    name: 'Keep saturation never reduces chroma of bright lamps (sat 180)',
    img: 'lamps',
    run: async (P) => {
      const off = await P.lampChroma({ sat: 180, satPreserve: 0 }), on = await P.lampChroma({ sat: 180, satPreserve: 100 });
      return { ok: on >= off - 0.002, detail: { keepSatOff: +off.toFixed(4), keepSatOn: +on.toFixed(4) } };
    },
  },
  {
    name: 'with Keep saturation on, raising saturation never lowers lamp chroma',
    img: 'lamps',
    run: async (P) => {
      const a = await P.lampChroma({ sat: 100, satPreserve: 100 }), b = await P.lampChroma({ sat: 140, satPreserve: 100 }), c = await P.lampChroma({ sat: 180, satPreserve: 100 });
      return { ok: b >= a - 0.002 && c >= b - 0.002, detail: [a, b, c].map(v => +v.toFixed(4)) };
    },
  },
  {
    // Informational: at Keep saturation 0 the gamut map trades chroma for fit on colours already at the
    // edge of sRGB, so a small drop is by design. This fails only if the drop becomes large.
    name: 'with Keep saturation off, the lamp chroma drop stays small (under 8%)',
    img: 'lamps',
    run: async (P) => {
      const a = await P.lampChroma({ sat: 100 }), c = await P.lampChroma({ sat: 180 });
      return { ok: c >= a * 0.92, detail: { at100: +a.toFixed(4), at180: +c.toFixed(4), change: +((c / a - 1) * 100).toFixed(2) + '%' } };
    },
  },
  {
    name: 'tone curve identity with extra diagonal points changes nothing',
    img: 'scene',
    run: async (P) => {
      const base = await P.render({}), same = await P.render({}, { curves: { master: [[0, 0], [0.3, 0.3], [0.7, 0.7], [1, 1]] } });
      const d = P.deltaE(base, same);
      return { ok: d.max < 0.001, detail: d };
    },
  },
  {
    name: 'reset returns to the default render exactly',
    img: 'scene',
    run: async (P) => {
      const base = await P.render({});
      await P.render({ bright: 1, contrast: 50, sat: 150, hue: 40 });
      const again = await P.render({});
      const d = P.deltaE(base, again);
      return { ok: d.max === 0, detail: d };
    },
  },
];
