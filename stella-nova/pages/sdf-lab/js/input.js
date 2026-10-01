// ============================================================================
//  SDF FORGE  ·  input.js — pointer, touch, keyboard, creation gestures
// ----------------------------------------------------------------------------
//  One gesture at a time (act). A press in a pane is routed, in order, to:
//    the SLICE pane handles, the view cube, a pan or orbit modifier, an
//    armed creation tool, a gizmo handle; otherwise it waits to see if it is
//    a click (select) or a drag (orbit in perspective, pan in an axis pane).
//
//  THE CREATION GESTURE IS PER KIND (Forge decision 9). A sphere drags a
//  radius from its centre; a box drags a footprint corner to corner, then
//  the height; a cone reads its top radius on the plane at its own top; a
//  torus reads its tube radius from the ring. Every primitive is built ON
//  the construction plane of the pane (decision 10): its local Y is the plane
//  normal and its centre sits half its height above the plane. The node
//  exists from the press, so the preview is the real field; Esc removes it
//  and the finished shape is one undo record.
//
//  KEYS  (Forge and 3ds Max)
//    Q W E R select move rotate scale     T F L P top front left perspective
//    Alt+W maximise the pane              Z frame selected (Shift+Z all)
//    1-6 shading of the active pane       S snap   G grid   X world / local
//    Ctrl+Z undo   Ctrl+Shift+Z or Ctrl+Y redo   Ctrl+D or Shift+D clone
//    Ctrl+G group   Ctrl+Shift+G ungroup   H hide   Delete delete
//    Ctrl+S save   Ctrl+O open   Esc cancel, disarm, deselect
//    Numpad 1 2 3 4 6 7 8: front top right iso back bottom left (Forge)
//
//  GREP MAP
//    pickId ............ the node under a pixel (CPU march of the same field)
//    onDown / onMove / onUp / onWheel
//    gizmoBegin / gizmoMove / gizmoEnd
//    createDown / createMove / createStep / createFinish / createCancel
//    sliceDown / sliceMove
//    onKey
// ============================================================================
import * as D from './doc.js';
import * as V from './math.js';
import * as GZ from './gizmo.js';
import * as VC from './viewcube.js';
import * as PN from './panes.js';
import { orbit, pan, dolly, viewFromDir, basis } from './camera.js';
import { march } from './field.js';

const $ = id => document.getElementById(id);
const PLANE_ROT = [[0, 0, 0], [90, 0, 0], [0, 0, -90]];

export function initInput(app) {
  const vp = $('viewport');
  const ptrs = new Map();
  let act = null, hoverT = 0;
  const at = e => { const b = vp.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const paneAt = (x, y) => PN.paneAt(app.rects, x, y);
  const dirtyPane = slot => { app.dirtyPane(slot); };
  const gridStep = r => { const P = app.projOf(r); return Math.pow(10, Math.ceil(Math.log10(P.worldPerPx(app.panes.slots[r.slot].cam.target) * 9))); };
  const snapV = (v, s) => Math.round(v / s) * s;

  // ── picking ───────────────────────────────────────────────────────────────
  function pickId(r, lx, ly) {
    const F = app.F; if (!F) return null;
    const P = app.projOf(r), ray = P.ray(lx, ly);
    const pix = P.ortho ? 0 : 2 * P.tan / r.h;
    const res = march(F, ray.o, ray.d, { tmax: (P.ortho ? 400 : 0) + app.panes.slots[r.slot].cam.dist * 3 + 80, steps: 300, pix, k: F.stepK });
    if (!res.hit) return null;
    const p = V.add(ray.o, V.scale(ray.d, res.t));
    const m = F.mapM(p[0], p[1], p[2]);
    const id = F.L.order[Math.round(m.id)];
    return id ?? null;
  }
  app.pickId = pickId;
  // A click on a node already selected walks up to its group.
  function selectAt(r, lx, ly, e) {
    const leaf = pickId(r, lx, ly);
    if (app.pick) { if (leaf) app.finishPick(leaf); return; }
    if (!leaf) { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) app.select([]); return; }
    if (e.shiftKey || e.ctrlKey || e.metaKey) { app.select([leaf], 'toggle'); return; }
    const chain = [leaf];
    for (let p = D.parentOf(app.doc, leaf); p; p = D.parentOf(app.doc, p.id)) chain.push(p.id);
    const cur = app.sel.length === 1 ? chain.indexOf(app.sel[0]) : -1;
    app.select([cur >= 0 && cur + 1 < chain.length ? chain[cur + 1] : chain[0]]);
  }
  app.finishPick = idB => {
    const { op, a } = app.pick;
    app.pick = null;
    if (idB === a || D.isDescendant(app.doc, idB, a) || D.isDescendant(app.doc, a, idB)) { app.toast('Operand B must be another object.'); app.emit('tool'); return; }
    // take B's ancestor that is A's sibling, else B's top-level node
    const pa = D.parentOf(app.doc, a);
    let b = idB, top = idB;
    for (let p = D.parentOf(app.doc, idB); p; p = D.parentOf(app.doc, p.id)) { if (p === pa) break; top = p.id; }
    b = D.parentOf(app.doc, top) === pa ? top : idB;
    app.boolean(op, app.compound.smooth, app.compound.k, [a, b]);
    app.emit('tool');
  };

  // ── pointer ───────────────────────────────────────────────────────────────
  vp.addEventListener('contextmenu', e => e.preventDefault());
  vp.addEventListener('pointerdown', onDown);
  vp.addEventListener('pointermove', onMove);
  vp.addEventListener('pointerup', onUp);
  vp.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); if (act && act.type === 'gizmo') gizmoEnd(true); if (act && act.type !== 'create') act = null; });
  vp.addEventListener('pointerleave', () => { if (!act) { app.hotSlot = null; if (app.hoverId || app.gizHover || app.cubeHover) { app.hoverId = null; app.gizHover = null; app.cubeHover = null; app.dirtyAll(); } } });
  vp.addEventListener('wheel', onWheel, { passive: false });

  function onDown(e) {
    const [x, y] = at(e);
    ptrs.set(e.pointerId, { x, y });
    try { vp.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    app.poke();
    if (ptrs.size === 2) {
      if (act && act.type === 'gizmo') gizmoEnd(true);
      if (act && act.type === 'create') createCancel();
      const [a, b] = [...ptrs.values()];
      const r = paneAt((a.x + b.x) / 2, (a.y + b.y) / 2) || app.rects[0];
      act = { type: 'pinch', r, mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    if (ptrs.size > 2) return;
    // a creation in its later steps takes the press wherever it lands
    if (act && act.type === 'create') { createPress(e, x, y); return; }
    const r = paneAt(x, y);
    if (!r) return;
    if (r.slot !== app.panes.active) { app.panes.active = r.slot; app.layoutKey = null; app.emit('panes'); }
    app.hotSlot = r.slot;
    const lx = x - r.x, ly = y - r.y, s = app.panes.slots[r.slot];
    const touch = e.pointerType === 'touch';
    if (s.mode === 'slice') { sliceDown(r, lx, ly, x, y, touch); return; }
    if (app.disp.cube) {
      const box = app.cubeBox(r);
      if (lx >= box.x && lx < box.x + box.size && ly >= box.y && ly < box.y + box.size) {
        act = { type: 'cube', r, x0: x, y0: y, last: [x, y], t0: performance.now(), moved: false };
        return;
      }
    }
    if (e.button === 1 || e.button === 2) { act = { type: 'pan', r, last: [x, y] }; return; }
    if (e.button === 0 && e.altKey) { act = { type: 'orbit', r, last: [x, y] }; return; }
    if (app.arm) { createDown(r, lx, ly, e); return; }
    const G = app.gizmoFor(r);
    const hid = G && GZ.hit(G, lx, ly, touch ? 2.4 : 1);
    if (hid) { gizmoBegin(r, G, hid, lx, ly); return; }
    act = { type: 'press', r, x0: x, y0: y, last: [x, y], lx, ly, e: { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }, touch };
  }

  function onMove(e) {
    const [x, y] = at(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x, y });
    if (!act) { hover(x, y, e); return; }
    app.poke();
    const r = act.r, s = r && app.panes.slots[r.slot];
    switch (act.type) {
      case 'press': {
        const d = Math.hypot(x - act.x0, y - act.y0);
        if (d < (act.touch ? 9 : 4)) return;
        // with Move armed, a drag that starts on the selected object moves it
        const id = app.tool === 'move' && app.sel.length && !act.e.shiftKey ? pickId(r, act.lx, act.ly) : null;
        if (id && (app.sel.includes(id) || app.sel.some(sid => D.isDescendant(app.doc, id, sid)))) {
          const G = app.gizmoFor(r);
          if (G) { gizmoBegin(r, G, 'c', act.lx, act.ly); return; }
        }
        // Shift: a click adds to the selection, a drag pans
        act = { type: act.e.shiftKey || (s.ortho && s.view !== 'user') ? 'pan' : 'orbit', r, last: act.last };
        onMove(e);
        return;
      }
      case 'orbit': {
        orbit(s.cam, x - act.last[0], y - act.last[1]);
        if (s.ortho) s.view = 'user';
        else if (s.view !== 'persp') s.view = 'persp';
        act.last = [x, y]; dirtyPane(r.slot); app.emit('cam');
        return;
      }
      case 'pan': pan(s.cam, app.projOf(r), x - act.last[0], y - act.last[1]); act.last = [x, y]; dirtyPane(r.slot); app.emit('cam'); return;
      case 'gizmo': gizmoMove(x - r.x, y - r.y); return;
      case 'create': createMove(x - r.x, y - r.y); return;
      case 'cube': {
        const held = performance.now() - act.t0 > 180;
        if (!act.moved && Math.hypot(x - act.x0, y - act.y0) < 4 && !held) return;
        if (!act.moved && Math.hypot(x - act.x0, y - act.y0) < 2) return;
        act.moved = true;
        orbit(s.cam, x - act.last[0], y - act.last[1]);
        if (s.ortho) s.view = 'user';
        act.last = [x, y]; dirtyPane(r.slot); app.emit('cam');
        return;
      }
      case 'pinch': {
        const ps = [...ptrs.values()];
        if (ps.length < 2) return;
        const mid = [(ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2], dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
        if (s.mode === 'slice') {
          const sc = r.h / (2 * app.slice.ext);
          app.slice.cu -= (mid[0] - act.mid[0]) / sc; app.slice.cv += (mid[1] - act.mid[1]) / sc;
          app.slice.ext = V.clamp(app.slice.ext * act.dist / Math.max(dist, 1), 0.2, 60);
        } else {
          pan(s.cam, app.projOf(r), mid[0] - act.mid[0], mid[1] - act.mid[1]);
          dolly(s.cam, app.projOf(r), mid[0] - r.x, mid[1] - r.y, act.dist / Math.max(dist, 1));
        }
        act.mid = mid; act.dist = dist; dirtyPane(r.slot); app.emit('cam');
        return;
      }
      case 'slice-origin': case 'slice-aim': case 'slice-pan': sliceMove(x - r.x, y - r.y, x, y); return;
    }
  }

  function onUp(e) {
    const [x, y] = at(e);
    ptrs.delete(e.pointerId);
    if (!act) return;
    app.poke();
    const r = act.r;
    switch (act.type) {
      case 'press': selectAt(r, act.lx, act.ly, act.e); act = null; return;
      case 'gizmo': gizmoEnd(false); return;
      case 'create': createRelease(e, x - r.x, y - r.y); return;
      case 'cube': {
        if (!act.moved) {
          const hit = VC.pick(app.cubeLayout(r), x - r.x, y - r.y);
          if (hit) snapView(r.slot, hit);
        }
        act = null; return;
      }
      case 'pinch': if (ptrs.size === 0) act = null; return;
      default: act = null;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const [x, y] = at(e), r = paneAt(x, y);
    if (!r) return;
    app.poke(); app.hotSlot = r.slot;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const f = Math.exp(V.clamp(dy, -200, 200) * (e.ctrlKey ? 0.006 : 0.0013));
    const s = app.panes.slots[r.slot];
    if (s.mode === 'slice') {
      const S = app.slice, sc = r.h / (2 * S.ext);
      const a = S.cu + (x - r.x - r.w / 2) / sc, b = S.cv - (y - r.y - r.h / 2) / sc;
      const ne = V.clamp(S.ext * f, 0.2, 60), k = ne / S.ext;
      S.cu = a + (S.cu - a) * k; S.cv = b + (S.cv - b) * k; S.ext = ne;
    } else dolly(s.cam, app.projOf(r), x - r.x, y - r.y, f);
    dirtyPane(r.slot); app.emit('cam');
  }

  function hover(x, y, e) {
    const r = paneAt(x, y);
    const prev = JSON.stringify([app.gizHover, app.cubeHover && app.cubeHover.dir, app.hoverId]);
    app.hotSlot = r ? r.slot : null;
    app.gizHover = null; app.cubeHover = null;
    if (r && e.pointerType !== 'touch') {
      const lx = x - r.x, ly = y - r.y, s = app.panes.slots[r.slot];
      if (s.mode !== 'slice') {
        const box = app.cubeBox(r);
        if (app.disp.cube && r.slot === app.panes.active && lx >= box.x && lx < box.x + box.size && ly >= box.y && ly < box.y + box.size) app.cubeHover = VC.pick(app.cubeLayout(r), lx, ly);
        const G = !app.arm && app.gizmoFor(r);
        const hid = G && GZ.hit(G, lx, ly);
        if (hid) app.gizHover = { slot: r.slot, id: hid };
        const now = performance.now();
        if (now - hoverT > 50 && !hid && !app.cubeHover) { hoverT = now; app.hoverId = pickId(r, lx, ly); }
      }
    }
    if (prev !== JSON.stringify([app.gizHover, app.cubeHover && app.cubeHover.dir, app.hoverId])) { app.ovDirty = true; if (r) dirtyPane(r.slot); }
  }

  // ── view cube ─────────────────────────────────────────────────────────────
  function snapView(slot, hit) {
    const s = app.panes.slots[slot], c = s.cam;
    const to = viewFromDir(hit.dir, c.yaw);
    const names = { '0,1,0': 'top', '0,-1,0': 'bottom', '0,0,1': 'front', '0,0,-1': 'back', '1,0,0': 'right', '-1,0,0': 'left' };
    const nm = names[hit.dir.join(',')];
    let dy = to.yaw - c.yaw; dy = ((dy + 540) % 360) - 180;
    const y0 = c.yaw, p0 = c.pitch, t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 260), k = t * t * (3 - 2 * t);
      c.yaw = y0 + dy * k; c.pitch = p0 + (to.pitch - p0) * k;
      dirtyPane(slot); app.poke(); app.emit('cam');
      if (t < 1) requestAnimationFrame(step);
      else if (s.ortho) { s.view = nm || 'user'; app.emit('panes'); }
    };
    step();
  }

  // ── gizmo ─────────────────────────────────────────────────────────────────
  function gizmoBegin(r, G, hid, lx, ly) {
    const S = GZ.begin(G, hid, lx, ly);
    if (!S) return;
    const nodes = app.selRoots().map(id => {
      const n = app.doc.nodes[id], PW = D.parentMatrix(app.doc, id), PL = V.m4linear(PW);
      const cols = [0, 1, 2].map(i => V.norm([PL[i * 3], PL[i * 3 + 1], PL[i * 3 + 2]]));
      return { id, pos: n.pos.slice(), rot: n.rot.slice(), scl: n.scl.slice(), PLi: V.m3inv(PL), PR: [...cols[0], ...cols[1], ...cols[2]], W: D.worldMatrix(app.doc, id) };
    });
    app.hist.begin('gizmo');
    act = { type: 'gizmo', r, S, nodes, hid };
    app.gizActive = { slot: r.slot, id: hid };
    app.ovDirty = true;
  }
  function gizmoMove(lx, ly) {
    const res = GZ.drag(act.S, lx, ly);
    const changes = [], prim = act.nodes[act.nodes.length - 1];
    let label = 'Move', lines = [];
    if (res.move) {
      let d = res.move;
      if (app.snap && prim) {
        const st = gridStep(act.r), p0 = [prim.W[12], prim.W[13], prim.W[14]];
        d = d.map((v, j) => Math.abs(v) > 1e-9 ? snapV(p0[j] + v, st) - p0[j] : 0);
      }
      // an axis the drag does not touch keeps its exact value
      for (const nd of act.nodes) { const dl = V.m3vec(nd.PLi, d); changes.push({ id: nd.id, path: 'pos', value: nd.pos.map((v, j) => (Math.abs(dl[j]) < 1e-12 ? v : v + dl[j])) }); }
      const wp = prim ? V.add([prim.W[12], prim.W[13], prim.W[14]], d) : d;
      lines = [['X', wp[0].toFixed(3)], ['Y', wp[1].toFixed(3)], ['Z', wp[2].toFixed(3)]];
    } else if (res.rot) {
      label = 'Rotate';
      let ang = res.rot.angle;
      if (app.snap) ang = snapV(ang, 15 * V.DEG);
      for (const nd of act.nodes) {
        if (ang === 0) { changes.push({ id: nd.id, path: 'rot', value: nd.rot.slice() }); continue; }
        const Rd = V.axisAngleM3(res.rot.axis, ang);
        const R = V.m3mul(V.m3T(nd.PR), V.m3mul(Rd, V.m3mul(nd.PR, V.eulerToM3(nd.rot))));
        changes.push({ id: nd.id, path: 'rot', value: V.m3ToEuler(R).map(v => +v.toFixed(4)) });
      }
      lines = [['ANGLE', (ang / V.DEG).toFixed(1) + '°']];
    } else if (res.scale) {
      label = 'Scale';
      let f = res.scale;
      if (app.snap) f = f.map(v => Math.max(0.1, Math.round(v * 10) / 10));
      for (const nd of act.nodes) changes.push({ id: nd.id, path: 'scl', value: nd.scl.map((v, j) => +(v * f[j]).toFixed(6)) });
      lines = [['X', f[0].toFixed(3)], ['Y', f[1].toFixed(3)], ['Z', f[2].toFixed(3)]].filter((l, j) => act.S.h.kind !== 'axis' || j === act.S.h.i);
    }
    if (changes.length) app.setValues(changes, { label });
    const W = prim && D.worldMatrix(app.doc, prim.id);
    app.readout = W ? { at: [W[12], W[13], W[14]], lines, slot: act.r.slot } : null;
    app.ovDirty = true;
  }
  function gizmoEnd(cancel) {
    if (!act || act.type !== 'gizmo') return;
    if (cancel) {
      const ch = [];
      for (const nd of act.nodes) ch.push({ id: nd.id, path: 'pos', value: nd.pos }, { id: nd.id, path: 'rot', value: nd.rot }, { id: nd.id, path: 'scl', value: nd.scl });
      app.setValues(ch, { label: 'Cancel' });
    }
    app.hist.end();
    act = null; app.gizActive = null; app.readout = null; app.ovDirty = true;
    app.emit('doc');
  }

  // ── creation ──────────────────────────────────────────────────────────────
  // c: the creation state. step 0 is the first drag; later steps follow the
  // pointer (mouse: no button; touch: a drag) and a press or release commits.
  function planeHit(r, lx, ly, k, off = 0) {
    const P = app.projOf(r), ray = P.ray(lx, ly), n = PN.PLANE_NORMAL[k];
    const den = V.dot(ray.d, n);
    if (Math.abs(den) < 1e-5) return null;
    const t = (off - V.dot(ray.o, n)) / den;
    if (t < 0 && !P.ortho) return null;
    let p = V.add(ray.o, V.scale(ray.d, t));
    if (app.snap) { const st = gridStep(r) / 2; p = p.map((v, j) => (n[j] ? v : snapV(v, st))); }
    return p;
  }
  function createDown(r, lx, ly, e) {
    const type = app.arm, kind = D.PRIMS[type].create, s = app.panes.slots[r.slot];
    const k = PN.planeOf(s);
    const a = planeHit(r, lx, ly, k);
    if (!a) { app.toast('The construction plane is edge-on here. Orbit, or use another pane.'); return; }
    const before = D.toJSON(app.doc);
    const node = D.makePrim(app.doc, type, { rot: PLANE_ROT[k].slice() });
    D.addNode(app.doc, node);
    const n = PN.PLANE_NORMAL[k], U = PN.PLANE_U[k], Vv = PN.PLANE_V[k];
    const R = V.eulerToM3(node.rot);
    const c = { type: 'create', r, kind, prim: type, step: 0, a, k, n, U, V: Vv, id: node.id, before, R, touch: e.pointerType === 'touch', dragging: true, vals: {}, ref: [lx, ly] };
    act = c;
    if (kind === 'click') { node.pos = a.slice(); app.touch(); createFinish(); return; }
    shape(c, a);
    app.touch();
  }
  // the size along local X and Z of a footprint du along U and dv along V
  function footprint(c, du, dv) {
    const col = i => [c.R[i * 3], c.R[i * 3 + 1], c.R[i * 3 + 2]];
    const e = i => Math.abs(V.dot(col(i), c.U)) * du + Math.abs(V.dot(col(i), c.V)) * dv;
    return [e(0), e(2)];
  }
  // the height from pointer travel since the step began
  function heightFrom(c, lx, ly, base) {
    const P = app.projOf(c.r), p0 = P.project(base), p1 = P.project(V.add(base, c.n));
    const dx = lx - c.ref[0], dy = ly - c.ref[1];
    if (p0 && p1) {
      const v = [p1[0] - p0[0], p1[1] - p0[1]], L2 = v[0] * v[0] + v[1] * v[1];
      if (L2 > 64) return (dx * v[0] + dy * v[1]) / L2;
    }
    return -dy * P.worldPerPx(base);
  }
  const H0 = 0.02;
  // Write the node from the gesture so far. p: the current plane point.
  function shape(c, p, lx, ly) {
    const node = app.doc.nodes[c.id]; if (!node) return;
    const a = c.a, n = c.n, v = c.vals, lines = [];
    const st = app.snap ? gridStep(c.r) / 2 : 0;
    const q = x => Math.max(0.005, st ? Math.max(st, snapV(x, st)) : x);
    const circle = (ctr, rad) => { const pts = []; for (let i = 0; i <= 64; i++) { const t = i / 64 * Math.PI * 2; pts.push(V.add(ctr, V.add(V.scale(c.U, Math.cos(t) * rad), V.scale(c.V, Math.sin(t) * rad)))); } return pts; };
    let read = [], anchor = p;
    if (c.step === 0) {
      if (c.kind === 'boxfoot') {
        const du = V.dot(V.sub(p, a), c.U), dv = V.dot(V.sub(p, a), c.V);
        v.du = du; v.dv = dv;
        v.foot = V.add(a, V.add(V.scale(c.U, du / 2), V.scale(c.V, dv / 2)));
        const [ex, ez] = footprint(c, q(Math.abs(du)), q(Math.abs(dv)));
        v.ex = ex; v.ez = ez; v.h = Math.max(H0, 0.04 * Math.min(ex, ez));
        const cs = [[0, 0], [du, 0], [du, dv], [0, dv], [0, 0]].map(([s, t]) => V.add(a, V.add(V.scale(c.U, s), V.scale(c.V, t))));
        lines.push(cs);
        read = [['L', q(Math.abs(du)).toFixed(3)], ['W', q(Math.abs(dv)).toFixed(3)]];
      } else {
        v.raw = V.len(V.sub(p, a));
        v.R = q(v.raw);
        lines.push(circle(a, v.R), [a, p]);
        read = [[c.kind === 'radius' && c.prim === 'octa' ? 'S' : 'R', v.R.toFixed(3)]];
        if (c.kind === 'torus') v.r = Math.max(0.01, v.R * 0.12);
        if (c.kind === 'cone') v.h = Math.max(H0, v.R * 0.05);
        if (c.kind === 'radiusH') v.h = c.prim === 'capsule' ? 2 * v.R : Math.max(H0, v.R * 0.05);
        if (c.kind === 'link') v.H = 2 * (v.R + v.R * 0.25);
      }
    } else if (c.step === 1) {
      const base = c.kind === 'boxfoot' ? v.foot : a;
      if (c.kind === 'torus') {
        v.r = q(Math.abs(V.len(V.sub(p, a)) - v.R));
        lines.push(circle(a, v.R));
        read = [['R2', v.r.toFixed(3)]];
      } else {
        const h = q(Math.abs(heightFrom(c, lx, ly, base)));
        if (c.kind === 'link') v.H = Math.max(2 * (v.R + v.R * 0.25), h); else v.h = h;
        lines.push([base, V.add(base, V.scale(n, c.kind === 'link' ? v.H : v.h))]);
        read = [['H', (c.kind === 'link' ? v.H : v.h).toFixed(3)]];
        anchor = V.add(base, V.scale(n, c.kind === 'link' ? v.H : v.h));
      }
    } else if (c.step === 2 && c.kind === 'cone') {
      const top = V.add(a, V.scale(n, v.h));
      const p2 = planeHit(c.r, lx, ly, c.k, V.dot(top, n)) || top;
      v.r2 = Math.max(0, V.len(V.sub(p2, top)));
      if (st) v.r2 = snapV(v.r2, st);
      lines.push(circle(top, v.r2), [top, p2]);
      read = [['R2', v.r2.toFixed(3)]];
      anchor = p2;
    }
    // write the parameters and the position: on the plane, centre at half height
    const P = node.p, up = h => V.add(c.kind === 'boxfoot' ? v.foot : a, V.scale(n, h / 2));
    switch (c.prim) {
      case 'sphere': P.r = v.R; node.pos = up(2 * v.R); break;
      case 'octa': P.s = v.R; node.pos = up(2 * v.R); break;
      case 'box': P.w = v.ex; P.d = v.ez; P.h = v.h; node.pos = up(v.h); break;
      case 'roundbox': P.w = v.ex; P.d = v.ez; P.h = v.h; P.r = 0.08 * Math.min(v.ex, v.ez, Math.max(v.h, 0.2)); node.pos = up(v.h); break;
      case 'ellipsoid': P.rx = v.ex / 2; P.rz = v.ez / 2; P.ry = Math.max(0.01, v.h / 2); node.pos = up(v.h); break;
      case 'cylinder': case 'hexprism': P.r = v.R; P.h = v.h; node.pos = up(v.h); break;
      case 'capsule': P.r = v.R; P.h = Math.max(0, v.h - 2 * v.R); node.pos = up(Math.max(v.h, 2 * v.R)); break;
      case 'cone': P.r1 = v.R; P.h = v.h; P.r2 = c.step >= 2 ? v.r2 : Math.min(v.R * 0.25, P.r2); node.pos = up(v.h); break;
      case 'torus': P.R = v.R; P.r = v.r; node.pos = up(2 * v.r); break;
      case 'link': P.R = v.R * 0.8; P.r = v.R * 0.2; P.le = Math.max(0, v.H / 2 - P.R - P.r); node.pos = up(v.H); break;
    }
    app.preview = { lines };
    app.readout = read.length ? { at: anchor, lines: read, slot: c.r.slot } : null;
    app.ovDirty = true;
  }
  const STEPS = { radius: 1, boxfoot: 2, radiusH: 2, cone: 3, torus: 2, link: 2, click: 1 };
  function createMove(lx, ly) {
    const c = act;
    if (c.step === 0 && !c.dragging) return;
    if (c.step > 0 && c.touch && !c.dragging) return;
    const p = planeHit(c.r, lx, ly, c.k) || c.a;
    shape(c, p, lx, ly);
    app.touch();
  }
  function createRelease(e, lx, ly) {
    const c = act;
    if (c.step === 0) {
      c.dragging = false;
      const tiny = c.kind === 'boxfoot' ? Math.min(Math.abs(c.vals.du || 0), Math.abs(c.vals.dv || 0)) < 1e-3 : (c.vals.raw || 0) < 1e-3;
      if (tiny) { createCancel(); return; }
      advance(lx, ly);
    } else if (c.touch && c.dragging) { c.dragging = false; advance(lx, ly); }
  }
  // A press during a later step: mouse commits the step; touch starts its drag.
  function createPress(e, x, y) {
    const c = act, lx = x - c.r.x, ly = y - c.r.y;
    if (e.button === 2) { createCancel(); return; }
    if (c.touch || e.pointerType === 'touch') { c.touch = true; c.dragging = true; c.ref = [lx, ly]; return; }
    advance(lx, ly);
  }
  function advance(lx, ly) {
    const c = act;
    c.step++;
    c.ref = [lx, ly];
    if (c.step >= STEPS[c.kind]) { createFinish(); return; }
    app.toast(c.kind === 'torus' ? 'Move off the ring for the tube radius, then click' : c.step === 2 ? 'Move for the top radius, then click' : (c.touch ? 'Drag up for the height' : 'Move up for the height, then click'));
  }
  function createFinish() {
    const c = act; act = null;
    app.preview = null; app.readout = null;
    // sizes and the position to 0.001, the precision the panel shows
    const node = app.doc.nodes[c.id];
    if (node) {
      for (const k of Object.keys(node.p)) node.p[k] = +node.p[k].toFixed(3);
      node.pos = node.pos.map(v => +v.toFixed(3));
    }
    const after = D.toJSON(app.doc);
    app.hist.push({ kind: 'doc', label: 'Create ' + D.PRIMS[c.prim].label, before: c.before, after });
    app.touch();
    app.select([c.id]);
  }
  function createCancel() {
    const c = act; act = null;
    if (c && app.doc.nodes[c.id]) D.removeNode(app.doc, c.id);
    app.preview = null; app.readout = null;
    app.touch();
  }
  app.cancelGesture = () => {
    if (act && act.type === 'create') { createCancel(); return true; }
    if (act && act.type === 'gizmo') { gizmoEnd(true); return true; }
    return false;
  };

  // ── the SLICE pane ────────────────────────────────────────────────────────
  function sliceDown(r, lx, ly, x, y, touch) {
    const g = app.sliceGeo;
    const tol = touch ? 26 : 13;
    if (g && g.slot === r.slot && Math.hypot(lx - g.origin[0], ly - g.origin[1]) < tol) act = { type: 'slice-origin', r };
    else if (g && g.slot === r.slot && Math.hypot(lx - g.aim[0], ly - g.aim[1]) < tol + 6) act = { type: 'slice-aim', r };
    else act = { type: 'slice-pan', r, last: [x, y], x0: x, y0: y };
  }
  function sliceMove(lx, ly, x, y) {
    const S = app.slice, r = act.r, sc = r.h / (2 * S.ext);
    const a = S.cu + (lx - r.w / 2) / sc, b = S.cv - (ly - r.h / 2) / sc;
    if (act.type === 'slice-origin') S.ray.o = [a, b];
    else if (act.type === 'slice-aim') S.ray.a = Math.atan2(b - S.ray.o[1], a - S.ray.o[0]);
    else { S.cu -= (x - act.last[0]) / sc; S.cv += (y - act.last[1]) / sc; act.last = [x, y]; }
    app.dirtyAll();
  }

  // ── keyboard ──────────────────────────────────────────────────────────────
  addEventListener('keydown', onKey);
  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    const done = () => { e.preventDefault(); app.poke(); };
    if (mod) {
      if (k === 'z') { done(); e.shiftKey ? app.redo() : app.undo(); }
      else if (k === 'y') { done(); app.redo(); }
      else if (k === 'd') { done(); app.duplicateSel(); }
      else if (k === 'g') { done(); if (e.shiftKey) app.ungroupSel(); else if (app.selRoots().length > 1) app.boolean('union', false, 0.3); }
      else if (k === 's') { done(); import('./files.js').then(F => F.saveJSON(app)); }
      else if (k === 'o') { done(); $('fileIn').click(); }
      return;
    }
    const slot = app.panes.active, s = app.panes.slots[slot];
    if (e.altKey && (k === 'w' || e.code === 'KeyW')) { done(); app.toggleMax(); return; }
    if (e.altKey) return;
    const NUMPAD = { Numpad1: 'front', Numpad2: 'top', Numpad3: 'right', Numpad4: 'iso', Numpad6: 'back', Numpad7: 'bottom', Numpad8: 'left' };
    if (NUMPAD[e.code]) { done(); app.setPaneView(slot, NUMPAD[e.code]); return; }
    switch (k) {
      case 'q': done(); app.setTool('select'); break;
      case 'w': done(); app.setTool('move'); break;
      case 'e': done(); app.setTool('rotate'); break;
      case 'r': done(); app.setTool('scale'); break;
      case 't': done(); app.setPaneView(slot, 'top'); break;
      case 'f': done(); app.setPaneView(slot, 'front'); break;
      case 'l': done(); app.setPaneView(slot, 'left'); break;
      case 'p': done(); app.setPaneView(slot, 'persp'); s.ortho = false; app.dirtyAll(); break;
      case 'z': done(); if (e.shiftKey) app.frameAll(); else app.frameSelected(); break;
      case 's': done(); app.snap = !app.snap; app.toast(app.snap ? 'Snap on' : 'Snap off'); app.emit('tool'); break;
      case 'g': done(); app.disp.grid = !app.disp.grid; app.dirtyAll(); app.emit('tool'); break;
      case 'x': done(); app.coord = app.coord === 'world' ? 'local' : 'world'; app.ovDirty = true; app.emit('tool'); break;
      case 'h': done(); app.toggleHide(); break;
      case 'd': if (e.shiftKey) { done(); app.duplicateSel(); } break;
      case 'delete': case 'backspace': done(); app.deleteSel(); break;
      case 'escape':
        done();
        if (app.cancelGesture()) break;
        if (app.arm || app.pick) { app.arm = null; app.pick = null; app.emit('tool'); }
        else if (app.sel.length) app.select([]);
        else app.closeLastPanel();
        app.ovDirty = true;
        break;
      default:
        if (/^[1-6]$/.test(k)) { done(); app.setPaneMode(slot, PN.MODES[+k - 1]); }
    }
  }
  void basis;
}
