/* ---------- filter buttons ---------- */
const CUSTOM_FILTERS_KEY = 'irlab_custom_filters';
function loadCustomFilters() {
  try {
    const raw = localStorage.getItem(CUSTOM_FILTERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
// Merge any previously-imported filters into the live FILTERS array, and
// restore their real curve data into REAL_CURVES, BEFORE buildList() runs
// below -- both need to happen before the grid is built, or an imported
// filter from a past visit silently wouldn't appear in it until the next
// unrelated rebuild.
loadCustomFilters().forEach(f => {
  if (!FILTERS.find(x => x.id === f.id)) FILTERS.push(f);
  if (f._realCurve) REAL_CURVES[f.id] = f._realCurve;
});

/* dataConfidence() and fitErrorFigure() live in src-filters/provenance.js (build 146): the badge is now decided by
   each filter's structured source record, not by how its curve happens to be stored. */
function buildList(){
  const wrap=$('filterList');
  // showCurvePreview() can relocate #curvePreview to sit inside this exact
  // subtree (right after whichever filter was tapped) -- if it's there when
  // we clear wrap below, it gets destroyed along with everything else.
  // Detach it back out first so a rebuild (e.g. after an import) doesn't
  // silently delete a shared element the rest of the page still expects to
  // exist.
  const preview = $('curvePreview');
  if (preview && wrap.contains(preview)) {
    document.body.appendChild(preview);
    preview.style.display = 'none';
  }
  const BAND_COLOR={
    'B1':'rgb(120,40,170)',   // deep UV, below where lamRGB has real colour to give
    'B2':'rgb(121,0,141)',    // lamRGB(390) — the edge of visible violet
    'B3':'rgb(84,0,255)',     // lamRGB(425)
    'B4':'rgb(0,192,255)',    // lamRGB(475)
    'B5':'rgb(74,255,0)',     // lamRGB(525)
    'B6':'rgb(240,255,0)',    // lamRGB(575)
    'B7':'rgb(255,0,0)',      // lamRGB(650)
    'B8':'rgb(161,0,0)',      // lamRGB(750)
    'B9':'rgb(90,20,10)',     // deep NIR, below where lamRGB has real colour to give
    'Custom':'var(--phosphor)',
  };
  const GROUP_INFO={
    'B1':['Deep UV (below 320nm)','The shortest wavelengths this database covers'],
    'B2':['UV-A (320\u2013400nm)','Where most dedicated UV-pass glass sits'],
    'B3':['Violet (400\u2013450nm)',''],
    'B4':['Blue (450\u2013500nm)','Includes the blue/green crossover many colour filters block'],
    'B5':['Green (500\u2013550nm)',''],
    'B6':['Yellow (550\u2013600nm)','Includes the green/red crossover many colour filters block'],
    'B7':['Orange\u2013Red (600\u2013700nm)','The edge of visible \u2014 many "step" contrast and Aerochrome-ladder filters cut on here'],
    'B8':['Deep Red (700\u2013800nm)','Classic IR conversion cutoffs live in this band'],
    'B9':['Near-IR (800\u20131100nm)','Deep IR pass and the strongest IR blockers alike \u2014 sorted here by where THEIR transition sits, not by what they do'],
    'Custom':['Your imported filters','Added via Import your own filter data below \u2014 not part of the wavelength ordering above'],
  };

  /* The ENTIRE list is assembled as one HTML string and written in a single
     innerHTML assignment. Previously this created ~1,200 elements one at a
     time through the DOM API, ran 237 separate innerHTML parses, and attached
     950 event listeners — all synchronously during load, before the browser
     could paint anything at all. That is what left the chart sitting black.
     Clicks now go through one delegated listener (initListDelegation). */
  let out='';
  ['B1','B2','B3','B4','B5','B6','B7','B8','B9','Custom'].forEach(g=>{
    const groupFilters=FILTERS.filter(f=>f.g===g);
    if(!groupFilters.length)return; // e.g. Custom, before anything's been imported
    const [gname,gdesc]=GROUP_INFO[g]||['Other',''];
    out+='<div class="grp"><details><summary class="grpHead"'+(g==='Custom'?' style="margin-top:14px"':'')+'>'+
      '<span class="gdot" aria-hidden="true" style="background:'+(BAND_COLOR[g]||'var(--line2)')+'"></span>'+
      '<div style="flex:1;min-width:0"><div class="gname">'+gname+'</div><div class="gdesc">'+gdesc+'</div></div>'+
      '<span class="gcount">'+groupFilters.length+'</span>'+
      '<span class="gchev">\u25b8</span></summary>'+
      '<div class="fgrid" style="margin-top:0">';
    groupFilters.forEach(f=>{
      const conf=dataConfidence(f);
      out+='<div class="fb" data-id="'+f.id+'" style="--c:'+f.c+'">'+
        '<div class="fbrow">'+
          '<div class="fbinfo"><b>'+f.n+'</b> <span class="fbconf fbconf-'+conf.tier+'" title="'+conf.title+'" aria-label="Data confidence: '+conf.label+'. '+conf.title+'">'+conf.label+'</span>'+(f.d?'<small>'+f.d+'</small>':'')+'</div>'+
          '<div class="fbactions">'+
            '<button type="button" class="fbcurve" title="Show full transmission curve">\u2248 Curve</button>'+
            '<button type="button" class="fbadd">+ Add</button>'+
            '<button type="button" class="fbclear" style="display:none" title="remove all copies">Remove</button>'+
          '</div>'+
        '</div></div>';
    });
    out+='</div></details></div>';
  });
  wrap.innerHTML=out;
  /* The list can now be built AFTER a selection already exists (deferred
     build, or a rebuild after an import), so re-apply the stacked-state
     styling and any active search/chip filtering to the fresh rows. */
  try{
    [...new Set(selected)].forEach(refreshButton);
    if(typeof applyAllFilters==='function')applyAllFilters();
  }catch(e){}
}

/* One delegated click listener for the whole filter list, replacing the ~950
   per-row listeners the old build attached. Keeps the four distinct tap
   targets the rows always had - tapping the name or "Curve" previews,
   "+ Add" stacks, "Remove" clears. Attached to the container, which survives
   every rebuild, so it never needs re-attaching after buildList(). A bare
   click on the row itself still does nothing: browsing the list must never
   accidentally build a stack. */
(function initListDelegation(){
  const wrap=$('filterList');
  if(!wrap)return;
  wrap.addEventListener('click',e=>{
    const t=e.target;
    if(!t||!t.closest)return;
    const row=t.closest('.fb');
    if(!row)return;
    const f=FILTERS.find(x=>x.id===row.dataset.id);
    if(!f)return;
    if(t.closest('.fbadd')){addOne(f.id);return;}
    if(t.closest('.fbclear')){clearFilter(f.id);return;}
    if(t.closest('.fbcurve')||t.closest('.fbinfo')){showCurvePreview(f,row);return;}
  });
})();

/* Deferred to after the first paint. Building 237 rows is the single most
   expensive thing on this page, and running it inline meant the browser
   couldn't paint ANYTHING — chart included — until it finished. The list is
   below the fold on a phone anyway, so it can arrive a frame later; the
   chart, which is what the black box was, no longer waits behind it. */
if('requestIdleCallback' in window){
  requestIdleCallback(()=>buildList(),{timeout:400});
}else{
  requestAnimationFrame(()=>setTimeout(buildList,0));
}

/* ---------- unified filter search ----------
   One filtering pass over the SAME categorized grid, combining whatever's
   active: the text box, the manufacturer multi-select, and the wavelength
   criteria. Used to be two separate mechanisms — a live text filter over
   this grid, and a second, differently-styled results list built by
   "Advanced search" — which meant every filter effectively existed in two
   places with two different visual treatments. One list, one filtering
   function, criteria combine with AND. */
let advActive = false; // whether manufacturer/wavelength criteria are currently applied
/* Quick chips combine with everything else by AND, exactly like the text box
   and the advanced criteria — one filtering pass, no second mechanism. */
const activeChips = new Set();
function chipMatches(f){
  for(const c of activeChips){
    if(c==='realonly'){ if(REAL_CURVES[f.id]==null)return false; continue; }
    const g=(f.g||''), d=(f.d||'').toLowerCase(), n=(f.n||'').toLowerCase();
    if(c==='uvpass'  && !(g==='B1'||g==='B2'||/uv[- ]?pass|ultraviolet/.test(d+n)))return false;
    if(c==='irpass'  && !(g==='B8'||g==='B9'||/ir[- ]?pass|infrared pass|long ?pass/.test(d+n)))return false;
    if(c==='blocker' && !/block|cut|hot mirror|uv\/ir|ir[- ]?cut/.test(d+n))return false;
    if(c==='colour'  && !/colour|color|yellow|orange|red|green|blue|cyan|magenta|gel/.test(d+n))return false;
  }
  return true;
}
let openBeforeSearch = null;

function applyAllFilters(){
  const input=$('filterSearch'), status=$('filterSearchStatus');
  const q=input.value.trim().toLowerCase();
  const mfrSelect=$('advMfr');
  const chosenMfrs=mfrSelect?[...mfrSelect.selectedOptions].map(o=>o.value):[];
  const groups=document.querySelectorAll('#filterList .grp');
  const anyActive = !!q || advActive || activeChips.size>0;

  if(!anyActive){
    groups.forEach((g,i)=>{
      g.style.display='';
      g.querySelectorAll('.fb').forEach(b=>b.style.display='');
      const det=g.querySelector('details');
      if(det)det.open=openBeforeSearch?openBeforeSearch[i]:false;
    });
    status.style.display='none';
    openBeforeSearch=null;
    return;
  }
  if(openBeforeSearch===null){
    openBeforeSearch=[...groups].map(g=>{
      const det=g.querySelector('details');return det?det.open:false;
    });
  }

  let total=0;
  groups.forEach(g=>{
    let anyMatch=false;
    g.querySelectorAll('.fb').forEach(b=>{
      const f=FILTERS.find(x=>x.id===b.dataset.id);
      let match=true;
      if(q){
        const hay=[f.n,f.d,f.g,f.id,f.same||''].join(' ').toLowerCase();
        match = hay.includes(q);
      }
      if(match && activeChips.size){
        match = chipMatches(f);
      }
      if(match && chosenMfrs.length){
        match = chosenMfrs.includes(guessManufacturer(f));
      }
      if(match && advActive){
        match = advCriteria.every(c => {
          const t = filterT(c.wavelength, f) * 100;
          return t >= c.transMin && t <= c.transMax;
        });
      }
      b.style.display=match?'':'none';
      if(match){anyMatch=true;total++;}
    });
    g.style.display=anyMatch?'':'none';
    const det=g.querySelector('details');
    if(det&&anyMatch)det.open=true;
  });
  status.style.display='block';
  status.textContent=total+' filter'+(total===1?'':'s')+' match'+(total===1?'es':'')+
    (total===0?' — try a manufacturer name, wavelength, or keyword like "notch" or "leak"':'');
}

(function(){
  const input=$('filterSearch');
  if(input)input.addEventListener('input', applyAllFilters);
  const row=$('quickChips');
  if(row)row.querySelectorAll('.chip').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const k=btn.dataset.chip;
      if(activeChips.has(k)){activeChips.delete(k);btn.classList.remove('on');}
      else{activeChips.add(k);btn.classList.add('on');}
      applyAllFilters();
    });
  });
})();

/* ========================================================================
   Advanced search, custom filter import, and PNG export
   Ported from FS FilterLab (CheeseCube312, MIT-licensed) — same filtering
   logic (manufacturer + AND-combined wavelength/transmission criteria,
   four sort modes including hue-sorted "Hex-Rainbow"), reimplemented in
   plain JS/canvas rather than pulling in a charting library, since this
   file's whole point is staying a single, dependency-free page.
   ======================================================================== */

/* ---------- custom (imported) filters, persisted in this browser only ---------- */
function saveCustomFilters(list) {
  try { localStorage.setItem(CUSTOM_FILTERS_KEY, JSON.stringify(list)); } catch (e) {}
}

/* ---------- advanced search ---------- */
let advCriteria = [{ wavelength: 550, transMin: 0, transMax: 100 }];

function advAllManufacturers() {
  return [...new Set(FILTERS.map(f => f.mfr || guessManufacturer(f)))].sort();
}
// Most entries in FILTERS don't carry an explicit manufacturer field (it's
// baked into the id/name instead, e.g. "sch_og590", "Schott OG590") — this
// recovers a reasonable one from the id/group for search purposes rather
// than leaving everything bucketed as "Unknown".
function guessManufacturer(f) {
  if (f.mfr) return f.mfr;
  const id = f.id || '';
  if (id.startsWith('sch_') || id === 'bg3') return 'Schott';
  if (id.startsWith('lee')) return 'Lee Filters';
  if (id.startsWith('hy_') || id.startsWith('c80')) return 'Hoya';
  if (id === 'grb1') return 'Tangsinuo';
  if (f.g === 'MidOpt') return 'MidOpt';
  if (f.g === 'IR-pass' || f.g === 'IR blocker') return 'Conversion (generic)';
  return f.g || 'Other';
}

function renderAdvCriteria() {
  const wrap = $('advCriteria');
  wrap.innerHTML = '';
  advCriteria.forEach((c, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap';
    row.innerHTML =
      '<span style="display:flex;flex-direction:column;gap:1px"><span class="note" style="margin:0;font-size:9px;text-transform:uppercase;letter-spacing:.04em">\u03bb (nm)</span>' +
      '<input type="number" value="' + c.wavelength + '" min="' + LMIN + '" max="' + LMAX + '" step="5" style="width:80px"></span>' +
      '<span style="display:flex;flex-direction:column;gap:1px"><span class="note" style="margin:0;font-size:9px;text-transform:uppercase;letter-spacing:.04em">Min %</span>' +
      '<input type="number" value="' + c.transMin + '" min="0" max="100" step="1" style="width:65px"></span>' +
      '<span class="note" style="margin:14px 0 0">to</span>' +
      '<span style="display:flex;flex-direction:column;gap:1px"><span class="note" style="margin:0;font-size:9px;text-transform:uppercase;letter-spacing:.04em">Max %</span>' +
      '<input type="number" value="' + c.transMax + '" min="0" max="100" step="1" style="width:65px"></span>' +
      (advCriteria.length > 1 ? '<button type="button" style="padding:3px 9px;font-size:11px;margin-top:14px" data-rm="' + i + '">\u2715</button>' : '');
    const [wlInput, minInput, maxInput] = row.querySelectorAll('input');
    wlInput.addEventListener('input', () => { advCriteria[i].wavelength = +wlInput.value || 550; });
    minInput.addEventListener('input', () => { advCriteria[i].transMin = +minInput.value || 0; });
    maxInput.addEventListener('input', () => { advCriteria[i].transMax = +maxInput.value || 100; });
    const rmBtn = row.querySelector('[data-rm]');
    if (rmBtn) rmBtn.addEventListener('click', () => { advCriteria.splice(i, 1); renderAdvCriteria(); });
    wrap.appendChild(row);
  });
}

function drawSparkline(canvas, f) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = themeCurveColor(f.c || '#888888');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let l = LMIN; l <= LMAX; l += 2) {
    const t = filterT(l, f);
    const x = (l - LMIN) / (LMAX - LMIN) * w;
    const y = h - Math.max(0, Math.min(1, t)) * h;
    if (l === LMIN) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // faint gridline at 50%
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}

function showCurvePreview(f, anchorEl){
  const box = $('curvePreview');
  box.style.display = '';
  $('curvePreviewLabel').textContent = f.n;
  drawSparkline($('curvePreviewCanvas'), f);
  const src = $('curvePreviewSrc');
  if (src) src.innerHTML = provenanceHTML(f);
  // Move the SAME shared box to sit right after whichever filter was
  // tapped, rather than leaving it fixed at the top of the panel -- tapping
  // "Curve" on something near the bottom of a long list used to mean
  // scrolling all the way back up to see the result, which defeated the
  // point of a quick preview.
  if (anchorEl && anchorEl.parentNode) {
    anchorEl.insertAdjacentElement('afterend', box);
  }
  if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

(function initAdvancedSearch() {
  const mfrSelect = $('advMfr');
  if (!mfrSelect) return;
  advAllManufacturers().forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    mfrSelect.appendChild(opt);
  });
  renderAdvCriteria();
  $('advToggle').addEventListener('click', () => {
    const panel = $('advPanel');
    const show = panel.style.display === 'none';
    panel.style.display = show ? '' : 'none';
    $('advToggle').classList.toggle('on', show);
  });
  $('advAddCriterion').addEventListener('click', () => {
    const last = advCriteria[advCriteria.length - 1];
    advCriteria.push({ wavelength: last ? last.wavelength : 550, transMin: 0, transMax: 100 });
    renderAdvCriteria();
  });
  $('advApply').addEventListener('click', () => { advActive = true; applyAllFilters(); });
  $('advReset').addEventListener('click', () => {
    advActive = false;
    [...mfrSelect.options].forEach(o => o.selected = false);
    advCriteria = [{ wavelength: 550, transMin: 0, transMax: 100 }];
    renderAdvCriteria();
    applyAllFilters();
  });
  $('curvePreviewClose').addEventListener('click', () => { $('curvePreview').style.display = 'none'; });
})();

/* ---------- import your own filter data ---------- */
let pendingImport = null; // {wavelengths:[], transmission:[]} awaiting metadata + save

function parseImportedFile(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return null;
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim);

  // Wide ECOSIS-style: first row is wavelengths-as-headers (or close to it),
  // second row (or first, if no obvious label column) is the data. Detect by
  // checking whether most header cells parse as numbers.
  const numericHeaderCount = header.filter(h => !isNaN(parseFloat(h))).length;
  if (numericHeaderCount > header.length * 0.5) {
    const wavelengths = header.map(h => parseFloat(h)).filter(n => !isNaN(n));
    const dataRow = lines[1].split(delim);
    const transmission = dataRow.slice(header.length - wavelengths.length).map(v => {
      let n = parseFloat(v);
      if (isNaN(n)) return null;
      return n > 1.5 ? n / 100 : n; // guess % vs fraction the same way the app's own importer does
    });
    return { wavelengths, transmission };
  }

  // Otherwise assume simple two-column (wavelength, transmission), skip header row
  const wavelengths = [], transmission = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const wl = parseFloat(cols[0]), t = parseFloat(cols[1]);
    if (isNaN(wl) || isNaN(t)) continue;
    wavelengths.push(wl);
    transmission.push(t > 1.5 ? t / 100 : t);
  }
  return { wavelengths, transmission };
}

function renderImportedList() {
  const wrap = $('impList');
  const custom = loadCustomFilters();
  wrap.innerHTML = '';
  if (!custom.length) return;
  const label = document.createElement('p');
  label.className = 'note';
  label.style.fontWeight = '600';
  label.textContent = 'Your imported filters:';
  wrap.appendChild(label);
  custom.forEach(f => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;margin-bottom:3px;border-left:3px solid ' + (f.c || '#888') + '';
    row.innerHTML = '<span style="flex:1;font-size:12px">' + f.n + ' (' + guessManufacturer(f) + ')</span>' +
      '<button type="button" data-add style="padding:2px 8px;font-size:11px">+ Add to stack</button>' +
      '<button type="button" data-del style="padding:2px 8px;font-size:11px">Delete</button>';
    row.querySelector('[data-add]').addEventListener('click', () => addOne(f.id));
    row.querySelector('[data-del]').addEventListener('click', () => {
      const remaining = loadCustomFilters().filter(x => x.id !== f.id);
      saveCustomFilters(remaining);
      const idx = FILTERS.findIndex(x => x.id === f.id);
      if (idx >= 0) FILTERS.splice(idx, 1);
      clearFilter(f.id);
      renderImportedList();
      buildList();
      document.querySelectorAll('.fb').forEach(b => refreshButton(b.dataset.id)); // same restore as the import handler
    });
    wrap.appendChild(row);
  });
}

(function initImportDialog() {
  const fileInput = $('impFile');
  if (!fileInput) return;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseImportedFile(reader.result);
      if (!parsed || !parsed.wavelengths.length) {
        $('impStatus').textContent = 'Could not parse this file \u2014 expected two columns (wavelength, transmission) or a wide ECOSIS-style CSV.';
        $('impMeta').style.display = 'none';
        return;
      }
      pendingImport = parsed;
      $('impMeta').style.display = 'block';
      $('impName').value = file.name.replace(/\.[^.]+$/, '');
      $('impStatus').textContent = 'Parsed ' + parsed.wavelengths.length + ' points, ' +
        Math.min(...parsed.wavelengths) + '\u2013' + Math.max(...parsed.wavelengths) + 'nm. Fill in the details below.';
    };
    reader.readAsText(file);
  });

  $('impSave').addEventListener('click', () => {
    if (!pendingImport) return;
    const name = $('impName').value.trim() || 'Custom filter';
    const mfr = $('impMfr').value.trim() || 'Custom';
    const num = $('impNum').value.trim() || ('custom_' + Date.now());
    const color = $('impColor').value;
    const extrapLow = $('impExtrapLow').checked;
    const extrapHigh = $('impExtrapHigh').checked;

    // Resample onto the app's own 10nm grid (matching REAL_CURVES' convention
    // elsewhere in this file) via linear interpolation, honouring the
    // extrapolation checkboxes rather than always clamping or always failing
    // outside the measured range.
    const { wavelengths, transmission } = pendingImport;
    const sortedIdx = wavelengths.map((_, i) => i).sort((a, b) => wavelengths[a] - wavelengths[b]);
    const wl = sortedIdx.map(i => wavelengths[i]), t = sortedIdx.map(i => transmission[i]);
    const curve = [];
    for (let l = LMIN; l <= LMAX; l += 10) {
      if (l < wl[0]) { if (extrapLow) curve.push(l, t[0]); continue; }
      if (l > wl[wl.length - 1]) { if (extrapHigh) curve.push(l, t[t.length - 1]); continue; }
      let j = 0; while (j < wl.length - 2 && wl[j + 1] < l) j++;
      const x0 = wl[j], x1 = wl[j + 1], y0 = t[j], y1 = t[j + 1];
      const frac = x1 > x0 ? (l - x0) / (x1 - x0) : 0;
      curve.push(l, y0 + frac * (y1 - y0));
    }

    const id = 'custom_' + num.replace(/[^\w]/g, '_');
    const filterObj = { id, g: 'Custom', n: name, d: mfr, c: color, mfr, bands: [{ lo: LMIN, ls: 1, T: 0 }] };
    // stash the real curve the same way the earlier CheeseCube integration
    // does, so filterT() picks it up via the REAL_CURVES lookup rather than
    // needing its own separate code path
    REAL_CURVES[id] = curve;
    filterObj._customCurve = curve; // persisted separately, see below

    const existing = loadCustomFilters().filter(f => f.id !== id);
    existing.push({ ...filterObj, _realCurve: curve });
    saveCustomFilters(existing);

    if (!FILTERS.find(f => f.id === id)) FILTERS.push(filterObj);
    buildList(); // so the new filter actually shows up in the categorized grid, not just the management list below
    document.querySelectorAll('.fb').forEach(b => refreshButton(b.dataset.id)); // rebuilding cleared the .on/qty state on already-stacked buttons

    $('impStatus').textContent = '"' + name + '" added \u2014 find it under Custom in the list above, or use the button below.';
    $('impMeta').style.display = 'none';
    fileInput.value = '';
    pendingImport = null;
    renderImportedList();
    // manufacturer list may have gained a new entry
    $('advMfr').innerHTML = '';
    advAllManufacturers().forEach(m => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      $('advMfr').appendChild(opt);
    });
  });

  renderImportedList();
})();
