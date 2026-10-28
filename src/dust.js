/* ---------- Dust removal (build 185) ----------
   Tap a dust spot and it is healed the way darktable's retouch module heals: a patch from somewhere else in the photo
   is copied over the spot, and the difference between the two along the spot's edge is spread smoothly across it by
   solving Laplace's equation, so the copied texture takes on the brightness and colour of its new surroundings.
   The solver is a port of darktable's src/common/heal.c (red-black Gauss-Seidel with successive over-relaxation, same
   over-relaxation factor and convergence test), itself after T. Georgiev, "Photoshop Healing Brush: a Tool for Seamless
   Cloning". darktable is GPL-3.0-or-later; irlab is AGPL-3.0, which may include GPL-3.0 code (see THIRD_PARTY_NOTICES.md).

   An attempt in build ~60 filled spots by averaging their surroundings inside the live shader: a smooth blob on sky
   and a starburst on fences and foliage. Copying real texture is what fixes both. Unlike darktable, the source is picked
   automatically (the nearby patch whose surroundings best match the spot's), with "Other source" to step through the
   next-best ones.

   Like darktable's spots and retouch modules, it runs first, on the source image itself: the working copy that goes to
   the GPU is healed in place, with the original pixels kept so a change or removal restores them exactly. Spots are
   stored relative to the image (centre and radius as fractions), so the same heal lands at full resolution on export. */

let dustSpots = [];          // { x, y, r, sx, sy, k }: centre, radius (fraction of the short edge), source centre, which candidate
let dustArmed = false;
let dustShow = false;
let dustSize = 1.2;          // radius of new spots, % of the short edge
let dustSel = -1;
let dustSrcFor = -1;         // a spot waiting for its source to be tapped (darktable: move the source shape)
let dustSrcToken = null;     // the photo the sources were picked on
const DUST_FEATHER = 0.35;   // soft edge outside the radius, as a fraction of it
const DUST_MAX_ITER = 1000;  // darktable's default for retouch

/* darktable heal.c, ported. d (target) and s (source) are Float32Array RGB patches of w*h; mask is 0..1. Writes the healed
   patch into d where mask > 0 (the caller blends by the mask afterwards). */
function dustHeal(d, s, mask, w, h) {
  const n = w * h, u = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) u[i] = d[i] - s[i];
  const idx = []; for (let i = 0; i < n; i++) if (mask[i] > 0) idx.push(i);
  const nmask = idx.length; if (!nmask) return;
  /* Heal or clone (darktable's retouch has both). Healing spreads the difference found along the spot's edge across the
     whole spot, which is exactly right when the edge differs only by a smooth change of level (sky, skin of a wall) and
     wrong when the edge crosses different things (a trunk against sky and leaves): there the sky's difference leaks onto
     the trunk as a smear. So measure how much that edge difference varies; if it varies a lot, clone instead, the copied
     patch moved by one robust level offset, with the soft mask edge doing the blending. */
  const edge = [];
  for (let i = 0; i < n; i++) {
    if (mask[i] > 0) continue;
    const x = i % w, y = (i / w) | 0;
    if ((x > 0 && mask[i - 1] > 0) || (x < w - 1 && mask[i + 1] > 0) || (y > 0 && mask[i - w] > 0) || (y < h - 1 && mask[i + w] > 0)) edge.push(i);
  }
  if (edge.length > 8) {
    const med = [0, 0, 0], spread = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const v = edge.map(i => u[i * 3 + c]).sort((a, b) => a - b);
      med[c] = v[v.length >> 1];
      const dev = v.map(x => Math.abs(x - med[c])).sort((a, b) => a - b);
      spread[c] = dev[Math.min(dev.length - 1, Math.floor(dev.length * 0.75))];
    }
    const lvl = Math.max(1e-3, ...edge.map(i => (d[i * 3] + d[i * 3 + 1] + d[i * 3 + 2]) / 3).sort((a, b) => a - b).slice(edge.length >> 1, (edge.length >> 1) + 1));
    if (Math.max(...spread) > Math.max(0.035, 0.18 * lvl)) {
      for (let k = 0; k < nmask; k++) { const i = idx[k]; for (let c = 0; c < 3; c++) d[i * 3 + c] = s[i * 3 + c]; }   // plain clone: an offset taken from a mixed edge would tint it
      return;
    }
  }
  const red = [], black = [];
  idx.forEach(i => { const x = i % w, y = (i / w) | 0; ((x + y) & 1 ? red : black).push(i); });
  const wr = (2 - 1 / (0.1575 * Math.sqrt(nmask) + 0.8)) * 0.25;   // darktable's empirically optimal over-relaxation
  const eps = 0.1 / 255, errExit = eps * eps * wr * wr;
  const pass = list => {
    let err = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k], x = i % w, y = (i / w) | 0;
      let a = 0; const sum = [0, 0, 0];
      if (x > 0) { a++; for (let c = 0; c < 3; c++) sum[c] += u[(i - 1) * 3 + c]; }
      if (x < w - 1) { a++; for (let c = 0; c < 3; c++) sum[c] += u[(i + 1) * 3 + c]; }
      if (y > 0) { a++; for (let c = 0; c < 3; c++) sum[c] += u[(i - w) * 3 + c]; }
      if (y < h - 1) { a++; for (let c = 0; c < 3; c++) sum[c] += u[(i + w) * 3 + c]; }
      for (let c = 0; c < 3; c++) { const diff = wr * (a * u[i * 3 + c] - sum[c]); u[i * 3 + c] -= diff; err += diff * diff; }
    }
    return err;
  };
  for (let it = 0; it < DUST_MAX_ITER; it++) { if (pass(black) + pass(red) < errExit) break; }
  for (let k = 0; k < nmask; k++) { const i = idx[k]; for (let c = 0; c < 3; c++) d[i * 3 + c] = s[i * 3 + c] + u[i * 3 + c]; }
}

/* Geometry of one spot on a W x H image. */
function dustGeom(sp, W, H) {
  const S = Math.min(W, H), R = Math.max(1.5, sp.r * S), outer = R * (1 + DUST_FEATHER);
  const cx = sp.x * W, cy = sp.y * H;
  const x0 = Math.max(0, Math.floor(cx - outer) - 1), y0 = Math.max(0, Math.floor(cy - outer) - 1);
  const x1 = Math.min(W, Math.ceil(cx + outer) + 2), y1 = Math.min(H, Math.ceil(cy + outer) + 2);
  let dx = Math.round(sp.sx * W - cx), dy = Math.round(sp.sy * H - cy);
  dx = Math.max(-x0, Math.min(W - x1, dx)); dy = Math.max(-y0, Math.min(H - y1, dy));   // keep the source inside the image
  const w = x1 - x0, h = y1 - y0, mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.hypot(x0 + x + 0.5 - cx, y0 + y + 0.5 - cy);
    mask[y * w + x] = r <= R ? 1 : r >= outer ? 0 : (t => 1 - t * t * (3 - 2 * t))((r - R) / (outer - R));
  }
  return { x0, y0, w, h, dx, dy, mask };
}

/* Heal every spot into an RGBA buffer (Float32Array linear, or Uint8ClampedArray 0-255), in place, in order; returns the
   original pixels of every patch touched so they can be put back. */
function dustApplyBuf(buf, W, H, isByte) {
  const saved = [];
  const sc = isByte ? 1 / 255 : 1;
  dustSpots.forEach(sp => {
    const g = dustGeom(sp, W, H), n = g.w * g.h, d = new Float32Array(n * 3), s = new Float32Array(n * 3);
    const keep = isByte ? new Uint8ClampedArray(n * 4) : new Float32Array(n * 4);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x, ti = ((g.y0 + y) * W + g.x0 + x) * 4, si = ((g.y0 + y + g.dy) * W + g.x0 + x + g.dx) * 4;
      for (let c = 0; c < 4; c++) keep[i * 4 + c] = buf[ti + c];
      for (let c = 0; c < 3; c++) { d[i * 3 + c] = buf[ti + c] * sc; s[i * 3 + c] = buf[si + c] * sc; }
    }
    const orig = d.slice();
    dustHeal(d, s, g.mask, g.w, g.h);
    for (let i = 0; i < n; i++) {
      const m = g.mask[i]; if (m <= 0) continue;
      const ti = ((g.y0 + ((i / g.w) | 0)) * W + g.x0 + (i % g.w)) * 4;
      for (let c = 0; c < 3; c++) buf[ti + c] = (orig[i * 3 + c] + (d[i * 3 + c] - orig[i * 3 + c]) * m) / sc;
    }
    saved.push({ x0: g.x0, y0: g.y0, w: g.w, h: g.h, px: keep });
  });
  return saved;
}
function dustRestoreBuf(buf, W, saved) {
  for (let k = saved.length - 1; k >= 0; k--) {   // newest first, so overlapping patches end at the true original
    const p = saved[k];
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4, ti = ((p.y0 + y) * W + p.x0 + x) * 4;
      for (let c = 0; c < 4; c++) buf[ti + c] = p.px[i + c];
    }
  }
}

/* Called with every image on its way to the GPU (preview and export). Heals it in place, first putting back whatever an
   earlier heal of the same image changed, so it always starts from the original pixels. */
/* Put back what an earlier heal changed. keepCanvas=false is for a canvas about to be redrawn (drawOriented): its pixels
   are about to be replaced anyway, but its linear twin may be the same buffer the redraw is about to copy from. */
function dustUnheal(img, keepCanvas) {
  if (!img) return;
  const lf = img.__linearFloat;
  if (lf && lf.__dustSaved) { dustRestoreBuf(lf, lf.__dustW || img.width, lf.__dustSaved); lf.__dustSaved = null; }
  if (img.__dustSaved && img.getContext && keepCanvas !== false) {
    const cx = img.getContext('2d');
    for (let k = img.__dustSaved.length - 1; k >= 0; k--) { const p = img.__dustSaved[k]; const id = cx.createImageData(p.w, p.h); id.data.set(p.px); cx.putImageData(id, p.x0, p.y0); }
  }
  img.__dustSaved = null;
}
function dustPrepare(img) {
  if (!img || !img.width) return img;
  const W = img.width, H = img.height;
  dustUnheal(img);
  const lf = img.__linearFloat;
  if (!dustSpots.length) return img;
  if (img === (typeof rawCanvas !== 'undefined' ? rawCanvas : null)) dustEnsureSources();
  try {
    if (lf) { lf.__dustSaved = dustApplyBuf(lf, W, H, false); lf.__dustW = W; }
    if (img.getContext) {
      // the 8-bit canvas is what WebGL1 uploads and what full-resolution export draws from; heal it the same way, one
      // patch region at a time rather than reading the whole frame
      const cx = img.getContext('2d'), saved = [];
      dustSpots.forEach(sp => {
        const g = dustGeom(sp, W, H);
        const bx0 = Math.min(g.x0, g.x0 + g.dx), by0 = Math.min(g.y0, g.y0 + g.dy);
        const bx1 = Math.max(g.x0, g.x0 + g.dx) + g.w, by1 = Math.max(g.y0, g.y0 + g.dy) + g.h;
        const region = cx.getImageData(bx0, by0, bx1 - bx0, by1 - by0);
        const before = cx.getImageData(g.x0, g.y0, g.w, g.h);
        const one = dustSpots; dustSpots = [Object.assign({}, sp, {
          x: (sp.x * W - bx0) / region.width, y: (sp.y * H - by0) / region.height,
          r: sp.r * Math.min(W, H) / Math.min(region.width, region.height),
          sx: (sp.x * W - bx0 + g.dx) / region.width, sy: (sp.y * H - by0 + g.dy) / region.height })];
        try { dustApplyBuf(region.data, region.width, region.height, true); } finally { dustSpots = one; }
        cx.putImageData(region, bx0, by0);
        saved.push({ x0: g.x0, y0: g.y0, w: g.w, h: g.h, px: before.data });
      });
      img.__dustSaved = saved;
    }
  } catch (e) { console.warn('dust removal failed:', e && e.message); }
  return img;
}

/* ---- picking a source ----
   Candidates sit on rings 2.2, 3 and 4 radii out, every 22.5 degrees. Each is scored by how well the ring of pixels just
   outside the spot matches the same ring around the candidate (the spot itself holds the dust, so it is never compared),
   plus a small preference for nearer sources. Candidates whose patch would cover another spot are skipped. */
function dustCandidates(sp, px, W, H) {
  const S = Math.min(W, H), R = Math.max(1.5, sp.r * S), cx = sp.x * W, cy = sp.y * H, outer = R * (1 + DUST_FEATHER);
  // three rings just outside the spot, the nearest weighted most: it is what the healed edge has to meet
  const ring = [];
  for (let a = 0; a < 32; a++) for (const [rr, wt] of [[R * 1.2, 2], [outer * 1.12, 1.5], [outer * 1.45, 1]]) {
    const t = a / 32 * Math.PI * 2; ring.push([Math.cos(t) * rr, Math.sin(t) * rr, wt]);
  }
  const at = (x, y) => { x = Math.max(0, Math.min(W - 1, Math.round(x))); y = Math.max(0, Math.min(H - 1, Math.round(y))); const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const tgt = ring.map(([ox, oy]) => at(cx + ox, cy + oy));
  /* Compare the PATTERN as well as the level: the heal fixes a level difference by itself, but it cannot move an edge,
     so a source whose ring has the same light/dark layout (an edge running the same way) wins over one that is merely
     the same average colour. */
  const mean = a => { const m = [0, 0, 0]; a.forEach(c => { m[0] += c[0]; m[1] += c[1]; m[2] += c[2]; }); return m.map(v => v / a.length); };
  const tm = mean(tgt);
  const score = (scx, scy, dist) => {
    const cand = ring.map(([ox, oy]) => at(scx + ox, scy + oy)), cm = mean(cand);
    let e = 0, ws = 0;
    ring.forEach((r, k) => {
      const c = cand[k], q = tgt[k], wt = r[2];
      const pat = (c[0] - cm[0] - q[0] + tm[0]) ** 2 + (c[1] - cm[1] - q[1] + tm[1]) ** 2 + (c[2] - cm[2] - q[2] + tm[2]) ** 2;
      const lvl = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2;
      e += wt * (pat + 0.25 * lvl); ws += wt;
    });
    // a busier patch than the spot's surroundings brings detail that was never there
    let vc = 0, vt = 0; cand.forEach((c, k) => { vc += (c[0] + c[1] + c[2] - cm[0] - cm[1] - cm[2]) ** 2; vt += (tgt[k][0] + tgt[k][1] + tgt[k][2] - tm[0] - tm[1] - tm[2]) ** 2; });
    return e / ws * (1 + 0.06 * dist) + 0.05 * Math.max(0, vc - vt) / ring.length;
  };
  const ok = (scx, scy) => !(scx - outer < 1 || scy - outer < 1 || scx + outer > W - 2 || scy + outer > H - 2) &&
    !dustSpots.some(o => o !== sp && Math.hypot(o.x * W - scx, o.y * H - scy) < (o.r * S + R) * (1 + DUST_FEATHER)) &&
    Math.hypot(scx - cx, scy - cy) > outer * 1.5;
  const out = [];
  for (const dist of [1.7, 2.2, 3, 4]) for (let a = 0; a < 24; a++) {
    const t = a / 24 * Math.PI * 2, scx = cx + Math.cos(t) * outer * dist, scy = cy + Math.sin(t) * outer * dist;
    if (!ok(scx, scy)) continue;
    out.push({ sx: scx / W, sy: scy / H, dist, score: score(scx, scy, dist) });
  }
  out.sort((p, q) => p.score - q.score);
  /* Line the best few up to the pixel: the heal can absorb a difference in level but not an edge that is a pixel or two
     out of place, which is what left a smear along a tree trunk. */
  out.slice(0, 6).forEach(c => {
    let bx = c.sx * W, by = c.sy * H, bs = c.score;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = c.sx * W + dx, y = c.sy * H + dy; if (!ok(x, y)) continue;
      const v = score(x, y, c.dist); if (v < bs) { bs = v; bx = x; by = y; }
    }
    c.sx = bx / W; c.sy = by / H; c.score = bs;
  });
  out.sort((p, q) => p.score - q.score);
  return out;
}
function dustPickSource(sp) {
  if (typeof rawPixels === 'undefined' || !rawPixels || !rawCanvas) return;
  const c = dustCandidates(sp, rawPixels, rawCanvas.width, rawCanvas.height);
  if (!c.length) { sp.sx = sp.x + sp.r * 3; sp.sy = sp.y; return; }
  const pick = c[(sp.k || 0) % c.length]; sp.sx = pick.sx; sp.sy = pick.sy;
}
/* A new photo keeps the spots (sensor dust sits in the same place frame after frame) but needs its own sources. */
function dustEnsureSources() {
  const tok = typeof loadToken !== 'undefined' ? loadToken : null;
  if (tok === dustSrcToken) return;
  dustSrcToken = tok;
  dustSpots.forEach(sp => { sp.manual = false; dustPickSource(sp); });
}

/* ---- Find dust (build 223) ----
   Sensor dust shows as small, soft, round, darker-than-their-surroundings spots on smooth areas (sky, walls), which is exactly
   where full-spectrum and UV frames show it worst. Detection follows LightCraft's dust finder (crates/pipeline/src/dust.rs,
   MIT OR Apache-2.0; see THIRD_PARTY_NOTICES.md): a blurred copy gives the surroundings, a pixel is a candidate when it is darker
   than them by more than a threshold AND by more than three times the local texture (so real detail never triggers it), candidates
   are grouped into 4-connected blobs, and a blob counts only if it is small and roughly round. The code here is a fresh
   implementation. Works on a copy at most 1600 px on the long edge, so it takes a fraction of a second at any photo size.
   px: RGBA bytes, W x H; sensitivity 0..100 (higher finds fainter spots). Returns spots in the same shape the tap tool makes
   ({ x, y, r }: centre as 0..1 of the width and height, radius as a fraction of the SHORT edge), strongest first, at most 60. */
function dustBlur(src, w, h, sigma) {
  /* three passes of a box blur stand in for a Gaussian (the box helper is tone-base.js's) */
  const r = Math.max(1, Math.round((Math.sqrt(12 * sigma * sigma / 3 + 1) - 1) / 2));
  return toneBaseBox(toneBaseBox(toneBaseBox(src, w, h, r), w, h, r), w, h, r);
}
function dustDetectPixels(px, W, H, sensitivity) {
  if (!px || W < 32 || H < 32) return [];
  const k = Math.min(1, 1600 / Math.max(W, H)), w = Math.max(32, Math.round(W * k)), h = Math.max(32, Math.round(H * k)), n = w * h;
  const l = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * H / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * H / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * W / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * W / w));
      let sum = 0, c = 0;
      for (let yy = y0; yy < y1; yy++) { let i = (yy * W + x0) * 4; for (let xx = x0; xx < x1; xx++, i += 4) { sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; c++; } }
      l[y * w + x] = sum / (c * 255);
    }
  }
  const long = Math.max(w, h);
  const around = dustBlur(l, w, h, Math.max(2, 0.012 * long));
  const detail = new Float32Array(n); for (let i = 0; i < n; i++) detail[i] = Math.abs(l[i] - around[i]);
  const texture = dustBlur(detail, w, h, Math.max(3, 0.02 * long));
  const minDark = 0.03 - 0.022 * Math.max(0, Math.min(1, sensitivity / 100));
  const dark = new Float32Array(n); for (let i = 0; i < n; i++) dark[i] = Math.max(around[i] - l[i], 0);
  const cand = i => dark[i] > minDark && dark[i] > 3 * texture[i] && l[i] > 0.08;
  const seen = new Uint8Array(n), out = [], rmin = 0.0015 * long, rmax = 0.02 * long, cap = Math.floor(rmax * rmax * 4);
  for (let start = 0; start < n; start++) {
    if (seen[start] || !cand(start)) continue;
    const stack = [start]; seen[start] = 1;
    let cnt = 0, sx = 0, sy = 0, peak = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      cnt++; sx += x; sy += y; if (dark[i] > peak) peak = dark[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (cnt > cap) break;   // too big to be dust: stop growing
      if (x > 0 && !seen[i - 1] && cand(i - 1)) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !seen[i + 1] && cand(i + 1)) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - w] && cand(i - w)) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !seen[i + w] && cand(i + w)) { seen[i + w] = 1; stack.push(i + w); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, r = Math.max(bw, bh) / 2;
    const round = Math.max(bw, bh) / Math.min(bw, bh) <= 1.8 && cnt >= 0.45 * bw * bh;
    if (r >= rmin && r <= rmax && round) out.push({ x: (sx / cnt + 0.5) / w, y: (sy / cnt + 0.5) / h, r: (r * 1.6 / long) * Math.max(w, h) / Math.min(w, h), strength: peak });
  }
  out.sort((a, b) => b.strength - a.strength);
  return out.slice(0, 60);
}
function dustFind() {
  if (!loadedImage || !rawCanvas || typeof rawPixels === 'undefined' || !rawPixels) { toast('Open a photo first.'); return; }
  const sens = +($('dustSens') && $('dustSens').value) || 50;
  const found = dustDetectPixels(rawPixels, rawCanvas.width, rawCanvas.height, sens), S = Math.min(rawCanvas.width, rawCanvas.height);
  const fresh = found.filter(f => !dustSpots.some(o => Math.hypot((o.x - f.x) * rawCanvas.width, (o.y - f.y) * rawCanvas.height) < (o.r + f.r) * S));   // already have a spot there
  if (!fresh.length) { toast(found.length ? 'No new dust: every spot found is already in the list.' : 'No dust found. Raise Sensitivity to look for fainter spots.'); return; }
  armUndoCapture();
  dustSrcToken = typeof loadToken !== 'undefined' ? loadToken : null;
  fresh.forEach(f => { const sp = { x: f.x, y: f.y, r: f.r, sx: f.x, sy: f.y, k: 0 }; dustSpots.push(sp); dustPickSource(sp); });
  dustSel = -1;
  commitUndoCapture();
  if (typeof haptic === 'function') haptic('select');
  dustRefresh();
  toast('Found ' + fresh.length + (fresh.length === 1 ? ' spot' : ' spots') + '. Check them with Show dust; remove any that are not dust.');
}

/* ---- UI ---- */
function dustRefresh() {
  if (typeof engine !== 'undefined' && engine && typeof rawCanvas !== 'undefined' && rawCanvas) { engine.setImage(dustPrepare(rawCanvas)); }
  dustRenderList();
  if (typeof render === 'function') render();
}
function dustRenderList() {
  const list = $('dustList'); if (!list) return;
  list.innerHTML = dustSpots.map((s, i) => '<div class="dustRow' + (i === dustSel ? ' sel' : '') + '" data-i="' + i + '"><span>Spot ' + (i + 1) + '</span>' +
    '<button type="button" class="btnGhostSmall dustAlt" data-i="' + i + '" title="Copy from the next-best place instead">Other source</button>' +
    '<button type="button" class="btnGhostSmall dustPick' + (i === dustSrcFor ? ' armed' : '') + '" data-i="' + i + '" title="Tap the photo where this spot should copy from">' + (i === dustSrcFor ? 'Tap photo\u2026' : 'Choose') + '</button>' +
    '<button type="button" class="dustDel" data-i="' + i + '" aria-label="Remove spot ' + (i + 1) + '">×</button></div>').join('');
  $('dustClear').hidden = !dustSpots.length;
  const d = $('dustDetails'); if (d) d.classList.toggle('mod', dustSpots.length > 0);
  dustDrawMarks();
}
/* rings on the preview: the spot, and a dotted ring where it is copied from (only while adding or one is selected) */
function dustDrawMarks() {
  let o = $('dustMarks');
  const pv = $('preview'); if (!pv) return;
  if (!o) { o = document.createElement('div'); o.id = 'dustMarks'; pv.parentElement.appendChild(o); }
  const show = dustArmed || dustSel >= 0 || dustSrcFor >= 0;
  if (!show || !dustSpots.length || !rawCanvas) { o.innerHTML = ''; return; }
  const pr = pv.getBoundingClientRect(), par = o.parentElement.getBoundingClientRect();
  const k = pr.width / rawCanvas.width, S = Math.min(rawCanvas.width, rawCanvas.height);
  const ring = (x, y, r, cls) => '<i class="' + cls + '" style="left:' + (pr.left - par.left + x * pr.width) + 'px;top:' + (pr.top - par.top + y * pr.height) + 'px;width:' + (2 * r) + 'px;height:' + (2 * r) + 'px"></i>';
  o.innerHTML = dustSpots.map((s, i) => {
    const r = Math.max(4, s.r * S * k);
    return ring(s.x, s.y, r, 'dSpot' + (i === dustSel ? ' sel' : '')) + (i === dustSel || dustArmed ? ring(s.sx, s.sy, r, 'dSrc') : '');
  }).join('');
}
function dustTap(clientX, clientY) {
  if (!loadedImage || !rawCanvas) return;
  const cv = $('preview'), rect = cv.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width, y = (clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  if (dustSrcFor >= 0 && dustSpots[dustSrcFor]) {   // choosing a source by hand
    armUndoCapture(); const sp = dustSpots[dustSrcFor]; sp.sx = x; sp.sy = y; sp.manual = true; dustSel = dustSrcFor; dustSrcFor = -1;
    commitUndoCapture(); $('preview').classList.toggle('pick', dustArmed); dustRefresh(); return;
  }
  armUndoCapture();
  const sp = { x, y, r: dustSize / 100, sx: x, sy: y, k: 0 };
  dustSpots.push(sp); dustSrcToken = typeof loadToken !== 'undefined' ? loadToken : null;
  dustPickSource(sp);
  dustSel = dustSpots.length - 1;
  commitUndoCapture();
  if (typeof haptic === 'function') haptic('select');
  dustRefresh();
}
function dustSetArmed(on) {
  dustArmed = !!on;
  const b = $('dustAdd'); if (b) { b.classList.toggle('armed', dustArmed); b.textContent = dustArmed ? 'Done adding' : 'Add spots'; }
  const pv = $('preview'); if (pv) pv.classList.toggle('pick', dustArmed);
  if (dustArmed && typeof exitPick === 'function' && typeof pickMode !== 'undefined' && pickMode) exitPick();
  dustDrawMarks();
}
(function dustInit() {
  if (!$('dustDetails')) return;
  $('dustAdd').addEventListener('click', () => dustSetArmed(!dustArmed));
  if ($('dustFind')) $('dustFind').addEventListener('click', dustFind);
  if ($('dustSens')) $('dustSens').addEventListener('input', () => { $('v_dustSens').textContent = $('dustSens').value; });
  const pv = $('preview');
  // capture phase, so a tap while adding spots never reaches the other pickers or the before/after drag
  pv.addEventListener('click', ev => { if (!dustArmed && dustSrcFor < 0) return; ev.stopImmediatePropagation(); dustTap(ev.clientX, ev.clientY); }, true);
  pv.addEventListener('touchend', ev => { if (!dustArmed && dustSrcFor < 0) return; ev.preventDefault(); ev.stopImmediatePropagation(); const t = ev.changedTouches[0]; dustTap(t.clientX, t.clientY); }, { capture: true, passive: false });
  $('dustSize').addEventListener('input', () => {
    dustSize = +$('dustSize').value / 10; $('v_dustSize').textContent = dustSize.toFixed(1);
    if (dustSel >= 0 && dustSpots[dustSel]) { dustSpots[dustSel].r = dustSize / 100; if (!dustSpots[dustSel].manual) dustPickSource(dustSpots[dustSel]); clearTimeout(dustInit._t); dustInit._t = setTimeout(dustRefresh, 120); dustDrawMarks(); }
  });
  $('dustSize').addEventListener('pointerdown', () => { if (dustSel >= 0) armUndoCapture(); });
  $('dustSize').addEventListener('change', () => { if (dustSel >= 0) commitUndoCapture(); });
  $('dustList').addEventListener('click', e => {
    const del = e.target.closest('.dustDel'), alt = e.target.closest('.dustAlt'), row = e.target.closest('.dustRow');
    if (del) { armUndoCapture(); dustSpots.splice(+del.dataset.i, 1); dustSel = -1; commitUndoCapture(); dustRefresh(); return; }
    const pk = e.target.closest('.dustPick');
    if (pk) { const i = +pk.dataset.i; dustSrcFor = dustSrcFor === i ? -1 : i; dustSel = i; $('preview').classList.toggle('pick', dustArmed || dustSrcFor >= 0); dustRenderList(); return; }
    if (alt) { armUndoCapture(); const s = dustSpots[+alt.dataset.i]; s.k = (s.k || 0) + 1; s.manual = false; dustPickSource(s); dustSel = +alt.dataset.i; commitUndoCapture(); dustRefresh(); return; }
    if (row) { dustSel = dustSel === +row.dataset.i ? -1 : +row.dataset.i; if (dustSel >= 0) { const r = dustSpots[dustSel].r * 100; $('dustSize').value = Math.round(r * 10); $('v_dustSize').textContent = r.toFixed(1); } dustRenderList(); }
  });
  $('dustClear').addEventListener('click', () => { armUndoCapture(); dustSpots = []; dustSel = -1; commitUndoCapture(); dustRefresh(); });
  $('dustShow').addEventListener('change', () => { dustShow = $('dustShow').checked; if (typeof render === 'function') render(); });
  window.addEventListener('resize', dustDrawMarks);
  dustRenderList();
})();

/* The photo was turned a quarter: turn the spots with it (dir 1 = clockwise). */
function dustRotate(dir) {
  const t = dir > 0 ? (x, y) => [1 - y, x] : (x, y) => [y, 1 - x];
  dustSpots.forEach(sp => { [sp.x, sp.y] = t(sp.x, sp.y); [sp.sx, sp.sy] = t(sp.sx, sp.sy); });
}
