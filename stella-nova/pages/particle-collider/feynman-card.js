// ============================================================================
//  PARTICLE COLLIDER  ·  feynman-card.js — the Feynman diagram card
// ----------------------------------------------------------------------------
//  The DOM side of feynman.js. The card (#feyn in index.html) shows the
//  leading-order diagram of the current event, a one-line description and
//  the couplings of its vertices. Desktop: a card over the top right of the
//  views, with a fold button. Phone: one of the lower views (#vtabs).
//
//  createFeynCard(root, { onHover(key), onSelect(key) }) -> card
//    card.show(ev, t) ... a new event: diagram, text, couplings; the lines
//                         as far as the drawing front at event time t
//    card.setTime(t) .... moves the drawing front: the path data and the
//                         opacities change in place (feynman.js drawState)
//    card.focus(key) .... the page focus (an object key of picking.js); the
//                         lines of that object brighten, the rest dim
//    card.diagram ....... the diagram on show (feynman.js diagramFor)
//  LABELS  MathJax SVG through lib/sci-math.js loadMath (never KaTeX). Until
//    MathJax loads, or when it fails, the labels are <text> in STIX Two Text.
//  POINTER  a final-state line with a detector object (lineObjects) takes
//    hover and click: the page focuses or selects that object.
//
//  GREP MAP  function render · function apply · card.show · card.setTime
// ============================================================================
import { diagramFor, toSVG, frontAt, drawState, couplingText, lineObjects } from './feynman.js';
import { loadMath } from '../../lib/sci-math.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createFeynCard(root, o = {}) {
  const $q = s => root.querySelector(s);
  const box = $q('.fy-svg'), body = $q('.fy-body'), title = $q('.fy-title'), text = $q('.fy-text'), cpl = $q('.fy-cpl'), note = $q('.fy-note');
  // TeX -> MathJax SVG string; null: MathJax failed on it (the <text> fallback)
  const tex = new Map();
  let d = null, keys = [], X = -Infinity, els = null, focusKey = '', gen = 0;

  async function typesetAll(list) {
    const MJ = await loadMath();
    if (!MJ) return false;
    for (const t of list) {
      if (tex.has(t)) continue;
      try {
        const node = await MJ.tex2svgPromise(t, { display: false });
        const svg = node.querySelector('svg');
        tex.set(t, svg && !node.querySelector('[data-mjx-error], merror, [data-mml-node="merror"], [fill="red"]') ? svg.outerHTML : null);
      } catch (e) { tex.set(t, null); }
    }
    return true;
  }
  const texSVG = t => tex.get(t) || null;

  function render() {
    const out = toSVG(d, { tex: texSVG, front: X, pad: 8, minH: 100 });
    box.innerHTML = out.svg;
    const s = box.firstElementChild;
    s.removeAttribute('width'); s.removeAttribute('height');
    s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', `Feynman diagram: ${d.title}`);
    s.style.aspectRatio = `${out.w} / ${out.h}`;
    const by = sel => { const m = new Map(); s.querySelectorAll(sel).forEach(e => m.set(+e.dataset.i, e)); return m; };
    els = { svg: s, path: by('.fy-l'), arrow: by('.fy-a'), label: by('.fy-t'), vert: new Map([...s.querySelectorAll('.fy-v')].map(e => [e.dataset.n, e])) };
    // only the lines with a detector object take the pointer
    s.querySelectorAll('.fy-hit').forEach(e => { if (!keys[+e.dataset.i]) e.remove(); else e.style.cursor = 'pointer'; });
    paintFocus();
  }
  // the drawing front at X: path data and opacities in place
  function apply() {
    if (!els) return;
    const st = drawState(d, X);
    for (const L of st.lines) {
      const p = els.path.get(L.i); if (p) p.setAttribute('d', L.d);
      const a = els.arrow.get(L.i); if (a) a.setAttribute('opacity', L.arrow ? '1' : '0');
      const t = els.label.get(L.i); if (t) t.setAttribute('opacity', L.label ? '1' : '0');
    }
    for (const n of st.nodes) { const v = els.vert.get(n.id); if (v) v.setAttribute('opacity', n.on ? '1' : '0'); }
  }
  function paintFocus() {
    if (!els) return;
    const on = focusKey && keys.includes(focusKey);
    els.svg.classList.toggle('has-focus', !!on);
    for (const [i, p] of els.path) p.classList.toggle('on', !!on && keys[i] === focusKey);
    for (const [i, t] of els.label) t.classList.toggle('on', !!on && keys[i] === focusKey);
  }

  // pointer: hover and click on the clear hit strokes
  const keyAt = e => { const h = e.target.closest && e.target.closest('.fy-hit'); return h ? keys[+h.dataset.i] || null : null; };
  box.addEventListener('pointerover', e => { if (e.pointerType !== 'touch' && o.onHover) o.onHover(keyAt(e)); });
  box.addEventListener('pointerout', e => { if (e.pointerType !== 'touch' && o.onHover && keyAt(e)) o.onHover(null); });
  box.addEventListener('click', e => { const k = keyAt(e); if (k && o.onSelect) o.onSelect(k); });

  // the fold button (desktop): the card shrinks to its header
  const fold = $q('.fy-fold');
  const setFold = f => {
    root.classList.toggle('folded', f);
    if (fold) { fold.setAttribute('aria-expanded', String(!f)); fold.textContent = f ? 'Show' : 'Hide'; }
  };
  if (fold) fold.addEventListener('click', () => { const f = !root.classList.contains('folded'); setFold(f); if (o.onFold) o.onFold(f); });

  const card = {
    get diagram() { return d; },
    get keys() { return keys; },
    setFold,
    show(ev, t = -4) {
      const my = ++gen;
      d = diagramFor(ev.info);
      keys = lineObjects(d, ev.info, ev.objs ? ev.objs.objs : []);
      X = frontAt(d, t);
      title.textContent = d.title;
      text.textContent = d.text;
      note.textContent = d.note || '';
      note.hidden = !d.note;
      const cs = couplingText(d);
      const fillCpl = () => {
        cpl.innerHTML = cs.length
          ? `<span class="fy-k">Couplings</span> ${cs.map(c => `<span class="fy-c">${texSVG(c.tex) ? `<span class="fy-sym">${texSVG(c.tex)}</span>` : ''}${esc(c.text)}</span>`).join('<span class="fy-sep"> · </span>')}`
          : '<span class="fy-k">Couplings</span> none: one particle and no vertex';
      };
      fillCpl();
      render();
      const want = [...new Set([...d.lines.filter(L => L.label).map(L => L.tex), ...cs.map(c => c.tex)])];
      if (want.some(w => !tex.has(w))) typesetAll(want).then(ok => { if (ok && my === gen) { render(); fillCpl(); } });
    },
    setTime(t) {
      if (!d || !body.getClientRects().length) return;   // folded, or another phone view
      const nx = frontAt(d, t);
      if (Math.abs(nx - X) < 0.2) return;
      X = nx; apply();
    },
    focus(key) { focusKey = key || ''; paintFocus(); },
  };
  return card;
}
