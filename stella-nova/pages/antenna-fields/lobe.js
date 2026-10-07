// ============================================================================
//  ANTENNA FIELDS  ·  lobe.js — the 3D radiation pattern (three.js r160)
// ----------------------------------------------------------------------------
//  createLobe({ canvas, gl?, orbit? }) makes a renderer, a scene and an
//  orbit camera. With gl it shares the WebGL2 context of the field canvas
//  (the screensaver draws the lobe into the same canvas as the field);
//  without gl it owns the canvas (the 3D card in the results column).
//
//  update(U, nt, np, wires, extent) builds the lobe surface. The radius is the
//  gain in dB over a 30 dB range, r = max(0, 1 + dB/30), and the colour runs
//  from deep violet to white with r. A lat-long net of lines sits on the
//  surface. The surface has polygonOffset (factor 1, units 1), so the net
//  lines never fight it in the depth buffer. The antenna is drawn as lines at
//  the centre. Physics z is up: the group turns physics (x, y, z) to three
//  (x, z, -y).
//
//  grep -n: "export function createLobe"  "function update"  "function render"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// violet -> magenta -> orange -> gold, in sRGB; three wants linear vertex
// colours, so each value goes through the sRGB curve (about pow 2.2).
function ramp(t) {
  const stops = [[0.16, 0.10, 0.36], [0.50, 0.17, 0.58], [0.90, 0.33, 0.42], [1.0, 0.56, 0.30], [1.0, 0.80, 0.45]];
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  return stops[i].map((v, k) => Math.pow(v + (stops[i + 1][k] - v) * f, 2.2));
}

export function createLobe({ canvas, gl = null, orbit = true }) {
  const renderer = gl
    ? new THREE.WebGLRenderer({ canvas, context: gl, antialias: false })
    : new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  if (!gl) renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.autoClear = !gl;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
  camera.position.set(2.6, 1.7, 3.1);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1020, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x60e0ee, 0.9); rim.position.set(-4, -1, -3); scene.add(rim);
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;
  scene.add(group);

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const netMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  const wireMat = new THREE.LineBasicMaterial({ color: 0xf2f5f8 });
  const axisMat = new THREE.LineBasicMaterial({ color: 0x8090a8, transparent: true, opacity: 0.45, depthWrite: false });
  let mesh = null, net = null, ant = null;
  const axes = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1.3, 0, 0, 1.3, 0, 0, 0, -1.3, 0, 0, 1.3, 0, 0, 0, -1.3, 0, 0, 1.3], 3)), axisMat);
  group.add(axes);

  let controls = null;
  if (orbit && !gl) {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
    controls.minDistance = 2; controls.maxDistance = 9;
    controls.autoRotate = true; controls.autoRotateSpeed = 0.8;
  }

  function update(U, nt, np, wires, extent) {
    let umax = 1e-30;
    for (const u of U) umax = Math.max(umax, u);
    const pos = new Float32Array((nt + 1) * (np + 1) * 3), col = new Float32Array(pos.length);
    for (let i = 0; i <= nt; i++) {
      const th = Math.PI * i / nt, st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j <= np; j++) {
        const ph = 2 * Math.PI * j / np, q = i * (np + 1) + j;
        const db = 10 * Math.log10(Math.max(U[q] / umax, 1e-6)), r = Math.max(0, 1 + db / 30);
        pos.set([r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct], q * 3);
        col.set(ramp(r), q * 3);
      }
    }
    const idx = [];
    for (let i = 0; i < nt; i++) for (let j = 0; j < np; j++) {
      const a = i * (np + 1) + j, b = a + 1, c = a + np + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (mesh) { group.remove(mesh); mesh.geometry.dispose(); }
    mesh = new THREE.Mesh(g, mat); group.add(mesh);
    // the net: every 4th parallel and every 8th meridian
    const lp = [];
    const P = (i, j) => pos.subarray((i * (np + 1) + j) * 3, (i * (np + 1) + j) * 3 + 3);
    for (let i = 4; i < nt; i += 4) for (let j = 0; j < np; j++) lp.push(...P(i, j), ...P(i, j + 1));
    for (let j = 0; j < np; j += 8) for (let i = 0; i < nt; i++) lp.push(...P(i, j), ...P(i + 1, j));
    if (net) { group.remove(net); net.geometry.dispose(); }
    net = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)), netMat);
    group.add(net);
    // the antenna, scaled to sit inside the lobe
    const s = 0.7 / Math.max(0.2, extent);
    const ap = [];
    for (const w of wires) for (let k = 1; k < w.pts.length; k++) ap.push(...w.pts[k - 1].map(v => v * s), ...w.pts[k].map(v => v * s));
    if (ant) { group.remove(ant); ant.geometry.dispose(); }
    ant = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ap, 3)), wireMat);
    group.add(ant);
  }

  // Render. rect (CSS px, from the top left of the canvas) limits the drawing
  // to a part of a shared canvas; without it the whole canvas.
  function render(rect) {
    if (controls) controls.update();
    if (gl) {
      renderer.resetState();
      const W = canvas.width, H = canvas.height;
      const r = rect || { x: 0, y: 0, w: W, h: H };
      renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
      renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
      renderer.setScissorTest(true);
      camera.aspect = r.w / r.h; camera.updateProjectionMatrix();
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.setScissorTest(false);
      renderer.resetState();
    } else {
      renderer.render(scene, camera);
    }
  }
  function resize() {
    if (gl) return;
    const b = canvas.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return;
    renderer.setSize(b.width, b.height, false);
    camera.aspect = b.width / b.height; camera.updateProjectionMatrix();
  }
  // Orbit by hand (the screensaver): azimuth, elevation (radians), distance.
  function setOrbit(az, el, dist) {
    camera.position.set(dist * Math.cos(el) * Math.sin(az), dist * Math.sin(el), dist * Math.cos(el) * Math.cos(az));
    camera.lookAt(0, 0, 0);
  }
  function dispose() { try { if (controls) controls.dispose(); if (!gl) renderer.dispose(); } catch (e) { /* gone */ } }
  return { renderer, scene, camera, controls, update, render, resize, setOrbit, dispose };
}
