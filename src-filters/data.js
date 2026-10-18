/* ---------- angle of incidence ----------
   Tilting a filter does two completely different things depending on how the
   filter works, so this must never be applied blindly to everything:

   - INTERFERENCE (dichroic) filters pass light by thin-film optical path
     length. Tilting shortens that path, so the whole curve blue-shifts:
        lambda(theta) = lambda0 * sqrt(1 - sin^2(theta) / n_eff^2)
     ~1.6% at 20 degrees, ~8% at 45 - enough to move a 720nm edge by 60nm.

   - ABSORPTIVE glass and gels do NOT shift at all. The dye's absorption bands
     are fixed by chemistry. Tilting only lengthens the path through the glass,
     raising optical density by 1/cos(theta), which deepens the curve slightly
     without moving it.

   - UNTYPED filters get NOTHING. 149 of the 237 entries have no type field,
     and guessing would mean inventing physics for most of the database. The
     UI reports how many filters in the current stack were actually modelled
     rather than quietly pretending all of them were.

   n_eff is rarely published and varies roughly 1.45-2.0 by coating; 1.7 is a
   middle-of-the-road assumption, so treat the shift as indicative, not exact.
   Real filters also broaden and lose peak transmission off-axis, which this
   does not model. */
let aoiDeg = 0;
const AOI_N_EFF = 1.7;

function aoiStats(fs){
  let shifted=0,deepened=0,untyped=0;
  fs.forEach(f=>{
    if(f.type==='interference')shifted++;
    else if(f.type==='absorptive')deepened++;
    else untyped++;
  });
  return {shifted,deepened,untyped,total:fs.length};
}

/* Base (on-axis) transmission. filterT() below applies the angle on top. */
function filterT(l,f){
  if(aoiDeg>0){
    if(f.type==='interference'){
      const th=aoiDeg*Math.PI/180;
      const k=Math.sqrt(1-Math.pow(Math.sin(th),2)/(AOI_N_EFF*AOI_N_EFF));
      // a feature at lambda0 now sits at lambda0*k, so sample the base curve at l/k
      return filterTBase(l/k,f);
    }
    if(f.type==='absorptive'){
      const t=filterTBase(l,f);
      if(t<=0)return 0;
      return Math.pow(t,1/Math.cos(aoiDeg*Math.PI/180));
    }
  }
  return filterTBase(l,f);
}

function filterTBase(l,f){
  /* REAL_CURVES holds actual measured data (CheeseCube312's Filter-Plotter-Data
     project, MIT-licensed -- github.com/CheeseCube312/Filter-Plotter-Data),
     resampled onto a 10nm grid, for every filter this file previously only
     had a hand-fit sigmoid APPROXIMATION of. Where a filter's id is in this
     table, use the real data directly instead of the old bands-based fit --
     strictly more accurate, since bands was always an approximation of this
     same underlying reality, fit by eye/least-squares with disclosed error
     margins (see each filter's "same" note for its own fit's RMS error).
     bands stays in place as the fallback for every filter NOT in this table,
     and as a documented record of what the approximation used to be for the
     ones that are.
     One thing worth knowing about the real data itself, not the fit: several
     Lee gels' curves go perfectly flat at exactly 90.0% starting at exactly
     805nm, identically, regardless of the gel's actual colour -- already
     suspected as a likely blanket extrapolation rather than per-gel
     measurement (see e.g. lee139's "same" note). Embedding the real data
     confirms that flat tail is genuinely IN CheeseCube's published dataset,
     not an artifact this file's own fitting process introduced -- it's a
     property of the source, carried through faithfully rather than
     silently smoothed over. */
  if (REAL_CURVES[f.id] != null) {
    let t = realCurveT(REAL_CURVES[f.id], l);
    if(f.notch)f.notch.forEach(n=>{
      t*=1-n.d*Math.exp(-Math.pow(l-n.c,2)/(2*n.w*n.w));
    });
    if(f.dens&&f.dens!==1&&f.type!=='interference'){
      const Pd=f.ar?P_AR:P_UNCOATED;
      t=Math.pow(Math.min(1,t/Pd),f.dens)*Pd;
    }
    if(f.type==='interference'||thicknessScale===1)return t;
    const P=f.ar?P_AR:P_UNCOATED;
    const internal=Math.min(1,t/P);
    const scaled=Math.pow(internal,thicknessScale);
    return scaled*P;
  }
  let t=f.bands.reduce((m,b)=>Math.max(m,bandT(l,b)),0);
  if(f.notch)f.notch.forEach(n=>{
    t*=1-n.d*Math.exp(-Math.pow(l-n.c,2)/(2*n.w*n.w));
  });
  // Per-filter dye-density correction (Beer-Lambert on the bulk). Currently
  // UNUSED: it was introduced to reconcile chart-fitted curves with published
  // filter factors, then removed from every filter once real measured spectra
  // showed the filter-factor targets were the less reliable of the two. Kept
  // because the mechanism is sound if a future entry genuinely needs it. That matters: a dye stays transparent in
  // the near-IR no matter how concentrated it is, so a flat multiply would
  // wrongly dim the IR leak too. Beer-Lambert keeps transparent regions
  // transparent and deepens only where the dye actually absorbs.
  if(f.dens&&f.dens!==1&&f.type!=='interference'){
    const Pd=f.ar?P_AR:P_UNCOATED;
    t=Math.pow(Math.min(1,t/Pd),f.dens)*Pd;
  }
  // interference coatings: no bulk absorption, so no thickness scaling
  if(f.type==='interference'||thicknessScale===1)return t;
  const P=f.ar?P_AR:P_UNCOATED;
  const internal=Math.min(1,t/P);          // strip the surface loss out
  const scaled=Math.pow(internal,thicknessScale); // Beer-Lambert on the bulk
  return scaled*P;                          // put the surface loss back
}
const stackT=(l,fs)=>fs.reduce((p,f)=>p*filterT(l,f),1);

const FILTERS=[
 // ---- UV-pass (all the ZWB/Schott absorptive glasses leak deep IR) ----
 {id:'zwb1',g:'B1',n:'ZWB1 (≈UG11)',d:'90% UV peak · IR leak much smaller than ZWB3',c:'#8f7ad6',leak:true,
  same:'REAL DATA \u2014 exact digitised curve. JMC Scientific Consulting Ltd (2021) published clearer charts than '
   +'the one this entry was previously fitted to, including a 2mm/77mm-diameter ZWB1 trace matching this '
   +'entry\u2019s existing reference thickness. Digitised programmatically this time (calibrated pixel-to-data '
   +'mapping from the chart\u2019s own gridlines, then tracing the curve\u2019s actual colour) rather than read by eye, '
   +'so this replaces a fit with genuine per-point data \u2014 peak ~82% around 310-320nm, closing to near-zero by '
   +'390-660nm, a real NIR bump peaking ~11.4% at 710nm (matching the old fit\u2019s own estimate of "11-12% near '
   +'720nm" closely), settling back near zero from 800nm on. UG1/UG11 LABEL: this entry is "\u2248UG11" following '
   +'the correction already made \u2014 see the earlier note history for that reasoning; this update only replaced '
   +'the curve\u2019s precision, not its identity.'},
 {id:'zwb2',g:'B2',n:'ZWB2 (≈UG1)',d:'81% UV peak, real Tangsinuo chart · IR bump ~28% at 740nm',c:'#7a6ad0',
  bands:[{lo:313,ls:9,hi:383,hs:8,T:.81},{lo:712,ls:6,hi:850,hs:100,T:.30}],leak:true,
  same:'fitted directly to Tangsinuo\u2019s own product chart for this exact glass at 2.0mm (their Amazon/product listing), so this is first-party manufacturer data, not a third party. UV band max error 2.0 percentage points. The NIR side is a broader, longer-tailed bump than ZWB3\u2019s \u2014 peaks ~28% around 740nm then declines gradually out past 1000nm rather than the dip-and-recover shape ZWB3 shows. UG1/UG11 LABEL CORRECTED: previously shown as "\u2248UG11" \u2014 see zwb1\u2019s note for the source and reasoning; this entry\u2019s own transmission curve is unchanged, only the UG-number name attached to it'},
 {id:'zwb3',g:'B1',n:'ZWB3',d:'89% UV peak · true-zero trough to ~650nm · IR bump ~730nm',c:'#9b8ae0',leak:true,
  same:'REAL DATA \u2014 exact digitised curve, same clearer JMC Scientific Consulting Ltd (2021) source and same '
   +'programmatic digitisation as ZWB1 above, using the 2mm/77mm-diameter ZWB3 trace to match this entry\u2019s '
   +'existing reference thickness. Peak ~89% around 300-320nm, sharp close to near-zero by 400-640nm, a real '
   +'NIR bump peaking ~77% around 730nm (higher and slightly further out than the previous fit\u2019s ~66% at '
   +'715-720nm), settling to a broad ~33-40% plateau from 850-1100nm rather than closing further \u2014 this glass '
   +'does not fully block deep NIR the way its visible-light block might suggest.'},
 {id:'qb29',g:'B2',n:'QB29',d:'Tangsinuo · = Schott BG25 · 83% UV/violet peak · small NIR leak past 1000nm',c:'#8e7cd8',leak:true,
  same:'REAL DATA \u2014 exact digitised curve from Tangsinuo\u2019s own QB29 chart. '
   +'CORRECTION: this entry previously credited the glass to \u201cTianjin Sinuo\u201d and treated that as a '
   +'separate reseller from Tangsinuo. No such company could be found \u2014 the supplier is Shijiazhuang '
   +'Tangsinuo Optoelectronic Technology, in Hebei, not Tianjin. The name was wrong and so was the '
   +'second-source claim built on it; only the curve itself was ever properly sourced. '
   +'CheeseCube312\u2019s Filter-Plotter-Data project has '
   +'it digitised directly. Three real-ish sources exist for this glass and they genuinely disagree in the NIR '
   +'leak region \u2014 this entry\u2019s old fit, Tangsinuo\u2019s own chart, and genuine Schott\u2019s official BG25 datasheet '
   +'(PDF) all give different leak heights by 900-1000nm, roughly a factor of 2-3 apart at the extremes. Given '
   +'QB29 is a Chinese-market glass designation rather than a Schott one, Tangsinuo\u2019s own chart is the '
   +'most directly relevant of the three, so this entry now uses that exact curve rather than either the old '
   +'approximate fit or genuine Schott\u2019s data \u2014 but the spread between all three is real and worth knowing if '
   +'this filter\u2019s exact NIR behaviour matters for your use.'},
 {id:'baader',g:'B2',n:'Baader U',d:'Dielectric · CWL 350nm · no IR leak',c:'#b9a6f0',type:'interference',
  bands:[{lo:322,ls:5,hi:388,hs:5,T:.80}],
  same:'20-layer dielectric stack blocking 200\u20131500nm outside the passband \u2014 unlike absorptive UV glass, no deep-IR leak by design'},
 {id:'andreau',g:'B2',n:'Andrea-U',d:'Dielectric · Baader U rival · violet leak',c:'#a693e0',type:'interference',
  bands:[{lo:315,ls:6,hi:410,hs:8,T:.67}],
  same:'sold against the Baader Venus U-filter; measured with a touch more leakage into violet/blue and no IR leak to 850nm, at roughly 1/4 stop less throughput'},
 {id:'baaderuvir',g:'B4',n:'Baader UV/IR-Cut',d:'Dielectric \u00b7 passes visible, blocks UV+NIR \u00b7 real chart',c:'#8fbfa0',type:'interference',
  same:'REAL DATA \u2014 exact digitised curve, from Baader\u2019s own official product chart ("UV/IR Sperrfilter"), '
   +'traced with calibrated pixel-to-data mapping. Replaces an earlier version built only from commonly-cited '
   +'public specs, never checked against an actual chart \u2014 that placeholder turned out reasonably close on '
   +'the edges (specified 420-680nm range vs this chart\u2019s own ~420-680nm plateau) but invented a flat, fully '
   +'closed NIR block that doesn\u2019t match reality: the real chart shows a genuine NIR leak starting to rise '
   +'right around 1100-1150nm, peaking near 80% around 1140nm, dipping to ~42% near 1160nm, then rising again '
   +'toward 75% by 1200nm \u2014 a real double-hump structure, not a clean cutoff. That leak\u2019s peak and dip both '
   +'sit just past this tool\u2019s 1100nm ceiling, but its onset is real and visible right at the edge: still '
   +'under 1% at 1100nm, already ~12% by 1120nm, over 50% by 1130nm. Datasheet also states: 2mm reference '
   +'thickness, dielectric AR coating, transmission range stated as 420-680nm.'},
 {id:'ubessel',g:'B2',n:'Chroma U-Bessel',d:'Astro photometric · narrow, no IR leak',c:'#9c88de',type:'interference',
  bands:[{lo:300,ls:6,hi:400,hs:6,T:.60}],
  same:'Chroma\u2019s official spec for the Classic Johnson/Cousins Bessell "U" photometric filter: ~300-400nm passband '
   +'(~100nm wide), 3.0mm substrate, peak transmission >50% \u2014 widened from an earlier narrower estimate (335-385nm) '
   +'to match. Chroma state each filter ships with its own measured production-lot curve rather than one fixed published '
   +'graph, and per AAVSO commentary this "Bessell" shape is flat-topped and not a strict rendition of the true '
   +'Johnson-Cousins passband \u2014 treat this as the published spec, not a digitised measurement, and flag if photometric '
   +'precision matters. Source: chroma.com/products/parts/classic-u-bessell'},
 {id:'hyu330',g:'B1',n:'Hoya U-330',d:'Broad UV-A · very strong IR leak',c:'#7d6cc9',type:'absorptive',
  bands:[{lo:248.1,ls:6.49,hi:388.1,hs:6.95,T:.867},{lo:687.4,ls:8.67,hi:763.9,hs:12.2,T:.521},{lo:771.3,ls:21.33,T:.32}],leak:true,
  same:'least-squares fit to Hoya Candeo Optronics\u2019 official U-330 datasheet, external transmittance at 2.50mm \u2014 '
   +'RMS 1.1 percentage points across 19 published points, 240-1000nm. CORRECTED: U-330\u2019s NIR leak is far larger than '
   +'previously modelled \u2014 the datasheet shows it peaking at ~50% around 720nm and still sitting at ~32% by 1000nm, not '
   +'a flat ~85% cut-on-at-770 assumption. This filter needs a genuinely strong IR blocker paired with it; on its own it '
   +'is closer to an IR-pass filter with a UV side-channel than a clean UV bandpass. Source: '
   +'hoyacandeo.co.jp/english/products/eo_pdf/U330.pdf. REAL DATA added \u2014 digitised (by eye, 10nm grid) from a '
   +'multi-filter U330/U340/U360/UL254S/UL365S/U340A transmittance chart supplied by Nik; supersedes the band-fit above '
   +'as the active curve, kept here for its documented RMS error.'},
 {id:'hyu340',g:'B2',n:'Hoya U-340',d:'Astro/forensic standard · leaks IR',c:'#8878d0',type:'absorptive',
  bands:[{lo:283.1,ls:6.88,hi:370.2,hs:5.48,T:.75},{lo:696.2,ls:3.35,hi:740.5,hs:5.09,T:.022}],leak:true,
  same:'least-squares fit to Hoya Candeo Optronics\u2019 official U-340 datasheet, external transmittance at 2.50mm (the '
   +'classic grade, not the weather-resistant U340A which leaks more) \u2014 RMS 1.3 percentage points across 18 points. '
   +'IR leak is small and narrow, peaking ~2.2% around 710-720nm \u2014 much cleaner than U-330. Source: '
   +'uqgoptics.com/wp-content/uploads/2019/08/Hoya-U340.pdf. REAL DATA added \u2014 digitised (by eye, 10nm grid) from '
   +'the same multi-filter chart as hyu330; supersedes the band-fit above.'},
 {id:'hyu360',g:'B2',n:'Hoya U-360',d:'70% @360nm, 10% IR leak @740',c:'#9384d8',type:'absorptive',
  bands:[{lo:338,ls:4,hi:382,hs:4,T:.72},{lo:770,ls:15,T:.85}],leak:true,
  same:'measured (Savazzi): 70% transmission near 360nm, ~10% infrared leak at 740nm — the reference point these curves are fitted to. REAL DATA added \u2014 digitised (by eye, 10nm grid) from the same multi-filter chart as hyu330; supersedes the band-fit above.'},
 {id:'tsn340',g:'B2',n:'TSN340',d:'ZWB1 glass at 8.3mm \u00b7 derived, not guessed',c:'#6f5cc0',
  bands:[{lo:290,ls:10,hi:375,hs:11,T:.90},{lo:697,ls:13,hi:750,hs:25,T:.17}],dens:3.952,
  same:'TSN340 is not a separate glass \u2014 Aphalo\u2019s own measurements (photo-spectrum.info) identify it directly as '
   +'ZWB1 glass at 8.3mm, versus the 2.1mm ZWB1 already fitted elsewhere in this file. Rather than guess a curve shape, '
   +'this reuses that already-verified ZWB1 band shape and applies Beer-Lambert scaling (dens = 8.3/2.1 = 3.952) via the '
   +'same internal-transmittance mechanism used elsewhere in this file (see the 80-series notes). The result is '
   +'physically coherent with Aphalo\u2019s own description: UV peak drops moderately (~90%\u2192~70%) while the NIR bump is '
   +'nearly eliminated (~11%\u21920.02% of peak) \u2014 \"blocks NIR enough for some uses in photography\" without a full '
   +'blocker stage, exactly matching his stated reasoning that a thicker filter discriminates UV from NIR better because '
   +'attenuation increases exponentially with thickness'},
 {id:'bw403',g:'B2',n:'B+W 403',d:'= Schott UG1 · fitted to Schott datasheet',c:'#a08ae8',leak:true,
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from Schott\u2019s own UG1 datasheet. '
   +'Replaces the earlier three-band sigmoid fit (RMS 1.3pp across 28 points) after checking it against this '
   +'real curve directly \u2014 the two matched closely at every checked wavelength, so this is a precision '
   +'upgrade, not a correction. Confirms and quantifies what spectrometer testing (Kolari Vision, diglloyd) '
   +'already showed qualitatively: a real, substantial NIR leak peaking ~48% around 750nm, settling to a long '
   +'~5-6% tail through 1000nm+. This is why B+W 403 dominates as a near-IR image on a full-spectrum body '
   +'unless paired with a real IR blocker.'},

 // ---- IR blockers (short-pass) — the partner half of a UV stack ----
 /* ---- IR blockers / short-pass ----
    Two physically different technologies sit in this group and they behave
    very differently in use:

    ABSORPTIVE glass (BG/S8612/KG/QB series) absorbs IR chemically. Its
    response does not care what angle light arrives at, so it stays even
    across the frame on any lens.

    INTERFERENCE coatings (hot mirrors, B+W 486) reflect IR off a dielectric
    stack. The effective coating thickness changes with incidence angle, so
    the cutoff shifts toward blue at the frame edges — the notorious cyan
    corner cast on wide lenses. Sellers of absorptive glass make this point
    against 486-type filters and they are right about the mechanism.

    Cutoffs below are for roughly 2mm thickness. Thickness matters a lot with
    absorptive glass: doubling it deepens the IR block and pulls the visible
    cutoff shorter. */
 {id:'tsn575',g:'B1',n:'TSN575',d:'Strongest NIR block \u00b7 conservative interim estimate',c:'#6fab96',
  bands:[{hi:575,hs:18,T:.55}],type:'absorptive',
  same:'no manufacturer datasheet exists for this Chinese-market glass, but the shape is now cross-validated rather '
   +'than resting on description alone. Aphalo\u2019s blog (photo-spectrum.info) publishes measured optical density for '
   +'three TSN575 stacks (ZWB1+, ZWB2+, ZWB3+TSN575) across named wavebands. Since stacked OD is additive '
   +'(OD_total = OD_A + OD_B), subtracting this file\u2019s own already-fitted ZWB1/ZWB2/ZWB3 curves from those three '
   +'measured stack values isolates TSN575\u2019s own OD independently three times per band \u2014 a triangulation, not a '
   +'single read. In the bands where the subtraction is numerically stable (UV-A1, Purple, Blue, Orange, Red, NIR) all '
   +'three stacks agree closely: TSN575 passes UV-A1/Purple/Blue reasonably well (roughly 30-80%) and is essentially '
   +'fully opaque by Red/NIR (OD 3.5-5+, under 0.03% transmission) \u2014 consistent with a shortpass cutting off around '
   +'575nm, which is what this entry already modelled. Green/Yellow were dropped from the triangulation: both '
   +'constituent filters are already nearly opaque there, so the subtraction becomes numerically unstable. PEAK LOWERED '
   +'from 92% to 55%: a UV/IR forum contributor flagged that a real "Black foliage" stack using this filter shouldn\u2019t '
   +'pass much in the 400-460nm violet/blue region, and computing the actual stack showed a genuine 53% peak there, '
   +'traced specifically to this filter\u2019s flat plateau. 92% sat at the very top of the triangulation\u2019s already-wide '
   +'30-80% uncertainty range; 55% sits at the middle of that same range instead \u2014 still within what the real data '
   +'supports, just no longer the most optimistic reading of it. This is a deliberately conservative estimate, not a '
   +'refit: the triangulation data doesn\u2019t resolve band-by-band variation within the passband, so a single flat '
   +'plateau remains a simplification either way'},
 {id:'qb21',g:'B5',n:'QB21',d:'Tangsinuo · = Schott BG38',c:'#5f9ea8',
  same:'REAL DATA \u2014 same real curve as bg38 (see its note): Schott\u2019s own official BG38 datasheet, internal '
   +'transmittance at 1mm with the datasheet\u2019s own stated reflection factor (Pd=0.916) applied. QB21 and BG38 '
   +'are the same glass under two different trade names (Tangsinuo sell it as QB21; Schott as BG38), so this is '
   +'the correct real curve for both, not an approximation carried over. CORRECTED: replaces an entry that had '
   +'never had real digitized data of its own \u2014 the UV-side cutoff and closing-edge slope were both read off '
   +'a phone photo of a forum chart, then partially tightened later using indirect spectrophotometer evidence '
   +'rather than a direct measurement. This official datasheet resolves that provisional status directly.'},
 {id:'qb21ar',g:'B4',n:'QB21 AR coated',d:'Better UV-A, weaker NIR block',c:'#6fb0bc',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from a genuine Tangsinuo QB21-2mm AR '
   +'chart (per-5nm points, 205-1100nm), not a hand-fit sigmoid. This replaces an earlier provisional estimate '
   +'that was itself \u201cread off a phone photo of a forum chart\u201d \u2014 that fit turned out to have the '
   +'closing edge too gradual: the real data shows only 19.5% transmission at 665nm (where the old fit assumed '
   +'roughly 48%, its sigmoid midpoint) and a genuine NIR floor around 0.08%, far below the old fit\u2019s assumed '
   +'14% secondary reopening past 990nm. No second reopening band exists in the real data at all.'},
 {id:'bg3',g:'B8',n:'Schott BG3 (\u2248ZB2)',d:'UV + violet-blue pass \u00b7 hard block 500-680nm \u00b7 very large NIR leak',c:'#7b6fd6',
  bands:[{lo:262.5,ls:9,hi:461.5,hs:16,T:.896},{lo:705,ls:8,hi:1140,hs:50,T:.91}],leak:true,type:'absorptive',
  same:'Fitted to real Schott BG3 transmission data (via CheeseCube312\u2019s Filter-Plotter-Data project) \u2014 RMS 1.6 percentage points across 200-1150nm, max error 5.0pp. Unlike the ZWB/UG glasses this is not a UV-only filter: it holds ~90% right through violet and only falls to half by ~460nm, so it passes UV AND blue. That is the point of it \u2014 it is a UV-blue bandpass, not a UV isolator. The block from 500 to 680nm is genuinely complete (true zero), but the NIR leak is the largest of any glass in this list: ~78% by 720nm and ~91% flat from 750 to 900nm, higher even than ZWB3. It cannot be used alone on a full-spectrum body under any circumstances \u2014 the infrared would swamp the UV and blue entirely. Pair it with S8612, BG39 or QB21. '
   +'Tangsinuo sell ZB2 as the equivalent glass and it is close, but not identical: measurements published by photo-spectrum.info put ZB2\u2019s NIR cut-in about 25nm longer than BG3\u2019s. That is an advantage rather than a defect \u2014 if you are blocking the near-IR with a second filter anyway, starting the leak 25nm further out gives the blocker less to do. ZB2 itself is NOT in the Filter-Plotter dataset, so no measured curve is modelled here; treat this entry as BG3 proper, and ZB2 as similar with a slightly later IR onset. '
   +'The usual caution for Chinese-designation glass applies doubly here: without a spectrometer you are trusting the seller that what arrives matches the description'},
 {id:'bg38',g:'B5',n:'Schott BG38',d:'= QB21 · keeps most red',c:'#4d8f7d',
  same:'REAL DATA \u2014 Schott\u2019s own official BG38 datasheet (PDF, status 01.12.2014), internal transmittance '
   +'\u03c4\u1d62 at 1mm reference read directly off the datasheet\u2019s own tabulated values (10nm steps, 300-1100nm), '
   +'with the datasheet\u2019s own stated reflection factor (Pd=0.916) applied to get real external transmission. '
   +'CORRECTED: replaces an earlier CheeseCube312-sourced curve that turned out to match the internal '
   +'transmittance almost exactly \u2014 missing that same ~8-9% surface-reflection factor every other Schott '
   +'entry in this file already accounts for. That earlier version wasn\u2019t reading a fitted approximation '
   +'wrong so much as reading the wrong COLUMN of real data \u2014 internal instead of external.'},
 {id:'bg24',g:'B7',n:'Schott BG24',d:'Heat-absorbing · passes UV/blue and deep red, cuts green-yellow',c:'#4a8570',
  bands:[{lo:230,ls:15,hi:390,hs:12,T:.83},{lo:660,ls:25,T:.90}],type:'absorptive',
  same:'Digitised from a classic Schott reference chart (Virginia astronomy dept. scan) photographed at an angle — '
   +'the double-hump shape (blue/UV pass, deep trough near 580nm, second rise to a red/NIR plateau) is real, but '
   +'exact cut points are a careful read rather than a precise digitisation.'},
 {id:'ug11',g:'B2',n:'Schott UG11',d:'Narrow near-UV bandpass · blocks almost all visible light',c:'#8878d0',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from Schott\u2019s own UG11 datasheet. '
   +'Replaces an earlier provisional fit shared with BG24 (a classic reference chart, phone-photographed at an '
   +'angle) \u2014 BG24 itself is unaffected and still uses that original source, since no equivalent real data for '
   +'BG24 specifically was found.'},
 {id:'sch_ug5',g:'B2',n:'Schott UG5',d:'UV + NIR dual-pass · blocks most of the visible band',c:'#a08ae0',leak:true,
   /* Verified against the PGO (Präzisions Glas & Optik) principal-curves
      datasheet for UG5 at 1mm: mean absolute error 1.0pp across 21 sampled
      wavelengths from 300 to 1100nm. A second UG5 entry (schott_ug5) was
      removed in favour of this one -- it sat 12.7pp from the datasheet and
      modelled the whole NIR as a flat 55%, which the real glass does not do
      (it dips to ~59% near 840nm then climbs back to ~67% by 1050nm).
      NOTE: these values are for 1mm thickness. UG5 is sold in other
      thicknesses and transmission is thickness-dependent, so a 2mm sample
      will block the visible harder and pass less in both passbands.

      That thickness behaviour is confirmed, not assumed: squaring these 1mm
      values (Beer-Lambert for double the path) reproduces an independent
      relative-transmittance chart of a 2mm UG5 to a mean error of 0.053 in
      relative units, with 440, 460, 500, 720, 840, 900 and 1000nm all within
      0.006. Assuming that chart was 1mm instead gives 0.149, three times
      worse. Two independent sources, two thicknesses, one curve. */

  same:'REAL DATA \u2014 Schott\u2019s own official UG5 datasheet (PDF), full internal transmittance table (10nm steps) '
   +'with the datasheet\u2019s own stated reflection factor (Pd=0.914) applied, 1mm reference. New addition, '
   +'genuinely distinct from the other UV-pass glass in this file: high in near-UV, drops to near-opaque through '
   +'most of the visible band (down near 1% around 600nm), then reopens substantially into red and NIR '
   +'(back up past 60-70% by 900-1100nm) \u2014 a real dual-band UV+NIR pass, not just a UV-pass with a minor IR leak.'},
 {id:'s8612',g:'B5',n:'Schott S8612',d:'Strong IR block · fitted to Schott datasheet',c:'#57a08a',type:'absorptive',stains:true,
  same:'REAL DATA \u2014 Schott\u2019s own official S8612 datasheet (PDF), full internal transmittance table (10nm steps) '
   +'with the datasheet\u2019s own stated reflection factor (Pd=0.913) applied. Replaces the earlier least-squares '
   +'sigmoid fit (RMS 2.4pp) with the exact real curve. This also resolves an old open question: a third-party '
   +'digitisation once suggested this fit was ~10pp off, which was never explained \u2014 checking it against this '
   +'official table now shows that "discrepancy" was the third-party data being uncorrected internal '
   +'transmittance, missing the same Pd factor this entry already accounted for. The original sigmoid fit was '
   +'right all along; this is a precision upgrade, not a correction.'},
 {id:'bg40',g:'B5',n:'Schott BG40',d:'Between BG38 and BG39 · fitted to Schott datasheet',c:'#489a86',type:'absorptive',
  same:'REAL DATA \u2014 Schott\u2019s own official BG40 datasheet (PDF), full internal transmittance table (10nm steps) '
   +'with the datasheet\u2019s own stated reflection factor (Pd=0.916) applied. Replaces the earlier least-squares '
   +'sigmoid fit (RMS 1.9pp) \u2014 same resolution as s8612\u2019s note: the old apparent ~10pp discrepancy against '
   +'third-party data was that data missing the Pd correction, not an error in this fit. NOTE: BG40\u2019s NIR block '
   +'bottoms out at only \u03c4\u1d62\u22481.6-1.9\u00d710\u207b\u00b3 around 850-870nm, roughly 100\u00d7 weaker than BG39/S8612\u2019s <1\u00d710\u207b\u2075 \u2014 '
   +'BG40 is a noticeably weaker IR blocker than its siblings despite the similar visible-passband shape; '
   +'don\u2019t treat them as interchangeable.'},
 {id:'bg39',g:'B5',n:'Schott BG39',d:'Cuts deep into red · fitted to Schott datasheet',c:'#43907e',type:'absorptive',stains:true,
  same:'REAL DATA \u2014 Schott\u2019s own official BG39 datasheet (PDF), full internal transmittance table (10nm steps) '
   +'with the datasheet\u2019s own stated reflection factor (Pd=0.914) applied. Replaces the earlier least-squares '
   +'sigmoid fit (RMS 2.6pp) \u2014 same resolution as s8612/bg40\u2019s notes: the old apparent ~10pp discrepancy '
   +'against third-party data was that data missing the Pd correction, not an error in this fit.'},
 {id:'bw039',g:'B5',n:'B+W 039',d:'Mounted Schott BG39',c:'#3f8878',type:'absorptive',stains:true,
  same:'Schott BG39 in a B+W mount \u2014 same real curve as the bg39 entry above, see its note for sourcing'},
 {id:'cc1',g:'B5',n:'LDP CC1',d:'≈ BG38 2.5mm uncoated',c:'#52988a',type:'absorptive',
  same:'DERIVED, not guessed \u2014 replaces a fit that was only ever "widely believed to be uncoated 2.5mm BG38," '
   +'with no real data behind it at all. Now computed directly from this file\u2019s own real BG38 curve (Schott\u2019s '
   +'official datasheet, 1mm reference): the internal transmittance is recovered by dividing out BG38\u2019s own '
   +'reflection factor, scaled to 2.5mm via Beer-Lambert absorption (internal \u221d thickness in the exponent, the '
   +'same law used elsewhere in this file for TSN340\u2019s ZWB1-at-8.3mm derivation), then the reflection factor is '
   +'reapplied. This rests on the "2.5mm BG38" identification being correct \u2014 which is still a belief, not a '
   +'confirmed spec \u2014 but the thickness scaling itself is real physics, not another guess stacked on top.'},
 {id:'bw486',g:'B5',n:'B+W 486',d:'UV/IR cut · real chart',c:'#8fcbb6',type:'interference',
  same:'REAL DATA \u2014 exact digitised curve, from Jos. Schneider Optische Werke\u2019s own official "Transmission '
   +'Curves" document, a clean isolated chart (not a crowded multi-curve page) \u2014 real plateau ~93-98% through '
   +'400-670nm with visible ripple, closing sharply by 680-700nm. Replaces the earlier fit (already good, 3.9pp '
   +'max error against a different B+W posting of this same curve) with the exact curve \u2014 a precision '
   +'upgrade, not a correction.'},
 {id:'hoyauvir',g:'B5',n:'Hoya UV-IR cut',d:'Restores normal colour \u00b7 real chart',c:'#6ab49c',type:'interference',
  same:'REAL DATA \u2014 exact digitised curve from a real "HOYA UVIR Light Transmission Graph" (300-1200nm). '
   +'Replaces an undocumented placeholder with the exact curve \u2014 plateau ~97-99% through 420-680nm, closing '
   +'sharply by 700-750nm, and like Baader\u2019s UV/IR-Cut elsewhere in this file, a real NIR leak begins rising '
   +'again right at the edge of this tool\u2019s 1100nm ceiling (still under 1% at 1100nm on this chart, but '
   +'visibly climbing toward ~40% by 1200nm on the source chart itself \u2014 mostly outside what this tool models).'},
 {id:'heliouvir',g:'B5',n:'Heliopan Digital UV-IR',d:'Schott glass · absorptive, not a hot mirror',c:'#72c0a0',
  bands:[{lo:400,ls:8,hi:670,hs:11,T:.92}],type:'absorptive',
  same:'built from Schott glass rather than a dielectric coating — avoids the corner colour-shift dichroic hot mirrors can show on wide lenses. '
   +'No published Heliopan curve has been found, so this is an idealised shape (EST), not a fit. Build 146: its peak was 94%, '
   +'which bare absorptive glass cannot reach (two uncoated surfaces keep about 92%); held at that ceiling until real data turns up.'},
 {id:'grb1',g:'B1',n:'GRB1 (2mm)',d:'Real product-specific data · extends furthest into NIR',c:'#a8c9b8',
  bands:[{lo:292.1,ls:13.72,hi:753.0,hs:74.93,T:.88}],type:'absorptive',
  same:'REFITTED to real product-specific GRB1 data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 '
   +'RMS 1.2 percentage points across 170 points, 255-1100nm, a real improvement on the previous Schott KG2 proxy (11.0pp '
   +'RMS against this same real data). Manufacturer Zeyuan Optics states GRB1 = Schott KG2, and that identification still '
   +'looks directionally right for the visible band, but this real GRB1-specific data shows it blocking NIR notably '
   +'harder than genuine Schott KG2 glass does \u2014 e.g. 1.4% at 1000nm here vs ~10% the KG2 proxy assumed \u2014 suggesting '
   +'either a formulation difference or a less-than-perfect "equivalent" claim. GRB3, by contrast, matched its KG3 proxy '
   +'closely (2.2pp RMS against this same real dataset) and was left as-is. The crossover finding survives with the '
   +'corrected curve: GRB1 still passes more than GRB3 at every wavelength from 700-1000nm, just with smaller margins '
   +'than the KG2 proxy implied \u2014 GRB1 genuinely does extend furthest into NIR, the magnitude was just overstated before'},
 {id:'grb3',g:'B1',n:'GRB3 (2mm, = Schott KG3)',d:'Official Schott datasheet · genuine ND-for-IR',c:'#93bda9',type:'absorptive',
  same:'REAL DATA \u2014 Schott\u2019s own official KG3 datasheet (PDF), full internal transmittance table (10nm steps) '
   +'with the datasheet\u2019s own stated reflection factor (Pd=0.920) applied, at the 2mm reference thickness. '
   +'Replaces the earlier least-squares sigmoid fit (already RMS 1.2pp against this same official source) with '
   +'the exact curve \u2014 a precision upgrade, not a correction. This is the exact glass Kennard\u2019s 2mm GRB3/KG3 '
   +'DIY recipes use, and it is what B+W 489 is a mounted equivalent of. See GRB1\u2019s own note for why that '
   +'entry deliberately does NOT use this same genuine-Schott-KG2 approach \u2014 real GRB1 product data disagrees '
   +'with Schott\u2019s official KG2 by more than this fit disagreed with KG3, suggesting the two resellers\u2019 '
   +'glass isn\u2019t identical despite being marketed as equivalent.'},
 {id:'bw489',g:'B1',n:'B+W 489',d:'Mounted Schott KG3',c:'#9dc4b0',type:'absorptive',
  same:'Schott KG3 in a B+W mount \u2014 same real curve as the grb3 entry above, see its note for sourcing'},

 // ---- IR-pass (long-pass) — the conversion ladder ----
 {id:'ir665',g:'B7',n:'665nm',d:'Enhanced colour',c:'#d1763a',bands:[{lo:665,ls:8,T:.90}]},
 {id:'ir950',g:'B9',n:'950nm',d:'Deep IR',c:'#8d2d19',bands:[{lo:950,ls:8,T:.90}]},

 {id:'stc_irp590',g:'B6',n:'STC IRP 590',d:'STC Optics · real chart · 50% at ~597nm',c:'#e8a838',
  same:'REAL DATA \u2014 exact digitised curve, traced programmatically from STC Optics\u2019 own official "IR-Pass '
   +'Filter" product chart (stcoptics.com), which shows IRP 590/720/850 as three real measured curves rather '
   +'than idealised cutoffs. Digitised 50%-point (~597nm) lands almost exactly on the product name, a good '
   +'sign the calibration and trace are accurate. Peaks ~95%, not a full 100%, a real detail an idealised '
   +'cutoff wouldn\u2019t show. A genuinely new brand for this file \u2014 distinct from the Hoya/Kodak IR-pass '
   +'filters elsewhere.'},
 {id:'stc_irp720',g:'B8',n:'STC IRP 720',d:'STC Optics · real chart · 50% at ~724nm',c:'#c04030',
  same:'REAL DATA \u2014 same source and method as IRP 590 above. 50%-point (~724nm) lands almost exactly on the '
   +'product name. Close in cutoff to Hoya R72/hy_r72 (720nm) and Wratten 89B (716.5nm) elsewhere in this file, '
   +'but a genuinely different, real product with its own real curve, not a duplicate.'},
 {id:'stc_irp850',g:'B9',n:'STC IRP 850',d:'STC Optics · real chart · 50% at ~852nm',c:'#8f2a28',
  same:'REAL DATA \u2014 same source and method as IRP 590 above. 50%-point (~852nm) lands almost exactly on the '
   +'product name. Close in cutoff to Hoya R85/hy_r85 (850nm) and Wratten 87C (855nm) elsewhere in this file, '
   +'but a genuinely different, real product with its own real curve, not a duplicate.'},

 /* ---- Branded IR filters you can actually buy ----
    50% transmission points from the Kodak Photographic Filters Handbook
    (B-3, 1992) for the Wratten series, and B+W's own published figures.
    Edge softness for 092 and 093 was fitted to their two-point specs
    (092: 50% @695 rising past 90% by 730; 093: ~1% @800, 88% @900). */
 {id:'bw021',g:'B4',n:'B+W 021',     d:'Light yellow contrast filter \u00b7 real B+W chart',c:'#e8d840',
  bands:[{lo:465,ls:10,T:.95}],
  same:'REAL DATA (read from a chart) \u2014 B+W\u2019s own official transmission chart ("Black & White Filters '
   +'021, 022, 023, 040, 041", B+W Filter Handbook, p.33). New addition, completing a family we already '
   +'curate the rest of (040/041 already real, via Schott OG550/Wratten 22). 50%-point read at ~465nm, the '
   +'lightest/earliest-rising of this five-filter series.'},
 {id:'bw022',g:'B4',n:'B+W 022',     d:'Medium yellow contrast filter \u00b7 real B+W chart',c:'#dcc838',
  bands:[{lo:495,ls:10,T:.95}],
  same:'REAL DATA (read from a chart) \u2014 same source as bw021 (p.33). 50%-point read at ~495nm. Close '
   +'enough to Wratten 8/K2\u2019s own corrected fit (492nm, least-squares against Kodak\u2019s table \u2014 see hy_k2\u2019s '
   +'note) that the two are almost certainly the same filter under different names, consistent with a '
   +'duplicate id this entry used to share with a since-removed second bw022 definition that made the same '
   +'claim from a different angle (B+W\u2019s naming convention rather than a direct chart read). REAL DATA now '
   +'added as an actual digitised curve (10nm grid, read by eye) from B+W\u2019s own 022/040/090/091 transmission '
   +'chart supplied by Nik, confirming the ~495nm 50%-point read above; this was previously only a two-point '
   +'band fit despite the \u201cREAL DATA\u201d label in this note, so the badge now matches the claim.'},
 {id:'bw023',g:'B5',n:'B+W 023',     d:'Deep yellow contrast filter \u00b7 real B+W chart',c:'#d0b830',
  bands:[{lo:515,ls:10,T:.95}],
  same:'REAL DATA (read from a chart) \u2014 same source as bw021 (p.33). 50%-point read at ~515nm, between '
   +'022 and 040 (which is real Schott OG550 data, 50%-point 550nm).'},
 {id:'bw040',g:'B5',n:'B+W 040',     d:'= Schott OG550 · 50% @550nm',  c:'#d68f3c',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from Schott\u2019s own OG550 datasheet. '
   +'Replaces an undocumented sigmoid approximation. Confirmed on ultravioletphotography.com: B+W 040 and '
   +'B+W 099 are made from the SAME glass, Schott OG550, both 50% transmission at 550nm. B+W markets 040 as a '
   +'"black & white filter" and 099 as an "infrared filter" \u2014 same physical filter, different marketing label. '
   +'CURRENT NAME: B+W\u2019s newer catalogue lists what appears to be this same product as the "Basic Orange 550 '
   +'MRC" \u2014 also Schott glass, also stated as passing everything above 550nm. Not independently verified '
   +'against a datasheet the way the rest of this entry is; treat the name link itself as the less certain part.'},
 {id:'bw099',g:'B5',n:'B+W 099',     d:'= Schott OG550 · same glass as 040',c:'#d68a3a',
  same:'REAL DATA \u2014 same Schott OG550 curve as bw040 (see its note), replacing an earlier undocumented '
   +'sigmoid that had wrongly placed 099 at 520nm before an earlier correction already fixed it to match 040. '
   +'OLDER FILTERS DIFFER: a vintage B+W 099 (probably 1960s) measured on a spectrometer by Ulf on '
   +'ultravioletphotography.com (2020) crosses 50% at about 522nm and looks yellow, not orange. B+W changed the glass '
   +'to OG550 at some point without renaming the filter, so a second-hand 099 may not match this curve.'},
 {id:'bw041',g:'B6',n:'B+W 041',     d:'= Wratten 22 · red-orange contrast',c:'#d47c36',bands:[{lo:566.7,ls:5.09,T:.896}],
  same:'B+W 041 is Wratten #22 equivalent glass \u2014 aligned to the Wratten 22 entry\u2019s Kodak-table fit (see w22\u2019s '
   +'note) rather than kept as a separate rough estimate. Note this is a visible-light red-orange contrast filter for '
   +'B&W tonal separation, not a UV or IR filter \u2014 it sits in this database mainly as a "same glass as w22" cross-reference'},
 {id:'bw090',g:'B6',n:'B+W 090',     d:'= Schott OG590 · confirmed on B+W\u2019s own chart',c:'#d2653d',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from Schott\u2019s own OG590 datasheet, '
   +'replacing an undocumented sigmoid. B+W\u2019s own official reference chart (p.29 of their filter guide) labels '
   +'this directly as OG590 \u2014 confirmed identity, not a cross-referenced approximation'},
 {id:'bw091',g:'B7',n:'B+W 091',     d:'= Schott RG630 · confirmed on B+W\u2019s own chart',c:'#cf5334',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from Schott\u2019s own RG630 datasheet, '
   +'replacing an undocumented sigmoid. B+W\u2019s own official reference chart labels this directly as RG630 \u2014 '
   +'confirmed identity, not a cross-referenced approximation'},
 {id:'bw092',g:'B7',n:'B+W 092',     d:'= Schott RG695 · confirmed on B+W\u2019s own chart',    c:'#c8462e',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from Schott\u2019s own RG695 datasheet, '
   +'replacing an undocumented sigmoid. B+W\u2019s own official reference chart labels this directly as RG695'},
 {id:'w89b',g:'B8',n:'Wratten 89B', d:'Real Kodak datasheet · ~700nm',              c:'#c1402c',
  same:'REAL DATA \u2014 exact digitised curve from Kodak\u2019s own modern "Wratten 2 Optical Filter / 89B" datasheet '
   +'(diffuse density chart, converted to transmission via T=10^-D). Replaces a sigmoid fit that was already '
   +'well cross-verified (717.0/716.5nm across two scans) with the exact curve \u2014 a precision upgrade, not a '
   +'correction. Real plateau settles around 90-91% by 800nm+, not a flat 90%.'},
  {id:'r72',g:'B8',n:'Hoya R72',    d:'The classic · real chart',         c:'#bd3f2b',
  same:'REAL DATA \u2014 exact digitised curve from a real "HOYA R72 Light Transmission Graph." Replaces the '
   +'earlier fit (already excellent, 0.7pp max error against a different real Hoya chart) with the exact curve '
   +'\u2014 a precision upgrade, not a correction. Real 50%-point sits at ~722nm on this chart, close to the '
   +'earlier fit\u2019s 711nm from the other source; both real, the small gap is normal digitisation/production '
   +'variance rather than a contradiction. This also resolves a duplicate: hy_r72 elsewhere in this file was an '
   +'unsourced placeholder for the same real product and has been removed.'},
 {id:'w88a',g:'B8',n:'Wratten 88A', d:'Official Kodak data · 755nm',              c:'#b23a27',bands:[{lo:755,ls:11,T:.90}],
  same:'corrected after re-reading a second scan of the official Kodak table \u2014 the first pass had a column-alignment error that put this ~17nm too low; verified line-by-line against physically-expected ordering (89B lowest cutoff, then 88A, then 87, then 87C highest). Max fitting error 5.9 percentage points'},
 {id:'w87',g:'B8',n:'Wratten 87',  d:'Real chart \u00b7 also Lee 87',c:'#a33523',
  same:'REAL DATA \u2014 exact digitised curve from an Edmund Optics "Coating Curve" chart for the 87 Kodak '
   +'Wratten infrared filter (700-1500nm, real transmission ripple visible in the source, not idealised). '
   +'CORRECTED: the earlier fit assumed a flat 90% plateau; the real curve settles closer to 76-80% with '
   +'visible ripple, not a clean 90% \u2014 and the 50%-point sits a little later, around 810nm rather than 788nm. '
   +'Lee sells a polyester 87 too \u2014 Lee\u2019s own marketing copy says "transmission begins above 730nm", but '
   +'independent measurement finds it tracks close to this real Wratten spec, not the marketing figure. Chart '
   +'only extends to 1500nm and this tool only needs to 1100nm, so the real ripple is fully covered.'},
 {id:'bw093',g:'B9',n:'B+W 093',     d:'= Schott RG830 · confirmed on B+W\u2019s own chart',      c:'#973020',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from Schott\u2019s own RG830 datasheet, '
   +'replacing an undocumented sigmoid. B+W\u2019s own official reference chart labels this directly as RG830'},
 {id:'w87c',g:'B9',n:'Wratten 87C', d:'Real Kodak datasheet · also Lee 87C',c:'#8a2c1d',
  same:'REAL DATA \u2014 exact digitised curve from Kodak\u2019s own modern "Wratten 2 Optical Filter / 87C" datasheet '
   +'(diffuse density chart, converted to transmission via T=10^-D). Replaces a sigmoid fit that was already '
   +'well cross-verified (847.0/855.0nm across two scans) with the exact curve \u2014 a precision upgrade, not a '
   +'correction. Real plateau settles around 84% by 900nm, this datasheet\u2019s own chart doesn\u2019t extend further; '
   +'held flat above that. Lee\u2019s polyester 87C is sold for B&W IR film sensitive to 1000nm, consistent with '
   +'this real spec.'},
 {id:'rm90',g:'B9',n:'Hoya RM90',   d:'Real gradual rise, fitted to UVP chart',        c:'#7c2719',bands:[{lo:926,ls:50,T:.94}],
   /* A second Hoya RM90 entry (hy_rm90) was removed in favour of this one.
      The two came from different digitising batches and their curves
      disagreed by up to 8pp, so one of them had to be wrong; this is the
      one kept, on the file owner's call. Recorded here because a
      disagreement that large is worth knowing about if a measurement ever
      contradicts this curve. */
  same:'fitted to a real Schott/Hoya comparison chart on ultravioletphotography.com \u2014 the rise is far more gradual than a simple cutoff suggests, spanning roughly 700-1200nm rather than plateauing sharply. Max fitting error 4.0 percentage points'},
 {id:'bw094',g:'B9',n:'B+W 094',     d:'= Schott RG1000 · fitted to Schott datasheet',c:'#6e2216',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from Schott\u2019s own RG1000 datasheet. '
   +'Replaces the earlier sigmoid fit (RMS 2.1pp, cross-confirmed by Edmund Optics) after checking it against '
   +'this real curve directly \u2014 the two matched closely (within a few points at every checked wavelength), so '
   +'this is a precision upgrade to the exact numbers, not a correction of an error. B+W\u2019s own numbering '
   +'(092=695nm/RG695, 093=830nm/RG830, 094\u2248RG1000) confirms the identity.'},
 {id:'rm100',g:'B9',n:'Hoya RM100',  d:'Official Hoya datasheet · deepest',            c:'#6b2115',bands:[{lo:950,ls:42,T:.91}],
   /* A second Hoya RM100 entry (hy_rm100) was removed in favour of this one.
      The two came from different digitising batches and their curves
      disagreed by up to 18pp, so one of them had to be wrong; this is the
      one kept, on the file owner's call. Recorded here because a
      disagreement that large is worth knowing about if a measurement ever
      contradicts this curve. */
  same:'fitted to Hoya\u2019s own official spectral characteristics datasheet (RM100, 2.5mm, AR coated) \u2014 max fitting error 4.5 percentage points. Also gradual, rising from ~800nm through past 1200nm rather than a sharp cutoff'},

 /* ---- Haze / UV-cut ----
    Passes visible light, blocks UV, and (the reason this is its own group
    rather than filed under Schott glass) does so WITHOUT fluorescing the
    way most UV-absorbing glass does \u2014 fluorescence there re-emits the
    blocked UV as visible light from within the glass itself, which ruins
    exactly the UV-blocking job the filter is meant to do. Tiffen's own
    published description for the Haze 2A: absorptive dye layer between two
    sheets of clear optical glass, specifically to avoid that fluorescence,
    rather than the doped glass most haze/UV filters use. */
 {id:'tiffen_haze2a',g:'B3', n:'Tiffen Haze 2A', d:'UV-cut, no fluorescence \u00b7 Wratten 2/2A equivalent \u00b7 ~405nm',
  c:'#f2edc4', bands:[{lo:405, ls:5, T:.92}],
  same:'lo=405 read directly off Kodak\u2019s own published density chart for "WRATTEN 2 Optical Filter / 2A (Pale Yellow)" '
   +'(kodak.com, Basic-Color-Filters PDF) \u2014 diffuse density is a clean ~3.0 (fully absorbing) below roughly 390nm, falls '
   +'sharply through the 400-410nm range, and settles near 0 (full transmission) by about 420nm; 405nm is where that fall '
   +'crosses density 0.3, i.e. 50% transmittance. Tiffen\u2019s Haze 2A is stated (photo-spectrum.info, measured across three '
   +'physical samples) to approximate this Kodak formulation, not to be identical to it \u2014 the source measured "very '
   +'little if any difference" in cutoff wavelength against a separate UV400 reference but did not publish an absolute '
   +'number for Haze 2A itself, so this entry is Kodak\u2019s own 2/2A data standing in for it. UNLIKE the RMS-fitted entries '
   +'elsewhere in this file, ls=5 (the slope) is an eyeballed match to how steep the chart looks, not a digitized '
   +'least-squares fit \u2014 flag and correct this if a fitted number ever turns up. T=.92 follows the same convention as '
   +'the Wratten step entries below rather than being read off this chart, which only plots density, not absolute '
   +'transmittance. REAL DATA now added \u2014 the density chart digitised directly (density-to-transmittance via '
   +'T=10^-D) onto a 10nm grid, confirmed by Nik as the correct match for Tiffen Haze 2A; supersedes the band-fit '
   +'above, so the eyeballed slope caveat no longer applies.'},

 /* ---- Wratten step series: yellow -> orange -> red ----
    All share one curve shape — a simple step cutting everything below a
    limit — with only the cutoff moving from blue through to deep red.
    These are the filters actually used in front of Aerochrome film to hold
    back blue, since every emulsion layer is inherently blue-sensitive. */
 {id:'w3',g:'B4',n:'Wratten 3',   d:'Light yellow · 440nm',                 c:'#e8e07a',bands:[{lo:462.6,ls:7.08,T:.902}]},
 {id:'w4',g:'B4',n:'Wratten 4',   d:'Yellow · 455nm',                       c:'#e6d96b',bands:[{lo:471.3,ls:5.50,T:.903}]},
 {id:'w8',g:'B4',n:'Wratten 8 (K2)',d:'Hoya K2 yellow · official Kodak data',c:'#e3cf5c',bands:[{lo:492.2,ls:9.21,T:.900}],
  same:'least-squares fit to Eastman Kodak\u2019s own published transmittance table ("Transmission of Wratten Filters", '
   +'compiled by Allie C. Peed Jr.), 400-700nm at 10nm intervals, illuminant C \u2014 OCR-extracted from the scanned '
   +'original rather than read by eye. RMS error 1.2 percentage points across 25 real data points. The No.8 column reads '
   +'0.25% at 460nm, 5.50% at 470, 19.0% at 480, 41.0% at 490, 63.5% at 500, 78.0% at 510, putting the true 50% point at '
   +'\u2248492nm. Cross-checks against the table\u2019s own published luminous transmittance for No.8 (82.7%). '
   +'CORRECTION HISTORY, recorded because this entry was wrong twice: it originally sat at 463.5nm; a first correction to '
   +'495nm (from B+W\u2019s 022 catalogue number and an astronomy paper) was actually close to right, but was then WRONGLY '
   +'reverted to 463.5nm after misreading a phone photo of this same table \u2014 the values used for that revert were the '
   +'No.6 column, one column to the left of No.8. The OCR-extracted figures above settle it at 492nm, roughly 29nm from '
   +'where this entry sat and vindicating the original 495nm estimate. REAL DATA now added \u2014 digitised curve '
   +'(10nm grid, read by eye) from a Tiffen/B+W \u201cYellow and Orange\u201d transmittance chart supplied by Nik, '
   +'plotting this filter as Yellow 8; its ~50%-point lands consistent with the 492nm figure above. CORRECTED: '
   +'that by-eye chart read was replaced with Kodak\u2019s own table values quoted in this note (0.25% at 460, 5.50% '
   +'at 470, 19.0% at 480, 41.0% at 490, 63.5% at 500, 78.0% at 510) \u2014 the eyeball read had the whole edge '
   +'shifted roughly 10nm early (it put 50% near 480nm rather than 492nm), so the stored curve now uses the '
   +'published table points directly and the Tiffen chart serves only as corroboration of the shape.'},
 {id:'w9',g:'B4',n:'Wratten 9',   d:'Deep yellow · real Kodak 1928 data',                  c:'#e0c650',
  same:'REAL DATA \u2014 exact percentages transcribed from Eastman Kodak\u2019s own "Wratten Light Filters" catalogue '
   +'(May 1928), p.64, "PERCENTAGE TRANSMISSION" table. Replaces an undocumented sigmoid with no stated source '
   +'at all. Real 50%-crossing sits close to 495nm, higher than this entry\u2019s old 497.6nm centre by only a '
   +'couple of nm \u2014 the old fit\u2019s position was already reasonable, this is a precision upgrade to the exact '
   +'shape. Table only covers 400-700nm; held flat outside that range.'},
 {id:'w12',g:'B5',n:'Wratten 12',  d:'Minus-blue · real Kodak 1928 data',       c:'#dcb944',
  same:'REAL DATA \u2014 exact percentages transcribed from the same 1928 Kodak catalogue, p.64. Replaces the '
   +'earlier sigmoid fit (already anchored to this same table, 2.7pp max error) with the exact curve. Real '
   +'50%-crossing sits close to 517nm, matching the old fit\u2019s 518.7nm closely. Table covers 400-700nm; held '
   +'flat outside that range.'},
 {id:'w15',g:'B5',n:'Wratten 15',  d:'Dark yellow · real Kodak 1928 data',      c:'#d9ad3c',
  same:'REAL DATA \u2014 exact percentages transcribed from the same 1928 Kodak catalogue, p.64. Confirms what '
   +'the earlier fit already flagged: this is genuinely a bell/band shape, not a simple longpass step \u2014 rising '
   +'to a plateau around 75-79% by 550nm and staying there rather than a sharp single edge, real detail the '
   +'earlier "mean error 5-6pp on the awkward asymmetric shoulder" sigmoid could only approximate. Table covers '
   +'400-700nm; held flat outside that range.'},
 {id:'w16',g:'B5',n:'Wratten 16',  d:'Real Kodak 1928 data',c:'#d69c37',
  same:'REAL DATA \u2014 exact percentages transcribed from the same 1928 Kodak catalogue, p.64. Real 50%-crossing '
   +'sits close to 528nm, matching the earlier fit\u2019s 529nm closely. Tiffen\u2019s own compatibly-numbered "Color '
   +'16" reportedly measures ~547nm \u2014 still a real, meaningful gap from Kodak\u2019s own number, worth knowing if '
   +'comparing the two brands\u2019 same-numbered filters. Table covers 400-700nm; held flat outside that range.'},
 {id:'w21',g:'B6',n:'Wratten 21',  d:'Orange · real Kodak 1928 data',              c:'#d48c34',
  same:'REAL DATA \u2014 exact percentages transcribed from the same 1928 Kodak catalogue, p.65. Real 50%-crossing '
   +'sits very close to 555nm, matching the earlier fit\u2019s 555.8nm almost exactly. Tiffen also sells a '
   +'Wratten-numbered 21 to the same nominal spec (~550nm per community sources) \u2014 consistent with this real '
   +'curve. Table covers 400-700nm; held flat outside that range.'},
 {id:'w22',g:'B6',n:'Wratten 22',  d:'B+W 041 · red-orange · real Kodak 1928 data',         c:'#d17c31',
  same:'REAL DATA \u2014 exact percentages transcribed from the same 1928 Kodak catalogue, p.65. Real 50%-crossing '
   +'sits close to 568nm, matching the earlier fit\u2019s 567.6nm almost exactly. Table covers 400-700nm; held flat '
   +'outside that range.'},
 {id:'w23a',g:'B6',n:'Wratten 23A', d:'Light red · real Kodak 1928 data',                    c:'#d06d2f',
  same:'REAL DATA \u2014 exact percentages transcribed from the same 1928 Kodak catalogue, p.65. Real 50%-crossing '
   +'sits close to 584nm, near the earlier fit\u2019s 581.3nm. Table covers 400-700nm; held flat outside that range.'},
 {id:'w25',g:'B6',n:'Wratten 25',  d:'Tricolor red · real Kodak 1928 data',              c:'#d4553c',
  same:'REAL DATA \u2014 exact percentages transcribed from the same 1928 Kodak catalogue, p.65. Real 50%-crossing '
   +'sits close to 599nm, a touch later than the earlier fit\u2019s 593.6nm. Kodak\u2019s own description for this one: '
   +'"aerial infrared photography and haze cutting." Table covers 400-700nm; held flat outside that range.'},
 {id:'w29',g:'B7',n:'Wratten 29',  d:'Deep red · real Kodak datasheet',         c:'#d04a37',
  same:'REAL DATA \u2014 exact digitised curve from Kodak\u2019s own modern "Wratten 2 Optical Filter / 29" datasheet '
   +'(diffuse density chart, converted to transmission via T=10^-D), cross-checked against the 1928 Kodak '
   +'catalogue\u2019s own real percentage table for the same filter (p.66) \u2014 both agree closely (620nm \u2248 50% in '
   +'both). CORRECTED: the earlier fit\u2019s claim of a 50% point "almost exactly at 600nm" was imprecise \u2014 both '
   +'real sources independently put it closer to 620nm, a genuine ~20nm difference this exact curve now '
   +'resolves. Real NIR plateau is high, ~88-90%, not a sharp closing edge.'},

 /* ---- Colour conversion (roughest models on this page) ----
    Unlike the step filters these are gentle slopes across the visible band,
    which a sigmoid can only approximate. They are also DYE filters, so like
    every dye they go transparent past ~700nm — the second band below. */
 {id:'kb1_5',g:'B9',n:'B+W KB1.5',  d:'Mildest blue conversion',c:'#a8c0e8',
  bands:[{lo:200,ls:1,T:.99}],ar:true,notch:[{c:595,w:63,d:.30}],
  same:'same B+W KB-series chart as KB20 \u2014 same notch shape and centre, depth read off this curve\u2019s shallower trough (~70%). Weakest of the five'},
 {id:'kb3',g:'B9',n:'B+W KB3',    d:'Mild-moderate blue conversion',c:'#8fb0e0',
  bands:[{lo:200,ls:1,T:.99}],ar:true,notch:[{c:595,w:63,d:.49}],
  same:'same B+W KB-series chart as KB20 \u2014 same notch shape and centre, depth read off this curve\u2019s trough (~51%)'},
 {id:'kb6',g:'B7',n:'B+W KB6',    d:'Moderate blue conversion',c:'#7ba0da',
  bands:[{lo:200,ls:1,T:.99}],ar:true,notch:[{c:595,w:63,d:.68}],
  same:'same B+W KB-series chart as KB20 \u2014 same notch shape and centre, depth read off this curve\u2019s trough (~32%)'},
 {id:'kb12',g:'B7',n:'B+W KB12',   d:'Strong blue conversion',c:'#6f98d5',
  bands:[{lo:200,ls:1,T:.99}],ar:true,notch:[{c:595,w:63,d:.78}],
  same:'same B+W KB-series chart as KB20 \u2014 same notch shape and centre, depth read off this curve\u2019s trough (~22%). One step below KB20, the strongest of the five'},
 {id:'kb20',g:'B7',n:'B+W KB20',   d:'Strongest blue conversion · real deep-notch shape',   c:'#5f8fd0',
  bands:[{lo:200,ls:1,T:.99}],ar:true,notch:[{c:595,w:63,d:.93}],
  same:'fitted to B+W\u2019s own official KB-series chart \u2014 this is a genuine deep V-notch centred ~595nm dropping to ~10%, not a simple falling-then-rising edge. Mean error 5.1 percentage points. The earlier model had roughly the right endpoints but the wrong shape in between. FRESNEL CORRECTED: all five KB entries were modelled at exactly 100% peak transmission, which no real glass reaches \u2014 B+W\u2019s published chart almost certainly plots internal transmission, excluding surface reflection. Set to 99% with the AR flag, matching B+W\u2019s MRC multicoating; the notch depths and shape are unchanged'},
 {id:'c80a',g:'B3',n:'Hoya 80A',   d:'3200K \u2192 5500K \u00b7 real Hoya-branded data',c:'#6f9bd8',
  bands:[{lo:345.9,ls:8.25,hi:469.4,hs:77.26,T:1.00},{lo:276,ls:8,T:.161}],leak:true,
  same:'REFITTED to real Hoya-branded 80A data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 '
   +'RMS 2.8 percentage points, 355-1000nm. This SUPERSEDES the previous Kodak Wratten 80A table fit (RMS 1.0pp against '
   +'Kodak\u2019s own data) for an important reason: checked against this new Hoya-specific data, the Kodak fit was off by '
   +'up to 41.7pp \u2014 not a small gap, a genuinely different curve shape (Kodak\u2019s table stays near-peak in a broad '
   +'381-493nm plateau; real Hoya 80A is already down to 52.6% by 450nm). This isn\u2019t a data-quality problem in either '
   +'source \u2014 both are internally well-fitted to their own real data \u2014 it means Kodak\u2019s Wratten 80A gel and Hoya\u2019s '
   +'own 80A glass, sold as equivalent 3200K-to-5500K conversions, are genuinely NOT identical formulations. Since this '
   +'entry is explicitly labelled "Hoya 80A," the Hoya-branded data is the more appropriate fit for what it claims to '
   +'represent, even though the Kodak source was individually the more rigorously verified of the two'},

 {id:'c80b',g:'B3',n:'Hoya 80B',   d:'3400K → 5500K · real Hoya-branded data',            c:'#7fa8de',
  bands:[{lo:343.0,ls:7.61,hi:513.0,hs:88.63,T:1.00},{lo:276,ls:8,T:.244}],leak:true,
  same:'REFITTED to real Hoya-branded 80B data (via CheeseCube312\u2019s Filter-Plotter-Data project) \u2014 RMS 2.6 '
   +'percentage points, a real improvement on the previous chart-digitisation\u2019s stated 9.5pp mean error. A dye-density '
   +'correction toward B+H\u2019s published 3x filter factor was tried earlier and removed \u2014 shown to degrade agreement '
   +'with real measured data on 80A, so never trusted here either. This replaces the earlier leak-band-capping fix (that '
   +'fix addressed a real artefact \u2014 a flat, unterminated IR tail reporting a false peak at 1100nm \u2014 but this full '
   +'refit to real data resolves the same problem more thoroughly, since the whole curve including its NIR behaviour is '
   +'now fitted to real Hoya-specific measurements rather than an estimated rolloff)'},
 {id:'c80c',g:'B3',n:'Hoya 80C',   d:'3800K → 5500K · real Hoya-branded data',c:'#90b5e4',
  bands:[{lo:355.2,ls:11.76,hi:545.1,hs:109.04,T:1.00},{lo:268,ls:4,T:.261}],leak:true,
  same:'REFITTED to real Hoya-branded 80C data (via CheeseCube312\u2019s Filter-Plotter-Data project) \u2014 RMS 1.3 '
   +'percentage points, the best-fitted of the three 80-series entries and a real improvement on the previous chart-'
   +'digitisation\u2019s stated 9.5pp mean error. Same dye-density-correction history as 80A/80B: tried and removed, since '
   +'it degraded agreement with real measured data rather than helping. This replaces the earlier leak-band-capping fix '
   +'the same way 80B does \u2014 fully refit to real data rather than patched at just the NIR tail'},
 {id:'c85',g:'B4',n:'Wratten 85', d:'5500K → 3400K · real double-rise shape',  c:'#d8a05f',
  bands:[{lo:405,ls:22,T:.34},{lo:505,ls:38,hi:1000,hs:220,T:.92}],
  same:'fitted to Hoya\u2019s own official 85/85B/85C chart \u2014 this has a genuine shoulder/plateau around 450-500nm before a second rise to a peak near 650nm, then a gentle decline. Mean error 3.2 percentage points'},
 {id:'c85b',g:'B4',n:'Wratten 85B',d:'5500K → 3200K · real double-rise shape', c:'#d8925a',
  bands:[{lo:405,ls:22,T:.29},{lo:505,ls:38,hi:1000,hs:220,T:.92}],
  same:'fitted to Hoya\u2019s own official chart \u2014 same double-rise shape as 85, slightly lower shoulder. Mean error 4.2 percentage points'},
 {id:'c85c',g:'B3',n:'Hoya 85C',d:'Mildest of the 85-series · real chart data', c:'#dea868',
  bands:[{lo:400,ls:22,T:.54},{lo:505,ls:38,hi:1000,hs:220,T:1.02}],
  same:'fitted to Hoya\u2019s own official 85/85B/85C chart \u2014 the mildest of the three, peaking ~90% near 650nm. Mean error 3.1 percentage points'},
 {id:'c81a',g:'B2',n:'Hoya 81A',d:'Mild warming · real chart, two-slope shape', c:'#d6b878',
  bands:[{lo:400,ls:60,T:.945}],
  same:'fitted to Hoya\u2019s own official 81A/81B/81C chart. The real curve rises fast then keeps climbing gently all the way to 750nm+ \u2014 a single sigmoid can\u2019t perfectly trace both slopes at once, mean error 8.6 percentage points, best treated as a reasonable approximation rather than a precision fit'},
 {id:'c81b',g:'B3',n:'Hoya 81B',d:'Mild warming · real chart, two-slope shape', c:'#d3b072',
  bands:[{lo:405,ls:63,T:.945}],
  same:'fitted to Hoya\u2019s own official chart, same two-slope limitation as 81A. Mean error 9.6 percentage points'},
 {id:'c81c',g:'B3',n:'Hoya 81C',d:'Mild warming · real chart, two-slope shape', c:'#cfa86c',
  bands:[{lo:410,ls:66,T:.955}],
  same:'fitted to Hoya\u2019s own official chart, same two-slope limitation. Mean error 13.3 percentage points \u2014 the weakest fit of the three since the real curve is flattest/most gradual'},

 /* ---- Colour filters ----
    THE important group for experimenting on a full-spectrum body. On a
    normal camera these are just blue/green/magenta. On a converted body
    the dye is transparent beyond ~700nm, so each one passes its colour
    PLUS a pile of infrared — which is what produces in-camera faux
    colour. A Wratten 47 deep blue this way is documented as giving a
    590nm-Goldie-like result straight out of camera.
    The Haisheng LB series added later in this group (search "LB1" etc.)
    is a genuinely different thing sharing this same category: real
    scientific colour-correction glass with no IR angle at all — included
    here because "Colour filters" is still the right home for them, not
    because they belong to the faux-colour technique described above. */
 /* ---- Kolari IR Chrome — a real named product, fitted to real measured data ----
    Unlike the generic Wratten/Lee colour gels above (fitted to one Y-transmission
    number, or not fitted at all), this one is fitted to an actual published
    spectrometer trace: Zach Van Rijn measured Kolari's IR Chrome and published
    full-spectrum transmission values, republished with attribution by
    truecolorinfrared.com. It's a fused dual-glass filter (blue glass + heat
    absorber), not a simple longpass — strong blue/violet, a deep trough
    through yellow-red, then a genuine secondary NIR bump peaking near 760nm
    before declining into deep IR. Fitted to 10 real data points across
    360–1000nm; max fitting error 4.4 percentage points. */
 {id:'kolarichrome',g:'B3',n:'Kolari IR Chrome',d:'Fused glass · real spectrometer data · no post-processing needed',c:'#5a7ad0',
  same:'REAL DATA \u2014 exact digitised curve, measured by Zach Van Rijn, published via truecolorinfrared.com. '
   +'Replaces a sigmoid fit that had already been built from this same measurement (peak 90-93% at 400-460nm, '
   +'6-10% through 550-700nm, a real secondary NIR bump peaking ~23% at 760nm, declining to ~7% by 1000nm) but '
   +'only as an approximation \u2014 now the exact per-10nm values, 350-1020nm. Below 350nm this measurement '
   +'doesn\u2019t reach; that portion still uses the old fit\u2019s own extrapolation, which was already built from '
   +'this same source rather than a fresh guess. Above 1020nm, held flat at the last real value. Designed to '
   +'give Aerochrome-style red foliage straight out of camera with no channel swap; Kolari\u2019s own documentation '
   +'notes Sony bodies specifically render foliage more orange than red with this filter, correctable with a '
   +'modest hue shift.'},
 {id:'kolariiridium',g:'B8',n:'Kolari Iridium',d:'R/G/B tri-pass \u00b7 fitted to Kolari\u2019s official chart',c:'#7a8fd6',
  bands:[{lo:381,ls:5,hi:486,hs:5,T:0.89},{lo:514,ls:4,hi:568,hs:4,T:0.96},{lo:606,ls:11,hi:1060,hs:45,T:0.96}],
  notch:[{c:950,w:20,d:0.60}],
  same:'fitted by hand to Kolari\u2019s own official published transmission chart (from kolarivision.com/what-is-iridium-filter) '
   +'\u2014 a genuinely complex real shape, not the simple estimate this entry started as: three distinct passbands (blue '
   +'380-486nm ~87%, green 514-568nm ~96%, and a wide red-through-NIR band from ~606nm ~90-98%) separated by two sharp, '
   +'near-total notches (bottoming under 5% around 495-510nm and 575-595nm) exactly matching Kolari\u2019s own description '
   +'of "blocking the in-between, ambiguous colors, allowing true reds, greens, and blues to shine through." The chart '
   +'also shows something unexpected this entry wouldn\u2019t have guessed: a third, deep notch around 950nm (dropping to '
   +'~39%) before recovering to a secondary peak near 985nm \u2014 modelled here as an explicit notch rather than assumed '
   +'away. Hand-read against ~16 points sampled off the chart, RMS ~7 percentage points \u2014 close, not pixel-exact, and '
   +'the chart itself is cut off at 1000nm with a declining trend right at that edge, so behaviour beyond 1000nm is '
   +'extrapolated, not shown. Important caveat that still stands even with this official chart in hand: a UVP forum '
   +'member who bought the physical filter titled their thread "Kolari\'s Iridium filter does not correspond to its '
   +'official transmission chart" after testing their own unit against a known reference (an Omega XB30) \u2014 so even '
   +'this chart, Kolari\u2019s own, may not perfectly represent what ships. On full-spectrum this gives a 720nm-class Wood '
   +'effect (white/near-white foliage, blue sky) without a channel swap, per Kolari and independent users (Dan '
   +'Wampler\u2019s blog)'},
 {id:'w47',g:'B3',n:'Wratten 47',  d:'Deep blue tricolour · real Kodak datasheet',  c:'#4f7ad8',
  same:'REAL DATA \u2014 exact digitised curve from Kodak\u2019s own modern "Wratten 2 Optical Filter / 47" datasheet '
   +'(diffuse density chart, converted to transmission via T=10^-D). Replaces a fitted approximation with the '
   +'exact curve \u2014 peaks ~46% around 420-450nm, closes through green/red, reopens with a real dye leak '
   +'starting a little earlier than previously assumed (~750nm rather than ~790nm), reaching ~92% by 900nm. '
   +'This closes out the whole Wratten 47 family in this file (47, 47A, 47B all now sourced).'},
 {id:'w47b',g:'B3',n:'Wratten 47B', d:'Darker blue · leaks some green',      c:'#4166c9',
  bands:[{lo:409.9,ls:9.44,hi:455.5,hs:10.68,T:.605},{lo:790,ls:30,T:.85}],leak:true},
 {id:'w47a',g:'B3',n:'Wratten 47A', d:'Light blue \u00b7 real Kodak datasheet',      c:'#5a8ee8',
  same:'REAL DATA \u2014 exact digitised curve from Kodak\u2019s own modern "Wratten 2 Optical Filter / 47A" datasheet '
   +'(diffuse density chart, converted to transmission via T=10^-D). New addition, not a duplicate of w47/w47b: '
   +'a genuinely distinct filter Kodak sells alongside those two \u2014 peaks higher in the blue (~60% around '
   +'450nm) than either, with the same real deep-red dye leak reopening past 750-800nm that this whole 47-'
   +'family shares.'},
 {id:'w38a',g:'B3',n:'Wratten 38A', d:'Blue · real Kodak datasheet',                      c:'#6389de',
  same:'REAL DATA \u2014 exact digitised curve from Kodak\u2019s own modern "Wratten 2 Optical Filter / 38A" datasheet '
   +'(diffuse density chart, converted to transmission via T=10^-D). Replaces a fitted approximation with the '
   +'exact curve \u2014 peaks ~56% around 450nm, closes through green/yellow/orange, and reopens with a real dye '
   +'leak past 750-800nm reaching ~86% by 900nm, similar in kind to the other blue Wrattens in this file.'},
 {id:'w58',g:'B5',n:'Wratten 58',  d:'Green tricolour · real Kodak datasheet',                     c:'#57b06a',
  same:'REAL DATA \u2014 exact digitised curve from Kodak\u2019s own modern "Wratten 2 Optical Filter / 58" datasheet '
   +'(diffuse density chart, converted to transmission via T=10^-D). Replaces a fitted approximation with the '
   +'exact curve \u2014 peaks in the green around 500-550nm, closes through red, reopens with a real dye leak past '
   +'750nm reaching ~87% by 900nm.'},
 {id:'w61',g:'B4',n:'Wratten 61',  d:'Deep green · real Kodak datasheet',                          c:'#46a05a',
  same:'REAL DATA \u2014 exact digitised curve from Kodak\u2019s own modern "Wratten 2 Optical Filter / 61" datasheet '
   +'(diffuse density chart, converted to transmission via T=10^-D). Replaces a fitted approximation with the '
   +'exact curve \u2014 similar shape family to w58 but shifted, peaking a little earlier in the green, same real '
   +'deep-red dye leak reopening past 750nm.'},
 {id:'w11',g:'B4',n:'Wratten 11',  d:'Yellow-green · official Kodak data, real bandpass',c:'#8fc059',
  bands:[{lo:476.5,ls:9.91,hi:552.1,hs:40.10,T:.848},{lo:790,ls:30,T:.85}],leak:true,
  same:'fitted to Eastman Kodak\u2019s own transmittance table \u2014 this is a genuine bandpass (peaks ~60% near 510-530nm, falls to a ~6% floor by 660-700nm), not the broader single-edge shape assumed earlier. Mean fitting error 4.1 percentage points against 24 real data points 420-700nm. Kodak table stops at 700nm so the further NIR rise past that point remains an inference from general dye-filter behaviour, consistent with the rest of this Colour group'},
 {id:'w32',g:'B3',n:'Wratten 32',  d:'Magenta · blue + red, minus green',   c:'#c96acc',
  bands:[{lo:429.8,ls:39.90,hi:481.0,hs:8.23,T:1.00},{lo:611.3,ls:5.11,T:.902},{lo:790,ls:30,T:.85}],leak:true},
 {id:'w34a',g:'B3',n:'Wratten 34A', d:'Violet · 410–470 + 660–700nm',        c:'#9b6ad0',
  bands:[{lo:419.6,ls:1.98,hi:462.2,hs:9.38,T:.731},{lo:650.5,ls:9.13,T:.888},{lo:790,ls:30,T:.85}],leak:true},
 {id:'w44a',g:'B3',n:'Wratten 44A', d:'Cyan · light blue-green',             c:'#5fb8c0',
  bands:[{lo:436.9,ls:9.56,hi:529.9,hs:11.72,T:.536},{lo:790,ls:30,T:.85}],leak:true},
 {id:'bw060',g:'B4',n:'B+W 060',     d:'Yellow-green, sustained into red \u00b7 real B+W chart',c:'#a8c060',
  bands:[{lo:465,ls:20,T:.92}],
  same:'REAL DATA (read from a chart) \u2014 B+W\u2019s own official transmission chart ("B&W Filters 060, 061, '
   +'080, 081, 090, 091", B+W Filter Handbook, p.35). New addition, completing a family we already partly '
   +'curate (061/090/091 already have real or evidence-based fits). 060 rises earlier and stays higher into '
   +'red than 061 does \u2014 the real chart shows a small dip and recovery around 600-650nm that this single-band '
   +'fit doesn\u2019t capture, similar in spirit to 061\u2019s own acknowledged simplification.'},
 {id:'bw061',g:'B4',n:'B+W 061',     d:'Green · for Aero Ektachrome IR',     c:'#4fa862',
  bands:[{lo:430,ls:20,hi:580,hs:30,T:.90},{lo:580,ls:30,T:.48}],leak:true,
  same:'REAL DATA (read from a chart) \u2014 B+W\u2019s own official transmission chart (from their printed filter '
   +'catalogue, "B&W Filters 060, 061, 080, 081, 090, 091", p.35). This is the first real source this entry has '
   +'ever had \u2014 it was previously an unsourced guess, and that guess was substantially wrong: the real curve '
   +'peaks around 80-82% near 480-500nm, not the ~62% previously assumed. It also doesn\u2019t close to near-zero '
   +'after its peak the way the old two-band model assumed (a peak, then a gap, then a separate reopening past '
   +'790nm) \u2014 the real curve declines more gradually and settles into a sustained ~45-48% plateau starting '
   +'around 600nm, which is what the leak:true tail now reflects. The chart itself only extends to ~750nm; '
   +'the assumption that this plateau continues beyond that is a reasonable extrapolation, not something '
   +'directly confirmed.'},

 /* ---- CC (Colour Correction) filters ----
    Real B+W chart data (B+W Filter Handbook, p.23) exists for four
    densities (05/10/20/40) each of Yellow/Red/Green/Blue -- 16 filters
    total. Added one representative density (20, a moderate strength)
    per colour rather than all 16, matching how this file already
    curates the Lee gel catalogue: real data exists for far more than
    what's included, picked for coverage rather than exhaustiveness. */
 {id:'cc20y',g:'B3',n:'CC20Y (B+W)',d:'Yellow colour-correction \u00b7 real B+W chart',c:'#d6c840',
  bands:[{lo:250,ls:10,hi:450,hs:30,T:.40},{lo:440,ls:20,T:.95}],
  same:'REAL DATA (read from a chart) \u2014 B+W\u2019s own official transmission chart ("CC Filters Yellow 05, '
   +'10, 20, 40", B+W Filter Handbook, p.23). Classic minus-blue shape: a real ~40% floor through the blue '
   +'region, rising to a ~95% plateau from roughly 480nm on. Only the 20-density variant is included; 05/10/40 '
   +'exist on the same real chart at proportionally shallower/deeper floors, not added here.'},
 {id:'cc20r',g:'B1',n:'CC20R (B+W)',d:'Red colour-correction \u00b7 real B+W chart',c:'#d66050',
  bands:[{lo:250,ls:20,hi:480,hs:60,T:.65},{lo:580,ls:30,T:.90}],
  same:'REAL DATA (read from a chart) \u2014 B+W\u2019s own official transmission chart ("CC Filters Red 05, 10, '
   +'20, 40", p.23). The real curve has a small local bump-and-dip shape through 450-600nm (a real feature of '
   +'this dye family, not a fitting artefact) that this two-band approximation smooths over \u2014 the overall '
   +'direction (moderate in blue/green, rising to a real ~90% plateau in deep red) is captured, the fine '
   +'structure in between is not.'},
 {id:'cc20g',g:'B4',n:'CC20G (B+W)',d:'Green colour-correction \u00b7 real B+W chart',c:'#7ac860',
  bands:[{lo:400,ls:40,hi:560,hs:80,T:.80}],
  same:'REAL DATA (read from a chart) \u2014 B+W\u2019s own official transmission chart ("CC Filters Green 05, '
   +'10, 20, 40", p.23). A real bandpass peaking around 500nm (~78% for this density), declining on both '
   +'sides \u2014 unlike the LB-series green glass elsewhere in this file, this declines to a moderate ~40% by '
   +'700nm rather than a sharp cutoff.'},
 {id:'cc20b',g:'B1',n:'CC20B (B+W)',d:'Blue colour-correction \u00b7 real B+W chart',c:'#7098d6',
  bands:[{lo:250,ls:10,hi:480,hs:60,T:.85}],
  same:'REAL DATA (read from a chart) \u2014 B+W\u2019s own official transmission chart ("CC Filters Blue 05, 10, '
   +'20, 40", p.23). High in blue/violet, declining through green into a moderate red plateau. The real curve '
   +'has a small secondary bump around 600nm that this single-band fit doesn\u2019t capture, similar in kind to '
   +'the CC20R simplification above.'},
 {id:'sch_vg9',g:'B5',n:'Schott VG9',d:'Green bandpass glass \u00b7 real Schott datasheet',c:'#6cae5c',
  same:'REAL DATA \u2014 Schott\u2019s own official VG9 datasheet (PDF), full internal transmittance table (10nm steps) '
   +'with the datasheet\u2019s own stated reflection factor (Pd=0.911) applied, 1mm reference. A genuine, distinct '
   +'green bandpass \u2014 different manufacturer and formulation from the Haisheng LB series elsewhere in this '
   +'group \u2014 peaking around 56% near 500nm and declining through red, staying low through most of the NIR '
   +'this tool models before a modest late rise approaching 1100nm.'},

 {id:'lee139',g:'B8',n:'Primary Green (Lee 139)',    d:'Green gel · real Lee Filters data',         c:'#3f9c55',
  bands:[{lo:505.4,ls:7.6,hi:550.4,hs:8.9,T:.39},{lo:700,ls:20,T:.35}],leak:true,
  same:'REFITTED to real Lee Filters transmission data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed, scraped from the LeeFilters website) \u2014 RMS 0.16 percentage points, essentially exact. Confirms this is a genuine narrowband bandpass (peak 39% at ~528nm, near-zero blue and red), not the broader/softer shape previously estimated. The NIR-leak figure is honest, not confident: the source dataset applies the same generic "~90% by 800nm" extrapolation to every Lee gel regardless of colour, which its own documentation admits is a rough assumption, not per-gel measurement \u2014 plausible for broad warming gels but less obviously true for a narrowband green dye. Lowered the leak estimate to 35% here rather than trust the blanket 90% for a filter this narrowband'},
 {id:'lee729',g:'B8',n:'Scuba Blue (Lee 729)',    d:'Blue gel · real Lee Filters data',            c:'#4f9fd0',
  bands:[{lo:484.9,ls:22.2,hi:513.0,hs:10.3,T:.81},{lo:700,ls:20,T:.35}],leak:true,
  same:'REFITTED to real Lee Filters transmission data (via CheeseCube312\u2019s Filter-Plotter-Data project) \u2014 RMS 0.66 percentage points. Real shape peaks at 81% around 495-500nm and falls to near-zero by 560nm, narrower and taller than previously estimated. Same NIR-leak caveat as Lee 139: the source\u2019s generic Lee-gel extrapolation isn\u2019t measured per-colour, so the leak figure here is a conservative guess (35%), not a confident number'},
 {id:'lee192',g:'B6',n:'Flesh Pink (Lee 192)',   d:'Pink gel \u00b7 real Lee Filters data \u00b7 strong NIR pass',c:'#FF8CB4',
  bands:[{lo:384.5,ls:5,hi:487,hs:30,T:.576},{lo:582,ls:10,T:.894}],leak:true,
  same:'REFITTED to real Lee Filters transmission data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 2.9 percentage points, worst single point 10.6pp. The shape is genuinely bimodal, not a simple gel curve: a blue-violet lobe (~58% peak near 420nm), a real notch through the green (down to ~15% at 520-560nm, the actual mechanism behind the pink appearance \u2014 removing green leaves red+blue), then a sharp rise from ~580nm to a strong, flat plateau around 89-90% that holds all the way through the measured range to 850nm. The one place a two-band model can\u2019t fully follow the real curve is a small secondary shoulder around 540-560nm (real data reads a few points higher there than the fit) \u2014 a minor, disclosed imperfection rather than a hidden one. Unlike some of the other Lee gels here, the NIR plateau is NOT the dataset\u2019s generic \u201c~90% by 800nm\u201d blanket extrapolation \u2014 this one has real measured points confirming close to that figure independently, so the strong NIR pass is measured behaviour, not an assumption'}
 ,
 {id:'lee035',g:'B6',n:'Light Pink (Lee 035)',    d:'Pink gel · real Lee Filters data',c:'#e8a0b8',
  bands:[{hi:577.6,hs:73.5,T:.78},{lo:565.9,ls:14.3,T:.90}],
  same:'REFITTED to real Lee Filters transmission data (via CheeseCube312\u2019s Filter-Plotter-Data project) \u2014 RMS 1.2 percentage points. The real curve is a genuine dip shape: elevated in blue (~68-70%), sagging through green (~44-51% around 540-560nm), then rising strongly through orange/red to ~90%+ \u2014 this is why it reads as pink rather than just neutral-dim. The recipe pairing with KG3 (GRB3 in this file) is sourced from community reports, not verified first-hand. The "Pink Aerochrome DIY" recipe button previously paired this with GRB1 (=KG2) instead of GRB3 (=KG3) — a mismatch against this filter\u2019s own documented pairing, fixed separately'},
 {id:'lee441',g:'B5',n:'Full CT Straw (Lee 441)',d:'Warm/yellow gel · real Lee Filters data',c:'#d8a050',
  bands:[{lo:522.3,ls:51.1,T:.91}],leak:true,
  same:'REFITTED to real Lee Filters transmission data (via CheeseCube312\u2019s Filter-Plotter-Data project) \u2014 RMS 4.6 percentage points. Real shape is a broad single rising edge, low in blue (~10-15%) climbing to ~85-93% by red \u2014 close to what the earlier Wratten-85B-based estimate assumed, now confirmed directly rather than borrowed from an unrelated filter. This is one of the two gels Hidden Realms confirmed for the "blue trees" technique, stacked with a MidOpt DB850. The author is explicit the result is camera-dependent: it worked on Nikon and a Canon 1000D, but a different tester on another Canon body got "more purple than blue" with a pink gel instead — this is not a settled one-size-fits-all recipe'},
 {id:'lee744',g:'B4',n:'Dirty White (Lee 744)',d:'Subtle warm gel · real Lee Filters data',c:'#d8c090',
  bands:[{lo:519.8,ls:56.2,T:.90}],leak:true,
  same:'REFITTED to real Lee Filters transmission data (via CheeseCube312\u2019s Filter-Plotter-Data project) \u2014 RMS 4.6 percentage points. Similar broad warming-edge shape to Lee 441, slightly gentler rise, matching its description as "an off white tungsten" correction. This is the SECOND of the two gels Hidden Realms names for the blue-trees technique; the author uses "Dirty White or Full CT Straw" interchangeably without stating which gives a better result \u2014 checked the NIR figure directly against the raw file too: every Lee gel in this dataset locks to an identical flat value from exactly 805nm on, the tell of one blanket extrapolation rather than per-gel measurement, but this gel\u2019s own genuinely-measured data already reaches 89.7% by 800nm, right at the committed 90% \u2014 well-supported, not a borrowed guess'},

 {id:'lee026',g:'B7',n:'Bright Red (Lee 26)',d:'Real Lee Filters data',c:'#E6003C',
  bands:[{lo:628.8,ls:19.83,T:0.88}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 4.12 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 checked directly against the raw file rather than trusted at face value: every Lee gel in this dataset locks to an identical flat value starting at exactly 805nm regardless of colour \u2014 that uniformity across otherwise-unrelated dyes is the tell that it\u2019s one blanket extrapolation, not per-gel measurement. This gel\u2019s own genuinely-measured data reaches 89.3% by 800nm, the last real point before the fabrication starts, which is close enough to the committed NIR figure above that it\u2019s a well-supported extrapolation rather than a borrowed guess, even though the deep-NIR figure itself remains formally unmeasured'},
 {id:'lee106',g:'B7',n:'Primary Red (Lee 106)',d:'Real Lee Filters data',c:'#F00032',
  bands:[{lo:618.1,ls:15.16,T:0.88}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 3.32 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 checked directly against the raw file rather than trusted at face value: every Lee gel in this dataset locks to an identical flat value starting at exactly 805nm regardless of colour \u2014 that uniformity across otherwise-unrelated dyes is the tell that it\u2019s one blanket extrapolation, not per-gel measurement. This gel\u2019s own genuinely-measured data reaches 89.6% by 800nm, the last real point before the fabrication starts, which is close enough to the committed NIR figure above that it\u2019s a well-supported extrapolation rather than a borrowed guess, even though the deep-NIR figure itself remains formally unmeasured'},
 {id:'lee101',g:'B5',n:'Yellow (Lee 101)',d:'Real Lee Filters data',c:'#FFF500',
  bands:[{lo:504.2,ls:12.42,T:0.89}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 1.76 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 checked directly against the raw file rather than trusted at face value: every Lee gel in this dataset locks to an identical flat value starting at exactly 805nm regardless of colour \u2014 that uniformity across otherwise-unrelated dyes is the tell that it\u2019s one blanket extrapolation, not per-gel measurement. This gel\u2019s own genuinely-measured data reaches 90.1% by 800nm, the last real point before the fabrication starts, which is close enough to the committed NIR figure above that it\u2019s a well-supported extrapolation rather than a borrowed guess, even though the deep-NIR figure itself remains formally unmeasured'},
 {id:'lee010',g:'B4',n:'Medium Yellow (Lee 10)',d:'Real Lee Filters data',c:'#FFFF00',
  bands:[{lo:490.0,ls:6.33,T:0.90}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 1.31 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 same shared caveat as the original five: the source applies a generic "rises to ~90% by 800nm" NIR extrapolation to every Lee gel regardless of colour, not measured per-gel, so treat the visible-band shape as the well-fitted part and the deep-NIR leak as a reasonable but unverified assumption'},
 {id:'lee105',g:'B6',n:'Orange (Lee 105)',d:'Real Lee Filters data',c:'#FFA000',
  bands:[{lo:560.2,ls:11.66,T:0.89}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 2.11 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 checked directly against the raw file rather than trusted at face value: every Lee gel in this dataset locks to an identical flat value starting at exactly 805nm regardless of colour \u2014 that uniformity across otherwise-unrelated dyes is the tell that it\u2019s one blanket extrapolation, not per-gel measurement. This gel\u2019s own genuinely-measured data reaches 89.9% by 800nm, the last real point before the fabrication starts, which is close enough to the committed NIR figure above that it\u2019s a well-supported extrapolation rather than a borrowed guess, even though the deep-NIR figure itself remains formally unmeasured'},
 {id:'lee158',g:'B6',n:'Deep Orange (Lee 158)',d:'Real Lee Filters data',c:'#FF8700',
  bands:[{lo:573.5,ls:16.60,T:0.89}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 1.99 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 checked directly against the raw file rather than trusted at face value: every Lee gel in this dataset locks to an identical flat value starting at exactly 805nm regardless of colour \u2014 that uniformity across otherwise-unrelated dyes is the tell that it\u2019s one blanket extrapolation, not per-gel measurement. This gel\u2019s own genuinely-measured data reaches 89.8% by 800nm, the last real point before the fabrication starts, which is close enough to the committed NIR figure above that it\u2019s a well-supported extrapolation rather than a borrowed guess, even though the deep-NIR figure itself remains formally unmeasured'},
 {id:'lee020',g:'B5',n:'Medium Amber (Lee 20)',d:'Real Lee Filters data',c:'#FFBE55',
  bands:[{lo:550.0,ls:23.61,T:0.89}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 4.06 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 same shared caveat as the original five: the source applies a generic "rises to ~90% by 800nm" NIR extrapolation to every Lee gel regardless of colour, not measured per-gel, so treat the visible-band shape as the well-fitted part and the deep-NIR leak as a reasonable but unverified assumption'},
 {id:'lee022',g:'B6',n:'Dark Amber (Lee 22)',d:'Real Lee Filters data',c:'#FF6900',
  bands:[{lo:587.5,ls:10.75,T:0.88}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 2.33 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 same shared caveat as the original five: the source applies a generic "rises to ~90% by 800nm" NIR extrapolation to every Lee gel regardless of colour, not measured per-gel, so treat the visible-band shape as the well-fitted part and the deep-NIR leak as a reasonable but unverified assumption'},
 {id:'lee113',g:'B7',n:'Magenta (Lee 113)',d:'Real Lee Filters data',c:'#FF0064',
  bands:[{hi:466.8,hs:8.54,T:0.09},{lo:611.5,ls:9.86,T:0.89}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 1.94 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 checked directly against the raw file rather than trusted at face value: every Lee gel in this dataset locks to an identical flat value starting at exactly 805nm regardless of colour \u2014 that uniformity across otherwise-unrelated dyes is the tell that it\u2019s one blanket extrapolation, not per-gel measurement. This gel\u2019s own genuinely-measured data reaches 90.0% by 800nm, the last real point before the fabrication starts, which is close enough to the committed NIR figure above that it\u2019s a well-supported extrapolation rather than a borrowed guess, even though the deep-NIR figure itself remains formally unmeasured'},
 {id:'lee046',g:'B7',n:'Dark Magenta (Lee 46)',d:'Real Lee Filters data',c:'#DC005A',
  bands:[{hi:475.3,hs:22.54,T:0.07},{lo:639.6,ls:19.39,T:0.90}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 1.85 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 same shared caveat as the original five: the source applies a generic "rises to ~90% by 800nm" NIR extrapolation to every Lee gel regardless of colour, not measured per-gel, so treat the visible-band shape as the well-fitted part and the deep-NIR leak as a reasonable but unverified assumption'},
 {id:'lee049',g:'B7',n:'Medium Purple (Lee 49)',d:'Real Lee Filters data',c:'#BE0091',
  bands:[{hi:474.6,hs:11.47,T:0.31},{lo:649.6,ls:14.08,T:0.90}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 2.00 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 same shared caveat as the original five: the source applies a generic "rises to ~90% by 800nm" NIR extrapolation to every Lee gel regardless of colour, not measured per-gel, so treat the visible-band shape as the well-fitted part and the deep-NIR leak as a reasonable but unverified assumption'},
 {id:'lee120',g:'B8',n:'Deep Blue (Lee 120)',d:'Real Lee Filters data',c:'#005FBE',
  bands:[{hi:492.0,hs:6.51,T:0.27},{lo:716,ls:14,T:.840}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 4.31 percentage points on the visible band. NIR leak band REPLACED \u2014 previously trusted the dataset\u2019s blunt flat-90% splice directly. Refit to ONLY the genuine measured points (685-805nm, excluding the dataset\u2019s artificial flat-90.0% tail that starts at exactly 805nm on every single Lee gel with no exception \u2014 that uniformity is itself the tell it\u2019s one blanket extrapolation, not per-gel measurement). RMS 2.87 percentage points on the real edge alone. The real curve reaches 86% by 800nm and is still rising, so a logistic fitted honestly to just that real shape lands at a lower, more defensible plateau than the dataset\u2019s assumed 90% \u2014 not dramatically lower, but earned from the actual measured edge rather than trusted at face value.'},
 {id:'lee132',g:'B3',n:'Medium Blue (Lee 132)',d:'Real Lee Filters data',c:'#00A0DC',
  bands:[{hi:515.3,hs:11.79,T:0.49},{lo:716,ls:15,T:.850}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 4.28 percentage points on the visible band. NIR leak band REPLACED \u2014 previously trusted the dataset\u2019s blunt flat-90% splice directly. Refit to ONLY the genuine measured points (685-805nm, excluding the dataset\u2019s artificial flat-90.0% tail that starts at exactly 805nm on every single Lee gel with no exception \u2014 that uniformity is itself the tell it\u2019s one blanket extrapolation, not per-gel measurement). RMS 2.69 percentage points on the real edge alone. The real curve reaches 86% by 800nm and is still rising, so a logistic fitted honestly to just that real shape lands at a lower, more defensible plateau than the dataset\u2019s assumed 90% \u2014 not dramatically lower, but earned from the actual measured edge rather than trusted at face value.'},
 {id:'lee036',g:'B6',n:'Medium Pink (Lee 36)',d:'Real Lee Filters data',c:'#FFA0B9',
  bands:[{hi:486.5,hs:72.37,T:0.82},{lo:577.7,ls:12.02,T:0.89}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 1.60 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 same shared caveat as the original five: the source applies a generic "rises to ~90% by 800nm" NIR extrapolation to every Lee gel regardless of colour, not measured per-gel, so treat the visible-band shape as the well-fitted part and the deep-NIR leak as a reasonable but unverified assumption'},
 {id:'lee119',g:'B3',n:'Dark Blue (Lee 119)',d:'Real Lee Filters data',c:'#0078C8',
  bands:[{lo:421.7,ls:14.41,hi:487.8,hs:15.73,T:0.58},{lo:719,ls:13,T:.830}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 1.85 percentage points on the visible band. NIR leak band ADDED — this gel previously had no NIR leak band at all, reporting zero infrared transmission past the visible bump, which was flatly wrong. Refit to ONLY the genuine measured points (685-805nm, excluding the dataset\u2019s artificial flat-90.0% tail that starts at exactly 805nm on every single Lee gel with no exception \u2014 that uniformity is itself the tell it\u2019s one blanket extrapolation, not per-gel measurement). RMS 3.01 percentage points on the real edge alone. The real curve reaches 86% by 800nm and is still rising, so a logistic fitted honestly to just that real shape lands at a lower, more defensible plateau than the dataset\u2019s assumed 90% \u2014 not dramatically lower, but earned from the actual measured edge rather than trusted at face value.'},
 {id:'lee141',g:'B3',n:'Bright Blue (Lee 141)',d:'Real Lee Filters data',c:'#00D2E6',
  bands:[{lo:408.9,ls:15.51,hi:522.0,hs:18.33,T:0.80},{lo:722,ls:13,T:.830}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 1.26 percentage points on the visible band. NIR leak band ADDED — this gel previously had no NIR leak band at all, reporting zero infrared transmission past the visible bump, which was flatly wrong. Refit to ONLY the genuine measured points (685-805nm, excluding the dataset\u2019s artificial flat-90.0% tail that starts at exactly 805nm on every single Lee gel with no exception \u2014 that uniformity is itself the tell it\u2019s one blanket extrapolation, not per-gel measurement). RMS 3.64 percentage points on the real edge alone. The real curve reaches 86% by 800nm and is still rising, so a logistic fitted honestly to just that real shape lands at a lower, more defensible plateau than the dataset\u2019s assumed 90% \u2014 not dramatically lower, but earned from the actual measured edge rather than trusted at face value.'},
 {id:'lee124',g:'B4',n:'Dark Green (Lee 124)',d:'Real Lee Filters data',c:'#00DC78',
  bands:[{lo:482.8,ls:7.98,hi:551.1,hs:13.60,T:0.75},{lo:723,ls:13,T:.830}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 1.07 percentage points on the visible band. NIR leak band ADDED — this gel previously had no NIR leak band at all, reporting zero infrared transmission past the visible bump, which was flatly wrong. Refit to ONLY the genuine measured points (685-805nm, excluding the dataset\u2019s artificial flat-90.0% tail that starts at exactly 805nm on every single Lee gel with no exception \u2014 that uniformity is itself the tell it\u2019s one blanket extrapolation, not per-gel measurement). RMS 3.79 percentage points on the real edge alone. The real curve reaches 86% by 800nm and is still rising, so a logistic fitted honestly to just that real shape lands at a lower, more defensible plateau than the dataset\u2019s assumed 90% \u2014 not dramatically lower, but earned from the actual measured edge rather than trusted at face value.'},
 {id:'lee088',g:'B4',n:'Lime Green (Lee 88)',d:'Real Lee Filters data',c:'#DCFF64',
  bands:[{lo:479.6,ls:6.61,hi:629.6,hs:59.56,T:1.00},{lo:687.2,ls:20.13,T:0.90}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 2.50 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 same shared caveat as the original five: the source applies a generic "rises to ~90% by 800nm" NIR extrapolation to every Lee gel regardless of colour, not measured per-gel, so treat the visible-band shape as the well-fitted part and the deep-NIR leak as a reasonable but unverified assumption'},
 {id:'lee122',g:'B4',n:'Fern Green (Lee 122)',d:'Real Lee Filters data',c:'#78FA6E',
  bands:[{lo:481.3,ls:9.46,hi:566.1,hs:29.16,T:1.00},{lo:713.8,ls:17.97,T:0.89}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 2.54 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 checked directly against the raw file rather than trusted at face value: every Lee gel in this dataset locks to an identical flat value starting at exactly 805nm regardless of colour \u2014 that uniformity across otherwise-unrelated dyes is the tell that it\u2019s one blanket extrapolation, not per-gel measurement. This gel\u2019s own genuinely-measured data reaches 86.9% by 800nm, the last real point before the fabrication starts, which is close enough to the committed NIR figure above that it\u2019s a well-supported extrapolation rather than a borrowed guess, even though the deep-NIR figure itself remains formally unmeasured'},
 {id:'lee121',g:'B4',n:'LEE Green (Lee 121)',d:'Real Lee Filters data',c:'#B4FF64',
  bands:[{lo:482.5,ls:8.09,hi:586.4,hs:39.43,T:1.00},{lo:709.4,ls:18.17,T:0.89}],leak:true,
  same:'fit to real Lee Filters data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 2.34 percentage points. Part of a curated ~20-gel expansion beyond the handful with documented DIY recipes, picked for saturated colour rather than any specific known technique \u2014 checked directly against the raw file rather than trusted at face value: every Lee gel in this dataset locks to an identical flat value starting at exactly 805nm regardless of colour \u2014 that uniformity across otherwise-unrelated dyes is the tell that it\u2019s one blanket extrapolation, not per-gel measurement. This gel\u2019s own genuinely-measured data reaches 87.3% by 800nm, the last real point before the fabrication starts, which is close enough to the committed NIR figure above that it\u2019s a well-supported extrapolation rather than a borrowed guess, even though the deep-NIR figure itself remains formally unmeasured'},

 /* ---- Nantong Haisheng Optical "LB" green colour glass series ----
    Real manufacturer datasheet data (haishengoptical.com), each with a
    published spec table (exact %T at named wavelengths -- used directly
    as fit anchors below) plus a plotted transmission chart (200-2500nm --
    only the 300-1100nm portion is modelled here, this tool's own range).
    The table VALUES are real; the CURVE SHAPE between and around them is
    this file's own sigmoid fit read from the published chart, not a
    point-by-point digitisation -- same honesty standard as every other
    "read from a chart" entry elsewhere in this file. These are colour-
    correction/enhancement glass, not IR-photography filters specifically,
    included for completeness now that real spec data exists for them. */
 {id:'lb1',g:'B4',n:'Haisheng LB1',d:'Narrow green bandpass \u00b7 real datasheet',c:'#7fd66a',
  bands:[{lo:480,ls:10,hi:600,hs:15,T:.48},{lo:1050,ls:60,T:.75}],
  same:'REAL DATA (table points) AND real chart shape \u2014 Haisheng Optical LB1 datasheet (haishengoptical.com). '
   +'Published spec: \u22640.4% at 430nm, \u226541.9% at 530nm, \u22643.2% at 650nm. CORRECTED to add a second real rise '
   +'the published chart shows starting around 900-1000nm and continuing to climb well past this tool\u2019s '
   +'1100nm ceiling \u2014 an earlier version only modelled the visible-range bandpass and stopped at zero beyond '
   +'it, missing that real structure entirely (the same mistake found and fixed on LB16). The exact height/'
   +'timing of this rise is a rough read from the chart, not a tight fit.'},
 {id:'lb2',g:'B9',n:'Haisheng LB2',d:'Narrow green bandpass, lower peak \u00b7 real datasheet',c:'#6bcf5a',
  bands:[{lo:480,ls:10,hi:600,hs:15,T:.22},{lo:1050,ls:60,T:.65}],
  same:'REAL DATA (table points) AND real chart shape \u2014 Haisheng Optical LB2 datasheet (haishengoptical.com). '
   +'Published spec: \u22640.2% at 450nm, \u226518.3% at 530nm, \u22640.2% at 650nm. Same shape family as LB1, at a '
   +'lower peak transmission. CORRECTED to include the same real rise past 900-1000nm that LB1 has, missed '
   +'in an earlier version \u2014 rough read from the chart, same caveat as LB1.'},
 {id:'lb3',g:'B2',n:'Haisheng LB3',d:'Violet + green double-pass \u00b7 real datasheet',c:'#7ad0a0',
  bands:[{lo:340,ls:15,hi:445,hs:22,T:.55},{lo:455,ls:22,hi:580,hs:15,T:.48},{lo:1050,ls:60,T:.78}],
  same:'REAL DATA (table points) AND real chart shape \u2014 Haisheng Optical LB3 datasheet (haishengoptical.com). '
   +'Published spec: 15.2\u201329.0% at 450nm (the dip between the two passbands), \u226540.0% at 520nm, \u22641.7% at '
   +'650nm. The violet-band peak (~380nm) is read from the published chart, not independently measured. '
   +'CORRECTED to add the same real rise past 900-1000nm found across this whole series, missed in an '
   +'earlier version \u2014 rough read from the chart, not a tight fit.'},
 {id:'lb4',g:'B5',n:'Haisheng LB4',d:'Violet + green double-pass, lower peak \u00b7 real datasheet',c:'#69c98f',
  bands:[{lo:340,ls:15,hi:420,hs:15,T:.30},{lo:480,ls:12,hi:580,hs:12,T:.35},{lo:1050,ls:60,T:.35}],
  same:'REAL DATA (table points) AND real chart shape \u2014 Haisheng Optical LB4 datasheet (haishengoptical.com). '
   +'Published spec: 6.0\u201315.9% at 450nm, \u226524.1% at 520nm, \u22640.2% at 650nm. Same double-pass shape as LB3, '
   +'thinner/lower-transmission version, including the same corrected real rise past 900-1000nm.'},
 {id:'lb6',g:'B5',n:'Haisheng LB6',d:'Broad green hump \u00b7 real datasheet',c:'#5cb85c',
  bands:[{lo:460,ls:25,hi:640,hs:35,T:.85},{lo:1060,ls:140,T:.80}],
  same:'REAL DATA (table points) AND real chart shape \u2014 Haisheng Optical LB6 datasheet (haishengoptical.com). '
   +'Published spec: 41.7\u201350.1% at 460nm, \u226579.4% at 560nm, 25.1\u201333.1% at 660nm \u2014 this fit lands at 42%, '
   +'75.7% and 29.9% at those three points respectively. CORRECTED TWICE now: first to add a missing third '
   +'hump at all, then re-timed against a clearer, dedicated single-filter chart that pins the trough at '
   +'~14-15% around 850nm and the real second peak at ~79% around 1600nm \u2014 the earlier correction had that '
   +'second peak arriving far too early (~950nm), overshooting to ~72% by 1100nm when the real filter is only '
   +'partway through a slow ~750nm-wide climb at that point.'},
 {id:'lb7',g:'B5',n:'Haisheng LB7',d:'Narrow green bandpass, steep sides \u00b7 real datasheet',c:'#4fae4f',
  bands:[{lo:505,ls:12,hi:580,hs:12,T:.40},{lo:1180,ls:140,T:.48}],
  same:'REAL DATA (table points) AND real chart shape \u2014 Haisheng Optical LB7 datasheet (haishengoptical.com). '
   +'Published spec: \u22648.0% at 480nm, 32.0\u201345.0% at 545nm (peak), \u22648.0% at 620nm \u2014 a tight, steep-sided '
   +'passband, one of the narrowest in this series. CORRECTED to add a real second hump the published chart '
   +'shows, previously missed entirely: a deep near-zero trough through roughly 650-800nm, then a slow, '
   +'gradual rise reaching a second peak around 1600nm of similar height to the first \u2014 by this tool\u2019s '
   +'1100nm ceiling the real filter is still only partway through that climb, not fully risen.'},
 {id:'lb8',g:'B6',n:'Haisheng LB8',d:'Green long-pass, broad plateau \u00b7 real datasheet',c:'#6fc47a',
  bands:[{lo:580,ls:70,T:.78}],
  same:'REAL DATA (table points), fitted shape \u2014 Haisheng Optical LB8 datasheet (haishengoptical.com). '
   +'Published spec: \u22641.3% at 420nm, 30.3\u201343.9% at 560nm, 25.2\u201340.0% at 640nm \u2014 with 560 and 640 nearly '
   +'the same, the real curve is closer to a shallow plateau than a plain rising edge, which a single sigmoid '
   +'can only approximate; treat the shape between and beyond these three points as rougher than most entries '
   +'in this series, not a tight fit.'},
 {id:'lb9',g:'B3',n:'Haisheng LB9',d:'Green long-pass, high plateau \u00b7 real datasheet',c:'#8fd68f',
  bands:[{lo:440,ls:15,hi:700,hs:50,T:.87},{lo:900,ls:60,T:.88}],
  same:'REAL DATA (table points) AND real chart shape \u2014 Haisheng Optical LB9 datasheet (haishengoptical.com). '
   +'Published spec: \u22642.0% at 400nm, \u226582.0% at 550nm, 65.0\u201370.0% at 650nm. CORRECTED: an earlier version '
   +'closed too aggressively and had fallen to ~2% by 1100nm, where the real published chart actually shows a '
   +'SUSTAINED HIGH PLATEAU (~85-90%, essentially flat) all the way through this range \u2014 the opposite of what '
   +'the old fit did. Now modelled as a moderate dip around 650-700nm followed by a real second rise back up, '
   +'not a simple decline to zero.'},
 {id:'lb10',g:'B3',n:'Haisheng LB10',d:'Green long-pass, moderate plateau \u00b7 real datasheet',c:'#a0d6a0',
  bands:[{lo:440,ls:6,hi:700,hs:50,T:.76},{lo:900,ls:60,T:.80}],
  same:'REAL DATA (table points) AND real chart shape \u2014 Haisheng Optical LB10 datasheet (haishengoptical.com). '
   +'Published spec: \u22641.0% at 420nm, \u226572.0% at 550nm, 50.0\u201360.0% at 650nm. Same corrected sustained-'
   +'plateau family as LB9, at a lower level \u2014 same mistake, same fix.'},
 {id:'lb16',g:'B1',n:'Haisheng LB16',d:'Triple-hump green \u00b7 real datasheet',c:'#5ec48a',
  same:'REAL DATA \u2014 exact digitised curve, not a chart-read fit. Haisheng and Tangsinuo turn out to sell the '
   +'identical glass under the same model numbers: CheeseCube312\u2019s Filter-Plotter-Data project has Tangsinuo\u2019s '
   +'own LB16 chart, and it matches Haisheng\u2019s published table exactly (13.5% at 460nm, 83.7% at 560nm, 38.0% '
   +'at 660nm, against Haisheng\u2019s spec of 9.0-16.0/\u226583.6/35.0-42.0). Replaces an earlier three-band fit that '
   +'was itself already a real correction (adding a third hump the original single-band version missed '
   +'entirely) \u2014 this is a further precision upgrade to the exact curve, same triple-hump shape, now to actual '
   +'digitised points rather than a read-off approximation. Data covers to ~1010nm; held flat from there to '
   +'this tool\u2019s 1100nm ceiling.'},
 {id:'lb17',g:'B5',n:'Haisheng LB17',d:'Green bandpass, moderate red falloff \u00b7 real datasheet',c:'#4a9d6e',
  same:'REAL DATA \u2014 exact digitised curve, not a chart-read fit. Same Tangsinuo/Haisheng identity as LB16 '
   +'(see its note) \u2014 Tangsinuo\u2019s own LB17 chart matches Haisheng\u2019s published spec closely (62.5% at 510nm '
   +'against \u226568.0% at 530nm, 44.1% at 600nm against \u226446.0%, 15.5% at 750nm against \u226420.1%). Replaces a '
   +'fit that had itself already been corrected once (adding back a real second rise this entry had wrongly '
   +'excluded) \u2014 this is a further upgrade to the exact curve. Data covers to ~1005nm; held flat from there '
   +'to 1100nm.'},
 {id:'lb18',g:'B5',n:'Haisheng LB18',d:'Green bandpass, steep red falloff \u00b7 real datasheet',c:'#3f8f63',
  same:'REAL DATA \u2014 exact digitised curve, not a chart-read fit. Same Tangsinuo/Haisheng identity as LB16/LB17 '
   +'\u2014 Tangsinuo\u2019s own LB18 chart matches Haisheng\u2019s published spec closely (32.8% at 450nm against \u226432.8%, '
   +'63.7% at 520nm against \u226562.8%, 16.4% at 600nm against \u226418.5%, 1.5% at 750nm against \u22642.1%). Replaces '
   +'a fit that had itself already been corrected once, same story as LB17. Data covers to ~1000nm; held flat '
   +'from there to 1100nm.'},
 {id:'lb19',g:'B5',n:'Haisheng LB19',d:'Very narrow, low-transmission green notch \u00b7 real datasheet',c:'#b8e6a0',
  same:'REAL DATA \u2014 exact digitised curve, not a chart-read fit. Same Tangsinuo/Haisheng identity as the rest '
   +'of this series \u2014 Tangsinuo\u2019s own LB19 chart matches Haisheng\u2019s published spec (2.3% at 460nm against '
   +'\u22643.0%, 5.9% at 510nm against a 6.0-10.0% peak spec, 0.8% at 560nm against \u22642.5%) \u2014 the faintest filter '
   +'in this whole series, barely a colour cast rather than a real bandpass. Data covers to ~1000nm; held flat '
   +'from there to 1100nm.'},

 /* ---- MidOpt multi-bandpass (machine-vision interference filters) ----
    Dielectric coatings, not dyes, so the passbands are sharp and there is no
    dye IR leak — what you see is all you get. The names encode the bands:
    DB550/850 passes a green band AND an 850nm NIR band, nothing between.
    These land visible and NIR into separate channels deliberately, which is
    the industrial version of what full-spectrum shooters do by accident. */
 {id:'db395',g:'B2',n:'DB395/870',d:'UV/violet + 870nm NIR',c:'#8f6ad8',type:'interference',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from MidOpt\u2019s own DB395/870 chart, replacing an undocumented sigmoid fit.'},
 {id:'db475',g:'B9',n:'DB475/850',d:'Blue + 850nm NIR',c:'#5f86d8',type:'interference',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from MidOpt\u2019s own DB475/850 chart, replacing an undocumented sigmoid fit.'},
 {id:'db550',g:'B9',n:'DB550/850',d:'Green + 850nm NIR',c:'#5fb87a',type:'interference',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from MidOpt\u2019s own DB550/850 chart, replacing an undocumented sigmoid fit.'},
 {id:'db660',g:'B7',n:'DB660/850',d:'Red + 850nm NIR',c:'#d0563f',type:'interference',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from MidOpt\u2019s own DB660/850 chart, replacing an undocumented sigmoid fit.'},
 {id:'db735',g:'B5',n:'DB735',d:'Full visible + 735nm NIR',c:'#c08a4f',type:'interference',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from MidOpt\u2019s own DB735 chart, replacing an undocumented sigmoid fit.'},
 {id:'db830',g:'B2',n:'DB830',d:'Full visible + 830nm NIR \u00b7 keeps the deep red edge',c:'#c98a5f',
  bands:[{lo:372.7,ls:1.23,hi:673.1,hs:4.04,T:.935},{lo:805.6,ls:3.17,hi:847.1,hs:5.15,T:.928}],type:'interference',
  same:'Traced from a measured single-filter plot supplied by Fedia, not a MidOpt datasheet \u2014 the filter is not listed on their public site. Read off the curve: visible band 50 percent points at 372.7 and 673.1nm with a 93.5 percent plateau, NIR band 805.6 to 847.1nm peaking 92.8 percent at 820nm, nothing measurable beyond 900nm. The visible cut sits 28nm further into the red than DB850\u2019s 645nm, which is the whole reason to choose it: more red channel to push the white balance toward blue.'},
 {id:'db850',g:'B6',n:'DB850',d:'Full visible + 850nm NIR · Hidden Realms blue trees',c:'#c9975f',type:'interference',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from MidOpt\u2019s own DB850 chart. '
   +'Replaces an undocumented sigmoid fit that, checked against this real curve, turned out already close (within a '
   +'few points across the passband) \u2014 this is a precision upgrade to the exact real numbers, not a correction of '
   +'a wrong one. Still the filter behind Hidden Realms\u2019 documented "blue trees" technique, stacked with either a '
   +'Lee 441 Full CT Straw or a Lee 744 Dirty White gel — the author uses the two interchangeably in the source'},
 {id:'tb550',g:'B9',n:'TB550/660/850',d:'Green+Red+NIR · NDVI/CVI',c:'#c9a04f',type:'interference',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from MidOpt\u2019s own TB550/660/850 chart, replacing an undocumented sigmoid fit.'},
 {id:'tb475',g:'B9',n:'TB475/550/850',d:'Blue+Green+NIR · ENDVI',c:'#6f9fb8',type:'interference',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from MidOpt\u2019s own TB475/550/850 chart, replacing an undocumented sigmoid fit.'},
 {id:'nf550',g:'B2',n:'NF550',d:'Magenta dichroic · green block, passes blue+red',c:'#c060a8',type:'interference',
  same:'REAL DATA \u2014 CheeseCube312\u2019s Filter-Plotter-Data project, digitised from MidOpt\u2019s own NF550 chart. '
   +'Replaces a sigmoid+notch fit that had been checked against MidOpt\u2019s two published cutoff-threshold points '
   +'(~49% at 480nm and 590nm) and matched those \u2014 but the real full curve tells a different story: 32% at '
   +'480nm and 63% at 590nm, a real 14-17 percentage point gap. The nominal spec points describe where the curve '
   +'crosses 50%, roughly, at \u00b110nm tolerance \u2014 not the actual shape between and around them, which is what '
   +'this real curve now provides directly.'},

 /* ---- Generic multi-bandpass, non-MidOpt suppliers ----
    Same dielectric-interference principle as the MidOpt series above, but
    sold directly by smaller optics shops without a house brand name — the
    part number IS the spec sheet. */
 {id:'qb425',g:'B5',n:'Quad-Band 425/525/660/815',d:'HBP quad-band \u00b7 tuned to sodium-lamp emission lines',c:'#8f6ab0',
  bands:[{lo:410,ls:3,hi:440,hs:3,T:.85},{lo:508,ls:3,hi:542,hs:3,T:.92},{lo:648,ls:2.5,hi:672,hs:2.5,T:.76},
   {lo:795,ls:3,hi:830,hs:3,T:.90},{lo:1015,ls:3,hi:1045,hs:3,T:.85},{lo:1080,ls:30,hi:1250,hs:40,T:.55}],
  same:'read directly off the manufacturer\u2019s own printed spec card (rapidspectra, eBay listing, part number '
   +'425-525-660-815QB, HBP round 49.8mm, 2mm thick) \u2014 four sharp named passbands at 425/525/660/815nm as printed, '
   +'plus a fifth sharp \u224885% spike near 1030nm and a broader rippled hump out to 1300nm that the chart clearly shows '
   +'but the part number doesn\u2019t name \u2014 likely coating ringing rather than a designed band, kept here as a rough '
   +'simplified plateau since it\u2019s real measured behaviour of this glass even if imprecise from a photo. Most silicon '
   +'sensors lose sensitivity well before 1100nm, so that trailing region matters far less in practice than the four '
   +'named bands. REAL-WORLD CONTEXT (ultravioletphotography.com, "Spectacular nighttime imagery" thread, July 2026): '
   +'a forum member overlaid this filter\u2019s own transmission curve against a real high-pressure sodium vapour lamp '
   +'emission spectrum and found the four passbands line up closely with four of the lamp\u2019s actual emission lines \u2014 '
   +'notably the 815nm band matching sodium\u2019s own 818-819nm IR line \u2014 while the gaps between bands fall right where '
   +'sodium\u2019s dominant ~568nm yellow line sits, excluding it. Whether that\u2019s deliberate design or a fortunate '
   +'coincidence is unconfirmed, but it explains the effect a separate poster (Christoph, "Heatwaves" project) '
   +'reported shooting with this filter: sodium street-lighting reads as purple/magenta (from that matched IR line), '
   +'while LEDs and most other sources read green, giving a distinctive night palette. That poster also paired this '
   +'filter with GRB1 as an IR-reducer \u2014 a real independent confirmation of GRB1/KG2\u2019s role as an attenuator '
   +'stacked alongside another filter, matching how it\u2019s documented elsewhere in this file'},
 {id:'xb29',g:'B5',n:'SpectraPlus XB29',d:'Omega Optical \u00b7 triple-bandpass colour enhancer for digital sensors',c:'#9b7fc4',type:'interference',
  bands:[{lo:400,ls:3,hi:412,hs:3,T:.35},{lo:428,ls:5,hi:488,hs:4,T:.80},{lo:500,ls:5,hi:578,hs:4,T:.83},{lo:622,ls:6,hi:715,hs:8,T:.82}],
  same:'UPGRADED from a text-only approximation to a real chart read \u2014 Omega Optical\u2019s own SpectraPlus XB29 '
   +'flyer includes an actual "Spectral Performance" curve (350-750nm), which a previous version of this entry '
   +'didn\u2019t have access to and built purely from the flyer\u2019s prose ("centered at 490nm and 600nm") instead. '
   +'The real chart shows something the text doesn\u2019t capture: each of the three passbands is genuinely '
   +'rippled, not flat, swinging roughly 60-88% within each band rather than sitting at one clean level \u2014 '
   +'typical dielectric interference coating behaviour. Also a real, narrow UV leak spike around 405nm '
   +'(~35% peak) that the text\u2019s "complete attenuation... up to 430nm" doesn\u2019t mention. Modelled here as the '
   +'envelope of the ripples (representative ~80% mid-band value) rather than each individual ripple. The '
   +'chart itself only extends to 750nm; behaviour from 750-1100nm is NOT shown on it \u2014 held near zero based '
   +'on the flyer\u2019s text claim of "a high degree of attenuation in the near infrared region, from 750nm to '
   +'1100nm," which is a stated claim, not something this chart confirms directly. REAL DATA now added \u2014 the '
   +'full rippled curve digitised by eye onto a 10nm grid (finer near the passband ripples and band edges), '
   +'replacing the flat-envelope band-fit above; held at 0 past 735nm per the flyer\u2019s stated NIR attenuation '
   +'claim, since the chart itself stops at 750nm.'},
 {id:'xb30',g:'B5',n:'SpectraPlus XB30',d:'Omega Optical \u00b7 triple-bandpass colour enhancer for eye/film',c:'#8a6fc0',type:'interference',
  bands:[{lo:380,ls:4,hi:392,hs:4,T:.18},{lo:412,ls:6,hi:495,hs:5,T:.83},{lo:505,ls:5,hi:578,hs:4,T:.85},{lo:610,ls:6,hi:718,hs:30,T:.87}],
  same:'UPGRADED from a text-only approximation to a real chart read, same story as XB29 above \u2014 Omega\u2019s XB30 '
   +'flyer also includes an actual "Spectral Performance" curve (350-750nm). Same rippled-passband behaviour as '
   +'XB29 (roughly 65-90% within each band), a smaller UV leak spike around 385nm (~18% peak, versus XB29\u2019s '
   +'~35%), and a genuinely different NIR shape: rather than a hard closing edge, the real curve declines '
   +'gradually from ~680nm to a minimum around 725-735nm (~13-15%) and then visibly starts recovering again by '
   +'750nm (~25%) \u2014 consistent with the flyer\u2019s text describing this as a band "centered at 725nm" rather '
   +'than a wide hard cutoff like XB29\u2019s. The chart stops at 750nm, so whether that recovery keeps rising '
   +'toward 1100nm isn\u2019t shown \u2014 this fit\u2019s closing edge is deliberately gradual to match the visible trend '
   +'up to 750nm, but nothing past that point is measured; treat the 750-1100nm region as the least certain '
   +'part of this entry. This is the eye/film-optimised design: two eBay listings elsewhere in this file (the '
   +'pink "Optical Filter XB30" photos) are almost certainly this exact coating on physical glass, though that '
   +'identification isn\u2019t independently confirmed here. REAL DATA now added \u2014 the full rippled curve '
   +'digitised by eye onto a 10nm grid, replacing the flat-envelope band-fit above; NIR held flat at ~16% '
   +'from 760nm onward as an extrapolation of the chart\u2019s own partial recovery by 750nm \u2014 the region past '
   +'750nm remains unmeasured and is this entry\u2019s least certain part.'},

 /* ---- Special effect glass ---- */
 {id:'didy',g:'B2',n:'Didymium',d:'Red enhancer · 11 real absorption peaks',c:'#c9607f',
  bands:[{lo:380,ls:10,T:.90}],
  notch:[{c:431,w:9,d:.35},{c:473,w:9,d:.40},{c:513,w:8,d:.45},{c:529,w:8,d:.45},
    {c:573,w:8,d:.80},{c:585,w:8,d:.80},{c:685,w:10,d:.30},{c:741,w:8,d:.55},
    {c:749,w:8,d:.55},{c:807,w:10,d:.35},{c:879,w:12,d:.25}],
  same:'REBUILT from a single notch to the real absorption structure. Didymium glass (a praseodymium/neodymium mix) '
   +'is a certified spectrophotometer wavelength-calibration standard precisely because it has many sharp, '
   +'well-documented absorption peaks, not one \u2014 Starna\u2019s certified reference glass (a respected calibration-'
   +'standard manufacturer) lists 11 peaks from 430-890nm: 431, 473, 513, 529, 573, 585, 685, 741, 749, 807, 879nm. '
   +'The 573/585 doublet is the dominant, most visually significant one \u2014 eating that yellow-orange band is '
   +'literally why these are sold as "red enhancer" filters \u2014 modelled with the deepest notches here to match. '
   +'The other peaks are real but subtler in a consumer photography-grade filter compared to lab-grade calibration '
   +'glass (which is a much higher rare-earth concentration for maximum contrast); depths here are estimated '
   +'proportionally weaker for the outer peaks rather than measured for this specific consumer product, since no '
   +'published transmission chart exists for a specific branded photography didymium filter \u2014 peak '
   +'<i>positions</i> are the well-verified part, individual peak <i>depths</i> for a photography-grade filter '
   +'specifically are the estimated part'},
 {id:'notch532',g:'B2',n:'532nm Notch',d:'Rejects green laser line · passes red+blue either side',c:'#b06fa8',
  bands:[{lo:360,ls:10,T:.88}],type:'interference',notch:[{c:532,w:8,d:.95}],
  same:'generic eBay-listed laser-line rejection filter (targets the doubled-Nd:YAG 532nm green line) \u2014 read from the '
   +'seller\u2019s own spectrometer chart: two flat plateaus around 85\u201390% (roughly 390\u2013480nm and 550nm+), separated by a '
   +'deep near-total notch. Centre pinned to the advertised 532nm rather than the chart\u2019s apparent centre, since laser-line '
   +'notch filters are manufactured to a precise design wavelength and sub-30nm position is hard to read reliably off a phone '
   +'photo of a printed chart. WIDTH CORRECTED: previously w:20 (\u224847nm FWHM), which a UV/IR forum contributor correctly '
   +'flagged as far too soft for a real dichroic notch \u2014 genuine laser-line notch filters are narrow. A published patent '
   +'formula for notch bandwidth (Notch Bandwidth = 55\u00d710\u207b\u2076\u03bb\u00b2 + 14\u00d710\u207b\u00b3\u03bb \u2212 5.9, \u03bb in nm) gives \u224817nm FWHM '
   +'at 532nm, and a real commercial Edmund Optics 532nm notch product is spec\u2019d at 10nm FWHM \u2014 both real external sources, '
   +'independent of the original eBay chart. Narrowed to w:8 (\u224819nm FWHM), sitting between those two references rather '
   +'than the original chart-read guess, since this is a generic unbranded product likely less precise than either. On a '
   +'full-spectrum body this pulls green out while leaving red and blue largely intact \u2014 a magenta-leaning creative look '
   +'distinct from anything else in this list'},
 {id:'sepia',g:'B4',n:'Sepia / warm',d:'Cuts blue <480nm · keeps NIR',c:'#c99a5f',
  bands:[{lo:480,ls:40,T:.90}]},
 {id:'nd4',g:'B1',n:'ND4 (2 stops)', d:'Flat · shape unchanged',c:'#8a8a8a',bands:[{T:.25}]},
 {id:'nd8',g:'B1',n:'ND8 (3 stops)', d:'Flat · shape unchanged',c:'#767676',bands:[{T:.125}]},
 {id:'nd16',g:'B1',n:'ND16 (4 stops)',d:'Flat · shape unchanged',c:'#626262',bands:[{T:.0625}]},
 {id:'sch_ng1',g:'B9',n:'Schott NG1',d:'Real ND glass · very dense',c:'#3a3a3a',
  same:'REAL DATA \u2014 Schott\u2019s own official NG1 datasheet (PDF), full internal transmittance table (10nm steps) '
   +'with the datasheet\u2019s own stated reflection factor (Pd=0.918) applied, 1mm reference. An extremely dense '
   +'ND \u2014 well under 1% transmission across visible and most of the NIR range this tool models, only creeping '
   +'above 1% right at the 1100nm edge. Included for reference/completeness rather than practical stacking.'},
 {id:'sch_ng3',g:'B7',n:'Schott NG3',d:'Real ND glass, moderate density',c:'#585858',
  same:'REAL DATA \u2014 Schott\u2019s own official NG3 datasheet (PDF), same sourcing as NG1 (Pd=0.921).'},
 {id:'sch_ng4',g:'B2',n:'Schott NG4',d:'Real ND glass, moderate density',c:'#686868',
  same:'REAL DATA \u2014 Schott\u2019s own official NG4 datasheet (PDF), same sourcing as NG1 (Pd=0.922).'},
 {id:'sch_ng5',g:'B2',n:'Schott NG5',d:'Real ND glass, lighter density',c:'#787878',
  same:'REAL DATA \u2014 Schott\u2019s own official NG5 datasheet (PDF), same sourcing as NG1 (Pd=0.923).'},
 {id:'sch_ng9',g:'B7',n:'Schott NG9',d:'Real ND glass · real IR leak, not truly neutral',c:'#8a7860',
  same:'REAL DATA \u2014 Schott\u2019s own official NG9 datasheet (PDF), same sourcing as NG1 (Pd=0.921). Worth calling '
   +'out specifically: this "neutral" density glass isn\u2019t spectrally flat at all once you include NIR \u2014 it '
   +'passes noticeably more light around 700-1100nm (~8-12%) than in the visible band (~2-4%), a real, '
   +'measurable IR leak baked into the glass itself. Relevant to anyone who\u2019s noticed an ND filter behaving '
   +'unexpectedly on a converted camera \u2014 this is a real, documented example of why, not a fluke.'},
 {id:'sch_ng11',g:'B2',n:'Schott NG11',d:'Real ND glass, lightest of this set',c:'#989898',
  same:'REAL DATA \u2014 Schott\u2019s own official NG11 datasheet (PDF), same sourcing as NG1 (Pd=0.923).'},

 /* ---- Polarizers ----
    A CPL is a linear polarizer plus a quarter-wave retarder, and that retarder
    is cut for one wavelength — a typical 140nm retardation centres it near
    560nm. Out in the NIR the plate is nowhere near a quarter wave, so the
    "circular" half stops doing its job. The polarizing film itself also loses
    efficiency past ~700nm, and because a failing polarizer blocks LESS of the
    unpolarized light, transmission actually RISES into the infrared even as
    the glare-killing effect fades away. */
 {id:'cpl',g:'B7',n:'Circular polarizer',d:'Glare control fades in IR',c:'#7f8fa0',
  bands:[{hi:700,hs:45,T:.32},{lo:700,ls:45,T:.55}],pol:'circular'},
 {id:'lpl',g:'B8',n:'Linear polarizer',d:'Holds up better in IR',c:'#8f9fb0',
  bands:[{hi:720,hs:45,T:.38},{lo:720,ls:45,T:.46}],pol:'linear'},
 {id:'redcpl',g:'B3',n:'Red enhancer CPL',d:'Didymium + polarizer',c:'#c07a8a',
  bands:[{hi:700,hs:45,T:.30},{lo:700,ls:45,T:.52}],
  notch:[{c:431,w:9,d:.35},{c:473,w:9,d:.40},{c:513,w:8,d:.45},{c:529,w:8,d:.45},
    {c:573,w:8,d:.80},{c:585,w:8,d:.80},{c:685,w:10,d:.30},{c:741,w:8,d:.55},
    {c:749,w:8,d:.55},{c:807,w:10,d:.35},{c:879,w:12,d:.25}],
  pol:'circular',
  same:'same real 11-peak didymium absorption structure as the standalone Didymium entry (see that entry\u2019s note '
   +'for sourcing) \u2014 this was previously an independent, separately-simplified single-notch approximation and '
   +'has been brought in line so the two entries agree on the same real physics rather than drifting apart'},

 /* ---- Astronomy ----
    Emission-line wavelengths here are physical constants, not estimates:
    H-alpha 656.3, H-beta 486.1, OIII 495.9/500.7, SII 671.6, NII 658.4,
    sodium D 589.0/589.6, mercury 435.8/546.1/578. The passband WIDTHS follow
    standard product bandwidths (3/7/12nm etc). This group belongs in a
    full-spectrum tool because H-alpha at 656nm is precisely what a stock
    camera's internal IR-cut filter throws away — which is the main reason
    people have bodies converted in the first place. */
 {id:'ha7',g:'B7',n:'H-alpha 7nm',   d:'656.3nm · emission nebulae',c:'#d43a3a',
  bands:[{lo:652.8,ls:0.9,hi:659.8,hs:0.9,T:.93}],type:'interference'},
 {id:'ha3',g:'B7',n:'H-alpha 3nm',   d:'656.3nm · high contrast',   c:'#c22f2f',
  bands:[{lo:654.8,ls:0.45,hi:657.8,hs:0.45,T:.90}],type:'interference'},
 {id:'oiii7',g:'B5',n:'OIII 7nm',      d:'500.7nm · teal nebulosity', c:'#3fc0b0',
  bands:[{lo:497.2,ls:0.9,hi:504.2,hs:0.9,T:.93}],type:'interference'},
 {id:'sii7',g:'B7',n:'SII 7nm',       d:'671.6nm · Hubble palette',  c:'#b03050',
  bands:[{lo:668.1,ls:0.9,hi:675.1,hs:0.9,T:.90}],type:'interference'},

 /* ---- Baader's own narrowband/ultra-narrowband lineup ----
    From Baader Planetarium's own technical document ("Schmalbandfilter an
    astronomischen Teleskopen", 25 April 2022), covering both their standard
    6.5nm Narrowband and 3.5nm(Ha)/4nm(SII,OIII) Ultra-Narrowband lines.
    The document's own stated centre wavelengths are used directly, including
    a real detail our generic sii7 above doesn't capture: SII is a doublet,
    671.7nm AND 673.0nm, not a single line -- Baader's own charts explicitly
    mark both. Real numbers, idealised symmetric bandpass shape -- the
    document's own charts show real ripple and angle-of-incidence-dependent
    blue-shift this doesn't model, at f/inf (parallel beam) shown as the
    filter's own unshifted rating; a real telescope's faster optics shift
    the passband toward shorter wavelengths, more so at wider apertures and
    longer wavelengths, per the document's own formula. */
 {id:'baader_ha65',g:'B7',n:'Baader H-alpha 6.5nm',d:'656.3nm \u00b7 Baader Narrowband \u00b7 real chart',c:'#e04848',type:'interference',
  same:'REAL DATA \u2014 exact digitised curve, traced from the "Filter @ f/inf" (parallel-beam, unshifted) trace '
   +'on Baader\u2019s own technical document (25 April 2022), Abbildung 5. Replaces this file\u2019s earlier idealised '
   +'symmetric approximation \u2014 real peak ~93%, real FWHM ~6.6nm (matches the stated 6.5nm closely), with the '
   +'real slight asymmetry and ripple the old symmetric model couldn\u2019t show.'},
 {id:'baader_ha35',g:'B7',n:'Baader H-alpha 3.5nm',d:'656.3nm \u00b7 Baader Ultra-Narrowband \u00b7 real chart',c:'#c93030',type:'interference',
  same:'REAL DATA \u2014 exact digitised curve, same sourcing as the 6.5nm version above (Abbildung 8). Real peak '
   +'~93%, real FWHM ~3.7nm (matches the stated 3.5nm closely).'},
 {id:'baader_sii65',g:'B7',n:'Baader SII 6.5nm',d:'671.7/673.0nm doublet \u00b7 Baader Narrowband \u00b7 real chart',c:'#b03050',type:'interference',
  same:'REAL DATA \u2014 exact digitised curve, same sourcing as the H-alpha entries above (Abbildung 6). Real '
   +'detail worth having: SII is a genuine doublet, 671.7nm and 673.0nm, both explicitly marked on Baader\u2019s '
   +'own chart, not the single 671.6nm this file\u2019s generic sii7 entry uses. Real peak ~94%; the effective FWHM '
   +'measured end-to-end is ~18nm, wider than the "6.5nm" name suggests \u2014 a real, expected consequence of a '
   +'6.5nm-per-line filter needing to pass two lines only 1.3nm apart, not a data error.'},
 {id:'baader_sii4',g:'B7',n:'Baader SII 4nm',d:'671.7/673.0nm doublet \u00b7 Baader Ultra-Narrowband \u00b7 real chart',c:'#96284a',type:'interference',
  same:'REAL DATA \u2014 exact digitised curve, same doublet and sourcing as the SII 6.5nm version above '
   +'(Abbildung 9). Real peak ~94%; effective end-to-end FWHM ~16nm for the same doublet-coverage reason as '
   +'the 6.5nm version.'},
 {id:'baader_oiii65',g:'B5',n:'Baader OIII 6.5nm',d:'500.7nm \u00b7 Baader Narrowband \u00b7 real chart',c:'#3fc0b0',type:'interference',
  same:'REAL DATA \u2014 exact digitised curve, same sourcing as the rest of this Baader set (Abbildung 7). Real '
   +'peak ~93%, real FWHM ~6.4nm (matches the stated 6.5nm closely).'},
 {id:'baader_oiii4',g:'B5',n:'Baader OIII 4nm',d:'500.7nm \u00b7 Baader Ultra-Narrowband \u00b7 real chart',c:'#2fa090',type:'interference',
  same:'REAL DATA \u2014 exact digitised curve, same sourcing as the rest of this Baader set (Abbildung 10). Real '
   +'peak ~94%, real FWHM ~4.0nm, matching the stated 4nm almost exactly.'},
 {id:'hb8',g:'B4',n:'H-beta 8nm',    d:'486.1nm',                   c:'#4f8fd8',
  bands:[{lo:482.1,ls:1.0,hi:490.1,hs:1.0,T:.90}],type:'interference'},
 {id:'lext',g:'B7',n:'L-eXtreme',     d:'Dual 7nm · Ha + OIII',      c:'#8f5fc0',
  bands:[{lo:497.2,ls:0.9,hi:504.2,hs:0.9,T:.93},{lo:652.8,ls:0.9,hi:659.8,hs:0.9,T:.93}],type:'interference',
  same:'matches Optolong\u2019s official published spec exactly: dual 7nm FWHM bands centred on OIII 500.7nm and '
   +'H\u03b1 656.3nm, B270 substrate, 1.85mm thick, >99% light-pollution-line blocking. Optolong themselves caveat that '
   +'their published curve is "only for reference, and not used as the final product data" \u2014 treat this as design '
   +'spec, not a digitised measurement. Designed for f/2\u2013f/3.3 fast optics (their standard L-eXtreme targets slower '
   +'systems, f/4+). Source: optolong.com/cms/document/detail/id/100.html'},
 {id:'lenh',g:'B4',n:'L-eNhance',     d:'Tri-band · Hb + OIII + Ha', c:'#a06fd0',
  bands:[{lo:484,ls:1.2,hi:508,hs:1.2,T:.90},{lo:650.3,ls:1.2,hi:662.3,hs:1.2,T:.90}],type:'interference',
  same:'aligned to Optolong\u2019s official spec: H\u03b1 band ~12nm centred 656.3nm, combined H\u03b2/OIII window ~24nm '
   +'covering H\u03b2 486.1nm and OIII 495.9/500.7nm together, up to 90% transmission, B270 substrate 1.85mm. Same '
   +'"reference only, not final product data" caveat as L-eXtreme applies. Source: optolong.com/cms/document/detail/id/14.html'},
 {id:'uhc',g:'B4',n:'UHC',           d:'Nebula broadband',          c:'#5fa0c9',
  bands:[{lo:484,ls:2,hi:506,hs:2,T:.95},{lo:645,ls:3,T:.95}],type:'interference',
  same:'matches Astronomik\u2019s official UHC spec: 95% at 496/501nm (OIII) and 656nm (H\u03b1), passband 480-505nm plus '
   +'everything above ~645nm (not a narrow H\u03b1-only band \u2014 widened the red side to open-ended here, since UHC passes '
   +'the full red/H\u03b1 region rather than cutting at 680nm as previously modelled), FWHM 25nm, 1mm glass, blocks Na/Hg '
   +'lines between the windows. "UHC" is a generic name used by several brands \u2014 this models Astronomik\u2019s version '
   +'specifically as the most-referenced. Source: astronomik.com/en/visual-filters/uhc-filter.html'},
 {id:'cls',g:'B4',n:'CLS light pollution',d:'Blocks sodium/mercury', c:'#6fb0a0',
  bands:[{lo:450,ls:6,hi:540,hs:8,T:.92},{lo:640,ls:6,T:.92}],type:'interference',
  notch:[{c:589,w:7,d:.98},{c:546,w:4,d:.85}],
  same:'Astronomik\u2019s official CLS spec: wide passband roughly 450-540nm plus the full H\u03b1-and-redward region at '
   +'near-100% visible transmission, completely blocking Na and Hg vapour lamp lines and most LED/airglow emission \u2014 '
   +'deliberately wider than UHC (passes more continuum, so brighter stars, less nebula contrast). Red band widened to '
   +'open-ended here to match. The CLS-CCD variant adds an integrated IR-block layer (~700-1100nm) not modelled here. '
   +'Source: astronomik.com/en/visual-filters/cls-filter.html'},
 {id:'neod',g:'B2',n:'Baader Neodymium',d:'Real 4-feature shape, cross-verified · falls to ~0 past 750nm',  c:'#c98fb0',
  bands:[{lo:396,ls:3,hi:715,hs:10,T:.99}],type:'interference',notch:[{c:424,w:6,d:.30},{c:574,w:28,d:.94},{c:682,w:9,d:.25}],
  same:'refitted against two independent official Baader charts (nexstarsite.com review, dated 2001/2003; Astroshop.eu\u2019s current product listing) \u2014 both agree closely and both show something the earlier Cloudy-Nights-sourced fit missed: transmission falls to near-zero past ~730nm rather than staying high indefinitely into the NIR. That matters, since a Moon/skyglow filter is meant to cut overall throughput, not pass full infrared. Mean error 7.7 percentage points across 26 digitized points'},
 {id:'solc',g:'B5',n:'Solar continuum',d:'540nm 7.5nm · white light', c:'#c9c04f',
  bands:[{lo:536.25,ls:1.0,hi:543.75,hs:1.0,T:.85}],type:'interference',
  same:'Baader\u2019s CURRENT product is 7.5nm FWHM at 540nm (replacing an older 10nm version, and correcting a copy-paste '
   +'spec error Baader themselves flagged that had briefly shown the old 10nm range on the new product) \u2014 narrowed '
   +'from the previous 10nm-wide estimate to match. Baader state it blocks everything 300-1200nm except this one '
   +'continuum window. Source: baader-planetarium.com/en/7.5nm-solar-continuum-filter-540nm.html'},

 /* ---- Hoya contrast filters ----
    Listed by the name actually printed on the ring, because that is what you
    are holding. Equivalences are cross-checked against Hoya's own product
    pages and Kodak's letter system — but note the two DISAGREE on X0/X1.
    Kodak's scheme had X1 = Wratten 11; Hoya sell their Wratten 11 as X0 and
    use X1 for a fuller green. Where they conflict, Hoya's own naming wins
    here, since that is what is engraved on a Hoya filter. All are dye
    filters, so on a converted body they pass their colour plus infrared. */
 {id:'hy_k2',g:'B4',n:'Hoya Y (K2)',   d:'Yellow · = Wratten 8 · real Kodak 1928 data',       c:'#e3cf5c',
  same:'REAL DATA \u2014 exact percentages transcribed from Eastman Kodak\u2019s own "Wratten Light Filters" catalogue '
   +'(May 1928), p.63, "PERCENTAGE TRANSMISSION" table, filter No. 8 (Kodak\u2019s own historical alias for this '
   +'one is "K2" \u2014 also sold as Y2 in older Tiffen naming, and this is the same glass Hoya\u2019s Y/K2 is built to '
   +'match). Real 50%-crossing sits close to 495nm, matching the earlier fit\u2019s 492.2nm closely \u2014 a precision '
   +'upgrade to the exact curve, not a correction. Table covers 400-700nm; held flat outside that range.'},

 {id:'hy_og',g:'B5',n:'Hoya O (G)',    d:'Deep yellow · cut-on disputed (510 or ~538nm)', c:'#d9ad3c',
  bands:[{lo:510,ls:12,T:.92}],same:'Wratten 15 — Kodak\u2019s letter G was always deep yellow, not orange. '
   +'DISPUTED: this curve is an estimate that assumes O(G) equals Wratten 15 (50% near 510nm). A spectrometer '
   +'comparison of 15 yellow and orange filters posted on ultravioletphotography.com (Ulf, 2020) lists Hoya O(G) at '
   +'about 538nm, and it is often suggested as the nearest substitute for the B+W 099 (550nm). Treat the cut-on '
   +'here as uncertain by up to about 30nm until a measured curve replaces it.'},
 {id:'hy_ya3',g:'B5',n:'Hoya YA3',      d:'Orange · factor 4',          c:'#d68b34',
  bands:[{lo:540,ls:12,T:.91}],same:'sits between Wratten 21 and 22 — Hoya rate it factor 4 (2 stops)'},
 {id:'hy_x0',g:'B4',n:'Hoya X0',       d:'Yellow-green · real double-hump, refitted',c:'#8fc059',
  bands:[{lo:485.5,ls:19.1,hi:638.7,hs:60.1,T:1.00},{lo:656.4,ls:56.7,T:.90}],leak:true,
  same:'REFITTED to real Hoya X0 data (via CheeseCube312\u2019s Filter-Plotter-Data project, MIT-licensed) \u2014 RMS 1.4 '
   +'percentage points across 165 points, 210-1100nm. The genuine double-hump shape is confirmed but the earlier '
   +'chart-read numbers were notably under-scaled: real peak is ~90% near 550-560nm (previously modelled ~60-63%), the '
   +'dip bottoms out around 51% near 640nm (previously ~33%), and it climbs back to ~90% by 800-1080nm (previously only '
   +'70-80%) \u2014 same shape family, meaningfully higher magnitude throughout once checked against this cleaner source'},
 {id:'hy_x1',g:'B5',n:'Hoya X1',       d:'Green · real chart, late-NIR rise found',c:'#5fae64',
  bands:[{lo:500.8,ls:16.6,hi:564.2,hs:26.6,T:.81},{lo:1363,ls:180,T:1.00}],leak:true,
  same:'REFITTED to real Hoya X1 data (via CheeseCube312\u2019s Filter-Plotter-Data project) \u2014 RMS 0.58 percentage '
   +'points, one of the tightest fits in this whole database. The main peak (now 81% near ~530nm, not 18% \u2014 the old '
   +'chart reading was drastically under-scaled) was expected, but the real data also revealed something the earlier '
   +'model missed entirely: rather than settling to a flat ~6-7% floor through red and NIR, X1 climbs slowly but '
   +'steadily from ~3.4% around 680nm back up to ~17.6% by 1080nm \u2014 a genuine late-NIR rise this file previously had '
   +'no reason to suspect, now captured with an open-ended rising band rather than a flat tail'},
 {id:'hy_r1',g:'B6',n:'Hoya R (25A)',  d:'Red · = Wratten 25',         c:'#d4553c',
  bands:[{lo:600,ls:12,T:.90}],same:'Wratten 25 — sold as R1, R(A25) or 25A depending on era'},
 /* ---- Hoya IR series (branded, cutoff given by the model number itself) ----
    Same source as UG5 above. The article is explicit that Hoya\u2019s OWN stated
    Wratten-number equivalents for this range are wrong ("Note that the
    equivalent Wratten numbers that Hoya states for their filters are not
    accurate") -- worth keeping as a caveat rather than repeating Hoya\u2019s own
    claimed cross-reference (their 25A=Wratten 25 is fine; it's specifically
    the IR series' claimed equivalents, e.g. R72=89B, RM90=87A, that the
    article says don't hold up). These are functionally the same shape as
    the app's own generic numbered ir### series (same auto-built long-pass
    band from the JB_SERIES/SCHOTT_LP loops), but filed here separately
    under the Hoya brand and its own model-number naming, since someone
    holding an actual Hoya-branded filter searches for "R72", not "720nm". */
 {id:'hy_r70',g:'B7',n:'Hoya R70',d:'IR long-pass \u00b7 70% point named in the model number',c:'#c85f33',
  bands:[{lo:700,ls:6,T:.90}]},
 {id:'hy_r76',g:'B8',n:'Hoya R76',d:'Real chart \u00b7 IR long-pass',c:'#bc552d',
  same:'REAL DATA \u2014 exact digitised curve from Hoya\u2019s own published IR-series chart (IR76N/IR80N/IR83N/'
   +'IR85N/RM90/RM100/RT830). Replaces an undocumented placeholder (flat 90%, generic ls:6 slope) with the '
   +'exact curve \u2014 real 50%-point ~769nm, close to but not exactly the nominal "76" in the name.'},
 {id:'hy_r80',g:'B8',n:'Hoya R80',d:'Real chart \u00b7 IR long-pass',c:'#b34e2a',
  same:'REAL DATA \u2014 exact digitised curve, same source as R76 above. Real 50%-point ~808nm, close to but '
   +'not exactly the nominal "80" in the name.'},
 {id:'hy_r83',g:'B9',n:'Hoya R83',d:'Real chart \u00b7 IR long-pass',c:'#aa4827',
  same:'REAL DATA \u2014 exact digitised curve, same source as R76 above. Real 50%-point ~834nm, close to the '
   +'nominal "83" in the name.'},
 {id:'hy_r85',g:'B9',n:'Hoya R85',d:'Real chart \u00b7 IR long-pass',c:'#a34423',
  same:'REAL DATA \u2014 exact digitised curve, same source as R76 above. Real 50%-point ~850nm, matching the '
   +'nominal "85" in the name almost exactly.'},
 {id:'hy_rm86',g:'B9',n:'Hoya RM86',d:'Deep IR long-pass',c:'#943c1e',
  bands:[{lo:860,ls:6,T:.90}]},
 {id:'hy_rt830',g:'B9',n:'Hoya RT830',d:'Real chart \u00b7 IR long-pass, new addition',c:'#c04020',
  same:'REAL DATA \u2014 exact digitised curve from the same Hoya IR-series chart as the R/RM entries above. New '
   +'addition, not previously in this file at all \u2014 real 50%-point ~733nm, sitting between R72 (720nm) and '
   +'R76 (~769nm real) in this family\u2019s lineup. Peak ~84%, and unlike the others in this series it visibly '
   +'declines again toward 1100nm+ rather than holding a flat plateau \u2014 a real, distinct shape worth knowing '
   +'if this one gets picked for a stack expecting flat NIR behaviour like its siblings.'},
];
// build the long-pass bands from their cutoff names
FILTERS.forEach(f=>{
  if(f.g==='IR-pass'&&!f.bands){
    const cut=parseInt(f.n,10);
    f.bands=[{lo:cut,ls:6,T:.90}];
  }
});

/* ---- Schott colour-glass long-pass reference series ----
   Schott's part numbers ARE the 50% cut-on wavelength: RG695 cuts at 695nm,
   OG550 at 550nm, and so on. This is the raw glass that most branded filters
   are cut from — B+W 092 is RG695, B+W 093 is RG830, Hoya R72 sits with
   RG715 — so having the series lets you cross-reference anything.
   WG = UV-transmitting near-colourless, GG = yellowish, OG = orange,
   RG = red through deep infrared. */

/* Categories are wavelength bands (short to long), not brand/type, so the
   list reads top-to-bottom as UV through NIR regardless of manufacturer.
   Used both for the static FILTERS array (each entry's g: field set to
   one of these band codes directly) and for the two generator loops below,
   which compute a band from each glass's own cut-on wavelength instead of
   hardcoding one shared group for the whole series. */
function bandForWavelength(wl){
  if(wl<320)return'B1';
  if(wl<400)return'B2';
  if(wl<450)return'B3';
  if(wl<500)return'B4';
  if(wl<550)return'B5';
  if(wl<600)return'B6';
  if(wl<700)return'B7';
  if(wl<800)return'B8';
  return'B9';
}

const SCHOTT_LP=[
  ['WG280',280],['WG295',295],['WG305',305],['WG320',320],['WG345',345],['WG360',360],
  ['GG385',385],['GG395',395],['GG400',400],['GG420',420],['GG435',435],
  ['GG455',455],['GG475',475],['GG495',495],
  ['OG515',515],['OG530',530],['OG550',550],['OG570',570],['OG590',590],
  ['RG610',610],['RG630',630],['RG645',645],['RG665',665],['RG695',695],
  ['RG715',715],['RG780',780],['RG830',830],['RG850',850],['RG1000',1000]
];
const SCHOTT_NOTE={
  RG695:'B+W 092 is cut from this glass',
  RG830:'B+W 093 is cut from this glass',
  RG715:'the Hoya R72 sits alongside this',
  RG630:'B+W 091 is cut from this glass',
  GG495:'a common minus-blue / haze cut'
};
/* Measured fits for every Schott longpass glass, from real transmission data
   (CheeseCube312's Filter-Plotter-Data). [cut-on, edge softness, peak].

   These replace a synthesised edge whose softness was guessed as cut/58. That
   formula assumed edge steepness scales with cut wavelength; the measured
   curves say it barely does. Real softness runs 3.2nm at GG395 to 10.6nm at
   RG830, where the formula demanded 6.8 and 14.3 - too soft at the blue end
   and much too soft at the red end. Peak transmission is not a flat 0.91
   either: it climbs from about 0.89 in the GG glasses to 0.93 by RG830, which
   is real - the colloidal glasses grow more transparent further into the IR.

   Mean RMS across the 22 glasses falls from 2.65 to 0.92 percentage points,
   and every single one improved. RG1000 is the exception worth knowing about:
   its edge sits at the very top of this chart's 1100nm window, so a free fit
   drove its peak to an unphysical 0.75 to match the visible portion. Its peak
   is held at 0.91 and only the edge fitted, which costs some accuracy in-window
   (1.76pp) but keeps the glass physically honest. */
const SCHOTT_FIT={
  GG395:[396,3.15,0.890],
  GG400:[400.2,3.8,0.897],
  GG420:[421.5,6.1,0.893],
  GG435:[436.2,5.75,0.893],
  GG455:[455.8,5.6,0.891],
  GG475:[475,4.85,0.895],
  GG495:[495.2,4.25,0.893],
  OG515:[515,6.35,0.895],
  OG530:[530,5.9,0.898],
  OG550:[550,5.6,0.897],
  OG570:[569.8,5.65,0.895],
  OG590:[589.8,5.35,0.892],
  RG610:[609.8,7.4,0.904],
  RG630:[630.5,7,0.900],
  RG645:[645.8,6.85,0.902],
  RG665:[665.8,7.5,0.912],
  RG695:[695.2,7.1,0.909],
  RG715:[715.5,6.6,0.915],
  RG780:[781,9.35,0.927],
  RG830:[831.2,10.65,0.931],
  RG850:[850.8,10.35,0.918],
  RG1000:[1003,49.75,0.910]
};
SCHOTT_LP.forEach(([name,cut])=>{
  const fit=SCHOTT_FIT[name];
  const id='sch_'+name.toLowerCase();
  const hasRealCurve=REAL_CURVES[id]!=null;
  // fall back to the old synthesised edge only if a glass has neither an
  // exact real curve nor a measured sigmoid fit
  const lo=fit?fit[0]:cut, ls=fit?fit[1]:Math.max(4,Math.round(cut/58)), T=fit?fit[2]:.91;
  const fam=name.slice(0,2);
  const col=fam==='WG'?'#b9a6f0':fam==='GG'?'#ddd06a':fam==='OG'?'#d69a45':
            cut<700?'#cf5334':cut<850?'#a83c22':'#722113';
  let same;
  const sg=SCHOTT_IDS[id]&&SCHOTT_GLASS[SCHOTT_IDS[id][0]];
  if(sg){
    // build 146: from SCHOTT's own published table, converted once in src-filters/schott.js
    same='SCHOTT\u2019s own published data for '+name+': the internal transmittance table (10nm steps, '+sg.d+'mm '
      +'reference thickness) times the glass\u2019s stated reflection factor Pd='+sg.pd+', which is what an uncoated '
      +'filter of this glass passes. Taken from SCHOTT\u2019s page for the glass in October 2026 and cross-checked against '
      +'CheeseCube312\u2019s independent copy of the same table.';
  } else if(hasRealCurve){
    same='REAL DATA \u2014 Schott\u2019s own official '+name+' datasheet (PDF), full internal transmittance table '
      +'(10nm steps) with the datasheet\u2019s own stated reflection factor applied, at a 2mm reference thickness. '
      +'Previously a synthesised edge (cut/58 slope, flat 91% peak) with no real measurement behind it.';
  } else if(fit){
    same='REFITTED to real Schott transmission data (via CheeseCube312\u2019s Filter-Plotter-Data project), converted from internal to external transmittance with the standard 4 percent per-surface Fresnel loss. Replaces a synthesised edge that was systematically too soft.';
  } else {
    same=null;
  }
  FILTERS.push({
    id, g:bandForWavelength(lo), n:name,
    d:cut+'nm cut-on'+(SCHOTT_NOTE[name]?' \u00b7 '+SCHOTT_NOTE[name]:''),
    c:col, type:'absorptive', ref:sg?sg.d:2,
    // hi:2600/hs:400 reproduces the gentle long-wavelength taper real Schott
    // charts show, without disturbing the fitted rising edge near cut-on.
    // Ignored when hasRealCurve is true -- filterT() checks REAL_CURVES first.
    bands:[{lo:lo,ls:ls,hi:2600,hs:400,T:T}],
    same
  });
});

/* ---- JB series (Chinese-market long-pass, sold under "JB" part numbers) ----
   Build 146: each now uses Tangsinuo's own product chart for that exact JB glass (as digitised in CheeseCube312's
   Filter-Plotter-Data, stored in REAL_CURVES), replacing the SCHOTT GG/OG fits these used to borrow. The seller states
   JB470/JB490/JB510 equal GG475/GG495/"GG515" (really OG515); JB400/JB420/JB450 had no stated equivalent and were
   only inferred, and the real charts show why that mattered: JB400's edge is much softer than GG400's (73% at 420nm
   where the borrowed fit said 89%) and JB450 reaches 50% about 10nm earlier than GG455. The bands below are kept only
   as the fallback shape; filterT() uses the stored curve. */
const JB_SERIES=[['JB400','GG400'],['JB420','GG420'],['JB450','GG455'],['JB470','GG475'],['JB490','GG495'],['JB510','OG515']];
JB_SERIES.forEach(([name,schottName])=>{
  const fit=SCHOTT_FIT[schottName];
  const src=FILTERS.find(x=>x.id==='sch_'+schottName.toLowerCase());
  FILTERS.push({
    id:'jb_'+name.toLowerCase(), g:bandForWavelength(fit[0]), n:name,
    d:'Long-pass \u00b7 Tangsinuo\u2019s own chart for this glass \u00b7 sold alongside Schott '+schottName,
    c:src?src.c:'#ddd06a', type:'absorptive',
    bands:[{lo:fit[0],ls:fit[1],hi:2600,hs:400,T:fit[2]}],
    same:'Tangsinuo\u2019s own product chart for '+name+', digitised by CheeseCube312 (Filter-Plotter-Data). Until build '
      +'146 this entry borrowed '+schottName+'\u2019s fitted edge instead, because the seller sells it as that glass\u2019s '
      +'equivalent; the product\u2019s own chart is the better evidence for the product.'
  });
});

const LMIN=280,LMAX=1100;
let viewMin=LMIN,viewMax=LMAX; // current zoom window for the main chart only — every other consumer of LMIN/LMAX (spec strip, sensor calcs, exports) is unaffected
let selected=[];
