// ============================================================================
//  GRAVITY LAB  ·  roll.js — the dense randomizer (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  roll(seed, o) -> one spec (experiments/common.js "THE SPEC") with a short
//  generated title, from one integer. The same seed gives the same run on
//  every machine (?seed= in the link). o: { n (particle budget), family }.
//
//  THREE FAMILIES (weights in FAMILY_W)
//    library   one variant of the 22 experiments (experiments/index.js),
//              with a fresh seed
//    intruder  a library run with one more thing thrown in on a computed
//              hyperbolic path that reaches its closest approach 5 to 9 s
//              after the start at Normal speed: a black hole, a star, a
//              rogue planet, a rubble pile (aimed inside the Roche limit),
//              a comet swarm, a dust cloud, or a third galaxy
//    sandbox   a scene generated from the item types (SANDBOX): a knot of
//              suns, packed giant planets, a rubble moon that dives at a
//              ringed planet, two suns and a disk, stars around a black
//              hole, a comet storm, three galaxies, a triple star, Trojans
//              under fire, a crowd of moons, probes at a giant planet
//
//  Every sandbox body uses real-scale masses in its units (data.js unitsOf)
//  and real laws; sizes are drawn (and collide) far larger than true, and
//  the notes on each spec say so.
//
//  prepare(spec, budget) -> the spec as the page runs it: a spawn pool for
//  the tray (items.js) and for merge ejecta, an escape radius for the
//  ejection events, and the cue list.
//
//  grep -n targets: "export function roll", "export const SANDBOX",
//  "function intruder", "function incoming", "export function prepare",
//  "export const FAMILY_W", "function titleOf"
// ============================================================================
import { EXPERIMENTS, build as buildExp, bag as expBag } from './experiments/index.js';
import { body, orbiting, Parts, disk, halo, COLORS, DEG, rng, gauss, v3, elementsToState, toCOM, period, fmt } from './experiments/common.js';
import { C, BODY, unitsOf, UNITS } from './data.js';
import { MAXB } from './nbody.js';

export const FAMILY_W = { library: 0.3, intruder: 0.3, sandbox: 0.4 };
const pickW = (r, w) => { let s = 0; const tot = Object.values(w).reduce((a, b) => a + b, 0), u = r() * tot; for (const [k, x] of Object.entries(w)) { s += x; if (u < s) return k; } return Object.keys(w)[0]; };
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const range = (r, a, b) => a + (b - a) * r();
const logU = (r, a, b) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * r());
const GREEK = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];
const cap = s => s[0].toUpperCase() + s.slice(1);
const word = k => NUM[k] || String(k);

// ── the hyperbolic path of an intruder ──────────────────────────────────────
// Relative state (to the body it meets) that reaches periapsis q after tp,
// with speed vinf at infinity. Angles: incl, node, w (rad).
export function incoming(GM, q, vinf, tp, incl = 0, node = 0, w = 0) {
  const a = GM / (vinf * vinf), e = 1 + q * vinf * vinf / GM, n = Math.sqrt(GM / a ** 3);
  const Mh = -n * tp;
  let F = Math.asinh(Mh / e);
  for (let k = 0; k < 60; k++) { const d = (e * Math.sinh(F) - F - Mh) / (e * Math.cosh(F) - 1); F -= d; if (Math.abs(d) < 1e-13) break; }
  const f = 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(F / 2));
  const s = elementsToState(GM, { p: q * (1 + e), e, f, i: incl, O: node, w });
  return { r: s.r, v: s.v, e, f };
}
function heaviest(B) { let k = 0; B.forEach((b, i) => { if (b.m > B[k].m) k = i; }); return k; }
function starKind(m) { return m < 0.45 ? 'redDwarf' : m < 1.4 ? 'sun' : 'blue'; }
function concatParts(P, add, g) {
  const n = P.n + add.n, pos = new Float64Array(3 * n), vel = new Float64Array(3 * n), group = new Uint8Array(n);
  pos.set(P.pos); pos.set(add.pos, 3 * P.n); vel.set(P.vel); vel.set(add.vel, 3 * P.n);
  group.set(P.group || new Uint8Array(P.n)); group.fill(g, P.n);
  return Object.assign({}, P, { n, pos, vel, group, groups: (P.groups || []).concat([]) });
}

// ── intruders ───────────────────────────────────────────────────────────────
const SUBJ = {
  kepler: 'a young planetary system', transfers: 'two probes on transfer orbits', slingshot: 'a Jupiter flyby', solar: 'the Solar System',
  hill: "a giant planet's moons", lagrange: 'the five Lagrange points', horseshoe: 'a horseshoe orbit', trojans: "Jupiter's Trojans",
  choreography: 'a three-body dance', pythagorean: "Burrau's three stars", sitnikov: 'the Sitnikov problem', kozai: 'a Kozai cycle',
  triton: 'Neptune and Triton', circumbinary: 'a planet with two suns', resonance: 'a resonant chain', flyby: 'a stellar flyby',
  rings: "Saturn's rings", sl9: 'Jupiter and Shoemaker-Levy 9', galaxies: 'two colliding galaxies', blackhole: 'the stars of Sgr A*', tde: 'a tidal disruption',
};
const INTRUDERS = {
  blackhole: { w: 1.2, verbs: ['A black hole plunges through', 'A black hole crosses', 'A wandering black hole meets'] },
  star: { w: 1.0, verbs: ['A passing star stirs', 'A rogue star dives through', 'A second sun crashes'] },
  planet: { w: 0.8, verbs: ['A rogue planet dives through', 'A rogue planet grazes', 'A lost planet crosses'] },
  rubble: { w: 0.9, verbs: ['A rubble pile breaks up in', 'A loose moon falls apart in'] },
  comets: { w: 0.9, verbs: ['A comet swarm rains through', 'A comet shower falls on'] },
  dust: { w: 0.7, verbs: ['A dust cloud drifts into', 'A dust cloud is torn up by'] },
  galaxy: { w: 0, verbs: ['A third galaxy joins', 'A dwarf galaxy dives through'] },
};
function intruder(r, seed, n) {
  const keys = Object.keys(EXPERIMENTS).filter(k => k !== 'disk');
  const key = pick(r, keys), X = EXPERIMENTS[key], variant = pick(r, X.variants);
  const nBase = Math.max(256, Math.floor(n * 0.82));
  const spec = X.build((seed * 2246822519) >>> 0, { n: nBase, variant });
  const B = spec.bodies;
  if (!B.length || B.length > MAXB - 2) return null;
  const dI = heaviest(B), D = B[dI], ext = spec.view.extent;
  const kinds = key === 'galaxies' ? ['galaxy'] : Object.keys(INTRUDERS).filter(k => k !== 'galaxy' && (k !== 'rubble' || (D.r > 0 && D.r * 3.2 < ext * 0.8)));
  const w = Object.fromEntries(kinds.map(k => [k, INTRUDERS[k].w || 1]));
  const kind = pickW(r, w);
  // timing: closest approach 5 to 9 s after the start at Normal speed
  let tp = spec.rate * range(r, 5, 9);
  const incl = range(r, 0, 70) * DEG * (r() < 0.5 ? 1 : -1), node = range(r, 0, 2 * Math.PI), wArg = range(r, 0, 2 * Math.PI);
  let m = 0, rad = 0, q, vinfK = range(r, 0.25, 0.8), nm = '', bodyKind = 'star', color = COLORS.star, extra = {}, parts = null, partColor = COLORS.dust, size = (spec.particles && spec.particles.size) || 0.004 * ext;
  const M = D.m;
  switch (kind) {
    case 'blackhole': m = M * pick(r, [1, 2, 3, 5]); rad = 0.022 * ext; q = range(r, 0.25, 0.6) * ext; nm = 'black hole'; bodyKind = 'bh'; color = COLORS.bh; extra = { absorb: 1, r: 0.6 * rad }; break;
    case 'star': m = M * range(r, 0.2, 0.9); rad = 0.045 * ext; q = range(r, 0.25, 0.65) * ext; nm = 'passing star'; bodyKind = starKind(m / M); color = COLORS[bodyKind]; break;
    case 'planet': m = M * logU(r, 3e-4, 5e-3); rad = 0.024 * ext; q = range(r, 0.1, 0.45) * ext; nm = 'rogue planet'; bodyKind = 'jupiter'; color = COLORS.jupiter; break;
    case 'rubble': m = M * 2e-6; rad = 0.014 * ext; q = D.r * range(r, 1.5, 2.6); nm = 'rubble pile'; bodyKind = 'rock'; color = [0.72, 0.6, 0.5];
      extra = { fragile: { rho: 0.5 * D.m / (4 / 3 * Math.PI * D.r ** 3), n: Math.min(1200, Math.floor(n * 0.15)) } }; vinfK = range(r, 0.1, 0.3); break;
    case 'comets': case 'dust': {
      m = 0; q = range(r, 0.12, 0.5) * ext; nm = kind === 'comets' ? 'comet swarm' : 'dust cloud';
      partColor = kind === 'comets' ? [0.7, 0.88, 1.0] : [0.85, 0.75, 0.95];
      break;
    }
    case 'galaxy': m = M * range(r, 0.2, 0.6); rad = 0.03 * ext; q = range(r, 0.5, 1.1) * ext / 3.2 * 1.5; nm = 'dwarf galaxy'; bodyKind = 'core'; color = COLORS.violet; extra = { eps: 0.1, absorb: 0, merge: false, r: 0, rDraw: 0.025 }; vinfK = range(r, 0.2, 0.5); break;
  }
  q = Math.max(q, 1.6 * ((D.r || 0) + rad) + (kind === 'rubble' ? 0 : 0));
  if (kind === 'rubble') q = D.r * range(r, 1.5, 2.6);
  const GM = M + m, vinf = vinfK * Math.sqrt(GM / q);
  // start no farther than 2.4 view extents
  let s = incoming(GM, q, vinf, tp, incl, node, wArg);
  for (let k = 0; k < 40 && v3.len(s.r) > 2.4 * ext; k++) { tp *= 0.85; s = incoming(GM, q, vinf, tp, incl, node, wArg); }
  const X0 = v3.add(D.x, s.r), V0 = v3.add(D.v, s.v);
  const P = spec.particles;
  let nAdd = 0;
  if (kind === 'comets' || kind === 'dust' || kind === 'galaxy') {
    nAdd = Math.max(0, n - (P ? P.n : 0) - (spec.pool || 0));
    if (nAdd > 16) {
      const rr = rng(seed ^ 0x77), pos = new Float64Array(3 * nAdd), vel = new Float64Array(3 * nAdd);
      for (let k = 0; k < nAdd; k++) {
        let p, v;
        if (kind === 'galaxy') {
          const a = 0.12 + 0.45 * Math.sqrt(rr()), ph = 2 * Math.PI * rr(), vc = Math.sqrt(m / a);
          p = [a * Math.cos(ph), a * Math.sin(ph), 0.01 * gauss(rr)]; v = [-vc * Math.sin(ph), vc * Math.cos(ph), 0];
        } else {
          const sp = (kind === 'comets' ? 0.05 : 0.12) * ext, vs = (kind === 'comets' ? 0.06 : 0.1) * v3.len(s.v);
          p = [sp * gauss(rr), sp * gauss(rr), 0.4 * sp * gauss(rr)]; v = [vs * gauss(rr), vs * gauss(rr), 0.4 * vs * gauss(rr)];
        }
        for (let c = 0; c < 3; c++) { pos[3 * k + c] = X0[c] + p[c]; vel[3 * k + c] = V0[c] + v[c]; }
      }
      parts = { n: nAdd, pos, vel };
    }
  }
  const out = spec;
  if (parts && P) {
    const g = (P.groups || []).length;
    out.particles = concatParts(P, parts, g);
    out.particles.groups.push({ name: nm, color: kind === 'galaxy' ? [0.8, 0.65, 1.0] : partColor });
  }
  const iNew = B.length;
  if (m > 0 || kind === 'galaxy') {
    B.push(body(cap(nm), bodyKind, m, extra.r ?? rad, X0, V0, Object.assign({ rDraw: extra.rDraw ?? rad, color }, extra, { r: extra.r ?? rad })));
    out.opts = Object.assign({}, out.opts);
    out.opts.watch = (out.opts.watch || []).concat([[dI, iNew]]);
  }
  if (spec.view.center === 'com' && m > 0) toCOM(B, out.particles);
  const subj = SUBJ[key] || spec.title.toLowerCase();
  out.title = `${pick(r, INTRUDERS[kind].verbs)} ${subj}`;
  out.blurb = `${cap(nm)}${m > 0 ? ` of ${fmt.sig(m / M, 2)} × the mass of ${D.name}` : ''}, closest approach ${fmt.sig(q / ext, 2)} view widths${kind === 'rubble' ? ', inside the Roche limit' : ''}. ` + spec.blurb;
  out.facts = [['intruder', nm], ['mass / ' + D.name, m > 0 ? fmt.sig(m / M, 3) : 'massless'], ['closest approach', fmt.sig(q, 3) + ' ' + (spec.scale ? spec.scale.nameL : '')], ['eccentricity of its path', fmt.sig(s.e, 3)], ...spec.facts];
  out.notes = [...spec.notes, `The ${nm} is added by the randomizer on a computed hyperbolic path (vis-viva); its closest approach is set, what follows is not.`];
  out.cues = Array.from(new Set([...(spec.cues || []), 'periapsis', 'capture', 'merge', 'breakup', 'ejection', 'hit']));
  out.rollInfo = { family: 'intruder', base: key, variant, intruder: kind, q, tPeri: tp };
  return out;
}

// ── sandbox scenes ──────────────────────────────────────────────────────────
// Common shape of a sandbox spec.
function sb(o) {
  return Object.assign({
    variant: 'sandbox', opts: { eta: 0.02 }, pool: 0, cues: ['merge', 'breakup', 'ejection', 'capture', 'periapsis', 'hit'],
    sources: ['codata', 'iau', 'nssdc'],
    notes: [],
  }, o, {
    notes: (o.notes || []).concat(['Bodies are drawn, and collide, far larger than their true size, so that you can see them.', 'Particles are massless tracers: they feel the bodies and do not pull back.']),
  });
}
const AU = C.AU, MS = C.MSUN;
const MJ = C.MJUP / MS, ME = C.MEARTH / MS;

// 1 a knot of suns, each with a dust disk
function cluster(r, seed, n) {
  const N = 5 + Math.floor(r() * 8), a = 1.2, B = [], Q = range(r, 0.35, 0.9);
  for (let k = 0; k < N; k++) {
    const m = 0.3 + 1.7 * r() ** 2;
    let rad; do { rad = a / Math.sqrt(Math.max(1e-6, r()) ** (-2 / 3) - 1); } while (rad > 2.6 * a);
    const u = 2 * r() - 1, ph = 2 * Math.PI * r(), s = Math.sqrt(1 - u * u);
    const kind = starKind(m);
    B.push(body('star ' + GREEK[k], kind, m, 0.025 + 0.02 * Math.sqrt(m), [rad * s * Math.cos(ph), rad * s * Math.sin(ph), 0.6 * rad * u], [gauss(r), gauss(r), gauss(r)], { color: COLORS[kind] }));
  }
  // virial ratio Q = 2K / |U|: under 1 the knot falls in first
  let K = 0, U = 0;
  for (const b of B) K += 0.5 * b.m * v3.dot(b.v, b.v);
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) U -= B[i].m * B[j].m / Math.max(1e-3, v3.len(v3.sub(B[i].x, B[j].x)));
  const sc = Math.sqrt(Q * Math.abs(U) / (2 * K));
  for (const b of B) b.v = v3.mul(b.v, sc);
  toCOM(B);
  const P = new Parts(), per = Math.floor(n / N);
  const cols = [COLORS.amber, COLORS.cyan, COLORS.rose, COLORS.green, COLORS.violet, COLORS.dust];
  B.forEach((b, k) => {
    const g = P.g('disk of ' + b.name, cols[k % cols.length]);
    const nrm = [gauss(r), gauss(r), gauss(r) + 1.5];
    disk(P, b, { n: per, rin: 0.07 * Math.sqrt(b.m), rout: 0.3 * Math.sqrt(b.m), GM: b.m, h: 0.02, normal: nrm, g, rand: r });
  });
  const Mt = B.reduce((s, b) => s + b.m, 0), tc = Math.sqrt(a ** 3 / Mt) * 2;
  const Pin = period(0.3, 0.07 * Math.sqrt(0.3));
  const title = pick(r, [`${cap(word(N))} suns in a tight knot`, `A knot of ${word(N)} suns`, `${cap(word(N))} stars, one fight`, `${cap(word(N))} suns fall together`]);
  return sb({
    key: 'sandbox', title, seed, blurb: `${N} stars of 0.3 to 2 solar masses start ${Q < 0.6 ? 'too slow to hold their size' : 'close to balance'} (2K/|U| = ${fmt.sig(Q, 2)}). Their dust disks get stripped, swapped and flung out.`,
    scale: UNITS.solar(), bodies: B, opts: { eta: 0.02, escapeR: 8 * a, ejecta: 160 }, particles: P.done(0.0035), pool: 0,
    dt: Math.max(Pin / 220, tc / 900), rate: tc / 4, duration: tc * 12,
    view: { center: 'com', extent: 2.6 * a, tilt: 35 },
    tex: ['\\ddot{\\vec r}_i = -\\sum_{j\\ne i} \\frac{G m_j\\,(\\vec r_i - \\vec r_j)}{|\\vec r_i - \\vec r_j|^3}', '2K = |U| \\;\\text{(virial balance)}'],
    facts: [['stars', String(N)], ['total mass', fmt.sig(Mt, 3) + ' M☉'], ['virial ratio 2K/|U|', fmt.sig(Q, 2)], ['crossing time', fmt.sig(tc * UNITS.solar().T / C.YEAR, 2) + ' yr']],
    notes: ['A real young cluster has hundreds to thousands of stars; this is a small group.'],
  });
}
// 2 packed giant planets
function rumble(r, seed, n) {
  const Ms = range(r, 0.6, 1.4), k = 4 + Math.floor(r() * 4), Dh = range(r, 2.4, 4.2);
  const B = [body('Star', starKind(Ms), Ms, 0.07, [0, 0, 0], [0, 0, 0], { color: COLORS[starKind(Ms)], rDraw: 0.07 })];
  let a = range(r, 0.5, 0.9);
  const ms = Array.from({ length: k }, () => logU(r, 3e-5, 4e-3));
  const LET = 'bcdefghij';
  for (let j = 0; j < k; j++) {
    const m = ms[j], rad = 0.022 + 0.018 * Math.cbrt(m / 1e-3);
    const kind = m < 2e-5 ? 'rock' : m < 1.5e-4 ? pick(r, ['neptune', 'ice']) : pick(r, ['jupiter', 'saturn']);
    B.push(orbiting(B[0], 'planet ' + LET[j], kind, m, rad, { a, e: range(r, 0.01, 0.08), i: range(r, 0, 3) * DEG, O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: 2 * Math.PI * r() }, { rDraw: rad, a0: a }));
    if (j + 1 < k) { const h = Math.cbrt((m + ms[j + 1]) / (3 * Ms)); a = a * (2 + Dh * h) / (2 - Dh * h); }
  }
  toCOM(B);
  const P = new Parts(), aOut = B[k].a0, a1 = B[1].a0;
  disk(P, B[0], { n: Math.floor(n * 0.55), rin: 0.6 * a1, rout: aOut * 1.05, GM: Ms, h: 0.015, g: P.g('debris between the planets', COLORS.dust), rand: r });
  disk(P, B[0], { n: n - Math.floor(n * 0.55) - Math.floor(n * 0.15), rin: aOut * 1.3, rout: aOut * 1.7, GM: Ms, h: 0.03, g: P.g('outer belt', COLORS.ice), rand: r });
  const Pin = period(Ms, 0.6 * a1), Pout = period(Ms, aOut);
  const title = pick(r, [`${cap(word(k))} giants too close for comfort`, `${cap(word(k))} planets packed too tight`, `A crowded system of ${word(k)} planets`]);
  return sb({
    key: 'sandbox', title, seed, blurb: `${k} planets spaced only ${fmt.sig(Dh, 2)} mutual Hill radii apart: too close to stay stable. Orbits cross, planets collide or are thrown out.`,
    scale: UNITS.solar(), bodies: B, opts: { eta: 0.02, escapeR: 4 * aOut, ejecta: 220 }, particles: P.done(0.004), pool: Math.floor(n * 0.15),
    dt: Pin / 260, rate: Pout / 8, duration: Pout * 30,
    view: { center: 0, extent: aOut * 1.5, tilt: 32 },
    tex: ['\\Delta = \\frac{a_{j+1}-a_j}{R_{H,m}},\\quad R_{H,m} = \\frac{a_j + a_{j+1}}{2}\\left(\\frac{m_j + m_{j+1}}{3M_\\star}\\right)^{1/3}', 'T^2 = \\frac{4\\pi^2 a^3}{G M_\\star}'],
    facts: [['star', fmt.sig(Ms, 2) + ' M☉'], ['planets', String(k)], ['spacing', fmt.sig(Dh, 2) + ' mutual Hill radii'], ['heaviest planet', fmt.sig(Math.max(...ms) / MJ, 2) + ' Jupiter masses']],
    notes: ['Planets well under about 3.5 mutual Hill radii apart go unstable fast (Chambers et al. 1996 give the trend).'],
  });
}
// 3 a rubble moon dives at a ringed planet
function ringDive(r, seed, n) {
  const pl = pick(r, ['saturn', 'jupiter', 'neptune', 'uranus']), D = BODY[pl];
  const U = unitsOf(D.R, D.m, { L: 'planet radii', M: 'planet masses', T: 'T' });
  const kind = pl === 'neptune' ? 'neptune' : pl === 'uranus' ? 'ice' : pl;
  const B = [body(cap(pl), kind, 1, 1, [0, 0, 0], [0, 0, 0], { color: COLORS[kind] || COLORS.ice, rDraw: 1 })];
  const nm = pick(r, [2, 3, 3, 4]);
  for (let j = 0; j < nm; j++) {
    const a = range(r, 2.6, 4.2) + 0.9 * j;
    B.push(orbiting(B[0], 'moon ' + (j + 1), 'moon', logU(r, 2e-6, 4e-5), 0.06, { a, e: 0.005, M: 2 * Math.PI * r(), i: 0.2 * DEG * r() }, { rDraw: 0.06 + 0.03 * r() }));
  }
  const rho = 1 / (4 / 3 * Math.PI);
  const qd = range(r, 1.5, 2.6), ad = range(r, 3.2, 5.2), ed = 1 - qd / ad;
  const rub = orbiting(B[0], 'rubble moon', 'rock', 3e-6, 0.09, { a: ad, e: ed, i: range(r, 0, 12) * DEG, O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), f: Math.PI * range(r, 0.55, 0.85) },
    { rDraw: 0.09, fragile: { rho: 0.5 * rho, n: Math.min(1500, Math.floor(n * 0.25)) }, color: [0.72, 0.6, 0.5] });
  B.push(rub);
  const P = new Parts();
  disk(P, B[0], { n: Math.floor(n * 0.62), rin: 1.25, rout: 2.25, GM: 1, h: 0.0015, g: P.g('ring', pl === 'saturn' ? [0.95, 0.88, 0.72] : [0.72, 0.7, 0.68]), rand: r });
  const Pin = period(1, 1.25), Pd = period(1, ad);
  return sb({
    key: 'sandbox', title: pick(r, [`A rubble moon dives at ${cap(pl)}`, `${cap(pl)} tears up a wandering moon`, `A new ring for ${cap(pl)}`]), seed,
    blurb: `A loose moon on an eccentric orbit (e = ${fmt.sig(ed, 2)}) dips to ${fmt.sig(qd, 2)} planet radii, inside the fluid Roche limit of 3.07 radii, and comes apart into a stream.`,
    scale: U, bodies: B, opts: { eta: 0.02, debrisN: 1200 }, particles: P.done(0.006), pool: Math.floor(n * 0.3), debrisSize: 0.006,
    dt: Pin / 240, rate: Pd / 7, duration: Pd * 8,
    view: { center: 0, extent: ad * 1.25, tilt: 24 },
    tex: ['d_\\mathrm{Roche} \\approx 2.44\\,R_p\\left(\\frac{\\rho_p}{\\rho_m}\\right)^{1/3}', 'a_\\mathrm{tide} \\approx \\frac{2 G M_p\\,r}{d^3}'],
    facts: [['planet', cap(pl) + ` (${fmt.km(D.R)} radius)`], ['moon density', 'half the planet\'s'], ['Roche limit', '3.07 planet radii'], ['closest approach', fmt.sig(qd, 3) + ' planet radii']],
    notes: ['The moon breaks up all at once when it crosses the fluid limit; a real rubble pile sheds over several passes.'], sources: ['nssdc', 'roche'],
  });
}
// 4 two suns, a disk, maybe an intruder
function binaryDisk(r, seed, n) {
  const m1 = 1, m2 = range(r, 0.2, 1), ab = range(r, 0.3, 0.55), eb = range(r, 0, 0.5);
  const s = elementsToState(m1 + m2, { a: ab, e: eb, f: 0 });
  const k1 = starKind(m1), k2 = starKind(m2);
  const B = [body('star A', k1, m1, 0.05, v3.mul(s.r, -m2 / (m1 + m2)), v3.mul(s.v, -m2 / (m1 + m2)), { color: COLORS[k1] }),
    body('star B', k2, m2, 0.035, v3.mul(s.r, m1 / (m1 + m2)), v3.mul(s.v, m1 / (m1 + m2)), { color: COLORS[k2] })];
  const P = new Parts(), cen = { m: m1 + m2, x: [0, 0, 0], v: [0, 0, 0] };
  disk(P, cen, { n: Math.floor(n * 0.88), rin: 1.3 * ab, rout: 6 * ab, GM: m1 + m2, h: 0.01, g: P.g('circumbinary disk', COLORS.amber), rand: r });
  const intr = r() < 0.6;
  let title = pick(r, ['Two suns sweep a disk', 'A disk around two suns', 'Two suns clear a hole']);
  if (intr) {
    const mi = range(r, 0.3, 0.8), q = range(r, 2.5, 5) * ab, st = incoming(m1 + m2 + mi, q, range(r, 0.3, 0.7) * Math.sqrt((m1 + m2) / q), period(m1 + m2, 3 * ab) * range(r, 0.8, 1.6), range(r, -60, 60) * DEG, 2 * Math.PI * r(), 2 * Math.PI * r());
    const ki = starKind(mi);
    B.push(body('star C', ki, mi, 0.035, st.r, st.v, { color: COLORS[ki] }));
    toCOM(B, null);
    title = pick(r, ["A third star crashes a binary's disk", 'Two suns, a disk and an intruder']);
  }
  const Pin = period(m1 + m2, 1.3 * ab), Pb = period(m1 + m2, ab);
  const ac = ab * (1.6 + 5.1 * eb - 2.22 * eb * eb + 4.12 * (m2 / (m1 + m2)) - 4.27 * eb * (m2 / (m1 + m2)) - 5.09 * (m2 / (m1 + m2)) ** 2 + 4.61 * eb * eb * (m2 / (m1 + m2)) ** 2);
  return sb({
    key: 'sandbox', title, seed, blurb: `Two stars (${fmt.sig(m2, 2)} : 1, e = ${fmt.sig(eb, 2)}) sweep their disk clear inside about ${fmt.sig(ac / ab, 2)} binary separations (Holman & Wiegert 1999).${intr ? ' Then a third star arrives.' : ''}`,
    scale: UNITS.solar(), bodies: B, opts: { eta: 0.02, escapeR: 30 * ab, ejecta: 120, watch: intr ? [[0, 2], [1, 2]] : [] }, particles: P.done(0.0035), pool: Math.floor(n * 0.12),
    dt: Pin / 240, rate: Pb * 1.2, duration: Pb * 60,
    view: { center: 'com', extent: 6.5 * ab, tilt: 38 },
    tex: ['a_c \\approx (1.60 + 5.10e - 2.22e^2 + 4.12\\mu - \\dots)\\,a_b', 'T_b = 2\\pi\\sqrt{\\frac{a_b^3}{G(m_1+m_2)}}'],
    facts: [['mass ratio', fmt.sig(m2, 2)], ['binary separation', fmt.sig(ab, 3) + ' AU'], ['binary eccentricity', fmt.sig(eb, 2)], ['critical radius', fmt.sig(ac, 3) + ' AU']],
    sources: ['hw99', 'iau'],
  });
}
// 5 stars around a black hole
function bhSwarm(r, seed, n) {
  const U = unitsOf(1000 * AU, 4.3e6 * MS, { L: '1000 AU', M: '4.3 × 10^6 M☉', T: 'T' });
  const B = [body('black hole', 'bh', 1, 0.004, [0, 0, 0], [0, 0, 0], { rDraw: 0.02, color: COLORS.bh, absorb: 1 })];
  const N = 6 + Math.floor(r() * 7), rt = 0.03, plungers = 1 + Math.floor(r() * 3);
  for (let k = 0; k < N; k++) {
    const m = range(r, 1, 5) * 2.3e-7 * 4, plunge = k < plungers;
    const a = range(r, 0.35, 1.0), q = plunge ? rt * range(r, 0.45, 0.9) : range(r, 0.06, 0.4) * a;
    const e = 1 - q / a;
    const st = orbiting(B[0], 'star ' + GREEK[k], starKind(2), m, 0.012, { a, e, i: Math.acos(2 * r() - 1), O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: plunge ? -range(r, 2.4, 3.1) : 2 * Math.PI * r() },
      { rDraw: 0.012, color: pick(r, [COLORS.blue, COLORS.star, COLORS.amber]), fragile: { rho: 1, rt, n: Math.min(900, Math.floor(n * 0.12)) } });
    B.push(st);
  }
  const P = new Parts();
  halo(P, B[0], { n: Math.floor(n * 0.5), rin: 0.15, rout: 1.1, prograde: 0, emax: 0.6, g: P.g('old stars (tracers)', [0.75, 0.7, 0.62]), rand: r });
  const Pa = period(1, 0.6), tq = Math.sqrt(rt ** 3);
  return sb({
    key: 'sandbox', title: pick(r, [`${cap(word(N))} stars dive at a black hole`, `Black hole, ${word(N)} stars`, `A black hole eats a star`]), seed,
    blurb: `${N} massive stars orbit a black hole of 4.3 million suns, as near Sgr A*. ${plungers === 1 ? 'One dives' : cap(word(plungers)) + ' dive'} inside the tidal radius and ${plungers === 1 ? 'is' : 'are'} torn into a stream: half of it stays bound, half leaves.`,
    scale: U, bodies: B, opts: { eta: 0.01, escapeR: 6 }, particles: P.done(0.004), pool: Math.floor(n * 0.4), debrisSize: 0.003,
    dt: tq / 14, rate: Pa / 10, duration: Pa * 6,
    view: { center: 0, extent: 1.15, tilt: 30 },
    tex: ['r_t \\approx R_\\star\\left(\\frac{M_\\bullet}{m_\\star}\\right)^{1/3}', 'v^2 = G M_\\bullet\\left(\\frac{2}{r} - \\frac{1}{a}\\right)'],
    facts: [['black hole', '4.3 × 10^6 M☉'], ['stars', String(N)], ['tidal radius (drawn)', fmt.sig(rt * 1000, 2) + ' AU'], ['plunging stars', String(plungers)]],
    notes: ['The tidal radius is set about 30 times the true value of a single star, so the disruption shows at this scale.', 'A disrupted star becomes debris tracers with the star\'s motion; no gas physics.'], sources: ['rees88', 'grav22'],
  });
}
// 6 a comet storm
function cometStorm(r, seed, n) {
  const Ms = range(r, 0.8, 1.2), aJ = range(r, 4, 6), mJ = MJ * logU(r, 0.5, 4);
  const B = [body('Star', starKind(Ms), Ms, 0.06, [0, 0, 0], [0, 0, 0], { rDraw: 0.12, color: COLORS[starKind(Ms)] })];
  B.push(orbiting(B[0], 'giant planet', 'jupiter', mJ, 0.09, { a: aJ, e: 0.04, M: 2 * Math.PI * r() }, { rDraw: 0.09 }));
  if (r() < 0.6) B.push(orbiting(B[0], 'second giant', 'saturn', mJ * range(r, 0.2, 0.6), 0.075, { a: aJ * range(r, 1.6, 1.9), e: 0.05, M: 2 * Math.PI * r() }, { rDraw: 0.075 }));
  const Pj = period(Ms, aJ), rate = Pj / 14;
  // great comets: sungrazers on near-parabolic orbits (q 0.1 to 0.6 AU),
  // each at its periapsis 3 to 20 s after the start at Normal speed
  const nc = 2 + Math.floor(r() * 3);
  for (let k = 0; k < nc; k++) {
    const q = range(r, 0.1, 0.6), a = range(r, 8, 16), e = 1 - q / a, nn = Math.sqrt(Ms / a ** 3);
    const s = elementsToState(Ms, { a, e, i: Math.acos(2 * r() - 1), O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: -nn * rate * range(r, 3, 20) });
    B.push(body('great comet ' + (k + 1), 'comet', 0, 0.02, s.r, s.v, { rDraw: 0.03, sheds: true }));
  }
  // the storm: periapsis times spread over the first 50 s
  const P = new Parts(), g = P.g('comets', [0.68, 0.86, 1.0]);
  const nComets = n;
  for (let k = 0; k < nComets; k++) {
    const q = 0.1 + 6 * r() ** 2, a = range(r, 9, 40), e = 1 - q / a, nn = Math.sqrt(Ms / a ** 3);
    const s = elementsToState(Ms, { a, e, i: Math.acos(2 * r() - 1), O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: -nn * rate * range(r, 0.5, 50) });
    P.add(s.r, s.v, g);
  }
  const vq = Math.sqrt(2 * Ms / 0.1);
  return sb({
    key: 'sandbox', title: pick(r, ['A comet storm', `A comet storm hits a ${Ms < 0.9 ? 'small' : 'young'} sun`, 'Comets rain on the inner system']), seed,
    blurb: `${nComets.toLocaleString('en-US')} comets fall in from the outer system. A giant of ${fmt.sig(mJ / MJ, 2)} Jupiter masses flings some out; others graze or hit the star.`,
    scale: UNITS.solar(), bodies: B, opts: { eta: 0.02, escapeR: 40, watch: B.map((b, j) => [0, j]).filter(([, j]) => B[j].kind === 'comet') }, particles: P.done(0.006), pool: 0,
    dt: Math.min(0.02 / vq, Pj / 400), rate, duration: Pj * 4,
    view: { center: 0, extent: aJ * 1.5, tilt: 40 },
    tex: ['v^2 = G M\\left(\\frac{2}{r} - \\frac{1}{a}\\right)', 'q = a(1 - e)'],
    facts: [['star', fmt.sig(Ms, 2) + ' M☉'], ['giant planet', fmt.sig(mJ / MJ, 2) + ' M_J at ' + fmt.sig(aJ, 2) + ' AU'], ['comets', nComets.toLocaleString('en-US')], ['speed at 0.1 AU', fmt.sig(vq * UNITS.solar().V / 1e3, 3) + ' km/s']],
    notes: ['Comets are massless; their tails are not drawn (no radiation pressure here).'],
  });
}
// 7 three galaxies
function galaxyGroup(r, seed, n) {
  const U = unitsOf(10 * 3.0857e19, 1e11 * MS, { L: '10 kpc', M: '10^11 M☉', T: 'T' });
  const ms = [1, range(r, 0.3, 1), range(r, 0.2, 0.6)], B = [], cols = [COLORS.amber, COLORS.blue, COLORS.violet];
  const R0 = 3.2;
  for (let k = 0; k < 3; k++) {
    const ph = 2 * Math.PI * (k / 3 + 0.1 * r()), rad = R0 * range(r, 0.8, 1.1);
    const x = [rad * Math.cos(ph), rad * Math.sin(ph), range(r, -0.6, 0.6)];
    const vt = 0.25 * Math.sqrt(2.5 / R0);
    B.push(body('galaxy ' + GREEK[k], 'core', ms[k], 0, x, [-vt * Math.sin(ph) + 0.1 * gauss(r), vt * Math.cos(ph) + 0.1 * gauss(r), 0.05 * gauss(r)], { eps: 0.15 * Math.cbrt(ms[k]), rDraw: 0.03, color: cols[k], absorb: 0, merge: false }));
  }
  toCOM(B);
  const P = new Parts(), Mt = ms.reduce((a, b) => a + b, 0);
  B.forEach((b, k) => {
    const g = P.g(b.name + ' stars', [[1.0, 0.8, 0.55], [0.6, 0.75, 1.0], [0.85, 0.65, 1.0]][k]);
    disk(P, b, { n: Math.floor(n * b.m / Mt), rin: 0.15 * Math.sqrt(b.m), rout: 0.8 * Math.sqrt(b.m), GM: b.m, h: 0.02, normal: [gauss(r), gauss(r), 1 + Math.abs(gauss(r))], g, rand: r, profile: 'r' });
  });
  const tff = Math.sqrt(R0 ** 3 / Mt);
  return sb({
    key: 'sandbox', title: pick(r, ['Three galaxies fall together', 'A small group of galaxies', 'Three galaxies, one knot']), seed,
    blurb: 'Three disk galaxies fall toward each other. Close passes pull their stars into tails, bridges and shells (the restricted method of Toomre & Toomre).',
    scale: U, bodies: B, opts: { eta: 0.01, watch: [[0, 1], [0, 2], [1, 2]] }, particles: P.done(0.006), pool: 0,
    dt: 0.004, rate: tff / 6, duration: tff * 6,
    view: { center: 'com', extent: 4, tilt: 50 },
    tex: ['\\ddot{\\vec r} = -\\sum_k \\frac{G M_k\\,(\\vec r - \\vec R_k)}{\\left(|\\vec r - \\vec R_k|^2 + \\epsilon_k^2\\right)^{3/2}}'],
    facts: [['masses', ms.map(m => fmt.sig(m, 2)).join(' : ')], ['start apart', fmt.sig(R0 * 10, 2) + ' kpc'], ['time unit', fmt.sig(U.T / C.YEAR / 1e6, 3) + ' Myr']],
    notes: ['Each galaxy is a softened point mass; its stars are massless.', 'No dark-matter halos and no dynamical friction, so the cores do not merge.'], sources: ['tt72'],
  });
}
// 8 a triple star with a planet disk
function triple(r, seed, n) {
  const m1 = 1, m2 = range(r, 0.3, 0.9), m3 = range(r, 0.3, 1), ai = range(r, 0.25, 0.45), ao = ai * range(r, 4, 7), eo = range(r, 0.2, 0.5), io = range(r, 35, 80) * DEG;
  const si = elementsToState(m1 + m2, { a: ai, e: range(r, 0, 0.2), f: 2 * Math.PI * r() });
  const so = elementsToState(m1 + m2 + m3, { a: ao, e: eo, i: io, O: 2 * Math.PI * r(), f: Math.PI * range(r, 0.7, 1.0) });
  const Mi = m1 + m2, k1 = starKind(m1), k2 = starKind(m2), k3 = starKind(m3);
  const B = [body('star A', k1, m1, 0.04, v3.mul(si.r, -m2 / Mi), v3.mul(si.v, -m2 / Mi), { color: COLORS[k1] }),
    body('star B', k2, m2, 0.03, v3.mul(si.r, m1 / Mi), v3.mul(si.v, m1 / Mi), { color: COLORS[k2] })];
  B.push(body('star C', k3, m3, 0.03, so.r, so.v, { color: COLORS[k3] }));
  for (let k = 0; k < 2; k++) for (let c = 0; c < 3; c++) { B[k].x[c] -= so.r[c] * m3 / (Mi + m3); B[k].v[c] -= so.v[c] * m3 / (Mi + m3); }
  B[2].x = v3.mul(so.r, Mi / (Mi + m3)); B[2].v = v3.mul(so.v, Mi / (Mi + m3));
  const P = new Parts();
  disk(P, { m: Mi, x: v3.mul(v3.add(v3.mul(B[0].x, m1), v3.mul(B[1].x, m2)), 1 / Mi), v: v3.mul(v3.add(v3.mul(B[0].v, m1), v3.mul(B[1].v, m2)), 1 / Mi) }, { n: Math.floor(n * 0.7), rin: 1.6 * ai, rout: 0.45 * ao * (1 - eo), GM: Mi, h: 0.01, g: P.g('disk around A and B', COLORS.amber), rand: r });
  disk(P, B[2], { n: Math.floor(n * 0.3), rin: 0.05, rout: 0.2 * ao * (1 - eo), GM: m3, h: 0.01, normal: [0, -Math.sin(io), Math.cos(io)], g: P.g('disk around C', COLORS.cyan), rand: r });
  const Po = period(Mi + m3, ao), Pin = Math.min(period(m3, 0.05), period(Mi, 1.6 * ai));
  return sb({
    key: 'sandbox', title: pick(r, ['Three suns, two disks', 'A triple star tears its disks', 'A hierarchical triple']), seed,
    blurb: `A close pair and a third star on a ${fmt.sig(io / DEG, 2)}° tilted orbit. Each pass of star C warps and strips the disks; the inner pair feels a slow Kozai-Lidov torque.`,
    scale: UNITS.solar(), bodies: B, opts: { eta: 0.02, escapeR: 6 * ao, watch: [[0, 2]], ejecta: 120 }, particles: P.done(0.0035), pool: Math.floor(n * 0.0),
    dt: Pin / 220, rate: Po / 9, duration: Po * 5,
    view: { center: 'com', extent: ao * 1.15, tilt: 35 },
    tex: ['\\cos^2 i_0 < \\tfrac{3}{5}\\;\\Rightarrow\\;\\text{Kozai-Lidov cycles}', 'T_o = 2\\pi\\sqrt{\\frac{a_o^3}{G M}}'],
    facts: [['masses', [m1, m2, m3].map(m => fmt.sig(m, 2)).join(', ') + ' M☉'], ['inner separation', fmt.sig(ai, 2) + ' AU'], ['outer orbit', `a = ${fmt.sig(ao, 2)} AU, e = ${fmt.sig(eo, 2)}`], ['tilt', fmt.sig(io / DEG, 2) + '°']],
    sources: ['kozai62', 'iau'],
  });
}
// 9 Trojans under fire
function trojanFire(r, seed, n) {
  const mu = MJ * logU(r, 0.5, 3);
  const B = [body('Sun', 'sun', 1, 0.08, [0, 0, 0], [0, 0, 0], { rDraw: 0.1 })];
  B.push(orbiting(B[0], 'giant planet', 'jupiter', mu, 0.06, { a: 1, e: 0.02, M: 0 }, { rDraw: 0.06 }));
  toCOM(B);
  const P = new Parts();
  for (const [s, nm, col] of [[1, 'L4 Trojans', COLORS.amber], [-1, 'L5 Trojans', COLORS.cyan]]) {
    const g = P.g(nm, col);
    for (let k = 0; k < Math.floor(n * 0.4); k++) {
      const a = 1 + 0.03 * gauss(r), ph = s * Math.PI / 3 + 0.25 * gauss(r);
      const st = elementsToState(1, { a, e: 0.04 * r(), i: 0.08 * Math.abs(gauss(r)), O: 2 * Math.PI * r(), w: 0, f: 0 });
      // put it at angle ph ahead of the planet on a near-circle
      const R = v3.len(st.r), vc = Math.sqrt(1 / a);
      P.add([R * Math.cos(ph), R * Math.sin(ph), 0.03 * gauss(r)], [-vc * Math.sin(ph), vc * Math.cos(ph), 0.02 * gauss(r)], g);
    }
  }
  const kind = pick(r, ['rogue planet', 'rubble pile', 'black hole']);
  const mi = kind === 'rogue planet' ? mu * range(r, 0.5, 2) : kind === 'black hole' ? range(r, 0.05, 0.3) : 0;
  const q = range(r, 0.8, 1.3), st = incoming(1 + mi, q, range(r, 0.2, 0.5), period(1, 1) * range(r, 0.5, 0.9), range(r, -20, 20) * DEG, Math.PI / 3 + range(r, -0.6, 0.6), 0);
  if (kind === 'rubble pile') B.push(body('rubble pile', 'rock', 1e-9, 0.03, st.r, st.v, { rDraw: 0.03, color: [0.72, 0.6, 0.5], fragile: { rho: 1e-3, n: 600 } }));
  else B.push(body(kind, kind === 'black hole' ? 'bh' : 'jupiter', mi, kind === 'black hole' ? 0.02 : 0.05, st.r, st.v, { rDraw: kind === 'black hole' ? 0.03 : 0.05, color: kind === 'black hole' ? COLORS.bh : COLORS.rose, absorb: 1 }));
  return sb({
    key: 'sandbox', title: `${cap(kind)} vs. the Trojans`, seed,
    blurb: `Two swarms share the orbit of a giant planet, 60° ahead and behind it (L4 and L5, stable for mass ratios under 0.0385). A ${kind} crosses the orbit near L4.`,
    scale: UNITS.solar(), bodies: B, opts: { eta: 0.02, escapeR: 8, watch: [[0, 2], [1, 2]] }, particles: P.done(0.006), pool: Math.floor(n * 0.15),
    dt: period(1, 1) / 400, rate: period(1, 1) / 5, duration: period(1, 1) * 12,
    view: { center: 'com', extent: 1.6, tilt: 70, rotating: [0, 1] },
    tex: ['\\mu = \\frac{m}{M + m} < 0.0385\\;\\Rightarrow\\;L_4, L_5\\ \\text{stable}', 'C_J = 2\\Omega - v^2'],
    facts: [['planet mass', fmt.sig(mu / MJ, 2) + ' Jupiter masses'], ['intruder', kind], ['closest approach to the Sun', fmt.sig(q, 2) + ' AU']],
    notes: ['The view turns with the planet, so the Lagrange points stand still.'], sources: ['routh', 'iau'],
  });
}
// 10 a crowd of moons
function moonCrowd(r, seed, n) {
  const pl = pick(r, ['jupiter', 'saturn', 'neptune']), D = BODY[pl];
  const U = unitsOf(D.R, D.m, { L: 'planet radii', M: 'planet masses', T: 'T' });
  const B = [body(cap(pl), pl === 'neptune' ? 'neptune' : pl, 1, 1, [0, 0, 0], [0, 0, 0], { rDraw: 1, color: COLORS[pl] })];
  const k = 5 + Math.floor(r() * 5);
  let a = range(r, 2.8, 3.5);
  for (let j = 0; j < k; j++) {
    const m = logU(r, 3e-6, 8e-5), rad = 0.1 + 0.8 * Math.cbrt(m);
    B.push(orbiting(B[0], 'moon ' + (j + 1), pick(r, ['moon', 'rock', 'ice']), m, rad, { a, e: range(r, 0.02, 0.14), i: range(r, 0, 4) * DEG, O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: 2 * Math.PI * r() }, { rDraw: rad }));
    a *= range(r, 1.08, 1.22);
  }
  const P = new Parts();
  disk(P, B[0], { n: Math.floor(n * 0.5), rin: 1.3, rout: 2.3, GM: 1, h: 0.002, g: P.g('ring', [0.9, 0.85, 0.75]), rand: r });
  halo(P, B[0], { n: Math.floor(n * 0.15), rin: 2.6, rout: a, prograde: 1, spread: 0.05, emax: 0.05, g: P.g('dust', COLORS.dust), rand: r });
  const Pin = period(1, 1.3), Po = period(1, a);
  return sb({
    key: 'sandbox', title: `${cap(word(k))} moons on a collision course`, seed,
    blurb: `${k} moons packed on crossing orbits around ${cap(pl)}. They kick each other, collide and merge; each merger sprays debris.`,
    scale: U, bodies: B, opts: { eta: 0.02, ejecta: 260, escapeR: 6 * a }, particles: P.done(0.008), pool: Math.floor(n * 0.3), debrisSize: 0.008,
    dt: Pin / 240, rate: Po / 6, duration: Po * 20,
    view: { center: 0, extent: a * 1.15, tilt: 30 },
    tex: ['v_\\mathrm{esc} = \\sqrt{\\frac{2 G (m_1 + m_2)}{R_1 + R_2}}', 'm_1\\vec v_1 + m_2\\vec v_2 = (m_1 + m_2)\\,\\vec v'],
    facts: [['planet', cap(pl)], ['moons', String(k)], ['outermost orbit', fmt.sig(a, 3) + ' planet radii']],
    notes: ['Two moons that touch merge into one (perfect merger); the spray of debris is massless.'],
  });
}
// 11 probes at a giant planet
function probes(r, seed, n) {
  const B = [body('Sun', 'sun', 1, 0.05, [0, 0, 0], [0, 0, 0], { rDraw: 0.1 })];
  const aJ = 5.2;
  B.push(orbiting(B[0], 'Jupiter', 'jupiter', MJ, 0.12, { a: aJ, e: 0.0, M: 0 }, { rDraw: 0.14 }));
  const k = 4 + Math.floor(r() * 4), J = B[1];
  const watch = [];
  for (let j = 0; j < k; j++) {
    // aim each probe at a point near Jupiter at time T (straight-line
    // guess, then gravity bends it)
    const ang = range(r, -1.2, 1.2), d = range(r, 0.6, 1.5), T = period(1, aJ) * range(r, 0.03, 0.06);
    const Jt = elementsToState(1 + MJ, { a: aJ, e: 0, M: 2 * Math.PI * T / period(1 + MJ, aJ) });
    const aim = v3.add(Jt.r, [d * 0.3 * Math.cos(ang) * (r() < 0.5 ? 1 : -1), d * 0.3 * Math.sin(ang), 0.05 * gauss(r)]);
    const start = [aim[0] * 0.45 + range(r, -1, 1), aim[1] * 0.45 + range(r, -1, 1), 0.1 * gauss(r)];
    const v = v3.mul(v3.sub(aim, start), 1 / T);
    B.push(body('probe ' + (j + 1), 'probe', 0, 0.01, start, v, { rDraw: 0.012 }));
    watch.push([1, 2 + j]);
  }
  const P = new Parts();
  halo(P, J, { n: Math.floor(n * 0.4), rin: 0.15, rout: 0.6, prograde: 1, spread: 0.08, GM: MJ, g: P.g('dust near Jupiter', COLORS.dust), rand: r });
  disk(P, B[0], { n: Math.floor(n * 0.5), rin: 2.2, rout: 3.3, GM: 1, h: 0.03, g: P.g('main belt', [0.7, 0.62, 0.55]), rand: r });
  const Pin = period(MJ, 0.15);
  return sb({
    key: 'sandbox', title: `${cap(word(k))} probes, one giant planet`, seed,
    blurb: `${k} probes aimed past Jupiter on straight-line guesses. Jupiter's gravity bends each path: some gain speed (a slingshot), some lose it, some hit.`,
    scale: UNITS.solar(), bodies: B, opts: { eta: 0.02, watch, escapeR: 14 }, particles: P.done(0.005), pool: 0,
    dt: Pin / 400, rate: period(1, aJ) / 80, duration: period(1, aJ) * 0.3,
    view: { center: 1, extent: 2.2, tilt: 50 },
    tex: ['\\Delta v = 2 v_\\infty \\sin\\frac{\\delta}{2}', '\\sin\\frac{\\delta}{2} = \\frac{1}{1 + r_p v_\\infty^2 / G M_J}'],
    facts: [['probes', String(k)], ['Jupiter mass', '1/1047.6 M☉'], ['Jupiter speed', '13.1 km/s']],
    notes: ['Probes are massless and have no engines here.'], sources: ['nssdc', 'iau', 'vallado'],
  });
}

export const SANDBOX = { cluster, rumble, ringDive, binaryDisk, bhSwarm, cometStorm, galaxyGroup, triple, trojanFire, moonCrowd, probes };

// ── roll ────────────────────────────────────────────────────────────────────
export function roll(seed, o = {}) {
  seed = seed >>> 0;
  const n = o.n || 16384, r = rng(seed ^ 0x9a3c51);
  let fam = o.family || pickW(r, FAMILY_W), spec = null;
  if (fam === 'intruder') { spec = intruder(r, seed, n); if (!spec) fam = 'sandbox'; }
  if (fam === 'sandbox') {
    const keys = Object.keys(SANDBOX), key = o.sandbox || pick(r, keys);
    spec = SANDBOX[key](r, seed, n);
    spec.rollInfo = { family: 'sandbox', base: key };
  }
  if (fam === 'library') {
    const keys = Object.keys(EXPERIMENTS), key = pick(r, keys), X = EXPERIMENTS[key], variant = pick(r, X.variants);
    spec = buildExp(key, (seed * 2654435761) >>> 0, { n: key === 'disk' ? Math.min(n, o.nSelf || n) : n, variant });
    spec.rollInfo = { family: 'library', base: key, variant };
  }
  spec.seed = seed;
  spec.roll = true;
  return spec;
}
// A seeded shuffle of reel entries for the screensaver: every library
// variant once and as many random rolls (seeded) in between.
export function reel(seed, nRolls = 40) {
  const lib = expBag(seed).map(([key, variant]) => ({ type: 'library', key, variant }));
  const r = rng(seed ^ 0x5eed), out = [];
  const rolls = Array.from({ length: nRolls }, (_, k) => ({ type: 'roll', seed: ((seed * 7919) ^ (k * 104729 + 1)) >>> 0 }));
  // alternate: roll, library, roll, ... so random scenes come often
  let i = 0, j = 0;
  while (i < lib.length || j < rolls.length) {
    if (j < rolls.length && (r() < 0.55 || i >= lib.length)) out.push(rolls[j++]);
    else out.push(lib[i++]);
  }
  return out;
}
// The spec as the page runs it. budget: { n, extra } (extra rows for the
// tray and ejecta). Returns the same object.
export function prepare(spec, budget = {}) {
  const extra = budget.extra ?? 2048;
  spec.opts = Object.assign({}, spec.opts);
  // at least two particle steps per frame at Normal speed, so the
  // particles do not move in visible jumps
  if (spec.dt > spec.rate / 120) spec.dt = spec.rate / 120;
  if (!spec.self) {
    spec.pool = (spec.pool || 0) + extra;
    if (!(spec.opts.escapeR < Infinity)) spec.opts.escapeR = 5 * spec.view.extent;
    if (spec.opts.ejecta === undefined) spec.opts.ejecta = 120;
    spec.cues = Array.from(new Set([...(spec.cues || []), 'merge', 'breakup', 'ejection', 'capture', 'hit']));
  }
  return spec;
}
export function titleOf(spec) { return spec.title; }
