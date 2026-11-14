# Premium pass (on top of build 405)

No new features. Every change upgrades how an existing tool behaves, reads or looks. The default render and saved looks are unchanged: the built-in self-test (`?selftest`) still says "All good" (90/90) against the existing baseline. No user-visible strings were added or changed.

**Before you deploy:** run `python3 tools/bump_build.py`. This pass was built without bumping the build number, so the `?b=405` cache tags and the service worker would otherwise keep serving old files.

## Sliders and controls (`src/controls.js`, `src/view.js`, `css/premium.css` part 2)
- **Fill from home.** Fill now runs from each slider's default to the thumb, not from the left edge, so +0.7 EV and −0.7 EV read differently at a glance. Sliders whose default is not at either end show a small home notch.
- **Changed state.** A slider off its default shows its name and number in warm white; at default they are quiet grey. This works on phone too, and updates on drag, preset, undo/redo, reset, typed value and session restore.
- **Double-click to reset.** Double-click the slider or its name (mouse/pen) to reset it, as exactly one undo step. Touch keeps double-tap on the value.
- **Keyboard undo.** A burst of arrow keys makes one undo step. Before, arrows after an Undo made none.
- **Feel.**
  - Held slider: thumb grows with a red halo, and other rows don't dim.
  - Solid "machined" thumb, 3px track and a clear keyboard focus ring.
  - Phone thumb is 22px.
- **Fine chip bug fixed.** The fine-adjust tag always rendered as a bare "×" because the CSS read the attribute from the wrong element. It now reads "FINE × 0.1".
- **Other controls.** Pressed, hover and focus states on buttons, checkboxes, menus and the Range-controls toggle.

## Visual design (`css/premium.css` part 1)
- **Elevation scale.** The photo stage is recessed (darkest), panels are one step up, open groups one step higher, and floating things (bar, toasts, dialogs) get the only real shadows. All stays neutral grey.
- **Hierarchy.** Three clear levels: panel title > section > row. An open section becomes a contained card.
- **Top bar.** One consistent button style; before, it mixed four.
- **Tabs and histogram.** The active tab is unmistakable, and the histogram sits in an instrument-style card.
- **Phone.** The controls sheet is a raised surface instead of a black void, and the active bottom tab has a pill.
- **Motion.** Short eased transitions, and none during slider drags. Everything is off under reduced motion.
- **Colour fix.** The floating bar's `backdrop-filter: saturate(1.3)` was removed: it boosted the photo's saturation under it.

## Instruments and on-photo tools (`src/view.js`, `src/ui.js`, `src/wb-lut.js`, `css/premium.css` part 3)
- **Zoom anchoring bug fixed.** Zooming after a pan drifted 24px off the cursor; it now drifts 0px.
- **Pan and pinch follow the finger.** They used to ease about 0.12s behind it.
- **Histogram.**
  - Faint fills per channel, so the three channels no longer hide each other.
  - Palette colours.
  - Corner lamps that light when highlights or shadows clip.
  - A readable plate behind the clipping text.
- **Tone curve.**
  - A tap near the line adds the point exactly on it, so adding a point no longer kinks the curve.
  - Larger touch hit radius.
  - Dashed in/out guides while dragging.
  - A guard against accidental delete-by-double-tap after a drag.
  - Finer drawing.
  - The curve maths is unchanged.
- **Mask handles.** Dark-plus-light double outline, so they read on bright sky and in shadow.
- **Before/after divider.** Neutral hairline with a dark halo. The red line vanished on red/magenta foliage.
- **Pickers.**
  - Esc cancels an armed picker or the dust tool.
  - A thin red outline on the photo while a picker is armed.
  - The "showing original" status is visible again while holding to compare on desktop.

## Image quality (`src/shaders.js`, `src/colour-mirror.js`)
- **Clarity in full-size export.** Clarity now matches the preview: correlation 0.65 → 0.997. Before, export measured local contrast over a 2–4× smaller patch.
- **Show clipping flags blown whites.** It never could before, because white tops out at 253 (see proposals).
- **.cube export.** Exposure is applied where the shader applies it. Worst error was 203 levels; it is now 1.

## Round 2 (the owner's picks, plus the magenta bug)
- **Magenta blow-outs in RAW highlights, fixed** (`src/engine.js`, `src/raw-preview.js`). Reproduced on an IR-converted Canon CR2 (IMG_0511) with filters Wratten 12 + Didymium + GRB1, Digital Aerochrome fit, both ticks on.
  - **Cause:** red clips while green and blue never do (white balance 0.64 / 1 / 5.2). The highlight rebuild lifted only the clipped channel, to the level that blue's large gain set, and left green behind. The camera matrix then turned that into flat magenta (green as low as 1 of 255).
  - **Fix:** the rebuild now takes the whole pixel toward neutral, faded in over the same 90-98.5% of clip, so blown paint is white with no seam. With Highlight recovery ticked, the rebuilt colour is trusted less the further past clip it had to go (neutral by 1.4× clip), and its brightness and shape are kept.
  - **Result:** magenta pixels fell from 1,277 to 35 in the default mode and from 838 to 38 with Highlight recovery. The pixels left are the real tail lights.
  - **Not done:** an earlier attempt faded all over-white light to white. It was dropped because the self-test holds, by design (build 253), that a genuinely saturated light above white keeps its colour.
- **White reaches 255** (`src/shaders.js`, `src/colour-mirror.js`). This covers JPEG/PNG (8-bit 255, 16-bit 65535) and RAW, where white was 250-254 and now lands on 1.0.
  - **JPEG/PNG:** only pixels whose brightest channel was 253 or above moved, by at most 2 levels.
  - **RAW:** values from 0.9 to white rise at most 2.6%.
  - **Histogram:** its white clipping readout now works.
  - **Self-test:** the baseline was re-recorded for this change. The old baseline still passed; every row that moved was a near-white or saturated case.
- **Sentence case and a calmer Export** (`css/premium.css`, `index.html`, `src/export.js`, `i18n/*`).
  - Uppercase sub-headings now read in sentence case.
  - "Export image" is a 46px button in a slightly deeper red that brightens on hover. It is still the one solid red action in its tab.
  - "Choose files" in Batch became a neutral tile.
  - The English text and translation key are now "Export image"; the translations already used sentence case.
  - The phone grab bar now sits on the sheet instead of over the before/after pill.
- **Fine adjust on phones works** (`src/controls.js`, `src/view.js`). While dragging, move your finger up off the track: about 50px up gives ×0.25, about 120px up gives ×0.08.
  - The value doesn't jump when you switch speeds, and the "fine × 0.25" chip shows.
  - Scrolling that starts on a slider still scrolls.
- **.cube fallback** (`src/colour-mirror.js`). The .cube file is normally baked on the graphics chip, which was already exact for these controls. The CPU fallback, used only if the graphics bake fails, now also mirrors Brightness, White point, both tone curves, calibration and film tone.
  - Example: point curve error fell from 15.7 / 49 to 0.2 / 1 levels (mean / max).
  - Limits: a swap in a wide space and the colour bands use a local average of the photo, which a .cube cannot carry. Bakes that use them stay approximate.

## Still open, for the owner
Round 3 closed all three:

1. **Negative Contrast** no longer speckles. Within 0.02 of black or white (encoded) the curve is a straight line, so the slope is finite (at most 5x at Contrast -50, instead of infinite). Strength 1 and above is unchanged. Shader and the CPU mirror both changed.
2. **Negative Dehaze** eases in (smoothstep on the strength): -10 now lifts as much as -2.8 did before, while -50 and -100 are unchanged.
3. **Clarity at +100** has far smaller halos. The blur now down-weights taps more than about 2 stops from the centre, so it stays on the pixel's own side of a wide edge. On a 60/200 step edge at +100 the bright-side overshoot fell from +55 to +3 and the dark side from -29 to -7. Ordinary texture is nearly unaffected, but the self-test row `sharpen+clarity` moved (mean 0.0046), so **the baseline was re-recorded** for it.
4. **Phone fine-adjust distance:** if ×0.1 should arrive sooner (e.g. at 70px), change the thresholds in `touchFineFactor` (view.js).
