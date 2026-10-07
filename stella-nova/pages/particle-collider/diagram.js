// ============================================================================
//  PARTICLE COLLIDER  ·  diagram.js — the r-phi and r-z event diagrams
// ----------------------------------------------------------------------------
//  The main views of the page. Each diagram is two stacked canvases: a
//  light canvas (lightfield.js: the trails as branched light filaments)
//  and an overlay canvas (2D: outlines, the beam particles, the MET arrow,
//  jet cones, labels, the selection ring). Both draw at device pixel ratio.
//
//  VIEWS
//    'rphi'  the transverse plane: x right, y up, the beam out of the page
//    'rz'    the longitudinal plane: z right, r up for y > 0 and down for
//            y < 0 (signed r), the beams come in along z
//  zoom and pan: view.zoom (1 = the whole detector), view.cx, view.cy
//  (the world point at the centre, mm). The saver pushes in on the vertex.
//
//  WHAT IS DRAWN (grep -n 'function buildLight' / 'function drawOverlay')
//    light ... every segment the engine recorded, cut at the event time t,
//              with a hot head that fades to a steady tail (persistence),
//              shower segments and rays as fine forks; hits as small dots;
//              calorimeter towers as bars that grow out of the
//              calorimeter face; the two incoming beam particles (t < 0)
//              and the flash at t = 0
//    overlay . a quiet single-line outline of the layer radii (toggle),
//              the detector hardware as thin outlines (off by default),
//              jet cones, the MET arrow, labels with leader lines, the
//              ring round the selected object
//  SELECTION  setFocus({ hover, sel }): the focused object and its whole
//    cascade (the tracks whose ancestor chain holds it, or a jet's
//    constituents) brighten; the rest dims.
//  HIT TEST   view.hit(x, y, t): picking.js on this view's projection
//    (CSS px), with a cached projection per view version.
//
//  createDiagram(host, mode) -> view;  createLego(canvas) -> lego
//  GREP MAP  function createDiagram · function project · function buildLight
//            function drawOverlay · function labelItems · function createLego
// ============================================================================
import { createLight } from './lightfield.js';
import { CLASS_COLOR, PART } from './particles.js';
import { CLS } from './transport.js';
import { hitTest, atRadius } from './picking.js';
import { place } from './labels.js';
import { buildDetector } from './geometry.js';

const C_MM = 299.792458;
const lin = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map(v => Math.pow(v, 2.2)); };
const COL = Object.fromEntries(Object.entries(CLASS_COLOR).map(([k, v]) => [k, lin(v)]));
COL.jet = lin('#ffd45c'); COL.tower = lin('#ff9a5c'); COL.hit = lin('#bff3ff'); COL.muhit = lin('#ff86c0');
const LAYERS = [29, 68, 109, 160, 255, 339, 418, 498, 608, 692, 780, 868, 965, 1080];
const QUIET = [[22.5, 'beam pipe'], [1080, 'tracker'], [1290, 'ECAL'], [1770, 'HCAL'], [2980, 'solenoid'], [3500, 'muon stations'], [6450, '']];
const DET = buildDetector();
export const RMAX = 7400;
// a tower colour ramp (inferno-like, monotone in lightness), linear
const RAMP = [[0, [0.10, 0.03, 0.30]], [0.3, [0.58, 0.12, 0.45]], [0.6, [1.0, 0.42, 0.14]], [0.82, [1.0, 0.78, 0.30]], [1, [1.0, 0.98, 0.86]]];
export function ramp(u) { u = Math.max(0, Math.min(1, u)); for (let i = 1; i < RAMP.length; i++) if (u <= RAMP[i][0]) { const [a, A] = RAMP[i - 1], [b, B] = RAMP[i], k = (u - a) / (b - a); return A.map((v, j) => v + (B[j] - v) * k).map(v => Math.pow(v, 2.2)); } return [1, 1, 1]; }
const logU = (e, lo = 1000, hi = 300000) => Math.log(Math.max(lo, e) / lo) / Math.log(hi / lo);
const W = { mu: 2.1, e: 1.8, gamma: 1.3, had: 1.4, neu: 1.2, nu: 1, shower: 0.95 };
export const LABEL_OF = name => (PART[name] && PART[name].label) || name;

export function createDiagram(host, mode) {
  const lc = document.createElement('canvas'), oc = document.createElement('canvas');
  lc.className = 'lightc'; oc.className = 'overc';
  host.appendChild(lc); host.appendChild(oc);
  const light = createLight(lc), og = oc.getContext('2d');
  const V = { mode, zoom: 1.2, home: 1.2, cx: 0, cy: 0, w: 1, h: 1, dpr: 1, ver: 0, outline: true, hardware: false, labels: 'hard', ev: null, focus: null, focusSet: null, dimOthers: false, reserved: [] };
  let buf = new Float32Array(12 * 4096), cache = new Map(), lastKey = '';

  // world (mm) -> CSS px
  function project(x, y, z) {
    const s = Math.min(V.w, V.h) / (2 * RMAX) * V.zoom;
    if (mode === 'rphi') return [V.w / 2 + (x - V.cx) * s, V.h / 2 - (y - V.cy) * s];
    const r = Math.hypot(x, y) * (y >= 0 ? 1 : -1);
    return [V.w / 2 + (z - V.cx) * s, V.h / 2 - (r - V.cy) * s];
  }
  V.project = project;
  V.scale = () => Math.min(V.w, V.h) / (2 * RMAX) * V.zoom;
  function resize() {
    const r = V.forced || host.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    if (!r.width || !r.height) return false;
    if (r.width !== V.w || r.height !== V.h || d !== V.dpr) {
      V.w = r.width; V.h = r.height; V.dpr = d; V.ver++;
      light.resize(V.w * d, V.h * d);
      oc.width = Math.round(V.w * d); oc.height = Math.round(V.h * d);
    }
    return true;
  }
  V.resize = resize;
  const grow = n => { if (buf.length < n * 12) { const b = new Float32Array(n * 12 * 1.5 | 0); b.set(buf); buf = b; } };
  const level = (age, base) => base * (0.32 + 1.5 * Math.exp(-Math.max(0, age) / 0.75));

  // ── the light buffer for time t ──
  function buildLight(t) {
    const ev = V.ev, d = V.dpr; let n = 0;
    const push = (ax, ay, bx, by, c, w, b0, b1, drift) => {
      grow(n + 1); const k = n * 12;
      buf[k] = ax * d; buf[k + 1] = ay * d; buf[k + 2] = bx * d; buf[k + 3] = by * d;
      buf[k + 4] = c[0]; buf[k + 5] = c[1]; buf[k + 6] = c[2]; buf[k + 7] = w * d;
      buf[k + 8] = b0; buf[k + 9] = b1; buf[k + 10] = drift; n++;
    };
    if (!ev) return 0;
    const R = ev.R, S = R.seg, fs = V.focusSet, dim = fs ? 0.16 : 1;
    // the beams: two particles along the axis before the crossing
    if (t < 0.6) {
      const v = ev.info.vertex || [0, 0, 0, 0];
      for (const sg of [-1, 1]) {
        const zh = v[2] - sg * C_MM * Math.min(0, t), zt = zh + sg * 600;
        const a = project(0, 0.001, zt), b = project(0, 0.001, zh);
        const c = sg < 0 ? lin('#ff8a5c') : lin('#6ab8ff');
        if (mode === 'rz') push(a[0], a[1], b[0], b[1], c, 5, 0.1, 3.2, 0);
      }
    }
    // the flash at t = 0
    if (t > -0.05 && t < 1.6) { const v = ev.info.vertex || [0, 0, 0], p = project(v[0], v[1] || 0.001, v[2]), a = Math.exp(-Math.max(0, t) / 0.35) * 6; push(p[0], p[1], p[0] + 0.01, p[1], [1, 0.9, 0.75], 18, a, a, 0); }
    // pile-up vertices
    for (const w of (ev.info.vertices || []).slice(1)) if (t > w[3] && t < w[3] + 1.2) { const p = project(w[0], w[1] || 0.001, w[2]), a = Math.exp(-(t - w[3]) / 0.3) * 1.2; push(p[0], p[1], p[0] + 0.01, p[1], [1, 0.85, 0.7], 8, a, a, 0); }
    // segments
    for (let i = 0; i < R.nSeg; i++) {
      const k = i * 9, t0 = S[k + 3]; if (t0 > t) continue;
      const t1 = S[k + 7], f = t1 > t0 ? Math.min(1, (t - t0) / (t1 - t0)) : 1;
      const cls = CLS[R.segCls[i]];
      let ax, ay, bx, by;
      { const a = project(S[k], S[k + 1], S[k + 2]); ax = a[0]; ay = a[1]; }
      { const b = project(S[k] + (S[k + 4] - S[k]) * f, S[k + 1] + (S[k + 5] - S[k + 1]) * f, S[k + 2] + (S[k + 6] - S[k + 2]) * f); bx = b[0]; by = b[1]; }
      if (cls === 'shower' && Math.abs(bx - ax) + Math.abs(by - ay) < 0.35) continue;
      const E = S[k + 8];
      let base = cls === 'shower' ? 0.18 + 0.55 * Math.min(1, Math.log10(Math.max(1, E)) / 4.2) : cls === 'gamma' ? 0.55 : cls === 'neu' ? 0.4 : cls === 'mu' ? 1.25 : 0.95;
      if (fs) base *= fs.has(R.segTrk[i]) ? 2.0 : dim;
      push(ax, ay, bx, by, COL[cls] || COL.had, (W[cls] || 1.4) * (fs && fs.has(R.segTrk[i]) ? 1.5 : 1), level(t - t0, base), level(t - (t0 + (t1 - t0) * f), base), cls === 'shower' ? 1 : 0.35);
    }
    // silicon and muon hits
    const H = (h, c, wd, br) => { for (let i = 0; i < h.n; i++) { const tt = h.f[i * 6 + 3]; if (tt > t) continue; const p = project(h.f[i * 6], h.f[i * 6 + 1], h.f[i * 6 + 2]), a = br * (fs ? (fs.has(h.trk[i]) ? 2 : dim) : 1) * (0.5 + 2.5 * Math.exp(-(t - tt) / 0.4)); push(p[0], p[1], p[0] + 0.01, p[1], c, wd, a, a, 0); } };
    H(R.hits, COL.hit, 3, 0.35); H(R.mhits, COL.muhit, 5, 0.9);
    // towers: bars that grow out of the calorimeter face
    for (const o of ev.objs.objs) {
      if (o.kind !== 'tower' || t < o.t0) continue;
      const u = Math.min(1, (t - o.t0) / 1.6), e = u * u * (3 - 2 * u), a = project(...o.pts[0]), b0 = project(...o.pts[1]);
      const b = [a[0] + (b0[0] - a[0]) * e, a[1] + (b0[1] - a[1]) * e];
      const sel = fs ? (fs.has('w' + o.tower.c) ? 1.8 : dim) : 1;
      const wpx = Math.max(2, (mode === 'rphi' ? 1520 * 2 * Math.PI / 72 : 300) * V.scale() * 0.8);
      push(a[0], a[1], b[0], b[1], ramp(logU(o.pT)), Math.min(26, wpx), 0.9 * sel, (0.6 + 1.4 * (1 - e)) * sel, 0);
    }
    return n;
  }

  // ── labels: the objects worth naming, anchored where they enter ──
  function entry(o) {
    if (o.kind === 'jet') return o.pts[1].slice(0, 3).map(v => v * 1770 / 2950).concat([4]);
    if (o.kind === 'met') return o.pts[1];
    const rIn = o.name === 'gamma' ? 1290 : 300;
    return o.pts.find(q => Math.hypot(q[0], q[1]) >= rIn || Math.abs(q[2]) >= (o.name === 'gamma' ? 3000 : 900)) || o.pts[o.pts.length - 1];
  }
  function labelItems(t) {
    const ev = V.ev; if (!ev || V.labels === 'off') return [];
    const out = [], g = og;
    g.font = `500 ${11 * V.dpr}px "Space Grotesk", system-ui, sans-serif`;
    for (const o of ev.objs.objs) {
      let txt = null, hard = false, prio = o.pT || 0, cls = o.cls;
      if (o.kind === 'jet') { txt = `jet ${(o.pT / 1000).toFixed(0)} GeV`; hard = true; }
      else if (o.kind === 'met') { if (mode === 'rz') continue; txt = `MET ${(o.pT / 1000).toFixed(0)} GeV · ν`; hard = true; cls = 'nu'; }
      else if (o.kind === 'track') {
        const isHard = o.hard && o.name !== 'nu';
        if (!(isHard || (V.labels === 'all' && o.pT > 2000 && !o.T.primary.toString().startsWith('pu')))) continue;
        const q = PART[o.name] ? PART[o.name].q : 0;
        txt = `${LABEL_OF(o.name)} ${(o.pT / 1000).toFixed(o.pT < 10000 ? 1 : 0)} GeV`; hard = isHard; void q;
      } else continue;
      const p = entry(o); if (!p || p[3] > t) continue;
      const s = project(p[0], p[1], p[2]), c = project(0, 0, 0);
      if (s[0] < 0 || s[1] < 0 || s[0] > V.w || s[1] > V.h) continue;
      let dx = s[0] - c[0], dy = s[1] - c[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const wpx = g.measureText(txt).width / V.dpr + 12;
      out.push({ x: s[0], y: s[1], dx, dy, w: wpx, h: 17, prio, hard, txt, cls, key: o.key, age: t - p[3], soft: !hard });
    }
    return out;
  }

  // ── the overlay: outlines, MET, jets, labels, the selection ring ──
  function drawOverlay(g, t) {
    const d = V.dpr, ev = V.ev;
    g.save(); g.scale(d, d);
    g.clearRect(0, 0, V.w, V.h);
    const c0 = project(0, 0, 0), s = V.scale();
    // a quiet single-line outline of the layer radii
    if (V.outline || V.hardware) {
      g.lineWidth = 1; g.strokeStyle = 'rgba(150,170,210,0.13)';
      const rings = V.hardware ? [...LAYERS.map(r => [r, '']), ...QUIET, [1520, ''], [2950, ''], [3300, ''], [3750, ''], [4300, ''], [4350, ''], [4550, ''], [4600, ''], [5200, ''], [5250, ''], [5450, ''], [5500, ''], [6200, ''], [6250, '']] : QUIET;
      if (mode === 'rphi') for (const [r] of rings) { g.beginPath(); g.arc(c0[0], c0[1], r * s, 0, 6.2832); g.stroke(); }
      else {
        const box = (r0, r1, z0, z1) => { for (const sg of [1, -1]) { const a = project(0, sg * r0 || sg * 0.001, z0), b = project(0, sg * r1, z1); g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); } };
        if (V.hardware) { for (const v of DET.V) if (v.sys !== 'air' && v.sys !== 'vac' && v.sys !== 'hcalS') box(v.rmin, v.rmax, v.z0, v.z1); }
        else { box(22, 1100, -2800, 2800); box(1290, 1520, -2900, 2900); box(1770, 2950, -3300, 3300); box(3500, 6450, -5000, 5000); }
      }
      // the beam axis
      g.strokeStyle = 'rgba(120,160,255,0.22)'; g.beginPath();
      if (mode === 'rz') { g.moveTo(0, c0[1]); g.lineTo(V.w, c0[1]); } else { g.arc(c0[0], c0[1], 2, 0, 6.2832); }
      g.stroke();
    }
    if (!ev) { g.restore(); return; }
    const fs = V.focusSet;
    // jet cones (faint), MET arrow
    for (const o of ev.objs.objs) {
      if (o.kind === 'jet' && t > 1) {
        const k = fs ? (fs.has(o.key) ? 0.7 : 0.08) : 0.22;
        g.strokeStyle = `rgba(255,212,92,${k})`; g.lineWidth = 1; g.setLineDash([4, 4]);
        for (const sg of [-1, 1]) {
          const a = mode === 'rphi' ? atRadius(0, o.phi + sg * 0.4, 2950, 1e9) : atRadius(o.eta + sg * 0.4, o.phi, 2950, 4900);
          const p = project(a[0], a[1], a[2]); g.beginPath(); g.moveTo(c0[0], c0[1]); g.lineTo(p[0], p[1]); g.stroke();
        }
        g.setLineDash([]);
      }
      if (o.kind === 'met' && mode === 'rphi' && t > 8) {
        const a = Math.min(1, (t - 8) / 2), p = project(o.pts[1][0] * a, o.pts[1][1] * a, 0), k = fs ? (fs.has('met') ? 1 : 0.2) : 0.9;
        g.strokeStyle = `rgba(242,165,255,${k})`; g.lineWidth = 2.2; g.setLineDash([7, 4]); g.beginPath(); g.moveTo(c0[0], c0[1]); g.lineTo(p[0], p[1]); g.stroke(); g.setLineDash([]);
        const an = Math.atan2(p[1] - c0[1], p[0] - c0[0]); g.fillStyle = `rgba(242,165,255,${k})`; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] - 10 * Math.cos(an - 0.4), p[1] - 10 * Math.sin(an - 0.4)); g.lineTo(p[0] - 10 * Math.cos(an + 0.4), p[1] - 10 * Math.sin(an + 0.4)); g.fill();
      }
    }
    // the incoming beam particles, named
    if (mode === 'rz' && t < 0.4 && ev.info.beams) {
      const v = ev.info.vertex || [0, 0, 0];
      ev.info.beams.forEach((nm, i) => {
        const sg = i ? 1 : -1, p = project(0, 0.001, v[2] - sg * C_MM * Math.min(0, t));
        const txt = `${nm} · ${((ev.info.sqrtS || 0) / 2e6).toPrecision(3)} TeV`;
        g.font = '500 12px "Space Grotesk", system-ui, sans-serif';
        const wd = g.measureText(txt).width + 12, x = sg < 0 ? p[0] - wd - 10 : p[0] + 10;
        g.fillStyle = 'rgba(5,7,12,0.75)'; g.fillRect(x, p[1] - 26, wd, 18);
        g.fillStyle = i ? '#9fd0ff' : '#ffb08a'; g.fillText(txt, x + 6, p[1] - 13);
      });
    }
    // labels
    const items = labelItems(t), placed = place(items, { x: 4, y: 4, w: V.w - 8, h: V.h - 8 }, V.reserved);
    g.font = '500 11px "Space Grotesk", system-ui, sans-serif'; g.textBaseline = 'middle';
    for (const L of placed) {
      const it = L.item, col = CLASS_COLOR[it.cls] || '#ffd45c', fade = Math.min(1, Math.max(0, it.age / 0.5)) * (it.soft ? 0.6 : 1) * (fs ? (fs.has(it.key) ? 1 : 0.35) : 1);
      g.globalAlpha = fade;
      const lx = L.x + (it.dx >= 0 ? 0 : L.w), ly = L.y + L.h / 2;
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(it.x, it.y); g.lineTo(lx, ly); g.stroke();
      g.fillStyle = 'rgba(5,7,12,0.78)'; g.fillRect(L.x, L.y, L.w, L.h);
      g.strokeStyle = col; g.globalAlpha = fade * 0.55; g.strokeRect(L.x + 0.5, L.y + 0.5, L.w - 1, L.h - 1); g.globalAlpha = fade;
      g.fillStyle = col; g.fillRect(L.x + 4, ly - 1, 3, 3);
      g.fillStyle = '#eef2fb'; g.fillText(it.txt, L.x + 10, ly + 0.5);
    }
    g.globalAlpha = 1;
    V.placed = placed;
    // the focused object: a ring at its entry point
    if (V.focus) {
      const o = V.focus, p = o.kind === 'collision' ? o.pts[0] : (o.kind === 'muhit' || o.kind === 'vertex' ? o.pts[0] : entry(o));
      if (p && p[3] <= t + 1e-6) { const q = project(p[0], p[1], p[2]); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5; g.beginPath(); g.arc(q[0], q[1], 9, 0, 6.2832); g.stroke(); }
    }
    g.restore();
  }

  V.setEvent = ev => { V.ev = ev; V.ver++; cache = new Map(); };
  V.setFocus = (obj, set) => { V.focus = obj; V.focusSet = set; };
  V.render = (t, force) => {
    if (!resize()) return;
    const key = `${t.toFixed(4)}|${V.ver}|${V.zoom}|${V.cx}|${V.cy}|${V.focus ? V.focus.key : ''}|${V.labels}|${V.outline}|${V.hardware}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const n = buildLight(t);
    // many overlapping filaments: lower the gain so they stay filaments, not fog
    const gain = Math.max(0.3, Math.min(1, Math.sqrt(9000 / Math.max(1, n))));
    light.draw(buf, n, { gain, K: 1.15, glow: 0.75, bg: [0.0002, 0.0003, 0.0006] });   // near black: a lighter field reads grey after the gamma
    drawOverlay(og, t);
  };
  V.invalidate = () => { lastKey = ''; V.ver++; cache = new Map(); };
  // compose into another canvas (the saver): light, then the overlay
  V.renderInto = (g, x, y, w, h, t) => {
    V.forced = { width: w, height: h };
    V.render(t, true);
    V.forced = null;
    g.drawImage(lc, x, y, w, h); g.drawImage(oc, x, y, w, h);
  };
  V.hit = (x, y, t, tol = 7) => {
    if (!V.ev) return null;
    if (cache.ver !== V.ver) { cache = new Map(); cache.ver = V.ver; }
    const h = hitTest(V.ev.objs.objs, project, x, y, tol, t, cache, o => !(o.kind === 'met' && mode === 'rz'));
    if (h) return h.obj;
    // a label hit selects its object
    for (const L of V.placed || []) if (x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h) return V.ev.objs.byKey.get(L.item.key);
    return null;
  };
  V.canvases = [lc, oc];
  return V;
}

// ── the eta-phi tower map (lego) ─────────────────────────────────────────
export function createLego(canvas) {
  const L = { ev: null, focusSet: null, bars: [] };
  const EM = '#ff8a5c', HAD = '#6aaeff';
  L.render = t => {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    const d = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const g = canvas.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const W2 = r.width, H2 = r.height, ox = W2 * 0.53, oy = H2 * 0.86, ax = [W2 * 0.36 / 6, -H2 * 0.10 / 6], ay = [-W2 * 0.30 / 6.2832, -H2 * 0.28 / 6.2832];
    const P = (eta, ph, z = 0) => [ox + eta * ax[0] + ph * ay[0], oy + eta * ax[1] + ph * ay[1] - z];
    g.strokeStyle = 'rgba(160,170,200,0.16)'; g.lineWidth = 0.7;
    for (let e = -3; e <= 3; e++) { const [a, b] = P(e, 0), [c, q] = P(e, 6.2832); g.beginPath(); g.moveTo(a, b); g.lineTo(c, q); g.stroke(); }
    for (let k = 0; k <= 4; k++) { const ph = k * Math.PI / 2, [a, b] = P(-3, ph), [c, q] = P(3, ph); g.beginPath(); g.moveTo(a, b); g.lineTo(c, q); g.stroke(); }
    g.font = '10px "IBM Plex Mono", ui-monospace, monospace'; g.fillStyle = '#8a90a6';
    g.fillText('η', P(3.2, 0)[0], P(3.2, 0)[1] + 4); g.fillText('φ', P(-3, 6.2832)[0] - 12, P(-3, 6.2832)[1]);
    // the colour key, lower right (the view header holds the top left)
    g.fillStyle = EM; g.fillRect(W2 - 118, H2 - 18, 8, 8); g.fillStyle = '#c7cede'; g.fillText('EM', W2 - 106, H2 - 10);
    g.fillStyle = HAD; g.fillRect(W2 - 80, H2 - 18, 8, 8); g.fillStyle = '#c7cede'; g.fillText('hadronic', W2 - 68, H2 - 10);
    L.bars = [];
    if (!L.ev || !L.ev.O) return;
    const tw = L.ev.O.towers.filter(q => q.ET > 300).map(q => ({ ...q, ph: q.phi + Math.PI }));
    const mx = Math.max(20000, ...tw.map(q => q.ET)), Hs = H2 * 0.5 / Math.sqrt(mx), grow = Math.max(0, Math.min(1, (t - 4.5) / 3));
    tw.sort((a, b) => (a.eta * ax[1] + a.ph * ay[1]) - (b.eta * ax[1] + b.ph * ay[1]));
    const dE = 0.04, dP = 0.039, fs = L.focusSet;
    for (const q of tw) {
      const hA = Math.sqrt(q.ET) * Hs * grow, hE = hA * q.em / q.E, al = fs ? (fs.has('w' + q.c) ? 1 : 0.18) : 1;
      const c0 = P(q.eta - dE, q.ph - dP), c1 = P(q.eta + dE, q.ph - dP), c2 = P(q.eta + dE, q.ph + dP), c3 = P(q.eta - dE, q.ph + dP);
      const face = (z0, z1, col) => {
        const up = (p, z) => [p[0], p[1] - z]; g.fillStyle = col;
        g.globalAlpha = 0.95 * al; g.beginPath(); [c0, c1].map(p => up(p, z0)).concat([c1, c0].map(p => up(p, z1))).forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.fill();
        g.globalAlpha = 0.7 * al; g.beginPath(); [c1, c2].map(p => up(p, z0)).concat([c2, c1].map(p => up(p, z1))).forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.fill();
        g.globalAlpha = al; g.beginPath(); [c0, c1, c2, c3].map(p => up(p, z1)).forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.fill();
      };
      if (hE > 0.3) face(0, hE, EM);
      if (hA - hE > 0.3) face(hE + 0.5, hA, HAD);
      const [bx, by] = P(q.eta, q.ph); L.bars.push({ x: bx, y: by - hA, x0: bx - 6, x1: bx + 6, y0: by - hA - 3, y1: by + 4, key: 'w' + q.c });
    }
    g.globalAlpha = 1;
  };
  L.hit = (x, y) => { let best = null, bd = 1e9; for (const b of L.bars) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) { const dd = Math.abs(x - (b.x0 + b.x1) / 2); if (dd < bd) { bd = dd; best = b.key; } } return best && L.ev.objs.byKey.get(best) || null; };
  return L;
}
