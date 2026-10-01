// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/core.test.mjs — node library characterization
// ────────────────────────────────────────────────────────────────────────────
//  Pins the behaviour of every NodeDef that nodes/core.js exports. For each
//  def, the test runs expr, pass.wgsl and expand against a mock context, for
//  each enum option, an unknown enum value, each flipped bool, an empty text
//  param, and both "all inputs linked" and "no inputs linked". A sha256 of
//  the static fields plus those outputs is compared with core.golden.json.
//
//  RUN (from the material-studio directory)
//      node nodes/core/core.test.mjs           compare with the golden file
//      node nodes/core/core.test.mjs --write   write a new golden file
//
//  GREP TARGETS
//      mockCtx ...... the ExprCtx / PassCtx stand-in
//      variants ..... the value maps that each def runs with
//      fingerprint .. the per-def hash input
// ============================================================================
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { NODES, catalogSummary, init } from '../core.js';

const GOLDEN = new URL('./core.golden.json', import.meta.url);
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const named = pre => new Proxy({}, { get: (_, k) => (typeof k === 'string' ? `${pre}_${k}` : undefined) });

/** A context that names every read, so the output shows what the def asked for. */
function mockCtx(values, linked) {
  const lets = [], fns = [];
  return {
    ctx: {
      inputs: named('IN'), params: named('P'), values, uv: 'UV', seed: 'SEED', res: 'RES', uid: 'n7', samp: 'SAMP',
      tex: named('TEX'), img: named('IMG'),
      linked: new Proxy({}, { get: () => linked }),
      sample: new Proxy({}, { get: (_, k) => uv => `S_${String(k)}(${uv})` }),
      let: s => lets.push(s), fn: s => fns.push(s),
    },
    lets, fns,
  };
}

function variants(def) {
  const base = Object.fromEntries(def.params.map(p => [p.id, p.default]));
  const out = [base];
  for (const p of def.params) {
    if (p.kind === 'enum') for (const o of [...p.options, 'zzz']) out.push({ ...base, [p.id]: o });
    if (p.kind === 'bool') out.push({ ...base, [p.id]: !p.default });
    if (p.kind === 'text') out.push({ ...base, [p.id]: '' });
  }
  return out;
}

function fingerprint(def) {
  const stat = JSON.stringify(def, (k, v) => (typeof v === 'function' ? `[fn ${k}]` : v));
  const runs = [];
  for (const values of variants(def)) {
    for (const linked of [true, false]) {
      const m = mockCtx(values, linked);
      const r = {};
      if (def.expr) r.expr = def.expr(m.ctx);
      if (def.pass) r.wgsl = def.pass.wgsl(m.ctx);
      if (def.expand) r.expand = def.expand(values);
      runs.push({ r, lets: m.lets, fns: m.fns });
    }
  }
  return sha(stat + '\n' + JSON.stringify(runs));
}

let registered;
await init({ register: (name, api) => { registered = { name, keys: Object.keys(api), self: api.selfTest() }; } });
const now = {
  count: NODES.length,
  order: sha(NODES.map(d => d.type).join('\n')),
  summary: catalogSummary(),
  registered,
  nodes: Object.fromEntries(NODES.map(d => [d.type, fingerprint(d)])),
};

if (process.argv.includes('--write')) {
  writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
  console.log(`wrote ${GOLDEN.pathname}: ${now.count} defs`);
  process.exit(0);
}

const gold = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const fails = [];
for (const k of ['count', 'order', 'summary', 'registered']) {
  if (JSON.stringify(now[k]) !== JSON.stringify(gold[k])) fails.push(`${k}: ${JSON.stringify(gold[k])} -> ${JSON.stringify(now[k])}`);
}
for (const t of new Set([...Object.keys(gold.nodes), ...Object.keys(now.nodes)])) {
  if (gold.nodes[t] !== now.nodes[t]) fails.push(`node ${t}: ${gold.nodes[t]} -> ${now.nodes[t]}`);
}
console.log(`core.test: ${now.count} defs, ${Object.keys(now.nodes).length} fingerprints, ${fails.length} mismatches`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(fails.length ? 'TESTS RED' : 'TESTS GREEN');
process.exit(fails.length ? 1 : 0);
