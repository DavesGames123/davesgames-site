// ============================================================================
//  LINKAGES  ·  scene.js — the parts of each linkage and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one linkage with kit.js and returns sc: { pose(theta),
//  box, keys }. The joints come from mech.js, so the bars that main.js
//  moves are the ones the tests check.
//
//  LAYOUT. Parts are made in the linkage plane: the mech.js point (X, Y)
//  is (X, h, -Y) in the B.root frame, h the height of the layer. B.root
//  turns +90 deg about x, so the linkage stands upright on a backboard: Y
//  is up and the layers come toward the viewer (+z).
//    backboard ........ h -12 .. 0, with a boss at each ground pivot
//    links ............ one layer each, 6 mm thick, every 8 mm from h 4
//    pins ............. a rod through all layers at each moving joint
//    trace ............ a tube along the traced path, in front
//    rail ............. Peaucellier: the straight line, on the backboard
//
//  GREP MAP
//    function bar ............. a link: a slot-ended bar with two holes
//    function build ........... backboard, links, pins, trace, pose
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, circle } from './kit.js';
import { unit, makeLinkage, traceCurve } from './mech.js';

const LAYER = 8, THICK = 6;
const MAT = { crank: 'bronze', arm: 'bronze', coupler: 'steel', rocker: 'gear', longA: 'steel', longB: 'steel', rhCA: 'brass', rhCB: 'brass', rhAP: 'brass', rhBP: 'brass' };
const NAME = {
  fourbar: { crank: 'Crank', coupler: 'Coupler', rocker: 'Rocker' },
  peaucellier: { arm: 'Input arm', longA: 'Long link', longB: 'Long link', rhCA: 'Rhombus link', rhCB: 'Rhombus link', rhAP: 'Rhombus link', rhBP: 'Rhombus link' },
  jansen: { crank: 'Crank', j: 'Upper crank link', kk: 'Lower crank link', b: 'Top rocker', c: 'Lower rocker', d: 'Back link', e: 'Upper triangle link', f: 'Knee link', g: 'Knee link', h: 'Foot link', i: 'Shin' },
};
const INFO = { fourbar: id => id, peaucellier: id => (id.startsWith('rh') ? 'rhombus' : id.startsWith('long') ? 'long' : id), jansen: id => ({ crank: 'crank', j: 'crankLink', kk: 'crankLink', b: 'rocker', c: 'rocker', d: 'frameLink', e: 'frameLink', f: 'knee', g: 'knee', h: 'foot', i: 'foot' }[id]) };

// a bar of length len along local +x from (0, 0), width w, two holes
function bar(len, w, h0) {
  const r = w / 2, s = new THREE.Shape();
  s.moveTo(0, -r); s.lineTo(len, -r); s.absarc(len, 0, r, -Math.PI / 2, Math.PI / 2, false); s.lineTo(0, r); s.absarc(0, 0, r, Math.PI / 2, 3 * Math.PI / 2, false);
  s.holes.push(circle(3.6, 0, 0), circle(3.6, len, 0));
  return slab(s, h0, THICK, 0.6);
}

export function build(B, id) {
  const u = unit(id), L = makeLinkage(u), curve = traceCurve(u, 360);
  B.root.rotation.x = Math.PI / 2;
  // bounds of every joint over a turn
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 72; i++) { const Q = L.pose(i / 72 * Math.PI * 2); for (const k in Q.J) { const [x, y] = Q.J[k]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  L.reset();
  const w = id === 'jansen' ? 12 : 16, m = 30, nL = L.links.length, depth = 4 + nL * LAYER;

  // backboard and ground bosses
  const board = B.part('base', { info: 'base', label: 'Backboard', labelAt: [x1 + m - 30, 0, -(y0 - m + 20)], explode: [0, -50, 0], st: 0, en: 0.5 });
  const bs = new THREE.Shape([[x0 - m, y0 - m], [x1 + m, y0 - m], [x1 + m, y1 + m], [x0 - m, y1 + m]].map(p => new THREE.Vector2(...p)));
  B.mesh(board, slab(bs, -12, 12, 1.2), 'paint');
  const Q0 = L.pose(0);
  for (const g of L.ground) {
    const [gx, gy] = Q0.J[g], t = tube(4, 12, 0, depth, 32); t.translate(gx, 0, -gy); B.mesh(board, t, 'cast');
  }
  if (id === 'jansen') {
    // the fixed frame link from the crank centre to the pivot Z
    const fr = B.part('frame', { info: 'frame', label: 'Frame', labelAt: [0, 0, 0], at: [Q0.J.Z[0], 0, -Q0.J.Z[1]], explode: [0, -20, 0], st: 0, en: 0.5 });
    const len = Math.hypot(Q0.J.O[0] - Q0.J.Z[0], Q0.J.O[1] - Q0.J.Z[1]);
    B.mesh(fr, bar(len, w + 6, 1), 'cast');
    fr.spin(Math.atan2(Q0.J.O[1] - Q0.J.Z[1], Q0.J.O[0] - Q0.J.Z[0]));
  }
  if (id === 'peaucellier') {
    const rail = B.part('rail', { info: 'rail', label: 'Straight line', labelAt: [L.line, 0, -(y1 + 10)], explode: [0, -30, 0], st: 0, en: 0.5 });
    const g = new THREE.BoxGeometry(5, 2, y1 - y0 + 40); g.translate(L.line, 1, -(y0 + y1) / 2); B.mesh(rail, g, 'red');
  }
  // input hub behind the crank (or the arm)
  const inPivot = id === 'peaucellier' ? 'O1' : id === 'jansen' ? 'O' : 'O2';
  const hub = B.part('hub', { info: 'hub', label: 'Input hub', labelAt: [0, 0, 0], at: [Q0.J[inPivot][0], 0, -Q0.J[inPivot][1]], explode: [0, -25, 0], st: 0, en: 0.5 });
  B.mesh(hub, lathe([[[22, 0], [22, 3], [10, 3], [10, 0]]], 48), 'bronze');
  const spoke = new THREE.BoxGeometry(30, 2.4, 4); spoke.translate(10, 1.6, 0); B.mesh(hub, spoke, 'bolt');

  // links
  const parts = L.links.map((l, i) => {
    const h0 = 4 + i * LAYER, nm = NAME[id][l.id];
    const p = B.part('L_' + l.id, { info: INFO[id](l.id), label: i < 3 || id !== 'jansen' ? nm : null, labelAt: [l.len / 2, h0 + THICK, 0], explode: [0, 14 + i * 9, 0], st: 0.05 * i, en: Math.min(1, 0.5 + 0.05 * i) });
    B.mesh(p, bar(l.len, w, h0), MAT[l.id] || (i % 2 ? 'steel' : 'gear'));
    return { l, p };
  });
  // pins at the moving joints and the ground joints
  const names = [...new Set(L.links.flatMap(l => [l.from, l.to]))];
  const pins = names.map(nm => {
    const p = B.part('pin_' + nm, { info: 'pin', explode: [0, 14 + nL * 9, 0], st: 0.4, en: 1 });
    B.mesh(p, rod(3.5, 0, depth + 2, 16), 'bolt');
    B.mesh(p, lathe([[[5.5, depth], [5.5, depth + 3], [0, depth + 3], [0, depth]]], 24), 'bolt');
    return { nm, p };
  });
  // trace and pen
  const tr = B.part('trace', { info: 'trace', label: id === 'peaucellier' ? 'Path of P' : id === 'jansen' ? 'Foot path' : 'Coupler curve', labelAt: [curve[0][0], depth + 6, -curve[0][1]], explode: [0, 20 + nL * 9, 0], st: 0.4, en: 1 });
  // Peaucellier: the arm swings, so P runs up and back down the same line.
  // Tube only the up run (th -90 .. 90 deg); a full turn makes two tubes on
  // one path, and their faces z-fight.
  const run = id === 'peaucellier' ? [...curve.slice(270), ...curve.slice(0, 91)] : curve;
  const cp = new THREE.CatmullRomCurve3(run.map(([x, y]) => new THREE.Vector3(x, depth + 6, -y)), id !== 'peaucellier', 'centripetal');
  B.mesh(tr, new THREE.TubeGeometry(cp, 360, 1.4, 6, id !== 'peaucellier'), 'red', { shadow: false, pick: true });
  const pen = B.part('pen', { info: 'trace', explode: [0, 20 + nL * 9, 0], st: 0.4, en: 1 });
  B.mesh(pen, new THREE.SphereGeometry(5, 20, 12), 'red');

  const hX = Q0.J[inPivot];
  return {
    pose(th) {
      const Q = L.pose(th);
      for (const { l, p } of parts) {
        const a = Q.J[l.from], b = Q.J[l.to];
        p.root.position.set(a[0], 0, -a[1]);
        p.spin(Math.atan2(b[1] - a[1], b[0] - a[0]));
      }
      for (const { nm, p } of pins) p.root.position.set(Q.J[nm][0], 0, -Q.J[nm][1]);
      const T = Q.J[L.trace]; pen.root.position.set(T[0], depth + 6, -T[1]);
      hub.root.position.set(hX[0], 0, -hX[1]); hub.spin(Q.input);
      return Q;
    },
    // world: (X, Y, h) after the turn of B.root
    box: { c: [(x0 + x1) / 2, (y0 + y1) / 2, depth / 2], R: 0.62 * Math.hypot(x1 - x0 + 2 * m, y1 - y0 + 2 * m) },
    keys: { input: [hX[0], hX[1], depth], trace: [curve[0][0], curve[0][1], depth] },
    L, curve, depth,
    // the foot is on the ground below this height (3% of the stride)
    stanceY: Math.min(...curve.map(q => q[1])) + 0.03 * (Math.max(...curve.map(q => q[0])) - Math.min(...curve.map(q => q[0]))),
  };
}
