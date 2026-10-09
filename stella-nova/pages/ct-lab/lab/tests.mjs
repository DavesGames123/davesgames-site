// lab/tests.mjs - node checks for the CT lab glue (presets, scan session, MAR, jobs,
// gantry drawing on a stub context, picture import). Run: node stella-nova/pages/ct-lab/lab/tests.mjs
import fs from 'node:fs';
import { DEFAULTS, PRESETS, GROUPS, WINDOWS, paramsFor, workFor, presetById } from './presets.js';
import { buildPhantom, buildGeometry, simulate, Session, metalReduce, pasteMetal, deadPixelList, imageRange } from './scanner.js';
import { runJob, compareTasks } from './jobs.js';
import { windowRange, huOf, muOf, MU_WATER, drawGantry, drawResidual, paintImage, paintSigned } from './view.js';
import { starterShapes, shapeFromDrag, hitShape, imageToPhantom, DRAW_WIDTH } from './draw.js';
import { PHANTOMS_2D, rmse } from '../engine/index.js';
import * as CM from '../colormaps/maps.js';
import { TARGETS, PANEL_TARGET, QUICK, targetOf, mapOf, mapPartial, encodeMaps, decodeMaps, mapNames } from './colour.js';
import { PRESET_MAPS } from './presets.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok  ', msg); } else { fail++; console.log('  FAIL', msg); } };

console.log('presets');
ok(PRESETS.length >= 16, `${PRESETS.length} presets (need 16)`);
ok(new Set(PRESETS.map((p) => p.id)).size === PRESETS.length, 'preset ids are unique');
const phKeys = new Set(PHANTOMS_2D.map((p) => p.key).concat(['custom']));
ok(PRESETS.every((p) => phKeys.has(paramsFor(p.id).phantom)), 'every preset names a known phantom');
ok(PRESETS.every((p) => GROUPS.some((g) => g[0] === p.group)), 'every preset is in a gallery group');
ok(PRESETS.every((p) => { const w = paramsFor(p.id).window; return typeof w !== 'string' || WINDOWS.some((x) => x.id === w); }), 'every preset window exists');
const api = fs.readFileSync(new URL('../LAB-API.md', import.meta.url), 'utf8');
ok(PRESETS.every((p) => api.includes('`' + p.id + '`')), 'LAB-API.md lists every preset id');
const need = ['shepp-logan', 'sparse-18', 'sparse-36', 'sparse-90', 'limited-90', 'limited-120', 'low-dose', 'high-dose', 'beam-hardening',
  'metal-streaks', 'metal-mar', 'rings', 'motion', 'fan-flat', 'filters', 'algorithms', 'tv-sparse', 'walnut', 'suitcase', 'chest-lung',
  'head-brain', 'head-bone', 'bars', 'contrast-detail', 'custom'];
ok(need.every((id) => presetById(id).id === id), 'the requested experiments all exist');
ok(presetById('nope').id === 'shepp-logan', 'an unknown id falls back to shepp-logan');
ok(workFor(DEFAULTS, { ...DEFAULTS, views: 90 }) === 'scan' && workFor(DEFAULTS, { ...DEFAULTS, filter: 'hann' }) === 'recon'
  && workFor(DEFAULTS, { ...DEFAULTS, cmap: 'magma' }) === 'draw', 'workFor picks scan / recon / draw');

console.log('windows and HU');
ok(Math.abs(huOf(MU_WATER)) < 1e-9 && Math.abs(huOf(0) + 1000) < 1e-9, 'water is 0 HU, air is -1000 HU');
ok(Math.abs(muOf(huOf(0.3)) - 0.3) < 1e-9, 'muOf inverts huOf');
const wb = windowRange('brain', true, { lo: 0, hi: 1 });
ok(Math.abs(huOf(wb.lo) - 0) < 1e-6 && Math.abs(huOf(wb.hi) - 80) < 1e-6, 'brain window spans 0..80 HU');
ok(windowRange('brain', false, { lo: 0, hi: 1 }).id === 'auto', 'an HU window on Shepp-Logan falls back to full range');

console.log('every preset through the pipeline (n = 96)');
const scans = {};
for (const pr of PRESETS) {
  const p = { ...paramsFor(pr.id), n: 96 };
  const ph = buildPhantom(p, { shapes: starterShapes(), width: DRAW_WIDTH });
  const g = buildGeometry(p, ph.image);
  const sc = await simulate(ph, g, p);
  const ses = new Session({ phantom: ph, geom: g, scan: sc, params: p });
  let steps = 0; while (!ses.done) { ses.advance(7); steps++; }
  const finite = ses.recon.data.every(Number.isFinite) && sc.sino.data.every(Number.isFinite);
  scans[pr.id] = { p, ph, g, sc, ses };
  ok(finite && steps === Math.ceil(g.nAngles / 7) && g.nAngles === Math.max(1, p.views), `${pr.id}: ${g.nAngles} views, ${g.nDet} det, finite`);
}

console.log('scan behaviour');
{
  const a = scans['shepp-logan'].ses, m = a.metrics();
  ok(m.psnr > 24, `Shepp-Logan FBP at 96: PSNR ${m.psnr.toFixed(2)} dB > 24`);
  const s18 = scans['sparse-18'].ses.metrics().psnr, s90 = scans['sparse-90'].ses.metrics().psnr;
  ok(s18 < s90 && s90 <= m.psnr + 0.5, `fewer views, lower PSNR: 18 -> ${s18.toFixed(1)}, 90 -> ${s90.toFixed(1)}, 360 -> ${m.psnr.toFixed(1)}`);
  // noise = FBP of the noisy scan minus FBP of the clean scan
  const noise = (id) => {
    const s = scans[id], c = new Session({ phantom: s.ph, geom: s.g, scan: { ...s.sc, sino: s.sc.clean }, params: s.p });
    c.fullFBP(); return rmse(c.recon.data, s.ses.recon.data);
  };
  const nLo = noise('low-dose'), nHi = noise('high-dose');
  ok(nLo > 5 * nHi, `noise falls with dose: low ${huOf(MU_WATER + nLo).toFixed(1)} HU, high ${huOf(MU_WATER + nHi).toFixed(1)} HU rms (ratio ${(nLo / nHi).toFixed(1)}, sqrt(100) = 10)`);
  const L120 = scans['limited-120'].ses.metrics().psnr, L90 = scans['limited-90'].ses.metrics().psnr;
  ok(L90 < L120, `limited angle 90 (${L90.toFixed(1)}) worse than 120 (${L120.toFixed(1)})`);
  const ring = scans.rings;
  const dead = deadPixelList(ring.g.nDet, 1)[0];
  let z = 0; for (let a2 = 0; a2 < ring.g.nAngles; a2++) z += ring.sc.sino.data[a2 * ring.g.nDet + dead] === 0 ? 1 : 0;
  ok(z === ring.g.nAngles, `rings: dead element ${dead} reads 0 in all ${z} views`);
  // partial FBP equals the full FBP when every view has arrived
  const b = scans['fan-flat'].ses, partial = Float32Array.from(b.recon.data);
  b.fullFBP();
  ok(rmse(partial, b.recon.data) < 1e-6, 'FBP built view by view equals the one-shot FBP');
  // the angle advances with the views
  const c = scans['sparse-36'].ses; c.reset(); c.advance(10);
  ok(Math.abs(c.angle() - c.geom.angles[9]) < 1e-7 && c.view === 10, 'angle() follows the last acquired view');
  // beam hardening: the centre of the water disc reads lower than the edge
  const bh = scans['beam-hardening'], img = bh.ses.recon, n = img.nx;
  const at = (x, y) => img.data[Math.round(y) * n + Math.round(x)];
  let cen = 0, edge = 0;
  for (let k = -2; k <= 2; k++) { cen += at(n / 2 + k, n / 2 + 8); edge += at(n / 2 + k, n * 0.93); }
  ok(cen < edge, `cupping: centre ${(cen / 5).toFixed(4)} < edge ${(edge / 5).toFixed(4)} /cm`);
  ok(scans['beam-hardening'].sc.spectrum.calibration > 0.5 && scans['beam-hardening'].sc.spectrum.calibration < 1.5, `water calibration factor ${scans['beam-hardening'].sc.spectrum.calibration.toFixed(3)}`);
}

console.log('metal artefact reduction (n = 192)');
{
  const p = { ...paramsFor('metal-streaks'), n: 192 };
  const ph = buildPhantom(p), g = buildGeometry(p, ph.image), sc = await simulate(ph, g, p);
  const ses = new Session({ phantom: ph, geom: g, scan: sc, params: p });
  ses.fullFBP();
  const first = { ...ses.recon, data: Float32Array.from(ses.recon.data) };
  const m = metalReduce(sc.sino, g, first);
  ses.sino = m.sino; ses.prepare(); ses.fullFBP(); pasteMetal(ses.recon, first, m.mask);
  // error in soft tissue only: away from metal and bone, inside the body
  let e0 = 0, e1 = 0, cnt = 0;
  const t = ph.image.data;
  for (let k = 0; k < t.length; k++) {
    if (m.mask.data[k] || t[k] < 0.15 || t[k] > 0.25) continue;
    e0 += (first.data[k] - t[k]) ** 2; e1 += (ses.recon.data[k] - t[k]) ** 2; cnt++;
  }
  const r0 = Math.sqrt(e0 / cnt), r1 = Math.sqrt(e1 / cnt);
  ok(m.metal > 0, `MAR finds ${m.metal} metal pixels`);
  ok(r1 < r0, `MAR lowers the soft-tissue error: ${huOf(MU_WATER + r0).toFixed(0)} -> ${huOf(MU_WATER + r1).toFixed(0)} HU rms`);
  const none = metalReduce(scans['shepp-logan'].sc.sino, scans['shepp-logan'].g, scans['shepp-logan'].ses.recon);
  ok(none.metal === 0 && none.sino === scans['shepp-logan'].sc.sino, 'MAR leaves a scan without metal alone');
}

console.log('jobs');
{
  const s = scans['algorithms'];
  const msgs = [];
  await runJob({ type: 'iter', id: 1, method: 'sirt', sino: s.sc.sino, geom: s.g, dims: s.ses.dims, truth: s.ph.image, iterations: 12 }, (m) => msgs.push(m));
  const it = msgs.filter((m) => m.type === 'iter');
  ok(it.length === 12 && msgs[msgs.length - 1].type === 'done', 'SIRT job posts 12 iterations and done');
  ok(it.every((m, k) => k === 0 || m.residual <= it[k - 1].residual * 1.0001), 'SIRT residual does not rise');
  ok(msgs[msgs.length - 1].psnr > 0 && it[11].psnr > it[0].psnr, `SIRT PSNR rises: ${it[0].psnr.toFixed(1)} -> ${it[11].psnr.toFixed(1)} dB`);
  // pause and step
  const ctl = { allowance: 0 }, got = [];
  const job = runJob({ type: 'iter', id: 2, method: 'cgls', sino: s.sc.sino, geom: s.g, dims: s.ses.dims, truth: s.ph.image, iterations: 5 }, (m) => got.push(m), () => false, ctl);
  await new Promise((r) => setTimeout(r, 80));
  const held = got.length;
  ctl.allowance = 2;
  await new Promise((r) => setTimeout(r, 120));
  const stepped = got.filter((m) => m.type === 'iter').length;
  ctl.allowance = Infinity; await job;
  ok(held === 0 && stepped === 2 && got.filter((m) => m.type === 'iter').length === 5, `pause holds (${held}), step runs 2 (${stepped}), play finishes 5`);
  const tiles = [];
  await runJob({ type: 'compare', id: 3, tasks: compareTasks('filters', DEFAULTS), sino: s.sc.sino, geom: s.g, dims: s.ses.dims, truth: s.ph.image }, (m) => tiles.push(m));
  ok(tiles.filter((m) => m.type === 'tile').length === 5, 'filter compare posts five tiles');
  ok(compareTasks('algorithms', DEFAULTS).length === 4 && compareTasks('', DEFAULTS).length === 0, 'algorithm compare has four tasks');
  const err = []; await runJob({ type: 'iter', id: 4, method: 'nope', sino: s.sc.sino, geom: s.g, dims: s.ses.dims, iterations: 1 }, (m) => err.push(m));
  ok(err[0].type === 'error', 'an unknown solver posts an error, not a throw');
}

console.log('drawing');
{
  const calls = { n: 0 };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => { calls.n++; })), set: (t, k, v) => { t[k] = v; return true; } });
  for (const id of ['shepp-logan', 'fan-flat', 'fan-arc']) {
    const s = scans[id];
    let bad = false;
    const orig = ctx.lineTo;
    ctx.lineTo = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) bad = true; };
    ctx.moveTo = ctx.lineTo;
    drawGantry(ctx, { cx: 200, cy: 200, R: 190 }, 380 / s.ph.image.width * 0.6, s.g, 5, s.sc.sino, imageRange(s.sc.sino).hi);
    ctx.lineTo = orig;
    ok(!bad, `gantry for ${id} draws finite points`);
  }
  drawResidual(ctx, 0, 0, 100, 30, [3, 2, 1, 0.5], 10);
  ok(calls.n > 10, 'residual plot and gantry issue canvas calls');
  const rgba = new Uint8ClampedArray(96 * 96 * 4);
  paintImage(scans['shepp-logan'].ses.recon.data, 0, 1, rgba, 'grey');
  ok(rgba[3] === 255, 'paintImage writes opaque pixels');
  paintSigned(scans['shepp-logan'].ses.recon.data, scans['shepp-logan'].ph.image.data, 0.2, rgba, 'coolwarm');
  ok(CM.has('coolwarm') && rgba[3] === 255, 'paintSigned uses the diverging map');
  const d = shapeFromDrag('disc', 1, 2, 4, 6, 'bone');
  ok(d.a === 5 && d.x === 1 && hitShape([d], 1, 2) === 0 && hitShape([d], 9, 9) === -1, 'disc from a drag and hit test');
  const e = shapeFromDrag('ellipse', -2, -1, 2, 3, 'fat');
  ok(e.a === 2 && e.b === 2 && e.x === 0 && e.y === 1, 'ellipse from a drag box');
  const px = new Uint8ClampedArray(16 * 16 * 4).fill(255);
  const up = imageToPhantom(px, 16);
  ok(Math.abs(up.image.data[0] - (up.basis.water.data[0] * MU_WATER + up.basis.bone.data[0] * 0.5023)) < 0.01, 'white picture pixel becomes bone, with a matching basis');
}


// ---- colour targets (lab/colour.js) ----
{
  ok(Object.keys(PRESET_MAPS).every((id) => PRESETS.some((p) => p.id === id)), 'every PRESET_MAPS key is a preset');
  ok(PRESETS.every((p) => { const q = paramsFor(p.id); return CM.has(q.cmap) && CM.has(q.sinoMap) && CM.get(q.diffMap).kind === 'diverging'; }), 'every preset has known maps and a diverging error map');
  ok(Object.values(QUICK).flat().every((id) => CM.has(id)) && QUICK.diff.every((id) => CM.get(id).kind === 'diverging'), 'quick swatches are real maps; the error row is diverging');
  ok(targetOf('sinogram') === 'sino' && targetOf('phantom') === 'image' && targetOf('3d') === 'v3d' && targetOf('viridis') === null, 'targetOf maps panel names, not map ids');
  ok(CM.ids().every((id) => !(id in PANEL_TARGET)), 'no map id is also a panel name');
  // hash round trip over many random choices
  let good = 0, R = 12345;
  const rnd = () => { R = (R * 1103515245 + 12345) >>> 0; return R / 4294967296; };
  for (let k = 0; k < 400; k++) {
    let p = paramsFor(PRESETS[Math.floor(rnd() * PRESETS.length)].id);
    for (const t of Object.keys(TARGETS)) {
      const pool = CM.list().filter((m) => TARGETS[t].groups.includes(m.group));
      p = { ...p, ...mapPartial(t, pool[Math.floor(rnd() * pool.length)].id, { reverse: rnd() < 0.3, gamma: rnd() < 0.5 ? 1 : 0.4 + rnd() * 2 }) };
    }
    const back = { ...DEFAULTS, ...decodeMaps('#preset=x' + encodeMaps(p)) };
    if (Object.keys(TARGETS).every((t) => JSON.stringify(mapOf(back, t)) === JSON.stringify(mapOf(p, t)))) good++;
  }
  ok(good === 400, `share hash round-trips 400 random map sets (${good})`);
  ok(encodeMaps(paramsFor('walnut'), paramsFor('walnut')) === '', 'the hash leaves out maps equal to the preset maps');
  const d = decodeMaps('#preset=a&cmap=nope&diff=viridis&sino=mako~r~g9');
  ok(d.cmap === 'grey' && d.diffMap === 'coolwarm' && d.sinoMap === 'mako' && d.sinoReverse && d.sinoGamma === 3, 'bad hash maps fall back, gamma is clamped');
  const keep = mapPartial('image', 'magma', {}, { cmap: 'grey', cmapReverse: true, cmapGamma: 2 });
  ok(keep.cmapReverse === true && keep.cmapGamma === 2, 'mapPartial keeps reverse and gamma when absent');
  ok(/Images .* · Sinogram .* · Error /.test(mapNames(DEFAULTS)), 'mapNames names the three 2D maps');
  // signed paint: gamma keeps zero at the centre and the sign of the error
  const a = new Float32Array([0.1, -0.1, 0, 0.05]), b = new Float32Array(4), out = new Uint8ClampedArray(16);
  paintSigned(a, b, 0.1, out, 'coolwarm', null, { gamma: 2 });
  const mid = CM.sample('coolwarm', 0.5), hi = CM.sample('coolwarm', 1), lo = CM.sample('coolwarm', 0);
  ok(out[8] === mid[0] && out[0] === hi[0] && out[4] === lo[0], 'signed paint with gamma keeps 0 at the centre and the ends');
  paintSigned(a, b, 0.1, out, 'coolwarm', null, { reverse: true });
  ok(out[0] === lo[0] && out[4] === hi[0], 'signed paint reverse swaps the ends');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
