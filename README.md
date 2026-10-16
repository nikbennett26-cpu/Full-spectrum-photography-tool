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

**[Filter database](https://irlab.uk/filters.html):** 230+ filters (Schott, B+W, Hoya, Wratten and more), most with
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
| `src/selftest.js` | the built-in self-test and its stored baseline |
| `src/undo-buttons.js` | the undo and redo buttons |

**Edit `src/`, never `editor.js`.** `tools/build.py` joins the sources, in the order listed in it, into `editor.js`.
They are one script split for reading, not modules: they share one global scope, and as one file they run in one go,
so a function anywhere is available from the start. (Loaded as separate files, the browser could run a reopened
session or a tap between two of them and reach code that had not arrived yet; that broke the app in builds 130-131.)

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
