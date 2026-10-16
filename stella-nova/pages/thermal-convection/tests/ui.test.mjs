// ui (package UI): the pure helpers of ui.js, the explainer data, static
// checks of index.html / style.css / main.js (head order, ids, [hidden]
// guard, fonts, touch sizes), and two boot runs of main.js in jsdom with
// stub SIM, VIEW and SAVER modules (one desktop run with a fake WebGPU,
// one phone run with no WebGPU). The boot runs need jsdom: they look for
// it on NODE_PATH and are skipped (and say so) when it is not there.
// ok(name, cond, info). Run alone: node tests.mjs
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  fmtSci, fmtNum, raCrit, pickQuality, parseQuery, backingSize, presetParts, presetIds, occlusionOf,
  sliceThrough, statusText, SLIDERS, PHONE_Q, VIEWS, MODES,
} from '../ui.js';
import { EQUATIONS, RULES, TERMS, DEFINITIONS, SECTIONS, REFS, RA_CRIT, citeKeys } from '../explainer.js';
import { colorize } from '../../../lib/sci-math.js';

const here = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, here), 'utf8');
const balanced = s => { let d = 0; for (let i = 0; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '{') d++; else if (s[i] === '}' && --d < 0) return false; } return d === 0; };

export default async function run(ok) {
  // ── formats
  ok('ui: fmtSci(1e5) = 1.0 × 10⁵', fmtSci(1e5) === '1.0 × 10⁵', fmtSci(1e5));
  ok('ui: fmtSci(3000) = 3.0 × 10³', fmtSci(3000) === '3.0 × 10³');
  ok('ui: fmtSci rounds 9.96e4 up to 1.0 × 10⁵', fmtSci(99600) === '1.0 × 10⁵', fmtSci(99600));
  ok('ui: fmtSci(0.001) has a minus exponent', fmtSci(0.001) === '1.0 × 10⁻³', fmtSci(0.001));
  ok('ui: fmtSci of NaN is a dash', fmtSci(NaN) === '–');
  ok('ui: fmtNum', fmtNum(1) === '1.00' && fmtNum(0.5, 1) === '0.5' && fmtNum(2e5) === '2.0 × 10⁵');
  ok('ui: raCrit rigid 1707.76, free 1100.65', raCrit('rigid') === 1707.76 && raCrit('free') === 1100.65 && RA_CRIT.freefree === 657.51);

  // ── quality, query, backing store
  ok('ui: phone gets quality 0', pickQuality({ w: 390, h: 844, coarse: true }) === 0);
  ok('ui: tablet gets quality 1', pickQuality({ w: 820, h: 1180, coarse: true, cores: 8 }) === 1);
  ok('ui: desktop gets quality 2', pickQuality({ w: 1920, h: 1080, cores: 10 }) === 2);
  ok('ui: 4 cores on a desktop gives quality 1', pickQuality({ w: 1920, h: 1080, cores: 4 }) === 1);
  ok('ui: ?q overrides', pickQuality({ w: 390, h: 844, coarse: true, q: 2 }) === 2);
  const q = parseQuery('?q=1&preset=soup&seed=42&view=block');
  ok('ui: parseQuery reads q, preset, seed, view', q.q === 1 && q.preset === 'soup' && q.seed === 42 && q.view === 'block', JSON.stringify(q));
  const bad = parseQuery('?q=7&preset=<x>&seed=-1&view=nope');
  ok('ui: parseQuery drops bad values', bad.q === null && bad.preset === null && bad.seed === null && bad.view === null, JSON.stringify(bad));
  const b1 = backingSize(1920, 1080, 3);
  ok('ui: dpr caps at 2 and the store at 2560 x 1440', b1.pw <= 2560 && b1.ph <= 1440 && b1.dpr <= 2, JSON.stringify(b1));
  const b2 = backingSize(390, 844, 3);
  ok('ui: phone portrait keeps dpr 2', b2.pw === 780 && b2.ph === 1688, JSON.stringify(b2));
  const b3 = backingSize(1440, 2560, 2);
  ok('ui: portrait cap is 1440 x 2560', b3.pw <= 1440 && b3.ph <= 2560, JSON.stringify(b3));

  // ── presets (both forms)
  const D = { Ra: 1e5, Pr: 1, Ma: 80, mode: 'plate', top: 'free', burner: { x: 0.5, y: 0.5, r: 0.12, power: 1.5 }, cool: 1, noise: 1e-3, speed: 1, Lx: 4, Ly: 4 };
  const nested = { soup: { name: 'Soup', params: { mode: 'burner', burner: { power: 2 } }, palette: 'broth', view: 'split' }, onset: { params: { Ra: 3000 } } };
  const flat = [{ id: 'granulation', mode: 'sun', Ra: 1e6, palette: 'solar', view: 'surface' }];
  const ps = presetParts(nested, D, 'soup');
  ok('ui: nested preset gives full params', ps.params.mode === 'burner' && ps.params.Ra === 1e5 && ps.params.burner.power === 2 && ps.params.burner.r === 0.12, JSON.stringify(ps.params));
  ok('ui: nested preset palette and view', ps.palette === 'broth' && ps.view === 'split' && ps.name === 'Soup');
  ok('ui: onset preset is from rest', presetParts(nested, D, 'onset').fromRest === true);
  const pf = presetParts(flat, D, 'granulation');
  ok('ui: flat array preset', pf.params.mode === 'sun' && pf.params.Ra === 1e6 && pf.palette === 'solar' && pf.view === 'surface' && !('palette' in pf.params), JSON.stringify(pf));
  ok('ui: presetParts does not change DEFAULTS', D.burner.power === 1.5 && D.mode === 'plate');
  ok('ui: presetIds of both forms', presetIds(nested).join() === 'soup,onset' && presetIds(flat).join() === 'granulation');
  ok('ui: unknown preset is null', presetParts(nested, D, 'nope') === null);

  // ── occlusion and slices
  const occ = occlusionOf([{ left: 0, top: 0, right: 300, bottom: 800 }, { left: 0, top: 760, right: 1280, bottom: 800 }, { left: 1100, top: 600, right: 1270, bottom: 700 }], 1280, 800);
  ok('ui: occlusion reads a left column and a base bar, not a corner box', occ.l === 300 && occ.b === 40 && occ.r === 0 && occ.t === 0, JSON.stringify(occ));
  const occ2 = occlusionOf([{ left: 0, top: 400, right: 390, bottom: 780 }], 390, 844);
  ok('ui: occlusion reads a bottom sheet', occ2.b === 444, JSON.stringify(occ2));
  const s0 = sliceThrough({ x: 2, y: 3 }, 0, 4, 4);
  ok('ui: a cut along x through y = 3 has offset 1', Math.abs(s0.offset - 1) < 1e-9 && s0.angle === 0, JSON.stringify(s0));
  const s1 = sliceThrough({ x: 3.9, y: 2 }, Math.PI / 2, 4, 4);
  ok('ui: a cut along y through x = 3.9 has offset -1.9', Math.abs(s1.offset + 1.9) < 1e-9, JSON.stringify(s1));
  ok('ui: offsets wrap into one period', Math.abs(sliceThrough({ x: 2, y: 4.5 }, 0, 4, 4).offset - (-1.5)) < 1e-9);
  const st = statusText({ Ra: 1e5, Pr: 1 }, { Nu: 2.345, vmax: 0.1234, simTime: 12.34 });
  ok('ui: status line has Ra, Pr, Nu, max |u|, t', st === 'Ra 1.0 × 10⁵ · Pr 1.00 · Nu 2.35 · max |u| 0.123 · t = 12.3 tff', st);
  ok('ui: status line without stats has dashes', statusText({ Ra: 1e5, Pr: 1 }, null).includes('Nu –'));

  // ── sliders
  const ra = SLIDERS.find(s => s.id === 'ra');
  ok('ui: Ra slider is log10', ra.toUI(1e5) === 5 && Math.abs(ra.fromUI(6) - 1e6) < 1e-6);
  const ang = SLIDERS.find(s => s.id === 'angle');
  ok('ui: angle slider shows degrees in 0..180', ang.toUI(Math.PI / 2) === 90 && ang.fmt(-Math.PI / 4) === '135°', ang.fmt(-Math.PI / 4));
  ok('ui: four heating modes have a note', ['plate', 'burner', 'sun', 'pan'].every(m => MODES[m]));
  ok('ui: four views', VIEWS.map(v => v.id).join() === 'split,block,surface,slice');

  // ── explainer
  for (const e of EQUATIONS) {
    const c = colorize(e.tex, RULES);
    ok(`explainer: ${e.id} TeX braces balance (raw and coloured)`, balanced(e.tex) && balanced(c));
  }
  for (const t of TERMS) for (const x of t.tex) {
    const hit = EQUATIONS.some(e => e.tex.includes(x));
    const col = EQUATIONS.some(e => colorize(e.tex, RULES).includes(`\\class{${t.cls}}{${x}}`));
    ok(`explainer: term ${t.key} is in an equation and coloured ${t.cls}`, hit && col, x);
  }
  ok('explainer: five coloured terms, five classes', new Set(TERMS.map(t => t.cls)).size === 5 && TERMS.length === 5);
  ok('explainer: Ra, Pr, Nu, Ma are defined', ['Rayleigh', 'Prandtl', 'Nusselt', 'Marangoni'].every(n => DEFINITIONS.some(d => d.name.startsWith(n))));
  ok('explainer: definitions TeX balances', DEFINITIONS.every(d => balanced(d.tex) && balanced(d.sym)));
  const keys = citeKeys();
  ok('explainer: every cite has a source', keys.every(k => REFS[k]), keys.join());
  ok('explainer: cites Bénard 1900, Pearson 1958, Chandrasekhar 1961, Nordlund 2009', ['benard1900', 'pearson1958', 'chandra1961', 'nordlund2009'].every(k => keys.includes(k)));
  ok('explainer: the Living Review DOI', REFS.nordlund2009.url === 'https://doi.org/10.12942/lrsp-2009-2');
  const all = SECTIONS.flatMap(s => s.paras).join(' ');
  ok('explainer: onset at Ra = 1708', all.includes('Ra = 1708') && all.includes('1101'));
  ok('explainer: granules 1000–1500 km, 5–10 minutes', all.includes('1000–1500 km') && all.includes('5–10 minutes'));
  ok('explainer: says what the model leaves out', /Boussinesq/.test(all) && /magnetic/.test(all) && /radiative transfer/.test(all));
  ok('explainer: illustrative values are marked', /Illustrative values/.test(all));
  ok('explainer: section ids are unique', new Set(SECTIONS.map(s => s.id)).size === SECTIONS.length);

  // ── static checks
  const html = read('index.html'), css = read('style.css'), main = read('main.js'), uijs = read('ui.js');
  const HEAD = '<script src="../../lib/gpu-guard.js"></script>\n<script src="../../lib/wishlist.js"></script>\n<script src="../../lib/stats-beacon.js"></script>\n';
  ok('static: head loads gpu-guard, wishlist, stats-beacon in order', html.includes('<head>\n' + HEAD));
  ok('static: title Thermal Convection', /<title>Thermal Convection\b/.test(html));
  ok('static: sci.css before style.css', html.indexOf('../../lib/sci.css') > 0 && html.indexOf('../../lib/sci.css') < html.indexOf('href="style.css"'));
  ok('static: main.js is a module', html.includes('<script type="module" src="main.js"></script>'));
  ok('static: #nogpu starts hidden', /<div id="nogpu" hidden>/.test(html));
  ok('static: style.css has the [hidden] guard', css.includes('[hidden]{display:none!important}'));
  ok('static: no KaTeX, Playfair, Cormorant or JetBrains', ![html, css, main, uijs].some(s => /katex|playfair|cormorant|jetbrains/i.test(s)));
  ok('static: no uppercase labels or letter-spacing', !/text-transform\s*:\s*uppercase|letter-spacing/i.test(css));
  ok('static: no blur, glow or scanline styles', !/blur\(|text-shadow|scanline/i.test(css));
  ok('static: a touch block with 44 px targets', /@media \(pointer:coarse\), \(max-width:768px\)\{/.test(css) && /min-height:44px/.test(css));
  ok('static: the phone media query matches PHONE_Q', css.includes('@media ' + PHONE_Q + '{'));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...(main + uijs).matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map(m => m[1]));
  for (const s of SLIDERS) { used.add(s.id); used.add(s.id + 'V'); }
  const missing = [...used].filter(i => !ids.has(i));
  ok('static: every id the scripts bind is in index.html', !missing.length, missing.join(', '));
  const dupIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) !== i);
  ok('static: no duplicate ids', !dupIds.length, dupIds.join(', '));
  ok('static: main.js imports the contract names',
    /import \{ DEFAULTS, PRESETS, clampParams, GRIDS \} from '\.\/sim\/params\.js'/.test(main)
    && /from '\.\/render\/palettes\.js'/.test(main) && /layoutRects, sliceSegment, wrapOffset \} from '\.\/render\/layout\.js'/.test(main)
    && /orbitCam, fitBlock \} from '\.\/render\/orbit\.js'/.test(main)
    && main.includes("import('./sim/gpu.js')") && main.includes("import('./render/views.js')") && main.includes("import('./saver.js')"));
  ok('static: window.TC is the app', /window\.TC = app/.test(main));
  ok('static: no Math.random in the UI', !/Math\.random/.test(main + uijs));

  await bootRuns(ok);
}

// ── BOOT RUNS ───────────────────────────────────────────────────────────
function findJsdom() {
  try { return createRequire(import.meta.url)('jsdom'); } catch { /* not on the path */ }
  for (const p of (process.env.NODE_PATH || '').split(':').filter(Boolean)) {
    try { return createRequire(join(p, 'x.js'))('jsdom'); } catch { /* next */ }
  }
  return null;
}

const STUBS = {
  'sim/params.js': `
export const DEFAULTS = { Ra: 1e5, Pr: 1, Ma: 80, mode: 'plate', top: 'free', burner: { x: 0.5, y: 0.5, r: 0.12, power: 1.5 }, cool: 1, noise: 1e-3, speed: 1, Lx: 4, Ly: 4 };
export const PRESETS = {
  granulation: { name: 'Solar granulation', params: { mode: 'sun', Ra: 1e6 }, palette: 'solar', view: 'surface' },
  soup: { name: 'Soup', params: { mode: 'burner', top: 'free' }, palette: 'broth' },
  benard: { name: 'Bénard cells', params: { mode: 'plate', Ra: 5e4 } },
  hexagons: { name: 'Hexagons', params: { mode: 'pan', Ma: 120 } },
  onset: { name: 'Onset', params: { mode: 'plate', Ra: 3000 } },
  turbulent: { name: 'Turbulent', params: { mode: 'plate', Ra: 5e6 } },
};
export function clampParams(p) { const q = JSON.parse(JSON.stringify(p)); q.Ra = Math.min(1e7, Math.max(1e3, q.Ra)); q.Pr = Math.min(10, Math.max(0.1, q.Pr)); return q; }
export const GRIDS = { 0: [64, 64, 16], 1: [96, 96, 24], 2: [128, 128, 32] };`,
  'sim/gpu.js': `
const L = () => globalThis.__tcLog;
export async function createSim(device, opts) {
  L().simCreated++; L().simOpts = opts;
  const g = { 0: [64, 64, 16], 1: [96, 96, 24], 2: [128, 128, 32] }[opts.quality];
  return {
    dims: { nx: g[0], ny: g[1], nz: g[2], Lx: 4, Ly: 4, dx: 4 / g[0] }, params: null, buffers: {}, time: 0,
    set(p) { this.params = p; L().simSets.push(JSON.parse(JSON.stringify(p))); },
    reset(seed) { L().resets.push(seed); }, setTracers(n) { L().tracers.push(n); },
    step(enc, dt) { L().steps++; this.time += dt; }, stats() { return { simTime: 1.5, Nu: 2.5, vmax: 0.2, Tmean: 0.5, ke: 0.01, hot: [1, 1], cold: [2, 2], plume: [2, 2] }; },
    destroy() { L().simDestroyed++; },
  };
}`,
  'render/palettes.js': `
export const PALETTES = {
  solar: { id: 'solar', name: 'Solar', stops: [[0, '#300000'], [1, '#fff8c0']] },
  broth: { id: 'broth', name: 'Broth', stops: [[0, '#2a1606'], [1, '#ffd060']] },
  inferno: { id: 'inferno', name: 'Inferno', stops: [[0, '#000004'], [1, '#fcffa4']] },
  icefire: { id: 'icefire', name: 'Ice and fire', stops: [[0, '#3060ff'], [0.5, '#101010'], [1, '#ff8020']] },
};
export function ramp(id, t) { return [t, t * 0.6, t * 0.2]; }
export function lut(id, n = 256) { return new Uint8Array(4 * n); }`,
  'render/layout.js': `
export function layoutRects(w, h, view, clear, opts) {
  globalThis.__tcLog.layout = { w, h, view, clear, opts };
  const x = clear.l, y = clear.t, W = w - clear.l - clear.r, H = h - clear.t - clear.b;
  if (view === 'block') return { block: { x, y, w: W, h: H } };
  if (view === 'surface') return { surface: { x, y, w: W, h: H } };
  if (view === 'slice') return { slice: { x, y, w: W, h: H } };
  return { surface: { x, y, w: W, h: H * 0.7 }, slice: { x, y: y + H * 0.7, w: W, h: H * 0.3 } };
}
export function wrapOffset(angle, offset, Lx = 4, Ly = 4) {
  const h = 0.5 * (Lx * Math.abs(Math.sin(angle)) + Ly * Math.abs(Math.cos(angle)));
  let o = (offset + h) % (2 * h); if (o < 0) o += 2 * h; return o - h;
}
export function sliceSegment(slice, Lx = 4, Ly = 4) { return { len: Lx, offset: slice.offset, angle: slice.angle }; }`,
  'render/orbit.js': `
export function orbitCam(c) { return { ...c, view: new Float32Array(16), proj: new Float32Array(16), viewProj: new Float32Array(16), eye: [0, 0, 5] }; }
export function fitBlock(dims, aspect) { globalThis.__tcLog.fitDims = dims; return { yaw: 0.6, pitch: 0.5, dist: 6, target: [dims.Lx / 2, dims.Ly / 2, 0.5], fovY: 0.6, aspect }; }`,
  'render/views.js': `
const L = () => globalThis.__tcLog;
export async function createViews(device, format, sim, opts) {
  L().viewsCreated++;
  return {
    set(s) { L().viewSets.push(s); },
    render(enc, target, size, rects) { L().renders++; L().renderSize = size; L().renderRects = rects; },
    pickSurface(px, py, rects) { const r = rects.surface; if (!r) return null; return { x: 4 * (px - r.x) / r.w, y: 4 * (py - r.y) / r.h }; },
    sliceFromDrag(p0, p1) { L().drags.push([p0, p1]); return { angle: Math.atan2(p1.y - p0.y, p1.x - p0.x), offset: 0.25 }; },
    destroy() { L().viewsDestroyed++; },
  };
}`,
  'saver.js': `
export function installSaver(ctx) {
  const L = globalThis.__tcLog;
  L.saver = ctx.app === globalThis.window.TC && typeof ctx.layout === 'function' && typeof ctx.fitBlock === 'function' && typeof ctx.resize === 'function' && !!ctx.canvas;
  return { toggle() { L.toggles++; }, tick(dt) { L.ticks++; return false; } };
}`,
};

function newLog() {
  return { simCreated: 0, simOpts: null, simSets: [], resets: [], tracers: [], steps: 0, simDestroyed: 0, viewsCreated: 0, viewSets: [], renders: 0, drags: [], viewsDestroyed: 0, submits: 0, saver: false, layout: null, toggles: 0, ticks: 0, fitDims: null };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

function makeDom(JSDOM, root, search, { phone, gpu }) {
  const html = readFileSync(join(root, 'pages/thermal-convection/index.html'), 'utf8').replace(/<script type="module"[^>]*><\/script>/, '');
  const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/thermal-convection/index.html' + search, pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = q => ({ matches: phone && q.includes('max-width:768px'), media: q, addEventListener() {}, removeEventListener() {} });
  let lostResolve = null;
  const log = globalThis.__tcLog;
  const device = {
    createCommandEncoder: () => ({ finish: () => ({}) }),
    queue: { submit: () => { log.submits++; } },
    lost: new Promise(r => { lostResolve = r; }),
    destroy() { lostResolve({ reason: 'destroyed' }); },
  };
  const devices = [];
  w.HTMLCanvasElement.prototype.getContext = function (kind) {
    if (kind === 'webgpu') return { configure(c) { log.configured = c; }, getCurrentTexture: () => ({ createView: () => ({}) }) };
    if (kind === '2d') return { fillRect() {}, set fillStyle(v) { log.lastFill = v; } };
    return null;
  };
  if (gpu) {
    Object.defineProperty(w.navigator, 'gpu', { value: {
      requestAdapter: async () => ({ requestDevice: async () => {
        let res = null;
        const lost = new Promise(r => { res = r; });
        const d = { ...device, lost, _lost: res };
        devices.push(d); return d;
      } }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    }, configurable: true });
  }
  for (const k of ['window', 'document', 'location', 'screen', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'getComputedStyle']) {
    Object.defineProperty(globalThis, k, { value: k === 'window' ? w : (typeof w[k] === 'function' && k !== 'HTMLElement' ? w[k].bind(w) : w[k]), configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true, writable: true });
  return { dom, w, devices };
}

async function bootRuns(ok) {
  const jsdom = findJsdom();
  if (!jsdom) { ok('boot: jsdom runs skipped (jsdom is not on NODE_PATH)', true); return; }
  const { JSDOM } = jsdom;
  const page = new URL('../', import.meta.url);
  const root = mkdtempSync(join(tmpdir(), 'tc-ui-'));
  const saved = {};
  for (const k of ['window', 'document', 'location', 'screen', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'getComputedStyle', 'navigator']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  try {
    const pd = join(root, 'pages/thermal-convection');
    for (const d of ['sim', 'render', 'tests']) mkdirSync(join(pd, d), { recursive: true });
    mkdirSync(join(root, 'lib'), { recursive: true });
    for (const f of ['index.html', 'main.js', 'ui.js', 'explainer.js']) copyFileSync(new URL(f, page), join(pd, f));
    copyFileSync(new URL('../../lib/sci-math.js', page), join(root, 'lib/sci-math.js'));
    for (const [f, src] of Object.entries(STUBS)) writeFileSync(join(pd, f), src);

    // Run 1: desktop, fake WebGPU, ?q=1&preset=soup&seed=7.
    globalThis.__tcLog = newLog();
    const L = globalThis.__tcLog;
    const r1 = makeDom(JSDOM, root, '?q=1&preset=soup&seed=7', { phone: false, gpu: true });
    const errs = [];
    const onErr = e => errs.push(String(e && e.message || e));
    process.on('unhandledRejection', onErr);
    await import(pathToFileURL(join(pd, 'main.js')).href + '?run=1');
    await wait(300);
    const app = r1.w.TC, doc = r1.w.document;
    ok('boot: window.TC is set', !!app && typeof app.applyPreset === 'function' && typeof app.setView === 'function' && typeof app.setSlice === 'function' && typeof app.reset === 'function');
    ok('boot: sim made with ?q=1 and ?seed=7', L.simCreated === 1 && L.simOpts.quality === 1 && L.simOpts.seed === 7, JSON.stringify(L.simOpts));
    ok('boot: context configured premultiplied', L.configured && L.configured.alphaMode === 'premultiplied' && L.configured.format === 'bgra8unorm');
    ok('boot: ?preset=soup gives burner mode and broth', app.params.mode === 'burner' && app.palette === 'broth' && app.preset === 'soup', `${app.params.mode} ${app.palette} ${app.preset}`);
    ok('boot: sim got the soup params', L.simSets.length > 0 && L.simSets.at(-1).mode === 'burner');
    ok('boot: tracers on with the tablet count', L.tracers.at(-1) === 20000, String(L.tracers));
    ok('boot: frames render and submit', L.renders > 2 && L.submits > 2 && L.steps > 2, `${L.renders} renders, ${L.submits} submits`);
    ok('boot: views get the display state', L.viewSets.some(s => s.palette === 'broth' && s.slice && 'surfaceZ' in s && 'zScale' in s && 'isotherms' in s && typeof s.relief === 'number'));
    ok('boot: render size has dpr and the backing size', L.renderSize && L.renderSize.w > 0 && L.renderSize.dpr > 0 && L.renderSize.pw === Math.round(L.renderSize.w * L.renderSize.dpr), JSON.stringify(L.renderSize));
    ok('boot: tone bias starts at 0.5 (VIEW default)', L.viewSets.some(s => s.bias === 0.5 && s.gain === 1));
    ok('boot: layout gets the clear area and the box opts', L.layout && L.layout.view === 'split' && 'Lx' in L.layout.opts && 'zScale' in L.layout.opts && L.layout.clear.t >= 0);
    ok('boot: saver installed with app, canvas, layout, fitBlock, resize', L.saver === true);
    ok('boot: saver.tick runs each frame', L.ticks > 2, String(L.ticks));
    ok('boot: saver buttons show once the saver loads', doc.getElementById('saverBtn').hidden === false && doc.getElementById('dockSaver').hidden === false);
    doc.getElementById('dockSaver').click();
    ok('boot: the dock saver button toggles the saver', L.toggles === 1);
    ok('boot: layout gets cutLen', L.layout.opts.cutLen === 4, JSON.stringify(L.layout.opts));
    const st0 = L.steps, tm0 = app.sim.time;
    app.prewarm(2);
    ok('boot: prewarm(2) steps until sim.time moved 2 tff', L.steps - st0 === 40 && app.sim.time - tm0 >= 2 - 1e-9, `${L.steps - st0} steps`);
    ok('boot: six preset chips', doc.querySelectorAll('#presetChips button').length === 6);
    ok('boot: four palette chips with swatches', doc.querySelectorAll('#paletteChips button .sw').length === 4);
    ok('boot: burner box shows, Ma box hidden', doc.getElementById('burnerBox').hidden === false && doc.getElementById('maBox').hidden === true);
    ok('boot: grid readout', doc.getElementById('rdGrid').textContent === '96 × 96 × 24', doc.getElementById('rdGrid').textContent);
    ok('boot: status line reads the stats', /Nu 2\.50/.test(doc.getElementById('stMain').textContent), doc.getElementById('stMain').textContent);
    ok('boot: equations typeset boxes exist', doc.querySelectorAll('#eqList .sci-eq').length === 4);
    ok('boot: explainer has its sections and sources', doc.querySelectorAll('#explainer section').length === 6 && doc.querySelectorAll('#explainer ol.refs li').length >= 4);
    ok('boot: surface label shows', doc.getElementById('lblSurface').hidden === false && /Surface/.test(doc.getElementById('lblSurface').textContent));

    // Controls.
    doc.querySelector('#presetChips button[data-preset="granulation"]').click();
    ok('ui run: a preset chip applies sun mode and the solar palette', app.params.mode === 'sun' && app.palette === 'solar' && app.view === 'surface' && L.simSets.at(-1).mode === 'sun');
    ok('ui run: the chip is marked on', doc.querySelector('#presetChips button[data-preset="granulation"]').classList.contains('on'));
    const raIn = doc.getElementById('ra'); raIn.value = '6.5'; raIn.dispatchEvent(new r1.w.Event('input'));
    ok('ui run: the Ra slider sets Ra = 10^6.5', Math.abs(app.params.Ra - 10 ** 6.5) < 1 && Math.abs(L.simSets.at(-1).Ra - 10 ** 6.5) < 1);
    ok('ui run: a moved slider makes the preset custom', app.preset === null && doc.getElementById('dockPresetV').textContent === 'Custom');
    doc.querySelector('#modeSeg button[data-mode="pan"]').click();
    ok('ui run: thin pan shows the Ma slider', app.params.mode === 'pan' && doc.getElementById('maBox').hidden === false && doc.getElementById('burnerBox').hidden === true);
    doc.querySelector('#toggles button[data-toggle="tracers"]').click();
    ok('ui run: tracers off sets 0 tracers', app.toggles.tracers === false && L.tracers.at(-1) === 0);
    doc.getElementById('playBtn').click();
    const s0 = L.steps; await wait(100);
    ok('ui run: pause stops the steps, render goes on', app.playing === false && L.steps === s0 && doc.getElementById('playBtn').textContent === 'Play');
    doc.getElementById('playBtn').click();
    doc.getElementById('resetBtn').click();
    ok('ui run: reset uses the next seed', L.resets.at(-1) === 8, String(L.resets));
    doc.getElementById('dockPalette').click();
    ok('ui run: the dock steps the palette', app.palette === 'broth', app.palette);

    // Cut by drag on the surface (split view).
    app.setView('split'); await wait(60);
    const rs = app.rects.surface;
    const fire = (type, x, y) => { const e = new r1.w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true }); Object.defineProperty(e, 'pointerId', { value: 1 }); doc.getElementById('view').dispatchEvent(e); };
    fire('pointerdown', rs.x + 10, rs.y + 10); fire('pointermove', rs.x + 200, rs.y + 200); fire('pointerup', rs.x + 200, rs.y + 200);
    ok('ui run: a drag on the surface draws a new cut', L.drags.length === 1 && Math.abs(app.slice.angle - Math.atan2(190 * 4 / rs.h, 190 * 4 / rs.w)) < 1e-6 && app.slice.offset === 0.25, JSON.stringify(app.slice));
    const a0 = app.slice.angle;
    fire('pointerdown', rs.x + rs.w / 2, rs.y + rs.h / 2); fire('pointerup', rs.x + rs.w / 2, rs.y + rs.h / 2);
    ok('ui run: a tap moves the cut through the point, same angle', app.slice.angle === a0 && Math.abs(app.slice.offset) < 1e-6, JSON.stringify(app.slice));
    ok('ui run: the angle slider follows the cut', doc.getElementById('angleV').textContent === Math.round(((a0 * 180 / Math.PI) % 180 + 180) % 180) + '°');

    // Block view and orbit.
    doc.querySelector('#viewSeg button[data-view="block"]').click(); await wait(60);
    ok('ui run: block view sends a camera with matrices', app.view === 'block' && L.viewSets.some(s => s.cam && s.cam.viewProj && s.cam.yaw === 0.6));
    ok('ui run: the block fit gets Lz = zScale', L.fitDims && L.fitDims.Lz === app.zScale, JSON.stringify(L.fitDims));
    const rb = app.rects.block, yaw0 = app.cam.yaw;
    fire('pointerdown', rb.x + 50, rb.y + 50); fire('pointermove', rb.x + 150, rb.y + 50); fire('pointerup', rb.x + 150, rb.y + 50);
    ok('ui run: a drag on the block turns it', Math.abs(app.cam.yaw - (yaw0 - 0.8)) < 1e-9, String(app.cam.yaw));

    // Device loss: boots again with the same params.
    const Ra0 = app.params.Ra;
    r1.devices[0]._lost({ reason: 'unknown', message: 'test' });
    await wait(50);
    ok('boot: a lost device drops sim and views', app.sim === null && L.simDestroyed === 1 && L.viewsDestroyed === 1);
    await wait(900);
    ok('boot: it boots again with the same params', L.simCreated === 2 && app.ok === true && app.params.Ra === Ra0 && L.simSets.at(-1).Ra === Ra0);
    r1.devices[1]._lost({ reason: 'destroyed' });
    await wait(50);
    ok('boot: a destroyed device (gpu-guard release) does not boot again', L.simCreated === 2 && app.sim === null);
    ok('boot: no unhandled rejections in run 1', !errs.length, errs.join(' | '));
    r1.w.close();

    // Run 2: phone, no WebGPU.
    globalThis.__tcLog = newLog();
    const r2 = makeDom(JSDOM, root, '', { phone: true, gpu: false });
    await import(pathToFileURL(join(pd, 'main.js')).href + '?run=2');
    await wait(100);
    const d2 = r2.w.document, app2 = r2.w.TC;
    ok('phone: #nogpu shows without WebGPU', d2.getElementById('nogpu').hidden === false && /navigator\.gpu/.test(app2.failed || ''), app2.failed);
    ok('phone: physics moves into the sheet', d2.getElementById('physics').parentNode === d2.getElementById('panel'));
    ok('phone: the sheet opens on the equations tab', d2.getElementById('panel').classList.contains('open') && d2.getElementById('panel').dataset.tab === 'physics');
    ok('phone: the explainer still renders', d2.querySelectorAll('#explainer section').length === 6 && d2.querySelectorAll('#eqList .sci-eq').length === 4);
    ok('phone: default preset is granulation', app2.preset === 'granulation' && app2.params.mode === 'sun');
    d2.querySelector('#sheetTabs button[data-tab="controls"]').click();
    ok('phone: the tab switches to the controls', d2.getElementById('panel').dataset.tab === 'controls');
    ok('phone: no sim without WebGPU', globalThis.__tcLog.simCreated === 0);
    process.off('unhandledRejection', onErr);
    r2.w.close();
  } finally {
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    delete globalThis.__tcLog;
    rmSync(root, { recursive: true, force: true });
  }
}
