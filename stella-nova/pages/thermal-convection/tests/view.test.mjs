// view: palettes, layout rects, orbit camera, slice and pick round trips,
// the sampling math that view-*.wgsl mirrors, the WGSL struct and Tint
// traps, and a recorded createViews / render run on a mock GPU device.
// ok(name, cond, info). Run: node tests.mjs (or node tests/view.test.mjs).
import { readFileSync } from 'node:fs';
import { PALETTES, PALETTE_IDS, ramp, lut, luminance } from '../render/palettes.js';
import { layoutRects, sectionFit, sliceSegment, sliceFromPoints, surfaceToBox, boxToSurface, wrapOffset, rectInside, clearArea, zScaleLabel } from '../render/layout.js';
import { orbitCam, fitBlock, boxCorners, project } from '../render/orbit.js';
import {
  createViews, VIEW_FIELDS, VIEW_FLOATS, packView, cellIndex, sampleField, crWeights, sectRowCoord, fkey, funkey, toneT,
  refSurface, refSection, sectSample, surfSample, cutBlock, blockGeometry, sectionCount,
} from '../render/views.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;

export default async function run(ok) {
  // ---- palettes ----
  ok('view: four palettes', ['solar', 'broth', 'inferno', 'icefire'].every(id => PALETTES[id] && PALETTE_IDS.includes(id)));
  for (const id of ['solar', 'broth', 'inferno']) {
    let prev = -1, mono = true, at = -1;
    for (let i = 0; i <= 512; i++) { const L = luminance(ramp(id, i / 512)); if (L < prev - 1e-7) { mono = false; at = i; break; } prev = L; }
    ok(`view: ${id} luminance rises with t`, mono, at >= 0 ? `drop at ${at}/512` : '');
    ok(`view: ${id} spans dark to bright`, luminance(ramp(id, 0)) < 0.01 && luminance(ramp(id, 1)) > 0.7);
  }
  const L = lut('solar');
  ok('view: lut(solar) is 256 RGBA', L instanceof Uint8Array && L.length === 1024 && L[3] === 255 && L[1023] === 255);
  ok('view: lut(n) size', lut('broth', 64).length === 256);
  ok('view: solar lanes are dark red, tops white-yellow', (() => { const a = ramp('solar', 0.15), b = ramp('solar', 1); return a[0] > 3 * a[2] && a[0] < 0.4 && b[0] > 0.95 && b[1] > 0.9 && b[2] > 0.8; })());
  ok('view: broth has a sheen, solar none', PALETTES.broth.sheen > 0 && PALETTES.solar.sheen === 0);
  ok('view: icefire is dark at the mean', luminance(ramp('icefire', 0.5)) < luminance(ramp('icefire', 0)) && luminance(ramp('icefire', 0.5)) < luminance(ramp('icefire', 1)));
  ok('view: ramp clamps and survives NaN', ramp('solar', -1).join() === ramp('solar', 0).join() && ramp('solar', NaN).length === 3);

  // ---- layout ----
  const sizes = [[390, 844], [844, 390], [1280, 800], [1080, 1920], [1920, 1080], [768, 1024], [320, 568], [2560, 1440]];
  const clears = [{}, { t: 48, b: 120, l: 0, r: 0 }, { t: 0, b: 0, l: 0, r: 340 }];
  let bad = [];
  for (const [w, h] of sizes) for (const clear of clears) for (const zScale of [1, 1.5, 2.5]) for (const cutLen of [4, 4 * Math.SQRT2, 2.2]) {
    const opts = { Lx: 4, Ly: 4, zScale, cutLen };
    const A = clearArea(w, h, clear, 12);
    if (A.w < 200 || A.h < 200) continue;   // a 26 px wide strip is not a layout
    const s = layoutRects(w, h, 'split', clear, opts);
    const tag = `${w}x${h} z${zScale} c${cutLen.toFixed(2)} ${JSON.stringify(clear)}`;
    if (!s.surface || !s.slice) { bad.push(tag + ' missing'); continue; }
    if (s.surface.w !== s.slice.w || s.surface.x !== s.slice.x) bad.push(tag + ' width/x');
    if (s.slice.y < s.surface.y + s.surface.h) bad.push(tag + ' overlap');
    if (Math.abs(s.surface.w / s.surface.h - 1) > 0.02) bad.push(tag + ' surface aspect');
    if (Math.abs(s.slice.w / s.slice.h - cutLen / zScale) > 0.05 * cutLen / zScale + 1 / s.slice.h) bad.push(tag + ' slice aspect');
    if (!rectInside(s.surface, A) || !rectInside(s.slice, A)) bad.push(tag + ' outside clear');
    const tight = Math.abs(s.surface.w - A.w) < 2 || Math.abs((s.slice.y + s.slice.h - s.surface.y) - (A.h)) < 12;
    if (!tight) bad.push(tag + ' not filling');
    const side = layoutRects(w, h, 'split', clear, { ...opts, side: true });
    if (side.surface.w !== side.slice.w || side.slice.x < side.surface.x + side.surface.w || !rectInside(side.surface, A) || !rectInside(side.slice, A)) bad.push(tag + ' side');
    for (const v of ['block', 'surface', 'slice']) {
      const r = layoutRects(w, h, v, clear, opts)[v];
      if (!r || !rectInside(r, A) || r.w < 10 || r.h < 10) bad.push(tag + ' ' + v);
    }
  }
  ok('view: layoutRects keeps aspects, widths and the clear area', bad.length === 0, bad.slice(0, 4).join('; '));
  const p = layoutRects(1080, 1920, 'split', {}, { zScale: 1.5 });
  ok('view: 1080x1920 stacks surface over slice', p.surface.y < p.slice.y && p.surface.w === p.slice.w && p.surface.w >= 1000, JSON.stringify(p));
  const ls = layoutRects(844, 390, 'split', {}, {});
  ok('view: 844x390 split still stacks without opts.side', ls.slice.y > ls.surface.y && ls.slice.x === ls.surface.x);
  ok('view: layoutRects on a zero area gives no rects', Object.keys(layoutRects(20, 20, 'split', { t: 20 })).length === 0);
  const sf = sectionFit({ x: 10, y: 20, w: 400, h: 120 }, 4, 1);
  ok('view: sectionFit puts the bar right under the fluid', near(sf.bar.y, sf.fluid.y + sf.fluid.h) && sf.fluid.w === 400 && near(sf.fluid.w / sf.fluid.h, 4) && sf.bar.h >= 4);
  const sf2 = sectionFit({ x: 0, y: 0, w: 400, h: 100 }, 4 * Math.SQRT2, 1);
  ok('view: sectionFit keeps the aspect of a long cut', near(sf2.fluid.w / sf2.fluid.h, 4 * Math.SQRT2, 1e-6) && sf2.fluid.w <= 400);
  const sf3 = sectionFit({ x: 0, y: 0, w: 400, h: 60 }, 4, 1);
  ok('view: sectionFit shrinks a tall section into its rect', sf3.fluid.h + sf3.bar.h <= 60 + 1e-9 && near(sf3.fluid.w / sf3.fluid.h, 4, 1e-6) && sf3.fluid.x > 0);
  ok('view: zScaleLabel', zScaleLabel(1) === '' && zScaleLabel(1.5) === 'Vertical scale ×1.5');

  // ---- slice geometry ----
  const s0 = sliceSegment({ angle: 0, offset: 0 }, 4, 4);
  ok('view: default slice runs along x through the centre', near(s0.p0[0], 0) && near(s0.p1[0], 4) && near(s0.p0[1], 2) && near(s0.len, 4));
  const s45 = sliceSegment({ angle: Math.PI / 4, offset: 0 }, 4, 4);
  ok('view: diagonal slice spans the box', near(s45.len, 4 * Math.SQRT2, 1e-6));
  ok('view: wrapOffset is periodic', near(wrapOffset(0, 2.5, 4, 4), -1.5) && near(wrapOffset(0, -2.5, 4, 4), 1.5) && near(wrapOffset(0.3, 0.7, 4, 4), 0.7));
  bad = [];
  for (let n = 0; n < 200; n++) {
    const a = { x: 0.1 + 3.8 * ((n * 0.618) % 1), y: 0.1 + 3.8 * ((n * 0.377) % 1) };
    const b = { x: 0.1 + 3.8 * ((n * 0.913 + 0.4) % 1), y: 0.1 + 3.8 * ((n * 0.271 + 0.2) % 1) };
    const sl = sliceFromPoints(a, b, 4, 4);
    if (!sl) continue;
    const g = sliceSegment(sl, 4, 4);
    const dist = q => Math.abs((q.x - g.p0[0]) * g.nrm[0] + (q.y - g.p0[1]) * g.nrm[1]);
    const along = (b.x - a.x) * g.dir[0] + (b.y - a.y) * g.dir[1];
    const inBox = [g.p0, g.p1].every(q => q[0] > -1e-6 && q[0] < 4 + 1e-6 && q[1] > -1e-6 && q[1] < 4 + 1e-6);
    if (dist(a) > 1e-6 || dist(b) > 1e-6 || !(along > 0) || !inBox) bad.push(n);
  }
  ok('view: sliceFromDrag -> sliceSegment passes through both drag points', bad.length === 0, bad.join(','));
  ok('view: a tiny drag gives no slice', sliceFromPoints({ x: 1, y: 1 }, { x: 1.0001, y: 1 }) === null);
  const rect = { x: 30, y: 50, w: 400, h: 400 };
  bad = [];
  for (let n = 0; n < 50; n++) {
    const x = 4 * ((n * 0.37) % 1), y = 4 * ((n * 0.73) % 1);
    const s = boxToSurface(x, y, rect, 4, 4), q = surfaceToBox(s.px, s.py, rect, 4, 4);
    if (!q || !near(q.x, x, 1e-9) || !near(q.y, y, 1e-9)) bad.push(n);
  }
  ok('view: pickSurface round trip (y up on screen)', bad.length === 0 && surfaceToBox(30, 50, rect).y === 4 && surfaceToBox(20, 60, rect) === null);

  // ---- orbit ----
  bad = [];
  for (const aspect of [0.5625, 1, 1.7778, 2.4]) for (const yaw of [-2.25, 0, 1, 3]) for (const pitch of [0.1, 0.56, 1.3]) {
    const fit = fitBlock({ Lx: 4, Ly: 4, Lz: 1.5 }, aspect, { yaw, pitch });
    const c = orbitCam({ ...fit, aspect });
    for (const q of boxCorners({ Lx: 4, Ly: 4, Lz: 1.5 })) {
      const r = project(c.viewProj, q);
      if (!(r.w > 0 && Math.abs(r.x) <= 0.9001 && Math.abs(r.y) <= 0.9001 && r.z >= 0 && r.z <= 1)) bad.push(`${aspect} ${yaw} ${pitch}`);
    }
    const tight = boxCorners({ Lx: 4, Ly: 4, Lz: 1.5 }).map(q => project(c.viewProj, q)).some(r => Math.abs(r.x) > 0.85 || Math.abs(r.y) > 0.85);
    if (!tight) bad.push(`${aspect} ${yaw} ${pitch} loose`);
  }
  ok('view: fitBlock frames all 8 corners, tight, depth 0..1', bad.length === 0, bad.slice(0, 3).join('; '));
  const oc = orbitCam({ yaw: 0, pitch: 0.5, dist: 10, target: [2, 2, 0.5], aspect: 1 });
  const tc = project(oc.viewProj, [2, 2, 0.5]);
  ok('view: orbit target projects to the centre', near(tc.x, 0) && near(tc.y, 0) && tc.z > 0 && tc.z < 1);
  const nearP = project(oc.viewProj, oc.eye.map((e, i) => e + (oc.target[i] - e) * (oc.dist * 0.05 / oc.dist)));
  ok('view: WebGPU depth is 0 at the near plane', near(nearP.z, 0, 1e-4), `${nearP.z}`);
  ok('view: up is +z on screen', project(oc.viewProj, [2, 2, 1.5]).y > 0);

  // ---- sampling math (mirrors of WGSL) ----
  const d = { nx: 8, ny: 6, nz: 4, Lx: 4, Ly: 3, dx: 0.5 };
  const n = d.nx * d.ny * d.nz;
  ok('view: cell index i + nx (j + ny k), wrap in x y, clamp k', cellIndex(1, 2, 3, d) === 1 + 8 * (2 + 6 * 3) && cellIndex(-1, 0, 0, d) === 7 && cellIndex(0, 6, 0, d) === 0 && cellIndex(0, 0, 9, d) === cellIndex(0, 0, 3, d));
  const T = new Float32Array(n), vel = new Float32Array(4 * n);
  for (let k = 0; k < d.nz; k++) for (let j = 0; j < d.ny; j++) for (let i = 0; i < d.nx; i++) {
    const x = (i + 0.5) * d.dx, z = (k + 0.5) / d.nz, c = cellIndex(i, j, k, d);
    T[c] = 1 - z + 0.2 * (x / d.Lx);   // linear in z and x (inside a period)
    vel[4 * c] = 0.3; vel[4 * c + 1] = -0.2; vel[4 * c + 2] = Math.sin((2 * Math.PI * x) / d.Lx); vel[4 * c + 3] = 0;
  }
  ok('view: trilinear T is exact for a linear field', near(sampleField(T, d, 1.3, 1.1, 0.5), 1 - 0.5 + 0.2 * (1.3 / 4), 1e-5) && near(sampleField(T, d, 2.0, 0.9, 0.3), 1 - 0.3 + 0.2 * (2 / 4), 1e-5));
  ok('view: trilinear wraps periodically in y', near(sampleField(T, d, 1.3, 0.1, 0.5), sampleField(T, d, 1.3, 3.1, 0.5), 1e-6));
  ok('view: z clamps at the walls to the nearest cell layer', near(sampleField(T, d, 1.25, 1.25, 0), T[cellIndex(2, 2, 0, d)], 1e-6));
  ok('view: velocity sampling picks the component', near(sampleField(vel, d, 1.0, 1.0, 0.5, 4, 0), 0.3, 1e-6) && near(sampleField(vel, d, 1.0, 1.0, 0.5, 4, 1), -0.2, 1e-6));
  let wsum = true;
  for (const t of [0, 0.25, 0.5, 0.9]) { const w = crWeights(t); if (!near(w[0] + w[1] + w[2] + w[3], 1, 1e-9)) wsum = false; }
  ok('view: Catmull-Rom weights sum to 1 and interpolate', wsum && near(crWeights(0)[1], 1) && near(crWeights(1)[2], 1, 1e-12));
  ok('view: sectRow maps walls and cell centres', sectRowCoord(0, 16) === 0 && near(sectRowCoord(1, 16), 17) && near(sectRowCoord(2.5 / 16, 16), 3) && near(sectRowCoord(0.5 / 16, 16), 1));
  const keys = [-3.5, -1, -1e-6, 0, 1e-6, 0.25, 1, 7.5].map(fkey);
  ok('view: fkey keeps the f32 order', keys.every((k, i) => i === 0 || k > keys[i - 1]) && keys.every(k => k > 0));
  ok('view: funkey inverts fkey', [-3.5, -1, 0, 0.25, 1, 7.5].every(f => funkey(fkey(f)) === f));
  ok('view: toneT auto range and gain about bias', near(toneT(0.3, 0.2, 0.4), 0.5) && near(toneT(0.5, 0, 1, { auto: false, gain: 2 }), 0.5) && toneT(9, 0, 1) === 1 && toneT(-9, 0, 1) === 0);

  const surf = refSurface(T, vel, d, 0.5);
  ok('view: refSurface gives T at surfaceZ', near(surf[0], 1 - 0.5 + 0.2 * (0.25 / 4), 1e-5));
  const xi = 1, dw = surf[4 * (xi + d.nx * 2) + 2];
  const exact = (2 * Math.PI / d.Lx) * Math.cos((2 * Math.PI * (xi + 0.5) * d.dx) / d.Lx);
  ok('view: refSurface dw/dx is the central difference', near(dw, exact, 0.25 * Math.abs(exact) + 0.05), `${dw.toFixed(3)} vs ${exact.toFixed(3)}`);
  ok('view: surfSample is periodic and hits cell values', near(surfSample(surf, d, 0.25, 0.25), surf[0], 1e-6) && near(surfSample(surf, d, 4.25, 3.25), surf[0], 1e-5));

  const seg = sliceSegment({ angle: 0, offset: 0.25 }, d.Lx, d.Ly);
  const ns = sectionCount(seg.len, d.dx, 64);
  const sect = refSection(T, vel, d, seg, ns);
  ok('view: section samples along the cut', ns === 9 && near(sect[4 * (4 + ns * 2)], sampleField(T, d, 2, seg.p0[1], 1.5 / d.nz), 1e-5));
  ok('view: section wall rows extrapolate T', near(sect[4 * 4], 1.5 * sect[4 * (4 + ns)] - 0.5 * sect[4 * (4 + 2 * ns)], 1e-6));
  ok('view: section u_s is the velocity along the cut', near(sect[4 * (3 + ns * 2) + 1], 0.3, 1e-6));
  const segY = sliceSegment({ angle: Math.PI / 2, offset: 0 }, d.Lx, d.Ly);
  const sectY = refSection(T, vel, d, segY, sectionCount(segY.len, d.dx, 64));
  ok('view: a cut along +y reads u_s = v', near(sectY[4 * (1 + sectionCount(segY.len, d.dx, 64) * 2) + 1], -0.2, 1e-6));
  ok('view: sectSample at a cell row returns the row', near(sectSample(sect, ns, d.nz, 0.5, 1.5 / d.nz), sect[4 * (4 + ns * 2)], 1e-6));
  ok('view: sectSample at z = 0 is the bottom wall row', near(sectSample(sect, ns, d.nz, 0.5, 0), sect[4 * 4], 1e-6));

  // ---- block geometry ----
  const eye = [2 - 6, 2 - 7, 4];
  const polys = cutBlock(s0, eye, 4, 4);
  const cut = polys.find(p => p.kind === 3);
  ok('view: cutaway keeps the far half and adds the cut face', !!cut && polys.every(p => p.pts.every(q => q[1] >= 2 - 1e-9)) && cut.n[1] < 0);
  const geo = blockGeometry(polys, eye, 1);
  ok('view: block shows top, cut and the visible sides', geo.faces.includes(0) && geo.faces.includes(3) && !geo.faces.includes(1) && geo.nv % 3 === 0 && geo.nv <= 128 && geo.ne <= 64 && geo.ne >= 6);
  const geoAll = blockGeometry(cutBlock(sliceSegment({ angle: 0.7, offset: 0.3 }), [9, -6, 5], 4, 4), [9, -6, 5], 1.5);
  ok('view: oblique cut stays inside the buffer limits', geoAll.nv <= 128 && geoAll.ne <= 64 && geoAll.faces.includes(3));

  // ---- WGSL ----
  const common = read('shaders/view-common.wgsl'), prep = read('shaders/view-prep.wgsl'), draw = read('shaders/view-draw.wgsl');
  const struct = common.slice(common.indexOf('struct View'), common.indexOf('};', common.indexOf('struct View')));
  const fields = [...struct.matchAll(/^\s*(\w+)\s*:/gm)].map(m => m[1]);
  ok('view: struct View fields match VIEW_FIELDS', fields.join() === VIEW_FIELDS.join(), fields.join());
  const size = fields.reduce((s, f) => s + (f === 'viewProj' ? 64 : 16), 0);
  ok('view: struct View is VIEW_FLOATS floats', size === VIEW_FLOATS * 4 && packView({ nx: 8, ny: 8, nz: 4, Lx: 4, Ly: 4, zScale: 1, surfaceZ: 0.9, seg: s0, ns: 9, slab: 0.1, gain: 1, bias: 0.5, auto: true, relief: 1, sheen: 0, dpr: 2, tracerCount: 5, na: 3, nza: 2, streak: 1 }).length === VIEW_FLOATS);
  const pvIn = { nx: 8, ny: 8, nz: 4, Lx: 4, Ly: 4, zScale: 1.5, surfaceZ: 0.9, seg: s0, ns: 9, slab: 0.1, gain: 1, bias: 0.5, auto: true, srgb: false, relief: 1, sheen: 0, isotherms: true, dpr: 2, rSurf: { x: 1, y: 2, w: 3, h: 4 }, tracerCount: 5, na: 3, nza: 2, streak: 1 };
  const pv = packView(pvIn);
  ok('view: packView puts the cut-line flag in eye.w', pv[63] === 1 && packView({ ...pvIn, sliceLine: false })[63] === 0);
  ok('view: packView offsets (box, segB, rSurf, over)', pv[22] === 1.5 && near(pv[23], 0.9) && pv[28] === 4 && pv[30] === 6 && pv[40] === 1 && pv[43] === 4 && pv[56] === 5);
  for (const fn of ['wrapi', 'cellIdx', 'sampleT', 'sampleV', 'crw', 'sectRow', 'fkey', 'funkey', 'toneT']) ok(`view: WGSL has fn ${fn}`, new RegExp(`fn ${fn}\\s*\\(`).test(common));
  // Tint traps: inside one parenthesis level, no && with ||, no bitwise op
  // next to arithmetic, no unparenthesized ^
  const traps = [];
  for (const [name, src] of [['common', common], ['prep', prep], ['draw', draw]]) {
    const code = src.replace(/\/\/.*$/gm, '');
    const stack = [[]];
    const tokens = code.match(/&&|\|\||<<|>>|[()&|^*/%+]|-(?![>\d])/g) || [];
    for (const t of tokens) {
      if (t === '(') stack.push([]);
      else if (t === ')') { const g = stack.pop() || []; check(g); }
      else stack[stack.length - 1].push(t);
    }
    function check(g) {
      const logic = new Set(g.filter(t => t === '&&' || t === '||'));
      const bit = g.filter(t => ['&', '|', '^', '<<', '>>'].includes(t));
      const arith = g.filter(t => ['*', '/', '%', '+', '-'].includes(t));
      if (logic.size > 1) traps.push(`${name}: && with ||`);
      if (bit.length && arith.length) traps.push(`${name}: bitwise with arithmetic`);
      if (new Set(bit).size > 1) traps.push(`${name}: mixed bitwise`);
    }
    if (/var<storage,\s*read_write>/.test(draw)) traps.push('draw: read_write storage in the render module');
  }
  ok('view: WGSL has no Tint operator traps', traps.length === 0, traps.slice(0, 4).join('; '));
  const wgStores = (prep.match(/@workgroup_size\((\d+)(?:,\s*(\d+))?/g) || []).map(s => s.match(/\d+/g).reduce((a, b) => a * b, 1));
  ok('view: workgroups <= 256 invocations', wgStores.every(n => n <= 256) && wgStores.length === 3);

  // ---- mock GPU run ----
  const log = await mockRun(common, prep, draw);
  ok('view: createViews builds 3 compute + 8 render pipelines', log.compute.length === 3 && log.render.length === 8, `${log.compute.length} / ${log.render.length}`);
  ok('view: every pipeline entry point exists in its module', log.missing.length === 0, log.missing.join(','));
  ok('view: bind groups fill every layout binding', log.bgErrors.length === 0, log.bgErrors.join('; '));
  ok('view: uniform write is 256 bytes', log.uniWrites.every(n => n === 256) && log.uniWrites.length >= 1);
  ok('view: one render pass with a clear to transparent black', log.passes === 1 && log.clear === 'clear,0,0,0,0');
  ok('view: viewports stay inside the target', log.viewports.length >= 4 && log.viewports.every(v => v.x >= 0 && v.y >= 0 && v.x + v.w <= log.pw + 1e-6 && v.y + v.h <= log.ph + 1e-6), JSON.stringify(log.viewports[0]));
  ok('view: scissors stay inside the target', log.scissors.every(v => v.x >= 0 && v.y >= 0 && v.x + v.w <= log.pw && v.y + v.h <= log.ph));
  ok('view: draws surface, slice, plate, tracers, block, edges', ['fsSurface', 'fsSlice', 'fsPlate', 'fsMark', 'fsBlock', 'fsEdge'].every(f => log.drawn.includes(f)), log.drawn.join(','));
  ok('view: a new sim buffer makes new bind groups', log.rebinds >= 2);
  ok('view: pickSurface and sliceFromDrag on the views object', log.pick && near(log.pick.x, 2) && near(log.pick.y, 2) && log.drag && near(log.drag.angle, 0));
}

async function mockRun(common, prep, draw) {
  const log = { compute: [], render: [], missing: [], bgErrors: [], uniWrites: [], passes: 0, clear: '', viewports: [], scissors: [], drawn: [], rebinds: 0, pw: 0, ph: 0 };
  let uniBuf = null;
  const has = (code, ep) => new RegExp(`fn ${ep}\\s*\\(`).test(code);
  const device = {
    createShaderModule: ({ code, label }) => ({ code, label, getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroupLayout: ({ entries }) => ({ entries }),
    createPipelineLayout: o => o,
    createComputePipelineAsync: async o => { log.compute.push(o.compute.entryPoint); if (!has(o.compute.module.code, o.compute.entryPoint) || !o.compute.module.code.includes('fn csRange')) log.missing.push(o.compute.entryPoint); return { fs: o.compute.entryPoint }; },
    createRenderPipelineAsync: async o => {
      log.render.push(o.fragment.entryPoint);
      for (const ep of [o.vertex.entryPoint, o.fragment.entryPoint]) if (!has(o.vertex.module.code, ep)) log.missing.push(ep);
      return { fs: o.fragment.entryPoint };
    },
    createBuffer: o => { const b = { ...o, destroy() {} }; if (o.label === 'tc view uniform') uniBuf = b; return b; },
    createTexture: o => ({ ...o, createView: () => ({}), destroy() {} }),
    createSampler: () => ({}),
    createBindGroup: ({ layout, entries }) => {
      log.rebinds++;
      const got = new Set(entries.map(e => e.binding));
      for (const e of layout.entries) if (!got.has(e.binding)) log.bgErrors.push(`missing ${e.binding}`);
      for (const e of entries) if (e.resource && 'buffer' in e.resource && !e.resource.buffer) log.bgErrors.push(`empty ${e.binding}`);
      return {};
    },
    queue: { writeBuffer: (b, _off, data) => { if (b === uniBuf) log.uniWrites.push(data.byteLength); }, writeTexture() {} },
  };
  const mkBuf = () => ({ usage: 128, destroy() {} });
  const sim = { dims: { nx: 64, ny: 64, nz: 16, Lx: 4, Ly: 4, dx: 1 / 16 }, buffers: { T: mkBuf(), vel: mkBuf(), tracers: mkBuf() }, tracerCount: 6000 };
  const files = { 'view-common.wgsl': common, 'view-prep.wgsl': prep, 'view-draw.wgsl': draw };
  const views = await createViews(device, 'bgra8unorm', sim, { loadText: async u => files[u.split('/').pop()] });
  views.set({ palette: 'broth', arrows: true, tracers: true, zScale: 1.5 });
  const W = 390, H = 844, dpr = 3;
  const rects = { ...layoutRects(W, H, 'split', { b: 120 }, { zScale: 1.5 }), block: { x: 0, y: 0, w: 390, h: 300 } };
  log.pw = W * dpr; log.ph = H * dpr;
  const target = { width: log.pw, height: log.ph, createView: () => ({}) };
  let cur = null;
  const encoder = {
    beginComputePass: () => ({ setBindGroup() {}, setPipeline() {}, dispatchWorkgroups() {}, end() {} }),
    beginRenderPass: o => {
      log.passes++;
      const c = o.colorAttachments[0];
      log.clear = [c.loadOp, c.clearValue.r, c.clearValue.g, c.clearValue.b, c.clearValue.a].join();
      return {
        setBindGroup() {}, setVertexBuffer() {},
        setPipeline: p => { cur = p; },
        setViewport: (x, y, w, h) => log.viewports.push({ x, y, w, h }),
        setScissorRect: (x, y, w, h) => log.scissors.push({ x, y, w, h }),
        draw: () => log.drawn.push(cur.fs),
        end() {},
      };
    },
  };
  views.render(encoder, target, { w: W, h: H, dpr }, rects);
  sim.buffers = { ...sim.buffers, T: mkBuf() };
  log.passes = 0;
  views.render(encoder, target, { w: W, h: H, dpr }, rects);
  const s = rects.surface;
  log.pick = views.pickSurface(s.x + s.w / 2, s.y + s.h / 2, rects);
  log.drag = views.sliceFromDrag({ x: 0.5, y: 1 }, { x: 3.5, y: 1 });
  views.destroy();
  return log;
}

// run alone: node tests/view.test.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  let fails = 0, runs = 0;
  await run((name, cond, info = '') => { runs++; if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? ' · ' + info : ''}`); });
  console.log(fails ? `${fails} of ${runs} failed` : `all ${runs} passed`);
  if (fails) process.exit(1);
}
