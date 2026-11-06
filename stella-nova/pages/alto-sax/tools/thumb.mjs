// ============================================================================
//  ALTO SAX  ·  tools/thumb.mjs — the home thumbnail, no browser
// ----------------------------------------------------------------------------
//  node stella-nova/pages/alto-sax/tools/thumb.mjs [out.jpg]
//  Builds the scene.js model with three.js in node and draws every mesh with
//  a CPU rasteriser: z-buffer, a key light and a fill light, Blinn specular,
//  and a fake studio reflection for metal (a gradient read by the reflected
//  ray). Supersamples 2x, writes a PNG with node:zlib and calls `magick`
//  for the 640 x 400 JPEG, quality 84.
//  Default output: stella-nova/pages/home/thumbs/alto-sax.jpg
//
//  grep -n targets
//    shading .............. "function shade"
//    triangle fill ........ "function tri"
//    PNG writer ........... "function png"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.resolve(here, '../../home/thumbs/alto-sax.jpg');
const THREE = await import(path.resolve(here, '../../../vendor/three@0.160.0/build/three.module.js'));
const M = await import(path.join(here, '..', 'model.js'));
const { buildSax } = await import(path.join(here, '..', 'scene.js'));
const S = buildSax(THREE, M);
const root = S.root;
root.updateMatrixWorld(true);

const box = new THREE.Box3().setFromObject(root), ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
const SS = 2, W = 640 * SS, H = 400 * SS;
const cam = new THREE.PerspectiveCamera(30, W / H, 1, 1e5);
const R = Math.max(size.x, size.y, size.z);
// lay the horn on its side: the camera looks along the axis that the model is thinnest in
const thin = ['x', 'y', 'z'].reduce((a, b) => (size[b] < size[a] ? b : a));
const dir = new THREE.Vector3(); dir[thin] = 1;
const side = new THREE.Vector3(0.35, 0.18, 0.3).add(dir).normalize();
cam.position.copy(ctr).addScaledVector(side, R * 1.4);
cam.up.set(0, 1, 0);
cam.lookAt(ctr);
// roll so that the long axis of the horn runs across the wide frame
const long = ['x', 'y', 'z'].reduce((a, b) => (size[b] > size[a] ? b : a));
if (long === 'y') cam.rotateZ(Math.PI / 2 * 0.85);
cam.updateMatrixWorld(true);
const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

const col = new Float32Array(W * H * 3), zb = new Float32Array(W * H).fill(Infinity);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const t = y / H, r = Math.hypot(x / W - 0.5, (y / H - 0.45) * 0.7);
  const v = 0.05 + 0.07 * Math.max(0, 1 - r * 1.6);
  col.set([v * 0.9, v * 0.85, v * 1.05 - t * 0.01], (y * W + x) * 3);
}
const key = new THREE.Vector3(0.5, 0.8, 0.6).normalize(), fill = new THREE.Vector3(-0.7, 0.2, 0.4).normalize();
const camPos = cam.position;

function shade(mat, n, p) {
  const c = mat.color ? [mat.color.r, mat.color.g, mat.color.b] : [0.8, 0.8, 0.8];
  const metal = mat.metalness ?? 0, rough = mat.roughness ?? 0.5;
  const v = camPos.clone().sub(p).normalize();
  if (n.dot(v) < 0) n = n.clone().negate();
  const lk = Math.max(0, n.dot(key)), lf = Math.max(0, n.dot(fill));
  const refl = n.clone().multiplyScalar(2 * n.dot(v)).sub(v);
  const env = 0.12 + 0.9 * Math.pow(Math.max(0, refl.y * 0.5 + 0.5), 2.2) + 0.5 * Math.pow(Math.max(0, refl.dot(key)), 6);
  const sp = Math.pow(Math.max(0, key.clone().add(v).normalize().dot(n)), 2 / Math.max(0.02, rough * rough) + 2) * (1 - rough) * 2.2;
  return c.map(cc => {
    const diff = cc * (0.1 + 0.85 * lk + 0.3 * lf) * (1 - metal);
    const spec = metal * cc * (env * 1.1 + sp) + (1 - metal) * sp * 0.25;
    return diff + spec;
  });
}
function tri(a, b, c, rgb) {
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
    const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const z = w0 * a[2] + w1 * b[2] + w2 * c[2], i = y * W + x;
    if (z >= zb[i]) continue;
    zb[i] = z; col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
  }
}
let tris = 0;
const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
root.traverse(o => {
  if (!o.isMesh || !o.visible) return;
  const mat = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!mat || mat.visible === false || (mat.transparent && mat.opacity < 0.3)) return;
  const g = o.geometry, pos = g.attributes.position, idx = g.index;
  const n = idx ? idx.count : pos.count;
  const inst = o.isInstancedMesh ? o.count : 1;
  const im = new THREE.Matrix4();
  for (let s = 0; s < inst; s++) {
    const mw = o.matrixWorld.clone();
    if (o.isInstancedMesh) { o.getMatrixAt(s, im); mw.multiply(im); }
    for (let t = 0; t + 2 < n; t += 3) {
      const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
      pa.fromBufferAttribute(pos, ia).applyMatrix4(mw); pb.fromBufferAttribute(pos, ib).applyMatrix4(mw); pc.fromBufferAttribute(pos, ic).applyMatrix4(mw);
      const nrm = pb.clone().sub(pa).cross(pc.clone().sub(pa));
      if (nrm.lengthSq() === 0) continue;
      nrm.normalize();
      const rgb = shade(mat, nrm, pa.clone().add(pb).add(pc).multiplyScalar(1 / 3));
      const sa = pa.clone().applyMatrix4(vp), sb = pb.clone().applyMatrix4(vp), sc = pc.clone().applyMatrix4(vp);
      if (sa.z > 1 || sb.z > 1 || sc.z > 1) continue;
      const scr = q => [(q.x * 0.5 + 0.5) * W, (0.5 - q.y * 0.5) * H, q.z];
      tri(scr(sa), scr(sb), scr(sc), rgb); tris++;
    }
  }
});
const OW = 640, OH = 400, img = Buffer.alloc(OH * (OW * 3 + 1));
const enc = v => Math.round(255 * Math.min(1, Math.pow(v / (1 + v * 0.35) * 1.35, 1 / 2.2)));
for (let y = 0; y < OH; y++) {
  img[y * (OW * 3 + 1)] = 0;
  for (let x = 0; x < OW; x++) for (let k = 0; k < 3; k++) {
    let s = 0; for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += col[((y * SS + dy) * W + x * SS + dx) * 3 + k];
    img[y * (OW * 3 + 1) + 1 + x * 3 + k] = enc(s / (SS * SS));
  }
}
function png(w, h, raw) {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const tmp = OUT.replace(/\.jpg$/, '.tmp.png');
fs.writeFileSync(tmp, png(OW, OH, img));
execFileSync('magick', [tmp, '-quality', '84', OUT]);
fs.unlinkSync(tmp);
console.log(`thumb: ${tris} triangles, size ${size.toArray().map(v => v.toFixed(0)).join(' x ')} (thin ${thin}, long ${long}) -> ${OUT}`);
