// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/regulator.js — wall regulator cases
// ────────────────────────────────────────────────────────────────────────────
//  build(B, spec, cal, dims, zF, zB) adds the case parts to the movement's
//  builder and returns { PARTS, toggles, pose(p, S, dt, now), has }. zF is
//  the dial face plane, zB the back of the movement (movement frame: mm, y
//  to 12, z out of the back, the dial faces -z; seen from the dial +x is 9).
//
//  A Vienna-style case: a hood round the dial, a long trunk glazed on the
//  front and both sides, a crest (pediment, arch or pierced) with turned
//  finials, half columns, a tapered base with a drop finial, a beat scale
//  on the back board. A pendulum calibre (cal.pendulum) hangs its own
//  pendulum in the trunk. On a balance calibre the case hangs a pendulum
//  that swings only for show, and its card says so. Driving weights appear
//  only when the calibre says it is weight driven (cal.weightDriven).
//
//  GREP MAP
//    function crest ........... the crest outline and its piercings
//    function build ........... body, door, glass, crest, columns, base,
//                               dial, beat scale, show pendulum, weights
// ============================================================================
import * as THREE from 'three';
import * as G from '../../watch-movement/geom.js';
import { circ, hole } from '../../watch-movement/kit.js';
import { lathe, dialRadius } from './common.js';
import { rrect } from './carriage.js';
import { layout } from '../types/regulator.js';
const { TAU } = G;

const bar = (B, mat, x0, x1, y0, y1, z0, z1, r = 0.8, bev = 0.35) =>
  B.slab(rrect(x1 - x0, y1 - y0, r, (x0 + x1) / 2, (y0 + y1) / 2), [], z0, z1, mat, Math.min(bev, (x1 - x0) * 0.3, (y1 - y0) * 0.3));
function turn(B, prof, mat, x, y, z, seg = 48) {
  const g = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(Math.max(0.01, r), h)), seg);
  const m = B.mesh(g, mat); m.position.set(x, y, z); return m;
}
const glass = (B, ...a) => { const m = bar(B, 'glass', ...a, 0.2, 0.1); m.userData.noShadow = true; return m; };
// an urn finial of height h, standing on y = 0
const urn = h => [[0.01, 0], [h * 0.16, 0], [h * 0.16, h * 0.08], [h * 0.09, h * 0.14], [h * 0.2, h * 0.36], [h * 0.22, h * 0.48], [h * 0.12, h * 0.62], [h * 0.07, h * 0.7], [h * 0.11, h * 0.8], [h * 0.04, h * 0.92], [0.01, h]];

// the crest: outline (and holes) above the hood top yT, half width w
function crest(kind, w, yT, h) {
  if (kind === 'arched') {
    const pts = [[-w, yT], [w, yT], [w, yT + h * 0.2]];
    for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI; pts.push([w * Math.cos(a), yT + h * 0.2 + h * 0.8 * Math.sin(a)]); }
    return { out: pts, holes: [] };
  }
  const out = [[-w, yT], [w, yT], [w * 0.92, yT + h * 0.18], [0, yT + h], [-w * 0.92, yT + h * 0.18]];
  if (kind !== 'carved') return { out, holes: [] };
  const holes = [];                                   // a pierced rosette and two scrolls
  holes.push(circ(h * 0.16, 32, [0, yT + h * 0.42]).reverse());
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) holes.push(circ(h * (0.07 - i * 0.012), 20, [sx * w * (0.26 + i * 0.17), yT + h * (0.3 - i * 0.07)]).reverse());
  return { out, holes };
}

export function build(B, spec, cal, dims, zF, zB) {
  const c = spec.case, own = dialRadius(cal), pend = cal.pendulum || null, Lt = layout(spec, own, pend);
  const { dialR: dR, Wc, show, p, yb } = Lt;
  const t = Math.max(6, dR * 0.06), yHood = -dR * 1.18, yTop = dR * 1.32;
  const zP = show ? zB + dR * 0.14 : p.pivot[2], bobT = p.bobR * 0.36;
  const zDoor = zF - dR * 0.14, zBack = Math.max(zB, zP + bobT) + dR * 0.2;
  const k = v => v * Wc / 9;
  B.layer('caseFront', -k(0.22)); B.layer('caseMid', 0); B.layer('caseBack', k(0.18));
  B.root.position.y = -(Lt.top + Lt.bottom) / 2;

  // ── the body: back board, hood sides, trunk frame, top and bottom ──
  const body = B.part('case', 'caseMid', [0, 0], { label: 'Case', labelAt: [-Wc / 2, (yb + yHood) / 2], labelZ: zBack });
  B.add(body, bar(B, 'wood', -Wc / 2 + t, Wc / 2 - t, yb, yTop, zBack, zBack + t, 1, 0.5),
    bar(B, 'wood', -Wc / 2 - t * 0.6, Wc / 2 + t * 0.6, yTop, yTop + t, zDoor - t * 1.6, zBack + t, 2, 1),
    bar(B, 'wood', -Wc / 2 - t * 0.4, Wc / 2 + t * 0.4, yb - t, yb, zDoor - t, zBack + t, 2, 1));
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? Wc / 2 - t : -Wc / 2, x1 = sx > 0 ? Wc / 2 : -Wc / 2 + t;
    B.add(body, bar(B, 'wood', x0, x1, yHood, yTop, zDoor, zBack + t, 1, 0.5),                 // hood side
      bar(B, 'wood', x0, x1, yb, yHood, zDoor, zDoor + t, 1, 0.5),                              // trunk front stile
      bar(B, 'wood', x0, x1, yb, yHood, zBack - t, zBack + t, 1, 0.5),                          // trunk back stile
      glass(B, x0 + t * 0.35, x1 - t * 0.35, yb + t * 0.3, yHood - t * 0.3, zDoor + t, zBack - t)); // side glass
  }
  // a moulding between the hood and the trunk
  B.add(body, bar(B, 'wood', -Wc / 2 - t, Wc / 2 + t, yHood - t * 0.5, yHood + t * 0.5, zDoor - t * 1.4, zBack + t, 2, 0.8),
    bar(B, 'polished', -Wc / 2 - t * 1.05, Wc / 2 + t * 1.05, yHood - t * 0.08, yHood + t * 0.08, zDoor - t * 1.5, zBack + t * 1.05, 0.3, 0.1));

  // ── the door: one long glazed frame, a round window for the dial ──
  const door = B.part('door', 'caseFront', [0, 0], { label: 'Glazed door', labelAt: [Wc * 0.3, (yb + yHood) / 2], labelZ: zDoor });
  const dw = Wc + t * 0.4, trunkWin = rrect(Wc - 2.6 * t, yHood - yb - 2.6 * t, t * 0.5, 0, (yHood + yb) / 2);
  B.add(door, B.slab(rrect(dw, yTop - yb, t * 0.3, 0, (yTop + yb) / 2), [hole(dR + t * 0.3, 160), trunkWin.slice().reverse()], zDoor - t, zDoor, 'wood', 1.2),
    lathe(B, [[dR + t * 0.3, zDoor - t - 1.6], [dR + t * 0.9, zDoor - t - 2.2], [dR + t * 1.4, zDoor - t - 0.6], [dR + t * 1.4, zDoor - t], [dR + t * 0.3, zDoor - t]], 'polished', 160));
  const g1 = B.slab(circ(dR + t * 0.3, 128), [], zDoor - t * 0.55, zDoor - t * 0.35, 'glass', 0.1); g1.userData.noShadow = true;
  B.add(door, g1, glass(B, -Wc / 2 + 1.3 * t, Wc / 2 - 1.3 * t, yb + 1.3 * t, yHood - 1.3 * t, zDoor - t * 0.55, zDoor - t * 0.35));
  const key = B.cyl(t * 0.25, zDoor - t - 4, zDoor - t, 'polished', 24); key.position.set(Wc / 2 - t * 0.9, (yb + yHood) / 2, 0);
  B.add(door, key);

  // ── crest, finials, half columns, base and drop finial ──
  const cr = B.part('crest', 'caseMid', [0, 0], { label: 'Crest', labelAt: [0, Lt.top - dR * 0.1], labelZ: zDoor });
  const ch = dR * 0.38, yC = yTop + t, cw = Wc / 2 + t * 0.4, { out, holes } = crest(c.crest, cw, yC, ch);
  B.add(cr, B.slab(out, holes, zDoor - t * 0.8, zDoor + t * 0.6, 'wood', 1.2));
  const fh = dR * 0.32;
  for (const sx of [-1, 0, 1]) {
    const y = sx === 0 ? (c.crest === 'arched' ? yC + ch : yC + ch * 0.92) : yC;
    B.add(cr, turn(B, urn(sx === 0 ? fh * 1.2 : fh), 'polished', sx * (cw - t * 0.6), y - 1, zDoor - t * 0.1, 40));
  }
  const cols = B.part('columns', 'caseFront', [0, 0], { label: 'Half columns', labelAt: [Wc / 2 + t, yHood - dR * 0.6], labelZ: zDoor });
  const hcol = yHood - yb - t;
  for (const sx of [-1, 1]) {
    const prof = [[0.01, 0], [t * 0.75, 0], [t * 0.75, t * 0.5], [t * 0.5, t * 0.8], [t * 0.42, hcol * 0.5], [t * 0.5, hcol - t * 0.8], [t * 0.75, hcol - t * 0.5], [t * 0.75, hcol], [0.01, hcol]];
    B.add(cols, turn(B, prof, 'wood', sx * (Wc / 2 + t * 0.3), yb + t * 0.5, zDoor - t * 0.3, 40),
      turn(B, [[0.01, 0], [t * 0.8, 0], [t * 0.8, t * 0.25], [0.01, t * 0.25]], 'polished', sx * (Wc / 2 + t * 0.3), yHood - t * 0.75, zDoor - t * 0.3, 40));
  }
  const base = B.part('base', 'caseMid', [0, 0], { label: 'Base', labelAt: [Wc * 0.3, yb - dR * 0.3], labelZ: zDoor });
  const bH = dR * 0.48, bp = [[-Wc / 2 - t * 0.6, yb - t], [Wc / 2 + t * 0.6, yb - t]];
  for (let i = 1; i <= 24; i++) { const s = i / 24; bp.push([(Wc / 2 + t * 0.6) * (1 - 0.72 * Math.pow(s, 0.8)), yb - t - bH * s]); }
  for (let i = 24; i >= 1; i--) { const s = i / 24; bp.push([-(Wc / 2 + t * 0.6) * (1 - 0.72 * Math.pow(s, 0.8)), yb - t - bH * s]); }
  B.add(base, B.slab(bp, [], zDoor - t * 0.6, zBack + t, 'wood', 1.4),
    turn(B, urn(dR * 0.3).map(([r, h]) => [r, -h]).reverse(), 'polished', 0, yb - t - bH + 1, zDoor + (zBack - zDoor) * 0.3, 40));

  // ── the dial, its bezel, and the beat scale ──
  // (a calibre with its own face keeps it; the case adds only the bezel)
  const dial = B.part(dims.ownFace ? 'dialBezel' : 'dial', 'caseMid', [0, 0], { label: dims.ownFace ? 'Dial bezel' : 'Dial', labelAt: [0, -dR * 0.6], labelZ: zF });
  const dh = [hole(Math.max(2.4, dR * 0.02), 24)];
  if (!dims.ownFace) B.add(dial, B.slab(circ(dR + 0.5, 180), dh, zF + 0.4, zF + 1.8, 'brass', 0.3), B.dialFace(dR, zF, dh, dims.paint));
  B.add(dial, lathe(B, [[dR - 0.5, zF - 0.4], [dR + 1.5, zF - 2.2], [dR + 5, zF - 1.0], [dR + 5, zF + 1.8], [dR - 0.5, zF + 1.8]], 'polished', 192));
  const bs = B.part('beatScale', 'caseMid', [0, 0], { label: 'Beat scale', labelAt: [p.L * 0.12, p.pivot[1] - p.L - p.bobR * 1.3], labelZ: zBack });
  const arc = [];
  for (let i = 0; i <= 32; i++) { const a = -0.09 + 0.18 * i / 32; arc.push([Math.sin(a) * (p.L + p.bobR * 1.25), p.pivot[1] - Math.cos(a) * (p.L + p.bobR * 1.25)]); }
  for (let i = 32; i >= 0; i--) { const a = -0.09 + 0.18 * i / 32; arc.push([Math.sin(a) * (p.L + p.bobR * 1.75), p.pivot[1] - Math.cos(a) * (p.L + p.bobR * 1.75)]); }
  B.add(bs, B.slab(arc, [], zBack - 0.8, zBack, 'polished', 0.2));

  // ── a pendulum for show (balance calibres only) ──
  let showG = null;
  if (show) {
    const pp = B.part('showPendulum', 'caseMid', [0, 0], { label: 'Pendulum', labelAt: [p.bobR * 1.3, p.pivot[1] - p.L], labelZ: zP });
    showG = new THREE.Group(); showG.position.set(0, p.pivot[1], zP); pp.root.add(showG);
    const rod = B.cyl(Math.max(1.2, dR * 0.012), 0, p.L, 'polished', 20); rod.geometry.rotateX(Math.PI / 2);                // along y, from 0 down to -L
    const bob = lathe(B, [[0.01, -bobT], [p.bobR * 0.7, -bobT * 0.8], [p.bobR, 0], [p.bobR * 0.7, bobT * 0.8], [0.01, bobT]], 'polished', 96);
    bob.position.set(0, -p.L, 0);
    const susp = bar(B, 'steel', -dR * 0.03, dR * 0.03, -dR * 0.12, 0, -0.4, 0.4, 0.2, 0.05);
    B.add(pp, rod, bob, susp); showG.add(rod, bob, susp);
    const cock = bar(B, 'polished', -dR * 0.08, dR * 0.08, p.pivot[1] - dR * 0.02, p.pivot[1] + dR * 0.1, zP - 3, zBack, 1, 0.4);
    B.add(pp, cock);
  }
  // ── driving weights (weight-driven calibres only) ──
  if (cal.weightDriven) {
    const wp = B.part('weights', 'caseMid', [0, 0], { label: 'Weights', labelAt: [dR * 0.6, yHood - dR * 0.8], labelZ: zP });
    const wr = dR * 0.11, wl = dR * 0.9;
    for (const sx of (cal.weightDriven === 2 ? [-1, 1] : [1])) {
      const x = sx * Math.min(Wc / 2 - t - wr * 1.6, Math.max(p.bobR + wr * 1.6, dR * 0.62)), yw = yHood - dR * 0.5;
      const wm = lathe(B, [[0.01, 0], [wr, 0], [wr, wl], [0.01, wl]], 'polished', 48); wm.geometry.rotateX(-Math.PI / 2); wm.position.set(x, yw - wl, zP);
      const cord = B.cyl(0.5, 0, yHood - yw + dR * 0.2, 'steel', 8); cord.geometry.rotateX(Math.PI / 2); cord.position.set(x, yHood + dR * 0.2, zP);
      B.add(wp, wm, cord);
    }
  }

  const PARTS = {
    case: { name: 'Vienna regulator case', group: 'Case', role: 'A tall wall case glazed on the front and both sides, so the pendulum can be watched. The long trunk gives a long pendulum room to swing, and a long pendulum keeps better time.', specs: [['Wood', c.wood], ['Height', `${(Lt.top - Lt.bottom).toFixed(0)} mm`], ['Width', `${Wc.toFixed(0)} mm`]] },
    door: { name: 'Glazed door', group: 'Case', role: 'One long door with a round window for the dial and a long window for the pendulum; it opens with a key to wind and set the clock.', specs: [['Fittings', c.mounts]] },
    crest: { name: 'Crest', group: 'Case', role: c.crest === 'carved' ? 'A pierced pediment with turned urn finials.' : c.crest === 'arched' ? 'An arched crest with turned finials.' : 'A triangular pediment with turned urn finials, after classical architecture.', specs: [['Style', c.crest]] },
    columns: { name: 'Half columns', group: 'Case', role: 'Turned half columns on the front corners of the trunk, with brass capitals.', specs: [] },
    base: { name: 'Base', group: 'Case', role: 'A tapered base under the trunk ending in a turned drop finial.', specs: [] },
    dial: { name: 'Dial', group: 'Display', role: 'A large dial in a brass bezel. The movement is behind it, and its centre arbor carries the hands.', specs: [['Diameter', `${(dR * 2).toFixed(0)} mm`], ['Base', spec.face.base.replace('-', ' ')], ['Numerals', spec.face.numerals]] },
    beatScale: { name: 'Beat scale', group: 'Case', role: 'A brass arc behind the pendulum tip. The clock is "in beat" when the swing is equal either side of zero.', specs: [] },
    showPendulum: { name: 'Pendulum (for show)', group: 'Case', role: 'This regulator holds a balance movement, which keeps the time on its own. The pendulum in the trunk swings for show only: it is not connected to the escapement.', specs: [['Length', `${p.L.toFixed(0)} mm`], ['Swing', '2 s period']] },
    weights: { name: 'Driving weights', group: 'Power', role: 'Brass-cased weights on lines: they fall slowly and drive the train, with no change of force as they run down.', specs: [['Count', String(cal.weightDriven === 2 ? 2 : 1)]] },
  };
  PARTS.crystal = PARTS.door;
  if (dims.ownFace) { delete PARTS.dial; PARTS.dialBezel = { name: 'Dial bezel', group: 'Case', role: 'A turned brass bezel round the movement\'s own regulator dial.', specs: [['Diameter', `${(dR * 2).toFixed(0)} mm`]] }; }
  return {
    PARTS, toggles: ['case', 'door', 'crest', 'columns', 'base', 'beatScale'],
    pose(pz, S, dt, now) { if (showG) showG.rotation.z = 0.045 * Math.sin(now / 1000 * Math.PI); },
    has: {},
  };
}
