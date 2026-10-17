# irlab.uk: Infrared Colour Swap

**[irlab.uk](https://irlab.uk)** is a free browser darkroom for full-spectrum, infrared and UV photography.
Open a photo, swap and mix its channels, balance it, grade it and export it. Everything runs on your own device;
nothing is uploaded.

It works on a phone, a tablet or a desktop, and can be installed as an app (Install as an app, at the bottom of the
editor) so it opens full screen and keeps working offline.

## What it does

**Opening photos**
- JPEG, PNG, WebP, AVIF and TIFF, and RAW files from most cameras: CR2, CR3, NEF, ARW, SR2, DNG, ORF, RW2, PEF, RAF,
  SRW, NRW, 3FR, IIQ, MRW, KDC, DCR and X3F.
- RAW files are decoded from the sensor data in the browser by LibRaw compiled to WebAssembly, with a choice of
  AMaZE or RCD demosaicing (Markesteijn for Fuji X-Trans). A quick-preview mode uses the camera's embedded JPEG instead.
- Optional wider-gamut swap using the camera's own colour data, and rebuilding of clipped highlights from the colours
  around them.

**Trichrome:** stack three real shots into one, each feeding one colour, from the home page ("› stack three shots").
Recipes for red Aerochrome (an infrared, a red-filter and a green-filter shot rebuilt as colour infrared film), classic
RGB filter trichrome, three infrared bands, and plain shots with no filters. The shots are lined up automatically on the
parts that did not move (shift and small rotation, with a hand nudge), balanced, and opened in the editor as a 16-bit
TIFF. Code: `src/trichrome.js`.

**Sharing.** Under Export Image, *Share* hands a full-quality JPEG to the phone's share sheet (Instagram, Facebook,
WhatsApp...) with the Web Share API, and saves the file where a browser cannot share files. *Before | after* puts the
original and the edit in one picture (side by side for an upright photo, stacked for a wide one). *Look link* packs the
current look (the same things a saved preset keeps) into `#look=` on the page address, deflated and base64url-encoded;
opening it saves the look to My presets and applies it to the next photo. Code: `src/share.js`.

**Editing**, in five tabs:
- **Looks:** channel swaps (R↔B, G↔B, R↔G, cyclic rotations), a channel mix grid with offsets, UV and IR presets,
  film stocks and recipes (including Fedia's Triple Band Aerochrome), your own saved presets, NDVI and NGB index views,
  and a readout of which source channel carries your signal.
- **Light:** exposure, brightness, contrast, highlights and shadows, black and white point, a tone curve (RGB and per
  channel) and up to four local adjustments (linear, radial, luminosity or colour masks).
- **Colour:** targeted colour fixes before the swap, white balance before and after the swap (grey pickers and Auto
  tone), hue, saturation and vibrance, colour by band, calibration, swap working space and .cube LUTs.
- **Detail:** hotspot removal, RAW noise reduction, sharpening, clarity and dehaze, tone mapping and colour fringing.
- **Export:** crop, 16-bit TIFF, PNG or JPEG at working or full size, optional ProPhoto RGB, a .cube LUT of your look,
  and batch processing of many files into one .zip.

Undo and redo, before/after comparison, a histogram and RGB parade with clipping and print-gamut warnings, and six
languages (English, Spanish, French, German, Japanese, Chinese).

**[Filter database](https://irlab.uk/filters.html):** 500+ filters (Schott, B+W, Hoya, Wratten and more), most with
digitised manufacturer transmission curves. Stack them to see the combined transmission, check for IR leaks, and
export a report.

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
`tools/thorlabs/`, see its README), the 85 Edmund Optics filters (`src-filters/edmund.js`, from `tools/edmund/`), list and search, export, the recipe finder, the chart, the data self-test, zoom and
stacking guidance, the spectral response), built into `filters.js`.

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
