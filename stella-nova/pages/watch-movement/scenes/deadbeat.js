// ============================================================================
//  WATCH MOVEMENT  ·  scenes/deadbeat.js — the deadbeat regulator in 3D
// ────────────────────────────────────────────────────────────────────────────
//  build(B, cal, opts) adds the parts of calibres/deadbeat.js and returns
//  pose(). opts: noDial, dialPaint, hands (styles and material; this scene
//  keeps its own regulator hand lengths and places), hide.
//
//  The movement sits between two brass plates on four pillars. Behind the
//  back plate: the crutch on the pallet arbor, the suspension cock, and the
//  seconds pendulum, which hangs about a metre down. Beside it hangs the
//  driving weight, at a height set by the reserve.
//
//  LAYERS  (explode offset = spread * unit * k)
//    hands -2.4 · dial -1.8 · motion -1.0 · front plate and pillars 0
//    train 1 · escape wheel and pallets 1.6 · back plate 2.4
//    crutch, suspension and pendulum 3.0 · weight 1
// ============================================================================
import * as THREE from 'three';
import * as G from '../geom.js';
import { circ, hole } from '../kit.js';
import { wheelArbor } from './shared.js';
const { TAU, D, pol, add, sub } = G;
const local = (q, o) => [q[0] - o[0], q[1] - o[1]];

// the full Graham wheel outline from the calibre's tooth
function escapeOutline(cal) {
  const { N, Ra, Rf } = cal.CAL.escape, p = TAU / N, tooth = cal.escapeTooth().slice(1), out = [];
  for (let k = 0; k < N; k++) {
    for (const q of tooth) out.push(G.rot(q, k * p));
    for (let j = 1; j <= 3; j++) out.push(pol(Rf, k * p - 0.09 * p + 0.54 * p * j / 4));
  }
  return out;
}

// a regulator dial: minutes round the edge, seconds at 12, hours at 6
function paintRegulator(cal) {
  const E = cal.L.E, H = cal.L.H;
  return (g, R) => {
    const bg = g.createRadialGradient(-R * 0.2, -R * 0.3, 1, 0, 0, R);
    bg.addColorStop(0, '#f2f2ee'); bg.addColorStop(1, '#d5d6d2');
    g.fillStyle = bg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
    const ink = '#1c1d22', SERIF = '"STIX Two Text","Times New Roman",Georgia,serif';
    g.strokeStyle = ink; g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    // minute ring
    g.lineWidth = R * 0.003;
    for (const r of [R * 0.86, R * 0.93]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * TAU, ca = Math.sin(a), sa = -Math.cos(a), r0 = i % 5 ? R * 0.89 : R * 0.86;
      g.lineWidth = R * (i % 5 ? 0.0035 : 0.007);
      g.beginPath(); g.moveTo(ca * r0, sa * r0); g.lineTo(ca * R * 0.93, sa * R * 0.93); g.stroke();
    }
    g.font = `${R * 0.055}px ${SERIF}`;
    for (let i = 1; i <= 12; i++) { const a = i / 12 * TAU; g.fillText(String(i * 5), Math.sin(a) * R * 0.965, -Math.cos(a) * R * 0.965); }
    // seconds ring at 12 (canvas y is down: the movement's +y is up)
    const ring = (cx, cy, r, n, labels, roman) => {
      g.lineWidth = R * 0.0025;
      for (const rr of [r, r * 0.84]) { g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.stroke(); }
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU, ca = Math.sin(a), sa = -Math.cos(a), big = labels && i % (n / labels.length) === 0;
        g.lineWidth = R * (big ? 0.005 : 0.0025);
        g.beginPath(); g.moveTo(cx + ca * r * (big ? 0.78 : 0.84), cy + sa * r * (big ? 0.78 : 0.84)); g.lineTo(cx + ca * r, cy + sa * r); g.stroke();
      }
      g.font = `${roman ? '500 ' : ''}${R * (roman ? 0.042 : 0.036)}px ${SERIF}`;
      labels.forEach((t, i) => { const a = i / labels.length * TAU; g.fillText(t, cx + Math.sin(a) * r * 0.62, cy - Math.cos(a) * r * 0.62); });
    };
    ring(E[0], -E[1], 30, 60, ['60', '10', '20', '30', '40', '50'], false);
    ring(H[0], -H[1], 30, 12, ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'], true);
    g.font = `italic ${R * 0.05}px ${SERIF}`; g.fillText('Stella Nova', -R * 0.42, 0);
    g.font = `${R * 0.03}px ${SERIF}`; g.fillText('REGULATOR', R * 0.42, 0);
  };
}

export function build(B, cal, opts = {}) {
  const { CAL: c, L, ESC } = cal, Z = c.z;
  for (const [k, v] of Object.entries({ hands: -2.4, dial: -1.8, motion: -1.0, plate: 0, train: 1, esc: 1.6, back: 2.4, pend: 3.0, weight: 1 })) B.layer(k, v);

  // PLATES and PILLARS
  const corners = [[-72, -94], [72, -94], [72, 118], [-72, 118]];
  const plateOut = G.hullOfCircles(corners.map(q => [q, 10]), 24);
  const front = B.part('plate', 'plate', [0, 0], { label: 'Front plate', labelAt: [-80, -60], labelZ: 0 });
  B.add(front, B.slab(plateOut, [hole(2, 16, L.C), hole(2, 16, L.E), hole(2, 16, L.G)], Z.frontLo, Z.frontHi, 'brass', 0.4));
  const pil = B.part('pillars', 'plate', [0, 0], { label: 'Pillars', labelAt: [70, -92], labelZ: 20 });
  const prof = [[0.01, 0], [4.2, 0], [4.2, 1.5], [3.0, 3], [2.6, 12], [3.8, 20], [2.6, 28], [3.0, 37], [4.2, 38.5], [4.2, 40], [0.01, 40]].map(([r, z]) => new THREE.Vector2(r, z));
  for (const q of [[-70, -92], [70, -92], [70, 116], [-70, 116]]) {
    const g = new THREE.LatheGeometry(prof, 40); g.rotateX(Math.PI / 2); g.translate(q[0], q[1], 0);
    B.add(pil, B.mesh(g, 'brass'));
  }
  const back = B.part('backPlate', 'back', [0, 0], { label: 'Back plate', labelAt: [80, 60], labelZ: Z.backHi });
  B.add(back, B.slab(plateOut, [hole(2, 16, L.P), hole(2, 16, L.T)], Z.backLo, Z.backHi, 'brass', 0.4));

  // GREAT WHEEL, grooved cord barrel, winding square
  const gw = B.part('barrel', 'train', L.G, { label: 'Great wheel and barrel', labelZ: Z.barrelHi + 2 });
  B.add(gw, B.slab(G.wheelProfile(144, 0.7), G.spokeWindows(8, G.rootR(144, 0.7) - 3, 6, 3.2).map(h => h.reverse()), Z.great - 1.0, Z.great + 1.0, 'gilt', 0.08));
  const bp = [[3, Z.barrelLo - 0.6], [27.5, Z.barrelLo - 0.6], [27.5, Z.barrelLo]];
  for (let i = 0; i <= 64; i++) { const z = Z.barrelLo + (Z.barrelHi - Z.barrelLo) * i / 64; bp.push([26 - 0.35 * (0.5 + 0.5 * Math.cos(i / 64 * TAU * 8)), z]); }
  bp.push([27.5, Z.barrelHi], [27.5, Z.barrelHi + 0.6], [3, Z.barrelHi + 0.6]);
  const bg = new THREE.LatheGeometry(bp.map(([r, z]) => new THREE.Vector2(r, z)), 96); bg.rotateX(Math.PI / 2);
  B.add(gw, B.mesh(bg, 'brass'), B.cyl(2.2, -10, Z.backHi + 1, 'steel', 20));
  B.add(gw, B.slab([[-2.6, -2.6], [2.6, -2.6], [2.6, 2.6], [-2.6, 2.6]], [], Z.dialLo - 2, -10, 'steel', 0.2));

  // the weight hangs from the barrel on its line; it falls as the clock runs
  const wt = B.part('weight', 'weight', [L.G[0] - 26, L.G[1]], { label: 'Weight', labelAt: [L.G[0] - 26, -330], labelZ: (Z.barrelLo + Z.barrelHi) / 2 });
  const weightG = new THREE.Group(); wt.root.add(weightG);
  const zl = (Z.barrelLo + Z.barrelHi) / 2;
  const wBody = new THREE.CylinderGeometry(26, 26, 170, 64); wBody.translate(0, -85, zl);
  const wCap = new THREE.CylinderGeometry(27, 27, 6, 64); wCap.translate(0, 0, zl);
  const wHook = new THREE.TorusGeometry(5, 1.2, 12, 32); wHook.translate(0, 8, zl);
  const wMeshes = [B.mesh(wBody, 'brass'), B.mesh(wCap, 'polished'), B.mesh(wHook, 'steel')];
  for (const m of wMeshes) { B.add(wt, m); weightG.add(m); }
  const lineG = new THREE.CylinderGeometry(0.45, 0.45, 1, 8); lineG.translate(0, -0.5, zl);
  const line = B.mesh(lineG, 'black'); B.add(wt, line);

  // GOING TRAIN
  wheelArbor(B, { id: 'center', at: L.C, label: 'Centre wheel', wheel: { N: 96, m: 0.9, z: Z.center, t: 1.6, spokes: { rIn: 5, rim: 2.2, n: 6, w: 2.6 } }, pinion: { N: 12, m: 0.7, z: Z.great, t: 2.2 }, arbor: [Z.dialLo - 2, Z.backHi + 1, 1.6] });
  wheelArbor(B, { id: 'third', at: L.T, label: 'Third wheel', wheel: { N: 80, m: 0.75, z: Z.third, t: 1.4, spokes: { rIn: 4, rim: 2, n: 6, w: 2.2 } }, pinion: { N: 8, m: 0.9, z: Z.center, t: 2.2 }, arbor: [0, Z.backHi + 1, 1.3] });

  // ESCAPE WHEEL (its arbor reaches the seconds hand at 12)
  const ew = B.part('escape', 'esc', L.E, { label: 'Escape wheel', labelZ: Z.escape + 3 });
  B.add(ew, B.slab(escapeOutline(cal), G.spokeWindows(5, c.escape.Rf - 3.2, 6, 1.6).map(h => h.reverse()), Z.escape - 0.6, Z.escape + 0.6, 'polished', 0.05),
    B.slab(G.pinionProfile(16, 0.75), [], Z.third - 1.1, Z.third + 1.1, 'steel', 0.05),
    B.cyl(3.2, Z.escape - 1.2, Z.escape + 1.2, 'steel', 32), B.cyl(1.1, Z.dialLo - 1.6, Z.backHi + 1, 'steel', 18));

  // DEADBEAT PALLETS on their arbor
  const pal = B.part('pallet', 'esc', L.P, { label: 'Deadbeat pallets', labelZ: Z.pallet + 3 });
  const pals = ESC.palletPolys(0).map(pl => pl.map(q => local(q, L.P)));
  for (const pl of pals) {
    B.add(pal, B.slab(pl, [], Z.pallet - 1.0, Z.pallet + 1.0, 'ruby', 0.06));
    const backEnd = pl[0], mid = [(pl[0][0] + pl[pl.length - 1][0]) / 2, (pl[0][1] + pl[pl.length - 1][1]) / 2];
    // a steel arm from the arbor to the back of the pallet, and a holder
    B.add(pal, B.slab(G.capsule([0, 0], mid, 4.2), [], Z.pallet - 0.8, Z.pallet + 0.8, 'steel', 0.15));
    B.add(pal, B.slab(G.capsule(mid, backEnd, 3.0), [], Z.pallet - 1.3, Z.pallet + 1.3, 'steel', 0.15));
  }
  B.add(pal, B.slab(circ(5.5, 48), [], Z.pallet - 1.2, Z.pallet + 1.2, 'steel', 0.2), B.cyl(1.4, 0, Z.crutch + 1, 'steel', 18));

  // CRUTCH (behind the back plate), SUSPENSION COCK and PENDULUM
  const cr = B.part('crutch', 'pend', L.P, { label: 'Crutch', labelAt: [L.P[0] + 8, (L.P[1] + L.forkY) / 2], labelZ: Z.crutch });
  const fy = L.forkY - L.P[1];
  B.add(cr, B.slab(G.capsule([0, 0], [0, fy + 3], 2.6), [], Z.crutch - 0.7, Z.crutch + 0.7, 'steel', 0.15), B.cyl(3.4, Z.crutch - 1.2, Z.crutch + 1.2, 'steel', 24));
  for (const sx of [-1, 1]) B.add(cr, B.slab(G.capsule([sx * 3.6, fy + 3], [sx * 3.6, fy - 5], 2.0), [], Z.crutch - 0.4, Z.pend + 3, 'steel', 0.15));
  B.add(cr, B.slab(G.capsule([-3.6, fy + 3], [3.6, fy + 3], 2.4), [], Z.crutch - 0.7, Z.pend + 3, 'steel', 0.15));
  const sus = B.part('suspension', 'pend', [0, 0], { label: 'Suspension', labelAt: [14, L.pivot[1] + 4], labelZ: Z.pend });
  B.add(sus, B.slab([[-14, 116], [14, 116], [14, 136], [-14, 136]], [], Z.backHi, Z.pend + 6, 'brass', 0.5));
  const pend = B.part('pendulum', 'pend', [L.pivot[0], L.pivot[1]], { label: 'Seconds pendulum', labelAt: [60, -560], labelZ: Z.pend });
  pend.root.position.z = 0;
  const pz = Z.pend, Lp = c.pendL;
  const spring = B.slab([[-2.2, -14], [2.2, -14], [2.2, 0], [-2.2, 0]], [], pz - 0.08, pz + 0.08, 'steel', 0);
  const chop = B.slab([[-4, -20], [4, -20], [4, -14], [-4, -14]], [], pz - 1.5, pz + 1.5, 'brass', 0.3);
  const rodG = new THREE.CylinderGeometry(2.0, 2.0, Lp - 40, 24); rodG.translate(0, -20 - (Lp - 40) / 2, pz);
  const bobG = new THREE.CylinderGeometry(c.bobR, c.bobR, 26, 96); bobG.rotateX(Math.PI / 2);
  const bobRim = new THREE.TorusGeometry(c.bobR - 1, 2.4, 16, 96);
  bobG.translate(0, -Lp, pz); bobRim.translate(0, -Lp, pz);
  const nutG = new THREE.CylinderGeometry(6, 6, 9, 40); nutG.translate(0, -Lp - c.bobR - 14, pz);
  const scale = new THREE.BoxGeometry(70, 2, 1.2); scale.translate(0, -Lp - c.bobR - 60, Z.backHi + 2);
  B.add(pend, spring, chop, B.mesh(rodG, 'steel'), B.mesh(bobG, 'brass'), B.mesh(bobRim, 'polished'), B.mesh(nutG, 'polished'));
  // the beat scale under the bob does not swing
  const bs = B.part('beatScale', 'pend', [0, L.pivot[1]], { info: 'pendulum' });
  B.add(bs, B.mesh(scale, 'brass'));

  // MOTION WORKS: hours on the subdial at 6
  const cp = B.part('cannon', 'motion', L.C, { label: 'Cannon pinion', labelZ: Z.cannon - 2 });
  B.add(cp, B.slab(G.pinionProfile(12, 1.0), [], Z.cannon - 1.2, Z.cannon + 1.2, 'steel', 0.05), B.cyl(2.4, Z.dialLo - 1.2, Z.cannon, 'steel', 24));
  const mw = B.part('minuteWheel', 'motion', L.M, { label: 'Hour train wheel', labelZ: Z.minute - 2 });
  B.add(mw, B.slab(G.wheelProfile(36, 1.0), G.spokeWindows(3, G.rootR(36, 1) - 2, 4, 2).map(h => h.reverse()), Z.minute - 1, Z.minute + 1, 'brass', 0.08),
    B.slab(G.pinionProfile(10, 2.0), [], Z.hour - 1.4, Z.minute - 1, 'steel', 0.05), B.cyl(1.4, Z.hour - 1.5, -4, 'steel', 18));
  const hw = B.part('hourWheel', 'motion', L.H, { label: 'Hour wheel', labelZ: Z.hour - 2 });
  B.add(hw, B.slab(G.wheelProfile(40, 2.0), G.spokeWindows(5, G.rootR(40, 2) - 3, 5, 3).map(h => h.reverse()), Z.hour - 1, Z.hour + 1, 'brass', 0.1),
    B.cyl(1.6, Z.dialLo - 1.2, -4, 'steel', 18));

  // DIAL
  const DR = 145;
  if (!opts.noDial) {
    const dial = B.part('dial', 'dial', [0, 0], { label: 'Dial', labelAt: [-100, -100], labelZ: Z.dialLo });
    const dh = [hole(3, 24, L.C), hole(1.6, 16, L.E), hole(2, 16, L.H), hole(3.4, 16, L.G)];
    B.add(dial, B.slab(circ(DR, 240), dh, Z.dialLo + 0.4, Z.dialHi, 'brass', 0.2),
      B.dialFace(DR, Z.dialLo, dh, opts.dialPaint || paintRegulator(cal)));
  }

  // HANDS: minutes at the centre, seconds at 12, hours at 6
  const oh = opts.hands || {};
  const mat = oh.mat || 'blued';
  const style = (k, d) => (oh[k] && oh[k][0]) || d;
  const handMesh = (id, at, z, st, len, w, hub, label) => {
    const p = B.part(id, 'hands', at, {});
    for (const [out, holes] of B.hand(st, len, w)) B.add(p, B.slab(out, holes, z, z + 0.5, mat, 0.05));
    B.add(p, B.cyl(hub, z - 0.3, z + 0.8, mat, 32));
    return p;
  };
  const hands = {
    minute: handMesh('minuteHand', L.C, Z.dialLo - 1.6, style('minute', 'spade'), 128, 1.4, 4),
    hour: handMesh('hourHand', L.H, Z.dialLo - 0.8, style('hour', 'spade'), 24, 1.1, 2.6),
  };
  if (oh.second !== false) {
    const sm = (oh.secondStyle && oh.secondStyle.mat) || mat;
    const p = B.part('secondHand', 'hands', L.E, {});
    B.add(p, B.slab([[-0.5, -8], [0.5, -8], [0.25, 27], [-0.25, 27]], [], Z.dialLo - 0.8, Z.dialLo - 0.4, sm, 0.05), B.cyl(1.8, Z.dialLo - 1.0, Z.dialLo - 0.2, sm, 24));
    hands.second = p;
  }

  for (const id of opts.hide || []) B.hidePart(id);

  const ROT = { barrel: 'great', center: 'center', third: 'third', escape: 'escape', pallet: 'pallet', crutch: 'pallet', pendulum: 'pendulum', cannon: 'center', minuteWheel: 'minute', hourWheel: 'hour' };
  return {
    unit: 14, focusK: 1.6,
    toggles: { bridges: ['backPlate', 'crutch', 'suspension', 'pendulum', 'beatScale'], dial: ['dial', 'hourHand', 'minuteHand', 'secondHand'] },
    pose(p) {
      for (const id in ROT) B.parts[id].root.rotation.z = p[ROT[id]];
      hands.hour.root.rotation.z = p.hands.hour; hands.minute.root.rotation.z = p.hands.minute;
      if (hands.second) hands.second.root.rotation.z = p.hands.second;
      // the weight: high when wound, low when run down
      const w = Math.max(0, Math.min(1, p.reserve / c.reserveTurns));
      const yTop = -240 - (1 - w) * 380 - L.G[1];     // in the part frame (the barrel's tangent)
      weightG.position.y = yTop;
      line.scale.y = -yTop;
    },
  };
}
