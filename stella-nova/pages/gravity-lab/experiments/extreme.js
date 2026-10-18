// ============================================================================
//  GRAVITY LAB  ·  experiments/extreme.js — galaxies, black holes, disks
// ----------------------------------------------------------------------------
//  galaxies   two disk galaxies meet (Toomre & Toomre 1972): tidal tails
//             and bridges; the Mice, the Antennae, a Whirlpool-like
//             companion, a retrograde pass, a Cartwheel ring
//  blackhole  Sgr A* and the S-stars: S2 on its real orbit, a swarm of
//             stars about the black hole
//  tde        a Sun-like star passes inside the tidal radius of Sgr A* and
//             is torn into a stream; about half of it is bound
//  disk       a self-gravitating disk about a star: below Toomre Q = 1 it
//             breaks into clumps (the GPU sums every pair)
// ============================================================================
import { C, BODY, SGRA, unitsOf } from '../data.js';
import { body, Parts, disk, COLORS, DEG, rng, gauss, v3, elementsToState, toCOM, period, runCpu, liveRows, normalOf, tiltFn, fmt } from './common.js';
import { galaxiesFocus, blackholeFocus, tdeFocus } from './focus.js';
import { System, selfEnergy, selfStep } from '../nbody.js';

const MS = C.MSUN, AU = C.AU;

// ── colliding galaxies ──────────────────────────────────────────────────────
// Each galaxy: a softened point mass (eps 0.15) and rings of test stars at
// 0.2-0.75 of the pericentre distance (tt72). Parabolic encounter.
const GAL = {
  mice: { ratio: 1, q: 1, disks: [[15, 0], [25, 180]], blurb: 'Two equal galaxies, both spinning with the encounter: long, straight tails, as in NGC 4676, the Mice.' },
  antennae: { ratio: 1, q: 1, disks: [[60, -30], [60, -30]], blurb: 'Two equal galaxies tilted 60°: two long curved tails cross, as in NGC 4038/9, the Antennae.' },
  whirlpool: { ratio: 0.3, q: 1.4, disks: [[10, 0], null], blurb: 'A small companion swings past a large disk and raises two spiral arms, as in M51, the Whirlpool.' },
  retrograde: { ratio: 1, q: 1, disks: [[180, 0], [170, 0]], blurb: 'The same pass with both disks spinning against the encounter: almost no tails. The tide needs time to act.' },
  cartwheel: { ratio: 0.25, q: 0.12, disks: [[0, 0], null], plunge: true, blurb: 'A small galaxy drops through the centre of a disk. A ring of stars spreads out like a ripple on a pond, as in the Cartwheel.' },
};
export const galaxies = {
  key: 'galaxies', title: 'Colliding galaxies', group: 'galaxies', variants: [...Object.keys(GAL), 'random'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384;
    const variant = o.variant || ['mice', 'antennae', 'whirlpool', 'retrograde', 'cartwheel', 'random', 'random'][Math.floor(r() * 7)];
    const G = variant === 'random' ? { ratio: [1, 0.5, 0.3][Math.floor(r() * 3)], q: 0.8 + 0.8 * r(), disks: [[180 * r(), 360 * r()], r() < 0.6 ? [180 * r(), 360 * r()] : null], blurb: 'A random encounter: masses, tilts and the closest approach drawn by chance.' } : GAL[variant];
    const m1 = 1, m2 = G.ratio, M = m1 + m2, q = G.q, eps = 0.15;
    const start = variant === 'cartwheel' ? 3.0 : 5.0;
    let rel;
    if (G.plunge) {
      // nearly head-on, along the disk axis: the target disk lies in x-y
      rel = { r: [0.05, q, start], v: [0, 0, -Math.sqrt(2 * M / start)] };
    } else {
      const e = 1, p = 2 * q, f = -Math.acos(p / start - 1);
      rel = elementsToState(M, { p, e, f });
    }
    const B = [body('galaxy A', 'core', m1, 0, v3.mul(rel.r, -m2 / M), v3.mul(rel.v, -m2 / M), { eps, rDraw: 0.03, color: COLORS.amber, absorb: 0, merge: false }),
      body('galaxy B', 'core', m2, 0, v3.mul(rel.r, m1 / M), v3.mul(rel.v, m1 / M), { eps: eps * Math.cbrt(m2), rDraw: 0.025, color: COLORS.blue, absorb: 0, merge: false })];
    const P = new Parts(), cols = [[1.0, 0.8, 0.55], [0.6, 0.75, 1.0]];
    const nd = G.disks[1] ? [Math.floor(n * m1 / M), n - Math.floor(n * m1 / M)] : [n, 0];
    G.disks.forEach((d, k) => {
      if (!d) return;
      const g = P.g(B[k].name + ' stars', cols[k]), mk = B[k].m, rmax = variant === 'cartwheel' ? 1.2 : 0.75 * q * Math.sqrt(mk) + (variant === 'whirlpool' && k === 0 ? 0.4 : 0);
      disk(P, B[k], { n: nd[k], rin: 0.15 * Math.sqrt(mk), rout: Math.max(0.35, rmax), GM: mk, h: 0.02, normal: normalOf(d[0] * DEG, d[1] * DEG), g, rand: r, profile: 'r' });
    });
    const tPeri = G.plunge ? start / Math.sqrt(2 * M / start) * 0.8 : parabolicTime(M, q, start);
    const U = unitsOf(10 * 3.0857e19, 1e11 * MS, { L: '10 kpc', M: '10^11 M☉', T: 'T' });
    return {
      key: 'galaxies', title: variant === 'random' ? 'Colliding galaxies' : 'Colliding galaxies: ' + variant, variant, seed,
      blurb: G.blurb,
      scale: U, bodies: B, opts: { eta: 0.01, watch: [[0, 1]] }, particles: P.done(0.006), pool: 0, tPeri, q,
      dt: 0.004, rate: tPeri / 6, duration: tPeri + 10,
      view: { center: 'com', extent: 3.2, tilt: 50 },
      cues: ['periapsis'],
      tex: ['\\ddot{\\vec r} = -\\sum_{k=1,2} \\frac{G M_k\\,(\\vec r - \\vec R_k)}{\\left(|\\vec r - \\vec R_k|^2 + \\epsilon_k^2\\right)^{3/2}}', 'e = 1,\\quad r_p = ' + fmt.sig(q, 2)],
      facts: [['mass ratio', `${fmt.sig(m2, 2)} : 1`], ['closest approach', fmt.sig(q * 10, 3) + ' kpc'], ['time unit', fmt.sig(U.T / C.YEAR / 1e6, 3) + ' Myr'], ['disk tilts', G.disks.filter(Boolean).map(d => fmt.sig(d[0], 3) + '°').join(', ')]],
      notes: ['Restricted method of Toomre & Toomre (1972): each galaxy is a softened point mass, its stars are massless.', 'No dark-matter halos and no dynamical friction, so the cores pass and do not merge.'],
      sources: ['tt72'],
    };
    function parabolicTime(M, q, rs) {
      // Barker: t = sqrt(2 q^3 / M) (D + D^3 / 3), D = tan(f / 2)
      const f = Math.acos(2 * q / rs - 1), D = Math.tan(f / 2);
      return Math.sqrt(2 * q ** 3 / M) * (D + D ** 3 / 3);
    }
  },
  focus: galaxiesFocus,
  test: { n: 600 },
  check(spec) {
    const T = spec.tPeri + 4;
    const { lab } = runCpu(spec, T, 200);
    const rb = lab.be.readback(), s = lab.sys, P = spec.particles;
    let far = 0, tot = 0;
    for (const p of liveRows(rb, P.n)) {
      tot++;
      const d = Math.min(v3.len(v3.sub(p.x, s.pos(0))), v3.len(v3.sub(p.x, s.pos(1))));
      if (d > 1.6) far++;
    }
    const f = far / Math.max(1, tot);
    if (spec.variant === 'mice' || spec.variant === 'antennae') return { pass: f > 0.08, info: `${(100 * f).toFixed(1)}% of stars in tails (more than 1.6 from both cores) 4 units after pericentre` };
    if (spec.variant === 'retrograde') return { pass: f < 0.08, info: `${(100 * f).toFixed(1)}% of stars in tails (retrograde: few)` };
    if (spec.variant === 'cartwheel') {
      // a ring: past r = 0.8 the radial count has a crest over a trough
      // inside it (a density wave moving out)
      const rs = liveRows(rb, P.n).map(p => Math.hypot(...v3.sub(p.x, s.pos(0)).slice(0, 2)));
      const hist = new Array(30).fill(0); for (const x of rs) if (x < 3) hist[Math.floor(x / 0.1)]++;
      let best = 0, bk = 0;
      for (let k = 8; k < 30; k++) { const lo = Math.min(...hist.slice(k - 4, k)); const q = hist[k] / Math.max(1, lo); if (hist[k] > 0.02 * tot && q > best) { best = q; bk = k; } }
      return { pass: best > 1.5, info: `ring crest at r = ${fmt.sig(bk * 0.1 + 0.05, 2)}: ${hist[bk]} stars, ${fmt.sig(best, 2)}x the trough inside it` };
    }
    return { pass: tot > 0, info: `${(100 * f).toFixed(1)}% of stars in tails` };
  },
};

// ── Sgr A* and the S-stars ──────────────────────────────────────────────────
export const blackhole = {
  key: 'blackhole', title: 'Stars around Sgr A*', group: 'black-holes', variants: ['s-stars'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384;
    const L = 1000 * AU, U = unitsOf(L, SGRA.M, { L: '1000 AU', M: 'M(Sgr A*)', T: 'T' });
    const BH = body('Sgr A*', 'bh', 1, SGRA.rs / L, [0, 0, 0], [0, 0, 0], { rDraw: 0.012 });
    const S2 = SGRA.S2, mS2 = S2.mStar / SGRA.M;
    const B = [BH];
    const s2 = elementsToState(1 + mS2, { a: S2.a / L, e: S2.e, i: S2.i * DEG, O: S2.O * DEG, w: S2.w * DEG, M: 2 * Math.PI * r() });
    B.push(body('S2', 'star', mS2, 0, s2.r, s2.v, { rDraw: 0.02, color: COLORS.blue }));
    // more S-stars: random orbits drawn like the observed cluster (a 0.5-2,
    // thermal e, isotropic): names S-a, S-b, ...
    for (let k = 0; k < 10; k++) {
      const a = 0.4 + 1.8 * r(), e = Math.min(0.97, Math.sqrt(r())), m = (8 + 10 * r()) * MS / SGRA.M;
      const st = elementsToState(1 + m, { a, e, i: Math.acos(2 * r() - 1), O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: 2 * Math.PI * r() });
      B.push(body('S-star ' + String.fromCharCode(97 + k), 'star', m, 0, st.r, st.v, { rDraw: 0.012, color: COLORS.ice }));
    }
    toCOM(B);
    const P = new Parts(), gc = P.g('nuclear star cluster', COLORS.amber), gd = P.g('clockwise disk', COLORS.cyan);
    const nc = Math.floor(n * 0.6);
    for (let q = 0; q < nc; q++) {
      const a = 0.3 + 3 * r() ** 1.5, e = Math.min(0.9, Math.sqrt(r()));
      const st = elementsToState(1, { a, e, i: Math.acos(2 * r() - 1), O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: 2 * Math.PI * r() });
      P.add(st.r, st.v, gc);
    }
    disk(P, B[0], { n: n - P.n, rin: 6, rout: 20, emax: 0.3, h: 0.1, normal: normalOf(127 * DEG, 100 * DEG), g: gd, rand: r });
    const PS2 = period(1, S2.a / L);
    return {
      key: 'blackhole', title: 'Stars around Sgr A*', variant: 's-stars', seed,
      blurb: 'S2 swings within 120 AU of a black hole of 4.3 million Suns at 7,700 km/s, once every 16 years.',
      scale: U, bodies: B, opts: { eta: 0.02, watch: [[0, 1]] }, particles: P.done(0.006), pool: 0, PS2,
      dt: PS2 / 4000, rate: PS2 / 8, duration: PS2 * 3,
      view: { center: 0, extent: 2.2, tilt: 35, follow: 1 },
      cues: ['periapsis'],
      tex: ['M = \\frac{4\\pi^2 a^3}{G P^2} = 4.30\\times10^{6}\\,M_\\odot', 'v_p = \\sqrt{GM\\,\\frac{1+e}{a(1-e)}}'],
      facts: [['Sgr A* mass', '4.297 × 10^6 M☉'], ['S2 period', '16.05 yr'], ['S2 eccentricity', '0.885'], ['S2 closest approach', '≈ 120 AU, 7,700 km/s'], ['Schwarzschild radius', fmt.sig(SGRA.rs / AU, 2) + ' AU']],
      notes: ['Newtonian gravity: S2 also shows a relativistic precession of 12′ per orbit, too small to see here.', 'Other S-stars and the cluster are random orbits drawn like the real ones; S2 is the measured orbit.'],
      sources: ['grav22', 'gillessen'],
    };
  },
  focus: blackholeFocus,
  test: { n: 300 },
  check(spec) {
    const sys = new System(spec.bodies, spec.opts);
    sys.advance(spec.PS2 * 2.2, 400);
    const ts = sys.drain().filter(e => e.type === 'periapsis').map(e => e.t);
    const T = ts.length > 1 ? (ts[1] - ts[0]) * spec.scale.T / C.YEAR : NaN;
    return { pass: Math.abs(T / 16.0455 - 1) < 0.01, info: `S2 periapsis to periapsis ${fmt.sig(T, 5)} yr (measured 16.0455)` };
  },
};

// ── a tidal disruption event ────────────────────────────────────────────────
export const tde = {
  key: 'tde', title: 'A star torn apart by a black hole', group: 'black-holes', variants: ['grazing', 'deep'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.6 ? 'grazing' : 'deep');
    const L = AU, U = unitsOf(L, SGRA.M, { L: 'AU', M: 'M(Sgr A*)', T: 'T' });
    const BH = body('Sgr A*', 'bh', 1, SGRA.rs / L, [0, 0, 0], [0, 0, 0], { rDraw: SGRA.rs / L });
    const mStar = MS / SGRA.M, Rs = BODY.sun.R / L, rt = Rs * Math.cbrt(1 / mStar);
    const beta = variant === 'grazing' ? 1.1 + 0.6 * r() : 2 + 2 * r(), q = rt / beta, start = 12;
    const f = -Math.acos(2 * q / start - 1), st = elementsToState(1 + mStar, { p: 2 * q, e: 1, f, i: 0.2 * r(), O: 2 * Math.PI * r(), w: 2 * Math.PI * r() });
    const nd = Math.floor(n * 0.9);
    const Sun = body('Sun-like star', 'star', mStar, Rs, st.r, st.v, { rDraw: 0.05, color: COLORS.star, fragile: { rt, n: nd }, merge: true });
    const B = [BH, Sun]; toCOM(B);
    const P = new Parts();
    disk(P, B[0], { n: n - nd, rin: 3, rout: 8, h: 0.03, emax: 0.05, g: P.g('old gas ring', COLORS.dust), rand: r });
    const tq = Math.sqrt(2 * q ** 3) * (Math.tan(-f / 2) + Math.tan(-f / 2) ** 3 / 3);
    const aMin = rt * rt / (2 * Rs), tFall = period(1, aMin);
    return {
      key: 'tde', title: 'A star torn apart by a black hole', variant, seed,
      blurb: `A Sun-like star dives ${fmt.sig(beta, 2)}× inside the tidal radius of Sgr A*. Half of it is flung away; the other half falls back as a thin stream.`,
      scale: U, bodies: B, opts: { eta: 0.01 }, particles: P.done(0.004), pool: nd, debrisSize: 0.003, rt, beta, tq,
      dt: Math.min(0.01, period(1, q) / 600), rate: tq / 5, duration: tq * 3, tFall,
      view: { center: 0, extent: 6, tilt: 40 },
      cues: ['breakup'],
      tex: ['r_t = R_\\star\\left(\\frac{M_\\bullet}{m_\\star}\\right)^{1/3}', '\\Delta\\varepsilon = \\frac{G M_\\bullet R_\\star}{r_t^2}', 't_{\\min} = 2\\pi\\sqrt{\\frac{a_{\\min}^3}{G M_\\bullet}},\\ a_{\\min} = \\frac{r_t^2}{2R_\\star}'],
      facts: [['tidal radius', fmt.sig(rt, 3) + ' AU'], ['penetration β', fmt.sig(beta, 2)], ['first fallback', fmt.sig(tFall * U.T / C.DAY, 3) + ' d'], ['Schwarzschild radius', fmt.sig(SGRA.rs / AU, 2) + ' AU']],
      notes: ['The star breaks up all at once at r_t and its pieces are massless tracers (the frozen-in model); no self-gravity, no gas pressure.', 'Newtonian gravity. The returning stream does not circularize here.'],
      sources: ['rees88', 'grav22'],
    };
  },
  focus: tdeFocus,
  test: { n: 400 },
  check(spec) {
    const { lab, events } = runCpu(spec, spec.tq * 1.6, 300);
    const br = events.find(e => e.type === 'breakup'), rb = lab.be.readback();
    let bound = 0, tot = 0;
    if (br) for (const [st, c] of br.rows) for (let i = st; i < st + c; i++) {
      const o = 12 * i; if (!(rb.body[o + 7] > 0)) continue; tot++;
      const d = v3.len(v3.sub([rb.body[o], rb.body[o + 1], rb.body[o + 2]], lab.sys.pos(0))), u = v3.len(v3.sub([rb.body[o + 4], rb.body[o + 5], rb.body[o + 6]], lab.sys.vel(0)));
      if (0.5 * u * u - 1 / d < 0) bound++;
    }
    const f = bound / Math.max(1, tot);
    return { pass: !!br && br.d <= spec.rt * 1.001 && f > 0.35 && f < 0.65, info: br ? `breakup at ${fmt.sig(br.d, 3)} AU (r_t ${fmt.sig(spec.rt, 3)}), bound fraction ${(100 * f).toFixed(0)}% (frozen-in model: 50%)` : 'no breakup' };
  },
};

// ── a self-gravitating disk ─────────────────────────────────────────────────
export const diskGI = {
  key: 'disk', title: 'A disk breaks into planets', group: 'disks', variants: ['fragment', 'spiral'],
  build(seed, o = {}) {
    const r = rng(seed), n = Math.max(512, o.n || 16384), variant = o.variant || (r() < 0.6 ? 'fragment' : 'spiral');
    const Qt = variant === 'fragment' ? 0.6 + 0.3 * r() : 1.4 + 0.4 * r();
    const Md = 0.08 + 0.07 * r(), rin = 0.5, rout = 2.5, eps = 0.02;
    // surface density Sigma = S0 r0 / r on rin..rout: Md = 2 pi S0 r0 (rout - rin)
    const S0r0 = Md / (2 * Math.PI * (rout - rin));
    const N = n, pos = new Float64Array(3 * N), vel = new Float64Array(3 * N), mass = new Float64Array(N), group = new Uint8Array(N);
    mass[0] = 1; group[0] = 0;
    const m = Md / (N - 1);
    for (let i = 1; i < N; i++) {
      const R = rin + (rout - rin) * r(), th = 2 * Math.PI * r();
      const Sig = S0r0 / R, Menc = 1 + Md * (R - rin) / (rout - rin);
      const Om = Math.sqrt(Menc / R ** 3), kap = Om;
      const sigR = Qt * 3.36 * Sig / kap, h = 0.5 * sigR / Om;
      const vc = Math.sqrt(Menc / R);
      const vR = sigR * gauss(r), vT = vc + 0.7 * sigR * gauss(r);
      pos.set([R * Math.cos(th), R * Math.sin(th), h * gauss(r)], 3 * i);
      vel.set([vR * Math.cos(th) - vT * Math.sin(th), vR * Math.sin(th) + vT * Math.cos(th), 0.5 * sigR * gauss(r)], 3 * i);
      mass[i] = m; group[i] = 1;
    }
    // the system at rest at the origin
    let px = 0, py = 0, pz = 0, M = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < N; i++) { px += mass[i] * vel[3 * i]; py += mass[i] * vel[3 * i + 1]; pz += mass[i] * vel[3 * i + 2]; cx += mass[i] * pos[3 * i]; cy += mass[i] * pos[3 * i + 1]; cz += mass[i] * pos[3 * i + 2]; M += mass[i]; }
    for (let i = 0; i < N; i++) { vel[3 * i] -= px / M; vel[3 * i + 1] -= py / M; vel[3 * i + 2] -= pz / M; pos[3 * i] -= cx / M; pos[3 * i + 1] -= cy / M; pos[3 * i + 2] -= cz / M; }
    const U = unitsOf(10 * AU, MS, { L: '10 AU', M: 'M☉', T: 'T' }), Pin = period(1, rin);
    return {
      key: 'disk', title: variant === 'fragment' ? 'A disk breaks into planets' : 'Spiral arms in a heavy disk', variant, seed,
      blurb: variant === 'fragment' ? `A cold disk of ${fmt.sig(Md * 1047.6, 3)} Jupiter masses with Toomre Q ≈ ${fmt.sig(Qt, 2)} collapses into clumps: the start of giant planets.` : `A warmer disk (Q ≈ ${fmt.sig(Qt, 2)}) does not break up; its self-gravity winds it into spiral arms.`,
      scale: U, bodies: [], opts: {},
      self: { n: N, pos, vel, mass, eps, size: 0.006, group, groups: [{ name: 'star', color: COLORS.sun }, { name: 'disk', color: COLORS.amber }] },
      dt: Pin / 250, rate: Pin * 0.8, duration: period(1, 1.5) * 8, Qt, Md, Pin,
      view: { center: 'com', extent: 3, tilt: 55 },
      cues: [],
      tex: ['Q = \\frac{\\sigma_R\\,\\kappa}{3.36\\,G\\,\\Sigma}', 'Q < 1 \\;\\Rightarrow\\; \\text{fragments}'],
      facts: [['disk mass', fmt.sig(Md, 2) + ' M☉'], ['Toomre Q', fmt.sig(Qt, 2)], ['particles (each pulls on all)', String(N)], ['softening', fmt.sig(eps * 10, 2) + ' AU']],
      notes: ['Every particle pulls on every other (direct sum on the GPU), softened over ' + fmt.sig(eps * 10, 2) + ' AU.', 'A collisionless disk of particles, not gas: no pressure, no cooling, so the clumps do not become real planets.', `${N} particles, far fewer than research simulations (10^6 to 10^8).`],
      sources: ['toomre64'],
    };
  },
  test: { n: 600 },
  check(spec) {
    const st = { n: spec.self.n, pos: Float64Array.from(spec.self.pos), vel: Float64Array.from(spec.self.vel), mass: spec.self.mass, eps: spec.self.eps };
    const E0 = selfEnergy(st).E;
    const steps = 250;
    for (let k = 0; k < steps; k++) selfStep(st, spec.dt);
    const dE = Math.abs(selfEnergy(st).E - E0) / Math.abs(E0);
    // Q at r = 1.5 from the built velocities
    let s2 = 0, c = 0, ms = 0;
    for (let i = 1; i < spec.self.n; i++) {
      const x = spec.self.pos[3 * i], y = spec.self.pos[3 * i + 1], R = Math.hypot(x, y);
      if (Math.abs(R - 1.5) > 0.2) continue;
      const vR = (spec.self.vel[3 * i] * x + spec.self.vel[3 * i + 1] * y) / R; s2 += vR * vR; c++; ms += spec.self.mass[i];
    }
    const Sig = ms / (2 * Math.PI * 1.5 * 0.4), kap = Math.sqrt((1 + spec.Md * 0.5) / 1.5 ** 3), Q = Math.sqrt(s2 / c) * kap / (3.36 * Sig);
    return { pass: dE < 2e-3 && Math.abs(Q / spec.Qt - 1) < 0.35, info: `Toomre Q at r = 1.5 from the particles ${fmt.sig(Q, 2)} (target ${fmt.sig(spec.Qt, 2)}); |dE/E| ${dE.toExponential(2)} over one inner orbit (${spec.self.n} particles, direct sum)` };
  },
};
