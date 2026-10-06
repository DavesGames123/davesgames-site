// ============================================================================
//  STEAM LOCOMOTIVE  ·  scene.js — the parts of the engine and their pose
// ----------------------------------------------------------------------------
//  build(B) makes the right side of the engine with kit.js and returns sc:
//  { pose(phi, c), box, keys, steam(colours) }. Every joint comes from
//  mech.js makeGear(), so the rods that main.js moves are the ones that
//  tests.mjs checks.
//
//  FRAMES. A mech.js point (X, Y) at depth z is [X, z, -Y] in the B.root
//  frame. B.root turns +90 deg about x, so the world is X forward, Y up
//  and z toward the viewer (out from the side of the engine). Flat parts
//  are slabs in (X, Y) that stand out in z; a bar lies along its local +X
//  and turns about z by spin(). Round parts on the cylinder axis are
//  lathes about local y with u = [1, 0, 0] (along X).
//
//  LAYERS (z, mm). No two parts share a face plane where they overlap:
//    frame plate -300..-270 · tyre -140..0 · spokes -90..-40 (inside the
//    balance weight, -96..-34) · link bracket -268..268
//    coupling rods 46..96 (front) and 54..104 (rear) · main rod 115..170
//    return crank 185..225 · eccentric rod 235..265 · link 275..335
//    die block 285..325 (inside the slot) · radius rod 345..375
//    lifting link 385..410 · weigh shaft arms 420..450 · reach rod 460..485
//    combination lever 300..330 · union link 340..365 · drop arm 226..295
//    cylinder and valve axis z 160; section plane z 160
//  Parallel faces that face each other are 7 mm or more apart (0.1 % of
//  the model radius is 6.2 mm). The piston and the valve heads sit 7 and
//  6.5 mm inside their bores. Faces that meet end to end run into each
//  other (a boiler into the smokebox, a slide bar into the cylinder
//  cover) instead of meeting flush.
//
//  GREP MAP
//    function bar ............. a rod with round ends and two eyes
//    function wheel ........... tyre, spokes, hub, balance weight, crank boss
//    function linkShape ....... the curved expansion link with its slot
//    function body ............ frames, running board, boiler, cab, track
//    export function build .... all parts, then pose()
// ============================================================================
import * as THREE from 'three';
import { slab, rod, lathe, poly, circle, merge } from './kit.js';
import { G, makeGear, slotPoint } from './mech.js';

const L3 = (x, y, z) => [x, z, -y];
const ZC = 160;            // cylinder and valve axis, and the section plane
const HS = 400, HL = G.LAP + G.PORT;   // valve head centres +-HS, head length
const CYL = { x0: 4480, x1: 5420, bore0: 4520, bore1: 5380, ro: 310, ri: 235 };
const CHEST = { x0: 4300, x1: 5500, y: G.YV, ro: 185, ri: 130 };
const SLEEPER = 700;

// a bar of length len along +X: round ends of radius w/2 (w1 at the far
// end), eyes of radius hole, from depth z0 to z1
function bar(len, w, z0, z1, hole, w1 = w) {
  const a = w / 2, b = w1 / 2, s = new THREE.Shape();
  s.moveTo(0, -a); s.lineTo(len, -b); s.absarc(len, 0, b, -Math.PI / 2, Math.PI / 2, false); s.lineTo(0, a); s.absarc(0, 0, a, Math.PI / 2, 3 * Math.PI / 2, false);
  if (hole) s.holes.push(circle(hole, 0, 0), circle(hole, len, 0));
  return slab(s, z0, z1 - z0, Math.min(4, (z1 - z0) / 6));
}
// a pin along z at (x, y) of the part frame
function pin(r, z0, z1, x = 0, y = 0) { const g = rod(r, z0, z1, 24); g.translate(x, 0, -y); return g; }
const box = (x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, z1 - z0, y1 - y0); g.translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2); return g; };

function wheel() {
  const R = G.WHEEL_R, gs = [];
  // tyre with its flange on the inner side (toward the frames)
  gs.push(poly([[860, -140], [1000, -140], [1000, -120], [R, -110], [R, 0], [860, 0]], 96));
  // 16 spokes, slightly tapered, from hub to rim
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, s = new THREE.Shape(), ca = Math.cos(a), sa = Math.sin(a);
    const pt = (r, w) => [r * ca - w * sa, r * sa + w * ca];
    const q = [pt(200, -42), pt(880, -26), pt(880, 26), pt(200, 42)];
    s.moveTo(...q[0]); for (const p of q.slice(1)) s.lineTo(...p);
    gs.push(slab(s, -90, 50, 3));
  }
  // hub and axle end
  gs.push(lathe([[[235, -120], [235, 20], [120, 34], [0, 34], [0, -120]]], 48));
  return gs;
}
function weight() {
  // balance weight: a crescent between the spokes, opposite the crank pin
  const s = new THREE.Shape(), a0 = Math.PI - 0.95, a1 = Math.PI + 0.95;
  s.absarc(0, 0, 840, a0, a1, false); s.absarc(0, 0, 330, a1, a0, true);
  return slab(s, -96, 62, 4);
}

// the expansion link in its own frame: K at the origin, the slot arc of
// radius Rr bending toward +X, the foot F at (0, -a)
function slotAt(s, off) {
  const b = s / G.Rr;
  return [G.Rr * (1 - Math.cos(b)) + off * Math.cos(b), -G.Rr * Math.sin(b) + off * Math.sin(b)];
}
function linkShape() {
  const sh = new THREE.Shape(), N = 24, S0 = -300, S1 = 300, W = 70;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(slotAt(S0 + (S1 - S0) * i / N, -W));
  // the tail down to the foot, on the -X side of the slot line
  pts.push([-40, -G.a + 10], [-20, -G.a - 40], [40, -G.a - 40], [70, -G.a + 10]);
  for (let i = N; i >= 0; i--) pts.push(slotAt(S0 + (S1 - S0) * i / N, W));
  sh.moveTo(...pts[0]); for (const p of pts.slice(1)) sh.lineTo(...p);
  const hole = new THREE.Path(), hp = [], HM = 262, hw = 36;
  for (let i = 0; i <= N; i++) hp.push(slotAt(-HM + 2 * HM * i / N, -hw));
  for (let i = N; i >= 0; i--) hp.push(slotAt(-HM + 2 * HM * i / N, hw));
  hole.moveTo(...hp[0]); for (const p of hp.slice(1)) hole.lineTo(...p);
  sh.holes.push(hole);
  return sh;
}

export function build(B) {
  const gear = makeGear(), P0 = gear.pose(0, 1);
  B.root.rotation.x = Math.PI / 2;
  // explode offsets below are in mm of the B.root frame (y = world z); x1.6
  const part = (id, o) => B.part(id, { ...o, explode: (o.explode || [0, 0, 0]).map(v => v * 1.6) });

  // ── track: rail and sleepers ───────────────────────────────────────────
  const track = part('track', { info: 'track', label: 'Track', labelAt: L3(-2600, -1000, 300), explode: [0, 0, 600], st: 0, en: 0.4 });
  B.mesh(track, box(-6400, 8000, -1090, -947, -95, -35), 'shaft');           // rail head and web
  B.mesh(track, box(-6400, 8000, -1098, -1082, -125, -5), 'shaft');          // rail foot
  const sleepers = part('sleepers', { info: 'track', explode: [0, 0, 600], st: 0, en: 0.4 });
  const sl = [];
  for (let x = -5600; x <= 7700; x += SLEEPER) sl.push(box(x - 130, x + 130, -1240, -1106, -1600, 420));
  B.mesh(sleepers, merge(sl), 'cast');

  // ── frames, running board, boiler, cab ─────────────────────────────────
  const frame = part('frame', { info: 'frame', label: 'Frames', labelAt: L3(-2400, 600, -270), explode: [0, -700, 0], st: 0, en: 0.45 });
  const fs = new THREE.Shape([[-3600, -350], [5660, -350], [5660, 1040], [-3600, 1040]].map(p => new THREE.Vector2(...p)));
  for (const ax of [-G.PITCH, 0, G.PITCH]) fs.holes.push(circle(140, ax, 0));
  B.mesh(frame, slab(fs, -300, 30, 3), 'paint');
  for (const ax of [-G.PITCH, 0, G.PITCH]) { B.mesh(frame, box(ax - 230, ax + 230, -260, 260, -262, -150), 'cast'); B.mesh(frame, pin(110, -800, -150, ax, 0), 'shaft'); }
  B.mesh(frame, box(-3600, 5660, 1050, 1080, -2000, 230), 'paint');            // running board
  B.mesh(frame, box(5650, 5750, 450, 1000, -2000, 430), 'red');                // buffer beam
  // buffer: a lathe about local y, turned onto +X, at height 760 and z 83
  B.mesh(frame, lathe([[[0.1, 5740], [90, 5740], [90, 5990], [210, 6000], [210, 6060], [0.1, 6060]]], 40).rotateZ(-Math.PI / 2).translate(0, 83, -760), 'bolt');
  // expansion link bracket from above, behind the link (z 255..268 at K)
  B.mesh(frame, box(G.K[0] - 70, G.K[0] + 70, G.K[1] + 30, 1040, -268, 268), 'cast');
  // weigh shaft bracket on the running board
  B.mesh(frame, box(G.W[0] - 70, G.W[0] + 70, 1090, G.W[1] - 30, -40, 30), 'cast');
  // slide bars: above and below the crosshead, into the cylinder cover
  B.mesh(frame, box(3150, CYL.x0 + 40, 140, 190, 105, 215), 'steel');
  B.mesh(frame, box(3150, CYL.x0 + 40, -190, -140, 105, 215), 'steel');
  // slide bar brackets at the rear end (the main rod passes between them)
  B.mesh(frame, box(3140, 3230, 186, 260, 98, 222), 'cast');
  B.mesh(frame, box(3140, 3230, -260, -186, 98, 222), 'cast');

  const body = part('body', { info: 'body', label: 'Boiler', labelAt: L3(1500, 2900, 0), explode: [0, -1400, -900], st: 0, en: 0.45 });
  const bodyAt = (g, y, z) => { g.translate(0, z, -y); return g; };
  // boiler, smokebox and door: lathes about local y, turned onto +X
  const along = (runs, seg) => lathe(runs, seg).rotateZ(-Math.PI / 2);
  B.mesh(body, bodyAt(along([[[0.1, -1500], [800, -1500], [800, 4340], [0.1, 4340]]], 72), 1950, -787), 'paint');
  B.mesh(body, bodyAt(along([[[0.1, 4300], [850, 4300], [850, 5600], [0.1, 5600]]], 72), 1950, -787), 'bolt');
  B.mesh(body, bodyAt(along([[[0.1, 5590], [760, 5590], [740, 5640], [0.1, 5650]]], 72), 1950, -787), 'bolt');
  // boiler bands: rings 6 mm proud of the boiler
  for (const x of [200, 1500, 2800, 4000]) B.mesh(body, bodyAt(along([[[790, x], [806, x], [806, x + 60], [790, x + 60]]], 72), 1950, -787), 'brass');
  // chimney and dome: lathes about local y, upright
  const up = (runs, x, z = -787, seg = 40) => { const g = lathe(runs, seg); g.rotateX(-Math.PI / 2); g.translate(x, z, 0); return g; };
  const chim = up([[[260, 2500], [260, 3600], [330, 3640], [330, 3720], [0.1, 3720]]], 5000);
  const dome = up([[[400, 2500], [400, 2900], [300, 3120], [150, 3200], [0.1, 3210]]], 1500);
  B.mesh(body, chim, 'bolt'); B.mesh(body, dome, 'brass');
  // cab: side sheet with a window, front sheet, roof
  const cs = new THREE.Shape([[-3600, 1090], [-1500, 1090], [-1500, 3410], [-3600, 3410]].map(p => new THREE.Vector2(...p)));
  const win = new THREE.Path(); win.moveTo(-3200, 2300); win.lineTo(-2000, 2300); win.lineTo(-2000, 3050); win.lineTo(-3200, 3050); win.closePath(); cs.holes.push(win);
  B.mesh(body, slab(cs, 525, 30, 3), 'paint');
  B.mesh(body, box(-1530, -1490, 1090, 3410, -2100, 520), 'paint');
  B.mesh(body, box(-3700, -1420, 3400, 3480, -2160, 600), 'bolt');

  // ── wheels ─────────────────────────────────────────────────────────────
  const wheels = [-1, 0, 1].map(k => {
    const id = k === 0 ? 'wheelMain' : k < 0 ? 'wheelRear' : 'wheelFront';
    const q = part(id, { info: 'wheel', label: k === 0 ? 'Driving wheel' : null, labelAt: L3(0, -720, 60), at: L3(k * G.PITCH, 0, 0), explode: [0, 60, 0], st: 0.05, en: 0.55 });
    const [tyre, ...centre] = wheel();
    B.mesh(q, tyre, 'steel');
    B.mesh(q, merge(centre), 'paint');
    B.mesh(q, weight(), 'cast');
    // crank boss and crank pin
    B.mesh(q, lathe([[[150, -60], [150, 38], [0.1, 38], [0.1, -60]]], 40).translate(G.r, 0, 0), 'cast');
    B.mesh(q, pin(68, 30, k === 0 ? 232 : 112, G.r, 0), 'shaft');
    return q;
  });

  // ── rods ───────────────────────────────────────────────────────────────
  const coupF = part('coupF', { info: 'coupling', label: 'Coupling rod', labelAt: L3(G.PITCH / 2, 90, 100), explode: [0, 220, 0], st: 0.1, en: 0.6 });
  B.mesh(coupF, bar(G.PITCH, 150, 46, 96, 70, 130), 'motion');
  const coupR = part('coupR', { info: 'coupling', explode: [0, 220, 0], st: 0.1, en: 0.6 });
  B.mesh(coupR, bar(G.PITCH, 130, 54, 104, 70, 150), 'motion');
  const mainRod = part('mainRod', { info: 'mainrod', label: 'Main rod', labelAt: L3(G.L * 0.5, 100, 170), explode: [0, 420, 0], st: 0.12, en: 0.65 });
  B.mesh(mainRod, bar(G.L, 230, 115, 170, 70, 160), 'motion');
  const retC = part('retC', { info: 'retcrank', label: 'Return crank', labelAt: L3(200, 0, 225), explode: [0, 620, 0], st: 0.15, en: 0.7 });
  const lenRC = Math.hypot(P0.J.E[0] - P0.J.C[0], P0.J.E[1] - P0.J.C[1]);
  B.mesh(retC, bar(lenRC, 190, 185, 225, 0, 110), 'bronze');
  B.mesh(retC, pin(50, 220, 275, lenRC, 0), 'shaft');
  const ecc = part('ecc', { info: 'eccrod', label: 'Eccentric rod', labelAt: L3(G.Le * 0.5, 60, 265), explode: [0, 760, 0], st: 0.18, en: 0.72 });
  B.mesh(ecc, bar(G.Le, 110, 235, 265, 50, 90), 'motion');

  // ── expansion link, die block, radius rod, lever, union link ──────────
  const link = part('link', { info: 'link', label: 'Expansion link', labelAt: L3(0, 330, 335), at: L3(G.K[0], G.K[1], 0), explode: [0, 900, 0], st: 0.2, en: 0.75 });
  B.mesh(link, slab(linkShape(), 275, 60, 4), 'motion');
  B.mesh(link, pin(55, 262, 345), 'shaft');                       // trunnion
  B.mesh(link, pin(48, 228, 345, 0, -G.a), 'shaft');               // foot pin
  const die = part('die', { info: 'die', label: 'Die block', labelAt: L3(0, -80, 325), explode: [0, 1040, 0], st: 0.22, en: 0.78 });
  { const s = new THREE.Shape(); s.moveTo(-35, -58); s.lineTo(35, -58); s.lineTo(35, 58); s.lineTo(-35, 58); s.closePath(); B.mesh(die, slab(s, 285, 40, 3), 'bronze'); }
  B.mesh(die, pin(42, 280, 420), 'shaft');
  const radius = part('radius', { info: 'radius', label: 'Radius rod', labelAt: L3(G.Rr * 0.55, 80, 375), explode: [0, 1180, 0], st: 0.24, en: 0.8 });
  B.mesh(radius, bar(G.Rr, 120, 345, 375, 44, 110), 'motion');
  const lever = part('lever', { info: 'lever', label: 'Combination lever', labelAt: L3(500, 120, 330), explode: [0, 1100, 0], st: 0.24, en: 0.8 });
  B.mesh(lever, bar(G.cv + G.cu, 120, 300, 330, 0, 100), 'motion');
  B.mesh(lever, pin(42, 292, 385), 'shaft');
  B.mesh(lever, pin(38, 160, 338, G.cv, 0), 'shaft');
  B.mesh(lever, pin(40, 292, 372, G.cv + G.cu, 0), 'shaft');
  const union = part('union', { info: 'union', label: 'Union link', labelAt: L3(G.Lu * 0.5, -70, 365), explode: [0, 1250, 0], st: 0.26, en: 0.82 });
  B.mesh(union, bar(G.Lu, 100, 340, 365, 36, 90), 'motion');

  // ── reverser: weigh shaft, lifting link, reach rod ─────────────────────
  const weigh = part('weigh', { info: 'weigh', label: 'Weigh shaft', labelAt: L3(0, 120, 450), at: L3(G.W[0], G.W[1], 0), explode: [0, 1400, 0], st: 0.28, en: 0.85 });
  B.mesh(weigh, bar(G.LA, 110, 420, 450, 0, 80), 'cast');
  // the second arm is thinner, so its faces sit inside the first arm
  { const g = bar(G.LR, 100, 426, 444, 0, 80); g.rotateY(Math.PI / 2); B.mesh(weigh, g, 'cast'); }
  B.mesh(weigh, pin(62, 0, 455), 'shaft');
  B.mesh(weigh, pin(38, 380, 456, G.LA, 0), 'shaft');
  { const g = pin(36, 418, 490); g.translate(0, 0, -G.LR); B.mesh(weigh, g, 'shaft'); }
  const lift = part('lift', { info: 'lifting', label: 'Lifting link', labelAt: L3(G.LL * 0.5, 50, 410), explode: [0, 1330, 0], st: 0.28, en: 0.85 });
  B.mesh(lift, bar(G.LL, 90, 385, 410, 40, 90), 'motion');
  const reach = part('reach', { info: 'reach', label: 'Reach rod', labelAt: L3(-1300, 60, 485), explode: [0, 1500, 0], st: 0.3, en: 0.9 });
  { const g = bar(2600, 70, 460, 485, 38, 70); g.rotateY(Math.PI); B.mesh(reach, g, 'steel'); }

  // ── crosshead, piston, valve ───────────────────────────────────────────
  const xh = part('xh', { info: 'crosshead', label: 'Crosshead', labelAt: L3(0, 150, 220), explode: [0, 520, 0], st: 0.15, en: 0.7 });
  B.mesh(xh, box(-180, 180, -130, 130, 100, 232), 'bronze');
  B.mesh(xh, box(-45, 45, -G.hd - 50, -110, 226, 295), 'cast');    // drop arm, outside the slide bars
  B.mesh(xh, pin(55, 92, 240), 'shaft');                          // gudgeon pin
  B.mesh(xh, pin(36, 262, 372, 0, -G.hd), 'shaft');               // union link pin
  const piston = part('piston', { info: 'piston', label: 'Piston', labelAt: L3(G.ROD_PISTON, 260, ZC), explode: [0, 820, 0], st: 0.15, en: 0.7 });
  { const g = lathe([[[50, 160], [50, G.ROD_PISTON], [0.1, G.ROD_PISTON], [0.1, 160]]], 32); g.rotateZ(-Math.PI / 2); g.translate(0, ZC, 0); B.mesh(piston, g, 'shaft'); }
  // piston 7 mm inside the bore (radius 235): no coaxial faces at one radius
  { const g = lathe([[[224, G.ROD_PISTON - 60], [228, G.ROD_PISTON - 50], [228, G.ROD_PISTON + 50], [224, G.ROD_PISTON + 60], [0.1, G.ROD_PISTON + 60], [0.1, G.ROD_PISTON - 60]]], 64); g.rotateZ(-Math.PI / 2); g.translate(0, ZC, 0); B.mesh(piston, g, 'steel'); }
  const valve = part('valve', { info: 'valve', label: 'Piston valve', labelAt: L3(G.SPINDLE, 170, ZC), explode: [0, 980, 0], st: 0.2, en: 0.75 });
  {
    // valve spool along +X from the spindle pin V: spindle, two heads
    const vc = G.SPINDLE, h0 = vc - HS - HL / 2, h1 = vc + HS + HL / 2;
    const sp = lathe([[[34, 0], [34, h0], [0.1, h0], [0.1, 0]]], 24); sp.rotateZ(-Math.PI / 2); sp.translate(0, ZC, 0); B.mesh(valve, sp, 'shaft');
    const core = lathe([[[60, h0 + 4], [60, h1 - 4], [0.1, h1 - 4], [0.1, h0 + 4]]], 32); core.rotateZ(-Math.PI / 2); core.translate(0, ZC, 0); B.mesh(valve, core, 'shaft');
    for (const sg of [-1, 1]) {
      const a = vc + sg * HS - HL / 2, b = vc + sg * HS + HL / 2;
      // heads 6.5 mm inside the liner (radius 130)
      const g = lathe([[[120, a], [123.5, a + 5], [123.5, b - 5], [120, b], [0.1, b], [0.1, a]]], 64); g.rotateZ(-Math.PI / 2); g.translate(0, ZC, 0); B.mesh(valve, g, 'brass');
    }
    // spindle crosshead: the arm out to the lever pin
    B.mesh(valve, box(-45, 45, -45, 45, 150, 290), 'cast');
  }

  // ── cylinder and steam chest (cut open at z 160) ───────────────────────
  const cyl = part('cyl', { info: 'cylinder', label: 'Cylinder', labelAt: L3((CYL.x0 + CYL.x1) / 2, -CYL.ro - 60, ZC), cut: ZC, explode: [0, 300, 0], st: 0.1, en: 0.6 });
  { const g = poly([[55, CYL.x0], [CYL.ro, CYL.x0], [CYL.ro, CYL.x1], [0.1, CYL.x1], [0.1, CYL.bore1], [CYL.ri, CYL.bore1], [CYL.ri, CYL.bore0], [55, CYL.bore0]], 72); g.rotateZ(-Math.PI / 2); g.translate(0, ZC, 0); B.mesh(cyl, g, 'cast'); }
  const chest = part('chest', { info: 'chest', label: 'Steam chest', labelAt: L3((CHEST.x0 + CHEST.x1) / 2, CHEST.y + CHEST.ro + 60, ZC), cut: ZC, explode: [0, 300, 0], st: 0.1, en: 0.6 });
  { const g = poly([[45, CHEST.x0], [CHEST.ro, CHEST.x0], [CHEST.ro, CHEST.x1], [0.1, CHEST.x1], [0.1, CHEST.x1 - 40], [CHEST.ri, CHEST.x1 - 40], [CHEST.ri, CHEST.x0 + 40], [45, CHEST.x0 + 40]], 64); g.rotateZ(-Math.PI / 2); g.translate(0, ZC, -CHEST.y); B.mesh(chest, g, 'cast'); }
  // the steam pipe from the smokebox down into the top of the chest
  B.mesh(chest, up([[[70, CHEST.y + CHEST.ro - 30], [70, 1100], [0.1, 1100], [0.1, CHEST.y + CHEST.ro - 30]]], 4900, ZC, 32), 'cast');

  // ── coloured insides: ports, the steam between the valve heads, the two
  // cylinder ends. Half-solids behind the section plane (z <= 157), with
  // their own flat faces facing the viewer.
  const V0c = gear.V0 + G.SPINDLE;
  const portX = sg => (sg > 0 ? [V0c + HS - HL / 2 + G.LAP, V0c + HS + HL / 2] : [V0c - HS - HL / 2, V0c - HS + HL / 2 - G.LAP]);
  const ports = part('ports', { info: 'ports', explode: [0, 300, 0], st: 0.1, en: 0.6 });
  const portMesh = sg => {
    const [a, b] = portX(sg), lo = sg > 0 ? [CYL.bore1 - 38, CYL.bore1 - 2] : [CYL.bore0 + 2, CYL.bore0 + 38];
    const s = new THREE.Shape([[a, CHEST.y - CHEST.ri - 2], [lo[0], CYL.ri - 10], [lo[1], CYL.ri - 10], [b, CHEST.y - CHEST.ri - 2]].map(p => new THREE.Vector2(...p)));
    return B.mesh(ports, slab(s, 70, 80, 2), 'rubber', { shadow: false });
  };
  const portF = portMesh(1), portR = portMesh(-1);
  // a flat block of unit length in x, its face at z ZC - 3; main.js
  // stretches it between the piston and a cover, or between the heads
  const steam = part('steam', { info: 'steam', explode: [0, 300, 0], st: 0.1, en: 0.6 });
  const mkGas = (h, y) => B.mesh(steam, box(0, 1, y - h, y + h, ZC - 23, ZC - 3), 'rubber', { shadow: false });
  const gasF = mkGas(CYL.ri - 4, 0), gasR = mkGas(CYL.ri - 4, 0), live = mkGas(CHEST.ri - 6, CHEST.y);
  // each coloured mesh owns its material, so main.js can tint one alone
  for (const m of [portF, portR, gasF, gasR, live]) {
    m.material = new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.7, metalness: 0 });
    m.material.userData.baseEmissive = new THREE.Color(0);
  }

  const sc = {
    gear, ports: { portF, portR }, gas: { gasF, gasR, live },
    pose(phi, c) {
      const Q = gear.pose(phi, c), J = Q.J;
      const at = (p, X, Y) => p.root.position.set(X, 0, -Y);
      const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (const w of wheels) w.spin(Q.th);
      // coupling rods: translate with the crank pin, no turn
      at(coupF, J.C[0], J.C[1]); at(coupR, J.C[0] - G.PITCH, J.C[1]);
      at(mainRod, J.C[0], J.C[1]); mainRod.spin(ang(J.C, J.H));
      at(retC, J.C[0], J.C[1]); retC.spin(ang(J.C, J.E));
      at(ecc, J.E[0], J.E[1]); ecc.spin(ang(J.E, J.F));
      link.spin(Q.psi);
      at(die, J.D[0], J.D[1]); die.spin(Q.psi + Q.s / G.Rr);
      at(radius, J.D[0], J.D[1]); radius.spin(ang(J.D, J.T));
      at(lever, J.T[0], J.T[1]); lever.spin(ang(J.T, J.U));
      at(union, J.U[0], J.U[1]); union.spin(ang(J.U, J.A));
      weigh.spin(Q.arm);
      at(lift, J.Q[0], J.Q[1]); lift.spin(ang(J.Q, J.D));
      at(reach, J.R[0], J.R[1]);
      at(xh, J.H[0], J.H[1]);
      at(piston, J.H[0], J.H[1]);
      at(valve, J.V[0], J.V[1]);
      // sleepers run back under a forward-running engine
      const run = phi * G.WHEEL_R;
      sleepers.root.position.x = -(((run % SLEEPER) + SLEEPER) % SLEEPER);
      // cylinder ends: front from the piston to the front cover, rear from
      // the rear cover to the piston; the live steam between the heads
      const px = J.H[0] + G.ROD_PISTON;
      gasF.position.x = px + 62; gasF.scale.x = Math.max(1, CYL.bore1 - 2 - (px + 62));
      gasR.position.x = CYL.bore0 + 2; gasR.scale.x = Math.max(1, px - 62 - (CYL.bore0 + 2));
      const vc = J.V[0] + G.SPINDLE;
      live.position.x = vc - HS + HL / 2 + 2; live.scale.x = 2 * HS - HL - 4;
      return Q;
    },
    box: { c: [1300, 900, -300], R: 6200 },
    keys: { spread: [1600, 300, 900], gear: [2500, 500, 300], valve: [4900, 300, ZC], link: [G.K[0], G.K[1], 300], wheel: [0, 0, 0] },
  };
  return sc;
}
