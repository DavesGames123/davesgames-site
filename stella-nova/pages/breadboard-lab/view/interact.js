// ============================================================================
//  BREADBOARD LAB  ·  view/interact.js — tools, drags and keys
// ----------------------------------------------------------------------------
//  The rules of CONTRACT 4.2, as one state machine on top of the gestures of
//  view/touch.js. The scene passes a context V (pick, benchPoint, previews,
//  selection, camera rig, effects). This module only decides; the scene
//  draws.
//
//  A DRAG IS A PREVIEW OF A DOCUMENT. While a part, a board or a probe
//  moves, this module builds the moved document with applyOp (pure) and the
//  scene shows it. Only the drop writes to the store, as one batch op, so a
//  whole drag is one undo step. Esc or a second finger restores the store
//  document.
//
//  TOOLS
//    select  tap selects (shift toggles), drag moves parts / boards /
//            instruments / lead tips, shift-drag on empty space box-selects,
//            drag on empty space orbits. Button caps press, switches
//            toggle, knobs and sliders scrub (one undo step per scrub).
//    wire    tap a hole or socket, then a second one; drag from one to the
//            other works too. Style 'free' adds a bend point per tap on
//            empty space. Esc cancels.
//    probe   hover or tap a hole or pin: its net glows. Lead tips drag.
//    delete  tap removes a part, wire, board or instrument; a lead tip
//            unplugs.
//    place   a ghost follows the pointer with green / red pins; tap or drop
//            places. R turns it. Shift keeps placing.
//
//  GREP MAP
//    createInteraction ..... state: tool, drag, wire, placing, probing
//    setTool ............... tool changes and the 'tool' event
//    beginPlace / ghostAt .. library drag and phone tap placing
//    commitPlace / autoLabel  the add op of a new part
//    beginProbe ............ instruments on the mat, then their leads
//    onTap / onDragStart ... the tool rules
//    dragMove / dragBoard .. preview documents during drags
//    dragLead / dragParam .. lead tips; knobs and sliders
//    commitWire ............ the add op of a wire
//    rotateSelection ....... R; duplicateSelection (Cmd/Ctrl+D)
//    handleKey ............. keys of CONTRACT 4.4 that act on the view
// ============================================================================
import { applyOp } from '../core/store.js';
import { probeDefaults } from '../core/doc.js';
import { BOARD_TYPES, G, holeWorld, parseHoleId, partFrame, pinLocal, rotXZ } from '../core/space.js';
import { occupiedHoles, shiftPlace, snapBoard, snapPart, snapWirePoint } from './snap.js';

export const TOOLS = ['select', 'wire', 'probe', 'delete', 'place'];
const LABEL_PREFIX = [
  [/^res$/, 'R'], [/^(pot|trimpot)$/, 'RV'], [/^cap-/, 'C'], [/^inductor$/, 'L'], [/^fuse$/, 'F'],
  [/^(ldr|thermistor)$/, 'R'], [/^led/, 'LED'], [/^(diode|zener)/, 'D'], [/^(npn|pnp|nmos|pmos)/, 'Q'],
  [/^(ic-|reg-)/, 'U'], [/^(button|switch|keypad)/, 'SW'], [/^(buzzer|speaker)/, 'BZ'], [/^motor/, 'M'],
  [/^relay/, 'K'], [/^seg7|^lcd/, 'DS'], [/^mcu-/, 'MCU'], [/^(battery|coin|batt-)/, 'BT'],
];

export function endOf(target) {
  if (!target) return null;
  if (target.kind === 'hole') return { hole: target.hole };
  if (target.kind === 'pin') return { part: target.part, pin: target.pin };
  return null;
}
export const sameEnd = (a, b) => !!(a && b && (a.hole ? a.hole === b.hole : (a.part === b.part && a.pin === b.pin)));

export function autoLabel(doc, defId) {
  const hit = LABEL_PREFIX.find(([re]) => re.test(defId));
  if (!hit) return undefined;
  const pre = hit[1];
  let n = 0;
  for (const p of doc.parts) {
    const m = p.label && new RegExp('^' + pre + '(\\d+)$').exec(p.label);
    if (m) n = Math.max(n, +m[1]);
  }
  return pre + (n + 1);
}

// Centre of the pins of a def in its local frame (mm), turned by rot.
function pinCentre(def, params, rot) {
  const pins = (def.pins || []).map(p => pinLocal(def, p, params));
  if (!pins.length) return [0, 0];
  let x = 0, z = 0;
  for (const p of pins) { x += p.x; z += p.z; }
  return rotXZ(x / pins.length, z / pins.length, rot);
}

export function createInteraction(V) {
  const { store, bus } = V;
  let tool = 'select';
  let wireColor = '#d63b3b', wireStyle = 'arch';
  let drag = null;        // { mode, ... } while a primary drag runs
  let wire = null;        // { start: End, via: [] }
  let placing = null;     // { defId, def, params, rot, ghost, snap, occupied, fromDrag }
  let probing = null;     // { type, ghost, rot }
  let down = null;        // target under the pointer at 'down'
  let press = null;       // { id, key } of a held button cap
  let winOff = null;      // window listeners of a library drag
  const reg = () => V.registry;
  const doc = () => store.doc;
  const toast = (level, text) => bus && bus.emit('toast', { level, text });

  // ── tools ────────────────────────────────────────────────────────────────
  function setTool(t, quiet) {
    if (!TOOLS.includes(t)) return;
    if (t !== 'place') { if (placing) endPlace(null); if (probing) endProbe(); }
    if (t !== 'wire') cancelWire();
    if (t !== 'probe' && tool === 'probe') V.highlightNet(null);
    const changed = t !== tool;
    tool = t;
    V.setCursor(t === 'wire' || t === 'probe' || t === 'place' ? 'crosshair' : t === 'delete' ? 'not-allowed' : 'default');
    if (changed && !quiet && bus) bus.emit('tool', { tool: t });
  }

  function cancelWire() {
    if (!wire) return;
    wire = null;
    V.setWirePreview(null);
    V.effects.setHover(null);
  }

  // ── placing ──────────────────────────────────────────────────────────────
  function beginPlace(defId, params = {}, pe) {
    const def = V.defOf(defId);
    if (!def) { toast('error', `Unknown part "${defId}".`); return false; }
    cancelAll();
    placing = { defId, def, params: { ...params }, rot: 0, ghost: V.makeGhost(def, params), snap: null, fromDrag: !!pe };
    placing.occupied = occupiedHoles(doc(), reg());
    setTool('place');
    if (bus) bus.emit('place:start', { defId });
    if (pe && typeof window !== 'undefined') {
      const mv = e => ghostAt(e.clientX, e.clientY);
      const upf = e => {
        stopWin();
        if (!placing) return;
        if (V.overCanvas(e.clientX, e.clientY)) commitPlace(e.clientX, e.clientY, e.shiftKey);
        else endPlace(null);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', upf);
      window.addEventListener('pointercancel', upf);
      winOff = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upf); window.removeEventListener('pointercancel', upf); };
      ghostAt(pe.clientX, pe.clientY);
    }
    return true;
  }
  function stopWin() { if (winOff) { winOff(); winOff = null; } }

  function ghostAt(cx, cy) {
    if (!placing) return null;
    const b = V.benchPoint(cx, cy);
    if (!b) { V.showGhost(placing.ghost, null); V.effects.setPinMarkers([]); placing.snap = null; return null; }
    const [cxo, czo] = pinCentre(placing.def, placing.params, placing.rot);
    const s = snapPart(doc(), placing.def, placing.params, { x: b.x - cxo, z: b.z - czo, rot: placing.rot, occupied: placing.occupied });
    placing.snap = s;
    V.showGhost(placing.ghost, s);
    V.effects.setPinMarkers(placing.def.mount === 'free' ? [] : s.pins);
    V.requestRender();
    return s;
  }

  function commitPlace(cx, cy, keep) {
    if (!placing) return null;
    const s = ghostAt(cx, cy);
    if (!s) return null;
    const id = store.newId('part');
    const item = { id, def: placing.defId, place: s.place, params: { ...placing.params } };
    const label = autoLabel(doc(), placing.defId);
    if (label) item.label = label;
    store.apply({ op: 'add', kind: 'part', item });
    if (!s.ok && placing.def.mount !== 'free') toast('warn', 'Some pins are not in a hole (red). The part sits there unplugged.');
    if (keep) { placing.occupied = occupiedHoles(doc(), reg()); V.setSelection([id]); return id; }
    endPlace(id);
    V.setSelection([id]);
    return id;
  }

  function endPlace(id) {
    stopWin();
    if (!placing) return;
    V.disposeGhost(placing.ghost);
    V.effects.setPinMarkers([]);
    placing = null;
    if (bus) bus.emit('place:end', { id: id || null });
    if (tool === 'place') setTool('select');
    V.requestRender();
  }

  // ── instruments ──────────────────────────────────────────────────────────
  function beginProbe(type) {
    if (!probeDefaults(type)) { toast('error', `Unknown instrument "${type}".`); return false; }
    cancelAll();
    probing = { type, rot: 0, ghost: V.makeProbeGhost(type) };
    setTool('place');
    if (bus) bus.emit('place:start', { defId: 'inst-' + type });
    return true;
  }
  function probeAt(cx, cy) {
    if (!probing) return null;
    const b = V.benchPoint(cx, cy);
    V.showGhost(probing.ghost, b ? { x: b.x, y: 0, z: b.z, rot: probing.rot } : null);
    V.requestRender();
    return b;
  }
  function commitProbe(cx, cy) {
    const b = probeAt(cx, cy);
    if (!b) return null;
    const d = probeDefaults(probing.type);
    const id = store.newId('probe');
    const leads = {};
    for (const n of d.leads) leads[n] = null;
    store.apply({ op: 'add', kind: 'probe', item: { id, type: probing.type, place: { x: Math.round(b.x * 10) / 10, z: Math.round(b.z * 10) / 10, rot: probing.rot }, leads, settings: d.settings } });
    endProbe(id);
    V.setSelection([id]);
    setTool('probe');
    toast('info', 'Drag a lead tip onto a hole or a pin.');
    return id;
  }
  function endProbe(id) {
    if (!probing) return;
    V.disposeGhost(probing.ghost);
    probing = null;
    if (bus) bus.emit('place:end', { id: id || null });
    if (tool === 'place') setTool('select', true);
  }

  function cancelAll() {
    if (drag) cancelDrag();
    if (placing) endPlace(null);
    if (probing) endProbe(null);
    cancelWire();
  }

  // ── wires ────────────────────────────────────────────────────────────────
  function commitWire(a, b) {
    if (!a || !b || sameEnd(a, b)) return null;
    const id = store.newId('wire');
    const item = { id, a, b, color: wireColor, style: wireStyle };
    if (wireStyle === 'free' && wire && wire.via.length) item.via = wire.via.map(p => p.slice());
    store.apply({ op: 'add', kind: 'wire', item });
    cancelWire();
    return id;
  }
  function wirePreviewTo(cx, cy) {
    if (!wire) return;
    const t = V.pick(cx, cy, 'endpoint');
    const e = endOf(t);
    let to = e ? V.endWorld(e) : null;
    if (!to) { const b = V.benchPoint(cx, cy); if (!b) return; to = [b.x, b.y + 2, b.z]; }
    V.effects.setHover(e ? to : null, e && !sameEnd(e, wire.start) ? 0x63c24c : 0x6b9fe2);
    V.setWirePreview({ a: wire.start, bPoint: to, style: wireStyle, via: wire.via, color: wireColor });
  }

  // ── interactive parts ────────────────────────────────────────────────────
  function interactOf(target) {
    if (!target || target.kind !== 'part' || !V.lastHit) return null;
    const rec = V.partRec(target.id);
    if (!rec || !rec.handle.interact) return null;
    const meshes = rec.handle.interact.meshes || [];
    let o = V.lastHit.object;
    while (o) { if (meshes.includes(o)) break; o = o.parent; }
    if (!o) return null;
    const part = store.find(target.id);
    const def = V.defOf(part.def);
    const key = rec.handle.interact.key || (def.interact && def.interact.key);
    const kind = rec.handle.interact.kind || (def.interact && def.interact.kind);
    const pd = (def.params || []).find(p => p.key === key) || { key, type: 'number', min: 0, max: 1, default: 0 };
    const cur = part.params[key] !== undefined ? part.params[key] : pd.default;
    return { id: target.id, key, kind, pd, cur };
  }
  function toggleValue(pd, cur) {
    if (pd.type === 'bool') return !cur;
    if (pd.type === 'enum' && pd.options && pd.options.length) return pd.options[(pd.options.indexOf(cur) + 1) % pd.options.length];
    const lo = pd.min ?? 0, hi = pd.max ?? 1;
    return cur >= (lo + hi) / 2 ? lo : hi;
  }
  // A tap holds the cap at least PRESS_MS, so the sim sees the press.
  const PRESS_MS = 150;
  function releasePress() {
    if (!press) return;
    const p = press;
    press = null;
    const release = () => {
      if (!store.find(p.id)) return;
      store.apply({ op: 'set', id: p.id, path: 'params.' + p.key, value: false }, { history: false });
      if (bus) bus.emit('interact', { part: p.id, key: p.key, value: false });
    };
    const held = V.now() - p.t0;
    if (held >= PRESS_MS || typeof setTimeout !== 'function') release();
    else setTimeout(release, PRESS_MS - held);
  }

  // ── selection helpers ────────────────────────────────────────────────────
  const selected = () => [...V.selection];
  function selectTarget(t, shift) {
    let id = null;
    if (!t) { if (!shift) V.setSelection([]); return; }
    if (t.kind === 'part' || t.kind === 'wire' || t.kind === 'probe' || t.kind === 'board') id = t.id;
    else if (t.kind === 'lead') id = t.probe;
    else if (t.kind === 'hole' && t.board) id = t.board;
    else if (t.kind === 'pin') id = t.part;
    if (!id) { if (!shift) V.setSelection([]); return; }
    if (shift) {
      const s = new Set(V.selection);
      if (s.has(id)) s.delete(id); else s.add(id);
      V.setSelection([...s]);
    } else V.setSelection([id]);
  }

  // ── drags ────────────────────────────────────────────────────────────────
  function startMove(cx, cy, primaryId) {
    const d = doc();
    if (!V.selection.has(primaryId)) V.setSelection([primaryId]);
    const ids = selected().filter(id => store.find(id) && (id[0] === 'p' || id[0] === 'm'));
    if (!ids.includes(primaryId)) ids.push(primaryId);
    const b = V.benchPoint(cx, cy);
    if (!b) return null;
    const prim = store.find(primaryId);
    if (primaryId[0] === 'm') {
      return { mode: 'move', ids, primaryId, x0: b.x, z0: b.z, doc0: d, occupied: new Map() };
    }
    const f = partFrame(d, prim);
    return { mode: 'move', ids, primaryId, grabX: f.x - b.x, grabZ: f.z - b.z, x0: f.x, z0: f.z, rot: f.rot, doc0: d, occupied: occupiedHoles(d, reg(), new Set(ids)) };
  }
  function dragMove(cx, cy) {
    const b = V.benchPoint(cx, cy);
    if (!b) return;
    const d0 = drag.doc0;
    const ops = [];
    const markers = [];
    let dx, dz;
    if (drag.primaryId[0] === 'p') {
      const prim = d0.parts.find(p => p.id === drag.primaryId);
      const def = V.defOf(prim.def);
      const s = snapPart(d0, def, prim.params, { x: b.x + drag.grabX, z: b.z + drag.grabZ, rot: drag.rot, occupied: drag.occupied });
      dx = s.x - drag.x0; dz = s.z - drag.z0;
      ops.push({ op: 'move', id: prim.id, place: s.place });
      if (def.mount !== 'free') markers.push(...s.pins);
    } else { dx = b.x - drag.x0; dz = b.z - drag.z0; }
    for (const id of drag.ids) {
      if (id === drag.primaryId && id[0] === 'p') continue;
      if (id[0] === 'm') {
        const m = d0.probes.find(q => q.id === id);
        ops.push({ op: 'move', id, place: { x: m.place.x + dx, z: m.place.z + dz } });
        continue;
      }
      const p = d0.parts.find(q => q.id === id);
      const def = V.defOf(p.def);
      if (!def) continue;
      const s = shiftPlace(d0, p, def, dx, dz, { occupied: drag.occupied });
      ops.push({ op: 'move', id, place: s.place });
      if (def.mount !== 'free') markers.push(...s.pins);
    }
    drag.ops = ops;
    drag.moved = Math.hypot(dx, dz) > 1e-6;
    V.previewDoc(applyOp(d0, { op: 'batch', ops }).doc);
    V.effects.setPinMarkers(markers);
  }

  function startBoard(cx, cy, id) {
    const b = V.benchPoint(cx, cy, 0);
    const bd = store.find(id);
    if (!b || !bd) return null;
    V.setSelection([id]);
    return { mode: 'board', id, grabX: bd.x - b.x, grabZ: bd.z - b.z, rot: bd.rot, doc0: doc() };
  }
  function dragBoard(cx, cy) {
    const b = V.benchPoint(cx, cy, 0);
    if (!b) return;
    const s = snapBoard(drag.doc0, drag.id, b.x + drag.grabX, b.z + drag.grabZ, drag.rot);
    drag.ops = [{ op: 'move', id: drag.id, place: { x: Math.round(s.x * 100) / 100, z: Math.round(s.z * 100) / 100 } }];
    drag.moved = true;
    V.previewDoc(applyOp(drag.doc0, drag.ops[0]).doc);
  }

  function dragLead(cx, cy) {
    const t = V.pick(cx, cy, 'endpoint');
    const e = endOf(t);
    drag.end = e;
    let p = e ? V.endWorld(e) : null;
    if (!p) { const b = V.benchPoint(cx, cy); p = b ? [b.x, b.y, b.z] : null; }
    V.setLeadPreview(drag.probe, drag.lead, p);
    V.effects.setHover(e ? p : null, 0x63c24c);
    if (tool === 'probe' || tool === 'select') V.highlightNet(e ? V.nodeOf(t) : null);
  }

  function dragParam(cx, cy) {
    const { pd } = drag.it;
    const lo = pd.min ?? 0, hi = pd.max ?? 1;
    const delta = ((cx - drag.x0) - (cy - drag.y0)) / 260;
    let v = drag.it.cur + delta * (hi - lo);
    v = Math.min(hi, Math.max(lo, v));
    if (pd.type === 'int') v = Math.round(v);
    else v = Math.round(v * 1000) / 1000;
    if (v === drag.last) return;
    drag.last = v;
    store.apply({ op: 'set', id: drag.it.id, path: 'params.' + drag.it.key, value: v }, { merge: 'scrub:' + drag.it.id + ':' + drag.it.key });
  }

  function cancelDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === 'move' || d.mode === 'board' || d.mode === 'probe-move') { V.previewDoc(null); V.effects.setPinMarkers([]); }
    if (d.mode === 'lead') { V.setLeadPreview(null); V.effects.setHover(null); }
    if (d.mode === 'box') V.setBoxRect(null);
    if (d.mode === 'wire') cancelWire();
    if (d.mode === 'param') store.seal();
  }

  // ── gesture handlers ─────────────────────────────────────────────────────
  function onDown(ev) {
    const mode = tool === 'wire' ? 'endpoint' : tool === 'delete' ? 'delete' : 'select';
    down = { target: V.pick(ev.x, ev.y, mode), x: ev.x, y: ev.y };
    down.hit = V.lastHit;
    if ((tool === 'select' || tool === 'probe') && down.target && down.target.kind === 'part') {
      const it = interactOf(down.target);
      if (it && it.kind === 'press') {
        press = { id: it.id, key: it.key, t0: V.now() };
        store.apply({ op: 'set', id: it.id, path: 'params.' + it.key, value: true }, { history: false });
        if (bus) bus.emit('interact', { part: it.id, key: it.key, value: true });
        down.pressed = true;
      }
      down.interact = it;
    }
  }

  function onTap(ev) {
    releasePress();
    if (down && down.pressed) { down = null; return; }
    const shift = ev.shift;
    if (probing) { commitProbe(ev.x, ev.y); return; }
    if (placing) { commitPlace(ev.x, ev.y, shift); return; }
    switch (tool) {
      case 'select': {
        const t = V.pick(ev.x, ev.y, 'select');
        const it = down && down.interact;
        if (it && it.kind === 'toggle' && t && t.kind === 'part' && t.id === it.id) {
          store.apply({ op: 'set', id: it.id, path: 'params.' + it.key, value: toggleValue(it.pd, it.cur) });
          if (bus) bus.emit('interact', { part: it.id, key: it.key });
          break;
        }
        selectTarget(t, shift);
        break;
      }
      case 'wire': {
        const t = V.pick(ev.x, ev.y, 'endpoint');
        const e = endOf(t);
        if (!wire) {
          if (e) { wire = { start: e, via: [] }; wirePreviewTo(ev.x, ev.y); }
          break;
        }
        if (e) {
          if (sameEnd(e, wire.start)) { cancelWire(); break; }
          commitWire(wire.start, e);
          break;
        }
        if (wireStyle === 'free') {
          const b = V.benchPoint(ev.x, ev.y);
          if (b) { wire.via.push(snapWirePoint(b.x, b.z, b.y + 8)); wirePreviewTo(ev.x, ev.y); }
        }
        break;
      }
      case 'probe': {
        const t = V.pick(ev.x, ev.y, 'endpoint');
        if (t && (t.kind === 'hole' || t.kind === 'pin')) {
          const node = V.nodeOf(t);
          V.highlightNet(node, t);
          if (bus) bus.emit('hover', { target: t, x: ev.x, y: ev.y });
        } else {
          V.highlightNet(null);
          selectTarget(V.pick(ev.x, ev.y, 'select'), shift);
        }
        break;
      }
      case 'delete': {
        const t = V.pick(ev.x, ev.y, 'delete');
        if (!t) break;
        if (t.kind === 'lead') { store.apply({ op: 'set', id: t.probe, path: 'leads.' + t.lead, value: null }); break; }
        if (t.kind === 'part' || t.kind === 'wire' || t.kind === 'probe' || t.kind === 'board') {
          const label = t.kind === 'board' ? 'board and everything on it' : t.kind;
          store.apply({ op: 'remove', ids: [t.id] });
          if (t.kind === 'board') toast('info', `Removed the ${label}. Undo brings it back.`);
          V.setSelection(selected().filter(id => store.find(id)));
        }
        break;
      }
      default: break;
    }
    down = null;
  }

  function onDragStart(ev) {
    releasePress();
    if (placing || probing) { drag = { mode: 'ghost' }; return; }
    const t = down ? down.target : null;
    const it = down && down.interact;
    if (it && (it.kind === 'knob' || it.kind === 'slider')) {
      drag = { mode: 'param', it, x0: ev.x0, y0: ev.y0 };
      return;
    }
    if (t && t.kind === 'lead' && tool !== 'delete') {
      drag = { mode: 'lead', probe: t.probe, lead: t.lead, end: null };
      return;
    }
    if (tool === 'select') {
      if (t && t.kind === 'part') { drag = startMove(ev.x0, ev.y0, t.id); if (drag) return; }
      if (t && t.kind === 'probe') { drag = startMove(ev.x0, ev.y0, t.id); if (drag) return; }
      if (t && (t.kind === 'board' || (t.kind === 'hole' && t.board)) && !ev.shift) { drag = startBoard(ev.x0, ev.y0, t.board || t.id); if (drag) return; }
      if (ev.shift) { drag = { mode: 'box', x0: ev.x0, y0: ev.y0 }; return; }
    }
    if (tool === 'wire' && t && (t.kind === 'hole' || t.kind === 'pin')) {
      wire = { start: endOf(t), via: [] };
      drag = { mode: 'wire' };
      return;
    }
    drag = { mode: 'orbit' };
  }

  function onDrag(ev) {
    if (!drag) return;
    switch (drag.mode) {
      case 'orbit': V.rig.orbit(-ev.dx * 0.0065, ev.dy * 0.005); V.requestRender(); V.emitCamera('orbit'); break;
      case 'move': dragMove(ev.x, ev.y); break;
      case 'board': dragBoard(ev.x, ev.y); break;
      case 'lead': dragLead(ev.x, ev.y); break;
      case 'param': dragParam(ev.x, ev.y); break;
      case 'box': V.setBoxRect({ x0: drag.x0, y0: drag.y0, x1: ev.x, y1: ev.y }); break;
      case 'wire': wirePreviewTo(ev.x, ev.y); break;
      case 'ghost': if (placing) ghostAt(ev.x, ev.y); else probeAt(ev.x, ev.y); break;
      default: break;
    }
  }

  function onDragEnd(ev) {
    const d = drag;
    drag = null;
    if (!d) return;
    switch (d.mode) {
      case 'move': case 'board':
        V.effects.setPinMarkers([]);
        if (d.ops && d.ops.length && d.moved) { V.previewDoc(null, true); store.apply({ op: 'batch', ops: d.ops }); }
        else V.previewDoc(null);
        break;
      case 'lead': {
        V.setLeadPreview(null);
        V.effects.setHover(null);
        const m = store.find(d.probe);
        const cur = m && m.leads ? m.leads[d.lead] : null;
        if (!sameEnd(cur, d.end) && !(cur === null && d.end === null)) store.apply({ op: 'set', id: d.probe, path: 'leads.' + d.lead, value: d.end || null });
        break;
      }
      case 'param': store.seal(); break;
      case 'box': {
        V.setBoxRect(null);
        const ids = V.itemsInRect({ x0: d.x0, y0: d.y0, x1: ev.x, y1: ev.y });
        V.setSelection(ev.shift ? [...new Set([...V.selection, ...ids])] : ids);
        break;
      }
      case 'wire': {
        const t = V.pick(ev.x, ev.y, 'endpoint');
        const e = endOf(t);
        if (e && wire && !sameEnd(e, wire.start)) commitWire(wire.start, e);
        // Released on nothing: the wire stays started, as after a tap.
        break;
      }
      case 'ghost': if (placing) commitPlace(ev.x, ev.y, ev.shift); else if (probing) commitProbe(ev.x, ev.y); break;
      default: break;
    }
    down = null;
  }

  function onHover(ev) {
    if (placing) { ghostAt(ev.x, ev.y); return; }
    if (probing) { probeAt(ev.x, ev.y); return; }
    const mode = tool === 'wire' || tool === 'probe' ? 'endpoint' : tool === 'delete' ? 'delete' : 'select';
    const t = V.pick(ev.x, ev.y, mode);
    if (tool === 'wire') {
      if (wire) wirePreviewTo(ev.x, ev.y);
      else { const e = endOf(t); V.effects.setHover(e ? V.endWorld(e) : null); V.requestRender(); }
    } else if (tool === 'probe') {
      V.highlightNet(t && (t.kind === 'hole' || t.kind === 'pin') ? V.nodeOf(t) : null, t);
    } else if (tool === 'select') {
      const it = t && t.kind === 'part' ? interactOf(t) : null;
      V.setCursor(it ? 'pointer' : t && (t.kind === 'part' || t.kind === 'probe' || t.kind === 'lead') ? 'grab' : 'default');
    }
    if (bus) bus.emit('hover', { target: t, x: ev.x, y: ev.y });
  }

  function onCancel() {
    releasePress();
    if (drag) cancelDrag();
    down = null;
  }

  function onContext(ev) {
    const t = V.pick(ev.x, ev.y, 'delete');
    if (t && (t.kind === 'part' || t.kind === 'board' || t.kind === 'probe' || t.kind === 'wire') && !V.selection.has(t.id)) V.setSelection([t.id]);
    if (bus) bus.emit('context', { target: t, x: ev.x, y: ev.y, ids: selected() });
  }

  // ── selection edits ──────────────────────────────────────────────────────
  function rotateSelection() {
    if (placing) { placing.rot = (placing.rot + 1) % 4; if (V.lastPointer) ghostAt(V.lastPointer.x, V.lastPointer.y); return true; }
    if (probing) { probing.rot = (probing.rot + 1) % 4; if (V.lastPointer) probeAt(V.lastPointer.x, V.lastPointer.y); return true; }
    const d = doc();
    const ops = [];
    const occ = occupiedHoles(d, reg(), new Set(selected()));
    for (const id of selected()) {
      const it = store.find(id);
      if (!it) continue;
      if (id[0] === 'b') ops.push({ op: 'move', id, place: { rot: (it.rot + 1) % 4 } });
      else if (id[0] === 'm') ops.push({ op: 'move', id, place: { rot: ((it.place.rot || 0) + 1) % 4 } });
      else if (id[0] === 'p') {
        const def = V.defOf(it.def);
        if (!def) continue;
        const f = partFrame(d, it);
        const s = snapPart(d, def, it.params, { x: f.x, z: f.z, rot: f.rot + 1, occupied: occ, snap: 0.3 });
        ops.push({ op: 'move', id, place: s.place });
      }
    }
    if (!ops.length) return false;
    store.apply({ op: 'batch', ops });
    return true;
  }

  function deleteSelection() {
    const ids = selected().filter(id => store.find(id));
    if (!ids.length) return false;
    store.apply({ op: 'remove', ids });
    V.setSelection([]);
    return true;
  }

  function duplicateSelection() {
    const d = doc();
    const ops = [];
    const fresh = [];
    const occ = occupiedHoles(d, reg());
    let work = d;
    for (const id of selected()) {
      const it = store.find(id);
      if (!it) continue;
      if (id[0] === 'p') {
        const def = V.defOf(it.def);
        if (!def) continue;
        const nid = store.newId('part');
        const f = partFrame(d, it);
        const step = def.mount === 'free' ? [30, 0] : rotXZ(3 * G, 0, f.board ? f.board.rot : 0);
        const s = def.mount === 'free'
          ? { place: { on: null, x: f.x + 30, z: f.z + 30, rot: f.rot } }
          : snapPart(work, def, it.params, { x: f.x + step[0], z: f.z + step[1], rot: f.rot, occupied: occ });
        const item = { ...JSON.parse(JSON.stringify(it)), id: nid, place: s.place };
        const label = autoLabel(work, it.def);
        if (label) item.label = label; else delete item.label;
        const op = { op: 'add', kind: 'part', item };
        ops.push(op);
        work = applyOp(work, op).doc;
        fresh.push(nid);
      } else if (id[0] === 'm') {
        const nid = store.newId('probe');
        const leads = {};
        for (const k of Object.keys(it.leads)) leads[k] = null;
        const op = { op: 'add', kind: 'probe', item: { ...JSON.parse(JSON.stringify(it)), id: nid, leads, place: { ...it.place, x: it.place.x + 40, z: it.place.z + 20 } } };
        ops.push(op); work = applyOp(work, op).doc; fresh.push(nid);
      } else if (id[0] === 'b') {
        const nb = store.newId('board');
        const bt = BOARD_TYPES[it.type];
        const odd = it.rot % 2 === 1;
        const dz = (odd ? bt.size[0] : bt.size[1]) + 8;
        const op = { op: 'add', kind: 'board', item: { ...JSON.parse(JSON.stringify(it)), id: nb, z: it.z + dz } };
        ops.push(op); work = applyOp(work, op).doc; fresh.push(nb);
        const pmap = {};
        for (const p of d.parts) if (p.place.on === id) {
          const np = store.newId('part');
          pmap[p.id] = np;
          const o = { op: 'add', kind: 'part', item: { ...JSON.parse(JSON.stringify(p)), id: np, place: { ...p.place, on: nb } } };
          ops.push(o); work = applyOp(work, o).doc;
        }
        const mapEnd = e => {
          if (e.hole) { const h = parseHoleId(e.hole); return h.board === id ? { hole: nb + ':' + h.local } : null; }
          return pmap[e.part] ? { part: pmap[e.part], pin: e.pin } : null;
        };
        for (const w of d.wires) {
          const a = mapEnd(w.a), b = mapEnd(w.b);
          if (!a || !b) continue;
          const o = { op: 'add', kind: 'wire', item: { ...JSON.parse(JSON.stringify(w)), id: store.newId('wire'), a, b } };
          ops.push(o); work = applyOp(work, o).doc;
        }
      }
    }
    if (!ops.length) return false;
    store.apply({ op: 'batch', ops });
    V.setSelection(fresh);
    return true;
  }

  // ── keys ─────────────────────────────────────────────────────────────────
  function handleKey(e) {
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ''))) return false;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (k === 'Escape') {
      if (placing) { endPlace(null); return true; }
      if (probing) { endProbe(null); return true; }
      if (drag) { cancelDrag(); return true; }
      if (wire) { cancelWire(); return true; }
      if (V.selection.size) { V.setSelection([]); return true; }
      return false;
    }
    if (mod && (k === 'd' || k === 'D')) return duplicateSelection();
    if (mod || e.altKey) return false;
    switch (k) {
      case 'r': case 'R': return rotateSelection();
      case 'Delete': case 'Backspace': return deleteSelection();
      case 'v': case 'V': setTool('select'); return true;
      case 'w': case 'W': setTool('wire'); return true;
      case 'p': case 'P': setTool('probe'); return true;
      case 'x': case 'X': setTool('delete'); return true;
      case 'f': case 'F': if (V.selection.size) V.focus([...V.selection][0]); else V.fit(); return true;
      case 't': case 'T': V.topView(); return true;
      case 'o': case 'O': V.orbitView(); return true;
      default: return false;
    }
  }

  return {
    handlers: {
      down: onDown, tap: onTap, dragstart: onDragStart, drag: onDrag, dragend: onDragEnd,
      hover: onHover, cancel: onCancel, longpress: onContext, context: onContext,
      up() { releasePress(); },
    },
    get tool() { return tool; },
    get transient() { return !!(placing || probing || drag || wire); },
    get wiring() { return wire ? { start: wire.start, via: wire.via.slice() } : null; },
    get placing() { return placing ? { defId: placing.defId, rot: placing.rot, snap: placing.snap } : null; },
    setTool, beginPlace, beginProbe, cancel: cancelAll,
    setWireColor(c) { wireColor = c; if (wire && V.lastPointer) wirePreviewTo(V.lastPointer.x, V.lastPointer.y); },
    setWireStyle(s) { if (['arch', 'flat', 'free'].includes(s)) wireStyle = s; },
    get wireColor() { return wireColor; }, get wireStyle() { return wireStyle; },
    rotateSelection, deleteSelection, duplicateSelection, handleKey,
    onDocChange(e) {
      if (drag && e && e.source !== 'user') cancelDrag();
      if (placing) placing.occupied = occupiedHoles(doc(), reg());
      if (wire && wire.start.part && !store.find(wire.start.part)) cancelWire();
      if (wire && wire.start.hole && !holeWorld(doc(), wire.start.hole)) cancelWire();
    },
    dispose() { stopWin(); cancelAll(); },
  };
}
