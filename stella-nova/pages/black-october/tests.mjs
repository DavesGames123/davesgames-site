// ============================================================================
//  BLACK OCTOBER  ·  tests.mjs — node tests, no browser
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/black-october/tests.mjs
//  Covers grow.js on a synthetic event set (fake ids, fake times, example.org
//  sources): the data rules, radius = time, the sectors, the node spacing,
//  the edges (start on the parent, end on the child, radius does not
//  decrease) and the seed. The real events in data/ are checked by
//  tools/check-events.mjs, not here.
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
