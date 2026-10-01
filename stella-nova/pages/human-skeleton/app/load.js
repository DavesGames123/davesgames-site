// ============================================================================
//  HUMAN SKELETON  ·  app/load.js — manifest, bone groups, cartilage
// ────────────────────────────────────────────────────────────────────────────
//  loadAll reads the manifest first. The manifest sets the per-bone arrays
//  of S, the BoneState texture, the materials, the list and the first
//  camera frame. Two workers then download the eight body groups in
//  LOAD_ORDER, and addGroup adds the meshes of each group when it arrives.
//  The cartilage group loads only when the user shows cartilage.
//
//  GREP MAP
//    function fetchBuf                               fetch + gunzip
//    function loadAll                                manifest, then groups
//    function addGroup                               decode, mesh, appear
//    function ensureCartilage                        lazy cartilage group
// ============================================================================
import { gunzip, decodeGroup } from '../decode.js';
import * as L from '../layout.js';
import { BoneState, boneMaterial, depthMaterial, ghostMaterial, pickMaterial, groupMesh } from '../render.js';
import { $, COARSE, LOAD_ORDER } from './env.js';
import { scene, U } from './stage.js';
import { T, S, dirty, toast } from './state.js';
import { fitView } from './camera.js';
import { refreshVisibility } from './visibility.js';
import { buildList } from './list.js';
import { syncRead, syncUI } from './controls.js';

async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return gunzip(await r.arrayBuffer());
}
export async function loadAll() {
  const r = await fetch('data/manifest.json');
  const M = await r.json();
  S.M = M; S.P = L.prep(M); S.n = M.bones.length; S.bones = M.bones; S.regions = M.regions;
  S.regionIx = new Map(M.regions.map((x, k) => [x.id, k]));
  S.amt = new Float32Array(M.regions.length);
  const n = S.n;
  S.cur = { off: new Float32Array(n * 3), q: new Float32Array(n * 4) };
  S.from = { off: new Float32Array(n * 3), q: new Float32Array(n * 4) };
  S.to = { off: new Float32Array(n * 3), q: new Float32Array(n * 4) };
  for (const o of [S.cur, S.from, S.to]) for (let i = 0; i < n; i++) o.q[i * 4 + 3] = 1;
  S.delay = new Float32Array(n); S.dOff = new Float32Array(n * 3); S.dVel = new Float32Array(n * 3);
  S.appear = new Float32Array(n); S.loaded = new Uint8Array(n); S.vis = new Uint8Array(n);
  S.state = new BoneState(n);
  for (const b of S.bones) S.state.set(2, b.i, b.c[0], b.c[1], b.c[2], 1);
  S.state.dirty();
  S.mats = {
    bone: boneMaterial(S.state, U, { physical: !COARSE }), depth: depthMaterial(S.state),
    ghost: ghostMaterial(S.state, U), pick: pickMaterial(S.state), receive: !COARSE,
  };
  buildList(); syncUI();
  fitView(true);
  S.ready = true;
  const groups = LOAD_ORDER.filter(g => M.files.some(f => f.id === g));
  let done = 0;
  const bar = $('loadBar').firstElementChild;
  const queue = groups.slice();
  const worker = async () => {
    while (queue.length) {
      const g = queue.shift();
      const f = M.files.find(x => x.id === g);
      const buf = await fetchBuf(f.url);
      addGroup(g, buf);
      done++;
      bar.style.width = `${(100 * done / groups.length).toFixed(0)}%`;
      $('loadingText').textContent = `Loading ${done} / ${groups.length}`;
    }
  };
  await Promise.all([worker(), worker()]);
  T.allBones = performance.now();
  $('loading').classList.add('done');
  syncRead();
}
function addGroup(g, buf) {
  const bones = S.bones.filter(b => b.file === g);
  const dec = decodeGroup(buf, bones);
  const gm = groupMesh(dec, S.mats);
  scene.add(gm.mesh, gm.ghost);
  gm.ghost.visible = S.iso >= 0;
  S.groups.set(g, gm);
  const now = performance.now();
  for (const b of bones) { S.loaded[b.i] = 1; b.appearAt = now + (b.i % 17) * 18; }
  refreshVisibility(false);
  dirty();
}
let cartilagePromise = null;
export function ensureCartilage() {
  if (!cartilagePromise) {
    const f = S.M.files.find(x => x.id === 'cartilage');
    cartilagePromise = fetchBuf(f.url).then(buf => addGroup('cartilage', buf)).catch(e => { toast('Cartilage failed to load'); console.warn(e); });
  }
  return cartilagePromise;
}
