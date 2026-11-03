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
  instead. Each time you tap Open photo or New image, a card shows how RAWs will be decoded (colour rebuild, full sensor
  or quick preview) before the file picker opens, so it is settled before you choose; a RAW dropped or shared in is asked
  about once it arrives; tick Don't ask again there, or untick Ask how to decode each RAW on the start page, to stop it.
  A RAW with no usable extension (Android's picker often names a file just "image") is recognised from its first bytes,
  for the card and for decoding.
- **Every new photo starts fresh:** edits are reset (unless Apply previous settings is on), and a camera-native decode
  that a look switched on (Digital Aerochrome, the Infrared Ektachrome IE look) is switched back off. Ticked by hand on
  the start page, it stays.
- **Pick up where you left off:** the photo and your edits are saved in the browser. Come back within 30 minutes and it
  reopens by itself; later, a Restore button offers it. Undo, redo and Reset all are always there.

## The RAW pipeline

Work that is best done on the sensor data is done there, before the channel swap stretches every fault:

**Decode → Balance before demosaic → Demosaic → Hot pixels & stripes → Highlight rebuild → Noise reduction → Deconvolution → White balance → Camera colour → Channel swap & mix → Edit → Export**

- **Demosaicing:** AMaZE by default for Bayer sensors, with RCD one tap away (switching re-decodes the open photo and keeps
  your edits, so the two can be compared); Markesteijn for Fuji X-Trans.
- **Balance before demosaic (Bayer, on by default):** AMaZE and RCD assume the sensor's three colours are roughly even;
  on infrared or UV one can be ten times the others, which leaves coloured fringes and zipper patterns on edges that a
  swap then makes louder. So the light's colour is measured on the raw mosaic itself (Cheng, Prasad & Brown's PCA
  method, the same as RAW Auto white balance), each photosite is balanced, the demosaic runs, and the balance is taken
  back off, so white balance and every edit see the same numbers as before. On a synthetic infrared test it cuts false
  colour on edges about ninefold with AMaZE and fourfold with RCD; on a real infrared portrait (Nikon D610, red about
  ten times green) fine-detail false colour drops by about a fifth with both, most visibly on hair. If the balance step
  cannot run (out of memory, or offline before it was ever loaded), the photo is decoded the ordinary way. A RAW takes a little longer to open; the switch is in
  Decode settings. Code: `libraw-wasm-gpl3/glue/pre-wb.mjs`; the second demosaic runs in
  `libraw-wasm-gpl3/dist/demosaic-only.wasm`, the same AMaZE and RCD source built without LibRaw
  (`libraw-wasm-gpl3/build_demosaic_only.sh`, zig's clang); test: `node libraw-wasm-gpl3/test_pre_wb.mjs`.
- **White balance (RAW):** opens on the camera's own as-shot balance. Temperature in Kelvin and Green, using
  RawTherapee's model, with As shot, Auto and Filters (grey picking is done by the two grey pickers above it). Dragging runs on the graphics chip, so it follows your finger at full
  resolution.
- **White balance from your filters (RAW):** the **Filters** button works the white balance out from your filter stack
  (Looks › Filters on this photo). Its own small box (the filters, as a link back to where they are picked, then
  Neutral and Adjust for the light in Advanced) shows only while Filters is the white balance. Pressing Filters with
  none set takes you to Filters on this photo, and the white balance is applied as soon as you add one. It works without looking at the picture, so a frame full of leaves or sky cannot pull it and the same recipe
  always starts in the same place. Per channel it sums a measured converted-sensor response (the one chosen in Digital
  Aerochrome (advanced); the Sony A7 III by default) × the filters × ASTM G173 sunlight × the target (a USGS oak leaf
  for **leaves neutral**, the classic infrared starting point, or a flat **grey card**), compares it with the same
  sensor behind an ordinary hot mirror, and puts that ratio on your camera's own 5500 K daylight balance, so only the
  filter's effect comes from the model sensor. **Auto adjusts for the light** (on by default) compares the scene's
  Cheng PCA estimate with the model's grey-card prediction and applies the difference (shade, low sun, cloud), capped at
  half a stop per channel. Changing the stack updates it. It is a starting point: cameras differ most in the infrared,
  so on a body unlike the measured sensor (on a Nikon D610 infrared portrait the prediction alone came out teal) Auto
  adjusts for the light does more of the work, and the stack has to be the one you actually used. Code: `src/filter-wb.js`.
- **Highlight recovery (RAW):** rebuilds clipped highlights from the colours around them (the inpaint-opposed method),
  measured against where each channel really clips in your file.
- **Noise reduction (RAW):** RawTherapee's wavelet noise reduction, applied to the sensor data before the swap, where the
  noise is still as the sensor recorded it. **On by default** when you open a RAW (Colour 50, Luminance 0, so texture stays); whatever you
  set by hand, including off, is remembered.
- **Hot pixels & stripes (RAW):** runs automatically on every RAW, with no control to set. It finds stuck or hot pixels and faint row or column stripes at full size
  and fixes them. Real points of light such as stars are left alone, and stripes are only touched when they
  can actually be found.
- **Wide working space (RAW):** on by default. A RAW's colours outside sRGB and its light above white are kept, unclipped,
  through noise reduction, white balance and the swap, and brought into the screen's range once, after the swap: only the
  most saturated colours are compressed (they stay saturated, using the shape of the ACES Reference Gamut Compression on
  encoded values), and the brightest light is rolled off with all three channels scaled together, so it keeps its colour.
  Before build 253 everything was clipped to sRGB as soon as the RAW arrived. Switch it off under Colour > Swap working
  space to get the old behaviour. The look stages after the swap, and so exports, are still sRGB.
- **Wide-gamut swap and camera colour:** the swap always runs on linear light in ProPhoto; there is no choice beside it.
  Classic mixer (gamma-encoded values, like an image editor's channel mixer, for matching a recipe made in one) and the
  other spaces are kept under Colour > Swap working space (advanced). The sensor decode can be fitted to the camera's own
  JPEG rendering of the same frame.

## The editor

Five tabs, in the order the picture is made: **Looks, Light, Colour, Detail, Export.** The panels are numbered
01 to 06: Channel Swap, White Balance, Light, Colour, Detail, Export.

- **Simple or Advanced**, chosen on the home page. Simple shows what most photos need. Advanced adds the channel mix grid,
  IR leak removal, local adjustments, HSL, calibration, swap space, LUTs, Orton glow, channel gains and more.
- **Seeing your photo:** before and after slider, or hold to compare; zoom and pan (mouse wheel on desktop, pinch on a
  phone); full-screen view; a histogram and RGB parade; clipping and print-gamut warnings.
- **Made for a phone:** a phone dock with controls under your thumb, long-press a slider value to type a number,
  double-tap it to reset, haptic taps. On a desktop you get a tool rail and a large photo.
- **Honest display:** where the browser allows it, the preview is 10-bit, to avoid colour banding while you edit.
  Elsewhere it falls back to 8-bit with dither, and Export says which one you have.

## Looks

- **Filters on this photo:** the one place to pick the filters the photo was taken through, from the 230+ measured
  curves, at the top of Looks with the rest of your setup. The closed card names them. The Filters white balance,
  Digital Aerochrome, the IR leak estimate and the record in exported files all use this list; where they
  show it, the names are a link that brings you back here (on a phone it switches to Looks and opens the card).
- **Swap & mix:** one-tap swaps (R↔B, G↔B, R↔G and the rotations), a full channel mix grid with offsets and a
  compact fine-tune bar for each cell, hold brightness and keep saturation.
- **Classic IR looks:** eight finished one-tap looks for ordinary infrared, each setting the channel mix and tone together and naming the filter it suits: B&W infrared (plain, dramatic, glow), warm-toned B&W, Goldie, Pink & teal, Faux colour IR film and Full-spectrum natural (which balances its own colour to neutral). They are starting points, fully editable. Tap a look again to take it off.
- **Presets & film recipes:** UV and IR presets, and recipes including Fedia's Triple Band Aerochrome. Save your own
  looks, with a strength control and an IR tone curve. NDVI and NGB index views.
- **Infrared Ektachrome IE · Triple Band:** for a full-spectrum camera with the MidOpt TB550/660/850 triple band filter,
  after nfoto's method on UltravioletPhotography.com: the RAW opened with no camera colour profile (camera native), no
  channel swap, and a 143° hue turn in Display mode; then pick grey on asphalt with grey picker 1 (before the swap). Aims at
  the original E-4 film (graded reds, darker conifers) rather than the later, harsher EIR. Not yet checked on a real photo.
- **Presets go on top of your edit:** a preset or look sets only its own settings and leaves the rest of your edit alone,
  whether you pick it first or last. Switching to another preset takes the first one's settings off before the next goes on,
  and clearing it puts back exactly what was underneath, keeping anything you changed since. Undo and the saved session keep track.
- **Digital Aerochrome:** its own card in Looks, after Film stocks & recipes. Works out the channel mix that makes your camera, through the
  filters you set, record what Kodak's colour infrared film recorded and printed (its characteristic curves and dyes):
  Aerochrome III 1443 (Kodak's AS-77 data sheet), Ektachrome Infrared EIR (TI-2323) or Ektachrome Infrared Aero 8443 (NASA's published data), in midday sun, low sun, overcast or open
  shade (sun, shade and sky from NREL's ASTM G173 solar spectra), fitted on realistic spectra and checked against measured surfaces from the USGS Spectral Library. It shows how close it gets, layer by layer, with film-vs-yours swatches for leaves, grass,
  pine needles, autumn and dry grass, bare earth, asphalt, concrete, brick, water, snow, red and yellow paint and sky, and warns if the stack lets blue in or blocks the
  infrared the film used. Change picks the filters right there (the same list Export records). The film can be put behind the classic filters (Wratten 12, 15, 16, 21, 25; B+W 023, 040, 041, 090;
  Y52 and O56 glass), following your stack when it has one, and keeps the tint each gave the film: deeper filters made
  greys warmer, skies greener and foliage redder. Apply puts it on as a look (RAW decoded camera native, then
  pick grey), with the film's own contrast as R, G and B tone curves unless you untick it.
- **Measured sensors:** the filter tools can use a converted Sony A7 III (Crowther 2022, the default), a converted
  Canon EOS 5DS R (Crowther 2019, the one to use for a converted Canon; build 267), and converted Canon 40D, Nikon D300, D200 and D700 bodies measured 375-1000nm by MaxMax (flagged: their channels do not converge
  past 840nm as direct measurements say they should), alongside the generic and astronomy curves.
- **Source channels:** a readout of which source channel carries your signal. For filter stacks that block blue,
  **IR leak removal** takes the infrared out of red and green before the swap, for cleaner Aerochrome-style colour.
- **White balance:** one card. At the top, the two grey pickers (before the swap and after it) and channel gains; under
  them Temperature & tint: camera white balance (RAW, with As shot, Auto and Filters), the swap, and the cast after it.
  Auto tone in the header. The grey pickers show in Simple too. The sliders give finer control where real settings sit (half the travel covers ±100).

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
  Three ways to measure the turn: Perceptual (even to the eye), Channel (120° is exactly a cyclic channel swap) and
  Display (turns the display values like the usual editor Hue/Saturation tool, brightness free to change), so an angle from a
  recipe written for one of those means the same here.
- **Colour by band:** eight bands, each with hue, saturation and luminance. Bands are chosen from the colour of the area
  around each pixel, not its own grainy colour, so a sky moves as one.
- **Targeted colour** (Advanced): pick a colour on the photo and shift its hue, saturation or lightness. Lightness works
  like exposure, so the selection keeps its contrast. Applied to the original colours, before the swap.
- **Calibration, working space, LUTs** (Advanced): primary and shadow-tint calibration; the swap's working space (Wide
  ProPhoto by default, Classic mixer, sRGB with no widening, or your own widening) and the wide working space switch;
  apply a `.cube` LUT as a final grade. Most photos never need the working space touched.

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
- **Anamorphic desqueeze (Advanced):** beside Crop, for anamorphic lenses, 1.33×, 1.5×, 1.66× or 2×. The photo is shown at its true shape while
  you edit (pickers, masks and crop still land where you touch, and crop ratios apply to the desqueezed picture), and
  every export, share and batch file is resampled once at the end, after the crop: **Widen** keeps every row and adds
  width (sharp Catmull-Rom), **Lower the height** keeps the width and averages rows, for a smaller file. Saved with the
  edit; Reset all turns it off.
- **Filter record:** the filter stack is written into each file's metadata; the link beside the option takes you to
  Filters on this photo.
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
- **Stack and predict:** stack several filters to see the combined transmission, drawn as a fine 1px line at the
  screen's full sharpness so the curve can be read accurately on a phone; see the predicted RGB response, and
  check a stack for infrared leaks. *Suggest a recipe*: describe the look you want and get filter combinations.
- **Data you can trust:** every filter names its source and how the curve was taken from it, with a badge (maker data,
  measured, chart, fit or estimate). A data self-test checks every curve, and you can switch to real data only.
- **Bring and take:** import your own filter data; export CSV, JSON or a PNG report of your stack.

## Everything else

- **Install as an app** from the bottom of the editor: opens full screen and keeps working offline.
- **Android app (testing):** IR Lab for Android, `uk.irlab.app`, is irlab.uk itself shown full screen (a Trusted Web
  Activity), so it gets every site update straight away. Photos can be shared into it from the gallery. Needs Android 7
  or newer. The APK is at
  [releases/download/android/irlab-uk.apk](https://github.com/nikbennett26-cpu/full-spectrum-photography-tool/releases/download/android/irlab-uk.apk).
- **Six languages:** English, Spanish, French, German, Japanese and Chinese, chosen on the home page (the filter page
  follows).
- **Discord:** the community, testers and the Android app are on the irlab Discord: https://discord.gg/rWhu8U6Ne2 (linked
  from the home page).
- **Updates:** the editor footer shows your build number, and the app checks for a newer one. A change log is inside the app.

## Privacy

Photos never leave your device: decoding, editing and export all happen in the browser. The site counts visits with
Google Analytics (anonymised IP, no advertising features), and says so on first visit. The full policy, which also
covers the Android app, is [privacy.html](https://irlab.uk/privacy.html) (linked from the editor footer).

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

Text with no entry simply stays in English, so editing an English string means updating its entries too. The newest
cards (Filters on this photo, the Filters white balance options, Digital Aerochrome and Anamorphic desqueeze) have no
entries yet, so they show in English in every language for now.
`python3 tools/i18n_check.py index.html de` lists what is still English in a language (it needs the local server on
port 8820 and Playwright). The What's new change log, and the filters page's long research notes (marked `.noTr`), are
deliberately English only. Text drawn into a canvas is outside the page, so it goes through `irlabTr.lookup()` directly
(`trT()` on the filters page). The filter descriptions are " · " lists; the engine translates them piece by piece.

## Android app

`android/` is the Android project, generated by Bubblewrap from `android/twa-manifest.json` (package `uk.irlab.app`).
`.github/workflows/android.yml` builds it on GitHub (Android tools can't be fetched from the dev machine): run it from the
Actions tab, or it runs itself when `android/` changes on main. It sets the app version to the site's build number, then
puts the signed `irlab-uk.apk` and the Play upload bundle `irlab-uk.aab` on the `android` release.

- **Signing key:** `android/irlab.keystore.enc` is the release key, encrypted (AES-256, PBKDF2). The repository secret
  `ANDROID_KEY_PASSWORD` unlocks it and is also the keystore and key password (alias `irlab`). Keep a copy of that
  password somewhere safe: every future version must be signed with the same key. Without the secret the workflow builds
  with a throwaway key to check the build, and publishes nothing.
- **Ownership file:** `.well-known/assetlinks.json` holds the release key's SHA-256 fingerprint, which lets the app hide
  the browser address bar. If the app goes on Google Play with Play App Signing, add the fingerprint Play shows (Setup >
  App signing) to the same list.
- **Changing the app** (name, icon, colours): edit `twa-manifest.json`, run `bubblewrap update --skipVersionUpgrade`
  in `android/`, commit. Icons are fetched from the repo's raw files, so push new icons first.

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
