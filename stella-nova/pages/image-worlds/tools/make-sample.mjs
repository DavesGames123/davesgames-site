// ============================================================================
//  IMAGE WORLDS  ·  tools/make-sample.mjs — build the CC0 sample world
// ────────────────────────────────────────────────────────────────────────────
//  The page ships no World Labs output. To show that the renderer, the
//  meshes and the sound work, it ships one world that this script builds in
//  the image-blaster layout (worlds/sample-still-life/), from CC0 parts only:
//    splats  five Gaussian splats from the DX.GL Multi-View Datasets (CC0,
//            nerfstudio splatfacto, trained on renders of CC0 Poly Haven
//            models), set on a studio sweep that this script makes
//    meshes  three CC0 Poly Haven models (1k glTF, packed to GLB here)
//    sound   an ambient loop and impact sounds, synthesised here (CC0)
//    collider  a floor, the sweep and one box per splat object (GLB)
//  The source image and the thumbnail are renders of the result: the page
//  writes them (see CREDITS.md, "Sample world").
//
//    node tools/make-sample.mjs --dl <dir> --out <worlds/sample-still-life>
//  <dir> holds the DX.GL PLY files (https://dx.gl/splat/<name>.ply) and a
//  polyhaven/ folder with each model's 1k glTF tree. --fetch downloads them.
//
//  COORDINATES. The DX.GL splats are z-up, about 0.6 units across. Each is
//  scaled to a real height, turned to y-up, turned in yaw and placed. The
//  world is then stored in OpenCV axes (x right, y down, z forward), as
//  World Labs stores its SPZ files, so the page loads it with flip_y true,
//  the same path as a real image-blaster world.
//
//  grep -n: "const PIECES", "function sweep", "function synth", "async function main"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readPly, writeSpz, packGlb, gltfToGlb, wav16 } from './formats.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const DL = path.resolve(opt('dl', '.')), OUT = path.resolve(opt('out', 'worlds/sample-still-life'));
const SLUG = 'sample-still-life';

// One seeded generator for every random choice, so a rerun gives the same files.
let seed = 20261006;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

// The splat objects: file, height in metres, yaw (deg), place (x, z) in the
// y-up world. The camera spawn is (0, 1.85, -0.5) looking down -z.
const PIECES = [
  { file: 'modern_arm_chair.ply', name: 'Modern arm chair', h: 0.86, yaw: 0, seat: 0.5, at: [0.05, -2.75], src: 'https://polyhaven.com/a/modern_arm_chair' },
  { file: 'potted_plant.ply', name: 'Potted plant', h: 1.15, yaw: 30, at: [-1.15, -3.15], src: 'https://polyhaven.com/a/potted_plant' },
  { file: 'fire_extinguisher.ply', name: 'Fire extinguisher', h: 0.56, yaw: -20, at: [1.15, -3.0], src: 'https://polyhaven.com/a/korean_fire_extinguisher' },
  { file: 'multi_cleaner_5l.ply', name: 'Multi cleaner 5 L', h: 0.31, yaw: 25, at: [0.85, -2.15], src: 'https://polyhaven.com/a/multi_cleaner_5_litre' },
  { file: 'wet_floor_sign.ply', name: 'Wet floor sign', h: 0.62, yaw: 35, at: [-0.95, -2.05], src: 'https://polyhaven.com/a/wet_floor_sign' },
];
// The CC0 Poly Haven meshes, placed by scene.json. image-blaster draws a
// mesh at 0.5 x scale (OBJECT_SCALE), so scale 2 gives the real size.
const MESHES = [
  { id: 'apple', ph: 'food_apple_01', name: 'Apple', author: 'Oliver Harries', at: [0.05, 1.1, -2.62], sfx: 'thud' },
  { id: 'baseball', ph: 'baseball_01', name: 'Baseball', author: 'Rico Cilliers', at: [-0.35, 0.6, -1.55], sfx: 'knock' },
  { id: 'cardboard-box', ph: 'cardboard_box_01', name: 'Cardboard box', author: 'Rahul Chaudhary', at: [1.75, 0.3, -1.85], sfx: 'box', yaw: 0.5 },
];

// ── quaternions (x, y, z, w) ───────────────────────────────────────────────
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qaxis = (ax, a) => { const s = Math.sin(a / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a / 2)]; };
const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]); return [p[0], p[1], p[2]]; };
const STORE = qaxis([1, 0, 0], Math.PI);   // y-up world -> OpenCV storage

const pct = (arr, p) => { const a = Float32Array.from(arr).sort(); return a[Math.floor(p * (a.length - 1))]; };

function placePiece(pc) {
  const s = readPly(fs.readFileSync(path.join(DL, pc.file)));
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < s.n; i++) { xs.push(s.pos[3 * i]); ys.push(s.pos[3 * i + 1]); zs.push(s.pos[3 * i + 2]); }
  const lo = [pct(xs, 0.004), pct(ys, 0.004), pct(zs, 0.004)], hi = [pct(xs, 0.996), pct(ys, 0.996), pct(zs, 0.996)];
  const k = pc.h / (hi[2] - lo[2]);
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]];
  const Q = qmul(STORE, qmul(qaxis([0, 1, 0], pc.yaw * Math.PI / 180), qaxis([1, 0, 0], -Math.PI / 2)));
  const keep = [];
  const box = [[1e9, 1e9, 1e9], [-1e9, -1e9, -1e9]];
  for (let i = 0; i < s.n; i++) {
    const p = [s.pos[3 * i], s.pos[3 * i + 1], s.pos[3 * i + 2]];
    // Drop the floaters outside the object box and the faint splats that
    // the white training background leaves round the edge.
    const m = 0.02 / k;
    if (p.some((v, j) => v < lo[j] - m || v > hi[j] + m) || s.alpha[i] < 0.06) continue;
    const local = [(p[0] - c[0]) * k, (p[1] - c[1]) * k, (p[2] - c[2]) * k];
    const yUp = qrot(qmul(qaxis([0, 1, 0], pc.yaw * Math.PI / 180), qaxis([1, 0, 0], -Math.PI / 2)), local);
    const w = [yUp[0] + pc.at[0], yUp[1], yUp[2] + pc.at[1]];
    for (let j = 0; j < 3; j++) { box[0][j] = Math.min(box[0][j], w[j]); box[1][j] = Math.max(box[1][j], w[j]); }
    keep.push({
      pos: qrot(STORE, w), dc: [s.dc[3 * i], s.dc[3 * i + 1], s.dc[3 * i + 2]], alpha: s.alpha[i],
      ln: [s.lnScale[3 * i] + Math.log(k), s.lnScale[3 * i + 1] + Math.log(k), s.lnScale[3 * i + 2] + Math.log(k)],
      q: qmul(Q, [s.quat[4 * i], s.quat[4 * i + 1], s.quat[4 * i + 2], s.quat[4 * i + 3]]),
    });
  }
  console.log(pc.file, s.n, '->', keep.length, 'scale', k.toFixed(3));
  return { splats: keep, box, seat: pc.seat || 0 };
}

// ── the studio sweep: floor, a curve of radius R, and a back wall ──────────
// Flat splats (2 mm thick) lie on the surface. The floor is darkened under
// each object (a soft contact shadow) from the object boxes.
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
function sweep(boxes, step = 0.032) {
  const out = [], W = 5, Z0 = 2.4, Z1 = -3.6, R = 1.1, TOP = 3.9;
  const L0 = Z0 - Z1, L1 = Math.PI * R / 2, L2 = TOP - R, L = L0 + L1 + L2;
  const SH = 0.28209479177387814, toDc = c => (c - 0.5) / SH;
  for (let t = 0; t < L; t += step) {
    for (let x = -W; x <= W; x += step) {
      const tj = t + (rnd() - 0.5) * step * 0.8, xj = x + (rnd() - 0.5) * step * 0.8;
      let y, z, ang;
      if (tj < L0) { y = 0; z = Z0 - tj; ang = 0; }
      else if (tj < L0 + L1) { const a = (tj - L0) / R; y = R - R * Math.cos(a); z = Z1 - R * Math.sin(a); ang = a; }
      else { y = R + (tj - L0 - L1); z = Z1 - R; ang = Math.PI / 2; }
      // Warm grey paper; lighter up the wall, a soft vignette to the sides.
      const up = Math.min(1, y / TOP);
      let g = 0.36 + 0.14 * Math.sqrt(up) - 0.12 * Math.min(1, Math.pow(Math.abs(xj) / W, 2.2)) - 0.08 * Math.max(0, (z - 0.5) / Z0);
      g += 0.025 * (vnoise(xj * 1.3, (z - y) * 1.3) - 0.5) + 0.004 * (rnd() - 0.5);
      let ao = 1;
      if (y < 0.05) for (const b of boxes) {
        const cx = (b[0][0] + b[1][0]) / 2, cz = (b[0][2] + b[1][2]) / 2;
        const rx = Math.max(0.12, (b[1][0] - b[0][0]) / 2), rz = Math.max(0.12, (b[1][2] - b[0][2]) / 2);
        const d2 = ((xj - cx) / (rx * 1.25)) ** 2 + ((z - cz) / (rz * 1.25)) ** 2;
        ao *= 1 - 0.42 * Math.exp(-d2 * 1.6);
      }
      g *= ao;
      const col = [g * 1.04, g * 0.99, g * 0.93];
      out.push({
        pos: qrot(STORE, [xj, y, z]), dc: col.map(toDc), alpha: 0.92,
        ln: [Math.log(step * 0.75), Math.log(0.0025), Math.log(step * 0.75)],
        q: qmul(STORE, qaxis([1, 0, 0], ang)),
      });
    }
  }
  console.log('sweep', out.length);
  return out;
}

function toSplats(list) {
  const n = list.length, s = { n, pos: new Float32Array(3 * n), dc: new Float32Array(3 * n), alpha: new Float32Array(n), lnScale: new Float32Array(3 * n), quat: new Float32Array(4 * n) };
  list.forEach((p, i) => { s.pos.set(p.pos, 3 * i); s.dc.set(p.dc, 3 * i); s.alpha[i] = p.alpha; s.lnScale.set(p.ln, 3 * i); s.quat.set(p.q, 4 * i); });
  return s;
}
// A smaller copy for phones: keep a seeded share of the object splats and
// grow each kept splat so the surfaces stay closed. The sweep is made
// again on a coarser grid instead: a random share of a flat sheet leaves
// holes that show the background.
function thin(list, target) {
  const keep = Math.min(1, target / list.length), grow = Math.log(Math.pow(1 / keep, 0.5));
  return list.filter(() => rnd() < keep).map(p => ({ ...p, ln: p.ln[1] < Math.log(0.004) ? [p.ln[0] + grow, p.ln[1], p.ln[2] + grow] : p.ln.map(v => v + grow * 0.66) }));
}

// ── collider GLB (storage axes, as the splat) ─────────────────────────────
function colliderGlb(shapes) {
  const P = [], I = [];
  const quad = (a, b, c, d) => { const o = P.length / 3; for (const v of [a, b, c, d]) P.push(...qrot(STORE, v)); I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  const W = 5, R = 1.1, Z1 = -3.6, segs = 8;
  quad([-W, 0, 2.4], [W, 0, 2.4], [W, 0, Z1], [-W, 0, Z1]);
  for (let i = 0; i < segs; i++) {
    const a0 = i / segs * Math.PI / 2, a1 = (i + 1) / segs * Math.PI / 2;
    const p = a => [R - R * Math.cos(a), Z1 - R * Math.sin(a)];
    const [y0, z0] = p(a0), [y1, z1] = p(a1);
    quad([-W, y0, z0], [W, y0, z0], [W, y1, z1], [-W, y1, z1]);
  }
  quad([-W, R, Z1 - R], [W, R, Z1 - R], [W, 3.9, Z1 - R], [-W, 3.9, Z1 - R]);
  // A chair is two boxes: the seat (seat x height) and the back (the rear
  // quarter, full height), so an object can rest on the seat.
  const parts = [];
  for (const b of shapes) {
    const [lo, hi] = b.box;
    if (!b.seat) { parts.push([lo, hi]); continue; }
    parts.push([lo, [hi[0], lo[1] + b.seat * (hi[1] - lo[1]), hi[2]]]);
    parts.push([lo, [hi[0], hi[1], lo[2] + 0.25 * (hi[2] - lo[2])]]);
  }
  for (const [lo, hi] of parts) {
    const v = (x, y, z) => [x ? hi[0] : lo[0], y ? hi[1] : lo[1], z ? hi[2] : lo[2]];
    quad(v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1));            // top
    quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1));            // +z
    quad(v(1, 0, 0), v(0, 0, 0), v(0, 1, 0), v(1, 1, 0));            // -z
    quad(v(1, 0, 1), v(1, 0, 0), v(1, 1, 0), v(1, 1, 1));            // +x
    quad(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0));            // -x
  }
  const pos = Buffer.from(new Float32Array(P).buffer), idx = Buffer.from(new Uint32Array(I).buffer);
  const mn = [0, 1, 2].map(k => Math.min(...P.filter((_, i) => i % 3 === k))), mx = [0, 1, 2].map(k => Math.max(...P.filter((_, i) => i % 3 === k)));
  const json = {
    asset: { version: '2.0', generator: 'image-worlds make-sample.mjs' },
    scenes: [{ nodes: [0] }], scene: 0, nodes: [{ mesh: 0, name: 'collider' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: pos.length + idx.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 }, { buffer: 0, byteOffset: pos.length, byteLength: idx.length, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min: mn, max: mx }, { bufferView: 1, componentType: 5125, count: I.length, type: 'SCALAR' }],
  };
  return packGlb(json, Buffer.concat([pos, idx]));
}

// ── sound ──────────────────────────────────────────────────────────────────
// A room tone loop (brown noise through a slow low-pass, with a soft air
// band), and short impacts: a damped sum of modes plus a noise click.
const RATE = 44100;
function synth(kind, v) {
  if (kind === 'room') {
    const n = RATE * 12, x = new Float32Array(n);
    let b = 0, lp = 0, hp = 0, air = 0;
    for (let i = 0; i < n; i++) {
      const w = gauss();
      b = 0.995 * b + 0.02 * w; lp += 0.05 * (b - lp);
      hp = 0.6 * hp + 0.4 * w; air += 0.02 * (hp - air);
      const t = i / RATE, swell = 0.75 + 0.25 * Math.sin(2 * Math.PI * t / 6) * Math.sin(2 * Math.PI * t / 4);
      x[i] = (lp * 2.2 + air * 0.35) * swell;
    }
    // Loop: fade the last second into the first.
    const f = RATE;
    for (let i = 0; i < f; i++) { const a = i / f; x[i] = x[i] * a + x[n - f + i] * (1 - a); }
    const y = x.subarray(0, n - f); let pk = 0; for (const s of y) pk = Math.max(pk, Math.abs(s));
    return y.map(s => s / pk * 0.5);
  }
  const P = { thud: { modes: [[110, 0.09], [190, 0.06], [420, 0.03]], click: 0.25, cut: 0.15, len: 0.45 },
    knock: { modes: [[520, 0.05], [890, 0.035], [1630, 0.02]], click: 0.5, cut: 0.45, len: 0.35 },
    box: { modes: [[160, 0.08], [260, 0.05], [620, 0.03]], click: 0.6, cut: 0.25, len: 0.5 } }[kind];
  const n = Math.floor(RATE * P.len), x = new Float32Array(n), detune = 1 + 0.06 * v;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE; let s = 0;
    for (const [f, d] of P.modes) s += Math.sin(2 * Math.PI * f * detune * t) * Math.exp(-t / d);
    lp += P.cut * (gauss() - lp);
    s += P.click * lp * Math.exp(-t / 0.012);
    x[i] = s * Math.min(1, t / 0.0015);
  }
  let pk = 0; for (const s of x) pk = Math.max(pk, Math.abs(s));
  return x.map(s => s / pk * 0.8);
}
function writeMp3(file, samples) {
  const wav = file.replace(/\.mp3$/, '.wav');
  fs.writeFileSync(wav, wav16(samples, RATE));
  execFileSync('lame', ['--quiet', '-m', 'm', '-b', '96', wav, file]);
  fs.unlinkSync(wav);
}

async function fetchTo(url, file) {
  const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

async function main() {
  if (argv.includes('--fetch')) {
    for (const p of PIECES) if (!fs.existsSync(path.join(DL, p.file))) await fetchTo('https://dx.gl/splat/' + p.file, path.join(DL, p.file));
    for (const m of MESHES) {
      const info = await (await fetch('https://api.polyhaven.com/files/' + m.ph)).json();
      const g = info.gltf['1k'].gltf, dir = path.join(DL, 'polyhaven', m.ph);
      await fetchTo(g.url, path.join(dir, m.ph + '.gltf'));
      for (const [rel, f] of Object.entries(g.include)) await fetchTo(f.url, path.join(dir, rel));
      await fetchTo('https://cdn.polyhaven.com/asset_img/thumbs/' + m.ph + '.png?width=256&height=256', path.join(dir, 'thumb.png'));
    }
  }
  const W = d => { const p = path.join(OUT, d); fs.mkdirSync(p, { recursive: true }); return p; };
  // The thumbnail is a page render (see the header): keep it over a rebuild.
  const thumbFile = path.join(OUT, 'output/world/0-world-thumbnail.jpg');
  const thumb = fs.existsSync(thumbFile) ? fs.readFileSync(thumbFile) : null;
  fs.rmSync(path.join(OUT, 'output'), { recursive: true, force: true });

  const placed = PIECES.map(placePiece);
  const boxes = placed.map(p => p.box);
  const shapes = placed.map(p => ({ box: p.box, seat: p.seat }));
  const objs = placed.flatMap(p => p.splats), floor = sweep(boxes);
  const all = objs.concat(floor);
  const wdir = W('output/world');
  fs.writeFileSync(path.join(wdir, '0-world-full_res.spz'), writeSpz(toSplats(all)));
  fs.writeFileSync(path.join(wdir, '0-world-100k.spz'), writeSpz(toSplats(thin(objs, 58000).concat(sweep(boxes, 0.05)))));
  fs.writeFileSync(path.join(wdir, '0-world.glb'), colliderGlb(shapes));
  if (thumb) fs.writeFileSync(thumbFile, thumb);
  fs.writeFileSync(path.join(wdir, '0-world.json'), JSON.stringify({
    world_id: SLUG, display_name: 'Still life (sample)',
    note: 'Made by stella-nova/pages/image-worlds/tools/make-sample.mjs from CC0 parts, not by World Labs. The fields follow a World Labs world record so the page reads it the same way.',
    assets: {
      caption: 'A studio sweep with an arm chair, a potted plant, a fire extinguisher, a cleaner can and a wet floor sign.',
      splats: { spz_urls: { full_res: '0-world-full_res.spz', '100k': '0-world-100k.spz' }, semantics_metadata: { metric_scale_factor: 1, ground_plane_offset: 0, flip_y: true } },
      mesh: { collider_mesh_url: '0-world.glb' },
    },
    world_prompt: null, tags: ['sample', 'cc0'], created_at: '2026-10-06T00:00:00Z',
  }, null, 2) + '\n');

  const sdir = W('output/sfx');
  writeMp3(path.join(sdir, '0-ambient-loop-1.mp3'), synth('room'));
  for (const m of MESHES) {
    const odir = W('output/' + m.id), dir = path.join(DL, 'polyhaven', m.ph);
    const gltf = JSON.parse(fs.readFileSync(path.join(dir, m.ph + '.gltf'), 'utf8'));
    fs.writeFileSync(path.join(odir, '0-' + m.id + '.glb'), await gltfToGlb(gltf, async uri => fs.readFileSync(path.join(dir, decodeURIComponent(uri)))));
    fs.copyFileSync(path.join(dir, 'thumb.png'), path.join(odir, '0-' + m.id + '-thumbnail.png'));
    fs.writeFileSync(path.join(odir, 'object.json'), JSON.stringify({
      object: { id: m.id, name: m.name, description: 'CC0 model ' + m.ph + ' by ' + m.author + ' (Poly Haven), 1k textures.' },
      source: { url: 'https://polyhaven.com/a/' + m.ph, licence: 'CC0 1.0' }, working_dir: 'worlds/' + SLUG + '/output/' + m.id,
    }, null, 2) + '\n');
    const fx = W('output/' + m.id + '/sfx');
    for (let v = 1; v <= 3; v++) writeMp3(path.join(fx, '0-impact-' + m.id + '-' + v + '.mp3'), synth(m.sfx, v - 2));
  }
  fs.writeFileSync(path.join(OUT, 'project.json'), JSON.stringify({ slug: SLUG, display_name: 'Still life (sample)', created_at: '2026-10-06T00:00:00Z', notes: 'CC0 sample world for the Image Worlds page. Not generated by image-blaster or World Labs.' }, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'scene.json'), JSON.stringify({
    version: 1,
    instances: MESHES.map(m => ({ instanceId: m.id, objectId: m.id + '-0', physics: 'rigidbody', position: m.at, rotation: [0, m.yaw || 0, 0], scale: [2, 2, 2] })),
    sun: { intensity: 1.6, rotation: [-0.7, 0.6, 0], environmentIntensity: 0.9 },
  }, null, 2) + '\n');
  console.log('wrote', OUT);
}
main().catch(e => { console.error(e); process.exit(1); });
