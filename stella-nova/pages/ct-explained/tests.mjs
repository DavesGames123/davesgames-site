// ============================================================================
//  CT EXPLAINED  ·  node tests
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/ct-explained/tests.mjs [--png DIR]
//
//  1. model.js: the numbers each figure shows (Fourier slice, Beer-Lambert,
//     FBP, filters, artefacts, Hounsfield units, ART toy, cone view).
//  2. scenes: every scene builds, steps 3 s, renders at a desktop and a
//     phone width on the software canvas (test-canvas.mjs) with no throw
//     and no NaN coordinate, takes pointer events and every control value
//     that index.html offers.
//  3. saver.js: enter() returns a canvas in the document, frames run, the
//     plate gets a title, exit() cleans up.
//  4. index.html: head order, [hidden] guard, figures and links match
//     main.js and presets.js, ASTRA credit and both DOIs, no KaTeX.
//  With --png DIR, it also writes one PNG per scene and width to look at.
// ============================================================================
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Canvas, stubDocument, writePNG } from './test-canvas.mjs';

globalThis.document = stubDocument();
const HERE = dirname(fileURLToPath(import.meta.url));
const pngAt = process.argv.indexOf('--png');
const PNG = pngAt > 0 ? process.argv[pngAt + 1] : null;
if (PNG) mkdirSync(PNG, { recursive: true });

let pass = 0, fail = 0;
function ok(cond, name, info = '') {
  if (cond) { pass++; console.log(`ok   ${name}${info ? '  ' + info : ''}`); }
  else { fail++; console.log(`FAIL ${name}${info ? '  ' + info : ''}`); }
}

const M = await import('./model.js');
const A = await import('./scenes-a.js');
const B = await import('./scenes-b.js');
const P = await import('./presets.js');
const E = M.E;

// ---------------------------------------------------------------- 1. model
{
  const sl = M.phantom('shepp-logan-modified');
  const sc = M.scanSet(sl.image, { nAngles: 180 });
  // Fourier slice: spokes from the sinogram match the direct 2D spectrum
  const F = M.fft2Mag(sl.image), n = F.n;
  const grid = new Float32Array(n * n), cnt = new Uint16Array(n * n), nd = sc.geom.nDet;
  for (let a = 0; a < 180; a += 3) M.kSlice(sc.sino.data.subarray(a * nd, (a + 1) * nd), sc.geom.du, sc.geom.angles[a], sl.image.width / 128, grid, cnt, n);
  let ma = 0, mb = 0, c = 0;
  for (let i = 0; i < grid.length; i++) if (cnt[i]) { ma += grid[i]; mb += F.data[i]; c++; }
  ma /= c; mb /= c;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < grid.length; i++) if (cnt[i]) { num += (grid[i] - ma) * (F.data[i] - mb); da += (grid[i] - ma) ** 2; db += (F.data[i] - mb) ** 2; }
  const corr = num / Math.sqrt(da * db);
  ok(corr > 0.85, 'Fourier slice: spokes correlate with the 2D FFT', `r = ${corr.toFixed(3)}`);
  ok(Math.abs(ma - mb) / mb < 0.15, 'Fourier slice: same log-magnitude level', `mean ${ma.toFixed(3)} vs ${mb.toFixed(3)}`);

  // Beer-Lambert row
  const head = M.phantom('head');
  const r = M.beamRow(head.image, 64);
  const last = r.I[128], pe = r.p[128];
  ok(Math.abs(last - Math.exp(-pe)) < 1e-6 && pe > 2 && pe < 6, 'Beer-Lambert: I/I0 = exp(-p) across a head', `p = ${pe.toFixed(2)}, I/I0 = ${last.toFixed(4)}`);

  // view order is a permutation
  const ord = M.viewOrder(180);
  ok(ord.length === 180 && new Set(ord).size === 180, 'viewOrder: a permutation of 180 views');

  // full FBP through bpAccum
  const out = { nx: 128, ny: 128, width: 2, data: new Float32Array(128 * 128) };
  M.bpAccum(sc.q, sc.geom, out, ord, 0, 180);
  const e = E.rmse(sl.image, out);
  ok(e < 0.06, 'bpAccum: 180 filtered views give the phantom', `rmse ${e.toFixed(4)}`);
  // fan FBP through bpAccum (hero path)
  const hs = M.scanSet(head.image, { kind: 'fan', nAngles: 360, sodFactor: 0.56, radius: head.image.width * 0.5 });
  const fo = { nx: 128, ny: 128, width: head.image.width, data: new Float32Array(128 * 128) };
  M.bpAccum(hs.q, hs.geom, fo, Array.from({ length: 360 }, (_, k) => k), 0, 360);
  let se = 0, sn = 0;
  for (let iy = 0; iy < 128; iy++) for (let ix = 0; ix < 128; ix++) if (Math.hypot(ix - 63.5, iy - 63.5) < 60) { se += (fo.data[iy * 128 + ix] - head.image.data[iy * 128 + ix]) ** 2; sn++; }
  const fe = Math.sqrt(se / sn) / M.MU_WATER;
  ok(fe < 0.25, 'hero fan FBP matches the head inside the circle', `rmse ${(fe * 100).toFixed(1)}% of water`);

  // unfiltered back-projection of a point falls as 1/r
  const pt = M.pointImage(128, [[0, 0]], { r: 0.03 });
  const ps = M.scanSet(pt, { nAngles: 180 });
  const bp = { nx: 128, ny: 128, width: 2, data: new Float32Array(128 * 128) };
  M.bpAccum(ps.sino, ps.geom, bp, ord, 0, 180);
  const row = bp.data.slice(64 * 128, 65 * 128);
  const ratio = row[63 + 10] / row[63 + 20];
  ok(ratio > 1.7 && ratio < 2.3, 'plain back-projection of a point falls as 1/r', `b(10 px) / b(20 px) = ${ratio.toFixed(2)} (1/r gives 2)`);

  // filters
  const fc = M.filterCurves(1);
  ok(Math.abs(fc.curves['ram-lak'][128] - 1) < 1e-3 && fc.curves.hann[128] < 1e-3, 'filters: Ram-Lak 1 and Hann 0 at Nyquist');
  const fc2 = M.filterCurves(0.5);
  ok(fc2.curves['ram-lak'][100] === 0 && fc2.curves['ram-lak'][60] > 0, 'filters: cutoff 0.5 zeroes the top half');
  const fr = M.filteredRow(sl.image, 0.3, 'ram-lak', 1);
  ok(Math.min(...fr.filtered) < 0 && Math.min(...fr.raw) >= 0, 'filtered projection has negative lobes');

  // artefacts: each control makes the image worse in the expected way
  const ps1 = (id, p) => M.artefact(id, p).psnr;
  const cases = [['noise', 0.95, 0.05], ['views', 0.95, 0.05], ['limited', 0.95, 0.05], ['motion', 0.0, 1.0], ['rings', 0.0, 1.0]];
  for (const [id, good, bad] of cases) {
    const a = ps1(id, good), b = ps1(id, bad);
    ok(a > b + 1, `artefact ${id}: PSNR drops as the control worsens`, `${a.toFixed(1)} -> ${b.toFixed(1)} dB`);
  }
  for (const id of ['hardening', 'metal']) {
    const R = M.artefact(id, 0.3);
    ok(Number.isFinite(R.psnr) && R.recon.data.every(Number.isFinite), `artefact ${id}: finite image`, `PSNR ${R.psnr.toFixed(1)} dB`);
  }
  // beam hardening cups: centre / edge of brain measured below the truth
  const H = M.artefact('hardening', 0.0).extra;
  const at = (a, i) => (a[i - 1] + a[i] + a[i + 1]) / 3;
  const cupM = at(H.profile, 64) / at(H.profile, 34), cupT = at(H.refProfile, 64) / at(H.refProfile, 34);
  ok(cupM < cupT, 'beam hardening: the centre reads low (cupping)', `centre/edge ${cupM.toFixed(3)} vs true ${cupT.toFixed(3)}`);
  const hl = M.artefact('hardening', 0.0).psnr, hh = M.artefact('hardening', 1.0).psnr;
  ok(hh > hl, 'beam hardening: higher kVp is closer to the truth', `60 kVp ${hl.toFixed(1)} dB, 140 kVp ${hh.toFixed(1)} dB`);

  // Hounsfield units
  ok(M.toHU(M.MU_WATER) === 0 && M.toHU(0) === -1000, 'HU: water 0, air -1000');
  const sc2 = M.huScale(), hu = Object.fromEntries(sc2.map((x) => [x.m, x.hu]));
  ok(hu.lung < hu.fat && hu.fat < hu.water && hu.water < hu.spongy && hu.spongy < hu.bone, 'HU scale is in tissue order', JSON.stringify(hu));
  const sl2 = M.huSlice('chest', 96);
  ok(sl2.hu.length === 96 * 96 && sl2.hu.every(Number.isFinite), 'HU slice is finite');

  // ART toy converges to the crossing (1, 1)
  const path = M.kaczmarz([{ a: [0.9, 0.44], b: 1.34 }, { a: [0.6, 0.8], b: 1.4 }], [-0.6, 2.4], 300);
  const end = path[path.length - 1];
  ok(Math.hypot(end[0] - 1, end[1] - 1) < 1e-3, 'Kaczmarz: two lines meet at (1, 1)', `end ${end.map((v) => v.toFixed(4)).join(', ')}`);

  // cone view
  const cv = M.coneView(0.4, 32);
  ok(cv.data.length === cv.nu * cv.nv && Math.max(...cv.data) > 0.1, 'cone view: one 2D projection', `${cv.nu} x ${cv.nv}`);
}

// ---------------------------------------------------------------- 2. scenes
const html = readFileSync(join(HERE, 'index.html'), 'utf8');
const mainSrc = readFileSync(join(HERE, 'main.js'), 'utf8');
// control values per scene from the markup
function controlsFor(scene) {
  const at = html.indexOf(`data-scene="${scene}"`);
  const endA = html.indexOf('</article>', at);
  const part = html.slice(html.lastIndexOf('<article', at), endA);
  const out = [];
  for (const m of part.matchAll(/<div class="seg[^"]*" data-set="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)) for (const b of m[2].matchAll(/data-v="([^"]+)"/g)) out.push([m[1], b[1]]);
  for (const m of part.matchAll(/<input type="range" data-set="([^"]+)" min="([^"]+)" max="([^"]+)"/g)) out.push([m[1], m[2]], [m[1], m[3]]);
  return out;
}
const SCENES = {
  hero: A.HeroScene, beer: A.BeerScene, proj: A.ProjScene, sino: A.SinoScene, bp: A.BPScene, fourier: A.FourierScene,
  filter: B.FilterScene, fbp: B.FBPScene, gantry: B.GantryScene, iter: B.IterScene, artefact: B.ArtefactScene, hu: B.HUScene,
};
for (const [name, C] of Object.entries(SCENES)) {
  let err = null, nan = 0, ms = 0;
  try {
    const sc = new C({});
    const t0 = performance.now();
    for (let t = 0; t < 3; t += 1 / 30) sc.step(1 / 30);
    ms = performance.now() - t0;
    for (const w of [1100, 390]) {
      const h = sc.height(w);
      if (!(h > 100 && h < 3000)) throw new Error(`height ${h} for ${w}`);
      const cv = new Canvas(w, h), g = cv.getContext('2d');
      g.fillStyle = '#05070c'; g.fillRect(0, 0, w, h);
      sc.render(g, w, h);
      nan += g.nan;
      if (sc.pointer) for (const type of ['down', 'move', 'up']) sc.pointer({ type, x: w * 0.4, y: h * 0.4, buttons: type === 'up' ? 0 : 1 });
      if (PNG) writePNG(join(PNG, `${name}-${w}.png`), cv);
    }
    for (const [k, v] of controlsFor(name)) {
      sc.set(k, name === 'artefact' && k === 'p' ? +v / 100 : v);
      sc.step(0.2); sc.step(0.2);
      const cv = new Canvas(390, sc.height(390)), g = cv.getContext('2d');
      sc.render(g, 390, sc.height(390)); nan += g.nan;
    }
  } catch (e) { err = e; }
  ok(!err && nan === 0, `scene ${name}: steps, renders, takes pointer and controls`, err ? String(err.stack || err).split('\n').slice(0, 2).join(' | ') : `3 s of steps ${ms.toFixed(0)} ms, controls ${controlsFor(name).length}`);
}

// ---------------------------------------------------------------- 3. saver
{
  let frameFn = null, label = null, appended = [], removed = 0;
  const mk = (tag) => {
    const el = tag === 'canvas' ? new Canvas() : {};
    el.style = {}; el.remove = () => { removed++; };
    return el;
  };
  globalThis.window = { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 };
  globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
  globalThis.document = { createElement: mk, head: { appendChild: (e) => appended.push(e) }, body: { appendChild: (e) => appended.push(e) } };
  globalThis.requestAnimationFrame = (f) => { frameFn = f; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  let err = null, got = null;
  try {
    await import('./saver.js');
    got = window.snSaver.enter({ calm: 0.6, seed: 42, label: (x) => { label = x; } });
    for (let k = 1; k <= 40; k++) { const f = frameFn; frameFn = null; f(k * 33); }
  } catch (e) { err = e; }
  ok(!err && got && got.canvas && appended.includes(got.canvas), 'saver: enter() returns a canvas in the document', err ? String(err) : `warmup ${got && got.warmupMs} ms`);
  ok(label && label.title && label.tex && typeof label.anchor === 'function' && label.anchor(), 'saver: plate has a title, TeX and an anchor', label ? label.title : '');
  const dbg = window.snSaver.debug();
  ok(dbg && dbg.views > 0, 'saver: the scan advances', dbg ? `${dbg.name}, ${dbg.views} views` : '');
  window.snSaver.exit();
  ok(removed >= 2 && window.snSaver.debug() === null, 'saver: exit() removes the canvas and the style');
  globalThis.document = stubDocument();
}

// ---------------------------------------------------------------- 4. markup
{
  const head = html.slice(0, html.indexOf('</head>'));
  const sGuard = head.indexOf('gpu-guard.js'), sWish = head.indexOf('wishlist.js');
  ok(sGuard > 0 && sWish > sGuard && head.indexOf('<script', sGuard + 1) === head.indexOf('<script src="../../lib/wishlist.js"'), 'head: gpu-guard first, then wishlist');
  const css = readFileSync(join(HERE, 'style.css'), 'utf8');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'style: [hidden]{display:none!important}');
  const makers = [...mainSrc.slice(mainSrc.indexOf('const MAKERS'), mainSrc.indexOf('};', mainSrc.indexOf('const MAKERS'))).matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
  const scenes = [...html.matchAll(/<figure class="[^"]*" data-scene="([^"]+)"/g)].map((m) => m[1]);
  ok(scenes.length === 12 && scenes.every((s) => makers.includes(s)), 'every figure has a scene maker', scenes.join(' '));
  const links = [...html.matchAll(/data-link="([^"]+)"/g)].map((m) => m[1]);
  const art = M.ARTEFACTS.map((a) => a.preset);
  const missing = [...links, ...art].filter((id) => !P.PRESETS[id]);
  ok(missing.length === 0, 'every CT Lab link names a preset', missing.length ? missing.join(' ') : `${new Set(links).size + 0} link ids, ${art.length} artefact ids`);
  ok(P.labHref('rings') === '/stella-nova/#ct-lab/preset=rings' && P.labHref('rings', false) === '../ct-lab/index.html#preset=rings', 'lab links use #preset=<id>');
  // every id must exist in the lab's own preset table
  let labSrc = '';
  try { labSrc = readFileSync(join(HERE, '../ct-lab/lab/presets.js'), 'utf8'); } catch (e) { /* lab missing */ }
  const notInLab = Object.keys(P.PRESETS).filter((id) => !labSrc.includes(`P('${id}'`));
  ok(labSrc && notInLab.length === 0, 'every preset id exists in ct-lab/lab/presets.js', notInLab.length ? notInLab.join(' ') : `${Object.keys(P.PRESETS).length} ids`);
  const chips = [...html.matchAll(/data-target="([^"]+)"/g)].map((m) => m[1]);
  ok(chips.every((id) => html.includes(`id="${id}"`)), 'every chip has its section', `${chips.length} chips`);
  ok(html.includes('https://github.com/astra-toolbox/astra-toolbox') && html.includes('10.1016/j.ultramic.2015.05.002') && html.includes('10.1364/OE.24.025129'), 'credit: ASTRA link and both DOIs');
  const all = html + mainSrc + css;
  ok(!/katex/i.test(all) && !/Playfair|Cormorant|JetBrains/.test(all), 'no KaTeX and no banned fonts');
  const texCount = (html.match(/data-tex="/g) || []).length;
  ok(texCount >= 10, 'equations typeset from data-tex', `${texCount} equations`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
