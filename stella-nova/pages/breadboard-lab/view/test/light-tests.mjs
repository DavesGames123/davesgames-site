// ============================================================================
//  BREADBOARD LAB  ·  view/test/light-tests.mjs — the light budget in node
// ----------------------------------------------------------------------------
//  Called by view/tests.mjs. No GPU: the checks compute the luminance of
//  the materials from the numbers that the page uses (core/light.js, the
//  presets of parts/materials.js and the real RoomEnvironment scene of
//  three r160).
//
//  THE ENVIRONMENT ESTIMATE. envMean(n) casts cosine-weighted rays from the
//  PMREM origin into the RoomEnvironment scene (scaled as the page scales
//  it). A light panel gives its colour; a wall or a box is a white Lambert
//  surface lit by the point light of the scene. The mean is what three
//  r160 reads for a diffuse surface: getIBLIrradiance / PI.
//
//  GREP MAP
//    loadRoom / envMean ..... the RoomEnvironment rays
//    litRadiance ............ one material, one normal: env + rig + sun spec
//    OLD .................... the settings before the visual pass (numbers
//                             for the commit bodies)
//    frameEstimate .......... a 160 x 100 ray-cast frame: lit base, emitters,
//                             halos, bloom (5 blurred mips), ACES, sRGB
//    run .................... the checks; runGlow: bloom, LEDs, halos
// ============================================================================
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SN = path.resolve(HERE, '../../../..');
const THREE_URL = pathToFileURL(path.join(SN, 'vendor/three@0.160.0/build/three.module.js')).href;
const ADDONS_URL = pathToFileURL(path.join(SN, 'vendor/three@0.160.0/examples/jsm/')).href;
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: new URL(spec.slice(13), ${JSON.stringify(ADDONS_URL)}).href, shortCircuit: true };
  return next(spec, ctx);
}`));
}

// The settings before the visual pass (view/scene.js and the part models
// at 61a43c98). led(b) and halo(b, asked) are the old emitter formulas.
export const OLD = {
  led: b => 2.2 * Math.max(0, Math.min(2, b)),
  halo: (b, asked) => ({ opacity: Math.min(1, Math.max(0, Math.min(2, b)) * 0.85), size: asked * (0.6 + 0.5 * Math.min(1.5, Math.max(0, Math.min(2, b)))) }),
  exposure: 1.0, envScale: 1.0,
  rig: { hemi: { sky: 0xdde6ff, ground: 0x1b2422, intensity: 0.55 }, sun: { color: 0xfff4e6, intensity: 2.1, position: [-160, 420, 260] }, fill: { color: 0xbfd4ff, intensity: 0.45, position: [260, 180, -220] } },
  bloom: { threshold: 0.92, strength: 0.55, radius: 0.35, selective: false },
};

export async function loadRoom(THREE, scale) {
  hook();
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const room = new RoomEnvironment({ _useLegacyLights: false });
  if (scale !== 1) room.traverse(o => {
    if (o.isLight) o.intensity *= scale;
    else if (o.isMesh && o.material && o.material.isMeshBasicMaterial) o.material.color.multiplyScalar(scale);
  });
  room.updateMatrixWorld(true);
  return room;
}

// mean radiance (r, g, b averaged to one luminance-free scalar per channel)
// of the environment over the cosine lobe round n
export function envMeanFn(THREE, room, N = 6000) {
  const meshes = [];
  let light = null;
  room.traverse(o => { if (o.isMesh) meshes.push(o); if (o.isPointLight) light = o; });
  const rc = new THREE.Raycaster();
  rc.near = 1e-4; rc.far = 1e3;
  const lp = light ? new THREE.Vector3().setFromMatrixPosition(light.matrixWorld) : null;
  const o = new THREE.Vector3(0, 0, 0), d = new THREE.Vector3(), nW = new THREE.Vector3(), lv = new THREE.Vector3();
  function radiance(dir) {
    rc.set(o, dir);
    const h = rc.intersectObjects(meshes, false)[0];
    if (!h) return 0;
    const m = h.object.material;
    if (m.isMeshBasicMaterial) return (m.color.r + m.color.g + m.color.b) / 3;
    if (!lp || !h.face) return 0;
    nW.copy(h.face.normal).transformDirection(h.object.matrixWorld);
    if (nW.dot(dir) > 0) nW.negate();
    lv.copy(lp).sub(h.point);
    const dist = lv.length();
    lv.divideScalar(dist);
    const cos = Math.max(0, nW.dot(lv));
    const cut = light.distance > 0 ? Math.pow(Math.min(1, Math.max(0, 1 - Math.pow(dist / light.distance, 4))), 2) : 1;
    const E = light.intensity * cos * cut / Math.max(Math.pow(dist, light.decay), 0.01);
    return (m.color.r + m.color.g + m.color.b) / 3 * E / Math.PI;
  }
  const cache = new Map();
  return function envMean(n) {
    const key = n.map(v => v.toFixed(3)).join(',');
    if (cache.has(key)) return cache.get(key);
    const nn = new THREE.Vector3(...n).normalize();
    const up = Math.abs(nn.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const t = new THREE.Vector3().crossVectors(up, nn).normalize(), b = new THREE.Vector3().crossVectors(nn, t);
    let seed = 12345, s = 0;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < N; i++) {
      const u = rnd(), v = rnd(), r = Math.sqrt(u), ph = 2 * Math.PI * v;
      d.copy(t).multiplyScalar(r * Math.cos(ph)).addScaledVector(b, r * Math.sin(ph)).addScaledVector(nn, Math.sqrt(1 - u)).normalize();
      s += radiance(d);
    }
    cache.set(key, s / N);
    return s / N;
  };
}

// A lat-long table of envMean (24 x 12 bins, nearest bin) for the frame
// estimate, which needs one value per pixel.
export function envTable(envMean) {
  const NA = 24, NE = 12, t = new Float32Array(NA * NE);
  const dir = (ia, ie) => { const el = -Math.PI / 2 + (ie + 0.5) / NE * Math.PI, az = (ia + 0.5) / NA * 2 * Math.PI; return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]; };
  for (let ie = 0; ie < NE; ie++) for (let ia = 0; ia < NA; ia++) t[ie * NA + ia] = envMean(dir(ia, ie));
  return n => {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const el = Math.asin(Math.max(-1, Math.min(1, n[1] / l))), az = (Math.atan2(n[2], n[0]) + 2 * Math.PI) % (2 * Math.PI);
    const ie = Math.min(NE - 1, Math.floor((el + Math.PI / 2) / Math.PI * NE)), ia = Math.min(NA - 1, Math.floor(az / (2 * Math.PI) * NA));
    return t[ie * NA + ia];
  };
}

const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// Linear radiance of a preset under a light rig, for a surface normal n
// seen from the direction v (unit, towards the eye). Diffuse: environment
// mean x albedo + the three lights. Specular: F0 x the environment mean
// round the mirror direction (the area average of a glossy reflection),
// and the sun peak of the GGX lobe for the roughness.
export function litRadiance(THREE, envMean, spec, rig, n, v, glint = true) {
  const col = spec.rgb ? null : new THREE.Color(spec.color);
  const a = spec.rgb ? spec.rgb : [col.r, col.g, col.b];
  const metal = spec.metalness || 0, rough = Math.max(0.045, spec.roughness ?? 0.5);
  const N = new THREE.Vector3(...n).normalize(), V = new THREE.Vector3(...v).normalize();
  const diffuse = a.map(x => x * (1 - metal));
  const f0 = a.map(x => 0.04 * (1 - metal) + x * metal);
  const dirL = (L) => { const p = new THREE.Vector3(...L.position).normalize(); const c = new THREE.Color(L.color); return { p, c, I: L.intensity }; };
  const sun = dirL(rig.sun), fill = dirL(rig.fill);
  const sky = new THREE.Color(rig.hemi.sky), gnd = new THREE.Color(rig.hemi.ground);
  const w = 0.5 * N.y + 0.5;
  const ch = ['r', 'g', 'b'];
  const hemiE = ch.map(c => (gnd[c] * (1 - w) + sky[c] * w) * rig.hemi.intensity);
  const envD = envMean([N.x, N.y, N.z]);
  const R = V.clone().negate().reflect(N).normalize();
  const envS = envMean([R.x, R.y, R.z]);
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let e = envD + hemiE[i] / Math.PI;
    for (const L of [sun, fill]) e += L.c[ch[i]] * L.I * Math.max(0, N.dot(L.p)) / Math.PI;
    out[i] = diffuse[i] * e + f0[i] * envS;
  }
  // the sun peak of a GGX lobe (D at the half vector, with G and F ~ 1)
  const H = sun.p.clone().add(V).normalize();
  const nh = Math.max(0, N.dot(H)), nl = Math.max(0, N.dot(sun.p)), nv = Math.max(1e-3, N.dot(V));
  const al = rough * rough, a2 = al * al;
  const D = a2 / (Math.PI * Math.pow(nh * nh * (a2 - 1) + 1, 2));
  const peak = D / (4 * nv * Math.max(nl, 1e-3)) * nl;
  if (glint) for (let i = 0; i < 3; i++) out[i] += f0[i] * sun.c[ch[i]] * sun.I * peak;
  return { rgb: out, luma: lum(out), envD, envS, sunPeak: f0[0] * sun.I * peak };
}

export async function run({ section, check }) {
  section('light budget');
  const THREE = await import(THREE_URL);
  const L = await import('../../core/light.js');
  const { MATERIAL_PRESETS } = await import('../../parts/materials.js');
  const preset = id => MATERIAL_PRESETS.find(p => p.id === id);
  const envNew = envMeanFn(THREE, await loadRoom(THREE, L.ENV.scale));
  const envOld = envMeanFn(THREE, await loadRoom(THREE, OLD.envScale));
  // the default camera: pitch 0.95 rad above the bench, looking at it
  const view = [0, Math.sin(0.95), Math.cos(0.95)];
  const UP = [0, 1, 0];
  const show = (rad, exposure) => L.srgb(lum(L.acesFilmic(rad, exposure)));

  const envUpNew = envNew(UP), envUpOld = envOld(UP);
  check('environment mean round +Y (diffuse light from the room)', envUpNew < envUpOld * 0.5, `before ${envUpOld.toFixed(3)} (scale ${OLD.envScale}), after ${envUpNew.toFixed(3)} (scale ${L.ENV.scale})`);

  const rows = [];
  for (const id of ['board-white', 'abs-white', 'silk-white', 'chrome', 'tin', 'gold-pin', 'abs-black', 'epoxy-black']) {
    const s = preset(id);
    const o = litRadiance(THREE, envOld, s, OLD.rig, UP, view), n = litRadiance(THREE, envNew, s, L.RIG, UP, view);
    rows.push({ id, o, n, so: show(o.rgb, OLD.exposure), sn: show(n.rgb, L.TONE.exposure) });
  }
  const R = id => rows.find(r => r.id === id);
  for (const id of ['board-white', 'abs-white']) {
    const r = R(id);
    check(`${id}: the lit top is not blown out (sRGB luminance after ACES < 0.9)`, r.sn < 0.9 && r.sn > 0.72, `before ${r.o.luma.toFixed(2)} linear -> ${r.so.toFixed(3)} shown; after ${r.n.luma.toFixed(2)} -> ${r.sn.toFixed(3)}`);
  }
  for (const id of ['abs-black', 'epoxy-black']) {
    const r = R(id);
    check(`${id}: dark parts still read (shown luminance > 0.06)`, r.sn > 0.06, `before ${r.so.toFixed(3)}, after ${r.sn.toFixed(3)}`);
  }
  {
    const r = R('chrome');
    check('chrome: the glossy reflection reads as a light metal (shown 0.35..0.9)', r.sn > 0.35 && r.sn < 0.9, `before ${r.so.toFixed(3)}, after ${r.sn.toFixed(3)} (sun glint peak ${r.n.sunPeak.toFixed(0)} not included)`);
  }
  // contrast between the board white and the black parts (a ratio of shown values)
  const cr = R('board-white').sn / Math.max(1e-3, R('abs-black').sn);
  check('board white against black ABS keeps a clear contrast (ratio > 5)', cr > 5, `ratio ${cr.toFixed(1)}`);

  // the scene builds its lights from core/light.js
  {
    const { createBus } = await import('../../core/bus.js');
    const { createStore } = await import('../../core/store.js');
    const { emptyDoc } = await import('../../core/doc.js');
    const { REGISTRY, stubRenderer } = await import('./stubs.mjs');
    const SC = await import('../scene.js');
    const bus = createBus();
    const store = createStore(emptyDoc(), bus, { registry: REGISTRY });
    const renderer = stubRenderer();
    const v = SC.createView({ canvas: null, store, registry: REGISTRY, bus, THREE, quality: 'high', renderer, parts: false, raf: null, now: () => 0 });
    const lights = [];
    v.scene.traverse(o => { if (o.isLight) lights.push(o); });
    const hemi = lights.find(l => l.isHemisphereLight), dirs = lights.filter(l => l.isDirectionalLight);
    const ok = hemi && hemi.intensity === L.RIG.hemi.intensity && dirs.length === 2 && dirs.some(d => d.intensity === L.RIG.sun.intensity) && dirs.some(d => d.intensity === L.RIG.fill.intensity)
      && renderer.toneMappingExposure === L.TONE.exposure && !lights.some(l => l.isPointLight);
    check('view/scene.js uses the rig and the exposure of core/light.js (and no point lights)', ok, `hemi ${hemi && hemi.intensity}, dir ${dirs.map(d => d.intensity).join(' ')}, exposure ${renderer.toneMappingExposure}`);
    const src = (await import('node:fs')).readFileSync(path.join(HERE, '../scene.js'), 'utf8');
    check('the PMREM room is scaled by ENV.scale before fromScene', /scaleEnvironment\(new RoomEnvironment\(renderer\), ENV\.scale\)/.test(src), '');
    v.dispose();
  }
  const ctx = { THREE, L, envNew, envOld, rows, preset, view, litRadiance, show, lum };
  await runGlow({ section, check }, ctx);
  return ctx;
}

// ---------------------------------------------------------------- frame estimate
const KERNELS = [3, 5, 7, 9, 11], FACTORS = [1.0, 0.8, 0.6, 0.4, 0.2];
function blur(src, W, H, sigma) {
  if (sigma < 0.3) return Float32Array.from(src);
  const r = Math.ceil(sigma * 3), k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const w = Math.exp(-i * i / (2 * sigma * sigma)); k.push(w); sum += w; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) { const xx = Math.min(W - 1, Math.max(0, x + i)); a += src[y * W + xx] * k[i + r]; }
    tmp[y * W + x] = a;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) { const yy = Math.min(H - 1, Math.max(0, y + i)); a += tmp[yy * W + x] * k[i + r]; }
    out[y * W + x] = a;
  }
  return out;
}
const haloTex = r => r >= 1 ? 0 : Math.pow(1 - r, 2.2) * (0.6 + 0.4 * Math.exp(-r * r * 30));

// cfg: { old: bool, env, rig, exposure, bloom: { threshold, strength, radius, selective } }
export function frameEstimate(THREE, view, cfg, L, W = 160, H = 100, canvasW = 1280) {
  const scene = view.scene, camera = view.camera;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const vis = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const meshes = [], halos = [];
  scene.traverse(o => {
    if (o.isSprite && o.userData.halo && vis(o)) halos.push(o);
    if (o.isMesh && !o.isSprite && vis(o) && o.material && !(Array.isArray(o.material) ? o.material[0] : o.material).transparent) meshes.push(o);
    else if (o.isMesh && !o.isSprite && vis(o) && o.material && o.userData.glow) meshes.push(o);
  });
  const rc = new THREE.Raycaster();
  const N = W * H;
  const img = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const emi = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const bg = scene.background ? [scene.background.r, scene.background.g, scene.background.b] : [0, 0, 0];
  const ndc = new THREE.Vector2(), nW = new THREE.Vector3();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    ndc.set((x + 0.5) / W * 2 - 1, -((y + 0.5) / H * 2 - 1));
    rc.setFromCamera(ndc, camera);
    const h = rc.intersectObjects(meshes, false)[0];
    if (!h) { for (let c = 0; c < 3; c++) img[c][i] = bg[c]; continue; }
    const o = h.object, m = Array.isArray(o.material) ? o.material[0] : o.material;
    let rgb = [m.color ? m.color.r : 0.5, m.color ? m.color.g : 0.5, m.color ? m.color.b : 0.5];
    const ca = o.geometry.attributes.color;
    if (m.vertexColors && ca && h.face) rgb = [rgb[0] * ca.getX(h.face.a), rgb[1] * ca.getY(h.face.a), rgb[2] * ca.getZ(h.face.a)];
    let out;
    if (m.isMeshBasicMaterial) out = rgb;
    else {
      nW.copy(h.face ? h.face.normal : new THREE.Vector3(0, 1, 0)).transformDirection(o.matrixWorld);
      if (nW.dot(rc.ray.direction) > 0) nW.negate();
      const vv = rc.ray.direction.clone().negate();
      out = litRadiance(THREE, cfg.env, { rgb, roughness: m.roughness ?? 0.5, metalness: m.metalness ?? 0 }, cfg.rig, [nW.x, nW.y, nW.z], [vv.x, vv.y, vv.z]).rgb;
    }
    let e = [0, 0, 0];
    if (m.emissive && (o.userData.glow || o.layers.test({ mask: 1 << L.LAYER.EMIT }))) {
      const k = cfg.old ? OLD.led(o.userData.b ?? 0) : m.emissiveIntensity;
      e = [m.emissive.r * k, m.emissive.g * k, m.emissive.b * k];
    }
    for (let c = 0; c < 3; c++) { img[c][i] = out[c] + e[c]; emi[c][i] = e[c]; }
  }
  // halos (additive, no occlusion: an upper bound)
  const fovY = camera.fov * Math.PI / 180, right = new THREE.Vector3();
  const halo = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  for (const sp of halos) {
    const b = sp.userData.b ?? 0;
    const { opacity, size } = cfg.old ? OLD.halo(b, sp.userData.asked || sp.scale.x) : { opacity: sp.material.opacity, size: sp.scale.x };
    if (opacity <= 0) continue;
    const wp = new THREE.Vector3().setFromMatrixPosition(sp.matrixWorld);
    const dist = wp.distanceTo(camera.position);
    const rPx = (size / 2) / (2 * dist * Math.tan(fovY / 2)) * H;
    const p = wp.clone().project(camera);
    const cx = (p.x + 1) / 2 * W, cy = (1 - p.y) / 2 * H;
    const col = sp.material.color;
    for (let y = Math.floor(cy - rPx - 1); y <= Math.ceil(cy + rPx + 1); y++) for (let x = Math.floor(cx - rPx - 1); x <= Math.ceil(cx + rPx + 1); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      // sub-pixel halos: integrate by the area ratio
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / Math.max(rPx, 0.5);
      const a = opacity * haloTex(r) * (rPx < 0.5 ? (rPx / 0.5) ** 2 : 1);
      halo[0][y * W + x] += col.r * a; halo[1][y * W + x] += col.g * a; halo[2][y * W + x] += col.b * a;
    }
  }
  // bloom source: the emitters (selective) or the whole frame with halos (old)
  const B = cfg.bloom, src = [0, 1, 2].map(c => new Float32Array(N));
  for (let i = 0; i < N; i++) {
    const s = B.selective ? [emi[0][i], emi[1][i], emi[2][i]] : [img[0][i] + halo[0][i], img[1][i] + halo[1][i], img[2][i] + halo[2][i]];
    const keep = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2] > B.threshold;
    for (let c = 0; c < 3; c++) src[c][i] = keep ? s[c] : 0;
  }
  const scale = W / canvasW;
  const bloomImg = [0, 1, 2].map(() => new Float32Array(N));
  let acc = 0;
  for (let m = 0; m < 5; m++) {
    const sg = KERNELS[m] * Math.pow(2, m + 1) * scale;
    acc += sg * sg;
    const f = FACTORS[m], lf = f * (1 - B.radius) + (1.2 - f) * B.radius;
    for (let c = 0; c < 3; c++) { const bl = blur(src[c], W, H, Math.sqrt(acc)); for (let i = 0; i < N; i++) bloomImg[c][i] += B.strength * lf * bl[i]; }
  }
  let mean = 0, clipped = 0, bloomMean = 0, haloMean = 0;
  for (let i = 0; i < N; i++) {
    const v = [img[0][i] + halo[0][i] + bloomImg[0][i], img[1][i] + halo[1][i] + bloomImg[1][i], img[2][i] + halo[2][i] + bloomImg[2][i]];
    const t = L.acesFilmic(v, cfg.exposure);
    const sh = 0.2126 * L.srgb(t[0]) + 0.7152 * L.srgb(t[1]) + 0.0722 * L.srgb(t[2]);
    mean += sh; if (sh > 0.97) clipped++;
    bloomMean += 0.2126 * bloomImg[0][i] + 0.7152 * bloomImg[1][i] + 0.0722 * bloomImg[2][i];
    haloMean += 0.2126 * halo[0][i] + 0.7152 * halo[1][i] + 0.0722 * halo[2][i];
  }
  return { mean: mean / N, clipped: clipped / N, bloomMean: bloomMean / N, haloMean: haloMean / N, halos: halos.length };
}

// ---------------------------------------------------------------- glow checks
export async function runGlow({ section, check }, ctx) {
  section('glow');
  const { THREE, L, envNew, envOld, preset, view } = ctx;
  const T = L.BLOOM.threshold;
  // 1. the brightest lit surface of the white and metal presets, over
  // normals and views (dielectrics with their sun glint)
  const dirs = [];
  for (let a = 0; a < 12; a++) for (const el of [1.4, 1.0, 0.6, 0.2, -0.1]) dirs.push([Math.cos(a * Math.PI / 6) * Math.cos(el), Math.sin(el), Math.sin(a * Math.PI / 6) * Math.cos(el)]);
  const sunDir = new THREE.Vector3(...L.RIG.sun.position).normalize();
  function worst(spec, env, rig, withGlint) {
    let best = 0, at = null;
    for (const n of [[0, 1, 0], ...dirs]) {
      const N = new THREE.Vector3(...n).normalize();
      const views = [view, [0, 1, 0], [0.6, 0.6, 0.5]];
      if (withGlint) { const m = sunDir.clone().reflect(N).negate(); if (m.dot(N) > 0.05) views.push([m.x, m.y, m.z]); }
      for (const v of views) {
        if (new THREE.Vector3(...v).dot(N) <= 0.05) continue;
        const r = litRadiance(THREE, env, spec, rig, n, v, withGlint);
        const l = L.bloomLuma(...r.rgb);
        if (l > best) { best = l; at = n; }
      }
    }
    return { best, at };
  }
  for (const id of ['abs-white', 'board-white', 'silk-white']) {
    const wN = worst(preset(id), envNew, L.RIG, true), wO = worst(preset(id), envOld, OLD.rig, true);
    check(`${id}: the brightest lit face (with the sun glint) is below the bloom threshold`, wN.best < T, `before ${wO.best.toFixed(2)} vs threshold ${OLD.bloom.threshold}; after ${wN.best.toFixed(2)} vs ${T}`);
  }
  {
    const spec = preset('chrome');
    // the glossy area mean (no glint): what most of a chrome part shows
    let best = 0;
    for (const n of [[0, 1, 0], ...dirs]) for (const v of [view, [0, 1, 0]]) {
      if (new THREE.Vector3(...n).dot(new THREE.Vector3(...v)) <= 0.05) continue;
      const r = litRadiance(THREE, envNew, spec, L.RIG, n, v, false);
      best = Math.max(best, L.bloomLuma(...r.rgb));
    }
    const g = litRadiance(THREE, envNew, spec, L.RIG, [0, 1, 0], [-sunDir.x, sunDir.y, -sunDir.z]);
    check('chrome: the glossy area mean is below the bloom threshold; its sun glint is not (so the bloom pass must not see it)', best < T && g.sunPeak > T, `area mean ≤ ${best.toFixed(2)}, glint ${g.sunPeak.toFixed(0)}, threshold ${T}`);
  }
  // 2. LEDs: real models at rated current bloom, a dim one does not
  const P = await import('../../parts/index.js');
  const reg = P.createRegistry();
  const mats = P.materialResolver(THREE);
  const rows = [];
  for (const color of ['red', 'orange', 'yellow', 'green', 'blue', 'white']) {
    const h = P.buildPart(THREE, reg.get('led'), { id: 'p1', def: 'led', place: { on: null, x: 0, z: 0, rot: 0 }, params: { color } }, { materials: mats });
    let lens = null;
    h.object.traverse(o => { if (o.userData.glow) lens = o; });
    const lumaAt = b => { h.setState({ vis: { b } }, 0); const m = lens.material; return L.bloomLuma(m.emissive.r * m.emissiveIntensity, m.emissive.g * m.emissiveIntensity, m.emissive.b * m.emissiveIntensity); };
    rows.push({ color, full: lumaAt(1), dim: lumaAt(0.05), over: lumaAt(2), old: L.bloomLuma(lens.material.emissive.r, lens.material.emissive.g, lens.material.emissive.b) * OLD.led(1) });
    h.dispose();
  }
  check('an LED die at rated current is above the threshold for every colour (x2)', rows.every(r => r.full > 2 * T), rows.map(r => `${r.color} ${r.old.toFixed(2)}->${r.full.toFixed(2)}`).join(', '));
  check('a dim LED (5 % of rated) is lit but does not bloom', rows.every(r => r.dim < T && r.dim > 0.2), rows.map(r => `${r.color} ${r.dim.toFixed(2)}`).join(', '));
  check('an LED at 2x rated is at most 1.2x as bright as at rated (no runaway)', rows.every(r => r.over <= r.full * 1.2), rows.map(r => (r.over / r.full).toFixed(2)).join(' '));

  // 3. layers in a real scene: only emitters on EMIT, no sprite on BASE
  const SC = await import('../scene.js');
  const { createBus } = await import('../../core/bus.js');
  const { createStore } = await import('../../core/store.js');
  const { stubRenderer } = await import('./stubs.mjs');
  const { colX, rowZ } = await import('../../core/space.js');
  const fs = await import('node:fs');
  const real = await SC.loadParts();
  async function makeView(doc) {
    const bus = createBus();
    const store = createStore(doc, bus, { registry: reg });
    const v = SC.createView({ canvas: null, store, registry: reg, bus, THREE, quality: 'high', renderer: stubRenderer(), parts: real, materials: real.materials, raf: null, now: () => 0 });
    await v.ready;
    return { v, store };
  }
  const ex = k => JSON.parse(fs.readFileSync(path.join(HERE, '../../examples', k + '.json'), 'utf8')).doc;
  let bad = [], emitN = 0, spriteBad = 0, sprites = 0;
  for (const k of ['first-led', 'uno-7seg', 'relay-lamp', 'blink-555', 'nano-joystick']) {
    const { v } = await makeView(ex(k));
    v.scene.traverse(o => {
      if (o.isSprite) { sprites++; if (o.layers.test({ mask: 1 << L.LAYER.BASE })) spriteBad++; return; }
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const onEmit = (o.layers.mask & (1 << L.LAYER.EMIT)) !== 0;
      if (onEmit) emitN++;
      const lit = m && m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0;
      if (onEmit && !(o.userData.glow || lit)) bad.push(`${k}:${o.name}`);
      if (onEmit && !o.userData.glow && m && /^(abs-white|board-white|chrome|tin|silk-white|gold-pin)$/.test(m.name || '')) bad.push(`${k}:${o.name}(${m.name})`);
    });
    v.dispose();
  }
  check('only glow meshes and lit emissive meshes are on the bloom layer (5 example benches)', bad.length === 0 && emitN > 0, bad.length ? bad.slice(0, 4).join(' ') : `${emitN} emitter meshes`);
  check('no sprite (halo, spark, smoke) is on the BASE layer of the black depth pass', spriteBad === 0 && sprites > 0, `${sprites} sprites, ${spriteBad} on BASE`);
  {
    const src = fs.readFileSync(path.join(HERE, '../scene.js'), 'utf8');
    check('high quality bloom is the emitter pass with BLOOM of core/light.js (no full-frame UnrealBloomPass)', /createEmitterBloom\(THREE, \{ Pass, UnrealBloomPass \}, scene, camera, BLOOM\)/.test(src) && !/new UnrealBloomPass\(/.test(src), '');
  }

  // 4. a bench with 30 lit LEDs: the halo gain and the frame estimate
  const ledDoc = (n, on) => {
    const doc = { format: 'breadboard-lab', version: 1, title: '', notes: '', boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }], parts: [], wires: [], probes: [], materials: [], customParts: [], programs: {}, sim: { speed: 1, pwm: 'auto' }, nextId: 1 };
    const cols = ['red', 'green', 'yellow', 'blue', 'white', 'orange'];
    for (let i = 0; i < n; i++) doc.parts.push({ id: 'p' + (i + 1), def: 'led', place: { on: 'b1', x: colX(63, 2 + (i % 15) * 4), z: rowZ(i < 15 ? 2 : 7), rot: 0 }, params: { color: cols[i % cols.length] } });
    doc.nextId = n + 1;
    return doc;
  };
  async function bench(n, b) {
    const { v, store } = await makeView(ledDoc(n));
    const parts = {};
    for (const p of store.doc.parts) parts[p.id] = { vis: { b }, i: 0.02 * b };
    v.setFrame({ t: 0, running: true, parts, wires: [], probes: {} });
    // the old formulas need the brightness on each glow mesh and halo
    v.scene.traverse(o => { if (o.userData.glow || o.userData.halo) o.userData.b = b; });
    const box = new THREE.Box3().setFromObject(v.scene.getObjectByName('boards'));
    v.rig.setAspect(1.6);
    v.rig.animateTo(v.rig.fitPose({ min: box.min.toArray(), max: box.max.toArray() }, { pitch: 0.95, yaw: 0, margin: 1.15 }), 0);
    v.rig.apply(v.camera);
    v.camera.updateMatrixWorld(true);
    const est = cfg => frameEstimate(THREE, v, cfg, L);
    const nw = est({ old: false, env: fastNew, rig: L.RIG, exposure: L.TONE.exposure, bloom: { ...L.BLOOM, selective: true } });
    const od = est({ old: true, env: fastOld, rig: OLD.rig, exposure: OLD.exposure, bloom: OLD.bloom });
    const gain = v.haloGain;
    v.dispose();
    return { nw, od, gain };
  }
  const fastNew = envTable(envMeanFn(THREE, await loadRoom(THREE, L.ENV.scale), 800));
  const fastOld = envTable(envMeanFn(THREE, await loadRoom(THREE, OLD.envScale), 800));
  const off = await bench(30, 0), on = await bench(30, 1.2), one = await bench(1, 1.2);
  const fmt = r => `mean ${r.mean.toFixed(3)}, clipped ${(r.clipped * 100).toFixed(1)} %`;
  check('30 lit LEDs share one halo gain (sqrt(full / n))', Math.abs(on.gain - Math.sqrt(L.HALO.full / 30)) < 1e-9 && one.gain === 1, `gain ${on.gain.toFixed(3)} at 30, ${one.gain} at 1`);
  check('30 LEDs on: the frame gets at most 0.03 brighter on average than with them off', on.nw.mean - off.nw.mean <= 0.03, `after: off ${fmt(off.nw)}; on ${fmt(on.nw)}; before: off ${fmt(off.od)}; on ${fmt(on.od)}`);
  check('30 LEDs on: under 1 % of the frame is clipped white', on.nw.clipped < 0.01, `after ${(on.nw.clipped * 100).toFixed(2)} %, before ${(on.od.clipped * 100).toFixed(2)} %`);
  check('30 LEDs on: bloom + halo light per pixel is a small part of the old one', on.nw.bloomMean + on.nw.haloMean < 0.25 * (on.od.bloomMean + on.od.haloMean), `bloom ${on.od.bloomMean.toFixed(4)} -> ${on.nw.bloomMean.toFixed(4)}, halo ${on.od.haloMean.toFixed(4)} -> ${on.nw.haloMean.toFixed(4)}`);
  check('one LED on still shows: bloom + halo light > 0', one.nw.bloomMean + one.nw.haloMean > 0, `bloom ${one.nw.bloomMean.toExponential(2)}, halo ${one.nw.haloMean.toExponential(2)}`);
  return { off, on, one };
}
