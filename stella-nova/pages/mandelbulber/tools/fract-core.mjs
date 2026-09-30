// fract-core.mjs — Mandelbulber .fract settings text <-> scene object (pure, no DOM, no fs).
//
// Format, param names and the version migrations port Mandelbulber2 src/settings.cpp
// (Decode, DecodeOneLine, Compatibility, Compatibility2) and src/initparameters.cpp,
// Copyright (C) Krzysztof Marczak and the Mandelbulber team, GPL-3.0-or-later.
// The full licence is in ../COPYING.
//
// The catalog generator (catalog.mjs) uses this module to build gen/examples.json, and the
// page can import it at run time. All functions take the parsed gen/params.json as `P`.
//
// A scene is { main: { name: value }, fractal: [ { name: value } x slots ] } (contract C5).
// Per-slot general params (formula, formula_iterations, julia_mode ...) live in main as
// "<name>_<k>" with k = 1..9, the same way legacy .fract files store them.
// Materials and lights are main keys "mat<N>_<name>" and "light<N>_<name>".
//
// grep: parseFractText parseValue formatValue resolveParam fractToScene sceneToFract
//       compatName migrateScene parseGradient formatGradient defaultScene fillDefaults specFor

const AXES = ['x', 'y', 'z', 'w'];

// Split .fract text into { version, sections: [{ name, lines: [[key, raw]], text }] }.
export function parseFractText(text) {
  const out = { version: null, sections: [] };
  let cur = null;
  for (const line of String(text).split(/\r\n|\r|\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) {
      const m = t.match(/^#\s*version\s+([0-9.]+)/);
      if (m) out.version = parseFloat(m[1]);
      continue;
    }
    const sec = t.match(/^\[([^\]]+)\]$/);
    if (sec) {
      cur = { name: sec[1], lines: [], text: [] };
      out.sections.push(cur);
      continue;
    }
    if (!cur) { cur = { name: 'main_parameters', lines: [], text: [] }; out.sections.push(cur); }
    cur.text.push(line);
    // "name value;" — value ends at the first ';' (settings.cpp DecodeOneLine).
    const sp = t.indexOf(' '), semi = t.indexOf(';');
    if (sp <= 0 || semi <= sp) continue;
    const unq = s => (s.length >= 2 && /^(["']).*\1$/.test(s) ? s.slice(1, -1).trim() : s);
    cur.lines.push([unq(t.slice(0, sp).trim()), unq(t.slice(sp + 1, semi).trim())]);
  }
  return out;
}

const num = s => parseFloat(String(s).replace(',', '.'));

// Raw .fract value text -> typed value. spec = params.json record ({ type, options? }).
export function parseValue(spec, raw) {
  const type = typeof spec === 'string' ? spec : spec.type;
  const s = String(raw).trim();
  switch (type) {
    case 'double': return num(s);
    case 'int': {
      // Enumerated params are written as their label (for example "fold_oct").
      if (spec.options && !/^-?\d/.test(s)) { const i = spec.options.indexOf(s); return i >= 0 ? i : 0; }
      return Math.round(num(s));
    }
    case 'bool': return s === 'true' || s === '1';
    case 'vect3':
    case 'vect4': {
      const p = s.split(/\s+/).map(num);
      const n = type === 'vect3' ? 3 : 4;
      const v = {};
      for (let i = 0; i < n; i++) v[AXES[i]] = Number.isFinite(p[i]) ? p[i] : 0;
      return v;
    }
    case 'rgb': {
      // 16-bit hex per channel ("ff00 0b00 2f00"); upstream divides by 65536 (toRGBFloat).
      const p = s.split(/\s+/).map(h => parseInt(h, 16));
      return { r: (p[0] || 0) / 65536, g: (p[1] || 0) / 65536, b: (p[2] || 0) / 65536 };
    }
    default: return s;
  }
}

const fmtNum = v => (Number.isFinite(v) ? String(v) : '0');
const hex16 = v => Math.max(0, Math.min(65535, Math.round(v * 65536))).toString(16);

// Typed value -> .fract value text (dot decimals; upstream reads both).
export function formatValue(spec, v) {
  const type = typeof spec === 'string' ? spec : spec.type;
  switch (type) {
    case 'double': return fmtNum(v);
    case 'int': return spec.options && spec.options[v] !== undefined ? spec.options[v] : String(Math.round(v));
    case 'bool': return v ? 'true' : 'false';
    case 'vect3': return [v.x, v.y, v.z].map(fmtNum).join(' ');
    case 'vect4': return [v.x, v.y, v.z, v.w].map(fmtNum).join(' ');
    case 'rgb': return [v.r, v.g, v.b].map(hex16).join(' ');
    default: return String(v);
  }
}

// Gradient string "0 fd6029 999 698403 ..." -> [{ pos, r, g, b }], pos 0..9999, rgb 0..1.
export function parseGradient(str) {
  const t = String(str).trim().split(/\s+/);
  const out = [];
  for (let i = 0; i + 1 < t.length; i += 2) {
    const c = parseInt(t[i + 1], 16);
    out.push({ pos: parseInt(t[i], 10), r: ((c >> 16) & 255) / 255, g: ((c >> 8) & 255) / 255, b: (c & 255) / 255 });
  }
  return out;
}

export function formatGradient(stops) {
  const h = v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return stops.map(s => `${s.pos} ${h(s.r)}${h(s.g)}${h(s.b)}`).join(' ');
}

// ---------------------------------------------------------------- name resolution

function templateSpec(P, name) {
  const T = P.templates || {};
  let m = name.match(/^(mat|light)(\d+)_(.+)$/);
  if (m) {
    const t = m[1] === 'mat' ? T.material : T.light;
    const s = t && t.params[m[3]];
    if (!s) return null;
    const d = s.defaultById && s.defaultById[m[2]] !== undefined ? s.defaultById[m[2]] : s.default;
    return { ...s, default: d };
  }
  m = name.match(/^primitive_([a-z]+)_(\d+)_(.+)$/);
  if (m && T.primitive) {
    const typ = T.primitive.types[m[1]];
    if (!typ) return null;
    if (m[3] === 'name') return { type: 'string', default: `${m[1]} #${m[2]}` };
    return typ[m[3]] || T.primitive.common[m[3]] || null;
  }
  return null;
}

// Spec ({ type, default, ... }) for a scene key: where = 'main' | 'fractal'.
export function specFor(P, where, name) {
  if (where === 'fractal') return P.fractal[name] || null;
  return P.main[name] || templateSpec(P, name);
}

// Where a .fract line belongs. section is "main_parameters" or "fractal_<k>".
// Returns { where: 'main'|'fractal', slot (0-based, fractal only), key, spec } or null.
export function resolveParam(P, section, name) {
  const fm = section.match(/^fractal_(\d+)$/);
  if (fm) {
    const k = parseInt(fm[1], 10);
    if (P.fractal[name]) return { where: 'fractal', slot: k - 1, key: name, spec: P.fractal[name] };
    const slotKey = `${name}_${k}`;
    if (P.main[slotKey]) return { where: 'main', key: slotKey, spec: P.main[slotKey] };
    return null;
  }
  if (section !== 'main_parameters') return null;
  const s = specFor(P, 'main', name);
  if (s) return { where: 'main', key: name, spec: s };
  // Legacy flat form "<fractal param>_<k>" in main (settings.cpp TryResolveLegacyFractalParam).
  const lm = name.match(/^(.+)_(\d+)$/);
  if (lm && P.fractal[lm[1]]) {
    const k = parseInt(lm[2], 10);
    if (k >= 1 && k <= (P.slots || 9)) return { where: 'fractal', slot: k - 1, key: lm[1], spec: P.fractal[lm[1]] };
  }
  return null;
}

// ---------------------------------------------------------------- settings.cpp Compatibility()

const MAT1_2071 = {
  shading: 'mat1_shading', specular: 'mat1_specular', reflect: 'mat1_reflectance',
  transparency_of_surface: 'mat1_transparency_of_surface', transparency_of_interior: 'mat1_transparency_of_interior',
  transparency_index_of_refraction: 'mat1_transparency_index_of_refraction',
  transparency_interior_color: 'mat1_transparency_interior_color', fresnel_reflectance: 'mat1_fresnel_reflectance',
  coloring_random_seed: 'mat1_coloring_random_seed', coloring_saturation: 'mat1_coloring_saturation',
  coloring_speed: 'mat1_coloring_speed', coloring_palette_size: 'mat1_coloring_palette_size',
  coloring_palette_offset: 'mat1_coloring_palette_offset', fractal_color: 'mat1_use_colors_from_palette',
  surface_color_palette: 'mat1_surface_color_palette', fractal_coloring_algorithm: 'mat1_fractal_coloring_algorithm',
  fractal_coloring_sphere_radius: 'mat1_fractal_coloring_sphere_radius',
  fractal_coloring_line_direction: 'mat1_fractal_coloring_line_direction',
};

// Per-line name/value migration by file version. Returns [name, value]; name "skip" drops it.
export function compatName(name, value, v) {
  if (v === null || v === undefined) v = 99;
  if (v <= 2.01) {
    if (name.includes('aux_light_predefined')) name = name.replace('aux_light_predefined', 'aux_light');
    if (name === 'volumetric_light_intensity_0') name = 'main_light_volumetric_intensity';
    else if (name === 'volumetric_light_enabled_0') name = 'main_light_volumetric_enabled';
    else if (name.includes('volumetric_light')) name = name.replace('volumetric_light', 'aux_light_volumetric');
  }
  if (v <= 2.04 && name === 'fractal_constant_factor') value = `${value} ${value} ${value}`;
  if (v <= 2.06 && name === 'linear_DE_mode') { name = 'delta_DE_function'; value = '1'; }
  if (v <= 2.071 && MAT1_2071[name]) name = MAT1_2071[name];
  if (v < 2.09 && name === 'delta_DE_function') value = value === '0' ? '2' : value === '2' ? '0' : value;
  if (v < 2.12) name = name.replace('gpu_', 'opencl_');
  if (v < 2.13 && name.includes('primitive_water')) name = name.replace('amplitude', 'relative_amplitude');
  if (v < 2.19) {
    if (name.includes('surface_color_palette')) {
      name = name.replace('surface_color_palette', 'surface_color_gradient');
      const split = value.split(' ');
      let n = split.length;
      if (split[split.length - 1].length < 6) n -= 1;
      const step = 1 / n;
      const parts = [];
      for (let i = 0; i < n; i++) parts.push(`${Math.trunc(i * step * 10000)} ${split[i]}`);
      value = parts.join(' ');
    }
    if (name.includes('luminosity_color_thesame')) name = name.replace('luminosity_color_thesame', 'luminosity_gradient_enable');
    if (name.includes('reflections_color_thesame')) name = name.replace('reflections_color_thesame', 'reflectance_gradient_enable');
    if (name.includes('transparency_color_thesame')) name = name.replace('transparency_color_thesame', 'transparency_gradient_enable');
    if (name.includes('coloring_palette_size') || name.includes('coloring_random_seed') || name.includes('coloring_saturation')) name = 'skip';
  }
  if (v < 2.25) {
    const R = [['main_light_intensity', 'light1_intensity'], ['main_light_visibility_size', 'light1_size'],
      ['main_light_contour_sharpness', 'light1_contour_sharpness'], ['main_light_alpha', 'light1_alpha'],
      ['main_light_beta', 'light1_beta'], ['main_light_colour', 'light1_color'], ['penetrating_lights', 'light1_penetrating'],
      ['shadows_enabled', 'light1_cast_shadows'], ['shadows_cone_angle', 'light1_soft_shadow_cone'],
      ['main_light_enable', 'light1_enabled'], ['main_light_position_relative', 'light1_relative_position'],
      ['main_light_volumetric_intensity', 'light1_volumetric_visibility'], ['main_light_volumetric_enabled', 'light1_volumetric']];
    if (name === 'main_light_visibility') name = 'light1_visibility';
    for (const [a, b] of R) if (name.includes(a)) name = name.replace(a, b);
    if (name.includes('aux_light')) {
      if (name.includes('visibility_size')) name = name.replace('aux_light_visibility_size', 'light2_size');
      else if (name.includes('visibility')) name = name.replace('aux_light_visibility', 'light2_visibility');
      else if (!name.includes('aux_light_place_behind')) {
        const split = name.split('_');
        const pre = `light${parseInt(split[split.length - 1], 10) + 1}`;
        if (split[2] === 'intensity') name = `${pre}_intensity`;
        else if (split[2] === 'position') name = `${pre}_position`;
        else if (split[2] === 'enabled') name = `${pre}_enabled`;
        else if (split[2] === 'colour') name = `${pre}_color`;
        else if (split[2] === 'volumetric') {
          if (split[3] === 'intensity') name = `${pre}_volumetric_visibility`;
          else if (split[3] === 'enabled') name = `${pre}_volumetric`;
        }
      }
    }
  }
  if (v < 2.28 && name === 'random_lights_one_color_enable') {
    name = 'random_lights_coloring_type';
    if (value.includes('true')) value = 'single';
  }
  return [name, value];
}

// ---------------------------------------------------------------- settings.cpp Compatibility2()

// Scene-level migration after all lines are read. `ctx` = { loadedPrimitives, definedMats, definedLights }.
// Ported: v2.06, 2.071, 2.12, 2.19, 2.20, 2.21, 2.22, 2.25, 2.28, 2.29.
// Not ported: v2.35 objects tree (this page keeps the legacy flat slot model).
export function migrateScene(scene, v, P, ctx) {
  if (v === null || v === undefined) return;
  const M = scene.main;
  const has = k => k in M;
  const get = k => (k in M ? M[k] : (specFor(P, 'main', k) || {}).default);
  const isDef = k => !(k in M) || JSON.stringify(M[k]) === JSON.stringify((specFor(P, 'main', k) || {}).default);
  const slot = i => { while (scene.fractal.length <= i) scene.fractal.push({}); return scene.fractal[i]; };
  const fget = (i, k) => (scene.fractal[i] && k in scene.fractal[i] ? scene.fractal[i][k] : P.fractal[k].default);

  if (v <= 2.06) {
    if (get('delta_DE_function') !== 1) M.delta_DE_function = 2;
    for (let i = 0; i < 4; i++) slot(i).IFS_rotation_enabled = true;
  }
  if (v <= 2.071) {
    ctx.loadedPrimitives.forEach((pr, i) => {
      const id = i + 2;
      ctx.definedMats.add(id);
      M[`mat${id}_is_defined`] = true;
      M[`mat${id}_name`] = pr;
      M[`mat${id}_surface_color`] = get(`${pr}_color`);
      M[`mat${id}_reflectance`] = get(`${pr}_reflection`);
      M[`mat${id}_use_colors_from_palette`] = false;
      for (const k of ['fresnel_reflectance', 'transparency_index_of_refraction', 'transparency_of_surface',
        'transparency_of_interior', 'transparency_interior_color', 'specular', 'shading']) M[`mat${id}_${k}`] = get(`mat1_${k}`);
      M[`${pr}_material_id`] = id;
    });
  }
  if (v <= 2.12) {
    if (get('iteration_fog_enable')) M.iteration_fog_brightness_boost = 100;
    for (const pr of ctx.loadedPrimitives) {
      if (pr.includes('primitive_water')) M[`${pr}_relative_amplitude`] = get(`${pr}_relative_amplitude`) / get(`${pr}_length`);
    }
  }
  if (v < 2.19) {
    for (const id of ctx.definedMats) {
      const mat = `mat${id}`;
      const size = Math.trunc(String(get(`${mat}_surface_color_gradient`)).split(' ').length / 2);
      M[`${mat}_coloring_palette_offset`] = get(`${mat}_coloring_palette_offset`) / size;
      M[`${mat}_coloring_speed`] = get(`${mat}_coloring_speed`) * 10 / size;
      for (const g of ['luminosity', 'reflectance', 'transparency']) {
        if (get(`${mat}_${g}_gradient_enable`)) M[`${mat}_${g}_gradient`] = get(`${mat}_surface_color_gradient`);
      }
    }
  }
  if (v < 2.20 && has('delta_DE_method') && get('delta_DE_method') === 0) M.delta_DE_function = 0;
  if (v < 2.21) {
    let fov = get('fov');
    if (fov === 53.13) fov = 1.0;
    const pt = get('perspective_type');
    let deg = 0;
    if (pt === 0) deg = Math.atan(fov / 2) * 360 / Math.PI;
    else if (pt === 1 || pt === 3) deg = fov * 180;
    else if (pt === 2) deg = fov * 360;
    M.fov = deg;
  }
  if (v < 2.22) {
    scene.fractal.forEach((f, i) => {
      const e = fget(i, 'IFS_edge');
      if (Math.hypot(e.x, e.y, e.z) > 0) f.IFS_edge_enabled = true;
    });
  }
  if (v < 2.25) {
    if (ctx.definedLights.has(1)) {
      M.light1_rotation = { x: get('light1_alpha'), y: get('light1_beta'), z: 0 };
    } else {
      ctx.definedLights.add(1);
      M.light1_enabled = true;
      M.light1_is_defined = true;
    }
    delete M.light1_alpha; delete M.light1_beta;
    if (ctx.definedLights.has(2)) {
      for (let i = 3; i <= 5; i++) {
        if (ctx.definedLights.has(i)) { M[`light${i}_visibility`] = get('light2_visibility'); M[`light${i}_size`] = get('light2_size'); }
      }
    }
    for (let i = 2; i <= 5; i++) {
      if (!ctx.definedLights.has(i)) continue;
      if (!isDef(`light${i}_intensity`)) M[`light${i}_intensity`] = get(`light${i}_intensity`) / 4;
      if (!isDef(`light${i}_size`)) M[`light${i}_size`] = get(`light${i}_size`) * 2;
      if (get(`light${i}_volumetric`)) M[`light${i}_volumetric_visibility`] = get(`light${i}_volumetric_visibility`) / get(`light${i}_intensity`);
      M[`light${i}_penetrating`] = get('light1_penetrating');
      M[`light${i}_cast_shadows`] = get('light1_cast_shadows');
    }
    if (get('random_lights_group')) {
      const n = get('random_lights_number');
      M.random_lights_intensity = get('random_lights_intensity') / (Math.trunc(n / 4) + 4);
      M.random_lights_size = get('light2_size') * (Math.sqrt(n) / 4);
    }
  }
  if (v < 2.28 && ctx.definedLights.has(1) && get('iteration_fog_enable')) {
    M.light1_intensity = get('light1_intensity') / get('iteration_fog_brightness_boost');
  }
  if (v < 2.29 && get('boolean_operators')) {
    const n = get('N');
    for (let s = 1; s <= (P.slots || 9); s++) M[`formula_maxiter_${s}`] = n;
  }
}

// ---------------------------------------------------------------- whole file

// .fract text -> { scene, version, description, unknown: [{ section, name, raw }] }.
// fill=false keeps only the params the file sets (plus what migration sets), as in examples.json.
// migrate=false skips the version migrations.
export function fractToScene(text, P, { fill = true, migrate = true } = {}) {
  const parsed = parseFractText(text);
  const v = parsed.version;
  const scene = { main: {}, fractal: [] };
  const unknown = [];
  const ctx = { loadedPrimitives: [], definedMats: new Set(), definedLights: new Set() };
  let description = null;
  let slots = 1;
  for (const sec of parsed.sections) {
    if (sec.name === 'description') { description = sec.text.join('\n').trim(); continue; }
    if (sec.name !== 'main_parameters' && !/^fractal_\d+$/.test(sec.name)) continue;
    for (const [name0, raw0] of sec.lines) {
      const [name, raw] = migrate ? compatName(name0, raw0, v) : [name0, raw0];
      if (name === 'skip') continue;
      const r = resolveParam(P, sec.name, name);
      if (!r) { unknown.push({ section: sec.name, name: name0, raw: raw0 }); continue; }
      const val = parseValue(r.spec, raw);
      if (r.where === 'main') {
        scene.main[r.key] = val;
        if (r.spec.slot) slots = Math.max(slots, r.spec.slot);
        let m;
        if ((m = r.key.match(/^mat(\d+)_/))) ctx.definedMats.add(+m[1]);
        if ((m = r.key.match(/^light(\d+)_/))) ctx.definedLights.add(+m[1]);
        if ((m = r.key.match(/^(primitive_[a-z]+_\d+)_/)) && !ctx.loadedPrimitives.includes(m[1])) ctx.loadedPrimitives.push(m[1]);
      } else {
        while (scene.fractal.length <= r.slot) scene.fractal.push({});
        scene.fractal[r.slot][r.key] = val;
        slots = Math.max(slots, r.slot + 1);
      }
    }
  }
  // A material or light that the file touches counts as defined (DecodeOneLine lazy init).
  for (const id of ctx.definedMats) {
    if (migrate && v !== null && v < 2.15) {
      for (const [k, d] of [['metallic', false], ['specular', 1], ['specular_width', 1]]) {
        if (!(`mat${id}_${k}` in scene.main)) scene.main[`mat${id}_${k}`] = d;
      }
    }
    scene.main[`mat${id}_is_defined`] = true;
  }
  for (const id of ctx.definedLights) if (!(`light${id}_is_defined` in scene.main)) scene.main[`light${id}_is_defined`] = true;
  while (scene.fractal.length < slots) scene.fractal.push({});
  if (migrate) migrateScene(scene, v, P, ctx);
  const out = fill ? fillDefaults(scene, P) : scene;
  return { scene: out, version: v, description, unknown };
}

const clone = v => (v && typeof v === 'object' ? { ...v } : v);

// Default scene: every main param, material 1, light 1, and `slots` fractal slots.
export function defaultScene(P, slots = P.slots || 9) {
  const main = {};
  for (const [k, s] of Object.entries(P.main)) main[k] = clone(s.default);
  const T = P.templates || {};
  if (T.material) for (const k of Object.keys(T.material.params)) main[`mat1_${k}`] = clone(templateSpec(P, `mat1_${k}`).default);
  if (T.light) for (const k of Object.keys(T.light.params)) main[`light1_${k}`] = clone(templateSpec(P, `light1_${k}`).default);
  main.mat1_is_defined = true;
  main.light1_is_defined = true;
  const fractal = [];
  for (let i = 0; i < slots; i++) {
    const f = {};
    for (const [k, s] of Object.entries(P.fractal)) f[k] = clone(s.default);
    fractal.push(f);
  }
  return { main, fractal };
}

// Fill missing values from params.json defaults. Every material, light and primitive the
// scene mentions gets its full template.
export function fillDefaults(scene, P, slots = P.slots || 9) {
  const d = defaultScene(P, Math.max(slots, scene.fractal.length));
  const T = P.templates || {};
  const seen = new Set();
  for (const k of Object.keys(scene.main)) {
    let m;
    if ((m = k.match(/^(mat|light)(\d+)_/)) && !seen.has(m[0])) {
      seen.add(m[0]);
      const t = m[1] === 'mat' ? T.material : T.light;
      for (const n of Object.keys(t.params)) d.main[`${m[0]}${n}`] = clone(templateSpec(P, `${m[0]}${n}`).default);
    } else if ((m = k.match(/^(primitive_([a-z]+)_\d+)_/)) && !seen.has(m[1]) && T.primitive && T.primitive.types[m[2]]) {
      seen.add(m[1]);
      for (const n of [...Object.keys(T.primitive.common), ...Object.keys(T.primitive.types[m[2]]), 'name']) {
        d.main[`${m[1]}_${n}`] = clone(templateSpec(P, `${m[1]}_${n}`).default);
      }
    }
  }
  Object.assign(d.main, scene.main);
  scene.fractal.forEach((f, i) => Object.assign(d.fractal[i], f));
  return d;
}

const same = (a, b) => {
  if (a && typeof a === 'object') return !!b && Object.keys(a).every(k => Math.abs(a[k] - b[k]) < 1e-12);
  return a === b;
};

// Scene -> .fract text (current names; version header 2.33 keeps the legacy slot layout).
// onlyModified skips values equal to their default.
export function sceneToFract(scene, P, { onlyModified = true, version = '2.33', description = null } = {}) {
  const L = ['# Mandelbulber settings file', `# version ${version}`];
  if (onlyModified) L.push('# only modified parameters');
  L.push('[main_parameters]');
  for (const k of Object.keys(scene.main).sort()) {
    const s = specFor(P, 'main', k);
    if (!s || s.noSave) continue;
    const v = scene.main[k];
    if (onlyModified && same(v, s.default) && !/_is_defined$/.test(k)) continue;
    L.push(`${k} ${formatValue(s, v)};`);
  }
  scene.fractal.forEach((f, i) => {
    const lines = [];
    for (const k of Object.keys(f).sort()) {
      const s = P.fractal[k];
      if (!s) continue;
      if (onlyModified && same(f[k], s.default)) continue;
      lines.push(`${k} ${formatValue(s, f[k])};`);
    }
    if (lines.length) L.push(`[fractal_${i + 1}]`, ...lines);
  });
  if (description) L.push('[description]', description);
  return L.join('\n') + '\n';
}
