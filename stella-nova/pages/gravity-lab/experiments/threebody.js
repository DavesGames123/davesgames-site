// ============================================================================
//  GRAVITY LAB  ·  experiments/threebody.js — three bodies
// ----------------------------------------------------------------------------
//  choreography  periodic three-body orbits: the figure-eight
//                (Chenciner-Montgomery) and the butterfly, moth, yin-yang
//                and goggles families (Suvakov-Dmitrasinovic 2013); each
//                star carries a halo of dust that the dance strips away
//  pythagorean   Burrau's problem: masses 3, 4, 5 at rest at the corners
//                of a 3-4-5 triangle; after close passes the 3 escapes
//  sitnikov      a test particle on the axis of an eccentric binary:
//                neighbours that start a hair apart part ways (chaos)
//  kozai         an outer star tilted past 39.2° swaps a planet's
//                inclination for eccentricity (Kozai-Lidov cycles)
//  triton        Neptune pulls apart a binary and keeps one member on a
//                backward orbit: how Triton may have been captured
// ============================================================================
import { C, BODY, unitsOf } from '../data.js';
import { body, orbiting, Parts, disk, halo, COLORS, DEG, rng, gauss, v3, elementsToState, toCOM, period, runCpu, fmt } from './common.js';
import { closeFocus } from './focus.js';
import { System } from '../nbody.js';

const MS = C.MSUN, AU = C.AU;
const STAR3 = [COLORS.amber, COLORS.cyan, COLORS.rose];

// ── choreographies ──────────────────────────────────────────────────────────
// x1 = (-1, 0), x2 = (1, 0), x3 = (0, 0); v1 = v2 = (p1, p2), v3 = -2 v1;
// m = 1, G = 1 (sd13 table I). The figure-eight in this form: sd13 too.
const CHOREO = {
  'figure-eight': { p: [0.347111, 0.532728], T: 6.324449 },
  butterfly: { p: [0.306893, 0.125507], T: 6.235641 },
  moth: { p: [0.464445, 0.396060], T: 14.893911 },
  'yin-yang': { p: [0.513938, 0.304736], T: 17.328370 },
  goggles: { p: [0.083300, 0.127889], T: 10.466818 },
};
export const choreography = {
  key: 'choreography', title: 'Three-body choreographies', group: 'three-body', variants: Object.keys(CHOREO),
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, keys = Object.keys(CHOREO);
    const variant = o.variant || (r() < 0.4 ? 'figure-eight' : keys[Math.floor(r() * keys.length)]);
    const c = CHOREO[variant], [p1, p2] = c.p;
    const kick = o.perturb ?? (r() < 0.3 ? 1e-3 : 0);
    const B = [[-1, 0, 0], [1, 0, 0], [0, 0, 0]].map((x, i) => {
      const v = i < 2 ? [p1, p2, 0] : [-2 * p1, -2 * p2, 0];
      return body(['A', 'B', 'C'][i] + ' star', 'star', 1, 0.004, x, i === 0 ? [v[0] * (1 + kick), v[1], 0] : v, { rDraw: 0.035, color: STAR3[i], merge: false, epsP: 0.004 });
    });
    toCOM(B);
    const P = new Parts();
    B.forEach((b, i) => { const g = P.g(b.name + ' halo', STAR3[i]); halo(P, b, { n: Math.floor(n / 3), rin: 0.06, rout: 0.22, prograde: 1, spread: 0.25, g, rand: r }); });
    return {
      key: 'choreography', title: variant === 'figure-eight' ? 'The figure-eight' : 'Three-body ' + variant, variant, seed,
      blurb: kick ? 'A periodic three-body dance, nudged by one part in a thousand: watch it fall apart.' : 'Three equal stars chase each other round one closed path. Their halos of dust are stripped into the shape of the dance.',
      scale: unitsOf(AU, MS, { L: 'L', M: 'M', T: 'T' }), bodies: B, opts: { eta: 0.005, maxSub: 20000 },
      particles: P.done(0.0025), pool: 0, period: c.T, kick,
      dt: 0.0008, rate: c.T / 6, duration: 3 * c.T,
      view: { center: 'com', extent: 1.6, tilt: 60 },
      cues: [],
      tex: ['\\ddot{\\vec r}_i = \\sum_{j \\ne i} \\frac{G m (\\vec r_j - \\vec r_i)}{|\\vec r_j - \\vec r_i|^3}', `T = ${c.T}`],
      facts: [['start', 'x = (∓1, 0), (0, 0)'], ['p1, p2', `${p1}, ${p2}`], ['period T', String(c.T)], ['nudge', kick ? '1 × 10^-3 in one velocity' : 'none']],
      notes: ['G = m = 1 units, as in the source.', 'The dust is massless.'],
      sources: variant === 'figure-eight' ? ['cm00', 'sd13'] : ['sd13'],
    };
  },
  test: { n: 30 },
  check(spec) {
    if (spec.kick) return { pass: true, info: 'nudged variant: no return expected' };
    const sys = new System(spec.bodies, spec.opts), x0 = Array.from(sys.x);
    sys.advance(spec.period, 50);
    let d = 0; for (let k = 0; k < 9; k++) d = Math.max(d, Math.abs(sys.x[k] - x0[k]));
    return { pass: d < 2e-3, info: `max |x(T) - x(0)| ${d.toExponential(2)} after T = ${spec.period}` };
  },
};

// ── Burrau's problem ────────────────────────────────────────────────────────
export const pythagorean = {
  key: 'pythagorean', title: "Burrau's three-body problem", group: 'three-body', variants: ['burrau', 'free-fall'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.6 ? 'burrau' : 'free-fall');
    let ms, xs;
    if (variant === 'burrau') { ms = [3, 4, 5]; xs = [[1, 3, 0], [-2, -1, 0], [1, -1, 0]]; }
    else {
      ms = [1 + 4 * r(), 1 + 4 * r(), 1 + 4 * r()];
      xs = [0, 1, 2].map(k => { const a = 2 * Math.PI * k / 3 + 0.5 * gauss(r), d = 2 + 1.5 * r(); return [d * Math.cos(a), d * Math.sin(a), 0.2 * gauss(r)]; });
    }
    const B = ms.map((m, i) => body(`${fmt.sig(m, 2)} M star`, 'star', m, 0.004, xs[i], [0, 0, 0], { rDraw: 0.05 * Math.cbrt(m), color: STAR3[i], merge: false, epsP: 0.004 }));
    toCOM(B);
    const P = new Parts();
    B.forEach((b, i) => { const g = P.g(b.name + ' disk', STAR3[i]); disk(P, b, { n: Math.floor(n / 3), rin: 0.08, rout: 0.35, h: 0.02, g, rand: r, normal: [0.2 * gauss(r), 0.2 * gauss(r), 1] }); });
    return {
      key: 'pythagorean', title: variant === 'burrau' ? "Burrau's problem: 3, 4, 5" : 'Three stars from rest', variant, seed,
      blurb: variant === 'burrau' ? 'Masses 3, 4 and 5 start at rest on a 3-4-5 triangle. After a long chaotic dance the lightest star is thrown out and the other two leave as a tight pair.' : 'Three stars start at rest and fall together. The dance almost always ends with one star thrown out.',
      scale: unitsOf(AU, MS, { L: 'L', M: 'M', T: 'T' }), bodies: B, opts: { eta: 0.01, maxSub: 200000, escapeR: 12 },
      particles: P.done(0.006), pool: 0,
      dt: 0.0015, rate: 4, duration: 75,
      view: { center: 'com', extent: 4.5, tilt: 55 },
      cues: ['ejection'],
      tex: ['E = \\sum_i \\tfrac12 m_i v_i^2 - \\sum_{i<j} \\frac{G m_i m_j}{r_{ij}} < 0', variant === 'burrau' ? 'm = 3, 4, 5;\\ \\ \\vec v(0) = 0' : '\\vec v(0) = 0'],
      facts: [['masses', ms.map(m => fmt.sig(m, 3)).join(', ')], ['first solved', 'Szebehely & Peters 1967 (Burrau 1913)'], ['outcome (3, 4, 5)', 'the 3 escapes near t = 60; 4 + 5 a binary, e ≈ 0.99']],
      notes: ['G = 1 units. The stars are points (no merging).', 'The disk dust is massless.'],
      sources: ['sp67'],
    };
  },
  focus: closeFocus,
  test: { n: 60 },
  check(spec) {
    const sys = new System(spec.bodies, spec.opts);
    let ej = null;
    for (let k = 0; k < 800 && !ej; k++) { sys.advance(0.1, 1); ej = sys.drain().find(e => e.type === 'ejection'); }
    if (spec.variant === 'burrau') return { pass: !!ej && ej.i === 0 && ej.t > 45 && ej.t < 80, info: ej ? `ejection of the mass-${fmt.sig(spec.bodies[ej.i].m)} star at t = ${fmt.sig(ej.t)}, v_inf ${fmt.sig(ej.vinf)}` : 'no ejection by t = 80' };
    return { pass: true, info: ej ? `ejection of star ${ej.i} at t = ${fmt.sig(ej.t)}` : 'no ejection by t = 80 (allowed for random starts)' };
  },
};

// ── the Sitnikov problem ────────────────────────────────────────────────────
export const sitnikov = {
  key: 'sitnikov', title: 'Chaos on a line (Sitnikov)', group: 'three-body', variants: ['eccentric', 'circular'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.8 ? 'eccentric' : 'circular');
    const e = variant === 'circular' ? 0 : 0.1 + 0.5 * r();
    // two stars of mass 1/2 on an orbit of a = 1 (each 1/2 from the centre)
    const s = elementsToState(1, { a: 1, e, f: 0 });
    const B = [body('star A', 'star', 0.5, 0.02, v3.mul(s.r, -0.5), v3.mul(s.v, -0.5), { rDraw: 0.06, color: COLORS.amber }),
      body('star B', 'star', 0.5, 0.02, v3.mul(s.r, 0.5), v3.mul(s.v, 0.5), { rDraw: 0.06, color: COLORS.cyan })];
    const P = new Parts(), groups = 6, per = Math.floor(n / groups), z0 = 0.4 + 0.8 * r();
    const cols = [COLORS.rose, COLORS.amber, COLORS.green, COLORS.cyan, COLORS.violet, COLORS.dust];
    for (let gq = 0; gq < groups; gq++) {
      const g = P.g('z0 ' + fmt.sig(z0 + 0.15 * gq, 3), cols[gq]);
      for (let q = 0; q < per; q++) P.add([0, 0, z0 + 0.15 * gq + 1e-4 * q / per], [0, 0, 0], g);
    }
    return {
      key: 'sitnikov', title: 'Chaos on a line', variant, seed,
      blurb: e ? 'Dust on the axis of a pair of stars bobs up and down. Grains that start a hair apart soon part ways: chaos.' : 'With a circular pair the motion on the axis is regular: neighbours stay together.',
      scale: unitsOf(AU, MS, { L: 'a', M: 'M', T: 'T' }), bodies: B, opts: { eta: 0.02 },
      particles: P.done(0.006), pool: 0, e, z0,
      dt: 0.004, rate: 2 * Math.PI / 3, duration: 2 * Math.PI * 30,
      view: { center: 'com', extent: 2.5, tilt: 15 },
      cues: [],
      tex: ['\\ddot z = -\\frac{z}{\\left(z^2 + r(t)^2\\right)^{3/2}}', 'r(t) = \\tfrac12\\,(1 - e\\cos E(t))'],
      facts: [['binary eccentricity', fmt.sig(e, 3)], ['spread of each group at start', '10^-4']],
      notes: ['The dust is massless and starts at rest on the axis.'],
      sources: ['sitnikov'],
    };
  },
  test: { n: 120 },
  check(spec) {
    if (spec.variant !== 'circular') {
      // small oscillations in a circular pair: omega^2 = 8 (r = 1/2, M = 1)
      const sp = this.build(spec.seed, { n: 60, variant: 'circular' });
      sp.particles.pos[2] = 0.01;
      const zs = [];
      runCpu(sp, 2 * 2.2214, 400, (lab, rb) => zs.push(rb.body[2]));
      // upward zero crossings, interpolated
      const ups = [], h = 2 * 2.2214 / 400;
      for (let k = 1; k < zs.length; k++) if (zs[k - 1] < 0 && zs[k] >= 0) ups.push((k - 1 + zs[k - 1] / (zs[k - 1] - zs[k])) * h);
      const T = ups.length > 1 ? ups[1] - ups[0] : NaN;
      return { pass: Math.abs(T / (2 * Math.PI / Math.sqrt(8)) - 1) < 0.02, info: `small-oscillation period ${fmt.sig(T, 4)} against 2 pi / sqrt(8) = ${fmt.sig(2 * Math.PI / Math.sqrt(8), 4)}` };
    }
    return { pass: true, info: 'circular variant (checked through the eccentric one)' };
  },
};

// ── Kozai-Lidov ─────────────────────────────────────────────────────────────
export const kozai = {
  key: 'kozai', title: 'Kozai-Lidov cycles', group: 'three-body', variants: ['planet', 'swarm'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.5 ? 'planet' : 'swarm');
    const i0 = (60 + 20 * r()) * DEG, mB = 0.5 + 0.5 * r(), aOut = 9 + 3 * r();
    const A = body('star A', 'sun', 1, BODY.sun.R / AU, [0, 0, 0], [0, 0, 0], { rDraw: 0.05 });
    const pl = orbiting(A, 'planet', 'jupiter', BODY.jupiter.m / MS, BODY.jupiter.R / AU, { a: 1, e: 0.05, i: 0, M: 2 * Math.PI * r() }, { rDraw: 0.025 });
    const Bs = orbiting({ m: 1 + pl.m, x: [0, 0, 0], v: [0, 0, 0] }, 'star B', 'redDwarf', mB, 0.4 * BODY.sun.R / AU, { a: aOut, e: 0.1, i: i0, O: 0, w: 0, M: 2 * Math.PI * r() }, { rDraw: 0.04, color: COLORS.redDwarf });
    const B = [A, pl, Bs]; toCOM(B);
    const P = new Parts(), gs = P.g('dust at all tilts', COLORS.ice);
    halo(P, B[0], { n, rin: 0.5, rout: 1.6, prograde: 0, g: gs, rand: r });
    const PIn = period(1, 1), POut = period(1 + mB, aOut);
    const tKL = (2 / (3 * Math.PI)) * POut ** 2 / PIn * (1 + mB) / mB * (1 - 0.01) ** 1.5;   // e_out = 0.1
    const emax = Math.sqrt(Math.max(0, 1 - 5 / 3 * Math.cos(i0) ** 2));
    return {
      key: 'kozai', title: 'Kozai-Lidov cycles', variant, seed,
      blurb: `A companion star tilted ${fmt.sig(i0 / DEG, 2)}° trades the planet's tilt for a stretched orbit, and back, again and again.`,
      scale: unitsOf(AU, MS, { L: 'AU', M: 'M☉', T: 'yr/2π' }), bodies: B, opts: { eta: 0.02 },
      particles: P.done(0.008), pool: 0, i0, emax, tKL,
      dt: period(1, 0.5) / 200, rate: tKL / 15, duration: 3 * tKL,
      view: { center: 0, extent: 2.2, tilt: 20 },
      cues: [],
      tex: ['e_{\\max} = \\sqrt{1 - \\tfrac53 \\cos^2 i_0}', '\\sqrt{1 - e^2}\\,\\cos i = \\text{const}', 't_{KL} \\sim \\frac{P_{\\text{out}}^2}{P_{\\text{in}}}\\,\\frac{M_{\\text{tot}}}{m_B}\\,(1 - e_{\\text{out}}^2)^{3/2}'],
      facts: [['start tilt i0', fmt.sig(i0 / DEG, 3) + '°'], ['e_max (quadrupole)', fmt.sig(emax, 3)], ['companion', `${fmt.sig(mB, 2)} M☉ at ${fmt.sig(aOut, 3)} AU`], ['Kozai time', fmt.sig(tKL / (2 * Math.PI), 3) + ' yr']],
      notes: ['The planet has Jupiter\'s mass; the dust is massless.', 'Full three-body motion, not the averaged equations, so the cycles are not exactly periodic.'],
      sources: ['kozai62'],
    };
  },
  test: { n: 20 },
  check(spec) {
    const sys = new System(spec.bodies, spec.opts);
    let emax = 0, imin = 99;
    const steps = 400, h = 2.5 * spec.tKL / steps;
    for (let k = 0; k < steps; k++) {
      sys.advance(h, 1);
      const el = sys.elementsOf(1, 0);
      // the tilt to the outer orbit: angle between the two orbit normals
      const hIn = v3.cross(v3.sub(sys.pos(1), sys.pos(0)), v3.sub(sys.vel(1), sys.vel(0)));
      const hOut = v3.cross(v3.sub(sys.pos(2), sys.pos(0)), v3.sub(sys.vel(2), sys.vel(0)));
      const inc = Math.acos(v3.dot(hIn, hOut) / (v3.len(hIn) * v3.len(hOut)));
      emax = Math.max(emax, el.e); imin = Math.min(imin, inc);
    }
    return { pass: emax > 0.7 * spec.emax && imin < spec.i0 - 10 * DEG, info: `e reached ${fmt.sig(emax, 3)} (quadrupole e_max ${fmt.sig(spec.emax, 3)}), tilt fell from ${fmt.sig(spec.i0 / DEG, 3)}° to ${fmt.sig(imin / DEG, 3)}°` };
  },
};

// ── Triton: capture by binary exchange ──────────────────────────────────────
// Search: random binaries that pass Neptune; keep the first that leaves
// Triton bound on a backward orbit and its partner unbound.
export const triton = {
  key: 'triton', title: 'How Neptune caught Triton', group: 'three-body', variants: ['capture'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384;
    const L = BODY.neptune.R, MN = BODY.neptune.m;
    const mT = BODY.triton.m / MN, RT = BODY.triton.R / L;
    let best = null, tries = 0;
    while (!best && tries < 100) {
      tries++;
      const ab = 0.3 + 0.5 * r(), mC = mT * (0.3 + 0.7 * r()), vinf = 0.03 + 0.07 * r();
      const rSplit = ab * Math.cbrt(3 / (mT + mC)), q = Math.max(1.8, rSplit * (0.25 + 0.65 * r()));
      const phase = 2 * Math.PI * r(), retroB = r() < 0.5 ? 1 : -1;
      const start = 120, B = make(q, vinf, ab, mC, phase, retroB, start);
      const sys = new System(B, { eta: 0.02, maxSub: 50000 });
      const tEnd = 2.5 * start / vinf;
      sys.advance(tEnd, 100);
      const eT = sys.elementsOf(1, 0), eC = sys.elementsOf(2, 0);
      const hz = v3.cross(v3.sub(sys.pos(1), sys.pos(0)), v3.sub(sys.vel(1), sys.vel(0)))[2];
      if (sys.alive[1] && sys.alive[2] && eT.E < 0 && eC.E > 0 && hz < 0 && eT.a * (1 + eT.e) < 400) best = { q, vinf, ab, mC, phase, retroB, start, tEnd, tries };
    }
    if (!best) best = { q: 5, vinf: 0.08, ab: 0.4, mC: mT * 0.6, phase: 1, retroB: -1, start: 120, tEnd: 3750, tries };
    const B = make(best.q, best.vinf, best.ab, best.mC, best.phase, best.retroB, best.start);
    const P = new Parts(), gt = P.g('Triton dust', COLORS.ice), gc = P.g('partner dust', COLORS.rock), gr = P.g('Neptune ring dust', COLORS.dust);
    halo(P, B[1], { n: Math.floor(n * 0.3), rin: 0.02, rout: 0.08, prograde: 0, g: gt, rand: r });
    halo(P, B[2], { n: Math.floor(n * 0.3), rin: 0.02, rout: 0.07, prograde: 0, g: gc, rand: r });
    disk(P, B[0], { n: n - P.n, rin: 1.7, rout: 2.6, h: 0.002, g: gr, rand: r });
    const U = unitsOf(L, MN, { L: 'Neptune radii', M: 'M♆', T: 'T' });
    return {
      key: 'triton', title: 'How Neptune caught Triton', variant: 'capture', seed,
      blurb: 'Triton orbits Neptune backwards, so it cannot have formed there. A pair of bodies that passed too close could have been split: one thrown away, Triton kept.',
      scale: U, bodies: B, opts: { eta: 0.02, maxSub: 50000, watch: [[0, 1], [0, 2]], escapeR: 150 },
      particles: P.done(0.006), pool: 0, best,
      dt: 0.02, rate: best.tEnd / 30, duration: best.tEnd,
      view: { center: 0, extent: 40, tilt: 35, follow: 1 },
      cues: ['periapsis', 'capture', 'ejection'],
      tex: ['r_{\\text{split}} \\approx a_b \\left(\\frac{3 M_N}{m_T + m_C}\\right)^{1/3}', 'E_T < 0 < E_C'],
      facts: [['Triton mass', fmt.sig(BODY.triton.m) + ' kg'], ['Triton orbit today', '354,759 km, i = 156.9° (retrograde)'], ['binary separation', fmt.km(best.ab * L)], ['closest pass', fmt.sig(best.q, 3) + ' Neptune radii'], ['approach speed', fmt.kms(best.vinf * U.V)], ['found after', best.tries + ' random tries']],
      notes: ['The partner mass, the pair separation and the approach are drawn at random and kept when the capture works (Agnor & Hamilton 2006 found such captures common).', 'Tides that later rounded Triton\'s orbit are not modelled.'],
      sources: ['ah06', 'jplsat', 'nssdc'],
    };
    function make(q, vinf, ab, mC, phase, retroB, start) {
      const Nep = body('Neptune', 'neptune', 1, 1, [0, 0, 0], [0, 0, 0], { rDraw: 1, merge: true, track: 0 });
      // hyperbolic path of the pair's centre: p = q (1 + e), e from vinf
      const Mb = mT + mC, mu = 1 + Mb, e = 1 + q * vinf * vinf / mu, p = q * (1 + e);
      const f = -Math.acos(Math.max(-1, Math.min(1, (p / start - 1) / e)));
      const c = elementsToState(mu, { p, e, f, i: 157 * DEG, O: 0, w: 0 });   // a backward path, as Triton's orbit
      const bs = elementsToState(Mb, { a: ab, e: 0, i: retroB < 0 ? Math.PI : 0, M: phase });
      const T = body('Triton', 'ice', mT, RT, v3.add(c.r, v3.mul(bs.r, mC / Mb)), v3.add(c.v, v3.mul(bs.v, mC / Mb)), { rDraw: 0.12, merge: true });
      const Cp = body('partner', 'rock', mC, RT * Math.cbrt(mC / mT), v3.sub(c.r, v3.mul(bs.r, mT / Mb)), v3.sub(c.v, v3.mul(bs.v, mT / Mb)), { rDraw: 0.1, merge: true });
      const B = [Nep, T, Cp]; toCOM(B); return B;
    }
  },
  test: { n: 30 },
  check(spec) {
    const sys = new System(spec.bodies, spec.opts);
    sys.advance(spec.duration, 200);
    const ev = sys.drain(), eT = sys.elementsOf(1, 0), eC = sys.elementsOf(2, 0);
    const caps = ev.filter(e => e.type === 'release' && e.j === 2).length;
    return { pass: eT.E < 0 && eC.E > 0 && eT.i > Math.PI / 2, info: `Triton bound (a ${fmt.sig(eT.a, 3)} R_N, e ${fmt.sig(eT.e, 2)}, i ${fmt.sig(eT.i / DEG, 3)}°), partner unbound (E ${fmt.sig(eC.E, 2)}); found after ${spec.best.tries} tries` };
  },
};
