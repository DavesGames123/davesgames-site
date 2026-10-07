// ============================================================================
//  MOLECULES  ·  pane2d.js — one 2D pane: the SVG, zoom, pan, hover, morph
// ────────────────────────────────────────────────────────────────────────────
//  new Pane2D(wrap, { onHover, onPick }) draws a model with draw2d.js into
//  wrap (a .svgwrap on the paper card). Zoom and pan change the viewBox
//  only, so the lines stay crisp. A pointer over an atom or a bond calls
//  onHover({ atom } | { bond } | null); a tap or click calls onPick.
//
//  The Lewis morph (playMorph) runs four stages:
//    Lewis structure -> lone pairs implied -> C-H folded into the carbon
//    (condensed) -> carbon symbols dropped (skeletal)
//  setStage(k) jumps to a stage with a 0.9 s tween.
//
//  grep -n targets: "render()", "fit(", "zoomAt(", "pointerAt(",
//  "MORPH", "playMorph(", "setReveal("
// ============================================================================
import { render2D, BL } from './draw2d.js';

export const MORPH = [
  { k: 'lewis', name: 'Lewis structure', text: 'Every atom and every bond is drawn. Each dot pair is a lone pair: two valence electrons that are not in a bond.', v: { lp: 1, hC: 1, hX: 1, cL: 1 } },
  { k: 'nolp', name: 'Lone pairs implied', text: 'Chemists know how many lone pairs each atom has (O has two, N has one), so the dots are left out.', v: { lp: 0, hC: 1, hX: 1, cL: 1 } },
  { k: 'cond', name: 'Condensed', text: 'Each C–H bond folds into its carbon: CH₃, CH₂, CH. The H on O and N joins the label: OH, NH₂.', v: { lp: 0, hC: 0, hX: 0, cL: 1 } },
  { k: 'skel', name: 'Skeletal formula', text: 'The C labels go too. Each corner and each line end is a carbon, with enough hydrogens to make four bonds.', v: { lp: 0, hC: 0, hX: 0, cL: 0 } },
];

export class Pane2D {
  constructor(wrap, opts = {}) {
    this.wrap = wrap; this.opts = opts;
    this.M = null; this.view = null; this.base = null;
    this.state = { lp: 0, hC: 0, hX: 0, cL: 0, color: true, groups: [], hover: null, sel: null, reveal: null };
    this.pointers = new Map();
    this.bind();
    this.ro = new ResizeObserver(() => { if (this.M) { if (this.autoFit) this.fit(); else this.applyView(); } });
    this.ro.observe(wrap);
  }
  setModel(M) {
    this.M = M; this.state.hover = null; this.state.sel = null; this.state.reveal = null;
    this.render(); this.fit();
  }
  set(o) { Object.assign(this.state, o); this.render(); }
  render() {
    if (!this.M) { this.wrap.textContent = ''; return; }
    const s = this.state;
    const r = render2D(this.M, { lp: s.lp, hC: s.hC, hX: s.hX, cL: s.cL, color: s.color, groups: s.groups, hover: s.hover, sel: s.sel, hit: true, reveal: s.reveal });
    this.base = r.box;
    this.wrap.innerHTML = r.svg;
    this.svg = this.wrap.firstChild;
    this.applyView();
  }
  svgText(opts = {}) {
    const s = this.state;
    return render2D(this.M, { lp: s.lp, hC: s.hC, hX: s.hX, cL: s.cL, color: s.color, groups: opts.groups ? s.groups : [], width: opts.width, background: opts.background }).svg;
  }
  // ── view ─────────────────────────────────────────────────────────────────
  fit() {
    if (!this.base) return;
    const W = this.wrap.clientWidth || 1, H = this.wrap.clientHeight || 1;
    // never larger than 60 px per bond (small molecules stay textbook size)
    const s = Math.max(this.base.w / W, this.base.h / H, BL / 60);
    this.view = { cx: this.base.x + this.base.w / 2, cy: this.base.y + this.base.h / 2, s };
    this.autoFit = true;
    this.applyView();
  }
  applyView() {
    if (!this.svg || !this.view) return;
    const W = this.wrap.clientWidth || 1, H = this.wrap.clientHeight || 1, v = this.view;
    this.svg.setAttribute('viewBox', `${(v.cx - W * v.s / 2).toFixed(2)} ${(v.cy - H * v.s / 2).toFixed(2)} ${(W * v.s).toFixed(2)} ${(H * v.s).toFixed(2)}`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }
  zoomAt(k, px, py) {
    if (!this.view) return;
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight, v = this.view;
    if (px == null) { px = W / 2; py = H / 2; }
    const wx = v.cx + (px - W / 2) * v.s, wy = v.cy + (py - H / 2) * v.s;
    const s = Math.min(Math.max(v.s / k, BL / 400), Math.max(this.base.w / W, this.base.h / H) * 4);
    v.cx = wx - (px - W / 2) * s; v.cy = wy - (py - H / 2) * s; v.s = s;
    this.autoFit = false;
    this.applyView();
  }
  // ── pointer ──────────────────────────────────────────────────────────────
  pointerAt(x, y) {
    const t = document.elementFromPoint(x, y);
    if (!t || !this.wrap.contains(t)) return null;
    const h = t.closest('[data-a],[data-b]');
    if (!h || !h.closest('.hit')) return null;
    if (h.dataset.a != null) return { atom: +h.dataset.a };
    return { bond: +h.dataset.b };
  }
  bind() {
    const w = this.wrap;
    let last = null, moved = 0, pinch = null, downAt = null;
    w.addEventListener('wheel', e => { e.preventDefault(); const r = w.getBoundingClientRect(); this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    w.addEventListener('pointerdown', e => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { w.setPointerCapture(e.pointerId); } catch (x) { /* old Safari */ }
      moved = 0; last = { x: e.clientX, y: e.clientY }; downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; }
    });
    w.addEventListener('pointermove', e => {
      if (this.pointers.has(e.pointerId)) {
        const p = this.pointers.get(e.pointerId); p.x = e.clientX; p.y = e.clientY;
        if (this.pointers.size === 2 && pinch) {
          const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = w.getBoundingClientRect();
          this.zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pinch.d = d; moved = 99; return;
        }
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4 && this.view) { this.view.cx -= dx * this.view.s; this.view.cy -= dy * this.view.s; this.autoFit = false; this.applyView(); w.classList.add('drag'); }
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.pointerType === 'mouse') this.hoverAt(e.clientX, e.clientY);
    });
    const up = e => {
      this.pointers.delete(e.pointerId); w.classList.remove('drag');
      if (this.pointers.size < 2) pinch = null;
      if (downAt && moved <= 6 && performance.now() - downAt.t < 600) {
        const hit = this.pointerAt(e.clientX, e.clientY);
        if (this.opts.onPick) this.opts.onPick(hit, e.pointerType);
      }
      downAt = null;
    };
    w.addEventListener('pointerup', up);
    w.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); pinch = null; downAt = null; w.classList.remove('drag'); });
    w.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && this.opts.onHover) { this._hk = ''; this.opts.onHover(null); } });
    w.addEventListener('dblclick', () => this.fit());
  }
  hoverAt(x, y) {
    const hit = this.pointerAt(x, y);
    const k = hit ? (hit.atom != null ? 'a' + hit.atom : 'b' + hit.bond) : '';
    if (k === this._hk) return;
    this._hk = k;
    if (this.opts.onHover) this.opts.onHover(hit);
  }
  // ── morph ────────────────────────────────────────────────────────────────
  tweenTo(v, ms = 900) {
    cancelAnimationFrame(this._tw);
    const from = { lp: this.state.lp, hC: this.state.hC, hX: this.state.hX, cL: this.state.cL }, t0 = performance.now();
    return new Promise(res => {
      const step = now => {
        const t = Math.min(1, (now - t0) / ms), e = t * t * (3 - 2 * t);
        for (const k in v) this.state[k] = from[k] + (v[k] - from[k]) * e;
        this.render();
        if (t < 1) this._tw = requestAnimationFrame(step); else res();
      };
      this._tw = requestAnimationFrame(step);
    });
  }
  setStage(k, ms) { return this.tweenTo(MORPH[k].v, ms); }
  async playMorph(onStage) {
    const token = (this._play = {});
    this.state = Object.assign(this.state, MORPH[0].v); this.render();
    onStage && onStage(0);
    for (let k = 1; k < MORPH.length; k++) {
      await new Promise(r => setTimeout(r, 2600));
      if (this._play !== token) return;
      onStage && onStage(k);
      await this.setStage(k, 1300);
      if (this._play !== token) return;
    }
  }
  stopMorph() { this._play = null; cancelAnimationFrame(this._tw); }
  setReveal(k) { this.state.reveal = k; this.render(); }
  dispose() { this.ro.disconnect(); this.stopMorph(); this.wrap.textContent = ''; }
}
