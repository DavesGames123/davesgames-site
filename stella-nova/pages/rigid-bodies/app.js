// ============================================================================
//  RIGID BODIES  ·  pages/rigid-bodies/app.js — the page controller
// ----------------------------------------------------------------------------
//  The sim kit (widgets/sim-kit/ui.js mount) owns the GUI state; scenes.js
//  holds the schema and the scene builders; sim.js the upstream XPBD
//  classes. A key in scenes.REBUILD builds a new scene (the old bodies are
//  disposed); the gravity, wind and look keys are live. The loop calls the
//  upstream RigidBodySimulator.simulate() once per 1/60 s (kit.speed
//  scales the rate), with the wind and its gusts added to the gravity, and
//  draws with the shared three.js stage (widgets/sim-kit/stage3d.js). A
//  drag on a body uses the upstream drag constraint; let go fast and the
//  body flies (XPBD takes the velocity from the motion).
//
//  Credit: Ten Minute Physics #22 by Matthias Müller (MIT); main.js sets
//  the TMP credit bar.
//
//  grep -n targets
//    scene build .......... "function rebuild"
//    colours .............. "function colour"
//    frame loop ........... "function frame"
//    autopilot hand ....... "hand:"
//    saver hooks .......... "window.__rb"
// ============================================================================
import { setLabelCamera } from './sim.js';
import * as SC from './scenes.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { createStage } from '../../widgets/sim-kit/stage3d.js';
import { installSaver } from './saver.js';

export function start() {
  const THREE = globalThis.THREE;
  const PHONE = isPhone();
  const SCHEMA = SC.makeSchema(PHONE);
  let kit = null, sim = null;

  const stage = createStage({ THREE, phone: PHONE, fov: 45, camera: [0.4, 2.0, 3.4], target: [0, 1.6, 0], shadowR: 2.5 });
  const { scene } = stage;
  setLabelCamera(stage.camera);
  const root = new THREE.Group(); scene.add(root);

  // Recolour the upstream meshes (white boxes, white/red spheres, red
  // cylinders) with the palette and theme; text labels take the ink.
  function colour() {
    if (!sim) return;
    const st = kit.state, t = K.themeById(st.theme), pal = K.paletteColors(st.palette);
    sim.rigidBodies.forEach((b, i) => {
      const c = pal[i % pal.length];
      b.meshes.forEach((m, k) => {
        if (m.material && m.material.dispose && !m.userData.shared) m.material.dispose();
        m.material = stage.material(k === 0 ? c : K.mixHex(c, t.dark ? '#000000' : '#ffffff', 0.45), st.finish);
        m.userData.shared = true;
      });
      if (b.textRenderer && b.textRenderer.textMesh) b.textRenderer.textMesh.material.color.set(t.ink);
    });
    const thread = st.threads === 'red' ? '#ff2020' : st.threads === 'wall' ? t.wall : t.accent;
    for (const c of sim.distanceConstraints) { if (c.cylinder) c.cylinder.material.color.set(thread); if (c.textRenderer && c.textRenderer.textMesh) c.textRenderer.textMesh.material.color.set(t.ink); }
  }
  function applyLook() {
    const st = kit.state;
    stage.setLook({ theme: st.theme, light: st.light, floor: st.floor, finish: st.finish });
    colour();
  }
  function rebuild() {
    if (sim) sim.dispose();
    while (root.children.length) root.remove(root.children[0]);
    sim = SC.buildScene(root, SC.sceneConfig(kit.state), SC.sceneRng(kit.seed));
    gustT = 0; hand = null;
    applyLook();
    // labels load their font later: colour them when they appear
    setTimeout(colour, 800); setTimeout(colour, 2500);
  }

  // ---- pointer: the upstream drag constraint ---------------------------------------------
  stage.grab({
    pick(ray) {
      ray.layers.set(1);
      const hits = ray.intersectObjects(root.children, true);
      ray.layers.set(0);
      const h = hits.find(x => x.object.body);
      if (!h) return null;
      sim.startDrag(h.object.body, h.point.clone());
      return { id: 0, point: h.point.clone() };
    },
    move(id, p) { if (sim) sim.drag(p.clone()); },
    drop() { if (sim) sim.endDrag(); },
  });

  // ---- autopilot hand (screensaver): pull a body along a path, let go -----------------------
  let hand = null;
  function handTick(dt) {
    if (!hand || !sim) return;
    hand.t += dt;
    if (hand.phase === 'rest' && hand.t > hand.rest) {
      const bs = sim.rigidBodies.filter(b => b.invMass > 0); if (!bs.length) return;
      const b = hand.pick(bs); hand.p0 = b.pos.clone(); hand.d = hand.dir();
      if (hand.soft) sim.dragCompliance = hand.soft;
      sim.startDrag(b, hand.p0.clone()); hand.phase = 'pull'; hand.t = 0;
    } else if (hand.phase === 'pull') {
      const u = Math.min(1, hand.t / hand.dur), e = u * u * (3 - 2 * u);
      sim.drag(hand.p0.clone().addScaledVector(hand.d, e));
      if (u >= 1) { sim.endDrag(); sim.dragCompliance = 0.001; hand.phase = 'rest'; hand.t = 0; }
    }
  }

  // ---- view -----------------------------------------------------------------------------------
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

  // ---- loop -----------------------------------------------------------------------------------
  let lastT = 0, acc = 0, gustT = 0;
  const H = 1 / 60, hooks = { tick: null };
  function step() {
    const st = kit.state, k = 1 + st.gust * Math.sin(1.7 * gustT) * Math.sin(0.43 * gustT + 1);
    sim.gravity.set(st.windX * k, -st.g, st.windZ * k);
    sim.simulate(); gustT += H;
  }
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
    if (sim) {
      if (kit.playing) {
        acc += dt * kit.speed;
        let n = 0; while (acc >= H && n < 3) { step(); acc -= H; n++; }
        if (n === 3) acc = 0;
      } else if (kit.takeStep()) step();
    }
    if (kit.playing) handTick(dt);
    if (hooks.tick) hooks.tick(dt);
    stage.fit(viewRect());
    stage.tick(dt);
    stage.render();
  }

  // ---- boot -------------------------------------------------------------------------------------
  kit = mount({
    schema: SCHEMA, title: 'Rigid Bodies', sub: 'XPBD bodies on threads: mobiles, chains, pendulum waves and nets', panelTitle: 'Scene',
    guard: SC.guard, themeKey: 'theme',
    footer: 'Upstream bodies, constraints and the two first scenes by Matthias Müller (Ten Minute Physics #22, MIT). Other scenes, look and GUI: davesgames.io.',
    actions: {
      act(id) {
        if (!sim) return;
        const r = K.rng(K.newSeed());
        for (const b of sim.rigidBodies) {
          if (b.invMass === 0) continue;
          if (id === 'kick') b.vel.add(new THREE.Vector3((r() - 0.5) * 3, r() * 2, (r() - 0.5) * 3));
          else if (id === 'spin') b.omega.add(new THREE.Vector3(0, 3 + 3 * r(), 0));
          else if (id === 'still') { b.vel.set(0, 0, 0); b.omega.set(0, 0, 0); }
        }
      },
    },
  });
  kit.on('change', (out, st, why) => {
    if (why === 'scene' || why === 'group' || why === 'saver') return;
    const keys = Object.keys(out);
    if (keys.some(k => SC.REBUILD.has(k))) rebuild();
    else if (keys.some(k => ['theme', 'light', 'floor', 'finish', 'palette', 'threads'].includes(k))) applyLook();
  });
  kit.on('scene', (seed, st, out, group) => { if (!group || Object.keys(out || {}).some(k => SC.REBUILD.has(k))) rebuild(); else applyLook(); });
  kit.on('reset', rebuild);
  if (!kit.fromHash) kit.newScene(); else rebuild();
  requestAnimationFrame(frame);
  addEventListener('pagehide', () => { kit.playing = false; });

  const P = window.__rb = {
    get sim() { return sim; }, stage, get kit() { return kit; }, rebuild, applyLook, hooks, THREE,
    setBand(b) { saverBand = b; },
    // hand: { pick(bodies) -> body, dir() -> Vector3, dur, rest } or null
    setHand(h) { if (sim && hand && hand.phase === 'pull') sim.endDrag(); hand = h ? Object.assign({ phase: 'rest', t: 0 }, h) : null; },
  };
  installSaver(P);
  return P;
}
