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
        if (typeof rawCanvas !== 'undefined' && rawCanvas) this.setImage(rawCanvas);
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
    const fs = compile(gl.FRAGMENT_SHADER, FS_SOURCE, 'fragment');

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
      image: gl.getUniformLocation(this.program, 'u_image'),
      lut: gl.getUniformLocation(this.program, 'u_lut'),
      lutPre: gl.getUniformLocation(this.program, 'u_lutPre'),
      lutPreSize: gl.getUniformLocation(this.program, 'u_lutPreSize'),
      lutPreMix: gl.getUniformLocation(this.program, 'u_lutPreMix'),
      hellwigVW: gl.getUniformLocation(this.program, 'u_hellwigVW'),
      lutSize: gl.getUniformLocation(this.program, 'u_lutSize'),
      lutMix: gl.getUniformLocation(this.program, 'u_lutMix'),
      texelSize: gl.getUniformLocation(this.program, 'u_texelSize'),
      clipView: gl.getUniformLocation(this.program, 'u_clipView'),
      cmykWarn: gl.getUniformLocation(this.program, 'u_cmykWarn'),
      gamutDrag: gl.getUniformLocation(this.program, 'u_gamutDrag'),
      dither: gl.getUniformLocation(this.program, 'u_dither'),
      deband: gl.getUniformLocation(this.program, 'u_deband'), debandRad: gl.getUniformLocation(this.program, 'u_debandRad'),
      caR: gl.getUniformLocation(this.program, 'u_caR'),
      caB: gl.getUniformLocation(this.program, 'u_caB'),
      hotspot: gl.getUniformLocation(this.program, 'u_hotspot'),
      hotSize: gl.getUniformLocation(this.program, 'u_hotSize'),
      curve: gl.getUniformLocation(this.program, 'u_curve'),
      curveOn: gl.getUniformLocation(this.program, 'u_curveOn'),
      curveLum: gl.getUniformLocation(this.program, 'u_curveLum'),
      epdOn: gl.getUniformLocation(this.program, 'u_epdOn'), epdProbe: gl.getUniformLocation(this.program, 'u_epdProbe'),
      epdTemp: gl.getUniformLocation(this.program, 'u_epdTemp'), epdBoost: gl.getUniformLocation(this.program, 'u_epdBoost'),
      epdS: gl.getUniformLocation(this.program, 'u_epdS'), epdNorm: gl.getUniformLocation(this.program, 'u_epdNorm'),
      epdBase: gl.getUniformLocation(this.program, 'u_epdBase'), epdRef: gl.getUniformLocation(this.program, 'u_epdRef'),
      maskN: gl.getUniformLocation(this.program, 'u_maskN'),
      maskProbe: gl.getUniformLocation(this.program, 'u_maskProbe'), maskGuideOn: gl.getUniformLocation(this.program, 'u_maskGuideOn'),
      maskGuide: gl.getUniformLocation(this.program, 'u_maskGuide'), mGuideTexel: gl.getUniformLocation(this.program, 'u_mGuideTexel'),
      maskView: gl.getUniformLocation(this.program, 'u_maskView'),
      mGeom: gl.getUniformLocation(this.program, 'u_mGeom[0]'),
      mInfo: gl.getUniformLocation(this.program, 'u_mInfo[0]'),
      mAdj: gl.getUniformLocation(this.program, 'u_mAdj[0]'),
      mAdj2: gl.getUniformLocation(this.program, 'u_mAdj2[0]'),
      bandPreview: gl.getUniformLocation(this.program, 'u_bandPreview'),
      lutDomainMin: gl.getUniformLocation(this.program, 'u_lutDomainMin'),
      lutDomainMax: gl.getUniformLocation(this.program, 'u_lutDomainMax'),
      matrix: gl.getUniformLocation(this.program, 'u_matrix'),
      mOffset: gl.getUniformLocation(this.program, 'u_mOffset'),
      camFit: gl.getUniformLocation(this.program, 'u_camFit'),
      camCoef: gl.getUniformLocation(this.program, 'u_camCoef'),
      bandCount: gl.getUniformLocation(this.program, 'u_bandCount'),
      bandHue: gl.getUniformLocation(this.program, 'u_bandHue'),
      bandWidth: gl.getUniformLocation(this.program, 'u_bandWidth'),
      bandDH: gl.getUniformLocation(this.program, 'u_bandDH'),
      bandDS: gl.getUniformLocation(this.program, 'u_bandDS'),
      bandLo: gl.getUniformLocation(this.program, 'u_bandLo'),
      bandHi: gl.getUniformLocation(this.program, 'u_bandHi'),
      bandSelectivity: gl.getUniformLocation(this.program, 'u_bandSelectivity'),
      bandAB: gl.getUniformLocation(this.program, 'u_bandAB'),
      srcGuide: gl.getUniformLocation(this.program, 'u_srcGuide'), srcGuideTexel: gl.getUniformLocation(this.program, 'u_srcGuideTexel'),
      srcGuideOn: gl.getUniformLocation(this.program, 'u_srcGuideOn'), srcProbe: gl.getUniformLocation(this.program, 'u_srcProbe'),
      bandPC: gl.getUniformLocation(this.program, 'u_bandPC'),
      bandDL: gl.getUniformLocation(this.program, 'u_bandDL'),
      preWB: gl.getUniformLocation(this.program, 'u_preWB'),
      postWB: gl.getUniformLocation(this.program, 'u_postWB'),
      preWBM: gl.getUniformLocation(this.program, 'u_preWBM'),
      postWBM: gl.getUniformLocation(this.program, 'u_postWBM'),
      wbMethod: gl.getUniformLocation(this.program, 'u_wbMethod'),
      hueSpace: gl.getUniformLocation(this.program, 'u_hueSpace'),
      lumPreserve: gl.getUniformLocation(this.program, 'u_lumPreserve'),
      lumaW: gl.getUniformLocation(this.program, 'u_lumaW'),
      tempTint: gl.getUniformLocation(this.program, 'u_tempTint'),
      satPreserve: gl.getUniformLocation(this.program, 'u_satPreserve'),
      contrast: gl.getUniformLocation(this.program, 'u_contrast'),
      exposure: gl.getUniformLocation(this.program, 'u_exposure'),
      brightness: gl.getUniformLocation(this.program, 'u_brightness'),
      hue: gl.getUniformLocation(this.program, 'u_hue'),
      sat: gl.getUniformLocation(this.program, 'u_sat'),
      vibrance: gl.getUniformLocation(this.program, 'u_vibrance'),
      blackPt: gl.getUniformLocation(this.program, 'u_blackPt'),
      whitePt: gl.getUniformLocation(this.program, 'u_whitePt'),
      noiseReduction: gl.getUniformLocation(this.program, 'u_noiseReduction'),
      inputLinear: gl.getUniformLocation(this.program, 'u_inputLinear'),
      hlRecover: gl.getUniformLocation(this.program, 'u_hlRecover'),
      sharpen: gl.getUniformLocation(this.program, 'u_sharpen'),
      sharpenRadius: gl.getUniformLocation(this.program, 'u_sharpenRadius'),
      sharpenMask: gl.getUniformLocation(this.program, 'u_sharpenMask'),
      noiseColour: gl.getUniformLocation(this.program, 'u_noiseColour'),
      nrScale: gl.getUniformLocation(this.program, 'u_nrScale'),
      contrastPivot: gl.getUniformLocation(this.program, 'u_contrastPivot'),
      hiPivot: gl.getUniformLocation(this.program, 'u_hiPivot'),
      hslOn: gl.getUniformLocation(this.program, 'u_hslOn'), skyDeep: gl.getUniformLocation(this.program, 'u_skyDeep'), crimson: gl.getUniformLocation(this.program, 'u_crimson'), skyLab: gl.getUniformLocation(this.program, 'u_skyLab'), skyCol: gl.getUniformLocation(this.program, 'u_skyCol'), maskSize: gl.getUniformLocation(this.program, 'u_maskSize'), skyL: gl.getUniformLocation(this.program, 'u_skyL'), skyShow: gl.getUniformLocation(this.program, 'u_skyShow'), skyMask: gl.getUniformLocation(this.program, 'u_skyMask'),
      bandProbe: gl.getUniformLocation(this.program, 'u_bandProbe'), bandGuideOn: gl.getUniformLocation(this.program, 'u_bandGuideOn'), bandGuide: gl.getUniformLocation(this.program, 'u_bandGuide'), guideTexel: gl.getUniformLocation(this.program, 'u_guideTexel'),
      hslH0: gl.getUniformLocation(this.program, 'u_hslH0'), hslH1: gl.getUniformLocation(this.program, 'u_hslH1'),
      hslS0: gl.getUniformLocation(this.program, 'u_hslS0'), hslS1: gl.getUniformLocation(this.program, 'u_hslS1'),
      hslL0: gl.getUniformLocation(this.program, 'u_hslL0'), hslL1: gl.getUniformLocation(this.program, 'u_hslL1'),
      shW: gl.getUniformLocation(this.program, 'u_shW'),
      filmTone: gl.getUniformLocation(this.program, 'u_filmTone'),
      indexMode: gl.getUniformLocation(this.program, 'u_indexMode'),
      highlights: gl.getUniformLocation(this.program, 'u_highlights'),
      shadows: gl.getUniformLocation(this.program, 'u_shadows'),
      clarity: gl.getUniformLocation(this.program, 'u_clarity'),
      dehaze:  gl.getUniformLocation(this.program, 'u_dehaze'),
      calRH:    gl.getUniformLocation(this.program, 'u_calRH'),
      calGH:    gl.getUniformLocation(this.program, 'u_calGH'),
      calBH:    gl.getUniformLocation(this.program, 'u_calBH'),
      calRS:    gl.getUniformLocation(this.program, 'u_calRS'),
      calGS:    gl.getUniformLocation(this.program, 'u_calGS'),
      calBS:    gl.getUniformLocation(this.program, 'u_calBS'),
      calST:    gl.getUniformLocation(this.program, 'u_calST'),
      swapSpace: gl.getUniformLocation(this.program, 'u_swapSpace'),
      swapT: gl.getUniformLocation(this.program, 'u_swapT'),
      swapTi: gl.getUniformLocation(this.program, 'u_swapTi'),
      vigAmt: gl.getUniformLocation(this.program, 'u_vigAmt'),
      vigFall: gl.getUniformLocation(this.program, 'u_vigFall'),
      vigSpread: gl.getUniformLocation(this.program, 'u_vigSpread'),
      vigCentre: gl.getUniformLocation(this.program, 'u_vigCentre'),
      aspect: gl.getUniformLocation(this.program, 'u_aspect'),
      prep: gl.getUniformLocation(this.program, 'u_prep'),
      prepped: gl.getUniformLocation(this.program, 'u_prepped'),
      src: gl.getUniformLocation(this.program, 'u_src')
    };
  }

  initBuffers() {
    const gl = this.gl;
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const texBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
    const aTex = gl.getAttribLocation(this.program, 'a_texCoord');
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0);
  }

  setImage(img) {
    const gl = this.gl;
    this.canvas.width = img.width;
    this.canvas.height = img.height;
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
    if (!this.isWebGL2 || !(p && p.bands && p.bands.length) || this._sgFail) return false;
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
    gl.uniform1i(this.uLocs.hueSpace, p.hueSpace === 'channel' ? 1 : 0);
    gl.uniform1i(this.uLocs.lumPreserve, p.lumPreserve ? 1 : 0);
    gl.uniform3fv(this.uLocs.lumaW, new Float32Array(p.lumaW || [0.2126, 0.7152, 0.0722]));
    gl.uniform3fv(this.uLocs.postWB, new Float32Array(p.postWB));
    gl.uniform3fv(this.uLocs.tempTint, new Float32Array(p.tempTint || [1,1,1]));
    gl.uniform1f(this.uLocs.satPreserve, (p.satPreserve || 0) / 100);
    gl.uniform1f(this.uLocs.contrast, contrastStrength(p.contrast));
    gl.uniform1f(this.uLocs.contrastPivot, p.contrastPivot === undefined ? 0.5 : p.contrastPivot);
    gl.uniform1f(this.uLocs.hiPivot, p.hiPivot === undefined ? 0.10 : p.hiPivot);
    gl.uniform1f(this.uLocs.shW, p.shW === undefined ? 1.0 : p.shW);
    gl.uniform1f(this.uLocs.bandProbe, p.__bandProbe ? 1 : 0);
    gl.uniform1f(this.uLocs.srcProbe, p.__srcProbe ? 1 : 0);
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
    gl.uniform1f(this.uLocs.dither, (p.dither === false || this._noDither) ? 0 : 1);
    gl.uniform1f(this.uLocs.caR, p.caR || 0);
    gl.uniform1f(this.uLocs.caB, p.caB || 0);
    gl.uniform3f(this.uLocs.hotspot, p.hotspot ? p.hotspot[0] : 0, p.hotspot ? p.hotspot[1] : 0, p.hotspot ? p.hotspot[2] : 0);
    gl.uniform1f(this.uLocs.hotSize, p.hotSize || 0.35);
    /* Tone curve table on unit 4. Re-uploaded only when its key changes, so a
       steady frame costs nothing. Half-float on WebGL2 so a shallow part of
       the curve does not collapse neighbouring levels; 8-bit otherwise. */
    if (p.curveOn && p.curveLut) {
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
    if (!need) return false;
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
                   p.deband || 0, p.vigCX === undefined ? 0.5 : p.vigCX, p.vigCY === undefined ? 0.5 : p.vigCY].join(',');
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
