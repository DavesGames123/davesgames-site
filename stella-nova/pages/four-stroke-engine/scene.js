// ============================================================================
//  FOUR-STROKE ENGINE  ·  scene.js — the 3D parts and their pose
// ────────────────────────────────────────────────────────────────────────────
//  build(B, T) makes every part of one engine with the kit (kit.js) for the
//  valve train T (engine.js TRAINS) and returns sc. sc.pose(θ) sets every
//  moving part from engine.js, so the pistons, rods, crank, cams, valves,
//  rockers and chain all read the same crank angle and stay in step.
//
//  LAYOUT (mm)  crank axis on x at y = 0 · deck y = 219 · cylinder 1 at
//  x = 144 (front) · timing chain at x = 222 · flywheel at x = −220.
//
//  GREP MAP
//    function castings ......... block, gasket, head, cover, pan (cut at z = 0)
//    function bottomEnd ........ crank, flywheel, pulley, pistons, rods
//    function valveTrain ....... cams, valves, springs, buckets or rockers
//    function timingDrive ...... sprockets, chain path and links, guides
//    function chainPath ........ belt round circles: tangents and arcs
//    sc.pose ................... per-frame pose from the crank angle
// ============================================================================
import * as THREE from 'three';
import * as E from './engine.js';
import { shapeOf, exYZ, zy, exXZ, xz, cylX, gearPts } from './kit.js';
const { GEO, D, CYL_X, CYLS, AXIS } = E;

// explode offsets: head stack up, bottom end down, pistons and rods out to +z
const EX = { head: 90, cover: 400, gasket: 45, pan: -270, crank: -150, piston: [0, 70, 240], rod: [0, 10, 240], chain: 150, valve: 70, spring: 115, bucket: 160, cam: 200 };
const KX = { front: 204, chainX: 222 };
const JOURNALS = [192, 96, 0, -96, -192];
const SPRING_L = 34;     // installed length, seat (s = 36) to retainer (s = 70)
const roof = z => GEO.seatY - (Math.abs(z) - GEO.seatZ) * Math.tan(GEO.incline * D);

export function build(B, T) {
  const sc = { T, unit: 1, R: 420, gas: [], sparks: [], movers: {} };
  const axisEx = (side, k, extra = [0, 0, 0]) => [extra[0], EX.head + AXIS.y * k + extra[1], side * AXIS.z * k + extra[2]];
  castings(B, T);
  bottomEnd(B, sc);
  valveTrain(B, T, sc, axisEx);
  timingDrive(B, T, sc);
  ignitionAndGas(B, T, sc);
  sc.toggles = { castings: ['block', 'gasket', 'head', 'cover', 'pan'] };
  sc.focus = { valvetrain: new THREE.Vector3(96, 300, 20), crank: new THREE.Vector3(96, 60, 0) };
  sc.pose = th => pose(B, T, sc, th);
  return sc;
}

// ── castings ────────────────────────────────────────────────────────────────
function castings(B, T) {
  const P = (id, kind, o) => Object.assign(B.part(id, { casting: true, ...o }), { kind });
  // block: the barrel with four bores, the crankcase walls, bulkheads, end plates
  const block = P('block', 'block', { label: 'Cylinder block', labelAt: [-150, 160, -70] });
  const bores = CYLS.map(k => ({ c: [CYL_X[k], 0], r: GEO.bore / 2 }));
  const barrel = exXZ(shapeOf(xz([[-204, -70], [204, -70], [204, 70], [-204, 70]]), bores), GEO.deck - 95, 40);
  B.add(block, barrel, 'iron', { pos: [0, 95, 0] });
  for (const s of [1, -1]) {
    B.add(block, new THREE.BoxGeometry(408, 135, 10), 'iron', { pos: [0, 27.5, s * 95] });
    B.add(block, new THREE.BoxGeometry(408, 10, 30), 'iron', { pos: [0, 90, s * 85] });
  }
  for (const x of JOURNALS) {
    const bh = shapeOf(zy([[-90, -40], [90, -40], [90, 70], [-90, 70]]), [{ c: [0, 0], r: 26 }]);
    B.add(block, exYZ(bh, 16), 'iron', { pos: [x, 0, 0] });
  }
  for (const s of [1, -1]) {
    const ep = shapeOf(zy([[-100, -40], [100, -40], [100, 95], [-100, 95]]), [{ c: [0, 0], r: 26 }]);
    B.add(block, exYZ(ep, 8), 'iron', { pos: [s * 204, 0, 0] });
  }
  // gasket
  const gasket = P('gasket', 'gasket', { ex: [0, EX.gasket, 0], delay: 0.5, label: 'Head gasket', labelAt: [-170, 220, -60] });
  B.add(gasket, exXZ(shapeOf(xz([[-206, -72], [206, -72], [206, 72], [-206, 72]]), CYLS.map(k => ({ c: [CYL_X[k], 0], r: 44.5 }))), 1.2, 40), 'gasket', { pos: [0, GEO.deck, 0] });
  // head: a pent-roof chamber over each bore, bridges between, then the cam saddles
  const head = P('head', 'head', { ex: [0, EX.head, 0], delay: 0.4, label: 'Cylinder head', labelAt: [-190, 250, -70] });
  const y0 = GEO.deck + 1.2, yTop = 262;
  const ch = [];
  for (let i = 0; i <= 24; i++) { const z = -43 + 86 * i / 24; ch.push([z, Math.max(y0, roof(z))]); }
  // bottom left → up over the pent roof → bottom right → top
  const pent = shapeOf(zy([[-80, y0], ...ch, [80, y0], [80, yTop], [-80, yTop]]));
  for (const k of CYLS) B.add(head, exYZ(pent, 86), 'head', { pos: [CYL_X[k], 0, 0] });
  const gaps = [[-206, -187], [-101, -91], [-5, 5], [91, 101], [187, 206]];
  for (const [a, b] of gaps) B.add(head, new THREE.BoxGeometry(b - a, yTop - y0, 160), 'head', { pos: [(a + b) / 2, (y0 + yTop) / 2, 0] });
  if (T.id === 'dohc') {
    for (const side of [1, -1]) {
      const [zc, yc] = T.camPos(side);
      for (const x of JOURNALS) {
        const arc = []; for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16; arc.push([zc + 14 * Math.cos(a), yc - 14 * Math.sin(a)]); }
        const sad = shapeOf(zy([[zc - 20, yTop], [zc + 20, yTop], [zc + 20, yc], ...arc, [zc - 20, yc]]));
        B.add(head, exYZ(sad, 14), 'head', { pos: [x, 0, 0] });
        // the cap above the journal
        const arc2 = []; for (let i = 0; i <= 16; i++) { const a = Math.PI - Math.PI * i / 16; arc2.push([zc + 14 * Math.cos(a), yc + 14 * Math.sin(a)]); }
        const cap = shapeOf(zy([[zc - 20, yc], ...arc2, [zc + 20, yc], [zc + 20, yc + 22], [zc - 20, yc + 22]]));
        B.add(head, exYZ(cap, 14), 'head', { pos: [x, 0, 0] });
      }
    }
  } else {
    const [, yc] = T.camPos(), R = T.rocker;
    for (const x of JOURNALS) {
      const ped = shapeOf(zy([[-38, yTop], [38, yTop], [38, R.pivotY + 12], [-38, R.pivotY + 12]]),
        [{ c: [0, -yc], r: 14 }, { c: [R.pivotZ, -R.pivotY], r: 8 }, { c: [-R.pivotZ, -R.pivotY], r: 8 }].map(h => ({ c: [-h.c[0], -h.c[1]], r: h.r })));
      B.add(head, exYZ(ped, 14), 'head', { pos: [x, 0, 0] });
    }
  }
  // cam cover: a shell over the head, with end plates
  const cover = P('cover', 'cover', { ex: [0, EX.cover, 0], delay: 0, label: 'Cam cover', labelAt: [-120, 390, -60] });
  const outer = [[-92, yTop], [-92, 372], [-72, 394], [72, 394], [92, 372], [92, yTop]];
  const inner = [[86, yTop], [86, 368], [68, 387], [-68, 387], [-86, 368], [-86, yTop]];
  B.add(cover, exYZ(shapeOf(zy([...outer, ...inner])), 404), 'paint');
  const camHoles = (T.id === 'dohc' ? [1, -1].map(s => T.camPos(s)) : [T.camPos()]).map(([z, y]) => ({ c: [-z, y], r: 15 }));
  B.add(cover, exYZ(shapeOf(zy(outer)), 4), 'paint', { pos: [-204, 0, 0] });
  B.add(cover, exYZ(shapeOf(zy(outer), camHoles), 4), 'paint', { pos: [204, 0, 0] });
  // oil pan
  const pan = P('pan', 'pan', { ex: [0, EX.pan, 0], delay: 0, label: 'Oil pan', labelAt: [-150, -110, -60] });
  const po = [[-100, -40], [-100, -104], [-88, -116], [88, -116], [100, -104], [100, -40]];
  const pi = [[94, -40], [94, -101], [85, -110], [-85, -110], [-94, -101], [-94, -40]];
  B.add(pan, exYZ(shapeOf(zy([...po, ...pi])), 408), 'pan');
  for (const s of [1, -1]) B.add(pan, exYZ(shapeOf(zy(po)), 4), 'pan', { pos: [s * 206, 0, 0] });
}

// ── crank, flywheel, pulley, pistons, rods ──────────────────────────────────
function webShape() {
  const pts = [], R = 70, half = 62 * D;
  for (let i = 0; i <= 20; i++) { const a = -Math.PI / 2 - half + 2 * half * i / 20; pts.push([R * Math.cos(a), R * Math.sin(a)]); }
  for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16; pts.push([26 * Math.cos(a), GEO.r + 26 * Math.sin(a)]); }
  // pts run in (z, y); start at the counterweight's left end, end at the boss's left side
  const cw = pts.slice(0, 21), boss = pts.slice(21);
  return shapeOf(zy([...cw, ...boss]));
}
function bottomEnd(B, sc) {
  const crank = Object.assign(B.part('crank', { ex: [0, EX.crank, 0], delay: 0.6, label: 'Crankshaft', labelAt: [0, -40, 40] }), { kind: 'crank' });
  const web = webShape();
  for (const x of JOURNALS) B.add(crank, cylX(25, 24), 'steel', { pos: [x, 0, 0] });
  for (const k of CYLS) {
    const g = new THREE.Group(); g.position.x = CYL_X[k]; if (k === 2 || k === 3) g.rotation.x = Math.PI;
    crank.holder.add(g);
    B.add(crank, cylX(24, 30), 'steel', { parent: g, pos: [0, GEO.r, 0] });
    for (const s of [1, -1]) B.add(crank, exYZ(web, 22, 16), 'forged', { parent: g, pos: [s * 25, 0, 0] });
  }
  B.add(crank, cylX(18, 54), 'steel', { pos: [KX.front + 27, 0, 0] });          // nose
  B.add(crank, cylX(25, 12), 'steel', { pos: [-210, 0, 0] });                  // tail
  B.add(crank, cylX(45, 8), 'forged', { pos: [-214, 0, 0] });                   // flange
  // flywheel with its ring gear
  const fw = Object.assign(B.part('flywheel', { ex: [-120, EX.crank, 0], delay: 0.5, label: 'Flywheel', labelAt: [-232, 110, 60] }), { kind: 'flywheel' });
  B.add(fw, new THREE.LatheGeometry([[0, -8], [128, -8], [130, -6], [130, 6], [100, 8], [60, 9], [44, 9], [0, 9]].map(([r, y]) => new THREE.Vector2(r, y)), 72).rotateZ(Math.PI / 2), 'forged', { pos: [-224, 0, 0] });
  B.add(fw, exYZ(shapeOf(gearPts(110, 133.5, 140.5, 0.4), [{ c: [0, 0], r: 127 }]), 12, 8), 'steel', { pos: [-222, 0, 0] });
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; B.add(fw, cylX(5, 6, 6), 'dark', { pos: [-213, 36 * Math.cos(a), 36 * Math.sin(a)] }); }
  // crank pulley (damper) at the nose
  const dm = Object.assign(B.part('damper', { ex: [60, EX.crank, 0], delay: 0.45, label: 'Crank pulley', labelAt: [252, 50, 30] }), { kind: 'damper' });
  B.add(dm, new THREE.LatheGeometry([[18, -8], [62, -8], [62, -4], [58, -2.5], [62, -1], [62, 1], [58, 2.5], [62, 4], [62, 8], [18, 8]].map(([r, y]) => new THREE.Vector2(r, y)), 64).rotateZ(Math.PI / 2), 'dark', { pos: [246, 0, 0] });
  B.add(dm, cylX(30, 17), 'forged', { pos: [246, 0, 0] });
  sc.movers.crank = [crank, fw, dm];

  // pistons and rods, one per cylinder
  const pistonG = new THREE.LatheGeometry([[0, GEO.compH], [40.6, GEO.compH], [42.6, GEO.compH - 2], [42.6, -GEO.skirt], [38, -GEO.skirt], [38, 15], [0, 15]].map(([r, y]) => new THREE.Vector2(r, y)), 64);
  const ringG = new THREE.LatheGeometry([[42.4, -1], [42.72, -1], [42.72, 1], [42.4, 1]].map(([r, y]) => new THREE.Vector2(r, y)), 64);
  const rodShape = shapeOf(zy([[-13, 22], [13, 22], [8.5, GEO.l - 10], [-8.5, GEO.l - 10]]));
  sc.pistons = {}; sc.rods = {};
  for (const k of CYLS) {
    const p = Object.assign(B.part('piston' + k, { info: 'piston' + k, ex: EX.piston, delay: 0.75, label: k === 1 ? 'Piston' : null, labelAt: [0, GEO.compH, 44] }), { kind: 'piston', cyl: k });
    p.holder.position.x = CYL_X[k];
    B.add(p, pistonG, 'alu');
    for (const y of [GEO.compH - 6, GEO.compH - 11, GEO.compH - 17]) B.add(p, ringG, 'ring', { pos: [0, y, 0], pick: false });
    B.add(p, cylX(11, 70, 24), 'bright');
    for (const s of [1, -1]) B.add(p, cylX(16, 20, 24), 'alu', { pos: [s * 23, 0, 0] });
    sc.pistons[k] = p;
    const r = Object.assign(B.part('rod' + k, { info: 'rod' + k, ex: EX.rod, delay: 0.8, label: k === 1 ? 'Connecting rod' : null, labelAt: [0, 80, 14] }), { kind: 'rod', cyl: k });
    r.holder.position.x = CYL_X[k];
    B.add(r, cylX(33, 24, 40), 'forged');
    B.add(r, exYZ(rodShape, 18), 'forged');
    B.add(r, cylX(13.5, 22, 28), 'forged', { pos: [0, GEO.l, 0] });
    for (const s of [1, -1]) B.add(r, new THREE.CylinderGeometry(4, 4, 30, 10), 'dark', { pos: [0, -12, s * 26] });
    sc.rods[k] = r;
  }
}

// ── valve train ─────────────────────────────────────────────────────────────
function springGeometry() {
  const turns = 5.5, pts = [];
  for (let i = 0; i <= 260; i++) { const t = i / 260, a = t * turns * Math.PI * 2; pts.push(new THREE.Vector3(11.3 * Math.cos(a), SPRING_L * t, 11.3 * Math.sin(a))); }
  const curve = new THREE.CatmullRomCurve3(pts);
  // a tube along a helix at the installed length; the pose scales y as the valve opens
  const g = new THREE.TubeGeometry(curve, 440, 1.55, 8, false);
  return g;
}
function lobeGeometry() {
  const pts = E.lobeOutline(180).map(([a, r]) => [r * Math.sin(a * D), r * Math.cos(a * D)]);
  return exYZ(shapeOf(zy(pts).reverse()), 12, 12);
}
function valveGeometry(rHead, tip) {
  const prof = [[0, 0], [rHead, 0], [rHead, 1.5], [rHead - 2.5, 3.2], [8, 6], [4.5, 11], [3.5, 16], [3.5, tip], [0, tip]];
  return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40);
}
function valveTrain(B, T, sc, axisEx) {
  const springG = springGeometry(), lobeG = lobeGeometry();
  const seatG = new THREE.CylinderGeometry(13, 13, 1.5, 32);
  const retG = new THREE.CylinderGeometry(9, 13, 3.5, 32);
  const keepG = new THREE.CylinderGeometry(4.5, 5.5, 6, 16);
  const bucketG = new THREE.CylinderGeometry(15, 15, 24, 40);
  const tipS = T.id === 'dohc' ? 96 : T.tipS - 1.2;
  const valveG = { in: valveGeometry(T.valves.find(v => v.kind === 'in').rHead, tipS), ex: valveGeometry(T.valves.find(v => v.kind === 'ex').rHead, tipS) };
  sc.valves = [];
  const first = {};
  for (const v of T.valves) {
    const side = v.side, at = [v.x, GEO.seatY, side * GEO.seatZ], rot = side * GEO.incline * D;
    const lab = !first[v.kind] && (first[v.kind] = true);
    const kindV = v.kind === 'in' ? 'valveIn' : 'valveEx';
    const pv = Object.assign(B.part(v.id, { info: v.id, ex: axisEx(side, EX.valve), delay: 0.35, label: lab ? (v.kind === 'in' ? 'Intake valve' : 'Exhaust valve') : null, labelAt: [0, 40, 0] }), { kind: kindV, cyl: v.k });
    pv.holder.position.set(...at); pv.holder.rotation.x = rot;
    const vm = B.add(pv, valveG[v.kind], 'bright');
    const km = B.add(pv, keepG, 'dark', { pos: [0, 73, 0], pick: false });
    const ps = Object.assign(B.part('spring-' + v.id, { info: 'spring-' + v.id, ex: axisEx(side, EX.spring), delay: 0.25, label: lab && v.kind === 'in' ? 'Valve spring' : null, labelAt: [0, 55, 0] }), { kind: 'spring', cyl: v.k });
    ps.holder.position.set(...at); ps.holder.rotation.x = rot;
    B.add(ps, seatG, 'dark', { pos: [0, 35.2, 0] });
    const sm = B.add(ps, springG, 'spring', { pos: [0, 36, 0] });
    const rm = B.add(ps, retG, 'steel', { pos: [0, 71.5, 0] });
    const rec = { v, vm, km, sm, rm };
    if (T.id === 'dohc') {
      const pb = Object.assign(B.part('bucket-' + v.id, { info: 'bucket-' + v.id, ex: axisEx(side, EX.bucket), delay: 0.2, label: lab && v.kind === 'in' ? 'Bucket tappet' : null, labelAt: [0, 98, 0] }), { kind: 'bucket', cyl: v.k });
      pb.holder.position.set(...at); pb.holder.rotation.x = rot;
      rec.bm = B.add(pb, bucketG, 'steel', { pos: [0, 86, 0] });
    }
    sc.valves.push(rec);
  }
  // camshafts
  sc.cams = [];
  const camParts = T.id === 'dohc' ? [['camIn', 1, 'camIn', 'Intake camshaft'], ['camEx', -1, 'camEx', 'Exhaust camshaft']] : [['cam', 0, 'cam', 'Camshaft']];
  for (const [id, side, kind, label] of camParts) {
    const [zc, yc] = T.camPos(side || 1);
    const ex = T.id === 'dohc' ? axisEx(side, EX.cam) : [0, EX.head + EX.cam, 0];
    const pc = Object.assign(B.part(id, { ex, delay: 0.1, label, labelAt: [-150, 0, 0] }), { kind });
    pc.holder.position.set(0, yc, zc);
    B.add(pc, cylX(12, 428, 28), 'steel', { pos: [16, 0, 0] });
    for (const x of JOURNALS) B.add(pc, cylX(13, 14, 32), 'bright', { pos: [x, 0, 0] });
    for (const v of T.valves) {
      if (T.id === 'dohc' && v.side !== side) continue;
      const g = new THREE.Group(); g.rotation.x = v.n0 * D; g.position.x = v.x;
      pc.holder.add(g);
      B.add(pc, lobeG, 'steel', { parent: g });
    }
    // sprocket on the nose
    const ps = Object.assign(B.part(id + 'Sprocket', { ex: [ex[0] + 60, ex[1], ex[2]], delay: 0.1, label: side >= 0 ? 'Cam sprocket' : null, labelAt: [8, 40, 0] }), { kind: 'camSprocket' });
    ps.holder.position.set(KX.chainX, yc, zc);
    B.add(ps, exYZ(shapeOf(gearPts(36, 42.5, 49.5), [0, 1, 2, 3, 4].map(i => ({ c: [26 * Math.cos(i * 1.2566 + 0.3), 26 * Math.sin(i * 1.2566 + 0.3)], r: 9 }))), 8, 10), 'steel');
    B.add(ps, cylX(16, 16, 28), 'forged', { pos: [-4, 0, 0] });
    sc.cams.push(pc, ps);
  }
  // rockers (SOHC)
  sc.rockers = [];
  if (T.id === 'sohc') {
    const R = T.rocker, rise = R.rise;
    const arm = shapeOf(zy([[-R.aIn - 5, -rise], [R.aOut + 5, -rise], [R.aOut + 5, -rise + 9], [10, 7], [10, 11], [-10, 11], [-10, 7], [-R.aIn - 5, -rise + 9]]));
    const armG = exYZ(arm, 11), bossG = cylX(12, 13, 28), padG = new THREE.BoxGeometry(11.5, 2, 10);
    const sh = Object.assign(B.part('rockerShaft', { ex: [0, EX.head + EX.cam + 70, 0], delay: 0.05, label: 'Rocker shafts', labelAt: [-180, R.pivotY, R.pivotZ] }), { kind: 'rockerShaft' });
    for (const s of [1, -1]) B.add(sh, cylX(8, 404, 24), 'bright', { pos: [0, R.pivotY, s * R.pivotZ] });
    let lab = true;
    for (const rec of sc.valves) {
      const v = rec.v, s = v.side;
      const pr = Object.assign(B.part('rocker-' + v.id, { info: 'rocker-' + v.id, ex: [0, EX.head + EX.cam + 70, 0], delay: 0.05, label: lab ? 'Rocker arm' : null, labelAt: [0, 12, 0] }), { kind: 'rocker', cyl: v.k });
      lab = false;
      pr.holder.position.set(v.x, R.pivotY, s * R.pivotZ);
      const g = new THREE.Group(); g.scale.z = s;      // mirror the exhaust rocker to the −z side
      pr.holder.add(g);
      B.add(pr, armG, 'forged', { parent: g });
      B.add(pr, bossG, 'forged', { parent: g });
      B.add(pr, padG, 'dark', { parent: g, pos: [0, -rise + 0.95, -R.aIn] });
      rec.rocker = pr;
      sc.rockers.push(rec);
    }
  }
}

// ── timing drive ────────────────────────────────────────────────────────────
// a belt round circles given in counter-clockwise order in the (z, y) plane
export function chainPath(circles) {
  const n = circles.length, segs = [];
  const tang = (A, Bc) => {
    const dz = Bc.c[0] - A.c[0], dy = Bc.c[1] - A.c[1], d = Math.hypot(dz, dy), ez = dz / d, ey = dy / d;
    const k = (A.r - Bc.r) / d, q = Math.sqrt(1 - k * k);
    const nz = k * ez + q * ey, ny = k * ey - q * ez;     // outward normal on the right of A → B
    return { p0: [A.c[0] + A.r * nz, A.c[1] + A.r * ny], p1: [Bc.c[0] + Bc.r * nz, Bc.c[1] + Bc.r * ny], n: [nz, ny] };
  };
  const t = circles.map((c, i) => tang(c, circles[(i + 1) % n]));
  let L = 0;
  for (let i = 0; i < n; i++) {
    const c = circles[i], tin = t[(i - 1 + n) % n], tout = t[i];
    let a0 = Math.atan2(tin.n[1], tin.n[0]), a1 = Math.atan2(tout.n[1], tout.n[0]);
    let da = a1 - a0; while (da < 0) da += Math.PI * 2;     // counter-clockwise round each circle
    segs.push({ type: 'arc', c: c.c, r: c.r, a0, da, len: Math.abs(da) * c.r, s0: L }); L += Math.abs(da) * c.r;
    const len = Math.hypot(tout.p1[0] - tout.p0[0], tout.p1[1] - tout.p0[1]);
    segs.push({ type: 'line', p0: tout.p0, p1: tout.p1, len, s0: L }); L += len;
  }
  const at = s => {
    s = E.mod(s, L);
    let g = segs[0]; for (const q of segs) if (s >= q.s0) g = q;
    const u = s - g.s0;
    if (g.type === 'arc') {
      const a = g.a0 + Math.sign(g.da) * u / g.r;
      return { z: g.c[0] + g.r * Math.cos(a), y: g.c[1] + g.r * Math.sin(a), tz: Math.sign(g.da) * -Math.sin(a), ty: Math.sign(g.da) * Math.cos(a) };
    }
    const f = u / g.len, dz = (g.p1[0] - g.p0[0]) / g.len, dy = (g.p1[1] - g.p0[1]) / g.len;
    return { z: g.p0[0] + (g.p1[0] - g.p0[0]) * f, y: g.p0[1] + (g.p1[1] - g.p0[1]) * f, tz: dz, ty: dy };
  };
  return { L, segs, at, lines: t };
}
function timingDrive(B, T, sc) {
  const crankC = { c: [0, 0], r: 23 };
  // counter-clockwise in (z, y): crank, intake cam (+z), exhaust cam (−z)
  const circles = T.id === 'dohc' ? [crankC, { c: T.camPos(1), r: 46 }, { c: T.camPos(-1), r: 46 }] : [crankC, { c: T.camPos(), r: 46 }];
  const path = chainPath(circles);
  const N = Math.round(path.L / 8), pitch = path.L / N;
  sc.chain = { path, N, pitch };
  const ch = Object.assign(B.part('chain', { ex: [EX.chain, 0, 0], delay: 0.15, label: 'Timing chain', labelAt: [6, 170, 0] }), { kind: 'chain' });
  const plate = new THREE.BoxGeometry(1.4, 10.5, 5.2);
  const mk = (gap, n) => {
    const a = plate.clone().translate(gap, 0, 0), b = plate.clone().translate(-gap, 0, 0);
    const merged = mergeTwo(a, b);
    return new THREE.InstancedMesh(merged, undefined, n);
  };
  const half = Math.ceil(N / 2);
  const inner = mk(2.9, half), outer = mk(4.5, half);
  const pinG = cylX(1.7, 11.5, 8);
  const pins = new THREE.InstancedMesh(pinG, undefined, N);
  for (const m of [inner, outer, pins]) { m.frustumCulled = false; B.add(ch, m, m === pins ? 'bright' : 'chain'); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
  sc.chain.meshes = { inner, outer, pins };
  ch.holder.position.x = KX.chainX;
  // crank sprocket
  const cs = Object.assign(B.part('crankSprocket', { ex: [60, EX.crank, 0], delay: 0.45, label: 'Crank sprocket', labelAt: [8, -30, 0] }), { kind: 'crankSprocket' });
  cs.holder.position.x = KX.chainX;
  B.add(cs, exYZ(shapeOf(gearPts(18, 19.6, 26)), 8, 8), 'steel');
  sc.movers.crank.push(cs);
  // guides: rails outside the two long straights, and a tensioner shoe
  const gd = Object.assign(B.part('guides', { ex: [EX.chain, 0, 0], delay: 0.15, label: 'Chain guide', labelAt: [0, 0, 0] }), { kind: 'guides' });
  gd.holder.position.x = KX.chainX;
  const longest = path.lines.map((q, i) => ({ q, i, len: Math.hypot(q.p1[0] - q.p0[0], q.p1[1] - q.p0[1]) })).sort((a, b) => b.len - a.len).slice(0, 2);
  for (const { q, len } of longest) {
    const mz = (q.p0[0] + q.p1[0]) / 2 + q.n[0] * 7, my = (q.p0[1] + q.p1[1]) / 2 + q.n[1] * 7;
    const m = B.add(gd, new THREE.BoxGeometry(14, len * 0.62, 6), 'dark', { pos: [0, my, mz] });
    m.rotation.x = Math.atan2(q.p1[0] - q.p0[0], q.p1[1] - q.p0[1]);
    if (!gd.labelSet) { gd.labelAt.set(0, my, mz); gd.labelSet = true; }
  }
}
function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  const ai = a.index.array, bi = b.index.array, na = a.attributes.position.count;
  for (const name of ['position', 'normal', 'uv']) {
    const A = a.attributes[name], Bt = b.attributes[name];
    const arr = new Float32Array(A.array.length + Bt.array.length); arr.set(A.array); arr.set(Bt.array, A.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const idx = new Uint16Array(ai.length + bi.length); idx.set(ai); for (let i = 0; i < bi.length; i++) idx[ai.length + i] = bi[i] + na;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ── spark plugs and the gas in each cylinder ────────────────────────────────
function ignitionAndGas(B, T, sc) {
  const plugG = new THREE.LatheGeometry([[0, -1.5], [1.2, -1.5], [1.2, 0], [7, 0], [7, 19], [10.5, 19], [10.5, 28], [7.5, 28], [6.5, 31], [6.5, 66], [3.5, 68], [3.5, 76], [0, 76]].map(([r, y]) => new THREE.Vector2(r, y)), 6 * 4);
  const ceramic = new THREE.LatheGeometry([[6.4, 31], [6.6, 31], [6.6, 66], [6.4, 66]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
  const gasG = new THREE.CylinderGeometry(42.7, 42.7, 1, 48, 1, false).translate(0, 0.5, 0);
  const sparkG = new THREE.SphereGeometry(5, 16, 12);
  for (const k of CYLS) {
    const p = Object.assign(B.part('plug' + k, { info: 'plug' + k, ex: [0, EX.head + 240, 0], delay: 0.05, label: k === 1 ? 'Spark plug' : null, labelAt: [0, 70, 0] }), { kind: 'plug', cyl: k });
    if (T.id === 'dohc') { p.holder.position.set(CYL_X[k], roof(0) - 1, 0); }
    else { p.holder.position.set(CYL_X[k] + 16, roof(20) - 1, 20); p.holder.rotation.x = 35 * D; }
    B.add(p, plugG, 'steel');
    B.add(p, ceramic, 'ceramic');
    const gp = B.part('gas' + k, {}); gp.holder.position.x = CYL_X[k];
    const gm = B.addGlow(gp, gasG, 0x4aa3ff, 0.3);
    const sm = B.addGlow(p, sparkG, 0xfff2c0, 0);
    sm.material.blending = THREE.AdditiveBlending;
    sc.gas[k] = gm; sc.sparks[k] = sm;
  }
}

// ── pose ────────────────────────────────────────────────────────────────────
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V3 = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), XA = new THREE.Vector3(1, 0, 0);
const GAS_TOP = 224;
function pose(B, T, sc, th) {
  const a = th * D;
  for (const p of sc.movers.crank) p.holder.rotation.x = a;
  for (const k of CYLS) {
    const al = E.crankOf(k, th), x = E.pistonX(al);
    sc.pistons[k].holder.position.y = x;
    const r = sc.rods[k].holder;
    r.position.set(CYL_X[k], GEO.r * Math.cos(al * D), GEO.r * Math.sin(al * D));
    r.rotation.x = -E.rodLean(al);
    const g = sc.gas[k];
    g.position.y = x + GEO.compH; g.scale.y = Math.max(0.1, GAS_TOP - (x + GEO.compH));
  }
  for (const c of sc.cams) c.holder.rotation.x = E.camAngle(th) * D;
  for (const rec of sc.valves) {
    const L = E.valveLift(T, rec.v, th);
    rec.vm.position.y = -L; rec.km.position.y = 73 - L; rec.rm.position.y = 71.5 - L;
    rec.sm.scale.y = (SPRING_L - L) / SPRING_L;
    if (rec.bm) rec.bm.position.y = 86 - L;
    if (rec.rocker) rec.rocker.holder.rotation.x = rec.v.side * E.rockerAngle(T, E.lobeLiftOf(rec.v, th));
  }
  // chain: links move with the crank sprocket's pitch line, clockwise seen from the front
  const C = sc.chain, s0 = -23 * a, mm = C.meshes;
  let ii = 0, io = 0;
  for (let i = 0; i < C.N; i++) {
    const s = s0 + i * C.pitch;
    const pin = C.path.at(s);
    M.compose(V3.set(0, pin.y, pin.z), Q.identity(), S1); mm.pins.setMatrixAt(i, M);
    const nxt = C.path.at(s + C.pitch);
    Q.setFromAxisAngle(XA, Math.atan2(nxt.z - pin.z, nxt.y - pin.y));
    M.compose(V3.set(0, (pin.y + nxt.y) / 2, (pin.z + nxt.z) / 2), Q, S1);
    if (i % 2) { if (io < mm.outer.count) mm.outer.setMatrixAt(io++, M); } else if (ii < mm.inner.count) mm.inner.setMatrixAt(ii++, M);
  }
  mm.inner.count = ii; mm.outer.count = io;
  mm.inner.instanceMatrix.needsUpdate = mm.outer.instanceMatrix.needsUpdate = mm.pins.instanceMatrix.needsUpdate = true;
}
