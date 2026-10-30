/* ---- Classic IR looks (build 233) ----
   Whole-look starting points for people who shoot ordinary infrared and want a finished picture, not a channel swap to tune.
   Each one sets the channel mixer AND the tone and colour sliders together, through the same routine that My Presets use, so
   it is one undo step and every slider stays editable afterwards. They are fitted by eye to typical results, not measured on
   your filter, so each says which filter it suits: expect to nudge white balance and exposure. The mixer rows are the
   output channels (R, G, B) and the columns the input channels (R, G, B), in percent, the same layout as the swaps. */
const CLASSIC_MONO = [100, 0, 0, 100, 0, 0, 100, 0, 0];   // greyscale from the red channel, where the infrared signal sits
const CLASSIC_IR_LOOKS = [
  { n: 'B&W infrared', s: '720nm and up · white foliage, dark sky', m: CLASSIC_MONO, sliders: { contrast: 18, highlights: -8 } },
  { n: 'B&W infrared, dramatic', s: '720nm and up · punchy contrast, deep sky', m: CLASSIC_MONO, sliders: { contrast: 45, shadows: -15, highlights: -20 } },
  { n: 'B&W infrared, glow', s: '720nm and up · soft dreamy bloom', m: CLASSIC_MONO, sliders: { contrast: 6, shadows: 18, highlights: -12, orton: 35, ortonSoft: 60 } },
  { n: 'Warm-toned B&W', s: '720nm and up · sepia-toned mono', m: [104, 0, 0, 90, 0, 0, 68, 0, 0], sliders: { contrast: 15, highlights: -8 } },
  { n: 'Goldie', s: '590 to 665nm \u00b7 warm gold foliage, rose sky', m: [0, 0, 100, 100, 0, 0, 0, 100, 0], sliders: { hue: 42, contrast: 10, sat: 110 } },
  { n: 'Pink & teal', s: '665nm \u00b7 magenta foliage, teal sky', m: [0, 0, 100, 100, 0, -20, 0, 100, -20], sliders: { contrast: 8, sat: 105 } },
  { n: 'Faux colour IR film', s: '665 to 720nm \u00b7 Aerochrome-style red foliage', m: [0, 0, 100, 100, 0, -30, 0, 100, -30], sliders: { contrast: 18, sat: 120 } },
  { n: 'Full-spectrum natural', s: 'no filter or a clear one · daylight-style colour', m: [100, 0, 0, 0, 100, 0, 0, 0, 100], sliders: { contrast: 6, vibrance: 20 } }
];
function classicLookToUserPreset(c) {
  const base = { orton: 0, ortonSoft: 50 };
  return { tv: 4, m: c.m.slice(), mOff: [0, 0, 0], sliders: Object.assign(base, c.sliders || {}), targetedBands: [], filmOn: false, filmToneOn: false };
}
(function buildClassicLooks() {
  const grid = $('pgClassic'); if (!grid) return;
  CLASSIC_IR_LOOKS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'pb'; b.type = 'button';
    const esc = t => t.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]));
    b.innerHTML = '<b>' + esc(c.n) + '</b><small>' + esc(c.s) + '</small>';
    b.title = c.s + '. A starting point fitted by eye, not measured on your filter.';
    b.onclick = () => { applyUserPreset(classicLookToUserPreset(c)); document.querySelectorAll('#pgClassic .pb.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); };
    grid.appendChild(b);
  });
})();
