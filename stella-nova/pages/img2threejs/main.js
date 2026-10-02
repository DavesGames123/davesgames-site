// ============================================================================
//  IMG2THREEJS  ·  main.js — viewer, pass scrubber, source view, explode
// ────────────────────────────────────────────────────────────────────────────
//  Loads one generated factory (models/<id>/<pass>.js) at a time, builds its
//  THREE.Group, stands it on a shadow floor and frames it from the review
//  camera the model was judged from. The factories are the img2threejs
//  output, transpiled to JS; this file adds no geometry of its own.
//
//  PASSES   eight build passes per model. Passes before material-pass were
//           reviewed for form, so they show in clay (each material's base
//           colour, no maps). A pass whose generated factory equals an
//           earlier one says so on its card (catalog sameAs).
//  UNITS    the factories are in decimetres (1 = 10 cm).
//  RENDER   on demand: a frame renders while the camera moves, an explode
//           animates, or a texture arrives.
//  window.__img2 exposes the state for xr.js and the headless checks.
//
//  GREP MAP
//    const S = ............... page state
//    async function load ..... factory import, clay, placement
//    function frame .......... camera fit to the review view
//    function setExplode ..... explode animation
//    function renderPass ..... pass card and dock
//    function openSource ..... source dialog
//    function loop ........... render loop
//    window.snSaver .......... shell screensaver hook (orbit, pass tour, fades)
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MODELS } from './models/catalog.js';
import { highlight } from '../../lib/code-highlight.js';

const $ = id => document.getElementById(id);
const PASS_NAMES = { 'blockout': 'Blockout', 'structural-pass': 'Structure', 'form-refinement': 'Form', 'material-pass': 'Material',
  'surface-pass': 'Surface', 'lighting-pass': 'Lighting', 'interaction-pass': 'Interaction', 'optimization-pass': 'Optimisation' };
const CLAY_BEFORE = 'material-pass';
const LAYER_NAMES = { silhouetteProportion: 'Silhouette', componentStructure: 'Structure', formDetail: 'Form',
  materialSurface: 'Material', lightingCamera: 'Light, camera' };

const S = { m: 0, p: 7, explode: 0, explodeTo: 0, dirty: true, ready: false, model: null, token: 0 };

// ── renderer, scene, camera ────────────────────────────────────────────────
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0d1119');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.addEventListener('change', () => { S.dirty = true; });

// Shadow floor and a soft key that casts it (the factories' look-dev rigs light
// the model; this light only adds the contact shadow on the floor).
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.ShadowMaterial({ opacity: 0.32 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 4;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const holder = new THREE.Group();   // the model sits in this group; xr.js moves the scene
scene.add(holder);
let rig = null;

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Saver on a tall screen: the shell docks the label plate at the top, so
  // a view offset moves the image of the model down by 0.12 of the height.
  if (saver.on && h > w) camera.setViewOffset(w, h, 0, -Math.round(0.12 * h), w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  S.dirty = true;
}
new ResizeObserver(resize).observe(view);

// ── loading a pass ─────────────────────────────────────────────────────────
// The generated createLoadedMapTexture sets needsUpdate before the image has
// arrived, so three would warn on every render until it loads. load() puts the
// version of each map that has no image yet back to 0; the loader's own
// needsUpdate on arrival then uploads it. The factories stay as generated.
const MAPS = ['map', 'roughnessMap', 'normalMap', 'aoMap', 'bumpMap', 'displacementMap'];
THREE.DefaultLoadingManager.onLoad = () => { S.dirty = true; };
const modules = new Map();
function importFactory(file) {
  if (!modules.has(file)) modules.set(file, import('./' + file));
  return modules.get(file);
}
function disposeTree(obj) {
  obj.traverse(o => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    for (const m of [].concat(o.material)) {
      if (!m) continue;
      for (const k of ['map', 'roughnessMap', 'normalMap', 'aoMap', 'bumpMap', 'displacementMap']) m[k]?.dispose();
      m.dispose();
    }
  });
}
function clay(group) {
  group.traverse(o => {
    if (!o.isMesh) return;
    const old = o.material;
    const spec = old.userData?.sculptMaterial || {};
    o.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.baseColor || '#9a9a9a'), roughness: 0.82, metalness: 0 });
    for (const k of ['map', 'roughnessMap', 'normalMap', 'aoMap', 'bumpMap']) old[k]?.dispose();
    old.dispose();
  });
}
const box = new THREE.Box3(), tmpV = new THREE.Vector3();

async function load(mi, pi, { keepView = false } = {}) {
  const token = ++S.token;
  const M = MODELS[mi], P = M.passes[pi];
  $('loading').hidden = false;
  const mod = await importFactory(P.file);
  if (token !== S.token) return;
  const group = mod[M.factory]({ castShadow: true, receiveShadow: true });
  group.traverse(o => { if (o.isMesh) for (const k of MAPS) { const t = o.material[k]; if (t && !t.image) t.version = 0; } });
  if (PASS_ORDER.indexOf(P.id) < PASS_ORDER.indexOf(CLAY_BEFORE)) clay(group);
  // Stand the model on the floor, centred on the axis.
  box.setFromObject(group);
  const c = box.getCenter(tmpV);
  group.position.set(-c.x, -box.min.y, -c.z);
  const pivot = new THREE.Group();
  pivot.add(group);
  pivot.updateMatrixWorld(true);
  // Remember each mesh's home and its outward direction for the explode.
  const mb = new THREE.Box3().setFromObject(pivot), mc = mb.getCenter(new THREE.Vector3()), size = mb.getSize(new THREE.Vector3());
  pivot.userData.size = size;
  pivot.traverse(o => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    const dir = b.sub(mc); dir.y *= 0.6;
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    o.userData.home = o.position.clone();
    o.userData.out = o.parent.worldToLocal(o.getWorldPosition(new THREE.Vector3()).add(dir.normalize().multiplyScalar(size.length() * 0.18)))
      .sub(o.position);
  });
  if (rig) { holder.remove(rig); }
  rig = new THREE.Group();
  const lightsF = Object.entries(mod).find(([k]) => /LookDevLights$/.test(k))?.[1];
  if (lightsF) rig.add(lightsF('reference'));
  holder.add(rig);
  if (S.model) { holder.remove(S.model); disposeTree(S.model); }
  S.model = pivot;
  holder.add(pivot);
  applyExplode(S.explode);
  // Shadow light box around the model.
  const r = size.length() * 0.6;
  sun.position.set(-r * 0.9, r * 1.6, r * 1.1);
  sun.target.position.set(0, size.y * 0.4, 0);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.1, far: r * 5 });
  sun.shadow.camera.updateProjectionMatrix();
  if (!keepView) frame();
  S.m = mi; S.p = pi; S.ready = true;
  $('loading').hidden = true;
  S.dirty = true;
  // Textures arrive after the first frame.
  setTimeout(() => { S.dirty = true; }, 400);
  setTimeout(() => { S.dirty = true; }, 1500);
}
const PASS_ORDER = Object.keys(PASS_NAMES);

function frame() {
  const M = MODELS[S.m];
  const size = S.model.userData.size;
  const rad = size.length() * 0.5;
  const az = (M.view.az || 0) * Math.PI / 180, el = (M.view.el || 12) * Math.PI / 180;
  // In saver mode the bounding sphere takes 0.62 of the half height (less
  // on a narrow screen), so the label plate fits beside the model:
  // d = rad sqrt(1 + u^2) / u, with u = that fraction times tan(fov / 2).
  const tf = Math.tan(camera.fov * Math.PI / 360);
  const u = Math.min(0.62, 0.8 * (view.clientWidth || innerWidth) / (view.clientHeight || innerHeight)) * tf;
  const d = saver.on ? rad * Math.sqrt(1 + u * u) / u : rad / Math.sin(camera.fov * Math.PI / 360) * (innerWidth < 860 ? 1.12 : 1.0);
  const target = new THREE.Vector3(0, size.y * 0.47, 0);
  camera.position.set(d * Math.cos(el) * Math.sin(az), target.y + d * Math.sin(el), d * Math.cos(el) * Math.cos(az));
  controls.target.copy(target);
  controls.minDistance = rad * 0.6;
  controls.maxDistance = d * 3;
  controls.update();
  S.dirty = true;
}

// ── explode ────────────────────────────────────────────────────────────────
function applyExplode(e) {
  if (!S.model) return;
  S.model.traverse(o => {
    if (o.isMesh && o.userData.home) o.position.copy(o.userData.home).addScaledVector(o.userData.out, e);
  });
}
function setExplode(on) {
  S.explodeTo = on ? 1 : 0;
  $('bExplode').classList.toggle('on', on);
  $('bExplode').textContent = on ? 'Assemble' : 'Explode';
}

// ── UI ─────────────────────────────────────────────────────────────────────
function renderTabs() {
  $('tabs').innerHTML = MODELS.map((m, i) =>
    `<button class="tab" role="tab" data-m="${i}" aria-selected="${i === S.m}">${m.title}</button>`).join('');
}
function renderPass() {
  const M = MODELS[S.m], P = M.passes[S.p];
  $('passbar').innerHTML = M.passes.map((p, i) =>
    `<button class="pchip${p.sameAs ? ' same' : ''}" role="tab" data-p="${i}" aria-selected="${i === S.p}" title="${PASS_NAMES[p.id]}${p.sameAs ? ' (same code as ' + PASS_NAMES[p.sameAs] + ')' : ''}"><b>${i + 1}</b>${PASS_NAMES[p.id]}</button>`).join('');
  $('passbar').querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  $('passN').textContent = `${S.p + 1} / ${M.passes.length}`;
  $('passName').textContent = PASS_NAMES[P.id];
  $('passScore').textContent = P.score != null ? P.score.toFixed(2) : '';
  $('passScore').title = 'AI vision score of the render against the reference (0..1)';
  let sum = P.summary;
  if (P.sameAs) sum = `This pass left the generated factory unchanged (same code as ${PASS_NAMES[P.sameAs]}); it was reviewed for ${PASS_NAMES[P.id].toLowerCase()}. ` + sum;
  if (PASS_ORDER.indexOf(P.id) < PASS_ORDER.indexOf(CLAY_BEFORE)) sum += ' Shown in clay: this pass was judged on form.';
  $('passSum').textContent = sum;
  const mis = [].concat(P.mismatches || []).filter(x => x && x !== 'none');
  $('passMis').innerHTML = mis.map(x => `<li>${esc(x)}</li>`).join('');
  $('layers').innerHTML = Object.entries(P.layers || {}).map(([k, v]) =>
    `<div class="layer"><span>${LAYER_NAMES[k] || k}</span><span class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></span><span>${v.toFixed(2)}</span></div>`).join('');
}
function renderRef() {
  const M = MODELS[S.m], c = M.credit;
  $('refImg').src = M.ref;
  $('refImg').alt = `Reference: ${c.work} by ${c.artist}`;
  $('refCap').innerHTML = `Reference · ${esc(c.artist)}, <i>${esc(c.work)}</i> · ${esc(c.id)} · ${esc(c.licence)}`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
$('refCredits').innerHTML = MODELS.map(m => {
  const c = m.credit;
  return `<li>${esc(c.artist)}, <i>${esc(c.work)}</i><small>${esc(c.source)} · ${esc(c.id)} · ${esc(c.licence)} · <a href="${c.url}" target="_blank" rel="noopener">Wikimedia Commons</a></small></li>`;
}).join('');

async function setModel(i) {
  S.explode = S.explodeTo = 0; setExplode(false);
  S.m = i; S.p = MODELS[i].passes.length - 1;
  renderTabs(); renderPass(); renderRef();
  await load(i, S.p);
}
async function setPass(i) {
  const n = MODELS[S.m].passes.length;
  S.p = (i + n) % n;
  renderPass();
  await load(S.m, S.p, { keepView: true });
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) setModel(+b.dataset.m); });
$('passbar').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) setPass(+b.dataset.p); });
$('prev').addEventListener('click', () => setPass(S.p - 1));
$('next').addEventListener('click', () => setPass(S.p + 1));
$('bExplode').addEventListener('click', () => setExplode(S.explodeTo < 0.5));
$('bReset').addEventListener('click', () => frame());
addEventListener('keydown', e => {
  if (e.target.closest('input, textarea') || $('source').open) return;
  if (e.key === 'ArrowRight') setPass(S.p + 1);
  else if (e.key === 'ArrowLeft') setPass(S.p - 1);
});

// ── source view ────────────────────────────────────────────────────────────
const sources = new Map();
async function openSource() {
  const M = MODELS[S.m], P = M.passes[S.p];
  $('sourceTitle').textContent = `${P.file} · ${M.factory}()`;
  $('sourceCode').textContent = 'loading…';
  $('source').showModal();
  if (!sources.has(P.file)) sources.set(P.file, fetch(P.file).then(r => r.text()));
  $('sourceCode').innerHTML = highlight(await sources.get(P.file), 'js');
}
$('bSource').addEventListener('click', openSource);
$('bClose').addEventListener('click', () => $('source').close());

// ── loop ───────────────────────────────────────────────────────────────────
let last = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (saver.on) saverTick(dt);
  if (Math.abs(S.explode - S.explodeTo) > 1e-3) {
    S.explode += (S.explodeTo - S.explode) * Math.min(1, dt * (saver.on ? 1.1 : 5));
    applyExplode(S.explode);
    S.dirty = true;
  }
  if (controls.update()) S.dirty = true;
  if (!S.dirty || document.hidden) return;
  S.dirty = false;
  renderer.render(scene, camera);
}

// ── screensaver ────────────────────────────────────────────────────────────
// Shell screensaver hook (lib/screensaver.js). enter() hides the header, the
// side panel, the dock and the notes, and pins .stage to the window, so the
// ResizeObserver sizes the renderer to the full window. The camera orbits
// slowly (autoRotate, speed from opts.calm). Each model plays four steps of
// max(10, seconds / 4) s: blockout in clay, form in clay, the final pass, and
// the final pass exploded and assembled again. Each pass or model change
// happens under a fade to the background colour. The fade is a plane on the
// camera, so the recording has it. The first model comes from opts.seed.
const saver = { on: false, fade: 1, fadeTo: 1, mesh: null };
const FADE_S = 0.9;
function saverTick(dt) {
  const d = saver.fadeTo - saver.fade;
  saver.fade += Math.sign(d) * Math.min(Math.abs(d), dt / FADE_S);
  const f = saver.fade, a = f * f * (3 - 2 * f);
  saver.mesh.material.opacity = a; saver.mesh.visible = a > 0.001;
  S.dirty = true;
}
// The plate: the model, the pass on screen and its review scores, all from
// models/catalog.js, and the maths this page applies to it: the shading of
// MeshStandardMaterial (three.js, GGX), the explode offset of load() and
// applyExplode, and the ACES tone map. A new model gives a new title; a
// new pass swaps the text. Colours: positions x and the outward unit u m1,
// n, l, v, h m3, the material terms (f_r, rho, F, F_0, D, G) m4, the
// explode e and the size s m6.
function saverPlate(label, mi, pi, exploded) {
  if (!label) return;
  const M = MODELS[mi], P = M.passes[pi], c = M.credit;
  const clay = PASS_ORDER.indexOf(P.id) < PASS_ORDER.indexOf(CLAY_BEFORE);
  const size = S.model && S.model.userData.size;
  label({
    title: M.title,
    sub: `Pass ${pi + 1} of ${M.passes.length}: ${PASS_NAMES[P.id]}${clay ? ', clay' : ''}${exploded ? ', exploded' : ''}`,
    params: [{ sym: 'e', name: 'explode', value: exploded ? '0 → 1' : '0', cls: 'm6' },
      { sym: 'N', name: 'components', value: String(M.components), cls: 'm6' }]
      .concat(size ? [{ sym: '\\lVert\\mathbf{s}\\rVert', name: 'bounding box diagonal', value: (size.length() * 10).toFixed(0) + ' cm', cls: 'm6' }] : [])
      .concat([{ sym: 'q', name: 'AI vision score', value: P.score != null ? P.score.toFixed(2) : '—', cls: '' }]),
    lines: [
      `${M.materials.join(', ')}` + (P.sameAs ? `; same code as ${PASS_NAMES[P.sameAs]}` : ''),
      `Reference: ${c.artist}, ${c.work} (${c.licence})`,
    ],
    tex: [
      'f_r = (1 - F)\\,\\frac{\\rho}{\\pi} + \\frac{D\\,G\\,F}{4\\,(\\mathbf{n}\\cdot\\mathbf{l})(\\mathbf{n}\\cdot\\mathbf{v})}',
      '\\mathbf{x}_i = \\mathbf{x}_i^{0} + 0.18\\, e\\, \\lVert\\mathbf{s}\\rVert\\, \\hat{\\mathbf{u}}_i',
      'F = F_0 + (1 - F_0)(1 - \\mathbf{v}\\cdot\\mathbf{h})^5',
      'c_{\\text{out}} = \\operatorname{ACES}(1.05\\, c_{\\text{lin}})',
    ],
    rules: [['\\mathbf{x}', 'm1'], ['\\hat{\\mathbf{u}}', 'm1'], ['\\mathbf{n}', 'm3'], ['\\mathbf{l}', 'm3'], ['\\mathbf{v}', 'm3'], ['\\mathbf{h}', 'm3'],
      ['f_r', 'm4'], ['\\rho', 'm4'], ['F_0', 'm4'], ['F', 'm4'], ['D', 'm4'], ['G', 'm4'], ['e', 'm6'], ['\\mathbf{s}', 'm6'], ['N', 'm6']],
    eq: ['f_r = (1 − F) ρ/π + D G F / (4 (n·l)(n·v))', 'x_i = x_i⁰ + 0.18 e |s| û_i', 'out = ACES(1.05 · linear)'],
    anchor: modelAnchor,
  });
}
// The model on screen, for the shell's label plate. Each visible mesh gives
// a disc: its world bounding sphere, projected with the page camera (the
// saver view offset included). x, y is the centre of the box round the
// discs, r the radius that holds them. pts are mesh centres: the largest
// mesh and the leftmost, rightmost, highest and lowest ones, so the leader
// ends on the model, not on the circle round a tall or wide model. Page
// CSS px.
const _bs = new THREE.Sphere(), _bv = new THREE.Vector3();
function modelAnchor() {
  if (!S.model) return null;
  const R = renderer.domElement.getBoundingClientRect();
  if (R.width < 2) return null;
  const t = Math.tan(camera.fov * Math.PI / 360), half = R.height / 2, discs = [];
  camera.updateMatrixWorld();
  S.model.traverse(o => {
    if (!o.isMesh || !o.visible || !o.geometry) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    _bs.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
    const z = -_bv.copy(_bs.center).applyMatrix4(camera.matrixWorldInverse).z;
    if (z <= camera.near) return;
    _bv.copy(_bs.center).project(camera);
    discs.push({ x: R.left + (_bv.x + 1) / 2 * R.width, y: R.top + (1 - _bv.y) / 2 * R.height, r: _bs.radius / z / t * half });
  });
  if (!discs.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const d of discs) { x0 = Math.min(x0, d.x - d.r); x1 = Math.max(x1, d.x + d.r); y0 = Math.min(y0, d.y - d.r); y1 = Math.max(y1, d.y + d.r); }
  const x = (x0 + x1) / 2, y = (y0 + y1) / 2;
  let r = 0; for (const d of discs) r = Math.max(r, Math.hypot(d.x - x, d.y - y) + d.r);
  const pick = [discs.reduce((a, b) => (b.r > a.r ? b : a)), discs.reduce((a, b) => (b.x < a.x ? b : a)), discs.reduce((a, b) => (b.x > a.x ? b : a)),
    discs.reduce((a, b) => (b.y < a.y ? b : a)), discs.reduce((a, b) => (b.y > a.y ? b : a))];
  return { x, y, r, pts: [...new Set(pick)].map(d => ({ x: d.x, y: d.y })) };
}
async function saverRun(m0, stepMs) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const fadeTo = v => { saver.fadeTo = v; return wait(FADE_S * 1000 + 100); };
  for (let k = 0; saver.on; k++) {
    const mi = (m0 + k) % MODELS.length, last = MODELS[mi].passes.length - 1;
    for (const [pi, ex] of [[0, false], [2, false], [last, false], [last, true]]) {
      if (!ex) {
        await fadeTo(1);
        if (pi === 0) { S.explode = S.explodeTo = 0; setExplode(false); S.m = mi; await load(mi, 0); }
        else await load(mi, pi, { keepView: true });
        saverPlate(saver.label, mi, pi, false);
        await fadeTo(0);
        await wait(stepMs - 2 * (FADE_S * 1000 + 100));
      } else {
        setExplode(true); saverPlate(saver.label, mi, pi, true); await wait(stepMs * 0.5);
        setExplode(false); saverPlate(saver.label, mi, pi, false); await wait(stepMs * 0.5);
      }
    }
  }
}
window.snSaver = { enter(opts) {
  const calm = Math.max(0, Math.min(1, opts.calm ?? 0.7)), secs = Math.max(20, +opts.seconds || 60);
  const st = document.createElement('style');
  st.textContent = 'html.i2-saver,html.i2-saver body{overflow:hidden!important;background:#0d1119!important}'
    + 'html.i2-saver header.top,html.i2-saver #side,html.i2-saver #dock,html.i2-saver #hint,html.i2-saver #loading,html.i2-saver .notes,html.i2-saver #source{display:none!important}'
    + 'html.i2-saver .stage{position:fixed!important;inset:0!important;height:auto!important;min-height:0!important;z-index:2147483647}html.i2-saver .view canvas{cursor:none}';
  document.head.appendChild(st); document.documentElement.classList.add('i2-saver');
  saver.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: scene.background, transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false }));
  saver.mesh.position.z = -0.1; saver.mesh.renderOrder = 999; saver.mesh.frustumCulled = false;
  camera.add(saver.mesh); scene.add(camera);
  controls.enabled = false; controls.autoRotate = true; controls.autoRotateSpeed = 1.1 * (1 - 0.6 * calm);
  saver.on = true; saver.fade = saver.fadeTo = 1; saver.label = opts.label;
  resize();
  saverRun((opts.seed >>> 0) % MODELS.length, Math.max(10, secs / 4) * 1000);
  return { canvas: renderer.domElement, warmupMs: 1500 };
} };

window.__img2 = { S, MODELS, renderer, scene, camera, controls, holder, setModel, setPass, setExplode, frame,
  dirty: () => { S.dirty = true; } };
resize();
renderTabs();
setModel(0);
requestAnimationFrame(loop);
