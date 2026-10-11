// ============================================================================
//  FLY DUEL  ·  FlyWire connectome tests  (node tests/flywire.test.mjs)
// ----------------------------------------------------------------------------
//  Checks data/connectome-flywire.json (Fly B, FlyWire 783, right MB). The
//  file must have the schema of data/connectome.json, so the brain model
//  can load either fly. Checks: meta and licence, shape of each group,
//  index bounds, FAFB positions, counts, compartment rules, the
//  comparison stats against both shipped files, the `flywire` facts in
//  data/facts.js, the tool helpers, and one MushroomBody built on the
//  file. Exit code 1 on any failure.
// ============================================================================
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FACTS, SOURCES } from '../data/facts.js';
import { COMPARTMENTS } from '../tools/build-connectome.mjs';
import { compareStats, compartmentTable, compartmentsOf, readTable } from '../tools/build-connectome-flywire.mjs';
import { MushroomBody } from '../brain/mb.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', 'connectome-flywire.json');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const C = JSON.parse(readFileSync(FILE, 'utf8'));
const H = JSON.parse(readFileSync(join(ROOT, 'data', 'connectome.json'), 'utf8'));

// ---------------------------------------------------------------- meta
ok(statSync(FILE).size < 1.5 * 1024 * 1024, 'connectome-flywire.json under 1.5 MB');
for (const k of ['source', 'release', 'licence', 'url', 'retrieved', 'notes', 'thresholds', 'stats', 'hemisphere', 'units']) ok(C.meta[k] != null, `meta.${k} present`);
ok(/CC BY 4\.0/.test(C.meta.licence), 'licence is CC BY 4.0');
ok(/FlyWire 783/.test(C.meta.release) && /zenodo\.10676866/.test(C.meta.release), 'release names FlyWire 783 and the Zenodo record');
ok(/^right/.test(C.meta.hemisphere), 'right hemisphere, same side as the hemibrain MB');
ok(C.meta.synthetic === false, 'real wiring, not synthetic');
ok(eq(C.meta.thresholds, H.meta.thresholds), 'same thresholds as the hemibrain file');
ok(!/@/.test(JSON.stringify(C.meta)), 'no email address in meta');

// ---------------------------------------------------------------- shape (same schema as connectome.json)
const groups = ['pn', 'kc', 'mbon', 'dan'];
for (const g of groups) for (const k of Object.keys(H[g])) ok(k in C[g], `${g}.${k} exists, as in the hemibrain file`);
for (const k of Object.keys(H.apl)) ok(k in C.apl, `apl.${k} exists`);
for (const k of Object.keys(H.edges)) ok(Array.isArray(C.edges[k]), `edges.${k} exists`);
// FAFB14.1 in micrometres: about 1000 x 500 x 280 um.
const inFafb = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
  && p[0] >= 0 && p[0] <= 1100 && p[1] >= 0 && p[1] <= 550 && p[2] >= 0 && p[2] <= 300;
for (const g of groups) {
  const G = C[g];
  ok(Number.isInteger(G.n) && G.n > 0, `${g}.n positive`);
  for (const k of ['types', 'pos', 'cen', 'ids', 'posSoma']) ok(Array.isArray(G[k]) && G[k].length === G.n, `${g}.${k} has n entries`);
  ok(G.pos.every(inFafb) && G.cen.every(inFafb), `${g} positions finite and inside FAFB (um)`);
  ok(G.posSoma.every(v => v === 0 || v === 1), `${g}.posSoma is 0 or 1`);
  ok(G.ids.every(id => typeof id === 'string' && /^7205759\d{11}$/.test(id)), `${g}.ids are 18-digit root id strings`);
  ok(new Set(G.ids).size === G.n, `${g}.ids unique`);
}
const allIds = groups.flatMap(g => C[g].ids);
ok(new Set(allIds).size === allIds.length, 'no neuron in two groups');
ok(C.apl.n === 1 && inFafb(C.apl.pos), 'one APL with a position');
ok(C.apl.kcToAplSynapses > 1000 && C.apl.aplToKcSynapses > 1000, 'APL both receives from and sends to KCs');
// The KC cloud is compact (one MB, not both).
const kx = C.kc.cen.map(p => p[0]);
ok(Math.max(...kx) - Math.min(...kx) < 250, 'KC anchors span one MB only (x range < 250 um)');

// ---------------------------------------------------------------- counts
ok(C.kc.n >= 2400 && C.kc.n <= 2800, `KC count ${C.kc.n} in 2400..2800 (FlyWire right side)`);
ok(C.kc.types.every(t => ['KCab', "KCa'b'", 'KCg'].includes(t)), 'KC classes are KCab, KCa\'b\', KCg');
ok(C.pn.n >= 90 && C.pn.n <= 150, `uPN count ${C.pn.n} in 90..150`);
ok(C.mbon.n >= 30 && C.mbon.n <= 60, `MBON count ${C.mbon.n} in 30..60`);
ok(C.dan.n >= 100 && C.dan.n <= 400, `DAN count ${C.dan.n} in 100..400`);
ok(C.dan.cluster.every(c => ['PAM', 'PPL1', 'PPL2'].includes(c)), 'DAN clusters known');
const usedComps = new Set(C.mbon.compartments.flat().filter(c => c !== 'calyx'));
ok(usedComps.size === 15, `MBONs cover ${usedComps.size} of 15 lobe compartments`);
ok(C.mbon.compartments.every(cs => cs.length >= 1), 'every MBON has a compartment');
ok(C.dan.compartments.every(cs => cs.length >= 1 && cs.length <= 2), 'each DAN reaches one or two compartments');
ok([...C.mbon.compartments.flat(), ...C.dan.compartments.flat()].every(c => COMPARTMENTS.includes(c)), 'all compartment names valid');
ok(C.mbon.compartment.every((c, i) => c === (C.mbon.compartments[i][0] || '')), 'mbon.compartment is the first of compartments');
ok(C.mbon.valence.every(v => v === -1 || v === 0 || v === 1), 'valence in {-1,0,1}');
const val = t => C.mbon.valence[C.mbon.types.indexOf(t)];
ok(val('MBON01') === -1 && val('MBON02') === -1, 'PAM-compartment MBONs get valence -1 (same rule as Fly A)');
ok(val('MBON11') === 1 && val('MBON14') === 1, 'PPL1-compartment MBONs get valence +1');
ok(val('MBON22') === 0, 'calyx MBON valence 0');

// ---------------------------------------------------------------- edges
const E = C.edges, T = C.meta.thresholds;
const bounds = (arr, na, nb, name, w = true) => {
  ok(arr.length > 0, `${name} not empty`);
  ok(arr.every(e => Number.isInteger(e[0]) && e[0] >= 0 && e[0] < na && Number.isInteger(e[1]) && e[1] >= 0 && e[1] < nb), `${name} indices in bounds`);
  if (w) ok(arr.every(e => Number.isInteger(e[2]) && e[2] >= 1), `${name} weights positive integers`);
  ok(new Set(arr.map(e => e[0] + ',' + e[1])).size === arr.length, `${name} has no duplicate pairs`);
};
bounds(E.pn_kc, C.pn.n, C.kc.n, 'pn_kc');
bounds(E.kc_mbon, C.kc.n, C.mbon.n, 'kc_mbon');
bounds(E.dan_mbon_compartment, C.dan.n, C.mbon.n, 'dan_mbon_compartment', false);
bounds(E.dan_mbon_syn, C.dan.n, C.mbon.n, 'dan_mbon_syn');
ok(E.pn_kc.every(e => e[2] >= T.PN_KC_MIN) && E.kc_mbon.every(e => e[2] >= T.KC_MBON_MIN) && E.dan_mbon_syn.every(e => e[2] >= T.DAN_MBON_MIN), 'edges respect the thresholds');
ok(E.dan_mbon_compartment.every(([d, m]) => C.dan.compartments[d].some(c => C.mbon.compartments[m].includes(c))), 'DAN-MBON gating pairs share a compartment');
ok(new Set(E.pn_kc.map(e => e[0])).size === C.pn.n, 'every selected PN has KC targets');
const mIn = new Map(); for (const [, m, w] of E.kc_mbon) mIn.set(m, (mIn.get(m) || 0) + w);
ok(C.mbon.ids.every((_, i) => (mIn.get(i) || 0) >= T.MBON_KC_MIN), 'every MBON gets >= MBON_KC_MIN KC synapses');

// ---------------------------------------------------------------- comparison stats
const fw = compareStats(C), hb = compareStats(H);
for (const k of Object.keys(fw)) ok(eq(C.meta.stats[k], fw[k]), `meta.stats.${k} matches the file`);
ok(eq(C.meta.stats.compareHemibrain?.hemibrain, hb), 'meta.stats.compareHemibrain matches data/connectome.json now');
ok(hb.kcMbonSynapses === H.meta.stats.kcMbonSynapses && hb.clawsPerKcMean === H.meta.stats.clawsPerKcMean, 'compareStats agrees with the hemibrain builder');
ok(fw.clawsPerKcMean >= 3 && fw.clawsPerKcMean <= 10, `uPN partners per KC ${fw.clawsPerKcMean} in 3..10`);
ok(fw.kc !== hb.kc, 'the two flies have different KC counts (two animals)');

// ---------------------------------------------------------------- facts tied to this file
const get = path => {
  if (path.startsWith('edges.')) return C.edges[path.slice(6)].length;
  if (path.startsWith('kcByClass.')) return C.meta.stats.kcByClass[path.slice(10)];
  const walk = o => path.split('.').reduce((a, k) => a?.[k], o);
  return walk(C) ?? walk(C.meta.stats);
};
const fwFacts = Object.entries(FACTS).filter(([, f]) => f.flywire);
ok(fwFacts.length >= 10, `at least 10 FlyWire facts (${fwFacts.length})`);
for (const [id, f] of fwFacts) {
  ok(get(f.flywire) === f.value, `fact ${id} = ${f.value} matches the FlyWire file (${get(f.flywire)})`);
  ok(!!SOURCES[f.src] && (f.also || []).every(s => SOURCES[s]), `fact ${id} sources resolve`);
}
ok(FACTS.fwKcMbonSynapses.text.includes(H.meta.stats.kcMbonSynapses.toLocaleString('en-US')), 'fwKcMbonSynapses text quotes the hemibrain total');
for (const id of ['flywireData', 'flywireAnnotations', 'buhmann2021']) ok(SOURCES[id] && /^10\./.test(SOURCES[id].doi), `source ${id} has a DOI`);

// ---------------------------------------------------------------- tool helpers
const hbRows = readTable('bodyId,instance,type,morphology_type\n1,"MBON01(y5B\'2a)_R",MBON01,MBON01\n2,PAM08_a(y4)_R,PAM08_a,PAM08\n3,MBON25(y1y2)_R,MBON25,MBON25\n4,MBON34(y2)_L,MBON34,MBON34\n', ',');
const tab = compartmentTable(hbRows);
ok(eq(compartmentsOf('MBON01', tab), ['γ5', "β'2"]), 'compartments from a hemibrain instance');
ok(eq(compartmentsOf('PAM08', tab), ['γ4']), 'morphology type maps to the subtype compartments');
ok(eq(compartmentsOf('MBON25,MBON34', tab), ['γ1', 'γ2']), 'a joint FlyWire type gets the union');
ok(eq(compartmentsOf('PPL201', tab), ['calyx']), 'PPL2 goes to the calyx');
ok(eq(readTable('a\tb\n1\t2\n', '\t'), [{ a: '1', b: '2' }]), 'TSV reader');

// ---------------------------------------------------------------- the brain model loads Fly B
const mb = new MushroomBody(C, { seed: 7, hemisphere: 'B' });
ok(mb.nKC === C.kc.n && mb.nMBON === C.mbon.n, 'MushroomBody builds on the FlyWire file');
let s = 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const x = new Float32Array(48).map(rnd);
const v = mb.value(x);
ok(Number.isFinite(v), `value() finite on Fly B (${v})`);
const act = mb.kcActivity(mb.encode(x));
const frac = act.length / mb.nLive;
ok(frac > 0.02 && frac < 0.12, `KC sparsity ${(frac * 100).toFixed(1)}% in 2..12%`);

console.log(`flywire.test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
