// ============================================================================
//  PLANET FORGE  ·  tests-studio.mjs — randomizer and render studio checks
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/forge/tests-studio.mjs
//  Each check prints one line; the process exits 1 if a check fails.
//    draws      300 seeds per mode: every number finite, in its SCHEMA or
//               GX_RANGE range, colours in [0, 1]
//    diversity  albedo colour histograms, latitude profiles and height
//               spread of 16 maps per mode (64 x 32); the mean and 10th
//               percentile pair distances must pass the thresholds, and
//               the giants must beat the old Jupiter family
//    mutate, groups, locks, share links, studio jobs, queue, recipes, ZIP
// ============================================================================
import { createRequire } from 'node:module';
import * as PR from './presets.js';
import * as RZ from './randomize.js';
import * as SC from './studio-core.js';
import * as MP from './maps.js';
import { GX_RANGE } from './gasx.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const MODES = RZ.MODES.map(m => m.id);

// ── draws: finite, in range ─────────────────────────────────────────────
{
  const bad = [];
  const finite = (o, path = '') => { for (const k in o) { const v = o[k]; if (typeof v === 'number' && !Number.isFinite(v)) bad.push(path + k); else if (v && typeof v === 'object') finite(v, path + k + '.'); } };
  const rgb = (c, where) => { if (!Array.isArray(c) || c.length !== 3 || c.some(v => !(v >= 0 && v <= 1))) bad.push(where); };
  let n = 0;
  for (const mode of MODES) for (let s = 0; s < 300; s++) {
    const P = RZ.draw(mode, s, s % 2 ? 'jupiter' : 'earth'); n++;
    finite(P);
    for (const [, path, , lo, hi] of [...PR.SCHEMA[P.kind], ...PR.SCHEMA.atmo]) { const v = PR.getPath(P, path); if (!(v >= lo && v <= hi)) bad.push(`${mode}/${s} ${path}=${v}`); }
    if (P.kind === 'gas') {
      for (const [k, [lo, hi]] of Object.entries(GX_RANGE)) { const v = P.gx[k]; if (!(v >= lo && v <= hi)) bad.push(`${mode}/${s} gx.${k}=${v}`); }
      for (const [k, c] of Object.entries(P.gx.col)) if (k === 'spots') c.forEach((q, i) => rgb(q, `${mode}/${s} spot${i}`)); else rgb(c, `${mode}/${s} gx.col.${k}`);
      P.palette.stops.forEach(([t, c], i) => { rgb(c, `${mode}/${s} stop${i}`); if (!(t >= 0 && t <= 1)) bad.push('stop pos'); });
    } else for (const [k, c] of Object.entries(P.palette)) rgb(c, `${mode}/${s} palette.${k}`);
    if (!(P.view && P.view.exposure >= 0.3 && P.view.exposure <= 1.2)) bad.push(`${mode}/${s} exposure`);
    if (mode === 'rocky' && P.kind !== 'rocky' || mode === 'gas' && P.kind !== 'gas') bad.push(`${mode}/${s} kind ${P.kind}`);
  }
  ok('random: 300 draws per mode are finite and in range', bad.length === 0, `${n} draws${bad.length ? ', first: ' + bad.slice(0, 3).join('; ') : ''}`);
  const fams = new Set(); for (let s = 0; s < 300; s++) fams.add(RZ.draw('any', s).preset);
  ok('random: "anything" reaches every family', fams.size === PR.PRESETS.length, `${fams.size} of ${PR.PRESETS.length}`);
  ok('random: a draw is a pure function of mode and seed', JSON.stringify(RZ.draw('gas', 99)) === JSON.stringify(RZ.draw('gas', 99)));
  ok('random: the new families are presets', ['carbon', 'iron', 'eyeball', 'superearth', 'icegiant', 'hotneptune', 'puffy', 'browndwarf', 'ringed', 'exotic'].every(id => PR.presetById(id).id === id));
  ok('random: an old preset keeps its recipe (no gx)', !('gx' in PR.fromPreset('jupiter', 5)) && !('ringx' in PR.fromPreset('saturn', 5)));
  // a few small maps of each kind stay finite
  let nf = 0;
  for (let s = 0; s < 6; s++) { const M = MP.generate(RZ.draw(s % 2 ? 'gas' : 'rocky', 500 + s), 64); for (const k of ['height', 'albedo', 'emissive', 'cloud']) for (const v of M[k]) if (!Number.isFinite(v)) nf++; }
  ok('random: maps of random planets are finite', nf === 0, `${nf} bad texels`);
}

// ── diversity ───────────────────────────────────────────────────────────
const DW = 64, DH = 32;
function feat(P) {
  const M = MP.generate(P, DW), h = new Float64Array(64), prof = new Float64Array(DH); let ws = 0, hm = 0, hs = 0;
  for (let y = 0; y < DH; y++) {
    const w = Math.cos(((y + 0.5) / DH - 0.5) * Math.PI); let rs = 0;
    for (let x = 0; x < DW; x++) { const i = y * DW + x, r = M.albedo[i * 4], g = M.albedo[i * 4 + 1], b = M.albedo[i * 4 + 2]; h[(r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)] += w; ws += w; rs += (r + g + b) / 765; hm += M.height[i]; hs += M.height[i] ** 2; }
    prof[y] = rs / DW;
  }
  for (let k = 0; k < 64; k++) h[k] /= ws;
  const n = DW * DH; hm /= n;
  return { h, prof, hsd: Math.sqrt(Math.max(0, hs / n - hm * hm)) };
}
// 0..1: colour histogram (total variation), latitude profile, height spread
export function planetDistance(a, b) {
  let tv = 0; for (let k = 0; k < 64; k++) tv += Math.abs(a.h[k] - b.h[k]);
  let pd = 0; for (let y = 0; y < DH; y++) pd += Math.abs(a.prof[y] - b.prof[y]);
  return 0.5 * tv * 0.6 + Math.min(1, 3 * pd / DH) * 0.3 + Math.min(1, 4 * Math.abs(a.hsd - b.hsd)) * 0.1;
}
function spread(Ps) {
  const F = Ps.map(feat), d = [];
  for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) d.push(planetDistance(F[i], F[j]));
  d.sort((a, b) => a - b);
  return { mean: d.reduce((a, b) => a + b, 0) / d.length, p10: d[Math.floor(d.length * 0.1)] };
}
{
  const N = 16, f = s => `mean ${s.mean.toFixed(3)} p10 ${s.p10.toFixed(3)}`;
  const oldJ = spread(Array.from({ length: N }, (_, i) => PR.fromPreset('jupiter', 7000 + i)));
  const oldG = spread(Array.from({ length: N }, (_, i) => PR.fromPreset(['jupiter', 'saturn', 'neptune', 'hotjupiter'][i % 4], 7000 + i)));
  console.log(`      before: Jupiter family ${f(oldJ)}; old giants ${f(oldG)}`);
  const TH = { type: [0.3, 0.1], rocky: [0.55, 0.12], gas: [0.55, 0.15], any: [0.6, 0.15] };
  for (const mode of MODES) {
    const s = spread(Array.from({ length: N }, (_, i) => RZ.draw(mode, 7000 + i, 'jupiter')));
    ok(`diversity: ${mode} pairs differ`, s.mean >= TH[mode][0] && s.p10 >= TH[mode][1], `${f(s)} (need ${TH[mode][0]} / ${TH[mode][1]})`);
    if (mode === 'type') ok('diversity: "this type" Jupiter beats the old Jupiter family x1.4', s.mean >= 1.4 * oldJ.mean, `${s.mean.toFixed(3)} vs ${oldJ.mean.toFixed(3)}`);
    if (mode === 'gas') ok('diversity: random giants beat the old giants at the close end', s.p10 >= oldG.p10 * 1.2, `p10 ${s.p10.toFixed(3)} vs ${oldG.p10.toFixed(3)}`);
  }
}

// ── mutate, groups, locks ───────────────────────────────────────────────
{
  const P = RZ.draw('gas', 31), R = RZ.draw('rocky', 32);
  ok('mutate: amount 0 gives the same planet', JSON.stringify(RZ.mutate(P, 0, 5)) === JSON.stringify(P) && JSON.stringify(RZ.mutate(R, 0, 5)) === JSON.stringify(R));
  const d = a => { const A = feat(P), B = feat(RZ.mutate(P, a, 11)); return planetDistance(A, B); };
  const d1 = d(0.1), d9 = d(1);
  ok('mutate: a wild mutation moves further than a small one', d9 > d1, `0.1 -> ${d1.toFixed(3)}, 1 -> ${d9.toFixed(3)}`);
  const M = RZ.mutate(P, 0.5, 12);
  ok('mutate: keeps kind and family', M.kind === P.kind && M.preset === P.preset);
  const G = RZ.rollGroup(P, 'palette', 77);
  ok('groups: palette dice changes the palette only', JSON.stringify(G.palette) !== JSON.stringify(P.palette) && JSON.stringify(G.bands) === JSON.stringify(P.bands) && G.seed === P.seed);
  const N = RZ.draw('type', 900, P.preset), L = RZ.applyLocks(N, P, { palette: true, shape: true });
  ok('locks: locked groups carry over, the rest is new', JSON.stringify(L.palette) === JSON.stringify(P.palette) && L.seed === P.seed && JSON.stringify(L.gx.jets) === JSON.stringify(P.gx.jets) && JSON.stringify(L.atmo) === JSON.stringify(N.atmo));
  ok('locks: another kind ignores the locks', RZ.applyLocks(R, P, { palette: true }) === R && RZ.lockKind({ palette: true }, P) === 'gas');
}

// ── share links ─────────────────────────────────────────────────────────
{
  const P = RZ.draw('any', 4040);
  const h = await RZ.shareHash(P);
  ok('share: a pure draw gives a short link', /^r=any\.4040$/.test(h), h);
  ok('share: the short link round-trips', JSON.stringify(await RZ.readHash('#' + h)) === JSON.stringify(P));
  const T = RZ.draw('type', 17, 'icegiant'), ht = await RZ.shareHash(T);
  ok('share: a "this type" link names the family', ht === 'r=type.17.icegiant' && JSON.stringify(await RZ.readHash(ht)) === JSON.stringify(T), ht);
  const M = RZ.mutate(P, 0.4, 3); M.radiusKm = Math.round(M.radiusKm) + 0.5;
  const hm = await RZ.shareHash(M), back = await RZ.readHash(hm);
  const strip = x => { const y = PR.clone(x); delete y.rand; return JSON.stringify(RZ.clean(y)); };
  ok('share: an edited planet packs the recipe and round-trips', hm.startsWith('p=z') && strip(back) === strip(M), `${hm.length} chars`);
  ok('share: a broken link gives null', (await RZ.readHash('p=zAAAA')) === null && (await RZ.readHash('r=nope.1')) === null);
}

// ── studio: sizes, tiles, cameras, jobs, queue, recipes, ZIP ────────────
{
  ok('studio: output sizes', JSON.stringify(SC.outputSize(4096, '16:9')) === '{"w":4096,"h":2304}' && JSON.stringify(SC.outputSize(2048, 'phone')) === '{"w":946,"h":2048}');
  const t = SC.planTiles(4096, 2304, 1024);
  ok('studio: tiles cover the image once', t.length === 12 && t.reduce((a, q) => a + q.w * q.h, 0) === 4096 * 2304);
  ok('studio: phone and GPU limits', SC.maxRes({ mobile: true }) === 2048 && SC.maxRes({}, { maxTextureDimension2D: 2048 }) === 2048 && SC.maxRes({}) === 4096);
  const P = RZ.draw('gas', 8); P.rings.on = 1;
  let camOk = true;
  for (const fr of SC.FRAMINGS) for (const a of SC.ASPECTS) {
    const { w, h } = SC.outputSize(1024, a.id), c = SC.cameraFor(P, { framing: fr.id }, w, h);
    const fin = [...c.pos, ...c.target, ...c.up, ...c.sunDir, c.fov].every(Number.isFinite);
    const outside = Math.hypot(...c.pos) > 1.05;
    if (!fin || !outside || Math.abs(Math.hypot(...c.sunDir) - 1) > 1e-6) camOk = false;
  }
  ok('studio: every framing and aspect gives a finite camera outside the planet', camOk);
  const E = PR.fromPreset('eyeball', 3), ce = SC.cameraFor(E, { framing: 'disc', sun: 0 }, 512, 512);
  ok('studio: an eyeball world keeps its warm pole on the sun', Math.abs(ce.sunDir[2] - 1) < 1e-6, ce.sunDir.map(v => v.toFixed(3)).join(','));
  const jobs = SC.makeJobs({ source: 'random', mode: 'gas', n: 5, seed: 300, render: { res: 512 }, matchAll: true });
  ok('studio: N random jobs, match all', jobs.length === 5 && jobs.every(j => j.render.res === 512 && j.render.framing === 'disc' && j.planet.kind === 'gas'));
  const vj = SC.makeJobs({ source: 'variations', current: P, amount: 0.3, n: 3, seed: 1, render: {}, matchAll: false });
  ok('studio: variations keep the family; unmatched renders vary', vj.length === 3 && vj.every(j => j.planet.preset === P.preset) && new Set(vj.map(j => j.render.yaw)).size === 3);
  // queue: runs in order, cancel stops the rest, memory cap pauses
  const order = [];
  const fake = async (j, hk) => { order.push(j.id); hk.onProgress(0.5); await new Promise(r => setTimeout(r, 1)); if (j.planet.fail) throw new Error('boom'); return { png: new Uint8Array(100), recipe: SC.recipeOf(j) }; };
  const q = SC.createQueue({ run: fake });
  const js = SC.makeJobs({ source: 'random', mode: 'rocky', n: 4, seed: 5, render: {}, matchAll: true }); js[2].planet.fail = 1;
  q.add(js); await q.start();
  ok('studio queue: runs every job once, a failure does not stop it', order.length === 4 && q.jobs.filter(j => j.status === 'done').length === 3 && q.jobs[2].status === 'failed' && q.bytes === 300);
  const q2 = SC.createQueue({ run: async (j, hk) => { if (j === q2.jobs[1]) q2.cancel(); return fake(j, hk); } });
  q2.add(SC.makeJobs({ source: 'random', mode: 'gas', n: 5, seed: 9, render: {}, matchAll: true })); await q2.start();
  ok('studio queue: cancel stops the queued jobs', q2.jobs.filter(j => j.status === 'done').length === 2 && q2.jobs.slice(2).every(j => j.status === 'cancelled'), q2.jobs.map(j => j.status).join(','));
  const q3 = SC.createQueue({ run: fake, maxBytes: 200 });
  q3.add(SC.makeJobs({ source: 'random', mode: 'gas', n: 4, seed: 9, render: {}, matchAll: true })); await q3.start();
  ok('studio queue: the memory cap pauses the queue', q3.state === 'full' && q3.jobs.filter(j => j.status === 'done').length === 2);
  q3.clear(); ok('studio queue: clear frees the gallery', q3.jobs.length === 2 && q3.bytes === 0 && q3.state === 'idle');
  // recipe reproduces the planet (same maps)
  const job = jobs[0], rec = SC.recipeOf({ planet: job.planet, render: { ...job.render, exposure: 0.61 } }, { w: 512, h: 512 });
  const back = SC.jobFromRecipe(JSON.stringify(rec));
  const h1 = MP.hashMaps(MP.generate(job.planet, 64)), h2 = MP.hashMaps(MP.generate(back.planet, 64));
  ok('studio recipe: JSON reproduces the same planet and render', h1 === h2 && back.render.exposure === 0.61 && back.render.framing === job.render.framing, `${h1} ${h2}`);
  ok('studio recipe: a Maps-tab planet JSON also loads', SC.jobFromRecipe(PR.toJSON(PR.fromPreset('moon', 2), 1024)).planet.preset === 'moon');
  // ZIP: a PNG and a JSON per result, through the page's JSZip
  const require = createRequire(import.meta.url);
  const JSZip = require('../../vendor/jszip@3.10.1/dist/jszip.min.js');
  const results = [0, 1].map(i => ({ png: new Uint8Array([137, 80, 78, 71, i]), w: 64, h: 32, recipe: SC.recipeOf(jobs[i], { w: 64, h: 32 }) }));
  const zip = new JSZip(); for (const [name, bytes] of SC.zipFiles(results)) zip.file(name, bytes);
  const z2 = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
  const names = Object.keys(z2.files).sort();
  const j0 = JSON.parse(await z2.file(names.find(n => n.endsWith('.json'))).async('string'));
  ok('studio ZIP: a PNG and a recipe JSON per render', names.length === 4 && names.filter(n => n.endsWith('.png')).length === 2 && j0.format === SC.STUDIO_FORMAT && j0.planet.seed === jobs[0].planet.seed, names.join(' '));
  // auto exposure stays in range and does not blow out
  const bright = new Uint8Array(400).fill(250), dark = new Uint8Array(400).fill(20);
  const eb = SC.nextExposure(0.65, SC.exposureStats(bright)), ed = SC.nextExposure(0.65, SC.exposureStats(dark));
  ok('studio exposure: bright frames go down, dark ones up at most x1.5', eb < 0.65 && ed > 0.65 && ed <= 0.65 * 1.5 + 1e-9, `${eb.toFixed(3)} ${ed.toFixed(3)}`);
}

console.log(fails ? `${fails} studio check(s) failed` : 'all studio checks passed');
if (import.meta.url === `file://${process.argv[1]}`) process.exit(fails ? 1 : 0);
export const studioFails = fails;
