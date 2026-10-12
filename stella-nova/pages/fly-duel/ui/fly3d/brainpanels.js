// ============================================================================
//  FLY DUEL  ·  the two big brain panels of the page  (ES module, three r160)
// ----------------------------------------------------------------------------
//  The two fly brains are the main feature of the layout (CONTRACT.md, user
//  direction 2026-10-11): brain A | the 3D table | brain B on a wide
//  screen, brain A above and brain B below the table on a portrait phone.
//  This module draws the two brain maps of ui/fly3d/brain3d.js
//  (createBrainMap) into the two panel canvases of the page (#heroBrainA,
//  #heroBrainB). Each map fires on the decisions of its own fly with the
//  real trace of brain/fly.js: PN rates, the sparse KC set, spikes on the
//  real PN->KC and KC->MBON edges, MBON rates and the DAN burst per
//  compartment, in the neuropil shell when the frame has one.
//
//  ONE GPU CONTEXT FOR BOTH PANELS. A browser drops the oldest WebGL
//  context after about 16, and the 3D table has one already. So the two
//  panels share one WebGLRenderer on a detached canvas. Each panel renders
//  its scene into the lower-left corner of that canvas (viewport and
//  scissor), and the panel copies the corner into its own 2D canvas with
//  drawImage in the same task. The page then has two WebGL contexts in
//  all: the table and this renderer. A panel draws only when its map runs
//  (a fire sequence, 1.4 s), when the user turns it, or after a resize.
//
//  INPUT. Drag turns a panel (OrbitControls on the 2D canvas, no pan, no
//  inertia), the wheel or a pinch zooms, a double-click or Home resets,
//  the arrow keys turn by 0.1 rad. Hover (mouse) or tap (touch) shows the
//  name of the nearest part (anatomyTips of brain3d.js).
//
//  COST. lite (coarse pointer, a phone): octahedra for the KCs, fewer
//  spikes, no antialias, pixel ratio at most 1.5. Reduced motion: each
//  fire jumps to its end state (createBrainMap reducedMotion).
//
//  USE
//      import { createBrainPanels } from './ui/fly3d/brainpanels.js';
//      const bp = createBrainPanels([cvA, cvB], [conA, conB], { colours, lite });
//      bp.fire(0, trace, delta);    // a decision of Fly A
//      bp.update(dt);               // from the page loop, dt in seconds
//      bp.setNeuropil(0, json);     // loadNeuropil() of brain3d.js
//  headless: true (or no DOM) builds the maps with no renderer, for the
//  node tests: fire and update run, nothing draws.
//
//  GREP MAP   (grep -n "<anchor>" ui/fly3d/brainpanels.js)
//      export const PANEL_VIEW ........ the start view of a panel
//      export function fitDistance .... camera distance that fits the map
//      export function createBrainPanels  the panels, shared renderer
//      function makePanel ............. one map, scene, camera, controls
//      function draw .................. viewport render + drawImage copy
//      function update ................ the host loop step
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBrainMap, regionLabels, sizeSprites, anatomyTips } from './brain3d.js';

// the page loads the neuropil shell through this module
export { loadNeuropil } from './brain3d.js';
import { TOKENS, FLY } from '../tokens.js';

// From the medial side, a little anterior and dorsal: the KC cap, the
// peduncle and the lobes stand apart (the createBrainView start view).
export const PANEL_VIEW = Object.freeze({ yaw: 1.25, pitch: 0.3, fov: 34, radius: 1.18 });

// The camera distance at which a sphere of radius r fills the smaller
// side of a frame of this aspect (w / h), with a vertical fov in degrees.
export function fitDistance(aspect, fov = PANEL_VIEW.fov, r = PANEL_VIEW.radius) {
  const v = THREE.MathUtils.degToRad(fov / 2);
  const h = Math.atan(Math.tan(v) * Math.max(0.05, aspect || 1));
  return Math.max(2, Math.min(12, r / Math.sin(Math.min(v, h))));
}

// canvases: [Fly A canvas, Fly B canvas] (2D canvases of the page).
// connectomes: [Fly A, Fly B] (null: no panel for that fly). opts:
//   colours ([FLY A, FLY B])  lite (false)  reducedMotion (false)
//   headless (false)  maxDpr (2; lite 1.5)  background (--fig)
//   onFire(p, info)  info: { kc, nKC, value, delta } after each fire
//   renderer   test seam: an object with the WebGLRenderer calls used here
export function createBrainPanels(canvases, connectomes, opts = {}) {
  const o = {
    colours: [FLY[0], FLY[1]], lite: false, reducedMotion: false, headless: false,
    background: TOKENS.fig, ...opts,
  };
  o.maxDpr = opts.maxDpr ?? (o.lite ? 1.5 : 2);
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  const headless = o.headless || (!hasDom && !o.renderer);
  let gl = null, renderer = null, glW = 0, glH = 0, lost = false, draws = 0;
  if (!headless) {
    // opts.renderer: a test seam (a fake with the same calls)
    renderer = o.renderer || new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: !o.lite, alpha: false, powerPreference: 'low-power' });
    gl = renderer.domElement;
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setScissorTest(true);
    gl.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
    gl.addEventListener('webglcontextrestored', () => { lost = false; panels.forEach(P => { if (P) P.dirty = true; }); });
  }

  const panels = [0, 1].map(p => (connectomes?.[p] && canvases?.[p] ? makePanel(p) : null));

  function makePanel(p) {
    const cv = canvases[p];
    const map = createBrainMap(connectomes[p], {
      colour: o.colours[p], lite: o.lite, reducedMotion: o.reducedMotion, size: 1,
      holdOut: 0.42, restEdges: 1, neuropil: o.neuropil?.[p] || null,
    });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(o.background);
    scene.add(map.group);
    const camera = new THREE.PerspectiveCamera(PANEL_VIEW.fov, 1, 0.01, 40);
    const P = { p, cv, map, scene, camera, controls: null, tip: null, labels: [], g: null, dirty: true, on: true, fires: 0, info: null, fit: fitDistance(1), w: 0, h: 0, dispose: [] };
    const place = (dist) => {
      const { yaw, pitch } = PANEL_VIEW;
      camera.position.set(dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw));
      camera.lookAt(0, 0, 0);
    };
    P.reset = () => { place(P.fit); P.controls?.target.set(0, 0, 0); P.controls?.update(); P.dirty = true; };
    place(P.fit);
    if (!headless) {
      P.labels = regionLabels(map);
      const controls = new OrbitControls(camera, cv);
      controls.enableDamping = false; controls.enablePan = false; controls.autoRotate = false;
      controls.minDistance = 1.6; controls.maxDistance = 14;
      controls.minPolarAngle = Math.PI / 2 - 1.1; controls.maxPolarAngle = Math.PI / 2 + 1.1;
      controls.addEventListener('change', () => { P.dirty = true; });
      P.controls = controls;
      cv.style.touchAction = 'none';
      if (cv.tabIndex < 0) cv.tabIndex = 0;
      const sizeTip = h => { const s = P.tip?.sprite(); if (s) sizeSprites([s], camera, h, s.userData.px); };
      P.tip = anatomyTips(map, cv, camera, () => { P.dirty = true; }, sizeTip);
      const onKey = e => {
        const k = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[e.key];
        if (k) {
          const off = camera.position.clone().sub(controls.target);
          const sph = new THREE.Spherical().setFromVector3(off);
          sph.theta += k[0];
          sph.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sph.phi - k[1]));
          camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
          camera.lookAt(controls.target); controls.update(); P.dirty = true; e.preventDefault();
        } else if (e.key === 'Home') { P.reset(); e.preventDefault(); }
      };
      cv.addEventListener('keydown', onKey);
      cv.addEventListener('dblclick', P.reset);
      P.dispose.push(() => { cv.removeEventListener('keydown', onKey); cv.removeEventListener('dblclick', P.reset); controls.dispose(); P.tip.dispose(); });
      try { P.g = cv.getContext('2d'); } catch { P.g = null; }
    }
    return P;
  }

  // A new size of a panel canvas: the 2D canvas buffer, the camera aspect
  // and fit, the label sizes. Keeps the turn of the user, sets the
  // distance to the new fit when the user did not zoom.
  function sizeOf(P) {
    const w = P.cv.clientWidth | 0, h = P.cv.clientHeight | 0;
    if (!w || !h) return false;
    if (w === P.w && h === P.h) return true;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, o.maxDpr);
    P.cv.width = Math.max(1, Math.round(w * dpr)); P.cv.height = Math.max(1, Math.round(h * dpr));
    const old = P.fit;
    P.w = w; P.h = h;
    P.camera.aspect = w / h; P.camera.updateProjectionMatrix();
    P.fit = fitDistance(P.camera.aspect);
    const t = P.controls ? P.controls.target : new THREE.Vector3();
    const off = P.camera.position.clone().sub(t);
    if (Math.abs(off.length() - old) < 1e-3 || !P.controls) { off.setLength(P.fit); P.camera.position.copy(t).add(off); P.camera.lookAt(t); P.controls?.update(); }
    sizeSprites(P.labels, P.camera, h);
    P.tip?.resize(h);
    P.dirty = true;
    return true;
  }

  // Render one panel into the lower-left corner of the shared canvas and
  // copy that corner into the panel canvas. Same task: the drawing buffer
  // is still valid for drawImage.
  function draw(P) {
    if (!renderer || lost || !P.g) return false;
    if (!sizeOf(P)) return false;
    const bw = P.cv.width, bh = P.cv.height;
    if (bw > glW || bh > glH) {
      glW = Math.min(4096, Math.max(glW, bw)); glH = Math.min(4096, Math.max(glH, bh));
      renderer.setSize(glW, glH, false);
    }
    const w = Math.min(bw, glW), h = Math.min(bh, glH);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.render(P.scene, P.camera);
    P.g.drawImage(gl, 0, glH - h, w, h, 0, 0, bw, bh);
    draws++;
    P.dirty = false;
    return true;
  }

  // The host loop step. Runs each fire sequence and draws the panels that
  // changed. Returns true when a panel drew.
  function update(dt) {
    let any = false;
    for (const P of panels) {
      if (!P) continue;
      const ch = P.map.update(dt);
      if (!P.on) continue;
      if ((ch || P.dirty) && draw(P)) any = true;
    }
    return any;
  }

  function fire(p, trace, delta, fo) {
    const P = panels[p];
    if (!P || !trace) return null;
    const lit = P.map.fire(trace, delta, fo);
    P.fires++; P.dirty = true;
    const d = Number.isFinite(delta) ? delta : Number.isFinite(trace.delta) ? trace.delta : null;
    P.info = { kc: (trace.kc || []).length, nKC: connectomes[p]?.kc?.n || 0, value: Number.isFinite(trace.value) ? trace.value : null, delta: d };
    o.onFire?.(p, P.info);
    return lit;
  }

  return {
    panels, fire, update,
    // a panel that is not shown skips its draws; its map still runs
    setVisible(p, on) { const P = panels[p]; if (P) { P.on = !!on; if (on) P.dirty = true; } },
    setNeuropil(p, d) { const P = panels[p]; if (!P) return null; const r = P.map.setNeuropil(d); P.dirty = true; return r; },
    resize() { for (const P of panels) if (P) { P.w = P.h = 0; P.dirty = true; } },
    reset(p) { panels[p]?.reset(); },
    redraw() { for (const P of panels) if (P) P.dirty = true; },
    stats() {
      return {
        contexts: renderer ? 1 : 0, draws, lost,
        panels: panels.map(P => (P ? { fires: P.fires, running: P.map.running, on: P.on, info: P.info, lit: P.map.lit(), size: [P.w, P.h] } : null)),
      };
    },
    dispose() {
      for (const P of panels) { if (!P) continue; P.dispose.forEach(f => f()); P.map.dispose(); }
      if (renderer) { renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* no context */ } }
    },
  };
}
