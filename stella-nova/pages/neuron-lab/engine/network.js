// ============================================================================
//  NEURON LAB ENGINE  ·  network.js  ·  many reduced cells and NetCons
// ----------------------------------------------------------------------------
//  The network page runs this file. Each cell is a two-compartment model:
//  an HH soma (hh.mod rates, from a 0.05 mV table) and a passive dendrite,
//  joined by one axial conductance. Each two-node tree takes the same
//  backward Euler step as cell.js; with two nodes the Hines solve is one
//  elimination. Every cell has one ExpSyn for excitation (on the dendrite)
//  and one for inhibition (on the soma). Many NetCons share one ExpSyn, as
//  in NEURON: a NetCon event adds its weight to g.
//
//  A NetCon fires when the soma v crosses its threshold (10 mV) from below.
//  The event reaches each target after its delay: a fixed synaptic 0.6 ms
//  plus the axon length over the conduction velocity. Delays are kept in
//  whole steps in a ring buffer of event lists.
//  Background drive is one NetStim per cell (noise = 1, Poisson) with its
//  own NetCon onto the excitatory ExpSyn.
//
//  Typed arrays hold all state; the same seed gives the same network and
//  the same spikes.
//
//  grep -n targets
//    "export const MODELS"        the three presets (PING, ring, balanced)
//    "export function makeNetwork" build cells, positions, wiring
//    "step()"                     one fixed step for all cells
//    "stimulate("                 a burst into cells near a point
// ============================================================================
import { rng, gauss } from './rng.js';
import { HH, NRN } from './hh.js';
import { rateTable } from './hh.js';

export const MODELS = {
  ping: {
    name: 'PING gamma column', short: 'PING',
    note: 'Pyramidal cells drive fast interneurons; the interneurons fire a volley and shut the pyramids down until the GABA decays. The cycle repeats at gamma frequency.',
    layout: 'column', fracE: 0.8, kEE: 20, kEI: 40, kIE: 40, kII: 20,
    wEE: 0.0006, wEI: 0.003, wIE: 0.006, wII: 0.002, tauE: 2, tauI: 6,
    bgE: 0.35, wBgE: 0.0035, bgI: 0.05, wBgI: 0.0015, sigma: 260, celsius: 16,
  },
  ring: {
    name: 'Ring of cells: a travelling wave', short: 'Ring',
    note: 'Each pyramidal cell excites its neighbours round a ring, and local interneurons make a refractory wake. A kick starts a wave that runs round and round.',
    layout: 'ring', fracE: 0.8, kEE: 14, kEI: 10, kIE: 14, kII: 4,
    wEE: 0.007, wEI: 0.006, wIE: 0.01, wII: 0.001, tauE: 2, tauI: 12,
    bgE: 0.02, wBgE: 0.002, bgI: 0.01, wBgI: 0.001, sigma: 70, lead: 1, celsius: 16,
  },
  balanced: {
    name: 'Balanced E/I network', short: 'Balanced',
    note: 'Strong excitation and stronger inhibition cancel on average. Each cell fires at random times, at a low rate, from the fluctuations: the asynchronous irregular state of cortex at rest.',
    layout: 'column', fracE: 0.8, kEE: 20, kEI: 20, kIE: 20, kII: 20,
    wEE: 0.001, wEI: 0.0015, wIE: 0.004, wII: 0.004, tauE: 2, tauI: 5,
    bgE: 0.9, wBgE: 0.0026, bgI: 0.9, wBgI: 0.0026, sigma: 400, celsius: 16,
  },
};

const SOMA_A = Math.PI * 20 * 20, DEND_A = Math.PI * 2 * 300; // um2
const G_AX = 1 / (NRN.Ra * 150 * 4 / (Math.PI * 2 * 2) * 1e-2 + NRN.Ra * 10 * 4 / (Math.PI * 20 * 20) * 1e-2); // uS

export function makeNetwork(o = {}) {
  const M = { ...MODELS[o.model || 'ping'], ...(o.params || {}) };
  const N = o.N || 1000, seed = o.seed || 1, R = rng(seed), dt = o.dt || NRN.dt;
  const NE = Math.round(N * M.fracE);
  const net = { M, N, NE, seed, dt, t: 0, R, model: o.model || 'ping' };
  // positions (um): a cortical column (layers on y) or a ring
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    let x, y, z;
    if (M.layout === 'ring') {
      const a = (i < NE ? i / NE : (i - NE) / (N - NE)) * Math.PI * 2 + gauss(R) * 0.004;
      const r = 520 + gauss(R) * 18 + (i < NE ? 0 : 36);
      x = r * Math.cos(a); z = r * Math.sin(a); y = gauss(R) * 26;
    } else {
      const a = R() * Math.PI * 2, r = 300 * Math.sqrt(R());
      x = r * Math.cos(a); z = r * Math.sin(a);
      if (i < NE) y = R() < 0.55 ? 240 + gauss(R) * 90 : -260 + gauss(R) * 80; else y = (R() - 0.5) * 900;
    }
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
  }
  net.pos = pos;
  // wiring: fixed in-degree, presynaptic cells picked by a Gaussian of distance
  const out = Array.from({ length: N }, () => []);
  const dist = (i, j) => Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]);
  // On the ring, E to E wiring looks back along the ring by lead sigma, so a
  // wave can only run one way (counterclockwise) and does not cancel itself.
  const ang = i => Math.atan2(pos[i * 3 + 2], pos[i * 3]);
  const pick = (post, lo, hi, k, back = 0) => {
    const cand = [], sg = M.sigma;
    for (let j = lo; j < hi; j++) if (j !== post) {
      let d;
      if (back) { let da = ang(post) - ang(j); da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI; d = da * 520 - back * sg; }
      else d = dist(post, j);
      cand.push(j, Math.exp(-d * d / (2 * sg * sg)));
    }
    let tot = 0; for (let q = 1; q < cand.length; q += 2) tot += cand[q];
    const got = [];
    for (let s = 0; s < k && tot > 0; s++) {
      let u = R() * tot, q = 1; for (; q < cand.length - 2; q += 2) { u -= cand[q]; if (u <= 0) break; }
      got.push(cand[q - 1]);
    }
    return got;
  };
  const v_ax = o.velocity || 300; // um/ms
  for (let post = 0; post < N; post++) {
    const isE = post < NE;
    const kE = isE ? M.kEE : M.kEI, kI = isE ? M.kIE : M.kII;
    const wE = isE ? M.wEE : M.wEI, wI = isE ? M.wIE : M.wII;
    for (const pre of pick(post, 0, NE, kE, M.layout === 'ring' && isE ? M.lead || 0 : 0)) out[pre].push(post, wE * (0.7 + 0.6 * R()), 0, 0.6 + dist(pre, post) / v_ax);
    for (const pre of pick(post, NE, N, kI)) out[pre].push(post, wI * (0.7 + 0.6 * R()), 1, 0.6 + dist(pre, post) / v_ax);
  }
  // compressed lists
  let nc = 0; for (const L of out) nc += L.length / 4;
  const ptr = new Int32Array(N + 1), tgt = new Int32Array(nc), w = new Float32Array(nc), typ = new Uint8Array(nc), del = new Float32Array(nc), dsteps = new Int32Array(nc);
  let k = 0, maxD = 0;
  for (let i = 0; i < N; i++) { ptr[i] = k; const L = out[i]; for (let q = 0; q < L.length; q += 4) { tgt[k] = L[q]; w[k] = L[q + 1]; typ[k] = L[q + 2]; del[k] = L[q + 3]; dsteps[k] = Math.max(1, Math.round(L[q + 3] / dt)); maxD = Math.max(maxD, dsteps[k]); k++; } }
  ptr[N] = k;
  Object.assign(net, { ptr, tgt, w, typ, del, dsteps, nNetCon: nc });
  net.slots = maxD + 2;
  net.ring = Array.from({ length: net.slots }, () => []);
  // state
  const F = () => new Float64Array(N);
  Object.assign(net, { vs: F(), vd: F(), m: F(), h: F(), n: F(), gE: F(), gI: F(), nextBg: F(), lastSpike: new Float64Array(N).fill(-1e9), stimUntil: F(), stimAmp: F() });
  net.isE = i => i < NE;
  net.celsius = o.celsius ?? M.celsius;
  net.tbl = rateTable(net.celsius, dt);
  net.spikes = []; // [t, cell] pairs, trimmed by the page
  net.onSpike = null;
  net.bgScale = 1;
  reset(net);
  net.step = () => step(net);
  net.run = (tstop, each) => { while (net.t < tstop - 1e-9) { step(net); if (each) each(net); } };
  net.stimulate = (o2) => stimulate(net, o2);
  net.setCelsius = c => { net.celsius = c; net.tbl = rateTable(c, dt); };
  return net;
}

function reset(net) {
  const { N, R, tbl } = net;
  for (let i = 0; i < N; i++) {
    const v0 = -65 + gauss(R) * 3;
    net.vs[i] = v0; net.vd[i] = v0;
    const f = Math.max(0, Math.min(tbl.n - 2, (v0 - tbl.lo) / tbl.step)) | 0;
    net.m[i] = tbl.T[f * 6]; net.h[i] = tbl.T[f * 6 + 2]; net.n[i] = tbl.T[f * 6 + 4];
    net.gE[i] = 0; net.gI[i] = 0;
    net.nextBg[i] = bgInterval(net, i);
  }
  for (const s of net.ring) s.length = 0;
  net.t = 0; net.k = 0; net.spikes.length = 0;
}

function bgRate(net, i) { const M = net.M; return (i < net.NE ? M.bgE : M.bgI) * net.bgScale; } // spikes per ms
function bgInterval(net, i) { const r = bgRate(net, i); return r > 0 ? net.t + -Math.log(1 - net.R()) / r : 1e12; }

const E_EXC = 0, E_INH = -80;

function step(net) {
  const { N, NE, dt, M, vs, vd, m, h, n, gE, gI, tbl } = net;
  const T = tbl.T, lo = tbl.lo, st = tbl.step, tn = tbl.n;
  const t = net.t, slot = net.ring[net.k % net.slots];
  // deliver NetCon events due now
  for (let q = 0; q < slot.length; q += 3) { if (slot[q + 2] === 0) gE[slot[q]] += slot[q + 1]; else gI[slot[q]] += slot[q + 1]; }
  slot.length = 0;
  // background NetStims (Poisson)
  for (let i = 0; i < N; i++) while (net.nextBg[i] <= t + dt / 2) { gE[i] += i < NE ? M.wBgE : M.wBgI; const r = bgRate(net, i); net.nextBg[i] = r > 0 ? net.nextBg[i] + -Math.log(1 - net.R()) / r : 1e12; }
  const cS = 1e-5 * SOMA_A / dt, cD = 1e-5 * DEND_A / dt, aS = SOMA_A * 1e-2, aD = DEND_A * 1e-2, ga = G_AX;
  const decE = Math.exp(-dt / M.tauE), decI = Math.exp(-dt / M.tauI);
  const ena = HH.ena, ek = HH.ek, gl = HH.gl, el = HH.el;
  const out = net.ring;
  for (let i = 0; i < N; i++) {
    const v = vs[i], w = vd[i];
    const mm = m[i], g_na = HH.gnabar * mm * mm * mm * h[i], n2 = n[i] * n[i], g_k = HH.gkbar * n2 * n2;
    const iS = (g_na * (v - ena) + g_k * (v - ek) + gl * (v - el)) * aS + gI[i] * (v - E_INH) - (net.stimUntil[i] > t ? net.stimAmp[i] : 0);
    const iD = gl * (w - el) * aD + gE[i] * (w - E_EXC);
    // 2x2: [cS+GS+ga, -ga; -ga, cD+GD+ga] [dv; dw] = [-iS + ga(w-v); -iD + ga(v-w)]
    const d0 = cS + (g_na + g_k + gl) * aS + gI[i] + ga, d1 = cD + gl * aD + gE[i] + ga;
    const r0 = -iS + ga * (w - v), r1 = -iD + ga * (v - w);
    // the Hines solve on a 2-node tree (node 1 child of node 0)
    const f = -ga / d1, d0p = d0 - f * -ga, r0p = r0 - f * r1;
    const dv = r0p / d0p, dw = (r1 + ga * dv) / d1;
    const vn = v + dv; vs[i] = vn; vd[i] = w + dw;
    let x = (vn - lo) / st; if (x < 0) x = 0; else if (x > tn - 1.001) x = tn - 1.001;
    const j = x | 0, u = x - j, o = j * 6, p = o + 6;
    m[i] += (T[o + 1] + (T[p + 1] - T[o + 1]) * u) * (T[o] + (T[p] - T[o]) * u - m[i]);
    h[i] += (T[o + 3] + (T[p + 3] - T[o + 3]) * u) * (T[o + 2] + (T[p + 2] - T[o + 2]) * u - h[i]);
    n[i] += (T[o + 5] + (T[p + 5] - T[o + 5]) * u) * (T[o + 4] + (T[p + 4] - T[o + 4]) * u - n[i]);
    gE[i] *= decE; gI[i] *= decI;
    if (v < NRN.threshold && vn >= NRN.threshold) {
      const tc = t + dt * (NRN.threshold - v) / (vn - v);
      net.lastSpike[i] = tc; net.spikes.push(tc, i);
      if (net.onSpike) net.onSpike(i, tc);
      for (let c = net.ptr[i]; c < net.ptr[i + 1]; c++) out[(net.k + net.dsteps[c]) % net.slots].push(net.tgt[c], net.w[c], net.typ[c]);
    }
  }
  net.k++; net.t = t + dt;
}

// A current pulse (nA) for dur ms into every cell within radius r of point p.
// sel: 'E' | 'I' | 'all'. Returns the number of cells hit.
function stimulate(net, { p = [0, 0, 0], r = 120, amp = 1.2, dur = 2, sel = 'E' } = {}) {
  let hit = 0;
  for (let i = 0; i < net.N; i++) {
    if (sel === 'E' && i >= net.NE) continue; if (sel === 'I' && i < net.NE) continue;
    const dx = net.pos[i * 3] - p[0], dy = net.pos[i * 3 + 1] - p[1], dz = net.pos[i * 3 + 2] - p[2];
    if (dx * dx + dy * dy + dz * dz <= r * r) { net.stimUntil[i] = net.t + dur; net.stimAmp[i] = amp; hit++; }
  }
  return hit;
}

// Population rate in Hz per cell over bins of bin ms, for cells [a, b), over the last span ms.
export function popRate(net, span = 500, bin = 1, a = 0, b = net.NE) {
  const nb = Math.max(1, Math.round(span / bin)), H = new Float64Array(nb), t1 = net.t, t0 = t1 - span, S = net.spikes;
  for (let q = S.length - 2; q >= 0; q -= 2) { const t = S[q]; if (t < t0) break; const c = S[q + 1]; if (c < a || c >= b) continue; const k = Math.min(nb - 1, Math.floor((t - t0) / bin)); H[k]++; }
  for (let k = 0; k < nb; k++) H[k] = H[k] / (b - a) / (bin / 1000);
  return H;
}

// Peak of the spectrum of a rate trace (bin ms) between f0 and f1 Hz. { f, power, ratio }
export function peakFreq(H, bin = 1, f0 = 10, f1 = 150) {
  const n = H.length; let mean = 0; for (const x of H) mean += x; mean /= n;
  let best = 0, bf = 0, tot = 0, cnt = 0;
  for (let f = f0; f <= f1; f += 1) {
    let re = 0, im = 0; const w = 2 * Math.PI * f * bin / 1000;
    for (let k = 0; k < n; k++) { const x = H[k] - mean; re += x * Math.cos(w * k); im += x * Math.sin(w * k); }
    const p = re * re + im * im; tot += p; cnt++;
    if (p > best) { best = p; bf = f; }
  }
  return { f: bf, power: best, ratio: best / (tot / cnt || 1) };
}
