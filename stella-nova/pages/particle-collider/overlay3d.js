// ============================================================================
//  PARTICLE COLLIDER  ·  overlay3d.js — labels and the focus halo in 3D
// ----------------------------------------------------------------------------
//  A 2D canvas over the WebGL canvas of the 3D view. Each frame it projects
//  the objects of the event (picking.js) through the 3D camera and draws:
//    beams ..... before the crossing, the name and energy of each beam
//                particle next to its bunch
//    labels .... each product where it enters the detector (entryPoint):
//                a colour swatch from the legend, the name with its charge
//                (mu-, e+, ...) and pT; a leader line to the anchor and a
//                short ring that flashes when the particle arrives. The
//                labels.js placer keeps them apart; each label first tries
//                its last offset, so the labels stay still while the camera
//                orbits. Density: o.labels, the same 'hard' | 'all' | 'off'
//                setting as the 2D views.
//    focus ..... the hovered or selected object: a halo along its path (a
//                wide soft stroke in its colour) and a ring with a slow
//                pulse at its entry point. The trails of its cascade are
//                brightened on the GPU (display.js setCascade).
//
//  createOverlay3D(canvas) -> ov
//    ov.draw(ev, t, project, o)  project(x, y, z) -> [sx, sy] | null (CSS px)
//      o: { focus, focusSet, labels, bounds {x, y, w, h}, reserved [], small }
//    ov.placed ................... the label boxes of the last frame
//    ov.hitLabel(x, y) ........... the object key of a label under a point
//
//  GREP MAP  function labelItems · function drawFocus · ov.draw
// ============================================================================
import { place } from './labels.js';
import { entryPoint } from './picking.js';
import { PART, CLASS_COLOR } from './particles.js';

const C_MM = 299.792458;
const nameOf = n => (PART[n] && PART[n].label) || n;
const gev = v => (v / 1000).toFixed(v < 10000 ? 1 : 0);

export function createOverlay3D(canvas) {
  const g = canvas.getContext('2d');
  const ov = { placed: [] };
  const last = new Map();   // key -> { ox, oy }: the label offset of the last frame

  function labelItems(ev, t, project, mode, small) {
    const out = []; if (mode === 'off') return out;
    const c0 = project(...(ev.info.vertex || [0, 0, 0]).slice(0, 3)) || [0, 0];
    g.font = `500 ${small ? 10 : 11}px "Space Grotesk", system-ui, sans-serif`;
    for (const o of ev.objs.objs) {
      let txt = null, hard = false, cls = o.cls;
      if (o.kind === 'jet') { txt = `jet  ${gev(o.pT)} GeV`; hard = true; }
      else if (o.kind === 'met') { txt = `MET  ${gev(o.pT)} GeV · ν`; hard = true; cls = 'nu'; }
      else if (o.kind === 'track') {
        const isHard = o.hard && o.name !== 'nu';
        if (!(isHard || (mode === 'all' && o.pT > 2000 && !String(o.T.primary).startsWith('pu')))) continue;
        txt = `${nameOf(o.name)}  ${gev(o.pT)} GeV`; hard = isHard;
      } else continue;
      const p = entryPoint(o); if (!p || p[3] > t) continue;
      const s = project(p[0], p[1], p[2]); if (!s) continue;
      let dx = s[0] - c0[0], dy = s[1] - c0[1]; const L = Math.hypot(dx, dy);
      if (L < 3) { dx = 1; dy = 0; } else { dx /= L; dy /= L; }
      const w = g.measureText(txt).width + 22;
      out.push({ x: s[0], y: s[1], dx, dy, w, h: small ? 16 : 18, prio: o.pT || 0, hard, txt, cls, key: o.key, age: t - p[3], soft: !hard, pref: last.get(o.key) });
    }
    return out;
  }

  function drawFocus(o, t, project) {
    const col = CLASS_COLOR[o.cls] || (o.kind === 'jet' ? '#ffd45c' : '#9fd0ff');
    // the halo along the path drawn so far
    if (o.kind === 'track' || o.kind === 'met' || o.kind === 'jet') {
      const pts = []; for (const q of o.pts) { if (q[3] > t && pts.length) break; const s = project(q[0], q[1], q[2]); if (s) pts.push(s); }
      if (pts.length > 1) {
        g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = col;
        for (const [w, a] of [[14, 0.07], [7, 0.14], [2.5, 0.5]]) { g.lineWidth = w; g.globalAlpha = a; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.stroke(); }
        g.globalAlpha = 1;
      }
    }
    const p = o.kind === 'collision' || o.kind === 'muhit' || o.kind === 'vertex' || o.kind === 'tower' ? o.pts[0] : entryPoint(o);
    if (!p || p[3] > t + 1e-6) return;
    const s = project(p[0], p[1], p[2]); if (!s) return;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    const gr = g.createRadialGradient(s[0], s[1], 0, s[0], s[1], 22);
    gr.addColorStop(0, 'rgba(255,255,255,0.20)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(s[0], s[1], 22, 0, 6.2832); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5; g.beginPath(); g.arc(s[0], s[1], 9, 0, 6.2832); g.stroke();
    g.strokeStyle = col; g.globalAlpha = 0.35 + 0.4 * pulse; g.lineWidth = 1; g.beginPath(); g.arc(s[0], s[1], 13 + 3 * pulse, 0, 6.2832); g.stroke(); g.globalAlpha = 1;
  }

  ov.draw = (ev, t, project, o = {}) => {
    const w = canvas.clientWidth, h = canvas.clientHeight, d = Math.min(2, devicePixelRatio || 1);
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    ov.placed = [];
    if (!ev) return;
    const small = !!o.small, fs = o.focusSet || null;
    // the incoming beam particles, named, until just after the crossing
    if (t < 0.5 && ev.info.beams) {
      const v = ev.info.vertex || [0, 0, 0];
      g.font = `500 ${small ? 11 : 12}px "Space Grotesk", system-ui, sans-serif`; g.textBaseline = 'middle';
      ev.info.beams.forEach((nm, i) => {
        const sg = i ? 1 : -1, s = project(0, 0, v[2] - sg * C_MM * Math.min(0, t) - sg * 300); if (!s) return;
        const txt = `${nm} · ${((ev.info.sqrtS || 0) / 2e6).toPrecision(3)} TeV`, tw = g.measureText(txt).width + 12;
        const x = Math.max(4, Math.min(w - tw - 4, s[0] - tw / 2)), y = Math.max(12, s[1] - 22);
        g.globalAlpha = Math.min(1, (0.5 - t) / 0.4);
        g.fillStyle = 'rgba(5,7,12,0.72)'; g.fillRect(x, y - 9, tw, 18);
        g.fillStyle = i ? '#9fd0ff' : '#ffb08a'; g.fillText(txt, x + 6, y + 0.5);
        g.globalAlpha = 1;
      });
    }
    if (o.focus) drawFocus(o.focus, t, project);
    const items = labelItems(ev, t, project, o.labels || 'hard', small);
    const B = o.bounds || { x: 4, y: 4, w: w - 8, h: h - 8 };
    const placed = place(items, B, o.reserved || []);
    last.clear();
    g.font = `500 ${small ? 10 : 11}px "Space Grotesk", system-ui, sans-serif`; g.textBaseline = 'middle';
    for (const L of placed) {
      const it = L.item, col = CLASS_COLOR[it.cls] || '#ffd45c';
      last.set(it.key, { ox: L.x - it.x, oy: L.y - it.y });
      const fade = Math.min(1, Math.max(0, it.age / 0.5)) * (it.soft ? 0.65 : 1) * (fs ? (fs.has(it.key) ? 1 : 0.3) : 1);
      // the arrival: a ring that opens and fades at the entry point
      if (it.age < 1.2) { const a = it.age / 1.2; g.globalAlpha = (1 - a) * 0.9; g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.arc(it.x, it.y, 3 + 14 * a, 0, 6.2832); g.stroke(); }
      g.globalAlpha = fade;
      const lx = L.x + (it.dx >= 0 ? 0 : L.w), ly = L.y + L.h / 2;
      g.fillStyle = col; g.beginPath(); g.arc(it.x, it.y, 2, 0, 6.2832); g.fill();
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(it.x, it.y); g.lineTo(lx, ly); g.stroke();
      g.fillStyle = 'rgba(5,7,12,0.8)'; g.fillRect(L.x, L.y, L.w, L.h);
      g.globalAlpha = fade * 0.55; g.strokeRect(L.x + 0.5, L.y + 0.5, L.w - 1, L.h - 1); g.globalAlpha = fade;
      g.fillStyle = col; g.fillRect(L.x + 5, ly - 1.5, 9, 3);
      g.fillStyle = '#eef2fb'; g.fillText(it.txt, L.x + 18, ly + 0.5);
    }
    g.globalAlpha = 1;
    ov.placed = placed;
  };
  ov.hitLabel = (x, y) => { for (const L of ov.placed) if (x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h) return L.item.key; return null; };
  ov.clear = () => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); ov.placed = []; };
  return ov;
}
