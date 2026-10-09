// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · view3d/index.js — the 3D instrument view
// ────────────────────────────────────────────────────────────────────────────
//  createStringView3D(canvas, opts) makes the renderer, scene, lights and
//  camera, builds one generic instrument (models.js) and its live strings
//  (strings3d.js), and returns the view object that README.md documents.
//
//  The view never steps a simulation. The page steps the StringSims and
//  calls view.frame(dtWall, dtSim) once per animation frame.
//
//  Orientation: in a landscape canvas the neck points right. In a portrait
//  canvas (height > 1.1 width) the holder group turns the instrument 90
//  degrees, so the neck points up and the instrument fills the pane.
//
//  SECTION MAP   (grep -n "<anchor>" index.js)
//    renderer and scene ... "function makeRenderer", "function lights"
//    instrument swap ...... "setInstrument("
//    colour state ......... "function refreshLut"
//    bow motion ........... "function moveBow"
//    camera presets ....... "function presetPose", "setCamera("
//    frame loop ........... "function frame("
//    picking .............. "stringAt("
//    teardown ............. "dispose()"
// ════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as CM from '../../ct-lab/colormaps/maps.js';
import { INSTRUMENTS } from '../engine/instruments.js';
import { buildModel } from './models.js';
import { LiveStrings, FIELDS, linearLut } from './strings3d.js';
import { disposeTextures, setTextureScale } from './textures.js';

export { FIELDS };
export const CAMERA_PRESETS = [
  { id: 'instrument', label: 'Whole instrument' },
  { id: 'soundhole', label: 'Strings over the sound hole' },
  { id: 'string', label: 'Along one string' },
  { id: 'fretboard', label: 'Hand on the neck' },
  { id: 'bow', label: 'Bow on the string (violin)' },
];
const HALF_LIFE = 1.5; // s, auto range fall-off

function makeRenderer(canvas, o) {
  if (o.renderer === 'none') return null;
  if (o.renderer) return o.renderer;
  const r = new THREE.WebGLRenderer({ canvas, antialias: o.quality !== 'low', alpha: o.background == null, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(2, o.pixelRatio || (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));
  return r;
}

function lights(scene, shadows) {
  const g = new THREE.Group();
  g.name = 'lights';
  const key = new THREE.DirectionalLight(0xfff1dc, 1.7);
  key.position.set(-0.5, -0.7, 1.4);
  key.castShadow = shadows;
  if (shadows) {
    key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera;
    c.left = -0.65; c.right = 0.65; c.top = 0.65; c.bottom = -0.65; c.near = 0.1; c.far = 4;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.0006;
    key.shadow.radius = 3;
  }
  const rim = new THREE.DirectionalLight(0xbcd4ff, 0.9);
  rim.position.set(0.8, 0.9, 0.5);
  const fill = new THREE.HemisphereLight(0xf2f4ff, 0x2a2018, 0.35);
  g.add(key, key.target, rim, fill);
  scene.add(g);
  return { key, rim, fill };
}

/**
 * @param canvas  HTMLCanvasElement (or a canvas-like object with a WebGL context)
 * @param opts    see README.md
 */
export function createStringView3D(canvas, opts = {}) {
  const o = {
    instrument: 'steel', field: 'accel', colormap: 'magma', reverse: false, gamma: 1,
    exaggeration: 20, polarization: 0, controls: true, quality: 'high', background: 0x0b0d12,
    orientation: 'auto', thick: 1.8, ...opts,
  };
  const renderer = makeRenderer(canvas, o);
  const high = o.quality !== 'low';
  setTextureScale(high ? 1 : 0.5);
  if (renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = high;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  const scene = new THREE.Scene();
  if (o.background != null) scene.background = new THREE.Color(o.background);
  let pmrem = null;
  if (renderer) {
    pmrem = new THREE.PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    scene.environment = pmrem.fromScene(env, 0.04).texture;
    env.traverse((x) => { if (x.geometry) x.geometry.dispose(); });
  }
  const L = lights(scene, high && !!renderer);
  const camera = new THREE.PerspectiveCamera(34, 1.6, 0.004, 30);
  const holder = new THREE.Group();
  holder.name = 'holder';
  scene.add(holder);
  let controls = null;
  if (o.controls && canvas && typeof canvas.addEventListener === 'function') {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.minDistance = 0.03;
    controls.maxDistance = 4;
    controls.zoomSpeed = 0.8;
  }

  const st = {
    field: o.field, colormap: o.colormap, reverse: o.reverse, gamma: o.gamma,
    exag: o.exaggeration, pol: o.polarization, fixedRange: null, auto: {},
    lut: null, signed: false, highlight: null, orbit: 0,
    bow: null, bowB: 0.36, bowDir: 1, portrait: false, preset: 'instrument', presetOpts: {},
    tween: null, w: 0, h: 0,
  };
  let model = null, live = null;

  function refreshLut() {
    st.lut = linearLut(CM.variant(st.colormap, { reverse: st.reverse, gamma: st.gamma }));
    const kind = CM.get(st.colormap).kind;
    const f = FIELDS.find((x) => x.id === st.field);
    st.signed = !!(f && f.signed && kind !== 'sequential');
  }
  refreshLut();

  function setInstrument(key) {
    const inst = INSTRUMENTS[key];
    if (!inst) throw new Error('unknown instrument ' + key);
    if (model) {
      live.dispose();
      holder.remove(model.root);
      model.root.traverse((x) => { if (x.geometry) x.geometry.dispose(); });
      for (const m of Object.values(model.materials)) m.dispose();
    }
    model = buildModel(inst);
    holder.add(model.root);
    live = new LiveStrings(model, { segments: high ? 160 : 80, radial: high ? 10 : 6, thick: o.thick });
    st.bow = null;
    if (model.bow) model.bow.group.visible = false;
    view.model = model;
    view.live = live;
    view.instrument = key;
    applyOrientation(true);
  }

  // ----------------------------------------------------------- bow motion
  function moveBow(dtSim) {
    if (!model || !model.bow) return;
    const b = st.bow;
    model.bow.group.visible = !!(b && b.on !== false);
    if (!model.bow.group.visible) return;
    const i = Math.max(0, Math.min(model.strings.length - 1, b.string | 0));
    const line = live.line(i);
    const [h0, h1] = model.bow.hair;
    const lo = h0 + 0.05, hi = h1 - 0.05;
    st.bowB += st.bowDir * Math.abs(b.speed ?? 0.4) * (dtSim || 0);
    for (let k = 0; k < 4 && (st.bowB > hi || st.bowB < lo); k++) {
      if (st.bowB > hi) { st.bowB = 2 * hi - st.bowB; st.bowDir = -1; }
      if (st.bowB < lo) { st.bowB = 2 * lo - st.bowB; st.bowDir = 1; }
    }
    const s = b.pos ?? 0.09;
    const ax = new THREE.Vector3().subVectors(line.F, line.S).normalize();
    const P = line.S.clone().lerp(line.F, s);
    const y = line.S.y;
    const t = new THREE.Vector3(0, 1, -y / (model.bridgeR || 0.042));
    const dir = t.addScaledVector(ax, -t.dot(ax)).normalize();
    const up = new THREE.Vector3().crossVectors(ax, dir).normalize();
    P.addScaledVector(up, model.strings[i].radius * o.thick + 0.0005);
    model.bow.place(P, dir, up, st.bowB);
  }

  // -------------------------------------------------------- camera presets
  function fitDistance(radius) {
    const vf = THREE.MathUtils.degToRad(camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const along = st.portrait ? vf : hf;
    const across = st.portrait ? hf : vf;
    return Math.max(radius / Math.tan(along / 2), (radius * 0.45) / Math.tan(across / 2)) * 1.14;
  }
  function presetPose(id, po = {}) {
    const m = model;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    let target, eye;
    if (id === 'soundhole') {
      target = m.focus.soundhole.clone();
      const d = m.key === 'violin' ? 0.2 : 0.3;
      eye = target.clone().add(V(-0.3, -0.55, 0.78).normalize().multiplyScalar(d));
    } else if (id === 'string') {
      const i = Math.max(0, Math.min(m.strings.length - 1, po.string ?? Math.floor(m.strings.length / 2)));
      const { S, F } = live.line(i);
      const span = S.distanceTo(F);
      target = S.clone().lerp(F, 0.3);
      eye = target.clone().add(V(-0.06, -0.2, 0.3).multiplyScalar(span));
    } else if (id === 'bow' && m.bow) {
      const i = st.bow ? st.bow.string | 0 : 2;
      const { S, F } = live.line(i);
      target = S.clone().lerp(F, st.bow?.pos ?? 0.09);
      eye = target.clone().add(V(-0.45, -0.6, 0.66).normalize().multiplyScalar(0.3));
    } else if (id === 'fretboard') {
      target = m.focus.fretboard.clone();
      eye = target.clone().add(V(0.1, -0.5, 0.86).normalize().multiplyScalar(m.key === 'violin' ? 0.22 : 0.34));
    } else {
      target = m.focus.centre.clone();
      eye = target.clone().add(V(0.05, -0.32, 1).normalize().multiplyScalar(fitDistance(m.radius)));
    }
    holder.updateMatrixWorld(true);
    return { target: holder.localToWorld(target), eye: holder.localToWorld(eye) };
  }
  function setCamera(id = 'instrument', co = {}) {
    if (!model) return;
    st.preset = id;
    st.presetOpts = co;
    const pose = presetPose(id, co);
    const tgt0 = controls ? controls.target.clone() : (st.target || pose.target.clone());
    if (co.animate === false || !st.target) {
      camera.position.copy(pose.eye);
      st.target = pose.target.clone();
      if (controls) controls.target.copy(pose.target);
      camera.lookAt(pose.target);
      st.tween = null;
    } else {
      st.tween = { t: 0, dur: co.duration ?? 0.9, e0: camera.position.clone(), t0: tgt0, e1: pose.eye, t1: pose.target };
    }
  }

  function applyOrientation(force) {
    const portrait = o.orientation === 'portrait' || (o.orientation === 'auto' && st.h > st.w * 1.1);
    if (portrait === st.portrait && !force) return;
    st.portrait = portrait;
    holder.rotation.z = portrait ? Math.PI / 2 : 0;
    holder.updateMatrixWorld(true);
    setCamera(st.preset, { ...st.presetOpts, animate: false });
  }

  function resize(w, h) {
    st.w = Math.max(1, w | 0); st.h = Math.max(1, h | 0);
    camera.aspect = st.w / st.h;
    camera.updateProjectionMatrix();
    if (renderer) renderer.setSize(st.w, st.h, false);
    applyOrientation(false);
  }

  // ------------------------------------------------------------ frame loop
  function frame(dtWall = 1 / 60, dtSim = 0) {
    if (!model) return;
    moveBow(dtSim);
    const natural = st.field === 'none';
    const decay = Math.exp((-Math.LN2 * Math.max(0, dtWall)) / HALF_LIFE);
    const range = (peak) => {
      st.auto[st.field] = Math.max(peak, (st.auto[st.field] || 0) * decay);
      return st.fixedRange ?? st.auto[st.field];
    };
    live.update({ field: st.field, exaggeration: st.exag, polarization: st.pol, lut: st.lut, signed: st.signed, range, natural });
    if (st.tween) {
      const tw = st.tween;
      tw.t += dtWall / tw.dur;
      const k = tw.t >= 1 ? 1 : 1 - Math.pow(1 - tw.t, 3);
      camera.position.lerpVectors(tw.e0, tw.e1, k);
      st.target = tw.t0.clone().lerp(tw.t1, k);
      if (controls) controls.target.copy(st.target);
      camera.lookAt(st.target);
      if (tw.t >= 1) st.tween = null;
    }
    if (st.orbit && !st.tween) {
      const tgt = controls ? controls.target : st.target;
      const off = camera.position.clone().sub(tgt);
      const axis = holder.localToWorld(new THREE.Vector3(0, 0, 1)).sub(holder.position).normalize();
      off.applyAxisAngle(axis, st.orbit * dtWall);
      camera.position.copy(tgt).add(off);
      camera.lookAt(tgt);
    }
    if (controls) controls.update();
    if (renderer) renderer.render(scene, camera);
  }

  // --------------------------------------------------------------- picking
  const ray = new THREE.Raycaster();
  function stringAt(clientX, clientY) {
    if (!model) return null;
    const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: st.w, height: st.h };
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    holder.updateMatrixWorld(true);
    let best = null;
    const onRay = new THREE.Vector3(), onSeg = new THREE.Vector3();
    for (let i = 0; i < model.strings.length; i++) {
      const { S, F } = live.line(i);
      const a = holder.localToWorld(S.clone()), b = holder.localToWorld(F.clone());
      const d2 = ray.ray.distanceSqToSegment(a, b, onRay, onSeg);
      const dist = Math.sqrt(d2);
      const tol = 0.012 * onRay.distanceTo(camera.position) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      if (dist < tol && (!best || dist < best.dist)) best = { string: i, pos: onSeg.distanceTo(a) / a.distanceTo(b), dist };
    }
    return best ? { string: best.string, pos: best.pos } : null;
  }

  const view = {
    renderer, scene, camera, controls, holder, lights: L,
    model: null, live: null, instrument: null,
    setInstrument,
    attach(i, sim) { live.attach(i, sim); },
    attachAll(sims) { (sims || []).forEach((s, i) => live.attach(i, s)); },
    setFret(i, fret, finger) { live.setFret(i, fret, finger); },
    setFrets(frets, fingers = []) { (frets || []).forEach((f, i) => live.setFret(i, f, fingers[i] ?? 0)); },
    setField(id) { if (!FIELDS.some((f) => f.id === id)) throw new Error('unknown field ' + id); st.field = id; refreshLut(); },
    setColormap(id, co = {}) { st.colormap = CM.has(id) ? id : 'magma'; if ('reverse' in co) st.reverse = !!co.reverse; if ('gamma' in co) st.gamma = +co.gamma || 1; refreshLut(); },
    setRange(max) { st.fixedRange = max == null ? null : +max; },
    setExaggeration(x) { st.exag = +x; },
    setPolarization(rad) { st.pol = +rad; },
    setThickness(k) { o.thick = +k; live.setThick(+k); },
    setBow(b) { st.bow = b ? { ...b } : null; },
    highlight(i) { live.highlighted = i == null ? null : i; st.highlight = live.highlighted; },
    setCamera,
    autoOrbit(rad) { st.orbit = +rad || 0; },
    frame, resize, stringAt,
    legend() {
      const f = FIELDS.find((x) => x.id === st.field);
      return { id: st.field, label: f.label, unit: f.unit, max: st.fixedRange ?? (st.auto[st.field] || 0), signed: st.signed, colormap: st.colormap, reverse: st.reverse, gamma: st.gamma };
    },
    get state() { return { ...st }; },
    dispose() {
      if (controls) controls.dispose();
      if (model) {
        live.dispose();
        model.root.traverse((x) => { if (x.geometry) x.geometry.dispose(); });
        for (const m of Object.values(model.materials)) m.dispose();
      }
      disposeTextures();
      if (scene.environment) scene.environment.dispose();
      if (pmrem) pmrem.dispose();
      if (renderer && renderer !== o.renderer) renderer.dispose();
      model = null;
    },
  };
  const w0 = (canvas && (canvas.clientWidth || canvas.width)) || 960;
  const h0 = (canvas && (canvas.clientHeight || canvas.height)) || 600;
  st.w = w0; st.h = h0;
  camera.aspect = w0 / h0;
  camera.updateProjectionMatrix();
  setInstrument(o.instrument);
  resize(w0, h0);
  setCamera('instrument', { animate: false });
  return view;
}
