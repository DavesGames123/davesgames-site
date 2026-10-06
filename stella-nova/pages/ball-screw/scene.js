// ============================================================================
//  BALL SCREW & LEAD SCREW  ·  scene.js — the parts of one linear stage
// ----------------------------------------------------------------------------
//  build(B, id, L) makes one stage with kit.js and returns sc: { pose(psi,
//  load), box, keys, g }. Every thread surface and the ball loop come from
//  mech.js, so the threads, the nut travel and the balls that main.js moves
//  are the ones that tests.mjs checks.
//
//  LAYOUT (mm; y up, the screw axis on world x at y = 60, z toward you)
//    base plate ......... x -300..215, y -12..0, z -70..70
//    motor .............. x -296..-215 on a pedestal, coupled at x -200..-172
//    fixed end plate .... x -165..-137 (bearing cap on its outer face)
//    support end plate .. x  140.. 164
//    screw .............. thread x -135..135, journals r 6 to the plates;
//                         collars at the thread ends hide the run-out
//    guide rods ......... r 6 at z = +-48, y = 60
//    nut ................ flange y -25..-15, body -15..25 (nut frame);
//                         the nut frame rides at x = stroke().x
//    carriage ........... end plate on the flange (0.3 mm gap), bushings
//                         on the rods, a top table at y 100.3..110
//    ruler .............. on the base at z 58..68, zero under the pointer
//  Every part with the screw axis uses the frame u = +x, e0 = +y: local Y
//  is world x, local X is world y - 60, local Z is -world z.
//
//  Z-FIGHT RULES  (no two faces in one plane facing the same way)
//    nut thread ...... grown 0.3 mm in r and y from the screw (mech.js)
//    bores ........... 0.3-0.4 mm over their shaft or rod
//    stacked faces ... the motor body, flange and end cap differ in size
//                      and stand 0.3 mm apart; the carriage plate stands
//                      0.3 mm off the flange; the table 0.3 mm over the plate
//
//  GREP MAP
//    function threadStrip ..... the screw surface along the helix
//    function nutShell ........ nut bore surface, end rings and outside
//    function revolve ......... an open (r, y) profile turned about y
//    function ballParts ....... the balls and the return tubes
//    export function build .... the whole stage
//    sc.pose .................. every part from the drive phase
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { slab, rod, tube, poly, circle, hex, merge } from './kit.js';
import { unit, screw, screwProfile, nutR, stroke, circuit, ballAt, ballShift, TAU } from './mech.js';

const AXIS = 60;
const AX = { u: [1, 0, 0], e0: [0, 1, 0] };
const P3 = (r, phi, y) => [r * Math.cos(phi), y, -r * Math.sin(phi)];

function gridGeo(rows, cols, at, flip) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) { const [p, t] = at(i, j); pos.push(...p); uv.push(...t); }
  const w = cols + 1;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// indexed grids merge as they are (kit merge() would drop the index)
const mergeIdx = gs => { const m = mergeGeometries(gs, false); gs.forEach(x => x.dispose()); return m; };

// The screw surface for y in [y0, y1]: one strip per start and per profile
// segment, along the helix, so the flank corners stay sharp. Points past
// the ends fold onto the end planes; the collars hide them.
function threadStrip(g, y0, y1, perTurn = 56) {
  const segs = [];
  if (g.type === 'lead') for (let k = 1; k < g.knots.length; k++) segs.push([g.knots[k - 1][0], g.knots[k][0], 1]);
  else { const a = 0.5 - g.hw / g.p, b = 0.5 + g.hw / g.p; segs.push([0, a, 1], [a, b, 10], [b, 1, 1]); }
  const out = [];
  for (let j = 0; j < g.n; j++) {
    const fa = TAU * (y0 - g.p * (j + 1)) / g.L, fb = TAU * (y1 - g.p * j) / g.L;
    const cols = Math.ceil((fb - fa) / TAU * perTurn);
    for (const [s0, s1, m] of segs) {
      out.push(gridGeo(m, cols, (i, c) => {
        const s = s0 + (s1 - s0) * i / m, phi = fa + (fb - fa) * c / cols;
        const y = Math.max(y0, Math.min(y1, g.L * phi / TAU + g.p * (j + s)));
        const r = screwProfile(g, Math.min(s, 1 - 1e-9));
        return [P3(r, phi, y), [phi / TAU, s]];
      }, false));
    }
  }
  return mergeIdx(out);
}

// an open profile [[r, y], ...] turned about y; each span is its own band
// so the corners stay sharp. Listed bottom to top on the outside: faces out.
function revolve(pts, seg = 96) {
  const out = [];
  for (let k = 1; k < pts.length; k++) {
    const [ra, ya] = pts[k - 1], [rb, yb] = pts[k];
    out.push(gridGeo(1, seg, (i, c) => { const phi = TAU * c / seg, r = i ? rb : ra, y = i ? yb : ya; return [P3(r, phi, y), [c / seg, i]]; }, false));
  }
  return mergeIdx(out);
}

// the nut: bore surface r = nutR(y, phi) for y in [y0, y1], the two end
// rings out to the outside profile, and the outside (revolve)
function nutShell(g, y0, y1, outside, seg = 128) {
  const rows = Math.ceil((y1 - y0) / g.p * 28);
  const bore = gridGeo(rows, seg, (i, c) => { const y = y0 + (y1 - y0) * i / rows, phi = TAU * c / seg; return [P3(nutR(g, y, phi), phi, y), [c / seg, y / 20]]; }, true);
  const ring = (y, R, up) => gridGeo(1, seg, (i, c) => { const phi = TAU * c / seg, r = i ? R : nutR(g, y, phi); return [P3(r, phi, y), [c / seg, i]]; }, up);
  return mergeIdx([bore, ring(y0, outside[0][0], false), ring(y1, outside[outside.length - 1][0], true), revolve(outside, seg)]);
}

const boxGeo = (x0, x1, y0, y1, z0, z1) => { const b = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); b.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return b; };
const rrect = (w, h, r) => {
  const s = new THREE.Shape(), x = w / 2, y = h / 2;
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.quadraticCurveTo(x, -y, x, -y + r); s.lineTo(x, y - r); s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y); s.quadraticCurveTo(-x, y, -x, y - r); s.lineTo(-x, -y + r); s.quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
};
// a slab across the screw axis: shape in (world y - 60, world z), from x0 to x1
const across = (shape, x0, x1, bevel = 0.6) => slab(shape, x0, x1 - x0, bevel);

// ── balls and return tubes ──────────────────────────────────────────────────
function ballParts(B, g, rBody, xNut) {
  const C = circuit(g, rBody, 5);
  const balls = B.part('balls', { info: 'balls', label: 'Balls', labelAt: [-14, 5, -14], at: [xNut, AXIS, 0], ...AX, explode: [0, 60, 90], st: 0.3, en: 0.9 });
  const sphere = new THREE.SphereGeometry(g.Db / 2, 14, 10);
  const im = B.instanced(balls, sphere, 'steel', C.nb * g.n);
  const tubeP = B.part('tube', { info: 'tube', label: 'Return tube', labelAt: [C.Rt + 6, 5, 0], at: [xNut, AXIS, 0], ...AX, explode: [0, 125, 0], st: 0.3, en: 0.9 });
  // the tube shows where its centre is out of the bore, clear of the screw
  const keep = C.tube.filter(p => Math.hypot(p[0], p[2]) >= g.rBore + C.rt + 0.5).map(p => new THREE.Vector3(...p));
  for (let j = 0; j < g.n; j++) {
    const curve = new THREE.CatmullRomCurve3(keep);
    const tg = new THREE.TubeGeometry(curve, 80, C.rt, 14, false);
    tg.rotateY(TAU * j / g.n);
    B.mesh(tubeP, tg, 'steel');
    // two clamp straps over the tube legs, held by screws in the body
    for (const f of [0.22, 0.78]) {
      const q = curve.getPointAt(f), ph = Math.atan2(-q.z, q.x) + TAU * j / g.n;
      const strap = boxGeo(rBody - 1.5, rBody + 2 * C.rt + 1.2, -2.5, 2.5, -C.rt - 3, C.rt + 3);
      strap.rotateY(ph); strap.translate(0, q.y, 0);
      B.mesh(tubeP, strap, 'bolt');
    }
  }
  const M = new THREE.Matrix4(), v = new THREE.Vector3();
  return {
    C, balls, tubeP,
    pose(theta) {
      const sh = ballShift(g, C, theta);
      let k = 0;
      for (let j = 0; j < g.n; j++) {
        const b = TAU * j / g.n, cb = Math.cos(b), sb = Math.sin(b);
        for (let i = 0; i < C.nb; i++) {
          const [X, Y, Z] = ballAt(g, C, i * C.sp + sh);
          v.set(X * cb + Z * sb, Y, Z * cb - X * sb);
          M.makeTranslation(v.x, v.y, v.z); im.setMatrixAt(k++, M);
        }
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    },
  };
}

export function build(B, id, L) {
  const u = unit(id), g = screw(u, L ?? u.L), ball = g.type === 'ball';
  const rBody = ball ? 18 : 17;

  // base plate, motor pedestal and the travel ruler
  const base = B.part('base', { info: 'base', label: 'Base plate', labelAt: [190, 0, 58], explode: [0, -70, 0], st: 0, en: 0.5 });
  B.mesh(base, slab(rrect(515, 140, 6), -12, 12, 1.2).translate(-42.5, 0, 0), 'paint');
  B.mesh(base, boxGeo(-285, -228, 0, 31.7, -24, 24), 'cast');
  const ZERO = -31.4;   // the pointer hangs from the middle of the carriage plate
  B.mesh(base, boxGeo(ZERO - 84, ZERO + 84, 0, 3, 58, 68), 'alu');
  const ticks = [];
  for (let k = -8; k <= 8; k++) { const long = k % 5 === 0, x = ZERO + 10 * k; ticks.push(boxGeo(x - 0.45, x + 0.45, 3, 3.5, long ? 58.5 : 63, 67.5)); }
  B.mesh(base, merge(ticks), 'bolt');

  // motor (flange toward the screw), its shaft and the coupling
  const motor = B.part('motor', { info: 'motor', label: 'Stepper motor', labelAt: [32, -255, 0], at: [0, AXIS, 0], ...AX, explode: [-95, 0, 0], st: 0.1, en: 0.7 });
  B.mesh(motor, across(rrect(56, 56, 7), -290, -222.3, 1.2), 'bolt');
  B.mesh(motor, across(rrect(51, 51, 6), -296, -290, 0.8), 'cast');
  B.mesh(motor, across(rrect(60, 60, 4), -222, -215, 0.8), 'alu');
  B.mesh(motor, tube(4.4, 11, -215, -212, 48), 'alu');
  const mshaft = B.part('motorShaft', { info: 'motor', at: [0, AXIS, 0], ...AX, explode: [-95, 0, 0], st: 0.1, en: 0.7 });
  B.mesh(mshaft, rod(4, -214, -188, 24), 'shaft');
  const coup = B.part('coupling', { info: 'coupling', label: 'Jaw coupling', labelAt: [16, -186, 0], at: [0, AXIS, 0], ...AX, explode: [-45, 45, 0], st: 0.2, en: 0.8 });
  B.mesh(coup, tube(4.3, 12, -200, -187, 48), 'alu');
  B.mesh(coup, tube(6.3, 12, -185, -172, 48), 'alu');
  B.mesh(coup, tube(4.3, 11, -187, -185, 48), 'red');
  B.mesh(coup, boxGeo(11.6, 13.4, -182, -175, -1.5, 1.5), 'red');

  // end plates with the bearings, and the guide rods
  const plate = (id2, x0, x1, label, cap) => {
    const p = B.part(id2, { info: 'endplate', label, labelAt: [(x0 + x1) / 2, 92, 0], explode: [0, 95, 0], st: 0.2, en: 0.8 });
    B.mesh(p, boxGeo(x0, x1, 0, 90, -62, 62), 'alu');
    const c = tube(6.3, 15, cap[0], cap[1], 48); c.rotateZ(-Math.PI / 2); c.translate(0, AXIS, 0); B.mesh(p, c, 'bolt');
    for (const z of [-40, 40]) B.mesh(p, hex(4.5, 90, 4).translate((x0 + x1) / 2, 0, z), 'bolt');
    return p;
  };
  plate('plateF', -165, -137, 'Fixed bearing end', [-169, -165]);
  plate('plateS', 140, 164, 'Support bearing end', [164, 168]);
  const rails = B.part('rails', { info: 'rails', label: 'Guide rods', labelAt: [0, 115, 0], at: [0, AXIS, 0], ...AX, explode: [0, 0, 0] });
  for (const z of [-48, 48]) B.mesh(rails, rod(6, -163, 162, 32).translate(0, 0, -z), 'shaft');

  // the screw: thread, journals, collars
  const scr = B.part('screw', { info: 'screw', label: ball ? 'Ball screw' : 'Lead screw', labelAt: [g.rOut + 4, 110, 0], at: [0, AXIS, 0], ...AX, explode: [0, 0, 0] });
  B.mesh(scr, threadStrip(g, -135, 135), 'steel');
  B.mesh(scr, rod(6, -184, 156, 32), 'shaft');
  // locknut sleeves over the thread ends: the bore is 0.4 mm over the
  // crest and the thread stops 1 mm short of the end wall, so the thread
  // run-out is hidden and no thread face lies in a sleeve face
  const Rc = g.rMaj + 3, ri = g.rMaj + 0.4;
  B.mesh(scr, poly([[Rc, 131], [Rc, 139], [6.3, 139], [6.3, 136], [ri, 136], [ri, 131]], 64), 'bolt');
  B.mesh(scr, poly([[Rc, -139], [Rc, -131], [ri, -131], [ri, -136], [6.3, -136], [6.3, -139]], 64), 'bolt');

  // the nut (nut frame: flange -25..-15, body -15..25)
  const nut = B.part('nut', { info: 'nut', label: ball ? 'Ball nut' : 'Bronze nut', labelAt: [rBody + 6, 18, 0], at: [0, AXIS, 0], ...AX, explode: [0, 70, 0], st: 0.25, en: 0.85, cut: true, cutY: AXIS });
  B.mesh(nut, nutShell(g, -25, 25, [[24, -25], [24, -15], [rBody, -15], [rBody, 25]]), ball ? 'gear' : 'bronze');
  for (let k = 0; k < 4; k++) { const a = TAU * (k + 0.5) / 4; B.mesh(nut, hex(3, -15, 3).translate(21.3 * Math.cos(a), 0, -21.3 * Math.sin(a)), 'bolt'); }
  let bp = null;
  if (ball) bp = ballParts(B, g, rBody, 0);
  else {
    // a grease nipple on the bronze body
    const gn = rod(2.2, rBody - 1, rBody + 5, 16); gn.rotateZ(-Math.PI / 2); gn.translate(0, 8, 0);
    B.mesh(nut, merge([gn, hex(3.2, 0, 3).rotateZ(-Math.PI / 2).translate(rBody + 1, 8, 0)]), 'brass');
  }

  // the carriage: end plate on the flange, bushings, table, ruler pointer
  const car = B.part('carriage', { info: 'carriage', label: 'Carriage', labelAt: [52, -8, 0], at: [0, AXIS, 0], ...AX, explode: [0, 150, 0], st: 0.3, en: 1, cut: true, cutY: AXIS });
  const cp = rrect(78, 124, 4); cp.holes.push(circle(13));
  const cg = across(cp, -37.6, -25.3, 0.8); cg.translate(1, 0, 0);   // plate spans world y 22..100
  B.mesh(car, cg, 'alu');
  for (const z of [-48, 48]) B.mesh(car, tube(6.4, 11, -45, -14, 40).translate(0, 0, -z), 'bronze');
  B.mesh(car, boxGeo(40.3, 50, -45, 30, -62, 62), 'alu');
  B.mesh(car, boxGeo(-55, -20, -32.4, -30.4, -66.5, -62.3), 'red');
  // the load arrow on the table (one for each sense)
  const arrow = sgn => { const a = merge([rod(2.6, 0, 37.5, 16), new THREE.ConeGeometry(7, 14, 24).translate(0, 44, 0)]); if (sgn < 0) a.rotateZ(Math.PI); a.translate(60, sgn > 0 ? 10 : -25, 0); return a; };
  const loadP = B.part('load', { info: 'load', label: 'Load F', labelAt: [74, 0, 0], parent: car.root, explode: [0, 0, 0] });
  const aPlus = B.mesh(loadP, arrow(1), 'red'), aMinus = B.mesh(loadP, arrow(-1), 'red');

  const movers = [nut, car, ...(bp ? [bp.balls, bp.tubeP] : [])];
  const keys = { nut: [0, AXIS, 0], motor: [-250, AXIS, 0] };
  return {
    g, C: bp && bp.C,
    pose(psi, load = 0) {
      const S = stroke(g, psi);
      scr.spin(S.theta); coup.spin(S.theta); mshaft.spin(S.theta);
      for (const p of movers) p.root.position.x = S.x;
      if (bp) bp.pose(S.theta);
      keys.nut[0] = S.x;
      // load: 0 none, +1 against the motion (motor drives), -1 with it
      const fx = load * S.dir;                      // nut velocity sign is -dir
      aPlus.visible = load !== 0 && fx > 0; aMinus.visible = load !== 0 && fx < 0;
      return S;
    },
    box: { c: [-64, 50, 0], R: 290 },
    keys,
  };
}
