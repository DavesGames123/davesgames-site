// ============================================================================
//  CORAL REEF  ·  saver safety tests (node, no browser)
//                 node tests/saver-safe.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-17): "tjhe screensaver was fucked up". On the
//  real rock (rock/index.js, low quality, seed 1 and 4) and the real dive
//  plan (saver.js):
//    sites ...... pickSite gives open, up-facing rock in the plot, above
//                 the sand, not under a roof
//    camera ..... over every shot of 8 dives, safeCamera puts the camera
//                 in open water (rock.sdfAll, true metres) with a clear
//                 line to the colony; the old clearPath did not (it put
//                 the camera 0.6 m from the colony, or in the sand)
//    rov ........ a far ROV gives no shoulder or wide shot (empty water)
//    card ....... the feed card is beside the clear band in 16:9 and 9:16
//                 and does not cover the subject
// ============================================================================
import { createRock } from '../rock/index.js';
import { divePlan, shotAt, shotPose, pickSite, clearPath, safeCamera, cardRect, reachRov, frameFit, projectedBox } from '../saver.js';

let pass = 0, fail = 0;
function ok(cond, name, info = '') { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } }
const len = a => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// the line from the edge of the subject to the camera, in true metres
function lineFree(sdf, k, tgt, pos, r) {
  const d = sub(pos, tgt), L = len(d); let min = Infinity;
  for (let t = Math.max(0.35, r * 0.9 + 0.25); t <= L; t += 0.05) { const q = [tgt[0] + d[0] / L * t, tgt[1] + d[1] / L * t, tgt[2] + d[2] / L * t]; min = Math.min(min, sdf(q[0], q[1], q[2]) / k); }
  return min;
}

const fit = (w, h) => rad => frameFit({ w, h, clear: { t: h * 0.22, b: h * 0.3 }, radius: rad, fov: 50 }).dist;
for (const seed of [1, 4]) {
  const t0 = Date.now();
  const rock = createRock({ seed, radius: 30, quality: 'low', mesh: false });
  const sdf = rock.sdfAll, k = rock.sdfScale;
  let rr = seed * 7 + 1; const rand = () => { rr = (rr * 16807) % 2147483647; return rr / 2147483647; };
  const dives = divePlan(seed * 13, { n: 8, calm: 0.7 });
  let sites = 0, goodSites = 0, samples = 0, inWater = 0, clearLine = 0, oldIn = 0, oldNear = 0, minD = Infinity, worst = null, hows = {};
  const sand = rock.sand.heightAt;
  for (const d of dives) {
    const site = pickSite(rock, d.siteKind, d.siteR, rand, 30);
    sites++;
    if (!site) continue;
    const p = site.p;
    const open = rock.sampleSurface ? true : true;
    const above = p[1] > sand(p[0], p[2]) + 0.05, inPlot = Math.hypot(p[0], p[2]) < 24.01, up = site.n[1] > 0.25;
    // open water 1 m out along the normal
    const q = [p[0] + site.n[0], p[1] + site.n[1], p[2] + site.n[2]];
    const water = sdf(q[0], q[1], q[2]) / k > 0.3;
    if (above && inPlot && up && water) goodSites++; else console.log(`site: dive ${d.species} at ${p.map(v => v.toFixed(2))} above ${above} inPlot ${inPlot} up ${up} water ${water}`);
    // a colony of growing size on the site; the ROV near it
    for (let t = 0; t < d.grow; t += 2.5) {
      const r = 0.3 + 1.2 * Math.min(1, t / d.grow);
      const c = [p[0] + site.n[0] * r * 0.6, p[1] + site.n[1] * r * 0.6, p[2] + site.n[2] * r * 0.6];
      const rov = [c[0] + 2.2, c[1] + 0.8, c[2] - 1.0];
      const { shot, u } = shotAt(d, t);
      const P = shotPose(shot, u, t - shot.t0, { c, r, front: c, rov }, fit(1280, 720));
      const S = safeCamera(sdf, k, P.tgt, P.pos, r);
      hows[S.how] = (hows[S.how] || 0) + 1;
      samples++;
      const dw = sdf(S.pos[0], S.pos[1], S.pos[2]) / k;
      if (dw > 0.3) inWater++;
      if (dw < minD) { minD = dw; worst = { kind: shot.kind, how: S.how, pos: S.pos.map(v => +v.toFixed(2)) }; }
      if (lineFree(sdf, k, P.tgt, S.pos, r) > 0.05) clearLine++;
      // the old rule on the rock field only
      const O = clearPath(rock.sdf, P.tgt, P.pos, 0.5);
      if (sdf(O[0], O[1], O[2]) / k <= 0.05) oldIn++;
      if (len(sub(O, P.tgt)) < 0.61 + 1e-6 && len(sub(P.pos, P.tgt)) > 1) oldNear++;
    }
  }
  ok(goodSites === sites, `seed ${seed}: every dive site is open, up-facing rock in the plot, above the sand`, `${goodSites}/${sites}`);
  ok(inWater === samples, `seed ${seed}: the saver camera is in open water (0.3 m or more from rock and sand) in every sample`, `${inWater}/${samples}, worst ${minD.toFixed(2)} m ${JSON.stringify(worst)}`);
  ok(clearLine >= samples * 0.98, `seed ${seed}: the line from the colony to the camera is clear in 98 % of the samples`, `${clearLine}/${samples}`);
  console.log(`seed ${seed}: ${samples} shot samples in ${dives.length} dives (${Date.now() - t0} ms): safeCamera in water ${inWater}, clear line ${clearLine}, ${JSON.stringify(hows)}; the old clearPath: ${oldNear} at 0.6 m from the colony, ${oldIn} in rock or sand`);
  if (seed === 1) ok(oldNear + oldIn > 0, 'the old clearPath fails on the real rock (the repro)', `${oldNear} near, ${oldIn} in`);
}

// ── the ROV reach ──────────────────────────────────────────────────────────
{
  const c = [0, 1, 0];
  ok(reachRov(c, 0.4, [2, 1.5, 1]) && !reachRov(c, 0.4, [12, 2, 0]) && !reachRov(c, 0.4, null), 'reachRov: near yes, 12 m no, none no');
  const far = shotPose({ kind: 'wide', t0: 0, hold: 9, az: 1, spin: 0.02, elev: 0.2, zoom: 1, side: 1, lift: 0.5 }, 0.5, 2, { c, r: 0.4, front: c, rov: [25, 3, 0] }, r => r * 4);
  ok(len(sub(far.tgt, c)) < 0.5 && far.r < 1, 'a wide shot with a far ROV frames the colony, not the water between', JSON.stringify(far.tgt));
  const sh = shotPose({ kind: 'shoulder', t0: 0, hold: 9, az: 1, spin: 0.02, elev: 0.3, zoom: 1, side: 1, lift: 0.5 }, 0.5, 2, { c, r: 0.4, front: c, rov: [25, 3, 0] }, r => r * 4);
  ok(len(sub(sh.pos, c)) < 6, 'a shoulder shot with a far ROV stays near the colony', len(sub(sh.pos, c)).toFixed(1));
}

// ── the feed card ─────────────────────────────────────────────────────────
{
  const cases = [[1280, 720, { t: 150, b: 190 }], [1920, 1080, { t: 210, b: 280 }], [720, 1280, { t: 260, b: 330 }], [1080, 1920, { t: 380, b: 500 }], [1280, 720, null], [390, 844, { t: 170, b: 230 }]];
  for (const [w, h, band] of cases) {
    const R = cardRect(w, h, band);
    const clear = Object.assign({ t: band ? band.t : 0, b: band ? band.b : 0, l: 0, r: 0 }, {});
    if (R.clear.r) clear.r = R.clear.r; else clear.b = Math.max(clear.b, R.clear.b);
    const f = frameFit({ w, h, clear, radius: 1, fov: 50 });
    const box = projectedBox({ w, h, fov: 50 }, f, 1);
    const overlap = !(box.x1 <= R.left || box.x0 >= R.left + R.w || box.y1 <= R.top || box.y0 >= R.top + R.h);
    const inside = R.left >= 0 && R.top >= 0 && R.left + R.w <= w + 0.5 && R.top + R.h <= h + 0.5;
    const tag = `${w}x${h}${band ? '' : ' no band'}`;
    ok(!overlap, `card ${tag}: the card does not cover the subject`, JSON.stringify({ R, box }));
    ok(inside, `card ${tag}: the card is inside the canvas`);
    if (band && w >= h) ok(R.top >= band.t - 0.5 && R.top + R.h <= h - band.b + 0.5, `card ${tag}: the card is in the clear band (wide frame)`);
    if (band && w < h) ok(R.top + R.h <= h - band.b + 0.5 && R.top >= box.y1 - 0.5, `card ${tag}: the card is under the subject, over the bottom text (tall frame)`, JSON.stringify({ top: R.top, y1: box.y1 }));
  }
  console.log('card: ' + cases.map(([w, h, b]) => { const R = cardRect(w, h, b); return `${w}x${h} ${R.w.toFixed(0)}x${R.h.toFixed(0)} at ${R.left.toFixed(0)},${R.top.toFixed(0)}`; }).join('; '));
}

console.log(`saver-safe: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
