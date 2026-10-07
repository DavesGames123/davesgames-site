// ============================================================================
//  IMAGE WORLDS  ·  controls.js — orbit, fly and walk cameras
// ────────────────────────────────────────────────────────────────────────────
//  MODES
//    orbit  OrbitControls round a target 3 m in front of the camera (drag
//           turns, right-drag or two fingers pan, wheel or pinch zooms).
//    fly    free flight: WASD or arrows move, Q/E go down/up, Shift is x3.
//           Drag looks. The wheel moves along the view. Speed 3 m/s.
//    walk   as fly, but the eye stays 1.6 m over the ground: groundAt()
//           (the collider mesh or the ground plane) gives the height.
//           Gravity 9.81, Space jumps (3 m/s, upstream JUMP_VELOCITY).
//           A move into collider geometry under 0.3 m away is blocked.
//  TOUCH  (fly, walk) the joystick element moves; a drag elsewhere looks.
//  TAP    a press and release under 6 px and 350 ms calls onTap(x, y) in
//         canvas CSS px, in every mode (it picks an object).
//
//  EXPORTS  createControls({ THREE, OrbitControls, camera, dom, joy,
//           groundAt, blockAt, onTap, onUser }) -> { mode, setMode(m),
//           update(dt), resetTo(pos, yaw, pitch), lookAt(target), orbit,
//           enabled, dispose() }
// ============================================================================
export const EYE = 1.6;
const SPEED = 3, FAST = 3, LOOK = 0.0042, JUMP = 3, G = 9.81;

export function createControls({ THREE, OrbitControls, camera, dom, joy, groundAt, blockAt, onTap, onUser }) {
  const orbit = new OrbitControls(camera, dom);
  orbit.enableDamping = true; orbit.dampingFactor = 0.08; orbit.screenSpacePanning = true;
  orbit.minDistance = 0.3; orbit.maxDistance = 40;
  const st = { mode: 'orbit', yaw: 0, pitch: 0, vy: 0, keys: new Set(), joy: { x: 0, y: 0 }, enabled: true };
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');

  const fromCamera = () => { eul.setFromQuaternion(camera.quaternion, 'YXZ'); st.yaw = eul.y; st.pitch = eul.x; };
  const applyLook = () => { eul.set(st.pitch, st.yaw, 0, 'YXZ'); camera.quaternion.setFromEuler(eul); };

  function setMode(m) {
    if (m === st.mode) return;
    if (m === 'orbit') {
      camera.getWorldDirection(fwd);
      orbit.target.copy(camera.position).addScaledVector(fwd, 3);
      orbit.enabled = st.enabled; orbit.update();
    } else { orbit.enabled = false; fromCamera(); st.vy = 0; }
    st.mode = m;
    if (joy) joy.hidden = m === 'orbit';
  }

  // ── pointer: look drags, taps ────────────────────────────────────────────
  const downs = new Map(); let lookId = null, lx = 0, ly = 0;
  const onDown = e => {
    if (!st.enabled) return;
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
    if (st.mode !== 'orbit' && lookId === null && e.button === 0) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; try { dom.setPointerCapture(e.pointerId); } catch (_) {} }
    if (onUser) onUser();
  };
  const onMove = e => {
    const d = downs.get(e.pointerId);
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
    if (e.pointerId !== lookId) return;
    st.yaw -= (e.clientX - lx) * LOOK; st.pitch -= (e.clientY - ly) * LOOK;
    st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch));
    lx = e.clientX; ly = e.clientY;
  };
  const onUp = e => {
    const d = downs.get(e.pointerId); downs.delete(e.pointerId);
    if (e.pointerId === lookId) lookId = null;
    if (d && !d.moved && performance.now() - d.t < 350 && downs.size === 0 && onTap) {
      const r = dom.getBoundingClientRect(); onTap(e.clientX - r.left, e.clientY - r.top);
    }
  };
  const onWheel = e => {
    if (st.mode === 'orbit' || !st.enabled) return;
    e.preventDefault();
    camera.getWorldDirection(fwd);
    if (st.mode === 'walk') { fwd.y = 0; fwd.normalize(); }
    camera.position.addScaledVector(fwd, -e.deltaY * 0.004);
  };
  dom.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  dom.addEventListener('wheel', onWheel, { passive: false });

  // ── keys ─────────────────────────────────────────────────────────────────
  const typing = e => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
  const onKey = e => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.code;
    if (e.type === 'keydown') {
      if (/^(KeyW|KeyA|KeyS|KeyD|KeyQ|KeyE|Space|ShiftLeft|ShiftRight|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(k) && st.mode !== 'orbit') e.preventDefault();
      if (k === 'Space' && st.mode === 'walk' && st.grounded) st.vy = JUMP;
      st.keys.add(k); if (onUser) onUser();
    } else st.keys.delete(k);
  };
  addEventListener('keydown', onKey); addEventListener('keyup', onKey);
  const onBlur = () => st.keys.clear();
  addEventListener('blur', onBlur);

  // ── touch joystick ───────────────────────────────────────────────────────
  let joyId = null;
  const knob = joy && joy.querySelector('i');
  const joyMove = e => {
    if (e.pointerId !== joyId) return;
    const r = joy.getBoundingClientRect(), R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    st.joy.x = x; st.joy.y = y;
    if (knob) knob.style.transform = `translate(${x * R * 0.55}px,${y * R * 0.55}px)`;
  };
  const joyEnd = e => { if (e.pointerId !== joyId) return; joyId = null; st.joy.x = st.joy.y = 0; if (knob) knob.style.transform = ''; };
  if (joy) {
    joy.addEventListener('pointerdown', e => { e.stopPropagation(); joyId = e.pointerId; try { joy.setPointerCapture(e.pointerId); } catch (_) {} joyMove(e); if (onUser) onUser(); });
    joy.addEventListener('pointermove', joyMove);
    joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
  }

  function update(dt) {
    dt = Math.min(dt, 0.05);
    if (st.mode === 'orbit') { orbit.update(); return; }
    applyLook();
    const K = st.keys, k = c => K.has(c) ? 1 : 0;
    let f = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - st.joy.y;
    let s = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + st.joy.x;
    let u = st.mode === 'fly' ? k('KeyE') - k('KeyQ') : 0;
    const sp = SPEED * (K.has('ShiftLeft') || K.has('ShiftRight') ? FAST : 1);
    camera.getWorldDirection(fwd);
    if (st.mode === 'walk') { fwd.y = 0; fwd.normalize(); }
    right.crossVectors(fwd, up).normalize();
    mv.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, s).addScaledVector(up, u);
    if (mv.lengthSq() > 1) mv.normalize();
    mv.multiplyScalar(sp * dt);
    if (st.mode === 'walk') {
      if (mv.lengthSq() > 0 && blockAt && blockAt(camera.position, mv)) mv.set(0, 0, 0);
      camera.position.add(mv);
      const g = groundAt(camera.position.x, camera.position.y, camera.position.z);
      st.vy -= G * dt;
      camera.position.y += st.vy * dt;
      if (camera.position.y <= g + EYE) { camera.position.y = g + EYE; st.vy = 0; st.grounded = true; }
      else st.grounded = camera.position.y - (g + EYE) < 0.05;
    } else camera.position.add(mv);
  }

  return {
    get mode() { return st.mode; },
    setMode, update, orbit,
    get enabled() { return st.enabled; },
    set enabled(v) { st.enabled = !!v; orbit.enabled = st.enabled && st.mode === 'orbit'; if (!v) { st.keys.clear(); lookId = null; } },
    resetTo(pos, yaw, pitch) {
      camera.position.copy(pos); st.yaw = yaw; st.pitch = pitch; st.vy = 0; applyLook();
      camera.getWorldDirection(fwd);
      orbit.target.copy(pos).addScaledVector(fwd, 3); if (st.mode === 'orbit') orbit.update();
    },
    lookAt(target) { camera.lookAt(target); fromCamera(); orbit.target.copy(target); },
    moving: () => st.keys.size > 0 || st.joy.x !== 0 || st.joy.y !== 0 || lookId !== null,
    dispose() {
      orbit.dispose();
      dom.removeEventListener('pointerdown', onDown); removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
      dom.removeEventListener('wheel', onWheel); removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); removeEventListener('blur', onBlur);
    },
  };
}
