// originals.mjs - the site original presets, and the generator that writes gen/originals.json.
//
// Part of the Mandelbulber port (GPL-3.0, see ../COPYING). These scenes are made for this site.
// Each one shows a formula that has no upstream example and no collection scene.
//
// A preset is { id, title, look, slots, main?, fractal?, view }:
//   look    one of LOOKS: background, main light, material palette, AO and fog
//   slots   [[formula file stem, iterations], ...]; two or more slots turn on the hybrid mode
//   main    main params that replace the look values
//   view    camera, target and camera_top. The values come from the Frame action of the page
//           (probe rays fit the surface), then a dolly by hand, then a headless render check.
// The output keeps only params that gen/params.json knows; an unknown name stops the build.
//
// Usage:  node tools/originals.mjs [outDir]       (outDir defaults to gen/)
//
// grep: LOOKS ORIGINALS buildOriginals rgb

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { specFor } from './fract-core.mjs';

const rgb = (h) => ({ r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 });
const bg = (a, b, c) => ({ background_color_1: rgb(a), background_color_2: rgb(b), background_color_3: rgb(c) });
const BASE = {
  ambient_occlusion_enabled: true, ambient_occlusion_mode: 0, ambient_occlusion: 1.2,
  background_3_colors_enable: true, light1_is_defined: true, light1_enabled: true,
  light1_soft_shadow_cone: 0.06, mat1_is_defined: true, mat1_metallic: false,
  mat1_specular: 1, mat1_specular_width: 0.5, mat1_coloring_speed: 1, glow_intensity: 0.1,
};

export const LOOKS = {
  copper: { ...BASE, ...bg('2a1a12', '6b4a33', '0d0806'), light1_rotation: { x: -40, y: 40, z: 0 }, light1_intensity: 1.4, light1_color: rgb('ffe2c0'),
    mat1_surface_color_gradient: '0 3b1a0c 1800 9a4a1f 3600 e08a3c 5200 f6d39a 6800 b8642a 8400 5a2a12', mat1_specular: 2, mat1_specular_width: 0.3, mat1_metallic: true },
  ice: { ...BASE, ...bg('9fb8d0', 'e8f0f8', '6c87a3'), light1_rotation: { x: -60, y: 50, z: 0 }, light1_color: rgb('f4f8ff'),
    mat1_surface_color_gradient: '0 a9c8de 2000 5d8fb8 4000 2b5a86 6000 89b7d6 8000 1d3f66', light1_intensity: 1.0, basic_fog_enabled: true, basic_fog_color: rgb('dce8f3') },
  jade: { ...BASE, ...bg('0b2524', '2f5f58', '041210'), light1_rotation: { x: -35, y: 45, z: 0 }, light1_intensity: 1.3, light1_color: rgb('fff4dc'),
    mat1_surface_color_gradient: '0 0e3b33 1700 1f7a62 3400 7cc6a2 5000 e7d38a 6600 b38a3a 8300 2b5f4d' },
  ember: { ...BASE, ...bg('000000', '1a0704', '000000'), light1_rotation: { x: -30, y: 30, z: 0 }, light1_intensity: 1.2, light1_color: rgb('ffd8b0'),
    mat1_surface_color_gradient: '0 1a0300 1500 6b0d02 3000 d83a0a 4500 ffa424 6000 ffe9a8 7600 b81e06 9000 3a0600', glow_intensity: 0.8,
    glow_color_1: rgb('ff5a10'), glow_color_2: rgb('ffcf70') },
  porcelain: { ...BASE, ...bg('6f6a63', 'b9b2a6', '3a3632'), light1_rotation: { x: -50, y: 50, z: 0 }, light1_intensity: 0.95, light1_color: rgb('fff6e8'),
    mat1_surface_color_gradient: '0 c9c0ae 2500 9d8f78 4500 5f7d99 6000 d8cfbd 8000 8a7a62', ambient_occlusion: 1.5, mat1_coloring_speed: 0.6 },
  violet: { ...BASE, ...bg('140a2a', '3d2466', '05020d'), light1_rotation: { x: -45, y: 35, z: 0 }, light1_intensity: 1.4, light1_color: rgb('ffe9ff'),
    mat1_surface_color_gradient: '0 2a0f5c 1600 6b2fb3 3200 d14fa8 4800 ffb3c9 6400 4fc3e8 8000 1d4f9e', glow_intensity: 0.4, glow_color_1: rgb('8a5cff'), glow_color_2: rgb('ffb3ff') },
  sand: { ...BASE, ...bg('4d86c6', 'cfe3f2', 'c9a879'), light1_rotation: { x: -60, y: 40, z: 0 }, light1_intensity: 1.5, light1_color: rgb('fff1d6'),
    mat1_surface_color_gradient: '0 c8a36b 2000 e8cfa0 4000 a5703d 6000 f2e2c0 8000 7a4f28', basic_fog_enabled: true, basic_fog_color: rgb('cfe3f2') },
  gold: { ...BASE, ...bg('0a0c12', '2a3040', '000000'), light1_rotation: { x: -40, y: 45, z: 0 }, light1_intensity: 1.5, light1_color: rgb('fff0d0'),
    mat1_surface_color_gradient: '0 4a3208 2000 b8860b 4000 ffd76a 5500 fff4c8 7000 9c6b12 8800 3d2a06', mat1_metallic: true, mat1_specular: 3, mat1_specular_width: 0.25 },
};

export const ORIGINALS = [
  { id: 'kosalos', title: 'Kosalos Bloom', look: 'copper', slots: [['mandelbulb_kosalos_v2', 1]],
    view: { camera: {x: 1.08986, y: -2.192711, z: 0.870337}, target: {x: -0.004424, y: -0.004143, z: -0.005091}, camera_top: {x: -0.150649, y: 0.301297, z: 0.941554} } },
  { id: 'lambda', title: 'Lambda Reef', look: 'jade', slots: [['mandelbulb_lambda', 1]],
    view: { camera: {x: 1.194709, y: -1.855305, z: 1.219678}, target: {x: -0.027012, y: -0.022724, z: -0.002043}, camera_top: {x: -0.238686, y: 0.423475, z: 0.873898} } },
  { id: 'multi2', title: 'Gilded Multibulb', look: 'gold', slots: [['mandelbulb_multi2', 1]],
    view: { camera: {x: -1.064732, y: -2.15408, z: 0.541039}, target: {x: 0.010909, y: -0.002797, z: 0.003218}, camera_top: {x: -0.109618, y: 0.292314, z: 0.950019} } },
  { id: 'hobold8', title: 'Riemann Brass Orb', look: 'gold', slots: [['riemann_sphere_hobold_pow8', 1]],
    view: { camera: {x: 1.237357, y: -2.565343, z: 0.761033}, target: {x: -0.050473, y: 0.010318, z: -0.011665}, camera_top: {x: -0.1159, y: 0.2318, z: 0.965834} } },
  { id: 'hoboldmulti', title: 'Riemann Nebula', look: 'violet', slots: [['riemann_sphere_hobold_multi', 1]],
    view: { camera: {x: 2.510608, y: -1.279369, z: 0.757777}, target: {x: -0.055555, y: 0.003712, z: -0.012072}, camera_top: {x: -0.151672, y: 0.267572, z: 0.951526} } },
  { id: 'msltoe', title: 'Riemann Ember Crown', look: 'ember', slots: [['riemann_sphere_msltoe_m3d', 1]],
    view: { camera: {x: 1.141353, y: -2.366045, z: 0.909912}, target: {x: -0.019903, y: -0.043532, z: -0.251344}, camera_top: {x: -0.182574, y: 0.365148, z: 0.912871} } },
  { id: 'power1234', title: 'Driftwood Bulb', look: 'sand', slots: [['mandelbulb_power1234', 1]],
    view: { camera: {x: 0.939578, y: -2.892871, z: 0.887741}, target: {x: -0.548625, y: 0.083534, z: -0.005181}, camera_top: {x: -0.1159, y: 0.2318, z: 0.965834} } },
  { id: 'mandelcup', title: 'Jade Chalice', look: 'jade', slots: [['mandelcup', 1]],
    view: { camera: {x: 1.412921, y: -3.489519, z: 1.168086}, target: {x: -0.366203, y: 0.068729, z: 0.456436}, camera_top: {x: -0.07875, y: 0.1575, z: 0.984374} } },
  { id: 'mandelbar', title: 'Mandelbar Flame', look: 'ember', slots: [['mandelbar', 1]],
    view: { camera: {x: 1.368287, y: -3.335535, z: 1.4858}, target: {x: -0.276701, y: -0.045559, z: 0.005311}, camera_top: {x: -0.166982, y: 0.333964, z: 0.927677} } },
  { id: 'boxbulbmenger', title: 'Bulb Menger Spires', look: 'copper', slots: [['box_fold_bulb_menger', 1]],
    view: { camera: {x: 5.940671, y: -12.222408, z: 6.829751}, target: {x: -0.559749, y: 0.778431, z: -0.970753}, camera_top: {x: -0.211472, y: 0.422944, z: 0.881134} } },
  { id: 'quadrat', title: 'Quadrat Lagoon', look: 'jade', slots: [['mandelbulb_quadrat', 1]],
    view: { camera: {x: -2.05829, y: -3.101408, z: 1.099983}, target: {x: -0.48323, y: 0.048713, z: -0.002559}, camera_top: {x: -0.075983, y: 0.363028, z: 0.928675} } },
  { id: 'cubic4d', title: 'Cubic Quaternion Spindle', look: 'copper', slots: [['quaternion_cubic4d', 1]],
    view: { camera: {x: 0.548484, y: -2.385264, z: 0.595695}, target: {x: -0.652279, y: 0.016263, z: -0.004687}, camera_top: {x: -0.09759, y: 0.19518, z: 0.9759} } },
  { id: 'hypercomplex', title: 'Hypercomplex Bloom', look: 'violet', slots: [['hypercomplex_v2', 1]],
    view: { camera: {x: 0.492816, y: -2.254518, z: 0.759014}, target: {x: -0.6571, y: 0.045313, z: -0.045927}, camera_top: {x: -0.133606, y: 0.267213, z: 0.954331} } },
  { id: 'aexion', title: 'Aexion Shards', look: 'violet', slots: [['aexion4d_v2', 1]],
    view: { camera: {x: 1.862347, y: -3.629374, z: 1.485816}, target: {x: 0.040918, y: 0.013485, z: 0.028673}, camera_top: {x: -0.150649, y: 0.301297, z: 0.941554} } },
  { id: 'tetra4d', title: 'Tetra Box 4D', look: 'gold', slots: [['abox_tetra4d', 1]],
    view: { camera: {x: 7.994332, y: -10.571287, z: 4.267001}, target: {x: -0.221925, y: 0.109847, z: 0.158872}, camera_top: {x: -0.134303, y: 0.264042, z: 0.955115} } },
  { id: 'menger4d', title: 'Menger 4D Furnace', look: 'ember', slots: [['menger4d_mod2', 1]],
    view: { camera: {x: 0.918788, y: -1.470149, z: 0.826835}, target: {x: -0.000992, y: 0.001499, z: -0.000967}, camera_top: {x: -0.204839, y: 0.379484, z: 0.902238} } },
  { id: 'aboxmod12', title: 'Rust Box', look: 'copper', slots: [['abox_mod12', 1]],
    view: { camera: {x: 13.107329, y: -13.110271, z: 7.860229}, target: {x: -0.024347, y: 0.021405, z: -0.018776}, camera_top: {x: -0.210634, y: 0.339416, z: 0.91675} } },
  { id: 'aboxmod2', title: 'Verdigris Box', look: 'jade', slots: [['abox_mod2', 1]],
    view: { camera: {x: 11.58646, y: -13.904399, z: 9.265475}, target: {x: -0.022079, y: 0.025848, z: -0.021357}, camera_top: {x: -0.239976, y: 0.392074, z: 0.888082} } },
  { id: 'aboxsmooth', title: 'Ember Smooth Box', look: 'ember', slots: [['abox_smooth', 1]],
    view: { camera: {x: 11.684561, y: -11.684337, z: 11.68194}, target: {x: -0.015649, y: 0.015873, z: -0.01827}, camera_top: {x: -0.338643, y: 0.4741, z: 0.812743} } },
  { id: 'mboxfast', title: 'Violet Mandelbox', look: 'violet', slots: [['mandelbox_fast', 1]],
    view: { camera: {x: 12.763453, y: -12.766433, z: 8.929711}, target: {x: -0.023642, y: 0.020662, z: -0.021255}, camera_top: {x: -0.247375, y: 0.377326, z: 0.89243} } },
  { id: 'boxquat', title: 'Box Fold Quaternion', look: 'gold', slots: [['box_fold_quat', 1]],
    view: { camera: {x: 4.357726, y: -10.684282, z: 2.760981}, target: {x: -1.042233, y: 0.115637, z: 0.061002}, camera_top: {x: -0.09759, y: 0.19518, z: 0.9759} } },
  { id: 'menger3', title: 'Menger M3D Lantern', look: 'ember', slots: [['menger3_m3d', 1]],
    view: { camera: {x: 2.028201, y: -2.637519, z: 1.825092}, target: {x: -0.002178, y: 0.001973, z: -0.002248}, camera_top: {x: -0.248594, y: 0.41476, z: 0.875314} } },
  { id: 'chebyshev', title: 'Chebyshev Sponge', look: 'gold', slots: [['menger_chebyshev', 1]],
    view: { camera: {x: 1.827448, y: -2.924201, z: 1.642825}, target: {x: -0.0028, y: 0.004196, z: -0.004398}, camera_top: {x: -0.204839, y: 0.379484, z: 0.902238} } },
  { id: 'prism', title: 'Menger Prism Tower', look: 'ice', slots: [['menger_prism_shape', 1]],
    view: { camera: {x: 1.750946, y: -3.074839, z: 1.155919}, target: {x: -0.177253, y: 0.01028, z: -0.001}, camera_top: {x: -0.13758, y: 0.271247, z: 0.952626} } },
  { id: 'mengerv2', title: 'Menger Relic', look: 'copper', slots: [['menger_v2', 1]],
    view: { camera: {x: 1.939222, y: -2.716116, z: 1.938332}, target: {x: -0.00383, y: 0.004157, z: -0.004721}, camera_top: {x: -0.254446, y: 0.43515, z: 0.863656} } },
  { id: 'modsponge', title: 'Modulus Sponge Cloud', look: 'jade', slots: [['modulus_menger_sponge', 1]],
    view: { camera: {x: 1.586713, y: -2.219754, z: 1.268147}, target: {x: -0.001598, y: 0.003882, z: -0.002503}, camera_top: {x: -0.208157, y: 0.368941, z: 0.905844} } },
  { id: 'sierpv2', title: 'Sierpinski Dune', look: 'sand', slots: [['sierpinski3d_v2', 1]],
    view: { camera: {x: 1.048455, y: -2.477091, z: 0.416506}, target: {x: -0.058535, y: -0.26311, z: -0.247688}, camera_top: {x: -0.1159, y: 0.2318, z: 0.965834} } },
  { id: 'kochv2', title: 'Koch Pyramid', look: 'violet', slots: [['koch_v2', 1]],
    view: { camera: {x: 1.120205, y: -2.238532, z: 1.808031}, target: {x: -0.002963, y: 0.007802, z: 0.46023}, camera_top: {x: -0.211472, y: 0.422944, z: 0.881134} } },
  { id: 'kochv3', title: 'Koch Ridge', look: 'copper', slots: [['koch_v3', 1]],
    view: { camera: {x: 0.92091, y: -0.907432, z: 1.914225}, target: {x: 0.155607, y: 0.010931, z: 0.000969}, camera_top: {x: -0.473489, y: 0.705112, z: 0.527849} } },
  { id: 'hobold4', title: 'Riemann Silver Flower', look: 'porcelain', slots: [['riemann_sphere_hobold_pow4', 1]],
    view: { camera: {x: 1.613272, y: -3.239015, z: 0.932799}, target: {x: -0.07344, y: 0.134411, z: -0.079228}, camera_top: {x: -0.1159, y: 0.2318, z: 0.965834} } },
  { id: 'ellipsoid', title: 'dIFS Ellipsoid Pile', look: 'porcelain', slots: [['difs_ellipsoid', 1]],
    view: { camera: {x: 2.294282, y: -4.641799, z: 2.296467}, target: {x: -0.037256, y: 0.021277, z: -0.035071}, camera_top: {x: -0.182574, y: 0.365148, z: 0.912871} } },
  { id: 'difsmulti', title: 'dIFS Furnace', look: 'ember', slots: [['difs_multi_v1', 1]],
    view: { camera: {x: 2.317375, y: -4.672065, z: 2.319557}, target: {x: -0.029372, y: 0.021429, z: -0.027191}, camera_top: {x: -0.182574, y: 0.365148, z: 0.912871} } },
  { id: 'difsprism', title: 'dIFS Prism Steps', look: 'jade', slots: [['difs_prism', 1]],
    view: { camera: {x: 2.290022, y: -4.539046, z: 2.753301}, target: {x: -0.009726, y: 0.060452, z: -0.006398}, camera_top: {x: -0.211472, y: 0.422944, z: 0.881134} } },
  { id: 'knot1', title: 'Golden Knot', look: 'gold', slots: [['knot_v1', 1]],
    view: { camera: {x: 1.065809, y: -3.040888, z: 4.551015}, target: {x: 0.155882, y: -0.0078, z: 0.001382}, camera_top: {x: -0.295493, y: 0.766565, z: 0.570142} } },
  { id: 'knot2', title: 'Torus Knot Weave', look: 'violet', slots: [['knot_v2', 1]],
    view: { camera: {x: 2.632139, y: -5.587961, z: 8.733663}, target: {x: 0.941709, y: 0.046805, z: 1.971944}, camera_top: {x: -0.272055, y: 0.704705, z: 0.655268} } },
  { id: 'blockbulb', title: 'Blockified Bulb', look: 'sand', slots: [['transf_blockify', 1], ['mandelbulb', 1]],
    view: { camera: {x: 1.048361, y: -2.086722, z: 0.730353}, target: {x: 0.005, y: 0, z: 0}, camera_top: {x: -0.133606, y: 0.267213, z: 0.954331} } },
  { id: 'gnarlbox', title: 'Gnarl Mandelbox', look: 'jade', slots: [['transf_gnarl', 1], ['mandelbox', 1]],
    view: { camera: {x: 9.291379, y: -11.152414, z: 7.42877}, target: {x: -0.021413, y: 0.022936, z: -0.021464}, camera_top: {x: -0.239976, y: 0.392074, z: 0.888082} } },
  { id: 'rotfoldbox', title: 'Rotation Fold Box', look: 'violet', slots: [['transf_rotation_folding_plane', 1], ['abox_mod2', 1]],
    view: { camera: {x: 8.067118, y: -9.677428, z: 6.450427}, target: {x: -0.003302, y: 0.007077, z: -0.00591}, camera_top: {x: -0.239976, y: 0.392074, z: 0.888082} } },
  { id: 'spherefoldquat', title: 'Spherefold Quaternion', look: 'violet', slots: [['transf_spherical_fold_abox', 1], ['mandelbulb_quat', 1]],
    view: { camera: {x: 1.052474, y: -2.100929, z: 0.738497}, target: {x: 0.002671, y: -0.001322, z: 0.003635}, camera_top: {x: -0.133606, y: 0.267213, z: 0.954331} } },
  { id: 'mengerv3', title: 'Menger Sphere', look: 'jade', slots: [['menger_v3', 1]],
    view: { camera: {x: 1.849717, y: -3.718721, z: 1.483885}, target: {x: -0.008707, y: -0.001874, z: -0.002854}, camera_top: {x: -0.150649, y: 0.301297, z: 0.941554} } },
  { id: 'atan2', title: 'Atan2 Bulb Flame', look: 'ember', slots: [['mandelbulb_atan2_power2', 1]],
    view: { camera: {x: 1.425412, y: -2.98984, z: 0.833127}, target: {x: -0.068829, y: -0.001357, z: -0.212842}, camera_top: {x: -0.133606, y: 0.267213, z: 0.954331} } },
  { id: 'aboxmenger', title: 'Box Menger Hybrid', look: 'gold', slots: [['abox_mod2', 1], ['menger3_m3d', 1]],
    view: { camera: {x: 11.076004, y: -13.319458, z: 8.007902}, target: {x: 1.105166, y: 0.639715, z: 0.031232}, camera_top: {x: -0.208157, y: 0.368941, z: 0.905844} } },
];

export function buildOriginals(P, CAT) {
  const byFile = new Map(CAT.formulas.map((f) => [f.file, f]));
  const presets = [], errors = [];
  for (const o of ORIGINALS) {
    const main = { ...LOOKS[o.look], ...(o.main || {}), ...o.view };
    if (!LOOKS[o.look]) errors.push(`${o.id}: no look ${o.look}`);
    if (o.slots.length > 1) main.hybrid_fractal_enable = true;
    o.slots.forEach(([file, n], i) => {
      const f = byFile.get(file);
      if (!f) { errors.push(`${o.id}: no formula ${file}`); return; }
      main[`formula_${i + 1}`] = f.enumId;
      if (o.slots.length > 1) main[`formula_iterations_${i + 1}`] = n;
    });
    for (const k of Object.keys(main)) if (!specFor(P, 'main', k)) errors.push(`${o.id}: unknown main param ${k}`);
    const fractal = o.fractal || [];
    fractal.forEach((s) => { for (const k of Object.keys(s)) if (!P.fractal[k]) errors.push(`${o.id}: unknown fractal param ${k}`); });
    presets.push({ id: o.id, title: o.title, formulas: o.slots.map(([f]) => f), main, fractal });
  }
  return { presets, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const gen = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gen'));
  const read = (f) => JSON.parse(fs.readFileSync(path.join(gen, f), 'utf8'));
  const { presets, errors } = buildOriginals(read('params.json'), read('catalog.json'));
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const text = JSON.stringify({ presets });
  fs.writeFileSync(path.join(gen, 'originals.json'), text);
  console.log(`originals.json: ${presets.length} presets, ${text.length} bytes`);
}
