// ============================================================================
//  CURTA  ·  scene.js — the parts of the Curta and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one Curta (Type I or II) with kit.js and returns sc:
//  { setPlan(P), plan, pose(t), focus(Q), box, keys, stationPos(p), U, G }.
//  Every size comes from geo() in mech.js, and pose(t) reads at(plan, t),
//  so each part on the screen moves as the model the tests check.
//
//  FRAME (true size, mm; y up; azimuth a: x = r sin a, z = r cos a; the
//  sliders centre on the front, a = 0; station p at a_p = A0 - p pitch)
//    base ........ black cap y 0 .. 4 and the inner floor with the detent
//    shell ....... the black anodised body y 4 .. 56 with one slot per slider
//                  and the engraved 0 .. 9 scale beside it (decals)
//    sleeve ...... the stepped sleeve on the drum core: nine tooth rows, add
//                  segments (steel) on the levels, complement segments
//                  (blued) on the half levels; it lifts Lp / 2 with the crank
//    drum ........ the core: carry disc with the carry tooth, the counter hub
//                  with its drive tooth and counter carry tooth, the detent
//                  wheel at the base
//    station p ... square shaft (shaft_p), setting gear (gear_p) or a gear
//                  fixed at level 0 (p >= NS), carry gear (cgear_p) and its
//                  slide (slide_p), a dog coupling at the top of the deck
//    slider g .... knob, stem through the slot, block on a guide rail, arm,
//                  and a fork in the groove of the setting gear collar
//    counter ..... stations at RQ: shaft and dog (cshaft_q); drive pinion on
//                  q = 0, carry gears (ccgear_q) on q >= 1; reversing pinion
//    deck ........ the top deck y 56 .. 58 with the shift scale
//    carriage .... underside plate, knurled rim, top plate with windows; in
//                  it, for each wheel: intermediate shaft with dog and pinion
//                  (ishaft_j), digit wheel with crown and carry trip tooth
//                  (res_j), carry lever (clever_j); counter wheels (cnt_k)
//                  and their shafts (cishaft_k)
//    clearing .... ring and lever on the carriage top
//    crank ....... shaft with the red band (shows when lifted), boss, arm,
//                  handle
//    reverse ..... the counter reversing lever on the deck rim
//
//  GREP MAP
//    function spur ............ a spur gear with a square or round bore
//    function station ......... shaft, gears and slide of one station
//    function slider .......... one setting slider
//    function carriage ........ the carriage and the wheels in it
//    export function build .... all parts; sc.pose and sc.focus
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, shell, circle, merge, makeTex } from './kit.js';
import { unit, geo, toothSegments, plan, at, jobMul, clearRest, TOOTH0, TOOTH_P, RES_CARRY, CNT_CARRY, CNT_DRIVE } from './mech.js';

const D = Math.PI / 180, TAU = Math.PI * 2;
const boxGeo = (x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; };
const dirAz = a => [Math.sin(a * D), 0, Math.cos(a * D)];
const atAz = (a, r, y = 0) => [r * Math.sin(a * D), y, r * Math.cos(a * D)];
// slab shapes are (x, s) with world z = -s
const sxy = (a, r) => new THREE.Vector2(r * Math.sin(a * D), -r * Math.cos(a * D));
const rectShape = (x0, y0, x1, y1) => new THREE.Shape([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(p => new THREE.Vector2(...p)));
// a box radial at azimuth a: r0 .. r1, tangential +-w, y0 .. y1
function radBox(a, r0, r1, w, y0, y1) { const g = boxGeo(-w, w, y0, y1, r0, r1); g.rotateY(a * D); return g; }
// a window in a slab shape: radial r0 .. r1, tangential half w, at azimuth a
function winPath(a, r0, r1, w) {
  const n = [Math.sin(a * D), -Math.cos(a * D)], t = [Math.cos(a * D), Math.sin(a * D)];
  const P = (r, q) => new THREE.Vector2(n[0] * r + t[0] * q, n[1] * r + t[1] * q);
  return new THREE.Path([P(r0, -w), P(r0, w), P(r1, w), P(r1, -w)]);
}
// a spur gear about local y: n teeth, root r0, tip r1, y0 .. y0 + h; bore
// 'sq' (square half side s) or a round bore of radius s
function spur(n, r0, r1, y0, h, bore, s, bevel = 0.08) {
  const sh = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, w = TAU / n;
    const pts = [[r0, a], [r1, a + 0.2 * w], [r1, a + 0.46 * w], [r0, a + 0.66 * w]];
    pts.forEach(([r, b], k) => (i || k ? sh.lineTo(r * Math.cos(b), r * Math.sin(b)) : sh.moveTo(r * Math.cos(b), r * Math.sin(b))));
  }
  sh.closePath();
  if (bore === 'sq') sh.holes.push(new THREE.Path([[-s, -s], [-s, s], [s, s], [s, -s]].map(p => new THREE.Vector2(...p))));
  else if (s) sh.holes.push(circle(s));
  return slab(sh, y0, h, bevel);
}
// a collar with a groove (for a fork), about local y, from y0 up
const groovedCollar = (r, rg, y0, bore) => lathe([[[r, y0], [r, y0 + 0.45]], [[rg, y0 + 0.45], [rg, y0 + 1.15]], [[r, y0 + 1.15], [r, y0 + 1.6]], [[bore, y0 + 1.6], [bore, y0]]], 32);
// ten radial ribs of a dog coupling, about local y, at phase ph (deg)
function dogRibs(r0, r1, w, y0, y1, ph) { const gs = []; for (let i = 0; i < 10; i++) { const g = boxGeo(r0, r1, y0, y1, -w, w); g.rotateY((ph + 36 * i) * D); gs.push(g); } return merge(gs); }

// ── engraved decals (canvas textures) ──────────────────────────────────────
// the 0 .. 9 scale beside a slot: v runs up the strip from y0 to y1
function scaleTex(G, y0, y1) {
  return makeTex(64, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f2efe8'; g.strokeStyle = '#f2efe8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${Math.round(h * 0.052)}px 'Helvetica Neue', Arial, sans-serif`;
    for (let d = 0; d <= 9; d++) {
      const v = (G.levelY(d) - y0) / (y1 - y0), py = (1 - v) * h;
      g.save(); g.translate(w * 0.62, py); g.scale(0.62, 1); g.fillText(String(d), 0, 0); g.restore();
      g.lineWidth = 3; g.beginPath(); g.moveTo(0, py); g.lineTo(w * 0.22, py); g.stroke();
    }
  });
}
// a ring decal in the plane of RingGeometry turned flat (rotateX -90):
// canvas point of (r, a) for an outer radius R: (W/2 + r sin a W/2R, H/2 + r cos a H/2R)
function ringTex(R, draw) {
  return makeTex(1024, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const P = (r, a) => [w / 2 + r * Math.sin(a * D) * w / (2 * R), h / 2 + r * Math.cos(a * D) * h / (2 * R)];
    draw(g, P, w / (2 * R));
  });
}
const label = (g, P, s, r, a, txt, size, col = '#f0ede6', font = 600) => {
  const [x, y] = P(r, a);
  g.save(); g.translate(x, y); g.rotate(-a * D); g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${font} ${size * s}px 'Helvetica Neue', Arial, sans-serif`; g.fillText(txt, 0, 0); g.restore();
};
function ringDecal(B, p, R0, R1, y, tex) {
  const ring = new THREE.RingGeometry(R0, R1, 128, 1);
  // planar uv over the outer radius R1
  const pos = ring.attributes.position, uv = ring.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * R1) + 0.5, pos.getY(i) / (2 * R1) + 0.5);
  ring.rotateX(-Math.PI / 2); ring.translate(0, y, 0);
  return B.mesh(p, ring, null, { decal: B.decal(p, 'ring', tex), shadow: false, pick: true });
}

export function build(B, id) {
  const U = unit(id), G = geo(U), Rb = G.Rb, Rc = G.Rc, kv = G.kv, NR = U.NR, NC = U.NC, NS = U.NS;
  const addDecal = (p, geom, m) => { const ms = new THREE.Mesh(geom, m); ms.userData.part = p.info; ms.renderOrder = 2; p.root.add(ms); B.pickables.push(ms); return ms; };
  B.mesh = ((orig) => (p, geom, mat, o = {}) => (o.decal ? addDecal(p, geom, o.decal) : orig(p, geom, mat, o)))(B.mesh);
  const azSlot = g => G.stationAz(g);

  // ── base: the cap, the floor with the bearing bosses ─────────────────────
  const base = B.part('base', { info: 'base', label: 'Base', labelAt: [0, -2, Rb + 4], explode: [0, -76 * kv, 0], st: 0, en: 0.55, cut: true });
  B.mesh(base, lathe([[[Rb - 1.6, 0], [Rb - 0.35, 0.35], [Rb, 1.6], [Rb, G.base.y1 - 0.02]], [[Rb - G.shell.t - 0.02, G.base.y1 - 0.02], [Rb - G.shell.t - 0.02, 1.4], [0, 1.4], [0, 0]]], 128), 'anod');
  // floor: a machined disc with a raised boss under each station shaft
  const floorY = G.base.y1 + 0.02, floorY1 = floorY + 2.2 * kv;
  B.mesh(base, lathe([[[Rb - G.shell.t - 0.1, floorY], [Rb - G.shell.t - 0.1, floorY1]], [[G.core.r + 0.6, floorY1], [G.core.r + 0.6, floorY]]], 128), 'machined');
  const boss = [];
  for (let p = 0; p < NR; p++) { const g = tube(0.75, 1.5, floorY1, floorY1 + 0.9, 20); const [x, , z] = atAz(G.stationAz(p), G.RS); g.translate(x, 0, z); boss.push(g); }
  B.mesh(base, merge(boss), 'machined');
  // the detent pawl: a spring lever on the floor that drops into the notch
  // of the detent wheel at home (azimuth in the gap past station 0)
  const detAz = G.A0 + 2 * G.pitch, detR = G.core.r + 4.6;
  const detent = B.part('detent', { info: 'detent', label: 'Crank detent', labelAt: [0, 3, 0], at: atAz(detAz, detR + 2.4, floorY1 + 0.6 * kv), u: [0, 1, 0], e0: dirAz(detAz), explode: [...atAz(detAz, 16, 0)], st: 0.3, en: 0.8 });
  B.mesh(detent, merge([rod(0.7, -0.55, 1.2, 16), boxGeo(-2.2, 0.4, 0, 0.9, -0.5, 0.5)]), 'steel');
  B.mesh(detent, rod(0.55, -0.3, 1.1, 16).translate(-2.2, 0, 0), 'steel');

  // ── shell with slots and the engraved scales ──────────────────────────────
  const shellP = B.part('shell', { info: 'shell', label: 'Housing', labelAt: [0, 30 * kv, Rb + 3], explode: [0, -56 * kv, 0], st: 0, en: 0.5, cut: true });
  const nPhi = (NR + NC - 1) * 32, dPhi = 360 / nPhi, slotHalf = 3 * dPhi;
  const s0 = G.shell.slotY0, s1 = G.shell.slotY1, ri = Rb - G.shell.t;
  const rows = [G.shell.y0, G.shell.y0 + 0.8 * kv, s0, s1, G.shell.y1 - 0.6 * kv, G.shell.y1].map((y, i) => ({ y, ro: i === 0 ? Rb - 0.25 : i === 5 ? Rb - 0.3 : Rb, ri }));
  const inSlot = (y, phi) => {
    if (y < s0 || y > s1) return false;
    const a = phi / D + 90;
    for (let g = 0; g < NS; g++) { const d = ((a - azSlot(g)) % 360 + 540) % 360 - 180; if (Math.abs(d) < slotHalf) return true; }
    return false;
  };
  B.mesh(shellP, shell(rows, nPhi, inSlot), 'anod');
  const scTex = scaleTex(G, s0, s1), scMat = B.decal(shellP, 'scale', scTex, { metalness: 0.1, roughness: 0.55 });
  for (let g = 0; g < NS; g++) {
    const w = (2.6 / Rb) / D;   // strip width 2.6 mm
    const strip = new THREE.CylinderGeometry(Rb + 0.003, Rb + 0.003, s1 - s0, 6, 1, true, (azSlot(g) + slotHalf + 0.15) * D, w * D);
    strip.translate(0, (s0 + s1) / 2, 0);
    B.mesh(shellP, strip, null, { decal: scMat });
  }
  // guide rails for the slider blocks
  const rails = [];
  for (let g = 0; g < NS; g++) { const [x, , z] = atAz(azSlot(g), Rb - G.shell.t - 1.25); rails.push(rod(0.42, floorY1, s1 + 2, 12).translate(x, 0, z)); }
  B.mesh(shellP, merge(rails), 'steel');

  // ── the drum core (fixed height) and the stepped sleeve (lifts) ───────────
  const A0 = G.A0;
  const drum = B.part('drum', { info: 'drum', label: 'Drum core and carry tooth', labelAt: [0, G.carry.t1 + 1.5, G.drumR + 2], explode: [0, 0, 0], st: 0, en: 1 });
  B.mesh(drum, rod(G.core.r, G.core.y0, G.core.disc0, 48), 'machined');
  B.mesh(drum, rod(G.drumR - 1.0, G.core.disc0, G.carry.t1, 96), 'machined');
  B.mesh(drum, rod(G.hub.r, G.carry.t1, G.hub.y1, 64), 'machined');
  B.mesh(drum, radBox(A0 + RES_CARRY, G.drumR - 1.2, G.toothR, 0.55, G.carry.t0, G.carry.t1 - 0.08), 'red');
  B.mesh(drum, merge([radBox(A0 + CNT_DRIVE, G.hub.r - 0.2, G.hub.tooth, 0.42, G.hub.drive[0], G.hub.drive[1]), radBox(A0 + CNT_CARRY, G.hub.r - 0.2, G.hub.tooth, 0.42, G.hub.ccarry[0], G.hub.ccarry[1])]), 'red');
  // detent wheel with one notch at the home angle of the pawl
  const dw = new THREE.Shape(), dwR = detR - 0.4, nAz = detAz;
  for (let i = 0; i <= 96; i++) { const a = i / 96 * 360, dd = Math.abs(((a - nAz) % 360 + 540) % 360 - 180), r = dd < 6 ? dwR - 1.0 * Math.cos(dd / 6 * Math.PI / 2) : dwR; const v = sxy(a, r); i ? dw.lineTo(v.x, v.y) : dw.moveTo(v.x, v.y); }
  B.mesh(drum, slab(dw, floorY1 + 0.15, 1.1 * kv, 0.1), 'steel');

  const sleeve = B.part('sleeve', { info: 'sleeve', label: 'Stepped drum', labelAt: [0, G.levelY(9) + 3, G.drumR + 3], explode: [0, 0, 0], st: 0, en: 1 });
  B.mesh(sleeve, tube(G.core.r + 0.06, G.drumR, G.sleeve.y0, G.sleeve.y1, 128), 'shaft');
  const add = [], comp = [];
  for (const q of toothSegments(G)) (q.comp ? comp : add).push(radBox(A0 + q.alpha, G.drumR - 0.3, G.toothR, 0.55, q.y0, q.y1));
  B.mesh(sleeve, merge(add), 'steel');
  B.mesh(sleeve, merge(comp), 'blued');
  // two flanges that close the tooth zone
  B.mesh(sleeve, merge([tube(G.drumR - 0.4, G.drumR + 0.5, G.sleeve.y0 + 0.04, G.sleeve.y0 + 0.54, 128), tube(G.drumR - 0.4, G.drumR + 0.5, G.sleeve.y1 - 0.54, G.sleeve.y1 - 0.04, 128)]), 'machined');

  // ── stations ──────────────────────────────────────────────────────────────
  const shafts = [], gears = [], cgears = [], slides = [], sliders = [];
  const shaftY0 = floorY1 + 0.2, shaftY1 = G.deck.y1 + 0.25;
  const cIdle = G.carry.idle, cDrop = G.carry.idle - G.carry.eng;
  for (let p = 0; p < NR; p++) {
    const a = G.stationAz(p), at0 = atAz(a, G.RS), e0 = dirAz(a), out = atAz(a, 9, 0), lab = p === 0, nine = p >= NS;
    const sh = B.part('shaft_' + p, { info: nine ? 'nines' : 'shaft', label: nine && p === NS ? 'Nines station' : lab ? 'Setting shaft' : null, labelAt: [0, nine ? G.levelY(0) + 3 : G.levelY(5), 0], at: at0, e0, explode: out, st: 0.35, en: 0.85 });
    B.mesh(sh, boxGeo(-G.gear.sq, G.gear.sq, shaftY0, G.deck.y1 + 0.1, -G.gear.sq, G.gear.sq), 'shaft');
    // round journals in the floor and the deck, and the dog on top
    B.mesh(sh, merge([rod(0.72, shaftY0 - 0.05, shaftY0 + 1.1, 20), rod(0.9, G.deck.y0 - 0.6, G.deck.y1 + 0.25, 20)]), 'steel');
    B.mesh(sh, dogRibs(0.95, 1.3, 0.12, G.deck.y1 + 0.25, G.deck.y1 + 0.85, 0), 'steel');
    if (nine) B.mesh(sh, merge([spur(10, G.gear.root, G.gear.tip, G.levelY(0) - G.gear.w / 2, G.gear.w, 'sq', G.gear.sq + 0.06), tube(G.gear.sq + 0.06, 1.25, G.levelY(0) + G.gear.w / 2, G.levelY(0) + G.gear.w / 2 + 1, 20)]), 'bronze');
    shafts.push(sh);
    if (!nine) {
      const ge = B.part('gear_' + p, { info: 'setgear', label: lab ? 'Setting gear' : null, labelAt: [0, 2.5, 0], at: at0, e0, explode: out, st: 0.35, en: 0.85 });
      B.mesh(ge, spur(10, G.gear.root, G.gear.tip, -G.gear.w / 2, G.gear.w, 'sq', G.gear.sq + 0.06), 'bronze');
      B.mesh(ge, groovedCollar(1.25, 0.95, G.gear.w / 2 + 0.002, G.gear.sq + 0.07), 'bronze');
      gears.push(ge);
    } else gears.push(null);
    // carry gear and its collar; the slide holds the collar groove
    const cg = B.part('cgear_' + p, { info: 'carrygear', label: lab ? 'Carry gear' : null, labelAt: [0, 2.6, 0], at: at0, e0, explode: [out[0] * 1.2, 6, out[2] * 1.2], st: 0.35, en: 0.9 });
    B.mesh(cg, spur(10, G.gear.root, G.gear.tip, 0, G.gear.w, 'sq', G.gear.sq + 0.06), 'brass');
    B.mesh(cg, groovedCollar(1.25, 0.95, G.gear.w + 0.002, G.gear.sq + 0.07), 'brass');
    cgears.push(cg);
    const sl = B.part('slide_' + p, { info: 'slide', label: lab ? 'Carry slide' : null, labelAt: [G.carry.slideR + 1.5, 4, 0], at: [0, 0, 0], e0, explode: [out[0] * 1.6, 8, out[2] * 1.6], st: 0.35, en: 0.9 });
    // local x radial: bar at slideR from the fork up through the deck
    const fy = cIdle + G.gear.w + 0.45, sr = G.carry.slideR;
    const fork = new THREE.Shape([[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]].map(v => new THREE.Vector2(...v))); fork.holes.push(circle(1.02));
    const forkG = slab(fork, fy + 0.05, 0.6, 0.05); forkG.translate(G.RS, 0, 0);
    B.mesh(sl, merge([forkG, boxGeo(G.RS + 1.7, sr, fy + 0.05, fy + 0.65, -0.35, 0.35), boxGeo(sr - 0.4, sr + 0.4, fy - 0.6, G.deck.y1 + 0.55, -0.4, 0.4)]), 'brass');
    slides.push(sl);
  }
  // sliders
  for (let g = 0; g < NS; g++) {
    const a = azSlot(g), lab = g === 0, e0 = dirAz(a);
    const sl = B.part('slider_' + g, { info: 'slider', label: lab ? 'Setting slider' : null, labelAt: [Rb + 4, 2, 0], at: [0, 0, 0], e0, explode: [...atAz(a, 22, 0)], st: 0.2, en: 0.75 });
    const y0 = G.levelY(0), gy = y0 + G.gear.w / 2 + 0.47, rIn = Rb - G.shell.t;
    const fork = new THREE.Shape([[-1.9, -1.8], [6, -1.8], [6, 1.8], [-1.9, 1.8]].map(v => new THREE.Vector2(...v))); fork.holes.push(circle(1.02));
    const fg = slab(fork, gy, 0.6, 0.05); fg.translate(G.RS, 0, 0);
    const blockR0 = rIn - 2.2, blockR1 = rIn - 0.2;
    // stem: narrower than the slot (slot half width at Rb)
    const stemW = Math.min(0.55, Rb * Math.sin(slotHalf * D) - 0.3);
    B.mesh(sl, merge([fg, boxGeo(G.RS + 5.9, blockR0 + 0.1, gy, gy + 0.6, -0.5, 0.5)]), 'steel');
    B.mesh(sl, merge([boxGeo(blockR0, blockR1, y0 - 1.6, y0 + 1.9, -1.7, 1.7), boxGeo(blockR1 - 0.1, Rb + 0.35, y0 - 0.5, y0 + 0.5, -stemW, stemW)]), 'shaft');
    // the knob: a rounded black grip with a white index line
    const knob = lathe([[[0.01, 0], [1.15, 0], [1.45, 0.4], [1.45, 1.6], [1.15, 2.0]], [[0.01, 2.0]]], 24);
    knob.rotateZ(-Math.PI / 2); knob.translate(Rb + 0.35, y0, 0);
    B.mesh(sl, knob, 'anodRed');
    B.mesh(sl, boxGeo(Rb + 2.35, Rb + 2.42, y0 - 0.12, y0 + 0.12, -0.8, 0.8), 'ivory');
    sliders.push(sl);
  }

  // ── counter stations, reversing pinion and lever ─────────────────────────
  const cshafts = [], ccgears = [];
  for (let q = 0; q < NC; q++) {
    const a = G.stationAz(q), at0 = atAz(a, G.RQ), e0 = dirAz(a), out = atAz(a, 6, 4);
    const cs = B.part('cshaft_' + q, { info: q ? 'cshaft' : 'cdrive', label: q === 0 ? 'Counter drive' : q === 1 ? 'Counter station' : null, labelAt: [0, G.hub.drive[1] + 1, 0], at: at0, e0, explode: out, st: 0.35, en: 0.85 });
    B.mesh(cs, boxGeo(-0.45, 0.45, G.hub.y0 + 0.3, G.deck.y1 + 0.1, -0.45, 0.45), 'shaft');
    B.mesh(cs, rod(0.7, G.deck.y0 - 0.6, G.deck.y1 + 0.25, 16), 'steel');
    B.mesh(cs, dogRibs(0.75, 1.05, 0.1, G.deck.y1 + 0.25, G.deck.y1 + 0.75, 0), 'steel');
    if (!q) B.mesh(cs, spur(10, G.cpin.root, G.cpin.tip, G.hub.drive[0], G.cpin.w, 'sq', 0.5), 'bronze');
    cshafts.push(cs);
    if (q) {
      const cc = B.part('ccgear_' + q, { info: 'ccarry', label: q === 1 ? 'Counter carry gear' : null, labelAt: [0, 2, 0], at: at0, e0, explode: [out[0] * 1.3, 6, out[2] * 1.3], st: 0.35, en: 0.9 });
      B.mesh(cc, spur(10, G.cpin.root, G.cpin.tip, 0, G.cpin.w, 'sq', 0.5), 'brass');
      ccgears.push(cc);
    } else ccgears.push(null);
  }
  // reversing pinion: a small idler beside counter station 0 that slides
  // radially between its two meshes (forward, reverse)
  const revAz = G.stationAz(0), revR = G.RQ + 3.15;
  const revP = B.part('revpin', { info: 'reverse', label: null, at: atAz(revAz, revR), e0: dirAz(revAz), explode: atAz(revAz, 6, 4), st: 0.35, en: 0.85 });
  B.mesh(revP, spur(8, 0.9, 1.35, G.hub.drive[0] + 0.1, 0.8, null, 0.3), 'bronze');
  B.mesh(revP, rod(0.3, G.hub.drive[0] - 0.4, G.hub.drive[1] + 0.6, 10), 'steel');
  // the reversing lever on the deck rim (pivot on a radial axis)
  const rlAz = -G.A0 - 1.6 * G.pitch;
  const revL = B.part('revlever', { info: 'revlever', label: 'Reversing lever', labelAt: [0, 4, 2], at: atAz(rlAz, Rb + 0.05, G.deck.y0 + 1), u: dirAz(rlAz), e0: [0, 1, 0], explode: atAz(rlAz, 10, 0), st: 0.2, en: 0.7 });
  // local y = radial out; local x = up
  B.mesh(revL, rod(1.1, 0, 0.9, 24), 'machined');
  B.mesh(revL, merge([boxGeo(-0.45, 0.45, 0.9, 1.6, -4.2, 0.6), rod(0.8, 1.6, 2.6, 16).translate(0, 0, -4.2)]), 'anodRed');

  // ── deck ──────────────────────────────────────────────────────────────────
  const deck = B.part('deck', { info: 'deck', label: 'Top deck', labelAt: [0, G.deck.y1 + 1, Rb + 2], explode: [0, 15 * kv, 0], st: 0.1, en: 0.6, cut: true });
  const dk = new THREE.Shape(); dk.absarc(0, 0, Rb, 0, TAU, false);
  dk.holes.push(circle(G.crank.shaftR + 0.6));
  for (let p = 0; p < NR; p++) { const v = sxy(G.stationAz(p), G.RS); dk.holes.push(circle(0.98, v.x, v.y)); const w = sxy(G.stationAz(p), G.carry.slideR); dk.holes.push(circle(0.68, w.x, w.y)); }
  for (let q = 0; q < NC; q++) { const v = sxy(G.stationAz(q), G.RQ); dk.holes.push(circle(0.78, v.x, v.y)); }
  B.mesh(deck, slab(dk, G.deck.y0, G.deck.y1 - G.deck.y0, 0), 'machined');
  // the shift scale: numbers 1 .. NC where the carriage index points
  const Aref = G.A0 + G.pitch / 2;
  const deckTex = ringTex(Rb, (g, P, s) => {
    for (let c = 0; c < NC; c++) { label(g, P, s, Rb - 0.95, Aref + c * G.pitch, String(c + 1), 1.15); }
    g.strokeStyle = '#f0ede6'; g.lineWidth = 0.18 * s;
    for (let c = 0; c < NC; c++) { const [x0, y0] = P(Rc + 0.1, Aref + c * G.pitch), [x1, y1] = P(Rc + 0.4, Aref + c * G.pitch); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  });
  ringDecal(B, deck, Rc - 0.2, Rb - 0.05, G.deck.y1, deckTex);

  // ── carriage ──────────────────────────────────────────────────────────────
  const car = B.part('carriage', { info: 'carriage', label: 'Carriage', labelAt: [0, G.car.top1 + 1, Rc + 3], explode: [0, 34 * kv, 0], st: 0.1, en: 0.6, cut: true });
  const C = G.car, plate = new THREE.Shape(); plate.absarc(0, 0, Rc - 0.75, 0, TAU, false);
  plate.holes.push(circle(5.2));
  for (let j = 0; j < NR; j++) { const v = sxy(G.stationAz(j), G.RS); plate.holes.push(circle(0.75, v.x, v.y)); const w = sxy(G.stationAz(j), G.carry.slideR); plate.holes.push(circle(0.7, w.x, w.y)); }
  for (let k = 0; k < NC; k++) { const v = sxy(G.stationAz(k), G.RQ); plate.holes.push(circle(0.62, v.x, v.y)); }
  B.mesh(car, slab(plate, C.y0, C.plate1 - C.y0, 0.15), 'anod');
  // knurled rim, the inner wall, wheel posts
  const rim = lathe([[[Rc, C.y0 + 0.4], [Rc, C.top0 - 0.3]], [[Rc - 0.75, C.top0 - 0.3], [Rc - 0.75, C.y0 + 0.4]]], 192);
  B.mesh(car, rim, 'knurl');
  // the bands overlap the rim by 0.03 mm and stop 0.03 mm short of the
  // plates, so no two faces meet in one plane (the cutaway shows them)
  B.mesh(car, merge([lathe([[[Rc - 0.3, C.y0 + 0.03], [Rc - 0.3, C.y0 + 0.43]], [[Rc - 0.78, C.y0 + 0.43], [Rc - 0.78, C.y0 + 0.03]]], 128), lathe([[[Rc - 0.3, C.top0 - 0.33], [Rc - 0.3, C.top0 - 0.03]], [[Rc - 0.78, C.top0 - 0.03], [Rc - 0.78, C.top0 - 0.33]]], 128)]), 'machined');
  B.mesh(car, tube(5.25, 5.9, C.plate1 + 0.03, C.top0 - 0.03, 64), 'anod');
  const wY = C.top0 - G.rw - 0.32, cY = C.top0 - G.rc - 0.3;
  const posts = [];
  for (let j = 0; j < NR; j++) { const a = G.stationAz(j); posts.push(radBox(a, G.RW + G.hlw + 0.45, G.RW + G.hlw + 1.05, 0.5, C.plate1 + 0.03, wY + 0.7)); }
  for (let k = 0; k < NC; k++) { const a = G.stationAz(k); posts.push(radBox(a, G.RCw - G.hlc - 1.1, G.RCw - G.hlc - 0.4, 0.4, C.plate1 + 0.03, cY + 0.6)); }
  B.mesh(car, merge(posts), 'machined');
  // top plate with windows
  const top = new THREE.Shape(); top.absarc(0, 0, Rc - 0.02, 0, TAU, false); top.holes.push(circle(5.4));
  for (let j = 0; j < NR; j++) top.holes.push(winPath(G.stationAz(j), G.RW - G.hlw + 0.3, G.RW + G.hlw - 0.3, 0.48 * TAU * G.rw / 10));
  for (let k = 0; k < NC; k++) top.holes.push(winPath(G.stationAz(k), G.RCw - G.hlc + 0.25, G.RCw + G.hlc - 0.25, 0.48 * TAU * G.rc / 10));
  // no shadow from the top plate: the digits under the windows stay lit
  B.mesh(car, slab(top, C.top0, C.top1 - C.top0, 0.18), 'anod', { shadow: false });
  // engraved place numbers and the shift index
  const topTex = ringTex(Rb, (g, P, s) => {
    for (let j = 0; j < NR; j++) label(g, P, s, Math.min(Rc - 1.0, G.RW + G.hlw + 1.0), G.stationAz(j), String(j + 1), 1.45, '#cfcabe', 500);
    for (let k = 0; k < NC; k++) label(g, P, s, G.RCw - G.hlc - 0.9, G.stationAz(k), String(k + 1), 1.1, '#cfcabe', 500);
    // thousands marks between the result windows
    g.fillStyle = '#e8e2d4';
    for (let j = 2; j < NR - 1; j += 3) { const [x, y] = P(G.RW, G.stationAz(j) - G.pitch / 2); g.beginPath(); g.arc(x, y, 0.32 * s, 0, 7); g.fill(); }
    // the shift index: a triangle at the rim that points to the deck scale
    const [x0, y0] = P(Rc - 0.2, Aref), [x1, y1] = P(Rc - 2.0, Aref - 1.6), [x2, y2] = P(Rc - 2.0, Aref + 1.6);
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x2, y2); g.closePath(); g.fill();
  });
  ringDecal(B, car, 5.5, Rc - 0.1, C.top1, topTex);
  // decimal point markers: ivory tabs in the rim of the top plate
  const tabs = [];
  for (const [r, j] of [[G.RW, 2.5], [G.RCw, 1.5]]) { const a = G.stationAz(0) - G.pitch * j; tabs.push(radBox(a, r - 0.6, r + 0.6, 0.35, C.top1, C.top1 + 0.35)); }
  const tabP = B.part('decimal', { info: 'decimal', label: null, parent: car.root, explode: [0, 5, 0], st: 0.6, en: 1 });
  B.mesh(tabP, merge(tabs), 'ivory');

  const ishafts = [], res = [], clevers = [], cnts = [], cishafts = [];
  for (let j = 0; j < NR; j++) {
    const a = G.stationAz(j), n = dirAz(a), tg = [Math.cos(a * D), 0, -Math.sin(a * D)], lab = j === 0;
    // intermediate shaft: dog at the bottom, pinion at the crown of the wheel
    const is = B.part('ishaft_' + j, { info: 'inter', label: lab ? 'Intermediate pinion' : null, labelAt: [0, wY - 3, 0], parent: car.root, at: atAz(a, G.RS), e0: n, explode: [0, 8, 0], st: 0.55, en: 1 });
    const pinY = wY - G.rw * 0.78;
    B.mesh(is, rod(0.5, C.y0 - 0.05, pinY + 0.4, 12), 'steel');
    B.mesh(is, dogRibs(0.95, 1.3, 0.12, C.y0 - 0.75, C.y0 - 0.15, 18), 'steel');
    B.mesh(is, rod(1.3, C.y0 - 0.15, C.y0 + 0.02, 20), 'steel');
    B.mesh(is, spur(10, 1.05, 1.55, pinY - 0.45, 0.85, null, 0.5, 0.05), 'bronze');
    ishafts.push(is);
    // digit wheel: axis radial and inward; local +Z is up
    const w = B.part('res_' + j, { info: 'result', label: lab ? 'Result wheels' : null, labelAt: [0, 0, G.rw + 3], parent: car.root, at: atAz(a, G.RW, wY), u: n.map(v => -v), e0: tg, explode: [0, 12, 0], st: 0.55, en: 1 });
    const side = new THREE.CylinderGeometry(G.rw, G.rw, 2 * G.hlw - 0.6, 60, 1, true);
    B.mesh(w, side, 'digitsW');
    B.mesh(w, merge([tube(0.42, G.rw + 0.3, -G.hlw, -G.hlw + 0.3, 48), tube(0.42, G.rw + 0.3, G.hlw - 0.3, G.hlw, 48), tube(0.42, G.rw - 0.02, -G.hlw + 0.3, -G.hlw + 0.6, 40), tube(0.42, G.rw - 0.02, G.hlw - 0.6, G.hlw - 0.3, 40)]), 'anod');
    B.mesh(w, rod(0.4, -G.hlw - 1.55, G.hlw + 1.0, 10), 'steel');
    // crown pins on the inner face (local +y is inward)
    const crown = [];
    for (let i = 0; i < 10; i++) { const b = (i + 0.5) * 36 * D; crown.push(rod(0.22, G.hlw, G.hlw + 0.55, 8).translate((G.rw - 0.5) * Math.sin(b), 0, (G.rw - 0.5) * Math.cos(b))); }
    B.mesh(w, merge(crown), 'machined');
    // the carry trip tooth on the outer flange, at the 9 -> 0 place
    const trip = boxGeo(-0.25, 0.25, -G.hlw - 0.02, -G.hlw + 0.32, G.rw + 0.25, G.rw + 0.95); trip.rotateY(-0.5 * 36 * D);
    B.mesh(w, trip, 'steel');
    res.push(w);
    // carry lever: a rocker over the slide pin of the station under wheel j
    const pivAz = a + G.pitch * 0.42, sr = G.carry.slideR;
    const lv = B.part('clever_' + j, { info: 'carrylever', label: j === 1 ? 'Carry lever' : null, labelAt: [0, 2, 0], parent: car.root, at: atAz(pivAz, sr, C.plate1 + 0.9), u: dirAz(pivAz).map(v => -v), e0: [0, 1, 0], explode: [0, 4, 0], st: 0.55, en: 1 });
    // local y radial in, local x up, local z = x × y (tangential)
    const arm = (sr * (pivAz - a) * D);
    B.mesh(lv, merge([rod(0.35, -0.8, 0.8, 10), boxGeo(-0.3, 0.3, -0.3, 0.3, -0.2, arm + 0.2).translate(0, 0, 0), boxGeo(-1.6, 0.25, -0.28, 0.28, arm - 0.2, arm + 0.25), boxGeo(-0.3, 2.2, -0.28, 0.28, -1.1, -0.5)]), 'brass');
    clevers.push({ p: lv, arm });
  }
  for (let k = 0; k < NC; k++) {
    const a = G.stationAz(k), n = dirAz(a), tg = [Math.cos(a * D), 0, -Math.sin(a * D)], lab = k === 0;
    const is = B.part('cishaft_' + k, { info: 'cinter', label: null, parent: car.root, at: atAz(a, G.RQ), e0: n, explode: [0, 8, 0], st: 0.55, en: 1 });
    const pinY = cY - G.rc * 0.8;
    B.mesh(is, rod(0.4, C.y0 - 0.05, pinY + 0.3, 10), 'steel');
    B.mesh(is, dogRibs(0.75, 1.05, 0.1, C.y0 - 0.65, C.y0 - 0.15, 18), 'steel');
    B.mesh(is, rod(1.05, C.y0 - 0.15, C.y0 + 0.02, 16), 'steel');
    B.mesh(is, spur(10, 0.8, 1.15, pinY - 0.35, 0.65, null, 0.4, 0.04), 'bronze');
    cishafts.push(is);
    const w = B.part('cnt_' + k, { info: 'counter', label: lab ? 'Turn counter' : null, labelAt: [0, 0, G.rc + 3], parent: car.root, at: atAz(a, G.RCw, cY), u: n.map(v => -v), e0: tg, explode: [0, 12, 0], st: 0.55, en: 1 });
    B.mesh(w, new THREE.CylinderGeometry(G.rc, G.rc, 2 * G.hlc - 0.5, 48, 1, true), 'digitsW');
    B.mesh(w, merge([tube(0.32, G.rc + 0.2, -G.hlc, -G.hlc + 0.25, 40), tube(0.32, G.rc + 0.2, G.hlc - 0.25, G.hlc, 40), tube(0.32, G.rc - 0.02, -G.hlc + 0.25, -G.hlc + 0.5, 32), tube(0.32, G.rc - 0.02, G.hlc - 0.5, G.hlc - 0.25, 32)]), 'anod');
    B.mesh(w, rod(0.3, -G.hlc - 1.2, G.hlc + 0.9, 8), 'steel');
    const crown = [];
    for (let i = 0; i < 10; i++) { const b = (i + 0.5) * 36 * D; crown.push(rod(0.16, G.hlc, G.hlc + 0.4, 6).translate((G.rc - 0.35) * Math.sin(b), 0, (G.rc - 0.35) * Math.cos(b))); }
    B.mesh(w, merge(crown), 'machined');
    cnts.push(w);
  }

  // ── clearing lever (on the carriage) ─────────────────────────────────────
  const L0 = clearRest(G, U);
  const clr = B.part('clearing', { info: 'clearing', label: 'Clearing lever', labelAt: [...atAz(L0, Rc - 2, C.top1 + 3)], parent: car.root, explode: [0, 22, 0], st: 0.45, en: 0.95 });
  B.mesh(clr, tube(6.0, 7.6, C.top1 + 0.01, C.top1 + 0.85, 96), 'machined');
  const armG = radBox(L0, 7.0, Rc - 0.6, 1.1, C.top1 + 0.86, C.top1 + 1.5);
  B.mesh(clr, merge([armG, radBox(L0, Rc - 0.6, Rc + 0.9, 1.1, C.top1 - 0.6, C.top1 + 1.5), radBox(L0, Rc + 0.3, Rc + 0.9, 0.9, C.top1 - 3.5, C.top1 - 0.6)]), 'machined');
  B.mesh(clr, lathe([[[0.01, 0], [1.3, 0], [1.3, 1.4], [0.9, 2.2]], [[0.01, 2.2]]], 20).translate(...atAz(L0, Rc - 2.6, C.top1 + 1.5)), 'anod');

  // ── crank ─────────────────────────────────────────────────────────────────
  const K = G.crank;
  const crank = B.part('crank', { info: 'crank', label: 'Crank', labelAt: [K.r, K.knob1 + 2, 0], explode: [0, 54 * kv, 0], st: 0.2, en: 0.7 });
  B.mesh(crank, rod(K.shaftR, G.hub.y1 - 3, K.y0 + 0.1, 32), 'chrome');
  B.mesh(crank, tube(K.shaftR - 0.05, K.shaftR + 0.06, C.top1 - 2.4, C.top1 + 0.02, 32), 'red');
  B.mesh(crank, lathe([[[4.4, K.y0], [4.4, K.boss1 - 0.6], [3.9, K.boss1]], [[0.01, K.boss1], [0.01, K.y0]]], 48), 'chrome');
  const armS = new THREE.Shape(); armS.moveTo(0, -2.9); armS.lineTo(K.r, -1.7); armS.absarc(K.r, 0, 1.7, -Math.PI / 2, Math.PI / 2, false); armS.lineTo(0, 2.9); armS.absarc(0, 0, 2.9, Math.PI / 2, 3 * Math.PI / 2, false);
  B.mesh(crank, slab(armS, K.boss1, K.arm1 - K.boss1, 0.4), 'chrome');
  const knob = lathe([[[0.01, K.arm1 + 0.3], [1.7, K.arm1 + 0.3], [2.05, K.arm1 + 1.4], [1.9, K.knob1 - 1.6], [1.45, K.knob1 - 0.3]], [[0.01, K.knob1]]], 32);
  knob.translate(K.r, 0, 0);
  B.mesh(crank, knob, 'anod');
  B.mesh(crank, rod(0.8, K.arm1 - 0.1, K.arm1 + 0.4, 16).translate(K.r, 0, 0), 'chrome');

  // ── pose ──────────────────────────────────────────────────────────────────
  let P = plan(U, jobMul(U, 4711, 23).actions);
  const lv0 = G.levelY(0);
  function pose(t) {
    const Q = typeof t === 'number' ? at(P, t) : t;
    const th = Q.drum * D;
    drum.spin(-th); sleeve.spin(-th);
    sleeve.root.position.y = Q.lift * G.sleeve.lift;
    crank.spin(-th); crank.root.position.y = Q.lift * K.lift;
    for (let p = 0; p < NR; p++) {
      const sp = Q.st[p] * 36 * D;
      shafts[p].spin(sp);
      if (gears[p]) { gears[p].spin(sp); gears[p].root.position.y = G.levelY(Q.set[p]); }
      cgears[p].spin(sp); cgears[p].root.position.y = cIdle - Q.slide[p] * cDrop;
      slides[p].root.position.y = -Q.slide[p] * cDrop;
    }
    for (let g = 0; g < NS; g++) sliders[g].root.position.y = G.levelY(Q.set[g]) - lv0;
    for (let q = 0; q < NC; q++) {
      cshafts[q].spin(Q.cq[q] * 36 * D);
      if (ccgears[q]) { ccgears[q].spin(Q.cq[q] * 36 * D); ccgears[q].root.position.y = G.hub.cidle - Q.cslide[q] * (G.hub.cidle - G.hub.ccarry[0]); }
    }
    // reversing pinion: in for forward, out for reverse
    const rv = Math.abs(Q.lift - Q.rev);
    revP.root.position.set(...atAz(revAz, revR + 0.7 * rv));
    revP.spin(-Q.cq[0] * 36 * D * 1.25);
    revL.spin((Q.rev * 2 - 1) * 22 * D);
    // the detent pawl rides out of the notch while the crank turns
    const off = Math.abs(((Q.drum % 360) + 540) % 360 - 180), out = 1 - Math.min(1, Math.max(0, (180 - off) / 10));
    detent.root.position.set(...atAz(detAz, detR + 2.4 - 0.75 * (1 - out), floorY1 + 0.6 * kv));
    car.spin(Q.car * G.pitch * D);
    car.root.position.y = Q.carLift * C.lift;
    for (let j = 0; j < NR; j++) {
      res[j].spin(-(Q.R[j] + 0.5) * 36 * D);
      ishafts[j].spin(Q.R[j] * 36 * D);
      // the carry lever over station p = j - c follows its slide
      const p = j - Math.round(Q.car), down = Q.carLift < 0.02 && p >= 0 && p < NR ? Q.slide[p] : 0;
      clevers[j].p.spin(-down * 0.32);
    }
    for (let k = 0; k < NC; k++) { cnts[k].spin(-(Q.C[k] + 0.5) * 36 * D); cishafts[k].spin(Q.C[k] * 36 * D); }
    clr.spin(-Q.clear * D);
    return Q;
  }
  // a world point on the part that moves now (for the follow camera)
  function focus(Q) {
    const A = Q.active, carA = Q.car * G.pitch;
    if (!A) return null;
    if (A.kind === 'slider') return atAz(G.stationAz(Math.max(0, A.p)), Rb, G.levelY(Q.set[Math.max(0, A.p)]));
    if (A.kind === 'crank') return [0, K.y0, 0];
    if (A.kind === 'rev') return atAz(rlAz, Rb, G.deck.y0);
    if (A.kind === 'carriage') return atAz(G.stationAz(0) + carA, G.RW, C.top1);
    if (A.kind === 'clear') return atAz(A.a + carA, Rc - 2, C.top1);
    if (A.kind === 'turn') {
      if (A.reg === 'C') return atAz(G.stationAz(A.p), G.RQ, G.hub.drive[1]);
      const y = A.wk === 'carry' ? G.carry.eng : A.p < NS ? G.levelY(Q.set[A.p]) : G.levelY(0);
      return atAz(G.stationAz(A.p), G.RS - 1.5, y);
    }
    return null;
  }
  const keys = {
    drum: [0, G.levelY(4.5), 0], top: [0, C.top1, 0], sliders: [0, G.levelY(4.5), Rb * 0.6], crank: [0, K.boss1, 0],
    carry: [...atAz(G.stationAz(1), G.RS, G.carry.eng + 1.5)], counter: [...atAz(G.stationAz(0), G.RQ, G.hub.drive[1] + 2)],
  };
  return {
    U, G, setPlan(p) { P = p; }, get plan() { return P; }, pose, focus,
    box: { c: [0, 44 * kv, 0], R: Math.hypot(Rb, 50 * kv) * 1.05 },
    keys, stationAz: G.stationAz,
    meshesOf: ids => ids.map(i => B.parts[i]).filter(Boolean).map(q => q.holder),
  };
}
