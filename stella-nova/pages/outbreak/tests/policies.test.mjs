// policies: each beta policy lowers transmission only on its routes;
// strength 0 gives 1; travel and borders change only edges that cross a
// border; triggers start at the threshold; quarantine and vaccination rules
import {
  POLICY_DEFS, SOURCES, defaultPolicies, triggerActive, transmissionMultiplier,
  airMultiplier, landMultiplier, arrivalCatch, vaccinationRate,
} from '../policies.js';

const IDS = ['distancing', 'masks', 'closures', 'isolation', 'travel', 'borders',
  'quarantine', 'vaccination', 'vectorControl', 'cleanWater'];
const ROUTES = ['resp', 'contact', 'water', 'flea', 'vector'];
const dis = route => ({ id: 't-' + route, route, R0: 2, latent: 3, infectious: 5, detect: 0.5,
  vaccine: { exists: true, lagDays: 30, efficacy: 0.8 } });
const only = (id, strength = 1) => {
  const p = defaultPolicies(); p[id] = { on: true, strength, trigger: 0 };
  return { p, active: { [id]: 0 } };
};
const node = { income: 1 };

export default function (ok) {
  ok('policies: every fixed id is defined', IDS.every(id => POLICY_DEFS.some(d => d.id === id)) && POLICY_DEFS.length === IDS.length);
  ok('policies: refs resolve in SOURCES', POLICY_DEFS.every(d => d.refs.every(r => SOURCES[r] && SOURCES[r].url)));
  const def = defaultPolicies();
  ok('policies: defaults are off', IDS.every(id => def[id] && def[id].on === false && def[id].strength >= 0 && def[id].strength <= 1));
  ok('policies: nothing active gives 1', ROUTES.every(r => transmissionMultiplier(dis(r), def, {}, node) === 1));

  // every beta policy alone: below 1 on its routes, 1 elsewhere
  for (const d of POLICY_DEFS.filter(d => ['contact', 'vector', 'water'].includes(d.kind))) {
    const { p, active } = only(d.id);
    const bad = [];
    for (const r of ROUTES) {
      const m = transmissionMultiplier(dis(r), p, active, node);
      const want = d.routes.includes(r);
      if (want ? !(m < 1 && m > 0) : m !== 1) bad.push(`${r}=${m.toFixed(3)}`);
    }
    ok(`policies: ${d.id} acts only on ${d.routes.join('/')}`, bad.length === 0, bad.join(' '));
    const z = only(d.id, 0);
    ok(`policies: ${d.id} at strength 0 gives 1`, ROUTES.every(r => transmissionMultiplier(dis(r), z.p, z.active, node) === 1));
    const off = only(d.id); off.p[d.id].on = false;
    ok(`policies: ${d.id} switched off gives 1`, ROUTES.every(r => transmissionMultiplier(dis(r), off.p, off.active, node) === 1));
  }

  // planned values
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  let q = only('distancing');
  ok('policies: distancing resp = 0.55', near(transmissionMultiplier(dis('resp'), q.p, q.active, node), 0.55));
  q = only('masks');
  ok('policies: masks resp = 0.70', near(transmissionMultiplier(dis('resp'), q.p, q.active, node), 0.70));
  q = only('isolation');
  ok('policies: isolation resp = 1 - 0.6 detect (high income)', near(transmissionMultiplier(dis('resp'), q.p, q.active, node), 1 - 0.6 * 0.5));
  ok('policies: isolation weaker in a low-income node',
    transmissionMultiplier(dis('resp'), q.p, q.active, { income: 5 }) > transmissionMultiplier(dis('resp'), q.p, q.active, node));
  q = only('cleanWater');
  ok('policies: clean water = 0.30', near(transmissionMultiplier(dis('water'), q.p, q.active, node), 0.30));

  // all policies on at full strength: product stays in (0, 1]
  const all = defaultPolicies(), act = {};
  for (const id of IDS) { all[id] = { on: true, strength: 1, trigger: 0 }; act[id] = 0; }
  const mins = ROUTES.map(r => transmissionMultiplier({ ...dis(r), detect: 1 }, all, act, node));
  ok('policies: all on stays in (0, 1]', mins.every(m => m > 0 && m <= 1), mins.map(m => m.toFixed(3)).join(' '));
  const big = defaultPolicies(); big.masks = { on: true, strength: 7, trigger: 0 };
  ok('policies: strength clamps to 1', near(transmissionMultiplier(dis('resp'), big, { masks: 0 }, node), 0.70));

  // travel and borders
  q = only('travel');
  ok('policies: travel lowers international air edges', near(airMultiplier({ intl: 1 }, q.p, q.active), 0.1));
  ok('policies: travel leaves domestic air edges', airMultiplier({ intl: 0 }, q.p, q.active) === 1);
  ok('policies: travel leaves land edges', landMultiplier({ cross: 1 }, q.p, q.active) === 1);
  q = only('borders');
  ok('policies: borders lower cross-border land edges', near(landMultiplier({ cross: 1 }, q.p, q.active), 0.1));
  ok('policies: borders leave domestic land edges', landMultiplier({ cross: 0 }, q.p, q.active) === 1);
  ok('policies: borders leave air edges', airMultiplier({ intl: 1 }, q.p, q.active) === 1);
  ok('policies: edge flag may be a number', near(landMultiplier(1, q.p, q.active), 0.1) && landMultiplier(0, q.p, q.active) === 1);
  q = only('travel', 0);
  ok('policies: travel at strength 0 gives 1', airMultiplier({ intl: 1 }, q.p, q.active) === 1);

  // triggers
  const tp = { on: true, strength: 1, trigger: 500 };
  ok('policies: trigger not reached', triggerActive(tp, 499, 10) === false);
  ok('policies: trigger starts at the threshold', triggerActive(tp, 500, 10) === true && triggerActive(tp, 501, 10) === true);
  ok('policies: trigger 0 starts at day 0', triggerActive({ on: true, strength: 1, trigger: 0 }, 0, 0) === true);
  ok('policies: off never triggers', triggerActive({ on: false, strength: 1, trigger: 0 }, 1e9, 100) === false);

  // quarantine
  q = only('quarantine');
  ok('policies: quarantine catches 0.8 at full strength', near(arrivalCatch(dis('resp'), q.p, q.active), 0.8));
  ok('policies: quarantine halves for latent > 14 d', near(arrivalCatch({ ...dis('vector'), latent: 20 }, q.p, q.active), 0.4));
  ok('policies: no quarantine catches 0', arrivalCatch(dis('resp'), defaultPolicies(), {}) === 0);

  // vaccination
  q = only('vaccination', 1); q.active.vaccination = 10;
  const d = dis('resp');
  ok('policies: no vaccine before the lag', vaccinationRate(d, q.p, q.active, 39.9, 10) === 0);
  ok('policies: vaccine rate after the lag', near(vaccinationRate(d, q.p, q.active, 40, 10), 0.012 * 0.8));
  ok('policies: dayActive defaults to active', near(vaccinationRate(d, q.p, q.active, 40), 0.012 * 0.8));
  ok('policies: no vaccine for a disease without one', vaccinationRate({ ...d, vaccine: null }, q.p, q.active, 1000, 10) === 0);
  ok('policies: vaccination inactive gives 0', vaccinationRate(d, defaultPolicies(), {}, 1000, 0) === 0);
}
