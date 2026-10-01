// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/wrist.js — wristwatch cases and straps
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
export function build(B, spec, cal, dims, zF, zB) {
  const c = spec.case, calId = spec.movement.calibre, Ri = dialRadius(cal) + 0.4, Ro = Ri + 3.0, zM = (zF + zB) / 2;
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

