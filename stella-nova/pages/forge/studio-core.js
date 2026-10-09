// ============================================================================
//  PLANET FORGE  ·  studio-core.js — the render studio without the DOM
// ----------------------------------------------------------------------------
//  The studio renders a queue of planets offscreen with the renderer of the
//  live view (render.js createRenderer, a second instance with an
//  'rgba8unorm' target). studio.js is the panel; Deno and node tests drive
//  this module directly.
//
//  JOBS  makeJobs(spec) -> [{ id, planet, render }]
//    spec.source 'random'      n draws of randomize.js draw(mode, seed + i)
//                'variations'  n mutate(current, amount, seed + i)
//                'list'        the saved recipes, one job each
//    spec.render  the render settings (RENDER_DEFAULT keys); with
//    spec.matchAll false each job draws its own framing, sun, yaw and hour.
//  RENDER keys: res (long side px), aspect (ASPECTS id), framing (FRAMINGS
//    id), sun ('auto' or the phase angle in deg: 0 full, 90 half, 150
//    crescent), sunEl (deg), background ('stars', 'black', 'transparent'),
//    exposure ('auto' or a number), hours (cloud and spin state), yaw (rad).
//  cameraFor(P, r, w, h) -> the render.js cam (pos, target, up, fov,
//    sunDir, spin, starGain, sunGain). The planet is radius 1 at the origin.
//
//  RENDER  renderJob(ctx, job, hooks): maps (ctx.generate) -> setPlanet ->
//    auto exposure on a 160 px preview -> tiles (planTiles, ctx.tile px,
//    principal point offset per tile: res = the full size, off = -tile
//    origin) -> one RGBA buffer -> PNG. Each tile waits for the queue, so
//    the page stays live. The tile texture and the readback buffer are
//    made once per run; destroyRun frees them and the renderer. Error
//    scopes catch validation and out-of-memory errors per job; a lost device
//    stops the run.
//  TRANSPARENT  black sky, no sun disc; alpha 1 where the ray meets the
//    planet, else the brightest channel (the glow of the limb and the
//    rings), and the colour is divided by alpha. Exact for the planet;
//    an approximation for the haze and the rings.
//
//  QUEUE  createQueue({ run, onChange, maxBytes }): add(jobs), start(),
//    cancel(), clear() (drops the finished jobs); one job at a time; a job's result keeps only its
//    PNG bytes and a thumbnail. When the kept bytes pass maxBytes the queue
//    pauses ('full') until the gallery is cleared.
//  RECIPES  recipeOf(job, res) / jobFromRecipe(json): the planet, the
//    render settings with the resolved exposure, and the size.
//    zipFiles(results) -> [[name, bytes]] (a PNG and a JSON per result).
//
//  grep -n targets: "export const ASPECTS", "export const FRAMINGS", "export function maxRes",
//  "export function outputSize", "export function planTiles", "export function cameraFor",
//  "export function makeJobs", "export async function createRun", "export async function renderJob",
//  "export function createQueue", "export function recipeOf", "export function jobFromRecipe",
//  "export function zipFiles", "function alphaFor"
// ============================================================================
import { createRenderer, worldFrame } from './render.js';
import { encodePNG } from './png.js';
import * as PR from './presets.js';
import { draw, mutate, clean } from './randomize.js';
import { makeDice } from './archetypes.js';
import { pickWidth } from './budget.js';

export const STUDIO_FORMAT = 'stella-nova-studio';
export const ASPECTS = [
  { id: 'square', label: 'square', r: [1, 1] }, { id: '16:9', label: '16:9', r: [16, 9] }, { id: '4:3', label: '4:3', r: [4, 3] },
  { id: '21:9', label: '21:9', r: [21, 9] }, { id: 'phone', label: 'phone portrait', r: [9, 19.5] },
];
export const FRAMINGS = [
  { id: 'disc', label: 'full disc', phase: 50 }, { id: 'crescent', label: 'crescent', phase: 148 },
  { id: 'limb', label: 'limb close-up', phase: 70 }, { id: 'rings', label: 'ring plane', phase: 45 },
  { id: 'pole', label: 'pole', phase: 60 },
];
export const BACKGROUNDS = [{ id: 'stars', label: 'stars' }, { id: 'black', label: 'black' }, { id: 'transparent', label: 'transparent PNG' }];
export const RENDER_DEFAULT = { res: 2048, aspect: 'square', framing: 'disc', sun: 'auto', sunEl: 8, background: 'stars', exposure: 'auto', hours: 0, yaw: 0.6 };

const D = Math.PI / 180;
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The largest long side: phones 2048, tablets 3072, desktops 4096, and
// never past the device's texture limit.
export function maxRes(env = {}, limits = {}) {
  const cap = env.mobile ? 2048 : env.coarse ? 3072 : 4096;
  return Math.min(cap, limits.maxTextureDimension2D || 8192);
}
export function outputSize(res, aspect = 'square') {
  const a = (ASPECTS.find(x => x.id === aspect) || ASPECTS[0]).r, k = a[0] / a[1];
  const even = v => Math.max(2, Math.round(v / 2) * 2);
  return k >= 1 ? { w: even(res), h: even(res / k) } : { w: even(res * k), h: even(res) };
}
export function planTiles(w, h, t) {
  const out = [];
  for (let y = 0; y < h; y += t) for (let x = 0; x < w; x += t) out.push({ x, y, w: Math.min(t, w - x), h: Math.min(t, h - y) });
  return out;
}
// Map width for an output size: enough texels for the disc, within the
// CPU budget (budget.js pickWidth).
export const mapWidthFor = (res, env = {}) => pickWidth(res > 2600 ? 4096 : res > 700 ? 2048 : 1024, env);

// Camera and sun for one render (world frame, planet radius 1).
export function cameraFor(P, r, w, h) {
  const R = { ...RENDER_DEFAULT, ...r }, A = w / h;
  const tilt = P.tilt || 0, spin = ((R.hours || 0) / 24) * 2 * Math.PI * (P.spin || 1) % (2 * Math.PI);
  const fr = FRAMINGS.find(f => f.id === R.framing) || FRAMINGS[0];
  const phase = (R.sun === 'auto' || R.sun == null ? fr.phase : +R.sun) * D, el = (R.sunEl || 0) * D;
  const top = P.atmo && P.atmo.on ? 1 + P.atmo.heightKm / P.atmo.radiusKm : 1;
  const ringOut = P.rings && P.rings.on ? P.rings.outer : 0;
  const pole = worldFrame([0, 1, 0], tilt, spin);
  const fov = (R.framing === 'limb' ? 42 : 30) * D, hv = fov / 2, hh = Math.atan(A * Math.tan(hv));
  let c, up = [0, 1, 0];
  const yaw = R.yaw ?? 0.6;
  if (R.framing === 'rings') { c = norm(worldFrame([Math.sin(yaw), Math.sin(4 * D), Math.cos(yaw)], tilt, spin)); up = pole; }
  else if (R.framing === 'pole') { c = norm(worldFrame([Math.sin(yaw) * Math.sin(22 * D), Math.cos(22 * D), Math.cos(yaw) * Math.sin(22 * D)], tilt, spin)); up = norm(worldFrame([-Math.sin(yaw), 0, -Math.cos(yaw)], tilt, spin)); }
  else c = norm([Math.sin(yaw) * Math.cos(0.2), Math.sin(0.2), Math.cos(yaw) * Math.cos(0.2)]);
  // an eyeball world keeps its warm pole on the sun: the camera moves round it
  const lock = P.view && P.view.lockSun;
  const side = v => { const s = cross(up, v); return Math.hypot(...s) < 1e-4 ? norm(cross([1, 0, 0], v)) : norm(s); };
  let sun;
  if (lock) { sun = pole; const s = side(sun); c = norm(add(scl(sun, Math.cos(phase)), s, Math.sin(phase))); up = Math.abs(dot(c, [0, 1, 0])) > 0.95 ? [1, 0, 0] : [0, 1, 0]; }
  const u = norm(add(up, c, -dot(up, c))), s = side(c);
  if (!lock) sun = norm(add(add(scl(c, Math.cos(phase) * Math.cos(el)), s, Math.sin(phase) * Math.cos(el)), u, Math.sin(el)));
  // distance: the disc (and the rings) fit with a margin
  let pos, target = [0, 0, 0];
  if (R.framing === 'limb') {
    const d = 1.38, hz = Math.asin(1 / d), a = hz - 0.42 * hv;
    pos = scl(c, d);
    target = add(pos, norm(add(scl(c, -Math.cos(a)), u, Math.sin(a))));
  } else {
    const Rh = Math.max(top * 1.02, ringOut), tiltView = ringOut ? Math.abs(dot(c, pole)) : 0;
    const Rv = Math.max(top * 1.02, ringOut * (tiltView + 0.08));
    const d = Math.max(Rh / Math.sin(0.86 * hh), Rv / Math.sin(0.86 * hv), 1.6);
    pos = scl(c, d);
  }
  return { pos, target, up: u, fov, sunDir: sun, spin };
}

// ── jobs ────────────────────────────────────────────────────────────────
let jobId = 1;
const variedRender = (F, r) => ({ ...r, framing: F.pick(['disc', 'disc', 'disc', 'crescent', 'limb', 'pole', 'rings']), sun: Math.round(F.u(25, 120)), sunEl: Math.round(F.u(-5, 25)), yaw: +F.u(0, 6.28).toFixed(3), hours: Math.round(F.u(0, 96)) });
export function makeJobs(spec) {
  const n = Math.max(0, Math.min(500, spec.n | 0 || 0)), seed = spec.seed >>> 0, base = { ...RENDER_DEFAULT, ...spec.render };
  let planets = [];
  if (spec.source === 'random') planets = Array.from({ length: n }, (_, i) => draw(spec.mode || 'any', seed + i, spec.current && spec.current.preset));
  else if (spec.source === 'variations') planets = Array.from({ length: n }, (_, i) => mutate(spec.current, spec.amount ?? 0.4, seed + i));
  else planets = (spec.list || []).map(p => clean(p));
  return planets.map((P, i) => {
    let r = { ...base };
    if (!spec.matchAll) r = variedRender(makeDice(seed + i, 'render'), r);
    if (r.framing === 'rings' && !(P.rings && P.rings.on) && !spec.matchAll) r.framing = 'disc';
    return { id: jobId++, planet: P, render: r };
  });
}

// ── one run: the renderer, the tile target and the readback buffer ─────
export async function createRun({ device, loadText, tile = 1024 }) {
  const R = await createRenderer({ device, format: 'rgba8unorm', loadText });
  const tex = device.createTexture({ size: [tile, tile], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const bpr = Math.ceil(tile * 4 / 256) * 256;
  const buf = device.createBuffer({ size: bpr * tile, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const run = { device, R, tex, view: tex.createView(), buf, bpr, tile, lost: false };
  device.lost.then(() => { run.lost = true; });
  return run;
}
export function destroyRun(run) {
  if (!run) return;
  try { run.R.destroy(); } catch (e) { /* gone */ }
  try { run.tex.destroy(); } catch (e) { /* gone */ }
  try { run.buf.destroy(); } catch (e) { /* gone */ }
}

// Render one tile of the full image into the tile texture and read it back.
async function renderTile(run, cam, t, W, H, out) {
  const { device, R, tex, buf, bpr } = run;
  R.render({ ...cam, w: W, h: H, offX: -t.x, offY: -t.y }, run.view);
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [t.w, t.h]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  for (let y = 0; y < t.h; y++) out.set(src.subarray(y * bpr, y * bpr + t.w * 4), ((t.y + y) * W + t.x) * 4);
  buf.unmap();
}

// Mean of the lit planet pixels and the 99th percentile (auto exposure).
export function exposureStats(rgba) {
  const lum = [];
  for (let i = 0; i < rgba.length; i += 4) { const l = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255; if (l > 0.03) lum.push(l); }
  if (lum.length < 20) return { mean: 0, p99: 0, n: lum.length };
  lum.sort((a, b) => a - b);
  return { mean: lum.reduce((a, b) => a + b, 0) / lum.length, p99: lum[Math.floor(lum.length * 0.99)], n: lum.length };
}
// The next exposure toward a lit mean of 0.36, at most x1.5 (a dark world
// stays dark: more gain only lifts its haze) and with no more than 1 % clipped.
export function nextExposure(e, st) {
  if (!st.n || st.mean <= 0) return e;
  let k = Math.min(1.5, Math.max(0.5, 0.36 / st.mean));
  if (st.p99 > 0.97) k = Math.min(k, 0.85);
  return Math.min(3, Math.max(0.1, e * k));
}

// alpha for a transparent background (see the header)
function alphaFor(rgba, cam, W, H) {
  const f = norm([cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]]);
  const r = norm(cross(f, cam.up)), u = cross(r, f), th = Math.tan(cam.fov / 2), A = W / H, o = cam.pos, oo = dot(o, o) - 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x + 0.5) / W * 2 - 1, ny = 1 - (y + 0.5) / H * 2;
    const d = norm([f[0] + r[0] * nx * th * A + u[0] * ny * th, f[1] + r[1] * nx * th * A + u[1] * ny * th, f[2] + r[2] * nx * th * A + u[2] * ny * th]);
    const b = dot(o, d), disc = b * b - oo, i = (y * W + x) * 4;
    if (disc > 0 && -b - Math.sqrt(disc) > 0) { rgba[i + 3] = 255; continue; }
    const m = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (m <= 3) { rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0; continue; }
    const k = 255 / m;
    rgba[i] = Math.min(255, rgba[i] * k); rgba[i + 1] = Math.min(255, rgba[i + 1] * k); rgba[i + 2] = Math.min(255, rgba[i + 2] * k); rgba[i + 3] = m;
  }
}

// Box-filtered thumbnail (RGBA), long side t px.
export function thumbnail(rgba, W, H, t = 256) {
  const k = Math.max(1, Math.ceil(Math.max(W, H) / t)), w = Math.max(1, Math.floor(W / k)), h = Math.max(1, Math.floor(H / k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = [0, 0, 0, 0];
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const q = ((y * k + j) * W + x * k + i) * 4; s[0] += rgba[q]; s[1] += rgba[q + 1]; s[2] += rgba[q + 2]; s[3] += rgba[q + 3]; }
    const o = (y * w + x) * 4, n = k * k;
    out[o] = s[0] / n; out[o + 1] = s[1] / n; out[o + 2] = s[2] / n; out[o + 3] = s[3] / n;
  }
  return { w, h, data: out };
}

// ctx: { run, generate(P, W) -> M, env, encode?(rgba, w, h) -> bytes }
// hooks: { onProgress(f), cancelled() }
export async function renderJob(ctx, job, hooks = {}) {
  const { run, env = {} } = ctx, prog = hooks.onProgress || (() => {}), stop = hooks.cancelled || (() => false);
  if (run.lost) throw new Error('GPU device lost: reload the page');
  const P = job.planet, r = { ...RENDER_DEFAULT, ...job.render };
  const { w: W, h: H } = outputSize(Math.min(r.res, ctx.maxRes || 4096), r.aspect);
  const mw = mapWidthFor(Math.max(W, H), env);
  prog(0.02);
  let M = await ctx.generate(P, mw, f => prog(0.02 + 0.4 * f));
  if (stop()) throw new Error('cancelled');
  const device = run.device;
  device.pushErrorScope('out-of-memory'); device.pushErrorScope('validation');
  run.R.setPlanet(P, M, env);
  M = null;
  const cam0 = cameraFor(P, r, W, H), bg = r.background;
  const cam = { ...cam0, t: 1, steps: 32, cloudsOn: true, flowSpeed: 1, hours: r.hours || 0, quality: 2,
    starGain: bg === 'stars' ? 1 : 0, sunGain: bg === 'stars' ? 1.6 : 0, exposure: P.view && P.view.exposure || 0.65 };
  if (r.exposure !== 'auto' && Number.isFinite(+r.exposure)) cam.exposure = +r.exposure;
  else {
    // auto exposure: a small preview of the same shot, without the sky
    const pv = outputSize(Math.min(160, run.tile), r.aspect), px = new Uint8Array(pv.w * pv.h * 4);
    for (let pass = 0; pass < 2; pass++) {
      await renderTile(run, { ...cam, starGain: 0, sunGain: 0 }, { x: 0, y: 0, w: pv.w, h: pv.h }, pv.w, pv.h, px);
      cam.exposure = nextExposure(cam.exposure, exposureStats(px));
    }
  }
  const rgba = new Uint8Array(W * H * 4), tiles = planTiles(W, H, run.tile);
  for (let i = 0; i < tiles.length; i++) {
    if (stop()) break;
    if (run.lost) break;
    await renderTile(run, cam, tiles[i], W, H, rgba);
    prog(0.45 + 0.45 * (i + 1) / tiles.length);
  }
  const vErr = await device.popErrorScope(), mErr = await device.popErrorScope();
  if (run.lost) throw new Error('GPU device lost: reload the page');
  if (vErr || mErr) throw new Error((mErr ? 'out of GPU memory: ' : 'GPU error: ') + (mErr || vErr).message);
  if (stop()) throw new Error('cancelled');
  if (bg === 'transparent') alphaFor(rgba, cam, W, H);
  const thumb = thumbnail(rgba, W, H, 256);
  const png = ctx.encode ? await ctx.encode(rgba, W, H) : await encodePNG({ width: W, height: H, channels: 4, depth: 8, data: rgba });
  prog(1);
  const render = { ...r, exposure: +cam.exposure.toFixed(4), mapWidth: mw };
  return { png, thumb, w: W, h: H, recipe: recipeOf({ planet: P, render }, { w: W, h: H }) };
}

// ── queue ───────────────────────────────────────────────────────────────
export function createQueue({ run, onChange = () => {}, maxBytes = 1.5e9 }) {
  const jobs = [];
  let active = false, cancelFlag = false, kept = 0;
  const Q = {
    jobs, get running() { return active; }, get bytes() { return kept; }, state: 'idle',
    add(list) { for (const j of list) jobs.push({ ...j, status: 'queued', progress: 0 }); onChange(Q); return Q; },
    cancel() { cancelFlag = true; for (const j of jobs) if (j.status === 'queued') j.status = 'cancelled'; onChange(Q); },
    clear() { for (let i = jobs.length - 1; i >= 0; i--) if (/done|failed|cancelled/.test(jobs[i].status)) jobs.splice(i, 1); kept = 0; for (const j of jobs) if (j.result) kept += j.result.png.length; if (Q.state === 'full') Q.state = 'idle'; onChange(Q); },
    remove(id) { const i = jobs.findIndex(j => j.id === id && j.status !== 'running'); if (i >= 0) { if (jobs[i].result) kept -= jobs[i].result.png.length; jobs.splice(i, 1); onChange(Q); } },
    async start() {
      if (active) return;
      active = true; cancelFlag = false; Q.state = 'running'; onChange(Q);
      try {
        for (const j of jobs) {
          if (cancelFlag) break;
          if (j.status !== 'queued') continue;
          if (kept >= maxBytes) { Q.state = 'full'; break; }
          j.status = 'running'; j.progress = 0; onChange(Q);
          try {
            j.result = await run(j, { onProgress: f => { j.progress = f; onChange(Q); }, cancelled: () => cancelFlag });
            j.status = 'done'; kept += j.result.png.length;
          } catch (e) {
            j.status = cancelFlag || e.message === 'cancelled' ? 'cancelled' : 'failed'; j.error = e.message;
            if (/device lost/.test(e.message)) { for (const k of jobs) if (k.status === 'queued') { k.status = 'failed'; k.error = e.message; } }
          }
          onChange(Q);
        }
      } finally {
        active = false;
        if (Q.state === 'running') Q.state = cancelFlag ? 'cancelled' : 'idle';
        onChange(Q);
      }
    },
  };
  return Q;
}

// ── recipes and the ZIP ─────────────────────────────────────────────────
export function recipeOf(job, size = {}) {
  const P = PR.clone(job.planet); delete P.rand;
  return { format: STUDIO_FORMAT, version: 1, planet: P, render: { ...RENDER_DEFAULT, ...job.render }, width: size.w || 0, height: size.h || 0 };
}
export function jobFromRecipe(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  if (!o || o.format !== STUDIO_FORMAT) {
    // a plain planet file (Maps tab JSON) also loads, with the default render
    if (o && o.format === PR.FORMAT) return { id: jobId++, planet: clean(o.planet), render: { ...RENDER_DEFAULT } };
    throw new Error('not a ' + STUDIO_FORMAT + ' file');
  }
  return { id: jobId++, planet: clean(o.planet), render: { ...RENDER_DEFAULT, ...o.render } };
}
const slug = s => String(s || 'planet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function fileBase(res, i) {
  const P = res.recipe.planet;
  return `${String(i + 1).padStart(3, '0')}-${slug(P.preset || P.kind)}-${P.seed}-${res.w}x${res.h}`;
}
export function zipFiles(results) {
  const out = [];
  results.forEach((r, i) => {
    const b = fileBase(r, i);
    out.push([b + '.png', r.png]);
    out.push([b + '.json', new TextEncoder().encode(JSON.stringify(r.recipe, null, 1))]);
  });
  return out;
}
