// ============================================================================
//  XR VIEW  ·  lib/xr-view.js — view a page's 3D model in VR or AR
// ────────────────────────────────────────────────────────────────────────────
//  attachXR() gives a three.js page two entry buttons, VR (immersive-vr) and
//  AR (immersive-ar). In the headset the page's model stands at a real size,
//  and the viewer can grab, turn and scale it. A small panel in the world
//  holds the page's own actions. On exit, the camera, the model transform and
//  the page state go back to what they were.
//
//  THE MODEL  root (default: the whole scene) is the model. The lib sets its
//             position, rotation and scale. When root is the scene, the lib
//             objects (panel, rays, reticle) sit in a group with the inverse
//             transform, so they stay fixed in the room.
//  SIZES      'life'  true size: scale = unit (metres per model unit). The
//                     base is lifeY metres above the floor in VR (default 0,
//                     the floor). Only when opts.unit or opts.lifeHeight.
//             'table' the model is tableHeight metres tall, on a table
//                     height in VR, or on the surface the viewer picks in AR.
//             sizeLabels renames the two sizes on the panel (for example
//             { life: 'room' }). A size change places the model again: in
//             front of the viewer, or on the same AR surface point.
//  PLACEMENT  in front of the viewer, at a distance that grows with the
//             placed size (distance option to set it). The panel goes to
//             the left of the line of sight and faces the head.
//  CLIP       three takes the session depthNear / depthFar from the page
//             camera, in metres in a session. A page in mm or Å would clip
//             the model, so the lib holds the camera at near / far (default
//             0.02 .. 100 m) in each XR frame and puts the page values back
//             on exit. A page change of near / far during the session is
//             kept as the value to put back.
//  THE LOOP   loop 'raf' (default): while a session runs, a headset may not
//             call window.requestAnimationFrame. The lib wraps rAF at attach.
//             Each page request goes to the real rAF and also waits for the
//             next XR frame; it runs once, at the first of the two. If the
//             page does not render the main view in an XR frame, the lib
//             renders it. While three presents, a page render outside an XR
//             frame is skipped, and page setSize / setPixelRatio calls are
//             ignored, because three owns the size. (An emulator such as
//             IWER drives its frames from window rAF, so the real rAF must
//             stay live.)
//             loop 'own': the page uses renderer.setAnimationLoop itself and
//             calls api.update(time, frame) once a frame, before it renders.
//  INPUT      select (trigger or pinch): on the panel, run the row; else
//             opts.onRay(ray, 'select') may take it (picking); else grab.
//             squeeze (grip button): grab. One grab moves the model and
//             turns it about the vertical. Two grabs move, turn and scale it
//             about the midpoint. Thumbstick x turns, y scales.
//  RELEASE    a page swap ends the session: the lib wraps window.__snRelease
//             (lib/gpu-guard.js) and listens for pagehide.
//
//  USE
//    const xr = attachXR({ renderer, scene, camera, controls,
//      bounds: () => box3InModelUnits, unit: 1, tableHeight: 0.45,
//      vrButton, arButton, title: 'Human skeleton',
//      actions: [{ label: 'Explode', run: () => {}, on: () => false }],
//      onRay: (ray, kind) => kind === 'hover' ? 'name' : false,
//      update: (dt) => { pageState.dirty = true; } });
//    More options: lifeY, sizeLabels, distance (metres, { life, table } or
//    (size, extentMetres) => metres), near, far.
//    window.__xrView is the last api made (for tests and the console).
//
//  GREP MAP
//    export function attachXR ............ options, api
//    function installRafBridge ........... rAF during a session
//    function makePanel .................. the world panel
//    function placeInFront / placeAt ..... model placement
//    function frontDistance .............. distance from the viewer
//    function syncLibWorld ............... lib group against the root
//    function holdClip ................... session near / far planes
//    function handleGrab ................. one and two hand grab
//    function tick ....................... one XR frame
//    async function enter / function cleanup   session start and end
// ============================================================================
import * as THREE0 from 'three';

// Yaw (turn about +Y) of a pose matrix. Yaw 0 looks down -Z; the forward
// direction of yaw a is (-sin a, 0, -cos a).
function yawOf(m) {
  const e = m.elements;
  return Math.atan2(e[8], e[10]);
}

// ── rAF bridge ──────────────────────────────────────────────────────────────
// Every rAF request gets a lib id and goes to the real rAF. flush() (called
// in each XR frame) runs the requests that are still waiting and cancels
// their real rAF. A request runs once, at the first of the two.
function installRafBridge() {
  const realRAF = window.requestAnimationFrame.bind(window);
  const realCAF = window.cancelAnimationFrame.bind(window);
  const reqs = new Map();   // id -> { cb, real }
  let nextId = 1;
  const run = (id, t) => { const r = reqs.get(id); if (!r) return; reqs.delete(id); r.cb(t); };
  window.requestAnimationFrame = cb => {
    const id = nextId++;
    reqs.set(id, { cb, real: realRAF(t => run(id, t)) });
    return id;
  };
  window.cancelAnimationFrame = id => {
    const r = reqs.get(id); if (!r) return;
    realCAF(r.real);
    reqs.delete(id);
  };
  return {
    flush(t) { const ids = [...reqs.keys()]; for (const id of ids) { const r = reqs.get(id); if (r) realCAF(r.real); run(id, t); } },
    pending: () => reqs.size,
  };
}

// ── the world panel ─────────────────────────────────────────────────────────
// A canvas texture on a plane. Rows: a title, a status line, then buttons.
// hit(ray) returns the button row under the ray, or -1.
function makePanel(THREE, title, rows) {
  const W = 512, RH = 64, TOP = 112;
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = TOP + rows.length * RH + 16;
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const wm = 0.32, hm = wm * cv.height / W;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  mesh.renderOrder = 1000;
  const font = (() => { try { return getComputedStyle(document.body).fontFamily || 'sans-serif'; } catch (e) { return 'sans-serif'; } })();
  let status = '', hover = -1;
  function draw() {
    g.clearRect(0, 0, W, cv.height);
    g.fillStyle = 'rgba(12,15,22,0.9)';
    g.beginPath(); g.roundRect(0, 0, W, cv.height, 28); g.fill();
    g.fillStyle = '#f0e6d2'; g.font = `600 30px ${font}`; g.textBaseline = 'middle';
    g.fillText(title, 28, 40);
    g.fillStyle = '#9fb1c9'; g.font = `400 22px ${font}`;
    g.fillText(status.length > 40 ? status.slice(0, 39) + '…' : status, 28, 82);
    rows.forEach((r, i) => {
      const y = TOP + i * RH, on = r.on && r.on();
      g.fillStyle = i === hover ? 'rgba(255,200,120,0.22)' : on ? 'rgba(255,200,120,0.12)' : 'rgba(150,200,255,0.06)';
      g.beginPath(); g.roundRect(20, y + 6, W - 40, RH - 12, 14); g.fill();
      g.fillStyle = on ? '#ffd58a' : '#e6ecf5'; g.font = `500 26px ${font}`;
      g.fillText(typeof r.label === 'function' ? r.label() : r.label, 40, y + RH / 2);
    });
    tex.needsUpdate = true;
  }
  const plane = new THREE.Plane(), hitP = new THREE.Vector3(), local = new THREE.Vector3();
  function hit(ray) {
    mesh.updateWorldMatrix(true, false);
    plane.setFromNormalAndCoplanarPoint(tmpV.set(0, 0, 1).transformDirection(mesh.matrixWorld), tmpV2.setFromMatrixPosition(mesh.matrixWorld));
    if (!ray.intersectPlane(plane, hitP)) return { row: -1, d: Infinity };
    local.copy(hitP); mesh.worldToLocal(local);
    if (Math.abs(local.x) > wm / 2 || Math.abs(local.y) > hm / 2) return { row: -1, d: Infinity };
    const py = (hm / 2 - local.y) / hm * cv.height;
    const row = Math.floor((py - TOP) / RH);
    return { row: row >= 0 && row < rows.length ? row : -2, d: ray.origin.distanceTo(hitP) };
  }
  draw();
  return {
    mesh, hit, draw,
    setStatus(s) { if (s !== status) { status = s; draw(); } },
    setHover(i) { if (i !== hover) { hover = i; draw(); } },
    dispose() { tex.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); },
  };
}

// ── attachXR ────────────────────────────────────────────────────────────────
export function attachXR(o) {
  const THREE = THREE0;
  const Y = new THREE.Vector3(0, 1, 0);
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  const { renderer, scene, camera } = o;
  const controls = o.controls || null;
  const root = o.root || scene;
  const loopMode = o.loop || 'raf';
  const tableHeight = o.tableHeight || 0.4;
  const hasLife = !!(o.unit || o.lifeHeight);
  const frontYaw = o.frontYaw || 0;   // model yaw that faces the viewer (0: +Z)
  const lifeY = o.lifeY || 0;          // life size: base height above the floor in VR (m)
  const clipNear = o.near ?? 0.02, clipFar = o.far ?? 100;
  const sizeLabel = n => (o.sizeLabels && o.sizeLabels[n]) || n;
  renderer.xr.enabled = true;

  const bridge = loopMode === 'raf' ? installRafBridge() : null;
  const st = { session: null, kind: null, size: hasLife ? 'life' : 'table', placed: false, needPlace: false,
    p: new THREE.Vector3(), yaw: 0, s: 1, anchor: new THREE.Vector3(), floorY: 0, refSpace: null,
    hitSrc: null, hitPose: null, saved: null, last: 0, inTick: false, xrTarget: null, mainRenders: 0, status: '',
    surface: false, pageClip: null, ticks: 0 };

  // While three presents: count main-view renders in an XR frame, skip a
  // main-view render outside one, and ignore page resizes. three sets its
  // own size before isPresenting turns on and after it turns off.
  const render0 = renderer.render, setSize0 = renderer.setSize, setPR0 = renderer.setPixelRatio;
  renderer.render = function (s, c) {
    if (st.session && renderer.xr.isPresenting) {
      const rt = renderer.getRenderTarget();
      if (rt === null || rt === st.xrTarget) { if (!st.inTick) return; st.mainRenders++; }
    }
    return render0.call(this, s, c);
  };
  renderer.setSize = function () { if (renderer.xr.isPresenting) return; return setSize0.apply(this, arguments); };
  renderer.setPixelRatio = function () { if (renderer.xr.isPresenting) return; return setPR0.apply(this, arguments); };

  // Lib objects: fixed in the room. When root is the scene, the group gets
  // the inverse of the scene transform each frame.
  const libWorld = new THREE.Group();
  libWorld.matrixAutoUpdate = false;
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0.9, depthTest: false }));
  reticle.matrixAutoUpdate = false; reticle.visible = false; reticle.renderOrder = 999;
  libWorld.add(reticle);
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vD; void main(){ float y = vD.y; vec3 top = vec3(0.10,0.11,0.14), hor = vec3(0.06,0.065,0.08), lo = vec3(0.025,0.025,0.03); gl_FragColor = vec4(y > 0.0 ? mix(hor, top, pow(y, 0.6)) : mix(hor, lo, pow(-y, 0.4)), 1.0); }',
  }));
  backdrop.renderOrder = -1000;
  libWorld.add(backdrop);

  // Controllers: target-ray spaces (hands give a ray too).
  const hands = [0, 1].map(i => {
    const c = renderer.xr.getController(i);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0.6 }));
    line.scale.z = 3; line.visible = false; c.add(line);
    const h = { c, line, src: null, grab: false, g0: null };
    c.addEventListener('connected', e => { h.src = e.data; line.visible = true; });
    c.addEventListener('disconnected', () => { h.src = null; h.grab = false; line.visible = false; });
    c.addEventListener('selectstart', () => onSelect(h));
    c.addEventListener('selectend', () => release(h));
    c.addEventListener('squeezestart', () => startGrab(h));
    c.addEventListener('squeezeend', () => release(h));
    libWorld.add(c);
    return h;
  });

  // Panel rows: size switch, the page's actions, reset, exit.
  const rows = [];
  if (hasLife) rows.push({ label: () => { const k = st.size === 'life' ? 'table' : 'life'; return `Size: ${sizeLabel(st.size)}  ·  switch to ${sizeLabel(k)}`; }, run: () => setSize(st.size === 'life' ? 'table' : 'life') });
  for (const a of o.actions || []) rows.push(a);
  rows.push({ label: 'Reset position', run: () => reset() });
  rows.push({ label: () => st.kind === 'ar' ? 'Exit AR' : 'Exit VR', run: () => exit() });
  let panel = null;

  // ── placement ─────────────────────────────────────────────────────────────
  function modelBox() {
    const b = o.bounds ? o.bounds() : new THREE.Box3().setFromObject(root);
    return b.isEmpty() ? new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5)) : b;
  }
  function sizeScale(b) {
    const h = Math.max(1e-6, b.max.y - b.min.y);
    if (st.size === 'life') return o.unit ? o.unit : o.lifeHeight / h;
    return tableHeight / h;
  }
  function applyRoot() {
    root.quaternion.setFromAxisAngle(Y, st.yaw);
    root.scale.setScalar(st.s);
    tmpV.copy(st.anchor).multiplyScalar(st.s).applyQuaternion(root.quaternion);
    root.position.copy(st.p).sub(tmpV);
  }
  function headPose(frame) {
    const pose = frame && st.refSpace ? frame.getViewerPose(st.refSpace) : null;
    if (!pose) return null;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    return { pos: new THREE.Vector3().setFromMatrixPosition(m), yaw: yawOf(m) };
  }
  // Base centre of the model box is the anchor. It goes to world point p.
  function placeAt(p, head, b) {
    b = b || modelBox();
    st.anchor.set((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
    st.s = sizeScale(b);
    st.p.copy(p);
    st.yaw = (head ? Math.atan2(head.pos.x - p.x, head.pos.z - p.z) : 0) + frontYaw;
    st.placed = true; reticle.visible = false;
    applyRoot();
  }
  // Distance from the viewer to the base centre. It grows with the largest
  // side of the placed model, so a 1.4 m clock does not fill the view.
  function frontDistance(b) {
    const d = o.distance;
    const ext = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) * sizeScale(b);
    if (typeof d === 'function') return d(st.size, ext);
    if (typeof d === 'number') return d;
    if (d && d[st.size] != null) return d[st.size];
    return Math.max(st.size === 'life' ? 0.45 : 0.65, 0.3 + 0.75 * ext);
  }
  function placeInFront(head) {
    if (!head) head = { pos: new THREE.Vector3(0, st.floorY + 1.6, 0), yaw: 0 };
    const life = st.size === 'life', b = modelBox(), d = frontDistance(b);
    const p = new THREE.Vector3(head.pos.x - Math.sin(head.yaw) * d, 0, head.pos.z - Math.cos(head.yaw) * d);
    if (st.kind === 'ar') p.y = life && !lifeY ? st.floorY : head.pos.y - 0.45;
    else p.y = st.floorY + (life ? lifeY : 0.8);
    st.surface = false;
    placeAt(p, head, b);
  }
  // When root is the scene, the lib group holds the inverse of the scene
  // transform, so the lib objects stay fixed in the room. Call it after a
  // root change and before a lib object reads its world matrix.
  function syncLibWorld() {
    if (root === scene) { scene.updateMatrix(); libWorld.matrix.copy(scene.matrix).invert(); }
    else libWorld.matrix.identity();
    scene.matrixWorld.copy(scene.matrix);
    libWorld.updateMatrixWorld(true);
  }
  function placePanel(head) {
    if (!panel || !head) return;
    // lookAt reads the parent world matrix: it must hold the new root transform
    syncLibWorld();
    const a = head.yaw + 0.62, d = 0.55;
    panel.mesh.position.set(head.pos.x - Math.sin(a) * d, head.pos.y - 0.22, head.pos.z - Math.cos(a) * d);
    panel.mesh.lookAt(head.pos.x, head.pos.y - 0.22, head.pos.z);
  }
  // Hold the session clip planes on the page camera (see CLIP). A page
  // value that differs is the value to put back on exit.
  function holdClip() {
    if (camera.near === clipNear && camera.far === clipFar) return;
    st.pageClip = [camera.near, camera.far];
    camera.near = clipNear; camera.far = clipFar;
    camera.updateProjectionMatrix();
  }

  // ── input ─────────────────────────────────────────────────────────────────
  const ray = new THREE.Ray();
  function rayOf(h) {
    h.c.updateWorldMatrix(true, false);
    ray.origin.setFromMatrixPosition(h.c.matrixWorld);
    ray.direction.set(0, 0, -1).transformDirection(h.c.matrixWorld);
    return ray;
  }
  function onSelect(h) {
    if (!st.session) return;
    if (st.kind === 'ar' && !st.placed) {
      if (st.hitPose) { placeAt(new THREE.Vector3().setFromMatrixPosition(st.hitPose), st.lastHead); st.surface = true; }
      else placeInFront(st.lastHead);
      return;
    }
    if (panel) { const hit = panel.hit(rayOf(h)); if (hit.row >= 0) { rows[hit.row].run(); panel.draw(); return; } if (hit.row === -2) return; }
    if (o.onRay && o.onRay(rayOf(h).clone(), 'select') === true) return;
    startGrab(h);
  }
  function startGrab(h) {
    if (!st.session || !st.placed) return;
    h.grab = true;
    for (const k of hands) if (k.grab) beginGrab(k);
  }
  function release(h) {
    if (!h.grab) return;
    h.grab = false;
    for (const k of hands) if (k.grab) beginGrab(k);
  }
  // Store the start pose of every grabbing hand and of the model, so each
  // frame applies the change since the start.
  function beginGrab() {
    const g = hands.filter(k => k.grab);
    for (const k of g) { k.c.updateWorldMatrix(true, false); k.g0 = { pos: new THREE.Vector3().setFromMatrixPosition(k.c.matrixWorld), yaw: yawOf(k.c.matrixWorld) }; }
    st.grab0 = { p: st.p.clone(), yaw: st.yaw, s: st.s };
  }
  function handleGrab() {
    const g = hands.filter(k => k.grab && k.g0);
    if (!g.length || !st.grab0) return;
    const m0 = st.grab0;
    if (g.length === 1) {
      const k = g[0];
      const pos = tmpV.setFromMatrixPosition(k.c.matrixWorld), dy = yawOf(k.c.matrixWorld) - k.g0.yaw;
      // move with the hand, and turn about the hand by the hand's yaw change
      st.p.copy(m0.p).sub(k.g0.pos).applyAxisAngle(Y, dy).add(pos);
      st.yaw = m0.yaw + dy; st.s = m0.s;
    } else {
      const [a, b] = g;
      const a1 = tmpV.setFromMatrixPosition(a.c.matrixWorld), b1 = tmpV2.setFromMatrixPosition(b.c.matrixWorld);
      const mid0 = a.g0.pos.clone().add(b.g0.pos).multiplyScalar(0.5), mid1 = a1.clone().add(b1).multiplyScalar(0.5);
      const v0 = b.g0.pos.clone().sub(a.g0.pos), v1 = b1.clone().sub(a1);
      const k = Math.max(0.05, Math.min(20, v1.length() / Math.max(1e-4, v0.length())));
      const dy = Math.atan2(v1.x, v1.z) - Math.atan2(v0.x, v0.z);
      st.p.copy(m0.p).sub(mid0).multiplyScalar(k).applyAxisAngle(Y, dy).add(mid1);
      st.yaw = m0.yaw + dy; st.s = m0.s * k;
    }
    applyRoot();
  }
  function handleSticks(dt) {
    for (const h of hands) {
      const gp = h.src && h.src.gamepad;
      if (!gp || gp.axes.length < 4) continue;
      const x = gp.axes[2], y = gp.axes[3];
      if (Math.abs(x) > 0.2) st.yaw -= x * 1.6 * dt;
      if (Math.abs(y) > 0.2) st.s *= Math.exp(-y * 1.1 * dt);
      if (Math.abs(x) > 0.2 || Math.abs(y) > 0.2) { applyRoot(); if (hands.some(k => k.grab)) beginGrab(); }
    }
  }

  // ── one XR frame ──────────────────────────────────────────────────────────
  function tick(t, frame) {
    if (!st.session) return;
    st.inTick = true;
    try { tickBody(t, frame); } finally { st.inTick = false; }
  }
  function tickBody(t, frame) {
    const dt = st.last ? Math.min(0.05, (t - st.last) / 1000) : 0.016; st.last = t;
    st.ticks++;
    holdClip();
    st.xrTarget = renderer.getRenderTarget();
    st.mainRenders = 0;
    const head = headPose(frame);
    if (head) st.lastHead = head;
    if (st.needPlace && head) {
      st.needPlace = false;
      if (st.kind === 'vr' || !st.hitSrc) placeInFront(head);
      placePanel(head);
    }
    // AR surface reticle until the model is placed
    if (st.hitSrc && !st.placed && frame) {
      const r = frame.getHitTestResults(st.hitSrc);
      const pose = r.length ? r[0].getPose(st.refSpace) : null;
      st.hitPose = pose ? new THREE.Matrix4().fromArray(pose.transform.matrix) : null;
      reticle.visible = !!pose;
      if (pose) reticle.matrix.copy(st.hitPose);
    }
    // the lib group cancels the root transform when root is the scene
    syncLibWorld();
    handleGrab();
    handleSticks(dt);
    // hover: panel first, then the page
    let hoverRow = -1, label = null;
    for (const h of hands) {
      if (!h.src) continue;
      const r = rayOf(h);
      const hit = panel ? panel.hit(r) : { row: -1, d: Infinity };
      if (hit.row >= 0) hoverRow = hit.row;
      h.line.scale.z = isFinite(hit.d) ? hit.d : 3;
      if (hit.row === -1 && o.onRay && label == null) { const s = o.onRay(r.clone(), 'hover'); if (typeof s === 'string') label = s; }
    }
    if (panel) {
      // labels read page state (for example Explode / Assemble): redraw twice a second
      if ((st.frameN = (st.frameN || 0) + 1) % 36 === 0) panel.draw();
      panel.setHover(hoverRow);
      panel.setStatus(st.status || label || (st.kind === 'ar' && !st.placed ? (st.hitSrc ? 'Point at a surface, then select' : 'Select to place') : 'Trigger or pinch to grab · two hands scale'));
    }
    if (root === scene) { scene.updateMatrix(); libWorld.matrix.copy(scene.matrix).invert(); }
    if (o.update) o.update(dt, frame);
    holdClip();   // o.update may swap the model and set a page near plane
    if (bridge) {
      // page loops expect a rAF time stamp (the performance.now() clock); an
      // XR frame time can use another origin (IWER does)
      bridge.flush(performance.now());
      if (!st.mainRenders) renderer.render(scene, camera);
    }
  }

  // ── session start and end ─────────────────────────────────────────────────
  async function enter(kind) {
    if (st.session || !navigator.xr) return;
    const mode = kind === 'ar' ? 'immersive-ar' : 'immersive-vr';
    const opt = { optionalFeatures: kind === 'ar' ? ['local-floor', 'hit-test', 'hand-tracking'] : ['local-floor', 'bounded-floor', 'hand-tracking'] };
    let s;
    try { s = await navigator.xr.requestSession(mode, opt); } catch (e) { console.warn('xr-view: session refused', e); return; }
    st.saved = {
      pos: root.position.clone(), quat: root.quaternion.clone(), scale: root.scale.clone(),
      cam: { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov, zoom: camera.zoom },
      controls: controls ? controls.enabled : null, bg: scene.background, clearAlpha: renderer.getClearAlpha(),
      hidden: [...(o.hideInXR || []), ...(kind === 'ar' ? o.hideInAR || [] : [])].map(x => [x, x.visible]),
    };
    // local-floor where the device has it; else local, with the floor 1.5 m down
    let ref = 'local-floor';
    try { await s.requestReferenceSpace('local-floor'); } catch (e) { ref = 'local'; }
    st.floorY = ref === 'local' ? -1.5 : 0;
    renderer.xr.setReferenceSpaceType(ref);
    st.session = s; st.kind = kind; st.placed = false; st.needPlace = true; st.last = 0; st.hitPose = null;
    st.surface = false; st.pageClip = null;
    s.addEventListener('end', cleanup);
    try { await renderer.xr.setSession(s); } catch (e) { console.warn('xr-view: setSession failed', e); s.end(); return; }
    st.refSpace = renderer.xr.getReferenceSpace();
    if (kind === 'ar') {
      try { const viewer = await s.requestReferenceSpace('viewer'); st.hitSrc = await s.requestHitTestSource({ space: viewer }); } catch (e) { st.hitSrc = null; }
      scene.background = null; renderer.setClearAlpha(0);
    }
    backdrop.visible = kind === 'vr';
    for (const [x] of st.saved.hidden) x.visible = false;
    if (controls) controls.enabled = false;
    // holdClip runs in the first XR frame, after o.onEnter: a page that
    // saves its own near / far in onEnter still saves its page values
    panel = makePanel(THREE, o.title || 'View', rows);
    libWorld.add(panel.mesh);
    scene.add(libWorld);
    // the model stays hidden in AR until it is placed
    if (kind === 'ar') { st.s = 0; root.scale.setScalar(0); }
    document.body.classList.add('xr-active');
    setButtons();
    if (bridge) renderer.setAnimationLoop(tick);
    if (o.onEnter) o.onEnter(kind);
  }
  function cleanup() {
    const sv = st.saved;
    if (bridge) renderer.setAnimationLoop(null);
    if (st.hitSrc) { try { st.hitSrc.cancel(); } catch (e) { /* ended */ } }
    st.session = null; st.hitSrc = null; st.kind = null; st.placed = false; st.inTick = false;
    for (const h of hands) { h.grab = false; h.g0 = null; }
    scene.remove(libWorld);
    if (panel) { libWorld.remove(panel.mesh); panel.dispose(); panel = null; }
    if (sv) {
      root.position.copy(sv.pos); root.quaternion.copy(sv.quat); root.scale.copy(sv.scale);
      camera.position.copy(sv.cam.pos); camera.quaternion.copy(sv.cam.quat);
      if (st.pageClip) { camera.near = st.pageClip[0]; camera.far = st.pageClip[1]; }
      camera.fov = sv.cam.fov; camera.zoom = sv.cam.zoom; camera.updateProjectionMatrix();
      if (controls) { controls.enabled = sv.controls; if (controls.update) controls.update(); }
      scene.background = sv.bg; renderer.setClearAlpha(sv.clearAlpha);
      for (const [x, v] of sv.hidden) x.visible = v;
    }
    st.saved = null; st.pageClip = null;
    document.body.classList.remove('xr-active');
    setButtons();
    if (o.onExit) o.onExit();
  }
  function exit() { if (st.session) st.session.end().catch(() => cleanup()); }
  function reset() { if (st.session) { placeInFront(st.lastHead); placePanel(st.lastHead); } }
  // A size change places the model again with the box of the new size: on
  // the same AR surface point, else in front of the viewer. (Keeping the old
  // base point gave a wrong base when bounds() depends on the size.)
  function setSize(name) {
    if (name === 'life' && !hasLife) return;
    st.size = name;
    if (st.session && st.placed) {
      if (st.surface) placeAt(st.p.clone(), st.lastHead);
      else placeInFront(st.lastHead);
      placePanel(st.lastHead);
    }
  }

  // ── buttons ───────────────────────────────────────────────────────────────
  const support = { vr: false, ar: false };
  const btn = { vr: o.vrButton || null, ar: o.arButton || null };
  function setButtons() {
    for (const k of ['vr', 'ar']) {
      const b = btn[k]; if (!b) continue;
      b.hidden = !support[k];
      b.classList.toggle('on', st.kind === k);
      b.textContent = st.kind === k ? (k === 'vr' ? 'Exit VR' : 'Exit AR') : (k === 'vr' ? (o.vrLabel || 'View in VR') : (o.arLabel || 'View in AR'));
      b.disabled = !!st.session && st.kind !== k;
    }
  }
  for (const k of ['vr', 'ar']) {
    if (!btn[k]) continue;
    btn[k].hidden = true;
    btn[k].addEventListener('click', () => { if (st.kind === k) exit(); else enter(k); });
  }
  const checks = ['vr', 'ar'].map(k => !navigator.xr ? Promise.resolve(false)
    : navigator.xr.isSessionSupported(k === 'vr' ? 'immersive-vr' : 'immersive-ar').catch(() => false).then(ok => { support[k] = !!ok; }));
  const ready = Promise.all(checks).then(() => { setButtons(); if (o.onSupport) o.onSupport({ ...support }); return { ...support }; });

  // ── release on page swap ──────────────────────────────────────────────────
  const rel0 = window.__snRelease;
  window.__snRelease = function () { exit(); if (rel0) return rel0.apply(this, arguments); };
  const onHide = () => exit();
  window.addEventListener('pagehide', onHide);

  const api = {
    enter, exit, reset, setSize, ready,
    get presenting() { return !!st.session; },
    get kind() { return st.kind; },
    get size() { return st.size; },
    get placement() { return { p: st.p.clone(), yaw: st.yaw, s: st.s, placed: st.placed }; },
    setStatus(s) { st.status = s || ''; },
    update: tick,
    refreshPanel() { if (panel) panel.draw(); },
    dispose() {
      exit();
      window.removeEventListener('pagehide', onHide);
      renderer.render = render0; renderer.setSize = setSize0; renderer.setPixelRatio = setPR0;
      reticle.geometry.dispose(); reticle.material.dispose(); backdrop.geometry.dispose(); backdrop.material.dispose();
    },
    // for tests and the console: the objects the lib moves and reads
    debug: { root, scene, camera, controls, renderer, THREE, panelMesh: () => panel && panel.mesh,
      head: () => st.lastHead, ticks: () => st.ticks, rows: () => rows.map(r => typeof r.label === 'function' ? r.label() : r.label) },
  };
  window.__xrView = api;
  return api;
}
