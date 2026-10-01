// ============================================================================
//  MATERIAL STUDIO  ·  editor/node-draw.js — one node on the canvas
// ────────────────────────────────────────────────────────────────────────────
//  Draws a node in graph space from its layout (layout.js): body, header,
//  badge, title, thumbnail, port rows and inline param widgets. A reroute
//  node is one dot. The level of detail drops with the zoom: under 42% no
//  text in rows, under 22% no title. During a wire drag each port shows if
//  it can take the wire.
//
//  GREP TARGETS
//      drawNode ..... body, header, badge, title, preview, rows
//      drawParam .... slider, int, color, enum, bool and vec2 widgets
//      drawPort ..... a port dot ('ok' ring, 'off' dim, 'hot' large)
//      portState .... a port state during a wire drag
// ============================================================================
import * as G from '../graph.js';
import { state } from '../store.js';
import { cx, view, C, catColor, typeColor, FONT, MONO, HEAD, ROW, RR, PORT_R } from './state.js';
import { sel } from './selection.js';
import { drag, hover } from './pointer.js';
import { thumbFor, errors } from './thumbs.js';
import { fitText, checkerPattern, roundRect } from './paint.js';
import { fmtNum, fmtDefault, hexOk } from './params.js';

function drawPort(x, y, type, linked, state0) {
  const r = PORT_R;
  if (state0 === 'off') cx.globalAlpha = 0.18;
  cx.beginPath(); cx.arc(x, y, state0 === 'hot' ? r + 2 : r, 0, Math.PI * 2);
  cx.fillStyle = linked || state0 === 'hot' ? typeColor(type) : C.node;
  cx.fill();
  cx.lineWidth = 1.5; cx.strokeStyle = typeColor(type); cx.stroke();
  if (state0 === 'ok') { cx.beginPath(); cx.arc(x, y, r + 3.5, 0, Math.PI * 2); cx.lineWidth = 1; cx.strokeStyle = typeColor(type) + 'aa'; cx.stroke(); }
  cx.globalAlpha = 1;
}

/** Port state during a wire drag: 'ok' (compatible), 'off', 'hot' (snap target) or ''. */
function portState(node, side, pid) {
  if (drag?.mode !== 'wire') return '';
  const tgt = drag.target;
  if (tgt && tgt[0] === node.id && tgt[1] === pid && tgt[2] === side) return 'hot';
  const need = drag.dir === 'out' ? 'in' : 'out';
  if (side !== need) return 'off';
  return drag.okPorts?.has(node.id + '\u0000' + pid) ? 'ok' : 'off';
}

export function drawNode(n, L, linkedIn, linkedOut, linkTypes) {
  const s = view.s;
  const def = L.def;
  const g = state.graph;
  const isSel = sel.has(n.id);
  const isHover = hover && hover.id === n.id;
  const err = errors.get(n.id);
  const col = L.missing ? C.err : catColor(def?.category);
  if (L.reroute) {
    const t = G.portType(g, n.id, 'out', 'out');
    const c = t === 'any' ? '#8090b0' : typeColor(t);
    cx.beginPath(); cx.arc(n.x + RR / 2, n.y + RR / 2, 5.5, 0, Math.PI * 2);
    cx.fillStyle = c; cx.fill();
    if (isSel || isHover) { cx.lineWidth = 2 / s; cx.strokeStyle = isSel ? C.sel : C.bright; cx.stroke(); }
    if (drag?.mode === 'wire') {
      const st = portState(n, drag.dir === 'out' ? 'in' : 'out', drag.dir === 'out' ? 'in' : 'out');
      if (st === 'ok' || st === 'hot') { cx.beginPath(); cx.arc(n.x + RR / 2, n.y + RR / 2, 9, 0, Math.PI * 2); cx.lineWidth = 1.2 / s; cx.strokeStyle = c; cx.stroke(); }
    }
    return;
  }
  const w = L.w, h = L.h;
  // body
  if (isSel && s > 0.3) { cx.shadowColor = 'rgba(255,200,50,0.25)'; cx.shadowBlur = 12 * s; }
  cx.fillStyle = C.node; roundRect(n.x, n.y, w, h, 4); cx.fill();
  cx.shadowBlur = 0; cx.shadowColor = 'transparent';
  // header
  cx.fillStyle = C.nodeHead; roundRect(n.x, n.y, w, HEAD, n.collapsed ? 4 : [4, 4, 0, 0]); cx.fill();
  cx.fillStyle = col; cx.globalAlpha = 0.9; cx.fillRect(n.x, n.y + 3, 3, HEAD - 6); cx.globalAlpha = 0.14;
  roundRect(n.x, n.y, w, HEAD, n.collapsed ? 4 : [4, 4, 0, 0]); cx.fill(); cx.globalAlpha = 1;
  // border
  cx.lineWidth = (isSel || err ? 1.6 : 1) / s;
  cx.strokeStyle = err ? C.err : isSel ? C.sel : isHover ? C.borderHover : C.border;
  roundRect(n.x, n.y, w, h, 4); cx.stroke();
  const lod = s >= 0.42, lodLow = s >= 0.22;
  if (lodLow) {
    // collapse chevron + title + badges
    cx.fillStyle = C.dim; cx.beginPath();
    if (n.collapsed) { cx.moveTo(n.x + 8, n.y + 6); cx.lineTo(n.x + 12, n.y + 10); cx.lineTo(n.x + 8, n.y + 14); }
    else { cx.moveTo(n.x + 6, n.y + 8); cx.lineTo(n.x + 14, n.y + 8); cx.lineTo(n.x + 10, n.y + 12); }
    cx.fill();
    let badge = '';
    if (def?.pass) badge = 'PASS';
    if (def?.source === 'bench' || n.type.startsWith('bench.')) badge = 'BENCH';
    if (L.missing) badge = 'MISSING';
    cx.textBaseline = 'middle';
    let bw = 0;
    if (badge && lod) {
      cx.font = `500 8px ${MONO}`;
      bw = cx.measureText(badge).width + 6;
      cx.fillStyle = L.missing ? C.err : badge === 'BENCH' ? '#ff8a5c' : '#5a8cc0';
      cx.globalAlpha = 0.25; roundRect(n.x + w - bw - 5, n.y + 5, bw, 10, 2); cx.fill(); cx.globalAlpha = 1;
      cx.fillStyle = L.missing ? C.err : C.text; cx.fillText(badge, n.x + w - bw - 2, n.y + 10.5);
    }
    cx.font = `600 11px ${FONT}`; cx.fillStyle = C.bright;
    const title = n.label || (L.missing ? n.type : def?.label || n.type);
    cx.fillText(fitText(title, w - 24 - bw - 6), n.x + 18, n.y + HEAD / 2 + 0.5);
  }
  if (!n.collapsed) {
    // preview
    if (L.preview) {
      const p = L.preview;
      const t = thumbFor(n.id);
      cx.fillStyle = checkerPattern(); cx.fillRect(n.x + p.x, n.y + p.y, p.w, p.h);
      if (t?.img) {
        try { cx.imageSmoothingEnabled = true; cx.drawImage(t.img, n.x + p.x, n.y + p.y, p.w, p.h); } catch (e) { /* closed bitmap */ }
      } else if (lod) {
        cx.fillStyle = col; cx.globalAlpha = 0.12; cx.fillRect(n.x + p.x, n.y + p.y, p.w, p.h); cx.globalAlpha = 0.55;
        cx.font = `500 9px ${MONO}`; cx.textAlign = 'center'; cx.fillStyle = C.dim;
        cx.fillText(def?.pass ? 'pass' : 'no preview', n.x + p.x + p.w / 2, n.y + p.y + p.h / 2);
        cx.textAlign = 'left'; cx.globalAlpha = 1;
      }
      cx.lineWidth = 1 / s; cx.strokeStyle = C.border; cx.strokeRect(n.x + p.x, n.y + p.y, p.w, p.h);
    }
    // rows
    for (const r of L.rows) {
      const y = n.y + r.y, cy = y + ROW / 2;
      if (r.kind === 'out') {
        const t = linkTypes.get(n.id + '\u0000' + r.port.id) || r.port.type;
        if (lod) { cx.font = `400 10.5px ${FONT}`; cx.fillStyle = C.text; cx.textAlign = 'right'; cx.fillText(fitText(r.port.label || r.port.id, w - 20), n.x + w - 10, cy + 0.5); cx.textAlign = 'left'; }
        drawPort(n.x + w, cy, t, linkedOut.has(n.id + '\u0000' + r.port.id), portState(n, 'out', r.port.id));
      } else if (r.kind === 'in') {
        const linked = linkedIn.has(n.id + '\u0000' + r.port.id);
        if (lod) {
          cx.font = `400 10.5px ${FONT}`; cx.fillStyle = linked ? C.text : C.dim;
          cx.fillText(fitText(r.port.label || r.port.id, w - 70), n.x + 10, cy + 0.5);
          if (!linked && r.port.default !== undefined) {
            cx.font = `400 9.5px ${MONO}`; cx.fillStyle = C.faint; cx.textAlign = 'right';
            cx.fillText(fitText(fmtDefault(r.port.default), 56), n.x + w - 8, cy + 0.5); cx.textAlign = 'left';
          }
        }
        drawPort(n.x, cy, r.port.type, linked, portState(n, 'in', r.port.id));
      } else if (r.kind === 'param' && lod) drawParam(n, r, y, w);
    }
  } else {
    // collapsed: one port dot per side
    const ins = [...L.ins.values()], outs = [...L.outs.values()];
    if (ins.length) drawPort(n.x, n.y + HEAD / 2, ins.length === 1 ? ins[0].port.type : 'float', ins.some(p => linkedIn.has(n.id + '\u0000' + p.port.id)), '');
    if (outs.length) drawPort(n.x + w, n.y + HEAD / 2, outs.length === 1 ? outs[0].port.type : 'float', outs.some(p => linkedOut.has(n.id + '\u0000' + p.port.id)), '');
  }
}

function drawParam(n, r, y, w) {
  const p = r.p;
  const v = n.params[p.id] !== undefined ? n.params[p.id] : p.default;
  const x0 = n.x + 8, ww = w - 16, yy = y + 2, hh = ROW - 4;
  const hot = hover && hover.id === n.id && hover.kind === 'param' && hover.pid === p.id;
  const col = catColor(state.registry.get(n.type)?.category);
  cx.fillStyle = hot ? C.widgetHover : C.widget; roundRect(x0, yy, ww, hh, 2); cx.fill();
  cx.textBaseline = 'middle';
  const cy = yy + hh / 2 + 0.5;
  if (p.kind === 'slider' || p.kind === 'int') {
    const min = p.min ?? 0, max = p.max ?? 1;
    const f = Math.max(0, Math.min(1, ((+v) - min) / ((max - min) || 1)));
    cx.fillStyle = col; cx.globalAlpha = 0.3; cx.fillRect(x0, yy, ww * f, hh); cx.globalAlpha = 1;
    cx.font = `400 10px ${FONT}`; cx.fillStyle = C.text; cx.fillText(fitText(p.label, ww - 50), x0 + 5, cy);
    cx.font = `400 10px ${MONO}`; cx.fillStyle = C.bright; cx.textAlign = 'right'; cx.fillText(fmtNum(+v, p), x0 + ww - 5, cy); cx.textAlign = 'left';
  } else if (p.kind === 'color') {
    cx.font = `400 10px ${FONT}`; cx.fillStyle = C.text; cx.fillText(fitText(p.label, ww - 52), x0 + 5, cy);
    cx.fillStyle = hexOk(v) ? v : '#808080'; roundRect(x0 + ww - 42, yy + 2, 40, hh - 4, 2); cx.fill();
  } else if (p.kind === 'enum') {
    cx.font = `400 10px ${FONT}`; cx.fillStyle = C.dim; cx.fillText(fitText(p.label, ww * 0.45), x0 + 5, cy);
    const opt = (p.options || []).map(o => typeof o === 'string' ? { value: o, label: o } : o).find(o => o.value === v);
    cx.fillStyle = C.bright; cx.textAlign = 'right'; cx.fillText(fitText((opt?.label ?? String(v)) + ' ▾', ww * 0.55 - 6), x0 + ww - 5, cy); cx.textAlign = 'left';
  } else if (p.kind === 'bool') {
    cx.strokeStyle = C.dim; cx.lineWidth = 1 / view.s; cx.strokeRect(x0 + 4, yy + 3, hh - 6, hh - 6);
    if (v) { cx.fillStyle = col; cx.fillRect(x0 + 6, yy + 5, hh - 10, hh - 10); }
    cx.font = `400 10px ${FONT}`; cx.fillStyle = C.text; cx.fillText(fitText(p.label, ww - hh - 8), x0 + hh + 2, cy);
  } else if (p.kind === 'vec2') {
    const a = Array.isArray(v) ? v : [0, 0];
    const half = ww / 2;
    cx.font = `400 10px ${MONO}`; cx.fillStyle = C.bright;
    cx.fillText(fitText(`${p.label} x ${fmtNum(+a[0], p)}`, half - 8), x0 + 5, cy);
    cx.fillText(fitText(`y ${fmtNum(+a[1], p)}`, half - 8), x0 + half + 5, cy);
    cx.fillStyle = C.border; cx.fillRect(x0 + half, yy + 2, 1, hh - 4);
  }
}
