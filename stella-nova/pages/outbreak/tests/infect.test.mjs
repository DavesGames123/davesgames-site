// infect: the infection texture of the land (render/infect.js) through its
// JS mirror, and the front channel of the field (render/field.js). No GPU.
//   - healthy land gets no infection colour
//   - the colour is monotone in prevalence
//   - the front is a hard edge: its transition is a few px at every zoom
//   - the reds are in the specified hue and saturation range
//   - the front crawls outward at a bounded rate and never shrinks
import { PAL, RED_SPEC, INF, IGN, IGN_SLOTS, INFECT_GLSL, hueSat, toHex, heartbeat, beatShape, frontS, frontMask, shade,
  infP, fbm, cellular, smoothstep, infectUniforms, infectDefines } from '../render/infect.js';
import { buildWeights, fillField, reachTarget, reachStep, frontByte, REACH_SEED, REACH_MAX, REACH_RATE, FRONT_SPAN,
  FIELD_W, FIELD_H, sigmaKm, EARTH_KM } from '../render/field.js';
import { makeRng } from '../rng.js';

const GROUND = [0.04, 0.05, 0.068];
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };

export default function (ok) {
  // ── palette ──
  const inHue = (h, [a, b]) => h >= a && h <= b;
  const bl = hueSat(PAL.blood), ar = hueSat(PAL.arterial), co = hueSat(PAL.core), sc = hueSat(PAL.scar);
  ok('infect: blood and arterial red are saturated reds', inHue(bl.hue, RED_SPEC.hue) && inHue(ar.hue, RED_SPEC.hue) && bl.sat >= RED_SPEC.sat && ar.sat >= RED_SPEC.sat,
    `blood ${bl.hue.toFixed(1)} deg s ${bl.sat.toFixed(2)}, arterial ${ar.hue.toFixed(1)} deg s ${ar.sat.toFixed(2)}`);
  ok('infect: arterial red is at full value (intense, not dull)', ar.val === 1 && PAL.arterial[1] < 0.05 && PAL.arterial[2] < 0.1, toHex(PAL.arterial));
  ok('infect: the hot core is a bright orange-red', inHue(co.hue, RED_SPEC.coreHue) && co.sat >= RED_SPEC.coreSat && co.val === 1, `${co.hue.toFixed(1)} deg s ${co.sat.toFixed(2)}`);
  ok('infect: the scar is crimson-black', sc.val <= 0.15 && inHue(sc.hue, RED_SPEC.hue) && sc.sat >= 0.9, toHex(PAL.scar));

  // ── healthy land ──
  const rng = makeRng(0x1fec7);
  const pts = [];
  for (let i = 0; i < 240; i++) pts.push(infP(rng.next(), 0.2 + 0.6 * rng.next()));
  let healthy = true, sMax = -Infinity;
  for (const p of pts) {
    for (const fr of [0, 0.05, INF.frMin]) {
      const { s, c } = frontS(p, fr);
      if (fr === INF.frMin) sMax = Math.max(sMax, s);
      for (const g of [0, 1]) {
        const r = shade({ base: GROUND, g, d: 0, fr, s, c, fw: INF.fwMax, pw: 1e-3 });
        if (r.m !== 0 || r.rgb.some((x, k) => x !== GROUND[k])) healthy = false;
      }
    }
  }
  ok('infect: healthy land (no front) gets zero infection colour', healthy);
  ok('infect: at the skip threshold the front and its line are out of reach', sMax < -(INF.edgePx + 1) * INF.fwMax,
    `max s ${sMax.toFixed(3)} < ${(-(INF.edgePx + 1) * INF.fwMax).toFixed(3)}`);
  const u0 = infectUniforms(null, null);
  ok('infect: the shared uniforms start with no ignition and no infection', u0.uAny.value === 0 && u0.uBeat.value === 0 && u0.uIgn.value.length === IGN_SLOTS && u0.uIgn.value.every(v => v.w < 0));

  // ── monotone in prevalence ──
  let mono = true, monoInf = true, worst = '';
  for (const p of pts.slice(0, 120)) {
    const { s, c } = frontS(p, 0.9);
    for (const d of [0, 0.4]) for (const beat of [0, 1]) {
      let last = -1, lastI = -1;
      for (let k = 0; k <= 20; k++) {
        const g = k / 20, r = shade({ base: GROUND, g, d, fr: 0.9, s, c, fw: 0.002, pw: 2e-4, beat });
        if (r.rgb[0] < last - 1e-12) { mono = false; worst = `g ${g} red ${r.rgb[0].toFixed(4)} < ${last.toFixed(4)}`; }
        if (r.inf[0] < lastI - 1e-12) monoInf = false;
        last = r.rgb[0]; lastI = r.inf[0];
      }
    }
  }
  ok('infect: the red of the shaded land never falls as prevalence rises', mono, worst);
  ok('infect: the infection colour itself is monotone in prevalence', monoInf);
  {
    const p = pts[3], { s, c } = frontS(p, 0.95);
    const lo = shade({ base: GROUND, g: 0.05, fr: 0.95, s: Math.max(s, 0.2), c, fw: 0.002, pw: 2e-4 });
    const hi = shade({ base: GROUND, g: 1, fr: 0.95, s: Math.max(s, 0.2), c, fw: 0.002, pw: 2e-4 });
    const h = hueSat(hi.rgb);
    ok('infect: a full outbreak is far brighter red than a new one', hi.rgb[0] > lo.rgb[0] + 0.3 && hi.rgb[0] > 0.6, `${lo.rgb[0].toFixed(2)} -> ${hi.rgb[0].toFixed(2)}`);
    ok('infect: active infected land reads red (hue in the red band)', h.hue > -15 && h.hue < 25 && h.sat > 0.5, `${h.hue.toFixed(1)} deg s ${h.sat.toFixed(2)}`);
    const dead = shade({ base: GROUND, g: 0, d: 1, fr: 0.95, s: Math.max(s, 0.2), c, fw: 0.002, pw: 2e-4 });
    ok('infect: dead, burned-out land is dark crimson-black', dead.rgb[0] < 0.2 && dead.rgb[0] > dead.rgb[1] && dead.rgb[0] > dead.rgb[2], dead.rgb.map(x => x.toFixed(3)).join());
  }

  // ── a hard front at every zoom ──
  // A walk in screen px across the front. The front value falls off
  // across the field at the slope of a node's front (1 / (2 FRONT_SPAN
  // sigma) per unit of arc). fwidth = |ds/dx| + |ds/dy| by finite
  // differences, as the GPU takes it over a 2 x 2 quad.
  const sig = sigmaKm(5e6) / EARTH_KM, slope = 1 / (2 * FRONT_SPAN * sig);
  let worstPx = 0, crossings = 0;
  const zooms = [3e-5, 1e-4, 4e-4, 1.5e-3, 6e-3];
  for (const pw of zooms) {
    for (let line = 0; line < 4; line++) {
      const p0 = infP(0.3 + 0.1 * line, 0.62), t = norm([-p0[2], 0, p0[0]]), b = norm([p0[1] * t[2] - p0[2] * t[1], p0[2] * t[0] - p0[0] * t[2], p0[0] * t[1] - p0[1] * t[0]]);
      const at = (k, j) => { const q = norm(p0.map((x, i) => x + (k * t[i] + j * b[i]) * pw)); return q; };
      const span = Math.ceil(0.25 / slope / pw);             // px from the centre to fr = 0.25 / 0.75
      const n = Math.min(2 * span, 1600), k0 = -Math.floor(n / 2);
      const frAt = k => 0.5 - slope * k * pw;
      let prevS = null, run = 0, trans = 0;
      for (let k = k0; k < k0 + n; k++) {
        const s0 = frontS(at(k, 0), frAt(k)).s, sx = frontS(at(k + 1, 0), frAt(k + 1)).s, sy = frontS(at(k, 1), frAt(k)).s;
        const fw = Math.abs(sx - s0) + Math.abs(sy - s0), m = frontMask(s0, fw);
        if (m > 0.02 && m < 0.98) { run++; trans++; } else { if (run > worstPx) worstPx = run; run = 0; }
        if (prevS !== null && (prevS < 0) !== (s0 < 0)) crossings++;
        prevS = s0;
      }
      if (run > worstPx) worstPx = run;
    }
  }
  ok('infect: the front transition is at most 3 px wide at every zoom (30 um to 6 mrad per px)', worstPx <= 3 && crossings >= zooms.length * 4,
    `widest run ${worstPx} px over ${crossings} crossings`);
  // the front line and band: the line is a fixed px width, so it never smears
  {
    const w = INF.fwMax, line = s => 1 - smoothstep(INF.edgePx * w - w, INF.edgePx * w + w, Math.abs(s));
    ok('infect: the front line has a fixed px width (edgePx + 1 px of fade)', line(0) === 1 && line((INF.edgePx + 1) * w) === 0 && INF.edgePx <= 2);
  }

  // ── noise sanity ──
  let nlo = 1, nhi = 0, f1max = 0;
  for (const p of pts) { const v = fbm(p.map(x => x * INF.frontScale)); nlo = Math.min(nlo, v); nhi = Math.max(nhi, v); f1max = Math.max(f1max, cellular(p.map(x => x * INF.cellScale))[0]); }
  ok('infect: fbm stays in 0..1 and varies', nlo >= 0 && nhi <= 1 && nhi - nlo > 0.3, `${nlo.toFixed(2)}..${nhi.toFixed(2)}`);
  ok('infect: Voronoi F1 is under one cell', f1max > 0 && f1max < 1.2, f1max.toFixed(3));

  // ── heartbeat ──
  const hb0 = heartbeat(0), hb1 = heartbeat(1e-6), hb2 = heartbeat(1e-3);
  ok('infect: no new cases, no heartbeat', hb0.amp === 0 && hb0.bpm === 0);
  ok('infect: the heartbeat quickens with new cases, under 100 bpm', hb1.bpm > 0 && hb2.bpm > hb1.bpm && hb2.bpm <= 100 && hb2.amp <= 1, `${hb1.bpm.toFixed(0)} -> ${hb2.bpm.toFixed(0)} bpm`);
  let bmin = 1, bmax = 0;
  for (let i = 0; i < 200; i++) { const v = beatShape(i / 200); bmin = Math.min(bmin, v); bmax = Math.max(bmax, v); }
  ok('infect: the beat shape is a short lub-dub in 0..1', bmin >= 0 && bmin < 0.01 && bmax > 0.9 && bmax <= 1);

  // ── the GLSL chunk ──
  const bal = (INFECT_GLSL.match(/{/g) || []).length === (INFECT_GLSL.match(/}/g) || []).length && (INFECT_GLSL.match(/\(/g) || []).length === (INFECT_GLSL.match(/\)/g) || []).length;
  ok('infect: the chunk balances its braces and parentheses', bal);
  ok('infect: the chunk uses screen derivatives for a crisp front and coast', /fwidth\(s\)/.test(INFECT_GLSL) && /fwidth\(landRaw\)/.test(INFECT_GLSL) && /fwidth\(p\)/.test(INFECT_GLSL));
  ok('infect: no time pulse in the chunk (only the heartbeat uniform)', !/uTime/.test(INFECT_GLSL));
  ok('infect: the phone path has fewer octaves and no fine veins', /#ifdef INF_PHONE\n#define INF_OCT 2/.test(INFECT_GLSL) && /#ifndef INF_PHONE\n\s+vec3 c2 = icell/.test(INFECT_GLSL)
    && infectDefines(true).INF_PHONE === 1 && !('INF_PHONE' in infectDefines(false)));
  ok('infect: ignitions are short and small', IGN.dur <= 3 && IGN.r1 < 0.1 && IGN.flash < 0.5);

  // ── the field front ──
  const nodes = [{ lat: 10, lon: 10, pop: 5e6 }, { lat: 10, lon: 22, pop: 5e6 }];
  const W = buildWeights(nodes, new Uint8Array(FIELD_W * FIELD_H).fill(1));
  const data = new Uint8Array(FIELD_W * FIELD_H * 4);
  const tx = (lat, lon) => (Math.floor((lat + 90) / 180 * FIELD_H) * FIELD_W + Math.floor((lon + 180) / 360 * FIELD_W)) * 4;
  const g = Float32Array.of(0.5, 0), d = new Float32Array(2), reach = new Float32Array(2);
  fillField(data, FIELD_W, g, d, W, reach);
  ok('field front: before any reach, no texel is inside a front', data[tx(10, 10) + 2] === 0 && data[tx(10, 22) + 2] === 0);
  const count = () => { let n = 0; for (let t = 0; t < W.T; t++) if (data[W.texel[t] * 4 + 2] >= 128) n++; return n; };
  const areas = [];
  let monoReach = true, rate = 0;
  for (let step = 0; step < 20; step++) {
    const goal = reachTarget(g[0], true), r0 = reach[0];
    reach[0] = reachStep(reach[0], goal, 0.25);
    if (reach[0] < r0) monoReach = false;
    rate = Math.max(rate, (reach[0] - r0) / 0.25);
    fillField(data, FIELD_W, g, d, W, reach);
    areas.push(count());
  }
  ok('field front: the reach crawls at most REACH_RATE sigma per second and never shrinks', monoReach && rate <= REACH_RATE * (1 + 1e-5) && reach[0] <= REACH_MAX, `${rate.toFixed(3)} sigma/s`);
  ok('field front: the infected area grows outward from the city', areas[0] > 0 && areas[areas.length - 1] > areas[0] * 3, `${areas[0]} -> ${areas[areas.length - 1]} texels`);
  ok('field front: the healthy city stays outside every front', data[tx(10, 22) + 2] < 128, `${data[tx(10, 22) + 2]}`);
  ok('field front: the texel at the infected city is deep inside', data[tx(10, 10) + 2] > 200);
  ok('field front: A keeps the front of the update before', data[tx(10, 10) + 3] > 0 && data[tx(10, 10) + 3] <= data[tx(10, 10) + 2]);
  ok('field front: the target grows with prevalence and is 0 before infection', reachTarget(0.9, false) === 0 && reachTarget(0, true) === REACH_SEED && reachTarget(1, true) === REACH_MAX && reachTarget(0.4, true) > REACH_SEED);
  ok('field front: frontByte puts the front at 128', frontByte(0) === 128 && frontByte(-10) === 0 && frontByte(10) === 255);
}
