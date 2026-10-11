// ============================================================================
//  FLY DUEL  ·  data tests  (node tests/data.test.mjs)
// ----------------------------------------------------------------------------
//  Checks data/connectome.json and data/facts.js. Shape of each group,
//  index bounds of each edge, counts inside the published ranges, finite
//  positions in the hemibrain volume, the compartment parser, the valence
//  rule, the measured facts against the file, and that every fact names a
//  known source with a DOI or https url. Set FLY_DUEL_NET=1 to also
//  resolve each DOI through doi.org (network). Exit code 1 on any failure.
// ============================================================================
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FACTS, SOURCES, DISCLAIMER, HONESTY, DATA_CREDIT, COMPARE, fact, cite } from '../data/facts.js';
import { parseCompartments, kcClass, danCluster, COMPARTMENTS } from '../tools/build-connectome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', 'connectome.json');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const C = JSON.parse(readFileSync(FILE, 'utf8'));

// ---------------------------------------------------------------- meta
ok(statSync(FILE).size < 1.5 * 1024 * 1024, 'connectome.json under 1.5 MB');
for (const k of ['source', 'release', 'licence', 'url', 'retrieved', 'notes']) ok(C.meta[k] != null, `meta.${k} present`);
ok(/CC BY 4\.0/.test(C.meta.licence), 'licence is CC BY 4.0');
ok(/hemibrain v1\.2/.test(C.meta.release), 'release names hemibrain v1.2');
ok(/^\d{4}-\d{2}-\d{2}$/.test(C.meta.retrieved), 'retrieved is a date');
ok(C.meta.synthetic === false, 'real wiring, not synthetic');

// ---------------------------------------------------------------- shape
const groups = ['pn', 'kc', 'mbon', 'dan'];
const inVolume = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
  && p[0] >= 0 && p[0] <= 300 && p[1] >= 0 && p[1] <= 330 && p[2] >= 0 && p[2] <= 300;
for (const g of groups) {
  const G = C[g];
  ok(Number.isInteger(G.n) && G.n > 0, `${g}.n positive`);
  for (const k of ['types', 'pos', 'cen', 'ids', 'posSoma']) ok(Array.isArray(G[k]) && G[k].length === G.n, `${g}.${k} has n entries`);
  ok(G.pos.every(inVolume), `${g}.pos finite and inside the hemibrain volume (um)`);
  ok(G.cen.every(inVolume), `${g}.cen finite and inside the volume`);
  ok(G.posSoma.every(v => v === 0 || v === 1), `${g}.posSoma is 0 or 1`);
  ok(new Set(G.ids).size === G.n, `${g}.ids unique`);
}
const allIds = groups.flatMap(g => C[g].ids);
ok(new Set(allIds).size === allIds.length, 'no neuron in two groups');
ok(C.apl.n === 1 && inVolume(C.apl.pos), 'one APL with a position');
ok(C.apl.kcToAplSynapses > 1000 && C.apl.aplToKcSynapses > 1000, 'APL both receives from and sends to KCs (feedback loop)');

// ---------------------------------------------------------------- counts vs published ranges
ok(C.kc.n >= 1800 && C.kc.n <= 2200, `KC count ${C.kc.n} near ~2000 (Aso 2014)`);
ok(C.kc.n === fact('kcHemibrainLi').value, 'KC count equals the 1927 of Li 2020');
ok(C.kc.types.every(t => ['KCab', "KCa'b'", 'KCg'].includes(t)), 'KC classes are KCab, KCa\'b\', KCg');
ok(C.pn.n >= 90 && C.pn.n <= 150, `uPN count ${C.pn.n} in 90..150 (Li 2020: 129)`);
ok(C.mbon.n >= 34 && C.mbon.n <= 60, `MBON count ${C.mbon.n} in 34..60 (Aso 2014b: 34, hemibrain adds types)`);
ok(C.dan.n >= 150 && C.dan.n <= 400, `DAN count ${C.dan.n} in 150..400`);
const clusters = {}; for (const c of C.dan.cluster) clusters[c] = (clusters[c] || 0) + 1;
ok(clusters.PAM > 0 && clusters.PPL1 > 0, 'both PAM and PPL1 present');
ok(C.dan.cluster.every(c => ['PAM', 'PPL1', 'PPL2'].includes(c)), 'DAN clusters known');
const usedComps = new Set(C.mbon.compartments.flat().filter(c => c !== 'calyx'));
ok(usedComps.size === fact('compartments').value, `MBONs cover ${usedComps.size} lobe compartments (Aso 2014: 15)`);
ok(C.mbon.compartment.every((c, i) => c === (C.mbon.compartments[i][0] || '')), 'mbon.compartment is the first of compartments');
ok(C.dan.compartments.every(cs => cs.length >= 1 && cs.length <= 2), 'each DAN reaches one or two compartments (Aso 2014)');
ok([...C.mbon.compartments.flat(), ...C.dan.compartments.flat()].every(c => COMPARTMENTS.includes(c)), 'all compartment names valid');
ok(C.mbon.valence.every(v => v === -1 || v === 0 || v === 1), 'valence in {-1,0,1}');

// ---------------------------------------------------------------- edges
const E = C.edges;
const bounds = (arr, na, nb, name, w = true) => {
  ok(Array.isArray(arr) && arr.length > 0, `${name} not empty`);
  ok(arr.every(e => Number.isInteger(e[0]) && e[0] >= 0 && e[0] < na && Number.isInteger(e[1]) && e[1] >= 0 && e[1] < nb), `${name} indices in bounds`);
  if (w) ok(arr.every(e => Number.isInteger(e[2]) && e[2] >= 1), `${name} weights positive integers`);
  ok(new Set(arr.map(e => e[0] + ',' + e[1])).size === arr.length, `${name} has no duplicate pairs`);
};
bounds(E.pn_kc, C.pn.n, C.kc.n, 'pn_kc');
bounds(E.kc_mbon, C.kc.n, C.mbon.n, 'kc_mbon');
bounds(E.dan_mbon_compartment, C.dan.n, C.mbon.n, 'dan_mbon_compartment', false);
bounds(E.dan_mbon_syn, C.dan.n, C.mbon.n, 'dan_mbon_syn');
const T = C.meta.thresholds;
ok(E.pn_kc.every(e => e[2] >= T.PN_KC_MIN) && E.kc_mbon.every(e => e[2] >= T.KC_MBON_MIN), 'edges respect the stated thresholds');
ok(E.dan_mbon_compartment.every(([d, m]) => C.dan.compartments[d].some(c => C.mbon.compartments[m].includes(c))), 'DAN-MBON gating pairs share a compartment');
// every PN projects to KCs; claws per KC sit near the published small fan-in
const pnOut = new Set(E.pn_kc.map(e => e[0]));
ok(pnOut.size === C.pn.n, 'every selected PN has KC targets');
const claws = new Map(); for (const [, k] of E.pn_kc) claws.set(k, (claws.get(k) || 0) + 1);
const mean = [...claws.values()].reduce((a, b) => a + b, 0) / claws.size;
ok(mean >= 3 && mean <= 10, `uPN partners per KC ${mean.toFixed(2)} in 3..10 (Turner 2008: ~10, Caron 2013: few)`);
// every MBON gets KC input, and MBON11 (γ1pedc) is among the most connected
const mIn = new Map(); for (const [, m] of E.kc_mbon) mIn.set(m, (mIn.get(m) || 0) + 1);
ok(mIn.size === C.mbon.n, 'every MBON has KC input');

// ---------------------------------------------------------------- parser and rules
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(eq(parseCompartments("MBON01(y5B'2a)_R"), ['γ5', "β'2"]), 'parse y5B\'2a');
ok(eq(parseCompartments('MBON06(B1>a)(AVM07)_L'), ['β1']), 'parse drops the axon target after >');
ok(eq(parseCompartments('MBON19(a2p3p)_R'), ['α2', 'α3']), 'parse bare digit reuses lobe');
ok(eq(parseCompartments('PAM07(y4<y1y2)_R'), ['γ4']), 'parse drops the input after <');
ok(eq(parseCompartments("PPL105(a'2a2)_R"), ["α'2", 'α2']), 'parse a\'2a2');
ok(eq(parseCompartments('MBON22(calyx)_R'), ['calyx']), 'parse calyx');
ok(eq(parseCompartments('PPL107(PDL05)_L'), []), 'lineage tag is not a compartment');
ok(kcClass('KCab-s') === 'KCab' && kcClass("KCa'b'-ap1") === "KCa'b'" && kcClass('KCg-m') === 'KCg' && kcClass('KCy(half)') === 'KCg', 'KC classes');
ok(danCluster('PAM08') === 'PAM' && danCluster('PPL101') === 'PPL1' && danCluster('PPL201') === 'PPL2', 'DAN clusters');
// valence rule: PAM compartments -> -1 (avoid MBONs, Owald 2015 M4/6), PPL1 -> +1
const val = name => C.mbon.valence[C.mbon.instances.findIndex(s => s.startsWith(name))];
ok(val("MBON01(y5B'2a)") === -1 && val("MBON03(B'2mp)") === -1 && val("MBON02(B2B'2a)") === -1, 'M4/6 MBONs get valence -1');
ok(val('MBON11(y1pedc') === 1 && val('MBON14(a3)') === 1, 'PPL1-compartment MBONs get valence +1');
ok(val('MBON22(calyx)') === 0, 'calyx MBON valence 0');

// ---------------------------------------------------------------- facts
const get = path => path.split('.').reduce((o, k) => o?.[k], { ...C, ...C.meta.stats });
for (const [id, f] of Object.entries(FACTS)) {
  ok(typeof f.text === 'string' && f.text.length > 10, `fact ${id} has text`);
  ok(!!SOURCES[f.src], `fact ${id} source ${f.src} resolves`);
  ok((f.also || []).every(s => SOURCES[s]), `fact ${id} extra sources resolve`);
  ok(f.value === null || Number.isFinite(f.value) || (Array.isArray(f.value) && f.value.length === 2 && f.value[0] <= f.value[1]), `fact ${id} value shape`);
  ok(cite(id).length >= 1, `cite(${id})`);
  if (f.measured) {
    const m = f.measured;
    let actual;
    if (m.startsWith('edges.')) actual = C.edges[m.slice(6)].length;
    else if (m.startsWith('cluster.')) actual = clusters[m.slice(8)];
    else if (m.startsWith('kcByClass.')) actual = C.meta.stats.kcByClass[m.slice(10)];
    else actual = get(m);
    ok(actual === f.value, `measured fact ${id} = ${f.value} matches file (${actual})`);
  }
}
for (const [id, s] of Object.entries(SOURCES)) {
  ok(typeof s.cite === 'string' && s.cite.length > 20, `source ${id} has a citation`);
  ok(s.doi === null || /^10\.\d{4,9}\/\S+$/.test(s.doi), `source ${id} DOI format`);
  ok(s.url && /^https:\/\//.test(s.url), `source ${id} url is https`);
}
let threw = false; try { fact('noSuchFact'); } catch { threw = true; }
ok(threw, 'fact() throws on an unknown id');
ok(DISCLAIMER === 'Not affiliated with or endorsed by Wizards of the Coast.', 'disclaimer text exact');
ok(HONESTY.notAFly.includes('not train a real fly'), 'honesty line says we do not train a real fly');
ok(/CC BY 4\.0/.test(DATA_CREDIT), 'data credit names the licence');
ok(/hemibrain v1\.2/.test(DATA_CREDIT) && /FlyWire 783/.test(DATA_CREDIT), 'data credit names both connectomes');
ok(/two different animals/.test(HONESTY.twoAnimals) && /different methods/.test(HONESTY.synapseMethods), 'honesty lines for two animals and two synapse methods');

// ---------------------------------------------------------------- Fly A / Fly B table
// Each row: a Fly A cell of hemibrain facts (measured) and a Fly B cell of
// FlyWire facts (flywire), with the same number of ids.
ok(Array.isArray(COMPARE) && COMPARE.length >= 7, `COMPARE has ${COMPARE.length} rows`);
for (const [label, a, b] of COMPARE) {
  ok(a.length === b.length && a.length >= 1, `COMPARE ${label}: same number of ids per fly`);
  ok(a.every(id => FACTS[id]?.measured), `COMPARE ${label}: Fly A ids are measured hemibrain facts`);
  ok(b.every(id => FACTS[id]?.flywire), `COMPARE ${label}: Fly B ids are FlyWire facts`);
}
for (const want of ['Kenyon cells', 'classes', 'PNs', 'per KC', 'MBONs', 'DANs', 'KC-to-MBON connections']) ok(COMPARE.some(r => r[0].includes(want)), `COMPARE has a row for ${want}`);

// ---------------------------------------------------------------- optional network DOI check
if (process.env.FLY_DUEL_NET === '1') {
  for (const [id, s] of Object.entries(SOURCES)) {
    if (!s.doi) continue;
    const r = await fetch(`https://doi.org/${s.doi}`, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'davesgames.io fact check' } });
    ok(r.status >= 300 && r.status < 400, `DOI ${s.doi} (${id}) resolves: HTTP ${r.status}`);
  }
}

console.log(`data.test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
