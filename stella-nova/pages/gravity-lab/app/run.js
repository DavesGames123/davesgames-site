// ============================================================================
//  GRAVITY LAB  ·  app/run.js — one running experiment on the page
// ----------------------------------------------------------------------------
//  A CHOICE names a run: { type: 'library', key, variant, seed } or
//  { type: 'roll', seed } (roll.js). startRun(choice) builds the spec
//  (roll.js prepare: the spawn pool for the tray), makes the Lab on the GPU
//  (engine.js makeLab), hands its rows to the renderer and writes the row
//  colours (the group of each particle).
//
//  stepRun(dtReal) moves the run by spec.rate x speed x dtReal of sim time
//  (Lab.frame: whole particle steps). A CPU guard (S.slow) slows the clock
//  when the bodies need too many substeps (a very close pass). Events come
//  back from the Lab: spawned debris gets the colour of its source, and
//  each event goes on the bus ('event') with plain words and real units
//  for the HUD and the saver.
//
//  throwItem(key, x, v) adds a tray item (items.js): a body (a new System
//  with one more body, the backend unchanged) or a swarm of particles
//  (rows of the spawn pool).
//
//  bodyInstances() / segments() fill the renderer's buffers each frame:
//  bodies in frame coordinates (frame.js), trails, the throw preview.
//
//  grep -n targets: "export function startRun", "export function stepRun",
//  "export function throwItem", "function onEvents", "export function describe",
//  "export function bodyInstances", "export function segments",
//  "export function lights", "function shed", "export const KIND_ID",
//  "export function fmtLen", "export function fmtTime", "export function fmtSpeed"
// ============================================================================
import { makeLab } from '../engine.js';
import { budgetFor } from '../budget.js';
import { roll, prepare } from '../roll.js';
import { build } from '../experiments/index.js';
import { frameOf, toFrame, toWorld, dirToFrame } from '../frame.js';
import { extendSystem, makeItem, swarm, dominant, ITEM } from '../items.js';
import { MAXB, v3, rng } from '../nbody.js';
import { BODY_FLOATS, SEG_FLOATS } from '../render.js';
import { S, UI, SPEEDS, PHONE_Q, COARSE, emit } from './state.js';
import { cam } from './camera.js';

export const KIND_ID = { sun: 0, star: 0, redDwarf: 0, blue: 0, hot: 0, rock: 1, moon: 1, mars: 1, amber: 1, mercury: 1, venus: 1, jupiter: 2, saturn: 2, gas: 2, ice: 3, neptune: 3, uranus: 3, earth: 4, comet: 5, probe: 6, core: 7, bh: 8 };
const TRAIL = 420;
const pack = c => ((Math.round(Math.min(1, Math.max(0, c[0])) * 255)) | (Math.round(Math.min(1, Math.max(0, c[1])) * 255) << 8) | (Math.round(Math.min(1, Math.max(0, c[2])) * 255) << 16) | (255 << 24)) >>> 0;

export function budget() {
  const touch = PHONE_Q.matches || COARSE, q = budgetFor(UI.quality, touch);
  return { n: q.n, nSelf: q.nSelf, extra: touch ? 1024 : 3072 };
}
export function specFor(choice) {
  const b = budget();
  const spec = choice.type === 'roll' ? roll(choice.seed, { n: b.n, nSelf: b.nSelf })
    : build(choice.key, choice.seed ?? 1, { n: choice.key === 'disk' ? b.nSelf : b.n, variant: choice.variant });
  return prepare(spec, b);
}

// ── formatting (real units from spec.scale) ─────────────────────────────────
export function fmtLen(m) {
  const a = Math.abs(m);
  if (a < 2e9) return sig(m / 1e3) + ' km';
  if (a < 3e15) return sig(m / 1.495978707e11) + ' AU';
  if (a < 3e19) return sig(m / 9.4607e15) + ' ly';
  return sig(m / 3.0857e19) + ' kpc';
}
export function fmtTime(s) {
  const a = Math.abs(s);
  if (a < 172800) return sig(s / 3600) + ' h';
  if (a < 6.3e7) return sig(s / 86400) + ' d';
  if (a < 3.2e13) return sig(s / 3.15576e7) + ' yr';
  return sig(s / 3.15576e13) + ' Myr';
}
export function fmtSpeed(ms) { return sig(ms / 1e3) + ' km/s'; }
function sig(x, d = 3) { if (!isFinite(x)) return '—'; if (x === 0) return '0'; const e = Math.floor(Math.log10(Math.abs(x))); return Math.abs(e) >= 6 ? x.toExponential(d - 1).replace('e+', '×10^').replace('e-', '×10^-') : Number(x.toPrecision(d)).toLocaleString('en-US', { maximumFractionDigits: Math.max(0, d - 1 - e) }); }

// ── start ───────────────────────────────────────────────────────────────────
export function startRun(choice) {
  const spec = specFor(choice);
  spec.debrisSize = spec.debrisSize ?? ((spec.particles && spec.particles.size) || 0.002 * spec.view.extent);
  if (S.lab) { S.lab.destroy(); S.lab = null; }
  S.lab = makeLab(S.dev, spec, S.code.nbody);
  S.spec = spec; S.choice = choice; S.key = spec.key;
  S.ren.setLab(S.lab.be);
  S.meta = (spec.bodies || []).map(metaOf);
  // row colours: the group of each initial particle; the pool starts dust
  const P = spec.self || spec.particles || { n: 0 };
  const cap = S.lab.be.cap, rows = new Uint32Array(cap), groups = (P.groups || []).map(g => pack(g.color));
  const dust = pack([0.8, 0.74, 0.66]);
  for (let i = 0; i < cap; i++) rows[i] = i < P.n ? (groups[P.group ? P.group[i] : 0] ?? dust) : dust;
  S.rows = rows;
  S.ren.setColors(0, rows);
  S.trails = S.meta.map(() => newTrail());
  S.sel = -1; S.follow = -1; S.events = []; S.slow = 1; S.thrown = 0; S.aim = null;
  S.tReal = 0; S.rand = rng(spec.seed ^ 0x1234);
  S.frame = S.lab.sys ? frameOf(S.lab.sys, spec.view, -1) : { c: [0, 0, 0], v: [0, 0, 0], th: 0, om: 0 };
  S.frameKey = '';
  emit('run', spec);
  return spec;
}
function metaOf(b, i) {
  return { name: b.name, kind: b.kind, id: KIND_ID[b.kind] ?? 1, color: b.color || [0.7, 0.7, 0.7], rDraw: b.rDraw || b.r || 0.01, r0: b.r || 0, m0: b.m, sheds: !!(b.sheds || (b.item && ITEM[b.item] && ITEM[b.item].sheds)), seed: ((i || 0) * 0.6180339 + (b.name || '').length * 0.137) % 1 };
}
function newTrail() { return { pts: new Float32Array(3 * TRAIL), n: 0, head: 0, last: null }; }

// ── step ────────────────────────────────────────────────────────────────────
export function stepRun(dtReal) {
  const lab = S.lab; if (!lab) return;
  const spec = S.spec;
  const sp = UI.paused ? 0 : SPEEDS[UI.speedI] * (S.saverSpeed ?? 1);
  const h = spec.rate * sp * S.slow * Math.min(dtReal, 1 / 20);
  if (h > 0) {
    const t0 = performance.now();
    const ev = lab.frame(h);
    const ms = performance.now() - t0;
    S.cpuMs = 0.9 * S.cpuMs + 0.1 * ms;
    // the CPU guard: the bodies' substeps are the cost that can explode
    if (ms > 18) S.slow = Math.max(0.03, S.slow * 0.75);
    else if (ms < 7 && S.slow < 1) S.slow = Math.min(1, S.slow * 1.04);
    if (ev.length) onEvents(ev);
    shed();
  }
  // the frame of this moment, and the trails in it
  if (lab.sys) {
    const key = S.follow + '|' + (spec.view.rotating || ''), old = S.frame;
    S.frame = frameOf(lab.sys, spec.view, S.follow);
    if (key !== S.frameKey) {
      // a new frame: the trails start again, and the camera eases from
      // the old centre to the new one
      if (S.frameKey && old) cam.target = toFrame(S.frame, toWorld(old, cam.target));
      S.frameKey = key; S.trails = S.meta.map(() => newTrail());
    }
    if (UI.trails && h > 0) pushTrails();
  }
}
function pushTrails() {
  const sys = S.lab.sys, f = S.frame, minD = S.spec.view.extent * 0.0025;
  for (let i = 0; i < sys.n; i++) {
    const T = S.trails[i]; if (!T || !sys.alive[i]) continue;
    const p = toFrame(f, sys.pos(i));
    if (T.last && Math.hypot(p[0] - T.last[0], p[1] - T.last[1], p[2] - T.last[2]) < minD) continue;
    T.pts.set(p, 3 * T.head); T.head = (T.head + 1) % TRAIL; T.n = Math.min(TRAIL, T.n + 1); T.last = p;
  }
}
// A comet sheds a few grains a frame near a star: they keep its orbit
// (a meteoroid stream; no radiation pressure here).
function shed() {
  const lab = S.lab, sys = lab.sys; if (!sys || !lab.pool) return;
  const ext = S.spec.view.extent;
  for (let i = 0; i < sys.n; i++) {
    const m = S.meta[i]; if (!m || !m.sheds || !sys.alive[i]) continue;
    const g = cometGlow(i); if (g < 0.15) continue;
    const k = 2, x = sys.pos(i), v = sys.vel(i), vs = 0.004 * v3.len(v3.sub(v, S.frame.v)) + 1e-12;
    const pos = new Float64Array(3 * k), vel = new Float64Array(3 * k), r = S.rand;
    for (let q = 0; q < k; q++) for (let c = 0; c < 3; c++) { pos[3 * q + c] = x[c] + (r() - 0.5) * 0.004 * ext; vel[3 * q + c] = v[c] + (r() - 0.5) * 2 * vs; }
    colorRows(lab._spawn({ n: k, pos, vel, size: S.spec.debrisSize * 0.8 }), [0.62, 0.85, 1.0]);
  }
}
function colorRows(ranges, rgb) {
  const u = pack(rgb);
  for (const [a, n] of ranges || []) { S.rows.fill(u, a, a + n); S.ren.setColors(a, S.rows.subarray(a, a + n)); }
}
// a comet's coma: strong near a star (the distance in view extents)
function cometGlow(i) {
  const sys = S.lab.sys, ext = S.spec.view.extent, x = sys.pos(i);
  let best = Infinity;
  for (let j = 0; j < sys.n; j++) if (j !== i && sys.alive[j] && S.meta[j] && S.meta[j].id === 0) best = Math.min(best, v3.len(v3.sub(sys.pos(j), x)));
  if (!isFinite(best)) return 0;
  return Math.min(1.5, 0.12 * ext / best);
}

// ── events ──────────────────────────────────────────────────────────────────
function onEvents(ev) {
  const sys = S.lab.sys, now = performance.now();
  for (const e of ev) {
    if (e.rows) {
      const src = e.type === 'breakup' ? S.meta[e.i] : S.meta[e.i];
      const c = src ? src.color : [0.8, 0.7, 0.6];
      colorRows(e.rows, e.type === 'merge' ? [Math.min(1, c[0] * 0.6 + 0.5), c[1] * 0.6 + 0.2, c[2] * 0.4 + 0.08] : c);
    }
    const pos = e.pos || (e.j !== undefined && sys.alive[e.j] ? sys.pos(e.j) : e.i !== undefined ? sys.pos(e.i) : null);
    const d = { e, at: now, t: e.type, pos, text: describe(e) };
    S.events.push(d); if (S.events.length > 40) S.events.shift();
    emit('event', d);
  }
}
export function describe(e) {
  const sp = S.spec, U = sp.scale || { L: 1, V: 1, T: 1 }, nm = i => (S.meta[i] && S.meta[i].name) || 'body ' + i;
  switch (e.type) {
    case 'merge': return `${cap(e.names ? e.names[1] : nm(e.j))} hits ${e.names ? e.names[0] : nm(e.i)} at ${fmtSpeed(e.v * U.V)}`;
    case 'breakup': return `${cap(e.name)} breaks up inside the Roche limit of ${e.parent}`;
    case 'hit': return `${cap(nm(e.i))} hits ${nm(e.j)} at ${fmtSpeed(e.v * U.V)}`;
    case 'capture': return `${cap(nm(e.j))} is now bound to ${nm(e.i)}`;
    case 'release': return `${cap(nm(e.j))} breaks free of ${nm(e.i)}`;
    case 'ejection': return `${cap(e.name)} leaves the system at ${fmtSpeed(e.vinf * U.V)}`;
    case 'periapsis': return `${cap(nm(e.j))} at closest approach to ${nm(e.i)}: ${fmtLen(e.d * U.L)}`;
    case 'burn': return e.label ? cap(e.label) : `${cap(nm(e.i))} fires its engine`;
    default: return e.type;
  }
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

// ── the tray ────────────────────────────────────────────────────────────────
// x, v: world. Returns a short text for the HUD, or null when refused.
export function throwItem(key, x, v) {
  const lab = S.lab, it = ITEM[key];
  if (!lab || !lab.sys || S.spec.self || !it) return null;
  const sys = lab.sys, ext = S.spec.view.extent;
  if (it.parts) {
    const dom = dominant(sys);
    const sw = swarm(key, x, v, ext, dom ? dom.v : [0, 0, 0], (S.thrown + 1) * 7919 + (S.spec.seed || 1), Math.max(64, Math.floor(lab.pool * 0.7)));
    colorRows(lab._spawn(sw), it.color);
    S.thrown++;
    return `${it.name}: ${sw.n.toLocaleString('en-US')} particles`;
  }
  if (sys.n >= MAXB) return null;
  const count = S.meta.filter(m => m.item === key).length + 1;
  const b = makeItem(key, sys, x, v, ext, count);
  const dom = dominant(sys);
  const watch = dom ? [[dom.i, sys.n]] : [];
  lab.sys = extendSystem(sys, [b], watch);
  lab.nb = lab._nb();
  const m = metaOf(b, sys.n); m.item = key;
  S.meta.push(m); S.trails.push(newTrail());
  S.thrown++;
  return b.name;
}

// ── renderer buffers ────────────────────────────────────────────────────────
const bodyF = new Float32Array(32 * BODY_FLOATS);
export function bodyInstances() {
  const sys = S.lab && S.lab.sys; if (!sys) return 0;
  const f = S.frame;
  for (let i = 0; i < sys.n; i++) {
    const o = i * BODY_FLOATS, m = S.meta[i];
    if (!sys.alive[i] || !m) { bodyF.fill(0, o, o + BODY_FLOATS); bodyF[o + 7] = -1; continue; }
    const p = toFrame(f, sys.pos(i));
    const grow = m.r0 > 0 ? sys.R[i] / m.r0 : (m.m0 > 0 ? Math.cbrt(sys.m[i] / m.m0) : 1);
    bodyF[o] = p[0]; bodyF[o + 1] = p[1]; bodyF[o + 2] = p[2]; bodyF[o + 3] = m.rDraw * (isFinite(grow) && grow > 0 ? grow : 1);
    bodyF[o + 4] = m.color[0]; bodyF[o + 5] = m.color[1]; bodyF[o + 6] = m.color[2]; bodyF[o + 7] = m.id;
    bodyF[o + 8] = m.seed; bodyF[o + 9] = i === S.sel ? 1 : 0; bodyF[o + 10] = m.id === 5 ? cometGlow(i) : 0; bodyF[o + 11] = 0;
  }
  return { f: bodyF, n: sys.n };
}
// up to two lights: the brightest stars (L ~ m^3.5), else a distant sun
export function lights() {
  const sys = S.lab && S.lab.sys, f = S.frame, out = [];
  if (sys) {
    const st = [];
    for (let i = 0; i < sys.n; i++) if (sys.alive[i] && S.meta[i] && (S.meta[i].id === 0 || S.meta[i].id === 7)) st.push([i, sys.m[i] ** 3.5]);
    st.sort((a, b) => b[1] - a[1]);
    st.slice(0, 2).forEach(([i, L], k) => {
      const c = S.meta[i].color, mx = Math.max(c[0], c[1], c[2]) || 1;
      out.push({ pos: toFrame(f, sys.pos(i)), point: true, color: [c[0] / mx, c[1] / mx, c[2] / mx], I: k === 0 ? 1.5 : Math.max(0.25, Math.min(1.2, 1.5 * L / st[0][1])) });
    });
  }
  if (!out.length) out.push({ pos: dirToFrame(f || { th: 0 }, [0.62, -0.55, 0.42]), point: false, color: [1, 0.96, 0.9], I: 1.4 });
  return out;
}
// Trails, then extra segments (the throw preview: pointer.js S.aim).
let segF = new Float32Array(4096 * SEG_FLOATS);
export function segments(dpr) {
  let n = 0;
  const need = k => { if ((n + k) * SEG_FLOATS > segF.length) { const g = new Float32Array(Math.max(segF.length * 2, (n + k) * SEG_FLOATS)); g.set(segF); segF = g; } };
  const seg = (a, b, w, c, aa, ab) => { const o = n * SEG_FLOATS; segF[o] = a[0]; segF[o + 1] = a[1]; segF[o + 2] = a[2]; segF[o + 3] = w; segF[o + 4] = b[0]; segF[o + 5] = b[1]; segF[o + 6] = b[2]; segF[o + 7] = ab; segF[o + 8] = c[0]; segF[o + 9] = c[1]; segF[o + 10] = c[2]; segF[o + 11] = aa; n++; };
  const sys = S.lab && S.lab.sys;
  if (sys && UI.trails) {
    for (let i = 0; i < S.trails.length; i++) {
      const T = S.trails[i], m = S.meta[i]; if (!T || T.n < 2 || !m) continue;
      need(T.n);
      const c = m.id === 8 ? [0.75, 0.7, 0.65] : [0.35 + 0.65 * m.color[0], 0.35 + 0.65 * m.color[1], 0.35 + 0.65 * m.color[2]];
      const w = (m.id === 6 ? 1.2 : 1.6) * dpr, a0 = sys.alive[i] ? 0.75 : 0.35;
      for (let k = 1; k < T.n; k++) {
        const ia = (T.head - T.n + k - 1 + TRAIL) % TRAIL, ib = (ia + 1) % TRAIL;
        const fa = (k - 1) / T.n, fb = k / T.n;
        seg([T.pts[3 * ia], T.pts[3 * ia + 1], T.pts[3 * ia + 2]], [T.pts[3 * ib], T.pts[3 * ib + 1], T.pts[3 * ib + 2]], w, c, a0 * fa * fa, a0 * fb * fb);
      }
    }
  }
  const A = S.aim;
  if (A && A.path && A.path.length > 1) {
    need(A.path.length + 4);
    const c = A.end ? [1.0, 0.45, 0.35] : [1.0, 0.78, 0.45];
    for (let k = 1; k < A.path.length; k++) {
      const on = (k >> 1) % 2 === 0;   // dashes
      if (on) seg(A.path[k - 1], A.path[k], 1.8 * dpr, c, 0.9 * (1 - k / A.path.length * 0.6), 0.9 * (1 - (k + 1) / A.path.length * 0.6));
    }
  }
  if (A && A.from && A.to) { need(2); seg(A.from, A.to, 2.4 * dpr, [1.0, 0.86, 0.6], 0.95, 0.95); }
  return { f: segF, n };
}
