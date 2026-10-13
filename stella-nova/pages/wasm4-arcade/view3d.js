// ============================================================================
//  WASM-4 ARCADE  ·  view3d.js — the 3D room view: renderer, camera, carts
// ----------------------------------------------------------------------------
//  createRoom3D(canvas, opts) -> room. Throws when WebGL is missing, and
//  main.js then falls back to the flat tube of crt.js. opts:
//    carts          the manifest carts (one 3D cart each, rack slot = index)
//    insets()       { top, bottom, left, right } CSS px of page UI over the
//                   canvas; the camera frames the scene in the clear rect
//                   (setViewOffset), so the TV is never under the dock
//    onScreen(type, x, y, e)   pointer on the TV glass, x y in 0..159
//    onPick(id, { drag })      a cart was clicked, or dropped on the console
//    onButton(kind)            the console power or reset button
//    onHover(id | null, e)     a rack cart under the mouse (tooltip)
//    renderer       a stand-in renderer (tests only; default WebGLRenderer)
//
//  The room object has the tube interface of crt.js, so the main loop is
//  the same for both: kind 'webgl3d', setFrame(rgba, fx), render(o) with o
//  = { time, fx, stat, power }. More:
//    seatNow(id)               put a cart in the slot at once (boot, saver)
//    swapTo(id, { onSeat, drag }) -> Promise: the physical swap of
//                              swap.js; onSeat runs when the cart seats.
//                              The same id as the seated cart = a push
//                              (main.js treats it as a reset).
//    setLabel(id, canvas)      paint a cart label from its screen canvas
//    setMode('tv' | 'desk')    the camera view; a swap seen from 'tv' goes
//                              to 'desk' and comes back after the boot
//                              (room.mode = the view now, room.userMode =
//                              the view the person chose)
//    press(code, down)         move a key of the 3D keyboard
//    setDirector(fn | null)    the saver drives the camera: fn(dt) ->
//                              { pos, target } (Vector3)
//    setInsets(fn | null)      replace opts.insets (the saver plate band)
//    dispose()                 release the WebGL context and every buffer
//
//  Pointer: a drag on a rack cart carries it on a plane over the desk; a
//  drop within 16 cm of the slot calls onPick(id, { drag: true }). A drag on
//  empty space turns the view a little (yaw, pitch); the wheel zooms.
//
//  grep -n targets  "export async function createRoom3D"  "function frame("
//    "function pick("  "function swapTo("  "function updateCamera("
//    "function onDown("  "function onMove("  "function onUp("  "function dispose("
// ============================================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildRoom, frameFor, DIM } from './room.js';
import { createScreen } from './screen.js';
import { makeCart } from './carts3d.js';
import { planSwap, planReturn, planPush, sample } from './swap.js';

export async function createRoom3D(canvas, opts = {}) {
  // opts.renderer: a stand-in renderer for the node tests (no WebGL there)
  const renderer = opts.renderer || new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const R = buildRoom();
  const screen = createScreen();
  R.tv.glass.material.dispose();
  R.tv.glass.material = screen.material;
  // soft reflections for the plastic, the cans and the chrome (dimmed: a
  // room at night lit by a lamp and the TV)
  if (!opts.renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    R.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }
  const camera = new THREE.PerspectiveCamera(34, 1, 2, 2000);
  const slot = R.con.slot.clone();
  const lean = R.rack.lean;

  // ------------------------------------------------------------- carts
  const carts = new Map();
  (opts.carts || []).forEach((c, i) => {
    if (i >= R.rack.slots.length) return;
    const m = makeCart(c, i);
    m.home = R.rack.slots[i].clone();
    m.state = 'rack'; m.hover = 0;
    m.group.position.copy(m.home); m.group.rotation.x = lean;
    R.root.add(m.group);
    carts.set(c.id, m);
  });
  R.scene.traverse(o => { for (const m of [].concat(o.material || [])) if (m.isMeshStandardMaterial) m.envMapIntensity = 0.35; });
  let seated = null;
  let anim = null;          // { plan, t, onSeat, fired, resolve }
  let drag = null;          // { id, x0, y0, moved, pid }
  let look = null;          // { x0, y0, yaw0, pitch0, pid }
  let screenPtr = null;     // pointer id on the glass
  let hovered = null;

  function setPose(m, p, rx, rz = 0) {
    m.group.position.set(p[0], p[1], p[2]);
    m.group.rotation.set(rx, 0, rz);
  }
  function seatNow(id) {
    finish();
    if (seated && seated !== id) { const o = carts.get(seated); if (o) { o.state = 'rack'; setPose(o, o.home.toArray(), lean); } }
    const m = carts.get(id);
    seated = m ? id : null;
    if (m) { m.state = 'seated'; setPose(m, slot.toArray(), 0); }
  }
  // finish the running animation at once (a new swap came in)
  function finish() {
    if (!anim) return;
    const a = anim; anim = null;
    const pos = sample(a.plan, a.plan.end + 1);
    for (const [id, s] of pos) { const m = carts.get(id); if (m) setPose(m, s.p, s.rx, 0); }
    for (const id in a.plan.tracks) { const m = carts.get(id); if (m) m.state = id === seated ? 'seated' : 'rack'; }
    if (!a.fired && a.onSeat) { a.fired = true; try { a.onSeat(); } catch (e) { console.warn(e); } }
    a.resolve();
  }
  function run(plan, onSeat) {
    return new Promise(resolve => { anim = { plan, t: 0, onSeat, fired: false, resolve }; });
  }
  function swapTo(id, o = {}) {
    const m = carts.get(id);
    if (!m) { if (o.onSeat) o.onSeat(); return Promise.resolve(); }
    finish();
    if (id === seated) return run(planPush(id, slot.toArray()), o.onSeat);
    const old = seated ? carts.get(seated) : null;
    const plan = planSwap({
      incoming: id, from: m.group.position.toArray(), fromRx: m.group.rotation.x, slot: slot.toArray(),
      outgoing: old ? old.id : null, home: old ? old.home.toArray() : null, homeRx: lean, drag: !!o.drag,
    });
    if (old) old.state = 'moving';
    m.state = 'moving'; m.hover = 0;
    seated = id;
    if (mode === 'tv' && !director) { autoDesk = true; }
    return run(plan, o.onSeat).then(() => { if (autoDesk) autoBack = 0.9; });
  }

  // ------------------------------------------------------------- camera
  let mode = 'tv', autoDesk = false, autoBack = -1, director = null, insetsFn = null;
  let yaw = 0, pitch = 0, zoom = 1;
  const cur = { pos: new THREE.Vector3(0, 60, 260), target: new THREE.Vector3(0, 30, 0), init: false };
  const fitCache = new Map();
  function goalFor(m, aspect) {
    const key = m + ':' + aspect.toFixed(3);
    if (!fitCache.has(key)) { if (fitCache.size > 40) fitCache.clear(); fitCache.set(key, frameFor(m, aspect, 34)); }
    return fitCache.get(key);
  }
  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function updateCamera(dt) {
    const W = Math.max(1, canvas.clientWidth || window.innerWidth), H = Math.max(1, canvas.clientHeight || window.innerHeight);
    const ins = (insetsFn || opts.insets || (() => null))() || {};
    const L = ins.left || 0, Rr = ins.right || 0, T = ins.top || 0, B = ins.bottom || 0;
    const cw = Math.max(80, W - L - Rr), ch = Math.max(80, H - T - B), aspect = cw / ch;
    let gpos, gtarget, hard = false;
    if (director) {
      const d = director(dt, aspect);
      gpos = d.pos; gtarget = d.target; hard = !!d.cut;
    } else {
      const g = goalFor(autoDesk ? 'desk' : mode, aspect);
      tmp.copy(g.pos).sub(g.target);
      tmp.applyAxisAngle(up, yaw);
      const right = new THREE.Vector3().crossVectors(up, tmp).normalize();
      tmp.applyAxisAngle(right, -pitch).multiplyScalar(zoom);
      gpos = tmp.clone().add(g.target); gtarget = g.target;
    }
    const k = hard || !cur.init ? 1 : 1 - Math.exp(-dt * (director ? 6 : 3.6));
    cur.pos.lerp(gpos, k); cur.target.lerp(gtarget, k); cur.init = true;
    camera.position.copy(cur.pos); camera.lookAt(cur.target);
    camera.aspect = aspect;
    camera.setViewOffset(cw, ch, -L, -T, W, H);
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    if (canvas.width !== Math.round(W * pr) || canvas.height !== Math.round(H * pr)) renderer.setSize(W, H, false);
  }

  // ------------------------------------------------------------- picking
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pickables = [R.tv.glass, R.con.buttons.power, R.con.buttons.reset, ...[...carts.values()].map(m => m.group)];
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, true)[0];
    if (!hit) return null;
    return { ...hit.object.userData.pick, hit };
  }
  function glassXY(hit) {
    const uv = hit.uv;
    return [Math.max(0, Math.min(159, Math.floor(uv.x * 160))), Math.max(0, Math.min(159, Math.floor((1 - uv.y) * 160)))];
  }
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(slot.y + 12));
  function dragPoint(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(dragPlane, p) ? p : null;
  }

  function onDown(e) {
    if (e.button > 0 && e.pointerType === 'mouse' && !(e.button === 2)) return;
    const p = pick(e);
    if (p && p.type === 'screen') {
      screenPtr = e.pointerId;
      const [x, y] = glassXY(p.hit);
      if (opts.onScreen) opts.onScreen('down', x, y, e);
      try { canvas.setPointerCapture(e.pointerId); } catch (x2) { /* ok */ }
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (p && p.type === 'button') { if (opts.onButton) opts.onButton(p.kind); pushButton(p.kind); return; }
    if (p && p.type === 'cart' && !(anim && anim.plan.tracks[p.id])) {
      drag = { id: p.id, x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch (x2) { /* ok */ }
      return;
    }
    if (!director) { look = { x0: e.clientX, y0: e.clientY, yaw0: yaw, pitch0: pitch, pid: e.pointerId }; try { canvas.setPointerCapture(e.pointerId); } catch (x2) { /* ok */ } }
  }
  function onMove(e) {
    if (screenPtr === e.pointerId) {
      const p = pick(e);
      if (p && p.type === 'screen') { const [x, y] = glassXY(p.hit); if (opts.onScreen) opts.onScreen('move', x, y, e); }
      return;
    }
    if (drag && drag.pid === e.pointerId) {
      // the seated cart does not drag: a click on it is a push (reset)
      if (!drag.moved && drag.id !== seated && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) {
        drag.moved = true;
        const m = carts.get(drag.id);
        m.state = 'drag'; m.hover = 0;
        if (mode === 'tv' && !autoDesk) autoDesk = true;
      }
      if (drag.moved) {
        const q = dragPoint(e), m = carts.get(drag.id);
        if (q) { m.dragTo = q; }
      }
      return;
    }
    if (look && look.pid === e.pointerId) {
      yaw = Math.max(-0.6, Math.min(0.6, look.yaw0 - (e.clientX - look.x0) * 0.004));
      pitch = Math.max(-0.12, Math.min(0.5, look.pitch0 + (e.clientY - look.y0) * 0.003));
      return;
    }
    if (e.pointerType === 'mouse' && !e.buttons) {
      const p = pick(e);
      const id = p && p.type === 'cart' && p.id !== seated ? p.id : null;
      if (id !== hovered) { hovered = id; if (opts.onHover) opts.onHover(id, e); }
      else if (id && opts.onHover) opts.onHover(id, e);
      canvas.style.cursor = !p ? 'grab' : p.type === 'screen' ? 'crosshair' : 'pointer';
    }
  }
  function onUp(e) {
    if (screenPtr === e.pointerId) {
      screenPtr = null;
      const p = pick(e);
      const [x, y] = p && p.type === 'screen' ? glassXY(p.hit) : [-1, -1];
      if (opts.onScreen) opts.onScreen('up', x, y, e);
      return;
    }
    if (drag && drag.pid === e.pointerId) {
      const d = drag; drag = null;
      const m = carts.get(d.id);
      if (!d.moved) { if (opts.onPick) opts.onPick(d.id, { drag: false }); return; }
      const near = m.group.position.x - slot.x, nz = m.group.position.z - slot.z;
      if (Math.hypot(near, nz) < 16 && opts.onPick) opts.onPick(d.id, { drag: true });
      if (!(anim && anim.plan.tracks[d.id])) {
        // not taken by a swap: back to its rack slot
        finish();
        m.state = 'moving';
        run(planReturn(d.id, m.group.position.toArray(), m.home.toArray(), lean), null).then(() => { m.state = 'rack'; if (autoDesk) autoBack = 0.9; });
      }
      return;
    }
    if (look && look.pid === e.pointerId) look = null;
  }
  function onWheel(e) {
    if (director) return;
    e.preventDefault();
    zoom = Math.max(0.55, Math.min(1.6, zoom * Math.exp(e.deltaY * 0.0012)));
  }
  let btnT = { power: 0, reset: 0 };
  function pushButton(kind) { btnT[kind] = 0.25; }
  const ac = new AbortController(), sig = { signal: ac.signal };
  canvas.addEventListener('pointerdown', onDown, sig);
  canvas.addEventListener('pointermove', onMove, sig);
  canvas.addEventListener('pointerup', onUp, sig);
  canvas.addEventListener('pointercancel', onUp, sig);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && hovered) { hovered = null; if (opts.onHover) opts.onHover(null, e); } }, sig);
  canvas.addEventListener('wheel', onWheel, { signal: ac.signal, passive: false });
  canvas.addEventListener('dblclick', () => { yaw = 0; pitch = 0; zoom = 1; }, sig);
  canvas.addEventListener('contextmenu', e => e.preventDefault(), sig);
  let lost = false;
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; }, sig);

  // ------------------------------------------------------------- frame
  let last = 0, powerOn = true;
  function frame(o = {}) {
    if (lost) return;
    const now = performance.now(), dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016); last = now;
    // animation
    if (anim) {
      anim.t += dt;
      const pos = sample(anim.plan, anim.t);
      for (const [id, s] of pos) { const m = carts.get(id); if (m && m.state !== 'drag') setPose(m, s.p, s.rx, s.rz); }
      if (!anim.fired && anim.plan.seatAt >= 0 && anim.t >= anim.plan.seatAt) { anim.fired = true; if (anim.onSeat) { try { anim.onSeat(); } catch (e) { console.warn(e); } } }
      if (anim.t >= anim.plan.end) finish();
    }
    if (autoBack >= 0) { autoBack -= dt; if (autoBack < 0 && !anim && !drag) autoDesk = false; }
    // hover lift and drag follow
    for (const m of carts.values()) {
      if (m.state === 'rack') {
        const goal = m.id === hovered ? 1 : 0;
        m.hover += (goal - m.hover) * (1 - Math.exp(-dt * 14));
        m.group.position.set(m.home.x, m.home.y + 1.6 * m.hover, m.home.z + 1.2 * m.hover);
        m.group.rotation.set(lean * (1 - m.hover), 0, 0);
      } else if (m.state === 'drag' && m.dragTo) {
        const p = m.group.position, k = 1 - Math.exp(-dt * 18), vx = m.dragTo.x - p.x;
        p.lerp(m.dragTo, k);
        m.group.rotation.set(0.15, 0, Math.max(-0.4, Math.min(0.4, -vx * 0.04)));
      }
    }
    // buttons spring back
    for (const kd of ['power', 'reset']) {
      btnT[kd] = Math.max(0, btnT[kd] - dt);
      R.con.buttons[kd].position.z = DIM.console.d / 2 + 0.3 - 0.5 * Math.sin(Math.min(1, btnT[kd] / 0.25) * Math.PI);
    }
    R.props.keyboard.update(dt);
    // screen and lights
    const pw = o.power == null ? 1 : o.power;
    const u = screen.uniforms;
    u.time.value = o.time || 0; u.fx.value = o.fx == null ? 1 : o.fx; u.stat.value = o.stat || 0; u.power.value = pw;
    const gl = screen.glow, lum = 0.3 * gl[0] + 0.59 * gl[1] + 0.11 * gl[2];
    const st = o.stat || 0;
    R.lights.glow.color.setRGB(gl[0] * (1 - st) + 0.6 * st, gl[1] * (1 - st) + 0.6 * st, gl[2] * (1 - st) + 0.6 * st, THREE.SRGBColorSpace);
    R.lights.glow.intensity = pw * (1.1 + 4.4 * Math.max(lum, 0.5 * st));
    R.tv.led.material.emissiveIntensity = powerOn ? 1.6 : 0.05;
    R.con.led.material.emissiveIntensity = powerOn && seated ? 2 : 0.05;
    updateCamera(dt);
    renderer.render(R.scene, camera);
  }

  function dispose() {
    ac.abort();
    finish();
    R.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) { for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose(); }
    });
    if (R.scene.environment) R.scene.environment.dispose();
    screen.dispose();
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (e) { /* ok */ }
  }

  return {
    kind: 'webgl3d', canvas, camera, scene: R.scene, parts: R, carts,
    setFrame(rgba, fx) { screen.setFrame(rgba, fx); },
    render: frame,
    seatNow, swapTo,
    get seated() { return seated; },
    get busy() { return !!anim || !!drag; },
    get mode() { return autoDesk ? 'desk' : mode; },
    get userMode() { return mode; },
    setMode(m) { mode = m === 'desk' ? 'desk' : 'tv'; autoDesk = false; autoBack = -1; yaw = 0; pitch = 0; zoom = 1; },
    setLabel(id, cv) { const m = carts.get(id); if (m) m.paint(cv); },
    press(code, down) { R.props.keyboard.press(code, down); },
    setPower(on) { powerOn = !!on; },
    setDirector(fn) { director = fn; if (!fn) cur.init = true; },
    setInsets(fn) { insetsFn = fn; },
    slot, lean,
    layout() { return { x: 0, y: 0, w: 1, h: 1 }; },
    dispose, destroy: dispose,
  };
}
