/* ---------- chart zoom & pan ---------- */
(function initChartZoom(){
  const cv=$('chart'),resetBtn=$('resetZoomBtn'),inBtn=$('zoomInBtn'),outBtn=$('zoomOutBtn');
  if(!cv)return;
  function clampView(){
    // last-ditch guard: if anything ever produces a non-finite bound, fall
    // back to the full range rather than leaving the chart permanently blank
    if(!Number.isFinite(viewMin)||!Number.isFinite(viewMax)||viewMax<=viewMin){viewMin=LMIN;viewMax=LMAX;return;}
    if(viewMax-viewMin<15){const mid=(viewMin+viewMax)/2;viewMin=mid-7.5;viewMax=mid+7.5;}
    if(viewMin<LMIN){viewMax+=LMIN-viewMin;viewMin=LMIN;}
    if(viewMax>LMAX){viewMin-=viewMax-LMAX;viewMax=LMAX;}
    viewMin=Math.max(LMIN,viewMin);viewMax=Math.min(LMAX,viewMax);
  }
  function syncResetBtn(){if(resetBtn)resetBtn.style.display=(viewMin>LMIN+0.01||viewMax<LMAX-0.01)?'':'none';}
  function apply(){clampView();syncResetBtn();draw();}
  // zoom by a factor about a fixed wavelength (keeps whatever's under the
  // finger/cursor/centre pinned in place while the span changes)
  function zoomAbout(lam,factor){
    let newSpan=(viewMax-viewMin)*factor;
    newSpan=Math.min(LMAX-LMIN,Math.max(15,newSpan));
    const frac=(lam-viewMin)/(viewMax-viewMin);
    viewMin=lam-frac*newSpan;viewMax=viewMin+newSpan;
    apply();
  }
  // client X (CSS px, page coords) -> wavelength under that point
  function lamAtClientX(clientX){
    const rect=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
    return xToLam((clientX-rect.left)*dpr,cv.width,{l:52*dpr,r:12*dpr});
  }

  cv.addEventListener('wheel',e=>{
    e.preventDefault();
    zoomAbout(lamAtClientX(e.clientX),e.deltaY<0?0.85:1/0.85);
  },{passive:false});

  /* Touch: two fingers pinch to zoom, one finger drags to pan. Handled with
     touch events rather than pointer events because a pinch delivers two
     simultaneous pointers that the single-pointer drag logic below can't
     interpret — on a phone the wheel event never fires at all, so without
     this branch the chart simply cannot be zoomed. */
  let pinchDist=0,pinchLam=0,touchPanX=null,touchStartMin=0,touchStartMax=0;
  const dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
  const mid=t=>(t[0].clientX+t[1].clientX)/2;
  cv.addEventListener('touchstart',e=>{
    if(e.touches.length===2){
      pinchDist=dist(e.touches);pinchLam=lamAtClientX(mid(e.touches));touchPanX=null;
      e.preventDefault();
    }else if(e.touches.length===1){
      touchPanX=e.touches[0].clientX;touchStartMin=viewMin;touchStartMax=viewMax;pinchDist=0;
    }
  },{passive:false});
  cv.addEventListener('touchmove',e=>{
    if(e.touches.length===2&&pinchDist>0){
      e.preventDefault();
      const d=dist(e.touches);
      if(d>0){zoomAbout(pinchLam,pinchDist/d);pinchDist=d;}
    }else if(e.touches.length===1&&touchPanX!==null){
      e.preventDefault();
      const rect=cv.getBoundingClientRect();
      if(rect.width<=0)return; // guard: a zero-width rect would divide to Infinity and corrupt the view range
      const deltaLam=-(e.touches[0].clientX-touchPanX)/rect.width*(touchStartMax-touchStartMin);
      viewMin=touchStartMin+deltaLam;viewMax=touchStartMax+deltaLam;apply();
    }
  },{passive:false});
  ['touchend','touchcancel'].forEach(ev=>cv.addEventListener(ev,e=>{
    if(e.touches.length<2)pinchDist=0;
    if(e.touches.length===0)touchPanX=null;
  }));

  // Mouse drag to pan (pointer events, but ignore touch — the touch branch
  // above already handles it, and running both double-applies the pan)
  let dragging=false,dragStartX=0,dragStartMin=0,dragStartMax=0;
  cv.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch')return;
    dragging=true;dragStartX=e.clientX;dragStartMin=viewMin;dragStartMax=viewMax;
    cv.setPointerCapture(e.pointerId);cv.style.cursor='grabbing';
  });
  cv.addEventListener('pointermove',e=>{
    if(!dragging||e.pointerType==='touch')return;
    const rect=cv.getBoundingClientRect();
    if(rect.width<=0)return; // same guard as the touch path
    const deltaLam=-(e.clientX-dragStartX)/rect.width*(dragStartMax-dragStartMin);
    viewMin=dragStartMin+deltaLam;viewMax=dragStartMax+deltaLam;apply();
  });
  ['pointerup','pointercancel','pointerleave'].forEach(ev=>cv.addEventListener(ev,()=>{dragging=false;cv.style.cursor='';}));

  cv.addEventListener('dblclick',()=>{viewMin=LMIN;viewMax=LMAX;syncResetBtn();draw();});
  if(resetBtn)resetBtn.addEventListener('click',()=>{viewMin=LMIN;viewMax=LMAX;syncResetBtn();draw();});
  // Button fallback — works on every device regardless of wheel/touch support
  if(inBtn)inBtn.addEventListener('click',()=>zoomAbout((viewMin+viewMax)/2,0.7));
  if(outBtn)outBtn.addEventListener('click',()=>zoomAbout((viewMin+viewMax)/2,1/0.7));
  const sticky=$('stickyStack');
  if(sticky)sticky.addEventListener('click',()=>{
    const w=$('chartWrap');
    if(w)w.scrollIntoView({behavior:'smooth',block:'center'});
  });
  cv.style.cursor='grab';cv.style.touchAction='none';
  /* Double-tap the chart to show the diagnostic on demand. Auto-display
     depends on detecting the fault, and detection has repeatedly been the
     unreliable part, so there has to be a way to get the numbers by hand. */
  cv.addEventListener('dblclick',()=>{ try{ showChartDiag(); }catch(e){} });
})();

/* describe what the COMBINED stack delivers — the thing you actually shoot */
function describeStack(fs){
  const T=[];let pk=0,pl=LMIN;
  for(let l=LMIN;l<=LMAX;l++){const t=systemT(l,fs);T.push(t);if(t>pk){pk=t;pl=l;}}
  const idx=l=>l-LMIN;
  const seg=(a,b)=>{let m=0;for(let l=a;l<=b;l++)m=Math.max(m,T[idx(l)]);return m;};
  const uv=seg(LMIN,399),vis=seg(400,700),nir=seg(750,LMAX);
  // Light loss must be integrated, not taken from the peak: a filter passing
  // one narrow band at 90% still throws away almost everything a full-spectrum
  // sensor could have caught. Mean transmission across 380-1000nm is a far
  // better proxy for the exposure hit than peak height.
  let sum=0,n=0;
  for(let l=380;l<=1000;l++){sum+=T[idx(l)];n++;}
  const mean=sum/n;
  const stops=mean>1e-6?Math.log2(1/mean):20;
  // Dominant band from where the peak actually sits, not from thresholds
  const dom=pl<400?'uv':pl<=700?'vis':'nir';
  const mixed=vis>pk*0.15&&nir>pk*0.15;
  // total width above half-peak, and how many separate windows make it up
  let width=0,windows=0,inWin=false;
  for(let l=LMIN;l<=LMAX;l++){
    const on=T[idx(l)]>=pk/2;
    if(on){width++;if(!inWin){windows++;inWin=true;}}else inWin=false;
  }
  const narrow=pk>0.05&&width<=30;
  let out=[];
  if(pk<0.03){
    out.push('<b>These filters fight each other.</b> Only '+(pk*100).toFixed(2)+
      '% of light gets through at best, so almost nothing reaches the sensor. One filter is blocking almost '+
      'exactly the band the other one lets through \u2014 pairing an IR-pass filter with an IR-blocking one does '+
      'this. Drop one of them.');
  }else{
    const parts=[];
    if(uv>pk*0.3)parts.push('ultraviolet');
    if(vis>pk*0.3)parts.push('visible light');
    if(nir>pk*0.3)parts.push('infrared');
    out.push('<b>This stack delivers '+(parts.length?parts.join(' + '):'a narrow band')+
      '</b>, peaking '+(pk*100).toFixed(0)+'% at '+pl+'nm.');
    if(narrow){
      out.push(windows>1
        ? 'Only '+width+'nm of light gets through in total, split across '+windows+' separate thin slices \u2014 '+
          'this is the kind of filter used for astrophotography, picking out a few specific colours (like '+
          'individual emission lines from glowing gas) and blocking everything in between. Each slice lands as '+
          'a different colour on the sensor, which is how one photo can capture several of them at once.'
        : 'Only about '+width+'nm wide \u2014 a very thin slice of colour. This isolates one specific narrow band '+
          '(the kind used for astrophotography emission lines) rather than shaping a broad, natural-looking '+
          'colour response.');
      out.push('Almost everything else is blocked, so this is close to useless for ordinary daylight photos and '+
        'is built for long exposures on specific glowing targets instead. A normal channel swap doesn\u2019t have '+
        'much to work with here.');
    }else if(dom==='uv'){
      if(nir<=0.02){
        out.push('The peak sits in ultraviolet with infrared fully blocked \u2014 that\u2019s exactly what a UV setup is for.');
        if(vis>pk*0.25)out.push('It still lets through a little violet and blue light, so expect a small amount of ordinary colour mixed into the UV result \u2014 that\u2019s just how the wider UV glasses behave, not a fault.');
      }else{
        out.push('The peak is in ultraviolet, but infrared is still getting through too, which will tint the result red. Add an IR-blocking filter such as TSN575, S8612 or BG38 to clean that up.');
      }
      out.push('Expect a strong colour cast that only clears up after a custom white balance, and long exposure times.');
    }else if(mixed){
      out.push('Visible light and infrared arrive together and land as different colours on the sensor at once \u2014 that mixing is what produces false colour. Set a custom white balance off grass or foliage while shooting, then swap channels afterward to push the colours where you want them.');
    }else if(dom==='nir'){
      out.push('Infrared only, so expect the classic effect: bright foliage, dark sky, and a mostly colourless file that a channel swap can\u2019t do much with. White balance off foliage to get clean whites.');
    }else{
      out.push('Visible light only \u2014 infrared is blocked, so a converted camera will render this more or less like an ordinary photo.');
    }
    out.push('Overall this lets through about '+(mean*100).toFixed(1)+
      '% of the light a full-spectrum sensor could otherwise use \u2014 roughly the same as losing '+stops.toFixed(1)+
      ' stops of light, so plan for a longer exposure.');
  }
  return out.join(' ');
}

/* ---------- behaviour + stacking guidance ----------
   Descriptions are DERIVED from each filter's own curve rather than authored
   per filter, so they can't drift out of sync with the model or assert
   something the maths doesn't actually do. */
function bandsOf(f,thresh){
  // find contiguous regions where this filter passes >thresh of its own peak
  let pk=0;for(let l=LMIN;l<=LMAX;l++)pk=Math.max(pk,filterT(l,f));
  if(pk<=0.001)return{pk:0,regions:[]};
  const regions=[];let start=null;
  for(let l=LMIN;l<=LMAX;l++){
    const on=filterT(l,f)>=pk*thresh;
    if(on&&start===null)start=l;
    if((!on||l===LMAX)&&start!==null){regions.push([start,l]);start=null;}
  }
  return{pk,regions};
}
function describeFilter(f){
  const{pk,regions}=bandsOf(f,0.5);
  if(!pk)return'Blocks essentially everything.';
  const named=r=>{
    const[a,b]=r;
    const where=v=>v<400?'UV':v<500?'blue':v<580?'green':v<640?'orange':v<700?'red':v<900?'NIR':'deep IR';
    if(b>=LMAX)return'passes from '+a+'nm upward ('+where(a)+' and beyond)';
    return'passes '+a+'–'+b+'nm ('+where((a+b)/2)+')';
  };
  let s=(pk*100).toFixed(0)+'% peak; '+regions.map(named).join(', ')+'.';
  if(f.type==='interference'){
    s+=' <b>How it works:</b> this type blocks light by reflecting it away rather than soaking it up, and that '+
      'reflection depends on the angle the light hits the glass at. So the exact cutoff point isn\u2019t quite the '+
      'same across the frame — on a wide lens the corners (where light arrives at a steeper angle) cut off a bit '+
      'earlier than the centre, giving a faint uneven colour cast toward the edges. Plain tinted glass doesn\u2019t '+
      'have this problem.';
  }else if(f.type==='absorptive'){
    s+=' This is plain tinted glass, so it blocks light the same way everywhere on it \u2014 no uneven colour '+
      'across the frame regardless of lens or angle.';
  }
  if(f.stains)s+=' This glass can develop surface haze over time; store it dry, with desiccant if you are somewhere humid.';
  if(f.notch)s+=' There\u2019s a dip in transmission around '+f.notch[0].c+'nm \u2014 that\u2019s what makes reds and autumn foliage look more separated from yellow instead of blending in.';
  if(f.pol){
    s+=' <b>Polarizer:</b> the transmission shown here is just the light it lets through, not how well it cuts '+
      'glare. '+
      (f.pol==='circular'
        ? 'The internal coating that makes it a "circular" polarizer is tuned for visible light, so by the time you\u2019re in infrared it isn\u2019t doing its job properly and the circular behaviour stops working right. '
        : 'It has no such coating, so it holds up better into infrared than a circular polarizer does. ')+
      'On top of that, the polarizing material itself gets worse at blocking light past about 700nm, which is why '+
      'transmission goes UP in the infrared even as the polarizing effect fades out. Expect little to no glare or '+
      'sky-darkening effect on a deep-IR shot.';
  }
  if(f.leak)s+=' This is a dye-based filter, and dyes that block visible colour typically go clear again in the infrared \u2014 so past about 700nm it lets infrared straight through too.';
  if(regions.length>1&&!f.leak&&!f.pol)s+=' It passes more than one separate band of light at once, which a colour sensor picks up as different colour channels simultaneously.';
  s+='<div class="provLine noTr" lang="en">'+provenanceHTML(f)+'</div>';
  if(f.same)s+='<details class="provNote"><summary>Research notes</summary><div class="noTr" lang="en">'+f.same+'</div></details>';
  return s;
}
function renderBehaviour(fs){
  const host=$('behaviour');host.innerHTML='';
  if(!fs.length)return;
  /* This section runs to several paragraphs per filter. It's genuinely
     useful reference material, but as always-on body text it buried the
     chart and the plain-English summary under a wall of prose on a phone.
     Collapsed by default now — the headline answers live above it. */
  const det=document.createElement('details');
  det.className='behaviourWrap';
  const sum=document.createElement('summary');
  sum.className='behaviourSum';
  sum.textContent='Selected glass behaviour & stacking guidance'+
    (fs.length>1?' ('+dedupe(fs).length+' filters)':'');
  det.appendChild(sum);
  const el=document.createElement('div');
  el.style.marginTop='8px';
  det.appendChild(el);
  host.appendChild(det);
  const assume=document.createElement('p');
  assume.className='note';
  assume.style.margin='2px 0 8px';
  assume.textContent='Everything below assumes a fully converted full-spectrum camera (the hot mirror removed) — the one exception is called out explicitly where it applies.';
  el.appendChild(assume);

  // combined result first — what you actually get out of this combination
  const combo=document.createElement('div');
  combo.className='bh combo';
  const uniq=dedupe(fs);
  combo.innerHTML='<div class="bn">'+(fs.length>1?'Combined result — '+uniq.map(({f,n})=>f.n+(n>1?' ×'+n:'')).join(' + '):'Result — '+fs[0].n)+
    '</div><div class="bd">'+describeStack(fs)+'</div>';
  el.appendChild(combo);

  if(fs.length>1){
    const sub=document.createElement('h4');
    sub.style.marginTop='12px';sub.textContent='Each filter\u2019s part in it';
    el.appendChild(sub);
  }

  const peakOf=arr=>{let p=0;for(let l=LMIN;l<=LMAX;l++)p=Math.max(p,stackT(l,arr));return p;};
  const stackPk=peakOf(fs);
  dedupe(fs).forEach(({f,n})=>{
    const card=document.createElement('div');card.className='bh';card.style.setProperty('--c',f.c);
    const others=fs.filter(x=>x!==f);
    let inter='';
    if(others.length){
      const alone=peakOf(fs.filter(x=>x===f)); // this filter at its OWN stacked count, alone
      const drop=alone>0?(1-stackPk/alone):1;
      let nirAlone=0,nirStack=0;
      for(let l=750;l<=LMAX;l++){nirAlone=Math.max(nirAlone,filterT(l,f));nirStack=Math.max(nirStack,stackT(l,fs));}
      if(stackPk<0.03){
        inter='<span class="bs bad">Fights the rest of this stack \u2014 the two barely let through the same light at all, so almost nothing reaches the sensor. Pairing an IR-pass filter with an IR-blocking one does exactly this.</span>';
      }else if(nirAlone>0.2&&nirStack<0.02){
        // wording depends on what kind of glass this is
        const msg=f.g==='UV-pass'
          ? 'Its infrared leak is being blocked by the other glass here, leaving clean ultraviolet \u2014 this is exactly why UV glass needs a partner filter.'
          : f.g==='Colour'||f.g==='Conv'
          ? 'Its infrared leak is being removed by the other glass here, so it behaves like an ordinary colour filter again.'
          : 'Its infrared transmission is being blocked by the other glass in this stack.';
        inter='<span class="bs">'+msg+'</span>';
      }else if(drop>0.55){
        inter='<span class="bs">The rest of the stack cuts this one hard \u2014 peak brightness drops about '+(drop*100).toFixed(0)+'%. Expect long exposures.</span>';
      }else{
        inter='<span class="bs">Combines without much loss \u2014 the stack keeps roughly '+((1-drop)*100).toFixed(0)+'% of what this filter lets through on its own.</span>';
      }
    }
    if(n>1){
      const soloPk=peakOf([f]),stackedPk=peakOf(fs.filter(x=>x===f));
      inter+='<span class="bs">Stacking '+n+' pieces of this same glass \u2014 peak brightness drops from '+(soloPk*100).toFixed(0)+
        '% for one piece to '+(stackedPk*100).toFixed(0)+'% for '+n+' together, and the cutoff becomes sharper. '+
        'That\u2019s just how absorbing glass works: each extra piece blocks a share of whatever light made it '+
        'through the ones before it, so the effect compounds rather than simply adding up.</span>';
    }
    card.innerHTML='<div class="bn">'+f.n+(n>1?' <span style="color:var(--muted);font-weight:400">×'+n+'</span>':'')+'</div><div class="bd">'+describeFilter(f)+'</div>'+inter;
    el.appendChild(card);
  });
}

/* ---------- smart stack naming ---------- */
const STACK_NAMES=[
  {ids:['zwb3','tsn575'],label:'Clean UV-pass — IR leak removed'},
  {ids:['zwb2','tsn575'],label:'Clean UV-pass — the recommended pairing'},
  {ids:['zwb1','tsn575'],label:'Clean UV-pass — wider UV-A'},
  {ids:['kb20','bw061','c80c'],label:'Candy Pink — in-camera false colour'},
  {ids:['zwb2','qb21ar'],label:'UV-pass with residual NIR leak'},
  {ids:['grb1','lee139'],label:'Candy Chrome DIY'},
  {ids:['grb3','lee035'],label:'Pink Aerochrome DIY (corrected KG2->KG3 pairing bug)'},
  {ids:['db850','lee441'],label:'Blue Trees — CT Straw variant (Hidden Realms)'},
  {ids:['db850','lee744'],label:'Blue Trees — Dirty White variant (Hidden Realms)'},
  {ids:['grb3','lee729'],label:'IR Chrome DIY'},
  {ids:['w47'],          label:'In-camera faux colour — Goldie-like'},
  {ids:['bw099'],        label:'Orange/cyan Aerochrome starting point'},
  {ids:['baader'],       label:'Reference UV-pass — no leak by design'},
];
function summarise(fs){
  if(!fs.length)return'';
  const ids=fs.map(f=>f.id).sort().join(',');
  const hit=STACK_NAMES.find(s=>s.ids.slice().sort().join(',')===ids);
  if(hit)return hit.label;
  // fall back to a description of what the combined stack actually does
  let pk=0,pl=0,vis=0,nir=0;
  for(let l=LMIN;l<=LMAX;l++){const t=stackT(l,fs);if(t>pk){pk=t;pl=l;}}
  for(let l=400;l<=700;l++)vis=Math.max(vis,stackT(l,fs));
  for(let l=750;l<=LMAX;l++)nir=Math.max(nir,stackT(l,fs));
  if(pk<0.03)return'Dead stack — these cancel each other out';
  if(vis>0.1&&nir>0.1)return'Mixed visible + infrared — false colour';
  if(nir>0.1&&vis<=0.1)return'Infrared only';
  if(pl<400)return'Ultraviolet only';
  return'Visible only';
}
