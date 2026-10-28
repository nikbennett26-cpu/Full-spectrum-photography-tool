'use strict';
/* irlab editor: js/raw-clean.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- Hot pixels and line noise, on the RAW data (build 225) ----------
   A long exposure on a converted camera leaves two kinds of fault in the sensor data that no later noise reduction can
   judge well, because the channel swap and the colour work that follow stretch them into coloured specks and streaks:

     1. Hot (and stuck-dark) pixels: single sites that read far above, or below, everything around them.
     2. Line noise: the read-out electronics add a small offset to a whole row, or a whole column, at a time, which
        shows as faint stripes across the frame.

   The ideas come from ART (Adaptive Raw Therapee, GPL-3.0; src/engine/badpixels.cc, impulse_denoise.cc and
   cfa_linedn_RT.cc) and are reimplemented here on the three demosaiced planes rather than the mosaic, because the decoder
   hands the page planes, not the mosaic.

   HOT PIXELS. After demosaicing, every colour is present at every site, but only the sites two pixels away in a straight
   or diagonal line are guaranteed to be the same CFA colour as the one tested, so the ring of 8 at distance 2 is the
   fair comparison. A pixel is a hot one when it sits above ALL eight (by more than 6 times the frame's own noise), and a
   stuck-dark one when it sits below all eight; and it must be isolated: a real point of light (a star, a glint) is spread
   over its neighbours by the lens, so its four touching pixels carry at least half its excess, while a hot pixel's carry
   little. The pixel is replaced by the median of its ring, and its eight touching pixels, which the demosaic smeared a
   little of the fault into, are held to the level of their own rings.

   LINE NOISE. For each row, the median across the row of (pixel minus the mean of the pixels above and below it) is the
   row's offset; the median is taken so that picture content, which does not run the full width, does not count. The
   offsets of neighbouring rows contaminate each other a little, so a few rounds of the same average undo that; the slow
   part (real shading, which belongs to the picture) is taken out, and an offset that is too large to be read-out noise is
   left alone, since it is probably a real horizontal edge. Columns are done the same way.

   Everything is reversible and kept per photo: the list of changed samples (with their old values) and the per-row and
   per-column offsets, so the tick box can be turned off again, or on again, without a second search. */

function rcSortedMedian(arr, n) { const s = arr.subarray(0, n); s.sort(); return (n & 1) ? s[n >> 1] : 0.5 * (s[(n >> 1) - 1] + s[n >> 1]); }

/* The frame's own noise level on one plane: 1.4826 x the median absolute difference between a pixel and the median of
   its ring of 8, over a sample of positions. */
function rcPlaneSigma(P, W, H) {
  const o = [-2, 2, -2 * W, 2 * W, -2 * W - 2, -2 * W + 2, 2 * W - 2, 2 * W + 2], ring = new Float32Array(8);
  const step = Math.max(1, Math.floor(Math.sqrt((W * H) / 40000))), dev = new Float32Array(Math.ceil(H / step) * Math.ceil(W / step));
  let n = 0;
  for (let y = 3; y < H - 3; y += step) for (let x = 3; x < W - 3; x += step) {
    const i = y * W + x;
    for (let k = 0; k < 8; k++) ring[k] = P[i + o[k]];
    ring.sort();
    dev[n++] = Math.abs(P[i] - 0.5 * (ring[3] + ring[4]));
  }
  return n ? 1.4826 * rcSortedMedian(dev, n) : 0;
}

/* The hot / stuck pixels of three planes: { idx: Int32Array (pixel * 3 + channel), old, nw: Float32Array }, the samples
   to change (the fault itself and the touching pixels), in the order they were applied. The planes are left as they were
   found (this only reads); rcApply does the writing. */
function* rcFindHotGen(P3, W, H) {
  const o = [-2, 2, -2 * W, 2 * W, -2 * W - 2, -2 * W + 2, 2 * W - 2, 2 * W + 2], ring = new Float32Array(8);
  const sig = P3.map(P => rcPlaneSigma(P, W, H)), limit = Math.max(8, Math.floor(W * H * 0.003));
  let boost = 1, cand = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    cand = [];
    const T = sig.map(s => Math.max(6 * s * boost, 0.002 * boost));
    let tooMany = false;
    for (let y = 3; y < H - 3 && !tooMany; y++) {
      for (let c = 0; c < 3; c++) {
        const P = P3[c], t = T[c];
        for (let x = 3, i = y * W + 3; x < W - 3; x++, i++) {
          const v = P[i], d0 = v - P[i - 2];
          if (d0 <= t && d0 >= -t) continue;              // the first ring neighbour already says "ordinary"
          const hot = d0 > t;
          let ok = true, mx = -1e9, mn = 1e9;
          for (let k = 0; k < 8; k++) {
            const q = P[i + o[k]], d = v - q;
            if (hot ? d <= t : d >= -t) { ok = false; break; }
            if (q > mx) mx = q; if (q < mn) mn = q;
          }
          if (!ok) continue;
          /* a fault stands out in proportion: at least 30% above (below) everything around it, and not in a bright area, where
             the data piles up against the clip point and ordinary detail looks like a spike */
          if (hot ? (v < 1.3 * mx) : (v > 0.7 * mn)) continue;
          if ((hot ? mx : mn) > 0.6) continue;
          for (let k = 0; k < 8; k++) ring[k] = P[i + o[k]];
          ring.sort();
          const med = 0.5 * (ring[3] + ring[4]);
          const adj = 0.25 * (P[i - 1] + P[i + 1] + P[i - W] + P[i + W]);
          if (hot ? (adj - med >= 0.5 * (v - med)) : (med - adj >= 0.5 * (med - v))) continue;   // a real point of light, not a fault
          cand.push(i, c, med);
          if (cand.length > limit * 3) { tooMany = true; break; }
        }
        if (tooMany) break;
      }
      if ((y & 127) === 0) yield y / H;
    }
    if (!tooMany) break;
    boost *= 1.6;                                          // a very noisy frame: ask for more before calling it a fault
  }
  const idx = [], old = [], nw = [];
  const touch = (i, c, val) => { idx.push(i * 3 + c); old.push(P3[c][i]); nw.push(val); P3[c][i] = val; };   // applied as it is found so a neighbour sees it
  const done = [];
  for (let n = 0; n < cand.length; n += 3) {
    const i = cand[n], c = cand[n + 1], med = cand[n + 2], P = P3[c], v = P[i], hot = v > med;
    touch(i, c, med);
    done.push(i, c, hot ? 1 : 0);
    const s = Math.max(sig[c], 0.0007);
    for (let k = 0; k < 8; k++) {                          // the touching pixels: no higher (lower) than their own surroundings
      const q = i + [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1][k];
      if (q < 3 * W + 3 || q >= (H - 3) * W - 3) continue;
      for (let r = 0; r < 8; r++) ring[r] = P[q + o[r]];
      ring.sort();
      const qm = 0.5 * (ring[3] + ring[4]);
      if (hot) { if (P[q] > qm + 3 * s) touch(q, c, qm + 3 * s); } else if (P[q] < qm - 3 * s) touch(q, c, qm - 3 * s);
    }
  }
  // put the planes back as they were: rcApply writes them
  for (let n = idx.length - 1; n >= 0; n--) P3[idx[n] % 3][(idx[n] / 3) | 0] = old[n];
  return { idx: Int32Array.from(idx), old: Float32Array.from(old), nw: Float32Array.from(nw), found: done.length / 3 };
}

/* The same, driven to the end without pausing (the self-test uses this), or paused every so often so the page can paint. */
function rcFindHot(P3, W, H) { const g = rcFindHotGen(P3, W, H); let r; while (!(r = g.next()).done); return r.value; }
async function rcFindHotAsync(P3, W, H, tick) { const g = rcFindHotGen(P3, W, H); let r; while (!(r = g.next()).done) { if (tick) await tick(r.value); } return r.value; }

/* One axis of line noise: for the lines of one plane (rows when `rows`, columns otherwise), the offset to take off each
   line. Returns a Float32Array of the line count, zeros where nothing should change. */
function rcLineOffsets(P, W, H, rows, sigN) {
  const N = rows ? H : W, M = rows ? W : H, ls = rows ? W : 1, ps = rows ? 1 : W;   // line stride, step along a line
  const e = new Float32Array(N), samples = Math.max(8, Math.min(M - 8, 600)), step = Math.max(1, Math.floor((M - 8) / samples));
  const buf = new Float32Array(samples + 2);
  const bufB = new Float32Array(samples + 2);
  for (let l = 3; l < N - 3; l++) {
    let n = 0, nb = 0;
    for (let p = 4; p < M - 4; p += step) {
      const i = l * ls + p * ps;
      const m = (P[i - ls] + P[i + ls] + P[i - 2 * ls] + P[i + 2 * ls] + P[i - 3 * ls] + P[i + 3 * ls]) / 6;
      if (p < M / 2) buf[n++] = P[i] - m; else bufB[nb++] = P[i] - m;
    }
    /* a stripe runs the whole length of the line, so both halves have to find it: an offset only one half sees is picture
       content (a branch, a roof edge), and where they disagree in sign there is nothing to correct */
    const a = n ? rcSortedMedian(buf, n) : 0, c = nb ? rcSortedMedian(bufB, nb) : 0;
    e[l] = (a * c > 0) ? (a > 0 ? Math.min(a, c) : Math.max(a, c)) : 0;
  }
  // the estimate for a line is its own offset minus the mean of its six neighbours', so undo that mixing
  let b = Float32Array.from(e);
  for (let it = 0; it < 6; it++) {
    const nb = new Float32Array(N);
    for (let l = 0; l < N; l++) {
      let s = 0, cnt = 0;
      for (let k = -3; k <= 3; k++) { if (!k) continue; const q = l + k; if (q >= 0 && q < N) { s += b[q]; cnt++; } }
      nb[l] = e[l] + (cnt ? s / cnt : 0);
    }
    b = nb;
  }
  // only the fast part: take out what changes slowly along the frame (shading, a gradient)
  const hp = new Float32Array(N), R = 16;
  for (let l = 0; l < N; l++) { let s = 0, cnt = 0; for (let q = Math.max(0, l - R); q <= Math.min(N - 1, l + R); q++) { s += b[q]; cnt++; } hp[l] = b[l] - s / cnt; }
  const dev = new Float32Array(N); for (let l = 0; l < N; l++) dev[l] = Math.abs(hp[l]);
  const sg = 1.4826 * rcSortedMedian(dev.slice(), N);
  const out = new Float32Array(N);
  out.sg = sg;
  /* the estimate of one line is itself uncertain by about 0.045 x the frame's noise (a few hundred samples per half; a
     frame with no stripes measures 0.04 to 0.05), so a spread among the lines under twice that is the estimate's own noise,
     not stripes: leave the picture alone */
  if (!(sg > Math.max(0.0002, 0.09 * (sigN || 0)))) return out;
  for (let l = 0; l < N; l++) out[l] = (Math.abs(hp[l]) <= 4.5 * sg) ? hp[l] : 0;   // a bigger step is a real edge across the frame
  return out;
}

/* Find everything for a decode (res.R/G/B at full size). Returns the record rcApply works from. */
async function rcFindAll(res, tick) {
  const W = res.width, H = res.height, P3 = [res.R, res.G, res.B];
  const hot = await rcFindHotAsync(P3, W, H, tick ? (f => tick(0.5 * f)) : null);
  rcApply(P3, W, H, { hot: hot, line: null }, 1);            // the stripes are judged with the faults already gone
  const line = { ro: [], co: [] };
  try {
    for (let c = 0; c < 3; c++) {
      const sn = rcPlaneSigma(P3[c], W, H);
      line.ro.push(rcLineOffsets(P3[c], W, H, true, sn));
      line.co.push(rcLineOffsets(P3[c], W, H, false, sn));
      if (tick) await tick(0.5 + 0.5 * (c + 1) / 3);
    }
  } finally { rcApply(P3, W, H, { hot: hot, line: null }, -1); }
  let rowsFixed = 0, colsFixed = 0;
  for (let c = 0; c < 3; c++) { for (const v of line.ro[c]) if (v) rowsFixed++; for (const v of line.co[c]) if (v) colsFixed++; }
  let amp = 0; for (let c = 0; c < 3; c++) { for (const v of line.ro[c]) amp = Math.max(amp, Math.abs(v)); for (const v of line.co[c]) amp = Math.max(amp, Math.abs(v)); }
  return { hot: hot, line: line, hotCount: hot.found, lineCount: rowsFixed + colsFixed, lineAmp: amp };
}

/* dir = +1 puts the fix on the planes, -1 takes it off again. */
function rcApply(P3, W, H, fix, dir) {
  const h = fix.hot;
  if (dir > 0) {
    if (h) for (let n = 0; n < h.idx.length; n++) P3[h.idx[n] % 3][(h.idx[n] / 3) | 0] = h.nw[n];
    if (fix.line) for (let c = 0; c < 3; c++) {
      const P = P3[c], ro = fix.line.ro[c], co = fix.line.co[c];
      for (let y = 0; y < H; y++) { const r = ro[y], b = y * W; for (let x = 0; x < W; x++) P[b + x] -= r + co[x]; }
    }
  } else {
    if (fix.line) for (let c = 0; c < 3; c++) {
      const P = P3[c], ro = fix.line.ro[c], co = fix.line.co[c];
      for (let y = 0; y < H; y++) { const r = ro[y], b = y * W; for (let x = 0; x < W; x++) P[b + x] += r + co[x]; }
    }
    if (h) for (let n = h.idx.length - 1; n >= 0; n--) P3[h.idx[n] % 3][(h.idx[n] / 3) | 0] = h.old[n];
  }
}

/* ---------- the tick box ---------- */
function rawFixWanted() { const e = $('rawFix'); return !!e && +e.value === 1; }
function syncRawFixTick() {
  const c = $('rawFixChk'); if (c) c.checked = rawFixWanted();
  if (!rawFixWanted() && $('rawFixStatus') && !(rawEngine.lastResult && rawEngine.lastResult.__fixBusy)) $('rawFixStatus').textContent = '';
}
async function rawFixRun() {
  const res = rawEngine.lastResult;
  if (!res || rawEngine.lastGen !== loadToken || res.__fixBusy) return;
  const want = rawFixWanted(), token = loadToken, st = $('rawFixStatus');
  res.__fixBusy = true;
  try {
    if (want && !res.__fix) {
      if (st) st.textContent = 'Looking…';
      await new Promise(r => setTimeout(r, 30));
      res.__fix = await rcFindAll(res, async f => { if (st) st.textContent = 'Looking… ' + Math.round(f * 100) + '%'; await new Promise(r => setTimeout(r, 0)); });
    }
    if (token !== loadToken || rawEngine.lastResult !== res) return;
    const P3 = [res.R, res.G, res.B];
    if (want && !res.__fixOn) rcApply(P3, res.width, res.height, res.__fix, 1);
    else if (!want && res.__fixOn) rcApply(P3, res.width, res.height, res.__fix, -1);
    res.__fixOn = want;
    res.__ds = null; rawEngine.nrPrev = null; rawEngine.fullKey = null; rawEngine.builtNr = 'fix';   // everything built from the old data is stale
    if (st) {
      const f = res.__fix;
      st.textContent = !want ? '' : (!f || (!f.hotCount && !f.lineCount)) ? 'Nothing found'
        : [f.hotCount ? f.hotCount + ' pixel' + (f.hotCount === 1 ? '' : 's') : '', f.lineCount ? 'stripes' : ''].filter(Boolean).join(' + ') + ' fixed';
    }
  } catch (e) {
    console.warn('hot pixel cleanup', e);
    if (st) st.textContent = 'Failed';
    const t = $('rawFix'), c = $('rawFixChk'); if (t) t.value = '0'; if (c) c.checked = false;
  } finally { res.__fixBusy = false; }
  if (token === loadToken && typeof reapplyCamSpaceSwap === 'function') reapplyCamSpaceSwap();
}
