// ============================================================================
//  POOL PHYSICS  ·  tests/view.test.mjs — the 2D diagram (node, no DOM)
// ----------------------------------------------------------------------------
//  rolling decals .. the user: "balls should roll in the 2d scene as well".
//                    The 2D decal (view/diagram.js D.decal) turns by the
//                    physics orientation q; over one tick its points turn
//                    by |w| h about w (rolling, sliding with draw, and pure
//                    side spin), and a rolling ball turns by its path length / R
//  3D match ........ the 2D decal rest frame is the 3D one (scene3d qBase):
//                    the number spot faces up, the stripe pole lies flat
//  contact inset ... the user: "put the ball visualization ... in the
//                    bottom right corner ... make sure it stays in one
//                    place": D.inset is in the bottom-right corner, clear
//                    of the table, and the same in every frame of a shot
//  draw ............ the stroke item (aimed vs observed) and a full frame
//                    draw with finite arguments on a recording context
// ============================================================================
import { ok, done, D as DEG } from './util.mjs';
import { buildTable } from '../core/table.js';
import { createState, enableOrientation, beginShot, strike, tick } from '../core/physics.js';
import { createDiagram } from '../view/diagram.js';
import { fake2d } from './harness.mjs';

const T = buildTable(), R = T.R, D = createDiagram(T);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(...a);

function run(name, shot, n = 3) {
  const S = enableOrientation(createState(T));
  S.on[n] = 1; S.x[n] = -0.8; S.y[n] = 0;
  beginShot(S); strike(S, n, shot);
  let worst = 0, k = 0;
  for (let i = 0; i < 250; i++) {
    const q0 = Array.from(S.q.subarray(4 * n, 4 * n + 4)), w = [S.wx[n], S.wy[n], S.wz[n]];
    const d0 = D.decal(n, q0);
    tick(S);
    const d1 = D.decal(n, Array.from(S.q.subarray(4 * n, 4 * n + 4))), w1 = [S.wx[n], S.wy[n], S.wz[n]];
    const wm = w.map((v, j) => (v + w1[j]) / 2);
    for (const [a, b] of [[d0.spots[0].c, d1.spots[0].c], [d0.pole, d1.pole]]) {
      // Rodrigues: a turned by |w| h about w
      const wl = len(wm), th = wl * S.P.h, u = wm.map(v => v / (wl || 1)), c = Math.cos(th), sn = Math.sin(th), ua = cross(u, a), ud = dot(u, a);
      const rotA = a.map((v, j) => v * c + ua[j] * sn + u[j] * ud * (1 - c));
      const want = sub(rotA, a), got = sub(b, a);
      if (len(want) > 1e-6) { worst = Math.max(worst, len(sub(got, want)) / len(want)); k++; }
    }
  }
  return { name, worst, k, S };
}
{
  const roll = run('rolling', { phi: 0, v: 1.2, a: 0, b: 0.4 });        // b = 0.4: rolls at once
  const slide = run('sliding with draw', { phi: 0.3, v: 2, a: 0, b: -0.45 });
  const spin = run('side spin', { phi: 1.2, v: 0.8, a: 0.45, b: 0 });
  const all = [roll, slide, spin];
  ok(all.every(r => r.worst < 0.02 && r.k > 300), 'rolling decals: each tick the 2D number spot and stripe pole turn by |w| h about w (rolling, sliding, spin)',
    all.map(r => `${r.name}: worst ${(100 * r.worst).toFixed(2)} % over ${r.k}`).join('; '));
  // a rolling ball: the turn of the decal equals the distance / R
  const S = enableOrientation(createState(T)); S.on[2] = 1; S.x[2] = -1; S.y[2] = 0;
  beginShot(S); strike(S, 2, { phi: 0, v: 1.0, a: 0, b: 0.4 });
  const c0 = D.decal(2, Array.from(S.q.subarray(8, 12))).spots[0].c, x0 = S.x[2];
  for (let i = 0; i < 40; i++) tick(S);
  const c1 = D.decal(2, Array.from(S.q.subarray(8, 12))).spots[0].c;
  const turn = Math.acos(Math.max(-1, Math.min(1, dot(c0, c1)))), dist = S.x[2] - x0;
  ok(Math.abs(turn - dist / R) < 0.01 * dist / R, 'rolling decals: a rolling ball turns by its path length / R (no slip)', `turn ${(turn * DEG).toFixed(2)} deg, s / R ${(dist / R * DEG).toFixed(2)} deg`);
}
{
  const d = D.decal(9, null), d0 = D.decal(0, null);
  ok(Math.abs(d.spots[0].c[2] - 1) < 1e-12 && Math.abs(d.pole[2]) < 1e-12 && Math.abs(d.spots[1].c[2] + 1) < 1e-12 && d0.dots.length === 7,
    '3D match: at rest the number faces up and the stripe pole lies flat, as in the 3D decal (qBase)', `spot ${d.spots[0].c.map(v => v.toFixed(2))}, pole ${d.pole.map(v => v.toFixed(2))}`);
}
{
  // the contact inset: bottom right, clear of the table, same box every call
  const bad = [];
  for (const [w, h, rot] of [[1900, 1700, false], [1280, 700, false], [748, 640, false], [1100, 1300, true]]) {
    D.layout(w, h, rot, 10, 0, 0, { min: 92, max: 250 });
    const I = D.inset, a = JSON.stringify(I);
    D.layout(w, h, rot, 10, 0, 0, { min: 92, max: 250 });
    if (JSON.stringify(D.inset) !== a) bad.push('moved');
    if (!I || I.x + I.size > w + 0.5 || I.y + I.size > h + 0.5 || I.x < w / 2 || I.y < h / 2) bad.push(`${w}x${h} not bottom right`);
    // the table outline (outer rail) in px
    const xs = [], ys = [];
    for (const [x, y] of [[-D.outer.x, -D.outer.y], [D.outer.x, D.outer.y]]) { xs.push(D.X(x, y)); ys.push(D.Y(x, y)); }
    const tx1 = Math.max(...xs), ty1 = Math.max(...ys);
    if (I.where !== 'over' && !(tx1 <= I.x + 0.5 || ty1 <= I.y + 0.5)) bad.push(`${w}x${h} overlaps the table`);
  }
  ok(!bad.length, 'contact inset: a fixed box in the bottom-right corner, clear of the table (desktop, wide, phone, turned)', bad.join('; '));
}
{
  // a frame with every item kind, the stroke item and rolling balls
  const ctx = fake2d('t');
  D.layout(1600, 1000, false, 10, 0, 0, { min: 92, max: 250 });
  const S = enableOrientation(createState(T));
  const balls = [0, 1, 9, 12].map((n, i) => ({ n, x: -0.6 + i * 0.3, y: 0.1 * i, q: [0.9, 0.1, 0.3, 0.3].map(v => v / Math.hypot(0.9, 0.1, 0.3, 0.3)) }));
  const items = [{ kind: 'stroke', at: [-0.6, 0], aim: 0.2, obs: 0.2012, aimEnd: [0.2, 0.16], obsEnd: [0.2, 0.161], m: 'm6', label: 'Δφ = +0.069°' },
    { kind: 'overlap', lens: 'only', c: [0, 0], o: [0.05, 0.02], d: [1, 0], r: R, m: 'm5', label: 'half-ball' }].map(it => ({ it, p: 1, alpha: 1 }));
  const lens = { x: 0.02, y: 0.01, t: 0.2, alpha: 1, balls: [{ n: 3, x: 0.05, y: 0.02 }, { n: 0, x: 0, y: 0, ghost: true, tag: 'observed' }, { n: 0, x: 0.001, y: 0.0005, aimed: true }] };
  D.draw(ctx, { dpr: 2, style: 'felt', balls, items, lens, live: [], trails: [], paths: [], cue: null });
  const st = ctx.__st;
  ok(st.bad === 0 && st.texts.some(t => /^Δφ = \+0\.069° \(arc ×\d+\)$/.test(t)) && st.texts.includes('aimed') && st.texts.some(t => /aimed vs observed: \d/.test(t)),
    'draw: the stroke item labels aimed and delta phi (with the arc gain), the inset tags the aimed vs observed gap; all arguments finite',
    `${st.calls} calls, texts: ${st.texts.filter(t => /Δφ|aimed/.test(t)).join(' | ')}`);
}
done();
