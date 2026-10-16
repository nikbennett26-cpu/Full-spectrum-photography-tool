#!/usr/bin/env python3
"""Set the build number everywhere it appears, in one go.

    python3 tools/bump_build.py 131

Updates the irlab-build meta tag (read by the in-app update check), the two version stamps, and the ?b=<build>
on every stylesheet and script URL in index.html (so the service worker never mixes cached old files with a new
page), then rebuilds editor.js from src/ (tools/build.py). Run it from the repository root or anywhere: it finds index.html next to this folder.
"""
import datetime, os, re, sys

n = int(sys.argv[1])
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html')
s = open(p, encoding='utf-8').read()
today = datetime.date.today().isoformat()
s, a = re.subn(r'<meta name="irlab-build" content="\d+">', f'<meta name="irlab-build" content="{n}">', s)
s, b = re.subn(r'Version \d{4}-\d{2}-\d{2} · build \d+', f'Version {today} · build {n}', s)
s, c = re.subn(r'((?:css/)?[\w.-]+\.(?:css|js))\?b=\d+', rf'\g<1>?b={n}', s)
assert a == 1 and b == 2 and c > 0, (a, b, c)
open(p, 'w', encoding='utf-8').write(s)
# the filters page carries the same build number (it loads the shared translation files with it)
fp = os.path.join(os.path.dirname(p), 'filters.html')
f = open(fp, encoding='utf-8').read()
f, fa = re.subn(r'<meta name="irlab-build" content="\d+">', f'<meta name="irlab-build" content="{n}">', f)
f, fc = re.subn(r'((?:i18n/tr|filters|css/filters)\.(?:js|css))\?b=\d+', rf'\g<1>?b={n}', f)
assert fa == 1 and fc == 3, (fa, fc)
open(fp, 'w', encoding='utf-8').write(f)
print(f'build {n}: meta 1, stamps {b}, file URLs {c}')
import subprocess, sys as _s
subprocess.run([_s.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build.py')], check=True)
