#!/usr/bin/env python3
# ============================================================================
#  PERIODIC TABLE  ·  build/build-data.py  ·  writes data/elements.js
# ----------------------------------------------------------------------------
#  This script merges two open data sets into one ES module, data/elements.js.
#  The page and the node tests read only that module. The prose (description,
#  uses, name origin) is our own text, in data/text.js, and this script does
#  not touch it.
#
#  SOURCES  (see ../CREDITS.md)
#    komed3/periodic-table, commit aa8502320726c7210c7069a3fc1673c61e6988ad,
#      MIT licence, (c) 2023-2026 Paul Köhler.  _db/elements.json gives the
#      numbers; _db/nuclides.json gives the isotopes.
#    PubChem periodic table (NCBI), public domain:
#      https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON
#      gives the CPK colour, the electron affinity, and fall-back values.
#
#  RUN
#    git clone https://github.com/komed3/periodic-table <dir>
#    git -C <dir> checkout aa8502320726c7210c7069a3fc1673c61e6988ad
#    curl -o pt.json https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON
#    python3 -I build-data.py <dir> pt.json ../data/elements.js
#
#  CORRECTIONS  (grep -n "FIX_" build-data.py)
#    The upstream data has a small number of errors. FIX_CFG, FIX_DISC and
#    FIX_TEXT change them here, with a reason on each line, so that the
#    upstream files stay as they are.
#
#  GREP MAP
#    grep -n "def density"      density in g/cm3 from the upstream variants
#    grep -n "def oxidation"    oxidation states from the upstream strings
#    grep -n "def isotopes"     natural and key isotopes from nuclides.json
#    grep -n "def record"       one output record
# ============================================================================
import json, re, sys

KOMED, PUBCHEM, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
EL = json.load(open(KOMED + '/_db/elements.json', encoding='utf-8'))
NUC = json.load(open(KOMED + '/_db/nuclides.json', encoding='utf-8'))
PC = json.load(open(PUBCHEM, encoding='utf-8'))['Table']
PCOL = PC['Columns']['Column']
PROW = {int(r['Cell'][0]): dict(zip(PCOL, r['Cell'])) for r in PC['Row']}

# Configuration fixes: upstream text -> correct text.
FIX_CFG = {
    2: '1s[2]',   # upstream has 1s[1] for helium; helium has two electrons
}
# Discovery fixes: (year, by). Upstream names some discoverers in German,
# and gives the isolation year where the first identification is earlier.
FIX_DISC = {
    2: (1868, 'Janssen, Lockyer'),         # seen in the solar spectrum in 1868
    84: (1898, 'Marie Curie, Pierre Curie'),
    88: (1898, 'Marie Curie, Pierre Curie'),
    74: (1783, 'Juan José and Fausto Elhuyar'),
    78: (1748, 'Antonio de Ulloa'),        # first scientific description
    30: (1746, 'Marggraf'),                # upstream has no discoverer
    33: (1250, 'Albertus Magnus'),
    83: (1753, 'Geoffroy'),                # shown to be an element
    90: (1829, 'Berzelius'),
    9: (1886, 'Moissan'),
}
# Plain text fixes of upstream strings that use a German word.
FIX_TEXT = [(' und ', ' and ')]

# The famous radioisotopes. A record lists them when nuclides.json has them,
# beside the natural isotopes and the longest-lived ones.
KEY_RADIO = {1: [3], 6: [14], 9: [18], 15: [32], 19: [40], 27: [60], 38: [90],
             43: [99], 53: [131], 55: [137], 84: [210], 86: [222], 88: [226],
             92: [235], 94: [239], 95: [241], 98: [252]}

CATS = {'alkalimetal': 'alkali', 'alkalineearthmetal': 'alkaline-earth',
        'transitionmetal': 'transition', 'metal': 'post-transition',
        'metalloid': 'metalloid', 'nonmetal': 'nonmetal', 'halogen': 'halogen',
        'noblegas': 'noble-gas', 'lanthanoide': 'lanthanide',
        'actinoide': 'actinide', 'unknown': 'unknown'}

def fix(s):
    for a, b in FIX_TEXT:
        s = s.replace(a, b)
    return s

def val(o):
    if o is None:
        return None
    if isinstance(o, dict):
        return o.get('value')
    return o

def pred(o):
    return isinstance(o, dict) and bool(o.get('*'))

def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None

def density(e):
    """Density in g/cm3 and a predicted flag. Upstream gives a value, or a
    list of allotropes and phases; take the first entry. The units
    'g.cm-1' in upstream allotrope rows are typos for g/cm3."""
    d = e.get('density')
    if d is None:
        return None, False
    if isinstance(d, list):
        d = next((x for x in d if x.get('label') != 'amorphous'), d[0])
    v, u = d.get('value'), d.get('unit', '')
    if v is None:
        return None, False
    if u.startswith('kg·m'):
        v = v / 1000.0
    return round(v, 6), bool(d.get('*'))

def temps(e):
    t = e.get('temperature') or {}
    mp, bp, sub = val(t.get('melting')), val(t.get('boiling')), False
    if mp is None and bp is None and t.get('sublimation'):
        mp = bp = val(t['sublimation'])
        sub = True
    p = pred(t.get('melting')) or pred(t.get('boiling'))
    if e['number'] == 2:
        mp = None  # helium does not freeze at 1 atm (upstream 0.95 K is at 2.5 MPa)
    return mp, bp, sub, p

def oxidation(e):
    """All oxidation states and the common ones (marked '''x''' upstream).
    Upstream strings: '2, '''3''', 4', '-4 ... 4', '+-2 ... +6', '+2 +3'."""
    s = e.get('oxidation_state')
    if not s:
        return [], []
    s = s.replace('…', ' .. ')
    out, common = set(), set()
    # ranges first, then the single values
    s2 = s
    for m in re.finditer(r"(['±+\-]*\d+)'*\s*\.\.\s*'*([+\-]?\d+)", s):
        a, b = m.group(1).replace("'", ''), int(m.group(2))
        lo = -int(a[1:]) if a.startswith('±') else int(a)
        for k in range(lo, b + 1):
            out.add(k)
        s2 = s2.replace(m.group(0), ' ')
    for m in re.finditer(r"('''|)([±+\-]?)(\d+)('''|)", s2):
        mark, sign, n = m.group(1), m.group(2), int(m.group(3))
        ks = [n, -n] if sign == '±' else [-n if sign == '-' else n]
        for k in ks:
            out.add(k)
            if mark:
                common.add(k)
    return sorted(out), sorted(common)

def pc_ox(z):
    s = PROW[z].get('OxidationStates', '')
    out = []
    for t in re.split(r'[,\s]+', s):
        t = t.strip()
        if re.fullmatch(r'[+\-]?\d+', t):
            out.append(int(t))
    return sorted(set(out))

def isotopes(z, sym):
    L = NUC[sym.lower()]['nuclides']
    rows = {}
    def add(x):
        hl = None if x.get('stable') else val(x.get('half_life_sec'))
        ab = val(x.get('abundance'))
        rows[x['m']] = [x['m'], ab, None if x.get('stable') else (hl if hl is not None else -1)]
    for x in L:
        if x.get('abundance') or x.get('stable'):
            add(x)
    timed = sorted([x for x in L if not x.get('stable') and x.get('half_life_sec')
                    and (x.get('half_life') or {}).get('unit') not in ('MeV', 'keV', 'eV')],
                   key=lambda x: -x['half_life_sec']['value'])
    if not any(r[1] for r in rows.values()):
        for x in timed[:3]:
            add(x)
    for a in KEY_RADIO.get(z, []):
        for x in L:
            if x['m'] == a:
                add(x)
    return sorted(rows.values(), key=lambda r: r[0])

def cfg_text(s):
    """'Ar 3d[6] 4s[2]' -> '[Ar] 3d6 4s2'."""
    parts = s.split()
    out = []
    for p in parts:
        m = re.fullmatch(r'(\d)([spdf])\[(\d+)\]', p)
        if m:
            out.append(m.group(1) + m.group(2) + m.group(3))
        else:
            out.append('[' + p + ']')
    return ' '.join(out)

def col32(z):
    """The column in the 32-column table. Computed from Z, because the
    upstream 'column' puts Sc and Y in the f-block columns. La-Yb and
    Ac-No are the f-block; Lu and Lr open the d-block (group 3)."""
    if z == 1:
        return 1
    if z == 2:
        return 32
    for start in (87, 55, 37, 19, 11, 3):
        if z >= start:
            i = z - start
            break
    if i < 2:
        return 1 + i
    if start in (3, 11):
        return 27 + (i - 2)
    if start in (19, 37):
        return 17 + (i - 2) if i < 12 else 27 + (i - 12)
    return 3 + (i - 2) if i < 16 else 17 + (i - 16) if i < 26 else 27 + (i - 26)

def block(col):
    return 's' if col <= 2 else 'f' if col <= 16 else 'd' if col <= 26 else 'p'

def group(z, col):
    if z == 2:
        return 18
    if col <= 2:
        return col
    if col <= 16:
        return None
    if col <= 26:
        return col - 14
    return col - 14

def abund(e):
    a = e.get('abundance') or {}
    g = lambda k: val(a.get(k))
    return {'crust': g('crust'), 'ocean': g('water'), 'universe': g('universe'), 'sun': g('sun'), 'human': g('human')}

def record(e):
    z, sym = e['number'], e['symbol']
    p = PROW[z]
    col = col32(z)
    cfg = FIX_CFG.get(z, e['electron_config'])
    mp, bp, sub, tp = temps(e)
    dens, dp = density(e)
    ox, common = oxidation(e)
    if not ox:
        ox = pc_ox(z)
    # common states: the upstream marks, joined with the PubChem list
    common = sorted(set(common) | (set(pc_ox(z)) & set(ox or pc_ox(z))))
    r = e.get('radius') or {}
    neg = e.get('negativity') or {}
    std = e.get('standard_atomic_weight')
    iso = isotopes(z, sym)
    if std:
        mass, mass_num = val(std), None
    else:
        mass = val(e['atomic_mass'])
        lived = [i for i in iso if i[2] not in (None,)]
        lived.sort(key=lambda i: -(i[2] or 0))
        mass_num = lived[0][0] if lived else round(mass)
    disc = e.get('discovery') or {}
    year, by = disc.get('value'), fix(disc.get('by') or '')
    if z in FIX_DISC:
        year, by = FIX_DISC[z]
    if e['era'] == 'antiquity' and z not in FIX_DISC:
        year, by = None, ''
    en = neg.get('pauling')
    if en is None:
        en = num(p.get('Electronegativity'))
    phase = e.get('phase')
    if not phase:
        st = (p.get('StandardState') or '').lower()
        phase = 'gas' if 'gas' in st else 'liquid' if 'liquid' in st else 'solid' if 'solid' in st else None
    ie = [round(v, 4) for v in (e.get('ionization') or {}).get('values', []) if v is not None]
    cpk = (p.get('CPKHexColor') or '').strip()
    return {
        'z': z, 'sym': sym, 'name': e['names']['en'],
        'mass': mass, 'massNum': mass_num,
        'period': e['period'], 'group': group(z, col), 'col32': col, 'block': block(col),
        'cat': CATS[e['set']],
        'cfg': cfg_text(cfg), 'shells': e['shell'],
        'en': en, 'ea': num(p.get('ElectronAffinity')),
        'r': {'emp': val(r.get('empirical')), 'cov': val(r.get('covalent')),
              'vdw': val(r.get('vdw')), 'calc': val(r.get('calculated'))},
        'ie': ie,
        'ox': ox, 'oxCommon': common,
        'mp': mp, 'bp': bp, 'sublimes': sub, 'tPred': tp,
        'density': dens, 'densPred': dp,
        'phase': phase, 'xtal': e.get('crystal_structure'),
        'disc': {'year': year, 'by': by, 'era': e['era']},
        'ab': abund(e),
        'cpk': ('#' + cpk.lower()) if cpk else None,
        'iso': iso,
        'look': fix((e.get('appearance') or {}).get('en') or ''),
    }

recs = [record(e) for e in sorted(EL.values(), key=lambda e: e['number'])]
assert len(recs) == 118 and [r['z'] for r in recs] == list(range(1, 119))

head = '''// ============================================================================
//  PERIODIC TABLE  ·  data/elements.js  (generated: do not edit by hand)
// ----------------------------------------------------------------------------
//  Written by build/build-data.py from komed3/periodic-table (MIT, commit
//  aa85023, (c) 2023-2026 Paul Köhler) and the PubChem periodic table (NCBI,
//  public domain). See ../CREDITS.md. Units: mass u, radii pm, ie and ea eV,
//  mp and bp K, density g/cm3, abundance ppb by mass, half-life s
//  (iso rows are [mass number, natural abundance %, half-life s | null when
//  stable | -1 when not measured]).
// ============================================================================
'''
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(head)
    f.write('export const ELEMENTS = [\n')
    for r in recs:
        f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + ',\n')
    f.write('];\n')
print('wrote', OUT, len(recs), 'records')
