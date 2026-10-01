// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/alarm.js — twin-bell alarm clock cases
// ────────────────────────────────────────────────────────────────────────────
//  build(B, spec, cal, dims, zF, zB) adds the case parts to the movement's
//  builder and returns { PARTS, toggles, pose(p, S, dt, now), has }. zF is
//  the dial face plane, zB the back of the movement (movement frame: mm, y
//  to 12, z out of the back, the dial faces -z; seen from the dial +x is 9).
// ============================================================================
import * as THREE from 'three';
import * as G from '../../watch-movement/geom.js';
import { circ, hole } from '../../watch-movement/kit.js';
import { lathe, cap, bezelOutline, dialRadius } from './common.js';
import { METALS, PAINTS, WOODS, LEATHERS } from '../palettes.js';
const { TAU, D, pol } = G;

// ── twin-bell alarm clock ───────────────────────────────────────────────────
export function build(B, spec, cal, dims, zF, zB) {
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
