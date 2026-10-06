// ============================================================================
//  RADIAL ENGINE  ·  scene.js — the parts of one radial engine and its pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one engine with kit.js and returns sc: { pose(theta),
//  box, keys, showFire }. Every moving part takes its place from mech.js pose(), so
//  what moves on screen is what tests.mjs checks.
//
//  LAYOUT. Parts are made in the engine plane: the mech.js point (X, Y) at
//  depth h is (X, h, -Y) in the B.root frame. B.root turns +90 deg about x,
//  so the engine stands upright: world (X, Y, h), the propeller toward +z.
//  A cylinder part has local +Y out along its axis and local +X to the
//  front (+h). Radii below are along the cylinder axis from the crank axis.
//    crankcase ...... one flat pad per cylinder, Rc - 12 .. Rc, with a bore
//                     hole; pad i spans h +-(padH + 0.4 i), so no two pads
//                     share a top face. Rear cover at h cA .. cB, behind
//                     every pad; the fins start outside its radius
//    barrel ......... Rc + 0.6 .. H - 0.4, cooling fins from Rfin, a window
//                     in the front (+-66 deg) shows the piston and rods
//    head ........... H .. H + 70 (H is the chamber roof), fins, two plugs,
//                     rocker brackets in front (radial H + 46 .. H + 60.5,
//                     above every fin face)
//    crankshaft ..... cheeks at h +-(22 .. 34), pin r 30, propeller
//                     shaft to h 190 (no hub)
//    master rod ..... flanges at h +-(9.3 .. 17), hub h -9 .. 9, shank
//                     h -8 .. 8; knuckle pins through the flanges
//    link rods ...... eyes h -6 .. 6 (small eye -6.5 .. 6.5), shank -5 .. 5
//    cam ring ....... inlet track h 88 .. 95, exhaust track h 96 .. 103
//    tappets, pushrods, rockers: one pair per cylinder, in front
//    stand .......... rear mount, column and floor plate (the 'base' part)
//  Z-FIGHTING. No two faces of different parts share a plane where they
//  overlap: the steps above are at least 0.3 mm. Coaxial pairs differ in
//  radius by at least 0.4 mm (pin 30 / hole 30.4, piston bi - 0.5 / bore bi).
//
//  GREP MAP
//    function cylinderBarrel ... the finned barrel with its window
//    function headProfile ...... the finned head (lathe profile)
//    function rodShape ......... a link rod: shank and two eyes
//    function camTrack ......... one cam track outline from mech.js profile()
//    export function build ..... every part and pose(theta)
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, poly, shell, circle, merge, frameQuat } from './kit.js';
import { unit, makeEngine, survey, flangeR, CW_GAP, TAU } from './mech.js';

const V = (x, y) => new THREE.Vector2(x, y);
// mech (X, Y) at depth h -> B.root local
const at = (p, h = 0) => [p[0], h, -p[1]];
// a cylinder axis as a B.root direction
const dir = a => [a[0], 0, -a[1]];

function cylinderBarrel(y0, y1, bi, bo, fo, yFin) {
  const rows = [{ y: y0, ro: bo, ri: bi }];
  for (let y = yFin; y + 2.5 < y1 - 4; y += 7.5) rows.push({ y, ro: bo, ri: bi }, { y, ro: fo, ri: bi }, { y: y + 2.5, ro: fo, ri: bi }, { y: y + 2.5, ro: bo, ri: bi });
  rows.push({ y: y1, ro: bo, ri: bi });
  const W = 1.15;
  return shell(rows, 56, (y, f) => (f < W || f > TAU - W) && y > y0 + 10 && y < y1 - 3);
}
function headProfile(r0) {
  const p = [[0.0001, 0], [r0, 0]];
  for (let k = 0; k < 6; k++) { const y = 4 + 7.5 * k; p.push([r0, y], [r0 + 18, y], [r0 + 18, y + 2.5], [r0, y + 2.5]); }
  p.push([r0, 50], [r0 - 18, 66], [0.0001, 70]);
  return poly(p, 56);
}
// a link rod along +x from the knuckle (0, 0) to the wrist pin (len, 0)
function rodShape(len, eyeA, eyeB, holeA, holeB, wShank, hShank, hA, hB) {
  const gs = [tube(holeA, eyeA, -hA, hA, 32), tube(holeB, eyeB, -hB, hB, 40)];
  gs[1].translate(len, 0, 0);
  const s = new THREE.Shape([V(eyeA - 3, -wShank / 2), V(len - eyeB + 3, -wShank / 2), V(len - eyeB + 3, wShank / 2), V(eyeA - 3, wShank / 2)]);
  gs.push(slab(s, -hShank, 2 * hShank, 0.6));
  return merge(gs);
}
function camTrack(E, k, rb, shift, h0, h1) {
  const pts = [];
  for (let m = 0; m < 720; m++) { const a = TAU * m / 720, R = rb + E.profile(k, a - shift); pts.push(V(-R * Math.sin(a), R * Math.cos(a))); }
  const s = new THREE.Shape(pts); s.holes.push(circle(50));
  return slab(s, h0, h1 - h0, 0.5);
}

export function build(B, id) {
  const u = unit(id), E = makeEngine(u), S = survey(E), n = u.n;
  B.root.rotation.x = Math.PI / 2;
  const bi = u.bore / 2, bo = bi + 7, fo = bi + 26, H = E.H;
  const Rc = Math.max(240, (bi + 16) / Math.sin(Math.PI / n) + 2), coverR = Rc / Math.cos(Math.PI / n) + 4;
  const Rfin = Math.max(Rc + 20, fo / Math.sin(Math.PI / n) + 4, coverR + 6);
  // pad i spans h +-(padH + 0.4 i); the rear cover is cB - 10 .. cB
  const padH = bi + 16, cB = -(padH + 0.4 * n + 2), cA = cB - 10;
  const cwR = Math.min(...S.map(q => q.sBot)) - u.crown - CW_GAP;
  const rb = 62, hTr = [91.5, 99.5], hTop = 125, hPiv = 100, tOff = 22, TL = 124;
  const floorY = -(H + 70) - 40;

  // ── stand ──
  const base = B.part('base', { info: 'base', label: 'Stand', labelAt: [H * 0.6, -150, -floorY], explode: [0, -60, 0], st: 0, en: 0.5 });
  B.mesh(base, tube(40, 70, cA - 60, cA + 2, 48), 'cast');
  const col = new THREE.BoxGeometry(80, 50, -floorY + 5); col.translate(0, cA - 31, -(floorY - 5) / 2); B.mesh(base, col, 'cast');
  const floor = new THREE.BoxGeometry(2 * (H + 140), 520, 16); floor.translate(0, -60, -(floorY - 8)); B.mesh(base, floor, 'paint');

  // ── crankcase: pads and rear cover ──
  const cs = B.part('case', { info: 'case', label: 'Crankcase', labelAt: at([Rc * 0.8, -Rc * 0.55], -80), explode: [0, -120, 0], st: 0, en: 0.6 });
  const padW = 2 * Rc * Math.tan(Math.PI / n) + 1;
  for (let i = 0; i < n; i++) {
    const he = padH + 0.4 * i;
    const s = new THREE.Shape([V(-he, -padW / 2), V(he, -padW / 2), V(he, padW / 2), V(-he, padW / 2)]); s.holes.push(circle(bi + 6));
    const g = slab(s, Rc - 12, 12, 0.8);
    g.applyQuaternion(frameQuat(dir(E.ax[i]), [0, 1, 0]));
    B.mesh(cs, g, 'cast');
  }
  B.mesh(cs, poly([[coverR, cA], [coverR, cB], [36.5, cB], [36.5, cA]], 96), 'cast');
  B.mesh(cs, tube(36.5, 60, cB, -40, 48), 'cast');

  // ── cylinders and heads ──
  const cyls = [], pistons = [], links = [], flames = [], tappets = [], pushes = [], rockers = [];
  for (let i = 0; i < n; i++) {
    const a = E.ax[i], t = [a[1], -a[0]];   // t: the tangent, clockwise of the axis
    const c = B.part('cyl' + i, { info: 'cyl', label: i === 0 ? 'Cylinder barrel' : null, labelAt: [fo + 10, (Rfin + H) / 2, 0], u: dir(a), e0: [0, 1, 0], explode: dir([a[0] * 110, a[1] * 110]), st: 0.15, en: 0.75 });
    B.mesh(c, cylinderBarrel(Rc + 0.6, H - 0.4, bi, bo, fo, Rfin), 'gear');
    B.mesh(c, tube(bo + 0.5, bo + 10, Rc + 0.6, Rc + 8, 56), 'cast');
    const hd = B.part('head' + i, { info: 'head', label: i === 0 ? 'Cylinder head' : null, labelAt: [0, H + 80, 0], u: dir(a), e0: [0, 1, 0], explode: dir([a[0] * 190, a[1] * 190]), st: 0.1, en: 0.7 });
    const hg = headProfile(bo + 6); hg.translate(0, H, 0); B.mesh(hd, hg, 'alu');
    // spark plugs, front and back (along local X), between two fins
    for (const sx of [1, -1]) { const g = rod(4.5, bo + 2, bo + 34, 16); g.rotateZ(-sx * Math.PI / 2); g.translate(0, H + 31.5, 0); B.mesh(hd, g, 'bolt'); }
    // rocker brackets: two cheeks beside each arm (tangent tOff +- 5.5),
    // radial H + 46 .. H + 60.5, h 76 .. 104; valve spring caps at h 75
    for (const sz of [-1, 1]) for (const e of [-5.5, 5.5]) { const g = new THREE.BoxGeometry(28, 14.5, 3); g.translate(90, H + 53.25, -(sz * tOff + e)); B.mesh(hd, g, 'cast'); }
    for (const sz of [-1, 1]) { const g = rod(6, 48, 54.4, 16); g.translate(75, H, -sz * tOff); B.mesh(hd, g, 'spring'); }
    cyls.push(c);

    // piston and wrist pin (local X is the front, the pin runs along it)
    const pR = bi - 0.5;
    const p = B.part('piston' + i, { info: 'piston', label: i === 0 ? 'Piston' : null, labelAt: [pR + 20, 0, 0], u: dir(a), e0: [0, 1, 0], explode: [0, 200 + 10 * i, 0], st: 0.3, en: 0.9 });
    B.mesh(p, poly([[pR, -u.crown], [pR, u.crown - 17], [pR - 1.4, u.crown - 17], [pR - 1.4, u.crown - 14], [pR, u.crown - 14], [pR, u.crown - 11], [pR - 1.4, u.crown - 11], [pR - 1.4, u.crown - 8], [pR, u.crown - 8], [pR, u.crown], [0.0001, u.crown], [0.0001, u.crown - 15], [pR - 8, u.crown - 15], [pR - 8, -u.crown]], 56), 'plate');
    const pin = rod(16, -(pR - 7), pR - 7, 24); pin.rotateZ(Math.PI / 2); B.mesh(p, pin, 'shaft');
    pistons.push(p);

    // the burning charge between crown and roof
    const fl = B.part('flame' + i, { info: 'flame', u: dir(a), e0: [0, 1, 0], explode: [0, 200 + 10 * i, 0], st: 0.3, en: 0.9 });
    const fm = B.mesh(fl, rod(pR - 1, 0, 1, 40), 'flame', { shadow: false });
    flames.push({ p: fl, m: fm });

    // link rod
    if (i > 0) {
      const lp = B.part('link' + i, { info: 'link', label: i === 1 ? 'Link rod' : null, labelAt: [u.l * 0.6, 8, 0], explode: [0, 150 + 6 * i, 0], st: 0.25, en: 0.85 });
      B.mesh(lp, rodShape(u.l, 16, 22, 9.4, 16.4, 20, 5, 6, 6.5), 'steel');
      links.push({ i, p: lp });
    }

    // valve train: tappet (roller on the cam), pushrod, rocker; k 0 inlet, 1 exhaust
    for (let k = 0; k < 2; k++) {
      const tp = B.part(`tappet${i}_${k}`, { info: 'tappet', u: dir(a), e0: [0, 1, 0], explode: [0, 300, 0], st: 0.4, en: 1 });
      const roller = rod(4, -3, 3, 16); roller.rotateZ(Math.PI / 2); B.mesh(tp, roller, 'bolt');
      // a long stem out to radial about 190, so the pushrods run along the
      // cylinders and leave the rods in the middle in view
      B.mesh(tp, rod(2.5, 4.2, TL - 7.8, 12), 'shaft');
      B.mesh(tp, rod(4.6, TL - 8.3, TL, 16), 'shaft');   // the cup: the pushrod end sits 2 mm inside it
      const sz = k ? 1 : -1;
      const A0 = [a[0] * (rb + TL + 2.3), a[1] * (rb + TL + 2.3)], top = [a[0] * (H + 62.4) + t[0] * tOff * sz, a[1] * (H + 62.4) + t[1] * tOff * sz];
      const v = [top[0] - A0[0], hTop - hTr[k], top[1] - A0[1]], len = Math.hypot(...v);
      const pr = B.part(`push${i}_${k}`, { info: 'pushrod', label: i === 0 && k === 0 ? 'Pushrod' : null, labelAt: [0, len * 0.5, 0], u: [v[0] / len, v[1] / len, -v[2] / len], e0: (() => { const w = [-v[2], 0, -v[0]]; const m = Math.hypot(...w); return [w[0] / m, 0, w[2] / m]; })(), explode: [0, 330, 0], st: 0.4, en: 1 });
      B.mesh(pr, rod(3, 0, len, 12), 'shaft');
      // rocker: pivot at radial H + 66, h hPiv, on a tangent axis. The arm
      // runs along h (local X), local Z is radial. Its upper end (h + 25)
      // takes the pushrod, 0.6 mm off its inner face; its lower end works
      // the valve. pose() turns it by -asin(lift / 25), so the arm end
      // moves out by the lift, as the pushrod end does.
      const rk = B.part(`rocker${i}_${k}`, { info: 'rocker', u: dir(t), e0: [0, 1, 0], explode: [0, 360, 0], st: 0.4, en: 1 });
      B.mesh(rk, new THREE.BoxGeometry(56, 6, 6), 'steel');
      B.mesh(rk, rod(5, -5, 5, 16), 'bolt');
      rk.root.position.set(...at([a[0] * (H + 66) + t[0] * tOff * sz, a[1] * (H + 66) + t[1] * tOff * sz], hPiv));
      tappets.push({ i, k, p: tp }); pushes.push({ i, k, p: pr, A0, len }); rockers.push({ i, k, p: rk });
    }
  }

  // ── crankshaft ──
  const cr = B.part('crank', { info: 'crank', label: 'Crankshaft', labelAt: [0, 200, 0], explode: [0, -60, 0], st: 0.2, en: 0.8 });
  const cheek = new THREE.Shape();
  cheek.absarc(0, u.r, 46, 0, Math.PI, false);
  cheek.absarc(0, 0, cwR, Math.PI + 0.5, TAU - 0.5, false);
  cheek.closePath();
  B.mesh(cr, slab(cheek, 22, 12, 1), 'gear');
  B.mesh(cr, slab(cheek, -34, 12, 1), 'gear');
  const cpin = rod(30, -26, 26, 40); cpin.translate(0, 0, -u.r); B.mesh(cr, cpin, 'shaft');
  B.mesh(cr, rod(35, cA - 50, -28, 40), 'shaft');
  // the propeller shaft: no hub, so the face-on view shows the rods
  B.mesh(cr, rod(35, 28, 170, 40), 'shaft');
  B.mesh(cr, poly([[29, 170], [29, 190], [0.0001, 190], [0.0001, 170]], 40), 'steel');

  // ── master rod: hub, flanges, knuckle pins, shank, small eye ──
  const fr = flangeR(u);
  const ms = B.part('master', { info: 'master', label: 'Master rod', labelAt: [u.L * 0.55, 12, 0], explode: [0, 120, 0], st: 0.25, en: 0.85 });
  const fl = new THREE.Shape(); fl.absarc(0, 0, fr, 0, TAU, false); fl.holes.push(circle(30.4));
  for (let i = 1; i < n; i++) fl.holes.push(circle(9.4, u.rho * Math.cos(E.phi[i]), u.rho * Math.sin(E.phi[i])));
  B.mesh(ms, slab(fl, 9.3, 7.7, 0.6), 'gear');
  B.mesh(ms, slab(fl, -17, 7.7, 0.6), 'gear');
  B.mesh(ms, tube(30.4, 46, -9, 9, 48), 'gear');
  for (let i = 1; i < n; i++) { const g = rod(9, -19, 19, 16); g.translate(u.rho * Math.cos(E.phi[i]), 0, -u.rho * Math.sin(E.phi[i])); B.mesh(ms, g, 'bolt'); }
  const sh = new THREE.Shape([V(40, -19), V(u.L - 20, -13), V(u.L - 20, 13), V(40, 19)]);
  B.mesh(ms, slab(sh, -8, 16, 0.8), 'steel');
  const eye = tube(16.4, 24, -10, 10, 40); eye.translate(u.L, 0, 0); B.mesh(ms, eye, 'gear');

  // ── cam ring ──
  const cam = B.part('cam', { info: 'cam', label: 'Cam ring', labelAt: [0, 104, -rb - 30], explode: [0, 260, 0], st: 0.3, en: 0.9 });
  B.mesh(cam, camTrack(E, 0, rb, 0, 88, 95), 'bronze');
  B.mesh(cam, camTrack(E, 1, rb, E.tracks[1].alpha - E.tracks[0].alpha, 96, 103), 'brass');
  B.mesh(cam, tube(36, 44, 84, 106, 48), 'steel');
  B.mesh(cam, tube(43.5, 50.4, 89, 102, 48), 'steel');

  // the pads shade the inside of the case from the key light: a warm fill
  // in front of the crank lights the rods (it goes with B.root)
  const fill = new THREE.PointLight(0xfff0dc, 9e4, 0, 2); fill.position.set(0, 320, -40); B.root.add(fill);

  const pRoot = q => q.root.position;
  // showFire: main.js turns the glow off while the parts spread apart
  const sc = {
    E, S, H, Rc, showFire: true,
    pose(th) {
      const Q = E.pose(th);
      cr.spin(th);
      const ang = Math.atan2(Q.P0[1] - Q.C[1], Q.P0[0] - Q.C[0]);
      pRoot(ms).set(...at(Q.C)); ms.spin(ang);
      for (const { i, p } of links) { const K = Q.K[i], P = Q.P[i]; pRoot(p).set(...at(K)); p.spin(Math.atan2(P[1] - K[1], P[0] - K[0])); }
      for (let i = 0; i < n; i++) {
        pRoot(pistons[i]).set(...at(Q.P[i]));
        const y = Q.s[i] + u.crown + 0.5, f = flames[i];
        pRoot(f.p).set(...at([E.ax[i][0] * y, E.ax[i][1] * y]));
        f.m.scale.y = Math.max(0.1, H - 0.5 - y);
        // the charge burns from 5 deg before firing TDC to 60 deg after
        const c = Q.cyc[i] * 180 / Math.PI, a = c > 715 ? 0 : c < 60 ? c : -1;
        f.m.visible = a >= 0 && sc.showFire;
        if (a >= 0) f.m.material.emissiveIntensity = 2.4 * (1 - a / 60) + 0.3;
      }
      cam.spin(Q.cam[0]);
      for (const { i, k, p } of tappets) { const r = rb + Q.lift[i][k] + 4.3; pRoot(p).set(...at([E.ax[i][0] * r, E.ax[i][1] * r], hTr[k])); }
      for (const { i, k, p, A0 } of pushes) { const L = Q.lift[i][k]; pRoot(p).set(...at([A0[0] + E.ax[i][0] * L, A0[1] + E.ax[i][1] * L], hTr[k])); }
      for (const { i, k, p } of rockers) p.spin(-Math.asin(Q.lift[i][k] / 25));
      return Q;
    },
    // R: the radius the camera frames (3.3 R at fov 30 holds the heads)
    box: { c: [0, -30, 40], R: 1.3 * (H + 90) },
    keys: { crank: [0, 20, 10], top: [0, H, 0], cam: [0, rb, 100] },
    floorY,
  };
  return sc;
}
