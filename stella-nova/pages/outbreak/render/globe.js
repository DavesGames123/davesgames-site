// ============================================================================
//  OUTBREAK  ·  render/globe.js — the three.js renderer core
// ----------------------------------------------------------------------------
//  createGlobe(canvas, { D, net, THREE, worldUrl? }) -> Globe
//  The Globe owns the WebGLRenderer (antialias on), the camera, the scene,
//  the field (render/field.js), one style at a time (render/style-*.js) and
//  the layers of package H (render/arcs.js, render/nodes.js), which draw on
//  top of every style. Each style and layer gets the shared context:
//    ctx = { THREE, scene, renderer, camera, D, net, geo, field, mode, root,
//            proj, phone, infect }
//  ctx.infect = { uniforms } holds the uniforms of the infection chunk
//  (render/infect.js): every surface style links the same objects, so the
//  core sets uFieldMix, uAny, uBeat and uIgn once per frame for all.
//  ctx.ignite is the ignition bus (render/ignite.js): the core sets its
//  clock (frame.t), fires the seed cities of a new sim (and the first
//  events when no arcs layer took them), and fills uIgn from it. uBeat is
//  the heartbeat of render/infect.js, from the new cases of the last day.
//  A style gets a copy with root = the style group and mode = its own mode.
//  The layers share one ctx with root = the layer group, and get
//  setMode(mode) when a style switch changes globe <-> flat.
//
//  Loading: night and holo are static imports. Marble, dots, flat, arcs and
//  nodes load with a dynamic import, so the page runs while those files do
//  not exist yet. A style that fails to load leaves `styles`, and
//  setStyle() of it shows night. setStyle() of a style that is still
//  loading shows it when it arrives. `ready` resolves when all loads end.
//  The camera pose comes from camera.js pose(cam, mode): mode is 'globe',
//  or the projection of a flat style (its instance `proj`, else
//  'equirect').
//
//  Frame: update(frame) sets the camera pose, updates the field at most
//  FIELD_HZ times a second, then the style and the layers, then renders.
//    frame = { t, dt, sim, prev: Float32Array(N) I/N, events, mode }
//  The deaths share for the field comes from frame.sim.D / node pop, and
//  the front from frame.sim.firstDay. A new sim resets the front. Between
//  two field updates uFieldMix runs 0 -> 1, so the front crawls smoothly.
//
//  HUD: setHud({ on, rect, focus }) turns on the on-canvas saver HUD
//  (render/hud.js, made on first use) in rect (CSS px). update() draws it
//  from frame.hud (stats.js hud() values, series, curve). It draws after
//  the fade quad, so the numbers stay on through a cut.
//
//  GPU rules: no EffectComposer and no render targets. budget.js caps the
//  pixel ratio at 2 and the drawing buffer at 2560 x 1440 device px (1.6
//  million device px on a phone, ctx.phone). The canvas draws at that
//  ratio with antialias on, so lines and markers stay sharp. The
//  fade (setFade) is a full-screen black quad in the scene, drawn last.
//  On pagehide, dispose() releases every GPU object and calls
//  renderer.forceContextLoss().
//
//  grep -n targets: "export const STYLE_LIST", "export function poseMode",
//                   "export function viewOffsetFor", "export function nodeWorld",
//                   "export function createGlobe", "function applyStyle",
//                   "function applyPose", "function resize", "pick(x, y)",
//                   "project(i)", "dispose()"
// ============================================================================
import { canvasBudget, phoneView } from '../budget.js';
import { createField } from './field.js';
import { infectUniforms, heartbeat, beatShape } from './infect.js';
import { createIgnition } from './ignite.js';
import { createHud } from './hud.js';
import night from './style-night.js';
import holo from './style-holo.js';

import * as geo from '../geo.js';
import { pose } from '../camera.js';

export const STYLE_LIST = [
  { id: 'night', label: 'Night', file: null },
  { id: 'marble', label: 'Marble', file: './style-marble.js' },
  { id: 'dots', label: 'Dots', file: './style-dots.js' },
  { id: 'flat', label: 'Flat map', file: './style-flat.js', proj: 'equirect' },
  // the same flat module in the Equal Earth projection (ctx.proj at create)
  { id: 'equalearth', label: 'Equal Earth', file: './style-flat.js', proj: 'equalearth' },
  { id: 'holo', label: 'Hologram', file: null },
];
export const WORLD_URL = new URL('../../map-projections/data/world.json', import.meta.url);
export const FIELD_HZ = 4;
export const FOV = 35;
export const PICK_PX = 22;

// ── pure helpers (tested in tests/render.test.mjs) ──────────────────────
// The camera.js / geo.js mode for a style mode and a flat projection.
export function poseMode(mode, proj) {
  if (mode !== 'flat') return 'globe';
  return proj === 'equalearth' ? 'equalearth' : 'equirect';
}

// The clear rect (CSS px edges from the top-left) -> setViewOffset x, y,
// so the view centre moves to the centre of the rect.
export function viewOffsetFor(W, H, l, r, t, b) {
  const cx = (l + r) / 2, cy = (t + b) / 2;
  return { x: W / 2 - cx, y: H / 2 - cy };
}

// Node n -> world position in a style mode ('globe' or 'flat').
export function nodeWorld(n, mode, proj = 'equirect') {
  return geo.project(n.lat, n.lon, 0, poseMode(mode, proj));
}

// ── the globe ────────────────────────────────────────────────────────────
export function createGlobe(canvas, { D, net, THREE, worldUrl = WORLD_URL } = {}) {
  const nodes = D && D.nodes ? D.nodes : [];
  const N = nodes.length;
  const pop = Float64Array.from(nodes, n => n.pop || 1);
  const win = typeof window !== 'undefined' ? window : null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
  const styleRoot = new THREE.Group(); styleRoot.name = 'styles';
  const layerRoot = new THREE.Group(); layerRoot.name = 'layers';
  scene.add(styleRoot); scene.add(layerRoot);

  const field = createField(D, THREE);
  // phone: read once at boot; the arcs layer sizes its flight pool by it
  const infect = { uniforms: infectUniforms(THREE, null) };
  const phone0 = phoneView(win);
  const ignite = createIgnition({ phone: phone0 });
  const base = { THREE, scene, renderer, camera, D, net, geo, field, mode: 'globe', root: layerRoot, phone: phone0, infect, ignite };
  const unitPt = Array.from(nodes, n => geo.sphere(n.lat, n.lon));
  let beatPh = 0, igniteSim = null, worldPop = 0;
  for (const n of nodes) worldPop += n.pop || 0;
  const IU = infect.uniforms;

  // fade quad: clip-space, black, alpha = 1 - fade
  const fadeU = { uA: { value: 0 } };
  const fadeGeo = new THREE.PlaneGeometry(2, 2);
  const fadeMat = new THREE.ShaderMaterial({
    uniforms: fadeU, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform float uA; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uA); }',
  });
  const fadeQuad = new THREE.Mesh(fadeGeo, fadeMat);
  fadeQuad.frustumCulled = false; fadeQuad.renderOrder = 1e6; fadeQuad.visible = false;
  scene.add(fadeQuad);

  const mods = { night, holo };
  const failed = new Set();
  const styles = STYLE_LIST.map(s => ({ id: s.id, label: s.label }));
  let want = 'night', cur = null, curId = null, curMode = 'globe';
  const layers = [];
  let disposed = false;
  let camState = { lat: 20, lon: 10, alt: 2.2, tilt: 0, heading: 0 };
  let offset = null, cssW = 0, cssH = 0, fade = 1, lastField = -1, lastSim = null;
  const v3 = new THREE.Vector3();

  function applyStyle() {
    if (disposed) return;
    let id = want;
    if (!mods[id]) { if (failed.has(id) || !STYLE_LIST.some(s => s.id === id)) id = 'night'; else if (cur) return; else id = 'night'; }
    if (id === curId) return;
    if (cur) { try { cur.dispose(); } catch (e) { console.warn('outbreak globe: style dispose', e); } }
    const m = mods[id];
    curMode = m.mode === 'flat' ? 'flat' : 'globe';
    // the flat projection of this style: the arcs and city glows read it
    // from the shared ctx, so set it before the style and the layers build
    const prevProj = base.proj, def = STYLE_LIST.find(s => s.id === id);
    base.proj = (def && def.proj) || 'equirect';
    try { cur = m.create({ ...base, mode: curMode, root: styleRoot }); curId = id; }
    catch (e) { console.warn(`outbreak globe: style ${id} failed`, e); cur = null; curId = null; failed.add(id); if (id !== 'night') { want = 'night'; applyStyle(); } return; }
    if (base.mode !== curMode || base.proj !== prevProj) { base.mode = curMode; for (const l of layers) if (l.setMode) l.setMode(curMode); }
    applyPose();
  }

  function applyPose() {
    const p = pose(camState, poseMode(curMode, cur && cur.proj));
    camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
    camera.up.set(p.up[0], p.up[1], p.up[2]);
    camera.lookAt(p.target[0], p.target[1], p.target[2]);
    camera.updateMatrixWorld();
  }

  function applyOffset() {
    if (offset && cssW > 0 && cssH > 0) {
      const o = viewOffsetFor(cssW, cssH, offset[0], offset[1], offset[2], offset[3]);
      camera.setViewOffset(cssW, cssH, o.x, o.y, cssW, cssH);
    } else if (camera.view && camera.view.enabled) camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function resize() {
    if (disposed) return;
    const w = canvas.clientWidth || (win ? win.innerWidth : 1), h = canvas.clientHeight || (win ? win.innerHeight : 1);
    const bud = canvasBudget(w, h, win ? win.devicePixelRatio : 1, { phone: phoneView(win) });
    cssW = w; cssH = h;
    renderer.setPixelRatio(bud.pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    applyOffset();
  }

  // async loads
  const loads = [];
  for (const s of STYLE_LIST) {
    if (!s.file) continue;
    loads.push(import(s.file).then(m => {
      if (!m.default || typeof m.default.create !== 'function') throw new Error('no default style export');
      mods[s.id] = m.default;
      if (want === s.id) applyStyle();
    }).catch(e => {
      failed.add(s.id);
      const k = styles.findIndex(x => x.id === s.id);
      if (k >= 0) styles.splice(k, 1);
      if (want === s.id) applyStyle();
      if (!/Cannot find|Failed to fetch|404|not found|error loading/i.test(String(e && e.message))) console.warn(`outbreak globe: style ${s.id}`, e);
    }));
  }
  for (const [file, fn] of [['./arcs.js', 'createArcs'], ['./nodes.js', 'createNodes']]) {
    loads.push(import(file).then(m => {
      if (disposed || typeof m[fn] !== 'function') return;
      const l = m[fn](base);
      if (l && l.setMode) l.setMode(base.mode);
      if (l) layers.push(l);
    }).catch(e => console.warn(`outbreak globe: ${file} not loaded`, e && e.message)));
  }
  if (worldUrl) {
    loads.push(fetch(worldUrl).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(j => { if (!disposed) { field.setWorld(j); lastField = -1; } })
      .catch(e => console.warn('outbreak globe: land mask', e.message)));
  }
  const ready = Promise.all(loads);

  const onHide = () => globe.dispose();
  if (win && win.addEventListener) win.addEventListener('pagehide', onHide);

  const dead = new Float32Array(N);
  let hud = null;
  const globe = {
    styles, ready, field, ctx: base,
    get style() { return curId; },
    get mode() { return curMode; },
    setStyle(id) { want = id; applyStyle(); },
    setCamera(cam) { if (cam) { camState = { ...camState, ...cam }; if (!disposed) applyPose(); } },
    setViewOffset(l, r, t, b) {
      offset = (l == null || r == null || t == null || b == null || !(r > l) || !(b > t)) ? null : [l, r, t, b];
      applyOffset();
    },
    update(frame = {}) {
      if (disposed) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if ((w && w !== cssW) || (h && h !== cssH)) resize();
      applyPose();
      const t = frame.t || 0, sim = frame.sim || null, dt = Math.max(0, Math.min(0.1, +frame.dt || 0));
      // ignitions: the seeds of a new sim, first events with no arcs layer
      ignite.now = t; ignite.expire();
      if (sim !== igniteSim) {
        igniteSim = sim; ignite.clear();
        if (sim && sim.firstDay) for (let i = 0; i < N; i++) if (sim.firstDay[i] >= 0) ignite.fire(i, 1);
      }
      if (!layers.some(l => l.ignites) && frame.events) for (const ev of frame.events) if (ev.first && !ev.blocked) ignite.fire(ev.to, 1);
      ignite.slots(i => unitPt[i], IU.uIgn.value);
      // heartbeat: the rate and depth follow the new cases of the last day
      const inc = sim && sim.history && sim.history.inc && sim.history.inc.length ? sim.history.inc[sim.history.inc.length - 1] : 0;
      const hb = heartbeat(worldPop > 0 ? inc / worldPop : 0);
      beatPh = (beatPh + hb.bpm / 60 * dt) % 1;
      IU.uBeat.value = hb.amp * beatShape(beatPh);
      if (field.ready && (sim !== lastSim || lastField < 0 || t - lastField >= 1 / FIELD_HZ || t < lastField)) {
        if (sim !== lastSim) field.reset();
        if (sim && sim.D) for (let i = 0; i < N; i++) dead[i] = sim.D[i] / pop[i];
        else dead.fill(0);
        const step = sim === lastSim && lastField >= 0 && t >= lastField ? t - lastField : 0;
        field.update(frame.prev || null, dead, sim && sim.firstDay ? sim.firstDay : null, step);
        let any = false;
        for (let i = 0; i < N && !any; i++) if (field.reach[i] > 0) any = true;
        IU.uAny.value = any ? 1 : 0;
        lastField = t; lastSim = sim;
      }
      IU.uFieldMix.value = lastField < 0 ? 1 : Math.min(1, Math.max(0, (t - lastField) * FIELD_HZ));
      const f = { ...frame, mode: curMode };
      if (cur && cur.update) cur.update(f);
      for (const l of layers) l.update(f);
      if (hud && hud.on) hud.update(t, frame.hud || null);
      fadeQuad.visible = fade < 0.999;
      fadeU.uA.value = 1 - fade;
      renderer.render(scene, camera);
    },
    pick(x, y) {
      let best = -1, bd = PICK_PX * PICK_PX;
      for (let i = 0; i < N; i++) {
        const p = globe.project(i);
        if (!p.visible) continue;
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
    project(i) {
      const n = nodes[i];
      if (!n || !cssW) return { x: 0, y: 0, visible: false };
      const p = nodeWorld(n, curMode, cur && cur.proj);
      let visible = true;
      if (curMode === 'globe') {
        const c = camera.position;
        visible = p[0] * (c.x - p[0]) + p[1] * (c.y - p[1]) + p[2] * (c.z - p[2]) > 0;
      }
      v3.set(p[0], p[1], p[2]).project(camera);
      const x = (v3.x + 1) / 2 * cssW, y = (1 - v3.y) / 2 * cssH;
      visible = visible && v3.z < 1 && x >= 0 && x <= cssW && y >= 0 && y <= cssH;
      return { x, y, visible };
    },
    resize,
    setFade(a) { fade = Math.max(0, Math.min(1, +a || 0)); },
    setHud(o = {}) {
      if (o.on && !hud && !disposed) { try { hud = createHud(base); } catch (e) { console.warn('outbreak globe: hud', e); hud = null; } }
      if (!hud) return false;
      hud.setRect(o.rect || null); hud.setFocus(o.focus || null); hud.setOn(!!o.on);
      return true;
    },
    get hudOn() { return !!(hud && hud.on); },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (win && win.removeEventListener) win.removeEventListener('pagehide', onHide);
      if (cur) { try { cur.dispose(); } catch (e) { console.warn(e); } cur = null; }
      for (const l of layers) { try { l.dispose(); } catch (e) { console.warn(e); } }
      layers.length = 0;
      if (hud) { hud.dispose(); hud = null; }
      field.dispose();
      fadeGeo.dispose(); fadeMat.dispose();
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
    },
  };

  resize();
  applyStyle();
  return globe;
}
