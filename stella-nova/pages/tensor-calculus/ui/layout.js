// ============================================================================
//  TENSOR CALCULUS  ·  ui/layout.js  ·  the view layout state machine (CORE)
// ----------------------------------------------------------------------------
//  The page has three views: 'tex' (the equation), 'viz' (the 3D scene) and
//  'diagram' (Penrose, birdtrack or network). A layout is the ordered list
//  of the views on screen, and the mode follows from the count:
//      3 views  'all'     viz large at the left, tex and diagram stacked
//      2 views  'pair'    side by side, in list order
//      1 view   'focus'   one view fills the stage
//  The diagram style goes with the layout, because the diagram header and
//  the dock both set it.
//
//  reduce(layout, spec) is pure. It never gives an empty list: a spec that
//  would remove the last view keeps the layout. applyLayout() is the DOM
//  half: it sets data-mode and data-views on the stage, orders the panes,
//  and animates each pane from its old box to its new box (FLIP, with the
//  Web Animations API). A pane that leaves fades out; a pane that comes in
//  fades and scales in. onSettled runs when the motion ends, so the 3D view
//  can resize its canvas once, not each frame.
//
//  SPECS for reduce()
//    'all' | 'tex' | 'viz' | 'diagram' | ['tex','viz'] | { focus } |
//    { views: [...] } | { toggle: 'viz' } | { style: 'network' } |
//    { swap: true } (reverse a pair) | { cycle: 1 | -1 } (phone swipe: the
//    focus view moves to the next or the last view in VIEWS)
//
//  EXPORTS   (grep -n "export" ui/layout.js)
//      VIEWS, STYLES, LABELS, initialLayout, reduce, modeOf, applyLayout
// ============================================================================

export const VIEWS = Object.freeze(['tex', 'viz', 'diagram']);
export const STYLES = Object.freeze(['penrose', 'birdtrack', 'network']);
export const LABELS = Object.freeze({ tex: 'Equation', viz: '3D', diagram: 'Diagram', penrose: 'Penrose', birdtrack: 'Birdtrack', network: 'Network' });

export function modeOf(views) { return views.length >= 3 ? 'all' : views.length === 2 ? 'pair' : 'focus'; }

export function initialLayout() { return { views: VIEWS.slice(), mode: 'all', style: 'penrose' }; }

function clean(list) {
  const out = [];
  for (const v of list || []) if (VIEWS.includes(v) && !out.includes(v)) out.push(v);
  return out;
}

function make(views, style) { return { views, mode: modeOf(views), style }; }

export function reduce(layout, spec) {
  const cur = layout || initialLayout();
  let views = cur.views.slice(), style = cur.style;
  if (spec == null) return make(views, style);
  if (typeof spec === 'string') {
    if (spec === 'all') views = VIEWS.slice();
    else if (VIEWS.includes(spec)) views = [spec];
    else if (STYLES.includes(spec)) style = spec;
    else throw new Error('unknown view spec ' + spec);
    return make(views, style);
  }
  if (Array.isArray(spec)) {
    const v = clean(spec);
    return make(v.length ? v : views, style);
  }
  if (typeof spec === 'object') {
    if (spec.style !== undefined) {
      if (!STYLES.includes(spec.style)) throw new Error('unknown diagram style ' + spec.style);
      style = spec.style;
    }
    if (spec.focus) { if (!VIEWS.includes(spec.focus)) throw new Error('unknown view ' + spec.focus); views = [spec.focus]; }
    if (spec.views) { const v = clean(spec.views); if (v.length) views = v; }
    if (spec.toggle) {
      if (!VIEWS.includes(spec.toggle)) throw new Error('unknown view ' + spec.toggle);
      if (views.includes(spec.toggle)) { if (views.length > 1) views = views.filter(v => v !== spec.toggle); }
      else views = VIEWS.filter(v => v === spec.toggle || views.includes(v));
    }
    if (spec.swap && views.length === 2) views = [views[1], views[0]];
    if (spec.cycle) {
      const at = VIEWS.indexOf(views[0]);
      const n = VIEWS.length;
      views = [VIEWS[((at + Math.sign(spec.cycle)) % n + n) % n]];
    }
    return make(views, style);
  }
  throw new Error('bad view spec');
}

// ---------------------------------------------------------------- DOM half
// stage: the grid element. panes: { tex, viz, diagram } elements. opts:
// { animate = true, ms = 420, onSettled }. Returns a promise for the end.
export function applyLayout(stage, panes, layout, opts = {}) {
  const { animate = true, ms = 420, onSettled } = opts;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = {};
  for (const k of VIEWS) if (panes[k] && !panes[k].hidden) before[k] = panes[k].getBoundingClientRect();
  stage.dataset.mode = layout.mode;
  stage.dataset.views = layout.views.join(' ');
  for (const k of VIEWS) {
    const el = panes[k]; if (!el) continue;
    const on = layout.views.includes(k);
    el.hidden = !on;
    el.style.order = on ? String(layout.views.indexOf(k)) : '';
    el.dataset.slot = on ? String(layout.views.indexOf(k)) : '';
    el.classList.toggle('is-focus', layout.mode === 'focus' && on);
  }
  const anims = [];
  if (animate && !reduced && typeof Element !== 'undefined' && Element.prototype.animate) {
    for (const k of layout.views) {
      const el = panes[k], a = before[k], b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (a && a.width && a.height) {
        const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width, sy = a.height / b.height;
        if (Math.abs(dx) + Math.abs(dy) < 1 && Math.abs(sx - 1) + Math.abs(sy - 1) < 0.01) continue;
        anims.push(el.animate([
          { transformOrigin: '0 0', transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` },
          { transformOrigin: '0 0', transform: 'none' },
        ], { duration: ms, easing: 'cubic-bezier(0.2,0.8,0.2,1)' }));
      } else {
        anims.push(el.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: ms, easing: 'ease-out' }));
      }
    }
  }
  const done = Promise.all(anims.map(an => an.finished.catch(() => {}))).then(() => { if (onSettled) onSettled(layout); return layout; });
  return done;
}
