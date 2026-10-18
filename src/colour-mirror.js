'use strict';
/* srgbToLinearF and linearToSrgbF live in engine.js: presets call them while the page is still loading. */
/* irlab editor: js/colour-mirror.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

// ---------- JS mirror of the shader's colour math ----------
// Needed because building an export .cube LUT means running every possible
// input colour through the SAME pipeline the shader applies live — and a
// .cube file is baked on the CPU, not the GPU, so this has to exist twice.
// Operates on 0..1 floats throughout, matching the shader exactly, rather
// than round-tripping through 0..255 integers.
function compressChanF(v){
  const threshold=0.96, softness=0.04; // matches the shader; see compressChan's comment
  if(v<0)return 0;
  if(v<=threshold)return v;
  return threshold+softness*Math.tanh((v-threshold)/softness);
}
const LUMW_R=0.2126, LUMW_G=0.7152, LUMW_B=0.0722;
// JS mirrors of the shader's gamut map and OKLab hue/saturation. These must
// track the GLSL versions line for line — a .cube baked from a different
// colour model than the one on screen is worse than no .cube at all.
function gamutMixToAnchorF(r,g,b,anchor){
  // exact mirror of the shader's gamutMixToAnchor — same split, same reason:
  // an externally-chosen anchor, not one this function derives for itself
  const mn=Math.min(r,g,b), mx=Math.max(r,g,b);
  let t=1;
  if(mn<0) t=Math.min(t, anchor/Math.max(anchor-mn,1e-6));
  if(mx>1) t=Math.min(t, (1-anchor)/Math.max(mx-anchor,1e-6));
  t=t<0?0:t>1?1:t;
  r=anchor+(r-anchor)*t; g=anchor+(g-anchor)*t; b=anchor+(b-anchor)*t;
  r=r<0?0:r>1?1:r; g=g<0?0:g>1?1:g; b=b<0?0:b>1?1:b;
  // ratio-scaled, not per-channel independent — see the shader's
  // compressGamut comment: scaling every channel by the same ratio keeps
  // hue drift at exactly zero instead of the measurable drift per-channel
  // compression produced on exactly this anchor-shifted output shape
  const mx2=Math.max(r,g,b);
  if(mx2<=0) return[r,g,b];
  const ratio=compressChanF(mx2)/mx2;
  return[r*ratio,g*ratio,b*ratio];
}
function gamutMapF(r,g,b,satPreserve){
  // exact mirror of the shader's gamutMapT, including the satPreserve blend
  // between "stay bright, desaturate" and "stay saturated, darken"
  const mn0=Math.min(r,g,b), mx0=Math.max(r,g,b);
  if(mn0>=0&&mx0<=1){
    const m=Math.max(r,g,b);
    if(m<=0) return[r,g,b];
    const rt=compressChanF(m)/m;
    return[r*rt,g*rt,b*rt];
  }
  let lum=LUMW_R*r+LUMW_G*g+LUMW_B*b;
  lum=lum<0?0:lum>1?1:lum;
  const mn=Math.min(r,g,b), mx=Math.max(r,g,b);
  // retuned constants — see the shader's matching comment for why: two
  // independent gamut-map passes (post-swap, post-hue) were compounding
  // into more desaturation than either intended
  const overshoot=Math.max(Math.max(mx-1,-mn),0);
  const shift=Math.min(0.55, overshoot*1.1);
  const anchor=lum+(0.5-lum)*shift;
  const desat=gamutMixToAnchorF(r,g,b,anchor);
  const sp=satPreserve||0;
  if(sp<=0) return desat;
  let sr=r,sg=g,sb=b;
  if(mx>1){sr=r/mx;sg=g/mx;sb=b/mx;}
  const smn=Math.min(sr,sg,sb);
  if(smn<0){sr=(sr-smn)/(1-smn);sg=(sg-smn)/(1-smn);sb=(sb-smn)/(1-smn);}
  sr=sr<0?0:sr>1?1:sr;sg=sg<0?0:sg>1?1:sg;sb=sb<0?0:sb>1?1:sb;
  const smx=Math.max(sr,sg,sb);
  if(smx>0){const rt=compressChanF(smx)/smx;sr*=rt;sg*=rt;sb*=rt;}
  return[desat[0]+(sr-desat[0])*sp, desat[1]+(sg-desat[1])*sp, desat[2]+(sb-desat[2])*sp];
}
function cbrtF(v){return v<0?-Math.pow(-v,1/3):Math.pow(v,1/3);}
function linearToOklabF(r,g,b){
  const l=cbrtF(0.4122214708*r+0.5363325363*g+0.0514459929*b);
  const m=cbrtF(0.2119034982*r+0.6806995451*g+0.1073969566*b);
  const s=cbrtF(0.0883024619*r+0.2817188376*g+0.6299787005*b);
  return[
    0.2104542553*l+0.7936177850*m-0.0040720468*s,
    1.9779984951*l-2.4285922050*m+0.4505937099*s,
    0.0259040371*l+0.7827717662*m-0.8086757660*s];
}
function oklabToLinearF(L,A,B){
  const l0=L+0.3963377774*A+0.2158037573*B;
  const m0=L-0.1055613458*A-0.0638541728*B;
  const s0=L-0.0894841775*A-1.2914855480*B;
  const l=l0*l0*l0, m=m0*m0*m0, s=s0*s0*s0;
  return[
     4.0767416621*l-3.3077115913*m+0.2309699292*s,
    -1.2684380046*l+2.6097574011*m-0.3413193965*s,
    -0.0041960863*l-0.7034186147*m+1.7076147010*s];
}
/* Mirrors maxSaturation / hueCusp / maxChromaAt from the shader. Kept
   line-for-line equivalent so a .cube baked here matches the preview. */
function maxSaturationF(a,b){
  let k0,k1,k2,k3,k4,wl,wm,ws;
  if(-1.88170328*a-0.80936493*b>1){
    k0=1.19086277;k1=1.76576728;k2=0.59662641;k3=0.75515197;k4=0.56771245;
    wl=4.0767416621;wm=-3.3077115913;ws=0.2309699292;
  }else if(1.81444104*a-1.19445276*b>1){
    k0=0.73956515;k1=-0.45954404;k2=0.08285427;k3=0.12541070;k4=0.14503204;
    wl=-1.2684380046;wm=2.6097574011;ws=-0.3413193965;
  }else{
    k0=1.35733652;k1=-0.00915799;k2=-1.15130210;k3=-0.50559606;k4=0.00692167;
    wl=-0.0041960863;wm=-0.7034186147;ws=1.7076147010;
  }
  let S=k0+k1*a+k2*b+k3*a*a+k4*a*b;
  const kl=0.3963377774*a+0.2158037573*b,
        km=-0.1055613458*a-0.0638541728*b,
        ks=-0.0894841775*a-1.2914855480*b;
  const l_=1+S*kl,m_=1+S*km,s_=1+S*ks;
  const l=l_*l_*l_,m=m_*m_*m_,sv=s_*s_*s_;
  const ld=3*kl*l_*l_,md=3*km*m_*m_,sd=3*ks*s_*s_;
  const ld2=6*kl*kl*l_,md2=6*km*km*m_,sd2=6*ks*ks*s_;
  const f=wl*l+wm*m+ws*sv, f1=wl*ld+wm*md+ws*sd, f2=wl*ld2+wm*md2+ws*sd2;
  return S-f*f1/(f1*f1-0.5*f*f2);
}
function hueCuspF(a,b){
  const S=maxSaturationF(a,b);
  const[r,g,bl]=oklabToLinearF(1,S*a,S*b);
  const Lc=Math.pow(1/Math.max(r,g,bl,1e-6),1/3);
  return[Lc,Lc*S];
}
function maxChromaAtF(L,cx,cy){
  return L<=cx ? cy*L/Math.max(cx,1e-6) : cy*(1-L)/Math.max(1-cx,1e-6);
}
function hueDegOfF(a,b){const d=Math.atan2(b,a)*180/Math.PI;return d<0?d+360:d;}
function angDeltaF(a,b){let d=(a-b+180)%360;if(d<0)d+=360;return d-180;}
/* Mirrors targetedHSL from the shader — see its comment for the design.
   Kept line-for-line equivalent so a baked .cube matches the live preview. */
function targetedHSLF(r,g,b,bands,keepSat){
  if(!bands||!bands.length) return [r,g,b];
  let [L,A,B]=linearToOklabF(r,g,b);
  let C=Math.hypot(A,B), H=hueDegOfF(A,B);
  const H0=H;   // bands match the ORIGINAL hue — see the shader comment
  const C0=C;
  const L0raw=L;   // lightness before any band touched it
  const n=Math.min(5,bands.length);
  for(let i=0;i<n;i++){
    const band=bands[i];
    const delta=angDeltaF(H0,band.hue);
    const t=Math.max(0,Math.min(1,1-Math.abs(delta)/Math.max(band.width,1e-3)));
    const _cw=Math.max(0,Math.min(1,(C0-0.010)/0.040));
    let w=t*t*(3-2*t)*(_cw*_cw*(3-2*_cw));   // chroma-weighted — see shader
    if(band.pc!==undefined&&band.pc<0.06){   // build 163: near-grey pick, by colour distance (shader, without its neighbour smoothing)
      const sig=0.006+0.012*Math.max(0.2,Math.min(3,band.width/30));
      const da=A-band.pa, db=B-band.pb, wAB=Math.exp(-(da*da+db*db)/(sig*sig));
      const k=Math.max(0,Math.min(1,(band.pc-0.02)/0.04)), s=k*k*(3-2*k);
      w=wAB+(w-wAB)*s;
    }
    if(w<=0) continue;
    H+=band.dH*w;
    C=Math.max(0,C*(1+band.dS*w));
    // build 162: exposure-style, line for line with the shader (see its comment)
    const fL=Math.pow(2,band.dL*2*w/3);
    let Le=L*fL; if(Le>0.9) Le=0.9+0.1*(1-Math.exp(-(Le-0.9)/0.1));
    C*=L>1e-5?Le/L:fL; L=Le;
  }
  /* Shared ceiling across ALL bands combined, not per band. Each band's dS
     used to be tuned in isolation, trusting that whatever else might overlap
     it in hue space wouldn't compound into something unexpected \u2014 which
     is exactly what happened: three bands added over separate sessions
     (foliage x2, one car-paint fix) turned out to overlap across roughly
     307-367\u00b0, and their dS terms multiplied together into a 1.5-1.77x
     chroma boost that clipped highlights and flattened texture on a dense,
     already-saturated foliage photo (see chat notes on the Aerochrome
     recipe's bands). MAX_CHROMA_MULT is a single, visible number instead of
     N band authors each hoping their dS coexists with bands they may not
     even know exist. 1.6 was picked to sit above what any ONE currently
     tuned band asks for alone (max dS 0.4) while well below what three of
     them compounded to before this existed \u2014 a starting point, not a
     measured optimum; tighten or loosen it if a specific photo still clips
     or looks under-saturated relative to before this cap. */
  if(C0>1e-5) C=Math.min(C, C0*MAX_CHROMA_MULT);
  /* Same net-effect cusp solve as the shader — see its comment. Mirrored so
     a baked .cube matches the live preview. satPreserve is passed in rather
     than read from the DOM so this stays a pure function. */
  const moved=Math.abs(angDeltaF(H,H0))>0.001;
  const boosted=C>C0+1e-6;
  if(keepSat>0 && C>1e-5 && (moved||boosted)){
    const c0=hueCuspF(Math.cos(H0*Math.PI/180),Math.sin(H0*Math.PI/180));
    const c1=hueCuspF(Math.cos(H*Math.PI/180),Math.sin(H*Math.PI/180));
    {   // shortcut removed — see shader
      const _dB=c0[1];   // cusp-relative — see hueSat
      const relRaw=C/Math.max(_dB,1e-6);
      const rel=relRaw<0.85?relRaw:0.85+0.15*Math.tanh((relRaw-0.85)/0.15);
      const want=Math.min(Math.max(C,rel*c1[1]),c1[1]);
      const _t=Math.max(0,Math.min(1,(C0-0.010)/0.040));
      const kEff=keepSat*(_t*_t*(3-2*_t));   // see hueSat
      if(want>maxChromaAtF(L,c1[0],c1[1])){
        const need=(L<=c1[0])
          ? want*c1[0]/Math.max(c1[1],1e-6)
          : 1-want*(1-c1[0])/Math.max(c1[1],1e-6);
        L=L+(Math.min(Math.max(0,Math.min(1,need)),L)-L)*kEff;   // darken only — see shader
      }
      C=Math.min(C+(want-C)*kEff, maxChromaAtF(L,c1[0],c1[1]));
    }
  }
  const rad=H*Math.PI/180;
  let out=oklabToLinearF(L,C*Math.cos(rad),C*Math.sin(rad));
  const lightGain = L0raw>1e-4 ? L/L0raw : 1;
  const sMaxB=Math.max(r,g,b)*Math.max(lightGain,1), oMaxB=Math.max(...out);
  const kB=keepSat||0;   // the scale only fires when output exceeded source peak
  if(oMaxB>sMaxB && sMaxB>0){const f=sMaxB/oMaxB; out=out.map(v=>v+(v*f-v)*kB);}
  return out;
}
/* Hellwig & Fairchild (2022) colour appearance model -- forward transform
   only (J, M, h), ported from colour-science's reference implementation
   (BSD-3-Clause) and verified against its own published worked example
   before being used here: XYZ=[19.01,20.00,21.78], XYZ_w=[95.05,100,108.88],
   L_A=318.31, Y_b=20 produces J=41.7312079, C=0.0257636, h=217.0679598,
   M=0.0339890 -- matches the reference to 6-7 significant figures, and a
   forward-then-inverse round trip (not used here, but checked) recovers
   the exact original XYZ.

   Deliberately excludes the Helmholtz-Kohlrausch effect extension --
   colour-science's own GitHub tracker (issue #1047) documents that specific
   extension as producing incorrect results even in the reference library,
   and it was partially reverted there. Building on an admittedly-buggy
   piece would compound risk on risk; this uses only the well-established
   core the extension sits on top of.

   Used here as a single input: M (colourfulness) replaces OKLab chroma
   specifically as the "how saturated is this pixel already" measurement
   that Vibrance uses to decide how much to boost a given pixel (see
   hueSatF below). It does NOT replace the actual chroma boost or the
   gamut-cusp "Keep saturation" trade, both of which stay in OKLab -- OKLab
   has an analytic, closed-form gamut boundary this app already relies on
   throughout; Hellwig has no equivalent without a much larger, separate
   undertaking. This is a scoped, single-purpose swap, not a wholesale
   replacement of the colour pipeline.

   Also scoped to the JS/CPU render path (pipelineRGB, used for .cube
   export and as the reference implementation) -- the live WebGL preview's
   GLSL shader still uses OKLab chroma for this same weight, unchanged. */
const MATRIX_16_HELLWIG = [
  [0.401288, 0.650173, -0.051461],
  [-0.250268, 1.204414, 0.045854],
  [-0.002079, 0.048952, 0.953127],
];
function matVec3(m, v) {
  return [
    m[0][0]*v[0]+m[0][1]*v[1]+m[0][2]*v[2],
    m[1][0]*v[0]+m[1][1]*v[1]+m[1][2]*v[2],
    m[2][0]*v[0]+m[2][1]*v[1]+m[2][2]*v[2],
  ];
}
function XYZ_to_HellwigM(XYZ, XYZ_w, L_A, Y_b) {
  const sgn = x => x < 0 ? -1 : (x > 0 ? 1 : 0);
  const Y_w = XYZ_w[1];
  const RGB_w = matVec3(MATRIX_16_HELLWIG, XYZ_w);
  const D = Math.min(1, Math.max(0, 1 * (1 - (1/3.6) * Math.exp((-L_A - 42) / 92))));
  const k = 1 / (5*L_A + 1), k4 = k*k*k*k;
  const F_L = 0.2*k4*(5*L_A) + 0.1*Math.pow(1-k4, 2)*Math.pow(5*L_A, 1/3);
  const n = Y_b / Y_w;
  const D_RGB = RGB_w.map(r => D * Y_w / r + 1 - D);
  const RGB = matVec3(MATRIX_16_HELLWIG, XYZ);
  const RGB_c = RGB.map((r,i) => D_RGB[i] * r);
  const compress = RGB => RGB.map(c => {
    const F_L_RGB = Math.pow(F_L * Math.abs(c) / 100, 0.42);
    return (400 * sgn(c) * F_L_RGB) / (27.13 + F_L_RGB) + 0.1;
  });
  const RGB_a = compress(RGB_c);
  const [R,G,B] = RGB_a;
  const a = R - 12*G/11 + B/11;
  const b = (R + G - 2*B) / 9;
  let h = Math.atan2(b,a) * 180/Math.PI;
  h = ((h % 360) + 360) % 360;
  const hr = h * Math.PI/180;
  const e_t = -0.0582*Math.cos(hr) - 0.0258*Math.cos(2*hr) - 0.1347*Math.cos(3*hr) + 0.0289*Math.cos(4*hr)
       - 0.1475*Math.sin(hr) - 0.0308*Math.sin(2*hr) + 0.0385*Math.sin(3*hr) + 0.0096*Math.sin(4*hr) + 1;
  return 43 * 1 * e_t * Math.hypot(a, b);
}
function linearSRGBtoXYZ100(r, g, b) {
  return [
    (0.4124564*r + 0.3575761*g + 0.1804375*b) * 100,
    (0.2126729*r + 0.7151522*g + 0.0721750*b) * 100,
    (0.0193339*r + 0.1191920*g + 0.9503041*b) * 100,
  ];
}
const HELLWIG_D65 = [95.047, 100.000, 108.883];
const HELLWIG_L_A = 64/Math.PI * 0.2;   // colour-science's own sRGB reference default
const HELLWIG_Y_B = 20;
const HELLWIG_M_MAX = 63.05;   // measured max M across the sRGB gamut boundary, plus headroom
const HELLWIG_LUT_N = 17;   // Phil: at least 17x17x17 -- 4913 grid points, still a one-time build cost of a few thousand forward transforms at load, not a per-pixel cost
const HELLWIG_VW_LUT = (() => {
  const lut = new Float32Array(HELLWIG_LUT_N ** 3);
  for (let ri = 0; ri < HELLWIG_LUT_N; ri++) for (let gi = 0; gi < HELLWIG_LUT_N; gi++) for (let bi = 0; bi < HELLWIG_LUT_N; bi++) {
    const r = ri/(HELLWIG_LUT_N-1), g = gi/(HELLWIG_LUT_N-1), b = bi/(HELLWIG_LUT_N-1);
    const M = XYZ_to_HellwigM(linearSRGBtoXYZ100(r,g,b), HELLWIG_D65, HELLWIG_L_A, HELLWIG_Y_B);
    lut[(ri*HELLWIG_LUT_N + gi)*HELLWIG_LUT_N + bi] = Math.max(0, Math.min(1, 1 - M/HELLWIG_M_MAX));
  }
  return lut;
})();
function sampleHellwigVW(r, g, b) {
  const N = HELLWIG_LUT_N;
  r = Math.max(0, Math.min(1, r)); g = Math.max(0, Math.min(1, g)); b = Math.max(0, Math.min(1, b));
  const fr = r*(N-1), fg = g*(N-1), fb = b*(N-1);
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(r0+1, N-1), g1 = Math.min(g0+1, N-1), b1 = Math.min(b0+1, N-1);
  const tr = fr-r0, tg = fg-g0, tb = fb-b0;
  const at = (ri,gi,bi) => HELLWIG_VW_LUT[(ri*N+gi)*N+bi];
  const c000=at(r0,g0,b0), c100=at(r1,g0,b0), c010=at(r0,g1,b0), c110=at(r1,g1,b0);
  const c001=at(r0,g0,b1), c101=at(r1,g0,b1), c011=at(r0,g1,b1), c111=at(r1,g1,b1);
  const c00=c000*(1-tr)+c100*tr, c10=c010*(1-tr)+c110*tr;
  const c01=c001*(1-tr)+c101*tr, c11=c011*(1-tr)+c111*tr;
  const c0=c00*(1-tg)+c10*tg, c1=c01*(1-tg)+c11*tg;
  return c0*(1-tb)+c1*tb;
}
function hueSatF(r,g,b,hueFrac,sat,keepSat,vibrance=0){
  const[L0,A,B]=linearToOklabF(r,g,b);
  const C0=Math.hypot(A,B);
  // vW now driven by Hellwig2022's M (via a precomputed LUT, not a per-pixel
  // 15-step transform -- see the block above), replacing OKLab's own C0 as
  // the "how saturated is this pixel already" measurement Pizzamancer's
  // point was specifically about. The boost mechanism itself (rotating in
  // OKLab, the gamut-cusp trade below) is unchanged.
  const vW=sampleHellwigVW(r,g,b);
  const effSat=sat*(1+vibrance*vW);
  const C=C0*effSat;
  const H0=Math.atan2(B,A);
  const H=H0+hueFrac*2*Math.PI;
  // see the shader comment: a pure saturation boost must reach the cusp path too
  if(!(keepSat>0)||(hueFrac===0&&effSat<=1)||C<=1e-5)
    return oklabToLinearF(L0,C*Math.cos(H),C*Math.sin(H));
  const c0=hueCuspF(Math.cos(H0),Math.sin(H0));
  const c1=hueCuspF(Math.cos(H),Math.sin(H));
  // rotations only — a boost past the boundary is the case we want; see shader
  // see shader: the shortcut only holds where the boundary is near the hue best
  // boundary shortcut removed — see shader
  // relative to what this LIGHTNESS can hold, not the hue's cusp — see shader
  const _d0=c0[1];   // cusp-relative — see shader
  const relRaw=C/Math.max(_d0,1e-6);   // soft knee — see shader
  const rel=relRaw<0.85?relRaw:0.85+0.15*Math.tanh((relRaw-0.85)/0.15);
  // floor at C — this recovers lost chroma, it never cuts it
  const want=Math.min(Math.max(C,rel*c1[1]), c1[1]);
  const _t=Math.max(0,Math.min(1,(Math.hypot(A,B)-0.010)/0.040));
  const kEff=keepSat*(_t*_t*(3-2*_t));   // chroma-weighted — see shader
  let L=L0;
  if(want>maxChromaAtF(L,c1[0],c1[1])){
    const need=(L<=c1[0])
      ? want*c1[0]/Math.max(c1[1],1e-6)
      : 1-want*(1-c1[0])/Math.max(c1[1],1e-6);
    L=L+(Math.min(Math.max(0,Math.min(1,need)),L)-L)*kEff;   // darken only — see shader
  }
  const Cf=Math.min(C+(want-C)*kEff, maxChromaAtF(L,c1[0],c1[1]));
  let out=oklabToLinearF(L,Cf*Math.cos(H),Cf*Math.sin(H));
  // hold the peak channel where the source had it — see shader
  const sMax=Math.max(r,g,b), oMax=Math.max(...out);
  if(oMax>sMax && sMax>0){const f=sMax/oMax; out=out.map(v=>v+(v*f-v)*kEff);}
  return out;
}
// One pixel through the full live pipeline (matrix/WB/exposure/gamut/hue/sat/
// black point), then the currently-loaded LUT if any — matches what's on
// screen right now, in 0..1 floats in and out.
function sCurveF(x,strength,pivot){
  x=Math.max(0,Math.min(1,x));
  const p=Math.max(0.05,Math.min(0.95, pivot===undefined?0.5:pivot));
  if(x<p) return p*Math.pow(x/p,strength);
  return 1-(1-p)*Math.pow((1-x)/(1-p),strength);
}
function applyContrastF(r,g,b,strength,pivot){
  const lum=0.2126*r+0.7152*g+0.0722*b;
  if(lum<=0.00001)return[r,g,b];
  const e=linearToSrgbF(Math.min(1,lum));
  const pe=Math.min(0.95,Math.max(0.05,linearToSrgbF(Math.min(0.95,Math.max(0.05,pivot)))));
  const newLum=srgbToLinearF(sCurveF(e,strength,pe));
  const scale=newLum/lum;
  return[r*scale,g*scale,b*scale];
}
/* Exact mirror of the shader's hsvRotate — same linear-light working space,
   same wrap behaviour, same neutral guard. */
function hsvRotateF(r,g,b,turns){
  if(turns===0) return [r,g,b];
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  if(d<1e-7||mx<=0) return [r,g,b];
  let h;
  if(mx===r)      h=((g-b)/d)%6;
  else if(mx===g) h=(b-r)/d+2;
  else            h=(r-g)/d+4;
  h=(((h/6+turns)%1)+1)%1*6;
  const S=d/mx, V=mx, cc=V*S;
  const x=cc*(1-Math.abs((h%2)-1)), m=V-cc;
  let o;
  if(h<1)      o=[cc,x,0];
  else if(h<2) o=[x,cc,0];
  else if(h<3) o=[0,cc,x];
  else if(h<4) o=[0,x,cc];
  else if(h<5) o=[x,0,cc];
  else         o=[cc,0,x];
  return [o[0]+m,o[1]+m,o[2]+m];
}
function pipelineRGB(r,g,b,matrix,pre,post,exposure,hueFrac,satFactor,blackPt,lutMix,tt,ct,satPreserve,bands,preM,postM,wbMethod,hueSpaceMode,lumOn,filmEnabled,vibrance=0,camCoefArr=null,swapSpaceMode='2',mO=null){
  /* Camera-colour match, mirrored from the shader and in the same place:
     first, on encoded values, before anything else. See the shader comment
     on why it cannot go at the end. */
  if (camCoefArr) {
    const f = camFeats(Math.max(0,Math.min(1,r)), Math.max(0,Math.min(1,g)), Math.max(0,Math.min(1,b)));
    let nr = 0, ng = 0, nb = 0;
    for (let p = 0; p < 20; p++) { nr += f[p]*camCoefArr[p*3]; ng += f[p]*camCoefArr[p*3+1]; nb += f[p]*camCoefArr[p*3+2]; }
    r = Math.max(0, Math.min(1, nr)); g = Math.max(0, Math.min(1, ng)); b = Math.max(0, Math.min(1, nb));
  }
  /* The built-in film LUT, mirrored from the shader so a baked .cube carries
     it. Applied to the ENCODED values before the linear conversion, matching
     the shader exactly — a .cube is authored against display-referred input,
     so feeding it linear would look up every entry at the wrong coordinate. */
  if (filmEnabled) {
    const fl = decodeFilmLUT();
    if (fl) { const o = sampleLUT(fl, r, g, b); r = o[0]; g = o[1]; b = o[2]; }
  }
  let lr=srgbToLinearF(r),lg=srgbToLinearF(g),lb=srgbToLinearF(b);
  [lr,lg,lb]=targetedHSLF(lr,lg,lb,bands,satPreserve);   // SOOC colour only — before pre-WB, before the swap
  // WB is a pure colour transform with no spatial term, unlike the vignette
  // — so unlike that one, it belongs in the baked LUT, and both methods are
  // mirrored here so a saved .cube matches whichever one was live
  if (wbMethod === 'bradford') { [lr,lg,lb] = bfMat3vec(preM, [lr,lg,lb]); }
  else { lr*=pre[0];lg*=pre[1];lb*=pre[2]; }
  const yPreSwap = 0.2126*lr + 0.7152*lg + 0.0722*lb;   // see preserveLuma in the shader
  const[a,b1,c,d,e,f,g1,h,i]=matrix;
  const mo = mO || [0,0,0];   // the matrix offsets, in the swap space, as the shader adds them
  /* Working space for the channel swap, mirroring the shader's own
     u_swapSpace branch exactly -- same three matrix pairs, same default
     (ProPhoto, '2'). This function bakes .cube LUTs and runs the export
     pipeline, so it has to match the live preview's choice or a saved
     LUT would not reproduce what was actually seen on screen. Brought
     back as a parameter alongside the shader change that reintroduced
     the choice in the UI; see u_swapSpace's own comment in the shader
     for the full reasoning. */
  let xr, xg, xb, mr, mg, mb;
  if (swapSpaceMode === '1' || swapSpaceMode === 1) {
    const rr = 0.627404*lr + 0.329283*lg + 0.043313*lb;
    const rg = 0.069097*lr + 0.919541*lg + 0.011362*lb;
    const rb = 0.016391*lr + 0.088013*lg + 0.895595*lb;
    xr = a*rr+b1*rg+c*rb+mo[0]; xg = d*rr+e*rg+f*rb+mo[1]; xb = g1*rr+h*rg+i*rb+mo[2];
    mr = 1.660491*xr - 0.587641*xg - 0.072850*xb;
    mg = -0.124551*xr + 1.132898*xg - 0.008348*xb;
    mb = -0.018151*xr - 0.100579*xg + 1.118729*xb;
  } else if (swapSpaceMode === '0' || swapSpaceMode === 0) {
    xr = a*lr+b1*lg+c*lb+mo[0]; xg = d*lr+e*lg+f*lb+mo[1]; xb = g1*lr+h*lg+i*lb+mo[2];
    mr = xr; mg = xg; mb = xb;
  } else if (swapSpaceMode === '3' || swapSpaceMode === 3) {
    const sb = swapBlend(($('swapWiden') ? +$('swapWiden').value : 100) / 100), T = sb.T, Ti = sb.Ti;
    const rr = T[0]*lr + T[3]*lg + T[6]*lb;
    const rg = T[1]*lr + T[4]*lg + T[7]*lb;
    const rb = T[2]*lr + T[5]*lg + T[8]*lb;
    xr = a*rr+b1*rg+c*rb+mo[0]; xg = d*rr+e*rg+f*rb+mo[1]; xb = g1*rr+h*rg+i*rb+mo[2];
    mr = Ti[0]*xr + Ti[3]*xg + Ti[6]*xb;
    mg = Ti[1]*xr + Ti[4]*xg + Ti[7]*xb;
    mb = Ti[2]*xr + Ti[5]*xg + Ti[8]*xb;
  } else if (swapSpaceMode === '4' || swapSpaceMode === 4) {
    const enc = v => { v = Math.max(0, v); return v <= 0.0031308 ? v*12.92 : 1.055*Math.pow(v, 1/2.4) - 0.055; };
    const er = enc(lr), eg = enc(lg), eb = enc(lb);
    const cl = v => Math.min(1, Math.max(0, v));
    const xr4 = cl(a*er+b1*eg+c*eb+mo[0]), xg4 = cl(d*er+e*eg+f*eb+mo[1]), xb4 = cl(g1*er+h*eg+i*eb+mo[2]);
    const dec = v => v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    xr = xr4; xg = xg4; xb = xb4; mr = dec(xr4); mg = dec(xg4); mb = dec(xb4);
  } else {
    const rr = 0.529377*lr + 0.330109*lg + 0.140557*lb;
    const rg = 0.098376*lr + 0.873450*lg + 0.028163*lb;
    const rb = 0.016879*lr + 0.117656*lg + 0.865257*lb;
    xr = a*rr+b1*rg+c*rb+mo[0]; xg = d*rr+e*rg+f*rb+mo[1]; xb = g1*rr+h*rg+i*rb+mo[2];
    mr = 2.033966*xr - 0.727392*xg - 0.306733*xb;
    mg = -0.228808*xr + 1.231754*xg - 0.002924*xb;
    mb = -0.008564*xr - 0.153302*xg + 1.162106*xb;
  }
  if (lumOn) {
    const yAfter = 0.2126*mr + 0.7152*mg + 0.0722*mb;
    if (yAfter > 1e-5 && yPreSwap > 1e-5) {
      const gain = yPreSwap / yAfter;
      if (gain <= 1) { mr*=gain; mg*=gain; mb*=gain; }
      else {
        const mx = Math.max(mr,mg,mb);
        if (mx > 1e-5) {
          const maxGain = 1/mx;
          if (maxGain > 1) {
            const r0 = gain/maxGain, k = 0.85;
            const x = Math.min((r0-k)/(1-k), 12);
            const sk = r0 < k ? r0 : k + (1-k)*((Math.exp(x)-Math.exp(-x))/(Math.exp(x)+Math.exp(-x)));
            const gg = maxGain*sk; mr*=gg; mg*=gg; mb*=gg;
          }
        }
      }
    }
  }
  if (wbMethod === 'bradford') { [mr,mg,mb] = bfMat3vec(postM, [mr,mg,mb]); }
  else { mr*=post[0];mg*=post[1];mb*=post[2]; }
  const T = tt || [1,1,1];   // temperature/tint, matching the shader's separate stage
  mr*=T[0];mg*=T[1];mb*=T[2];
  mr*=exposure;mg*=exposure;mb*=exposure;
  [mr,mg,mb]=applyContrastF(mr,mg,mb,contrastStrength(ct),contrastPivot);
  [mr,mg,mb]=gamutMapF(mr,mg,mb,satPreserve);
  let sr=linearToSrgbF(mr),sg=linearToSrgbF(mg),sb=linearToSrgbF(mb);
  if(blackPt>0){
    const bp=blackPt/255;
    // soft toe, mirroring the shader — see its comment
    const K=Math.min(2*bp,0.999), sK=(K-bp)/(1-bp);
    const _toe=v=>{const o = v>=K ? (v-bp)/(1-bp) : sK*Math.pow(v/K,2); return Math.max(0,Math.min(1,o));};
    sr=_toe(sr); sg=_toe(sg); sb=_toe(sb);
  }
  if(hueFrac!==0||satFactor!==1||vibrance!==0){
    let lr2=srgbToLinearF(sr), lg2=srgbToLinearF(sg), lb2=srgbToLinearF(sb);
    // mirrors the shader: channel mode rotates in HSV first, then runs the
    // OKLab stage with no rotation of its own
    if(hueSpaceMode==='channel'){
      [lr2,lg2,lb2]=hsvRotateF(lr2,lg2,lb2,hueFrac);
      [lr2,lg2,lb2]=hueSatF(lr2,lg2,lb2,0,satFactor,satPreserve,vibrance);
    } else {
      [lr2,lg2,lb2]=hueSatF(lr2,lg2,lb2,hueFrac,satFactor,satPreserve,vibrance);
    }
    [lr2,lg2,lb2]=gamutMapF(lr2,lg2,lb2,satPreserve);
    sr=linearToSrgbF(lr2);sg=linearToSrgbF(lg2);sb=linearToSrgbF(lb2);
  }
  if(currentLUT&&lutMix>0){
    const out=sampleLUT(currentLUT,sr,sg,sb);
    if(lutMix>=1){sr=out[0];sg=out[1];sb=out[2];}
    else{sr=sr+(out[0]-sr)*lutMix;sg=sg+(out[1]-sg)*lutMix;sb=sb+(out[2]-sb)*lutMix;}
    // same gap as the shader had, same fix — see its comment. A LUT can
    // legitimately push an in-range pixel out of range on its own.
    let[lr4,lg4,lb4]=gamutMapF(srgbToLinearF(sr),srgbToLinearF(sg),srgbToLinearF(sb),satPreserve);
    sr=linearToSrgbF(lr4);sg=linearToSrgbF(lg4);sb=linearToSrgbF(lb4);
  }
  return[sr,sg,sb];
}
function buildCubeLUT(size){
  size=size||32;
  const matrix=getMatrixUI(),exposure=Math.pow(2,(+$('bright').value||0));
  /* isFinite, not ||, for every one of these. || treats 0 as falsy, so a
     genuine 0 was silently discarded and replaced with the fallback default
     — Saturation 0 baked a LUT at 100 (full colour), Saturation 1 landed at
     1/100 (near black and white), and LUT intensity 0 would have baked at
     full strength instead of off. The live preview and image export were
     never affected; both already used this same isFinite check. Only the
     .cube export had the bug, which is why it looked fine on screen and
     wrong only in the saved file. */
  const fin = (v, d) => isFinite(v) ? v : d;
  const hueFrac=fin(+$('hue').value,0)/360, satFactor=fin(+$('sat').value,100)/100;
  const blackPt=fin(lightVal('blackPt'),0);
  const lutMix=fin(+($('lutMix')&&$('lutMix').value),100)/100;
  const satPreserve=fin(+($('satPreserve')&&$('satPreserve').value),0)/100;
  const vibrance=fin(+($('vibrance')&&$('vibrance').value),0)/100;
  const tt=tempTintGains();
  const ct=contrastUI();
  const look=(document.querySelector('.pb.on b')||{}).textContent||'Custom';
  const lookName=look.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'')||'Custom';
  const out=[];
  out.push('# Generated by Infrared Colour Swap — @irlab.uk');
  out.push('# Look: '+lookName);
  out.push('TITLE "ChannelSwap_'+lookName+'"');
  out.push('LUT_3D_SIZE '+size);
  out.push('DOMAIN_MIN 0.0 0.0 0.0');
  out.push('DOMAIN_MAX 1.0 1.0 1.0');
  const N=size-1;
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const o=pipelineRGB(x/N,y/N,z/N,matrix,preWB,postWB,exposure,hueFrac,satFactor,blackPt,lutMix,tt,ct,satPreserve,targetedBands,preWBM,postWBM,wbMethod,hueSpace,lumPreserve,filmOn ? 1 : 0,vibrance,(camCoef && $('camMatch') && $('camMatch').checked) ? camCoef : null,($('swapSpace') && $('swapSpace').value) || '2',getMatrixOffsetUI());   // the same scaled offsets the live preview sends to the shader
    out.push(o[0].toFixed(6)+' '+o[1].toFixed(6)+' '+o[2].toFixed(6));
  }
  return{text:out.join('\n')+'\n',name:'ChannelSwap_'+lookName+'.cube'};
}
