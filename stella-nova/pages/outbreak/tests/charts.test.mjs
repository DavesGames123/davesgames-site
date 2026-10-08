// charts: tick, scale and format helpers; draw() with a stub 2D context
import { niceStep, linTicks, logTicks, makeScale, fmtCount, yRange, stride,
  policyMarks, createChart, SERIES } from '../charts.js';

export default function (ok) {
  ok('charts: niceStep 1-2-5', niceStep(100, 5) === 20 && niceStep(1000, 4) === 200 && niceStep(7, 5) === 1, [niceStep(100, 5), niceStep(1000, 4), niceStep(7, 5)].join());
  const t = linTicks(0, 365, 4);
  ok('charts: linTicks inside range and even', t[0] === 0 && t.at(-1) <= 365 && t.every((v, i) => !i || Math.abs(v - t[i - 1] - (t[1] - t[0])) < 1e-9), t.join());
  ok('charts: logTicks decades', logTicks(1, 1e4).join() === '1,10,100,1000,10000');
  ok('charts: logTicks thins wide ranges', logTicks(1, 1e10).length === 6, logTicks(1, 1e10).join());
  const sl = makeScale(1, 1e4, 100, 0, true);
  ok('charts: log scale maps ends and middle', sl(1) === 100 && sl(1e4) === 0 && Math.abs(sl(100) - 50) < 1e-9);
  ok('charts: log scale clamps zero', sl(0) === 100);
  const s = makeScale(0, 10, 0, 200);
  ok('charts: linear scale', s(5) === 100);
  ok('charts: fmtCount', fmtCount(7.66e9) === '7.7bn' && fmtCount(1234) === '1.2k' && fmtCount(3e6) === '3M' && fmtCount(0) === '0', [fmtCount(7.66e9), fmtCount(1234), fmtCount(3e6)].join());
  const h = { day: [0, 1, 2], S: [100, 90, 50], I: [1, 10, 40], reff: [2, 2, 0.8] };
  const lr = yRange(h, ['S', 'I'], true), ln = yRange(h, ['S', 'I'], false);
  ok('charts: yRange log and linear', lr[0] === 1 && lr[1] === 100 && ln[0] === 0 && Math.abs(ln[1] - 105) < 1e-9, lr + ' ' + ln);
  ok('charts: yRange empty', yRange({ day: [] }, ['I'], false)[1] === 1);
  ok('charts: stride', stride(1500, 500) === 3 && stride(10, 500) === 1);
  const m = policyMarks({ masks: 40, distancing: 12, travel: undefined }, { masks: 'Masks' });
  ok('charts: policyMarks sorted, labelled, skips unset', m.length === 2 && m[0].id === 'distancing' && m[1].label === 'Masks');
  ok('charts: SERIES has six compartments', SERIES.map(x => x.key).join('') === 'SEIRDV');

  // stub canvas: count strokes
  let strokes = 0;
  const ctx = new Proxy({}, { get: (o, k) => k in o ? o[k] : (k === 'stroke' ? () => { strokes++; } : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const canvas = { clientWidth: 600, clientHeight: 120, width: 0, height: 0, getContext: () => ctx };
  const c = createChart(canvas);
  const H = { day: [], S: [], E: [], I: [], R: [], D: [], V: [], reff: [] };
  for (let d = 0; d < 200; d++) { H.day.push(d); H.S.push(1e6 - d * 10); H.E.push(d); H.I.push(d * 2); H.R.push(d * 5); H.D.push(d / 10); H.V.push(0); H.reff.push(2 - d / 100); }
  const drew = c.draw(H, { distancing: 30 }, { id: 'flu', latent: 2 });
  ok('charts: draw paints and sizes the canvas', drew === true && strokes > 6 && canvas.width === 600 && canvas.height === 120, `strokes ${strokes}`);
  ok('charts: draw skips an unchanged frame', c.draw(H, { distancing: 30 }, { id: 'flu', latent: 2 }) === false);
  c.setLog(false);
  ok('charts: setLog redraws', c.log === false && c.draw(H, { distancing: 30 }, { id: 'flu', latent: 2 }) === true);
  c.dispose();
  ok('charts: dispose stops drawing', c.draw(H, {}, null) === false);
}
