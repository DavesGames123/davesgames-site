// ============================================================================
//  REACTIONS  ·  treeview.js — the synthesis tree on the page (DOM)
// ----------------------------------------------------------------------------
//  Draws a layout of synth.js (the fishdraw tree-of-life layouts) as HTML:
//  one card per molecule (the 2D skeletal formula from molecules/draw2d.js
//  on paper, or a 3D still from the shared view on dark), the branches
//  as SVG paths, and the equation of each step in TeX in a chip on a
//  branch into its product. Pan with a drag, zoom with the wheel or a
//  pinch. Like the fishdraw tree, the view follows the growth while the
//  tree builds, until the user moves it.
//
//  FIT (treefit.js)  each card name gets a font size and line breaks that
//  fit the card; the drawing or the still fills the art box above it.
//  The chips are placed with a size guess, then placed again with the
//  size of the typeset SVG. placeChips spreads the layout until no chip
//  touches a card or another chip.
//
//  new TreeView(wrap, { hover(id), pick(id), leave() })
//  tv.set(S, lay, { d3, eq, art(node, w, h) -> svg text,
//                   still(node, w, h) -> url })
//  tv.grow(u)      0..1, the growth playback (1 = all shown)
//  tv.light(id)    light a molecule, the branches into it and its equation
//  tv.fit(anim)    the whole tree in view; fitRect(r), focusIn(id, r) for
//                  the saver's clear band
//  tv.placed       a promise: the chips are typeset and placed
//
//  GREP MAP: grep -n 'set(S, lay'  'place(lay, at)'  'grow(u)'  'bindPointer'
// ============================================================================
import { typeset } from '../../lib/sci-math.js';
import { growOrder } from './synth.js';
import { cardGeom, chipBox, chipGuess, placeChips, CHIP } from './treefit.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const pathOf = br => [...br.run.slice().reverse(), ...br.elbow.slice().reverse()];

export class TreeView {
  constructor(wrap, cb = {}) {
    this.wrap = wrap; this.cb = cb;
    this.inner = document.createElement('div'); this.inner.className = 'tv-inner';
    wrap.appendChild(this.inner);
    this.view = { s: 1, x: 0, y: 0 }; this.user = false; this.u = 1;
    this.bindPointer();
    new ResizeObserver(() => { if (!this.user && this.lay) this.fit(false); }).observe(wrap);
  }
  set(S, lay, opt = {}) {
    this.S = S; this.opt = opt; this.user = false;
    const tok = this.tok = (this.tok || 0) + 1;
    const ids = lay.ids, order = growOrder(S);
    this.appear = new Map(order.map((id, i) => [id, (i + 1) / order.length]));
    this.dn = 1 / order.length;
    const eq = opt.eq !== false;
    const steps = S.steps.map(s => ({ out: s.out, ins: s.ins }));
    const sizes = S.steps.map(s => chipGuess(s.st.tex));
    const first = eq ? placeChips(lay, steps, k => sizes[k]) : { lay, at: [] };
    const L = first.lay;
    let h = `<svg class="tv-lines" width="${L.w}" height="${L.h}" viewBox="0 0 ${L.w} ${L.h}">`;
    for (const id of ids) if (L.branch[id]) h += `<path data-c="${id}"/>`;
    h += '</svg>';
    for (const id of ids) {
      const n = S.nodes[id], b = L.fish[id], m = n.mol, g = cardGeom(b, m.name), a = g.art;
      const cls = ['tv-node', n.step < 0 ? 'leaf' : '', id === S.root ? 'root' : '', opt.d3 ? 'd3' : ''].join(' ');
      const pic = opt.d3 && opt.still ? `<img alt="" src="${opt.still(m, a.w, a.h) || ''}">` : (opt.art ? opt.art(m, a.w, a.h) : '');
      h += `<div class="${cls}" data-id="${id}" style="width:${b.w}px;height:${b.h}px" title="${esc(m.name)}">`
        + `<div class="art" style="left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px">${pic}</div>`
        + `<div class="nm" style="font-size:${g.lab.fs}px;height:${g.labH}px">${g.lab.lines.map(l => `<span>${esc(l)}</span>`).join('')}</div>${n.coef > 1 ? `<span class="cf">${n.coef}×</span>` : ''}</div>`;
    }
    if (eq) S.steps.forEach(s => { if (L.fish[s.out]) h += `<div class="tv-eq wait" data-out="${s.out}"></div>`; });
    this.inner.innerHTML = h;
    this.svg = this.inner.querySelector('svg');
    this.cards = new Map([...this.inner.querySelectorAll('.tv-node')].map(e => [+e.dataset.id, e]));
    this.eqs = new Map([...this.inner.querySelectorAll('.tv-eq')].map(e => [+e.dataset.out, e]));
    this.place(L, first.at);
    for (const [id, e] of this.cards) {
      e.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse' && !this.dragging) this.cb.hover && this.cb.hover(id); });
      e.addEventListener('click', () => { if (!this.moved) this.cb.pick && this.cb.pick(id); });
    }
    this.grow(1);
    this.fit(false);
    this.shrinkNames();
    // typeset every chip, then place them again with their real sizes
    this.placed = !eq ? Promise.resolve() : Promise.all(S.steps.map((s, k) => {
      const e = this.eqs.get(s.out); if (!e) return null;
      return typeset(e, s.st.tex, { display: false }).then(okd => {
        const svg = okd && e.querySelector('svg'), vb = svg && svg.getAttribute('viewBox');
        if (vb) {
          const [, , vw, vh] = vb.split(/[\s,]+/).map(Number), c = chipBox(vw, vh);
          svg.style.width = c.svgW.toFixed(1) + 'px'; svg.style.height = c.svgH.toFixed(1) + 'px';
          sizes[k] = c;
        } else sizes[k] = { w: e.offsetWidth || sizes[k].w, h: e.offsetHeight || sizes[k].h };
      });
    })).then(() => {
      if (this.tok !== tok) return;
      const P = placeChips(lay, steps, k => sizes[k]);
      this.place(P.lay, P.at);
      for (const e of this.eqs.values()) e.classList.remove('wait');
      if (!this.user) this.fit(false);
    });
  }
  // put the cards, branches and chips of a placed layout on the page
  place(lay, at) {
    this.lay = lay;
    this.svg.setAttribute('width', lay.w); this.svg.setAttribute('height', lay.h); this.svg.setAttribute('viewBox', `0 0 ${lay.w} ${lay.h}`);
    for (const p of this.svg.querySelectorAll('path')) {
      const br = lay.branch[+p.dataset.c];
      p.setAttribute('d', 'M' + pathOf(br).map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L'));
    }
    for (const [id, e] of this.cards) { const b = lay.fish[id]; e.style.left = b.x + 'px'; e.style.top = b.y + 'px'; }
    this.S.steps.forEach((s, k) => {
      const e = this.eqs.get(s.out), a = at[k]; if (!e || !a) return;
      e.style.left = a.x.toFixed(1) + 'px'; e.style.top = a.y.toFixed(1) + 'px';
      e.style.minWidth = a.w.toFixed(1) + 'px'; e.style.height = a.h.toFixed(1) + 'px';
    });
    this.inner.style.width = lay.w + 'px'; this.inner.style.height = lay.h + 'px';
    this.paths = [...this.svg.querySelectorAll('path')].map(p => { const L = p.getTotalLength ? p.getTotalLength() : 100; p.style.strokeDasharray = L; return [p, +p.dataset.c, L]; });
    this.grow(this.u);
  }
  // a safety net for the width model: a name line wider than its card
  // (a font with other widths) shrinks until it fits
  shrinkNames() {
    const run = () => {
      for (const e of this.cards.values()) {
        const nm = e.querySelector('.nm'); if (!nm) continue;
        for (let k = 0; k < 6 && nm.scrollWidth > nm.clientWidth + 0.5; k++) nm.style.fontSize = (parseFloat(nm.style.fontSize) * 0.92).toFixed(2) + 'px';
      }
    };
    requestAnimationFrame(run);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
  }
  grow(u) {
    this.u = u;
    if (!this.lay) return;
    const parentOf = new Map();
    this.S.steps.forEach(s => s.ins.forEach(i => parentOf.set(i, s.out)));
    for (const [id, e] of this.cards) e.classList.toggle('pre', u < this.appear.get(id) - 1e-9);
    for (const [id, e] of this.eqs) e.classList.toggle('pre', u < this.appear.get(id) - 1e-9);
    for (const [p, c, L] of this.paths) {
      const a = this.appear.get(parentOf.get(c)) || 1;
      const k = clamp((u - (a - 0.85 * this.dn)) / (0.7 * this.dn), 0, 1);
      p.style.strokeDashoffset = (L * (1 - k)).toFixed(1);
    }
  }
  // the node that grew last (the camera follows it)
  growing() {
    let best = -1, ba = -1;
    for (const [id, a] of this.appear) if (a <= this.u + 1e-9 && a > ba) { ba = a; best = id; }
    return best;
  }
  light(id) {
    const kids = new Set(); this.S && this.S.steps.forEach(s => { if (s.out === id) s.ins.forEach(i => kids.add(i)); });
    for (const [i, e] of this.cards) e.classList.toggle('lit', i === id);
    for (const [p, c] of this.paths) p.classList.toggle('lit', kids.has(c));
    for (const [o, e] of this.eqs) e.classList.toggle('lit', o === id);
  }
  // ── view ───────────────────────────────────────────────────────────────
  apply() { const v = this.view; this.inner.style.transform = `translate(${v.x.toFixed(1)}px,${v.y.toFixed(1)}px) scale(${v.s.toFixed(4)})`; }
  fit(anim = true) {
    if (!this.lay) return;
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight; if (!W || !H) return;
    const s = clamp(Math.min(W / (this.lay.w + 40), H / (this.lay.h + 60)), 0.2, 1.6);
    const to = { s, x: (W - this.lay.w * s) / 2, y: (H - this.lay.h * s) / 2 };
    this.tween(to, anim ? 450 : 0);
  }
  // the whole tree inside a rectangle of the wrap (the saver's clear band)
  fitRect(r) {
    if (!this.lay) return;
    const s = clamp(Math.min(r.w / (this.lay.w + 30), r.h / (this.lay.h + 50)), 0.15, 1.6);
    this.tween({ s, x: r.x + (r.w - this.lay.w * s) / 2, y: r.y + (r.h - this.lay.h * s) / 2 }, 0);
  }
  // a push-in on a node, centred in a rectangle of the wrap
  focusIn(id, r, k = 1.5, ms = 1400) {
    const b = this.lay && this.lay.fish[id]; if (!b) return;
    const s = clamp(Math.min(this.view.s * k, r.h * 0.6 / b.h), 0.15, 3);
    this.tween({ s, x: r.x + r.w / 2 - (b.x + b.w / 2) * s, y: r.y + r.h / 2 - (b.y + b.h / 2) * s }, ms);
  }
  // keep a node in view (growth playback, saver)
  focus(id, zoom = null, ms = 600) {
    const b = this.lay && this.lay.fish[id]; if (!b) return;
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight, s = zoom || this.view.s;
    this.tween({ s, x: W / 2 - (b.x + b.w / 2) * s, y: H / 2 - (b.y + b.h / 2) * s }, ms);
  }
  tween(to, ms) {
    cancelAnimationFrame(this._tw);
    if (!ms) { Object.assign(this.view, to); this.apply(); return; }
    const from = Object.assign({}, this.view), t0 = performance.now();
    const step = now => {
      const u = clamp((now - t0) / ms, 0, 1), e = u * u * (3 - 2 * u);
      for (const k of ['s', 'x', 'y']) this.view[k] = from[k] + (to[k] - from[k]) * e;
      this.apply();
      if (u < 1) this._tw = requestAnimationFrame(step);
    };
    this._tw = requestAnimationFrame(step);
  }
  zoomAt(k, px, py) {
    const v = this.view, s = clamp(v.s * k, 0.15, 3);
    v.x = px - (px - v.x) * s / v.s; v.y = py - (py - v.y) * s / v.s; v.s = s; this.apply();
  }
  bindPointer() {
    const w = this.wrap, pts = new Map();
    let start = null, pinch = null;
    w.addEventListener('pointerdown', e => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = false; this.dragging = true;
      start = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.view.s }; }
    });
    w.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = w.getBoundingClientRect();
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomAt(pinch.s * d / pinch.d / this.view.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        this.moved = true; this.user = true; return;
      }
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!this.moved && Math.hypot(dx, dy) < 6) return;
      if (!this.moved) { this.moved = true; try { w.setPointerCapture(e.pointerId); } catch (er) { /* none */ } w.classList.add('drag'); }
      this.user = true; cancelAnimationFrame(this._tw);
      this.view.x = start.vx + dx; this.view.y = start.vy + dy; this.apply();
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { this.dragging = false; w.classList.remove('drag'); } };
    w.addEventListener('pointerup', up); w.addEventListener('pointercancel', up);
    w.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && this.cb.leave) this.cb.leave(); });
    w.addEventListener('wheel', e => {
      e.preventDefault(); this.user = true; cancelAnimationFrame(this._tw);
      const r = w.getBoundingClientRect();
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }
}
