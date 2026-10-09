// ============================================================================
//  CANNONBALL 3D  ·  pages/cannonball-3d/app.js — the page controller
// ----------------------------------------------------------------------------
//  start({ vr, VRButton, title, credit }) runs the cannonball page. Both
//  cannonball-3d/main.js and cannonball-vr/main.js call it; the VR page
//  passes the three.js VRButton and gets renderer.xr and an animation loop.
//
//  Flow: the sim kit (widgets/sim-kit/ui.js mount) owns the GUI state. The
//  schema and scene rules are in scene.js, the physics in sim.js (the
//  upstream step plus our additions). A change to a key in scene.REBUILD
//  builds a new scene; any other key is a live set. The loop steps the sim
//  at 60 Hz (kit.speed scales it) and draws with the shared three.js stage
//  (widgets/sim-kit/stage3d.js): instanced balls, the box, bumpers,
//  crates, the cannon and trails.
//
//  Credit: Ten Minute Physics #02 by Matthias Müller (MIT); the credit bar
//  (widgets/ten-minute-physics/kit.js TMP.page) is set by main.js.
//
//  grep -n targets
//    scene build .......... "function rebuild"
//    meshes ............... "function syncMeshes"
//    look ................. "function applyLook"
//    clear view rect ...... "function viewRect"
//    frame loop ........... "function frame"
//    saver hooks .......... "window.__cb"
// ============================================================================
import * as SIM from './sim.js';
import * as SC from './scene.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { createStage } from '../../widgets/sim-kit/stage3d.js';
import { installSaver } from './saver.js';

export function start(o = {}) {
  const THREE = globalThis.THREE;
  const PHONE = isPhone();
  const SCHEMA = SC.makeSchema(PHONE);
  const CAP = PHONE ? 120 : 220;
  const S = SIM.createSim();
  S.P.cap = CAP;
  let kit = null;

  const stage = createStage({ THREE, phone: PHONE, xr: !!o.vr, fov: 45, camera: [3.2, 2.4, 6.2], target: [0, 0.6, 0], floorSize: 40, shadowR: 4 });
  const { scene } = stage;
  const root = new THREE.Group(); scene.add(root);

  // ---- meshes ----------------------------------------------------------------------
  const seg = PHONE ? [18, 12] : [32, 22];
  const ballGeo = new THREE.SphereGeometry(1, seg[0], seg[1]);
  let ballMat = stage.material('#ffffff');
  const balls = new THREE.InstancedMesh(ballGeo, ballMat, CAP);
  balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  balls.castShadow = true; balls.receiveShadow = true; balls.count = 0;
  balls.frustumCulled = false;
  root.add(balls);
  const colors = new Float32Array(CAP * 3);
  balls.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SCL = new THREE.Vector3(), C = new THREE.Color(), WHITE = new THREE.Color(1, 1, 1);
  let palette = [], spin = [];

  let box = null, obs = [], cannon = null;
  const trails = [];
  const TRAIL_N = PHONE ? 4 : 8, TRAIL_L = 90;
  function makeBox() {
    if (box) { root.remove(box); box.geometry.dispose(); box.material.dispose(); }
    const g = new THREE.BoxGeometry(2 * S.P.hx, 2.2, 2 * S.P.hz);
    const t = K.themeById(kit.state.theme);
    box = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: new THREE.Color(t.wall), transparent: true, opacity: 0.45 }));
    g.dispose();
    box.position.y = 1.1; box.visible = kit.state.walls;
    root.add(box);
  }
  function makeObstacles() {
    for (const m of obs) { root.remove(m); m.geometry.dispose(); }
    obs = [];
    const t = K.themeById(kit.state.theme);
    for (const ob of S.obstacles) {
      let m;
      if (ob.kind === 'sphere') { m = new THREE.Mesh(new THREE.SphereGeometry(ob.r, 28, 20), stage.material(t.accent, 'metal')); m.position.set(ob.x, ob.y, ob.z); }
      else { m = new THREE.Mesh(new THREE.BoxGeometry(2 * ob.hx, 2 * ob.hy, 2 * ob.hz), stage.material(K.mixHex(t.wall, '#a0754a', 0.6), 'matte')); m.position.set(ob.x, ob.hy, ob.z); }
      m.castShadow = true; m.receiveShadow = true; root.add(m); obs.push(m);
    }
  }
  function makeCannon() {
    if (cannon) { root.remove(cannon); cannon.traverse(x => x.geometry && x.geometry.dispose()); }
    const t = K.themeById(kit.state.theme), c = SIM.cannonPose(S);
    cannon = new THREE.Group();
    const mat = stage.material(K.mixHex(t.wall, '#30343c', 0.7), 'metal');
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.16, 24), mat); base.position.y = 0.08;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.62, 24), mat);
    barrel.rotation.x = Math.PI / 2 - c.pitch; barrel.position.set(0, 0.3, 0.12);
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 10, 24), stage.material(t.accent, 'metal'));
    muzzle.position.set(0, 0.3 + 0.31 * Math.sin(c.pitch), 0.12 + 0.31 * Math.cos(c.pitch)); muzzle.rotation.x = -c.pitch;
    for (const m of [base, barrel, muzzle]) { m.castShadow = true; cannon.add(m); }
    cannon.position.set(c.x, 0, c.z);
    cannon.visible = kit.state.cannon;
    root.add(cannon);
  }
  function makeTrails() {
    for (const tr of trails) { root.remove(tr.line); tr.line.geometry.dispose(); tr.line.material.dispose(); }
    trails.length = 0;
    for (let i = 0; i < TRAIL_N; i++) {
      const pos = new Float32Array(TRAIL_L * 3), g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setDrawRange(0, 0);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
      line.frustumCulled = false; root.add(line);
      trails.push({ line, pos, n: 0, ball: -1 });
    }
  }

  function applyLook() {
    const st = kit.state;
    stage.setLook({ theme: st.theme, light: st.light, floor: st.floor, finish: st.finish, fog: true });
    ballMat = stage.material('#ffffff', st.finish); balls.material = ballMat;
    palette = K.paletteColors(st.palette).map(h => new THREE.Color(h));
    makeBox(); makeObstacles(); makeCannon();
    trails.forEach((tr, i) => tr.line.material.color.copy(palette[i % palette.length]));
  }

  function rebuild() {
    const st = kit.state;
    SC.applyParams(S, st);
    SIM.buildScene(S, SC.sceneConfig(st), SC.sceneRng(kit.seed));
    spin = S.balls.map(() => new THREE.Quaternion());
    stage.shadowBox(Math.max(S.P.hx, S.P.hz) + 1);
    applyLook();
    for (const tr of trails) { tr.n = 0; tr.ball = -1; }
  }
  function applyParams() {
    SC.applyParams(S, kit.state);
    if (cannon) cannon.visible = kit.state.cannon;
    if (box) box.visible = kit.state.walls;
  }

  // Instance matrices and colours; trails follow the first balls.
  const ax = new THREE.Vector3();
  function syncMeshes(dt) {
    const n = Math.min(S.balls.length, CAP);
    balls.count = n;
    const flash = kit.state.flash;
    while (spin.length < n) spin.push(new THREE.Quaternion());
    for (let i = 0; i < n; i++) {
      const b = S.balls[i];
      // roll: turn about the axis across the motion, at v / r
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 1e-3 && dt > 0) { ax.set(b.vz, 0, -b.vx).normalize(); Q.setFromAxisAngle(ax, sp / b.r * dt); spin[i].premultiply(Q); }
      M.compose(V.set(b.x, b.y, b.z), spin[i], SCL.set(b.r, b.r, b.r));
      balls.setMatrixAt(i, M);
      C.copy(palette[b.ci % palette.length] || WHITE);
      if (flash && b.bounce > 0.05) C.lerp(WHITE, Math.min(0.7, b.bounce * 0.7));
      if (i === S.held) C.lerp(WHITE, 0.35);
      balls.setColorAt(i, C);
    }
    balls.instanceMatrix.needsUpdate = true;
    if (balls.instanceColor) balls.instanceColor.needsUpdate = true;
    const on = kit.state.trails;
    trails.forEach((tr, k) => {
      tr.line.visible = on && k < n;
      if (!tr.line.visible) return;
      const bi = Math.floor(k * n / Math.min(n, trails.length));
      if (tr.ball !== bi) { tr.ball = bi; tr.n = 0; }
      const b = S.balls[bi]; if (!b) return;
      if (tr.n < TRAIL_L) tr.n++; else tr.pos.copyWithin(0, 3);
      const j = (tr.n - 1) * 3; tr.pos[j] = b.x; tr.pos[j + 1] = b.y; tr.pos[j + 2] = b.z;
      tr.line.geometry.setDrawRange(0, tr.n); tr.line.geometry.attributes.position.needsUpdate = true;
    });
  }

  // ---- view ---------------------------------------------------------------------------
  let saverBand = null;
  function viewRect() {
    if (saverBand) return saverBand;
    const panel = document.getElementById('sk-panel'), tr = document.querySelector('.sk-transport');
    let x1 = innerWidth, y1 = innerHeight;
    if (kit && kit.panelOpen && panel && !PHONE && panel.getBoundingClientRect) x1 = Math.max(innerWidth * 0.45, panel.getBoundingClientRect().left || innerWidth);
    if (tr && tr.getBoundingClientRect) { const t = tr.getBoundingClientRect().top; if (t > 0) y1 = Math.min(y1, t - 6); }
    if (kit && kit.panelOpen && PHONE && panel && panel.getBoundingClientRect) { const t = panel.getBoundingClientRect().top; if (t > 0) y1 = Math.min(y1, t); }
    return { x: 0, y: 48, w: Math.max(80, x1), h: Math.max(80, y1 - 48) };
  }

  // ---- pointer: grab a ball and throw it --------------------------------------------------
  stage.grab({
    pick(ray) {
      const o = ray.ray.origin, d = ray.ray.direction, p = SIM.pick(S, [o.x, o.y, o.z], [d.x, d.y, d.z]);
      if (p.i < 0) return null;
      const pt = new THREE.Vector3().copy(o).addScaledVector(d, p.t);
      SIM.grab(S, p.i, [S.balls[p.i].x, S.balls[p.i].y, S.balls[p.i].z]);
      return { id: p.i, point: pt };
    },
    move(id, p, v) { SIM.hold(S, [p.x, Math.max(S.balls[id] ? S.balls[id].r : 0.1, p.y), p.z], [v.x, v.y, v.z]); },
    drop(id, v) { SIM.release(S, [v.x, v.y, v.z]); },
  });

  // ---- loop -----------------------------------------------------------------------------
  let lastT = 0, acc = 0;
  const H = 1 / 60;
  const hooks = { tick: null };
  const xrLoop = !!(o.vr && stage.renderer);   // the renderer loop drives frames
  function frame(ts) {
    if (!xrLoop) requestAnimationFrame(frame);
    const dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
    let moved = 0;
    if (kit.playing) {
      acc += dt * kit.speed;
      let n = 0; while (acc >= H && n < 4) { S.step(H); acc -= H; n++; moved += H; }
      if (n === 4) acc = 0;
    } else if (kit.takeStep()) { S.step(H); moved = H; }
    if (hooks.tick) hooks.tick(dt);
    stage.fit(viewRect());
    stage.tick(dt);
    syncMeshes(moved);
    stage.render();
  }

  // ---- boot -------------------------------------------------------------------------------
  kit = mount({
    schema: SCHEMA, title: o.title || 'Cannonball 3D', sub: o.sub || 'Balls, gravity and a box: the Ten Minute Physics cannonball, grown up', panelTitle: 'Scene',
    guard: SC.guard, themeKey: 'theme',
    footer: 'Upstream step by Matthias Müller (Ten Minute Physics #02, MIT). Many balls, collisions, cannon, look and GUI: davesgames.io.',
    actions: {
      act(id) {
        const r = K.rng(K.newSeed());
        if (id === 'fire') { S.rngFire = S.rngFire || r; SIM.fire(S, r); spin.push(new THREE.Quaternion()); }
        else if (id === 'kick') for (const b of S.balls) { b.vy += 3 + 4 * r(); b.vx += (r() - 0.5) * 3; b.vz += (r() - 0.5) * 3; }
        else if (id === 'add') { const st = kit.state, rad = st.rMin + (st.rMax - st.rMin) * r(); if (S.balls.length < CAP) S.balls.push(SIM.makeBall((r() - 0.5) * S.P.hx, 2 + r(), (r() - 0.5) * S.P.hz, 0, 0, 0, rad, st.density, S.balls.length % 6)); }
        else if (id === 'clear') { S.balls.length = 0; S.held = -1; }
      },
    },
  });
  kit.on('change', (out, st, why) => {
    if (why === 'scene' || why === 'group' || why === 'saver') return;
    const keys = Object.keys(out);
    if (keys.some(k => SC.REBUILD.has(k))) rebuild();
    else { applyParams(); if (keys.some(k => ['theme', 'light', 'floor', 'finish', 'palette'].includes(k))) applyLook(); }
  });
  kit.on('scene', (seed, st, out, group) => { if (!group || Object.keys(out || {}).some(k => SC.REBUILD.has(k))) rebuild(); else { applyParams(); applyLook(); } });
  kit.on('reset', rebuild);
  makeTrails();
  if (!kit.fromHash) kit.newScene(); else rebuild();

  if (xrLoop) {
    // VR: the three.js VRButton and the renderer animation loop (it also
    // runs the frames outside a session).
    if (o.VRButton) {
      const slot = document.createElement('div'); slot.className = 'vr-slot';
      slot.appendChild(o.VRButton.createButton(stage.renderer));
      document.body.appendChild(slot);
    }
    stage.renderer.setAnimationLoop(frame);
  } else requestAnimationFrame(frame);
  addEventListener('pagehide', () => { kit.playing = false; if (stage.renderer) stage.renderer.setAnimationLoop(null); });

  const P = window.__cb = {
    S, stage, get kit() { return kit; }, rebuild, applyParams, applyLook, hooks, THREE,
    setBand(b) { saverBand = b; },
  };
  installSaver(P);
  return P;
}
