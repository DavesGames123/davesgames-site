// ============================================================================
//  BREADBOARD LAB  ·  view/test/control-tests.mjs — in-scene controls
// ----------------------------------------------------------------------------
//  Called by view/tests.mjs. The real PARTS models in createView (stub
//  renderer, a fake canvas of 1000 x 640 px), driven by synthetic pointer
//  events. Checks: every control mesh has a rim and a pick footprint of at
//  least CONTROL.minMm, the hovered control gets the bright rim and a
//  cursor, the rims follow the tool, a touch near a small cap presses it.
//
//  GREP MAP
//    makeView ........ real parts, fake canvas, store, bus
//    controlDoc ...... one of each interactive part on an 830 board
//    run ............. the checks
// ============================================================================
import { createBus } from '../../core/bus.js';
import { createStore } from '../../core/store.js';
import { colX, rowZ } from '../../core/space.js';
import { stubRenderer } from './stubs.mjs';

const THREE_URL = new URL('../../../../vendor/three@0.160.0/build/three.module.js', import.meta.url).href;
const W = 1000, H = 640;

function controlDoc(parts) {
  return { format: 'breadboard-lab', version: 1, title: '', notes: '', boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }], parts, wires: [], probes: [], materials: [], customParts: [], programs: {}, sim: { speed: 1, pwm: 'auto' }, nextId: parts.length + 1 };
}

export async function run({ section, check }) {
  section('controls');
  const THREE = await import(THREE_URL);
  const SC = await import('../scene.js');
  const { CONTROL } = await import('../interact.js');
  const P = await import('../../parts/index.js');
  const reg = P.createRegistry();
  const real = await SC.loadParts();
  const canvas = { style: {}, clientWidth: W, clientHeight: H, getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H }) };
  async function makeView(doc) {
    const bus = createBus();
    const store = createStore(doc, bus, { registry: reg });
    const v = SC.createView({ canvas, store, registry: reg, bus, THREE, quality: 'high', renderer: stubRenderer(), parts: real, materials: real.materials, raf: null, now: () => 0 });
    await v.ready;
    return { v, store, bus };
  }
  const frame = v => {
    const box = new THREE.Box3().setFromObject(v.scene.getObjectByName('parts'));
    v.rig.setAspect(W / H);
    v.rig.animateTo(v.rig.fitPose({ min: box.min.toArray(), max: box.max.toArray() }, { pitch: 1.1, yaw: 0, margin: 1.1 }), 0);
    v.rig.apply(v.camera);
    v.camera.updateMatrixWorld(true);
  };
  const toScreen = (v, w) => { const p = w.clone().project(v.camera); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H }; };
  let pid = 900;
  const ev = (x, y, type = 'mouse') => ({ pointerId: pid, clientX: x, clientY: y, pointerType: type, button: 0, shiftKey: false });
  const tap = (v, x, y, type) => { pid++; v.gestures.down(ev(x, y, type)); v.gestures.up(ev(x, y, type)); };

  // 1. every interactive part: rim + footprint
  const interactive = reg.list().filter(d => d.interact);
  const parts = [];
  let i = 0;
  for (const d of interactive) {
    const free = d.mount === 'free' || d.category === 'mcu';
    parts.push({ id: 'p' + (i + 1), def: d.id, place: free ? { on: null, x: -150 + (i % 4) * 90, z: -120 - Math.floor(i / 4) * 80, rot: 0 } : { on: 'b1', x: colX(63, 3 + (i % 7) * 8), z: rowZ(i % 2 ? 7 : 2), rot: 0 }, params: {} });
    i++;
  }
  const { v, store, bus } = await makeView(controlDoc(parts));
  const rows = [], panelOnly = [];
  for (const p of store.doc.parts) {
    const cs = v.controlsOf(p.id);
    if (!cs.length) { panelOnly.push(p.def); continue; }
    for (const c of cs) {
      const box = new THREE.Box3();
      c.mesh.updateWorldMatrix(true, false);
      box.copy(c.mesh.geometry.boundingBox).applyMatrix4(c.mesh.matrixWorld);
      const raw = box.getSize(new THREE.Vector3());
      if (c.proxy) { c.proxy.updateWorldMatrix(true, false); box.union(new THREE.Box3().setFromBufferAttribute(c.proxy.geometry.attributes.position).applyMatrix4(c.proxy.matrixWorld)); }
      const s = box.getSize(new THREE.Vector3());
      const rimOk = c.rim && c.rim.parent === c.mesh && c.rim.layers.mask === (1 << 2) && c.rim.material.side === THREE.BackSide && c.rim.visible;
      rows.push({ def: p.def, x: s.x, z: s.z, raw: Math.min(raw.x, raw.z), rimOk, pickable: !c.proxy || v.scene.getObjectById(c.proxy.id) });
    }
  }
  const small = rows.filter(r => Math.min(r.x, r.z) < CONTROL.minMm - 1e-6);
  check('every control mesh has a pick footprint of at least CONTROL.minMm (x and z)', rows.length >= 10 && small.length === 0,
    `${rows.length} controls; smallest mesh ${rows.reduce((m, r) => Math.min(m, r.raw), 1e9).toFixed(1)} mm, smallest pick footprint ${rows.reduce((m, r) => Math.min(m, r.x, r.z), 1e9).toFixed(1)} mm` + (small.length ? `; small: ${small.map(r => r.def).join(' ')}` : ''));
  check('every control mesh has a rim (inverted shell, FX layer, shown in the select tool)', rows.every(r => r.rimOk), rows.filter(r => !r.rimOk).map(r => r.def).join(' ') || `${rows.length} rims`);
  check('the parts with an interact def and no 3D control are the five panel-only sensors and sources', JSON.stringify(panelOnly.sort()) === JSON.stringify(['ldr', 'solar-panel', 'temp-analog', 'thermistor', 'usb-breakout']), panelOnly.join(' ') + ' (inspector controls)');

  // 2. hover: bright rim, cursor, control in the hover event
  frame(v);
  const btn = store.doc.parts.find(p => p.def === 'button-6mm');
  const cap = v.controlsOf(btn.id)[0];
  const capW = cap.center.clone(); cap.mesh.localToWorld(capW);
  const sc = toScreen(v, capW);
  const hovers = [];
  bus.on('hover', e => hovers.push(e));
  v.gestures.move(ev(sc.x, sc.y));
  const hot = v.controlHover === cap.mesh && cap.rim.material.color.getHex() === CONTROL.rimHot && cap.rim.material.opacity === 1;
  const lastHover = hovers[hovers.length - 1];
  check('hover on a button cap: the bright rim, a pointer cursor and the control in the hover event', hot && canvas.style.cursor === 'pointer' && lastHover && lastHover.control && lastHover.control.kind === 'press',
    `rim #${cap.rim.material.color.getHexString()} a ${cap.rim.material.opacity}, cursor ${canvas.style.cursor}, control ${lastHover && JSON.stringify(lastHover.control)}`);
  const pot = store.doc.parts.find(p => p.def === 'pot');
  const knob = v.controlsOf(pot.id)[0];
  const kw = knob.center.clone(); knob.mesh.localToWorld(kw);
  const ks = toScreen(v, kw);
  v.gestures.move(ev(ks.x, ks.y));
  check('hover on a knob: the cursor says drag (ew-resize)', v.controlHover === knob.mesh && canvas.style.cursor === 'ew-resize', canvas.style.cursor);
  v.gestures.move(ev(4, 4));
  check('the pointer off the controls: no bright rim', v.controlHover === null && cap.rim.material.color.getHex() === CONTROL.rim, `hover ${v.controlHover}`);
  v.setTool('wire');
  const hiddenInWire = rows.length && v.controlsOf(btn.id).every(c => !c.rim.visible);
  v.setTool('select');
  check('the rims hide in the wire tool and come back in the select tool', hiddenInWire && v.controlsOf(btn.id).every(c => c.rim.visible), '');
  v.setControlRims(false);
  const saverHidden = v.controlsOf(btn.id).every(c => !c.rim.visible);
  v.gestures.move(ev(sc.x, sc.y));
  const saverNoHot = v.controlHover === null;
  v.setControlRims(true);
  check('the saver hides the rims and the hover rim (setControlRims), and gives them back', saverHidden && saverNoHot && v.controlsOf(btn.id).every(c => c.rim.visible), '');
  v.dispose();

  // 3. touch slop on a 3.6 mm cap, and the pick box of a 1.6 mm lever
  {
    const { v: v2, store: s2, bus: b2 } = await makeView(controlDoc([
      { id: 'p1', def: 'button-6mm', place: { on: 'b1', x: colX(63, 20), z: rowZ(2), rot: 0 }, params: {} },
      { id: 'p2', def: 'switch-slide', place: { on: 'b1', x: colX(63, 40), z: rowZ(7), rot: 0 }, params: {} },
    ]));
    frame(v2);
    // zoom out so the cap is small on screen (a phone view)
    v2.rig.animateTo({ ...v2.rig.state, target: v2.rig.state.target.slice(), dist: 420 }, 0);
    v2.rig.apply(v2.camera); v2.camera.updateMatrixWorld(true);
    const c = v2.controlsOf('p1')[0];
    const w = c.center.clone(); c.mesh.localToWorld(w);
    const s = toScreen(v2, w);
    const edge = new THREE.Vector3(1.8, 0, 0).add(w);
    const capPx = Math.abs(toScreen(v2, edge).x - s.x) * 2;
    const events = [];
    b2.on('interact', e => events.push(e));
    tap(v2, s.x + 20, s.y, 'mouse');
    const mouseNear = events.filter(e => e.part === 'p1' && e.value === true).length;
    tap(v2, s.x + 20, s.y, 'touch');
    const touchNear = events.filter(e => e.part === 'p1' && e.value === true).length - mouseNear;
    tap(v2, s.x + 40, s.y, 'touch');
    const touchFar = events.filter(e => e.part === 'p1' && e.value === true).length - mouseNear - touchNear;
    check('a touch 20 px from a small cap presses it; a mouse click there and a touch 40 px away do not', touchNear === 1 && mouseNear === 0 && touchFar === 0,
      `cap ${capPx.toFixed(1)} px wide on screen; mouse ${mouseNear}, touch@20 ${touchNear}, touch@40 ${touchFar} (touch target ${2 * CONTROL.touchSlopPx} px)`);
    const lv = v2.controlsOf('p2')[0];
    const lw = lv.center.clone(); lv.mesh.localToWorld(lw);
    const off = new THREE.Vector3(2.4, 0, 0).add(lw);
    const ls = toScreen(v2, off);
    const pos0 = s2.find('p2').params.pos;
    tap(v2, ls.x, ls.y, 'mouse');
    const pos1 = s2.find('p2').params.pos;
    check('a click 2.4 mm beside the 1.6 mm slide lever hits its pick box and switches it', lv.proxy && pos1 !== undefined && pos1 !== pos0, `pos ${pos0} -> ${pos1}`);
    v2.dispose();
  }
}
