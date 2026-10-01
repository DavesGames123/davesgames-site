// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases.js — the case round a working movement
// ────────────────────────────────────────────────────────────────────────────
//  caseDims(spec, cal) decides what the movement scene must change for this
//  case (dial or none, hand styles and lengths, parts to hide) and the size
//  for the camera. buildCase(B, spec, cal, dims) adds the case parts to the
//  same builder as the movement, so they glow, fade and explode with it,
//  and returns pose() for its moving parts and PARTS for its cards.
//
//  FRAME  (as the movement: mm, y to 12 o'clock, z out of the caseback, the
//  dial faces -z at cal.CAL.z.dialLo). Seen from the dial, +x is 9 o'clock,
//  so a wristwatch crown at 3 sits at -x.
//
//  TYPES
//    pocket  lathe-turned band, bezel (smooth, coin, fluted), domed or flat
//            crystal, display or hinged back, hunter lid, pendant, crown, bow
//    wrist   band in four outlines (round, cushion, tonneau, square), bezel
//            (incl. diver), lugs, crown at 3, strap / bracelet / mesh
//    wall    a 230-320 mm case (schoolhouse wood, station, kitchen, porthole)
//            with its own large dial; the movement sits behind it
//    alarm   a twin-bell drum: bells, hammer (rings), handle, feet, keys
//
//  GREP MAP
//    function caseDims ....... dial size, hands, hidden parts, fit radius
//    function buildCase ...... dispatch by type
//    function pocketCase / wristCase / wallCase / alarmCase
// ============================================================================
import * as THREE from 'three';
import * as G from '../watch-movement/geom.js';
import { circ, hole } from '../watch-movement/kit.js';
import { paintDial } from '../watch-movement/scenes/shared.js';
import { METALS, PAINTS, WOODS, LEATHERS } from './generator.js';
const { TAU, D, pol } = G;

// hand widths that suit each style at a given length L (as a factor of L)
const HAND_W = { breguet: 0.042, dauphine: 0.06, leaf: 0.045, sword: 0.05, spade: 0.026, cathedral: 0.03, baton: 0.035, beetle: 0.04, poker: 0.022 };
// the breguet pomme and tip have a fixed size, so clocks use a spade
const forClock = s => (s === 'breguet' || s === 'beetle' ? 'spade' : s);
const HAND_MAT = { blued: 'blued', black: 'black', gold: 'gold', steel: 'polished', lume: 'lume' };
const SEC_MAT = { red: 'paint', gold: 'gold', blue: 'blued' };
const DIAL_R = { lever: 18.6, tourbillon: 18.6, automatic: 12.9, verge: 18.9 };
const ROTOR_PARTS = ['rotor', 'rotorHub', 'autoBridge', 'reduction', 'rev1Wheel', 'rev2Wheel', 'rev1Pin', 'rev2Pin', 'aScrews'];

export function caseDims(spec, cal) {
  const f = spec.face, c = spec.case, calId = spec.movement.calibre;
  const hide = calId === 'verge' ? [] : ['stem'];
  const clock = spec.type === 'wall' || spec.type === 'alarm';
  if (clock && calId === 'automatic') hide.push(...ROTOR_PARTS);
  const dialR = spec.type === 'wall' ? c.diameter / 2 - ({ schoolhouse: 22, station: 12, kitchen: 11, porthole: 20 }[c.style]) : spec.type === 'alarm' ? c.diameter / 2 - 7 : DIAL_R[calId];
  const hs = clock ? forClock(f.handStyle) : f.handStyle;
  const ms = hs === 'beetle' ? 'poker' : hs;
  const hourL = clock ? dialR * 0.55 : { lever: 9.6, tourbillon: 9.6, verge: 10, automatic: 6.4 }[calId];
  const minL = clock ? dialR * 0.84 : { lever: 14.6, tourbillon: 14.6, verge: 15, automatic: 10.2 }[calId];
  const mat = HAND_MAT[f.handColor] || 'blued';
  const hands = {
    hour: [hs, hourL, hourL * (HAND_W[hs] || 0.04) * (clock ? 1.4 : 1)],
    minute: [ms, minL, minL * (HAND_W[ms] || 0.03) * (clock ? 1.3 : 1)],
    mat, hubR: clock ? dialR * 0.035 : (calId === 'automatic' ? 0.6 : 1.0),
  };
  if (f.seconds === 'none' && clock) hands.second = false;
  if (f.seconds === 'centre') {
    const L = clock ? dialR * 0.9 : 11.2;
    hands.second = { at: [0, 0], len: L, z: cal.CAL.z.dialLo - 0.85, w: clock ? dialR * 0.012 : 0.16, hub: clock ? dialR * 0.022 : 0.32, mat: f.secondColor === 'match' ? mat : SEC_MAT[f.secondColor], lollipop: f.lollipop };
  } else if (hands.second !== false) hands.secondStyle = { mat: f.secondColor === 'match' ? mat : SEC_MAT[f.secondColor], lollipop: f.lollipop };
  // the dial art; its seconds display follows the calibre
  const L = cal.L;
  const paint = paintDial({
    base: f.base, numerals: f.numerals, track: f.track, accent: f.accent, serifBrand: calId === 'verge' || f.numerals === 'roman',
    sub: f.seconds === 'small' && !clock ? [-L.F[1], 3.95] : null,
    aperture: f.seconds === 'aperture' ? [-L.O[1], cal.CAL.cageR + 0.15] : null,
    brand: f.brand.toUpperCase(), line: { automatic: 'AUTOMATIC', tourbillon: 'TOURBILLON', lever: clock ? f.city.toUpperCase() : 'CHRONOMETER', verge: f.city.toUpperCase() }[calId],
  });
  const R = spec.type === 'wall' ? c.diameter / 2 : spec.type === 'alarm' ? c.diameter / 2 + 26 : spec.type === 'wrist' ? DIAL_R[calId] + 18 : DIAL_R[calId] + 10;
  return { clock, dialR, hands, hide, noDial: clock, paint, R };
}

// a lathe solid round z from a closed (r, z) profile
function lathe(B, prof, mat, seg = 128) {
  const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(Math.PI / 2);
  return B.mesh(g, mat);
}
// a spherical cap (domed crystal) of base radius r and height h, bulging to -z from z0
function cap(B, r, h, z0, mat) {
  const rho = (r * r + h * h) / (2 * h), th = Math.asin(Math.min(1, r / rho));
  const g = new THREE.SphereGeometry(rho, 64, 12, 0, TAU, 0, th);
  g.rotateX(-Math.PI / 2); g.translate(0, 0, z0 - h + rho);
  return B.mesh(g, mat);
}
// a bezel outline: smooth, coin edge or fluted
function bezelOutline(style, R) {
  if (style === 'coin') { const n = Math.round(R * 11); return G.gearProfile(n, 2 * R / n, { t: 0.5, ha: 0.3, hf: 0.3, seg: 2 }); }
  if (style === 'fluted') { const n = Math.round(R * 3.2); return G.gearProfile(n, 2 * R / n, { t: 0.62, ha: 0.28, hf: 0.32, seg: 4 }); }
  return circ(R, 160);
}

export function buildCase(B, spec, cal, dims) {
  const Z = cal.CAL.z;
  const zFront = Z.dialLo, zBack = cal.zRange[1] + (spec.movement.calibre === 'automatic' && dims.clock ? -2.2 : 0.8);
  if (spec.type === 'pocket') return pocketCase(B, spec, cal, dims, zFront, zBack);
  if (spec.type === 'wrist') return wristCase(B, spec, cal, dims, zFront, zBack);
  if (spec.type === 'wall') return wallCase(B, spec, cal, dims, zFront, zBack);
  return alarmCase(B, spec, cal, dims, zFront, zBack);
}

// ── pocket watch ────────────────────────────────────────────────────────────
function pocketCase(B, spec, cal, dims, zF, zB) {
  const c = spec.case, Ri = DIAL_R[spec.movement.calibre] + 0.35, Ro = Ri + 2.4, zM = (zF + zB) / 2;
  B.layer('caseFront', -3.4); B.layer('caseMid', 0); B.layer('caseBack', 4.4);
  const band = B.part('case', 'caseMid', [0, 0], { label: 'Case', labelAt: [-Ro, 0], labelZ: zM });
  B.add(band, lathe(B, [[Ri, zF - 0.6], [Ro - 0.9, zF - 0.6], [Ro - 0.2, zF + 0.1], [Ro, zF + 1.2], [Ro, zB - 1.2], [Ro - 0.2, zB - 0.1], [Ro - 0.9, zB + 0.4], [Ri, zB + 0.4]], 'polished'));
  // pendant, crown and bow at 12
  const pend = B.part('pendant', 'caseMid', [0, 0], { label: spec.movement.calibre === 'verge' ? 'Pendant and bow' : 'Crown and bow', labelAt: [0, Ro + 9], labelZ: zM, info: 'pendant' });
  const pc = B.cyl(1.7, 0, 3.6, 'polished', 24); pc.geometry.rotateX(-Math.PI / 2); pc.geometry.translate(0, Ro - 0.4, zM);
  B.add(pend, pc);
  if (spec.movement.calibre !== 'verge') {
    const cr = B.slab(G.gearProfile(32, 0.32, { t: 0.5, ha: 0.5, hf: 0.5, seg: 3 }), [], 0, 3.0, 'polished', 0.25);
    cr.geometry.rotateX(-Math.PI / 2); cr.geometry.translate(0, Ro + 3.1, zM);
    B.add(pend, cr);
  } else {
    const kn = B.cyl(1.2, 0, 1.6, 'polished', 16); kn.geometry.rotateX(-Math.PI / 2); kn.geometry.translate(0, Ro + 3.1, zM); B.add(pend, kn);
  }
  const bowR = Ro * 0.36, bow = new THREE.TorusGeometry(bowR, 0.85, 14, 64, Math.PI * 1.3);
  bow.rotateZ(-Math.PI * 0.15); if (c.bow === 'oval') bow.scale(1.25, 0.9, 1); bow.translate(0, Ro + 4.4, zM);
  B.add(pend, B.mesh(bow, 'polished'));
  // bezel and crystal
  const bz = B.part('bezel', 'caseFront', [0, 0], { label: 'Bezel and crystal', labelAt: [Ro * 0.7, -Ro * 0.7], labelZ: zF - 1 });
  B.add(bz, B.slab(bezelOutline(c.bezel, Ro - 0.1), [hole(Ri - 0.9, 128)], zF - 1.6, zF - 0.5, 'polished', 0.35));
  const cry = B.part('crystal', 'caseFront', [0, 0], {});
  const glass = cap(B, Ri - 0.9, c.crystal === 'domed' ? 2.6 : 0.5, zF - 1.1, 'glass'); glass.userData.noShadow = true;
  B.add(cry, glass);
  // the back: display glass, or a lid hinged at the side
  const back = B.part('caseback', 'caseBack', [0, 0], { label: 'Caseback', labelAt: [-Ro * 0.7, -Ro * 0.7], labelZ: zB + 1 });
  let backLid = null, frontLid = null;
  if (c.back === 'display') {
    B.add(back, B.ring(Ri - 2.2, Ro - 0.25, zB + 0.4, zB + 1.3, 'polished'));
    const g2 = B.slab(circ(Ri - 2.0, 96), [], zB + 0.6, zB + 1.0, 'glass', 0.1); g2.userData.noShadow = true;
    B.add(back, g2);
  } else {
    backLid = new THREE.Group(); backLid.position.set(-Ro, 0, zB + 0.4);
    const lid = lathe(B, [[0.01, 2.2], [Ro * 0.6, 1.8], [Ro - 0.3, 0.7], [Ro - 0.25, 0], [0.01, 0]], 'polished');
    lid.geometry.translate(Ro, 0, 0);
    B.add(back, lid); backLid.add(lid); back.root.add(backLid);
    const knuckle = B.cyl(0.7, -2.8, 2.8, 'polished', 12); knuckle.rotation.x = Math.PI / 2; knuckle.position.set(-Ro, 0, zB + 0.4);
    B.add(back, knuckle);
  }
  if (c.style === 'hunter') {
    const hp = B.part('lid', 'caseFront', [0, 0], { label: 'Hunter lid', labelAt: [Ro, Ro * 0.6], labelZ: zF - 3 });
    frontLid = new THREE.Group(); frontLid.position.set(Ro, 0, zF - 1.6);
    const lid = lathe(B, [[0.01, -3.0], [Ro * 0.6, -2.6], [Ro - 0.3, -1.0], [Ro - 0.25, 0], [0.01, 0]], 'polished');
    lid.geometry.translate(-Ro, 0, 0);
    B.add(hp, lid); frontLid.add(lid); hp.root.add(frontLid);
  }
  const m = METALS[c.metal];
  const PARTS = {
    case: { name: 'Case band', group: 'Case', role: 'The middle of the case: a turned ring that holds the movement, with the bezel at the front and the back at the rear.', specs: [['Metal', c.metal], ['Diameter', `${(Ro * 2).toFixed(1)} mm`], ['Style', c.style]] },
    pendant: { name: spec.movement.calibre === 'verge' ? 'Pendant and bow' : 'Pendant, crown and bow', group: 'Case', role: spec.movement.calibre === 'verge' ? 'The bow takes the chain. A verge of this age winds with a key through the case, so there is no crown.' : 'The pendant carries the winding stem; the crown winds and sets the watch; the bow takes the chain.', specs: [['Bow', c.bow], ['Metal', c.metal]] },
    bezel: { name: 'Bezel and crystal', group: 'Case', role: 'The bezel snaps on and holds the crystal over the dial.', specs: [['Bezel', c.bezel], ['Crystal', `${c.crystal} glass`]] },
    caseback: { name: c.back === 'display' ? 'Display back' : 'Hinged back', group: 'Case', role: c.back === 'display' ? 'A glass back, so the movement can be seen at work.' : 'A hinged lid over the movement; the watchmaker opens it to regulate the watch.', specs: [['Type', c.back]] },
    lid: { name: 'Hunter lid', group: 'Case', role: 'A sprung cover that protects the crystal. A press on the crown opens it.', specs: [['Hinge', 'at 9 o\'clock']] },
  };
  PARTS.crystal = PARTS.bezel;
  return {
    PARTS, palette: { polished: { color: m.color, roughness: m.roughness } },
    toggles: ['case', 'pendant', 'bezel', 'crystal', 'caseback', 'lid'],
    pose(p, S, dt) {
      if (frontLid) { S.lidA += ((S.lidOpen ? 1.95 : 0) - S.lidA) * Math.min(1, dt * 4); frontLid.rotation.y = -S.lidA; }
      if (backLid) { S.backA += ((S.backOpen ? 1.9 : 0) - S.backA) * Math.min(1, dt * 4); backLid.rotation.y = S.backA; }
    },
    has: { lid: !!frontLid, back: !!backLid },
  };
}

// ── wristwatch ──────────────────────────────────────────────────────────────
function caseOutline(shape, Ro) {
  const out = [], n = 160;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, c = Math.cos(a), s = Math.sin(a);
    if (shape === 'cushion') { const k = 4, r = Ro / Math.pow(Math.pow(Math.abs(c), k) + Math.pow(Math.abs(s), k), 1 / k) * 0.94; out.push([c * r, s * r]); }
    else if (shape === 'square') { const k = 7, r = Ro / Math.pow(Math.pow(Math.abs(c), k) + Math.pow(Math.abs(s), k), 1 / k) * 0.93; out.push([c * r, s * r]); }
    else if (shape === 'tonneau') { const k = 3.2, rx = Ro * 0.95, ry = Ro * 1.16, r = 1 / Math.pow(Math.pow(Math.abs(c) / rx, k) + Math.pow(Math.abs(s) / ry, k), 1 / k); out.push([c * r * (1 - 0.06 * s * s), s * r]); }
    else out.push([c * Ro, s * Ro]);
  }
  return out;
}
function wristCase(B, spec, cal, dims, zF, zB) {
  const c = spec.case, calId = spec.movement.calibre, Ri = DIAL_R[calId] + 0.4, Ro = Ri + 3.0, zM = (zF + zB) / 2;
  B.layer('caseFront', -3.0); B.layer('caseMid', 0); B.layer('caseBack', 4.0); B.layer('strap', 0);
  const out = caseOutline(c.shape, Ro), yTop = Math.max(...out.map(p => p[1]));
  const band = B.part('case', 'caseMid', [0, 0], { label: 'Case', labelAt: [-Ro - 2, -Ro * 0.5], labelZ: zM });
  B.add(band, B.slab(out, [hole(Ri, 128)], zF - 0.4, zB, 'polished', 0.7));
  // lugs and spring bars
  const W = Math.min(24, Math.max(16, Ri * 1.05)), lx = W / 2 + 1.1;
  for (const sy of [1, -1]) for (const sx of [1, -1]) {
    B.add(band, B.slab(G.capsule([sx * lx, sy * (yTop - 2.5)], [sx * lx, sy * (yTop + 4.6)], 2.4), [], zF + 0.4, zB - 1.4, 'polished', 0.45));
  }
  // bezel (a ring on the case outline) and crystal
  const bz = B.part('bezel', 'caseFront', [0, 0], { label: c.bezel === 'diver' ? 'Diver\'s bezel' : 'Bezel', labelAt: [Ro * 0.75, Ro * 0.75], labelZ: zF - 1 });
  const bOut = c.shape === 'round' ? bezelOutline(c.bezel === 'diver' ? 'coin' : c.bezel, Ro - 0.2) : caseOutline(c.shape, Ro - 0.3);
  B.add(bz, B.slab(bOut, [hole(Ri - 0.6, 128)], zF - 1.6, zF - 0.3, 'polished', 0.3));
  if (c.bezel === 'diver') {
    B.add(bz, B.ring(Ri - 0.6, Ro - 1.3, zF - 1.75, zF - 1.55, 'black'));
    for (let i = 0; i < 60; i += 5) {
      const a = Math.PI / 2 - i / 60 * TAU, p0 = pol(Ri + 0.2, a), p1 = pol(Ro - 1.6, a);
      if (i === 0) { B.add(bz, B.slab([pol(Ri + 0.1, a - 0.05), pol(Ri + 0.1, a + 0.05), pol(Ro - 1.5, a)].reverse(), [], zF - 1.85, zF - 1.7, 'lume', 0)); continue; }
      B.add(bz, B.slab(G.capsule(p0, p1, i % 15 ? 0.25 : 0.45), [], zF - 1.85, zF - 1.7, 'polished', 0));
    }
  }
  const cry = B.part('crystal', 'caseFront', [0, 0], {});
  const glass = B.slab(circ(Ri - 0.5, 96), [], zF - 1.9, zF - 1.4, 'glass', 0.15); glass.userData.noShadow = true;
  B.add(cry, glass);
  // crown at 3 o'clock (-x)
  const cr = B.part('crown', 'caseMid', [0, 0], { label: 'Crown', labelAt: [-Ro - 6, 0], labelZ: zM });
  const xr = -Math.max(...out.map(p => -p[0])) ;
  const stemG = B.cyl(0.6, 0, 2.0, 'polished', 12); stemG.geometry.rotateY(-Math.PI / 2); stemG.geometry.translate(xr + 0.2, 0, zM);
  let knob;
  if (c.crown === 'onion') {
    knob = lathe(B, [[0.01, 0], [2.0, 0.2], [2.6, 1.2], [2.2, 2.4], [0.8, 3.0], [0.01, 3.0]], 'polished', 40);
    knob.geometry.rotateY(-Math.PI / 2); knob.geometry.translate(xr - 1.6, 0, zM);
  } else {
    knob = B.slab(G.gearProfile(24, 0.2, { t: 0.5, ha: 0.5, hf: 0.5, seg: 3 }), [], 0, 2.4, 'polished', 0.2);
    knob.geometry.rotateY(-Math.PI / 2); knob.geometry.translate(xr - 1.6, 0, zM);
  }
  B.add(cr, stemG, knob);
  // display back
  const back = B.part('caseback', 'caseBack', [0, 0], { label: 'Caseback', labelAt: [-Ro * 0.7, -Ro * 0.7], labelZ: zB + 1 });
  B.add(back, B.ring(Ri - 2.0, Ro - 0.8, zB, zB + 1.0, 'polished'));
  const g2 = B.slab(circ(Ri - 1.8, 96), [], zB + 0.2, zB + 0.6, 'glass', 0.1); g2.userData.noShadow = true;
  B.add(back, g2);
  // straps: from the lugs up and round the wrist (+z)
  const strap = B.part('strap', 'strap', [0, 0], { label: c.strap === 'leather' ? 'Strap' : c.strap === 'bracelet' ? 'Bracelet' : 'Mesh strap', labelAt: [0, yTop + 18], labelZ: zM + 8 });
  const Rw = 25, zc = zM + 0.4;
  for (const sy of [1, -1]) {
    const pts = [new THREE.Vector3(0, sy * (yTop + 1.5), zc)];
    for (let i = 0; i <= 16; i++) { const ph = i / 16 * 1.75; pts.push(new THREE.Vector3(0, sy * (yTop + 4.6 + Rw * Math.sin(ph)), zc + Rw - Rw * Math.cos(ph))); }
    const curve = new THREE.CatmullRomCurve3(pts);
    if (c.strap === 'bracelet') {
      const n = Math.floor(curve.getLength() / 4.2);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
        const box = new THREE.BoxGeometry(W - (i % 2) * 0.2, 3.9, 2.4);
        const m = B.mesh(box, i % 2 ? 'satin' : 'polished');
        m.position.copy(p); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tg);
        B.add(strap, m);
      }
    } else {
      const th = c.strap === 'mesh' ? 1.6 : 3.0, w = W - 0.4, sh = new THREE.Shape();
      const r = Math.min(th / 2 - 0.05, 0.9);
      sh.moveTo(-th / 2 + r, -w / 2); sh.lineTo(th / 2 - r, -w / 2); sh.quadraticCurveTo(th / 2, -w / 2, th / 2, -w / 2 + r); sh.lineTo(th / 2, w / 2 - r);
      sh.quadraticCurveTo(th / 2, w / 2, th / 2 - r, w / 2); sh.lineTo(-th / 2 + r, w / 2); sh.quadraticCurveTo(-th / 2, w / 2, -th / 2, w / 2 - r); sh.lineTo(-th / 2, -w / 2 + r); sh.quadraticCurveTo(-th / 2, -w / 2, -th / 2 + r, -w / 2);
      const g = new THREE.ExtrudeGeometry(sh, { steps: 60, bevelEnabled: false, extrudePath: curve });
      B.add(strap, B.mesh(g, c.strap === 'leather' ? 'leather' : 'satin'));
    }
    if (sy === 1 && c.strap === 'leather') {          // the buckle at the end of the top strap
      const p = curve.getPointAt(1), tg = curve.getTangentAt(1);
      const bk = new THREE.TorusGeometry(W * 0.36, 0.55, 8, 40); bk.scale(1.15, 0.6, 1);
      const m = B.mesh(bk, 'polished'); m.position.copy(p); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg);
      B.add(strap, m);
    }
  }
  const m = METALS[c.metal];
  const PARTS = {
    case: { name: 'Case', group: 'Case', role: 'The middle of the case with its four lugs, which hold the strap on spring bars.', specs: [['Metal', c.metal], ['Shape', c.shape], ['Size', `${(Ro * 2).toFixed(1)} mm`], ['Lug width', `${W.toFixed(0)} mm`]] },
    bezel: { name: c.bezel === 'diver' ? 'Diver\'s bezel' : 'Bezel', group: 'Case', role: c.bezel === 'diver' ? 'A one-way rotating ring: a diver sets the triangle at the minute hand to time a dive.' : 'The ring that holds the crystal over the dial.', specs: [['Style', c.bezel], ['Crystal', 'flat sapphire']] },
    crown: { name: 'Crown', group: 'Case', role: 'At 3 o\'clock. It winds the mainspring by hand and, pulled out, sets the hands.', specs: [['Style', c.crown]] },
    caseback: { name: 'Display back', group: 'Case', role: 'A sapphire window over the movement and its rotor.', specs: [] },
    strap: c.strap === 'leather' ? { name: 'Leather strap', group: 'Strap', role: 'Two straps on spring bars between the lugs, with a pin buckle.', specs: [['Leather', c.leather], ['Width', `${W.toFixed(0)} mm`]] }
      : { name: c.strap === 'bracelet' ? 'Bracelet' : 'Mesh strap', group: 'Strap', role: c.strap === 'bracelet' ? 'Solid links in alternating polished and brushed metal.' : 'A woven metal mesh, soft and light on the wrist.', specs: [['Metal', c.metal], ['Width', `${W.toFixed(0)} mm`]] },
  };
  PARTS.crystal = PARTS.bezel;
  return {
    PARTS, palette: { polished: { color: m.color, roughness: m.roughness }, satin: { color: m.color, roughness: 0.32 }, leather: { color: LEATHERS[c.leather] } },
    toggles: ['case', 'bezel', 'crystal', 'crown', 'caseback', 'strap'], pose() {}, has: {},
  };
}

// ── wall clock ──────────────────────────────────────────────────────────────
function wallCase(B, spec, cal, dims, zF, zB) {
  const c = spec.case, Rc = c.diameter / 2, Rd = dims.dialR, unit = 9;
  const k = v => v * Rc / unit;                 // explode offsets in case sizes
  B.layer('caseFront', -k(0.32)); B.layer('caseMid', 0); B.layer('caseBack', k(0.28));
  const zLip = zF - Rc * 0.1, zRear = zB + Rc * 0.18;
  const rimMat = c.style === 'schoolhouse' ? 'wood' : c.style === 'kitchen' ? 'paint' : c.style === 'station' ? 'black' : 'polished';
  const band = B.part('case', 'caseMid', [0, 0], { label: 'Case', labelAt: [-Rc, 0], labelZ: (zLip + zRear) / 2 });
  const prof = c.style === 'schoolhouse' ? [[Rd + 1, zF + 2], [Rd + 4, zLip], [Rc - 6, zLip - 1], [Rc - 1, zLip + 6], [Rc, zRear - 8], [Rc - 3, zRear], [Rd + 2, zRear]]
    : c.style === 'station' ? [[Rd + 1, zLip + 1], [Rc - 1, zLip], [Rc, zLip + 2], [Rc, zRear - 2], [Rc - 2, zRear], [Rd + 2, zRear]]
    : c.style === 'porthole' ? [[Rd + 1, zF], [Rd + 3, zLip], [Rc - 3, zLip], [Rc, zLip + 4], [Rc, zRear - 4], [Rc - 3, zRear], [Rd + 2, zRear]]
    : [[Rd + 1, zF], [Rd + 3, zLip + 1], [Rc - 2, zLip + 2], [Rc, zLip + 5], [Rc - 1, zRear - 3], [Rc - 6, zRear], [Rd + 2, zRear]];
  B.add(band, lathe(B, prof, rimMat, 160));
  if (c.style === 'porthole') for (let i = 0; i < 8; i++) {
    const at = pol((Rd + Rc) / 2, i / 8 * TAU + 0.2);
    B.add(band, B.cyl(3.2, zLip - 1.4, zLip, 'polished', 20).translateX(at[0]).translateY(at[1]));
  }
  // the large dial and its back plate
  const dial = B.part('dial', 'caseMid', [0, 0], { label: 'Dial', labelAt: [0, -Rd * 0.6], labelZ: zF });
  const dh = [hole(2.6, 24)];
  B.add(dial, B.slab(circ(Rd + 0.5, 180), dh, zF + 0.4, zF + 1.6, 'brass', 0.3), B.dialFace(Rd, zF, dh, dims.paint));
  // bezel ring and crystal
  const bz = B.part('bezel', 'caseFront', [0, 0], { label: 'Bezel and glass', labelAt: [Rd * 0.75, Rd * 0.75], labelZ: zLip });
  B.add(bz, lathe(B, [[Rd - 1, zLip - 1.5], [Rd + 3, zLip - 3], [Rd + 7, zLip - 1.5], [Rd + 7, zLip + 0.5], [Rd - 1, zLip + 0.5]], c.style === 'station' ? 'black' : 'polished', 128));
  const cry = B.part('crystal', 'caseFront', [0, 0], {});
  const glass = cap(B, Rd, Rd * 0.07, zLip - 1.0, 'glass'); glass.userData.noShadow = true;
  B.add(cry, glass);
  // the back: a plate with a window to the movement, and a hanger
  const back = B.part('caseback', 'caseBack', [0, 0], { label: 'Back and hanger', labelAt: [0, Rc * 0.9], labelZ: zRear });
  B.add(back, B.slab(circ(Rc - 3, 160), [hole(cal.plateR + 8, 96)], zRear, zRear + 2.5, rimMat === 'wood' ? 'wood' : 'black', 0.4));
  const hanger = new THREE.TorusGeometry(6, 1.1, 10, 32); hanger.translate(0, Rc * 0.82, zRear + 3.5);
  B.add(back, B.mesh(hanger, 'polished'));
  const m = METALS[c.metal];
  const PARTS = {
    case: { name: c.style === 'schoolhouse' ? 'Schoolhouse case' : c.style === 'station' ? 'Station clock case' : c.style === 'porthole' ? 'Porthole case' : 'Kitchen clock case', group: 'Case',
      role: c.style === 'schoolhouse' ? 'A turned wooden surround, as on the clocks of classrooms and railway offices.' : c.style === 'station' ? 'A heavy black ring, made to be read from across a platform.' : c.style === 'porthole' ? 'A ship\'s bulkhead case: a thick brass ring bolted round the glass.' : 'A painted surround with a soft, rounded profile.',
      specs: [['Diameter', `${c.diameter} mm`], ['Material', c.style === 'schoolhouse' ? `${c.wood} wood` : c.style === 'kitchen' ? `${c.paint} enamel paint` : c.style === 'station' ? 'black lacquer' : c.metal]] },
    dial: { name: 'Dial', group: 'Display', role: 'A large dial on a brass plate. The movement is small and sits behind it; its centre arbor carries the long hands.', specs: [['Diameter', `${(Rd * 2).toFixed(0)} mm`], ['Base', spec.face.base.replace('-', ' ')], ['Numerals', spec.face.numerals]] },
    bezel: { name: 'Bezel and glass', group: 'Case', role: 'A ring that clamps the domed glass over the dial; it hinges open to set the hands.', specs: [['Glass', 'domed']] },
    caseback: { name: 'Back and hanger', group: 'Case', role: 'The back plate, with a window here to show the movement, and the ring the clock hangs from.', specs: [] },
  };
  PARTS.crystal = PARTS.bezel;
  return {
    PARTS, palette: { polished: { color: m.color, roughness: m.roughness }, wood: { color: WOODS[c.wood] }, paint: { color: PAINTS[c.paint] } },
    toggles: ['case', 'bezel', 'crystal', 'caseback', 'dial'], pose() {}, has: {},
  };
}

// ── twin-bell alarm clock ───────────────────────────────────────────────────
function alarmCase(B, spec, cal, dims, zF, zB) {
  const c = spec.case, Rb = c.diameter / 2, Rd = dims.dialR, unit = 9;
  const k = v => v * Rb / unit;
  B.layer('caseFront', -k(0.42)); B.layer('caseMid', 0); B.layer('caseBack', k(0.4)); B.layer('bells', k(0.12));
  const zLip = zF - 5, zRear = zB + 6, zM = (zLip + zRear) / 2;
  const bodyMat = c.body === 'painted' ? 'paint' : 'polished';
  const body = B.part('case', 'caseMid', [0, 0], { label: 'Drum case', labelAt: [-Rb, -Rb * 0.3], labelZ: zM });
  B.add(body, lathe(B, [[Rd + 1, zF + 1], [Rb - 2.5, zLip + 1], [Rb, zLip + 3.5], [Rb, zRear - 3.5], [Rb - 2.5, zRear], [Rd - 4, zRear]], bodyMat, 128));
  const dial = B.part('dial', 'caseMid', [0, 0], { label: 'Dial', labelAt: [0, -Rd * 0.6], labelZ: zF });
  const dh = [hole(1.6, 24)];
  B.add(dial, B.slab(circ(Rd + 0.5, 160), dh, zF + 0.25, zF + 1.0, 'brass', 0.2), B.dialFace(Rd, zF, dh, dims.paint));
  // alarm hand: thin, with an arrow, set to the alarm time on the hour scale
  const ah = B.part('alarmHand', 'caseMid', [0, 0], { label: 'Alarm hand', labelAt: [0, Rd * 0.45], labelZ: zF - 0.3 });
  const L = Rd * 0.62, w = Rd * 0.012;
  B.add(ah, B.slab([[-w, -L * 0.12], [w, -L * 0.12], [w, L * 0.82], [w * 3.2, L * 0.82], [0, L], [-w * 3.2, L * 0.82], [-w, L * 0.82]], [], zF - 0.2, zF - 0.12, 'paint', 0));
  ah.root.rotation.z = (c.alarmAt / 720) * TAU;
  // bezel and domed glass
  const bz = B.part('bezel', 'caseFront', [0, 0], { label: 'Bezel and glass', labelAt: [Rd * 0.7, -Rd * 0.7], labelZ: zLip });
  B.add(bz, lathe(B, [[Rd - 0.5, zLip - 0.5], [Rd + 1.5, zLip - 2.4], [Rb - 0.5, zLip - 1.0], [Rb - 0.5, zLip + 1.2], [Rd - 0.5, zLip + 1.2]], 'steel', 128));
  const cry = B.part('crystal', 'caseFront', [0, 0], {});
  const glass = cap(B, Rd + 0.5, Rd * 0.16, zLip - 0.4, 'glass'); glass.userData.noShadow = true;
  B.add(cry, glass);
  // the bells, their posts, the hammer and the handle
  const bellMat = c.bells === 'brass' ? 'brass' : 'steel';
  const bells = B.part('bells', 'bells', [0, 0], { label: 'Bells', labelAt: [Rb * 0.9, Rb * 1.25], labelZ: zM });
  const rB = Rb * 0.42, bellAt = a => pol(Rb + rB * 0.55, Math.PI / 2 + a);
  const shell = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24, a = t * Math.PI / 2; shell.push([Math.max(0.01, rB * Math.sin(a)), rB * Math.cos(a)]); }
  for (let i = 24; i >= 0; i--) { const t = i / 24, a = t * Math.PI / 2; shell.push([Math.max(0.01, (rB - 1.2) * Math.sin(a)), (rB - 1.2) * Math.cos(a) - 0.3]); }
  const bellG = [];
  for (const sg of [1, -1]) {
    const at = bellAt(sg * 0.62), g = new THREE.Group();
    g.position.set(at[0], at[1], zM); g.rotation.z = Math.atan2(at[1], at[0]) - Math.PI / 2;
    const b = new THREE.LatheGeometry(shell.map(([r, y]) => new THREE.Vector2(r, y)), 64);
    const mesh = B.mesh(b, bellMat); B.add(bells, mesh); g.add(mesh);
    const post = B.cyl(1.0, 0, rB * 0.9, 'steel', 12); post.geometry.rotateX(-Math.PI / 2); post.geometry.translate(0, -rB * 0.9, 0);
    B.add(bells, post); g.add(post);
    bells.root.add(g); bellG.push(g);
  }
  const hm = B.part('hammer', 'bells', [0, 0], { label: 'Hammer', labelAt: [0, Rb + rB * 1.3], labelZ: zM });
  const hammer = new THREE.Group(); hammer.position.set(0, Rb - 4, zM); hm.root.add(hammer);
  const rod = B.cyl(0.7, 0, rB * 1.35 + 4, 'steel', 12); rod.geometry.rotateX(-Math.PI / 2);
  const head = B.mesh(new THREE.SphereGeometry(2.6, 20, 14), 'steel'); head.position.set(0, rB * 1.35 + 4, 0);
  B.add(hm, rod, head); hammer.add(rod, head);
  const handle = new THREE.TorusGeometry(Rb * 0.95, 1.7, 12, 64, Math.PI * 0.62); handle.rotateZ(Math.PI * 0.19); handle.translate(0, Rb * 0.32, zRear - 3);
  B.add(bells, B.mesh(handle, bellMat));
  // feet
  const feet = B.part('feet', 'caseMid', [0, 0], { label: 'Feet', labelAt: [Rb * 0.9, -Rb * 1.15], labelZ: zM });
  for (const sg of [1, -1]) {
    const a = -Math.PI / 2 + sg * 0.62, at = pol(Rb + 2, a);
    if (c.feet === 'ball') B.add(feet, B.mesh(new THREE.SphereGeometry(5, 20, 14), bellMat).translateX(at[0]).translateY(at[1]).translateZ(zM));
    else B.add(feet, B.slab(G.capsule(pol(Rb - 2, a), pol(Rb + 9, a + sg * 0.18), 3.4), [], zM - 6, zM + 6, bellMat, 0.6));
  }
  // the back with two winding keys (time and alarm)
  const back = B.part('caseback', 'caseBack', [0, 0], { label: 'Back and keys', labelAt: [-Rb * 0.6, Rb * 0.5], labelZ: zRear + 4 });
  B.add(back, B.slab(circ(Rb - 2.6, 128), [], zRear - 0.2, zRear + 1.2, bodyMat === 'paint' ? 'paint' : 'polished', 0.4));
  const keys = [];
  for (const sx of [1, -1]) {
    const kg = new THREE.Group(); kg.position.set(sx * Rb * 0.38, -Rb * 0.18, zRear + 1.2); back.root.add(kg);
    const st = B.cyl(1.1, 0, 5, 'brass', 12);
    const wing = B.slab([[-5.5, -1.2], [-1, -1.2], [-0.6, -0.3], [0.6, -0.3], [1, -1.2], [5.5, -1.2], [5.8, 1.2], [-5.8, 1.2]], [], -0.5, 0.5, 'brass', 0.2);
    wing.geometry.rotateX(Math.PI / 2); wing.geometry.translate(0, 0, 6.5);
    B.add(back, st, wing); kg.add(st, wing); keys.push(kg);
  }
  const PARTS = {
    case: { name: 'Drum case', group: 'Case', role: 'A pressed drum that holds a small lever movement, the alarm train and two mainsprings.', specs: [['Diameter', `${c.diameter} mm`], ['Finish', c.body === 'painted' ? `${c.paint} enamel paint` : c.body]] },
    dial: { name: 'Dial', group: 'Display', role: 'Bold numerals, read across a dark bedroom.', specs: [['Diameter', `${(Rd * 2).toFixed(0)} mm`], ['Numerals', spec.face.numerals]] },
    alarmHand: { name: 'Alarm hand', group: 'Alarm', role: 'Set with the small knob on the back. When the hour hand reaches it, the alarm train is released and the hammer beats the bells.', specs: [['Set for', `${Math.floor(c.alarmAt / 60) || 12}:${String(c.alarmAt % 60).padStart(2, '0')}`]] },
    bezel: { name: 'Bezel and glass', group: 'Case', role: 'A chrome ring holding a deep domed glass.', specs: [] },
    bells: { name: 'Twin bells', group: 'Alarm', role: 'Two steel cups. The hammer swings between them about fifteen times a second.', specs: [['Metal', c.bells]] },
    hammer: { name: 'Hammer', group: 'Alarm', role: 'Driven by a small escapement of its own in the alarm train; it strikes each bell in turn.', specs: [['Rate', 'about 15 strikes a second']] },
    feet: { name: 'Feet', group: 'Case', role: 'They lift the clock off the nightstand so the bells ring clear.', specs: [['Style', c.feet]] },
    caseback: { name: 'Back and keys', group: 'Case', role: 'Two winding keys: one for the time, one for the alarm. The time key turns as you wind.', specs: [] },
  };
  PARTS.crystal = PARTS.bezel;
  return {
    PARTS, palette: { paint: { color: PAINTS[c.paint] }, polished: { color: c.body === 'brass' ? METALS.brass.color : '#e9ebf0', roughness: 0.1 } },
    toggles: ['case', 'bezel', 'crystal', 'caseback', 'dial', 'alarmHand', 'bells', 'hammer', 'feet'],
    pose(p, S, dt, now) {
      const ringing = S.ringing;
      hammer.rotation.z = ringing ? 0.32 * Math.sin(now / 1000 * TAU * 7.5) : hammer.rotation.z * 0.9;
      const j = ringing ? 0.012 : 0;
      bellG.forEach((g, i) => { g.scale.setScalar(1 + j * Math.sin(now / 9 + i)); });
      keys[0].rotation.z = -(p.ratchet || 0);
    },
    has: { ring: true },
  };
}
