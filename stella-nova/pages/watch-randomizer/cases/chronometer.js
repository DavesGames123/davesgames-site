// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/chronometer.js — marine chronometer box
// ────────────────────────────────────────────────────────────────────────────
//  build(B, spec, cal, dims, zF, zB) adds the case parts to the movement's
//  builder and returns { PARTS, toggles, pose(p, S, dt, now), has }. zF is
//  the dial face plane, zB the back of the movement (movement frame: mm, y
//  to 12, z out of the back, the dial faces -z; seen from the dial +x is 9).
//
//  The box stands on its floor at +z, so its "up" is -z, toward the viewer:
//  the dial looks up out of the bowl. The bowl hangs in a gimbal ring:
//  bowl to ring on pins along y, ring to box on pins along x. At sea the
//  box rolls and the bowl stays level; pose() rolls the box (Ry(b) Rx(a))
//  and turns the ring by Ry(b) only, so the bowl and the movement keep
//  still while the rest moves round them, which is what a gimbal does.
//  The outer lid opens and closes with the Lid toggle.
//
//  GREP MAP
//    function bowlProfile ..... the brass bowl, a closed (r, z) shell
//    function build ........... bowl, bezel, ring, box, deck, lids, bails
// ============================================================================
import * as THREE from 'three';
import { circ, hole } from '../../watch-movement/kit.js';
import { lathe, cap, dialRadius } from './common.js';
import { rrect } from './carriage.js';
import { layout } from '../types/chronometer.js';

const bar = (B, mat, x0, x1, y0, y1, z0, z1, r = 0.8, bev = 0.35) =>
  B.slab(rrect(x1 - x0, y1 - y0, r, (x0 + x1) / 2, (y0 + y1) / 2), [], z0, z1, mat, Math.min(bev, (x1 - x0) * 0.3, (y1 - y0) * 0.3));

// the bowl: rim at z0, rounding back to a flat-bottomed dish of depth d
function bowlProfile(R, z0, d, t = 1.6) {
  const out = [], inn = [];
  for (let i = 0; i <= 40; i++) {
    const a = i / 40 * Math.PI / 2, r = R * Math.cos(a), z = z0 + d * Math.pow(Math.sin(a), 1.2);
    out.push([Math.max(0.01, r), z]);
    inn.push([Math.max(0.01, (R - t) * Math.cos(a)), z0 + (d - t) * Math.pow(Math.sin(a), 1.2)]);
  }
  return [[R - t, z0 - 1.2], [R + 1.6, z0 - 1.2], [R + 1.6, z0 + 0.4], ...out.slice(1), ...inn.reverse().slice(0, -1), [R - t, z0]];
}

export function build(B, spec, cal, dims, zF, zB) {
  const c = spec.case, own = dialRadius(cal), Lt = layout(spec, own);
  const { dialR, bowlR, ringR, wall, W } = Lt;
  const bowlD = Math.max(bowlR * 0.95, zB - zF + 8);
  const zTop = zF - 14, D = Math.max(Lt.D, bowlD + 30), zBot = zTop + D, zDeck = zF + bowlD * 0.18;
  const k = v => v * W / 9;
  B.layer('caseFront', -k(0.2)); B.layer('caseMid', 0); B.layer('caseBack', k(0.32));

  // ── the bowl (stays level) ──
  const bowl = B.part('bowl', 'caseMid', [0, 0], { label: 'Bowl', labelAt: [bowlR * 0.7, -bowlR * 0.7], labelZ: zF + bowlD * 0.5 });
  B.add(bowl, lathe(B, bowlProfile(bowlR, zF - 1.0, bowlD), 'polished', 192));
  for (const sy of [-1, 1]) {                          // pins, bowl to ring, along y
    const pin = B.cyl(1.4, -1, 1, 'steel', 20); pin.geometry.rotateX(Math.PI / 2);
    pin.geometry.scale(1, (ringR - bowlR) / 2, 1); pin.position.set(0, sy * (bowlR + ringR) / 2, zDeck + 1.5);
    B.add(bowl, pin);
  }
  // ── the dial ──
  const dial = B.part('dial', 'caseMid', [0, 0], { label: 'Dial', labelAt: [0, -dialR * 0.55], labelZ: zF });
  const dh = [hole(1.4, 24)];
  B.add(dial, B.slab(circ(dialR + 0.5, 160), dh, zF + 0.4, zF + 1.4, 'brass', 0.2), B.dialFace(dialR, zF, dh, dims.paint));
  // ── bezel and glass on the bowl ──
  const bz = B.part('bezel', 'caseFront', [0, 0], { label: 'Bezel', labelAt: [-bowlR * 0.8, bowlR * 0.6], labelZ: zF - 3 });
  B.add(bz, lathe(B, [[dialR, zF - 3.4], [dialR + 1.5, zF - 4.2], [bowlR + 1.8, zF - 3.0], [bowlR + 2.0, zF - 1.2], [dialR, zF - 1.2]], 'polished', 192));
  const cry = B.part('crystal', 'caseFront', [0, 0], {});
  const g0 = cap(B, dialR + 0.6, 1.4, zF - 3.4, 'glass'); g0.userData.noShadow = true;
  B.add(cry, g0);

  // ── the gimbal ring (turns about y with the box) ──
  const ring = B.part('gimbal', 'caseMid', [0, 0], { label: 'Gimbal ring', labelAt: [ringR, ringR * 0.3], labelZ: zDeck });
  B.add(ring, B.slab(circ(ringR + 2.2, 192), [hole(ringR - 2.2, 192)], zDeck, zDeck + 3.2, 'polished', 0.6));
  for (const sx of [-1, 1]) {                          // pins, ring to box, along x
    const pin = B.cyl(1.6, -1, 1, 'steel', 20); pin.geometry.rotateY(Math.PI / 2);
    const len = (W / 2 - wall) - (ringR + 2.2);
    pin.geometry.scale(len / 2, 1, 1); pin.position.set(sx * (ringR + 2.2 + len / 2), 0, zDeck + 1.6);
    B.add(ring, pin);
  }
  for (const sy of [-1, 1]) {                          // the ring's bearings for the bowl pins
    const bs = B.cyl(2.6, zDeck - 0.6, zDeck + 3.8, 'polished', 24); bs.position.set(0, sy * ringR, 0);
    B.add(ring, bs);
  }

  // ── the box (rolls), its deck, corners, bails and lids ──
  const box = B.part('case', 'caseBack', [0, 0], { label: 'Box', labelAt: [-W / 2, -W / 2], labelZ: (zTop + zBot) / 2 });
  box.root.rotation.order = 'YXZ';
  B.add(box, B.slab(rrect(W, W, 5), [rrect(W - 2 * wall, W - 2 * wall, 2).reverse()], zTop, zBot - 6, 'wood', 1.4),
    B.slab(rrect(W, W, 5), [], zBot - 6, zBot, 'wood', 1.4),
    B.slab(rrect(W - 2 * wall + 0.2, W - 2 * wall + 0.2, 2), [hole(ringR + 5, 160)], zDeck + 3.5, zDeck + 7, 'wood', 0.6),
    B.slab(circ(ringR + 7, 160), [hole(ringR + 5, 160)], zDeck + 3.1, zDeck + 3.6, 'polished', 0.2));
  for (const sx of [-1, 1]) {                          // bearing plates where the ring pins enter the walls
    B.add(box, bar(B, 'polished', sx > 0 ? W / 2 - wall - 0.6 : -W / 2 + wall, sx > 0 ? W / 2 - wall : -W / 2 + wall + 0.6, -6, 6, zDeck - 4, zDeck + 7, 1.2, 0.2));
  }
  // brass corner straps along the four upright edges, and corner caps on the rim
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const xo = sx > 0 ? [W / 2 - 0.1, W / 2 + 0.6] : [-W / 2 - 0.6, -W / 2 + 0.1], yo = sy > 0 ? [W / 2 - 0.1, W / 2 + 0.6] : [-W / 2 - 0.6, -W / 2 + 0.1];
    const xi = sx > 0 ? [W / 2 - 7, W / 2 + 0.6] : [-W / 2 - 0.6, -W / 2 + 7], yi = sy > 0 ? [W / 2 - 7, W / 2 + 0.6] : [-W / 2 - 0.6, -W / 2 + 7];
    B.add(box, bar(B, 'polished', xo[0], xo[1], yi[0], yi[1], zTop - 0.3, zBot + 0.3, 0.3, 0.15),
      bar(B, 'polished', xi[0], xi[1], yo[0], yo[1], zTop - 0.3, zBot + 0.3, 0.3, 0.15));
  }
  // bails (lifting handles) on the two side walls
  for (const sx of [-1, 1]) {
    const tg = new THREE.TorusGeometry(W * 0.15, 1.2, 14, 48, Math.PI);
    tg.rotateZ(-Math.PI / 2); tg.scale(0.35, 1, 1);
    const m = B.mesh(tg, 'polished'); m.position.set(sx * (W / 2 + 0.6), 0, (zTop + zBot) / 2 - 4);
    if (sx < 0) m.rotation.z = Math.PI;
    B.add(box, m);
    for (const sy of [-1, 1]) B.add(box, bar(B, 'polished', sx > 0 ? W / 2 : -W / 2 - 1.2, sx > 0 ? W / 2 + 1.2 : -W / 2, sy * W * 0.15 - 3, sy * W * 0.15 + 3, (zTop + zBot) / 2 - 8, (zTop + zBot) / 2, 1, 0.3));
  }
  // the glazed inner lid (closed) and the solid outer lid (on a hinge)
  const lids = B.part('lid', 'caseBack', [0, 0], { label: 'Lids', labelAt: [W * 0.3, W / 2 + 6], labelZ: zTop - 6, parent: box });
  B.add(lids, B.slab(rrect(W - 1, W - 1, 4.5), [rrect(W - 2 * wall - 4, W - 2 * wall - 4, 3).reverse()], zTop - 4, zTop, 'wood', 0.8));
  const gl = B.slab(rrect(W - 2 * wall - 3, W - 2 * wall - 3, 3), [], zTop - 2.6, zTop - 1.8, 'glass', 0.1); gl.userData.noShadow = true;
  B.add(lids, gl);
  const outer = new THREE.Group(); outer.position.set(0, W / 2, zTop - 4); lids.root.add(outer);
  const lidM = B.slab(rrect(W, W, 5, 0, -W / 2), [], -7, 0, 'wood', 1.4);
  const plaque = B.slab(rrect(W * 0.34, W * 0.12, 2, 0, -W / 2), [], -7.5, -6.9, 'polished', 0.15);
  const catchM = bar(B, 'polished', -4, 4, -W - 0.6, -W + 4, -5, -2, 0.6, 0.2);
  B.add(lids, lidM, plaque, catchM); outer.add(lidM, plaque, catchM);
  for (const sx of [-1, 1]) {
    const hg = B.cyl(1.4, -W * 0.12, W * 0.12, 'polished', 16); hg.geometry.rotateY(Math.PI / 2); hg.position.set(sx * W * 0.3, W / 2 + 0.6, zTop - 4);
    B.add(lids, hg);
  }

  const PARTS = {
    bowl: { name: 'Bowl', group: 'Case', role: 'A heavy brass bowl that holds the movement. It hangs in gimbals and keeps level while the ship rolls, so the balance always swings in the same position.', specs: [['Diameter', `${(bowlR * 2).toFixed(0)} mm`], ['Finish', c.plate]] },
    dial: { name: 'Dial', group: 'Display', role: 'A silvered dial read through the glass lid without opening the box.', specs: [['Diameter', `${(dialR * 2).toFixed(0)} mm`], ['Base', spec.face.base.replace('-', ' ')]] },
    bezel: { name: 'Bezel', group: 'Case', role: 'A screwed bezel with a flat glass over the dial.', specs: [] },
    gimbal: { name: 'Gimbal ring', group: 'Case', role: 'The bowl turns in this ring on pins along one axis, and the ring turns in the box on pins along the other. Together they let the bowl hang level whatever the box does.', specs: [['Axes', '2']] },
    case: { name: 'Box', group: 'Case', role: 'A brass-bound wooden box with lifting bails. It is shown rolling a few degrees, as at sea; the bowl stays still.', specs: [['Wood', c.wood], ['Size', `${W.toFixed(0)} mm square`], ['Run', c.days]] },
    lid: { name: 'Lids', group: 'Case', role: 'A glazed inner lid, so the navigator can read the dial with the box shut, and a solid outer lid with a name plate.', specs: [] },
  };
  PARTS.crystal = PARTS.bezel;
  let lidA = 1.75;
  return {
    PARTS, toggles: ['bowl', 'bezel', 'crystal', 'gimbal', 'case', 'lid'],
    pose(p, S, dt, now) {
      const t = now / 1000, a = 0.05 * Math.sin(t * 0.7) + 0.02 * Math.sin(t * 1.9 + 1), b = 0.04 * Math.sin(t * 0.47 + 2);
      box.root.rotation.set(a, b, 0);
      ring.root.rotation.set(0, b, 0);
      lidA += ((S.lidOpen ? 1.75 : 0) - lidA) * Math.min(1, dt * 4);
      outer.rotation.x = lidA;
    },
    has: { lid: true },
  };
}
