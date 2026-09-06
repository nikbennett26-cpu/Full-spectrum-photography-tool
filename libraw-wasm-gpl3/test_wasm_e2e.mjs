import createLibRawGPL3 from './dist/libraw-gpl3-xtrans-test.js';
import fs from 'fs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('usage: node test_wasm_e2e.mjs <file.RAF>');
  process.exit(1);
}

const bytes = fs.readFileSync(filePath);
console.log('file size:', bytes.length, 'bytes');

const M = await createLibRawGPL3();
console.log('wasm module loaded OK');

const pIn = M._malloc(bytes.length);
M.HEAPU8.set(bytes, pIn);
const h = M._lr_open(pIn, bytes.length);
M._free(pIn);

if (!h) {
  console.error('lr_open failed');
  process.exit(1);
}
console.log('handle:', h);

const width = M._lr_width(h);
const height = M._lr_height(h);
console.log('width=%d height=%d', width, height);

const cfaP = M._malloc(16);
M._lr_cfa(h, cfaP);
const cfa = Array.from(M.HEAP32.subarray(cfaP >> 2, (cfaP >> 2) + 4));
M._free(cfaP);
console.log('cfa (filters sentinel in [0]):', cfa, '(9=X-Trans)');

const black = M._lr_black(h);
const white = M._lr_white(h);
console.log('black=%f white=%f', black, white);

const cmP = M._malloc(16);
M._lr_cam_mul(h, cmP);
const camMul = Array.from(M.HEAPF32.subarray(cmP >> 2, (cmP >> 2) + 4));
M._free(cmP);
console.log('cam_mul:', camMul);

const rcP = M._malloc(48);
M._lr_rgb_cam(h, rcP);
const rgbCam = Array.from(M.HEAPF32.subarray(rcP >> 2, (rcP >> 2) + 12));
M._free(rcP);
console.log('rgb_cam:', rgbCam);

const n = width * height;
const pR = M._malloc(n * 4), pG = M._malloc(n * 4), pB = M._malloc(n * 4);
const ok = M._lr_demosaic(h, 0, pR, pG, pB);
console.log('lr_demosaic returned:', ok);

if (ok) {
  const R = M.HEAPF32.subarray(pR >> 2, (pR >> 2) + n);
  const G = M.HEAPF32.subarray(pG >> 2, (pG >> 2) + n);
  const B = M.HEAPF32.subarray(pB >> 2, (pB >> 2) + n);

  const cy = Math.floor(height / 2), cx = Math.floor(width / 2);
  const cidx = cy * width + cx;
  console.log(`centre pixel (row=${cy}, col=${cx}): R=${R[cidx].toFixed(1)} G=${G[cidx].toFixed(1)} B=${B[cidx].toFixed(1)}`);

  let nanCount = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(R[i]) || Number.isNaN(G[i]) || Number.isNaN(B[i])) nanCount++;
  }
  console.log(`NaN pixels: ${nanCount} (of ${n} total)`);
}

M._free(pR); M._free(pG); M._free(pB);
M._lr_free(h);
console.log('freed handle OK');
