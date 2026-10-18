// CNN Explainer · tests/layout.test.mjs
// The overview layouts (desktop columns, phone blocks), hit tests, the
// receptive field sizes the explainer text quotes, the saver plan and the
// saver framing in 16:9 and 9:16 bands. No DOM.
import { layoutNet, hitTest, feeders, fieldMaps, GRID, zoomWidth, zoomFrom, lerpRect, prevShown } from '../layout.js';
import { barWidths, fillOf, drawNetwork } from '../draw.js';
import { denseBars, densePhases, isLand } from '../scenes.js';
import { receptiveField, ARCH } from '../net.js';
import { photoPlan, fitNet, ZOOM_CHOICES } from '../saver.js';
import { tourPlan } from '../tour.js';
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

// saver plan: seeded, every example before a repeat, the zoom layers vary
{
  const a = photoPlan(7, 60), b = photoPlan(7, 60), c = photoPlan(8, 60);
  ok(JSON.stringify(a) === JSON.stringify(b), 'photoPlan is seeded');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'photoPlan differs by seed');
  ok(new Set(a.slice(0, 20).map(p => p.ex)).size === 20, 'the first 20 photos are all different', a.slice(0, 20).map(p => p.ex).join(','));
  ok(a.every(p => Object.entries(ZOOM_CHOICES).every(([k, ls]) => ls.includes(p.zooms[k]) && ARCH[p.zooms[k]].type === k) && p.zooms.dense === 11), 'each zoom names a layer of its kind');
  let rep = 0; for (let i = 1; i < a.length; i++) for (const k of ['conv', 'relu', 'pool']) if (a[i].zooms[k] === a[i - 1].zooms[k]) rep++;
  ok(rep === 0, 'no zoom layer twice in a row');
  ok(Object.entries(ZOOM_CHOICES).every(([k, ls]) => ls.every(li => a.some(p => p.zooms[k] === li))), 'every zoom layer plays in 60 photos');
  const runs = a.slice(0, 20).map(p => tourPlan({ zooms: p.zooms }));
  ok(runs.every(r => r.segs.filter(q => q.kind === 'flow').map(q => q.li).join() === '0,1,2,3,4,5,6,7,8,9,10,11'), 'the saver run of each photo visits every layer in order');
  ok(runs.every(r => r.segs.filter(q => q.kind === 'zoom').length === 4 && r.total >= 30 && r.total <= 60), 'each saver run has four zooms and lasts 30 to 60 s');
}
// saver framing: the network fits the clear band at 16:9 and 9:16
for (const [name, band] of [['16:9', { x: 51, y: 190, w: 1178, h: 400 }], ['16:9 small', { x: 20, y: 120, w: 600, h: 230 }], ['9:16', { x: 18, y: 260, w: 414, h: 700 }], ['9:16 short', { x: 16, y: 200, w: 340, h: 380 }]]) {
  const f = fitNet(band), L = f.L, W = L.w * f.k, H = (L.orient === 'h' ? band.h : L.h) * f.k;
  ok(f.ox >= band.x - 0.5 && f.oy >= band.y - 0.5 && f.ox + W <= band.x + band.w + 0.5 && f.oy + H <= band.y + band.h + 0.5, `saver ${name}: network inside the band`, JSON.stringify({ ox: f.ox, oy: f.oy, W, H }));
  const s = L.s * f.k;
  ok(s >= 12, `saver ${name}: maps are ${s.toFixed(1)} px, large enough to read`);
  ok(W >= band.w * 0.6 || H >= band.h * 0.6, `saver ${name}: network fills the band (${(W / band.w * 100).toFixed(0)}% x ${(H / band.h * 100).toFixed(0)}%)`);
  if (f.wide) {
    const z = fitNet(band, { li: 6, f: 1 }), Z = z.L.zoom;
    ok(Z && Z.x >= 0 && Z.x + Z.w <= band.w + 0.5 && Z.y + Z.h <= band.h, `saver ${name}: an open zoom column is inside the band`, JSON.stringify(Z));
  }
}

// the inline zoom: one column opens, the others make room
for (const [w, h] of [[890, 640], [1100, 640], [1530, 860], [760, 520]]) {
  const base = layoutNet(w, h, 'h');
  const z0 = layoutNet(w, h, 'h', { expand: { li: 3, f: 0 } });
  ok(JSON.stringify(z0.maps) === JSON.stringify(base.maps) && z0.zoom === null, `${w}x${h}: a closed zoom is the plain layout`);
  for (const li of [0, 1, 5, 10, 11]) {
    const L = layoutNet(w, h, 'h', { expand: { li, f: 1 } }), Z = L.zoom;
    ok(Z && Z.li === li && Z.x >= 0 && Z.x + Z.w <= w + 0.5 && Z.y >= 0 && Z.y + Z.h <= h, `${w}x${h} zoom ${li}: the open column is inside the canvas`, JSON.stringify(Z));
    ok(Z.w >= zoomWidth(w) - (li === 11 ? 11 : 9), `${w}x${h} zoom ${li}: the open column is ${Math.round(Z.w)} px wide`);
    const others = L.maps.filter(m => m.li !== li);
    ok(others.every(m => m.x >= 0 && m.x + m.s <= w + 0.5 && (m.x + m.s <= Z.x || m.x >= Z.x + Z.w)), `${w}x${h} zoom ${li}: the other maps stay out of the open column`);
    let ov = 0; for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) if (overlap(others[i], others[j])) ov++;
    ok(ov === 0, `${w}x${h} zoom ${li}: no two maps overlap`, String(ov));
    ok(L.cols.every((c, i) => i === 0 || c.x >= L.cols[i - 1].x), `${w}x${h} zoom ${li}: the columns keep their order`);
    const m = others.find(q => q.li === (li === 1 ? 2 : 1) && q.c === 4), t = hitTest(L, m.x + m.s / 2, m.y + m.s / 2);
    ok(t && t.li === m.li && t.c === 4, `${w}x${h} zoom ${li}: the hit test finds a narrow map`);
  }
  const half = layoutNet(w, h, 'h', { expand: { li: 6, f: 0.5 } }), full = layoutNet(w, h, 'h', { expand: { li: 6, f: 1 } });
  ok(half.zoom.w > base.cols[6].w && half.zoom.w < full.zoom.w, `${w}x${h}: the column grows with f`);
}
for (const w of [360, 390]) {
  const base = layoutNet(w, 0, 'v'), L = layoutNet(w, 0, 'v', { expand: { li: 5, f: 1, h: 500 } }), Z = L.zoom;
  const blk = base.cols.find(c => c.li === 5), nxt = base.cols.find(c => c.li === 6);
  ok(Z && Z.y >= blk.y + blk.rowH && Z.y + Z.h <= L.cols.find(c => c.li === 6).y && Z.w === w - 32 && Z.h === 500, `phone ${w}: the zoom opens under its block`, JSON.stringify(Z));
  ok(Math.abs(L.h - base.h - 512) < 1e-6 && Math.abs(L.cols.find(c => c.li === 6).y - nxt.y - 512) < 1e-6, `phone ${w}: the blocks under it move down by the zoom`);
  const half = layoutNet(w, 0, 'v', { expand: { li: 5, f: 0.5, h: 500 } });
  ok(half.zoom.h === 250 && Math.abs(half.h - base.h - 256) < 1e-6, `phone ${w}: half open is half as tall`);
  const o = layoutNet(w, 0, 'v', { expand: { li: 11, f: 1, h: 400 } });
  ok(o.zoom && o.zoom.y >= o.bars[9].y + o.bars[9].h && o.zoom.y + o.zoom.h <= o.h, `phone ${w}: the output zoom opens under the bars`);
}
{
  const L = layoutNet(1100, 640, 'h');
  const r = zoomFrom(L, 6, 2), m = L.maps.find(q => q.li === 6 && q.c === 2);
  ok(r.x === m.x && r.w === m.s, 'zoomFrom: a map');
  ok(zoomFrom(L, 11, null, 7).y === L.bars[7].y, 'zoomFrom: the output grows from the top bar');
  ok(zoomFrom(L, 0, -1).x === L.maps.find(q => q.li === 0 && q.c === -1).x, 'zoomFrom: the picture');
  const T = layoutNet(414, 0, 'v', { per: 10, skip: new Set([2, 4, 7, 9]), inline: true });
  ok(zoomFrom(T, 7, 3).x === T.maps.find(q => q.li === 6 && q.c === 3).x, 'zoomFrom: a left-out layer grows from the map before it');
  ok(prevShown(T, 8) === 6 && prevShown(T, 6) === 5 && prevShown(L, 8) === 7, 'prevShown skips the left-out layers');
  const e = lerpRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 50, w: 210, h: 110 }, 0.5);
  ok(e.x === 50 && e.y === 25 && e.w === 110 && e.h === 60, 'lerpRect');
}
// the class bars: the drawn widths are the probabilities
{
  const L = layoutNet(1100, 640, 'h'), probs = [0.001, 0.0081, 0, 0.0054, 0, 0, 0.0125, 0.972, 0.0005, 0.001];
  const wd = barWidths(L, probs, 1);
  ok(Math.abs(wd[7] - probs[7] * L.bars[7].w) < 1e-9 && Math.abs(wd[1] - Math.max(probs[1] * L.bars[1].w, 7)) < 1e-9 && wd[2] === 0, 'barWidths: probability x width', wd.map(v => v.toFixed(1)).join(' '));
  ok(barWidths(L, probs, 0).every(v => v === 0) && Math.abs(barWidths(L, probs, 0.5)[7] - probs[7] * 0.5 * L.bars[7].w) < 1e-9, 'barWidths grow with grow');
  const z = [1.2, 2.4, -3, 0.5, -1, 0, 3.4, 6.553, -2, 1], ex = z.map(Math.exp), sum = ex.reduce((a, b) => a + b, 0), p = ex.map(v => v / sum);
  const end = denseBars(z, p, 400, 1, 1);
  ok(end.every((b, i) => Math.abs(b.x) < 1e-9 && Math.abs(b.w - p[i] * 400) < 1e-9), 'dense scene: at the end each bar is its probability');
  ok(denseBars(z, p, 400, 1, 0).every((b, i) => Math.abs(b.w - Math.abs(z[i]) / 6.553 * 200) < 1e-9), 'dense scene: before softmax each bar is its score');
  ok(denseBars(z, p, 400, 0, 0).every(b => b.w === 0), 'dense scene: the bars start empty');
  const d = densePhases(0.999);
  ok(d.a1 === 1 && d.a2 === 1 && d.a3 === 1 && d.a4 === 1, 'dense scene: t 0.999 shows every phase');
  ok(isLand(830, 380) && !isLand(612, 470) && isLand(600, 230) && !isLand(366, 500), 'scene zones: columns on a wide card, rows in the zoom column');
}
// the fill-in of the run
ok(fillOf(3, 0, 0) === 0 && fillOf(3, 9, 1) === 1 && fillOf(3, 0, 0.5) > fillOf(3, 9, 0.5), 'fillOf: the maps fill one after the other');
ok(fillOf(0, -1, 0.3) === 1 && fillOf(0, 2, 0.3) === 0 && fillOf(0, 2, 1) === 1, 'fillOf: the picture first, then the channels');
ok(fillOf(5, 3, 0.15, true) > 0 && fillOf(5, 3, 0.3, true) === 1, 'fillOf: reduced motion is a short fade');

// drawNetwork draws every state of a run with no error (a context that only counts)
{
  const calls = {};
  const g = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls[k] = (calls[k] || 0) + 1; }), set: (t, k, v) => { t[k] = v; return true; } });
  const maps = { img: () => ({ width: 8 }), rgb: () => '#fc6' };
  const result = { probs: [0.001, 0.0081, 0, 0.0054, 0, 0, 0.0125, 0.972, 0.0005, 0.001], top: 7 };
  let errs = 0, last = null;
  for (const L of [layoutNet(1100, 640, 'h'), layoutNet(390, 0, 'v'), layoutNet(414, 0, 'v', { per: 10, skip: new Set([2, 4, 7, 9]), inline: true }), layoutNet(890, 640, 'h', { expand: { li: 5, f: 0.6 } })]) {
    for (let li = 0; li < 12; li++) for (const k of [0, 0.1, 0.5, 0.9, 1]) for (const reduced of [false, true]) {
      try { last = drawNetwork(g, L, { maps, result, flow: { li, k, time: k * 3, reduced }, barT: li === 11 ? k : 0, win: li === 11 ? k : 0, zoom: L.zoom }); } catch (e) { errs++; if (errs < 3) console.log(e.stack); }
    }
  }
  ok(errs === 0, 'drawNetwork draws every flow state', String(errs));
  ok(calls.bezierCurveTo > 100 && calls.fillRect > 100 && calls.drawImage > 100, 'the flow draws edges, dots and maps', JSON.stringify({ b: calls.bezierCurveTo, f: calls.fillRect, d: calls.drawImage }));
  ok(last && last.bars && last.bars.length === 10, 'drawNetwork returns the bar widths');
}

console.log(`layout: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
