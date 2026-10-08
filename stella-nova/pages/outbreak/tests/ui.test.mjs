// OUTBREAK · tests/ui.test.mjs — package J: the DOM-free helpers of ui.js
// and the static checks of index.html and style.css (no browser).
// When diseases.js (package A) is not there yet, a resolve hook gives
// ui.js a two-preset stand-in, so the helpers can still be tested.
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

const here = new URL('../', import.meta.url);
const STUB = `
export const PRESETS = [
  { id: 'flu-seasonal', name: 'Seasonal influenza', short: 'Flu', route: 'resp', R0: 1.3, latent: 2, infectious: 3, ifr: 0.0005, waning: 730, vaccine: { exists: true, lagDays: 0, efficacy: 0.5 } },
  { id: 'dengue', name: 'Dengue', short: 'Dengue', route: 'vector', R0: 3, latent: 5, infectious: 5, ifr: 0.0005, waning: 0, vaccine: null },
  { id: 'custom', name: 'Custom', route: 'resp', R0: 2, latent: 2, infectious: 4, ifr: 0.01, waning: 0, vaccine: null },
];
export const SCHEMA = [{ key: 'R0', label: 'R0', min: 0.5, max: 20, step: 0.1, unit: '' }, { key: 'ifr', label: 'Fatality', min: 0, max: 0.6, step: 0.0005, unit: '' }];
export function customDisease(base, patch) { return { ...base, ...patch, ifr: Math.min(0.6, (patch && patch.ifr) ?? base.ifr) }; }
`;

export default async function (ok) {
  const realA = existsSync(new URL('diseases.js', here));
  if (!realA) {
    registerHooks({
      resolve(spec, ctx, next) {
        if (spec === './diseases.js' && ctx.parentURL && ctx.parentURL.endsWith('/outbreak/ui.js'))
          return { url: 'data:text/javascript,' + encodeURIComponent(STUB), shortCircuit: true };
        return next(spec, ctx);
      },
    });
  }
  const U = await import(new URL('ui.js', here));
  const { defaultPolicies, POLICY_DEFS } = await import(new URL('policies.js', here));
  const { parseNodes } = await import(new URL('data.js', here));
  ok('ui: imports', typeof U.createUI === 'function', realA ? 'with diseases.js' : 'diseases.js missing, stand-in used');

  // formats
  ok('ui: fmtCount', U.fmtCount(950) === '950' && U.fmtCount(12400) === '12 k' && U.fmtCount(3.1e6) === '3.1 M' && U.fmtCount(1.24e9) === '1.24 bn' && U.fmtCount(-5) === '0');
  ok('ui: fmtPct', U.fmtPct(0.0005) === '0.050 %' && U.fmtPct(0.4) === '40 %' && U.fmtPct(0) === '0 %', U.fmtPct(0.0005));
  ok('ui: fmtSchema fraction as %', U.fmtSchema({ key: 'ifr', step: 0.0005, unit: '' }, 0.02) === '2.0 %');
  ok('ui: fmtSchema days', U.fmtSchema({ key: 'latent', step: 0.5, unit: 'd' }, 2.5) === '2.5 d');

  // triggers
  ok('ui: triggerIndex round trip', U.TRIGGERS.every((t, i) => U.triggerIndex(t) === i));
  ok('ui: triggerIndex nearest', U.triggerIndex(2500) === 2 && U.triggerIndex(4e5) === 5 && U.triggerIndex(-1) === 0);

  // policy applicability and status
  const def = id => POLICY_DEFS.find(d => d.id === id);
  ok('ui: masks act on resp only', U.policyApplies(def('masks'), { route: 'resp' }).applies && !U.policyApplies(def('masks'), { route: 'vector' }).applies);
  ok('ui: vaccination needs a vaccine', !U.policyApplies(def('vaccination'), { route: 'resp', vaccine: null }).applies
    && U.policyApplies(def('vaccination'), { route: 'resp', vaccine: { exists: true } }).applies
    && /after 180/.test(U.policyApplies(def('vaccination'), { route: 'resp', vaccine: { exists: false, lagDays: 180 } }).why));
  ok('ui: travel applies to every route', U.policyApplies(def('travel'), { route: 'water' }).applies);
  ok('ui: policyStatus', U.policyStatus({ on: false }, undefined, 0).state === 'off'
    && U.policyStatus({ on: true, trigger: 1000 }, 12.7, 0).text === 'since day 12'
    && U.policyStatus({ on: true, trigger: 1000 }, undefined, 300).state === 'wait');

  // response sets
  const same = (a, b) => Object.keys(a).every(k => a[k].on === b[k].on && a[k].strength === b[k].strength && a[k].trigger === b[k].trigger);
  ok('ui: response none = defaults', same(U.responsePolicies('none', 'resp'), defaultPolicies()));
  let rt = true, ids = true;
  for (const route of ['resp', 'contact', 'vector', 'water', 'flea']) for (const k of ['none', 'late', 'early', 'route']) {
    const p = U.responsePolicies(k, route);
    if (Object.keys(p).some(id => !def(id))) ids = false;
    const m = U.matchResponse(p, route);
    if (m !== k && !(k !== 'none' && m && same(U.responsePolicies(m, route), p))) rt = false;
  }
  ok('ui: response sets use only known policy ids', ids);
  ok('ui: matchResponse finds each response set', rt);
  ok('ui: response for vector route uses vector control', U.responsePolicies('route', 'vector').vectorControl.on && !U.responsePolicies('route', 'vector').masks.on);

  // nodes: region table, seeds
  const D = parseNodes(JSON.parse(readFileSync(new URL('data/nodes.json', here), 'utf8')));
  const N = D.nodes.length;
  const z = () => new Float64Array(N);
  const sim = { N, day: 41.6, S: z(), E: z(), I: z(), R: z(), D: z(), V: z(), cum: z(), firstDay: new Float64Array(N).fill(-1), active: { masks: 20 } };
  let tI = 0, tC = 0, tD = 0;
  D.nodes.forEach((n, i) => {
    sim.S[i] = n.pop * 0.9; sim.I[i] = (i % 7) * 100; sim.R[i] = n.pop * 0.1 - sim.I[i]; sim.cum[i] = sim.I[i] * 3; sim.D[i] = i % 3;
    tI += sim.I[i]; tC += sim.cum[i]; tD += sim.D[i];
    if (i % 2) sim.firstDay[i] = 3;
  });
  sim.totals = () => ({ S: 0, E: 0, I: tI, R: 0, D: tD, V: 0, cases: tC, deaths: tD, detected: tC * 0.3, pop: 0 });
  sim.reffGlobal = () => 1.37;
  const rows = U.regionRows(D, sim);
  ok('ui: regionRows has every region', rows.length === D.regions.length && new Set(rows.map(r => r.name)).size === D.regions.length);
  ok('ui: regionRows sums match', Math.abs(rows.reduce((a, r) => a + r.I, 0) - tI) < 1e-6 && Math.abs(rows.reduce((a, r) => a + r.cases, 0) - tC) < 1e-6
    && rows.reduce((a, r) => a + r.cities, 0) === N);
  ok('ui: regionRows sorted by cases', rows.every((r, i) => i === 0 || rows[i - 1].cases >= r.cases));
  ok('ui: regionRows prevalence in [0, 1]', rows.every(r => r.prev >= 0 && r.prev <= 1));
  const h = U.hudValues(sim);
  ok('ui: hudValues', h.cities === Math.floor(N / 2) && h.reff === 1.37 && h.cases === tC && Math.abs(h.day - 41.6) < 1e-9);
  ok('ui: hudValues without a sim', U.hudValues(null).reff === null);
  const seeds = U.seedChoices(D, 60);
  ok('ui: seedChoices gives 60 large cities by name', seeds.length === 60 && new Set(seeds.map(s => s.i)).size === 60
    && seeds.every((s, i) => i === 0 || seeds[i - 1].name <= s.name) && seeds.every(s => s.i >= 0 && s.i < N));
  const minSeedPop = Math.min(...seeds.map(s => D.nodes[s.i].cityPop));
  ok('ui: seedChoices are the largest', D.nodes.filter(n => n.cityPop > minSeedPop).length < 60);
  ok('ui: presetList drops custom', U.presetList().length > 0 && U.presetList().every(d => d.id !== 'custom'));

  // static markup
  const html = readFileSync(new URL('index.html', here), 'utf8');
  const src = readFileSync(new URL('ui.js', here), 'utf8');
  const css = readFileSync(new URL('style.css', here), 'utf8');
  const heads = ['gpu-guard.js', 'wishlist.js', 'stats-beacon.js'].map(f => html.indexOf(`../../lib/${f}`));
  ok('ui: head scripts in order', heads.every(x => x > 0) && heads[0] < heads[1] && heads[1] < heads[2] && heads[2] < html.indexOf('<meta charset'));
  ok('ui: importmap three r160 exists', html.includes('../../vendor/three@0.160.0/build/three.module.js')
    && existsSync(new URL('../../vendor/three@0.160.0/build/three.module.js', here)));
  const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const want = new Set([...src.matchAll(/\$\('([A-Za-z]+)'\)/g)].map(m => m[1]));
  const missing = [...want].filter(id => !htmlIds.has(id));
  ok('ui: every id ui.js binds exists in index.html', missing.length === 0, missing.join(', '));
  ok('ui: ids are unique', [...html.matchAll(/\sid="([^"]+)"/g)].length === htmlIds.size);
  const tabs = [...html.matchAll(/<button class="tab"[^>]*>/g)].length;
  ok('ui: dock has Play, Disease, Policies, View, Auto', tabs === 5 && /id="dockPlay"/.test(html) && /id="dockAuto"/.test(html)
    && ['disease', 'policies', 'view'].every(g => html.includes(`class="tab" data-grp="${g}"`)));
  ok('ui: every dock group has a panel section', [...html.matchAll(/class="tab" data-grp="(\w+)"/g)].every(m => html.includes(`class="grp" data-grp="${m[1]}"`)));
  ok('ui: main.js is the module entry', /<script type="module" src="main.js"><\/script>/.test(html));
  ok('ui: css has touch, phone, landscape, auto and saver blocks', /@media \(pointer:coarse\)/.test(css) && /max-width:760px/.test(css)
    && /orientation:landscape/.test(css) && /html\.auto #panel/.test(css) && /html\.sn-saver/.test(css));
  ok('ui: no overflow-x on body', !/body\{[^}]*overflow-x/.test(css));
  ok('ui: about says toy model, not a forecast', /toy model/.test(html) && /not a forecast/.test(html) && /approximate and illustrative/.test(html));
  ok('ui: no weapon or score framing', !/bioweapon|weapon|kill|score|humanity/i.test(html + src));
}
