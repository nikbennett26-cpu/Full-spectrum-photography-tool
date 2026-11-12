'use strict';
/* irlab editor: js/engine.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

// --- WebGL Engine Class ---
class WebGLEngine {
  constructor(canvas) {
    this.canvas = canvas;
    /* Two other features genuinely depend on preserveDrawingBuffer -- the
       histogram (drawImage from this canvas on a debounced timer, not
       synchronously with render) and the fullscreen "Expand" preview (same
       drawImage-from-canvas technique, on demand whenever the user taps
       it) -- both read the canvas well after the frame that drew it, not
       in the same call stack the way readPixels() does. Removing this
       outright breaks both; it has to be attempted first, not dropped. See
       hasPreserveBuffer below for what happens when a device can't have it. */
    let attrs = { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false };
    /* WebGL2 first, purely for the high-precision export path: a renderable
       RGBA16F colour attachment is a WebGL2 feature (via
       EXT_color_buffer_half_float / EXT_color_buffer_float), and WebGL1's
       equivalent is unreliable enough across drivers not to be worth
       trusting with someone's export. The shader is deliberately still
       GLSL ES 1.00, which WebGL2 accepts unchanged, so there is exactly one
       shader to maintain and the WebGL1 fallback is a true fallback rather
       than a second code path. */
    this.gl = canvas.getContext('webgl2', attrs);
    this.hasPreserveBuffer = !!this.gl;
    /* preserveDrawingBuffer is a real, documented cause of WebGL2 context
       creation silently failing on some mobile GPU drivers -- confirmed
       directly: a Galaxy S25 (Snapdragon 8 Elite/Xclipse, hardware that
       should have no trouble with WebGL2 at all) got a context with no
       options and failed specifically with this app's own attrs. Retried
       here without it before giving up on WebGL2 entirely -- getting
       WebGL2's other real benefits (the float-precision fix chief among
       them) on a device like that is worth histogram/Expand falling back
       to a lower-fidelity readback, over losing WebGL2 altogether for a
       setting two secondary features want but nothing essential needs. */
    if (!this.gl) {
      attrs = { antialias: false, premultipliedAlpha: false };
      this.gl = canvas.getContext('webgl2', attrs);
      this.hasPreserveBuffer = false;
    }
    this.isWebGL2 = !!this.gl;
    if (!this.gl) { this.gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false }); this.hasPreserveBuffer = !!this.gl; }
    // Previously this alerted and then carried straight on into initShaders(),
    // which immediately threw on the null context — a confusing double
    // failure. Bail here instead so the caller sees one clear error.
    if (!this.gl) { alert('WebGL unsupported in this browser'); throw new Error('no WebGL context'); }

    /* A GL context is not permanent. Browsers cap how many can exist at once
       and evict the oldest, phones drop them under memory pressure or when
       the tab is backgrounded, and drivers reset them. When that happens every
       later draw call is silently ignored — no exception, no console error,
       the canvas just stops updating. From the outside that is exactly
       "I picked a file, it acknowledged, and nothing happened", because the
       load genuinely did succeed; only the drawing was gone.
       preventDefault on the loss event is what makes the browser willing to
       hand back a working context afterwards. */
    this.contextLost = false;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      console.warn('WebGL context lost');
      if (typeof toast === 'function') toast('Graphics context lost \u2014 restoring\u2026');
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('WebGL context restored, rebuilding');
      try {
        this.texture = null; this.lutTex = null; this.lutPreTex = null; this.hellwigVWTex = null; this._prep = null; this._prepKey = null;
        /* Build 277: EVERY handle the old context gave out is dead, and each cache below otherwise believed its table was
           still uploaded. The tone curve was the visible one: after switching to another app on a phone (Android takes
           the graphics memory back), any curve, the film's contrast from Digital Aerochrome included, drew from an empty
           table and the photo went black until the page was reloaded. Clearing the handles AND the keys that say what
           was uploaded makes each one build itself again on the next frame. */
        this.curveTex = null; this._curveKey = null;
        this.skyTex = null; this.skyColTex = null; this._skyId = null; this._skyColId = null;
        this.epdTex = null; this._epdId = null; this._toneMaps = null; this.toneBase = null; this._toneFail = false;
        this._rd = null; this._rdFail = false;
        this._bg = null; this._sg = null; this._og = null; this._lo = null; this._blit = null;
        if (this._rsa) Object.keys(this._rsa).forEach(k => { this._rsa[k].gen++; });   // build 397: callbacks still waiting on the old context never run
        this._rs = null; this._rsa = null; this._rsFail = false; this._rsaFail = false;   // the histogram's small copies and read buffers
        this._texGen = (this._texGen || 0) + 1;
        /* Buffers as well as shaders. A lost context takes EVERY GL object
           with it, and the vertex quad every draw call reads from lives in
           initBuffers, not initShaders — rebuilding only the shaders left a
           valid program with nothing to draw, so the canvas stayed blank
           while every flag said it had recovered. */
        this.initShaders();
        this.initBuffers();
        this.setupHellwigVWTexture();
        this.contextLost = false;
        // everything the context was holding has to go back up: the image
        // itself, then both LUT slots, then a redraw
        if (typeof rawCanvas !== 'undefined' && rawCanvas) this.setImage(typeof dustPrepare === 'function' ? dustPrepare(rawCanvas) : rawCanvas);
        if (typeof currentLUT !== 'undefined') this.setLUT(currentLUT);
        if (typeof decodeFilmLUT === 'function') this.setLUTPre(decodeFilmLUT());
        if (typeof render === 'function') render();
        if (typeof toast === 'function') toast('Graphics restored');
      } catch (err) {
        console.warn('Context restore failed:', err);
        if (typeof toast === 'function') toast('Graphics could not be restored \u2014 reload the page');
      }
    }, false);

    // Renderable half-float colour buffer = the whole basis of 16-bit export.
    this.hiPrec = this.isWebGL2 &&
      !!(this.gl.getExtension('EXT_color_buffer_half_float') || this.gl.getExtension('EXT_color_buffer_float'));

    this.initShaders();
    this.initBuffers();
    this.texture = null;
    this.lutTex = null;
    this.lutSize = 0;
    this.lutDomainMin = [0, 0, 0];
    this.lutDomainMax = [1, 1, 1];
    this.hellwigVWTex = null;
    this.setupHellwigVWTexture();
  }

  // Uploads the fixed Vibrance-weight lookup once, at construction (and
  // again after a lost context -- see that handler above). Built from the
  // exact same HELLWIG_VW_LUT the JS/CPU path (hueSatF) already computed,
  // not a second, separate computation of the same numbers -- one source
  // of truth for both render paths, so they can't quietly drift apart the
  // way the two would if this were recomputed independently here.
  setupHellwigVWTexture() {
    const gl = this.gl;
    if (typeof HELLWIG_VW_LUT === 'undefined' || typeof HELLWIG_LUT_N === 'undefined') return;
    const N = HELLWIG_LUT_N, w = N * N, h = N;
    const px = new Uint8Array(w * h * 4);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const s = (z*N + y)*N + x;   // matches HELLWIG_VW_LUT's own (ri*N+gi)*N+bi indexing
      const d = (y * w + z * N + x) * 4;
      const v = Math.max(0, Math.min(255, Math.round(HELLWIG_VW_LUT[s] * 255)));
      px[d] = v; px[d+1] = v; px[d+2] = v; px[d+3] = 255;
    }
    this.hellwigVWTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.hellwigVWTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);
  }

  initShaders() {
    const gl = this.gl;
    // Compile status was never checked. A shader that fails on one vendor's
    // driver produced a silently black canvas with nothing in the console —
    // the single worst class of bug to diagnose remotely. Now it throws with
    // the driver's own error text and line number.
    const compile = (type, src, what) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(what + ' shader failed to compile: ' + log);
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VS_SOURCE, 'vertex');
    const fs = compile(gl.FRAGMENT_SHADER, fsSource(), 'fragment');

    this.program = gl.createProgram();
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('shader program failed to link: ' + gl.getProgramInfoLog(this.program));
    }
    gl.useProgram(this.program);
    // shader objects are retained by the linked program; drop our references
    gl.deleteShader(vs); gl.deleteShader(fs);

    this.uLocs = {
      image: this._vl('u_image'),
      lut: this._vl('u_lut'),
      lutPre: this._vl('u_lutPre'),
      lutPreSize: this._vl('u_lutPreSize'),
      lutPreMix: this._vl('u_lutPreMix'),
      hellwigVW: this._vl('u_hellwigVW'),
      lutSize: this._vl('u_lutSize'),
      lutMix: this._vl('u_lutMix'),
      texelSize: this._vl('u_texelSize'),
      clipView: this._vl('u_clipView'),
      cmykWarn: this._vl('u_cmykWarn'),
      gamutDrag: this._vl('u_gamutDrag'),
      dither: this._vl('u_dither'), dustView: this._vl('u_dustView'),
      deband: this._vl('u_deband'), debandRad: this._vl('u_debandRad'),
      caR: this._vl('u_caR'),
      caB: this._vl('u_caB'),
      hotspot: this._vl('u_hotspot'),
      hotSize: this._vl('u_hotSize'),
      curve: this._vl('u_curve'),
      curveOn: this._vl('u_curveOn'),
      curveLum: this._vl('u_curveLum'),
      epdOn: this._vl('u_epdOn'), epdProbe: this._vl('u_epdProbe'),
      epdTemp: this._vl('u_epdTemp'), epdBoost: this._vl('u_epdBoost'),
      epdS: this._vl('u_epdS'), epdNorm: this._vl('u_epdNorm'),
      epdBase: this._vl('u_epdBase'), tbOn: this._vl('u_tbOn'), dhOn: this._vl('u_dhOn'), epdRef: this._vl('u_epdRef'),
      maskN: this._vl('u_maskN'),
      maskProbe: this._vl('u_maskProbe'), maskGuideOn: this._vl('u_maskGuideOn'),
      maskGuide: this._vl('u_maskGuide'), mGuideTexel: this._vl('u_mGuideTexel'),
      maskView: this._vl('u_maskView'),
      mGeom: this._vl('u_mGeom[0]'),
      mInfo: this._vl('u_mInfo[0]'),
      mAdj: this._vl('u_mAdj[0]'),
      mAdj2: this._vl('u_mAdj2[0]'),
      bandPreview: this._vl('u_bandPreview'),
      lutDomainMin: this._vl('u_lutDomainMin'),
      lutDomainMax: this._vl('u_lutDomainMax'),
      matrix: this._vl('u_matrix'),
      mOffset: this._vl('u_mOffset'),
      polyMix: this._vl('u_polyMix'),
      irMix: this._vl('u_irMix'),
      irS: this._vl('u_irS'),
      irL: this._vl('u_irL'),
      irX: this._vl('u_irX'),
      polyEps: this._vl('u_polyEps'),
      polyS: this._vl('u_polyS'),
      polyL: this._vl('u_polyL'),
      polyX: this._vl('u_polyX'),
      camFit: this._vl('u_camFit'),
      camCoef: this._vl('u_camCoef'),
      bandCount: this._vl('u_bandCount'),
      bandHue: this._vl('u_bandHue'),
      bandWidth: this._vl('u_bandWidth'),
      bandDH: this._vl('u_bandDH'),
      bandDS: this._vl('u_bandDS'),
      bandLo: this._vl('u_bandLo'),
      bandHi: this._vl('u_bandHi'),
      bandSelectivity: this._vl('u_bandSelectivity'),
      bandAB: this._vl('u_bandAB'),
      irSub: this._vl('u_irSub'), irSubOn: this._vl('u_irSubOn'),
      srcGuide: this._vl('u_srcGuide'), srcGuideTexel: this._vl('u_srcGuideTexel'),
      srcGuideOn: this._vl('u_srcGuideOn'), srcProbe: this._vl('u_srcProbe'),
      ortonOn: this._vl('u_ortonOn'), ortonProbe: this._vl('u_ortonProbe'), orton: this._vl('u_orton'),
      ortonBias: this._vl('u_ortonBias'), halation: this._vl('u_halation'), halBias: this._vl('u_halBias'), ortonTex: this._vl('u_ortonTex'), ortonInv: this._vl('u_ortonInv'), ortonTexel: this._vl('u_ortonTexel'),
      bandPC: this._vl('u_bandPC'),
      bandDL: this._vl('u_bandDL'),
      preWB: this._vl('u_preWB'),
      postWB: this._vl('u_postWB'),
      preWBM: this._vl('u_preWBM'),
      postWBM: this._vl('u_postWBM'),
      wbMethod: this._vl('u_wbMethod'),
      hueSpace: this._vl('u_hueSpace'),
      lumPreserve: this._vl('u_lumPreserve'),
      lumaW: this._vl('u_lumaW'),
      tempTint: this._vl('u_tempTint'),
      satPreserve: this._vl('u_satPreserve'),
      wide: this._vl('u_wide'),
      contrast: this._vl('u_contrast'),
      exposure: this._vl('u_exposure'),
      brightness: this._vl('u_brightness'),
      hue: this._vl('u_hue'),
      sat: this._vl('u_sat'),
      vibrance: this._vl('u_vibrance'),
      blackPt: this._vl('u_blackPt'),
      whitePt: this._vl('u_whitePt'),
      noiseReduction: this._vl('u_noiseReduction'),
      inputLinear: this._vl('u_inputLinear'),
      hlRecover: this._vl('u_hlRecover'),
      sharpen: this._vl('u_sharpen'),
      sharpenRadius: this._vl('u_sharpenRadius'),
      sharpenMask: this._vl('u_sharpenMask'),
      noiseColour: this._vl('u_noiseColour'),
      nrScale: this._vl('u_nrScale'),
      contrastPivot: this._vl('u_contrastPivot'),
      hiPivot: this._vl('u_hiPivot'),
      hslOn: this._vl('u_hslOn'), skyDeep: this._vl('u_skyDeep'), crimson: this._vl('u_crimson'), skyLab: this._vl('u_skyLab'), skyCol: this._vl('u_skyCol'), maskSize: this._vl('u_maskSize'), skyL: this._vl('u_skyL'), skyShow: this._vl('u_skyShow'), skyMask: this._vl('u_skyMask'),
      bandProbe: this._vl('u_bandProbe'), bandGuideOn: this._vl('u_bandGuideOn'), bandGuide: this._vl('u_bandGuide'), guideTexel: this._vl('u_guideTexel'),
      hslH0: this._vl('u_hslH0'), hslH1: this._vl('u_hslH1'),
      hslS0: this._vl('u_hslS0'), hslS1: this._vl('u_hslS1'),
      hslL0: this._vl('u_hslL0'), hslL1: this._vl('u_hslL1'),
      shW: this._vl('u_shW'),
      filmTone: this._vl('u_filmTone'),
      indexMode: this._vl('u_indexMode'),
      highlights: this._vl('u_highlights'),
      shadows: this._vl('u_shadows'),
      clarity: this._vl('u_clarity'),
      dehaze:  this._vl('u_dehaze'),
      calRH:    this._vl('u_calRH'),
      calGH:    this._vl('u_calGH'),
      calBH:    this._vl('u_calBH'),
      calRS:    this._vl('u_calRS'),
      calGS:    this._vl('u_calGS'),
      calBS:    this._vl('u_calBS'),
      calST:    this._vl('u_calST'),
      swapSpace: this._vl('u_swapSpace'),
      swapT: this._vl('u_swapT'),
      swapTi: this._vl('u_swapTi'),
      vigAmt: this._vl('u_vigAmt'),
      vigFall: this._vl('u_vigFall'),
      vigSpread: this._vl('u_vigSpread'),
      vigCentre: this._vl('u_vigCentre'),
      aspect: this._vl('u_aspect'),
      prep: this._vl('u_prep'),
      prepped: this._vl('u_prepped'),
      src: this._vl('u_src')
    };
    this._variantInit();
  }

  /* ---------------------------------------------------------------------------------------------------------------
     Build 401: programs fitted to the edit.

     The editor's main shader carries every effect, each behind a test such as "if (u_clarity > 0.0)". The speed test
     (?bench) showed a desktop graphics card spending the same 40 ms on a frame with no edits as with clarity, dehaze,
     noise reduction and the rest all on: on Windows the browser hands the shader to Direct3D, whose compiler often
     runs both sides of such a test. So, once the page is idle, a second copy of the program is compiled in which every
     setting that is exactly zero is written in as a fixed zero instead of a value to be supplied. The compiler can
     then see that the code behind each switched-off effect never runs, and leaves it out. Nothing else in the shader
     changes; a zero written in is the same zero the page would have supplied.

     How it fits in: uLocs hands out placeholders, not real uniform locations. While setUniforms runs, every value
     sent to a placeholder is only noted (newest value per name). Then the program for this set of values is chosen:
     the fitted copy if it is ready, the full program otherwise. It is made current and given every noted value (each
     program keeps its own). A value sent outside setUniforms (the glow probe's scale) goes straight to the current
     program. Fitted copies are compiled once drawing has paused: off the page's thread where the browser can
     (KHR_parallel_shader_compile); elsewhere (most phones) one at a time after a full second of rest with nothing
     touched (build 402, _variantIdle). Until one is ready the full program draws, exactly as before. ?vsync builds them at once instead (used by the self-test and the
     speed test, so both check the fitted copies). At most twelve are kept.
     --------------------------------------------------------------------------------------------------------------- */
  _vl(name) { return { __v: 1, n: name }; }
  _variantInit() {
    const gl = this.gl, eng = this;
    const progRec = (program) => { const locs = new Map(); return { program: program, used: 0, state: 'ready',
      loc(n) { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(program, n)); return locs.get(n); } }; };
    this._progRec = progRec;
    this._base = progRec(this.program);
    this._active = this._base;
    if (this._variants) this._variants.forEach(v => { try { if (v.program && v !== this._base) gl.deleteProgram(v.program); } catch (e) {} });
    this._variants = new Map();
    this._uLast = new Map();
    this._uRec = false;
    this._vRecent = [];
    this._vQueue = []; this._vIdleOn = false;
    this._vFail = false;
    if (!WebGLEngine._pointerWatch && typeof document !== 'undefined') {   // is a finger or button down anywhere on the page
      WebGLEngine._pointerWatch = true; WebGLEngine._pointerDown = false;
      document.addEventListener('pointerdown', () => { WebGLEngine._pointerDown = true; }, true);
      ['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => { WebGLEngine._pointerDown = false; }, true));
    }
    this._vSync = typeof location !== 'undefined' && /[?&](vsync|selftest|bench)(&|=|$)/.test(location.search);
    this._vPar = gl.getExtension('KHR_parallel_shader_compile');
    this._fsSrc = fsSource();
    // the plain number settings the fitted copies may write in: float, int and bool uniforms that are not arrays
    const types = {};
    for (const m of this._fsSrc.matchAll(/^\s*uniform\s+(float|int|bool)\s+([^;]+);/gm))
      m[2].split(',').forEach(x => { x = x.trim(); if (/^u_\w+$/.test(x)) types[x] = m[1]; });
    this._vTypes = types;
    if (!gl.__irVirtual) {
      gl.__irVirtual = true;
      ['uniform1f', 'uniform1i', 'uniform2f', 'uniform2i', 'uniform3f', 'uniform4f', 'uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv', 'uniform1iv',
       'uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv'].forEach(m => {
        const orig = gl[m];
        if (typeof orig !== 'function') return;
        gl[m] = function (loc) {
          if (loc && loc.__v === 1) {
            // typed arrays are copied: a caller may reuse its buffer, and the value is sent again on later frames
            const a = Array.prototype.slice.call(arguments, 1).map(x => (ArrayBuffer.isView(x) ? x.slice() : Array.isArray(x) ? x.slice() : x));
            eng._uLast.set(loc.n, [orig, a]);
            if (!eng._uRec) { const L = eng._active.loc(loc.n); if (L) orig.apply(gl, [L].concat(a)); }
            return;
          }
          return orig.apply(gl, arguments);
        };
      });
    }
  }
  _variantKey() {
    const zero = [];
    for (const [n, v] of this._uLast) {
      const t = this._vTypes[n];
      if (!t) continue;
      const a = v[1];
      if (a.length === 1 && a[0] === 0) zero.push(n);
      else if (a.length === 1 && a[0] === false) zero.push(n);
    }
    zero.sort();
    return zero.join(',');
  }
  _variantApply() {
    const gl = this.gl;
    let prog = this._base;
    this._vLastFrame = performance.now();
    if (!this._vFail) {
      try {
        const key = this._variantKey();
        if (key) {
          let v = this._variants.get(key);
          if (!v && this._vSync) v = this._variantBuild(key, true);
          if (v && v.state === 'compiling') this._variantPoll(v);
          if (v && v.state === 'ready') { prog = v; v.used = performance.now(); }
          else if (!v) this._variantWant(key);
        }
      } catch (e) { this._vFail = true; console.warn('fitted shader programs off:', e && e.message); prog = this._base; }
    }
    this._active = prog;
    gl.useProgram(prog.program);
    for (const [n, v] of this._uLast) { const L = prog.loc(n); if (L) v[0].apply(gl, [L].concat(v[1])); }
  }
  /* note a set of values that has no fitted copy yet; the copies for the last frame drawn are started once drawing has
     paused for half a second (a frame draws the main pass and its small probe passes, each with its own values) */
  _variantWant(key) {
    const now = performance.now();
    this._vRecent.push([key, now]);
    if (this._vRecent.length > 64) this._vRecent.splice(0, this._vRecent.length - 64);
    clearTimeout(this._vTimer);
    this._vTimer = setTimeout(() => {
      if (this.contextLost || this._vFail) return;
      if (typeof sliderDragging !== 'undefined' && sliderDragging) { this._variantWant(key); return; }
      const last = this._vRecent.length ? this._vRecent[this._vRecent.length - 1][1] : 0;
      const keys = new Set(this._vRecent.filter(r => r[1] >= last - 120).map(r => r[0]));
      this._vRecent = [];
      if (this._vPar) { keys.forEach(k => { if (!this._variants.has(k)) this._variantBuild(k, false); }); return; }
      /* build 402: a browser that cannot compile in the background (most phones) compiles on the page's own thread,
         which holds the page for the length of the compile (about 0.15 s on a recent phone). So it waits for a full
         second with no frame drawn and no finger or button down, builds one copy, and waits again for the next. */
      keys.forEach(k => { if (!this._variants.has(k) && this._vQueue.indexOf(k) < 0) this._vQueue.push(k); });
      this._variantIdle();
    }, 500);
  }
  _variantIdle() {
    if (this._vIdleOn || !this._vQueue.length) return;
    this._vIdleOn = true;
    const go = () => {
      this._vIdleOn = false;
      if (this.contextLost || this._vFail || !this._vQueue.length) return;
      const busy = (typeof sliderDragging !== 'undefined' && sliderDragging) || WebGLEngine._pointerDown ||
        performance.now() - (this._vLastFrame || 0) < 1000 || document.hidden;
      if (busy) { this._vIdleOn = true; setTimeout(() => { this._vIdleOn = false; this._variantIdle(); }, 400); return; }
      const k = this._vQueue.shift();
      if (!this._variants.has(k)) this._variantBuild(k, false);
      if (this._vQueue.length) setTimeout(() => this._variantIdle(), 300);
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 200);
  }
  _variantSource(key) {
    const fold = new Set(key.split(','));
    return this._fsSrc.replace(/^(\s*)uniform\s+(float|int|bool)\s+([^;]+);/gm, (all, ind, type, names) => {
      const list = names.split(',').map(x => x.trim());
      const keep = list.filter(x => !fold.has(x)), gone = list.filter(x => fold.has(x));
      if (!gone.length) return all;
      const zero = type === 'float' ? '0.0' : type === 'int' ? '0' : 'false';
      return (keep.length ? ind + 'uniform ' + type + ' ' + keep.join(', ') + ';\n' : '') + gone.map(x => ind + 'const ' + type + ' ' + x + ' = ' + zero + ';').join('\n');
    });
  }
  _variantBuild(key, sync) {
    const gl = this.gl;
    // keep at most twelve: drop the one used least recently
    if (this._variants.size >= 12) {
      let old = null;
      this._variants.forEach((v, k) => { if (v.state !== 'compiling' && (!old || v.used < old[1].used)) old = [k, v]; });
      if (old) { try { if (old[1].program) gl.deleteProgram(old[1].program); } catch (e) {} this._variants.delete(old[0]); }
      else return null;
    }
    const v = this._progRec(null);
    v.state = 'compiling'; v.key = key;
    this._variants.set(key, v);
    try {
      const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VS_SOURCE); gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, this._variantSource(key)); gl.compileShader(fs);
      const pr = gl.createProgram();
      gl.attachShader(pr, vs); gl.attachShader(pr, fs);
      if (this._aPos >= 0) gl.bindAttribLocation(pr, this._aPos, 'a_position');
      if (this._aTex >= 0) gl.bindAttribLocation(pr, this._aTex, 'a_texCoord');
      gl.linkProgram(pr);
      v.program = pr; v.vs = vs; v.fs = fs; v.t0 = performance.now();
      const p2 = this._progRec(pr); v.loc = p2.loc;
      if (sync) this._variantFinish(v);
      else this._variantPoll(v);
    } catch (e) { v.state = 'failed'; }
    return v;
  }
  _variantPoll(v) {
    const gl = this.gl;
    if (v.state !== 'compiling') return;
    let done = true;
    try { if (this._vPar) done = gl.getProgramParameter(v.program, this._vPar.COMPLETION_STATUS_KHR); } catch (e) { done = true; }
    if (done) { this._variantFinish(v); return; }
    clearTimeout(v.timer);
    v.timer = setTimeout(() => this._variantPoll(v), 40);
  }
  _variantFinish(v) {
    const gl = this.gl;
    let ok = false;
    try { ok = gl.getProgramParameter(v.program, gl.LINK_STATUS); } catch (e) { ok = false; }
    try { gl.deleteShader(v.vs); gl.deleteShader(v.fs); } catch (e) {}
    v.vs = v.fs = null;
    if (!ok) { try { gl.deleteProgram(v.program); } catch (e) {} v.program = null; v.state = 'failed'; return; }
    v.state = 'ready'; v.ms = Math.round(performance.now() - v.t0);
  }
  /* for the speed test: resolves once no fitted copy is still compiling */
  variantsSettled(maxMs) {
    const t0 = performance.now();
    return new Promise(res => {
      const tick = () => {
        let busy = false; this._variants.forEach(v => { if (v.state === 'compiling') { this._variantPoll(v); if (v.state === 'compiling') busy = true; } });
        if (!busy || performance.now() - t0 > (maxMs || 8000)) res(!busy); else setTimeout(tick, 50);
      };
      tick();
    });
  }

  initBuffers() {
    const gl = this.gl;
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'a_position'); this._aPos = aPos;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const texBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
    const aTex = gl.getAttribLocation(this.program, 'a_texCoord'); this._aTex = aTex;
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0);
  }

  /* 10-bit on-screen canvas (build 219). The pipeline is float all the way to the last shader line; the only 8-bit
     step on screen was the canvas itself, which shows as banding in smooth RAW skies once colour is stretched.
     gl.drawingBufferStorage(RGB10_A2) gives the page a 10-bit back buffer (4x the levels per channel) where the
     browser has the API. Setting canvas.width/height resets the buffer, so this runs after every resize. Any
     failure leaves the normal 8-bit buffer, and the shader dither follows whichever depth is live. */
  /* Builds, for the current picture, whichever of the two small maps the edit needs (tone-base.js): R = the edge-aware base
     for Highlights/Shadows, G = the haze transmission for Dehaze, both measured on one small copy; puts them in epdTex.
     Each is built once per picture, the first time it is used (a few ms), and the texture is re-made if the other arrives
     later. False when they cannot be had (WebGL1, or the helper is missing or fails): the shader then does what it always did. */
  /* Build 397: the Highlights/Shadows base and the haze map were worked out the first time either slider moved, so the
     first frame of that drag stood still for a moment (about 0.15 s on a phone). They are now worked out while the
     page is idle after a photo opens, one at a time; a drag that starts first simply builds them itself, as before.
     The editor's own preview only, not the export or batch copies. */
  _toneSoon() {
    const tok = this._toneTok = {};
    if (typeof engine === 'undefined' || this !== engine || typeof toneProxy !== 'function' || !this.isWebGL2) return;
    const idle = fn => (typeof requestIdleCallback === 'function') ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 1500);
    const step = needDH => () => {
      if (tok !== this._toneTok || this._toneFail || this.contextLost) return;
      if (typeof sliderDragging !== 'undefined' && sliderDragging) { idle(step(needDH)); return; }
      if (this._epdId != null && this._epdId !== -1) return;   // tone mapping is on and its base is in the shared texture: leave it
      try { this._toneMapsReady(true, needDH); } catch (e) {}
      if (!needDH) idle(step(true));
    };
    setTimeout(() => idle(step(false)), 1200);   // after the photo's first frames and the histogram
  }
  _toneMapsReady(needTB, needDH) {
    const gl = this.gl;
    if (!this.isWebGL2 || this._toneFail || typeof toneProxy !== 'function' || !this._toneImg) return false;
    const m = this._toneMaps || (this._toneMaps = { pr: null, tb: null, dh: null });
    /* build 397: and only if they are still what the texture holds; tone mapping uploads its own base into the same
       texture (_epdId then names it), so after tone mapping has been on, the maps go back up before they are used */
    if ((!needTB || m.tb) && (!needDH || m.dh) && this._epdId === -1 && this.epdTex) return true;
    try {
      if (!m.pr) m.pr = toneProxy(this._toneImg);
      if (!m.pr) { this._toneFail = true; return false; }
      if (needTB && !m.tb) m.tb = toneBaseFromProxy(m.pr);
      if (needDH && !m.dh) m.dh = dehazeFromProxy(m.pr);
      const w = m.pr.w, h = m.pr.h, buf = new Float32Array(w * h * 2);
      for (let i = 0; i < w * h; i++) { buf[i * 2] = m.tb ? m.tb[i] : 0; buf[i * 2 + 1] = m.dh ? m.dh[i] : 1; }
      if (!this.epdTex) this.epdTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.epdTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.FLOAT, buf);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      this._epdId = -1;   // the tone-mapping path must re-upload its own base if it is ever used again
      this.toneBase = m.tb ? { w: w, h: h } : null;
      return true;
    } catch (e) { this._toneFail = true; return false; }
  }

  _tenBitApply() {
    const gl = this.gl;
    this.tenBit = false;
    if (!this.isWebGL2 || this._tenBitOff || typeof gl.drawingBufferStorage !== 'function') return;
    try {
      gl.drawingBufferStorage(gl.RGB10_A2, this.canvas.width, this.canvas.height);
      this.tenBit = gl.getError() === gl.NO_ERROR;
    } catch (e) { this.tenBit = false; }
    if (!this.tenBit) {
      this._tenBitOff = true;
      this.canvas.width = this.canvas.width;   // reset to a plain 8-bit buffer
    }
    try { document.documentElement.dataset.canvasBits = this.tenBit ? '10' : '8'; } catch (e) {}
    try { if (typeof updatePrecisionNote === 'function') updatePrecisionNote(); } catch (e) {}
  }

  setImage(img) {
    const gl = this.gl;
    this.canvas.width = img.width;
    this.canvas.height = img.height;
    try { if (window.dockRelayout) window.dockRelayout(); } catch (err) {}   // measure the photo's room now, not on a timer the decode may starve
    this._tenBitApply();
    gl.viewport(0, 0, img.width, img.height);

    if (!this.texture) this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    /* img.__linearFloat, when present (set by rawEngineResultToCanvas), is a
       linear scene-referred twin of img's pixels, carrying the highlight
       headroom the 8-bit canvas had to clip. Same reasoning and same technique setLUTPre already
       uses below for exactly the same reason (LUT banding): an ordinary
       +1 stop exposure push on 8-bit-sourced data was measured collapsing
       a smooth gradient from 256 reachable output levels to 129 -- HALF
       gone on a genuinely common adjustment, and down to an eighth by +3
       stops, which is routine for underexposed IR shots. That's not a
       subtle effect; it's a textbook cause of visible sky banding. This is
       the one texture upload it actually mattered for: every render reads
       this texture, continuously, for the live preview -- unlike rawPixels
       elsewhere in this file, which only ever samples a few pixel values
       for eyedropper picks and a one-time median, where 8-bit precision
       loss is negligible by comparison. WebGL1 has no float texture path
       here, so it keeps the previous 8-bit behaviour unchanged -- the
       banding risk this fixes was always specifically a WebGL2 fix. */
    /* The twin is now LINEAR scene-referred rather than sRGB-encoded, and can
       carry values above 1.0. The shader is told which it got, because a
       JPEG's 8-bit texture is still encoded and must be linearised there
       instead. */
    this.inputIsLinear = !!(img.__linearFloat && this.isWebGL2);
    this._texGen = (this._texGen || 0) + 1;   // a new picture: the prepared copy (see _prepPass) is stale
    this._toneImg = img; this._toneMaps = null; this.toneBase = null;   // and so are the Highlights/Shadows base and the haze map (tone-base.js): rebuilt on first use
    this._toneSoon();
    if (img.__linearFloat && this.isWebGL2) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, img.width, img.height, 0, gl.RGBA, gl.FLOAT, img.__linearFloat);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  /* Build 204: the RAW white balance on the GPU, for dragging. The camera planes (working size, before white balance,
     the same box-averaged values rawEngineResultToCanvas reads) go up once as a float texture; each call then runs the
     per-pixel part of that build -- the highlight rebuild, white balance, the camera matrix (with the camera-space swap
     folded in), the desaturation of fully blown pixels, the orientation -- straight into the picture's own texture. A
     few milliseconds against a JavaScript loop over every pixel. Letting go still runs the full build on the CPU, which
     is the reference; this is its line-for-line port. False when the device can't (no WebGL2 float target), so the
     caller falls back to the CPU drag preview. */
  rawDevelop(o) {
    const gl = this.gl;
    if (!this.isWebGL2 || !this.hiPrec || this._rdFail || !this.texture || !this.inputIsLinear || !o || !o.planes) return false;
    const sw = o.orient >= 5 && o.orient <= 8, W = sw ? o.h : o.w, H = sw ? o.w : o.h;
    if (this.canvas.width !== W || this.canvas.height !== H) return false;
    try {
      if (!this._rd) {
        const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
        const prog = gl.createProgram();
        gl.attachShader(prog, mk(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 q=vec2(float(gl_VertexID&1)*2.0-1.0,float(gl_VertexID>>1)*2.0-1.0);gl_Position=vec4(q,0.0,1.0);}'));
        gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
uniform highp sampler2D u_planes; uniform ivec2 u_size; uniform int u_orient;
uniform vec3 u_wb; uniform vec3 u_iclip; uniform mat3 u_M; uniform float u_hlDone;
out vec4 o;
float hlNear(float k){ float t = clamp((k - 0.9) / 0.085, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
void main(){
  ivec2 d = ivec2(gl_FragCoord.xy); int w = u_size.x, h = u_size.y; ivec2 s;
  if (u_orient == 2) s = ivec2(w - 1 - d.x, d.y);
  else if (u_orient == 3) s = ivec2(w - 1 - d.x, h - 1 - d.y);
  else if (u_orient == 4) s = ivec2(d.x, h - 1 - d.y);
  else if (u_orient == 5) s = ivec2(d.y, d.x);
  else if (u_orient == 6) s = ivec2(d.y, h - 1 - d.x);
  else if (u_orient == 7) s = ivec2(w - 1 - d.y, h - 1 - d.x);
  else if (u_orient == 8) s = ivec2(w - 1 - d.y, d.x);
  else s = d;
  vec3 c = texelFetch(u_planes, s, 0).rgb;
  vec3 k = c * u_iclip;
  float mx = max(k.r, max(k.g, k.b)), mn = min(k.r, min(k.g, k.b));
  if (u_hlDone < 0.5 && mx > 0.9) {
    vec3 b = c * u_wb; float lvl = max(b.r, max(b.g, b.b));
    vec3 wgt = vec3(hlNear(k.r), hlNear(k.g), hlNear(k.b));
    c += (vec3(lvl) / u_wb - c) * wgt;
  }
  vec3 r = u_M * (c * u_wb);
  if (mn >= 0.96) { float t = clamp((mn - 0.96) / 0.04, 0.0, 1.0); t = t * t * (3.0 - 2.0 * t); float m = max(r.r, max(r.g, r.b)); r += (vec3(m) - r) * t; }
  o = vec4(clamp(r, 0.0, 8.0), 1.0);
}`));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        const L = n => gl.getUniformLocation(prog, n);
        this._rd = { prog, planes: L('u_planes'), size: L('u_size'), orient: L('u_orient'), wb: L('u_wb'), iclip: L('u_iclip'), M: L('u_M'), hl: L('u_hlDone'), tex: null, src: null, fb: gl.createFramebuffer() };
      }
      const rd = this._rd;
      if (o.prepareOnly && rd.src === o.planes && rd.tex) return true;
      if (rd.src !== o.planes || !rd.tex) {   // once per set of planes
        const n = o.w * o.h, buf = new Float32Array(n * 4), P = o.planes;
        for (let i = 0; i < n; i++) { buf[i * 4] = P.R[i]; buf[i * 4 + 1] = P.G[i]; buf[i * 4 + 2] = P.B[i]; buf[i * 4 + 3] = 1; }
        if (!rd.tex) rd.tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, rd.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, o.w, o.h, 0, gl.RGBA, gl.FLOAT, buf);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.activeTexture(gl.TEXTURE0);
        rd.src = o.planes;
      }
      if (o.prepareOnly) return true;   // build 204: compiled and uploaded ahead of the first drag
      gl.bindFramebuffer(gl.FRAMEBUFFER, rd.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('raw develop target incomplete');
      gl.viewport(0, 0, W, H);
      gl.useProgram(rd.prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);   // never sample the target while drawing into it
      gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, rd.tex);
      gl.uniform1i(rd.planes, 13); gl.uniform2i(rd.size, o.w, o.h); gl.uniform1i(rd.orient, o.orient || 1);
      gl.uniform3fv(rd.wb, o.wb); gl.uniform3fv(rd.iclip, o.iclip); gl.uniform1f(rd.hl, o.hlDone ? 1 : 0);
      const M = o.M;   // row-major 3x3 -> column-major for GL
      gl.uniformMatrix3fv(rd.M, false, [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this._texGen = (this._texGen || 0) + 1;
      return true;
    } catch (err) {
      this._rdFail = true; console.warn('GPU raw develop disabled:', err && err.message);
      try { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(this.program); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture); } catch (e) {}
      return false;
    }
  }

  /* Build 299: the next frame of a video, same size as the picture already on the GPU: a sub-upload instead of the full
     setImage (no canvas resize, no texture re-creation). False when it can't, so the caller falls back to setImage. */
  updateFrame(img, w, h) {   /* w, h: for a <video>, whose .width is not its picture size (build 313) */
    const gl = this.gl;
    if (!this.texture || this.inputIsLinear || this.canvas.width !== (w || img.width) || this.canvas.height !== (h || img.height)) return false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
    this._texGen = (this._texGen || 0) + 1; this._toneImg = img; this._toneMaps = null; this.toneBase = null;
    return true;
  }

  /* Build 201: new linear data for the picture already on the GPU, same size -- the RAW white balance drag. Skips
     everything setImage does around the upload (canvas sizing, the 8-bit path). False when it can't, so the caller
     falls back to a full install. */
  updateLinearFloat(buf, w, h) {
    const gl = this.gl;
    if (!this.isWebGL2 || !this.inputIsLinear || !this.texture || this.canvas.width !== w || this.canvas.height !== h || !buf || buf.length !== w * h * 4) return false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, buf);
    this._texGen = (this._texGen || 0) + 1;
    return true;
  }

  /* Upload a parsed .cube as an N*N by N tile atlas (see lutLookup in the
     shader for the layout). Source indexing matches parseCubeLUT's ordering:
     red varies fastest, then green, then blue, i.e. ((z*N+y)*N+x)*3.

     Precision matters here — an 8-bit atlas quantises every LUT entry to
     1/255, which is visible as stepping in the smooth gradients a film-look
     LUT is usually there to produce. On WebGL2 the atlas goes up as RGBA16F
     (uploaded as plain FLOAT data; the driver converts), which also filters
     linearly as core functionality. WebGL1 falls back to 8-bit. */
  /* Second LUT slot on texture unit 2, for the built-in film emulation.
     Separate from setLUT's unit 1 so a user-imported grade and the built-in
     LUT can both be active at once — they sit at opposite ends of the
     pipeline and are not alternatives. */
  setLUTPre(lut) {
    const gl = this.gl;
    if (!lut) {
      if (this.lutPreTex) { gl.deleteTexture(this.lutPreTex); this.lutPreTex = null; }
      this.lutPreSize = 0;
      return;
    }
    const N = lut.size, w = N * N, h = N, src = lut.data;
    if (!this.lutPreTex) this.lutPreTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.lutPreTex);
    const px = new Uint8Array(w * h * 4);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const s = ((z * N + y) * N + x) * 3;
      const d = (y * w + z * N + x) * 4;
      px[d] = src[s] * 255; px[d+1] = src[s+1] * 255; px[d+2] = src[s+2] * 255; px[d+3] = 255;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.lutPreSize = N;
  }
  setLUT(lut) {
    const gl = this.gl;
    if (!lut) {
      if (this.lutTex) { gl.deleteTexture(this.lutTex); this.lutTex = null; }
      this.lutSize = 0;
      return;
    }
    const N = lut.size, w = N * N, h = N, src = lut.data;
    if (!this.lutTex) this.lutTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);

    if (this.isWebGL2) {
      const px = new Float32Array(w * h * 4);
      for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const s = ((z * N + y) * N + x) * 3;
        const d = (y * w + z * N + x) * 4;
        px[d] = src[s]; px[d+1] = src[s+1]; px[d+2] = src[s+2]; px[d+3] = 1;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, px);
    } else {
      const px = new Uint8Array(w * h * 4);
      for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const s = ((z * N + y) * N + x) * 3;
        const d = (y * w + z * N + x) * 4;
        px[d]   = Math.max(0, Math.min(255, Math.round(src[s]   * 255)));
        px[d+1] = Math.max(0, Math.min(255, Math.round(src[s+1] * 255)));
        px[d+2] = Math.max(0, Math.min(255, Math.round(src[s+2] * 255)));
        px[d+3] = 255;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);

    this.lutSize = N;
    this.lutDomainMin = lut.domainMin.slice(0, 3);
    this.lutDomainMax = lut.domainMax.slice(0, 3);
  }

  /* Build 317: a small copy of what is on the canvas, for the histograms. The GPU shrinks the frame (one blit) and
     only the small copy comes back to the CPU, instead of the whole frame (about 10 MB for a 1400 x 1800 photo, read
     back after every edit while the GPU waited) being copied out and shrunk on the CPU. Each output pixel is a
     bilinear sample of the frame, not an average of a whole block, so clipped highlights still count as clipped.
     Returns top-down RGBA rows, or null where it cannot (WebGL1), and the caller falls back to the old path. */
  _rsTarget(w, h) {   // the small framebuffer both readers draw the shrunk frame into
    const gl = this.gl;
    if (this._rs && this._rs.w === w && this._rs.h === h) return true;
    if (this._rs) { gl.deleteFramebuffer(this._rs.fb); gl.deleteRenderbuffer(this._rs.rb); this._rs = null; }
    const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(rb); this._rsFail = true; return false; }
    this._rs = { fb, rb, w, h, raw: new Uint8Array(w * h * 4) };
    return true;
  }
  readSmall(w, h) {
    const gl = this.gl;
    if (!this.isWebGL2 || this._rsFail || !gl) return null;
    try {
      if (!this._rsTarget(w, h)) return null;
      const r = this._rs, W = this.canvas.width, H = this.canvas.height;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, r.fb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, r.fb);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, r.raw);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (gl.getError() !== gl.NO_ERROR) { this._rsFail = true; return null; }
      const out = new Uint8ClampedArray(w * h * 4), row = w * 4;
      for (let y = 0; y < h; y++) out.set(r.raw.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      return out;
    } catch (e) { try { gl.bindFramebuffer(gl.FRAMEBUFFER, null); } catch (e2) {} this._rsFail = true; return null; }
  }
  /* Build 397: the same small copy, without the wait. readSmall above returns the pixels at once, which means the page
     stops until the GPU has finished drawing the frame (on a phone, the whole of a heavy edit). Here the copy is
     written into a GPU-side buffer, a fence marks the point it is complete, and the page carries on; the fence is
     checked every few milliseconds and the buffer read only once it has passed, which no longer waits for anything.
     cb(pixels) gets top-down RGBA rows, or cb(null) where it cannot (no WebGL2, a lost context), and the caller then
     uses readSmall. A newer request replaces an older one still in flight; the older one's callback never runs. */
  readSmallAsync(w, h, cb) {
    const gl = this.gl;
    if (!this.isWebGL2 || this._rsFail || this._rsaFail || !gl || typeof gl.fenceSync !== 'function') { cb(null); return; }
    try {
      /* one target, buffer and fence per size, so the histogram (320 wide) and the curve's small histogram (128 wide)
         never cancel each other */
      const jobs = this._rsa || (this._rsa = {}), key = w + 'x' + h;
      let job = jobs[key];
      if (!job) {
        const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (!ok) { gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(rb); this._rsaFail = true; cb(null); return; }
        const pbo = gl.createBuffer(), bytes0 = w * h * 4;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes0, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        // keep at most a few sizes (a window resize changes the histogram's height)
        const keys = Object.keys(jobs);
        if (keys.length >= 4) keys.forEach(k => { const j = jobs[k]; try { if (j.sync) gl.deleteSync(j.sync); gl.deleteFramebuffer(j.fb); gl.deleteRenderbuffer(j.rb); gl.deleteBuffer(j.pbo); } catch (e) {} j.gen++; delete jobs[k]; });
        job = jobs[key] = { fb: fb, rb: rb, pbo: pbo, raw: new Uint8Array(bytes0), sync: null, gen: 0 };
      }
      const r = job, W = this.canvas.width, H = this.canvas.height, bytes = w * h * 4;
      if (job.sync) { try { gl.deleteSync(job.sync); } catch (e) {} job.sync = null; }
      const gen = ++job.gen;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, r.fb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, r.fb);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, job.pbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      /* build 400: no gl.getError() here: asking for errors makes the page wait for the GPU to catch up, which is the
         very wait this function exists to avoid (the speed test showed it holding the page for a whole frame) */
      if (!sync) { this._rsaFail = true; cb(null); return; }
      job.sync = sync;
      gl.flush();
      const t0 = performance.now();
      const poll = () => {
        if (gen !== job.gen) return;                                   // replaced by a newer request
        if (this.contextLost || gl.isContextLost()) { job.sync = null; cb(null); return; }
        let st;
        try { st = gl.clientWaitSync(sync, 0, 0); } catch (e) { st = gl.WAIT_FAILED; }
        if (st === gl.TIMEOUT_EXPIRED) {                              // still drawing: look again (less often once it is clearly a slow frame)
          const age = performance.now() - t0;
          setTimeout(poll, age < 120 ? 4 : age < 1000 ? 16 : 100); return;
        }
        gl.deleteSync(sync); job.sync = null;
        if (st === gl.WAIT_FAILED) { this._rsaFail = true; cb(null); return; }
        try {
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, job.pbo);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, r.raw);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        } catch (e) { try { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); } catch (e2) {} this._rsaFail = true; cb(null); return; }
        const out = new Uint8ClampedArray(bytes), row = w * 4;
        for (let y = 0; y < h; y++) out.set(r.raw.subarray((h - 1 - y) * row, (h - y) * row), y * row);
        cb(out);
      };
      setTimeout(poll, 0);
    } catch (e) {
      try { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); } catch (e2) {}
      this._rsaFail = true; cb(null);
    }
  }
  readPixels() {
    // WebGL's origin is bottom-left, canvas/image convention is top-left —
    // flip rows so the exported pixel data matches what's actually on screen
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
    const raw = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8ClampedArray(w * h * 4);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      const srcRow = raw.subarray((h - 1 - y) * rowBytes, (h - y) * rowBytes);
      out.set(srcRow, y * rowBytes);
    }
    return out;
  }


  /* The guide for Colour by band: the picture as it reaches that step, rendered at half size into a small texture, so the
     main pass can decide each pixel's band from smoothed colour. Only runs when a band slider is in use. */
  _bandGuidePass(p) {
    const gl = this.gl, h = p && p.hsl;
    if (!this.isWebGL2 || !(h && h.on) || this._bgFail) return false;
    try {
      const W = this.canvas.width, H = this.canvas.height, w = Math.max(16, Math.ceil(W / 2)), hh = Math.max(16, Math.ceil(H / 2));
      if (!this._bg || this._bg.w !== w || this._bg.h !== hh) {
        if (this._bg) { gl.deleteFramebuffer(this._bg.fb); gl.deleteTexture(this._bg.tex); this._bg = null; }
        const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex); throw new Error('guide framebuffer incomplete'); }
        gl.activeTexture(gl.TEXTURE0);
        this._bg = { w: w, h: hh, tex: tex, fb: fb };
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._bg.fb); gl.viewport(0, 0, this._bg.w, this._bg.h);
      gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0);   // never sample the target while drawing into it
      this.setUniforms(Object.assign({}, p, { __bandProbe: true, __bandGuide: false, dither: false }));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, this._bg.tex); gl.generateMipmap(gl.TEXTURE_2D); gl.activeTexture(gl.TEXTURE0);
      return true;
    } catch (err) { this._bgFail = true; gl.bindFramebuffer(gl.FRAMEBUFFER, null); console.warn('band guide disabled:', err && err.message); return false; }
  }

  /* A half-size render target for a guide, made or resized as needed, on texture unit `unit`. */
  _guideTarget(key, unit) {
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height, w = Math.max(16, Math.ceil(W / 2)), hh = Math.max(16, Math.ceil(H / 2));
    let g = this[key];
    if (g && g.w === w && g.h === hh) return g;
    if (g) { gl.deleteFramebuffer(g.fb); gl.deleteTexture(g.tex); this[key] = null; }
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex); gl.activeTexture(gl.TEXTURE0); throw new Error('guide framebuffer incomplete'); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.activeTexture(gl.TEXTURE0);
    return (this[key] = { w: w, h: hh, tex: tex, fb: fb });
  }
  /* The guide for colour and luminosity masks: the picture as it reaches the local adjustments, at half size. Only runs
     when such a mask exists. `p` already carries __bandGuide when the band guide ran, so the colour here is the colour
     the main pass will have at that point. */
  /* Build 164: the source at half size with mipmaps, for Targeted colour to decide its selection from an area's colour
     (u_srcGuide in the shader). Only made while there are bands. */
  _srcGuidePass(p) {
    const gl = this.gl;
    let irMask = false; const mk = p && p.masks;   // build 165: the foliage (IR) mask reads its index from this guide too
    if (mk && mk.n) for (let i = 0; i < mk.n; i++) if (mk.info[i * 4] > 3.5) irMask = true;
    // build 186: a wide-space swap takes its colour correction from the guide too (see the swap stage in the shader)
    const wideSwap = p && p.swapSpace != null && [1, 2, 3].includes(+p.swapSpace) && p.matrix && p.matrix.some((v, i) => Math.abs(v - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) > 1e-6);
    if (!this.isWebGL2 || !((p && p.bands && p.bands.length) || irMask || wideSwap) || this._sgFail) return false;
    try {
      const W = this.canvas.width, H = this.canvas.height, w = Math.max(16, Math.ceil(W / 2)), hh = Math.max(16, Math.ceil(H / 2));
      if (!this._sg || this._sg.w !== w || this._sg.h !== hh) {
        if (this._sg) { gl.deleteFramebuffer(this._sg.fb); gl.deleteTexture(this._sg.tex); this._sg = null; }
        const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex); throw new Error('source guide framebuffer incomplete'); }
        gl.activeTexture(gl.TEXTURE0);
        this._sg = { w: w, h: hh, tex: tex, fb: fb };
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._sg.fb); gl.viewport(0, 0, this._sg.w, this._sg.h);
      gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0);   // never sample the target while drawing into it
      this.setUniforms(Object.assign({}, p, { __srcProbe: true, __srcGuide: false, dither: false }));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, this._sg.tex); gl.generateMipmap(gl.TEXTURE_2D); gl.activeTexture(gl.TEXTURE0);
      return true;
    } catch (err) { this._sgFail = true; gl.bindFramebuffer(gl.FRAMEBUFFER, null); console.warn('source guide disabled:', err && err.message); return false; }
  }

  /* Build 184: the Orton pass. Renders the whole pipeline once more, stopping at the Orton point, into a half-size
     mipmapped texture the main pass then blurs from. Only runs while the Orton slider is above zero. */
  _ortonPass(p) {
    const gl = this.gl;
    if (!this.isWebGL2 || !p || !(((p.orton || 0) > 0) || ((p.halation || 0) > 0)) || this._ogFail) return false;   // build 279: Halation shares this pass
    try {
      const W = this.canvas.width, H = this.canvas.height, w = Math.max(16, Math.ceil(W / 2)), hh = Math.max(16, Math.ceil(H / 2));
      if (!this._og || this._og.w !== w || this._og.h !== hh) {
        if (this._og) { gl.deleteFramebuffer(this._og.fb); gl.deleteTexture(this._og.tex); this._og = null; }
        const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex); throw new Error('orton framebuffer incomplete'); }
        gl.activeTexture(gl.TEXTURE0);
        this._og = { w: w, h: hh, tex: tex, fb: fb };
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._og.fb); gl.viewport(0, 0, this._og.w, this._og.h);
      gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0);   // never sample the target while drawing into it
      this.setUniforms(Object.assign({}, p, { __ortonProbe: true, dither: false, clipView: false, cmykWarn: false }));
      // the probe pass writes into a half-size target, so map fragment coordinates as if it were full size
      gl.uniform2f(this.uLocs.ortonInv, 1 / this._og.w, 1 / this._og.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, this._og.tex); gl.generateMipmap(gl.TEXTURE_2D); gl.activeTexture(gl.TEXTURE0);
      return true;
    } catch (err) { this._ogFail = true; gl.bindFramebuffer(gl.FRAMEBUFFER, null); console.warn('orton disabled:', err && err.message); return false; }
  }

  _maskGuidePass(p) {
    const gl = this.gl, mk = p && p.masks;
    if (!this.isWebGL2 || !mk || !mk.n || this._mgFail) return false;
    let need = false; for (let i = 0; i < mk.n; i++) if (mk.info[i * 4] > 1.5) need = true;
    if (!need) return false;
    try {
      const g = this._guideTarget('_mg', 10);
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.fb); gl.viewport(0, 0, g.w, g.h);
      this.setUniforms(Object.assign({}, p, { __maskProbe: true, __maskGuide: false, dither: false, maskView: -1 }));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    } catch (err) { this._mgFail = true; gl.bindFramebuffer(gl.FRAMEBUFFER, null); console.warn('mask guide disabled:', err && err.message); return false; }
  }

  render(p) {
    const gl = this.gl;
    if (this._prepPass(p)) p = Object.assign({}, p, { __prepped: true });
    if (this._bandGuidePass(p)) p = Object.assign({}, p, { __bandGuide: true }); if (this._srcGuidePass(p)) p = Object.assign({}, p, { __srcGuide: true });
    if (this._maskGuidePass(p)) p = Object.assign({}, p, { __maskGuide: true });
    if (this._ortonPass(p)) p = Object.assign({}, p, { __ortonReady: true });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.setUniforms(p);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* Draft-quality render for the middle of a slider drag.

     The whole pipeline runs into an off-screen RGBA8 target at `scale` times
     the canvas size, then a trivial shader stretches that onto the canvas,
     so the canvas itself — its size, its CSS layout, zoom, export and every
     reader of canvas.width — never changes. Fragment cost scales with the
     number of output pixels, so half scale is roughly a quarter of the work,
     which is what matters for the many-tap passes (highlights, clarity,
     dehaze, noise reduction).

     texelSize in setUniforms still comes from the FULL canvas size, so the
     neighbourhood taps cover the same part of the image as at full
     resolution and local-contrast controls look the same in the draft as in
     the final frame, just sampled more coarsely.

     WebGL2 only (the blit uses gl_VertexID so it needs no vertex buffers and
     cannot disturb the attribute state the main program relies on). On
     anything else, or on any setup failure, this is just render(). */
  renderScaled(p, scale) {
    const gl = this.gl;
    if (!this.isWebGL2 || this._loFail || !(scale < 0.98)) return this.render(p);
    const W = this.canvas.width, H = this.canvas.height;
    const w = Math.max(64, Math.round(W * scale)), h = Math.max(64, Math.round(H * scale));
    if (w >= W || h >= H) return this.render(p);
    try {
      if (!this._blit) {
        const mk = (type, src) => {
          const sh = gl.createShader(type);
          gl.shaderSource(sh, src); gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
          return sh;
        };
        const prog = gl.createProgram();
        gl.attachShader(prog, mk(gl.VERTEX_SHADER,
          '#version 300 es\nvoid main(){vec2 q=vec2(float(gl_VertexID&1)*2.0-1.0,float(gl_VertexID>>1)*2.0-1.0);gl_Position=vec4(q,0.0,1.0);}'));
        gl.attachShader(prog, mk(gl.FRAGMENT_SHADER,
          '#version 300 es\nprecision highp float;uniform sampler2D t;uniform vec2 r;out vec4 o;void main(){o=texture(t,gl_FragCoord.xy/r);}'));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        this._blit = { prog: prog, t: gl.getUniformLocation(prog, 't'), r: gl.getUniformLocation(prog, 'r') };
      }
      if (!this._lo || this._lo.w !== w || this._lo.h !== h) {
        if (this._lo) { gl.deleteFramebuffer(this._lo.fb); gl.deleteTexture(this._lo.tex); this._lo = null; }
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        /* Nearest, not linear (build 131): smoothing the stretch averaged neighbouring draft pixels and took the grain
           out, so the photo looked cleaner while dragging than once let go. Each draft pixel is about one screen pixel
           (draftScale), so stretching it unsmoothed and letting the browser shrink the canvas back gives the same grain
           as the full frame. */
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
          throw new Error('draft framebuffer incomplete');
        }
        this._lo = { w: w, h: h, tex: tex, fb: fb };
      }
      // pass 1: the real pipeline at reduced size
      if (this._prepPass(p)) p = Object.assign({}, p, { __prepped: true });
      if (this._bandGuidePass(p)) p = Object.assign({}, p, { __bandGuide: true }); if (this._srcGuidePass(p)) p = Object.assign({}, p, { __srcGuide: true });
      if (this._maskGuidePass(p)) p = Object.assign({}, p, { __maskGuide: true });
      if (this._ortonPass(p)) p = Object.assign({}, p, { __ortonReady: true });
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._lo.fb);
      gl.viewport(0, 0, w, h);
      this.setUniforms(p);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // pass 2: stretch it onto the full-size canvas
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(this._blit.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._lo.tex);
      gl.uniform1i(this._blit.t, 0);
      gl.uniform2f(this._blit.r, W, H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // leave unit 0 holding the source image, as every other path assumes
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
    } catch (err) {
      this._loFail = true;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      console.warn('draft render disabled:', err && err.message);
      this.render(p);
    }
  }

  setUniforms(p) {
    /* build 401: the values are gathered first (_setUniformsBody records them, see _variantInit), then the program
       that matches them is chosen and given every value */
    this._uRec = true;
    try { this._setUniformsBody(p); } finally { this._uRec = false; }
    this._variantApply();
  }

  _setUniformsBody(p) {
    const gl = this.gl;
    gl.useProgram(this.program);

    /* Bind both samplers explicitly every draw. This used to rely on the
       source image being the only texture ever bound to unit 0 — which
       stopped being true the moment a LUT atlas and an FBO colour
       attachment entered the picture, since binding either of those
       clobbers whatever was on the active unit. */
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uLocs.image, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(this.uLocs.lut, 1);
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform1f(this.uLocs.lutSize, this.lutSize);
    gl.uniform1f(this.uLocs.lutMix, this.lutSize ? (p.lutMix == null ? 1 : p.lutMix) : 0);
    gl.uniform2f(this.uLocs.texelSize, 1 / Math.max(1, this.canvas.width), 1 / Math.max(1, this.canvas.height));
    gl.uniform1i(this.uLocs.lutPre, 2);
    gl.uniform1f(this.uLocs.lutPreSize, this.lutPreSize || 0);
    // Bound once in setupHellwigVWTexture, same pattern as lutPre just
    // above -- only the unit assignment needs repeating each frame.
    gl.uniform1i(this.uLocs.hellwigVW, 3);
    /* The early LUT stage is shared. It was written for the built-in film
       LUT and gated on filmOn alone, but a user LUT that carries a COMPLETE
       transform needs the same slot \u2014 it expects the image as it came in,
       not one that has already been swapped and white-balanced. Gating on
       "is there a pre-LUT loaded" rather than on one specific toggle lets
       both use it, without the user LUT having to pretend to be the film. */
    gl.uniform1f(this.uLocs.lutPreMix, (p.filmOn || p.preLUTUser) ? 1 : 0);
    if (this.lutPreTex) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.lutPreTex); }
    gl.uniform3fv(this.uLocs.lutDomainMin, new Float32Array(this.lutDomainMin));
    gl.uniform3fv(this.uLocs.lutDomainMax, new Float32Array(this.lutDomainMax));
    
    // Transpose matrix from Row-Major (UI) to Column-Major (WebGL)
    const m = p.matrix;
    const transposed = [
      m[0], m[3], m[6],
      m[1], m[4], m[7],
      m[2], m[5], m[8]
    ];

    gl.uniformMatrix3fv(this.uLocs.matrix, false, new Float32Array(transposed));
    gl.uniform3fv(this.uLocs.mOffset, new Float32Array(p.mOffset || [0,0,0]));
    // Build 334: the curved mapping. Each of its three 3x3 blocks has one row per output channel, sent column-major like u_matrix.
    const pl = p.poly && p.poly.c && p.poly.c.length === 3 ? p.poly : null;
    gl.uniform1f(this.uLocs.polyMix, pl ? 1 : 0);
    if (pl) {
      const c = pl.c, blk = o => new Float32Array([c[0][o], c[1][o], c[2][o], c[0][o + 1], c[1][o + 1], c[2][o + 1], c[0][o + 2], c[1][o + 2], c[2][o + 2]]);
      gl.uniform1f(this.uLocs.polyEps, pl.eps || 0.1);
      gl.uniformMatrix3fv(this.uLocs.polyS, false, blk(0));
      gl.uniformMatrix3fv(this.uLocs.polyL, false, blk(3));
      gl.uniformMatrix3fv(this.uLocs.polyX, false, blk(6));
    }
    // Build 337: the infrared map (preview only). Nine coefficients: roots, linear, cross terms.
    const ir = p.irmap && p.irmap.c && p.irmap.c.length === 9 ? p.irmap : null;
    gl.uniform1f(this.uLocs.irMix, ir ? 1 : 0);
    if (ir) {
      gl.uniform1f(this.uLocs.polyEps, ir.eps || 0.1);
      gl.uniform3fv(this.uLocs.irS, new Float32Array(ir.c.slice(0, 3)));
      gl.uniform3fv(this.uLocs.irL, new Float32Array(ir.c.slice(3, 6)));
      gl.uniform3fv(this.uLocs.irX, new Float32Array(ir.c.slice(6, 9)));
    }
    // 20 vec3s, flattened — see u_camCoef in the shader
    gl.uniform1f(this.uLocs.camFit, p.camCoef ? 1 : 0);
    gl.uniform3fv(this.uLocs.camCoef, new Float32Array(p.camCoef || new Array(60).fill(0)));

    // Targeted colour bands. Padded to 5 slots always — a uniform array in
    // GLSL ES 1.00 has to be sized at compile time, so the unused tail is
    // just sent as zeros and u_bandCount tells the shader where to stop.
    {
      const bands = p.bands || [];
      const n = Math.min(5, bands.length);
      const hue = new Float32Array(5), width = new Float32Array(5),
            dH = new Float32Array(5), dS = new Float32Array(5), dL = new Float32Array(5),
            lo = new Float32Array(5), hi = new Float32Array(5), sel = new Float32Array(5),
            ab = new Float32Array(10), pc = new Float32Array(5).fill(1);
      for (let i = 0; i < n; i++) {
        hue[i] = bands[i].hue; width[i] = bands[i].width;
        dH[i] = bands[i].dH; dS[i] = bands[i].dS; dL[i] = bands[i].dL;
        // absent means "the whole range", so an existing band is untouched
        lo[i] = bands[i].lo === undefined ? -0.05 : bands[i].lo;
        hi[i] = bands[i].hi === undefined ?  1.05 : bands[i].hi;
        // absent means the old, always-on 3x widening \u2014 same reasoning as
        // lo/hi above, an existing band must render exactly as it always has
        sel[i] = bands[i].selectivity === undefined ? 0 : bands[i].selectivity;
        // build 163: the picked colour; a band without it stays on the hue test (chroma 1)
        if (bands[i].pc !== undefined) { ab[i * 2] = bands[i].pa; ab[i * 2 + 1] = bands[i].pb; pc[i] = bands[i].pc; }
      }
      gl.uniform1i(this.uLocs.bandCount, n);
      gl.uniform1fv(this.uLocs.bandHue, hue);
      gl.uniform1fv(this.uLocs.bandWidth, width);
      gl.uniform1fv(this.uLocs.bandDH, dH);
      gl.uniform1fv(this.uLocs.bandDS, dS);
      gl.uniform1fv(this.uLocs.bandDL, dL);
      gl.uniform1fv(this.uLocs.bandLo, lo);
      gl.uniform1fv(this.uLocs.bandHi, hi);
      gl.uniform1fv(this.uLocs.bandSelectivity, sel);
      gl.uniform2fv(this.uLocs.bandAB, ab);
      gl.uniform1fv(this.uLocs.bandPC, pc);
    }

    gl.uniform3fv(this.uLocs.preWB, new Float32Array(p.preWB));
    /* transpose must be FALSE in WebGL1 -- passing true throws INVALID_VALUE,
       unlike WebGL2 which permits it. The matrices are built row-major (the
       natural way to write the Bradford maths out), so they are transposed
       here in JS to column-major before upload instead of asking the GPU to
       do it. */
    gl.uniformMatrix3fv(this.uLocs.preWBM, false, toGLMat3(p.preWBM || IDENTITY3));
    gl.uniformMatrix3fv(this.uLocs.postWBM, false, toGLMat3(p.postWBM || IDENTITY3));
    gl.uniform1i(this.uLocs.wbMethod, p.wbMethod === 'bradford' ? 1 : 0);
    gl.uniform1i(this.uLocs.hueSpace, p.hueSpace === 'channel' ? 1 : p.hueSpace === 'ps' ? 2 : 0);
    gl.uniform1i(this.uLocs.lumPreserve, p.lumPreserve ? 1 : 0);
    gl.uniform3fv(this.uLocs.lumaW, new Float32Array(p.lumaW || [0.2126, 0.7152, 0.0722]));
    gl.uniform3fv(this.uLocs.postWB, new Float32Array(p.postWB));
    gl.uniform3fv(this.uLocs.tempTint, new Float32Array(p.tempTint || [1,1,1]));
    gl.uniform1f(this.uLocs.satPreserve, (p.satPreserve || 0) / 100);
    gl.uniform1f(this.uLocs.wide, p.wideWork === false ? 0 : 1);
    gl.uniform1f(this.uLocs.contrast, contrastStrength(p.contrast));
    gl.uniform1f(this.uLocs.contrastPivot, p.contrastPivot === undefined ? 0.5 : p.contrastPivot);
    gl.uniform1f(this.uLocs.hiPivot, p.hiPivot === undefined ? 0.10 : p.hiPivot);
    gl.uniform1f(this.uLocs.shW, p.shW === undefined ? 1.0 : p.shW);
    gl.uniform1f(this.uLocs.bandProbe, p.__bandProbe ? 1 : 0);
    gl.uniform1f(this.uLocs.srcProbe, p.__srcProbe ? 1 : 0);
    {   // build 184: Orton effect
      const on = !!(p.__ortonReady || p.__ortonProbe) && ((p.orton || 0) > 0 || (p.halation || 0) > 0);
      gl.uniform1f(this.uLocs.ortonOn, on ? 1 : 0); gl.uniform1f(this.uLocs.ortonProbe, p.__ortonProbe ? 1 : 0);
      gl.uniform1f(this.uLocs.orton, Math.min(1, Math.max(0, p.orton || 0)));
      const W = this.canvas.width, H = this.canvas.height;
      gl.uniform2f(this.uLocs.ortonInv, 1 / W, 1 / H);
      if (this._og) gl.uniform2f(this.uLocs.ortonTexel, 1 / this._og.w, 1 / this._og.h);
      // softness 0..1 -> blur radius 0.4% .. 5% of the short edge, expressed as a mip level of the half-size texture
      const rad = (0.004 + 0.046 * Math.pow(Math.min(1, Math.max(0, p.ortonSoft == null ? 0.5 : p.ortonSoft)), 1.3)) * Math.min(W, H) / 2;
      gl.uniform1f(this.uLocs.ortonBias, Math.max(0, Math.log2(Math.max(1, rad / 2))));
      gl.uniform1i(this.uLocs.ortonTex, 12);
      // build 279: halation, spread 0..1 -> blur radius 1.5% .. 9% of the short edge, as a mip level of the same texture
      gl.uniform1f(this.uLocs.halation, Math.min(1, Math.max(0, p.halation || 0)));
      const hrad = (0.015 + 0.075 * Math.min(1, Math.max(0, p.halSpread == null ? 0.5 : p.halSpread))) * Math.min(W, H) / 2;
      gl.uniform1f(this.uLocs.halBias, Math.max(0, Math.log2(Math.max(1, hrad / 2))));
    }
    gl.uniform1f(this.uLocs.irSubOn, p.irSub ? 1 : 0);
    gl.uniformMatrix3fv(this.uLocs.irSub, false, p.irSub || new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    { const useS = !!(p.__srcGuide && this._sg);
      gl.uniform1f(this.uLocs.srcGuideOn, useS ? 1 : 0);
      gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, useS ? this._sg.tex : null); gl.uniform1i(this.uLocs.srcGuide, 11);
      if (useS) gl.uniform2f(this.uLocs.srcGuideTexel, 1 / this._sg.w, 1 / this._sg.h);
      gl.activeTexture(gl.TEXTURE0); }
    { const useG = !!(p.__bandGuide && this._bg);
      gl.uniform1f(this.uLocs.bandGuideOn, useG ? 1 : 0);
      gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, useG ? this._bg.tex : null); gl.uniform1i(this.uLocs.bandGuide, 8);
      if (useG) gl.uniform2f(this.uLocs.guideTexel, 1 / this._bg.w, 1 / this._bg.h);
      gl.activeTexture(gl.TEXTURE0); }
    { const h = p.hsl; const on = !!(h && h.on);
      gl.uniform1f(this.uLocs.hslOn, on ? 1 : 0);
      if (on) {
        gl.uniform4f(this.uLocs.hslH0, h.H[0], h.H[1], h.H[2], h.H[3]); gl.uniform4f(this.uLocs.hslH1, h.H[4], h.H[5], h.H[6], h.H[7]);
        gl.uniform4f(this.uLocs.hslS0, h.S[0], h.S[1], h.S[2], h.S[3]); gl.uniform4f(this.uLocs.hslS1, h.S[4], h.S[5], h.S[6], h.S[7]);
        gl.uniform4f(this.uLocs.hslL0, h.L[0], h.L[1], h.L[2], h.L[3]); gl.uniform4f(this.uLocs.hslL1, h.L[4], h.L[5], h.L[6], h.L[7]);
      } }
    { const e = p.eir, live = !!(e && e.mask && this.isWebGL2 && (e.sky > 0 || e.fol > 0 || e.show));
      gl.uniform1f(this.uLocs.skyDeep, live ? e.sky : 0); gl.uniform1f(this.uLocs.crimson, live ? e.fol : 0); gl.uniform1f(this.uLocs.skyShow, live && e.show ? 1 : 0);
      if (this.isWebGL2) {   // the sampler always gets a texture, even with the effect off, so no unit is left unbound
        if (!this.skyTex) { this.skyTex = gl.createTexture(); gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.skyTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]].forEach(([k, v]) => gl.texParameteri(gl.TEXTURE_2D, k, v)); this._skyId = -1; }
        gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.skyTex);
        if (live && this._skyId !== e.mask.id) { gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, e.mask.w, e.mask.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, e.mask.data); this._skyId = e.mask.id; }
        gl.uniform1f(this.uLocs.skyL, live && e.mask.skyL ? e.mask.skyL : 0.5);
        { const sl = live && e.mask.skyLab ? e.mask.skyLab : [0.5, 0, 0]; gl.uniform3f(this.uLocs.skyLab, sl[0], sl[1], sl[2]); }
        if (!this.skyColTex) { this.skyColTex = gl.createTexture(); gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.skyColTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255])); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
        gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.skyColTex);
        if (live && e.mask.col && this._skyColId !== e.mask.id) { gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, e.mask.w, e.mask.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, e.mask.col); this._skyColId = e.mask.id; }
        gl.uniform1i(this.uLocs.skyCol, 7); gl.activeTexture(gl.TEXTURE6);
        gl.uniform2f(this.uLocs.maskSize, live ? e.mask.w : 1, live ? e.mask.h : 1);
        gl.uniform1i(this.uLocs.skyMask, 6); gl.activeTexture(gl.TEXTURE0);
      } }
    gl.uniform1f(this.uLocs.filmTone, (p.filmTone || 0) / 100);
    gl.uniform1i(this.uLocs.indexMode, p.indexMode || 0);
    gl.uniform1f(this.uLocs.highlights, (p.highlights || 0) / 100);
    gl.uniform1f(this.uLocs.shadows, (p.shadows || 0) / 100);
    gl.uniform1f(this.uLocs.clarity, (p.clarity || 0) / 100);
    gl.uniform1f(this.uLocs.dehaze,    (p.dehaze    || 0) / 100);
    gl.uniform1f(this.uLocs.calRH,     (p.calRH     || 0) / 100);
    gl.uniform1f(this.uLocs.calGH,     (p.calGH     || 0) / 100);
    gl.uniform1f(this.uLocs.calBH,     (p.calBH     || 0) / 100);
    gl.uniform1f(this.uLocs.calRS,     (p.calRS     || 0) / 100);
    gl.uniform1f(this.uLocs.calGS,     (p.calGS     || 0) / 100);
    gl.uniform1f(this.uLocs.calBS,     (p.calBS     || 0) / 100);
    gl.uniform1f(this.uLocs.calST,     (p.calST     || 0) / 100);
    gl.uniform1i(this.uLocs.swapSpace, p.swapSpace === undefined ? 2 : p.swapSpace);
    if (p.swapSpace === 3) {
      const sb = swapBlend(p.swapWiden === undefined ? 1 : p.swapWiden);
      gl.uniformMatrix3fv(this.uLocs.swapT, false, sb.T);
      gl.uniformMatrix3fv(this.uLocs.swapTi, false, sb.Ti);
    }
    gl.uniform1f(this.uLocs.vigAmt, (p.vigAmt || 0) / 100);
    gl.uniform1f(this.uLocs.vigFall, p.vigFall === undefined ? 2 : p.vigFall);
    gl.uniform1f(this.uLocs.vigSpread, p.vigSpread === undefined ? 0.55 : p.vigSpread);
    gl.uniform2f(this.uLocs.vigCentre, p.vigCX === undefined ? 0.5 : p.vigCX, p.vigCY === undefined ? 0.5 : p.vigCY);
    gl.uniform1f(this.uLocs.aspect, this.canvas.height > 0 ? this.canvas.width / this.canvas.height : 1);
    gl.uniform1f(this.uLocs.exposure, Math.pow(2, p.exposure));
    gl.uniform1f(this.uLocs.brightness, (p.brightness || 0) / 100);
    gl.uniform1f(this.uLocs.hue, p.hue / 360);
    gl.uniform1f(this.uLocs.sat, p.sat / 100);
    gl.uniform1f(this.uLocs.vibrance, (p.vibrance || 0) / 100);
    gl.uniform1f(this.uLocs.blackPt, p.blackPt);
    gl.uniform1f(this.uLocs.whitePt, p.whitePt || 0);
    gl.uniform1f(this.uLocs.noiseReduction, (p.noiseReduction || 0) / 100);
    gl.uniform1f(this.uLocs.inputLinear, this.inputIsLinear ? 1 : 0);
    gl.uniform1f(this.uLocs.hlRecover, (p.hlRecover || 0) / 100);
    gl.uniform1f(this.uLocs.sharpen, (p.sharpen || 0) / 100);
    // slider is in tenths of a texel (5..30 -> 0.5..3.0) so it can read as 1.0
    gl.uniform1f(this.uLocs.sharpenRadius, (p.sharpenRadius == null ? 10 : p.sharpenRadius) / 10);
    gl.uniform1f(this.uLocs.sharpenMask, (p.sharpenMask == null ? 35 : p.sharpenMask) / 100);
    gl.uniform1f(this.uLocs.noiseColour, (p.noiseColour || 0) / 100);
    gl.uniform1f(this.uLocs.nrScale, p.nrScale > 1 ? p.nrScale : 1);
    gl.uniform1f(this.uLocs.clipView, p.clipView ? 1 : 0);
    gl.uniform1f(this.uLocs.cmykWarn, p.cmykWarn ? 1 : 0);
    gl.uniform1f(this.uLocs.gamutDrag, p.gamutDrag ? 1 : 0);
    gl.uniform1f(this.uLocs.dither, (p.dither === false || this._noDither) ? 0 : (this.tenBit ? 0.25 : 1));   // amplitude: one step of the live depth
    gl.uniform1f(this.uLocs.dustView, p.dustView && !p.__srcProbe && !p.__ortonProbe && !this._noDither ? 1 : 0);
    gl.uniform1f(this.uLocs.caR, p.caR || 0);
    gl.uniform1f(this.uLocs.caB, p.caB || 0);
    gl.uniform3f(this.uLocs.hotspot, p.hotspot ? p.hotspot[0] : 0, p.hotspot ? p.hotspot[1] : 0, p.hotspot ? p.hotspot[2] : 0);
    gl.uniform1f(this.uLocs.hotSize, p.hotSize || 0.35);
    /* Tone curve table on unit 4. Re-uploaded only when its key changes, so a
       steady frame costs nothing. Half-float on WebGL2 so a shallow part of
       the curve does not collapse neighbouring levels; 8-bit otherwise. */
    if (p.curveOn && p.curveLut) {
      if (this.curveTex && !gl.isTexture(this.curveTex)) { this.curveTex = null; this._curveKey = null; }   // build 277: a handle from a lost context
      if (this._curveKey !== p.curveKey) {
        if (!this.curveTex) this.curveTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
        if (this.isWebGL2) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, p.curveLut.length / 4, 1, 0, gl.RGBA, gl.FLOAT, p.curveLut);
        } else {
          const u8 = new Uint8Array(p.curveLut.length);
          for (let i = 0; i < u8.length; i++) u8[i] = Math.max(0, Math.min(255, Math.round(p.curveLut[i] * 255)));
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, p.curveLut.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, u8);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this._curveKey = p.curveKey;
      }
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      gl.uniform1i(this.uLocs.curve, 4);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniform1f(this.uLocs.curveOn, (p.curveOn && p.curveLut) ? 1 : 0);
    gl.uniform1f(this.uLocs.curveLum, p.curveLum ? 1 : 0);
    gl.uniform1f(this.uLocs.deband, Math.max(0, Math.min(1, p.deband || 0)));
    gl.uniform1f(this.uLocs.debandRad, 0.02 * Math.max(this.canvas.width, this.canvas.height));   // reach scales with the picture, so a full-size export looks like the preview
    { const e = p.epd, ok = !!(e && e.on && e.base && this.isWebGL2);
      gl.uniform1f(this.uLocs.epdProbe, p.epdProbe ? 1 : 0);
      gl.uniform1f(this.uLocs.epdOn, ok ? 1 : 0);
      gl.uniform1f(this.uLocs.epdRef, ok ? e.ref : (p.epdRef || 1));
      if (ok) {
        if (this._epdId !== e.base.id) {
          if (!this.epdTex) this.epdTex = gl.createTexture();
          gl.activeTexture(gl.TEXTURE5);
          gl.bindTexture(gl.TEXTURE_2D, this.epdTex);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, e.base.w, e.base.h, 0, gl.RED, gl.FLOAT, e.base.data);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          this._epdId = e.base.id;
        }
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, this.epdTex);
        gl.uniform1i(this.uLocs.epdBase, 5);
        gl.uniform1f(this.uLocs.epdTemp, e.temp); gl.uniform1f(this.uLocs.epdBoost, e.boost);
        gl.uniform1f(this.uLocs.epdS, e.s); gl.uniform1f(this.uLocs.epdNorm, e.norm);
        gl.activeTexture(gl.TEXTURE0);
      } else if (p.epdProbe) { gl.uniform1i(this.uLocs.epdBase, 5); }
      /* Edge-aware base for Highlights/Shadows (tone-base.js). It rides in the tone-mapping base's sampler and texture unit,
         which nothing else uses while tone mapping is off; the two are never wanted at once. Only built when one of the
         two sliders is in use, and only once per picture. */
      const useMaps = !ok && !p.epdProbe && !p.__noToneBase;
      const needTB = useMaps && ((p.highlights || 0) !== 0 || (p.shadows || 0) !== 0), needDH = useMaps && (p.dehaze || 0) !== 0;
      const wantAny = (needTB || needDH) && this._toneMapsReady(needTB, needDH), wantTB = wantAny && needTB, wantDH = wantAny && needDH;
      gl.uniform1f(this.uLocs.tbOn, wantTB ? 1 : 0);
      gl.uniform1f(this.uLocs.dhOn, wantDH ? 1 : 0);
      if (wantAny) {
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, this.epdTex);
        gl.uniform1i(this.uLocs.epdBase, 5);
        gl.activeTexture(gl.TEXTURE0);
      }
    }
    {
      const mk = p.masks;
      gl.uniform1f(this.uLocs.maskN, mk ? mk.n : 0);
      gl.uniform1f(this.uLocs.maskProbe, p.__maskProbe ? 1 : 0);
      { const useM = !!(p.__maskGuide && this._mg);
        gl.uniform1f(this.uLocs.maskGuideOn, useM ? 1 : 0);
        gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, useM ? this._mg.tex : null); gl.uniform1i(this.uLocs.maskGuide, 10);
        if (useM) gl.uniform2f(this.uLocs.mGuideTexel, 1 / this._mg.w, 1 / this._mg.h);
        gl.activeTexture(gl.TEXTURE0); }
      gl.uniform1f(this.uLocs.maskView, p.maskView === undefined ? -1 : p.maskView);
      if (mk && mk.n) {
        gl.uniform4fv(this.uLocs.mGeom, mk.geom); gl.uniform4fv(this.uLocs.mInfo, mk.info);
        gl.uniform4fv(this.uLocs.mAdj, mk.adj); gl.uniform4fv(this.uLocs.mAdj2, mk.adj2);
      }
    }
    gl.uniform1i(this.uLocs.bandPreview, (p.bandPreview === undefined || p.bandPreview === null) ? -1 : p.bandPreview);
    /* Two-pass rendering (see _prepPass): unit 0 carries the prepared picture when the main pass reads it, the original
       otherwise; unit 9 always carries the original, for the sky selection. */
    { const usePrep = !!(p.__prepped && this._prep && !p.__prep);
      gl.uniform1f(this.uLocs.prep, p.__prep ? 1 : 0);
      gl.uniform1f(this.uLocs.prepped, usePrep ? 1 : 0);
      gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.uniform1i(this.uLocs.src, 9);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, usePrep ? this._prep.tex : this.texture); }
  }

  /* First pass of two. Decoding to light, hotspot, exposure, highlight recovery and noise reduction are drawn once into
     an off-screen half-float picture the size of the source; the main pass then reads that instead of the original, so
     sharpening, clarity, dehaze, highlights/shadows and targeted colour all look at neighbours that have been through
     the same stages as the pixel itself. Redrawn only when something it depends on changes, so dragging any later
     slider costs nothing here (and noise reduction, the heaviest stage, is not repeated on every frame).
     Returns true when the prepared picture is ready to read. When it cannot be made (WebGL1, no renderable half float,
     a buffer that will not allocate at this size) the shader runs the same stages inline, so the picture is the same
     except that sharpening then works from the un-denoised source. */
  _prepPass(p) {
    const gl = this.gl;
    if (!this.isWebGL2 || !this.hiPrec || this._prepFail || !this.texture) return false;
    const hasBands = !!(p.bands && p.bands.length);
    const need = (p.noiseReduction > 0) || (p.noiseColour > 0) || (p.sharpen > 0) || (p.clarity || 0) !== 0 ||
                 (p.dehaze || 0) !== 0 || (p.highlights || 0) !== 0 || (p.shadows || 0) !== 0 || hasBands;
    const needS1 = SRC_LITE_ON && ((p.exposure || 0) !== 0 || (p.hlRecover || 0) !== 0 || p.caR || p.caB || (p.hotspot && (p.hotspot[0] || p.hotspot[1] || p.hotspot[2])) || p.deband);
    if (!need && !needS1) return false;
    const W = this.canvas.width, H = this.canvas.height;
    try {
      if (!this._prep || this._prep.w !== W || this._prep.h !== H) {
        if (this._prep) { gl.deleteFramebuffer(this._prep.fb); gl.deleteTexture(this._prep.tex); this._prep = null; }
        this._prepKey = null;
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() !== gl.OUT_OF_MEMORY;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        if (!ok) { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); return false; }   // this size only; a smaller one may still work
        this._prep = { w: W, h: H, tex: tex, fb: fb };
      }
      const hs = p.hotspot || [0, 0, 0];
      const key = [this._texGen, W, H, this.inputIsLinear ? 1 : 0, p.exposure || 0, p.hlRecover || 0, p.noiseReduction || 0,
                   p.noiseColour || 0, p.nrScale > 1 ? p.nrScale : 1, p.caR || 0, p.caB || 0, hs[0], hs[1], hs[2], p.hotSize || 0.35,
                   p.deband || 0, p.wideWork === false ? 0 : 1, p.vigCX === undefined ? 0.5 : p.vigCX, p.vigCY === undefined ? 0.5 : p.vigCY].join(',');
      if (key === this._prepKey) return true;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._prep.fb);
      gl.viewport(0, 0, W, H);
      this.setUniforms(Object.assign({}, p, { __prep: true, __prepped: false, dither: false }));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._prepKey = key;
      return true;
    } catch (err) {
      this._prepFail = true;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      console.warn('two-pass render disabled:', err && err.message);
      return false;
    }
  }

  /* ---------- high-precision render ----------
     Renders the same pipeline into an off-screen RGBA16F attachment instead
     of the 8-bit canvas, and reads it back as 0..65535 integers.

     What this does and does not buy: the SOURCE is an 8-bit JPEG/PNG, so no
     amount of output precision invents detail that was never captured. What
     it removes is the re-quantisation of the PROCESSING. Exposure, the
     S-curve and the black-point pull all stretch 256 input levels apart, and
     writing that back into 8 bits rounds every stretched value to the
     nearest of 256 again — which is exactly what puts stair-stepping into a
     smooth IR sky. Half-float carries ~11 bits of mantissa through that
     arithmetic, so the gradient stays smooth and Lightroom receives real
     headroom for further grading rather than a 16-bit container full of
     8-bit values multiplied by 257 (which is all the previous TIFF export
     actually contained).

     Returns a Uint16Array of RGBA, top-row-first, or null if the device
     can't do it — every caller must handle null and fall back. */
  renderHiPrec(p) {
    if (!this.hiPrec) return null;
    this._noDither = true;   // 16-bit output must not carry 8-bit dither noise
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
    let tex = null, fb = null;
    try {
      if (this._prepPass(p)) p = Object.assign({}, p, { __prepped: true });
      if (this._bandGuidePass(p)) p = Object.assign({}, p, { __bandGuide: true }); if (this._srcGuidePass(p)) p = Object.assign({}, p, { __srcGuide: true });
      if (this._maskGuidePass(p)) p = Object.assign({}, p, { __maskGuide: true });
      if (this._ortonPass(p)) p = Object.assign({}, p, { __ortonReady: true });
      tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;

      gl.viewport(0, 0, w, h);
      this.setUniforms(p);   // rebinds the source image onto unit 0
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Ask the driver what it will actually give us rather than assuming.
      // RGBA16F is readable as HALF_FLOAT essentially everywhere it exists,
      // and as FLOAT where EXT_color_buffer_float is present; half is
      // preferred simply because the readback buffer is half the size, and
      // at 24 megapixels that difference is ~190 MB.
      const readType = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
      const n = w * h * 4;
      const out = new Uint16Array(n);
      const rowsIn = w * 4;

      if (readType === gl.HALF_FLOAT) {
        const buf = new Uint16Array(n);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.HALF_FLOAT, buf);
        if (gl.getError() !== gl.NO_ERROR) return null;
        const tbl = halfTable();
        for (let y = 0; y < h; y++) {
          const s = (h - 1 - y) * rowsIn, d = y * rowsIn;   // GL is bottom-up
          for (let i = 0; i < rowsIn; i++) {
            const v = tbl[buf[s + i]];
            out[d + i] = v <= 0 ? 0 : v >= 1 ? 65535 : (v * 65535 + 0.5) | 0;
          }
        }
      } else {
        const buf = new Float32Array(n);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, buf);
        if (gl.getError() !== gl.NO_ERROR) return null;
        for (let y = 0; y < h; y++) {
          const s = (h - 1 - y) * rowsIn, d = y * rowsIn;
          for (let i = 0; i < rowsIn; i++) {
            const v = buf[s + i];
            out[d + i] = v <= 0 ? 0 : v >= 1 ? 65535 : (v * 65535 + 0.5) | 0;
          }
        }
      }
      return out;
    } catch (e) {
      return null;   // out of memory on a very large original, most likely
    } finally {
      this._noDither = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      if (fb) gl.deleteFramebuffer(fb);
      if (tex) gl.deleteTexture(tex);
    }
  }
}

/* IEEE 754 half -> float, as a 65,536-entry lookup built once on demand.
   Decoding bit-by-bit per channel is ~72 million branches on a 24 MP frame;
   a 256 KB table turns the whole thing into an array index. */
let _halfTable = null;
function halfTable() {
  if (_halfTable) return _halfTable;
  const t = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const s = (i & 0x8000) ? -1 : 1, e = (i & 0x7C00) >> 10, f = i & 0x03FF;
    if (e === 0)       t[i] = s * 6.103515625e-5 * (f / 1024);
    else if (e === 31) t[i] = f ? NaN : s * Infinity;
    else               t[i] = s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  _halfTable = t;
  return t;
}

// --- App State & UI Logic ---
const $ = id => document.getElementById(id);
/* ---------- UI language (main editing page only) ----------
   Scoped deliberately narrow: short, unambiguous labels only (headers,
   primary buttons) via data-i18n attributes in the HTML. The long technical
   notes and title="" tooltips explaining WHY a control works the way it
   does are left in English on purpose \u2014 machine-translating multi-sentence
   colour-science explanations risks getting the science wrong in another
   language (chroma vs saturation, a flipped direction), not just sounding
   awkward, and that risk isn't worth it for this pass. filters.html is a
   separate file and untouched by this.
   These translations were written directly, not run through a machine
   translator, but they are not a substitute for a native speaker's review
   \u2014 worth checking before treating any of them as final. */

/* sRGB transfer functions in JS, the same maths as the shader's. Here rather than in colour-mirror.js because the
   preset buttons (controls.js) use them while the page is still loading. */
function srgbToLinearF(c){return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function linearToSrgbF(c){c=Math.max(0,Math.min(1,c));return c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;}

/* Build 317: warm the shader before the first photo. The editor's main shader is very large, and the browser
   compiles it the moment the first photo opens, which on a mid-range phone can hold the page still for a second or
   more. While the start page is idle, the same source is compiled once in a throwaway WebGL2 context, on the
   driver's own thread (KHR_parallel_shader_compile), so the page never waits on it. Chrome keeps compiled programs
   keyed by their source, so the real compile when a photo opens is then mostly a cache hit. Nothing in the editor
   is touched; the context is dropped as soon as the compile is done. Skipped where the extension is missing (there
   it would block the page instead), when a photo is already open, and on the self-test. */
/* Apple's Metal compiler drops the connection on the full fragment shader (seen on a Mac Studio M4 Max, Chrome and Safari), so
   macOS builds a lighter variant (see SRC_LITE in shaders.js). ?lite=1 / ?lite=0 forces it either way for testing. */
const SRC_LITE_ON = (function () {
  try {
    const q = /[?&]lite=([01])/.exec(location.search); if (q) return q[1] === '1';
    return /Macintosh|Mac OS X/.test(navigator.userAgent);
  } catch (e) { return false; }
})();
function fsSource() { return SRC_LITE_ON ? '#define SRC_LITE\n' + FS_SOURCE : FS_SOURCE; }
(function shaderPrewarm() {
  if (typeof window === 'undefined' || typeof FS_SOURCE !== 'string') return;
  const start = () => {
    try {
      if ((typeof loadedImage !== 'undefined' && loadedImage) || (typeof engine !== 'undefined' && engine)) return;
      if (typeof SELFTEST !== 'undefined' && SELFTEST) return;
      const cv = document.createElement('canvas'); cv.width = cv.height = 4;
      const gl = cv.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
      if (!gl) return;
      const par = gl.getExtension('KHR_parallel_shader_compile'), lose = gl.getExtension('WEBGL_lose_context');
      const drop = () => { try { if (lose) lose.loseContext(); } catch (e) {} };
      if (!par) { drop(); return; }
      const mk = (t, src) => { const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
      const vs = mk(gl.VERTEX_SHADER, VS_SOURCE), fs = mk(gl.FRAGMENT_SHADER, fsSource());
      const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
      const t0 = performance.now();
      const poll = () => {
        let done = false; try { done = gl.isContextLost() || gl.getProgramParameter(pr, par.COMPLETION_STATUS_KHR); } catch (e) { done = true; }
        if (!done && performance.now() - t0 < 20000) { setTimeout(poll, 120); return; }
        window.__shaderPrewarmMs = Math.round(performance.now() - t0);
        drop();
      };
      setTimeout(poll, 120);
    } catch (e) {}
  };
  const later = () => { if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 4000 }); else setTimeout(start, 1500); };
  if (document.readyState === 'complete') setTimeout(later, 800); else window.addEventListener('load', () => setTimeout(later, 800), { once: true });
})();
