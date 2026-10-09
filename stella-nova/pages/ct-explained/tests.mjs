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
//  2b. theme.js: the page colour map reaches the raster of every figure,
//     signed figures get a diverging map, storage failures are harmless,
//     the cross-fade LUT ends on each map, the saver bag never repeats.
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
const TH = await import('./theme.js');
const D = await import('./draw.js');
const CMx = D.CM;
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

// ---------------------------------------------------------------- 2b. theme
{
  const rasters = (sc) => Object.entries(sc).filter(([, v]) => v instanceof D.Raster && v.args);
  const renderAt = (sc, w = 1100) => { const h = sc.height(w), cv = new Canvas(w, h), g = cv.getContext('2d'); sc.render(g, w, h); return cv; };
  const ROLE_OF = (r) => r.args[3];
  const scenes = Object.fromEntries(Object.entries(SCENES).map(([n, C]) => { const sc = new C({}); sc.step(0.5); sc.step(0.5); return [n, sc]; }));
  for (const [choice, expect] of [
    [{ id: null }, (role) => TH.CLASSIC[role.slice(1)]],
    [{ id: 'viridis' }, (role) => (role === '@signed' ? 'berlin' : 'viridis')],
    [{ id: 'gold-leaf', reverse: true }, (role) => (role === '@signed' ? 'vanimo' : 'gold-leaf')],
  ]) {
    TH.setTheme(choice, { persist: false });
    const bad = [], seen = new Set();
    let count = 0;
    for (const [n, sc] of Object.entries(scenes)) {
      renderAt(sc);
      const rs = rasters(sc);
      if (n !== 'filter' && n !== 'gantry' && !rs.length) bad.push(`${n}: no role raster`);
      for (const [k, r] of rs) {
        count++; seen.add(ROLE_OF(r));
        if (r.mapId !== expect(ROLE_OF(r))) bad.push(`${n}.${k} ${ROLE_OF(r)} -> ${r.mapId}`);
        if (r.ver !== TH.version()) bad.push(`${n}.${k} stale`);
      }
    }
    ok(!bad.length, `theme ${choice.id || 'classic'}: every figure raster uses the chosen map`, bad.length ? bad.slice(0, 4).join('; ') : `${count} rasters, roles ${[...seen].join(' ')}`);
  }
  // the artefact figure shows a signed error on a diverging map
  {
    TH.setTheme({ id: 'magma' }, { persist: false });
    const sc = scenes.artefact; renderAt(sc, 390);
    const dmap = sc.rD && CMx.get(sc.rD.mapId);
    ok(dmap && dmap.kind === 'diverging' && sc.rD.args[1] === -sc.rD.args[2], 'artefact: the error panel is signed and diverging', dmap ? `${dmap.id}, ±${sc.rD.args[2].toPrecision(3)}` : 'no error raster');
    ok(TH.partnerOf('coolwarm') === 'coolwarm' && TH.partnerOf(null) === 'berlin' && TH.PICKER_GROUPS.every((g) => CMx.get(TH.PARTNER[g]).kind === 'diverging'), 'theme: every group has a diverging partner');
  }
  // a set-once raster colours again after a theme change, with no new set()
  {
    TH.setTheme({ id: 'bone' }, { persist: false });
    const sc = scenes.fourier; renderAt(sc);
    const px0 = Array.from(sc.rasI.id.data.slice(0, 4 * 4096));
    TH.setTheme({ id: 'synthwave' }, { persist: false });
    renderAt(sc);
    const px1 = Array.from(sc.rasI.id.data.slice(0, 4 * 4096));
    ok(sc.rasI.mapId === 'synthwave' && px0.join() !== px1.join(), 'fourier: the object raster (set once) follows the theme');
  }
  // storage
  {
    const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    let err = null, st = null;
    try { st = TH.load(boom); } catch (e) { err = e; }
    ok(!err && st.id === null, 'theme: a storage that throws gives classic, no throw');
    ok(TH.save(boom) === false && TH.save(null) === false, 'theme: save() reports a storage failure as false');
    const mem = new Map(), good = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
    TH.setTheme({ id: 'ice', reverse: true, gamma: 1.4 }, { storage: good });
    TH.setTheme({ id: null }, { persist: false });
    st = TH.load(good);
    ok(st.id === 'ice' && st.reverse === true && st.gamma === 1.4, 'theme: the choice round-trips through storage', JSON.stringify(st));
    mem.set(TH.KEY, '{bad json'); ok(TH.load(good).id === null, 'theme: bad stored JSON gives classic');
    mem.set(TH.KEY, JSON.stringify({ id: 'coolwarm' })); ok(TH.load(good).id === null, 'theme: a stored diverging id is refused');
    mem.set(TH.KEY, JSON.stringify({ id: 'no-such-map' })); ok(TH.load(good).id === null, 'theme: an unknown stored id is refused');
    let threw = null;
    try { const g0 = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } }); TH.load(); TH.setTheme({ id: 'mako' }); if (g0) Object.defineProperty(globalThis, 'localStorage', g0); else delete globalThis.localStorage; } catch (e) { threw = e; }
    ok(!threw && TH.state().id === 'mako', 'theme: a localStorage getter that throws is harmless', threw ? String(threw) : '');
  }
  // cross-fade
  {
    TH.setTheme({ id: 'viridis' }, { persist: false });
    TH.setFade({ id: 'bone' }, 0);
    const a = TH.lutFor('@image');
    TH.setFade({ id: 'bone' }, 0.5);
    const mid = TH.lutFor('@image');
    TH.setFade(null, 1);
    const b = TH.lutFor('@image');
    const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    const vb = CMx.variant('bone'), vv = CMx.variant('viridis');
    ok(eq(a, vb) && eq(b, vv), 'cross-fade: k = 0 is the old map, the end is the new map');
    ok(mid.every((v, i) => Math.abs(v - (vb[i] + vv[i]) / 2) <= 0.51), 'cross-fade: k = 0.5 is the mean of the two LUTs');
    ok(eq(TH.mixLut(vb, vv, 0), vb) && eq(TH.mixLut(vb, vv, 1), vv) && eq(TH.mixLut(vb, vv, 7), vv), 'mixLut: ends and clamp');
  }
  // the saver bag
  {
    let repeats = 0, kinds = 0, total = 0;
    const firstCover = [];
    for (const seed of [1, 7, 42, 1234, 99991, 0xdeadbeef]) {
      const bag = TH.mapBag(seed), out = [];
      for (let i = 0; i < 500; i++) {
        const kind = i % 7 === 3 ? 'signed' : 'seq';
        const id = bag.next(kind); out.push(id); total++;
        if (kind === 'signed' && CMx.get(id).kind !== 'diverging') kinds++;
        if (kind === 'seq' && !TH.SAVER_POOL.includes(id)) kinds++;
      }
      for (let i = 1; i < out.length; i++) if (out[i] === out[i - 1]) repeats++;
      const b2 = TH.mapBag(seed), first = new Set();
      for (let i = 0; i < TH.SAVER_POOL.length; i++) first.add(b2.next());
      firstCover.push(first.size);
    }
    ok(repeats === 0, 'saver bag: never the same map twice in a row', `${total} picks over 6 seeds`);
    ok(kinds === 0, 'saver bag: signed picks are diverging, others from the pool');
    ok(firstCover.every((n) => n === TH.SAVER_POOL.length), 'saver bag: one pass shows every map of the pool once', firstCover.join(' '));
    const seqA = Array.from({ length: 8 }, ((b) => () => b.next())(TH.mapBag(5))), seqB = Array.from({ length: 8 }, ((b) => () => b.next())(TH.mapBag(6)));
    ok(seqA.join() !== seqB.join(), 'saver bag: two seeds give two orders');
    const groups = TH.SAVER_POOL.map((id) => CMx.get(id).group), mostly = groups.filter((g) => ['perceptual', 'medical', 'artistic'].includes(g)).length / groups.length;
    ok(mostly >= 0.85, 'saver bag: mostly perceptual, medical and artistic maps', `${(mostly * 100).toFixed(0)}%`);
  }
  TH.setTheme({ id: null }, { persist: false });
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
    TH.setTheme({ id: 'ocean', reverse: true }, { persist: false });
    got = window.snSaver.enter({ calm: 0.6, seed: 42, label: (x) => { label = x; } });
    for (let k = 1; k <= 40; k++) { const f = frameFn; frameFn = null; f(k * 33); }
  } catch (e) { err = e; }
  ok(!err && got && got.canvas && appended.includes(got.canvas), 'saver: enter() returns a canvas in the document', err ? String(err) : `warmup ${got && got.warmupMs} ms`);
  ok(label && label.title && label.tex && typeof label.anchor === 'function' && label.anchor(), 'saver: plate has a title, TeX and an anchor', label ? label.title : '');
  const dbg = window.snSaver.debug();
  ok(dbg && dbg.views > 0, 'saver: the scan advances', dbg ? `${dbg.name}, ${dbg.views} views` : '');
  const cm = label && label.params && label.params.find((p) => p.name === 'colour map');
  ok(cm && dbg && cm.value.startsWith(D.CM.get(dbg.map).name) && TH.SAVER_POOL.includes(dbg.map) && TH.state().id === dbg.map, 'saver: the plate names the shot map', cm ? cm.value : '');
  // run on through more shots: the map changes at each new object, never twice the same
  const maps = [dbg && dbg.map];
  let fades = 0;
  for (let k = 41; k <= 41 + 30 * 60; k++) {
    const f = frameFn; frameFn = null; f(k * 33);
    const d = window.snSaver.debug();
    if (d.map !== maps[maps.length - 1]) maps.push(d.map);
    if (d.fading) fades++;
  }
  ok(maps.length >= 3 && maps.every((m, i) => !i || m !== maps[i - 1]), 'saver: a new map per shot, none back to back', maps.join(' > '));
  const sm = await import('./saver.js');
  { const bag = TH.mapBag(3); let n = 0; const seq = [0.1, 0.9]; for (let i = 0; i < 40; i++) { const m = sm.shotMap(bag, () => seq[i % 2], i === 0); if (m.from) { n++; if (m.from === m.id) n = -999; } } ok(n === 19 && sm.FADE_S > 0.5 && sm.FADE_S < 2, 'saver: shotMap cross-fades on some shots, from the last map', `${n} of 40, ${sm.FADE_S} s`); }
  window.snSaver.exit();
  const back = TH.state();
  ok(back.id === 'ocean' && back.reverse === true, 'saver: exit() restores the reader theme');
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
