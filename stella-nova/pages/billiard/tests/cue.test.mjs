// ============================================================================
//  POOL PHYSICS  ·  tests/cue.test.mjs — the cue clears the table
// ----------------------------------------------------------------------------
//  The user: "make sure the cure does not intersect the table". cuePose()
//  (core/cue.js) lifts the butt; cueClearance() measures the smallest gap
//  from the cue surface (its real taper) to every ball, to the cue ball
//  away from the tip, and to the rail top, every 5 mm along 1.48 m.
//    random layouts .... 20000 seeded layouts, aims, tips and pull-backs:
//                        no gap below zero
//    frozen cases ...... the cue ball on the cushion shooting out, a ball
//                        right behind the cue ball: lifted, and clear
//    level when free ... the cue stays near level (2 deg) in open play
//    bank geometry ..... the mirror in the rail line puts the bounce on
//                        solid cushion; the combination ghost chain
// ============================================================================
import { ok, done, D } from './util.mjs';
import { buildTable, rng } from '../core/table.js';
import { createState } from '../core/physics.js';
import { cuePose, cueClearance, CUE } from '../core/cue.js';
import { bankGeometry, comboGeometry, kickGeometry, RAILS, mirror } from '../core/geometry.js';

const T = buildTable(), R = T.R;

function layout(r, nBalls) {
  const S = createState(T), pts = [];
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i > nBalls) continue;
    for (let t = 0; t < 60; t++) {
      // a third of the cue balls sit near a cushion
      const edge = i === 0 && r() < 0.33;
      const x = edge && r() < 0.5 ? Math.sign(r() - 0.5) * (T.hx - R - r() * 0.01) : (r() * 2 - 1) * (T.hx - R);
      const y = edge && Math.abs(x) < T.hx - R - 0.02 ? Math.sign(r() - 0.5) * (T.hy - R - r() * 0.01) : (r() * 2 - 1) * (T.hy - R);
      if (pts.every(p => Math.hypot(p[0] - x, p[1] - y) > 2 * R + 1e-4)) { pts.push([x, y]); S.on[i] = 1; S.x[i] = x; S.y[i] = y; break; }
    }
  }
  return S;
}

{
  const r = rng(2024);
  let n = 0, worst = Infinity, at = '', lifted = 0, rail = 0, ball = 0;
  for (let k = 0; k < 20000; k++) {
    const S = layout(r, 4 + (k % 12));
    if (!S.on[0]) continue;
    const shot = { x: S.x[0], y: S.y[0], phi: r() * 2 * Math.PI, a: (r() - 0.5) * 0.8, b: (r() - 0.5) * 1, back: r() * 0.12 };
    const P = cuePose(T, S, shot), c = cueClearance(T, S, P);
    n++;
    if (c.min < worst) { worst = c.min; at = `${c.what} at ${(c.s * 100).toFixed(1)} cm, elev ${(P.elev * D).toFixed(1)} deg`; }
    if (P.elev > CUE.minElev + 1e-6) { lifted++; if (P.need.some(q => q.what === 'rail' && q.elev >= P.elev - 1e-9)) rail++; else ball++; }
  }
  ok(worst >= 0, 'random layouts: the cue (its full taper, 1.48 m) never goes into a ball, the cue ball or the rail', `${n} poses, smallest gap ${(worst * 1000).toFixed(2)} mm (${at}); lifted ${lifted}: ${rail} by the rail, ${ball} by a ball`);
}
{
  // the cue ball frozen on the top cushion, shot straight out (the cue must come over the rail)
  const S = createState(T); S.on[0] = 1; S.x[0] = 0.4; S.y[0] = T.hy - R;
  const P = cuePose(T, S, { x: S.x[0], y: S.y[0], phi: -Math.PI / 2, a: 0, b: 0, back: 0.05 });
  const c = cueClearance(T, S, P);
  // a ball touching the cue ball right behind it
  const S2 = createState(T); S2.on[0] = S2.on[5] = 1; S2.x[0] = 0; S2.y[0] = 0; S2.x[5] = -2 * R - 1e-4; S2.y[5] = 0;
  const P2 = cuePose(T, S2, { x: 0, y: 0, phi: 0, a: 0, b: -0.3, back: 0.04 });
  const c2 = cueClearance(T, S2, P2);
  ok(c.min >= 0 && P.elev > 20 / D && c2.min >= 0 && P2.elev > 30 / D, 'frozen cases: on the cushion and with a ball behind, the cue lifts and stays clear',
    `cushion: elev ${(P.elev * D).toFixed(1)} deg, gap ${(c.min * 1000).toFixed(2)} mm, tip b shown ${P.bVis.toFixed(2)}; ball behind: elev ${(P2.elev * D).toFixed(1)} deg, gap ${(c2.min * 1000).toFixed(2)} mm`);
  // open play: level
  const S3 = createState(T); S3.on[0] = S3.on[1] = 1; S3.x[0] = 0; S3.y[0] = 0; S3.x[1] = 0.5; S3.y[1] = 0;
  const P3 = cuePose(T, S3, { x: 0, y: 0, phi: 0, a: 0, b: 0, back: 0.03 });
  ok(Math.abs(P3.elev - CUE.minElev) < 1e-9 && P3.bridge && !P3.bridge.rail && Math.abs(P3.bridge.z - (R + Math.tan(P3.elev) * Math.hypot(P3.bridge.x - P3.contact[0], P3.bridge.y - P3.contact[1]))) < 1e-9,
    'open play: the cue stays at 2 deg and the bridge hand sits under the cue on the cloth', `elev ${(P3.elev * D).toFixed(2)} deg, bridge at ${(P3.bridge.s * 100).toFixed(0)} cm`);
  ok(P.bridge.rail, 'near a rail the bridge sits on the rail', `bridge z ${(P.bridge.z * 1000).toFixed(1)} mm, rail top ${(T.spec.railTop * 1000).toFixed(0)} mm`);
}
{
  // bank geometry: a ball in the middle banked across the table into a bottom corner off the top rail
  const S = createState(T); S.on[0] = S.on[3] = 1; S.x[0] = -0.6; S.y[0] = -0.2; S.x[3] = 0.25; S.y[3] = -0.15;
  const geos = [];
  for (const p of T.pockets) for (const rail of RAILS) { const g = bankGeometry(S, T, 3, p, rail); if (g) geos.push(g); }
  let bad = 0;
  for (const g of geos) {
    const b = g.bank, M = mirror(T, b.rail, g.aimX, g.aimY);
    const onLine = b.rail === 'top' || b.rail === 'bottom' ? Math.abs(Math.abs(b.by) - (T.hy - R)) : Math.abs(Math.abs(b.bx) - (T.hx - R));
    // O, B and the mirrored pocket on one line; the two angles to the normal equal (the mirror)
    const cross = (b.bx - g.ox) * (M.y - g.oy) - (b.by - g.oy) * (M.x - g.ox);
    if (onLine > 1e-9 || Math.abs(cross) > 1e-9) bad++;
  }
  const combo = comboGeometry(Object.assign(S, {}), T, 3, 3, T.pockets[0]);
  ok(geos.length >= 2 && bad === 0 && combo === null, 'bank geometry: the bounce point is on the rail line, and O, B and the mirrored pocket are on one line', `${geos.length} banks (${geos.map(g => g.bank.rail + '->' + g.pocket).join(', ')}), ${bad} bad`);
  const S2 = createState(T); S2.on[0] = S2.on[2] = S2.on[6] = 1; S2.x[0] = 0; S2.y[0] = 0; S2.x[2] = 0.5; S2.y[2] = 0.15; S2.x[6] = 0.85; S2.y[6] = 0.38;
  let cmb = null; for (const p of T.pockets) { const g = comboGeometry(S2, T, 2, 6, p); if (g && (!cmb || g.combo.cosB > cmb.combo.cosB)) cmb = g; }
  const kick = (() => { for (const p of T.pockets) for (const rail of RAILS) { const g = kickGeometry(S2, T, 6, p, rail); if (g) return g; } return null; })();
  ok(cmb && Math.abs(Math.hypot(cmb.combo.gBx - S2.x[6], cmb.combo.gBy - S2.y[6]) - 2 * R) < 1e-12 && Math.abs(Math.hypot(cmb.gx - S2.x[2], cmb.gy - S2.y[2]) - 2 * R) < 1e-12 && kick && kick.kind === 'kick',
    'combination: two ghost balls 2R from their balls; a kick finds a rail path', cmb ? `combo 2 -> 6 -> pocket ${cmb.pocket}, second cut ${(cmb.combo.thetaB * D).toFixed(1)} deg; kick off the ${kick && kick.bank.rail}` : 'none');
}
done();
