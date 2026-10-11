// ============================================================================
//  FLY DUEL  ·  node tests for the brain  (node tests/brain.test.mjs)
// ----------------------------------------------------------------------------
//  Checks brain/mb.js and brain/fly.js on a small synthetic connectome that
//  this file builds (same shape as data/connectome.json). Checks: the KC
//  code is sparse and in the band, the k-winners select is right, the code
//  and the value are deterministic, the feature map spreads every feature,
//  the DAN sign convention, one update moves the value toward the target,
//  weights stay in [0, wmax], the JSON round trip, a two-armed task learns
//  in under 500 trials, and a toy afterstate game learns with Fly.
//  When game/ and data/connectome.json exist, an integration block plays
//  real games. Exit code 1 on any failure.
// ============================================================================
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mulberry32 } from '../data/rng.js';
import { MushroomBody } from '../brain/mb.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- synthetic
// 52 glomeruli x 3 PNs, 2000 KCs in 3 lobes with 6-7 claws, 15
// compartments with one or two MBONs, PAM on avoid compartments and PPL1
// on approach compartments (the textbook layout), and positions in um.
export function syntheticConnectome(seed = 7, { nKC = 2000 } = {}) {
  const rng = mulberry32(seed);
  const ri = n => Math.floor(rng() * n);
  const pos = () => [ri(300), ri(300), ri(200)];
  const G = 52, per = 3, nPN = G * per;
  const pn = { n: nPN, types: [], pos: [] };
  for (let g = 0; g < G; g++) for (let i = 0; i < per; i++) { pn.types.push(`G${g}`); pn.pos.push(pos()); }
  const lobes = ['KCab', "KCa'b'", 'KCg'];
  const kc = { n: nKC, types: [], pos: [] };
  for (let k = 0; k < nKC; k++) { kc.types.push(lobes[k % 3]); kc.pos.push(pos()); }
  // compartment: [name, lobe, valence]
  const comps = [
    ['a1', 0, -1], ['a2', 0, 1], ['a3', 0, 1], ['b1', 0, -1], ['b2', 0, -1],
    ["a'1", 1, -1], ["a'2", 1, 1], ["a'3", 1, 1], ["b'1", 1, -1], ["b'2", 1, -1],
    ['g1', 2, 1], ['g2', 2, 1], ['g3', 2, -1], ['g4', 2, -1], ['g5', 2, -1],
  ];
  const mbon = { n: 0, types: [], compartment: [], valence: [], pos: [] };
  const dan = { n: 0, types: [], cluster: [], compartment: [], pos: [] };
  const danMbon = [];
  comps.forEach(([name, , v], c) => {
    const nm = c % 4 === 0 ? 2 : 1;
    const first = mbon.n;
    for (let i = 0; i < nm; i++) { mbon.types.push(`MBON-${name}-${i}`); mbon.compartment.push(name); mbon.valence.push(v); mbon.pos.push(pos()); mbon.n++; }
    const nd = 3;
    for (let i = 0; i < nd; i++) {
      const d = dan.n++;
      dan.types.push(`${v < 0 ? 'PAM' : 'PPL1'}-${name}-${i}`);
      dan.cluster.push(v < 0 ? 'PAM' : 'PPL1'); dan.compartment.push(name); dan.pos.push(pos());
      for (let j = first; j < mbon.n; j++) danMbon.push([d, j]);
    }
  });
  // one MBON with no valence (atypical, should not be plastic)
  mbon.types.push('MBON-calyx'); mbon.compartment.push('calyx'); mbon.valence.push(0); mbon.pos.push(pos()); mbon.n++;
  const pn_kc = [], kc_mbon = [];
  for (let k = 0; k < nKC; k++) {
    if (k % 97 === 13) continue; // a few KCs with no PN claw (dead)
    const claws = 6 + ri(2), seen = new Set();
    while (seen.size < claws) seen.add(ri(nPN));
    for (const p of seen) pn_kc.push([p, k, 1 + ri(12)]);
    const lobe = k % 3;
    for (let j = 0; j < mbon.n; j++) {
      const cname = mbon.compartment[j];
      const c = comps.findIndex(x => x[0] === cname);
      if (c >= 0 && comps[c][1] === lobe) kc_mbon.push([k, j, 2 + ri(20)]);
      if (cname === 'calyx' && k % 5 === 0) kc_mbon.push([k, j, 3]);
    }
  }
  return {
    meta: { source: 'synthetic test wiring', release: 'test', licence: 'none', url: '', retrieved: '', notes: 'tests/brain.test.mjs', synthetic: true },
    pn, kc, mbon, dan, apl: { n: 1 },
    edges: { pn_kc, kc_mbon, dan_mbon_compartment: danMbon },
  };
}

const C = syntheticConnectome();
const F = 48;
const randFeat = rng => Float32Array.from({ length: F }, rng);

// ---------------------------------------------------------------- build
const t0 = performance.now();
const mb = new MushroomBody(C, { seed: 11, hemisphere: 'A', sparsity: 0.05 });
const tBuild = performance.now() - t0;
ok(mb.channelKind === 'glomerulus' && mb.nChannels === 52, `glomerulus channels (${mb.channelKind} ${mb.nChannels})`);
ok(mb.stats.kcDead === Math.ceil((2000 - 13) / 97), `dead KCs counted (${mb.stats.kcDead})`);
ok(mb.k === Math.round(0.05 * mb.nLive), `k = 5 % of live KCs (${mb.k})`);
ok(mb.stats.mbonPlastic === mb.nMBON - 1, `every valenced gated MBON is plastic, calyx MBON is not (${mb.stats.mbonPlastic}/${mb.nMBON})`);
ok(mb.stats.clusterAgree > 0 && mb.stats.clusterDisagree === 0, 'PAM gates avoid, PPL1 gates approach in the test wiring');
ok(tBuild < 2000, `build + calibration under 2 s (${tBuild.toFixed(0)} ms)`);

// receptor encoding: each feature has its own glomerulus, spare glomeruli
// get a second receptor, every glomerulus has one receptor, and a rate
// rises with its feature (Hill curve).
{
  const count = new Array(F).fill(0);
  for (let g = 0; g < mb.nChannels; g++) for (let r = mb.recPtr[g]; r < mb.recPtr[g + 1]; r++) count[mb.recFeature[r]]++;
  ok(count.every(c => c >= 1 && c <= 2) && count.reduce((a, b) => a + b) === mb.nChannels, 'receptor map: 1 or 2 glomeruli per feature, 1 receptor per glomerulus');
  ok(mb.channelFeatures.every(l => l.length === 1), 'receptor map: channelFeatures lists one feature per glomerulus');
  const g0 = mb.channelFeatures.findIndex(l => l[0] === 0);
  const f = new Float32Array(F).fill(0.5);
  let rising = true, prev = -1;
  for (let x = 0; x <= 1.0001; x += 0.1) { f[0] = x; mb.encode(f); if (!(mb._glom[g0] > prev)) rising = false; prev = mb._glom[g0]; }
  ok(rising, 'receptor rate rises with its feature');
  const pop = new MushroomBody(C, { seed: 11, encoding: 'population', calibration: false });
  const pc = new Array(F).fill(0), chans = Array.from({ length: F }, () => new Set());
  for (let g = 0; g < pop.nChannels; g++) for (let r = pop.recPtr[g]; r < pop.recPtr[g + 1]; r++) { pc[pop.recFeature[r]]++; chans[pop.recFeature[r]].add(g); }
  ok(pop.centres >= 3 && pc.every(c => c === pop.centres), `population map: each feature has ${pop.centres} tuning curves`);
  ok(chans.every(x => x.size >= 2), 'population map: each feature reaches at least 2 glomeruli');
  const pn = mb.encode(randFeat(mulberry32(3)));
  ok(pn.length === C.pn.n && pn.every(v => v >= 0 && v < 1), 'PN rates in [0, 1)');
  ok(C.pn.types.every((t, p) => pn[p] === pn[C.pn.types.indexOf(t)]), 'sister PNs share the glomerulus rate');
  const z = mb.encode(new Float32Array(F).fill(NaN));
  ok(z.every(Number.isFinite), 'NaN features give finite rates');
}

// ---------------------------------------------------------------- sparsity
{
  const rng = mulberry32(5);
  let okBand = true, fires = new Uint32Array(C.kc.n);
  for (let t = 0; t < 400; t++) {
    const kc = mb.kcActivity(mb.encode(randFeat(rng)));
    const frac = kc.length / mb.nLive;
    if (frac < 0.04 || frac > 0.06) okBand = false;
    for (let i = 1; i < kc.length; i++) if (kc[i] <= kc[i - 1]) okBand = false;
    for (const k of kc) { fires[k]++; if (!mb.kcLive[k]) okBand = false; }
  }
  ok(okBand, 'active KCs: 4-6 % of live KCs, sorted, no dead KC');
  let silent = 0;
  for (let k = 0; k < C.kc.n; k++) if (mb.kcLive[k] && fires[k] === 0) silent++;
  ok(silent / mb.nLive < 0.25, `homeostasis: under 25 % of live KCs silent over 400 boards (${(100 * silent / mb.nLive).toFixed(1)} %)`);
  // k winners: compare with a full sort of the z-scores
  const f = randFeat(rng);
  const kc = mb.kcActivity(mb.encode(f)).slice();
  const z = Array.from(mb._z).map((v, k) => [v, k]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, mb.k).map(x => x[1]).sort((a, b) => a - b);
  ok(z.length === kc.length && z.every((k, i) => k === kc[i]), 'k-winners select equals a full sort');
  // a small change in one feature keeps most of the code (generalisation)
  const g = f.slice(); g[0] = Math.min(1, g[0] + 0.05);
  const kc2 = new Set(mb.kcActivity(mb.encode(g)));
  const overlap = [...kc].filter(k => kc2.has(k)).length / kc.length;
  ok(overlap > 0.6, `small feature change keeps over 60 % of the KC code (${(overlap * 100).toFixed(0)} %)`);
  const h = randFeat(mulberry32(99));
  const kc3 = new Set(mb.kcActivity(mb.encode(h)));
  const overlap3 = [...kc].filter(k => kc3.has(k)).length / kc.length;
  ok(overlap3 < 0.4, `two random boards share under 40 % of the KC code (${(overlap3 * 100).toFixed(0)} %)`);
}

// ---------------------------------------------------------------- determinism
{
  const a = new MushroomBody(C, { seed: 11, hemisphere: 'A' });
  const b = new MushroomBody(C, { seed: 11, hemisphere: 'A' });
  const c = new MushroomBody(C, { seed: 11, hemisphere: 'B' });
  const f = randFeat(mulberry32(8));
  const ka = a.kcActivity(a.encode(f)).slice(), kb = b.kcActivity(b.encode(f)).slice(), kcB = c.kcActivity(c.encode(f)).slice();
  ok(ka.length === kb.length && ka.every((v, i) => v === kb[i]) && a.value(f) === b.value(f), 'same seed, same code and value');
  ok(!(ka.length === kcB.length && ka.every((v, i) => v === kcB[i])), 'hemisphere B has its own feature map');
  ok(Math.abs(a.bias) < 10 && Number.isFinite(a.bias), 'bias finite');
  let mean = 0; const rng = mulberry32(21);
  for (let i = 0; i < 200; i++) mean += a.value(randFeat(rng));
  ok(Math.abs(mean / 200) < 0.1, `naive mean value near 0 (${(mean / 200).toFixed(3)})`);
}

// ---------------------------------------------------------------- DAN sign
{
  const dPos = mb.danFromDelta(0.5), dNeg = mb.danFromDelta(-0.5);
  let good = true;
  mb.compartments.forEach((name, c) => {
    const v = mb.compValence[c];
    if (!mb.compGated[c]) { if (dPos[c] !== 0) good = false; return; }
    if (v < 0 && !(dPos[c] > 0 && dNeg[c] < 0)) good = false;  // avoid side (PAM) bursts on reward
    if (v > 0 && !(dPos[c] < 0 && dNeg[c] > 0)) good = false;  // approach side (PPL1) bursts on punishment
  });
  ok(good, 'delta > 0 bursts avoid (PAM) compartments, delta < 0 bursts approach (PPL1) compartments');
  const n = mb.danNeurons(dPos);
  ok(C.dan.cluster.every((cl, d) => cl === 'PAM' ? n[d] > 0 : n[d] === 0), 'positive TD error: only PAM neurons burst');
  const m = mb.danNeurons(dNeg);
  ok(C.dan.cluster.every((cl, d) => cl === 'PPL1' ? m[d] > 0 : m[d] === 0), 'negative TD error: only PPL1 neurons burst');
  // depression on reward: an avoid synapse of an active KC goes down
  const x = new MushroomBody(C, { seed: 4 });
  const f = randFeat(mulberry32(1));
  const kc = x.kcActivity(x.encode(f)).slice();
  const k = kc[0];
  let avoidE = -1, apprE = -1;
  for (let e = x.kcOutPtr[k]; e < x.kcOutPtr[k + 1]; e++) {
    if (!x.edgePlastic[e]) continue;
    if (x.valence[x.kcOutMbon[e]] < 0 && avoidE < 0) avoidE = e;
    if (x.valence[x.kcOutMbon[e]] > 0 && apprE < 0) apprE = e;
  }
  const wa = x.w[avoidE], wp = x.w[apprE];
  x.learn(kc, x.danFromDelta(0.3), 0.1);
  ok(avoidE >= 0 && x.w[avoidE] < wa, 'reward depresses the KC -> avoid-MBON synapse');
  ok(apprE >= 0 && x.w[apprE] > wp, 'reward: approach synapse recovers (DAN dip gives the opposite change)');
}

// ---------------------------------------------------------------- learn
{
  const x = new MushroomBody(C, { seed: 6 });
  const f = randFeat(mulberry32(2));
  const kc = x.kcActivity(x.encode(f)).slice();
  const v0 = x.valueOfKc(kc), target = 0.8;
  const lr = 0.25;
  x.learn(kc, x.danFromDelta(target - v0), lr);
  const v1 = x.valueOfKc(kc);
  ok(near(v1 - v0, lr * (target - v0), 1e-3), `one update removes lr of the error (${(v1 - v0).toFixed(4)} vs ${(lr * (target - v0)).toFixed(4)})`);
  for (let i = 0; i < 40; i++) x.learn(kc, x.danFromDelta(target - x.valueOfKc(kc)), lr);
  ok(near(x.valueOfKc(kc), target, 0.02), `repeated updates reach the target (${x.valueOfKc(kc).toFixed(3)})`);
  for (let i = 0; i < 40; i++) x.learn(kc, x.danFromDelta(-1 - x.valueOfKc(kc)), lr);
  ok(near(x.valueOfKc(kc), -1, 0.05), `and go back down to -1 (${x.valueOfKc(kc).toFixed(3)})`);
  // bounds under extreme signals
  for (let i = 0; i < 200; i++) x.learn(kc, x.danFromDelta(i % 2 ? 50 : -50), 1);
  let inb = true;
  for (const w of x.w) if (!(w >= 0 && w <= x.wmax)) inb = false;
  ok(inb, 'weights stay in [0, wmax] under large errors');
  // trace: e decays, learn with null uses the trace
  const y = new MushroomBody(C, { seed: 6 });
  const fa = randFeat(mulberry32(31)), fb = randFeat(mulberry32(32));
  const ka = y.kcActivity(y.encode(fa)).slice(), kb = y.kcActivity(y.encode(fb)).slice();
  y.traceStep(ka, 0); y.traceStep(kb, 0.5);
  const onlyA = ka.filter(k => !kb.includes(k));
  ok(onlyA.every(k => y.elig[k] === 0.5) && kb.every(k => y.elig[k] === 1), 'replacing trace: old KCs decay, new KCs set to 1');
  const va = y.valueOfKc(ka), vb = y.valueOfKc(kb);
  y.learn(null, y.danFromDelta(1), 0.2, kb);
  ok(y.valueOfKc(kb) - vb > 0.15 && y.valueOfKc(ka) - va > 0.05, 'trace update credits the current and the older pattern');
  y.traceStep(null, 0.0001);
  ok(y.eligN === 0, 'trace drops values under 1e-3');
}

// ---------------------------------------------------------------- JSON
{
  const x = new MushroomBody(C, { seed: 9, hemisphere: 'B' });
  const rng = mulberry32(4);
  for (let i = 0; i < 50; i++) { const kc = x.kcActivity(x.encode(randFeat(rng))).slice(); x.learn(kc, x.danFromDelta(rng() - 0.5), 0.3); }
  const json = JSON.parse(JSON.stringify(x));
  const y = MushroomBody.fromJSON(C, json);
  const f = randFeat(mulberry32(77));
  ok(y.value(f) === x.value(f), 'JSON round trip keeps the value exactly');
  ok(y.hemisphere === 'B' && y.updates === x.updates && y.w.every((w, i) => w === x.w[i]), 'JSON round trip keeps weights and metadata');
  const bytes = 4 * (2 * x.nKC + x.w.length), size = JSON.stringify(x).length;
  ok(size < bytes * 4 / 3 + 2000, `JSON is base64 float32, no more (${size} chars for ${bytes} bytes)`);
  let threw = false;
  try { MushroomBody.fromJSON(syntheticConnectome(8), json); } catch { threw = true; }
  ok(threw, 'fromJSON refuses weights from other wiring');
  x.reset();
  ok(x.w.every((w, i) => w === x.w0[i]) && x.updates === 0, 'reset gives naive weights');
}

// ---------------------------------------------------------------- two-armed task
// Arm A pays 1 with p = 0.8, arm B with p = 0.2. Softmax at T = 0.1 on
// the MB values. Pass: greedy choice is A and the last 100 trials pick A
// over 80 % of the time, inside 500 trials, for 3 seeds.
for (const seed of [1, 2, 3]) {
  const x = new MushroomBody(C, { seed: 100 + seed });
  const rng = mulberry32(seed);
  const fA = randFeat(mulberry32(1000 + seed)), fB = randFeat(mulberry32(2000 + seed));
  const kA = x.kcActivity(x.encode(fA)).slice(), kB = x.kcActivity(x.encode(fB)).slice();
  let lastA = 0, solvedAt = -1;
  for (let t = 0; t < 500; t++) {
    const va = x.valueOfKc(kA), vb = x.valueOfKc(kB);
    const pa = 1 / (1 + Math.exp(-(va - vb) / 0.1));
    const pickA = rng() < pa;
    const r = rng() < (pickA ? 0.8 : 0.2) ? 1 : 0;
    const kc = pickA ? kA : kB;
    x.learn(kc, x.danFromDelta(r - x.valueOfKc(kc)), 0.1);
    if (t >= 400 && pickA) lastA++;
    if (solvedAt < 0 && x.valueOfKc(kA) - x.valueOfKc(kB) > 0.3) solvedAt = t;
  }
  ok(lastA > 80 && x.valueOfKc(kA) > x.valueOfKc(kB), `two-armed seed ${seed}: last 100 pick A ${lastA} times, solved at trial ${solvedAt}`);
  ok(near(x.valueOfKc(kA), 0.8, 0.25), `two-armed seed ${seed}: V(A) near 0.8 (${x.valueOfKc(kA).toFixed(2)})`);
}

// ---------------------------------------------------------------- speed
{
  const rng = mulberry32(12);
  const fs = Array.from({ length: 64 }, () => randFeat(rng));
  const t1 = performance.now();
  let s = 0;
  for (let i = 0; i < 4000; i++) s += mb.value(fs[i & 63]);
  const us = (performance.now() - t1) * 1000 / 4000;
  ok(Number.isFinite(s) && us < 200, `value() costs ${us.toFixed(1)} us per board (budget 200)`);
}

// ---------------------------------------------------------------- Fly (stub game)
// A walk game: the board is a position 0..10, start 5. "up" adds 1,
// "down" takes 1. 10 wins for the walker, 0 loses, turn 40 is a draw.
// feature 0 is pos / 10, the rest are fixed noise. The fly must learn
// to go up from every position.
const { FlyAgent, calibrationSet } = await import('../brain/agent.js');
const walk = {
  newGame: ({ seed = 1 } = {}) => ({ toAct: 0, turn: 0, pos: 5, seed, players: [{ life: 20 }, { life: 20 }], result: null }),
  legalActions: s => s.result ? [] : [{ type: 'up' }, { type: 'down' }],
  step: (s, a) => {
    const pos = s.pos + (a.type === 'up' ? 1 : -1), turn = s.turn + 1;
    const result = pos >= 10 ? { winner: 0, reason: 'top' } : pos <= 0 ? { winner: 1, reason: 'bottom' } : turn >= 40 ? { winner: -1, reason: 'cap' } : null;
    return { ...s, pos, turn, result, players: [{ life: 20 - (10 - pos) }, { life: 20 }] };
  },
  isOver: s => s.result,
};
{
  const noise = randFeat(mulberry32(44));
  walk.features = (s, me) => { const f = noise.slice(); f[0] = s.pos / 10; f[1] = 1 - s.pos / 10; return f; };
  const cal = calibrationSet(walk, { seed: 3, games: 4 });
  ok(cal.length > 10 && cal.every(f => f.length === F), `calibrationSet gives boards (${cal.length})`);
  let threw = false;
  try { new FlyAgent(C, {}); } catch { threw = true; }
  ok(threw, 'FlyAgent needs a game');

  const play = (fly, learn, explore, seed) => {
    let s = walk.newGame({ seed }); fly.reset();
    const states = [];
    while (!walk.isOver(s)) {
      const legal = walk.legalActions(s);
      const before = JSON.stringify(s);
      const r = fly.choose(s, legal, { explore, learn, trace: false });
      if (JSON.stringify(s) !== before) throw new Error('choose changed the state');
      s = walk.step(s, r.action); states.push(s.pos);
    }
    const o = walk.isOver(s);
    if (learn) fly.observe(null, s, o.winner === 0 ? 1 : o.winner === -1 ? 0 : -1, true);
    return o.winner;
  };
  for (const shaping of [0, 0.2]) {
    const fly = new FlyAgent(C, { game: walk, seed: 5, lr: 0.1, shaping });
    let wins = 0;
    for (let g = 0; g < 300; g++) play(fly, true, 0.1, g);
    for (let g = 0; g < 20; g++) if (play(fly, false, 0, 1000 + g) === 0) wins++;
    const vals = [];
    for (let p = 1; p < 10; p++) vals.push(fly.mb.value(walk.features({ pos: p })));
    const rising = vals.filter((v, i) => i === 0 || v > vals[i - 1] - 0.02).length;
    ok(wins === 20, `walk game, shaping ${shaping}: greedy fly wins 20/20 after 300 games (${wins})`);
    ok(rising >= 8, `walk game, shaping ${shaping}: learned value rises with position (${vals.map(v => v.toFixed(2)).join(' ')})`);
    ok(fly.mb.w.every(w => w >= 0 && w <= fly.mb.wmax), 'walk game: weights in bounds');
  }
  // way B: observe at the next own decision board. Here seat 1 is a wind
  // that pushes the walker down with p = 0.25 between the walker moves.
  {
    const windy = { ...walk,
      legalActions: s => s.result ? [] : s.toAct === 0 ? [{ type: 'up' }, { type: 'down' }] : [{ type: 'wind' }],
      step: (s, a) => {
        if (a.type !== 'wind') return { ...walk.step(s, a), toAct: 1 };
        const pos = s.pos - (a.push ? 1 : 0);
        return { ...s, pos, toAct: 0, result: pos <= 0 ? { winner: 1, reason: 'bottom' } : null };
      } };
    const fly = new FlyAgent(C, { game: windy, seed: 6, lr: 0.1 });
    const wr = mulberry32(17);
    const run = (learn, explore) => {
      let s = windy.newGame(); fly.reset();
      let prev = null;
      while (!windy.isOver(s)) {
        if (s.toAct === 1) { s = windy.step(s, { type: 'wind', push: wr() < 0.25 }); continue; }
        if (learn && prev) fly.observe(prev, s, 0, false);
        prev = s;
        s = windy.step(s, fly.choose(s, windy.legalActions(s), { explore, trace: false }).action);
      }
      const o = windy.isOver(s);
      if (learn) fly.observe(prev, s, o.winner === 0 ? 1 : o.winner === -1 ? 0 : -1, true);
      return o.winner;
    };
    for (let g = 0; g < 300; g++) run(true, 0.1);
    let wins = 0;
    for (let g = 0; g < 20; g++) if (run(false, 0) === 0) wins++;
    ok(wins >= 19, `windy walk, way B (observe): greedy fly wins ${wins}/20`);
  }
  // trace, determinism, JSON
  {
    const fly = new FlyAgent(C, { game: walk, seed: 7, name: 'Fly B', hemisphere: 'B' });
    const s = walk.newGame();
    const r = fly.choose(s, walk.legalActions(s), { explore: 0 });
    const t = r.trace;
    ok(t && t.pn.length === C.pn.n && t.mbon.length === C.mbon.n && t.dan.length === C.dan.n && t.kc.length === fly.mb.k, 'trace: PN, KC, MBON, DAN arrays have the wiring sizes');
    ok(t.glomeruli.length === fly.mb.nChannels && t.features.length === F && t.fly === 'Fly B' && t.hemisphere === 'B', 'trace: glomeruli, features, names');
    ok(r.values.length === 2 && r.probs[r.index] === 1 && Math.abs(t.value - r.values[r.index]) < 1e-9, 'trace value is the chosen afterstate value');
    const g2 = FlyAgent.fromJSON(C, JSON.parse(JSON.stringify(fly)), walk);
    const r2 = g2.choose(s, walk.legalActions(s));
    ok(r2.index === r.index && r2.values.every((v, i) => v === r.values[i]), 'Fly JSON round trip: same values and choice');
    ok(g2.name === 'Fly B' && g2.mb.hemisphere === 'B', 'Fly JSON keeps the name and the hemisphere');
    // a terminal afterstate has its true value
    const near10 = { ...walk.newGame(), pos: 9 };
    const r3 = fly.choose(near10, walk.legalActions(near10));
    ok(r3.values[0] === 1 && r3.action.type === 'up', 'winning afterstate scores +1 and is chosen');
    // learn after a positive end shows a PAM burst in the trace
    const f2 = new FlyAgent(C, { game: walk, seed: 8 });
    const s2 = { ...walk.newGame(), pos: 5 };
    f2.choose(s2, walk.legalActions(s2), { learn: true });
    const L = f2.observe(null, s2, 1, true);
    ok(L && L.delta > 0 && L.after > L.before, 'end reward +1: positive TD error raises the value');
    ok(C.dan.cluster.every((cl, d) => cl === 'PAM' ? L.danNeurons[d] > 0 : L.danNeurons[d] === 0), 'positive TD error: PAM neurons burst');
    ok(f2.observe(null, s2, 1, true) === null, 'second end call does nothing (no double count)');
  }
}

// ---------------------------------------------------------------- integration
// Runs only when the real game and the real connectome exist.
const need = ['game/rules.js', 'game/features.js', 'data/connectome.json'].map(p => join(ROOT, p));
if (need.every(existsSync)) {
  const RC = JSON.parse(readFileSync(need[2], 'utf8'));
  const { Fly, makePair, GAME } = await import(pathToFileURL(join(ROOT, 'brain/fly.js')).href);
  const R = await import(pathToFileURL(need[0]).href);
  const t1 = performance.now();
  const [A, B] = makePair(RC, { seed: 1 });
  const tPair = performance.now() - t1;
  ok(A.mb.stats.kcLive > 1000 && A.mb.stats.mbonPlastic > 10, `real wiring: ${A.mb.stats.kcLive} live KCs, ${A.mb.stats.mbonPlastic} plastic MBONs`);
  ok(A.mb.channelKind === 'glomerulus', `real wiring: ${A.mb.nChannels} glomeruli`);
  ok(A.mb.fingerprint === B.mb.fingerprint && A.mb.k === B.mb.k, 'fly A and fly B share the real wiring');
  ok(tPair < 3000, `two flies with calibration in ${tPair.toFixed(0)} ms`);
  const frac = A.mb.k / A.mb.nLive;
  ok(frac > 0.045 && frac < 0.055, `real wiring sparsity ${(frac * 100).toFixed(1)} %`);
  const flies = [A, B];
  let games = 0, decisions = 0, bad = 0, mutated = 0, maxCand = 0;
  const t2 = performance.now();
  for (let g = 0; g < 6; g++) {
    let s = R.newGame({ seed: 500 + g, first: g & 1, log: false });
    A.reset(); B.reset();
    while (!R.isOver(s)) {
      const legal = R.legalActions(s);
      const fly = flies[s.toAct];
      const before = JSON.stringify(s);
      const r = fly.choose(s, legal, { explore: 0.05, learn: true, trace: decisions % 10 === 0 });
      if (JSON.stringify(s) !== before) mutated++;
      if (!r.values.every(Number.isFinite)) bad++;
      if (r.trace) {
        const t = r.trace;
        if (t.pn.length !== RC.pn.n || t.mbon.length !== RC.mbon.n || t.dan.length !== RC.dan.n || t.kc.length > A.mb.k) bad++;
        for (let i = 1; i < t.kc.length; i++) if (t.kc[i] <= t.kc[i - 1]) bad++;
      }
      maxCand = Math.max(maxCand, legal.length);
      decisions++;
      s = R.step(s, r.action);
    }
    const o = R.isOver(s);
    for (const me of [0, 1]) flies[me].observe(null, s, o.winner === me ? 1 : o.winner === -1 ? 0 : -1, true);
    games++;
  }
  const msGame = (performance.now() - t2) / games;
  ok(bad === 0 && mutated === 0, `real games: finite values, valid traces, no state change (${decisions} decisions, up to ${maxCand} options)`);
  ok(A.updates > 0 && B.updates > 0 && A.mb.w.every(w => w >= 0 && w <= A.mb.wmax), `real games: both flies learn (${A.updates}, ${B.updates} updates), weights in bounds`);
  ok(msGame < 500, `real self-play with learning: ${msGame.toFixed(1)} ms per game`);
  const A2 = Fly.fromJSON(RC, JSON.parse(JSON.stringify(A)));
  const s0 = R.newGame({ seed: 9, log: false });
  const c1 = A.choose(s0, R.legalActions(s0)), c2 = A2.choose(s0, R.legalActions(s0));
  ok(c1.index === c2.index && c1.values.every((v, i) => v === c2.values[i]), 'real Fly JSON round trip');
  ok(GAME.features(s0, 0).length === 48, 'features() gives 48 numbers');
} else console.log('brain: integration block skipped (game/ or data/connectome.json missing)');

console.log(`brain: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
