// CNN Explainer · tests/layout.test.mjs
// The overview layouts (desktop columns, phone blocks), hit tests, the
// receptive field sizes the explainer text quotes. No DOM.
import { layoutNet, hitTest, feeders, fieldMaps, GRID } from '../layout.js';
import { receptiveField, ARCH } from '../net.js';
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

console.log(`layout: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
