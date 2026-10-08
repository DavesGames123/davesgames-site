// model: conservation per node; one-node final size matches finalSizeR for
// R0 = 2 and 3; each contact policy lowers R_eff; a travel ban lowers the
// countries reached over 5 seeds; same seed gives the same run; SEIRS with
// waning stays endemic; cholera grows less in a high-income node
import { readFileSync } from 'node:fs';
import { parseNodes } from '../data.js';
import { buildNetwork } from '../network.js';
import { getDisease } from '../diseases.js';
import { defaultPolicies } from '../policies.js';
import { createSim, finalSizeR, DT } from '../model.js';

const REG = ['EAP', 'ECA', 'LAC', 'MENA', 'NA', 'SA', 'SSA'];
const one = (over = {}) => ({ regions: REG, nodes: [{ i: 0, name: 'Test', iso3: 'TST', country: 'Test', region: 0,
  income: 1, lat: 45, lon: 0, pop: 1e7, cityPop: 1e6, hub: true, ...over }] });
const dis = (id, patch = {}) => ({ ...getDisease(id), ...patch });
const pols = (on = {}) => {
  const p = defaultPolicies();
  for (const [id, s] of Object.entries(on)) p[id] = { on: true, strength: s, trigger: 0 };
  return p;
};
const runDays = (sim, days) => { for (let d = 0; d < days && !sim.burnedOut; d++) sim.step(1); return sim; };

export default function (ok) {
  ok('model: DT is 0.25', DT === 0.25);
  ok('model: finalSizeR(2) = 0.7968', Math.abs(finalSizeR(2) - 0.796812) < 1e-5, finalSizeR(2).toFixed(6));
  ok('model: finalSizeR below threshold is 0', finalSizeR(0.9) === 0);

  // one node, no travel: final size
  for (const R0 of [2, 3]) {
    const d = dis('covid-ancestral', { R0, seasonality: 0, immune0: 0, vaccine: null });
    const sim = createSim({ D: one(), net: null, disease: d, policies: pols(), seed: 7, seedNode: 0, seedCount: 100 });
    runDays(sim, 1400);
    const fs = (sim.R[0] + sim.D[0]) / 1e7, want = finalSizeR(R0);
    ok(`model: R0 ${R0} final size within 0.02`, Math.abs(fs - want) < 0.02 && sim.burnedOut, `${fs.toFixed(4)} vs ${want.toFixed(4)}, day ${sim.day}`);
  }

  // half-day steps keep the remainder
  const a = createSim({ D: one(), disease: dis('flu-1918'), policies: pols(), seed: 3 });
  a.step(0.1); a.step(0.1); a.step(0.1);
  ok('model: step keeps the remainder of a substep', a.day === 0.25, `day ${a.day}`);

  // contact policies lower R_eff
  const base = createSim({ D: one(), disease: dis('covid-ancestral'), policies: pols(), seed: 1 });
  base.step(1);
  const r0 = base.reffNode(0);
  for (const id of ['distancing', 'masks', 'closures', 'isolation']) {
    const s = createSim({ D: one(), disease: dis('covid-ancestral'), policies: pols({ [id]: 1 }), seed: 1 });
    s.step(1);
    ok(`model: ${id} lowers R_eff`, s.reffNode(0) < r0 && s.active[id] === 0, `${s.reffNode(0).toFixed(3)} < ${r0.toFixed(3)}`);
  }
  const vc = (id, pol) => {
    const s = createSim({ D: one({ lat: 5, income: 4 }), disease: dis(id), policies: pols(pol), seed: 1 }); s.step(1); return s.reffNode(0);
  };
  ok('model: vector control lowers dengue R_eff', vc('dengue', { vectorControl: 1 }) < vc('dengue', {}));
  ok('model: clean water lowers cholera R_eff', vc('cholera', { cleanWater: 1 }) < vc('cholera', {}));

  // the world network
  const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url))));
  const net = buildNetwork(D), N = D.nodes.length;
  const seedNode = net.hubs[3];

  // conservation with every kind of policy on
  {
    const p = pols({ travel: 0.5, borders: 0.5, quarantine: 0.6, vaccination: 0.5, distancing: 0.3 });
    const s = createSim({ D, net, disease: dis('covid-variant'), policies: p, seed: 11, seedNode });
    const pop0 = D.nodes.map(n => n.pop);
    runDays(s, 200);
    let worst = 0, neg = false;
    for (let i = 0; i < N; i++) {
      const t = s.S[i] + s.E[i] + s.I[i] + s.R[i] + s.D[i] + s.V[i];
      worst = Math.max(worst, Math.abs(t - pop0[i]) / pop0[i]);
      if (s.S[i] < -1e-6 || s.E[i] < -1e-6 || s.I[i] < -1e-6 || s.R[i] < -1e-6) neg = true;
    }
    ok('model: population per node conserved to 1e-6', worst < 1e-6, `worst ${worst.toExponential(2)}`);
    ok('model: no compartment goes negative', !neg);
    ok('model: history has one row a day', s.history.day.length === 201 && s.history.regionI[200].length === 7, `${s.history.day.length} rows`);
    ok('model: the epidemic reaches other nodes', s.firstDay.filter(x => x >= 0).length > 50, `${s.firstDay.filter(x => x >= 0).length} nodes`);
    ok('model: events are logged with first flags', s.events.some(e => e.first && e.kind === 'air') && s.events.some(e => e.blocked));
    const { list, cursor } = s.eventsSince(0);
    ok('model: eventsSince returns the whole list and a cursor', list.length === s.events.length && s.eventsSince(cursor).list.length === 0);
  }

  // determinism
  {
    const mk = () => runDays(createSim({ D, net, disease: dis('flu-1918'), policies: pols({ quarantine: 0.5 }), seed: 42, seedNode }), 120);
    const x = mk(), y = mk();
    ok('model: same seed gives the same history and events',
      JSON.stringify(x.history.inc) === JSON.stringify(y.history.inc) && JSON.stringify(x.events) === JSON.stringify(y.events) && x.events.length > 0,
      `${x.events.length} events`);
  }

  // travel ban: fewer countries reached by day 40, summed over 5 seeds
  {
    const country = D.nodes.map(n => n.iso3);
    const reached = p => {
      let tot = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const s = runDays(createSim({ D, net, disease: dis('covid-ancestral'), policies: p, seed, seedNode, seedCount: 20 }), 40);
        const set = new Set();
        for (let i = 0; i < N; i++) if (s.firstDay[i] >= 0) set.add(country[i]);
        tot += set.size;
      }
      return tot;
    };
    const free = reached(pols()), ban = reached(pols({ travel: 1 }));
    ok('model: a travel ban lowers the countries reached', ban < free, `${ban} < ${free}`);
  }

  // SEIRS endemic
  {
    const s = createSim({ D: one({ pop: 1e8 }), disease: dis('covid-variant'), policies: pols(), seed: 5, seedCount: 50 });
    runDays(s, 1000);
    let minI = Infinity;
    for (let d = 300; d < s.history.I.length; d++) minI = Math.min(minI, s.history.E[d] + s.history.I[d]);
    ok('model: SEIRS with waning stays endemic', !s.burnedOut && minI > 1, `min E+I ${minI.toFixed(0)} after day 300`);
  }

  // cholera: high income vs low income
  {
    const run = inc => {
      const s = createSim({ D: one({ lat: 0, income: inc }), disease: dis('cholera'), policies: pols(), seed: 9, seedCount: 50 });
      runDays(s, 300); return s.cum[0];
    };
    const hi = run(1), lo = run(5);
    ok('model: cholera grows less in a high-income node', hi < lo, `${hi.toFixed(0)} < ${lo.toFixed(0)}`);
  }

  // vector disease stays where the climate allows it
  {
    const run = lat => runDays(createSim({ D: one({ lat, income: 4 }), disease: dis('dengue', { seasonality: 0 }), policies: pols(), seed: 2, seedCount: 50 }), 200).cum[0];
    const trop = run(5), cold = run(55);
    ok('model: dengue grows in the tropics, not at 55 N', trop > 1e5 && cold < 1000, `${trop.toFixed(0)} vs ${cold.toFixed(0)}`);
  }
}
