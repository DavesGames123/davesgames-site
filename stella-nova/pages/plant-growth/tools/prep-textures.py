#!/usr/bin/env python3
# ============================================================================
#  PLANT GROWTH  ·  prepare the bark and ground textures (offline tool)
# ----------------------------------------------------------------------------
#  In: Poly Haven 1k JPG maps (CC0, polyhaven.com), downloaded into SRC:
#    bark_brown_02, trident_maple_bark, pine_bark, bark_willow, sakura_bark,
#    jolcham_oak_bark_01 (diff + nor_gl), forrest_ground_01,
#    forest_leaves_02 (diff/diffuse + nor_gl).
#  Out (OUT/assets): bark-<id>-color.jpg (1024), bark-<id>-normal.jpg (512),
#    ground-<id>-color.jpg (1024), ground-<id>-normal.jpg (512).
#  Birch bark and the fern stem have no scan here: this script draws them
#  (white bark with dark lenticels and black diamonds; a green stem).
#  RUN   python3 -I tools/prep-textures.py SRC OUT
# ============================================================================
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

SRC, OUT = sys.argv[1], sys.argv[2]
A = os.path.join(OUT, 'assets'); os.makedirs(A, exist_ok=True)

def find(stem, kind):
    for k in ([kind] if kind != 'diff' else ['diff', 'diffuse']):
        p = os.path.join(SRC, '%s_%s_1k.jpg' % (stem, k))
        if os.path.exists(p): return p
    raise FileNotFoundError(stem + ' ' + kind)

def save(img, name, size, q):
    img = img.convert('RGB').resize((size, size), Image.LANCZOS)
    img.save(os.path.join(A, name), quality=q, optimize=True)

BARK = {
    'oak': 'bark_brown_02', 'maple': 'trident_maple_bark', 'spruce': 'pine_bark',
    'willow': 'bark_willow', 'cherry': 'sakura_bark', 'bush': 'jolcham_oak_bark_01',
}
for bid, stem in BARK.items():
    save(Image.open(find(stem, 'diff')), 'bark-%s-color.jpg' % bid, 1024, 82)
    save(Image.open(find(stem, 'nor_gl')), 'bark-%s-normal.jpg' % bid, 512, 85)

GROUND = {'grass': 'forrest_ground_01', 'litter': 'forest_leaves_02'}   # the meadow and turf come from the nature pack
for gid, stem in GROUND.items():
    save(Image.open(find(stem, 'diff')), 'ground-%s-color.jpg' % gid, 1024, 80)
    save(Image.open(find(stem, 'nor_gl')), 'ground-%s-normal.jpg' % gid, 512, 85)

def tile_noise(n, sigma, seed):
    r = np.random.RandomState(seed)
    a = r.rand(n, n).astype(np.float32)
    a = ndimage.gaussian_filter(a, sigma, mode='wrap')
    return (a - a.min()) / (a.max() - a.min() + 1e-6)

def normal_from_height(h, k):
    gy, gx = np.gradient(h)
    # wrap the edges so the map tiles
    gx[:, 0] = (h[:, 1] - h[:, -1]) / 2; gx[:, -1] = (h[:, 0] - h[:, -2]) / 2
    gy[0, :] = (h[1, :] - h[-1, :]) / 2; gy[-1, :] = (h[0, :] - h[-2, :]) / 2
    n = np.stack([-gx * k, gy * k, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))

# --- birch: chalk white, horizontal lenticels, dark rough diamonds, a grey tone
N = 1024
r = np.random.RandomState(7)
base = 0.86 + 0.06 * tile_noise(N, 24, 1) - 0.05 * tile_noise(N, 3, 2)
hgt = 0.5 + 0.1 * tile_noise(N, 6, 3)
col = np.stack([base * 0.97, base * 0.96, base * 0.93], -1)
img = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)); d = ImageDraw.Draw(img)
H = Image.fromarray((hgt * 255).astype(np.uint8)); dh = ImageDraw.Draw(H)
for _ in range(420):   # lenticels: short grey horizontal dashes
    x, y = r.randint(0, N), r.randint(0, N); w = r.randint(6, 44); t = r.randint(1, 4)
    c = int(70 + 70 * r.rand())
    for ox in (-N, 0, N):
        for oy in (-N, 0, N):
            d.ellipse([x + ox, y + oy, x + ox + w, y + oy + t], fill=(c, c - 5, c - 9))
            dh.ellipse([x + ox, y + oy, x + ox + w, y + oy + t], fill=60)
for _ in range(7):     # dark rough patches where branches were
    x, y = r.randint(0, N), r.randint(0, N); w = r.randint(50, 110); h = r.randint(70, 150)
    m = Image.new('L', (N, N), 0); dm = ImageDraw.Draw(m)
    for ox in (-N, 0, N):
        for oy in (-N, 0, N):
            dm.polygon([(x + ox, y + oy - h / 2), (x + ox + w / 2, y + oy), (x + ox, y + oy + h / 2), (x + ox - w / 2, y + oy)], fill=255)
    rough = (tile_noise(N, 2.5, r.randint(1, 1 << 30)) > 0.45).astype(np.uint8) * 255
    m = Image.fromarray(np.minimum(np.asarray(m), rough)).filter(ImageFilter.GaussianBlur(1.6))
    img.paste((52, 46, 40), (0, 0), m); H.paste(20, (0, 0), m)
tone = tile_noise(N, 40, 21)
arr0 = np.asarray(img, np.float32)
arr0[..., 0] *= 1 + 0.05 * tone; arr0[..., 2] *= 1 - 0.05 * tone   # a faint peach cast in places
img = Image.fromarray(np.clip(arr0, 0, 255).astype(np.uint8))
img = img.filter(ImageFilter.GaussianBlur(1.0))
dark = tile_noise(N, 2, 9) > 0.82   # fine grey grit
arr = np.asarray(img, np.float32); arr[dark] *= 0.8
Image.fromarray(arr.astype(np.uint8)).save(os.path.join(A, 'bark-birch-color.jpg'), quality=84, optimize=True)
normal_from_height(np.asarray(H.filter(ImageFilter.GaussianBlur(1.5)), np.float32) / 255, 6).resize((512, 512), Image.LANCZOS).save(os.path.join(A, 'bark-birch-normal.jpg'), quality=85)

# --- fern stem: a green rachis with fine streaks and brown scales at the base
n = tile_noise(N, 1.5, 11)
streak = ndimage.gaussian_filter(np.random.RandomState(12).rand(N, N).astype(np.float32), (40, 1.2), mode='wrap')
streak = (streak - streak.min()) / (streak.max() - streak.min())
g = np.stack([0.36 + 0.1 * streak, 0.5 + 0.12 * streak, 0.2 + 0.05 * n], -1)
Image.fromarray((np.clip(g, 0, 1) * 255).astype(np.uint8)).save(os.path.join(A, 'bark-fern-color.jpg'), quality=82, optimize=True)
normal_from_height(streak, 3).resize((512, 512), Image.LANCZOS).save(os.path.join(A, 'bark-fern-normal.jpg'), quality=85)
print('textures written to', A)
