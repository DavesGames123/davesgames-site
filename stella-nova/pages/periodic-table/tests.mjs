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

// ── tower faces ─────────────────────────────────────────────────────────────
// A tower box draws the sides that face the camera, never its far walls.
{
  const { Table, frontSides } = await import('./render.js');
  const T = new Table();
  T.setView('tower', { prop: 'en' }, 0, true);
  T.a3 = 1; T.cam = { k: 40, cx: 9, cy: 5, ox: 500, oy: 300 };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const bad = [];
  for (const [yaw, pitch] of [[0, 0.95], [-0.5, 0.95], [0.8, 0.6], [2.5, 1.2], [-2, 0.3]]) {
    T.rot = { yaw, pitch };
    const c = corners.map(([u, v]) => [9 + u * 0.46, 5 + v * 0.46]);
    const drawn = frontSides(c.map(([x, y]) => T.proj3(x, y, 0)), c.map(([x, y]) => T.proj3(x, y, 2))).map(f => f.f);
    const ctr = T.proj3(9, 5, 1)[2];
    const near = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([u, v], i) => T.proj3(9 + u * 0.46, 5 + v * 0.46, 1)[2] > ctr + 1e-9 ? i : -1).filter(i => i >= 0);
    if (!near.every(i => drawn.includes(i)) || drawn.some(i => !near.includes(i) && T.proj3(9 + [0, 1, 0, -1][i] * 0.46, 5 + [-1, 0, 1, 0][i] * 0.46, 1)[2] < ctr - 1e-6)) bad.push(`yaw ${yaw} pitch ${pitch}: drawn ${drawn} near ${near}`);
  }
  ok(!bad.length, 'tower: each box draws the sides that face the camera, not its far walls', bad.join('; '));
}

// ── view tiles and the phone fit ────────────────────────────────────────────
{
  const { miniPoints, squircle } = await import('./viewtiles.js');
  const { fitScale, MIN_TILE_PX } = await import('./render.js');
  const bad = [];
  for (const v of L.VIEWS) {
    const M = miniPoints(v.id, 56);
    const out = M.pts.filter(p => p.a > 0 && (p.x - p.s / 2 < 0 || p.x + p.s / 2 > 56 || p.y - p.s / 2 < -1 || (p.by ?? p.y) + p.s / 2 > 57));
    if (M.pts.length !== 118 || out.length) bad.push(`${v.id}: ${M.pts.length} points, ${out.length} outside`);
  }
  ok(!bad.length, 'tiles: every view miniature holds 118 elements inside its 56 px squircle', bad.join('; '));
  const path = []; const g = { beginPath() {}, closePath() {}, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); } };
  squircle(g, 0, 0, 100, 100);
  const corner = Math.min(...path.map(([x, y]) => Math.hypot(x - 100, y - 100)));
  ok(path.every(([x, y]) => x >= -1e-9 && x <= 100 + 1e-9 && y >= -1e-9 && y <= 100 + 1e-9) && corner > 8 && corner < 25, 'tiles: the squircle stays in its box and rounds its corners', `corner gap ${corner.toFixed(1)}`);

  const std = L.buildLayout('standard'), b = std.bounds, w = b.x1 - b.x0, h = b.y1 - b.y0;
  const phone = { w: 362, h: 560 }, desk = { w: 1110, h: 700 };
  const fp = fitScale(phone, w, h, MIN_TILE_PX / 0.92), fd = fitScale(desk, w, h, 0);
  ok(fp.anchorLeft && fp.k * 0.92 >= MIN_TILE_PX - 1e-9 && fp.k * h <= phone.h + 1e-9, 'fit: phone portrait standard keeps 24 px tiles and starts at the left', `tile ${(fp.k * 0.92).toFixed(1)} px`);
  ok(!fd.anchorLeft && Math.abs(fd.k - Math.min(desk.w / w, desk.h / h)) < 1e-9, 'fit: desktop fits the whole table as before');
  const short = fitScale({ w: 362, h: 150 }, w, h, MIN_TILE_PX / 0.92);
  ok(short.k * h <= 150 + 1e-9, 'fit: the minimum tile never makes the table taller than the frame');
}

// ── saver shots (saver-plan.js, saver-fx.js) ────────────────────────────────
// The seeded shot plan, the plate of every shot, the camera aim against
// render.js fitCamera, the close-up boxes in the clear band, the data
// helpers, and the light layer run on a stub canvas context.
{
  const SP = await import('./saver-plan.js');
  const FXM = await import('./saver-fx.js');
  const { Table } = await import('./render.js');
  // variety: every kind in each plan, no kind twice in a row, 6-12 s cuts, also when calm
  {
    const bad = []; const all = new Set();
    for (let seed = 1; seed <= 60; seed++) for (const calm of [0, 1]) {
      const P = SP.planShots(seed, 27, { calm });
      const kinds = new Set(P.map(s => s.kind));
      P.forEach((s, i) => { all.add(s.kind); if (i && s.kind === P[i - 1].kind) bad.push(`${seed}:${i} repeat`); if (!(s.dur >= 6 && s.dur <= 12)) bad.push(`${seed}:${i} dur ${s.dur}`); });
      if (kinds.size !== SP.KINDS.length) bad.push(`${seed} has ${kinds.size} kinds`);
      for (const s of P) if (s.kind === 'flight' && new Set(s.views).size !== 3) bad.push(`${seed} flight views ${s.views}`);
    }
    ok(!bad.length && all.size === SP.KINDS.length, `saver shots: 120 plans hold all ${SP.KINDS.length} kinds, no repeats, cuts of 6-12 s`, bad.slice(0, 4).join(' '));
    const first = new Set(); for (let seed = 1; seed <= 40; seed++) first.add(SP.planShots(seed, 3).map(s => s.kind).join(','));
    ok(first.size >= 25, 'saver shots: the opening of the run differs between seeds', `${first.size} of 40 openings differ`);
    const slow = SP.planShots(4, 30, { calm: 1 }).reduce((a, s) => a + s.dur, 0), fast = SP.planShots(4, 30).reduce((a, s) => a + s.dur, 0);
    ok(slow > fast, 'saver shots: calm makes the shots longer', `${fast.toFixed(0)} s -> ${slow.toFixed(0)} s for 30 shots`);
  }
  // plates: every shot and sub-state gives a title, plain values, at most one TeX line, no code
  {
    const bad = [];
    for (let seed = 1; seed <= 30; seed++) for (const sh of SP.planShots(seed, 18)) {
      const ks = sh.kind === 'timeline' ? [0, { year: 1898, newest: SP.known(1898).newest }, { year: 2030, newest: SP.known(2030).newest }] : [0, 1, 2, 3, 7];
      for (const k of ks) {
        const p = SP.plateFor(sh, k), j = JSON.stringify(p);
        if (!p.title || typeof p.sub !== 'string' || /undefined|NaN|null|\[object/.test(j) || p.code || (p.tex || []).length > 1 || !(p.params || []).every(q => typeof q.value === 'string' && q.name)) bad.push(`${sh.kind}/${typeof k === 'object' ? k.year : k}: ${j.slice(0, 80)}`);
      }
    }
    ok(!bad.length, 'saver shots: every plate has a title, plain values, at most one TeX line and no code', bad.slice(0, 3).join(' | '));
  }
  // camera: aimUser puts the chosen tile at the centre of the frame (render.js fitCamera)
  {
    const bad = [];
    const frames = [{ x: 58, y: 180, w: 1325, h: 470 }, { x: 16, y: 210, w: 358, h: 420 }];
    for (const v of ['standard', 'long', 'spiral', 'radial', 'janet', 'blocks', 'scatter']) for (const f of frames) for (const legend of [false, true]) {
      const T = new Table(); T.setView(v, v === 'scatter' ? { x: 'radius', y: 'ie1' } : {}, 0, true);
      const S = { frame: f, color: legend ? 'prop' : 'cat', phaseOn: false };
      for (const z of [8, 26, 79]) {
        const it = T.B.items[z - 1];
        const a = SP.aimUser(T, S, it.x, it.y, 2.5);
        T.user.zoom = a.zoom; T.user.px = a.px; T.user.py = a.py;
        T.camSnap = true; T.fitCamera(S, 1440, 900, 0.016);
        const [sx, sy] = T.toScreen(it.x, it.y);
        if (Math.hypot(sx - (f.x + f.w / 2), sy - (f.y + f.h / 2)) > 0.5) bad.push(`${v} Z${z} ${legend ? 'legend' : ''} off by ${Math.hypot(sx - (f.x + f.w / 2), sy - (f.y + f.h / 2)).toFixed(1)} px`);
      }
    }
    ok(!bad.length, 'saver shots: the camera aim puts the subject tile at the centre of the clear band', bad.slice(0, 3).join('; '));
    let x = 0, v = 0, over = 0; for (let k = 0; k < 240; k++) { [x, v] = SP.spring(x, v, 10, 3, 1 / 60); over = Math.max(over, x - 10); }
    ok(Math.abs(x - 10) < 0.01 && over <= 1e-9, 'saver shots: the camera spring settles with no overshoot past the target', `x ${x.toFixed(4)} after 4 s`);
  }
  // the close-up boxes and the counter strip stay in the band and apart
  {
    const bad = [];
    const inside = (r, f) => r.x >= f.x - 0.5 && r.y >= f.y - 0.5 && r.x + r.w <= f.x + f.w + 0.5 && r.y + r.h <= f.y + f.h + 0.5;
    const apart = (a, b) => a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
    for (const f of [{ x: 58, y: 180, w: 1325, h: 470 }, { x: 16, y: 210, w: 358, h: 420 }, { x: 40, y: 120, w: 900, h: 700 }, { x: 77, y: 260, w: 1766, h: 520 }]) {
      const L = SP.atomLayout(f);
      for (const [n, r] of Object.entries(L)) if (!inside(r, f)) bad.push(`${f.w}x${f.h} ${n} outside`);
      if (!apart(L.atom, L.ie) || !apart(L.atom, L.iso) || !apart(L.ie, L.iso)) bad.push(`${f.w}x${f.h} overlap`);
      if (L.atom.w < Math.min(f.w, f.h) * 0.5) bad.push(`${f.w}x${f.h} atom ${L.atom.w.toFixed(0)} px`);
      const t = SP.frameOf(f, 'timeline');
      if (!inside(t, f) || !inside(t.strip, f) || !apart(t, t.strip)) bad.push(`${f.w}x${f.h} timeline strip`);
    }
    ok(!bad.length, 'saver shots: the atom, its panels and the year strip sit in the clear band, apart', bad.join('; '));
  }
  // data helpers
  {
    const na = SP.ieSteps(C.BY_SYM.na), mg = SP.ieSteps(C.BY_SYM.mg);
    ok(na.length >= 2 && na[0].shell === 'M' && na[1].shell === 'L' && na[1].jump && !na[0].jump && mg[2].jump && !mg[1].jump,
      'saver shots: the ionization staircase jumps where an inner shell opens (Na at 2, Mg at 3)', na.slice(0, 3).map(s => s.shell + Math.round(s.eV)).join(' '));
    const iso = SP.isoBars(C.BY_SYM.cl), sum = SP.isoBars(C.BY_SYM.sn, 20).reduce((a, b) => a + b.pct, 0);
    ok(iso[0].A === 35 && iso[1].A === 37 && sum > 99 && sum < 101 && SP.isoBars(C.BY_SYM.tc).length === 0, 'saver shots: natural isotopes, largest first (Cl 35, 37; Sn sums to 100 %; Tc none)');
    const k0 = SP.known(1650), k1 = SP.known(2030), k2 = SP.known(1898);
    ok(k1.count === 118 && k0.count >= 10 && k0.count < 20 && k2.newest.some(e => e.sym === 'Po' || e.sym === 'Ra' || e.sym === 'Ne'), 'saver shots: the discovery count runs from the antiquity elements to 118', `${k0.count} known in 1650, ${k2.count} in 1898 (${k2.newest.map(e => e.sym).join(' ')})`);
  }
  // the light layer runs on a stub context: finite, and cheap in JS
  {
    const grad = { addColorStop() {} };
    let calls = 0, nonfinite = 0;
    const g = new Proxy({}, { get: (t, k) => k === 'createRadialGradient' || k === 'createLinearGradient' ? () => grad : k === 'measureText' ? s => ({ width: s.length * 7 }) : (...a) => { calls++; if (a.some(x => typeof x === 'number' && !isFinite(x))) nonfinite++; }, set: () => true });
    const n = N, hist = new Float32Array(5 * n * 2).map((_, i) => (i * 37) % 1400), cols = ELEMENTS.map(e => C.CAT[e.cat].color), sides = new Float32Array(n).fill(40);
    const f = { x: 58, y: 180, w: 1325, h: 470 };
    const t0 = performance.now();
    for (let k = 0; k < 300; k++) {
      FXM.drawSky(g, 1440, 900, { x: k, y: -k, z: 1.4 }, k / 60);
      FXM.drawStreaks(g, hist, 5, k % 5, n, cols, sides, 1);
      for (let i = 0; i < n; i++) FXM.drawHalo(g, 100 + i, 300, 40, cols[i], 0.4);
      FXM.drawBurst(g, 400, 300, 50, '#ff6fcf', (k % 60) / 60);
      FXM.drawScan(g, f, 300 + k, '#cfe0ff', 1);
      FXM.drawCounter(g, { x: 1100, y: 180, w: 290, h: 470 }, '1898', '84 of 118 known', 1);
      FXM.drawIEPanel(g, { x: 900, y: 200, w: 400, h: 200 }, SP.ieSteps(C.BY_SYM.fe), '#4aa8ff', 1);
      FXM.drawIsoPanel(g, { x: 900, y: 420, w: 400, h: 160 }, SP.isoBars(C.BY_SYM.fe), '#4aa8ff', 1);
    }
    const ms = (performance.now() - t0) / 300;
    ok(nonfinite === 0 && calls > 1000 && ms < 4, 'saver shots: the light layer draws finite shapes in under 4 ms of JS per frame (stub context)', `${ms.toFixed(2)} ms per frame, ${Math.round(calls / 300)} calls`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
