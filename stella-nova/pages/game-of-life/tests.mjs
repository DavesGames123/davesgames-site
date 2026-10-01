// tests.mjs - checks for the Game of Life page.
//
// RUN
//   node stella-nova/pages/game-of-life/tests.mjs
//       the CPU checks: the rule parser, the transforms, dense against
//       sparse, and every library pattern against its class.
//   node stella-nova/pages/game-of-life/tests.mjs --gpu http://127.0.0.1:47555 9555
//       also the GPU parity check. It needs a static server at that origin
//       (the repo root) and a headless Chrome with --enable-unsafe-webgpu and
//       --remote-debugging-port=9555. The page runs N generations of a seeded
//       soup on the GPU, and life.js runs them on the CPU in the same page.
//       Every cell word must match, bit for bit.
//
// The process exits with code 1 when a check fails.
import * as L from './life.js';
import { PATTERNS, CLASSES } from './patterns.js';

const LIFE = L.parseRule('B3/S23');
let fails = 0, passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++; else fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}

// ------------------------------------------------------------- rule text
{
  const cases = [['B3/S23', 'B3/S23'], ['b36s23', 'B36/S23'], ['B2/S', 'B2/S'], ['23/3', 'B3/S23'],
    ['S23/B3', 'B3/S23'], ['B3678/S34678', 'B3678/S34678'], ['B3/S012345678', 'B3/S012345678']];
  for (const [t, want] of cases) { const r = L.parseRule(t); check(`parseRule ${t}`, r && r.str === want, r ? r.str : 'null'); }
  check('parseRule rejects B9/S23', L.parseRule('B9/S23') === null);
  check('parseRule rejects junk', L.parseRule('hello') === null);
  for (const r of L.RULES) check(`preset ${r.name} parses`, L.parseRule(r.str)?.str === r.str);
}

// ------------------------------------------------------------- cell word
{
  const { birth: b, survive: s } = LIFE;
  check('newborn on 3', L.nextValue(0, 3, b, s) === 1);
  check('age grows on 2', L.nextValue(5, 2, b, s) === 6);
  check('age stops at 255', L.nextValue(255, 3, b, s) === 255);
  check('death leaves a full trail', L.nextValue(7, 1, b, s) === L.TRAIL << 8);
  check('trail fades by one', L.nextValue(10 << 8, 2, b, s) === 9 << 8);
  check('trail ends at 0', L.nextValue(1 << 8, 0, b, s) === 0);
  check('birth clears the trail', L.nextValue(12 << 8, 3, b, s) === 1);
}

// ---------------------------------------------------------- transforms
{
  const g = L.parseRLE('bo$2bo$3o!');
  check('glider has 5 cells', g.length === 5);
  check('four turns give the same glider', L.sameCells(L.orient(g, 4, false), g));
  check('two flips give the same glider', L.sameCells(L.orient(L.orient(g, 0, true), 0, true), g));
  const r1 = L.orient(g, 1, false);
  check('one turn gives a new phase', !L.sameCells(r1, g) && r1.length === 5);
  const p = L.parseRLE('#N test\nx = 3, y = 3, rule = B3/S23\nbo$2bo$\n3o!');
  check('RLE header and line breaks', L.sameCells(p, g));
}

// ------------------------------------------------- dense against sparse
// Bounded dense world with a soup in the middle against the unbounded
// sparse plane. They agree while nothing reaches the edge.
{
  const W = 96, H = 96;
  let a = L.randomWorld(W, H, 0.35, 7, { x: 40, y: 40, w: 16, h: 16 });
  let s = new Set();
  for (let i = 0; i < W * H; i++) if (a[i]) s.add(L.key(i % W, (i / W) | 0));
  let same = true, g = 0;
  for (; g < 30 && same; g++) {
    a = L.stepDense(a, W, H, LIFE.birth, LIFE.survive, false);
    s = L.stepSparse(s, LIFE.birth, LIFE.survive);
    let n = 0;
    for (let i = 0; i < W * H; i++) if (a[i] & 0xff) { n++; if (!s.has(L.key(i % W, (i / W) | 0))) same = false; }
    if (n !== s.size) same = false;
  }
  check('dense and sparse agree for 30 generations', same, 'stopped at ' + g);

  // A glider crosses the seam of a 16 x 16 torus and comes back home.
  const T = 16; let w = new Uint32Array(T * T);
  for (const [x, y] of L.parseRLE('bo$2bo$3o!')) w[y * T + x] = 1;
  const start = w.map(v => (v & 0xff) ? 1 : 0);
  for (let k = 0; k < 4 * T; k++) w = L.stepDense(w, T, T, LIFE.birth, LIFE.survive, true);
  check('glider wraps a 16 x 16 torus in 64 generations', w.every((v, i) => ((v & 0xff) ? 1 : 0) === start[i]));
}

// ------------------------------------------------------------ patterns
const run = (cells, n) => { let s = L.toSet(cells); for (let i = 0; i < n; i++) s = L.stepSparse(s, LIFE.birth, LIFE.survive); return s; };
const shapeAt = set => { const c = L.fromSet(set); return { b: L.bounds(c), n: L.normalize(c) }; };

function testPattern(p) {
  const cells = L.parseRLE(p.rle), t = p.test;
  const tag = `${p.cls}/${p.id}`;
  if (t.kind === 'still') {
    const s1 = shapeAt(run(cells, 1));
    return check(`${tag} still life`, L.sameCells(s1.n, cells) && s1.b.x0 === 0 && s1.b.y0 === 0, cells.length + ' cells');
  }
  if (t.kind === 'osc' || t.kind === 'ship') {
    let s = L.toSet(cells), first = -1, move = null;
    for (let g = 1; g <= t.p && first < 0; g++) {
      s = L.stepSparse(s, LIFE.birth, LIFE.survive);
      const now = shapeAt(s);
      if (L.sameCells(now.n, cells)) { first = g; move = [now.b.x0, now.b.y0]; }
    }
    if (t.kind === 'osc') return check(`${tag} period ${t.p}`, first === t.p && move[0] === 0 && move[1] === 0, 'first return at ' + first);
    const ok = first === t.p && Math.abs(move[0]) === t.dx && Math.abs(move[1]) === t.dy;
    return check(`${tag} period ${t.p}, moves (${t.dx}, ${t.dy})`, ok, `first return at ${first}, moved (${move && move.join(', ')})`);
  }
  if (t.kind === 'gun') {
    // The gun box repeats each period, and each period adds one glider.
    const b0 = L.bounds(cells), inBox = set => L.normalize(L.fromSet(set).filter(([x, y]) => x >= b0.x0 && x <= b0.x1 && y >= b0.y0 && y <= b0.y1));
    const pops = [], boxes = [];
    let s = L.toSet(cells);
    for (let g = 0; g <= 8 * t.p; g++) {
      if (g % t.p === 0 && g >= 2 * t.p) { pops.push(s.size); boxes.push(inBox(s)); }
      s = L.stepSparse(s, LIFE.birth, LIFE.survive);
    }
    const steps = pops.slice(1).map((v, i) => v - pops[i]);
    const boxSame = boxes.every(b => L.sameCells(b, boxes[0]));
    return check(`${tag} period ${t.p} gun`, steps.every(d => d === 5) && boxSame, 'population each period ' + pops.join(' '));
  }
  if (t.kind === 'puffer') {
    // The front 25 columns repeat after p generations, moved dx.
    const hist = []; let s = L.toSet(cells);
    for (let g = 0; g <= 600 + t.p; g++) { if (g === 600 || g === 600 + t.p) hist.push(L.fromSet(s)); s = L.stepSparse(s, LIFE.birth, LIFE.survive); }
    const front = c => { const b = L.bounds(c); return { b, n: L.normalize(c.filter(([x]) => x >= b.x1 - 25)) }; };
    const f0 = front(hist[0]), f1 = front(hist[1]);
    const ok = L.sameCells(f0.n, f1.n) && f1.b.x1 - f0.b.x1 === t.dx && hist[1].length > hist[0].length;
    return check(`${tag} head period ${t.p}, moves ${t.dx}`, ok, `population ${hist[0].length} -> ${hist[1].length}`);
  }
  if (t.kind === 'meth') {
    const pops = []; let s = L.toSet(cells);
    for (let g = 0; g <= t.gen + 300; g++) { pops.push(s.size); s = L.stepSparse(s, LIFE.birth, LIFE.survive); }
    const after = pops.slice(t.gen);
    const flat = after.every(v => v === t.pop);
    const before = pops.slice(t.gen - 20, t.gen).some(v => v !== t.pop);
    return check(`${tag} settles at ${t.gen} with ${t.pop}`, flat && before, `pop(${t.gen}) = ${pops[t.gen]}, flat for 300: ${flat}`);
  }
  if (t.kind === 'dies') {
    const pops = []; let s = L.toSet(cells);
    for (let g = 0; g <= t.gen + 5; g++) { pops.push(s.size); s = L.stepSparse(s, LIFE.birth, LIFE.survive); }
    return check(`${tag} dies at ${t.gen}`, pops[t.gen] === 0 && pops[t.gen - 1] > 0, `pop(${t.gen - 1}) = ${pops[t.gen - 1]}, pop(${t.gen}) = ${pops[t.gen]}`);
  }
  if (t.kind === 'growth') {
    // Population at four even marks: each mark must add more than 50 cells.
    const marks = [1, 2, 3, 4].map(k => k * t.gen / 4), pops = [];
    let s = L.toSet(cells);
    for (let g = 1; g <= t.gen; g++) { s = L.stepSparse(s, LIFE.birth, LIFE.survive); if (marks.includes(g)) pops.push(s.size); }
    const ok = pops.slice(1).every((v, i) => v - pops[i] > 50) && pops[3] > t.min;
    return check(`${tag} grows without limit`, ok, marks.map((g, i) => `pop(${g}) = ${pops[i]}`).join(', '));
  }
  check(`${tag} has a test`, false, 'unknown kind ' + t.kind);
}

{
  const ids = new Set();
  for (const p of PATTERNS) {
    check(`${p.id} unique id, known class`, !ids.has(p.id) && CLASSES.some(c => c.id === p.cls));
    ids.add(p.id);
    testPattern(p);
  }
}

// ------------------------------------------------------------- GPU parity
async function gpuParity(origin, port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  let target = list.find(t => t.type === 'page');
  if (!target) target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const wait = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: origin + '/stella-nova/pages/game-of-life/parity.html' });
  // parity.html imports engine-gpu.js and life.js. It sets window.parity.
  let ready = false;
  for (let k = 0; k < 100 && !ready; k++) {
    await new Promise(r => setTimeout(r, 100));
    const r = await send('Runtime.evaluate', { expression: 'typeof window.parity === "function"', returnByValue: true });
    ready = r.result?.result?.value === true;
  }
  if (!ready) { check('GPU parity page loads', false); ws.close(); return; }
  const cases = [
    { rule: 'B3/S23', W: 512, H: 512, wrap: true, gens: 200, density: 0.3, seed: 1 },
    { rule: 'B3/S23', W: 300, H: 200, wrap: false, gens: 150, density: 0.4, seed: 2 },
    { rule: 'B36/S23', W: 256, H: 256, wrap: true, gens: 120, density: 0.35, seed: 3 },
    { rule: 'B3678/S34678', W: 208, H: 144, wrap: true, gens: 100, density: 0.5, seed: 4 },
    { rule: 'B2/S', W: 128, H: 128, wrap: false, gens: 40, density: 0.05, seed: 5 },
    { rule: 'B3/S12345', W: 160, H: 96, wrap: true, gens: 80, density: 0.2, seed: 6 },
  ];
  for (const c of cases) {
    const r = await send('Runtime.evaluate', { expression: `window.parity(${JSON.stringify(c)})`, awaitPromise: true, returnByValue: true });
    const v = r.result?.result?.value;
    if (!v) { check(`GPU parity ${c.rule}`, false, JSON.stringify(r.result?.exceptionDetails || r).slice(0, 300)); continue; }
    check(`GPU parity ${c.rule} ${c.W}x${c.H} ${c.wrap ? 'torus' : 'bounded'} ${c.gens} gens`,
      v.mismatch === 0 && v.statsOk, `cells ${v.cells}, mismatched words ${v.mismatch}, pop ${v.pop}, gpu stats ${JSON.stringify(v.gpuStats)}, cpu stats ${JSON.stringify(v.cpuStats)}`);
  }
  ws.close();
}

const gi = process.argv.indexOf('--gpu');
if (gi > 0) await gpuParity(process.argv[gi + 1], process.argv[gi + 2] || '9555');
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
