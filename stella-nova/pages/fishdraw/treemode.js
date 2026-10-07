// ============================================================================
//  FISHDRAW  ·  treemode.js — the "Tree of life" mode of the page
// ----------------------------------------------------------------------------
//  Our own code around fishdraw by Lingdong Huang (MIT, LICENSE-fishdraw.txt).
//  main.js owns the canvas, the view (pan, zoom), the plate and the panel.
//  This module owns the tree state S.tr and the tree controls:
//    build()      a new tree from the specimen (S.name, S.params) and the
//                 rates; the pool draws every node in time order (tag
//                 'tree<n>'), so the fish come in as the tree grows
//    tick(dt)     playback: tau runs from 0 to T_MAX * GROW_OVER
//    draw()       treedraw.js drawTree in the plate content box
//    tap(x, y)    select the node under a plate point (mm): the lineage
//                 lights up and the card shows the fish and its changes
//  The root of the tree is always the specimen of single mode. "Evolve
//  from here" makes the selected node the specimen and grows a new tree.
//
//  GREP MAP
//    grep -n 'function build'      the model and the fish jobs
//    grep -n 'function layoutFor'  the layout in the plate content box
//    grep -n 'function select'     selection, lineage, card
//    grep -n 'function fillCard'   the card text and the large fish
//    grep -n 'function bind'       the tree controls
// ============================================================================
import { buildTree, layoutTree, lineage, paramChanges, cladeName, maAgo, T_MAX, TIP_CAP } from './tree.js';
import { drawTree, hitTree, treeSVG, GROW_OVER } from './treedraw.js';
import { drawPlate } from './render.js';
import { THEMES } from './plate.js';
import { PARAMS } from './engine.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const TAU_END = T_MAX * GROW_OVER;

export function createTreeMode(M) {
  const { S, $ } = M;
  const T = S.tr = {
    seed: (Math.random() * 4294967295) >>> 0 || 1, layout: 'clado', xMode: 'time',
    mut: 1, spec: 1, ext: 1, tips: 20, rad: true, anc: true, names: true,
    tau: 0, playing: false, speed: 0.5, tree: null, rootKey: '', fish: new Map(), tag: '', seq: 0,
    sel: -1, line: new Set(), layKey: '', lay: null,
  };
  const keyOf = (name, p) => name + '|' + PARAMS.map(d => p[d.key]).join(',');
  const growSecs = () => 60 * Math.pow(0.08, T.speed);   // 60 s .. 4.8 s

  // ── build ─────────────────────────────────────────────────────────────────
  function build(grow = true) {
    if (!M.E() || !S.params) return;
    if (T.tag) M.pool().cancel(T.tag);
    const tag = T.tag = 'tree' + (++T.seq);
    T.tree = buildTree({ E: M.E(), rootName: S.name, rootParams: S.params, seed: T.seed, mut: T.mut, spec: T.spec, ext: T.ext, maxTips: T.tips, radiations: T.rad });
    T.rootKey = keyOf(S.name, S.params);
    T.fish = new Map(); T.sel = -1; T.line = new Set(); T.lay = null; T.layKey = '';
    T.tau = grow ? 0 : TAU_END; T.playing = grow;
    $('treeCard').hidden = true;
    const order = T.tree.nodes.slice().sort((a, b) => a.t - b.t);
    for (const n of order) {
      M.pool().draw(n.name, n.id === 0 && !M.edited() ? null : n.params, false, 20 + Math.round(n.t), tag)
        .then(f => { if (T.tag === tag) { T.fish.set(n.id, f); M.dirty(); M.busy(); } })
        .catch(() => { /* cancelled */ });
    }
    syncUI(); M.dirty(); M.writeHash();
  }
  // The specimen changed (edit, new fish, history): grow a tree from it.
  function onSpecimen() { if (S.mode === 'tree' && (!T.tree || T.rootKey !== keyOf(S.name, S.params))) build(true); }

  // ── layoutFor ─────────────────────────────────────────────────────────────
  function layoutFor(L) {
    const C = L.content, k = [T.seq, T.layout, T.xMode, C.x, C.y, C.w, C.h].map(v => (typeof v === 'number' ? v.toFixed(3) : v)).join('|');
    if (k !== T.layKey) { T.layKey = k; T.lay = layoutTree(T.tree, T.layout, { w: C.w, h: C.h, ox: C.x, oy: C.y, xMode: T.xMode }); }
    return T.lay;
  }
  function plateText() {
    if (!T.tree) return { title: 'Tree of life', sub: '' };
    const n = T.tree.nodes, living = n.filter(q => q.kind === 'tip').length, gone = n.filter(q => q.kind === 'extinct').length;
    return { title: 'The ' + cladeName(n[0].genus), sub: `${living} living and ${gone} extinct species, grown from ${n[0].name}` };
  }
  function draw(ctx, L, view, extra = {}) {
    if (!T.tree) return;
    const lay = layoutFor(L);
    drawTree(ctx, Object.assign({
      tree: T.tree, lay, view, theme: THEMES[S.theme], ink: S.ink, pen: S.pen, jitter: S.jitter, dpr: S.dpr,
      tau: T.tau, fishFor: id => T.fish.get(id) || null, anc: T.anc, names: T.names, sel: T.sel, line: T.line, xMode: T.xMode,
    }, extra));
  }
  function tick(dt) {
    if (!T.playing || !T.tree) return false;
    T.tau = Math.min(TAU_END, T.tau + dt * TAU_END / growSecs());
    if (T.tau >= TAU_END) { T.playing = false; syncPlay(); }
    syncScrub();
    return true;
  }

  // ── select ────────────────────────────────────────────────────────────────
  function tap(x, y, L, view) {
    if (!T.tree) return;
    const lay = layoutFor(L), tol = 10 * S.dpr / view.s;
    const id = hitTree(T.tree, lay, x, y, tol, T.anc);
    select(id);
  }
  function select(id) {
    T.sel = id;
    T.line = id >= 0 ? new Set(lineage(T.tree, id)) : new Set();
    if (id >= 0) fillCard(); else $('treeCard').hidden = true;
    M.dirty();
  }
  function kindText(q) {
    const era = (T.tree.eras.find(e => q.t >= e.t0 && q.t <= e.t1) || {}).name || '';
    if (q.kind === 'tip') return 'Living today';
    if (q.kind === 'extinct') return `Extinct ${maAgo(q.t)} Ma, ${era}`;
    if (q.kind === 'root') return `The ancestor, ${maAgo(0)} Ma, ${era}`;
    return `Split ${maAgo(q.t)} Ma, ${era}` + (q.radiation ? ' · a radiation' : '');
  }
  // ── fillCard ──────────────────────────────────────────────────────────────
  function fillCard() {
    const q = T.tree.nodes[T.sel], root = T.tree.nodes[0];
    $('treeCard').hidden = false;
    $('cardName').innerHTML = `<i>${esc(q.name)}</i>`;
    $('cardMeta').textContent = kindText(q) + ` · ${lineage(T.tree, q.id).length - 1} steps from the root`;
    const all = paramChanges(root.params, q.params);
    const steps = lineage(T.tree, q.id).slice(1).map(id => {
      const n = T.tree.nodes[id], p = T.tree.nodes[n.parent], c = paramChanges(p.params, n.params)[0];
      return `<li><i>${esc(n.name)}</i>${c ? ` · ${esc(c.label)}: ${esc(c.from)} → ${esc(c.to)}` : ''}</li>`;
    });
    $('cardDiff').innerHTML =
      `<div class="ch">${all.length} of ${PARAMS.length} fields changed since <i>${esc(root.name)}</i>:</div>` +
      `<ul>${all.slice(0, 6).map(c => `<li>${esc(c.label)}: ${esc(c.from)} → ${esc(c.to)}</li>`).join('')}</ul>` +
      (steps.length ? `<div class="ch">Along the lineage (largest change at each step):</div><ol>${steps.join('')}</ol>` : '');
    drawCardFish();
  }
  function drawCardFish() {
    const c = $('cardFish'), f = T.sel >= 0 ? T.fish.get(T.sel) : null;
    const r = c.getBoundingClientRect(), dpr = S.dpr;
    c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
    const x = c.getContext('2d'), th = THEMES[S.theme];
    const w = 100, h = w * c.height / c.width, k = Math.min(w / 500, h / 300);
    const L = { w, h, rules: [], texts: [], cells: [{ i: 0, x: 0, y: 0, w, h, fx: (w - 500 * k) / 2, fy: (h - 300 * k) / 2, fw: 500 * k, fh: 300 * k, k }] };
    drawPlate(x, { L, theme: Object.assign({}, th, { vignette: 0 }), ink: S.ink, pen: Math.min(S.pen, 0.25), jitter: S.jitter, view: { s: c.width / w, ox: 0, oy: 0 },
      fishes: [f], progress: [null], grain: null, marker: false, hiCell: -1, dpr });
  }

  // ── controls ──────────────────────────────────────────────────────────────
  function syncPlay() {
    $('treePlay').textContent = T.playing ? 'Pause' : T.tau >= TAU_END ? 'Grow again' : 'Play';
    M.syncPlay();
  }
  function syncScrub() {
    if (document.activeElement !== $('treeTime')) $('treeTime').value = Math.round(T.tau / TAU_END * 1000);
    $('treeTimeV').textContent = T.tau >= T_MAX ? 'today' : maAgo(T.tau) + ' Ma';
  }
  function syncUI() {
    for (const b of $('treeLayout').children) b.classList.toggle('on', b.dataset.l === T.layout);
    for (const b of $('treeX').children) b.classList.toggle('on', b.dataset.x === T.xMode);
    const set = (id, v, txt) => { if (document.activeElement !== $(id)) $(id).value = v; $(id + 'V').textContent = txt; };
    set('treeMut', T.mut, T.mut.toFixed(2) + '×');
    set('treeSpec', T.spec, T.spec.toFixed(2) + '×');
    set('treeExt', T.ext, T.ext.toFixed(2) + '×');
    set('treeTips', T.tips, String(T.tips));
    set('treeSpeed', T.speed, growSecs().toFixed(1) + ' s');
    $('treeRad').classList.toggle('on', T.rad);
    $('treeAnc').classList.toggle('on', T.anc);
    $('treeNames').classList.toggle('on', T.names);
    const t = T.tree;
    $('treeInfo').textContent = t ? `${t.nodes.length} fish: ${t.tips.length} tips, ${t.nodes.length - t.tips.length} ancestors. Tree seed ${T.seed}.` : '';
    syncPlay(); syncScrub();
  }
  function togglePlay() {
    if (!T.tree) return;
    if (T.playing) T.playing = false;
    else { if (T.tau >= TAU_END) T.tau = 0; T.playing = true; }
    syncPlay(); M.dirty();
  }
  let rebuildTimer = 0;
  const rebuildSoon = () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => build(true), 220); };
  function bind() {
    for (const b of $('treeLayout').children) b.addEventListener('click', () => { T.layout = b.dataset.l; T.layKey = ''; M.resetView(); syncUI(); M.dirty(); M.writeHash(); });
    for (const b of $('treeX').children) b.addEventListener('click', () => { T.xMode = b.dataset.x; T.layKey = ''; syncUI(); M.dirty(); M.writeHash(); });
    $('treePlay').addEventListener('click', togglePlay);
    $('treeRestart').addEventListener('click', () => { T.tau = 0; T.playing = true; syncUI(); M.dirty(); });
    $('treeTime').addEventListener('input', e => { T.tau = +e.target.value / 1000 * TAU_END; T.playing = false; syncPlay(); syncScrub(); M.dirty(); });
    const num = (id, key, re) => $(id).addEventListener('input', e => { T[key] = +e.target.value; syncUI(); if (re) rebuildSoon(); M.writeHash(); });
    num('treeMut', 'mut', true); num('treeSpec', 'spec', true); num('treeExt', 'ext', true); num('treeTips', 'tips', true); num('treeSpeed', 'speed', false);
    $('treeRad').addEventListener('click', () => { T.rad = !T.rad; syncUI(); build(true); });
    $('treeAnc').addEventListener('click', () => { T.anc = !T.anc; syncUI(); M.dirty(); M.writeHash(); });
    $('treeNames').addEventListener('click', () => { T.names = !T.names; syncUI(); M.dirty(); M.writeHash(); });
    $('treeNew').addEventListener('click', () => { T.seed = (Math.random() * 4294967295) >>> 0 || 1; build(true); });
    $('cardClose').addEventListener('click', () => select(-1));
    $('cardOpen').addEventListener('click', () => { const q = T.tree.nodes[T.sel]; if (q) M.openFish(q.name, q.params); });
    $('cardEvolve').addEventListener('click', () => {
      const q = T.tree.nodes[T.sel]; if (!q) return;
      T.seed = (Math.random() * 4294967295) >>> 0 || 1;
      M.setSpecimen(q.name, q.params);   // onSpecimen() then grows the new tree
    });
    $('treeTips').max = TIP_CAP;
  }
  function shareState() {
    return { ts: T.seed, tl: T.layout, tx: T.xMode, mu: T.mut, sr: T.spec, er: T.ext, tt: T.tips, tf: (T.rad ? 'r' : '') + (T.anc ? 'a' : '') + (T.names ? 'n' : '') || '-' };
  }
  function readShare(q) {
    const f = (v, a, b, d) => (v !== undefined && Number.isFinite(+v) ? clamp(+v, a, b) : d);
    T.seed = Math.round(f(q.ts, 1, 4294967295, T.seed));
    if (['clado', 'radial', 'fan'].includes(q.tl)) T.layout = q.tl;
    if (q.tx === 'change' || q.tx === 'time') T.xMode = q.tx;
    T.mut = f(q.mu, 0.1, 3, T.mut); T.spec = f(q.sr, 0.3, 2.5, T.spec); T.ext = f(q.er, 0, 3, T.ext); T.tips = Math.round(f(q.tt, 3, TIP_CAP, T.tips));
    if (q.tf) { T.rad = q.tf.includes('r'); T.anc = q.tf.includes('a'); T.names = q.tf.includes('n'); }
  }
  // SVG elements of the grown tree in the plate L, for export.js.
  function svgOf(L, o) {
    const lay = layoutFor(L);
    return treeSVG(T.tree, lay, Object.assign({ anc: T.anc, names: T.names, line: T.line, xMode: T.xMode }, o), id => T.fish.get(id) || null);
  }
  function json() {
    return JSON.stringify({ seed: T.seed, opts: T.tree.opts, eras: T.tree.eras,
      nodes: T.tree.nodes.map(n => ({ id: n.id, parent: n.parent, kind: n.kind, t: +n.t.toFixed(4), ma: maAgo(n.t), name: n.name, genus: n.genus, radiation: n.radiation, params: n.params })) }, null, 1);
  }
  return { T, build, onSpecimen, layoutFor, plateText, draw, tick, tap, select, syncUI, bind, togglePlay, shareState, readShare, svgOf, json, drawCardFish };
}
