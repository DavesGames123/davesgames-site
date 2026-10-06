// ============================================================================
//  ANTIKYTHERA MECHANISM  ·  scene.js — the 3D parts and their pose
// ----------------------------------------------------------------------------
//  build(B) makes the mechanism with kit.js and returns sc: { pose(day),
//  box, keys }. Every arbor angle comes from mech.js pose(), so the wheels
//  that main.js turns are the ones that tests.mjs checks.
//
//  FRAME. A mech.js point (X, Y) at depth h is (X, h, -Y) in the B.root
//  frame. B.root turns +90 deg about x, so the plates stand upright: Y is
//  up and +h comes toward the front dial (+z). Wheels are slabs about
//  local Y, so a part spin is a turn in the plane, counterclockwise from
//  the front.
//
//  DEPTH (mm, h)
//    front pointers ... Moon 5.4..6.2, Sun 3.4..4.2, phase ball at 9.6
//    front dial ....... decal at 2.9, plate 0..2.5
//    wheels ........... layer L face at hOf(L) = -4 - 3.4 L. The driver of a
//                       pair is 2 mm thick, the driven wheel 1.2 mm and
//                       0.4 mm in from each face: no two faces share a plane
//    back plate ....... -47.5..-45, decals at -47.9 and -48.2, spiral
//                       ridges -48.1..-49.1, pointers from -50
//  Pipes and hubs stop 0.6 mm past their own wheel faces.
//
//  PIN AND SLOT. k1 and k2 ride on the turntable e3 (child parts). k2
//  stands on a short axle from the turntable; k1 hangs from a bracket on
//  the front side, so neither axle goes through the other wheel. The pin
//  on the back of k1 runs in the radial slot of k2.
//
//  GREP MAP
//    function gearShape ....... triangular teeth, spoke windows, a slot
//    function wheel ........... a wheel of mech.js on its layer
//    function draw* ........... the canvas decals of the dials
//    export function build .... plates, pillars, plinth, arbors, pointers
//      pose(day) .............. every spin, the followers, the phase ball
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, circle } from './kit.js';
import * as M from './mech.js';

const { TEETH, AT, PAIRS, LAYER, MODULE, hOf, pitchR, DIALS, K_AT, CRANK, SLOT } = M;
const D2R = Math.PI / 180;

// ── wheels ────────────────────────────────────────────────────────────────
const DRIVER = new Set(PAIRS.map(p => p.a).concat(['b1']));
// the face span [h0, h1] of a wheel
export function wheelSpan(w) {
  const top = hOf(LAYER[w]);
  return DRIVER.has(w) ? [top - 2, top] : [top - 1.6, top - 0.4];
}
// triangular teeth: tooth k centred on k * 2 pi / N
function gearShape(N, m, o = {}) {
  const r = N * m / 2, ra = r + 0.9 * m, rf = r - 1.1 * m, p = Math.PI * 2 / N, s = new THREE.Shape();
  for (let k = 0; k < N; k++) {
    const c = k * p;
    const pts = [[rf, c - 0.42 * p], [ra, c - 0.08 * p], [ra, c + 0.08 * p], [rf, c + 0.42 * p]];
    pts.forEach(([rr, a], i) => (k === 0 && i === 0 ? s.moveTo(rr * Math.cos(a), rr * Math.sin(a)) : s.lineTo(rr * Math.cos(a), rr * Math.sin(a))));
  }
  s.closePath();
  // spoke windows on the large wheels: annular sectors between hub and rim
  const nSp = o.spokes ?? (r > 22 ? 4 : 0);
  if (nSp) {
    const r0 = Math.max(6, r * 0.24), r1 = rf - Math.max(2.2, r * 0.1), web = Math.max(2.2, r * 0.07);
    for (let i = 0; i < nSp; i++) {
      const a0 = (i / nSp) * Math.PI * 2 + web / r0 + (o.spokeAt || 0) , a1 = ((i + 1) / nSp) * Math.PI * 2 - web / r0 + (o.spokeAt || 0);
      const b0 = (i / nSp) * Math.PI * 2 + web / r1 + (o.spokeAt || 0), b1 = ((i + 1) / nSp) * Math.PI * 2 - web / r1 + (o.spokeAt || 0);
      const h = new THREE.Path();
      h.moveTo(r0 * Math.cos(a0), r0 * Math.sin(a0));
      h.absarc(0, 0, r0, a0, a1, false);
      h.lineTo(r1 * Math.cos(b1), r1 * Math.sin(b1));
      h.absarc(0, 0, r1, b1, b0, true);
      h.closePath();
      s.holes.push(h);
    }
  }
  // k2: a radial slot at local angle 0 (in the plane: +X)
  if (o.slot) {
    const [s0, s1, w] = o.slot, h = new THREE.Path();
    h.moveTo(s0, -w); h.lineTo(s1, -w); h.absarc(s1, 0, w, -Math.PI / 2, Math.PI / 2, false); h.lineTo(s0, w); h.absarc(s0, 0, w, Math.PI / 2, 3 * Math.PI / 2, false);
    s.holes.push(h);
  }
  return s;
}
function wheel(B, part, w, o = {}) {
  const [h0, h1] = wheelSpan(w), m = MODULE[w];
  const g = slab(gearShape(TEETH[w], m, o), h0, h1 - h0, 0.18);
  return B.mesh(part, g, o.mat || 'brass');
}
// a hub round the arbor, 0.6 mm past the wheel faces
function hub(B, part, w, rIn, rOut) {
  const [h0, h1] = wheelSpan(w);
  return B.mesh(part, tube(rIn, rOut, h0 - 0.6, h1 + 0.6, 24), 'bronze');
}

// ── decals (canvas, drawn once) ───────────────────────────────────────────
const ZOD = ['ΚΡΙΟΣ', 'ΤΑΥΡΟΣ', 'ΔΙΔΥΜΟΙ', 'ΚΑΡΚΙΝΟΣ', 'ΛΕΩΝ', 'ΠΑΡΘΕΝΟΣ', 'ΧΗΛΑΙ', 'ΣΚΟΡΠΙΟΣ', 'ΤΟΞΟΤΗΣ', 'ΑΙΓΟΚΕΡΩΣ', 'ΥΔΡΟΧΟΟΣ', 'ΙΧΘΥΕΣ'];
const EGY = ['ΘΩΘ', 'ΦΑΩΦΙ', 'ΑΘΥΡ', 'ΧΟΙΑΚ', 'ΤΥΒΙ', 'ΜΕΧΙΡ', 'ΦΑΜΕΝΩΘ', 'ΦΑΡΜΟΥΘΙ', 'ΠΑΧΩΝ', 'ΠΑΥΝΙ', 'ΕΠΙΦΙ', 'ΜΕΣΟΡΗ'];
const INK = 'rgba(240,226,190,0.95)', INK2 = 'rgba(240,226,190,0.6)';
function cv(n) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }
// text along a circle (canvas y down; angle a counterclockwise from +x)
function arcText(g, txt, cx, cy, r, a, px) {
  g.save(); g.translate(cx + r * Math.cos(a), cy - r * Math.sin(a)); g.rotate(-a + Math.PI / 2);
  g.font = `600 ${px}px "STIX Two Text", Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 0, 0); g.restore();
}
// front ring: zodiac (r 50..61) and the Egyptian calendar (r 62..73)
function drawFront(R) {
  const n = 2048, c = cv(n), g = c.getContext('2d'), k = n / 2 / R, C = n / 2;
  const ring = (r0, r1) => { g.lineWidth = 3.4; g.strokeStyle = INK; for (const r of [r0, r1]) { g.beginPath(); g.arc(C, C, r * k, 0, Math.PI * 2); g.stroke(); } };
  const tick = (a, r0, r1, w = 2.4) => { g.lineWidth = w; g.beginPath(); g.moveTo(C + r0 * k * Math.cos(a), C - r0 * k * Math.sin(a)); g.lineTo(C + r1 * k * Math.cos(a), C - r1 * k * Math.sin(a)); g.stroke(); };
  g.strokeStyle = INK; g.fillStyle = INK;
  ring(50, 61); ring(62, 73);
  for (let i = 0; i < 360; i++) tick(i * D2R, 59.2, 61, i % 30 ? 2 : 3.4);
  for (let i = 0; i < 12; i++) { tick(i * 30 * D2R, 50, 61, 2.4); arcText(g, ZOD[i], C, C, 55.3 * k, (i * 30 + 15) * D2R, 46); }
  for (let i = 0; i < 365; i++) tick(i / 365 * Math.PI * 2, 71.2, 73, i % 30 ? 2 : 3.4);
  for (let i = 0; i < 12; i++) { tick(i * 30 / 365 * Math.PI * 2, 62, 73, 2.4); arcText(g, EGY[i], C, C, 66.6 * k, (i * 30 + 15) / 365 * Math.PI * 2, 40); }
  tick(360 / 365 * Math.PI * 2, 62, 73, 2.4);
  arcText(g, 'ΕΠ', C, C, 66.6 * k, 362.5 / 365 * Math.PI * 2, 30);
  return c;
}
// a back spiral dial seen from the back: cells between the turns of the
// ridge, numbered, the pointer starting at the top and running
// counterclockwise (the back view of a clockwise turn from the front)
function drawSpiral(D, R, title) {
  const n = 2048, c = cv(n), g = c.getContext('2d'), k = n / 2 / R, C = n / 2, pitch = (D.rOut - D.rIn) / D.turns, per = D.cells / D.turns;
  g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 3.2;
  for (let j = 0; j <= D.cells; j++) {
    const x = j / per, a = Math.PI / 2 + x * Math.PI * 2, r = M.spiralR(D, x);
    g.beginPath(); g.moveTo(C + (r - pitch / 2 + 0.4) * k * Math.cos(a), C - (r - pitch / 2 + 0.4) * k * Math.sin(a)); g.lineTo(C + (r + pitch / 2 - 0.4) * k * Math.cos(a), C - (r + pitch / 2 - 0.4) * k * Math.sin(a)); g.stroke();
    if (j < D.cells) { const xm = (j + 0.5) / per, am = Math.PI / 2 + xm * Math.PI * 2; arcText(g, String(j + 1), C, C, M.spiralR(D, xm) * k, am, 30); }
  }
  g.font = `600 52px "STIX Two Text", Georgia, serif`; g.textAlign = 'center'; g.fillStyle = INK;
  g.fillText(title, C, C + (D.rIn - 14) * k);
  return c;
}
// a small sector dial (Games, Exeligmos)
function drawSectors(r, names) {
  const n = 512, c = cv(n), g = c.getContext('2d'), k = n / 2 / (r + 1), C = n / 2;
  g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 3;
  g.beginPath(); g.arc(C, C, r * k, 0, Math.PI * 2); g.stroke();
  names.forEach((t, i) => {
    const a = Math.PI / 2 + i / names.length * Math.PI * 2;
    g.beginPath(); g.moveTo(C, C); g.lineTo(C + r * k * Math.cos(a), C - r * k * Math.sin(a)); g.stroke();
    const am = a + Math.PI / names.length;
    g.save(); g.translate(C + 0.6 * r * k * Math.cos(am), C - 0.6 * r * k * Math.sin(am)); g.rotate(-am + Math.PI / 2);
    g.font = `600 ${names.length > 3 ? 34 : 44}px "STIX Two Text", Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    t.split('\n').forEach((s, li, arr) => g.fillText(s, 0, (li - (arr.length - 1) / 2) * 36)); g.restore();
  });
  return c;
}
// a disc decal facing +h (front) or -h (back, turned so it reads from behind)
function discGeo(r0, r1, h, back) {
  const g = r0 > 0 ? new THREE.RingGeometry(r0, r1, 160, 1) : new THREE.CircleGeometry(r1, 96);
  // RingGeometry UVs map the outer radius to the unit square
  if (back) { g.rotateX(Math.PI / 2); g.rotateY(Math.PI); } else g.rotateX(-Math.PI / 2);
  g.translate(0, h, 0);
  return g;
}
// a pointer arm about local Y along local angle a, from r0 to r1
function arm(len0, len1, w, h0, th, a = 0, tipW = w * 0.4) {
  const s = new THREE.Shape();
  s.moveTo(len0, -w / 2); s.lineTo(len1, -tipW / 2); s.lineTo(len1 + w * 0.8, 0); s.lineTo(len1, tipW / 2); s.lineTo(len0, w / 2); s.absarc(len0, 0, w / 2, Math.PI / 2, 3 * Math.PI / 2, false);
  const g = slab(s, h0, th, 0.15); g.rotateY(a);
  return g;
}

// ── the build ─────────────────────────────────────────────────────────────
const LBL = { b: 'Main wheel b1', b3: 'Moon pointer', e34: 'Turntable e3', k1: 'Pin wheel k1', k2: 'Slot wheel k2', n: 'Metonic arbor', g: 'Saros arbor', a: 'Crank', d: 'd2 127 teeth' };
export const ARBOR_INFO = { a: 'crank', b: 'b', b3: 'moon', c: 'c', d: 'd', l: 'l', m: 'm', n: 'n', o: 'o', f: 'f', g: 'g', h: 'h', i: 'i', e25: 'e25', e61: 'e61', e34: 'e34', k1: 'k1', k2: 'k2' };
const HMID = -22;
const xp = (h, k = 1.6) => [0, (h - HMID) * k, 0];

export function build(B) {
  B.root.rotation.x = Math.PI / 2;
  const at = (P, h = 0) => [P[0], h, -P[1]];
  const BK = M.PLATE.back, FR = M.PLATE.front;
  const X0 = -78, X1 = 78, Y0 = -166, Y1 = 141;

  // plinth and pillars
  const base = B.part('base', { info: 'base', label: 'Stand', labelAt: [X1, BK[0] - 8, -Y0 + 6], explode: [0, 0, 0], st: 0, en: 0.5 });
  // the plinth: its top 0.3 mm under the plates
  { const g = new THREE.BoxGeometry(X1 - X0 + 24, FR[1] - BK[0] + 24, 12); g.translate(0, (FR[1] + BK[0]) / 2, -(Y0 - 6.3)); B.mesh(base, g, 'wood'); }
  // four pillars from plate to plate

  // the fixed spindle of the e axis
  const spindle = B.part('spindle', { info: 'spindle', at: at(AT.e), explode: xp(-22), st: 0.1, en: 0.7 });
  B.mesh(spindle, rod(1.1, hOf(8) - 3.4, hOf(3) + 1.4, 16), 'shaft');

  // plates: the front plate has a round window inside the dial ring
  const plateF = B.part('plateF', { info: 'plateF', label: 'Front plate', labelAt: [X0 + 10, FR[1], -(Y1 - 12)], explode: [0, 110, 0], st: 0, en: 0.6 });
  const plate = (win) => {
    const s = new THREE.Shape([[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]].map(p => new THREE.Vector2(...p)));
    for (const [cx, cy, r] of win) s.holes.push(circle(r, cx, cy));
    return s;
  };
  B.mesh(plateF, slab(plate([[0, 0, 45.5]]), FR[0], FR[1] - FR[0], 0.5), 'patina');
  // four pillars from plate to plate; they leave with the front plate
  for (const [x, y] of [[X0 + 6, Y0 + 6], [X1 - 6, Y0 + 6], [X0 + 6, Y1 - 6], [X1 - 6, Y1 - 6]]) {
    const g = lathe([[[3.4, BK[1]], [3.4, FR[0]], [0, FR[0]], [0, BK[1]]]], 24); g.translate(x, 0, -y); B.mesh(plateF, g, 'bronze');
  }
  const dialF = B.part('dialF', { info: 'frontDial', label: 'Zodiac and calendar', labelAt: [0, FR[1], -76], explode: [0, 112, 0], st: 0, en: 0.6 });
  B.decal(dialF, discGeo(49, 74, FR[1] + 0.4, false), drawFront(74));
  const plateB = B.part('plateB', { info: 'plateB', label: 'Back plate', labelAt: [X0 + 10, BK[0], -(Y1 - 12)], explode: [0, -110, 0], st: 0, en: 0.6 });
  B.mesh(plateB, slab(plate([]), BK[0], BK[1] - BK[0], 0.5), 'patina');
  // back dials: decals at -47.9, ridges below, subsidiary decals at -48.2
  const backDial = (id, info, P, D, title, label) => {
    const p = B.part(id, { info, label, labelAt: [0, BK[0] - 2, -(D.rOut + 6)], at: at(P), explode: [0, -112, 0], st: 0, en: 0.6 });
    const R = D.rOut + 3;
    B.decal(p, discGeo(0, R, BK[0] - 0.4, true), drawSpiral(D, R, title));
    // the ridge between the turns: an Archimedean spiral, front-view angle
    // pi/2 - 2 pi x at turn x, one turn longer than the cells
    const pitch = (D.rOut - D.rIn) / D.turns, pts = [];
    for (let i = 0; i <= (D.turns + 1) * 96; i++) { const x = i / 96 - 0.5, r = M.spiralR(D, x), a = Math.PI / 2 - x * Math.PI * 2; pts.push(new THREE.Vector3(r * Math.cos(a), BK[0] - 1.1, -r * Math.sin(a))); }
    B.mesh(p, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), (D.turns + 1) * 160, 0.5, 6, false), 'bronze');
    return { p, pitch };
  };
  backDial('dialM', 'metonic', AT.n, DIALS.metonic, 'ΜΕΤΩΝ · 235', 'Metonic dial');
  backDial('dialS', 'saros', AT.g, DIALS.saros, 'ΣΑΡΟΣ · 223', 'Saros dial');
  const sub = (id, info, P, D, names, label) => {
    const p = B.part(id, { info, label, labelAt: [0, BK[0] - 2, -(D.r + 3)], at: at(P), explode: [0, -112, 0], st: 0, en: 0.6 });
    B.decal(p, discGeo(0, D.r + 1, BK[0] - 0.7, true), drawSectors(D.r, names));
    return p;
  };
  sub('dialG', 'games', AT.o, DIALS.games, ['ΙΣΘΜΙΑ\nΟΛΥΜΠΙΑ', 'ΝΕΜΕΑ\nΝΑΑ', 'ΙΣΘΜΙΑ\nΠΥΘΙΑ', 'ΝΕΜΕΑ\nΑΛΙΕΙΑ'], 'Games dial');
  sub('dialX', 'exeligmos', AT.i, DIALS.exeligmos, ['', 'Η', 'ΙϚ'], 'Exeligmos dial');

  // ── arbors ─────────────────────────────────────────────────────────────
  const arbors = {};
  const span = (ws, ext0 = 0, ext1 = 0) => { let lo = Infinity, hi = -Infinity; for (const w of ws) { const [a, b] = wheelSpan(w); lo = Math.min(lo, a); hi = Math.max(hi, b); } return [lo - 0.6 + ext0, hi + 0.6 + ext1]; };
  const arbor = (id, ws, o = {}) => {
    const hs = span(ws), hm = (hs[0] + hs[1]) / 2;
    const p = B.part(id, { info: ARBOR_INFO[id], label: LBL[id] || null, labelAt: [0, hs[1] + 2, 0], at: at(o.at || AT[id]), explode: o.explode || xp(hm), st: o.st ?? 0.15, en: o.en ?? 0.85, parent: o.parent });
    for (const w of ws) { wheel(B, p, w, o.wheel && o.wheel[w]); }
    arbors[id] = p;
    return p;
  };
  const rodOf = (p, r, h0, h1) => B.mesh(p, rod(r, h0, h1, 16), 'shaft');
  const hubOf = (p, w, r0, r1) => hub(B, p, w, r0, r1);

  // b: b1 and b2 on a pipe out through the front plate to the Sun pointer
  // arbors that run through a plate explode past it, so a pointer never
  // crosses its plate: front b +118, b3 +124 (plate +110); back -118
  // (plate -110)
  const b = arbor('b', ['b1', 'b2'], { explode: [0, 118, 0], wheel: { b1: { mat: 'bronze', spokeAt: Math.PI / 4 } } });
  B.mesh(b, tube(1.5, 2.4, wheelSpan('b2')[0] - 0.6, 4.4, 24), 'bronze');
  hubOf(b, 'b1', 2.4, 6); hubOf(b, 'b2', 2.4, 4.6);
  B.mesh(b, arm(-14, 66, 3.2, 3.4, 0.8), 'gold');
  { const g = new THREE.SphereGeometry(2.6, 24, 14); g.translate(56, 3.8, 0); B.mesh(b, g, 'gold'); }
  // b3: the Moon rod through the b pipe to the Moon pointer, phase ball on it
  const MOON_AT = -M.pose(0).A.b3 + M.pose(0).moon;     // pointer angle on b3
  const b3 = arbor('b3', ['b3'], { at: AT.b, explode: [0, 124, 0] });
  rodOf(b3, 1.2, wheelSpan('b3')[0] - 0.6, 6.8);
  hubOf(b3, 'b3', 1.2, 3.6);
  B.mesh(b3, arm(-12, 64, 2.6, 5.4, 0.8, MOON_AT), 'silver');
  { const g = lathe([[[2.6, 5.0], [2.6, 6.6], [0, 6.6], [0, 5.0]]], 24); B.mesh(b3, g, 'silver'); }
  // the phase ball: a post on the pointer, a ball half silver, half dark,
  // that turns about the pointer's radial line
  const BALL_R = 34;
  { const g = rod(0.7, 6.2, 9.6 - 3.4 + 0.2, 12); g.translate(BALL_R, 0, 0); g.rotateY(MOON_AT); B.mesh(b3, g, 'silver'); }
  const ball = B.part('ball', { info: 'phase', label: 'Phase ball', labelAt: [0, 4, 0], parent: b3.root, at: [BALL_R * Math.cos(MOON_AT), 9.6, -BALL_R * Math.sin(MOON_AT)], u: [Math.cos(MOON_AT), 0, -Math.sin(MOON_AT)], e0: [0, 1, 0], explode: [0, 8, 0], st: 0.3, en: 1 });
  // two halves split by a plane through the radial axis (local Y)
  { B.mesh(ball, new THREE.SphereGeometry(3.4, 32, 16, 0, Math.PI), 'silver'); B.mesh(ball, new THREE.SphereGeometry(3.4, 32, 16, Math.PI, Math.PI), 'dark'); }

  // the Moon train and the back trains
  const c = arbor('c', ['c1', 'c2']); rodOf(c, 1.2, ...span(['c1', 'c2'])); hubOf(c, 'c1', 1.2, 3); hubOf(c, 'c2', 1.2, 3);
  const d = arbor('d', ['d1', 'd2']); rodOf(d, 1.2, ...span(['d1', 'd2'])); hubOf(d, 'd1', 1.2, 3); hubOf(d, 'd2', 1.2, 4.5);
  const l = arbor('l', ['l1', 'l2']); rodOf(l, 1.2, ...span(['l1', 'l2'])); hubOf(l, 'l1', 1.2, 3); hubOf(l, 'l2', 1.2, 3.4);
  const m = arbor('m', ['m1', 'm3', 'm2']); rodOf(m, 1.2, ...span(['m1', 'm2'])); for (const w of ['m1', 'm3', 'm2']) hubOf(m, w, 1.2, 2.8);
  const f = arbor('f', ['f1', 'f2']); rodOf(f, 1.2, ...span(['f1', 'f2'])); hubOf(f, 'f1', 1.2, 3); hubOf(f, 'f2', 1.2, 3);
  const h = arbor('h', ['h1', 'h2']); rodOf(h, 1.2, ...span(['h1', 'h2'])); hubOf(h, 'h1', 1.2, 2.8); hubOf(h, 'h2', 1.2, 2.8);
  // dial arbors: out through the back plate to a pointer (front-view local
  // angle start - T0, so the pointer starts at the top)
  const P0 = M.pose(0).A;
  const backArbor = (id, ws, len, w, hp, follower) => {
    const p = arbor(id, ws, { explode: [0, -118, 0] });
    rodOf(p, 1.4, hp - 0.6, span(ws)[1]);
    for (const x of ws) hubOf(p, x, 1.4, 3);
    const a0 = Math.PI / 2 - P0[id];
    B.mesh(p, arm(-8, len, w, hp, 0.8, a0), 'bronze');
    let fol = null;
    if (follower) { fol = B.mesh(p, new THREE.SphereGeometry(1.5, 16, 10), 'gold'); fol.userData.a0 = a0; }
    return { p, fol };
  };
  const nA = backArbor('n', ['n1', 'n3'], DIALS.metonic.rOut + 1, 2.6, -50.8, true);
  const oA = backArbor('o', ['o1'], DIALS.games.r - 1, 1.6, -50.4, false);
  const gA = backArbor('g', ['g1', 'g2'], DIALS.saros.rOut + 1, 2.6, -50.8, true);
  const iA = backArbor('i', ['i1'], DIALS.exeligmos.r - 1, 1.6, -50.4, false);

  // the e axis: e61 inside (e1 front, e6 back), e25 outside it (e2, e5)
  const e61 = arbor('e61', ['e1', 'e6'], { at: AT.e });
  B.mesh(e61, tube(1.25, 2.2, ...span(['e1', 'e6'])), 'bronze');
  hubOf(e61, 'e1', 2.2, 3.6); hubOf(e61, 'e6', 2.2, 4);
  const e25 = arbor('e25', ['e2', 'e5'], { at: AT.e });
  B.mesh(e25, tube(2.25, 3.2, ...span(['e2', 'e5'])), 'bronze');
  hubOf(e25, 'e2', 3.2, 4.6); hubOf(e25, 'e5', 3.2, 4.6);
  // the turntable: e3 (front) and e4 on one hub, with the k wheels on it
  const e34 = arbor('e34', ['e3', 'e4'], { at: AT.e, wheel: { e3: { mat: 'bronze' } } });
  B.mesh(e34, tube(1.15, 4.5, ...span(['e3', 'e4'])), 'bronze');
  const tt = wheelSpan('e3')[1];   // the turntable front face
  // k2 on a short axle from the turntable; k1 from a bracket above
  const k2 = B.part('k2', { info: 'k2', label: LBL.k2, labelAt: [0, wheelSpan('k2')[1] + 1, 0], parent: e34.root, at: [K_AT.k2[0], 0, -K_AT.k2[1]], explode: [0, 3, 0], st: 0.4, en: 1 });
  wheel(B, k2, 'k2', { slot: [8.1, 11.6, 0.75], spokes: 0 });
  B.mesh(k2, rod(0.45, tt + 0.3, wheelSpan('k2')[1] + 0.5, 12), 'shaft');
  B.mesh(k2, tube(0.45, 1.9, wheelSpan('k2')[0] - 0.5, wheelSpan('k2')[1] + 0.5, 16), 'bronze');
  const k1 = B.part('k1', { info: 'k1', label: LBL.k1, labelAt: [0, wheelSpan('k1')[1] + 2, 0], parent: e34.root, at: [K_AT.k1[0], 0, -K_AT.k1[1]], explode: [0, 9, 0], st: 0.4, en: 1 });
  wheel(B, k1, 'k1', { spokes: 0 });
  const kTop = wheelSpan('k1')[1];
  B.mesh(k1, rod(0.45, wheelSpan('k1')[0] - 0.3, kTop + 0.9, 12), 'shaft');
  B.mesh(k1, tube(0.45, 1.6, wheelSpan('k1')[0] - 0.2, kTop + 0.4, 16), 'bronze');
  // the pin on the back of k1 at local angle 0, radius SLOT.r
  { const g = rod(0.55, wheelSpan('k2')[0] - 0.3, wheelSpan('k1')[0] + 0.2, 12); g.translate(SLOT.r, 0, 0); B.mesh(k1, g, 'steel'); }
  // the bracket: a post on the turntable outside the k wheels, a bar over k1
  {
    const ang = Math.atan2(K_AT.k1[1], K_AT.k1[0]), R0 = Math.hypot(...K_AT.k1), Rp = R0 + 15.5;
    const px = Rp * Math.cos(ang), py = Rp * Math.sin(ang), hBar0 = kTop + 0.9, hBar1 = hBar0 + 0.7;
    const post = rod(1.4, tt + 0.2, hBar1 - 0.35, 16); post.translate(px, 0, -py); B.mesh(e34, post, 'bronze');
    const s = new THREE.Shape(); const L = Rp - R0;
    s.moveTo(0, -1.6); s.lineTo(L, -1.6); s.absarc(L, 0, 1.6, -Math.PI / 2, Math.PI / 2, false); s.lineTo(0, 1.6); s.absarc(0, 0, 1.6, Math.PI / 2, 3 * Math.PI / 2, false);
    const bar = slab(s, hBar0, hBar1 - hBar0, 0.12); bar.rotateY(ang); bar.translate(K_AT.k1[0], 0, -K_AT.k1[1]); B.mesh(e34, bar, 'bronze');
  }

  // the crank: a contrate a1 under the b1 rim, its axle out to the right
  const hc = wheelSpan('b1')[0] + 1 - CRANK.r;
  const crank = B.part('a', { info: 'crank', label: LBL.a, labelAt: [-24, 0, 0], at: [CRANK.x + 0.55, hc, 0], u: [-1, 0, 0], e0: [0, 1, 0], explode: [0, 0, 0], st: 0, en: 1 });
  {
    const N = TEETH.a1, mm = MODULE.a1, r = CRANK.r, p = Math.PI * 2 / N;
    // local y: the axle; the disc behind (+x), the face teeth toward b1
    B.mesh(crank, lathe([[[r + 1.2, -2.6], [r + 1.2, -0.6], [3, -0.6], [3, -2.6]]], 64), 'patina');
    const teeth = [];
    for (let k = 0; k < N; k++) {
      // a face tooth from inside the disc (y -0.7) to y 1.0, toward b1
      const t = new THREE.BoxGeometry(0.9, 1.7, 1.8); t.translate(0, 0.15, -r); t.rotateY(k * p + Math.PI / N);
      teeth.push(t.toNonIndexed());
    }
    B.mesh(crank, mergeAll(teeth), 'patina');
    B.mesh(crank, rod(1.6, -(78 - CRANK.x) - 14, 2, 16), 'shaft');
    const handle = new THREE.BoxGeometry(4.4, 2.4, 22); handle.translate(0, -(78 - CRANK.x) - 14, -10); B.mesh(crank, handle, 'bronze');
    const knob = rod(2.7, -(78 - CRANK.x) - 22.6, -(78 - CRANK.x) - 14.6, 16); knob.translate(0, 0, -20); B.mesh(crank, knob, 'wood');
  }

  // ── pose ───────────────────────────────────────────────────────────────
  const SP = { b: 'b', b3: 'b3', c: 'c', d: 'd', l: 'l', m: 'm', n: 'n', o: 'o', f: 'f', g: 'g', h: 'h', i: 'i', e25: 'e25', e61: 'e61', e34: 'e34' };
  function pose(t) {
    const Q = M.pose(t), A = Q.A;
    for (const k in SP) arbors[k].spin(A[SP[k]]);
    k1.spin(A.k1 - A.e34); k2.spin(A.k2 - A.e34);
    // contrate: its rim moves with the b1 rim at the contact
    crank.spin(A.b * TEETH.b1 / TEETH.a1);
    // the silver half faces the front at full Moon, away at new Moon
    ball.spin(Q.phase - Math.PI / 2);
    for (const [Aa, D, q] of [[nA, DIALS.metonic, Q.metonic], [gA, DIALS.saros, Q.saros]]) {
      const r = M.spiralR(D, q.turn), a = Aa.fol.userData.a0;
      // the turn count runs clockwise from the front (a0 - 2 pi turn) while
      // the pointer turns with the arbor; in the arbor frame the bead stays
      // on the pointer line at angle a0
      Aa.fol.position.set(r * Math.cos(a), -49.6, -r * Math.sin(a));
    }
    return Q;
  }
  const kw = (P, h) => [P[0], P[1], h];
  return {
    pose,
    box: { c: [0, (Y0 + Y1) / 2 - 6, (FR[1] + BK[0]) / 2], R: 0.5 * Math.hypot(X1 - X0 + 24, Y1 - Y0 + 20) },
    keys: { front: kw(AT.b, 4), metonic: kw(AT.n, -50), saros: kw(AT.g, -50), turntable: kw(AT.e, -26) },
    depth: FR[1] - BK[0],
  };
}

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
function mergeAll(gs) { const g = mergeGeometries(gs, false); gs.forEach(x => x.dispose()); return g; }
