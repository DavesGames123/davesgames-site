// ============================================================================
//  FLY DUEL  ·  the two big brain panels of the page  (ES module, three r160)
// ----------------------------------------------------------------------------
//  The two fly brains are the main feature of the layout (CONTRACT.md, user
//  direction 2026-10-11): brain A | the 3D table | brain B on a wide
//  screen, brain A above and brain B below the table on a portrait phone.
//  The panels are TRANSPARENT OVERLAYS on the 3D table (user,
//  2026-10-11: "the backgrouds of both brains shoul dbe transparent to
//  show the maximum amount of board state"). The table canvas fills the
//  whole game view, and only the neurons, the edges, the neuropil
//  wireframe and the caption draw over it. No panel ground, no border.
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
//  ALPHA. The shared renderer has alpha and premultipliedAlpha (the
//  three.js blend modes then write premultiplied colour, so a neuron on
//  a clear pixel keeps its colour). It clears to alpha 0, the scenes have
//  no background, and each panel canvas is cleared with clearRect before
//  the drawImage copy. One thin dark edge (PANEL_EDGE) keeps the points
//  and lines readable over a busy table: a dark copy of the brain
//  (its alpha only) goes down first at 1 px offsets in four directions,
//  then the brain. A hard outline: no blur, no glow, no box.
//
//  INPUT. The panel and its canvas take no pointer events, so a drag or
//  a tap on the table under a panel goes to the table. Only the GRIP
//  (.bp-grip, one per panel) takes input: an element that the module
//  puts on the projected bounds of the brain (projectedBounds) after each
//  draw. Drag on the grip turns the brain (OrbitControls, no pan, no
//  inertia), the wheel or a pinch zooms, a double-click or Home resets,
//  the arrow keys turn by 0.1 rad. Hover (mouse) or tap (touch) shows the
//  name of the nearest part (anatomyTips of brain3d.js, with the canvas
//  rect for the coordinates).
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
//      export const PANEL_EDGE ........ the dark edge on points and lines
//      export function projectedBounds  the screen box of the brain
//      export function clearInsets .... overlay rects -> table insets (play)
//      export function fillFrame ...... brain squares -> watch framing
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
import { FLY } from '../tokens.js';

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

// The thin dark edge under the points and lines of a panel: the colour
// of the dark copy and its offset in CSS px (times the pixel ratio).
export const PANEL_EDGE = Object.freeze({ colour: 'rgba(2,4,8,0.85)', px: 1 });

// The box on the screen of the brain: pts (an array of world points of
// the map, or a THREE.Box3: its eight corners) projected with camera
// into a w x h CSS px frame, grown by pad px, clamped to the frame.
// Returns { x, y, w, h } in CSS px from the top-left corner, or null
// when there is nothing to project.
export function projectedBounds(camera, pts, w, h, pad = 8) {
  if (!pts || (pts.isBox3 && pts.isEmpty()) || (Array.isArray(pts) && !pts.length)) return null;
  const list = pts.isBox3 ? [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? pts.max.x : pts.min.x, i & 2 ? pts.max.y : pts.min.y, i & 4 ? pts.max.z : pts.min.z)) : pts;
  camera.updateMatrixWorld?.();
  const v = new THREE.Vector3();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of list) {
    v.copy(q).project(camera);
    const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// The insets of the clear region of the table canvas (for the
// setClear of ui/fly3d/scene.js): how far each shown overlay reaches
// into the canvas. canvas and each overlay: { left, top, right, bottom }
// (getBoundingClientRect). wide: the overlays are at the sides (l, r);
// else at the top and the base (t, b). An overlay goes to the side of
// the canvas centre that its own centre is on.
export function clearInsets(canvas, overlays, wide) {
  const out = { l: 0, r: 0, t: 0, b: 0 };
  if (!canvas) return out;
  const cx = (canvas.left + canvas.right) / 2, cy = (canvas.top + canvas.bottom) / 2;
  for (const o of overlays || []) {
    if (!o || !(o.right > o.left) || !(o.bottom > o.top)) continue;
    if (o.right <= canvas.left || o.left >= canvas.right || o.bottom <= canvas.top || o.top >= canvas.bottom) continue;
    if (wide) {
      if ((o.left + o.right) / 2 < cx) out.l = Math.max(out.l, o.right - canvas.left);
      else out.r = Math.max(out.r, canvas.right - o.left);
    } else if ((o.top + o.bottom) / 2 < cy) out.t = Math.max(out.t, o.bottom - canvas.top);
    else out.b = Math.max(out.b, canvas.bottom - o.top);
  }
  for (const k of ['l', 'r', 't', 'b']) out[k] = Math.round(out[k]);
  return out;
}

// The watch framing of the table under the transparent brains (main.js
// syncClear in watch mode). The scene takes the scale of the FULL canvas
// (fill), so the flies keep the size of a full-view shot, and the outer
// board can lie under a brain. Only the centre of the frame moves:
//   wide   the brain maps are squares at the top of the side overlays
//          (style.css BRAINS). t moves the centre down until the fly
//          heads (at most WIDE_HEAD h over the centre in the wide and
//          combat shots) are under the lowest brain square plus a gap of
//          0.03 h. At most 0.45 h (the limit of scene.js resize).
//   tall   the brain squares sit at the left of the top band and at the
//          right of the base band. The tall shot sets the near fly at
//          the lower left and the far fly at the upper right, clear of
//          both squares, with no move of the centre.
// canvas: the rect of the scene canvas; brains: the rects of the brain
// canvases (.bp-cv) that show. Returns { l, r, t, b, frame, fill }.
export const WIDE_HEAD = 0.09;
export function fillFrame(canvas, brains, wide) {
  const out = { l: 0, r: 0, t: 0, b: 0, frame: wide ? 'wide' : null, fill: true };
  if (!canvas || !wide) return out;
  const h = canvas.bottom - canvas.top;
  if (!(h > 0)) return out;
  let low = -Infinity;
  for (const o of brains || []) {
    if (!o || !(o.right > o.left) || !(o.bottom > o.top)) continue;
    if (o.right <= canvas.left || o.left >= canvas.right || o.bottom <= canvas.top || o.top >= canvas.bottom) continue;
    low = Math.max(low, o.bottom - canvas.top);
  }
  if (low === -Infinity) return out;
  // the centre (h + t) / 2 less the head height is under low + gap
  const t = 2 * (low + 0.03 * h + WIDE_HEAD * h) - h;
  out.t = Math.round(Math.max(0, Math.min(0.45 * h, t)));
  return out;
}

// canvases: [Fly A canvas, Fly B canvas] (2D canvases of the page).
// connectomes: [Fly A, Fly B] (null: no panel for that fly). opts:
//   colours ([FLY A, FLY B])  lite (false)  reducedMotion (false)
//   headless (false)  maxDpr (2; lite 1.5)
//   onFire(p, info)  info: { kc, nKC, value, delta } after each fire
//   renderer   test seam: an object with the WebGLRenderer calls used here
export function createBrainPanels(canvases, connectomes, opts = {}) {
  const o = {
    colours: [FLY[0], FLY[1]], lite: false, reducedMotion: false, headless: false, ...opts,
  };
  o.maxDpr = opts.maxDpr ?? (o.lite ? 1.5 : 2);
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  const headless = o.headless || (!hasDom && !o.renderer);
  let gl = null, renderer = null, glW = 0, glH = 0, lost = false, draws = 0;
  if (!headless) {
    // opts.renderer: a test seam (a fake with the same calls)
    renderer = o.renderer || new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: !o.lite, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    gl = renderer.domElement;
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setScissorTest(true);
    // a clear pixel is fully transparent: the table shows through
    renderer.setClearColor?.(0x000000, 0);
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
    scene.background = null;            // transparent: the table shows through
    scene.add(map.group);
    const camera = new THREE.PerspectiveCamera(PANEL_VIEW.fov, 1, 0.01, 40);
    const P = { p, cv, grip: null, bounds: null, box: null, map, scene, camera, controls: null, tip: null, labels: [], g: null, dirty: true, on: true, fires: 0, info: null, fit: fitDistance(1), w: 0, h: 0, dispose: [] };
    const place = (dist) => {
      const { yaw, pitch } = PANEL_VIEW;
      camera.position.set(dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw));
      camera.lookAt(0, 0, 0);
    };
    P.reset = () => { place(P.fit); P.controls?.target.set(0, 0, 0); P.controls?.update(); P.dirty = true; };
    place(P.fit);
    if (!headless) {
      P.labels = regionLabels(map);
      // the grip: the one element of the panel that takes the pointer
      const doc = cv.ownerDocument || (typeof document !== 'undefined' ? document : null);
      const host = cv.parentNode;
      if (doc?.createElement && host?.appendChild) {
        P.grip = host.querySelector?.('.bp-grip') || null;
        if (!P.grip) { P.grip = doc.createElement('div'); P.grip.className = 'bp-grip'; host.appendChild(P.grip); }
        P.grip.setAttribute?.('aria-label', cv.getAttribute?.('aria-label') || 'Brain map');
      }
      const input = P.grip || cv;
      // anatomyTips: events on the grip, coordinates on the canvas
      const tipEl = P.grip ? {
        addEventListener: (...a) => P.grip.addEventListener(...a), removeEventListener: (...a) => P.grip.removeEventListener(...a),
        getBoundingClientRect: () => cv.getBoundingClientRect(), get clientHeight() { return cv.clientHeight; }, get height() { return cv.height; },
      } : cv;
      const controls = new OrbitControls(camera, input);
      controls.enableDamping = false; controls.enablePan = false; controls.autoRotate = false;
      controls.minDistance = 1.6; controls.maxDistance = 14;
      controls.minPolarAngle = Math.PI / 2 - 1.1; controls.maxPolarAngle = Math.PI / 2 + 1.1;
      controls.addEventListener('change', () => { P.dirty = true; });
      P.controls = controls;
      input.style.touchAction = 'none';
      if (input.tabIndex < 0) input.tabIndex = 0;
      const sizeTip = h => { const s = P.tip?.sprite(); if (s) sizeSprites([s], camera, h, s.userData.px); };
      P.tip = anatomyTips(map, tipEl, camera, () => { P.dirty = true; }, sizeTip);
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
      input.addEventListener('keydown', onKey);
      input.addEventListener('dblclick', P.reset);
      P.dispose.push(() => { input.removeEventListener('keydown', onKey); input.removeEventListener('dblclick', P.reset); controls.dispose(); P.tip.dispose(); });
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
    // transparent copy: clear the panel, the dark edge, then the brain
    P.g.clearRect?.(0, 0, bw, bh);
    const e = edgeOf(P, bw, bh);
    if (e) {
      e.g.globalCompositeOperation = 'copy';
      e.g.drawImage(gl, 0, glH - h, w, h, 0, 0, bw, bh);
      e.g.globalCompositeOperation = 'source-in';
      e.g.fillStyle = PANEL_EDGE.colour; e.g.fillRect(0, 0, bw, bh);
      e.g.globalCompositeOperation = 'source-over';
      const d = Math.max(1, Math.round(PANEL_EDGE.px * bw / Math.max(1, P.w)));
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) P.g.drawImage(e.cv, dx, dy);
    }
    P.g.drawImage(gl, 0, glH - h, w, h, 0, 0, bw, bh);
    placeGrip(P);
    draws++;
    P.dirty = false;
    return true;
  }

  // The scratch canvas of the dark edge of a panel (null without a DOM).
  function edgeOf(P, bw, bh) {
    if (P.edge === undefined) {
      P.edge = null;
      try {
        const doc = P.cv.ownerDocument || (typeof document !== 'undefined' ? document : null);
        const cv = doc?.createElement?.('canvas'), g = cv?.getContext?.('2d');
        if (g?.drawImage && g.fillRect) P.edge = { cv, g };
      } catch { P.edge = null; }
    }
    if (P.edge && (P.edge.cv.width !== bw || P.edge.cv.height !== bh)) { P.edge.cv.width = bw; P.edge.cv.height = bh; }
    return P.edge;
  }

  // About 3000 world points of the map (the vertices of its points,
  // lines and shell, no label sprites), for the grip box. An empty map:
  // the corners of the fit sphere box.
  function samplePoints(group) {
    group.updateMatrixWorld?.(true);
    const out = [];
    group.traverse(o => {
      if (o.isSprite || !o.visible) return;
      const pos = o.geometry?.attributes?.position;
      if (!pos || !pos.count) return;
      const step = Math.max(1, Math.ceil(pos.count / 400));
      for (let i = 0; i < pos.count; i += step) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    });
    if (out.length) return out;
    const r = PANEL_VIEW.radius;
    return new THREE.Box3(new THREE.Vector3(-r, -r, -r), new THREE.Vector3(r, r, r));
  }

  // Put the grip on the projected bounds of the brain (CSS px in the
  // panel). Outside the grip, the pointer goes to the table under it.
  function placeGrip(P) {
    if (!P.box) P.box = samplePoints(P.map.group);
    P.bounds = projectedBounds(P.camera, P.box, P.w, P.h);
    const g = P.grip?.style;
    if (!g) return;
    const b = P.bounds;
    if (!b) { g.display = 'none'; return; }
    g.display = 'block';
    // the canvas can sit inside its overlay (a watch square), so the
    // grip adds the canvas offset in the overlay
    const ox = P.cv.offsetLeft || 0, oy = P.cv.offsetTop || 0;
    g.left = `${(b.x + ox).toFixed(1)}px`; g.top = `${(b.y + oy).toFixed(1)}px`; g.width = `${b.w.toFixed(1)}px`; g.height = `${b.h.toFixed(1)}px`;
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
    setNeuropil(p, d) { const P = panels[p]; if (!P) return null; const r = P.map.setNeuropil(d); P.box = null; P.dirty = true; return r; },
    // the grip box of a panel (CSS px in the panel), null before a draw
    bounds(p) { const b = panels[p]?.bounds; return b ? { ...b } : null; },
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
