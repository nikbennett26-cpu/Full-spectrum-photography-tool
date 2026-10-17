"""Turn the collected Thorlabs curves (tools/thorlabs/data/*.json) into src-filters/thorlabs.js.
Each json: {family: {id: [desc, checksum, [wl,T,...]]}}"""
import json, glob, os, re, sys
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
fams = {}
for f in sorted(glob.glob(os.path.join(HERE, 'data_*.json'))):
    for fam, items in json.load(open(f)).items(): fams.setdefault(fam, {}).update(items)
def lam_rgb(l):
    r = g = b = 0.0
    if 380 <= l < 440: r = -(l - 440) / 60; b = 1
    elif 440 <= l < 490: g = (l - 440) / 50; b = 1
    elif 490 <= l < 510: g = 1; b = -(l - 510) / 20
    elif 510 <= l < 580: r = (l - 510) / 70; g = 1
    elif 580 <= l < 645: r = 1; g = -(l - 645) / 65
    elif 645 <= l <= 780: r = 1
    f = 1
    if 380 <= l < 420: f = .3 + .7 * (l - 380) / 40
    elif 700 < l <= 780: f = .3 + .7 * (780 - l) / 80
    elif l < 380 or l > 780: f = 0
    return [round(255 * (c * f) ** .8) for c in (r, g, b)]
def colour(l):
    if l < 400: return '#8f7ad6'
    if l > 760: return '#a83c22' if l < 900 else '#722113'
    r, g, b = lam_rgb(l); return '#%02x%02x%02x' % (max(r, 40), max(g, 40), max(b, 40))
def band(wl):
    for lim, code in [(320, 'B1'), (400, 'B2'), (450, 'B3'), (500, 'B4'), (550, 'B5'), (600, 'B6'), (700, 'B7'), (800, 'B8')]:
        if wl < lim: return code
    return 'B9'
out, bad, seen = [], [], set()
for fam, items in fams.items():
    for pid, (desc, chk, curve) in items.items():
        # transcription check: the page sent a checksum of the numbers
        s = round(sum(curve), 3)
        if abs(s - chk) > 0.01: bad.append((pid, s, chk)); continue
        wl = curve[0::2]; T = curve[1::2]
        m = re.match(r'^(FELH|FESH)(\d{4})$', pid)
        b = re.match(r'^(FBH|FLH|FB)(\d+)-(\d+)$', pid)
        mv = re.search(r'CWL = (\d+) nm, FWHM = (\d+) nm', desc or '')
        if not b and mv: b = re.match(r'(x)(\d+)-(\d+)', 'x%s-%s' % mv.groups())
        if m:
            kind = 'longpass' if m.group(1) == 'FELH' else 'shortpass'; edge = int(m.group(2))
            if edge > 1100 or (kind == 'shortpass' and edge < 300): continue
            d = (f'{edge}nm cut-on' if kind == 'longpass' else f'{edge}nm cut-off') + ' · hard-coated ' + kind
            g = band(edge if kind == 'longpass' else max(300, edge - 60)); c = colour(edge)
        elif b:
            cwl, fw = int(b.group(2)), int(b.group(3))
            if cwl > 1100 or fw < 3: continue   # 1nm laser-line filters: far too narrow to photograph through
            d = f'{cwl}nm centre, {fw}nm wide · ' + ('machine-vision bandpass' if pid.startswith('MVF') else 'hard-coated bandpass'); g = band(cwl); c = colour(cwl); kind = 'bandpass'
        else:
            d = (desc or pid).replace('\r', ' ').replace('\n', ' ').strip(); d = re.sub(r'\s+', ' ', d)
            peak = wl[T.index(max(T))]; g = band(peak); c = colour(peak); kind = 'other'
        if max(T) < 0.05: continue
        key = re.sub(r'[^a-z0-9]', '', pid.lower())
        if key in seen: continue
        seen.add(key)
        out.append((g, pid, key, d, c, kind, curve, fam))
if bad: print('CHECKSUM MISMATCH', bad); sys.exit(1)
order = {f'B{i}': i for i in range(1, 10)}
out.sort(key=lambda x: (order[x[0]], x[1]))
js = ["/* ---------- Thorlabs filters (build 142) ----------",
      "   Measured transmission curves from Thorlabs' own published data (the downloadable spreadsheet behind each filter's",
      "   plot on thorlabs.com), for their hard-coated longpass, shortpass and bandpass filters. Each was resampled to 1nm,",
      "   cut to this page's 280-1100nm window and thinned to the points that keep the curve within 2 percentage points of the",
      "   original (more points where it bends, few on flat stretches). Thorlabs' own note: the data are typical, and",
      "   performance varies a little from lot to lot. Collected and built by tools/thorlabs/ (see its README); ids are tl_<part>. */",
      "const THORLABS_FILTERS = ["]
for g, pid, key, d, c, kind, curve, fam in out:
    cv = ','.join(('%d' % v) if i % 2 == 0 else ('%g' % v) for i, v in enumerate(curve))
    js.append(f"  ['{key}','{g}','Thorlabs {pid}','{d}','{c}','{fam}',[{cv}]],")
js.append("];")
js.append("""THORLABS_FILTERS.forEach(([key, g, n, d, c, fam, curve]) => {
  const id = 'tl_' + key;
  if (FILTERS.find(f => f.id === id)) return;
  REAL_CURVES[id] = curve;
  FILTERS.push({ id, g, n, d: d + ' \\u00b7 real Thorlabs data', c, type: 'interference', brand: 'Thorlabs',
    // bands is only a fallback shape for code that reads it; the measured curve in REAL_CURVES is what is drawn
    bands: [{ lo: curve[0], ls: 1, T: 0 }],
    same: 'REAL DATA \\u2014 Thorlabs\\u2019 own published transmission data for ' + n.replace('Thorlabs ', '') +
      ' (the spreadsheet behind its plot on thorlabs.com, family: ' + fam + '), resampled to 1nm and thinned to within 2 '
      + 'percentage points of the original. Thorlabs notes the data are typical and vary slightly from lot to lot; '
      + 'hard-coated interference filters also shift to shorter wavelengths when light arrives at an angle.' });
});""")
open(os.path.join(REPO, 'src-filters', 'thorlabs.js'), 'w', encoding='utf-8').write('\n'.join(js) + '\n')
from collections import Counter
print(len(out), 'filters', Counter(x[5] for x in out), Counter(x[0] for x in out))
