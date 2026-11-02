// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phil Warren
//
// Shared decode+demosaic handler. This is the SAME code path the Web Worker
// runs, factored out so it can be exercised directly from Node (see
// worker-test.mjs) without a browser Worker environment.

import { decode } from './libraw-gpl3.mjs';
import { balancedDemosaic } from './pre-wb.mjs';

// Decode a RAW file (LibRaw unpack) and demosaic it to planar linear RGB.
//
// `bytes` may be a Uint8Array or an ArrayBuffer. Returns:
//   { meta, R, G, B }
// where meta is a small JSON-cloneable descriptor and R/G/B are Float32Array
// planes (their .buffer members are transferable back to the main thread).
// opts.preWb (build 256): white-balance the mosaic before the demosaic (Bayer only; see pre-wb.mjs).
export async function decodeAndDemosaic(bytes, qual = 'amaze', opts = {}) {
  const u8 = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer || bytes);
  const dec = await decode(u8);
  let freed = false;
  try {
    const filters = dec.cfa[0] >>> 0;
    const preWb = !!(opts && opts.preWb) && !dec.isXTrans && filters !== 9 && filters !== 0 && dec.width >= 16 && dec.height >= 16;
    let { R, G, B } = dec.demosaic(preWb ? 'rcd' : qual);   // with preWb this pass only recovers the mosaic
    let preWbGains = null;
    if (preWb) {
      const w = dec.width, h = dec.height;
      dec.free(); freed = true;   // LibRaw's copy of the file is not needed for the second pass
      try {
        const r = await balancedDemosaic({ R, G, B }, w, h, filters, qual);
        R = r.R; G = r.G; B = r.B; preWbGains = r.gains;
      } catch (e) {
        /* Never lose the photo over this: if the second module cannot load (offline before it was ever cached)
           or runs out of memory, decode again the ordinary way. */
        console.warn('balance before demosaic failed, decoding without it: ' + ((e && e.message) || e));
        R = G = B = null;
        const dec2 = await decode(u8);
        try { ({ R, G, B } = dec2.demosaic(qual)); } finally { dec2.free(); }
      }
    }
    const meta = {
      width: dec.width,
      height: dec.height,
      cfa: Array.from(dec.cfa),
      black: dec.black,
      white: dec.white,
      flip: dec.flip || 0,
      camMul: Array.from(dec.camMul),
      rgbCam: Array.from(dec.rgbCam),
      qual,
      preWb: preWbGains,   // the gains used before demosaic (already divided back out), or null
    };
    return { meta, R, G, B };
  } finally {
    if (!freed) dec.free();
  }
}
