/* ---------- chart ---------- */
function lamToX(l,W,pad){return pad.l+(l-viewMin)/(viewMax-viewMin)*(W-pad.l-pad.r);}
function xToLam(x,W,pad){return viewMin+(x-pad.l)/(W-pad.l-pad.r)*(viewMax-viewMin);}
function niceStep(span){
  // pick a round-ish tick step so the axis reads cleanly at any zoom level —
  // roughly 6-10 major ticks across the visible span
  const raw=span/8,mag=Math.pow(10,Math.floor(Math.log10(raw)));
  const norm=raw/mag;
  const step=(norm<1.5?1:norm<3.5?2:norm<7.5?5:10)*mag;
  return Math.max(1,Math.round(step));
}
// y mapping honours the log toggle. Log runs 1e-5..1 so a 0.01% leak is still
// on the chart instead of being flattened onto the axis by a linear scale.
const LOG_MIN=1e-5;
function isLog(){const el=$('logScale');return !!(el&&el.checked);}
function tToY(t,H,pad){
  if(!isLog())return H-pad.b-t*(H-pad.t-pad.b);
  const v=Math.max(t,LOG_MIN);
  const frac=(Math.log10(v)-Math.log10(LOG_MIN))/(0-Math.log10(LOG_MIN));
  return H-pad.b-frac*(H-pad.t-pad.b);
}

// approximate visible wavelength -> RGB, for the spectrum strip and region tint
function lamRGB(l){
  let r=0,g=0,b=0;
  if(l>=380&&l<440){r=-(l-440)/60;b=1;}
  else if(l<490){g=(l-440)/50;b=1;}
  else if(l<510){g=1;b=-(l-510)/20;}
  else if(l<580){r=(l-510)/70;g=1;}
  else if(l<645){r=1;g=-(l-645)/65;}
  else if(l<=780){r=1;}
  let f=1;
  if(l<420&&l>=380)f=.3+.7*(l-380)/40;
  else if(l>700&&l<=780)f=.3+.7*(780-l)/80;
  else if(l<380||l>780)f=0;
  return [Math.round(255*Math.pow(r*f,.8)),Math.round(255*Math.pow(g*f,.8)),Math.round(255*Math.pow(b*f,.8))];
}

/* The chart has gone blank on a real device through several rounds of fixes
   that each targeted a plausible cause. This wrapper stops the guessing: if
   draw() throws part-way, the canvas keeps whatever it had painted so far
   (the opaque background, drawn first) and the exception is recorded and put
   on screen instead of vanishing into the console nobody can see on a phone.
   A thrown error mid-draw produces exactly the observed symptom -- background
   painted, nothing else, chartPainted never set. */
let _lastDrawError='';
function draw(dprOverride){
  try{ return _drawChartInner(dprOverride); }
  catch(e){
    _lastDrawError=(e&&e.message)||String(e);
    try{ showChartDiag(); }catch(_){}
    return undefined;
  }
}
function _drawChartInner(dprOverride){
  /* dprOverride lets the PNG export re-render this chart natively at a much
     higher resolution instead of stretching the on-screen bitmap — stretching
     is what made exported curves and labels soft. Everything below already
     scales off dpr, so one parameter is enough. */
  const cv=$('chart'),rect=cv.getBoundingClientRect();
  /* On-screen device pixel ratio is capped at 2. A phone reporting dpr 3 on a
     wide viewport asks for a backing store several times larger than the
     screen can show, and mobile browsers enforce a per-page canvas memory
     budget -- exceed it and the allocation silently fails or the store is
     dropped, which is a black chart. Above 2x the difference is not visible
     on a line chart anyway. The PNG export passes dprOverride and is
     deliberately exempt, since that output is meant to be zoomed into. */
  const dpr=dprOverride||Math.min(window.devicePixelRatio||1,chartDprCap);
  /* If the element hasn't been laid out yet, rect.width is 0 and the old code
     clamped the canvas to 1x1 — which the browser then stretched to full size
     as a solid black box that only fixed itself if some later event happened
     to trigger a redraw. That was the "black chart that comes back" bug. Bail
     out and retry once layout exists instead of caching a broken bitmap. */
  if(rect.width<50||rect.height<20){
    if(!dprOverride){
      // paint later, but keep the numbers current now
      try{updatePanels(selected.map(id=>FILTERS.find(f=>f.id===id)).filter(Boolean));}catch(e){}
      /* Keep retrying rather than giving up after a single frame. The previous
         version scheduled exactly one requestAnimationFrame and, if the element
         still had no size on that frame, never tried again — leaving the canvas
         at its default 300x150, stretched by CSS into a solid black box. One
         frame is not always enough on a phone (late webfont reflow, address bar
         animation, a slow first paint), and ResizeObserver is not available
         everywhere to bail us out. */
      scheduleChartDraw();
    }
    return;
  }
  const W=Math.max(1,Math.round(rect.width*dpr)),H=Math.max(1,Math.round(rect.height*dpr));
  /* Assigning to canvas.width resets the backing store even when the value
     is unchanged, which is the only way to make the browser hand over a
     fresh buffer. The size comparison is what normally skips that, so the
     loss detector sets a flag rather than resizing the canvas itself. */
  if(_forceChartRealloc||cv.width!==W||cv.height!==H){cv.width=W;cv.height=H;_forceChartRealloc=false;}
  const cx=cv.getContext('2d');
  /* Paint an opaque background rather than clearing to transparent and
     letting the element's CSS background show through. Two reasons: the
     exported PNG then carries the chart's own backdrop instead of whatever
     sits behind it, and — the reason it changed — a painted pixel now has
     alpha 255, which is what lets the loss detector above tell a healthy
     canvas apart from one whose backing store the browser has thrown away.
     Relying on the CSS background left painted pixels transparent, so the
     two states were indistinguishable. */
  cx.clearRect(0,0,W,H);
  cx.fillStyle=chartTheme().bg;
  cx.fillRect(0,0,W,H);
  const pad={l:52*dpr,r:12*dpr,t:14*dpr,b:38*dpr};

  // region tints: UV / visible / NIR
  const uvX0=lamToX(LMIN,W,pad),uvX1=lamToX(400,W,pad),visX1=lamToX(700,W,pad),nirX1=lamToX(LMAX,W,pad);
  cx.fillStyle=chartTheme().uvTint;cx.fillRect(uvX0,pad.t,uvX1-uvX0,H-pad.t-pad.b);
  cx.fillStyle=chartTheme().visTint;cx.fillRect(uvX1,pad.t,visX1-uvX1,H-pad.t-pad.b);
  cx.fillStyle=chartTheme().nirTint;cx.fillRect(visX1,pad.t,nirX1-visX1,H-pad.t-pad.b);

  // grid
  cx.strokeStyle=chartTheme().gridMajor;cx.lineWidth=1*dpr;
  cx.font=(9.5*dpr)+'px "JetBrains Mono",monospace';cx.fillStyle='#7a6a52';
  if(isLog()){
    const decades=[1,0.1,0.01,0.001,0.0001,0.00001];
    decades.forEach(t=>{
      const y=Math.round(tToY(t,H,pad))+.5;
      cx.beginPath();cx.moveTo(pad.l,y);cx.lineTo(W-pad.r,y);cx.stroke();
      cx.textAlign='right';cx.textBaseline='middle';
      cx.fillText(t>=0.01?(t*100)+'%':(t*100).toExponential(0)+'%',pad.l-6*dpr,y);
    });
    // minor ticks at the 5x and 2x points within each decade — short marks on
    // the axis edge only, unlabeled, so the scale reads finer without clutter
    cx.strokeStyle=chartTheme().gridMinor;cx.lineWidth=0.75*dpr;
    decades.slice(1).forEach((t,i)=>{
      const above=decades[i];
      [5,2].forEach(mult=>{
        const v=t*mult;if(v>=above)return;
        const y=Math.round(tToY(v,H,pad))+.5;
        cx.beginPath();cx.moveTo(pad.l,y);cx.lineTo(pad.l+5*dpr,y);cx.stroke();
        cx.beginPath();cx.moveTo(W-pad.r-5*dpr,y);cx.lineTo(W-pad.r,y);cx.stroke();
      });
    });
    cx.strokeStyle=chartTheme().gridMajor;cx.lineWidth=1*dpr;
  }else{
    for(let t=0;t<=1.0001;t+=0.25){
      const y=Math.round(tToY(t,H,pad))+.5;
      cx.beginPath();cx.moveTo(pad.l,y);cx.lineTo(W-pad.r,y);cx.stroke();
      cx.textAlign='right';cx.textBaseline='middle';
      cx.fillText(Math.round(t*100)+'%',pad.l-6*dpr,y);
    }
    // minor ticks every 5% — short marks on the axis edges, unlabeled
    cx.strokeStyle=chartTheme().gridMinor;cx.lineWidth=0.75*dpr;
    for(let t=0.05;t<1.0001;t+=0.05){
      if(Math.abs((t*100)%25)<0.01)continue; // skip where a major line already is
      const y=Math.round(tToY(t,H,pad))+.5;
      cx.beginPath();cx.moveTo(pad.l,y);cx.lineTo(pad.l+5*dpr,y);cx.stroke();
      cx.beginPath();cx.moveTo(W-pad.r-5*dpr,y);cx.lineTo(W-pad.r,y);cx.stroke();
    }
    cx.strokeStyle=chartTheme().gridMajor;cx.lineWidth=1*dpr;
  }
  for(let l=Math.ceil(viewMin/niceStep(viewMax-viewMin))*niceStep(viewMax-viewMin);l<=viewMax;l+=niceStep(viewMax-viewMin)){
    const x=Math.round(lamToX(l,W,pad))+.5;
    cx.beginPath();cx.moveTo(x,pad.t);cx.lineTo(x,H-pad.b);cx.stroke();
    cx.textAlign='center';cx.textBaseline='top';
    cx.fillText(Math.round(l),x,H-pad.b+6*dpr);
  }
  // minor wavelength ticks at 1/5 the major step — short marks along the bottom edge
  cx.strokeStyle=chartTheme().gridMinor;cx.lineWidth=0.75*dpr;
  const majorStep=niceStep(viewMax-viewMin),minorStep=majorStep/5;
  for(let l=Math.ceil(viewMin/minorStep)*minorStep;l<=viewMax;l+=minorStep){
    if(Math.abs(l%majorStep)<1e-6)continue; // skip where a major line already is
    const x=Math.round(lamToX(l,W,pad))+.5;
    cx.beginPath();cx.moveTo(x,H-pad.b-5*dpr);cx.lineTo(x,H-pad.b);cx.stroke();
    cx.beginPath();cx.moveTo(x,pad.t);cx.lineTo(x,pad.t+5*dpr);cx.stroke();
  }
  cx.strokeStyle=chartTheme().gridMajor;cx.lineWidth=1*dpr;

  // axis titles
  cx.font=(10*dpr)+'px "Barlow Condensed",sans-serif';cx.fillStyle='#a89372';
  cx.textAlign='center';cx.textBaseline='alphabetic';
  cx.fillText(trT('WAVELENGTH (nm)'),pad.l+(W-pad.l-pad.r)/2,H-4*dpr);
  cx.save();
  cx.translate(11*dpr,pad.t+(H-pad.t-pad.b)/2);
  cx.rotate(-Math.PI/2);
  cx.textAlign='center';cx.textBaseline='alphabetic';
  cx.fillText(trT(isLog()?'TRANSMISSION (log %)':'TRANSMISSION (%)'),0,0);
  cx.restore();

  // region labels
  cx.textBaseline='top';cx.textAlign='center';cx.fillStyle=chartTheme().axisText;
  cx.fillText('UV',(uvX0+uvX1)/2,pad.t+3*dpr);
  cx.fillText(trT('VISIBLE'),(uvX1+visX1)/2,pad.t+3*dpr);
  cx.fillText('NIR',(visX1+nirX1)/2,pad.t+3*dpr);

  const fs=selected.map(id=>FILTERS.find(f=>f.id===id)).filter(Boolean);

  // individual curves (thin) — one line per unique filter, even if stacked more than once
  if(fs.length>1){
    /* Colour alone isn't always enough to tell two lines apart: filters are
       coloured by CATEGORY on purpose (every "IR blocker" filter sits in the
       same green family, every "UV-pass" in the same violet family, so the
       category is visible at a glance) -- but that means two filters from
       the same category, like GRB1 and GRB3, can land on nearly identical
       shades of green. Cycling a dash pattern per curve, independent of its
       colour, means even two near-identical greens are still visually
       distinct: solid next to dashed reads as two lines regardless of hue.
       Three patterns, not more -- past three, telling dash patterns apart
       gets as hard as telling similar colours apart, the same problem this
       is meant to solve, and three maps cleanly onto CSS border-style
       (solid/dashed/dotted) for the legend swatch below to match exactly,
       rather than inventing a fourth pattern the legend can't represent.
       setLineDash persists on the context exactly like shadowBlur/
       shadowColor do, so it's reset to solid ([]) right after, same
       discipline as those two. */
    const DASH_PATTERNS=[[],[7,3],[1,2.4]];
    cx.save();
    cx.beginPath();cx.rect(pad.l,pad.t,W-pad.l-pad.r,H-pad.t-pad.b);cx.clip();
    dedupe(fs).forEach(({f},idx)=>{
      cx.beginPath();
      for(let px=0;px<=(W-pad.l-pad.r);px++){
        const l=viewMin+(px/(W-pad.l-pad.r))*(viewMax-viewMin);
        const x=pad.l+px,y=tToY(filterT(l,f),H,pad);
        px?cx.lineTo(x,y):cx.moveTo(x,y);
      }
      // Crisp, fully-opaque stroke — no glow. A soft neon-style shadow used
      // to sit here (shadowBlur matching the line's own colour), which read
      // as illustrative/hand-drawn rather than a precise technical plot.
      // Dash pattern is kept: unlike the glow, it's functional, not
      // decorative — it's what actually distinguishes two filters that
      // land on nearly identical colours (same category, e.g. two greens).
      cx.setLineDash(DASH_PATTERNS[idx%DASH_PATTERNS.length].map(v=>v*dpr));
      cx.strokeStyle=themeCurveColor(f.c);cx.lineWidth=1.2*dpr;cx.stroke();
      cx.setLineDash([]);
    });
    cx.restore();
  }

  // stacked result (thick, filled)
  if(fs.length){
    cx.save();
    cx.beginPath();cx.rect(pad.l,pad.t,W-pad.l-pad.r,H-pad.t-pad.b);cx.clip();
    cx.beginPath();
    cx.moveTo(pad.l,H-pad.b);
    for(let px=0;px<=(W-pad.l-pad.r);px++){
      const l=viewMin+(px/(W-pad.l-pad.r))*(viewMax-viewMin);
      cx.lineTo(pad.l+px,tToY(systemT(l,fs),H,pad));
    }
    cx.lineTo(W-pad.r,H-pad.b);cx.closePath();
    cx.fillStyle=fs.length>1?chartTheme().stackFill:chartTheme().band;cx.fill();
    cx.beginPath();
    for(let px=0;px<=(W-pad.l-pad.r);px++){
      const l=viewMin+(px/(W-pad.l-pad.r))*(viewMax-viewMin);
      const x=pad.l+px,y=tToY(systemT(l,fs),H,pad);
      px?cx.lineTo(x,y):cx.moveTo(x,y);
    }
    // Crisp, fully-opaque stroke, same reasoning as the individual curves
    // above — no glow, just a clean line. Kept thicker (2.2 vs 1.2) than
    // the individual curves, since this is the headline combined result,
    // not a supporting reference line.
    const stackColor=fs.length>1?'#c2431b':fs[0].c;
    cx.strokeStyle=stackColor;cx.lineWidth=2.2*dpr;cx.stroke();
    cx.restore();
  }else{
    cx.fillStyle='#7a6a52';cx.textAlign='center';cx.textBaseline='middle';
    cx.font=(12*dpr)+'px system-ui,sans-serif';
    cx.fillText(trT('Select one or more filters below'),W/2,H/2);
  }

  drawStrip();
  chartPainted=true;
  updatePanels(fs);
}

/* Retries draw() until the chart element actually has a size, then stops.
   Bounded so a genuinely hidden chart can't spin forever, and self-cancelling
   so overlapping callers don't stack up timers. */
/* The canvas cannot inherit CSS variables, so the chart's palette is defined
   here and switched with the page theme. Read fresh on every draw so toggling
   the theme repaints correctly without any cache to invalidate. */
/* Theme switching.

   Applied to <html> before first paint via the inline script in <head>, so a
   light-mode user never sees a dark flash. The choice is remembered; with no
   stored choice the system preference is followed, and it keeps following the
   system until the button is pressed, after which the explicit choice wins. */
function applyTheme(mode,persist){
  const el=document.documentElement;
  if(mode==='light')el.setAttribute('data-theme','light');
  else el.removeAttribute('data-theme');
  if(persist){ try{ localStorage.setItem('irlabTheme',mode); }catch(e){} }
  const b=document.getElementById('themeBtn');
  if(b){
    b.textContent = mode==='light' ? '\u263e' : '\u2600';
    b.title = 'Switch to '+(mode==='light'?'dark':'light')+' mode';
    b.setAttribute('aria-label','Switch to '+(mode==='light'?'dark':'light')+' mode');
  }
  /* The canvas holds pixels, not styles, so it must be repainted rather than
     restyled — the one part of the page CSS cannot reach. */
  try{ if(typeof draw==='function'){_forceChartRealloc=true;draw();} }catch(e){}
  try{ if(typeof drawStrip==='function')drawStrip(); }catch(e){}
  try{ if(typeof refreshCrgb==='function')refreshCrgb(); }catch(e){}
}
function currentTheme(){
  return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';
}
(function initTheme(){
  const wire=()=>{
    const b=document.getElementById('themeBtn');
    if(!b)return;
    applyTheme(currentTheme(),false);
    b.addEventListener('click',()=>applyTheme(currentTheme()==='light'?'dark':'light',true));
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);
  else wire();
  // follow the system only while the user has not chosen explicitly
  if(window.matchMedia){
    const mq=window.matchMedia('(prefers-color-scheme: light)');
    const onChange=e=>{
      let stored=null;
      try{ stored=localStorage.getItem('irlabTheme'); }catch(_){}
      if(!stored)applyTheme(e.matches?'light':'dark',false);
    };
    if(mq.addEventListener)mq.addEventListener('change',onChange);
    else if(mq.addListener)mq.addListener(onChange);
  }
})();
/* Filter colours are picked to glow against the dark chart. On a light
   background the pale ones — cream, pale yellow, light violet — sit at
   almost the same lightness as the paper and effectively disappear, which
   is worse than a wrong hue: the curve is simply not there.

   Rather than maintain a second palette by hand for 234 filters, the stored
   colour is darkened on the fly in light mode. Hue and the relative
   saturation are preserved, so a filter keeps its identity and still matches
   its swatch in the list; only lightness is capped, to a level that holds
   contrast against #faf7f2. Saturation is nudged up slightly because
   darkening alone tends to read as grey. */
function themeCurveColor(hex){
  if(document.documentElement.getAttribute('data-theme')!=='light')return hex;
  if(typeof hex!=='string')return hex;
  const m=/^#([0-9a-f]{6})$/i.exec(hex.trim());
  if(!m)return hex;
  const n=parseInt(m[1],16);
  let r=(n>>16&255)/255, g=(n>>8&255)/255, b=(n&255)/255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  let h=0, l=(mx+mn)/2, sat=0;
  if(d>0){
    sat=l>0.5?d/(2-mx-mn):d/(mx+mn);
    if(mx===r)h=((g-b)/d+(g<b?6:0));
    else if(mx===g)h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h/=6;
  }
  sat=Math.min(1,sat*1.15+0.05);      // keep it from reading as grey
  const hue2rgb=(p,q,t)=>{
    if(t<0)t+=1; if(t>1)t-=1;
    if(t<1/6)return p+(q-p)*6*t;
    if(t<1/2)return q;
    if(t<2/3)return p+(q-p)*(2/3-t)*6;
    return p;
  };
  const toRGB=(L)=>{
    const q=L<0.5?L*(1+sat):L+sat-L*sat, p=2*L-q;
    return [hue2rgb(p,q,h+1/3),hue2rgb(p,q,h),hue2rgb(p,q,h-1/3)];
  };
  /* Darken until the contrast target is met, rather than capping lightness at
     a fixed value. A single cap cannot work across hues: at the same HSL
     lightness a yellow is far brighter than a blue, so 0.42 gave violet a
     contrast of 9.4 and yellow only 2.2 — still invisible, which was the
     original complaint. Measuring the actual relative luminance and stepping
     down until it clears 3.5:1 treats every hue on its own terms. */
  const rel=(v)=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);
  const lumOf=(c)=>0.2126*rel(c[0])+0.7152*rel(c[1])+0.0722*rel(c[2]);
  const paper=lumOf([0.925,0.898,0.851]);   // #ece5d9, the light chart background
  let L=Math.min(l,0.5), out=toRGB(L);
  for(let i=0;i<24;i++){
    const ratio=(paper+0.05)/(lumOf(out)+0.05);
    if(ratio>=3.5||L<=0.08)break;
    L-=0.02; out=toRGB(L);
  }
  const to=(v)=>('0'+Math.round(Math.max(0,Math.min(1,v))*255).toString(16)).slice(-2);
  return '#'+to(out[0])+to(out[1])+to(out[2]);
}
function chartTheme(){
  const light=document.documentElement.getAttribute('data-theme')==='light';
  return light?{
    /* Matched to the dimmer paper. Grid and tints are strengthened slightly:
       on a bright white they were already faint, and on a warmer, darker
       ground they would disappear entirely at the old opacities. */
    bg:'#ece5d9',
    gridMajor:'rgba(96,80,58,.50)',
    gridMinor:'rgba(96,80,58,.26)',
    axisText:'rgba(58,46,32,.88)',
    uvTint:'rgba(104,86,180,.09)',
    visTint:'rgba(140,128,96,.10)',
    nirTint:'rgba(170,58,22,.09)',
    band:'rgba(26,99,80,.18)',
    stackFill:'rgba(156,51,13,.20)'
  }:{
    bg:'#0b0c0e',
    gridMajor:'rgba(70,74,82,.60)',
    gridMinor:'rgba(70,74,82,.36)',
    axisText:'rgba(163,160,151,.78)',
    uvTint:'rgba(143,122,214,.06)',
    visTint:'rgba(237,226,206,.04)',
    nirTint:'rgba(194,67,27,.06)',
    band:'rgba(111,171,150,.18)',
    stackFill:'rgba(194,67,27,.22)'
  };
}
let chartPainted=false,_chartRetry=0,_chartPending=false;
/* Visible diagnostic. Everything here is read from the live DOM/canvas at the
   moment it is shown, so it reports the device's actual state rather than an
   assumption about it. Shown automatically when the chart is detected blank,
   and dismissible. */
function showChartDiag(){
  const cv=document.getElementById('chart');
  if(!cv)return;
  let box=document.getElementById('chartDiag');
  if(!box){
    box=document.createElement('div');
    box.id='chartDiag';
    box.style.cssText='position:absolute;left:8px;top:8px;right:8px;z-index:9;font:11px/1.45 ui-monospace,monospace;'
      +'background:rgba(20,8,4,.94);border:1px solid #7a2e12;border-radius:4px;padding:8px 10px;color:#f0d8c8;white-space:pre-wrap';
    const wrap=document.getElementById('chartWrap')||cv.parentNode;
    if(getComputedStyle(wrap).position==='static')wrap.style.position='relative';
    wrap.appendChild(box);
    box.addEventListener('click',()=>box.remove());
  }
  let alpha='n/a';
  try{
    if(cv.width>1&&cv.height>1)
      alpha=cv.getContext('2d').getImageData((cv.width/2)|0,(cv.height/2)|0,1,1).data[3];
  }catch(e){ alpha='getImageData failed: '+e.message; }
  const r=cv.getBoundingClientRect();
  box.textContent=
    'CHART DIAGNOSTIC (tap to dismiss)\n'
    +'canvas buffer : '+cv.width+' x '+cv.height+'\n'
    +'css size      : '+Math.round(r.width)+' x '+Math.round(r.height)+'\n'
    +'devicePixelRatio: '+(window.devicePixelRatio||1)+'  cap '+chartDprCap+'\n'
    +'centre alpha  : '+alpha+'   (255 painted, 0 blank)\n'
    +'chartPainted  : '+chartPainted+'   retries '+_chartRetry+'\n'
    +'selected      : '+(typeof selected!=='undefined'?selected.join(',')||'(none)':'?')+'\n'
    +'view          : '+(typeof viewMin!=='undefined'?viewMin+'-'+viewMax:'?')+'\n'
    +'last draw error: '+(_lastDrawError||'none');
}
/* Set by the loss detector to force a fresh backing store on the next draw. */
let _forceChartRealloc=false;
/* Lowered to 1 only if the chart repeatedly fails to allocate — see repaintIfLost. */
let chartDprCap=2;
function scheduleChartDraw(){
  if(_chartPending)return;
  _chartPending=true;
  const attempt=()=>{
    _chartPending=false;
    const cv=$('chart');
    if(!cv)return;
    const r=cv.getBoundingClientRect();
    if(r.width>=50&&r.height>=20){_chartRetry=0;draw();return;}
    if(_chartRetry++>90)return; // ~3s at 30fps; the chart is genuinely not displayed
    _chartPending=true;
    setTimeout(()=>requestAnimationFrame(attempt),33);
  };
  requestAnimationFrame(attempt);
}

/* Everything that is TEXT rather than canvas. Split out of draw() because the
   layout guard above can legitimately skip a paint (the element isn't sized
   yet), and when it did, the readout, legend and summary silently stopped
   updating too — the numbers must not depend on whether a canvas happens to
   be measurable this frame. */
function updatePanels(fs){
  if(typeof updateAoiNote==='function')updateAoiNote(fs);
  updateLegend(fs);
  updateReadout(fs);
  $('stackSummary').textContent=summarise(fs);
  renderBehaviour(fs);
  if(typeof crgbUpdate==='function')crgbUpdate();
}

function drawStrip(dprOverride){
  const cv=$('specStrip'),rect=cv.getBoundingClientRect(),dpr=dprOverride||window.devicePixelRatio||1;
  // same layout guard as draw() — a stale width here drew the spectrum
  // compressed into the middle of the strip
  if(rect.width<50){
    if(!dprOverride)requestAnimationFrame(()=>{
      if(cv.getBoundingClientRect().width>=50)drawStrip();
    });
    return;
  }
  const W=Math.max(1,Math.round(rect.width*dpr)),H=Math.max(1,Math.round(rect.height*dpr));
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H;}
  const cx=cv.getContext('2d');
  const pad={l:44*dpr,r:12*dpr};
  cx.clearRect(0,0,W,H);
  cx.fillStyle=chartTheme().bg;cx.fillRect(0,0,W,H);
  const span=W-pad.l-pad.r;
  for(let px=0;px<span;px++){
    const l=LMIN+(px/span)*(LMAX-LMIN);
    const [r,g,b]=lamRGB(l);
    if(r||g||b){cx.fillStyle='rgb('+r+','+g+','+b+')';cx.fillRect(pad.l+px,0,1.5,H);}
  }
}

function updateLegend(fs){
  const el=$('legend');el.innerHTML='';
  if(fs.length>1){
    /* Swatches were a solid filled block, which only ever showed colour --
       now that two curves of a similar colour are told apart by dash
       pattern (see the comment above the DASH_PATTERNS array in draw()),
       the legend has to show that too, or it stops matching what's
       actually on the chart. A short border-top line reads as "this is
       what the actual curve looks like" much more directly than a filled
       rectangle ever did, dash pattern included. Border-style only has
       solid/dashed/dotted natively, which is exactly why DASH_PATTERNS
       above is three long and not four -- so this can represent every
       pattern the chart actually uses, not approximate a fourth. */
    const BORDER_STYLES=['solid','dashed','dotted'];
    dedupe(fs).forEach(({f,n},idx)=>{
      const d=document.createElement('span');d.className='lg';
      const style=BORDER_STYLES[idx%BORDER_STYLES.length];
      /* Same darkening as the curve itself, or the key would show a pale
         swatch next to a dark line and stop being a key. */
      d.innerHTML='<i style="display:inline-block;width:16px;height:0;border-top:2px '+style+' '+themeCurveColor(f.c)+';opacity:.85;vertical-align:middle"></i>'+f.n+(n>1?' \u00d7'+n:'');
      el.appendChild(d);
    });
    const d=document.createElement('span');d.className='lg';
    d.innerHTML='<i style="background:#c2431b;height:4px"></i><b style="color:var(--paper)">Stacked result</b>';
    el.appendChild(d);
  }
  $('stackName').textContent=fs.length?dedupe(fs).map(({f,n})=>f.n+(n>1?' \u00d7'+n:'')).join('  +  '):'nothing selected';
  updateStickyStack(fs);
  updatePlainSummary(fs);
}

/* Keeps the current stack and its headline numbers visible while scrolling
   the filter list — on a phone the chart is far off-screen by the time you're
   picking a third filter, so there was no feedback that anything changed. */
/* Plain-English summary + practical warnings about the stack, written for
   someone who cannot read a transmission curve. Everything here is derived
   from the same sampled curve the readout cards use — no new physics, just
   the answer stated in words instead of numbers. */
/* Data health — the provenance mix of the whole database, computed from the
   same dataConfidence() the per-filter badges use, so the headline can never
   drift from what the badges actually say. */
function renderDataHealth(){
  const el=$('dataHealth');if(!el)return;
  const counts={real:0,fitq:0,fit:0,est:0};
  const errs=[];
  FILTERS.forEach(f=>{
    const c=dataConfidence(f);
    counts[c.tier]=(counts[c.tier]||0)+1;
    if(c.tier==='fitq'){
      const m=c.label.match(/([\d.]+)pp/);
      if(m)errs.push(parseFloat(m[1]));
    }
  });
  const total=FILTERS.length||1;
  const COLORS={real:'rgba(111,171,150,.85)',fitq:'rgba(140,178,122,.8)',
                fit:'rgba(216,161,58,.75)',est:'rgba(122,106,82,.7)'};
  const LABELS={real:'REAL — digitised curve',fitq:'FIT — fitted, error quantified',
                fit:'FIT — fitted, error not quantified',est:'EST — no measurement'};
  const order=['real','fitq','fit','est'];
  const pct=k=>(counts[k]/total*100);
  el.innerHTML=
    '<div class="dh-bar">'+order.map(k=>counts[k]?
      '<div class="dh-seg" style="width:'+pct(k).toFixed(2)+'%;background:'+COLORS[k]+'" title="'+
      LABELS[k]+': '+counts[k]+'"></div>':'').join('')+'</div>'+
    '<div class="dh-legend">'+order.map(k=>
      '<span><i style="background:'+COLORS[k]+'"></i>'+LABELS[k]+' &mdash; <b style="color:var(--paper)">'+
      counts[k]+'</b> ('+pct(k).toFixed(0)+'%)</span>').join('')+'</div>'+
    '<div class="dh-note">'+total+' filters total. '+
      (counts.real+counts.fitq)+' ('+((counts.real+counts.fitq)/total*100).toFixed(0)+
      '%) are backed by a digitised curve or a fit with a documented error figure.'+
      (errs.length?' Quantified fits span '+Math.min(...errs).toFixed(1)+'pp to '+
        Math.max(...errs).toFixed(1)+'pp RMS \u2014 the badge shows each one, so a rough fit '+
        'never reads the same as a tight one.':'')+
      ' Note a digitised curve read by eye off a low-resolution chart is not automatically better '+
      'than a least-squares fit against a published table; the tier describes how the data is '+
      'stored as much as how good it is.'+
    '</div>';
}
renderDataHealth();
