// ============================================================================
//  FISHDRAW  ·  saver.js — the window.snSaver hook (screensaver tour)
// ----------------------------------------------------------------------------
//  Our own code around fishdraw by Lingdong Huang (MIT, LICENSE-fishdraw.txt).
//  Protocol: lib/screensaver.js. enter(opts) hides the page GUI, puts a
//  full-window canvas (#saverCanvas) in the document, and returns
//  { canvas, warmupMs }. exit() removes them and gives the page back.
//
//  SHOTS. A seeded shuffle of ten shot types, shuffled again each round
//  (opts.seed differs per run, so each run differs; the counters reset on
//  each load). The first shot is a fast one (draw, specimen or plate).
//  Each shot lasts 5-12 s (calm = longer), then a cut.
//    draw     one fish, drawn on by the pen (body and head first), held
//    specimen one fish on a bordered plate, "Fig. 1." and its name
//    plate    a random plate, 1 to 15 cells, that fills cell by cell
//    family   a plate of relatives: one genus, mutate() spread 0.2-0.6
//    push    one finished fish, a slow push-in on the head, scales, fins
//            or tail; the lines are vectors through the camera each frame
//    morph   one name, params that step from the fish to a relative and
//            on to a second relative (blendParams), with a cross-fade
//  Three tree shots use tree.js (a tree of 10 to 16 living tips):
//    grow     the tree grows from the root; fish appear at the nodes
//    radiate  a cladogram, zoomed, the camera pans along a radiation
//             (the split with 4x speciation, else the largest clade)
//    lineage  the camera pushes in on one living tip while the ancestor
//             fish of its lineage appear one by one, root to tip
//    evolve   "evolve from here": a tree, the lineage to one of its tips,
//             then a new tree that grows from that tip
//  The tree shots pick the cladogram, radial or fan layout per shot.
//  STYLE. Each shot samples the page options: one of the nine paper
//  themes (a shuffled bag), a free ink colour (30% of shots), the hand
//  wobble (35%, 0.15-0.7) and a pen width of 0.6-1.5 x the base.
//  The next shot is asked of the pool while the current one plays.
//
//  FRAMING. The subject sits in the clear band of the shell label plate
//  (lib/saver-clear.js plateBand), checked each 250 ms. With no plate, a
//  band of 76% of the height.
//
//  LABEL. opts.label({ title, sub, lines, code }): the title (the Latin
//  name, the plate or the clade), the sub line CREDIT ("fishdraw by
//  Lingdong Huang" and the repo), notes with the seed and the style, and a
//  short real extract of fishdraw.js or tree.js (cut from the served file
//  by function name, so it is always the shipped code).
//
//  GREP MAP
//    grep -n 'export function installSaver'  the hook
//    grep -n 'function prepare'              the specs and pool jobs of a shot
//    grep -n 'function render'               one frame of the active shot
//    grep -n 'function extract'              a code extract by function name
//    grep -n 'function boxOf'                the subject box in the band
// ============================================================================
import { mulberry, randomName, relativeName, baseParams, mutate, blendParams } from './engine.js';
import { THEMES, THEME_KEYS, MM_PER_PX, layoutPlate, isDark } from './plate.js';
import { drawPlate } from './render.js';
import { buildTree, layoutTree, lineage, cladeName, maAgo, T_MAX } from './tree.js';
import { drawTree, GROW_OVER } from './treedraw.js';

const TYPES = ['draw', 'specimen', 'plate', 'family', 'push', 'morph', 'grow', 'radiate', 'lineage', 'evolve'];
const TREE = new Set(['grow', 'radiate', 'lineage', 'evolve']);
// The first shot of a run is one of these: one to a few fish, ready fast.
const FIRST = ['draw', 'specimen', 'plate'];
// The credit on every saver plate.
export const CREDIT = 'fishdraw by Lingdong Huang · github.com/LingDong-/fishdraw';
// Ink colours that a shot may use instead of the ink of its paper theme.
const INKS_LIGHT = [['#1d2f6f', 'indigo'], ['#7a1f1f', 'oxblood'], ['#24452f', 'forest'], ['#5b3a1a', 'sepia'], ['#0f0f0f', 'black']];
const INKS_DARK = [['#e8d9a8', 'bone'], ['#9fd3ff', 'ice blue'], ['#f2b8a0', 'coral'], ['#c8e6b0', 'pale green']];
// Grid sizes for the plate and family shots (rows x cols).
const GRIDS_LAND = [[2, 2], [2, 3], [2, 4], [3, 3], [3, 4], [2, 5]];
const GRIDS_PORT = [[2, 1], [3, 2], [4, 2], [5, 2], [3, 3]];
const FOCI = [
  { name: 'the head', u: 0.22, v: 0.5 },
  { name: 'the scales', u: 0.52, v: 0.48 },
  { name: 'the dorsal fin', u: 0.48, v: 0.3 },
  { name: 'the tail', u: 0.84, v: 0.5 },
  { name: 'the pectoral fin', u: 0.36, v: 0.6 },
];
const CODE = {
  draw: ['fish', 'start'],
  plate: ['binomen', 'end'],
  push: ['squama', 'start'],
  morph: ['rndtri', 'start'],
  family: ['generate_params', 'start'],
  specimen: ['reframe', 'start'],
  evolve: ['buildTree', 'end', 'tree'],
  grow: ['drift', 'start', 'tree'],
  radiate: ['buildTree', 'start', 'tree'],
  lineage: ['paramDistance', 'start', 'tree'],
};

// The lines of `function name(` to its closing brace, the first or last n.
function extract(src, name, from = 'start', n = 12) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l.startsWith('function ' + name + '(') || l.startsWith('export function ' + name + '('));
  if (i < 0) return '';
  let j = i + 1;
  while (j < lines.length && lines[j] !== '}') j++;
  const body = lines.slice(i, j + 1).filter(l => l.trim());
  return (from === 'end' ? body.slice(-n) : body.slice(0, n)).join('\n');
}

// A one-cell layout that fits the real extent of the fish (the union of
// the bboxes of fs, in fish units) to a box of bw x bh mm. The 5:3 box of
// reframe() has pad; the band is short, so the pad would waste it.
function fitCell(fs, bw, bh, fill = 0.94) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of fs) if (f) { x0 = Math.min(x0, f.bbox.x); y0 = Math.min(y0, f.bbox.y); x1 = Math.max(x1, f.bbox.x + f.bbox.w); y1 = Math.max(y1, f.bbox.y + f.bbox.h); }
  if (!(x1 > x0)) { x0 = 20; y0 = 20; x1 = 480; y1 = 280; }
  const k = Math.min(bw / (x1 - x0), bh / (y1 - y0)) * fill;
  const fx = bw / 2 - (x0 + x1) / 2 * k, fy = bh / 2 - (y0 + y1) / 2 * k;
  return { w: bw, h: bh, rules: [], texts: [], content: { x: 0, y: 0, w: bw, h: bh },
    cells: [{ i: 0, x: 0, y: 0, w: bw, h: bh, fx, fy, fw: 500 * k, fh: 300 * k, k, bx: x0, by: y0, bw: x1 - x0, bh: y1 - y0 }] };
}

const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

export function installSaver(ctxIn) {
  const { S, pool, E, src, getGrain, onEnter, onExit } = ctxIn;
  let V = null;
  // tree.js as text, for the code extract of the tree shots.
  let treeSrc = '';
  fetch(new URL('./tree.js', import.meta.url)).then(r => r.text()).then(t => { treeSrc = t; }).catch(() => { /* no extract */ });

  function shuffled(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function nextType() {
    if (!V.count && !V.lastType) {
      // The first shot: a fast one; the rest of the round follows.
      const f = FIRST[Math.floor(V.rnd() * FIRST.length)];
      V.bag = shuffled(TYPES.filter(t => t !== f), V.rnd);
      return (V.lastType = f);
    }
    if (!V.bag.length) {
      let b = shuffled(TYPES, V.rnd);
      if (b[0] === V.lastType) b.push(b.shift());
      V.bag = b;
    }
    return (V.lastType = V.bag.shift());
  }
  function nextTheme() {
    if (!V.tbag.length) V.tbag = shuffled(THEME_KEYS, V.rnd);
    return V.tbag.shift();
  }
  const u32 = () => (V.rnd() * 4294967295) >>> 0;

  // ── prepare ───────────────────────────────────────────────────────────────
  // A tree view: a tree, its fish (pool jobs) and its layout cache.
  function treeView(shot, rootName, rootParams, tips, spec) {
    const tree = buildTree({ E, rootName, rootParams, seed: u32(), maxTips: tips, spec, ext: 0.4 + V.rnd() * 0.8, mut: 0.7 + V.rnd() * 0.8, radiations: true });
    const tv = { tree, fish: new Map(), lay: null, layTip: 0 };
    tv.jobs = tree.nodes.slice().sort((a, b) => a.t - b.t).map(q => ({ q, job: pool.draw(q.name, q.params, false, 2 + Math.round(q.t / 10), 'saver')
      .then(f => { tv.fish.set(q.id, f); return f; }).catch(() => null) }));
    return tv;
  }
  function prepareTree(shot) {
    const name = randomName(E, u32());
    const tips = shot.type === 'grow' || shot.type === 'evolve' ? 7 + Math.floor(V.rnd() * 5) : 10 + Math.floor(V.rnd() * 5);
    const kinds = innerWidth >= innerHeight ? ['clado', 'radial', 'fan'] : ['clado', 'radial'];
    shot.kind = kinds[Math.floor(V.rnd() * kinds.length)];
    const A = treeView(shot, name, baseParams(E, name), tips, shot.type === 'radiate' ? 1.5 : 1);
    shot.tv = [A];
    shot.specs = [{ name, params: null }];
    const N = A.tree.nodes;
    if (shot.type === 'radiate') {
      const count = id => (N[id].children.length ? N[id].children.reduce((a, c) => a + count(c), 0) : 1);
      const rad = N.filter(q => q.radiation);
      shot.focus = (rad.length ? rad : N.filter(q => q.kind === 'split' && q.id > 1)).sort((a, b) => count(b.id) - count(a.id))[0] || N[1];
      shot.sub = new Set();
      (function walk(id) { shot.sub.add(id); N[id].children.forEach(walk); })(shot.focus.id);
    }
    if (shot.type === 'lineage' || shot.type === 'evolve') {
      const living = N.filter(q => q.kind === 'tip').sort((a, b) => lineage(A.tree, b.id).length - lineage(A.tree, a.id).length);
      shot.tip = living[0];
      shot.line = lineage(A.tree, shot.tip.id);
    }
    if (shot.type === 'evolve') {
      // The second tree grows from the chosen tip, as "Evolve from here".
      shot.tv.push(treeView(shot, shot.tip.name, shot.tip.params, 6 + Math.floor(V.rnd() * 4), 1));
      shot.dur += 3;
    }
    shot.dur += 2;
    const need = [];
    for (const { q, job } of A.jobs) if (shot.type === 'grow' ? q.t < 30 : shot.type === 'lineage' || shot.type === 'evolve' ? shot.line.includes(q.id) : !q.children.length) need.push(job);
    shot.ready = Promise.race([Promise.all(need), new Promise(r => setTimeout(r, 7000))]);
  }
  // The style of a shot: theme, ink, wobble, pen width.
  function styleOf(shot) {
    const dark = isDark(THEMES[shot.theme]);
    if (V.rnd() < 0.3) { const l = dark ? INKS_DARK : INKS_LIGHT, k = l[Math.floor(V.rnd() * l.length)]; shot.ink = k[0]; shot.inkName = k[1]; }
    shot.jitter = V.rnd() < 0.35 ? +(0.15 + V.rnd() * 0.55).toFixed(2) : 0;
    shot.penK = +(0.6 + V.rnd() * 0.9).toFixed(2);
  }
  function styleNote(shot) {
    const tl = THEMES[shot.theme].label;
    return (/paper$/i.test(tl) ? tl : tl + ' paper') + (shot.inkName ? `, ${shot.inkName} ink` : '') +
      (shot.jitter ? `, hand wobble ${Math.round(shot.jitter * 100)}%` : '') + `, pen ${(0.3 * shot.penK).toFixed(2)} mm`;
  }
  function prepare(type) {
    const calm = V.calm;
    const shot = { type, theme: nextTheme(), dur: 5 + 4 * calm + V.rnd() * 3, fishes: [], specs: [], t0: 0 };
    styleOf(shot);
    if (TREE.has(type)) { prepareTree(shot); shot.ready.then(() => { shot.isReady = true; }); return shot; }
    const ask = (spec, i, label) => pool.draw(spec.name, spec.params, label, 2 + i, 'saver')
      .then(f => { shot.fishes[i] = f; return f; }).catch(() => null);
    if (type === 'plate' || type === 'family') {
      const opts = innerWidth >= innerHeight ? GRIDS_LAND : GRIDS_PORT;
      const [rows, cols] = opts[Math.floor(V.rnd() * opts.length)];
      shot.rows = rows; shot.cols = cols; shot.dur += 2;
      if (type === 'family') {
        const base = randomName(E, u32()), bp = baseParams(E, base);
        shot.spread = +(0.2 + V.rnd() * 0.4).toFixed(2);
        shot.specs.push({ name: base, params: null });
        for (let i = 1; i < rows * cols; i++) shot.specs.push({ name: relativeName(E, base, u32()), params: mutate(bp, shot.spread, V.rnd) });
      } else for (let i = 0; i < rows * cols; i++) shot.specs.push({ name: randomName(E, u32()), params: null });
      const jobs = shot.specs.map((s, i) => ask(s, i, false));
      shot.ready = Promise.race([jobs[0], new Promise(r => setTimeout(r, 6000))]);
    } else if (type === 'morph') {
      const name = randomName(E, u32()), base = baseParams(E, name);
      const p1 = mutate(base, 0.55, V.rnd), p2 = mutate(p1, 0.55, V.rnd);
      const seq = [base, blendParams(base, p1, 1 / 3), blendParams(base, p1, 2 / 3), p1, blendParams(p1, p2, 1 / 3), blendParams(p1, p2, 2 / 3), p2];
      shot.specs = seq.map(p => ({ name, params: p }));
      shot.dur = Math.max(shot.dur, 7 + 2 * calm);
      shot.ready = Promise.all(shot.specs.map((s, i) => ask(s, i, false)));
    } else {
      shot.specs = [{ name: randomName(E, u32()), params: null }];
      if (type === 'push') { shot.focus = FOCI[Math.floor(V.rnd() * FOCI.length)]; shot.zoom = 2.3 + V.rnd() * 1.3; }
      shot.ready = ask(shot.specs[0], 0, false);
    }
    shot.ready.then(() => { shot.isReady = true; });
    return shot;
  }

  // ── label ─────────────────────────────────────────────────────────────────
  function labelFor(shot) {
    const f = shot.fishes[0], name = shot.specs[0].name;
    const [fn, from, file] = CODE[shot.type];
    const code = file === 'tree'
      ? { lang: 'js', name: 'tree.js · ' + fn + '()', text: extract(treeSrc, fn, from, 12) }
      : { lang: 'js', name: 'fishdraw.js · ' + fn + '()', text: extract(src, fn, from, 12) };
    const style = styleNote(shot);
    if (TREE.has(shot.type)) {
      const tv = shot.tv[shot.tv.length - 1], N = shot.tv[0].tree.nodes, root = N[0];
      const living = tv.tree.nodes.filter(q => q.kind === 'tip').length, gone = tv.tree.nodes.filter(q => q.kind === 'extinct').length;
      const lines = [];
      if (shot.type === 'grow') lines.push(`A tree of life grown from ${root.name}: ${living} living and ${gone} extinct species. Every node is a fishdraw fish.`);
      if (shot.type === 'radiate') lines.push(`A radiation of ${shot.focus.genus}, ${maAgo(shot.focus.t)} Ma: one lineage splits four times as fast for a while.`);
      if (shot.type === 'lineage') lines.push(`From ${root.name} to ${shot.tip.name}, ${shot.line.length - 1} steps; each ancestor is drawn from its own params.`);
      if (shot.type === 'evolve') lines.push(`Evolve from here: ${shot.tip.name} becomes the ancestor of a new tree.`);
      lines.push(`${{ clado: 'Cladogram', radial: 'Radial tree', fan: 'Fan' }[shot.kind]} · ${style}`);
      return { title: 'The ' + cladeName((shot.type === 'evolve' && shot.tv[1] ? shot.tv[1].tree.nodes[0] : root).genus), sub: CREDIT, lines, code: code.text ? code : undefined };
    }
    const seed = E.str_to_seed(name);
    if (shot.type === 'plate' || shot.type === 'family') {
      const fam = shot.type === 'family';
      return { title: fam ? 'The family of ' + name.split(' ')[0] : 'Pisces fictae', sub: CREDIT,
        lines: [fam ? `${name} and ${shot.specs.length - 1} relatives, mutation spread ${Math.round(shot.spread * 100)}%` : `A plate of ${shot.specs.length} specimens, ${shot.specs[0].name} to ${shot.specs[shot.specs.length - 1].name}`,
          `${shot.rows} x ${shot.cols} · ${style}`], code };
    }
    const lines = [`Seed ${seed}: str_to_seed("${name}")` + (f ? ` · ${f.offs.length - 1} polylines` : '')];
    if (shot.type === 'draw') lines.push('The pen draws the body and the head first, then fins, scales and shading.');
    if (shot.type === 'specimen') lines.push('A specimen plate: Fig. 1, drawn on by the pen.');
    if (shot.type === 'push') lines.push(`A close look at ${shot.focus.name}. Every line is a vector.`);
    if (shot.type === 'morph') lines.push('One name, so one noise stream. The params step to two relatives.');
    lines.push(style);
    return { title: name, sub: CREDIT, lines, code };
  }

  // ── boxOf ─────────────────────────────────────────────────────────────────
  // The subject box in device px: the clear band, with side margins.
  function boxOf(W, H, dpr) {
    const b = V.band;
    const t = b ? b.t : innerHeight * 0.12, bb = b ? b.b : innerHeight * 0.12;
    const h = Math.max(80, innerHeight - t - bb);
    const w = innerWidth * 0.9;
    return { x: (innerWidth - w) / 2 * dpr, y: t * dpr, w: w * dpr, h: h * dpr };
  }

  // ── render ────────────────────────────────────────────────────────────────
  function render(now) {
    if (!V) return;
    V.raf = requestAnimationFrame(render);
    if (V.bandFn && now - V.bandAt > 250) { V.bandAt = now; try { V.band = V.bandFn(innerHeight); } catch (e) { V.band = null; } }
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr), c = V.canvas, x = V.ctx;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    let shot = V.shot;
    // Cut when the shot is over and the next one is ready (at most 5 s late).
    if (shot && shot.t0 && (now - shot.t0) / 1000 > shot.dur && (V.next.isReady || (now - shot.t0) / 1000 > shot.dur + 5)) {
      V.shot = shot = V.next; shot.t0 = 0; V.next = prepare(nextType());
    }
    if (shot && !shot.t0 && shot.isReady) { shot.t0 = now; V.count++; V.label(labelFor(shot)); }
    const theme = THEMES[shot ? shot.theme : 'cream'];
    const mmDev = MM_PER_PX / dpr;
    x.setTransform(1, 0, 0, 1, 0, 0);
    // The paper over the whole window.
    drawPlate(x, { L: { w: W * mmDev, h: H * mmDev, rules: [], texts: [], cells: [] }, theme, view: { s: 1 / mmDev, ox: 0, oy: 0 },
      fishes: [], progress: [], grain: getGrain(), pen: 0.3, dpr });
    if (!shot || !shot.t0) return;
    const t = (now - shot.t0) / 1000, box = boxOf(W, H, dpr);
    const inner = Object.assign({}, theme, { paper: 'rgba(0,0,0,0)', grain: 0, vignette: 0, grid: null });
    const bw = box.w * mmDev, bh = box.h * mmDev;
    const pen = 0.3 * shot.penK * Math.max(0.8, Math.min(1.6, Math.min(innerWidth, innerHeight) / 700));
    const ink = shot.ink || null, jitter = shot.jitter || 0;
    if (TREE.has(shot.type)) { renderTree(x, shot, t, box, mmDev, inner, pen, dpr); return; }
    if (shot.type === 'specimen') {
      // A bordered plate in the band, Fig. 1 and the name under the fish.
      const L = layoutPlate({ w: bw, h: bh, rows: 1, cols: 1, border: true, title: false, labels: true, screen: true, fig: true, names: [shot.specs[0].name] });
      const f = shot.fishes[0], T = shot.dur * 0.7;
      drawPlate(x, { L, theme: inner, ink, jitter, view: { s: 1 / mmDev, ox: box.x, oy: box.y }, fishes: [f], progress: [f && t < T ? f.total * t / T : null], pen, marker: true, dpr, hiCell: -1 });
      return;
    }
    if (shot.type === 'plate' || shot.type === 'family') {
      const L = layoutPlate({ w: bw, h: bh, rows: shot.rows, cols: shot.cols, border: false, title: false, labels: true, screen: true, names: shot.specs.map(s => s.name) });
      const n = shot.specs.length, slot = shot.dur * 0.72 / n;
      const progress = shot.specs.map((s, i) => {
        const f = shot.fishes[i]; if (!f) return 0;
        const local = t - i * slot;
        return local <= 0 ? 0 : local >= slot * 1.8 ? null : f.total * local / (slot * 1.8);
      });
      // A cell shows its label only once its pen has started.
      const Lv = Object.assign({}, L, { texts: L.texts.filter(tx => tx.cell == null || t > tx.cell * slot) });
      drawPlate(x, { L: Lv, theme: inner, view: { s: 1 / mmDev, ox: box.x, oy: box.y }, fishes: shot.fishes, progress, pen: pen * 0.8, ink, jitter, marker: true, dpr, hiCell: -1 });
      return;
    }
    const L = fitCell(shot.type === 'morph' ? shot.fishes : [shot.fishes[0]], bw, bh);
    let view = { s: 1 / mmDev, ox: box.x, oy: box.y };
    if (shot.type === 'push') {
      // The focus is a point of the fish bbox (u, v in 0..1).
      const cl = L.cells[0], fm = [cl.fx + (cl.bx + shot.focus.u * cl.bw) * cl.k, cl.fy + (cl.by + shot.focus.v * cl.bh) * cl.k];
      const e = ease(t / shot.dur), z = 1 + (shot.zoom - 1) * e;
      const s = view.s * z;
      const sx0 = box.x + fm[0] * view.s, sy0 = box.y + fm[1] * view.s;
      const sx = sx0 + (box.x + box.w / 2 - sx0) * e, sy = sy0 + (box.y + box.h / 2 - sy0) * e;
      view = { s, ox: sx - fm[0] * s, oy: sy - fm[1] * s };
      // The pen grows with the zoom, but slower, so close-ups stay fine.
      drawPlate(x, { L, theme: inner, view, fishes: [shot.fishes[0]], progress: [null], pen: pen / Math.sqrt(z), ink, jitter, dpr, hiCell: -1 });
      return;
    }
    if (shot.type === 'draw') {
      const f = shot.fishes[0], T = shot.dur * 0.7;
      const prog = f && t < T ? f.total * (t / T) : null;
      drawPlate(x, { L, theme: inner, view, fishes: [f], progress: [prog], pen, ink, jitter, marker: true, dpr, hiCell: -1 });
      return;
    }
    // morph: step k of K, with a cross-fade in the last 35% of each step.
    const K = shot.specs.length, step = shot.dur / K;
    const k = Math.min(K - 1, Math.floor(t / step)), local = (t - k * step) / step;
    const a = k < K - 1 ? ease((local - 0.65) / 0.35) : 0;
    x.globalAlpha = 1 - a;
    drawPlate(x, { L, theme: inner, view, fishes: [shot.fishes[k]], progress: [null], pen, ink, jitter, dpr, hiCell: -1 });
    if (a > 0) {
      x.globalAlpha = a;
      drawPlate(x, { L, theme: inner, view, fishes: [shot.fishes[k + 1]], progress: [null], pen, ink, jitter, dpr, hiCell: -1 });
    }
    x.globalAlpha = 1;
  }

  // ── renderTree ────────────────────────────────────────────────────────────
  // The tree in its natural layout (tree.js layoutNatural) in mm. A tip
  // fish is tipPx device px wide: 42% of the band height, at least 120 CSS
  // px and at most 45% of the band width. The camera follows a focus point
  // (eased), so the fish stay large and the view moves:
  //   grow     the newest fish
  //   radiate  from the radiation node across its tips, one by one
  //   lineage  from the root down the lineage to the tip
  //   evolve   the lineage of the tip (40% of the shot), then the newest
  //            fish of the second tree, which grows from that tip
  function renderTree(x, shot, t, box, mmDev, theme, pen, dpr) {
    const p = t / shot.dur, second = shot.type === 'evolve' && p >= 0.4;
    const tv = shot.tv[second ? 1 : 0], N = tv.tree.nodes;
    let tipPx = Math.max(120 * dpr, Math.min(box.h * 0.42, 300 * dpr));
    tipPx = Math.min(tipPx, box.w * 0.45);
    const tipMM = +(tipPx * mmDev).toFixed(1);
    if (!tv.lay || tv.layTip !== tipMM) { tv.lay = layoutTree(tv.tree, shot.kind, { tip: tipMM }); tv.layTip = tipMM; shot.cam = null; }
    if (shot.camTv !== tv) { shot.camTv = tv; shot.cam = null; }
    const lay = tv.lay;
    const s = 1 / mmDev, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const centre = id => { const b = lay.fish[id]; return b ? [b.x + b.w / 2, b.y + b.h / 2] : [lay.pos[id].x, lay.pos[id].y]; };
    const e = ease(p);
    let tau = null, line = null, ancOnly = null, anc = true, focus, sel = -1;
    const newest = tt => { let best = N[0]; for (const q of N) if (q.t <= tt && q.t >= best.t) best = q; return centre(best.id); };
    if (shot.type === 'grow' || second) {
      const q = second ? (p - 0.4) / 0.5 : t / (shot.dur * 0.85);
      tau = T_MAX * GROW_OVER * Math.min(1, q);
      focus = newest(tau);
    } else if (shot.type === 'radiate') {
      const tips = [...shot.sub].filter(id => !N[id].children.length).map(centre).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const path = [centre(shot.focus.id), ...tips];
      const u = e * (path.length - 1), i = Math.min(path.length - 2, Math.floor(u)), f = u - i;
      focus = path.length > 1 ? [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f] : path[0];
      line = shot.sub;
    } else {
      const span = shot.type === 'evolve' ? shot.dur * 0.36 : shot.dur * 0.8;
      const k = Math.min(shot.line.length - 1, Math.floor(Math.min(1, t / span) * shot.line.length));
      ancOnly = new Set(shot.line.slice(0, k + 1));
      line = new Set(shot.line); anc = false; sel = shot.line[shot.line.length - 1];
      focus = centre(shot.line[k]);
    }
    // Ease the camera toward the focus (the first frame jumps).
    const now = performance.now(), dt = shot.camAt ? Math.min(0.1, (now - shot.camAt) / 1000) : 1;
    shot.camAt = now;
    if (!shot.cam) shot.cam = focus.slice();
    const k2 = 1 - Math.exp(-dt * 2.2);
    shot.cam[0] += (focus[0] - shot.cam[0]) * k2; shot.cam[1] += (focus[1] - shot.cam[1]) * k2;
    const view = { s, ox: cx - shot.cam[0] * s, oy: cy - shot.cam[1] * s };
    shot.tipCss = +(lay.tip.w * s / dpr).toFixed(1);
    const th = THEMES[shot.theme];
    drawTree(x, { tree: tv.tree, lay, view, theme: th, ink: shot.ink, jitter: shot.jitter, pen, dpr, tau,
      fishFor: id => tv.fish.get(id) || null, anc, ancOnly, names: true, sel,
      line: line || new Set(), xMode: 'time', back: true, paper: th.paper });
  }

  window.snSaver = {
    enter(o = {}) {
      if (V) this.exit();
      const calm = Math.min(1, Math.max(0, o.calm ?? 0.7));
      const st = document.createElement('style');
      st.id = 'saverStyle';
      st.textContent = '.topbar,#panel,#dock,#gear,#caption,#busy,#desk{display:none!important}' +
        '#saverCanvas{position:fixed;inset:0;width:100%;height:100%;display:block;z-index:60;cursor:none}';
      document.head.append(st);
      const canvas = document.createElement('canvas'); canvas.id = 'saverCanvas';
      document.body.append(canvas);
      V = { rnd: mulberry((o.seed >>> 0) || 1), calm, label: typeof o.label === 'function' ? o.label : () => {},
        canvas, ctx: canvas.getContext('2d'), style: st, bag: [], tbag: [], lastType: '', count: 0,
        band: null, bandFn: null, bandAt: 0, raf: 0 };
      import('../../lib/saver-clear.js').then(m => { if (V) V.bandFn = m.plateBand; }).catch(() => { /* no shell: the default band */ });
      onEnter();
      V.shot = prepare(nextType());
      V.next = prepare(nextType());
      V.raf = requestAnimationFrame(render);
      return { canvas, warmupMs: 1500 };
    },
    exit() {
      if (!V) return;
      cancelAnimationFrame(V.raf);
      pool.cancel('saver');
      V.label(null);
      V.style.remove(); V.canvas.remove();
      V = null;
      onExit();
    },
    debug() { return V ? { tipCss: V.shot && V.shot.tipCss, kind: V.shot && V.shot.kind, ink: V.shot && V.shot.inkName, jitter: V.shot && V.shot.jitter, penK: V.shot && V.shot.penK, type: V.shot && V.shot.type, t0: V.shot && V.shot.t0, name: V.shot && V.shot.specs[0].name, theme: V.shot && V.shot.theme, count: V.count, band: V.band } : null; },
  };
  return window.snSaver;
}
