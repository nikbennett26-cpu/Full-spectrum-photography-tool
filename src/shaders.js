'use strict';
/* irlab editor: js/shaders.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* Surfaces anything that fails silently otherwise. This exact bug shape —
   a decode completes, a status message shows, then nothing, no error
   anywhere — is what an uncaught exception or a rejected promise nobody
   awaits looks like from the outside: the browser logs it to a console
   most people never open, and the app just stops. Rather than rely on
   every async path remembering its own try/catch, one net at the top
   catches whatever slips through and actually shows it, so "nothing
   happened" becomes a message that says what happened instead. */
window.addEventListener('error', (e) => {
  console.error('Uncaught error:', e.error || e.message);
  alert('Something went wrong and stopped partway through:\n\n' +
        (e.error && e.error.message ? e.error.message : e.message) +
        '\n\nA screenshot of this, along with what you were doing, is the fastest way to get it fixed.');
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  console.error('Unhandled promise rejection:', reason);
  alert('Something went wrong and stopped partway through:\n\n' +
        (reason && reason.message ? reason.message : String(reason)) +
        '\n\nA screenshot of this, along with what you were doing, is the fastest way to get it fixed.');
});

// --- WebGL Shaders ---
const VS_SOURCE = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y);
  }
`;

const FS_SOURCE = `
  precision highp float;
  uniform sampler2D u_image;
  uniform sampler2D u_lut;
  uniform float u_lutSize;      // 0 = no LUT bound
  uniform float u_lutMix;
  uniform vec2 u_texelSize;    // 1/width, 1/height of the SOURCE image \u2014 used by the band-matching noise smoothing above and by noise reduction below
  uniform float u_noiseReduction;   // 0..1
  uniform float u_inputLinear;      // 1 when the texture is linear scene-referred
  uniform float u_hlRecover;        // 0..1, rolls headroom above white back in
  uniform float u_sharpen;          // 0..1, capture sharpening amount
  uniform float u_sharpenRadius;    // in texels, 0.5..3.0
  uniform float u_sharpenMask;      // 0..1, how strongly to hold off flat areas
  uniform float u_noiseColour;      // 0..1, chroma denoise, independent of luma
  uniform float u_nrScale;          // source px per working-preview px (1 in the preview, ~2.5 for an 18MP full-res render)
  uniform sampler2D u_lutPre;    // built-in film LUT, applied EARLY
  uniform float u_lutPreSize;
  uniform float u_lutPreMix;
  // Fixed, always-present lookup for Vibrance's weighting -- see the JS
  // comment above hueSatF for the full story (Hellwig2022's M, precomputed,
  // not this texture's own separate LUT format concern). Unlike u_lut/
  // u_lutPre this one is never user-supplied and never changes size or
  // domain, so it needs none of their size/mix/domain uniforms -- just the
  // texture itself, always bound, always sampled the same way.
  uniform sampler2D u_hellwigVW;
  uniform int u_indexMode;   // 0 off, 1 NDVI (R vs G), 2 NGB (R vs B)

  /* Normalised difference index, false-coloured by VALUE rather than by
     channel mix. (NIR - X) / (NIR + X) is a ratio, and the channel matrix is
     nine multiply-adds with no divide in it — so this genuinely cannot be
     expressed as a preset, which is why it is its own mode rather than a
     row in the matrix.

     On a full-spectrum conversion the red channel carries NIR, so R is the
     NIR term. NDVI pairs it against green, NGB against blue; blue is the
     deeper photosynthetic absorber, which is what makes NGB separate
     stressed from healthy foliage more cleanly on converted cameras.

     Ramp is the conventional one for vegetation work: water and bare ground
     cold, sparse growth through yellow, dense canopy hot. Deliberately not
     the safelight palette — this is a measurement readout, and it should not
     be mistakable for a photograph. */
  /* Stops placed where the materials actually fall rather than at even
     intervals. Measured on typical IR-converted values: live foliage lands
     near +0.88, bare wood +0.51, gravel +0.16, sky -0.68. Evenly spaced
     bands put wood and gravel in the same yellow, which is what made
     structures disappear into a field; the two are 0.35 apart and should
     not share a colour. Most of the palette now covers 0 to +1, because
     that is where everything on land sits — the negative half only needs
     enough range to separate sky and water. */
  vec3 indexRamp(float t) {
    t = clamp(t, -1.0, 1.0);
    if (t < -0.30) return mix(vec3(0.04,0.04,0.20), vec3(0.10,0.30,0.55), (t + 1.0) / 0.70);
    if (t <  0.10) return mix(vec3(0.10,0.30,0.55), vec3(0.45,0.55,0.60), (t + 0.30) / 0.40);
    if (t <  0.35) return mix(vec3(0.45,0.55,0.60), vec3(0.75,0.65,0.40), (t - 0.10) / 0.25);
    if (t <  0.60) return mix(vec3(0.75,0.65,0.40), vec3(0.95,0.85,0.20), (t - 0.35) / 0.25);
    if (t <  0.80) return mix(vec3(0.95,0.85,0.20), vec3(0.45,0.75,0.15), (t - 0.60) / 0.20);
    return mix(vec3(0.45,0.75,0.15), vec3(0.02,0.35,0.05), (t - 0.80) / 0.20);
  }
  uniform float u_clipView;   // 0 = off; >0 paints out-of-range pixels
  uniform float u_cmykWarn;   // 0 = off; >0 also flags colours ink cannot reach
  uniform float u_gamutDrag;  // 0 = off; >0 hatches only the gamut-mapped (amber) pixels
  uniform float u_dither;     // 1 = triangular dither on the 8-bit output (preview only)
uniform float u_deband;     // 0..1: how hard to smooth banding in the 8-bit source; 0 = off
uniform float u_debandRad;  // reach, in source texels, at full strength
  uniform float u_caR;        // lateral CA: radial scale of red relative to green
  uniform float u_caB;        // ... and of blue
  uniform vec3  u_hotspot;    // per-channel centre darkening, linear light, before the swap
  uniform float u_hotSize;    // hotspot radius in image heights
  uniform vec2 u_vigCentre;     // 0..1 in texture space
  uniform float u_aspect;       // canvas width / height, so the falloff is a true circle
  /* Two-pass rendering. The first pass (u_prep = 1) does the stages that belong to the SOURCE picture -- decoding to
     light, hotspot, exposure, highlight recovery and noise reduction -- and writes the result, sRGB-encoded, into an
     off-screen image. The main pass then reads that image (u_prepped = 1) instead of the original, so every stage that
     looks at neighbouring pixels (sharpening, clarity, dehaze, highlights and shadows, targeted colour) sees the same
     picture the centre pixel came from: denoised, exposed and in one encoding. Before this they read the untouched
     original, which on a RAW is linear rather than encoded, and never includes exposure or noise reduction -- so
     clarity acted like a second exposure slider, sharpening put back the noise noise reduction had taken out, and noise
     reduction on a RAW compared encoded and linear values and did almost nothing. When the first pass is unavailable
     (WebGL1, or a buffer that will not allocate) the same stages run inline and each neighbour is brought through
     them on the fly, so the encodings still match. u_src is always the untouched original, for the sky selection,
     which is measured on the source on purpose. */
  uniform float u_prep;
  uniform float u_prepped;
  uniform sampler2D u_src;
  uniform sampler2D u_curve;  // 1024x1 tone curve, R/G/B = the three channel curves
  uniform float u_curveOn;
  uniform float u_curveLum;   // 1 = the RGB curve acts on luminance only (its table rides in the alpha channel)
  uniform float u_maskN;          // how many local masks are live (0..4)
  uniform float u_maskProbe;      // 1 = write the colour as it reaches the local adjustments and stop (the mask guide pass)
  uniform float u_maskGuideOn;    // 1 = colour and luminosity masks read smoothed colour from u_maskGuide
  uniform sampler2D u_maskGuide; uniform vec2 u_mGuideTexel;
  uniform float u_maskView;       // -1 = off, else the index of the mask shown as a matte
  uniform vec4 u_mGeom[4];        // linear: x0,y0,x1,y1 | radial: cx,cy,rx,ry | luminosity: lo,hi,0,0
  uniform vec4 u_mInfo[4];        // type (0 linear, 1 radial, 2 luminosity, 3 colour, 4 foliage/IR index), feather 0..1, invert 0/1, 0
  uniform vec4 u_mAdj[4];         // exposure EV, contrast strength (1 = none), saturation multiplier, temperature
  uniform vec4 u_mAdj2[4];        // tint, 0, 0, 0
  uniform int u_bandPreview;  // -1 = off, else the index of the band to show
  uniform vec3 u_lutDomainMin;
  uniform vec3 u_lutDomainMax;
  uniform mat3 u_matrix;
  /* Per-output-channel constant, added after the mix. This is the fourth
     column of a 4x4: a 3x3 can only redistribute light that is already in
     the channels, so it can never lift one that is near zero. The offset
     can, which is what lets a dead shadow take a tint. Applied in linear
     light like the mix itself, and scaled down because a full 0..1 offset
     would be far too coarse at slider resolution. */
  uniform vec3 u_mOffset;
  /* Camera-colour match: a cubic polynomial fitted, per file, from the raw
     sensor decode to the camera's own embedded JPEG of the same frame.

     The point is that it is NOT a matrix. A 3x3 can only rotate and scale
     the colour space as a whole, so when the raw channels come out nearly
     collinear — which is what a narrowband filter over a full-spectrum
     sensor does — no matrix can pull two materials apart that arrived at
     almost the same RGB ratio. Measured on a real file: bush and ground sat
     at hue 41.3 and 40.0, and the best-fit matrix left them there. The
     cubic terms can bend the space locally instead, learning "this
     particular muddy yellow becomes deep magenta" pointwise, which is what
     the camera's own non-linear pipeline was doing all along. Same two
     samples through this: 257.7 and 256.7, against the camera's 257.3 and
     257.7.

     20 terms per output channel, in the same order feats() builds them in
     JS: 1, r, g, b, rg, rb, gb, rr, gg, bb, rrr, ggg, bbb, rgb, rrg, rrb,
     ggr, ggb, bbr, bbg. Identity when unset, so this is a no-op until a
     file has actually been fitted. */
  uniform float u_camFit;              // 0 off, 1 on
  uniform vec3 u_camCoef[20];
  /* Fixed, not user-tunable — the standard linear sRGB <-> linear
     ProPhoto RGB primaries conversion (via Bradford-adapted D65->D50),
     not something to expose a control for. Found via Fedia: applying a
     channel swap while the data is expressed in a wide gamut's
     primaries, then converting back down to sRGB, comes out different
     (and on real camera-processed colour — not raw sensor data, where
     this has no separation to work with — more vivid) than swapping
     directly in sRGB, because a wide gamut can hold more of a saturated
     colour's true position before the swap moves it, so more survives
     the compression back down. Verified numerically before building
     this: on the embedded-JPEG bush/ground samples from a real file,
     ground went from 70% to 98% saturation with the existing hue
     separation intact, not collapsed — the raw decoder's collinear
     channels get no such benefit, since composing linear steps stays
     linear and can't manufacture separation that isn't already there.

     ProPhoto instead of Rec2020: ProPhoto's primaries are wider still
     than Rec2020's, so it holds even more of a saturated colour's true
     position before the swap moves it — the same reasoning above,
     taken further. No longer a user-facing toggle between the swap
     happening in a narrow space (sRGB/"709") versus a wide one either —
     there was never a real reason to offer doing this specific
     operation in a narrow space to begin with, so the wide-gamut swap
     now always runs, silently, matching how this file already treats
     the ProPhoto-space RAW-decode swap the same way. */
  const mat3 SRGB_TO_PROPHOTO = mat3(
    0.529377, 0.098376, 0.016879,
    0.330109, 0.873450, 0.117656,
    0.140557, 0.028163, 0.865257
  );
  const mat3 PROPHOTO_TO_SRGB = mat3(
    2.033966, -0.228808, -0.008564,
    -0.727392, 1.231754, -0.153302,
    -0.306733, -0.002924, 1.162106
  );
  /* Rec2020, brought back as a user choice alongside Colour Calibration.
     Narrower than ProPhoto but still wider than sRGB -- some users prefer
     its milder saturation lift on the swap to ProPhoto's stronger one.
     Same Bradford-adapted derivation as the ProPhoto pair; round-trip
     verified to 1e-6 before reuse. u_swapSpace picks between this, sRGB
     (identity -- no separation gained, the original un-widened behaviour),
     and ProPhoto (today's default, unchanged for anyone who doesn't touch
     the new control). */
  const mat3 SRGB_TO_REC2020 = mat3(
    0.627404, 0.069097, 0.016391,
    0.329283, 0.919541, 0.088013,
    0.043313, 0.011362, 0.895595
  );
  const mat3 REC2020_TO_SRGB = mat3(
    1.660491, -0.124551, -0.018151,
    -0.587641, 1.132898, -0.100579,
    -0.072850, -0.008348, 1.118729
  );
  uniform vec3 u_preWB;
  uniform vec3 u_postWB;
  uniform mat3 u_preWBM;
  uniform mat3 u_postWBM;
  uniform int u_wbMethod;   // 0 = per-channel gains (u_preWB/u_postWB), 1 = Bradford (the mat3 pair)
  uniform vec3 u_tempTint;
  uniform float u_satPreserve;
  uniform float u_contrast;
  uniform float u_exposure;
uniform float u_epdOn;     // 1 = edge-preserving tone mapping is applied
uniform float u_epdProbe;  // 1 = write the lightness the tone mapping would see, instead of the picture (how its base is measured)
uniform float u_epdTemp, u_epdBoost, u_epdS, u_epdNorm;
uniform float u_epdRef;    // the (linear) exposure the base was measured at
uniform sampler2D u_epdBase;   // the smooth, edge-stopping base layer of the log lightness, at reduced size
  uniform float u_brightness;   // -1..1, additive, midtone-weighted — see its application site for why this differs from Exposure
  uniform float u_hue;
  uniform float u_sat;
  uniform float u_vibrance;
  uniform float u_blackPt;
  uniform float u_whitePt;
  varying vec2 v_texCoord;

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
  }

  vec3 linearToSrgb(vec3 c) {
    vec3 clamped = clamp(c, 0.0, 1.0);
    return mix(clamped * 12.92, 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), clamped));
  }

  // Soft-knee highlight protection — a standard tanh-based soft clip, the
  // same generic technique used broadly in HDR tone mapping and audio
  // limiting, not specific to any one tool. Values above the threshold ease
  // toward 1.0 instead of hard-clipping. The threshold sits deliberately
  // high (0.96, not compressing until near-true-white) after checking the
  // old lower threshold (0.75) directly: it was already compressing 0.75-
  // 0.95 linear-light values — a realistic range for ordinary sunlit
  // highlight detail, well short of blown-out — down to 83% of their
  // natural spread before this fix, which flattens exactly the kind of
  // shadow-to-highlight tonal separation (e.g. deep red in shaded foliage
  // easing toward gold in sunlit foliage) that should survive a channel
  // swap. This range is now left completely untouched; only genuine
  // near-white values get the soft roll-off.
  float compressChan(float v) {
    const float threshold = 0.96;
    const float softness = 0.04; // threshold+softness must not exceed 1.0
    if (v < 0.0) return 0.0;
    if (v <= threshold) return v;
    float x = (v - threshold) / softness;
    return threshold + softness * ((exp(x) - exp(-x)) / (exp(x) + exp(-x)));
  }

  /* Soft roll-off toward 1.0. GLSL ES 1.00 has no tanh() — compressChan
     above already writes it out longhand for exactly this reason, so this
     matches rather than reaching for a builtin that only exists in ES 3.00.
     x is capped because exp() overflows to inf in float32 well before the
     inputs here can: relRaw is a ratio whose denominator is only guarded at
     1e-6, so it can legitimately be enormous, and inf/inf is NaN. */
  float softKnee(float v, float k) {
    if (v < k) return v;
    float x = min((v - k) / (1.0 - k), 12.0);
    float e = exp(x), en = exp(-x);
    return k + (1.0 - k) * ((e - en) / (e + en));
  }

  vec3 compressGamut(vec3 v) {
    /* Was per-channel independent, which meant a pixel with one channel near
       1.0 and the others meaningfully lower — exactly the shape the anchor-
       shift fix above now produces more of, on purpose — got its channels
       compressed by DIFFERENT amounts and drifted off its original hue by a
       measurable degree or two. Checked directly rather than assumed: with
       the fix below, that drift goes to exactly zero, not just smaller,
       because scaling every channel by the SAME ratio preserves the ratios
       between them exactly, and hue is defined entirely by those ratios. */
    float mx = max(max(v.r, v.g), v.b);
    if (mx <= 0.0) return v;
    float ratio = compressChan(mx) / mx;
    return v * ratio;
  }

  const vec3 LUMW = vec3(0.2126, 0.7152, 0.0722);
  /* A SEPARATE weight vector for the "hold brightness through the swap"
     feature, deliberately not the same one used for gamut mapping and
     highlight/shadow masking above. Those stay on Rec.709 because they are
     about how a human eye reads a finished picture on screen \u2014 that has
     not changed just because the source is a converted sensor.

     What HAS changed is the physical signal. Rec.709 assumes green carries
     the most information, which is backwards on IR: green is often the
     weakest channel, and red or blue is carrying the bulk of the infrared
     signal depending on the swap. Preserving "brightness" with the wrong
     weights means the feature measures the wrong thing before and after,
     so a heavy Aerochrome-style swap can still look flat or wrongly exposed
     even with this switched on \u2014 it was faithfully preserving a number
     that was never the right number to preserve.

     Defaults to LUMW so behaviour is unchanged until someone sets it. */
  uniform vec3 u_lumaW;

  /* How far outside [0,1] a pixel was driven BEFORE anything brought it back.

     The clipping overlay used to test the final colour, which cannot tell the
     difference between a channel that landed on zero and one that was pushed
     below zero and clamped. A saturated yellow legitimately has B = 0 and has
     lost nothing; a crushed shadow computes B = -0.08 and has lost a great
     deal. Both read as 0 at the end. Measuring at the point the range is
     actually enforced is the only way to separate them, and it is why a whole
     yellow tent used to hatch blue.

     Reset explicitly at the top of main() rather than trusting the
     initialiser, since these are written from several stages. */
  float g_over = 0.0;    // furthest any channel went above 1.0
  float g_under = 0.0;   // furthest any channel went below 0.0
  /* How strongly the band being previewed claimed this pixel, 0..1. Carried
     out to the overlay the same way the clipping globals are, because the
     weight is only known inside targetedHSL and the overlay draws at the end
     of main(). */
  float g_bandW = 0.0;

  /* Hue-preserving gamut mapping.

     Per-channel clipping is what makes channel-swapped output look coarse.
     A swap matrix routinely drives a channel out of range at both ends —
     the IR-sub presets subtract 30% outright, so shadows go negative, and a
     bright sky after a swap easily pushes one channel past 1.0. Clamping
     each channel on its own moves the three of them by DIFFERENT amounts,
     which is a hue rotation: negative-clipped shadows swing toward whatever
     channels survived, and blown highlights go cyan or yellow instead of
     white. Both are visible as a flat, plastic patch where detail used to be.

     Instead, pull chroma in toward this pixel's own luminance — the minimum
     amount needed to bring both the darkest and brightest channel into
     range. Hue is exactly preserved (all three channels move along the same
     line toward grey), luminance is exactly preserved, and only saturation
     gives way. Out-of-range colour degrades into a less saturated version of
     itself rather than into a different colour. */
  /* The actual colour-mixing part of gamut correction, factored out so it
     can be reused with an EXTERNALLY CHOSEN anchor, not just the one
     gamutMapT computes for itself. This split exists because of a real bug:
     the luminance-restore stage (below, in main()) used to call gamutMapT
     directly after rescaling toward a target brightness, and gamutMapT would
     silently compute its OWN anchor from its own overshoot formula and
     override whatever target the caller was actually trying to reach —
     confirmed numerically before this fix: asked for luminance 0.850, the
     old code delivered 0.719, because gamutMapT had no way to know a
     specific value was being aimed for. Same hue-exact, same-safety-net
     mixing either way; only where the anchor comes from differs. */
  vec3 gamutMixToAnchor(vec3 c, float anchor, out float pull) {
    float mn = min(min(c.r, c.g), c.b);
    float mx = max(max(c.r, c.g), c.b);
    float t = 1.0;
    if (mn < 0.0)  t = min(t, anchor / max(anchor - mn, 1e-6));
    if (mx > 1.0)  t = min(t, (1.0 - anchor) / max(mx - anchor, 1e-6));
    t = clamp(t, 0.0, 1.0);
    pull = 1.0 - t;
    c = mix(vec3(anchor), c, t);
    c = clamp(c, 0.0, 1.0);
    return compressGamut(c);
  }

  /* When a colour lands outside the gamut, something has to give, and there
     are exactly two honest ways to give it:

       - desaturate toward the pixel's own luminance, staying bright but
         washing the colour out
       - scale every channel down uniformly, keeping the colour rich but
         letting it go darker

     Both preserve hue exactly. Neither is "correct" — this is the real
     trade-off behind a long-running piece of feedback, and it is NOT a
     clipping bug: rotating a fully saturated yellow 180 degrees asks for a
     blue at yellow's lightness, and no such colour exists in sRGB at all,
     because blue's own ceiling is 12.9x dimmer than yellow's. OKLab
     correctly holds perceptual lightness through the rotation, which puts
     the result far out of gamut (measured: 2.43 in blue), and then THIS
     function decides how to pay for that.

     Measured on exactly that case: desaturating leaves saturation spread
     0.333 (pale, washed blue); scaling down uniformly leaves 0.717 (rich,
     darker blue). u_satPreserve blends continuously between them, so the
     choice belongs to whoever is editing rather than being hardcoded. An
     earlier attempt at this problem tried to restore brightness AFTER the
     desaturation had already happened, which cannot work — the colour
     information is gone by then. This acts at the point the decision is
     actually made. */
  vec3 gamutMapT(vec3 c, out float pull) {
    float lum = clamp(dot(c, LUMW), 0.0, 1.0);
    float mn = min(min(c.r, c.g), c.b);
    float mx = max(max(c.r, c.g), c.b);
    // Recorded before the early return so the in-range case is measured too
    // (it contributes zero) and every path through this function reports.
    g_over  = max(g_over,  mx - 1.0);
    g_under = max(g_under, -mn);
    if (mn >= 0.0 && mx <= 1.0) { pull = 0.0; return compressGamut(c); }
    /* Anchor moves toward mid-grey BEFORE solving t, not after — an
       additive shift applied after the fact cancels out of the channels'
       spread by construction and cannot restore saturation, confirmed
       numerically in an earlier pass at this function. Gain/cap (1.1, 0.55)
       account for this running TWICE on one pixel in practice — once here,
       again after hue rotation lower in main() — since two independently-
       capped passes compound into more desaturation than either intends on
       its own; measured directly, the previous constants left a compounded
       case at sat=0.09, these leave it at 0.21. */
    float overshoot = max(max(mx - 1.0, -mn), 0.0);
    float shift = min(0.55, overshoot * 1.1);
    float anchor = lum + (0.5 - lum) * shift;
    vec3 desat = gamutMixToAnchor(c, anchor, pull);

    if (u_satPreserve <= 0.0) return desat;

    // uniform scale: divides out the overshoot, so every channel keeps its
    // ratio to the others -- hue AND saturation survive intact, brightness
    // is what pays. Shadow lift below is likewise uniform.
    vec3 scaled = c;
    if (mx > 1.0) scaled = c / mx;
    float smn = min(min(scaled.r, scaled.g), scaled.b);
    if (smn < 0.0) scaled = (scaled - smn) / (1.0 - smn);
    scaled = clamp(scaled, 0.0, 1.0);
    scaled = compressGamut(scaled);

    return mix(desat, scaled, u_satPreserve);
  }
  vec3 gamutMap(vec3 c) { float ignored; return gamutMapT(c, ignored); }

  /* ---------- OKLab ----------
     Hue and saturation were previously done in HSL, which is a poor model
     for this job on two counts. Its "lightness" is (max+min)/2, which has
     nothing to do with perceived brightness, so raising saturation visibly
     changes how bright a colour looks. And its hue axis is badly non-uniform
     — a 30 degree rotation moves a green a long way and a blue barely at
     all — which matters enormously here, since pushing hue by large amounts
     is the entire point of a false-colour tool.

     OKLab is perceptually uniform: rotating hue in it rotates hue and does
     nothing else, and scaling chroma changes saturation without dragging
     lightness or hue along with it. Coefficients are Bjorn Ottosson's. */
  vec3 cbrt3(vec3 v) {
    return sign(v) * pow(abs(v), vec3(1.0 / 3.0));
  }
  vec3 linearToOklab(vec3 c) {
    vec3 lms = vec3(
      0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
      0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
      0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
    vec3 n = cbrt3(lms);
    return vec3(
      0.2104542553 * n.x + 0.7936177850 * n.y - 0.0040720468 * n.z,
      1.9779984951 * n.x - 2.4285922050 * n.y + 0.4505937099 * n.z,
      0.0259040371 * n.x + 0.7827717662 * n.y - 0.8086757660 * n.z);
  }
  vec3 oklabToLinear(vec3 lab) {
    vec3 n = vec3(
      lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
      lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
      lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z);
    vec3 lms = n * n * n;
    return vec3(
       4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
      -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
      -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
  }
  // hueFrac is turns (slider degrees / 360); sat is a plain chroma multiplier

  // hueFrac is turns (slider degrees / 360); sat is a plain chroma multiplier
  /* Largest saturation (C/L) the sRGB gamut allows in a given hue direction.
     Ottosson's analytic approximation plus one Halley step — accurate to
     0.0014 in chroma against a numerical search, checked over the full hue
     circle, and a few dozen flops instead of the hundreds a per-pixel search
     would cost. */
  float maxSaturation(float a, float b) {
    float k0, k1, k2, k3, k4, wl, wm, ws;
    if (-1.88170328 * a - 0.80936493 * b > 1.0) {
      k0 = 1.19086277; k1 = 1.76576728; k2 = 0.59662641; k3 = 0.75515197; k4 = 0.56771245;
      wl = 4.0767416621; wm = -3.3077115913; ws = 0.2309699292;
    } else if (1.81444104 * a - 1.19445276 * b > 1.0) {
      k0 = 0.73956515; k1 = -0.45954404; k2 = 0.08285427; k3 = 0.12541070; k4 = 0.14503204;
      wl = -1.2684380046; wm = 2.6097574011; ws = -0.3413193965;
    } else {
      k0 = 1.35733652; k1 = -0.00915799; k2 = -1.15130210; k3 = -0.50559606; k4 = 0.00692167;
      wl = -0.0041960863; wm = -0.7034186147; ws = 1.7076147010;
    }
    float S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
    float kl =  0.3963377774 * a + 0.2158037573 * b;
    float km = -0.1055613458 * a - 0.0638541728 * b;
    float ks = -0.0894841775 * a - 1.2914855480 * b;
    float l_ = 1.0 + S * kl, m_ = 1.0 + S * km, s_ = 1.0 + S * ks;
    float l = l_ * l_ * l_, m = m_ * m_ * m_, sv = s_ * s_ * s_;
    float ld = 3.0 * kl * l_ * l_, md = 3.0 * km * m_ * m_, sd = 3.0 * ks * s_ * s_;
    float ld2 = 6.0 * kl * kl * l_, md2 = 6.0 * km * km * m_, sd2 = 6.0 * ks * ks * s_;
    float f  = wl * l  + wm * m  + ws * sv;
    float f1 = wl * ld + wm * md + ws * sd;
    float f2 = wl * ld2 + wm * md2 + ws * sd2;
    return S - f * f1 / (f1 * f1 - 0.5 * f * f2);
  }
  // The cusp: the lightness at which a hue reaches its greatest chroma, and
  // that chroma. Returned as (L, C).
  vec2 hueCusp(float a, float b) {
    float S = maxSaturation(a, b);
    vec3 rgb = oklabToLinear(vec3(1.0, S * a, S * b));
    float Lc = pow(1.0 / max(max(max(rgb.r, rgb.g), rgb.b), 1e-6), 1.0 / 3.0);
    return vec2(Lc, Lc * S);
  }
  /* Chroma available at a lightness, approximating the gamut slice as two
     straight lines meeting at the cusp. Error against an exact search stays
     under 0.025 chroma through the useful tonal range, and where it errs it
     errs HIGH — asking for slightly more chroma than fits, which the gamut
     map immediately below already handles correctly. */
  float maxChromaAt(float L, vec2 cusp) {
    return L <= cusp.x ? cusp.y * L / max(cusp.x, 1e-6)
                       : cusp.y * (1.0 - L) / max(1.0 - cusp.x, 1e-6);
  }

  /* ---------- Targeted colour (SOOC, pre-swap) ----------

     Lightroom's HSL targeted-adjustment tool, on the camera's own colour
     before anything else touches it. The matrix mixes channels immediately
     afterward, so there is no single "SOOC red" left to target once it has
     run — this is the only point where the camera's colours still exist as
     themselves.

     Up to 5 bands, each a hue centre, a width, and hue/saturation/lightness
     deltas, all in OKLab so a push on the reds cannot drag lightness or a
     neighbouring hue with it. Falloff is smoothstepped so a band fades out
     at its own boundary instead of drawing a seam.

     Placed after the cusp helpers because it needs them: rotating hue at
     constant lightness is exactly what turns a bright cyan into pale
     periwinkle, and the fix is the same cusp solve the global Hue slider
     uses. Governed by the same Keep saturation control too — one slider for
     the brightness-versus-saturation trade wherever it arises, rather than a
     second one meaning the same thing in another panel. */
  const int MAX_BANDS = 5;
  uniform int u_bandCount;
  uniform float u_bandHue[MAX_BANDS];    // degrees, 0..360
  uniform float u_bandWidth[MAX_BANDS];  // degrees, half-width to zero falloff
  uniform float u_bandDH[MAX_BANDS];     // degrees to rotate, at full weight
  uniform float u_bandDS[MAX_BANDS];     // -1..1, chroma multiplier delta
  uniform float u_bandDL[MAX_BANDS];     // -1..1, scaled below to a sane range
  /* Lightness window, 0..1. Hue alone cannot always separate two things that
     need opposite treatment: a pale sky and deep shade inside foliage land on
     the same hue after a swap, so a band aimed at one drags the other with
     it \u2014 which is where the olive patches in bright pink trees come from.
     Defaults to the full range, so a band that does not set it behaves
     exactly as before. */
  uniform float u_bandLo[MAX_BANDS];
  uniform float u_bandHi[MAX_BANDS];
  uniform float u_bandSelectivity[MAX_BANDS];   // 0..1, dials down the low-chroma widening below

  float hueDegOf(vec2 ab) {
    float d = degrees(atan(ab.y, ab.x));
    return d < 0.0 ? d + 360.0 : d;
  }
  float angDelta(float a, float b) {
    return mod(a - b + 180.0, 360.0) - 180.0;
  }
  /* Source-side stages on linear light: hotspot, exposure, highlight recovery. One function, used for the centre pixel
     and for every neighbour a local stage reads, so they always agree. */
  vec3 stage1Lin(vec3 lin, vec2 uv) {
    /* Hotspot correction: a per-channel radial gain in linear light, applied
       to the sensor data before anything mixes the channels. A hotspot is a
       property of the lens and sensor, so it has to come out before the swap
       spreads it across the output. */
    if (u_hotspot.x != 0.0 || u_hotspot.y != 0.0 || u_hotspot.z != 0.0) {
      vec2 hd = (uv - u_vigCentre) * vec2(max(u_aspect, 1.0), max(1.0 / u_aspect, 1.0));
      float hr = length(hd) / max(u_hotSize, 0.05);
      float hw = exp(-2.0 * hr * hr);
      lin *= max(vec3(0.05), vec3(1.0) - u_hotspot * hw);
    }
    lin *= u_exposure;            // already 2^stops from the JS side; a true linear scale
    if (u_hlRecover > 0.0) {
      /* Soft shoulder: the headroom up to 4.0 is spread across roughly the top thirty levels, by bringing white
         itself down a little, and the BRIGHTEST channel is compressed with all three scaled by the same factor, so a
         recovered highlight keeps its colour and only loses brightness. */
      float knee = mix(1.0, 0.55, u_hlRecover);
      float top  = mix(1.0, 4.0,  u_hlRecover);
      float span = max(top - knee, 1e-4);
      float mx = max(lin.r, max(lin.g, lin.b));
      if (mx > knee) {
        float x = (mx - knee) / span;
        float compressed = knee + (1.0 - knee) * (1.0 - exp(-4.0 * x));
        lin *= compressed / max(mx, 1e-6);
      }
    }
    return lin;
  }
  /* One neighbour of the ORIGINAL texture brought through the source stages, sRGB-encoded -- exactly what the centre
     pixel is by the time the local stages run. A JPEG with nothing on those stages comes back as it is. */
  vec3 stage1At(vec2 uv) {
    vec3 t = texture2D(u_image, uv).rgb;
    if (u_inputLinear < 0.5 && u_exposure == 1.0 && u_hlRecover <= 0.0 &&
        u_hotspot.x == 0.0 && u_hotspot.y == 0.0 && u_hotspot.z == 0.0) return clamp(t, 0.0, 1.0);
    vec3 lin = u_inputLinear > 0.5 ? max(t, vec3(0.0)) : srgbToLinear(clamp(t, 0.0, 1.0));
    return linearToSrgb(clamp(stage1Lin(lin, uv), 0.0, 1.0));
  }
  /* What every local stage reads: the prepared picture when there is one, otherwise the original brought through the
     same stages on the fly. Encoded, and linear. */
  /* The prepared picture is drawn through the same vertex shader as the screen, which flips v, so it is stored the other
     way up from the original texture; reading it flips back. */
  vec2 prepUV(vec2 uv) { return vec2(uv.x, 1.0 - uv.y); }
  vec3 srcEnc(vec2 uv) { return u_prepped > 0.5 ? texture2D(u_image, prepUV(uv)).rgb : stage1At(uv); }
  vec3 srcLin(vec2 uv) { return srgbToLinear(srcEnc(uv)); }

  vec3 targetedHSL(vec3 lin) {
    if (u_bandCount <= 0) return lin;
    vec3 lab = linearToOklab(lin);
    float L = lab.x;
    float C = length(lab.yz);
    float H = hueDegOf(lab.yz);
    /* Every band matches the pixel's ORIGINAL hue, not the running one.
       Testing against a hue an earlier band had already rotated made bands
       silently interact: dragging band 1 changed how strongly band 2
       applied, though band 2 was sampled from the untouched colour and
       never touched again. A band selects from the source image, so it has
       to keep testing against the source. */
    float H0 = H;
    float C0 = C;
    float L0raw = L;   // lightness before any band touched it

    /* A spatially-smoothed hue reading, used ONLY for the matching decision
       below \u2014 never for the colour actually applied, which still comes
       from H0/C0/L above. A narrow, steep-falloff band (tight Width plus
       high Selectivity) is deciding on a hue difference small enough that
       ordinary pixel-to-pixel sensor noise crosses it: a real, tiny jitter
       that a soft band used to blend away now flips the decision outright,
       showing up as speckle in fine detail \u2014 fronds, foliage, anywhere the
       true hue is naturally busy at the pixel scale. Smoothing only the
       DECISION keeps full per-pixel sharpness in the output while keeping
       which side of the edge a pixel lands on stable between neighbours
       that were always meant to be treated alike.

       Edge-aware, not a flat average: a plain 4-neighbour blend fixed the
       speckle but broke something else \u2014 a thin object against a wide,
       very different-coloured surround (a palm trunk against pink canopy)
       got its matching hue dragged toward the surround, since a flat
       average cannot tell a real boundary apart from noise inside one
       material. Each neighbour's contribution is weighted by how close its
       OWN colour is to the centre pixel's; a neighbour that looks like a
       genuinely different thing barely contributes, so noise within a
       material still gets smoothed while a real edge stays sharp.

       Phased in by Selectivity itself rather than always on, since
       Selectivity is exactly the setting that asks for this kind of
       precision. At Selectivity=0 the mix below is 0 and this has no
       effect at all \u2014 matching the exact original per-pixel behaviour for
       every band that predates it. */
    vec3 labN0 = linearToOklab(srcLin(v_texCoord + vec2( u_texelSize.x, 0.0)));
    vec3 labN1 = linearToOklab(srcLin(v_texCoord + vec2(-u_texelSize.x, 0.0)));
    vec3 labN2 = linearToOklab(srcLin(v_texCoord + vec2(0.0,  u_texelSize.y)));
    vec3 labN3 = linearToOklab(srcLin(v_texCoord + vec2(0.0, -u_texelSize.y)));
    float wN0 = exp(-distance(labN0, lab) * 6.0);
    float wN1 = exp(-distance(labN1, lab) * 6.0);
    float wN2 = exp(-distance(labN2, lab) * 6.0);
    float wN3 = exp(-distance(labN3, lab) * 6.0);
    vec3 labSmoothed = (lab + labN0*wN0 + labN1*wN1 + labN2*wN2 + labN3*wN3)
                      / (1.0 + wN0 + wN1 + wN2 + wN3);
    float Hsmoothed = hueDegOf(labSmoothed.yz);
    float Csmoothed = length(labSmoothed.yz);

    for (int i = 0; i < MAX_BANDS; i++) {
      if (i >= u_bandCount) break;
      // angDelta, not a plain mix \u2014 H0 and Hsmoothed can sit on opposite
      // sides of the 0/360 wrap, where a linear mix would swing the wrong
      // way around the circle
      float Huse = H0 + angDelta(Hsmoothed, H0) * u_bandSelectivity[i];
      float Cuse = mix(C0, Csmoothed, u_bandSelectivity[i]);
      float delta = angDelta(Huse, u_bandHue[i]);
      /* Hue is only as trustworthy as the pixel is colourful. The angular
         error in a hue reading scales roughly with 1/chroma, so on a nearly
         neutral pixel the hue is mostly noise — and a fixed window then
         includes some of those pixels and excludes their neighbours purely
         on that noise. Desaturating a band makes it visible: the excluded
         pixels keep their full colour while everything around them goes
         grey, which is the scattered speck in an otherwise flat sky.
         Widening the window as chroma falls keeps neighbouring pixels on the
         same side of the decision. Capped at 3x so a band still selects
         rather than becoming global. */
      float certainty = smoothstep(0.010, 0.075, Cuse);
      /* The low-chroma widening is capped in ABSOLUTE degrees, not left as a
         pure multiplier. Unbounded, a band already set wide enough to rotate
         a whole sky uniformly (150) becomes 450 on near-neutral pixels \u2014
         wider than the colour wheel \u2014 and stops selecting anything at all.
         Capping at 170 keeps the widening doing its real job (a near-grey
         pixel's hue is unreliable, so judge it loosely) without ever letting
         a band swallow the entire image.

         Selectivity trades that safety net away on purpose. Raw IR captures
         are often desaturated across a whole cluster of real, DIFFERENT
         hues \u2014 an orange-family colour and a red-family one sitting only a
         few degrees apart, both low-chroma. The 3x widening built for noisy
         near-neutral pixels was blurring exactly that split, since it grabs
         extra width precisely where these two clusters live. At
         Selectivity=1 the multiplier collapses to 1x: Width means Width,
         even on a desaturated pixel, so two close but real hues can be
         told apart. Default 0 reproduces the original behaviour exactly,
         so no existing band changes. */
      float maxWiden = mix(3.0, 1.0, u_bandSelectivity[i]);
      float wid = min(max(u_bandWidth[i], 1e-3) * mix(maxWiden, 1.0, certainty), 170.0);
      float t = clamp(1.0 - abs(delta) / wid, 0.0, 1.0);
      /* Selectivity's second job: steepening the falloff itself, not just
         capping the widening above. A linear ramp still overlaps two bands
         whose real hues sit only a few degrees apart even once Width is
         already narrow \u2014 "narrow" and "sharp-edged" are different things,
         and shrinking Width further than this starts cutting into the
         target hue's own natural variance/noise rather than excluding the
         neighbour. Raising t to a power leaves pixels near the band centre
         essentially untouched (t close to 1 stays close to 1 under any
         power) while pixels partway across the width collapse toward 0
         much faster \u2014 a genuinely harder edge at the same Width, which is
         the only way to gain more separation once Width itself is already
         as tight as it can go without losing the target. */
      t = pow(t, mix(1.0, 5.0, u_bandSelectivity[i]));
      /* Lightness gate, feathered rather than hard so a band does not leave a
         visible edge where it stops applying. L here is the OKLab lightness
         already computed above. */
      float lo = u_bandLo[i], hi = u_bandHi[i];
      float feather = max(0.04, (hi - lo) * 0.18);
      t *= smoothstep(lo - feather, lo + feather, L) *
           (1.0 - smoothstep(hi - feather, hi + feather, L));
      float w = t * t * (3.0 - 2.0 * t);   // smoothstep, so the band edge is invisible
      /* Weighted by how chromatic the pixel is, not only how close its hue is
         to the band. Hue is numerically meaningless on a near-neutral pixel,
         so selecting on hue angle alone grabbed a random scatter of dark
         foliage and shadow where the hue is just noise — exactly the speckle
         the selection preview was drawing. Same threshold the solve uses, so
         both agree on what counts as a real colour. */
      w *= smoothstep(0.010, 0.050, Cuse);
      if (i == u_bandPreview) g_bandW = w;
      if (w <= 0.0) continue;
      H += u_bandDH[i] * w;
      C = max(0.0, C * (1.0 + u_bandDS[i] * w));
      /* Build 162: Lightness works like exposure on the selected colour. It used to ADD to OKLab lightness, which lifted
         dark and bright parts of the selection by the same amount: shadows inside a sky or a tree washed out, texture
         flattened and the colour turned pale. Exposure multiplies the light instead, and OKLab is a cube root of light,
         so multiplying the light by k multiplies L and chroma both by k^(1/3): every part of the selection keeps its
         contrast against its neighbours and its saturation. +-100% is +-2 stops. Brightening rolls off softly above
         L 0.9 instead of clipping, taking chroma down with it so the colour does not go out of range as it nears white. */
      float fL = exp2(u_bandDL[i] * 2.0 * w / 3.0);
      float Le = L * fL;
      if (Le > 0.9) Le = 0.9 + 0.1 * (1.0 - exp(-(Le - 0.9) / 0.1));
      C *= L > 1e-5 ? Le / L : fL;
      L = Le;
    }

    /* Shared ceiling across ALL bands combined, not per band — mirrors
       targetedHSLF's identical cap line-for-line (see its comment there for
       the full reasoning: three overlapping bands, each tuned in isolation,
       compounded their dS into a 1.5-1.77x chroma boost that clipped
       highlights and flattened foliage texture on a dense, already-
       saturated photo). MAX_CHROMA_MULT here is a plain hardcoded literal,
       not a uniform \u2014 GLSL can't read the JS constant of the same name, so
       if 1.6 ever changes on the JS side for the .cube exporter, this line
       has to be changed to match by hand or the live preview and an
       exported LUT will silently disagree on how bands compound. */
    if (C0 > 1e-5) C = min(C, C0 * 1.6);   // MAX_CHROMA_MULT — keep in sync with the JS constant of the same name

    /* The same trade the global Hue and Saturation sliders make, applied to
       the NET effect of all bands rather than per band — what matters is
       where the colour ended up, and one solve is both more correct and far
       cheaper than up to ten cusp solves per pixel. */
    float kEff = u_satPreserve * smoothstep(0.010, 0.050, C0);
    bool moved = abs(angDelta(H, H0)) > 0.001;
    bool boosted = C > C0 + 1e-6;
    if (u_satPreserve > 0.0 && C > 1e-5 && (moved || boosted)) {
      vec2 cusp0 = hueCusp(cos(radians(H0)), sin(radians(H0)));
      vec2 cusp1 = hueCusp(cos(radians(H)), sin(radians(H)));
      // "already on the boundary, nothing lost" is a rotation-only shortcut;
      // a boost past the boundary is precisely the case worth handling
      {   // shortcut removed — see hueSat
        float denomB = cusp0.y;   // cusp-relative — see hueSat
        float rel = softKnee(C / max(denomB, 1e-6), 0.85);
        /* Only ever RESTORE chroma the rotation took away — never exceed what
           the colour had before it. Without this ceiling the solve multiplied
           every pixel's chroma by roughly 2.5x, near-neutrals included: a
           127,129,129 grey came out with more than double the chroma it went
           in with. Hue is numerically meaningless at that chroma, so
           amplifying it turns ordinary sensor noise into coloured speckle,
           which is what tore the train body apart while Keep saturation at 0
           stayed clean at exactly 1.0x. */
        float want = min(max(C, rel * cusp1.y), cusp1.y);
        if (want > maxChromaAt(L, cusp1)) {
          float need = (L <= cusp1.x)
            ? want * cusp1.x / max(cusp1.y, 1e-6)
            : 1.0 - want * (1.0 - cusp1.x) / max(cusp1.y, 1e-6);
          L = mix(L, min(clamp(need, 0.0, 1.0), L), kEff);   // darken only — see hueSat
        }
        C = min(mix(C, want, kEff), maxChromaAt(L, cusp1));
      }
    }

    float r = radians(H);
    vec3 outLin = oklabToLinear(vec3(L, C * cos(r), C * sin(r)));
    /* Hold the peak channel — but at the lightness the BANDS asked for, not
       the source's. Clamping to the source peak flat cancelled the Lightness
       slider's whole upward half: raise L, the peak channel rises with it,
       and the scale pulled it straight back down. Measured before this, a
       +80% Lightness band moved luminance from 169 to 180 while -80% moved it
       to 77, and on a flat grey it did nothing at all. Scaling the ceiling by
       the requested lightness change means this still cancels brightening the
       SOLVE introduced, while leaving brightening the user asked for alone. */
    float lightGain = L0raw > 1e-4 ? L / L0raw : 1.0;
    float srcMaxB = max(max(lin.r, lin.g), lin.b) * max(lightGain, 1.0);
    float outMaxB = max(max(outLin.r, outLin.g), outLin.b);
    if (outMaxB > srcMaxB && srcMaxB > 0.0)
      outLin = mix(outLin, outLin * (srcMaxB / outMaxB), kEff);
    /* Report to the clipping overlay. Without this the band stage was the
       one place that could drive a channel out of range silently: a band
       pushed green and blue negative, the matrix averaged them back
       positive, and gamutMapT took its early return and called the frame
       clean. The overlay's own 0.002 threshold absorbs round-trip noise. */
    g_over  = max(g_over,  max(max(outLin.r, outLin.g), outLin.b) - 1.0);
    g_under = max(g_under, -min(min(outLin.r, outLin.g), outLin.b));
    return outLin;
  }

  /* Hue rotation in OKLab, optionally trading lightness for chroma.

     Plain OKLab rotation holds lightness exactly, which is correct and also
     the source of a real complaint: rotating a bright cyan toward blue gives
     a pale periwinkle, never a blue. That is not a bug in the rotation. The
     most saturated blue sRGB has sits at a luminance of about 32, so a blue
     at the cyan's luminance of 178 does not exist, and holding lightness
     means the only answer is a washed-out one. Measured on the reported
     image: saturation fell from 56% to 29% across a 90 degree turn while
     lightness never moved, and the gamut map never even engaged because the
     result stayed comfortably in range the whole way.

     So the fix belongs here rather than in the gamut stage. Chroma is
     measured as a FRACTION of what the hue can hold, and that fraction is
     what carries across the rotation; lightness then falls toward the cusp
     as far as it must to support it. Rotations into a wider part of the
     gamut need no drop and get none, which is what keeps this from
     darkening images that were never affected. keepSat is the existing
     "Keep saturation" control, and at 0 this is exactly the old behaviour. */
  uniform int u_hueSpace;   // 0 = perceptual (OKLab), 1 = channel (HSV)
  uniform int u_lumPreserve;   // 0 = off, 1 = hold luminance across the swap

  /* A channel swap moves light between channels that carry very different
     amounts of it — R is 0.2126 of luminance, B only 0.0722 — so the swap
     changes overall brightness as a side effect of changing hue. Measured on
     real material: foliage comes out at x0.66, skin x0.81, sky x1.40, and a
     pure red turning blue x0.34. Neutrals are unaffected by construction.

     Recording luminance before the swap and restoring it after makes the
     swap a hue operation only, so different frames land at a comparable
     brightness instead of each needing its own exposure correction.

     The catch, and the reason this is soft-limited rather than exact: the
     target hue often CANNOT carry the source luminance. Blue at 0.0722
     would need a x2.9 gain to match what red was carrying, which is far past
     white. Measured across the gamut, 15.3 percent of colours cannot be
     restored exactly. Forcing it there is what produces clipped artifacts,
     so the gain rolls off through the same softKnee the rest of the file
     uses: exact where the luminance is reachable, easing to just-touching
     white where it is not. */
  vec3 preserveLuma(vec3 c, float yBefore) {
    // matched to yPreSwap's weight, not LUMW \u2014 before and after have to be
    // measured the same way or the gain solved here is measuring nothing real
    float yAfter = dot(c, u_lumaW);
    if (yAfter <= 1e-5 || yBefore <= 1e-5) return c;
    float gain = yBefore / yAfter;
    if (gain <= 1.0) return c * gain;          // darkening can never clip
    float mx = max(max(c.r, c.g), c.b);
    if (mx <= 1e-5) return c;
    float maxGain = 1.0 / mx;                  // the gain that just reaches white
    if (maxGain <= 1.0) return c;              // already at white, nothing to give
    return c * (maxGain * softKnee(gain / maxGain, 0.85));
  }

  /* Channel-space hue rotation, for when the Hue slider is being used to do
     a CHANNEL SWAP rather than a perceptual hue move — the two are not the
     same operation and had been merged into one control.

     A cyclic RGB swap (R->G->B->R) is exactly +120 degrees in HSV for every
     colour without exception. In OKLab the identical swap measures anywhere
     from 86 to 128 degrees depending on the colour, because perceptual
     uniformity is precisely what makes it NON-uniform in channel terms: it
     stretches and compresses hue relative to raw RGB. So a fixed slider
     value moves different colours by different amounts, which is exactly
     the inconsistency Fedia reported when trying to reproduce an
     Aerochrome swap at 120.

     Working in linear light throughout, unlike a classic HSV implementation
     on encoded values — the rest of the pipeline is linear and switching
     encoding mid-chain to borrow a formula would shift luminance. */
  vec3 hsvRotate(vec3 c, float turns) {
    if (turns == 0.0) return c;
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float d = mx - mn;
    if (d < 1e-7 || mx <= 0.0) return c;          // neutral: no hue to rotate
    float h;
    if (mx == c.r)      h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else                h = (c.r - c.g) / d + 4.0;
    h = mod(h / 6.0 + turns, 1.0) * 6.0;          // rotate, wrap
    float S = d / mx, V = mx;
    float cc = V * S;
    float x = cc * (1.0 - abs(mod(h, 2.0) - 1.0));
    float m = V - cc;
    vec3 o;
    if (h < 1.0)      o = vec3(cc, x, 0.0);
    else if (h < 2.0) o = vec3(x, cc, 0.0);
    else if (h < 3.0) o = vec3(0.0, cc, x);
    else if (h < 4.0) o = vec3(0.0, x, cc);
    else if (h < 5.0) o = vec3(x, 0.0, cc);
    else              o = vec3(cc, 0.0, x);
    return o + m;
  }

  // Same tiled-2D-texture technique lutLookup elsewhere in this shader uses,
  // fixed at N=9 since this specific lookup never changes size (see the
  // uniform's own comment) -- a scalar stored redundantly across r/g/b, so
  // only .r is read. Input is linear RGB directly, no domain remapping:
  // this LUT was built over [0,1] linear RGB on the JS side and nothing
  // here ever changes that. Defined here, before hueSat below which calls
  // it -- GLSL has no function hoisting, unlike JS; a call to a function
  // defined later in the same shader source fails to compile.
  float hellwigVWLookup(vec3 lin) {
    const float N = 17.0;   // must match HELLWIG_LUT_N in JS exactly -- this is not read dynamically, since GLSL ES 1.00 has no way to inject a JS constant into a hardcoded local without turning this into a uniform for a value that never actually changes at runtime
    vec3 c = clamp(lin, 0.0, 1.0);

    float zf = c.b * (N - 1.0);
    float z0 = floor(zf);
    float z1 = min(z0 + 1.0, N - 1.0);
    float fz = zf - z0;

    float xIn = (c.r * (N - 1.0) + 0.5) / (N * N);
    float y   = (c.g * (N - 1.0) + 0.5) / N;
    float tile = 1.0 / N;

    float s0 = texture2D(u_hellwigVW, vec2(z0 * tile + xIn, y)).r;
    float s1 = texture2D(u_hellwigVW, vec2(z1 * tile + xIn, y)).r;
    return mix(s0, s1, fz);
  }

  /* Colour by band. Band centres are the OKLab hue angles of the reference colours (pure sRGB red, orange,
     yellow, green, cyan, blue, violet and magenta), so "Blue" means what a blue sky actually measures. */
  uniform float u_hslOn;
  uniform float u_bandProbe;     // 1 = write the colour as it reaches Colour by band and stop (the guide pass)
  uniform float u_bandGuideOn;   // 1 = decide each pixel's band from the smoothed guide, not from its own noisy colour
  uniform sampler2D u_bandGuide; uniform vec2 u_guideTexel;
  uniform vec4 u_hslH0; uniform vec4 u_hslH1;   // per band, -1..1, bands Red Orange Yellow Green | Aqua Blue Purple Magenta
  uniform vec4 u_hslS0; uniform vec4 u_hslS1;
  uniform vec4 u_hslL0; uniform vec4 u_hslL1;
  uniform float u_skyDeep;   // 0..1: how far the selected sky is taken down toward navy
  uniform float u_crimson;   // 0..1: how far purple, magenta and red foliage is pulled toward crimson
  uniform float u_skyShow;   // 1 = tint the sky selection so it can be seen
  uniform sampler2D u_skyMask;   // R: the sky selection, G: the foliage map, B: the sky selection widened past its edge
uniform vec3 u_skyLab;         // the typical colour of the sky in the source picture (OKLab)
uniform sampler2D u_skyCol;    // the small copy's own colour at each of its pixels (OKLab, packed): the guide for drawing the selection's edge at full size
uniform vec2 u_maskSize;       // size of the small copy, in its pixels
uniform float u_skyL;          // the typical lightness of the sky; anything clearly brighter (cloud, haze) is left alone
  float hslPick(vec4 a, vec4 b, int i) {
    if (i == 0) return a.x; if (i == 1) return a.y; if (i == 2) return a.z; if (i == 3) return a.w;
    if (i == 4) return b.x; if (i == 5) return b.y; if (i == 6) return b.z; return b.w;
  }
  /* The hue, saturation and lightness shift for one hue angle (degrees): the two neighbouring bands blended smoothly. */
  vec3 bandShift(float hd) {
    int ia = 7; float ca = -32.0, cb = 29.0;
    if (hd >= 328.0)      { ia = 7; ca = 328.0; cb = 389.0; }
    else if (hd >= 293.0) { ia = 6; ca = 293.0; cb = 328.0; }
    else if (hd >= 264.0) { ia = 5; ca = 264.0; cb = 293.0; }
    else if (hd >= 195.0) { ia = 4; ca = 195.0; cb = 264.0; }
    else if (hd >= 142.0) { ia = 3; ca = 142.0; cb = 195.0; }
    else if (hd >= 110.0) { ia = 2; ca = 110.0; cb = 142.0; }
    else if (hd >= 56.0)  { ia = 1; ca = 56.0;  cb = 110.0; }
    else if (hd >= 29.0)  { ia = 0; ca = 29.0;  cb = 56.0; }
    int ib = (ia == 7) ? 0 : ia + 1;
    float t = clamp((hd - ca) / (cb - ca), 0.0, 1.0); t = t * t * (3.0 - 2.0 * t);
    return vec3(mix(hslPick(u_hslH0, u_hslH1, ia), hslPick(u_hslH0, u_hslH1, ib), t),
                mix(hslPick(u_hslS0, u_hslS1, ia), hslPick(u_hslS0, u_hslS1, ib), t),
                mix(hslPick(u_hslL0, u_hslL1, ia), hslPick(u_hslL0, u_hslL1, ib), t));
  }
  /* Build 107. Two causes of black speckle, both fixed here:
     1. Which band a pixel belongs to was decided from that pixel's own colour. In a noisy sky (a converted camera's weak blue
        channel, boosted, then rotated into another channel) single pixels' hues scatter tens of degrees either side of the
        sky's real hue, so a band next to the sky's caught a sprinkling of lone pixels and only those were darkened -- dark
        dots on a sky that otherwise did not change. The band and the grey gate now come from an edge-aware average of the
        guide around the pixel (bandColour), so the whole sky is one band, while a twig against the sky averages only twig
        and keeps its own band.
     2. Luminance subtracted a fixed amount of lightness (0.15 at -100), which takes a dark pixel to pure black while a
        mid-tone loses a quarter. It is now a proportion of the pixel's own lightness (30% at -100, the same as before for
        a mid-tone around 0.5, which is where the Photoshop-fitted values were matched), and brightening is a proportion of
        the headroom left, so nothing is pushed to black or clipped to white. Darkening takes chroma down by part of the
        same ratio so the colour stays inside what the screen can show rather than going negative and being clipped. */
  /* An edge-aware average of a guide (a small copy of the picture as it reaches some step) around this pixel, counting
     only the neighbours that are the same colour as this pixel give or take noise. A sky pixel next to a tree averages
     only sky; a lone noisy pixel is outvoted by the sky around it. Used to decide which colour band a pixel is in, and
     how far it is inside a colour or luminosity mask, so neither flickers pixel to pixel on a noisy photo -- which it
     did most at full size, where every pixel carries more noise than the preview's. */
  vec3 guidedLab(sampler2D guide, vec2 texel, vec3 labOwn) {
    vec2 uv = prepUV(v_texCoord);
    vec3 acc = labOwn; float wsum = 1.0;
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        vec3 t = linearToOklab(max(srgbToLinear(texture2D(guide, uv + vec2(float(i), float(j)) * 1.5 * texel).rgb), vec3(0.0)));
        vec3 dv = t - labOwn;
        float w = exp(-dot(dv, dv) / (0.06 * 0.06));
        acc += t * w; wsum += w;
      }
    }
    return acc / wsum;
  }
  /* Build 109. The local average removes speckle but not the slower wander of a noisy sky's colour: patches tens of
     pixels wide that sit a few degrees bluer or purpler than the rest. Where a sky lies on the line between two bands
     (blue and purple after a channel swap, say) and only one band is moved, those patches moved by different amounts
     and the sky went blotchy. So the band is chosen from a much wider average, the same area of the picture at preview
     and full size, built only from parts of the picture that are this pixel's colour (below). Only the hue and chroma
     are taken from it: which band, and how grey, not the pixel's lightness. */
  vec3 bandColour(vec3 labOwn) {
    vec3 labLocal = guidedLab(u_bandGuide, u_guideTexel, labOwn);
    /* 5x5 taps of the guide's mipmap, each already an average of a 16x16 block, spread over about 60 preview pixels;
       each counts only if it is the same colour as this pixel's local average, so near an edge the far side drops out
       and the sky still gets the sky's wide average right up to the tree. */
    float lod = 4.0 + log2(max(u_nrScale, 1.0));
    vec2 st = exp2(lod) * u_guideTexel;
    vec2 uv = prepUV(v_texCoord);
    vec2 accW = labLocal.yz * 0.05; float wW = 0.05;
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        vec2 t = linearToOklab(max(srgbToLinear(texture2D(u_bandGuide, uv + vec2(float(i), float(j)) * st, lod).rgb), vec3(0.0))).yz;
        vec2 dv = t - labLocal.yz;
        float w = exp(-dot(dv, dv) / (0.045 * 0.045));
        accW += t * w; wW += w;
      }
    }
    return vec3(labLocal.x, accW / wW);
  }
  vec3 applyHslBands(vec3 lin, float useGuide) {
    vec3 lab = linearToOklab(lin);
    float C = length(lab.yz);
    vec3 labB = useGuide > 0.5 ? bandColour(lab) : lab;
    float CB = length(labB.yz);
    float hd = degrees(atan(labB.z, labB.y)); if (hd < 0.0) hd += 360.0;
    float gate = smoothstep(0.012, 0.06, CB);   // greys and near-greys untouched
    vec3 d = bandShift(hd);
    if (gate <= 0.0) return lin;
    float ang = radians(d.x * 30.0 * gate);
    float fS = max(0.0, 1.0 + d.y * gate);
    float h2 = atan(lab.z, lab.y) + ang;
    float dl = d.z * gate;
    float L2 = dl < 0.0 ? lab.x * (1.0 + 0.30 * dl) : lab.x + (1.0 - lab.x) * 0.30 * dl;
    float ratio = lab.x > 1e-4 ? L2 / lab.x : 1.0;
    float C2 = C * fS * (ratio < 1.0 ? sqrt(ratio) : 1.0);
    return oklabToLinear(vec3(clamp(L2, 0.0, 1.0), C2 * cos(h2), C2 * sin(h2)));
  }
  vec3 hueSat(vec3 lin, float hueFrac, float sat, float keepSat, float vibrance) {
    vec3 lab = linearToOklab(lin);
    /* Vibrance's weight now comes from Hellwig2022's M via the fixed LUT
       above, replacing OKLab's own C0 -- same change as the JS/CPU path
       (hueSatF), see that function's own comment for the full story
       (verified against colour-science's reference implementation,
       deliberately excludes its documented-buggy H-K extension). The
       actual chroma boost and the gamut-cusp trade just below are
       unchanged, still OKLab -- only the "how saturated is this pixel
       already" measurement changed. */
    float C0 = length(lab.yz);
    float vW = hellwigVWLookup(lin);
    float effSat = sat * (1.0 + vibrance * vW);
    float C = C0 * effSat;
    float H0 = atan(lab.z, lab.y);
    float H = H0 + hueFrac * 6.28318530718;
    /* hueFrac == 0.0 used to early-return here, which meant a pure
       saturation boost — no rotation at all — never reached the cusp logic
       below. That is the same failure the rotation had: asking for more
       chroma than the hue can hold at this lightness, and getting it taken
       away downstream instead of paying for it in brightness. Measured on a
       dull red, Keep saturation was byte-identical at 0 and at 100 for every
       saturation value, and past x1.8 green and blue clipped flat to zero
       rather than the colour going darker and staying rich. The gate now
       only skips when nothing is being asked of this function at all. */
    if (keepSat <= 0.0 || (hueFrac == 0.0 && effSat <= 1.0) || C <= 1e-5)
      return oklabToLinear(vec3(lab.x, C * cos(H), C * sin(H)));

    vec2 cusp0 = hueCusp(cos(H0), sin(H0));
    vec2 cusp1 = hueCusp(cos(H), sin(H));
    /* If the rotated colour already sits on the gamut boundary at its own
       lightness, it is as saturated as that hue can possibly be there and
       nothing was lost — leave it exactly as the plain rotation produced it.
       This is the gate that keeps the control from touching rotations that
       were never the problem: a red turned toward orange stays on the
       boundary throughout and is untouched, while a bright cyan turned
       toward blue falls well inside it and is not. */
    /* Only a shortcut for ROTATIONS. Sitting on the gamut boundary means a
       rotation lost nothing, so it can be left alone — but for a saturation
       boost, being past the boundary is precisely the case worth handling:
       the extra chroma was asked for and has nowhere to go but into a lower
       lightness. Gating on sat keeps every rotation behaving exactly as
       before while letting a boost through to the solve below. */
    /* Rotation-only shortcut, and only where sitting on the boundary really
       does mean nothing was lost. At extreme lightness that stops being
       true: at the top of the tonal range a hue can barely be saturated at
       all, so a colour is "on the boundary" while still being pale, and
       there is a great deal to gain by lowering lightness. Skipping there
       left the brightest tones — the highlights along a train boiler —
       untouched and washed out while everything around them went deep,
       which is what produced pale blotches through an otherwise solid
       colour. Measured on that image: the boundary sits at 0.34 of the
       hue's best for those highlights, against 0.74 for a red turned toward
       orange, which is the case this shortcut exists to protect. */
    /* The boundary shortcut used to live here, gated on sat <= 1.0. That
       made Saturation exactly 100% behave differently from 101% — a hard
       branch right where the slider sits by default, which is why 100 looked
       broken while 101 looked fine. It also is no longer needed: it existed
       to stop colours already at the boundary being dragged around, and the
       peak-preserving scale at the end of this function now handles that
       case directly and continuously. Removed rather than re-gated, because
       any threshold here puts a visible seam somewhere in the slider. */
    /* Measured against the chroma available at THIS LIGHTNESS, not against
       the hue's cusp. The cusp can sit at a completely different lightness
       from the pixel — a bright cyan is nearly maxed out for how light it is
       while reaching only two thirds of cyan's theoretical cusp — so dividing
       by the cusp understated how saturated the colour already was, and the
       rotation came out duller than it started. On Fedia's train this read
       57% saturation into blue against v55's 66%; measured this way, 68%. */
    /* Soft knee instead of a hard min(...,1). Clamping flat meant that as a
       source got brighter, the room available at its lightness shrank, rel
       climbed fast toward the ceiling, and the solve pushed lightness down
       harder and harder — a one-level change in the source came out as an
       eighteen-level change in the result. At that gain ordinary sensor
       noise in a bright area becomes visible colour speckle, which is the
       mottling that appeared across the train body. Rolling off from 0.85
       with the same tanh shape compressGamut already uses drops the worst
       step to about five levels, leaves mid-tones byte-identical, and still
       reaches 85% saturation in the highlights. */
    /* Reaching v55's depth in blue genuinely needs roughly double the chroma
       — the same absolute chroma reads far paler at a hue whose cusp is much
       higher. Applying that everywhere is what tore the image up: hue is
       numerically meaningless on a near-neutral pixel, so doubling its chroma
       turns sensor noise into coloured speckle. Weighting by how chromatic
       the pixel already is separates the two — a 127,129,129 grey has chroma
       0.0024 and gets nothing, real colour at 0.10+ gets the full solve.
       Same reasoning as vibrance versus saturation. */
    float C0raw = length(lab.yz);
    float kEff = keepSat * smoothstep(0.010, 0.050, C0raw);
    /* Geometric mean of two references, not either alone. Measuring against
       the chroma available at THIS lightness is right in the midtones but
       collapses toward zero as lightness rises — a pale bright sky then reads
       as ~75% saturated and gets granted 75% of blue's far larger cusp
       chroma, which is what drove skies dark and banded. Measuring against
       the hue's cusp alone is stable but too weak, which was the original
       "new version is pale" complaint. The two agree in the midtones, so the
       depth is kept, and disagree exactly where the at-lightness figure stops
       being meaningful. */
    /* Measured against the hue's cusp chroma, full stop. The invariant that
       matters is Fedia's: a colour that was not saturated in the original
       must not become saturated after a swap or a small rotation, and only a
       colour that was already at full saturation should come out fully
       saturated. Cusp-relative is the only one of the three references tried
       that holds it — measured across a pale sky and a saturated cyan it
       tracks the source to within a few points (21%->20%, 16%->16%,
       66%->61%), where dividing by the chroma available at the pixel's own
       lightness turned a 16% sky into 59%, and a geometric mean of the two
       still doubled it. The earlier move away from this was chasing v55's
       exact number on one pixel, which cost the principle that generalises
       to the whole frame. */
    float denom0 = cusp0.y;
    float rel = softKnee(C / max(denom0, 1e-6), 0.85);
    /* max(), not plain assignment. Restoring the fraction is only ever meant
       to RECOVER chroma a rotation gave up; without this floor it would also
       CUT chroma when rotating into a narrower hue, quietly changing images
       that had no problem. Caught by a red-to-orange regression check, which
       moved 191,62,0 to 178,89,0 before the floor was added. */
    /* Capped at the cusp chroma: that is the most this hue can hold at ANY
       lightness, so asking for more is asking for a colour that does not
       exist. Uncapped, the lightness solve below extrapolates straight past
       the cusp — a x2.2 saturation boost on a dark red wanted chroma 0.2715
       against a maximum of 0.2575 and sent lightness climbing toward white,
       coming out brighter AND paler, the exact opposite of the trade. */
    float want = min(max(C, rel * cusp1.y), cusp1.y);

    float L = lab.x;
    if (want > maxChromaAt(L, cusp1)) {
      // lightness that would support it, on whichever side of the cusp we sit
      float need = (L <= cusp1.x)
        ? want * cusp1.x / max(cusp1.y, 1e-6)
        : 1.0 - want * (1.0 - cusp1.x) / max(cusp1.y, 1e-6);
      /* One-directional: this control may only give brightness up, never
         gain it. For a hue whose cusp sits ABOVE the source lightness — red
         and orange especially — chasing the cusp climbed toward white, and a
         red with its channel pinned at 255 and blue lifted reads as orange
         rather than deep red: v55 held 205,70,76 where this produced
         255,80,109. Capping at the original lightness leaves blue and violet
         untouched, their cusps being darker, so the trade there still runs
         the way the label promises. */
      L = mix(L, min(clamp(need, 0.0, 1.0), L), kEff);
    }
    float Cf = min(mix(C, want, kEff), maxChromaAt(L, cusp1));
    vec3 outLin = oklabToLinear(vec3(L, Cf * cos(H), Cf * sin(H)));
    /* Hold the peak channel where the source had it. Saturation can be won
       either by raising the brightest channel or by lowering the other two,
       and this was doing the first: a source peaking at 205 came out pinned
       at 255, which is both why the colour read bright-orange instead of deep
       red and why the histogram grew a spike hard against the top end. v55
       does the second — it keeps its peak at 205 throughout. Scaling
       uniformly preserves the ratios between channels, so hue and saturation
       survive exactly and only the overall level comes down. Weighted by
       kEff, so Keep saturation at 0 and near-neutral pixels are untouched. */
    float srcMax = max(max(lin.r, lin.g), lin.b);
    float outMax = max(max(outLin.r, outLin.g), outLin.b);
    if (outMax > srcMax && srcMax > 0.0)
      outLin = mix(outLin, outLin * (srcMax / outMax), kEff);
    return outLin;
  }

  // Gentle S-curve contrast, pivoting on mid-grey and preserving pure black
  // and pure white — standard power-curve tone shaping. Applied to LUMINANCE
  // only, then all three channels are rescaled by the same factor, so hue
  // and chroma are mathematically untouched — only the tonal weight changes.
  // (An earlier version applied this per-channel, which is a well-known
  // characteristic of per-channel tone curves: it can shift colour balance
  // in the midtones even though black/white/mid-grey stay anchored, since
  // three unequal channel values move by different absolute amounts under
  // the same curve. Luminance-only avoids that entirely.) A flat linear
  // transform with no contrast tends to look thin and forces saturation to
  // do all the work of making colours feel rich, which clips and flattens
  // tone rather than deepening it. This runs automatically; no control.
  /* Pivots on the image's own median tone, not a fixed mid-grey. A curve
     hinged at 0.5 holds mid-grey still and moves everything else around it,
     which is right for a daylight frame but wrong for the night work this
     tool is mostly used on. Measured: the daylight tent shot has a median of
     0.375, a night train shot 0.061 — so at a fixed pivot a subject sitting
     at 0.18 was pushed UP to 0.271 by a contrast increase, washing out the
     very thing being photographed while the sky stretched away from it.
     Pivoting on the median anchors the subject and lets the contrast fall
     either side of it, which is what the histogram implies should happen.

     Taken from the SOURCE image once at load, never from the rendered
     output: the histogram is sampled downstream of this stage, so feeding it
     back here would make the pivot depend on its own result. Clamped to
     0.15-0.50 as well, since the raw median of a very dark frame would put
     the hinge so low that almost the whole image lifts. */
  uniform float u_contrastPivot;
  uniform float u_hiPivot;   // where Highlights starts (linear luminance); 0.10 is the standard range
  uniform float u_shW;       // how far up Shadows reaches, as a multiple of the standard range (1.0)
  uniform float u_filmTone;   // 0..1 blend toward the measured Aerochrome 1443 response
  uniform float u_highlights;   // -1..1, negative recovers
  uniform float u_shadows;      // -1..1, positive lifts
  uniform float u_clarity;
  uniform float u_dehaze;
  /* Colour calibration */
  uniform float u_calRH;   /* red primary hue shift   -1..1 */
  uniform float u_calGH;   /* green primary hue shift -1..1 */
  uniform float u_calBH;   /* blue primary hue shift  -1..1 */
  uniform float u_calRS;   /* red saturation adjust   -1..1 */
  uniform float u_calGS;   /* green saturation adjust -1..1 */
  uniform float u_calBS;   /* blue saturation adjust  -1..1 */
  uniform float u_calST;
  uniform mat3 u_swapT;       // custom swap space: sRGB -> blended space, and back
  uniform mat3 u_swapTi;
  uniform int u_swapSpace;   // 0 = sRGB (no widening), 1 = Rec2020, 2 = ProPhoto (default), 3 = custom widening, 4 = gamma-encoded (Photoshop-style)   /* shadows tint            -1..1 */
  uniform float u_vigAmt;       // -1..1, positive brightens corners (correction), negative darkens
  uniform float u_vigFall;      // 0.5..4, how sharply the effect grows toward the edge
  uniform float u_vigSpread;    // 0..1, radius (as a fraction of the way to the corner) left untouched

  /* Radial gain, not a fixed darkening map: full-spectrum conversions often
     have a DIFFERENT falloff from the lens's stock profile, because the
     hot-mirror removal and the filter stack sit in the light path too — so
     this is built to be dialled by eye rather than read from a lens
     database, which would likely be wrong for a converted body anyway.

     Distance is measured in ASPECT-CORRECTED space so the correction is a
     true circle regardless of the image's aspect ratio; without u_aspect a
     landscape frame would get an elliptical correction; wider along the
     short axis than the long one, visibly wrong on any non-square image.

     Radius normalises against the corner FARTHEST from the chosen centre,
     so an off-centre point (the sun rather than the lens axis) still maps
     the amount slider to "fully corrected at the most extreme corner"
     rather than clipping early on one side. */
  /* Colour calibration — ported from RapidRAW apply_color_calibration.
     Rotates each primary hue by shearing it toward neighbours (e.g. red hue
     shift +0.3 mixes 30 % of red into green, removing 30 % of the pure-red
     component → red primary swings toward yellow). Per-channel saturation
     then weights by each primary's share of the colour sum. Shadow tint adds
     a warm/cool cast in the darkest tones only (smoothstep mask 0..0.3).

     Applied in linear light immediately before vignette — after WB and swap
     so it shapes the final colour space, not the raw sensor response. */
  vec3 applyColourCalibration(vec3 c) {
    float hR = u_calRH, hG = u_calGH, hB = u_calBH;
    if (hR == 0.0 && hG == 0.0 && hB == 0.0 &&
        u_calRS == 0.0 && u_calGS == 0.0 && u_calBS == 0.0 &&
        u_calST == 0.0) return c;
    /* Hue rotation matrix: each primary can bleed into its neighbours */
    float hRa = hR < 0.0 ? -hR : hR;
    float hGa = hG < 0.0 ? -hG : hG;
    float hBa = hB < 0.0 ? -hB : hB;
    vec3 rP = vec3(1.0 - hRa, max(0.0,  hR), max(0.0, -hR));
    vec3 gP = vec3(max(0.0, -hG), 1.0 - hGa, max(0.0,  hG));
    vec3 bP = vec3(max(0.0,  hB), max(0.0, -hB), 1.0 - hBa);
    /* mat3 constructor is column-major in GLSL */
    vec3 cal = vec3(
      dot(vec3(rP.x, gP.x, bP.x), c),
      dot(vec3(rP.y, gP.y, bP.y), c),
      dot(vec3(rP.z, gP.z, bP.z), c)
    );
    cal = max(cal, vec3(0.0));
    /* Per-channel saturation weighted by primary share */
    float luma = dot(cal, LUMW);
    float cSum = cal.r + cal.g + cal.b;
    if (cSum > 0.001) {
      vec3 masks = cal / cSum;
      float satAdj = masks.r * u_calRS + masks.g * u_calGS + masks.b * u_calBS;
      cal += (cal - vec3(luma)) * satAdj;
    }
    /* Shadow tint */
    if (u_calST != 0.0) {
      float sLuma = dot(max(cal, vec3(0.0)), LUMW);
      float mask  = 1.0 - smoothstep(0.0, 0.3, sLuma);
      float st    = u_calST * 0.25;
      cal = mix(cal, cal * vec3(1.0 + st, 1.0 - st, 1.0 + st), mask);
    }
    return cal;
  }

  vec3 applyVignette(vec3 c, vec2 uv) {
    if (u_vigAmt == 0.0) return c;
    vec2 d = (uv - u_vigCentre) * vec2(max(u_aspect, 1.0), max(1.0 / u_aspect, 1.0));
    float r = length(d);
    vec2 farCorner = vec2(max(u_vigCentre.x, 1.0 - u_vigCentre.x), max(u_vigCentre.y, 1.0 - u_vigCentre.y));
    float R = length(farCorner * vec2(max(u_aspect, 1.0), max(1.0 / u_aspect, 1.0)));
    float t = clamp(r / max(R, 1e-5), 0.0, 1.0);
    /* Remapped through the spread before the exponent, so there is a real
       dead zone rather than a curve that merely LOOKS gentle near the
       middle while still measurably brightening it. At spread 0 this is
       identical to the plain pow(t, fall) it replaced — the previous
       behaviour, kept reachable rather than deleted — but at the default
       0.55 the inner half of the frame sits at exactly 1.0 gain and only
       the outer ring past that radius moves at all. */
    float t2 = smoothstep(u_vigSpread, 1.0, t);
    float gain = 1.0 + u_vigAmt * pow(t2, u_vigFall);
    return c * max(gain, 0.0);
  }

  /* Highlight recovery and shadow lift, on luminance with the RGB triple
     ratio-scaled afterwards — the same construction applyContrast uses, so
     hue and saturation come through untouched rather than the shadows
     going flat and the highlights shifting as they lift.

     Exponential, not (1 + k), for the reason the white balance sliders are:
     a linear form goes negative at the extremes. And the mask widths are
     not free choices — an overlapping pair inverts the tonal order at
     strong settings, so a mid-grey comes out brighter than a highlight,
     which is glaring. The shadow mask closes by 0.50 and the highlight
     mask opens at 0.40 with its tail running past white to 1.20, which
     keeps its slope gentle. Solved numerically: this holds monotonic up to
     kS 1.12 and kH 0.62, and the constants below sit under both with
     margin.

     Recovery is a real limit, not a bug: a channel already at 1.0 has no
     information left to bring back. This pulls near-white down to reveal
     what is still there, and cannot invent what clipped in camera. */
  vec3 applyToneRegions(vec3 c, float hi, float sh) {
    if (hi == 0.0 && sh == 0.0) return c;
    float lum = dot(c, LUMW);
    if (lum <= 0.00001) return c;

    float p = linearToSrgb(vec3(lum)).x;
    const float PIVOT = 0.50;

    /* --- HIGHLIGHTS: RapidRAW port ---
       Ported from RapidRAW apply_highlights_adjustment (shader.wgsl).
       12 neighbours in two rings build a local luma reference (luma_base).
       detail_ratio = pixel / blur tells us whether this pixel is a bright
       speck (detail) or part of a broadly-lit region.  log2 of that ratio
       is soft-clipped and used to restore micro-contrast after compression
       or to gently exaggerate it during a boost.
       Blend fades in with smoothstep so the l_pivot region is seamless. */
    if (lum > u_hiPivot && hi != 0.0) {
      float L_PIVOT = u_hiPivot;   // Highlights range: 0.10 at the standard setting

      /* 12-tap ring filter — inner 4 at ~3.5px, outer 8 at ~7.5px/diag.
         Weights: inner 0.85, outer 0.50.  Inline to avoid array-index
         restrictions in GLSL ES 1.00. */
      float range_tol      = max(lum * 0.22, 0.03);
      float inv2RangeSq    = 1.0 / (2.0 * range_tol * range_tol);
      vec2  ts             = u_texelSize;
      float center_tex_lum = max(dot(srcLin(v_texCoord), LUMW), 1e-4);

      float sumL = lum, sumW = 1.0;
      /* 12 taps fully inlined — no macros (safer on mobile GLSL ES drivers) */
      { vec3 _sa=srcLin(v_texCoord+vec2(3.5,0.0)*ts);
        float _sla=lum*(max(dot(_sa,LUMW),0.0)/center_tex_lum);
        float _da=_sla-lum;
        float _wa=exp(-(_da*_da)*inv2RangeSq)*0.85;
        sumL+=_sla*_wa; sumW+=_wa; }
      { vec3 _sb=srcLin(v_texCoord+vec2(-3.5,0.0)*ts);
        float _slb=lum*(max(dot(_sb,LUMW),0.0)/center_tex_lum);
        float _db=_slb-lum;
        float _wb=exp(-(_db*_db)*inv2RangeSq)*0.85;
        sumL+=_slb*_wb; sumW+=_wb; }
      { vec3 _sc=srcLin(v_texCoord+vec2(0.0,3.5)*ts);
        float _slc=lum*(max(dot(_sc,LUMW),0.0)/center_tex_lum);
        float _dc=_slc-lum;
        float _wc=exp(-(_dc*_dc)*inv2RangeSq)*0.85;
        sumL+=_slc*_wc; sumW+=_wc; }
      { vec3 _sd=srcLin(v_texCoord+vec2(0.0,-3.5)*ts);
        float _sld=lum*(max(dot(_sd,LUMW),0.0)/center_tex_lum);
        float _dd=_sld-lum;
        float _wd=exp(-(_dd*_dd)*inv2RangeSq)*0.85;
        sumL+=_sld*_wd; sumW+=_wd; }
      { vec3 _se=srcLin(v_texCoord+vec2(7.5,0.0)*ts);
        float _sle=lum*(max(dot(_se,LUMW),0.0)/center_tex_lum);
        float _de=_sle-lum;
        float _we=exp(-(_de*_de)*inv2RangeSq)*0.5;
        sumL+=_sle*_we; sumW+=_we; }
      { vec3 _sf=srcLin(v_texCoord+vec2(-7.5,0.0)*ts);
        float _slf=lum*(max(dot(_sf,LUMW),0.0)/center_tex_lum);
        float _df=_slf-lum;
        float _wf=exp(-(_df*_df)*inv2RangeSq)*0.5;
        sumL+=_slf*_wf; sumW+=_wf; }
      { vec3 _sg=srcLin(v_texCoord+vec2(0.0,7.5)*ts);
        float _slg=lum*(max(dot(_sg,LUMW),0.0)/center_tex_lum);
        float _dg=_slg-lum;
        float _wg=exp(-(_dg*_dg)*inv2RangeSq)*0.5;
        sumL+=_slg*_wg; sumW+=_wg; }
      { vec3 _sh=srcLin(v_texCoord+vec2(0.0,-7.5)*ts);
        float _slh=lum*(max(dot(_sh,LUMW),0.0)/center_tex_lum);
        float _dh=_slh-lum;
        float _wh=exp(-(_dh*_dh)*inv2RangeSq)*0.5;
        sumL+=_slh*_wh; sumW+=_wh; }
      { vec3 _si=srcLin(v_texCoord+vec2(5.3,5.3)*ts);
        float _sli=lum*(max(dot(_si,LUMW),0.0)/center_tex_lum);
        float _di=_sli-lum;
        float _wi=exp(-(_di*_di)*inv2RangeSq)*0.5;
        sumL+=_sli*_wi; sumW+=_wi; }
      { vec3 _sj=srcLin(v_texCoord+vec2(-5.3,5.3)*ts);
        float _slj=lum*(max(dot(_sj,LUMW),0.0)/center_tex_lum);
        float _dj=_slj-lum;
        float _wj=exp(-(_dj*_dj)*inv2RangeSq)*0.5;
        sumL+=_slj*_wj; sumW+=_wj; }
      { vec3 _sk=srcLin(v_texCoord+vec2(5.3,-5.3)*ts);
        float _slk=lum*(max(dot(_sk,LUMW),0.0)/center_tex_lum);
        float _dk=_slk-lum;
        float _wk=exp(-(_dk*_dk)*inv2RangeSq)*0.5;
        sumL+=_slk*_wk; sumW+=_wk; }
      { vec3 _sl=srcLin(v_texCoord+vec2(-5.3,-5.3)*ts);
        float _sll=lum*(max(dot(_sl,LUMW),0.0)/center_tex_lum);
        float _dl=_sll-lum;
        float _wl=exp(-(_dl*_dl)*inv2RangeSq)*0.5;
        sumL+=_sll*_wl; sumW+=_wl; }

      float luma_base    = sumL / max(sumW, 1e-4);
      float detail_ratio = lum / max(luma_base, 1e-4);
      float safe_detail  = clamp(detail_ratio, 0.65, 1.55);
      float log_det      = log2(safe_detail);
      float soft_log     = log_det / (1.0 + (log_det < 0.0 ? -log_det : log_det) * 0.40);

      float target_lum;
      if (hi < 0.0) {
        float k               = -hi;
        float delta_base      = max(luma_base - L_PIVOT, 0.0);
        float comp_strength   = k * 2.2;
        float comp_delta      = delta_base / (1.0 + comp_strength * (delta_base / (1.0 + delta_base * 0.35)));
        float target_base     = L_PIVOT + comp_delta;
        float restoration     = 1.0 + k * 0.55;
        float recovered       = target_base * exp2(soft_log * restoration);
        float blend           = smoothstep(L_PIVOT, L_PIVOT + 0.35, lum);
        target_lum            = mix(lum, recovered, blend);
      } else {
        float boost           = hi * 0.70;
        float delta_base      = max(luma_base - L_PIVOT, 0.0);
        float boost_delta     = delta_base * (1.0 + boost / (1.0 + delta_base * 0.25));
        float target_base     = L_PIVOT + boost_delta;
        float det_boost       = exp2(soft_log * (1.0 + hi * 0.20));
        float boosted         = target_base * det_boost;
        float blend           = smoothstep(L_PIVOT, L_PIVOT + 0.35, lum);
        target_lum            = mix(lum, boosted, blend);
      }

      /* Highlights no longer returns here: Shadows is applied to the result, so the two can be used together.
         Before, setting Highlights switched Shadows off for everything brighter than about a tenth of white, which
         left a hard step where the two met. */
      c = c * (target_lum / lum);
      lum = dot(c, LUMW);
      p = linearToSrgb(vec3(lum)).x;
      if (lum <= 0.00001) return c;
    }

    /* --- SHADOWS: RapidRAW-style lift + detail preservation ---
       Ported from RapidRAW's apply_shadows_blacks (shader.wgsl).

       Instead of a simple power curve, this uses a high-order polynomial
       mask t*(1-t)^4.5 that concentrates the lift in deep shadows and
       fades to zero at mid-grey. The key addition over the old approach is
       a detail-preservation pass: we sample 4 neighbours at radius 2 to
       approximate a blurred local luma, then amplify the pixel/blur ratio
       proportionally to how much the lift applied. This restores the local
       micro-contrast that a global lift compresses — foliage texture and
       bark detail in blocked shadows come back rather than washing out.

       Noise protection: the detail amplification is gated by
       smoothstep(0, 0.08, t_blurred) so very dark noisy regions don't
       get their grain boosted instead of their detail. */
    float SHP = min(PIVOT * u_shW, 0.95);   // Shadows range: mid-grey at the standard setting
    if (p < SHP && sh != 0.0) {
      /* Approximate a blurred luma from 4 neighbours at radius 2 pixels.
         This is the single-pass approximation of RapidRAW's separate blur
         pass. Four taps at ±2 texels in each axis gives a reasonable
         local average without heavy cost. */
      float blurred_lum = lum;
      vec2 tx = u_texelSize * 2.0;
      vec3 n0 = srcLin(v_texCoord + vec2( tx.x, 0.0));
      vec3 n1 = srcLin(v_texCoord + vec2(-tx.x, 0.0));
      vec3 n2 = srcLin(v_texCoord + vec2(0.0,  tx.y));
      vec3 n3 = srcLin(v_texCoord + vec2(0.0, -tx.y));
      /* As a ratio to the source's own centre, carried onto this pixel: the neighbourhood says how this pixel stands
         against its surroundings, and every global edit since (swap, white balance, contrast) moves both alike. Taken
         as an absolute value it compared the edited pixel with the unedited surroundings. */
      float srcCentre = max(dot(srcLin(v_texCoord), LUMW), 1e-4);
      blurred_lum = lum * (dot((n0 + n1 + n2 + n3) * 0.25, LUMW) / srcCentre);

      float safe_lum         = max(lum, 0.0001);
      float safe_blurred_lum = max(blurred_lum, 0.0001);

      /* Encode to perceptual space for the lift calculation (matches
         RapidRAW's pow(luma, 0.4545) = approximate gamma 2.2 decode). */
      float t_pixel   = pow(safe_lum, 0.4545);
      float t_blurred = pow(safe_blurred_lum, 0.4545);

      float new_lum;
      float luma_ratio;
      vec3  out_rgb;

      if (sh >= 0.0) {
        /* LIFT — unchanged RapidRAW polynomial lift + detail preservation,
           exactly as before: high-order curve concentrated in deep shadow,
           fading to zero by mid-grey, with a detail-preservation pass so
           lifted texture doesn't wash out. */
        /* The lift curve is stretched along the tone axis by the range (and scaled with it, so its steepness, and
           with it the guarantee that tones stay in order, is the same at every range). At 1.0 it is unchanged. */
        float tpw = clamp(t_pixel / u_shW, 0.0, 1.0);
        float shadow_lift = sh * u_shW * tpw * pow(max(1.0 - tpw, 0.0), 4.5);
        float lift_amount = max(shadow_lift, 0.0);
        float t_curved    = max(t_pixel + lift_amount, 0.0);

        float shadow_pivot  = 0.2 * u_shW;
        float stretch       = 1.0 + (lift_amount * 1.3);
        float t_contrasted  = shadow_pivot + (t_curved - shadow_pivot) * stretch;
        float final_t       = max(mix(t_curved, t_contrasted, 0.85), 0.0);
        new_lum = pow(final_t, 2.2);

        luma_ratio = new_lum / safe_lum;
        out_rgb = c * luma_ratio;

        float detail         = t_pixel / max(t_blurred, 0.0001);
        float safe_detail    = clamp(detail, 0.8, 1.25);
        float noise_protect  = smoothstep(0.0, 0.08, t_blurred);
        float detail_amp     = 1.0 + (lift_amount * 1.2 * noise_protect);
        float enhanced       = pow(safe_detail, detail_amp);
        float detail_correct = pow(enhanced / safe_detail, 2.2);
        out_rgb *= detail_correct;

        if (luma_ratio > 1.0) {
          float recovered_luma = dot(out_rgb, LUMW);
          float boost = clamp((luma_ratio - 1.0) * 0.15, 0.0, 0.4);
          out_rgb = mix(out_rgb, vec3(recovered_luma), boost);
        }
      } else {
        /* CRUSH — deliberately a much simpler curve than the lift side.
           Reusing the lift's contrast-stretch and detail-amplification
           machinery here amplified whatever local variance existed in
           dark tones, which in an already-noisy shadow IS the noise —
           producing the blotchy, "unprofessional" crush this replaces.

           A real editing tool's negative-shadow behaviour is just a
           gentle power-curve compression toward black, same shape family
           as the highlight-compression branch above it, no local-contrast
           step at all. Smooth, predictable, and doesn't fight sharpening
           or noise reduction over the same pixels. */
        float k = -sh;                              // 0..1
        float crushed = pow(t_pixel, 1.0 + k * 2.2); // higher exponent = darker
        /* Fade the effect out by mid-grey using the same window as the
           lift side, so Shadows still only touches shadows. */
        float mask = 1.0 - smoothstep(0.0, SHP, t_pixel);
        float final_t = mix(t_pixel, crushed, mask);
        new_lum = pow(final_t, 2.2);
        luma_ratio = new_lum / safe_lum;
        out_rgb = c * luma_ratio;
      }

      /* The lift side used to stop dead at mid-grey with its effect still non-zero there (a jump of several levels at
         +100). This fades it to exactly nothing between 0.30 and 0.50, and leaves everything darker untouched. The
         crush side already fades by its own mask. */
      float fadeLift = (sh >= 0.0) ? 1.0 - smoothstep(0.30 * SHP / PIVOT, SHP, p) : 1.0;
      return clamp(mix(c, out_rgb, fadeLift), 0.0, 1.0);
    }

    return c;
  }

  float sCurve(float x, float strength, float p) {
    x = clamp(x, 0.0, 1.0);
    p = clamp(p, 0.05, 0.95);
    if (x < p) return p * pow(x / p, strength);
    return 1.0 - (1.0 - p) * pow((1.0 - x) / (1.0 - p), strength);
  }
  /* Aerochrome 1443 tone response, digitised from the published
     characteristic curves (Kodak F009_0385AC, "Exposure: Daylight 1/50 sec,
     Process: AR-5, Densitometry: Status A").

     Unlike the colour matrices in the preset list, this part IS from
     measured data. Two things come off that plot:

     GAMMA ~3.1. Density falls from 3.0 to 0.5 across about 0.8 log units of
     exposure, which is a far steeper slope than ordinary transparency film
     (~1.8-2.2) and enormously steeper than colour negative (~0.6). It is
     why Aerochrome frames go from held highlight to blocked shadow so fast,
     and why the published figure for usable range is only about 2.7 stops.

     LAYER SPEED OFFSETS, and these are not specific to 1443. Pease (1969)
     states outright that 8443's cyan layer "requires close to twice the
     exposure of the other layers", which is 0.30 log10 \u2014 exactly the
     cyan-to-yellow gap digitised from these 1443 curves. NASA's 1972 study
     of 2443 measured about 1.5 stops for the same thing. Three stocks
     spanning 1959 to 2009, the same stagger in the same direction, so this
     control is named for the family rather than one film: building a
     separate 8443 response would have duplicated this one, not added to it.
     The three curves do not sit on top of one another:
     read at mid density, the blue/green layer is a full stop faster than the
     red/IR layer, with green/red a third of a stop between them. That
     staggering is a real part of the look — it is what shifts the colour
     balance as exposure changes, rather than the whole frame simply getting
     lighter or darker together.

     Modelled as a logistic in log-exposure, which is the standard shape for
     a characteristic curve's straight-line section plus its shoulder and
     toe, with one curve per channel offset by the measured amounts. */
  vec3 filmToneAerochrome(vec3 c) {
    const float GAMMA = 3.12;
    // measured offsets, in log10 units, relative to the red/IR layer
    const vec3 SPEED = vec3(0.0, -0.10, -0.30);
    vec3 lg = log2(max(c, vec3(0.0005))) * 0.30103;     // log10 of the value
    vec3 t = (lg - SPEED + 0.85) * GAMMA;               // -0.85 = mid-density point
    return clamp(1.0 / (1.0 + exp(-t * 2.3026)), 0.0, 1.0);
  }

  vec3 applyContrast(vec3 c, float strength) {
    float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (lum <= 0.00001) return c;
    /* The S-curve runs on perceived lightness (the sRGB encoding), pivoting
       on the encoded median, and hue is kept by scaling all three channels by
       the luminance ratio. Measured against the earlier curve in linear
       light, the two agree to within a few levels everywhere except the very
       deepest shadows, which this one keeps slightly more open. */
    float e = linearToSrgb(vec3(min(lum, 1.0))).x;
    float pe = clamp(linearToSrgb(vec3(clamp(u_contrastPivot, 0.05, 0.95))).x, 0.05, 0.95);
    float newLum = srgbToLinear(vec3(sCurve(e, strength, pe))).x;
    return c * (newLum / lum);
  }

  /* 3D LUT sampled from a 2D tile atlas.

     WebGL1 has no 3D textures, so the cube is unrolled into a strip: N tiles
     laid left to right, one per blue slice, each tile N wide by N tall
     addressing red across and green down. Hardware LINEAR filtering then
     gives interpolation along red and green for free; only blue has to be
     interpolated by hand, as a mix between two adjacent tiles.

     The +0.5 and the 1/(N*N) scaling put the sample exactly on texel
     CENTRES and keep red inside its own tile — without that inset, bilinear
     filtering at r=0 and r=1 would bleed across the tile seam and pull in a
     colour from a completely unrelated blue slice, which shows up as thin
     wrong-coloured bands at the extremes of the red axis. */
  /* A near-duplicate of lutLookup below, against the second sampler. GLSL ES
     1.00 cannot take a sampler as a function parameter, so the alternative
     to duplicating is a #define macro, which would be harder to read for no
     saving. The tile-inset maths is identical — see that function's note. */
  vec3 lutPreLookup(vec3 c) {
    float N = u_lutPreSize;
    c = clamp(c, 0.0, 1.0);
    float zf = c.b * (N - 1.0);
    float z0 = floor(zf);
    float z1 = min(z0 + 1.0, N - 1.0);
    float fz = zf - z0;
    float xIn = (c.r * (N - 1.0) + 0.5) / (N * N);
    float y   = (c.g * (N - 1.0) + 0.5) / N;
    float tile = 1.0 / N;
    vec3 s0 = texture2D(u_lutPre, vec2(z0 * tile + xIn, y)).rgb;
    vec3 s1 = texture2D(u_lutPre, vec2(z1 * tile + xIn, y)).rgb;
    return mix(s0, s1, fz);
  }

  vec3 lutLookup(vec3 c) {
    float N = u_lutSize;
    vec3 d = max(u_lutDomainMax - u_lutDomainMin, vec3(0.000001));
    c = clamp((c - u_lutDomainMin) / d, 0.0, 1.0);

    float zf = c.b * (N - 1.0);
    float z0 = floor(zf);
    float z1 = min(z0 + 1.0, N - 1.0);
    float fz = zf - z0;

    float xIn = (c.r * (N - 1.0) + 0.5) / (N * N);
    float y   = (c.g * (N - 1.0) + 0.5) / N;
    float tile = 1.0 / N;

    vec3 s0 = texture2D(u_lut, vec2(z0 * tile + xIn, y)).rgb;
    vec3 s1 = texture2D(u_lut, vec2(z1 * tile + xIn, y)).rgb;
    return mix(s0, s1, fz);
  }

  float g_maskShown = 0.0;
  /* Build 153: the vegetation index of this pixel, kept for the foliage (IR) mask. Measured exactly where the NDVI /
     NGB view measures it: on the white-balanced channels BEFORE the swap, while there is still a separate near-IR term
     (red) and a visible term (green for NDVI, blue for NGB). Leaves reflect strongly in the near infrared and absorb
     visible light for photosynthesis, so the index separates foliage from sky, water, stone and skin by physics, not by
     colour, which after a channel swap no longer says anything about what a surface is. */
  float g_ndvi = 0.0, g_ngb = 0.0;

  /* Weight of one mask at this pixel, 0..1. Geometry is in image space with y
     down, which is what v_texCoord is. Linear and radial work from position;
     luminosity works from the brightness of the image BEFORE any local
     change, so masks never feed each other. */
  float maskWeight(vec4 g, vec4 info, float lumaBase, vec3 labBase, vec2 uv) {
    float f = clamp(info.y, 0.0, 1.0);
    float m;
    if (info.x < 0.5) {
      vec2 asp = vec2(max(u_aspect, 0.0001), 1.0);   // so the direction is true on screen
      vec2 a = g.xy * asp, b = g.zw * asp, p = uv * asp;
      vec2 ab = b - a;
      float sp = dot(p - a, ab) / max(dot(ab, ab), 1e-6);
      float w = 0.5 * (f + 0.02);
      m = 1.0 - smoothstep(0.5 - w, 0.5 + w, sp);
    } else if (info.x < 1.5) {
      vec2 d = (uv - g.xy) / max(g.zw, vec2(0.005));
      m = 1.0 - smoothstep(min(1.0 - f, 0.999), 1.0, length(d));
    } else if (info.x < 2.5) {
      float soft = max(f * 0.3, 0.005);
      m = smoothstep(g.x - soft, g.x, lumaBase) * (1.0 - smoothstep(g.y, g.y + soft, lumaBase));
    } else if (info.x > 3.5) {
      /* Foliage (IR): selects by vegetation index, g.x..g.y on the index scale (-1..1), g.z picks the index
         (0 = NDVI, red vs green; 1 = NGB, red vs blue). */
      float idx = g.z > 0.5 ? g_ngb : g_ndvi;
      float soft = max(f * 0.3, 0.005);
      m = smoothstep(g.x - soft, g.x, idx) * (1.0 - smoothstep(g.y, g.y + soft, idx));
    } else {
      /* Colour range: distance from the picked colour in OKLab, which is
         close to perceptual, so the edge of the selection looks even. Colour
         counts fully and lightness less (0.45), because one surface runs
         from shade to sun and should stay selected. */
      vec3 d = labBase - g.xyz;
      float dist = length(vec3(d.x * 0.45, d.y, d.z));
      float rad = max(g.w, 0.005);
      m = 1.0 - smoothstep(min(rad * (1.0 - f), rad - 0.0005), rad, dist);
    }
    return info.z > 0.5 ? 1.0 - m : m;
  }

  /* Local adjustments, applied last (after the LUT) in linear light, each
     scaled by its mask weight. Order within a mask: white balance, exposure,
     contrast, saturation; the result is gamut-mapped once at the end the
     same hue-preserving way every other stage is. */
  vec3 applyLocalAdjust(vec3 srgbIn) {
    vec3 lin = srgbToLinear(srgbIn);
    float lumaBase = dot(srgbIn, LUMW);
    vec3 labBase = linearToOklab(lin);
    if (u_maskGuideOn > 0.5) {   // the selection is decided from smoothed colour; the adjustment itself still lands per pixel
      labBase = guidedLab(u_maskGuide, u_mGuideTexel, labBase);
      lumaBase = dot(linearToSrgb(max(oklabToLinear(labBase), vec3(0.0))), LUMW);
    }
    bool touched = false;
    for (int i = 0; i < 4; i++) {
      if (float(i) < u_maskN) {
        float m = maskWeight(u_mGeom[i], u_mInfo[i], lumaBase, labBase, v_texCoord);
        if (abs(u_maskView - float(i)) < 0.5) g_maskShown = m;
        if (m > 0.0005) {
          vec4 A = u_mAdj[i];
          vec4 B = u_mAdj2[i];
          if (A.w != 0.0 || B.x != 0.0) {
            float t = A.w * m, tn = B.x * m;
            vec3 gn = vec3(exp(0.28 * t + 0.12 * tn), exp(-0.16 * tn), exp(-0.28 * t + 0.12 * tn));
            lin *= gn / dot(gn, LUMW);
          }
          if (A.x != 0.0) lin *= exp2(A.x * m);
          if (A.y != 1.0) lin = applyContrast(lin, mix(1.0, A.y, m));
          if (A.z != 1.0) lin = hueSat(lin, 0.0, mix(1.0, A.z, m), 0.0, 0.0);
          touched = true;
        }
      }
    }
    if (!touched) return srgbIn;
    float pullLoc;
    return linearToSrgb(gamutMapT(lin, pullLoc));
  }

  void main() {
    vec4 texColor = texture2D(u_image, u_prepped > 0.5 ? prepUV(v_texCoord) : v_texCoord);
    if (u_prepped < 0.5) {
    /* Lateral chromatic aberration: red and blue are magnified slightly
       differently from green, so they are re-sampled along the radius about
       the image centre. Only this first fetch is shifted; the neighbourhood
       taps used by the local-contrast passes keep reading unshifted luma,
       which is what they are comparing against anyway. */
    if (u_caR != 0.0 || u_caB != 0.0) {
      vec2 caD = v_texCoord - vec2(0.5);
      texColor.r = texture2D(u_image, vec2(0.5) + caD * (1.0 + u_caR)).r;
      texColor.b = texture2D(u_image, vec2(0.5) + caD * (1.0 + u_caB)).b;
    }

    /* ---------- LINEAR STAGE ----------

       Everything downstream of here works on sRGB-encoded values, which is
       correct for the look controls: a tone curve is defined against what you
       see. But exposure and highlight recovery are not look controls, they
       are photometric, and doing them on encoded values is what made raw
       files behave like JPEGs. Multiplying an encoded value by two is not one
       stop; it is a hue-shifting brightness smear whose effect depends on
       where you started.

       So those two happen here, in linear light, BEFORE encoding — and for a
       raw file the texture still carries the headroom above 1.0 that the
       8-bit canvas had to clip, so there is something real for recovery to
       pull back. A JPEG has no such headroom and never will, but it is
       linearised here anyway so the controls behave identically on both;
       exposure simply runs out sooner, which is the truth about a JPEG. */
    /* Debanding. A smooth sky in an 8-bit photo has only a few dozen levels across it, so it is already stepped, and every
       edit that stretches colour (contrast, saturation, hue pushes) stretches the steps with it, and the output dither is
       far too small to hide a step that has been made several levels tall. JPEG adds blocks the same way. So this runs on
       the picture as it comes in: for a few rings out from the pixel it averages four taps, and takes that average only if it
       is within a small threshold of the pixel on that channel, so a step one or two levels tall is melted into the ramp
       while a real edge, being much taller than the threshold, is left alone. The taps are rotated per pixel by noise so
       the result has no pattern. Only for 8-bit sources: a RAW's linear float texture has no steps to melt. */
    if (u_deband > 0.0 && u_inputLinear < 0.5) {
      vec3 c0 = texColor.rgb;
      float thr = u_deband * 0.030;
      float ang0 = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      for (int di = 1; di <= 3; di++) {
        float dist = u_debandRad * u_deband * float(di) / 3.0;
        float ang = ang0 + float(di) * 2.3999632;
        vec2 o1 = vec2(cos(ang), sin(ang)) * dist * u_texelSize;
        vec2 o2 = vec2(-o1.y, o1.x) * (u_texelSize.x > 0.0 ? 1.0 : 1.0);
        vec3 avg = 0.25 * (texture2D(u_image, v_texCoord + o1).rgb + texture2D(u_image, v_texCoord - o1).rgb +
                           texture2D(u_image, v_texCoord + o2).rgb + texture2D(u_image, v_texCoord - o2).rgb);
        vec3 w = 1.0 - smoothstep(vec3(thr * 0.5), vec3(thr), abs(avg - c0));
        c0 = mix(c0, avg, w);
      }
      texColor.rgb = c0;
    }
    /* Exact sRGB decode. This was pow(x, 2.2), but the value is re-encoded below with the exact sRGB curve, and the
       two do not cancel: at default settings a JPEG's level 13 came out as 4 and 26 as 18, so every 8-bit photo lost
       its deep shadows before any edit. srgbToLinear is the exact inverse of linearToSrgb. */
    vec3 lin = u_inputLinear > 0.5
      ? max(texColor.rgb, 0.0)
      : srgbToLinear(clamp(texColor.rgb, 0.0, 1.0));

    lin = stage1Lin(lin, v_texCoord);   // hotspot, exposure, highlight recovery

    texColor.rgb = clamp(lin, 0.0, 1.0);
    /* Back to encoded space for everything below. Use linearToSrgb (proper
       IEC 61966-2-1) rather than pow(1/2.2). The look pipeline decodes with
       srgbToLinear (also proper IEC), so the two must be exact inverses or
       the round-trip introduces a channel-dependent error: at the dark reds
       typical of IR foliage the green channel error was +6.8% vs red at -2%,
       washing the colour toward neutral and making exposure feel like a
       saturation squeeze rather than a clean stop change. */
    texColor.rgb = linearToSrgb(texColor.rgb);
    /* Runs first in the SHADER, before camera-fit, swap, or anything else
       here touches the pixel.

       IMPORTANT CORRECTION to what this comment used to claim. It said that
       running first means white balance's blue gain "isn't also amplifying
       sensor noise". That is true for JPEG/PNG input. It is NOT true for
       RAW, and RAW is where the noise complaints come from.

       On the RAW path, rawEngineResultToCanvas() applies the white-balance
       gains AND the camera colour matrix on the CPU, per pixel, while
       building the texture this shader samples. So by the time any of this
       runs, the amplification has already happened and been baked in. The
       denoise below is cleaning up noise that was multiplied first —
       exactly backwards from a raw converter, which denoises in the sensor
       domain BEFORE gains are applied. On IR material the blue gain is
       routinely several times unity, so its read noise arrives here already
       several times larger, and no amount of post-hoc smoothing recovers
       what that cost.

       Fixing it properly means doing the chroma pass inside the decode loop,
       on linear R/G/B before the wb[] multiply. That is a real change, not a
       tuning one: the decode runs once at load, so a live slider would have
       to trigger a re-decode. Left as a known limitation rather than
       pretended away.

       REWRITTEN. The previous version ran one 3x3 edge-aware blend over
       RGB jointly, with a single fixed sigma. Two structural problems, and
       they are most of the gap against a real denoiser:

       1. LUMA AND CHROMA WERE TREATED THE SAME. They should not be. Chroma
          noise is the coloured blotching that dominates high-ISO and
          heavily-gained IR material, it is low-frequency, and real chroma
          detail is almost never sharp -- so it can be smoothed hard at a
          wide radius with barely any perceptual cost. Luma noise is
          fine-grained and sits right on top of the detail you want to keep,
          so it needs a tight sigma and a small radius. Running one filter
          over both means every setting is a compromise: strong enough to
          clear the blotches destroys detail, weak enough to keep detail
          leaves the blotches. Splitting them is the single biggest win
          available here.

       2. RADIUS 1 CANNOT SEE LOW-FREQUENCY NOISE. A 3x3 neighbourhood only
          removes pixel-to-pixel grain. Chroma blotches are several pixels
          across, so the old filter could not touch them at any strength --
          it averaged noise that was already correlated with its neighbours.
          Chroma now gets a second ring at radius 3 as well.

       Sigma stays fixed rather than tracking brightness, and that is
       deliberate: shot noise grows as sqrt(signal) in LINEAR light, but this
       runs on the sRGB-encoded value, where the encoding's derivative falls
       off at roughly the same rate. The two nearly cancel (sigma_encoded
       varies as L^-0.08), so encoded noise is close to constant across the
       tonal range and a fixed sigma is the right model here.

       Luma is deliberately held to 60% of the slider value while chroma
       goes to full, matching how these are used in practice -- chroma
       denoise is close to free, luma denoise always costs detail.

       Still a single pass: no multi-scale/wavelet decomposition, and no
       per-channel RAW-domain handling. It will not match Lightroom. */
    if (u_noiseReduction > 0.0 || u_noiseColour > 0.0) {
      /* Ported from RapidRAW's apply_noise_reduction (shader.wgsl, WGSL→GLSL).

         LUMA PASS: edge-aware bilateral with two-pass Tukey bisquare outlier
         rejection. Collects 24 neighbours in a 5×5 window with spatial
         Gaussian weights. An edge gate zeros out samples on the wrong side of
         the local luma midpoint so the filter cannot average across a hard
         edge. A first-pass mean is computed; a second pass then downweights
         outliers by (1 - (d/tol)²)² (Tukey bisquare), so hot pixels fade out
         rather than pulling the result. Stride grows at high settings to reach
         coarser grain; subpixel jitter breaks the fixed-grid pattern.

         CHROMA PASS: bilateral in R-Y / B-Y chrominance space with three
         independent gates — spatial, luma-similarity (no bleeding across
         brightness edges), and chroma-similarity (no bleeding across colour
         boundaries). Stride is wider than luma since chroma noise is coarser.
         G chroma is derived from R and B via the luma constraint rather than
         filtered separately, so luma is exactly preserved. */

      /* Same neighbourhood, in picture terms, at every render size: the taps step u_nrScale source pixels
         apart, so a full-resolution render or export filters the same area the working preview does
         instead of a patch 2-3x smaller (which made noise reduction look far weaker once full-res
         rendered). 1.0 in the preview, so the preview itself is unchanged. */
      float nrS       = max(u_nrScale, 1.0);
      float nrT       = nrS;   // per-pixel noise is ~nrS times the preview's, so the similarity tolerances scale with it
      /* Above preview scale, every tap lands between four pixels so the GPU's bilinear filter averages them,
         like the working preview's own pixels already are (each ~6 source px); the centre used for the
         similarity tests is averaged the same way. The output still starts from the full-res pixel. */
      vec2  nrHalf    = nrS > 1.5 ? 0.5 * u_texelSize : vec2(0.0);
      vec3  center    = texColor.rgb;
      float cLuma     = dot(center, LUMW);
      vec3  cRefRGB   = nrS > 1.5 ? stage1At(v_texCoord + nrHalf) : center;
      float cRef      = dot(cRefRGB, LUMW);
      vec3  cChroma   = center - vec3(cLuma);

      /* Subpixel jitter seeds — cheap hash, breaks grid banding. */
      vec2 pf = v_texCoord / u_texelSize;
      float h1 = fract(sin(dot(pf,              vec2(127.1, 311.7))) * 43758.5453);
      float h2 = fract(sin(dot(pf + vec2(17.31, 71.13), vec2(269.5, 183.3))) * 43758.5453);
      float h3 = fract(sin(dot(pf + vec2(43.7,  91.1),  vec2(127.1, 311.7))) * 43758.5453);
      float h4 = fract(sin(dot(pf + vec2(73.3,  17.9),  vec2(269.5, 183.3))) * 43758.5453);

      float lumaAmt   = u_noiseReduction;
      float chromaAmt = u_noiseColour;

      float newLuma   = cLuma;
      vec3  newChroma = cChroma;

      /* ---- LUMA PASS ---- */
      if (lumaAmt > 0.001) {
        float lCurve   = sqrt(lumaAmt);
        float strideF  = mix(1.0, 2.0, smoothstep(0.45, 0.95, lumaAmt));
        float extra    = clamp(strideF - 1.0, 0.0, 1.0);
        float lSpatial = mix(1.0, 1.5, lCurve);
        float lSpatN   = -1.0 / max(2.0 * lSpatial * lSpatial, 1e-6);

        /* Collect 25 samples inline. GLSL ES 1.00 requires array indices
           to be constant or loop variables, so we compute lmin/lmax and
           the initial gate in a single pass without storing to arrays.
           The second pass (Tukey) re-samples the same neighbours — the
           extra texture reads are acceptable given the quality gain. */
        float lmin = cRef, lmax = cRef;
        for (int dy = -2; dy <= 2; dy++) {
          for (int dx = -2; dx <= 2; dx++) {
            if (dx == 0 && dy == 0) continue;
            int adx = dx < 0 ? -dx : dx;
            int ady = dy < 0 ? -dy : dy;
            float ring    = float(adx > ady ? adx : ady);
            float ringFac = ring >= 2.0 ? 1.0 : 0.5;
            float grow    = 1.0 + extra * ringFac;
            float jx      = (h1 - 0.5) * 2.0 * extra;
            float jy      = (h2 - 0.5) * 2.0 * extra;
            vec2 off      = vec2(float(dx)*grow+jx, float(dy)*grow+jy) * u_texelSize * nrS + nrHalf;
            float nl      = dot(stage1At(v_texCoord + off), LUMW);
            lmin = min(lmin, nl);
            lmax = max(lmax, nl);
          }
        }

        float lumaRange    = lmax - lmin;
        float edgeStrength = smoothstep(0.04, 0.20, lumaRange);
        float edgeMid      = (lmin + lmax) * 0.5;
        float centreSideF  = cRef > edgeMid ? 1.0 : 0.0;
        float rangeTol = mix(
          mix(0.025, 0.075, lCurve),
          mix(0.010, 0.025, lCurve),
          edgeStrength
        ) * nrT;

        /* First pass: gate → initial mean. Re-samples neighbours. */
        float sumA = 0.0, wA = 0.0;
        /* Centre contributes with weight 1. */
        sumA += cRef; wA += 1.0;
        for (int dy = -2; dy <= 2; dy++) {
          for (int dx = -2; dx <= 2; dx++) {
            if (dx == 0 && dy == 0) continue;
            int adx = dx < 0 ? -dx : dx;
            int ady = dy < 0 ? -dy : dy;
            float ring    = float(adx > ady ? adx : ady);
            float ringFac = ring >= 2.0 ? 1.0 : 0.5;
            float grow    = 1.0 + extra * ringFac;
            float jx      = (h1 - 0.5) * 2.0 * extra;
            float jy      = (h2 - 0.5) * 2.0 * extra;
            vec2 off      = vec2(float(dx)*grow+jx, float(dy)*grow+jy) * u_texelSize * nrS + nrHalf;
            float nl      = dot(stage1At(v_texCoord + off), LUMW);
            float spat    = exp(float(dx*dx + dy*dy) * lSpatN);
            float diff    = nl > cRef ? nl - cRef : cRef - nl;
            float gRange  = 1.0 - smoothstep(rangeTol*0.6, rangeTol, diff);
            float sSideF  = nl > edgeMid ? 1.0 : 0.0;
            float gEdge   = mix(1.0, sSideF == centreSideF ? 1.0 : 0.0, edgeStrength);
            float w       = spat * gRange * gEdge;
            sumA += nl * w;
            wA   += w;
          }
        }
        float initMean = sumA / max(wA, 1e-4);

        /* Second pass: Tukey bisquare. Re-samples again. */
        float outlierTol = mix(0.07, 0.025, edgeStrength) * nrT;
        float sumB = 0.0, wB = 0.0;
        /* Centre always included in second pass. */
        { float d = cRef - initMean; float r = (d<0.?-d:d)/outlierTol;
          float bisq = max(0.0, 1.0-r*r); sumB += cRef*bisq*bisq; wB += bisq*bisq; }
        for (int dy = -2; dy <= 2; dy++) {
          for (int dx = -2; dx <= 2; dx++) {
            if (dx == 0 && dy == 0) continue;
            int adx = dx < 0 ? -dx : dx;
            int ady = dy < 0 ? -dy : dy;
            float ring    = float(adx > ady ? adx : ady);
            float ringFac = ring >= 2.0 ? 1.0 : 0.5;
            float grow    = 1.0 + extra * ringFac;
            float jx      = (h1 - 0.5) * 2.0 * extra;
            float jy      = (h2 - 0.5) * 2.0 * extra;
            vec2 off      = vec2(float(dx)*grow+jx, float(dy)*grow+jy) * u_texelSize * nrS + nrHalf;
            float nl      = dot(stage1At(v_texCoord + off), LUMW);
            float spat    = exp(float(dx*dx + dy*dy) * lSpatN);
            float diff1   = nl > cRef ? nl - cRef : cRef - nl;
            float gRange  = 1.0 - smoothstep(rangeTol*0.6, rangeTol, diff1);
            float sSideF  = nl > edgeMid ? 1.0 : 0.0;
            float gEdge   = mix(1.0, sSideF == centreSideF ? 1.0 : 0.0, edgeStrength);
            float gate    = spat * gRange * gEdge;
            if (gate > 0.0001) {
              float d    = nl - initMean;
              float r    = (d<0.?-d:d) / outlierTol;
              float bisq = max(0.0, 1.0-r*r);
              float w    = gate * bisq * bisq;
              sumB += nl * w;
              wB   += w;
            }
          }
        }
        float robustLuma = wB > 0.01 ? sumB / wB : initMean;
        float strength   = lumaAmt * mix(1.0, 0.6, edgeStrength);
        newLuma = mix(cLuma, robustLuma, strength);
      }

      /* ---- CHROMA PASS ---- */
      if (chromaAmt > 0.001) {
        float cCurve   = sqrt(chromaAmt);
        float strideC  = mix(2.0, 3.5, cCurve);
        float cSpatN   = -1.0 / max(2.0 * strideC * strideC, 1e-6);
        float lumaTol  = mix(0.12, 0.04, cCurve) * nrT;
        float lumaN    = -1.0 / max(2.0 * lumaTol  * lumaTol,  1e-6);
        float chromTol = mix(0.20, 0.08, cCurve) * nrT;
        float chromN   = -1.0 / max(2.0 * chromTol * chromTol, 1e-6);

        float cRY = cRefRGB.r - cRef;
        float cBY = cRefRGB.b - cRef;
        float jx2 = (h3 - 0.5) * strideC * 0.5;
        float jy2 = (h4 - 0.5) * strideC * 0.5;

        float sumR = cRY, sumB2 = cBY, wSum = 1.0;
        for (int dy = -2; dy <= 2; dy++) {
          for (int dx = -2; dx <= 2; dx++) {
            if (dx == 0 && dy == 0) continue;
            vec2 off  = vec2(float(dx) * strideC + jx2,
                             float(dy) * strideC + jy2) * u_texelSize * nrS + nrHalf;
            vec3 ns   = stage1At(v_texCoord + off);
            float nl  = dot(ns, LUMW);
            float nRY = ns.r - nl;
            float nBY = ns.b - nl;
            float r2  = float(dx*dx + dy*dy);
            float wS  = exp(r2 * cSpatN);
            float dl  = nl - cRef;
            float wL  = exp(dl * dl * lumaN);
            float dr  = nRY - cRY;
            float db2 = nBY - cBY;
            float wC  = exp((dr*dr + db2*db2) * chromN);
            float w   = wS * wL * wC;
            sumR     += nRY * w;
            sumB2    += nBY * w;
            wSum     += w;
          }
        }
        float fRY = sumR  / max(wSum, 1e-6);
        float fBY = sumB2 / max(wSum, 1e-6);
        float nRY = mix(center.r - cLuma, fRY, chromaAmt);
        float nBY = mix(center.b - cLuma, fBY, chromaAmt);
        /* G derived from luma constraint: r*Wr + g*Wg + b*Wb = luma */
        float nGY = -(LUMW.r * nRY + LUMW.b * nBY) / LUMW.g;
        newChroma = vec3(nRY, nGY, nBY);
      }

      /* Reconstruct: luma first (brightness only), then chroma (colour only).
         Keeping them independent prevents the spatial mismatch that caused
         the purple cast in the previous implementation. */
      vec3 outRgb = texColor.rgb;

      if (lumaAmt > 0.001 && cLuma > 0.001) {
        float lumScale = newLuma / cLuma;
        outRgb = outRgb * lumScale;
      }
      if (chromaAmt > 0.001) {
        float outLuma = dot(outRgb, LUMW);
        vec3 chromaRgb = vec3(outLuma) + newChroma;
        float chromaLum = dot(chromaRgb, LUMW);
        if (chromaLum > 0.001) chromaRgb *= outLuma / chromaLum;
        outRgb = mix(outRgb, chromaRgb, chromaAmt);
      }

      texColor.rgb = clamp(outRgb, 0.0, 1.0);
    }
    }   // end of the source stages (skipped when the prepared picture is already bound)
    if (u_prep > 0.5) { gl_FragColor = vec4(texColor.rgb, texColor.a); return; }
    /* CAPTURE SHARPENING.

       Demosaicing is a reconstruction: every pixel's two missing colours are
       interpolated from its neighbours, which unavoidably costs acuity. Every
       raw converter compensates with sharpening applied as a matter of course
       -- Lightroom ships every RAW at amount 40, radius 1.0 -- and this tool
       applied none at all, which is a large part of why its output looked
       softer than the same file elsewhere. This is not a creative effect; it
       is the step that returns what the demosaic took.

       Two choices that matter:

       LUMINANCE ONLY. The correction is computed on luma and added equally to
       all three channels, so colour is carried through untouched. Sharpening
       the channels independently amplifies chroma noise into coloured
       speckle, which on gained IR material is exactly the artefact you do not
       want more of.

       THRESHOLDED. A plain unsharp mask amplifies everything, noise
       included, in proportion to how flat the area is -- which is backwards,
       since flat areas are where noise is most visible and detail least. The
       correction is scaled by how much local structure there is, so an edge
       gets the full amount and a flat noisy sky gets almost none. */
    if (u_sharpen > 0.0) {
      /* RapidRAW-style two-scale sharpening + deconvolution + diagonal AA.
         Ported from RapidRAW apply_sharpen (shader.wgsl).

         THREE COMPONENTS:
         1. Two-scale USM: fine diff (pixel − blur1) + coarse diff (blur1 − blur2),
            weighted 1.25 / 0.25, both gated on the masking threshold.
         2. Deconvolution: a 5×5 Laplacian kernel adds structured edge recovery
            on top of the USM boost.
         3. Diagonal AA: when a sharp diagonal edge is detected (high gx·gy),
            a bilinear tap along the edge tangent softens the staircase while
            preserving the sharpening delta.

         All on luma only — ratio-scaled back onto colour so hue is preserved.
         Shadow (<0.03) and highlight (>0.92) protection keep noise and clipping
         out of the boost path.

         blur1 ≈ sigma 1 px:  3×3 weighted sum (Gaussian approx, scale by radius)
         blur2 ≈ sigma 3.5 px: 5-tap cross at 3.5 px spacing (cheaper approximation)
         GLSL ES 1.00 has no const array constructors, so the 5-tap Laplacian
         kernel is implemented via an if-else chain on the loop index. */

      vec2 ts1 = u_texelSize * max(u_sharpenRadius, 0.5);
      vec2 ts2 = u_texelSize * max(u_sharpenRadius * 3.5, 1.5);

      /* blur1: 3×3 Gaussian approximation */
      float lumC = dot(srcEnc(v_texCoord), LUMW);
      float b1_acc = lumC * 0.25;
      b1_acc += dot(srcEnc(v_texCoord + vec2( ts1.x, 0.0)), LUMW) * 0.125;
      b1_acc += dot(srcEnc(v_texCoord + vec2(-ts1.x, 0.0)), LUMW) * 0.125;
      b1_acc += dot(srcEnc(v_texCoord + vec2(0.0,  ts1.y)), LUMW) * 0.125;
      b1_acc += dot(srcEnc(v_texCoord + vec2(0.0, -ts1.y)), LUMW) * 0.125;
      b1_acc += dot(srcEnc(v_texCoord + vec2( ts1.x,  ts1.y)), LUMW) * 0.0625;
      b1_acc += dot(srcEnc(v_texCoord + vec2(-ts1.x,  ts1.y)), LUMW) * 0.0625;
      b1_acc += dot(srcEnc(v_texCoord + vec2( ts1.x, -ts1.y)), LUMW) * 0.0625;
      b1_acc += dot(srcEnc(v_texCoord + vec2(-ts1.x, -ts1.y)), LUMW) * 0.0625;
      float l1 = b1_acc;

      /* blur2: 5-tap cross at coarse spacing */
      float l2 = lumC * 0.36;
      l2 += dot(srcEnc(v_texCoord + vec2( ts2.x, 0.0)), LUMW) * 0.16;
      l2 += dot(srcEnc(v_texCoord + vec2(-ts2.x, 0.0)), LUMW) * 0.16;
      l2 += dot(srcEnc(v_texCoord + vec2(0.0,  ts2.y)), LUMW) * 0.16;
      l2 += dot(srcEnc(v_texCoord + vec2(0.0, -ts2.y)), LUMW) * 0.16;

      /* Two-scale diffs */
      float d0 = lumC - l1;
      float d1 = l1  - l2;
      float thr = max(u_sharpenMask * 0.15, 1e-4);
      float g0  = smoothstep(thr * 0.20, thr * 0.85, d0 < 0.0 ? -d0 : d0);
      float g1  = smoothstep(thr * 0.12, thr * 0.55, d1 < 0.0 ? -d1 : d1);
      float boost = (d0 * 1.25 * g0 + d1 * 0.25 * g1) * u_sharpen;

      /* 5×5 Laplacian deconvolution kernel (RapidRAW coefficients).
         kw[i]: 0.01853, -0.21023, 1.38348, -0.21023, 0.01853
         GLSL ES 1.00 has no const float array constructors — use if-else. */
      float acc = 0.0;
      float lo_s = 1e9, hi_s = -1e9;
      float gx = 0.0, gy = 0.0;
      for (int iy2 = 0; iy2 < 5; iy2++) {
        float ky;
        if      (iy2 == 0 || iy2 == 4) ky =  0.01853;
        else if (iy2 == 1 || iy2 == 3) ky = -0.21023;
        else                            ky =  1.38348;
        float oy2 = float(iy2 - 2);
        vec2 tyOff = vec2(0.0, oy2) * ts1;
        for (int ix2 = 0; ix2 < 5; ix2++) {
          float kx;
          if      (ix2 == 0 || ix2 == 4) kx =  0.01853;
          else if (ix2 == 1 || ix2 == 3) kx = -0.21023;
          else                            kx =  1.38348;
          float ox2 = float(ix2 - 2);
          vec2 sOff = vec2(ox2, 0.0) * ts1 + tyOff;
          /* Clamp to image bounds via saturate — UV clamping handles edges */
          float sl = dot(srcEnc(clamp(v_texCoord + sOff, vec2(0.0), vec2(1.0))), LUMW);
          acc  += sl * kx * ky;
          lo_s  = min(lo_s, sl);
          hi_s  = max(hi_s, sl);
          /* 3×3 Sobel gradient for edge direction */
          if (ix2 >= 1 && ix2 <= 3 && iy2 >= 1 && iy2 <= 3) {
            gx += sl * ox2 * (2.0 - (oy2 < 0.0 ? -oy2 : oy2));
            gy += sl * oy2 * (2.0 - (ox2 < 0.0 ? -ox2 : ox2));
          }
        }
      }
      float deconv = (acc - lumC) * clamp(u_sharpen * 0.60, 0.0, 1.0);

      float rng   = max(hi_s - lo_s, 1e-5);
      float l_new = boost + deconv + lumC;
      /* Soft limit — RapidRAW sharpen_soft_limit */
      float lo_lim = lo_s - rng * 0.06;
      float hi_lim = hi_s + rng * 0.10;
      float margin = rng * 0.12;
      if (l_new > hi_lim) {
        float e = l_new - hi_lim; l_new = hi_lim + e / (1.0 + e / max(margin, 1e-5));
      } else if (l_new < lo_lim) {
        float e = lo_lim - l_new; l_new = lo_lim - e / (1.0 + e / max(margin, 1e-5));
      }

      /* Diagonal anti-aliasing: blend toward tangential average on staircase edges */
      float g2 = gx * gx + gy * gy;
      if (g2 > 1e-6) {
        float diag = clamp(2.0 * (gx < 0.0 ? -gx : gx) * (gy < 0.0 ? -gy : gy) / g2, 0.0, 1.0);
        float ep   = smoothstep(thr * 0.5, thr * 2.5, sqrt(g2) * 0.25);
        float aa   = 0.90 * diag * ep;
        if (aa > 0.002) {
          float inv_g = 1.0 / sqrt(g2);
          vec2 tang   = vec2(-gy, gx) * inv_g * 0.75;
          /* Bilinear tangent taps — manual lerp (no texelFetch in GLSL ES 1.00) */
          vec2 pTC = v_texCoord;
          vec2 tp_uv = clamp(pTC + tang * ts1, vec2(0.0), vec2(1.0));
          vec2 tn_uv = clamp(pTC - tang * ts1, vec2(0.0), vec2(1.0));
          float tp = dot(srcEnc(tp_uv), LUMW);
          float tn = dot(srcEnc(tn_uv), LUMW);
          float safe_tp = max(tp, lumC * 0.6);
          float safe_tn = max(tn, lumC * 0.6);
          float l_tan = (safe_tp + safe_tn + lumC * 2.0) * 0.25;
          float l_aa  = l_tan + (l_new - lumC);
          l_new = mix(l_new, l_aa, min(aa, 0.5));
        }
      }

      /* Shadow/highlight protection */
      float prot = smoothstep(0.0, 0.03, lumC) * (1.0 - smoothstep(0.92, 1.0, lumC));
      l_new = max(mix(lumC, l_new, prot), 0.0);
      l_new = max(l_new, lumC * 0.40);

      texColor.rgb = lumC > 0.001
        ? clamp(texColor.rgb * (l_new / lumC), 0.0, 1.0)
        : texColor.rgb;
    }

    /* Camera-colour match runs FIRST, on the encoded value, before anything
       else touches the pixel. It has to: the polynomial was fitted from RAW
       SENSOR colour to the camera's finished JPEG of the same frame, so its
       input has to be raw sensor colour. Applied at the end of the pipeline
       instead — where it was first put — a swap has already moved every
       channel, so the polynomial is fed colours it never saw and folds them
       all onto roughly one hue: measured on a real file with Cyclic + IR
       sub active, bush and sky both landed near 260 (purple) instead of 259
       and 117. Running it here means everything downstream — swap, WB,
       every slider — operates on camera-rendered colour, exactly as if the
       camera's JPEG had been loaded, but without its compression. */
    if (u_camFit > 0.5) {
      vec3 s0 = clamp(texColor.rgb, 0.0, 1.0);
      float r = s0.r, g = s0.g, b = s0.b;
      vec3 o = u_camCoef[0]
        + u_camCoef[1]*r     + u_camCoef[2]*g     + u_camCoef[3]*b
        + u_camCoef[4]*(r*g) + u_camCoef[5]*(r*b) + u_camCoef[6]*(g*b)
        + u_camCoef[7]*(r*r) + u_camCoef[8]*(g*g) + u_camCoef[9]*(b*b)
        + u_camCoef[10]*(r*r*r) + u_camCoef[11]*(g*g*g) + u_camCoef[12]*(b*b*b)
        + u_camCoef[13]*(r*g*b)
        + u_camCoef[14]*(r*r*g) + u_camCoef[15]*(r*r*b)
        + u_camCoef[16]*(g*g*r) + u_camCoef[17]*(g*g*b)
        + u_camCoef[18]*(b*b*r) + u_camCoef[19]*(b*b*g);
      texColor.rgb = clamp(o, 0.0, 1.0);
    }
    /* The built-in film LUT runs FIRST, before targeted colour, white
       balance and the swap. Fedia's reason: it is standing in for the
       channel swap itself, and the swap has to be the first thing in the
       workflow — put it after white balance and the axes it operates on
       have already been moved, so the WB you set no longer means what it
       meant when you set it.

       Applied on ENCODED values, not linear: a .cube from a grading tool is
       authored against display-referred input, so it has to be fed sRGB and
       the result converted back, or every entry is looked up at the wrong
       coordinate. */
    vec3 rgb;
    if (u_lutPreSize > 0.0 && u_lutPreMix > 0.0) {
      vec3 enc = clamp(texColor.rgb, 0.0, 1.0);
      rgb = srgbToLinear(mix(enc, lutPreLookup(enc), u_lutPreMix));
    } else {
      rgb = srgbToLinear(texColor.rgb);
    }
    // Reset BEFORE targetedHSL, not after: it now reports its own
    // out-of-gamut overshoot, and resetting afterward would wipe it.
    g_over = 0.0; g_under = 0.0;
    rgb = targetedHSL(rgb);   // SOOC colour only — before white balance, before the swap

    float pull1 = 0.0, pull2 = 0.0;

    /* Taken BEFORE the matrix: once channels are mixed there is no separate
       NIR or blue term left to difference. White balance is applied first so
       the ratio is measured on corrected channels rather than raw sensor
       response, which is what makes values comparable between frames. */
    {
      vec3 wbi = max(rgb * u_preWB, vec3(0.0));
      float dg = wbi.r + wbi.g, db = wbi.r + wbi.b;
      g_ndvi = dg > 0.0001 ? (wbi.r - wbi.g) / dg : 0.0;
      g_ngb = db > 0.0001 ? (wbi.r - wbi.b) / db : 0.0;
    }
    if (u_indexMode > 0) {
      vec3 wb = rgb * u_preWB;
      float nir = max(wb.r, 0.0);
      float other = max(u_indexMode == 1 ? wb.g : wb.b, 0.0);
      float denom = nir + other;
      float idx = denom > 0.0001 ? (nir - other) / denom : 0.0;
      gl_FragColor = vec4(indexRamp(idx), texColor.a);
      return;
    }

    rgb = u_wbMethod == 1 ? u_preWBM * rgb : rgb * u_preWB;
    float yPreSwap = dot(rgb, u_lumaW);   // Phil's step 2: record before the swap, with the ADAPTIVE weight
    /* Working space for the channel swap. Defaults to ProPhoto (u_swapSpace
       == 2), matching the always-on behaviour this replaced -- see the
       comment on SRGB_TO_PROPHOTO/PROPHOTO_TO_SRGB above for the original
       reasoning (a wider gamut holds more of a saturated colour's true
       position before the swap moves it, so more survives compression
       back down). Brought back as a genuine choice rather than removed
       outright: Rec2020 gives a milder version of the same effect for
       anyone who finds ProPhoto's lift too strong, and sRGB is the
       original, un-widened behaviour for anyone who wants the swap to
       match exactly what the raw matrix numbers say with no gamut-space
       side effect at all. */
    if (u_swapSpace == 1) {
      rgb = SRGB_TO_REC2020 * rgb;
      rgb = u_matrix * rgb;
      rgb += u_mOffset;
      rgb = REC2020_TO_SRGB * rgb;
    } else if (u_swapSpace == 0) {
      rgb = u_matrix * rgb;
      rgb += u_mOffset;
    } else if (u_swapSpace == 3) {
      rgb = u_swapT * rgb;
      rgb = u_matrix * rgb;
      rgb += u_mOffset;
      rgb = u_swapTi * rgb;
    } else if (u_swapSpace == 4) {
      /* Encoded: the matrix runs on the gamma-encoded values, which is what Photoshop's Channel Mixer does (and
         Lightroom-era channel-swap actions were written for). The same nine numbers give a different, and for
         recipes taken from such actions the intended, colour than in linear light. Clamped to the 0..1 box
         afterwards, as Photoshop does after every mixer. */
      vec3 enc = linearToSrgb(max(rgb, vec3(0.0)));
      enc = clamp(u_matrix * enc + u_mOffset, vec3(0.0), vec3(1.0));
      rgb = srgbToLinear(enc);
    } else {
      rgb = SRGB_TO_PROPHOTO * rgb;
      rgb = u_matrix * rgb;
      rgb += u_mOffset;
      rgb = PROPHOTO_TO_SRGB * rgb;
    }
    if (u_lumPreserve == 1) rgb = preserveLuma(rgb, yPreSwap);   // step 4
    /* Bring the swap back into gamut here, rather than letting the values
       run out of range and get clamped per-channel at the very end.

       A channel mix routinely lands outside the cube — the derived film
       matrices carry gains up to 1.44 with negative cross-terms, which is
       what makes them work — and a per-channel clamp handles that by
       flattening whichever channel overshot, which shifts the hue and kills
       the gradient. Measured before this was added: the three stock presets
       pinned 21.7%, 27.8% and 49% of the frame. gamutMapT already exists for
       exactly this and pulls toward the achromatic axis at constant hue, so
       an over-bright red becomes a slightly less saturated red instead of a
       clipped one.

       Placed after preserveLuma so it sees the final swapped value, and the
       pull it reports feeds the same "gamut pulled" readout as every other
       stage. */
    float pullSwap;
    rgb = gamutMapT(rgb, pullSwap);

    rgb = u_wbMethod == 1 ? u_postWBM * rgb : rgb * u_postWB;
    // Temperature/tint applied as a SEPARATE stage after the picker, so a
    // deliberate warm/magenta push layers on top of a neutral result
    // rather than the two fighting each other.
    rgb *= u_tempTint;
    /* Exposure has moved to the linear stage at the top of main(). Applying
       it here multiplied an sRGB-ENCODED value, which is not an exposure
       change at all: the same slider produced a different number of stops
       depending on the tone it landed on, and it could only ever scale values
       that had already been clipped to white. Doing it in linear light, while
       the raw headroom is still present, is what makes this behave like a raw
       converter rather than a JPEG editor. */
    // after exposure sets the overall level, before contrast shapes what is
    // left — so contrast acts on the recovered image rather than fighting it
    /* Before tone and colour, right after the SOOC stage: a vignette is a
       property of the LENS AND FILTER STACK, present before any grading
       decision, and correcting it there means Highlights/Shadows and
       Contrast are then judging the frame as the vignette leaves it, not
       fighting a darkening that hasn't been dealt with yet. */
    if (u_calRH != 0.0 || u_calGH != 0.0 || u_calBH != 0.0 ||
        u_calRS != 0.0 || u_calGS != 0.0 || u_calBS != 0.0 || u_calST != 0.0)
      rgb = applyColourCalibration(rgb);
    rgb = applyVignette(rgb, v_texCoord);
    if (u_clarity != 0.0) {
      /* Clarity: mid-tone local contrast.
         Compares each pixel's luma to a large-radius blur — the difference
         is structure (edges, texture) rather than fine noise or global tone.
         We amplify that ratio in log2 space, which gives perceptually even
         lift across the tonal range.

         Blur uses 8 taps at two radii (12px + 24px) to approximate a wide
         Gaussian; this gives enough spatial extent to see real subject
         structure rather than pixel-level texture (which Sharpen handles).

         Shadow/highlight protection prevents muddying pure blacks or haloing
         pure whites. Negative clarity adds a soft-focus glow by reversing
         the ratio — pulling each pixel toward the local average. */
      float cl_luma = dot(rgb, LUMW);
      float shadow_protect    = smoothstep(0.0, 0.06, cl_luma);
      float highlight_protect = 1.0 - smoothstep(0.85, 1.0, cl_luma);
      float midtone_mask      = shadow_protect * highlight_protect;
      if (midtone_mask > 0.001) {
        /* Two-ring blur: inner 4 taps at 12px, outer 4 at 24px.
           Weighted 0.6 / 0.4 — inner ring dominates but outer adds reach. */
        vec2 r1 = u_texelSize * 12.0;
        vec2 r2 = u_texelSize * 24.0;
        float blur_luma =
          dot(srcLin(v_texCoord + vec2( r1.x, 0.0)), LUMW) * 0.15
        + dot(srcLin(v_texCoord + vec2(-r1.x, 0.0)), LUMW) * 0.15
        + dot(srcLin(v_texCoord + vec2(0.0,  r1.y)), LUMW) * 0.15
        + dot(srcLin(v_texCoord + vec2(0.0, -r1.y)), LUMW) * 0.15
        + dot(srcLin(v_texCoord + vec2( r2.x, 0.0)), LUMW) * 0.10
        + dot(srcLin(v_texCoord + vec2(-r2.x, 0.0)), LUMW) * 0.10
        + dot(srcLin(v_texCoord + vec2(0.0,  r2.y)), LUMW) * 0.10
        + dot(srcLin(v_texCoord + vec2(0.0, -r2.y)), LUMW) * 0.10;
        /* The local ratio is measured on the source alone, centre against its own surroundings, and then applied to the
           edited pixel. It used to divide the EDITED pixel by the UNEDITED surroundings, so any global change (Exposure,
           white balance, the swap) read as local contrast: Exposure +1 with Clarity 50 brightened a featureless grey
           patch from 87 to 112. */
        float safe_cl   = max(dot(srcLin(v_texCoord), LUMW), 0.0001);
        float safe_blur = max(blur_luma, 0.0001);
        float log_ratio = log2(safe_cl / safe_blur);
        /* Soft-clip the ratio so extreme edges don't overshoot. */
        float soft_ratio = log_ratio / (1.0 + (log_ratio < 0.0 ? -log_ratio : log_ratio) * 0.5);
        /* Positive clarity: amplify local contrast (scale 2.5 for visible effect).
           Negative clarity: pull toward blur for soft-focus — much smaller scale
           (0.8) so it never drives pixels to black, just softens. */
        float scale = u_clarity > 0.0 ? 2.5 : 0.8;
        float effective = soft_ratio * u_clarity * scale;
        /* Additional clamp on negative side: never darken by more than 30% */
        if (u_clarity < 0.0) effective = max(effective, -0.37);
        vec3 cl_out = rgb * exp2(effective);
        cl_out = clamp(cl_out, vec3(0.0), vec3(2.0));
        rgb = mix(rgb, cl_out, midtone_mask);
      }
    }
    /* Dehaze. Uses the same 4-tap cross blur computed inside the clarity block
       (or recomputes it cheaply if clarity was zero).  Ported from RapidRAW
       apply_dehaze (shader.wgsl).

       PULL (u_dehaze > 0): estimates haze transmission from the regional dark
       channel, recovers colour via (pixel − A)/t + A where A is a fixed
       atmospheric light estimate, then boosts saturation proportional to
       haze removed.
       PUSH (u_dehaze < 0): adds a gentle atmospheric veil proportional to
       regional dark channel depth — useful for creating a misty IR mood. */
    if (u_dehaze != 0.0) {
      vec2 dz = u_texelSize * 3.0;
      vec3 db0 = srcLin(v_texCoord + vec2( dz.x, 0.0));
      vec3 db1 = srcLin(v_texCoord + vec2(-dz.x, 0.0));
      vec3 db2 = srcLin(v_texCoord + vec2(0.0,  dz.y));
      vec3 db3 = srcLin(v_texCoord + vec2(0.0, -dz.y));
      vec3 blurLin = (db0 + db1 + db2 + db3) * 0.25;
      /* Atmospheric light — slight blue bias matches natural haze colour */
      const vec3 ATMOS = vec3(0.95, 0.97, 1.0);
      /* Haze is judged on the source, centre and surroundings alike, and the removal applied to the edited pixel. */
      vec3  srcC        = srcLin(v_texCoord);
      float pixel_luma  = dot(srcC, LUMW);
      float blur_luma   = dot(blurLin, LUMW);
      if (u_dehaze > 0.0) {
        float pixel_dark    = min(srcC.r, min(srcC.g, srcC.b));
        float regional_dark = min(blurLin.r, min(blurLin.g, blurLin.b));
        /* Halo protection: blend dark channel toward pixel where edge detected */
        float edge_diff   = (pixel_luma > 0.0 ? sqrt(pixel_luma) : 0.0)
                          - (blur_luma  > 0.0 ? sqrt(blur_luma)  : 0.0);
        float halo_prot   = smoothstep(0.02, 0.15, edge_diff < 0.0 ? -edge_diff : edge_diff);
        float spatial_dark = mix(regional_dark, pixel_dark, halo_prot);
        float safe_dark    = max(spatial_dark - 0.02, 0.0);
        float mapped_haze  = safe_dark / (safe_dark + 0.2);
        float t            = max(1.0 - u_dehaze * mapped_haze * 0.85, 0.15);
        vec3  recovered    = (rgb - ATMOS) / t + ATMOS;
        /* Shadow floor lift from haze removal */
        float rec_luma   = dot(max(recovered, vec3(0.0)), LUMW);
        float shadow_lift = smoothstep(0.1, 0.0, rec_luma) * (1.0 - t) * 0.15;
        recovered += shadow_lift;
        /* Saturation boost proportional to haze removed */
        float sat_boost  = (1.0 - t) * 0.5;
        float final_luma = dot(max(recovered, vec3(0.0)), LUMW);
        recovered = mix(vec3(final_luma), recovered, 1.0 + sat_boost);
        rgb = max(recovered, vec3(0.0));
      } else {
        float regional_dark = min(blurLin.r, min(blurLin.g, blurLin.b));
        float safe_dark     = max(regional_dark - 0.02, 0.0);
        float mapped_depth  = safe_dark / (safe_dark + 0.2);
        float depth_factor  = mix(0.4, 1.0, mapped_depth);
        float strength      = -u_dehaze;
        rgb = mix(rgb, ATMOS, strength * 0.7 * depth_factor);
      }
    }
    /* ---- Tone mapping: RawTherapee's edge-preserving decomposition (EPD) ----
       Works on lightness (OKLab L) after the swap, white balance and the local-contrast passes, before Highlights and
       Shadows. The smooth base layer comes in as a texture (solved on the CPU at reduced size); this is the per-pixel
       half of RawTherapee's CompressDynamicRange, done at full resolution: the base is scaled by temp, the detail
       around it is boosted, and chroma follows RawTherapee's colour correction for tone mapping. Exposure sits earlier
       in this shader and scales OKLab lightness by its cube root, so the change since the base was measured is divided
       out here and put back, which keeps the base valid while Exposure is LOWERED. Raising it can push more of the
       picture into the clip that follows exposure (values are clamped at 1.0 there), which this cannot see, so a higher
       exposure asks for the base to be measured again (see epdKey). */
    if (u_epdProbe > 0.5 || u_epdOn > 0.5) {
      vec3 labE = linearToOklab(max(rgb, vec3(0.0)));
      float expC = exp(log(max(u_exposure / max(u_epdRef, 1e-6), 1e-6)) / 3.0);   // exposure relative to when the base was measured
      float Lp = labE.x / expC;
      if (u_epdProbe > 0.5) { gl_FragColor = vec4(Lp, Lp, Lp, 1.0); return; }
      /* While the base is waiting to be measured again after Exposure was raised, pixels that exposure has just pushed
         into the clip would look darker than the base expects and turn grey; they are left alone until it arrives. */
      bool staleClip = (u_exposure > u_epdRef * 1.0005) && max(rgb.r, max(rgb.g, rgb.b)) > 0.9;   // near white after the clip (white balance can pull clipped white a little under 1)
      if (!staleClip) {
        float Ln = max(Lp * u_epdNorm, 0.0);
        float srcL = log(Ln + 0.0001);
        float bs = texture2D(u_epdBase, v_texCoord).r;
        float ce = exp(srcL + bs * u_epdTemp) - 0.0001;
        float ue = exp(bs) - 0.0001;
        float Lo = max(ce + u_epdBoost * (Ln - ue), 0.0);
        labE.x = Lo / u_epdNorm * expC;
        labE.yz *= u_epdS;
        rgb = oklabToLinear(labE);
      }
    }
    rgb = applyToneRegions(rgb, u_highlights, u_shadows);
    /* Applied before the ordinary contrast slider, in linear light, so it
       stands in for the film's own response and the slider still works on
       top of it the way it would on any other image. */
    /* Blended rather than switched. The measured response is deliberately
       brutal — about 2.7 stops against a sensor's twelve — so at full
       strength it crushes anything not exposed for the film. Mixing toward
       it keeps the character (the steep slope and the staggered layers
       arrive together, in proportion) while letting the amount suit the
       frame. 0 is the untouched image, 100 is the curve as published. */
    if (u_filmTone > 0.001) rgb = mix(rgb, filmToneAerochrome(rgb), u_filmTone);
    rgb = applyContrast(rgb, u_contrast);
    float pullContrast;
    rgb = gamutMapT(rgb, pullContrast);
    pull1 = max(pull1, pullContrast);

    vec3 srgb = linearToSrgb(rgb);

    /* Brightness, distinct from Exposure above rather than a second name for
       the same thing. Exposure is a linear-light multiply \u2014 uniform across
       the whole tonal range, so it pushes highlights toward clipping exactly
       as hard as it lifts shadows. Brightness instead acts in gamma-encoded
       space with an x*(1-x) weighting: zero effect at pure black or pure
       white, maximum at the midtones. The *2.0 is a calibration choice, not
       a mathematical identity: x*(1-x) peaks at 0.25 (at x=0.5), and *4.0
       would renormalise that to a full 0\u21921 swing \u2014 but that saturates the
       midtone to pure white by just a quarter of the slider's range, wasting
       the rest of it. *2.0 instead reaches pure white only at the slider's
       actual maximum, so the full range stays usable rather than clipping
       early. This is the gentler, "lift the middle without blowing the top"
       control most photo tools mean by Brightness, as opposed to Exposure's
       harder, uniform stop-based push. */
    /* Brightness — ported from RapidRAW's apply_filmic_exposure (shader.wgsl).
       The old approach (srgb + b*srgb*(1-srgb)*0.5) is a symmetric midtone
       lift that treats all three channels identically, so hue is preserved
       but the lift is the same shape regardless of whether you're in the
       shadows or highlights.

       The rational curve here (luma / (luma + (1-luma)*k)) has a key
       property: the denominator grows sub-linearly with luma, so the lift
       is stronger in the midtones and rolls off progressively toward white
       and black — matching how brightness feels on a real image. Chroma is
       then scaled separately with a dynamic exponent (0.65–0.95) that
       preserves more saturation in bright tones and rolls back chroma in
       shadows where lifted colours tend to become garish. */
    if (u_brightness != 0.0) {
      /* The curve is driven by true relative luminance (weights applied in
         linear light, then re-encoded) rather than by weights applied to the
         gamma-encoded values, which is a different quantity and overstates
         how bright saturated blues and reds look. Flip BRIGHTNESS_TRUE_LUMA
         to false to get the previous behaviour back exactly. */
      const bool BRIGHTNESS_TRUE_LUMA = true;
      float br_luma = BRIGHTNESS_TRUE_LUMA
        ? linearToSrgb(vec3(dot(srgbToLinear(srgb), LUMW))).x
        : dot(srgb, LUMW);
      if (br_luma > 0.00001) {
        /* k drives the rational curve: k<1 lifts, k>1 darkens. */
        float k = pow(2.0, -u_brightness * 1.2);
        float luma_abs   = br_luma;
        float shaped_luma = luma_abs / (luma_abs + (1.0 - luma_abs) * k);
        float luma_scale  = shaped_luma / luma_abs;

        /* Chroma exponent: 0.65 in highlights (less saturation change),
           0.95 in shadows (more saturation preserved). */
        float luma_weight   = clamp(shaped_luma, 0.0, 1.0);
        float dynamic_exp   = mix(0.95, 0.65, luma_weight);
        float chroma_scale  = pow(luma_scale, dynamic_exp);

        /* Highlight rolloff: reduce chroma boost near white to avoid
           oversaturated lifted highlights. */
        float hi_rolloff   = clamp((1.05 - shaped_luma) / max(1.05 - br_luma, 0.0001), 0.0, 1.0);
        chroma_scale       = chroma_scale * mix(1.0, hi_rolloff, abs(u_brightness));

        vec3 chroma = srgb - vec3(br_luma);
        srgb = clamp(vec3(shaped_luma) + chroma * chroma_scale, 0.0, 1.0);
      }
    }

    if (u_blackPt > 0.0) {
      float bp = u_blackPt / 255.0;
      /* Soft toe rather than a hard clip. Rescaling and clamping sent
         everything below the threshold to exactly 0 with no separation left
         between any of it — which on a night shot is most of the frame, and
         once crushed it is gone from the export as well. The toe keeps the
         rescale identical above roughly a fifth of the range and rolls the
         bottom off instead, so the black point can be set hard while the
         darkest tones still hold some order. Mirrored from softKnee's shape,
         flipped to act on the low end, so the file has one curve and not two.

         Still reported to the clipping overlay: the toe compresses shadow
         detail heavily even where it does not flatten it outright, and that
         is worth seeing. */
      vec3 lifted = (srgb - bp) / (1.0 - bp);
      g_under = max(g_under, -min(min(lifted.r, lifted.g), lifted.b));
      /* The toe has to act on the INPUT, not on the lifted value: anything
         below the black point is already negative by then and clamps to zero
         before a curve can see it. Below a knee at twice the black point the
         response is quadratic, above it the ordinary linear rescale. Two
         times is not arbitrary — it is the only knee where the quadratic's
         slope matches the line's exactly, so the join is invisible with no
         constant to tune. */
      float K = min(2.0 * bp, 0.999);
      float scaleAtK = (K - bp) / (1.0 - bp);
      vec3 soft;
      soft.r = srgb.r >= K ? lifted.r : scaleAtK * pow(srgb.r / K, 2.0);
      soft.g = srgb.g >= K ? lifted.g : scaleAtK * pow(srgb.g / K, 2.0);
      soft.b = srgb.b >= K ? lifted.b : scaleAtK * pow(srgb.b / K, 2.0);
      srgb = clamp(soft, 0.0, 1.0);
    }

    if (u_whitePt > 0.0) {
      float wp = u_whitePt / 255.0;
      /* Mirror of the black point's soft toe above, same reasoning at the
         opposite end: a hard rescale-and-clip sends everything above the
         threshold to exactly 1.0 with no separation left between any of
         it — a flat blown highlight, which is precisely what this control
         exists to avoid rather than manufacture. The shoulder keeps the
         rescale identical below the knee and rolls the top off instead, so
         the white point can be pulled down hard while the brightest tones
         still hold some order.
         Knee and continuity built the same way as the black point's (knee
         at twice the distance from the anchor, scale matched at the knee)
         but mirrored rather than re-derived from scratch, and not
         separately re-checked for monotonicity across the full slider
         range the way the black point's was — worth that check if a
         strong setting is ever seen to invert tone order near white. */
      vec3 rescaled = srgb / (1.0 - wp);
      g_over = max(g_over, max(max(rescaled.r, rescaled.g), rescaled.b) - 1.0);
      float K = max(1.0 - 2.0 * wp, 0.001);
      float scaleAtK = K / (1.0 - wp);
      vec3 span = vec3(max(1.0 - K, 1e-5));
      vec3 shoulder;
      shoulder.r = srgb.r <= K ? rescaled.r : 1.0 - (1.0 - scaleAtK) * pow((1.0 - srgb.r) / span.r, 2.0);
      shoulder.g = srgb.g <= K ? rescaled.g : 1.0 - (1.0 - scaleAtK) * pow((1.0 - srgb.g) / span.g, 2.0);
      shoulder.b = srgb.b <= K ? rescaled.b : 1.0 - (1.0 - scaleAtK) * pow((1.0 - srgb.b) / span.b, 2.0);
      srgb = clamp(shoulder, 0.0, 1.0);
    }

    /* Tone curve, on the encoded image: a curve is defined against what you
       see. RGB curve first, then per-channel, baked into one 1024-entry
       table per channel on the CPU side. */
    if (u_curveOn > 0.5) {
      vec3 cc = clamp(srgb, 0.0, 1.0);
      if (u_curveLum > 0.5) {
        /* Luminance only: the RGB curve moves each pixel's brightness by the same amount on all three channels,
           which keeps the differences between them, so colours keep their hue and strength. The per-channel
           curves are then applied as usual (in this mode the table's RGB hold only those). */
        float L0 = dot(cc, LUMW);
        float L1 = texture2D(u_curve, vec2((L0 * 1023.0 + 0.5) / 1024.0, 0.5)).a;
        cc = clamp(cc + (L1 - L0), 0.0, 1.0);
      }
      srgb = vec3(
        texture2D(u_curve, vec2((cc.r * 1023.0 + 0.5) / 1024.0, 0.5)).r,
        texture2D(u_curve, vec2((cc.g * 1023.0 + 0.5) / 1024.0, 0.5)).g,
        texture2D(u_curve, vec2((cc.b * 1023.0 + 0.5) / 1024.0, 0.5)).b);
    }

    if (u_hue != 0.0 || u_sat != 1.0 || u_vibrance != 0.0) {
      // back to linear light for the OKLab round trip, then re-map: boosting
      // chroma can push a colour back out of gamut, and it has to be brought
      // in the same hue-preserving way rather than clipped at the last step
      vec3 lin = srgbToLinear(srgb);
      /* In channel mode the rotation happens in HSV FIRST, then hueSat runs
         with no rotation of its own — so saturation, the cusp solve and the
         gamut work Phil's fixes depend on all still happen in OKLab exactly
         as before. Only the hue step moves; nothing else is given up. */
      if (u_hueSpace == 1) {
        /* Build 117: hold each pixel's brightness through the channel-space turn. HSV keeps the brightest channel, not
           luminance, so on a noisy low-saturation sky the pixel-to-pixel hue jitter came out as green-weighted brightness
           speckle (measured 1.7x the sky's luminance noise at -66.5 deg). Holding it leaves the hue move exactly as before
           (120 deg is still the cyclic swap, at held brightness) and the noise as quiet as the perceptual mode's. */
        float yHue = dot(max(lin, vec3(0.0)), u_lumaW);
        lin = preserveLuma(hsvRotate(lin, u_hue), yHue);
        lin = hueSat(lin, 0.0, u_sat, u_satPreserve, u_vibrance);
      } else {
        lin = hueSat(lin, u_hue, u_sat, u_satPreserve, u_vibrance);
      }
      srgb = linearToSrgb(gamutMapT(lin, pull2));
    }

    if (u_hslOn > 0.5) {
      /* The guide pass stops here and writes the colour as it arrives, so the main pass can choose bands from it smoothed. */
      if (u_bandProbe > 0.5) { gl_FragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0); return; }
      float pullB;
      srgb = linearToSrgb(gamutMapT(applyHslBands(srgbToLinear(srgb), u_bandGuideOn), pullB));
    }

    /* ---- Deep sky and Crimson foliage: the reference false-colour palette ----
       In OKLab, after the colour bands. A colour test alone cannot tell a purple sky from purple foliage, or a grey-blue sky from
       a grey-blue wall, so the sky comes from a selection: a smooth area grown from the top edge of the picture (see skyMaskCompute),
       which leaves out textured foliage, warm colours and bright neutrals (clouds, white walls). Inside it lightness is scaled
       down and chroma and hue are brought to a navy, so a flat grey, teal, violet or blue sky all end up navy; the darker it
       goes the less colour noise is left to show. Foliage is what is NOT sky: purples, magentas and reds that carry some colour
       are turned toward crimson with more chroma and a little less lightness; the chroma gate leaves whites, greys, stone and
       pale tints alone. Pulling hue and chroma toward fixed values quietens colour noise instead of amplifying it. */
    if (u_skyDeep > 0.0 || u_crimson > 0.0 || u_skyShow > 0.5) {
      vec3 lin2 = srgbToLinear(srgb);
      vec3 lb = linearToOklab(max(lin2, vec3(0.0)));
      float Lq = lb.x, Cq = length(lb.yz);
      float hq = degrees(atan(lb.z, lb.y)); if (hq < 0.0) hq += 360.0;
      vec3 mt = texture2D(u_skyMask, v_texCoord).rgb;
      float fm = mt.g;
      /* The selection is worked out on a small copy, so its edge is soft and sat a little inside the real skyline: the sky
         right against the hills only got part of the darkening, which showed as a glowing band along every edge. Now the
         selection is widened past the edge (B), and across that border band each pixel takes part only as far as its own
         colour in the source picture looks like the sky, so the sky goes dark right up to the skyline and the hills, trees
         and roofs beside it are left alone. Deep inside the selection (R) the sky is treated whatever its exact colour. */
      // nine taps of the source a pixel and a half apart, so sensor noise does not decide which pixels count as sky
      vec3 srcAcc = vec3(0.0);
      for (int sy = -1; sy <= 1; sy++) for (int sx = -1; sx <= 1; sx++) srcAcc += texture2D(u_src, v_texCoord + vec2(float(sx), float(sy)) * 1.5 * u_texelSize).rgb;
      srcAcc /= 9.0;
      vec3 srcLin = u_inputLinear > 0.5 ? max(srcAcc, vec3(0.0)) : srgbToLinear(srcAcc);
      vec3 srcLab = linearToOklab(srcLin);
      /* The edge of the sky, drawn at full size. The selection is made on a small copy (about 320 pixels across), so any
         blur or widening of it lands somewhere near the skyline but not on it, which is what left a glowing line between
         sky and land and soft rims round clouds. Instead, each pixel looks at the 4 x 4 nearest pixels of the small copy and
         takes their yes/no sky answer weighted by how close they are and, above all, by how much their colour matches this
         pixel's own colour: a pixel on the sky side of the skyline matches the sky pixels next to it, one on the land side
         matches the land, so the edge follows the real outline at full resolution (joint bilateral upsampling). */
      vec2 mpos = v_texCoord * u_maskSize - 0.5;
      vec2 mbase = floor(mpos), mfr = mpos - mbase;
      float wsum = 0.0, msum = 0.0;
      for (int j = -1; j <= 2; j++) for (int i = -1; i <= 2; i++) {
        vec2 tcm = clamp((mbase + vec2(float(i), float(j)) + 0.5) / u_maskSize, 0.0, 1.0);
        vec3 gc = texture2D(u_skyCol, tcm).rgb;
        vec3 glab = vec3(gc.r, gc.g * 0.5 - 0.25, gc.b * 0.5 - 0.25);
        float mv = texture2D(u_skyMask, tcm).r;
        vec2 dxy = vec2(float(i), float(j)) - mfr;
        float wsp = exp(-dot(dxy, dxy) * 0.5);
        vec3 dc = srcLab - glab; dc.x *= 0.7;
        float wcol = exp(-dot(dc, dc) / (2.0 * 0.02 * 0.02));
        float wgt = wsp * (wcol + 0.002);
        wsum += wgt; msum += wgt * mv;
      }
      float mk = msum / max(wsum, 1e-6);
      // clouds and bright haze stay as they are: judged on the source's own lightness against the sky's, so edits earlier in
      // the chain (contrast, exposure) do not move the line between cloud and sky
      float skyLoc = texture2D(u_skyCol, v_texCoord).a;
      float cloud = smoothstep(skyLoc + 0.06, skyLoc + 0.22, srcLab.x);
      float ws = mk * (1.0 - cloud);
      float tS = u_skyDeep * ws;
      float L2 = Lq * (1.0 - 0.75 * tS);
      float dh = mod(266.0 - hq + 180.0, 360.0) - 180.0;
      float tH = clamp(tS * 1.7, 0.0, 1.0);   // the hue and the colour snap to navy quickly; the amount mostly sets how deep it goes
      float h2 = hq + dh * tH;
      float C2 = Cq + (0.095 * (0.55 + 0.45 * clamp(L2 / 0.25, 0.0, 1.0)) - Cq) * tH;
      float hh = (h2 < 180.0) ? h2 + 360.0 : h2;
      /* Foliage strength comes from the smoothed map, not from this pixel's own (noisy) colour, and colour is brought UP TO a
         crimson target rather than multiplied, so noise is pulled together instead of being amplified into speckle. */
      float wf = fm * (1.0 - smoothstep(0.70, 0.88, Lq));
      float tF = u_crimson * wf;
      float dh2 = mod(14.0 - hh + 180.0, 360.0) - 180.0;
      float h3 = radians(hh + dh2 * (0.88 * tF));
      float Ct = 0.17 * clamp(L2 / 0.45, 0.6, 1.25);
      float C3 = mix(C2, max(C2, Ct), tF);
      float L3 = L2 * (1.0 - 0.28 * tF);
      vec3 res = oklabToLinear(vec3(L3, C3 * cos(h3), C3 * sin(h3)));
      float pullE;
      srgb = linearToSrgb(gamutMapT(res, pullE));
      if (u_skyShow > 0.5) srgb = mix(srgb, vec3(1.0, 0.16, 0.35), 0.55 * mk);
    }

    // LUT last, as a film-style grade on top of everything else — and now
    // LIVE rather than baked in only at export time, so what's on screen is
    // what lands in the exported file.
    if (u_lutSize > 0.0 && u_lutMix > 0.0) {
      /* Found while checking the pipeline for the SAME shape of bug the hue
         and split-tone stages already had fixed: a real .cube LUT can
         legitimately map an in-range input to an out-of-range output \u2014
         common in film-emulation LUTs built for a wider working space \u2014
         and nothing here was catching that. It fell straight through to
         gl_FragColor, where the GPU's own hardware clamp is per-channel and
         naive, exactly the hue-distorting kind of clip every other stage in
         this pipeline was built to avoid. Confirmed by reading lutLookup()
         itself before assuming: its INPUT coordinate is clamped for correct
         sampling, its OUTPUT color is not. */
      vec3 lutted = mix(srgb, lutLookup(srgb), u_lutMix);
      float pull4;
      srgb = linearToSrgb(gamutMapT(srgbToLinear(lutted), pull4));
      pull2 = max(pull2, pull4);
    }

    if (u_maskN > 0.5) {
      if (u_maskProbe > 0.5) { gl_FragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0); return; }
      srgb = applyLocalAdjust(srgb);
      /* Show mask (build 154): the selected area keeps the picture, everything outside it drops to a dark grey. It used
         to paint the selection red at 60%, which disappears on exactly the photos this tool is for: an unswapped or
         Aerochrome-style infrared frame is already red, so the overlay was indistinguishable from the picture. A matte
         reads the same on any colour. */
      if (u_maskView > -0.5) { float Lm = dot(clamp(srgb, 0.0, 1.0), LUMW); srgb = mix(vec3(0.04 + 0.22 * Lm), srgb, g_maskShown); }
    }

    /* Clipping / gamut overlay ("blinkies").

       Drawn after everything else so it reports the pixel that will actually
       be written to the file. Three separate failure modes, three colours,
       because they need different fixes:

         red   - a channel is pinned at 1.0, or was driven past it and
                 brought back; either way that channel has no headroom left
         blue  - the pipeline drove a channel below 0.0, or the pixel is black
                 in all three channels. NOT simply \"some channel reads 0\":
                 a saturated yellow has B = 0 by definition and has lost
                 nothing, and testing the final value alone painted every
                 saturated colour in the frame as a crushed shadow
         amber - the gamut map had to pull chroma in to make this pixel fit,
                 so the colour on screen is less saturated than the maths
                 asked for. Nothing else in the tool can tell you this is
                 happening, and with matrices that deliberately go negative
                 it happens constantly.

       Diagonal hatching rather than solid fill, so the underlying image
       stays readable through the warning. */
    /* Selection preview. Width is set in abstract degrees, so without this
       you are guessing whether 30 degrees caught the foliage or also took
       the sky. Strength of the tint follows the band's own smoothstep
       weight, which makes the soft edge visible rather than implied — the
       part that matters, since a band that looks right in the middle can
       still be feathering across something you did not intend. Drawn before
       the clipping overlay so clipping still takes precedence. */
    if (u_bandPreview >= 0 && g_bandW > 0.001) {
      float stripe = step(0.5, fract((gl_FragCoord.x - gl_FragCoord.y) / 10.0));
      vec3 mark = mix(vec3(0.10, 0.85, 0.72), vec3(1.0), stripe * 0.35);
      srgb = mix(srgb, mark, g_bandW * 0.55);
    }

    if (u_clipView > 0.5) {
      float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 8.0));
      float mx = max(max(srgb.r, srgb.g), srgb.b);
      float pull = max(pull1, pull2);
      // 0.002 in linear light is about half a step at 8-bit near white, small
      // enough to catch real overflow and large enough to ignore rounding.
      bool blown  = (g_over > 0.002) || (mx >= 0.9980);
      // mx is the MAXIMUM channel, so this tests that every channel is on the
      // floor — a genuinely black pixel — rather than that any one of them is.
      bool crushed = (g_under > 0.002) || (mx <= 0.0039);
      if (blown)            srgb = mix(srgb, vec3(1.0, 0.1, 0.05), hatch * 0.85);
      else if (crushed)     srgb = mix(srgb, vec3(0.15, 0.45, 1.0), hatch * 0.85);
      else if (pull > 0.02) srgb = mix(srgb, vec3(1.0, 0.72, 0.1), hatch * min(1.0, pull * 3.0) * 0.8);
      /* CMYK soft proof. Ink on paper reaches nowhere near a backlit screen,
         and the colours it misses hardest are exactly the ones this tool
         produces: the vivid magentas and cyans of a channel swap sit well
         outside any press gamut, so a print comes back muddy and nothing on
         screen warned you.

         This is a WARNING, not a conversion. Converting properly needs the
         actual printer's ICC profile, and a naive formula conversion prints
         worse than sending RGB and letting the lab convert with the right
         one. So this marks what will not survive and leaves the file alone.

         The test is a coated-stock approximation: a colour is unreachable
         when it is both strongly saturated and bright, since ink gets dark
         as it gets saturated. Rough by nature — a real check needs the
         profile — but it catches the right regions, which is the point. */
      else if (u_cmykWarn > 0.5) {
        float mxc = max(max(srgb.r, srgb.g), srgb.b);
        float mnc = min(min(srgb.r, srgb.g), srgb.b);
        float sat = mxc > 0.001 ? (mxc - mnc) / mxc : 0.0;
        // saturated AND light is the combination ink cannot hold
        float over = max(0.0, sat - 0.55) * max(0.0, mxc - 0.45);
        if (over > 0.02) srgb = mix(srgb, vec3(0.1, 0.95, 0.6), hatch * min(1.0, over * 6.0) * 0.8);
      }
    }

    /* Shown only while a colour slider is being held (see gamutDragActive in
       the app code): the same amber hatching as Show clipping, but just the
       gamut-mapped part, so pushing Saturation, Vibrance or Hue shows where
       the map is pulling chroma in. Not drawn when Show clipping is already
       on, since that overlay includes it. */
    if (u_gamutDrag > 0.5 && u_clipView <= 0.5) {
      float hatchG = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 8.0));
      float pullG = max(pull1, pull2);
      if (pullG > 0.02) srgb = mix(srgb, vec3(1.0, 0.72, 0.1), hatchG * min(1.0, pullG * 3.0) * 0.8);
    }

    /* Triangular dither, one 8-bit step peak, for the 8-bit preview only.
       Smooth IR skies are the worst case for banding: a gradient that spans
       only a few dozen levels shows every step. Two interleaved-gradient
       noise samples make the triangular distribution. Channels already at
       0 or 255 are left exact, so the "at black / at white" readouts still
       mean what they say. */
    if (u_dither > 0.5) {
      vec2 fc = gl_FragCoord.xy;
      float dn1 = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
      float dn2 = fract(52.9829189 * fract(dot(fc + vec2(17.0, 31.0), vec2(0.06711056, 0.00583715))));
      vec3 dm = step(vec3(1.5 / 255.0), srgb) * step(srgb, vec3(1.0 - 1.5 / 255.0));
      srgb += dm * ((dn1 + dn2 - 1.0) / 255.0);
    }

    gl_FragColor = vec4(srgb, texColor.a);
  }
`;
