import createLibRawGPL3 from './dist/libraw-gpl3-xtrans.js';
import fs from 'fs';

const filePath = process.argv[2];
const bytes = fs.readFileSync(filePath);

const M = await createLibRawGPL3();

function decodeWith(qual) {
  const pIn = M._malloc(bytes.length);
  M.HEAPU8.set(bytes, pIn);
  const h = M._lr_open(pIn, bytes.length);
  M._free(pIn);
  if (!h) throw new Error('lr_open failed');

  const width = M._lr_width(h), height = M._lr_height(h);
  const n = width * height;
  const pR = M._malloc(n * 4), pG = M._malloc(n * 4), pB = M._malloc(n * 4);
  const ok = M._lr_demosaic(h, qual, pR, pG, pB);
  const R = M.HEAPF32.slice(pR >> 2, (pR >> 2) + n);
  const G = M.HEAPF32.slice(pG >> 2, (pG >> 2) + n);
  const B = M.HEAPF32.slice(pB >> 2, (pB >> 2) + n);
  M._free(pR); M._free(pG); M._free(pB);
  M._lr_free(h);
  if (!ok) throw new Error(`lr_demosaic(qual=${qual}) failed`);
  return { R, G, B, width, height, n };
}

const fast = decodeWith(0);
const mk1  = decodeWith(1);

console.log('size:', fast.width, 'x', fast.height);

let nanFast = 0, nanMk1 = 0, sumAbsDiff = 0, maxAbsDiff = 0, identicalCount = 0;
for (let i = 0; i < fast.n; i++) {
  const fr = fast.R[i], fg = fast.G[i], fb = fast.B[i];
  const mr = mk1.R[i], mg = mk1.G[i], mb = mk1.B[i];
  if (fr !== fr || fg !== fg || fb !== fb) nanFast++;
  if (mr !== mr || mg !== mg || mb !== mb) nanMk1++;
  const d = Math.abs(fr - mr) + Math.abs(fg - mg) + Math.abs(fb - mb);
  sumAbsDiff += d;
  if (d > maxAbsDiff) maxAbsDiff = d;
  if (d === 0) identicalCount++;
}

console.log('fast: NaN =', nanFast);
console.log('markesteijn1: NaN =', nanMk1);
console.log('mean abs diff per pixel (sum of |R|+|G|+|B| diffs):', (sumAbsDiff / fast.n).toFixed(4));
console.log('max abs diff at any single pixel:', maxAbsDiff.toFixed(4));
console.log('pixels with ZERO difference between the two algorithms:', identicalCount, '/', fast.n,
            '(' + (100 * identicalCount / fast.n).toFixed(2) + '%)');

const cy = Math.floor(fast.height / 2), cx = Math.floor(fast.width / 2);
const ci = cy * fast.width + cx;
console.log(`\ncentre pixel (${cy},${cx}):`);
console.log('  fast:        R=' + fast.R[ci].toFixed(4), 'G=' + fast.G[ci].toFixed(4), 'B=' + fast.B[ci].toFixed(4));
console.log('  markesteijn: R=' + mk1.R[ci].toFixed(4), 'G=' + mk1.G[ci].toFixed(4), 'B=' + mk1.B[ci].toFixed(4));

const ty = Math.floor(fast.height * 0.15), tx = Math.floor(fast.width * 0.25);
const ti = ty * fast.width + tx;
console.log(`\nsample pixel in a detail-heavy area (${ty},${tx}):`);
console.log('  fast:        R=' + fast.R[ti].toFixed(4), 'G=' + fast.G[ti].toFixed(4), 'B=' + fast.B[ti].toFixed(4));
console.log('  markesteijn: R=' + mk1.R[ti].toFixed(4), 'G=' + mk1.G[ti].toFixed(4), 'B=' + mk1.B[ti].toFixed(4));
