// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phil Warren
//
// Thin JS wrapper around the Emscripten module. Exposes:
//   demosaicRaw(mosaic, w, h, cfa, {black, white, qual}) -> {R,G,B}
//   decode(bytes) -> { width,height,cfa,black,white,camMul,rgbCam, mosaic() }
//   demosaic(dec, qual) -> {R,G,B}
// LibRaw-backed methods are present only in a "full" build.
import createLibRawGPL3 from '../dist/libraw-gpl3.js';

let modP = null;
export function init(opts = {}) {
  if (!modP) modP = createLibRawGPL3(opts);
  return modP;
}

const QUAL = { bilinear: 0, amaze: 1, lmmse: 2, dcb: 3, dht: 4, rcd: 5, igv: 6, ahd: 7 };

function toQual(q) {
  if (typeof q === 'number') return q;
  return QUAL[q] ?? 0;
}

// Pure demosaic over a Uint16Array mosaic. Returns planar Float32Arrays.
export async function demosaicRaw(mosaic, w, h, cfa, { black = 0, white = 65535, qual = 'bilinear' } = {}) {
  const M = await init();
  const n = w * h;
  const mBytes = n * 2, fBytes = n * 4;
  const pM = M._malloc(mBytes);
  const pR = M._malloc(fBytes), pG = M._malloc(fBytes), pB = M._malloc(fBytes);
  try {
    M.HEAPU16.set(mosaic, pM >> 1);
    M._dm_demosaic_raw(pM, w, h, cfa[0], cfa[1], cfa[2], cfa[3],
                       black, white, toQual(qual), pR, pG, pB);
    const R = M.HEAPF32.slice(pR >> 2, (pR >> 2) + n);
    const G = M.HEAPF32.slice(pG >> 2, (pG >> 2) + n);
    const B = M.HEAPF32.slice(pB >> 2, (pB >> 2) + n);
    return { R, G, B, width: w, height: h };
  } finally {
    M._free(pM); M._free(pR); M._free(pG); M._free(pB);
  }
}

// LibRaw-backed decode (full build only).
export async function decode(bytes) {
  const M = await init();
  if (!M._lr_open) throw new Error('this is a core build (no LibRaw); rebuild with MODE=full');
  const pIn = M._malloc(bytes.length);
  M.HEAPU8.set(bytes, pIn);
  const h = M._lr_open(pIn, bytes.length);
  M._free(pIn);
  if (!h) throw new Error('LibRaw failed to open/unpack this file');

  const width = M._lr_width(h), height = M._lr_height(h);
  const rd = (fn, len, heap, shift) => {
    const p = M._malloc(len * (shift === 2 ? 4 : 4));
    fn(h, p);
    const out = M[heap].slice(p >> shift, (p >> shift) + len);
    M._free(p);
    return out;
  };
  const cfaP = M._malloc(16); M._lr_cfa(h, cfaP);
  const cfa = Array.from(M.HEAP32.subarray(cfaP >> 2, (cfaP >> 2) + 4)); M._free(cfaP);
  const camMul = rd(M._lr_cam_mul, 4, 'HEAPF32', 2);
  const rgbCam = rd(M._lr_rgb_cam, 12, 'HEAPF32', 2);

  return {
    handle: h, width, height, cfa,
    black: M._lr_black(h), white: M._lr_white(h),
    camMul, rgbCam,
    demosaic(qual = 'amaze') {
      const n = width * height;
      const pR = M._malloc(n * 4), pG = M._malloc(n * 4), pB = M._malloc(n * 4);
      M._lr_demosaic(h, toQual(qual), pR, pG, pB);
      const R = M.HEAPF32.slice(pR >> 2, (pR >> 2) + n);
      const G = M.HEAPF32.slice(pG >> 2, (pG >> 2) + n);
      const B = M.HEAPF32.slice(pB >> 2, (pB >> 2) + n);
      M._free(pR); M._free(pG); M._free(pB);
      return { R, G, B, width, height };
    },
    free() { M._lr_free(h); },
  };
}
