// ============================================================================
//  HUMAN SKELETON  ·  main.js — state, loading, UI, picking, camera, loop
// ────────────────────────────────────────────────────────────────────────────
//  The manifest arrives first: it builds the list, the camera frame and the
//  bone state texture. The eight body groups then load at the same time
//  (spine and thorax first) and each one dissolves in when it arrives.
//
//  STATE    per bone: cur / from / to (offset + rotation), a stagger delay,
//           a drag offset with a spring, an appear factor, a flag (shown,
//           hidden, ghost). Every frame that changes, they go into the
//           BoneState texture (render.js) and the GPU moves the bones.
//  MODES    radial, regional (layout.js), catalogue (the tray). An amount
//           per region scales radial and regional, so one hand can open
//           while the rest stays put. Reconstruct plays the stagger back.
//  PICK     the bones render their row as a colour into a small target
//           round the tap (view offset of the main camera); the nearest
//           coloured pixel wins. Radius 4 px (mouse) or 22 px (touch).
//  SELECT   the bone glows, the card opens, the list marks it, and the
//           camera pans if the bone sits under the card or the panel.
//  ISOLATE  the other bones become fresnel ghosts; the camera flies to
//           the bone and orbits it.
//  FRAME    occlusion() measures the panel and the card;
//           camera.setViewOffset centres the view in the clear part.
//
//  GREP MAP
//    function loadAll / addGroup / ensureCartilage        loading
//    function setMode / explode / reconstruct / target    layouts
//    function pickAt / onTap / select / showCard          picking
//    function isolate / step / focusRegion / focusBone    inspection
//    function buildList / syncList / setRegionHidden      the bone list
//    function occlusion / resize / flyTo / fitView        camera
//    function setTheme / buildUI / syncUI / setOpen       controls
//    function placeLabels / buildTrays                    the tray
//    function frame                                       the loop
// ============================================================================
import * as THREE from 'three';
import { gunzip, decodeGroup } from './decode.js';
import * as L from './layout.js';
import { BoneState, boneMaterial, depthMaterial, ghostMaterial, pickMaterial, groupMesh } from './render.js';
import { $, PHONE_Q, COARSE, HOVER, REDUCED, esc, clamp01, easeIO, ease, TYPE_NAME, SIDE_NAME, MODE_NAME, LOAD_ORDER, THEMES } from './app/env.js';
import { canvas, renderer, scene, envRT, camera, pickCam, key, floor, poolTex, pool, trays, U, controls } from './app/stage.js';
import { T, S, dirty, toast, hideHint, regionOf } from './app/state.js';
import { occ, occlusion, clearRect, fitDist, resize, flyTo, fitView, fitShadow, ensureVisible } from './app/camera.js';

// ── loading ─────────────────────────────────────────────────────────────────
async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return gunzip(await r.arrayBuffer());
}
async function loadAll() {
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
function ensureCartilage() {
  if (!cartilagePromise) {
    const f = S.M.files.find(x => x.id === 'cartilage');
    cartilagePromise = fetchBuf(f.url).then(buf => addGroup('cartilage', buf)).catch(e => { toast('Cartilage failed to load'); console.warn(e); });
  }
  return cartilagePromise;
}

// ── visibility, flags ───────────────────────────────────────────────────────
function shownByToggles(b) {
  if (b.type === 'tooth' && !S.show.teeth) return false;
  if (b.type === 'cartilage' && !S.show.cartilage) return false;
  return !S.hiddenRegion.has(b.region);
}
function refreshVisibility(relayout = true) {
  let changed = false;
  for (const b of S.bones) {
    const v = S.loaded[b.i] && shownByToggles(b) ? 1 : 0;
    if (v !== S.vis[b.i]) { S.vis[b.i] = v; changed = true; }
    const flag = !v ? 1 : S.iso >= 0 && b.i !== S.iso ? 2 : 0;
    S.state.setK(2, b.i, 3, flag);
  }
  S.state.dirty();
  if (S.sel >= 0 && !S.vis[S.sel]) clearSelection();
  if (changed && relayout) retarget(true);
  syncRead();
  dirty();
}

// ── layouts ─────────────────────────────────────────────────────────────────
function aspect() { const c = clearRect(); return Math.max(0.5, Math.min(2.6, (c.x1 - c.x0) / Math.max(1, c.y1 - c.y0))); }
function perBoneAmt() {
  const a = new Float32Array(S.n);
  for (const b of S.bones) a[b.i] = S.amt[S.regionIx.get(b.region)];
  return a;
}
// layout target for the present mode; visible bones only
function target() {
  const n = S.n, off = new Float32Array(n * 3), q = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) q[i * 4 + 3] = 1;
  let cat = null;
  if (S.mode === 'catalogue') {
    cat = L.catalogue(S.P, S.vis, S.regions, S.sort, aspect());
    off.set(cat.off); q.set(cat.q);
  } else {
    const a = perBoneAmt();
    (S.mode === 'regional' ? L.regional : L.radial)(S.P, a, 1, off);
    L.liftToFloor(S.P, off, S.vis);
  }
  return { off, q, cat };
}
function exploded() { return S.mode === 'catalogue' || S.amt.some(x => x > 0); }
// start a transition from the bones as they are now to the new target
function retarget(stagger, reverse = false, fit = true) {
  const t = target();
  S.from.off.set(S.cur.off); S.from.q.set(S.cur.q);
  S.to.off.set(t.off); S.to.q.set(t.q);
  S.cat = t.cat;
  const kind = S.mode === 'assembled' ? 'radial' : S.mode;
  if (stagger && !REDUCED) {
    let rank = null;
    if (S.mode === 'catalogue' && t.cat) {
      rank = new Float32Array(S.n);
      const order = S.bones.map(b => b.i).sort((a, c) => (t.off[a * 3 + 2] + S.bones[a].c[2]) - (t.off[c * 3 + 2] + S.bones[c].c[2]) || (t.off[a * 3] + S.bones[a].c[0]) - (t.off[c * 3] + S.bones[c].c[0]));
      order.forEach((i, k) => { rank[i] = k; });
    }
    S.delay.set(L.delays(S.P, kind, reverse, rank));
    S.tr = { t: 0, dur: 0.85, end: Math.max(...S.delay) + 0.85 };
  } else {
    S.delay.fill(0);
    S.tr = { t: 0, dur: REDUCED ? 0.01 : 0.22, end: REDUCED ? 0.01 : 0.22 };
  }
  setTraysOn(S.mode === 'catalogue');
  if (S.mode === 'catalogue' && t.cat) buildTrays(t.cat);
  fitShadow();
  if (fit && S.iso < 0) fitView(false, t.off);
  syncUI(); dirty();
}
function setMode(m, opts = {}) {
  if (m === 'assembled') { reconstruct(); return; }
  const wasCat = S.mode === 'catalogue';
  S.mode = m;
  if (m !== 'catalogue') {
    S.lastMode = m;
    if (!S.amt.some(x => x > 0) || wasCat) S.amt.fill(S.amount || 1);
  }
  if (S.iso >= 0) exitIsolate(false);
  retarget(opts.stagger !== false);
}
function explode() { setMode(S.lastMode || 'radial'); }
function reconstruct() {
  if (S.iso >= 0) exitIsolate(false);
  if (S.mode === 'catalogue') S.mode = S.lastMode || 'radial';
  S.amt.fill(0);
  retarget(true, true);
}
function setAmount(v) {
  S.amount = v;
  if (S.mode === 'catalogue') S.mode = S.lastMode;
  S.amt.fill(v);
  retarget(false, false, false);
}
function toggleRegionExplode(rid) {
  const k = S.regionIx.get(rid);
  if (S.mode === 'catalogue') { S.mode = S.lastMode; S.amt.fill(0); }
  S.amt[k] = S.amt[k] > 0 ? 0 : Math.max(0.6, S.amount || 1);
  // the shared bones of a pair of regions read better together
  retarget(true, S.amt[k] === 0, false);
  focusRegion(rid);
}

// ── the tray ────────────────────────────────────────────────────────────────
function setTraysOn(on) {
  S.traysOn = on;
  S.labelsOn = on;
  if (!on) { $('labels').innerHTML = ''; labelEls = null; }
}
function buildTrays(cat) {
  for (const c of [...trays.children]) { c.geometry.dispose(); c.material.dispose(); trays.remove(c); }
  const th = THEMES[S.theme];
  for (const t of cat.trays) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.006, t.d), new THREE.MeshStandardMaterial({ color: th.tray, roughness: 0.95, metalness: 0, transparent: true, opacity: 0 }));
    m.position.set(t.x, 0.003, t.z);
    m.receiveShadow = true;
    m.userData.tray = t;
    trays.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(t.w, 0.006, t.d)), new THREE.LineBasicMaterial({ color: th.trayLine, transparent: true, opacity: 0 }));
    e.position.copy(m.position);
    trays.add(e);
  }
  labelEls = null;
}
let labelEls = null, trayEls = null;
function shortName(b) {
  let s = b.name;
  s = s.replace(/^Cervical vertebra |^Thoracic vertebra |^Lumbar vertebra /, '');
  s = s.replace(/^Proximal phalanx, /, 'Prox. ').replace(/^Middle phalanx, /, 'Mid. ').replace(/^Distal phalanx, /, 'Dist. ');
  s = s.replace(/ finger$/, '').replace(/ toe$/, ' toe').replace('Inferior nasal concha', 'Inf. concha');
  return s;
}
function placeLabels() {
  const box = $('labels');
  if (!S.labelsOn || !S.cat || (S.tr && S.tr.t < S.tr.end * 0.85)) { if (box.childElementCount) box.style.opacity = '0'; return; }
  box.style.opacity = '1';
  if (!labelEls) {
    box.innerHTML = '';
    labelEls = new Map();
    for (const b of S.bones) {
      const el = document.createElement('div'); el.className = 'bl'; el.textContent = shortName(b);
      box.appendChild(el); labelEls.set(b.i, el);
    }
    trayEls = S.cat.trays.map(t => { const el = document.createElement('div'); el.className = 'tl'; el.textContent = t.label; box.appendChild(el); return el; });
  }
  const w = canvas.clientWidth, h = canvas.clientHeight, v = new THREE.Vector3();
  const taken = [];
  const free = (x0, y0, x1, y1) => !taken.some(r => x0 < r[2] && r[0] < x1 && y0 < r[3] && r[1] < y1);
  const order = S.bones.filter(b => S.vis[b.i]).sort((a, c) => (c.i === S.sel) - (a.i === S.sel) || c.len - a.len);
  for (const b of S.bones) if (!S.vis[b.i]) labelEls.get(b.i).style.display = 'none';
  for (const b of order) {
    const el = labelEls.get(b.i);
    v.set(S.cat.label[b.i * 3], S.cat.label[b.i * 3 + 1], S.cat.label[b.i * 3 + 2]).project(camera);
    const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
    const tw = el.textContent.length * 5.4 + 4, th = 13;
    // too small on screen: the bone is narrower than a third of its label
    const ok = v.z < 1 && x > 0 && x < w && y > 0 && y < h && free(x - tw / 2, y, x + tw / 2, y + th);
    // the label lives in the gap under its bone (pad + label band in
    // layout.js): when the gap is shorter than the text, it waits for zoom
    const ls = labelScale(b), gapPx = (ls / Math.max(1e-4, b.lay.ext[0])) * 0.058;
    const big = (ls > tw * 0.33 && gapPx >= 11) || b.i === S.sel;
    if (ok && big) {
      taken.push([x - tw / 2, y, x + tw / 2, y + th]);
      el.style.display = '';
      el.style.transform = `translate(${(x - tw / 2).toFixed(1)}px,${y.toFixed(1)}px)`;
      el.classList.toggle('sel', b.i === S.sel);
    } else el.style.display = 'none';
  }
  S.cat.trays.forEach((t, k) => {
    v.set(t.lx, 0.006, t.lz).project(camera);
    const el = trayEls[k];
    if (!el) return;
    const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
    _la.set(t.x - t.w / 2, 0.006, t.lz).project(camera); _lb.set(t.x + t.w / 2, 0.006, t.lz).project(camera);
    el.style.maxWidth = `${Math.max(0, Math.abs(_lb.x - _la.x) / 2 * w - 8).toFixed(0)}px`;
    el.style.transform = `translate(${x.toFixed(1)}px,${(y - 14).toFixed(1)}px)`;
  });
}
// width of the bone on screen, in CSS pixels
const _la = new THREE.Vector3(), _lb = new THREE.Vector3();
function labelScale(b) {
  const cx = S.cat.label[b.i * 3], cz = S.cat.label[b.i * 3 + 2];
  _la.set(cx - b.lay.ext[0] / 2, 0.01, cz).project(camera);
  _lb.set(cx + b.lay.ext[0] / 2, 0.01, cz).project(camera);
  return Math.abs(_lb.x - _la.x) / 2 * canvas.clientWidth;
}

// ── picking ─────────────────────────────────────────────────────────────────
const pickRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
let pickBuf = new Uint8Array(4);
function pickAt(cx, cy, r = COARSE ? 22 : 4) {
  if (!S.ready || !S.groups.size) return -1;
  const cr = canvas.getBoundingClientRect();
  const px = Math.round(cx - cr.left), py = Math.round(cy - cr.top);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const size = 2 * r + 1;
  if (pickRT.width !== size) { pickRT.setSize(size, size); pickBuf = new Uint8Array(size * size * 4); }
  pickCam.copy(camera);
  pickCam.layers.set(1);
  const ox = camera.view ? camera.view.offsetX : 0, oy = camera.view ? camera.view.offsetY : 0;
  pickCam.setViewOffset(w, h, ox + px - r, oy + py - r, size, size);
  pickCam.updateProjectionMatrix();
  scene.overrideMaterial = S.mats.pick;
  renderer.setRenderTarget(pickRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, pickCam);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  renderer.readRenderTargetPixels(pickRT, 0, 0, size, size, pickBuf);
  let best = -1, bd = Infinity;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = (y * size + x) * 4;
    const id = pickBuf[k] + pickBuf[k + 1] * 256;
    if (!id) continue;
    // readRenderTargetPixels rows run bottom up
    const d = (x - r) ** 2 + (size - 1 - y - r) ** 2;
    if (d < bd && d <= r * r) { bd = d; best = id - 1; }
  }
  return best;
}

// ── selection, card ─────────────────────────────────────────────────────────
export const card = $('card');
export function boneCentre(i, out = new THREE.Vector3()) {
  const b = S.bones[i];
  out.set(b.c[0] + S.cur.off[i * 3] + S.dOff[i * 3], b.c[1] + S.cur.off[i * 3 + 1] + S.dOff[i * 3 + 1], b.c[2] + S.cur.off[i * 3 + 2] + S.dOff[i * 3 + 2]);
  // on the tray the bone turns about c, and its box centre is c + lay.c
  if (S.mode === 'catalogue' && S.cat && !S.tr) out.add(new THREE.Vector3(...b.lay.c));
  return out;
}
function setHi(i, k, v) { if (i >= 0) { S.state.setK(3, i, k, v); S.state.dirty(); } }
function select(i, opts = {}) {
  if (i < 0 || i >= S.n) return;
  if (S.sel >= 0 && S.sel !== i) setHi(S.sel, 0, 0);
  S.sel = i;
  setHi(i, 0, 1);
  showCard();
  syncList(opts.scroll !== false);
  if (S.iso >= 0 && S.iso !== i) isolate(i);
  else if (opts.fly) focusBone(i);
  else requestAnimationFrame(() => ensureVisible(i));
  dirty();
}
function clearSelection() {
  if (S.sel >= 0) setHi(S.sel, 0, 0);
  S.sel = -1;
  hideCard();
  syncList(false);
  dirty();
}
function cardNumber(b) {
  const counted = S.bones.filter(x => x.counted);
  const k = counted.indexOf(b);
  return k >= 0 ? `No. ${String(k + 1).padStart(3, '0')}` : b.type === 'tooth' ? 'Tooth' : 'Cartilage';
}
function zoomLabel(b) {
  if (/^hand/.test(b.region)) return 'Zoom to hand';
  if (/^foot/.test(b.region)) return 'Zoom to foot';
  if (b.region === 'skull' || b.region === 'teeth' || b.region === 'hyoid') return 'Zoom to skull';
  return 'Focus';
}
function showCard() {
  const b = S.bones[S.sel];
  if (!b) return;
  const reg = regionOf(b);
  const arts = b.art.map(id => S.P.byId.get(id)).filter(Boolean);
  const artName = a => (a.side && a.side !== b.side ? `${SIDE_NAME[a.side]} ${a.name.toLowerCase()}` : a.name);
  card.innerHTML = `
    <div class="c-head"><div class="ttl">
      <div class="eyebrow"><span class="no">${cardNumber(b)}</span><span>${esc(reg.label)}${b.side ? ' · ' + SIDE_NAME[b.side] : ''}</span></div>
      <div class="c-name">${esc(b.side && /pelvis|thorax|skull|teeth|cartilage/.test(b.region) ? SIDE_NAME[b.side] + ' ' + b.name.toLowerCase() : b.name)}</div>
      <div class="c-lat">${esc(b.latin)}</div>
    </div><button class="c-x" type="button" aria-label="Close">✕</button></div>
    <div class="specs">
      <span class="k">Type</span><span class="v">${TYPE_NAME[b.type]}</span>
      <span class="k">Side</span><span class="v">${SIDE_NAME[b.side]}</span>
      <span class="k">Length</span><span class="v">${b.len >= 100 ? Math.round(b.len) : b.len.toFixed(1)} mm</span>
      <span class="k">FMA</span><span class="v">${b.fma ? `<a href="https://bioportal.bioontology.org/ontologies/FMA?p=classes&conceptid=http%3A%2F%2Fpurl.org%2Fsig%2Font%2Ffma%2Ffma${b.fma}" target="_blank" rel="noopener">${b.fma}</a>` : '—'}</span>
    </div>
    <div class="c-sub">${b.type === 'tooth' ? 'Set in' : b.type === 'cartilage' ? 'Joins' : 'Articulates with'}</div>
    <div class="nb">${arts.length ? arts.map(a => `<button type="button" data-i="${a.i}">${esc(artName(a))}</button>`).join('') : '<span class="none">No other bone: muscles and ligaments hold it.</span>'}</div>
    <p class="c-fact">${esc(b.fact)}</p>
    <div class="c-acts">
      <button type="button" data-act="prev" aria-label="Previous bone">‹</button>
      <button type="button" data-act="iso" class="${S.iso >= 0 ? 'on' : ''}">${S.iso >= 0 ? 'Show all' : 'Isolate'}</button>
      <button type="button" data-act="zoom">${zoomLabel(b)}</button>
      <button type="button" data-act="next" aria-label="Next bone">›</button>
    </div>
    <div class="c-foot"><span>${esc(reg.label)} · ${reg.count} ${reg.count === 1 ? 'piece' : 'pieces'}</span><span>${COARSE ? 'Drag it out' : 'Drag it out · ← → step'}</span></div>`;
  card.hidden = false;
  document.body.classList.add('has-card');
  card.scrollTop = 0;
}
function hideCard() { card.hidden = true; document.body.classList.remove('has-card'); dirty(); }
card.addEventListener('click', e => {
  const x = e.target.closest('button');
  if (!x) return;
  if (x.classList.contains('c-x')) { if (S.iso >= 0) exitIsolate(true); clearSelection(); return; }
  if (x.dataset.i) { select(+x.dataset.i, { fly: S.iso < 0 }); return; }
  const act = x.dataset.act;
  if (act === 'prev') step(-1);
  else if (act === 'next') step(1);
  else if (act === 'iso') { if (S.iso >= 0) exitIsolate(true); else isolate(S.sel); }
  else if (act === 'zoom') {
    const b = S.bones[S.sel];
    if (/^(hand|foot)/.test(b.region)) focusRegion(b.region);
    else if (/skull|teeth|hyoid/.test(b.region)) focusRegion('skull');
    else focusBone(S.sel);
  }
});
function step(dir) {
  const list = S.bones.filter(b => S.vis[b.i]).map(b => b.i);
  if (!list.length) return;
  const k = list.indexOf(S.sel);
  const j = list[(k < 0 ? 0 : k + dir + list.length) % list.length];
  select(j, { fly: S.iso < 0 && !onScreen(j) });
}
function onScreen(i) {
  const p = boneCentre(i).project(camera);
  return Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9 && p.z < 1;
}

// ── isolate, focus ──────────────────────────────────────────────────────────
function isolate(i) {
  if (i < 0) return;
  if (S.iso < 0) S.isoBack = { t: controls.target.clone(), p: camera.position.clone() };
  S.iso = i;
  if (S.sel !== i) { if (S.sel >= 0) setHi(S.sel, 0, 0); S.sel = i; setHi(i, 0, 1); syncList(true); }
  for (const g of S.groups.values()) g.ghost.visible = true;
  setHi(i, 0, 0.18);
  refreshVisibility(false);
  const b = S.bones[i];
  flyTo(boneCentre(i), fitDist(b.r * 1.15), 1.0);
  showCard();
  syncRead();
}
function exitIsolate(back) {
  S.iso = -1;
  for (const g of S.groups.values()) g.ghost.visible = false;
  refreshVisibility(false);
  if (back && S.isoBack) flyTo(S.isoBack.t, S.isoBack.p.distanceTo(S.isoBack.t), 0.9, S.isoBack.p.clone().sub(S.isoBack.t).normalize());
  S.isoBack = null;
  if (S.sel >= 0) { setHi(S.sel, 0, 1); showCard(); }
  syncRead();
}
function focusBone(i) {
  const b = S.bones[i];
  flyTo(boneCentre(i), fitDist(Math.max(b.r * 2.2, 0.06)), 0.9);
}
function focusRegion(rid) {
  if (rid === 'all') { fitView(false); return; }
  const want = rid === 'skull' ? new Set(['skull', 'teeth', 'hyoid', 'ear']) : new Set([rid]);
  const bd = L.bounds(S.P, S.to.off, S.vis, b => want.has(b.region));
  const dir = /^foot/.test(rid) ? new THREE.Vector3(0.25, 0.9, 0.55) : /^hand/.test(rid) ? new THREE.Vector3(rid.endsWith('-l') ? 0.2 : -0.2, 0.05, 1) : null;
  if (S.mode === 'catalogue') { flyTo(new THREE.Vector3(...bd.c), fitDist(bd.r * 1.05), 0.9); return; }
  flyTo(new THREE.Vector3(...bd.c), fitDist(bd.r * 1.05), 0.9, dir ? dir.normalize() : null);
}

// ── the bone list ───────────────────────────────────────────────────────────
const list = $('list');
let rowEls = new Map();
function buildList() {
  list.innerHTML = '';
  rowEls = new Map();
  for (const r of S.regions) {
    const bones = S.bones.filter(b => b.region === r.id);
    if (!bones.length) continue;
    const g = document.createElement('div');
    g.className = 'rg'; g.dataset.r = r.id;
    const soft = r.id === 'teeth' || r.id === 'cartilage';
    g.innerHTML = `<div class="rg-h"><button type="button" class="rg-t" aria-expanded="false">${esc(r.label)} <span class="n">${bones.length}</span><span class="car">›</span></button>` +
      (soft ? '' : `<button type="button" class="rg-b" data-x="explode" aria-label="Explode ${esc(r.label)}">Explode</button>`) +
      `<button type="button" class="rg-b" data-x="hide" aria-label="Hide ${esc(r.label)}">Hide</button></div><div class="rg-rows" role="list"></div>`;
    const rows = g.querySelector('.rg-rows');
    for (const b of bones) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'br'; el.dataset.i = b.i; el.setAttribute('role', 'listitem');
      el.innerHTML = `<span>${esc(b.name)}</span><i>${esc(b.latin)}</i>`;
      rows.appendChild(el); rowEls.set(b.i, el);
    }
    list.appendChild(g);
  }
}
list.addEventListener('click', e => {
  const row = e.target.closest('.br');
  if (row) {
    const i = +row.dataset.i;
    const b = S.bones[i];
    if (!S.vis[i]) {
      if (b.type === 'tooth') setShow('teeth', true);
      else if (b.type === 'cartilage') setShow('cartilage', true);
      else setRegionHidden(b.region, false);
    }
    select(i, { fly: S.iso < 0, scroll: false });
    if (PHONE_Q.matches && !matchMedia('(orientation:landscape)').matches) setOpen(false);
    return;
  }
  const g = e.target.closest('.rg');
  if (!g) return;
  const rid = g.dataset.r;
  const bx = e.target.closest('.rg-b');
  if (bx && bx.dataset.x === 'hide') { setRegionHidden(rid, !S.hiddenRegion.has(rid)); return; }
  if (bx && bx.dataset.x === 'explode') { toggleRegionExplode(rid); return; }
  if (e.target.closest('.rg-t')) {
    g.classList.toggle('open');
    g.querySelector('.rg-t').setAttribute('aria-expanded', String(g.classList.contains('open')));
  }
});
function setRegionHidden(rid, hide) {
  if (rid === 'teeth') { setShow('teeth', !hide); return; }
  if (rid === 'cartilage') { setShow('cartilage', !hide); return; }
  if (hide) S.hiddenRegion.add(rid); else S.hiddenRegion.delete(rid);
  refreshVisibility(true);
  syncUI();
}
function syncList(scroll) {
  for (const el of list.querySelectorAll('.br.sel')) el.classList.remove('sel');
  if (S.sel < 0) return;
  const el = rowEls.get(S.sel);
  if (!el) return;
  el.classList.add('sel');
  const g = el.closest('.rg');
  if (!g.classList.contains('open')) g.classList.add('open');
  if (scroll && panel.classList.contains('open')) el.scrollIntoView({ block: 'nearest' });
}
$('search').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  list.classList.toggle('filtering', !!q);
  for (const g of list.querySelectorAll('.rg')) {
    let any = false;
    for (const el of g.querySelectorAll('.br')) {
      const b = S.bones[+el.dataset.i];
      const hit = !q || (b.name + ' ' + b.latin + ' ' + regionOf(b).label + ' ' + SIDE_NAME[b.side]).toLowerCase().includes(q);
      el.classList.toggle('miss', !hit);
      any = any || hit;
    }
    g.classList.toggle('empty', !any);
  }
});

// ── canvas pointer: tap, double tap, hover, drag out ────────────────────────
// Registered before OrbitControls reads the event: a press on the picked
// bone drags that bone and the orbit does not start.
const tip = $('tip');
const downs = new Map();
let multi = false, lastTap = { t: 0, i: -1 }, mouse = null;
const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hitV = new THREE.Vector3();
function ndc(x, y) {
  const cr = canvas.getBoundingClientRect();
  return new THREE.Vector2(((x - cr.left) / cr.width) * 2 - 1, -((y - cr.top) / cr.height) * 2 + 1);
}
function planeHit(x, y, out) { ray.setFromCamera(ndc(x, y), camera); return ray.ray.intersectPlane(plane, out); }
canvas.addEventListener('pointerdown', e => {
  downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (downs.size > 1) { multi = true; return; }
  if (S.sel < 0 || e.button > 0) return;
  const i = pickAt(e.clientX, e.clientY, COARSE ? 12 : 3);
  if (i !== S.sel) return;
  const c = boneCentre(i);
  plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), c);
  const h = planeHit(e.clientX, e.clientY, new THREE.Vector3());
  if (!h) return;
  S.drag = { i, id: e.pointerId, start: h, base: new THREE.Vector3(S.dOff[i * 3], S.dOff[i * 3 + 1], S.dOff[i * 3 + 2]), moved: false };
  S.springing.delete(i);
  try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ }
  e.stopImmediatePropagation();
}, true);
canvas.addEventListener('pointermove', e => {
  if (S.drag && e.pointerId === S.drag.id) {
    if (downs.size > 1) return;
    if (!planeHit(e.clientX, e.clientY, hitV)) return;
    const d = hitV.sub(S.drag.start).add(S.drag.base);
    S.dOff[S.drag.i * 3] = d.x; S.dOff[S.drag.i * 3 + 1] = d.y; S.dOff[S.drag.i * 3 + 2] = d.z;
    const dn = downs.get(e.pointerId);
    if (dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > (COARSE ? 10 : 5)) { S.drag.moved = true; hideHint(); }
    dirty();
    e.stopImmediatePropagation();
    return;
  }
  if (HOVER && e.pointerType === 'mouse') mouse = { x: e.clientX, y: e.clientY, b: e.buttons };
}, true);
const endPointer = e => {
  const d = downs.get(e.pointerId);
  downs.delete(e.pointerId);
  const drag = S.drag && e.pointerId === S.drag.id ? S.drag : null;
  if (drag) {
    S.drag = null;
    S.springing.add(drag.i);
    dVelZero(drag.i);
    e.stopImmediatePropagation();
    if (drag.moved) return;
  }
  if (!d) return;
  const wasMulti = multi;
  if (!downs.size) multi = false;
  if (e.type === 'pointercancel' || wasMulti) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > (COARSE ? 10 : 6) || performance.now() - d.t > 600) return;
  onTap(e.clientX, e.clientY);
};
function dVelZero(i) { S.dVel[i * 3] = S.dVel[i * 3 + 1] = S.dVel[i * 3 + 2] = 0; }
canvas.addEventListener('pointerup', endPointer, true);
canvas.addEventListener('pointercancel', endPointer, true);
canvas.addEventListener('pointerleave', () => { mouse = null; setHover(-1); });
function onTap(x, y) {
  const i = pickAt(x, y);
  const now = performance.now();
  if (i >= 0) {
    hideHint();
    if (now - lastTap.t < 380 && lastTap.i === i) { focusBone(i); lastTap = { t: 0, i: -1 }; return; }
    lastTap = { t: now, i };
    if (S.iso >= 0 && i !== S.iso) return;
    select(i, { scroll: true });
  } else {
    lastTap = { t: 0, i: -1 };
    if (S.iso < 0) clearSelection();
  }
}
export function setHover(i, x, y) {
  if (i === S.hov) { if (i >= 0) moveTip(x, y); return; }
  if (S.hov >= 0) setHi(S.hov, 1, 0);
  S.hov = i;
  if (i < 0) { tip.classList.remove('show'); canvas.style.cursor = ''; dirty(); return; }
  setHi(i, 1, 1);
  const b = S.bones[i];
  tip.innerHTML = `${esc(b.name)}${b.side ? ' · ' + SIDE_NAME[b.side] : ''} <i>${esc(b.latin)}</i>`;
  moveTip(x, y);
  tip.classList.add('show');
  canvas.style.cursor = i === S.sel ? 'grab' : 'pointer';
  dirty();
}
function moveTip(x, y) {
  const cr = canvas.getBoundingClientRect();
  tip.style.transform = `translate(${x - cr.left + 14}px,${y - cr.top + 16}px)`;
}

// ── panel, sheet, dock, theme ───────────────────────────────────────────────
export const panel = $('panel');
const dockList = $('dockList');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open);
  dockList.classList.toggle('on', open);
  dockList.setAttribute('aria-expanded', String(open));
  dirty();
}
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
dockList.addEventListener('click', () => {
  const open = !panel.classList.contains('open');
  setOpen(open);
  if (open) requestAnimationFrame(() => {
    const el = S.sel >= 0 ? rowEls.get(S.sel) : $('bonesLabel');
    if (el) el.scrollIntoView({ block: S.sel >= 0 ? 'center' : 'start' });
  });
});
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ } });
grip.addEventListener('pointerup', e => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) panel.classList.toggle('full');
  else if (dy < -40) panel.classList.add('full');
  else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  dirty();
});
grip.addEventListener('pointercancel', () => { gripY = null; });

function setTheme(t) {
  S.theme = t;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('hs-theme', t); } catch (e) { /* private mode */ }
  const th = THEMES[t];
  U.uSel.value.set(th.sel); U.uHov.value.set(th.hov); U.uGhost.value.set(th.ghost); U.uGhostA.value = th.ghostA;
  floor.material.opacity = th.shadow;
  pool.material.color.set(th.pool); pool.material.opacity = th.poolA;
  renderer.toneMappingExposure = th.exposure;
  for (const m of trays.children) {
    if (m.isLineSegments) m.material.color.set(th.trayLine); else m.material.color.set(th.tray);
  }
  dirty();
}
function setShow(k, v) {
  S.show[k] = v;
  if (k === 'spin') { controls.autoRotate = v; }
  else if (k === 'cartilage' && v) ensureCartilage().then(() => refreshVisibility(true));
  else refreshVisibility(true);
  syncUI();
}
function syncRead() {
  if (!S.M) return;
  const bones = S.bones.filter(b => S.vis[b.i] && b.counted).length;
  const extra = [];
  const teeth = S.bones.filter(b => S.vis[b.i] && b.type === 'tooth').length;
  const cart = S.bones.filter(b => S.vis[b.i] && b.type === 'cartilage').length;
  if (teeth) extra.push(`${teeth} teeth`);
  if (cart) extra.push(`${cart} cartilages`);
  const mode = S.iso >= 0 ? 'Isolated' : !exploded() ? 'Assembled' : S.mode === 'catalogue' ? `On the tray, by ${S.sort === 'size' ? 'length' : 'region'}` : `${MODE_NAME[S.mode]} explode`;
  $('read').innerHTML = `<span class="meta">${esc(mode)}</span><b>${bones} bones</b>${extra.join(' · ')}`;
}
function syncUI() {
  if (!S.amt) return;
  const ex = exploded();
  const modeNow = S.mode === 'catalogue' ? 'catalogue' : ex ? S.mode : 'assembled';
  for (const b of $('modes').children) { b.classList.toggle('on', b.dataset.mode === modeNow); b.setAttribute('aria-checked', String(b.dataset.mode === modeNow)); }
  $('sortRow').hidden = S.mode !== 'catalogue';
  $('amountRow').classList.toggle('off', S.mode === 'catalogue');
  const am = S.amt.length ? Math.max(...S.amt) : 0;
  $('amount').value = String(S.mode === 'catalogue' ? 1 : am);
  $('amountV').textContent = `${Math.round((S.mode === 'catalogue' ? 1 : am) * 100)}%`;
  for (const b of $('sortRow').children) b.classList.toggle('on', b.dataset.sort === S.sort);
  for (const b of $('shows').children) b.classList.toggle('on', !!S.show[b.dataset.show]);
  $('dockExplodeV').textContent = ex ? 'Reconstruct' : 'Explode';
  $('dockExplode').classList.toggle('on', ex);
  $('dockModeV').textContent = MODE_NAME[S.mode === 'catalogue' ? 'catalogue' : S.lastMode];
  for (const g of list.querySelectorAll('.rg')) {
    const rid = g.dataset.r;
    const hidden = rid === 'teeth' ? !S.show.teeth : rid === 'cartilage' ? !S.show.cartilage : S.hiddenRegion.has(rid);
    g.classList.toggle('hidden', hidden);
    const hb = g.querySelector('[data-x="hide"]');
    hb.textContent = hidden ? 'Show' : 'Hide';
    hb.classList.toggle('on', hidden);
    const eb = g.querySelector('[data-x="explode"]');
    if (eb) eb.classList.toggle('on', S.mode !== 'catalogue' && S.amt[S.regionIx.get(rid)] > 0 && S.amt.some(x => x === 0));
  }
  syncRead();
}
function buildUI() {
  $('modes').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  $('amount').addEventListener('input', e => setAmount(+e.target.value));
  $('sortRow').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.sort = b.dataset.sort; if (S.mode === 'catalogue') retarget(true); syncUI(); } });
  $('bReconstruct').addEventListener('click', reconstruct);
  $('focus').addEventListener('click', e => { const b = e.target.closest('button'); if (b) focusRegion(b.dataset.focus); });
  $('shows').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setShow(b.dataset.show, !S.show[b.dataset.show]); });
  $('dockExplode').addEventListener('click', () => (exploded() ? reconstruct() : explode()));
  $('dockMode').addEventListener('click', () => {
    const order = ['radial', 'regional', 'catalogue'];
    const now = S.mode === 'catalogue' ? 'catalogue' : S.lastMode;
    const next = exploded() ? order[(order.indexOf(now) + 1) % 3] : now;
    setMode(next);
  });
  const flip = () => setTheme(S.theme === 'dark' ? 'light' : 'dark');
  $('dockTheme').addEventListener('click', flip);
  $('themeBtn').addEventListener('click', flip);
  $('dockFit').addEventListener('click', () => { if (S.iso >= 0) exitIsolate(false); fitView(false); });
  $('hint').textContent = COARSE ? 'Tap a bone · drag to turn · pinch to zoom' : 'Click a bone · drag to orbit · scroll to zoom';
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input')) return;
    if (e.key === 'Escape') { if (S.iso >= 0) exitIsolate(true); else clearSelection(); }
    else if (e.key === 'ArrowRight' || e.key === ']') step(1);
    else if (e.key === 'ArrowLeft' || e.key === '[') step(-1);
    else if (e.key === 'e') (exploded() ? reconstruct() : explode());
    else if (e.key === 'i' && S.sel >= 0) (S.iso >= 0 ? exitIsolate(true) : isolate(S.sel));
    else if (e.key === 'f' && S.sel >= 0) focusBone(S.sel);
    else if (e.key === 'r') fitView(false);
  });
  addEventListener('resize', dirty);
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
const _q = new Float32Array(4);
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let upload = false;
  // framing eases toward the clear area
  const o = occlusion();
  for (const k in occ) {
    const d = o[k] - occ[k];
    if (Math.abs(d) > 0.5) { occ[k] += d * Math.min(1, dt * 9); S.dirty = true; } else if (d) { occ[k] = o[k]; S.dirty = true; }
  }
  if (S.fly) {
    const f = S.fly;
    f.t = Math.min(1, f.t + dt / f.dur);
    const k = easeIO(f.t);
    controls.target.lerpVectors(f.t0, f.t1, k);
    const u = f.u1 ? f.u0.clone().lerp(f.u1, k).normalize() : camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(u, f.r0 + (f.r1 - f.r0) * k);
    if (f.t >= 1) S.fly = null;
    S.dirty = true;
  }
  if (S.ready) {
    // explode transition
    if (S.tr) {
      const tr = S.tr;
      tr.t += dt;
      for (let i = 0; i < S.n; i++) {
        const k = easeIO(clamp01((tr.t - S.delay[i]) / tr.dur));
        for (let a = 0; a < 3; a++) S.cur.off[i * 3 + a] = S.from.off[i * 3 + a] + (S.to.off[i * 3 + a] - S.from.off[i * 3 + a]) * k;
        L.slerp(S.from.q, i * 4, S.to.q, i * 4, k, S.cur.q, i * 4);
      }
      for (const m of trays.children) m.material.opacity = (S.traysOn ? ease(clamp01(tr.t / Math.max(0.3, tr.end * 0.6))) : 1 - ease(clamp01(tr.t / 0.35))) * (m.isLineSegments ? 0.55 : 1);
      if (tr.t >= tr.end) { S.tr = null; if (!S.traysOn) for (const m of trays.children) m.visible = false; fitShadow(); }
      else for (const m of trays.children) m.visible = true;
      upload = true;
    }
    // drag springs
    for (const i of S.springing) {
      let e = 0;
      for (let a = 0; a < 3; a++) {
        const k = i * 3 + a;
        S.dVel[k] += (-70 * S.dOff[k] - 9 * S.dVel[k]) * dt;
        S.dOff[k] += S.dVel[k] * dt;
        e += Math.abs(S.dOff[k]) + Math.abs(S.dVel[k]) * 0.05;
      }
      if (e < 1e-5) { S.dOff.fill(0, i * 3, i * 3 + 3); dVelZero(i); S.springing.delete(i); }
      upload = true;
    }
    if (S.drag) upload = true;
    // dissolve in as groups arrive
    for (const b of S.bones) {
      if (!S.loaded[b.i] || S.appear[b.i] >= 1) continue;
      S.appear[b.i] = REDUCED ? 1 : clamp01((now - b.appearAt) / 650);
      upload = true;
    }
    if (upload) {
      for (let i = 0; i < S.n; i++) {
        S.state.set(0, i, S.cur.off[i * 3] + S.dOff[i * 3], S.cur.off[i * 3 + 1] + S.dOff[i * 3 + 1], S.cur.off[i * 3 + 2] + S.dOff[i * 3 + 2], S.appear[i]);
        _q.set(S.cur.q.subarray(i * 4, i * 4 + 4));
        S.state.set(1, i, _q[0], _q[1], _q[2], _q[3]);
      }
      S.state.dirty();
      S.dirty = true;
    }
  }
  controls.autoRotate = S.show.spin && !S.fly && !S.drag;
  if (controls.update(dt)) S.dirty = true;
  if (S.show.spin) S.dirty = true;
  // hover pick, once a frame, while the mouse is still
  if (mouse && !mouse.b && !S.drag && S.groups.size) {
    const m = mouse; mouse = null;
    setHover(pickAt(m.x, m.y, 3), m.x, m.y);
  }
  if (!S.dirty) return;
  S.dirty = false;
  if (!resize()) return;
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  placeLabels();
  S.frames++;
  if (!T.firstFrame) T.firstFrame = performance.now();
  if (!T.firstBones && S.groups.size) T.firstBones = performance.now();
}

window.addEventListener('pagehide', () => {
  running = false; cancelAnimationFrame(raf);
  try {
    for (const g of S.groups.values()) g.geo.dispose();
    if (S.mats) for (const k of ['bone', 'depth', 'ghost', 'pick']) S.mats[k].dispose();
    if (S.state) S.state.dispose();
    for (const c of trays.children) { c.geometry.dispose(); c.material.dispose(); }
    floor.geometry.dispose(); floor.material.dispose(); pool.geometry.dispose(); pool.material.dispose(); poolTex.dispose();
    pickRT.dispose(); envRT.dispose(); key.shadow.map && key.shadow.map.dispose();
    controls.dispose(); renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
  } catch (e) { /* the page is going */ }
});

// debug and headless checks
window.__hs = {
  S, T, select, clearSelection, isolate, exitIsolate, setMode, explode, reconstruct, setAmount, toggleRegionExplode, focusRegion, focusBone,
  setTheme, setShow, setRegionHidden, pickAt, step, camera, controls, setOpen, fitView,
  screenOf(id) {
    const b = typeof id === 'number' ? S.bones[id] : S.P.byId.get(id);
    const p = boneCentre(b.i).project(camera);
    const cr = canvas.getBoundingClientRect();
    return { x: cr.left + (p.x + 1) / 2 * cr.width, y: cr.top + (1 - p.y) / 2 * cr.height, i: b.i };
  },
  busy: () => !!(S.tr || S.fly || S.springing.size || S.bones.some(b => S.loaded[b.i] && S.appear[b.i] < 1)),
};

// ── boot ────────────────────────────────────────────────────────────────────
buildUI();
setTheme(S.theme);
requestAnimationFrame(frame);
loadAll().catch(e => { console.error(e); $('loadingText').textContent = 'The skeleton failed to load'; toast(String(e.message || e)); });
