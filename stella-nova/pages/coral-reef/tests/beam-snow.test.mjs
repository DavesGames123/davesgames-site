// ============================================================================
//  CORAL REEF  ·  tests/beam-snow.test.mjs  ·  the snow in the lamp cones (node)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "there's not nearly enough marine snow in
//  the volume lights, it isn't rendering at all swirling and showing the
//  volume of the water". beam-snow.js: the count per profile, the spawn in
//  the cone, lit in the cone and dim out of it (ratio), the swirl has no
//  divergence and the flakes advect, the world lock, the draw in the frame
//  on the fake WebGL2 (tests/fake-gl.mjs), naga (glsl-check.mjs), and the
//  old snow draw range of main.js (it drew half quads or nothing).
// ============================================================================
import fs from 'node:fs';
import { installThree, installDom, fakeCanvas } from './fake-gl.mjs';
installThree(); installDom();
const THREE = await import('three');
const BS = await import('../beam-snow.js');
const { PROFILES, profileFor } = await import('../budget.js');
const { createScene } = await import('../scene.js');
const { checkPrograms } = await import('../glsl-check.mjs');

let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }
const f3 = v => (+v).toFixed(3);
let a = 12345;
const R = () => { a = (Math.imul(a, 1103515245) + 12345) >>> 0; return a / 4294967296; };

// ── counts per profile ────────────────────────────────────────────────────
{
  const ids = ['desktop', 'laptop-low', 'phone', 'phone-min'], n = ids.map(id => PROFILES[id].beamSnow * 4);
  console.log('beam snow (4 lamps): ' + ids.map((id, i) => `${id} ${n[i]}`).join(', '));
  ok(n[0] >= 8000 && n.every((v, i) => !i || v < n[i - 1]) && n[3] >= 1000, 'count: several thousand in-beam flakes on desktop, fewer on each smaller profile', n.join(' > '));
  ok(ids.every(id => PROFILES[id].beamSnow === BS.BEAM_SNOW[id].perLamp), 'count: budget.js beamSnow is beam-snow.js BEAM_SNOW perLamp');
}

// ── one lamp, pointing forward and a little down ──────────────────────────
const D = (() => { const v = [0.3, -0.35, 0.89], l = Math.hypot(...v); return v.map(x => x / l); })();
const lamp = { P: [10, -20, 5], D, cosOuter: Math.cos(0.44), cosInner: Math.cos(0.44 * 0.45), V: [0, 0, 0], W: [0, 0, 0], rad: 100, range: 42 };
const flow = { cur: [0.02, 0, 0.01], sink: BS.BS_SINK, eddyO: [1.5, 0, 4.2] };
const eye = [lamp.P[0] - D[0] * 4, lamp.P[1] + 1.5, lamp.P[2] - D[2] * 4];
const seeds = Array.from({ length: 600 }, () => [R(), R(), R(), R()]);

// spawn: the flakes start in the cone and in the first len m
{
  let out = 0, far = 0;
  for (const s of seeds) {
    const t = (Math.floor(R() * 50) - s[3]) * BS.BS_LIFE + 1e-4;     // age ~ 0
    const F = BS.bsFlakeJS(s, t, lamp, flow, 12);
    const d = F.P0.map((v, k) => v - lamp.P[k]), L = Math.hypot(...d), c = (d[0] * D[0] + d[1] * D[1] + d[2] * D[2]) / L;
    if (c < Math.cos(0.44 * 1.12)) out++;
    if (L > 12 * 1.15) far++;
  }
  ok(out === 0 && far === 0, 'spawn: every new flake is in the lamp cone and in the first 12 m of the beam', `${out} out of the cone, ${far} too far`);
}

// light: a flake in the cone is lit, a flake out of the cones is dim
{
  let inL = 0, outL = 0;
  for (const s of seeds) {
    const t = 7.3 + s[3] * 3;
    const p = BS.bsFlakeJS(s, t, lamp, flow, 12).p;
    inL += BS.bsLightJS(p, eye, lamp, 0.07, 0.002);
    // the same distance from the lamp, 2.2 x the cone angle off the axis
    const d = p.map((v, k) => v - lamp.P[k]), L = Math.hypot(...d);
    const side = (() => { const c = [D[1] * 0 - D[2] * 1, D[2] * 0 - D[0] * 0, D[0] * 1 - D[1] * 0], l = Math.hypot(...c); return c.map(x => x / l); })();
    const ang = 0.44 * 2.2, q = [0, 1, 2].map(k => lamp.P[k] + (D[k] * Math.cos(ang) + side[k] * Math.sin(ang)) * L);
    outL += BS.bsLightJS(q, eye, lamp, 0.07, 0.002);
  }
  ok(inL / Math.max(outL, 1e-12) > 20, 'light: flakes in the cone are lit, flakes out of the cone are dim (beam light, phase, falloff)', `in / out ${(inL / Math.max(outL, 1e-12)).toFixed(1)}`);
  // the falloff: a near flake is brighter than a far one on the axis
  const ax = s => BS.bsLightJS(lamp.P.map((v, k) => v + D[k] * s), eye, lamp, 0.07, 0);
  ok(ax(2) > ax(6) && ax(6) > ax(11), 'light: the light falls off along the beam', `${f3(ax(2))} > ${f3(ax(6))} > ${f3(ax(11))}`);
}

// swirl: the velocity field has no divergence; the flakes advect
{
  const o = { ...flow, c: [10, -20, 5], w: 1.5 };
  let maxDiv = 0, maxGrad = 0;
  const e = 1e-4;
  for (let i = 0; i < 300; i++) {
    const p = [10 + (R() - 0.5) * 8, -20 + (R() - 0.5) * 8, 5 + (R() - 0.5) * 8], t = R() * 100;
    let div = 0;
    for (let k = 0; k < 3; k++) {
      const pp = p.slice(), pm = p.slice(); pp[k] += e; pm[k] -= e;
      const g = (BS.bsVelJS(pp, t, o)[k] - BS.bsVelJS(pm, t, o)[k]) / (2 * e);
      div += g; maxGrad = Math.max(maxGrad, Math.abs(g));
    }
    maxDiv = Math.max(maxDiv, Math.abs(div));
  }
  ok(maxDiv < 1e-5 * Math.max(1, maxGrad * 100) && maxGrad > 0.01, 'swirl: the velocity field is divergence-free (curl of ABC flow times the wash)', `max |div| ${maxDiv.toExponential(1)} 1/s, max |dv/dx| ${f3(maxGrad)} 1/s`);
  // the shader RK2 path against a fine Euler path from the spawn
  let err = 0, moved = 0;
  for (const s of seeds.slice(0, 120)) {
    const t = 13.1 + s[3];
    const F = BS.bsFlakeJS(s, t, lamp, flow, 12);
    const p = F.P0.slice(), c0 = lamp.P.map((v, k) => v - D[k] * 0.6), n = 200;
    for (let j = 0; j < n; j++) { const tt = t - F.tau + F.tau * j / n, v = BS.bsVelJS(p, tt, { ...flow, c: c0, w: 0 }); for (let k = 0; k < 3; k++) p[k] += v[k] * F.tau / n; }
    err = Math.max(err, Math.hypot(...p.map((v, k) => v - F.p[k])));
    moved += Math.hypot(...[0, 1, 2].map(k => F.p[k] - F.P0[k] - (flow.cur[k] - (k === 1 ? flow.sink : 0)) * F.tau)) / 120;
  }
  ok(err < 0.03, 'swirl: the flakes advect through the field (RK2 against a fine path)', `largest gap ${f3(err)} m`);
  ok(moved > 0.05, 'swirl: the swirl moves the flakes (beyond the current and the sink)', `mean swirl move ${f3(moved)} m in a life`);
}

// world lock: the ROV moves at 0.8 m/s, a flake does not move with it
{
  const V = [0.8 * D[0], 0, 0.8 * D[2]];
  let worst = 0;
  for (const s of seeds.slice(0, 200)) {
    const t0 = 20 + s[3] * 0.5, dt = 0.1;
    const L0 = { ...lamp, V }, L1 = { ...lamp, V, P: lamp.P.map((v, k) => v + V[k] * dt) };
    const A = BS.bsFlakeJS(s, t0, L0, flow, 12), B = BS.bsFlakeJS(s, t0 + dt, L1, flow, 12);
    if (Math.floor(t0 / BS.BS_LIFE + s[3]) !== Math.floor((t0 + dt) / BS.BS_LIFE + s[3])) continue;
    worst = Math.max(worst, Math.hypot(...A.p.map((v, k) => B.p[k] - v)));
  }
  ok(worst < 0.8 * 0.1 * 0.5, 'world lock: a flake moves with the water, not with the moving lamp', `largest move in 0.1 s ${f3(worst)} m (lamp 0.080 m)`);
}

// ── the draw on the fake WebGL2 ───────────────────────────────────────────
{
  const f = fakeCanvas({ w: 800, h: 600 });
  const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 4096, profile: profileFor('desktop') });
  S.resize();
  const mk = (veh, x) => { const L = new THREE.SpotLight(0xffffff, 420, 42, 0.44, 0.55, 2); L.position.set(x, 4, 0); L.target.position.set(x, 0, 5); L.userData.vehicle = veh; S.scene.add(L, L.target); return L; };
  S.setLights([mk(1, 0), mk(2, 3)], 2);
  const per = S.beamSnow.perLamp;
  let names = [];
  S.scene.traverse(o => { if (o.isMesh) names.push(o.name); });
  ok(names.includes('beam-snow') && S.beamSnow.mesh.parent === S.scene, 'draw: the beam snow mesh is in the scene graph');
  for (let i = 0; i < 4; i++) S.render(1 / 60, i * 16);
  const log = f.log, lastC = log.map(e => e.op === 'clear' && e.fb === 0).lastIndexOf(true);
  const fr = log.slice(log.map((e, i) => e.op === 'draw' && e.fb === 0 && i < lastC).lastIndexOf(true) + 1);
  const bi = fr.findIndex(e => e.op === 'draw' && e.inst === per * 2 && e.n === 6);
  const comp = fr.map(e => e.op === 'draw' && e.fb === 0 && e.n === 3).lastIndexOf(true);
  const sceneFb = bi >= 0 ? fr[bi].fb : -1;
  const firstSceneDraw = fr.findIndex(e => e.op === 'draw' && e.fb === sceneFb);
  ok(bi >= 0 && sceneFb !== 0 && comp > bi && firstSceneDraw <= bi, 'draw: the beam snow draws 2 lamps x perLamp quads into the HDR scene target, before the composite tone map', `instances ${bi >= 0 ? fr[bi].inst : 'none'}, fb ${sceneFb}, at ${bi}, composite at ${comp}`);
  ok(S.post && S.post.on && !!S.passes, 'draw: the post chain is on (the snow goes through the composite)');
  const m = S.beamSnow.material;
  ok(m.blending === THREE.AdditiveBlending && m.depthTest && !m.depthWrite && !S.beamSnow.mesh.frustumCulled && m.uniforms.uMsFrag.value.z === 0, 'draw: additive, depth test against the scene, no depth write, not frustum culled, no second tone map');
  const at = m.uniforms.uMsAtlas;
  ok(at === S.marineSnow.uniforms.uMsAtlas && at.value === S.marineSnow.texture && S.marineSnow.atlas.size >= 256 && /texture\(uMsAtlas/.test(m.fragmentShader) && /vMsCell = vec4\(vec2\(mod\(cell/.test(m.vertexShader), 'matter: the beam snow samples the aggregate atlas of lib/marine-snow.js (porous flocs, fibres, strings, pellets)', `atlas ${S.marineSnow.atlas.size} px`);
  ok(!/uFow|fowSeen|underwater\(/.test(BS.BEAM_SNOW_VS.split('void main')[1]), 'draw: the fog-of-war fade does not touch the beam snow');
  S.opts.snow = false; const n0 = f.log.length; S.render(1 / 60, 80);
  ok(!f.log.slice(n0).some(e => e.inst === per * 2), 'draw: the Marine snow toggle hides the beam snow');
  S.opts.snow = true; S.setLights([], 0); const n1 = f.log.length; S.render(1 / 60, 96);
  ok(!f.log.slice(n1).some(e => e.op === 'draw' && e.n === 6 && e.inst > 0 && e.inst % per === 0 && e.inst >= per), 'draw: no lamps, no beam snow draw');
}

// ── particulate matter: the size tail and the aggregate atlas ─────────────
{
  const per = BS.BEAM_SNOW.desktop.perLamp, inst = BS.bsInstances(per, 4, 7), n = inst.n, d = [], ty = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) { const v = BS.bsSizeJS(inst.rand[i * 4 + 2]); d.push(v); ty[BS.bsTypeJS(v, inst.rand[i * 4])]++; }
  const fr = (lo, hi) => d.filter(v => v >= lo && v < hi).length / n;
  const sub = fr(0, 0.001), mid = fr(0.001, 0.005), big = fr(0.005, 1), cm = d.filter(v => v >= 0.01).length;
  console.log(`sizes (${n} desktop flakes): sub-mm ${(sub * 100).toFixed(1)} %, 1-5 mm ${(mid * 100).toFixed(1)} %, > 5 mm ${(big * 100).toFixed(2)} %, >= 1 cm ${cm}, max ${(Math.max(...d) * 1000).toFixed(1)} mm; types mote ${ty[0]} floc ${ty[1]} string ${ty[2]} pellet ${ty[3]}`);
  ok(sub > 0.8 && mid > 0.04 && mid < 0.2 && big > 0.001 && big < 0.02 && cm >= 3 && Math.max(...d) <= BS.BS_DMAX + 1e-9, 'matter: many sub-mm specks, fewer 1-5 mm flocs, a rare cm tail (power law to 30 mm)');
  ok(ty.every(v => v > 0) && ty[0] > ty[1] && ty[1] > ty[2], 'matter: silt specks, flocs, pellets and strings, the large sizes as flocs and strings');
  // on screen (about 1160 px a metre at 1 m): near aggregates show their shape, far ones are dust
  const px = (dm, z) => dm * BS.BS_SIZE * 1160 / z;
  ok(px(0.01, 1) > 15 && px(0.003, 6) < 2 && px(0.0005, 10) < 0.2, 'matter: a near cm aggregate is large on screen, mid flocs are sparkles, far silt is dust', `${px(0.01, 1).toFixed(1)} px, ${px(0.003, 6).toFixed(2)} px, ${px(0.0005, 10).toFixed(3)} px`);
}

// ── naga ──────────────────────────────────────────────────────────────────
{
  const r = checkPrograms([{ name: 'beam-snow', vs: BS.BEAM_SNOW_VS, fs: BS.BEAM_SNOW_FS }]);
  if (r[0].ok === null) ok(false, 'glsl: naga not found, the check did not run');
  else ok(r[0].ok, 'glsl: the beam snow program passes naga (glsl-check.mjs)', (r[0].log || '').slice(0, 800));
}

// ── the old snow draw range (main.js depthLook) ───────────────────────────
{
  const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  ok(!/snow[^\n]*setDrawRange/.test(src), 'governor: main.js no longer cuts the snow quad with a draw range (it drew half quads, or none above ~50 m)');
}
console.log(`beam snow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
