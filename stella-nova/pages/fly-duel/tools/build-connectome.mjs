#!/usr/bin/env node
// ============================================================================
//  FLY DUEL  ·  build data/connectome.json from the hemibrain  (node, no deps)
// ----------------------------------------------------------------------------
//  This tool downloads the public hemibrain v1.2 exports from the Janelia
//  Google Cloud bucket. It extracts the mushroom body (MB) circuit of the
//  right hemisphere and writes data/connectome.json. The page and the
//  brain model read that file. Licence: hemibrain is CC BY 4.0 (see
//  CREDITS.md).
//
//  RUN   node tools/build-connectome.mjs [--scratch DIR] [--out FILE]
//        [--keep]        keep the scratch downloads (default: delete them)
//        [--no-skel]     no skeleton download, positions become null
//  Needs: node 18+ (fetch), the system `tar` (bsdtar or GNU tar).
//  Network: about 46 MB (adjacencies) plus a 1.9 GB skeleton stream.
//  The tool streams the skeleton archive through `tar`. It keeps only the
//  about 2700 SWC files of MB cell types on disk (about 30 MB).
//
//  SELECTION RULES (all from the data; thresholds are in META below)
//   - KC: every traced neuron with a type that starts with "KC". The class
//     (KCab, KCa'b', KCg) comes from the type prefix.
//   - PN: uniglomerular antennal lobe projection neurons. The type is
//     "<glomerulus>_<lineage>PN" with no "M_", "MZ_" or "Z_" prefix and no
//     "+". The PN must make >= PN_KC_MIN synapses on KCs (GABAergic vPNs
//     make none, so they drop out).
//   - MBON: type "MBON*" with >= MBON_KC_MIN synapses from KCs, counted
//     only over KC connections of >= KC_MBON_MIN synapses. Some "_L"
//     instances have dendrites in this MB, so we select by input, not by
//     the side suffix.
//   - DAN: type "PAM*" or "PPL*" with >= DAN_KC_MIN synapses onto KCs.
//     PPL107 and PPL108 make no KC synapses, so they drop out.
//   - APL: the one APL neuron.
//   - Compartments: parsed from the instance name in Aso 2014 notation, for
//     example "MBON01(y5B'2a)" -> [γ5, β'2]. The part after ">" (MBON axon
//     target) or "<" (DAN input) is not used. PPL2 cells go to "calyx".
//   - MBON valence (MODEL RULE, not a measured value): +1 when the MBON's
//     compartments get dopamine mostly from PPL1 (punishment DANs), -1
//     when mostly from PAM (reward DANs), 0 on a tie or for the calyx. The
//     rule follows the Aso 2014b compartment pattern, which has exceptions.
//   - Positions: soma = the SWC node with the largest radius, when that
//     radius is >= 1.2 um. Else pos uses the centroid and posSoma is 0.
//     Centroid = cable-length weighted mean of the skeleton. Both in
//     micrometres (voxel 8 nm), rounded to 0.1 um.
//
//  GREP MAP   (grep -n "<anchor>" tools/build-connectome.mjs)
//      META constants ....... "const META"
//      download helpers ..... "async function download"
//      csv reader ........... "function splitCsv"
//      compartment parser ... "export function parseCompartments"
//      selection ............ "function select"
//      skeleton reader ...... "function readSwc"
//      writer ............... "function writeJson"
// ============================================================================
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync,
  writeFileSync, createReadStream, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UA = 'davesgames.io connectome build';   // neutral User-Agent, no email

const META = {
  source: 'Janelia FlyEM hemibrain, compact connection matrix summary (traced adjacencies) and skeletons',
  release: 'hemibrain v1.2 (neuPrint dataset hemibrain:v1.2, bulk export 2020-12-22)',
  licence: 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), as stated on https://www.janelia.org/project-team/flyem/hemibrain',
  url: 'https://storage.googleapis.com/hemibrain/v1.2/exported-traced-adjacencies-v1.2.tar.gz',
  skeletonUrl: 'https://storage.googleapis.com/hemibrain/v1.2/hemibrain-v1.2-skeletons.tar.gz',
  citation: 'Scheffer LK et al. (2020) eLife 9:e57443, doi:10.7554/eLife.57443',
  thresholds: { PN_KC_MIN: 3, KC_MBON_MIN: 3, MBON_KC_MIN: 100, DAN_KC_MIN: 50, DAN_MBON_MIN: 5 },
};
const T = META.thresholds;

// ------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SCRATCH = arg('--scratch', '/private/tmp/claude-501/fly-duel-connectome');
const OUT = arg('--out', join(HERE, '..', 'data', 'connectome.json'));
const KEEP = argv.includes('--keep');
const NO_SKEL = argv.includes('--no-skel');

// ------------------------------------------------------------- downloads
async function download(url, file) {
  if (existsSync(file) && statSync(file).size > 0) return;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file + '.part'));
  spawnSync('mv', [file + '.part', file]);
}

// Stream the skeleton tar.gz into `tar` and keep only the listed members.
async function streamSkeletons(url, listFile, dir) {
  mkdirSync(dir, { recursive: true });
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const tar = spawn('tar', ['-xzf', '-', '-C', dir, '-T', listFile], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => tar.on('close', c => c === 0 ? res() : rej(new Error('tar exit ' + c))));
  await pipeline(Readable.fromWeb(r.body), tar.stdin);
  await done;
}

// ------------------------------------------------------------- csv
// Minimal CSV split: handles double-quoted fields with commas.
function splitCsv(line) {
  if (!line.includes('"')) return line.split(',');
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}

async function eachRow(file, fn) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let head = null;
  for await (const line of rl) {
    if (!line) continue;
    const f = splitCsv(line);
    if (!head) { head = f; continue; }
    fn(f);
  }
}

// ------------------------------------------------------------- compartments
// Aso 2014 compartments. Input notation in hemibrain names: y = γ, a = α,
// B = β, a' / B' = α' / β'. A bare digit reuses the last lobe letter
// ("a2p3p" -> α2, α3). Lowercase letters after the digit (sub-parts such as
// "pedc", "sc", "mp", "ap") are dropped.
const LOBE = { y: 'γ', a: 'α', B: 'β', "a'": "α'", "B'": "β'" };
export const COMPARTMENTS = ['γ1', 'γ2', 'γ3', 'γ4', 'γ5', "β'1", "β'2", "α'1", "α'2", "α'3", 'β1', 'β2', 'α1', 'α2', 'α3', 'calyx'];
export function parseCompartments(instance) {
  const m = /^[^(]*\(([^)]*)\)/.exec(instance || '');
  if (!m) return [];
  let s = m[1];
  if (/^[A-Z]{3}\d{2}$/.test(s)) return [];          // lineage tag, not a compartment
  if (/calyx/i.test(s)) return ['calyx'];
  s = s.split(/[<>]/)[0];
  const out = []; let last = null;
  for (let i = 0; i < s.length;) {
    const two = s.slice(i, i + 2);
    let lobe = null, adv = 0;
    if ((two === "a'" || two === "B'") ) { lobe = two; adv = 2; }
    else if ('yaB'.includes(s[i])) { lobe = s[i]; adv = 1; }
    if (lobe && /\d/.test(s[i + adv] || '')) {
      last = lobe; out.push(LOBE[lobe] + s[i + adv]); i += adv + 1; continue;
    }
    if (/\d/.test(s[i]) && last) { out.push(LOBE[last] + s[i]); i++; continue; }
    i++;
  }
  return [...new Set(out)].filter(c => COMPARTMENTS.includes(c));
}

export function kcClass(type) {
  if (/^KCa'b'/.test(type)) return "KCa'b'";
  if (/^KCab/.test(type)) return 'KCab';
  if (/^KC(g|y)/.test(type)) return 'KCg';
  return null;
}
export function danCluster(type) {
  if (/^PAM/.test(type)) return 'PAM';
  if (/^PPL1/.test(type)) return 'PPL1';
  if (/^PPL2/.test(type)) return 'PPL2';
  return null;
}
const UPN = /^(?!M_|MZ_|Z_)([A-Z][A-Za-z0-9]*)_(l|ad|v|lv|il|ilv|adl)PN\d*$/;

// ------------------------------------------------------------- selection
function select(neurons, conn) {
  const byType = (re) => neurons.filter(n => re.test(n.type));
  const kcs = neurons.filter(n => kcClass(n.type));
  const kcSet = new Set(kcs.map(n => n.id));
  const sumInto = (pre, postSet) => { let s = 0; for (const [p, w] of conn.out.get(pre) || []) if (postSet.has(p)) s += w; return s; };
  const sumFrom = (post, preSet, min = 1) => { let s = 0; for (const [p, w] of conn.inc.get(post) || []) if (preSet.has(p) && w >= min) s += w; return s; };

  const pns = neurons.filter(n => !n.type.includes('+') && UPN.test(n.type))
    .filter(n => [...(conn.out.get(n.id) || [])].some(([p, w]) => kcSet.has(p) && w >= T.PN_KC_MIN));
  const mbons = byType(/^MBON/).filter(n => sumFrom(n.id, kcSet, T.KC_MBON_MIN) >= T.MBON_KC_MIN);
  const dans = byType(/^(PAM|PPL)/).filter(n => sumInto(n.id, kcSet) >= T.DAN_KC_MIN);
  const apl = byType(/^APL$/);
  for (const n of pns) n.glom = UPN.exec(n.type)[1];
  for (const n of kcs) n.cls = kcClass(n.type);
  for (const n of dans) { n.cluster = danCluster(n.type); n.comps = n.cluster === 'PPL2' ? ['calyx'] : parseCompartments(n.instance); }
  for (const n of mbons) n.comps = parseCompartments(n.instance);

  // Which DAN clusters reach each compartment (from the selected DANs).
  const reach = {};
  for (const d of dans) for (const c of d.comps) { reach[c] ??= { PAM: 0, PPL1: 0, PPL2: 0 }; reach[c][d.cluster]++; }
  for (const m of mbons) {
    let s = 0;
    for (const c of m.comps) { const r = reach[c]; if (!r || c === 'calyx') continue; s += Math.sign(r.PPL1 - r.PAM); }
    m.valence = Math.sign(s);
  }

  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  pns.sort((a, b) => cmp(a.glom, b.glom) || cmp(a.type, b.type) || a.id - b.id);
  const KO = { KCg: 0, "KCa'b'": 1, KCab: 2 };
  kcs.sort((a, b) => KO[a.cls] - KO[b.cls] || cmp(a.type, b.type) || a.id - b.id);
  mbons.sort((a, b) => cmp(a.type, b.type) || cmp(a.instance, b.instance) || a.id - b.id);
  const CO = { PAM: 0, PPL1: 1, PPL2: 2 };
  dans.sort((a, b) => CO[a.cluster] - CO[b.cluster] || cmp(a.type, b.type) || cmp(a.instance, b.instance) || a.id - b.id);
  return { pns, kcs, mbons, dans, apl, reach };
}

// ------------------------------------------------------------- skeletons
// SWC rows: id type x y z radius parent. Coordinates are 8 nm voxels.
function readSwc(file) {
  const nodes = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.trim().split(/\s+/).map(Number);
    if (f.length < 7) continue;
    nodes.set(f[0], f);
  }
  let soma = null, sx = 0, sy = 0, sz = 0, L = 0;
  for (const f of nodes.values()) {
    if (!soma || f[5] > soma[5]) soma = f;
    const p = nodes.get(f[6]);
    if (p) {
      const l = Math.hypot(f[2] - p[2], f[3] - p[3], f[4] - p[4]);
      sx += l * (f[2] + p[2]) / 2; sy += l * (f[3] + p[3]) / 2; sz += l * (f[4] + p[4]) / 2; L += l;
    }
  }
  if (!soma) return null;
  const um = v => Math.round(v * 0.008 * 10) / 10;
  const cen = L > 0 ? [um(sx / L), um(sy / L), um(sz / L)] : [um(soma[2]), um(soma[3]), um(soma[4])];
  // A soma node is thick. When the thickest node is thinner than
  // SOMA_MIN_RADIUS, the skeleton has no soma and pos falls back to cen.
  const found = soma[5] >= SOMA_MIN_RADIUS;
  return { soma: found ? [um(soma[2]), um(soma[3]), um(soma[4])] : cen, cen, found: found ? 1 : 0 };
}
const SOMA_MIN_RADIUS = 150;   // voxels (1.2 um)
const swcPath = (dir, id) => join(dir, 'hemibrain-v1.2-skeletons', String(id).slice(-2), `${id}.swc`);

// ------------------------------------------------------------- writer
// One top-level key per line keeps git diffs readable and the file compact.
function writeJson(file, obj) {
  const keys = Object.keys(obj);
  const body = keys.map(k => {
    if (k === 'edges') {
      const e = obj.edges;
      return `"edges":{\n` + Object.keys(e).map(ek => `${JSON.stringify(ek)}:${JSON.stringify(e[ek])}`).join(',\n') + '\n}';
    }
    return `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`;
  }).join(',\n');
  writeFileSync(file, '{\n' + body + '\n}\n');
}

// ------------------------------------------------------------- main
async function main() {
  const t0 = Date.now();
  mkdirSync(SCRATCH, { recursive: true });
  const dl = join(SCRATCH, 'dl'); mkdirSync(dl, { recursive: true });
  const adjTar = join(dl, 'adj.tar.gz');
  console.log('download', META.url);
  await download(META.url, adjTar);
  const adjDir = join(dl, 'exported-traced-adjacencies-v1.2');
  if (!existsSync(join(adjDir, 'traced-total-connections.csv'))) {
    const r = spawnSync('tar', ['-xzf', adjTar, '-C', dl], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('tar failed on adjacency archive');
  }

  const neurons = [];
  await eachRow(join(adjDir, 'traced-neurons.csv'), f => neurons.push({ id: Number(f[0]), type: f[1] || '', instance: f[2] || '' }));
  const cand = new Set(neurons.filter(n => /^(KC|MBON|PAM|PPL|APL)/.test(n.type) || /PN/.test(n.type)).map(n => n.id));
  const conn = { out: new Map(), inc: new Map() };
  await eachRow(join(adjDir, 'traced-total-connections.csv'), f => {
    const a = Number(f[0]), b = Number(f[1]);
    if (!cand.has(a) || !cand.has(b)) return;
    const w = Number(f[2]);
    if (!conn.out.has(a)) conn.out.set(a, new Map());
    if (!conn.inc.has(b)) conn.inc.set(b, new Map());
    conn.out.get(a).set(b, w); conn.inc.get(b).set(a, w);
  });
  const S = select(neurons, conn);
  console.log(`selected PN ${S.pns.length}, KC ${S.kcs.length}, MBON ${S.mbons.length}, DAN ${S.dans.length}, APL ${S.apl.length}`);

  // positions
  const skelDir = join(SCRATCH, 'skel');
  const all = [...S.pns, ...S.kcs, ...S.mbons, ...S.dans, ...S.apl];
  let pos = new Map();
  if (!NO_SKEL) {
    const missing = all.filter(n => !existsSync(swcPath(skelDir, n.id)));
    if (missing.length) {
      const list = join(SCRATCH, 'skel-need.txt');
      writeFileSync(list, missing.map(n => `hemibrain-v1.2-skeletons/${String(n.id).slice(-2)}/${n.id}.swc`).join('\n') + '\n');
      console.log(`stream skeletons for ${missing.length} neurons (1.9 GB, only matches kept)`);
      await streamSkeletons(META.skeletonUrl, list, skelDir);
    }
    for (const n of all) { const p = swcPath(skelDir, n.id); if (existsSync(p)) pos.set(n.id, readSwc(p)); }
  }
  const P = (arr, k) => arr.map(n => pos.get(n.id)?.[k] ?? null);

  const idx = arr => new Map(arr.map((n, i) => [n.id, i]));
  const iPN = idx(S.pns), iKC = idx(S.kcs), iM = idx(S.mbons), iD = idx(S.dans);
  const pn_kc = [], kc_mbon = [], dan_mbon_syn = [], dan_mbon_compartment = [];
  for (const pn of S.pns) for (const [b, w] of conn.out.get(pn.id) || []) if (iKC.has(b) && w >= T.PN_KC_MIN) pn_kc.push([iPN.get(pn.id), iKC.get(b), w]);
  for (const kc of S.kcs) for (const [b, w] of conn.out.get(kc.id) || []) if (iM.has(b) && w >= T.KC_MBON_MIN) kc_mbon.push([iKC.get(kc.id), iM.get(b), w]);
  for (const d of S.dans) for (const [b, w] of conn.out.get(d.id) || []) if (iM.has(b) && w >= T.DAN_MBON_MIN) dan_mbon_syn.push([iD.get(d.id), iM.get(b), w]);
  S.dans.forEach((d, di) => S.mbons.forEach((m, mi) => {
    if (d.comps.some(c => c !== 'calyx' && m.comps.includes(c))) dan_mbon_compartment.push([di, mi]);
  }));
  pn_kc.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  kc_mbon.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const aplId = S.apl[0]?.id;
  const kcSet = new Set(S.kcs.map(n => n.id));
  let kcToApl = 0, aplToKc = 0;
  for (const [b, w] of conn.out.get(aplId) || []) if (kcSet.has(b)) aplToKc += w;
  for (const [a, w] of conn.inc.get(aplId) || []) if (kcSet.has(a)) kcToApl += w;

  const claws = new Map(); for (const [, k] of pn_kc) claws.set(k, (claws.get(k) || 0) + 1);
  const clawMean = [...claws.values()].reduce((s, v) => s + v, 0) / claws.size;
  const kcByClass = {}; for (const k of S.kcs) kcByClass[k.cls] = (kcByClass[k.cls] || 0) + 1;
  const comps = [...new Set(S.mbons.flatMap(m => m.comps))].sort((a, b) => COMPARTMENTS.indexOf(a) - COMPARTMENTS.indexOf(b));

  const out = {
    meta: {
      ...META,
      retrieved: new Date().toISOString().slice(0, 10),
      hemisphere: 'right (the complete MB in the hemibrain volume)',
      units: 'micrometres; hemibrain voxel 8 nm; pos = soma (largest-radius skeleton node, radius >= 1.2 um) or the centroid when posSoma is 0; cen = cable-weighted skeleton centroid',
      synthetic: false,
      notes: [
        'Wiring is the real hemibrain v1.2 synapse counts between the selected neurons, filtered by the thresholds above.',
        'MBON valence is a model rule: +1 for PPL1-dominated compartments, -1 for PAM-dominated, 0 for ties and the calyx. It is not a per-cell measurement.',
        'dan_mbon_compartment pairs a DAN with an MBON when their Aso 2014 compartments overlap (names parsed from hemibrain instance names). dan_mbon_syn holds the real DAN->MBON synapse counts.',
        'KCs with no uniglomerular PN input (for example KCab-p and KCg-d, which get mostly visual input) stay in the set with no pn_kc edges.',
        'v1.2.1 exists only as a neuPrint dataset; the public bulk export without a neuPrint token is v1.2, so this file uses v1.2.',
      ],
      stats: {
        kcByClass, clawsPerKcMean: Math.round(clawMean * 100) / 100, kcWithPnInput: claws.size,
        pnKcSynapses: pn_kc.reduce((s, e) => s + e[2], 0), kcMbonSynapses: kc_mbon.reduce((s, e) => s + e[2], 0),
        compartments: comps, danReach: S.reach,
        somaFound: all.filter(n => pos.get(n.id)?.found).length, positioned: pos.size,
      },
      buildSeconds: 0,
    },
    pn: { n: S.pns.length, types: S.pns.map(n => n.glom), cellTypes: S.pns.map(n => n.type), ids: S.pns.map(n => n.id), pos: P(S.pns, 'soma'), cen: P(S.pns, 'cen'), posSoma: P(S.pns, 'found') },
    kc: { n: S.kcs.length, types: S.kcs.map(n => n.cls), subtypes: S.kcs.map(n => n.type), ids: S.kcs.map(n => n.id), pos: P(S.kcs, 'soma'), cen: P(S.kcs, 'cen'), posSoma: P(S.kcs, 'found') },
    mbon: { n: S.mbons.length, types: S.mbons.map(n => n.type), instances: S.mbons.map(n => n.instance), compartment: S.mbons.map(n => n.comps[0] || ''), compartments: S.mbons.map(n => n.comps), valence: S.mbons.map(n => n.valence), ids: S.mbons.map(n => n.id), pos: P(S.mbons, 'soma'), cen: P(S.mbons, 'cen'), posSoma: P(S.mbons, 'found') },
    dan: { n: S.dans.length, types: S.dans.map(n => n.type), instances: S.dans.map(n => n.instance), cluster: S.dans.map(n => n.cluster), compartment: S.dans.map(n => n.comps[0] || ''), compartments: S.dans.map(n => n.comps), ids: S.dans.map(n => n.id), pos: P(S.dans, 'soma'), cen: P(S.dans, 'cen'), posSoma: P(S.dans, 'found') },
    apl: { n: S.apl.length, ids: S.apl.map(n => n.id), pos: P(S.apl, 'soma')[0] ?? null, cen: P(S.apl, 'cen')[0] ?? null, kcToAplSynapses: kcToApl, aplToKcSynapses: aplToKc },
    edges: { pn_kc, kc_mbon, dan_mbon_compartment, dan_mbon_syn },
  };
  out.meta.buildSeconds = Math.round((Date.now() - t0) / 1000);
  writeJson(OUT, out);
  console.log(`wrote ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
  console.log(`edges pn_kc ${pn_kc.length}, kc_mbon ${kc_mbon.length}, dan_mbon_compartment ${dan_mbon_compartment.length}, dan_mbon_syn ${dan_mbon_syn.length}`);
  console.log(`positions found ${pos.size}/${all.length}`);
  if (!KEEP) { rmSync(SCRATCH, { recursive: true, force: true }); console.log('deleted scratch', SCRATCH); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
