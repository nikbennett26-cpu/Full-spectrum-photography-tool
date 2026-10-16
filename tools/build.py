#!/usr/bin/env python3
"""Join the editor's source files (src/*.js) into editor.js, the one script index.html loads.

    python3 tools/build.py

Why one file: the sources share one global scope and were written as a single script. As separate <script> tags the
browser can run other work between them (a saved session being reopened, a timer, a tap), and that work can call
code whose file has not arrived yet, which broke the app on phones in build 130-131. One file runs in one go, and a
function anywhere in it is available from the start, exactly as before the split.

Edit the files in src/, never editor.js, then run this (tools/bump_build.py runs it for you).
"""
import os, re

ORDER = ['shaders', 'engine', 'i18n', 'view', 'controls', 'raw-preview', 'session', 'raw-process', 'ui', 'wb-lut',
         'colour-mirror', 'export', 'dock', 'selftest', 'undo-buttons']
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
parts = ["'use strict';\n/* editor.js is BUILT from src/*.js by tools/build.py. Do not edit it: edit src/ and rebuild.\n"
         "   Each part starts with a ==== src/<file>.js ==== line, so an error's line number leads back to its source. */\n"]
for name in ORDER:
    s = open(os.path.join(root, 'src', name + '.js'), encoding='utf-8').read()
    s = re.sub(r"\A'use strict';\n", '', s)
    parts.append(f'\n/* ==================== src/{name}.js ==================== */\n' + s.rstrip('\n') + '\n')
extra = sorted(set(f[:-3] for f in os.listdir(os.path.join(root, 'src')) if f.endswith('.js')) - set(ORDER))
assert not extra, f'files in src/ not listed in ORDER: {extra}'
out = ''.join(parts)
open(os.path.join(root, 'editor.js'), 'w', encoding='utf-8').write(out)
print(f'editor.js: {len(ORDER)} files, {out.count(chr(10))} lines')
