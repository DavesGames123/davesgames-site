#!/usr/bin/env node
// ============================================================================
//  FLY DUEL  ·  build data/connectome-flywire.json from FlyWire  (node)
// ----------------------------------------------------------------------------
//  This tool makes the wiring of the second fly (Fly B). The hemibrain
//  (data/connectome.json) and FlyWire are two different female flies. The
//  tool downloads the public FlyWire 783 release from Zenodo, extracts the
//  mushroom body (MB) circuit of the right hemisphere and writes a file with
//  the same schema as data/connectome.json. Licence: CC BY 4.0 for both
//  Zenodo records (see CREDITS.md).
//
//  RUN   node tools/build-connectome-flywire.mjs [--scratch DIR] [--out FILE]
//        [--keep]        keep the scratch downloads (default: delete them)
//  Needs: node 18+ (fetch), `unzip`, and `python3` with pyarrow and pandas.
//  Python reads the Arrow feather file only. It runs as `python3 -I` and
//  writes one small CSV of summed pair counts. All selection is in node.
//  Network: about 12 MB (annotations zip) plus 852 MB (connections).
//
//  WHY THE RIGHT HEMISPHERE
//   The hemibrain holds the complete MB of the right hemisphere. The
//   Schlegel 2024 annotations give each FlyWire neuron a soma `side`. So
//   Fly B uses the KCs with side "right", and the two flies compare the
//   same MB. MBONs and DANs are selected by KC input or output, not by
//   side, because some of them have the soma on the other side.
//
//  SELECTION RULES (the same thresholds as tools/build-connectome.mjs)
//   - KC: cell_class "Kenyon_Cell" with side "right". The class (KCab,
//     KCa'b', KCg) and subtype come from the hemibrain_type column.
//   - PN: cell_class "ALPN" with cell_sub_class "uniglomerular" and
//     >= PN_KC_MIN synapses on one selected KC. Glomerulus = the part of
//     the cell type before "_".
//   - MBON: cell_class "MBON" with >= MBON_KC_MIN synapses from the
//     selected KCs (KC connections of >= KC_MBON_MIN synapses only).
//   - DAN: cell_class "DAN" with >= DAN_KC_MIN synapses onto selected KCs.
//   - APL: cell_type "APL" with side "right".
//   - Compartments: FlyWire has no instance names. The tool reads the
//     hemibrain instance names in Supplemental_file5_hemibrain_meta.csv,
//     parses them with parseCompartments from build-connectome.mjs, and
//     takes the union over all hemibrain instances of the same type or
//     morphology type. A FlyWire type such as "MBON25,MBON34" gets the
//     union of both types.
//   - MBON valence: the same model rule as the hemibrain file.
//   - Positions: pos = soma (soma_x/y/z) when the table has one, else the
//     anchor point. cen = the anchor point (pos_x/y/z). The anchor sits on
//     the neurite backbone. It is NOT a cable centroid (no skeletons are
//     downloaded). FAFB voxels are 4 x 4 x 40 nm. Units are micrometres in
//     FAFB14.1 space, not hemibrain space.
//   - Synapse counts: FlyWire counts come from automatic synapse detection
//     (Buhmann 2021). Hemibrain counts are T-bar partner counts. The same
//     threshold therefore does not cut at the same biological strength.
//
//  GREP MAP   (grep -n "<anchor>" tools/build-connectome-flywire.mjs)
//      META constants ....... "const META"
//      download helper ...... "async function download"
//      tsv and csv reader ... "function readTable"
//      compartment table .... "function compartmentTable"
//      feather filter ....... "const PY_FILTER"
//      selection ............ "export function selectFlyWire"
//      comparison stats ..... "export function compareStats"
//      writer ............... "function writeJson"
// ============================================================================
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync,
  writeFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompartments, kcClass, danCluster, COMPARTMENTS } from './build-connectome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UA = 'davesgames.io research';   // neutral User-Agent, no email

const META = {
  source: 'FlyWire whole-brain connectome (FAFB female adult fly brain), proofread connections plus the Schlegel 2024 cell-type annotations',
  release: 'FlyWire 783 (materialization 783); connections Zenodo 10.5281/zenodo.10676866 v783.0; annotations flywire_annotations v3.2.0, Zenodo 10.5281/zenodo.23037340',
  licence: 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), as stated on both Zenodo record pages',
  url: 'https://zenodo.org/records/10676866/files/proofread_connections_783.feather',
  annotationsUrl: 'https://zenodo.org/records/23037340/files/flyconnectome/flywire_annotations-v3.2.0.zip',
  citation: 'Dorkenwald S et al. (2024) Nature 634:124-138, doi:10.1038/s41586-024-07558-y; Schlegel P et al. (2024) Nature 634:139-152, doi:10.1038/s41586-024-07686-5',
  thresholds: { PN_KC_MIN: 3, KC_MBON_MIN: 3, MBON_KC_MIN: 100, DAN_KC_MIN: 50, DAN_MBON_MIN: 5 },
};
const T = META.thresholds;
const CONN_API = 'https://zenodo.org/api/records/10676866/files/proofread_connections_783.feather/content';
const ANN_API = 'https://zenodo.org/api/records/23037340/files/flyconnectome/flywire_annotations-v3.2.0.zip/content';

// ------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SCRATCH = arg('--scratch', '/private/tmp/claude-501/fly-flywire');
const OUT = arg('--out', join(HERE, '..', 'data', 'connectome-flywire.json'));
const HEMI = join(HERE, '..', 'data', 'connectome.json');
const KEEP = argv.includes('--keep');

// ------------------------------------------------------------- downloads
async function download(url, file) {
  if (existsSync(file) && statSync(file).size > 0) return;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file + '.part'));
  spawnSync('mv', [file + '.part', file]);
}

// ------------------------------------------------------------- tables
// Read a TSV or CSV into row objects. The CSV path handles double-quoted
// fields with commas (hemibrain somaLocation is "x,y,z").
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
export function readTable(text, sep) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const split = sep === '\t' ? (l => l.split('\t')) : splitCsv;
  const head = split(lines[0]);
  return lines.slice(1).map(l => { const f = split(l); const o = {}; head.forEach((h, i) => { o[h] = f[i] ?? ''; }); return o; });
}

// ------------------------------------------------------------- compartments
// hemibrain type (and morphology type) -> union of Aso 2014 compartments
// over all hemibrain instances of that type.
export function compartmentTable(hbRows) {
  const map = new Map();
  const add = (k, cs) => { if (!k) return; if (!map.has(k)) map.set(k, new Set()); for (const c of cs) map.get(k).add(c); };
  for (const r of hbRows) {
    if (!/^(MBON|PAM|PPL)/.test(r.type || '')) continue;
    const cs = parseCompartments(r.instance);
    add(r.type, cs); add(r.morphology_type, cs);
  }
  return map;
}
export function compartmentsOf(type, table) {
  if (/^PPL2/.test(type)) return ['calyx'];
  const out = new Set();
  for (const t of String(type).split(',')) for (const c of table.get(t.trim()) || []) out.add(c);
  return [...out].sort((a, b) => COMPARTMENTS.indexOf(a) - COMPARTMENTS.indexOf(b));
}

// ------------------------------------------------------------- feather filter
// Python reads the feather file, keeps rows with both ends in the id list,
// sums syn_count over neuropils per (pre, post) pair, and writes a CSV.
// Root ids are 18 digits, past the safe integer range of JS, so ids stay
// strings in node.
const PY_FILTER = `
import sys, pyarrow.feather as pf, pandas as pd
src, ids_file, out = sys.argv[1], sys.argv[2], sys.argv[3]
ids = set(int(x) for x in open(ids_file).read().split())
t = pf.read_table(src, columns=['pre_pt_root_id', 'post_pt_root_id', 'syn_count'])
d = t.to_pandas()
d = d[d.pre_pt_root_id.isin(ids) & d.post_pt_root_id.isin(ids)]
g = d.groupby(['pre_pt_root_id', 'post_pt_root_id'], as_index=False).syn_count.sum()
g.to_csv(out, index=False, header=False)
print('rows', len(t), 'kept pairs', len(g))
`;

// ------------------------------------------------------------- selection
export function selectFlyWire(ann, conn, table) {
  const um = (x, f) => Math.round(Number(x) * f * 10) / 10;
  const P = r => {
    const anchor = [um(r.pos_x, 0.004), um(r.pos_y, 0.004), um(r.pos_z, 0.04)];
    const has = r.soma_x !== '' && r.soma_x != null && Number.isFinite(Number(r.soma_x));
    return { soma: has ? [um(r.soma_x, 0.004), um(r.soma_y, 0.004), um(r.soma_z, 0.04)] : anchor, cen: anchor, found: has ? 1 : 0 };
  };
  const mk = r => ({ id: r.root_id, type: r.hemibrain_type || r.cell_type, cellType: r.cell_type, side: r.side, p: P(r) });
  const kcs = ann.filter(r => r.cell_class === 'Kenyon_Cell' && r.side === 'right').map(mk)
    .map(n => ({ ...n, cls: kcClass(n.type) || kcClass(n.cellType) })).filter(n => n.cls);
  const kcSet = new Set(kcs.map(n => n.id));
  const sumInto = (pre, set, min = 1) => { let s = 0; for (const [p, w] of conn.out.get(pre) || []) if (set.has(p) && w >= min) s += w; return s; };
  const sumFrom = (post, set, min = 1) => { let s = 0; for (const [p, w] of conn.inc.get(post) || []) if (set.has(p) && w >= min) s += w; return s; };
  const maxInto = (pre, set) => { let m = 0; for (const [p, w] of conn.out.get(pre) || []) if (set.has(p) && w > m) m = w; return m; };

  const pns = ann.filter(r => r.cell_class === 'ALPN' && r.cell_sub_class === 'uniglomerular').map(mk)
    .filter(n => maxInto(n.id, kcSet) >= T.PN_KC_MIN);
  const mbons = ann.filter(r => r.cell_class === 'MBON').map(mk).filter(n => sumFrom(n.id, kcSet, T.KC_MBON_MIN) >= T.MBON_KC_MIN);
  const dans = ann.filter(r => r.cell_class === 'DAN').map(mk).filter(n => sumInto(n.id, kcSet) >= T.DAN_KC_MIN);
  const apl = ann.filter(r => r.cell_type === 'APL' && r.side === 'right').map(mk);
  for (const n of pns) n.glom = n.cellType.split('_')[0];
  for (const n of dans) { n.cluster = danCluster(n.type); n.comps = compartmentsOf(n.type, table); }
  for (const n of mbons) n.comps = compartmentsOf(n.type, table);

  const reach = {};
  for (const d of dans) for (const c of d.comps) { reach[c] ??= { PAM: 0, PPL1: 0, PPL2: 0 }; reach[c][d.cluster]++; }
  for (const m of mbons) {
    let s = 0;
    for (const c of m.comps) { const r = reach[c]; if (!r || c === 'calyx') continue; s += Math.sign(r.PPL1 - r.PAM); }
    m.valence = Math.sign(s);
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  pns.sort((a, b) => cmp(a.glom, b.glom) || cmp(a.type, b.type) || cmp(a.id, b.id));
  const KO = { KCg: 0, "KCa'b'": 1, KCab: 2 };
  kcs.sort((a, b) => KO[a.cls] - KO[b.cls] || cmp(a.type, b.type) || cmp(a.id, b.id));
  mbons.sort((a, b) => cmp(a.type, b.type) || cmp(a.side, b.side) || cmp(a.id, b.id));
  const CO = { PAM: 0, PPL1: 1, PPL2: 2 };
  dans.sort((a, b) => CO[a.cluster] - CO[b.cluster] || cmp(a.type, b.type) || cmp(a.side, b.side) || cmp(a.id, b.id));
  return { pns, kcs, mbons, dans, apl, reach };
}

// ------------------------------------------------------------- comparison
// Per-fly summary of one connectome object (either schema user). Used for
// meta.stats of this file and for the hemibrain side of the comparison.
export function compareStats(C) {
  const count = arr => arr.reduce((o, t) => (o[t] = (o[t] || 0) + 1, o), {});
  const claws = new Map(); for (const [, k] of C.edges.pn_kc) claws.set(k, (claws.get(k) || 0) + 1);
  const cv = [...claws.values()].sort((a, b) => a - b);
  const mean = cv.reduce((s, v) => s + v, 0) / (cv.length || 1);
  const kcm = C.edges.kc_mbon.reduce((s, e) => s + e[2], 0);
  const perComp = {};
  for (const [, m, w] of C.edges.kc_mbon) { const c = C.mbon.compartment[m] || 'none'; perComp[c] = (perComp[c] || 0) + w; }
  return {
    pn: C.pn.n, kc: C.kc.n, mbon: C.mbon.n, dan: C.dan.n, apl: C.apl.n,
    kcByClass: count(C.kc.types), kcBySubtype: count(C.kc.subtypes || []), danByCluster: count(C.dan.cluster),
    kcWithPnInput: claws.size,
    clawsPerKcMean: Math.round(mean * 100) / 100,
    clawsPerKcMedian: cv.length ? cv[cv.length >> 1] : 0,
    pnKcEdges: C.edges.pn_kc.length, pnKcSynapses: C.edges.pn_kc.reduce((s, e) => s + e[2], 0),
    kcMbonEdges: C.edges.kc_mbon.length, kcMbonSynapses: kcm,
    kcMbonSynapsesPerKc: Math.round(kcm / C.kc.n * 10) / 10,
    kcMbonByFirstCompartment: perComp,
  };
}

// ------------------------------------------------------------- writer
function writeJson(file, obj) {
  const body = Object.keys(obj).map(k => {
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
  const dl = join(SCRATCH, 'dl'); mkdirSync(dl, { recursive: true });
  const zip = join(dl, 'ann.zip'), feather = join(dl, 'conn.feather');
  console.log('download', ANN_API); await download(ANN_API, zip);
  const annTsv = join(dl, 'Supplemental_file1_neuron_annotations.tsv'), hbCsv = join(dl, 'Supplemental_file5_hemibrain_meta.csv');
  if (!existsSync(annTsv) || !existsSync(hbCsv)) {
    const r = spawnSync('unzip', ['-oj', zip, '*/supplemental_files/Supplemental_file1_neuron_annotations.tsv', '*/supplemental_files/Supplemental_file5_hemibrain_meta.csv', '-d', dl], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('unzip failed');
  }
  console.log('download', CONN_API); await download(CONN_API, feather);

  const ann = readTable(readFileSync(annTsv, 'utf8'), '\t');
  const table = compartmentTable(readTable(readFileSync(hbCsv, 'utf8'), ','));
  const cand = ann.filter(r => ['Kenyon_Cell', 'ALPN', 'MBON', 'DAN'].includes(r.cell_class) || r.cell_type === 'APL').map(r => r.root_id);
  const idsFile = join(dl, 'cand.txt'), pairs = join(dl, 'pairs.csv');
  writeFileSync(idsFile, cand.join('\n') + '\n');
  const py = spawnSync('python3', ['-I', '-c', PY_FILTER, feather, idsFile, pairs], { stdio: 'inherit' });
  if (py.status !== 0) throw new Error('python feather filter failed (needs pyarrow and pandas)');

  const conn = { out: new Map(), inc: new Map() };
  for (const line of readFileSync(pairs, 'utf8').split('\n')) {
    if (!line) continue;
    const [a, b, w] = line.split(',');
    const n = Number(w);
    if (!conn.out.has(a)) conn.out.set(a, new Map());
    if (!conn.inc.has(b)) conn.inc.set(b, new Map());
    conn.out.get(a).set(b, n); conn.inc.get(b).set(a, n);
  }
  const S = selectFlyWire(ann, conn, table);
  console.log(`selected PN ${S.pns.length}, KC ${S.kcs.length}, MBON ${S.mbons.length}, DAN ${S.dans.length}, APL ${S.apl.length}`);

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
  dan_mbon_syn.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const aplId = S.apl[0]?.id, kcSet = new Set(S.kcs.map(n => n.id));
  let kcToApl = 0, aplToKc = 0;
  for (const [b, w] of conn.out.get(aplId) || []) if (kcSet.has(b)) aplToKc += w;
  for (const [a, w] of conn.inc.get(aplId) || []) if (kcSet.has(a)) kcToApl += w;

  const G = (arr, extra) => ({ n: arr.length, ...extra(arr), ids: arr.map(n => n.id), pos: arr.map(n => n.p.soma), cen: arr.map(n => n.p.cen), posSoma: arr.map(n => n.p.found) });
  const out = {
    meta: {
      ...META,
      retrieved: new Date().toISOString().slice(0, 10),
      animal: 'FlyWire FAFB: one adult female Drosophila melanogaster. A different individual from the hemibrain fly.',
      hemisphere: 'right (KCs with soma side "right" in the Schlegel 2024 annotations; the hemibrain MB is also the right one)',
      units: 'micrometres in FAFB14.1 space (voxel 4 x 4 x 40 nm), not hemibrain space; pos = soma when annotated, else the anchor; cen = the FlyWire anchor point on the neurite backbone, NOT a cable centroid',
      idsAre: 'strings (FlyWire 783 root ids have 18 digits, past the JS safe integer range)',
      synthetic: false,
      notes: [
        'Wiring is the real FlyWire 783 synapse counts between the selected neurons, summed over neuropils, filtered by the same thresholds as the hemibrain file.',
        'FlyWire synapses come from automatic detection (Buhmann 2021); hemibrain counts come from a different pipeline. Equal thresholds do not mean equal biological strength.',
        'Cell types come from the hemibrain_type column of the Schlegel 2024 annotations (flywire_annotations v3.2.0). Compartments come from hemibrain instance names of the same type, because FlyWire has no instance names.',
        'MBON valence is the same model rule as the hemibrain file: +1 for PPL1-dominated compartments, -1 for PAM-dominated, 0 for ties and the calyx.',
        'KCs with no uniglomerular PN input stay in the set with no pn_kc edges.',
      ],
      stats: null,
      buildSeconds: 0,
    },
    pn: G(S.pns, a => ({ types: a.map(n => n.glom), cellTypes: a.map(n => n.type) })),
    kc: G(S.kcs, a => ({ types: a.map(n => n.cls), subtypes: a.map(n => n.type) })),
    mbon: G(S.mbons, a => ({ types: a.map(n => n.type), instances: a.map(n => `${n.type}(${n.comps.join('')})_${n.side === 'left' ? 'L' : 'R'}`), compartment: a.map(n => n.comps[0] || ''), compartments: a.map(n => n.comps), valence: a.map(n => n.valence) })),
    dan: G(S.dans, a => ({ types: a.map(n => n.type), instances: a.map(n => `${n.type}(${n.comps.join('')})_${n.side === 'left' ? 'L' : 'R'}`), cluster: a.map(n => n.cluster), compartment: a.map(n => n.comps[0] || ''), compartments: a.map(n => n.comps) })),
    apl: { n: S.apl.length, ids: S.apl.map(n => n.id), pos: S.apl[0]?.p.soma ?? null, cen: S.apl[0]?.p.cen ?? null, kcToAplSynapses: kcToApl, aplToKcSynapses: aplToKc },
    edges: { pn_kc, kc_mbon, dan_mbon_compartment, dan_mbon_syn },
  };
  const comps = [...new Set(S.mbons.flatMap(m => m.comps))].sort((a, b) => COMPARTMENTS.indexOf(a) - COMPARTMENTS.indexOf(b));
  const fw = compareStats(out);
  const hb = existsSync(HEMI) ? compareStats(JSON.parse(readFileSync(HEMI, 'utf8'))) : null;
  out.meta.stats = {
    ...fw, compartments: comps, danReach: S.reach,
    somaFound: [...S.pns, ...S.kcs, ...S.mbons, ...S.dans, ...S.apl].filter(n => n.p.found).length,
    compareHemibrain: hb ? { note: 'Same summary computed from data/connectome.json (hemibrain v1.2, right MB) by compareStats in this tool.', hemibrain: hb } : null,
  };
  out.meta.buildSeconds = Math.round((Date.now() - t0) / 1000);
  writeJson(OUT, out);
  console.log(`wrote ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
  console.log(`edges pn_kc ${pn_kc.length}, kc_mbon ${kc_mbon.length}, dan_mbon_compartment ${dan_mbon_compartment.length}, dan_mbon_syn ${dan_mbon_syn.length}`);
  if (!KEEP) { rmSync(SCRATCH, { recursive: true, force: true }); console.log('deleted scratch', SCRATCH); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
