// ============================================================================
//  CORAL REEF  ·  volume pass tests (node, no browser):  node tests/volume.test.mjs
// ----------------------------------------------------------------------------
//  The user (2026-10-18): "their volumentrics are also rendered in a way
//  that's really not too clean" and "there's a depth of fie;d/volumnetric
//  light effect that makes everything rendered very low resoltion".
//  volume.js and shaders.js VOL_FS / VOL_TAA_FS / COMP_FS:
//    blue noise .. a permutation (each rank 16 times in 64 x 64), little
//                  low-frequency power (white noise has much more)
//    history ..... a static point reprojects to the same pixel (same
//                  camera), to its old pixel (moved camera), and through
//                  a floating-origin step; the clip keeps the history in
//                  the neighbourhood box; a bad history gives the new value
//    upsample .... a depth edge gives about 0 weight across it; a flat
//                  depth gives the bilinear weights
//    shaders ..... blue noise, no 3 x 3 tent, the bilateral taps
//    passes ...... on the fake WebGL2: the history targets swap, the
//                  composite reads the history, volume off reads a clear
//                  target, a volume scale change resets the history
//    cost ........ the taps per frame per profile at 2000 x 1260 dpr 2,
//                  before and after (budget.js profiles)
// ============================================================================
import { installThree, installDom, fakeCanvas } from './fake-gl.mjs';
installThree(); installDom();
const THREE = await import('three');
const V = await import('../volume.js');
const SH = await import('../shaders.js');
const B = await import('../budget.js');
const { createScene } = await import('../scene.js');

let pass = 0, fail = 0;
function ok(cond, name, info = '') { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } }

// ── blue noise ─────────────────────────────────────────────────────────────
{
  const t0 = performance.now();
  const b = V.blueNoise(64);
  const ms = performance.now() - t0;
  const h = new Array(256).fill(0); for (const x of b) h[x]++;
  ok(b.length === 4096 && h.every(c => c === 16), 'blue noise: 64 x 64, each of the 256 levels 16 times (a permutation of the ranks)');
  const low = (a) => {
    const n = 64; let P = 0;
    for (let ky = 0; ky <= 3; ky++) for (let kx = 0; kx <= 3; kx++) {
      if (!kx && !ky) continue;
      let re = 0, im = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = a[y * n + x] / 255 - 0.5, ph = 2 * Math.PI * (kx * x + ky * y) / n; re += v * Math.cos(ph); im += v * Math.sin(ph); }
      P += re * re + im * im;
    }
    return P / 15;
  };
  let s = 9; const wn = new Uint8Array(4096).map(() => { s = (s * 1103515245 + 12345) >>> 0; return s >>> 24; });
  const pb = low(b), pw = low(wn);
  ok(pb < pw * 0.02, 'blue noise: the low-frequency power is under 2 % of white noise', `${pb.toFixed(3)} vs ${pw.toFixed(1)}`);
  ok(ms < 400, 'blue noise: made in under 400 ms', ms.toFixed(0));
  console.log(`blue noise: ${ms.toFixed(0)} ms, low-frequency power ${pb.toFixed(3)} (white ${pw.toFixed(1)})`);
}

// ── reprojection ───────────────────────────────────────────────────────────
// the VOL_TAA_FS steps in JS: the world point of a pixel from its view depth
const cam = new THREE.PerspectiveCamera(50, 16 / 10, 0.08, 400);
function place(c, p, look) { c.position.set(...p); c.lookAt(...look); c.updateMatrixWorld(true); c.updateProjectionMatrix(); }
function vpOf(c) { return new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse); }
function worldOf(c, uv, zView) {
  const vr = new THREE.Vector4(uv[0] * 2 - 1, uv[1] * 2 - 1, 1, 1).applyMatrix4(c.projectionMatrixInverse);
  const v = new THREE.Vector3(vr.x / vr.w, vr.y / vr.w, vr.z / vr.w);
  v.multiplyScalar(zView / -v.z);
  return v.applyMatrix4(c.matrixWorld).toArray();
}
{
  place(cam, [3, 2, 8], [0, 0, 0]);
  const P = [0.4, -0.3, 1.2];
  const vp = vpOf(cam);
  const [u, v, w] = V.reproject(P, vp.elements);
  const back = worldOf(cam, [u, v], w);
  const [u2, v2] = V.reproject(back, vp.elements);
  const W = 1290, H = 813;
  ok(Math.abs(u2 - u) * W < 1e-3 && Math.abs(v2 - v) * H < 1e-3, 'history: a static point reprojects to the same pixel with the same camera', `${((u2 - u) * W).toExponential(1)} px`);
  ok(Math.abs(w - new THREE.Vector3(...P).applyMatrix4(cam.matrixWorldInverse).z * -1) < 1e-6, 'history: clip w is the view depth (the history a channel)');
  // move the camera: the point goes to its pixel of the last frame
  const prev = vp.clone();
  place(cam, [3.3, 2.1, 7.6], [0.1, 0, 0]);
  const now = V.reproject(P, vpOf(cam).elements);
  const wp = worldOf(cam, [now[0], now[1]], now[2]);
  const r = V.reproject(wp, prev.elements);
  ok(Math.abs(r[0] - u) * W < 1e-3 && Math.abs(r[1] - v) * H < 1e-3, 'history: after a camera move a static point reprojects to its pixel of the last frame', `${((r[0] - u) * W).toExponential(1)} px`);
  // a floating origin step: render = world - origin. scene.js multiplies the
  // last view-projection by the translation (o1 - o0).
  const o0 = [0, 0], o1 = [64, -32];
  place(cam, [3, 2, 8], [0, 0, 0]);
  const vp0 = vpOf(cam);                                  // the last frame, render space of o0
  const Pw = [P[0] + o0[0], P[1], P[2] + o0[1]];          // the world point
  const before = V.reproject([Pw[0] - o0[0], Pw[1], Pw[2] - o0[1]], vp0.elements);
  const r1 = [Pw[0] - o1[0], Pw[1], Pw[2] - o1[1]];       // the same point in the new render space
  const shifted = vp0.clone().multiply(new THREE.Matrix4().makeTranslation(o1[0] - o0[0], 0, o1[1] - o0[1]));
  const after = V.reproject(r1, shifted.elements);
  ok(Math.abs(after[0] - before[0]) < 1e-6 && Math.abs(after[1] - before[1]) < 1e-6, 'history: the origin step keeps the reprojection (prevVP x T(o1 - o0))');
  console.log(`history: reprojection error same camera ${((u2 - u) * W).toExponential(1)} px, moved camera ${((r[0] - u) * W).toExponential(1)} px`);
}
// the clip
{
  const nb = [];
  for (let i = 0; i < 9; i++) nb.push([0.2 + 0.01 * (i % 3), 0.3 + 0.01 * Math.floor(i / 3), 0.1]);
  const ghost = [2, -1, 0.1];
  const c = V.historyClip(ghost, nb);
  const mn = [0, 1, 2].map(k => Math.min(...nb.map(s => s[k]))), mx = [0, 1, 2].map(k => Math.max(...nb.map(s => s[k])));
  ok(c.every((x, k) => x >= mn[k] - 1e-9 && x <= mx[k] + 1e-9), 'history clip: the clipped history is inside the min and max of the 3 x 3 neighbourhood', c.map(x => x.toFixed(3)).join());
  const inside = [0.205, 0.305, 0.1];
  ok(V.historyClip(inside, nb).every((x, k) => Math.abs(x - inside[k]) < 1e-9), 'history clip: a history inside the box does not change');
  const cur = [0.21, 0.31, 0.1, 5];
  const keep = V.taaBlend(cur, inside, nb, true);
  ok(keep.every((x, k) => Math.abs(x - (inside[k] + (cur[k] - inside[k]) * V.VOL_K.blend)) < 1e-9), 'history: blend 1 / 10 of the new frame');
  ok(V.taaBlend(cur, ghost, nb, false).every((x, k) => x === cur[k]), 'history: a rejected history (off screen, depth) gives the new value');
  // a converging static pixel: the history goes to the mean of the jitter
  let h = [0, 0, 0]; let s = 3;
  for (let f = 0; f < 200; f++) { s = (s * 16807) % 2147483647; const x = 0.3 + 0.1 * (s / 2147483647 - 0.5); h = V.taaBlend([x, x, x], h, nb.map(n => [x - 0.05, x - 0.05, x - 0.05]).concat([[x + 0.05, x + 0.05, x + 0.05]]), f > 0); }
  ok(Math.abs(h[0] - 0.3) < 0.02, 'history: a static pixel goes to the mean of its noisy samples', h[0].toFixed(4));
}

// ── bilateral upsample ─────────────────────────────────────────────────────
{
  // an ROV edge at 4 m in front of rock at 9 m: the full pixel is on the ROV
  const r = V.bilateral([0.5, 0.5], 4.0, [4.0, 9.0, 4.02, 9.0]);
  ok(r.w[1] < 1e-3 && r.w[3] < 1e-3, 'bilateral: a texel across a depth edge (4 m vs 9 m) has about 0 weight', r.w.map(x => x.toExponential(1)).join());
  ok(Math.abs(r.w[0] + r.w[2] - 1) < 1e-3, 'bilateral: the weight goes to the texels on the same surface');
  const r2 = V.bilateral([0.5, 0.5], 9.0, [4.0, 9.0, 4.02, 9.05]);
  ok(r2.w[0] < 1e-3 && r2.w[2] < 1e-3, 'bilateral: the rock pixel next to the ROV gets no ROV texel (no halo)', r2.w.map(x => x.toExponential(1)).join());
  const flat = V.bilateral([0.25, 0.75], 6, [6, 6, 6, 6]);
  const bw = [0.75 * 0.25, 0.25 * 0.25, 0.75 * 0.75, 0.25 * 0.75];
  ok(flat.w.every((x, i) => Math.abs(x - bw[i]) < 1e-9), 'bilateral: one depth gives the bilinear weights');
  const none = V.bilateral([0.5, 0.5], 2.0, [9, 9.1, 8.9, 9.2]);
  ok(none.nearest === 2 && none.w[2] === 1, 'bilateral: no texel agrees: the texel of the nearest depth', JSON.stringify(none));
  ok(Math.abs(V.linZ(0, 0.08, 400) - 0.08) < 1e-9 && Math.abs(V.linZ(1, 0.08, 400) - 400) < 1e-6, 'linZ: the depth buffer 0 and 1 give near and far');
  console.log(`bilateral: ROV edge weights ${r.w.map(x => x.toFixed(4)).join(' ')}; rock edge ${r2.w.map(x => x.toFixed(4)).join(' ')}`);
}

// ── shaders ────────────────────────────────────────────────────────────────
{
  ok(/texelFetch\(uBlue/.test(SH.VOL_FS) && !/float ign\(/.test(SH.VOL_FS), 'VOL_FS: blue-noise jitter (uBlue), not the per-pixel IGN hash');
  ok(/0\.61803399 \* uFrame/.test(SH.VOL_FS), 'VOL_FS: the jitter moves by the golden ratio each frame');
  ok(/R \*= shadowTap\(i, pj\);/.test(SH.VOL_FS), 'VOL_FS: the per-ROV shadows stay in the cones (one jittered tap per mapped lamp)');
  ok(/oCol = vec4\(acc \* uScatter, -vp\.z\);/.test(SH.VOL_FS), 'VOL_FS: a = the linear view depth');
  ok(/uPrevVP/.test(SH.VOL_TAA_FS) && /clamp\(hb, lo, hi\)/.test(SH.VOL_TAA_FS) && /uReject/.test(SH.VOL_TAA_FS), 'VOL_TAA_FS: reprojection, neighbourhood clip and depth rejection');
  ok(!/\(2\.0 - abs\(float\(i\)\)\)/.test(SH.COMP_FS) && /texelFetch\(uVol/.test(SH.COMP_FS) && /linZ\(texture\(uDepth/.test(SH.COMP_FS), 'COMP_FS: no 3 x 3 tent; a joint bilateral upsample with the full-res depth');
  ok(/\/ 255\.0/.test(SH.COMP_FS), 'COMP_FS: a dither of 1 / 255 before the 8-bit output');
  ok(V.VOL_K.scatter < 1, 'the in-scatter level is under the old 1 (the lamp glow drove the exposure)');
}

// ── the passes on the fake WebGL2 ──────────────────────────────────────────
{
  const f = fakeCanvas({ w: 800, h: 500 });
  const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 4096, profile: B.profileFor('desktop') });
  S.resize();
  const P = S.passes;
  ok(P && P.rtHist && P.rtHist.length === 2 && P.taaScene, 'passes: two history targets and the history pass');
  S.render(1 / 60, 0);
  const r0 = P.hist.read, t0 = P.compU.uVol.value;
  S.render(1 / 60, 16);
  ok(P.hist.read !== r0 && P.compU.uVol.value !== t0 && P.rtHist.some(t => t.texture === P.compU.uVol.value), 'passes: the history targets swap each frame and the composite reads the new history');
  ok(P.taaU.uReset.value === 0 && P.hist.valid, 'passes: the second frame keeps the history');
  ok(P.taaU.uHist.value !== P.compU.uVol.value, 'passes: the history pass does not read the target it writes');
  ok(P.rtHist[0].width === P.rtVol.width && P.rtVol.width === Math.round(S.renderer.getDrawingBufferSize(new THREE.Vector2()).x * P.scale), 'passes: the history has the size of the volume target', `${P.rtHist[0].width} ${P.rtVol.width}`);
  ok(P.compU.uDepth.value === P.volU.uDepth.value && P.compU.uNearFar.value.y === S.camera.far, 'passes: the composite has the full-res depth and the near and far');
  S.setLoads({ volScale: 0.3 });
  ok(!P.hist.valid, 'passes: a volume scale change resets the history');
  S.opts.volume = false; S.render(1 / 60, 32);
  ok(P.compU.uVol.value === P.rtVol.texture && !P.hist.valid, 'passes: volume off: the composite reads the clear volume target');
  console.log(`passes: vol ${P.rtVol.width}x${P.rtVol.height}, history ${P.rtHist[0].width}x${P.rtHist[0].height}, blend ${P.taaU.uBlend.value}`);
}

// ── cost per profile (2000 x 1260 CSS, dpr 2) ───────────────────────────────
{
  // the profiles before 2026-10-18 (vol scale, maxPx): the cost of the old path
  const OLD = { desktop: { maxPx: 4.2e6, vol: { scale: 0.5, steps: 30 } }, 'laptop-low': { maxPx: 2.4e6, vol: { scale: 0.4, steps: 20 } }, phone: { maxPx: 1.3e6, vol: { scale: 0.35, steps: 14 } }, 'phone-min': { maxPx: 0.8e6, vol: { scale: 0.3, steps: 10 } } };
  for (const id of B.PROFILE_ORDER) {
    const p = B.PROFILES[id], o = Object.assign({}, p, OLD[id]);
    const spots = id.startsWith('phone') ? 2 : 4;
    const prB = B.pixelRatioFor(o, 2, 2000, 1260), prA = B.pixelRatioFor(p, 2, 2000, 1260);
    const b = V.volCost(o, Math.round(2000 * prB), Math.round(1260 * prB), { before: o.vol, spots }).before;
    const a = V.volCost(p, Math.round(2000 * prA), Math.round(1260 * prA), { spots }).after;
    ok(a.taps <= b.taps * 1.1, `cost ${id}: the volume taps per frame stay within 10 % of before`, `${(a.taps / 1e6).toFixed(1)} M vs ${(b.taps / 1e6).toFixed(1)} M`);
    ok(a.spotEvals <= b.spotEvals * 1.05, `cost ${id}: the spot evaluations of the march stay within 5 %`, `${(a.spotEvals / 1e6).toFixed(1)} vs ${(b.spotEvals / 1e6).toFixed(1)} M`);
    console.log(`cost ${id}: frame ${Math.round(2000 * prB)}x${Math.round(1260 * prB)} -> ${Math.round(2000 * prA)}x${Math.round(1260 * prA)}; vol ${b.vw}x${b.vh} -> ${a.vw}x${a.vh}, ${a.steps} steps; taps ${(b.taps / 1e6).toFixed(1)} M -> ${(a.taps / 1e6).toFixed(1)} M (march ${(b.march / 1e6).toFixed(1)} -> ${(a.march / 1e6).toFixed(1)}, history ${(a.hist / 1e6).toFixed(1)}, composite ${(b.comp / 1e6).toFixed(1)} -> ${(a.comp / 1e6).toFixed(1)}); spot evals ${(b.spotEvals / 1e6).toFixed(1)} -> ${(a.spotEvals / 1e6).toFixed(1)} M`);
  }
}

console.log(`volume: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
