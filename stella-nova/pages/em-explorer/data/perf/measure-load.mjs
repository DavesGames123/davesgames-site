// Measure the em-explorer load path in node with real fetches.
// usage: node stella-nova/pages/em-explorer/data/perf/measure-load.mjs <dataset id> [--w 1440 --h 900 --dpr 2 --phone --mode before|after --limit 60]
// Simulates: openVolume -> viewer frame loop (TileStore + computeWants) at
// the dataset home view. JPEG chunks are not decoded (the SOF header gives
// the size); decode cost in a browser worker is about 1 ms per chunk.
const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const dsId = args[0] || 'hemibrain';
const W = +opt('w', 1440), H = +opt('h', 900), DPR = +opt('dpr', 2), PHONE = !!opt('phone', false);
const LIMIT = +opt('limit', 60) * 1000;
const MODE = opt('mode', 'after');

const cat = await import(REPO + '/catalog/index.js');
const data = await import(REPO + '/data/engine.js');
const camera = await import(REPO + '/view/camera.js');
const { TileStore, tileKey, posKey } = await import(REPO + '/view/tiles.js');
let plan = null;
try { plan = await import(REPO + '/view/plan.js'); } catch (e) { /* before */ }

const rec = cat.DATASETS.find((d) => d.id === dsId);
const T0 = performance.now();
const t = () => Math.round(performance.now() - T0);
const log = [];
const reqs = [];
let bytes = 0, live = 0, maxLive = 0;
// browsers open at most 6 HTTP/1.1 connections per host (S3 has no HTTP/2);
// GCS speaks HTTP/2, so no host cap there
const h1 = new Map();
const H1_CAP = 6;
async function hostSlot(url) {
  const host = new URL(url).host;
  if (!/amazonaws\.com$/.test(host)) return () => {};
  let q = h1.get(host); if (!q) h1.set(host, q = { n: 0, wait: [] });
  if (q.n >= H1_CAP) await new Promise((r) => q.wait.push(r));
  q.n++;
  return () => { q.n--; const w = q.wait.shift(); if (w) w(); };
}
const timedFetch = async (url, init) => {
  const release = await hostSlot(url);
  const r = { url: url.replace(/^https:\/\/[^/]+\//, ''), range: init && init.headers && init.headers.Range, t0: t(), live: ++live };
  maxLive = Math.max(maxLive, live);
  try {
    const res = await fetch(url, init);
    const buf = new Uint8Array(await res.arrayBuffer());
    r.t1 = t(); r.n = buf.length; r.status = res.status; bytes += buf.length;
    reqs.push(r);
    return new Response(buf, { status: res.status, headers: res.headers });
  } finally { live--; release(); }
};
function jpegSize(b) {
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  throw new Error('no SOF');
}
const decodeJpeg = async (b) => { const s = jpegSize(b); return { data: new Uint8Array(s.width * s.height), ...s }; };

const AFTER = MODE === 'after';
const engineOpts = { fetch: timedFetch, decodeJpeg, cacheBytes: 256 << 20,
  maxInFlight: opt('inflight') ? +opt('inflight') : AFTER ? data.BROWSER_IN_FLIGHT : 8,
  prefixBytes: AFTER ? data.PREFIX_BYTES : 0, hostCap: AFTER ? 6 : 0 };
const engine = data.createEngine(engineOpts);
const tag = (name) => { log.push([t(), name]); };

// open
const home = rec.home;
let meta;
if (!AFTER) plan = null;
meta = await engine.open(rec);
tag('open (info / zattrs) done');
const vol = { ...meta, getSlice: (si, p, i, r, o) => engine.getSlice(meta.vid, si, p, i, r, o), setFocus: (nm) => engine.setFocus(meta.vid, nm) };
let warmed = false;

// viewer state at the home view
const p = home.plane || 'xy';
const insets = PHONE ? { top: 80, right: 0, bottom: 120, left: 0 } : { top: 60, right: 0, bottom: 42, left: 388 };
const views = camera.layoutViews(W, H, 'single', p, insets);
const r0 = vol.scales[0].resolution;
const cam = { center: [home.x, home.y, home.z].map((v, i) => (v + 0.5) * r0[i]), nmPerPx: camera.zoomToNmPerPx(vol, p, home.zoom) };
camera.clampCamera(cam, vol, camera.zoomLimits(vol, p, W, H));
const lodBias = PHONE ? 1.35 : 1.0;
const sc = vol.scales, base = camera.baseScale(sc);
const fine0 = camera.fine0For(vol, p);
const tgt = plan ? plan.targetScale(vol, p, cam.nmPerPx, DPR, lodBias) : camera.chooseScale(sc, p, cam.nmPerPx / DPR, lodBias, fine0);

function wantsBefore(vw, out, ready) {
  const n = camera.PLANES[p].n, seen = new Set();
  const add = (L, prio, margin = 0, maxD = Infinity, dIndex = 0) => {
    const idx = camera.sliceIndex(sc[L], p, cam.center[n]) + dIndex;
    if (idx < 0 || idx >= sc[L].size[n]) return;
    for (const tl of camera.visibleTiles(vw, cam, sc[L], margin)) {
      if (tl.d > maxD) continue;
      const key = tileKey('v', L, p, idx, tl.tu, tl.tv);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, posKey: posKey('v', L, p, tl.tu, tl.tv), index: idx, scale: L, plane: p, rect: tl.rect, prio: prio + tl.d, level: L });
    }
  };
  add(base, 0, 1);
  if (tgt + 2 < base) add(tgt + 2, 100);
  if (tgt < base) { add(tgt, 200); add(tgt, 600, 1); }
}
const levelOf = {};
if (plan) { for (const w of plan.wantLevels(vol, views[0], cam, tgt)) if (w.margin === 0 || w.L === base) levelOf[w.L === base ? 'base' : w.L === tgt ? 'tgt' : 'L' + w.L] = w.L; }
else Object.assign(levelOf, { base, mid: tgt + 2 < base ? tgt + 2 : null, tgt });
const needed = new Map(); // level -> Set of keys in view (no margin)
for (const [name, L] of Object.entries(levelOf)) {
  if (L == null) continue;
  const n = camera.PLANES[p].n, idx = camera.sliceIndex(sc[L], p, cam.center[n]);
  needed.set(name, new Set(camera.visibleTiles(views[0], cam, sc[L]).map((tl) => tileKey('v', L, p, idx, tl.tu, tl.tv))));
}
const doneAt = {};
const store = new TileStore({
  maxInFlight: PHONE ? 8 : 12, lookahead: plan ? plan.LOOKAHEAD : Infinity,
  maxTiles: 900,
  load: (d, signal) => vol.getSlice(d.scale, d.plane, d.index, d.rect, { signal, priority: d.prio }),
  upload: (res) => ({}),
  onLoad: (tl) => {
    if (!tl) return;
    for (const [name, set] of needed) {
      if (set.has(tl.key)) {
        set.delete(tl.key);
        if (!doneAt[name + ' first']) { doneAt[name + ' first'] = t(); tag(`first ${name} tile (s${levelOf[name]})`); }
        if (!set.size && !doneAt[name]) { doneAt[name] = t(); tag(`all ${name} tiles in view (s${levelOf[name]})`); }
      }
    }
  },
});
const counts = {};
for (const [name, set] of needed) counts[name] = set.size;
console.log(`dataset ${dsId}, view ${W}x${H} CSS, dpr ${DPR}${PHONE ? ', phone' : ''}, plane ${p}, zoom ${home.zoom}, nm/CSS px ${cam.nmPerPx.toFixed(1)}`);
console.log('mode ' + MODE + ', levels: ' + Object.entries(levelOf).filter(([, L]) => L != null).map(([k, L]) => `${k} s${L} (${counts[k]} tiles)`).join(', ') + `; target chunk ${JSON.stringify(sc[tgt].chunk)}`);
await new Promise((resolve) => {
  const tick = () => {
    const out = [];
    const ready = !needed.get('tgt').size;
    if (plan) plan.computeWants(views[0], 0, { vol, cam, dpr: DPR, lodBias, volKey: 'v', ready }, out);
    else wantsBefore(views[0], out, ready);
    store.want(out);
    if (plan && !warmed && out.length) { warmed = true; engine.prefetchIndexes(meta.vid, plan.chunkGroups(vol, out)).then((n) => tag(`index prefetch done (${n} chunks)`)); }
    if (ready || performance.now() - T0 > LIMIT) return resolve();
    setTimeout(tick, 16);
  };
  tick();
});
tag(needed.get('tgt').size ? `stopped at ${LIMIT / 1000} s, ${needed.get('tgt').size} target tiles left` : 'sharp view done');
const st = engine.stats();
for (const [ms, name] of log) console.log(String(ms).padStart(7) + ' ms  ' + name);
console.log(`requests ${reqs.length}, bytes ${(bytes / 1e6).toFixed(1)} MB, most in flight ${maxLive}, cache chunks ${st.chunks}`);
const first = reqs.slice().sort((a, b) => a.t0 - b.t0).slice(0, +opt('show', 8));
for (const r of first) console.log(`   ${String(r.t0).padStart(6)}-${String(r.t1).padStart(6)} ms ${String(r.n).padStart(8)} B ${r.range || ''} ${r.url.slice(-70)}`);
if (opt('json')) console.log('JSON ' + JSON.stringify({ dsId, log, reqs: reqs.length, bytes, maxLive }));
process.exit(0);
