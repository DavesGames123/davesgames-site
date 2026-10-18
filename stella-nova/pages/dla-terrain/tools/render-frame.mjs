// ============================================================================
//  DLA TERRAIN  ·  tools/render-frame.mjs — render the real page to PNG (Deno)
// ----------------------------------------------------------------------------
//  Runs main.js and index.html in jsdom with Deno WebGPU and a fake swap
//  chain (no browser). Used for the end-to-end look checks and the home
//  thumbnail. Needs Deno 2, jsdom from npm (fetched by Deno) and ImageMagick
//  (`magick`, to decode the webp textures of the plant models; Deno cannot).
//
//  deno run -A stella-nova/pages/dla-terrain/tools/render-frame.mjs \
//    w=1280 h=800 out=/tmp/x 'steps=ready;pump60;shoot:dla-terrain.png'
//
//  Args: w, h (px), out (folder for shoot:), qs (a ?query or #hash, so a
//  world link renders), coarse=1 (a phone), early=1 (shoot the first
//  terrain as it forms), groundimg=1 (decode the ground sets with magick). Steps (';' between them): ready (plant models
//  in), pumpN (N frames at 30 fps), preset:<id>, rand:<seed>, seed:<n>,
//  tod<x>, season<x>, wx-<weather id>, q:<0..3>, home, orbit, drone,
//  river, valley, ridge, fly, perfN (frame time to queue done), eval:<js>,
//  shoot:<file>, gen:<name> (shoot each stage of a new generation),
//  close:<rock|scree|ground>:<d m>[:<pick>] (a close-up of that surface),
//  build:<name>[@i:u+...] ("Watch it build": shoot points of the timeline).
//  Without steps= it only checks that the page boots.
// ============================================================================
// Deno + jsdom harness: runs the real main.js with a fake swap chain, no browser.
import { JSDOM } from 'npm:jsdom@24.1.3';
const PAGE = new URL('../', import.meta.url).pathname;
const args = Object.fromEntries(Deno.args.map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
const W = +(args.w || 960), H = +(args.h || 540);
const dom = new JSDOM(Deno.readTextFileSync(PAGE + 'index.html').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, ''), { url: 'http://localhost/stella-nova/pages/dla-terrain/index.html' + (args.qs || ''), pretendToBeVisual: false });
const win = dom.window;
globalThis.window = globalThis; globalThis.document = win.document;
globalThis.HTMLElement = win.HTMLElement;
const COARSE = args.coarse === '1';
// groundimg=1: decode the GROUND webp sets through magick too (ground.js
// gpu.groundImageLoader), so Deno frames show the texture sets
const GROUND_IMG = args.groundimg === '1';
globalThis.matchMedia = q => ({ matches: q.includes('coarse') ? COARSE : false, addEventListener() {} });
win.matchMedia = globalThis.matchMedia;
globalThis.location = win.location; globalThis.history = win.history;
globalThis.innerWidth = W; globalThis.innerHeight = H; globalThis.devicePixelRatio = 1;
globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
win.ImageData = globalThis.ImageData;
const rafQ = [];
globalThis.requestAnimationFrame = cb => { rafQ.push(cb); return rafQ.length; };
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
let swap = null, swapFmt = 'rgba8unorm';
win.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') return ctx2d;
  if (type === 'webgpu') {
    const cv = this;
    return { configure(o) { this.o = o; }, getCurrentTexture() {
      if (!swap || swap.width !== cv.width || swap.height !== cv.height) { swap && swap.destroy(); swap = this.o.device.createTexture({ size: [cv.width, cv.height], format: swapFmt, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }); }
      return swap;
    } };
  }
  return null;
};
navigator.gpu.getPreferredCanvasFormat = () => swapFmt;
const errs = [];
const origWarn = console.warn;
console.warn = (...a) => { const s = a.map(x => (x && x.stack) || String(x)).join(' '); if (!/copyExternalImageToTexture/.test(s)) { errs.push(s); origWarn('WARN', s.slice(0, 400)); } };
await import('file://' + PAGE + 'main.js');
const app = globalThis.__dlaTerrain || win.__dlaTerrain;
// Deno cannot decode webp: the VEG asset textures go through magick (test only)
const vegLoader = async (url, size) => {
  const src = new URL(url).pathname;
  const out = await new Deno.Command('magick', { args: [src, '-resize', `${size}x${size}!`, '-depth', '8', 'RGBA:-'] }).output();
  return { data: out.stdout, width: size, height: size };
};
{ const iv = setInterval(() => { if (app.gpu && !app.gpu.vegImageLoader) { app.gpu.vegImageLoader = vegLoader; if (GROUND_IMG) app.gpu.groundImageLoader = vegLoader; clearInterval(iv); } }, 2); }
let t = 0;
async function pump(n, label) {
  for (let i = 0; i < n; i++) {
    const q = rafQ.splice(0); t += 1000 / 30;
    for (const cb of q) cb(t);
    await new Promise(r => setTimeout(r, 5));
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 20));
  }
  if (label) console.log('pumped', label, 'gen', app.gen && app.gen.running ? 'running ' + app.gen.label : 'idle', 'cam', app.camMode, 'tod', app.tod.toFixed(3));
}
await new Promise(r => setTimeout(r, 300));
if (app.fg) { app.fg.dynamic = false; }
await pump(5, 'boot');
if (app.fg) { app.fg.dynamic = false; app.fg.setScale(1); }
const until = async (f, max = 600) => { for (let i = 0; i < max && !f(); i++) await pump(1); };
globalThis.__shoot = async (dev, file) => {
  const w = swap.width, h = swap.height, bpr = Math.ceil(w * 4 / 256) * 256;
  const buf = dev.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = dev.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: swap }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
  dev.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(src.subarray(y * bpr, y * bpr + w * 4), y * (w * 4 + 1) + 1);
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const o = new Uint8Array(12 + data.length), dv = new DataView(o.buffer); dv.setUint32(0, data.length); o.set(new TextEncoder().encode(type), 4); o.set(data, 8); dv.setUint32(8 + data.length, crc(o.subarray(4, 8 + data.length))); return o; };
  const ih = new Uint8Array(13), dv = new DataView(ih.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 8; ih[9] = 6;
  await Deno.writeFile(file, new Uint8Array(await new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', z), chunk('IEND', new Uint8Array())]).arrayBuffer()));
  console.log('wrote', file);
};
if (args.early) {
  // the default opening: shoot the first terrain as it forms
  let last = null, k = 0;
  for (let i = 0; i < 1500 && app.gen && app.gen.running; i++) {
    await pump(1);
    if (app.gen.stage !== last && app.gen.stage) { last = app.gen.stage; await pump(10); await globalThis.__shoot(app.gpu.device, (args.out || Deno.cwd()) + '/early-' + (k++) + '-' + last + '.png'); }
  }
  await pump(40); await globalThis.__shoot(app.gpu.device, (args.out || Deno.cwd()) + '/early-' + (k++) + '-done.png');
  await pump(150); await globalThis.__shoot(app.gpu.device, (args.out || Deno.cwd()) + '/early-' + (k++) + '-5s.png');
}
await until(() => app.gen && !app.gen.running, 900);
if (GROUND_IMG) {
  // the ground module may have started its load before the hook was set
  const gm = app.fg && app.fg.modules.find(m => m.role === 'ground');
  if (gm && gm.reloadTextures && !(gm.stats().textures)) await gm.reloadTextures();
  console.log('ground textures', gm ? gm.stats().textures : 'no ground module');
}
console.log('lib', app.libKind, 'terrain', app.terrain && app.terrain.n, 'rivers', app.terrain && app.terrain.rivers.length);
console.log('status:', document.getElementById('stMain').textContent, '|', document.getElementById('stRight').textContent);
console.log('notice:', document.getElementById('notice').hidden ? '(none)' : document.getElementById('notice').textContent);
console.log('panel groups:', [...document.querySelectorAll('#optGroups summary span')].map(e => e.textContent).join(', '));
console.log('weather chips:', document.querySelectorAll('#wxChips button').length, 'presets:', document.querySelectorAll('#presetChips button').length);
await pump(20, 'settled');
async function shot(name) {
  const gpu = app.__gpu;
  await pump(1);
  if (!swap) { console.log('no swap'); return; }
  const dev = swap.__dev;
}
export { app, pump, until, dom };
const steps = (args.steps || 'orbit').split((args.steps || '').includes(';') ? ';' : ',');
const OUT = args.out || Deno.cwd();
const waitGen = async () => { await pump(2); await until(() => app.gen && !app.gen.running, 1500); await pump(12); };
// a camera shot of the finished terrain: valley floor, ridge, default
function shotCam(kind) {
  const t = app.terrain, cam = app.cam, ws = t.worldSize, n = t.n, h = t.height;
  const at = (x, z) => { const i = Math.max(0, Math.min(n - 1, Math.round((x / ws + 0.5) * n - 0.5))), j = Math.max(0, Math.min(n - 1, Math.round((z / ws + 0.5) * n - 0.5))); return h[j * n + i]; };
  const sea = t.seaLevel;
  let best = null, score = -Infinity;
  let s = 12345;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let k = 0; k < 3000; k++) {
    const x = (r() - 0.5) * ws * 0.7, z = (r() - 0.5) * ws * 0.7, y = at(x, z);
    if (y < sea + 4) continue;
    { const i = Math.max(0, Math.min(n - 1, Math.round((x / ws + 0.5) * n - 0.5))), j = Math.max(0, Math.min(n - 1, Math.round((z / ws + 0.5) * n - 0.5))); if (t.water && t.water[j * n + i] > 0.05) continue; if (kind === 'valley' && t.river && t.river[j * n + i] > 0.2) continue; }
    let sc;
    if (kind === 'valley') {
      // low ground with high ground around it
      // a broad, flat valley floor with high ground 2 to 4 km away
      let rim = 0; for (let a = 0; a < 8; a++) rim += at(x + Math.cos(a) * 3000, z + Math.sin(a) * 3000);
      const sl = Math.abs(at(x + 60, z) - at(x - 60, z)) + Math.abs(at(x, z + 60) - at(x, z - 60));
      sc = Math.min(rim / 8 - y, 900) - sl * 20;
    } else sc = y;
    if (sc > score) { score = sc; best = [x, y, z]; }
  }
  if (!best) return;
  // look toward the higher (valley) or lower (ridge) side, sun-agnostic
  let yaw = 0, bestD = Infinity;
  for (let a = 0; a < 16; a++) {
    const ang = a / 16 * Math.PI * 2, fx = Math.sin(ang), fz = -Math.cos(ang);
    let m = 0; for (let d = 300; d <= 3000; d += 300) m += at(best[0] + fx * d, best[2] + fz * d);
    if (m < bestD) { bestD = m; yaw = ang; }
  }
  cam.setMode('fly', { heightAt: at, size: ws, seaLevel: sea });
  app.camMode = 'fly';
  cam.fly.pos = [best[0], best[1] + (kind === 'valley' ? 35 : 60), best[2]];
  cam.fly.yaw = yaw; cam.fly.pitch = kind === 'valley' ? 0.04 : -0.12;
}
// close:<kind>:<d>[:<pick>] — a close-up shot at about d metres from a
// surface of kind rock (a steep face, seen from out in front), scree (the
// foot of a face) or ground (gentle soil or grass, seen from above). The
// eye stays over the full ground height (LIB terrainHeightAt) + 1.7 m.
function closeCam(kind, d, pick = 0) {
  const t = app.terrain, cam = app.cam, ws = t.worldSize, n = t.n, h = t.height;
  const H = (x, z) => (app.lib && app.lib.terrainHeightAt ? app.lib.terrainHeightAt(t, x, z) : 0);
  const cell = ws / n, ij = (x, z) => [Math.max(1, Math.min(n - 2, Math.round((x / ws + 0.5) * n - 0.5))), Math.max(1, Math.min(n - 2, Math.round((z / ws + 0.5) * n - 0.5)))];
  let s = 977 + pick * 7919;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const cands = [];
  // a world with no steep faces (highlands) takes its steepest ground
  let gMin = kind === 'rock' ? 0.9 : 0;
  for (let pass = 0; pass < 2 && !cands.length; pass++, gMin *= 0.55)
  for (let k = 0; k < 40000 && cands.length < 400; k++) {
    const x = (r() - 0.5) * ws * 0.8, z = (r() - 0.5) * ws * 0.8;
    const [i, j] = ij(x, z), y = h[j * n + i];
    if (y < t.seaLevel + 3 || (t.water && t.water[j * n + i] > 0.02) || (t.river && t.river[j * n + i] > 0.1)) continue;
    const gx = (h[j * n + i + 1] - h[j * n + i - 1]) / (2 * cell), gz = (h[(j + 1) * n + i] - h[(j - 1) * n + i]) / (2 * cell), g = Math.hypot(gx, gz);
    const ok = kind === 'rock' ? g > gMin && g < 3 : kind === 'scree' ? g > 0.45 && g < 0.75 : g < 0.25;
    if (ok) cands.push([x, z, gx, gz, g]);
  }
  if (!cands.length) { console.log('close: no', kind, 'site'); return false; }
  const [x, z, gx, gz, g] = cands[Math.floor(r() * cands.length)];
  const P = [x, H(x, z), z];
  // out of the face (downhill), a little above; ground: from the side, above
  const ox = g > 1e-6 ? -gx / g : 1, oz = g > 1e-6 ? -gz / g : 0;
  const el = kind === 'ground' ? 0.75 : kind === 'scree' ? 0.45 : 0.18;
  const C = [P[0] + ox * d * Math.cos(el), P[1] + d * Math.sin(el), P[2] + oz * d * Math.cos(el)];
  C[1] = Math.max(C[1], H(C[0], C[2]) + 1.7);
  const dx = P[0] - C[0], dy = P[1] - C[1], dz = P[2] - C[2];
  cam.setMode('fly', { heightAt: H, size: ws, seaLevel: t.seaLevel });
  app.camMode = 'fly';
  cam.fly.pos = C;
  cam.fly.yaw = Math.atan2(dx, -dz); cam.fly.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  // a snap update (dt >= 0.5 s): no glide from the last pose
  cam.update(1, {}, { heightAt: H, size: ws, seaLevel: t.seaLevel });
  console.log('close', kind, d, 'at', P.map(v => v.toFixed(1)).join(','), 'slope', g.toFixed(2), 'eye agl', (C[1] - H(C[0], C[2])).toFixed(1), 'dist', Math.hypot(dx, dy, dz).toFixed(1));
  return true;
}
// prop:<species>:<d>[:<pick>] — a shot of a scattered plant or stone of
// that species (render/scatter.js SPECIES key) from about d m, with the
// sun at the side of the view (to check the shading of the props)
const SCAT = await import('../render/scatter.js');
const SPECIES_KEYS = SCAT.SPECIES.map(x => x.key);
function closeProp(key, d, pick = 0) {
  const v = app.fg.modules.find(m => m.role === 'vegetation');
  const tiles = v && v._internal && v._internal.tiles;
  const t = app.terrain, cam = app.cam, ws = t.worldSize;
  const H = (x, z) => (app.lib && app.lib.terrainHeightAt ? app.lib.terrainHeightAt(t, x, z) : 0);
  const want = SPECIES_KEYS.indexOf(key);
  const hits = [];
  const f = v._internal.field, LK = SCAT.SPECIES[want] ? SCAT.SPECIES[want].layer : 'rocks';
  const Ly = SCAT.LAYERS.find(l => l.key === LK), nt = Math.ceil(ws / Ly.tile);
  let sd0 = 4242;
  const rnd = () => ((sd0 = (sd0 * 1103515245 + 12345) >>> 0) / 4294967296);
  const extra = [];
  for (let k = 0; k < 400 && f && extra.length < 40; k++) {
    const tl = SCAT.scatterTile(f, LK, Math.floor(rnd() * nt), Math.floor(rnd() * nt));
    if (tl.count) extra.push({ tile: tl });
  }
  for (const e of [...(tiles ? tiles.values() : []), ...extra]) {
    const d8 = e.tile.data;
    for (let i = 0; i < e.tile.count; i++) {
      const sp = d8[i * 8 + 5];
      if (Math.round(sp) === want) hits.push([d8[i * 8], d8[i * 8 + 2]]);
    }
  }
  if (!hits.length) { console.log('prop: no', key); return false; }
  const [x, z] = hits[Math.min(hits.length - 1, pick)];
  const sd = app.G ? [app.G[84], app.G[86]] : [1, 0];
  const sl = Math.hypot(sd[0], sd[1]) || 1;
  // the eye looks across the sun direction: the lit side on the right
  const ox = -sd[1] / sl, oz = sd[0] / sl;
  const C = [x + ox * d, 0, z + oz * d];
  C[1] = Math.max(H(x, z) + d * 0.35, H(C[0], C[2]) + 1.7);
  const P = [x, H(x, z) + 0.5, z];
  const dx = P[0] - C[0], dy = P[1] - C[1], dz = P[2] - C[2];
  cam.setMode('fly', { heightAt: H, size: ws, seaLevel: t.seaLevel });
  app.camMode = 'fly';
  cam.fly.pos = C;
  cam.fly.yaw = Math.atan2(dx, -dz); cam.fly.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  cam.update(1, {}, { heightAt: H, size: ws, seaLevel: t.seaLevel });
  console.log('prop', key, d, 'of', hits.length, 'at', x.toFixed(1), z.toFixed(1), 'sun xz', sd.map(q => q.toFixed(2)).join(','));
  return true;
}
let perf = [];
for (const s of steps) {
  if (s.startsWith('prop:')) { const [, key, d, pk] = s.split(':'); closeProp(key, +d || 6, +pk || 0); await pump(40, s); continue; }
  if (s === 'orbit') { await pump(30, 'orbit'); }
  else if (s === 'drone') { app.drone('ridge'); await pump(60, 'drone'); }
  else if (s === 'river') { app.drone('river'); await pump(60, 'river'); }
  else if (s === 'fly') { app.setCam('fly'); await pump(10, 'fly'); }
  else if (s === 'valley' || s === 'ridge') { shotCam(s); await pump(12, s); }
  else if (s.startsWith('close:')) { const [, kind, d, pk] = s.split(':'); closeCam(kind, +d || 5, +pk || 0); await pump(24, s); }
  else if (s === 'home') { app.setCam('orbit'); app.cam.frameWorld({ size: app.terrain.worldSize, midH: 0 }, 0.55); app.cam.orbit.pitch = -0.36; app.cam.orbit.dist = Math.min(app.cam.orbit.dist, 15000); await pump(30, 'home'); }
  else if (s === 'ready') { const v = app.fg.modules.find(m => m.role === 'vegetation'); const t0 = performance.now(); for (let k = 0; k < 2; k++) { for (let i = 0; i < 3000 && v && !String(v.stats().assets).startsWith('loaded') && v.stats().assets !== 'failed'; i++) await pump(1); await pump(30); } await pump(10); console.log('veg ready', v && JSON.stringify(v.stats()).slice(0, 160), ((performance.now() - t0) / 1000).toFixed(1) + ' s'); }
  else if (s.startsWith('pump')) { await pump(+s.slice(4) || 10, s); }
  else if (s.startsWith('tod')) { app.setTod(+s.slice(3)); app.setPlaying(false); await pump(20, s); }
  else if (s.startsWith('season')) { app.season = +s.slice(6); await pump(10, s); }
  else if (s.startsWith('wx-')) { app.setWeather(s.slice(3), true); await pump(30, s); }
  else if (s.startsWith('preset:')) { app.applyPreset(s.slice(7)); await waitGen(); console.log('preset', s.slice(7), 'seed', app.opts.seed); }
  else if (s.startsWith('seed:')) { app.setOpt('seed', +s.slice(5)); app.generate(); await waitGen(); }
  else if (s.startsWith('q:')) { app.setQuality(+s.slice(2)); await pump(10, s); }
  else if (s.startsWith('eval:')) { console.log(s.slice(5), '->', String(eval(s.slice(5))).slice(0, 300)); }
  else if (s.startsWith('rand:')) { app.randomiseAll ? app.randomiseAll(+s.slice(5)) : app.randomise(null); await waitGen(); console.log('random world', location.hash || '', JSON.stringify({ tod: app.tod, wx: app.weatherId, season: app.season })); }
  else if (s.startsWith('perf')) {
    // wall time per frame to queue done (CPU encode + GPU), N frames
    const N = +s.slice(4) || 20, dev = app.gpu.device, ts = [];
    for (let i = 0; i < N; i++) {
      const q = rafQ.splice(0); t += 1000 / 30;
      const t0 = performance.now();
      for (const cb of q) cb(t);
      await dev.queue.onSubmittedWorkDone();
      ts.push(performance.now() - t0);
    }
    ts.sort((a, b) => a - b);
    console.log('PERF', args.tag || '', 'q', app.qualityIndex, app.fg.w + 'x' + app.fg.h, 'median ms', ts[N >> 1].toFixed(1), 'p10', ts[Math.floor(N * 0.1)].toFixed(1), 'p90', ts[Math.floor(N * 0.9)].toFixed(1));
  }
  else if (s === 'saver') { const labels = []; const r = win.snSaver ? win.snSaver.enter({ seed: 5, label: l => labels.push(l) }) : globalThis.snSaver.enter({ seed: 5, label: l => labels.push(l) }); console.log('saver enter ->', !!r.canvas, r.warmupMs); await pump(200, 'saver'); console.log('labels', labels.length, labels.at(-1) && labels.at(-1).sub, labels.at(-1) && labels.at(-1).code && labels.at(-1).code.name); }
  else if (s === 'dice') { document.getElementById('randBtn').click(); await until(() => app.gen && !app.gen.running, 900); await pump(10, 'dice'); }
  else if (s.startsWith('gen:')) {
    // shoot the forming terrain at each new stage
    const base = s.slice(4); let last = null, k = 0;
    app.generate();
    for (let i = 0; i < 900 && app.gen.running; i++) {
      await pump(1);
      if (app.gen.stage !== last && app.gen.stage) { last = app.gen.stage; await pump(22); await globalThis.__shoot(app.gpu.device, OUT + '/' + base + '-' + (k++) + '-' + last + '.png'); }
    }
    await pump(25); await globalThis.__shoot(app.gpu.device, OUT + '/' + base + '-' + (k++) + '-done.png');
  }
  else if (s.startsWith('build:')) {
    // "Watch it build": play to points of the timeline and shoot each one.
    // build:<name>[@i:u+i:u+...] (i stage 0..7, u 0..1); default: two per stage
    const [base, list] = s.slice(6).split('@');
    const { SEGMENTS, timeOfSeg } = await import('../build.js');
    const p = app.player;
    if (!p.active) app.setBuildMode(true);
    const pts = (list || SEGMENTS.flatMap((_, i) => [i + ':0.3', i + ':0.85']).join('+')).split('+');
    for (const q of pts) {
      const [i, u] = q.split(':').map(Number);
      p.seek(Math.max(0, timeOfSeg(i, u) - 1.2)); p.playing = true;
      await pump(36);
      const inf = p.info();
      console.log('build', q, inf.name, 't', inf.t.toFixed(1), inf.held ? 'held' : '', 'cam pitch', app.cam.orbit.pitch.toFixed(2), 'dist', Math.round(app.cam.orbit.dist));
      await globalThis.__shoot(app.gpu.device, `${OUT}/${base}-${i}-${String(u).replace('.', '')}-${SEGMENTS[i].id}.png`);
    }
  }
  else if (s.startsWith('shoot:')) { const f = s.slice(6); await globalThis.__shoot(app.gpu.device, f.startsWith('/') ? f : OUT + '/' + f); }
}
console.log('warnings', errs.length, 'status', document.getElementById('stMain').textContent, '/', document.getElementById('stRight').textContent);
Deno.exit(0);
