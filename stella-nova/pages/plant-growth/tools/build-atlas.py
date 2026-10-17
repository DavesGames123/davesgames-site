#!/usr/bin/env python3
# ============================================================================
#  PLANT GROWTH  ·  build the leaf atlas (offline tool, not loaded by the page)
# ----------------------------------------------------------------------------
#  Writes assets/leaf-color.jpg, assets/leaf-alpha.png, assets/leaf-normal.jpg
#  and atlas.js (the cell table) from:
#    - ambientCG leaf scans (CC0, ambientcg.com): LeafSet005 (cherry),
#      LeafSet010 (maple), LeafSet016 (oak), LeafSet019 (spruce sprays),
#      LeafSet023 (azalea), LeafSet024 (birch). 1K-JPG sets: Color,
#      Opacity, NormalGL. Download them yourself into SRC/LeafSetNNN/.
#    - our own drawings for the willow leaf, the fern pinna, the cherry
#      blossom, the azalea flower and the cotyledons.
#  Each scanned leaf is cut out by its opacity mask, turned so that the
#  petiole points down, scaled into its cell, and its colour is bled into
#  the empty part of the cell so that mipmaps keep no dark rim.
#
#  RUN   python3 -I tools/build-atlas.py SRC_DIR OUT_DIR
#        (OUT_DIR is the page folder: it gets assets/ and atlas.js)
# ============================================================================
import sys, os, math, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

SRC, OUT = sys.argv[1], sys.argv[2]
CELL, COLS, ROWS = 256, 8, 6
W, H = CELL * COLS, CELL * ROWS
PAD = 8
col = np.zeros((H, W, 3), np.float32)
alp = np.zeros((H, W), np.float32)
nor = np.zeros((H, W, 3), np.float32); nor[..., 2] = 1.0
cells = {}   # name -> list of [u0, v0, u1, v1, aspect]  (uv with v up, as in GL)

def put_cell(name, cx, cy, cw, ch, rgb, a, n):
    """rgb HxWx3 (0..1), a HxW (0..1), n HxWx3 (-1..1), sized to the cell."""
    x0, y0 = cx * CELL, cy * CELL
    w, h = cw * CELL, ch * CELL
    col[y0:y0 + h, x0:x0 + w] = rgb
    alp[y0:y0 + h, x0:x0 + w] = a
    nor[y0:y0 + h, x0:x0 + w] = n
    ys, xs = np.nonzero(a > 0.5)
    ex = (xs.max() - xs.min() + 1) / w if len(xs) else 1
    ey = (ys.max() - ys.min() + 1) / h if len(ys) else 1
    # uv rect of the cell, v from the bottom of the image (GL convention)
    u0, u1 = x0 / W, (x0 + w) / W
    v0, v1 = 1 - (y0 + h) / H, 1 - y0 / H
    cells.setdefault(name, []).append([round(u0, 6), round(v0, 6), round(u1, 6), round(v1, 6), round(float(ex * w) / float(ey * h), 4)])

def bleed(rgb, a):
    """fill rgb where a < 0.5 with the nearest leaf colour"""
    mask = a < 0.5
    if mask.all(): return rgb
    idx = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
    return rgb[idx[0], idx[1]]

def fit(rgb, a, n, cw, ch, flipy=False):
    """scale a cut-out (tight box, petiole at the bottom) into a cell, keep aspect"""
    h, w = a.shape
    TW, TH = cw * CELL - 2 * PAD, ch * CELL - 2 * PAD
    s = min(TW / w, TH / h)
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    def rs(arr, mode):
        if arr.ndim == 2:
            return np.asarray(Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).resize((nw, nh), mode), np.float32) / 255
        return np.asarray(Image.fromarray((np.clip(arr * 0.5 + 0.5 if mode == 'n' else arr, 0, 1) * 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS), np.float32) / 255
    a2 = rs(a, Image.LANCZOS)
    c2 = rs(rgb, Image.LANCZOS)
    n2 = rs(n, 'n') * 2 - 1
    out_a = np.zeros((ch * CELL, cw * CELL), np.float32)
    out_c = np.zeros((ch * CELL, cw * CELL, 3), np.float32)
    out_n = np.zeros((ch * CELL, cw * CELL, 3), np.float32); out_n[..., 2] = 1
    ox = (cw * CELL - nw) // 2
    oy = ch * CELL - PAD - nh          # the petiole sits on the bottom margin
    out_a[oy:oy + nh, ox:ox + nw] = a2
    out_c[oy:oy + nh, ox:ox + nw] = c2
    out_n[oy:oy + nh, ox:ox + nw] = n2
    out_c = bleed(out_c, out_a)
    return out_c, out_a, out_n

def load_set(sid):
    d = os.path.join(SRC, 'LeafSet' + sid)
    f = lambda k: os.path.join(d, 'LeafSet%s_1K-JPG_%s.jpg' % (sid, k))
    c = np.asarray(Image.open(f('Color')).convert('RGB'), np.float32) / 255
    a = np.asarray(Image.open(f('Opacity')).convert('L'), np.float32) / 255
    n = np.asarray(Image.open(f('NormalGL')).convert('RGB'), np.float32) / 255 * 2 - 1
    return c, a, n

def rot_img(arr, deg, normal=False, order=1):
    out = ndimage.rotate(arr, deg, reshape=True, order=order, mode='constant', cval=0.0)
    if normal:
        # turn the tangent-space normal with the image (image y points down)
        t = math.radians(deg)
        nx, ny = out[..., 0].copy(), out[..., 1].copy()
        out[..., 0] = nx * math.cos(t) - ny * math.sin(t)
        out[..., 1] = nx * math.sin(t) + ny * math.cos(t)
        out[..., 2] = np.where(np.abs(out[..., 2]) < 1e-6, 1.0, out[..., 2])
    return out

def components(a, min_px=3000):
    lab, n = ndimage.label(a > 0.5)
    objs = ndimage.find_objects(lab)
    out = []
    for k, sl in enumerate(objs):
        m = lab[sl] == k + 1
        if m.sum() < min_px: continue
        out.append((sl, k + 1))
    out.sort(key=lambda o: (o[0][0].start // 120, o[0][1].start))
    return out, lab

def cutout(c, a, n, sl, lab_id, lab, base):
    """cut one leaf out; base: where its petiole points in the scan
    (bottom, left, right, top). It ends with the petiole at the bottom."""
    pad = 12
    y0, y1 = max(0, sl[0].start - pad), min(a.shape[0], sl[0].stop + pad)
    x0, x1 = max(0, sl[1].start - pad), min(a.shape[1], sl[1].stop + pad)
    m = (lab[y0:y1, x0:x1] == lab_id).astype(np.float32)
    m = np.where(ndimage.binary_dilation(m > 0.5, iterations=2), a[y0:y1, x0:x1], 0)
    cc, nn = c[y0:y1, x0:x1].copy(), n[y0:y1, x0:x1].copy()
    # quarter turns first (the normal xy turns with the image)
    k = {'bottom': 0, 'right': 1, 'top': 2, 'left': 3}[base]
    for _ in range(k):   # np.rot90 k=-1: a clockwise quarter turn on screen
        m = np.rot90(m, -1); cc = np.rot90(cc, -1); nn = np.rot90(nn, -1)
        nx, ny = nn[..., 0].copy(), nn[..., 1].copy()
        nn = nn.copy(); nn[..., 0] = ny; nn[..., 1] = -nx
    m, cc, nn = np.ascontiguousarray(m), np.ascontiguousarray(cc), np.ascontiguousarray(nn)
    # then a small turn that stands the long axis upright
    ys, xs = np.nonzero(m > 0.5)
    cov = np.cov(np.vstack([xs - xs.mean(), ys - ys.mean()]))
    ev, evec = np.linalg.eigh(cov)
    ax = evec[:, 1]
    if ax[1] < 0: ax = -ax
    tilt = math.degrees(math.atan2(ax[0], ax[1]))     # 0 when the axis is vertical
    best = None
    for turn in (tilt, -tilt):
        if abs(turn) > 25: continue
        mm = rot_img(m, turn)
        yy, xx = np.nonzero(mm > 0.5)
        ratio = (yy.max() - yy.min() + 1) / (xx.max() - xx.min() + 1)
        if best is None or ratio > best[0] + 1e-3: best = (ratio, turn, mm)
    if best is None: best = (0, 0.0, m)
    turn, m2 = best[1], best[2]
    c2 = np.stack([rot_img(cc[..., k], turn) for k in range(3)], -1)
    n2 = np.stack([rot_img(nn[..., k], turn) for k in range(3)], -1)
    n2 = rot_img_fix(n2, turn)
    ys, xs = np.nonzero(m2 > 0.5)
    sl2 = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
    return c2[sl2], m2[sl2], n2[sl2]

def rot_img_fix(n, deg):
    t = math.radians(deg)
    nx, ny = n[..., 0].copy(), n[..., 1].copy()
    out = n.copy()
    out[..., 0] = nx * math.cos(t) + ny * math.sin(t)
    out[..., 1] = -nx * math.sin(t) + ny * math.cos(t)
    z = np.sqrt(np.clip(1 - out[..., 0] ** 2 - out[..., 1] ** 2, 0, 1))
    out[..., 2] = np.where(np.abs(n[..., 2]) < 1e-6, 1.0, z)
    return out

def tint_to(rgb, a, target):
    """scale the leaf colour so its mean matches target (0..1 sRGB)"""
    m = a > 0.5
    mean = rgb[m].mean(0)
    k = np.array(target) / np.maximum(mean, 1e-3)
    return np.clip(rgb * k, 0, 1)

# --------------------------------------------------------------- scans
def scanned(name, sid, picks, cx_list, target, cw=1, ch=1, base='bottom'):
    c, a, n = load_set(sid)
    comps, lab = components(a)
    for (k, (cx, cy)) in zip(picks, cx_list):
        sl, lid = comps[k]
        cc, aa, nn = cutout(c, a, n, sl, lid, lab, base)
        cc = tint_to(cc, aa, target)
        cc, aa, nn = fit(cc, aa, nn, cw, ch)
        put_cell(name, cx, cy, cw, ch, cc, aa, nn)

# --------------------------------------------------------------- drawn
SS = 4
def draw_cell(fn, cw=1, ch=1):
    S = (cw * CELL * SS, ch * CELL * SS)
    img = Image.new('RGBA', S, (0, 0, 0, 0))
    hgt = Image.new('L', S, 0)
    fn(ImageDraw.Draw(img), ImageDraw.Draw(hgt), S)
    img = img.resize((cw * CELL, ch * CELL), Image.LANCZOS)
    hgt = hgt.resize((cw * CELL, ch * CELL), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    arr = np.asarray(img, np.float32) / 255
    rgb, a = arr[..., :3], arr[..., 3]
    # straight colour from premultiplied edges
    rgb = np.where(a[..., None] > 1e-3, rgb, 0)
    hm = np.asarray(hgt, np.float32) / 255
    gy, gx = np.gradient(hm)
    nn = np.stack([-gx * 3, gy * 3, np.ones_like(hm)], -1)
    nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
    # a soft mottle and a darker rim, so a drawn cell is not flat
    rs = np.random.RandomState(int(abs(hm.sum() * 1000)) % 2**31)
    noise = ndimage.gaussian_filter(rs.rand(*a.shape).astype(np.float32), 3)
    noise = (noise - noise.mean()) / (noise.std() + 1e-6)
    edge = ndimage.gaussian_filter((a > 0.5).astype(np.float32), 5)
    rgb = rgb * (1 + 0.035 * noise[..., None]) * (0.86 + 0.14 * edge[..., None])
    rgb = np.clip(rgb, 0, 1)
    rgb = bleed(rgb, a)
    return rgb, a, nn

def lerp(a, b, t): return a + (b - a) * t
def hexc(h, al=255):
    h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), al)

def leaf_outline(S, half_w, n=160, serr=0.0, serr_n=0, base_y=None, tip_y=None, cx=None):
    w, h = S
    cx = w / 2 if cx is None else cx
    by = h - PAD * SS if base_y is None else base_y
    ty = PAD * SS if tip_y is None else tip_y
    L, R = [], []
    for k in range(n + 1):
        t = k / n
        y = lerp(by, ty, t)
        hw = half_w(t)
        if serr_n: hw *= 1 + serr * (0.5 + 0.5 * math.cos(t * serr_n * 2 * math.pi))
        L.append((cx - hw, y)); R.append((cx + hw, y))
    return R + L[::-1]

def willow(variant):
    def fn(d, hd, S):
        w, h = S
        pet = 0.06
        hw = lambda t: 0 if t < pet else 0.115 * w * math.sin(math.pi * min(1, (t - pet) / (1 - pet)) ** 0.8) ** 1.1
        poly = leaf_outline(S, hw, serr=0.035, serr_n=60)
        base = hexc('#7d9a3c') if variant == 0 else hexc('#6f8f34')
        d.polygon(poly, fill=base)
        hd.polygon(poly, fill=150)
        # midrib and veins
        d.line([(w / 2, h - PAD * SS), (w / 2, PAD * SS + 30)], fill=hexc('#b8c878'), width=7)
        hd.line([(w / 2, h - PAD * SS), (w / 2, PAD * SS + 30)], fill=230, width=9)
        for k in range(1, 26):
            t = k / 27; y = lerp(h - PAD * SS, PAD * SS, t); l = hw(t) * 0.92
            for s in (-1, 1):
                d.line([(w / 2, y), (w / 2 + s * l, y - l * 0.9)], fill=hexc('#96ae58', 160), width=3)
                hd.line([(w / 2, y), (w / 2 + s * l, y - l * 0.9)], fill=175, width=3)
    return draw_cell(fn)

def fern(variant):
    def fn(d, hd, S):
        w, h = S
        by, ty = h - PAD * SS, PAD * SS
        g = hexc('#5f8f2f') if variant == 0 else hexc('#6c9a35')
        dark = hexc('#4c7826')
        n = 15
        for k in range(n):
            t = (k + 0.6) / (n + 0.4)
            y = lerp(by, ty, t)
            L = (0.43 * w) * (math.sin(math.pi * min(1, 0.12 + 0.88 * (1 - t))) ** 0.7) * (0.55 + 0.45 * (1 - t)) + 0.04 * w
            pw = (by - ty) / n * 0.62
            for s in (-1, 1):
                # a rounded pinnule (oblong lobe) that leans to the tip
                cx0 = w / 2 + s * L * 0.5
                box = [cx0 - L * 0.5, y - pw, cx0 + L * 0.5, y + pw * 0.9]
                lobe = Image.new('L', S, 0); ld = ImageDraw.Draw(lobe)
                ld.ellipse(box, fill=255)
                lobe = lobe.rotate(s * 12, center=(w / 2, y))
                d.bitmap((0, 0), lobe, fill=g if (k + (s > 0)) % 2 else dark if variant else g)
                hd.bitmap((0, 0), lobe, fill=140)
                # the vein of the lobe
                d.line([(w / 2, y), (w / 2 + s * L * 0.9, y - L * 0.16)], fill=hexc('#89b35a', 150), width=4)
                hd.line([(w / 2, y), (w / 2 + s * L * 0.9, y - L * 0.16)], fill=190, width=4)
        d.line([(w / 2, by), (w / 2, ty + 10)], fill=hexc('#7aa048'), width=12)
        hd.line([(w / 2, by), (w / 2, ty + 10)], fill=235, width=12)
    return draw_cell(fn)

def blossom(variant):
    def fn(d, hd, S):
        w, h = S
        cx, cy = w / 2, h / 2
        R = w * 0.46
        for k in range(5):
            a0 = k / 5 * 2 * math.pi + (0.3 if variant else 0)
            pts = []
            for j in range(40):
                u = j / 39
                ang = a0 + (u - 0.5) * 1.5 * math.sin(math.pi * u) ** 0.3
                r = R * (0.12 + 0.88 * math.sin(math.pi * u) ** 0.5)
                if 0.42 < u < 0.58: r *= 0.86 + 0.14 * abs(u - 0.5) / 0.08   # the notch
                pts.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
            pts.append((cx, cy))
            pet = Image.new('L', S, 0); ImageDraw.Draw(pet).polygon(pts, fill=255)
            d.bitmap((0, 0), pet, fill=hexc('#fbe3ea') if variant == 0 else hexc('#f7cfdc'))
            hd.bitmap((0, 0), pet, fill=150)
            # veins and a pink flush at the base of the petal
            for v in (-0.25, 0, 0.25):
                d.line([(cx, cy), (cx + math.cos(a0 + v) * R * 0.85, cy + math.sin(a0 + v) * R * 0.85)], fill=hexc('#f2b8c8', 120), width=4)
        d.ellipse([cx - R * 0.3, cy - R * 0.3, cx + R * 0.3, cy + R * 0.3], fill=hexc('#e690a8', 200))
        for k in range(28):
            a = k / 28 * 2 * math.pi + 0.1 * math.sin(k * 7.1)
            r = R * (0.3 + 0.12 * ((k * 37) % 7) / 7)
            x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
            d.line([(cx, cy), (x, y)], fill=hexc('#f4c0cc'), width=4)
            d.ellipse([x - 10, y - 10, x + 10, y + 10], fill=hexc('#e8c040'))
            hd.ellipse([x - 10, y - 10, x + 10, y + 10], fill=255)
    return draw_cell(fn)

def azalea(variant):
    def fn(d, hd, S):
        w, h = S
        cx, cy = w / 2, h / 2
        R = w * 0.47
        base = hexc('#d83a7c') if variant == 0 else hexc('#e45a96')
        for k in range(5):
            a0 = k / 5 * 2 * math.pi - math.pi / 2
            pts = []
            for j in range(40):
                u = j / 39
                ang = a0 + (u - 0.5) * 1.25
                r = R * (0.2 + 0.8 * math.sin(math.pi * u) ** 0.35)
                pts.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
            pts.append((cx, cy))
            pet = Image.new('L', S, 0); ImageDraw.Draw(pet).polygon(pts, fill=255)
            d.bitmap((0, 0), pet, fill=base)
            hd.bitmap((0, 0), pet, fill=150 + 20 * (k % 2))
            if k == 0:   # the spotted upper lobe
                for s in range(26):
                    rr = R * (0.18 + 0.35 * (s % 7) / 7); aa = a0 + ((s * 13) % 9 - 4) * 0.07
                    x, y = cx + math.cos(aa) * rr, cy + math.sin(aa) * rr
                    d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=hexc('#8a1040'))
        d.ellipse([cx - R * 0.16, cy - R * 0.16, cx + R * 0.16, cy + R * 0.16], fill=hexc('#f6a8c8'))
        for k in range(5):
            a = -math.pi / 2 + (k - 2) * 0.22
            x, y = cx + math.cos(a) * R * 0.95, cy + math.sin(a) * R * 0.95
            d.line([(cx, cy), (x, y)], fill=hexc('#c02868'), width=5)
            d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=hexc('#6a2a20'))
    return draw_cell(fn)

def cotyledon(conifer):
    def fn(d, hd, S):
        w, h = S
        if conifer:
            hw = lambda t: 0.03 * w * math.sin(math.pi * min(1, t)) ** 0.5
            poly = leaf_outline(S, hw)
            d.polygon(poly, fill=hexc('#7aa64a')); hd.polygon(poly, fill=200)
            return
        hw = lambda t: 0 if t < 0.12 else 0.36 * w * math.sin(math.pi * min(1, (t - 0.12) / 0.88)) ** 0.6
        poly = leaf_outline(S, hw)
        d.polygon(poly, fill=hexc('#88ad48')); hd.polygon(poly, fill=200)
        d.line([(w / 2, h - PAD * SS), (w / 2, h * 0.25)], fill=hexc('#a8c870'), width=8)
    return draw_cell(fn)

# --------------------------------------------------------------- layout
LS = os.path.join
scanned('oak', '016', [0, 1, 3, 4], [(0, 0), (1, 0), (2, 0), (3, 0)], (0.30, 0.46, 0.14))
scanned('maple', '010', [0, 1, 2, 3], [(4, 0), (5, 0), (6, 0), (7, 0)], (0.28, 0.48, 0.12))
scanned('birch', '024', [0, 1, 4], [(0, 1), (1, 1), (2, 1)], (0.36, 0.52, 0.16))
scanned('cherry', '005', [1, 2, 1], [(3, 1), (4, 1), (5, 1)], (0.26, 0.44, 0.13))
scanned('azalea', '023', [0, 1, 3], [(6, 1), (7, 1), (0, 2)], (0.20, 0.36, 0.10), base='left')
for v in range(2): put_cell('willow', 1 + v, 2, 1, 1, *willow(v))
for v in range(2): put_cell('fern', 3 + v, 2, 1, 1, *fern(v))
put_cell('cotyledon', 5, 2, 1, 1, *cotyledon(False))
put_cell('cotyledonNeedle', 6, 2, 1, 1, *cotyledon(True))
for v in range(2): put_cell('blossom', v, 3, 1, 1, *blossom(v))
for v in range(2): put_cell('azaleaFlower', 2 + v, 3, 1, 1, *azalea(v))
scanned('spruce', '019', [0, 1], [(0, 4), (1, 4)], (0.16, 0.30, 0.12), cw=1, ch=2, base='right')

os.makedirs(LS(OUT, 'assets'), exist_ok=True)
Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(LS(OUT, 'assets', 'leaf-color.jpg'), quality=90)
Image.fromarray((np.clip(alp, 0, 1) * 255).astype(np.uint8)).save(LS(OUT, 'assets', 'leaf-alpha.png'), optimize=True)
Image.fromarray((np.clip(nor * 0.5 + 0.5, 0, 1) * 255).astype(np.uint8)).save(LS(OUT, 'assets', 'leaf-normal.jpg'), quality=86)
with open(LS(OUT, 'atlas.js'), 'w') as f:
    f.write('// ============================================================================\n')
    f.write('//  PLANT GROWTH  ·  leaf atlas cells (written by tools/build-atlas.py)\n')
    f.write('// ----------------------------------------------------------------------------\n')
    f.write('//  Each cell: [u0, v0, u1, v1, aspect]. uv has v up (GL). The petiole is at\n')
    f.write('//  the bottom centre of the cell (a flower cell: the centre). aspect is the\n')
    f.write('//  width over the height of the leaf in the cell. Do not edit by hand.\n')
    f.write('// ============================================================================\n')
    f.write('export const ATLAS_SIZE = [%d, %d];\n' % (W, H))
    f.write('export const ATLAS_CELLS = ' + json.dumps(cells, separators=(',', ':')) + ';\n')
print('atlas', W, H, {k: len(v) for k, v in cells.items()})
