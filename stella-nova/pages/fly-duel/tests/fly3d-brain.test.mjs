// ============================================================================
//  FLY DUEL  ·  3D brain map tests  (node tests/fly3d-brain.test.mjs)
// ----------------------------------------------------------------------------
//  Builds ui/fly3d/brain3d.js in node (three.js runs without a renderer):
//  the scene graph, the instance and vertex counts, the frame map and the
//  axis checks, the neuropil outline, and one fire() with a real trace
//  from a pretrained Fly. It checks that the right counts light, that the
//  sequence runs to its end state, that no buffer holds NaN, and that a
//  second file with the same schema (FAFB frame, other counts) builds.
//  An import hook maps the bare 'three' names to vendor/three@0.160.0, as
//  the import map of the page does. Exit code 1 on any failure.
// ============================================================================
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = pathToFileURL(join(ROOT, '..', '..', 'vendor', 'three@0.160.0')).href;
const hook = `
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const THREE = await import('three');
const B = await import('../ui/fly3d/brain3d.js');
const { Fly } = await import('../brain/fly.js');
const { newGame, legalActions, step } = await import('../game/rules.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const C = JSON.parse(readFileSync(join(ROOT, 'data', 'connectome.json'), 'utf8'));
const NP = JSON.parse(readFileSync(join(ROOT, 'data', 'neuropil-hemibrain.json'), 'utf8'));
const PRE = JSON.parse(readFileSync(join(ROOT, 'data', 'pretrained.json'), 'utf8'));

const finiteArr = a => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };
function noNaN(map) {
  const m = map.meshes;
  return [m.kc, m.pn, m.mbon, m.dan].every(x => finiteArr(x.instanceMatrix.array) && finiteArr(x.instanceColor.array))
    && [m.pnKc, m.kcMbon, m.spikes].every(x => finiteArr(x.geometry.attributes.position.array) && finiteArr(x.geometry.attributes.color.array));
}

// ---------------------------------------------------------------- neuropil file
ok(readFileSync(join(ROOT, 'data', 'neuropil-hemibrain.json')).length < 200 * 1024, 'neuropil json under 200 KB');
ok(NP.meta.frame === 'hemibrain' && /CC BY 4\.0/.test(NP.meta.licence), 'neuropil: hemibrain frame, CC BY 4.0');
const roiNames = NP.rois.map(r => r.name);
for (const n of ['CA(R)', 'PED(R)', 'aL(R)', "a'L(R)", 'bL(R)', "b'L(R)", 'gL(R)']) ok(roiNames.includes(n), `neuropil has ${n}`);
ok(NP.rois.every(r => r.v.length % 3 === 0 && r.f.length % 3 === 0 && r.f.every(i => i >= 0 && i < r.v.length / 3)), 'neuropil indices in bounds');
ok(NP.rois.every(r => finiteArr(r.v)), 'neuropil vertices finite');
ok(readFileSync(join(ROOT, 'NEUROPIL-CREDITS.md'), 'utf8').includes('CC BY 4.0'), 'NEUROPIL-CREDITS.md names the licence');
// KC cable centroids sit inside the MB ROI box (same um frame, real data)
{
  const box = [[1e9, 1e9, 1e9], [-1e9, -1e9, -1e9]];
  for (const r of NP.rois.filter(r => r.part !== 'al')) for (let i = 0; i < r.v.length; i += 3) for (let a = 0; a < 3; a++) { box[0][a] = Math.min(box[0][a], r.v[i + a]); box[1][a] = Math.max(box[1][a], r.v[i + a]); }
  const inside = C.kc.cen.filter(p => p.every((v, a) => v >= box[0][a] - 2 && v <= box[1][a] + 2)).length;
  ok(inside / C.kc.n > 0.95, `KC cable centroids inside the MB ROI box (${inside}/${C.kc.n})`);
}

// ---------------------------------------------------------------- build
const t0 = Date.now();
const map = B.createBrainMap(C, { colour: '#39d0f0', neuropil: NP, size: 0.5 });
const buildMs = Date.now() - t0;
const st = map.stats();
ok(map.group instanceof THREE.Group, 'group is a THREE.Group');
ok(map.group.scale.x === 0.5, 'size scales the group');
ok(map.meshes.kc.count === 1927 && map.meshes.kc.count === C.kc.n, 'one KC instance per KC (1927)');
ok(map.meshes.pn.count === C.pn.n && map.meshes.mbon.count === C.mbon.n && map.meshes.dan.count === C.dan.n, 'PN, MBON, DAN instance counts');
ok(map.meshes.apl && map.meshes.apl.isLineSegments, 'APL cage present');
ok(map.meshes.pnKc.geometry.attributes.position.count === 2 * C.edges.pn_kc.length, `PN->KC line vertices = 2 x ${C.edges.pn_kc.length}`);
ok(map.meshes.kcMbon.geometry.attributes.position.count === 2 * C.edges.kc_mbon.length, `KC->MBON line vertices = 2 x ${C.edges.kc_mbon.length}`);
ok(map.meshes.pnKc.geometry.attributes.color.itemSize === 4, 'edge colour is RGBA per vertex');
ok(st.neuropil.length === NP.rois.length, 'every neuropil ROI built');
ok(st.frame === 'hemibrain' && st.sign.join() === '1,1,1', `hemibrain frame needs no axis flip (${st.sign})`);
ok(st.tris < 60000, `brain triangles ${st.tris} < 60k (desktop)`);
ok(noNaN(map), 'no NaN after build');
// anatomy in group space: +Y dorsal, +Z anterior, +X medial
const P = map.place;
const meanAx = (arr, a) => { let s = 0; for (let i = a; i < arr.length; i += 3) s += arr[i]; return s / (arr.length / 3); };
ok(meanAx(P.kc, 1) > meanAx(P.pn, 1), 'KC somata dorsal of PN somata (+Y)');
ok(meanAx(P.mbon, 2) > meanAx(P.kc, 2), 'MBONs (lobes) anterior of KC somata (+Z)');
let maxR = 0;
for (const arr of [P.kc, P.pn, P.mbon, P.dan]) for (let i = 0; i < arr.length; i += 3) maxR = Math.max(maxR, Math.hypot(arr[i], arr[i + 1], arr[i + 2]));
ok(maxR <= 1.2 + 1e-6, `all neurons inside radius 1.2 (max ${maxR.toFixed(3)}, clamped ${st.clamped})`);
ok(st.clamped < 0.03 * (C.kc.n + C.pn.n + C.mbon.n + C.dan.n), `few clamped outliers (${st.clamped})`);
const lite = B.createBrainMap(C, { lite: true });
ok(lite.stats().tris < st.tris / 2, `lite map has fewer triangles (${lite.stats().tris})`);
lite.dispose();

// ---------------------------------------------------------------- fire with a real trace
const fly = Fly.fromJSON(C, PRE.A);
let s = newGame({ seed: 7 });
let tr = null, withDelta = null;
for (let i = 0; i < 12 && (!tr || !withDelta); i++) {
  const r = fly.choose(s, legalActions(s), { learn: true });
  if (!tr) tr = r.trace;
  if (Math.abs(r.trace.delta) > 0.02 && !withDelta) withDelta = r.trace;
  s = step(s, r.action);
}
ok(tr && tr.kc.length > 0, `real trace has active KCs (${tr?.kc.length})`);
const expPn = [...tr.pn].filter(v => v >= B.PN_ON).length;
const act = new Set(tr.kc);
const expE1 = C.edges.pn_kc.filter(e => act.has(e[1])).length;
const expE2 = C.edges.kc_mbon.filter(e => act.has(e[0])).length;
const expM = [...tr.mbon].filter(v => v > 0).length;

let L = map.fire(tr);
ok(L.kc === tr.kc.length, `lit KCs = trace KCs (${L.kc})`);
ok(L.pn === expPn, `lit PNs = PNs with rate >= ${B.PN_ON} (${L.pn})`);
ok(L.pnKc === expE1, `lit PN->KC edges = claws of active KCs (${L.pnKc})`);
ok(L.kcMbon === expE2, `lit KC->MBON edges = synapses of active KCs (${L.kcMbon})`);
ok(L.mbon === expM, `lit MBONs = MBONs with output (${L.mbon})`);
ok(map.running, 'sequence runs after fire');
// At t = 0: the KCs are not on yet (they switch at PHASE.kcOn)
const kcScale = i => map.meshes.kc.instanceMatrix.array[16 * i];
const k0 = tr.kc[0];
ok(kcScale(k0) < 0.015, 'active KC still silent at t = 0');
// mid-way through PN->KC: spikes in flight
map.update(0.25 * 1.4);
ok(map.meshes.spikes.geometry.drawRange.count > 0, `spikes in flight at 25 % (${map.meshes.spikes.geometry.drawRange.count})`);
ok(kcScale(k0) < 0.015, 'active KC silent before the cut');
map.update(0.2 * 1.4);
ok(kcScale(k0) > 0.015, 'active KC on after the cut (45 %)');
const silent = [...Array(C.kc.n).keys()].find(i => !act.has(i));
ok(kcScale(silent) < 0.015, 'a silent KC stays small');
for (let i = 0; i < 40 && map.running; i++) map.update(0.05);
ok(!map.running, 'sequence ends');
ok(map.meshes.spikes.geometry.drawRange.count === 0, 'no spikes after the end');
ok(noNaN(map), 'no NaN after a full sequence');
// count lit edges in the colour buffer: alpha above base
const litAlpha = (line, base) => { const c = line.geometry.attributes.color.array; let n = 0; for (let e = 0; e < c.length / 8; e++) if (c[8 * e + 3] > base + 1e-6) n++; return n; };
ok(litAlpha(map.meshes.pnKc, 0.03) === expE1, `PN->KC edges lit in the buffer (${litAlpha(map.meshes.pnKc, 0.03)})`);
ok(litAlpha(map.meshes.kcMbon, 0.02) === expE2, `KC->MBON edges lit in the buffer (${litAlpha(map.meshes.kcMbon, 0.02)})`);
let bigKc = 0;
for (let i = 0; i < C.kc.n; i++) if (kcScale(i) > 0.015) bigKc++;
ok(bigKc === tr.kc.length, `KCs large at the end = active KCs (${bigKc})`);

// DAN burst with a real TD delta
ok(withDelta, 'a trace with |delta| > 0.02 in 12 learning decisions');
if (withDelta) {
  L = map.fire(withDelta);
  const expDan = [...withDelta.dan].filter(v => v > 0).length;
  ok(L.dan === expDan && L.dan > 0, `bursting DANs = DANs with signal (${L.dan})`);
  ok(L.compartments.length > 0, `burst compartments: ${L.compartments.join(' ')}`);
  // previous KCs restored
  ok(kcScale(k0) < 0.015 || act.has(k0) && new Set(withDelta.kc).has(k0), 'old active KCs reset on the next fire');
  map.update(0.85 * 1.4);
  const shells = map.group.children.filter(c => c.name.startsWith('burst:') && c.visible);
  ok(shells.length === L.compartments.length, `a shell per burst compartment at 85 % (${shells.length})`);
  const wantCol = withDelta.delta > 0 ? '#3ee89a' : '#ff4d4d';
  ok(shells.every(sh => '#' + sh.material.color.getHexString() === wantCol), `shell colour ${wantCol} for delta ${withDelta.delta.toFixed(3)}`);
  const dm = map.meshes.dan, i0 = [...withDelta.dan].findIndex(v => v > 0);
  ok(dm.instanceMatrix.array[16 * i0] > 0.015, 'a bursting DAN is large in its burst');
  map.update(1);
  ok(map.group.children.filter(c => c.name.startsWith('burst:') && c.visible).length === 0, 'shells removed after the burst');
  ok(noNaN(map), 'no NaN after a DAN burst');
}
// learning off: zero DAN array, explicit delta -> cluster rule
L = map.fire({ ...tr, dan: new Float32Array(C.dan.n) }, -0.3, { instant: true });
ok(L.dan === C.dan.cluster.filter(c => c === 'PPL1').length, `delta < 0 and no DAN array: PPL1 cluster bursts (${L.dan})`);
ok(!map.running, 'instant fire ends at once');
L = map.fire({ ...tr, dan: new Float32Array(C.dan.n) }, 0.01, { instant: true });
ok(L.dan === 0, 'small delta: no burst');
// bad input
L = map.fire({ pn: [NaN, 2, -1], kc: [-1, 99999, 3, 3], mbon: [NaN] }, NaN, { instant: true });
ok(L.kc === 1 && noNaN(map), 'bad trace values are dropped, no NaN');
ok(map.fire(null).fires === L.fires, 'fire(null) does nothing');

// ---------------------------------------------------------------- second file, FAFB frame
// Same schema, other counts and frame: mirror the hemibrain file into a
// FAFB-like frame (nm-free um, y down, z posterior) and drop half the KCs.
{
  const toFafb = p => [600 - p[0], p[2] + 40, 300 - p[1]];   // mirrored: a left MB
  const keep = C.kc.n - 400;
  const kmap = i => (i < keep ? i : -1);
  const F = {
    meta: { ...C.meta, source: 'FlyWire whole-brain connectome (test copy)', units: 'micrometres in FAFB14.1 space' },
    pn: { ...C.pn, pos: C.pn.pos.map(toFafb), cen: C.pn.cen.map(toFafb) },
    kc: { ...C.kc, n: keep, types: C.kc.types.slice(0, keep), pos: C.kc.pos.slice(0, keep).map(toFafb), cen: C.kc.cen.slice(0, keep).map(toFafb) },
    mbon: { ...C.mbon, pos: C.mbon.pos.map(toFafb), cen: C.mbon.cen.map(toFafb) },
    dan: { ...C.dan, pos: C.dan.pos.map(toFafb), cen: C.dan.cen.map(toFafb) },
    apl: { ...C.apl, pos: null, cen: toFafb(C.apl.cen) },
    edges: {
      pn_kc: C.edges.pn_kc.filter(e => kmap(e[1]) >= 0),
      kc_mbon: C.edges.kc_mbon.filter(e => kmap(e[0]) >= 0),
      dan_mbon_compartment: C.edges.dan_mbon_compartment,
    },
  };
  ok(B.detectFrame(F) === 'fafb', 'FlyWire file detected as FAFB frame');
  const m2 = B.createBrainMap(F, { colour: '#f26ad6', neuropil: NP });
  const s2 = m2.stats();
  ok(s2.neuropil.length === 0, 'hemibrain neuropil not drawn on a FAFB file');
  ok(m2.meshes.kc.count === keep, 'KC count follows the file');
  const Q = m2.place;
  // after the frame map and the axis checks, the anatomy matches the hemibrain map
  ok(meanAx(Q.kc, 1) > meanAx(Q.pn, 1) && meanAx(Q.mbon, 2) > meanAx(Q.kc, 2), 'FAFB: dorsal and anterior axes fixed');
  let dx = 0;
  for (let i = 0; i < keep; i++) dx = Math.max(dx, Math.abs(Q.kc[3 * i] - P.kc[3 * i]) + Math.abs(Q.kc[3 * i + 1] - P.kc[3 * i + 1]) + Math.abs(Q.kc[3 * i + 2] - P.kc[3 * i + 2]));
  ok(dx < 0.15, `mirrored FAFB copy lands where the hemibrain KCs are (max L1 ${dx.toFixed(3)})`);
  const tr2 = { ...tr, kc: Uint16Array.from(tr.kc.filter(k => k < keep)) };
  const L2 = m2.fire(tr2, 0.2);
  ok(L2.kc === tr2.kc.length, 'FAFB map: lit KCs = trace KCs');
  for (let i = 0; i < 40 && m2.running; i++) m2.update(0.05);
  ok(noNaN(m2), 'FAFB map: no NaN');
  m2.dispose();
}

// ---------------------------------------------------------------- helpers
ok(B.kcFamily("KCa'b'") === 'apbp' && B.kcFamily('KCg') === 'g' && B.kcFamily('KCab') === 'ab', 'kcFamily');
ok(B.compartmentRoi("β'2") === "b'L(R)" && B.compartmentRoi('γ4') === 'gL(R)' && B.compartmentRoi('α1') === 'aL(R)' && B.compartmentRoi('calyx') === 'CA(R)', 'compartmentRoi');
ok(typeof B.createBrainView === 'function' && typeof B.loadNeuropil === 'function', 'view and loader exported');
ok(await B.loadNeuropil({ meta: { source: 'FlyWire' } }, 'file:///nowhere/') === null, 'loadNeuropil: null for FAFB');

map.dispose();
// ---------------------------------------------------------------- anatomy, KC points, spike tails, card
{
  // Lobes in their KC family colour, a marker per compartment, label
  // anchors for the parts, the KC firing points, spike tails, and the
  // small HUD card (headless in node).
  const { KC_TYPE } = await import('../ui/tokens.js');
  const m = B.createBrainMap(C, { colour: '#39d0f0', neuropil: NP });
  ok(B.lobeFamily('gL(R)') === 'g' && B.lobeFamily("a'L(R)") === 'apbp' && B.lobeFamily('β2') === 'ab' && B.lobeFamily("β'1") === 'apbp' && B.lobeFamily('CA(R)') === null, 'lobeFamily: γ, α/β, α′/β′, calyx');
  const roiCol = name => '#' + m.group.getObjectByName('roi:' + name).material.color.getHexString();
  const famHex = f => '#' + new THREE.Color(KC_TYPE[f]).lerp(new THREE.Color('#394155'), 0.3).getHexString();
  ok(roiCol('gL(R)') === famHex('g') && roiCol('aL(R)') === famHex('ab') && roiCol("b'L(R)") === famHex('apbp'), 'lobe outlines in the KC family colour');
  ok(roiCol('gL(R)') !== roiCol('aL(R)') && roiCol('aL(R)') !== roiCol("a'L(R)"), 'the three lobe families have three colours');
  const comps = new Set([...C.mbon.compartment, ...C.dan.compartment]);
  ok(m.meshes.markers.length === comps.size, `a marker per compartment (${m.meshes.markers.length})`);
  const A = m.anchors();
  for (const k of ['CA(R)', 'PED(R)', 'gL(R)', 'aL(R)', "b'L(R)", 'comp:γ1', 'KC', 'PN']) ok(A.some(a => a.key === k && a.title && a.text && a.pos.every(Number.isFinite)), `label anchor ${k}`);
  // pickScreen: project an anchor and pick at its screen point
  const cam = new THREE.PerspectiveCamera(34, 1.5, 0.01, 40); cam.position.set(3, 1, 2); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  const g1 = A.find(a => a.key === 'comp:γ1');
  const v = new THREE.Vector3(...g1.pos).applyMatrix4(m.group.matrixWorld).project(cam);
  const hit = m.pickScreen((v.x * 0.5 + 0.5) * 600, (1 - (v.y * 0.5 + 0.5)) * 400, cam, 600, 400);
  ok(hit && (hit.key === 'comp:γ1' || hit.kind === 'compartment' || hit.kind === 'roi'), `pickScreen finds a part at the γ1 marker (${hit?.key})`);
  ok(m.pickScreen(-500, -500, cam, 600, 400) === null, 'pickScreen: nothing far from every part');
  // KC points and spike tails
  m.fire(tr);
  ok(m.meshes.kcFire.geometry.drawRange.count === 0, 'KC points dark before the cut');
  m.update(0.25 * 1.4);
  ok(m.meshes.tails.geometry.drawRange.count === 2 * m.meshes.spikes.geometry.drawRange.count && m.meshes.tails.geometry.drawRange.count > 0, 'one tail per spike in flight');
  const tp = m.meshes.tails.geometry.attributes.position.array, sp = m.meshes.spikes.geometry.attributes.position.array;
  ok(Math.abs(tp[3] - sp[0]) + Math.abs(tp[4] - sp[1]) + Math.abs(tp[5] - sp[2]) < 1e-6, 'a tail ends at its spike');
  m.update(0.2 * 1.4);
  ok(m.meshes.kcFire.geometry.drawRange.count === tr.kc.length, `KC points = active KCs after the cut (${m.meshes.kcFire.geometry.drawRange.count})`);
  for (let i = 0; i < 40 && m.running; i++) m.update(0.05);
  ok(m.meshes.kcFire.geometry.drawRange.count === tr.kc.length && m.meshes.tails.geometry.drawRange.count === 0, 'KC points hold, tails gone at the end');
  if (withDelta) {
    const Lb = m.fire(withDelta, undefined, { instant: true });
    const lit = m.meshes.markers.filter(mk => Lb.compartments.includes(mk.name.slice(5)));
    ok(lit.length === Lb.compartments.length && lit.every(mk => '#' + mk.material.color.getHexString() === (withDelta.delta > 0 ? '#3ee89a' : '#ff4d4d')), 'burst compartments light their markers');
  }
  m.dispose();
  // the HUD card, headless
  const card = B.createBrainCard(null, C, { colour: '#f26ad6', coarse: true });
  ok(card.map.stats().tris < st.tris / 2, `card on a phone uses the lite map (${card.map.stats().tris} tris)`);
  card.fire(tr, 0.1);
  let frames = 0; while (card.update(1 / 30) && frames < 200) frames++;
  ok(frames > 10 && !card.running, `card: the host loop runs the sequence (${frames} frames)`);
  ok(card.update(1 / 30) === false, 'card: no draw when nothing changes');
  card.resize(); card.dispose();
}

console.log(`fly3d-brain: ${pass} passed, ${fail} failed  (build ${buildMs} ms, ${st.tris} tris, ${st.lines} lines, lit pn ${expPn} kc ${tr.kc.length} pn-kc ${expE1} kc-mbon ${expE2})`);
process.exit(fail ? 1 : 0);
