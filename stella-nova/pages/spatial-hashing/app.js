// ============================================================================
//  SPATIAL HASHING  ·  pages/spatial-hashing/app.js — the page controller
// ----------------------------------------------------------------------------
//  The sim kit (widgets/sim-kit/ui.js mount) owns the GUI state; scene.js
//  holds the schema and rules, sim.js the upstream hash and ball loop plus
//  our additions. A key in scene.REBUILD builds a new scene; any other key
//  is a live set. The loop steps the sim at 60 Hz (kit.speed scales it)
//  and draws with the shared three.js stage (widgets/sim-kit/stage3d.js):
//  one instanced mesh for the balls, the box, the glass stirrer sphere,
//  the probe ball and its 27-cell query block, and a HUD line with the
//  pairs the hash checks against all pairs.
//
//  Credit: Ten Minute Physics #11 by Matthias Müller (MIT); main.js sets
//  the TMP credit bar.
//
//  grep -n targets
//    scene build .......... "function rebuild"
//    ball colours ......... "function paint"
//    hud .................. "function hud"
//    frame loop ........... "function frame"
//    saver hooks .......... "window.__sh"
// ============================================================================
import * as SIM from './sim.js';
import * as SC from './scene.js';
import { mount, isPhone, loadColormaps, core as K } from '../../widgets/sim-kit/ui.js';
import { createStage } from '../../widgets/sim-kit/stage3d.js';
import { installSaver } from './saver.js';

export function start() {
  const THREE = globalThis.THREE;
  const PHONE = isPhone();
  const SCHEMA = SC.makeSchema(PHONE);
  const CAP = PHONE ? 4000 : 16000;
  const S = SIM.createSim();
  let kit = null, cm = null, lut = null, lutId = null;

  const stage = createStage({ THREE, phone: PHONE, fov: 45, camera: [2.6, 2.1, 3.6], target: [0, 0.9, 0], shadowR: 3 });
  const { scene } = stage;
  const root = new THREE.Group(); scene.add(root);

  // ---- meshes ---------------------------------------------------------------------
  const geo = new THREE.SphereGeometry(1, PHONE ? 8 : 10, PHONE ? 6 : 8);
  const balls = new THREE.InstancedMesh(geo, stage.material('#ffffff'), CAP);
  balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  balls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  balls.count = 0; balls.frustumCulled = false; balls.receiveShadow = true;
  root.add(balls);
  const M = new THREE.Matrix4(), C = new THREE.Color(), WHITE = new THREE.Color(1, 1, 1);
  let box = null, stirMesh = null, probeBlock = null, pal = [], acc0 = new THREE.Color(), dim0 = new THREE.Color(), orA = new THREE.Color(), orB = new THREE.Color();
  const stirMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false });
  stirMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), stirMat);
  const stirRing = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  stirRing.rotation.x = Math.PI / 2; stirMesh.add(stirRing);
  root.add(stirMesh);
  probeBlock = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  root.add(probeBlock);
  const cellLines = new THREE.Group(); root.add(cellLines);

  function makeBox() {
    if (box) { root.remove(box); box.geometry.dispose(); box.material.dispose(); }
    const b = S.bounds, t = K.themeById(kit.state.theme);
    const g = new THREE.BoxGeometry(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    box = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: new THREE.Color(t.wall), transparent: true, opacity: 0.5 }));
    g.dispose();
    box.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    root.add(box);
  }
  // the 27 cells of the probe query: a 3 x 3 x 3 lattice of size 2r cells
  function makeCells() {
    while (cellLines.children.length) { const c = cellLines.children.pop(); c.geometry.dispose(); c.material.dispose(); }
    const s = 2 * S.radius, pts = [];
    for (let a = 0; a <= 3; a++) for (let b = 0; b <= 3; b++) {
      pts.push(a * s, b * s, 0, a * s, b * s, 3 * s); pts.push(a * s, 0, b * s, a * s, 3 * s, b * s); pts.push(0, a * s, b * s, 3 * s, a * s, b * s);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    cellLines.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(K.themeById(kit.state.theme).accent), transparent: true, opacity: 0.55 })));
  }

  function applyLook() {
    const st = kit.state, t = K.themeById(st.theme);
    stage.setLook({ theme: st.theme, light: st.light, floor: st.floor, finish: st.finish });
    balls.material = stage.material('#ffffff', st.finish);
    pal = K.paletteColors(st.palette).map(h => new THREE.Color(h));
    acc0.set(t.accent); dim0.set(K.mixHex(t.wall, t.bg, 0.35));
    // the two start sides: the first palette colour and its opposite hue
    orA.copy(pal[0] || WHITE); const hsl = {}; orA.getHSL(hsl); orB.setHSL((hsl.h + 0.5) % 1, Math.max(0.6, hsl.s), Math.min(0.6, Math.max(0.45, hsl.l)));
    stirMat.color.set(t.accent); stirRing.material.color.set(t.accent);
    makeBox(); makeCells();
    if (cm && st.cmap !== lutId) { lut = cm.variant(st.cmap); lutId = st.cmap; }
  }
  function rebuild() {
    const st = kit.state;
    SC.applyParams(S, st);
    SIM.buildScene(S, SC.sceneConfig(st), SC.sceneRng(kit.seed));
    const b = S.bounds;
    stage.shadowBox(Math.max(b[3] - b[0], b[5] - b[2]) * 0.8 + 0.5, 0, 0);
    balls.castShadow = S.n < (PHONE ? 2000 : 6000);
    applyLook();
  }

  // ---- colours ----------------------------------------------------------------------
  const ORANGE = new THREE.Color(1, 0.5, 0), RED = new THREE.Color(1, 0, 0);
  const lutCol = (u, out) => { if (!lut) return out.setHSL(0.7 - 0.7 * u, 0.8, 0.55); const k = Math.max(0, Math.min(255, Math.round(u * 255))); return out.setRGB(lut[3 * k] / 255, lut[3 * k + 1] / 255, lut[3 * k + 2] / 255); };
  let vmax = 0.5;
  function paint() {
    const st = kit.state, n = Math.min(S.n, CAP), pos = S.pos, vel = S.vel, b = S.bounds, by = st.colorBy;
    let vm = 0;
    const dimAll = st.probeOn && S.probe >= 0 && S.probe < n;
    for (let i = 0; i < n; i++) {
      M.makeScale(S.radius, S.radius, S.radius); M.setPosition(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      balls.setMatrixAt(i, M);
      const sp = Math.hypot(vel[3 * i], vel[3 * i + 1], vel[3 * i + 2]); if (sp > vm) vm = sp;
      switch (by) {
        case 'collisions': C.copy(RED); if (S.hit[i] > 0.5) C.copy(ORANGE); break;
        case 'speed': lutCol(Math.min(1, sp / vmax), C); break;
        case 'bucket': { const h = SIM.bucketOf(S, i); C.setHSL((h * 0.61803) % 1, 0.75, 0.55); break; }
        case 'origin': C.copy(S.origin[i] ? orB : orA); break;
        case 'height': lutCol((pos[3 * i + 1] - b[1]) / (b[4] - b[1]), C); break;
        default: C.copy(pal[i % pal.length] || WHITE);
      }
      if (by === 'origin' && S.hit[i] > 0.6) C.lerp(WHITE, 0.25);
      if (dimAll) C.multiplyScalar(0.4);
      balls.setColorAt(i, C);
    }
    vmax = 0.9 * vmax + 0.1 * Math.max(0.05, vm * 0.8);
    // the probe: the ball white, the hash candidates in the accent, the
    // rest dimmed a little so the query reads
    const pr = st.probeOn && S.probe >= 0 && S.probe < n;
    if (pr) {
      for (let k = 0; k < S.probeN; k++) { const j = S.probeIds[k]; if (j < n) balls.setColorAt(j, acc0); }
      balls.setColorAt(S.probe, WHITE);
    }
    probeBlock.visible = pr; cellLines.visible = pr && st.cells;
    if (pr) {
      const s = 2 * S.radius, p = S.pos, i = S.probe;
      const x0 = Math.floor(p[3 * i] / s) - 1, y0 = Math.floor(p[3 * i + 1] / s) - 1, z0 = Math.floor(p[3 * i + 2] / s) - 1;
      probeBlock.scale.set(3 * s, 3 * s, 3 * s); probeBlock.position.set((x0 + 1.5) * s, (y0 + 1.5) * s, (z0 + 1.5) * s);
      cellLines.position.set(x0 * s, y0 * s, z0 * s);
    }
    balls.count = n;
    balls.instanceMatrix.needsUpdate = true; balls.instanceColor.needsUpdate = true;
    const so = S.stirrer; stirMesh.visible = so.on;
    stirMesh.position.set(so.x, so.y, so.z); stirMesh.scale.setScalar(so.r);
  }

  // ---- HUD -------------------------------------------------------------------------
  const hudEl = document.createElement('div'); hudEl.className = 'sh-hud'; document.body.appendChild(hudEl);
  let hudT = 0;
  function hud(dt) {
    hudT += dt; if (hudT < 0.4) return; hudT = 0;
    const n = S.n, all = n * (n - 1) / 2, fmt = x => Math.round(x).toLocaleString('en-US');
    hudEl.textContent = `${fmt(n)} balls · hash checks ${fmt(S.stats.pairs)} pairs, all pairs ${fmt(all)} · ${fmt(S.stats.contacts)} contacts · ${S.stats.ms.toFixed(1)} ms`;
  }

  // ---- view and pointer ----------------------------------------------------------------
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
  stage.grab({
    pick(ray) {
      const so = S.stirrer; if (!so.on) return null;
      const c = new THREE.Vector3(so.x, so.y, so.z), sph = new THREE.Sphere(c, so.r * 1.1), hit = new THREE.Vector3();
      if (!ray.ray.intersectSphere(sph, hit)) return null;
      so.held = true; return { id: 0, point: hit };
    },
    move(id, p, v) {
      const so = S.stirrer, b = S.bounds;
      const x = Math.max(b[0] + so.r, Math.min(b[3] - so.r, p.x)), y = Math.max(b[1] + so.r, Math.min(b[4] - so.r, p.y)), z = Math.max(b[2] + so.r, Math.min(b[5] - so.r, p.z));
      so.vx = v.x; so.vy = v.y; so.vz = v.z; so.x = x; so.y = y; so.z = z;
    },
    drop() { const so = S.stirrer; so.held = false; so.vx = so.vy = so.vz = 0; },
  });

  // ---- loop -------------------------------------------------------------------------
  let lastT = 0, acc = 0;
  const H = 1 / 60, hooks = { tick: null };
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
    const sub = Math.max(1, S.substeps | 0);
    if (kit.playing) {
      acc += dt * kit.speed;
      let n = 0; while (acc >= H && n < 2) { for (let k = 0; k < sub; k++) S.step(H / sub); acc -= H; n++; }
      if (n === 2) acc = 0;
    } else if (kit.takeStep()) for (let k = 0; k < sub; k++) S.step(H / sub);
    if (hooks.tick) hooks.tick(dt);
    stage.fit(viewRect());
    stage.tick(dt);
    paint();
    hud(dt);
    stage.render();
  }

  // ---- boot -------------------------------------------------------------------------------
  kit = mount({
    schema: SCHEMA, title: 'Spatial Hashing', sub: 'Thousands of colliding balls; each one checks only the cells around it', panelTitle: 'Scene',
    guard: SC.guard, themeKey: 'theme',
    footer: 'Upstream hash and ball loop by Matthias Müller (Ten Minute Physics #11, MIT). Starts, stirrer, probe, look and GUI: davesgames.io.',
    actions: {
      act(id) {
        const r = K.rng(K.newSeed()), v = S.vel;
        if (id === 'kick') for (let i = 0; i < v.length; i += 3) { v[i] += (r() - 0.5) * 0.6; v[i + 1] += 0.3 + 0.6 * r(); v[i + 2] += (r() - 0.5) * 0.6; }
        else if (id === 'heat') for (let i = 0; i < v.length; i++) v[i] *= 1.5;
        else if (id === 'cool') for (let i = 0; i < v.length; i++) v[i] *= 0.6;
        else if (id === 'probe' && S.n) S.probe = Math.floor(r() * S.n);
      },
    },
  });
  kit.on('change', (out, st, why) => {
    if (why === 'scene' || why === 'group' || why === 'saver') return;
    const keys = Object.keys(out);
    if (keys.some(k => SC.REBUILD.has(k))) rebuild();
    else { SC.applyParams(S, kit.state); if (keys.some(k => ['theme', 'light', 'floor', 'finish', 'palette', 'cmap'].includes(k))) applyLook(); }
  });
  kit.on('scene', (seed, st, out, group) => { if (!group || Object.keys(out || {}).some(k => SC.REBUILD.has(k))) rebuild(); else { SC.applyParams(S, kit.state); applyLook(); } });
  kit.on('reset', rebuild);
  loadColormaps().then(m => { if (!m) return; cm = m; lutId = null; if (kit) applyLook(); });
  if (!kit.fromHash) kit.newScene(); else rebuild();
  requestAnimationFrame(frame);
  addEventListener('pagehide', () => { kit.playing = false; });

  const P = window.__sh = { S, stage, get kit() { return kit; }, rebuild, applyLook, hooks, THREE, setBand(b) { saverBand = b; } };
  installSaver(P);
  return P;
}
