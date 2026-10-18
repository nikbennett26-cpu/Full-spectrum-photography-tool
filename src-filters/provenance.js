/* ---------- provenance: where every curve comes from (build 146) ----------
   Until build 145 the only record of a filter's source was its free-text note, and the badge was decided by HOW a
   curve was stored (an exact table in REAL_CURVES read "REAL") rather than WHAT it was: a curve read by eye off a
   phone photo of a forum chart got the same badge as SCHOTT's own published table. And because nothing structured
   said where a number came from, nothing could check it: 32 SCHOTT-glass curves had been shipping SCHOTT's internal
   transmittance as if it were what the filter passes (about 8 percentage points too high everywhere it transmits),
   while their notes said the conversion had been done.

   Now every filter carries a structured record:
     s   the source, a key into SOURCES (who published it, which document, a link)
     m   the method, i.e. how the curve was got from that source:
           tab    the maker's own numbers (a published table or data file), used directly
           meas   an independent instrument measurement of a real filter
           trace  digitised from a published chart, calibrated against the chart's own gridlines
           chart  digitised from a published chart (by CheeseCube312 or here; method not recorded finer than that)
           eye    read by eye off a published chart, typically on a 10nm grid: the coarsest real data
           der    calculated from another real curve under a stated assumption (see the note)
           fit    a smooth model fitted to real evidence (its note gives the evidence and, where known, the error)
           est    no real measurement behind it: an idealised placeholder
     cc  for curves taken from CheeseCube312's Filter-Plotter-Data: the file, at the commit pinned below, so anyone can
         compare. tools/provenance/verify.py does exactly that and writes each curve's largest difference into ccd.
   SCHOTT-glass entries take their source from SCHOTT_IDS (src-filters/schott.js), Thorlabs and Edmund entries from
   their own files, so they are not repeated here. The self-test fails any filter whose method and stored data
   disagree (a "tab" with no table behind it, a "fit" that is secretly a stored curve), and any uncoated absorptive
   glass that passes more than its two surfaces allow. */
const CC_COMMIT='6c8ff04c18ebaee137a49ca09b89065c7aaba8ab';
const CC_URL='https://github.com/CheeseCube312/Filter-Plotter-Data';

const SOURCES={
  schott:{who:'SCHOTT AG',doc:'optical filter glass data: internal transmittance table and reflection factor for each glass',
    url:'https://www.schott.com/shop/advanced-optics/en/Matt-Filter-Plates/',got:'2026-10-17'},
  schott_pdf:{who:'SCHOTT AG',doc:'glass datasheet (PDF), internal transmittance table with the stated reflection factor applied'},
  schott_scan:{who:'SCHOTT AG',doc:'classic printed reference chart (a University of Virginia astronomy department scan, photographed at an angle)'},
  thorlabs:{who:'Thorlabs',doc:'measured transmission spreadsheet behind each product’s plot; typical data, varies a little lot to lot',
    url:'https://www.thorlabs.com/'},
  edmund:{who:'Edmund Optics',doc:'product curve data (or the curve PDF where there is no interactive chart); marked “for reference only”',
    url:'https://www.edmundoptics.co.uk/'},
  lee:{who:'Lee Filters',doc:'published transmission graph for each gel, digitised by CheeseCube312',url:'https://leefilters.com/'},
  midopt:{who:'MidOpt',doc:'product transmission charts, digitised by CheeseCube312',url:'https://midopt.com/'},
  tangsinuo:{who:'Shijiazhuang Tangsinuo Optoelectronic',doc:'product transmission charts (sold under the same model numbers by Haisheng and others)'},
  hoya:{who:'Hoya',doc:'product transmission charts, digitised by CheeseCube312'},
  hoya_uv:{who:'Hoya Candeo Optronics',doc:'multi-filter UV glass transmittance chart (U-330, U-340, U-360, UL254S, UL365S, U-340A)',
    url:'https://www.hoyacandeo.co.jp/english/'},
  hoya_uvir:{who:'Hoya',doc:'“HOYA UVIR Light Transmission Graph”, 300-1200nm'},
  hoya_r72:{who:'Hoya',doc:'“HOYA R72 Light Transmission Graph”'},
  hoya_ir:{who:'Hoya',doc:'IR filter series chart (IR76N, IR80N, IR83N, IR85N, RM90, RM100, RT830)'},
  hoya_rm100:{who:'Hoya',doc:'RM100 spectral characteristics datasheet (2.5mm, AR coated)'},
  hoya_cat2016:{who:'Hoya',doc:'Hoya Filter Catalog 2016, p.73 transmission chart (Y2, YA3, R1, X0, X1), traced against its gridlines'},
  hoya_eo:{who:'Hoya Candeo Optronics',doc:'colour-glass datasheets (one PDF per glass, e.g. eo_pdf/Y48.pdf) with transmittance tables at 2.5mm, reflection losses included',url:'https://www.hoyacandeo.co.jp/english/products/eo_pdf/Y48.pdf',got:'2026-10-18'},
  hoya_cb:{who:'Hoya',doc:'colour-balancing filter charts (81A/81B/81C and 85/85B/85C)'},
  kodak1928:{who:'Eastman Kodak',doc:'“Wratten Light Filters” catalogue (May 1928), percentage transmission tables, pp.63-65'},
  kodak_peed:{who:'Eastman Kodak',doc:'“Transmission of Wratten Filters” table compiled by Allie C. Peed Jr., 400-700nm, illuminant C'},
  kodak_w2:{who:'Kodak',doc:'“WRATTEN 2 Optical Filter” datasheets (diffuse density charts, converted to transmittance)',url:'https://www.kodak.com/'},
  edmund_w87:{who:'Edmund Optics',doc:'coating curve chart for the Kodak Wratten 87 infrared filter, 700-1500nm'},
  bw_handbook:{who:'B+W (Schneider-Kreuznach)',doc:'B+W Filter Handbook transmission charts'},
  schneider:{who:'Jos. Schneider Optische Werke',doc:'“Transmission Curves” document (B+W 486)'},
  jmc2021:{who:'JMC Scientific Consulting Ltd',doc:'ZWB glass transmission charts (2021), 2mm samples'},
  baader:{who:'Baader Planetarium',doc:'official product specifications and charts'},
  baader_uvir:{who:'Baader Planetarium',doc:'“UV/IR Sperrfilter” product chart'},
  baader_nb:{who:'Baader Planetarium',doc:'narrowband filter technical document (25 April 2022), parallel-beam traces, Abb. 5-10'},
  stc:{who:'STC Optics',doc:'“IR-Pass Filter” product chart (IRP 590/720/850)',url:'https://www.stcoptics.com/'},
  omega:{who:'Omega Optical',doc:'SpectraPlus product flyers, “Spectral Performance” charts (350-750nm)'},
  vanrijn:{who:'Zach Van Rijn',doc:'spectrophotometer measurement of a Kolari IR Chrome filter, published via truecolorinfrared.com',
    url:'https://truecolorinfrared.com/'},
  kolari:{who:'Kolari Vision',doc:'“What is an Iridium filter” transmission chart',url:'https://kolarivision.com/'},
  aphalo:{who:'Pedro J. Aphalo',doc:'filter measurements published on photo-spectrum.info',url:'https://www.photo-spectrum.info/'},
  haisheng:{who:'Haisheng Optical',doc:'LB-series datasheets (published table points and chart)',url:'https://www.haishengoptical.com/'},
  chroma:{who:'Chroma Technology',doc:'Bessell U photometric filter specification'},
  optolong:{who:'Optolong',doc:'official filter specifications'},
  astronomik:{who:'Astronomik',doc:'official filter specifications'},
  rapidspectra:{who:'rapidspectra',doc:'printed specification card for part 425-525-660-815QB'},
  uvp_forum:{who:'ultravioletphotography.com',doc:'SCHOTT/Hoya comparison chart posted to the forum'},
  fedia:{who:'Fedia (@fedialebarboc)',doc:'measured single-filter transmission plot, supplied directly (not on MidOpt’s public site)'},
  user:{who:'you',doc:'imported in this browser'}
};

const PROV_METHOD={
  tab:  {tier:'data', label:'DATA', say:'the maker’s own published numbers, used directly'},
  meas: {tier:'meas', label:'MEAS', say:'an independent instrument measurement of a real filter'},
  trace:{tier:'chart',label:'CHART',say:'digitised from a published chart, calibrated against its gridlines'},
  chart:{tier:'chart',label:'CHART',say:'digitised from a published chart'},
  eye:  {tier:'chart',label:'CHART',say:'read by eye off a published chart (the coarsest real data: expect a few points of error)'},
  der:  {tier:'calc', label:'CALC', say:'calculated from another real curve under an assumption the note states'},
  fit:  {tier:'fit',  label:'FIT',  say:'a smooth model fitted to real evidence, not the evidence itself'},
  est:  {tier:'est',  label:'EST',  say:'no real measurement behind it: an idealised placeholder or an unmeasured guess'}
};

/*PROV-BEGIN (tools/provenance/verify.py rewrites the ccd figures in this block) */
const PROV={
  zwb1:{s:'jmc2021',m:'trace'},
  zwb2:{s:'tangsinuo',m:'fit'},
  zwb3:{s:'jmc2021',m:'trace'},
  qb29:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_QB292_BG25.tsv',ccd:2.3},
  baader:{s:'baader',m:'fit'},
  andreau:{m:'fit'},
  baaderuvir:{s:'baader_uvir',m:'trace'},
  ubessel:{s:'chroma',m:'fit'},
  hyu330:{s:'hoya_uv',m:'eye'},
  hyu340:{s:'hoya_uv',m:'eye'},
  hyu360:{s:'hoya_uv',m:'eye'},
  tsn340:{s:'aphalo',m:'fit'},
  tsn575:{s:'aphalo',m:'fit'},
  qb21ar:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_QB212mm_AR.tsv',ccd:2.8},
  bg24:{s:'schott_scan',m:'fit'},
  bw486:{s:'schneider',m:'chart'},
  hoyauvir:{s:'hoya_uvir',m:'chart'},
  heliouvir:{m:'est'},
  grb1:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/TangsinuoGRB1GRB1.tsv',ccd:0.9},
  ir665:{m:'est'},
  ir950:{m:'est'},
  stc_irp590:{s:'stc',m:'trace'},
  stc_irp720:{s:'stc',m:'trace'},
  stc_irp850:{s:'stc',m:'trace'},
  bw021:{s:'bw_handbook',m:'fit'},
  bw022:{s:'bw_handbook',m:'eye'},
  bw023:{s:'bw_handbook',m:'fit'},
  bw041:{s:'kodak1928',m:'fit'},
  w89b:{s:'kodak_w2',m:'chart'},
  r72:{s:'hoya_r72',m:'chart'},
  w88a:{s:'kodak_peed',m:'fit'},
  w87:{s:'edmund_w87',m:'chart'},
  w87c:{s:'kodak_w2',m:'chart'},
  rm90:{s:'uvp_forum',m:'fit'},
  rm100:{s:'hoya_rm100',m:'fit'},
  tiffen_haze2a:{s:'kodak_w2',m:'chart'},
  w3:{m:'est'},
  w4:{m:'est'},
  w8:{s:'kodak_peed',m:'tab'},
  w9:{s:'kodak1928',m:'tab'},
  w12:{s:'kodak1928',m:'tab'},
  w15:{s:'kodak1928',m:'tab'},
  w16:{s:'kodak1928',m:'tab'},
  w21:{s:'kodak1928',m:'tab'},
  w22:{s:'kodak1928',m:'tab'},
  w23a:{s:'kodak1928',m:'tab'},
  w25:{s:'kodak1928',m:'tab'},
  w29:{s:'kodak_w2',m:'chart'},
  kb1_5:{s:'bw_handbook',m:'fit'},
  kb3:{s:'bw_handbook',m:'fit'},
  kb6:{s:'bw_handbook',m:'fit'},
  kb12:{s:'bw_handbook',m:'fit'},
  kb20:{s:'bw_handbook',m:'fit'},
  c80a:{s:'hoya',m:'chart',cc:'Hoya/Hoya_80A_80A_extrapolated_1100.tsv',ccd:2.1},
  c80b:{s:'hoya',m:'chart',cc:'Hoya/Hoya_80B_80B_extrapolated_1100.tsv',ccd:1.8},
  c80c:{s:'hoya',m:'chart',cc:'Hoya/Hoya_80C_80C_extrapolated_1100.tsv',ccd:3.9},
  c85:{s:'hoya_cb',m:'fit'},
  c85b:{s:'hoya_cb',m:'fit'},
  c85c:{s:'hoya_cb',m:'fit'},
  c81a:{s:'hoya_cb',m:'fit'},
  c81b:{s:'hoya_cb',m:'fit'},
  c81c:{s:'hoya_cb',m:'fit'},
  kolarichrome:{s:'vanrijn',m:'meas',cc:'Kolari IR Chrome_interpolated.tsv',ccd:0.7},
  kolariiridium:{s:'kolari',m:'fit'},
  w47:{s:'kodak_w2',m:'chart'},
  w47b:{m:'est'},
  w47a:{s:'kodak_w2',m:'chart'},
  w38a:{s:'kodak_w2',m:'chart'},
  w58:{s:'kodak_w2',m:'chart'},
  w61:{s:'kodak_w2',m:'chart'},
  w11:{s:'kodak_peed',m:'fit'},
  w32:{m:'est'},
  w34a:{m:'est'},
  w44a:{m:'est'},
  bw060:{s:'bw_handbook',m:'fit'},
  bw061:{s:'bw_handbook',m:'fit'},
  cc20y:{s:'bw_handbook',m:'fit'},
  cc20r:{s:'bw_handbook',m:'fit'},
  cc20g:{s:'bw_handbook',m:'fit'},
  cc20b:{s:'bw_handbook',m:'fit'},
  lee139:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters139PrimaryGreen.tsv',ccd:1.4},
  lee729:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters729ScubaBlue.tsv',ccd:1.4},
  lee192:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters192FleshPink.tsv',ccd:1.9},
  lee035:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters035LightPink.tsv',ccd:1.5},
  lee441:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters441FullCTStraw.tsv',ccd:1.2},
  lee744:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters744DirtyWhite.tsv',ccd:1.4},
  lee026:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters026BrightRed.tsv',ccd:1.2},
  lee106:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters106PrimaryRed.tsv',ccd:1.3},
  lee101:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters101Yellow.tsv',ccd:1.1},
  lee010:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters010MediumYellow.tsv',ccd:3.2},
  lee105:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters105Orange.tsv',ccd:1.4},
  lee158:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters158DeepOrange.tsv',ccd:0.9},
  lee020:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters020MediumAmber.tsv',ccd:1.1},
  lee022:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters022DarkAmber.tsv',ccd:2.3},
  lee113:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters113Magenta.tsv',ccd:2.1},
  lee046:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters046DarkMagenta.tsv',ccd:1.0},
  lee049:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters049MediumPurple.tsv',ccd:1.2},
  lee120:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters120DeepBlue.tsv',ccd:1.8},
  lee132:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters132MediumBlue.tsv',ccd:2.2},
  lee036:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters036MediumPink.tsv',ccd:1.8},
  lee119:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters119DarkBlue.tsv',ccd:2.0},
  lee141:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters141BrightBlue.tsv',ccd:2.9},
  lee124:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters124DarkGreen.tsv',ccd:2.2},
  lee088:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters088LimeGreen.tsv',ccd:2.7},
  lee122:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters122FernGreen.tsv',ccd:1.6},
  lee121:{s:'lee',m:'chart',cc:'Lee Filters/LeeFilters121LEEGreen.tsv',ccd:1.9},
  lb1:{s:'haisheng',m:'fit'},
  lb2:{s:'haisheng',m:'fit'},
  lb3:{s:'haisheng',m:'fit'},
  lb4:{s:'haisheng',m:'fit'},
  lb6:{s:'haisheng',m:'fit'},
  lb7:{s:'haisheng',m:'fit'},
  lb8:{s:'haisheng',m:'fit'},
  lb9:{s:'haisheng',m:'fit'},
  lb10:{s:'haisheng',m:'fit'},
  lb16:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_LB16.tsv',ccd:1.1},
  lb17:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_LB17.tsv',ccd:1.1},
  lb18:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_LB18.tsv',ccd:0.6},
  lb19:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_LB19.tsv',ccd:0.2},
  db395:{s:'midopt',m:'chart',cc:'MidOpt/MidOpt_DB395_870.tsv',ccd:0.0},
  db475:{s:'midopt',m:'chart',cc:'MidOpt/MidOpt_DB475_850.tsv',ccd:0.0},
  db550:{s:'midopt',m:'chart',cc:'MidOpt/MidOpt_DB550_850.tsv',ccd:0.0},
  db660:{s:'midopt',m:'chart',cc:'MidOpt/MidOpt_DB660_850.tsv',ccd:0.0},
  db735:{s:'midopt',m:'chart',cc:'MidOpt/MidOpt_DB735.tsv',ccd:0.0},
  db830:{s:'fedia',m:'fit'},
  db850:{s:'midopt',m:'chart',cc:'MidOpt/MidOpt_DB850.tsv',ccd:0.0},
  tb550:{s:'midopt',m:'chart',cc:'MidOpt/MidOpt_TB550_660_850.tsv',ccd:0.0},
  tb475:{s:'midopt',m:'chart',cc:'MidOpt/MidOpt_TB475_550_850.tsv',ccd:0.0},
  nf550:{s:'midopt',m:'chart',cc:'MidOpt/MidOpt_NF550.tsv',ccd:0.0},
  qb425:{s:'rapidspectra',m:'fit'},
  xb29:{s:'omega',m:'eye'},
  xb30:{s:'omega',m:'eye'},
  didy:{m:'fit'},
  notch532:{m:'fit'},
  sepia:{m:'est'},
  nd4:{m:'est'},
  nd8:{m:'est'},
  nd16:{m:'est'},
  cpl:{m:'est'},
  lpl:{m:'est'},
  redcpl:{m:'fit'},
  ha7:{m:'est'},
  ha3:{m:'est'},
  oiii7:{m:'est'},
  sii7:{m:'est'},
  baader_ha65:{s:'baader_nb',m:'trace'},
  baader_ha35:{s:'baader_nb',m:'trace'},
  baader_sii65:{s:'baader_nb',m:'trace'},
  baader_sii4:{s:'baader_nb',m:'trace'},
  baader_oiii65:{s:'baader_nb',m:'trace'},
  baader_oiii4:{s:'baader_nb',m:'trace'},
  hb8:{m:'est'},
  lext:{s:'optolong',m:'fit'},
  lenh:{s:'optolong',m:'fit'},
  uhc:{s:'astronomik',m:'fit'},
  cls:{s:'astronomik',m:'fit'},
  neod:{s:'baader',m:'fit'},
  solc:{s:'baader',m:'fit'},
  hy_k2:{s:'hoya_cat2016',m:'trace'},
  hy_og:{m:'fit'},
  hy_ya3:{s:'hoya_cat2016',m:'trace'},
  hy_x0:{s:'hoya',m:'chart',cc:'Hoya/Hoyax0YellowGreen.tsv',ccd:0.6},
  hy_x1:{s:'hoya',m:'chart',cc:'Hoya/HoyaX1Green.tsv',ccd:0.7},
  hy_r1:{s:'hoya_cat2016',m:'trace'},
  hy_y48:{s:'hoya_eo',m:'tab'},
  hyg_y44:{s:'hoya_eo',m:'tab'},
  hyg_y50:{s:'hoya_eo',m:'tab'},
  hyg_y52:{s:'hoya_eo',m:'tab'},
  hyg_o54:{s:'hoya_eo',m:'tab'},
  hyg_o56:{s:'hoya_eo',m:'tab'},
  hyg_o58:{s:'hoya_eo',m:'tab'},
  hyg_r60:{s:'hoya_eo',m:'tab'},
  hyg_r62:{s:'hoya_eo',m:'tab'},
  hyg_r64:{s:'hoya_eo',m:'tab'},
  hyg_r66:{s:'hoya_eo',m:'tab'},
  hyg_r70:{s:'hoya_eo',m:'tab'},
  hyg_r72:{s:'hoya_eo',m:'tab'},
  hy_r70:{s:'hoya_eo',m:'der'},
  hy_r76:{s:'hoya_ir',m:'chart'},
  hy_r80:{s:'hoya_ir',m:'chart'},
  hy_r83:{s:'hoya_ir',m:'chart'},
  hy_r85:{s:'hoya_ir',m:'chart'},
  hy_rm86:{m:'est'},
  hy_rt830:{s:'hoya_ir',m:'chart'},
  sch_wg345:{m:'est'},
  sch_wg360:{s:'schott_pdf',m:'tab'},
  sch_gg385:{m:'est'},
  jb_jb400:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_JB400.tsv',ccd:0.0},
  jb_jb420:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_JB420_GG420.tsv',ccd:0.0},
  jb_jb450:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_JB4502_GG455.tsv',ccd:0.0},
  jb_jb470:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_JB4702_GG475.tsv',ccd:0.0},
  jb_jb490:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_JB4902_GG495.tsv',ccd:0.0},
  jb_jb510:{s:'tangsinuo',m:'chart',cc:'Tangsinuo/Tangsinuo_0_JB5102_GG515.tsv',ccd:0.0},
};
/*PROV-END*/

/* The 32 SCHOTT-glass curves corrected in build 146 say so at the top of their own note, ahead of the older research
   record, so nobody reading the note is left believing the earlier figure. */
const PROV_FIXED_146=['sch_gg395','sch_gg400','sch_gg420','sch_gg435','sch_gg455','sch_gg475','sch_gg495','sch_og515',
  'sch_og530','sch_og550','sch_og570','sch_og590','sch_rg610','sch_rg630','sch_rg645','sch_rg665','sch_rg695',
  'sch_rg715','sch_rg780','sch_rg830','sch_rg850','sch_rg1000','bw040','bw099','bw090','bw091','bw092','bw093',
  'bw094','bw403','ug11','bg3'];
PROV_FIXED_146.forEach(id=>{
  const f=FILTERS.find(x=>x.id===id);if(!f)return;
  let pre='CORRECTED in build 146: this curve used to be SCHOTT’s internal transmittance shown as if it were the '+
    'filter’s, which leaves out the light lost at the two glass surfaces and read about 8 percentage points too '+
    'high wherever the glass passes. It is now SCHOTT’s published table times the glass’s own reflection '+
    'factor (see Source).';
  if(id==='bg3')pre+=' SCHOTT’s current BG3 table also differs from the older copy below 320nm (up to 19 points '+
    'lower at 280nm); the current table is used.';
  f.same=pre+(f.same?' Earlier record: '+f.same:'');
});

/* Build 147: notes that described a change the stored curve does not have. The stored curve wins (it is the source
   data); the note is corrected at its top so nobody reads the old figure as what is drawn. */
const LEE_TAIL='The curve drawn is Lee\u2019s published data as digitised by CheeseCube312. Its measured points run to 805nm; '+
  'beyond that the source holds every Lee gel at a flat 90%, an extrapolation rather than a per-gel measurement, so '+
  'treat the deep-IR level past ~800nm as approximate.';
const NOTE_FIX_147={
  lee139:LEE_TAIL+' The 35% leak estimate described below is NOT applied: the measured points themselves already reach '+
    '88% by 780nm, so the real leak is far higher than 35%.',
  lee729:LEE_TAIL+' The 35% leak estimate described below is NOT applied: the measured points themselves already reach '+
    '88% by 780nm, so the real leak is far higher than 35%.',
  lee120:LEE_TAIL+' The leak refit described below is not applied; the measured points reach 86% by 800nm, so the '+
    'flat tail adds only a few points.',
  lee132:LEE_TAIL+' The leak refit described below is not applied; the measured points reach 87% by 800nm, so the '+
    'flat tail adds only a few points.',
  lee119:LEE_TAIL+' The added leak band described below is not used; the measured points reach 86% by 800nm.',
  lee141:LEE_TAIL+' The added leak band described below is not used; the measured points reach 86% by 800nm.',
  lee124:LEE_TAIL+' The added leak band described below is not used; the measured points reach 86% by 800nm.'
};
Object.keys(NOTE_FIX_147).forEach(id=>{
  const f=FILTERS.find(x=>x.id===id);if(!f)return;
  f.same='CORRECTED in build 147: '+NOTE_FIX_147[id]+(f.same?' Earlier record: '+f.same:'');
});

function provenanceOf(f){
  if(typeof SCHOTT_IDS!=='undefined'&&SCHOTT_IDS[f.id]){
    const[glass,mm]=SCHOTT_IDS[f.id];
    return{s:'schott',m:mm==null?'tab':'der',glass,mm};
  }
  if(PROV[f.id])return PROV[f.id];
  if(/^tl_/.test(f.id))return{s:'thorlabs',m:'tab'};
  if(/^eo_/.test(f.id))return{s:'edmund',m:'tab'};
  if(f.g==='Custom'||/^custom_/.test(f.id))return{s:'user',m:REAL_CURVES[f.id]!=null?'tab':'est'};
  return{m:REAL_CURVES[f.id]!=null?'chart':(f.same?'fit':'est')};
}

function fitErrorFigure(note){
  if(!note)return null;
  // "RMS 1.6 percentage points", "RMS error 1.2 percentage points", "mean fitting error 4.1 percentage points",
  // "RMS ~7 percentage points", "RMS 4.12pp", "Mean error 5.1 percentage points"
  const m=note.match(/(?:RMS|mean(?:\s+fitting)?\s+error|RMS\s+error)[^0-9]{0,12}(~?\d+(?:\.\d+)?)\s*(?:percentage\s+points|pp)/i);
  return m?m[1].replace('~','')+'pp':null;
}

/* The badge. It now says what the data IS (the maker's numbers, a measurement, a chart reading, a calculation, a fit,
   a guess), from the structured record above, instead of how it happens to be stored. */
function dataConfidence(f){
  const p=provenanceOf(f),M=PROV_METHOD[p.m]||PROV_METHOD.est,S=p.s&&SOURCES[p.s];
  const who=S?' ('+S.who+')':'';
  if(p.m==='fit'){
    const err=fitErrorFigure(f.same);
    if(err)return{tier:'fitq',label:'FIT '+err,
      title:'A model fitted to real source data'+who+' with a documented error of '+err+' against it'};
    return{tier:'fit',label:'FIT',title:'A model fitted to real evidence'+who+', with no error figure documented (see the note)'};
  }
  return{tier:M.tier,label:M.label,title:M.say.charAt(0).toUpperCase()+M.say.slice(1)+who};
}

function schottGlassURL(g){return SOURCES.schott.url+encodeURIComponent(g)+'/c/glass-'+encodeURIComponent(g);}
function ccFileURL(path){return CC_URL+'/blob/'+CC_COMMIT+'/filters_data/'+path.split('/').map(encodeURIComponent).join('/');}

/* One plain record per filter, for the export and the page alike. */
function provenanceRecord(f){
  const p=provenanceOf(f),M=PROV_METHOD[p.m]||PROV_METHOD.est,S=p.s?SOURCES[p.s]:null;
  const r={method:p.m,method_meaning:M.say,source:S?S.who:null,document:S?S.doc:null,url:S&&S.url||null,retrieved:S&&S.got||null};
  if(p.glass){
    const g=SCHOTT_GLASS[p.glass];
    r.document='SCHOTT '+p.glass+': internal transmittance table at '+g.d+'mm, reflection factor Pd '+g.pd+
      (p.mm!=null?'; scaled to '+p.mm+'mm by Beer-Lambert':'');
    r.url=schottGlassURL(p.glass);
    if(SCHOTT_CC[p.glass]!=null)r.cross_check='CheeseCube312’s independent copy of the table differs by at most '+
      SCHOTT_CC[p.glass]+' percentage points';
  }
  if(p.cc){
    r.digitised_by='CheeseCube312, Filter-Plotter-Data (MIT), commit '+CC_COMMIT.slice(0,7);
    r.digitised_file=ccFileURL(p.cc);
    if(p.ccd!=null)r.cross_check=p.ccd===0?'this curve matches that file':'this curve is within '+p.ccd+' percentage points of that file (resampling)';
  }
  return r;
}

const escHTML=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function provenanceHTML(f){
  const r=provenanceRecord(f);
  const link=(u,t)=>'<a href="'+escHTML(u)+'" target="_blank" rel="noopener">'+escHTML(t)+'</a>';
  let s='<b>Source:</b> '+(r.source?escHTML(r.source)+', '+(r.url?link(r.url,r.document):escHTML(r.document)):
    'not structured yet; the research note below gives it')+(r.retrieved?' (retrieved '+r.retrieved+')':'')+'. ';
  s+='<b>How:</b> '+escHTML(r.method_meaning)+'. ';
  if(r.digitised_file)s+='<b>Digitised by:</b> '+link(r.digitised_file,'CheeseCube312, Filter-Plotter-Data')+'. ';
  if(r.cross_check)s+='<b>Checked:</b> '+escHTML(r.cross_check)+'.';
  return s;
}

/* The sources register on the page: every source, how many filters rest on it, and how. */
function renderSources(){
  const el=$('sourceList');if(!el)return;
  const by={},cc={n:0,max:0};
  FILTERS.forEach(f=>{
    const p=provenanceOf(f),k=p.s||'(note)';
    (by[k]=by[k]||{n:0,m:{}}).n++;by[k].m[p.m]=(by[k].m[p.m]||0)+1;
    if(p.cc){cc.n++;if(p.ccd!=null)cc.max=Math.max(cc.max,p.ccd);}
  });
  const keys=Object.keys(by).sort((a,b)=>by[b].n-by[a].n);
  const mname={tab:'maker data',meas:'measured',trace:'chart, calibrated trace',chart:'chart',eye:'chart, read by eye',
    der:'calculated',fit:'fitted',est:'estimate'};
  el.innerHTML='<ul class="srcList">'+keys.map(k=>{
    const S=SOURCES[k],b=by[k];
    const how=Object.keys(b.m).map(m=>(b.m[m]===b.n?'':b.m[m]+' ')+mname[m]).join(', ');
    const name=S?(S.url?'<a href="'+escHTML(S.url)+'" target="_blank" rel="noopener">'+escHTML(S.who)+'</a>':escHTML(S.who)):
      'Sources given only in each filter’s research note';
    return '<li><b>'+name+'</b> <span class="srcN">'+b.n+'</span><br><span>'+(S?escHTML(S.doc)+' · ':'')+how+'</span></li>';
  }).join('')+'</ul>'+
  '<p class="dh-note">'+cc.n+' curves come from <a href="'+CC_URL+'" target="_blank" rel="noopener">CheeseCube312’s '+
  'Filter-Plotter-Data</a> (MIT licence) at commit <code>'+CC_COMMIT.slice(0,7)+'</code>; each was compared with its file '+
  'there and none differs by more than '+cc.max.toFixed(1)+' percentage points (resampling). The SCHOTT tables were '+
  'checked the other way round, against CheeseCube312’s independent copy of the same data.</p>';
}
