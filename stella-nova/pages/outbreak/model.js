// ============================================================================
//  OUTBREAK  ·  model.js — the metapopulation epidemic engine (no DOM)
// ----------------------------------------------------------------------------
//  A toy stochastic SEIR(S) model on the population nodes of data.js, with
//  air and land coupling from network.js and policy effects from
//  policies.js. It is not a forecast. All values are illustrative.
//
//  Compartments per node (people, Float64): S, E, I, R, D, V. The sum per
//  node is constant (D is counted). W = water reservoir (water route),
//  Iv = infected vector fraction (vector and flea routes).
//
//  Time: fixed substep DT = 0.25 day. step(days) runs whole substeps and
//  keeps the remainder, so a run does not depend on the frame rate.
//
//  Draws: each transition has the probability 1 - exp(-rate DT). When the
//  expected count is under 50, the model draws it with rng.binom (the
//  fractional part of a person moves as one Bernoulli draw), else it takes
//  the mean. So first cases and imports are discrete, large waves smooth.
//
//  Force of infection on node i:
//    P_i      = I_i / N_i + sum_j c_ij m_ij I_j / N_j   (land neighbours j)
//    direct   = ds R0 / Tinf x pol x season x P_i
//    vector   = sqrt(Rind) mu Iv_i,  dIv = sqrt(Rind)/Tinf P (1 - Iv) - mu Iv
//    water    = Rind / Tinf x W_i,   dW  = delta (P - W)
//    Rind     = (1 - ds) R0 x pol x season x env
//  ds = DIRECT_SHARE[route] (policies.js). env = climate suitability
//  (vector, flea) or sanitation by income (water). The host-vector and the
//  water loops are built so that R0 holds at env = 1 (Ross-Macdonald, Codeco).
//
//  Air: per edge, per direction, per substep, infected travellers
//  ~ Poisson(flow DT travel (E + I) / N x airMultiplier). Each one swaps
//  with a susceptible traveller the other way. arrivalCatch stops a share
//  (logged with blocked: true).
//
//  Events: { day, from, to, kind, edge, first, blocked, n }. A `first`
//  event is always logged. Other events have a budget of EVENT_CAP a day,
//  so the append-only list stays small in a large epidemic.
//
//  Sources (SOURCES below): Kermack and McKendrick 1927; Keeling and Rohani
//  2008; Smith et al. 2012 (Ross-Macdonald); Codeco 2001 (water reservoir);
//  Colizza et al. 2006 and Balcan et al. 2009 (air metapopulation);
//  Shaman and Kohn 2009 (seasonality).
//
//  grep -n targets: "export const DT", "export const SOURCES",
//    "export function finalSizeR", "export function climateFactor",
//    "export function seasonFactor", "export const SANITATION",
//    "export function createSim", "function substep", "function travel",
//    "function draw", "function recordDay", "reffNode", "burnedOut"
// ============================================================================
import { makeRng } from './rng.js';
import { ifrFor } from './diseases.js';
import {
  DIRECT_SHARE, INCOME_CAPACITY, triggerActive, transmissionMultiplier,
  airMultiplier, landMultiplier, arrivalCatch, vaccinationRate,
} from './policies.js';

export const DT = 0.25;
export const EVENT_CAP = 120;          // non-first events per day
const MEAN_AT = 50;                    // expected count where draws stop
const VECTOR_MU = { vector: 1 / 10, flea: 1 / 20 };  // vector death rate, 1/day
const WATER_DELTA = 1 / 7;             // reservoir decay, 1/day

export const SOURCES = [
  { ref: 'Kermack WO, McKendrick AG. 1927. A contribution to the mathematical theory of epidemics. Proc R Soc Lond A 115:700-721.',
    url: 'https://doi.org/10.1098/rspa.1927.0118',
    note: 'The SIR final size relation 1 - r = exp(-R0 r), used by finalSizeR and the tests.' },
  { ref: 'Keeling MJ, Rohani P. 2008. Modeling Infectious Diseases in Humans and Animals. Princeton University Press.',
    url: 'https://press.princeton.edu/books/hardcover/9780691116174/modeling-infectious-diseases-in-humans-and-animals',
    note: 'SEIR and SEIRS structure, metapopulation coupling, and the stochastic small-number regime.' },
  { ref: 'Smith DL, Battle KE, Hay SI, et al. 2012. Ross, Macdonald, and a theory for the dynamics and control of mosquito-transmitted pathogens. PLoS Pathog 8:e1002588.',
    url: 'https://doi.org/10.1371/journal.ppat.1002588',
    note: 'The host-vector loop; R0 is the product of the two half cycles.' },
  { ref: 'Codeco CT. 2001. Endemic and epidemic dynamics of cholera: the role of the aquatic reservoir. BMC Infect Dis 1:1.',
    url: 'https://doi.org/10.1186/1471-2334-1-1',
    note: 'The environmental water reservoir W that infected people fill and that decays.' },
  { ref: 'Colizza V, Barrat A, Barthelemy M, Vespignani A. 2006. The role of the airline transportation network in the prediction and predictability of global epidemics. PNAS 103:2015-2020.',
    url: 'https://doi.org/10.1073/pnas.0510525103',
    note: 'Stochastic travel of infected people on air edges between city populations.' },
  { ref: 'Balcan D, Colizza V, Goncalves B, et al. 2009. Multiscale mobility networks and the spatial spreading of infectious diseases. PNAS 106:21484-21489.',
    url: 'https://doi.org/10.1073/pnas.0906910106',
    note: 'Short-range commuting coupling in addition to air travel (the land edges).' },
  { ref: 'Shaman J, Kohn M. 2009. Absolute humidity modulates influenza survival, transmission, and seasonality. PNAS 106:3243-3248.',
    url: 'https://doi.org/10.1073/pnas.0806852106',
    note: 'Winter peak of respiratory transmission in each hemisphere, weak in the tropics.' },
];

// Root r in (0, 1) of 1 - r = exp(-R0 r); 0 when R0 <= 1.
export function finalSizeR(R0) {
  if (!(R0 > 1)) return 0;
  let r = 1;
  for (let k = 0; k < 200; k++) {   // Newton on f(r) = 1 - r - exp(-R0 r)
    const e = Math.exp(-R0 * r), f = 1 - r - e, df = -1 + R0 * e;
    const n = r - f / df;
    if (Math.abs(n - r) < 1e-14) { r = n; break; }
    r = n;
  }
  return r;
}

// Sanitation factor by income (1 high .. 5 low) for the water route.
// Illustrative: R0 is set at income 4 (factor 1).
export const SANITATION = Object.freeze([1, 0.25, 0.45, 0.75, 1, 1.25]);

// Climate suitability 0..1 by latitude.
export function climateFactor(climate, lat) {
  const a = Math.abs(lat);
  if (climate === 'tropical') return 1 / (1 + Math.exp((a - 28) / 3));
  if (climate === 'warm') return 1 / (1 + Math.exp((a - 50) / 5));
  return 1;
}

// Seasonal factor (mean 1) at this latitude and day of the year.
// Respiratory: peak in the local winter. Vector, flea, water: peak in the
// warm season. The amplitude fades to 0 at the equator.
export function seasonFactor(disease, lat, doy) {
  const amp = Math.min(1, Math.max(0, +disease.seasonality || 0)) * Math.min(1, Math.abs(lat) / 20);
  if (amp <= 0) return 1;
  let peak = lat >= 0 ? 15 : 197.5;
  if (disease.route !== 'resp' && disease.route !== 'contact') peak += 182.5;
  return Math.max(0, 1 + amp * Math.cos(2 * Math.PI * (doy - peak) / 365));
}

const EMPTY_NET = () => ({
  air: { a: new Int32Array(0), b: new Int32Array(0), flow: new Float64Array(0), dist: new Float64Array(0), intl: new Uint8Array(0), n: 0 },
  land: { a: new Int32Array(0), b: new Int32Array(0), c: new Float64Array(0), cross: new Uint8Array(0), n: 0 },
});

export function createSim({ D, net, disease, policies, seed = 1, seedNode = 0,
  seedCount = 5, startDayOfYear = 0, maxDays = 1500, eventCap = EVENT_CAP }) {
  net = net || EMPTY_NET();
  const nodes = D.nodes, N = nodes.length, NR = (D.regions && D.regions.length) || 7;
  const rng = makeRng(seed);
  const dis = disease;
  const route = dis.route;
  const ds = DIRECT_SHARE[route] ?? 1;
  const isVector = route === 'vector' || route === 'flea';
  const isWater = route === 'water';
  const Tinf = Math.max(0.01, +dis.infectious || 1);
  const pLat = +dis.latent > 0 ? 1 - Math.exp(-DT / dis.latent) : 1;
  const pRem = 1 - Math.exp(-DT / Tinf);
  // mean time in I with geometric substeps is DT / pRem (a bit over Tinf);
  // beta uses it so that the discrete model keeps R0
  const Teff = DT / pRem;
  const pWane = +dis.waning > 0 ? 1 - Math.exp(-DT / dis.waning) : 0;
  const mu = VECTOR_MU[route] || 0.1;

  const S = new Float64Array(N), E = new Float64Array(N), I = new Float64Array(N);
  const R = new Float64Array(N), Dd = new Float64Array(N), V = new Float64Array(N);
  const W = new Float64Array(N), Iv = new Float64Array(N), cum = new Float64Array(N);
  const firstDay = new Float64Array(N).fill(-1), source = new Int32Array(N).fill(-1);
  const pop = new Float64Array(N), ifr = new Float64Array(N), env = new Float64Array(N);
  const detFrac = new Float64Array(N), region = new Int32Array(N), income = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const n = nodes[i];
    pop[i] = n.pop; region[i] = n.region; income[i] = n.income >= 1 && n.income <= 5 ? Math.round(n.income) : 3;
    ifr[i] = ifrFor(dis, income[i]);
    env[i] = isVector ? climateFactor(dis.climate, n.lat) : isWater ? SANITATION[income[i]] : 1;
    detFrac[i] = Math.min(1, (0.15 + 0.6 * (+dis.detect || 0)) * (INCOME_CAPACITY[income[i]] ?? 0.75));
    const im = Math.min(0.99, Math.max(0, +dis.immune0 || 0)) * pop[i];
    R[i] = im; S[i] = pop[i] - im;
  }

  // land adjacency (CSR, both directions)
  const L = net.land, deg = new Int32Array(N + 1);
  for (let e = 0; e < L.n; e++) { deg[L.a[e] + 1]++; deg[L.b[e] + 1]++; }
  for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
  const nbr = new Int32Array(2 * L.n), nbrEdge = new Int32Array(2 * L.n), fill = deg.slice(0, N);
  for (let e = 0; e < L.n; e++) {
    const a = L.a[e], b = L.b[e];
    nbr[fill[a]] = b; nbrEdge[fill[a]++] = e;
    nbr[fill[b]] = a; nbrEdge[fill[b]++] = e;
  }
  const A = net.air;

  let pol = policies || {};
  const active = {};
  let detected = 0, subs = 0, acc = 0, dayInc = 0, budget = eventCap;
  const events = [];
  const history = { day: [], S: [], E: [], I: [], R: [], D: [], V: [], inc: [], detected: [], reff: [], regionI: [] };
  const P = new Float64Array(N), pmult = new Float64Array(N), season = new Float64Array(N);
  const multByIncome = new Float64Array(6);

  // the index case
  const s0 = Math.max(0, Math.min(N - 1, seedNode | 0));
  const c0 = Math.min(S[s0], Math.max(1, seedCount));
  S[s0] -= c0; I[s0] += c0; cum[s0] += c0; firstDay[s0] = 0;
  detected += c0 * detFrac[s0];

  const sim = {
    N, day: 0, S, E, I, R, D: Dd, V, W, Iv, cum, firstDay, source, events, history,
    active, burnedOut: false, disease: dis,
    step, setPolicies, reffNode, reffGlobal, totals, eventsSince,
  };

  // Number of `n` that move with probability p (see the header).
  function draw(n, p) {
    if (!(n > 0) || !(p > 0)) return 0;
    if (p >= 1) return n;
    const m = n * p;
    if (m >= MEAN_AT) return m;
    const fl = Math.floor(n);
    let k = rng.binom(fl, p);
    const fr = n - fl;
    if (fr > 1e-12 && rng.next() < p) k += fr;
    return Math.min(k, n);
  }

  function updateActive() {
    for (const id of Object.keys(active)) if (!pol[id] || !pol[id].on) delete active[id];
    for (const id of Object.keys(pol)) {
      if (active[id] !== undefined) continue;
      if (triggerActive(pol[id], detected, sim.day)) active[id] = sim.day;
    }
  }

  function setPolicies(p) { pol = p || {}; }

  const doyAt = d => (((startDayOfYear + d) % 365) + 365) % 365;

  function prepare() {
    updateActive();
    for (let k = 1; k <= 5; k++) multByIncome[k] = transmissionMultiplier(dis, pol, active, { income: k });
    const doy = doyAt(sim.day);
    for (let i = 0; i < N; i++) {
      pmult[i] = multByIncome[income[i]];
      season[i] = seasonFactor(dis, nodes[i].lat, doy);
    }
  }

  // R_eff at node i = R0 x policy x season x (ds + (1 - ds) env) x S / N.
  function reffNode(i) {
    const R0 = +dis.R0 || 0;
    const m = transmissionMultiplier(dis, pol, active, { income: income[i] });
    const s = seasonFactor(dis, nodes[i].lat, doyAt(sim.day));
    return R0 * m * s * (ds + (1 - ds) * env[i]) * S[i] / pop[i];
  }
  // weighted by I (by population when nothing is infectious)
  function reffGlobal() {
    let w = 0, x = 0, wp = 0, xp = 0;
    for (let i = 0; i < N; i++) {
      const r = reffNode(i);
      w += I[i]; x += I[i] * r; wp += pop[i]; xp += pop[i] * r;
    }
    return w > 0 ? x / w : xp / wp;
  }

  function travel() {
    if (!A || !A.n) return;
    const am0 = airMultiplier({ intl: 0 }, pol, active), am1 = airMultiplier({ intl: 1 }, pol, active);
    const cat = arrivalCatch(dis, pol, active);
    const tr = Math.min(1, Math.max(0, dis.travel ?? 1));
    const off = (subs * 7919) % A.n;
    for (let q = 0; q < A.n; q++) {
      const e = (q + off) % A.n;
      const am = A.intl[e] ? am1 : am0;
      for (let dir = 0; dir < 2; dir++) {
        const s = dir ? A.b[e] : A.a[e], t = dir ? A.a[e] : A.b[e];
        const inf = E[s] + I[s];
        if (!(inf > 0)) continue;
        const ex = A.flow[e] * DT * tr * am * inf / pop[s];
        let k = ex < MEAN_AT ? rng.poisson(ex) : ex;
        k = Math.min(k, inf, S[t]);
        if (!(k > 0)) continue;
        const discrete = ex < MEAN_AT;
        const caught = cat > 0 ? (discrete ? rng.binom(k, cat) : k * cat) : 0;
        const moved = k - caught;
        let blocked = null;
        if (caught > 0 && budget > 0) {
          blocked = { day: sim.day, from: s, to: t, kind: 'air', edge: e, first: false, blocked: true, n: caught };
          budget--;
        }
        if (moved > 0) {
          const fE = discrete ? Math.min(E[s], rng.binom(moved, E[s] / inf)) : moved * E[s] / inf;
          const fI = Math.min(I[s], moved - fE);
          const m = fE + fI;
          E[s] -= fE; I[s] -= fI; E[t] += fE; I[t] += fI;
          S[t] -= m; S[s] += m;
          const first = firstDay[t] < 0;
          if (first) { firstDay[t] = sim.day; source[t] = s; }
          if (first || budget > 0) {
            events.push({ day: sim.day, from: s, to: t, kind: 'air', edge: e, first, blocked: false, n: m });
            if (!first) budget--;
          }
        }
        if (blocked) events.push(blocked);
      }
    }
  }

  function substep() {
    prepare();
    // coupled prevalence
    for (let i = 0; i < N; i++) P[i] = I[i] / pop[i];
    const lm0 = landMultiplier({ cross: 0 }, pol, active), lm1 = landMultiplier({ cross: 1 }, pol, active);
    const Pc = new Float64Array(P);
    for (let i = 0; i < N; i++) {
      for (let k = deg[i]; k < deg[i + 1]; k++) {
        const e = nbrEdge[k];
        Pc[i] += L.c[e] * (L.cross[e] ? lm1 : lm0) * P[nbr[k]];
      }
    }
    const R0 = +dis.R0 || 0;
    const vacc = vaccinationRate(dis, pol, active, sim.day, active.vaccination);
    const pVac = vacc > 0 ? 1 - Math.exp(-vacc * DT) : 0;
    for (let i = 0; i < N; i++) {
      const base = R0 * pmult[i] * season[i];
      let lam = ds * base / Teff * Pc[i];
      if (ds < 1) {
        const Rind = (1 - ds) * base * env[i];
        if (isVector) {
          const sq = Math.sqrt(Math.max(0, Rind));
          lam += sq * mu * Iv[i];
          Iv[i] += DT * (sq / Teff * Math.min(1, Pc[i]) * (1 - Iv[i]) - mu * Iv[i]);
          if (Iv[i] < 0) Iv[i] = 0;
        } else if (isWater) {
          lam += Rind / Teff * W[i];
          W[i] += DT * WATER_DELTA * (Pc[i] - W[i]);
        }
      }
      // transitions (all from the state at the start of the substep)
      const nInf = draw(S[i], 1 - Math.exp(-lam * DT));
      const nLat = pLat < 1 ? draw(E[i], pLat) : 0;
      const nRem = draw(I[i], pRem);
      const nDie = draw(nRem, ifr[i]);
      const nWane = pWane > 0 ? draw(R[i], pWane) : 0;
      const nVac = pVac > 0 ? draw(S[i] - nInf, pVac) : 0;
      S[i] += nWane - nInf - nVac;
      V[i] += nVac;
      if (pLat < 1) { E[i] += nInf - nLat; I[i] += nLat - nRem; }
      else I[i] += nInf - nRem;
      R[i] += nRem - nDie - nWane;
      Dd[i] += nDie;
      if (nInf > 0) {
        cum[i] += nInf; dayInc += nInf; detected += nInf * detFrac[i];
        if (firstDay[i] < 0) {
          firstDay[i] = sim.day;
          let best = -1, bk = -1, bv = 0;
          for (let k = deg[i]; k < deg[i + 1]; k++) {
            const v = L.c[nbrEdge[k]] * P[nbr[k]];
            if (v > bv) { bv = v; best = nbr[k]; bk = nbrEdge[k]; }
          }
          source[i] = best;
          if (best >= 0) events.push({ day: sim.day, from: best, to: i, kind: 'land', edge: bk, first: true, blocked: false, n: nInf });
        }
      }
    }
    travel();
    subs++;
    sim.day = subs * DT;
    if (subs % 4 === 0) { recordDay(); budget = eventCap; }
  }

  function totals() {
    let s = 0, e = 0, i = 0, r = 0, d = 0, v = 0, c = 0, p = 0;
    for (let k = 0; k < N; k++) { s += S[k]; e += E[k]; i += I[k]; r += R[k]; d += Dd[k]; v += V[k]; c += cum[k]; p += pop[k]; }
    return { S: s, E: e, I: i, R: r, D: d, V: v, cases: c, deaths: d, detected, pop: p };
  }

  function recordDay() {
    const t = totals(), h = history;
    h.day.push(sim.day); h.S.push(t.S); h.E.push(t.E); h.I.push(t.I); h.R.push(t.R); h.D.push(t.D); h.V.push(t.V);
    h.inc.push(dayInc); h.detected.push(detected); h.reff.push(reffGlobal());
    const ri = new Float64Array(NR);
    for (let k = 0; k < N; k++) ri[region[k]] += I[k];
    h.regionI.push(ri);
    dayInc = 0;
    // burned out: no people left infected and no reservoir that can make one
    let ei = t.E + t.I, res = 0;
    if (ds < 1) for (let k = 0; k < N; k++) res += S[k] * (isVector ? mu * Iv[k] : W[k] / Teff) * 3;
    if ((sim.day > 30 && ei < 0.5 && res < 0.01) || sim.day >= maxDays) sim.burnedOut = true;
  }

  function step(days) {
    if (sim.burnedOut) return;
    acc += Math.max(0, +days || 0);
    while (acc >= DT - 1e-9 && !sim.burnedOut) { substep(); acc -= DT; }
    if (acc < 0) acc = 0;
  }

  function eventsSince(cursor = 0) {
    return { list: events.slice(cursor), cursor: events.length };
  }

  recordDay();   // day 0
  return sim;
}
