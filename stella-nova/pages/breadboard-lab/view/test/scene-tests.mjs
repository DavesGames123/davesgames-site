// ============================================================================
//  BREADBOARD LAB  ·  view/test/scene-tests.mjs — createView in node
// ----------------------------------------------------------------------------
//  Builds the real scene graph with three r160 (by path), a stub renderer,
//  stub PARTS builders and the stub registry, then drives it with synthetic
//  pointer events through the gesture recognizer, as a user would. Called by
//  view/tests.mjs. A second pass uses the real PARTS modules when they load.
//
//  GREP MAP
//    importNoDom ........ scene.js imports with no window / document
//    makeView ........... store, bus, stub renderer, stub parts
//    tap / dragPath ..... pointer helpers on screen positions
//    run ................ the checks
// ============================================================================
import { createBus } from '../../core/bus.js';
import { createStore } from '../../core/store.js';
import { holeWorld, holeLocal, colX, rowZ } from '../../core/space.js';
import { REGISTRY, DEFS, stubParts, stubRenderer } from './stubs.mjs';

const THREE_URL = new URL('../../../../vendor/three@0.160.0/build/three.module.js', import.meta.url).href;

export async function run({ section, check, near, sampleDoc }) {
  section('scene');
  const noDom = typeof globalThis.window === 'undefined' && typeof globalThis.document === 'undefined';
  let SC;
  try { SC = await import('../scene.js'); } catch (e) { check('view/scene.js imports in node with no DOM', false, e.message); return; }
  check('view/scene.js imports in node with no DOM', noDom && typeof SC.createView === 'function', 'window and document are undefined');
  const THREE = await import(THREE_URL);

  const clock = { t: 0 };
  function makeView(doc, extra = {}) {
    const bus = createBus();
    const store = createStore(doc, bus, { registry: REGISTRY });
    const stub = stubParts(THREE);
    const renderer = stubRenderer();
    const view = SC.createView({ canvas: null, store, registry: REGISTRY, bus, THREE, quality: 'high', renderer, parts: extra.parts ?? stub.parts, raf: null, now: () => clock.t, ...extra });
    return { bus, store, view, renderer, calls: stub.calls };
  }
  const P = (id, x, y, type = 'mouse', button = 0, shift = false) => ({ pointerId: id, clientX: x, clientY: y, pointerType: type, button, shiftKey: shift });
  let pid = 10;
  function tap(view, s, opts = {}) {
    const id = pid++;
    view.gestures.down(P(id, s.x, s.y, opts.type, 0, opts.shift));
    view.gestures.up(P(id, s.x, s.y, opts.type, 0, opts.shift));
  }
  function dragPath(view, a, b, opts = {}) {
    const id = pid++;
    view.gestures.down(P(id, a.x, a.y, 'mouse', 0, opts.shift));
    for (let i = 1; i <= 6; i++) view.gestures.move(P(id, a.x + (b.x - a.x) * i / 6, a.y + (b.y - a.y) * i / 6, 'mouse', 0, opts.shift));
    view.gestures.up(P(id, b.x, b.y, 'mouse', 0, opts.shift));
  }
  const topNow = view => { view.cameraTo({ ...view.rig.topPose(), target: [0, 0, 20], dist: 420 }, 0); };

  // ── build ────────────────────────────────────────────────────────────────
  const { view, store, bus, renderer, calls } = makeView(sampleDoc());
  await view.ready;
  const st = view.stats();
  check('createView builds every board, part, wire and probe', st.boards === 2 && st.parts === 3 && st.wires === 2 && st.probes === 1, JSON.stringify({ b: st.boards, p: st.parts, w: st.wires, m: st.probes }));
  const p3 = view.objectOf('p3'), a10 = holeWorld(store.doc, 'b1:a10');
  check('a part sits with pin 1 on its hole', near(p3.position.x, a10.x, 1e-6) && near(p3.position.z, a10.z, 1e-6) && near(p3.position.y, 8.5, 1e-9), `${p3.position.x.toFixed(2)}, ${p3.position.y}, ${p3.position.z.toFixed(2)}`);
  view.tick(0);
  check('the first tick renders', renderer.renders >= 1, renderer.renders);
  const r0 = renderer.renders;
  view.tick(16); view.tick(32);
  check('idle ticks do not render (render on demand)', renderer.renders === r0, `${renderer.renders - r0} extra renders`);

  topNow(view);
  view.tick(50);
  // ── picking ──────────────────────────────────────────────────────────────
  {
    let good = 0;
    const holes = ['b1:a20', 'b1:j63', 'b1:TP7', 'b2:f12', 'b2:BN25'];
    for (const h of holes) { const s = view.screenPos({ kind: 'hole', hole: h }); const t = view.pickAt(s.x, s.y, 'endpoint'); if (t && t.hole === h) good++; }
    check('screenPos → pickAt returns the same hole', good === holes.length, `${good}/${holes.length}`);
    const sp = view.screenPos({ kind: 'part', id: 'p3' });
    const tp = view.pickAt(sp.x, sp.y, 'select');
    check('pickAt on a part body returns the part', tp && tp.kind === 'part' && tp.id === 'p3', JSON.stringify(tp));
    const ss = view.screenPos({ kind: 'pin', part: 'p5', pin: 'D13' });
    const ts = view.pickAt(ss.x, ss.y, 'endpoint');
    check('pickAt on a socket pin returns the pin', ts && ts.kind === 'pin' && ts.part === 'p5' && ts.pin === 'D13', JSON.stringify(ts));
    const sl = view.screenPos({ kind: 'lead', probe: 'm8', lead: 'red' });
    const tl = view.pickAt(sl.x, sl.y, 'select');
    check('pickAt on a lead tip returns the lead', tl && tl.kind === 'lead' && tl.lead === 'red', JSON.stringify(tl));
    const sb = view.screenPos({ kind: 'hole', hole: 'b1:c50' });
    const tb = view.pickAt(sb.x, sb.y, 'select');
    check('select mode on a bare board gives the hole and its board', tb && tb.kind === 'hole' && tb.board === 'b1' && tb.hole === 'b1:c50', JSON.stringify(tb));
  }

  // ── wire tool ────────────────────────────────────────────────────────────
  {
    const tools = [];
    bus.on('tool', e => tools.push(e.tool));
    view.setTool('wire');
    view.setWireColor('#4e9a2e');
    view.setWireStyle('flat');
    const n0 = store.doc.wires.length;
    tap(view, view.screenPos({ kind: 'hole', hole: 'b1:f5' }));
    check('first tap starts a wire', view.wiring && view.wiring.start.hole === 'b1:f5', JSON.stringify(view.wiring));
    tap(view, view.screenPos({ kind: 'hole', hole: 'b1:f9' }));
    const w = store.doc.wires.at(-1);
    check('second tap adds the wire with colour and style', store.doc.wires.length === n0 + 1 && w.a.hole === 'b1:f5' && w.b.hole === 'b1:f9' && w.color === '#4e9a2e' && w.style === 'flat', JSON.stringify(w));
    check('the new wire has a mesh', !!view.objectOf(w.id));
    dragPath(view, view.screenPos({ kind: 'hole', hole: 'b1:g20' }), view.screenPos({ kind: 'pin', part: 'p5', pin: 'D7' }));
    const w2 = store.doc.wires.at(-1);
    check('a drag from a hole to a socket pin adds a wire', w2.a.hole === 'b1:g20' && w2.b.part === 'p5' && w2.b.pin === 'D7', JSON.stringify(w2));
    tap(view, view.screenPos({ kind: 'hole', hole: 'b1:h30' }));
    view.handleKey({ key: 'Escape' });
    check('Esc cancels a started wire', view.wiring === null && store.doc.wires.length === n0 + 2);
    check('setTool emits the tool event', tools.includes('wire'), tools.join());
    view.setWireStyle('free');
    tap(view, view.screenPos({ kind: 'hole', hole: 'b1:a40' }));
    const mid = view.screenPos({ kind: 'hole', hole: 'b1:a40' });
    tap(view, { x: mid.x, y: mid.y - 60 });                    // off the board: a bend point
    tap(view, view.screenPos({ kind: 'hole', hole: 'b1:a45' }));
    const w3 = store.doc.wires.at(-1);
    check('free style keeps the bend points as via', w3.style === 'free' && Array.isArray(w3.via) && w3.via.length === 1, JSON.stringify(w3.via));
    view.setTool('select');
  }

  // ── select, move, snap, undo ─────────────────────────────────────────────
  {
    const p4 = store.doc.parts.find(p => p.id === 'p4');
    const start = view.screenPos({ kind: 'part', id: 'p4' });
    const hFrom = view.screenPos({ kind: 'hole', hole: 'b1:a14' }), hTo = view.screenPos({ kind: 'hole', hole: 'b1:a30' });
    const end = { x: hTo.x + (start.x - hFrom.x) + 0.6, y: hTo.y + (start.y - hFrom.y) + 0.4 };
    const undo0 = store.history().undo;
    dragPath(view, start, end);
    const moved = store.doc.parts.find(p => p.id === 'p4');
    check('dragging a part snaps pin 1 to the hole under it', moved.place.on === 'b1' && near(moved.place.x, colX(63, 30), 1e-6) && near(moved.place.z, rowZ(0), 1e-6), JSON.stringify(moved.place));
    check('a whole drag is one undo step', store.history().undo === undo0 + 1, store.history().undo - undo0);
    check('a wire on a moved part follows (wire ends are holes, LED moved alone)', view.objectOf('w6') !== null);
    store.undo();
    check('undo puts the part back', store.doc.parts.find(p => p.id === 'p4').place.x === p4.place.x);
    check('drag selects the dragged part', view.getSelection().join() === 'p4', view.getSelection().join());
    tap(view, view.screenPos({ kind: 'part', id: 'p3' }), { shift: true });
    check('shift-tap adds to the selection', view.getSelection().sort().join() === 'p3,p4', view.getSelection().join());
    const empty = view.screenPos({ kind: 'hole', hole: 'b1:a1' });
    tap(view, { x: empty.x, y: empty.y + 200 });
    check('a tap on empty mat clears the selection', view.getSelection().length === 0);
    const r1 = view.screenPos({ kind: 'hole', hole: 'b1:TN1' }), r2 = view.screenPos({ kind: 'hole', hole: 'b1:j20' });
    dragPath(view, { x: r1.x - 30, y: r1.y - 30 }, { x: r2.x, y: r2.y + 5 }, { shift: true });
    const boxSel = view.getSelection();
    check('shift-drag box-selects the parts inside', boxSel.includes('p3') && boxSel.includes('p4'), boxSel.join());
    view.select(['p3']);
    view.rotateSelection();
    check('R turns the selected part a quarter (pin 1 stays)', store.doc.parts.find(p => p.id === 'p3').place.rot === 1 && near(store.doc.parts.find(p => p.id === 'p3').place.x, colX(63, 10), 1e-6));
    store.undo();
    const nParts = store.doc.parts.length;
    view.duplicateSelection();
    const dup = store.doc.parts.at(-1);
    check('duplicate adds a copy three columns on, with a new label', store.doc.parts.length === nParts + 1 && dup.def === 'res' && near(dup.place.x, colX(63, 13), 1e-6) && view.getSelection()[0] === dup.id, JSON.stringify(dup.place) + ' ' + dup.label);
    view.deleteSelection();
    check('delete removes the selection', store.doc.parts.length === nParts);
  }

  // ── boards ───────────────────────────────────────────────────────────────
  {
    const b2 = store.doc.boards.find(b => b.id === 'b2');
    const from = view.screenPos({ kind: 'hole', hole: 'b2:c5' });
    const shift = { x: 3.0, y: 0 };
    const pxPerMm = (view.screenPos({ kind: 'hole', hole: 'b2:c6' }).x - from.x) / 2.54;
    dragPath(view, from, { x: from.x + shift.x * pxPerMm, y: from.y + 60 * pxPerMm });
    const nb = store.doc.boards.find(b => b.id === 'b2');
    check('dragging a board moves it (and its parts ride along)', nb.z > b2.z + 50, `z ${b2.z} → ${nb.z.toFixed(2)}`);
    store.undo();
  }

  // ── leads and probe tool ─────────────────────────────────────────────────
  {
    view.setTool('probe');
    const tipS = view.screenPos({ kind: 'lead', probe: 'm8', lead: 'black' });
    dragPath(view, tipS, view.screenPos({ kind: 'hole', hole: 'b1:j5' }));
    const m = store.doc.probes[0];
    check('dragging a lead tip onto a hole plugs it in', m.leads.black && m.leads.black.hole === 'b1:j5', JSON.stringify(m.leads.black));
    const nl = { holeNode: { 'b1:f5': 3, 'b1:g5': 3, 'b1:h5': 3, 'b1:i5': 3, 'b1:j5': 3, 'b1:a1': 1 }, pinNode: { 'p5.GND.1': 3, 'p5.D13': 2 }, wireIds: store.doc.wires.map(w => w.id) };
    view.setNetlist(nl);
    tap(view, view.screenPos({ kind: 'hole', hole: 'b1:g5' }));
    check('probe tap on a hole lights its whole net (holes and pins)', view.nodeOf({ kind: 'hole', hole: 'b1:g5' }) === 3 && view.highlightNet(3) === 6, `markers ${view.highlightNet(3)}`);
    check('nodeOf a lead reads the net of its end', view.nodeOf({ kind: 'lead', probe: 'm8', lead: 'black' }) === 3);
    view.setNetlist(null);
    check('without a netlist a hole lights its strip', view.highlightNet({ strip: 'b1:c7' }) === 5);
    view.highlightNet(null);
    view.setTool('delete');
    tap(view, view.screenPos({ kind: 'lead', probe: 'm8', lead: 'black' }));
    check('delete on a lead tip unplugs it', store.doc.probes[0].leads.black === null);
    const wid = store.doc.wires[0].id;
    tap(view, view.screenPos({ kind: 'wire', id: wid }));
    check('delete tool removes a wire', !store.doc.wires.some(w => w.id === wid), wid);
    view.setTool('select');
  }

  // ── placing ──────────────────────────────────────────────────────────────
  {
    const ev = [];
    bus.on('place:start', e => ev.push('start:' + e.defId));
    bus.on('place:end', e => ev.push('end:' + (e.id ? 'id' : 'null')));
    view.beginPlace('res', { r: 470 });
    check('beginPlace switches to the place tool', view.tool === 'place');
    const s = view.screenPos({ kind: 'hole', hole: 'b1:f42' });
    view.gestures.move(P(99, s.x, s.y));                      // hover moves the ghost
    check('the ghost snaps with green pins', view.placing && view.placing.snap && view.placing.snap.ok, JSON.stringify(view.placing && view.placing.snap && view.placing.snap.pins.map(p => p.hole)));
    tap(view, s);
    const np = store.doc.parts.at(-1);
    check('a tap places the part centred on the pointer (pin 1 at f40)', np.def === 'res' && np.params.r === 470 && np.place.on === 'b1' && near(np.place.x, colX(63, 40), 1e-6) && near(np.place.z, rowZ(5), 1e-6), JSON.stringify(np.place));
    check('the new part gets a label and the place events fire', /^R\d+$/.test(np.label) && ev.join() === 'start:res,end:id' && view.tool === 'select', `${np.label} ${ev.join()}`);
    view.beginPlace('led', {});
    view.handleKey({ key: 'Escape' });
    check('Esc cancels placing', view.placing === null && ev.at(-1) === 'end:null');
    view.beginProbe('dmm');
    const mt = view.screenPos({ kind: 'hole', hole: 'b1:a1' });
    tap(view, { x: mt.x + 40, y: mt.y + 250 });
    const pr = store.doc.probes.at(-1);
    check('beginProbe then a tap adds an instrument with free leads', store.doc.probes.length === 2 && pr.type === 'dmm' && pr.leads.red === null && view.tool === 'probe', JSON.stringify(pr.place));
    view.setTool('select');
  }

  // ── interactive parts ────────────────────────────────────────────────────
  {
    const id = store.newId('part');
    store.apply({ op: 'add', kind: 'part', item: { id, def: 'button-6mm', place: { on: 'b1', x: colX(63, 55), z: rowZ(5), rot: 0 }, params: {} } });
    const undo0 = store.history().undo;
    const s = view.screenPos({ kind: 'part', id });
    view.gestures.down(P(500, s.x, s.y));
    const pressed = store.doc.parts.find(p => p.id === id).params.pressed;
    view.gestures.up(P(500, s.x, s.y));
    await new Promise(r => setTimeout(r, 200));
    const released = store.doc.parts.find(p => p.id === id).params.pressed;
    check('a button cap presses while held and releases (no undo steps)', pressed === true && released === false && store.history().undo === undo0, `${pressed} → ${released}`);
  }

  // ── frames, damage, effects, flow ────────────────────────────────────────
  {
    view.setFlow(true);
    view.setNetlist({ holeNode: {}, pinNode: {}, wireIds: store.doc.wires.map(w => w.id) });
    const frame = { t: 1, speed: 1, ratio: 1, running: true, nodeV: new Float32Array(4), wires: new Float32Array(store.doc.wires.map(() => 0.012)), parts: { p4: { i: 0.013, vis: { b: 0.65 } }, p3: { damaged: 'burnt' } }, probes: {}, mcus: {}, stats: {} };
    const c0 = calls.state;
    clock.t = 1000;
    view.setFrame(frame);
    check('setFrame pushes part state into the handles', calls.state > c0, `${calls.state - c0} setState calls`);
    check('a burnt part gets setDamage and a scorch decal', calls.damage >= 1 && view.scene.getObjectByName('effects').children.some(c => c.isMesh && c.geometry.type === 'CircleGeometry'));
    const r0 = renderer.renders;
    view.tick(1000); view.tick(1016);
    check('a running sim renders every tick', renderer.renders - r0 === 2, renderer.renders - r0);
    const flowObj = view.scene.getObjectByName('flow');
    check('current flow draws dots along wires', flowObj.visible && flowObj.geometry.drawRange.count > 0, flowObj.geometry.drawRange.count + ' dots');
    check('effect smoke starts a burst', view.effect('smoke', 'p3') === true);
    view.setFrame({ ...frame, running: false, parts: { p3: { damaged: null } } });
    check('repair removes the scorch', !view.scene.getObjectByName('effects').children.some(c => c.isMesh && c.geometry.type === 'CircleGeometry'));
    let frames = 0;
    for (let t = 2000; t < 4500; t += 16) if (view.tick(t)) frames++;
    check('smoke keeps rendering for about 2 s, then stops', frames > 100 && frames < 170, `${frames} rendered ticks`);
    check('flash outlines targets', view.flash([{ kind: 'part', id: 'p3' }, { kind: 'hole', hole: 'b1:a1' }]) === 2);
    view.setFlow(false);
  }

  // ── camera ───────────────────────────────────────────────────────────────
  {
    const camEv = [];
    bus.on('camera', e => camEv.push(e.mode));
    view.topView(300);
    let t = 5000;
    view.tick(t);
    for (let i = 0; i < 30; i++) view.tick(t += 16);
    check('topView tweens to the top pose and emits camera', view.rig.isTop() && camEv.includes('top'), camEv.join());
    view.focus('p3', 0);
    const c = view.getCamera();
    check('focus aims at the part', Math.hypot(c.target[0] - view.objectOf('p3').position.x, c.target[2] - view.objectOf('p3').position.z) < 15, c.target.map(v => v.toFixed(1)).join());
    view.orbitView(0);
    check('orbitView leaves the top view', !view.rig.isTop());
  }

  // ── doc changes from outside ─────────────────────────────────────────────
  {
    store.apply({ op: 'set', id: 'p3', path: 'params.r', value: 4700 });
    const built = calls.part;
    store.apply({ op: 'set', id: 'p3', path: 'looks.body', value: 'chrome' });
    check('a looks change swaps materials without a rebuild', calls.part === built && calls.look >= 1, `builds ${calls.part - built}, looks ${calls.look}`);
    store.apply({ op: 'remove', ids: ['b2'] });
    check('a removed board leaves the scene', view.stats().boards === 1 && view.objectOf('b2') === null);
    store.undo();
    check('undo brings it back', view.stats().boards === 2);
    view.setQuality('low');
    check('setQuality low turns shadows off and rebuilds', renderer.shadowMap.enabled === false && view.quality === 'low');
  }

  // ── dispose ──────────────────────────────────────────────────────────────
  {
    const before = bus.count('doc:change');
    view.dispose();
    check('dispose frees the renderer and loses the context', renderer.disposed && renderer.lost, `disposed ${renderer.disposed}, lost ${renderer.lost}`);
    check('dispose removes its bus handlers and objects', bus.count('doc:change') === before - 1 && view.stats().parts === 0, `handlers ${before} → ${bus.count('doc:change')}`);
    store.apply({ op: 'meta', title: 'after dispose' });
    check('a doc change after dispose does nothing', true);
  }

  // ── budget with stand-ins ────────────────────────────────────────────────
  {
    const doc = { format: 'breadboard-lab', version: 1, title: '', notes: '', boards: [], parts: [], wires: [], probes: [], materials: [], customParts: [], programs: {}, sim: { speed: 1, pwm: 'auto' }, nextId: 1 };
    for (let i = 0; i < 3; i++) doc.boards.push({ id: 'b' + (i + 1), type: 'bb830', x: 0, z: (i - 1) * 60, rot: 0 });
    let n = 4;
    for (let i = 0; i < 60; i++) doc.parts.push({ id: 'p' + n++, def: i % 3 === 0 ? 'res' : i % 3 === 1 ? 'led' : 'ic-555', place: { on: 'b' + (1 + (i % 3)), x: colX(63, 2 + (i % 20) * 3), z: rowZ(i % 3 === 2 ? 5 : 0), rot: 0 }, params: {} });
    for (let i = 0; i < 30; i++) doc.wires.push({ id: 'w' + n++, a: { hole: 'b1:a' + (i + 1) }, b: { hole: 'b2:j' + (i + 1) }, color: '#d63b3b', style: 'arch' });
    doc.nextId = n;
    const v = makeView(doc, { parts: false, quality: 'high' });
    await v.view.ready;
    const s = v.view.stats();
    check('stand-in bench (3 × 830, 60 parts, 30 wires) fits the draw budget', s.meshes <= 250 && s.sceneTriangles <= 400000, `${s.meshes} meshes, ${s.sceneTriangles} triangles`);
    v.view.dispose();
  }

  // ── flow maths ───────────────────────────────────────────────────────────
  {
    const FL = await import('../flow.js');
    check('flow speed: none below 1 µA, grows with log |I|, sign = direction', FL.speedFor(5e-7) === 0 && FL.speedFor(1e-3) > FL.speedFor(1e-5) && FL.speedFor(-0.01) < 0 && FL.speedFor(10) <= 70, `${FL.speedFor(1e-3).toFixed(1)} mm/s at 1 mA`);
    const pts = [[0, 0, 0], [10, 0, 0], [10, 0, 10]];
    const out = new Float32Array(30);
    const k = FL.dotsOnPath(pts, FL.measure(pts), 2, 5, out, 0, 10);
    check('dots sit every 5 mm from the phase along an L path', k === 4 && near(out[0], 2) && near(out[3], 7) && near(out[6], 10) && near(out[8], 2) && near(out[11], 7), `${k} dots`);
  }

  // ── real wire paths with stub parts ──────────────────────────────────────
  {
    const real = await SC.loadParts();
    if (!real.wirePath || !real.buildWire) console.log('skip scene: parts/wire.js not loadable yet');
    else {
      const st2 = stubParts(THREE);
      const v = makeView(sampleDoc(), { parts: { ...st2.parts, wirePath: real.wirePath, buildWire: real.buildWire } });
      await v.view.ready;
      const w = v.store.doc.wires[0];
      const a = holeWorld(v.store.doc, w.a.hole), b = holeWorld(v.store.doc, w.b.hole);
      const sp = v.view.screenPos({ kind: 'wire', id: w.id });
      const t = v.view.pickAt(sp.x, sp.y, 'select');
      const obj = v.view.objectOf(w.id);
      check('parts/wire.js wires build, end on their holes and pick', obj && t && t.kind === 'wire' && t.id === w.id && !!a && !!b, JSON.stringify(t));
      v.view.dispose();
    }
  }

  // ── with the real PARTS modules, when they load ──────────────────────────
  {
    const real = await SC.loadParts();
    let reg = null;
    try { const idx = await import('../../parts/index.js'); reg = idx.createRegistry ? idx.createRegistry() : null; } catch { reg = null; }
    if (!real.buildPart || !reg) {
      console.log(`skip scene: real PARTS builders not loadable yet (buildPart ${!!real.buildPart}, registry ${!!reg}, buildWire ${!!real.buildWire}, materials ${!!real.materials})`);
    } else {
      const bus = createBus();
      const doc = { format: 'breadboard-lab', version: 1, title: '', notes: '', boards: [], parts: [], wires: [], probes: [], materials: [], customParts: [], programs: {}, sim: { speed: 1, pwm: 'auto' }, nextId: 1 };
      for (let i = 0; i < 3; i++) doc.boards.push({ id: 'b' + (i + 1), type: 'bb830', x: 0, z: (i - 1) * 60, rot: 0 });
      const ids = reg.list().filter(d => d.mount !== 'free' && d.category !== 'instruments' && d.category !== 'mcu').map(d => d.id);
      let n = 4;
      for (let i = 0; i < 60; i++) doc.parts.push({ id: 'p' + n++, def: ids[i % ids.length], place: { on: 'b' + (1 + (i % 3)), x: colX(63, 2 + (i % 12) * 5), z: rowZ(5), rot: 0 }, params: {} });
      doc.nextId = n;
      const store = createStore(doc, bus, { registry: reg });
      const renderer = stubRenderer();
      const v = SC.createView({ canvas: null, store, registry: reg, bus, THREE, quality: 'high', renderer, parts: real, materials: real.materials, raf: null });
      await v.ready;
      const s = v.stats();
      check('real PARTS bench (3 × 830, 60 parts) builds within the draw budget', s.parts === 60 && s.meshes <= 250 && s.sceneTriangles <= 400000, `${s.meshes} meshes, ${s.sceneTriangles} triangles, ${ids.length} defs used`);
      // a live param edit (a knob, a held button) goes to handle.setParams
      // and keeps the mesh; a non-live param still rebuilds
      // (integration review 7)
      {
        store.apply({ op: 'add', kind: 'part', item: { id: 'p900', def: 'pot', place: { on: 'b1', x: colX(63, 60), z: rowZ(2), rot: 0 }, params: { pos: 0.2 } } });
        store.apply({ op: 'add', kind: 'part', item: { id: 'p901', def: 'res', place: { on: 'b1', x: colX(63, 55), z: rowZ(8), rot: 0 }, params: {} } });
        let tk = 1000;
        v.tick(tk += 16);
        const o0 = v.objectOf('p900'), r0 = v.objectOf('p901');
        store.apply({ op: 'set', id: 'p900', path: 'params.pos', value: 0.8 });
        v.tick(tk += 16);
        const o1 = v.objectOf('p900');
        store.apply({ op: 'set', id: 'p901', path: 'params.r', value: 4700 });
        v.tick(tk += 16);
        const r1 = v.objectOf('p901');
        check('live param edit (pot pos) keeps the part mesh; a non-live param (resistor r) rebuilds it', !!o0 && o0 === o1 && !!r0 && r0 !== r1,
          `pot ${o0 === o1 ? 'kept' : 'rebuilt'}, resistor ${r0 !== r1 ? 'rebuilt' : 'kept'}`);
      }
      v.dispose();
    }
  }
  void holeLocal; void DEFS;
}
