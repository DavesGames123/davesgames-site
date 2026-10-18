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
//    run .................... the checks
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

// The settings before the visual pass (view/scene.js at 61a43c98).
export const OLD = {
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

const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// Linear radiance of a preset under a light rig, for a surface normal n
// seen from the direction v (unit, towards the eye). Diffuse: environment
// mean x albedo + the three lights. Specular: F0 x the environment mean
// round the mirror direction (the area average of a glossy reflection),
// and the sun peak of the GGX lobe for the roughness.
export function litRadiance(THREE, envMean, spec, rig, n, v) {
  const col = new THREE.Color(spec.color);
  const a = [col.r, col.g, col.b];
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
  for (let i = 0; i < 3; i++) out[i] += f0[i] * sun.c[ch[i]] * sun.I * peak;
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
  return { THREE, L, envNew, envOld, rows, preset, view, litRadiance, show, lum };
}
