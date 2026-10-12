// ============================================================================
//  VIRUS ATLAS  ·  saver-probe.mjs — the framing probe of the screensaver
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/virus-atlas/saver-probe.mjs [pageDir] [seeds]
//  pageDir defaults to this folder; seeds is a list like 7,2024,99.
//  No browser, no WebGL. The probe runs saver.js on a stub of main.js
//  (real bead data, three.js r160 maths) at 30 fps for 4 min per seed and
//  for three frames: 1280 x 800, 1920 x 1080 and 9:16 1080 x 1920.
//
//  PLATE MODEL  plateModel(frame, info) estimates the clear band from the
//  CSS of lib/screensaver.js (#sn-saver-label: font clamps, margins, the
//  30ch title, 34em params and 32em notes) and the plate payload of the
//  shot, then applies lib/saver-clear.js bandFloor. It is an estimate:
//  char width 0.5 em, one line per TeX equation.
//
//  SUBJECT  every unit (one chain of one copy) is a ball: its centroid
//  plus the offset that glsl.js unitMove gives it (the tour table from
//  part.setSel, exT, lift, away, ghost and fade; the classic explode as a
//  radial push), and the bead radius of its chain. A unit drawn below
//  0.25 of its size does not count. In an inspection the subject is the
//  lifted region only.
//
//  PER SHOT  fill (subject height / band height), over (px of subject
//  outside the band, top, bottom or sides), inside (camera inside the
//  particle radius), orbit and look speed (deg/s), zoom rate (|d ln
//  dist / dt|, 1/s), plate changes inside the shot, tick time (ms).
//
//  grep -n targets: "function plateModel", "function makeStub",
//    "function subjectBox", "function runOnce", "function report"
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(process.argv[2] || HERE);
const SEEDS = (process.argv[3] || '7,2024,99').split(',').map(Number);
const MIN = +(process.env.PROBE_MIN || 4);
const imp = f => import(pathToFileURL(join(DIR, f)).href);
const threeURL = pathToFileURL(resolve(DIR, '../../vendor/three@0.160.0/build/three.module.js')).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true }; return n(s, c); }`));
const THREE = await import(threeURL);
globalThis.window = globalThis;
globalThis.document = { documentElement: { classList: { add() {}, remove() {} } } };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const F = await imp('format.js'), S = await imp('symmetry.js'), C = await imp('catalog.js'), RG = await imp('regions.js');
const { installSaver } = await imp('saver.js');

// ── data ─────────────────────────────────────────────────────────────────
const D = {};
for (const id of new Set(C.ENTRIES.flatMap(C.pdbsOf))) {
  const raw = readFileSync(join(DIR, 'data', id.toLowerCase() + '.bin'));
  D[id] = F.decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
}

// ── the plate model (lib/screensaver.js CSS) ─────────────────────────────
const clamp = (lo, v, hi) => Math.max(lo, Math.min(v, hi));
const FRAMES = [
  { label: '1280x800', w: 1280, h: 800, vert: false },
  { label: '1920x1080', w: 1920, h: 1080, vert: false },
  { label: '1080x1920 9:16', w: 1080, h: 1920, vert: true },
];
export function plateModel(fr, info) {
  const fw = fr.vert ? Math.min(fr.w, 0.5625 * fr.h) : fr.w, fh = fr.h;
  const fs = fr.vert ? Math.min(fw, fh * 0.8) : Math.min(fw * 0.75, fh * 0.6);
  const padT = fr.vert ? Math.max(0.08 * fh, 14) : Math.max(clamp(Math.min(22, fh * 0.045), fs * 0.075, 96), 14);
  const padB = Math.max(clamp(Math.min(18, fh * 0.04), fs * 0.05, 64), 14);
  const side = Math.max(clamp(16, fs * 0.06, 80), 12), col = fw - 2 * side;
  const f = (lo, k, hi, lo2) => clamp(Math.min(lo, fh * lo2), fs * k, hi);
  const cat = f(9, 0.017, 14, 0.02), ttl = f(28, 0.082, 84, 0.052), rule = f(14, 0.03, 26, 0.028), sub = f(14, 0.032, 28, 0.031);
  const pp = f(13, 0.026, 21, 0.03), eq = f(17, 0.036, 30, 0.036), nt = f(12, 0.024, 19, 0.028), mk = f(20, 0.052, 44, 0.037);
  const lines = (s, px, maxW) => s ? Math.max(1, Math.ceil(String(s).length * 0.5 * px / Math.max(40, maxW))) : 0;
  if (!info) return null;
  let top = padT + cat * 2.1;
  top += lines(info.title, ttl, Math.min(col, 30 * ttl * 0.5)) * ttl * 1.04;
  top += rule * 1.8 + 1;
  top += lines(info.sub, sub, Math.min(col, 30 * sub)) * sub * 1.3;
  top += mk * 1.3 + mk * 2.1 + 4;
  let bot = padB;
  const tex = info.tex || [];
  if (tex.length) bot += eq + tex.length * eq * 1.35 + (tex.length - 1) * 0.6 * eq;
  const params = info.params || [];
  if (params.length) {
    const maxW = Math.min(col, 34 * pp);
    let rows = 1, x = 0;
    for (const p of params) {
      const wv = Math.max(String(p.value).length * 0.5 * pp, String(p.name).length * 0.56 * pp * 0.75) + 1.5 * pp;
      if (x > 0 && x + wv > maxW) { rows++; x = 0; }
      x += wv;
    }
    bot += pp + rows * (pp * 1.4 + 0.3 * pp + 0.56 * pp * 1.2) + (rows - 1) * 0.7 * pp;
  }
  const notes = (info.lines || []).join(' ');
  if (notes) bot += 0.9 * nt + lines(notes, nt, Math.min(col, 32 * nt)) * nt * 1.4;
  const t = top + 14, b = bot + 14, room = fh * 0.7;
  if (t + b <= room) return { t, b };
  const k = room / (t + b);
  return { t: t * k, b: b * k };
}

// ── unit balls of an entry ───────────────────────────────────────────────
function chainRadii(d, cent0) {
  const nc = d.info.chains.length, r = new Float32Array(nc);
  for (let i = 0; i < d.n; i++) {
    const c = d.chain[i], dx = d.pos[3 * i] - cent0[3 * c], dy = d.pos[3 * i + 1] - cent0[3 * c + 1], dz = d.pos[3 * i + 2] - cent0[3 * c + 2];
    r[c] = Math.max(r[c], Math.hypot(dx, dy, dz));
  }
  return r;
}
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
// 14 hull beads per chain (the extremes along the 3 axes and 8 diagonals),
// placed by every copy: the rest positions of the outline of each unit
const DIRS14 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], ...[[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]]];
function restPoints(d, ops, cent0) {
  const nc = d.info.chains.length, m = ops.length / 12, best = new Int32Array(nc * 14).fill(-1), bv = new Float64Array(nc * 14).fill(-Infinity);
  for (let i = 0; i < d.n; i++) {
    const c = d.chain[i], x = d.pos[3 * i] - cent0[3 * c], y = d.pos[3 * i + 1] - cent0[3 * c + 1], z = d.pos[3 * i + 2] - cent0[3 * c + 2];
    for (let j = 0; j < 14; j++) { const v = x * DIRS14[j][0] + y * DIRS14[j][1] + z * DIRS14[j][2]; if (v > bv[14 * c + j]) { bv[14 * c + j] = v; best[14 * c + j] = i; } }
  }
  const out = new Float32Array(m * nc * 14 * 3);
  for (let k = 0; k < m; k++) for (let c = 0; c < nc; c++) for (let j = 0; j < 14; j++) {
    const i = best[14 * c + j], o = 12 * k, q = 3 * (14 * (k * nc + c) + j);
    if (i < 0) continue;
    const x = d.pos[3 * i], y = d.pos[3 * i + 1], z = d.pos[3 * i + 2];
    out[q] = ops[o] * x + ops[o + 1] * y + ops[o + 2] * z + ops[o + 3];
    out[q + 1] = ops[o + 4] * x + ops[o + 5] * y + ops[o + 6] * z + ops[o + 7];
    out[q + 2] = ops[o + 8] * x + ops[o + 9] * y + ops[o + 10] * z + ops[o + 11];
  }
  return out;
}

// ── the stub of main.js ──────────────────────────────────────────────────
function makeStub(fr) {
  const camera = new THREE.PerspectiveCamera(32, fr.w / fr.h, 0.1, 5000);
  const occ = { l: 0, r: 0, t: 0, b: 0 };
  const G = { key: 'polio', color: 'auto', axes: false, orbit: true, breathe: true, sway: true, mode: 'entry', rep: 'auto', pal: 'atlas' };
  const A = { asm: 1, explode: 0, explodeT: 0, peel: 0, peelT: 0, slice: 0, sliceT: 0, peelN: new THREE.Vector3(0, 0, 1), sliceN: new THREE.Vector3(0, 0, 1), hiK: -1, camLock: false, tour: null, peelMode: 0, peelReach: 0.5, exOrder: 0, slab: 0, spiral: 5, W: {} };
  const st = { cur: null, hooks: [], built: {}, shows: [], preloads: [], loaded: new Set(), backdrop: null, light: null };
  const fit = r => RG.fitDistance(r, { w: fr.w, h: fr.h, occ, fov: 32 });
  function build(key) {
    const e = C.entryByKey(key);
    const mk = (d, ops) => {
      const axes = d.info.sym.type === 'icosa' ? S.axesOf(ops) : [], nc = d.info.chains.length, m = ops.length / 12;
      const cent = S.unitCentroids(d, ops), cent0 = S.unitCentroids(d, IDENT), rad = chainRadii(d, cent0), pts = restPoints(d, ops, cent0);
      const p = { d, ops, axes, m, nc, cent, rad, pts, U: nc * m, sel: null, uniforms: { uFade: { value: 1 } }, mesh: { visible: true },
        setSel(t) { p.sel = t; }, setRepWeights() {} };
      return p;
    };
    let parts, r, size;
    if (e.look === 'virion') {
      const env = S.envelopeOps({ R: e.membrane.r, tilt: e.tilt || 0, parts: e.parts.map(p => ({ count: p.count, stalk: p.stalk, base: D[p.pdb].info.anchor.base / 10 })) }, S.makeRng(11).next);
      parts = e.parts.map((p, i) => mk(D[p.pdb], env.ops[i]));
      r = e.membrane.r + 20; size = 2 * r;
    } else {
      const d = D[e.pdb], ops = F.copyOps(d.info, e.layers);
      parts = [mk(d, ops)];
      const b = S.bounds(d, ops, Math.max(1, Math.floor(d.n * ops.length / 12 / 20000)));
      r = b.r; size = Math.max(...b.size);
      parts.bounds = b;
    }
    return { entry: e, parts, r, size, bounds: parts.bounds, axes: parts[0].axes, kind: e.look === 'rod' ? 'helix' : 'icosa', offset: [0, 0, 0], membrane: e.membrane ? { mesh: { visible: true, scale: { setScalar() {} } } } : null };
  }
  const app = {
    G, A, V: { camera, renderer: { domElement: {} } }, controls: { target: new THREE.Vector3() }, occ, size: () => ({ w: fr.w, h: fr.h }),
    REP_LABEL: { beads: 'Beads', space: 'Space-filling', tube: 'Backbone tube', blob: 'Subunit blobs', cage: 'Lattice cage', glow: 'Glow points', toon: 'Outline (toon)' },
    get cur() { return st.cur; },
    async show(key, opt = {}) {
      G.key = key; G.mode = 'entry';
      st.shows.push({ key, t: st.now, preloaded: st.loaded.has(key) });
      st.loaded.add(key);
      const B = st.built[key] || (st.built[key] = build(key));
      B._tour = null;
      st.cur = B;
      A.explode = A.explodeT = 0; A.peel = A.peelT = 0; A.slice = A.sliceT = 0;
      B.parts.forEach(p => { p.sel = null; });
      camera.position.set(0.35, 0.3, 1).normalize().multiplyScalar(fit(B.r)); app.controls.target.set(0, 0, 0); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0);
      return B;
    },
    async preload(key) { st.preloads.push({ key, t: st.now }); st.loaded.add(key); },
    async enterLadder() { G.mode = 'ladder'; st.cur = null; },
    fitDistance: fit, setRep() {}, applyLook() {}, setPalette(k) { G.pal = k; }, setLight(k) { st.light = k; }, startAssembly() { A.asm = 0; },
    setBackdrop(o) { st.backdrop = o; },
    setPeel(on) { A.peelT = on ? 1 : 0; }, setSlice(on) { A.sliceT = on ? 1 : 0; }, setExplode(on) { A.explodeT = on ? 1 : 0; },
    addHook(f) { st.hooks.push(f); }, removeHook(f) { st.hooks = st.hooks.filter(x => x !== f); }, setBand() {},
    repFor: () => 'space', effRep: () => 'space',
  };
  return { app, camera, occ, G, A, st };
}

// ── the subject on screen ────────────────────────────────────────────────
const _v = new THREE.Vector3();
function subjectBox(stub, fr, onlySel) {
  const { st, A, camera } = stub, B = st.cur;
  if (!B) return null;
  const T = A.tour, R = B.r, k = (fr.h / 2) / Math.tan(16 * Math.PI / 180);
  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity, n = 0, nearClip = 0;
  const camPos = camera.position, fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  for (const p of B.parts) {
    const t = T ? p.sel : null;
    for (let u = 0; u < p.U; u += p.U > 3000 ? 2 : 1) {
      const c = u % p.nc;
      let x = p.cent[3 * u], y = p.cent[3 * u + 1], z = p.cent[3 * u + 2], scale = 1, sel = 0;
      if (T && t) {
        const ex = S.easeInOut((T.exT - t.keys[u] * Math.min(0.95, T.exStag)) / (1 - Math.min(0.95, T.exStag)));
        const a = T.exAmp * R * ex;
        sel = t.sel[u] ? 1 : 0;
        x += t.dirs[3 * u] * a; y += t.dirs[3 * u + 1] * a; z += t.dirs[3 * u + 2] * a;
        x += sel * T.liftDir.x * T.lift + (1 - sel) * t.away[3 * u] * T.away;
        y += sel * T.liftDir.y * T.lift + (1 - sel) * t.away[3 * u + 1] * T.away;
        z += sel * T.liftDir.z * T.lift + (1 - sel) * t.away[3 * u + 2] * T.away;
        const gIso = (1 - sel) * T.iso;
        scale = 1 + (T.ghost - 1) * gIso;
        if (T.fade) scale *= 1 - T.fade * Math.min(1, Math.max(0, (ex - 0.55) / 0.45)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (ex - 0.55) / 0.45)));
      } else if (A.explode > 0.002) {
        const l = Math.hypot(x, y, z) || 1, a = A.explode * R * 0.45;
        x += x / l * a; y += y / l * a; z += z / l * a;
      }
      if (onlySel && !sel) continue;
      if (scale < 0.25) continue;
      // the hull beads of the unit, moved with it (scaled about its centre)
      const ox = x - p.cent[3 * u], oy = y - p.cent[3 * u + 1], oz = z - p.cent[3 * u + 2];
      let clip = false;
      for (let j = 0; j < 14; j++) {
        const q = 3 * (14 * u + j);
        const px = p.cent[3 * u] + (p.pts[q] - p.cent[3 * u]) * scale + ox, py = p.cent[3 * u + 1] + (p.pts[q + 1] - p.cent[3 * u + 1]) * scale + oy, pz = p.cent[3 * u + 2] + (p.pts[q + 2] - p.cent[3 * u + 2]) * scale + oz;
        _v.set(px, py, pz);
        const depth = (px - camPos.x) * fwd.x + (py - camPos.y) * fwd.y + (pz - camPos.z) * fwd.z;
        if (depth < camera.near + 0.3) { clip = true; continue; }
        _v.project(camera);
        const sx = (_v.x + 1) / 2 * fr.w, sy = (1 - _v.y) / 2 * fr.h;
        y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
      }
      if (clip) nearClip++;
      n++;
    }
  }
  return n ? { y0, y1, x0, x1, n, nearClip } : { n: 0, nearClip };
}

// ── one run ──────────────────────────────────────────────────────────────
async function runOnce(fr, seed) {
  const stub = makeStub(fr), { app, camera, occ, A, st } = stub;
  delete window.snSaver;
  installSaver(app);
  let info = null, plateN = 0;
  const shots = [];
  let cur = null;
  const dt = 1 / 30, frames = Math.round(MIN * 60 * 30);
  st.now = 0;
  // a plate change counts inside a shot only when the beat is the same
  // as at the last plate (a new plate at a cut is not a change)
  let plateBeat = null, plateKey = null;
  window.snSaver.enter({ seed, calm: 0.6, label: x => {
    if (!x) return;
    const key = JSON.stringify({ ...x, anchor: 0 }), d = window.snSaver.debug(), beat = d ? d.kind + d.entry + (d.beat != null ? d.beat : d.t > 0.05 ? '' : Math.random()) : null;
    if (beat != null && beat === plateBeat && key !== plateKey && cur) cur.plateChanges++;
    plateBeat = beat; plateKey = key; info = x; plateN++;
  } });
  let prevDir = null, prevFwd = null, prevDist = null;
  for (let f = 0; f < frames; f++) {
    st.now = f * dt;
    await new Promise(r => setImmediate(r));
    const band = plateModel(fr, info) || { t: 0, b: 0 };
    occ.t = band.t; occ.b = band.b;
    camera.setViewOffset(fr.w, fr.h, -(occ.l - occ.r) / 2, -(occ.t - occ.b) / 2, fr.w, fr.h);
    camera.updateProjectionMatrix();
    const t0 = performance.now();
    for (const h of st.hooks) h(dt);
    const tickMs = performance.now() - t0;
    const k = 1 - Math.exp(-dt * 4);
    A.explode += (A.explodeT - A.explode) * k;
    if (A.asm < 1) A.asm = Math.min(1, A.asm + dt / 4);
    // main.js frameScale: near and far follow the camera distance
    if (st.cur) { const dd = camera.position.distanceTo(app.controls.target), rr = st.cur.r; camera.near = Math.max(0.05, (dd - rr * 1.6) * 0.5, dd * 0.01); camera.far = dd + rr * 6 + 50; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    const dbg = window.snSaver.debug();
    if (!dbg) continue;
    const id = dbg.kind + '|' + dbg.entry + '|' + (dbg.beat != null ? dbg.beat : '') + '|' + (shots.length ? '' : '');
    if (!cur || dbg.t < cur.lastT - 1e-6 || cur.id !== id) {
      cur = { id, kind: dbg.kind, entry: dbg.entry, look: [dbg.rep, dbg.scheme, dbg.pal, typeof dbg.light === 'string' ? dbg.light : (dbg.light && dbg.light.id) || ''].join('/'), dur: dbg.dur, frames: 0, fill: [], over: 0, overTop: 0, overBot: 0, overSide: 0, inside: 0, nearClip: 0, orbit: 0, look2: 0, zoom: 0, plateChanges: 0, plateKey: null, tick: 0, empty: 0, startT: st.now };
      shots.push(cur); prevDir = prevFwd = prevDist = null;
    }
    cur.lastT = dbg.t; cur.frames++;
    cur.tick = Math.max(cur.tick, tickMs);
    const tgt = app.controls.target, dir = camera.position.clone().sub(tgt), dist = dir.length(); dir.normalize();
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    if (prevDir && dbg.t > 0.2) {
      cur.orbit = Math.max(cur.orbit, Math.acos(Math.min(1, dir.dot(prevDir))) * 180 / Math.PI / dt);
      cur.look2 = Math.max(cur.look2, Math.acos(Math.min(1, fwd.dot(prevFwd))) * 180 / Math.PI / dt);
      cur.zoom = Math.max(cur.zoom, Math.abs(Math.log(dist / prevDist)) / dt);
    }
    prevDir = dir; prevFwd = fwd; prevDist = dist;
    // inside the particle: within 0.9 R of the centre, or inside the box of
    // a long subject (rod, cone)
    if (st.cur && dbg.kind !== 'ladder') {
      const B = st.cur, p = camera.position, long = (B.entry.look === 'rod' || B.entry.look === 'cone') && B.bounds;
      const inBox = long ? Math.hypot(p.x, p.z) < 0.9 * Math.max(B.bounds.size[0], B.bounds.size[2]) / 2 && Math.abs(p.y) < 0.9 * B.bounds.size[1] / 2 : p.length() < 0.9 * B.r;
      if (inBox) cur.inside++;
    }
    if (f % 3 === 0 && st.cur && dbg.ready !== false) {
      const isInspect = dbg.kind === 'inspect' && A.tour && A.tour.iso > 0.5;
      const box = subjectBox(stub, fr, isInspect);
      if (box) {
        cur.nearClip += box.nearClip ? 1 : 0;
        if (box.n) {
          const bandH = fr.h - occ.t - occ.b;
          cur.fill.push((box.y1 - box.y0) / bandH);
          const top = occ.t - box.y0, bot = box.y1 - (fr.h - occ.b), side = Math.max(-box.x0, box.x1 - fr.w);
          cur.overTop = Math.max(cur.overTop, top); cur.overBot = Math.max(cur.overBot, bot); cur.overSide = Math.max(cur.overSide, side);
          cur.over = Math.max(cur.over, top, bot, side);
          if (process.env.PROBE_TRACE && dbg.entry === process.env.PROBE_TRACE && Math.max(top, bot, side) > 8) console.log('    trace ' + dbg.kind + ' u ' + (dbg.t / dbg.dur).toFixed(2) + ' top ' + f1(top) + ' bot ' + f1(bot) + ' side ' + f1(side) + ' n ' + box.n + ' iso ' + (A.tour ? f2(A.tour.iso) : '-') + ' exT ' + (A.tour ? f2(A.tour.exT) : '-'));
        } else cur.empty++;
      }
    }
  }
  const shows = st.shows.slice();
  window.snSaver.exit();
  return { shots, shows, preloads: st.preloads, plateN };
}

// ── the report ───────────────────────────────────────────────────────────
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mx = a => a.length ? Math.max(...a) : NaN;
const f1 = v => Number.isFinite(v) ? v.toFixed(1) : '-';
const f2 = v => Number.isFinite(v) ? v.toFixed(2) : '-';
function report(fr, runs) {
  const all = runs.flatMap(r => r.shots).filter(s => s.frames > 20);
  const byKind = {};
  for (const s of all) (byKind[s.kind] = byKind[s.kind] || []).push(s);
  const band = plateModel(fr, { title: 'Human adenovirus 5', sub: 'assembles from its parts along its 5-fold axes', params: [1, 2, 3, 4, 5].map(i => ({ name: 'param', value: 'value ' + i })), tex: ['T'], lines: ['A short note.'] });
  console.log('\n' + fr.label + '  (typical band ' + (fr.h - band.t - band.b).toFixed(0) + ' px of ' + fr.h + ')');
  console.log('  kind        n  dur s  fill med  fill max  over>8px  over max  inside  orbit deg/s  look deg/s  zoom 1/s  plate chg  tick ms');
  for (const [k, ss] of Object.entries(byKind).sort()) {
    const fills = ss.flatMap(s => s.fill);
    console.log('  ' + k.padEnd(9) + String(ss.length).padStart(4) + f1(ss.reduce((a, s) => a + s.frames / 30, 0) / ss.length).padStart(7) +
      f2(med(fills)).padStart(10) + f2(mx(fills)).padStart(10) + String(ss.filter(s => s.over > 8).length).padStart(10) + f1(mx(ss.map(s => s.over))).padStart(10) +
      String(ss.filter(s => s.inside > 3).length).padStart(8) + f1(med(ss.map(s => s.orbit))).padStart(7) + '/' + f1(mx(ss.map(s => s.orbit))).padEnd(6) +
      f1(med(ss.map(s => s.look2))).padStart(6) + '/' + f1(mx(ss.map(s => s.look2))).padEnd(6) + f2(mx(ss.map(s => s.zoom))).padStart(7) +
      String(ss.reduce((a, s) => a + s.plateChanges, 0)).padStart(10) + f1(mx(ss.map(s => s.tick))).padStart(9));
  }
  if (process.env.PROBE_DETAIL) for (const s of all.filter(x => x.over > 8).sort((p, q) => q.over - p.over).slice(0, +process.env.PROBE_DETAIL)) {
    console.log('    worst ' + s.kind + ' ' + s.entry + ' over ' + f1(s.over) + ' (top ' + f1(s.overTop) + ', bottom ' + f1(s.overBot) + ', side ' + f1(s.overSide) + ') fill max ' + f2(mx(s.fill)) + ' inside ' + s.inside + ' zoom ' + f2(s.zoom));
  }
  const fills = all.flatMap(s => s.fill);
  const over = all.filter(s => s.over > 8).length;
  const looks = new Set(all.map(s => s.look)).size;
  const shows = runs.flatMap(r => r.shows);
  const pre = shows.filter(s => s.preloaded).length;
  let entRep = 0;
  for (const r of runs) for (let i = 1; i < r.shows.length; i++) if (r.shows[i].key === r.shows[i - 1].key) entRep++;
  console.log('  ALL ' + all.length + ' shots: fill median ' + f2(med(fills)) + ', ' + over + ' shots (' + (100 * over / all.length).toFixed(0) + ' %) put the subject > 8 px outside the band, ' +
    all.filter(s => s.inside > 3).length + ' put the camera inside the particle, ' + all.filter(s => s.orbit > 20 || s.look2 > 20).length + ' turn faster than 20 deg/s, ' +
    all.filter(s => s.zoom > 0.6).length + ' zoom faster than 0.6/s, ' + all.reduce((a, s) => a + s.plateChanges, 0) + ' plate changes inside shots, ' + looks + ' looks, ' +
    shows.length + ' loads (' + pre + ' preloaded, ' + entRep + ' same entry twice)');
  return { all, fills, over };
}

console.log('saver probe: ' + DIR + '  seeds ' + SEEDS.join(',') + ', ' + MIN + ' min each');
for (const fr of FRAMES) {
  const runs = [];
  for (const seed of SEEDS) runs.push(await runOnce(fr, seed));
  report(fr, runs);
  if (fr === FRAMES[0]) {
    const seq = runs[0].shots.filter(s => s.frames > 20).slice(0, 14).map(s => s.kind + ':' + s.entry).join(' ');
    console.log('  seed ' + SEEDS[0] + ' first shots: ' + seq);
  }
}
