// ============================================================================
//  REACTION-DIFFUSION  ·  tests.mjs — node stella-nova/pages/reaction-diffusion/tests.mjs
// ----------------------------------------------------------------------------
//  The varied start states (vary.js through shadergen.js buildInitState):
//    determinism  one seed gives one start state, for every preset
//    finite       every preset and seed builds finite values
//    fixed        FIXED presets and parameter maps keep their start
//    spread       a seed preset puts its seed shapes at different places
//    copies       a seed preset gets 1 to 5 copies, all counts occur
//    crystal      the crystal grows from 1 to 5 discs, inside the grid
//    params       varyParams stays inside each slider's range
// ============================================================================
import { readFileSync } from 'node:fs';
import { buildInitState } from './shadergen.js';
import { varyInit, isSeedPreset, FIXED, PARAMS, varyParams } from './vary.js';

const here = new URL('.', import.meta.url).pathname;
const raw = JSON.parse(readFileSync(here + 'presets.json', 'utf8'));
const PRESETS = Array.isArray(raw) ? raw : raw.presets;
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const W = 64;

{
  let bad = [], nonDet = [];
  for (const p of PRESETS) for (const seed of [1, 2, 77]) {
    const a = buildInitState(p, W, W, seed);
    if (!a.every(Number.isFinite)) bad.push(p.id + '@' + seed);
    if (seed === 77) { const b = buildInitState(p, W, W, seed); if (a.some((v, i) => v !== b[i])) nonDet.push(p.id); }
  }
  ok(bad.length === 0, `finite: every preset (${PRESETS.length}) and seed builds finite values`, bad.slice(0, 5).join(' '));
  ok(nonDet.length === 0, 'determinism: one seed gives one start state', nonDet.join(' '));
}
{
  const kept = PRESETS.filter(p => FIXED.has(p.id) || p.paramMap);
  ok(kept.every(p => varyInit(p, 9) === (p.init || []) || JSON.stringify(varyInit(p, 9)) === JSON.stringify(p.init)),
    `fixed: ${kept.length} fixed presets and parameter maps keep their start`, kept.map(p => p.id).join(' '));
}
// The centre of mass of the cells the seed ops change (against the
// background of the same preset): it must move across seeds.
const seeds = PRESETS.filter(isSeedPreset);
{
  let still = [], counts = new Set();
  for (const p of seeds) {
    const cs = [];
    for (let s = 1; s <= 24; s++) {
      const ops = varyInit(p, s), bgN = (p.init || []).filter(op => !op.region && op.op !== 'gauss').length;
      const per = (p.init || []).length - bgN;
      if (per > 0) counts.add((ops.length - bgN) / per);
      const ref = buildInitState({ ...p, init: (p.init || []).filter(op => !op.region && op.op !== 'gauss') }, W, W, s);
      const st = buildInitState(p, W, W, s);
      let sx = 0, sy = 0, n = 0;
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) for (let k = 0; k < 4; k++) {
        const q = (j * W + i) * 4 + k;
        if (Math.abs(st[q] - ref[q]) > 1e-6) { sx += i / W; sy += j / W; n++; break; }
      }
      if (n) cs.push([sx / n, sy / n]);
    }
    const mx = cs.reduce((a, c) => a + c[0], 0) / cs.length, my = cs.reduce((a, c) => a + c[1], 0) / cs.length;
    const spread = Math.sqrt(cs.reduce((a, c) => a + (c[0] - mx) ** 2 + (c[1] - my) ** 2, 0) / cs.length);
    if (!(spread > 0.06)) still.push(`${p.id} ${spread.toFixed(3)}`);
  }
  ok(seeds.length >= 10 && still.length === 0, `spread: ${seeds.length} seed presets move their seeds across 24 seeds`, still.slice(0, 5).join('; '));
  ok([1, 2, 3, 4, 5].every(c => counts.has(c)) && [...counts].every(c => c >= 1 && c <= 5), 'copies: a seed preset gets 1 to 5 copies, all counts occur', [...counts].sort().join(' '));
}
{
  const p = PRESETS.find(q => q.id === 'kobayashi-crystal'), G = 128, n = new Set();
  let edge = 0;
  for (let s = 1; s <= 40; s++) {
    const st = buildInitState(p, G, G, s), on = (i, j) => st[(j * G + i) * 4] > 0.5;
    const seen = new Uint8Array(G * G); let comps = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      if (!on(i, j) || seen[j * G + i]) continue;
      comps++; const stack = [[i, j]]; seen[j * G + i] = 1;
      while (stack.length) { const [x, y] = stack.pop(); if (x === 0 || y === 0 || x === G - 1 || y === G - 1) edge++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + dx, b = y + dy; if (a >= 0 && b >= 0 && a < G && b < G && on(a, b) && !seen[b * G + a]) { seen[b * G + a] = 1; stack.push([a, b]); } } }
    }
    n.add(comps);
  }
  ok([...n].every(c => c >= 1 && c <= 5) && n.size >= 4 && edge === 0, 'crystal: 1 to 5 discs, inside the grid', `disc counts ${[...n].sort().join(' ')}`);
}
{
  let bad = [];
  let r = 1; const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  for (const id of Object.keys(PARAMS)) {
    const p = PRESETS.find(q => q.id === id);
    for (let k = 0; k < 200; k++) for (const [name, v] of Object.entries(varyParams(p, rnd))) {
      const q = p.params.find(x => x.name === name);
      if (!(v >= q.min && v <= q.max)) bad.push(`${id}.${name}=${v}`);
    }
  }
  ok(bad.length === 0, 'params: varied values stay inside the slider ranges', bad.slice(0, 4).join(' '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
