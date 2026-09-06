import { decode } from './glue/libraw-gpl3.mjs';
import fs from 'fs';

const filePath = process.argv[2];
const bytes = fs.readFileSync(filePath);
console.log('file size:', bytes.length);

const dec = await decode(bytes);
console.log('isXTrans:', !!dec.isXTrans);
console.log('width=%d height=%d', dec.width, dec.height);
console.log('black=%f white=%f', dec.black, dec.white);
console.log('camMul:', Array.from(dec.camMul));

const { R, G, B, width, height } = dec.demosaic();
const cy = Math.floor(height / 2), cx = Math.floor(width / 2);
const cidx = cy * width + cx;
console.log(`centre pixel: R=${R[cidx].toFixed(1)} G=${G[cidx].toFixed(1)} B=${B[cidx].toFixed(1)}`);

let nanCount = 0, zeroCount = 0;
for (let i = 0; i < R.length; i++) {
  if (Number.isNaN(R[i]) || Number.isNaN(G[i]) || Number.isNaN(B[i])) nanCount++;
  if (R[i] === 0 && G[i] === 0 && B[i] === 0) zeroCount++;
}
console.log(`NaN pixels: ${nanCount} / ${R.length}`);
console.log(`all-zero (R=G=B=0) pixels: ${zeroCount} / ${R.length}`);

dec.free();
console.log('done');
