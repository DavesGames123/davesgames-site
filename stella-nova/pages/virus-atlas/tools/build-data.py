#!/usr/bin/env python3
# ============================================================================
#  VIRUS ATLAS  ·  tools/build-data.py — PDB mmCIF files to compact bead data
# ----------------------------------------------------------------------------
#  Run it from the repo root:
#      python3 -I stella-nova/pages/virus-atlas/tools/build-data.py RAW_DIR
#  RAW_DIR holds <ID>.cif.gz files from https://files.rcsb.org/download/.
#  Missing files are downloaded into RAW_DIR. The raw files are not
#  committed: only the output in stella-nova/pages/virus-atlas/data/.
#
#  WHAT IT KEEPS. One bead per residue: the CA atom of an amino acid, the
#  P atom of a nucleotide, the C1 atom of a sugar (glycans). Model 1 only,
#  the first alternate location only. Coordinates go to int16 at a step
#  of 0.1 A (0.2 A when the unit is larger than 320 A).
#
#  SYMMETRY. The script reads the first biological assembly
#  (_pdbx_struct_assembly_gen, _pdbx_struct_oper_list). The output keeps
#  the asymmetric unit (AU) and the operators, not the expanded copies:
#  the page expands them on the GPU. Kinds:
#    icosa    60 operators; one 5-fold axis goes to +y
#    cyclic   a few operators (Cn); the n-fold axis goes to +y
#    helix    a rod or a fibril: one layer and a screw (twist, rise).
#             TMV gets the screw from its deposited helical operators.
#             A fibril gets it from the rigid fit of one chain onto the
#             next chain up its column. The page makes n layers.
#    single   one copy; the main axis goes to +y
#  The frame is centred on the particle (the mean of all copies), so each
#  operator turns about the origin.
#
#  FILE FORMAT  data/<id>.bin  (little endian)
#    'VAT1'  uint32 json byte length  json (padded with spaces to 4 bytes)
#    int16[3n]   bead x y z in units of json.q angstrom
#    uint16[n]   chain index into json.chains
#    uint8[n]    flags: bits 0-1 secondary structure (0 coil, 1 helix,
#                2 strand), bits 2-4 residue class (see CLASS)
#  JSON: id, title, method, res, year, authors, doi, q, n, sym, ops,
#        helix, chains [[asym, auth, entity index, count]], entities
#        [{desc, type, role}], anchor, ssSource.
#
#  grep -n targets: "def read_cif", "def assembly", "def kabsch",
#                   "def screw_of", "CONFIG =", "def build"
# ============================================================================
import gzip, json, math, os, re, struct, sys, urllib.request
import numpy as np
np.seterr(all="ignore")   # Accelerate matmul on macOS raises false FP flags

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data')

# kind, plus options:
#   anchor 'C' or 'N': which chain end sits on the membrane (spikes)
#   ae: the entity index whose chain ends mark the membrane (default 0)
#   layers: fibril layers the page makes by default (json.helix.n)
CONFIG = {
    # capsids and particles
    '1HXS': dict(kind='icosa'),            # poliovirus type 1 Mahoney
    '4RHV': dict(kind='icosa'),            # human rhinovirus 14
    '1QGT': dict(kind='icosa'),            # hepatitis B core, T=4
    '1IHM': dict(kind='icosa'),            # Norwalk virus, T=3
    '3J6R': dict(kind='icosa'),            # HPV16 L1, T=7d
    '6CGV': dict(kind='icosa'),            # human adenovirus 5 (pseudo T=25)
    '5IRE': dict(kind='icosa'),            # Zika virus, mature
    '1OHG': dict(kind='icosa'),            # HK97 phage head, T=7
    '4UDV': dict(kind='helix', n=2130),    # TMV: 2130 subunits = 300 nm rod
    '3J3Q': dict(kind='single'),           # HIV-1 capsid cone, all chains
    # single proteins
    '6VSB': dict(kind='single', anchor='C'),
    '6M0J': dict(kind='single'),
    '1RUZ': dict(kind='single', anchor='C', ae=1),
    '2HTY': dict(kind='single', anchor='N'),
    '4TVP': dict(kind='cyclic', anchor='C', ae=1),
    '3H47': dict(kind='cyclic'),
    '5JQ3': dict(kind='cyclic', anchor='C', ae=1),
    '7U9G': dict(kind='single', anchor='C'),
    '2ZB6': dict(kind='cyclic'),
    # prion protein and amyloid fibrils
    '1QLX': dict(kind='single'),
    '7LNA': dict(kind='fibril', n=60),
    '7QIG': dict(kind='fibril', n=60),
    '6LNI': dict(kind='fibril', n=60),
    '5O3L': dict(kind='fibril', n=60),
    '6A6B': dict(kind='fibril', n=60),
}

AA = set('ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL MSE SEC PYL'.split())
NUC = set('DA DC DG DT DU A C G U I DI'.split())
SUGAR = set('NAG NDG MAN BMA FUC FUL GAL GLA GLC BGC SIA A2G XYS NGA'.split())
CLASS = {}
for r in 'ALA VAL LEU ILE MET PHE TRP MSE'.split(): CLASS[r] = 0     # hydrophobic
for r in 'SER THR ASN GLN TYR HIS'.split(): CLASS[r] = 1             # polar
for r in 'LYS ARG PYL'.split(): CLASS[r] = 2                         # positive
for r in 'ASP GLU'.split(): CLASS[r] = 3                             # negative
for r in 'GLY PRO CYS SEC'.split(): CLASS[r] = 4                     # special
for r in NUC: CLASS[r] = 5
for r in SUGAR: CLASS[r] = 6

WANT = {'atom_site', 'struct_conf', 'struct_sheet_range', 'pdbx_struct_oper_list',
        'pdbx_struct_assembly_gen', 'entity', 'struct_asym', 'struct', 'refine',
        'em_3d_reconstruction', 'pdbx_database_status'}
TOK = re.compile(r"'(.*?)'(?=\s|$)|\"(.*?)\"(?=\s|$)|(\S+)")


def toks(line):
    out = []
    for m in TOK.finditer(line):
        out.append(m.group(1) if m.group(1) is not None else m.group(2) if m.group(2) is not None else m.group(3))
    return out


def read_cif(path):
    """A small line-based STAR reader: the categories in WANT, as row lists.
    _atom_site rows keep only CA, P and C1 atoms of model 1."""
    with gzip.open(path, 'rt', encoding='utf-8', errors='replace') as f:
        lines = f.read().split('\n')
    cats = {}
    i, n = 0, len(lines)

    def text_block(i):
        buf = [lines[i][1:]]
        i += 1
        while i < n and not lines[i].startswith(';'):
            buf.append(lines[i]); i += 1
        return '\n'.join(buf).strip(), i + 1

    while i < n:
        ln = lines[i]
        if not ln or ln[0] == '#' or ln.startswith('data_'):
            i += 1; continue
        if ln.startswith('loop_'):
            i += 1
            tags = []
            while i < n and lines[i].startswith('_'):
                tags.append(lines[i].split()[0]); i += 1
            cat = tags[0][1:].split('.')[0]
            names = [t.split('.', 1)[1] for t in tags]
            keep = cat in WANT
            rows = []
            if cat == 'atom_site':
                ix = {k: j for j, k in enumerate(names)}
                ia, im = ix['label_atom_id'], ix.get('pdbx_PDB_model_num')
                first_model = None
                while i < n and lines[i] and not lines[i].startswith(('#', '_', 'loop_', 'data_')):
                    v = lines[i].split()
                    i += 1
                    if len(v) != len(names):
                        continue
                    a = v[ia].strip('"\'')
                    if a not in ('CA', 'P', 'C1'):
                        continue
                    if im is not None:
                        if first_model is None: first_model = v[im]
                        if v[im] != first_model: continue
                    rows.append(dict(zip(names, v)))
                cats[cat] = rows
                continue
            vals = []
            while i < n:
                l2 = lines[i]
                if l2.startswith(';'):
                    t, i = text_block(i); vals.append(t); continue
                if not l2.strip():
                    i += 1; continue
                if l2.startswith(('#', '_', 'loop_', 'data_')):
                    break
                if keep: vals.extend(toks(l2))
                i += 1
            if keep:
                k = len(names)
                cats[cat] = [dict(zip(names, vals[j:j + k])) for j in range(0, len(vals) - k + 1, k)]
            continue
        if ln.startswith('_'):
            parts = ln.split(None, 1)
            tag = parts[0]
            cat, name = tag[1:].split('.', 1)
            i += 1
            if len(parts) > 1 and parts[1].strip():
                t = toks(parts[1]); val = t[0] if t else ''
            elif i < n and lines[i].startswith(';'):
                val, i = text_block(i)
            else:
                t = toks(lines[i]) if i < n else ['']; val = t[0] if t else ''; i += 1
            if cat in WANT:
                cats.setdefault(cat, [{}])[0][name] = val
            continue
        i += 1
    return cats


def parse_expr(e):
    """'(1-60)', '1,2,3', '(X0)(1-60)', 'P' -> list of factor lists."""
    e = e.strip()
    groups = re.findall(r'\(([^)]*)\)', e) if '(' in e else [e]
    out = []
    for g in groups:
        ids = []
        for part in g.split(','):
            part = part.strip()
            m = re.fullmatch(r'(\d+)-(\d+)', part)
            if m: ids += [str(k) for k in range(int(m.group(1)), int(m.group(2)) + 1)]
            elif part: ids.append(part)
        out.append(ids)
    return out


def op_matrix(row):
    M = np.eye(4)
    for r in range(3):
        for c in range(3):
            M[r, c] = float(row['matrix[%d][%d]' % (r + 1, c + 1)])
        M[r, 3] = float(row['vector[%d]' % (r + 1)])
    return M


def assembly(cats):
    """The first assembly: (asym ids, 4x4 operators)."""
    gens = cats.get('pdbx_struct_assembly_gen', [])
    aid = gens[0]['assembly_id']
    opl = {r['id']: op_matrix(r) for r in cats.get('pdbx_struct_oper_list', [])}
    asyms, ops = [], []
    for g in gens:
        if g['assembly_id'] != aid: continue
        for a in g['asym_id_list'].split(','):
            if a not in asyms: asyms.append(a)
        fac = parse_expr(g['oper_expression'])
        mats = [np.eye(4)]
        for ids in fac:          # (A)(B): A applied after B
            mats = [m @ opl[k] for m in mats for k in ids]
        for m in mats:
            if not any(np.allclose(m, o, atol=1e-4) for o in ops): ops.append(m)
    return asyms, ops


def kabsch(P, Q):
    """R, t with R P + t ~ Q (rows are points)."""
    pc, qc = P.mean(0), Q.mean(0)
    H = (P - pc).T @ (Q - qc)
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1, 1, d])
    R = Vt.T @ D @ U.T
    t = qc - R @ pc
    rms = math.sqrt(((P @ R.T + t - Q) ** 2).sum(1).mean())
    return R, t, rms


def rot_axis(R):
    w, v = np.linalg.eig(R)
    k = np.argmin(abs(w - 1))
    a = np.real(v[:, k]); a /= np.linalg.norm(a)
    ang = math.acos(max(-1, min(1, (np.trace(R) - 1) / 2)))
    return a, ang


def align_to_y(u):
    """A rotation G with G u = +y."""
    u = u / np.linalg.norm(u)
    y = np.array([0., 1., 0.])
    v = np.cross(u, y); s = np.linalg.norm(v); c = float(u @ y)
    if s < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1., -1., -1.])
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]) / s
    a = math.atan2(s, c)
    return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K


def ca_ss(X):
    """A coarse secondary structure from CA geometry, for chains with no
    records: helix when d(i, i+3) ~ 5 A, strand when d(i-1, i+1) > 6.4 A
    on three residues in a row."""
    n = len(X); ss = np.zeros(n, np.uint8)
    if n < 5: return ss
    d3 = np.linalg.norm(X[3:] - X[:-3], axis=1)
    d2 = np.linalg.norm(X[2:] - X[:-2], axis=1)
    for i in range(n - 3):
        if 4.2 < d3[i] < 5.9:
            ss[i:i + 4] = 1
    st = np.zeros(n, bool)
    st[1:-1] = d2 > 6.4
    for i in range(1, n - 1):
        if st[i - 1] and st[i] and (i + 1 < n and st[i + 1]) and ss[i] == 0:
            ss[i - 1:i + 2] = np.where(ss[i - 1:i + 2] == 0, 2, ss[i - 1:i + 2])
    return ss


def role_of(desc, etype):
    d = (desc or '').lower()
    if etype == 'branched' or etype == 'non-polymer': return 'glycan'
    if re.search(r'\bfab\b|heavy chain|light chain|antibody|nanobody|igg|\bscfv\b|vrc|pgt|35o22', d): return 'antibody'
    if re.search(r'angiotensin|ace2|receptor', d): return 'receptor'
    if re.search(r'rna|dna', d) and etype == 'polymer' and 'protein' not in d: return 'nucleic'
    return 'main'


def screw_of(chains, X, ent):
    """The screw that maps one chain onto the next chain of its column.
    chains: list of (asym, idx array, seq ids). Returns R, t, rms, pairs."""
    best = None
    by = {}
    for c in chains: by.setdefault(ent[c[0]], []).append(c)
    for e, cs in by.items():
        for a in cs:
            for b in cs:
                if a is b: continue
                common = sorted(set(a[2]) & set(b[2]))
                if len(common) < 8: continue
                ia = [a[1][a[2].index(s)] for s in common]
                ib = [b[1][b[2].index(s)] for s in common]
                d = np.linalg.norm(X[ia].mean(0) - X[ib].mean(0))
                if best is None or d < best[0]:
                    best = (d, a, b, ia, ib)
    d, a, b, ia, ib = best
    R, t, rms = kabsch(X[ia], X[ib])
    return R, t, rms


def build(pid, raw_dir):
    cfg = CONFIG[pid]
    path = os.path.join(raw_dir, pid + '.cif.gz')
    if not os.path.exists(path):
        print('download', pid)
        urllib.request.urlretrieve('https://files.rcsb.org/download/%s.cif.gz' % pid, path)
    cats = read_cif(path)
    asyms, ops = assembly(cats)
    ents = {r['id']: r for r in cats.get('entity', [])}
    asym_ent = {r['id']: r['entity_id'] for r in cats.get('struct_asym', [])}

    # beads, in asym order of the assembly list
    seen = set(); per = {a: [] for a in asyms}; auth = {}
    for r in cats['atom_site']:
        a = r['label_asym_id']
        if a not in per: continue
        comp = r['label_comp_id']; atom = r['label_atom_id'].strip('"\'')
        if comp in AA and atom != 'CA': continue
        if comp in NUC and atom != 'P': continue
        if comp in SUGAR and atom != 'C1': continue
        if comp not in AA and comp not in NUC and comp not in SUGAR: continue
        key = (a, r['label_seq_id'], r.get('auth_seq_id'), comp, atom)
        if key in seen: continue
        seen.add(key)
        auth[a] = r['auth_asym_id']
        sid = r['label_seq_id']
        sid = int(sid) if sid not in ('.', '?') else int(r.get('auth_seq_id', 0) or 0)
        per[a].append((sid, comp, float(r['Cartn_x']), float(r['Cartn_y']), float(r['Cartn_z'])))
    asyms = [a for a in asyms if per[a]]

    # secondary structure records, by label asym and seq
    ssmap = {}
    for r in cats.get('struct_conf', []):
        if not r.get('conf_type_id', '').startswith('HELX'): continue
        try:
            for s in range(int(r['beg_label_seq_id']), int(r['end_label_seq_id']) + 1): ssmap[(r['beg_label_asym_id'], s)] = 1
        except ValueError: pass
    for r in cats.get('struct_sheet_range', []):
        try:
            for s in range(int(r['beg_label_seq_id']), int(r['end_label_seq_id']) + 1): ssmap[(r['beg_label_asym_id'], s)] = 2
        except ValueError: pass

    # entities in use
    ent_ids = []
    for a in asyms:
        e = asym_ent.get(a, '?')
        if e not in ent_ids: ent_ids.append(e)
    entities = []
    for e in ent_ids:
        er = ents.get(e, {})
        entities.append(dict(desc=er.get('pdbx_description', '?').strip(), type=er.get('type', '?'),
                             role=role_of(er.get('pdbx_description'), er.get('type'))))
    eidx = {e: k for k, e in enumerate(ent_ids)}
    for e in ent_ids:   # a polymer of nucleotides only
        cs = [a for a in asyms if asym_ent.get(a) == e]
        if cs and all(r[1] in NUC for a in cs for r in per[a]): entities[eidx[e]]['role'] = 'nucleic'

    X, chain_ix, flags, chains, seqs = [], [], [], [], []
    ss_src = 'records' if ssmap else 'ca-geometry'
    for ci, a in enumerate(asyms):
        rows = per[a]
        start = len(X)
        P = np.array([[r[2], r[3], r[4]] for r in rows])
        geo = ca_ss(P) if not ssmap and rows[0][1] in AA else None
        for k, r in enumerate(rows):
            X.append(r[2:])
            chain_ix.append(ci)
            ss = ssmap.get((a, r[0]), 0) if ssmap else (int(geo[k]) if geo is not None else 0)
            flags.append(ss | (CLASS.get(r[1], 7) << 2))
        chains.append([a, auth.get(a, a), eidx[asym_ent.get(a, '?')], len(rows)])
        seqs.append((a, list(range(start, len(X))), [r[0] for r in rows]))
    X = np.array(X, float); chain_ix = np.array(chain_ix); flags = np.array(flags, np.uint8)

    kind = cfg['kind']
    helix = None
    sym = dict(type='none')
    if kind in ('helix', 'fibril'):
        if kind == 'helix':
            # TMV: subunit 1 = op 1 on the AU, the screw = op2 op1^-1
            O1, O2 = ops[0], ops[1]
            if np.allclose(O1, np.eye(4)) and len(ops) > 2: O1, O2 = ops[1], ops[2]
            X = X @ O1[:3, :3].T + O1[:3, 3]
            S = O2 @ np.linalg.inv(O1)
            R, t, rms = S[:3, :3], S[:3, 3], 0.0
            layer = list(range(len(asyms)))
        else:
            ent_of = {a: asym_ent.get(a) for a in asyms}
            R, t, rms = screw_of(seqs, X, ent_of)
            # a column head has no chain that maps onto it: test the inverse
            Ri, ti = R.T, -R.T @ t
            heads = []
            for a, idx, sq in seqs:
                img = X[idx] @ Ri.T + ti
                below = False
                for b, idb, sqb in seqs:
                    if b == a or ent_of[b] != ent_of[a]: continue
                    common = sorted(set(sq) & set(sqb))
                    if len(common) < 8: continue
                    pa = [sq.index(s) for s in common]
                    pb = [idb[sqb.index(s)] for s in common]
                    if np.sqrt(((img[pa] - X[pb]) ** 2).sum(1).mean()) < 2.5: below = True; break
                if not below: heads.append(a)
            layer = [asyms.index(a) for a in heads]
            keep = np.isin(chain_ix, layer)
            remap = {old: k for k, old in enumerate(layer)}
            X = X[keep]; flags = flags[keep]; chain_ix = np.array([remap[c] for c in chain_ix[keep]])
            chains = [chains[c] for c in layer]
        u, ang = rot_axis(R)
        # the axis line: (I - R) p = t - (t.u) u, least squares
        rise = float(t @ u)
        p = np.linalg.lstsq(np.eye(3) - R, t - rise * u, rcond=None)[0]
        p = p - (p @ u) * u
        # centre: the layer centroid projected on the axis
        m = X.mean(0)
        c = p + ((m - p) @ u) * u
        G = align_to_y(u)
        X = (X - c) @ G.T
        Ry = G @ R @ G.T
        twist = math.atan2(Ry[0, 2], Ry[0, 0])
        n = cfg.get('n', 60)
        helix = dict(twist=round(twist, 7), rise=round(rise, 5), n=n, fit=round(rms, 3))
        sym = dict(type='helix', fibril=kind == 'fibril')
        ops_out = [np.eye(4)]
    else:
        # centre: the mean of all copies
        Rs = [o[:3, :3] for o in ops]; ts = [o[:3, 3] for o in ops]
        m = X.mean(0)
        c = np.mean([R @ m + t for R, t in zip(Rs, ts)], axis=0)
        ops_c = []
        for R, t in zip(Rs, ts):
            ops_c.append((R, R @ c + t - c))
        X = X - c
        G = np.eye(3)
        # snap each deposited rotation to the nearest rotation matrix (polar
        # part by SVD): some files give 5 digits, an error up to 4e-4
        snapped = []
        for R, t in ops_c:
            U_, _, Vt_ = np.linalg.svd(R)
            snapped.append((U_ @ Vt_, t))
        ops_c = snapped
        if kind == 'icosa' or kind == 'cyclic':
            # the highest-order axis to +y
            best = None
            for R, _ in ops_c:
                a, ang = rot_axis(R)
                if ang < 1e-3: continue
                order = round(2 * math.pi / ang)
                if best is None or order > best[0]: best = (order, a)
            G = align_to_y(best[1])
            sym = dict(type='icosa' if kind == 'icosa' else 'cyclic', n=len(ops_c))
        else:
            # one copy: a 3-fold from two chains of the main entity, else
            # the long principal axis
            ax = None
            main = max(range(len(entities)), key=lambda e: sum(c[3] for c in chains if c[2] == e))
            same = [s for s, ch in zip(seqs, chains) if ch[2] == main]
            if len(same) >= 2 and len(same) <= 6:
                # the smallest turn from the first chain to another: C3, C4
                a = same[0]; bestang = None
                for b in same[1:]:
                    common = sorted(set(a[2]) & set(b[2]))
                    if len(common) <= 50: continue
                    ia = [a[1][a[2].index(s)] for s in common]; ib = [b[1][b[2].index(s)] for s in common]
                    R, t, rms = kabsch(X[ia], X[ib])
                    u, ang = rot_axis(R)
                    if ang > 0.5 and (bestang is None or ang < bestang): bestang = ang; ax = u
                if ax is not None: sym = dict(type='cyclic', n=round(2 * math.pi / bestang), pseudo=True)
                    # the axis through the centroid of the oligomer
            if ax is None:
                w, v = np.linalg.eigh(np.cov(X.T))
                ax = v[:, 2]
            G = align_to_y(ax)
            if ax is not None and sym.get('pseudo'):
                # put the oligomer axis through the origin
                sel = np.concatenate([s[1] for s in same])
                cc = X[sel].mean(0)
                X = X - cc
        X = X @ G.T
        ops_out = []
        for R, t in ops_c:
            M = np.eye(4); M[:3, :3] = G @ R @ G.T; M[:3, 3] = G @ t
            ops_out.append(M)

    # anchor: the membrane end of a spike goes to -y
    anchor = None
    if cfg.get('anchor'):
        main = cfg.get('ae', 0)
        ends = []
        start = 0
        for ch in chains:
            if ch[2] == main:
                idx = np.arange(start, start + ch[3])
                if cfg['anchor'] == 'C': ends.append(X[idx[-8:]].mean(0))
                else: ends.append(X[idx[:8]].mean(0))
            start += ch[3]
        e = np.mean(ends, axis=0)
        allX = np.concatenate([X @ o[:3, :3].T + o[:3, 3] for o in ops_out])
        if e[1] > allX[:, 1].mean():
            F = np.diag([1., -1., -1.])
            X = X @ F.T
            ops_out = [np.block([[F @ o[:3, :3] @ F.T, (F @ o[:3, 3])[:, None]], [np.zeros((1, 3)), np.ones((1, 1))]]) for o in ops_out]
            e = F @ e
            allX = allX @ F.T
        # the base: the lowest point of the protein, on the axis
        anchor = dict(end=cfg['anchor'], base=round(float(min(e[1], allX[:, 1].min())), 2),
                      top=round(float(allX[:, 1].max()), 2))

    span = np.abs(X).max()
    q = 0.1 if span < 3200 else 0.2
    Q = np.round(X / q).astype(np.int16)

    # metadata
    st = cats.get('struct', [{}])[0]
    res = None
    for k in ('refine', 'em_3d_reconstruction'):
        r = cats.get(k, [{}])[0]
        v = r.get('ls_d_res_high') or r.get('resolution')
        if v and v not in ('?', '.'):
            res = float(v); break
    meta = json.load(open(os.path.join(raw_dir, pid + '.json'))) if os.path.exists(os.path.join(raw_dir, pid + '.json')) else None
    info = dict(id=pid, title=st.get('title', '').strip(), q=q, n=int(len(Q)), kind=kind, sym=sym,
                ops=[[round(float(v), 6) for v in M[:3, :].reshape(-1)] for M in ops_out],
                helix=helix, chains=chains, entities=entities, anchor=anchor, ssSource=ss_src, res=res)
    if meta:
        c = [x for x in meta.get('citation', []) if x.get('id') == 'primary'] or meta.get('citation', [{}])
        c = c[0]
        info.update(method=meta['exptl'][0]['method'], year=c.get('year'), journal=c.get('rcsb_journal_abbrev') or c.get('journal_abbrev'),
                    authors=c.get('rcsb_authors', [])[:3] + (['et al.'] if len(c.get('rcsb_authors', [])) > 3 else []),
                    doi=c.get('pdbx_database_id_DOI'), paper=c.get('title'),
                    released=meta.get('rcsb_accession_info', {}).get('initial_release_date', '')[:10])
    js = json.dumps(info, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    with open(os.path.join(OUT, pid.lower() + '.bin'), 'wb') as f:
        f.write(b'VAT1'); f.write(struct.pack('<I', len(js))); f.write(js)
        f.write(Q.astype('<i2').tobytes())
        f.write(np.asarray(chain_ix, '<u2').tobytes())
        f.write(np.asarray(flags, np.uint8).tobytes())
    copies = (helix['n'] if helix else len(ops_out))
    print('%s %-6s beads %7d ops %4d chains %4d total %8d  q %.1f  %s%s' % (
        pid, kind, len(Q), len(ops_out), len(chains), len(Q) * copies, q,
        ('twist %.3f deg rise %.3f A fit %.2f' % (math.degrees(helix['twist']), helix['rise'], helix['fit'])) if helix else '',
        ' anchor %s' % anchor if anchor else ''))


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(OUT, exist_ok=True)
    ids = sys.argv[2:] or list(CONFIG)
    for pid in ids:
        jp = os.path.join(raw, pid + '.json')
        if not os.path.exists(jp):
            urllib.request.urlretrieve('https://data.rcsb.org/rest/v1/core/entry/' + pid, jp)
        build(pid, raw)


if __name__ == '__main__':
    main()
