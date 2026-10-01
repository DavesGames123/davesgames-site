#!/usr/bin/env python3
# ============================================================================
#  PROTEIN VIEWER  ·  vendor.py — download and trim the preset structures
# ----------------------------------------------------------------------------
#  The presets load from data/*.gz, so the page works offline and does not
#  depend on RCSB. PDB entries and AlphaFold DB models are CC0 / CC-BY 4.0.
#  This script downloads each file once and trims it:
#    - the first MODEL only (NMR ensembles keep model 1)
#    - the first alternate location only, with the altLoc column cleared
#    - no ANISOU, SIGATM, SEQRES or long REMARK blocks
#    - waters only in files with 3000 atoms or fewer
#    - CA_ONLY entries keep CA (and P) atoms of the polymer, plus ligands
#  mmCIF entries are kept whole (they test the mmCIF parser) and gzipped.
#
#    python3 vendor.py [raw_dir]     raw_dir caches the downloads
#
#  grep: PDB_IDS  CIF_IDS  AF_IDS  CA_ONLY  def trim_pdb
# ============================================================================
import gzip, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'data')
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '.raw')

PDB_IDS = ['1U19', '3PQR', '1BL8', '1EMA', '1CRN', '1UBQ', '2LZM', '1L2Y', '1VII',
           '1PGA', '1TIM', '1CAG', '1MBN', '1MBO', '4HHB', '1HHO', '1HSG', '1ATP',
           '2PTC', '1AKE', '4AKE', '1BRS', '1IEP', '4INS', '1STP', '1BNA', '1KX5',
           '1TUP', '6VXX', '1AON']
CIF_IDS = ['6LU7', '1EHZ']
AF_IDS = ['P04637', 'P37840', 'P00533']
CA_ONLY = {'1AON'}
KEEP_HEAD = ('HEADER', 'TITLE ', 'COMPND', 'EXPDTA', 'HELIX ', 'SHEET ', 'CONECT')


def fetch(url, path):
    if not os.path.exists(path):
        print('  get', url)
        with urllib.request.urlopen(url) as r, open(path, 'wb') as f:
            f.write(r.read())
    return open(path, encoding='latin-1').read()


def trim_pdb(text, ca_only=False):
    lines = text.splitlines()
    natoms = sum(1 for l in lines if l.startswith(('ATOM', 'HETATM')))
    keep_water = natoms <= 3000
    out, model, seen_alt = [], 0, {}
    for l in lines:
        rec = l[:6]
        if rec == 'MODEL ':
            model += 1
            continue
        if rec == 'ENDMDL':
            if model >= 1:
                break
            continue
        if rec.startswith('REMARK') and l[7:10].strip() == '2' and 'RESOLUTION' in l:
            out.append(l)
            continue
        if rec in ('ATOM  ', 'HETATM'):
            res = l[17:20].strip()
            if res in ('HOH', 'WAT', 'DOD') and not keep_water:
                continue
            alt = l[16] if len(l) > 16 else ' '
            key = (l[21], l[22:27], l[12:16])
            if alt != ' ':
                rkey = (l[21], l[22:27])
                first = seen_alt.setdefault(rkey, alt)
                if alt != first:
                    continue
                l = l[:16] + ' ' + l[17:]
            if ca_only and rec == 'ATOM  ' and l[12:16].strip() not in ('CA', 'P'):
                continue
            out.append(l.rstrip())
            continue
        if rec == 'TER   ':
            out.append('TER')
            continue
        if rec.startswith(KEEP_HEAD) or rec in KEEP_HEAD:
            if rec == 'CONECT' and ca_only:
                continue
            out.append(l.rstrip())
    out.append('END')
    return '\n'.join(out) + '\n'


def write_gz(name, text):
    path = os.path.join(OUT, name + '.gz')
    with gzip.open(path, 'wb', compresslevel=9) as f:
        f.write(text.encode('latin-1'))
    return os.path.getsize(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(RAW, exist_ok=True)
    total = 0
    for pid in PDB_IDS:
        t = fetch(f'https://files.rcsb.org/download/{pid}.pdb', os.path.join(RAW, pid + '.pdb'))
        n = write_gz(pid + '.pdb', trim_pdb(t, pid in CA_ONLY))
        total += n
        print(f'{pid}.pdb.gz {n:>9,}')
    for pid in CIF_IDS:
        t = fetch(f'https://files.rcsb.org/download/{pid}.cif', os.path.join(RAW, pid + '.cif'))
        n = write_gz(pid + '.cif', t)
        total += n
        print(f'{pid}.cif.gz {n:>9,}')
    for uid in AF_IDS:
        path = os.path.join(RAW, f'AF-{uid}.pdb')
        t = None
        for v in (6, 5, 4):
            try:
                t = fetch(f'https://alphafold.ebi.ac.uk/files/AF-{uid}-F1-model_v{v}.pdb', path)
                break
            except Exception:
                continue
        n = write_gz(f'AF-{uid}.pdb', trim_pdb(t))
        total += n
        print(f'AF-{uid}.pdb.gz {n:>9,}')
    print(f'total {total:,} bytes')


if __name__ == '__main__':
    main()
