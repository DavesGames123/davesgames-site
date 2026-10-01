// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/pocket.js — pocket watch cases
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

// ── pocket watch ────────────────────────────────────────────────────────────
export function build(B, spec, cal, dims, zF, zB) {
  const c = spec.case, Ri = dialRadius(cal) + 0.35, Ro = Ri + 2.4, zM = (zF + zB) / 2;
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

