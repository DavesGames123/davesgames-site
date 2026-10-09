// ============================================================================
//  PERIODIC TABLE  ·  tests.mjs — node stella-nova/pages/periodic-table/tests.mjs
// ----------------------------------------------------------------------------
//  No DOM, no browser. Sections:
//    data       118 records in Z order, sane ranges, configurations sum to Z
//    madelung   the exceptions to the Aufbau order are the textbook ones
//    shells     shells from the configuration equal the data shells
//    views      every view places every element once, with no overlap,
//               and a morph between any two views stays finite
//    atom       Bohr shells and the cloud plan follow the configuration
//    card       the inspect card text of every element (card.js)
//    saver      the shot plan (saver-plan.js): kinds, durations, no repeats
//    page       index.html head order, the [hidden] rule, main.js links
// ============================================================================
import { readFileSync } from 'node:fs';
import * as C from './chem.js';
import * as L from './layouts.js';
import * as A from './atom.js';

const here = new URL('.', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const { ELEMENTS } = C, N = ELEMENTS.length;

// ── data ────────────────────────────────────────────────────────────────────
ok(N === 118 && ELEMENTS.every((e, i) => e.z === i + 1), 'data: 118 elements in Z order');
{
  const bad = [];
  for (const e of ELEMENTS) {
    const sum = C.expand(e.cfg).reduce((a, s) => a + s[2], 0);
    if (sum !== e.z) bad.push(`${e.sym} ${sum}`);
  }
  ok(!bad.length, 'data: every configuration holds Z electrons', bad.join(' '));
}
{
  const bad = ELEMENTS.filter(e => !(e.mass > 0.9 && e.mass < 300)).map(e => e.sym);
  const en = ELEMENTS.filter(e => e.en != null && !(e.en >= 0.7 && e.en <= 4.0)).map(e => e.sym);
  const ie = ELEMENTS.filter(e => e.ie[0] != null && !(e.ie[0] > 3.5 && e.ie[0] < 25)).map(e => e.sym);
  ok(!bad.length && !en.length && !ie.length, 'data: masses, electronegativities and first ionization energies in range', [...bad, ...en, ...ie].join(' '));
}
{
  const he = C.BY_SYM.he, f = C.BY_SYM.f, cs = C.BY_SYM.cs, fe = C.BY_SYM.fe;
  ok(he.ie[0] > 24 && f.en === 3.98 && cs.ie[0] < 4 && Math.abs(fe.mass - 55.845) < 1e-3, 'data: spot values (He IE, F χ, Cs IE, Fe mass)');
}
ok(ELEMENTS.every(e => C.CAT[e.cat] && C.BLOCK[e.block] && e.period >= 1 && e.period <= 7), 'data: every element has a category, a block and a period');
ok(ELEMENTS.every(e => e.desc && e.desc.length > 60 && e.uses && e.origin), 'data: every element has our own description, uses and name origin');

// ── madelung ────────────────────────────────────────────────────────────────
{
  // The ground states that differ from the Madelung order (NIST ground
  // levels; Lr has 7p1 in place of 6d1).
  const TEXTBOOK = ['Cr', 'Cu', 'Nb', 'Mo', 'Ru', 'Rh', 'Pd', 'Ag', 'La', 'Ce', 'Gd', 'Pt', 'Au', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Cm', 'Lr'];
  const got = C.EXCEPTIONS;
  const missing = TEXTBOOK.filter(s => !got.includes(s)), extra = got.filter(s => !TEXTBOOK.includes(s));
  ok(!missing.length && !extra.length, `madelung: the ${got.length} exceptions are the textbook ones`, `missing ${missing.join(',') || '-'} extra ${extra.join(',') || '-'}`);
}

// ── shells ──────────────────────────────────────────────────────────────────
{
  const bad = ELEMENTS.filter(e => C.shellsOf(C.expand(e.cfg)).join() !== e.shells.join()).map(e => e.sym);
  ok(!bad.length, 'shells: the shells from the configuration equal the data shells', bad.join(' '));
}

// ── views ───────────────────────────────────────────────────────────────────
const OPTS = { tower: [{ prop: 'density' }, { prop: 'ie1' }], heat: [{ prop: 'en' }, { prop: 'mp' }], timeline: [{ year: 1800 }, { year: 2030 }], abundance: [{ source: 'crust' }, { source: 'universe' }], scatter: [{ x: 'radius', y: 'ie1' }, { x: 'mass', y: 'density' }] };
for (const v of L.VIEWS) {
  for (const opts of OPTS[v.id] || [{}]) {
    const Lv = L.buildLayout(v.id, opts);
    const items = Lv.items;
    const finite = items.length === N && items.every(it => [it.x, it.y, it.s, it.a].every(Number.isFinite) && it.s > 0);
    let overlap = 0;
    const shown = items.map((it, i) => [it, i]).filter(([it]) => it.a > 0.01);
    if (!Lv.disc) {
      for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) {
        const [p] = shown[a], [q] = shown[b];
        const gap = (p.s + q.s) / 2 * 0.98;
        if (Math.abs(p.x - q.x) < gap && Math.abs(p.y - q.y) < gap) overlap++;
      }
    } else {
      for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) {
        const [p] = shown[a], [q] = shown[b];
        if (Math.hypot(p.x - q.x, p.y - q.y) < (p.s + q.s) / 2 * 0.98) overlap++;
      }
    }
    ok(finite && overlap === 0, `views: ${v.id} ${JSON.stringify(opts)} places 118 elements, no overlap`, `${shown.length} shown, ${overlap} overlaps`);
  }
}
{
  let bad = 0;
  for (const a of L.VIEWS) for (const b of L.VIEWS) {
    const LA = L.buildLayout(a.id), LB = L.buildLayout(b.id), d = L.delays(LB);
    for (let i = 0; i < N; i += 7) for (const t of [0, 0.3, 0.7, 1]) {
      const m = L.morph(LA.items[i], LB.items[i], t, d[i]);
      if (![m.x, m.y, m.s, m.a].every(Number.isFinite)) bad++;
    }
  }
  ok(bad === 0, `views: morphs between all ${L.VIEWS.length * L.VIEWS.length} view pairs stay finite`);
}
{
  const T = L.buildLayout('timeline', { year: 1700 }), shown = T.items.filter(it => it.a > 0.5).length;
  const T2 = L.buildLayout('timeline', { year: 2030 }), all = T2.items.filter(it => it.a > 0.5).length;
  ok(shown > 5 && shown < 25 && all === 118, 'views: the discovery timeline hides undiscovered elements', `1700: ${shown}, 2030: ${all}`);
}

// ── atom ────────────────────────────────────────────────────────────────────
{
  const bad = [];
  for (const e of ELEMENTS) {
    const sub = C.expand(e.cfg);
    let total = 0;
    for (const [, l, k] of sub) { const plan = A.orbitalPlan(l, k); total += plan.reduce((a, x) => a + x[1], 0); if (plan.some(x => x[1] > 2)) bad.push(e.sym + ' >2'); }
    if (total !== e.z) bad.push(`${e.sym} plan ${total}`);
  }
  ok(!bad.length, 'atom: the orbital plan of every element holds Z electrons, at most 2 per orbital', bad.slice(0, 5).join(' '));
}
{
  const bad = [];
  for (const s of ['h', 'c', 'fe', 'au', 'u', 'og']) {
    const e = C.BY_SYM[s], nuc = A.nucleus(e), iso = C.mainIsotope(e);
    const p = nuc.pts.filter(x => x[3]).length;
    if (p !== e.z || nuc.A !== iso || nuc.pts.length !== iso) bad.push(s + ` p${p} A${nuc.A}`);
    const cp = A.cloudPoints(e, 900);
    if (!cp.pts.length || !cp.pts.every(q => q.slice(0, 3).every(Number.isFinite))) bad.push(s + ' cloud');
    if (!(iso >= e.z)) bad.push(s + ' iso');
  }
  ok(!bad.length, 'atom: nuclei and clouds of H, C, Fe, Au, U, Og are finite and sane', bad.join(' '));
}

// ── card, saver, page (later modules) ───────────────────────────────────────
let card = null, plan = null;
try { card = await import('./card.js'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
try { plan = await import('./saver-plan.js'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
if (card) {
  const bad = [];
  for (const e of ELEMENTS) {
    const h = card.cardHTML(e, { full: true });
    for (const need of [e.name, e.sym, String(e.z), 'Configuration', 'Shells']) if (!h.includes(need)) { bad.push(`${e.sym}:${need}`); break; }
    if (/undefined|NaN|null/.test(h.replace(/data-[a-z-]+="[^"]*"/g, ''))) bad.push(e.sym + ':junk');
  }
  ok(!bad.length, 'card: the inspect card of every element has its name, numbers and configuration, no undefined/NaN', bad.slice(0, 6).join(' '));
  const cmp = card.compareHTML(C.BY_SYM.na, C.BY_SYM.cl);
  ok(cmp.includes('Sodium') && cmp.includes('Chlorine') && cmp.includes('Electronegativity'), 'card: the compare table names both elements');
}
if (plan) {
  const kinds = new Set(); let repeats = 0, badDur = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const P = plan.planShots(seed, 40);
    P.forEach((s, i) => { kinds.add(s.kind); if (i && s.kind === P[i - 1].kind) repeats++; if (!(s.dur >= 6 && s.dur <= 12)) badDur++; });
  }
  ok(repeats === 0 && badDur === 0 && kinds.size >= 6, 'saver: 40 seeded plans, no back-to-back repeats, cuts of 6-12 s', `${kinds.size} kinds: ${[...kinds].join(' ')}`);
  const a = JSON.stringify(plan.planShots(5, 20)), b = JSON.stringify(plan.planShots(5, 20)), c = JSON.stringify(plan.planShots(6, 20));
  ok(a === b && a !== c, 'saver: the plan is fixed by its seed and differs between seeds');
}
{
  let html = '';
  try { html = readFileSync(here + 'index.html', 'utf8'); } catch (e) { /* not yet */ }
  if (html) {
    const css = readFileSync(here + 'style.css', 'utf8');
    const heads = [...html.matchAll(/<script src="\.\.\/\.\.\/lib\/([a-z-]+)\.js"><\/script>/g)].map(m => m[1]);
    ok(heads.slice(0, 3).join(',') === 'gpu-guard,wishlist,stats-beacon' && html.indexOf('gpu-guard') < html.indexOf('<meta'), 'page: head scripts gpu-guard, wishlist, stats-beacon first');
    ok(/\[hidden\]\{display:none!important\}/.test(css.replace(/\s/g, '')), 'page: style.css has the [hidden] rule');
    const pc = css.slice(css.indexOf('(pointer:coarse)'));
    ok(css.includes('(pointer:coarse)') && /min-height:\s*44px/.test(pc), 'page: 44 px targets on a coarse pointer');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
