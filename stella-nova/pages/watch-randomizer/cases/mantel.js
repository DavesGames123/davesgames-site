// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/mantel.js — French mantel clock cases
// ────────────────────────────────────────────────────────────────────────────
//  build(B, spec, cal, dims, zF, zB) adds the case parts to the movement's
//  builder and returns { PARTS, toggles, pose(p, S, dt, now), has }. zF is
//  the dial face plane, zB the back of the movement (movement frame: mm, y
//  to 12, z out of the back, the dial faces -z; seen from the dial +x is 9).
//
//  STYLES (spec.case.style)
//    drum ....... a turned drum (tambour) on a saddle, on a stepped plinth
//    napoleon ... the "Napoleon hat": an arched case with flared shoulders,
//                 built as a shell so a pendulum can hang inside
//    portico .... the drum held high in an entablature on four columns, the
//                 pendulum swinging between them
//  A drum whose calibre's pendulum (cal.pendulum) would reach the plinth is
//  built as a portico. The back has a glazed door on a hinge (Open back).
//
//  GREP MAP
//    function hatOutline ...... the Napoleon hat silhouette
//    function build ........... plinth, body, bezels, columns, back door
// ============================================================================
import * as THREE from 'three';
import { circ, hole } from '../../watch-movement/kit.js';
import { lathe, cap, dialRadius } from './common.js';
import { rrect } from './carriage.js';
import { layout } from '../types/mantel.js';

const bar = (B, mat, x0, x1, y0, y1, z0, z1, r = 0.8, bev = 0.35) =>
  B.slab(rrect(x1 - x0, y1 - y0, r, (x0 + x1) / 2, (y0 + y1) / 2), [], z0, z1, mat, Math.min(bev, (x1 - x0) * 0.3, (y1 - y0) * 0.3));
function turn(B, prof, mat, x, y, z, seg = 48) {
  const g = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(Math.max(0.01, r), h)), seg);
  const m = B.mesh(g, mat); m.position.set(x, y, z); return m;
}

// the Napoleon hat: a straight base band, ogee shoulders, and an arch over
// the dial of radius ra; wb the base width, yb the base line, counterclockwise
export function hatOutline(ra, wb, yb, hb) {
  const a0 = 0.32, pts = [[-wb / 2, yb], [wb / 2, yb], [wb / 2, yb + hb]];
  const s0 = [wb / 2, yb + hb], s1 = [ra * Math.cos(a0), ra * Math.sin(a0)];
  const c0 = [s0[0] - wb * 0.02, s0[1] + (s1[1] - s0[1]) * 0.55], c1 = [s1[0] + ra * 0.6, s1[1] - ra * 0.08];
  const bez = (t, a, b, c, d) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
  for (let i = 1; i <= 28; i++) { const t = i / 28; pts.push([bez(t, s0[0], c0[0], c1[0], s1[0]), bez(t, s0[1], c0[1], c1[1], s1[1])]); }
  for (let i = 1; i < 60; i++) { const a = a0 + (Math.PI - 2 * a0) * i / 60; pts.push([ra * Math.cos(a), ra * Math.sin(a)]); }
  for (let i = 0; i <= 28; i++) { const t = 1 - i / 28; pts.push([-bez(t, s0[0], c0[0], c1[0], s1[0]), bez(t, s0[1], c0[1], c1[1], s1[1])]); }
  pts.push([-wb / 2, yb + hb]);
  return pts;
}

export function build(B, spec, cal, dims, zF, zB) {
  const c = spec.case, own = dialRadius(cal), pend = cal.pendulum || null, Lt = layout(spec, own, pend);
  const { dialR, drumR, yP, ph, pw } = Lt, style = Lt.columns && c.style === 'drum' ? 'portico' : c.style;
  const zFr = Math.min(zF - 6, Math.min(...Object.values(cal.CAL.z)) - 3), zBk = Math.max(zB + Math.max(14, drumR * 0.25), pend ? pend.pivot[2] + pend.bobR * 0.4 + 8 : -1e9), zM = (zFr + zBk) / 2;
  const body = { drum: 'polished', portico: 'polished', napoleon: c.plinth.endsWith('marble') ? 'paint' : 'wood' }[style];
  const plinthMat = c.plinth.endsWith('marble') ? 'paint' : 'wood';
  const k = v => v * drumR / 9;
  B.layer('caseFront', -k(0.3)); B.layer('caseMid', 0); B.layer('caseBack', k(0.3));
  B.root.position.y = -(Lt.top + Lt.bottom) / 2;

  // ── the plinth (all styles but the hat, which stands on its own base) ──
  const pl = B.part('plinth', 'caseMid', [0, 0], { label: 'Plinth', labelAt: [pw / 2, (style === 'napoleon' ? Lt.hatBase : yP) - ph / 2], labelZ: zM });
  const yBase = style === 'napoleon' ? Lt.hatBase : yP, pd = zBk - zFr + 18;
  B.add(pl, bar(B, plinthMat, -pw / 2, pw / 2, yBase - ph, yBase - ph * 0.25, zM - pd / 2, zM + pd / 2, 3, 1.2),
    bar(B, plinthMat, -pw / 2 + 4, pw / 2 - 4, yBase - ph * 0.25, yBase, zM - pd / 2 + 4, zM + pd / 2 - 4, 2, 0.8),
    bar(B, 'polished', -pw / 2 - 1.2, pw / 2 + 1.2, yBase - ph * 0.28, yBase - ph * 0.2, zM - pd / 2 - 1.2, zM + pd / 2 + 1.2, 1, 0.3));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.add(pl, turn(B, [[0, 0], [3, 0.2], [4.6, 2.0], [4.1, 4.0], [2.8, 5.2], [0, 5.4]], 'polished', sx * (pw / 2 - 6), yBase - ph - 5.4, zM + sz * (pd / 2 - 6), 36));
  }

  // ── the body ──
  const bodyPart = B.part('case', 'caseMid', [0, 0], { label: style === 'napoleon' ? 'Napoleon hat case' : 'Drum', labelAt: [-drumR, drumR * 0.4], labelZ: zM });
  if (style === 'napoleon') {
    const ra = drumR + 6, wb = drumR * 3.9, hb = drumR * 0.2, wall = Math.max(4, drumR * 0.1);
    const out = hatOutline(ra, wb, Lt.hatBase, hb), inn = hatOutline(ra - wall, wb - 2 * wall, Lt.hatBase + wall, hb).reverse();
    B.add(bodyPart, B.slab(out, [inn], zFr + 4, zBk - 4, body, 1.5),
      B.slab(out, [hole(dialR + 1.5, 128)], zFr, zFr + 4, body, 1.2),
      B.slab(out, [hole(drumR - 1, 128)], zBk - 4, zBk, body, 1.2));
    // a gilt band along the base and the shoulders
    B.add(bodyPart, B.slab(hatOutline(ra + 0.8, wb + 1.6, Lt.hatBase - 0.8, hb), [hatOutline(ra - 0.6, wb - 1.2, Lt.hatBase + 0.6, hb).reverse()], zFr - 0.8, zFr + 0.6, 'polished', 0.3));
  } else {
    B.add(bodyPart, lathe(B, [[dialR + 1, zFr + 4], [drumR - 2.5, zFr + 2], [drumR, zFr + 5], [drumR, zBk - 5], [drumR - 2.5, zBk - 2], [drumR - 4, zBk - 2], [drumR - 4, zFr + 6], [dialR + 1, zFr + 6]], 'polished', 192));
    // reeded bands round the drum
    for (const zz of [zFr + 8, zBk - 8]) B.add(bodyPart, lathe(B, [[drumR - 0.2, zz - 1.2], [drumR + 0.9, zz - 0.6], [drumR + 0.9, zz + 0.6], [drumR - 0.2, zz + 1.2]], 'polished', 192));
    if (style === 'drum') {
      // a saddle under the drum, its top cut to the drum's curve
      const sw = drumR * 0.62, sad = [[-sw - 4, yP], [sw + 4, yP]];
      for (let i = 0; i <= 30; i++) { const x = sw - 2 * sw * i / 30; sad.push([x, -Math.sqrt(Math.max(0, drumR * drumR - x * x)) + 0.4]); }
      B.add(bodyPart, B.slab(sad, [], zFr + 5, zBk - 5, 'polished', 0.8));
    } else {
      // portico: an entablature over the drum on four columns
      const cx = drumR + 8, yTop = drumR + 4;
      B.add(bodyPart, bar(B, 'polished', -cx - 6, cx + 6, yTop, yTop + 5, zFr - 2, zBk + 2, 2, 0.8),
        bar(B, plinthMat, -cx - 4, cx + 4, yTop + 5, yTop + 10, zFr, zBk, 2, 0.8),
        bar(B, 'polished', -cx - 7, cx + 7, yTop - 1.5, yTop, zFr - 3, zBk + 3, 1, 0.4));
      for (const sx of [-1, 1]) for (const zz of [zFr + 3, zBk - 3]) {
        const h = yTop - 1.5 - yP;
        B.add(bodyPart, turn(B, [[0, 0], [4.6, 0], [4.6, 2], [3.4, 3], [3.0, 5], [2.7, h * 0.5], [2.4, h - 5], [3.2, h - 3], [4.4, h - 1.5], [4.4, h], [0, h]], 'polished', sx * cx, yP, zz, 40));
      }
      // the drum hangs from the entablature on two straps
      for (const sx of [-1, 1]) B.add(bodyPart, bar(B, 'polished', sx * drumR * 0.3 - 2, sx * drumR * 0.3 + 2, drumR - 3, yTop, zM - 3, zM + 3, 0.8, 0.4));
    }
  }

  // ── the dial ──
  // (a calibre with its own face keeps it; the case paints no dial)
  if (!dims.ownFace) {
    const dial = B.part('dial', 'caseMid', [0, 0], { label: 'Dial', labelAt: [0, -dialR * 0.6], labelZ: zF });
    const dh = [hole(1.8, 24)];
    B.add(dial, B.slab(circ(dialR + 0.5, 160), dh, zF + 0.4, zF + 1.6, 'brass', 0.2), B.dialFace(dialR, zF, dh, dims.paint));
  }
  // ── front bezel and glass ──
  const bz = B.part('bezel', 'caseFront', [0, 0], { label: 'Bezel and glass', labelAt: [dialR * 0.7, -dialR * 0.7], labelZ: zFr });
  B.add(bz, lathe(B, [[dialR - 0.5, zFr - 0.5], [dialR + 1.5, zFr - 2.6], [dialR + 5.5, zFr - 1.6], [dialR + 6.5, zFr + 0.6], [dialR + 5.5, zFr + 2], [dialR - 0.5, zFr + 2]], 'polished', 160));
  const cry = B.part('crystal', 'caseFront', [0, 0], {});
  const gF = cap(B, dialR + 0.5, dialR * 0.14, zFr - 0.6, 'glass'); gF.userData.noShadow = true;
  B.add(cry, gF);
  // ── back door: a glazed bezel on a hinge ──
  const bk = B.part('caseback', 'caseBack', [0, 0], { label: 'Back door', labelAt: [-drumR * 0.7, drumR * 0.7], labelZ: zBk });
  const hingeX = -(drumR - 3), doorG = new THREE.Group(); doorG.position.set(hingeX, 0, zBk); bk.root.add(doorG);
  const dR = drumR - 3.2;
  const ring = lathe(B, [[dR - 3, -0.4], [dR, -0.4], [dR + 0.6, 1.0], [dR, 2.0], [dR - 3, 2.0]], 'polished', 160);
  ring.geometry.translate(-hingeX, 0, 0);
  const gB = B.slab(circ(dR - 2.6, 128), [], 0.4, 1.0, 'glass', 0.1); gB.geometry.translate(-hingeX, 0, 0); gB.userData.noShadow = true;
  B.add(bk, ring, gB); doorG.add(ring, gB);
  const hinge = B.cyl(1.0, -4, 4, 'polished', 16); hinge.rotation.x = Math.PI / 2; hinge.position.set(hingeX, 0, zBk + 0.8);
  B.add(bk, hinge);

  const PARTS = {
    plinth: { name: 'Plinth', group: 'Case', role: 'The base the clock stands on, with a gilt moulding and four turned feet.', specs: [['Material', c.plinth], ['Width', `${pw.toFixed(0)} mm`]] },
    case: style === 'napoleon'
      ? { name: 'Napoleon hat case', group: 'Case', role: 'A low arched case with flared shoulders, the shape of a bicorne hat. It is a shell: the movement and its pendulum sit inside, behind the dial.', specs: [['Material', c.plinth], ['Width', `${(drumR * 3.9).toFixed(0)} mm`]] }
      : style === 'portico'
        ? { name: 'Portico', group: 'Case', role: 'An entablature on four turned columns. The drum hangs from it, so a pendulum can swing freely between the columns.', specs: [['Mounts', c.mounts], ['Columns', '4']] }
        : { name: 'Drum (tambour)', group: 'Case', role: 'A turned brass drum that holds a round "Paris" movement, set in a saddle on the plinth.', specs: [['Diameter', `${(drumR * 2).toFixed(0)} mm`], ['Mounts', c.mounts]] },
    dial: { name: 'Dial', group: 'Display', role: 'An enamel dial on a brass plate, in front of the movement.', specs: [['Diameter', `${(dialR * 2).toFixed(0)} mm`], ['Base', spec.face.base.replace('-', ' ')], ['Numerals', spec.face.numerals]] },
    bezel: { name: 'Bezel and glass', group: 'Case', role: 'A cast bezel holding a convex glass; it opens to set the hands.', specs: [['Mounts', c.mounts]] },
    caseback: { name: 'Back door', group: 'Case', role: 'A glazed door on a hinge, opened to wind the clock and regulate the pendulum.', specs: [] },
  };
  PARTS.crystal = PARTS.bezel;
  if (dims.ownFace) delete PARTS.dial;
  return {
    PARTS, toggles: ['plinth', 'case', 'bezel', 'crystal', 'caseback'],
    pose(p, S, dt) { S.backA += ((S.backOpen ? 1.9 : 0) - S.backA) * Math.min(1, dt * 4); doorG.rotation.y = -S.backA; },
    has: { back: true },
  };
}
