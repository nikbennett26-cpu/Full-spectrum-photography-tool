#!/usr/bin/env python3
"""List interface text that is still in English when another language is chosen.

    python3 tools/i18n_check.py [index.html|filters.html] [es|fr|de|ja|zh]

Needs a local server on port 8820 (python3 -m http.server 8820 in the repo) and Playwright. It collects every text
node, title, aria-label and placeholder on the page in English and in the chosen language (with a photo open, for the
editor), and prints the ones that came out identical. Some are meant to stay (brand names, AMaZE, formats, and words
that are the same in that language, like "Detail" in German); the rest need an entry in i18n/<lang>.js, keyed by the
English with spaces collapsed. The change log (#whatsNew) is deliberately left in English and is not checked.
"""
import os, sys
from playwright.sync_api import sync_playwright
page = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
lang = sys.argv[2] if len(sys.argv) > 2 else 'de'
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
JS = r"""
(() => {
  const skip = el => el.closest('script,style,svg,#uiLang,code,.noTr,#whatsNew,#buildStamp,#buildStampHome');
  const norm = t => t.replace(/\s+/g,' ').trim();
  const out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { const p = n.parentElement; if (!p || skip(p)) continue; const t = norm(n.nodeValue); if (/[A-Za-z]{2}/.test(t)) out.add(t); }
  document.querySelectorAll('[title],[aria-label],[placeholder]').forEach(el => { if (el.closest('script,style,#uiLang,#whatsNew')) return;
    ['title','aria-label','placeholder'].forEach(a => { const v = el.getAttribute(a); if (v && /[A-Za-z]{2}/.test(v)) out.add(norm(v)); }); });
  return [...out];
})()
"""
def grab(l):
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 412, 'height': 900}, is_mobile=True, has_touch=True)
        pg.add_init_script(f"try{{localStorage.setItem('uiLang','{l}')}}catch(e){{}}")
        pg.goto('http://localhost:8820/' + page); pg.wait_for_timeout(2500)
        if page.startswith('index'):
            pg.set_input_files('#fi', os.path.join(REPO, 'og-card.png')); pg.wait_for_timeout(3500)
        r = pg.evaluate(JS); b.close(); return r
en = grab('en'); other = set(grab(lang))
left = [t for t in en if t in other]
print(f'{page} in {lang}: {len(left)} of {len(en)} strings unchanged from English')
for t in left: print('  ', t[:120])
