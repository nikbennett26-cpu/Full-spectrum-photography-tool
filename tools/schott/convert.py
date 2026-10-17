#!/usr/bin/env python3
"""Build src-filters/schott.js from SCHOTT's own published tables (tools/schott/data/tables.txt).

    python3 tools/schott/convert.py [--check path/to/Filter-Plotter-Data]

SCHOTT publishes, for each optical filter glass, an internal transmittance table (tau_i, the glass alone, at a stated
reference thickness d) and a reflection factor Pd (the light kept after the two air-glass surfaces). What a filter of
that glass actually passes is the external transmittance:

    T(lambda) = tau_i(lambda) * Pd                       at the reference thickness
    T(lambda) = tau_i(lambda) ** (d / d_ref) * Pd        at another thickness d (Beer-Lambert in the glass only)

Build 146 found 32 entries showing tau_i as if it were T (so uncoated RG830 peaked at 99.7%, which no uncoated glass
can do). Every SCHOTT curve in the database now comes from here, so that cannot recur: the conversion is in one place
and the self-test checks no uncoated absorptive glass exceeds its own surface-loss ceiling.

With --check, each table is compared with CheeseCube312's independent copy of the same SCHOTT data
(Filter-Plotter-Data/filters_data/Schott/Schott_<GLASS>.tsv). Two separate transcriptions agreeing is what makes a
slip in either visible; the result is written to tools/schott/check.txt.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, '..', '..')
WL = list(range(280, 1101, 10))

# database id -> (SCHOTT glass, thickness in mm or None for the reference thickness)
IDS = {
    # SCHOTT longpass series (data.js builds these entries from SCHOTT_LP)
    **{'sch_' + g.lower(): (g, None) for g in
       ['GG395', 'GG400', 'GG420', 'GG435', 'GG455', 'GG475', 'GG495', 'OG515', 'OG530', 'OG550', 'OG570', 'OG590',
        'RG610', 'RG630', 'RG645', 'RG665', 'RG695', 'RG715', 'RG780', 'RG830', 'RG850', 'RG1000']},
    'sch_wg280': ('N-WG280', None), 'sch_wg295': ('N-WG295', None), 'sch_wg305': ('N-WG305', None),
    'sch_wg320': ('N-WG320', None),
    # B+W filters cut from a named SCHOTT glass (identity stated on B+W's own reference chart; see each note)
    'bw040': ('OG550', None), 'bw099': ('OG550', None), 'bw090': ('OG590', None), 'bw091': ('RG630', None),
    'bw092': ('RG695', None), 'bw093': ('RG830', None), 'bw094': ('RG1000', None), 'bw403': ('UG1', None),
    'bw039': ('BG39', None), 'bw489': ('KG3', None),
    # SCHOTT glasses under their own names, and resellers' glass stated to be the same
    'ug11': ('UG11', None), 'sch_ug5': ('UG5', None), 'bg3': ('BG3', None), 'bg38': ('BG38', None),
    'qb21': ('BG38', None), 'bg39': ('BG39', None), 'bg40': ('BG40', None), 's8612': ('S8612', None),
    'grb3': ('KG3', None), 'sch_vg9': ('VG9', None),
    'sch_ng1': ('NG1', None), 'sch_ng3': ('NG3', None), 'sch_ng4': ('NG4', None), 'sch_ng5': ('NG5', None),
    'sch_ng9': ('NG9', None), 'sch_ng11': ('NG11', None),
    # derived: LDP CC1 is widely described as uncoated 2.5mm BG38 (an identification, not a published spec)
    'cc1': ('BG38', 2.5),
}


def load():
    glass, cur = {}, None
    for line in open(os.path.join(HERE, 'data', 'tables.txt'), encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('# '):
            continue
        if line.startswith('## '):
            parts = line[3:].split()
            cur = parts[0]
            kv = dict(p.split('=') for p in parts[1:])
            glass[cur] = {'pd': float(kv['Pd']), 'nd': float(kv['nd']), 'd': float(kv['d']), 'rows': []}
            continue
        nm, v = line.split(',')
        glass[cur]['rows'].append((int(nm), 0.0 if v in ('<', '') else float(v)))
    for g, r in glass.items():
        assert [nm for nm, _ in r['rows']] == WL, f'{g}: rows must run 280..1100nm in 10nm steps'
        assert all(0 <= v <= 1 for _, v in r['rows']), f'{g}: tau_i outside 0-1'
        assert 0.89 < r['pd'] < 0.93, f'{g}: implausible reflection factor {r["pd"]}'
    return glass


def check(glass, upstream):
    out, res = [], {}
    for g, r in sorted(glass.items()):
        p = os.path.join(upstream, 'filters_data', 'Schott', f'Schott_{g}.tsv')
        if not os.path.exists(p):
            out.append(f'{g:8s} no CheeseCube copy (SCHOTT page is the only source)')
            continue
        u = {}
        for row in open(p, encoding='utf-8').read().splitlines()[1:]:
            c = row.split('\t')
            if len(c) > 1 and c[1].strip():
                u[int(float(c[0]))] = float(c[1]) / 100
        diffs = [(abs(v - u[nm]), nm) for nm, v in r['rows'] if nm in u]
        m, at = max(diffs)
        res[g] = round(m * 100, 2)
        out.append(f'{g:8s} max |SCHOTT - CheeseCube| = {m*100:5.2f} pp at {at}nm  ' +
                   ('agree' if m <= 0.0015 else 'DIFFER (SCHOTT page used)'))
    open(os.path.join(HERE, 'check.txt'), 'w', encoding='utf-8').write(
        'SCHOTT tables (schott.com, retrieved 2026-10-17) vs CheeseCube312 Filter-Plotter-Data copy\n'
        '(values are tau_i; agreement threshold 0.15pp, i.e. rounding of a 3-decimal table)\n\n' + '\n'.join(out) + '\n')
    print('\n'.join(out))
    return res


def last_check():
    """The figures from the last --check run (check.txt), so a plain rebuild keeps them."""
    res, p = {}, os.path.join(HERE, 'check.txt')
    if os.path.exists(p):
        for line in open(p, encoding='utf-8'):
            parts = line.split()
            if len(parts) > 6 and parts[1] == 'max':
                res[parts[0]] = float(parts[6])
    return res


def main():
    glass = load()
    cc = check(glass, sys.argv[sys.argv.index('--check') + 1]) if '--check' in sys.argv else last_check()
    used = sorted(set(g for g, _ in IDS.values()))
    missing = [g for g in used if g not in glass]
    assert not missing, f'no table for {missing}'
    js = ['/* ---------- SCHOTT filter glass (build 146) ----------',
          '   GENERATED by tools/schott/convert.py from tools/schott/data/tables.txt: do not edit by hand.',
          "   SCHOTT's own published internal transmittance tables (tau_i, 280-1100nm, 10nm steps) and reflection factors",
          '   (Pd), from each glass\'s page at schott.com, retrieved 2026-10-17. A filter passes tau_i x Pd; at a thickness',
          '   other than the reference, tau_i^(d/d_ref) x Pd. Every SCHOTT-glass entry in REAL_CURVES is written here, so',
          '   the conversion lives in exactly one place. See tools/schott/check.txt for the cross-check against',
          "   CheeseCube312's independent copy of the same tables. */",
          'const SCHOTT_GLASS={']
    for g in used:
        r = glass[g]
        ti = ','.join(('%.3f' % v).lstrip('0') if v else '0' for _, v in r['rows'])
        js.append(f"  '{g}':{{pd:{r['pd']},nd:{r['nd']},d:{r['d']:g},ti:[{ti}]}},")
    js.append('};')
    js.append("// largest difference (percentage points of tau_i) from CheeseCube312's copy of the same table; null = no copy")
    js.append('const SCHOTT_CC={' + ','.join(f"'{g}':{cc[g] if g in cc else 'null'}" for g in used) + '};')
    js.append('// database id -> [glass, thickness in mm (null = SCHOTT\'s reference thickness)]')
    js.append('const SCHOTT_IDS={' + ','.join(f"{i}:['{g}',{'null' if t is None else t}]" for i, (g, t) in IDS.items()) + '};')
    js.append('function schottCurve(glass,mm){')
    js.append('  const g=SCHOTT_GLASS[glass],k=mm==null?1:mm/g.d,out=[];')
    js.append('  g.ti.forEach((t,i)=>{out.push(280+10*i,+(Math.pow(t,k)*g.pd).toFixed(4));});')
    js.append('  return out;')
    js.append('}')
    js.append('Object.keys(SCHOTT_IDS).forEach(id=>{const[g,mm]=SCHOTT_IDS[id];REAL_CURVES[id]=schottCurve(g,mm);});')
    open(os.path.join(REPO, 'src-filters', 'schott.js'), 'w', encoding='utf-8').write('\n'.join(js) + '\n')
    print(f'src-filters/schott.js: {len(used)} glasses, {len(IDS)} filters')


main()
