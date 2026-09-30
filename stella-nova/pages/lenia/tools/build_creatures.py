#!/usr/bin/env python3
"""Build creatures.json for the Lenia page from Chan's animals.json.

    python3 tools/build_creatures.py <path/to/Lenia/Python/animals.json> [--keep keep.json]

Source: github.com/Chakazul/Lenia @ adfc542, Python/animals.json (MIT,
Copyright (c) 2018 Bert Chan). Each entry has a code, a Latin name, a
Chinese/Japanese name, the rule parameters and the start cells as RLE.
Entries whose code starts with '>' are rank headers (class, order, family,
subfamily).

Output, one object per creature:
    id      index in creatures.json
    code    Chan's code (not unique in the source)
    name    Latin name;  cname  Chan's Chinese/Japanese name
    rank    [class, order, family, subfamily], from the headers above it
    R T m s b kn gn   rule parameters; b as floats
    w h cells         start cells, row by row, 0..255 bytes in base64
    scale             the start scale that survival_test.js picked (from --keep)
    cls               'live' or 'grow', the class from survival_test.js

--keep takes the output of survival_test.js. Without it, every 2D creature
is written with scale 1, and the result is the input for survival_test.js.

The RLE decoder follows Board.rle2arr and Board.ch2val in LeniaND.py:
'.' or 'b' = 0, 'o' = 255, 'A'..'X' = 1..24, and a two-letter code 'pA'..'yO'
= 25..255. '$' ends a row and a number repeats the next item.
"""
import argparse
import base64
import json
from fractions import Fraction

REPO = 'https://github.com/Chakazul/Lenia'
REV = 'adfc542939266de7f4bb7ebb552e8499701ee107'


def ch2val(c):
    if c in '.b':
        return 0
    if c == 'o':
        return 255
    if len(c) == 1:
        return ord(c) - ord('A') + 1
    return (ord(c[0]) - ord('p')) * 24 + (ord(c[1]) - ord('A') + 25)


def rle2rows(st):
    """2D RLE -> list of rows of 0..255 ints, padded to one width."""
    rows, row = [], []
    last, count = '', ''
    for ch in st.rstrip('!') + '$':
        if ch.isdigit():
            count += ch
        elif ch in 'pqrstuvwxy@':
            last = ch
        else:
            n = int(count) if count else 1
            if ch == '$':
                rows.append(row)
                rows.extend([[] for _ in range(n - 1)])
                row = []
            elif ch in '%#' or last + ch in ('@A', '@B'):
                raise ValueError('not a 2D pattern')
            else:
                row.extend([ch2val(last + ch)] * n)
            last, count = '', ''
    w = max((len(r) for r in rows), default=0)
    return [r + [0] * (w - len(r)) for r in rows]


def trim(rows):
    """Remove the empty rows and columns at the edges."""
    ys = [y for y, r in enumerate(rows) if any(r)]
    if not ys:
        return rows
    rows = rows[ys[0]:ys[-1] + 1]
    xs = [x for x in range(len(rows[0])) if any(r[x] for r in rows)]
    return [r[xs[0]:xs[-1] + 1] for r in rows]


def clean_rank(name):
    for p in ('class: ', 'order: ', 'family: ', 'subfamily: '):
        if name.startswith(p):
            return name[len(p):]
    return name


def build(animals, keep=None):
    rank = ['', '', '', '']
    out = []
    for a in animals:
        code = a['code']
        if code.startswith('>'):
            lvl = int(code[1]) - 1
            rank[lvl] = clean_rank(a['name'])
            for k in range(lvl + 1, 4):
                rank[k] = ''
            continue
        p = a.get('params')
        if not p or 'cells' not in a:
            continue
        try:
            rows = trim(rle2rows(a['cells']))
        except ValueError:
            continue
        h, w = len(rows), len(rows[0]) if rows else 0
        if not w or not h:
            continue
        src_index = animals.index(a)
        entry = {
            'code': code, 'name': a['name'], 'cname': a.get('cname', ''),
            'rank': list(rank), 'src': src_index,
            'R': p['R'], 'T': p['T'], 'm': p['m'], 's': p['s'],
            'b': [round(float(Fraction(f)), 6) for f in str(p['b']).split(',')],
            'kn': p.get('kn', 1), 'gn': p.get('gn', 1),
            'w': w, 'h': h,
            'cells': base64.b64encode(bytes(v for r in rows for v in r)).decode('ascii'),
            'scale': 1, 'cls': 'live',
        }
        if keep is not None:
            k = keep.get(str(src_index))
            if not k:
                continue
            entry['scale'] = k['scale']
            entry['cls'] = k.get('cls', 'live')
        out.append(entry)
    for i, e in enumerate(out):
        e['id'] = i
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('animals')
    ap.add_argument('--keep', help='survival_test.js result: {src index: {scale}}')
    ap.add_argument('--out', default='creatures.json')
    ap.add_argument('--fixture', help='write the decoded cells of one source index as JSON and stop')
    args = ap.parse_args()
    animals = json.load(open(args.animals))
    if args.fixture is not None:
        rows = trim(rle2rows(animals[int(args.fixture)]['cells']))
        json.dump({'w': len(rows[0]), 'h': len(rows), 'cells': [v for r in rows for v in r]}, open(args.out, 'w'))
        return
    keep = json.load(open(args.keep)) if args.keep else None
    creatures = build(animals, keep)
    doc = {
        'source': {'repo': REPO, 'rev': REV, 'file': 'Python/animals.json',
                   'license': 'MIT, Copyright (c) 2018 Bert Chan'},
        'creatures': creatures,
    }
    with open(args.out, 'w') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(creatures)} creatures -> {args.out}')


if __name__ == '__main__':
    main()
