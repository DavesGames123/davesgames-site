"""volumes.py - real CT volumes to CT Lab 3D objects.

CT Lab 3D data tool. It turns two open-licence real CT data sets into the
page's object format: a uint8 volume of attenuation codes
(code = round(255 mu / muMax), mu in 1/cm at 70 keV, engine layout
data[(iz*ny + iy)*nx + ix], iz = 0 lowest, iy = 0 top) in
stella-nova/pages/ct-lab-3d/data/<id>.bin, plus an entry in data/objects.json.
tools/ct-lab-3d/build-meshes.mjs makes the mesh objects in the same format.

Sources (both CC BY 4.0; the page credits them):
  walnut  Der Sarkissian et al., "A cone-beam X-ray computed tomography data
          collection designed for machine learning", Sci Data 6, 215 (2019),
          doi:10.1038/s41597-019-0235-y. Data: doi:10.5281/zenodo.2686726,
          Walnut1.zip, Reconstructions/full_AGD_50_*.tiff (501 slices of
          501 x 501, float32). We read every 4th slice by HTTP range
          (tools/ct-lab-3d/remotezip.py) and average 4 x 4 pixel blocks.
  rabbit  RabbitCT, Rohkohl et al., Med Phys 36(9):3940-3944 (2009),
          doi:10.1118/1.3180956. Data: doi:10.5281/zenodo.21267885,
          reference_256.vol (256^3 float32, 1 mm voxels). We average 2^3 blocks.

Usage (from the repo root, python3 -I):
  python3 -I tools/ct-lab-3d/volumes.py rabbit RABBIT_VOL
  python3 -I tools/ct-lab-3d/volumes.py walnut WALNUT_NPY     (the fetch output: 126 x 125 x 125)
  python3 -I tools/ct-lab-3d/volumes.py fetch-walnut OUT_NPY  (range-reads Zenodo, about 90 MB)
  python3 -I tools/ct-lab-3d/volumes.py thumbs -               (gallery images for every object)

grep handles: def rabbit, def walnut, def fetch_walnut, def thumbs, def write, MU
"""
import io
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'stella-nova', 'pages', 'ct-lab-3d', 'data')
# mu at 70 keV (1/cm) and basis fractions of engine compositions (ct-lab/engine/physics.js)
MU = {'water': 0.1939, 'soft': 0.2017, 'bone': 0.5023, 'shell': 0.2833, 'kernel': 0.1319, 'pith': 0.0679}
COMP = {'air': [0, 0, 0], 'soft': [1.04, 0, 0], 'bone': [0, 1, 0], 'shell': [1.15, 0.12, 0], 'kernel': [0.68, 0, 0], 'pith': [0.35, 0, 0]}


def write(entry, mu, materials):
    """mu: float32 array (nz, ny, nx) in 1/cm. Writes <id>.bin and the manifest entry."""
    mu_max = float(np.percentile(mu[mu > 0], 99.95)) * 1.05
    code = np.clip(np.round(255 * mu / mu_max), 0, 255).astype(np.uint8)
    code.tofile(os.path.join(OUT, entry['id'] + '.bin'))
    nz, ny, nx = code.shape
    anchors = [[0, 'air', COMP['air']]] + sorted(
        [[int(round(255 * MU[m] / mu_max)), m, COMP[m]] for m in materials], key=lambda a: a[0])
    e = dict(entry, kind='volume', file=entry['id'] + '.bin', dims=[nx, ny, nz], muMax=round(mu_max, 5), anchors=anchors)
    path = os.path.join(OUT, 'objects.json')
    man = json.load(open(path)) if os.path.exists(path) else {'objects': []}
    man['objects'] = [o for o in man['objects'] if o['id'] != e['id']]
    # real scans first in the gallery
    man['objects'].insert(0 if entry['id'] == 'walnut' else 1, e)
    json.dump(man, open(path, 'w'), indent=1, ensure_ascii=False)
    open(path, 'a').write('\n')
    print(entry['id'], code.shape, 'muMax', round(mu_max, 4), 'nonzero', round(float((code > 0).mean()), 4))


def rabbit(src):
    a = np.fromfile(src, np.float32).reshape(256, 256, 256)   # (z, y, x): z = body axis, row 0 = top
    a = a.reshape(128, 2, 128, 2, 128, 2).mean((1, 3, 5))
    # the values are about HU + 1000 (soft tissue near 1050, air near 0)
    mu = a * (MU['water'] / 1000.0)
    floor = 0.12 * MU['water']                                # air noise and the outside of the field
    mu = np.where(mu < floor, 0, mu).astype(np.float32)
    # keep the reconstructed field of view only: a cylinder about z, and no edge slices
    yy, xx = np.mgrid[0:128, 0:128] - 63.5
    mu[:, np.hypot(xx, yy) > 0.40 * 128] = 0
    mu[:3] = 0
    mu[-3:] = 0
    write({
        'id': 'rabbit', 'name': 'Rabbit (C-arm CT)', 'widthCm': 25.6,
        'blurb': 'A real cone-beam scan of a post-mortem rabbit: skeleton, lungs, organs, and the table it lay on.',
        'credit': {
            'author': 'RabbitCT: C. Rohkohl, B. Keck, H. G. Hofmann, J. Hornegger, Med Phys 36(9):3940-3944 (2009), doi:10.1118/1.3180956',
            'licence': 'CC-BY-4.0', 'source': 'https://doi.org/10.5281/zenodo.21267885',
            'changes': 'reference_256.vol averaged to 128^3, values below 0.12 of water and the outside of the field-of-view cylinder set to 0, values scaled to mu at 70 keV.'},
    }, mu, ['soft', 'bone'])


def walnut(src):
    v = np.load(src).astype(np.float32)                         # (126 slices, 125, 125), every 4th slice
    v = v[:125]
    # Zenodo slices run along the scanner axis; flip so the stem end is up
    v = v[::-1]
    pos = v[v > 0.002]
    shell_level = float(np.percentile(pos, 97))                 # the dense shell
    mu = v * (MU['shell'] / shell_level)
    mu = np.where(mu < 0.15 * MU['water'], 0, mu).astype(np.float32)
    # crop to a cube around the nut, then pad to 128
    nz = mu.shape[0]
    out = np.zeros((128, 128, 128), np.float32)
    o = (128 - nz) // 2
    out[o:o + nz, o:o + mu.shape[1], o:o + mu.shape[2]] = mu
    write({
        'id': 'walnut', 'name': 'Walnut (real cone-beam CT)', 'widthCm': 5.12,   # 0.1 mm voxels x 4 = 0.4 mm, 128 voxels
        'blurb': 'A real walnut, scanned for a machine-learning data set: shell, kernel and the air between.',
        'credit': {
            'author': 'H. Der Sarkissian, F. Lucka, M. van Eijnatten, G. Colacicco, S. B. Coban, K. J. Batenburg, Sci Data 6, 215 (2019), doi:10.1038/s41597-019-0235-y',
            'licence': 'CC-BY-4.0', 'source': 'https://doi.org/10.5281/zenodo.2686726',
            'changes': 'Every 4th AGD reconstruction slice of Walnut1, 4 x 4 pixel means, scaled so the shell is mu at 70 keV, padded to 128^3.'},
    }, out, ['kernel', 'shell'])


def fetch_walnut(out):
    sys.path.insert(0, HERE)
    from remotezip import RemoteZip
    from PIL import Image
    z = RemoteZip('https://zenodo.org/records/2686726/files/Walnut1.zip?download=1')
    names = sorted(n for n in z.namelist() if n.startswith('Walnut1/Reconstructions/full_AGD_50_'))
    sl = []
    for n in names[::4]:
        a = np.asarray(Image.open(io.BytesIO(z.read(n))), dtype=np.float32)
        sl.append(a[:500, :500].reshape(125, 4, 125, 4).mean((1, 3)))
    np.save(out, np.stack(sl))


def thumbs(_=None):
    """Gallery images data/<id>.jpg (160 x 160): a radiograph-like view, 1 - exp(-k sum mu),
    along y (the front view), in a blue-to-ivory ramp, cropped to the object."""
    from PIL import Image
    man = json.load(open(os.path.join(OUT, 'objects.json')))
    ramp = np.array([[4, 7, 14], [18, 52, 96], [78, 140, 190], [196, 222, 236], [255, 246, 222]], np.float32)
    for o in man['objects']:
        nx, ny, nz = o['dims']
        v = np.fromfile(os.path.join(OUT, o['file']), np.uint8).reshape(nz, ny, nx).astype(np.float32) * (o['muMax'] / 255)
        vox = o['widthCm'] / nx
        if o.get('thumb') == 'slice':                       # a block with an inclusion: show a cut
            p = v[:, ny // 2, :][::-1] * (8 * vox)
        else:
            p = v.sum(axis=1)[::-1] * vox                    # (z, x): line integral along y, top up
        q = np.sort(p[p > 0])
        k = 2.2 / max(1e-6, float(q[int(0.97 * (len(q) - 1))])) if len(q) else 1
        t = 1 - np.exp(-k * p)
        t = np.clip(t ** 0.8, 0, 1)
        ys, xs = np.nonzero(p > 0)
        if len(ys):
            c = max(ys.max() - ys.min(), xs.max() - xs.min()) * 0.56 + 2
            cy, cx = (ys.max() + ys.min()) / 2, (xs.max() + xs.min()) / 2
            y0, y1, x0, x1 = int(max(0, cy - c)), int(min(nz, cy + c)), int(max(0, cx - c)), int(min(nx, cx + c))
            t = t[y0:y1, x0:x1]
        idx = t * (len(ramp) - 1)
        i0 = np.floor(idx).astype(int).clip(0, len(ramp) - 2)
        f = (idx - i0)[..., None]
        rgb = ramp[i0] * (1 - f) + ramp[i0 + 1] * f
        Image.fromarray(rgb.astype(np.uint8)).resize((160, 160), Image.LANCZOS).save(os.path.join(OUT, o['id'] + '.jpg'), quality=84)
        print('thumb', o['id'])


if __name__ == '__main__':
    cmd, arg = sys.argv[1], sys.argv[2]
    {'rabbit': rabbit, 'walnut': walnut, 'fetch-walnut': fetch_walnut, 'thumbs': thumbs}[cmd](arg)
