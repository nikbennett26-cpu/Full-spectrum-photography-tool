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
  { n: 'Full-spectrum natural', s: 'no filter or a clear one · balanced to neutral', m: [100, 0, 0, 0, 100, 0, 0, 0, 100], sliders: { contrast: 6, vibrance: 20 }, autoWB: true }
];
/* Build 236: carries only the settings the look is made of, so the rest of your edit (Orton glow, targeted colours, film
   grain, sharpening and so on) stays as it was. Changing from one look to another still never mixes them: the first one's
   settings come off before the next goes on (presetLayerBegin in src/controls.js). */
function classicLookToUserPreset(c) {
  return { tv: 4, m: c.m.slice(), mOff: [0, 0, 0], sliders: Object.assign({}, c.sliders || {}) };
}
(function buildClassicLooks() {
  const grid = $('pgClassic'); if (!grid) return;
  CLASSIC_IR_LOOKS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'pb'; b.type = 'button';
    const esc = t => t.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]));
    b.innerHTML = '<b>' + esc(c.n) + '</b><small>' + esc(c.s) + '</small>';
    b.title = c.s + '. A starting point fitted by eye, not measured on your filter.';
    b.onclick = () => {
      if (b.classList.contains('on')) { armUndoCapture(); clearPreset(); commitUndoCapture(); haptic('select'); return; }   // a second press takes the look off, like the swap presets
      applyUserPreset(classicLookToUserPreset(c), { extra: c.autoWB ? classicAutoWB : null, mark: () => { b.classList.add('on'); updateClearPresetBtn(); } });
    };
    grid.appendChild(b);
  });
})();

/* Build 234: Full-spectrum natural balances itself. Without a filter the sensor sees visible light plus infrared, so a
   straight mix comes out with a strong cast (teal or magenta, depending on the camera and the light). This takes the
   rendered picture, averages the mid-tones (leaving out shadows and clipped highlights) in linear light, and sets the
   after-swap white balance so that average comes out neutral: the grey-world method. Run twice, because the tone stages
   bend the colour a little after the white balance. It goes in as the ordinary after-swap white balance, so the WB
   panel shows it and its reset clears it. */
function classicAutoWB() {
  try {
    if (!engine || !loadedImage) return;
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    for (let pass = 0; pass < 2; pass++) {
      engine.render(Object.assign(currentParams(), { dither: false }));
      const px = engine.readPixels(), n = px.length / 4, step = Math.max(1, Math.floor(n / 60000));
      let r = 0, g = 0, b = 0, c = 0;
      for (let i = 0; i < n; i += step) {
        const q = i * 4, R = lin(px[q]), G = lin(px[q + 1]), B = lin(px[q + 2]), L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        if (L < 0.02 || L > 0.8 || Math.max(R, G, B) > 0.97) continue;
        r += R; g += G; b += B; c++;
      }
      if (c < 500 || r <= 0 || g <= 0 || b <= 0) return;
      const k = [g / r, 1, g / b].map(v => Math.max(0.25, Math.min(4, v)));
      postWB = postWB.map((v, i) => v * k[i]);
      postWBM = [postWB[0], 0, 0, 0, postWB[1], 0, 0, 0, postWB[2]];
    }
    if ($('wbPostStatus')) $('wbPostStatus').textContent = 'Set \u2714 (auto, grey world)';
    render();
    if (typeof saveSessionState === 'function') saveSessionState();
  } catch (e) { console.warn('auto white balance', e); }
}
