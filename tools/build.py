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
"""
import os, re

BUNDLES = [
    ('editor.js', 'src', ['shaders', 'engine', 'i18n', 'view', 'controls', 'raw-preview', 'session', 'raw-process', 'ui',
                          'wb-lut', 'colour-mirror', 'export', 'dock', 'trichrome', 'selftest', 'undo-buttons']),
    ('filters.js', 'src-filters', ['layout', 'model', 'data', 'list-search', 'export', 'recipe', 'chart', 'selftest',
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
    extra = sorted(set(f[:-3] for f in os.listdir(os.path.join(root, folder)) if f.endswith('.js')) - set(order))
    assert not extra, f'files in {folder}/ not listed in BUNDLES: {extra}'
    text = ''.join(parts)
    open(os.path.join(root, out_name), 'w', encoding='utf-8').write(text)
    print(f'{out_name}: {len(order)} files, {text.count(chr(10))} lines')
