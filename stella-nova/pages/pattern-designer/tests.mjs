// ============================================================================
//  PATTERN DESIGNER  ·  tests.mjs — node tests (no DOM)
// ----------------------------------------------------------------------------
//  Run from the repo root:  node stella-nova/pages/pattern-designer/tests.mjs
//  1. book: at least 40 patterns in 8 families, unique ids, sane params.
//  2. determinism: the same id, params and seed give the same elements.
//  3. numbers: no NaN or Infinity in any element, at min, default, max.
//  4. caps: each run stays under CAP.nodes and CAP.points, on three aspects.
//  5. SVG: well-formed XML (a small tag parser), a viewBox, real mm units
//     for each A size, and a viewBox aspect equal to the paper aspect.
//  6. modifiers: every kind keeps the caps and the numbers, is fixed by
//     the seed, a circle mask keeps lines inside the circle, mirror x is
//     symmetric, dash pieces are no longer than the dash, and a text mask
//     reads its grid.
//  7. worker: runJob gives the same result as run + applyModifiers.
//  8. palettes: 80 or more in known groups, valid hex, the first ink has
//     a WCAG contrast of 3 or more on the paper, and no two palettes are
//     nearer than PAL_MIN_DIST in OKLab (color.js paletteDistance).
//  9. palette tools: harmony hues sit at the kind's offsets in OKLCH, the
//     first ink keeps a contrast of 3, the same random source gives the
//     same palette, locks hold, shuffle keeps the ink set, invert swaps.
// 10. new generators (NEW_FAMS and NEW_IDS): seeds 7 and 8 differ, every
//     point inside the board, not capped and at most NEW_NODES elements,
//     at most LIGHT_MS at defaults (unless heavy) and MAX_MS at the max
//     params, on three aspects. Prints a table of time and size.
//  Prints one line per failure and a summary; exits 1 on any failure.
// ============================================================================
import { run, defaults, CAP, boardSize, UNIT } from './engine.js';
import { PATTERNS, FAMILIES } from './patterns/index.js';
import { BOARDS, boardDims, PALETTES, PALETTE_GROUPS } from './palettes.js';
import { contrast, paletteDistance, hexToOklab, oklabToHex, hexToOklch, oklchToHex, HARMONY_KINDS, harmony, withLocks, shuffleInks, invertPalette } from './color.js';
import { makeRng } from './engine.js';
import { applyModifiers, modDefaults, MOD_KINDS } from './modifiers.js';
import { toSVG, applyMode, codeExtract } from './export.js';
import { runJob } from './worker.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const finite = items => items.every(e => e.t === 'circle' ? [e.x, e.y, e.r].every(Number.isFinite) : (e.t === 'multi' ? e.rr.flat() : e.p).every(Number.isFinite));
const count = items => items.reduce((a, e) => a + (e.t === 'circle' ? 1 : e.t === 'multi' ? e.rr.reduce((s, r) => s + r.length / 2, 0) : e.p.length / 2), 0);
const sig = items => JSON.stringify(items);
const ASPECTS = [0.8, 9 / 16, 16 / 9];
const timing = [];

// 1. book
ok(PATTERNS.length >= 40, `at least 40 patterns (${PATTERNS.length})`);
ok(FAMILIES.length >= 8, `at least 8 families (${FAMILIES.length})`);
for (const f of FAMILIES) ok(PATTERNS.filter(p => p.family === f.id).length >= 4, `family ${f.id} has 4 or more patterns`);
const ids = new Set();
for (const p of PATTERNS) {
  ok(!ids.has(p.id), `unique id ${p.id}`); ids.add(p.id);
  ok(FAMILIES.some(f => f.id === p.family), `${p.id} family ${p.family} is known`);
  ok(typeof p.name === 'string' && p.name.length > 2 && typeof p.gen === 'function', `${p.id} has a name and gen`);
  for (const k in p.params) {
    const [a, b, st, d, label] = p.params[k];
    ok(a < b && st > 0 && d >= a && d <= b && typeof label === 'string', `${p.id}.${k} param range [${a}, ${b}] step ${st} default ${d}`);
  }
  ok(codeExtract(p.gen).split('\n').length >= 3, `${p.id} gives a code extract`);
}

// 2-4. determinism, numbers, caps
const at = (p, which) => { const P = {}; for (const k in p.params) P[k] = which === 'min' ? p.params[k][0] : which === 'max' ? p.params[k][1] : p.params[k][3]; return P; };
// Per pattern: { defMs, maxMs, defN, maxN, out (worst units outside the
// board), capped, same78 }, for section 10.
const stats = {};
const outside = (items, W, H) => {
  let o = 0;
  for (const e of items) {
    const q = e.t === 'circle' ? [e.x - e.r, e.y - e.r, e.x + e.r, e.y + e.r] : e.t === 'multi' ? e.rr.flat() : e.p;
    for (let i = 0; i < q.length; i += 2) o = Math.max(o, -q[i], -q[i + 1], q[i] - W, q[i + 1] - H);
  }
  return o;
};
for (const p of PATTERNS) {
  const { W, H } = boardSize(0.8);
  const a = run(p, defaults(p), 7, W, H), b = run(p, defaults(p), 7, W, H), c = run(p, defaults(p), 8, W, H);
  timing.push([p.id, a.ms, !!p.heavy]);
  const S = stats[p.id] = { defMs: a.ms, maxMs: 0, defN: a.items.length, maxN: 0, out: 0, capped: false, same78: sig(a.items) === sig(c.items) };
  ok(sig(a.items) === sig(b.items), `${p.id} is fixed by the seed`);
  ok(a.items.length > 0, `${p.id} draws something at its defaults`);
  if (sig(a.items) === sig(c.items)) console.log('note', p.id, 'gives the same result for seeds 7 and 8');
  for (const asp of ASPECTS) for (const which of ['min', 'def', 'max']) {
    const s = boardSize(asp), r = run(p, at(p, which), 3, s.W, s.H);
    ok(finite(r.items), `${p.id} ${which} aspect ${asp.toFixed(2)}: finite numbers`);
    ok(r.items.length <= CAP.nodes && count(r.items) <= CAP.points, `${p.id} ${which} aspect ${asp.toFixed(2)}: under the caps (${r.items.length} nodes, ${count(r.items)} points)`);
    if (which === 'max') timing.push([p.id + ' max ' + asp.toFixed(2), r.ms, !!p.heavy]);
    if (which === 'max') S.maxMs = Math.max(S.maxMs, r.ms);
    S.maxN = Math.max(S.maxN, r.items.length); S.out = Math.max(S.out, outside(r.items, s.W, s.H)); S.capped = S.capped || r.capped;
  }
}

// 5. SVG
function xmlCheck(s) {
  const tags = s.match(/<[^>]*>/g) || [], stack = [];
  const text = s.replace(/<[^>]*>/g, '');
  if (/<|&(?!amp;|lt;|gt;|quot;|#\d+;)/.test(text)) return 'bad text';
  for (const t of tags) {
    if (/^<\?/.test(t) || /^<!--/.test(t)) continue;
    const m = t.match(/^<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>$/);
    if (!m) return 'bad tag ' + t.slice(0, 80);
    if (m[1]) { if (stack.pop() !== m[2]) return 'unbalanced ' + m[2]; }
    else if (!m[4]) stack.push(m[2]);
  }
  return stack.length ? 'unclosed ' + stack.join(',') : '';
}
for (const p of PATTERNS) {
  const { W, H } = boardSize(210 / 297), r = run(p, defaults(p), 5, W, H);
  const svg = toSVG(applyMode(r.items, 'auto'), { W, H, palette: PALETTES[0], lw: 2, title: p.name + ' <&>', desc: 'test "quotes"', size: { w: 210, h: 297, unit: 'mm' } });
  const e = xmlCheck(svg);
  ok(!e, `${p.id} SVG is well-formed ${e}`);
  ok(!/NaN|undefined|Infinity/.test(svg), `${p.id} SVG has no NaN or undefined`);
}
for (const b of BOARDS) for (const land of [false, true]) {
  const d = boardDims(b, land), { W, H } = boardSize(d.aspect);
  const svg = toSVG([{ t: 'circle', x: 10, y: 10, r: 5, f: 0, s: -1, w: 1 }], { W, H, palette: PALETTES[0], size: { w: d.w, h: d.h, unit: d.unit } });
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/), wd = svg.match(/width="([\d.]+)(mm|px)"/), ht = svg.match(/height="([\d.]+)(mm|px)"/);
  ok(vb && wd && ht, `${b.id} land ${land}: viewBox, width and height`);
  if (!vb || !wd || !ht) continue;
  ok(Math.min(+vb[1], +vb[2]) === UNIT, `${b.id} land ${land}: short side ${UNIT} units`);
  ok(Math.abs(+vb[1] / +vb[2] - (+wd[1]) / (+ht[1])) < 1e-3, `${b.id} land ${land}: viewBox aspect equals the paper aspect`);
  if (b.mm) ok(wd[2] === 'mm' && +wd[1] === d.w && +ht[1] === d.h, `${b.id} land ${land}: ${d.w} x ${d.h} mm`);
  else ok(wd[2] === 'px', `${b.id}: px units`);
}
{ // A clip writes a clipPath, and the frame line.
  const { W, H } = boardSize(0.8), p = PATTERNS[0], r = run(p, defaults(p), 1, W, H);
  const m = applyModifiers(r.items, [Object.assign(modDefaults('clip'), { shape: 'arch' })], W, H, 1);
  const svg = toSVG(m.items, { W, H, palette: PALETTES[0], clip: m.clip, frame: m.frame });
  ok(/<clipPath id="pd-clip">/.test(svg) && /clip-path="url\(#pd-clip\)"/.test(svg) && /id="frame"/.test(svg) && !xmlCheck(svg), 'clip modifier writes a clipPath and a frame');
}

// 6. modifiers
const { W: MW, H: MH } = boardSize(0.8);
const sample = ['arc-lattice', 'module-grid', PATTERNS.find(p => p.family === 'flow').id, PATTERNS.find(p => p.family === 'radial').id, PATTERNS.find(p => p.family === 'iso').id, PATTERNS.find(p => p.family === 'physics').id];
const stacks = [];
for (const t in MOD_KINDS) for (const c of Object.values(MOD_KINDS[t].choice || { _: [null] })[0]) {
  const m = modDefaults(t); const ck = Object.keys(MOD_KINDS[t].choice || {})[0]; if (ck && c != null && c !== 'text') m[ck] = c;
  if (c === 'text') continue;
  stacks.push([m]);
}
stacks.push([Object.assign(modDefaults('warp'), { kind: 'twirl' }), Object.assign(modDefaults('mirror'), { kind: 'kaleido', n: 8 }), modDefaults('dash')]);
stacks.push([Object.assign(modDefaults('repeat'), { nx: 8, ny: 8 }), modDefaults('jitter')]);
for (const id of sample) {
  const p = PATTERNS.find(q => q.id === id), base = run(p, defaults(p), 11, MW, MH).items;
  for (const st of stacks) {
    const name = `${id} + ${st.map(m => m.type + (m.kind ? ':' + m.kind : m.shape ? ':' + m.shape : '')).join(' + ')}`;
    const a = applyModifiers(base, st, MW, MH, 4), b = applyModifiers(base, st, MW, MH, 4);
    ok(sig(a.items) === sig(b.items), `${name}: fixed by the seed`);
    ok(finite(a.items), `${name}: finite numbers`);
    ok(a.items.length <= CAP.nodes && count(a.items) <= CAP.points, `${name}: under the caps`);
    const e = xmlCheck(toSVG(a.items, { W: MW, H: MH, palette: PALETTES[1], clip: a.clip, frame: a.frame }));
    ok(!e, `${name}: SVG well-formed ${e}`);
  }
}
{ // A circle mask keeps line points inside the circle.
  const p = PATTERNS.find(q => q.id === 'arc-lattice'), base = run(p, defaults(p), 2, MW, MH).items;
  const m = Object.assign(modDefaults('mask'), { shape: 'circle', margin: 0.1 }), r = applyModifiers(base, [m], MW, MH, 1).items;
  const R = Math.min(MW, MH) * 0.4; let worst = 0;
  for (const e of r) if (e.t === 'poly') for (let i = 0; i < e.p.length; i += 2) worst = Math.max(worst, Math.hypot(e.p[i] - MW / 2, e.p[i + 1] - MH / 2) - R);
  ok(r.length > 10 && worst < 0.6, `circle mask keeps lines inside (worst ${worst.toFixed(3)} units past the edge)`);
  const inv = applyModifiers(base, [Object.assign({}, m, { invert: 1 })], MW, MH, 1).items;
  let inner = 0; for (const e of inv) if (e.t === 'poly') for (let i = 0; i < e.p.length; i += 2) inner = Math.max(inner, R - Math.hypot(e.p[i] - MW / 2, e.p[i + 1] - MH / 2));
  ok(inv.length > 10 && inner < 0.6, `inverted circle mask keeps lines outside (${inner.toFixed(3)})`);
}
{ // Mirror x: each element has a twin across the centre line.
  const p = PATTERNS.find(q => q.id === 'split-squares'), base = run(p, defaults(p), 2, MW, MH).items;
  const r = applyModifiers(base, [Object.assign(modDefaults('mirror'), { kind: 'x' })], MW, MH, 1).items;
  const half = r.length / 2, twin = (e, f) => e.p.length === f.p.length && e.p.every((v, i) => Math.abs((i % 2 ? v : MW - v) - f.p[i]) < 1e-6);
  ok(r.length > 0 && r.length % 2 === 0 && r.slice(half).every((e, i) => twin(e, r[i])), 'mirror x gives a twin for each element');
}
{ // Dash pieces are no longer than the dash.
  const p = PATTERNS.find(q => q.id === 'arc-lattice'), base = run(p, defaults(p), 2, MW, MH).items;
  const r = applyModifiers(base, [Object.assign(modDefaults('dash'), { dash: 12, gap: 8 })], MW, MH, 1).items;
  let worst = 0;
  for (const e of r) { let L = 0; for (let i = 2; i < e.p.length; i += 2) L += Math.hypot(e.p[i] - e.p[i - 2], e.p[i + 1] - e.p[i - 1]); worst = Math.max(worst, L); }
  ok(r.length > base.length && worst <= 12.01, `dash pieces at most 12 units (longest ${worst.toFixed(2)})`);
}
{ // A text mask reads its grid: a grid with the left half on.
  const gw = 100, gh = 125, k = MW / gw, data = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw / 2; i++) data[j * gw + i] = 255;
  const text = { grid: { w: gw, h: gh, k, x0: 0, y0: 0, data }, rings: [[0, 0, MW / 2, 0, MW / 2, MH, 0, MH]] };
  const p = PATTERNS.find(q => q.id === 'arc-lattice'), base = run(p, defaults(p), 2, MW, MH).items;
  const r = applyModifiers(base, [Object.assign(modDefaults('mask'), { shape: 'text', text })], MW, MH, 1).items;
  let worst = 0; for (const e of r) for (let i = 0; i < e.p.length; i += 2) worst = Math.max(worst, e.p[i] - MW / 2);
  ok(r.length > 10 && worst < k + 0.6, `text mask keeps lines in the on half (${worst.toFixed(2)})`);
  const c = applyModifiers(base, [Object.assign(modDefaults('clip'), { shape: 'text', text })], MW, MH, 1);
  ok(c.clip && c.clip.length === 1, 'text clip gives the glyph rings');
}

// 7. worker
{
  const p = PATTERNS[5], mods = [Object.assign(modDefaults('warp'), { kind: 'lens' })];
  const a = runJob({ pat: p.id, P: defaults(p), seed: 9, W: MW, H: MH, mods });
  const r = run(p, defaults(p), 9, MW, MH), b = applyModifiers(r.items, mods, MW, MH, 9);
  ok(sig(a.items) === sig(b.items), 'runJob equals run + applyModifiers');
}

// 8. palettes
const PAL_MIN_DIST = 0.04;
{
  ok(PALETTES.length >= 80, `at least 80 palettes (${PALETTES.length})`);
  ok(PALETTE_GROUPS.length >= 8, `at least 8 palette groups (${PALETTE_GROUPS.length})`);
  for (const g of PALETTE_GROUPS) ok(PALETTES.filter(p => p.group === g.id).length >= 5, `palette group ${g.id} has 5 or more palettes`);
  const pids = new Set(), hex = /^#[0-9a-f]{6}$/;
  for (const p of PALETTES) {
    ok(!pids.has(p.id), `unique palette id ${p.id}`); pids.add(p.id);
    ok(PALETTE_GROUPS.some(g => g.id === p.group), `${p.id} group ${p.group} is known`);
    ok(hex.test(p.bg) && p.ink.length >= 1 && p.ink.length <= 5 && p.ink.every(c => hex.test(c)), `${p.id}: lower-case hex paper and 1 to 5 inks`);
    const c = contrast(p.ink[0], p.bg);
    ok(c >= 3, `${p.id}: first ink contrast ${c.toFixed(2)} is 3 or more`);
  }
  let lo = [9, '', ''];
  for (let i = 0; i < PALETTES.length; i++) for (let j = i + 1; j < PALETTES.length; j++) {
    const d = paletteDistance(PALETTES[i], PALETTES[j]);
    if (d < lo[0]) lo = [d, PALETTES[i].id, PALETTES[j].id];
    if (d < PAL_MIN_DIST) ok(false, `palettes ${PALETTES[i].id} and ${PALETTES[j].id} are near copies (OKLab ${d.toFixed(3)})`);
  }
  ok(lo[0] >= PAL_MIN_DIST, `nearest palette pair ${lo[1]} / ${lo[2]} is ${lo[0].toFixed(3)} apart`);
  console.log(`palettes: ${PALETTES.length} in ${PALETTE_GROUPS.length} groups, nearest pair ${lo[1]} / ${lo[2]} at ${lo[0].toFixed(3)}`);
  // The colour maths: known values and round trips.
  ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9 && Math.abs(contrast('#777777', '#777777') - 1) < 1e-9, 'contrast of black on white is 21, of a colour on itself 1');
  const w = hexToOklab('#ffffff');
  ok(Math.abs(w[0] - 1) < 1e-3 && Math.abs(w[1]) < 1e-3 && Math.abs(w[2]) < 1e-3, 'white is OKLab (1, 0, 0)');
  let worst = 0;
  for (const p of PALETTES) for (const c of [p.bg, ...p.ink]) {
    const back = oklabToHex(hexToOklab(c)), [L, C, h] = hexToOklch(c), back2 = oklchToHex(L, C, h);
    worst = Math.max(worst, ...[1, 3, 5].map(i => Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(c.slice(i, i + 2), 16))), ...[1, 3, 5].map(i => Math.abs(parseInt(back2.slice(i, i + 2), 16) - parseInt(c.slice(i, i + 2), 16))));
  }
  ok(worst <= 1, `hex -> OKLab -> hex and OKLCH round trips are within 1 step (${worst})`);
}

// 9. palette tools
{
  const seeds = ['#d9622b', '#2d6bd8', '#3fa34d', '#9b5de5', '#f2c14e', '#111111', '#e8e8e8', '#ff3fa4'];
  const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  let worstHue = 0, n9 = 0;
  for (const kind in HARMONY_KINDS) for (const sd of seeds) for (const dark of [false, true]) for (const nInk of [2, 3, 4, 5]) {
    const a = harmony(sd, kind, { n: nInk, dark, rnd: makeRng(5, sd + kind).next }), b = harmony(sd, kind, { n: nInk, dark, rnd: makeRng(5, sd + kind).next });
    n9++;
    ok(JSON.stringify(a) === JSON.stringify(b), `harmony ${kind} ${sd}: same random source, same palette`);
    ok(a.ink.length === nInk && [a.bg, ...a.ink].every(c => /^#[0-9a-f]{6}$/.test(c)), `harmony ${kind} ${sd} n ${nInk}: ${nInk} hex inks`);
    ok(contrast(a.ink[0], a.bg) >= 3, `harmony ${kind} ${sd} dark ${dark}: first ink contrast ${contrast(a.ink[0], a.bg).toFixed(2)}`);
    ok(dark ? hexToOklab(a.bg)[0] < 0.3 : hexToOklab(a.bg)[0] > 0.85, `harmony ${kind} ${sd}: paper is ${dark ? 'dark' : 'light'}`);
    // Each ink with a clear chroma sits at its target hue (gamut fit keeps hue).
    a.ink.forEach((c, i) => { const [, C, h] = hexToOklch(c); if (C > 0.04) worstHue = Math.max(worstHue, hueGap(h, a.hues[i])); });
    const K = HARMONY_KINDS[kind].hues, h0 = a.hues[0];
    ok(a.hues.every((h, i) => hueGap(h - h0, K[i % K.length] - K[0]) < 1e-6), `harmony ${kind}: target hues at the offsets ${K.join(', ')}`);
  }
  ok(worstHue < 12, `harmony inks within 12 degrees of their target hue (worst ${worstHue.toFixed(1)}, ${n9} palettes)`);
  const prev = PALETTES.find(p => p.id === 'sun'), next = harmony('#2d6bd8', 'triadic', { n: 5, rnd: makeRng(1).next });
  const L = withLocks(next, prev, ['bg', 2]);
  ok(L.bg === prev.bg && L.ink[2] === prev.ink[2] && L.ink[1] === next.ink[1], 'locks keep the paper and ink 3, and take the rest from the new palette');
  for (const p of PALETTES.filter(q => q.ink.length >= 3).slice(0, 20)) {
    const sh = shuffleInks(p, makeRng(3, p.id).next, [1]);
    ok(sh.ink.slice().sort().join() === p.ink.slice().sort().join() && sh.ink[1] === p.ink[1] && sh.bg === p.bg, `${p.id}: shuffle keeps the ink set, the locked ink and the paper`);
    ok(sh.ink.join() !== p.ink.join(), `${p.id}: shuffle changes the order`);
  }
  const inv = invertPalette(PALETTES[0]);
  ok(inv.bg === PALETTES[0].ink[0] && inv.ink[0] === PALETTES[0].bg && contrast(inv.ink[0], inv.bg) === contrast(PALETTES[0].ink[0], PALETTES[0].bg), 'invert swaps the paper and the first ink, contrast unchanged');
}

// 10. new generators
const NEW_FAMS = ['tiling', 'textile', 'geometric', 'opart', 'botanical', 'paths', 'mesh'];
const NEW_IDS = ['type-rhythm', 'greeked-columns', 'topo-lines'];
const NEW_NODES = 20000, LIGHT_MS = 150, MAX_MS = 1500;
{
  const NEW = PATTERNS.filter(p => NEW_FAMS.includes(p.family) || NEW_IDS.includes(p.id));
  ok(NEW.length >= 27, `at least 27 new generators (${NEW.length})`);
  for (const f of NEW_FAMS) if (FAMILIES.some(q => q.id === f)) ok(PATTERNS.filter(p => p.family === f).length >= 4, `new family ${f} has 4 or more patterns`);
  const rows = [];
  for (const p of NEW) {
    const S = stats[p.id];
    ok(!S.same78, `${p.id}: seeds 7 and 8 give different results`);
    ok(S.out <= 0.01, `${p.id}: every point inside the board (worst ${S.out.toFixed(3)} units out)`);
    ok(!S.capped && S.maxN <= NEW_NODES, `${p.id}: not capped, at most ${NEW_NODES} elements (${S.maxN})`);
    ok(p.heavy || S.defMs <= LIGHT_MS, `${p.id}: ${S.defMs.toFixed(0)} ms at defaults (light cap ${LIGHT_MS})`);
    ok(S.maxMs <= MAX_MS, `${p.id}: ${S.maxMs.toFixed(0)} ms at the max params (cap ${MAX_MS})`);
    rows.push(`${p.id.padEnd(20)} ${p.family.padEnd(10)} ${S.defMs.toFixed(0).padStart(5)} ${S.maxMs.toFixed(0).padStart(6)} ${String(S.defN).padStart(7)} ${String(S.maxN).padStart(7)}`);
  }
  console.log(`new generators: ${NEW.length}\n${'id'.padEnd(20)} ${'family'.padEnd(10)} def ms max ms def els max els\n${rows.join('\n')}`);
}

timing.sort((a, b) => b[1] - a[1]);
console.log('slowest runs (ms):', timing.slice(0, 6).map(([id, ms, h]) => `${id} ${ms.toFixed(0)}${h ? ' (heavy)' : ''}`).join(', '));
const slowLight = timing.filter(([id, ms, h]) => !h && !/ max /.test(id) && ms > 150);
ok(!slowLight.length, `patterns over 150 ms at defaults are marked heavy ${slowLight.map(t => t[0]).join(', ')}`);
console.log(`${n - fail} of ${n} checks pass${fail ? `, ${fail} fail` : ''}`);
process.exit(fail ? 1 : 0);
