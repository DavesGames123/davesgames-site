// ============================================================================
//  CORAL REEF  ·  tests/bioglow.test.mjs  ·  bioluminescence (node, no browser)
//    node tests/bioglow.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "the bioluminescence across organisms is
//  poorly done. bloom on textures please". Checks:
//    photophores ... every glowing species (real and generated) has an
//                    emissive photophore map on its body: dots of the map,
//                    or small solid light organs (no whole-body glow)
//    colours ....... per species; blue-green for most, red for the
//                    dragonfish Malacosteus
//    counter ....... the counter-illumination level follows the downwelling
//                    (the twin of the WATER sky term), and the mean belly
//                    emission equals the downwelling luminance
//    startle ....... an ROV that comes near starts a flash and a wave; a far
//                    ROV does not; the sea pen glows only when touched; a
//                    lamp beam dims the display glow
//    shaders ....... naga reads the fauna programs with the photophore mask
//    bloom ......... the CPU twin of bloom.js: lit rock at the typical
//                    exposure gives 0, a photophore pixel gives; the chain
//                    and the composite keep the energy; a small radius;
//                    the bloom pass is before the composite in the frame
//    halo .......... the far glow sprite only for the lod 2 animals; fewer
//                    sprites than glowing animals
// ============================================================================
import fs from 'node:fs';
import { SPECIES, SPECIES_BY_ID, generatedSpecies } from '../fauna/species.js';
import { genModel } from '../fauna/models.js';
import { glowParams, downwelling, counterLevel, createGlowState, lampAt, dim, COVER, GLOW_GAIN, SKY_LUM } from '../fauna/glow.js';
import { checkPrograms } from '../glsl-check.mjs';

let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }

// ── photophores on the body ─────────────────────────────────────────────────
const gen = [];
for (const seed of [1, 7, 23]) for (const [px, pz] of [[0, 0], [3, 2], [-4, 5]]) for (const reg of ['twilight', 'abyss']) gen.push(...generatedSpecies(seed, px, pz, reg));
const glowing = [...SPECIES, ...gen].filter(sp => sp.src !== 'scan' && glowParams(sp));
function emissive(M) {
  const n = M.vertexCount, em = new Uint8Array(n);
  let dots = 0, organ = 0;
  for (let i = 0; i < n; i++) if (M.glow[i * 3] + M.glow[i * 3 + 1] + M.glow[i * 3 + 2] > 0) { em[i] = 1; if (M.pho[i * 4 + 2] >= 1) dots++; else organ++; }
  // the area of the solid emissive triangles (organs) over the whole area
  let aE = 0, aT = 0;
  const P = M.positions, I = M.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    aT += ar;
    if (em[I[t]] && em[I[t + 1]] && em[I[t + 2]] && M.pho[I[t] * 4 + 2] < 1) aE += ar;
  }
  return { dots, organ, organArea: aE / (aT || 1) };
}
{
  const bad = [], rows = [];
  for (const sp of glowing) {
    const M = genModel(sp);
    const e0 = emissive(M.lod0), e1 = emissive(M.lod1);
    const good = (e0.dots + e0.organ) > 0 && e0.organArea < 0.2 && (e1.dots + e1.organ) > 0 && M.lod0.pho.length === M.lod0.vertexCount * 4;
    if (!good) bad.push(`${sp.id} dots ${e0.dots} organ ${e0.organ} area ${(e0.organArea * 100).toFixed(1)} %`);
    if (sp.src !== 'generated') rows.push(`${sp.id.split('-')[0]} ${e0.dots}d/${e0.organ}o`);
  }
  ok(glowing.length >= 14 && bad.length === 0, 'photophores: every glowing species has an emissive photophore map on its body (dots, or organs under 20 % of the area)', `${glowing.length} species; ${bad.slice(0, 4).join('; ') || rows.join(', ')}`);
  const need = ['myctophum-punctatum', 'argyropelecus-aculeatus', 'chauliodus-sloani', 'malacosteus-niger', 'melanocetus-johnsonii', 'vampyroteuthis-infernalis', 'histioteuthis-heteropsis', 'atolla-wyvillei', 'periphylla-periphylla', 'nanomia-bijuga', 'enypniastes-eximia', 'pennatula-phosphorea', 'eurypharynx-pelecanoides'];
  ok(need.every(id => SPECIES_BY_ID.has(id) && glowParams(SPECIES_BY_ID.get(id))), 'photophores: the lanternfish, hatchetfish, viperfish, dragonfish, anglerfish, vampire squid, jewel squid, Atolla, Periphylla, Nanomia, Enypniastes, sea pen and gulper eel glow', need.filter(id => !SPECIES_BY_ID.has(id)).join());
  // dot patterns where the animal has rows or spots; organs for the lure
  const kinds = id => emissive(genModel(SPECIES_BY_ID.get(id)).lod0);
  ok(['myctophum-punctatum', 'argyropelecus-aculeatus', 'histioteuthis-heteropsis', 'atolla-wyvillei', 'periphylla-periphylla', 'enypniastes-eximia'].every(id => kinds(id).dots > 0), 'photophores: rows and spots are dots of the map (lanternfish, hatchetfish, jewel squid, Atolla ring, Periphylla, Enypniastes)');
  ok(kinds('melanocetus-johnsonii').organ > 0 && kinds('malacosteus-niger').organ > 0 && kinds('vampyroteuthis-infernalis').organ > 0, 'photophores: the anglerfish esca, the dragonfish cheek organs and the vampire squid arm-tip and fin-base organs are solid organs');
  // the comb jellies: the comb rows are reflected light (no emissive)
  const cteno = SPECIES.filter(s => s.model && s.model.gen === 'cteno');
  ok(cteno.length >= 2 && cteno.every(s => !glowParams(s) && genModel(s).lod0.glow.every(v => v === 0)), 'comb jellies: no emissive; the rainbow of the comb rows is lamp light (GEL_FS)');
  // the lanternfish lateral row: emissive vertices on the lower flank, not only the belly
  const L = genModel(SPECIES_BY_ID.get('myctophum-punctatum')).lod0;
  let flank = 0; for (let i = 0; i < L.vertexCount; i++) if (L.glow[i * 3 + 2] > 0 && L.pho[i * 4 + 1] >= 2) flank++;
  ok(flank > 0, 'lanternfish: a lateral row of photophores above the ventral rows', `${flank} vertices in row 2`);
}

// ── colours ─────────────────────────────────────────────────────────────────
{
  const col = id => { const M = genModel(SPECIES_BY_ID.get(id)).lod0; let r = 0, g = 0, b = 0; for (let i = 0; i < M.vertexCount; i++) { r += M.glow[i * 3]; g += M.glow[i * 3 + 1]; b += M.glow[i * 3 + 2]; } return [r, g, b]; };
  const red = col('malacosteus-niger');
  const real = glowing.filter(s => s.src !== 'generated' && s.id !== 'malacosteus-niger' && s.id !== 'eurypharynx-pelecanoides');
  const blueGreen = real.filter(s => { const [r, g, b] = col(s.id); return Math.max(g, b) > r * 2; });
  ok(red[0] > 0.5 * Math.max(red[1], red[2]), 'colours: the dragonfish has a red light organ', red.map(v => v.toFixed(1)).join(','));
  ok(blueGreen.length === real.length, 'colours: the other real species glow blue-green', `${blueGreen.length} of ${real.length}`);
  ok(new Set(glowing.map(s => glowParams(s).colour)).size >= 6, 'colours: a colour per species', `${new Set(glowing.map(s => glowParams(s).colour)).size} colours`);
}

// ── counter-illumination ────────────────────────────────────────────────────
{
  const sh = fs.readFileSync(new URL('../shaders.js', import.meta.url), 'utf8');
  ok(sh.includes('vec3(0.10, 0.30, 0.52) * uDown * exp(-(SURF_Y - w.y) * 0.03)'), 'counter: downwelling() is the twin of the WATER sky term');
  const P = glowParams(SPECIES_BY_ID.get('argyropelecus-aculeatus'));
  const ys = [-50, -150, -300, -600];
  const lv = ys.map(y => counterLevel(downwelling(0.12, y), P.peak));
  ok(P.counter && lv.every((v, i) => i === 0 || v < lv[i - 1]) && lv[0] > 0, 'counter: the ventral level falls with the downwelling as the hatchetfish goes deeper', lv.map(v => v.toExponential(2)).join(' > '));
  const d = downwelling(0.45, -40);
  const mean = P.peak * COVER * GLOW_GAIN * counterLevel(d, P.peak);
  ok(Math.abs(mean - d * SKY_LUM) < 1e-9 * Math.max(1, d), 'counter: the mean belly emission equals the downwelling luminance', `${mean.toExponential(3)} = ${(d * SKY_LUM).toExponential(3)}`);
  ok(counterLevel(downwelling(0, -600), P.peak) === 0 && counterLevel(downwelling(0.6, 0), P.peak) > counterLevel(downwelling(0.3, 0), P.peak), 'counter: no downwelling (abyss) gives no counter light; twice the downwelling gives more');
  const S = createGlowState(2), st = S.step(0, P, { dt: 0.016, t: 1, phase: 0.2, d: 50, lamp: 0, startle: 0, down: d });
  ok(Math.abs(st[1] - counterLevel(d, P.peak)) < 1e-12, 'counter: the glow state puts the counter level in iGlow.y');
  ok(!glowParams(SPECIES_BY_ID.get('atolla-wyvillei')).counter, 'counter: a jellyfish does not counter-illuminate');
}

// ── startle flashes and lamp dimming ────────────────────────────────────────
{
  const atolla = glowParams(SPECIES_BY_ID.get('atolla-wyvillei'));
  const S = createGlowState(4);
  let peak = 0, waveMax = 0;
  for (let k = 0; k <= 120; k++) {
    const d = 10 - k * 0.075;                        // the ROV comes from 10 m to 1 m in 2 s
    const g = S.step(0, atolla, { dt: 1 / 60, t: k / 60, phase: 0, d, lamp: 0, startle: 0, down: 0 });
    peak = Math.max(peak, g[2]); waveMax = Math.max(waveMax, g[3]);
  }
  ok(peak > 1, 'startle: the ROV approach starts a flash (Atolla burglar alarm)', `flash ${peak.toFixed(2)}`);
  ok(waveMax > 0.5, 'startle: the flash wave runs round the ring (the wave phase moves)', `wave ${waveMax.toFixed(2)} cycles`);
  let far = 0;
  for (let k = 0; k < 120; k++) far = Math.max(far, S.step(1, atolla, { dt: 1 / 60, t: k / 60, phase: 0, d: 20 - k * 0.01, lamp: 0, startle: 0, down: 0 })[2]);
  ok(far === 0, 'startle: a far ROV (about 20 m) starts no flash');
  let f0 = 0; for (let k = 0; k < 600; k++) f0 = S.step(0, atolla, { dt: 1 / 60, t: 2 + k / 60, phase: 0, d: 30, lamp: 0, startle: 0, down: 0 })[2];
  ok(f0 < 0.3 * peak, 'startle: the flash decays when the ROV goes away', f0.toFixed(3));
  const pen = glowParams(SPECIES_BY_ID.get('pennatula-phosphorea'));
  const SP = createGlowState(2);
  const lit = SP.step(0, pen, { dt: 0.1, t: 0, phase: 0, d: 5, lamp: 1, startle: 0, down: 0 });
  ok(lit[0] === 0 && lit[2] === 0, 'sea pen: no steady glow and no flash in the lamp light alone');
  let touch = 0; for (let k = 0; k < 30; k++) touch = Math.max(touch, SP.step(0, pen, { dt: 1 / 30, t: k / 30, phase: 0, d: 2 - k * 0.05, lamp: 0, startle: 0, down: 0 })[2]);
  ok(touch > 1, 'sea pen: it glows when the ROV touches it (a wave up the colony)', touch.toFixed(2));
  const fish = glowParams(SPECIES_BY_ID.get('myctophum-punctatum'));
  const SF = createGlowState(2);
  const dark = SF.step(0, fish, { dt: 0, t: 0.5, phase: 0.1, d: 50, lamp: 0, startle: 0, down: 0 })[0];
  const inBeam = SF.step(1, fish, { dt: 0, t: 0.5, phase: 0.1, d: 50, lamp: 1, startle: 0, down: 0 })[0];
  ok(inBeam < 0.3 * dark && dim(0) === 1, 'lamp: the display glow dims in a lamp beam', `${dark.toFixed(2)} -> ${inBeam.toFixed(2)}`);
  const rov = [{ p: [0, 0, 0], look: [0, 0, 1] }];
  ok(lampAt([0, 0, 4], rov) > 0.5 && lampAt([4, 0, 0], rov) === 0 && lampAt([0, 0, -4], rov) === 0, 'lamp: lampAt is in the cone in front of the ROV only');
  let breathe = []; for (let k = 0; k < 100; k++) breathe.push(SF.step(0, fish, { dt: 0.1, t: k * 0.1, phase: 0.1, d: 50, lamp: 0, startle: 0, down: 0 })[0]);
  ok(Math.max(...breathe) - Math.min(...breathe) > 0.1 && Math.min(...breathe) > 0, 'breath: the steady glow rises and falls slowly', `${Math.min(...breathe).toFixed(2)} .. ${Math.max(...breathe).toFixed(2)}`);
}

// ── the renderer and the shaders ────────────────────────────────────────────
{
  const G = await import('../fauna/glsl.js');
  const src = fs.readFileSync(new URL('../fauna/index.js', import.meta.url), 'utf8');
  ok(/setAttribute\('aPho'/.test(src) && /setAttribute\('iGlow'/.test(src) && /deleteAttribute\('iGlow'\)/.test(src), 'renderer: fauna/index.js gives each mesh the photophore map and each instance its glow levels');
  ok(G.FAUNA_FS.includes('phoMask(vPho) * phoLevel(vGA, vPho, ny)') && G.GEL_FS.includes('phoMask(vPho) * phoLevel(vGA, vPho, ny)'), 'shaders: the opaque and gel animals draw the photophore mask with the glow levels');
  const r = checkPrograms([{ name: 'fauna', vs: G.FAUNA_VS, fs: G.FAUNA_FS, instanced: true }, { name: 'gel', vs: G.FAUNA_VS, fs: G.GEL_FS, instanced: true }]);
  for (const x of r) ok(x.ok === true, `glsl: naga reads the ${x.name} program`, x.ok === null ? 'naga not found' : (x.log || '').slice(0, 600));
}

// ── bloom (bloom.js, the CPU twin and the frame) ───────────────────────────
{
  const BL = await import('../bloom.js');
  const SH = await import('../shaders.js');
  const E = 4, w = 64, h = 48;
  // lit rock at the exposure key (0.25 exposed) with lamp-lit patches up to
  // 0.9 exposed, and three photophore pixels of 2.5 scene units (10 exposed)
  const img = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const q = (j * w + i) * 3, l = (0.25 + 0.65 * Math.max(0, Math.sin(i * 0.2) * Math.cos(j * 0.17))) / E; img[q] = l * 0.9; img[q + 1] = l; img[q + 2] = l * 1.1; }
  const dotsAt = [[20, 20], [33, 25], [40, 18]];
  for (const [i, j] of dotsAt) { const q = (j * w + i) * 3; img[q] = 0.2; img[q + 1] = 1.2; img[q + 2] = 2.5; }
  const rock = BL.brightCPU([0.9 / E, 1.0 / E, 1.1 / E], E), pho = BL.brightCPU([0.2, 1.2, 2.5], E);
  ok(Math.max(...rock) === 0, 'bloom: lit rock at the typical exposure (up to 0.9 exposed) gives nothing to the bloom', rock.map(v => v.toFixed(4)).join(','));
  ok(pho[2] > 1.5, 'bloom: a photophore pixel (10 exposed) gives most of its light to the bloom', pho.map(v => v.toFixed(3)).join(','));
  const R = BL.bloomCPU(img, w, h, { exposure: E, levels: 4 });
  const sum = a => { let s = 0; for (const v of a) s += v; return s; };
  let rockB = 0; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!dotsAt.some(([x, y]) => Math.abs(x - i) < 2 && Math.abs(y - j) < 2)) rockB += R.bright[(j * w + i) * 3 + 2];
  ok(rockB === 0, 'bloom: no rock pixel goes over the threshold', rockB);
  const sIn = sum(img), sOut = sum(R.out), sB = sum(R.bright), sBl = sum(R.bloom.img) * 4;
  ok(Math.abs(sBl - sB) / sB < 0.02, 'bloom: the mip chain keeps the energy of the bright part (sum in = sum out)', `${sB.toFixed(3)} -> ${sBl.toFixed(3)}`);
  ok(Math.abs(sOut - sIn) / sIn < 0.005, 'bloom: the composite keeps the light of the frame', `${sIn.toFixed(3)} -> ${sOut.toFixed(3)}`);
  // tight: most of the spread light stays within 4 px of the photophore
  const [ci, cj] = dotsAt[0]; let near = 0, all = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const d = Math.hypot(i - ci, j - cj); if (d > 7) continue; const v = sampleB(R.bloom, (i + 0.5) / w, (j + 0.5) / h); all += v; if (d <= 4) near += v; }
  function sampleB(b, u, v) { return BL.sampleCPU(b.img, b.w, b.h, u, v)[2]; }
  ok(near / all > 0.6, 'bloom: the default radius is small (most of the glow within 4 px)', `${(100 * near / all).toFixed(0)} % within 4 px`);
  ok(BL.BLOOM_PROFILE['phone-min'].strength === 0 && BL.BLOOM_PROFILE.phone.levels < BL.BLOOM_PROFILE.desktop.levels, 'bloom: off by default on phone-min, fewer mips on phones');
  // COMP_FS: the bloom term comes before the tone map
  const ib = SH.COMP_FS.indexOf('texture(uBloom, vUv)'), ia = SH.COMP_FS.indexOf('c = aces(c * uExposure)');
  ok(ib > 0 && ia > ib && SH.COMP_FS.includes('- bright(clamp(s0, 0.0, 64.0), uExposure, uBloomT, uBloomKnee)'), 'bloom: COMP_FS adds the bloom minus the bright part before ACES');
  const r = checkPrograms([['bloom-pre', BL.BLOOM_PRE_FS], ['bloom-down', BL.BLOOM_DOWN_FS], ['bloom-up', BL.BLOOM_UP_FS], ['composite', SH.COMP_FS]].map(([name, fs]) => ({ name, vs: SH.FULL_VS, fs, raw: true })));
  for (const x of r) ok(x.ok === true, `glsl: naga reads the ${x.name} program`, x.ok === null ? 'naga not found' : (x.log || '').slice(0, 600));
}
{
  // the frame graph on the fake WebGL2 (tests/fake-gl.mjs): the bloom passes
  // draw into targets after the scene and before the composite
  const { installThree, installDom, fakeCanvas } = await import('./fake-gl.mjs');
  installThree(); installDom();
  const { createScene } = await import('../scene.js');
  const { profileFor } = await import('../budget.js');
  const f = fakeCanvas({ w: 640, h: 400 });
  const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 4096, profile: profileFor('desktop') });
  S.resize();
  for (let i = 0; i < 4; i++) S.render(1 / 60, i * 16);
  const g = S.post.graph;
  ok(g.indexOf('bloom') > g.indexOf('scene') && g.indexOf('bloom') < g.indexOf('composite'), 'frame: the bloom pass is after the scene and before the composite (the tone map)', g.join(' > '));
  const n0 = f.log.filter(e => e.op === 'draw').length;
  S.render(1 / 60, 80);
  const n1 = f.log.filter(e => e.op === 'draw').length;
  S.setBloom(0); S.render(1 / 60, 96);
  const n2 = f.log.filter(e => e.op === 'draw').length;
  ok(S.post.graph.indexOf('bloom') < 0 && (n1 - n0) - (n2 - n1) === S.passes.bloom.targets, 'frame: bloom 0 skips the bloom passes', `${n1 - n0} draws with bloom, ${n2 - n1} without; ${S.passes.bloom.targets} bloom targets`);
  ok(S.passes.compU.uBloomK.value === 0, 'frame: bloom 0 sets the composite bloom term to 0');
  const pm = createScene({ canvas: fakeCanvas({ w: 320, h: 200 }).canvas, coarse: true, R: 30, maxParticles: 4096, profile: profileFor('phone-min') });
  ok(pm && pm.bloomStrength === 0, 'frame: phone-min starts with the bloom off');
}

// ── the far glow sprites (fauna/index.js): only where no mesh is drawn ─────
{
  const THREE = await import('../../../vendor/three@0.160.0/build/three.module.js');
  const { createFauna } = await import('../fauna/index.js');
  const { createWorld } = await import('../world/field.js');
  const { FAUNA_BUDGET } = await import('../fauna/budget.js');
  const W = createWorld({ seed: 7 });
  const root = new THREE.Group(), cam = new THREE.PerspectiveCamera(60, 1.5, 0.1, 400);
  const F = createFauna({ THREE, root, U: null, world: W, physics: null, profile: 'desktop', seed: 7, makeWorker: null });
  const e = [20000, W.ground(20000, 0) + 20, 0];
  cam.position.set(e[0], e[1], e[2]); cam.lookAt(e[0] + 1, e[1], e[2]); cam.updateMatrixWorld(true);
  // 40 Atolla jellies in a line ahead of the camera, 3 m to 120 m
  const sp = SPECIES_BY_ID.get('atolla-wyvillei');
  const members = Array.from({ length: 40 }, (_, k) => ({ x: e[0] + 3 + k * 3, y: e[1], z: e[2] + (k % 2 ? 0.5 : -0.5), yaw: 0, size: 0.14 }));
  F.sim.addGroup({ sp, feature: null, centre: [e[0] + 60, e[1], e[2]], members }, 'test', null);
  for (let k = 0; k < 4; k++) F.update(1 / 30, cam, e, [0, 0]);
  const st = F.stats(), B = FAUNA_BUDGET.desktop;
  let far = 0, near = 0, glowing = 0;
  for (let i = 0; i < F.sim.capacity; i++) {
    if (!F.sim.alive[i] || !glowParams(F.sim.species[F.sim.spec[i]])) continue;
    const d = Math.hypot(F.sim.px[i] - e[0], F.sim.py[i] - e[1], F.sim.pz[i] - e[2]);
    if (d > B.draw) continue;
    glowing++;
    if (d >= B.lod1 || d >= F.sim.size[i] * 260) far++; else near++;
  }
  ok(st.glowMesh > 0 && st.halos > 0 && st.halos <= far && st.glowMesh >= near - 2, 'halo: only the far glowing animals (lod 2) get a glow sprite; the near ones glow from their photophores', `${glowing} glowing in range: ${st.glowMesh} meshes, ${st.halos} sprites, ${far} far`);
  ok(st.halos < glowing, 'halo: the sprite count dropped (it was one per glowing animal in range)', `${st.halos} sprites for ${glowing} glowing animals`);
  ok(B.halos <= 200 && FAUNA_BUDGET['phone-min'].halos <= 30, 'halo: smaller sprite budgets', Object.values(FAUNA_BUDGET).map(b => b.halos).join(','));
  const G = await import('../fauna/glsl.js');
  ok(/exp\(-r2 \* 9\.0\)/.test(G.HALO_FS) && !/0\.25 \* exp/.test(G.HALO_FS), 'halo: the sprite is a tight core (no wide skirt; the bloom spreads it)');
  const r = checkPrograms([{ name: 'halo', vs: G.HALO_VS, fs: G.HALO_FS, instanced: true }]);
  ok(r[0].ok === true, 'glsl: naga reads the halo program', r[0].ok === null ? 'naga not found' : (r[0].log || '').slice(0, 400));
  F.dispose();
}

console.log(`\nbioglow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
