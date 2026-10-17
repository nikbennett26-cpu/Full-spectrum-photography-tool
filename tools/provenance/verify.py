#!/usr/bin/env python3
"""Check every curve taken from CheeseCube312's Filter-Plotter-Data against the file it came from.

    git clone https://github.com/CheeseCube312/Filter-Plotter-Data /tmp/fpd
    git -C /tmp/fpd checkout 6c8ff04c18ebaee137a49ca09b89065c7aaba8ab     # the commit pinned in provenance.js
    python3 tools/provenance/verify.py /tmp/fpd

For each filter in src-filters/provenance.js with a cc file, this reads the stored curve from src-filters/model.js,
interpolates both onto a 5nm grid over the part of 280-1100nm the source file covers, and records the largest
difference in percentage points as that filter's ccd (shown on its card as "Checked"). A few points is resampling
(a 10nm table cannot follow a sharp edge sampled at 5nm); more than that means the stored curve and its claimed source
have drifted apart, which the page's self-test reports. The full list is written to tools/provenance/check.txt.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, '..', '..')
up = sys.argv[1]

model = open(os.path.join(REPO, 'src-filters', 'model.js'), encoding='utf-8').read()
curves = {m.group(1): [float(x) for x in m.group(2).split(',')]
          for m in re.finditer(r'^  ([a-z0-9_]+):\[([^\]]*)\],?$', model, re.M)}

prov_path = os.path.join(REPO, 'src-filters', 'provenance.js')
prov = open(prov_path, encoding='utf-8').read()
a, b = prov.index('/*PROV-BEGIN'), prov.index('/*PROV-END*/')
block = prov[a:b]


def interp(xs, ys, x):
    if x <= xs[0]: return ys[0]
    if x >= xs[-1]: return ys[-1]
    lo, hi = 0, len(xs) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xs[mid] <= x: lo = mid
        else: hi = mid
    t = (x - xs[lo]) / (xs[hi] - xs[lo])
    return ys[lo] + t * (ys[hi] - ys[lo])


report, out_lines = [], []
for line in block.split('\n'):
    m = re.match(r"^  ([a-z0-9_]+):\{(.*)\},$", line)
    cc = m and re.search(r"cc:'((?:[^'\\]|\\.)*)'", m.group(2))
    if not cc:
        out_lines.append(line); continue
    fid, path = m.group(1), cc.group(1).replace("\\'", "'")
    rows = []
    for r in open(os.path.join(up, 'filters_data', path), encoding='utf-8', errors='replace').read().splitlines()[1:]:
        c = r.split('\t')
        try: rows.append((float(c[0]), min(1.0, max(0.0, float(c[1]) / 100))))
        except (ValueError, IndexError): pass
    rows.sort()
    ux, uy = [r[0] for r in rows], [r[1] for r in rows]
    arr = curves[fid]
    sx, sy = arr[0::2], arr[1::2]
    grid = [l for l in range(280, 1101, 5) if ux[0] <= l <= ux[-1]]
    diffs = [(abs(interp(sx, sy, l) - interp(ux, uy, l)), l) for l in grid]
    d, at = max(diffs)
    d = round(d * 100, 1)
    report.append(f'{fid:14s} {d:5.1f} pp at {at}nm   {path}')
    body = re.sub(r",ccd:[\d.]+", '', m.group(2)) + f',ccd:{d}'
    out_lines.append(f'  {fid}:{{{body}}},')

open(prov_path, 'w', encoding='utf-8').write(prov[:a] + '\n'.join(out_lines) + prov[b:])
open(os.path.join(HERE, 'check.txt'), 'w', encoding='utf-8').write(
    'Stored curves vs CheeseCube312 Filter-Plotter-Data at commit 6c8ff04c18ebaee137a49ca09b89065c7aaba8ab\n'
    '(largest difference on a 5nm grid over the source file\'s own range within 280-1100nm)\n\n' + '\n'.join(report) + '\n')
print('\n'.join(report))
print(f'{len(report)} curves checked; largest difference {max(float(r.split()[1]) for r in report):.1f} pp')
