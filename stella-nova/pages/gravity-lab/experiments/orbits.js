// ============================================================================
//  GRAVITY LAB  ·  experiments/orbits.js — orbits about one star
// ----------------------------------------------------------------------------
//  kepler      Kepler's three laws: beads at equal time steps on each orbit
//              (they crowd at aphelion: equal areas), a line of dust that
//              shears into a spiral (T^2 ~ a^3)
//  transfers   Hohmann against bi-elliptic: two probes, four burns
//  slingshot   gravity assist at Jupiter: speed up, slow down, leave the
//              ecliptic (Ulysses)
//  solar       the Solar System: eight planets, the main belt, the Trojans,
//              the Kuiper belt
//  hill        the Hill sphere: prograde moons escape beyond about half of
//              it, retrograde ones hold on further out
//  Each experiment: { key, title, group, variants, build(seed, o),
//  test: { n, T, frames }, check(spec, run) }. See common.js for the spec.
// ============================================================================
import { C, BODY, unitsOf, UNITS } from '../data.js';
import { body, orbiting, Parts, disk, halo, COLORS, DEG, rng, gauss, v3, elementsToState, toCOM, period, runCpu, liveRows, fmt } from './common.js';
import { slingshotFocus } from './focus.js';
import { stateToElements, hill as hillR } from '../nbody.js';

const AU = C.AU, MS = C.MSUN;
const PLANETS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
const KIND = { mercury: 'rock', venus: 'amber', earth: 'earth', mars: 'mars', jupiter: 'jupiter', saturn: 'saturn', uranus: 'ice', neptune: 'neptune' };
function sun(extra = {}) { return body('Sun', 'sun', 1, BODY.sun.R / AU, [0, 0, 0], [0, 0, 0], Object.assign({ rDraw: 0.06 }, extra)); }

// ── Kepler's laws ───────────────────────────────────────────────────────────
export const kepler = {
  key: 'kepler', title: "Kepler's three laws", group: 'orbits', variants: ['laws', 'comet'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.6 ? 'laws' : 'comet');
    const B = [sun()];
    const k = variant === 'comet' ? 2 : 3 + Math.floor(r() * 2);
    let a = 0.45 + 0.25 * r();
    // small planets only, so the planets barely pull on each other and
    // each orbit keeps its Kepler period
    const names = ['mercury', 'venus', 'earth', 'mars'];
    for (let j = 0; j < k; j++) {
      const nm = names[Math.floor(r() * names.length)], d = BODY[nm];
      const hi = (variant === 'comet' && j === k - 1) || (variant === 'laws' && j === 1);
      const e = hi ? 0.55 + 0.3 * r() : 0.25 * r();
      const ap = variant === 'comet' && j === k - 1 ? 3 + 1.5 * r() : a;
      B.push(orbiting(B[0], (hi ? 'eccentric ' : '') + nm[0].toUpperCase() + nm.slice(1) + '-mass planet', KIND[nm], d.m / MS, d.R / AU,
        { a: ap, e, i: 2 * DEG * r(), O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: 2 * Math.PI * r() }, { rDraw: 0.02 + 0.01 * (d.m > 1e26), el: { a: ap, e } }));
      a *= 1.45 + 0.3 * r();
    }
    toCOM(B);
    const P = new Parts(), beadsN = Math.floor(0.75 * n / k);
    // beads: massless copies of each planet's orbit at equal steps of time
    for (let j = 1; j <= k; j++) {
      const g = P.g('equal time steps: ' + B[j].name, j === 1 ? COLORS.cyan : j === 2 ? COLORS.amber : COLORS.violet);
      const el = stateToElements(1 + B[j].m, v3.sub(B[j].x, B[0].x), v3.sub(B[j].v, B[0].v));
      const M0 = meanAnom(el);
      for (let q = 1; q < beadsN; q++) {
        const s = elementsToState(1 + B[j].m, { a: el.a, e: el.e, i: el.i, O: el.O, w: argPeri(el), M: M0 + 2 * Math.PI * q / beadsN });
        P.add(v3.add(B[0].x, s.r), v3.add(B[0].v, s.v), g);
      }
    }
    // the third law: a radial line of dust on circular orbits
    const gl = P.g('a line of dust (third law)', COLORS.dust), nl = n - P.n;
    const amax = Math.max(...B.slice(1).map(b => b.el.a * (1 + b.el.e)));
    for (let q = 0; q < nl; q++) {
      const ar = 0.3 + (amax * 0.9 - 0.3) * (q / nl), s = elementsToState(1, { a: ar, e: 0, M: 0.02 * gauss(r) });
      P.add(v3.add(B[0].x, s.r), v3.add(B[0].v, s.v), gl);
    }
    const Pin = Math.min(...B.slice(1).map(b => period(1, b.el.a) * (1 - b.el.e) ** 1.5));
    const Pout = Math.max(...B.slice(1).map(b => period(1, b.el.a)));
    const U = UNITS.solar();
    return {
      key: 'kepler', title: "Kepler's three laws", variant, seed,
      blurb: 'Beads dropped at equal steps of time crowd where a planet is slow: equal areas in equal times.',
      scale: U, bodies: B, opts: { eta: 0.02, watch: B.slice(1).map((b, j) => [0, j + 1]).filter(([, j]) => B[j].el.e > 0.15) },
      particles: P.done(0.006), pool: 0,
      dt: Math.min(Pin / 400, 0.02), rate: Math.max(0.6, Pout / 20), duration: 2 * Pout,
      view: { center: 0, extent: amax * 1.15, tilt: 30 },
      cues: ['periapsis'],
      tex: ['T^2 = \\frac{4\\pi^2}{G M}\\,a^3', '\\frac{dA}{dt} = \\frac{h}{2} = \\text{const}', 'r = \\frac{a(1-e^2)}{1 + e\\cos f}'],
      facts: B.slice(1).map(b => [b.name, `a = ${fmt.sig(b.el.a)} AU, e = ${fmt.sig(b.el.e, 2)}, T = ${fmt.sig(period(1, b.el.a) * U.T / C.YEAR)} yr`]),
      notes: ['Bead and dust particles are massless tracers.', 'Planet masses are real; their orbits are invented.', 'Bodies are drawn far larger than their true size.'],
      sources: ['nssdc', 'iau'],
    };
  },
  test: { n: 300, frames: 200 },
  check(spec) {
    const T = spec.duration * 1.1;
    const { events } = runCpu(spec, T, 200);
    let worst = 0, count = 0;
    for (let j = 1; j < spec.bodies.length; j++) {
      const ts = events.filter(e => e.type === 'periapsis' && e.j === j).map(e => e.t);
      if (ts.length < 2) continue;
      const Tm = (ts[ts.length - 1] - ts[0]) / (ts.length - 1), Tk = period(1 + spec.bodies[j].m, spec.bodies[j].el.a);
      worst = Math.max(worst, Math.abs(Tm - Tk) / Tk); count++;
    }
    return { pass: count >= 1 && worst < 0.005, info: `${count} periods measured from periapsis events, worst |T - 2 pi sqrt(a^3/GM)|/T ${worst.toExponential(2)}` };
  },
};
function meanAnom(el) {
  const f = el.f, e = el.e;
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(f / 2), Math.sqrt(1 + e) * Math.cos(f / 2));
  return E - e * Math.sin(E);
}
function argPeri(el) {
  // the argument of periapsis from the eccentricity vector and the node
  const ev = el.ev, n = [Math.cos(el.O), Math.sin(el.O), 0];
  const h = [Math.sin(el.i) * Math.sin(el.O), -Math.sin(el.i) * Math.cos(el.O), Math.cos(el.i)];
  return Math.atan2(v3.dot(v3.cross(n, ev), h), v3.dot(n, ev));
}

// ── Hohmann against bi-elliptic ─────────────────────────────────────────────
export function hohmannDv(r1, r2) {
  const v1 = Math.sqrt(1 / r1), v2 = Math.sqrt(1 / r2), at = (r1 + r2) / 2;
  const d1 = Math.sqrt(1 * (2 / r1 - 1 / at)) - v1, d2 = v2 - Math.sqrt(2 / r2 - 1 / at);
  return { d1, d2, total: d1 + d2, t: Math.PI * Math.sqrt(at ** 3) };
}
export function biellipticDv(r1, r2, rb) {
  const a1 = (r1 + rb) / 2, a2 = (r2 + rb) / 2;
  const d1 = Math.sqrt(2 / r1 - 1 / a1) - Math.sqrt(1 / r1);
  const d2 = Math.sqrt(2 / rb - 1 / a2) - Math.sqrt(2 / rb - 1 / a1);
  const d3 = Math.sqrt(2 / r2 - 1 / a2) - Math.sqrt(1 / r2);
  return { d1, d2, d3, total: d1 + d2 + d3, t1: Math.PI * Math.sqrt(a1 ** 3), t2: Math.PI * Math.sqrt(a2 ** 3) };
}
export const transfers = {
  key: 'transfers', title: 'Hohmann or bi-elliptic?', group: 'orbits', variants: ['far', 'near'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.7 ? 'far' : 'near');
    // r2/r1 above 15.58: every bi-elliptic beats Hohmann; 11.94..15.58: a
    // far enough apoapsis does
    const R = variant === 'far' ? 16 + 6 * r() : 12.5 + 3 * r();
    let rb = R * (variant === 'far' ? 1.6 + 1.2 * r() : 4 + 3 * r());
    const H = hohmannDv(1, R); let Bi = biellipticDv(1, R, rb);
    while (Bi.total >= H.total) { rb *= 1.5; Bi = biellipticDv(1, R, rb); }
    const S = body('Star', 'sun', 1, 0.05, [0, 0, 0], [0, 0, 0], { rDraw: 0.25 });
    const ph = 2 * Math.PI * r();
    const at = th => [[Math.cos(th), Math.sin(th), 0], [-Math.sin(th), Math.cos(th), 0]];
    const [xh, vh] = at(ph), [xb, vb] = at(ph + Math.PI);
    const B = [S, body('Hohmann probe', 'probe', 0, 0, xh, vh, { rDraw: 0.08, color: COLORS.cyan, track: 0 }), body('bi-elliptic probe', 'probe', 0, 0, xb, vb, { rDraw: 0.08, color: COLORS.amber, track: 0 })];
    const t0 = 2 + 2 * r();
    const burns = [
      { t: t0, i: 1, dv: H.d1, label: 'Hohmann burn 1' }, { t: t0 + H.t, i: 1, dv: H.d2, label: 'Hohmann burn 2' },
      { t: t0, i: 2, dv: Bi.d1, label: 'bi-elliptic burn 1' }, { t: t0 + Bi.t1, i: 2, dv: Bi.d2, label: 'bi-elliptic burn 2' },
      { t: t0 + Bi.t1 + Bi.t2, i: 2, dv: -Bi.d3, label: 'bi-elliptic burn 3' }];
    const P = new Parts(), g1 = P.g('start orbit', COLORS.cyan), g2 = P.g('target orbit', COLORS.amber), g3 = P.g('dust', COLORS.dust);
    const n1 = Math.floor(n * 0.15), n2 = Math.floor(n * 0.35);
    disk(P, S, { n: n1, rin: 0.995, rout: 1.005, g: g1, rand: r, h: 0.001 });
    disk(P, S, { n: n2, rin: R * 0.997, rout: R * 1.003, g: g2, rand: r, h: 0.001 });
    disk(P, S, { n: n - P.n, rin: 1.5, rout: rb * 1.05, g: g3, rand: r, h: 0.01, profile: 'r' });
    const total = t0 + Bi.t1 + Bi.t2 + 2 * Math.PI * Math.sqrt(R ** 3) * 0.5;
    return {
      key: 'transfers', title: 'Hohmann or bi-elliptic?', variant, seed,
      blurb: `Two probes go from r to ${fmt.sig(R)} r. The long way round costs less fuel.`,
      scale: unitsOf(1e7, 5.972e24, { L: '10,000 km', M: 'M⊕', T: 'T' }), bodies: B,
      opts: { eta: 0.02, burns }, particles: P.done(0.012), pool: 0,
      dt: 0.01, rate: total / 30, duration: total,
      view: { center: 0, extent: rb * 0.6, tilt: 50 },
      cues: ['burn'],
      tex: ['\\Delta v_H = \\sqrt{\\tfrac{GM}{r_1}}\\left(\\sqrt{\\tfrac{2r_2}{r_1+r_2}}-1\\right)+\\sqrt{\\tfrac{GM}{r_2}}\\left(1-\\sqrt{\\tfrac{2r_1}{r_1+r_2}}\\right)', '\\frac{r_2}{r_1} > 15.58 \\;\\Rightarrow\\; \\Delta v_{\\text{bi}} < \\Delta v_H'],
      facts: [['r2 / r1', fmt.sig(R)], ['apoapsis rb / r1', fmt.sig(rb)], ['Δv Hohmann', fmt.sig(H.total, 4) + ' v1'], ['Δv bi-elliptic', fmt.sig(Bi.total, 4) + ' v1'], ['time Hohmann', fmt.sig(H.t / (2 * Math.PI), 3) + ' start orbits'], ['time bi-elliptic', fmt.sig((Bi.t1 + Bi.t2) / (2 * Math.PI), 3) + ' start orbits']],
      notes: ['Burns are instant (impulsive).', 'The probes are massless; the dust rings mark the start and target orbits.'],
      sources: ['vallado'], H, Bi, R, rb, t0,
    };
  },
  test: { n: 200 },
  check(spec) {
    const T = spec.t0 + spec.Bi.t1 + spec.Bi.t2 + 2;
    const { lab, events } = runCpu(spec, T, 300);
    const s = lab.sys, eH = s.elementsOf(1, 0), eB = s.elementsOf(2, 0);
    const burns = events.filter(e => e.type === 'burn').length;
    const good = burns === 5 && eH.e < 0.01 && eB.e < 0.01 && Math.abs(eH.a / spec.R - 1) < 0.01 && Math.abs(eB.a / spec.R - 1) < 0.01 && spec.Bi.total < spec.H.total;
    return { pass: good, info: `${burns} burns; Hohmann a/r2 ${fmt.sig(eH.a / spec.R, 4)} e ${eH.e.toExponential(1)}; bi-elliptic a/r2 ${fmt.sig(eB.a / spec.R, 4)} e ${eB.e.toExponential(1)}; dv ${fmt.sig(spec.Bi.total, 4)} < ${fmt.sig(spec.H.total, 4)}` };
  },
};

// ── gravity assist at Jupiter ───────────────────────────────────────────────
// The probe leaves 1 AU on an ellipse with aphelion Q and meets Jupiter at
// r = aJ. lead: where Jupiter is along its track at that time, AU ahead of
// the meeting point (ahead: the probe passes behind and gains energy).
function timeToRadius(a, e, rr) {
  const cE = (1 - rr / a) / e, E = Math.acos(Math.max(-1, Math.min(1, cE)));
  const f = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return { t: (E - e * Math.sin(E)) / Math.sqrt(1 / a ** 3), f };
}
export const slingshot = {
  key: 'slingshot', title: 'Gravity assist at Jupiter', group: 'orbits', variants: ['assist', 'brake', 'ulysses'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || ['assist', 'assist', 'brake', 'ulysses'][Math.floor(r() * 4)];
    const mJ = BODY.jupiter.m / MS, aJ = BODY.jupiter.a / AU;
    const Q = 5.6 + 1.2 * r(), at = (1 + Q) / 2, et = (Q - 1) / (Q + 1);
    const arr = timeToRadius(at, et, aJ), nJ = Math.sqrt((1 + mJ) / aJ ** 3);
    const lead = variant === 'brake' ? -(0.12 + 0.15 * r()) : variant === 'ulysses' ? 0 : 0.1 + 0.15 * r();
    const thJ = arr.f + lead / aJ - nJ * arr.t;
    const S = sun({ rDraw: 0.12 });
    const J = orbiting(S, 'Jupiter', 'jupiter', mJ, BODY.jupiter.R / AU, { a: aJ, e: 0, M: thJ }, { rDraw: 0.07 });
    let incl = 0;
    if (variant === 'ulysses') incl = Math.asin(Math.min(0.5, (0.12 + 0.1 * r()) / (aJ * Math.abs(Math.sin(arr.f)))));
    const pr = elementsToState(1, { a: at, e: et, i: incl, O: 0, w: 0, f: 0 });
    const B = [S, J, body('probe', 'probe', 0, 0, pr.r, pr.v, { rDraw: 0.03, color: COLORS.cyan, track: 1 })];
    toCOM(B);
    const P = new Parts(), gs = P.g('probe swarm', COLORS.cyan), gb = P.g('main belt', COLORS.dust);
    const ns = Math.floor(n * 0.5);
    for (let q = 0; q < ns; q++) {
      const dv = 1 + 0.012 * (r() - 0.5), da = 0.01 * gauss(r), dz = variant === 'ulysses' ? 0.01 * gauss(r) : 0.002 * gauss(r);
      const v = pr.v.slice(); const c = Math.cos(da), s = Math.sin(da);
      const vr = [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2] + dz * v3.len(v)];
      P.add(B[2].x, v3.mul(vr, dv), gs);
    }
    disk(P, B[0], { n: n - P.n, rin: 2.1, rout: 3.3, emax: 0.15, h: 0.08, g: gb, rand: r });
    const U = UNITS.solar();
    const verb = variant === 'brake' ? 'loses' : variant === 'ulysses' ? 'turns out of the ecliptic, as Ulysses did in 1992,' : 'gains';
    return {
      key: 'slingshot', title: 'Gravity assist at Jupiter', variant, seed,
      blurb: `A probe passes ${variant === 'brake' ? 'in front of' : variant === 'ulysses' ? 'over the pole of' : 'behind'} Jupiter and ${verb} ${variant === 'ulysses' ? '' : 'orbital energy'}: momentum moves between the planet and the probe.`,
      scale: U, bodies: B, opts: { eta: 0.01, watch: [[1, 2]], escapeR: 12 },
      particles: P.done(0.01), pool: 0,
      dt: 0.004, rate: 1.2, duration: arr.t + 25,
      view: { center: 'com', extent: 7, tilt: 25, follow: 2 },
      cues: ['periapsis', 'ejection'], tArrive: arr.t, at,
      tex: ['\\vec v_{\\text{out}} = \\vec v_J + R(\\delta)\\,(\\vec v_{\\text{in}} - \\vec v_J)', '|\\vec v_{\\text{in}} - \\vec v_J| = |\\vec v_{\\text{out}} - \\vec v_J|', '\\sin\\tfrac{\\delta}{2} = \\frac{1}{1 + r_p v_\\infty^2/GM_J}'],
      facts: [['Jupiter mass', '1.898 × 10^27 kg'], ['Jupiter a', '5.20 AU'], ['transfer aphelion', fmt.sig(Q) + ' AU'], ['flight time to Jupiter', fmt.sig(arr.t * U.T / C.YEAR) + ' yr'], ['Jupiter lead at arrival', fmt.sig(lead) + ' AU']],
      notes: ["Jupiter's orbit is a circle here (real e = 0.049).", 'The probes are massless; a swarm with small launch errors shows the spread of outcomes.', 'Bodies are drawn far larger than their true size.'],
      sources: ['nssdc'],
    };
  },
  focus: slingshotFocus,
  test: { n: 200 },
  check(spec) {
    const { lab, events } = runCpu(spec, spec.tArrive + 12, 300);
    const s = lab.sys, e = s.elementsOf(2, 0);
    const u = v3.sub(s.vel(2), s.vel(0)), E = 0.5 * v3.dot(u, u) - 1 / v3.len(v3.sub(s.pos(2), s.pos(0)));
    const peri = events.find(x => x.type === 'periapsis' && x.j === 2);
    const Ebefore = -1 / (2 * spec.at);
    let pass, info;
    const dE = E - Ebefore;
    if (spec.variant === 'assist') { pass = !!peri && dE > 0.01; info = `heliocentric energy ${fmt.sig(Ebefore)} -> ${fmt.sig(E)} (gain), closest ${peri ? fmt.sig(peri.d) : '-'} AU`; }
    else if (spec.variant === 'brake') { pass = !!peri && dE < -0.01; info = `heliocentric energy ${fmt.sig(Ebefore)} -> ${fmt.sig(E)} (loss), closest ${peri ? fmt.sig(peri.d) : '-'} AU`; }
    else { pass = !!peri && e.i > 5 * DEG; info = `inclination after the flyby ${fmt.sig(e.i / DEG)} deg, closest ${peri ? fmt.sig(peri.d) : '-'} AU`; }
    return { pass, info };
  },
};

// ── the Solar System ────────────────────────────────────────────────────────
export const solar = {
  key: 'solar', title: 'The Solar System', group: 'orbits', variants: ['inner', 'whole'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.5 ? 'inner' : 'whole');
    const B = [sun({ rDraw: variant === 'inner' ? 0.08 : 0.5 })];
    for (const nm of PLANETS) {
      const d = BODY[nm];
      B.push(orbiting(B[0], nm[0].toUpperCase() + nm.slice(1), KIND[nm], d.m / MS, d.R / AU, { a: d.a / AU, e: d.e, i: d.i * DEG, O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: 2 * Math.PI * r() },
        { rDraw: (variant === 'inner' ? 0.025 : 0.2) * (d.m > 1e26 ? 1.8 : 1) }));
    }
    toCOM(B);
    const P = new Parts(), gb = P.g('main belt', COLORS.dust), gt = P.g('Jupiter Trojans', COLORS.amber), gk = P.g('Kuiper belt', COLORS.ice);
    const J = B[5], thJ = Math.atan2(J.x[1], J.x[0]);
    const nb = Math.floor(n * (variant === 'inner' ? 0.75 : 0.45)), nt = Math.floor(n * 0.1);
    disk(P, B[0], { n: nb, rin: 2.1, rout: 3.3, emax: 0.2, h: 0.1, g: gb, rand: r });
    for (let q = 0; q < nt; q++) {
      const side = q % 2 ? 1 : -1, a = 5.2 * (1 + 0.02 * gauss(r)), th = thJ + side * Math.PI / 3 + 0.25 * gauss(r);
      const s = elementsToState(1, { a, e: 0.05 * r(), i: 0.1 * Math.abs(gauss(r)), O: th, w: 0, M: 0 });
      // M = 0 at node O: the particle sits at angle th
      P.add(v3.add(B[0].x, s.r), v3.add(B[0].v, s.v), gt);
    }
    disk(P, B[0], { n: n - P.n, rin: 39, rout: 48, emax: 0.15, h: 0.1, g: gk, rand: r });
    const U = UNITS.solar();
    return {
      key: 'solar', title: 'The Solar System', variant, seed,
      blurb: variant === 'inner' ? 'Mercury to Jupiter, the main belt and the Trojans that share Jupiter\'s orbit.' : 'Eight planets, the main belt, the Trojans and the Kuiper belt.',
      scale: U, bodies: B, opts: { eta: 0.02, watch: [[0, 3], [0, 5]] },
      particles: P.done(variant === 'inner' ? 0.006 : 0.05), pool: 0,
      dt: variant === 'inner' ? 0.04 : 0.15, rate: variant === 'inner' ? 2.5 : 40, duration: variant === 'inner' ? 160 : 3000,
      view: { center: 0, extent: variant === 'inner' ? 6.5 : 50, tilt: 30 },
      cues: ['periapsis'],
      tex: ['\\ddot{\\vec r}_i = -\\sum_{j\\neq i} \\frac{G m_j (\\vec r_i - \\vec r_j)}{|\\vec r_i - \\vec r_j|^3}', 'T_\\oplus = 365.256\\,\\text{d}'],
      facts: PLANETS.slice(0, variant === 'inner' ? 5 : 8).map(nm => [nm[0].toUpperCase() + nm.slice(1), `a = ${fmt.sig(BODY[nm].a / AU)} AU, m = ${fmt.sig(BODY[nm].m)} kg`]),
      notes: ['Real masses, sizes of orbits, eccentricities and inclinations; the phases are random.', 'Planets are drawn far larger than their true size.', 'Belt particles are massless tracers.'],
      sources: ['nssdc', 'iau'],
    };
  },
  test: { n: 200 },
  check(spec) {
    // sidereal periods from the unwrapped longitude about the Sun
    const TJ = period(1, BODY.jupiter.a / AU), ang = [0, 0], last = [null, null], idx = [3, 5];
    runCpu(spec, 1.2 * TJ, 600, lab => {
      const s = lab.sys;
      idx.forEach((b, k) => {
        const d = v3.sub(s.pos(b), s.pos(0)), th = Math.atan2(d[1], d[0]);
        if (last[k] !== null) { let dt = th - last[k]; dt -= 2 * Math.PI * Math.round(dt / (2 * Math.PI)); ang[k] += dt; }
        last[k] = th;
      });
    });
    const yr = spec.scale.T / C.YEAR, T = 1.2 * TJ;
    const Te = 2 * Math.PI * T / ang[0] * yr, Tj = 2 * Math.PI * T / ang[1] * yr;
    const pass = Math.abs(Tj - 11.862) / 11.862 < 0.03 && Math.abs(Te - 1.0000) < 0.01;
    return { pass, info: `mean sidereal periods: Earth ${fmt.sig(Te, 4)} yr (1.000), Jupiter ${fmt.sig(Tj, 4)} yr (11.86; one orbit, eccentric, so the mean rate is not exact)` };
  },
};

// ── the Hill sphere ─────────────────────────────────────────────────────────
export const hill = {
  key: 'hill', title: 'The edge of a planet\'s grip', group: 'orbits', variants: ['jupiter', 'neptune'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.5 ? 'jupiter' : 'neptune');
    const d = BODY[variant], mu = d.m / MS, a = 1;
    const S = body('Sun', 'sun', 1, BODY.sun.R / (d.a), [0, 0, 0], [0, 0, 0], { rDraw: 0.05 });
    const Pl = orbiting(S, variant[0].toUpperCase() + variant.slice(1), KIND[variant], mu, d.R / d.a, { a, e: 0, M: 0 }, { rDraw: 0.012 });
    const B = [S, Pl]; toCOM(B);
    const RH = hillR(a, mu, 1);
    const P = new Parts(), gp = P.g('prograde moons', COLORS.cyan), gr = P.g('retrograde moons', COLORS.rose);
    const c = { m: mu, x: B[1].x, v: B[1].v };
    halo(P, c, { n: Math.floor(n / 2), rin: 0.15 * RH, rout: 1.0 * RH, prograde: 1, spread: 0.15, g: gp, rand: r });
    halo(P, c, { n: n - P.n, rin: 0.15 * RH, rout: 1.0 * RH, prograde: -1, spread: 0.15, g: gr, rand: r });
    const U = unitsOf(d.a, MS, { L: variant === 'jupiter' ? '5.2 AU' : '30.1 AU', M: 'M☉', T: 'T' });
    return {
      key: 'hill', title: "The edge of a planet's grip", variant, seed,
      blurb: 'Moons in the outer half of the Hill sphere are pulled away by the Sun; backward-orbiting moons survive further out.',
      scale: U, bodies: B, opts: { eta: 0.02 }, particles: P.done(RH * 0.004), pool: 0,
      dt: period(mu, 0.15 * RH) / 150, rate: 2 * Math.PI / 12, duration: 2 * Math.PI * 8,
      view: { center: 1, extent: RH * 2.2, tilt: 70, rotating: [0, 1] },
      cues: [], RH, mu,
      tex: ['r_H = a\\sqrt[3]{\\frac{m}{3M}}', 'r_{\\text{stable}} \\approx 0.5\\,r_H\\ (\\text{prograde}),\\ 0.7\\,r_H\\ (\\text{retrograde})'],
      facts: [[variant + ' Hill radius', fmt.au(RH * d.a) + ' = ' + fmt.km(RH * d.a)], ['mass ratio m/M', fmt.sig(mu)]],
      notes: ['Moons are massless tracers on circular orbits about the planet at the start.', 'The planet orbit is a circle.'],
      sources: ['nssdc'],
    };
  },
  test: { n: 600 },
  check(spec) {
    const { lab } = runCpu(spec, 2 * Math.PI * 6, 300);
    const rb = lab.be.readback(), s = lab.sys, X = s.pos(1), V = s.vel(1), RH = spec.RH, P = spec.particles;
    const bins = { pro: [[0, 0], [0, 0]], ret: [[0, 0], [0, 0]] };
    for (let i = 0; i < P.n; i++) {
      const r0 = v3.len(v3.sub([P.pos[3 * i], P.pos[3 * i + 1], P.pos[3 * i + 2]], spec.bodies[1].x)) / RH;
      const k = r0 < 0.4 ? 0 : r0 > 0.6 && r0 < 0.8 ? 1 : -1; if (k < 0) continue;
      const o = 12 * i, alive = rb.body[o + 7] > 0;
      let bound = false;
      if (alive) { const d = v3.sub([rb.body[o], rb.body[o + 1], rb.body[o + 2]], X), u = v3.sub([rb.body[o + 4], rb.body[o + 5], rb.body[o + 6]], V); bound = v3.len(d) < RH && 0.5 * v3.dot(u, u) - spec.mu / v3.len(d) < 0; }
      const b = P.group[i] === 0 ? bins.pro : bins.ret; b[k][0]++; if (bound) b[k][1]++;
    }
    const f = b => b[1] / Math.max(1, b[0]);
    const pin = f(bins.pro[0]), pout = f(bins.pro[1]), rout = f(bins.ret[1]);
    return { pass: pin > 0.9 && pout < 0.5 && rout > pout + 0.2, info: `bound after 6 orbits: prograde r < 0.4 rH ${(100 * pin).toFixed(0)}%, prograde 0.6-0.8 rH ${(100 * pout).toFixed(0)}%, retrograde 0.6-0.8 rH ${(100 * rout).toFixed(0)}%` };
  },
};
