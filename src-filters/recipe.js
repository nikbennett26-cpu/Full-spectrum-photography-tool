/* ---------- "describe the look" recipe finder ----------
   Plain keyword matching against the recipe buttons above — not real NLP.
   Each recipe gets a short tag list (subject + colour words a person would
   actually type) plus a one-line reason, keyed by the same data-stack
   string the button already uses so clicking a suggestion reuses the exact
   same setSelection() path as clicking the button directly. */
const RECIPE_TAGS={
  'zwb3,tsn575':{label:'My UV stack',tags:['uv','ultraviolet'],why:'Clean UV pass with the IR leak blocked — general-purpose UV work, not a colour-of-foliage recipe.'},
  'grb1,lee139':{label:'Candy Chrome DIY',tags:['pink','magenta','candy','pastel','foliage','trees','leaves'],why:'Pastel pink/magenta foliage on a full-spectrum body.'},
  'grb3,lee729':{label:'IR Chrome DIY',tags:['pink','red','magenta','foliage','trees','leaves','blue','sky','aerochrome','classic'],why:'Classic Aerochrome-style pink/red foliage with blue sky.'},
  'w47':{label:'Faux colour (W47)',tags:['purple','violet','blue','faux'],why:'A single Wratten 47 for a general purple/blue faux-colour look.'},
  'kolarichrome':{label:'Kolari IR Chrome',tags:['pink','red','foliage','trees','leaves','blue','sky','aerochrome'],why:'Commercial Aerochrome-style pink foliage, blue sky.'},
  'w15':{label:'Aerochrome yellow',tags:['yellow','gold','foliage','trees','leaves'],why:'Yellow/gold foliage rather than pink.'},
  'zwb3':{label:'UV glass, no blocker',tags:['uv','ultraviolet','contaminated'],why:'UV glass on its own — mostly a demonstration of red/IR contamination without a blocker, not a colour recipe.'},
  'stockir,ha7':{label:'Why convert: stock IR-cut vs H-alpha',tags:['astro','astrophotography','nebula','hydrogen','comparison'],why:'Astro comparison of stock IR-cut glass against an H-alpha filter.'},
  'zwb3,qb21,stockir':{label:'Faux UV, unconverted body (UVP)',tags:['uv','ultraviolet','unconverted','faux uv'],why:'Best achievable UV look on an unconverted body — deep blue/violet only, not real UV.'},
  'lext':{label:'L-eXtreme (Ha + OIII)',tags:['astro','astrophotography','nebula','narrowband','hydrogen','oxygen'],why:'Narrowband astro filter for nebulae, not a daylight colour recipe.'},
  'kb20,bw061,c80c':{label:'Candy Pink stack',tags:['pink','candy','foliage','trees','leaves'],why:'Saturated candy-pink foliage.'},
  'grb3,lee035':{label:'Pink Aerochrome DIY',tags:['pale','yellow','gold','foliage','trees','leaves','aerochrome'],why:'DIY Aerochrome-style foliage. FIXED: was paired with GRB1 (=Schott KG2), but Lee 035\'s own note says it\'s meant for KG3 — GRB3 in this file\'s naming (Zeyuan Optics confirms GRB1=KG2, GRB3=KG3). Corrected pairing predicts pale yellow/gold at fairly low saturation (~0.26), not a confident pink — closer to a washed-out result than a strongly coloured one. A UV/IR forum contributor questioned the "pink" name on exactly these grounds, expecting more gray/white foliage; this model\'s own prediction leans the same direction, though it doesn\'t confidently resolve to neutral gray either.'},
  'db850,lee441':{label:'Blue Trees (Hidden Realms)',tags:['blue','cyan','foliage','trees','leaves','grass'],why:'Deep-blue dichroic base — after a red/blue channel swap, IR-reflective foliage renders blue.'},
  'db850,lee744':{label:'Blue Trees — Dirty White variant',tags:['blue','cyan','white','pale','foliage','trees','leaves','grass'],why:'Same blue-foliage principle, paler/whiter variant.'},
  'tsn575,c80a,notch532,nf550':{label:'Black foliage (notch stack)',tags:['black','dark','foliage','trees','leaves','red','cyan','blue'],why:'Green-notch stack that reads as near-black foliage against red and cyan/blue elsewhere.'}
};
// order-independent lookup so auto-discovered pairs/triples that happen to
// match a curated recipe (regardless of filter order) get skipped rather
// than shown as a near-duplicate
const RECIPE_KEY_SET=new Set(Object.keys(RECIPE_TAGS).map(k=>k.split(',').sort().join(',')));
function canonKey(ids){return ids.slice().sort().join(',');}
// Synonyms so "gold"→yellow, "trees"→foliage, etc. match without the user
// having to guess the exact tag word. Applied to BOTH query words and
// candidate tags, so each entry must map straight to the canonical form —
// chains don't resolve (a lone shadow→dark entry would never reach 'black',
// since lookup runs once, not recursively).
const LOOK_SYNONYMS={
  gold:'yellow',golden:'yellow',amber:'yellow',
  violet:'purple',lilac:'purple',
  magenta:'pink',fuchsia:'pink',rose:'pink',crimson:'red',scarlet:'red',
  trees:'foliage',tree:'foliage',leaves:'foliage',leaf:'foliage',grass:'foliage',
  plants:'foliage',plant:'foliage',greenery:'foliage',vegetation:'foliage',
  nebula:'astro',nebulae:'astro',stars:'astro',stargazing:'astro',
  dark:'black',shadow:'black',shadows:'black',shadowy:'black',silhouette:'black',
  teal:'cyan',turquoise:'cyan',aqua:'cyan',
  ir:'infrared',nir:'infrared',
  ultraviolet:'uv'
};
function normLookWord(w){return LOOK_SYNONYMS[w]||w;}

/* ---------- auto-derived tags, computed from the real transmission curves ----------
   RECIPE_TAGS above is hand-curated for the 15 named combos, which caps what
   "describe the look" can find at whatever I happened to write down. This
   block instead classifies EVERY single filter in FILTERS by actually
   sampling its own filterT() curve — same zone-splitting/dual-band/narrowband
   logic already used by describeStack() above — so a search can surface
   filters that were never manually tagged. Uses plain stackT (no sensor
   factor), since this classifies the filter's own optics, not a particular
   camera's rendering of it. Cached after first build; invalidated if the
   glass-thickness slider changes, since that can shift absorptive edges. */
let AUTO_CANDIDATES=null;
function zoneAnalysis(fs,step){
  step=step||1;
  const samples=[];let pk=0;
  for(let l=LMIN;l<=LMAX;l+=step){const t=stackT(l,fs);samples.push([l,t]);if(t>pk)pk=t;}
  const seg=(a,b)=>{let m=0;for(const [l,t] of samples)if(l>=a&&l<=b&&t>m)m=t;return m;};
  const uv=seg(LMIN,399),blue=seg(400,500),green=seg(500,570),red=seg(590,700),nir=seg(750,LMAX);
  const vis=Math.max(blue,green,red);
  let width=0,windows=0,inWin=false;
  for(const [,t] of samples){
    const on=t>=pk/2;
    if(on){width+=step;if(!inWin){windows++;inWin=true;}}else inWin=false;
  }
  return {pk,uv,blue,green,red,vis,nir,windows,narrow:pk>0.05&&width<=30};
}
// coarse fingerprint of a curve's shape, for spotting near-duplicate
// results (e.g. one UV glass paired with five interchangeable IR
// blockers) — buckets each zone into sixths of the peak, so two stacks
// with materially the same shape collapse to the same signature
function sigOf(z){
  const b=v=>Math.round(Math.min(1,v/(z.pk||1e-9))*6);
  return [b(z.uv),b(z.blue),b(z.green),b(z.red),b(z.nir)].join('-');
}
/* shared hue/character decision, used for both single filters and pairs so
   the two searches reason about a curve the same way */
function classifyZones(z){
  if(z.pk<0.03)return null;
  const tags=[];const why=[];
  const uvDominant=z.uv>z.pk*0.5&&z.nir<=z.pk*0.05&&z.vis<=z.uv*0.6;
  const irOnly=z.nir>z.pk*0.5&&z.vis<=z.pk*0.15&&z.uv<=z.pk*0.15;
  if(uvDominant){
    tags.push('uv');why.push('passes UV with the rest blocked');
  }else if(irOnly){
    tags.push('infrared','nir');why.push('passes near-infrared with visible light blocked — a Wood-effect look');
  }
  if(z.narrow&&z.windows>1){tags.push('astro');why.push('narrowband, multiple isolated lines — built for astro, not daylight colour');}
  return {tags,why};
}

/* ---------- predictive foliage model ----------
   The old approach compared peak transmission in blue/green/red bands and
   guessed a hue from whichever won. That's wrong in a specific way: it never
   asked what foliage actually REFLECTS. A leaf returns only a few percent of
   red light but well over half the near-infrared, so a big red passband
   doesn't make foliage red; barely any red comes back off the leaf. Peak
   transmission also ignores bandwidth entirely (a 5nm spike scored the same
   as a 100nm window).

   This instead predicts the actual pixel value:

     channel response = SUM over wavelength of
        filter(L) x canopyReflectance(L) x sensorChannelResponse(L,channel)

   ...for foliage and again for a neutral grey card, uses the grey card to
   derive white-balance gains (what a photographer sets off a grey card), and
   applies them to the foliage response. Out comes the predicted RGB.

   SOURCING (see individual notes below for detail):
     - vegetation reflectance: anchored to the standard remote-sensing
       signature as reviewed in Seager et al. 2005 (arXiv astro-ph/0503302),
       drawing on Clark et al. 1993 (USGS Digital Spectral Library) and
       Middleton & Sullivan 2000 (BOREAS TE-10, ORNL DAAC)
     - canopy vs single-leaf correction: Knipling 1970, via the same review
     - CFA response: representative CMOS Bayer shape, of the kind published in
       camera-sensitivity sets such as Jiang et al. 2013
     - silicon QE: generic envelope, the weakest-sourced element here

   VALIDATION: two cases have unambiguous ground truth, and both come out
   right from the same equations without special-casing — a normal camera's
   IR-cut filter predicts green foliage (hue 87 degrees), and an 850nm filter
   predicts near-neutral foliage roughly ten times brighter than normal, which
   is the Wood effect.

   REMAINING LIMITATIONS: assumes a flat illuminant rather than a real daylight
   spectrum; ignores CFA crosstalk and lens transmission; uses one generic
   silicon response rather than a measured body; and models a generic healthy
   broadleaf canopy, where real spectra vary substantially by species, water
   content and stress. Predicted hues are directional, not colorimetric, and
   the absolute hue shifts with your white-balance reference. */

/* Single-leaf reflectance for healthy green broadleaf foliage, piecewise-linear
   anchors. Shape and magnitudes are set against the standard remote-sensing
   vegetation signature as characterised in Seager et al. 2005 (arXiv
   astro-ph/0503302), which reviews the canonical measured spectra: Clark et al.
   1993, the USGS Digital Spectral Library (deciduous leaf), and Middleton &
   Sullivan 2000, BOREAS TE-10 leaf optical properties (aspen), via the ORNL
   DAAC. Anchored to three published constraints from that review:
     - chlorophyll absorption minima near 450nm and 670-680nm (chlorophyll a
       peaks ~430/662nm, chlorophyll b ~443/642nm), with the small green bump
       between them that makes leaves look green
     - the red edge is "a factor of five or more" rise around 700nm; this table
       gives R(750)/R(700) = 5.2
     - the NIR plateau is "greater than or approximately 50%" leaf reflectance;
       this table sits at 0.50-0.55
   TESTED AND REVERTED an alternative: CheeseCube312's Filter-Plotter-Data
   project (see the sensor table below) also includes four real measured
   single-leaf reflectance spectra. Swapping them in was tried directly, and
   it broke the model's one unambiguous ground-truth check — a normal camera's
   IR-cut filter stopped predicting green foliage (shifted to yellow, hue 66
   instead of ~82-87 degrees) — traced specifically to the real data's much
   shallower red-absorption dip around 650-680nm compared to this table\u2019s.
   Isolated testing confirmed the leaf data was the cause, not the sensor
   model swapped in alongside it (that one tested clean on its own). Real
   spectrometer data run through this simplified linear model apparently
   doesn't reproduce "photographs green" as reliably as this hand-anchored
   table does — plausibly because a real camera's colour pipeline (daylight
   illuminant, gamma, colour-matrix correction) does work this flat model
   doesn't attempt, work this table may have implicitly been shaped around
   even while citing real literature for its general shape. Kept as-is rather
   than ship a change that fails a validated physical check; the real leaf
   data remains available for a more careful future integration. Still a
   representative broadleaf, not a measured species: real spectra vary
   substantially with species, water content and stress (stress notably raises
   reflectance near 700nm). */
const LEAF_REFL=[[280,.025],[400,.04],[450,.045],[500,.075],[550,.15],[570,.14],
  [600,.09],[650,.05],[670,.035],[680,.04],[700,.10],[720,.35],[750,.52],
  [800,.55],[900,.55],[1000,.53],[1100,.50]];
/* CANOPY correction. The single-leaf spectrum above is what a spectrometer
   measures with one leaf in an integrating sphere — but a photographer never
   shoots one leaf, they shoot a tree or a hedge, and a canopy behaves
   measurably differently. Knipling 1970 (via Seager et al. 2005, arXiv
   astro-ph/0503302) found canopy reflectance falls to roughly 40% of the
   single-leaf value in the visible but only about 70% of it in the near-
   infrared, because NIR passes through upper leaves, reflects off lower ones
   and comes back up, while visible light is simply absorbed on first contact.
   This still applies here — the correction is about canopy vs single-leaf
   geometry, independent of which single-leaf spectrum feeds into it — now
   applied to the single-leaf estimate above, independent of which specific
   single-leaf spectrum feeds into it.
   This matters a lot here: it does not just darken foliage evenly, it raises
   the NIR-to-visible ratio by about 1.75x, which is precisely the contrast the
   whole false-colour effect depends on. Modelling a single leaf instead of a
   canopy understates every predicted colour shift. */
const CANOPY_VIS=0.40, CANOPY_NIR=0.70;
function canopyFactor(l){
  if(l<=680)return CANOPY_VIS;
  if(l>=750)return CANOPY_NIR;
  return CANOPY_VIS+(CANOPY_NIR-CANOPY_VIS)*(l-680)/70; // blend across the red edge
}
function interpCurve(tbl,l){
  if(l<=tbl[0][0])return tbl[0][1];
  if(l>=tbl[tbl.length-1][0])return tbl[tbl.length-1][1];
  for(let i=1;i<tbl.length;i++){
    if(l<=tbl[i][0]){
      const [x0,y0]=tbl[i-1],[x1,y1]=tbl[i];
      return y0+(y1-y0)*(l-x0)/(x1-x0);
    }
  }
  return 0;
}
function leafR(l){return interpCurve(LEAF_REFL,l)*canopyFactor(l);}
/* Combined sensor response per channel (silicon QE × Bayer CFA dye, together),
   REPLACED with real per-channel measured data — CheeseCube312's
   Filter-Plotter-Data project (MIT-licensed) includes a generic CMOS sensor's
   actual B/G/R response curve, 355-995nm at 5nm steps. This retires the
   previous two-stage synthesis (a literature-estimated overall QE curve from
   three papers, multiplied by a separately-estimated CFA dye shape) in favour
   of one real measured combined curve — simpler and no longer compounding two
   separate estimates' errors into each other. Checked against the old model
   before switching: mostly close in the 500-950nm range (usually within
   10-15 percentage points of each other, normalised to each curve's own
   peak), but two real discrepancies stood out — the old model badly
   undersold blue-channel response near 400nm (13% vs this real data's 61%,
   normalised), and still had some residual red-channel leak into the green
   peak around 550nm (22% vs 7% here) despite an earlier fix aimed at exactly
   that problem. The source data only covers 355-995nm; outside that this
   table tapers toward zero by 280nm and 1100nm, consistent with UV cover-
   glass absorption and the silicon bandgap cutoff respectively — those two
   tails remain extrapolation, not measurement, same caveat as before. */
const SENSOR_CH_TABLE={
  b:[[280,0],[355,0.0697],[370,0.1475],[385,0.2452],[400,0.3512],[415,0.4705],[430,0.545],[445,0.5695],[460,0.5614],[475,0.52],[490,0.4216],[505,0.3087],[520,0.1813],[535,0.1111],[550,0.0741],[565,0.0407],[580,0.0187],[595,0.01],[610,0.012],[625,0.0189],[640,0.0272],[655,0.0345],[670,0.0376],[685,0.0414],[700,0.0389],[715,0.0309],[730,0.0208],[745,0.0167],[760,0.0159],[780,0.0468],[800,0.1224],[825,0.1439],[850,0.1254],[875,0.1035],[900,0.0774],[925,0.0576],[950,0.041],[975,0.0245],[995,0.0184],[1050,0.008],[1100,0]],
  g:[[280,0],[355,0.0],[370,0.0185],[385,0.026],[400,0.0368],[415,0.0336],[430,0.0295],[445,0.0403],[460,0.1106],[475,0.2536],[490,0.4102],[505,0.5758],[520,0.6162],[535,0.6402],[550,0.6455],[565,0.6115],[580,0.5289],[595,0.3951],[610,0.2574],[625,0.1498],[640,0.1055],[655,0.0837],[670,0.0778],[685,0.092],[700,0.1232],[715,0.1439],[730,0.1471],[745,0.1431],[760,0.1432],[780,0.1481],[800,0.1482],[825,0.1465],[850,0.1243],[875,0.103],[900,0.0814],[925,0.0627],[950,0.0463],[975,0.032],[995,0.0261],[1050,0.011],[1100,0]],
  r:[[280,0],[355,0.0],[370,0.0163],[385,0.0318],[400,0.0458],[415,0.0445],[430,0.0345],[445,0.0218],[460,0.0151],[475,0.014],[490,0.0186],[505,0.0297],[520,0.0443],[535,0.0325],[550,0.0315],[565,0.1512],[580,0.2988],[595,0.4326],[610,0.4684],[625,0.4596],[640,0.4394],[655,0.4059],[670,0.3636],[685,0.3276],[700,0.2999],[715,0.28],[730,0.2655],[745,0.2534],[760,0.2386],[780,0.2099],[800,0.1754],[825,0.1491],[850,0.1236],[875,0.0938],[900,0.072],[925,0.0538],[950,0.0374],[975,0.0245],[995,0.0172],[1050,0.007],[1100,0]]
};
function channelQE(l,ch){return interpCurve(SENSOR_CH_TABLE[ch],l);}
/* Predict what a green leaf renders as through this stack, plus what a neutral
   grey card renders as (used for white balance). Returns null when so little
   light gets through that any hue claim would be noise.

   The leaf/CFA/QE weights don't depend on the filter stack, so they're
   precomputed once per sampling step and reused — without this, the pair and
   triple searches would redo six exponentials per wavelength per stack across
   tens of thousands of stacks. */
const FOLIAGE_W_CACHE={};
function foliageWeights(step){
  if(FOLIAGE_W_CACHE[step])return FOLIAGE_W_CACHE[step];
  const ls=[],wl={r:[],g:[],b:[]},wg={r:[],g:[],b:[]};
  for(let l=LMIN;l<=LMAX;l+=step){
    ls.push(l);
    const lr=leafR(l);
    for(const ch of ['r','g','b']){
      const s=channelQE(l,ch)*step;
      wl[ch].push(s*lr);
      wg[ch].push(s*0.18); // 18% neutral reference
    }
  }
  return FOLIAGE_W_CACHE[step]={ls,wl,wg};
}
function predictFoliage(fs,step){
  step=step||5;
  const {ls,wl,wg}=foliageWeights(step);
  let lr=0,lg=0,lb=0,gr=0,gg=0,gb=0;
  for(let i=0;i<ls.length;i++){
    const t=stackT(ls[i],fs);
    if(t<=0)continue;
    lr+=t*wl.r[i];lg+=t*wl.g[i];lb+=t*wl.b[i];
    gr+=t*wg.r[i];gg+=t*wg.g[i];gb+=t*wg.b[i];
  }
  const gMax=Math.max(gr,gg,gb);
  if(gMax<1e-6)return null; // effectively opaque
  // white balance: scale each channel so the grey card comes out neutral,
  // exactly as a photographer would when setting WB off a grey card. Gains are
  // clamped because a channel with almost nothing in it would otherwise be
  // amplified into dominating the result off pure numerical noise.
  const gain={r:Math.min(40,gMax/(gr||1e-9)),g:Math.min(40,gMax/(gg||1e-9)),b:Math.min(40,gMax/(gb||1e-9))};
  const rgb={r:lr*gain.r,g:lg*gain.g,b:lb*gain.b};
  const mx=Math.max(rgb.r,rgb.g,rgb.b),mn=Math.min(rgb.r,rgb.g,rgb.b);
  // lightness relative to an 18% grey card: 1.0 means foliage renders as
  // bright as the card, well under 1 means it goes dark
  const L=(rgb.r+rgb.g+rgb.b)/3/(gMax||1e-9);
  const sat=mx>0?(mx-mn)/mx:0;
  return {rgb,L,sat,hue:rgbHue(rgb)};
}
function rgbHue(c){
  const mx=Math.max(c.r,c.g,c.b),mn=Math.min(c.r,c.g,c.b),d=mx-mn;
  if(d<=0)return 0;
  let h;
  if(mx===c.r)h=((c.g-c.b)/d)%6;
  else if(mx===c.g)h=(c.b-c.r)/d+2;
  else h=(c.r-c.g)/d+4;
  h*=60;return (h+360)%360;
}
function hueNames(h,sat){
  if(sat<0.12)return ['neutral','grey'];
  if(h<15||h>=345)return ['red'];
  if(h<45)return ['orange'];
  if(h<70)return ['yellow','gold'];
  if(h<165)return ['green'];
  if(h<195)return ['cyan'];
  if(h<265)return ['blue'];
  if(h<295)return ['purple','violet'];
  return ['magenta','pink'];
}
/* Full classification of a stack: optical character (UV/IR/astro) from the
   raw curve, plus the predicted foliage colour both as-captured and after the
   red/blue channel swap most people apply. Both are tagged, because someone
   searching "blue foliage" means the FINAL image, which for most of these
   recipes is the swapped version. */
/* Reference point for "how dark is dark". Rather than hard-coding an absolute
   lightness threshold — which silently goes wrong the moment the reflectance
   or sensor model is revised — this measures what the SAME foliage does
   through a normal camera's IR-cut filter, and expresses everything relative
   to that. So "dark" means dark compared to an ordinary photograph of the same
   bush, which is what a photographer actually means. Computed lazily on first
   use and cached. */
let FOLIAGE_BASELINE=null;
function foliageBaseline(){
  if(FOLIAGE_BASELINE==null){
    const ref=FILTERS.find(f=>f.id==='stockir');
    const p=ref?predictFoliage([ref],2):null;
    FOLIAGE_BASELINE=(p&&p.L>0)?p.L:0.21;
  }
  return FOLIAGE_BASELINE;
}
function classifyStack(fs,step){
  step=step||5;
  const z=zoneAnalysis(fs,step);
  if(z.pk<0.03)return null;
  const base=classifyZones(z)||{tags:[],why:[]};
  const p=predictFoliage(fs,step);
  const tags=[...base.tags],why=[...base.why];
  let swatch=null,swatchSwapped=null,L=0;
  // Below 400nm the leaf-reflectance figures are the weakest part of this
  // model (UV leaf data is scarce and varies hugely by species and leaf
  // surface), so a UV-pass stack gets no colour claim at all rather than a
  // confident-sounding hue derived from the least trustworthy numbers.
  const uvOnly=base.tags.includes('uv');
  if(p&&!uvOnly){
    L=p.L;
    const swapped={r:p.rgb.b,g:p.rgb.g,b:p.rgb.r};
    const sHue=rgbHue(swapped),sMx=Math.max(swapped.r,swapped.g,swapped.b),
          sMn=Math.min(swapped.r,swapped.g,swapped.b);
    const sSat=sMx>0?(sMx-sMn)/sMx:0;
    const pct=(p.L*100).toFixed(0);
    const base=foliageBaseline();
    const rel=p.L/base;                       // 1.0 = as bright as a normal photo
    const relTxt=rel.toFixed(1)+'x a normal photo of the same foliage';
    if(rel>4&&p.sat<0.15){
      tags.push('white','bright','glow');
      why.push('foliage is predicted to render far brighter than normal and near-neutral ('+relTxt+
        ') — the Wood effect, where leaves glow white because they reflect most of the near-infrared');
    }else if(rel<0.55){
      tags.push('black','dark');
      why.push('foliage is predicted to render dark \u2014 '+relTxt);
    }else{
      const asShot=hueNames(p.hue,p.sat),afterSwap=hueNames(sHue,sSat);
      asShot.forEach(t=>{if(!tags.includes(t))tags.push(t);});
      afterSwap.forEach(t=>{if(!tags.includes(t))tags.push(t);});
      if(rel>2.5)tags.push('bright');
      why.push('predicted foliage: '+asShot[0]+' as shot, '+afterSwap[0]+
        ' with red and blue swapped, at '+relTxt);
    }
    if(!tags.includes('foliage'))tags.push('foliage');
    const mxc=Math.max(p.rgb.r,p.rgb.g,p.rgb.b)||1e-9;
    const to255=c=>Math.max(0,Math.min(255,Math.round(c/mxc*255*Math.min(1,Math.max(0.12,p.L*0.9)))));
    swatch='rgb('+to255(p.rgb.r)+','+to255(p.rgb.g)+','+to255(p.rgb.b)+')';
    swatchSwapped='rgb('+to255(p.rgb.b)+','+to255(p.rgb.g)+','+to255(p.rgb.r)+')';
  }
  if(!tags.length)return null;
  return {tags,why,swatch,swatchSwapped,foliageL:L,pk:z.pk,sig:sigOf(z),
    hue:p?p.hue:null,sat:p?p.sat:0,hueSw:p?rgbHue({r:p.rgb.b,g:p.rgb.g,b:p.rgb.r}):null};
}
/* Canonical hue angles for colour words, used to rank how convincingly a
   result actually IS the colour asked for — tag matching alone treats a
   barely-tinted stack the same as a saturated one, which is how a stock
   IR-cut filter ended up answering "blue foliage" (green as shot, faintly
   cyan once swapped, technically tagged blue). */
const COLOUR_HUE={red:0,orange:30,yellow:55,green:110,cyan:180,blue:225,purple:270,pink:315,magenta:315};
function hueDist(a,b){const d=Math.abs(a-b)%360;return d>180?360-d:d;}
/* 0..1 quality score for how well a candidate matches the requested look.
   Colour queries score on predicted hue proximity weighted by saturation;
   black/white queries score on predicted lightness instead. */
function lookQuality(r,words){
  let best=0,any=false;
  words.forEach(w=>{
    if(w==='black'){any=true;best=Math.max(best,r.foliageL!=null?Math.max(0,1-r.foliageL/0.45):0);}
    else if(w==='white'||w==='bright'||w==='glow'){any=true;best=Math.max(best,r.foliageL!=null?Math.min(1,r.foliageL/2.5):0);}
    else if(COLOUR_HUE[w]!=null&&r.hue!=null){
      any=true;
      const target=COLOUR_HUE[w];
      // a stack can be used either straight or with red/blue swapped, so credit
      // whichever orientation lands closer to what was asked for
      const d=Math.min(hueDist(r.hue,target),r.hueSw!=null?hueDist(r.hueSw,target):999);
      const prox=Math.max(0,1-d/90);            // full credit within ~0°, none past 90°
      best=Math.max(best,prox*(0.35+0.65*Math.min(1,(r.sat||0)/0.4)));
    }
  });
  return any?best:0.5; // no colour/tone word in the query — don't bias ranking
}
/* ---------- auto-derived tags, computed from the real transmission curves ----------
   RECIPE_TAGS above is hand-curated for the 15 named combos, which caps what
   "describe the look" can find at whatever I happened to write down. This
   block instead classifies EVERY single filter in FILTERS by running its real
   curve through the predictive foliage model above, so a search can surface
   filters that were never manually tagged. Cached after first build;
   invalidated if the glass-thickness slider changes, since that can shift
   absorptive edges. */
function buildAutoCandidates(){
  if(AUTO_CANDIDATES)return AUTO_CANDIDATES;
  AUTO_CANDIDATES=[];
  FILTERS.forEach(f=>{
    const c=classifyStack([f]);
    if(!c)return;
    AUTO_CANDIDATES.push({stack:f.id,label:f.n+' (predicted)',tags:c.tags,
      why:'From its own curve: '+c.why.join('; ')+'.',
      pk:c.pk,sig:c.sig,swatch:c.swatch,swatchSwapped:c.swatchSwapped,foliageL:c.foliageL,
      hue:c.hue,sat:c.sat,hueSw:c.hueSw});
  });
  return AUTO_CANDIDATES;
}
/* ---------- auto-derived PAIR candidates ----------
   Same idea, but for every two-filter combination — ~130 filters means
   ~8,400 pairs, too many to sample at 1nm resolution synchronously without
   janking the page. Two-stage funnel instead: a fast coarse pass (20nm
   steps) rejects pairs that clearly cancel each other out (a UV-pass glass
   stacked with an IR blocker that also happens to kill the UV, for
   instance — same "these cancel out" case already flagged elsewhere), then
   a finer pass (5nm) classifies only the survivors. Triples aren't
   attempted — the combinatorics (~370,000) aren't worth it for a
   synchronous in-browser search, and two filters already covers the
   overwhelming majority of real stacking practice in this database's own
   "Known recipes". Doesn't de-duplicate near-identical results (e.g. one
   UV glass paired with several IR blockers that behave almost the same) —
   worth knowing if a result list looks repetitive. */
let AUTO_PAIR_CANDIDATES=null;
function buildAutoPairCandidates(){
  if(AUTO_PAIR_CANDIDATES)return AUTO_PAIR_CANDIDATES;
  AUTO_PAIR_CANDIDATES=[];
  const n=FILTERS.length;
  const survivors=[];
  for(let i=0;i<n;i++){
    for(let j=i+1;j<n;j++){
      const z=zoneAnalysis([FILTERS[i],FILTERS[j]],20);
      if(z.pk>0.05)survivors.push([i,j]);
    }
  }
  survivors.forEach(([i,j])=>{
    const fi=FILTERS[i],fj=FILTERS[j];
    if(RECIPE_KEY_SET.has(canonKey([fi.id,fj.id])))return; // already a named recipe
    const c=classifyStack([fi,fj],10);
    if(!c)return;
    AUTO_PAIR_CANDIDATES.push({stack:fi.id+','+fj.id,label:fi.n+' + '+fj.n+' (predicted)',tags:c.tags,
      why:'From the combined stack: '+c.why.join('; ')+'.',
      pk:c.pk,sig:c.sig,swatch:c.swatch,swatchSwapped:c.swatchSwapped,foliageL:c.foliageL,
      hue:c.hue,sat:c.sat,hueSw:c.hueSw});
  });
  return AUTO_PAIR_CANDIDATES;
}
/* ---------- auto-derived TRIPLE candidates, via beam search ----------
   Full 3-filter search is ~370,000 combinations — too slow synchronously.
   Instead: take the highest-throughput pairs that already predict a usable
   foliage rendering, then try adding a third filter to each of those only.
   This is how the real "Black foliage" recipe was actually built by hand
   (start from a working pair, add one more piece) — the beam just automates
   that search instead of exploring the full cube of combinations blind. */
let AUTO_TRIPLE_CANDIDATES=null;
const TRIPLE_BEAM_SIZE=50;
function buildAutoTripleCandidates(){
  if(AUTO_TRIPLE_CANDIDATES)return AUTO_TRIPLE_CANDIDATES;
  AUTO_TRIPLE_CANDIDATES=[];
  const beam=buildAutoPairCandidates()
    .filter(p=>p.tags.includes('foliage'))
    .sort((a,b)=>b.pk-a.pk)
    .slice(0,TRIPLE_BEAM_SIZE)
    .map(p=>({ids:p.stack.split(','),fs:p.stack.split(',').map(id=>FILTERS.find(f=>f.id===id))}));
  const seen=new Set();
  beam.forEach(({ids,fs})=>{
    FILTERS.forEach(f3=>{
      if(ids.includes(f3.id))return;
      const key=canonKey([...ids,f3.id]);
      if(seen.has(key)||RECIPE_KEY_SET.has(key))return;
      const fs3=[...fs,f3];
      const zc=zoneAnalysis(fs3,20);
      if(zc.pk<0.05)return; // coarse cancel-out check first, cheap
      seen.add(key);
      const c=classifyStack(fs3,10);
      if(!c)return;
      AUTO_TRIPLE_CANDIDATES.push({stack:key,label:fs3.map(f=>f.n).join(' + ')+' (predicted)',tags:c.tags,
        why:'From the combined stack: '+c.why.join('; ')+'.',
        pk:c.pk,sig:c.sig,swatch:c.swatch,swatchSwapped:c.swatchSwapped,foliageL:c.foliageL,
        hue:c.hue,sat:c.sat,hueSw:c.hueSw});
    });
  });
  return AUTO_TRIPLE_CANDIDATES;
}

let RECIPE_Z_CACHE=null;
function curatedCandidates(){
  if(!RECIPE_Z_CACHE){
    RECIPE_Z_CACHE={};
    Object.keys(RECIPE_TAGS).forEach(stack=>{
      const fs=stack.split(',').map(id=>FILTERS.find(f=>f.id===id)).filter(Boolean);
      const c=classifyStack(fs);
      const z=zoneAnalysis(fs,2);
      RECIPE_Z_CACHE[stack]=c?{pk:c.pk,sig:c.sig,swatch:c.swatch,swatchSwapped:c.swatchSwapped,
                               foliageL:c.foliageL,hue:c.hue,sat:c.sat,hueSw:c.hueSw}
                             :{pk:z.pk,sig:sigOf(z),swatch:null,swatchSwapped:null,
                               foliageL:null,hue:null,sat:0,hueSw:null};
    });
  }
  return Object.entries(RECIPE_TAGS).map(([stack,r])=>Object.assign(
    {stack,label:r.label,tags:r.tags,why:r.why,curated:true},RECIPE_Z_CACHE[stack]));
}
function suggestLook(){
  const raw=($('lookQuery').value||'').toLowerCase().trim();
  const out=$('lookResults');
  if(!raw){out.innerHTML='<div class="note">Type a word or two first — try a colour and a subject, like "pink foliage" or "black shadows".</div>';return;}
  out.innerHTML='<div class="note">Searching single filters, two-filter, and three-filter combinations…</div>';
  // let the "searching" note actually paint before the heavier search
  // (only slow the first time — all candidate lists are cached after that)
  setTimeout(()=>{
    const words=raw.split(/[^a-z]+/).filter(Boolean).map(normLookWord);
    const candidates=[
      ...curatedCandidates(),
      ...buildAutoCandidates(),
      ...buildAutoPairCandidates(),
      ...buildAutoTripleCandidates()
    ];
    const scored=candidates.map(r=>{
      const tagSet=r.tags.map(normLookWord);
      const score=words.filter(w=>tagSet.includes(w)).length;
      return {stack:r.stack,r,score};
    }).filter(s=>s.score>0).sort((a,b)=>b.score-a.score); // stable sort: ties keep curated-first insertion order
    if(!scored.length){
      out.innerHTML='<div class="note">No close match anywhere in the database — try simpler colour/subject words (blue, pink, gold, black, foliage, sky, UV, astro).</div>';
      return;
    }
    const tied=scored.filter(s=>s.score===scored[0].score);
    // drop near-duplicate shapes (e.g. one UV glass paired with five
    // interchangeable IR blockers) — first occurrence wins, and curated
    // recipes were inserted first so they take priority over an auto find
    // with the same signature
    const seenSig=new Set();
    const deduped=tied.filter(s=>{
      if(seenSig.has(s.r.sig))return false;
      seenSig.add(s.r.sig);return true;
    });
    // curated recipes are hand-verified — a real person actually shot this
    // and it works. An auto-discovered combo is just a curve that computes
    // the right shape; it might genuinely be untested or impractical (an
    // odd mount, a filter nobody stocks). So curated matches show first,
    // THEN the rest — but ordered by how convincingly the model predicts the
    // colour that was actually asked for, with throughput only as a
    // tie-breaker. Ranking auto results on throughput alone let a stock
    // IR-cut filter answer "blue foliage" purely because it passes lots of
    // light and happened to carry a faint blue tag.
    deduped.forEach(s=>{s.q=lookQuality(s.r,words);});
    deduped.sort((a,b)=>{
      if(a.r.curated!==b.r.curated)return a.r.curated?-1:1;
      if(Math.abs(b.q-a.q)>0.04)return b.q-a.q;
      return b.r.pk-a.r.pk;
    });
    // cap curated at 3 rather than letting it fill all 6 slots — the whole
    // point of the auto search is to surface combinations that were never
    // written up as a recipe, so it needs actual room to show
    const curatedTop=deduped.filter(s=>s.r.curated).slice(0,3);
    const autoTop=deduped.filter(s=>!s.r.curated).slice(0,6-curatedTop.length);
    const top=[...curatedTop,...autoTop];
    out.innerHTML='';
    top.forEach(({stack,r})=>{
      const div=document.createElement('div');
      div.style.cssText='margin-bottom:8px;padding:8px 10px;border:1px solid var(--line2);border-radius:3px';
      let sw='';
      if(r.swatch){
        const chip=(c,lbl)=>'<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px">'+
          '<span style="width:15px;height:15px;border-radius:2px;border:1px solid var(--line2);background:'+c+';display:inline-block"></span>'+
          '<span style="font-size:10.5px;color:var(--muted)">'+lbl+'</span></span>';
        sw='<div style="margin:5px 0 3px">'+chip(r.swatch,'as shot')+chip(r.swatchSwapped,'R↔B swapped')+'</div>';
      }
      div.innerHTML='<button class="rec" style="margin:0 0 4px 0">'+r.label+'</button>'+sw+
        '<div class="note" style="margin-top:2px">'+r.why+' Peak throughput '+(r.pk*100).toFixed(0)+'%.</div>';
      div.querySelector('button').addEventListener('click',()=>setSelection(stack.split(',')));
      out.appendChild(div);
    });
  },10);
}
$('lookSuggest').addEventListener('click',suggestLook);
$('lookQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();suggestLook();}});
