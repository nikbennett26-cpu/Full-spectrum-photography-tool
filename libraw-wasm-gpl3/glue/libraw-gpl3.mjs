// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phil Warren
//
// Thin JS wrapper around the Emscripten module. Exposes:
//   demosaicRaw(mosaic, w, h, cfa, {black, white, qual}) -> {R,G,B}
//   decode(bytes) -> { width,height,cfa,black,white,camMul,rgbCam, mosaic() }
//   demosaic(dec, qual) -> {R,G,B}
// LibRaw-backed methods are present only in a "full" build.
//
// X-Trans routing note: the core build's own LibRaw-backed X-Trans
// demosaic (inside dist/libraw-gpl3.js) has a known bug — it reports
// success but silently returns all-zero pixel data. Rather than patch
// unrecoverable compiled code (its source isn't in this repo), X-Trans
// files are routed to a separately built, independently verified module
// (dist/libraw-gpl3-xtrans.js) instead. Every other camera's decode path
// is completely unchanged below.
import createLibRawGPL3 from '../dist/libraw-gpl3.js';
import createLibRawGPL3XTrans from '../dist/libraw-gpl3-xtrans.js';

let modP = null;
export function init(opts = {}) {
  if (!modP) modP = createLibRawGPL3(opts);
  return modP;
}

let modXTransP = null;
function initXTrans(opts = {}) {
  if (!modXTransP) modXTransP = createLibRawGPL3XTrans(opts);
  return modXTransP;
}

const QUAL = { bilinear: 0, amaze: 1, lmmse: 2, dcb: 3, dht: 4, rcd: 5, igv: 6, ahd: 7 };

function toQual(q) {
  if (typeof q === 'number') return q;
  return QUAL[q] ?? 0;
}

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

async function probeOpen(mod, bytes) {
  const pIn = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, pIn);
  const h = mod._lr_open(pIn, bytes.length);
  mod._free(pIn);
  if (!h) return null;
  const cfaP = mod._malloc(16);
  mod._lr_cfa(h, cfaP);
  const filters = mod.HEAP32[cfaP >> 2];
  mod._free(cfaP);
  return { handle: h, filters };
}

function readDecodeMetadata(mod, h, width, height) {
  const rd = (fn, len, heap, shift) => {
    const p = mod._malloc(len * 4);
    fn(h, p);
    const out = mod[heap].slice(p >> shift, (p >> shift) + len);
    mod._free(p);
    return out;
  };
  const cfaP = mod._malloc(16);
  mod._lr_cfa(h, cfaP);
  const cfa = Array.from(mod.HEAP32.subarray(cfaP >> 2, (cfaP >> 2) + 4));
  mod._free(cfaP);
  const camMul = rd(mod._lr_cam_mul, 4, 'HEAPF32', 2);
  const rgbCam = rd(mod._lr_rgb_cam, 12, 'HEAPF32', 2);
  return { cfa, camMul, rgbCam, black: mod._lr_black(h), white: mod._lr_white(h) };
}

export async function decode(bytes) {
  const M = await init();
  if (!M._lr_open) throw new Error('this is a core build (no LibRaw); rebuild with MODE=full');

  const MX = await initXTrans();
  const probe = await probeOpen(MX, bytes);

  if (probe && probe.filters === 9) {
    const hx = probe.handle;
    const width = MX._lr_width(hx), height = MX._lr_height(hx);
    const meta = readDecodeMetadata(MX, hx, width, height);

    return {
      handle: hx, width, height, cfa: meta.cfa,
      black: meta.black, white: meta.white,
      camMul: meta.camMul, rgbCam: meta.rgbCam,
      isXTrans: true,
      demosaic(qual = 'amaze') {
        const n = width * height;
        const pR = MX._malloc(n * 4), pG = MX._malloc(n * 4), pB = MX._malloc(n * 4);
        const ok = MX._lr_demosaic(hx, toQual(qual), pR, pG, pB);
        const R = MX.HEAPF32.slice(pR >> 2, (pR >> 2) + n);
        const G = MX.HEAPF32.slice(pG >> 2, (pG >> 2) + n);
        const B = MX.HEAPF32.slice(pB >> 2, (pB >> 2) + n);
        MX._free(pR); MX._free(pG); MX._free(pB);
        if (!ok) throw new Error('X-Trans demosaic failed unexpectedly');
        return { R, G, B, width, height };
      },
      free() { MX._lr_free(hx); },
    };
  }

  if (probe) MX._lr_free(probe.handle);

  const pIn = M._malloc(bytes.length);
  M.HEAPU8.set(bytes, pIn);
  const h = M._lr_open(pIn, bytes.length);
  M._free(pIn);
  if (!h) throw new Error('LibRaw failed to open/unpack this file');

  const width = M._lr_width(h), height = M._lr_height(h);
  const meta = readDecodeMetadata(M, h, width, height);

  return {
    handle: h, width, height, cfa: meta.cfa,
    black: meta.black, white: meta.white,
    camMul: meta.camMul, rgbCam: meta.rgbCam,
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
