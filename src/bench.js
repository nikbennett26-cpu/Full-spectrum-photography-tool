'use strict';
/* irlab editor: src/bench.js — the speed test, opened with ?bench (irlab.uk/?bench). Built into editor-bench.js and
   fetched only then, like the self-test. It changes nothing for anyone else and never touches the saved session
   (?bench counts as a self-test run for that: see SELFTEST in i18n.js).

   It opens a made-up 2048 × 1365 photo through the ordinary loader, then times the photo engine on this device:
   how long one finished frame takes at full working size and at the half size used while a slider is held, with
   each kind of edit on its own and all together; how much page time one slider movement costs; and how long the
   histogram waits for its copy. A finished frame is timed by asking for one pixel back, which only answers once
   the graphics chip has drawn everything before it. The numbers go in a box with a Copy button. */

const BENCH_QUICK = /[?&]bench=quick(&|$)/.test(location.search);   // a small photo, for checking the test itself on a slow machine
const BENCH_W = BENCH_QUICK ? 384 : 2048, BENCH_H = BENCH_QUICK ? 256 : 1365;

function benchPhoto() {
  // a busy scene, so no part of the pipeline gets an easy flat image: gradients, foliage-like noise, hard edges
  const cv = document.createElement('canvas'); cv.width = BENCH_W; cv.height = BENCH_H;
  const cx = cv.getContext('2d'), id = cx.createImageData(BENCH_W, BENCH_H), d = id.data;
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < BENCH_H; y++) {
    const t = y / BENCH_H;
    for (let x = 0; x < BENCH_W; x++) {
      const i = (y * BENCH_W + x) * 4, n = rnd() * 40 - 20, s = Math.sin(x * 0.013) * Math.cos(y * 0.017) * 30;
      if (t < 0.38) { d[i] = 70 + 60 * t + n * 0.3; d[i + 1] = 90 + 80 * t + n * 0.3; d[i + 2] = 170 - 40 * t + n * 0.3; }
      else if (t < 0.75) { d[i] = 190 + s + n; d[i + 1] = 120 + s * 0.6 + n; d[i + 2] = 200 + s * 0.4 + n; }
      else { const v = 110 + s + n * 0.6; d[i] = v; d[i + 1] = v * 0.97; d[i + 2] = v * 0.95; }
      d[i + 3] = 255;
    }
  }
  cx.putImageData(id, 0, 0);
  const k = BENCH_W / 2048;
  cx.fillStyle = '#f4f1ea'; cx.fillRect(900 * k, 300 * k, 260 * k, 700 * k);   // a bright building edge
  cx.fillStyle = '#121212'; cx.fillRect(1180 * k, 520 * k, 40 * k, 480 * k);
  return cv;
}

function benchDevice() {
  const o = { page: location.origin + location.pathname, build: window.IRLAB_BUILD || '', ua: navigator.userAgent,
    cores: navigator.hardwareConcurrency || '?', memoryGB: navigator.deviceMemory || '?', dpr: window.devicePixelRatio || 1,
    screen: screen.width + '×' + screen.height, viewport: innerWidth + '×' + innerHeight };
  try {
    const gl = engine && engine.gl, ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    o.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : 'no WebGL');
    o.gpuVendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : '';
    o.webgl2 = !!(engine && engine.isWebGL2);
    o.maxTexture = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
    o.floatTargets = !!(gl && gl.getExtension('EXT_color_buffer_float'));
    o.parallelCompile = !!(gl && gl.getExtension('KHR_parallel_shader_compile'));
    o.liteSource = typeof SRC_LITE_ON !== 'undefined' ? !!SRC_LITE_ON : '?';
  } catch (e) { o.gpu = 'unknown (' + e.message + ')'; }
  return o;
}

const benchWait = ms => new Promise(r => setTimeout(r, ms));
const benchFrame = () => new Promise(r => requestAnimationFrame(() => r()));

function benchSet(id, v) {
  const e = $(id); if (!e) return false;
  e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/* one finished frame, in ms: draw, then ask for a single pixel (that waits for the chip). The first draw after a
   change is left out of the average: it may build cached passes once. */
function benchTime(draw, n) {
  const gl = engine.gl, px = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  draw(); finish();
  const times = [];
  for (let i = 0; i < n; i++) { const a = performance.now(); draw(); finish(); times.push(performance.now() - a); }
  times.sort((a, b) => a - b);
  return { median: +times[times.length >> 1].toFixed(1), best: +times[0].toFixed(1), worst: +times[times.length - 1].toFixed(1) };
}

const BENCH_SCENES = [
  ['No edits', {}],
  ['Channel swap (R↔B)', { swap: true }],
  ['Contrast, saturation, vibrance', { contrast: 25, sat: 20, vibrance: 20 }],
  ['Highlights and shadows', { highlights: -50, shadows: 40 }],
  ['Clarity', { clarity: 40 }],
  ['Dehaze', { dehaze: 35 }],
  ['Noise reduction', { noiseReduction: 40, noiseColour: 40 }],
  ['Sharpening', { sharpen: 60 }],
  ['Glow (Orton) and halation', { orton: 40, halation: 40 }],
  ['All of the above', { swap: true, contrast: 25, sat: 20, vibrance: 20, highlights: -50, shadows: 40, clarity: 40, dehaze: 35, noiseReduction: 40, noiseColour: 40, sharpen: 60, orton: 40, halation: 40 }],
];

async function runBench() {
  const box = document.createElement('div');
  box.id = 'benchBox';
  box.style.cssText = 'position:fixed;inset:auto 16px 16px auto;z-index:100000;width:min(700px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;'
    + 'padding:18px 18px 16px;border-radius:16px;background:rgba(14,14,17,.96);border:1px solid rgba(255,255,255,.12);box-shadow:0 20px 60px -10px rgba(0,0,0,.85);'
    + 'color:#f3f0ea;font:13px/1.5 InterVariable,Inter,system-ui,sans-serif';
  box.innerHTML = '<div style="font-size:15px;font-weight:600;margin-bottom:2px">irlab speed test</div>'
    + '<div id="benchStatus" style="color:#b7b2a9">Starting… keep this tab in front until it finishes (about a minute).</div>'
    + '<pre id="benchOut" style="display:none;margin:12px 0 0;padding:12px;border-radius:10px;background:#08080a;border:1px solid rgba(255,255,255,.08);white-space:pre-wrap;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#d8d4cc"></pre>'
    + '<div id="benchBtns" style="display:none;margin-top:12px;gap:8px"><button type="button" id="benchCopy" style="min-height:36px;padding:0 16px;border:0;border-radius:10px;background:#d63a3a;color:#fff;font:600 13px InterVariable,Inter,system-ui,sans-serif;cursor:pointer">Copy results</button></div>';
  document.body.appendChild(box);
  const status = t => { $('benchStatus').textContent = t; };
  const R = { when: new Date().toISOString() };
  try {
    window.__selftestRunning = true;
    status('Opening the test photo…');
    const cv = benchPhoto();
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const t0 = performance.now();
    await loadFile(new File([blob], 'irlab-speed-test.png', { type: 'image/png' }));
    for (let i = 0; i < 300 && !(loadedImage && engine && document.body.classList.contains('has-image')); i++) await benchWait(50);
    if (!engine) throw new Error('the photo engine did not start');
    await benchFrame(); await benchFrame();
    { const gl = engine.gl, px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    R.openToFirstFrameMs = Math.round(performance.now() - t0);
    R.device = benchDevice();
    R.canvas = engine.canvas.width + '×' + engine.canvas.height;
    await benchWait(2500);   // let the background work after opening finish (tone maps, first histogram)

    R.frames = [];
    for (let k = 0; k < BENCH_SCENES.length; k++) {
      const [name, spec] = BENCH_SCENES[k];
      status('Timing ' + (k + 1) + ' of ' + BENCH_SCENES.length + ': ' + name + '…');
      resetAllControls();
      if (spec.swap) { const b = document.querySelector('.swapBtn[data-perm="210"]') || [...document.querySelectorAll('.swapBtn[data-perm]')].find(x => x.dataset.perm !== '012'); if (b) b.click(); }
      for (const id in spec) if (id !== 'swap') benchSet(id, spec[id]);
      await benchWait(600); await benchFrame();
      const P = currentParams();
      const reps = BENCH_QUICK ? 2 : 6;
      const full = benchTime(() => engine.render(P), reps);
      const half = engine.renderScaled ? benchTime(() => engine.renderScaled(P, 0.5), reps) : null;
      const fitted = engine._active && engine._base && engine._active !== engine._base;
      R.frames.push({ name, fitted, fullMs: full.median, fullFps: +(1000 / Math.max(full.median, 0.1)).toFixed(0), halfMs: half ? half.median : null, worstFullMs: full.worst });
      await benchFrame();
    }
    resetAllControls(); await benchWait(400);
    // the fitted programs (build 401): how many were built and how long one took to compile here
    if (engine._variants) {
      const ms = [...engine._variants.values()].filter(v => v.state === 'ready' && v.ms != null).map(v => v.ms).sort((a, b) => a - b);
      R.fitted = { built: ms.length, compileMedianMs: ms.length ? ms[ms.length >> 1] : null, compileWorstMs: ms.length ? ms[ms.length - 1] : null,
        background: !!engine._vPar };
    }

    // page time for one slider movement while dragging (the GPU is not waited for here)
    status('Timing slider handling…');
    const sl = $('contrast'), lens = [];
    sl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    for (let i = 0; i < 40; i++) { sl.value = 10 + (i % 20) * 2; const a = performance.now(); sl.dispatchEvent(new Event('input', { bubbles: true })); lens.push(performance.now() - a); await benchFrame(); }
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
    sl.dispatchEvent(new Event('change', { bubbles: true }));
    lens.sort((a, b) => a - b);
    R.sliderInputMs = { median: +lens[20].toFixed(2), worst: +lens[39].toFixed(2) };
    await benchWait(500);

    // histogram copy: how long until it arrives, and how long the page itself is held
    status('Timing the histogram copy…');
    if (engine.readSmallAsync) {
      engine.render(currentParams());
      const a = performance.now(); let held = 0;
      await new Promise(res => { const s = performance.now(); engine.readSmallAsync(320, 213, () => res()); held = performance.now() - s; });
      R.histogram = { readyAfterMs: Math.round(performance.now() - a), pageHeldMs: +held.toFixed(1) };
    }
    resetAllControls();
  } catch (e) {
    R.error = String(e && e.message || e);
  } finally {
    window.__selftestRunning = false;
  }

  const lines = [];
  lines.push('irlab speed test · build ' + (R.device ? R.device.build : '') + ' · ' + R.when);
  if (R.device) {
    const d = R.device;
    lines.push('GPU: ' + d.gpu + (d.gpuVendor ? ' (' + d.gpuVendor + ')' : ''));
    lines.push('Device: ' + d.cores + ' cores, ' + d.memoryGB + ' GB, screen ' + d.screen + ' @' + d.dpr + 'x, window ' + d.viewport);
    lines.push('WebGL2 ' + d.webgl2 + ', float targets ' + d.floatTargets + ', parallel compile ' + d.parallelCompile + ', lite source ' + d.liteSource + ', max texture ' + d.maxTexture);
    lines.push('Browser: ' + d.ua);
  }
  if (R.error) lines.push('STOPPED: ' + R.error);
  if (R.openToFirstFrameMs) lines.push('Open to first frame: ' + R.openToFirstFrameMs + ' ms (photo ' + R.canvas + ')');
  if (R.frames && R.frames.length) {
    lines.push('');
    lines.push('Time for one finished frame         full size              half size (dragging)');
    R.frames.forEach(f => lines.push((f.fitted ? '* ' : '  ') + (f.name + ' ').padEnd(36, '.') + ' ' + String(f.fullMs).padStart(7) + ' ms ' + ('(' + f.fullFps + ' fps)').padStart(9) + '   ' + (f.halfMs == null ? '—' : String(f.halfMs).padStart(7) + ' ms')));
  }
  if (R.fitted) lines.push('* = fitted program. Built ' + R.fitted.built + ', compile ' + R.fitted.compileMedianMs + ' ms typical (worst ' + R.fitted.compileWorstMs + ' ms); in normal use ' + (R.fitted.background ? 'built in the background' : 'built while the page is resting (no background compiling here)'));
  if (R.sliderInputMs) lines.push('', 'Page time per slider movement: ' + R.sliderInputMs.median + ' ms (worst ' + R.sliderInputMs.worst + ' ms)');
  if (R.histogram) lines.push('Histogram copy ready after ' + R.histogram.readyAfterMs + ' ms; page held ' + R.histogram.pageHeldMs + ' ms');
  const text = lines.join('\n');
  window.__benchResults = { text, data: R };
  status(R.error ? 'The test stopped early. Copy what it has and send it over.' : 'Done. Copy the results and send them over.');
  const out = $('benchOut'); out.textContent = text; out.style.display = 'block';
  const btns = $('benchBtns'); btns.style.display = 'flex';
  $('benchCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); $('benchCopy').textContent = 'Copied'; }
    catch (e) { const r = document.createRange(); r.selectNodeContents(out); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $('benchCopy').textContent = 'Selected: press Ctrl+C'; }
  });
}

if (BENCH) { if (document.readyState === 'complete') setTimeout(runBench, 600); else window.addEventListener('load', () => setTimeout(runBench, 600)); }
