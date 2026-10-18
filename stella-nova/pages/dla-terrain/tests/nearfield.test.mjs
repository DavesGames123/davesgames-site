// ============================================================================
//  DLA TERRAIN  ·  tests/nearfield.test.mjs — the near field (package NEAR)
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/dla-terrain/tests/nearfield.test.mjs
//  (tests.mjs also runs every file in tests/). Exit code 1 on a fail.
//    SHADOWS   gpu/shadows.js: the near-field split scheme, the texel of
//              cascade 0, texel snap under camera moves and turns, a
//              stable radius under small field of view changes, the bias
//              and the packed CascadeInfo, the PCSS loop caps.
//    PLANTS    bent foliage normals (outward, bark untouched), the bush
//              pool (3D shrubs before card bushes), the wind margins and
//              the calm frequencies of props.wgsl and grass.wgsl, tufts.
//    MIPS      the alpha-weighted colour mips (no dark halo), coverage.
//    CAPS      vegCaps: fixed instance and blade caps (no zoom term), LOD
//              cross-fade bands, the TAA flag of the dither.
//    AO        render/ao.js aoPlan (off on phones, Low and governor 2+),
//              shaders/ao.wgsl constant loops and its fixed cost.
//  grep -n targets: "── shadows", "── ao", "── plants", "── mips", "── caps"
// ============================================================================
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearSplits, computeCascades, stableRadius, FIRST_SPLIT, ONE_CASCADE } from '../gpu/shadows.js';
import { packCascades, CASCADE_FLOATS } from '../gpu/globals.js';
import { project } from '../gpu/mat.js';
import { aoPlan, AO_MAX_PX, AO_RADIUS } from '../render/ao.js';
import { effectUniforms, pomSteps, POM_NEAR, POM_MAX } from '../render/ground.js';
import { bendFoliageNormals, loadAssetProtos, alphaMip, MIP_ALPHA_K, vegCaps, writeCullParams, LOD_PX, fadeKeep, PAGE } from '../render/vegetation.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0, passes = 0;
function check(name, ok, info = '') {
  if (ok) { passes++; console.log('  ok   ' + name + (info ? '  (' + info + ')' : '')); }
  else { fails++; console.log('  FAIL ' + name + (info ? '  (' + info + ')' : '')); }
}
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };

// ── shadows
{
  for (const [far, count] of [[2500, 3], [5000, 3], [9000, 4], [14000, 4], [2500, 2]]) {
    const s = nearSplits(far, count);
    const rising = s.every((v, i) => i === 0 || v > s[i - 1]);
    check(`splits rise to far (${count} cascades, ${far} m)`, rising && s.length === count && Math.abs(s[count - 1] - far) < 1e-6, s.map((v) => v.toFixed(1)).join(' '));
    check(`cascade 0 is the near field (${count}, ${far} m)`, Math.abs(s[0] - FIRST_SPLIT[count]) < 1e-6, s[0].toFixed(1) + ' m');
  }
  check('one cascade covers the near field only', nearSplits(9000, 1)[0] === ONE_CASCADE && nearSplits(150, 1)[0] === 150);

  const sun = norm([0.4, 0.35, -0.69]);
  const bounds = { min: [-10000, -50, -10000], max: [10000, 3600, 10000] };
  const cam = { pos: [120, 540, -300], forward: norm([0.7, -0.05, -0.7]), fovY: 1.0, aspect: 16 / 9, near: 0.1 };
  for (const size of [2048, 4096]) {
    const c = computeCascades(cam, sun, { count: 4, size, far: 9000, bounds });
    check(`cascade 0 texel at ${size} is under 2 cm`, c.texel[0] < 0.02, (c.texel[0] * 100).toFixed(2) + ' cm');
    check(`cascade 1 texel at ${size} is under 16 cm`, c.texel[1] < 0.16, (c.texel[1] * 100).toFixed(2) + ' cm');
  }
  const opt = { count: 4, size: 2048, far: 9000, bounds };
  const base = computeCascades(cam, sun, opt);
  // texel snap: a world point keeps its sub-texel position under camera
  // moves (translation) and turns (yaw, pitch); only whole texels change
  const P = [140, 535, -320];
  let worst = 0, radiiSame = true;
  for (let k = 0; k < 60; k++) {
    const a = k * 0.37, m = 0.013 * k;
    const fw = norm([Math.sin(0.78 + a * 0.05), -0.05 + 0.01 * Math.sin(a), -Math.cos(0.78 + a * 0.05)]);
    const c2 = computeCascades({ ...cam, pos: [cam.pos[0] + m * 3.1, cam.pos[1] + m, cam.pos[2] - m * 1.7], forward: fw }, sun, opt);
    for (let i = 0; i < 4; i++) {
      if (c2.radii[i] !== base.radii[i]) radiiSame = false;
      const q1 = project(base.mats[i], P), q2 = project(c2.mats[i], P);
      for (const ax of [0, 1]) {
        const d = (q1[ax] - q2[ax]) * size2(opt.size);
        worst = Math.max(worst, Math.abs(d - Math.round(d)));
      }
    }
  }
  function size2(s) { return s / 2; }
  check('a world point keeps its sub-texel place in every cascade (60 moves and turns)', worst < 2e-3, 'worst ' + worst.toExponential(2) + ' texel');
  check('the cascade radii do not change when the camera moves or turns', radiiSame);
  let fovSteps = 0;
  for (let k = 0; k < 40; k++) {
    const a = computeCascades({ ...cam, fovY: 0.9 + k * 0.004 }, sun, opt), b = computeCascades({ ...cam, fovY: 0.9 + (k + 1) * 0.004 }, sun, opt);
    if (a.radii.some((r, i) => r !== b.radii[i])) fovSteps++;
  }
  check('small field of view changes seldom change a radius (stable steps)', fovSteps <= 16, fovSteps + ' of 40 steps of 0.004 rad');
  check('stableRadius rounds up in steps of 1/16 of the power of two', stableRadius(17.3) === 18 && stableRadius(16) === 16 && [3.3, 77, 1000, 15270].every((r) => stableRadius(r) >= r && stableRadius(r) <= r * 1.0625));
  // the bias: a few cm of clip depth, the receiver bias per cascade on the GPU
  check('constant depth bias is under 5 cm of the light box', base.depthBias * base.depthRange < 0.05, (base.depthBias * base.depthRange * 100).toFixed(1) + ' cm');
  const f = packCascades(new Float32Array(CASCADE_FLOATS), base);
  check('CascadeInfo packs depth range and sun size', CASCADE_FLOATS === 80 && Math.abs(f[76] - base.depthRange) < 1 && f[77] > 0.002 && f[77] < 0.05);
  check('the old practical split is still there on request', computeCascades(cam, sun, { ...opt, lambda: 0.82 }).splits[0] > 100);
  // PCSS: constant loop caps and parentheses (Tint) in common.wgsl
  const common = readFileSync(join(DIR, 'shaders/common.wgsl'), 'utf8');
  const soft = common.slice(common.indexOf('fn sunShadowSoftAt'), common.indexOf('fn sunShadowSoft('));
  check('PCSS loops have constant bounds', /i < SOFT_SEARCH/.test(soft) && /i < SOFT_TAPS/.test(soft) && /const SOFT_SEARCH: i32 = \d+;/.test(common) && /const SOFT_TAPS: i32 = \d+;/.test(common));
  check('PCSS early-out when no blocker', /if \(bN < 0\.5\) \{ return 1\.0; \}/.test(soft));
  const g = readFileSync(join(DIR, 'shaders/ground.wgsl'), 'utf8'), p = readFileSync(join(DIR, 'shaders/props.wgsl'), 'utf8');
  check('ground and plants use the soft shadow', /sunShadowSoft\(pW, nGeo/.test(g) && /sunShadowSoft\(wp, n, fc\)/.test(p));
}

// ── ao
{
  const desk = { id: 'desktop', taa: null };
  check('AO on at High on a desktop', aoPlan({ quality: 0.75, govLevel: 0 }, desk).on);
  check('AO off at Low (no TAA to resolve the noise)', !aoPlan({ quality: 0.25 }, desk).on);
  check('AO off on a phone profile', !aoPlan({ quality: 1 }, { id: 'phone', taa: false }).on && !aoPlan({ quality: 1 }, { id: 'phone-min', taa: false }).on && !aoPlan({ quality: 1 }, {}, 'phone').on);
  check('AO on with the safari and safe profiles', aoPlan({ quality: 0.75, govLevel: 1 }, { id: 'safe', taa: null }, 'safe').on && aoPlan({ quality: 1 }, { id: 'safari', taa: null }, 'safari').on);
  check('AO off at governor level 2 and up', !aoPlan({ quality: 1, govLevel: 2 }, desk).on && aoPlan({ quality: 1, govLevel: 1 }, desk).on);
  const plan = aoPlan({ quality: 1 }, desk);
  check('AO radius and screen reach are fixed (no zoom term)', plan.radius === AO_RADIUS && plan.maxPx === AO_MAX_PX && AO_MAX_PX <= 64);
  const w = readFileSync(join(DIR, 'shaders/ao.wgsl'), 'utf8');
  const dirs = +(w.match(/const AO_DIRS: i32 = (\d+);/) || [])[1], steps = +(w.match(/const AO_STEPS: i32 = (\d+);/) || [])[1];
  check('AO loops have constant bounds', /k < AO_DIRS/.test(w) && /j < AO_STEPS/.test(w) && /side < 2/.test(w) && /i = -4; i <= 4/.test(w) && /k < 4; k\+\+/.test(w));
  check('AO costs at most 24 depth loads a half-size pixel', dirs * 2 * steps + 5 <= 24, (dirs * 2 * steps + 5) + ' loads');
  const gj = readFileSync(join(DIR, 'render/ground.js'), 'utf8');
  check('ground runs the AO in the volumetric hooks', /volumetricPrep: ao \?/.test(gj) && /drawVolumetric: ao \?/.test(gj));
}

// ── ground caps (NOTES.md CRASH -> GROUND)
{
  let worstNear = 0, worstFar = 0;
  for (const d of [0, 0.5, 2, 10, 30, 50]) for (const ndv of [0, 0.1, 0.5, 1]) {
    worstNear = Math.max(worstNear, pomSteps(d, ndv, effectUniforms(1, false, 64, true)));
    worstFar = Math.max(worstFar, pomSteps(d, ndv, effectUniforms(1, false, 64, false)));
  }
  check('POM near the ground takes at most POM_NEAR steps', worstNear <= POM_NEAR && worstNear > 0, worstNear + ' steps');
  check('POM away from the ground keeps POM_MAX', worstFar === POM_MAX);
  const gw = readFileSync(join(DIR, 'shaders/ground.wgsl'), 'utf8');
  check('ground.wgsl caps the POM steps from U.fx.x', /min\(i32\(floor\(U\.fx\.x\)\), POM_MAX\)/.test(gw));
  const gj = readFileSync(join(DIR, 'render/ground.js'), 'utf8');
  check('the phone path is keyed on the profile id', /\/\^phone\/\.test\(gpu\.profileId/.test(gj) && /effectUniforms\(quality, phoneP/.test(gj));
}

// ── plants
{
  // a crown of 200 random cards (normals random) and a trunk
  const VS = 12, mk = (kind, n, f) => { const v = new Float32Array(n * VS); for (let i = 0; i < n; i++) v.set(f(i), i * VS); return { kind, n, v }; };
  let s = 7; const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const leaf = mk('leaf', 200, () => { const a = r() * 6.283, b = Math.acos(2 * r() - 1), rr = 3 * Math.cbrt(r()); const n = [r() - 0.5, r() - 0.5, r() - 0.5]; const l = Math.hypot(...n); return [Math.cos(a) * Math.sin(b) * rr, 8 + Math.cos(b) * rr, Math.sin(a) * Math.sin(b) * rr, n[0] / l, n[1] / l, n[2] / l, 0, 0, 0, 0, 1, 1]; });
  const bark = mk('bark', 4, (i) => [0.2, i, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0]);
  const barkBefore = Array.from(bark.v);
  const res = bendFoliageNormals([[bark, leaf]]);
  let out = 0, unit = true;
  for (let i = 0; i < leaf.n; i++) {
    const o = i * VS, p = [leaf.v[o] - res.crown.c[0], leaf.v[o + 1] - res.crown.c[1], leaf.v[o + 2] - res.crown.c[2]];
    const pl = Math.hypot(...p) || 1, d = (p[0] * leaf.v[o + 3] + p[1] * leaf.v[o + 4] + p[2] * leaf.v[o + 5]) / pl;
    if (d > 0.3) out++;
    if (Math.abs(Math.hypot(leaf.v[o + 3], leaf.v[o + 4], leaf.v[o + 5]) - 1) > 1e-4) unit = false;
  }
  check('bent leaf normals point out of the crown', out >= 190 && unit, out + ' of 200 outward');
  check('bark normals are not bent', Array.from(bark.v).every((x, i) => x === barkBefore[i]));
  check('no leaves: no bend', bendFoliageNormals([[bark]]) === null);
  // the bush pool: the 3D shrubs before the card bushes
  const tri = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), uvs: new Float32Array(6), indices: [0, 1, 2], vertexCount: 3, material: { name: 'm', alphaMode: 'MASK', baseColor: { url: 'u.webp' } } };
  const asset = (id, kind, h) => ({ id, kind, name: id, height: h, radius: 0.8, lods: [{ textures: [] }] });
  const lib = { manifest: { assets: [asset('nobiax_bushes_a', 'bush', 1.5), asset('nobiax_bushes_b', 'bush', 1.3), asset('shrub_02_a', 'bush', 1.6), asset('shrub_02_b', 'bush', 1.5)] },
    loadAsset: async () => ({ scene: { meshes: [tri] } }), url: (x) => x };
  const sets = await loadAssetProtos(lib, 64, () => {});
  const ids = (sets.bush || []).map((x) => x.id);
  check('bush species takes the 3D shrubs, not the card bushes', ids.length === 2 && ids.every((x) => x.startsWith('shrub_02')), ids.join(' '));
  const lib2 = { ...lib, manifest: { assets: [asset('nobiax_bushes_a', 'bush', 1.5)] } };
  check('the card bushes stay when nothing else fits', ((await loadAssetProtos(lib2, 64, () => {})).bush || []).length === 1);
  // wind: the props.wgsl offsets stay inside the wind margin of the bounds
  const pw = readFileSync(join(DIR, 'shaders/props.wgsl'), 'utf8'), gw = readFileSync(join(DIR, 'shaders/grass.wgsl'), 'utf8');
  check('props wind keeps the documented coefficients', /let sway = sin\(\(t \* 6\.2831853 \* fT\) \+ \(seed \* 31\.0\)\) \* 0\.25;/.test(pw)
    && /\(0\.05 \+ \(0\.02 \* speed\)\) \* gust/.test(pw) && /\(0\.02 \+ \(0\.006 \* speed\)\) \* gust/.test(pw) && /\(0\.7 \+ \(G\.wind\.z \* 0\.6\)\)/.test(pw));
  let worst = 0;
  for (const speed of [0, 2, 6, 12, 25]) {
    const gustMax = 1.0 * (0.7 + 0.6);
    const bend = speed * gustMax * 1.25 * 0.06;                         // x bend x min(h, 30)
    const tip = Math.hypot(1, 0.35) * (0.05 + 0.02 * speed) * gustMax + (0.02 + 0.006 * speed) * gustMax;   // x flutter
    worst = Math.max(worst, bend / (0.122 * Math.max(speed, 1e-6)) * (speed > 0 ? 1 : 0), tip / (1.9 * (0.15 + 0.05 * speed)));
  }
  check('wind offsets stay inside the bounds margin (no cull pop)', worst < 1, 'worst ' + worst.toFixed(2) + ' of the margin');
  // CHILL: the highest frequencies (Hz) of each layer
  const hz = (re, src) => { const m = src.match(re); return m ? +m[1] + +m[2] : NaN; };
  const fT = hz(/let fT = \(([\d.]+) \+ \(([\d.]+) \* fract/, pw), fB = hz(/let fB = ([\d.]+) \+ \(([\d.]+) \* fract/, pw), fL = hz(/let fL = ([\d.]+) \+ \(([\d.]+) \* fract/, pw);
  const fG = hz(/t \* 6\.2831853 \* \(([\d.]+) \+ \(bl\.b\.w \* ([\d.]+)\)\)/, gw);
  check('calm motion: trunk <= 0.35 Hz, branch <= 0.8 Hz, leaf <= 2 Hz, grass <= 1 Hz', fT <= 0.35 && fB <= 0.8 && fL <= 2 && fG <= 1, `trunk ${fT}, branch ${fB}, leaf ${fL}, grass ${fG}`);
  check('gusts travel (noise field moved downwind), grass and trees share it', /fn vegGust/.test(pw) && /fn grassGust/.test(gw) && /t \* \(1\.5 \+ \(sp \* 0\.8\)\)/.test(pw) && /t \* \(1\.5 \+ \(sp \* 0\.8\)\)/.test(gw));
  check('grass blades lean out of tufts and take the soft shadow', /const TUFT: f32/.test(gw) && /outA/.test(gw) && /sunShadowSoft\(o\.wp, tn, o\.pos\.xy\)/.test(gw));
}

// ── mips
{
  // a leaf texel (green, opaque) next to empty texels (dark, alpha 0)
  const src = new Float32Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) src.set([0.02, 0.03, 0.01, 0], i * 4);
  src.set([0.2, 0.5, 0.1, 1], 0); src.set([0.2, 0.5, 0.1, 1], 4); src.set([0.2, 0.5, 0.1, 1], 16);
  const m = alphaMip(src, 4, 4);
  check('colour mips keep the leaf colour (no dark bleed from empty texels)', Math.abs(m[1] - 0.5) < 1e-6 && Math.abs(m[0] - 0.2) < 1e-6);
  check('colour mips scale the alpha by MIP_ALPHA_K', Math.abs(m[3] - Math.min(1, 0.75 * MIP_ALPHA_K)) < 1e-6 && m[7] === 0);
  // coverage: leaf blobs (2 x 2 texels, about 45 % cover) keep their 0.5-cut
  // coverage at the first mip (far crowns: props.wgsl cutAlpha adds a mip bias)
  let s2 = 3; const r = () => ((s2 = (s2 * 1103515245 + 12345) >>> 0) / 4294967296);
  const lv = new Float32Array(64 * 64 * 4);
  for (let by = 0; by < 32; by++) for (let bx = 0; bx < 32; bx++) {
    const on = r() < 0.45, ox = (bx * 2 + (by % 2)) % 64;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) lv.set([0.1, 0.4, 0.1, on ? 1 : 0], (((by * 2 + dy) * 64) + ((ox + dx) % 64)) * 4);
  }
  const cov = (L, n) => { let c = 0; for (let i = 0; i < n; i++) if (L[i * 4 + 3] >= 0.5) c++; return c / n; };
  const c0 = cov(lv, 64 * 64), c1 = cov(alphaMip(lv, 64, 64), 32 * 32);
  check('the 0.5 cut keeps the leaf coverage at the first mip (within 0.15)', Math.abs(c1 - c0) < 0.15, 'base ' + c0.toFixed(2) + ', mip 1 ' + c1.toFixed(2));
  const vj = readFileSync(join(DIR, 'render/vegetation.js'), 'utf8');
  check('the GPU mip shader is the alpha-weighted box (fn fsw) on colour maps', /fn fsw/.test(vj) && /wc \/ max\(sa, 1e-4\)/.test(vj) && /format\.endsWith\('-srgb'\) \? 'fsw' : 'fs'/.test(vj));
}

// ── caps
{
  const lim = { maxStorageBufferBindingSize: 134217728 };
  for (const [q, coarse, vp] of [[1, false, {}], [0.75, false, {}], [0.25, false, {}], [0.75, true, { grassCap: 60000, farK: 0.75 }], [0.25, true, { grassCap: 20000, farK: 0.5 }]]) {
    const c = vegCaps(q, coarse, vp, lim);
    const tag = `q ${q}${coarse ? ' phone' : ''}`;
    check(`${tag}: fixed caps (pages ${c.maxPages}, blades ${c.grassCap}, groups ${c.grassGroups} + ${c.propGroupsMax})`,
      c.maxPages * PAGE * 32 <= 16 * 1024 * 1024 && c.grassCap * 48 <= lim.maxStorageBufferBindingSize && c.grassGroups <= 4 * 70 * 70 && c.propGroupsMax <= 4000 && (!vp.grassCap || c.grassCap <= vp.grassCap));
  }
  check('phone farK of the profile scales the layer distances', vegCaps(0.25, true, { farK: 0.5 }).farK < vegCaps(0.25, true, {}).farK);
  // LOD cross-fade: each LOD band hands over over 25 % of its threshold,
  // and the two dithers of a band keep every pixel once
  const bandsOk = LOD_PX.slice(0, 3).every((t, i) => i === 0 || t * 1 < LOD_PX[i - 1] * 0.75);
  let sumOk = true;
  for (let b = 0.05; b <= 1.0001; b += 0.05) if (Math.abs(fadeKeep(-b, 1) + fadeKeep(b, 1) - 1) > 1e-9) sumOk = false;
  check('LOD bands do not overlap (each fades over its lowest 25 %)', bandsOk, LOD_PX.join(' '));
  check('a LOD cross-fade keeps every pixel once (fade + 1 - fade)', sumOk);
  const P = new Float32Array(64);
  writeCullParams(P, { cam: [0, 0, 0], proj: new Float32Array(16), taa: false });
  const off = P[56];
  writeCullParams(P, { cam: [0, 0, 0], proj: new Float32Array(16) });
  check('the TAA flag rides in layers[7].x (fixed dither without TAA)', off === 0 && P[56] === 1);
  const pw = readFileSync(join(DIR, 'shaders/props.wgsl'), 'utf8');
  check('props dither turns per frame only with TAA', /fn ditherFrame\(\) -> f32 \{ return select\(0\.0, G\.frame\.x, VP\.layers\[7\]\.x > 0\.5\); \}/.test(pw) && !/cm_ign\(fc\) \+ G\.frame\.x/.test(pw));
}

console.log(`nearfield: ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
