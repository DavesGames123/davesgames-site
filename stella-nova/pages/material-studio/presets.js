// ============================================================================
//  MATERIAL STUDIO  ·  presets.js — starter material graphs
// ────────────────────────────────────────────────────────────────────────────
//  Owner: PANELS agent. Sixteen original starter materials. Each one is a
//  complete contract Graph built only from core node types (nodes/core.js),
//  so a preset bakes with no Composition Bench nodes and no images.
//
//  DATA FLOW
//      recipe(b) -> builder calls n() / link() / out() -> graph JSON
//      layout()  -> x from the link depth to the Material Output, y by order
//      MATERIAL_PRESETS [{id, label, swatch, description, tags, graph}]
//          read by panels.js (Material view grid, File menu) and by
//          init() when the page starts with no graph.
//
//  SECTIONS  (grep -n the banner to jump)
//      builder ......... makeGraph: n(), link(), out(), scalars()
//      recipes ......... one function per material, in RECIPES order
//      checker ......... checkPreset: node types, ports, link types, cycles
//      init / api ...... init(ctx), __studio.presets {selfTest, bakeAll}
//
//  CHECKS  (selfTest, also __studio.presets.selfTest())
//      every node type is in the registry, every link joins real ports with
//      contract canConnect types, each input has one link, the graph has no
//      cycle, and compile.compileGraph reports no error when compile.js is
//      loaded. bakeAll() loads each preset, waits for bake:done or bake:error
//      and puts the old graph back.
// ============================================================================
import { OUTPUT_TYPE, GRAPH_VERSION, DEFAULT_SETTINGS, validateGraph, canConnect } from './contract.js';

// ------------------------------------------------------------ builder
/**
 * Build one preset graph.
 * @param {string} name
 * @param {(b:object)=>void} recipe  calls b.n(type, params) -> id,
 *        b.link(fromId, outId, toId, inId), b.out(inputId, fromId, outId),
 *        b.scalars({ior, emissiveStrength, ...})
 */
function makeGraph(name, recipe) {
  const nodes = [{ id: 'out', type: OUTPUT_TYPE, x: 0, y: 0, params: {} }];
  const links = [];
  let k = 0;
  const b = {
    n(type, params = {}, label) { const id = 'p' + (++k); const node = { id, type, x: 0, y: 0, params }; if (label) node.label = label; nodes.push(node); return id; },
    link(f, fo, t, ti) { links.push({ from: [f, fo], to: [t, ti] }); },
    out(input, f, fo) { links.push({ from: [f, fo], to: ['out', input] }); },
    scalars(p) { Object.assign(nodes[0].params, p); },
  };
  recipe(b);
  layout(nodes, links);
  return { version: GRAPH_VERSION, name, nodes, links, frames: [], output: 'out', settings: { ...DEFAULT_SETTINGS } };
}
/** Column = longest link path to the output; rows in creation order. */
function layout(nodes, links) {
  const depth = new Map([['out', 0]]);
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const l of links) {
      const d = depth.get(l.to[0]);
      if (d == null) continue;
      if ((depth.get(l.from[0]) ?? -1) < d + 1) { depth.set(l.from[0], d + 1); changed = true; }
    }
    if (!changed) break;
  }
  const rows = new Map();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 1;
    const r = rows.get(d) || 0; rows.set(d, r + 1);
    n.x = 900 - d * 230; n.y = 60 + r * 150;
  }
  const out = nodes[0]; out.y = 60;
}

// ------------------------------------------------------------ recipes
// Gradients store sRGB hex stops (contract gradient param).
const grad = (...stops) => stops.map(([t, color]) => ({ t, color }));

function brushedSteel(b) {
  const lines = b.n('noise.brushed', { direction: 'horizontal', density: 384, length: 3, octaves: 3, seed: 3 });
  const metal = b.n('material.metal', { metal: 'iron', roughness: 0.3 });
  const tint = b.n('blend.blend', { mode: 'multiply', opacity: 0.08 });
  const lineCol = b.n('color.grayToColor', { a: '#c4c8cc', b: '#ffffff' });
  b.link(lines, 'out', lineCol, 'in');
  b.link(metal, 'baseColor', tint, 'a'); b.link(lineCol, 'out', tint, 'b');
  const rough = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.24, outHigh: 0.4, clamp: true });
  b.link(lines, 'out', rough, 'in');
  const h = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.49, outHigh: 0.51, clamp: true });
  b.link(lines, 'out', h, 'in');
  const nrm = b.n('hn.heightToNormal', { strength: 0.15 });
  b.link(h, 'out', nrm, 'height');
  const aniso = b.n('input.value', { v: 0.75 }, 'Anisotropy');
  b.out('baseColor', tint, 'out'); b.out('metallic', metal, 'metallic'); b.out('roughness', rough, 'out');
  b.out('normal', nrm, 'normal'); b.out('height', h, 'out'); b.out('anisotropy', aniso, 'out');
}

function rustedIron(b) {
  const metal = b.n('material.metal', { metal: 'iron', roughness: 0.35 });
  const mskN = b.n('noise.fbm', { scale: 5, seed: 11, kind: 'gradient', octaves: 7, lacunarity: 2, gain: 0.55 });
  const dirt = b.n('noise.dirt', { scale: 14, seed: 4, threshold: 0.55, soft: 0.2 });
  const both = b.n('blend.maskCombine', { mode: 'max', clamp: true });
  b.link(mskN, 'out', both, 'a'); b.link(dirt, 'out', both, 'b');
  const mask = b.n('adjust.histogramScan', { position: 0.45, contrast: 0.75 }, 'Rust Mask');
  b.link(both, 'out', mask, 'in');
  const rustN = b.n('noise.fbm', { scale: 24, seed: 2, kind: 'cellular', octaves: 4, lacunarity: 2, gain: 0.5 });
  const rustC = b.n('color.gradientMap', { gradient: grad([0, '#2a1208'], [0.35, '#6e2c0f'], [0.7, '#a24e1e'], [1, '#c9803f']) });
  b.link(rustN, 'out', rustC, 'in');
  const base = b.n('blend.mix', {});
  b.link(metal, 'baseColor', base, 'a'); b.link(rustC, 'out', base, 'b'); b.link(mask, 'out', base, 't');
  const rLo = b.n('input.value', { v: 0.32 }, 'Metal Rough'), rHi = b.n('input.value', { v: 0.92 }, 'Rust Rough');
  const rough = b.n('blend.mixFloat', {});
  b.link(rLo, 'out', rough, 'a'); b.link(rHi, 'out', rough, 'b'); b.link(mask, 'out', rough, 't');
  const metl = b.n('math.oneMinus', {});
  b.link(mask, 'out', metl, 'a');
  const hgt = b.n('math.add', { va: 0, vb: 0 });
  const hm = b.n('math.mul', { va: 0, vb: 0.25 });
  b.link(mask, 'out', hm, 'a');
  const hr = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.4, outHigh: 0.55, clamp: true });
  b.link(rustN, 'out', hr, 'in');
  b.link(hr, 'out', hgt, 'a'); b.link(hm, 'out', hgt, 'b');
  const nrm = b.n('hn.heightToNormal', { strength: 2.5 });
  b.link(hgt, 'out', nrm, 'height');
  const ao = b.n('hn.aoFromHeight', { radius: 0.03, depth: 0.05, power: 1 });
  b.link(hgt, 'out', ao, 'height');
  b.out('baseColor', base, 'out'); b.out('roughness', rough, 'out'); b.out('metallic', metl, 'out');
  b.out('height', hgt, 'out'); b.out('normal', nrm, 'normal'); b.out('ao', ao, 'ao');
}

function polishedGold(b) {
  const metal = b.n('material.metal', { metal: 'gold', roughness: 0.12 });
  const smudge = b.n('noise.fbm', { scale: 4, seed: 21, kind: 'gradient', octaves: 5, lacunarity: 2, gain: 0.5 });
  const sr = b.n('adjust.remap', { inLow: 0.2, inHigh: 0.8, outLow: 0.06, outHigh: 0.2, clamp: true });
  b.link(smudge, 'out', sr, 'in');
  const scr = b.n('gen.scratches', { count: 6, perCell: 4, length: 0.7, width: 0.006, angle: 25, spread: 0.6, seed: 5 });
  const scrR = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0, outHigh: 0.35, clamp: true });
  b.link(scr, 'out', scrR, 'in');
  const rough = b.n('blend.maskCombine', { mode: 'max', clamp: true });
  b.link(sr, 'out', rough, 'a'); b.link(scrR, 'out', rough, 'b');
  const h = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.5, outHigh: 0.47, clamp: true });
  b.link(scr, 'out', h, 'in');
  const nrm = b.n('hn.heightToNormal', { strength: 0.4 });
  b.link(h, 'out', nrm, 'height');
  b.out('baseColor', metal, 'baseColor'); b.out('metallic', metal, 'metallic'); b.out('roughness', rough, 'out');
  b.out('normal', nrm, 'normal'); b.out('height', h, 'out');
}

function copperPatina(b) {
  const metal = b.n('material.metal', { metal: 'copper', roughness: 0.28 });
  const cav = b.n('noise.fbm', { scale: 6, seed: 8, kind: 'gradient', octaves: 7, lacunarity: 2, gain: 0.55 });
  const mask = b.n('adjust.histogramScan', { position: 0.52, contrast: 0.6 }, 'Patina Mask');
  b.link(cav, 'out', mask, 'in');
  const pn = b.n('noise.clouds', { scale: 10, seed: 3, octaves: 6, contrast: 1.3, bias: 0 });
  const pc = b.n('color.gradientMap', { gradient: grad([0, '#2b5e50'], [0.5, '#4f9a82'], [0.85, '#86c4a8'], [1, '#b6e0c8']) });
  b.link(pn, 'out', pc, 'in');
  const base = b.n('blend.mix', {});
  b.link(metal, 'baseColor', base, 'a'); b.link(pc, 'out', base, 'b'); b.link(mask, 'out', base, 't');
  const rA = b.n('input.value', { v: 0.25 }, 'Copper Rough'), rB = b.n('input.value', { v: 0.85 }, 'Patina Rough');
  const rough = b.n('blend.mixFloat', {});
  b.link(rA, 'out', rough, 'a'); b.link(rB, 'out', rough, 'b'); b.link(mask, 'out', rough, 't');
  const metl = b.n('math.oneMinus', {});
  b.link(mask, 'out', metl, 'a');
  const h = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.42, outHigh: 0.58, clamp: true });
  b.link(cav, 'out', h, 'in');
  const nrm = b.n('hn.heightToNormal', { strength: 1.2 });
  b.link(h, 'out', nrm, 'height');
  b.out('baseColor', base, 'out'); b.out('roughness', rough, 'out'); b.out('metallic', metl, 'out');
  b.out('height', h, 'out'); b.out('normal', nrm, 'normal');
}

function oakPlanks(b) {
  const pl = b.n('gen.planks', { rows: 6, cols: 2, randomShift: 1, gap: 0.004, bevel: 0.006, heightVar: 0.12, seed: 7 });
  const wood = b.n('gen.woodRings', { count: 12, distortion: 0.7, noiseScale: 3, sharp: 2.5, seed: 9 });
  b.link(pl, 'local', wood, 'uv');
  const wc = b.n('color.gradientMap', { gradient: grad([0, '#4a2c16'], [0.4, '#7a5030'], [0.75, '#a77a4c'], [1, '#c79b68']) });
  b.link(wood, 'rings', wc, 'in');
  const var1 = b.n('color.grayToColor', { a: '#9c7f66', b: '#ffffff' });
  b.link(pl, 'random', var1, 'in');
  const base = b.n('blend.blend', { mode: 'multiply', opacity: 0.55, clamp: true });
  b.link(wc, 'out', base, 'a'); b.link(var1, 'out', base, 'b');
  const gm = b.n('math.mul', { va: 0, vb: 0.04 });
  b.link(wood, 'grain', gm, 'a');
  const h = b.n('math.add', { va: 0, vb: 0 });
  b.link(pl, 'height', h, 'a'); b.link(gm, 'out', h, 'b');
  const nrm = b.n('hn.heightToNormal', { strength: 2 });
  b.link(h, 'out', nrm, 'height');
  const rough = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.42, outHigh: 0.68, clamp: true });
  b.link(wood, 'grain', rough, 'in');
  const ao = b.n('hn.aoFromHeight', { radius: 0.02, depth: 0.04, power: 1.2 });
  b.link(h, 'out', ao, 'height');
  b.out('baseColor', base, 'out'); b.out('height', h, 'out'); b.out('normal', nrm, 'normal');
  b.out('roughness', rough, 'out'); b.out('ao', ao, 'ao');
}

function marble(b) {
  const w = b.n('noise.domainWarp', { scale: 3, seed: 14, warpScale: 3, strength: 0.45, octaves: 6 });
  const veins = b.n('noise.ridged', { scale: 4, seed: 6, kind: 'gradient', octaves: 6, lacunarity: 2, gain: 0.5 });
  const v2 = b.n('blend.mixFloat', { t: 0.55 });
  b.link(w, 'out', v2, 'a'); b.link(veins, 'out', v2, 'b');
  const col = b.n('color.gradientMap', { gradient: grad([0, '#f3f1ec'], [0.55, '#e4e0d9'], [0.78, '#bdb6ac'], [0.92, '#6c675f'], [1, '#3b3833']) });
  b.link(v2, 'out', col, 'in');
  const rough = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.06, outHigh: 0.16, clamp: true });
  b.link(v2, 'out', rough, 'in');
  const h = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.5, outHigh: 0.49, clamp: true });
  b.link(v2, 'out', h, 'in');
  const nrm = b.n('hn.heightToNormal', { strength: 0.25 });
  b.link(h, 'out', nrm, 'height');
  const cc = b.n('input.value', { v: 0.35 }, 'Polish');
  b.out('baseColor', col, 'out'); b.out('roughness', rough, 'out'); b.out('height', h, 'out');
  b.out('normal', nrm, 'normal'); b.out('clearcoat', cc, 'out');
}

function concrete(b) {
  const f = b.n('noise.fbm', { scale: 12, seed: 31, kind: 'gradient', octaves: 7, lacunarity: 2, gain: 0.5 });
  const stain = b.n('noise.dirt', { scale: 5, seed: 12, threshold: 0.5, soft: 0.3 });
  const c1 = b.n('color.grayToColor', { a: '#5f5c58', b: '#b4b0a8' });
  b.link(f, 'out', c1, 'in');
  const c2 = b.n('color.grayToColor', { a: '#ffffff', b: '#8a8378' });
  b.link(stain, 'out', c2, 'in');
  const base = b.n('blend.blend', { mode: 'multiply', opacity: 0.6, clamp: true });
  b.link(c1, 'out', base, 'a'); b.link(c2, 'out', base, 'b');
  const pits = b.n('noise.worley', { scale: 40, seed: 3, jitter: 1 });
  const th = b.n('adjust.threshold', { level: 0.09, soft: 0.03 });
  b.link(pits, 'f1', th, 'in');
  const hole = b.n('math.oneMinus', {});
  b.link(th, 'out', hole, 'a');
  const hb = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.45, outHigh: 0.55, clamp: true });
  b.link(f, 'out', hb, 'in');
  const hm = b.n('math.mul', { va: 0, vb: 0.18 });
  b.link(hole, 'out', hm, 'a');
  const h = b.n('math.sub', { va: 0, vb: 0 });
  b.link(hb, 'out', h, 'a'); b.link(hm, 'out', h, 'b');
  const nrm = b.n('hn.heightToNormal', { strength: 1.6 });
  b.link(h, 'out', nrm, 'height');
  const rough = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.78, outHigh: 0.96, clamp: true });
  b.link(f, 'out', rough, 'in');
  const ao = b.n('hn.aoFromHeight', { radius: 0.02, depth: 0.04, power: 1 });
  b.link(h, 'out', ao, 'height');
  b.out('baseColor', base, 'out'); b.out('height', h, 'out'); b.out('normal', nrm, 'normal');
  b.out('roughness', rough, 'out'); b.out('ao', ao, 'ao');
}

function ceramicTiles(b) {
  const t = b.n('gen.tiles', { cols: 4, rows: 4, gap: 0.012, bevel: 0.025, heightVar: 0.04, seed: 2 });
  const g1 = b.n('input.color', { c: '#1f5f7d' }, 'Glaze A'), g2 = b.n('input.color', { c: '#2f7c8c' }, 'Glaze B');
  const glaze = b.n('blend.mix', {});
  b.link(g1, 'out', glaze, 'a'); b.link(g2, 'out', glaze, 'b'); b.link(t, 'random', glaze, 't');
  const grout = b.n('input.color', { c: '#8d877d' }, 'Grout');
  const base = b.n('blend.mix', {});
  b.link(grout, 'out', base, 'a'); b.link(glaze, 'out', base, 'b'); b.link(t, 'mask', base, 't');
  const rA = b.n('input.value', { v: 0.88 }, 'Grout Rough'), rB = b.n('input.value', { v: 0.07 }, 'Glaze Rough');
  const rough = b.n('blend.mixFloat', {});
  b.link(rA, 'out', rough, 'a'); b.link(rB, 'out', rough, 'b'); b.link(t, 'mask', rough, 't');
  const nrm = b.n('hn.heightToNormal', { strength: 2.5 });
  b.link(t, 'height', nrm, 'height');
  const ao = b.n('hn.aoFromHeight', { radius: 0.02, depth: 0.05, power: 1.3 });
  b.link(t, 'height', ao, 'height');
  const cc = b.n('math.mul', { va: 0, vb: 0.7 });
  b.link(t, 'mask', cc, 'a');
  b.out('baseColor', base, 'out'); b.out('roughness', rough, 'out'); b.out('height', t, 'height');
  b.out('normal', nrm, 'normal'); b.out('ao', ao, 'ao'); b.out('clearcoat', cc, 'out');
}

function redBrick(b) {
  const br = b.n('gen.bricks', { cols: 4, rows: 8, shift: 0.5, gap: 0.01, bevel: 0.018, heightVar: 0.15, seed: 4 });
  const f = b.n('noise.fbm', { scale: 16, seed: 17, kind: 'value', octaves: 6, lacunarity: 2, gain: 0.5 });
  const bc = b.n('color.gradientMap', { gradient: grad([0, '#4e1a10'], [0.4, '#7e3220'], [0.75, '#a14c33'], [1, '#bf7050']) });
  b.link(f, 'out', bc, 'in');
  const rnd = b.n('color.grayToColor', { a: '#b88a78', b: '#ffffff' });
  b.link(br, 'random', rnd, 'in');
  const brick = b.n('blend.blend', { mode: 'multiply', opacity: 1, clamp: true });
  b.link(bc, 'out', brick, 'a'); b.link(rnd, 'out', brick, 'b');
  const mortar = b.n('input.color', { c: '#9a948a' }, 'Mortar');
  const base = b.n('blend.mix', {});
  b.link(mortar, 'out', base, 'a'); b.link(brick, 'out', base, 'b'); b.link(br, 'mask', base, 't');
  const fm = b.n('math.mul', { va: 0, vb: 0.05 });
  b.link(f, 'out', fm, 'a');
  const h = b.n('math.add', { va: 0, vb: 0 });
  b.link(br, 'height', h, 'a'); b.link(fm, 'out', h, 'b');
  const nrm = b.n('hn.heightToNormal', { strength: 3 });
  b.link(h, 'out', nrm, 'height');
  const rough = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.72, outHigh: 0.93, clamp: true });
  b.link(f, 'out', rough, 'in');
  const ao = b.n('hn.aoFromHeight', { radius: 0.03, depth: 0.06, power: 1.2 });
  b.link(h, 'out', ao, 'height');
  b.out('baseColor', base, 'out'); b.out('height', h, 'out'); b.out('normal', nrm, 'normal');
  b.out('roughness', rough, 'out'); b.out('ao', ao, 'ao');
}

function leather(b) {
  const cells = b.n('noise.worley', { scale: 28, seed: 5, jitter: 1 });
  const grain = b.n('adjust.remap', { inLow: 0, inHigh: 0.25, outLow: 0.45, outHigh: 0.55, clamp: true });
  b.link(cells, 'edge', grain, 'in');
  const f = b.n('noise.fbm', { scale: 6, seed: 19, kind: 'gradient', octaves: 5, lacunarity: 2, gain: 0.5 });
  const hide = b.n('input.color', { c: '#5b321c' }, 'Hide');
  const shade = b.n('color.grayToColor', { a: '#6d5444', b: '#ffffff' });
  b.link(f, 'out', shade, 'in');
  const base = b.n('blend.blend', { mode: 'multiply', opacity: 1, clamp: true });
  b.link(hide, 'out', base, 'a'); b.link(shade, 'out', base, 'b');
  const nrm = b.n('hn.heightToNormal', { strength: 1.8 });
  b.link(grain, 'out', nrm, 'height');
  const rough = b.n('adjust.remap', { inLow: 0.45, inHigh: 0.55, outLow: 0.72, outHigh: 0.52, clamp: true });
  b.link(grain, 'out', rough, 'in');
  const ao = b.n('hn.aoFromHeight', { radius: 0.01, depth: 0.03, power: 1 });
  b.link(grain, 'out', ao, 'height');
  const sheen = b.n('input.value', { v: 0.3 }, 'Sheen');
  b.out('baseColor', base, 'out'); b.out('height', grain, 'out'); b.out('normal', nrm, 'normal');
  b.out('roughness', rough, 'out'); b.out('ao', ao, 'ao'); b.out('sheen', sheen, 'out');
}

function wovenFabric(b) {
  const wv = b.n('gen.weave', { count: 24, width: 0.85, seed: 1 });
  const dark = b.n('input.color', { c: '#1b2742' }, 'Shadow'), lite = b.n('input.color', { c: '#40598a' }, 'Thread');
  const base = b.n('blend.mix', {});
  b.link(dark, 'out', base, 'a'); b.link(lite, 'out', base, 'b'); b.link(wv, 'height', base, 't');
  const fuzz = b.n('noise.white', { seed: 3 });
  const fz = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.8, outHigh: 0.95, clamp: true });
  b.link(fuzz, 'out', fz, 'in');
  const nrm = b.n('hn.heightToNormal', { strength: 2.2 });
  b.link(wv, 'height', nrm, 'height');
  const ao = b.n('hn.aoFromHeight', { radius: 0.01, depth: 0.05, power: 1.4 });
  b.link(wv, 'height', ao, 'height');
  const sheen = b.n('input.value', { v: 0.8 }, 'Sheen');
  b.out('baseColor', base, 'out'); b.out('roughness', fz, 'out'); b.out('height', wv, 'height');
  b.out('normal', nrm, 'normal'); b.out('ao', ao, 'ao'); b.out('sheen', sheen, 'out');
}

function carPaint(b) {
  const fl = b.n('gen.flakes', { count: 192, jitter: 1, tilt: 0.5, density: 1, seed: 6 });
  const paint = b.n('input.color', { c: '#7d0b12' }, 'Paint'), glint = b.n('input.color', { c: '#d8343c' }, 'Flake');
  const base = b.n('blend.mix', {});
  b.link(paint, 'out', base, 'a'); b.link(glint, 'out', base, 'b'); b.link(fl, 'sparkle', base, 't');
  const nrm = b.n('hn.normalStrength', { strength: 0.35 });
  b.link(fl, 'normal', nrm, 'in');
  const metl = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.35, outHigh: 0.9, clamp: true });
  b.link(fl, 'sparkle', metl, 'in');
  const rough = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.38, outHigh: 0.22, clamp: true });
  b.link(fl, 'sparkle', rough, 'in');
  const cc = b.n('input.value', { v: 1 }, 'Clearcoat'), ccr = b.n('input.value', { v: 0.03 }, 'Coat Rough');
  b.out('baseColor', base, 'out'); b.out('normal', nrm, 'out'); b.out('metallic', metl, 'out');
  b.out('roughness', rough, 'out'); b.out('clearcoat', cc, 'out'); b.out('clearcoatRoughness', ccr, 'out');
}

function rubber(b) {
  const dots = b.n('gen.dots', { count: 12, radius: 0.45, soft: 0.25, stagger: true });
  const f = b.n('noise.fbm', { scale: 48, seed: 9, kind: 'value', octaves: 4, lacunarity: 2, gain: 0.5 });
  const dm = b.n('math.mul', { va: 0, vb: 0.12 });
  b.link(dots, 'out', dm, 'a');
  const fr = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.49, outHigh: 0.51, clamp: true });
  b.link(f, 'out', fr, 'in');
  const h = b.n('math.add', { va: 0, vb: 0 });
  b.link(fr, 'out', h, 'a'); b.link(dm, 'out', h, 'b');
  const nrm = b.n('hn.heightToNormal', { strength: 2 });
  b.link(h, 'out', nrm, 'height');
  const col = b.n('input.color', { c: '#1d1d20' }, 'Rubber');
  const rough = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.78, outHigh: 0.92, clamp: true });
  b.link(f, 'out', rough, 'in');
  const ao = b.n('hn.aoFromHeight', { radius: 0.02, depth: 0.04, power: 1 });
  b.link(h, 'out', ao, 'height');
  b.out('baseColor', col, 'out'); b.out('height', h, 'out'); b.out('normal', nrm, 'normal');
  b.out('roughness', rough, 'out'); b.out('ao', ao, 'ao');
}

function cobblestone(b) {
  const w = b.n('noise.worley', { scale: 6, seed: 13, jitter: 0.85 });
  const sq = b.n('math.mul', { va: 0, vb: 0 }, 'Distance Squared');
  b.link(w, 'f1', sq, 'a'); b.link(w, 'f1', sq, 'b');
  const dome = b.n('adjust.remap', { inLow: 0, inHigh: 0.3, outLow: 1, outHigh: 0, clamp: true }, 'Stone Dome');
  b.link(sq, 'out', dome, 'in');
  const mask = b.n('adjust.threshold', { level: 0.05, soft: 0.04 }, 'Stone Mask');
  b.link(w, 'edge', mask, 'in');
  const h = b.n('math.mul', { va: 0, vb: 0 });
  b.link(dome, 'out', h, 'a'); b.link(mask, 'out', h, 'b');
  const stone = b.n('color.grayToColor', { a: '#6e675e', b: '#ada392' });
  b.link(w, 'id', stone, 'in');
  const f = b.n('noise.fbm', { scale: 20, seed: 23, kind: 'gradient', octaves: 5, lacunarity: 2, gain: 0.5 });
  const fs = b.n('color.grayToColor', { a: '#9a9a9a', b: '#ffffff' });
  b.link(f, 'out', fs, 'in');
  const st2 = b.n('blend.blend', { mode: 'multiply', opacity: 1, clamp: true });
  b.link(stone, 'out', st2, 'a'); b.link(fs, 'out', st2, 'b');
  const mortar = b.n('input.color', { c: '#5e574d' }, 'Mortar');
  const base = b.n('blend.mix', {});
  b.link(mortar, 'out', base, 'a'); b.link(st2, 'out', base, 'b'); b.link(mask, 'out', base, 't');
  const nrm = b.n('hn.heightToNormal', { strength: 2.5 });
  b.link(h, 'out', nrm, 'height');
  const ao = b.n('hn.aoFromHeight', { radius: 0.04, depth: 0.08, power: 1.3 });
  b.link(h, 'out', ao, 'height');
  const rough = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.68, outHigh: 0.9, clamp: true });
  b.link(f, 'out', rough, 'in');
  b.out('baseColor', base, 'out'); b.out('height', h, 'out'); b.out('normal', nrm, 'normal');
  b.out('ao', ao, 'ao'); b.out('roughness', rough, 'out');
}

function sand(b) {
  const waves = b.n('gen.waves', { count: 7, freq: 2, amp: 0.2, direction: 'horizontal' });
  const warp = b.n('uv.distort', { scale: 3, amount: 0.06, octaves: 3, seed: 2 });
  b.link(warp, 'uv', waves, 'uv');
  const f = b.n('noise.fbm', { scale: 64, seed: 41, kind: 'value', octaves: 3, lacunarity: 2, gain: 0.5 });
  const wm = b.n('math.mul', { va: 0, vb: 0.7 });
  b.link(waves, 'out', wm, 'a');
  const fm = b.n('math.mul', { va: 0, vb: 0.3 });
  b.link(f, 'out', fm, 'a');
  const h = b.n('math.add', { va: 0, vb: 0 });
  b.link(wm, 'out', h, 'a'); b.link(fm, 'out', h, 'b');
  const col = b.n('color.grayToColor', { a: '#a88b5c', b: '#e3cb9c' });
  b.link(f, 'out', col, 'in');
  const nrm = b.n('hn.heightToNormal', { strength: 1.4 });
  b.link(h, 'out', nrm, 'height');
  const rough = b.n('input.value', { v: 0.92 }, 'Roughness');
  const ao = b.n('hn.aoFromHeight', { radius: 0.03, depth: 0.04, power: 1 });
  b.link(h, 'out', ao, 'height');
  b.out('baseColor', col, 'out'); b.out('height', h, 'out'); b.out('normal', nrm, 'normal');
  b.out('roughness', rough, 'out'); b.out('ao', ao, 'ao');
}

function lavaRock(b) {
  const cr = b.n('noise.cracks', { scale: 5, seed: 7, jitter: 0.9, width: 0.06, warp: 0.1, warpScale: 6 });
  const f = b.n('noise.fbm', { scale: 10, seed: 27, kind: 'cellular', octaves: 6, lacunarity: 2, gain: 0.55 });
  const rock = b.n('color.grayToColor', { a: '#110f0e', b: '#3d3530' });
  b.link(f, 'out', rock, 'in');
  const glow = b.n('color.gradientMap', { gradient: grad([0, '#000000'], [0.35, '#5a0a00'], [0.7, '#ff4a00'], [1, '#ffd36a']) });
  b.link(cr, 'out', glow, 'in');
  const solid = b.n('math.oneMinus', {});
  b.link(cr, 'out', solid, 'a');
  const h = b.n('math.mul', { va: 0, vb: 0 });
  b.link(solid, 'out', h, 'a'); b.link(f, 'out', h, 'b');
  const base = b.n('blend.mix', {});
  const crust = b.n('input.color', { c: '#1a0d08' }, 'Crust');
  b.link(crust, 'out', base, 'a'); b.link(rock, 'out', base, 'b'); b.link(solid, 'out', base, 't');
  const nrm = b.n('hn.heightToNormal', { strength: 2.5 });
  b.link(h, 'out', nrm, 'height');
  const rough = b.n('adjust.remap', { inLow: 0, inHigh: 1, outLow: 0.95, outHigh: 0.78, clamp: true });
  b.link(f, 'out', rough, 'in');
  const ao = b.n('hn.aoFromHeight', { radius: 0.03, depth: 0.06, power: 1.2 });
  b.link(h, 'out', ao, 'height');
  b.out('baseColor', base, 'out'); b.out('emissive', glow, 'out'); b.out('height', h, 'out');
  b.out('normal', nrm, 'normal'); b.out('roughness', rough, 'out'); b.out('ao', ao, 'ao');
  b.scalars({ emissiveStrength: 6 });
}

const RECIPES = [
  ['brushedSteel', 'Brushed Steel', ['#d6dade', '#5d6268'], 'Anisotropic iron with directional brush lines.', ['metal'], brushedSteel],
  ['rustedIron', 'Rusted Iron', ['#9a5a30', '#3a2a22'], 'Iron under rust that grows from a cavity and dirt mask.', ['metal', 'weathered'], rustedIron],
  ['polishedGold', 'Polished Gold', ['#ffe39a', '#9a6a10'], 'Low-roughness gold with fine scratches and smudges.', ['metal'], polishedGold],
  ['copperPatina', 'Copper Patina', ['#7bc0a6', '#8a4a24'], 'Copper with a green verdigris layer in its cavities.', ['metal', 'weathered'], copperPatina],
  ['oakPlanks', 'Oak Planks', ['#c39566', '#5a3a1e'], 'Staggered planks with per-plank ring grain and color.', ['wood'], oakPlanks],
  ['marble', 'Marble', ['#f6f4ef', '#9c968c'], 'Warped white marble with dark veins and a light polish coat.', ['stone'], marble],
  ['concrete', 'Concrete', ['#b0aca4', '#5a5752'], 'Cast concrete with stains and air pits.', ['stone'], concrete],
  ['ceramicTiles', 'Ceramic Tiles', ['#3f8fa6', '#1a4050'], 'Glazed tiles with per-tile tone, grout and a clearcoat glaze.', ['tile'], ceramicTiles],
  ['redBrick', 'Red Brick', ['#c06a4c', '#4e1a10'], 'Running-bond brick with mortar and fired-color variation.', ['stone'], redBrick],
  ['leather', 'Leather', ['#8a5636', '#2c170c'], 'Pebbled hide grain with a soft sheen.', ['organic'], leather],
  ['wovenFabric', 'Woven Fabric', ['#5672a8', '#18213a'], 'Plain weave threads with fuzz roughness and sheen.', ['fabric'], wovenFabric],
  ['carPaint', 'Car Paint', ['#ff5a60', '#4a0408'], 'Metallic flake base under a glossy clearcoat.', ['paint', 'clearcoat'], carPaint],
  ['rubber', 'Rubber', ['#4a4a50', '#0c0c0e'], 'Matte black rubber with raised grip dots.', ['synthetic'], rubber],
  ['cobblestone', 'Cobblestone', ['#9a9184', '#3a352e'], 'Domed cobbles from cellular noise, set in mortar.', ['stone'], cobblestone],
  ['sand', 'Sand', ['#e8d2a4', '#8c7046'], 'Wind ripples over fine grain.', ['ground'], sand],
  ['lavaRock', 'Lava Rock', ['#ff7a20', '#140c08'], 'Dark crust with glowing cracks (emissive).', ['stone', 'emissive'], lavaRock],
];

/** @type {Array<{id:string, label:string, swatch:string[], description:string, tags:string[], graph:import('./contract.js').Graph}>} */
export const MATERIAL_PRESETS = RECIPES.map(([id, label, swatch, description, tags, fn]) => ({
  id, label, swatch, description, tags, graph: makeGraph(label, fn),
}));

/** The preset a fresh page starts with. */
export const DEFAULT_PRESET = 'rustedIron';

// ------------------------------------------------------------ checker
/**
 * Check one preset graph against a registry. Returns a list of problems.
 * @param {import('./contract.js').Graph} g @param {Map<string,object>} registry
 * @returns {string[]}
 */
export function checkPreset(g, registry) {
  const errs = [...validateGraph(g, registry).errors];
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  for (const n of g.nodes) {
    const d = registry.get(n.type); if (!d) continue;
    for (const pid of Object.keys(n.params || {})) if (!(d.params || []).some(p => p.id === pid)) errs.push(`${n.id} ${n.type}: no param "${pid}"`);
    for (const p of d.params || []) {
      const v = n.params?.[p.id];
      if (v === undefined || p.kind !== 'enum') continue;
      const opts = (p.options || []).map(o => typeof o === 'object' ? String(o.value) : String(o));
      if (!opts.includes(String(v))) errs.push(`${n.id} ${n.type}: ${p.id}="${v}" is not an option`);
    }
  }
  for (const l of g.links) {
    const a = byId.get(l.from[0]), b = byId.get(l.to[0]);
    const da = a && registry.get(a.type), db = b && registry.get(b.type);
    if (!da || !db) continue;
    const o = (da.outputs || []).find(p => p.id === l.from[1]);
    const i = (db.inputs || []).find(p => p.id === l.to[1]);
    if (!o) { errs.push(`${a.id} ${a.type}: no output "${l.from[1]}"`); continue; }
    if (!i) { errs.push(`${b.id} ${b.type}: no input "${l.to[1]}"`); continue; }
    if (!canConnect(o.type, i.type)) errs.push(`${a.id}.${o.id} (${o.type}) cannot feed ${b.id}.${i.id} (${i.type})`);
  }
  // cycle check (depth-first, white/grey/black)
  const adj = new Map(); for (const l of g.links) { if (!adj.has(l.from[0])) adj.set(l.from[0], []); adj.get(l.from[0]).push(l.to[0]); }
  const mark = new Map();
  const visit = id => {
    if (mark.get(id) === 1) return true; if (mark.get(id) === 2) return false;
    mark.set(id, 1);
    for (const t of adj.get(id) || []) if (visit(t)) return true;
    mark.set(id, 2); return false;
  };
  for (const n of g.nodes) if (visit(n.id)) { errs.push('the graph has a cycle'); break; }
  // every node must reach the output
  const used = new Set(['out']); let grew = true;
  while (grew) { grew = false; for (const l of g.links) if (used.has(l.to[0]) && !used.has(l.from[0])) { used.add(l.from[0]); grew = true; } }
  for (const n of g.nodes) if (!used.has(n.id)) errs.push(`${n.id} ${n.type} does not reach the output`);
  return errs;
}

// ------------------------------------------------------------ init / api
let ctx = null;
/** Check every preset: structure, and compile when compile.js has compileGraph. */
async function selfTest() {
  const reg = ctx.store.state.registry;
  const compile = ctx.modules.compile?.compileGraph;
  const graphMod = ctx.modules.graph;
  const results = {};
  let ok = true;
  for (const p of MATERIAL_PRESETS) {
    const errs = checkPreset(p.graph, reg);
    let compiled = null;
    if (typeof compile === 'function') {
      try {
        const live = typeof graphMod?.deserialize === 'function' ? graphMod.deserialize(p.graph) : p.graph;
        const c = compile(live, reg);
        compiled = { passes: c?.passes?.length ?? 0, errors: (c?.errors || []).map(e => (e.nodeId ? e.nodeId + ': ' : '') + e.message) };
        errs.push(...compiled.errors);
      } catch (e) { errs.push('compile threw: ' + (e.message || e)); }
    }
    if (errs.length) ok = false;
    results[p.id] = errs.length ? errs : (compiled ? `ok, ${compiled.passes} passes` : 'ok');
  }
  return { ok, count: MATERIAL_PRESETS.length, results };
}

/**
 * Load each preset in turn, wait for its bake, and record the time or the
 * error. Puts the old graph back after. Needs bake.js; slow at high res.
 * @param {{timeout?:number, res?:number}} [opts]
 */
async function bakeAll({ timeout = 20000 } = {}) {
  const { store } = ctx, st = store.state;
  const gm = ctx.modules.graph;
  const saved = st.graph && typeof gm?.serialize === 'function' ? gm.serialize(st.graph) : null;
  const out = {};
  for (const p of MATERIAL_PRESETS) {
    const r = await new Promise(res => {
      const t0 = performance.now();
      let timer = 0;
      const done = (k, v) => { offD(); offE(); clearTimeout(timer); res(k === 'ok' ? { ok: true, ms: +(v?.ms ?? performance.now() - t0).toFixed(1) } : { ok: false, error: v?.message || String(v) }); };
      const offD = store.on('bake:done', m => done('ok', m));
      const offE = store.on('bake:error', e => done('err', e));
      timer = setTimeout(() => done('err', { message: 'timeout' }), timeout);
      if (typeof gm?.actions?.load === 'function') gm.actions.load({ ...p.graph, settings: { ...p.graph.settings, res: st.settings.res } }, { resetHistory: true });
      else { st.graph = p.graph; store.emit('graph:changed', { reason: 'load' }); }
    });
    out[p.id] = r;
  }
  if (saved && typeof gm?.actions?.load === 'function') gm.actions.load(saved, { resetHistory: true });
  return { ok: Object.values(out).every(r => r.ok), results: out };
}

/** @param {object} c main.js module context */
export async function init(c) {
  ctx = c;
  const st = c.store.state;
  // A fresh page starts on a material, not an empty graph (?empty keeps it empty).
  if (!st.graph && !/[?&]empty\b/.test(location.search)) {
    const p = MATERIAL_PRESETS.find(x => x.id === DEFAULT_PRESET);
    const errs = p ? checkPreset(p.graph, st.registry) : ['missing'];
    if (!errs.length) {
      const g = { ...p.graph, settings: { ...p.graph.settings, res: st.settings.res } };
      st.graph = typeof c.modules.graph?.deserialize === 'function' ? c.modules.graph.deserialize(g) : JSON.parse(JSON.stringify(g));
    } else console.warn('[presets] default preset skipped:', errs);
  }
  c.register('presets', { MATERIAL_PRESETS, checkPreset, selfTest, bakeAll });
}
