// ============================================================================
//  BREADBOARD LAB  ·  view/scene.js — the 3D bench
// ----------------------------------------------------------------------------
//  createView (CONTRACT 4.2) owns the renderer, the camera, the mat, the
//  lights, and one 3D object per board, part, wire and instrument of the
//  store document. It draws the circuit state from sim frames, and it turns
//  pointer gestures into store ops through view/interact.js.
//
//  NO IMPORT-TIME THREE OR DOM. THREE comes in as an option, and the PARTS
//  builders load with dynamic import() when createView runs (or come in as
//  opts.parts). So node imports this module, and the tests build the whole
//  scene graph with three r160 and a stub renderer. Until the PARTS modules
//  load (or when a builder throws) view/fallback.js draws plain stand-ins.
//
//  THE DOCUMENT IS THE SCENE. sync(doc) diffs the document against the
//  objects by reference and by a build key: a changed key rebuilds the
//  object, a changed place only moves it, changed looks only swap
//  materials. Drags show a preview document through the same sync.
//
//  RENDER ON DEMAND. The loop renders when something changed, the camera
//  tweens, smoke rises, or the sim runs (60 fps desktop, 30 fps phone).
//
//  Options beyond the contract: renderer (inject), parts ({ buildPart,
//  buildBoard, buildWire, wirePath } or false for stand-ins only), raf,
//  now, keys (true: the view binds every key of 4.4 itself), env (false:
//  no environment map), bloom (false: no bloom pass).
//
//  GLOW. Bloom sees the emitters only (view/bloom.js). markEmitters puts
//  each glow mesh and each mesh with a non-black emissive colour on
//  LAYER.EMIT, and every sprite on LAYER.FX (off BASE). The camera sees
//  BASE and FX. After each sim frame the lit halos share one gain
//  (core/light.js haloGain), so 30 lit LEDs do not add 30 full halos.
//
//  CONTROLS. Each mesh of handle.interact (a button cap, a switch lever, a
//  knob, a key) gets a rim: an inverted shell CONTROL.rimMm thick, on
//  LAYER.FX. The rims show in the select and probe tools (the tools that
//  press, switch and turn), and the hovered control gets the bright rim.
//  A control smaller than CONTROL.minMm gets an invisible pick box of that
//  size. A touch pick also takes the nearest control within
//  CONTROL.touchSlopPx of the finger (pick option slop).
//
//  GREP MAP
//    loadParts ............. dynamic import of the PARTS modules
//    makeRenderer / lights . renderer, PMREM room, mat, shadows, bloom;
//                            the numbers come from core/light.js
//    setupBloom ............ RenderPass + emitter bloom + OutputPass
//    markEmitters .......... EMIT and FX layers of a built object
//    balanceHalos .......... the shared gain of the lit halos
//    addControls / setControlHover / showRims  control rims and pick boxes
//    nearestControl ........ the touch slop of pick
//    resolver .............. material id → THREE material (presets + doc)
//    buildBoardRec ......... board objects
//    buildPartRec .......... part handles, pickable tags, damage carry-over
//    partKey / liveKey ..... rebuild key; live params go to handle.setParams
//    syncWires ............. wire paths and meshes, flow paths
//    syncProbes / leadRec .. instruments, lead cables and tips
//    sync .................. the document diff
//    pick / benchPoint ..... what is under the pointer (viewOf: view offset)
//    applyInsets / setInsets  frame the bench between the panel columns
//    endWorld / nodeOf ..... wire ends in world mm; net of a target
//    highlightNet .......... rings on every hole and pin of a net
//    setFrame .............. sim frame → handles, damage, flow, screens
//    makeGhost ............. translucent placing ghost
//    setWirePreview ........ the wire that follows the pointer
//    itemsInRect ........... box select
//    tick / render ......... the on-demand loop
//    dispose ............... frees everything; forceContextLoss
// ============================================================================
import { createCameraRig, PITCH_TOP } from './camera.js';
import { createGestures, attachGestures } from './touch.js';
import { createEffects } from './effects.js';
import { createFlow } from './flow.js';
import { createInteraction, CONTROL } from './interact.js';
import { createPreview } from './preview.js';
import { dataTexture, fallbackBoard, fallbackPart, fallbackWire, fallbackWirePath } from './fallback.js';
import { ndcFromClient, pickBench, pickPoints, projectPoint, rayFromCamera, rayPlaneY, insetViewOffset } from './picking.js';
import { BOARD_H, BOARD_TYPES, boardHit, boardRect, holeWorld, partFrame, partPinsWorld, strips, parseHoleId, findBoard, stripOf } from '../core/space.js';
import { lookupDef, probeDefaults } from '../core/doc.js';
import { BLOOM, ENV, LAYER, RIG, TONE, haloGain, scaleEnvironment } from '../core/light.js';
import { createEmitterBloom } from './bloom.js';

export const LEAD_COLORS = {
  red: '#d63b3b', black: '#2b2b2b',
  ch1: '#e0c126', ch2: '#4fc3e8', ch3: '#d65bd0', ch4: '#2f80d6', gnd: '#2b2b2b',
  d0: '#3a3a3a', d1: '#8a5a2b', d2: '#d63b3b', d3: '#e2704a', d4: '#e0c126', d5: '#4e9a2e', d6: '#2f80d6', d7: '#7a6fd8',
};
const MAT_COLOR = '#2f4a46', GRID_COLOR = '#36544f';
const PROBE_FALLBACK = {
  dmm: { w: 70, d: 120, h: 28 }, scope: { w: 160, d: 110, h: 70 }, logic: { w: 70, d: 50, h: 16 },
};

// The PARTS modules, by the file names of CONTRACT 2. Each import may fail
// (not delivered yet); the view then keeps its stand-ins.
export async function loadParts(base = import.meta.url) {
  const url = p => new URL(p, base).href;
  const tryImport = p => import(url(p)).catch(() => null);
  const [models, boards, wire, mats, index] = await Promise.all([
    tryImport('../parts/models/index.js'), tryImport('../parts/boards.js'), tryImport('../parts/wire.js'),
    tryImport('../parts/materials.js'), tryImport('../parts/index.js'),
  ]);
  const pickFn = (name, ...mods) => { for (const m of mods) if (m && typeof m[name] === 'function') return m[name]; return null; };
  return {
    buildPart: pickFn('buildPart', models, index),
    buildBoard: pickFn('buildBoard', boards, models, index),
    buildWire: pickFn('buildWire', wire, index),
    wirePath: pickFn('wirePath', wire, index),
    materials: mats && typeof mats.materialResolver === 'function' ? mats : (index && typeof index.materialResolver === 'function' ? index : null),
  };
}

export function createView(opts = {}) {
  const { canvas, store, bus } = opts;
  const THREE = opts.THREE;
  if (!THREE) throw new Error('createView: THREE is required');
  if (!store) throw new Error('createView: store is required');
  let registry = opts.registry || null;
  const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
  const now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const raf = opts.raf || (hasDOM && window.requestAnimationFrame ? f => window.requestAnimationFrame(f) : null);
  const caf = opts.caf || (hasDOM && window.cancelAnimationFrame ? id => window.cancelAnimationFrame(id) : () => {});
  const phone = hasDOM && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) < 820);
  let quality = opts.quality || (phone ? 'low' : 'high');
  let labels = true;
  let disposed = false;
  let deps = { buildPart: null, buildBoard: null, buildWire: null, wirePath: null, materials: null };
  let depsVersion = 0;

  // ── renderer, scene, camera ──────────────────────────────────────────────
  const renderer = opts.renderer || new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE.exposure;
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality === 'high';
  if (THREE.PCFSoftShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#19191c');
  scene.fog = new THREE.Fog('#19191c', 1400, 3200);
  const camera = new THREE.PerspectiveCamera(38, 1.6, 2, 6000);
  camera.layers.enable(LAYER.FX);
  const rig = createCameraRig({ target: [0, 0, 10], dist: 300, yaw: 0, pitch: 0.95 });

  const root = new THREE.Group(); root.name = 'bench';
  const gBoards = new THREE.Group(), gParts = new THREE.Group(), gWires = new THREE.Group(), gProbes = new THREE.Group(), gGhost = new THREE.Group();
  gBoards.name = 'boards'; gParts.name = 'parts'; gWires.name = 'wires'; gProbes.name = 'probes'; gGhost.name = 'ghost';
  root.add(gBoards, gParts, gWires, gProbes, gGhost);
  scene.add(root);

  // the light rig of core/light.js (the tests compute luminance from it)
  const hemi = new THREE.HemisphereLight(RIG.hemi.sky, RIG.hemi.ground, RIG.hemi.intensity);
  const sun = new THREE.DirectionalLight(RIG.sun.color, RIG.sun.intensity);
  sun.position.set(...RIG.sun.position);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -360, right: 360, top: 300, bottom: -300, near: 50, far: 1200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.4;
  const fill = new THREE.DirectionalLight(RIG.fill.color, RIG.fill.intensity);
  fill.position.set(...RIG.fill.position);
  scene.add(hemi, sun, sun.target, fill);

  // The anti-static mat: teal-grey with a faint 1-inch grid (procedural).
  const gridTex = dataTexture(THREE, 128, (u, v, x, y) => {
    const line = x < 2 || y < 2 || x === 64 || y === 64;
    const c = line ? [0x36, 0x54, 0x4f] : [0x2f, 0x4a, 0x46];
    return [c[0], c[1], c[2], 255];
  }, { repeat: true, srgb: true, mip: true });
  const MAT_W = 1600, MAT_D = 1000;
  gridTex.repeat.set(MAT_W / 50.8, MAT_D / 50.8);
  const matMesh = new THREE.Mesh(new THREE.PlaneGeometry(MAT_W, MAT_D), new THREE.MeshStandardMaterial({ color: '#ffffff', map: gridTex, roughness: 0.93, metalness: 0 }));
  matMesh.rotation.x = -Math.PI / 2;
  matMesh.receiveShadow = true;
  matMesh.name = 'mat';
  scene.add(matMesh);
  void MAT_COLOR; void GRID_COLOR;

  const effects = createEffects(THREE, scene);
  const flow = createFlow(THREE, scene);
  let envTex = null, composer = null, bloomPass = null;
  const preview = createPreview(THREE, renderer, null);

  // Environment map and bloom (browser only; the addons import 'three').
  if (opts.env !== false && !opts.renderer && hasDOM) {
    import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      if (disposed) return;
      const pm = new THREE.PMREMGenerator(renderer);
      const room = scaleEnvironment(new RoomEnvironment(renderer), ENV.scale);
      envTex = pm.fromScene(room, 0.04).texture;
      pm.dispose();
      room.dispose();
      scene.environment = envTex;
      requestRender();
    }).catch(() => {});
  }
  function setupBloom() {
    if (opts.bloom === false || opts.renderer || !hasDOM || quality !== 'high' || composer) return;
    Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js'),
      import('three/addons/postprocessing/Pass.js'),
    ]).then(([{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { Pass }]) => {
      if (disposed || quality !== 'high' || composer) return;
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      // bloom from LAYER.EMIT only; resize() gives it the canvas size
      bloomPass = createEmitterBloom(THREE, { Pass, UnrealBloomPass }, scene, camera, BLOOM);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
      resize();
    }).catch(() => {});
  }
  setupBloom();

  // ── emitters and halos ───────────────────────────────────────────────────
  const BLACK = new THREE.Color(0, 0, 0);
  function markEmitters(object) {
    const halos = [];
    object.traverse(o => {
      if (o.isSprite) { o.layers.set(LAYER.FX); if (o.userData.halo) halos.push(o); return; }
      if (!o.isMesh || !o.material) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (o.userData.glow || (m && m.emissive && !m.emissive.equals(BLACK))) o.layers.enable(LAYER.EMIT);
    });
    return halos;
  }
  // one gain for every lit halo: haloGain(n) = sqrt(full / n) above full
  let haloGainNow = 1;
  function balanceHalos() {
    let lit = 0;
    const all = [];
    for (const r of [...recs.parts.values(), ...recs.probes.values()]) for (const h of r.halos || []) { all.push(h); if (h.visible) lit++; }
    haloGainNow = haloGain(lit);
    for (const h of all) {
      const a0 = h.userData.a0 ?? h.material.opacity;
      h.userData.a0 = a0;
      h.material.opacity = a0 * haloGainNow;
    }
    return lit;
  }

  // ── controls: rims, pick boxes, hover ───────────────────────────────────
  const rimMat = new THREE.MeshBasicMaterial({ color: CONTROL.rim, transparent: true, opacity: CONTROL.rimOpacity, side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false });
  const rimHotMat = new THREE.MeshBasicMaterial({ color: CONTROL.rimHot, transparent: true, opacity: 1, side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false });
  const proxyGeo = new THREE.BoxGeometry(1, 1, 1);
  proxyGeo.userData.shared = true;
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  let rimsOn = true, hotControl = null, rimsOff = false;   // rimsOff: the saver hides them
  function addControls(handle) {
    const list = [];
    const meshes = (handle.interact && handle.interact.meshes) || [];
    for (const m of meshes) {
      if (!m || !m.isMesh || !m.geometry) continue;
      m.userData.control = true;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox, size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      const rim = new THREE.Mesh(m.geometry, rimMat);
      const t = CONTROL.rimMm;
      rim.scale.set(1 + 2 * t / Math.max(0.2, size.x), 1 + 2 * t / Math.max(0.2, size.y), 1 + 2 * t / Math.max(0.2, size.z));
      rim.position.set(c.x * (1 - rim.scale.x), c.y * (1 - rim.scale.y), c.z * (1 - rim.scale.z));
      rim.layers.set(LAYER.FX);
      rim.renderOrder = 2;
      rim.castShadow = false; rim.receiveShadow = false;
      rim.name = 'control-rim';
      rim.userData.rim = true;
      rim.visible = rimsOn;
      m.add(rim);
      let proxy = null;
      if (size.x < CONTROL.minMm || size.z < CONTROL.minMm) {
        proxy = new THREE.Mesh(proxyGeo, proxyMat);
        proxy.scale.set(Math.max(size.x, CONTROL.minMm), Math.max(size.y, 2), Math.max(size.z, CONTROL.minMm));
        proxy.position.copy(c);
        proxy.visible = false;            // the raycaster still hits it; nothing draws it
        proxy.castShadow = false;
        proxy.name = 'control-hit';
        proxy.userData.hitProxy = true;
        m.add(proxy);
        if (handle.pickables && !handle.pickables.includes(proxy)) handle.pickables.push(proxy);
      }
      list.push({ mesh: m, rim, proxy, center: c.clone() });
    }
    return list;
  }
  function showRims(on) {
    rimsOn = !!on;
    for (const r of recs.parts.values()) for (const c of r.controls || []) c.rim.visible = rimsOn || c.mesh === hotControl;
    requestRender();
  }
  function setControlHover(mesh) {
    if (rimsOff) mesh = null;
    if (mesh === hotControl) return;
    for (const r of recs.parts.values()) for (const c of r.controls || []) {
      if (c.mesh === hotControl) { c.rim.material = rimMat; c.rim.visible = rimsOn; }
      if (c.mesh === mesh) { c.rim.material = rimHotMat; c.rim.visible = true; }
    }
    hotControl = mesh || null;
    requestRender();
  }
  const isControl = obj => { for (let o = obj; o; o = o.parent) { if (o.userData && (o.userData.control || o.userData.hitProxy)) return true; if (o.userData && o.userData.bbId) return false; } return false; };
  // the control nearest to a screen point, within slop px
  function nearestControl(cx, cy, slop) {
    const r = rect();
    let best = null, bd = slop;
    const w = new THREE.Vector3();
    for (const [id, rec] of recs.parts) for (const c of rec.controls || []) {
      w.copy(c.center); c.mesh.localToWorld(w);
      const pr = projectPoint(rig.cam(), [w.x, w.y, w.z], r, viewOf());
      if (!pr) continue;
      const d = Math.hypot(pr.x - cx, pr.y - cy);
      if (d < bd) { bd = d; best = { id, mesh: c.mesh, point: w.clone() }; }
    }
    return best;
  }

  // ── materials ────────────────────────────────────────────────────────────
  const simpleMats = new Map();
  const SIMPLE = { 'gold-pin': '#d6b04a', tin: '#c9ccd1', copper: '#c98a4b', 'fr4-green': '#2e6b3a', 'pcb-black': '#1b1c1f', 'pcb-blue': '#1f4f8f', 'epoxy-black': '#1d1d20', 'abs-white': '#ececec', 'abs-black': '#1e1e22', 'resistor-beige': '#d9c49a', 'resistor-blue': '#5d8fc9', chrome: '#e6e8ea', rubber: '#222222' };
  function simpleMaterial(id) {
    let m = simpleMats.get(id);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: SIMPLE[id] || '#9a9aa2', roughness: 0.5, metalness: /pin|tin|copper|chrome/.test(id) ? 1 : 0 }); simpleMats.set(id, m); }
    return m;
  }
  let resolveFn = simpleMaterial, resolverFor = undefined, matVersion = 0;
  function refreshResolver(doc) {
    if (typeof opts.materials === 'function') { resolveFn = opts.materials; return; }
    if (doc.materials === resolverFor && resolverFor !== undefined) return;
    const mod = (opts.materials && typeof opts.materials.materialResolver === 'function') ? opts.materials : deps.materials;
    const custom = doc.materials || [];
    if (mod) {
      const r = mod.materialResolver(THREE, custom);
      resolveFn = id => { try { return r(id); } catch { return simpleMaterial(id); } };
    } else resolveFn = simpleMaterial;
    resolverFor = doc.materials;
    matVersion++;
  }
  const materialOf = id => resolveFn(id);

  // ── records ──────────────────────────────────────────────────────────────
  const recs = { boards: new Map(), parts: new Map(), wires: new Map(), probes: new Map() };
  let shown = null;               // the document on screen (store doc or a preview)
  let previewing = false;
  let pickables = [];
  let pickDirty = true;
  let socketPoints = [], leadPoints = [];
  const selection = new Set();
  let netlist = null, lastFrame = null, lastFrameAt = -1e9, frameWall = 0;
  let netNode = null, netTarget = null;
  let needs = true;
  let wirePrev = null;            // { handle, key }
  const leadOverride = { probe: null, lead: null, pos: null };
  let boxEl = null;
  const offs = [];

  const defOf = id => lookupDef(shown || store.doc, registry, id);
  const tagPickables = (list, target) => { for (const m of list || []) { m.userData.bbTarget = target; } };
  const disposeObj = o => { o.traverse(c => { if (c.geometry && !c.geometry.userData?.shared) c.geometry.dispose?.(); }); };

  function ctxFor() { return { materials: materialOf, quality, labels }; }

  function buildBoardRec(b) {
    let h = null;
    if (deps.buildBoard) { try { h = deps.buildBoard(THREE, b, ctxFor()); } catch (err) { console.warn('buildBoard failed, using a stand-in', err); } }
    if (!h || !h.object) h = fallbackBoard(THREE, b, ctxFor());
    h.object.userData.bbId = b.id;
    h.object.traverse(c => { if (c.isMesh && !c.isInstancedMesh) c.receiveShadow = true; });
    tagPickables(h.pickables && h.pickables.length ? h.pickables : [h.object.children.find(c => c.isMesh)].filter(Boolean), { kind: 'board', id: b.id });
    if (!h.pickables || !h.pickables.length) h.pickables = [h.object.children.find(c => c.isMesh)].filter(Boolean);
    gBoards.add(h.object);
    return h;
  }

  function buildPartHandle(def, part, ctx) {
    let h = null;
    try {
      if (deps.buildPart) h = deps.buildPart(THREE, def, part, ctx);
      else if (typeof def.build === 'function') h = def.build(THREE, { ...ctx, def, part });
    } catch (err) { console.warn(`build of ${def.id} failed, using a stand-in`, err); h = null; }
    if (!h || !h.object) h = fallbackPart(THREE, def, part, ctx);
    return h;
  }

  // the build key leaves out the live params (a knob, a held button): a
  // change of only those goes to handle.setParams when the model redraws
  // them itself (handle.liveParams), so the mesh is not rebuilt per tick
  function splitParams(p, def) {
    const live = new Set(((def && def.params) || []).filter(x => x.live).map(x => x.key));
    const fixed = {}, lv = {};
    for (const k of Object.keys(p.params || {})) (live.has(k) ? lv : fixed)[k] = p.params[k];
    return [fixed, lv];
  }
  function partKey(p, def) {
    const custom = def && String(def.id).startsWith('cp-') ? JSON.stringify(def) : '';
    const usesCustomMat = p.looks && Object.values(p.looks).some(v => String(v).startsWith('mat-'));
    return JSON.stringify([p.def, splitParams(p, def)[0], p.label || '', labels, quality, depsVersion, custom, usesCustomMat ? matVersion : 0]);
  }
  const liveKey = (p, def) => JSON.stringify(splitParams(p, def)[1]);

  function buildPartRec(p, def) {
    const d = def || { id: p.def, name: p.def, category: 'custom', mount: 'board', pins: [], params: [], slots: [], model: {} };
    const handle = buildPartHandle(d, p, ctxFor());
    handle.object.userData.bbId = p.id;
    handle.object.traverse(c => { if (c.isMesh && !c.isSprite) c.castShadow = true; });
    gParts.add(handle.object);
    const controls = addControls(handle);
    tagPickables(handle.pickables, { kind: 'part', id: p.id });
    const rec = { item: p, handle, key: partKey(p, def), live: liveKey(p, def), looks: JSON.stringify(p.looks || {}), damage: null, def: d, halos: markEmitters(handle.object), controls };
    const pf = lastFrame && lastFrame.parts ? lastFrame.parts[p.id] : undefined;
    if (pf) applyPartFrame(rec, pf, 0);
    return rec;
  }

  function disposeRec(rec, group) {
    try { rec.handle.dispose(); } catch { /* already gone */ }
    group.remove(rec.handle.object);
  }

  function setPartTransform(rec, doc) {
    const f = partFrame(doc, rec.item);
    const o = rec.handle.object;
    o.position.set(f.x, f.y, f.z);
    o.rotation.set(0, -f.rot * Math.PI / 2, 0);
  }

  function applyLooks(rec, p) {
    const s = JSON.stringify(p.looks || {});
    if (s === rec.looks) return;
    const prev = JSON.parse(rec.looks);
    const now2 = p.looks || {};
    for (const slot of new Set([...Object.keys(prev), ...Object.keys(now2)])) {
      if (prev[slot] === now2[slot]) continue;
      const sd = (rec.def.slots || []).find(x => x.key === slot);
      const id = now2[slot] || (sd && sd.default);
      if (id) { try { rec.handle.setLook(slot, materialOf(id)); } catch (err) { console.warn('setLook failed', err); } }
    }
    rec.looks = s;
  }

  // ── wire ends ────────────────────────────────────────────────────────────
  const v3 = new THREE.Vector3();
  function endWorld(end, doc = shown || store.doc) {
    if (!end) return null;
    if (end.hole) { const w = holeWorld(doc, end.hole); return w ? [w.x, w.y, w.z] : null; }
    if (end.part) {
      const rec = recs.parts.get(end.part);
      if (rec) {
        const pin = rec.handle.pins.find(q => q.name === String(end.pin));
        if (pin) { rec.handle.object.updateMatrixWorld(true); v3.copy(pin.local).applyMatrix4(rec.handle.object.matrixWorld); return [v3.x, v3.y, v3.z]; }
      }
      const part = doc.parts.find(q => q.id === end.part);
      const def = part && lookupDef(doc, registry, part.def);
      if (!def) return null;
      const p = partPinsWorld(doc, part, def).find(q => q.pin === String(end.pin));
      return p ? [p.x, p.y, p.z] : null;
    }
    return null;
  }

  const wirePathFn = (a, b, style, via) => {
    if (deps.wirePath) { try { return deps.wirePath(a, b, style, via); } catch { /* fall back */ } }
    return fallbackWirePath(a, b, style, via);
  };
  const buildWireFn = o => {
    if (deps.buildWire) { try { return deps.buildWire(THREE, o); } catch (err) { console.warn('buildWire failed', err); } }
    return fallbackWire(THREE, o);
  };
  const wireMeshes = h => { const out = []; h.object.traverse(c => { if (c.isMesh) out.push(c); }); return out; };

  function syncWires(doc) {
    const seen = new Set();
    for (const w of doc.wires) {
      seen.add(w.id);
      const a = endWorld(w.a, doc), b = endWorld(w.b, doc);
      let rec = recs.wires.get(w.id);
      if (!a || !b) { if (rec) rec.handle.object.visible = false; continue; }
      const pts = wirePathFn(a, b, w.style, w.style === 'free' ? (w.via || []) : []);
      const key = JSON.stringify(pts.map(p => p.map(v => Math.round(v * 1000) / 1000)));
      const skey = (w.gauge || 22) + '|' + depsVersion + '|' + quality;     // a change here rebuilds
      if (rec && rec.skey !== skey) { disposeRec(rec, gWires); recs.wires.delete(w.id); rec = null; }
      if (!rec) {
        const handle = buildWireFn({ points: pts, color: w.color, gauge: w.gauge || 22, quality });
        handle.object.userData.bbId = w.id;
        gWires.add(handle.object);
        tagPickables(wireMeshes(handle), { kind: 'wire', id: w.id });
        rec = { item: w, handle, key, skey, color: w.color, pts };
        recs.wires.set(w.id, rec);
        pickDirty = true;
        continue;
      }
      rec.handle.object.visible = true;
      if (rec.key !== key) {
        rec.handle.setPoints(pts);
        rec.key = key;
        tagPickables(wireMeshes(rec.handle), { kind: 'wire', id: w.id });
        pickDirty = true;
      }
      if (rec.color !== w.color) { if (rec.handle.setColor) rec.handle.setColor(w.color); rec.color = w.color; }
      rec.item = w; rec.pts = pts;
    }
    for (const [id, rec] of recs.wires) if (!seen.has(id)) { disposeRec(rec, gWires); recs.wires.delete(id); pickDirty = true; }
    flow.setPaths([...recs.wires.entries()].filter(([, r]) => r.handle.object.visible).map(([id, r]) => ({ id, pts: r.pts })));
  }

  // ── instruments and leads ────────────────────────────────────────────────
  const leadMats = new Map();
  const leadMat = c => { let m = leadMats.get(c); if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 }); leadMats.set(c, m); } return m; };
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, metalness: 1, roughness: 0.3 });
  const probeBodyGeo = new THREE.CylinderGeometry(1.25, 1.0, 12, 10);
  probeBodyGeo.translate(0, 6 + 2.5, 0);
  probeBodyGeo.userData.shared = true;
  const needleGeo = new THREE.CylinderGeometry(0.28, 0.2, 3, 6);
  needleGeo.translate(0, 1.0, 0);
  needleGeo.userData.shared = true;

  function probeDef(type) {
    const reg = registry && registry.get ? registry.get('inst-' + type) : null;
    if (reg) return reg;
    const m = PROBE_FALLBACK[type] || PROBE_FALLBACK.dmm;
    return { id: 'inst-' + type, name: type, category: 'instruments', mount: 'free', visual: 'meter', pins: [], params: [], slots: [{ key: 'body', default: 'abs-black' }], model: { template: 'box', ...m } };
  }

  function cablePoints(a, b) {
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const lift = 14 + 0.18 * d;
    const top = [b[0], b[1] + 14.5, b[2]];
    const c = [(a[0] + top[0]) / 2, Math.max(a[1], top[1]) + lift, (a[2] + top[2]) / 2];
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18, u = 1 - t;
      pts.push(new THREE.Vector3(u * u * a[0] + 2 * u * t * c[0] + t * t * top[0], u * u * a[1] + 2 * u * t * c[1] + t * t * top[1], u * u * a[2] + 2 * u * t * c[2] + t * t * top[2]));
    }
    return pts;
  }

  function leadRec(probeRec, m, name, idx, count, doc) {
    const h = probeRec.handle;
    h.object.updateMatrixWorld(true);
    const jl = h.leads && h.leads[name];
    const jack = jl ? jl.clone().applyMatrix4(h.object.matrixWorld) : new THREE.Vector3(0, 10, 0).applyMatrix4(h.object.matrixWorld);
    const end = m.leads ? m.leads[name] : null;
    let tip = null, attached = false;
    if (leadOverride.probe === m.id && leadOverride.lead === name && leadOverride.pos) tip = leadOverride.pos;
    else if (end) { tip = endWorld(end, doc); attached = !!tip; }
    if (!tip) {
      // Parked on the mat in front of the instrument, side by side.
      const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -(m.place.rot || 0) * Math.PI / 2);
      const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -(m.place.rot || 0) * Math.PI / 2);
      const off = (idx - (count - 1) / 2) * 9;
      tip = [jack.x + fwd.x * 34 + side.x * off, 0, jack.z + fwd.z * 34 + side.z * off];
    }
    const key = [jack.x, jack.y, jack.z, ...tip].map(v => v.toFixed(2)).join(',') + attached;
    let L = probeRec.leads.get(name);
    const color = LEAD_COLORS[name] || '#888888';
    if (!L) {
      const cable = new THREE.Mesh(new THREE.BufferGeometry(), leadMat(color));
      cable.castShadow = true;
      const body = new THREE.Mesh(probeBodyGeo, leadMat(color));
      const needle = new THREE.Mesh(needleGeo, tipMat);
      const grp = new THREE.Group();
      grp.add(body, needle);
      gProbes.add(cable, grp);
      body.userData.bbTarget = { kind: 'lead', probe: m.id, lead: name };
      L = { cable, grp, body, key: '' };
      probeRec.leads.set(name, L);
      pickDirty = true;
    }
    if (L.key !== key) {
      L.cable.geometry.dispose();
      L.cable.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cablePoints([jack.x, jack.y, jack.z], tip)), 28, 0.85, 6, false);
      L.grp.position.set(tip[0], tip[1] - (attached ? 1.6 : 0), tip[2]);
      L.grp.rotation.z = attached ? 0 : Math.PI / 2.3;
      L.key = key;
    }
    L.tip = [tip[0], tip[1] + 8, tip[2]];
    L.attached = attached;
  }

  function disposeProbeRec(rec) {
    for (const L of rec.leads.values()) { L.cable.geometry.dispose(); gProbes.remove(L.cable); gProbes.remove(L.grp); }
    disposeRec(rec, gProbes);
  }

  function syncProbes(doc) {
    const seen = new Set();
    for (const m of doc.probes) {
      seen.add(m.id);
      let rec = recs.probes.get(m.id);
      const key = m.type + '|' + depsVersion + '|' + quality + '|' + labels;
      if (rec && rec.key !== key) { disposeProbeRec(rec); recs.probes.delete(m.id); rec = null; }
      if (!rec) {
        const def = probeDef(m.type);
        const pseudo = { id: m.id, def: def.id, place: { on: null, x: m.place.x, z: m.place.z, rot: m.place.rot || 0 }, params: {} };
        const handle = buildPartHandle(def, pseudo, ctxFor());
        handle.object.userData.bbId = m.id;
        handle.object.traverse(c => { if (c.isMesh) c.castShadow = true; });
        tagPickables(handle.pickables, { kind: 'probe', id: m.id });
        gProbes.add(handle.object);
        rec = { item: m, handle, key, leads: new Map(), def, halos: markEmitters(handle.object) };
        recs.probes.set(m.id, rec);
        pickDirty = true;
      }
      rec.item = m;
      rec.handle.object.position.set(m.place.x, 0, m.place.z);
      rec.handle.object.rotation.set(0, -(m.place.rot || 0) * Math.PI / 2, 0);
      const names = (probeDefaults(m.type) || { leads: [] }).leads;
      names.forEach((n, i) => leadRec(rec, m, n, i, names.length, doc));
      for (const n of [...rec.leads.keys()]) if (!names.includes(n)) { const L = rec.leads.get(n); L.cable.geometry.dispose(); gProbes.remove(L.cable, L.grp); rec.leads.delete(n); }
    }
    for (const [id, rec] of recs.probes) if (!seen.has(id)) { disposeProbeRec(rec); recs.probes.delete(id); pickDirty = true; }
  }

  // ── the document diff ────────────────────────────────────────────────────
  function sync(doc) {
    if (disposed) return;
    shown = doc;
    refreshResolver(doc);
    // Boards
    const seenB = new Set();
    for (const b of doc.boards) {
      seenB.add(b.id);
      let rec = recs.boards.get(b.id);
      const key = JSON.stringify([b.type, b.params || null, b.looks || null, quality, depsVersion, matVersion]);
      if (rec && rec.key !== key) { disposeRec(rec, gBoards); recs.boards.delete(b.id); rec = null; }
      if (!rec) { rec = { handle: buildBoardRec(b), key, item: b }; recs.boards.set(b.id, rec); pickDirty = true; }
      rec.item = b;
      rec.handle.object.position.set(b.x, 0, b.z);
      rec.handle.object.rotation.set(0, -(b.rot || 0) * Math.PI / 2, 0);
    }
    for (const [id, rec] of recs.boards) if (!seenB.has(id)) { disposeRec(rec, gBoards); recs.boards.delete(id); pickDirty = true; }
    // Parts
    const seenP = new Set();
    for (const p of doc.parts) {
      seenP.add(p.id);
      const def = lookupDef(doc, registry, p.def);
      let rec = recs.parts.get(p.id);
      if (rec && rec.item !== p) {
        const lk = liveKey(p, def);
        const liveOk = lk === rec.live || (rec.handle.liveParams === true && typeof rec.handle.setParams === 'function');
        if (rec.key !== partKey(p, def) || !liveOk) { disposeRec(rec, gParts); recs.parts.delete(p.id); rec = null; }
        else {
          if (lk !== rec.live) { try { rec.handle.setParams(p.params || {}); } catch (e) { /* model error: keep the mesh */ } rec.live = lk; requestRender(); }
          applyLooks(rec, p); rec.item = p;
        }
      }
      if (!rec) { rec = buildPartRec(p, def); recs.parts.set(p.id, rec); pickDirty = true; }
      setPartTransform(rec, doc);
    }
    for (const [id, rec] of recs.parts) if (!seenP.has(id)) { disposeRec(rec, gParts); effects.setScorch(id, null); recs.parts.delete(id); pickDirty = true; }
    root.updateMatrixWorld(true);
    syncWires(doc);
    syncProbes(doc);
    refreshPoints();
    if (!previewing) {
      const keep = [...selection].filter(id => recs.parts.has(id) || recs.boards.has(id) || recs.wires.has(id) || recs.probes.has(id));
      if (keep.length !== selection.size) setSelection(keep);
    }
    refreshSelectionBoxes();
    if (netNode !== null) highlightNet(netNode, netTarget);
    requestRender();
  }

  // Socket pins and lead tips, as points for picking.
  function refreshPoints() {
    socketPoints = [];
    for (const [id, rec] of recs.parts) {
      const def = rec.def;
      const sockets = new Set((def.pins || []).filter(p => p.socket).map(p => p.name));
      if (!sockets.size) continue;
      rec.handle.object.updateMatrixWorld(true);
      for (const pin of rec.handle.pins) {
        if (!sockets.has(pin.name)) continue;
        const w = pin.local.clone().applyMatrix4(rec.handle.object.matrixWorld);
        socketPoints.push({ p: [w.x, w.y, w.z], part: id, pin: pin.name });
      }
    }
    leadPoints = [];
    for (const [id, rec] of recs.probes) for (const [name, L] of rec.leads) if (L.tip) leadPoints.push({ p: L.tip, probe: id, lead: name });
  }

  function refreshPickables() {
    if (!pickDirty) return;
    pickables = [];
    for (const r of recs.parts.values()) pickables.push(...(r.handle.pickables || []));
    for (const r of recs.wires.values()) if (r.handle.object.visible) r.handle.object.traverse(c => { if (c.isMesh) pickables.push(c); });
    for (const r of recs.probes.values()) { pickables.push(...(r.handle.pickables || [])); for (const L of r.leads.values()) pickables.push(L.body); }
    for (const r of recs.boards.values()) pickables.push(...(r.handle.pickables || []));
    pickDirty = false;
  }

  // ── picking ──────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const ndcV = new THREE.Vector2();
  let lastHit = null, lastPointer = null;
  function rect() {
    if (canvas && canvas.getBoundingClientRect) {
      const r = canvas.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return r;
    }
    const s = renderer.getSize ? renderer.getSize(new THREE.Vector2()) : { x: 800, y: 500 };
    return { left: 0, top: 0, width: s.x || 800, height: s.y || 500 };
  }
  // the camera view offset (insets, or the saver's band), or null
  const viewOf = () => (camera.view && camera.view.enabled ? camera.view : null);
  function rayAt(cx, cy) {
    const r = rect();
    const ndc = ndcFromClient(cx, cy, r, viewOf());
    // inside: the pointer is on the canvas (with a view offset the NDC of
    // the visible window is not -1 … 1)
    const inside = cx >= r.left - 0.01 * r.width && cx <= r.left + 1.01 * r.width && cy >= r.top - 0.01 * r.height && cy <= r.top + 1.01 * r.height;
    // ndc: of the full image (the plain-data ray); ndcCanvas: of the canvas
    // (THREE's projection matrix already holds the view offset)
    return { ndc, ndcCanvas: ndcFromClient(cx, cy, r), ray: rayFromCamera(rig.cam(), ndc.x, ndc.y), r, inside };
  }
  const targetOf = obj => { let o = obj; while (o) { if (o.userData && o.userData.bbTarget) return o.userData.bbTarget; o = o.parent; } return null; };

  // mode: 'select' (a board hit becomes its hole, with the board id),
  // 'endpoint' (holes and socket pins first), 'delete' (raw mesh targets).
  function pick(cx, cy, mode = 'select', o = {}) {
    const t = pickRaw(cx, cy, mode);
    if (!(o.slop > 0) || mode !== 'select' || (lastHit && isControl(lastHit.object))) return t;
    // touch: take the nearest control when the finger is near one and the
    // ray found nothing, a board, a hole or the same part
    const near = nearestControl(cx, cy, o.slop);
    if (!near) return t;
    if (t && !(t.kind === 'board' || t.kind === 'hole' || (t.kind === 'part' && t.id === near.id))) return t;
    const target = { kind: 'part', id: near.id };
    lastHit = { object: near.mesh, point: near.point, target };
    return target;
  }
  function pickRaw(cx, cy, mode = 'select') {
    lastPointer = { x: cx, y: cy };
    lastHit = null;
    const { ndcCanvas, ray, inside } = rayAt(cx, cy);
    if (!inside) return null;
    const doc = shown || store.doc;
    if (mode !== 'endpoint') {
      const lt = pickPoints(ray, leadPoints, 3.2);
      if (lt) return { kind: 'lead', probe: lt.probe, lead: lt.lead };
    }
    if (mode === 'endpoint') {
      const sp = pickPoints(ray, socketPoints, 2.2);
      if (sp) return { kind: 'pin', part: sp.part, pin: sp.pin };
      const bench = pickBench(doc, ray, 1.27);
      if (bench.hole) return { kind: 'hole', hole: bench.hole };
      return null;
    }
    refreshPickables();
    rig.apply(camera);
    ndcV.set(ndcCanvas.x, ndcCanvas.y);
    raycaster.setFromCamera(ndcV, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    for (const h of hits) {
      const t = targetOf(h.object);
      if (!t) continue;
      lastHit = { object: h.object, point: h.point, target: t };
      if (t.kind === 'board' && mode === 'select') {
        const bench = pickBench(doc, ray, 1.27);
        if (bench.hole) return { kind: 'hole', hole: bench.hole, board: t.id };
      }
      return t;
    }
    return null;
  }

  // The bench point under the pointer: the top of a board when one is
  // under it (unless boardY === 0 asks for the mat), else the mat.
  function benchPoint(cx, cy, boardY) {
    const { ray } = rayAt(cx, cy);
    const doc = shown || store.doc;
    if (boardY !== 0) {
      const top = rayPlaneY(ray, BOARD_H);
      if (top && boardHit(doc, top.x, top.z)) return { x: top.x, y: BOARD_H, z: top.z };
    }
    const m = rayPlaneY(ray, 0);
    if (!m) return null;
    return { x: Math.max(-MAT_W / 2, Math.min(MAT_W / 2, m.x)), y: 0, z: Math.max(-MAT_D / 2, Math.min(MAT_D / 2, m.z)) };
  }

  function overCanvas(cx, cy) { const r = rect(); return cx >= r.left && cx <= r.left + r.width && cy >= r.top && cy <= r.top + r.height; }

  // ── nets ─────────────────────────────────────────────────────────────────
  function nodeOf(t) {
    if (!t) return null;
    if (t.kind === 'hole') {
      if (netlist && netlist.holeNode && netlist.holeNode[t.hole] !== undefined) return netlist.holeNode[t.hole];
      return { strip: t.hole };
    }
    if (t.kind === 'pin') {
      const v = netlist && netlist.pinNode ? netlist.pinNode[t.part + '.' + t.pin] : undefined;
      return v === undefined ? null : v;
    }
    if (t.kind === 'lead') {
      const m = (shown || store.doc).probes.find(q => q.id === t.probe);
      const e = m && m.leads[t.lead];
      if (!e) return null;
      return nodeOf(e.hole ? { kind: 'hole', hole: e.hole } : { kind: 'pin', part: e.part, pin: e.pin });
    }
    return null;
  }

  function highlightNet(node, target) {
    netNode = node === undefined ? null : node;
    netTarget = target || null;
    const pts = [];
    const doc = shown || store.doc;
    if (node !== null && node !== undefined) {
      if (typeof node === 'object' && node.strip) {
        // No netlist yet: light the strip of the hole.
        const h = parseHoleId(node.strip);
        const b = h && findBoard(doc, h.board);
        if (b) {
          const sid = stripOf(b.type, h.local, b.params);
          for (const l of strips(b.type, b.params)[sid] || []) { const w = holeWorld(doc, b.id + ':' + l); pts.push([w.x, w.y, w.z]); }
        }
      } else if (netlist) {
        for (const [hole, n] of Object.entries(netlist.holeNode || {})) if (n === node) { const w = holeWorld(doc, hole); if (w) pts.push([w.x, w.y, w.z]); }
        for (const [key, n] of Object.entries(netlist.pinNode || {})) {
          if (n !== node) continue;
          // Pin names may hold dots (GND.1); part ids never do.
          const j = key.indexOf('.');
          const part = key.slice(0, j), pin = key.slice(j + 1);
          const w = endWorld({ part, pin }, doc);
          if (w) pts.push(w);
        }
      }
    }
    effects.setNetMarkers(pts);
    requestRender();
    return pts.length;
  }

  // ── frames ───────────────────────────────────────────────────────────────
  function applyPartFrame(rec, pf, dt) {
    try { rec.handle.setState(pf, dt); } catch (err) { if (!rec.warned) { rec.warned = true; console.warn('setState failed', err); } }
    const dmg = (pf && pf.damaged) || null;
    if (dmg !== rec.damage) {
      rec.damage = dmg;
      try { rec.handle.setDamage(dmg); } catch (err) { console.warn('setDamage failed', err); }
      if (dmg === 'burnt' || dmg === 'vented') {
        const box = new THREE.Box3().setFromObject(rec.handle.object);
        const c = box.getCenter(new THREE.Vector3());
        const r = Math.max(3, Math.min(14, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.7));
        effects.setScorch(rec.item.id, { x: c.x, y: rec.item.place.on ? BOARD_H : 0, z: c.z }, r);
      } else effects.setScorch(rec.item.id, null);
    }
  }

  function setFrame(frame) {
    if (disposed || !frame) return;
    const t = now();
    const dt = frameWall ? Math.min(0.25, (t - frameWall) / 1000) : 0;
    frameWall = t;
    lastFrame = frame;
    lastFrameAt = t;
    const parts = frame.parts || {};
    for (const [id, rec] of recs.parts) applyPartFrame(rec, parts[id], dt);
    for (const [id, rec] of recs.probes) {
      if (rec.handle.setState) { try { rec.handle.setState(frame.probes ? { probe: frame.probes[id] } : undefined, dt); } catch { /* instrument models may ignore it */ } }
      for (const s of Object.values(rec.handle.screens || {})) if (s.texture) s.texture.needsUpdate = true;
    }
    if (netlist && frame.wires) flow.setCurrents(netlist.wireIds || [], frame.wires);
    balanceHalos();
    needs = true;
  }

  // ── selection ────────────────────────────────────────────────────────────
  function objectOf(id) {
    const r = recs.parts.get(id) || recs.boards.get(id) || recs.wires.get(id) || recs.probes.get(id);
    return r ? r.handle.object : null;
  }
  function refreshSelectionBoxes() {
    const boxes = [];
    for (const id of selection) { const o = objectOf(id); if (o && o.visible) boxes.push(new THREE.Box3().setFromObject(o)); }
    effects.setBoxes(boxes);
  }
  function setSelection(ids) {
    const next = [...new Set(ids)].filter(id => objectOf(id));
    const same = next.length === selection.size && next.every(id => selection.has(id));
    selection.clear();
    for (const id of next) selection.add(id);
    refreshSelectionBoxes();
    requestRender();
    if (!same && bus) bus.emit('select', { ids: next });
  }

  function targetPoint(t) {
    if (!t) return null;
    const doc = shown || store.doc;
    if (t.kind === 'hole') { const w = holeWorld(doc, t.hole); return w ? [w.x, w.y, w.z] : null; }
    if (t.kind === 'pin') return endWorld({ part: t.part, pin: t.pin }, doc);
    if (t.kind === 'lead') { const r = recs.probes.get(t.probe); const L = r && r.leads.get(t.lead); return L ? L.tip : null; }
    if (t.kind === 'wire') { const r = recs.wires.get(t.id); if (!r) return null; return r.pts[Math.floor(r.pts.length / 2)]; }
    const o = objectOf(t.id || t.part);
    if (!o) return null;
    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    return [c.x, c.y, c.z];
  }
  function screenPos(t) {
    const p = targetPoint(t);
    if (!p) return null;
    const pr = projectPoint(rig.cam(), p, rect(), viewOf());
    return pr ? { x: pr.x, y: pr.y } : null;
  }

  function itemsInRect(r) {
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    const out = [];
    const test = (id, t) => { const s = screenPos(t); if (s && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) out.push(id); };
    for (const id of recs.parts.keys()) test(id, { kind: 'part', id });
    for (const id of recs.probes.keys()) test(id, { kind: 'probe', id });
    for (const id of recs.wires.keys()) test(id, { kind: 'wire', id });
    return out;
  }

  function setBoxRect(r) {
    if (!hasDOM || !canvas || !canvas.parentElement) return;
    if (!r) { if (boxEl) boxEl.hidden = true; return; }
    if (!boxEl) {
      boxEl = document.createElement('div');
      boxEl.className = 'bb-box-select';
      Object.assign(boxEl.style, { position: 'absolute', border: '1px dashed #6b9fe2', background: 'rgba(107,159,226,.12)', pointerEvents: 'none', zIndex: 3, borderRadius: '4px' });
      canvas.parentElement.appendChild(boxEl);
    }
    const pr = canvas.parentElement.getBoundingClientRect();
    boxEl.hidden = false;
    Object.assign(boxEl.style, { left: Math.min(r.x0, r.x1) - pr.left + 'px', top: Math.min(r.y0, r.y1) - pr.top + 'px', width: Math.abs(r.x1 - r.x0) + 'px', height: Math.abs(r.y1 - r.y0) + 'px' });
  }

  // ── ghosts and previews ──────────────────────────────────────────────────
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0x9fc3ff, transparent: true, opacity: 0.45, roughness: 0.4, depthWrite: false });
  function makeGhost(def, params) {
    const h = buildPartHandle(def, { id: 'ghost', def: def.id, place: { on: null, x: 0, z: 0, rot: 0 }, params: { ...params } }, { materials: () => ghostMat, quality: 'low', labels: false });
    markEmitters(h.object);
    h.object.traverse(c => { if (c.isMesh) { c.castShadow = false; c.material = ghostMat; } });
    h.object.visible = false;
    gGhost.add(h.object);
    return h;
  }
  function makeProbeGhost(type) { return makeGhost(probeDef(type), {}); }
  function showGhost(h, s) {
    if (!h) return;
    h.object.visible = !!s;
    if (s) { h.object.position.set(s.x, s.y || 0, s.z); h.object.rotation.set(0, -(s.rot || 0) * Math.PI / 2, 0); }
    requestRender();
  }
  function disposeGhost(h) { if (!h) return; try { h.dispose(); } catch { /* fine */ } gGhost.remove(h.object); requestRender(); }

  function setWirePreview(p) {
    if (!p) { if (wirePrev) { wirePrev.handle.dispose(); gGhost.remove(wirePrev.handle.object); wirePrev = null; } requestRender(); return; }
    const a = endWorld(p.a);
    if (!a) return;
    const pts = wirePathFn(a, p.bPoint, p.style, p.style === 'free' ? p.via : []);
    if (!wirePrev || wirePrev.color !== p.color) {
      if (wirePrev) { wirePrev.handle.dispose(); gGhost.remove(wirePrev.handle.object); }
      wirePrev = { handle: buildWireFn({ points: pts, color: p.color, gauge: 22, quality }), color: p.color };
      gGhost.add(wirePrev.handle.object);
    } else wirePrev.handle.setPoints(pts);
    requestRender();
  }

  function setLeadPreview(probe, lead, pos) {
    leadOverride.probe = probe || null; leadOverride.lead = lead || null; leadOverride.pos = pos || null;
    const doc = shown || store.doc;
    syncProbes(doc);
    refreshPoints();
    requestRender();
  }

  // doc: show it. null: back to the store document. null with keep: the
  // caller writes the store next, and that change syncs (no flicker).
  function previewDoc(doc, keep) {
    if (doc) { previewing = true; sync(doc); return; }
    previewing = false;
    if (!keep) sync(store.doc);
  }

  // ── camera helpers ───────────────────────────────────────────────────────
  function emitCamera(mode) { if (bus) bus.emit('camera', { mode }); }
  function benchBox() {
    const box = new THREE.Box3();
    let any = false;
    for (const r of [...recs.boards.values(), ...recs.parts.values(), ...recs.probes.values()]) { box.expandByObject(r.handle.object); any = true; }
    if (!any) box.set(new THREE.Vector3(-90, 0, -40), new THREE.Vector3(90, 10, 40));
    return box;
  }
  function fit(ms = 650) {
    const b = benchBox();
    rig.animateTo(rig.fitPose({ min: b.min.toArray(), max: b.max.toArray() }, { pitch: rig.isTop() ? PITCH_TOP : Math.max(0.75, Math.min(1.15, rig.state.pitch)) }), ms, now());
    emitCamera('orbit');
    requestRender();
  }
  function focus(id, ms = 600) {
    const o = objectOf(id);
    if (!o) return false;
    const b = new THREE.Box3().setFromObject(o);
    const pose = rig.fitPose({ min: b.min.toArray(), max: b.max.toArray() }, { margin: 2.4 });
    pose.dist = Math.max(70, pose.dist);
    rig.animateTo(pose, ms, now());
    emitCamera('focus');
    requestRender();
    return true;
  }

  // ── render loop ──────────────────────────────────────────────────────────
  let rafId = null, lastTick = 0, lastRender = 0;
  function requestRender() { needs = true; }
  function render() {
    rig.apply(camera);
    if (composer) composer.render(); else renderer.render(scene, camera);
    needs = false;
  }
  function tick(t = now()) {
    if (disposed) return false;
    const dt = lastTick ? Math.min(0.1, Math.max(0, (t - lastTick) / 1000)) : 1 / 60;
    lastTick = t;
    const moving = rig.update(t);
    const fx = effects.update(dt);
    const running = !!(lastFrame && lastFrame.running && t - lastFrameAt < 600);
    const fl = running ? flow.update(dt) : false;
    let did = false;
    if (needs || moving || fx || fl || running) {
      if (!(running && phone && t - lastRender < 32 && !needs && !moving)) { render(); lastRender = t; did = true; }
    }
    return did;
  }
  function loop(t) { if (disposed) return; rafId = raf(loop); tick(t); }

  function resize() {
    if (disposed) return;
    const w = (canvas && canvas.clientWidth) || 800, h = (canvas && canvas.clientHeight) || 500;
    const dpr = hasDOM ? (window.devicePixelRatio || 1) : 1;
    renderer.setPixelRatio(Math.min(dpr, phone ? 1.5 : 2));
    renderer.setSize(w, h, false);
    if (composer) { composer.setPixelRatio(Math.min(dpr, 2)); composer.setSize(w, h); }
    rig.setAspect(w / Math.max(1, h));
    applyInsets(w, h);
    requestRender();
  }
  // frame the bench between the open panel columns (CONTRACT 8): a view
  // offset moves the image centre into the free band. main.js passes the
  // ui 'layout' insets; the saver sets its own offset while it runs.
  let insets = null;
  function applyInsets(w, h) {
    if (!insets) return;
    w = w || (canvas && canvas.clientWidth) || 800; h = h || (canvas && canvas.clientHeight) || 500;
    const v = insetViewOffset(insets, w, h);
    if (v) camera.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, v.width, v.height);
    else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  }

  // ── interaction ──────────────────────────────────────────────────────────
  const V = {
    THREE, store, bus, rig, effects, selection,
    get registry() { return registry; },
    get lastHit() { return lastHit; },
    get lastPointer() { return lastPointer; },
    now, pick, benchPoint, overCanvas, endWorld, nodeOf, highlightNet, requestRender, emitCamera,
    defOf, partRec: id => recs.parts.get(id) || null,
    makeGhost, makeProbeGhost, showGhost, disposeGhost, setWirePreview, setLeadPreview, previewDoc,
    setSelection, itemsInRect, setBoxRect, focus, fit,
    topView: () => api.topView(), orbitView: () => api.orbitView(),
    setCursor(c) { if (canvas && canvas.style) canvas.style.cursor = c; },
    setControlHover, showRims,
  };
  const interaction = createInteraction(V);
  const gestures = createGestures({
    ...interaction.handlers,
    pan(e) { rig.pan(e.dx, e.dy, rect().height); requestRender(); emitCamera('orbit'); },
    zoom(e) {
      const b = benchPoint(e.x, e.y);
      rig.zoom(e.factor, b ? [b.x, b.y, b.z] : null);
      requestRender();
    },
    twist(e) { rig.orbit(-e.da, 0); requestRender(); },
    any(type) { if (type !== 'hover') needs = true; },
  }, { now });
  if (hasDOM && canvas && canvas.addEventListener) offs.push(attachGestures(canvas, gestures));

  // Esc and R act on the view's own transient states even when the UI binds
  // the other keys; opts.keys === true binds all of them here.
  if (hasDOM) {
    const onKey = e => {
      if (opts.keys === true || (interaction.transient && (e.key === 'Escape' || e.key === 'r' || e.key === 'R'))) {
        if (interaction.handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    offs.push(() => window.removeEventListener('keydown', onKey, true));
    if (typeof ResizeObserver !== 'undefined' && canvas) {
      const ro = new ResizeObserver(() => resize());
      ro.observe(canvas);
      offs.push(() => ro.disconnect());
    } else {
      window.addEventListener('resize', resize);
      offs.push(() => window.removeEventListener('resize', resize));
    }
  }
  // rims show in the tools that work the controls
  function controlTool(t) { const on = !rimsOff && (t === 'select' || t === 'probe'); if (!on) setControlHover(null); if (on !== rimsOn) showRims(on); }
  if (bus) {
    offs.push(bus.on('tool', e => controlTool(e && e.tool)));
    offs.push(bus.on('doc:change', e => {
      interaction.onDocChange(e);
      if (!previewing || (e && e.source !== 'user')) { previewing = false; sync(store.doc); }
    }));
  }

  // ── public API ───────────────────────────────────────────────────────────
  const api = {
    get canvas() { return canvas; },
    get renderer() { return renderer; },
    get scene() { return scene; },
    get camera() { return camera; },
    get rig() { return rig; },
    get tool() { return interaction.tool; },
    get quality() { return quality; },
    get haloGain() { return haloGainNow; },
    get controlHover() { return hotControl; },
    // false: hide the control rims (the saver); true: they follow the tool
    setControlRims(on) { rimsOff = on === false; controlTool(interaction.tool); },
    controlsOf(id) { const r = recs.parts.get(id); return r ? (r.controls || []) : []; },
    get bloom() { return bloomPass; },
    ready: null,

    setFrame,
    setNetlist(nl) { netlist = nl || null; if (netNode !== null) highlightNet(netNode && netNode.strip && netTarget ? nodeOf(netTarget) : netNode, netTarget); },
    setTool(t) { interaction.setTool(t); controlTool(interaction.tool); requestRender(); },
    setWireColor(hex) { interaction.setWireColor(hex); },
    setWireStyle(s) { interaction.setWireStyle(s); },
    beginPlace(defId, params, pe) { return interaction.beginPlace(defId, params, pe); },
    beginProbe(type) { return interaction.beginProbe(type); },
    focus, fit,
    topView(ms = 600) { const b = benchBox(); const p = rig.fitPose({ min: b.min.toArray(), max: b.max.toArray() }, { pitch: PITCH_TOP, yaw: 0, margin: 1.08 }); rig.animateTo(p, ms, now()); emitCamera('top'); requestRender(); },
    orbitView(ms = 600) { const b = benchBox(); rig.animateTo(rig.fitPose({ min: b.min.toArray(), max: b.max.toArray() }, { pitch: 0.95, yaw: rig.isTop() ? 0.35 : rig.state.yaw }), ms, now()); emitCamera('orbit'); requestRender(); },
    cameraTo(pose, ms = 600) { rig.animateTo(pose, ms, now()); requestRender(); },
    getCamera() { return rig.pose(); },
    setFlow(on) { flow.setOn(on); requestRender(); },
    getFlow() { return !!flow.on; },
    setInsets(i) { insets = i ? { ...i } : { left: 0, right: 0, top: 0, bottom: 0 }; applyInsets(); requestRender(); },
    setQuality(q) {
      if (q !== 'high' && q !== 'low') return;
      quality = q;
      renderer.shadowMap.enabled = q === 'high';
      if (q === 'low' && composer) { composer.dispose?.(); if (bloomPass && bloomPass.dispose) bloomPass.dispose(); composer = null; bloomPass = null; }
      if (q === 'high') setupBloom();
      resize();
      sync(store.doc);
    },
    setLabels(on) { labels = !!on; sync(store.doc); },
    highlightNet(node) { return highlightNet(node, null); },
    flash(targets) {
      const boxes = [];
      for (const t of targets || []) {
        if (!t) continue;
        const o = t.id ? objectOf(t.id) : t.part && t.kind === 'part' ? objectOf(t.part) : null;
        if (o) { boxes.push(new THREE.Box3().setFromObject(o)); continue; }
        const p = targetPoint(t);
        if (p) boxes.push(new THREE.Box3(new THREE.Vector3(p[0] - 1.5, p[1] - 0.5, p[2] - 1.5), new THREE.Vector3(p[0] + 1.5, p[1] + 2, p[2] + 1.5)));
      }
      effects.flash(boxes);
      requestRender();
      return boxes.length;
    },
    pick(x, y) { const m = interaction.tool === 'wire' || interaction.tool === 'probe' ? 'endpoint' : interaction.tool === 'delete' ? 'delete' : 'select'; return pick(x, y, m); },
    pickAt: pick,
    screenPos,
    screens(probeId) {
      const r = recs.probes.get(probeId) || recs.parts.get(probeId);
      const out = {};
      if (r) for (const [k, s] of Object.entries(r.handle.screens || {})) out[k] = s.ctx;
      return out;
    },
    effect(kind, id) {
      const p = targetPoint({ kind: 'part', id }) || targetPoint({ kind: 'probe', id });
      if (!p) return false;
      const o = objectOf(id);
      const top = o ? new THREE.Box3().setFromObject(o).max.y : p[1];
      const at = { x: p[0], y: top, z: p[2] };
      if (kind === 'spark') effects.spark(at); else effects.smoke(at);
      requestRender();
      return true;
    },
    previewMaterial(spec, size = 96) {
      const mod = deps.materials || (opts.materials && opts.materials.makeMaterial ? opts.materials : null);
      return preview.render(spec, size, mod && mod.makeMaterial ? s => mod.makeMaterial(THREE, s) : null);
    },

    // Beyond the contract, for the UI and main.js:
    select(ids) { setSelection(ids || []); },
    getSelection() { return [...selection]; },
    rotateSelection: () => interaction.rotateSelection(),
    deleteSelection: () => interaction.deleteSelection(),
    duplicateSelection: () => interaction.duplicateSelection(),
    cancel: () => interaction.cancel(),
    handleKey: e => interaction.handleKey(e),
    nodeOf,
    objectOf,
    get wiring() { return interaction.wiring; },
    get placing() { return interaction.placing; },
    setRegistry(r) { registry = r; sync(store.doc); },
    setParts(p) { deps = { ...deps, ...p }; depsVersion++; resolverFor = undefined; sync(store.doc); },
    render() { render(); },
    tick,
    gestures,
    stats() {
      const info = renderer.info && renderer.info.render ? renderer.info.render : { calls: 0, triangles: 0 };
      let tris = 0, meshes = 0;
      scene.traverse(o => {
        if (!o.visible || !(o.isMesh || o.isInstancedMesh) || !o.geometry) return;
        meshes++;
        const g = o.geometry;
        const n = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
        tris += n * (o.isInstancedMesh ? o.count : 1);
      });
      return { calls: info.calls, triangles: info.triangles, meshes, sceneTriangles: Math.round(tris), boards: recs.boards.size, parts: recs.parts.size, wires: recs.wires.size, probes: recs.probes.size };
    },
    dispose() {
      if (disposed) return;
      interaction.dispose();
      disposed = true;
      if (rafId !== null) caf(rafId);
      for (const off of offs.splice(0)) { try { off(); } catch { /* listener gone */ } }
      for (const r of recs.parts.values()) disposeRec(r, gParts);
      for (const r of recs.boards.values()) disposeRec(r, gBoards);
      for (const r of recs.wires.values()) disposeRec(r, gWires);
      for (const r of recs.probes.values()) disposeProbeRec(r);
      recs.parts.clear(); recs.boards.clear(); recs.wires.clear(); recs.probes.clear();
      if (wirePrev) { wirePrev.handle.dispose(); wirePrev = null; }
      effects.dispose(); flow.dispose(); preview.dispose();
      for (const m of [...leadMats.values(), ...simpleMats.values(), tipMat, ghostMat, rimMat, rimHotMat, proxyMat]) m.dispose();
      proxyGeo.dispose();
      probeBodyGeo.dispose(); needleGeo.dispose();
      matMesh.geometry.dispose(); matMesh.material.dispose(); gridTex.dispose();
      disposeObj(scene);
      if (envTex) envTex.dispose();
      if (composer && composer.dispose) composer.dispose();
      if (bloomPass && bloomPass.dispose) bloomPass.dispose();
      if (boxEl && boxEl.parentElement) boxEl.parentElement.removeChild(boxEl);
      renderer.dispose();
      if (renderer.forceContextLoss) { try { renderer.forceContextLoss(); } catch { /* lost already */ } }
    },
  };

  // ── start ────────────────────────────────────────────────────────────────
  resize();
  if (opts.parts) deps = { ...deps, ...opts.parts };
  sync(store.doc);
  if (store.doc.view) rig.setPose(store.doc.view);
  else { const b = benchBox(); rig.setState(rig.fitPose({ min: b.min.toArray(), max: b.max.toArray() }, { pitch: 0.95, yaw: 0 })); }
  api.ready = (opts.parts === false || (opts.parts && opts.parts.buildPart && opts.parts.buildBoard && opts.parts.buildWire)
    ? Promise.resolve(deps)
    : loadParts().then(found => {
      if (disposed) return deps;
      const add = {};
      for (const [k, v] of Object.entries(found)) if (v && !deps[k]) add[k] = v;
      if (Object.keys(add).length) { deps = { ...deps, ...add }; depsVersion++; resolverFor = undefined; sync(store.doc); }
      return deps;
    })).catch(() => deps);
  if (raf) rafId = raf(loop);
  return api;
}

export { BOARD_TYPES, boardRect };
