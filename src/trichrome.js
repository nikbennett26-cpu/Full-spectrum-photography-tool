/* ---------- Trichrome: stack three real shots into one (build 137) ----------
   Three photos of the same scene, each feeding one colour of the result. Two kinds of effect come out of it:

   - Spectral: each shot sees a different band. The "Red Aerochrome" recipe is colour infrared film rebuilt layer
     by layer: the infrared shot becomes red, the red-filter shot green and the green-filter shot blue, so foliage
     (bright in IR) turns red and skies go deep blue.
   - Time: the shots are moments apart, so anything that moved (clouds, water, leaves) splits into colour while
     still things stay true. Every recipe has this; "No filters" is only this.

   Steps: load the three shots, line them up, balance them, then open the result in the editor as a 16-bit TIFF,
   where every other tool works on it as usual.

   Shots are held as linear-light RGB Float32 at the editor's working size (TRI_MAX). A RAW keeps its
   camera-native channels from the sensor, before any white balance, which is what channel separation wants. A
   JPEG/PNG/TIFF is decoded and its sRGB encoding undone.

   Lining up works on edges (gradient of log brightness), which line up across very different filters where the
   brightness itself does not: foliage is white in IR and dark through a green filter, but its outline is in the
   same place. A coarse search over the whole frame finds the rough shift, then a grid of tiles is matched around
   it, and a straight-line fit through the tile shifts gives a shift plus a small rotation. Tiles that disagree
   with the fit (clouds, water, anything that moved between shots) are dropped and the fit redone, so the result
   follows the still parts of the scene. */

const TRI_MAX = WORKING_MAX_DIM;   // the result's size: the editor's own working size
const TRI_PREV = 900;              // preview and line-up analysis size
const TRI_RECIPES = {
  aero: {
    note: 'Colour infrared film, one layer per shot: infrared becomes red, red becomes green, green becomes blue. Foliage turns red, skies deep blue.',
    slots: [
      { label: 'Infrared shot → red', hint: '720nm or deeper', use: 'lum' },
      { label: 'Red-filter shot → green', hint: 'R25 or 590nm, with an IR-cut filter', use: 'r' },
      { label: 'Green-filter shot → blue', hint: 'G58 or X1, with an IR-cut filter', use: 'g' },
    ],
  },
  rgb: {
    note: 'Classic trichrome: red, green and blue filter shots. Still things come out in natural colour; anything that moved between shots splits into colour.',
    slots: [
      { label: 'Red-filter shot → red', hint: 'R25', use: 'r' },
      { label: 'Green-filter shot → green', hint: 'G58', use: 'g' },
      { label: 'Blue-filter shot → blue', hint: 'B47', use: 'b' },
    ],
  },
  irbands: {
    note: 'Three infrared bands as three colours, longest wavelength as red. Shows how materials differ across the infrared.',
    slots: [
      { label: '950nm shot → red', hint: '950nm long-pass', use: 'lum' },
      { label: '850nm shot → green', hint: '850nm long-pass', use: 'lum' },
      { label: '720nm shot → blue', hint: '720nm long-pass', use: 'lum' },
    ],
  },
  plain: {
    note: 'No filters needed: the red of the first shot, the green of the second and the blue of the third. Still things stay normal; moving things split into colour.',
    slots: [
      { label: 'Shot 1 → red', hint: 'no filter', use: 'r' },
      { label: 'Shot 2 → green', hint: 'no filter', use: 'g' },
      { label: 'Shot 3 → blue', hint: 'no filter', use: 'b' },
    ],
  },
};
const TRI_DOT = ['#e0452a', '#36b06a', '#2f7de1'];

const tri = {
  recipe: 'aero', step: 1, view: 'overlay', sel: 1, ignoreMoving: true,
  shots: [null, null, null], uses: ['lum', 'r', 'g'],
  xf: [{ dx: 0, dy: 0, rot: 0 }, { dx: 0, dy: 0, rot: 0 }, { dx: 0, dy: 0, rot: 0 }],
  aligned: false, gains: [1, 1, 1], picking: false, blinkTimer: null, blinkOn: false,
};

/* ---- decoding ---- */
function triBox(planes, w, h, maxDim) {
  // box-average three planes down so the long side fits maxDim (integer factor; at least 1)
  const k = Math.max(1, Math.ceil(Math.max(w, h) / maxDim));
  const ow = Math.floor(w / k), oh = Math.floor(h / k);
  const out = new Float32Array(ow * oh * 3), inv = 1 / (k * k);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < k; j++) {
        const row = (y * k + j) * w + x * k;
        for (let i = 0; i < k; i++) { const p = row + i; r += planes[0][p]; g += planes[1][p]; b += planes[2][p]; }
      }
      const o = (y * ow + x) * 3;
      out[o] = r * inv; out[o + 1] = g * inv; out[o + 2] = b * inv;
    }
  }
  return { data: out, w: ow, h: oh };
}
function triOrient(img, o) {
  if (!o || o === 1) return img;
  const { data, w, h } = img, swap = o >= 5 && o <= 8;
  const dw = swap ? h : w, dh = swap ? w : h, out = new Float32Array(dw * dh * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let nx, ny;
    switch (o) {
      case 2: nx = w - 1 - x; ny = y; break;
      case 3: nx = w - 1 - x; ny = h - 1 - y; break;
      case 4: nx = x; ny = h - 1 - y; break;
      case 5: nx = y; ny = x; break;
      case 6: nx = h - 1 - y; ny = x; break;
      case 7: nx = h - 1 - y; ny = w - 1 - x; break;
      case 8: nx = y; ny = w - 1 - x; break;
      default: nx = x; ny = y;
    }
    const s = (y * w + x) * 3, d = (ny * dw + nx) * 3;
    out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2];
  }
  return { data: out, w: dw, h: dh };
}
function triNormalise(img) {
  // scale so the bright end (99.7th percentile of the brightest channel, sampled) sits at 1
  const d = img.data, n = d.length / 3, step = Math.max(1, Math.floor(n / 40000)), v = [];
  for (let p = 0; p < n; p += step) v.push(Math.max(d[p * 3], d[p * 3 + 1], d[p * 3 + 2]));
  v.sort((a, b) => a - b);
  const top = v[Math.floor(v.length * 0.997)] || 1;
  const s = top > 1e-9 ? 1 / top : 1;
  for (let i = 0; i < d.length; i++) d[i] = Math.max(0, d[i] * s);
  return img;
}
async function triDecode(file) {
  const ext = (file.name.split('.').pop() || '').toUpperCase();
  const isRaw = RAW_EXT.includes(ext);
  if (isRaw && !($('cr2PreferPreview') && $('cr2PreferPreview').checked) && rawEngine.supported()) {
    /* rawEngine.demosaic() records its result as "the open photo". Put back whatever the editor had, so decoding
       a trichrome shot never changes the photo that is open there. */
    const keep = { lr: rawEngine.lastResult, lg: rawEngine.lastGen, nr: rawEngine.nrPrev, open: document.body.classList.contains('rawOpen') };
    let res;
    try { res = await rawEngine.demosaic(demosaicPref(), file); }
    finally {
      rawEngine.lastResult = keep.lr; rawEngine.lastGen = keep.lg; rawEngine.nrPrev = keep.nr;
      document.body.classList.toggle('rawOpen', keep.open);
    }
    const img = triOrient(triBox([res.R, res.G, res.B], res.width, res.height, TRI_MAX), rawFlipToExif(res && res.flip));
    img.raw = true;
    return triNormalise(img);
  }
  let cv;
  if (TIFF_EXT.includes(ext)) cv = await tiffToCanvas(await file.arrayBuffer());
  else {
    let blob = file;
    if (isRaw) { const f = await extractPreview(file); if (!f) throw new Error('no usable image in this RAW'); blob = f.blob; }
    const im = await batchDecode(blob);
    const k = Math.max(1, Math.max(im.naturalWidth, im.naturalHeight) / TRI_MAX);
    cv = document.createElement('canvas');
    cv.width = Math.round(im.naturalWidth / k); cv.height = Math.round(im.naturalHeight / k);
    cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
  }
  if (Math.max(cv.width, cv.height) > TRI_MAX) {
    const k = Math.max(cv.width, cv.height) / TRI_MAX, c2 = document.createElement('canvas');
    c2.width = Math.round(cv.width / k); c2.height = Math.round(cv.height / k);
    c2.getContext('2d').drawImage(cv, 0, 0, c2.width, c2.height); cv = c2;
  }
  const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const lut = new Float32Array(256); for (let i = 0; i < 256; i++) lut[i] = srgbToLinearF(i / 255);
  const n = cv.width * cv.height, data = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) { data[p * 3] = lut[px[p * 4]]; data[p * 3 + 1] = lut[px[p * 4 + 1]]; data[p * 3 + 2] = lut[px[p * 4 + 2]]; }
  return triNormalise({ data, w: cv.width, h: cv.height, raw: false });
}
function triPreviewOf(img) {
  const p = [new Float32Array(img.w * img.h), new Float32Array(img.w * img.h), new Float32Array(img.w * img.h)];
  for (let i = 0, n = img.w * img.h; i < n; i++) { p[0][i] = img.data[i * 3]; p[1][i] = img.data[i * 3 + 1]; p[2][i] = img.data[i * 3 + 2]; }
  return triBox(p, img.w, img.h, TRI_PREV);
}
// one plane out of an RGB buffer: a channel, or brightness
function triChannel(img, use) {
  const n = img.w * img.h, out = new Float32Array(n), d = img.data;
  if (use === 'r' || use === 'g' || use === 'b') {
    const c = use === 'r' ? 0 : use === 'g' ? 1 : 2;
    for (let i = 0; i < n; i++) out[i] = d[i * 3 + c];
  } else {
    // camera-native RAW channels have no defined luminance weights: an even mix, green counted twice as on the sensor
    const wr = img.raw ? 0.25 : 0.2126, wg = img.raw ? 0.5 : 0.7152, wb = img.raw ? 0.25 : 0.0722;
    for (let i = 0; i < n; i++) out[i] = wr * d[i * 3] + wg * d[i * 3 + 1] + wb * d[i * 3 + 2];
  }
  return out;
}

/* ---- lining up ---- */
function triEdges(plane, w, h) {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = Math.log(plane[i] + 0.01);
  const g = new Float32Array(w * h);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w];
    const m = Math.sqrt(gx * gx + gy * gy); g[i] = m; sum += m;
  }
  const mean = sum / (w * h) || 1;
  for (let i = 0; i < w * h; i++) g[i] /= mean;
  return g;
}
function triHalf(p, w, h) {
  const ow = w >> 1, oh = h >> 1, o = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const i = (2 * y) * w + 2 * x;
    o[y * ow + x] = 0.25 * (p[i] + p[i + 1] + p[i + w] + p[i + w + 1]);
  }
  return { p: o, w: ow, h: oh };
}
// normalised correlation of a window of A against B shifted by (sx, sy) (integers)
function triScore(A, B, w, h, x0, y0, x1, y1, sx, sy) {
  let sab = 0, saa = 0, sbb = 0, sa = 0, sb = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    const yb = y + sy; if (yb < 0 || yb >= h) continue;
    for (let x = x0; x < x1; x++) {
      const xb = x + sx; if (xb < 0 || xb >= w) continue;
      const a = A[y * w + x], b = B[yb * w + xb];
      sab += a * b; saa += a * a; sbb += b * b; sa += a; sb += b; n++;
    }
  }
  if (n < 16) return -1;
  const cov = sab - sa * sb / n, va = saa - sa * sa / n, vb = sbb - sb * sb / n;
  return va > 1e-9 && vb > 1e-9 ? cov / Math.sqrt(va * vb) : -1;
}
function triSearch(A, B, w, h, win, cx, cy, r) {
  let best = -2, bx = cx, by = cy;
  for (let sy = cy - r; sy <= cy + r; sy++) for (let sx = cx - r; sx <= cx + r; sx++) {
    const s = triScore(A, B, w, h, win[0], win[1], win[2], win[3], sx, sy);
    if (s > best) { best = s; bx = sx; by = sy; }
  }
  return { x: bx, y: by, s: best };
}
function triSubpix(A, B, w, h, win, bx, by) {
  const f = (sx, sy) => triScore(A, B, w, h, win[0], win[1], win[2], win[3], sx, sy);
  const c = f(bx, by), l = f(bx - 1, by), r = f(bx + 1, by), u = f(bx, by - 1), d = f(bx, by + 1);
  const px = (l - r) / (2 * (l - 2 * c + r) || 1), py = (u - d) / (2 * (u - 2 * c + d) || 1);
  return { x: bx + Math.max(-0.5, Math.min(0.5, isFinite(px) ? px : 0)), y: by + Math.max(-0.5, Math.min(0.5, isFinite(py) ? py : 0)) };
}
/* Transform of shot k relative to shot 0, in preview pixels: a point p of shot 0 is at
   R(rot)(p - c) + c + (dx, dy) in shot k. */
function triAlignPair(ref, mov, w, h, ignoreMoving) {
  // coarse: pyramid down to ~120px wide, brute force there, refine on the way up
  const pyrA = [{ p: ref, w, h }], pyrB = [{ p: mov, w, h }];
  while (pyrA[pyrA.length - 1].w > 140) { const a = pyrA[pyrA.length - 1], b = pyrB[pyrB.length - 1]; pyrA.push(triHalf(a.p, a.w, a.h)); pyrB.push(triHalf(b.p, b.w, b.h)); }
  let sx = 0, sy = 0;
  for (let L = pyrA.length - 1; L >= 0; L--) {
    const a = pyrA[L], b = pyrB[L], m = Math.round(Math.min(a.w, a.h) * 0.08);
    const win = [m, m, a.w - m, a.h - m];
    const r = L === pyrA.length - 1 ? Math.round(Math.min(a.w, a.h) * 0.12) : 2;
    const hit = triSearch(a.p, b.p, a.w, a.h, win, sx, sy, r);
    sx = hit.x; sy = hit.y;
    if (L > 0) { sx *= 2; sy *= 2; }
  }
  // fine: a grid of tiles around the coarse shift
  const nx = 6, ny = 5, tw = Math.floor(w / nx), th = Math.floor(h / ny), pts = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const win = [i * tw + 4, j * th + 4, (i + 1) * tw - 4, (j + 1) * th - 4];
    let tex = 0; for (let y = win[1]; y < win[3]; y += 2) for (let x = win[0]; x < win[2]; x += 2) tex += ref[y * w + x];
    tex /= ((win[2] - win[0]) * (win[3] - win[1]) / 4);
    if (tex < 0.35) continue;                       // flat (clear sky, blank wall): nothing to match on
    const hit = triSearch(ref, mov, w, h, win, sx, sy, 4);
    if (hit.s < 0.25) continue;
    const sp = triSubpix(ref, mov, w, h, win, hit.x, hit.y);
    pts.push({ px: (win[0] + win[2]) / 2, py: (win[1] + win[3]) / 2, sx: sp.x, sy: sp.y, wgt: hit.s });
  }
  const cx = w / 2, cy = h / 2;
  if (pts.length < 4) return { dx: sx, dy: sy, rot: 0, used: pts.length, tiles: pts.length };
  // least squares for (tx, ty, rot) with small-angle rotation; refit after dropping tiles that disagree
  let use = pts.slice(), fit = null;
  for (let it = 0; it < (ignoreMoving ? 4 : 1); it++) {
    let a11 = 0, a13 = 0, a22 = 0, a23 = 0, a33 = 0, b1 = 0, b2 = 0, b3 = 0, sw = 0;
    for (const q of use) {
      const X = q.px - cx, Y = q.py - cy, W = q.wgt;
      // sx = tx - rot*Y ; sy = ty + rot*X
      a11 += W; a22 += W; a13 += -W * Y; a23 += W * X; a33 += W * (X * X + Y * Y);
      b1 += W * q.sx; b2 += W * q.sy; b3 += W * (-Y * q.sx + X * q.sy); sw += W;
    }
    // solve the 3x3 [[a11,0,a13],[0,a22,a23],[a13,a23,a33]]
    const det = a11 * (a22 * a33 - a23 * a23) - a13 * (a13 * a22);
    if (Math.abs(det) < 1e-9) break;
    const rot = (a11 * a22 * b3 - a13 * a22 * b1 - a11 * a23 * b2) / (a11 * a22 * a33 - a11 * a23 * a23 - a13 * a13 * a22);
    const tx = (b1 - a13 * rot) / a11, ty = (b2 - a23 * rot) / a22;
    fit = { dx: tx, dy: ty, rot: rot };
    if (!ignoreMoving) break;
    const res = use.map(q => Math.hypot(tx - rot * (q.py - cy) - q.sx, ty + rot * (q.px - cx) - q.sy));
    const sorted = res.slice().sort((x, y) => x - y), med = sorted[sorted.length >> 1];
    const lim = Math.max(0.6, 2.5 * med);
    const keep = use.filter((q, k) => res[k] <= lim);
    if (keep.length === use.length || keep.length < 4) break;
    use = keep;
  }
  if (!fit) return { dx: sx, dy: sy, rot: 0, used: pts.length, tiles: pts.length };
  fit.used = use.length; fit.tiles = pts.length;
  return fit;
}
async function triAlign() {
  const st = $('triAlignStatus');
  st.innerHTML = '<span class="triOk">Lining up…</span>';
  await new Promise(r => setTimeout(r, 30));
  const s0 = tri.shots[0], w = s0.prev.w, h = s0.prev.h;
  const ref = triEdges(triChannel(s0.prev, tri.uses[0]), w, h);
  const scale = s0.w / w, out = [];
  tri.xf[0] = { dx: 0, dy: 0, rot: 0 };
  for (let k = 1; k < 3; k++) {
    const sk = tri.shots[k];
    // a shot of another size is compared at the reference's size
    const pk = (sk.prev.w === w && sk.prev.h === h) ? sk.prev : triResample(sk.prev, w, h);
    const mov = triEdges(triChannel(pk, tri.uses[k]), w, h);
    const f = triAlignPair(ref, mov, w, h, tri.ignoreMoving);
    tri.xf[k] = { dx: f.dx * scale, dy: f.dy * scale, rot: f.rot };
    out.push(f);
    await new Promise(r => setTimeout(r, 0));
  }
  tri.aligned = true;
  const weak = out.some(f => f.used < 4);
  st.innerHTML = (weak ? '<span class="triWarn">Lined up roughly: little detail to match on. Check it and nudge if needed.</span>'
    : '<span class="triOk">✓ Lined up on the still parts</span>') +
    '<span>' + triMoveText() + '</span>' +
    (tri.ignoreMoving && !weak ? '<span class="triMuted">parts that moved between shots were left out of the match</span>' : '');
  triDraw();
}
function triMoveText() {
  const f = (x) => (Math.abs(x) < 0.05 ? '0' : Math.abs(x).toFixed(1));
  return [1, 2].map(k => {
    const t = tri.xf[k];
    return 'shot ' + (k + 1) + ': ' + f(t.dx) + 'px ' + (t.dx >= 0 ? '→' : '←') + ', ' + f(t.dy) + 'px ' + (t.dy >= 0 ? '↓' : '↑') +
      (Math.abs(t.rot) >= 0.0005 ? ', ' + (t.rot * 180 / Math.PI).toFixed(2) + '°' : '');
  }).join(' · ');
}
function triResample(img, w, h) {
  // nearest-neighbour resize of an RGB buffer (used only to compare shots of different sizes)
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.w - 1, Math.floor(x * img.w / w)), sy = Math.min(img.h - 1, Math.floor(y * img.h / h));
    const s = (sy * img.w + sx) * 3, d = (y * w + x) * 3;
    out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2];
  }
  return { data: out, w, h, raw: img.raw };
}

/* ---- combining ---- */
// plane of shot k (channel `use`) sampled on shot 0's grid of size w x h, through the transform; NaN where it falls off
function triWarped(k, which, w, h) {
  const sh = tri.shots[k], img = which === 'prev' ? sh.prev : sh;
  const plane = triChannel(img, tri.uses[k]);
  const t = tri.xf[k], s = w / tri.shots[0].w;          // transforms are kept at working size; scale to this grid
  const dx = t.dx * s, dy = t.dy * s, c = Math.cos(t.rot), sn = Math.sin(t.rot);
  const kx = img.w / w, ky = img.h / h, cx = w / 2, cy = h / 2;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const Y = y + 0.5 - cy;
    for (let x = 0; x < w; x++) {
      const X = x + 0.5 - cx;
      const qx = (c * X - sn * Y + cx + dx) * kx - 0.5, qy = (sn * X + c * Y + cy + dy) * ky - 0.5;
      const x0 = Math.floor(qx), y0 = Math.floor(qy);
      if (x0 < 0 || y0 < 0 || x0 >= img.w - 1 || y0 >= img.h - 1) { out[y * w + x] = NaN; continue; }
      const fx = qx - x0, fy = qy - y0, i = y0 * img.w + x0;
      out[y * w + x] = (plane[i] * (1 - fx) + plane[i + 1] * fx) * (1 - fy) + (plane[i + img.w] * (1 - fx) + plane[i + img.w + 1] * fx) * fy;
    }
  }
  return out;
}
// the part of shot 0's frame every shot covers, as a rectangle: trim whichever edge has the most uncovered pixels
// along it, one row or column at a time, until every edge is fully covered
function triValidRect(planes, w, h) {
  const bad = (x, y) => planes.some(p => isNaN(p[y * w + x]));
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  const count = (side) => {
    let n = 0;
    if (side === 0) { for (let y = y0; y < y1; y += 2) if (bad(x0, y)) n++; }
    else if (side === 1) { for (let y = y0; y < y1; y += 2) if (bad(x1 - 1, y)) n++; }
    else if (side === 2) { for (let x = x0; x < x1; x += 2) if (bad(x, y0)) n++; }
    else { for (let x = x0; x < x1; x += 2) if (bad(x, y1 - 1)) n++; }
    return n;
  };
  for (let guard = 0; guard < w + h && x1 - x0 > 16 && y1 - y0 > 16; guard++) {
    const c = [count(0), count(1), count(2), count(3)];
    const m = Math.max(c[0], c[1], c[2], c[3]);
    if (!m) break;
    const side = c.indexOf(m);
    if (side === 0) x0++; else if (side === 1) x1--; else if (side === 2) y0++; else y1--;
  }
  return { x0, y0, x1, y1 };
}
function triPlanes(which) {
  const s0 = tri.shots[0], w = which === 'prev' ? s0.prev.w : s0.w, h = which === 'prev' ? s0.prev.h : s0.h;
  return { w, h, p: [0, 1, 2].map(k => triWarped(k, which, w, h)) };
}
function triMedian(plane, rect, w) {
  const v = [];
  const step = Math.max(1, Math.floor(Math.sqrt((rect.x1 - rect.x0) * (rect.y1 - rect.y0) / 20000)));
  for (let y = rect.y0; y < rect.y1; y += step) for (let x = rect.x0; x < rect.x1; x += step) { const a = plane[y * w + x]; if (!isNaN(a)) v.push(a); }
  v.sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : 1;
}
function triMatchExposures() {
  const P = triPlanes('prev'), r = triValidRect(P.p, P.w, P.h);
  const med = P.p.map(p => Math.max(1e-6, triMedian(p, r, P.w)));
  // even the three out at their middle, then set the overall level so the bright end (99.5th percentile of the
  // brightest channel) sits just under white: a sky-heavy frame is not pushed to mid-grey and burnt out
  const g = med.map(m => 1 / m), v = [];
  const step = Math.max(1, Math.floor(Math.sqrt((r.x1 - r.x0) * (r.y1 - r.y0) / 30000)));
  for (let y = r.y0; y < r.y1; y += step) for (let x = r.x0; x < r.x1; x += step) {
    const i = y * P.w + x, a = Math.max(P.p[0][i] * g[0], P.p[1][i] * g[1], P.p[2][i] * g[2]);
    if (!isNaN(a)) v.push(a);
  }
  v.sort((a, b) => a - b);
  const top = v[Math.floor(v.length * 0.995)] || 1;
  tri.gains = g.map(x => x * 0.92 / top);
  triSyncGains(); triDraw();
}
function triSyncGains() {
  for (let c = 0; c < 3; c++) {
    const g = Math.max(1 / 16, Math.min(16, tri.gains[c]));
    tri.gains[c] = g;
    $('triG' + c).value = Math.round(Math.log2(g) * 100);
    $('triGv' + c).textContent = g.toFixed(2);
  }
}
const triEnc = v => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };

/* ---- the preview ---- */
function triDraw() {
  const cv = $('triCv'); if (!cv || !tri.shots[0]) return;
  const P = triPlanes('prev'), w = P.w, h = P.h;
  const r = triValidRect(P.p, w, h);
  const rw = r.x1 - r.x0, rh = r.y1 - r.y0;
  cv.width = rw; cv.height = rh;
  const ctx = cv.getContext('2d'), im = ctx.createImageData(rw, rh), d = im.data;
  let ch;
  if (tri.step === 3 || tri.view === 'result') {
    ch = [0, 1, 2].map(c => ({ p: P.p[c], g: tri.gains[c] }));
  } else {
    // overlay: shot 1 in red, the chosen shot in cyan, each at the same mid-grey, so fringes show what is out of line
    const r0 = triValidRect(P.p, w, h), m0 = triMedian(P.p[0], r0, w), mk = triMedian(P.p[tri.sel], r0, w);
    if (tri.view === 'blink') {
      const k = tri.blinkOn ? tri.sel : 0, g = 0.18 / Math.max(1e-6, k ? mk : m0);
      ch = [0, 1, 2].map(() => ({ p: P.p[k], g }));
    } else {
      const g0 = 0.18 / Math.max(1e-6, m0), gk = 0.18 / Math.max(1e-6, mk);
      ch = [{ p: P.p[0], g: g0 }, { p: P.p[tri.sel], g: gk }, { p: P.p[tri.sel], g: gk }];
    }
  }
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = (y + r.y0) * w + x + r.x0, o = (y * rw + x) * 4;
    d[o] = triEnc(ch[0].p[i] * ch[0].g) * 255; d[o + 1] = triEnc(ch[1].p[i] * ch[1].g) * 255; d[o + 2] = triEnc(ch[2].p[i] * ch[2].g) * 255; d[o + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  const tag = $('triCvTag');
  if (tag) tag.innerHTML = tri.step === 3 || tri.view === 'result' ? '' : tri.view === 'blink'
    ? 'shot ' + ((tri.blinkOn ? tri.sel : 0) + 1)
    : 'shot 1 <span style="color:#e0452a">red</span> · shot ' + (tri.sel + 1) + ' <span style="color:#4fd1d1">cyan</span>';
}

/* ---- the panel ---- */
function triSetRecipe(r) {
  tri.recipe = r;
  const R = TRI_RECIPES[r];
  tri.uses = R.slots.map(s => s.use);
  document.querySelectorAll('#triRecipes button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === r ? 'true' : 'false'));
  $('triRecipeNote').textContent = R.note;
  R.slots.forEach((s, i) => {
    const slot = document.querySelector('.triSlot[data-i="' + i + '"]');
    slot.querySelector('.triSlotLbl').innerHTML = '<span style="color:' + TRI_DOT[i] + '">●</span> ' + s.label;
    slot.querySelector('.triSlotHint').textContent = tri.shots[i] ? s.hint + ' · ' + tri.shots[i].name : s.hint;
    slot.querySelector('.triUse').value = s.use;
  });
  tri.aligned = false; tri.balanced = false;
  triThumbs();
}
function triThumbs() {
  for (let i = 0; i < 3; i++) {
    const slot = document.querySelector('.triSlot[data-i="' + i + '"]'), cv = slot.querySelector('canvas'), sh = tri.shots[i];
    slot.classList.toggle('has', !!sh);
    if (!sh) continue;
    const pl = triChannel(sh.prev, tri.uses[i]), w = sh.prev.w, h = sh.prev.h;
    const tw = 168, th = Math.round(168 * h / w);
    cv.width = tw; cv.height = th;
    const ctx = cv.getContext('2d'), im = ctx.createImageData(tw, th);
    const m = triMedian(pl, { x0: 0, y0: 0, x1: w, y1: h }, w), g = 0.18 / Math.max(1e-6, m);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const v = triEnc(pl[Math.floor(y * h / th) * w + Math.floor(x * w / tw)] * g) * 255, o = (y * tw + x) * 4;
      im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
  }
  const n = tri.shots.filter(Boolean).length;
  const go = $('triToAlign');
  go.disabled = n < 3; go.classList.toggle('ready', n === 3);
  $('triCount').textContent = n + ' of 3';
}
async function triLoadInto(i, file) {
  const slot = document.querySelector('.triSlot[data-i="' + i + '"]');
  const hint = slot.querySelector('.triSlotHint');
  hint.textContent = 'reading ' + file.name + '…';
  slot.classList.add('busy');
  try {
    const img = await triDecode(file);
    img.name = file.name; img.prev = triPreviewOf(img); img.prev.raw = img.raw;
    tri.shots[i] = img; tri.aligned = false; tri.balanced = false;
  } catch (e) {
    console.warn('Trichrome: could not read', file.name, e);
    toast('Could not read ' + file.name + (e && e.message ? ' (' + e.message + ')' : ''), true);
  } finally {
    slot.classList.remove('busy');
    triSetRecipe(tri.recipe);
  }
}
function triShowStep(n) {
  tri.step = n;
  const p = $('triPanel');
  p.dataset.step = n;
  $('triStepNo').textContent = 'step ' + n + ' of 3';
  $('triTitle').textContent = n === 1 ? 'Trichrome' : n === 2 ? 'Line them up' : 'Balance';
  triStopBlink();
  if (n === 2) { if (!tri.aligned) triAlign(); else triDraw(); }
  if (n === 3) { if (!tri.balanced) { tri.balanced = true; triMatchExposures(); } else triDraw(); }
  p.scrollTop = 0;
}
function triOpenPanel() {
  const p = $('triPanel'); if (!p) return;
  p.hidden = false; document.body.classList.add('triOn');
  triSetRecipe(tri.recipe);
  triShowStep(1);
}
function triClosePanel() {
  triStopBlink();
  $('triPanel').hidden = true; document.body.classList.remove('triOn');
}
function triStopBlink() { if (tri.blinkTimer) { clearInterval(tri.blinkTimer); tri.blinkTimer = null; } }
async function triOpenInEditor() {
  const btn = $('triOpen'); btn.disabled = true;
  const lbl = btn.querySelector('.triKeyTxt'), was = lbl.textContent;
  lbl.textContent = 'Combining…';
  await new Promise(r => setTimeout(r, 30));
  try {
    const P = triPlanes('full'), w = P.w, h = P.h, r = triValidRect(P.p, w, h);
    const rw = r.x1 - r.x0, rh = r.y1 - r.y0, px = new Uint16Array(rw * rh * 4);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const i = (y + r.y0) * w + x + r.x0, o = (y * rw + x) * 4;
      for (let c = 0; c < 3; c++) { const v = P.p[c][i]; px[o + c] = Math.round(triEnc(isNaN(v) ? 0 : v * tri.gains[c]) * 65535); }
      px[o + 3] = 65535;
    }
    const blob = await encodeTIFF16(px, rw, rh, false);
    const file = new File([blob], 'trichrome_' + tri.recipe + '.tif', { type: 'image/tiff' });
    triClosePanel();
    await loadFile(file);
    toast('Trichrome opened in the editor');
  } catch (e) {
    console.warn('Trichrome: combine failed', e);
    toast('Could not combine the shots' + (e && e.message ? ' (' + e.message + ')' : ''), true);
  } finally { btn.disabled = false; lbl.textContent = was; }
}

(function triWire() {
  const p = $('triPanel'); if (!p) return;
  const open = $('triStart'); if (open) open.addEventListener('click', triOpenPanel);
  $('triBack').addEventListener('click', () => { if (tri.step > 1) triShowStep(tri.step - 1); else triClosePanel(); });
  document.querySelectorAll('#triRecipes button').forEach(b => b.addEventListener('click', () => { triSetRecipe(b.dataset.r); haptic('select'); }));
  document.querySelectorAll('.triSlot').forEach(slot => {
    const i = +slot.dataset.i, inp = slot.querySelector('input[type=file]');
    slot.querySelector('.triPick').addEventListener('click', () => inp.click());
    inp.addEventListener('change', async () => {
      const files = Array.from(inp.files || []); inp.value = '';
      // several files picked at once fill this slot and the empty ones after it, in order
      let k = i;
      for (const f of files) {
        while (k < 3 && k !== i && tri.shots[k]) k++;
        if (k >= 3) break;
        await triLoadInto(k, f); k++;
      }
    });
    slot.querySelector('.triUse').addEventListener('change', e => { tri.uses[i] = e.target.value; tri.aligned = false; tri.balanced = false; triThumbs(); });
  });
  $('triToAlign').addEventListener('click', () => { if (tri.shots.every(Boolean)) triShowStep(2); });
  document.querySelectorAll('#triView button').forEach(b => b.addEventListener('click', () => {
    tri.view = b.dataset.v;
    document.querySelectorAll('#triView button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    triStopBlink();
    if (tri.view === 'blink') tri.blinkTimer = setInterval(() => { tri.blinkOn = !tri.blinkOn; triDraw(); }, 450);
    triDraw();
  }));
  document.querySelectorAll('#triNudgeShot button').forEach(b => b.addEventListener('click', () => {
    tri.sel = +b.dataset.k;
    document.querySelectorAll('#triNudgeShot button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    triDraw();
  }));
  document.querySelectorAll('#triNudge button').forEach(b => b.addEventListener('click', () => {
    const t = tri.xf[tri.sel], s = tri.shots[0].w / tri.shots[0].prev.w;   // one preview pixel at a time
    const step = 0.25 * s;
    switch (b.dataset.n) {
      case 'l': t.dx += step; break; case 'r': t.dx -= step; break;
      case 'u': t.dy += step; break; case 'd': t.dy -= step; break;
      case 'rl': t.rot += 0.0005; break; case 'rr': t.rot -= 0.0005; break;
    }
    $('triAlignStatus').innerHTML = '<span class="triOk">Adjusted by hand</span><span>' + triMoveText() + '</span>';
    triDraw();
  }));
  $('triIgnore').addEventListener('change', e => { tri.ignoreMoving = e.target.checked; triAlign(); });
  $('triToBalance').addEventListener('click', () => triShowStep(3));
  for (let c = 0; c < 3; c++) $('triG' + c).addEventListener('input', e => {
    tri.gains[c] = Math.pow(2, e.target.value / 100); $('triGv' + c).textContent = tri.gains[c].toFixed(2); triDraw();
  });
  $('triMatch').addEventListener('click', () => { triMatchExposures(); haptic('select'); });
  $('triPickGrey').addEventListener('click', () => {
    tri.picking = !tri.picking;
    $('triPickGrey').setAttribute('aria-pressed', tri.picking ? 'true' : 'false');
    $('triCv').classList.toggle('picking', tri.picking);
  });
  $('triCv').addEventListener('click', e => {
    if (!tri.picking || tri.step !== 3) return;
    const cv = $('triCv'), rc = cv.getBoundingClientRect();
    const P = triPlanes('prev'), r = triValidRect(P.p, P.w, P.h);
    const x = Math.round((e.clientX - rc.left) / rc.width * cv.width) + r.x0, y = Math.round((e.clientY - rc.top) / rc.height * cv.height) + r.y0;
    // a small average around the tap, so one noisy pixel does not set the balance
    const v = [0, 0, 0]; let n = 0;
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= P.w || yy >= P.h) continue;
      const a = P.p.map(p => p[yy * P.w + xx]); if (a.some(isNaN)) continue;
      v[0] += a[0]; v[1] += a[1]; v[2] += a[2]; n++;
    }
    if (!n) return;
    const avg = v.map(s => s / n), lvl = (avg[0] * tri.gains[0] + avg[1] * tri.gains[1] + avg[2] * tri.gains[2]) / 3;
    tri.gains = avg.map(a => lvl / Math.max(1e-6, a));
    tri.picking = false; $('triPickGrey').setAttribute('aria-pressed', 'false'); cv.classList.remove('picking');
    triSyncGains(); triDraw(); haptic('confirm');
  });
  $('triOpen').addEventListener('click', triOpenInEditor);
})();
