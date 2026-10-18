// ============================================================================
//  BREADBOARD LAB  ·  view/tests.mjs — SCENE role tests (node only)
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/breadboard-lab/view/tests.mjs
//  One line per check with the measured value. Exit code 1 on any failure.
//  No browser: the scene tests build the real three r160 scene graph in
//  node with a stub renderer (see test/stubs.mjs).
//
//  GREP MAP
//    section('bus') ........... order, off, once, a throwing handler
//    section('space') ......... CONTRACT 3.2 hole positions, strips, frames
//    section('space vs parts')  core/space.js against parts/geometry.js
//    section('applyOp') ....... 500 random sequences, inverse property, purity
//    section('topology') ...... the flags of CONTRACT 4.1
//    section('store') ......... merge window, undo / redo, newId
//    section('normalize') ..... broken input → warnings and a valid document
//    section('snap') .......... pin-1 snap, red pins, boards
//    section('picking') ....... a ray through a known hole returns it
//    section('camera') ........ pose round trip, zoom anchor, tweens
//    section('gestures') ...... tap, drag, long press, pinch, context
//    section('scene') ......... view/scene.js in node with injected THREE
//    section('controls') ...... rims, pick boxes, hover, touch slop (test/control-tests)
//    section('light budget') .. luminance of the materials (test/light-tests)
//    section('glow') .......... bloom layers, LED levels, 30-LED frame estimate
// ============================================================================
import { createBus } from '../core/bus.js';
import * as SP from '../core/space.js';
import { emptyDoc, normalizeDoc, starterDoc, validateDoc } from '../core/doc.js';
import { applyOp, createStore } from '../core/store.js';
import { snapPart, snapBoard, occupiedHoles } from './snap.js';
import { pickBench, projectPoint, rayFromCamera, pickPoints } from './picking.js';
import { createCameraRig, PITCH_TOP } from './camera.js';
import { createGestures } from './touch.js';
import { REGISTRY, DEFS } from './test/stubs.mjs';

let fails = 0, passes = 0, current = '';
function section(name) { current = name; console.log(`\n── ${name}`); }
function check(name, ok, measured = '') {
  if (ok) passes++; else fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${current}: ${name}${measured !== '' ? '  [' + measured + ']' : ''}`);
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual(a[k], b[k]));
}
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
// Seeded random (mulberry32), so a failing sequence is reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── bus ────────────────────────────────────────────────────────────────────
section('bus');
{
  const bus = createBus();
  const got = [];
  const offA = bus.on('x', v => got.push('a' + v));
  bus.on('x', v => got.push('b' + v));
  bus.once('x', v => got.push('o' + v));
  bus.emit('x', 1);
  offA();
  bus.emit('x', 2);
  check('delivers in order, once fires once, off works', got.join(',') === 'a1,b1,o1,b2', got.join(','));
  const bus2 = createBus();
  const seen = [];
  const errLog = console.error; console.error = () => {};
  bus2.on('y', () => { throw new Error('boom'); });
  bus2.on('y', v => seen.push(v));
  bus2.emit('y', 7);
  console.error = errLog;
  check('a throwing handler does not stop the next one', seen[0] === 7, seen.join(','));
  const bus3 = createBus();
  const order = [];
  let offLate;
  bus3.on('z', () => { order.push(1); offLate(); });
  offLate = bus3.on('z', () => order.push(2));
  bus3.emit('z');
  check('a handler removed during emit does not run', order.join(',') === '1', order.join(','));
  check('emit returns the handler count; count() reads it', bus.emit('none') === 0 && bus.count('x') === 1, bus.count('x'));
}

// ── space ──────────────────────────────────────────────────────────────────
section('space');
{
  const h = (t, l) => SP.holeLocal(t, l);
  const want = [['a1', -78.74, -13.97], ['e1', -78.74, -3.81], ['f1', -78.74, 3.81], ['j63', 78.74, 13.97], ['TP1', -73.66, -20.32], ['BN50', 73.66, 22.86]];
  for (const [l, x, z] of want) {
    const p = h('bb830', l);
    check(`bb830 ${l} at (${x}, ${z})`, near(p.x, x, 1e-3) && near(p.z, z, 1e-3), `${p.x}, ${p.z}`);
  }
  check('hole counts 830 / 400 / 170', SP.holeList('bb830').length === 830 && SP.holeList('bb400').length === 400 && SP.holeList('bb170').length === 170,
    [SP.holeList('bb830').length, SP.holeList('bb400').length, SP.holeList('bb170').length].join(' / '));
  const s = SP.strips('bb830');
  check('a-e is one strip, f-j another', s['12T'].join() === 'a12,b12,c12,d12,e12' && s['12B'].join() === 'f12,g12,h12,i12,j12', s['12T'].join());
  check('a full rail is one strip of 50', s.TP.length === 50 && !s['TP.1'], s.TP.length);
  const ss = SP.strips('bb830', { splitRails: true });
  check('split rails split at 25', ss['TP.1'].length === 25 && ss['TP.2'].length === 25 && SP.stripOf('bb830', 'TP26', { splitRails: true }) === 'TP.2', ss['TP.1'].length);
  check('bb170 has no rails', SP.parseLocal('bb170', 'TP1') === null && SP.parseLocal('bb170', 'a17') !== null && SP.parseLocal('bb170', 'a18') === null);
  check('rot 1 maps (x, z) to (-z, x)', SP.rotXZ(1, 2, 1).join() === '-2,1', SP.rotXZ(1, 2, 1).join());
  const b = { id: 'b1', type: 'bb830', x: 40, z: -12, rot: 3 };
  const w = SP.boardToWorld(b, 10, 5), back = SP.worldToBoard(b, w.x, w.z);
  check('board frame round trip at rot 3', near(back.x, 10) && near(back.z, 5), `${back.x}, ${back.z}`);
  const doc = { boards: [b, { id: 'b2', type: 'bb400', x: 0, z: 80, rot: 1 }] };
  let worst = 0, wrong = 0;
  for (const bd of doc.boards) for (const l of SP.holeList(bd.type)) {
    const p = SP.holeWorld(doc, bd.id + ':' + l);
    const got = SP.nearestHoleInfo(doc, p.x + 0.4, p.z - 0.3, 1.27);
    if (!got || got.hole !== bd.id + ':' + l) wrong++;
    else worst = Math.max(worst, got.d);
  }
  check('nearestHole finds every hole of two rotated boards from 0.5 mm off', wrong === 0, `wrong ${wrong}, d ${worst.toFixed(3)}`);
  check('evalExpr reads $span-1 and precedence', SP.evalExpr('$span-1', { span: 4 }) === 3 && SP.evalExpr('2+3*$n/2', { n: 4 }) === 8 && SP.evalExpr('-(1+1)') === -2);
  const res = DEFS.res;
  const pins = SP.partPinsWorld(doc, { id: 'p1', def: 'res', place: { on: 'b1', x: SP.colX(63, 10), z: SP.rowZ(0), rot: 0 }, params: { span: 5 } }, res);
  const h2 = SP.nearestHole(doc, pins[1].x, pins[1].z, 0.6);
  check('resistor span 5 from b1:a10 lands pin 2 on b1:a15', h2 === 'b1:a15', h2);
}

// ── space against parts/geometry.js (when PARTS has delivered it) ──────────
section('space vs parts');
{
  let PG = null;
  try { PG = await import('../parts/geometry.js'); } catch (e) { console.log('skip space vs parts: parts/geometry.js does not load: ' + e.message); }
  if (PG) {
    const doc = { boards: [{ id: 'b1', type: 'bb830', x: 12, z: -7, rot: 1 }, { id: 'b2', type: 'bb400', x: 140, z: 30, rot: 2 }, { id: 'b3', type: 'bb170', x: -150, z: 60, rot: 3 }] };
    let bad = 0, n = 0;
    for (const b of doc.boards) for (const l of SP.holeList(b.type)) {
      const a = SP.holeWorld(doc, b.id + ':' + l), c = PG.holeWorld(doc, b.id + ':' + l);
      n++;
      if (!c || !near(a.x, c.x, 1e-6) || !near(a.z, c.z, 1e-6)) bad++;
    }
    check('every hole of three rotated boards matches parts/geometry.js', bad === 0, `${n - bad}/${n}`);
    const R = rng(7);
    let diff = 0;
    for (let i = 0; i < 4000; i++) {
      const x = R() * 400 - 200, z = R() * 200 - 60;
      const a = SP.nearestHole(doc, x, z, 1.27), c = PG.nearestHole(doc, x, z, 1.27);
      if (a !== c) { const pa = a && SP.holeWorld(doc, a), pc = c && SP.holeWorld(doc, c); if (!(pa && pc && near(Math.hypot(pa.x - x, pa.z - z), Math.hypot(pc.x - x, pc.z - z), 1e-6))) diff++; }
    }
    check('nearestHole agrees at 4000 random points', diff === 0, `${diff} differ`);
    let pinBad = 0;
    for (const def of Object.values(DEFS)) for (let rot = 0; rot < 4; rot++) {
      const part = { id: 'p1', def: def.id, place: { on: def.mount === 'free' ? null : 'b1', x: SP.colX(63, 20), z: SP.rowZ(5), rot }, params: { span: 6 } };
      const a = SP.partPinsWorld(doc, part, def), c = PG.partPinsWorld(doc, part, def);
      a.forEach((p, i) => { if (!near(p.x, c[i].x, 1e-6) || !near(p.z, c[i].z, 1e-6)) pinBad++; });
    }
    check('partPinsWorld agrees for every stub def at four turns', pinBad === 0, `${pinBad} pins differ`);
  }
}

// ── applyOp: inverse property ──────────────────────────────────────────────
function sampleDoc() {
  const d = starterDoc();
  d.boards.push({ id: 'b2', type: 'bb400', x: 0, z: 70, rot: 0 });
  d.parts.push({ id: 'p3', def: 'res', place: { on: 'b1', x: SP.colX(63, 10), z: SP.rowZ(0), rot: 0 }, params: { r: 220 } });
  d.parts.push({ id: 'p4', def: 'led', place: { on: 'b1', x: SP.colX(63, 14), z: SP.rowZ(0), rot: 0 }, params: { color: 'red' } });
  d.parts.push({ id: 'p5', def: 'mcu-uno', place: { on: null, x: -120, z: 60, rot: 0 }, params: {} });
  d.wires.push({ id: 'w6', a: { hole: 'b1:TP1' }, b: { hole: 'b1:b10' }, color: '#d63b3b', style: 'arch' });
  d.wires.push({ id: 'w7', a: { part: 'p5', pin: 'D13' }, b: { hole: 'b1:c14' }, color: '#2f80d6', style: 'free', via: [[0, 20, 0]] });
  d.probes.push({ id: 'm8', type: 'dmm', place: { x: 120, z: 60, rot: 0 }, leads: { red: { hole: 'b1:d15' }, black: { part: 'p5', pin: 'GND.1' } }, settings: { mode: 'V', range: 'auto' } });
  d.materials.push({ id: 'mat-9', name: 'Pink', color: '#ff88aa', roughness: 0.4, metalness: 0 });
  d.programs.p5 = { lang: 'sketch', source: 'void setup(){}\nvoid loop(){}' };
  d.nextId = 10;
  return d;
}

function randomOp(doc, R, depth = 0) {
  const pick = arr => arr[Math.floor(R() * arr.length)];
  const all = [...doc.boards, ...doc.parts, ...doc.wires, ...doc.probes, ...doc.materials, ...doc.customParts];
  const holeOf = () => { const b = pick(doc.boards); return b ? b.id + ':' + pick(SP.holeList(b.type)) : null; };
  const endOf = () => {
    const parts = doc.parts.filter(p => DEFS[p.def]);
    if (parts.length && R() < 0.3) { const p = pick(parts); return { part: p.id, pin: pick(DEFS[p.def].pins).name }; }
    const h = holeOf(); return h ? { hole: h } : null;
  };
  const nid = p => p + (doc.nextId + Math.floor(R() * 3));
  const r = R();
  if (r < 0.10 && depth === 0) {
    const ops = []; let d = doc;
    for (let i = 0; i < 2 + Math.floor(R() * 3); i++) { const o = randomOp(d, R, 1); if (!o) continue; try { d = applyOp(d, o).doc; ops.push(o); } catch { /* skip */ } }
    return { op: 'batch', ops };
  }
  if (r < 0.18) return { op: 'add', kind: 'board', item: { id: nid('b'), type: pick(['bb830', 'bb400', 'bb170']), x: Math.round(R() * 300 - 150), z: Math.round(R() * 200 - 100), rot: Math.floor(R() * 4) } };
  if (r < 0.32) {
    const def = pick(['res', 'led', 'button-6mm', 'mcu-uno']);
    const b = pick(doc.boards);
    return { op: 'add', kind: 'part', index: R() < 0.3 ? 0 : undefined, item: { id: nid('p'), def, place: b && R() < 0.7 ? { on: b.id, x: SP.colX(30, 1 + Math.floor(R() * 20)), z: SP.rowZ(Math.floor(R() * 10)), rot: Math.floor(R() * 4) } : { on: null, x: R() * 100, z: R() * 100, rot: 0 }, params: def === 'res' ? { r: 1000 } : {} } };
  }
  if (r < 0.44) {
    const a = endOf(), b = endOf();
    if (!a || !b) return null;
    return { op: 'add', kind: 'wire', item: { id: nid('w'), a, b, color: pick(['#d63b3b', '#2b2b2b']), style: pick(['arch', 'flat', 'free']) } };
  }
  if (r < 0.48) return { op: 'add', kind: 'probe', item: { id: nid('m'), type: 'scope', place: { x: 1, z: 2, rot: 0 }, leads: { ch1: endOf(), ch2: null, ch3: null, ch4: null, gnd: null }, settings: { tdiv: 0.001 } } };
  if (r < 0.51) return { op: 'add', kind: 'material', item: { id: 'mat-' + Math.floor(R() * 1e6), name: 'M', color: '#123456', roughness: 0.5, metalness: 1 } };
  if (r < 0.53) return { op: 'add', kind: 'customPart', item: { id: 'cp-' + Math.floor(R() * 1e6), name: 'C', pins: [{ name: '1', x: 0, z: 0 }] } };
  if (r < 0.65) { if (!all.length) return null; const ids = [pick(all).id]; if (R() < 0.3) ids.push(pick(all).id); return { op: 'remove', ids }; }
  if (r < 0.75) {
    const movable = [...doc.boards, ...doc.parts, ...doc.probes];
    if (!movable.length) return null;
    const it = pick(movable);
    if (it.type && SP.BOARD_TYPES[it.type]) return { op: 'move', id: it.id, place: { x: Math.round(R() * 100), z: Math.round(R() * 100), rot: Math.floor(R() * 4) } };
    if (doc.parts.includes(it)) { const b = pick(doc.boards); return { op: 'move', id: it.id, place: R() < 0.5 && b ? { on: b.id, x: 2.54, z: 3.81 } : { on: null, x: R() * 50, z: 5 } }; }
    return { op: 'move', id: it.id, place: { x: R() * 9, z: R() * 9 } };
  }
  if (r < 0.92) {
    if (!all.length) return null;
    const it = pick(all);
    const paths = it.def ? ['params.r', 'params.color', 'looks.body', 'looks.legs', 'label']
      : it.a ? ['color', 'style', 'via', 'via.0', 'gauge', 'a', 'b']
      : it.leads ? ['settings.mode', 'settings.trig.level', 'leads.red', 'leads.ch2', 'settings.vdiv.1']
      : it.type ? ['params.splitRails', 'looks.body', 'rot']
      : ['name', 'roughness', 'pins.0.x'];
    const path = pick(paths);
    const vals = { 'params.r': () => Math.round(R() * 1e4), color: () => '#00ff00', style: () => 'flat', via: () => [[1, 2, 3]], 'via.0': () => [4, 5, 6], a: endOf, b: endOf, 'leads.red': endOf, 'leads.ch2': endOf };
    const value = R() < 0.12 ? undefined : (vals[path] ? vals[path]() : Math.round(R() * 10));
    return { op: 'set', id: it.id, path, value };
  }
  if (r < 0.96) { const p = pick(doc.parts); return p ? { op: 'program', id: p.id, program: R() < 0.3 ? null : { lang: 'sketch', source: 'void loop(){}' + R() } } : null; }
  return { op: 'meta', title: 'T' + Math.floor(R() * 99), sim: R() < 0.5 ? { speed: 0.1 } : undefined, notes: R() < 0.5 ? 'n' : undefined };
}

section('applyOp');
{
  const original = deepFreeze(sampleDoc());
  let okRuns = 0, totalOps = 0, firstBad = '';
  let pure = true;
  for (let run = 0; run < 500; run++) {
    const R = rng(1000 + run);
    let doc = original;
    const inverses = [];
    const len = 1 + Math.floor(R() * 14);
    for (let k = 0; k < len; k++) {
      const op = randomOp(doc, R);
      if (!op) continue;
      let r;
      try { r = applyOp(doc, op, { registry: REGISTRY }); }
      catch (e) { if (/exists|no item|no part|has no place|id cannot/.test(e.message)) continue; pure = false; firstBad = firstBad || `run ${run}: ${e.message}`; break; }
      deepFreeze(r.doc);
      inverses.push(r.inverse);
      doc = r.doc;
      totalOps++;
    }
    let back = doc;
    for (const inv of inverses.slice().reverse()) back = applyOp(back, inv).doc;
    if (deepEqual(back, original)) okRuns++;
    else if (!firstBad) firstBad = `run ${run}: ${JSON.stringify(back).length} vs ${JSON.stringify(original).length}`;
  }
  check('500 random sequences undo to a deep-equal document', okRuns === 500, `${okRuns}/500, ${totalOps} ops ${firstBad}`);
  check('applyOp never mutates its input (frozen documents)', pure, firstBad || 'no write to a frozen object');
  // Cascade
  const r = applyOp(original, { op: 'remove', ids: ['p5'] });
  check('removing a part removes its wires, its program and nulls its leads',
    !r.doc.wires.some(w => w.id === 'w7') && !r.doc.programs.p5 && r.doc.probes[0].leads.black === null && r.topology,
    `wires ${r.doc.wires.map(w => w.id)}`);
  const rb = applyOp(original, { op: 'remove', ids: ['b1'] });
  check('removing a board removes its parts and wires on its holes', rb.doc.parts.length === 1 && rb.doc.wires.length === 0 && rb.doc.probes[0].leads.red === null, `parts ${rb.doc.parts.map(p => p.id)}`);
  check('the inverse of that board removal restores the document', deepEqual(applyOp(rb.doc, rb.inverse).doc, original));
  const ra = applyOp(original, { op: 'add', kind: 'part', item: { id: 'p12', def: 'led', place: { on: null, x: 0, z: 0, rot: 0 }, params: {} } });
  check('add bumps nextId past the new id; its inverse restores it', ra.doc.nextId === 13 && applyOp(ra.doc, ra.inverse).doc.nextId === 10, `${ra.doc.nextId}`);
  const rs = applyOp(original, { op: 'set', id: 'p3', path: 'looks.body', value: 'mat-9' });
  check('set into a missing container undoes without leaving it behind', !('looks' in applyOp(rs.doc, rs.inverse).doc.parts[0]));
  check('untouched items are shared by reference', rs.doc.wires === original.wires && rs.doc.parts[1] === original.parts[1]);
}

// ── topology ───────────────────────────────────────────────────────────────
section('topology');
{
  const d = deepFreeze(sampleDoc());
  const T = op => applyOp(d, op, { registry: REGISTRY }).topology;
  const rows = [
    ['add part', { op: 'add', kind: 'part', item: { id: 'p20', def: 'led', place: { on: null, x: 0, z: 0, rot: 0 }, params: {} } }, true],
    ['add material', { op: 'add', kind: 'material', item: { id: 'mat-x', name: 'x', color: '#000000', roughness: 1, metalness: 0 } }, false],
    ['remove wire', { op: 'remove', ids: ['w6'] }, true],
    ['move part on board', { op: 'move', id: 'p3', place: { x: 0 } }, true],
    ['move free part with a wire', { op: 'move', id: 'p5', place: { x: 0 } }, true],
    ['move board', { op: 'move', id: 'b2', place: { x: 10 } }, true],
    ['move probe', { op: 'move', id: 'm8', place: { x: 10 } }, false],
    ['set params.r (electrical)', { op: 'set', id: 'p3', path: 'params.r', value: 330 }, false],
    ['set params.span (geometric)', { op: 'set', id: 'p3', path: 'params.span', value: 6 }, true],
    ['set looks.body', { op: 'set', id: 'p3', path: 'looks.body', value: 'chrome' }, false],
    ['set wire color', { op: 'set', id: 'w6', path: 'color', value: '#2b2b2b' }, false],
    ['set wire end', { op: 'set', id: 'w6', path: 'b', value: { hole: 'b1:b11' } }, true],
    ['set wire via', { op: 'set', id: 'w7', path: 'via', value: [] }, false],
    ['set probe lead', { op: 'set', id: 'm8', path: 'leads.red', value: null }, true],
    ['set dmm mode', { op: 'set', id: 'm8', path: 'settings.mode', value: 'A' }, true],
    ['set dmm range', { op: 'set', id: 'm8', path: 'settings.range', value: 20 }, false],
    ['set board splitRails', { op: 'set', id: 'b1', path: 'params.splitRails', value: true }, true],
    ['program', { op: 'program', id: 'p5', program: null }, false],
    ['meta', { op: 'meta', title: 'x' }, false],
    ['batch with one topology op', { op: 'batch', ops: [{ op: 'meta', title: 'y' }, { op: 'remove', ids: ['w6'] }] }, true],
  ];
  for (const [name, op, want] of rows) { const got = T(op); check(`${name} → ${want}`, got === want, got); }
  const free = deepFreeze({ ...d, wires: [], probes: [] });
  check('move free part with no wires → false', applyOp(free, { op: 'move', id: 'p5', place: { x: 3 } }).topology === false);
}

// ── store ──────────────────────────────────────────────────────────────────
section('store');
{
  let clock = 0;
  const bus = createBus();
  const events = [];
  bus.on('doc:change', e => events.push(e));
  const st = createStore(sampleDoc(), bus, { now: () => clock, registry: REGISTRY });
  const start = st.doc;
  for (let i = 0; i < 20; i++) { clock += 25; st.apply({ op: 'set', id: 'p3', path: 'params.r', value: 220 + i * 10 }, { merge: 'scrub-r' }); }
  check('20 scrub ops with one merge key → one undo step', st.history().undo === 1, `undo steps ${st.history().undo}`);
  st.undo();
  check('that undo restores the value before the scrub', st.doc.parts[0].params.r === 220 && deepEqual(st.doc, start), st.doc.parts[0].params.r);
  st.redo();
  check('redo reapplies the last scrub value', st.doc.parts[0].params.r === 410, st.doc.parts[0].params.r);
  clock += 700;
  st.apply({ op: 'set', id: 'p3', path: 'params.r', value: 1000 }, { merge: 'scrub-r' });
  check('after 700 ms the same key starts a new step', st.history().undo === 2, st.history().undo);
  check('doc:change carries source and topology', events.at(-1).source === 'user' && events.at(-1).topology === false && events.some(e => e.source === 'undo') && events.some(e => e.source === 'redo'));
  const a = st.newId('part'), b = st.newId('part'), c = st.newId('wire');
  check('newId gives distinct ids before the adds land', a !== b && b !== c && /^p\d+$/.test(a) && /^w\d+$/.test(c), `${a} ${b} ${c}`);
  st.apply({ op: 'add', kind: 'part', item: { id: a, def: 'led', place: { on: null, x: 0, z: 0, rot: 0 }, params: {} } });
  const d2 = st.newId('board');
  check('newId after an add stays above it', +d2.slice(1) > +a.slice(1), d2);
  const toasts = [];
  bus.on('toast', t => toasts.push(t));
  const bad = st.apply({ op: 'move', id: 'p999', place: { x: 1 } });
  check('a bad op returns null and toasts, the doc stays', bad === null && toasts.length === 1, toasts[0] && toasts[0].text);
  st.load(emptyDoc());
  check('load clears the history', !st.canUndo && !st.canRedo && events.at(-1).source === 'load');
}

// ── normalize ──────────────────────────────────────────────────────────────
section('normalize');
{
  const raw = {
    format: 'breadboard-lab', version: 1, title: 'broken',
    boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 5 }, { id: 'b1', type: 'bb400', x: 0, z: 80 }, { id: 'b9', type: 'bb9999' }, { id: 'BOARD', type: 'bb170', x: 100, z: 0 }],
    parts: [
      { id: 'p2', def: 'res', place: { on: 'b1', x: 0, z: 0, rot: 0 }, params: { r: 220, bogus: 1 } },
      { id: 'p2', def: 'led', place: { on: 'b1', x: 2.54, z: 0, rot: 0 } },
      { id: 'p3', def: 'no-such-part', place: { on: 'b1' } },
      { id: 'p4', def: 'led', place: { on: 'b77', x: 1, z: 1 } },
      { id: 'R5', def: 'res', place: { on: 'BOARD', x: 0, z: 0 }, params: { r: { x: 1 } } },
    ],
    wires: [
      { id: 'w6', a: { hole: 'b1:a1' }, b: { hole: 'b1:z99' } },
      { id: 'w7', a: { hole: 'b1:a1' }, b: { part: 'p2', pin: '2' }, color: 'red' },
      { id: 'w8', a: { part: 'p3', pin: '1' }, b: { hole: 'b1:a2' } },
      { id: 'w9', a: { part: 'R5', pin: '1' }, b: { hole: 'BOARD:a3' } },
      { id: 'w10', a: { hole: 'b1:a4' }, b: { hole: 'b1:a4' } },
      { id: 'w11', a: { part: 'p2', pin: '9' }, b: { hole: 'b1:a5' } },
    ],
    probes: [{ id: 'm12', type: 'dmm', leads: { red: { hole: 'b1:x1' }, black: { part: 'p2', pin: '1' }, purple: null } }, { id: 'm13', type: 'oscar' }],
    programs: { p404: { lang: 'sketch', source: '' }, p2: { lang: 'basic' } },
    sim: { speed: -3 },
    nextId: 2,
  };
  const { doc, warnings } = normalizeDoc(raw, { registry: REGISTRY });
  const errs = validateDoc(doc, { registry: REGISTRY });
  check('broken input gives warnings', warnings.length >= 12, `${warnings.length} warnings`);
  check('broken input gives a valid document', errs.length === 0, errs.slice(0, 3).join(' | ') || 'no errors');
  check('duplicate board id gets a new id; parts stay on the first', doc.boards.length === 3 && doc.boards[0].id === 'b1' && doc.boards[1].id !== 'b1' && doc.boards[0].rot === 1, doc.boards.map(b => b.id).join());
  check('bad-prefix ids are renamed and references follow', doc.parts.some(p => p.def === 'res' && p.place.on === doc.boards[2].id) && doc.wires.some(w => w.b.hole && w.b.hole.startsWith(doc.boards[2].id + ':')), doc.wires.map(w => JSON.stringify(w.b)).join(' '));
  check('unknown defs and dangling wire ends are dropped', !doc.parts.some(p => p.def === 'no-such-part') && !doc.wires.some(w => w.id === 'w6' || w.id === 'w8' || w.id === 'w10' || w.id === 'w11'), doc.wires.map(w => w.id).join());
  check('a part on a missing board moves to the mat', doc.parts.some(p => p.def === 'led' && p.place.on === null));
  check('bad colour falls back to red; bad lead goes null; unknown probe dropped', doc.wires.find(w => w.id === 'w7').color === '#d63b3b' && doc.probes.length === 1 && doc.probes[0].leads.red === null && doc.probes[0].leads.black.part === 'p2');
  check('nextId moves above every id', doc.nextId > Math.max(...[...doc.boards, ...doc.parts, ...doc.wires, ...doc.probes].map(i => +i.id.replace(/\D/g, ''))), doc.nextId);
  const again = normalizeDoc(JSON.parse(JSON.stringify(doc)), { registry: REGISTRY });
  check('a normalized document normalizes with no warnings', again.warnings.length === 0 && deepEqual(again.doc, doc), again.warnings.join(' | '));
  const sd = normalizeDoc(sampleDoc(), { registry: REGISTRY });
  check('the sample document has no warnings', sd.warnings.length === 0, sd.warnings.join(' | '));
  for (const junk of [null, 42, 'not json', '[]']) {
    const r = normalizeDoc(junk);
    check(`junk input ${JSON.stringify(junk)} → empty valid doc`, r.warnings.length >= 1 && validateDoc(r.doc).length === 0, r.warnings[0]);
  }
}

// ── snap ───────────────────────────────────────────────────────────────────
section('snap');
{
  const doc = sampleDoc();
  const res = DEFS.res;
  const target = SP.holeWorld(doc, 'b1:a20');
  const s = snapPart(doc, res, { span: 4 }, { x: target.x + 1.2, z: target.z + 0.9, rot: 0 });
  check('a drag ending 1.5 mm from a hole snaps pin 1 to it', s.snapped && near(s.x, target.x) && near(s.z, target.z) && s.ok, `pin1 (${s.x}, ${s.z}) ok ${s.ok}`);
  check('the stored place is board-local', s.place.on === 'b1' && near(s.place.x, SP.colX(63, 20)) && near(s.place.z, SP.rowZ(0)), JSON.stringify(s.place));
  const far = snapPart(doc, res, { span: 4 }, { x: target.x + 2.4, z: target.z, rot: 0 });
  check('2.4 mm from every hole does not snap', far.snapped === false || near(far.x, SP.holeWorld(doc, 'b1:a21').x), `snapped ${far.snapped}`);
  const edge = SP.holeWorld(doc, 'b1:a62');
  const e = snapPart(doc, res, { span: 4 }, { x: edge.x, z: edge.z, rot: 0 });
  check('a part over the edge of a board shows red pins', e.snapped && !e.ok && e.pins[0].ok && !e.pins[1].ok, e.pins.map(p => p.ok ? 'green' : 'red').join(' '));
  const occ = occupiedHoles(doc, REGISTRY, new Set());
  const o = snapPart(doc, res, { span: 4 }, { x: SP.holeWorld(doc, 'b1:a6').x, z: SP.holeWorld(doc, 'b1:a6').z, rot: 0, occupied: occ });
  check('a pin on a hole that another part fills is red', occ.get('b1:a10') === 'p3' && !o.ok && !o.pins[1].ok, `a10 → ${occ.get('b1:a10')}`);
  const btn = snapPart(doc, DEFS['button-6mm'], {}, { ...SP.holeWorld(doc, 'b1:f30'), rot: 0 });
  check('a 6 mm button from f30 straddles the channel (pin 3 at e30)', btn.ok && btn.pins[2].hole === 'b1:e30' && btn.pins[3].hole === 'b1:e32', btn.pins.map(p => p.hole).join());
  const rot = snapPart(doc, res, { span: 4 }, { ...SP.holeWorld(doc, 'b1:a40'), rot: 1 });
  check('rot 1 turns the resistor down the column (pin 2 four rows on, off the strip)', rot.pins[1].hole === null || rot.pins[1].hole.endsWith('40'), rot.pins[1].hole);
  const rot1b = snapPart(doc, res, { span: 3 }, { ...SP.holeWorld(doc, 'b1:a40'), rot: 1 });
  check('rot 1, span 3 from a40 lands pin 2 in d40', rot1b.pins[1].hole === 'b1:d40', rot1b.pins[1].hole);
  const uno = snapPart(doc, DEFS['mcu-uno'], {}, { x: SP.holeWorld(doc, 'b1:a5').x, z: 0, rot: 0 });
  check('a free part never snaps and is always ok', !uno.snapped && uno.ok && uno.place.on === null);
  const led = snapPart(doc, DEFS.led, {}, { x: 300, z: 300, rot: 0 });
  check('a board part on the bare mat is red', !led.ok && led.pins.every(p => !p.ok));
  const span = { boards: [{ id: 'b1', type: 'bb400', x: 0, z: 0, rot: 0 }, { id: 'b2', type: 'bb400', x: 82.6, z: 0, rot: 0 }] };
  const sb = snapBoard(span, 'b2', 85, 1.5, 0);
  check('a board within 4 mm snaps edge to edge and flush', near(sb.x, 82.6, 1e-3) && near(sb.z, 0, 1e-3) && sb.snapped, `${sb.x}, ${sb.z}`);
  const sb2 = snapBoard(span, 'b2', 120, 0, 0);
  check('a board far away does not snap', !sb2.snapped && sb2.x === 120);
}

// ── picking ────────────────────────────────────────────────────────────────
section('picking');
{
  const doc = { boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }, { id: 'b2', type: 'bb400', x: 30, z: 75, rot: 1 }] };
  const cams = [
    { pos: [0, 300, 0.001], target: [0, 0, 0], fov: 38, aspect: 1.6 },
    { pos: [60, 180, 220], target: [0, 0, 0], fov: 38, aspect: 1.6 },
    { pos: [-200, 90, -120], target: [20, 0, 30], fov: 50, aspect: 0.6 },
  ];
  const holes = ['b1:a1', 'b1:j63', 'b1:TP7', 'b1:BN50', 'b1:e31', 'b2:f12', 'b2:TN1'];
  let good = 0, tried = 0;
  const misses = [];
  for (const cam of cams) for (const h of holes) {
    const p = SP.holeWorld(doc, h);
    const pr = projectPoint(cam, [p.x, p.y, p.z]);
    tried++;
    const ray = rayFromCamera(cam, pr.nx, pr.ny);
    const hit = pickBench(doc, ray);
    if (hit.hole === h) good++; else misses.push(`${h}→${hit.hole}`);
  }
  check('a ray through a known hole returns that hole id', good === tried, `${good}/${tried} ${misses.join(' ')}`);
  const cam = cams[1];
  const ray = rayFromCamera(cam, 0.98, -0.98);
  const off = pickBench(doc, ray);
  check('a ray off the boards hits the mat (no hole)', off.hole === null && off.board === null && off.point && near(off.point.y, 0), off.point && `${off.point.x.toFixed(1)}, ${off.point.z.toFixed(1)}`);
  const pins = [{ p: [10, 20, 0], id: 'a' }, { p: [10.5, 20, 0], id: 'b' }];
  const pr = projectPoint(cam, pins[1].p);
  const got = pickPoints(rayFromCamera(cam, pr.nx, pr.ny), pins, 1.0);
  check('pickPoints returns the point under the ray', got && got.id === 'b', got && got.id);
}
// the bench framed between the open columns: a camera view offset, and
// picks and projections that follow it (integration review 6)
{
  const P = await import('./picking.js');
  const THREE = await import('../../../vendor/three@0.160.0/build/three.module.js');
  const rect = { left: 0, top: 0, width: 1400, height: 900 };
  const ins = { left: 334, right: 434, top: 56, bottom: 210 };
  const view = P.insetViewOffset ? P.insetViewOffset(ins, rect.width, rect.height) : null;
  // the camera target (NDC 0, 0 of the full image) lands in the middle of the free band
  const c = view ? P.clientFromNdc(0, 0, rect, view) : null;
  const wantX = ins.left + (rect.width - ins.left - ins.right) / 2, wantY = ins.top + (rect.height - ins.top - ins.bottom) / 2;
  // a round trip: client → ndc → client, for a point near each corner
  let worst = 0;
  if (view) for (const [x, y] of [[ins.left + 5, ins.top + 5], [rect.width - ins.right - 5, rect.height - ins.bottom - 5], [700, 450]]) {
    const n = P.ndcFromClient(x, y, rect, view), b = P.clientFromNdc(n.x, n.y, rect, view);
    worst = Math.max(worst, Math.hypot(b.x - x, b.y - y));
  }
  // THREE with the same view offset agrees: its raycaster takes canvas NDC
  // (the projection holds the offset), picking.js takes full-image NDC
  let agree = Infinity;
  if (view) {
    const cam = new THREE.PerspectiveCamera(38, rect.width / rect.height, 1, 5000);
    cam.position.set(60, 180, 220); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    cam.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
    const rc = new THREE.Raycaster();
    agree = 0;
    for (const [x, y] of [[400, 100], [900, 600], [700, 450]]) {
      const nc = P.ndcFromClient(x, y, rect); rc.setFromCamera(new THREE.Vector2(nc.x, nc.y), cam);
      const nf = P.ndcFromClient(x, y, rect, cam.view);
      const r = P.rayFromCamera({ pos: [60, 180, 220], target: [0, 0, 0], fov: 38, aspect: rect.width / rect.height }, nf.x, nf.y);
      const d = rc.ray.direction;
      agree = Math.max(agree, Math.hypot(d.x - r.d[0], d.y - r.d[1], d.z - r.d[2]));
    }
  }
  check('insets: a THREE raycaster with the view offset and the picking.js ray agree', agree < 1e-9, `largest direction difference ${agree.toExponential(1)}`);
  check('insets: the camera target sits in the middle of the free band, and client ↔ NDC round-trips', !!c && Math.abs(c.x - wantX) < 0.5 && Math.abs(c.y - wantY) < 0.5 && worst < 1e-6,
    c ? `target at ${c.x.toFixed(1)}, ${c.y.toFixed(1)} px vs ${wantX}, ${wantY}; round trip ${worst.toExponential(1)} px` : 'no insetViewOffset / clientFromNdc in picking.js');
}

// ── camera ─────────────────────────────────────────────────────────────────
section('camera');
{
  const rig = createCameraRig({ target: [5, 0, -3], dist: 300, yaw: 0.7, pitch: 0.8, aspect: 1.5 });
  const pose = rig.pose();
  const r2 = createCameraRig({ aspect: 1.5 });
  r2.setPose(pose);
  check('setPose(pose()) round trip', near(r2.state.yaw, 0.7, 1e-9) && near(r2.state.pitch, 0.8, 1e-9) && near(r2.state.dist, 300, 1e-9), `${r2.state.yaw.toFixed(4)} ${r2.state.pitch.toFixed(4)}`);
  const anchor = [40, 0, 20];
  const before = projectPoint(rig.cam(), anchor);
  rig.zoom(0.5, anchor);
  const after = projectPoint(rig.cam(), anchor);
  check('zoom keeps the anchor point still on screen', near(before.nx, after.nx, 1e-9) && near(before.ny, after.ny, 1e-9), `${before.nx.toFixed(5)} → ${after.nx.toFixed(5)}`);
  const top = createCameraRig({ dist: 400, aspect: 1 });
  top.setState(top.topPose());
  const pr = projectPoint(top.cam(), [50, 0, 0]), pz = projectPoint(top.cam(), [0, 0, 50]);
  check('top view: +X is right, +Z is down', pr.nx > 0.05 && Math.abs(pr.ny) < 0.01 && pz.ny < -0.05 && Math.abs(pz.nx) < 0.01, `x→(${pr.nx.toFixed(3)}, ${pr.ny.toFixed(3)}) z→(${pz.nx.toFixed(3)}, ${pz.ny.toFixed(3)})`);
  check('top pitch is inside the clamp', top.isTop() && top.state.pitch <= PITCH_TOP + 1e-12);
  const t = createCameraRig({ yaw: 3.0, dist: 200 });
  t.animateTo({ target: [10, 0, 10], dist: 100, yaw: -3.0, pitch: 1.0 }, 500, 0);
  let steps = 0, maxJump = 0, last = t.state.yaw;
  t.update(0);
  for (let ms = 0; ms <= 600; ms += 16) { if (!t.update(ms)) break; steps++; { let dy = Math.abs(t.state.yaw - last); dy = Math.min(dy, 2 * Math.PI - dy); maxJump = Math.max(maxJump, dy); } last = t.state.yaw; }
  check('a tween ends at the goal and takes the short way round', near(t.state.dist, 100, 1e-6) && near(t.state.target[0], 10, 1e-9) && maxJump < 0.2 && !t.moving, `steps ${steps}, max yaw step ${maxJump.toFixed(3)}`);
  const f = createCameraRig({ aspect: 1.6 });
  const fp = f.fitPose({ min: [-82, 0, -27], max: [82, 10, 27] });
  f.setState(fp);
  const c = projectPoint(f.cam(), [82, 0, 27]), c2 = projectPoint(f.cam(), [-82, 0, -27]);
  check('fitPose keeps the box corners on screen', Math.abs(c.nx) < 1 && Math.abs(c.ny) < 1 && Math.abs(c2.nx) < 1 && Math.abs(c2.ny) < 1, `${c.nx.toFixed(2)}, ${c.ny.toFixed(2)}`);
  const p = createCameraRig({ dist: 300, pitch: 1.2, yaw: 0.4, aspect: 1 });
  const g0 = [p.state.target[0], p.state.target[2]];
  p.pan(100, 0, 800);
  const moved = Math.hypot(p.state.target[0] - g0[0], p.state.target[2] - g0[1]);
  const expect = 100 * 2 * 300 * Math.tan(38 * Math.PI / 360) / 800;
  check('pan of 100 px moves the target by one screen-px scale', near(moved, expect, 1e-6), `${moved.toFixed(3)} mm`);
}

// ── gestures ───────────────────────────────────────────────────────────────
section('gestures');
{
  let clock = 0;
  const timers = [];
  const env = { now: () => clock, setTimeout: (f, ms) => { timers.push({ f, at: clock + ms, live: true }); return timers.length - 1; }, clearTimeout: id => { if (timers[id]) timers[id].live = false; } };
  const fire = () => { for (const t of timers) if (t.live && t.at <= clock) { t.live = false; t.f(); } };
  const log = [];
  const g = createGestures({ any: (type, ev) => log.push(type + (ev && ev.factor ? ':' + ev.factor.toFixed(2) : '')) }, env);
  const P = (id, x, y, type = 'mouse', button = 0) => ({ pointerId: id, clientX: x, clientY: y, pointerType: type, button });
  g.down(P(1, 10, 10)); g.move(P(1, 12, 11)); g.up(P(1, 12, 11));
  check('mouse click under 4 px → tap', log.join() === 'down,tap,up', log.join());
  log.length = 0;
  g.down(P(1, 10, 10)); g.move(P(1, 30, 10)); g.move(P(1, 40, 10)); g.up(P(1, 40, 10));
  check('mouse drag → dragstart, drag, dragend', log.join() === 'down,dragstart,drag,drag,dragend,up', log.join());
  log.length = 0;
  g.down(P(2, 50, 50, 'touch')); clock = 600; fire(); g.up(P(2, 50, 50, 'touch'));
  check('touch held 600 ms → longpress, no tap', log.join() === 'down,longpress,up', log.join());
  log.length = 0; clock = 1000;
  g.down(P(3, 100, 100, 'touch')); g.down(P(4, 200, 100, 'touch'));
  g.move(P(4, 300, 100, 'touch'));
  g.up(P(3, 100, 100, 'touch')); g.up(P(4, 300, 100, 'touch')); clock = 2000; fire();
  check('second finger cancels the primary; spread → zoom in (factor < 1)', log[0] === 'down' && log[1] === 'cancel' && log.some(s => s.startsWith('zoom:0.5')) && !log.includes('longpress'), log.join());
  log.length = 0;
  g.down(P(5, 10, 10, 'mouse', 2)); g.up(P(5, 10, 10, 'mouse', 2));
  g.down(P(6, 10, 10, 'mouse', 2)); g.move(P(6, 40, 10, 'mouse', 2)); g.up(P(6, 40, 10, 'mouse', 2));
  check('right click → context; right drag → pan', log.join() === 'context,pan', log.join());
  log.length = 0;
  g.move(P(9, 5, 5));
  check('a mouse move with no button → hover', log.join() === 'hover', log.join());
  log.length = 0;
  g.wheel({ deltaY: 100, deltaMode: 0, clientX: 1, clientY: 1 });
  check('wheel down → zoom out (factor > 1)', log[0].startsWith('zoom:1.16'), log[0]);
}

// ── scene ──────────────────────────────────────────────────────────────────
const sceneTests = await import('./test/scene-tests.mjs').catch(e => ({ missing: e }));
if (sceneTests.run) {
  const r = await sceneTests.run({ section, check, near, deepEqual, sampleDoc });
  void r;
} else {
  section('scene');
  check('scene tests load', false, String(sceneTests.missing && sceneTests.missing.message));
}

// ── in-scene controls ──────────────────────────────────────────────────────
const controlTests = await import('./test/control-tests.mjs').catch(e => ({ missing: e }));
if (controlTests.run) await controlTests.run({ section, check, near });
else { section('controls'); check('control tests load', false, String(controlTests.missing && controlTests.missing.message)); }

// ── light budget ───────────────────────────────────────────────────────────
const lightTests = await import('./test/light-tests.mjs').catch(e => ({ missing: e }));
if (lightTests.run) await lightTests.run({ section, check, near });
else { section('light budget'); check('light tests load', false, String(lightTests.missing && lightTests.missing.message)); }

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
