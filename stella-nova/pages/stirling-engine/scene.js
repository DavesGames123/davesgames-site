// ============================================================================
//  STIRLING ENGINE  ·  scene.js — the 3D parts of one engine, and their pose
// ────────────────────────────────────────────────────────────────────────────
//  build(B, E) makes every part of engine E (engine.js) with the builder B
//  (kit.js) and returns:
//    pose(k) ......... moves the crank, rods, pistons and displacer to the
//                      kinematic state k = E.kin(theta, alpha)
//    setPhase(al) .... turns the displacer crank pin to the phase angle
//    gasMap .......... for each gas space id: (f, u, v, w, k) -> [x, y, z],
//                      f the place along the gas path, u v w fixed random
//    box ............. the assembled bounds { c: [x, y, z], R }
//    heatIds ......... the parts that take the calm heat colour
//  Every size comes from E.g, so the model and the analysis agree.
//
//  EXPLODE AXES. Shells lift up their cylinder axis in order (cooler,
//  tube, heater, hot cap). The displacer, the piston and the rods move out
//  toward the viewer, the flywheel slides off its shaft, the bearings and
//  the base drop, the upright goes back.
//
//  GREP MAP
//    function crankshaft ....... shaft, disc webs, pins (throw groups)
//    function conrod ........... a rod in the local frame, +y to the small end
//    function flywheel ......... rim, hub and spokes
//    export function build ..... every part, then pose and gasMap
// ============================================================================
import * as THREE from 'three';
import { lathe, tubeWall, rod, rrect, circlePath, slabXZ, slabYZ, slabXY, pipePath, hollowPipe, discWeb, alongX, merge } from './kit.js';

const TAU = Math.PI * 2;
// Shells that stack or nest are cut by the section plane. A shared face
// between two shells shows the hatch of one and the lit face of the other at
// the same depth, and the two z-fight. GAP keeps such faces 0.25 mm apart.
const GAP = 0.25;

// the crankshaft: shaft runs on x, disc webs and pins. A web or pin in
// group 'disp' turns with the displacer throw (the phase angle).
function crankshaft(B, p, shaftR, runs, webs, pins) {
  B.mesh(p, merge(runs.map(([a, b]) => alongX(rod(shaftR, a, b, 32)))), 'steel');
  const groups = { main: p.root, disp: new THREE.Group() };
  p.root.add(groups.disp);
  for (const w of webs) {
    const holes = w.holes ? [[1.05, w.pinR - 1, 2.6], [-1.05, w.pinR - 1, 2.6]] : [];
    B.mesh(p, discWeb(w.R, w.x0, w.w, holes), 'satin', { parent: groups[w.grp] });
    // a brass timing dot on the web, over its pin
    if (w.dot) { const dot = alongX(rod(1.3, w.x0 + (w.dot > 0 ? w.w - 0.1 : -0.35), w.x0 + (w.dot > 0 ? w.w + 0.35 : 0.1), 16)); dot.translate(0, w.R - 3.5, 0); B.mesh(p, dot, 'brass', { parent: groups[w.grp], pick: false }); }
  }
  for (const q of pins) { const pin = alongX(rod(3.5, q.x0, q.x1, 24)); pin.translate(0, q.r, 0); B.mesh(p, pin, 'steel', { parent: groups[q.grp] }); }
  return groups;
}

// a connecting rod: big end at the origin (on x), small end at +y l
function conrod(B, p, l, w, bigR, smallR, mat) {
  const big = alongX(tubeWall(3.55, bigR, -w / 2, w / 2, 40));
  const small = alongX(tubeWall(2.05, smallR, -w / 2 + 0.6, w / 2 - 0.6, 32)); small.translate(0, l, 0);
  const s = new THREE.Shape();
  const y0 = bigR - 1.2, y1 = l - smallR + 1, h0 = bigR * 0.55, h1 = smallR * 0.62;
  s.moveTo(-h0, y0); s.lineTo(h0, y0); s.lineTo(h1, y1); s.lineTo(-h1, y1); s.closePath();
  const shank = slabYZ(s, -w / 2 + 0.9, w - 1.8, 0.4);
  // the cap line and two bolt heads on the big end
  const bolts = [-1, 1].map(sg => { const b = rod(1.1, -bigR - 1.8, -bigR + 0.4, 12); b.translate(0, 0, sg * (bigR - 1.4)); return b; });
  B.mesh(p, merge([big, small, shank, ...bolts]), mat);
}

function flywheel(B, p, f) {
  const R = f.R, w = f.w;
  const Ri = R - 7, h = w / 2;
  const rim = alongX(lathe([[[R, -h + 1]], [[R, h - 1]], [[R - 1, h]], [[Ri, h]], [[Ri, -h]], [[R - 1, -h]]], 160));
  const hub = alongX(tubeWall(5, 11, -9, 9, 48));
  const spokes = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU, c = new THREE.CylinderGeometry(2.4, 3.6, R - 16, 16);
    // each spoke runs 1 mm into the rim, so no gap shows at the rim
    c.translate(0, (R - 16) / 2 + 10.5, 0); c.rotateX(a); spokes.push(c);
  }
  B.mesh(p, rim, 'brass');
  B.mesh(p, merge([hub, ...spokes]), 'red');
}

// ── the engine ──────────────────────────────────────────────────────────────
export function build(B, E) {
  const g = E.g, d = g.disp, pw = g.pow, beta = E.beta;
  const P = (id, o) => B.part(id, o);

  // base and upright
  const bs = g.base;
  const base = P('base', { label: 'Base', labelAt: [bs.x1 - 30, bs.top, bs.z1 - 6], explode: [0, -48, 0], st: 0 });
  B.mesh(base, slabXZ(rrect(bs.x1 - bs.x0, bs.z1 - bs.z0, 9, (bs.x0 + bs.x1) / 2, -(bs.z0 + bs.z1) / 2), bs.top - bs.h, bs.h, 2.2), 'wood');
  const plate = slabXZ(rrect(46, 8, 1.5, bs.x1 - 34, -(bs.z1 - 7)), bs.top, 0.6, 0.2);
  B.mesh(base, plate, 'brass', { pick: false });

  const fr = g.frame;
  const frame = P('frame', { label: 'Upright', labelAt: [fr.x0 + 14, fr.y1 - 20, fr.z1], explode: [0, 0, -62], st: 0.05 });
  {
    const s = new THREE.Shape(), x0 = fr.x0, x1 = fr.x1, y0 = fr.y0, y1 = fr.y1, c = 16;
    s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1 - c); s.lineTo(x1 - c, y1); s.lineTo(x0 + c, y1); s.lineTo(x0, y1 - c); s.closePath();
    const wx = (x1 - x0 - 36) / 2;
    s.holes.push(pathOf(rrect(wx, 46, 8, x0 + 12 + wx / 2, y0 + 44)));
    s.holes.push(pathOf(rrect(wx, 46, 8, x1 - 12 - wx / 2, y0 + 44)));
    B.mesh(frame, slabXY(s, fr.z0, fr.z1 - fr.z0, 1), 'enamel');
    // a foot flange on the base
    B.mesh(frame, slabXZ(rrect(x1 - x0, 14, 2, (x0 + x1) / 2, -(fr.z0 - 4)), bs.top, 4, 0.8), 'enamel');
  }

  // main bearings: pedestal blocks with bronze bushes
  for (const [i, bx] of g.bearings.entries()) {
    const id = i ? 'bearingR' : 'bearingL';
    const b = P(id, { info: 'bearing', label: i ? null : 'Main bearing', labelAt: [bx, 14, 0], explode: [i ? 24 : -24, -14, 0], st: 0.1 });
    const s = new THREE.Shape(), top = bs.top;
    s.moveTo(-20, top); s.lineTo(20, top); s.lineTo(20, top + 6); s.lineTo(9, top + 14); s.lineTo(9, -6);
    s.absarc(0, 0, 11, -0.6, Math.PI + 0.6, false); s.lineTo(-9, -6); s.lineTo(-9, top + 14); s.lineTo(-20, top + 6); s.closePath();
    s.holes.push(circlePath(7.2));
    B.mesh(b, slabYZ(s, bx - 6, 12, 0.8), 'enamel');
    B.mesh(b, alongX(tubeWall(5.05, 7.2, bx - 7, bx + 7, 40)), 'bronze');
    const cap = alongX(rod(2.2, bx - 1.5, bx + 1.5, 12)); cap.translate(0, 13, 0);
    B.mesh(b, cap, 'brass', { pick: false });
  }

  // crankshaft and throws
  const crank = P('crank', { label: 'Crankshaft', labelAt: [beta ? -30 : 0, 0, 8], st: 0 });
  let tg;
  if (beta) {
    const r = pw.r;
    tg = crankshaft(B, crank, g.shaft.r, [[g.shaft.x0, -23.5], [23.5, g.shaft.x1]], [
      { grp: 'main', x0: -23.5, w: 4, R: 18, holes: true, pinR: r, dot: -1 },
      { grp: 'main', x0: -7.5, w: 4, R: 21 },
      { grp: 'main', x0: 3.5, w: 4, R: 21 },
      { grp: 'main', x0: 19.5, w: 4, R: 18, holes: true, pinR: r, dot: 1 },
    ], [{ grp: 'main', x0: -19.7, x1: -7.3, r }, { grp: 'main', x0: 7.3, x1: 19.7, r }, { grp: 'disp', x0: -3.7, x1: 3.7, r: d.r }]);
  } else {
    const xd = d.x, xp = pw.x;
    tg = crankshaft(B, crank, g.shaft.r, [[g.shaft.x0, xd - 11], [xd + 11, xp - 11], [xp + 11, g.shaft.x1]], [
      { grp: 'disp', x0: xd - 11, w: 4, R: 20, holes: true, pinR: d.r, dot: -1 },
      { grp: 'disp', x0: xd + 7, w: 4, R: 20, holes: true, pinR: d.r },
      { grp: 'main', x0: xp - 11, w: 4, R: 18, holes: true, pinR: pw.r },
      { grp: 'main', x0: xp + 7, w: 4, R: 18, holes: true, pinR: pw.r, dot: 1 },
    ], [{ grp: 'disp', x0: xd - 7.2, x1: xd + 7.2, r: d.r }, { grp: 'main', x0: xp - 7.2, x1: xp + 7.2, r: pw.r }]);
  }

  // connecting rods
  const rods = [];
  const dRod = P('dRod', { label: 'Displacer con-rod', labelAt: [d.x, d.l * 0.5, 0], explode: [0, 8, beta ? 74 : 52], st: 0.15 });
  conrod(B, dRod, d.l, beta ? 5.6 : 9, 6.4, 4.4, 'steel');
  rods.push({ p: dRod, x: d.x, r: d.r, l: d.l, disp: true });
  for (const [i, x] of pw.xs.entries()) {
    const id = pw.xs.length > 1 ? (i ? 'pRodR' : 'pRodL') : 'pRod';
    const pr = P(id, { info: 'pRod', label: i ? null : 'Power con-rod', labelAt: [x, pw.l * 0.5, 0], explode: [0, 6, 50], st: 0.15 });
    conrod(B, pr, pw.l, beta ? 9 : 10, 6.6, 4.4, 'brass');
    rods.push({ p: pr, x, r: pw.r, l: pw.l, disp: false });
  }

  // displacer rod with its clevis (root y = clevis pin)
  const dispUp = beta ? [0, 46, 64] : [0, 34, 62];
  const dRodA = P('dispRod', { label: 'Displacer rod', labelAt: [d.x, d.rodLen * 0.55, 0], explode: dispUp, st: 0.2 });
  {
    const cw = beta ? 5.6 : 9;
    const cheeks = [-1, 1].map(s => { const b = new THREE.BoxGeometry(2.2, 12, 9); b.translate(s * (cw / 2 + 1.3), 1, 0); return b; });
    const top = new THREE.BoxGeometry(cw + 4.8, 4, 9); top.translate(0, 9, 0);
    const pin = alongX(rod(2, -cw / 2 - 2.6, cw / 2 + 2.6, 16));
    const r = rod(d.rodR, 10, d.rodLen + 1, 24);
    B.mesh(dRodA, merge([...cheeks, top]), 'steel');
    B.mesh(dRodA, merge([pin, r]), 'turned');
    dRodA.root.position.x = d.x;
  }
  const disp = P('displacer', { label: 'Displacer', labelAt: [d.x, d.dLen * 0.6, -d.dR], explode: dispUp, st: 0.2 });
  {
    const R = d.dR, L = d.dLen;
    B.mesh(disp, lathe([[[R - 1.5, 0], [R, 1.5]], [[R, L - 2]], [[R - 2, L], [R - 5, L + 0.8], [0, L + 1.6]], [[0, 0]]], 96), 'satin');
    for (const y of [L * 0.33, L * 0.66]) B.mesh(disp, tubeWall(R - 0.3, R + 0.05, y, y + 0.6, 96), 'dark', { pick: true });
    disp.root.position.x = d.x;
  }

  // power piston (root y = wrist pin)
  const pist = P('piston', { label: 'Power piston', labelAt: [pw.x, pw.pinToCrown - 4, -pw.bore], explode: beta ? [0, 12, 44] : [0, 18, 58], st: 0.2 });
  {
    const R = pw.bore - 0.15, top = pw.pinToCrown, bot = top - pw.pLen;
    if (!beta) {
      B.mesh(pist, lathe([[[R, bot], [R, top - 1]], [[R - 1, top], [0, top]], [[0, top - 8]], [[12, top - 8], [12, bot]]], 96), 'graphite');
      B.mesh(pist, alongX(rod(2, -R + 1.5, R - 1.5, 20)), 'steel');
      for (const y of [top - 4, top - 8]) B.mesh(pist, tubeWall(R - 0.6, R + 0.08, y, y + 0.9, 96), 'dark', { pick: true });
    } else {
      // the beta piston: the displacer rod runs through a gland in its centre;
      // two lugs under the skirt take the twin rods
      const b0 = pw.pinToBottom, t0 = pw.pinToCrown;
      B.mesh(pist, lathe([[[R, b0], [R, t0 - 1]], [[R - 1, t0], [d.rodR + 0.6, t0]], [[d.rodR + 0.6, b0 + 6]], [[d.rodR + 4.5, b0 + 6], [d.rodR + 4.5, b0]]], 96), 'graphite');
      B.mesh(pist, tubeWall(d.rodR + 0.2, d.rodR + 4.5, b0 - 3, b0, 32), 'bronze');
      for (const x of pw.xs) {
        const lug = new THREE.BoxGeometry(3.2, b0 + 6, 10); lug.translate(x + (x < 0 ? -6.2 : 6.2), (b0 + 6) / 2 - 5, 0);
        const lug2 = new THREE.BoxGeometry(3.2, b0 + 6, 10); lug2.translate(x + (x < 0 ? 6.2 : -6.2), (b0 + 6) / 2 - 5, 0);
        const pin = alongX(rod(2, x - 7.6, x + 7.6, 16));
        B.mesh(pist, merge([lug, lug2]), 'graphite');
        B.mesh(pist, pin, 'steel');
      }
      for (const y of [t0 - 4, t0 - 8]) B.mesh(pist, tubeWall(R - 0.6, R + 0.08, y, y + 0.9, 96), 'dark', { pick: true });
    }
    pist.root.position.x = pw.x;
  }

  // ── shells (cut in the section view) ──────────────────────────────────────
  const cx = d.x, bore = d.bore, wall = bore + d.wall;
  const co = g.cooler, hc = g.hotcap, ht = g.heater, rg = g.regen;
  const stackUp = beta ? { tube: 112, cooler: 0, heater: 150, hot: 190 } : { tube: 78, cooler: 15, heater: 128, hot: 172 };

  const tubeY0 = beta ? pw.cylY0 : d.floor;
  const tube = P(beta ? 'cylinder' : 'dCyl', { label: beta ? 'Cylinder' : 'Displacer cylinder', labelAt: [cx + wall, beta ? (tubeY0 + co.y0) / 2 : 160, 0], explode: [0, stackUp.tube, 0], st: 0.25, cut: true });
  // the tube and its foot flange are one turned profile. The tube stops a
  // GAP short of the plate below and of the hot cap above.
  {
    const y0 = tubeY0 + GAP, fR = beta ? 31 : 30, fH = beta ? 4 : 3.5;
    B.mesh(tube, lathe([[[fR, y0]], [[fR, y0 + fH]], [[wall, y0 + fH]], [[wall, d.head - GAP]], [[bore, d.head - GAP]], [[bore, y0]]], 128), 'satin');
  }
  // ports in the wall where the pipes join (bosses)
  const portY = beta ? g.portY : 114, portR = g.pipes.cold.rOut + GAP;
  {
    const boss = alongX(tubeWall(portR, 5, -1, 3.5, 24)); boss.translate(-wall - 2.4, portY, 0);
    const bosses = [boss];
    if (!beta) { const b2 = alongX(tubeWall(portR, 5, -3.5, 1, 24)); b2.translate(wall + 2.4, portY, 0); bosses.push(b2); }
    B.mesh(tube, merge(bosses), 'satin');
  }

  const cool = P('cooler', { label: 'Cooler', labelAt: [cx - co.R, (co.y0 + co.y1) / 2, 0], explode: [0, stackUp.cooler, beta ? 0 : 0], st: 0.2, cut: true });
  {
    const parts = [tubeWall(wall + GAP, wall + 2.4, co.y0, co.y1, 128)];
    const n = co.fins, step = (co.y1 - co.y0 - 2) / (n - 1);
    for (let i = 0; i < n; i++) parts.push(tubeWall(wall + 2.3, co.R, co.y0 + i * step, co.y0 + i * step + 2, 128));
    B.mesh(cool, merge(parts), 'alu');
  }
  const hot = P('hotcap', { label: 'Hot cap', labelAt: [cx + hc.R, d.head + 3, 0], explode: [0, stackUp.hot, 0], st: 0.32, cut: true });
  {
    const top = d.head + hc.top;
    B.mesh(hot, lathe([[[hc.R, hc.y0], [hc.R, top - 2]], [[hc.R - 2, top], [0, top]], [[0, d.head]], [[wall + GAP, d.head], [wall + GAP, hc.y0]]], 128), 'hot');
    const portW = tubeWall(g.pipes.hot.rOut + GAP, 5, top - 0.5, top + 3, 24); portW.translate(g.pipes.hot.pts[0][0] - cx, 0, 0);
    B.mesh(hot, portW, 'hot');
    hot.root.position.x = cx;
  }
  const heat = P('heater', { label: 'Heater band', labelAt: [cx - ht.R1, (ht.y0 + ht.y1) / 2, 0], explode: [0, stackUp.heater, 0], st: 0.3, cut: true });
  {
    B.mesh(heat, tubeWall(ht.R0, ht.R1, ht.y0 + 2 + GAP, ht.y1 - 2 - GAP, 128), 'ceramic');
    B.mesh(heat, merge([tubeWall(ht.R0, ht.R1 + 0.8, ht.y0, ht.y0 + 2, 128), tubeWall(ht.R0, ht.R1 + 0.8, ht.y1 - 2, ht.y1, 128)]), 'steel');
    // a terminal block at the back
    const tb = new THREE.BoxGeometry(10, 12, 6); tb.translate(0, (ht.y0 + ht.y1) / 2, -ht.R1 - 2.6);
    B.mesh(heat, tb, 'ceramic');
    heat.root.position.x = cx;
  }
  // hot-side lathe parts were made about x = 0: move them
  for (const q of [tube, cool]) q.root.position.x = cx;

  // regenerator: canister and the stacked screens inside
  const regen = P('regen', { label: 'Regenerator', labelAt: [rg.x - rg.rOut, (rg.y0 + rg.y1) / 2 + 10, 0], explode: [-34, beta ? 150 : 128, 0], st: 0.25, cut: true });
  {
    // the canister and its two end caps are one turned profile
    const rc = rg.rOut + 1, h = g.pipes.hot.rOut + GAP, c0 = rg.y0 + rg.cap, c1 = rg.y1 - rg.cap;
    const g2 = lathe([[[rc, rg.y0]], [[rc, c0]], [[rg.rOut, c0]], [[rg.rOut, c1]], [[rc, c1]], [[rc, rg.y1]], [[h, rg.y1]], [[h, c1]], [[rg.rIn, c1]], [[rg.rIn, c0]], [[h, c0]], [[h, rg.y0]]], 64);
    g2.translate(rg.x, 0, 0);
    B.mesh(regen, g2, 'satin');
  }
  const matrix = P('matrix', { label: null, labelAt: [rg.x, (rg.y0 + rg.y1) / 2, 0], explode: [-34 - 32, beta ? 40 : 30, 0], st: 0.3, cut: true });
  {
    const discs = [];
    for (let y = rg.y0 + rg.cap + 1; y < rg.y1 - rg.cap; y += 2.2) { const c = new THREE.CircleGeometry(rg.rIn - 0.15, 40); c.rotateX(-Math.PI / 2); c.translate(rg.x, y, 0); discs.push(c); }
    const side = new THREE.CylinderGeometry(rg.rIn - 0.15, rg.rIn - 0.15, rg.y1 - rg.y0 - 2 * rg.cap - 1, 40, 1, true); side.translate(rg.x, (rg.y0 + rg.y1) / 2, 0);
    discs.push(side);
    B.mesh(matrix, merge(discs), 'gauze', { shadow: false });
  }
  // pipes
  const paths = {};
  for (const [k, lab, ex] of [['hot', 'Hot pipe', [-20, beta ? 236 : 210, 0]], ['cold', 'Cold pipe', [-30, 0, 0]], ['transfer', 'Transfer pipe', [0, 152, 0]]]) {
    const pp = g.pipes[k]; if (!pp) continue;
    const path = pipePath(pp.pts, pp.bend); paths[k] = path;
    const q = P(k + 'Pipe', { label: k === 'transfer' ? lab : null, labelAt: path.getPointAt(0.5).toArray(), explode: ex, st: 0.32, cut: true });
    B.mesh(q, hollowPipe(path, pp.rIn, pp.rOut), 'copper');
  }

  // gamma: the cold plate with the rod gland, the power cylinder and head
  if (!beta) {
    const cp = P('coldPlate', { label: 'Cold plate & gland', labelAt: [cx - 30, d.floor - 5, 0], explode: [0, 8, 0], st: 0.12, cut: true });
    const s = rrect(68, 78, 6, cx, -(-42 + 36) / 2);
    s.holes.push(circlePath(d.rodR + 0.15, cx, 0));
    B.mesh(cp, slabXZ(s, d.floor - 10, 10, 1), 'enamel');
    // the gland body stops on the nut top (y = 88): run down to y = 84 it
    // put its bottom face and bore on the nut bottom face and hole flats
    const gl = tubeWall(d.rodR + 0.15, 7, 88, d.floor - 10 - GAP, 32); gl.translate(cx, 0, 0);
    // a hex nut: the flats of its hole, not the corners, clear the rod
    const nut = tubeWall((d.rodR + 0.15) / Math.cos(Math.PI / 6), 8.5, 84, 88, 6); nut.translate(cx, 0, 0);
    B.mesh(cp, merge([gl, nut]), 'brass');

    const px = pw.x, pb = pw.bore, pwall = pb + 3;
    const pc = P('pCyl', { label: 'Power cylinder', labelAt: [px + 26, (pw.cylY0 + pw.head) / 2, 0], explode: [0, 46, 0], st: 0.25, cut: true });
    const parts = [lathe([[[26, pw.cylY0]], [[26, pw.cylY0 + 6]], [[pwall, pw.cylY0 + 6]], [[pwall, pw.head - GAP]], [[pb, pw.head - GAP]], [[pb, pw.cylY0]]], 96)];
    for (let i = 0; i < 4; i++) { const y = pw.cylY0 + 16 + i * 9; parts.push(tubeWall(pwall - 0.1, 25, y, y + 2, 96)); }
    const gp = merge(parts); gp.translate(px, 0, 0);
    B.mesh(pc, gp, 'alu');
    // the bracket stands a GAP inside the foot flange top and bottom faces.
    // Its front edge (z = -17.5, -16.7 with the bevel) stays 0.7 mm clear
    // of the bore wall (r 16): the bevel no longer cuts the bore faces.
    const br = slabXZ(rrect(30, 24.5, 3, px, 29.75), pw.cylY0 + GAP, 6 - 2 * GAP, 0.8);
    B.mesh(pc, br, 'enamel');
    const ph = P('pHead', { label: 'Power head', labelAt: [px + 22, pw.head + 5, 0], explode: [0, 92, 0], st: 0.3, cut: true });
    const hr = g.pipes.transfer.rOut + GAP;
    const hg = lathe([[[22, pw.head], [22, pw.head + 9]], [[21, pw.head + 10], [hr, pw.head + 10]], [[hr, pw.head]]], 96); hg.translate(px, 0, 0);
    B.mesh(ph, hg, 'satin');
    const bolts = [];
    for (let i = 0; i < 6; i++) { const a = (i + 0.5) / 6 * TAU, b = rod(1.9, pw.head + 10, pw.head + 12.4, 6); b.translate(px + 18.5 * Math.cos(a), 0, 18.5 * Math.sin(a)); bolts.push(b); }
    B.mesh(ph, merge(bolts), 'steel', { pick: false });
  } else {
    // the beta cylinder's bracket back to the upright
    const bk = P('bracket', { label: null, labelAt: [0, pw.cylY0 + 3, -30], explode: [0, 0, -40], st: 0.08, cut: true });
    // one outline: the r 31 ring round the bore and the 56 x 34 arm back to
    // the upright (shape y = -z, 9 to 43). Two slabs that overlap put their
    // top, bottom and bore faces on one plane and z-fight.
    const s = new THREE.Shape(), ra = 31, hw = 28, y1 = 43, rc = 4;
    const ya = Math.sqrt(ra * ra - hw * hw), a = Math.atan2(ya, hw);
    s.moveTo(hw, ya); s.lineTo(hw, y1 - rc); s.quadraticCurveTo(hw, y1, hw - rc, y1);
    s.lineTo(-hw + rc, y1); s.quadraticCurveTo(-hw, y1, -hw, y1 - rc); s.lineTo(-hw, ya);
    s.absarc(0, 0, ra, Math.PI - a, TAU + a, false);
    s.holes.push(circlePath(bore + 0.2, 0, 0));
    B.mesh(bk, slabXZ(s, pw.cylY0 - 6, 6, 0.8), 'enamel');
  }

  // ── pose ───────────────────────────────────────────────────────────────────
  let phase = Math.PI / 2;
  function setPhase(al) { phase = al; tg.disp.rotation.x = al; }
  setPhase(phase);
  function pose(k) {
    crank.root.rotation.x = k.th;
    fly.root.rotation.x = k.th;
    for (const r of rods) {
      const sk = r.disp ? k.dk : k.pk;
      r.p.root.position.set(r.x, sk.py, sk.pz);
      r.p.root.rotation.x = sk.rod;
    }
    dRodA.root.position.y = k.clevis;
    disp.root.position.y = k.dispBottom;
    pist.root.position.y = k.pin;
  }
  const fly = P('flywheel', { label: 'Flywheel', labelAt: [g.flywheel.x + 8, g.flywheel.R - 4, 0], explode: [64, 0, 0], st: 0.1 });
  flywheel(B, fly, g.flywheel);
  fly.root.position.x = g.flywheel.x;

  // ── the gas path ──────────────────────────────────────────────────────────
  const Rg = bore - 1.4;
  const half = (w, R, dx) => -Math.sqrt(Math.max(0, R * R - dx * dx)) * w;
  const slab = (x0, xA, xB, f, u, v, w, y0, y1) => {
    const dx = xA + (xB - xA) * f - x0;
    return [x0 + dx, y0 + (y1 - y0) * v, half(w, Rg, dx) * 0.96];
  };
  const along = path => (f, u, v, w) => {
    const p = path.getPointAt(Math.min(1, Math.max(0, f))), r = 1.6;
    return [p.x + (u - 0.5) * 2 * r * 0.7, p.y + (v - 0.5) * 2 * r * 0.7, -w * r];
  };
  const gasMap = {
    hot: (f, u, v, w, k) => slab(cx, cx + Rg * 0.92, cx - Rg * 0.92, f, u, v, w, k.dispTop + 1.2, d.head - 1.2),
    hotPipe: along(paths.hot),
    regen: (f, u, v, w) => { const dx = (u - 0.5) * 2 * (rg.rIn - 1.2); return [rg.x + dx, rg.y1 - rg.cap - 0.5 - (rg.y1 - rg.y0 - 2 * rg.cap - 1) * f, -Math.sqrt(Math.max(0, (rg.rIn - 1.2) ** 2 - dx * dx)) * w]; },
    coldPipe: along(paths.cold),
    cold: (f, u, v, w, k) => slab(cx, cx - Rg * 0.92, cx + Rg * 0.92, f, u, v, w, (beta ? k.crown : d.floor) + 1, k.dispBottom - 1),
  };
  if (!beta) {
    gasMap.transfer = along(paths.transfer);
    gasMap.power = (f, u, v, w, k) => { const R = pw.bore - 1.2, dx = (u - 0.5) * 2 * R * 0.9; return [pw.x + dx, pw.head - 1 - (pw.head - 2 - k.crown) * f, -Math.sqrt(Math.max(0, R * R - dx * dx)) * w * 0.96]; };
  }

  // assembled bounds (for the camera)
  const lo = [bs.x0, bs.top - bs.h, bs.z0], hi = [bs.x1, (beta ? d.head + 26 : 240), bs.z1];
  const box = { c: lo.map((v, i) => (v + hi[i]) / 2), R: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 };
  return { pose, setPhase, gasMap, box, heatIds: ['hotcap', 'heater'], explodeLift: beta ? 120 : 105 };
}

// a THREE.Shape used as a hole
function pathOf(shape) { const p = new THREE.Path(); p.curves = shape.curves; p.currentPoint = shape.currentPoint; return p; }
