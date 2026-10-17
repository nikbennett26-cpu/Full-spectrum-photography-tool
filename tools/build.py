#!/usr/bin/env python3
"""Join each page's source files into the one script that page loads.

    python3 tools/build.py

    src/*.js          ->  editor.js    (index.html)
    src-filters/*.js  ->  filters.js   (filters.html)

Why one file per page: each page's sources share one global scope and were written as a single script. As separate
<script> tags the browser can run other work between them (a saved session being reopened, a timer, a tap), and that
work can call code whose file has not arrived yet, which broke the editor on phones in builds 130-131. One file runs
in one go, and a function anywhere in it is available from the start, exactly as before the split.

Edit the sources, never the built files, then run this (tools/bump_build.py runs it for you).

Build 141: each bundle is then shrunk with Terser (tools/minify.mjs; once, run `npm install` in tools/), which drops
the comments and spacing and shortens local names. The sources keep every comment. A source map (<bundle>.map) leads a
browser's developer tools from the shrunk file back to the original src/ file and line.
    python3 tools/build.py --readable    writes the bundles unshrunk, as before (for debugging)
"""
import os, re, sys, json, subprocess, tempfile

B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
def vlq(n):
    n = (-n << 1) | 1 if n < 0 else n << 1
    out = ''
    while True:
        d = n & 31; n >>= 5
        out += B64[d | (32 if n else 0)]
        if not n: return out
READABLE = '--readable' in sys.argv

BUNDLES = [
    ('editor.js', 'src', ['shaders', 'engine', 'i18n', 'view', 'controls', 'raw-preview', 'session', 'raw-process', 'ui',
                          'wb-lut', 'colour-mirror', 'export', 'dock', 'trichrome', 'share', 'undo-buttons']),
    # the self-test is only fetched when the page is opened with ?selftest (src/i18n.js), so most visits skip its 130 KB
    ('editor-selftest.js', 'src', ['selftest']),
    ('filters.js', 'src-filters', ['layout', 'model', 'data', 'thorlabs', 'list-search', 'export', 'recipe', 'chart', 'selftest',
                                   'zoom-guidance', 'spectral']),
]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
for out_name, folder, order in BUNDLES:
    parts = [f"'use strict';\n/* {out_name} is BUILT from {folder}/*.js by tools/build.py. Do not edit it: edit {folder}/ and rebuild.\n"
             f"   Each part starts with a ==== {folder}/<file>.js ==== line, so an error's line number leads back to its source. */\n"]
    for name in order:
        s = open(os.path.join(root, folder, name + '.js'), encoding='utf-8').read()
        s = re.sub(r"\A'use strict';\n", '', s)
        parts.append(f'\n/* ==================== {folder}/{name}.js ==================== */\n' + s.rstrip('\n') + '\n')
    listed = set(n for _, d, o in BUNDLES if d == folder for n in o)
    extra = sorted(set(f[:-3] for f in os.listdir(os.path.join(root, folder)) if f.endswith('.js')) - listed)
    assert not extra, f'files in {folder}/ not listed in BUNDLES: {extra}'
    text = ''.join(parts)
    out_path = os.path.join(root, out_name)
    if READABLE:
        open(out_path, 'w', encoding='utf-8').write(text)
        if os.path.exists(out_path + '.map'): os.remove(out_path + '.map')
        print(f'{out_name}: {len(order)} files, {text.count(chr(10))} lines (readable)')
        continue
    # a line-for-line source map of the joined bundle back to its source files, which Terser carries through
    srcs = [f'{folder}/{n}.js' for n in order]
    lines_src = []   # for each bundle line: (source index, source line) or None
    lines_src += [None] * parts[0].count('\n')
    for i, name in enumerate(order):
        s = open(os.path.join(root, folder, name + '.js'), encoding='utf-8').read()
        skip = 1 if s.startswith("'use strict';\n") else 0
        body = re.sub(r"\A'use strict';\n", '', s).rstrip('\n') + '\n'
        lines_src += [None, None]   # the blank line and the ==== marker
        lines_src += [(i, skip + k) for k in range(body.count('\n'))]
    segs, ps, pl = [], 0, 0
    for ls in lines_src + [None]:
        if ls is None: segs.append(''); continue
        si, sl = ls
        segs.append('A' + vlq(si - ps) + vlq(sl - pl) + 'A'); ps, pl = si, sl
    smap = {'version': 3, 'sources': srcs, 'names': [], 'mappings': ';'.join(segs)}
    with tempfile.TemporaryDirectory() as td:
        tin, tmap = os.path.join(td, out_name), os.path.join(td, out_name + '.map')
        open(tin, 'w', encoding='utf-8').write(text); open(tmap, 'w').write(json.dumps(smap))
        subprocess.run(['node', os.path.join(root, 'tools', 'minify.mjs'), tin, out_path, tmap], check=True)
    small = open(out_path, encoding='utf-8').read()
    print(f'{out_name}: {len(order)} files, {len(text)//1024} KB -> {len(small)//1024} KB')
