// ============================================================================
//  ROCHE LIMIT  ·  app/runs.js — start a run: build, settle and place the moons
// ----------------------------------------------------------------------------
//  startRun() makes one SimGPU per moon and gets a cloud from the
//  worker or a settled pile from pileCache. settleStep() lets the cloud
//  fall together; placeSats() puts the pile on its start orbit.
//  RANDOM RUNS (roll.js; UI.roll holds the spec, 2026-10-11). A roll can
//  have a layout (initial.js): the settled pile is cut into a binary, a
//  train, two moons or two lobes, and gets a spin and a tilted or
//  elliptic orbit. A core layout makes the inner grains denser before
//  the settle (the pile cache key holds the core). The primary's radius
//  in world units is spec.bodyR (1 for the first scenarios): s.pl.Rp is
//  the true radius in sim units (the GPU uses it for hits and J2), s.Rp
//  stays the world unit. placeSats uploads the grains after planShots has
//  turned the start orbit, so a layout keeps its place along the orbit.
//
//  grep -n targets
//    start a run ........... "async function startRun"
//    settle ................ "function settleStep"
//    orbit start ........... "async function placeSats"
//    start orbit ........... "function prepareOrbit", "function orbitFor"
//    time to pericentre .... "function timeToPeri"
//    Roche limits .......... "function limitsFor"
//    roll start state ...... "function startState"
// ============================================================================
import * as P from '../physics.js';
import { SimGPU } from '../engine.js';
import { MAT_COLOR } from '../plots.js';
import { SETTLE_TIME, DESKTOP, PHONE, directed, newPace } from '../pacing.js';
import { SCENARIOS, specFor, flybyStart, limitsOf } from '../scenarios.js';
import { buildStart, coreMasses, orbitStart3 } from '../initial.js';
import { rng as rollRng } from '../roll.js';
import { UI, Q, $, G_SI, PHONE_Q, COARSE } from './env.js';
import { workerCall } from './jobs.js';
import { refreshReadout } from './readout.js';
import { S, pileCache } from './state.js';
import { syncStory } from './story.js';
import { planShots } from './director.js';

export function currentSpec() {
  // a random run or a preset: its own spec (the Advanced settings are for
  // the stories); a copy, so a run never changes UI.roll
  if (UI.roll) return JSON.parse(JSON.stringify(UI.roll));
  const sc = SCENARIOS.find(s => s.key === UI.scen);
  const ui = { q: Math.pow(10, UI.qLog), material: UI.material, J2: UI.J2, d: UI.d, peri: UI.peri, e: UI.e, mu: UI.mu, coh: UI.coh, body: UI.body };
  const spec = specFor(sc, ui);
  spec.scen = sc;
  return spec;
}
function matFor(name, spec, custom) {
  const m = Object.assign({}, P.MATERIALS[name]);
  if (custom) { if (spec.mu !== undefined) m.mu = spec.mu; if (spec.coh !== undefined) m.coh = spec.coh; m.muR = m.mu > 0 ? P.MATERIALS.rigid.muR : 0; }
  return m;
}

export async function startRun(specIn) {
  const serial = ++S.runSerial;
  const spec = specIn || currentSpec();
  const sc = spec.scen || SCENARIOS.find(s => s.key === spec.key);
  if (S.run) { for (const s of S.run.sats) s.gpu.destroy(); S.ren.removeSims(); }
  const two = spec.kind === 'compare';
  // Auto quality: when the governor has already gone down to its floor
  // (60% render scale, no bloom), the next run takes half the grains
  if (UI.quality === 'auto' && Q.scale <= 0.65 && !Q.bloom && UI.N > 4096) { UI.N = UI.N / 2; $('nSel').value = UI.N; Q.note = 'fewer grains for speed'; }
  let N = UI.N;
  if (sc && sc.nScale) N = Math.max(4096, Math.round(N * sc.nScale / 1024) * 1024);
  if (S.saverOn) N = Math.min(N, 8192);
  const nEach = two ? Math.max(4096, N / 2) : N;
  const mats = two ? spec.materials : [spec.material];
  S.run = { serial, spec, sats: [], phase: 'init', t: 0, T0: 1, frames: 0, started: performance.now(), recorded: false, track: [],
    snaps: [], viewIdx: -1, epoch: 0, stepLeft: 0, rate: 0, story: { approach: 0 }, storyKey: 'approach' };
  for (let k = 0; k < mats.length; k++) {
    const mat = matFor(mats[k], spec, !two);
    const C = P.contactParams(nEach, mat);
    const gpu = new SimGPU(S.dev, nEach, S.simCode);
    const e = S.ren.addSim(gpu);
    S.run.sats.push({ idx: k, matName: mats[k], mat, C, gpu, e, N: nEach, color: MAT_COLOR[mats[k]] || '#d8dfe8', hist: [], ehist: [], an: null, E0: null, L0: null, frag: [], phase: two ? k * Math.PI : 0 });
  }
  setBusy(true, 'Building the moon', 0);
  syncStory(true);
  // the cloud or the cached pile
  const core = spec.layout && spec.layout.type === 'core' ? spec.layout : null;
  for (const s of S.run.sats) {
    const key = `${s.N}|${s.matName}|${s.mat.mu}|${s.mat.coh}${core ? `|core${core.frac.toFixed(3)}x${core.factor.toFixed(3)}` : ''}`;
    s.cacheKey = key;
    if (pileCache.has(key)) { s.pile = pileCache.get(key); continue; }
    const cl = await workerCall({ type: 'cloud', N: s.N, seed: 3 + s.idx });
    if (serial !== S.runSerial) return;
    // a dense core: the inner grains get more mass before the settle
    if (core) coreMasses(cl.pos, cl.mass, core.frac, core.factor);
    s.cloud = cl;
  }
  if (serial !== S.runSerial) return;
  // planet (R_p from the expected pile radius, so the scale does not jump)
  for (const s of S.run.sats) { s.Rp = s.C.Rs / spec.s; s.k = 1 / s.Rp; }
  // settle each moon that has no cached pile
  for (const s of S.run.sats) {
    if (s.pile) continue;
    const z = new Float64Array(s.N * 3);
    s.gpu.setParams(s.C, { GM: 0, Rp: 1 }, 1.5);
    s.gpu.ref = null;
    s.gpu.setState(s.cloud.pos, z, z, s.cloud.rad, s.cloud.mass);
    s.gpu.prime();
    s.settleBlocks = Math.ceil(SETTLE_TIME / (s.C.dt * s.gpu.K));
    s.settleDone = 0;
    s.rad = s.cloud.rad; s.mass = s.cloud.mass;
  }
  // start positions for the display during the settle
  prepareOrbit();
  S.run.limits = limitsFor(spec);
  S.run.viewD = viewDistance(spec, S.run.limits);
  if (S.run.sats.every(s => s.pile)) await placeSats(serial);
  else if (serial === S.runSerial) {
    // the settle has no story to show: give it a large step budget at
    // once; the GPU-time governor (loop.js) cuts it on a slow GPU
    S.run.phase = 'settle';
    S.stepsMax = Math.max(S.stepsMax, 32 * ((PHONE_Q.matches || COARSE) ? PHONE : DESKTOP).settleBlocks);
  }
}
// The distance (planet radii) the planet view frames: the start orbit or
// the closest pass, and the rings of Saturn, fixed for the whole run so
// the view never zooms on its own.
function viewDistance(spec, L) {
  if (spec.kind === 'flyby') return Math.max(spec.peri + 1.3, 2.4);
  return Math.min(7, Math.max(spec.d || 2, spec.rings ? 2.3 : 0, 1.6));
}
// Planet and start orbit for each moon (from the spec; the pile stats
// replace the expected density once the pile is settled).
function prepareOrbit() {
  const spec = S.run.spec, u = spec.bodyR || 1;
  for (const s of S.run.sats) {
    const rhoS = s.pile ? s.pile.st.rho : P.RHO_GRAIN * P.PHI0;
    const rhoP = spec.q * rhoS;
    const GM = P.G * rhoP * 4 / 3 * Math.PI * s.Rp ** 3;
    // Rp: the true radius (hits, J2); the world unit stays s.Rp
    s.pl = { Rp: s.Rp * u, rhoP, rhoS, GM, Mp: GM, J2: spec.J2 || 0, drag: 0 };
    const o = orbitFor(spec, s.pl, s.Rp);
    // compare: the second moon half an orbit ahead
    if (s.phase) { const c = Math.cos(s.phase), sn = Math.sin(s.phase); o.X = [c * o.X[0] - sn * o.X[1], sn * o.X[0] + c * o.X[1], 0]; o.V = [c * o.V[0] - sn * o.V[1], sn * o.V[0] + c * o.V[1], 0]; }
    s.o = o;
    s.ref = new P.RefOrbit(s.pl, o.X, o.V);
  }
}
function orbitFor(spec, pl, Rw = pl.Rp) {
  if (spec.roll) {
    // the planet in world units: J2 (R_true / R_world)^2 gives the same pull
    const u = spec.bodyR || 1, Pw = { GM: pl.GM, Rp: Rw, J2: (pl.J2 || 0) * u * u };
    const o = orbitStart3(Pw, { kind: spec.kind === 'flyby' ? 'flyby' : 'circular', d: spec.d, peri: spec.peri, e: spec.e, r0: spec.r0 ?? flybyStart(spec), inc: spec.inc || 0 });
    return { X: o.X, V: o.V, Omega: o.Omega };
  }
  if (spec.kind === 'flyby') return P.orbitStart(pl, { kind: 'flyby', peri: spec.peri, e: spec.e, r0: flybyStart(spec) });
  return P.orbitStart(pl, { kind: 'circular', d: spec.d });
}
export function settleStep(budgetBlocks) {
  let all = true, done = 0, total = 0;
  const enc = S.dev.createCommandEncoder();
  for (const s of S.run.sats) {
    if (s.pile) continue;
    const left = s.settleBlocks - s.settleDone;
    if (left > 0) {
      const n = Math.min(left, budgetBlocks);
      const dragOff = s.settleDone + n > 0.8 * s.settleBlocks && s.settleDone <= 0.8 * s.settleBlocks;
      s.gpu.encode(enc, n, false);
      s.settleDone += n;
      if (dragOff) s.gpu.setParams(s.C, { GM: 0, Rp: 1 }, 0);
      all = all && s.settleDone >= s.settleBlocks;
    }
    done += Math.min(s.settleDone, s.settleBlocks); total += s.settleBlocks;
  }
  S.dev.queue.submit([enc.finish()]);
  setBusy(true, 'Letting the rubble settle under its own gravity', total ? done / total : 1);
  return all;
}
export async function placeSats(serial) {
  S.run.phase = 'placing';
  for (const s of S.run.sats) {
    if (!s.pile) {
      const rb = await s.gpu.readback();
      if (serial !== S.runSerial) return;
      const N = s.N, pos = new Float64Array(N * 3);
      for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] = rb.body[12 * i + k];
      const st = P.pileStats(pos, s.mass);
      for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] -= st.com[k];
      s.pile = { pos, st: P.pileStats(pos, s.mass), rad: Float64Array.from(s.rad), mass: Float64Array.from(s.mass) };
      pileCache.set(s.cacheKey, s.pile);
    }
  }
  prepareOrbit();
  for (const s of S.run.sats) {
    s.rad = s.pile.rad; s.mass = s.pile.mass; s.M0 = s.pile.st.M; s.Rs = s.pile.st.R; s.M0rule = 'total'; s.M0set = false;
    s.gpu.setParams(s.C, s.pl, 0);
    s.gpu.ref = s.ref; s.gpu.t = 0;
    s.hist = [[0, 1]]; s.ehist = []; s.an = null; s.E0 = null; s.L0 = null; s.frag = [];
  }
  const s0 = S.run.sats[0], spec = S.run.spec;
  // the time unit: one orbit (circular, spiral: the start orbit) or the
  // period of a circular orbit at the pericentre (flyby)
  const a0 = spec.kind === 'flyby' ? spec.peri * s0.Rp : spec.d * s0.Rp;
  S.run.T0 = P.orbitalPeriod(s0.pl.GM, a0);
  if (spec.kind === 'spiral') {
    const d0 = spec.d, d1 = spec.d1, Tm = P.orbitalPeriod(s0.pl.GM, Math.sqrt(d0 * d1) * s0.Rp);
    const kappa = Math.log(d0 / d1) / (2 * spec.orbits * Tm);
    for (const s of S.run.sats) { s.pl.drag = kappa; s.gpu.setParams(s.C, s.pl, 0); }
  }
  if (spec.kind === 'flyby') {
    // time from the start to the pericentre, by the Kepler equation
    const el = P.keplerElements(s0.o.X, s0.o.V, s0.pl.GM);
    S.run.tPeri = timeToPeri(s0.o.X, s0.o.V, s0.pl.GM, el);
  }
  const rhoReal = spec.rhoS || 1.0;
  S.run.tUnitSec = Math.sqrt(s0.pile.st.rho / (G_SI * rhoReal * 1000));
  S.run.heatRef = 0.006 * s0.C.vesc * s0.C.vesc;
  S.run.pace = directed(spec.kind) ? newPace() : null;
  // the story camera turns the start orbit about the planet's axis (no
  // change to the physics); the first forces are then found again
  planShots(S.saverOn && S.saver && S.saver.cur ? { az: S.saver.cur.az } : {});
  // the grains go up after the turn of the start orbit
  for (const s of S.run.sats) {
    const b = startState(s, spec);
    s.gpu.setState(b.pos, b.vel, b.spin, s.rad, s.mass);
    s.gpu.prime();
    S.ren.setTags(s.e, new Float32Array(s.gpu.np).fill(1));
    s.e.fresh = true;
  }
  S.run.phase = 'orbit'; S.run.t = 0; S.run.recorded = false; S.run.track = [];
  S.run.lastRead = 0;
  setBusy(false);
  syncStory();
  refreshReadout(true);
}
// The start state of one moon's grains (relative to the frame point). The
// first scenarios: the settled pile with a synchronous spin about z
// (physics.js placeOnOrbit). A roll: initial.js buildStart on the turned
// orbit, with the roll's seed; it sets s.rad and s.mass (the parts take
// the grains in a new order), s.M0, s.Rs (the largest part) and s.parts.
function startState(s, spec) {
  const N = s.N;
  if (!spec.roll) {
    const pos = Float64Array.from(s.pile.pos), vel = new Float64Array(N * 3), spin = new Float64Array(N * 3);
    P.placeOnOrbit(pos, vel, spin, s.mass, s.o.Omega);
    return { pos, vel, spin };
  }
  const u = spec.bodyR || 1, X = s.o.X, V = s.o.V;
  const h = [X[1] * V[2] - X[2] * V[1], X[2] * V[0] - X[0] * V[2], X[0] * V[1] - X[1] * V[0]], hl = Math.hypot(...h), r2 = X[0] ** 2 + X[1] ** 2 + X[2] ** 2;
  const orb = { X, V, Omega: hl / r2, n: h.map(q => q / hl), P: { GM: s.pl.GM, Rp: s.Rp, J2: (s.pl.J2 || 0) * u * u } };
  const b = buildStart(s.pile, spec, orb, rollRng((spec.seed || 7) + 31 * s.idx));
  s.rad = b.rad; s.mass = b.mass; s.parts = b.parts;
  s.Rs = Math.max(...b.parts.map(p => p.R));
  // the bound share is of the whole body, or (a train, two moons) of the
  // largest piece at the first analysis
  s.M0rule = spec.layout && (spec.layout.type === 'train' || spec.layout.type === 'two') ? 'first' : 'total';
  s.M0 = b.mass.reduce((a, q) => a + q, 0); s.Mtot = s.M0;
  return b;
}
function timeToPeri(X, V, GM, el) {
  const r = Math.hypot(...X), e = el.e;
  const rv = X[0] * V[0] + X[1] * V[1] + X[2] * V[2];
  if (Math.abs(e - 1) < 1e-6) {
    const q = el.p / 2, D = Math.sign(rv) * Math.sqrt(Math.max(0, r / q - 1));
    return -Math.sqrt(2 * q ** 3 / GM) * (D + D ** 3 / 3);
  }
  if (e < 1) {
    const a = el.a, n = Math.sqrt(GM / a ** 3);
    let E = Math.acos(Math.max(-1, Math.min(1, (1 - r / a) / e))); if (rv < 0) E = -E;
    let M = E - e * Math.sin(E); if (M > 0) M -= 2 * Math.PI;
    return -M / n;
  }
  const a = -el.a, n = Math.sqrt(GM / a ** 3);
  let H = Math.acosh(Math.max(1, (1 + r / a) / e)); if (rv < 0) H = -H;
  return -(e * Math.sinh(H) - H) / n;
}
export function limitsFor(spec) { return limitsOf(spec.q); }
function setBusy(on, text, frac = 0) {
  $('busy').classList.toggle('off', !on);
  if (on) { $('busyT').textContent = text; $('busyBar').style.width = (100 * frac).toFixed(0) + '%'; }
}
