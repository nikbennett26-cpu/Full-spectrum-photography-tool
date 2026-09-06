import { decodeAndDemosaic } from './glue/worker-core.mjs';
import fs from 'fs';

const filePath = process.argv[2];
const bytes = fs.readFileSync(filePath);

const { meta, R, G, B } = await decodeAndDemosaic(bytes, 'amaze');
console.log('meta:', meta);

const cy = Math.floor(meta.height / 2), cx = Math.floor(meta.width / 2);
const cidx = cy * meta.width + cx;
console.log(`centre pixel: R=${R[cidx].toFixed(1)} G=${G[cidx].toFixed(1)} B=${B[cidx].toFixed(1)}`);

let zeroCount = 0;
for (let i = 0; i < R.length; i++) {
  if (R[i] === 0 && G[i] === 0 && B[i] === 0) zeroCount++;
}
console.log(`all-zero pixels: ${zeroCount} / ${R.length}`);
