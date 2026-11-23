// ============================================================================
//  NEBULA  ·  tests.mjs — node checks (no browser): node pages/nebula/tests.mjs
// ----------------------------------------------------------------------------
//  1. engine copies: the shipped volume (data/volume-w.smv) is SMV1, and its
//     stale guard (composition + shader SHA-256) matches the engine text, so
//     the page draws it with no bake
//  2. look.js: shuffle, palettes, back, link codes, the fog stays off
//  3. saver.js: plan variety, landmarks of shuffled nebulas, crops inside the
//     source and the landmark at the band centre, at 16:9 and 9:16
//  4. shell: gpu-guard then wishlist first, [hidden] guard, ids main.js binds
// ============================================================================
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, failN = 0;
const ok = (c, what) => { if (c) pass++; else { failN++; console.log('FAIL ' + what); } };

// ---- 1. shipped volume ----
{
  const { unpackPayload, volumeInputs } = await import('./engine/bake/prebaked.js');
  const raw = gunzipSync(readFileSync(join(here, 'data/volume-w.smv')));
  const u = unpackPayload(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  ok(u && u.head, 'volume is SMV1');
  const inp = await volumeInputs();
  ok(u.head.inputs.compositionSha256 === inp.compositionSha256, 'volume composition sha matches the engine');
  ok(u.head.inputs.shaderSha256 === inp.shaderSha256, 'volume shader sha matches the engine (else the page bakes live at load)');
  ok(!u.head.look || u.head.look.palette === 'nircam', 'volume palette is nircam');
  const names = u.head.sections.map((s) => s.name);
  ok(['Vol', 'SkinD', 'SkinA'].every((n) => names.includes(n)), 'volume has Vol, SkinD, SkinA: ' + names.join(','));
}

// ---- 2. look ----
const base = (await import('./engine/data/composition.js')).default;
const { createLook, PALETTE_ORDER, PALETTE_INFO, swatch } = await import('./look.js');
const { stageOf } = await import('./engine/look/shuffle.js');
{
  ok(PALETTE_ORDER.length === 12, 'twelve palettes offered');
  for (const n of PALETTE_ORDER) ok(swatch(base, n).length === 5 && swatch(base, n).every((c) => /^#[0-9a-f]{6}$/.test(c)), 'swatch ' + n);
  const L = createLook(base, { master: 7 });
  ok(L.paletteName() === 'nircam' && L.code().look === null, 'starts on the original');
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const c = L.shuffleAll();
    seen.add(L.paletteName());
    ok(stageOf(base, c) === 'A', 'shuffle needs a full bake');
    ok(!(c.display && c.display.fog && c.display.fog.on), 'fog stays off');
    ok(L.problems().length === 0, 'shuffled look passes the hard rules');
  }
  ok(seen.size >= 4, 'shuffles vary the palette (' + seen.size + ')');
  const before = L.comp();
  const c2 = L.setPalette('ember');
  ok(stageOf(before, c2) === 'P' && L.paletteName() === 'ember', 'palette change is a relight only');
  ok(L.setPalette('ember') === null, 'same palette is no change');
  const c3 = L.shufflePalette();
  ok(stageOf(c2, c3) === 'P' && L.paletteName() !== 'ember', 'colour shuffle gives a new palette');
  ok(L.back() && L.paletteName() === 'ember', 'back restores the palette');
  const code = L.code();
  const L2 = createLook(base);
  ok(L2.fromQuery(new URLSearchParams(`look=${code.look}&pal=${code.pal}`)), 'link parses');
  ok(JSON.stringify(L2.comp()) === JSON.stringify(L.comp()), 'link gives the same look');
  ok(!createLook(base).fromQuery(new URLSearchParams('look=zz&pal=nope')), 'bad link ignored');
  ok(Object.values(PALETTE_INFO).every((p) => p.name && p.note && (p.kind === 'real' || p.kind === 'fantasy')), 'palette names');
}

// ---- 3. saver ----
{
  globalThis.window = globalThis.window || {};
  const { makePlan, landmarks, cropFor, scrollFor, screenX } = await import('./saver.js');
  const L = createLook(base, { master: 99 });
  const comps = [base, L.shuffleAll(), L.shuffleAll(), L.shuffleAll()];
  for (const c of comps) {
    const lm = landmarks(c);
    ok(lm.length >= 6, 'landmarks ' + lm.length);
    ok(lm.every((l) => l.x >= 0 && l.x <= 5760 && l.y >= 80 && l.y <= 1000), 'landmarks inside the strip');
  }
  for (const calm of [0, 0.7, 1]) {
    const plan = makePlan(1234, calm), kinds = new Set(), ids = [];
    let looks = 0, nebulas = 0;
    for (let i = 0; i < 28; i++) {
      const s = plan.next(base);
      kinds.add(s.kind); ids.push(s.lm.id);
      ok(s.dur >= 4 && s.dur <= 18, 'shot length ' + s.dur.toFixed(1));
      if (s.look === 'colours') looks++; if (s.look === 'nebula') nebulas++;
    }
    ok(kinds.size >= 3, 'shot kinds vary at calm ' + calm);
    ok(ids.slice(1).every((id, i) => id !== ids[i] || id === 'mid'), 'no landmark twice in a row');
    ok(looks >= 4 && nebulas >= 2, `looks change (${looks} colours, ${nebulas} nebulas)`);
  }
  ok(makePlan(5).next(base).lm.id !== undefined && JSON.stringify(makePlan(5).next(base)) === JSON.stringify(makePlan(5).next(base)), 'plan is seeded');
  // the view centre lands on the landmark
  for (const vw of [1920, 607, 2520]) {
    for (const l of landmarks(base)) {
      const t = scrollFor(l.x, l.p, vw), S = 5760 - Math.min(2600, Math.max(1440, vw));
      const xs = screenX(l.x, l.p, t * S, vw);
      if (t > 0 && t < 1) ok(Math.abs(xs - vw / 2) < 1, `landmark ${l.id} centred at vw ${vw} (${xs.toFixed(1)})`);
    }
  }
  // crops: inside the source, subject at the band centre where the source allows it
  for (const [W, H] of [[1920, 1080], [1080, 1920]]) {
    const src = { w: Math.round(1080 * W / H), h: 1080 };
    const band = { cy: H * 0.55, h: H * 0.5 };
    for (const z of [1.04, 1.2, 1.5]) {
      const subj = { x: src.w * 0.5, y: src.h * 0.5 };
      const [sx, sy, sw, sh] = cropFor(src, { w: W, h: H }, subj, z, band);
      ok(sx >= 0 && sy >= 0 && sx + sw <= src.w + 1e-6 && sy + sh <= src.h + 1e-6, `crop inside at ${W}x${H} z ${z}`);
      const py = (subj.y - sy) / sh * H;
      const atEdge = sy < 1e-6 || sy + sh > src.h - 1e-6;
      ok(Math.abs(py - band.cy) < 2 || (atEdge && Math.abs(py - band.cy) < Math.abs(H / 2 - band.cy) + 2),
        `subject at band centre or crop at the edge, ${W}x${H} z ${z} (${py.toFixed(0)} vs ${band.cy})`);
    }
  }
}

// ---- 4. shell ----
{
  const html = readFileSync(join(here, 'index.html'), 'utf8');
  const css = readFileSync(join(here, 'style.css'), 'utf8');
  const js = readFileSync(join(here, 'main.js'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  ok(scripts[0] === '../../lib/gpu-guard.js' && scripts[1] === '../../lib/wishlist.js', 'gpu-guard then wishlist');
  ok(/\[hidden\]\{display:none!important\}/.test(css), '[hidden] guard');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const used = [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  for (const id of new Set(used)) ok(ids.has(id), 'main.js binds #' + id);
  ok(ids.has('saverCanvas'), 'saver canvas in the document');
  ok(!/v67-graph|map\/overlay|explore\.js|tunnels\.js/.test(js), 'no route map code');
}

console.log(`${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
