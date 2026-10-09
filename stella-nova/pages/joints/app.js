// ============================================================================
//  JOINT SIMULATION  ·  pages/joints/app.js — the page controller
// ----------------------------------------------------------------------------
//  The sim kit (widgets/sim-kit/ui.js mount) owns the GUI state; scenes.js
//  holds the schema and our scenes in the importer format; engine.js the
//  upstream joint engine. A key in scenes.REBUILD loads a new scene: an
//  upstream JSON file (fetched once) or a made one, through the upstream
//  SceneImporter. The loop calls the upstream simulate() at its 30 steps
//  per second (kit.speed and the time scale change the rate), and draws
//  with the shared three.js stage (widgets/sim-kit/stage3d.js).
//
//  Drive: the upstream joystick (#touchControl) still drives the motor,
//  servo and cylinder joints; with the autopilot on, a slow sine does it
//  when nobody touches the joystick. The arm swings its hinge targets and
//  the carts move on their rails. A drag on a body uses the upstream drag
//  joint; a fast release throws it.
//
//  Credit: Ten Minute Physics #25 by Matthias Müller (MIT); main.js sets
//  the TMP credit bar.
//
//  grep -n targets
//    scene load ........... "async function rebuild"
//    colours .............. "function colour"
//    autopilot ............ "function drive"
//    frame loop ........... "function frame"
//    saver hooks .......... "window.__jt"
// ============================================================================
import { RigidBodySimulator, SceneImporter, Joint } from './engine.js';
import * as SC from './scenes.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { createStage } from '../../widgets/sim-kit/stage3d.js';
import { installSaver } from './saver.js';

export function start() {
  const THREE = globalThis.THREE;
  const PHONE = isPhone();
  const SCHEMA = SC.makeSchema(PHONE);
  let kit = null, sim = null, loading = 0, driveT = 0;
  const fileCache = new Map();

  const stage = createStage({ THREE, phone: PHONE, fov: 45, camera: [0.7, 0.75, 1.9], target: [0, 0.45, 0], floorSize: 20, fogNear: 4, fogFar: 14, shadowR: 1.6 });
  const root = new THREE.Group(); stage.scene.add(root);
  const adapter = { add(m) { root.add(m); }, remove(m) { root.remove(m); } };
  const rgb = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

  // ---- colours ----------------------------------------------------------------------
  function colour() {
    if (!sim) return;
    const st = kit.state, t = K.themeById(st.theme), pal = K.paletteColors(st.palette), mine = !SC.isFile(st.scene);
    sim.rigidBodies.forEach((b, i) => {
      b.meshes.forEach((m, k) => {
        if (!m.material || !m.material.color) return;
        if (m.userData.orig == null) m.userData.orig = '#' + m.material.color.getHexString();
        const vis = k >= (b.firstVisualMesh || 0);
        const c = !vis ? K.mixHex(t.wall, t.bg, 0.3) : (!mine && st.recolour) ? pal[(i + k) % pal.length] : m.userData.orig;
        m.material = stage.material(c, st.finish);
      });
    });
    setFrames(st.frames);
  }
  function setFrames(on) { if (sim && sim.simulationView === !!on) sim.toggleView(); }

  // ---- scene load ---------------------------------------------------------------------
  async function sceneData(st) {
    if (SC.isFile(st.scene)) {
      const url = new URL(SC.FILES[st.scene], import.meta.url).href;
      if (!fileCache.has(url)) fileCache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); }));
      return fileCache.get(url);
    }
    const pal = K.paletteColors(st.palette), t = K.themeById(st.theme);
    return SC.makeScene(SC.sceneConfig(st), SC.sceneRng(kit.seed), { pal: k => rgb(pal[k % pal.length]), wall: rgb(K.mixHex(t.wall, t.bg, 0.25)), accent: rgb(t.accent) });
  }
  async function rebuild() {
    const my = ++loading, st = Object.assign({}, kit.state);
    let data;
    try { data = await sceneData(st); } catch (e) { kit.say('The scene file did not load: ' + e.message); return; }
    if (my !== loading) return;   // a newer load started
    while (root.children.length) root.remove(root.children[0]);
    sim = new RigidBodySimulator(adapter, new THREE.Vector3(0, -st.g, 0));
    sim.numSubSteps = st.substeps;
    sim.onStick = () => kit.setPlaying(true);
    new SceneImporter(sim, adapter).loadScene(data);
    driveT = 0; hand = null;
    applyLook();
    document.body.classList.toggle('jt-stick', st.scene === 'steering');
  }
  function applyLook() {
    const st = kit.state;
    stage.setLook({ theme: st.theme, light: st.light, floor: st.floor, finish: st.finish });
    colour();
  }

  // ---- drive (autopilot) ------------------------------------------------------------
  function drive(dt) {
    const st = kit.state; driveT += dt;
    if (!sim || !st.auto) return;
    const w = 2 * Math.PI * st.rate;
    if (!sim.isDragging) sim.controlVector.set(st.steer * Math.sin(w * driveT), st.throttle * (0.8 + 0.2 * Math.sin(0.5 * w * driveT)));
    if (st.scene === 'arm') sim.joints.forEach((j, k) => { if (j.type === Joint.TYPES.HINGE && j.hasTargetAngle) j.targetAngle = (k ? 0.9 : 1.6) * st.steer * Math.sin(w * driveT * (1 + 0.37 * k) + 1.3 * k); });
    if (st.scene === 'cartpole') sim.rigidBodies.forEach((b, k) => { if (/^cart/.test(b.name || '') || (b.size && b.size.x > 0.12 && b.size.y < 0.07 && b.invMass > 0)) b.vel.x = 0.35 * st.steer * w * Math.cos(w * driveT + k); });
  }

  // ---- autopilot hand (screensaver) -----------------------------------------------------
  let hand = null;
  function handTick(dt) {
    if (!hand || !sim) return;
    hand.t += dt;
    if (hand.phase === 'rest' && hand.t > hand.rest) {
      const bs = sim.rigidBodies.filter(b => b.invMass > 0); if (!bs.length) return;
      const b = bs[Math.floor(hand.r() * bs.length)]; hand.p0 = b.pos.clone();
      const s = hand.r() < 0.5 ? -1 : 1; hand.d = new THREE.Vector3(s * (0.12 + 0.12 * hand.r()), 0.08 + 0.1 * hand.r(), 0.08 * (hand.r() - 0.5));
      sim.startDrag(b, hand.p0.clone()); hand.phase = 'pull'; hand.t = 0;
    } else if (hand.phase === 'pull') {
      const u = Math.min(1, hand.t / hand.dur), e = u * u * (3 - 2 * u);
      sim.drag(hand.p0.clone().addScaledVector(hand.d, e));
      if (u >= 1) { sim.endDrag(); hand.phase = 'rest'; hand.t = 0; }
    }
  }

  // ---- pointer: the upstream drag joint ----------------------------------------------------
  stage.grab({
    pick(ray) {
      if (!sim) return null;
      ray.layers.set(1);
      const hits = ray.intersectObjects(root.children, true);
      ray.layers.set(0);
      const h = hits.find(x => x.object.body && x.object.body.invMass > 0);
      if (!h) return null;
      sim.startDrag(h.object.body, h.point.clone());
      return { id: 0, point: h.point.clone() };
    },
    move(id, p) { if (sim) sim.drag(p.clone()); },
    drop() { if (sim) sim.endDrag(); },
  });

  // ---- view ------------------------------------------------------------------------------
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

  // ---- loop -------------------------------------------------------------------------------
  let lastT = 0, acc = 0;
  const hooks = { tick: null };
  function step() { sim.gravity.set(0, -kit.state.g, 0); drive(sim.dt); sim.simulate(); }
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
    if (sim) {
      const H = sim.dt;
      if (kit.playing) {
        acc += dt * kit.speed * kit.state.slow;
        let n = 0; while (acc >= H && n < 2) { step(); acc -= H; n++; }
        if (n === 2) acc = 0;
        handTick(dt);
      } else if (kit.takeStep()) step();
    }
    if (hooks.tick) hooks.tick(dt);
    stage.fit(viewRect());
    stage.tick(dt);
    stage.render();
  }

  // ---- boot --------------------------------------------------------------------------------
  kit = mount({
    schema: SCHEMA, title: 'Joint Simulation', sub: 'Hinges, motors, servos, ball and prismatic joints, solved with XPBD', panelTitle: 'Scene',
    guard: SC.guard, themeKey: 'theme',
    footer: 'Upstream joint engine and three scenes by Matthias Müller (Ten Minute Physics #25, MIT). Made scenes, drive, look and GUI: davesgames.io.',
    actions: {
      act(id) {
        if (!sim) return;
        const r = K.rng(K.newSeed());
        if (id === 'view') { kit.set('frames', !kit.state.frames); return; }
        for (const b of sim.rigidBodies) {
          if (b.invMass === 0) continue;
          if (id === 'kick') b.vel.add(new THREE.Vector3((r() - 0.5) * 1.5, 0.6 + r(), (r() - 0.5) * 1.5));
          else if (id === 'still') { b.vel.set(0, 0, 0); b.omega.set(0, 0, 0); }
        }
      },
    },
  });
  kit.on('change', (out, st, why) => {
    if (why === 'scene' || why === 'group' || why === 'saver') return;
    const keys = Object.keys(out);
    if (keys.some(k => SC.REBUILD.has(k))) rebuild();
    else if (keys.includes('frames')) setFrames(st.frames);
    else if (keys.some(k => ['theme', 'light', 'floor', 'finish', 'palette', 'recolour'].includes(k))) { if (!SC.isFile(st.scene) && keys.includes('palette')) rebuild(); else applyLook(); }
  });
  kit.on('scene', (seed, st, out, group) => { if (!group || Object.keys(out || {}).some(k => SC.REBUILD.has(k))) rebuild(); else applyLook(); });
  kit.on('reset', rebuild);
  if (!kit.fromHash) kit.newScene(); else rebuild();
  requestAnimationFrame(frame);
  addEventListener('pagehide', () => { kit.playing = false; });

  const P = window.__jt = {
    get sim() { return sim; }, stage, get kit() { return kit; }, rebuild, applyLook, hooks, THREE,
    get loading() { return loading; },
    setBand(b) { saverBand = b; },
    setHand(h) { if (sim && hand && hand.phase === 'pull') sim.endDrag(); hand = h ? Object.assign({ phase: 'rest', t: 0 }, h) : null; },
  };
  installSaver(P);
  return P;
}
