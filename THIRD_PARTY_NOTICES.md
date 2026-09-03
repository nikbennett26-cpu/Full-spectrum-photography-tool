Third-party notices — irlab.uk

This tool is licensed AGPL-3.0-or-later (see LICENSE.md) for the original
code in this repository. The RAW sensor decoder (`libraw-wasm-gpl3`, lazy-
loaded only when a RAW file is decoded with the "decode the real sensor
data" option) is a separate, combined work that incorporates the following
third-party components, each retaining its own copyright and licence.

---

## LibRaw

Used for RAW parsing, `unpack()`, and metadata (CFA pattern, black/white
levels, `cam_mul`, `rgb_cam`, crop geometry).

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
- Licence: GPL-3.0-or-later.
- Upstream: https://github.com/Beep6581/RawTherapee
- Version: 5.11

## Licence-compatibility summary

| Component    | Licence          | Compatible with the AGPL-3.0 whole app |
|--------------|------------------|-----------------------------------------|
| This repo    | AGPL-3.0-or-later| yes (defines it)                        |
| RawTherapee  | GPL-3.0-or-later | yes                                     |
| LibRaw       | LGPL-2.1 / CDDL  | yes (LGPL-2.1 -> AGPL-3.0)              |
| DCB (LibRaw) | BSD              | yes                                     |
| DHT (LibRaw) | LGPL             | yes                                     |

Because the RAW decoder links GPL-3 RawTherapee code, the combined decoder
artifact — and this app, since it loads and uses that artifact — is GPL-3
at minimum where that component is involved; AGPL-3.0 (this repo's own
licence) is a superset of those obligations for a tool run over a network,
so no separate relicensing was needed to accommodate it.

Corresponding source for the RAW decoder (LibRaw + RawTherapee ports, build
scripts, and this tool's own adapter/glue code) is the `libraw-wasm-gpl3`
repository, distributed alongside this tool's own source per GPL-3 §6 /
AGPL-3.0 §13.
