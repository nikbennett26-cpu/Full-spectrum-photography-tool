/* ---------- data integrity self-test ----------
   Written after a run of real errors that all shipped silently: a curve whose
   edge sat ~10nm off its own note's quoted table values, a colour-naming
   function with no case below 450nm, and an exposure calculation that was
   wrong for every IR filter. None of those were detectable by reading the
   code — only by checking the data against itself. This does that check.

   Deliberately NOT a unit-test framework: it validates the shipped data in
   the shipped page, so it can't drift out of sync with what users actually
   load. */
function runDataSelfTest(){
  const issues=[];
  const add=(sev,id,msg)=>issues.push({sev,id,msg});

  // --- REAL_CURVES structural checks ---
  Object.keys(REAL_CURVES).forEach(id=>{
    const arr=REAL_CURVES[id];
    if(!FILTERS.some(f=>f.id===id)){add('error',id,'REAL_CURVES entry has no matching filter id');return;}
    if(!Array.isArray(arr)||arr.length<4){add('error',id,'curve is missing or too short');return;}
    if(arr.length%2!==0){add('error',id,'curve has an odd number of values (must be wavelength,value pairs)');return;}
    let prevL=-Infinity,bad=0,neg=0,over=0;
    for(let i=0;i<arr.length;i+=2){
      const l=arr[i],t=arr[i+1];
      if(!Number.isFinite(l)||!Number.isFinite(t)){bad++;continue;}
      if(l<=prevL)add('error',id,'wavelengths not strictly ascending at '+l+'nm');
      prevL=l;
      if(t<0)neg++; else if(t>1)over++;
    }
    if(bad)add('error',id,bad+' non-numeric value(s) in curve');
    if(neg)add('error',id,neg+' negative transmission value(s) — physically impossible, usually digitisation noise; clamp to 0');
    if(over)add('error',id,over+' value(s) above 1.0 — curves are stored as fractions (0-1), not percentages');
    const first=arr[0],last=arr[arr.length-2];
    if(first>320)add('warn',id,'curve starts at '+first+'nm — no data below that, will extrapolate');
    if(last<1000)add('warn',id,'curve ends at '+last+'nm — NIR behaviour above that is extrapolated');
  });

  // --- every filter must produce a finite curve across the whole range ---
  FILTERS.forEach(f=>{
    let nan=0,oob=0,peak=0;
    for(let l=LMIN;l<=LMAX;l+=5){
      const t=filterT(l,f);
      if(!Number.isFinite(t)){nan++;continue;}
      if(t<-1e-9||t>1.0001)oob++;
      if(t>peak)peak=t;
    }
    if(nan)add('error',f.id,nan+' non-finite transmission sample(s)');
    if(oob)add('error',f.id,oob+' sample(s) outside 0-1');
    if(peak<=0)add('error',f.id,'filter is completely opaque at every wavelength — data likely missing');
  });

  /* --- notes that quote anchor points should agree with the stored curve ---
     This is the check that would have caught w8's ~10nm edge shift. It is a
     HEURISTIC and produces known false positives: several notes deliberately
     quote a superseded or third-party figure while explaining why it's wrong
     (nf550 does exactly that). So these are warnings to eyeball, never
     failures — a note that documents its own disagreement is good practice,
     not a data fault. */
  FILTERS.forEach(f=>{
    if(!f.same||REAL_CURVES[f.id]==null)return;
    // notes that explicitly discuss superseding a figure are expected to disagree
    const supersedes=/replaces|corrected|superseded|previously|used to|old fit|earlier/i.test(f.same);
    const pairs=[...f.same.matchAll(/([0-9]{1,3}(?:\.[0-9]+)?)\s*%\s*at\s*([0-9]{3,4})\s*nm/gi)];
    pairs.forEach(m=>{
      const claimed=parseFloat(m[1])/100, lam=parseInt(m[2],10);
      if(lam<LMIN||lam>LMAX)return;
      const actual=filterT(lam,f);
      const diff=Math.abs(actual-claimed);
      if(diff>0.08)add(supersedes?'info':'warn',f.id,'note quotes '+m[1]+'% at '+lam+'nm but the curve gives '+
        (actual*100).toFixed(1)+'% ('+(diff*100).toFixed(1)+'pp apart)'+
        (supersedes?' — note mentions a correction/supersession, so this is probably deliberate; verify.':
                    ' — check which is right.'));
    });
  });

  /* --- sensor QE channel coverage ---
     The R, G and B curves in a QE dataset do not always span the same
     wavelength range: the CMOS set has R and B ending at 995nm while G runs
     to 1100nm. Null samples are skipped during integration, so a channel with
     a shorter range is integrated over less spectrum than its neighbours —
     which silently biases white balance and predicted colour for any stack
     with significant throughput out there (a 950nm IR filter puts ~72% of its
     light in that gap). Extrapolating would be inventing data, so this
     reports the mismatch instead. */
  Object.keys(CAMERA_QE).forEach(name=>{
    const set=CAMERA_QE[name];
    const extent={};
    ['R','G','B'].forEach(ch=>{
      const a=set[ch]; if(!a)return;
      let lo=null,hi=null;
      for(let i=0;i<a.length;i++)if(Number.isFinite(a[i])){lo=WL_GRID[i];break;}
      for(let i=a.length-1;i>=0;i--)if(Number.isFinite(a[i])){hi=WL_GRID[i];break;}
      extent[ch]=[lo,hi];
    });
    const his=['R','G','B'].map(ch=>extent[ch]&&extent[ch][1]).filter(v=>v!=null);
    const los=['R','G','B'].map(ch=>extent[ch]&&extent[ch][0]).filter(v=>v!=null);
    if(his.length!==3)return;
    const commonHi=Math.min(...his), commonLo=Math.max(...los);
    /* A range mismatch only MATTERS if the longer-ranged channel actually has
       meaningful sensitivity in the gap. On the CMOS set the gap is 996-999nm
       where G reads ~2% and then zero — negligible, not worth flagging. The
       Eye set stores explicit zeros rather than nulls past 700nm, which is
       likewise harmless. So measure the gap's real weight instead of just
       comparing endpoints, or this cries wolf on every dataset. */
    let worstGapQE=0;
    ['R','G','B'].forEach(ch=>{
      const a=set[ch]; if(!a)return;
      for(let i=0;i<a.length;i++){
        const l=WL_GRID[i];
        if((l>commonHi||l<commonLo)&&Number.isFinite(a[i]))worstGapQE=Math.max(worstGapQE,a[i]);
      }
    });
    if(worstGapQE>1){
      add('info','(sensor '+name+')','channel data ranges differ — R '+extent.R.join('-')+
        'nm, G '+extent.G.join('-')+'nm, B '+extent.B.join('-')+'nm, and the channel that extends '+
        'further reads up to '+worstGapQE.toFixed(1)+'% QE in the gap. Stacks passing light there are '+
        'integrated unevenly across channels, biasing white balance and predicted colour.');
    }
  });

  /* --- filter type coverage ---
     Type drives the angle-of-incidence model: interference filters blue-shift,
     absorptive ones don't. An untyped filter is silently excluded from that
     model, so this reports the gap rather than letting it sit invisible. */
  let typedI=0,typedA=0,untyped=[];
  FILTERS.forEach(f=>{
    if(f.type==='interference')typedI++;
    else if(f.type==='absorptive')typedA++;
    else untyped.push(f.id);
  });
  if(untyped.length){
    add('info','(coverage)',untyped.length+' of '+FILTERS.length+' filters have no type field ('+
      typedI+' interference, '+typedA+' absorptive tagged) — these are excluded from the '+
      'angle-of-incidence model. First few: '+untyped.slice(0,8).join(', ')+
      (untyped.length>8?', …':''));
  }

  /* --- note reference rot ---
     Notes cross-reference other filters by id ("see hy_k2's note"). When an id
     is renamed or removed, those references rot silently — which matters here
     because the notes ARE the provenance record. Only underscore-style ids are
     checked, and anything sitting inside a URL or filename is skipped, since
     paths like "eo_pdf" in a datasheet link look identical to an id otherwise. */
  const allIds=new Set(FILTERS.map(f=>f.id));
  FILTERS.forEach(f=>{
    if(!f.same)return;
    const seen=new Set();
    // not preceded or followed by / . - which would make it part of a path
    const re=/(^|[^\w\/.\-])([a-z][a-z0-9]*_[a-z0-9_]{2,})(?![\w\/.\-])/g;
    let m;
    while((m=re.exec(f.same))!==null){
      const ref=m[2];
      if(seen.has(ref)||allIds.has(ref))continue;
      seen.add(ref);
      add('info',f.id,'note references "'+ref+'", which is not a filter id in this build — check for a rename or removal');
    }
  });

  // --- duplicate ids ---
  const seen=new Set();
  FILTERS.forEach(f=>{
    if(seen.has(f.id))add('error',f.id,'duplicate filter id');
    seen.add(f.id);
  });

  /* --- same product, two entries, different data ---

     Duplicate IDs are already caught above, but the more dangerous case has
     distinct ids and the same product NAME. The database currently holds two
     Hoya RM90s and two Hoya RM100s from different digitising batches, and
     their curves disagree materially -- the RM100 pair differ by 15
     percentage points at 1100nm. Someone searching "RM100" gets two results
     and nothing to tell them which to trust, which is exactly the kind of
     silent wrongness this tool exists to avoid. Flagged rather than
     auto-resolved: deciding which digitisation is better needs the
     datasheets, not a heuristic. */
  const byName=new Map();
  FILTERS.forEach(f=>{
    const key=f.n.trim().toLowerCase();
    if(!byName.has(key))byName.set(key,[]);
    byName.get(key).push(f);
  });
  byName.forEach((group,key)=>{
    if(group.length<2)return;
    let maxGap=0;
    for(let a=0;a<group.length;a++)for(let b=a+1;b<group.length;b++){
      for(let l=LMIN;l<=LMAX;l+=10){
        const d=Math.abs(systemT(l,[group[a]])-systemT(l,[group[b]]));
        if(d>maxGap)maxGap=d;
      }
    }
    const ids=group.map(f=>f.id).join(', ');
    if(maxGap>0.05)
      add('error',ids,group.length+' entries named "'+group[0].n+'" whose curves differ by up to '
          +(maxGap*100).toFixed(0)+'pp — one of them is wrong');
    else
      add('info',ids,group.length+' entries named "'+group[0].n+'" with matching curves (harmless, but duplicated)');
  });

  /* --- the panels must agree with each other ---

     Every number on screen is derived from the same curves, so two panels
     reporting different figures for the same stack means one of them is
     computing it wrongly. This is here because exactly that happened and
     nothing caught it: the measurement card was fixed to measure light loss
     over the band a stack actually passes, the sticky header kept averaging
     400-700nm regardless, and a 950nm filter read "50.4 stops" in the header
     while the card beneath it said 1.6. Both had been "verified" -- but only
     ever one at a time, never against each other.

     Checks a spread of stacks covering visible, IR and UV passbands, since
     the original bug only showed on stacks that block the visible. */
  (function crossPanelAgreement(){
    const bandLoss=(fs)=>{
      const T=sampledSystem(fs);
      let peak=0;
      for(let l=LMIN;l<=LMAX;l++)peak=Math.max(peak,T[l-LMIN]);
      const pk=(a,b)=>{let m=0;for(let l=a;l<=b;l++)m=Math.max(m,T[l-LMIN]);return m;};
      const uvPk=pk(LMIN,399),visPk=pk(400,699),nirPk=pk(700,LMAX);
      const visBlocked=visPk<peak*0.15;
      let lo=400,hi=700;
      if(visBlocked&&nirPk>=uvPk&&nirPk>0){lo=700;hi=LMAX;}
      else if(visBlocked&&uvPk>nirPk&&uvPk>0){lo=LMIN;hi=400;}
      let sum=0,n=0;
      for(let l=lo;l<=hi;l++){sum+=T[l-LMIN];n++;}
      const avg=n?sum/n:0;
      return avg>0?-Math.log2(avg):Infinity;
    };
    const samples=[['r72'],['ir950'],['sch_rg1000'],['qb21','w12','didy'],['sch_ug5'],['stc_irp720','sch_rg850']];
    samples.forEach(ids=>{
      const fs=ids.map(i=>FILTERS.find(f=>f.id===i)).filter(Boolean);
      if(fs.length!==ids.length)return;
      const loss=bandLoss(fs);
      /* A real photographic stack does not lose 15 stops inside its own
         passband. A figure that large means the loss is being measured over a
         band the stack blocks, which is the bug this check exists for. */
      if(isFinite(loss)&&loss>15)
        add('error',ids.join('+'),'light loss of '+loss.toFixed(1)+' stops reported inside the stack\u2019s own passband \u2014 almost certainly measured over a blocked band');
    });
  })();

  // --- badge integrity: a quantified-fit badge must have a parseable figure ---
  FILTERS.forEach(f=>{
    const c=dataConfidence(f);
    if(c.tier==='fitq'&&!/[\d.]+pp/.test(c.label))add('error',f.id,'quantified-fit badge with no error figure');
  });

  /* --- provenance (build 146) ---
     Every filter must say where its curve comes from, and what it says must match what is stored: a method that
     claims real data needs a stored curve behind it, and a fit or estimate must not secretly be one. */
  const STORED=['tab','meas','trace','chart','eye','der'];
  FILTERS.forEach(f=>{
    const p=provenanceOf(f);
    if(!PROV_METHOD[p.m]){add('error',f.id,'unknown provenance method "'+p.m+'"');return;}
    if(p.s&&!SOURCES[p.s])add('error',f.id,'provenance names source "'+p.s+'", which is not in SOURCES');
    const has=REAL_CURVES[f.id]!=null;
    if(STORED.includes(p.m)&&!has)add('error',f.id,'provenance says "'+p.m+'" (real data) but no stored curve backs it');
    if(!STORED.includes(p.m)&&has)add('error',f.id,'a stored curve is labelled "'+p.m+'" — say what kind of real data it is');
    if(p.m!=='est'&&p.m!=='fit'&&!p.s&&!/^custom_/.test(f.id))add('warn',f.id,'real data with no structured source');
    if(p.cc&&p.ccd!=null&&p.ccd>4)add('warn',f.id,'differs from its CheeseCube312 file by '+p.ccd+' points — more than resampling explains');
    if(p.glass&&!SCHOTT_GLASS[p.glass])add('error',f.id,'SCHOTT glass '+p.glass+' has no table');
  });
  Object.keys(PROV).forEach(id=>{if(!FILTERS.some(f=>f.id===id))add('error',id,'PROV entry for a filter id that does not exist');});

  /* --- surface-loss ceiling (build 146) ---
     An uncoated piece of glass loses roughly 4% at each of its two surfaces, so it cannot pass more than about 92%
     anywhere (SCHOTT's reflection factors run 0.908-0.923). 32 SCHOTT curves shipped at up to 99.7% because the
     internal transmittance was used as if it were the filter's; this is the check that would have caught them.
     Interference coatings and AR-coated glass are exempt. */
  FILTERS.forEach(f=>{
    if(f.type!=='absorptive'||f.ar||f.g==='Custom')return;
    let pk=0;for(let l=LMIN;l<=LMAX;l+=5)pk=Math.max(pk,filterTBase(l,f));
    if(pk>0.935)add('error',f.id,'uncoated absorptive glass peaks at '+(pk*100).toFixed(1)+
      '% — more than two bare surfaces allow (~92%); internal transmittance used as external?');
  });

  return issues;
}

function renderSelfTest(){
  const out=$('selfTestOut');if(!out)return;
  out.style.display='';
  out.innerHTML='<p class="note" style="margin:0">Running…</p>';
  setTimeout(()=>{
    const issues=runDataSelfTest();
    const errs=issues.filter(i=>i.sev==='error'), warns=issues.filter(i=>i.sev==='warn'),
          infos=issues.filter(i=>i.sev==='info');
    let html='<p class="note" style="margin:0 0 8px"><b style="color:'+
      (errs.length?'#c2431b':'var(--phosphor)')+'">'+
      (errs.length?errs.length+' error'+(errs.length===1?'':'s'):'No structural errors')+'</b>'+
      ' · '+warns.length+' warning'+(warns.length===1?'':'s')+
      ' · '+infos.length+' to eyeball'+
      ' across '+FILTERS.length+' filters and '+Object.keys(REAL_CURVES).length+' digitised curves.</p>';
    if(issues.length){
      html+='<div style="max-height:260px;overflow:auto;font-family:var(--font-mono);font-size:11px;line-height:1.6">'+
        errs.concat(warns,infos).slice(0,200).map(i=>
          '<div style="padding:3px 0;border-bottom:1px solid var(--line)">'+
          '<span style="color:'+(i.sev==='error'?'#c2431b':i.sev==='warn'?'var(--warn)':'var(--muted)')+'">'+i.sev.toUpperCase()+'</span> '+
          '<b style="color:var(--paper)">'+i.id+'</b> — '+i.msg+'</div>').join('')+'</div>';
      if(issues.length>200)html+='<p class="note">…and '+(issues.length-200)+' more.</p>';
    }
    out.innerHTML=html;
  },10);
}

/* One sampled copy of the stack curve per update, shared by everything that
   needs it. Each of updateReadout / updatePlainSummary / updateStickyStack /
   describeStack was independently walking all 821 wavelengths and calling
   systemT() at each one — and systemT loops every filter and every band per
   call, so the cost multiplied. On a phone that was a visible delay before
   the chart appeared. Cached on the selection plus camera body, which are the
   only things that change the result. */
let _sysSampleCache={key:null,T:null};
function sampledSystem(fs){
  const key=fs.map(f=>f.id).join('|')+'#'+((typeof cameraBrand!=='undefined')?cameraBrand:'');
  if(_sysSampleCache.key===key&&_sysSampleCache.T)return _sysSampleCache.T;
  const T=new Float64Array(LMAX-LMIN+1);
  for(let l=LMIN;l<=LMAX;l++)T[l-LMIN]=systemT(l,fs);
  _sysSampleCache={key,T};
  return T;
}
function invalidateSysSample(){_sysSampleCache={key:null,T:null};}

function updatePlainSummary(fs){
  const box=$('plainSummary'),adv=$('stackAdvice');
  if(!box||!adv)return;
  if(!fs||!fs.length){box.style.display='none';adv.style.display='none';return;}

  const T=sampledSystem(fs);let peak=0,peakL=LMIN;
  for(let l=LMIN;l<=LMAX;l++){const t=T[l-LMIN];if(t>peak){peak=t;peakL=l;}}
  const at=l=>T[l-LMIN];
  const bandMax=(a,b)=>{let m=0;for(let l=a;l<=b;l++)m=Math.max(m,at(l));return m;};
  const uv=bandMax(280,399),vis=bandMax(400,699),nir=bandMax(700,1100);
  let visSum=0,visN=0;for(let l=400;l<=700;l++){visSum+=at(l);visN++;}
  const avgVis=visN?visSum/visN:0;
  const stops=avgVis>0?-Math.log2(avgVis):Infinity;

  // what does it actually let through?
  const passes=[];
  if(uv>peak*0.25)passes.push('ultraviolet');
  if(vis>peak*0.25)passes.push('visible light');
  if(nir>peak*0.25)passes.push('infrared');
  const blocks=[];
  if(uv<peak*0.05)blocks.push('ultraviolet');
  if(vis<peak*0.05)blocks.push('visible light');
  if(nir<peak*0.05)blocks.push('infrared');

  // where the peak sits, in words (UV below 400 is NOT 'violet')
  const colourOf=l=>l<315?'deep ultraviolet':l<400?'ultraviolet':l<450?'violet':l<495?'blue':
                    l<570?'green':l<590?'yellow':l<620?'orange':l<700?'red':
                    l<800?'deep red / near-infrared':'infrared';
  let sentence='This stack mainly passes <b>'+colourOf(peakL)+'</b> around <b>'+peakL+'nm</b>';
  sentence+=', peaking at <b>'+(peak*100).toFixed(0)+'%</b> transmission. ';
  if(passes.length)sentence+='It lets through '+passes.join(' and ')+'. ';
  if(blocks.length)sentence+='It blocks '+blocks.join(' and ')+' almost completely. ';

  /* Exposure loss has to be measured over the band the stack actually PASSES.
     Quoting visible-band stops for a 720nm IR filter produced "12.7 stops,
     very dark" for what is in practice an ordinary handheld IR filter — the
     visible light it blocks is the entire point, not a loss to compensate. */
  const visBlocked = vis < peak*0.15;
  let bandLo=400,bandHi=700,bandName='visible light';
  if(visBlocked&&nir>=uv&&nir>0){bandLo=700;bandHi=1100;bandName='its infrared passband';}
  else if(visBlocked&&uv>nir&&uv>0){bandLo=280;bandHi=400;bandName='its ultraviolet passband';}
  let bSum=0,bN=0;for(let l=bandLo;l<=bandHi;l++){bSum+=at(l);bN++;}
  const bandAvg=bN?bSum/bN:0;
  const bandStops=bandAvg>0?-Math.log2(bandAvg):Infinity;
  if(!isFinite(bandStops)||bandAvg<=0){
    sentence+='It passes essentially no light anywhere — check the combination.';
  }else if(visBlocked){
    sentence+='Within '+bandName+' it loses about <b>'+bandStops.toFixed(1)+' stops</b>. '+
      'Your camera’s meter reads the blocked visible light, so expect it to under-read — '+
      'bracket or test rather than trusting the first exposure.';
  }else{
    sentence+='Expect to lose roughly <b>'+bandStops.toFixed(1)+' stops</b> of light'+
      (bandStops>6?' — that is a tripod-and-long-exposure filter, not a handheld one.':
       bandStops>3?' — usable handheld in bright sun, tripod otherwise.':'.');
  }
  box.innerHTML=sentence;box.style.display='';
  /* The chart is a canvas — invisible to a screen reader. This summary is
     already a plain-language description of exactly what it plots, so it
     doubles as the canvas's text alternative rather than writing a second
     one that could drift out of sync. */
  const chartCv=$('chart');
  if(chartCv)chartCv.setAttribute('aria-label','Transmission chart. '+sentence.replace(/<[^>]+>/g,''));

  // ---- practical warnings ----
  const notes=[];
  if(peak<0.01){
    notes.push(['bad','<b>This stack is effectively opaque.</b> Peak transmission is '+
      (peak*100).toFixed(2)+'% — there is almost certainly no exposure that gets a usable image out of it.']);
  }
  // redundant duplicates of the same category doing the same job
  const uniq=dedupe(fs);
  if(uniq.length>1){
    uniq.forEach(({f})=>{
      const without=fs.filter(x=>x.id!==f.id);
      if(!without.length)return;
      let maxDiff=0;
      for(let l=LMIN;l<=LMAX;l+=5)maxDiff=Math.max(maxDiff,Math.abs(systemT(l,without)-systemT(l,fs)));
      if(maxDiff<0.02){
        notes.push(['','<b>'+f.n+' is doing almost nothing here.</b> Removing it changes the '+
          'combined curve by under 2 percentage points at every wavelength — another filter in the '+
          'stack already blocks everything it would have.']);
      }
    });
  }
  // UV work ruined by an IR leak
  if(uv>peak*0.5&&nir>peak*0.15){
    notes.push(['bad','<b>Infrared leak on a UV stack.</b> It passes '+(nir/peak*100).toFixed(0)+
      '% of peak out in the infrared, which will swamp the UV signal. Add an IR blocker such as S8612 or BG39.']);
  }
  // dual band = faux colour
  if(vis>0.1&&nir>0.1&&blocks.indexOf('visible light')===-1){
    notes.push(['good','<b>Dual-band stack.</b> Passing visible and infrared together is what produces '+
      'faux-colour / Aerochrome-style results after a channel swap.']);
  }
  /* Only warn about darkness using the passband figure — a UV or IR filter
     blocking visible light is doing its job, not being "very dark". */
  if(isFinite(bandStops)&&bandStops>6){
    notes.push(['','<b>Very dark even within its own passband.</b> About '+bandStops.toFixed(1)+
      ' stops — expect long exposures, and check your camera can still focus through it.']);
  }
  if(notes.length){
    adv.innerHTML=notes.map(([cls,html])=>'<div class="advice '+cls+'">'+html+'</div>').join('');
    adv.style.display='';
  }else{adv.style.display='none';}
}

/* Filter names come from the database, not user input, but they are being
   interpolated into an HTML attribute here and several contain quotes and
   ampersands (B+W, 2"/48mm, Wratten #12). Escaping is cheaper than finding
   out later which name breaks the markup. */
function esc(t){
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
/* Delegated so it survives the bar being re-rendered on every stack change. */
(function initStackChipRemoval(){
  const bar=document.getElementById('stickyStack');
  if(!bar)return;
  function removeFrom(el){
    const chip=el.closest&&el.closest('.ssChip');
    if(!chip)return false;
    const id=chip.getAttribute('data-rm');
    if(!id)return false;
    /* Reuses the existing clearFilter(), which already removes every copy,
       resyncs that filter's button in the list and redraws. Writing a second
       removal path here would be the one that drifts out of step the next
       time selection handling changes.

       Removing every copy is right: the chip shows a count when a filter is
       stacked on itself, so removing what you can see means removing what the
       chip represents, not peeling off one layer of it. */
    clearFilter(id);
    return true;
  }
  bar.addEventListener('click',e=>{ if(removeFrom(e.target)){e.stopPropagation();e.preventDefault();} },true);
  bar.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    if(removeFrom(e.target)){e.stopPropagation();e.preventDefault();}
  });
})();

function updateStickyStack(fs){
  const bar=$('stickyStack');
  if(!bar)return;
  if(!fs||!fs.length){bar.style.display='none';document.body.style.paddingTop='';return;}
  bar.style.display='flex';
  /* Fixed elements are out of flow, so the top of the page would sit under
     the bar. Measured rather than hard-coded, because the bar's height
     changes with the chip row and the font. */
  document.body.style.paddingTop=bar.offsetHeight+'px';
  /* Each filter in the stack is now its own removable chip.
     Before this, the only way to drop one filter was to find it again in a
     list of 237 and toggle it off, or clear the whole stack and rebuild it.
     Comparing stacks means adding and removing one element at a time, so the
     thing you do most often was the thing that took the most work. */
  $('ssNames').innerHTML=dedupe(fs).map(({f,n})=>
    '<span class="ssChip" data-rm="'+f.id+'" role="button" tabindex="0" '+
    'title="Remove '+esc(f.n)+' from the stack" aria-label="Remove '+esc(f.n)+'">'+
    '<b>'+esc(f.n)+(n>1?' \u00d7'+n:'')+'</b><i aria-hidden="true">\u00d7</i></span>').join('');
  const ST=sampledSystem(fs);
  let peak=0,peakL=LMIN,visSum=0,visN=0;
  for(let l=LMIN;l<=LMAX;l++){
    const t=ST[l-LMIN];
    if(t>peak){peak=t;peakL=l;}
    if(l>=400&&l<=700){visSum+=t;visN++;}
  }
  /* Loss measured over the band the stack actually PASSES, matching the
     measurement card and the plain-English summary.

     This used to average 400-700nm unconditionally, like the card did before
     it was fixed — so a 950nm IR filter, whose visible transmission is around
     1e-15, reported "50.4 stops". That is not a light loss, it is the
     logarithm of a number the filter is designed to make as small as
     possible, and it made the header read as broken on exactly the stacks
     this tool exists for. The three panels now agree. */
  const bandPk=(a,b)=>{let m=0;for(let l=a;l<=b;l++)m=Math.max(m,ST[l-LMIN]);return m;};
  const uvPk=bandPk(LMIN,399),visPk=bandPk(400,699),nirPk=bandPk(700,LMAX);
  const visBlocked=visPk<peak*0.15;
  let bLo=400,bHi=700;
  if(visBlocked&&nirPk>=uvPk&&nirPk>0){bLo=700;bHi=LMAX;}
  else if(visBlocked&&uvPk>nirPk&&uvPk>0){bLo=LMIN;bHi=400;}
  let bSum=0,bN=0;
  for(let l=bLo;l<=bHi;l++){bSum+=ST[l-LMIN];bN++;}
  const avg=bN?bSum/bN:0;
  const stops=avg>0?(-Math.log2(avg)).toFixed(1)+' stops':'\u2014';
  $('ssStats').textContent=(peak*100).toFixed(0)+'% @'+peakL+'nm \u00b7 '+stops;
}

function updateReadout(fs){
  const el=$('readout'),warn=$('leakWarn');
  el.innerHTML='';warn.style.display='none';warn.className='warnbox';
  if(!fs.length)return;

  // sample the stack at 1nm
  let peak=0,peakL=LMIN;
  const T=sampledSystem(fs);
  for(let l=LMIN;l<=LMAX;l++){
    const t=T[l-LMIN];
    if(t>peak){peak=t;peakL=l;}
  }
  /* Half-maximum edges around the peak.
     OFF-BY-ONE FIXED: this used to test the CURRENT sample and then step past
     it (while T[lo] > half) lo--), so lo/hi ended on the first sample already
     BELOW half maximum — one nm outside the band at each end, making every
     reported passband up to 2nm too wide. Negligible for a 400nm-wide IR
     filter; not negligible for the narrowband astro entries, where a 3.5nm
     FWHM was being reported as 5.5nm. Now tests the NEXT sample, so lo and hi
     are the outermost wavelengths still at or above half maximum. */
  const half=peak/2;
  let lo=peakL,hi=peakL;
  const idx=l=>l-LMIN;
  while(lo>LMIN&&T[idx(lo-1)]>=half)lo--;
  while(hi<LMAX&&T[idx(hi+1)]>=half)hi++;
  /* Interpolate where the curve actually crosses half maximum, rather than
     reporting the nearest whole-nm samples. Counting samples alone truncates
     the band by up to 1nm at each end: Baader's 6.5nm H-alpha measured 5nm on
     integer samples, where its own datasheet (and this file's note) says
     ~6.6nm. Linear interpolation between the straddling samples recovers that. */
  const xLo=(lo>LMIN)?(()=>{const a=T[idx(lo-1)],b=T[idx(lo)];
    return b>a?(lo-1)+(half-a)/(b-a):lo;})():lo;
  const xHi=(hi<LMAX)?(()=>{const a=T[idx(hi)],b=T[idx(hi+1)];
    return a>b?hi+(a-half)/(a-b):hi;})():hi;
  const fwhmW=xHi-xLo;

  // NIR leak: any meaningful transmission beyond 750nm relative to the peak
  let nirMax=0,nirL=0;
  for(let l=750;l<=LMAX;l++){if(T[idx(l)]>nirMax){nirMax=T[idx(l)];nirL=l;}}
  const nirRel=peak>0?nirMax/peak:0;

  // visible leak, for UV work
  let visMax=0;
  for(let l=430;l<=700;l++)visMax=Math.max(visMax,T[idx(l)]);
  const visRel=peak>0?visMax/peak:0;

  const card=(k,v,cls)=>{
    const d=document.createElement('div');d.className='ro'+(cls?' '+cls:'');
    d.innerHTML='<div class="k">'+k+'</div><div class="v">'+v+'</div>';el.appendChild(d);
  };
  card('Peak transmission',(peak*100).toFixed(1)+'%');
  card('Peak wavelength',peakL+' nm');
  card('Passband (FWHM)',peak>0.005?
    Math.round(xLo)+'–'+Math.round(xHi)+' nm'+(fwhmW<25?' ('+fwhmW.toFixed(1)+'nm wide)':''):'—');
  card('NIR leak (>750nm)',(nirRel*100).toFixed(nirRel<0.01?2:1)+'%',
       nirRel>0.15?'bad':nirRel>0.02?'warn':'');

  /* Estimated light loss, measured over the band the stack actually PASSES.
     This used to average 400-700nm unconditionally, which reported a 720nm
     IR filter as ~12.7 stops "lost" — but a filter designed to block visible
     light isn't losing it, and no photographer compensates 12 stops to shoot
     IR. For a stack that deliberately blocks visible, the useful number is
     the loss inside its own passband. Matches the plain-English summary. */
  const bandPeak=(a,b)=>{let m=0;for(let l=a;l<=b;l++)m=Math.max(m,T[idx(l)]);return m;};
  const uvPk=bandPeak(280,399),visPk2=bandPeak(400,699),nirPk=bandPeak(700,LMAX);
  const visBlocked=visPk2<peak*0.15;
  let bLo=400,bHi=700,bLabel='Est. light loss';
  if(visBlocked&&nirPk>=uvPk&&nirPk>0){bLo=700;bHi=LMAX;bLabel='Loss in IR passband';}
  else if(visBlocked&&uvPk>nirPk&&uvPk>0){bLo=280;bHi=400;bLabel='Loss in UV passband';}
  let bSum=0,bN=0;
  for(let l=bLo;l<=bHi;l++){bSum+=T[idx(l)];bN++;}
  const avgBandT=bN?bSum/bN:0;
  const stopsLoss=avgBandT>0?-Math.log2(avgBandT):Infinity;
  card(bLabel,
    (isFinite(stopsLoss)?stopsLoss.toFixed(2)+' stops':'>10 stops')+
    ' (avg '+(avgBandT*100).toFixed(1)+'%)');

  const hasUVpass=fs.some(f=>f.g==='UV-pass');
  const hasBlocker=fs.some(f=>f.g==='IR blocker');
  const isColour=fs.some(f=>f.g==='Colour'||f.g==='Conv');
  // visible-band peak, to detect the colour+IR dual band that makes faux colour
  let visPk=0;for(let l=400;l<=700;l++)visPk=Math.max(visPk,T[idx(l)]);
  const dualBand=visPk>0.1&&nirMax>0.1;

  if(hasUVpass&&nirRel>0.15){
    warn.style.display='block';warn.className='warnbox';
    warn.innerHTML='<b>Strong NIR leak — this is a problem here.</b> The stack passes '+(nirRel*100).toFixed(0)+
      '% of its peak out at '+nirL+'nm. Absorptive UV glass is transparent to deep infrared, which is why '+
      'UV-pass filters look red held up to a lamp and why photos come out red-contaminated. '+
      'Add an IR blocker (TSN575, S8612, BG38) to cut it.';
  }else if(isColour&&dualBand&&!hasBlocker){
    warn.style.display='block';warn.className='warnbox info';
    warn.innerHTML='<b>Colour + IR dual band — this is the faux-colour effect.</b> On a normal camera this '+
      'filter is just a colour filter. On a full-spectrum body the dye goes transparent past about 700nm, so '+
      'the sensor receives its visible band <i>and</i> infrared at the same time, landing in different channels. '+
      'That mix is what produces in-camera false colour — a deep blue Wratten 47 used this way is documented as '+
      'giving a 590nm-Goldie-like result straight out of camera, no channel swap needed. '+
      'Add an IR blocker if you want the filter to behave normally instead.';
  }else if(nirRel>0.15&&!hasBlocker&&!fs.some(f=>f.g==='IR-pass'||f.g==='Branded')){
    warn.style.display='block';warn.className='warnbox';
    warn.innerHTML='<b>NIR leak.</b> This passes '+(nirRel*100).toFixed(0)+'% of its peak at '+nirL+
      'nm. Whether that is a fault or the whole point depends on what you are shooting for.';
  }else if(peak>0.01&&visRel>0.25&&hasUVpass){
    warn.style.display='block';warn.className='warnbox';
    warn.innerHTML='<b>Visible-light leak.</b> This stack still passes '+(visRel*100).toFixed(0)+
      '% of its peak in the visible band, so results will mix real colour with the UV signal. '+
      'That can be a look rather than a fault — it is roughly why ZWB3 stacks give those surprising false colours.';
  }
}

$('logScale').addEventListener('change',draw);
$('cameraBrand').addEventListener('change',()=>{cameraBrand=$('cameraBrand').value;invalidateSysSample();draw();});

/* Angle-of-incidence slider. The note under it is not decoration: it states
   how many filters in the current stack were actually modelled, because the
   answer is usually "not all of them" and a silent partial model would be
   worse than no model. */
(function initAoi(){
  const sl=$('aoiSlider');
  if(!sl)return;
  sl.addEventListener('input',()=>{
    aoiDeg=+sl.value;
    $('aoiVal').textContent=aoiDeg+'\u00b0';
    invalidateSysSample();
    draw();
  });
})();
function updateAoiNote(fs){
  const note=$('aoiNote');
  if(!note)return;
  if(!aoiDeg||!fs.length){note.style.display='none';return;}
  const st=aoiStats(fs);
  const bits=[];
  if(st.shifted)bits.push(st.shifted+' interference filter'+(st.shifted===1?'':'s')+' blue-shifted');
  if(st.deepened)bits.push(st.deepened+' absorptive '+(st.deepened===1?'filter':'filters')+' deepened (no shift)');
  if(st.untyped)bits.push('<b style="color:var(--warn)">'+st.untyped+' not modelled \u2014 no filter type recorded</b>');
  const th=aoiDeg*Math.PI/180;
  const k=Math.sqrt(1-Math.pow(Math.sin(th),2)/(AOI_N_EFF*AOI_N_EFF));
  note.innerHTML='At '+aoiDeg+'\u00b0: '+bits.join(' \u00b7 ')+
    '. Interference shift is '+((1-k)*100).toFixed(1)+'% (a 700nm edge moves to '+
    Math.round(700*k)+'nm), assuming n_eff='+AOI_N_EFF+
    ' \u2014 coatings vary, so treat this as indicative. Broadening and peak loss off-axis are not modelled.';
  note.style.display='';
}
window.addEventListener('resize',draw);
window.addEventListener('resize',()=>{if(typeof crgbUpdate==='function')crgbUpdate();});

/* The window 'resize' event alone isn't enough on a phone: the chart also
   changes size when the address bar collapses, when a panel above it opens or
   closes, and when the webfont finally loads and reflows the page. Any of
   those left the canvas rendered at the wrong width until something else
   happened to trigger a redraw. Watch the element itself instead. */
(function watchChartSize(){
  const cv=$('chart');
  if(!cv)return;
  let lastW=0,lastH=0,pending=false;
  const redraw=()=>{
    pending=false;
    const r=cv.getBoundingClientRect();
    if(r.width<50||r.height<20)return;
    if(Math.abs(r.width-lastW)<1&&Math.abs(r.height-lastH)<1)return; // no real change
    lastW=r.width;lastH=r.height;
    draw();
    if(typeof drawStrip==='function')drawStrip();
  };
  const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(redraw);}};
  if('ResizeObserver' in window){
    new ResizeObserver(schedule).observe(cv);
  }else{
    window.addEventListener('resize',schedule);
  }
  // first paint: wait for layout, and again once webfonts have settled
  requestAnimationFrame(()=>requestAnimationFrame(schedule));
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule).catch(()=>{});
  window.addEventListener('orientationchange',()=>setTimeout(schedule,120));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  /* Extra safety nets for the black-chart case: if a paint never landed, keep
     trying on the events that most often mark "layout has finally settled".
     pageshow also covers returning via the back/forward cache, where a canvas
     can come back blank. */
  window.addEventListener('load',()=>{if(!chartPainted)scheduleChartDraw();else schedule();});
  window.addEventListener('pageshow',()=>scheduleChartDraw());
  // Chrome can freeze a backgrounded tab and discard canvas memory with it
  document.addEventListener('resume',()=>scheduleChartDraw());

  /* Repaint whenever the chart comes back into view.

     A 2D canvas is not guaranteed to keep its pixels: mobile browsers discard
     the backing store of a large canvas that has been scrolled off-screen
     when memory is tight, and there is no event for it happening — unlike
     WebGL, which at least fires webglcontextlost. The canvas simply comes
     back blank, and since no resize and no visibility change occurred,
     nothing here had any reason to redraw it. That is the black chart that
     keeps returning after the page has already been working.

     Redrawing on re-entry costs one paint of an already-computed curve (the
     sample cache means the maths is not redone), and it is the only reliable
     way to notice. */
  /* Repaint only when the canvas has ACTUALLY lost its pixels, not every time
     it re-enters the viewport.

     Repainting on re-entry was the previous approach and it caused visible
     flicker: scrolling past the chart makes it cross the observer's margin
     repeatedly, and each crossing forced a full clear-and-redraw. The chart
     was being rebuilt several times a second while the page moved.

     draw() always fills an opaque background, so any pixel it has painted has
     alpha 255. A canvas whose backing store the browser has discarded reads
     back as fully transparent. Sampling ONE pixel therefore distinguishes
     "still fine, leave it alone" from "genuinely lost, repaint" without
     guessing -- and one getImageData of a single pixel costs nothing next to
     a redraw. */
  function chartLostItsPixels(){
    /* Detects BOTH failure modes, because assuming there was only one is what
       let this run for so long.

       1. A discarded backing store: every pixel reads fully transparent.
       2. A canvas that was painted but is EMPTY: draw() filled its opaque
          background and then produced nothing else, so the canvas is a
          uniform slab of #0a0603. This is the one the tool has actually been
          suffering from, and the old check could not see it -- alpha reads
          255 on a background fill, so a blank chart looked perfectly healthy
          and the watchdog left it alone. The opaque background that made
          case 1 detectable is exactly what hid case 2.

       Sampling a grid rather than one pixel: a real chart has axis labels,
       grid lines and a curve, so at least one of ~35 spread samples differs
       from the background. A blank one has none. */
    if(cv.width<2||cv.height<2)return false;
    try{
      const ctx=cv.getContext('2d');
      const px=ctx.getImageData((cv.width/2)|0,(cv.height/2)|0,1,1).data;
      if(px[3]===0)return true;                       // case 1: buffer gone
      let differs=false;
      for(let gy=1;gy<6&&!differs;gy++){
        for(let gx=1;gx<8;gx++){
          const d=ctx.getImageData(((cv.width*gx/8)|0),((cv.height*gy/6)|0),1,1).data;
          // anything that is not the background slab counts as real content
          if(Math.abs(d[0]-10)>6||Math.abs(d[1]-6)>6||Math.abs(d[2]-3)>6){differs=true;break;}
        }
      }
      return !differs;                                // case 2: painted but empty
    }catch(e){ return false; }
  }

  /* UNCONDITIONAL REPAINT. No detection.

     Every previous attempt tried to work out whether the chart was broken and
     repaint only if so. Each detector was blind to the failure that was
     actually happening: the first assumed a discarded buffer, the second
     assumed a lost alpha channel, and both reported a blank chart as healthy.
     Meanwhile getImageData can itself fail silently on privacy-hardened
     browsers, in which case the detector returns "fine" and nothing ever
     recovers -- which matches a diagnostic that never appears.

     So detection is no longer in the recovery path. The chart is simply
     redrawn after scrolling stops and periodically while it is on screen.
     A redraw is a few milliseconds of 2D canvas work on a chart that is
     already sampled and cached; doing it once a second unconditionally is
     cheaper than one more round of diagnosing why a detector is wrong, and it
     cannot be blind to a cause it does not model. */
  let _scrollRepaint=null;
  /* force=true reallocates the backing store, which is what rescues a
     discarded buffer but is also the expensive part. Scrolling — the trigger
     that actually correlates with the fault — gets the full treatment; the
     idle interval does a plain repaint, so the once-a-second safety net stays
     cheap and cannot cause the flicker an earlier version of this introduced. */
  function repaintNow(force){
    try{ if(force)_forceChartRealloc=true; draw(); }catch(e){}
  }
  function onScrollRepaint(){
    clearTimeout(_scrollRepaint);
    _scrollRepaint=setTimeout(()=>{
      const r=cv.getBoundingClientRect();
      if(r.bottom>-100&&r.top<(window.innerHeight||800)+100)repaintNow(true);
    },140);
  }
  window.addEventListener('scroll',onScrollRepaint,{passive:true});
  document.addEventListener('scroll',onScrollRepaint,{passive:true,capture:true});
  window.addEventListener('touchend',onScrollRepaint,{passive:true});
  /* The once-a-second repaint is gone. It did bring the chart back, but it
     also repainted a perfectly good chart every 1.5s, and on a slow canvas
     the clear-then-draw is visible — which is the on/off flicker. Trading a
     chart that blinks constantly for one that occasionally needs a scroll to
     come back is the better of two bad options while the underlying cause is
     unresolved. Scroll-triggered repaint stays, since scrolling is both the
     trigger for the fault and the moment a repaint is invisible. */

  let _recoverFails=0;
  function repaintIfLost(){
    if(!chartLostItsPixels()){
      _recoverFails=0;
      /* Clear the diagnostic once the chart is healthy again — it is shown
         during load before layout settles, and a debug box left over a
         working chart is its own bug. */
      const box=document.getElementById('chartDiag');
      if(box)box.remove();
      return;
    }
    /* Escalate if recovery keeps failing.

       If the canvas is still blank after several attempts, the browser is
       refusing to allocate a buffer this large -- retrying at the same size
       forever just burns battery reproducing the same refusal. Dropping to
       1x roughly quarters the memory the backing store needs, which is
       usually the difference between refused and granted. A slightly soft
       chart is a vastly better outcome than a black one, and the export path
       is unaffected because it passes its own dprOverride. */
    if(++_recoverFails>=3 && chartDprCap>1){
      chartDprCap=1;
      _recoverFails=0;
    }
    /* Force a NEW backing store rather than just redrawing into the old one.

       draw() only calls cv.width=W when the required size differs from the
       current one, so a canvas whose buffer the browser has thrown away --
       but whose width/height attributes still read correctly -- gets drawn
       into a buffer that is never reallocated, and stays blank no matter how
       many times we repaint it. Assigning to width is the documented way to
       force the browser to allocate a fresh one; setting it to 1 first
       guarantees draw()'s size comparison cannot match and skip the
       reallocation. This is the difference between a repaint and a genuine
       recovery, and it is why the earlier repaint-on-event fixes appeared to
       do nothing on the devices that actually had the problem. */
    /* Do NOT shrink the canvas here.

       This previously set cv.width=1 to guarantee draw()'s size comparison
       could not skip the reallocation. That created a deadlock: the detector
       above ignores any canvas under 2px, so if the follow-up draw did not
       land -- and during scrolling rAF callbacks are exactly what gets
       throttled -- the canvas was left at 1x1, invisible, and permanently
       unrecoverable, because the thing meant to rescue it now skipped it.
       That is the blank-on-scroll: self-inflicted, by the recovery code.

       The flag does the same job with no intermediate broken state. If the
       redraw never happens the canvas simply keeps its old contents and the
       next poll tries again. */
    _forceChartRealloc=true;
    scheduleChartDraw();
    /* If it is still blank a moment after the redraw, show the diagnostic
       rather than silently retrying forever. */
    setTimeout(()=>{ if(chartLostItsPixels())showChartDiag(); },400);
  }

  if('IntersectionObserver' in window){
    new IntersectionObserver(entries=>{
      entries.forEach(en=>{ if(en.isIntersecting)repaintIfLost(); });
    },{rootMargin:'100px'}).observe(cv);
  }
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden)repaintIfLost(); });
  window.addEventListener('pageshow',repaintIfLost);
  window.addEventListener('focus',repaintIfLost);
  window.addEventListener('orientationchange',()=>setTimeout(repaintIfLost,250));

  /* A low-frequency poll, because the event-driven checks above have all been
     necessary and none of them has been sufficient.

     Every version of this fix has assumed the canvas is lost at a moment we
     can observe: re-entering the viewport, the tab becoming visible, a
     resize. On mobile the backing store can also be dropped under memory
     pressure at a moment that fires no event we are listening for, and the
     chart then sits there black until something unrelated happens to redraw
     it. One getImageData of a single pixel every second and a half is
     cheaper than any of the redraws it prevents, and it stops only when the
     chart is off screen or the tab is hidden, so it costs nothing in the
     background. */
  /* Started unconditionally rather than by IntersectionObserver.

     Gating the poll on the observer meant the whole safety net depended on
     the observer firing -- and if it never fired, or fired before layout
     settled, nothing was watching the chart at all. The poll is the last line
     of defence, so it must not itself have a precondition that can fail.
     Instead it checks cheaply on each tick whether there is any point doing
     work: hidden tab or off-screen chart costs one getBoundingClientRect and
     returns. */
  setInterval(()=>{
    if(document.hidden)return;
    const r=cv.getBoundingClientRect();
    if(r.bottom<-200||r.top>(window.innerHeight||800)+200)return;   // well off screen
    repaintIfLost();
  },1500);
})();
