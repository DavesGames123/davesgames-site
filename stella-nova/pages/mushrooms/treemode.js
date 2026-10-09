// ============================================================================
//  MUSHROOM DRAW  ·  treemode.js — the "Tree of life" mode of the page
// ----------------------------------------------------------------------------
//  Original code (davesgames.io), after fishdraw/treemode.js on this site.
//  main.js owns the canvas, the view (pan, zoom), the plate and the panel.
//  This module owns the tree state S.tr and the tree controls:
//    build()      a new tree from the specimen (S.seed, S.params) and the
//                 rates; the node specimens queue in time order
//    pump(ms)     builds queued specimens for at most ms on this thread
//                 (about 30 ms each), so the mushrooms come in as it grows
//    tick(dt)     playback: tau runs from 0 to T_MAX * GROW_OVER
//    draw()       treedraw.js drawTree in the plate content box
//    tap(x, y)    select the node under a plate point (mm): the lineage
//                 lights up and the card shows the mushroom and its changes
//  The root is always the specimen of single mode. "Evolve from here"
//  makes the selected node the specimen and grows a new tree from it.
//
//  GREP MAP
//    grep -n 'function build'        the model and the specimen queue
//    grep -n 'function layoutFor'    the layout in the plate content box
//    grep -n 'function cameraTarget' follow while it grows, then overview
//    grep -n 'function select'       selection, lineage, card
//    grep -n 'function fillCard'     the card text and the large mushroom
//    grep -n 'function bind'         the tree controls
// ============================================================================
import { buildTree, layoutTree, lineage, paramChanges, cladeName, drawParams, maAgo, T_MAX, TIP_CAP } from './tree.js';
import { drawTree, hitTree, treeSVG, GROW_OVER } from './treedraw.js';
import { buildSpecimen, PARAMS } from './engine.js';
import { drawSpec } from './render.js';
import { THEMES, fitSpec } from './plate.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const TAU_END = T_MAX * GROW_OVER;

export function createTreeMode(M) {
  const { S, $ } = M;
  const T = S.tr = {
    seed: (Math.random() * 4294967295) >>> 0 || 1, layout: 'clado', xMode: 'time',
    mut: 1, spec: 1, ext: 0.6, tips: 10, rad: true, anc: true, names: true, follow: true, hover: -1,
    tau: 0, playing: false, speed: 0.5, tree: null, rootKey: '', specs: new Map(), queue: [], seq: 0,
    sel: -1, line: new Set(), layKey: '', lay: null, form: 'fly',
  };
  const keyOf = (seed, p) => seed + '|' + PARAMS.map(d => p[d.key]).join(',');
  const growSecs = () => 60 * Math.pow(0.08, T.speed);   // 60 s .. 4.8 s

  // ── build ─────────────────────────────────────────────────────────────────
  function build(grow = true) {
    if (!S.params) return;
    T.tree = buildTree({ rootParams: S.params, rootSeed: S.seed, seed: T.seed, mut: T.mut, spec: T.spec, ext: T.ext, maxTips: T.tips, radiations: T.rad });
    T.form = S.form; T.seq++;
    T.rootKey = keyOf(S.seed, S.params);
    T.specs = new Map(); T.sel = -1; T.line = new Set(); T.lay = null; T.layKey = ''; T.natKey = '';
    T.queue = T.tree.nodes.slice().sort((a, b) => a.t - b.t).map(n => n.id);
    T.tau = grow ? 0 : TAU_END; T.playing = grow; T.follow = true; T.hover = -1;
    $('treeCard').hidden = true;
    syncUI(); M.dirty(); M.writeHash();
  }
  // Builds queued node specimens for at most ms. True when one was built.
  function pump(ms) {
    if (!T.queue.length) return false;
    const t0 = performance.now();
    let any = false;
    while (T.queue.length && performance.now() - t0 < ms) {
      const n = T.tree.nodes[T.queue.shift()];
      try { T.specs.set(n.id, buildSpecimen(drawParams(n.params), n.seed)); any = true; } catch (e) { console.error(e); }
    }
    return any;
  }
  const busy = () => T.queue.length > 0;
  function onSpecimen() { if (S.mode === 'tree' && (!T.tree || T.rootKey !== keyOf(S.seed, S.params))) build(true); }

  // ── layoutFor ─────────────────────────────────────────────────────────────
  // On the 'screen' page the layout has its natural size: a tip box is
  // M.tipMM() wide, and main.js sizes the plate around it. A paper page
  // fits the tree to the page.
  function natSize() {
    if (!T.tree) return { w: 100, h: 60 };
    const k = 'n|' + T.seq + '|' + T.layout + '|' + M.tipMM().toFixed(3);
    if (k !== T.natKey) { T.natKey = k; const l = layoutTree(T.tree, T.layout, { tip: M.tipMM() }); T.nat = { w: l.w, h: l.h }; }
    return T.nat;
  }
  function layoutFor(L) {
    const C = L.content, nat = M.natural();
    const k = [T.seq, T.layout, T.xMode, C.x, C.y, C.w, C.h, nat, M.tipMM()].map(v => (typeof v === 'number' ? v.toFixed(3) : v)).join('|');
    if (k !== T.layKey) {
      T.layKey = k;
      if (nat) { const n = natSize(); T.lay = layoutTree(T.tree, T.layout, { tip: M.tipMM(), ox: C.x + (C.w - n.w) / 2, oy: C.y + (C.h - n.h) / 2 }); }
      else T.lay = layoutTree(T.tree, T.layout, { w: C.w, h: C.h, ox: C.x, oy: C.y, xMode: T.xMode });
    }
    return T.lay;
  }
  // ── cameraTarget ──────────────────────────────────────────────────────────
  // While the tree grows, the view follows the newest node at a zoom where
  // a tip is 1.3 x the minimum size. After growth, an overview: the whole
  // tree if it fits at the minimum size, else that size centred on the
  // tree (the living tips in view for a wide cladogram). A pan or a zoom
  // by the user stops the follow. Returns { x, y (mm), z } or null.
  function cameraTarget(L, fit) {
    if (!T.tree || !T.follow) return null;
    const lay = layoutFor(L), zMin = M.minPx() / (lay.tip.w * fit);
    if (T.tau < TAU_END) {
      let best = T.tree.nodes[0];
      for (const q of T.tree.nodes) if (q.t <= T.tau && q.t >= best.t && (T.anc || !q.children.length || q.id === 0)) best = q;
      const b = lay.box[best.id];
      return { x: b.x + b.w / 2, y: b.y + b.h / 2, z: Math.max(1, zMin * 1.3) };
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of lay.box) if (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    const z = Math.max(1, zMin);
    let x = (x0 + x1) / 2;
    const vw = M.clearW() * 0.95 / (fit * z);
    if (lay.kind === 'clado' && x1 - x0 > vw) x = x1 - vw / 2;
    return { x, y: (y0 + y1) / 2, z };
  }
  function plateText() {
    if (!T.tree) return { title: 'Tree of life', sub: '' };
    const n = T.tree.nodes, living = n.filter(q => q.kind === 'tip').length, gone = n.filter(q => q.kind === 'extinct').length;
    return { title: 'The ' + cladeName(n[0].genus), sub: `${living} living and ${gone} extinct species, grown from ${n[0].name}` };
  }
  function drawOpts(extra) {
    return Object.assign({
      tree: T.tree, theme: THEMES[S.theme], ink: S.ink, style: S.style, pen: S.pen, jitter: S.jitter, dpr: S.dpr,
      tau: T.tau, specFor: id => T.specs.get(id) || null, anc: T.anc, names: T.names, sel: T.sel >= 0 ? T.sel : T.hover,
      line: T.line, xMode: T.xMode, back: true, paper: THEMES[S.theme].paper,
    }, extra);
  }
  function draw(ctx, L, view, extra = {}) {
    if (!T.tree) return;
    drawTree(ctx, drawOpts(Object.assign({ lay: layoutFor(L), view }, extra)));
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
    select(hitTree(T.tree, layoutFor(L), x, y, 12 * S.dpr / view.s, T.anc));
  }
  function select(id) {
    T.sel = id; T.hover = -1;
    T.line = id >= 0 ? new Set(lineage(T.tree, id)) : new Set();
    if (id >= 0) fillCard(id); else $('treeCard').hidden = true;
    M.dirty();
  }
  // A mouse hover shows the card of the mushroom under the cursor, unless
  // a click pinned another one.
  function hover(x, y, L) {
    if (!T.tree || T.sel >= 0) return;
    const lay = layoutFor(L);
    let id = -1;
    for (const q of T.tree.nodes) {
      const b = lay.box[q.id];
      if (b && (!b.anc || T.anc) && T.specs.get(q.id) && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { id = q.id; break; }
    }
    if (id === T.hover) return;
    T.hover = id;
    T.line = id >= 0 ? new Set(lineage(T.tree, id)) : new Set();
    if (id >= 0) fillCard(id); else $('treeCard').hidden = true;
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
  function fillCard(id) {
    const q = T.tree.nodes[id], root = T.tree.nodes[0], line = lineage(T.tree, q.id);
    $('treeCard').hidden = false;
    $('cardName').innerHTML = `<i>${esc(q.name)}</i>`;
    $('cardMeta').textContent = kindText(q) + ` · ${line.length - 1} steps from the root · seed ${q.seed}`;
    const all = paramChanges(root.params, q.params);
    const steps = line.slice(1).map(i => {
      const n = T.tree.nodes[i], c = paramChanges(T.tree.nodes[n.parent].params, n.params)[0];
      return `<li><i>${esc(n.name)}</i>${c ? ` · ${esc(c.label)}: ${esc(c.from)} → ${esc(c.to)}` : ''}</li>`;
    });
    $('cardDiff').innerHTML =
      `<div class="ch">${all.length} of ${PARAMS.length} fields changed since <i>${esc(root.name)}</i>:</div>` +
      `<ul>${all.slice(0, 6).map(c => `<li>${esc(c.label)}: ${esc(c.from)} → ${esc(c.to)}</li>`).join('')}</ul>` +
      (steps.length ? `<div class="ch">Along the lineage (the largest change at each step):</div><ol>${steps.join('')}</ol>` : '');
    drawCard();
  }
  function drawCard() {
    const id = T.sel >= 0 ? T.sel : T.hover, c = $('cardSpec');
    const f = id >= 0 ? T.specs.get(id) : null, r = c.getBoundingClientRect(), dpr = S.dpr;
    c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
    const x = c.getContext('2d'), th = THEMES[S.theme];
    x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = th.paper; x.fillRect(0, 0, c.width, c.height);
    if (!f) return;
    const w = 100, h = w * c.height / c.width, fit = fitSpec(f, { ax: 0, ay: 0, aw: w, ah: h }, 0.9);
    drawSpec(x, f, fit, { s: c.width / w, ox: 0, oy: 0 }, { theme: th, ink: S.ink, style: S.style, pen: Math.min(S.pen, 0.2), jitter: S.jitter, prog: null, marker: false, dpr, washMin: 0.12 });
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
    $('treeInfo').textContent = t ? `${t.nodes.length} mushrooms: ${t.tips.length} tips, ${t.nodes.length - t.tips.length} ancestors. Tree seed ${T.seed}.` : '';
    syncPlay(); syncScrub();
  }
  function togglePlay() {
    if (!T.tree) return;
    if (T.playing) T.playing = false;
    else { if (T.tau >= TAU_END) T.tau = 0; T.playing = true; T.follow = true; }
    syncPlay(); M.dirty();
  }
  function newTree() { T.seed = (Math.random() * 4294967295) >>> 0 || 1; build(true); }
  let rebuildTimer = 0;
  const rebuildSoon = () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => build(true), 220); };
  function bind() {
    for (const b of $('treeLayout').children) b.addEventListener('click', () => { T.layout = b.dataset.l; T.layKey = ''; T.follow = true; M.resetView(); syncUI(); M.dirty(); M.writeHash(); });
    for (const b of $('treeX').children) b.addEventListener('click', () => { T.xMode = b.dataset.x; T.layKey = ''; syncUI(); M.dirty(); M.writeHash(); });
    $('treePlay').addEventListener('click', togglePlay);
    $('treeRestart').addEventListener('click', () => { T.tau = 0; T.playing = true; T.follow = true; syncUI(); M.dirty(); });
    $('treeTime').addEventListener('input', e => { T.tau = +e.target.value / 1000 * TAU_END; T.playing = false; syncPlay(); syncScrub(); M.dirty(); });
    const num = (id, key, re) => $(id).addEventListener('input', e => { T[key] = +e.target.value; syncUI(); if (re) rebuildSoon(); M.writeHash(); });
    num('treeMut', 'mut', true); num('treeSpec', 'spec', true); num('treeExt', 'ext', true); num('treeTips', 'tips', true); num('treeSpeed', 'speed', false);
    $('treeRad').addEventListener('click', () => { T.rad = !T.rad; syncUI(); build(true); });
    $('treeAnc').addEventListener('click', () => { T.anc = !T.anc; syncUI(); M.dirty(); M.writeHash(); });
    $('treeNames').addEventListener('click', () => { T.names = !T.names; syncUI(); M.dirty(); M.writeHash(); });
    $('treeNew').addEventListener('click', newTree);
    $('cardClose').addEventListener('click', () => select(-1));
    $('cardOpen').addEventListener('click', () => { const q = T.tree.nodes[T.sel]; if (q) M.openSpecimen(T.form, q.seed, q.params); });
    $('cardEvolve').addEventListener('click', () => {
      const q = T.tree.nodes[T.sel]; if (!q) return;
      T.seed = (Math.random() * 4294967295) >>> 0 || 1;
      M.setSpecimen(T.form, q.seed, q.params);   // onSpecimen() then grows the new tree
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
  function svgOf(L, o) {
    return treeSVG(T.tree, layoutFor(L), Object.assign({ anc: T.anc, names: T.names, line: T.line }, o), id => T.specs.get(id) || null);
  }
  function json() {
    return JSON.stringify({ credit: 'Mushroom Draw, davesgames.io (after fishdraw and shan-shui-inf by Lingdong Huang)', seed: T.seed, opts: T.tree.opts, eras: T.tree.eras,
      nodes: T.tree.nodes.map(n => ({ id: n.id, parent: n.parent, kind: n.kind, t: +n.t.toFixed(4), ma: maAgo(n.t), name: n.name, seed: n.seed, genus: n.genus, radiation: n.radiation, params: n.params })) }, null, 1);
  }
  return { T, build, pump, busy, onSpecimen, layoutFor, natSize, cameraTarget, plateText, draw, tick, tap, hover, select, syncUI, bind, togglePlay, newTree, shareState, readShare, svgOf, json, drawCard };
}
