// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phil Warren
//
// Shared decode+demosaic handler. This is the SAME code path the Web Worker
// runs, factored out so it can be exercised directly from Node (see
// worker-test.mjs) without a browser Worker environment.

import { decode } from './libraw-gpl3.mjs';

// Decode a RAW file (LibRaw unpack) and demosaic it to planar linear RGB.
//
// `bytes` may be a Uint8Array or an ArrayBuffer. Returns:
//   { meta, R, G, B }
// where meta is a small JSON-cloneable descriptor and R/G/B are Float32Array
// planes (their .buffer members are transferable back to the main thread).
export async function decodeAndDemosaic(bytes, qual = 'amaze') {
  const u8 = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer || bytes);
  const dec = await decode(u8);
  try {
    const { R, G, B } = dec.demosaic(qual);
    const meta = {
      width: dec.width,
      height: dec.height,
      cfa: Array.from(dec.cfa),
      black: dec.black,
      white: dec.white,
      camMul: Array.from(dec.camMul),
      rgbCam: Array.from(dec.rgbCam),
      qual,
    };
    return { meta, R, G, B };
  } finally {
    dec.free();
  }
}
