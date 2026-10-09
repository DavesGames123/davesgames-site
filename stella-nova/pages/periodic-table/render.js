// ============================================================================
//  PERIODIC TABLE  ·  render.js  ·  the table canvas  (no DOM)
// ----------------------------------------------------------------------------
//  One Canvas 2D draws every view: the tiles, their morph from one layout
//  to the next, the 3D tower, the guides, the colour legend, the phase
//  effects of the temperature slider, the hover lift and the saver
//  close-up of one atom. It works in CSS px through setTransform(dpr), so
//  text and lines are crisp at any device pixel ratio. No DOM: main.js
//  gives it a context and a state object, and the node render script
//  gives it a node canvas.
//
//  STATE  (main.js owns it; the renderer only reads it)
//    S.view, S.opts          the layout id and its options (prop, year ...)
//    S.color                 'cat' | 'block' | 'prop' | 'phase' | 'cpk'
//    S.prop, S.cmap          the property and colour map of 'prop'
//    S.temp, S.phaseOn       the temperature (K) and the phase effects
//    S.hover, S.pin          the element index under the pointer, pinned
//    S.match                 null, or a Set of indices that the filters keep
//    S.frame                 { x, y, w, h }: the clear part of the canvas
//    S.closeup               null, or { i, mix, a } (saver atom close-up)
//    S.leader                null, or { x, y }: the card end of the leader
//
//  GREP MAP
//    grep -n "export class Table"      the renderer
//    grep -n "setView("                start a morph to a layout
//    grep -n "positions("              every element at this frame
//    grep -n "fitCamera("              world -> screen for a layout
//    grep -n "draw("                   one frame
//    grep -n "drawTile("               one 2D tile
//    grep -n "draw3D("                 the tower boxes
//    grep -n "drawLegend("             colour legend on the canvas
//    grep -n "hit("                    pointer -> element index
//    grep -n "export function colorOf" the colour of an element
// ============================================================================
import { ELEMENTS, CAT, BLOCK, PROP, propT, phaseAt, phaseFrac, fmt, fmtMass } from './chem.js';
import { buildLayout, delays, morph, VIEW } from './layouts.js';
import { hexRGB, hexA, mix, drawAtom, canvasOf } from './atom.js';
import * as CM from '../ct-lab/colormaps/maps.js';

const N = ELEMENTS.length;
export const BG = '#060810';
const HMAX3 = 3.4;   // tower height of the largest value, in cells
export const PHASE_COLORS = { solid: '#8fb8ff', liquid: '#36d6ff', gas: '#ff9a6b', unknown: '#6c7488' };

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lum = h => { const [r, g, b] = hexRGB(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

export function colorOf(e, S) {
  switch (S.color) {
    case 'block': return BLOCK[e.block].color;
    case 'prop': { const t = propT(S.prop, e); return t == null ? null : toHex(CM.sample(S.cmap || 'viridis', t)); }
    case 'phase': return PHASE_COLORS[phaseAt(e, S.temp)];
    case 'cpk': return e.cpk || '#9aa4b8';
    default: return CAT[e.cat].color;
  }
}

function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r);
  g.closePath();
}

export class Table {
  constructor() {
    this.A = null; this.B = null; this.d = null;
    this.t0 = 0; this.dur = 1.6; this.tNow = 0;
    this.cam = { k: 1, cx: 0, cy: 0 };          // world -> screen, smoothed
    this.user = { zoom: 1, px: 0, py: 0 };        // pinch and pan on top of the fit
    this.rot = { yaw: -0.5, pitch: 0.95 };         // 3D tower camera
    this.a3 = 0;                                   // 0 flat .. 1 full 3D
    this.hov = new Float32Array(N);                // hover lift springs
    this.vis = new Float32Array(N).fill(1);        // appear springs (timeline)
    this.flash = new Float32Array(N);              // phase-change flashes
    this.prevPhase = new Array(N).fill(null);
    this.pos = ELEMENTS.map(() => ({ x: 0, y: 0, s: 1, a: 1, h: 0, sx: 0, sy: 0, ss: 0 }));
    this.bgKey = '';
    this.bg = null;
  }

  // Start a morph to a layout. instant: no animation (first frame, tests).
  setView(id, opts = {}, now = 0, instant = false) {
    const L = buildLayout(id, opts);
    if (!this.B || instant) {
      this.A = L; this.B = L; this.d = new Array(N).fill(0); this.t0 = now - 10;
      this.camFit(L, true);
      return L;
    }
    // freeze the current positions as the start layout
    const cur = this.positions(now, true);
    this.A = { ...this.B, items: cur.map(p => ({ x: p.x, y: p.y, s: p.s, a: p.a, h: p.h })) };
    this.B = L;
    this.d = delays(L);
    this.t0 = now;
    return L;
  }
  // Change the options of the current layout in place (timeline year,
  // abundance source): the items glide, with no wave.
  update(opts, now) {
    if (!this.B) return;
    const L = buildLayout(this.B.id, { ...opts });
    const cur = this.positions(now, true);
    this.A = { ...this.B, items: cur.map(p => ({ x: p.x, y: p.y, s: p.s, a: p.a, h: p.h })) };
    this.B = L; this.d = new Array(N).fill(0); this.t0 = now - 0.35 * this.dur;
  }
  get progress() { return clamp((this.tNow - this.t0) / this.dur, 0, 1); }
  get moving() { return this.progress < 1; }

  positions(now, raw = false) {
    const t = clamp((now - this.t0) / this.dur, 0, 1);
    for (let i = 0; i < N; i++) {
      const a = this.A.items[i], b = this.B.items[i];
      const m = t >= 1 ? b : morph(a, b, t, this.d[i]);
      const p = this.pos[i];
      p.x = m.x; p.y = m.y; p.s = m.s; p.a = m.a; p.h = m.h;
    }
    return raw ? this.pos.map(p => ({ ...p })) : this.pos;
  }

  // The world box of the target layout, fitted into the frame.
  camFit(L, snap) {
    const b = L.bounds;
    this.fit = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    if (snap) this.camSnap = true;
  }
  fitCamera(S, W, H, dt) {
    const f = S.frame || { x: 0, y: 0, w: W, h: H };
    const L = this.B;
    const b = L.bounds;
    let w = b.x1 - b.x0, h = b.y1 - b.y0;
    let shiftY = 0;
    if (this.a3 > 0.01) {
      // fit the projected box: floor corners and the tallest height
      const pts = [];
      for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [0, HMAX3 * this.a3]) pts.push(this.proj3raw(x, y, z));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      w = Math.max(...xs) - Math.min(...xs); h = Math.max(...ys) - Math.min(...ys);
      shiftY = (Math.max(...ys) + Math.min(...ys)) / 2;
    }
    if (S.color === 'prop' || S.phaseOn) h += 64 / Math.max(1e-3, Math.min(f.w / w, f.h / h));
    const k = Math.min(f.w / w, f.h / h) * this.user.zoom;
    const cx = (b.x0 + b.x1) / 2 - this.user.px / k, cy = (b.y0 + b.y1) / 2 + shiftY - this.user.py / k
      + ((S.color === 'prop' || S.phaseOn) ? 30 / k : 0);
    const target = { k, cx, cy, ox: f.x + f.w / 2, oy: f.y + f.h / 2 };
    if (this.camSnap || !this.cam.ox) { Object.assign(this.cam, target); this.camSnap = false; return; }
    // critically damped approach, so view changes glide
    const r = 1 - Math.exp(-dt * 5.5);
    for (const key of ['k', 'cx', 'cy', 'ox', 'oy']) this.cam[key] += (target[key] - this.cam[key]) * r;
  }
  toScreen(x, y) { const c = this.cam; return [c.ox + (x - c.cx) * c.k, c.oy + (y - c.cy) * c.k]; }
  toWorld(sx, sy) { const c = this.cam; return [(sx - c.ox) / c.k + c.cx, (sy - c.oy) / c.k + c.cy]; }

  // ── one frame ──────────────────────────────────────────────────────────
  draw(g, W, H, dpr, now, S) {
    const dt = clamp(now - (this.last ?? now), 0, 0.1);
    this.last = now; this.tNow = now;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawBg(g, W, H, dpr, now);
    if (!this.B) return;
    const three = !!(VIEW[this.B.id] && VIEW[this.B.id].three);
    this.a3 += ((three ? 1 : 0) - this.a3) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(this.a3 - (three ? 1 : 0)) < 1e-3) this.a3 = three ? 1 : 0;
    this.fitCamera(S, W, H, dt);
    const P = this.positions(now);
    // springs
    for (let i = 0; i < N; i++) {
      const want = i === S.hover || i === S.pin ? 1 : 0;
      this.hov[i] += (want - this.hov[i]) * (1 - Math.exp(-dt * 14));
      this.vis[i] += (P[i].a - this.vis[i]) * (1 - Math.exp(-dt * 7));
      this.flash[i] = Math.max(0, this.flash[i] - dt * 1.4);
      if (S.phaseOn) {
        const ph = phaseAt(ELEMENTS[i], S.temp);
        if (this.prevPhase[i] && this.prevPhase[i] !== ph) this.flash[i] = 1;
        this.prevPhase[i] = ph;
      } else this.prevPhase[i] = null;
    }
    const prog = this.progress;
    const dimClose = S.closeup ? S.closeup.a : 0;
    if (this.a3 > 0.002) this.draw3D(g, W, H, now, S, P);
    else {
      this.drawDecor(g, this.A !== this.B && prog < 0.6 ? this.A : this.B, prog, S);
      this.draw2D(g, now, S, P);
    }
    if (S.color === 'prop' || this.B.id === 'heat' || this.B.id === 'tower') this.drawLegend(g, W, H, S);
    if (S.phaseOn && !S.closeup) this.drawPhaseLegend(g, W, H, S);
    if (S.leader && (S.hover >= 0 || S.pin >= 0)) this.drawLeader(g, S);
    if (dimClose > 0.001) this.drawCloseup(g, W, H, now, S);
  }

  drawBg(g, W, H, dpr, now) {
    const key = W + 'x' + H + '@' + dpr;
    if (this.bgKey !== key) {
      this.bgKey = key;
      const c = canvasOf(Math.max(1, Math.round(W * dpr)), Math.max(1, Math.round(H * dpr)));
      const b = c.getContext('2d');
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.fillStyle = BG; b.fillRect(0, 0, W, H);
      const neb = [[0.18, 0.2, '#2a3c8a', 0.32], [0.82, 0.78, '#5a2a7a', 0.22], [0.62, 0.12, '#1a5a78', 0.2]];
      for (const [fx, fy, col, a] of neb) {
        const r = Math.max(W, H) * 0.65;
        const gr = b.createRadialGradient(fx * W, fy * H, 0, fx * W, fy * H, r);
        gr.addColorStop(0, hexA(col, a)); gr.addColorStop(1, hexA(col, 0));
        b.fillStyle = gr; b.fillRect(0, 0, W, H);
      }
      // star dust
      let s = 1234567;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const n = Math.round(W * H / 2600);
      for (let i = 0; i < n; i++) {
        const x = rnd() * W, y = rnd() * H, m = rnd();
        b.fillStyle = `rgba(200,220,255,${0.08 + 0.4 * m * m})`;
        const r = 0.35 + m * m * 0.9;
        b.beginPath(); b.arc(x, y, r, 0, Math.PI * 2); b.fill();
      }
      // vignette
      const vg = b.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      b.fillStyle = vg; b.fillRect(0, 0, W, H);
      this.bg = c;
    }
    g.drawImage(this.bg, 0, 0, W, H);
  }

  drawDecor(g, L, prog, S) {
    const a = L === this.B ? clamp((prog - 0.55) / 0.45, 0, 1) : clamp(1 - prog / 0.4, 0, 1);
    if (a <= 0.01) return;
    const k = this.cam.k;
    g.save();
    for (const d of L.decor) {
      const col = d.color || (d.role === 'guide' ? '#8fb6ff' : '#9fb0cc');
      if (d.t === 'text') {
        const fs = clamp(d.size * k, 9, 22);
        if (d.size * k < 4) continue;
        const [x, y] = this.toScreen(d.x, d.y);
        g.font = `${d.role === 'block' || d.role === 'label' ? 500 : 400} ${fs}px Inter, system-ui, sans-serif`;
        g.fillStyle = hexA(col.length === 7 ? col : '#9fb0cc', 0.78 * a);
        g.textAlign = d.align || 'center'; g.textBaseline = 'middle';
        if (d.rot) { g.save(); g.translate(x, y); g.rotate(d.rot); g.fillText(d.text, 0, 0); g.restore(); }
        else g.fillText(d.text, x, y);
      } else if (d.t === 'line') {
        g.strokeStyle = hexA(col, (d.role === 'guide' ? 0.22 : 0.5) * a);
        g.lineWidth = 1;
        g.beginPath();
        d.pts.forEach(([px, py], i) => { const [x, y] = this.toScreen(px, py); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
      } else if (d.t === 'ring') {
        const [x, y] = this.toScreen(d.x, d.y);
        g.strokeStyle = hexA('#8fb6ff', 0.14 * a); g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, d.r * k, 0, Math.PI * 2); g.stroke();
      } else if (d.t === 'axis') {
        g.strokeStyle = `rgba(160,185,225,${0.4 * a})`; g.lineWidth = 1;
        g.beginPath();
        if (d.vertical) { const [x0, y0] = this.toScreen(d.x, d.y0), [, y1] = this.toScreen(d.x, d.y1); g.moveTo(x0, y0); g.lineTo(x0, y1); }
        else { const [x0, y0] = this.toScreen(d.x0, d.y), [x1] = this.toScreen(d.x1, d.y); g.moveTo(x0, y0); g.lineTo(x1, y0); }
        g.stroke();
      }
    }
    g.restore();
  }

  // ── 2D tiles ─────────────────────────────────────────────────────────────
  draw2D(g, now, S, P) {
    const k = this.cam.k;
    const discMix = (this.A.disc ? 1 : 0) + ((this.B.disc ? 1 : 0) - (this.A.disc ? 1 : 0)) * clamp((this.progress - 0.2) / 0.6, 0, 1);
    // order: dimmed first, then normal, the hovered on top
    const order = [...Array(N).keys()].sort((a, b) => this.hov[a] - this.hov[b] || (S.match ? (S.match.has(a) ? 1 : 0) - (S.match.has(b) ? 1 : 0) : 0));
    for (const i of order) {
      const p = P[i];
      const [sx, sy] = this.toScreen(p.x, p.y);
      const pop = this.vis[i];
      const ss = p.s * k * (1 + 0.16 * this.hov[i]) * (0.4 + 0.6 * clamp(pop, 0, 1.2));
      p.sx = sx; p.sy = sy; p.ss = ss;
      const alpha = clamp(pop, 0, 1) * (p.a > 0 ? 1 : clamp(pop, 0, 1));
      if (alpha < 0.01 || ss < 1.5) continue;
      this.drawTile(g, ELEMENTS[i], sx, sy, ss, alpha, discMix, now, S, i);
    }
  }

  drawTile(g, e, cx, cy, s, alpha, discMix, now, S, i) {
    const col = colorOf(e, S) || '#4a5266';
    const dim = S.match && !S.match.has(i) ? 0.16 : 1;
    const hov = this.hov[i];
    const r = s * (0.13 + 0.37 * discMix);
    const x = cx - s / 2, y = cy - s / 2;
    const strong = S.color === 'prop' || S.color === 'cpk';
    const phase = S.phaseOn ? phaseAt(e, S.temp) : null;
    g.save();
    g.globalAlpha = alpha * dim * (phase === 'gas' ? 0.78 : 1);
    if (hov > 0.02 || this.flash[i] > 0.02) {
      g.shadowColor = hexA(col, 0.9);
      g.shadowBlur = 26 * Math.max(hov, this.flash[i]);
    }
    // body
    const top = strong ? mix(col, BG, 0.18) : mix(col, BG, 0.62);
    const bot = strong ? mix(col, BG, 0.42) : mix(col, BG, 0.86);
    const gr = g.createLinearGradient(x, y, x + s * 0.4, y + s);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    g.fillStyle = gr;
    rrect(g, x, y, s, s, r);
    g.fill();
    g.shadowBlur = 0;
    // phase effects: liquid surface, gas particles
    if (phase === 'liquid' || phase === 'gas') this.drawPhaseFx(g, e, x, y, s, r, phase, now, i, S);
    // rim and sheen
    g.lineWidth = Math.max(1, s * 0.022);
    g.strokeStyle = hexA(col, strong ? 0.35 : 0.55 + 0.4 * hov);
    rrect(g, x + 0.5, y + 0.5, s - 1, s - 1, r);
    g.stroke();
    if (s > 18) {
      const sh = g.createLinearGradient(x, y, x, y + s * 0.5);
      sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh; rrect(g, x + 1, y + 1, s - 2, s * 0.5, Math.max(0, r - 1)); g.fill();
    }
    if (discMix < 0.5 && s > 22 && !strong) {
      g.fillStyle = hexA(col, 0.85 * (1 - discMix * 2));
      rrect(g, x + s * 0.3, y + 1.5, s * 0.4, Math.max(1.5, s * 0.03), 1);
      g.fill();
    }
    // flash ring on a phase change
    if (this.flash[i] > 0.01) {
      const f = this.flash[i];
      g.strokeStyle = hexA(PHASE_COLORS[phase] || '#fff', f * 0.9);
      g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, s * (0.5 + (1 - f) * 0.6), 0, Math.PI * 2); g.stroke();
    }
    // text
    const ink = strong && lum(col) > 0.6 ? '#0b0e16' : '#f1f5fc';
    const sub = strong && lum(col) > 0.6 ? 'rgba(10,14,22,0.72)' : 'rgba(205,218,240,0.78)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fsSym = s * (discMix > 0.5 ? 0.44 : 0.4);
    if (fsSym >= 6.5) {
      g.fillStyle = ink;
      g.font = `600 ${fsSym}px Inter, system-ui, sans-serif`;
      const sy = cy + (discMix > 0.5 ? s * 0.04 : s > 52 ? -s * 0.04 : s * 0.05);
      g.fillText(e.sym, cx, sy);
    }
    const fsZ = s * 0.17;
    if (fsZ >= 7.5) {
      g.fillStyle = sub;
      g.font = `500 ${fsZ}px Inter, system-ui, sans-serif`;
      if (discMix > 0.5) g.fillText(String(e.z), cx, cy - s * 0.3);
      else { g.textAlign = 'left'; g.fillText(String(e.z), x + s * 0.09, y + s * 0.16); }
    }
    if (discMix <= 0.5 && s * 0.125 >= 8) {
      const fsN = Math.min(s * 0.125, 13);
      g.textAlign = 'center';
      g.fillStyle = sub;
      g.font = `400 ${fsN}px Inter, system-ui, sans-serif`;
      g.fillText(fitText(g, e.name, s * 0.9), cx, y + s * 0.84);
      if (s > 70) {
        g.font = `400 ${Math.min(s * 0.11, 11.5)}px Inter, system-ui, sans-serif`;
        g.textAlign = 'right';
        g.fillText(S.color === 'prop' ? valueText(e, S.prop) : fmtMass(e), x + s * 0.92, y + s * 0.16);
      }
    }
    g.restore();
  }

  drawPhaseFx(g, e, x, y, s, r, phase, now, i, S) {
    g.save();
    rrect(g, x, y, s, s, r); g.clip();
    if (phase === 'liquid') {
      const lvl = y + s * (0.42 + 0.12 * Math.sin(now * 0.9 + i));
      const gr = g.createLinearGradient(0, lvl, 0, y + s);
      gr.addColorStop(0, 'rgba(70,215,255,0.55)'); gr.addColorStop(1, 'rgba(30,110,200,0.35)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x, y + s);
      for (let k = 0; k <= 12; k++) {
        const px = x + s * k / 12;
        g.lineTo(px, lvl + Math.sin(now * 3 + k * 0.9 + i) * s * 0.035);
      }
      g.lineTo(x + s, y + s); g.closePath(); g.fill();
    } else {
      const f = phaseFrac(e, S.temp);
      for (let k = 0; k < 6; k++) {
        const ph = (now * (0.25 + 0.1 * k) + k * 0.37 + i * 0.13) % 1;
        const px = x + s * (0.15 + 0.7 * ((k * 0.61 + i * 0.29) % 1)) + Math.sin(now * 2 + k) * s * 0.04;
        const py = y + s * (1 - ph);
        g.fillStyle = `rgba(255,170,120,${0.55 * Math.sin(Math.PI * ph) * (0.5 + 0.5 * f)})`;
        g.beginPath(); g.arc(px, py, s * (0.025 + 0.02 * ((k * 0.7) % 1)), 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }

  // ── 3D tower ─────────────────────────────────────────────────────────────
  // Projected position in world units, relative to the layout centre.
  proj3raw(x, y, z) {
    const b = this.B.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const a3 = this.a3;
    const yaw = this.rot.yaw * a3, pitch = this.rot.pitch * a3;
    const X = x - cx, Y = y - cy;
    const xr = X * Math.cos(yaw) - Y * Math.sin(yaw);
    const yr = X * Math.sin(yaw) + Y * Math.cos(yaw);
    const depth = yr * Math.sin(pitch) + z * Math.cos(pitch);
    const persp = 1 / (1 - 0.018 * depth * a3);
    return [xr * persp, (yr * Math.cos(pitch) - z * Math.sin(pitch)) * persp, depth, persp];
  }
  proj3(x, y, z) {
    const b = this.B.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const a3 = this.a3;
    const yaw = this.rot.yaw * a3, pitch = this.rot.pitch * a3;
    const X = x - cx, Y = y - cy;
    const xr = X * Math.cos(yaw) - Y * Math.sin(yaw);
    const yr = X * Math.sin(yaw) + Y * Math.cos(yaw);
    const sy = yr * Math.cos(pitch) - z * Math.sin(pitch);
    const depth = yr * Math.sin(pitch) + z * Math.cos(pitch);
    const persp = 1 / (1 - 0.018 * depth * a3);
    const c = this.cam;
    return [c.ox + (xr * persp + cx - c.cx) * c.k, c.oy + (sy * persp + cy - c.cy) * c.k, depth, persp];
  }
  draw3D(g, W, H, now, S, P) {
    const k = this.cam.k, a3 = this.a3;
    const HMAX = HMAX3 * a3;
    // floor grid
    g.save();
    g.strokeStyle = `rgba(120,160,230,${0.12 * a3})`; g.lineWidth = 1;
    for (let gx = 0.5; gx <= 18.5; gx += 1) { const [x0, y0] = this.proj3(gx, 0.5, 0), [x1, y1] = this.proj3(gx, 10.1, 0); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    for (let gy = 0.5; gy <= 10.1; gy += 1) { const [x0, y0] = this.proj3(0.5, gy, 0), [x1, y1] = this.proj3(18.5, gy, 0); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    g.restore();
    const boxes = [];
    for (let i = 0; i < N; i++) {
      const p = P[i];
      const h = Math.max(0.02, p.h) * HMAX + 0.08;
      const half = p.s / 2 * (1 + 0.1 * this.hov[i]);
      const [, , dep] = this.proj3(p.x, p.y, h / 2);
      boxes.push({ i, p, h, half, dep });
    }
    boxes.sort((a, b) => a.dep - b.dep);
    for (const B of boxes) {
      const { i, p, h, half } = B;
      const e = ELEMENTS[i];
      const col = colorOf(e, S) || '#4a5266';
      const dim = S.match && !S.match.has(i) ? 0.15 : 1;
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [p.x + u * half, p.y + v * half]);
      const bot = c.map(([x, y]) => this.proj3(x, y, 0));
      const top = c.map(([x, y]) => this.proj3(x, y, h));
      g.save();
      g.globalAlpha = dim * clamp(this.vis[i], 0, 1);
      // sides: the faces whose outward normal faces the camera, back first
      const faces = [0, 1, 2, 3].map(f => {
        const a = f, b = (f + 1) % 4;
        const quad = [bot[a], bot[b], top[b], top[a]];
        const area = (quad[1][0] - quad[0][0]) * (quad[2][1] - quad[0][1]) - (quad[2][0] - quad[0][0]) * (quad[1][1] - quad[0][1]);
        return { f, quad, area, d: (bot[a][2] + bot[b][2]) / 2 };
      }).filter(f => f.area < 0).sort((a, b) => a.d - b.d);
      for (const F of faces) {
        g.fillStyle = mix(col, BG, [0.45, 0.62, 0.52, 0.7][F.f]);
        g.beginPath(); F.quad.forEach(([x, y], j) => j ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
        g.strokeStyle = hexA(col, 0.25); g.lineWidth = 0.7; g.stroke();
      }
      // top
      if (this.hov[i] > 0.02) { g.shadowColor = hexA(col, 0.9); g.shadowBlur = 24 * this.hov[i]; }
      g.fillStyle = mix(col, '#ffffff', 0.08 + 0.2 * this.hov[i]);
      g.beginPath(); top.forEach(([x, y], j) => j ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.8; g.stroke();
      const [tx, ty, , persp] = this.proj3(p.x, p.y, h);
      const fs = half * 2 * k * persp * 0.42;
      p.sx = tx; p.sy = ty; p.ss = half * 2 * k * persp;
      if (fs > 7) {
        g.fillStyle = lum(col) > 0.6 ? '#0b0e16' : '#f4f7fd';
        g.font = `600 ${fs}px Inter, system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.save(); g.translate(tx, ty); g.scale(1, Math.max(0.35, Math.cos(this.rot.pitch * a3) * 1.1)); g.fillText(e.sym, 0, 0); g.restore();
      }
      g.restore();
    }
  }

  drawLegend(g, W, H, S) {
    const p = PROP[S.prop];
    if (!p) return;
    const f = S.frame || { x: 0, y: 0, w: W, h: H };
    const w = Math.min(260, f.w * 0.5), h = 10;
    const x = f.x + 18, y = f.y + f.h - 46;
    g.save();
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    for (let k = 0; k <= 16; k++) gr.addColorStop(k / 16, toHex(CM.sample(S.cmap || 'viridis', k / 16)));
    g.fillStyle = gr; rrect(g, x, y, w, h, 5); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.2)'; g.stroke();
    g.font = '500 12px Inter, system-ui, sans-serif'; g.fillStyle = 'rgba(225,233,247,0.92)';
    g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText(p.name + (p.unit ? ' (' + p.unit + ')' : '') + (p.log ? ' · log scale' : ''), x, y - 6);
    g.font = '400 11px Inter, system-ui, sans-serif'; g.fillStyle = 'rgba(190,203,226,0.85)';
    g.textBaseline = 'top';
    const [lo, hi] = rangeText(S.prop);
    g.fillText(lo, x, y + h + 5); g.textAlign = 'right'; g.fillText(hi, x + w, y + h + 5);
    g.restore();
  }
  drawPhaseLegend(g, W, H, S) {
    const f = S.frame || { x: 0, y: 0, w: W, h: H };
    const x = f.x + f.w - 18, y = f.y + f.h - 30;
    g.save();
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.font = '600 20px Inter, system-ui, sans-serif'; g.fillStyle = '#f2f6fd';
    g.fillText(Math.round(S.temp).toLocaleString('en-US') + ' K', x, y - 26);
    g.font = '400 12px Inter, system-ui, sans-serif'; g.fillStyle = 'rgba(200,212,232,0.85)';
    const counts = { solid: 0, liquid: 0, gas: 0 };
    for (const e of ELEMENTS) { const ph = phaseAt(e, S.temp); if (ph in counts) counts[ph]++; }
    g.fillText(`${Math.round(S.temp - 273.15).toLocaleString('en-US')} °C · ${counts.solid} solid · ${counts.liquid} liquid · ${counts.gas} gas`, x, y);
    g.restore();
  }
  drawLeader(g, S) {
    const i = S.pin >= 0 ? S.pin : S.hover;
    const p = this.pos[i];
    if (!p || !p.ss) return;
    const { x, y } = S.leader;
    g.save();
    g.strokeStyle = hexA(CAT[ELEMENTS[i].cat].color, 0.6); g.lineWidth = 1;
    const ex = x < p.sx ? p.sx - p.ss / 2 : p.sx + p.ss / 2;
    g.beginPath(); g.moveTo(ex, p.sy); g.lineTo(x, y); g.stroke();
    g.fillStyle = hexA(CAT[ELEMENTS[i].cat].color, 0.9);
    g.beginPath(); g.arc(ex, p.sy, 2.5, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // The saver close-up: the table dims and one atom fills the frame.
  drawCloseup(g, W, H, now, S) {
    const c = S.closeup, e = ELEMENTS[c.i];
    const f = S.frame || { x: 0, y: 0, w: W, h: H };
    g.save();
    g.fillStyle = `rgba(4,6,12,${0.82 * c.a})`; g.fillRect(0, 0, W, H);
    const side = Math.min(f.w * 0.92, f.h * 0.98);
    const rect = { x: f.x + (f.w - side) / 2, y: f.y + (f.h - side) / 2, w: side, h: side };
    drawAtom(g, e, rect, now, c.mix, { alpha: c.a, scale: Math.max(1, side / 300), budget: 6000, labels: true });
    g.restore();
  }

  // ── pointer ──────────────────────────────────────────────────────────────
  hit(sx, sy) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const p = this.pos[i];
      if (!p.ss || this.vis[i] < 0.3) continue;
      const dx = Math.abs(sx - p.sx), dy = Math.abs(sy - p.sy), half = p.ss / 2;
      if (dx <= half && dy <= half) { const d = dx + dy; if (d < bd) { bd = d; best = i; } }
    }
    return best;
  }
}

function fitText(g, s, w) {
  if (g.measureText(s).width <= w) return s;
  let t = s;
  while (t.length > 3 && g.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}
function valueText(e, id) { const p = PROP[id]; const v = p.get(e); return v == null ? '—' : fmt(v, p.digits > 2 ? 2 : p.digits); }
function rangeText(id) {
  const p = PROP[id];
  const vals = ELEMENTS.map(p.get).filter(v => v != null && isFinite(v) && (!p.log || v > 0));
  return [fmt(Math.min(...vals), p.digits > 2 ? 2 : p.digits), fmt(Math.max(...vals), p.digits > 2 ? 2 : p.digits)];
}
