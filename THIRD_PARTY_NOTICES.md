Third-party notices — irlab.uk

This tool is licensed AGPL-3.0-or-later (see LICENSE.md) for the original
code in this repository. The RAW sensor decoder (`libraw-wasm-gpl3`, lazy-
loaded only when a RAW file is decoded with the "decode the real sensor
data" option) is a separate, combined work that incorporates the following
third-party components, each retaining its own copyright and licence.

---

## LibRaw

Used for RAW parsing, `unpack()`, and metadata (CFA pattern, black/white
levels, `cam_mul`, `rgb_cam`, crop geometry). Its camera colour-matrix table
(`adobe_coeff` in `src/tables/colordata.cpp`) is also copied as data into
`src/wbk-table.js` by `tools/gen_wbk_table.py`, to show RAW white balance in
Kelvin; same licence.

- Copyright: (C) Alex Tutubalin / Iliah Borg / LibRaw LLC; includes
  dcraw-derived code (C) Dave Coffin, and DCB demosaic (C) Jacek Gozdz (BSD).
- Licence: LGPL-2.1 or CDDL-1.0 (dual — LibRaw's choice). LGPL-2.1 is used
  here, and is compatible with the GPL-3 combined work below.
- Upstream: https://github.com/LibRaw/LibRaw
- Version: 0.21.4

## RawTherapee (AMaZE, LMMSE, RCD, IGV, AHD demosaic)

Five demosaic (colour-reconstruction) algorithms, adapted from RawTherapee's
`rtengine` to a standalone interface. The interpolation numerics are
RawTherapee's own, unmodified; only the surrounding engine glue (progress
callbacks, timing instrumentation, colour-management LUTs) was swapped for
minimal standalone equivalents.

- AMaZE (Aliasing Minimization and Zipper Elimination) — (C) Emil J. Martinec,
  optimised by Ingo Weyrich.
- LMMSE — (C) Gabor Horvath.
- RCD (Ratio Corrected Demosaicing) — (C) Luis Sanz Rodriguez, tiled by Ingo
  Weyrich and Hanno Schwalm.
- IGV (Integrated Gaussian Vector on Colour Differences) — (C) Luis Sanz
  Rodriguez, RawTherapee adaptation by Jacques Desmis, SSE version by Ingo
  Weyrich.
- AHD (Adaptive Homogeneity-Directed) — original method (C) Keigo Hirakawa
  & Thomas W. Parks, RawTherapee implementation by the RawTherapee
  development team.
- White balance (build 197, `src/rt-wb.js`) — Temperature/Green to
  multipliers and back (`temp2mulxyz`, `temp2mul`, `mul2temp`), the blackbody
  and CIE daylight spectra, the 2° observer table (`rtengine/colortemp.cc`)
  and `sRGBd65_xyz` (`rtengine/iccmatrices.h`), ported to JavaScript; the
  camera step follows `RawImageSource::getImage`. Colour temperature code
  (C) Jacques Desmis and the RawTherapee development team.
- Licence: GPL-3.0-or-later.
- Upstream: https://github.com/Beep6581/RawTherapee
- Version: 5.11

## darktable (AMaZE and RCD demosaic, as used by the current RAW decoder)

The Bayer demosaics the WASM decoder runs today (`libraw-wasm-gpl3/src/amaze/amaze_demosaic_port.cc` and
`rcd_demosaic_port.cc`) are taken from darktable's copies of these algorithms, which need no glib/glibmm, with
only the surrounding glue changed for a standalone build.

- AMaZE — (C) Emil J. Martinec, optimised by Ingo Weyrich (RawTherapee), as carried in darktable's
  `src/iop/demosaicing/amaze.cc`.
- RCD — (C) Luis Sanz Rodriguez, tiled by Ingo Weyrich, optimised by Hanno Schwalm, from darktable's
  `src/iop/demosaicing/rcd.c`.
- Licence: GPL-3.0-or-later.
- Upstream: https://github.com/darktable-org/darktable

The same two files, unchanged, are also built on their own into `libraw-wasm-gpl3/dist/demosaic-only.wasm`
(`libraw-wasm-gpl3/src/demosaic_only.cc`, `build_demosaic_only.sh`) for the white balance before demosaic (build 256),
under the same licence.

## darktable (healing, as used by Dust removal in the editor)

`src/dust.js` ports the healing solver from darktable's `src/common/heal.c` (red-black Gauss-Seidel with successive
over-relaxation; same over-relaxation factor and convergence test), (C) 2017-2024 darktable developers, after
T. Georgiev, "Photoshop Healing Brush: a Tool for Seamless Cloning". The choice between heal and clone follows the two
modes of darktable's retouch module. The automatic source search and the rest of the tool are irlab's own.

- Licence: GPL-3.0-or-later.
- Upstream: https://github.com/darktable-org/darktable

## LightCraft (edge-aware base for Highlights and Shadows, build 222; Find dust, build 223; Dehaze, build 224)

`src/tone-base.js` and the base-driven path in `applyToneRegions` (`src/shaders.js`) follow the way LightCraft
(`crates/pipeline/src/local.rs` and `finish.rs`, (C) 2026 ArtCraft Team and the LightCraft contributors) drives its
Highlights and Shadows: a smooth, edge-stopping base layer of log2 luminance (self-guided filter, He, Sun and Tang, 2010;
radius about 1.5% of the long edge, epsilon 0.35 EV^2) decides how much of the tone curve a region gets, and each pixel keeps
its own ratio to the base. The constants come from LightCraft; the code is a fresh implementation in JavaScript and GLSL
and is irlab's own. `dustDetectPixels` in `src/dust.js` (the Find dust button) follows LightCraft's dust finder
(`crates/pipeline/src/dust.rs`): darker than a blurred copy of its surroundings and than three times the local texture,
grouped into small, roughly round blobs. Again a fresh implementation with the same method and thresholds. LightCraft is licensed MIT OR Apache-2.0, both compatible with this app's AGPL-3.0.

## PhotoCraft (haze map for Dehaze, build 224)

`dehazeFromProxy` in `src/tone-base.js` follows the way PhotoCraft's Camera Raw filter does Dehaze
(`crates/algo/src/camera_raw.rs`, `dehaze`, (C) 2026 ArtCraft Team and the PhotoCraft contributors): the dark channel prior of
He, Sun and Tang (CVPR 2009) measured against an atmospheric light taken from the haziest 0.1% of the picture, the dark
channel opened (a maximum filter after the minimum) so a dark object leaves no bright halo in the sky beside it, and the
transmission refined with a guided filter on luminance (He, Sun and Tang, ECCV 2010). The code is a fresh implementation in
JavaScript; the method and constants are PhotoCraft's. PhotoCraft is licensed MIT OR Apache-2.0, both compatible with
this app's AGPL-3.0.

- Upstream: https://github.com/storytold/photocraft

- Upstream: https://github.com/storytold/lightcraft

## ART (hot pixels and line noise, build 225)

`src/raw-clean.js` takes its approach from ART (Adaptive Raw Therapee, GPL-3.0-or-later, https://github.com/artraweditor/ART):
the bad-pixel and impulse-noise filters (`src/engine/badpixels.cc`, `impulse_denoise.cc`) and the CFA line-noise filter
(`cfa_linedn_RT.cc`, by Emil Martinec). Those work on the sensor mosaic; this is a fresh implementation in JavaScript on the
three demosaiced planes, because the decoder hands the page planes, not the mosaic. ART is GPL-3.0-or-later, compatible with
this app's AGPL-3.0.

**Deconvolution (build 227).** The RAW deconvolution sharpening and its automatic blur radius follow ART's approach
(`src/engine/deconvautoradius.cc`, by Ingo Weyrich: the steepest edge between neighbouring green samples limits the blur). The
code here is a fresh JavaScript implementation of Richardson-Lucy on the demosaiced planes.

## Licence-compatibility summary

| Component    | Licence          | Compatible with the AGPL-3.0 whole app |
|--------------|------------------|-----------------------------------------|
| This repo    | AGPL-3.0-or-later| yes (defines it)                        |
| RawTherapee  | GPL-3.0-or-later | yes                                     |
| LibRaw       | LGPL-2.1 / CDDL  | yes (LGPL-2.1 -> AGPL-3.0)              |
| DCB (LibRaw) | BSD              | yes                                     |
| DHT (LibRaw) | LGPL             | yes                                     |
| LightCraft   | MIT OR Apache-2.0| yes                                     |
| PhotoCraft   | MIT OR Apache-2.0| yes                                     |
| ART          | GPL-3.0-or-later | yes                                     |

Because the RAW decoder links GPL-3 RawTherapee code, the combined decoder
artifact — and this app, since it loads and uses that artifact — is GPL-3
at minimum where that component is involved; AGPL-3.0 (this repo's own
licence) is a superset of those obligations for a tool run over a network,
so no separate relicensing was needed to accommodate it.

Corresponding source for the RAW decoder (LibRaw + RawTherapee ports, build
scripts, and this tool's own adapter/glue code) is the `libraw-wasm-gpl3`
repository, distributed alongside this tool's own source per GPL-3 §6 /
AGPL-3.0 §13.


## Barlow Condensed (logo lettering)

The "IR" in the irlab logo and icons is drawn from the outlines of Barlow Condensed Bold by Jeremy Tribby,
licensed under the SIL Open Font License 1.1 (https://openfontlicense.org). The font itself is not shipped.

## Filter transmission data (filters.html)

- **CheeseCube312, Filter-Plotter-Data** (MIT License, Copyright (c) 2025 CheeseCube) —
  https://github.com/CheeseCube312/Filter-Plotter-Data, used at commit 6c8ff04c18ebaee137a49ca09b89065c7aaba8ab.
  Digitised transmission curves for Lee Filters, MidOpt, Tangsinuo, Hoya and Kolari products; the file behind each
  curve is linked from that filter's card and from `src-filters/provenance.js`.
- **SCHOTT AG** — internal transmittance tables and reflection factors for SCHOTT optical filter glass, from
  SCHOTT's product pages (retrieved 2026-10-17), archived in `tools/schott/data/tables.txt`. Factual technical data;
  SCHOTT does not endorse this tool.
- **Thorlabs** and **Edmund Optics** — published product transmission data (see `tools/thorlabs/` and `tools/edmund/`).

Other manufacturer and third-party sources are named on each filter's card and in the Sources list on the page.

## Camera sensor response (editor, "Predict from your filters")

- **JMC Scientific Consulting Ltd** (Dr Jonathan Crowther), credited as the author asked. **Crowther, J. (2022).** Monochrome Camera Conversion: Effect on Sensitivity for Multispectral Imaging
  (Ultraviolet, Visible, and Infrared). *J. Imaging* 8, 54. https://doi.org/10.3390/jimaging8030054 —
  licensed CC BY 4.0. The Sony A7III multispectral channel responses (Figure 1f, 300-800nm) were traced from the
  published figure into `tools/sensors/crowther2022_a7iii.json`; the extension past 800nm is irlab's own model
  (see `tools/editor_filters.mjs`), not the author's data.

## Converted camera sensor responses (editor, build 249)

- **LDP LLC (MaxMax.com)**, "Spectral Response" (historical page, last modified 18 June 2015): monochromator-measured
  RGB response of converted Canon 40D, Nikon D300, Nikon D200 and Nikon D700 bodies, 375-1000nm, traced from the
  published charts into `tools/sensors/maxmax_spectral_response.json` (which records the method and caveats).
- **SurfLabX for IRreCams**, "Limit of infrared sensitivity for different camera sensors" (irrecams.de, 4 November
  2023): the fall-off of a full-spectrum Sony A7R III from 1000 to 1100nm, read off the published graph, used to extend
  the MaxMax curves past 1000nm.
- **Pedro J. Aphalo**, "Camera spectral response: Full-spectrum Olympus E-M1" (photo-spectrum.info, 2024, CC BY-SA 4.0):
  cited for its finding that a converted camera's three channels respond equally from about 840nm, used to flag the
  MaxMax curves; none of its data is shipped.

## Film fit (editor, "Digital Aerochrome (advanced)", build 240)

- **Ektachrome Infrared Aero 8443 layer data**: NASA Interagency Report 146, "Predicting the Relative Dye Layer
  Densities of Color Infrared Transparencies", Figure 2, constructed from Fritz, N. L. (1967), Photogrammetric
  Engineering 33(10). A US Government work; the per-band fractions are reproduced as factual data in `src/film-fit.js`.
- **Surface reflectance spectra** (build 246): USGS Spectral Library Version 7 — Kokaly, R.F., Clark, R.N., Swayze,
  G.A., Livo, K.E., Hoefen, T.M., Pearson, N.C., Wise, R.A., Benzel, W.M., Lowers, H.A., Driscoll, R.L., and Klein, A.J.,
  2017, USGS Spectral Library Version 7 Data: U.S. Geological Survey data release, https://doi.org/10.5066/F7RR1WDJ.
  Public domain (U.S. Government work). Used: fresh oak leaf, green lawn grass (GDS91), lodgepole pine needles, yellow
  aspen leaf, golden dry grass (GDS480), old asphalt road (GDS376), concrete road (GDS375), red building brick (GDS353),
  open-ocean sea water (SW2), melting snow (mSnw01a), dry marsh sediment as bare earth (DWV3-0511), cadmium red
  (GDS778) and Hansa yellow (GDS785). **Modifications**, as the USGS asks to be
  described: averaged into 10nm steps from 300 to 1100nm, the first channel held below each instrument's range, and
  clipped to 0-1. The USGS has not reviewed or endorsed irlab or this use. The clear-sky and grey-card spectra are irlab's own models.
- **Aerochrome III 1443 layer sensitivities** (build 247): read from the vector spectral-sensitivity chart in Eastman
  Kodak Company, *KODAK AEROCHROME III Infrared Film 1443*, publication AS-77 (TI2562, minor revision 11-05, ©2005),
  against the chart's own gridlines. Factual data from a published graph; the values are in `src/film-fit.js`. (Build
  245 had traced a screenshot of the same chart posted by Andrea B. on UltravioletPhotography.com.)
- **Film dye model** (build 250): characteristic curves (density against log exposure, Process AR-5, Status A) and
  spectral dye densities read from the vector charts in Eastman Kodak Company, *KODAK AEROCHROME III Infrared Film
  1443* (AS-77, TI2562, 11-05, ©2005), and characteristic and spectral sensitivity curves from *KODAK EKTACHROME
  Professional Infrared EIR Film* (TI-2323, ©2005). Factual data from published graphs; values in `src/film-fit.js`.
  CIE 1931 2-degree colour-matching functions and the CIE D50 illuminant at 10nm, generated with the colour-science
  Python package (BSD 3-Clause; the CIE data are standard tables).
- **Light** (build 248): midday sun is the filter database's AM1.5 global spectrum. Open shade, low sun and the
  blue-sky swatch are derived from the ASTM G173-03 reference spectra (extraterrestrial, global tilt and direct +
  circumsolar, from SMARTS v2.9.2) in the table published by NREL (National Renewable Energy Laboratory); only those
  published numbers are used, nothing from the ASTM standard's text. Open shade = global minus direct; low sun = the
  direct beam scaled from air mass 1.5 to 5 by its own transmission, plus half the sky light; blue sky = light scattered
  out of the beam, power-law fitted over gas-free windows. Overcast remains irlab's own model.
- The method follows Nick Spiker's approach to a digital Aerochrome (fitting a camera to the film's layer
  sensitivities), described on his former blog; no code or data of his is used.
