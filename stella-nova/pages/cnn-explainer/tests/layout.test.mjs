// CNN Explainer · tests/layout.test.mjs
// The overview layouts (desktop columns, phone blocks), hit tests, the
// receptive field sizes the explainer text quotes, the saver plan and the
// saver framing in 16:9 and 9:16 bands. No DOM.
import { layoutNet, hitTest, feeders, fieldMaps, GRID } from '../layout.js';
import { receptiveField, ARCH } from '../net.js';
import { shotPlan, fitNet } from '../saver.js';
import { SCALES } from '../colour.js';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) pass++; else { fail++; console.log('FAIL  ' + m + (d ? '  ' + d : '')); } };
const overlap = (a, b) => a.x < b.x + b.s && b.x < a.x + a.s && a.y < b.y + b.s && b.y < a.y + a.s;

for (const [w, h, o] of [[1100, 640, 'h'], [1440, 860, 'h'], [760, 520, 'h'], [360, 0, 'v'], [390, 0, 'v'], [700, 0, 'v']]) {
  const L = layoutNet(w, h, o);
  ok(L.maps.length === 4 + 10 * 10 && L.bars.length === 10 && L.cols.length === 12, `${w}x${h} ${o}: 104 maps, 10 bars, 12 titles`);
  const H = o === 'h' ? h : L.h;
  ok(L.maps.every(m => m.x >= 0 && m.y >= 0 && m.x + m.s <= w && m.y + m.s <= H), `${w}x${h} ${o}: maps inside the canvas`);
  ok(L.bars.every(b => b.x >= 0 && b.x + b.w <= w + 0.5 && b.y + b.h <= H), `${w}x${h} ${o}: bars inside the canvas`);
  let ov = 0; for (let i = 0; i < L.maps.length; i++) for (let j = i + 1; j < L.maps.length; j++) if (overlap(L.maps[i], L.maps[j])) ov++;
  ok(ov === 0, `${w}x${h} ${o}: no two maps overlap`, String(ov));
  ok(L.s >= (o === 'h' ? 24 : 50), `${w}x${h} ${o}: map size ${L.s} px is large enough`);
  // hit test: the centre of each map finds that map
  const bad = L.maps.filter(m => { const t = hitTest(L, m.x + m.s / 2, m.y + m.s / 2); return !t || t.li !== m.li || t.c !== m.c; });
  ok(bad.length === 0, `${w}x${h} ${o}: hit test finds every map`);
  const m = L.maps.find(q => q.li === 1 && q.c === 3), t = hitTest(L, m.x + m.s - 0.5, m.y + 0.5);
  ok(t.gx === 61 && t.gy === 0, `${w}x${h} ${o}: hit test gives the cell`, JSON.stringify(t));
  const b = L.bars[4], tb = hitTest(L, b.x + 2, b.y + 2);
  ok(tb && tb.kind === 'bar' && tb.i === 4, `${w}x${h} ${o}: hit test finds a bar`);
  ok(hitTest(L, -5, -5) === null, `${w}x${h} ${o}: empty space is no hit`);
}

// the receptive fields the explainer quotes: 3, 5, 6, 10, 16
const rfIn = li => { const f = receptiveField(li, 0, 0); return f[f.length - 1].size; };
ok(rfIn(1) === 3 && rfIn(3) === 5 && rfIn(5) === 6 && rfIn(6) === 10 && rfIn(10) === 16, 'receptive field sizes 3, 5, 6, 10, 16', [1, 3, 5, 6, 10].map(rfIn).join(','));
ok(feeders(1, 4).length === 3 && feeders(3, 4).length === 10 && feeders(2, 4).join() === '4' && feeders(5, 7).join() === '7' && feeders(11, 0).length === 10, 'feeders');
ok(fieldMaps(2, 4, 1).join() === '4' && fieldMaps(3, 4, 1).length === 10 && fieldMaps(1, 4, 0).join() === '-1,0,1,2', 'fieldMaps');
ok(GRID.length === ARCH.length, 'one grid size per layer');
ok(SCALES.map(s => s.id).join() === 'map,layer,network', 'three colour scales');

// saver plan: seeded, varied, every example before a repeat, cut lengths
{
  const a = shotPlan(7, 60, 0.7), b = shotPlan(7, 60, 0.7), c = shotPlan(8, 60, 0.7);
  ok(JSON.stringify(a) === JSON.stringify(b), 'shotPlan is seeded');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'shotPlan differs by seed');
  const firstEx = []; for (const s of a) if (s.id === 'pipeline' && firstEx.length < 20) firstEx.push(s.ex);
  ok(new Set(firstEx).size === 20, 'the first 20 photos are all different', firstEx.join(','));
  ok(a.every(s => s.sec >= 6 && s.sec <= 13), 'every shot lasts 6 to 13 s');
  let rep = 0; let last = ''; for (const s of a) { if (s.id !== 'pipeline') { if (s.id === last) rep++; last = s.id; } }
  ok(rep === 0, 'no detail kind twice in a row');
  ok(['conv', 'relu', 'pool', 'dense'].every(k => a.some(s => s.id === k)), 'every detail kind plays');
  ok(a.every(s => s.id === 'pipeline' || ARCH[s.li].type === s.id), 'detail shots name a layer of their kind');
}
// saver framing: the network fits the clear band at 16:9 and 9:16
for (const [name, band] of [['16:9', { x: 51, y: 190, w: 1178, h: 400 }], ['16:9 small', { x: 20, y: 120, w: 600, h: 230 }], ['9:16', { x: 18, y: 260, w: 414, h: 700 }], ['9:16 short', { x: 16, y: 200, w: 340, h: 380 }]]) {
  const f = fitNet(band), L = f.L, W = L.w * f.k, H = (L.orient === 'h' ? band.h : L.h) * f.k;
  ok(f.ox >= band.x - 0.5 && f.oy >= band.y - 0.5 && f.ox + W <= band.x + band.w + 0.5 && f.oy + H <= band.y + band.h + 0.5, `saver ${name}: network inside the band`, JSON.stringify({ ox: f.ox, oy: f.oy, W, H }));
  const s = L.s * f.k;
  ok(s >= 12, `saver ${name}: maps are ${s.toFixed(1)} px, large enough to read`);
  ok(W >= band.w * 0.6 || H >= band.h * 0.6, `saver ${name}: network fills the band (${(W / band.w * 100).toFixed(0)}% x ${(H / band.h * 100).toFixed(0)}%)`);
}

console.log(`layout: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
