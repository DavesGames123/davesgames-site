// ============================================================================
//  GRAVITY LAB  ·  experiments/points.js — the Lagrange points and co-orbits
// ----------------------------------------------------------------------------
//  lagrange   dust at all five Lagrange points: L1, L2, L3 leave, L4 and L5
//             hold (below Routh's mass ratio 0.0385) or fail (above it)
//  horseshoe  tadpole and horseshoe orbits of co-orbital dust; Janus and
//             Epimetheus trade orbits
//  trojans    a ring of dust at Jupiter's distance sorts itself into the
//             two Trojan swarms; the Hildas make a triangle at 3:2
//  Film these in the frame that turns with the pair (view.rotating).
// ============================================================================
import { C, BODY, unitsOf, ROUTH_MU } from '../data.js';
import { body, orbiting, Parts, disk, COLORS, DEG, rng, gauss, v3, elementsToState, toCOM, period, runCpu, fmt } from './common.js';
import { lagrangePoints } from '../nbody.js';

const AU = C.AU, MS = C.MSUN;
// angle of p about the primary, in the frame that turns with the secondary
function relAngle(s, i, j, p) {
  const a = v3.sub(s.pos(j), s.pos(i)), b = v3.sub(p, s.pos(i));
  return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
}
// a point p in the rotating frame of pair (i, j) (separation 1 units of
// the pair, primary at -mu): returns [x, y]
function toRot(s, i, j, p) {
  const M = s.m[i] + s.m[j], c = v3.mul(v3.add(v3.mul(s.pos(i), s.m[i]), v3.mul(s.pos(j), s.m[j])), 1 / M);
  const ax = v3.sub(s.pos(j), s.pos(i)), d = v3.len(ax), ex = v3.mul(ax, 1 / d), ey = [-ex[1], ex[0], 0];
  const q = v3.sub(p, c);
  return [v3.dot(q, ex) / d, v3.dot(q, ey) / d];
}

// ── the five Lagrange points ────────────────────────────────────────────────
const PAIRS = {
  'earth-moon': { mu: BODY.moon.m / (BODY.earth.m + BODY.moon.m), names: ['Earth', 'Moon'], kinds: ['earth', 'moon'], R: [BODY.earth.R / BODY.moon.a, BODY.moon.R / BODY.moon.a], L: BODY.moon.a, M: BODY.earth.m + BODY.moon.m, nameL: '384,400 km' },
  'sun-jupiter': { mu: BODY.jupiter.m / (MS + BODY.jupiter.m), names: ['Sun', 'Jupiter'], kinds: ['sun', 'jupiter'], R: [BODY.sun.R / BODY.jupiter.a, BODY.jupiter.R / BODY.jupiter.a], L: BODY.jupiter.a, M: MS, nameL: '5.2 AU' },
  'pluto-charon': { mu: BODY.charon.m / (BODY.pluto.m + BODY.charon.m), names: ['Pluto', 'Charon'], kinds: ['ice', 'rock'], R: [BODY.pluto.R / BODY.charon.a, BODY.charon.R / BODY.charon.a], L: BODY.charon.a, M: BODY.pluto.m + BODY.charon.m, nameL: '19,596 km' },
};
export const lagrange = {
  key: 'lagrange', title: 'The five Lagrange points', group: 'points', variants: ['earth-moon', 'sun-jupiter', 'pluto-charon'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || ['earth-moon', 'earth-moon', 'sun-jupiter', 'pluto-charon'][Math.floor(r() * 4)];
    const D = PAIRS[variant], mu = D.mu;
    const draw = variant === 'sun-jupiter' ? [0.06, 0.025] : [0.05, 0.025];
    const B = [body(D.names[0], D.kinds[0], 1 - mu, D.R[0], [-mu, 0, 0], [0, -mu, 0], { rDraw: Math.max(D.R[0], draw[0]) }),
      body(D.names[1], D.kinds[1], mu, D.R[1], [1 - mu, 0, 0], [0, 1 - mu, 0], { rDraw: Math.max(D.R[1], draw[1]) })];
    const Lp = lagrangePoints(mu), P = new Parts();
    const cols = [COLORS.rose, COLORS.amber, COLORS.violet, COLORS.cyan, COLORS.green];
    for (let k = 0; k < 5; k++) {
      // L4, L5: a spread of 0.1 sqrt(3 mu) keeps the dust on tadpoles
      const g = P.g('L' + (k + 1), cols[k]), m = Math.floor(n / 5), sig = k < 3 ? 0.004 : Math.min(0.02, 0.1 * Math.sqrt(3 * mu));
      for (let q = 0; q < m; q++) {
        const p = [Lp[k][0] + sig * gauss(r), Lp[k][1] + sig * gauss(r), 0.2 * sig * gauss(r)];
        P.add(p, [-p[1], p[0], 0], g);   // at rest in the turning frame: v = Omega x r, Omega = 1
      }
    }
    const stable = mu < ROUTH_MU;
    return {
      key: 'lagrange', title: 'The five Lagrange points', variant, seed,
      blurb: stable ? 'Dust at L1, L2 and L3 drifts away; dust at L4 and L5 stays, 60° ahead of and behind the moon.' : `With μ = ${fmt.sig(mu)} above Routh's limit 0.0385, even L4 and L5 cannot hold the dust.`,
      scale: unitsOf(D.L, D.M, { L: D.nameL, M: D.names.join('+') + ' mass', T: 'T/2π' }), bodies: B, opts: { eta: 0.02 },
      particles: P.done(0.004), pool: 0, mu, Lp,
      dt: 2 * Math.PI / 1500, rate: 2 * Math.PI / 5, duration: 2 * Math.PI * 12,
      view: { center: 'com', extent: 1.6, tilt: 70, rotating: [0, 1] },
      cues: [],
      tex: ['\\nabla\\Phi_{\\text{eff}} = 0,\\quad \\Phi_{\\text{eff}} = -\\frac{G M_1}{r_1} - \\frac{G M_2}{r_2} - \\tfrac12 \\Omega^2 r^2', '\\mu < \\tfrac12\\left(1 - \\sqrt{\\tfrac{23}{27}}\\right) \\approx 0.0385'],
      facts: [['mass ratio μ', fmt.sig(mu, 4)], ['L1', fmt.sig(Lp[0][0], 5)], ['L2', fmt.sig(Lp[1][0], 5)], ['L3', fmt.sig(Lp[2][0], 5)], ['L4, L5', '±60° from the secondary']],
      notes: ['Circular orbit of the pair; the dust is massless.', 'Distances in units of the separation.'],
      sources: ['nssdc', 'jplsat', 'routh'],
    };
  },
  test: { n: 300 },
  check(spec) {
    const { lab } = runCpu(spec, 2 * Math.PI * 8, 200);
    const rb = lab.be.readback(), s = lab.sys, P = spec.particles, med = [[], [], [], [], []];
    for (let i = 0; i < P.n; i++) {
      const o = 12 * i, g = P.group[i];
      if (!(rb.body[o + 7] > 0)) { med[g].push(999); continue; }
      const q = toRot(s, 0, 1, [rb.body[o], rb.body[o + 1], rb.body[o + 2]]);
      // L4, L5: the angle from the point seen from the primary (tadpoles
      // swing along the orbit); L1-L3: the distance
      if (g >= 3) { const a0 = Math.atan2(spec.Lp[g][1], spec.Lp[g][0] + spec.mu), a1 = Math.atan2(q[1], q[0] + spec.mu); let d = a1 - a0; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); med[g].push(Math.abs(d) / DEG + (Math.abs(Math.hypot(q[0] + spec.mu, q[1]) - 1) > 0.2 ? 180 : 0)); }
      else med[g].push(Math.hypot(q[0] - spec.Lp[g][0], q[1] - spec.Lp[g][1]));
    }
    const m = med.map(a => a.sort((x, y) => x - y)[a.length >> 1]);
    const stable = spec.mu < ROUTH_MU;
    const pass = m[0] > 0.1 && m[1] > 0.1 && m[2] > 0.1 && (stable ? m[3] < 35 && m[4] < 35 : m[3] > 35 && m[4] > 35);
    return { pass, info: `median drift after 8 orbits: L1 ${fmt.sig(m[0])}, L2 ${fmt.sig(m[1])}, L3 ${fmt.sig(m[2])}, L4 ${fmt.sig(m[3])} deg, L5 ${fmt.sig(m[4])} deg (mu ${fmt.sig(spec.mu)}, Routh 0.0385)` };
  },
};

// ── tadpoles and horseshoes ─────────────────────────────────────────────────
const JE_SCALE = 1e5;
export const horseshoe = {
  key: 'horseshoe', title: 'Tadpoles and horseshoes', group: 'points', variants: ['dust', 'janus-epimetheus'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.55 ? 'dust' : 'janus-epimetheus');
    const P = new Parts();
    if (variant === 'dust') {
      const mu = 5e-4 + 1.5e-3 * r(), w = Math.sqrt(8 * mu / 3);
      const S = body('Star', 'sun', 1, 0.02, [0, 0, 0], [0, 0, 0], { rDraw: 0.05 });
      const Pl = orbiting(S, 'planet', 'jupiter', mu, 0.002, { a: 1, e: 0, M: 0 }, { rDraw: 0.02 });
      const B = [S, Pl]; toCOM(B);
      const gt = P.g('tadpoles', COLORS.cyan), gh = P.g('horseshoes', COLORS.amber), gp = P.g('passing', COLORS.dust);
      for (let q = 0; q < n; q++) {
        let d; do { d = (2 * r() - 1) * 2.2 * w; } while (Math.abs(d) < 0.02 * w);
        const ad = Math.abs(d) / w, th = 0.25 + (2 * Math.PI - 0.5) * r();
        const g = ad < 1 ? (Math.abs(th - Math.PI) > 1.1 && ad < 0.5 ? gt : gh) : gp;
        const s = elementsToState(1, { a: 1 + d, e: 0, M: th + Math.atan2(B[1].x[1], B[1].x[0]) });
        P.add(v3.add(B[0].x, s.r), v3.add(B[0].v, s.v), g);
      }
      return {
        key: 'horseshoe', title: 'Tadpoles and horseshoes', variant, seed,
        blurb: 'Dust just inside and outside a planet\'s orbit is turned back as it catches up: tadpoles about L4 and L5, horseshoes round both.',
        scale: unitsOf(BODY.jupiter.a, MS, { L: '5.2 AU', M: 'M☉', T: 'T/2π' }), bodies: B, opts: { eta: 0.02 },
        particles: P.done(0.003), pool: 0, mu, w,
        dt: 2 * Math.PI / 600, rate: 2 * Math.PI * 4, duration: 2 * Math.PI * 4 / (1.5 * w) ,
        view: { center: 'com', extent: 1.25, tilt: 80, rotating: [0, 1] },
        cues: [],
        tex: ['\\frac{\\Delta a}{a} < \\sqrt{\\tfrac{8\\mu}{3}}', 'T_{\\text{syn}} = \\frac{2\\pi}{\\tfrac32 n\\,\\Delta a / a}'],
        facts: [['planet mass ratio μ', fmt.sig(mu)], ['horseshoe half-width √(8μ/3)', fmt.sig(w)]],
        notes: ['The dust is massless; the planet is on a circle.'],
        sources: ['nssdc'],
      };
    }
    // Janus and Epimetheus, masses x JE_SCALE, gap x cbrt(JE_SCALE): the
    // closest approach stays the same number of Hill radii
    const Ms = BODY.saturn.m, L = BODY.janus.a;
    const mJ = BODY.janus.m / Ms * JE_SCALE, mE = BODY.epimetheus.m / Ms * JE_SCALE;
    const da = (BODY.janus.a - BODY.epimetheus.a) / L * Math.cbrt(JE_SCALE) * (1.3 + 0.2 * r());
    const S = body('Saturn', 'saturn', 1, BODY.saturn.R / L, [0, 0, 0], [0, 0, 0], { rDraw: BODY.saturn.R / L });
    const th0 = Math.PI * (0.9 + 0.2 * r());   // far apart: the start of a horseshoe
    const Ja = orbiting(S, 'Janus', 'rock', mJ, BODY.janus.R / L, { a: 1, e: 0, M: 0 }, { rDraw: 0.012 });
    const Ep = orbiting(S, 'Epimetheus', 'rock', mE, BODY.epimetheus.R / L, { a: 1 - da, e: 0, M: th0 }, { rDraw: 0.009 });
    const B = [S, Ja, Ep]; toCOM(B);
    const gr = P.g('A ring edge', COLORS.ice), gd = P.g('co-orbital dust', COLORS.dust);
    const ARing = 136.775e6 / L;
    disk(P, B[0], { n: Math.floor(n * 0.6), rin: 122.17e6 / L, rout: ARing, h: 0.0005, g: gr, rand: r });
    disk(P, B[0], { n: n - P.n, rin: 1 - 2.5 * da, rout: 1 + 1.5 * da, h: 0.0005, g: gd, rand: r });
    return {
      key: 'horseshoe', title: 'Janus and Epimetheus trade places', variant, seed,
      blurb: 'Two moons share one orbit. Every few years the inner one catches up, the two pull on each other and swap orbits without ever meeting.',
      scale: unitsOf(L, Ms, { L: '151,460 km', M: 'Saturn mass', T: 'T/2π' }), bodies: B,
      opts: { eta: 0.02, watch: [[1, 2]] }, particles: P.done(0.0015), pool: 0, da,
      dt: 2 * Math.PI / 400, rate: 2 * Math.PI * 4, duration: 2.6 * 2 * Math.PI / (1.5 * da),
      view: { center: 'com', extent: 1.15, tilt: 80, rotating: [0, 1] },
      cues: ['periapsis'],
      tex: ['\\Delta a \\approx 50\\ \\text{km},\\quad T_{\\text{swap}} \\approx 4\\ \\text{yr}', 'r_H = a\\sqrt[3]{\\mu/3},\\quad \\Delta a_{\\text{real}} \\approx 0.3\\,r_H'],
      facts: [['Janus mass', fmt.sig(BODY.janus.m) + ' kg'], ['Epimetheus mass', fmt.sig(BODY.epimetheus.m) + ' kg'], ['real orbit gap', '50 km'], ['real swap period', '4.0 yr']],
      notes: [`Both masses ×${fmt.sig(JE_SCALE)} and the orbit gap ×${fmt.sig(da / ((BODY.janus.a - BODY.epimetheus.a) / L), 2)}, so a swap takes about ${fmt.sig(1 / (1.5 * da), 2)} orbits, not about 3000. The gap is about 0.4 Hill radii (0.3 in the real pair), so the moons turn back about 20° apart.`, 'Ring particles are massless.'],
      sources: ['jplsat', 'nssdc'],
    };
  },
  test: { n: 400 },
  check(spec) {
    if (spec.variant === 'dust') {
      // particles well inside the horseshoe zone never cross the planet's
      // longitude in one synodic period; passing ones do
      const P = spec.particles, last = new Float64Array(P.n).fill(NaN), cross = new Uint8Array(P.n);
      const T = 2 * Math.PI / (1.5 * 0.5 * spec.w);
      runCpu(spec, T, 400, (lab, rb) => {
        for (let i = 0; i < P.n; i++) {
          const o = 12 * i; if (!(rb.body[o + 7] > 0)) continue;
          const th = relAngle(lab.sys, 0, 1, [rb.body[o], rb.body[o + 1], rb.body[o + 2]]);
          if (!isNaN(last[i]) && Math.abs(th - last[i]) < 1 && Math.sign(th) !== Math.sign(last[i])) cross[i] = 1;
          last[i] = th;
        }
      });
      let inC = 0, inN = 0, outC = 0, outN = 0;
      for (let i = 0; i < P.n; i++) {
        const d = Math.abs(Math.hypot(P.pos[3 * i], P.pos[3 * i + 1]) - 1) / spec.w;
        if (d < 0.6) { inN++; inC += cross[i]; } else if (d > 1.6) { outN++; outC += cross[i]; }
      }
      const pass = inC / inN < 0.08 && outC / outN > 0.9;
      return { pass, info: `crossed the planet's longitude in one synodic period: inner zone ${inC}/${inN}, outside the horseshoe ${outC}/${outN}` };
    }
    // the inner moon becomes the outer one and back, with no contact
    const sgn = [];
    const { lab } = runCpu(spec, spec.duration, 400, lab => { const s = lab.sys; sgn.push(Math.sign(s.elementsOf(1, 0).a - s.elementsOf(2, 0).a)); });
    let swaps = 0; for (let k = 1; k < sgn.length; k++) if (sgn[k] !== sgn[k - 1]) swaps++;
    const alive = lab.sys.alive[1] && lab.sys.alive[2];
    return { pass: swaps >= 2 && alive, info: `${swaps} swaps of the inner and outer orbit in ${fmt.sig(spec.duration / (2 * Math.PI))} orbits, both moons whole: ${!!alive}` };
  },
};

// ── the Trojans and the Hildas ──────────────────────────────────────────────
export const trojans = {
  key: 'trojans', title: "Jupiter's Trojans and Hildas", group: 'points', variants: ['trojans', 'hildas'],
  build(seed, o = {}) {
    const r = rng(seed), n = o.n || 16384, variant = o.variant || (r() < 0.5 ? 'trojans' : 'hildas');
    const mJ = BODY.jupiter.m / MS, aJ = BODY.jupiter.a / AU;
    const S = body('Sun', 'sun', 1, BODY.sun.R / AU, [0, 0, 0], [0, 0, 0], { rDraw: 0.12 });
    const J = orbiting(S, 'Jupiter', 'jupiter', mJ, BODY.jupiter.R / AU, { a: aJ, e: 0, M: 0 }, { rDraw: 0.07 });
    const B = [S, J]; toCOM(B);
    const P = new Parts();
    if (variant === 'trojans') {
      const g = P.g('co-orbital dust', COLORS.amber);
      disk(P, B[0], { n, rin: aJ * 0.94, rout: aJ * 1.06, emax: 0.03, h: 0.02, g, rand: r });
    } else {
      // 3:2 with Jupiter: a = aJ (2/3)^(2/3) = 3.97 AU, e 0.1-0.3, the
      // perihelia placed so that the resonant angle starts near 0
      const gh = P.g('Hildas (3:2)', COLORS.cyan), gb = P.g('outer main belt', COLORS.dust), a32 = aJ * Math.pow(2 / 3, 2 / 3);
      const nh = Math.floor(n * 0.6);
      for (let q = 0; q < nh; q++) {
        const a = a32 * (1 + 0.01 * gauss(r)), e = 0.1 + 0.2 * r(), lam = 2 * Math.PI * r();
        // resonant angle 3 lambda_J - 2 lambda - varpi = 0, plus a
        // libration: varpi follows from lambda (O = 0, so w = varpi)
        const lamJ = Math.atan2(B[1].x[1], B[1].x[0]);
        const varpi = 3 * lamJ - 2 * lam + 0.4 * gauss(r);
        const s = elementsToState(1, { a, e, i: 0.05 * Math.abs(gauss(r)), O: 0, w: varpi, M: lam - varpi });
        P.add(v3.add(B[0].x, s.r), v3.add(B[0].v, s.v), gh);
      }
      disk(P, B[0], { n: n - P.n, rin: 2.8, rout: 3.5, emax: 0.15, h: 0.05, g: gb, rand: r });
    }
    return {
      key: 'trojans', title: variant === 'trojans' ? "Jupiter's Trojan swarms" : 'The Hilda triangle', variant, seed,
      blurb: variant === 'trojans' ? "A ring of dust along Jupiter's orbit gathers into two swarms, 60° ahead and 60° behind, as the real Trojan asteroids do." : 'Asteroids in the 3:2 resonance with Jupiter trace a triangle that turns with the planet.',
      scale: unitsOf(AU, MS, { L: 'AU', M: 'M☉', T: 'yr/2π' }), bodies: B, opts: { eta: 0.02 },
      particles: P.done(0.012), pool: 0, aJ,
      dt: period(1, 2.8) / 250, rate: period(1, aJ) / 6, duration: period(1, aJ) * 30,
      view: { center: 'com', extent: aJ * 1.25, tilt: 80, rotating: [0, 1] },
      cues: [],
      tex: variant === 'trojans' ? ['\\phi = \\lambda - \\lambda_J \\approx \\pm 60^\\circ'] : ['3\\lambda_J - 2\\lambda - \\varpi \\approx 0', 'a_{3:2} = a_J\\,(2/3)^{2/3} = 3.97\\ \\text{AU}'],
      facts: [['Jupiter mass ratio', fmt.sig(mJ)], ['Jupiter a', fmt.sig(aJ) + ' AU'], ['known Jupiter Trojans', 'over 15,000 (2024)']],
      notes: ["Jupiter's orbit is a circle; Saturn is left out.", 'The dust is massless.'],
      sources: ['nssdc'],
    };
  },
  test: { n: 400 },
  check(spec) {
    const TJ = period(1, spec.aJ);
    const { lab } = runCpu(spec, TJ * (spec.variant === 'trojans' ? 25 : 6), 300);
    const rb = lab.be.readback(), s = lab.sys, P = spec.particles;
    if (spec.variant === 'trojans') {
      let co = 0, near = 0;
      for (let i = 0; i < P.n; i++) {
        const o = 12 * i; if (!(rb.body[o + 7] > 0)) continue;
        const p = [rb.body[o], rb.body[o + 1], rb.body[o + 2]], rr = v3.len(v3.sub(p, s.pos(0)));
        if (Math.abs(rr / spec.aJ - 1) > 0.08) continue;
        co++;
        const th = relAngle(s, 0, 1, p);
        if (Math.abs(Math.abs(th) - Math.PI / 3) < 0.6) near++;
      }
      const f = near / Math.max(1, co);
      return { pass: f > 0.4, info: `${co} co-orbital survivors after 25 Jupiter orbits, ${(100 * f).toFixed(0)}% within 34° of L4 or L5 (a uniform ring: 38%)` };
    }
    // Hildas: few come near Jupiter (the resonance shields them)
    let close = 0, alive = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.group[i] !== 0) continue;
      const o = 12 * i; if (!(rb.body[o + 7] > 0)) continue; alive++;
      const p = [rb.body[o], rb.body[o + 1], rb.body[o + 2]], rr = v3.len(v3.sub(p, s.pos(0)));
      if (rr > 5.5 || rr < 2.5) close++;
    }
    return { pass: alive > 0 && close / alive < 0.1, info: `Hildas after 6 Jupiter orbits: ${alive} remain, ${close} left the 2.5-5.5 AU band` };
  },
};
