# irlab.uk: Infrared Colour Swap

**[irlab.uk](https://irlab.uk)** is a free browser darkroom for full-spectrum, infrared and UV photography.
Open a photo or a RAW file, swap and mix its channels, balance it, grade it and export it. Everything runs on your own
device; nothing is uploaded.

It works on a phone, a tablet or a desktop, and can be installed as an app (Install as an app, at the bottom of the
editor) so it opens full screen and keeps working offline.

[Open irlab.uk](https://irlab.uk) · [Filter database](https://irlab.uk/filters.html) · [Self-test](https://irlab.uk/?selftest) · [Formatted version of this guide](https://irlab.uk/README.html)

**Contents:** [Opening photos](#opening-photos) · [RAW pipeline](#the-raw-pipeline) · [The editor](#the-editor) · [Looks](#looks) · [Light](#light) · [Colour](#colour) · [Detail](#detail) · [Export](#export) · [Trichrome](#trichrome) · [Filter database](#filter-database) · [Everything else](#everything-else) · [Privacy](#privacy)

## Opening photos

- **Ordinary images:** JPEG, PNG, WebP, AVIF and TIFF (16-bit TIFF in, 16-bit TIFF out).
- **RAW files:** CR2, CR3, NEF, ARW, SR2, DNG, ORF, RW2, PEF, RAF, SRW, NRW, 3FR, IIQ, MRW, KDC, DCR and X3F, decoded from
  the sensor data in the browser by LibRaw compiled to WebAssembly. A quick-preview mode reads the camera's embedded JPEG
  instead.
- **Pick up where you left off:** the photo and your edits are saved in the browser. Come back within 30 minutes and it
  reopens by itself; later, a Restore button offers it. Undo, redo and Reset all are always there.

## The RAW pipeline

Work that is best done on the sensor data is done there, before the channel swap stretches every fault:

**Decode → Hot pixels & stripes → Highlight rebuild → Noise reduction → Deconvolution → White balance → Camera colour → Channel swap & mix → Edit → Export**

- **Demosaicing:** AMaZE by default for Bayer sensors, with RCD one tap away (switching re-decodes the open photo and keeps
  your edits, so the two can be compared); Markesteijn for Fuji X-Trans.
- **White balance (RAW):** opens on the camera's own as-shot balance. Temperature in Kelvin and Green, using
  RawTherapee's model, with As shot, Auto and Pick. Dragging runs on the graphics chip, so it follows your finger at full
  resolution.
- **Highlight recovery (RAW):** rebuilds clipped highlights from the colours around them (the inpaint-opposed method),
  measured against where each channel really clips in your file.
- **Noise reduction (RAW):** RawTherapee's wavelet noise reduction, applied to the sensor data before the swap, where the
  noise is still as the sensor recorded it. **On by default** when you open a RAW (Colour 50, Luminance 0, so texture stays); whatever you
  set by hand, including off, is remembered.
- **Hot pixels & stripes (RAW):** runs automatically on every RAW, with no control to set. It finds stuck or hot pixels and faint row or column stripes at full size
  and fixes them. Real points of light such as stars are left alone, and stripes are only touched when they
  can actually be found.
- **Wide-gamut swap and camera colour:** optionally do the swap in the camera's own wider colour space (or ProPhoto) so
  saturated colours survive it. The sensor decode can be fitted to the camera's own JPEG rendering of the same frame.

## The editor

Five tabs, in the order the picture is made: **Looks, Light, Colour, Detail, Export.**

- **Simple or Advanced**, chosen on the home page. Simple shows what most photos need. Advanced adds the channel mix grid,
  IR leak removal, local adjustments, HSL, calibration, swap space, LUTs, Orton glow, channel gains and more.
- **Seeing your photo:** before and after slider, or hold to compare; zoom and pan (mouse wheel on desktop, pinch on a
  phone); full-screen view; a histogram and RGB parade; clipping and print-gamut warnings.
- **Made for a phone:** a phone dock with controls under your thumb, long-press a slider value to type a number,
  double-tap it to reset, haptic taps. On a desktop you get a tool rail and a large photo.
- **Honest display:** where the browser allows it, the preview is 10-bit, to avoid colour banding while you edit.
  Elsewhere it falls back to 8-bit with dither, and Export says which one you have.

## Looks

- **Swap & mix:** one-tap swaps (R↔B, G↔B, R↔G and the cyclic rotations), a full channel mix grid with offsets and a
  compact fine-tune bar for each cell, hold brightness and keep saturation.
- **Classic IR looks:** ten finished one-tap looks for ordinary infrared, each setting the channel mix and tone together and naming the filter it suits: B&W infrared (plain, dramatic, glow), warm-toned B&W, Goldie, Pink & teal, Faux colour IR film and Full-spectrum natural (which balances its own colour to neutral). They are starting points, fully editable.
- **Presets & film recipes:** UV and IR presets, and recipes including Fedia's Triple Band Aerochrome. Save your own
  looks, with a strength control and an IR tone curve. NDVI and NGB index views.
- **Source channels:** a readout of which source channel carries your signal. For filter stacks that block blue,
  **IR leak removal** takes the infrared out of red and green before the swap, for cleaner Aerochrome-style colour.
- **Temperature & tint:** camera white balance (RAW), then a balance before the swap and one after it, each with a grey
  picker; Auto tone and channel gains. The sliders give finer control where real settings sit (half the travel covers ±100).

## Light

- **Exposure & tone:** exposure, brightness, contrast, highlights and shadows. Highlights and Shadows read an edge-aware
  map of the picture's brightness, so a sky is lifted or recovered as one area, with no glow along its edge. Range controls
  set where they start. One-tap **Auto levels** (RawTherapee's method).
- **Black & white point:** set where black and white sit.
- **Tone curve:** *Regions* (four sliders: Highlights, Lights, Darks, Shadows, bend the curve for you) and *Points* (drag
  points on RGB or on each channel, over that channel's histogram, with presets).
- **Local adjustments:** up to four, each with a linear, radial, luminosity, colour or **foliage (IR)** mask. The foliage
  mask selects leaves by how they reflect near-infrared, so it follows them whatever colour you swap them to.

## Colour

- **Overall:** hue, saturation and vibrance. Hue shift keeps each pixel's brightness, so big turns on a noisy sky stay clean.
- **Colour by band:** eight bands, each with hue, saturation and luminance. Bands are chosen from the colour of the area
  around each pixel, not its own grainy colour, so a sky moves as one.
- **Targeted colour** (Advanced): pick a colour on the photo and shift its hue, saturation or lightness. Lightness works
  like exposure, so the selection keeps its contrast. Applied to the original colours, before the swap.
- **Calibration, working space, LUTs** (Advanced): primary and shadow-tint calibration; choose how wide the swap works
  (standard sRGB, Rec2020, Wide ProPhoto as the default, or your own widening); apply a `.cube` LUT as a final grade.

## Detail

- **Hotspot removal:** takes out the bright centre patch some lenses throw on infrared, with a Set centre control.
- **Dust removal:** tap each speck and it is healed the way darktable does it, by copying a matching patch from nearby and
  blending its edge in. **Find dust** looks for small, soft, round, darker spots on smooth areas such as sky and adds them
  for you, keeping only spots that darken red, green and blue alike and sit on calm ground (not leaves, coloured objects or edges); Sensitivity sets how faint a spot it takes, and Show dust helps you check.
- **Noise:** RAW luminance and colour noise reduction and hot pixels & stripes (RAW files), regular luminance and colour
  noise reduction for any photo, and **Smooth banding**, which melts the steps in a smooth sky after a strong edit.
- **RAW deconvolution (RAW):** real Richardson-Lucy deconvolution on the sensor data before the swap. It gives back fine detail that ordinary sharpening cannot. The blur radius is measured from the photo (the method of ART) or set by hand, and it fades out in noise and near clipped highlights. Amount 0 is off.
- **Sharpening:** amount, radius and masking, in the style of RapidRAW. It does not bring back the noise that was removed.
- **Clarity & dehaze:** clarity adds local contrast only, without brightening the picture. **Dehaze** measures haze across
  the whole picture (a dark-channel haze map), so a sky clears evenly right up to a dark building, with no halo.
- **Orton glow:** a blurred, brightened copy over the sharp photo, with Amount and Softness.
- **Colour fringing:** controls for coloured edges toward the corners.

## Export

- **Files:** crop to common aspect ratios; 16-bit TIFF, PNG or JPEG at working size or full size, with optional ProPhoto
  RGB. Your EXIF and colour profile carry across.
- **Batch:** apply the current look to many files at once and download them in one `.zip` (RAWs are exported at full size).
- **Take your look with you:** *Save look as .cube*, made by the same code that draws the preview; *Save look for camera
  (.IRL)* for a Canon running Magic Lantern with the irlut module, so you see the look in LiveView; and *Look link*, your
  settings packed into a web address anyone can open (it saves the look to My presets and applies it to the next photo).
- **Share:** send a full-quality JPEG to your phone's share sheet (Instagram, WhatsApp and the rest). *Before | after*
  makes one picture of the original and your edit.

## Trichrome

**Stack three real shots into one, each feeding one colour,** from the home page ("› stack three shots"). Recipes for red
Aerochrome (an infrared, a red-filter and a green-filter shot rebuilt as colour infrared film), classic RGB filter
trichrome, three infrared bands, and plain shots with no filters. The shots are lined up automatically on the parts that
did not move (shift and small rotation, with a hand nudge), balanced, and opened in the editor as a 16-bit TIFF.
Code: `src/trichrome.js`.

## Filter database

**[irlab.uk/filters.html](https://irlab.uk/filters.html)**, a separate page for working out what your lens stack lets
through.

- **500+ filters:** Schott glass, B+W, Hoya, Wratten, Kodak colour-compensating, 221 Thorlabs and 90 Edmund Optics
  filters, most with digitised or measured manufacturer curves. Search by name or by what you want it to do (UV-pass,
  IR-pass, IR blocker, colour).
- **Stack and predict:** stack several filters to see the combined transmission, see the predicted RGB response, and
  check a stack for infrared leaks. *Suggest a recipe*: describe the look you want and get filter combinations.
- **Data you can trust:** every filter names its source and how the curve was taken from it, with a badge (maker data,
  measured, chart, fit or estimate). A data self-test checks every curve, and you can switch to real data only.
- **Bring and take:** import your own filter data; export CSV, JSON or a PNG report of your stack.

## Everything else

- **Install as an app** from the bottom of the editor: opens full screen and keeps working offline.
- **Six languages:** English, Spanish, French, German, Japanese and Chinese, chosen on the home page (the filter page
  follows).
- **Updates:** the editor footer shows your build number, and the app checks for a newer one. A change log is inside the app.

## Privacy

Photos never leave your device: decoding, editing and export all happen in the browser. The site counts visits with
Google Analytics (anonymised IP, no advertising features), and says so on first visit.

## Checking a build

Open **[irlab.uk/?selftest](https://irlab.uk/?selftest)** (the Self-test link in the editor footer). It generates two
test images, renders around fifty fixed settings on this device's GPU and compares them with a stored baseline in
OKLab ΔE, then checks rules that must always hold (neutral settings change nothing, reset is exact, Keep saturation
never reduces chroma, and so on). The editor footer shows which build you are running.

### Regression suite (development)

`run.mjs`, `cases.mjs` and `golden.json` run the same kind of check headlessly with software WebGL, so the result
does not depend on your GPU. Put them in a folder next to `index.html` (so `../index.html` exists), then:

    npm install
    npm test                   # compare the current build to golden.json
    npm run update             # accept the current build as the new baseline

Other options: `node run.mjs --file path/to/index.html`, `--only sat180` (run matching cases only).

`golden.json` is "what the build looked like when this was written", not a measured ground truth. Look at the images
once, and only run `update` when a change is one you meant to make. A failing line shows mean, 99th-percentile and
worst-pixel ΔE (about 0.02 is a just-noticeable difference), so you can tell a rounding wobble from a real change.
Add a case by adding a line to `cases.mjs`; controls are set by element id, and ones a build does not have are
skipped, so the same suite runs against older builds.

## Languages

The interface comes in English, Spanish, French, German, Japanese and Chinese, chosen from the menu on the home page
(the filters page follows the same choice). Two mechanisms work together:

- `I18N` in `src/i18n.js`: short labels with a `data-i18n` key on the element.
- `i18n/tr.js` with `i18n/<lang>.js`: everything else, matched by its English text (spaces collapsed), including
  tooltips, placeholders and text the app writes while running. Templates in `tr.js` cover repeated patterns such as
  "decrease Exposure". A sentence broken up by bold or italic words is marked `data-tr-block` and translated whole.
  Only the chosen language's file is loaded.

Text with no entry simply stays in English, so editing an English string means updating its entries too.
`python3 tools/i18n_check.py index.html de` lists what is still English in a language (it needs the local server on
port 8820 and Playwright). The What's new change log, and the filters page's long research notes (marked `.noTr`), are
deliberately English only. Text drawn into a canvas is outside the page, so it goes through `irlabTr.lookup()` directly
(`trT()` on the filters page). The filter descriptions are " · " lists; the engine translates them piece by piece.

## Code layout

The editor is `index.html` (the page itself), three stylesheets in `css/`, and its code, which is written in `src/`
and published as one file, `editor.js`:

| Source file | What is in it |
|---|---|
| `src/shaders.js` | the WebGL shaders: the whole colour pipeline that runs on the GPU |
| `src/engine.js` | the WebGL engine that runs them, and the JS sRGB transfer functions |
| `src/i18n.js` | the six languages and app-wide state |
| `src/view.js` | histogram, analytics, source inspector, loupe, zoom, pan, update check |
| `src/controls.js` | sliders, tone mapping, sky selection, per-panel reset, draft rendering, the mixer, presets |
| `src/raw-preview.js` | embedded previews, the RAW probe, camera colour, chroma reconstruction, the CR2 decoder |
| `src/session.js` | ZIP writer, batch, saving and restoring the session |
| `src/raw-process.js` | demosaic choice, the RAW decoder, RAW noise reduction and highlight reconstruction, TIFF reader |
| `src/ui.js` | drag and drop, loading, undo, the panels and tabs |
| `src/wb-lut.js` | white balance picking, LUTs |
| `src/colour-mirror.js` | a JS copy of the shader's colour maths, for the readouts |
| `src/export.js` | EXIF and ICC profiles, full-size render, TIFF, saving the file |
| `src/dock.js` | the phone dock and sheet, channel-swap space, in-page dialogs |
| `src/trichrome.js` | the trichrome tool: three shots lined up and stacked into one |
| `src/share.js` | Share, Before \| after and look links |
| `src/selftest.js` | the built-in self-test and its stored baseline; built on its own into `editor-selftest.js`, which is only fetched for `?selftest` |
| `src/undo-buttons.js` | the undo and redo buttons |

The filters page works the same way: `filters.html`, `css/filters.css`, and its code in `src-filters/` (layout, the
filter model, the filter data, the 221 Thorlabs filters (`src-filters/thorlabs.js`, built from measured data by
`tools/thorlabs/`, see its README), the 90 Edmund Optics filters (`src-filters/edmund.js`, from `tools/edmund/`), the SCHOTT
glass curves (`src-filters/schott.js`, generated by `tools/schott/convert.py`), every filter's source record
(`src-filters/provenance.js`, checked by `tools/provenance/verify.py`), list and search, export, the recipe finder, the chart, the data self-test, zoom and
stacking guidance, the spectral response), built into `filters.js`.

**Filter data provenance (build 146).** Every filter has a structured source in `src-filters/provenance.js`: who
published the data, which document, and how the curve was taken from it (the maker's own numbers, an independent
measurement, a chart digitised by calibrated trace or by eye, a calculation, a fit, or an estimate). The badge on
each filter is derived from that record, and the data self-test fails any filter whose record and stored curve
disagree, or any uncoated absorptive glass that passes more than its two surfaces allow.
- SCHOTT glasses: SCHOTT's own internal transmittance tables and reflection factors are archived in
  `tools/schott/data/tables.txt`; `python3 tools/schott/convert.py --check <Filter-Plotter-Data checkout>` writes
  `src-filters/schott.js` (external transmittance = tau_i x Pd) and compares every table with CheeseCube312's
  independent copy (`tools/schott/check.txt`).
- Curves taken from CheeseCube312's Filter-Plotter-Data are pinned to commit `6c8ff04`;
  `python3 tools/provenance/verify.py <checkout at that commit>` compares each stored curve with its file and records
  the difference on the filter's card (`tools/provenance/check.txt`).

**Edit `src/` and `src-filters/`, never `editor.js` or `filters.js`.** `tools/build.py` joins each page's sources, in the order listed in it, into its one script.
They are one script split for reading, not modules: they share one global scope, and as one file they run in one go,
so a function anywhere is available from the start. (Loaded as separate files, the browser could run a reopened
session or a tap between two of them and reach code that had not arrived yet; that broke the app in builds 130-131.)

The published scripts are shrunk (build 141): `tools/build.py` passes each joined script through Terser
(`tools/minify.mjs`), which removes comments and spacing and shortens local names, so the editor downloads about
280 KB compressed instead of 420 KB. The sources keep every comment. Each script ships with a `.map` file, so a
browser's developer tools show errors at the original `src/` file and line. Run `npm install` in `tools/` once
before building; `python3 tools/build.py --readable` writes the scripts unshrunk for debugging.

After a change, set the new build number everywhere and rebuild in one step:

    python3 tools/bump_build.py <build>

It updates the version stamps, the build number the in-app update check reads, and the `?b=<build>` on each file's
URL (so a cached old file never runs under a newer page), then runs `tools/build.py`.

## Credits

Tool by [@irlab.uk](https://www.instagram.com/irlab.uk) and [Phil Warren](https://philwarrenphotography.com).
Colour science and RAW decoding by Phil Warren. Tested and contributed by
[@fedialebarboc](https://www.instagram.com/fedialebarboc).

RAW decoding uses LibRaw, and parts of the processing are ported from RawTherapee and darktable. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for their licences.

## Open-source code used

Colour calibration, highlights, shadows, noise reduction and sharpening in the editor are ported from
[RapidRAW](https://github.com/CyberTimon/RapidRAW) (AGPL-3.0).

## Licence

AGPL-3.0-or-later: see [LICENSE.md](LICENSE.md).
