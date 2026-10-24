// ============================================================================
//  BLACK OCTOBER  ·  tests.mjs — node tests, no browser
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/black-october/tests.mjs
//  Covers grow.js on a synthetic event set (fake ids, fake times, example.org
//  sources): the data rules, radius = time, the sectors, the node spacing,
//  the edges (start on the parent, end on the child, radius does not
//  decrease), the seed and the before-window band. The editorial rules of
//  the real events in data/ are in tools/check-events.mjs.
//  Then, on the real ledger: the saver shot plan, subjects and framing at
//  16:9 and 9:16 (saver.js), the page logic (model.js, and render.js on a
//  recording 2D context), and a link check of main.js: it must import up
//  to its first browser global, every named import must exist, and every
//  id it binds must be in index.html. No browser runs.
//
//  grep -n targets: "section(" opens each group.
// ============================================================================
import { layout, validate, timeScale, DEFAULTS, KINDS } from './grow.js';
import { rng } from '../../lib/dla-engine.js';

let pass = 0, fail = 0, cur = '';
function section(s) { cur = s; console.log('\n# ' + s); }
function ok(c, msg) { if (c) pass++; else { fail++; console.log(`  FAIL [${cur}] ${msg}`); } }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// A fake event set: `threads` trees, `n` events in all, over `days` days.
// Each child picks an earlier event of its thread as parent.
function fixture(n = 300, threads = 7, days = 4, seed = 3) {
  const rand = rng(seed), T0 = Date.UTC(2000, 0, 1), out = [];
  const src = [{ url: 'https://example.org/fixture', publisher: 'fixture', primary: false }];
  const per = Array.from({ length: threads }, () => []);
  for (let k = 0; k < threads; k++) {
    const t = T0 + k * 3600e3 * 5;
    const e = { id: `th${k}-0`, thread: `th${k}`, parent: null, t: new Date(t).toISOString(), tPrecision: 'hour',
      kind: 'disclosure', title: `fixture root ${k}`, summary: '', sources: src, confidence: 'reported' };
    out.push(e); per[k].push(e);
  }
  for (let i = threads; i < n; i++) {
    const k = Math.floor(rand() * rand() * threads), list = per[k];
    const p = list[Math.floor(rand() * list.length)];
    const t = Math.min(Date.parse(p.t) + rand() * rand() * days * 86400e3, T0 + days * 86400e3);
    const e = { id: `th${k}-${list.length}`, thread: `th${k}`, parent: p.id, t: new Date(t).toISOString(),
      tPrecision: 'minute', kind: KINDS[i % KINDS.length], title: `fixture ${i}`, summary: '', sources: src,
      confidence: 'confirmed' };
    out.push(e); list.push(e);
  }
  return out;
}

section('validate');
{
  const ev = fixture(60);
  ok(validate(ev).length === 0, 'the fixture is valid: ' + validate(ev).slice(0, 2).join('; '));
  const bad = structuredClone(ev);
  bad[10].parent = 'nope'; bad[11].t = '1999-01-01T00:00:00Z'; bad[12].sources = [];
  bad[13].kind = 'rumour'; bad[14].id = bad[15].id; bad.push({ ...bad[0], id: 'second-root' });
  bad[16].sources = [{ url: 'javascript:alert(1)' }];
  const p = validate(bad).join('\n');
  ok(/parent nope does not exist/.test(p), 'missing parent');
  ok(/is before its parent/.test(p), 'child before parent');
  ok(/no sources/.test(p), 'no sources');
  ok(/kind "rumour"/.test(p), 'unknown kind');
  ok(/id is not unique/.test(p), 'duplicate id');
  ok(/second root of thread th0/.test(p), 'two roots in one thread');
  ok(/source url "javascript:alert\(1\)"/.test(p), 'a source url must be http(s)');
  const cross = structuredClone(ev), c = cross.find(e => e.parent && e.thread === 'th1');
  c.parent = 'th0-0';
  ok(/is in thread th0, not th1/.test(validate(cross).join()), 'parent in another thread');
  const loop = structuredClone(ev).slice(0, 7);
  loop.push({ ...loop[0], id: 'a', parent: 'b' }, { ...loop[0], id: 'b', parent: 'a' });
  ok(/loop/.test(validate(loop).join()), 'parent loop');
  const rel = structuredClone(ev); rel[20].related = ['th0-0']; rel[21].related = ['ghost'];
  const rp = validate(rel).join();
  ok(!/th0-0"\] names/.test(rp) && /related \["ghost"\] names an unknown event/.test(rp), 'related ids must exist');
  let threw = false;
  try { layout(bad); } catch (e) { threw = /black-october data/.test(e.message); }
  ok(threw, 'layout throws on bad data');
}

section('radius is time');
{
  const ev = fixture(300), L = layout(ev, { seed: 7 });
  ok(L.nodes.length === 300 && L.edges.length === 300 - 7, `nodes ${L.nodes.length}, edges ${L.edges.length}`);
  ok(L.nodes.every(n => near(n.r, L.radiusOf(Date.parse(n.ev.t)))), 'every node radius = radiusOf(t)');
  ok(L.nodes.every(n => near(Math.hypot(n.x, n.y), n.r, 1e-9)), 'x, y are on the radius');
  const s = [...L.nodes].sort((a, b) => a.t - b.t);
  ok(s.every((n, i) => i === 0 || n.r >= s[i - 1].r - 1e-12), 'a later event is never nearer the centre');
  ok(near(s[0].r, DEFAULTS.inner) && near(s[s.length - 1].r, 1), 'T0 at inner, last event at 1');
  const lin = timeScale(0, 100, { ...DEFAULTS, scale: 'linear' }), sq = timeScale(0, 100, { ...DEFAULTS, scale: 'sqrt' });
  ok(near(lin(50), DEFAULTS.inner + (1 - DEFAULTS.inner) * 0.5), 'linear scale');
  ok(near(sq(25), DEFAULTS.inner + (1 - DEFAULTS.inner) * 0.5), 'sqrt scale');
  ok(L.rings.length >= 3 && L.rings.every(g => /^\d{4}-\d\d-\d\d$/.test(g.label) && g.t % 86400000 === 0), `day rings (${L.rings.length})`);
}

section('sectors and spacing');
{
  const L = layout(fixture(300), { seed: 7 });
  const th = L.threads;
  ok(th.length === 7 && th.every((t, i) => t.a1 > t.a0 && (i === 0 || t.a0 >= th[i - 1].a1)), 'sectors are in order and do not overlap');
  ok(th[th.length - 1].a1 <= -Math.PI / 2 + Math.PI * 2 + 1e-9, 'sectors fit in one turn');
  const thOf = new Map(th.map(t => [t.id, t]));
  ok(L.nodes.every(n => n.a >= thOf.get(n.thread).a0 - 1e-9 && n.a <= thOf.get(n.thread).a1 + 1e-9), 'each node is in its thread sector');
  ok(th.every(t => L.byId.get(t.root).parent === null), 'each thread root is a root');
  let close = 0, minD = Infinity;
  for (let i = 0; i < L.nodes.length; i++) for (let j = i + 1; j < L.nodes.length; j++) {
    const d = Math.hypot(L.nodes[i].x - L.nodes[j].x, L.nodes[i].y - L.nodes[j].y);
    minD = Math.min(minD, d); if (d < DEFAULTS.minGap * 0.999) close++;
  }
  ok(close <= 3, `${close} node pairs nearer than minGap (min ${minD.toFixed(4)})`);
}

section('edges');
{
  const L = layout(fixture(300), { seed: 7 });
  let bad = 0, back = 0, out = 0;
  const thOf = new Map(L.threads.map(t => [t.id, t]));
  for (const e of L.edges) {
    const p = L.byId.get(e.from), c = L.byId.get(e.to), q = e.pts, n = q.length / 2;
    if (!near(q[0], p.x, 1e-6) || !near(q[1], p.y, 1e-6) || !near(q[q.length - 2], c.x, 1e-6) || !near(q[q.length - 1], c.y, 1e-6)) bad++;
    for (let k = 1; k < n; k++) if (Math.hypot(q[k * 2], q[k * 2 + 1]) < Math.hypot(q[k * 2 - 2], q[k * 2 - 1]) - 1e-5) { back++; break; }
    const th = thOf.get(c.thread);
    for (let k = 0; k < n; k++) { const a = Math.atan2(q[k * 2 + 1], q[k * 2]); const w = a < th.a0 - 1e-4 ? a + 2 * Math.PI : a; if (w < th.a0 - 1e-4 || w > th.a1 + 1e-4) { out++; break; } }
  }
  ok(bad === 0, `${bad} edges do not start on the parent and end on the child`);
  ok(back === 0, `${back} edges go back in time (radius decreases)`);
  ok(out === 0, `${out} edges leave their thread sector`);
  ok(L.edges.every(e => L.byId.get(e.to).parent === e.from), 'edge from = node parent');
}

section('seed and cost');
{
  const ev = fixture(400, 8, 4, 11);
  const t = performance.now(), A = layout(ev, { seed: 5 }), ms = performance.now() - t, B = layout(ev, { seed: 5 }), C = layout(ev, { seed: 6 });
  ok(A.nodes.every((n, i) => n.a === B.nodes[i].a) && A.edges.every((e, i) => e.pts.every((v, k) => v === B.edges[i].pts[k])), 'same seed, same layout');
  ok(A.nodes.some((n, i) => n.a !== C.nodes[i].a), 'another seed, another layout');
  ok(ms < 1500, `400 events in ${ms.toFixed(0)} ms`);
  const shuffled = [...ev].reverse(), D = layout(shuffled, { seed: 5 });
  ok(D.nodes.every(n => near(n.r, A.byId.get(n.id).r)), 'input order does not change the radii');
  const one = layout(ev.slice(0, 1));
  ok(one.nodes.length === 1 && one.edges.length === 0 && Number.isFinite(one.nodes[0].x), 'one event');
  ok(layout([]).nodes.length === 0, 'no events');
}

section('before-window band');
{
  // The fixture runs 4 days in January 2000. Five early events go 500 to 39
  // days before it, in their own thread. Without a band they take most of
  // the radius and the 4 days are a thin rim.
  const ev = fixture(300), D0 = Date.UTC(2000, 0, 1), src = ev[0].sources;
  const early = [-500, -300, -200, -40, -39].map((d, i) => ({ id: `early-${i}`, thread: 'early', parent: i ? `early-${i - 1}` : null,
    t: new Date(D0 + d * 86400e3).toISOString(), tPrecision: 'day', kind: 'other', title: `early ${i}`, summary: '', sources: src, confidence: 'reported' }));
  const all = [...ev, ...early], L = layout(all, { seed: 7 });
  const B = L.band;
  ok(B && B.count === 5, `auto window puts the 5 early events in the band (${B && B.count})`);
  ok(B && B.label === 'before January', `band label (${B && B.label})`);
  ok(B && L.tw === D0, 'auto window starts at the first event of the last month');
  ok(L.rings.length > 0 && L.rings.length <= 5 && L.rings.every(g => g.t >= L.tw), `day rings only in the window (${L.rings.length})`);
  const win = L.nodes.filter(n => n.t >= L.tw), pre = L.nodes.filter(n => n.t < L.tw);
  ok(B && win.every(n => n.r >= B.rMain - 1e-12) && near(Math.min(...win.map(n => n.r)), B.rMain) && near(Math.max(...win.map(n => n.r)), 1), 'the window spans rMain to 1');
  ok(B && B.rMain <= 0.25, `the window keeps most of the radius (rMain ${B && B.rMain})`);
  ok(B && pre.every(n => n.r >= B.r0 - 1e-12 && n.r <= B.r1 + 1e-12), 'early events stay in the band');
  const ps = [...pre].sort((a, b) => a.t - b.t);
  ok(ps.every((n, i) => !i || n.r > ps[i - 1].r), 'the band orders the early events by time');
  const s = [...L.nodes].sort((a, b) => a.t - b.t);
  ok(s.every((n, i) => !i || n.r >= s[i - 1].r - 1e-12), 'radius is monotone in time over the whole set');
  let mono = true;
  for (let t = D0 - 520 * 86400e3; t < D0 + 5 * 86400e3; t += 3600e3) if (L.radiusOf(t + 3600e3) < L.radiusOf(t) - 1e-12) mono = false;
  ok(mono, 'radiusOf is monotone from before the first event to after the last');
  ok(L.nodes.every(n => near(n.r, L.radiusOf(n.t))), 'node radius = radiusOf(t) with a band');
  ok(B && B.months.length >= 2 && B.months.every(m => /^\d{4}-\d\d$/.test(m.label) && m.r >= B.r0 && m.r <= B.rMain && m.t < L.tw), `month rings in the band (${B && B.months.length})`);
  ok(B && B.months.every((m, i) => !i || m.r - B.months[i - 1].r >= L.opts.monthGap - 1e-12), 'month rings keep monthGap apart');
  let back = 0;
  for (const e of L.edges) { const q = e.pts; for (let k = 1; k < q.length / 2; k++) if (Math.hypot(q[k * 2], q[k * 2 + 1]) < Math.hypot(q[k * 2 - 2], q[k * 2 - 1]) - 1e-5) { back++; break; } }
  ok(back === 0, `${back} edges go back in time with a band`);
  const off = layout(all, { seed: 7, windowStart: null });
  ok(off.band === null && off.rings.length > 400, `windowStart null keeps one time scale (${off.rings.length} rings)`);
  const fix = layout(all, { seed: 7, windowStart: D0 - 100 * 86400e3 });
  ok(fix.band && fix.band.count === 3, `an explicit windowStart (${fix.band && fix.band.count} early)`);
  ok(layout(ev, { seed: 7 }).band === null, 'no band when no event is before the window');
}

section('saver shots');
{
  const { EVENTS } = await import('./data/events.js');
  const SV = await import('./saver.js');
  const { LAYOUT_OPTS, relatedPairs } = await import('./model.js');
  const L = layout(EVENTS, LAYOUT_OPTS), N = L.nodes.length;
  for (const seed of [1, 7, 42, 12345]) for (const calm of [0, 0.7, 1]) {
    const P = SV.shotPlan(seed, 50, calm);
    ok(P.length === 50 && P.every(s => s.sec >= 5 && s.sec <= 12 && SV.SHOT_KINDS.includes(s.kind)), `plan cuts 5-12 s seed=${seed} calm=${calm}`);
    ok(P.every((s, i) => !i || s.kind !== P[i - 1].kind), `no kind twice in a row seed=${seed} calm=${calm}`);
  }
  const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(s => SV.shotPlan(s, 10).map(x => x.kind).join()));
  ok(orders.size >= 5, `plans vary with the seed (${orders.size} of 8)`);
  ok(SV.shotPlan(9, 12).map(x => x.kind + x.sec).join() === SV.shotPlan(9, 12).map(x => x.kind + x.sec).join(), 'plan is the same for one seed');

  // the subjects are real data in the replay at the cut
  const pairs = new Set(relatedPairs(L).map(p => [...p].sort().join('|')));
  let real = 0, total = 0;
  for (const k of [1, 5, 20, 21, 60, 120, 170, N]) {
    const rand = rng(k);
    const nw = SV.shotTarget(L, k, 'newest', rand);
    total++; if (nw.focus === L.nodes[k - 1].id) real++;
    const th = SV.shotTarget(L, k, 'thread', rand), shown = L.nodes.slice(0, k);
    const cnt = id => shown.filter(n => n.thread === id).length;
    total++; if (th.ids.length === cnt(th.thread) && shown.every(n => cnt(n.thread) <= th.ids.length)) real++;
    const dp = SV.shotTarget(L, k, 'disputed', rand);
    total++; if (dp === null ? !shown.some(n => n.ev.confidence === 'disputed') : (L.byId.get(dp.focus).ev.confidence === 'disputed' && L.nodes.indexOf(L.byId.get(dp.focus)) < k)) real++;
    const lk = SV.shotTarget(L, k, 'link', rand);
    total++; if (lk === null ? true : (pairs.has([...lk.ids].sort().join('|')) && lk.ids.every(id => L.nodes.indexOf(L.byId.get(id)) < k))) real++;
  }
  ok(real === total, `shot subjects are shown events of the right kind (${real}/${total})`);
  ok(SV.shotTarget(L, N, 'link', rng(1)) !== null && SV.shotTarget(L, N, 'disputed', rng(1)) !== null, 'the full record has a link and a disputed shot');
  ok(SV.pickTarget(L, 1, 'link', rng(1)).kind === 'newest', 'a kind with no subject falls back to the newest event');

  // framing: the target circle stays in the clear band at 16:9 and 9:16,
  // with and without a plate, through the whole push-in and drift
  const frames = [
    ['16:9', 1920, 1080, { t: 0, b: 0 }], ['16:9 plate', 1920, 1080, { t: 260, b: 230 }],
    ['9:16', 1080, 1920, { t: 0, b: 0 }], ['9:16 plate', 1080, 1920, { t: 420, b: 470 }],
    ['phone 9:16 plate', 390, 844, { t: 190, b: 200 }],
  ];
  for (const [name, w, h, band] of frames) {
    let out = 0, n = 0, small = 0;
    for (const seed of [1, 7, 42]) {
      const rand = rng(seed), P = SV.shotPlan(seed, 30, 0.7);
      P.forEach((shot, i) => {
        const k = Math.max(1, Math.round((i + 1) / P.length * N));
        const T = SV.pickTarget(L, k, shot.kind, rand), drift = rand() * Math.PI * 2;
        for (const u of [0, 0.25, 0.5, 0.75, 1]) {
          const v = SV.shotView(T, w, h, band, u, drift);
          const x = (T.cx - v.cx) * v.s + v.ox, y = (T.cy - v.cy) * v.s + v.oy, r = T.R * v.s;
          n++;
          if (x - r < -0.5 || x + r > w + 0.5 || y - r < band.t - 0.5 || y + r > h - band.b + 0.5) out++;
          if (r < Math.min(w, h - band.t - band.b) * 0.35) small++;
        }
      });
    }
    ok(out === 0, `${name}: ${out} of ${n} frames put the subject outside the clear band`);
    ok(small === 0, `${name}: ${small} frames make the subject small`);
  }

  // the replay runs from the first event to the last
  const steps = SV.growthSteps(L);
  const g0 = SV.growthAt(steps, 0), g1 = SV.growthAt(steps, 1);
  ok(g0.k === 1 && g0.frac === 0 && g1.k === N && g1.frac === 1, `replay starts on the first event and ends on all ${N}`);
  let mono = true, prev = 0;
  for (let x = 0; x <= 1.0001; x += 0.002) { const G = SV.growthAt(steps, x), v = G.k - 1 + G.frac; if (v < prev - 1e-9) mono = false; prev = v; }
  ok(mono, 'the replay never goes back');
  for (const kind of SV.SHOT_KINDS) {
    const T = SV.pickTarget(L, N, kind, rng(3)), p = SV.plateFor(L, T, N);
    const txt = [p.title, p.sub, ...(p.lines || [])].join(' ');
    ok(typeof p.title === 'string' && p.title && !p.eq && !p.tex && !p.code && !/[{}]|=>|function\s*\(|const |\$_/.test(txt), `plate for ${kind} is plain text: ${p.title.slice(0, 40)}`);
  }
}

section('page logic (model.js, render.js)');
{
  const { EVENTS } = await import('./data/events.js');
  const M = await import('./model.js');
  const R = await import('./render.js');
  const L = layout(EVENTS, M.LAYOUT_OPTS), N = L.nodes.length;
  ok(L.band && L.band.label === 'before October' && L.band.count === 46, `ledger band: ${L.band && L.band.label}, ${L.band && L.band.count} events`);
  ok(L.rings.length === 23 && L.rings[0].label === '2026-10-02', `ledger day rings ${L.rings.length} from ${L.rings[0] && L.rings[0].label}`);
  ok(L.threads.every(t => M.THREAD_NAMES[t.id]), 'every thread has a display name');
  const C = M.threadColors(L.threads);
  ok(new Set(C.values()).size === L.threads.length, 'thread colours are distinct');
  const c = M.counts(EVENTS);
  ok(c.events === EVENTS.length && c.confirmed + c.reported + c.disputed === c.events, 'counts add up');
  ok(c.sources === new Set(EVENTS.flatMap(e => e.sources.map(x => x.url))).size && c.threads === L.threads.length, 'counts: distinct sources and threads');
  ok(M.fmtUTC(Date.UTC(2026, 9, 21, 7, 5)) === '2026-10-21 07:05 UTC' && M.fmtUTC(Date.UTC(2026, 9, 21, 12), 'day') === '2026-10-21', 'fmtUTC minute and day');
  ok(M.fmtUTC(Date.parse('2026-10-12T21:03:58Z')) === '2026-10-12 21:03:58 UTC', 'fmtUTC keeps seconds');
  ok(M.fmtUTC(Date.UTC(2026, 9, 21, 9, 10), 'hour') === '2026-10-21 about 09:00 UTC' && M.fmtUTC(Date.UTC(2026, 9, 21, 14, 41), 'hour') === '2026-10-21 about 15:00 UTC', 'fmtUTC hour shows no minutes the source does not give');
  ok(M.dayLabel(Date.UTC(2026, 9, 13)) === '13 Oct' && M.monthLabel(Date.UTC(2025, 4, 1)) === 'May 2025', 'ring labels');
  ok(EVENTS.every(e => M.KIND_TEXT[e.kind] && M.CONF_TEXT[e.confidence] && M.PREC_TEXT[e.tPrecision]), 'every kind, confidence and precision has text');

  const v = M.fitView({ x: 0, y: 44, w: 390, h: 700 });
  const [sx, sy] = M.toScreen(v, 0.3, -0.2), [wx, wy] = M.toWorld(v, sx, sy);
  ok(near(wx, 0.3) && near(wy, -0.2), 'toWorld inverts toScreen');
  ok(near(M.toScreen(v, 1.14, 0)[0], 390) && near(M.toScreen(v, 0, 0)[1], 44 + 350), 'fit puts the disc in the rect');
  const z = M.zoomAt(v, 2.5, 120, 300), [a1, b1] = M.toWorld(v, 120, 300), [a2, b2] = M.toWorld(z, 120, 300);
  ok(near(a1, a2) && near(b1, b2) && near(z.s, v.s * 2.5), 'zoomAt keeps the point under the finger');
  ok(M.zoomAt(v, 100, 0, 0, 0, v.s * 3).s === v.s * 3, 'zoomAt clamps');
  const co = M.centreOn(v, 0.5, 0.5, 100, 200), [px, py] = M.toScreen(co, 0.5, 0.5);
  ok(near(px, 100) && near(py, 200), 'centreOn');

  // a tap on a node picks it (or one at the same spot) at 4x zoom on a phone
  const v4 = { ...v, s: v.s * 4 };
  let miss = 0;
  for (const n of L.nodes) {
    const [x, y] = M.toScreen(v4, n.x, n.y), p = M.pick(L.nodes, v4, x, y, 22);
    if (!p || Math.hypot(p.x - n.x, p.y - n.y) > 1e-9) miss++;
  }
  ok(miss === 0, `pick at 4x zoom: ${miss} nodes not picked by a tap on them`);
  ok(M.pick(L.nodes, v, -500, -500, 22) === null, 'pick far away gives null');
  ok(M.pick(L.nodes, v4, ...M.toScreen(v4, L.nodes[0].x, L.nodes[0].y), 22, n => n !== L.nodes[0]) !== L.nodes[0], 'pick skips hidden nodes');
  // pickAll: nearest first, the same first node as pick, and no node out of reach
  {
    let bad = 0, crowd = 0;
    for (const n of L.nodes) {
      const [x, y] = M.toScreen(v, n.x, n.y), all = M.pickAll(L.nodes, v, x, y, 22), one = M.pick(L.nodes, v, x, y, 22);
      const d = m => { const [a, b] = M.toScreen(v, m.x, m.y); return Math.hypot(a - x, b - y); };
      if (!one || Math.abs(d(all[0]) - d(one)) > 1e-9 || all.some((m, i) => d(m) > 22 || (i && d(m) < d(all[i - 1]) - 1e-9))) bad++;
      if (all.length > 1) crowd++;
    }
    ok(bad === 0, `pickAll starts at pick's distance (ties may differ) and sorts by distance (${bad} bad)`);
    ok(crowd > 0, `at fit zoom on a 390px phone, ${crowd} of ${N} dots share a tap with another dot`);
    ok(M.pickAll(L.nodes, v, -500, -500, 22).length === 0, 'pickAll far away is empty');
  }
  // findEvents: no query gives all, newest first; each word must match
  {
    const all = M.findEvents(L.nodes, '');
    ok(all.length === N && all.every((n, i) => !i || all[i - 1].t >= n.t), 'findEvents with no query: every event, newest first');
    const e0 = L.nodes[Math.floor(N / 2)], word = e0.ev.title.split(/\s+/).find(w => w.length > 5) || e0.ev.title;
    const hits = M.findEvents(L.nodes, word.toUpperCase());
    ok(hits.includes(e0) && hits.every(n => [n.ev.title, n.ev.summary, n.ev.id, n.thread, M.threadName(n.thread), ...n.ev.sources.map(x => x.publisher)].join(' ').toLowerCase().includes(word.toLowerCase())), `findEvents "${word}": ${hits.length} hits, case-blind`);
    ok(M.findEvents(L.nodes, 'php2shell cisco').every(n => n.thread === 'php2shell' || /cisco/i.test(n.ev.title + n.ev.summary)) && M.findEvents(L.nodes, 'php2shell cisco').length > 0, 'findEvents: two words both match');
    ok(M.findEvents(L.nodes, 'zzzz-no-such-event').length === 0, 'findEvents: no match gives none');
    ok(M.findEvents(L.nodes, 'Railway').some(n => n.thread === 'railway'), 'findEvents matches thread names');
  }

  const pairs = M.relatedPairs(L);
  const relIn = EVENTS.reduce((a, e) => a + (e.related || []).length, 0);
  ok(pairs.length === relIn && pairs.every(([x, y]) => L.byId.get(x).thread !== L.byId.get(y).thread), `related pairs ${pairs.length}, each across threads`);
  const lk = M.linksOf(L, pairs[0][1]);
  ok(lk.related.includes(pairs[0][0]), 'linksOf sees a related link from the other end');
  const deep = L.nodes.reduce((a, n) => n.depth > a.depth ? n : a);
  const dl = M.linksOf(L, deep.id);
  ok(dl.chain.length === deep.depth && L.byId.get(dl.chain.at(-1)).parent === null, `linksOf chain goes to the root (depth ${deep.depth})`);
  ok(L.nodes.every(n => M.linksOf(L, n.id).children.every(ch => L.byId.get(ch).parent === n.id)), 'linksOf children');
  ok(M.revealCount(L.nodes, -Infinity) === 0 && M.revealCount(L.nodes, Infinity) === N && M.revealCount(L.nodes, L.tw) === 48, 'revealCount (46 before the window, then the two events at its start, 1 Oct 12:00)');

  const items = L.nodes.map((n, i) => ({ x: (i * 37) % 390, y: (i * 53) % 700, w: 60 + (i % 5) * 20, h: 13, pri: i }));
  const placed = M.placeLabels(items, [{ x0: 0, y0: 0, x1: 100, y1: 40 }], 500);
  let over = 0;
  const bx = placed.map(p => ({ x0: p.lx, y0: p.ly, x1: p.lx + p.w, y1: p.ly + p.h }));
  for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) { const A = bx[i], B = bx[j]; if (A.x0 < B.x1 && A.x1 > B.x0 && A.y0 < B.y1 && A.y1 > B.y0) over++; }
  ok(placed.length > 20 && over === 0 && bx.every(b => !(b.x0 < 100 && b.y0 < 40 && b.x1 > 0 && b.y1 > 0)), `placeLabels: ${placed.length} labels, ${over} overlaps, none on the blocked box`);

  // drawScene on a recording 2D context: every call gets finite numbers
  let calls = 0, bad = 0;
  const ctx = new Proxy({}, { get(t, k) {
    if (k === 'measureText') return s => ({ width: String(s).length * 6 });
    if (k in t) return t[k];
    return (...a) => { calls++; if (a.some(x => typeof x === 'number' && !Number.isFinite(x))) bad++; };
  }, set(t, k, val) { t[k] = val; return true; } });
  const base = { w: 390, h: 844, view: v, zoom: 1, k: N, frac: 1, colors: C, hidden: new Set(), confOff: new Set(), hover: null, sel: null, front: null, labels: 'auto', font: 12, names: M.threadName };
  const states = [base, { ...base, view: v4, zoom: 4 }, { ...base, sel: deep.id, hover: L.nodes[5].id },
    { ...base, k: 21, frac: 0.4, front: L.tw }, { ...base, k: 0 }, { ...base, hidden: new Set(['php2shell']), confOff: new Set(['reported']) },
    { ...base, labels: new Set(L.nodes.slice(0, 30).map(n => n.id)) }, { ...base, view: { ...v, s: v.s * 40, cx: deep.x, cy: deep.y }, zoom: 40 }];
  for (const st of states) R.drawScene(ctx, L, { ...st });
  ok(calls > 1000 && bad === 0, `drawScene: ${calls} canvas calls, ${bad} with a non-finite number`);
  ok(R.nodeRadius(L.nodes[0], 1) > 0 && R.nodeRadius(L.nodes[0], 50) <= R.nodeRadius(L.nodes[0], 1) * 2.41, 'dot size grows with zoom, capped');
}

section('main.js link check');
{
  const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  let err = null;
  try { await import('./main.js'); } catch (e) { err = e; }
  ok(err && err.name === 'ReferenceError' && !(err instanceof SyntaxError), `main.js parses and links; it stops on a browser global (${err && err.name}: ${err && err.message})`);
  // every named import of the page modules is a real export
  for (const f of ['main.js', 'saver.js', 'render.js', 'model.js', 'grow.js']) {
    const src = fs.readFileSync(path.join(here, f), 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
      const mod = await import(path.join(here, m[2]));
      const names = m[1].split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      const miss = names.filter(n => !(n in mod));
      ok(!miss.length, `${f}: ${m[2]} exports ${miss.length ? 'no ' + miss.join(', ') : names.length + ' names'}`);
    }
    for (const m of src.matchAll(/import\(\s*'([^']+)'\s*\)/g)) ok(fs.existsSync(path.join(here, m[1])), `${f}: dynamic import ${m[1]} exists`);
  }
  // every id main.js binds to is in index.html
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8'), main = fs.readFileSync(path.join(here, 'main.js'), 'utf8');
  const ids = [...new Set([...main.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))];
  const missing = ids.filter(id => !html.includes(`id="${id}"`));
  ok(ids.length > 15 && !missing.length, `index.html has all ${ids.length} ids of main.js${missing.length ? ', missing ' + missing.join(', ') : ''}`);
  const heads = ['gpu-guard.js', 'wishlist.js', 'stats-beacon.js'].map(s => html.indexOf(s));
  ok(heads.every(i => i > 0) && heads[0] < heads[1] && heads[1] < heads[2] && heads[2] < html.indexOf('style.css'), 'head order gpu-guard, wishlist, stats-beacon, style');
  ok(/<title>Black October/.test(html) && html.includes('src="main.js"'), 'title and main.js');
  const css = fs.readFileSync(path.join(here, 'style.css'), 'utf8');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'style.css has [hidden]{display:none!important}');
  ok(/rel: 'noopener noreferrer'/.test(main) && !/\.innerHTML\s*=/.test(main), 'source links get rel noopener; main.js sets no innerHTML');
  ok(!/text-transform:\s*uppercase|letter-spacing:\s*\.?[1-9]/.test(css), 'no uppercase letter-spaced labels');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
