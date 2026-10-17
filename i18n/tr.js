/* irlab text translation (build 133). Shared by index.html and filters.html.

   The older system (I18N in src/i18n.js) needs a data-i18n key on every element. This one translates by matching the
   English itself: every text node, and the title, aria-label and placeholder attributes, are looked up in a table per
   language (i18n/<lang>.js, keyed by the English text with spaces collapsed). It also watches the page, so text the
   app writes later (status lines, the filter list, dialogs) is translated as it appears, and switching back to
   English restores the original exactly.

   - An element marked data-tr-block is translated as one unit (its whole sentence), for sentences broken up by bold or
     italic words, which do not translate piece by piece. Its translation may contain the same simple markup.
   - Elements inside [data-i18n] (the older system), #whatsNew (the change log stays in English), script, style, svg,
     code and .noTr are left alone.
   - Repeated patterns ("decrease Exposure", "Double-tap to reset to 50 ...") use templates (TEMPLATES below), with
     the inner label translated from the same table.
   - A string with no entry stays in English. tools/i18n_check.py lists what is missing.

   Each language file calls irlabTr.add(lang, table). Only the chosen language is loaded: the page loads it in <head>
   (see the small loader there) so translated text is in place before first paint; a switch later loads it on demand. */
(function () {
  'use strict';
  const SKIP = 'script,style,svg,code,.noTr,[data-i18n],#uiLang,#whatsNew';
  // attributes are still translated on a [data-i18n] element: the older system only sets its text
  const SKIP_ATTR = 'script,style,code,.noTr,#uiLang,#whatsNew';
  const ATTRS = ['title', 'aria-label', 'placeholder'];
  const TEMPLATES = [
    [/^decrease (.+)$/, 'tDec'],
    [/^increase (.+)$/, 'tInc'],
    [/^Double-tap to reset to (-?[\d.]+) · Long-press to type a value$/, 'tDbl'],
    [/^Jump to (.+) — a dot means you have changed something here$/, 'tJumpDot'],
    [/^Jump to (.+)$/, 'tJump'],
    [/^Reset (.+) \(one undo step\)$/, 'tResetUndo'],
    [/^Output ([RGB]) from ([RGB])$/, 'tOutFrom'],
    [/^Output ([RGB]) constant offset$/, 'tOutOff'],
    [/^([RGB]) out from ([RGB]) in$/, 'tOutIn'],
    // White Balance: the short state on each row and the folded header (src/session.js wbRowShort / wbHeaderSummary)
    [/^auto ✓ R ([\d.]+) G ([\d.]+) B ([\d.]+)$/, 'tWbAutoRGB'],
    [/^before: (.+) · after: (.+)$/, 'tWbBoth'],
    [/^before: (.+)$/, 'tWbBefore'],
    [/^after: (.+)$/, 'tWbAfter'],
    // filters page: pieces of the filter descriptions, and the data-confidence badges
    [/^(\d+)nm cut-on$/, 'tCutOn'],
    [/^ND(\d+) \((\d+) stops\)$/, 'tNdStops'],
    [/^sold as equal to Schott (\S+) \(seller’s own datasheet\)$/, 'tSoldAs'],
    [/^no stated equivalent, inferred close to (\S+) from the seller’s own chart — not confirmed$/, 'tInferred'],
    [/^B\+W (\d+) is cut from this glass$/, 'tCutFrom'],
    [/^the Hoya (\S+) sits alongside this$/, 'tSitsBeside'],
    [/^(\d+)% UV peak$/, 'tPeak'],
    [/^50% at ~(\d+)nm$/, 'tHalfAt'],
    [/^also Lee (\S+)$/, 'tAlsoLee'],
    [/^Data confidence: FIT ([\d.]+)pp\. Fitted to real source data with a documented error figure \([\d.]+pp against real data points\) — often more trustworthy than a curve read by eye off a chart image$/, 'tConfFitPP'],
    [/^Fitted to real source data with a documented error figure \(([\d.]+)pp against real data points\) — often more trustworthy than a curve read by eye off a chart image$/, 'tFitPP'],
    [/^Data confidence: REAL\. (.+)$/, 'tConfReal'],
    [/^Data confidence: FIT\. (.+)$/, 'tConfFit'],
    [/^Data confidence: EST\. (.+)$/, 'tConfEst'],
    [/^(REAL — digitised curve|FIT — fitted, error quantified|FIT — fitted, error not quantified|EST — no measurement): (\d+)$/, 'tTierCount'],
    [/^(\d+) filters total\. (\d+) \((\d+)%\) are backed by a digitised curve or a fit with a documented error figure\. Quantified fits span ([\d.]+)pp to ([\d.]+)pp RMS — the badge shows each one, so a rough fit never reads the same as a tight one\. Note a digitised curve read by eye off a low-resolution chart is not automatically better than a least-squares fit against a published table; the tier describes how the data is stored as much as how good it is\.$/, 'tHealth'],
    // trichrome (src/trichrome.js): step counter and loaded-shot counter
    [/^step ([123]) of 3$/, 'tStepOf'],
    [/^([0123]) of 3$/, 'tNofThree'],
    // the Swap tab's channel verdict (src/view.js), which carries a live number
    [/^Channel means differ by (-?[\d.]+) levels, so there is real separation to work with\.$/, 'tChSpread'],
    // pop-up messages (toast) and dialogs that carry a number or a name (build 139)
    [/^Undone — (\d+) more steps?$/, 'tUndoneN'],
    [/^Redone — (\d+) more steps?$/, 'tRedoneN'],
    [/^(Channel swap|Targeted colour|White balance|Light|Colour|Detail) reset$/, 'tPanelReset'],
    [/^Build (\d+) is available$/, 'tBuildAvail'],
    [/^You are on the latest version \(build (\d+)\)$/, 'tLatest'],
    [/^Could not check for updates \((.+)\)$/, 'tUpdFail'],
    [/^Up to (\d+) masks$/, 'tMaskMax'],
    [/^Re-decoded with (.+)$/, 'tRedecoded'],
    [/^Saved “(.+)”$/, 'tSavedQ'],
    [/^Saved (\S+\.\w{2,5})$/, 'tSavedName'],
    [/^LUT saved — (.+)$/, 'tLutSaved'],
    [/^LUT export failed: (.+)$/, 'tLutFail'],
    [/^Loaded TIFF — (\d+×\d+) \(full resolution\)$/, 'tLoadedTiff'],
    [/^Loaded (\S+) sensor data — (\d+×\d+) \((.+)\)$/, 'tLoadedRaw'],
    [/^Loaded (\S+) embedded preview — (\d+×\d+) \(camera rendering, not raw sensor data\)$/, 'tLoadedEmbPrev'],
    [/^Loaded (\S+) preview — (\d+×\d+) \(camera rendering, not raw sensor data\)$/, 'tLoadedPrev'],
    [/^Decoding (\S+) sensor data \((.+)\)… this can take a while$/, 'tDecodingAlg'],
    [/^Decoding (\S+) sensor data… this can take a while on a large file$/, 'tDecoding'],
    [/^Reading (\S+) preview…$/, 'tReadingPrev'],
    [/^Rebuilding preview colour… (\d+)%$/, 'tRebuildPct'],
    [/^Could not read (.+?)( \(.+\))?$/, 'tCouldNotRead'],
    [/^Could not combine the shots( \(.+\))?$/, 'tCombineFail'],
    [/^Delete “(.+)”\?$/, 'tDeleteQ'],
    [/^Replace “(.+)”\?$/, 'tReplaceQ'],
    [/^Something failed: (.+)$/, 'tSomethingFailed'],
    [/^Tone mapping failed \((.+)\)$/, 'tToneFail'],
    [/^RAW noise reduction failed \((.+)\)$/, 'tNrFail'],
    [/^Auto levels: exposure (\S+) EV, black (\S+), brightness (\S+), contrast (\S+), highlights (\S+)$/, 'tAutoLevels'],
    [/^Auto: gains (\S+), black point (-?\d+)$/, 'tAutoGains'],
    [/^Original \((\d+×\d+)\) exceeds this device’s GPU texture limit \((\d+)px\) — using working size instead$/, 'tGpuLimit'],
    [/^Full-resolution version failed to build \((.+)\) — export and Expand will use working size only for this photo$/, 'tFullResFail'],
    [/^Original render failed \((.+)\) — using working size$/, 'tOrigRenderFail'],
    [/^Export failed: (.+)$/, 'tExportFail'],
    [/^RAW sensor decode failed for this (\S+):$/, 'tRawFailFor'],
    [/^(\S+) opened, but no usable preview image was found inside it\.$/, 'tNoPreview'],
    [/^(\S+) files can't be opened directly — web browsers have no decoder for them\.$/, 'tCantOpen'],
    [/^The three channels are near-identical \(means within (-?[\d.]+) levels\)\. That is normal above roughly 700nm, where every sensor channel sees much the same infrared — a swap will do very little\. Below that, expect them to differ\.$/, 'tChSame'],
  ];
  const tables = {};
  let lang = 'en', dict = null, started = false;
  const norm = t => t.replace(/\s+/g, ' ').trim();
  const txtOrig = new WeakMap(), txtWritten = new WeakMap();
  const attrOrig = new WeakMap(), attrWritten = new WeakMap();
  const blockOrig = new WeakMap(), blockWritten = new WeakMap();

  function lookup(en) {
    if (!dict) return null;
    const k = norm(en);
    if (!k || !/[A-Za-z]/.test(k)) return null;
    if (Object.prototype.hasOwnProperty.call(dict, k)) return dict[k];
    const t = template(k);
    if (t != null) return t;
    /* A list of short notes joined by " · " (the filter descriptions, mostly): translate each piece that has an
       entry and keep the rest, which are names, numbers and model codes. Only used if at least one piece changed. */
    if (k.indexOf(' · ') > 0) {
      let changed = false;
      const parts = k.split(' · ').map(seg => {
        const v = Object.prototype.hasOwnProperty.call(dict, seg) ? dict[seg] : template(seg);
        if (v != null) { changed = true; return v; }
        return seg;
      });
      if (changed) return parts.join(' · ');
    }
    return null;
  }
  function template(k) {
    for (const [re, name] of TEMPLATES) {
      const m = k.match(re);
      if (m && dict[name]) {
        const args = m.slice(1).map(g => (g != null && Object.prototype.hasOwnProperty.call(dict, g) ? dict[g] : (g || '')));
        return dict[name].replace(/\{(\d)\}/g, (_, i) => args[+i]);
      }
    }
    return null;
  }
  // keep the spaces around a string, so words do not run into their neighbours
  const wrap = (en, tr) => en.match(/^\s*/)[0] + tr + en.match(/\s*$/)[0];

  function doText(n) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP) || p.closest('[data-tr-block]')) return;
    const cur = n.nodeValue;
    let en = txtOrig.get(n);
    if (en === undefined || cur !== txtWritten.get(n)) { en = cur; txtOrig.set(n, en); }
    const tr = lang === 'en' ? null : lookup(en);
    const target = tr == null ? en : wrap(en, tr);
    if (target !== cur) n.nodeValue = target;
    txtWritten.set(n, target);
  }
  function doAttrs(el) {
    if (el.closest(SKIP_ATTR)) return;
    let o = attrOrig.get(el), w = attrWritten.get(el);
    if (!o) { o = {}; w = {}; attrOrig.set(el, o); attrWritten.set(el, w); }
    for (const a of ATTRS) {
      const cur = el.getAttribute(a);
      if (cur == null) continue;
      if (o[a] === undefined || cur !== w[a]) o[a] = cur;
      const tr = lang === 'en' ? null : lookup(o[a]);
      const target = tr == null ? o[a] : tr;
      if (target !== cur) el.setAttribute(a, target);
      w[a] = target;
    }
  }
  function doBlock(el) {
    if (el.parentElement && el.parentElement.closest(SKIP)) return;
    const cur = el.innerHTML;
    let en = blockOrig.get(el);
    if (en === undefined || cur !== blockWritten.get(el)) { en = cur; blockOrig.set(el, en); }
    let target = en;
    if (lang !== 'en' && dict) {
      const probe = document.createElement('div'); probe.innerHTML = en;
      const k = norm(probe.textContent);
      if (Object.prototype.hasOwnProperty.call(dict, k)) target = dict[k];
    }
    if (target !== cur) el.innerHTML = target;
    blockWritten.set(el, el.innerHTML);
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    if (root.matches(SKIP)) return;
    if (root.hasAttribute('data-tr-block')) { doBlock(root); doAttrs(root); return; }
    doAttrs(root);
    root.querySelectorAll('[title],[aria-label],[placeholder]').forEach(doAttrs);
    root.querySelectorAll('[data-tr-block]').forEach(doBlock);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = tw.nextNode())) doText(n);
  }
  let busy = false;
  const mo = new MutationObserver(recs => {
    if (busy) return;
    busy = true;
    try {
      for (const r of recs) {
        if (r.type === 'childList') r.addedNodes.forEach(walk);
        else if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes' && r.target.nodeType === 1) doAttrs(r.target);
      }
    } finally { busy = false; }
  });
  function start() {
    if (started || !document.body) return;
    started = true;
    walk(document.body);
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function apply(l) {
    lang = l || 'en';
    dict = lang === 'en' ? null : (tables[lang] || null);
    document.documentElement.setAttribute('lang', lang);
    if (!started) { if (document.readyState !== 'loading') start(); return; }
    busy = true;
    try { walk(document.body); } finally { busy = false; }
  }
  function load(l, done) {
    if (l === 'en' || tables[l]) { done && done(); return; }
    const s = document.createElement('script');
    s.src = 'i18n/' + l + '.js?b=' + (window.IRLAB_BUILD || '');
    s.onload = s.onerror = () => done && done();
    document.head.appendChild(s);
  }
  window.irlabTr = {
    add(l, t) { tables[l] = Object.assign(tables[l] || {}, t); if (l === lang) dict = tables[l]; },
    /* set the language: loads its table if needed, translates the page, then calls done (if given) */
    set(l, done) { load(l, () => { apply(l); if (done) done(); }); },
    lookup: en => lookup(en),
    get lang() { return lang; },
  };
  /* alert() boxes are drawn by the browser, outside the page, so the observer never sees them. Translate them here,
     paragraph by paragraph (then line by line), leaving error details and file names as they are. */
  const nativeAlert = window.alert.bind(window);
  window.alert = msg => {
    if (lang === 'en' || !dict || typeof msg !== 'string') return nativeAlert(msg);
    const tr = msg.split('\n\n').map(par => {
      const whole = lookup(par);
      if (whole != null) return whole;
      return par.split('\n').map(line => { const v = lookup(line); return v == null ? line : v; }).join('\n');
    }).join('\n\n');
    return nativeAlert(tr);
  };
  // the same choice as the editor's detectUILang: the saved pick, else the browser's language if it is one of ours
  const LANGS = ['en', 'es', 'fr', 'de', 'ja', 'zh'];
  let saved = null;
  try { saved = localStorage.getItem('uiLang'); } catch (e) {}
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  lang = LANGS.indexOf(saved) >= 0 ? saved : (LANGS.indexOf(nav) >= 0 ? nav : 'en');
  const meta = document.querySelector('meta[name="irlab-build"]');
  window.IRLAB_BUILD = meta ? meta.content : '';
  /* Loaded in <head> as a plain script, so the chosen language's table can be written in right after it and be in
     place before the page is drawn (no flash of English). Same-origin, so document.write is allowed here. */
  if (lang !== 'en' && document.readyState === 'loading') {
    document.write('<script src="i18n/' + lang + '.js?b=' + window.IRLAB_BUILD + '"><\/script>');
  }
  dict = tables[lang] || null;
  document.addEventListener('DOMContentLoaded', () => { dict = lang === 'en' ? null : (tables[lang] || null); start(); });
})();
