// ============================================================================
//  GRAVITY LAB  ·  experiments/systems.js — planetary systems and moons
// ----------------------------------------------------------------------------
//  circumbinary  Kepler-16: a planet with two suns; dust inside the
//                Holman-Wiegert limit is cleared
//  resonance     TRAPPIST-1's chain of seven, the Laplace resonance of Io,
//                Europa and Ganymede, Pluto and the plutinos (3:2)
//  flyby         a slow passing star throws planets out and steals Kuiper
//                belt dust
//  rings         Saturn's F ring and its shepherds, Pan in the Encke gap, a
//                moon torn into a ring inside the Roche limit
//  sl9           comet Shoemaker-Levy 9 torn apart by Jupiter (1992) and
//                its train of fragments hitting the planet (1994)
// ============================================================================
import { C, BODY, KEPLER16, TRAPPIST1, SATURN_RINGS, SL9, unitsOf, ROCHE_FLUID } from '../data.js';
import { body, orbiting, Parts, disk, halo, COLORS, DEG, rng, gauss, v3, elementsToState, toCOM, period, runCpu, liveRows, fmt } from './common.js';
import { System, rocheFluid, stateToElements } from '../nbody.js';

const MS = C.MSUN, AU = C.AU;

// ── Kepler-16 ───────────────────────────────────────────────────────────────
export function hwLimit(e, mu) { return 1.60 + 5.10 * e - 2.22 * e * e + 4.12 * mu - 4.27 * e * mu - 5.09 * mu * mu + 4.61 * e * e * mu * mu; }
export const circumbinary = {
  key: 'circumbinary', title: 'A planet with two suns', group: 'systems', variants: ['kepler-16', 'random'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.5 ? 'kepler-16' : 'random');
    const K = KEPLER16;
    let mA = K.MA / MS, mB = K.MB / MS, ab = K.abin / AU, eb = K.ebin;
    if (variant === 'random') { mA = 0.5 + 0.7 * r(); mB = mA * (0.15 + 0.85 * r()); ab = 0.1 + 0.3 * r(); eb = 0.5 * r(); }
    const mu = mB / (mA + mB), ac = hwLimit(eb, mu) * ab;
    const rel = elementsToState(mA + mB, { a: ab, e: eb, f: 2 * Math.PI * r() });
    const A = body(variant === 'kepler-16' ? 'Kepler-16 A' : 'star A', 'star', mA, K.RA / AU, v3.mul(rel.r, -mu), v3.mul(rel.v, -mu), { rDraw: 0.03, color: COLORS.amber });
    const Bs = body(variant === 'kepler-16' ? 'Kepler-16 B' : 'star B', 'redDwarf', mB, K.RB / AU, v3.mul(rel.r, 1 - mu), v3.mul(rel.v, 1 - mu), { rDraw: 0.02, color: COLORS.redDwarf });
    const ap = variant === 'kepler-16' ? K.planet.a / AU : ac * (1.15 + 0.4 * r());
    const pl = orbiting({ m: mA + mB, x: [0, 0, 0], v: [0, 0, 0] }, variant === 'kepler-16' ? 'Kepler-16 b' : 'planet', 'saturn', K.planet.m / MS, K.planet.R / AU, { a: ap, e: variant === 'kepler-16' ? K.planet.e : 0.02 * r(), M: 2 * Math.PI * r() }, { rDraw: 0.025 });
    const B = [A, Bs, pl]; toCOM(B);
    const P = new Parts(), gi = P.g('dust inside the limit', COLORS.rose), go = P.g('dust outside the limit', COLORS.ice);
    const cen = { m: mA + mB, x: [0, 0, 0], v: [0, 0, 0] };
    disk(P, cen, { n: Math.floor(n * 0.45), rin: 1.2 * ab, rout: ac, h: 0.01, g: gi, rand: r });
    disk(P, cen, { n: n - P.n, rin: ac, rout: 3.2 * ac, h: 0.01, g: go, rand: r });
    const Pb = period(mA + mB, ab), U = unitsOf(AU, MS, { L: 'AU', M: 'M☉', T: 'yr/2π' });
    return {
      key: 'circumbinary', title: variant === 'kepler-16' ? 'Kepler-16: two suns' : 'A planet with two suns', variant, seed,
      blurb: `Dust closer than ${fmt.sig(ac / ab, 3)} binary separations is thrown out by the two stars; the planet orbits just outside.`,
      scale: U, bodies: B, opts: { eta: 0.02, escapeR: 20 * ac }, particles: P.done(0.004), pool: 0, ac, ab, eb, mu,
      dt: Pb / 300, rate: Pb * 1.2, duration: Pb * 60,
      view: { center: 'com', extent: 2.6 * ac, tilt: 40 },
      cues: ['ejection'],
      tex: ['\\frac{a_c}{a_b} = 1.60 + 5.10e - 2.22e^2 + 4.12\\mu - 4.27e\\mu - 5.09\\mu^2 + 4.61e^2\\mu^2'],
      facts: variant === 'kepler-16' ? [['stars', '0.690 + 0.203 M☉'], ['binary', 'P = 41.08 d, e = 0.159'], ['planet', 'P = 228.8 d, 0.333 M_J'], ['stability limit a_c', fmt.sig(ac, 3) + ' AU']] : [['stars', `${fmt.sig(mA, 2)} + ${fmt.sig(mB, 2)} M☉`], ['binary', `a = ${fmt.sig(ab, 2)} AU, e = ${fmt.sig(eb, 2)}`], ['stability limit a_c', fmt.sig(ac, 3) + ' AU']],
      notes: ['The dust is massless.', 'Stars and planet are drawn far larger than their true size.'],
      sources: ['doyle11', 'hw99'],
    };
  },
  test: { n: 400 },
  check(spec) {
    const Pb = period(spec.bodies[0].m + spec.bodies[1].m, spec.ab);
    const { lab } = runCpu(spec, 40 * Pb, 200);
    const rb = lab.be.readback(), P = spec.particles, s = lab.sys, X = s.com();
    const keep = [[0, 0], [0, 0]];
    for (let i = 0; i < P.n; i++) {
      const r0 = Math.hypot(P.pos[3 * i] - 0, P.pos[3 * i + 1] - 0) / spec.ac;
      const k = r0 < 0.8 ? 0 : r0 > 1.3 ? 1 : -1; if (k < 0) continue;
      const o = 12 * i; keep[k][0]++;
      if (rb.body[o + 7] > 0) { const d = v3.len(v3.sub([rb.body[o], rb.body[o + 1], rb.body[o + 2]], X)); if (d < 3.5 * spec.ac && d > 0.6 * spec.ac || (k === 1 && d < 3.5 * spec.ac)) keep[k][1]++; }
    }
    const pl = s.elementsOf(2, 0), fin = keep[0][1] / keep[0][0], fout = keep[1][1] / keep[1][0];
    const plBound = s.alive[2] && v3.len(v3.sub(s.pos(2), X)) < 2.5 * spec.ac;
    return { pass: plBound && fout > 0.9 && fin < 0.6, info: `after 40 binary orbits: dust inside 0.8 a_c kept in place ${(100 * fin).toFixed(0)}%, outside 1.3 a_c ${(100 * fout).toFixed(0)}%; planet in place: ${!!plBound}` };
  },
};

// ── resonant chains ─────────────────────────────────────────────────────────
export const resonance = {
  key: 'resonance', title: 'Resonant chains', group: 'systems', variants: ['trappist-1', 'laplace', 'plutinos'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || ['trappist-1', 'trappist-1', 'laplace', 'plutinos'][Math.floor(r() * 4)];
    const P = new Parts();
    if (variant === 'trappist-1') {
      const T = TRAPPIST1, Ms = T.Mstar, U = unitsOf(0.01 * AU, Ms, { L: '0.01 AU', M: 'TRAPPIST-1 mass', T: 'T' });
      const S = body('TRAPPIST-1', 'redDwarf', 1, T.Rstar / U.L, [0, 0, 0], [0, 0, 0], { rDraw: 0.25, color: COLORS.redDwarf });
      const B = [S];
      const cols = [COLORS.rose, COLORS.amber, COLORS.green, COLORS.cyan, COLORS.blue, COLORS.violet, COLORS.ice];
      for (const p of T.planets) {
        const m = p.m * C.MEARTH / Ms, Pu = p.P * C.DAY / U.T, a = Math.cbrt((1 + m) * (Pu / (2 * Math.PI)) ** 2);
        B.push(orbiting(S, 'TRAPPIST-1' + p.name, 'rock', m, p.R * C.REARTH / U.L, { a, e: 0.005 * r(), i: 0.2 * DEG * gauss(r), O: 2 * Math.PI * r(), w: 0, M: 2 * Math.PI * r() }, { rDraw: 0.06 * p.R, P: Pu }));
      }
      toCOM(B);
      B.slice(1).forEach((b, k) => {
        const g = P.g(b.name + ' orbit dust', cols[k]), a = stateToElements(1 + b.m, v3.sub(b.x, B[0].x), v3.sub(b.v, B[0].v)).a;
        disk(P, B[0], { n: Math.floor(n * 0.1), rin: a * 0.985, rout: a * 1.015, h: 0.002, g, rand: r });
      });
      disk(P, B[0], { n: n - P.n, rin: 8, rout: 14, h: 0.02, emax: 0.05, g: P.g('outer debris', COLORS.dust), rand: r });
      const Pb = B[1].P;
      return {
        key: 'resonance', title: 'TRAPPIST-1: seven in step', variant, seed,
        blurb: 'Seven Earth-size planets whose periods lock in whole-number ratios: 8:5, 5:3, 3:2, 3:2, 4:3, 3:2.',
        scale: U, bodies: B, opts: { eta: 0.02 }, particles: P.done(0.02), pool: 0,
        dt: Pb / 200, rate: Pb * 1.5, duration: Pb * 150,
        view: { center: 0, extent: 7.5, tilt: 35 },
        cues: [],
        tex: ['\\frac{P_{i+1}}{P_i} \\approx \\frac{8}{5}, \\frac53, \\frac32, \\frac32, \\frac43, \\frac32', 'p\\,\\lambda_1 - (p+q)\\lambda_2 + q\\,\\lambda_3 \\approx \\text{const}'],
        facts: [['star mass', '0.0898 M☉'], ['planet masses', '0.33-1.37 M⊕'], ['periods', '1.51 to 18.77 d']],
        notes: ['Real masses and periods (Agol et al. 2021); the starting phases are random, not the fitted ones, so the resonant angles may circulate.', 'Planets are drawn far larger than their true size. The dust is massless.'],
        sources: ['agol21'],
      };
    }
    if (variant === 'laplace') {
      const MJ = BODY.jupiter.m, L = BODY.io.a, U = unitsOf(L, MJ, { L: 'Io distance', M: 'M_J', T: 'T' });
      const J = body('Jupiter', 'jupiter', 1, BODY.jupiter.R / L, [0, 0, 0], [0, 0, 0], { rDraw: BODY.jupiter.R / L });
      // the Laplace angle lambda_I - 3 lambda_E + 2 lambda_G = 180 deg
      const lE = 2 * Math.PI * r(), lG = 2 * Math.PI * r(), lI = Math.PI + 3 * lE - 2 * lG;
      const moon = (nm, lam) => { const d = BODY[nm], m = d.m / MJ, Pu = d.P / U.T, a = Math.cbrt((1 + m) * (Pu / (2 * Math.PI)) ** 2);
        return orbiting(J, nm[0].toUpperCase() + nm.slice(1), nm === 'io' ? 'amber' : 'ice', m, d.R / L, { a, e: 0, M: lam }, { rDraw: 0.03 + d.R / L }); };
      const B = [J, moon('io', lI), moon('europa', lE), moon('ganymede', lG)]; toCOM(B);
      const gt = P.g('Io plasma torus', COLORS.hot), gd = P.g('dust', COLORS.dust);
      disk(P, B[0], { n: Math.floor(n * 0.5), rin: 0.93, rout: 1.07, h: 0.04, g: gt, rand: r });
      disk(P, B[0], { n: n - P.n, rin: 1.2, rout: 3.2, h: 0.005, g: gd, rand: r });
      const PI = BODY.io.P / U.T;
      return {
        key: 'resonance', title: 'The Laplace resonance', variant, seed,
        blurb: 'For every orbit of Ganymede, Europa makes two and Io four. The three are never all lined up on one side.',
        scale: U, bodies: B, opts: { eta: 0.02 }, particles: P.done(0.008), pool: 0, PI,
        dt: PI / 300, rate: PI * 1.2, duration: PI * 40,
        view: { center: 0, extent: 2.9, tilt: 30 },
        cues: [],
        tex: ['n_I - 3n_E + 2n_G = 0', '\\phi_L = \\lambda_I - 3\\lambda_E + 2\\lambda_G = 180^\\circ'],
        facts: [['Io period', '1.769 d'], ['Europa period', '3.551 d'], ['Ganymede period', '7.155 d']],
        notes: ['Real masses and periods; orbits start circular.', 'The torus and dust are massless.'],
        sources: ['jplsat'],
      };
    }
    // Pluto and the plutinos (3:2 with Neptune)
    const U = unitsOf(AU, MS, { L: 'AU', M: 'M☉', T: 'yr/2π' });
    const S = body('Sun', 'sun', 1, BODY.sun.R / AU, [0, 0, 0], [0, 0, 0], { rDraw: 0.6 });
    const aN = BODY.neptune.a / AU, aP = BODY.pluto.a / AU, eP = BODY.pluto.e;
    // at Pluto's perihelion (lambda_P = varpi), phi = 2 (varpi - lambda_N) = 180: Neptune 90 deg away
    const varpi = 2 * Math.PI * r();
    const Np = orbiting(S, 'Neptune', 'neptune', BODY.neptune.m / MS, BODY.neptune.R / AU, { a: aN, e: 0, M: varpi - Math.PI / 2 }, { rDraw: 0.6 });
    const Pl = orbiting(S, 'Pluto', 'ice', BODY.pluto.m / MS, BODY.pluto.R / AU, { a: aP, e: eP, i: BODY.pluto.i * DEG, O: varpi, w: 0, M: 0 }, { rDraw: 0.35 });
    const B = [S, Np, Pl]; toCOM(B);
    const gp = P.g('plutinos (3:2)', COLORS.ice), gk = P.g('classical Kuiper belt', COLORS.dust);
    const np = Math.floor(n * 0.5);
    for (let q = 0; q < np; q++) {
      const a = 39.45 * (1 + 0.004 * gauss(r)), e = 0.1 + 0.2 * r(), lamN = Math.atan2(B[1].x[1], B[1].x[0]);
      // phi = 3 lambda - 2 lambda_N - varpi = 180 deg, plus a libration
      const w0 = 2 * Math.PI * r(), lam = (Math.PI + 0.6 * gauss(r) + 2 * lamN + w0) / 3;
      const s = elementsToState(1, { a, e, i: 0.15 * Math.abs(gauss(r)), O: 0, w: w0, M: lam - w0 });
      P.add(v3.add(B[0].x, s.r), v3.add(B[0].v, s.v), gp);
    }
    disk(P, B[0], { n: n - P.n, rin: 42, rout: 47.5, emax: 0.08, h: 0.05, g: gk, rand: r });
    const PN = period(1, aN);
    return {
      key: 'resonance', title: 'Pluto and the plutinos', variant, seed,
      blurb: "Pluto crosses Neptune's orbit, yet the two never come close: for every two of Pluto's orbits Neptune makes three.",
      scale: U, bodies: B, opts: { eta: 0.02, watch: [[1, 2]] }, particles: P.done(0.08), pool: 0, PN,
      dt: 2, rate: PN / 6, duration: PN * 12,
      view: { center: 0, extent: 55, tilt: 30, rotating: [0, 1] },
      cues: ['periapsis'],
      tex: ['\\phi = 3\\lambda_P - 2\\lambda_N - \\varpi_P \\approx 180^\\circ', 'P_P : P_N = 3 : 2'],
      facts: [['Pluto a, e', '39.5 AU, 0.249'], ['closest to Neptune', 'about 17 AU'], ['Neptune a', '30.1 AU']],
      notes: ['Real masses and orbits; Neptune starts on a circle.', 'The plutinos and the belt are massless.'],
      sources: ['nssdc'],
    };
  },
  test: { n: 200 },
  check(spec) {
    if (spec.variant === 'trappist-1') {
      const sys = new System(spec.bodies, spec.opts), Pb = spec.bodies[1].P;
      sys.advance(Pb * 150, 300);
      const Ps = []; for (let k = 1; k <= 7; k++) Ps.push(period(1 + sys.m[k], sys.elementsOf(k, 0).a));
      const want = [8 / 5, 5 / 3, 3 / 2, 3 / 2, 4 / 3, 3 / 2];
      const err = Math.max(...want.map((w, k) => Math.abs(Ps[k + 1] / Ps[k] / w - 1)));
      const alive = sys.alive.every(a => a);
      return { pass: alive && err < 0.02, info: `after 150 orbits of b: worst period-ratio offset from the chain ${(100 * err).toFixed(2)}%, all seven planets in place: ${alive}` };
    }
    if (spec.variant === 'laplace') {
      const sys = new System(spec.bodies, spec.opts); let worst = 0;
      for (let k = 0; k < 200; k++) {
        sys.advance(spec.PI * 30 / 200, 1);
        const lam = j => { const d = v3.sub(sys.pos(j), sys.pos(0)); return Math.atan2(d[1], d[0]); };
        let phi = lam(1) - 3 * lam(2) + 2 * lam(3); phi -= 2 * Math.PI * Math.floor(phi / (2 * Math.PI));
        worst = Math.max(worst, Math.abs(phi - Math.PI));
      }
      return { pass: worst < 25 * DEG, info: `Laplace angle within 180 ± ${fmt.sig(worst / DEG, 3)}° over 30 Io orbits` };
    }
    const sys = new System(spec.bodies, spec.opts); let dmin = 1e9;
    for (let k = 0; k < 600; k++) { sys.advance(spec.PN * 4 / 600, 1); dmin = Math.min(dmin, v3.len(v3.sub(sys.pos(2), sys.pos(1)))); }
    return { pass: dmin > 12, info: `closest Pluto-Neptune distance in 4 Neptune orbits: ${fmt.sig(dmin, 3)} AU (real about 17)` };
  },
};

// ── a passing star ──────────────────────────────────────────────────────────
export const flyby = {
  key: 'flyby', title: 'A star passes by', group: 'systems', variants: ['close', 'grazing'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.6 ? 'close' : 'grazing');
    const U = unitsOf(AU, MS, { L: 'AU', M: 'M☉', T: 'yr/2π' });
    const S = body('Sun', 'sun', 1, BODY.sun.R / AU, [0, 0, 0], [0, 0, 0], { rDraw: 0.8, merge: true });
    const B = [S];
    for (const nm of ['jupiter', 'saturn', 'uranus', 'neptune']) {
      const d = BODY[nm];
      B.push(orbiting(S, nm[0].toUpperCase() + nm.slice(1), nm === 'jupiter' ? 'jupiter' : nm === 'saturn' ? 'saturn' : nm === 'uranus' ? 'ice' : 'neptune', d.m / MS, d.R / AU, { a: d.a / AU, e: d.e, i: d.i * DEG, O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: 2 * Math.PI * r() }, { rDraw: 0.45 }));
    }
    const mS = 0.4 + 1.2 * r(), q = variant === 'close' ? 12 + 10 * r() : 30 + 25 * r();
    const vinf = (0.8 + 1.7 * r()) * 1e3 / U.V;   // 0.8-2.5 km/s: a slow pass, as in a birth cluster
    const inc = (variant === 'close' ? 10 : 30) * DEG * gauss(r), mu = 1 + mS, e = 1 + q * vinf * vinf / mu, p = q * (1 + e), start = 350;
    const f = -Math.acos((p / start - 1) / e);
    const st = elementsToState(mu, { p, e, f, i: Math.abs(inc), O: 2 * Math.PI * r(), w: 2 * Math.PI * r() });
    B.push(body('passing star', 'star', mS, 0.6 * BODY.sun.R / AU, st.r, st.v, { rDraw: 0.7, color: mS > 1 ? COLORS.blue : COLORS.redDwarf, merge: true, track: 0 }));
    toCOM(B);
    const P = new Parts(), gk = P.g('Kuiper belt', COLORS.ice), gd = P.g('scattered disk', COLORS.dust);
    disk(P, B[0], { n: Math.floor(n * 0.7), rin: 36, rout: 50, emax: 0.1, h: 0.05, g: gk, rand: r });
    disk(P, B[0], { n: n - P.n, rin: 50, rout: 90, emax: 0.3, h: 0.15, g: gd, rand: r });
    const tPeri = start / Math.sqrt(vinf * vinf + 2 * mu / start);
    return {
      key: 'flyby', title: 'A star passes by', variant, seed,
      blurb: `A ${fmt.sig(mS, 2)} M☉ star passes ${fmt.sig(q, 2)} AU from the Sun at ${fmt.kms(vinf * U.V)}. Planets are flung out, the Kuiper belt is torn, and the star leaves with stolen comets.`,
      scale: U, bodies: B, opts: { eta: 0.02, watch: [[0, 5]], escapeR: 250 },
      particles: P.done(0.12), pool: 0, q, mS,
      dt: 1.0, rate: tPeri / 12, duration: tPeri * 2.6,
      view: { center: 0, extent: 110, tilt: 40 },
      cues: ['periapsis', 'ejection', 'merge'],
      tex: ['e = 1 + \\frac{q\\,v_\\infty^2}{G(M_\\odot + M_\\star)}', '\\Delta v \\approx \\frac{2 G M_\\star}{b\\,v_\\infty}'],
      facts: [['star mass', fmt.sig(mS, 2) + ' M☉'], ['closest approach', fmt.sig(q, 3) + ' AU'], ['speed at infinity', fmt.kms(vinf * U.V)], ['real nearby flybys', 'HD 7977, about 3,900 AU, 2.8 Myr ago (Kaib & Raymond 2024)']],
      notes: ['A slow, close pass, as is likely in a star cluster, not in today\'s neighbourhood (typical 20-50 km/s, thousands of AU).', 'Real planets, random phases. Planets drawn far larger than true size; dust massless.'],
      sources: ['nssdc'],
    };
  },
  test: { n: 300 },
  check(spec) {
    const { lab, events } = runCpu(spec, spec.duration, 300);
    const s = lab.sys, rb = lab.be.readback(), P = spec.particles, Xs = s.pos(5), Vs = s.vel(5);
    let stolen = 0;
    for (const p of liveRows(rb, P.n)) { const d = v3.sub(p.x, Xs), u = v3.sub(p.v, Vs); if (0.5 * v3.dot(u, u) - spec.mS / v3.len(d) < 0 && v3.len(d) < 200) stolen++; }
    let disturbed = 0;
    for (let k = 1; k <= 4; k++) { if (!s.alive[k] || s.ejected[k]) { disturbed++; continue; } const el = s.elementsOf(k, 0); if (el.E > 0 || el.e > 0.2) disturbed++; }
    const pass = spec.variant === 'close' ? stolen > 0 && disturbed >= 1 : stolen >= 0;
    return { pass, info: `${stolen} belt particles now bound to the passing star; ${disturbed} planets ejected or pushed to e > 0.2; events: ${events.filter(e => e.type === 'ejection').length} ejections` };
  },
};

// ── rings ───────────────────────────────────────────────────────────────────
const RING_SCALE = 3000;
export const rings = {
  key: 'rings', title: "Saturn's ring shepherds", group: 'systems', variants: ['f-ring', 'encke', 'ring-birth'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || ['f-ring', 'encke', 'ring-birth', 'ring-birth'][Math.floor(r() * 4)];
    const Ms = BODY.saturn.m, L = 1e8, U = unitsOf(L, Ms, { L: '100,000 km', M: 'Saturn mass', T: 'T' });
    const Sat = body('Saturn', 'saturn', 1, BODY.saturn.R / L, [0, 0, 0], [0, 0, 0], { rDraw: BODY.saturn.R / L, rho: BODY.saturn.rho });
    const P = new Parts();
    if (variant === 'ring-birth') {
      const rhoM = 400 + 300 * r(), dR = rocheFluid(BODY.saturn.R / L, BODY.saturn.rho, rhoM), Rm = (80 + 120 * r()) * 1e3 / L;
      const m = rhoM * 4 / 3 * Math.PI * (Rm * L) ** 3 / Ms, qp = dR * (0.7 + 0.2 * r()), a = qp * (1.3 + 0.5 * r());
      const moon = orbiting(Sat, 'rubble moon', 'ice', m, Rm, { a, e: 1 - qp / a, f: -2.2, i: 0.02 * r() }, { rDraw: 0.02, rho: rhoM, fragile: { rho: rhoM, n: Math.floor(n * 0.75) } });
      const B = [Sat, moon];
      disk(P, Sat, { n: n - Math.floor(n * 0.75), rin: 2.8, rout: 3.6, h: 0.001, g: P.g('E ring dust', COLORS.dust), rand: r });
      const Pm = period(1, a);
      return {
        key: 'rings', title: 'A moon becomes a ring', variant, seed,
        blurb: `A rubble moon of density ${fmt.sig(rhoM, 3)} kg/m³ dips inside the Roche limit, ${fmt.km(dR * L)} from Saturn's centre, and is pulled into a ring.`,
        scale: U, bodies: B, opts: { eta: 0.02 }, particles: P.done(0.0025), pool: Math.floor(n * 0.75), debrisSize: 0.0025, dR,
        dt: period(1, 1) / 400, rate: Pm / 6, duration: Pm * 8,
        view: { center: 0, extent: a * (1 + (1 - qp / a)) * 1.1, tilt: 35 },
        cues: ['breakup'],
        tex: ['d_{\\text{Roche}} = 2.44\\,R_S \\left(\\frac{\\rho_S}{\\rho_m}\\right)^{1/3}', `= ${fmt.km(dR * L)}`],
        facts: [['Saturn density', '687 kg/m³'], ['moon density', fmt.sig(rhoM, 3) + ' kg/m³'], ['moon radius', fmt.km(Rm * L)], ['closest approach', fmt.km(qp * L)]],
        notes: ['The moon breaks up at once at the fluid limit and its pieces are massless tracers; roche-limit models the slow breakup grain by grain.', 'No collisions between the pieces, so the ring stays eccentric and does not flatten.'],
        sources: ['roche', 'nssdc'],
      };
    }
    if (variant === 'f-ring') {
      const pr = BODY.prometheus, pa = BODY.pandora;
      const Pr = orbiting(Sat, 'Prometheus', 'rock', pr.m / Ms * RING_SCALE, pr.R / L, { a: pr.a / L, e: 0.0022, M: 2 * Math.PI * r() }, { rDraw: 0.004 });
      const Pa = orbiting(Sat, 'Pandora', 'rock', pa.m / Ms * RING_SCALE, pa.R / L, { a: pa.a / L, e: 0.0042, M: 2 * Math.PI * r(), w: 2 * Math.PI * r() }, { rDraw: 0.004 });
      const B = [Sat, Pr, Pa]; toCOM(B);
      const aF = SATURN_RINGS.F / L, gf = P.g('F ring', COLORS.ice), ga = P.g('A ring edge', COLORS.dust);
      disk(P, B[0], { n: Math.floor(n * 0.55), rin: aF - 0.0015, rout: aF + 0.0015, emax: 0.0026, h: 0.0001, g: gf, rand: r });
      disk(P, B[0], { n: n - P.n, rin: 1.30, rout: SATURN_RINGS.A[1] / L, h: 0.0001, g: ga, rand: r });
      const PF = period(1, aF);
      return {
        key: 'rings', title: 'The F ring and its shepherds', variant, seed,
        blurb: 'Prometheus and Pandora orbit either side of the narrow F ring. Each close pass of Prometheus draws a streamer out of the ring.',
        scale: U, bodies: B, opts: { eta: 0.02 }, particles: P.done(0.0006), pool: 0, PF,
        dt: PF / 500, rate: PF * 0.6, duration: PF * 40,
        view: { center: 1, extent: 0.08, tilt: 60, rotating: [0, 1] },
        cues: [],
        tex: ['r_H = a\\left(\\frac{m}{3M}\\right)^{1/3}', 'a_F = 140{,}220\\ \\text{km}'],
        facts: [['Prometheus', '1.6 × 10^17 kg, 139,380 km'], ['Pandora', '1.4 × 10^17 kg, 141,720 km'], ['F ring width', 'about 50 km core']],
        notes: [`Moon masses ×${RING_SCALE}, so the streamers form within a few orbits.`, 'Ring particles are massless and do not collide.'],
        sources: ['jplsat', 'nssdc'],
      };
    }
    // Pan in the Encke gap
    const pn = BODY.pan, aPan = pn.a / L, w = SATURN_RINGS.enckeWidth / L;
    const Pan = orbiting(Sat, 'Pan', 'rock', pn.m / Ms * RING_SCALE * 3, pn.R / L, { a: aPan, e: 0, M: 0 }, { rDraw: 0.0025 });
    const B = [Sat, Pan]; toCOM(B);
    const gi = P.g('ring inside the gap', COLORS.ice), go = P.g('ring outside the gap', COLORS.dust);
    disk(P, B[0], { n: Math.floor(n / 2), rin: aPan - 0.025, rout: aPan - w / 2, h: 0.00005, g: gi, rand: r });
    disk(P, B[0], { n: n - P.n, rin: aPan + w / 2, rout: aPan + 0.025, h: 0.00005, g: go, rand: r });
    const PP = period(1, aPan);
    return {
      key: 'rings', title: 'Pan keeps the Encke gap open', variant, seed,
      blurb: 'The little moon Pan orbits in a 325 km gap in the A ring. Its pull leaves wavy wakes on both edges.',
      scale: U, bodies: B, opts: { eta: 0.02 }, particles: P.done(0.0004), pool: 0, aPan, w, PP,
      dt: PP / 500, rate: PP * 0.5, duration: PP * 30,
      view: { center: 1, extent: 0.04, tilt: 75, rotating: [0, 1] },
      cues: [],
      tex: ['\\Delta e \\approx 2.24\\,\\frac{m}{M}\\left(\\frac{a}{\\Delta a}\\right)^2', '\\lambda_{\\text{wake}} = 3\\pi\\,\\Delta a'],
      facts: [['Pan', '4.95 × 10^15 kg, radius 14 km'], ['Encke gap', '325 km wide at 133,590 km']],
      notes: [`Pan's mass ×${RING_SCALE * 3}, so the wakes show in a few orbits.`, 'Ring particles are massless and do not collide, so the gap does not stay clean.'],
      sources: ['jplsat', 'nssdc'],
    };
  },
  test: { n: 600 },
  check(spec) {
    if (spec.variant === 'ring-birth') {
      const { lab, events } = runCpu(spec, spec.duration * 0.5, 200);
      const br = events.find(e => e.type === 'breakup'), rb = lab.be.readback();
      let bound = 0, tot = 0;
      if (br) for (const [st, c] of br.rows) for (let i = st; i < st + c; i++) { const o = 12 * i; tot++; if (rb.body[o + 7] > 0) { const d = v3.len([rb.body[o], rb.body[o + 1], rb.body[o + 2]]), u = Math.hypot(rb.body[o + 4], rb.body[o + 5], rb.body[o + 6]); if (0.5 * u * u - 1 / d < 0) bound++; } }
      return { pass: !!br && br.d <= spec.dR && bound / Math.max(1, tot) > 0.8, info: br ? `breakup at ${fmt.sig(br.d, 3)} (limit ${fmt.sig(spec.dR, 3)}), ${bound}/${tot} pieces bound to Saturn` : 'no breakup' };
    }
    if (spec.variant === 'f-ring') {
      const { lab } = runCpu(spec, spec.PF * 12, 200);
      const rb = lab.be.readback(), P = spec.particles; let e0 = 0, e1 = 0, k = 0;
      for (let i = 0; i < P.n; i++) {
        if (P.group[i] !== 0 || !(rb.body[12 * i + 7] > 0)) continue;
        const o = 12 * i; k++;
        e0 += stateToElements(1, [P.pos[3 * i], P.pos[3 * i + 1], P.pos[3 * i + 2]], [P.vel[3 * i], P.vel[3 * i + 1], P.vel[3 * i + 2]]).e;
        e1 += stateToElements(1, [rb.body[o], rb.body[o + 1], rb.body[o + 2]], [rb.body[o + 4], rb.body[o + 5], rb.body[o + 6]]).e;
      }
      return { pass: k > 0 && e1 > 1.2 * e0, info: `F ring mean e ${fmt.sig(e0 / k, 3)} -> ${fmt.sig(e1 / k, 3)} after 12 orbits (shepherd kicks)` };
    }
    const { lab } = runCpu(spec, spec.PP * 10, 200);
    const rb = lab.be.readback(), P = spec.particles; const near = [0, 0], far = [0, 0];
    for (let i = 0; i < P.n; i++) {
      const o = 12 * i; if (!(rb.body[o + 7] > 0)) continue;
      const d0 = Math.abs(Math.hypot(P.pos[3 * i], P.pos[3 * i + 1]) - spec.aPan);
      const e = stateToElements(1, [rb.body[o], rb.body[o + 1], rb.body[o + 2]], [rb.body[o + 4], rb.body[o + 5], rb.body[o + 6]]).e;
      // the largest e: only the edge particles that met Pan get the big kick
      if (d0 < 2 * spec.w) near[0] = Math.max(near[0], e); else if (d0 > 0.018) far[0] = Math.max(far[0], e);
    }
    const en = near[0], ef = far[0];
    return { pass: en > 5 * ef, info: `largest e after 10 orbits: gap edges ${fmt.sig(en, 3)}, far ring ${fmt.sig(ef, 3)} (kick ~ m/M (a/da)^2)` };
  },
};

// ── Shoemaker-Levy 9 ────────────────────────────────────────────────────────
const SL9_SCALE = 40;
export const sl9 = {
  key: 'sl9', title: 'Shoemaker-Levy 9', group: 'systems', variants: ['1992', '1994'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.5 ? '1992' : '1994');
    const MJ = BODY.jupiter.m, L = BODY.jupiter.R, U = unitsOf(L, MJ, { L: 'Jupiter radii', M: 'M_J', T: 'T' });
    const J = body('Jupiter', 'jupiter', 1, 1, [0, 0, 0], [0, 0, 0], { rDraw: 1, rho: BODY.jupiter.rho });
    const B = [J];
    const ph = 2 * Math.PI * r();
    for (const nm of ['io', 'europa', 'ganymede', 'callisto']) {
      const d = BODY[nm];
      B.push(orbiting(J, nm[0].toUpperCase() + nm.slice(1), nm === 'io' ? 'amber' : 'ice', d.m / MJ, d.R / L, { a: d.a / L, e: 0, M: ph + 2 * Math.PI * r() }, { rDraw: 0.12 + d.R / L }));
    }
    const q = variant === '1992' ? SL9.q / L : 0.4 + 0.5 * r();
    const Rn = SL9.Rnuc * SL9_SCALE / L, mN = SL9.rho * 4 / 3 * Math.PI * (Rn * L) ** 3 / MJ;
    const a = 45 + 20 * r(), dR = rocheFluid(1, BODY.jupiter.rho, SL9.rho);
    const nd = Math.floor(n * 0.8);
    const cm = orbiting(J, 'Shoemaker-Levy 9', 'comet', mN, Rn, { a, e: 1 - q / a, i: 0.3 * r(), O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), f: -2.4 }, { rDraw: 0.05, rho: SL9.rho, fragile: { rho: SL9.rho, n: nd }, color: COLORS.comet });
    B.push(cm); toCOM(B);
    const P = new Parts();
    disk(P, B[0], { n: n - nd, rin: 1.4, rout: 1.8, h: 0.002, g: P.g('main ring', COLORS.dust), rand: r });
    const tq = timeToPeri(a, 1 - q / a, -2.4);
    return {
      key: 'sl9', title: variant === '1992' ? 'Shoemaker-Levy 9 is torn apart' : 'Shoemaker-Levy 9 hits Jupiter', variant, seed,
      blurb: variant === '1992' ? `In July 1992 the comet passed ${fmt.sig(SL9.q / L, 3)} Jupiter radii from the centre, deep inside the Roche limit (${fmt.sig(dR, 3)} R_J), and broke into a train of pieces.` : 'In July 1994 the train of fragments came back on a lower path and struck Jupiter one after another.',
      scale: U, bodies: B, opts: { eta: 0.02 }, particles: P.done(0.004), pool: nd, debrisSize: 0.004, dR, tq,
      dt: 0.004, rate: tq / 10, duration: variant === '1992' ? tq * 2.2 : tq * 1.4,
      view: { center: 0, extent: 30, tilt: 30, follow: B.length - 1 },
      cues: ['breakup'],
      tex: ['d_{\\text{Roche}} = 2.44\\,R_J\\left(\\frac{\\rho_J}{\\rho_c}\\right)^{1/3}', `= ${fmt.sig(dR, 3)}\\,R_J`],
      facts: [['perijove 1992', '1.33 R_J'], ['fragments', '21 seen'], ['impacts', '16-22 July 1994'], ['comet density (est.)', '600 kg/m³']],
      notes: [`The nucleus is drawn and modelled ${SL9_SCALE}× its 0.75 km radius, so its train forms within one pass.`, variant === '1994' ? 'The real 1994 orbit followed a two-year loop; here the fragments come in on the first pass.' : 'The real orbit took two years to return; this one is shorter.', 'Pieces are massless tracers; flashes mark impacts.'],
      sources: ['ab96', 'nssdc', 'roche'],
    };
    function timeToPeri(a, e, f) { const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(f / 2), Math.sqrt(1 + e) * Math.cos(f / 2)); return -(E - e * Math.sin(E)) * Math.sqrt(a ** 3); }
  },
  test: { n: 300 },
  check(spec) {
    const { lab, events } = runCpu(spec, spec.tq * 1.4, 300);
    const br = events.find(e => e.type === 'breakup'), rb = lab.be.readback();
    let hit = 0, tot = 0;
    if (br) for (const [st, c] of br.rows) for (let i = st; i < st + c; i++) { tot++; if (!(rb.body[12 * i + 7] > 0) && rb.body[12 * i + 11] > 0) hit++; }
    const pass = !!br && br.d < spec.dR && (spec.variant === '1994' ? hit / Math.max(1, tot) > 0.9 : hit / Math.max(1, tot) < 0.1);
    return { pass, info: br ? `breakup at ${fmt.sig(br.d, 3)} R_J (limit ${fmt.sig(spec.dR, 3)}), ${hit}/${tot} fragments hit Jupiter` : 'no breakup' };
  },
};
