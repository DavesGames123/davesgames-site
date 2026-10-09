// ============================================================================
//  BIOME PARTS  ·  ui.js — the panels
// ----------------------------------------------------------------------------
//  DOM only, no model, no GPU. main.js calls these with the goal and the
//  latest view from the brain (core.Runner.view).
//
//  GREP MAP
//    renderGoal ....... goal items with number fields, move and delete
//    renderScores ..... softmax bars; a tap overrides Taiga's choice
//    renderChecks ..... the done head, one row per goal item + END
//    renderTree ....... the feature tree, tip and edit marked
//    renderLog ........ the command log, noise and overrides coloured
//    renderTokens ..... the live token strip in the explainer
//    renderEval ....... the eval table
//    actionLabel ...... a readable name for an action id
// ============================================================================
import { KIND_INFO, describe } from './goals.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export function actionLabel(a) {
  if (!a) return '';
  return a.replace(/^PartDesign_/, '').replace(/^Sketcher_/, 'Sketch: ').replace(/^Std_Workbench:/, 'Workbench: ').replace(/^Std_/, '').replace(/^Select:/, 'Select ');
}
const shortType = t => t.replace(/^.*::/, '');

export function renderGoal(root, goal, { onChange, active = -1, built = -1 }) {
  root.textContent = '';
  goal.features.forEach((f, i) => {
    const li = el('li');
    if (i === active) li.classList.add('active');
    if (i < built) li.classList.add('built');
    const h = el('div', 'ih');
    h.append(el('span', 'ix', String(i + 1)));
    const sel = el('select', 'ik');
    for (const [k, info] of Object.entries(KIND_INFO)) {
      if ((i === 0) !== (info.group === 'base')) continue;
      const o = el('option', null, info.label); o.value = k; if (k === f.kind) o.selected = true; sel.append(o);
    }
    sel.setAttribute('aria-label', 'Kind of item ' + (i + 1));
    sel.onchange = () => { const k = sel.value; const p = {}; for (const [key, , lo, hi] of KIND_INFO[k].params) p[key] = f.params[key] ?? Math.round(((lo + hi) / 4) * 10) / 10; goal.features[i] = { kind: k, params: p }; onChange(); };
    h.append(sel);
    if (i > 0) {
      const up = el('button', 'ib', '↑'); up.type = 'button'; up.title = 'Move up'; up.disabled = i === 1;
      up.onclick = () => { [goal.features[i - 1], goal.features[i]] = [goal.features[i], goal.features[i - 1]]; onChange(); };
      const del = el('button', 'ib', '×'); del.type = 'button'; del.title = 'Remove';
      del.onclick = () => { goal.features.splice(i, 1); onChange(); };
      h.append(up, del);
    }
    li.append(h);
    const ps = el('div', 'ps');
    for (const [key, label, lo, hi, step] of KIND_INFO[f.kind].params) {
      const lab = el('label'); lab.append(el('span', null, label));
      const inp = el('input'); inp.type = 'number'; inp.min = lo; inp.max = hi; inp.step = step; inp.value = f.params[key] ?? '';
      inp.onchange = () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) { f.params[key] = Math.min(hi, Math.max(lo, v)); onChange(); } };
      lab.append(inp); ps.append(lab);
    }
    if (ps.children.length) li.append(ps);
    li.title = describe(f);
    root.append(li);
  });
}

export function renderScores(root, view, { onPick, took, limit = 9 }) {
  root.textContent = '';
  const d = view && view.decision;
  if (!d) { root.append(el('li', 'more', view && view.finished ? 'Finished.' : 'Press Build, then Step or Play.')); return; }
  const rows = root.dataset.all === '1' ? d.rows : d.rows.slice(0, limit);
  rows.forEach((r, i) => {
    const li = el('li');
    if (i === 0) li.classList.add('top');
    if (took === r.a) li.classList.add('took');
    const bar = el('span', 'bar'); bar.style.width = (100 * r.p).toFixed(1) + '%';
    const t = el('span', 't' + (r.teacher ? ' on' : '')); t.title = r.teacher ? 'the scripted teacher accepts this' : '';
    li.append(bar, t, el('span', 'a', actionLabel(r.a)), el('span', 'v', r.p.toFixed(3)));
    li.title = `${r.a}  logit ${r.z.toFixed(2)}  p(T=1) ${r.p1.toFixed(4)}`;
    li.tabIndex = 0;
    li.onclick = () => onPick(r.a);
    li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r.a); } };
    root.append(li);
  });
  if (d.rows.length > limit) {
    const m = el('li', 'more', root.dataset.all === '1' ? 'show fewer' : `+ ${d.rows.length - limit} more options`);
    m.onclick = () => { root.dataset.all = root.dataset.all === '1' ? '0' : '1'; renderScores(root, view, { onPick, took, limit }); };
    root.append(m);
  }
}

const sig = z => 1 / (1 + Math.exp(-z));
export function renderChecks(root, goal, view) {
  root.textContent = '';
  const d = view && view.decision;
  goal.features.forEach((f, i) => {
    const li = el('li');
    const z = d ? d.done[i] : null;
    const yes = z != null && z >= 0;
    if (yes) li.classList.add('yes');
    if (d && d.active === i) li.classList.add('active');
    li.append(el('span', 'ck', z == null ? '·' : yes ? '✓' : '○'), el('span', 'm', `${i + 1}. ${describe(f)}`));
    const g = el('span', 'g'), b = el('i'); b.style.width = (z == null ? 0 : 100 * sig(z)).toFixed(0) + '%'; g.append(b); li.append(g);
    li.title = z == null ? '' : `done logit ${z.toFixed(2)}`;
    root.append(li);
  });
  const end = el('li', d && d.active === goal.features.length ? 'active' : '');
  end.append(el('span', 'ck', '∎'), el('span', 'm end', 'END: every item built, say Done'));
  root.append(end);
}

export function renderTree(root, view) {
  root.textContent = '';
  if (!view) return;
  if (!view.docOpen) { root.append(el('li', null, '(no document)')); return; }
  for (const n of view.tree) {
    const li = el('li', `d${n.depth}${n.tip ? ' tip' : ''}${n.edit ? ' edit' : ''}${n.valid ? '' : ' bad'}`);
    li.append(el('span', null, n.name), el('span', 'ty', shortType(n.type) + (n.tip ? ' · tip' : '') + (n.edit ? ' · editing' : '') + (n.consumed ? ' · used' : '') + (n.valid ? '' : ' · error')));
    root.append(li);
  }
  if (!view.tree.length) root.append(el('li', null, '(empty document)'));
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
