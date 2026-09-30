#!/usr/bin/env python3
"""build_presets.py - make presets.json from the Ready pattern library.

Ready (GollyGang, GPL-3.0) keeps each pattern in a .vti file. The <RD> block
holds the rule (params and an OpenCL-C formula), the initial pattern
generator, and the render settings. This script reads only those facts
(equations, parameter values, IC geometry). It does not copy Ready code or
Ready description text. The descriptions, the KaTeX equations, the slider
ranges, and the speeds come from presets_overrides.json, which we write.

Usage:
    python3 build_presets.py [--ready PATH] [--out PATH] [--report]

    --ready   the Ready clone (default: $READY_DIR, then ../../../../../ready)
    --out     the output file (default: ../presets.json next to this folder)
    --report  print the survey table and the list of dropped patterns

Sections (grep -n "^def \\|^# ----" build_presets.py):
    load_vti            parse one .vti file (<RD> block and WholeExtent)
    translate_formula   OpenCL-C formula -> WGSL body for shadergen.js
    stencil_lets        Ready stencils that shadergen.js does not supply
    extract_param_map   "k = k1 + (k2-k1)*x_pos" lines -> paramMap
    translate_ic        <initial_pattern_generator> -> our init op list
    slider_range        default slider min/max/step for one param
    build_preset        one overrides entry -> one presets.json entry
    survey              table of every pattern in the library
"""

import argparse
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.dirname(HERE)
CHEMS = 'abcd'
READY_CHEMS = 'abcdefghijklmnopqrstuvwxyz'
COMP = 'xyzw'

# Names that a param or a local must not use in the WGSL body.
WGSL_WORDS = set('''alias break case const const_assert continue continuing default diagnostic discard
else enable false fn for if let loop override requires return struct switch true var while
bool f16 f32 i32 u32 vec2 vec3 vec4 mat2x2 mat3x3 mat4x4 array atomic ptr sampler texture_2d
abs acos acosh asin asinh atan atan2 atanh ceil clamp cos cosh cross degrees determinant distance
dot exp exp2 faceForward floor fma fract frexp inverseSqrt ldexp length log log2 max min mix modf
normalize pow quantizeToF16 radians reflect refract round saturate sign sin sinh smoothstep sqrt
step tan tanh transpose trunc select all any arrayLength bitcast countOneBits dpdx dpdy fwidth
textureLoad textureStore textureSample textureDimensions workgroupBarrier storageBarrier
this self super new null nil in out inout mod as auto handle target type typedef
unsafe unsigned signed static template namespace union public private protected module
precision packed uniform storage function workgroup read write read_write'''.split())


# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------

def load_vti(path):
    """Return a dict with the facts of one Ready pattern."""
    txt = open(path, encoding='utf-8', errors='replace').read()
    m = re.search(r'<RD.*?</RD>', txt, re.S)
    rd = ET.fromstring(m.group(0))
    we = [int(v) for v in re.search(r'WholeExtent="([^"]+)"', txt).group(1).split()]
    dims = [we[1] - we[0] + 1, we[3] - we[2] + 1, we[5] - we[4] + 1]
    rule = rd.find('rule')
    params = []
    for p in rule.findall('param'):
        params.append((p.get('name'), float(p.text.strip())))
    fo = rule.find('formula')
    kern = rule.find('kernel')
    out = {
        'path': path, 'dims': dims, 'type': rule.get('type'),
        'rule_name': rule.get('name'),
        'wrap': rule.get('wrap', '1') not in ('0', 'false'),
        'neighborhood': rule.get('neighborhood_type', 'vertex'),
        'params': params,
        'nchem': int((fo if fo is not None else kern).get('number_of_chemicals', 0))
        if (fo is not None or kern is not None) else 0,
        'formula': fo.text if fo is not None else None,
        'accuracy': fo.get('accuracy', 'medium') if fo is not None else None,
        'overlays': [], 'render': {},
    }
    ipg = rd.find('initial_pattern_generator')
    if ipg is not None:
        out['overlays'] = list(ipg.findall('overlay'))
    rs = rd.find('render_settings')
    if rs is not None:
        for c in rs:
            if 'value' in c.attrib:
                out['render'][c.tag] = c.get('value')
            elif 'r' in c.attrib:
                out['render'][c.tag] = (float(c.get('r')), float(c.get('g')), float(c.get('b')))
    return out


# ---------------------------------------------------------------------------
# Stencils. Ready "medium" accuracy, 2D. A point is (dx, dy, weight), with
# +dy = Ready "n" = increasing row index. Each entry: points, divisor, dx power.
# shadergen.js already gives laplacian (9-point, same as Ready), x/y_gradient
# and gradient_mag_squared (same as Ready). The others are made here from
# rd_ld(rd_x + i, rd_y + j), which the shadergen body contract supplies.
# ---------------------------------------------------------------------------

def _sym5(c1, c2, c3, c4, c5, c6):
    rows = [[c1, c2, c3, c2, c1], [c2, c4, c5, c4, c2], [c3, c5, c6, c5, c3],
            [c2, c4, c5, c4, c2], [c1, c2, c3, c2, c1]]
    return _rows(rows)


def _rows(rows):
    """Rows in reading order (north row first) -> points."""
    m = len(rows)
    n = len(rows[0])
    pts = []
    for j in range(m):
        for i in range(n):
            if rows[j][i]:
                pts.append((i - (n - 1) // 2, -j + (m - 1) // 2, rows[j][i]))
    return pts


STENCILS = {
    # Patra and Karttunen isotropic 5x5 bi-Laplacian (Ready 2D).
    'bilaplacian': (_sym5(0, 1, 1, -2, -10, 36), 3, 4),
    'x_deriv2': ([(-1, 0, 1), (0, 0, -2), (1, 0, 1)], 1, 2),
    'y_deriv2': ([(0, -1, 1), (0, 0, -2), (0, 1, 1)], 1, 2),
    'x_deriv3': ([(-2, 0, -1), (-1, 0, 2), (1, 0, -2), (2, 0, 1)], 2, 3),
    'y_deriv3': ([(0, -2, -1), (0, -1, 2), (0, 1, -2), (0, 2, 1)], 2, 3),
    'gaussian': (_sym5(1, 4, 7, 16, 26, 41), 273, 0),
    'sobelN': (_rows([[1, 2, 1], [0, 0, 0], [-1, -2, -1]]), 1, 0),
    'sobelS': (_rows([[-1, -2, -1], [0, 0, 0], [1, 2, 1]]), 1, 0),
    'sobelE': (_rows([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]), 1, 0),
    'sobelW': (_rows([[1, 0, -1], [2, 0, -2], [1, 0, -1]]), 1, 0),
    'sobelNW': (_rows([[2, 1, 0], [1, 0, -1], [0, -1, -2]]), 1, 0),
    'sobelNE': (_rows([[0, 1, 2], [-1, 0, 1], [-2, -1, 0]]), 1, 0),
    'sobelSW': (_rows([[0, -1, -2], [1, 0, -1], [2, 1, 0]]), 1, 0),
    'sobelSE': (_rows([[-2, -1, 0], [-1, 0, 1], [0, 1, 2]]), 1, 0),
}
NATIVE_OPS = ('laplacian', 'x_gradient', 'y_gradient', 'gradient_mag_squared')


def _ld(ch, i, j):
    xs = 'rd_x' if i == 0 else f'rd_x {"+" if i > 0 else "-"} {abs(i)}'
    ys = 'rd_y' if j == 0 else f'rd_y {"+" if j > 0 else "-"} {abs(j)}'
    return f'rd_ld({xs}, {ys}).{COMP[CHEMS.index(ch)]}'


def _fl(v):
    s = repr(float(v))
    return s


def stencil_lets(body):
    """Return (lets, body) where lets define the non-native stencils and the
    neighbor names that the body uses."""
    lets = []
    for name, (pts, div, pw) in STENCILS.items():
        for ch in CHEMS:
            kw = f'{name}_{ch}'
            if not re.search(r'\b' + kw + r'\b', body):
                continue
            terms = []
            for (i, j, w) in sorted(pts, key=lambda p: (p[1], p[0])):
                t = _ld(ch, i, j) if (i or j) else ch
                terms.append(('+ ' if w > 0 else '- ') + (t if abs(w) == 1 else f'{abs(w)}.0 * {t}'))
            expr = ' '.join(terms).lstrip('+ ')
            if expr.startswith('- '):
                expr = '-' + expr[2:]
            den = [str(div) + '.0'] if div != 1 else []
            den += ['dx'] * pw
            rhs = f'({expr})' + (f' / ({" * ".join(den)})' if den else '')
            # The bilaplacian keyword is native in shadergen.js, but it uses a
            # different 13-point stencil. Keep Ready's stencil: rename it.
            new = 'rd_' + kw if name == 'bilaplacian' else kw
            if new != kw:
                body = re.sub(r'\b' + kw + r'\b', new, body)
            lets.append(f'let {new}: f32 = {rhs};')
    # Neighbor names such as a_n, a_ne, a_e2 (Ready: n = +y, e = +x).
    seen = set()
    for m in re.finditer(r'\b([abcd])_((?:[ns]\d?)?(?:[ew]\d?)?)\b', body):
        ch, d = m.group(1), m.group(2)
        if not d or m.group(0) in seen:
            continue
        mm = re.fullmatch(r'(?:([ns])(\d?))?(?:([ew])(\d?))?', d)
        j = 0
        i = 0
        if mm.group(1):
            j = (1 if mm.group(1) == 'n' else -1) * int(mm.group(2) or 1)
        if mm.group(3):
            i = (1 if mm.group(3) == 'e' else -1) * int(mm.group(4) or 1)
        seen.add(m.group(0))
        lets.append(f'let {m.group(0)}: f32 = {_ld(ch, i, j)};')
    return lets, body


# ---------------------------------------------------------------------------
# Formula translation: OpenCL-C -> WGSL body
# ---------------------------------------------------------------------------

def _match_paren(s, i):
    """s[i] == '('. Return the index of the matching ')'."""
    depth = 0
    for k in range(i, len(s)):
        if s[k] == '(':
            depth += 1
        elif s[k] == ')':
            depth -= 1
            if depth == 0:
                return k
    raise ValueError('unbalanced parentheses')


def _split_args(s):
    out, depth, cur = [], 0, ''
    for ch in s:
        if ch == ',' and depth == 0:
            out.append(cur)
            cur = ''
            continue
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        cur += ch
    out.append(cur)
    return [a.strip() for a in out]


def _rewrite_calls(s):
    """Rewrite fmod, fabs, step, atan2 and integer-power pow calls, inner calls first."""
    out = ''
    i = 0
    while i < len(s):
        m = re.compile(r'\b(fmod|fabs|pow|step|atan2)\s*\(').search(s, i)
        if not m:
            out += s[i:]
            break
        out += s[i:m.start()]
        p = m.end() - 1
        q = _match_paren(s, p)
        args = [_rewrite_calls(a) for a in _split_args(s[p + 1:q])]
        name = m.group(1)
        if name == 'atan2':
            # OpenCL gives atan2(0, 0) = 0. WGSL leaves it undefined (NaN on
            # some GPUs), so keep the OpenCL value.
            y_, x_ = args
            out += f'select(atan2({y_}, {x_}), 0.0, ({x_}) == 0.0 && ({y_}) == 0.0)'
        elif name == 'step':
            # shadergen.js names its entry point step, which hides step().
            out += f'select(0.0, 1.0, ({args[1]}) >= ({args[0]}))'
        elif name == 'fabs':
            out += f'abs({args[0]})'
        elif name == 'fmod':
            # WGSL % on f32 is x - y * trunc(x / y), the same as C fmod.
            out += f'(({args[0]}) % ({args[1]}))'
        else:
            e = args[1].strip().rstrip('f')
            if re.fullmatch(r'\d+(\.0*)?', e) and 2 <= float(e) <= 5:
                # pow() with a negative base is NaN in WGSL: use a product.
                base = f'({args[0]})'
                out += '(' + ' * '.join([base] * int(float(e))) + ')'
            else:
                out += f'pow({args[0]}, {args[1]})'
        i = q + 1
    return out


NUM = re.compile(r'(?<![\w.])((?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)[fF]?(?![\w.])')


def _fix_number(m):
    t = m.group(1)
    if '.' not in t and 'e' not in t.lower():
        t += '.0'
    elif t.endswith('.'):
        t += '0'
    return t


def translate_formula(src, rename=None):
    """OpenCL-C formula text -> WGSL statements. rename maps old -> new names."""
    s = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    s = re.sub(r'//[^\n]*', '', s)
    for old, new in (rename or {}).items():
        s = re.sub(r'\b' + re.escape(old) + r'\b', new, s)
    s = re.sub(r'\(\s*float4?\s*\)', '', s)          # C casts
    s = _rewrite_calls(s)
    s = NUM.sub(_fix_number, s)
    # Local declarations: float4 x = ...; / const float x = ...;
    decl = re.compile(r'(?:\bconst\s+)?\bfloat4?\s+([A-Za-z_]\w*)\s*=')
    names = decl.findall(s)
    for n in names:
        if n in WGSL_WORDS:
            raise ValueError(f'local "{n}" is a WGSL word: add a rename')
    def repl(m):
        n = m.group(1)
        # var if the name is assigned again after its declaration
        rest = s[m.end():]
        again = re.search(r'(?<![\w.])' + n + r'\s*([-+*/]?=)(?!=)', rest)
        return ('var ' if again else 'let ') + n + ' ='
    s = decl.sub(repl, s)
    if re.search(r'\bfloat4?\b', s):
        raise ValueError('declaration left over: needs a hand translation')
    # Tidy the lines.
    lines = [ln.strip() for ln in s.split('\n')]
    lines = [ln for ln in lines if ln]
    body = '\n'.join(lines)
    lets, body = stencil_lets(body)
    if lets:
        body = '\n'.join(lets) + '\n' + body
    return body


# ---------------------------------------------------------------------------
# Parameter maps: Ready writes "float4 k = k1 + (k2-k1)*x_pos;". We turn that
# into a paramMap and a plain param k, so shadergen.js makes the mapping.
# ---------------------------------------------------------------------------

PMAP = re.compile(r'^\s*float4?\s+(\w+)\s*=\s*(\w+)\s*\+\s*\(\s*(\w+)\s*-\s*(\w+)\s*\)\s*\*\s*([xy])_pos\s*;\s*$', re.M)


def extract_param_map(formula, params):
    pm = {}
    pvals = dict(params)
    drop = set()
    newp = []
    for m in PMAP.finditer(formula):
        name, lo, hi, lo2, axis = m.groups()
        if lo != lo2:
            continue
        pm[axis] = name
        pm[axis + '0'] = pvals[lo]
        pm[axis + '1'] = pvals[hi]
        drop |= {lo, hi}
        newp.append((name, (pvals[lo] + pvals[hi]) / 2, pvals[lo], pvals[hi]))
    if not pm:
        return formula, params, None, {}
    formula = PMAP.sub('', formula)
    params = [p for p in params if p[0] not in drop] + [(n, v) for (n, v, _, _) in newp]
    ranges = {n: (min(lo, hi), max(lo, hi)) for (n, _, lo, hi) in newp}
    return formula, params, pm, ranges


# ---------------------------------------------------------------------------
# Initial conditions: Ready overlays -> our op list (see tools/README.md).
# ---------------------------------------------------------------------------

class ICError(Exception):
    pass


def _pt(el):
    return float(el.get('x', 0)), float(el.get('y', 0))


def translate_ic(v, size, embed=False, chem_map=None):
    """Return the init list. size = (W, H) of our grid. With embed, the Ready
    grid keeps its cell size and sits in the center of the bigger grid."""
    W0, H0 = v['dims'][0], v['dims'][1]
    W, H = size
    if embed:
        sx, tx = W0 / W, (W - W0) / 2 / W
        sy, ty = H0 / H, (H - H0) / 2 / H
    else:
        sx, tx, sy, ty = 1.0, 0.0, 1.0, 0.0
    # our coord = s * ready coord + t
    X = lambda x: round(sx * x + tx, 6)
    Y = lambda y: round(sy * y + ty, 6)
    # Ready: circle radius and sigma are fractions of the largest Ready
    # dimension (in cells). Ours: fractions of our grid width.
    m = max(v['dims'])
    rscale = m / W if embed else m / W0
    pvals = dict(v['params'])
    ops = []
    const_known = {}
    for ov in v['overlays']:
        ch = ov.get('chemical')
        if chem_map:
            ch = chem_map.get(ch, ch)
        if ch not in CHEMS:
            raise ICError(f'chemical {ch} is past d')
        op = fill = None
        shapes = []
        for c in ov:
            if c.tag in ('overwrite', 'add', 'subtract', 'multiply', 'divide'):
                op = c.tag
            elif c.tag in ('everywhere', 'rectangle', 'circle', 'pixel'):
                shapes.append(c)
            else:
                fill = c   # Ready keeps the last fill element
        regions = []
        for sh in shapes:
            if sh.tag == 'everywhere':
                regions.append(None)
            elif sh.tag == 'rectangle':
                (x0, y0), (x1, y1) = _pt(sh[0]), _pt(sh[1])
                if x1 < x0 or y1 < y0:
                    continue   # Ready's test is empty for a reversed box
                regions.append({'rect': [X(x0), Y(y0), X(x1), Y(y1)]})
            elif sh.tag == 'circle':
                cx, cy = _pt(sh[0])
                regions.append({'circle': [X(cx), Y(cy), round(float(sh.get('radius')) * rscale, 6)]})
            else:
                raise ICError('pixel shape')
        for reg in regions:
            ops.extend(_fill_ops(ch, op, fill, reg, pvals, const_known, rscale, (sx, tx, sy, ty)))
            if reg is None and op == 'overwrite' and fill.tag in ('constant', 'parameter'):
                const_known[ch] = _const_value(fill, pvals)
            elif reg is None and fill.tag == 'constant' and ch in const_known:
                c0 = const_known[ch]
                val = _const_value(fill, pvals)
                const_known[ch] = {'add': c0 + val, 'subtract': c0 - val, 'multiply': c0 * val,
                                   'divide': c0 / val if val else c0}.get(op, c0)
            elif reg is None:
                const_known.pop(ch, None)
    return ops


def _const_value(fill, pvals):
    if fill.tag == 'constant':
        return float(fill.get('value'))
    return pvals[fill.get('name')]


def _with(d, reg, mode=None):
    if reg is not None:
        d['region'] = reg
    if mode and mode != 'set':
        d['mode'] = mode
    return d


def _fill_ops(ch, op, fill, reg, pvals, const_known, rscale, tr):
    sx, tx, sy, ty = tr
    t = fill.tag
    if t in ('constant', 'parameter'):
        v = _const_value(fill, pvals)
        if op == 'overwrite':
            return [_with({'op': 'set' if reg else 'fill', 'chem': ch, 'value': v}, reg)]
        if op == 'add':
            return [_with({'op': 'add', 'chem': ch, 'value': v}, reg)]
        if op == 'subtract':
            return [_with({'op': 'add', 'chem': ch, 'value': -v}, reg)]
        if op == 'multiply':
            return [_with({'op': 'set', 'chem': ch, 'value': v}, reg, 'mul')]
        if op == 'divide':
            return [_with({'op': 'set', 'chem': ch, 'value': 1.0 / v}, reg, 'mul')]
    if t == 'white_noise':
        lo, hi = float(fill.get('low')), float(fill.get('high'))
        if lo > hi:
            lo, hi = hi, lo
        if op == 'overwrite':
            return [_with({'op': 'noise', 'chem': ch, 'low': lo, 'high': hi}, reg)]
        if op == 'add':
            return [_with({'op': 'noise', 'chem': ch, 'low': lo, 'high': hi}, reg, 'add')]
        if op == 'subtract':
            return [_with({'op': 'noise', 'chem': ch, 'low': -hi, 'high': -lo}, reg, 'add')]
        if op == 'multiply':
            return [_with({'op': 'noise', 'chem': ch, 'low': lo, 'high': hi}, reg, 'mul')]
    if t == 'other_chemical':
        src = fill.get('chemical')
        if op == 'overwrite':
            return [_with({'op': 'copy', 'chem': ch, 'from': src}, reg)]
        if op == 'subtract' and ch in const_known:
            return [_with({'op': 'copy', 'chem': ch, 'from': src, 'scale': -1.0,
                           'offset': const_known[ch]}, reg)]
        raise ICError(f'other_chemical with {op}')
    if t == 'gaussian':
        cx, cy = _pt(fill[0])
        d = {'op': 'gauss', 'chem': ch, 'amplitude': float(fill.get('height')),
             'center': [round(sx * cx + tx, 6), round(sy * cy + ty, 6)],
             'sigma': round(float(fill.get('sigma')) * rscale, 6)}
        mode = {'overwrite': 'set', 'add': 'add', 'multiply': 'mul'}.get(op)
        if mode is None:
            raise ICError(f'gaussian with {op}')
        return [_with(d, reg, mode)]
    if t == 'sine':
        (x1, y1), (x2, y2) = _pt(fill[0]), _pt(fill[1])
        bx, by = x2 - x1, y2 - y1
        b2 = bx * bx + by * by
        kx0, ky0 = bx / b2, by / b2          # waves per unit of Ready coords
        # Ready: amp * sin(2 pi ((r - p1) . b / |b|^2) - phase)
        # ours:  amp * sin(2 pi (kx x + ky y) + ph), x = sx * xr + tx
        kx, ky = kx0 / sx, ky0 / sy
        ph = -2 * math.pi * (kx0 * x1 + ky0 * y1) - float(fill.get('phase', 0)) \
             - 2 * math.pi * (kx * tx + ky * ty)
        d = {'op': 'sine', 'chem': ch, 'amplitude': float(fill.get('amplitude')),
             'kx': round(kx, 6), 'ky': round(ky, 6), 'phase': round(ph, 6)}
        mode = {'overwrite': 'set', 'add': 'add', 'multiply': 'mul'}.get(op)
        if mode is None:
            raise ICError(f'sine with {op}')
        return [_with(d, reg, mode)]
    if t == 'linear_gradient':
        (x1, y1), (x2, y2) = _pt(fill[0]), _pt(fill[1])
        d = {'op': 'linear', 'chem': ch,
             'x0': round(sx * x1 + tx, 6), 'y0': round(sy * y1 + ty, 6),
             'x1': round(sx * x2 + tx, 6), 'y1': round(sy * y2 + ty, 6),
             'v0': float(fill.get('val1')), 'v1': float(fill.get('val2'))}
        mode = {'overwrite': 'set', 'add': 'add', 'multiply': 'mul'}.get(op)
        return [_with(d, reg, mode)]
    raise ICError(f'fill {t} is not supported')


# ---------------------------------------------------------------------------
# Sliders
# ---------------------------------------------------------------------------

def _nice_step(span):
    raw = span / 200.0
    if raw <= 0:
        return 0.01
    e = math.floor(math.log10(raw))
    for m in (1, 2, 5, 10):
        if m * 10 ** e >= raw:
            return float(f'{m * 10 ** e:.12g}')
    return 10 ** (e + 1)


def slider_range(v):
    if v > 0:
        lo, hi = 0.0, 2.0 * v
    elif v < 0:
        lo, hi = 2.0 * v, 0.0
    else:
        lo, hi = -1.0, 1.0
    st = _nice_step(hi - lo)
    return float(f'{lo:.12g}'), float(f'{hi:.12g}'), st


# ---------------------------------------------------------------------------
# Render hints
# ---------------------------------------------------------------------------

# Ready colormap -> a colormap name in colormaps.js
COLORMAPS = {'spectral': 'spectral', 'spectral reversed': 'spectral',
             'terrain': 'viridis', 'inferno': 'magma', 'HSV blend': 'spectral'}


def render_hints(v, nchem):
    r = v['render']
    chem = r.get('active_chemical', 'a')
    if chem not in CHEMS[:max(nchem, 1)] and chem not in CHEMS:
        chem = 'a'
    cm = COLORMAPS.get(r.get('colormap', ''), None)
    if cm is None:
        lo_c = r.get('color_low', (0, 0, 1))
        hi_c = r.get('color_high', (1, 0, 0))
        if lo_c == (0, 0, 0) and hi_c == (1, 1, 1):
            cm = 'grey'
        elif lo_c == (1, 1, 1) and hi_c == (0, 0, 0):
            cm = 'grey'
        else:
            cm = 'spectral'
    return {
        'chem': chem,
        'low': float(r.get('low', 0)),
        'high': float(r.get('high', 1)),
        'colormap': cm,
        'height': r.get('show_displacement_mapped_surface', 'true') == 'true',
    }


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def _num(x):
    """Tidy floats for JSON."""
    if isinstance(x, float):
        return float(f'{x:.9g}')
    return x


def build_preset(entry, ready_root, fam_defaults):
    v = load_vti(os.path.join(ready_root, 'Patterns', entry['source']))
    if v['type'] != 'formula':
        raise ValueError(f'{entry["source"]}: rule type {v["type"]}')
    fam = fam_defaults.get(entry['family'], {})
    params = list(v['params'])
    rename = dict(entry.get('rename', {}))
    # Values set by the entry (variants of one Ready pattern).
    setv = entry.get('set', {})
    params = [(n, float(setv.get(n, val))) for (n, val) in params]
    for n in setv:
        if n not in dict(params):
            params.append((n, float(setv[n])))
    src = v['formula']
    for a_, b_ in entry.get('formula_replace', []):
        if a_ not in src:
            raise ValueError(f'{entry["id"]}: formula_replace text not found: {a_}')
        src = src.replace(a_, b_)
    pm_ranges = {}
    param_map = None
    if entry.get('param_map', 'auto') == 'auto':
        src, params, param_map, pm_ranges = extract_param_map(src, params)
    timestep = dx = None
    rest = []
    for (n, val) in params:
        if n == 'timestep':
            timestep = val
        elif n == 'dx':
            dx = val
        else:
            rest.append((n, val))
    params = rest
    timestep = entry.get('timestep', timestep if timestep is not None else 1.0)
    dx = entry.get('dx', dx if dx is not None else 1.0)
    if 'formula' in entry:
        body = entry['formula'] if isinstance(entry['formula'], str) else '\n'.join(entry['formula'])
        lets, body = stencil_lets(body)
        if lets:
            body = '\n'.join(lets) + '\n' + body
    else:
        body = translate_formula(src, rename)
    nchem = entry.get('chemicals', v['nchem'])
    if nchem > 4:
        raise ValueError(f'{entry["id"]}: {nchem} chemicals')
    W0, H0 = v['dims'][0], v['dims'][1]
    size = entry.get('size', [W0, H0])
    if 'init' in entry:
        init = entry['init']
    else:
        init = translate_ic(v, size, embed=entry.get('embed', False))
    init = init + entry.get('init_append', [])
    pover = entry.get('params', {})
    plist = []
    # A Ready param that the body never reads (for example one used only by
    # the Ready IC) gets no slider and no uniform slot.
    params = [(n, val) for (n, val) in params
              if re.search(r'\b' + re.escape(rename.get(n, n)) + r'\b', body)
              or (param_map and n in param_map.values())]
    for (n, val) in params:
        name = rename.get(n, n)
        lo, hi, st = slider_range(val)
        if n in pm_ranges:
            lo, hi = pm_ranges[n]
            st = _nice_step(hi - lo)
        o = pover.get(n, {})
        if o.get('hide'):
            continue
        plist.append({'name': name, 'value': _num(val),
                      'min': _num(float(o.get('min', lo))), 'max': _num(float(o.get('max', hi))),
                      'step': _num(float(o.get('step', st))), 'label': o.get('label', n)})
    hidden = {n: val for (n, val) in params if pover.get(n, {}).get('hide')}
    render = render_hints(v, nchem)
    render.update(fam.get('render', {}))
    render.update(entry.get('render', {}))
    out = {
        'id': entry['id'],
        'name': entry['name'],
        'family': entry['family'],
        'source': 'Patterns/' + entry['source'],
        'citation': entry.get('citation', fam.get('citation')),
        'credit': 'Ready (GollyGang)',
        'description': entry['description'],
        'equations': entry.get('equations', fam.get('equations')),
        'chemicals': nchem,
        'names': entry.get('names', fam.get('names', list(CHEMS[:nchem]))),
        'params': plist,
        'timestep': _num(float(timestep)),
        'dx': _num(float(dx)),
        'neighborhood': 'vertex',
        'wrap': entry.get('wrap', v['wrap']),
        'width': size[0],
        'height': size[1],
        'formula': body,
        'init': init,
        'render': render,
        'speed': entry.get('speed', fam.get('speed', 8)),
    }
    if hidden:
        # A hidden param keeps a uniform slot but gets no slider.
        for (n, val) in hidden.items():
            out['params'].append({'name': rename.get(n, n), 'value': _num(val), 'min': _num(val),
                                  'max': _num(val), 'step': 1, 'label': n, 'hidden': True})
    if param_map:
        out['paramMap'] = {k: _num(v2) for k, v2 in param_map.items()}
    elif 'paramMap' in entry:
        out['paramMap'] = entry['paramMap']
    if 'notes' in entry:
        out['notes'] = entry['notes']
    for k in ('citation', 'equations'):
        if not out[k]:
            raise ValueError(f'{entry["id"]}: no {k}')
    if len(out['params']) > 60:
        raise ValueError(f'{entry["id"]}: too many params')
    return out


def survey(ready_root):
    rows = []
    base = os.path.join(ready_root, 'Patterns')
    for dp, _, fs in os.walk(base):
        for f in sorted(fs):
            if not f.endswith('.vti'):
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, base)
            v = load_vti(p)
            kws = set()
            if v['formula']:
                body = re.sub(r'//[^\n]*', '', v['formula'])
                kws = set(re.findall(r'\b((?:x_|y_|z_)?(?:gradient|deriv2|deriv3)_[a-z]|gradient_mag_squared_[a-z]|'
                                     r'(?:tri|bi)?laplacian_[a-z]|gaussian_[a-z]|sobel[NSEW]+_[a-z]|[xyz]_pos|'
                                     r'[a-z]_(?:[ns]\d?)?(?:[ew]\d?)?)\b', body))
                kws = {k for k in kws if not re.fullmatch(r'[a-z]_', k)}
            gens = sorted({c.tag for ov in v['overlays'] for c in ov
                           if c.tag not in ('overwrite', 'add', 'subtract', 'multiply', 'divide',
                                            'everywhere', 'rectangle', 'circle', 'pixel')})
            rows.append((rel, v['type'], v['nchem'], 'x'.join(map(str, v['dims'])), int(v['wrap']),
                         v['neighborhood'], ','.join(sorted(kws)), ','.join(gens)))
    rows.sort()
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ready', default=os.environ.get('READY_DIR'))
    ap.add_argument('--out', default=os.path.join(PAGE, 'presets.json'))
    ap.add_argument('--overrides', default=os.path.join(HERE, 'presets_overrides.json'))
    ap.add_argument('--report', action='store_true')
    ap.add_argument('--only', default=None, help='comma list of preset ids')
    a = ap.parse_args()
    if not a.ready:
        sys.exit('set --ready or READY_DIR to a clone of github.com/GollyGang/ready')
    ov = json.load(open(a.overrides))
    fam = ov.get('families', {})
    out = []
    used = set()
    fails = 0
    only = set(a.only.split(',')) if a.only else None
    for e in ov['presets']:
        if only and e['id'] not in only:
            continue
        try:
            out.append(build_preset(e, a.ready, fam))
            used.add(e['source'])
        except Exception as ex:   # report every failure, then stop with an error code
            fails += 1
            print(f'FAIL {e.get("id")}: {ex}', file=sys.stderr)
    ids = [p['id'] for p in out]
    if len(ids) != len(set(ids)):
        sys.exit('duplicate preset ids')
    if not only:
        with open(a.out, 'w') as fh:
            json.dump(out, fh, indent=1, ensure_ascii=False)
            fh.write('\n')
    else:
        json.dump(out, sys.stdout, indent=1, ensure_ascii=False)
    print(f'{len(out)} presets -> {a.out if not only else "stdout"}', file=sys.stderr)
    if a.report:
        rows = survey(a.ready)
        print(f'{"file":62s} {"type":8s} nc {"dims":10s} wrap nbhd   keywords | IC fills')
        for r in rows:
            print(f'{r[0]:62s} {r[1]:8s} {r[2]:2d} {r[3]:10s} {r[4]:4d} {r[5]:6s} {r[6]} | {r[7]}')
        reasons = ov.get('dropped', {})
        print('\nDROPPED:')
        for r in rows:
            if r[0] in used:
                continue
            why = reasons.get(r[0])
            if not why:
                if r[1] != 'formula':
                    why = f'{r[1]} rule (not a formula)'
                elif r[2] > 4:
                    why = f'{r[2]} chemicals (the engine holds 4)'
                elif r[3].endswith('x1x1'):
                    why = '1D pattern'
                elif not r[3].endswith('x1'):
                    why = '3D pattern'
                else:
                    why = 'not chosen'
            print(f'  {r[0]}: {why}')
    if fails:
        sys.exit(1)


if __name__ == '__main__':
    main()
