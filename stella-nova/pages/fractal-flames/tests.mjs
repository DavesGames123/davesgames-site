// ============================================================================
//  FRACTAL FLAMES  ·  tests.mjs — checks for the CPU side of the flam3 port
// ----------------------------------------------------------------------------
//  A port of flam3 by Scott Draves and the flam3 authors,
//  https://github.com/scottdraves/flam3. SPDX-License-Identifier:
//  GPL-3.0-or-later. Free software under the GNU GPL, version 3 or later,
//  distributed WITHOUT ANY WARRANTY. See LICENSE in this directory.
//
//  RUN (from the repo root)
//    node stella-nova/pages/fractal-flames/tests.mjs
//        seeded determinism of random / mutate / cross / interpolate, the
//        log-polar blend, the XML round trip, the palette file, closed-form
//        checks of single variations, the GPU layout constants.
//    node stella-nova/pages/fractal-flames/tests.mjs --gpu http://127.0.0.1:8963 9763
//        also GPU parity: in headless Chrome (CDP port 9763) each
//        deterministic variation runs in flame.wgsl and in variations.js on
//        the same points and parameters.
//  The process exits with code 1 when a check fails.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import * as G from './genome.js';
import * as V from './variations.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
let fails = 0, passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++; else fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b));

// ── palette file ───────────────────────────────────────────────────────────
const meta = JSON.parse(fs.readFileSync(path.join(HERE, 'palettes.json'), 'utf8'));
const data = new Uint8Array(fs.readFileSync(path.join(HERE, 'palettes.bin')));
const lib = { count: meta.count, numbers: meta.numbers, names: meta.names, data };
check('palettes.bin size = count x 768', data.length === meta.count * 768, `${data.length} bytes, ${meta.count} palettes`);
check('palette count is 701 (flam3-palettes.xml)', meta.count === 701);
check('palette 0 is south-sea-bather', meta.numbers[0] === 0 && meta.names[0] === 'south-sea-bather');
{
  // flam3-palettes.xml: palette 0 starts "00b9eaeb00c1eeeb".
  const p = G.getPalette(lib, 0, 0).palette;
  check('palette 0 colour 0 = b9 ea eb', Math.round(p[0] * 255) === 0xb9 && Math.round(p[1] * 255) === 0xea && Math.round(p[2] * 255) === 0xeb);
  check('palette 0 colour 1 = c1 ee eb', Math.round(p[3] * 255) === 0xc1 && Math.round(p[4] * 255) === 0xee);
  const q = G.getPalette(lib, 0, 0.5).palette;
  const h0 = G.rgb2hsv(p[0], p[1], p[2]), h1 = G.rgb2hsv(q[0], q[1], q[2]);
  check('hue rotation 0.5 turns the hue by 3 (of 6)', near(((h1[0] - h0[0]) + 6) % 6, 3, 1e-6) && near(h0[2], h1[2], 1e-6));
  check('unknown palette number gives white', G.getPalette(lib, 99999, 0).palette.every(v => v === 1));
}

// ── seeded determinism ─────────────────────────────────────────────────────
{
  const a = G.toXML(G.flam3Random(new G.Rng(42), { lib }));
  const b = G.toXML(G.flam3Random(new G.Rng(42), { lib }));
  const c = G.toXML(G.flam3Random(new G.Rng(43), { lib }));
  check('flam3Random: same seed, same genome', a === b);
  check('flam3Random: other seed, other genome', a !== c);
  let okCount = true;
  for (let s = 1; s <= 200; s++) {
    const g = G.flam3Random(new G.Rng(s), { lib });
    const n = G.numStd(g);
    if (n < 2 || g.xforms.length > G.MAX_XF) { okCount = false; break; }
    for (const x of g.xforms.slice(0, n)) {
      const nz = [...x.v].filter(v => v !== 0).length;
      if (!nz) { okCount = false; break; }
    }
  }
  check('flam3Random: 200 seeds give 2+ xforms, each with a variation', okCount);
  const base = G.flam3Random(new G.Rng(7), { lib });
  for (const mode of ['all_vars', 'one_xform', 'add_symmetry', 'post_xforms', 'color_palette', 'delete_xform', 'all_coefs', null]) {
    const g1 = G.copyGenome(base), g2 = G.copyGenome(base);
    const a1 = G.mutate(g1, mode, new G.Rng(9), { lib }), a2 = G.mutate(g2, mode, new G.Rng(9), { lib });
    check(`mutate ${mode || 'random'}: deterministic`, a1 === a2 && G.toXML(g1) === G.toXML(g2), a1);
  }
  const other = G.flam3Random(new G.Rng(8), { lib });
  for (const mode of ['union', 'interpolate', 'alternate']) {
    const x1 = G.cross(base, other, mode, new G.Rng(5)), x2 = G.cross(base, other, mode, new G.Rng(5));
    check(`cross ${mode}: deterministic`, G.toXML(x1) === G.toXML(x2), x1.action);
  }
  const u = G.cross(base, other, 'union', new G.Rng(5));
  check('cross union: xforms of both parents', G.numStd(u) === Math.min(G.MAX_XF, G.numStd(base) + G.numStd(other)));
  const i1 = G.toXML(G.interpolate(base, other, 0.37)), i2 = G.toXML(G.interpolate(base, other, 0.37));
  check('interpolate: deterministic', i1 === i2);
}

// ── interpolation ──────────────────────────────────────────────────────────
{
  const mk = deg => {
    const g = G.newGenome(); G.addStdXforms(g, 1); const x = g.xforms[0];
    const t = deg * Math.PI / 180; x.density = 1; x.c = [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0.3, 0];
    return g;
  };
  const a = mk(10), b = mk(350);
  const m = G.interpolate(a, b, 0.5).xforms[0].c;
  check('log-polar blend: 10 deg and 350 deg meet at 0 deg', near(m[0], 1, 1e-9) && near(m[1], 0, 1e-9) && near(m[3], 1, 1e-9), m.map(v => v.toFixed(6)).join(' '));
  const lin = 0.5 * Math.cos(10 * Math.PI / 180) + 0.5 * Math.cos(350 * Math.PI / 180);
  check('log-polar blend keeps the magnitude (linear would give ' + lin.toFixed(4) + ')', near(Math.hypot(m[0], m[1]), 1, 1e-9));
  const c = mk(0), d = mk(170);
  const q = G.interpolate(c, d, 0.5).xforms[0].c;
  check('log-polar blend: 0 and 170 deg meet at 85 deg', near(Math.atan2(q[1], q[0]) * 180 / Math.PI, 85, 1e-9));
  const g0 = G.flam3Random(new G.Rng(11), { lib }), g1 = G.flam3Random(new G.Rng(12), { lib });
  const e0 = G.interpolate(g0, g1, 0), e1 = G.interpolate(g0, g1, 1);
  const sameC = (x, y) => x.every((v, k) => near(v, y[k], 1e-9));
  check('interpolate t=0 keeps the coefs of g0', g0.xforms.slice(0, G.numStd(g0)).every((x, i) => sameC(x.c, e0.xforms[i].c)));
  check('interpolate t=1 keeps the coefs of g1', g1.xforms.slice(0, G.numStd(g1)).every((x, i) => sameC(x.c, e1.xforms[i].c)));
  const n = Math.max(G.numStd(g0), G.numStd(g1));
  check('interpolate pads to the larger xform count', G.numStd(e0) === n);
  check('interpolate palette t=0 = palette of g0', e0.palette.every((v, k) => Math.abs(v - g0.palette[k]) < 1e-5));
}

// ── symmetry ───────────────────────────────────────────────────────────────
{
  const g = G.newGenome(); G.addStdXforms(g, 2);
  G.addSymmetry(g, 5, new G.Rng(1));
  check('symmetry 5 adds 4 rotations', G.numStd(g) === 6 && g.symmetry === 5);
  const r = g.xforms.slice(2).map(x => Math.round(Math.atan2(x.c[1], x.c[0]) * 180 / Math.PI)).sort((a, b) => a - b);
  check('symmetry 5 angles are 72 deg apart', JSON.stringify(r) === JSON.stringify([-144, -72, 72, 144]), r.join(' '));
  const h = G.newGenome(); G.addStdXforms(h, 2); G.addSymmetry(h, -3, new G.Rng(1));
  check('dihedral 3 adds a mirror and 2 rotations', G.numStd(h) === 5 && h.xforms.some(x => x.c[0] === -1 && x.c[3] === 1));
  G.removeSymmetry(h);
  check('removeSymmetry takes them away', G.numStd(h) === 2 && h.symmetry === 0);
}

// ── XML round trip ─────────────────────────────────────────────────────────
{
  let ok = true, first = '';
  for (let s = 1; s <= 30; s++) {
    const g = G.flam3Random(new G.Rng(100 + s), { lib });
    if (s % 3 === 0) { g.chaos = Array.from({ length: G.numStd(g) }, (_, i) => Array.from({ length: G.numStd(g) }, (_, j) => (i + j) % 2 ? 0.5 : 1)); }
    g.name = 'seed ' + s;
    const x1 = G.toXML(g);
    const back = G.parseXML(x1, { lib });
    const x2 = back.length ? G.toXML(back[0]) : '';
    if (x1 !== x2) { ok = false; first = first || `seed ${s}`; }
  }
  check('XML round trip: toXML(parseXML(toXML(g))) is the same text (30 genomes, xaos too)', ok, first);
  const t = `<flames><flame name="t" size="640 480" center="0.1 -0.2" scale="240" rotate="30" palette="15" hue="0.25" brightness="3" gamma="2.5">
    <xform weight="0.5" color="1" spherical="1" julian="0.5" julian_power="3" julian_dist="1" coefs="-0.68 -0.07 0.2 0.75 -0.04 -0.26" chaos="1 0"/>
    <xform weight="0.5" color="0" symmetry="0.5" oscope_frequency="2" oscilloscope="1" coefs="0.95 0.48 0.43 -0.05 0.64 -0.99"/>
    <finalxform color="0" color_speed="0" linear="1" coefs="1 0 0 1 0 0"/>
    <edit><flame><xform weight="1" coefs="1 0 0 1 0 0"/></flame></edit>
    <symmetry kind="2"/></flame></flames>`;
  const gs = G.parseXML(t, { lib });
  const g = gs[0];
  check('parseXML: one flame, the one inside <edit> skipped', gs.length === 1);
  check('parseXML: camera and render attributes', g.width === 640 && g.height === 480 && near(g.center[1], -0.2) && g.ppu === 240 && g.rotate === 30 && g.brightness === 3 && g.gamma === 2.5);
  check('parseXML: palette="15" hue="0.25" from the library', g.paletteIndex === 15 && near(g.palette[0], G.getPalette(lib, 15, 0.25).palette[0], 1e-6));
  check('parseXML: variations and parameters', g.xforms[0].v[G.VAR.spherical] === 1 && g.xforms[0].p.julian_power === 3);
  check('parseXML: symmetry="0.5" gives color_speed 0.25, animate 0', g.xforms[1].colorSpeed === 0.25 && g.xforms[1].animate === 0);
  check('parseXML: old oscope_ name', g.xforms[1].p.oscilloscope_frequency === 2);
  check('parseXML: chaos row', g.chaos && g.chaos[0][1] === 0 && g.chaos[1][0] === 1);
  check('parseXML: final xform last, symmetry kind 2 adds one xform', g.finalIndex === g.xforms.length - 1 && G.numStd(g) === 3);
  const d = G.xformDistrib(g);
  check('xaos: chaos 0 row never picks xform 2 after xform 1', d.chaosOn && [...d.table.subarray(1 * G.DIST_GRAIN, 2 * G.DIST_GRAIN)].every(i => i !== 1));
}

// ── variations: closed forms (the formulas in the comments of variations.c) ─
{
  const x = G.prepareXform(Object.assign(G.newXform(), { c: [1, 0, 0, 1, 0, 0] }));
  const f = (tx, ty) => { const s = tx * tx + ty * ty, r = Math.sqrt(s); return { tx, ty, sumsq: s, sqrt: r, atan: Math.atan2(tx, ty), sina: tx / r, cosa: ty / r, atanyx: Math.atan2(ty, tx), p0: 0, p1: 0 }; };
  const run = (id, tx, ty, w = 1) => { const h = f(tx, ty); V.applyVar(id, h, w, x, () => 0.25); return [h.p0, h.p1]; };
  const pts = [[0.3, -0.7], [1.2, 0.4], [-0.9, -1.3], [0.05, 0.6]];
  let ok = true;
  for (const [tx, ty] of pts) {
    const r2 = tx * tx + ty * ty, r = Math.sqrt(r2), a = Math.atan2(tx, ty);
    const want = {
      2: [tx / (r2 + 1e-10), ty / (r2 + 1e-10)],                                       // spherical
      3: [Math.sin(r2) * tx - Math.cos(r2) * ty, Math.cos(r2) * tx + Math.sin(r2) * ty], // swirl
      4: [Math.sin(a) * tx - Math.cos(a) * ty, Math.cos(a) * tx + Math.sin(a) * ty].map(v => v * 1),  // horseshoe (see below)
      5: [a / Math.PI, r - 1],                                                         // polar
      6: [Math.sin(a + r) * r, Math.cos(a - r) * r],                                   // handkerchief
      7: [Math.sin(a * r) * r, Math.cos(a * r) * -r],                                  // heart
      10: [Math.sin(a) / (r + 1e-10), Math.cos(a) * (r + 1e-10)],                       // hyperbolic
      18: [Math.cos(Math.PI * ty) * Math.exp(tx - 1), Math.sin(Math.PI * ty) * Math.exp(tx - 1)], // exponential
      28: [tx * 4 / (r2 + 4), ty * 4 / (r2 + 4)],                                      // bubble
    };
    // flam3's horseshoe code is ((x-y)(x+y), 2xy) / r; its comment form uses
    // sin and cos of atan2(x, y): (sin a x - cos a y) = (x^2 - y^2) / r.
    want[4] = [(tx - ty) * (tx + ty) / (r + 1e-10), 2 * tx * ty / (r + 1e-10)];
    for (const id in want) {
      const got = run(+id, tx, ty);
      if (!near(got[0], want[id][0], 1e-12) || !near(got[1], want[id][1], 1e-12)) { ok = false; console.log('  mismatch', G.VAR_NAMES[id], tx, ty, got, want[id]); }
    }
  }
  check('variations: spherical, swirl, horseshoe, polar, handkerchief, heart, hyperbolic, exponential, bubble', ok);
  // julia with rnd < 0.5 adds pi to the half angle: two roots of z.
  const z = run(13, 0.6, 0.8);
  check('julia: the point is a square root (r^0.5 of r)', near(Math.hypot(z[0], z[1]), Math.sqrt(1), 1e-12));
}

// ── GPU layout and parameter indices (genome.js against flame.wgsl) ───────
{
  const src = fs.readFileSync(path.join(HERE, 'flame.wgsl'), 'utf8');
  const consts = {};
  for (const m of src.matchAll(/const (P_\w+) = (\d+)u;/g)) consts[m[1].slice(2)] = +m[2];
  const bad = G.ALL_PARAM_NAMES.filter((n, i) => consts[n] !== i);
  check('flame.wgsl P_ constants match genome.js PARAM_DEFS + PRECALC_NAMES', !bad.length && Object.keys(consts).length === G.ALL_PARAM_NAMES.length, bad.join(' '));
  const off = {};
  for (const m of src.matchAll(/const (OFF_\w+|XF_BLOCK): u32 = (\d+)u;/g)) off[m[1]] = +m[2];
  check('flame.wgsl block offsets match genome.js', off.OFF_C === G.OFF_C && off.OFF_POST === G.OFF_POST && off.OFF_VARS === G.OFF_VARS && off.OFF_PARAMS === G.OFF_PARAMS && off.XF_BLOCK === G.XF_BLOCK && off.OFF_NV === G.OFF_NV && off.OFF_PREBLUR === G.OFF_PREBLUR);
  check('the parameter block fits the xform block', G.OFF_PARAMS + G.ALL_PARAM_NAMES.length <= G.XF_BLOCK);
  const fns = [...src.matchAll(/fn v(\d+)_(\w+)\(/g)].map(m => [+m[1], m[2]]);
  check('flame.wgsl has a function for each variation but pre_blur (98)', fns.length === 98 && fns.every(([i, n]) => G.VAR_NAMES[i] === n));
}

// ── gate and probe ─────────────────────────────────────────────────────────
{
  const r = await V.makeGenome('random', new G.Rng(21), { lib, width: 1000, height: 1000, yield: false });
  const r2 = await V.makeGenome('random', new G.Rng(21), { lib, width: 1000, height: 1000, yield: false });
  check('makeGenome random: deterministic with a seed', G.toXML(r.genome) === G.toXML(r2.genome), `${r.tries} tries`);
  check('makeGenome random: gate passed', r.gate && r.gate.ok, JSON.stringify(r.gate && r.gate.frame));
  const g = G.newGenome(); G.addStdXforms(g, 1); g.xforms[0].density = 1; g.xforms[0].c = [0.1, 0, 0, 0.1, 0, 0];
  const s = V.gate(g);
  check('gate rejects a flame that collapses to a point', !s.ok, JSON.stringify(s.frame));
}

// ── GPU parity (optional) ──────────────────────────────────────────────────
const gi = process.argv.indexOf('--gpu');
if (gi >= 0) await gpuParity(process.argv[gi + 1], +process.argv[gi + 2] || 9763);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

async function gpuParity(server, port) {
  const { spawn } = await import('node:child_process');
  const os = await import('node:os');
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-gpu-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let ws;
  try {
    let list = null;
    for (let i = 0; i < 40 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch (e) { await sleep(250); } }
    ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } };
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
    // A blank page in the site origin, so the modules load from the server.
    await send('Page.enable');
    await send('Page.navigate', { url: `${server}/stella-nova/pages/fractal-flames/palettes.json` });
    await sleep(1500);
    const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(${gpuScript.toString()})()` });
    const out = r.result && r.result.value;
    if (!out || out.error) { check('GPU parity ran', false, JSON.stringify(out || r).slice(0, 400)); return; }
    check(`GPU parity: ${out.tested.length} deterministic variations, flame.wgsl against variations.js`, out.bad.length === 0,
      out.bad.length ? out.bad.join('; ') : `${out.points} points each, worst agreement ${out.worst}`);
  } finally { try { ws && ws.close(); } catch (e) {} chrome.kill('SIGKILL'); await sleep(300); fs.rmSync(prof, { recursive: true, force: true }); }
}

// Runs in the page: each variation that draws no random numbers, on 256
// points, on the GPU (a test entry point appended to flame.wgsl) and on the
// CPU. A point agrees when both results are within 1e-3 relative (2e-3
// absolute); points where the CPU result is large (|v| > 1e3, f32 loses the
// digits near poles) do not count. A variation passes at 97% agreement.
async function gpuScript() {
  try {
    const base = new URL('./', location.href);
    const G = await import(new URL('genome.js', base));
    const V = await import(new URL('variations.js', base));
    const src = await (await fetch(new URL('flame.wgsl', base))).text();
    const RANDOM = new Set(['julia', 'noise', 'julian', 'juliascope', 'blur', 'gaussian_blur', 'radial_blur', 'pie', 'arch', 'square', 'rays',
      'blade', 'twintrian', 'flower', 'conic', 'parabola', 'boarders', 'cpow', 'wedge_julia', 'pre_blur']);
    const ids = G.VAR_NAMES.map((n, i) => i).filter(i => !RANDOM.has(G.VAR_NAMES[i]));
    const NP = 256, rng = new G.Rng(77);
    const xfs = [], pts = [];
    for (const id of ids) {
      const x = G.newXform(); x.v.fill(0); x.v[id] = 1;
      x.c = [rng.r11(), rng.r11(), rng.r11(), rng.r11(), rng.r11() * 0.8, rng.r11() * 0.8];
      G.randomParams(x, rng);
      if (G.VAR_NAMES[id] === 'super_shape') { x.p.super_shape_rnd = 0; x.p.super_shape_m = 4; x.p.super_shape_n1 = 3; }
      xfs.push(x);
    }
    const g = G.newGenome(); g.xforms = xfs.slice(0, G.MAX_XF);
    const blocks = new Float32Array(ids.length * G.XF_BLOCK);
    xfs.forEach((x, k) => {
      const one = G.newGenome(); one.xforms = [x];
      blocks.set(G.packGenome(one).blocks.subarray(0, G.XF_BLOCK), k * G.XF_BLOCK);
    });
    const tin = new Float32Array(ids.length * NP * 4);
    ids.forEach((id, k) => { for (let i = 0; i < NP; i++) { const o = (k * NP + i) * 4; tin[o] = rng.r11() * 1.6; tin[o + 1] = rng.r11() * 1.6; tin[o + 2] = k; tin[o + 3] = id; } });
    const test = src + `
@group(0) @binding(6) var<storage, read> tin: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> tout: array<vec2<f32>>;
@compute @workgroup_size(64)
fn vtest(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&tout)) { return; }
  rs = 1u;
  let t = tin[i];
  var h: H;
  h.tx = t.x; h.ty = t.y; h.sumsq = t.x * t.x + t.y * t.y; h.sq = sqrt(h.sumsq);
  h.at = atan2(t.x, t.y); h.sina = t.x / h.sq; h.cosa = t.y / h.sq; h.atyx = atan2(t.y, t.x);
  h.b = u32(t.z) * XF_BLOCK;
  tout[i] = variation(u32(t.w), h, 0.7);
}`;
    const ad = await navigator.gpu.requestAdapter(); const dev = await ad.requestDevice();
    dev.pushErrorScope('validation');
    const mod = dev.createShaderModule({ code: test });
    const info = await mod.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error').map(m => m.lineNum + ': ' + m.message);
    if (errs.length) return { error: errs.join('; ') };
    const pipe = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'vtest' } });
    const mk = (arr, usage) => { const b = dev.createBuffer({ size: arr.byteLength, usage: usage | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, arr); return b; };
    const bx = mk(blocks, GPUBufferUsage.STORAGE), bi = mk(tin, GPUBufferUsage.STORAGE);
    const n = ids.length * NP;
    const bo = dev.createBuffer({ size: n * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const rb = dev.createBuffer({ size: n * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 1, resource: { buffer: bx } }, { binding: 6, resource: { buffer: bi } }, { binding: 7, resource: { buffer: bo } }] });
    const enc = dev.createCommandEncoder(); const p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(Math.ceil(n / 64)); p.end();
    enc.copyBufferToBuffer(bo, 0, rb, 0, n * 8); dev.queue.submit([enc.finish()]);
    const se = await dev.popErrorScope(); if (se) return { error: se.message };
    await rb.mapAsync(GPUMapMode.READ); const gpu = new Float32Array(rb.getMappedRange().slice(0));
    const bad = [], tested = []; let worst = 1;
    ids.forEach((id, k) => {
      const px = G.prepareXform(xfs[k]);
      let agree = 0, count = 0;
      for (let i = 0; i < NP; i++) {
        const o = k * NP + i, tx = tin[o * 4], ty = tin[o * 4 + 1];
        const s = tx * tx + ty * ty, r = Math.sqrt(s);
        const h = { tx, ty, sumsq: s, sqrt: r, atan: Math.atan2(tx, ty), sina: tx / r, cosa: ty / r, atanyx: Math.atan2(ty, tx), p0: 0, p1: 0 };
        V.applyVar(id, h, 0.7, px, () => 0.5);
        if (!isFinite(h.p0) || !isFinite(h.p1) || Math.abs(h.p0) > 1e3 || Math.abs(h.p1) > 1e3) continue;
        count++;
        const e = (a, b) => Math.abs(a - b) <= 2e-3 + 1e-3 * Math.abs(a);
        if (e(h.p0, gpu[o * 2]) && e(h.p1, gpu[o * 2 + 1])) agree++;
      }
      const frac = count ? agree / count : 1;
      tested.push(G.VAR_NAMES[id]);
      worst = Math.min(worst, frac);
      if (frac < 0.97) bad.push(`${G.VAR_NAMES[id]} ${agree}/${count}`);
    });
    return { tested, bad, points: NP, worst: worst.toFixed(3) };
  } catch (e) { return { error: String(e && e.stack || e) }; }
}
