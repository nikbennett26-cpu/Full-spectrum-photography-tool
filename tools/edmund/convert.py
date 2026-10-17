"""Turn the collected Edmund Optics curves (tools/edmund/data/*.json) into src-filters/edmund.js.
Each json: {stock: [family id, name hint, checksum, [nm, T, ...]]}. The kind of filter (longpass, shortpass,
bandpass, notch-like) and its edge or centre are read from the curve itself, so they are the measured values."""
import json, glob, os, re, sys
from collections import Counter
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, '..', '..')
FAM = {
 '13630': 'OD4 longpass', '39684': 'OD2 longpass', '13133': 'OD2 longpass', '12259': 'cast IR longpass', '14288': 'dichroic longpass',
 '13534': 'OD4 shortpass', '39683': 'OD2 shortpass', '12876': 'OD2 shortpass', '11431': 'IR cut-off', '14198': 'dichroic shortpass',
 '39883': 'IR shortpass', '13837': 'OD4 bandpass', '14529': 'OD4 bandpass', '14321': 'OD4 bandpass', '39463': 'OD4 bandpass',
 '39675': 'OD4 bandpass', '40206': 'OD5 bandpass', '12289': 'interference bandpass', '13917': 'interference bandpass',
 '12232': 'interference bandpass', '39502': 'UV bandpass', '14290': 'IR bandpass', '39866': 'astronomy filter',
 '14987': 'machine-vision filter', '39887': 'machine-vision filter', '40225': 'multi-band machine-vision filter',
 '40144': 'high-transmission bandpass', '11985': 'dichroic colour filter', '12257': 'cast plastic colour filter',
 '11665': 'hot mirror', '13824': 'hot mirror', '12314': 'extended hot mirror', '13270': 'UV hot mirror', '12226': 'cold mirror',
 '13821': 'cold mirror', '14164': 'IR longpass',
}
items = {}
for f in sorted(glob.glob(os.path.join(HERE, 'data', 'part*.json'))):
    items.update(json.load(open(f)))
# the wavelength span each source chart covers; outside it the curve is only held at its last value
RANGES = json.load(open(os.path.join(HERE, 'data', 'ranges.json')))
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
def T(c, l):
    for i in range(0, len(c) - 2, 2):
        if c[i] <= l <= c[i + 2]: return c[i + 1] + (l - c[i]) / (c[i + 2] - c[i] or 1) * (c[i + 3] - c[i + 1])
    return c[-1]
def describe(c):
    """the 50%-of-peak crossings decide what the curve is"""
    xs = list(range(280, 1101)); ts = [T(c, x) for x in xs]; pk = max(ts); half = pk / 2
    cross = []
    for i in range(1, len(xs)):
        a, b = ts[i - 1] >= half, ts[i] >= half
        if a != b: cross.append((xs[i], 'up' if b else 'down'))
    if not cross: return None, None
    if len(cross) == 1:
        x, d = cross[0]
        return (f'{x}nm cut-on', x) if d == 'up' else (f'{x}nm cut-off', max(300, x - 60))
    if len(cross) == 2 and cross[0][1] == 'up' and cross[1][1] == 'down':
        lo, hi = cross[0][0], cross[1][0]; cw = round((lo + hi) / 2)
        if hi - lo > 150: return f'passes {lo}-{hi}nm', cw   # a broad window (a visible-pass or IR-cut), not a bandpass
        return f'{cw}nm centre, {hi - lo}nm wide', cw
    if len(cross) == 2 and cross[0][1] == 'down':
        return f'blocks {cross[0][0]}-{cross[1][0]}nm', (cross[0][0] + cross[1][0]) // 2
    peak = xs[ts.index(pk)]
    return f'peak {peak}nm', peak
bad, out, seen, dropped = [], [], {}, []
for stock, (fam, hint, chk, c) in items.items():
    if abs(sum(c) - chk) > 0.01: bad.append((stock, round(sum(c), 3), chk)); continue
    if max(c[1::2]) < 0.05: continue
    d, wl = describe(c)
    if not d: continue
    # a hot mirror passes visible and blocks IR; a curve the other way round is its reflectance, not its transmission
    if 'hot mirror' in FAM.get(fam, '') and 'cut-on' in d: dropped.append((stock, d, 'reflectance')); continue
    lo, hi = RANGES.get(stock, [280, 1100])
    note = ''
    if hi < 1095:
        # past the end of Edmund's chart nothing is known: fine to hold a longpass open, not to guess a tail
        # (colour filters are kept anyway: they are wanted for colour work, and the description says where the data ends)
        if 'cut-on' not in d and T(c, hi) > 0.1 and 'colour' not in FAM.get(fam, ''): dropped.append((stock, d, hi)); continue
        note = f' · data to {hi}nm'
    sig = tuple(round(v, 2) for v in c)
    if sig in seen: continue          # the same coating listed under two families
    seen[sig] = stock
    label = FAM.get(fam, 'filter')
    # colour filters: the colour is in the name hint (the product's own name)
    m = re.search(r'(red|green|blue|cyan|magenta|yellow|orange|amber|violet)', hint or '', re.I)
    extra = (' ' + m.group(1).lower()) if m and 'colour' in label else ''
    n = f'Edmund{extra} {label} #{stock}'
    key = (label, d, extra)
    if key in seen: continue
    seen[key] = stock
    out.append((band(wl), n, 'eo_' + stock.replace('-', ''), d + ' · ' + label + note, colour(wl), fam, c))
if bad: print('CHECKSUM MISMATCH', bad); sys.exit(1)
order = {f'B{i}': i for i in range(1, 10)}
out.sort(key=lambda x: (order[x[0]], x[3]))
js = ["/* ---------- Edmund Optics filters (build 143) ----------",
      "   Transmission curves from Edmund Optics' own product data: the curve each product page draws (its JSON chart",
      "   data) or, where a product only has a curve PDF, the line read from that PDF's vector drawing and calibrated",
      "   against its axis labels. Resampled to 1nm, cut to this page's 280-1100nm window, thinned to within 2 percentage",
      "   points. Outside a chart's own range the curve is held at its last value. Edmund marks these 'for reference",
      "   only': they are coating design/typical curves. Collected and built by tools/edmund/ (see its README). */",
      "const EDMUND_FILTERS = ["]
for g, n, key, d, c, fam, curve in out:
    cv = ','.join(('%d' % v) if i % 2 == 0 else ('%g' % v) for i, v in enumerate(curve))
    js.append(f"  ['{key}','{g}','{n}','{d}','{c}',[{cv}]],")
js.append("];")
js.append("""EDMUND_FILTERS.forEach(([id, g, n, d, c, curve]) => {
  if (FILTERS.find(f => f.id === id)) return;
  REAL_CURVES[id] = curve;
  FILTERS.push({ id, g, n, d: d + ' \\u00b7 real Edmund data', c, type: 'interference', brand: 'Edmund Optics',
    bands: [{ lo: curve[0], ls: 1, T: 0 }],
    same: 'REAL DATA \\u2014 Edmund Optics\\u2019 own published curve for stock ' + n.replace(/^.*#/, '#') + ', from the product page\\u2019s '
      + 'curve data, resampled to 1nm and thinned to within 2 percentage points. Edmund labels these curves \\u201cfor reference '
      + 'only\\u201d (typical or design performance; individual filters vary a little). Coated filters shift to shorter '
      + 'wavelengths when light arrives at an angle.' });
});""")
open(os.path.join(REPO, 'src-filters', 'edmund.js'), 'w', encoding='utf-8').write('\n'.join(js) + '\n')
print('dropped (chart stops inside the passband):', dropped)
print(len(out), 'filters', Counter(x[5] for x in out).most_common(), Counter(x[0] for x in out))
