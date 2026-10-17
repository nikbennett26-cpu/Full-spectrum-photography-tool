/* ---------- PNG report export ----------
   Rendered at a fixed large size with EVERYTHING scaled to it — type, swatches,
   padding, line weights. The previous version drew text at fixed ~11-20px onto
   a 1400px+ canvas, so the labels came out microscopic, and it upscaled the
   on-screen chart bitmap rather than re-rendering, which made the curves soft.
   Social platforms then re-compress that, and it turns to mush. Now the chart
   is re-drawn natively at export resolution and the type is sized as a fraction
   of the output width, so it stays legible after a platform's recompression. */
(function initPngExport() {
  const btn = $('exportPngBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const chartCv = $('chart'), stripCv = $('specStrip');
    if (!chartCv) { alert('Nothing to export yet \u2014 pick some filters first.'); return; }

    const OUT_W = 1600;                 // final image width in px
    const U = OUT_W / 1000;             // scale unit: every size below is expressed in these
    const pad = Math.round(28 * U);
    const fs = n => Math.round(n * U) + 'px monospace';   // font helper
    const lineH = Math.round(26 * U);

    // Re-render the chart + strip natively at export resolution rather than
    // stretching what's on screen. dprOverride is chosen so the chart's pixel
    // width lands on OUT_W regardless of the current window size.
    const chartRect = chartCv.getBoundingClientRect();
    const stripRect = stripCv ? stripCv.getBoundingClientRect() : null;
    const liveDpr = window.devicePixelRatio || 1;
    let chartShot = null, stripShot = null;
    try {
      if (chartRect.width > 0) {
        draw((OUT_W - pad * 2) / chartRect.width);
        chartShot = document.createElement('canvas');
        chartShot.width = chartCv.width; chartShot.height = chartCv.height;
        chartShot.getContext('2d').drawImage(chartCv, 0, 0);
      }
      if (stripCv && stripRect && stripRect.width > 0 && typeof drawStrip === 'function') {
        drawStrip((OUT_W - pad * 2) / stripRect.width);
        stripShot = document.createElement('canvas');
        stripShot.width = stripCv.width; stripShot.height = stripCv.height;
        stripShot.getContext('2d').drawImage(stripCv, 0, 0);
      }
    } finally {
      // always restore the on-screen canvases to their normal resolution
      draw(); if (typeof drawStrip === 'function') drawStrip();
    }
    if (!chartShot) { alert('Nothing to export yet \u2014 pick some filters first.'); return; }

    const innerW = OUT_W - pad * 2;
    const chartH = Math.round(chartShot.height * (innerW / chartShot.width));
    const stripH = stripShot ? Math.round(stripShot.height * (innerW / stripShot.width)) : 0;

    const legendItems = [...$('legend').querySelectorAll('.lg')].map(span => {
      const i = span.querySelector('i');
      const cs = i ? getComputedStyle(i) : null;
      return {
        text: span.textContent.trim(),
        color: cs ? cs.borderTopColor : null,
        dash: cs ? cs.borderTopStyle : 'solid',
        isBg: !!(i && i.style.background)
      };
    });
    const readoutCards = [...$('readout').querySelectorAll('.ro')].map(c => [
      c.querySelector('.k') ? c.querySelector('.k').textContent : '',
      c.querySelector('.v') ? c.querySelector('.v').textContent : ''
    ]);
    const stackTitle = ($('stackName') ? $('stackName').textContent : '').trim();

    const legendRowH = Math.round(30 * U);
    const legendH = legendItems.length ? (Math.round(40 * U) + legendItems.length * legendRowH) : 0;
    const roCols = 2, roRows = Math.ceil(readoutCards.length / roCols);
    const roCardH = Math.round(60 * U);
    const readoutH = readoutCards.length ? (Math.round(40 * U) + roRows * (roCardH + Math.round(8 * U))) : 0;

    const crgbChartH = Math.round(innerW * 0.30);
    const crgbExport = (typeof crgbRenderForExport === 'function') ? crgbRenderForExport(innerW, crgbChartH) : null;
    const crgbSectionH = crgbExport ? (Math.round(44 * U) + lineH * 2 + Math.round(14 * U) + crgbChartH + Math.round(38 * U)) : 0;

    const headerH = Math.round(110 * U);
    const out = document.createElement('canvas');
    out.width = OUT_W;
    out.height = pad * 2 + headerH + chartH + stripH + Math.round(16 * U)
               + legendH + readoutH + crgbSectionH + Math.round(40 * U);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#0b0705'; ctx.fillRect(0, 0, out.width, out.height);

    // header
    let y = pad + Math.round(34 * U);
    ctx.fillStyle = '#f2c98a'; ctx.font = 'bold ' + fs(34);
    ctx.fillText('irlab.uk \u2014 Filter Report', pad, y);
    y += Math.round(34 * U);
    ctx.font = fs(21); ctx.fillStyle = '#c9c4b8';
    ctx.fillText(stackTitle || trT('nothing selected'), pad, y);
    y += Math.round(26 * U);
    ctx.font = fs(16); ctx.fillStyle = '#8a8578';
    ctx.fillText(new Date().toLocaleString(), pad, y);

    y = pad + headerH;
    ctx.drawImage(chartShot, pad, y, innerW, chartH); y += chartH;
    if (stripShot) { ctx.drawImage(stripShot, pad, y, innerW, stripH); y += stripH; }
    y += Math.round(16 * U);

    if (legendItems.length) {
      ctx.font = 'bold ' + fs(22); ctx.fillStyle = '#f2c98a';
      ctx.fillText(trT('Key'), pad, y + Math.round(24 * U));
      y += Math.round(40 * U);
      ctx.font = fs(20);
      legendItems.forEach(item => {
        const swY = y + Math.round(10 * U), swW = Math.round(44 * U);
        if (item.isBg) {
          ctx.fillStyle = '#c2431b';
          ctx.fillRect(pad, swY - Math.round(3 * U), swW, Math.round(6 * U));
        } else if (item.color) {
          ctx.strokeStyle = item.color; ctx.lineWidth = Math.max(2, Math.round(4 * U));
          ctx.setLineDash(item.dash === 'dashed' ? [12 * U, 7 * U] : item.dash === 'dotted' ? [3 * U, 6 * U] : []);
          ctx.beginPath(); ctx.moveTo(pad, swY); ctx.lineTo(pad + swW, swY); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = item.isBg ? '#f2c98a' : '#c9c4b8';
        ctx.fillText(item.text, pad + swW + Math.round(14 * U), y + Math.round(17 * U));
        y += legendRowH;
      });
    }

    // readout as real cards, two across — far more legible than a text list
    if (readoutCards.length) {
      ctx.font = 'bold ' + fs(22); ctx.fillStyle = '#f2c98a';
      ctx.fillText(trT('Measurements'), pad, y + Math.round(24 * U));
      y += Math.round(40 * U);
      const gap = Math.round(8 * U), cardW = Math.floor((innerW - gap * (roCols - 1)) / roCols);
      readoutCards.forEach((c, i) => {
        const col = i % roCols, row = Math.floor(i / roCols);
        const cx0 = pad + col * (cardW + gap), cy0 = y + row * (roCardH + gap);
        ctx.fillStyle = '#0f1012'; ctx.fillRect(cx0, cy0, cardW, roCardH);
        ctx.strokeStyle = '#3a2c1e'; ctx.lineWidth = Math.max(1, Math.round(1.5 * U));
        ctx.strokeRect(cx0 + .5, cy0 + .5, cardW - 1, roCardH - 1);
        ctx.fillStyle = '#8a8578'; ctx.font = fs(16);
        ctx.fillText(c[0], cx0 + Math.round(12 * U), cy0 + Math.round(22 * U));
        ctx.fillStyle = '#f2c98a'; ctx.font = 'bold ' + fs(23);
        ctx.fillText(c[1], cx0 + Math.round(12 * U), cy0 + Math.round(48 * U));
      });
      y += roRows * (roCardH + gap) + Math.round(6 * U);
    }

    if (crgbExport) {
      ctx.font = 'bold ' + fs(22); ctx.fillStyle = '#f2c98a';
      ctx.fillText(trT('Sensor-Weighted Response (White-Balanced)'), pad, y + Math.round(24 * U));
      y += Math.round(44 * U);
      ctx.font = fs(19); ctx.fillStyle = '#c9c4b8';
      ctx.fillText('R gain ' + crgbExport.gains.R.toFixed(3) +
                   '    G gain ' + crgbExport.gains.G.toFixed(3) +
                   '    B gain ' + crgbExport.gains.B.toFixed(3), pad, y); y += lineH;
      ctx.fillStyle = '#8a8578';
      ctx.fillText('Sensor: ' + crgbExport.qeName + '    Illuminant: ' + crgbExport.illName, pad, y); y += lineH;
      y += Math.round(14 * U);
      ctx.drawImage(crgbExport.canvas, pad, y, innerW, crgbChartH);
      y += crgbChartH + Math.round(28 * U);
      ctx.font = fs(19);
      ctx.fillStyle = '#e05a4a'; ctx.fillText('\u2014 R Channel', pad, y);
      ctx.fillStyle = '#5ec26a'; ctx.fillText('\u2014 G Channel', pad + Math.round(180 * U), y);
      ctx.fillStyle = '#4a8fe0'; ctx.fillText('\u2014 B Channel', pad + Math.round(360 * U), y);
    }

    ctx.font = fs(16); ctx.fillStyle = '#6b6152';
    ctx.fillText('irlab.uk \u00b7 transmission & stacking calculator', pad, out.height - Math.round(16 * U));

    const a = document.createElement('a');
    a.download = 'irlab-filter-report-' + Date.now() + '.png';
    a.href = out.toDataURL('image/png');
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });
})();

/* ---------- data export (CSV / JSON) ----------
   The PNG is a picture; this is the numbers. Anyone wanting to do their own
   analysis previously had to screenshot the chart and read values off it by
   eye — which is exactly the lossy step that put a ~10nm error into one of
   this file's own curves. Also simple reciprocity: much of this data came
   from CheeseCube312's openly published dataset. */
(function initDataExport(){
  function currentStack(){
    return selected.map(id=>FILTERS.find(f=>f.id===id)).filter(Boolean);
  }
  function download(name,mime,text){
    const blob=new Blob([text],{type:mime});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.download=name;a.href=url;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function stamp(){return new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');}

  if($('exportCsvBtn'))$('exportCsvBtn').addEventListener('click',()=>{
    const fs=currentStack();
    if(!fs.length){alert('Pick some filters first.');return;}
    const uniq=dedupe(fs);
    const cols=['wavelength_nm','stack_transmission','stack_with_sensor']
      .concat(uniq.map(({f})=>f.id+'_transmission'));
    const rows=[cols.join(',')];
    for(let l=LMIN;l<=LMAX;l++){
      const row=[l,stackT(l,fs).toFixed(6),systemT(l,fs).toFixed(6)]
        .concat(uniq.map(({f})=>filterT(l,f).toFixed(6)));
      rows.push(row.join(','));
    }
    download('irlab-stack-'+stamp()+'.csv','text/csv',rows.join('\n'));
  });

  if($('exportJsonBtn'))$('exportJsonBtn').addEventListener('click',()=>{
    const fs=currentStack();
    if(!fs.length){alert('Pick some filters first.');return;}
    const uniq=dedupe(fs);
    const curve=[];
    for(let l=LMIN;l<=LMAX;l++)curve.push([l,+stackT(l,fs).toFixed(6),+systemT(l,fs).toFixed(6)]);
    const payload={
      generated:new Date().toISOString(),
      source:'irlab.uk filter database',
      note:'transmission values are fractions 0-1. stack = filters only; with_sensor = filters x camera body IR response.',
      camera_body:(typeof cameraBrand!=='undefined')?cameraBrand:'neutral',
      filters:uniq.map(({f,n})=>{
        const conf=dataConfidence(f);
        return {id:f.id,name:f.n,copies:n,description:f.d||'',
                data_confidence:conf.label,confidence_meaning:conf.title,
                provenance:provenanceRecord(f),research_note:f.same||null};
      }),
      columns:['wavelength_nm','stack','with_sensor'],
      curve:curve
    };
    download('irlab-stack-'+stamp()+'.json','application/json',JSON.stringify(payload,null,2));
  });
})();

const MAX_COPIES=4; // no realistic reason to stack more than a few of the same glass

// collapse a selection array (which may contain the same filter id several
// times — stacking two pieces of the same glass is physically real) down to
// unique filters + a count, for DISPLAY only. stackT/filterT keep using the
// raw array with duplicates, since that's what makes repeated stacking
// actually darken the curve correctly.
function dedupe(fs){
  const seen=new Map();
  fs.forEach(f=>seen.set(f.id,{f,n:(seen.get(f.id)?seen.get(f.id).n:0)+1}));
  return[...seen.values()];
}
function addOne(id){
  const count=selected.filter(x=>x===id).length;
  if(count>=MAX_COPIES)return;
  selected.push(id);
  refreshButton(id);
  draw();
}
function clearFilter(id){
  selected=selected.filter(x=>x!==id);
  refreshButton(id);
  draw();
}
function refreshButton(id){
  const b=document.querySelector('.fb[data-id="'+CSS.escape(id)+'"]');
  if(!b)return;
  const n=selected.filter(x=>x===id).length;
  b.classList.toggle('on',n>0);
  const clr=b.querySelector('.fbclear');
  clr.style.display=n>0?'':'none';
  clr.textContent=n>1?'Remove (\u00d7'+n+')':'Remove';
}
function setSelection(ids){
  selected=ids.slice();
  document.querySelectorAll('.fb').forEach(b=>refreshButton(b.dataset.id));
  draw();
}
$('clearBtn').addEventListener('click',()=>setSelection([]));
document.querySelectorAll('button.rec').forEach(b=>{
  b.addEventListener('click',()=>setSelection(b.dataset.stack.split(',')));
});
