// ============================================================================
//  FLY DUEL  ·  live 3D map of one fly's mushroom body  (ES module, three r160)
// ----------------------------------------------------------------------------
//  One brain map shows the mushroom body (MB) circuit of one model fly from
//  its connectome file (data/connectome.json, hemibrain v1.2, or a FlyWire
//  file with the same schema). On each decision of the fly, fire(trace)
//  plays the decision through the circuit. Spec: FLY3D.md "Live 3D brain
//  map". Everything that lights is data from the trace of brain/fly.js
//  choose(). Nothing moves without a trace (no idle motion).
//
//  WHAT IS DRAWN (all positions are real, in micrometres, then scaled)
//      PN    projection neurons, soma ('pos'). Faceted gem, --pn by rate.
//      KC    1927 Kenyon cells, soma ('pos'), one InstancedMesh. Silent KCs
//            are tinted by subtype family (ab, a'b', g: KC_TYPE of
//            ui/tokens.js, darkened). Active KCs are --kc-on and larger.
//      MBON  output neurons at their cable centroid ('cen'), which is in
//            the lobe compartment where KC axons meet them. Colour by
//            valence (--app / --avoid / --none). Size by output rate.
//      DAN   dopamine neurons at 'cen' (their compartment). In a burst:
//            --app for PAM, --avoid for PPL1, size by |TD delta|.
//      APL   one wire cage at its cable centroid. It flashes when the KC
//            code forms (k winners, the model of APL inhibition).
//      edges PN->KC and KC->MBON as thin LineSegments with RGBA vertex
//            colour, so a signal can light one edge from source to target.
//      spikes square Points that run along the lit edges at one speed.
//      neuropil (optional) the hemibrain ROI meshes of calyx, pedunculus,
//            lobes and antennal lobe (data/neuropil-hemibrain.json, see
//            tools/build-neuropil.mjs and NEUROPIL-CREDITS.md) as a crisp
//            edge outline in the fly colour. Only for a hemibrain-frame
//            connectome: a FlyWire file has no matching meshes.
//
//  GROUP AXES (after the frame map, both connectome files)
//      +Y dorsal, +Z anterior, +X medial (toward the midline). The group
//      is centred on the circuit and has radius ~1 times opts.size.
//      Frames: 'hemibrain' (x lateral->medial, y posterior->anterior,
//      z dorsal->ventral) and 'fafb' (x, y dorsal->ventral, z). After the
//      frame map, three anatomy checks fix each axis sign (beta/gamma
//      MBONs are medial and anterior to KC somata, KC somata are dorsal to
//      PN somata), so a left-side or flipped file also shows the right way.
//
//  FIRE SEQUENCE (fractions of the duration T, default 1.4 s)
//      0.00-0.10  active PNs light by rate (rate >= PN_ON counts as active)
//      0.08-0.38  spikes run PN->KC along the claws of the active KCs
//      0.38       the active KC set swaps at once (a cut), APL flashes
//      0.42-0.72  spikes run KC->MBON from the active KCs
//      0.70-0.80  MBONs grow to their output rate
//      0.78-1.00  DAN burst: DANs light, a wire shell grows on each burst
//                 compartment and its lobe outline takes the burst colour
//      after 1.0  KCs, MBONs and the lit edges hold until the next fire
//  Reduced motion or { instant: true }: jump to the end state.
//
//  USE
//      import { createBrainMap, createBrainView, loadNeuropil } from './brain3d.js';
//      const map = createBrainMap(connectome, { colour: '#39d0f0', size: 0.3 });
//      head.add(map.group);                 // in the table scene
//      map.fire(trace);                     // trace from fly.choose()
//      map.update(dt);                      // each frame, dt in seconds
//      const view = createBrainView(canvas, connectome, { colour });  // own canvas
//      const card = createBrainCard(canvas, connectome, { colour, neuropil });
//      card.fire(trace, delta); card.update(dt);   // HUD scorecard panel
//
//  ANATOMY (clearer parts, 2026-10-11)
//      Lobes take the colour of their KC family (γ, α/β, α′/β′: KC_TYPE),
//      the calyx and the peduncle the fly colour. A wire marker stands at
//      each compartment in its lobe colour; a DAN burst lights it. The
//      active KCs also show as bright square points (the sparse code),
//      with a flash when the set forms. Each spike has a short tail along
//      its edge. anchors() and pickScreen() give the hover and tap labels
//      (ANATOMY names the parts in plain words).
//      Edge alpha options: restEdges (default 1) multiplies the rest alpha
//      of all edges. holdOut (default HOLD_ALPHA) is the alpha factor of
//      the lit KC->MBON edges after the sequence. The small map in the
//      table scene uses restEdges 0.3 and holdOut 0.
//
//  GREP MAP   (grep -n "<anchor>" ui/fly3d/brain3d.js)
//      export function createBrainMap ... the map: group, fire, update, lit
//      export function createBrainView .. own canvas, orbit, render loop
//      export function createBrainCard .. small HUD panel, host loop
//      export function regionLabels ..... PN, KC, MBON, DAN, APL labels
//      export function sizeSprites ...... screen size of label sprites
//      ui/fly3d/brainpanels.js .......... the two big side panels of the
//                                         page (one shared renderer)
//      export function lobeFamily ....... lobe or compartment -> KC family
//      export const ANATOMY ............. names and text of the parts
//      export function anatomyTips ...... hover and tap labels
//      anchors( / pickScreen( ........... inside createBrainMap
//      export async function loadNeuropil  fetch neuropil json for a frame
//      export function detectFrame ...... 'hemibrain' | 'fafb'
//      export const PN_ON ............... PN rate that counts as active
//      export const PHASE ............... the fire sequence fractions
//      function placeAll ................ frame map, axis checks, scaling
//      function facetGeometry ........... baked flat shading for gems
//      function buildNeuropil ........... ROI meshes -> edge outline
//      fire( / update( / lit( ........... inside createBrainMap
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TOKENS, KC_TYPE } from '../tokens.js';

export const PN_ON = 0.1;
export const PHASE = Object.freeze({
  pnOn: [0, 0.1], pnKc: [0.08, 0.38], kcOn: 0.38, kcMbon: [0.42, 0.72],
  mbon: [0.7, 0.8], dan: [0.78, 1],
});
const HOLD_ALPHA = 0.42;     // lit edges after the sequence
const SPIKE_MAX = 6000;      // spikes drawn at most
const DAN_MIN = 0.02;        // |delta| under this: no burst (DESIGN.md 5.4)

const col = hex => new THREE.Color(hex);
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const ramp = (p, a, b) => clamp01((p - a) / (b - a));

// ---------------------------------------------------------------- frame
// 'fafb' for a FlyWire / FAFB file, else 'hemibrain'.
export function detectFrame(C) {
  const m = C?.meta || {};
  const s = `${m.frame || ''} ${m.units || ''} ${m.source || ''} ${m.release || ''}`;
  return /fafb|flywire/i.test(s) ? 'fafb' : 'hemibrain';
}

const FRAME_MAP = {
  hemibrain: p => [p[0], -p[2], p[1]],
  fafb: p => [p[0], -p[1], -p[2]],
};

const okPos = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

function pick(G, i, key) {
  const a = G?.[key]?.[i], b = G?.[key === 'pos' ? 'cen' : 'pos']?.[i];
  return okPos(a) ? a : okPos(b) ? b : null;
}

function quantile(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] : 0; }

// Map every group to group space. Returns { pn, kc, mbon, dan: Float32Array
// xyz, apl: [x,y,z], toLocal(p), sign, centre, scale, clamped }.
function placeAll(C, keys, frame, clampR) {
  const fm = FRAME_MAP[frame] || FRAME_MAP.hemibrain;
  const raw = {};
  for (const g of ['pn', 'kc', 'mbon', 'dan']) {
    const n = C[g]?.n | 0;
    raw[g] = Array.from({ length: n }, (_, i) => { const p = pick(C[g], i, keys[g]); return p ? fm(p) : null; });
  }
  const mean = (arr, a, f = () => true) => {
    let s = 0, n = 0;
    arr.forEach((p, i) => { if (p && f(i)) { s += p[a]; n++; } });
    return n ? s / n : NaN;
  };
  const bg = i => /^[βγbg]/i.test(String(C.mbon.compartment?.[i] || ''));
  // Anatomy checks (see header). NaN (missing groups) keeps the sign.
  const sign = [
    mean(raw.mbon, 0, bg) < mean(raw.kc, 0) ? -1 : 1,
    mean(raw.kc, 1) < mean(raw.pn, 1) ? -1 : 1,
    mean(raw.mbon, 2) < mean(raw.kc, 2) ? -1 : 1,
  ];
  const all = [...raw.pn, ...raw.kc, ...raw.mbon, ...raw.dan].filter(Boolean);
  // Centre: middle of the 2-98 % box. Scale: 98 % of the points inside
  // radius 1, so a few stray somata do not shrink the circuit.
  const centre = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const v = all.map(p => p[a] * sign[a]).sort((x, y) => x - y);
    centre[a] = (quantile(v, 0.02) + quantile(v, 0.98)) / 2;
  }
  const radii = all.map(p => Math.hypot(p[0] * sign[0] - centre[0], p[1] * sign[1] - centre[1], p[2] * sign[2] - centre[2])).sort((x, y) => x - y);
  const scale = 1 / Math.max(1e-6, quantile(radii, 0.98));
  let clamped = 0;
  const toLocal = (p, clampIt = true) => {
    const fp = fm(p);
    let x = (fp[0] * sign[0] - centre[0]) * scale, y = (fp[1] * sign[1] - centre[1]) * scale, z = (fp[2] * sign[2] - centre[2]) * scale;
    const r = Math.hypot(x, y, z);
    if (clampIt && clampR && r > clampR) { const k = clampR / r; x *= k; y *= k; z *= k; clamped++; }
    return [x, y, z];
  };
  const out = { sign, centre, scale, frame, toLocal };
  for (const g of ['pn', 'kc', 'mbon', 'dan']) {
    const n = C[g]?.n | 0, arr = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      const p = pick(C[g], i, keys[g]);
      const l = p ? toLocal(p) : [0, 0, 0];
      arr[3 * i] = l[0]; arr[3 * i + 1] = l[1]; arr[3 * i + 2] = l[2];
    }
    out[g] = arr;
  }
  const ap = okPos(C.apl?.[keys.apl]) ? C.apl[keys.apl] : okPos(C.apl?.cen) ? C.apl.cen : okPos(C.apl?.pos) ? C.apl.pos : null;
  out.apl = ap ? toLocal(ap) : null;
  out.clamped = clamped;
  return out;
}

// ---------------------------------------------------------------- geometry
// Flat faceted gem: each face gets one grey level from a fixed light, baked
// in the vertex colour. The instance colour multiplies it. Unlit material,
// so the colours stay exact (no tone map), and the facets read as 3D.
const LIGHT = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
export function facetGeometry(kind = 'ico') {
  const g0 = kind === 'oct' ? new THREE.OctahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, 0);
  const g = g0.index ? g0.toNonIndexed() : g0;
  const pos = g.attributes.position, n = pos.count, c = new Float32Array(3 * n);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); d.fromBufferAttribute(pos, i + 2);
    const nrm = b.sub(a).cross(d.sub(a)).normalize();
    const s = 0.52 + 0.48 * Math.max(0, nrm.dot(LIGHT));
    for (let k = 0; k < 3; k++) c.set([s, s, s], 3 * (i + k));
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  return g;
}

function instanced(geo, n, name) {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  m.count = n;
  m.name = name;
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3 * Math.max(1, n)), 3);
  m.frustumCulled = false;
  return m;
}

// Write a uniform scale + translation into instance i (no Matrix4 alloc).
function setInst(mesh, i, x, y, z, s) {
  const e = mesh.instanceMatrix.array, o = 16 * i;
  e[o] = s; e[o + 1] = 0; e[o + 2] = 0; e[o + 3] = 0;
  e[o + 4] = 0; e[o + 5] = s; e[o + 6] = 0; e[o + 7] = 0;
  e[o + 8] = 0; e[o + 9] = 0; e[o + 10] = s; e[o + 11] = 0;
  e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
}
function setCol(mesh, i, c, k = 1) {
  const a = mesh.instanceColor.array;
  a[3 * i] = c.r * k; a[3 * i + 1] = c.g * k; a[3 * i + 2] = c.b * k;
}

export function kcFamily(type) {
  const t = String(type || '');
  if (/a'b'|apbp|α′β′|α'β'|prime/i.test(t)) return 'apbp';
  if (/^KCg|γ/i.test(t)) return 'g';
  return 'ab';
}

// Compartment name -> neuropil ROI name (lobe outline that holds it).
export function compartmentRoi(name) {
  const s = String(name || '');
  if (/calyx/i.test(s)) return 'CA(R)';
  const prime = /['′]/.test(s);
  if (/^γ|^g/i.test(s)) return 'gL(R)';
  if (/^α|^a/i.test(s)) return prime ? "a'L(R)" : 'aL(R)';
  if (/^β|^b/i.test(s)) return prime ? "b'L(R)" : 'bL(R)';
  return null;
}

// KC family of a lobe or compartment (the KC type whose axons make it):
// gamma -> 'g', alpha/beta -> 'ab', alpha'/beta' -> 'apbp', else null.
export function lobeFamily(name) {
  const s = String(name || '').replace(/\(R\)|\(L\)/g, '');
  if (/calyx|^CA|^PED|ped/i.test(s)) return null;
  const prime = /['′]/.test(s);
  if (/^γ|^g/i.test(s)) return 'g';
  if (/^[αβab]/i.test(s)) return prime ? 'apbp' : 'ab';
  return null;
}

// Names and one line of plain text for the tap and hover labels.
export const ANATOMY = {
  'CA(R)': ['calyx', 'PN boutons meet KC dendrites (the claws)'],
  'PED(R)': ['peduncle', 'the bundle of KC axons'],
  'aL(R)': ['α lobe', 'KC α/β axons, compartments α1-α3'],
  'bL(R)': ['β lobe', 'KC α/β axons, compartments β1-β2'],
  "a'L(R)": ['α′ lobe', 'KC α′/β′ axons, compartments α′1-α′3'],
  "b'L(R)": ['β′ lobe', 'KC α′/β′ axons, compartments β′1-β′2'],
  'gL(R)': ['γ lobe', 'KC γ axons, compartments γ1-γ5'],
  'AL(R)': ['antennal lobe', 'odour input: PNs leave from here'],
};
const compText = name => [`compartment ${name}`, 'KC axons meet MBON dendrites; DANs gate the synapses here'];

// ---------------------------------------------------------------- neuropil
function buildNeuropil(data, place, colour) {
  const group = new THREE.Group();
  group.name = 'neuropil';
  const rois = new Map();
  const tint = col(colour).lerp(col(TOKENS.faint), 0.45);
  const alTint = col(TOKENS.faint).lerp(col(TOKENS.dim), 0.3);
  for (const r of data?.rois || []) {
    const n = r.v.length / 3, pos = new Float32Array(r.v.length);
    for (let i = 0; i < n; i++) {
      const l = place.toLocal([r.v[3 * i], r.v[3 * i + 1], r.v[3 * i + 2]], false);
      pos[3 * i] = l[0]; pos[3 * i + 1] = l[1]; pos[3 * i + 2] = l[2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(r.f);
    // lobes in the colour of their KC family, calyx and peduncle in the
    // fly colour: the anatomy reads at a glance
    const fam = lobeFamily(r.name);
    const base = r.part === 'al' ? alTint : fam ? col(KC_TYPE[fam]).lerp(col(TOKENS.faint), 0.3) : tint;
    const edges = new THREE.EdgesGeometry(geo, 28);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: base.clone(), transparent: true, opacity: r.part === 'al' ? 0.35 : 0.7, depthWrite: false, toneMapped: false }));
    line.name = 'roi:' + r.name;
    const skin = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: r.part === 'al' ? 0.025 : 0.05, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    skin.name = 'skin:' + r.name;
    skin.renderOrder = -1;
    group.add(skin, line);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += pos[3 * i]; cy += pos[3 * i + 1]; cz += pos[3 * i + 2]; }
    rois.set(r.name, { line, skin, base: base.clone(), part: r.part, tris: r.f.length / 3, centre: [cx / n, cy / n, cz / n] });
  }
  return { group, rois };
}

// Fetch the neuropil json that matches the frame of this connectome, or
// null. base: the url of the data folder (default '../data/' from ui/fly3d
// is wrong for a page, so pass it: new URL('./data/', import.meta.url)).
export async function loadNeuropil(connectome, base) {
  const frame = detectFrame(connectome);
  if (frame !== 'hemibrain') return null;
  try {
    const r = await fetch(new URL('neuropil-hemibrain.json', base));
    if (!r.ok) return null;
    const j = await r.json();
    return j?.meta?.frame === frame ? j : null;
  } catch { return null; }
}

// ================================================================ the map
// opts: { colour (fly colour), size (group radius, default 1), lite (phone:
// octahedra, fewer spikes), neuropil (json or null), duration (s, 1.4),
// reducedMotion, kcColour: 'type' | 'flat', keys: { pn, kc, mbon, dan,
// apl } position keys, frame, clampRadius (1.2) }.
export function createBrainMap(connectome, opts = {}) {
  const C = connectome;
  if (!C || !C.kc || !C.pn || !C.mbon) throw new Error('createBrainMap: connectome needs pn, kc and mbon');
  const o = {
    colour: TOKENS.flyA, size: 1, lite: false, neuropil: null, duration: 1.4,
    reducedMotion: false, kcColour: 'type', frame: detectFrame(C), clampRadius: 1.2, holdOut: HOLD_ALPHA, restEdges: 1, ...opts,
  };
  const keys = { pn: 'pos', kc: 'pos', mbon: 'cen', dan: 'cen', apl: 'cen', ...(opts.keys || {}) };
  const place = placeAll(C, keys, o.frame, o.clampRadius);
  const nPN = C.pn.n | 0, nKC = C.kc.n | 0, nM = C.mbon.n | 0, nD = C.dan?.n | 0;

  const group = new THREE.Group();
  group.name = 'brain-map';
  group.scale.setScalar(o.size);

  // ---- colours
  const K = {
    pn: col(TOKENS.pn), faint: col(TOKENS.faint), kcOff: col(TOKENS['kc-off']), kcOn: col(TOKENS['kc-on']),
    app: col(TOKENS.app), avoid: col(TOKENS.avoid), none: col(TOKENS.none), ink: col(TOKENS.ink), dim: col(TOKENS.dim),
    fly: col(o.colour),
  };
  const famCol = {};
  for (const f of ['ab', 'apbp', 'g']) famCol[f] = col(KC_TYPE[f]).lerp(K.kcOff, 0.74);
  const kcFam = Array.from({ length: nKC }, (_, i) => kcFamily(C.kc.types?.[i]));
  const kcSilent = i => (o.kcColour === 'type' ? famCol[kcFam[i]] : K.kcOff);
  const valCol = j => { const v = Math.sign(+C.mbon.valence?.[j] || 0); return v > 0 ? K.app : v < 0 ? K.avoid : K.none; };
  const danCol = d => { const c = String(C.dan?.cluster?.[d] || ''); return c === 'PAM' ? K.app : c === 'PPL1' ? K.avoid : K.none; };

  // ---- sizes (group units, radius 1)
  const R = { kc: 0.0105, kcOn: 0.022, pn: 0.016, pnOn: 0.012, mbon: 0.02, mbonOn: 0.028, dan: 0.0085, danOn: 0.018 };

  // ---- neurons
  const gemKc = facetGeometry(o.lite ? 'oct' : 'ico'), gem = facetGeometry('ico');
  const kcMesh = instanced(gemKc, nKC, 'kc');
  const pnMesh = instanced(gem, nPN, 'pn');
  const mbMesh = instanced(gem, nM, 'mbon');
  const danMesh = instanced(gem, nD, 'dan');
  const P = place;
  const resetKc = i => { setInst(kcMesh, i, P.kc[3 * i], P.kc[3 * i + 1], P.kc[3 * i + 2], R.kc); setCol(kcMesh, i, kcSilent(i)); };
  const resetPn = i => { setInst(pnMesh, i, P.pn[3 * i], P.pn[3 * i + 1], P.pn[3 * i + 2], R.pn); setCol(pnMesh, i, K.faint, 1.15); };
  const resetMb = i => { setInst(mbMesh, i, P.mbon[3 * i], P.mbon[3 * i + 1], P.mbon[3 * i + 2], R.mbon); setCol(mbMesh, i, valCol(i), 0.42); };
  const resetDan = i => { setInst(danMesh, i, P.dan[3 * i], P.dan[3 * i + 1], P.dan[3 * i + 2], R.dan); setCol(danMesh, i, K.faint, 1.2); };
  for (let i = 0; i < nKC; i++) resetKc(i);
  for (let i = 0; i < nPN; i++) resetPn(i);
  for (let i = 0; i < nM; i++) resetMb(i);
  for (let i = 0; i < nD; i++) resetDan(i);
  group.add(kcMesh, pnMesh, mbMesh, danMesh);

  // ---- APL: one wire cage
  let apl = null;
  if (P.apl) {
    apl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.055, 0)),
      new THREE.LineBasicMaterial({ color: K.dim.clone(), toneMapped: false }));
    apl.position.set(...P.apl);
    apl.name = 'apl';
    group.add(apl);
  }

  // ---- edges
  const validEdge = (e, na, nb) => Array.isArray(e) && e[0] >= 0 && e[0] < na && e[1] >= 0 && e[1] < nb;
  const pnKc = (C.edges?.pn_kc || []).filter(e => validEdge(e, nPN, nKC));
  const kcMb = (C.edges?.kc_mbon || []).filter(e => validEdge(e, nKC, nM));
  function edgeLines(list, A, B, base, alpha, name) {
    const n = list.length, pos = new Float32Array(6 * n), c = new Float32Array(8 * n), len = new Float32Array(n);
    let maxLen = 1e-6;
    for (let e = 0; e < n; e++) {
      const a = list[e][0], b = list[e][1];
      pos.set([A[3 * a], A[3 * a + 1], A[3 * a + 2], B[3 * b], B[3 * b + 1], B[3 * b + 2]], 6 * e);
      len[e] = Math.hypot(B[3 * b] - A[3 * a], B[3 * b + 1] - A[3 * a + 1], B[3 * b + 2] - A[3 * a + 2]);
      if (len[e] > maxLen) maxLen = len[e];
      c.set([base.r, base.g, base.b, alpha, base.r, base.g, base.b, alpha], 8 * e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ca = new THREE.BufferAttribute(c, 4);
    ca.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', ca);
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
    const line = new THREE.LineSegments(geo, mat);
    line.name = name;
    line.frustumCulled = false;
    return { line, list, pos, col: ca, base: c.slice(), len, maxLen };
  }
  const E1 = edgeLines(pnKc, P.pn, P.kc, K.pn.clone().lerp(K.faint, 0.35), (o.lite ? 0.022 : 0.03) * o.restEdges, 'pn-kc');
  const E2 = edgeLines(kcMb, P.kc, P.mbon, K.dim.clone().lerp(K.faint, 0.4), (o.lite ? 0.014 : 0.02) * o.restEdges, 'kc-mbon');
  group.add(E1.line, E2.line);
  // edges of each KC (for lookup at fire time)
  const byKc = (list, at) => {
    const ptr = new Int32Array(nKC + 1);
    for (const e of list) ptr[e[at] + 1]++;
    for (let i = 0; i < nKC; i++) ptr[i + 1] += ptr[i];
    const fill = ptr.slice(0, nKC), idx = new Int32Array(list.length);
    list.forEach((e, k) => { idx[fill[e[at]]++] = k; });
    return { ptr, idx };
  };
  const kcIn = byKc(pnKc, 1), kcOut = byKc(kcMb, 0);

  // ---- spikes
  const spikeN = Math.min(o.lite ? 2500 : SPIKE_MAX, pnKc.length + kcMb.length);
  const spGeo = new THREE.BufferGeometry();
  const spPos = new THREE.BufferAttribute(new Float32Array(3 * Math.max(1, spikeN)), 3).setUsage(THREE.DynamicDrawUsage);
  const spCol = new THREE.BufferAttribute(new Float32Array(3 * Math.max(1, spikeN)), 3).setUsage(THREE.DynamicDrawUsage);
  spGeo.setAttribute('position', spPos); spGeo.setAttribute('color', spCol);
  spGeo.setDrawRange(0, 0);
  const spikes = new THREE.Points(spGeo, new THREE.PointsMaterial({ size: o.lite ? 2.5 : 3, sizeAttenuation: false, vertexColors: true, toneMapped: false, depthWrite: false, transparent: true }));
  spikes.name = 'spikes';
  spikes.frustumCulled = false;
  group.add(spikes);
  // a short tail behind each spike (a crisp streak along its edge)
  const tlGeo = new THREE.BufferGeometry();
  const tlPos = new THREE.BufferAttribute(new Float32Array(6 * Math.max(1, spikeN)), 3).setUsage(THREE.DynamicDrawUsage);
  const tlCol = new THREE.BufferAttribute(new Float32Array(6 * Math.max(1, spikeN)), 3).setUsage(THREE.DynamicDrawUsage);
  tlGeo.setAttribute('position', tlPos); tlGeo.setAttribute('color', tlCol);
  tlGeo.setDrawRange(0, 0);
  const tails = new THREE.LineSegments(tlGeo, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false, depthWrite: false, transparent: true }));
  tails.name = 'spike-tails'; tails.frustumCulled = false;
  group.add(tails);
  // the active KCs as bright sparse points (the sparse code), with a
  // short flash when the KC set forms
  const kfGeo = new THREE.BufferGeometry();
  const kfPos = new THREE.BufferAttribute(new Float32Array(3 * Math.max(1, nKC)), 3).setUsage(THREE.DynamicDrawUsage);
  kfGeo.setAttribute('position', kfPos); kfGeo.setDrawRange(0, 0);
  const KF_SIZE = o.lite ? 3 : 4;
  const kcFire = new THREE.Points(kfGeo, new THREE.PointsMaterial({ color: K.kcOn.clone(), size: KF_SIZE, sizeAttenuation: false, toneMapped: false, depthWrite: false }));
  kcFire.name = 'kc-fire'; kcFire.frustumCulled = false;
  group.add(kcFire);

  // ---- compartments: centroid of their DANs (else MBONs), shell per burst
  const compNames = [...new Set([...(C.mbon.compartment || []), ...(C.dan?.compartment || [])].filter(Boolean).map(String))];
  const comps = compNames.map(name => {
    let s = [0, 0, 0], n = 0;
    const add = (arr, i) => { s[0] += arr[3 * i]; s[1] += arr[3 * i + 1]; s[2] += arr[3 * i + 2]; n++; };
    for (let d = 0; d < nD; d++) if (String(C.dan.compartment?.[d]) === name) add(P.dan, d);
    if (!n) for (let j = 0; j < nM; j++) if (String(C.mbon.compartment?.[j]) === name) add(P.mbon, j);
    const shell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: K.app.clone(), toneMapped: false }));
    shell.visible = false;
    shell.name = 'burst:' + name;
    if (n) shell.position.set(s[0] / n, s[1] / n, s[2] / n);
    group.add(shell);
    return { name, shell, roi: compartmentRoi(name), on: false, strength: 0, colour: K.app };
  });
  // a small wire marker at each compartment, in its lobe colour (a
  // FlyWire file has no neuropil meshes: the markers still show the lobes)
  const markGeo = new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.034, 0));
  for (const c of comps) {
    const fam = lobeFamily(c.name);
    c.rest = fam ? col(KC_TYPE[fam]).lerp(K.faint, 0.15) : K.fly.clone().lerp(K.faint, 0.3);
    c.marker = new THREE.LineSegments(markGeo, new THREE.LineBasicMaterial({ color: c.rest.clone(), toneMapped: false }));
    c.marker.position.copy(c.shell.position);
    c.marker.name = 'comp:' + c.name;
    group.add(c.marker);
  }
  const compIdx = new Map(compNames.map((n, i) => [n, i]));
  const danComp = Int32Array.from({ length: nD }, (_, d) => compIdx.get(String(C.dan.compartment?.[d])) ?? -1);

  // ---- neuropil
  let np = null;
  function setNeuropil(data) {
    if (np) { group.remove(np.group); disposeTree(np.group); np = null; }
    if (!data || (data.meta?.frame && data.meta.frame !== o.frame)) return false;
    np = buildNeuropil(data, place, o.colour);
    group.add(np.group);
    return true;
  }
  if (o.neuropil) setNeuropil(o.neuropil);

  // ---------------------------------------------------------------- state
  const S = {
    t: 0, T: o.duration, on: false, trace: null, delta: 0,
    pnRate: new Float32Array(nPN), kcActive: new Uint8Array(nKC), kcList: [],
    mbonRate: new Float32Array(nM), mbonRel: new Float32Array(nM),
    danBurst: new Float32Array(nD), danList: [], burstSign: 0, burstK: 0,
    litE1: new Int32Array(0), litE2: new Int32Array(0), prevE1: new Int32Array(0), prevE2: new Int32Array(0),
    prevKc: [], fires: 0,
  };

  function restoreEdges(E, lit) {
    const c = E.col.array;
    for (const e of lit) c.set(E.base.subarray(8 * e, 8 * e + 8), 8 * e);
  }

  // trace: the brain/fly.js choose() trace. delta: TD error (default
  // trace.delta). fopts: { instant }.
  function fire(trace, delta, fopts = {}) {
    if (!trace) return lit();
    const d = Number.isFinite(delta) ? delta : Number.isFinite(trace.delta) ? trace.delta : 0;
    // undo the last decision
    for (const i of S.prevKc) resetKc(i);
    for (let i = 0; i < nPN; i++) resetPn(i);
    for (let i = 0; i < nM; i++) resetMb(i);
    for (const i of S.danList) resetDan(i);
    restoreEdges(E1, S.litE1); restoreEdges(E2, S.litE2);
    for (const c of comps) { c.on = false; c.shell.visible = false; c.marker.material.color.copy(c.rest); }
    if (np) for (const r of np.rois.values()) r.line.material.color.copy(r.base);
    // new decision
    S.trace = trace; S.delta = d; S.fires++;
    S.pnRate.fill(0);
    const pn = trace.pn || [];
    for (let i = 0; i < Math.min(nPN, pn.length); i++) S.pnRate[i] = Number.isFinite(pn[i]) ? clamp01(pn[i]) : 0;
    S.kcActive.fill(0);
    const kl = [];
    for (const k of trace.kc || []) if (k >= 0 && k < nKC && !S.kcActive[k]) { S.kcActive[k] = 1; kl.push(k); }
    S.kcList = kl;
    for (let j = 0; j < kl.length; j++) { const i = kl[j]; kfPos.array[3 * j] = P.kc[3 * i]; kfPos.array[3 * j + 1] = P.kc[3 * i + 1]; kfPos.array[3 * j + 2] = P.kc[3 * i + 2]; }
    kfPos.needsUpdate = true;
    kfGeo.setDrawRange(0, 0);
    let mx = 0;
    S.mbonRate.fill(0);
    const mb = trace.mbon || [];
    for (let j = 0; j < Math.min(nM, mb.length); j++) { const v = Number.isFinite(mb[j]) ? Math.max(0, mb[j]) : 0; S.mbonRate[j] = v; if (v > mx) mx = v; }
    for (let j = 0; j < nM; j++) S.mbonRel[j] = mx > 0 ? S.mbonRate[j] / mx : 0;
    // lit edges: the claws into and the synapses out of the active KCs
    const l1 = [], l2 = [];
    for (const k of kl) {
      for (let p = kcIn.ptr[k]; p < kcIn.ptr[k + 1]; p++) l1.push(kcIn.idx[p]);
      for (let p = kcOut.ptr[k]; p < kcOut.ptr[k + 1]; p++) l2.push(kcOut.idx[p]);
    }
    S.litE1 = Int32Array.from(l1); S.litE2 = Int32Array.from(l2);
    // DAN burst
    S.danBurst.fill(0);
    const dl = [];
    if (Math.abs(d) > DAN_MIN) {
      const dan = trace.dan || [];
      for (let i = 0; i < Math.min(nD, dan.length); i++) if (dan[i] > 0) { S.danBurst[i] = dan[i]; dl.push(i); }
      if (!dl.length) {   // learning off: no per-DAN signal. Use the cluster rule of brain/mb.js.
        const want = d > 0 ? 'PAM' : 'PPL1';
        for (let i = 0; i < nD; i++) if (C.dan.cluster?.[i] === want) { S.danBurst[i] = Math.abs(d); dl.push(i); }
      }
    }
    S.danList = dl;
    S.burstSign = Math.sign(d);
    S.burstK = clamp01(Math.abs(d) * 4);
    for (const i of dl) { const c = danComp[i]; if (c >= 0) { comps[c].on = true; comps[c].colour = danCol(i); } }
    S.prevKc = kl;
    S.t = 0; S.on = true;
    if (fopts.instant || o.reducedMotion) S.t = S.T;
    apply();
    return lit();
  }

  // Counts of what is lit now (or at the end of the running sequence).
  function lit() {
    let pn = 0;
    for (let i = 0; i < nPN; i++) if (S.pnRate[i] >= PN_ON) pn++;
    let mbon = 0;
    for (let j = 0; j < nM; j++) if (S.mbonRate[j] > 0) mbon++;
    return {
      pn, kc: S.kcList.length, mbon, dan: S.danList.length,
      pnKc: S.litE1.length, kcMbon: S.litE2.length,
      compartments: comps.filter(c => c.on).map(c => c.name),
      delta: S.delta, fires: S.fires, running: S.on,
    };
  }

  // Write the buffers for time S.t.
  function apply() {
    const p = Math.min(1, S.t / S.T), done = p >= 1;
    // PNs
    const pOn = ramp(p, ...PHASE.pnOn);
    for (let i = 0; i < nPN; i++) {
      const r = S.pnRate[i] * pOn;
      if (r <= 0) continue;
      setInst(pnMesh, i, P.pn[3 * i], P.pn[3 * i + 1], P.pn[3 * i + 2], R.pn + R.pnOn * r);
      const c = K.faint.clone().lerp(K.pn, Math.min(1, 0.25 + Math.ceil(r * 4) / 4));
      setCol(pnMesh, i, c);
    }
    // edges + spikes
    let ns = 0;
    const sp = spPos.array, sc = spCol.array;
    const run = (E, litE, win, cA, cB, alphaOf, hold = HOLD_ALPHA) => {
      const c = E.col.array;
      for (const e of litE) {
        const end = win[0] + (win[1] - win[0]) * (E.len[e] / E.maxLen);
        const u = done ? 1 : ramp(p, win[0], Math.max(win[0] + 1e-4, end));
        const a0 = alphaOf(e);
        if (u <= 0) continue;
        const aH = done ? hold * a0 : a0;
        const cb = typeof cB === "function" ? cB(e) : cB;
        c[8 * e] = cA.r; c[8 * e + 1] = cA.g; c[8 * e + 2] = cA.b; c[8 * e + 3] = aH;
        c[8 * e + 4] = cb.r; c[8 * e + 5] = cb.g; c[8 * e + 6] = cb.b; c[8 * e + 7] = aH * (0.15 + 0.85 * u);
        if (u < 1 && ns < spikeN) {
          const q = E.pos, o6 = 6 * e;
          sp[3 * ns] = q[o6] + (q[o6 + 3] - q[o6]) * u;
          sp[3 * ns + 1] = q[o6 + 1] + (q[o6 + 4] - q[o6 + 1]) * u;
          sp[3 * ns + 2] = q[o6 + 2] + (q[o6 + 5] - q[o6 + 2]) * u;
          sc[3 * ns] = cb.r; sc[3 * ns + 1] = cb.g; sc[3 * ns + 2] = cb.b;
          const ut = Math.max(0, u - 0.12 * E.maxLen / Math.max(1e-6, E.len[e]) * 0.5);
          const tp = tlPos.array, tc = tlCol.array, o12 = 6 * ns;
          tp[o12] = q[o6] + (q[o6 + 3] - q[o6]) * ut; tp[o12 + 1] = q[o6 + 1] + (q[o6 + 4] - q[o6 + 1]) * ut; tp[o12 + 2] = q[o6 + 2] + (q[o6 + 5] - q[o6 + 2]) * ut;
          tp[o12 + 3] = sp[3 * ns]; tp[o12 + 4] = sp[3 * ns + 1]; tp[o12 + 5] = sp[3 * ns + 2];
          tc[o12] = cA.r * 0.5; tc[o12 + 1] = cA.g * 0.5; tc[o12 + 2] = cA.b * 0.5; tc[o12 + 3] = cb.r; tc[o12 + 4] = cb.g; tc[o12 + 5] = cb.b;
          ns++;
        }
      }
    };
    run(E1, S.litE1, PHASE.pnKc, K.pn, K.kcOn, e => 0.25 + 0.75 * S.pnRate[E1.list[e][0]]);
    if (p >= PHASE.kcMbon[0] || done) run(E2, S.litE2, PHASE.kcMbon, K.kcOn, e => valCol(E2.list[e][1]), () => 0.8, o.holdOut);
    spGeo.setDrawRange(0, done ? 0 : ns);
    tlGeo.setDrawRange(0, done ? 0 : 2 * ns);
    spPos.needsUpdate = spCol.needsUpdate = true;
    tlPos.needsUpdate = tlCol.needsUpdate = true;
    E1.col.needsUpdate = E2.col.needsUpdate = true;
    // KCs: one cut
    const kcOn = done || p >= PHASE.kcOn;
    kfGeo.setDrawRange(0, kcOn ? S.kcList.length : 0);
    kcFire.material.size = !done && p >= PHASE.kcOn && p < PHASE.kcOn + 0.06 ? KF_SIZE * 1.75 : KF_SIZE;
    for (const i of S.kcList) {
      if (kcOn) { setInst(kcMesh, i, P.kc[3 * i], P.kc[3 * i + 1], P.kc[3 * i + 2], R.kcOn); setCol(kcMesh, i, K.kcOn); } else resetKc(i);
    }
    if (apl) {
      const flash = !done && p >= PHASE.kcOn && p < PHASE.kcOn + 0.08;
      apl.material.color.copy(flash ? K.ink : K.dim);
      apl.scale.setScalar(flash ? 1.25 : 1);
    }
    // MBONs
    const mOn = done ? 1 : ramp(p, ...PHASE.mbon);
    for (let j = 0; j < nM; j++) {
      const r = S.mbonRel[j] * mOn;
      setInst(mbMesh, j, P.mbon[3 * j], P.mbon[3 * j + 1], P.mbon[3 * j + 2], R.mbon + R.mbonOn * r);
      setCol(mbMesh, j, valCol(j), 0.42 + 0.58 * Math.min(1, r * 1.5));
    }
    // DAN burst (inside its window only, then cut)
    const inBurst = !done && p >= PHASE.dan[0];
    const bu = ramp(p, ...PHASE.dan);
    for (const i of S.danList) {
      if (inBurst) { setInst(danMesh, i, P.dan[3 * i], P.dan[3 * i + 1], P.dan[3 * i + 2], R.dan + R.danOn * (0.4 + 0.6 * S.burstK)); setCol(danMesh, i, danCol(i)); } else resetDan(i);
    }
    for (const c of comps) {
      const show = c.on && inBurst;
      c.shell.visible = show;
      if (show) { c.shell.scale.setScalar(0.02 + (0.06 + 0.1 * S.burstK) * bu); c.shell.material.color.copy(c.colour); }
      c.marker.material.color.copy(c.on && (show || done) ? c.colour : c.rest);
      const r = np && c.roi && np.rois.get(c.roi);
      if (r && c.on) r.line.material.color.copy(show ? c.colour : r.base);
    }
    kcMesh.instanceMatrix.needsUpdate = kcMesh.instanceColor.needsUpdate = true;
    pnMesh.instanceMatrix.needsUpdate = pnMesh.instanceColor.needsUpdate = true;
    mbMesh.instanceMatrix.needsUpdate = mbMesh.instanceColor.needsUpdate = true;
    danMesh.instanceMatrix.needsUpdate = danMesh.instanceColor.needsUpdate = true;
    if (done) S.on = false;
  }

  // dt in seconds. Returns true when something changed (render needed).
  function update(dt) {
    if (!S.on) return false;
    S.t += Math.max(0, Number.isFinite(dt) ? dt : 0);
    apply();
    return true;
  }

  function setDuration(s) { if (s > 0) S.T = o.duration = s; }
  function setReducedMotion(v) { o.reducedMotion = !!v; }
  function setKcColour(mode) {
    o.kcColour = mode === 'flat' ? 'flat' : 'type';
    for (let i = 0; i < nKC; i++) if (!S.kcActive[i] || S.on) resetKc(i);
    apply();
  }

  // Triangles and line counts (for the scene budget).
  function stats() {
    const tri = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
    let tris = tri(gemKc) * nKC + tri(gem) * (nPN + nM + nD);
    if (np) for (const r of np.rois.values()) tris += r.tris;
    return {
      tris, lines: pnKc.length + kcMb.length, pn: nPN, kc: nKC, mbon: nM, dan: nD,
      apl: !!apl, neuropil: np ? [...np.rois.keys()] : [], frame: o.frame, sign: place.sign,
      clamped: place.clamped, compartments: compNames.length, spikes: spikeN,
    };
  }

  function dispose() {
    disposeTree(group);
    if (group.parent) group.parent.remove(group);
  }

  // Label anchors in group space: the neuropil parts (when loaded) and
  // every compartment. { key, title, text, pos: [x,y,z], colour, kind }.
  function anchors() {
    const out = [];
    if (np) for (const [name, r] of np.rois) {
      const a = ANATOMY[name]; if (!a) continue;
      out.push({ key: name, title: a[0], text: a[1], pos: r.centre, colour: '#' + r.base.getHexString(), kind: 'roi' });
    }
    for (const c of comps) {
      const t = compText(c.name);
      out.push({ key: 'comp:' + c.name, title: t[0], text: t[1], pos: c.marker.position.toArray(), colour: '#' + c.rest.getHexString(), kind: 'compartment' });
    }
    const cen = arr => { let x = 0, y = 0, z = 0; const n = arr.length / 3; for (let i = 0; i < n; i++) { x += arr[3 * i]; y += arr[3 * i + 1]; z += arr[3 * i + 2]; } return n ? [x / n, y / n, z / n] : [0, 0, 0]; };
    out.push({ key: 'KC', title: 'Kenyon cells', text: `${nKC} KCs; about 5 % fire for one board (sparse code)`, pos: cen(P.kc), colour: TOKENS['kc-on'], kind: 'cells' });
    out.push({ key: 'PN', title: 'projection neurons', text: `${nPN} PNs carry the board "smell" into the calyx`, pos: cen(P.pn), colour: TOKENS.pn, kind: 'cells' });
    return out;
  }
  // The anchor nearest to a screen point (px), within maxPx, or null.
  // camera: the camera that draws the map; w, h: the canvas size in px.
  const _pv = new THREE.Vector3();
  function pickScreen(x, y, camera, w, h, maxPx = 26) {
    group.updateWorldMatrix(true, false);
    let best = null, bd = maxPx;
    for (const a of anchors()) {
      _pv.set(a.pos[0], a.pos[1], a.pos[2]).applyMatrix4(group.matrixWorld).project(camera);
      if (_pv.z > 1) continue;
      const sx = (_pv.x * 0.5 + 0.5) * w, sy = (1 - (_pv.y * 0.5 + 0.5)) * h;
      const d = Math.hypot(sx - x, sy - y) - (a.kind === 'roi' ? 8 : 0);
      if (d < bd) { bd = d; best = { ...a, x: sx, y: sy }; }
    }
    return best;
  }

  return {
    group, fire, update, lit, dispose, stats, setNeuropil, setDuration, setReducedMotion, setKcColour, anchors, pickScreen,
    get running() { return S.on; },
    meshes: { kc: kcMesh, pn: pnMesh, mbon: mbMesh, dan: danMesh, apl, pnKc: E1.line, kcMbon: E2.line, spikes, tails, kcFire, markers: comps.map(c => c.marker) },
    place,
  };
}

function disposeTree(root) {
  root.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => { m.map?.dispose(); m.dispose(); });
  });
}

// ================================================================ the view
// A brain map in its own canvas with orbit. DOM + WebGL. opts: as
// createBrainMap, plus { neuropil, labels (true), background (--fig),
// maxDpr (2) }. No idle rotation, no inertia (DESIGN.md 5.6). Drag turns,
// double-click resets, arrow keys turn by 0.1 rad, Home resets. Renders
// only when the map runs or the view changed, and only on screen.
export function createBrainView(canvas, connectome, opts = {}) {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const o = { lite: coarse, reducedMotion: reduce, labels: true, background: TOKENS.fig, maxDpr: coarse ? 1.5 : 2, ...opts };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, o.maxDpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(o.background);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 40);
  const map = createBrainMap(connectome, { ...o, size: 1 });
  scene.add(map.group);

  // start view: from the medial side, a little anterior and dorsal, so
  // the KC cap, the peduncle and the lobes stand apart (yaw 1.25 rad)
  const START = { yaw: 1.25, pitch: 0.3, dist: 3.4 };
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.autoRotate = false;
  controls.minDistance = 2; controls.maxDistance = 8;
  controls.minPolarAngle = Math.PI / 2 - 1.0; controls.maxPolarAngle = Math.PI / 2 + 1.0;
  canvas.style.touchAction = o.touchAction || 'pan-y';
  const reset = () => {
    const { yaw, pitch, dist } = START;
    camera.position.set(dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw));
    controls.target.set(0, 0, 0);
    controls.update();
    dirty = true;
  };
  let dirty = true;
  controls.addEventListener('change', () => { dirty = true; });

  // labels: crisp text sprites, fixed screen size
  const labels = o.labels ? regionLabels(map) : [];
  let tip = null;
  const sizeLabels = h => sizeSprites(labels, camera, h);

  function resize() {
    const w = canvas.clientWidth || canvas.width || 300, h = canvas.clientHeight || canvas.height || 200;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    sizeLabels(h);
    tip?.resize(h);
    dirty = true;
  }

  // keyboard
  if (canvas.tabIndex < 0) canvas.tabIndex = 0;
  const turn = (dy, dp) => {
    const off = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta += dy;
    sph.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sph.phi - dp));
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
    camera.lookAt(controls.target);
    controls.update();
    dirty = true;
  };
  const onKey = e => {
    const k = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[e.key];
    if (k) { turn(...k); e.preventDefault(); } else if (e.key === 'Home') { reset(); e.preventDefault(); }
  };
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('dblclick', reset);
  tip = anatomyTips(map, canvas, camera, () => { dirty = true; kick(); }, h => sizeTip(h));
  const sizeTip = h => { const s = tip.sprite(); if (!s) return; const k = (s.userData.px / Math.max(1, h)) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)); s.scale.set(k * s.userData.aspect, k, 1); };

  // loop: only when visible
  let raf = 0, last = 0, visible = true, alive = true;
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); if (visible) kick(); }) : null;
  io?.observe(canvas);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(canvas);
  function frame(now) {
    raf = 0;
    if (!alive) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const changed = map.update(dt);
    if (changed || dirty) { renderer.render(scene, camera); dirty = false; }
    if (map.running && visible) kick(); else last = 0;
  }
  function kick() { if (!raf && alive) raf = requestAnimationFrame(frame); }
  controls.addEventListener('change', kick);

  reset();
  resize();
  kick();
  return {
    map, scene, camera, renderer, controls,
    fire(trace, delta, fo) { const r = map.fire(trace, delta, fo); dirty = true; kick(); return r; },
    resize, reset,
    render() { renderer.render(scene, camera); dirty = false; },
    setNeuropil(d) { const r = map.setNeuropil(d); dirty = true; kick(); return r; },
    dispose() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect(); ro?.disconnect();
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('dblclick', reset);
      tip.dispose();
      controls.dispose();
      map.dispose();
      renderer.dispose();
    },
  };
}

// The group labels PN, KC, MBON, DAN and APL at the centroid of each
// group, as text sprites in map.group. Returns the sprites (size them
// with sizeSprites). No DOM (node): no labels.
export function regionLabels(map) {
  const labels = [];
  if (typeof document === 'undefined') return labels;
  const P = map.place;
  const centroid = (arr) => { let x = 0, y = 0, z = 0; const n = arr.length / 3; for (let i = 0; i < n; i++) { x += arr[3 * i]; y += arr[3 * i + 1]; z += arr[3 * i + 2]; } return n ? [x / n, y / n, z / n] : [0, 0, 0]; };
  const add = (text, p, colour, dy = 0.08) => {
    const s = textSprite(text, colour);
    s.position.set(p[0], p[1] + dy, p[2]);
    map.group.add(s); labels.push(s);
  };
  add('PN', centroid(P.pn), TOKENS.pn);
  add('KC', centroid(P.kc), TOKENS.ink2, 0.22);
  add('MBON', centroid(P.mbon), TOKENS.dim, -0.12);
  add('DAN', centroid(P.dan), TOKENS.dim, 0.18);
  if (P.apl) add('APL', P.apl, TOKENS.dim, 0.1);
  return labels;
}

// Size screen-fixed sprites for a canvas of height h (CSS px): px is the
// text height on the screen.
export function sizeSprites(sprites, camera, h, px = 12) {
  const k = (px / Math.max(1, h)) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (const s of sprites) s.scale.set(k * s.userData.aspect, k, 1);
}

// A crisp text label as a sprite (screen-size, set by the view).
export function textSprite(text, colour) {
  const px = 48, c = document.createElement('canvas'), g = c.getContext('2d');
  const fontStr = `500 ${px}px Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`;
  g.font = fontStr;
  const w = Math.ceil(g.measureText(text).width) + 8;
  c.width = w; c.height = px + 12;
  g.font = fontStr;
  g.fillStyle = colour;
  g.textBaseline = 'middle';
  g.fillText(text, 4, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true, toneMapped: false }));
  s.userData.aspect = c.width / c.height;
  s.renderOrder = 10;
  s.name = 'label:' + text;
  return s;
}

// A label of two lines (title, text) as a sprite. lines: 2 (for sizing).
function labelSprite(title, text, colour) {
  const px = 40, c = document.createElement('canvas'), g = c.getContext('2d');
  const f1 = `600 ${px}px Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`;
  const f2 = `400 ${Math.round(px * 0.72)}px Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`;
  g.font = f1; const w1 = g.measureText(title).width;
  g.font = f2; const w2 = g.measureText(text).width;
  c.width = Math.ceil(Math.max(w1, w2)) + 28; c.height = Math.round(px * 2.3);
  g.fillStyle = TOKENS.panel; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = colour; g.fillRect(0, 0, 6, c.height);
  g.strokeStyle = TOKENS.hair2; g.lineWidth = 2; g.strokeRect(1, 1, c.width - 2, c.height - 2);
  g.textBaseline = 'middle';
  g.font = f1; g.fillStyle = TOKENS.ink; g.fillText(title, 16, px * 0.62);
  g.font = f2; g.fillStyle = TOKENS.ink2; g.fillText(text, 16, px * 1.62);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true, toneMapped: false }));
  s.center.set(0, 0);
  s.userData.aspect = c.width / c.height; s.userData.px = 34;
  s.renderOrder = 20; s.name = 'tip:' + title;
  return s;
}

// Hover (mouse) and tap (touch) labels on a brain map in its own canvas:
// the nearest anatomy anchor (map.pickScreen) gets a label with its name
// and one line of text. A tap label stays 3 s. onChange: redraw.
export function anatomyTips(map, canvas, camera, onChange, onSize) {
  if (typeof document === 'undefined' || !canvas?.addEventListener) return { dispose() {}, resize() {}, sprite: () => null, show() {} };
  let sprite = null, key = null, timer = 0;
  const hide = () => { if (sprite) { map.group.remove(sprite); sprite.material.map?.dispose(); sprite.material.dispose(); sprite = null; key = null; onChange(); } };
  const show = a => {
    if (!a) { hide(); return; }
    if (a.key === key) return;
    hide();
    sprite = labelSprite(a.title, a.text, a.colour);
    sprite.position.set(a.pos[0], a.pos[1], a.pos[2]);
    map.group.add(sprite); key = a.key;
    onSize(canvas.clientHeight || canvas.height || 200);
    onChange();
  };
  const at = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r.width, r.height]; };
  const move = e => { if (e.pointerType === 'touch') return; const [x, y, w, h] = at(e); show(map.pickScreen(x, y, camera, w, h)); };
  let down = null;
  const pdown = e => { down = [e.clientX, e.clientY]; };
  const up = e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) { down = null; return; }
    down = null;
    const [x, y, w, h] = at(e);
    const a = map.pickScreen(x, y, camera, w, h, e.pointerType === 'touch' ? 40 : 26);
    show(a);
    clearTimeout(timer);
    if (a && e.pointerType === 'touch') timer = setTimeout(hide, 3000);
  };
  const leave = () => hide();
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', pdown);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointerleave', leave);
  return {
    sprite: () => sprite, show: a => show(a),
    resize: h => onSize(h),
    dispose() {
      clearTimeout(timer);
      canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', pdown);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointerleave', leave);
      hide();
    },
  };
}

// ================================================================ the card
// A small live brain panel for the scorecards of the HUD (play agent):
// createBrainCard(canvas, connectome, opts) -> { map, fire(trace, delta,
// fo), update(dt) -> bool, resize(), render(), pick(x, y), dispose() }.
// Cheap: its own small WebGL canvas, the lite map on a phone (octahedra,
// fewer spikes), pixel ratio 1 on a phone and no orbit. The host can call
// update(dt) from its own loop: the first call turns the card loop off.
// Else a small card loop runs while the map runs. The card draws only
// when the map runs or the view changed. A fixed three-quarter view shows
// the calyx at the top and the lobes at the front. Hover (mouse) or tap
// (touch) shows the anatomy label of the nearest part. canvas null or
// opts.headless: no renderer (node tests); fire and update still run.
// opts: as createBrainMap, plus { coarse, neuropil, background, view:
// { yaw, pitch, dist } }.
export function createBrainCard(canvas, connectome, opts = {}) {
  const mm = q => (typeof matchMedia === 'function' ? matchMedia(q).matches : false);
  const coarse = opts.coarse ?? mm('(pointer: coarse)');
  const reduce = opts.reducedMotion ?? mm('(prefers-reduced-motion: reduce)');
  const headless = !!opts.headless || !canvas || typeof window === 'undefined';
  const map = createBrainMap(connectome, { lite: coarse, reducedMotion: reduce, holdOut: 0.2, restEdges: 0.55, ...opts, size: 1 });
  const scene = new THREE.Scene();
  scene.add(map.group);
  const camera = new THREE.PerspectiveCamera(32, 1.4, 0.01, 40);
  const V = { yaw: 1.25, pitch: 0.32, dist: 3.5, ...(opts.view || {}) };
  camera.position.set(V.dist * Math.cos(V.pitch) * Math.sin(V.yaw), V.dist * Math.sin(V.pitch), V.dist * Math.cos(V.pitch) * Math.cos(V.yaw));
  camera.lookAt(0, 0, 0);
  let renderer = null, dirty = true, tip = null;
  if (!headless) {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, alpha: !opts.background, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, coarse ? 1 : 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      if (opts.background) scene.background = new THREE.Color(opts.background);
    } catch (e) { renderer = null; }
    const sizeTip = h => { const s = tip?.sprite(); if (!s) return; const k = (s.userData.px / Math.max(1, h)) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)); s.scale.set(k * s.userData.aspect, k, 1); };
    tip = anatomyTips(map, canvas, camera, () => { dirty = true; }, sizeTip);
  }
  function resize() {
    const w = canvas?.clientWidth || canvas?.width || 160, h = canvas?.clientHeight || canvas?.height || 110;
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    renderer?.setSize(w, h, false);
    tip?.resize(h);
    dirty = true;
  }
  function render() { if (renderer) renderer.render(scene, camera); dirty = false; }
  // Own loop: a host that never calls update() still sees the sequence.
  // The first update() call from the host turns the own loop off.
  let hostDriven = false, raf = 0, last = 0, alive = true;
  const canRaf = !headless && typeof requestAnimationFrame === 'function';
  function step(dt) { const ch = map.update(dt); if (ch || dirty) { render(); return true; } return false; }
  function frame(now) {
    raf = 0;
    if (!alive || hostDriven) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    if (!(typeof document !== 'undefined' && document.hidden)) step(dt);
    if (map.running || dirty) raf = requestAnimationFrame(frame); else last = 0;
  }
  const kick = () => { if (canRaf && !hostDriven && !raf && alive) raf = requestAnimationFrame(frame); };
  resize();
  kick();
  return {
    map, scene, camera,
    fire(trace, delta, fo) { const r = map.fire(trace, delta, fo); dirty = true; kick(); return r; },
    update(dt) { hostDriven = true; return step(dt); },
    resize, render,
    pick(x, y) { const w = canvas?.clientWidth || 160, h = canvas?.clientHeight || 110; const a = map.pickScreen(x, y, camera, w, h, 40); tip?.show(a); dirty = true; return a; },
    get running() { return map.running; },
    // free the context now, not at garbage collection: play mode makes a
    // new card for each game, and a browser drops the oldest context
    // (maybe the 3D table) after about 16
    dispose() { alive = false; if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf); tip?.dispose(); map.dispose(); renderer?.dispose(); try { renderer?.forceContextLoss(); } catch { /* no context */ } },
  };
}
