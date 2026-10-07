// ============================================================================
//  GRAVITY PLAYGROUND  ·  trail tests  (Node)
// ----------------------------------------------------------------------------
//  Checks trails.js with a mock 2D context and runs saver-test.mjs.
//    - sample(): a point per DS world units or DTMAX sim s, ring wrap at
//      CAP, a reset when the time goes back
//    - oscPeriod(): the Kepler period of a circle and of an ellipse is
//      constant along the orbit; an unbound body gives 0
//    - draw(): the band ends at the head, the tail is cut at now − win,
//      and a pan moves every vertex by the pan (world points, no smear)
//    - draw() makes no garbage in the steady state (heap growth check)
//  Run: node stella-nova/pages/gravity/tests.mjs
// ============================================================================
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import v8 from 'node:v8';
import vm from 'node:vm';
v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc');
const require = createRequire(import.meta.url);
const T = require('./trails.js');

let fail = 0;
const check = (ok, name, info = '') => { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

// A mock context: records the vertices of the last frame, no new objects.
function mockCtx() {
  const c = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', fills: 0, nv: 0,
    minX: 0, maxX: 0, minY: 0, maxY: 0, sx: 0, sy: 0, rx: 0, ry: 0, maxD: 0,
    beginPath() {}, closePath() {}, fill() { this.fills++; },
    moveTo(x, y) { this.v(x, y); }, lineTo(x, y) { this.v(x, y); }, arc() {},
    v(x, y) { const d = Math.sqrt((x - this.rx) ** 2 + (y - this.ry) ** 2); if (d > this.maxD) this.maxD = d; if (!this.nv) { this.minX = this.maxX = x; this.minY = this.maxY = y; } this.nv++; this.sx += x; this.sy += y;
      if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x; if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y; },
    clear() { this.fills = 0; this.nv = 0; this.maxD = 0; this.sx = 0; this.sy = 0; } };
  return c;
}

// A body on a circle of radius R at angular speed w, sampled each h.
function circleTrail(R, w, t1, h) {
  const tr = T.make();
  for (let t = 0; t <= t1 + 1e-9; t += h) T.sample(tr, R * Math.cos(w * t), R * Math.sin(w * t), t);
  return tr;
}

// sample(): spacing
{
  const tr = T.make();
  let kept = 0;
  for (let i = 0; i <= 1000; i++) if (T.sample(tr, i * 0.1, 0, i * 0.001)) kept++;   // 100 units in 1 s
  check(kept >= 33 && kept <= 35, 'sample: one point per DS world units', `kept ${kept} for 100 units, DS ${T.DS}`);
  const tr2 = T.make(); kept = 0;
  for (let i = 0; i <= 1000; i++) if (T.sample(tr2, 0, 0, i * 0.01)) kept++;          // still, 10 s
  check(kept >= 200 && kept <= 202, 'sample: a still body gets a point per DTMAX', `kept ${kept} in 10 s`);
  T.sample(tr2, 0, 0, 0);
  check(tr2.n === 1, 'sample: time going back clears the trail', `n ${tr2.n}`);
  const tr3 = T.make(16);
  for (let i = 0; i < 40; i++) T.sample(tr3, i * 10, 0, i);
  const oldest = tr3.buf[((tr3.head - tr3.n + tr3.cap) % tr3.cap) * 3];
  check(tr3.n === 16 && oldest === 240, 'sample: the ring keeps the newest CAP points', `n ${tr3.n} oldest x ${oldest}`);
}

// oscPeriod(): circle, ellipse, unbound
{
  const G = 1000, M = 8000, mk = (x, y, vx, vy, m, fixed) => ({ x, y, vx, vy, mass: m, fixed: !!fixed });
  const r = 110, v = Math.sqrt(G * M / r);
  const B = [mk(0, 0, 0, 0, M, true), mk(r, 0, 0, v, 1e-6)];
  const Tc = 2 * Math.PI * Math.sqrt(r ** 3 / (G * M)), P = T.oscPeriod(B, 1, G);
  check(Math.abs(P / Tc - 1) < 1e-4, 'oscPeriod: circle', `${P.toFixed(4)} vs ${Tc.toFixed(4)}`);
  // ellipse: a = 200, e = 0.6, at periapsis and at apoapsis
  const a = 200, e = 0.6, rp = a * (1 - e), ra = a * (1 + e), vp = Math.sqrt(G * M * (1 + e) / rp), va = Math.sqrt(G * M * (1 - e) / ra);
  const Pp = T.oscPeriod([B[0], mk(rp, 0, 0, vp, 1e-6)], 1, G), Pa = T.oscPeriod([B[0], mk(-ra, 0, 0, -va, 1e-6)], 1, G);
  check(Math.abs(Pp / Pa - 1) < 1e-6, 'oscPeriod: ellipse, same at periapsis and apoapsis', `${Pp.toFixed(4)} ${Pa.toFixed(4)}`);
  check(T.oscPeriod([B[0], mk(r, 0, 0, 2 * v, 1)], 1, G) === 0, 'oscPeriod: unbound body gives 0');
  check(T.oscPeriod([mk(0, 0, 0, 0, 5)], 0, G) === 0, 'oscPeriod: a lone body gives 0');
}

// draw(): head, tail cut, pan
{
  const R = 100, w = 1, tr = circleTrail(R, w, 10, 0.005), now = 10, hx = R * Math.cos(10), hy = R * Math.sin(10);
  const c = mockCtx(); c.rx = 400 + hx; c.ry = 300 + hy;
  const s = T.draw(c, tr, hx, hy, now, Math.PI, 400, 300, 1, 'ribbon', '#ffc832', 4);
  // A half circle (win = π at w = 1): the tail end is a diameter from the head.
  const reach = c.maxD;
  check(s > 50 && reach > 2 * R - 1 && reach < 2 * R + 1, 'draw: the tail is cut at now − win', `spline ${s}, head to tail ${reach.toFixed(2)} (2R = ${2 * R})`);
  const span = Math.max(c.maxX - c.minX, c.maxY - c.minY);
  check(c.globalAlpha === 1 && c.globalCompositeOperation === 'source-over', 'draw: restores alpha and blend');
  const cx = c.sx / c.nv, cy = c.sy / c.nv;
  c.clear(); T.draw(c, tr, hx, hy, now, Math.PI, 400 + 37, 300 - 11, 1, 'ribbon', '#ffc832', 4);
  const dx = c.sx / c.nv - cx, dy = c.sy / c.nv - cy;
  check(Math.abs(dx - 37) < 1e-3 && Math.abs(dy + 11) < 1e-3, 'draw: a pan moves the trail by the pan', `dx ${dx.toFixed(4)} dy ${dy.toFixed(4)}`);
  c.clear(); const s2 = T.draw(c, tr, hx, hy, now, Math.PI, 400, 300, 2, 'ribbon', '#ffc832', 4);
  const span2 = Math.max(c.maxX - c.minX, c.maxY - c.minY);
  check(Math.abs(span2 / span - 2) < 0.06, 'draw: zoom 2 doubles the trail, spline adds points', `span ${span2.toFixed(1)}, spline ${s} -> ${s2}`);
  for (const st of ['line', 'dots']) { c.clear(); const n = T.draw(c, tr, hx, hy, now, Math.PI, 400, 300, 1, st, '#ffc832', 4); check(n > 0 && c.fills > 0, `draw: style ${st} fills`, `fills ${c.fills}`); }
  check(T.draw(c, T.make(), 0, 0, 0, 5, 0, 0, 1, 'ribbon', '#fff', 3) === 0, 'draw: an empty trail draws nothing');
}

// draw(): no garbage in the steady state
{
  const tr = circleTrail(150, 0.7, 60, 0.004), c = mockCtx();
  const frame = () => { for (const st of ['line', 'ribbon', 'dots']) { c.clear(); T.draw(c, tr, 150 * Math.cos(42), 150 * Math.sin(42), 60, 20, 400, 300, 1.3, st, '#5cd8e8', 4); } };
  for (let i = 0; i < 3000; i++) frame();            // warm up: grow scratch, optimise
  gc();
  const g0 = T.stats().grows, h0 = v8.getHeapStatistics().used_heap_size;
  for (let i = 0; i < 2000; i++) frame();
  const dh = v8.getHeapStatistics().used_heap_size - h0, g1 = T.stats().grows;
  check(g1 === g0 && dh >= 0 && dh < 64 * 1024, 'draw: no per-frame garbage', `heap +${(dh / 1024).toFixed(1)} KB over 6000 draws, scratch grows ${g1 - g0}`);
}

// The saver scenes (energy drift, escapes, Trojans).
try {
  const out = execFileSync(process.execPath, [new URL('./saver-test.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  const last = out.trim().split('\n').pop();
  check(last === 'all scenes pass', 'saver-test.mjs', last);
} catch (e) { check(false, 'saver-test.mjs', String(e.stdout || e).trim().split('\n').pop()); }

console.log(fail ? `${fail} failures` : 'all tests pass');
process.exit(fail ? 1 : 0);
