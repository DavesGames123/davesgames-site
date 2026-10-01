// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/carriage.js — carriage clock cases
// ────────────────────────────────────────────────────────────────────────────
//  build(B, spec, cal, dims, zF, zB) adds the case parts to the movement's
//  builder and returns { PARTS, toggles, pose(p, S, dt, now), has }. zF is
//  the dial face plane, zB the back of the movement (movement frame: mm, y
//  to 12, z out of the back, the dial faces -z; seen from the dial +x is 9).
//
//  A cast frame of four corner columns (square corniche, fluted gorge, or
//  plain obis rails) between a stepped base and a moulded cornice; glass
//  on the front, the sides, the back door and a top window; a pierced mask
//  round the dial; a brass back plate on pillars behind the movement; and
//  a carrying handle. The whole build sits higher by B.root so the case,
//  not the dial, is centred on the stage.
//
//  GREP MAP
//    function rrect / bar / turn ..... outline, box and turned-part helpers
//    function build .................. frame, glass, mask, dial, handle
// ============================================================================
import * as THREE from 'three';
import { circ, hole } from '../../watch-movement/kit.js';
import * as G from '../../watch-movement/geom.js';
import { dialRadius } from './common.js';
import { layout } from '../types/carriage.js';

// a rounded rectangle, centred at (cx, cy), counterclockwise
export function rrect(w, h, r, cx = 0, cy = 0, n = 6) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3);
  if (r <= 0.02) return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
  const out = [], cs = [[cx + w / 2 - r, cy - h / 2 + r, -Math.PI / 2], [cx + w / 2 - r, cy + h / 2 - r, 0], [cx - w / 2 + r, cy + h / 2 - r, Math.PI / 2], [cx - w / 2 + r, cy - h / 2 + r, Math.PI]];
  for (const [x, y, a0] of cs) for (let i = 0; i <= n; i++) { const a = a0 + Math.PI / 2 * i / n; out.push([x + r * Math.cos(a), y + r * Math.sin(a)]); }
  return out;
}
// an axis-aligned box with rounded xy edges and a bevel
const bar = (B, mat, x0, x1, y0, y1, z0, z1, r = 0.8, bev = 0.35) =>
  B.slab(rrect(x1 - x0, y1 - y0, r, (x0 + x1) / 2, (y0 + y1) / 2), [], z0, z1, mat, Math.min(bev, (x1 - x0) * 0.3, (y1 - y0) * 0.3));
// a part turned about the vertical (y): profile [[r, y], ...] from the axis
function turn(B, prof, mat, x, y, z, seg = 48) {
  const g = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(Math.max(0.01, r), h)), seg);
  const m = B.mesh(g, mat); m.position.set(x, y, z); return m;
}
const glass = (B, ...a) => { const m = bar(B, 'glass', ...a, 0.2, 0.1); m.userData.noShadow = true; return m; };

export function build(B, spec, cal, dims, zF, zB) {
  const c = spec.case, own = dialRadius(cal), Lt = layout(spec, own);
  const { dialR, W, handleH } = Lt, y0 = Lt.yBot, y1 = Lt.yTop;
  const zFr = zF - 3.5, D = Math.max(Lt.D, zB - zF + 18), zBk = zFr + D, zM = (zFr + zBk) / 2;
  const k = v => v * W / 9;
  B.layer('caseFront', -k(0.35)); B.layer('caseMid', 0); B.layer('caseBack', k(0.35));
  // centre the whole case (with its handle) on the stage
  B.root.position.y = -((y0 - 10) + (y1 + 8 + handleH)) / 2;

  const frame = B.part('case', 'caseMid', [0, 0], { label: 'Frame', labelAt: [-W / 2 - 6, y0 + 10], labelZ: zM });
  // base: a stepped plinth (and bun feet, or a deeper plinth)
  B.add(frame, bar(B, 'polished', -W / 2 - 4, W / 2 + 4, y0 - 6, y0 - 1.5, zFr - 4, zBk + 4, 2.4, 0.8),
    bar(B, 'polished', -W / 2 - 2, W / 2 + 2, y0 - 1.6, y0 + 1.2, zFr - 2, zBk + 2, 1.8, 0.6));
  if (c.feet === 'bun') for (const sx of [-1, 1]) for (const zz of [zFr - 1, zBk + 1]) {
    B.add(frame, turn(B, [[0, 0], [2.4, 0.2], [3.6, 1.6], [3.2, 3.2], [2.2, 4.2], [0, 4.4]], 'polished', sx * (W / 2 + 1), y0 - 10.4, zz, 32));
  } else B.add(frame, bar(B, 'polished', -W / 2 - 5.5, W / 2 + 5.5, y0 - 10, y0 - 5.8, zFr - 5.5, zBk + 5.5, 2.6, 1.0));
  // cornice: two steps out, one step in, then the top window frame
  B.add(frame, bar(B, 'polished', -W / 2 - 1.5, W / 2 + 1.5, y1 - 1.5, y1 + 1.2, zFr - 1.5, zBk + 1.5, 1.6, 0.5),
    bar(B, 'polished', -W / 2 - 3.6, W / 2 + 3.6, y1 + 1.2, y1 + 4.2, zFr - 3.6, zBk + 3.6, 2.4, 0.9),
    bar(B, 'polished', -W / 2 - 2.2, W / 2 + 2.2, y1 + 4.2, y1 + 5.6, zFr - 2.2, zBk + 2.2, 1.8, 0.5));
  const tw = 5.5;                                   // the top window frame
  B.add(frame, bar(B, 'polished', -W / 2 - 1, W / 2 + 1, y1 + 5.6, y1 + 7.6, zFr - 1, zFr + tw, 1, 0.5),
    bar(B, 'polished', -W / 2 - 1, W / 2 + 1, y1 + 5.6, y1 + 7.6, zBk - tw, zBk + 1, 1, 0.5),
    bar(B, 'polished', -W / 2 - 1, -W / 2 + tw, y1 + 5.6, y1 + 7.6, zFr + tw, zBk - tw, 1, 0.5),
    bar(B, 'polished', W / 2 - tw, W / 2 + 1, y1 + 5.6, y1 + 7.6, zFr + tw, zBk - tw, 1, 0.5));
  // corner columns
  const cols = [[-1, zFr + 3], [1, zFr + 3], [-1, zBk - 3], [1, zBk - 3]];
  for (const [sx, cz] of cols) {
    const cx = sx * (W / 2 - 3);
    if (c.style === 'corniche') {
      B.add(frame, bar(B, 'polished', cx - 3, cx + 3, y0 + 1.2, y1 - 1.5, cz - 3, cz + 3, 0.8, 0.5),
        bar(B, 'polished', cx - 4, cx + 4, y0 + 1.2, y0 + 4.2, cz - 4, cz + 4, 1.2, 0.6),
        bar(B, 'polished', cx - 4, cx + 4, y1 - 4.5, y1 - 1.5, cz - 4, cz + 4, 1.2, 0.6));
    } else if (c.style === 'gorge') {
      const fl = B.slab(G.gearProfile(16, 2 * 3.0 / 16, { t: 0.55, ha: 0.25, hf: 0.45, seg: 4 }), [], y0 + 4, y1 - 4.5, 'polished', 0.15);
      fl.geometry.rotateX(-Math.PI / 2); fl.geometry.translate(cx, 0, cz);
      B.add(frame, fl,
        turn(B, [[0, 0], [4.2, 0], [4.2, 1.2], [3.4, 2.0], [3.6, 2.8], [0, 2.8]], 'polished', cx, y0 + 1.2, cz, 40),
        turn(B, [[0, 0], [3.6, 0], [3.4, 0.8], [4.2, 1.6], [4.2, 3.0], [0, 3.0]], 'polished', cx, y1 - 4.5, cz, 40));
    } else {
      B.add(frame, bar(B, 'polished', cx - 1.8, cx + 1.8, y0 + 1.2, y1 - 1.5, cz - 1.8, cz + 1.8, 0.6, 0.3));
    }
  }
  // rails that hold the glass: top and bottom on all four sides
  const rail = (yA, yB) => [
    bar(B, 'polished', -W / 2 + 3, W / 2 - 3, yA, yB, zFr, zFr + 3, 0.5, 0.3), bar(B, 'polished', -W / 2 + 3, W / 2 - 3, yA, yB, zBk - 3, zBk, 0.5, 0.3),
    bar(B, 'polished', -W / 2, -W / 2 + 3, yA, yB, zFr + 3, zBk - 3, 0.5, 0.3), bar(B, 'polished', W / 2 - 3, W / 2, yA, yB, zFr + 3, zBk - 3, 0.5, 0.3)];
  B.add(frame, ...rail(y0 + 1.2, y0 + 4.2), ...rail(y1 - 4.5, y1 - 1.5));
  // behind the movement: a back plate on four turned pillars
  const pr = Math.max(own + 4, dialR + 1), py = [y0 + 10, Math.min(y1 - 9, own * 0.9 + 8)];
  B.add(frame, bar(B, 'satin', -W / 2 + 7, W / 2 - 7, y0 + 6, y1 - 7, zB + 6, zB + 8.2, 4, 0.5));
  for (const sx of [-1, 1]) for (const yy of py) {
    const pil = B.cyl(1.6, zF + 1.6, zB + 6, 'satin', 28); pil.position.set(sx * pr, yy, 0);
    B.add(frame, pil);
  }

  // the mask: a gilt plate round the dial, behind the front glass
  const mask = B.part('mask', 'caseFront', [0, 0], { label: 'Mask', labelAt: [W / 2 - 8, y0 + 12], labelZ: zF - 1 });
  B.add(mask, B.slab(rrect(W - 7, y1 - y0 - 8, 3, 0, (y0 + y1) / 2), [hole(dialR - 0.8, 128)], zF - 1.4, zF - 0.55, 'polished', 0.25),
    B.slab(circ(dialR + 1.4, 128), [hole(dialR - 0.8, 128)], zF - 2.0, zF - 1.35, 'polished', 0.3));
  // the dial
  const dial = B.part('dial', 'caseMid', [0, 0], { label: 'Dial', labelAt: [0, -dialR * 0.6], labelZ: zF });
  const dh = [hole(1.6, 24)];
  B.add(dial, B.slab(circ(dialR + 0.5, 160), dh, zF + 0.4, zF + 1.4, 'brass', 0.2), B.dialFace(dialR, zF, dh, dims.paint));
  // glass on five sides
  const gl = B.part('crystal', 'caseFront', [0, 0], { label: 'Glass panels', labelAt: [-W / 2, y1 - 10], labelZ: zFr });
  B.add(gl, glass(B, -W / 2 + 3, W / 2 - 3, y0 + 4.2, y1 - 4.5, zFr + 0.6, zFr + 1.4),
    glass(B, -W / 2 + 0.6, -W / 2 + 1.4, y0 + 4.2, y1 - 4.5, zFr + 3, zBk - 3), glass(B, W / 2 - 1.4, W / 2 - 0.6, y0 + 4.2, y1 - 4.5, zFr + 3, zBk - 3),
    glass(B, -W / 2 + tw, W / 2 - tw, y1 + 6.2, y1 + 6.9, zFr + tw, zBk - tw));
  // the back door: a glazed frame with a small knob
  const door = B.part('caseback', 'caseBack', [0, 0], { label: 'Back door', labelAt: [0, y1 - 6], labelZ: zBk });
  B.add(door, B.slab(rrect(W - 6, y1 - y0 - 5.7, 1.2, 0, (y0 + y1) / 2 - 0.15), [rrect(W - 13, y1 - y0 - 13, 1, 0, (y0 + y1) / 2).reverse()], zBk - 0.4, zBk + 1.0, 'polished', 0.3),
    glass(B, -W / 2 + 6.5, W / 2 - 6.5, y0 + 7.2, y1 - 7.6, zBk - 0.1, zBk + 0.5));
  const knob = B.cyl(1.4, zBk + 1.0, zBk + 3.2, 'polished', 24); knob.position.set(W / 2 - 9, (y0 + y1) / 2, 0);
  B.add(door, knob);
  // the carrying handle, raised: a round bar over the top on two bosses
  const hdl = B.part('handle', 'caseMid', [0, 0], { label: 'Handle', labelAt: [0, y1 + 8 + handleH], labelZ: zM });
  const hx = W / 2 - 5, yH = y1 + 8, pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, a = Math.PI * t;
    pts.push(new THREE.Vector3(-hx * Math.cos(a), yH + handleH * Math.pow(Math.sin(a), 0.55), zM));
  }
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 1.7, 24, false);
  B.add(hdl, B.mesh(tube, 'polished'));
  for (const sx of [-1, 1]) {
    B.add(hdl, turn(B, [[0, 0], [2.6, 0], [2.8, 1.2], [2.2, 2.4], [1.6, 3.2], [0, 3.2]], 'polished', sx * hx, y1 + 5.6, zM, 32));
    const ball = B.mesh(new THREE.SphereGeometry(2.3, 32, 20), 'polished'); ball.position.set(sx * hx, yH, zM);
    B.add(hdl, ball);
  }

  const PARTS = {
    case: { name: c.style === 'corniche' ? 'Corniche frame' : c.style === 'gorge' ? 'Gorge frame' : 'Obis frame', group: 'Case',
      role: c.style === 'corniche' ? 'The classic French travelling-clock frame: four square columns between a stepped base and a moulded cornice, cast in brass and gilt.' : c.style === 'gorge' ? 'A frame with fluted round corner columns and a concave (gorge) moulding at top and base, the grander of the French carriage cases.' : 'The plain obis frame: thin rails and no columns, so the glass shows nearly the whole movement.',
      specs: [['Width', `${W.toFixed(0)} mm`], ['Height', `${(y1 - y0 + 16).toFixed(0)} mm (handle down)`], ['Metal', c.metal]] },
    mask: { name: 'Mask', group: 'Case', role: 'A pierced gilt plate behind the front glass. It frames the dial and hides the front plate of the movement.', specs: [['Finish', c.metal]] },
    dial: { name: 'Dial', group: 'Display', role: 'An enamel dial in the mask. The movement sits right behind it; its centre arbor carries the hands.', specs: [['Diameter', `${(dialR * 2).toFixed(0)} mm`], ['Base', spec.face.base.replace('-', ' ')], ['Numerals', spec.face.numerals]] },
    crystal: { name: 'Glass panels', group: 'Case', role: 'Bevelled glass on the front, the sides and the top. The top window shows the escapement from above, as on a travelling clock.', specs: [['Panels', '5']] },
    caseback: { name: 'Back door', group: 'Case', role: 'A glazed door, opened to wind and set the clock with a key.', specs: [] },
    handle: { name: 'Carrying handle', group: 'Case', role: 'A round bar on two bosses that folds flat over the top when the clock stands on a shelf.', specs: [['Span', `${(2 * hx).toFixed(0)} mm`]] },
  };
  return { PARTS, toggles: ['case', 'mask', 'crystal', 'caseback', 'handle'], pose() {}, has: {} };
}
