// CNN Explainer · tests/tour.test.mjs
// The guided run timeline (tour.js), no DOM: the segments visit every
// layer in order, the run lasts 30 to 60 s at speed 1, the clock plays,
// pauses, seeks and steps, a zoom opens and closes, the scan of a zoom
// moves, the captions quote the right receptive fields, and the bars grow
// only at the output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tourPlan, createClock, segAt, flowState, zoomF, scanAt, busyMap, zoomStart, captionOf, answerText,
  SECTION_OF, EXPAND_SEC, DEFAULT_ZOOMS } from '../tour.js';
import { parseWeights, forward, receptiveField, ARCH } from '../net.js';
import { exampleRGB, EXAMPLES } from '../data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) pass++; else { fail++; console.log('FAIL  ' + m + (d ? '  ' + d : '')); } };

const P = tourPlan();
ok(P.total >= 30 && P.total <= 60, `a run lasts 30 to 60 s at speed 1`, P.total.toFixed(1));
const flowLi = P.segs.filter(s => s.kind === 'flow').map(s => s.li);
ok(flowLi.join() === '0,1,2,3,4,5,6,7,8,9,10,11', 'the flow visits every layer in order', flowLi.join());
ok(P.segs[P.segs.length - 1].kind === 'answer', 'the run ends on the answer');
ok(P.segs.every((s, i) => i === 0 ? s.t0 === 0 : Math.abs(s.t0 - P.segs[i - 1].t1) < 1e-9), 'the segments follow each other with no gap');
const zooms = P.segs.filter(s => s.kind === 'zoom');
ok(zooms.map(s => s.zoom + s.li).join() === 'conv1,relu2,pool5,dense11', 'the default zooms: conv, ReLU, pool and softmax', zooms.map(s => s.zoom + s.li).join());
ok(zooms.every(z => P.segs[z.i - 1].kind === 'flow' && P.segs[z.i - 1].li === z.li), 'each zoom comes right after the flow of its layer');
ok(P.segs.every(s => s.section === (s.kind === 'answer' ? 'out' : SECTION_OF[s.li])), 'each segment names its explainer section');
ok(P.stops.length === 12 && P.stops.every((s, i) => s.li === i), 'one stop for each layer', P.stops.map(s => s.li).join());
ok(Math.abs(P.stops[11].t1 - P.total) < 1e-9, 'the last stop holds the answer');
ok(P.segs.filter(s => s.kind !== 'answer').every(s => s.cap && s.cap.length > 20), 'each segment has a caption');
let threw = false; try { tourPlan({ zooms: { conv: 2 } }); } catch (e) { threw = true; }
ok(threw, 'a zoom on a layer of another type is an error');
const half = tourPlan({ pace: 0.5 });
ok(Math.abs(half.total - P.total / 2) < 1e-9, 'pace scales the run');
const skip = tourPlan({ skip: new Set([2, 4, 7, 9]), zooms: { conv: 3, relu: 7, pool: 10, dense: 11 } });
ok(!skip.segs.some(s => s.kind === 'flow' && [2, 4, 7, 9].includes(s.li)) && skip.segs.some(s => s.kind === 'zoom' && s.li === 7), 'skip leaves flows out but keeps a zoom there');

// segAt and flowState
ok(segAt(P, 0).seg.li === 0 && segAt(P, 0).seg.kind === 'flow', 'time 0 is the input flow');
ok(segAt(P, P.total + 5).seg.kind === 'answer', 'past the end is the answer');
const mid = P.segs[3];
ok(segAt(P, mid.t0 + mid.sec / 2).i === 3 && Math.abs(segAt(P, mid.t0 + mid.sec / 2).k - 0.5) < 1e-9, 'segAt finds the segment and the fraction');
const fs1 = flowState(P, P.stops[5].t0 + 0.5);
ok(fs1.li === 5 && fs1.k > 0 && fs1.k < 1 && fs1.barT === 0 && !fs1.answer, 'flow state in Max pool 1', JSON.stringify(fs1));
const out = P.segs.find(s => s.kind === 'flow' && s.li === 11);
ok(flowState(P, out.t0 + 0.05).barT === 0 && flowState(P, out.t1 - 0.01).barT === 1, 'the bars grow during the output flow');
ok(flowState(P, out.t1 - 0.01).win > 0.9, 'the winner lights up at the end of the output flow');
ok(flowState(P, P.total - 0.1).answer && flowState(P, P.total).ended, 'the answer at the end');
ok(P.segs.filter(s => s.li < 11).every(s => flowState(P, s.t0 + s.sec / 2).barT === 0), 'no bar grows before the output');

// zoomF: closed at the edges, open in the middle
const z = zooms[0];
ok(zoomF(z, 0) === 0 && zoomF(z, z.sec) === 0 && zoomF(z, z.sec / 2) === 1, 'a zoom opens and closes');
ok(zoomF(z, EXPAND_SEC / 2) > 0.2 && zoomF(z, EXPAND_SEC / 2) < 0.8, 'the zoom grows over EXPAND_SEC');
ok(zoomF(z, 0.01, true) === 1, 'reduced motion: the zoom is open at once');
ok(zoomF(P.segs[0], 1) === 0, 'a flow segment has no zoom');

// the clock
const C = createClock(P);
ok(C.t === 0 && !C.playing, 'the clock starts paused at 0');
C.tick(1); ok(C.t === 0, 'a paused clock does not move');
C.play(); C.tick(1); ok(Math.abs(C.t - 1) < 1e-9, 'tick moves a playing clock');
C.speed = 2; C.tick(1); ok(Math.abs(C.t - 3) < 1e-9, 'speed 2 moves twice as fast');
C.speed = 1;
const seen = []; C.seek(0); C.play();
while (C.playing) { C.tick(0.05); const s = C.at().seg; if (seen[seen.length - 1] !== s.li) seen.push(s.li); }
ok(seen.join() === '0,1,2,3,4,5,6,7,8,9,10,11' && C.ended, 'a full run visits every layer in order and ends', seen.join());
ok(!C.playing && C.t === P.total, 'the clock stops at the end');
C.play(); ok(C.t === 0 && C.playing, 'play after the end starts again');
C.pause(); C.seek(P.stops[4].t0 + 1);
C.step(1); ok(C.at().seg.li === 5 && Math.abs(C.t - P.stops[5].t0) < 1e-9, 'step on goes to the next layer');
C.step(-1); ok(C.at().seg.li === 4, 'step back from the start of a layer goes to the layer before');
C.seek(P.stops[6].t0 + 1.2); C.step(-1); ok(Math.abs(C.t - P.stops[6].t0) < 1e-9, 'step back inside a layer goes to its start');
C.seek(P.stops[11].t0 + 0.1); C.step(1); ok(C.ended, 'step on from the output goes to the end');
C.seek(-4); ok(C.t === 0, 'seek clamps to 0');
ok(C.stopOf(8).t0 === P.stops[8].t0 && C.stopOf(12) === null, 'stopOf finds the stop of a layer');

// a real result: the busy map, the scan start, the scan, the captions
const W = parseWeights(fs.readFileSync(path.join(HERE, '../model/weights.bin')));
const bin = fs.readFileSync(path.join(HERE, '../examples/examples.bin'));
const res = forward(W, exampleRGB(bin, 14));
ok(res.label === EXAMPLES[14].cls, 'example 14 is classified as its class', res.label);
const c1 = busyMap(res, 1, 0), L1 = res.layers[1];
ok(c1 >= 0 && c1 < 10, 'busyMap gives a channel', String(c1));
const st = zoomStart(res, 1, c1), y = Math.floor(st / L1.W), x = st % L1.W;
let best = -Infinity, bi = 0; for (let i = 0; i < L1.H * L1.W; i++) { const v = L1.data[i * 10 + c1]; if (v > best) { best = v; bi = i; } }
ok(y === Math.floor(bi / L1.W) && x === Math.max(0, bi % L1.W - 4), 'the scan starts left of the strongest value', `${y},${x} vs ${bi}`);
ok(scanAt(z, 0, st, L1.H * L1.W) === st, 'the scan waits while the column opens');
ok(scanAt(z, z.sec - 0.1, st, L1.H * L1.W) > st + 5, 'the scan moves during the zoom');
ok(Number.isInteger(scanAt(z, 3.3, st, L1.H * L1.W, true)), 'reduced motion: the scan jumps whole cells');
const dz = zooms[3];
ok(scanAt(dz, 0) === 0 && scanAt(dz, dz.sec - EXPAND_SEC) === 0.999 && scanAt(dz, dz.sec / 2) > 0.2, 'the softmax scene plays once and holds on the probabilities');
ok(scanAt(dz, 0.1, 0, 0, true) === 0.999, 'reduced motion: the softmax scene shows the end');
ok(/16 × 16/.test(P.segs.find(s => s.li === 10).cap) && receptiveField(10, 0, 0).pop().size === 16, 'Max pool 2 caption: 16 × 16');
ok(/14 × 14/.test(P.segs.find(s => s.li === 8).cap) && receptiveField(8, 0, 0).pop().size === 14, 'Conv 2·2 caption: 14 × 14');
ok(/10 × 10/.test(P.segs.find(s => s.li === 6).cap) && receptiveField(6, 0, 0).pop().size === 10, 'Conv 2·1 caption: 10 × 10');
const a = answerText(res);
ok(a.cls === res.label && /%$/.test(a.p), 'answerText names the top class', JSON.stringify(a));
ok(captionOf(P.segs[P.segs.length - 1], res) === `It sees ${a.cls}, ${a.p}.`, 'the answer caption');
ok(Object.keys(DEFAULT_ZOOMS).every(k => ARCH[DEFAULT_ZOOMS[k]].type === k), 'the default zooms name layers of their kind');

console.log(`tour: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
