// ============================================================================
//  BIOME PARTS  ·  ui.js — the panels
// ----------------------------------------------------------------------------
//  DOM only, no model, no GPU. main.js calls these with the goal and the
//  latest view from the brain (core.Runner.view).
//
//  ROWS KEEP THEIR ELEMENTS. A score row is keyed by its command and a check
//  by its index, so a new step moves and resizes the rows that are there:
//  a bar grows from its old width, a row slides to its new rank (FLIP, in
//  lib/forge-ui.js). Reduced motion turns the motion off.
//
//  GOAL CARDS. Item 1 is the base and stays first. The other cards drag by
//  their grip (pointer events, so touch works) or move with the arrow keys
//  on a focused grip. moveItem is the pure reorder that both paths call.
//
//  GREP MAP
//    moveItem ......... the pure reorder (item 1 is fixed)
//    renderGoal ....... goal cards: grip, kind, number wells, move, delete
//    dragCard ......... the pointer drag of one card
//    renderScores ..... softmax bars; a tap overrides Taiga's choice
//    renderChecks ..... the done head as a live checklist, one ring per item
//    renderTree ....... the feature tree: body, children, icons, twisties
//    renderLog ........ the command log, noise and overrides coloured
//    renderTicks ...... one tick per logged step under the scrubber
//    renderTokens ..... the live token strip in the explainer
//    renderEval ....... the eval table
//    actionLabel ...... a readable name for an action id
// ============================================================================
import { KIND_INFO, describe } from './goals.js';
import { measure, flip, reducedMotion } from '../../../lib/forge-ui.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svg = (paths, cls = 'i') => { const w = document.createElement('span'); w.className = cls; w.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`; return w; };
export function actionLabel(a) {
  if (!a) return '';
  return a.replace(/^PartDesign_/, '').replace(/^Sketcher_/, 'Sketch: ').replace(/^Std_Workbench:/, 'Workbench: ').replace(/^Std_/, '').replace(/^Select:/, 'Select ');
}
const shortType = t => t.replace(/^.*::/, '');
const anim = (e, kf, o) => { if (e && typeof e.animate === 'function' && !reducedMotion()) e.animate(kf, o); };
const EASE = 'cubic-bezier(0.16,1,0.3,1)';

// ── goal cards ──────────────────────────────────────────────────────────────
export function moveItem(arr, from, to) {
  if (from < 1 || to < 1 || from >= arr.length || to >= arr.length || from === to) return false;
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return true;
}
const GRIP = '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>';

export function renderGoal(root, goal, { onChange, active = -1, built = -1 }) {
  const before = measure([...root.children].map(li => [li._f, li]));
  const focusKey = root._focus; root._focus = null;
  root.textContent = '';
  const pairs = [];
  goal.features.forEach((f, i) => {
    const info = KIND_INFO[f.kind] || { group: 'top', params: [] };
    const li = el('li', 'card sq g-' + info.group);
    li._f = f; li.dataset.i = i;
    if (i === active) li.classList.add('active');
    if (i < built) li.classList.add('built');
    const h = el('div', 'ih');
    if (i > 0) {
      const g = el('button', 'grip'); g.type = 'button'; g.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GRIP}</svg>`;
      g.setAttribute('aria-label', `Move item ${i + 1}: drag, or press the up and down arrows`);
      g.addEventListener('pointerdown', e => dragCard(e, root, li, i, goal, onChange));
      g.onkeydown = e => {
        const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
        if (to < 0) return;
        e.preventDefault();
        if (moveItem(goal.features, i, to)) { root._focus = f; onChange(); }
      };
      h.append(g);
    } else h.append(el('span', 'grip fixed', ''));
    h.append(el('span', 'ix', String(i + 1)));
    const sel = el('select', 'ik');
    for (const [k, inf] of Object.entries(KIND_INFO)) {
      if ((i === 0) !== (inf.group === 'base')) continue;
      const o = el('option', null, inf.label); o.value = k; if (k === f.kind) o.selected = true; sel.append(o);
    }
    sel.setAttribute('aria-label', 'Kind of item ' + (i + 1));
    sel.onchange = () => { const k = sel.value; const p = {}; for (const [key, , lo, hi] of KIND_INFO[k].params) p[key] = f.params[key] ?? Math.round(((lo + hi) / 4) * 10) / 10; goal.features[i] = { kind: k, params: p }; onChange(); };
    h.append(sel);
    if (i > 0) {
      const up = el('button', 'ib'); up.type = 'button'; up.title = 'Move up'; up.disabled = i === 1; up.setAttribute('aria-label', 'Move item ' + (i + 1) + ' up');
      up.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg>';
      up.onclick = () => { moveItem(goal.features, i, i - 1); onChange(); };
      const del = el('button', 'ib del'); del.type = 'button'; del.title = 'Remove'; del.setAttribute('aria-label', 'Remove item ' + (i + 1));
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
      del.onclick = () => {
        const go = () => { goal.features.splice(i, 1); onChange(); };
        if (typeof li.animate === 'function' && !reducedMotion()) li.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }], { duration: 160, easing: 'ease-in' }).finished.then(go, go);
        else go();
      };
      h.append(up, del);
    }
    li.append(h);
    const ps = el('div', 'ps');
    for (const [key, label, lo, hi, step] of info.params) {
      const lab = el('label', 'well'); lab.append(el('span', null, label));
      const inp = el('input'); inp.type = 'number'; inp.min = lo; inp.max = hi; inp.step = step; inp.value = f.params[key] ?? '';
      inp.inputMode = 'decimal';
      inp.onchange = () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) { f.params[key] = Math.min(hi, Math.max(lo, v)); onChange(); } };
      lab.append(inp); ps.append(lab);
    }
    if (ps.children.length) li.append(ps);
    li.title = describe(f);
    root.append(li);
    pairs.push([f, li]);
    if (!before.size || before.has(f)) return;
    anim(li, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE });
  });
  flip(before, pairs);
  if (focusKey) { const p = pairs.find(([f]) => f === focusKey); const g = p && p[1].querySelector('.grip'); if (g) g.focus(); }
}

// One card follows the pointer; the others make room. On release the goal
// is reordered (moveItem) and redrawn, and FLIP settles every card.
function dragCard(e, root, li, from, goal, onChange) {
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  const grip = e.currentTarget;
  try { grip.setPointerCapture(e.pointerId); } catch (err) { /* jsdom */ }
  const items = [...root.children], rects = items.map(x => x.getBoundingClientRect());
  const gap = items.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 6;
  const span = rects[from].height + gap, y0 = e.clientY;
  let to = from;
  li.classList.add('dragging'); root.classList.add('sorting');
  const move = ev => {
    const dy = ev.clientY - y0;
    li.style.transform = `translateY(${dy}px)`;
    const mid = rects[from].top + rects[from].height / 2 + dy;
    to = 1;
    for (let j = 1; j < items.length; j++) if (j !== from && rects[j].top + rects[j].height / 2 < mid) to++;
    to = Math.min(items.length - 1, to);
    items.forEach((x, j) => {
      if (j === from) return;
      x.style.transform = j > from && j <= to ? `translateY(${-span}px)` : j < from && j >= to ? `translateY(${span}px)` : '';
    });
  };
  const up = () => {
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
    root.classList.remove('sorting');
    if (moveItem(goal.features, from, to)) onChange();
    else { li.classList.remove('dragging'); for (const x of items) x.style.transform = ''; }
  };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
}

// ── scores ──────────────────────────────────────────────────────────────────
export function renderScores(root, view, { onPick, took, limit = 9 }) {
  const d = view && view.decision;
  if (!d) { root.textContent = ''; root.append(el('li', 'more', view && view.finished ? 'Finished.' : 'Press Build, then Step or Play.')); return; }
  const rows = root.dataset.all === '1' ? d.rows : d.rows.slice(0, limit);
  const old = new Map();
  for (const li of root.children) if (li._a) old.set(li._a, li);
  const before = measure([...old]);
  const out = [];
  rows.forEach((r, i) => {
    let li = old.get(r.a);
    const fresh = !li;
    if (fresh) {
      li = el('li'); li._a = r.a; li._w = 0; li.tabIndex = 0;
      li.append(el('span', 'bar'), el('span', 't'), el('span', 'a', actionLabel(r.a)), el('span', 'v'));
    }
    li.className = (i === 0 ? 'top' : '') + (took === r.a ? ' took' : '');
    const [bar, t, , v] = li.children;
    const w = 100 * r.p;
    bar.style.width = w.toFixed(1) + '%';
    anim(bar, [{ width: li._w.toFixed(1) + '%' }, { width: w.toFixed(1) + '%' }], { duration: 420, easing: EASE });
    li._w = w;
    t.className = 't' + (r.teacher ? ' on' : ''); t.title = r.teacher ? 'the scripted teacher accepts this' : '';
    v.textContent = r.p.toFixed(3);
    li.title = `${r.a}  logit ${r.z.toFixed(2)}  p(T=1) ${r.p1.toFixed(4)}`;
    li.onclick = () => onPick(r.a);
    li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r.a); } };
    out.push(li);
  });
  root.textContent = '';
  for (const li of out) root.append(li);
  if (d.rows.length > limit) {
    const m = el('li', 'more', root.dataset.all === '1' ? 'show fewer' : `+ ${d.rows.length - limit} more options`);
    m.onclick = () => { root.dataset.all = root.dataset.all === '1' ? '0' : '1'; renderScores(root, view, { onPick, took, limit }); };
    root.append(m);
  }
  flip(before, out.map(li => [li._a, li]));
}

// ── done checks ─────────────────────────────────────────────────────────────
const sig = z => 1 / (1 + Math.exp(-z));
const RING_C = 2 * Math.PI * 8;
function checkRow() {
  const li = el('li');
  const ck = el('span', 'ck');
  ck.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="rb" cx="10" cy="10" r="8"/><circle class="rf" cx="10" cy="10" r="8" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/><path class="tick" d="m6.2 10.3 2.6 2.6 5-5.4"/></svg>`;
  li.append(ck, el('span', 'm'), el('span', 'pct'));
  return li;
}
export function renderChecks(root, goal, view) {
  const d = view && view.decision;
  const n = goal.features.length;
  if (root.children.length !== n + 1 || root.dataset.n !== String(n)) {
    root.textContent = '';
    for (let i = 0; i <= n; i++) root.append(checkRow());
    root.dataset.n = String(n);
  }
  const rows = [...root.children];
  goal.features.forEach((f, i) => {
    const li = rows[i];
    const z = d ? d.done[i] : null;
    const yes = z != null && z >= 0, s = z == null ? 0 : sig(z);
    const was = li.classList.contains('yes');
    li.className = (yes ? 'yes' : '') + (d && d.active === i ? ' active' : '') + (z == null ? ' idle' : '');
    li.children[1].textContent = `${i + 1}. ${describe(f)}`;
    li.children[2].textContent = z == null ? '' : Math.round(100 * s) + '%';
    li.querySelector('.rf').setAttribute('stroke-dashoffset', (RING_C * (1 - s)).toFixed(2));
    li.title = z == null ? '' : `done logit ${z.toFixed(2)}`;
    if (yes && !was) anim(li.children[0], [{ transform: 'scale(0.6)' }, { transform: 'scale(1.15)' }, { transform: 'none' }], { duration: 360, easing: EASE });
  });
  const end = rows[n];
  end.className = 'endrow' + (d && d.active === n ? ' active' : '');
  end.children[1].textContent = 'END: every item built, say Done';
  end.children[1].className = 'm end';
  end.children[2].textContent = '';
  end.querySelector('.rf').setAttribute('stroke-dashoffset', d && d.active === n ? '0' : RING_C.toFixed(2));
}

// ── feature tree ────────────────────────────────────────────────────────────
const ICONS = {
  Body: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  SketchObject: '<path d="M4 20h16"/><path d="m14.5 5.5 4 4L9 19H5v-4z"/>',
  Pad: '<path d="M5 15h14v4H5z"/><path d="M12 13V4M8.5 7.5 12 4l3.5 3.5"/>',
  Pocket: '<path d="M4 9h5v5h6V9h5v10H4z"/>',
  Hole: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/>',
  Revolution: '<path d="M12 4v16"/><path d="M17.5 8A7 3 0 1 1 6.5 8"/><path d="m17.5 8-.3 3M17.5 8l-2.9.6"/>',
  Groove: '<path d="M4 7h16v10H4z"/><path d="M9 7v4h6V7"/>',
  Fillet: '<path d="M5 19V9a4 4 0 0 1 4-4h10"/>',
  Chamfer: '<path d="M5 19V10l5-5h9"/>',
  Draft: '<path d="M7 19 9 5h6l2 14z"/>',
  Thickness: '<path d="M4 6h16v13H4z"/><path d="M7 9h10v7H7z"/>',
  PolarPattern: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="5" r="1.6"/><circle cx="18" cy="15.5" r="1.6"/><circle cx="6" cy="15.5" r="1.6"/>',
  LinearPattern: '<rect x="3" y="9" width="4.5" height="6" rx="1"/><rect x="9.75" y="9" width="4.5" height="6" rx="1"/><rect x="16.5" y="9" width="4.5" height="6" rx="1"/>',
  Mirrored: '<path d="M12 3v18"/><path d="M9 7 4 12l5 5zM15 7l5 5-5 5z"/>',
  Plane: '<path d="m3 15 6-7h12l-6 7z"/>',
  Box: '<path d="M4 8h12v12H4z"/><path d="m4 8 4-4h12v12l-4 4M16 8l4-4"/>',
  Cylinder: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12a7 2.5 0 0 0 14 0V6"/>',
};
const TWIST = '<path d="m9 6 6 6-6 6"/>';
export function renderTree(root, view) {
  root.textContent = '';
  if (!view) return;
  if (!view.docOpen) { root.append(el('li', 'empty', '(no document)')); return; }
  const known = root._known, now = new Set();
  const shut = root._shut || (root._shut = new Set());
  let parent = null;
  for (const n of view.tree) {
    const ty = shortType(n.type);
    const li = el('li', `node d${n.depth}${n.tip ? ' tip' : ''}${n.edit ? ' edit' : ''}${n.valid ? '' : ' bad'}${n.consumed ? ' used' : ''}`);
    li.setAttribute('role', 'treeitem');
    const row = el('div', 'row');
    const tw = el('button', 'tw'); tw.type = 'button'; tw.tabIndex = -1; tw.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TWIST}</svg>`;
    row.append(tw, svg(ICONS[ty] || ICONS.Plane, 'ti'), el('span', 'nm', n.name), el('span', 'ty', ty));
    if (n.tip) row.append(el('span', 'tag tip', 'tip'));
    if (n.edit) row.append(el('span', 'tag edit', 'editing'));
    if (n.consumed) row.append(el('span', 'tag used', 'used'));
    if (!n.valid) row.append(el('span', 'tag err', 'error'));
    li.append(row);
    li.title = n.type;
    now.add(n.name);
    if (known && !known.has(n.name)) li.classList.add('new');
    if (n.depth > 0 && parent) {
      let kids = parent._kids;
      if (!kids) {
        kids = parent._kids = el('ol', 'kids'); kids.setAttribute('role', 'group'); parent.append(kids);
        const p = parent, name = p._name, ptw = p.querySelector('.tw');
        p.classList.add('has-kids'); ptw.tabIndex = 0; ptw.setAttribute('aria-label', 'Fold ' + name);
        p.setAttribute('aria-expanded', shut.has(name) ? 'false' : 'true');
        ptw.onclick = () => { const o = p.getAttribute('aria-expanded') === 'true'; p.setAttribute('aria-expanded', o ? 'false' : 'true'); if (o) shut.add(name); else shut.delete(name); };
      }
      kids.append(li);
    } else { root.append(li); parent = li; li._name = n.name; }
  }
  root._known = now;
  if (!view.tree.length) root.append(el('li', 'empty', '(empty document)'));
}

export function renderLog(root, log) {
  root.textContent = '';
  for (const l of log.slice(-200)) {
    const li = el('li', l.kind === 'noise' ? 'noise' : l.kind === 'user' ? 'user' : l.onPlan ? '' : 'off');
    li.append(el('span', 'n', String(l.step)), el('span', null, actionLabel(l.action) + (l.score != null ? `  ${l.score.toFixed(2)}` : '') + (l.kind === 'noise' ? '  (gremlin)' : l.kind === 'user' ? '  (you)' : '') + (l.error ? '  !' : '')));
    li.title = l.action + (l.error ? ' — ' + l.error : '');
    root.append(li);
  }
  root.scrollTop = root.scrollHeight;
}

// One tick per logged step; ticks past `at` are the replayable future.
export function renderTicks(root, tape, at) {
  const n = tape.length;
  if (root._n !== n || root._tape !== tape) {
    root.textContent = '';
    for (const l of tape.slice(0, 400)) root.append(el('i', l.kind === 'noise' ? 'noise' : l.kind === 'user' ? 'user' : l.error ? 'err' : l.onPlan === false ? 'off' : ''));
    root._n = n; root._tape = tape;
  }
  [...root.children].forEach((t, j) => t.classList.toggle('ghost', j >= at));
}

const SEG_NAME = ['CLS', 'GLOBAL', 'NODE', 'SEL', 'RECENT', 'TARGET', 'GOAL'];
// The token strip, rebuilt from the view summary in encode order.
export function renderTokens(root, view) {
  root.textContent = '';
  if (!view || !view.decision) { root.append(el('span', null, 'Build a part to see its tokens.')); return; }
  const parts = [['s0', 'CLS'], ['s1', `GLOBAL ${view.workbench.replace('Workbench', '')}`]];
  for (const n of view.tree) parts.push(['s2', shortType(n.type) + (n.tip ? '*' : '')]);
  for (const s of view.selection) parts.push(['s3', `sel ${s.kind}`]);
  for (const a of [...view.recent].reverse()) parts.push(['s4', actionLabel(a)]);
  parts.push(['s5', 'TARGET']);
  view.goal.features.forEach((f, i) => parts.push(['s6', `${i + 1} ${f.kind}`]));
  parts.push(['s6', 'END']);
  for (const [c, t] of parts) root.append(el('span', c, t));
  root.title = `${view.decision.tokens} tokens; colours: ${SEG_NAME.join(', ')}`;
}

export function renderEval(table, rows) {
  table.textContent = '';
  const head = el('tr');
  for (const h of ['Suite', 'Items', 'Repo, clean', 'This page, clean', 'Repo, 20% random', 'This page, 20% random']) head.append(el('th', null, h));
  const th = el('thead'); th.append(head); table.append(th);
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    for (const c of [r.name, r.items, r.repo, r.js, r.repoP, r.jsP]) tr.append(el('td', null, c == null ? '–' : typeof c === 'number' ? c + '%' : c));
    tb.append(tr);
  }
  table.append(tb);
}
