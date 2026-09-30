// params.js - packs a Mandelbulber scene into GPU bytes: the per-slot Fractal structs, the
// hybrid sequence, and RenderParams (camera, quality, lights, material, palette).
// Ports these upstream parts of Mandelbulber v2 to JS: sFractal::RecalculateFractalParams
// (src/fractal.cpp), cHybridFractalSequences::CreateSequence and CollectSequenceData
// (src/hybrid_fractal_sequences.cpp), sParamRender (src/fractparams.cpp), cCameraTarget
// (src/camera_target.cpp), cLight::setParameters (src/light.cpp), cMaterial and
// cColorGradient::SetColorsFromString (src/material.cpp, src/color_gradient.cpp), CalcFOV.
// Copyright (C) 2014-24 Mandelbulber Team, Krzysztof Marczak and contributors.
// Mandelbulber is free software under the GNU General Public License v3 or later.
// This port is also GPL-3.0. See COPYING in the page folder.
//
// Byte layouts come from WGSL source: parseWgslStructs() reads the struct declarations and
// computeLayout() applies the WGSL host-shareable alignment rules. gen/layout.json, when it
// is present, gives the Fractal layout instead.
// Matrices (matrix33 in OpenCL) are packed as three rows m1, m2, m3 at +0, +16, +32 bytes.
//
// grep: parseWgslStructs computeLayout normPath packValues fractalValues recalculateFractalParams
//       buildFractalBuffer buildSequence buildRenderParams sceneValue parseGradient cameraTarget
//       lightFromScene formulaSetForScene materialValues

const PI = Math.PI;
const M_PI_180 = PI / 180.0;

// ------------------------------------------------------------------ WGSL layout

const SCALAR = {
  f32: { size: 4, align: 4 }, i32: { size: 4, align: 4 }, u32: { size: 4, align: 4 },
  bool: { size: 4, align: 4 },
  vec2f: { size: 8, align: 8 }, vec2i: { size: 8, align: 8 }, vec2u: { size: 8, align: 8 },
  vec3f: { size: 12, align: 16 }, vec3i: { size: 12, align: 16 }, vec3u: { size: 12, align: 16 },
  vec4f: { size: 16, align: 16 }, vec4i: { size: 16, align: 16 }, vec4u: { size: 16, align: 16 },
  mat3x3f: { size: 48, align: 16 }, mat4x4f: { size: 64, align: 16 }, mat2x2f: { size: 16, align: 8 },
  mat4x3f: { size: 64, align: 16 }, mat3x4f: { size: 48, align: 16 },
};

function canonType(t) {
  t = t.replace(/\s+/g, '');
  const m = t.match(/^(vec[234]|mat\dx\d)<(f32|i32|u32)>$/);
  if (m) return m[1] + m[2][0];
  return t;
}

// Parse "struct Name { field: type, ... }" declarations. Attributes and comments are dropped.
export function parseWgslStructs(src) {
  const text = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const structs = {};
  const re = /struct\s+(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[2];
    const fields = [];
    // split on commas that are not inside <...>
    let depth = 0, cur = '';
    for (const ch of body) {
      if (ch === '<') depth++;
      if (ch === '>') depth--;
      if (ch === ',' && depth === 0) { fields.push(cur); cur = ''; } else cur += ch;
    }
    fields.push(cur);
    structs[m[1]] = fields.map(f => f.replace(/@\w+(\([^)]*\))?/g, '').trim()).filter(Boolean).map(f => {
      const i = f.indexOf(':');
      return { name: f.slice(0, i).trim(), type: canonType(f.slice(i + 1).trim()) };
    });
  }
  return structs;
}

function roundUp(a, n) { return Math.ceil(n / a) * a; }

function typeInfo(structs, type, cache) {
  if (SCALAR[type]) return SCALAR[type];
  if (cache[type]) return cache[type];
  const arr = type.match(/^array<(.+),(\d+)u?>$/);
  if (arr) {
    const el = typeInfo(structs, arr[1], cache);
    const stride = roundUp(el.align, el.size);
    const info = { size: stride * +arr[2], align: el.align, array: { el: arr[1], count: +arr[2], stride } };
    cache[type] = info;
    return info;
  }
  const fields = structs[type];
  if (!fields) throw new Error('params.js: unknown WGSL type ' + type);
  let offset = 0, align = 1;
  const members = [];
  for (const f of fields) {
    const fi = typeInfo(structs, f.type, cache);
    offset = roundUp(fi.align, offset);
    members.push({ name: f.name, type: f.type, offset });
    offset += fi.size;
    align = Math.max(align, fi.align);
  }
  const info = { size: roundUp(align, offset), align, members };
  cache[type] = info;
  return info;
}

// Flatten a struct into { size, align, fields: { "a.b.0.c": { offset, type } } } with leaf
// types only (scalars, vectors, matrices). Array elements use ".<index>" in the path.
export function computeLayout(structs, name) {
  const cache = {};
  const root = typeInfo(structs, name, cache);
  const fields = {};
  const walk = (type, base, prefix) => {
    if (SCALAR[type]) { fields[prefix] = { offset: base, type }; return; }
    const info = typeInfo(structs, type, cache);
    if (info.array) {
      for (let i = 0; i < info.array.count; i++) {
        walk(info.array.el, base + i * info.array.stride, prefix + '.' + i);
      }
      return;
    }
    for (const mbr of info.members) walk(mbr.type, base + mbr.offset, prefix ? prefix + '.' + mbr.name : mbr.name);
  };
  walk(name, 0, '');
  return { size: root.size, align: root.align, fields };
}

// "mandelbox.rot[0][1]" -> "mandelbox.rot.0.1"
export function normPath(p) {
  return String(p).replace(/\[(\d+)\]/g, '.$1');
}

// Normalise a gen/layout.json struct entry to computeLayout() form.
export function layoutFromJson(entry) {
  const fields = {};
  for (const [k, v] of Object.entries(entry.fields)) fields[normPath(k)] = { offset: v.offset, type: canonType(v.type) };
  return { size: entry.size, align: entry.align, fields };
}

// Write values ({ path: number | bool | number[] | number[][] }) into a DataView at base.
export function packValues(layout, values, view, base = 0, missing = null) {
  for (const [path, v] of Object.entries(values)) {
    const f = layout.fields[path];
    if (!f) {
      // matrix33 as struct { m1, m2, m3 } (gen/layout.json lists the rows)
      const m1 = layout.fields[path + '.m1'];
      if (m1 && Array.isArray(v) && Array.isArray(v[0])) {
        for (let r = 0; r < 4; r++) {
          const fr = layout.fields[`${path}.m${r + 1}`];
          if (fr && v[r]) writeField(view, base + fr.offset, fr.type, v[r]);
        }
        continue;
      }
      if (missing) missing.add(path);
      continue;
    }
    writeField(view, base + f.offset, f.type, v);
  }
}

function writeField(view, off, type, v) {
  const isInt = /^(i32|vec\di)$/.test(type);
  const isUint = /^(u32|bool|vec\du)$/.test(type);
  const put = (o, x) => {
    if (typeof x === 'boolean') x = x ? 1 : 0;
    if (x === undefined || x === null || Number.isNaN(x)) x = 0;
    if (isInt) view.setInt32(o, Math.round(x), true);
    else if (isUint) view.setUint32(o, Math.max(0, Math.round(x)) >>> 0, true);
    else view.setFloat32(o, x, true);
  };
  if (type.startsWith('mat')) {
    const [, c, r] = type.match(/^mat(\d)x(\d)/);
    const rows = toRows(v, +c);
    for (let i = 0; i < +c; i++) for (let j = 0; j < +r; j++) {
      view.setFloat32(off + i * 16 + j * 4, rows[i]?.[j] ?? (i === j ? 1 : 0), true);
    }
    return;
  }
  const n = type.startsWith('vec') ? +type[3] : 1;
  const arr = vecArray(v, n);
  for (let i = 0; i < n; i++) put(off + i * 4, arr[i]);
}

function toRows(v, n) {
  if (Array.isArray(v) && Array.isArray(v[0])) return v;
  if (Array.isArray(v) && v.length === n * n) {
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(v.slice(i * n, i * n + n));
    return rows;
  }
  return [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
}

function vecArray(v, n) {
  if (typeof v === 'number' || typeof v === 'boolean') return n === 1 ? [v] : Array(n).fill(+v);
  if (Array.isArray(v)) { const a = v.slice(0, n); while (a.length < n) a.push(0); return a; }
  if (v && typeof v === 'object') {
    if ('r' in v) return [v.r, v.g, v.b, v.a ?? 0].slice(0, n);
    return [v.x ?? 0, v.y ?? 0, v.z ?? 0, v.w ?? 0].slice(0, n);
  }
  return Array(n).fill(0);
}

// ------------------------------------------------------------------ small vector algebra

const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = a => Math.hypot(a[0], a[1], a[2]);
const vnorm = a => { const l = vlen(a); return l > 0 ? vmul(a, 1 / l) : a.slice(); };
const toV3 = v => v ? [v.x ?? v[0] ?? 0, v.y ?? v[1] ?? 0, v.z ?? v[2] ?? 0] : [0, 0, 0];

// CVector3::RotateAroundVectorByAngle
function rotAround(v, axis, angle) {
  let out = vmul(v, Math.cos(angle));
  out = vadd(out, vmul(vcross(axis, v), Math.sin(angle)));
  out = vadd(out, vmul(axis, vdot(axis, v) * (1 - Math.cos(angle))));
  return out;
}

// 3x3 matrices as row arrays; mul(a, b) = a * b
const ident3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function mul3(a, b) {
  const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    o[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  }
  return o;
}
const transpose3 = m => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
// CRotationMatrix::RotateX/Y/Z (matrix = matrix * rot); identical to RotateX/Y/Z in opencl_algebra.h
function rotX(m, a) { if (a === 0) return m; const s = Math.sin(a), c = Math.cos(a); return mul3(m, [[1, 0, 0], [0, c, -s], [0, s, c]]); }
function rotY(m, a) { if (a === 0) return m; const s = Math.sin(a), c = Math.cos(a); return mul3(m, [[c, 0, s], [0, 1, 0], [-s, 0, c]]); }
function rotZ(m, a) { if (a === 0) return m; const s = Math.sin(a), c = Math.cos(a); return mul3(m, [[c, -s, 0], [s, c, 0], [0, 0, 1]]); }
// CRotationMatrix::SetRotation / SetRotation2 / SetRotation3 / SetRotation4
const setRotation = r => rotY(rotX(rotZ(ident3(), r[0]), r[1]), r[2]);
const setRotation2 = r => rotX(rotY(rotZ(ident3(), r[2]), r[1]), r[0]);
const setRotation3 = r => rotX(rotY(rotZ(ident3(), r[0]), r[1]), r[2]);
const setRotation4 = r => rotZ(rotY(rotX(ident3(), r[0]), r[1]), r[2]);
const mulV3 = (m, v) => [vdot(m[0], v), vdot(m[1], v), vdot(m[2], v)];

// CRotationMatrix44 (4D rotations): matrix = matrix * rot
function ident4() { return [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]; }
function mul4(a, b) {
  const o = ident4().map(r => r.map(() => 0));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[i][k] * b[k][j];
    o[i][j] = s;
  }
  return o;
}
// rot[p][q] = sq * sin, rot[q][p] = -sq * sin, as CRotationMatrix44::RotateXW / YW / XZ
function rot4plane(m, angle, p, q, sq) {
  if (angle === 0) return m;
  const r = ident4(), s = Math.sin(angle), c = Math.cos(angle);
  r[p][p] = c; r[q][q] = c; r[p][q] = sq * s; r[q][p] = -sq * s;
  return mul4(m, r);
}
// SetRotation44b: Null, RotateXW, RotateYW, RotateXZ (src/algebra.cpp). SetRotation44a runs
// first upstream, but SetRotation44b starts with Null(), so only 44b reaches the struct.
const setRotation44b = r => rot4plane(rot4plane(rot4plane(ident4(), r[0], 0, 3, 1), r[1], 1, 3, -1), r[2], 0, 2, -1);

// ------------------------------------------------------------------ scene values

// Fallbacks for main params that params.json might not hold (upstream defaults).
const MAIN_FALLBACK = {
  camera: { x: 3, y: -6, z: 2 }, target: { x: 0, y: 0, z: 0 },
  camera_top: { x: -0.1277753, y: 0.2555506, z: 0.958314 }, fov: 53.13, perspective_type: 0,
  N: 250, minN: 1, detail_level: 1, DE_thresh: 0.01, DE_factor: 1, smoothness: 1,
  view_distance_max: 50, view_distance_min: 1e-15, max_raymarching_steps: 10000,
  bailout: 100, use_default_bailout: true, repeat_from: 1, hybrid_fractal_enable: false,
  delta_DE_function: 0, delta_DE_method: 0, julia_mode: false, julia_c: { x: 0, y: 0, z: 0 },
  fractal_constant_factor: { x: 1, y: 1, z: 1 }, initial_waxis: 0,
  brightness: 1, contrast: 1, gamma: 1, saturation: 1, hdr: false,
  glow_enabled: true, glow_intensity: 0.2, background_3_colors_enable: true,
  background_brightness: 1, background_gamma: 1,
  ambient_occlusion: 1, ambient_occlusion_quality: 4, ambient_occlusion_fast_tune: 1,
  ambient_occlusion_enabled: false, ambient_occlusion_mode: 2,
  volumetric_light_DE_Factor: 1, shadows_enabled: true,
};

// value of a main param: scene, then params.json main, then light/material templates
export function sceneValue(scene, P, name) {
  const m = scene.main || {};
  if (m[name] !== undefined) return m[name];
  const d = P?.main?.[name];
  if (d && d.default !== undefined) return d.default;
  const t = name.match(/^(light|mat)(\d+)_(.+)$/);
  if (t && P?.templates) {
    const tpl = t[1] === 'light' ? P.templates.light : P.templates.material;
    const spec = tpl?.params?.[t[3]];
    if (spec) {
      if (spec.defaultById && spec.defaultById[t[2]] !== undefined) return spec.defaultById[t[2]];
      return spec.default;
    }
  }
  return MAIN_FALLBACK[name];
}

// value of a fractal param for slot k (0-based)
function fractalValue(scene, P, k, name) {
  const f = scene.fractal?.[k] || {};
  if (f[name] !== undefined) return f[name];
  return P?.fractal?.[name]?.default;
}

// value of a per-slot general param: main "<name>_<k>" (legacy), then fractal[k-1][name]
function slotValue(scene, P, k, name) {
  const key = `${name}_${k}`;
  if (scene.main && scene.main[key] !== undefined) return scene.main[key];
  const f = scene.fractal?.[k - 1];
  if (f && f[name] !== undefined) return f[name];
  const d = P?.main?.[key];
  if (d && d.default !== undefined) return d.default;
  const defaults = { formula: k === 1 ? 2 : 0, formula_iterations: 1, formula_weight: 1,
    formula_start_iteration: 0, formula_stop_iteration: 250, dont_add_c_constant: false,
    check_for_bailout: true, formula_maxiter: 250 };
  return defaults[name];
}

const num = (x, d = 0) => (x === undefined || x === null || Number.isNaN(+x)) ? d : +x;
const bool = x => x === true || x === 1 || x === 'true';
const rgb = c => c ? [c.r ?? c.x ?? 0, c.g ?? c.y ?? 0, c.b ?? c.z ?? 0] : [0, 0, 0];

// ------------------------------------------------------------------ Fractal struct values

// Build { normPath: value } for one slot from params.json paths plus derived fields.
export function fractalValues(scene, P, k, formulaEnumId, slotParams) {
  const vals = {};
  for (const [name, spec] of Object.entries(P.fractal || {})) {
    if (!spec.path) continue;
    let v = fractalValue(scene, P, k, name);
    if (spec.type === 'vect3') v = toV3(v);
    else if (spec.type === 'vect4') v = v ? [v.x ?? 0, v.y ?? 0, v.z ?? 0, v.w ?? 0] : [0, 0, 0, 0];
    else if (spec.type === 'rgb') v = rgb(v);
    else if (spec.type === 'bool') v = bool(v);
    else if (spec.type === 'string') continue;
    else v = num(v);
    vals[normPath(spec.path)] = v;
  }
  // per-slot general params held in sFractalCl
  vals['formula'] = formulaEnumId;
  if (slotParams) {
    vals['formulaIterations'] = slotParams.formulaIterations;
    vals['formulaWeight'] = slotParams.formulaWeight;
    vals['formulaStartIteration'] = slotParams.formulaStartIteration;
    vals['formulaStopIteration'] = slotParams.formulaStopIteration;
    vals['dontAddCConstant'] = slotParams.dontAddCConstant;
    vals['checkForBailout'] = slotParams.checkForBailout;
  }
  recalculateFractalParams(vals);
  return vals;
}

// sFractal::RecalculateFractalParams (src/fractal.cpp) plus the IFS direction normalisation
// of the sFractal constructor. Reads and writes normalised paths.
export function recalculateFractalParams(v) {
  const g = (p, d = 0) => v[p] ?? d;
  const g3 = p => { const x = v[p]; return Array.isArray(x) ? x.slice(0, 3) : [0, 0, 0]; };
  const s3 = (p, a) => { v[p] = a; };
  const sc = (a, s) => a.map(x => x * s);

  // IFS
  for (let i = 0; i < 9; i++) {
    const dp = `IFS.direction.${i}`;
    if (v[dp]) { const n = vnorm(v[dp].slice(0, 3)); v[dp] = [n[0], n[1], n[2], 0]; }
  }
  v['IFS.mainRot'] = setRotation3(sc(g3('IFS.rotation'), M_PI_180));
  for (let i = 0; i < 9; i++) v[`IFS.rot.${i}`] = setRotation3(sc(g3(`IFS.rotations.${i}`), M_PI_180));

  // mandelbox
  v['mandelbox.mainRot'] = setRotation2(sc(g3('mandelbox.rotationMain'), M_PI_180));
  for (let fold = 0; fold < 2; fold++) {
    for (let axis = 0; axis < 3; axis++) {
      const r = setRotation2(sc(g3(`mandelbox.rotation.${fold}.${axis}`), M_PI_180));
      v[`mandelbox.rot.${fold}.${axis}`] = r;
      v[`mandelbox.rotinv.${fold}.${axis}`] = transpose3(r);
    }
  }
  v['mandelbox.fR2'] = g('mandelbox.foldingSphericalFixed') ** 2;
  v['mandelbox.mR2'] = g('mandelbox.foldingSphericalMin') ** 2;
  v['mandelbox.mboxFactor1'] = v['mandelbox.fR2'] / v['mandelbox.mR2'];

  v['bulb.alphaAngleOffset'] = g('bulb.alphaAngleOffset') * M_PI_180;
  v['bulb.betaAngleOffset'] = g('bulb.betaAngleOffset') * M_PI_180;
  const tc = 'transformCommon.';
  v[tc + 'alphaAngleOffset'] = g(tc + 'alphaAngleOffset') * M_PI_180;
  v[tc + 'betaAngleOffset'] = g(tc + 'betaAngleOffset') * M_PI_180;
  v[tc + 'angleDegA'] = g(tc + 'angleDegA') * M_PI_180;
  v[tc + 'angleDegB'] = g(tc + 'angleDegB') * M_PI_180;
  v[tc + 'angleDegC'] = g(tc + 'angleDegC') * M_PI_180;
  v[tc + 'cosA'] = Math.cos(v[tc + 'angleDegA']);
  v[tc + 'cosB'] = Math.cos(v[tc + 'angleDegB']);
  v[tc + 'cosC'] = Math.cos(v[tc + 'angleDegC']);
  v[tc + 'sinA'] = Math.sin(v[tc + 'angleDegA']);
  v[tc + 'sinB'] = Math.sin(v[tc + 'angleDegB']);
  v[tc + 'sinC'] = Math.sin(v[tc + 'angleDegC']);

  v[tc + 'rotationMatrix44'] = setRotation44b(sc(g3(tc + 'rotation44b'), M_PI_180));

  v[tc + 'rotationMatrix'] = setRotation2(sc(g3(tc + 'rotation'), M_PI_180));
  v[tc + 'rotationMatrix2'] = setRotation2(sc(g3(tc + 'rotation2'), M_PI_180));
  v[tc + 'rotationMatrixXYZ'] = setRotation4(sc(g3(tc + 'rotationXYZ'), M_PI_180));
  v[tc + 'rotationMatrix2XYZ'] = setRotation4(sc(g3(tc + 'rotation2XYZ'), M_PI_180));
  v[tc + 'rotationMatrixVary'] = setRotation2(sc(g3(tc + 'rotationVary'), M_PI_180));
  v[tc + 'sqtR'] = Math.sqrt(g(tc + 'minR05'));
  v[tc + 'mboxFactor1'] = 1.0 / v[tc + 'sqtR'];
  v[tc + 'inv0'] = 1.0 / g(tc + 'invert0');
  v[tc + 'inv1'] = 1.0 / g(tc + 'invert1');
  v[tc + 'maxMinR2factor'] = g(tc + 'maxR2d1') / g(tc + 'minR2p25');
  v[tc + 'maxMinR0factor'] = g(tc + 'maxR2d1') / g(tc + 'minR0');

  // Generalized Fold Box pre calculated vectors
  const gf = 'genFoldBox.';
  const sqrt_i3 = 1.0 / Math.sqrt(3.0);
  const put = (name, list) => { list.forEach((p, i) => { v[`${gf}${name}.${i}`] = p; }); };
  const s = sqrt_i3;
  const tet = [[s, s, -s], [s, -s, s], [-s, s, s], [-s, -s, -s]];
  const cube = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const oct = [...tet, [s, s, s], [-s, -s, s], [-s, s, -s], [s, -s, -s]];
  put('Nv_tet', tet); v[gf + 'sides_tet'] = 4;
  put('Nv_cube', cube); v[gf + 'sides_cube'] = 6;
  put('Nv_oct', oct); v[gf + 'sides_oct'] = 8;
  put('Nv_oct_cube', [...oct, ...cube]); v[gf + 'sides_oct_cube'] = 14;
  const aa = (1.0 + Math.sqrt(5.0)) / 2.0;
  const bb = 1.0 / Math.sqrt(aa * aa + 1.0);
  put('Nv_dodeca', [[0, bb, aa * bb], [0, bb, -aa * bb], [0, -bb, aa * bb], [0, -bb, -aa * bb],
    [bb, aa * bb, 0], [bb, -aa * bb, 0], [-bb, aa * bb, 0], [-bb, -aa * bb, 0],
    [aa * bb, 0, bb], [-aa * bb, 0, bb], [aa * bb, 0, -bb], [-aa * bb, 0, -bb]]);
  v[gf + 'sides_dodeca'] = 12;
  const ff = Math.sqrt(aa * aa + 1.0 / (aa * aa));
  const cc = aa / ff;
  const dd = 1.0 / aa / ff;
  put('Nv_icosa', [...oct, [0, dd, cc], [0, dd, -cc], [0, -dd, cc], [0, -dd, -cc],
    [cc, 0, dd], [cc, 0, -dd], [-cc, 0, dd], [-cc, 0, -dd],
    [dd, cc, 0], [dd, -cc, 0], [-dd, cc, 0], [-dd, -cc, 0]]);
  v[gf + 'sides_icosa'] = 20;
  const tha = PI * 2.0 / 6.0;
  const box6 = [[0, 0, 1], [0, 0, -1]];
  for (let i = 0; i < 6; i++) box6.push([Math.cos(tha * i), Math.sin(tha * i), 0]);
  put('Nv_box6', box6); v[gf + 'sides_box6'] = 8;
  const tha5 = PI * 2.0 / 5.0;
  const box5 = [[0, 0, 1], [0, 0, -1]];
  for (let i = 0; i < 5; i++) box5.push([Math.cos(tha5 * i), Math.sin(tha5 * i), 0]);
  put('Nv_box5', box5); v[gf + 'sides_box5'] = 7;
  return v;
}

// Pack all slots into one ArrayBuffer (array<Fractal>). Returns { buffer, missing }.
export function buildFractalBuffer(scene, P, layout, slotsInfo) {
  const stride = roundUp(layout.align, layout.size);
  const count = slotsInfo.length;
  const buffer = new ArrayBuffer(Math.max(stride * count, 16));
  const view = new DataView(buffer);
  const missing = new Set();
  for (let k = 0; k < count; k++) {
    const vals = fractalValues(scene, P, k, slotsInfo[k].formulaId, slotsInfo[k]);
    packValues(layout, vals, view, k * stride, missing);
  }
  return { buffer, missing };
}

// ------------------------------------------------------------------ hybrid sequence

const DE_TYPE = { analyticDEType: 0, deltaDEType: 1 };
const DE_FUNCTION = { undefinedDEFunction: -1, preferredDEFunction: 0, linearDEFunction: 1,
  logarithmicDEFunction: 2, pseudoKleinianDEFunction: 3, josKleinianDEFunction: 4,
  customDEFunction: 5, maxAxisDEFunction: 6, withoutDEFunction: 99 };
const ANALYTIC = { analyticFunctionUndefined: -1, analyticFunctionNone: 0, analyticFunctionLinear: 1,
  analyticFunctionLogarithmic: 2, analyticFunctionIFS: 3, analyticFunctionPseudoKleinian: 4,
  analyticFunctionJosKleinian: 5, analyticFunctionCustomDE: 6, analyticFunctionMaxAxis: 7 };
// C++ enumColoringFunction (Donut = 4); upstream casts it to the OpenCL enum unchanged
const COLORING = { coloringFunctionUndefined: -1, coloringFunctionDefault: 0, coloringFunctionABox: 1,
  coloringFunctionIFS: 2, coloringFunctionAmazingSurf: 3, coloringFunctionDonut: 4 };
const CPIXEL = { cpixelUndefined: -1, cpixelEnabledByDefault: 0, cpixelDisabledByDefault: 1, cpixelAlreadyHas: 2 };

const enumOf = (table, s, d) => (typeof s === 'number' ? s : (table[s] ?? d));

// formula enumId (or internal name) -> catalog entry
export function catalogLookup(catalog) {
  const byEnum = new Map(), byId = new Map();
  for (const f of catalog?.formulas || []) {
    byEnum.set(+f.enumId, f);
    byId.set(f.id, f);
    if (f.file) byId.set(f.file, f);
  }
  return v => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number' || /^\d+$/.test(String(v))) return byEnum.get(+v) || null;
    return byId.get(String(v)) || null;
  };
}

// cHybridFractalSequences::CollectSequenceData + CreateSequence for the legacy nine-slot scene
export function buildSequence(scene, P, lookup) {
  const hybrid = bool(sceneValue(scene, P, 'hybrid_fractal_enable'));
  const nSlots = hybrid ? 9 : 1;
  const useDefaultBailout = bool(sceneValue(scene, P, 'use_default_bailout'));
  const commonBailout = num(sceneValue(scene, P, 'bailout'), 100);

  const slots = [];
  let maxBailout = 0;
  for (let k = 1; k <= nSlots; k++) {
    const fid = num(slotValue(scene, P, k, 'formula'), 0);
    const cat = fid ? lookup(fid) : null;
    // fractal_enable_<k> false turns a hybrid slot off (settings.cpp node migration sets the
    // node's enabled flag to false); an off slot is skipped like an empty one
    const enabled = !hybrid || slotValue(scene, P, k, 'fractal_enable') === undefined
      || bool(slotValue(scene, P, k, 'fractal_enable'));
    const isNone = !cat || fid === 0 || cat.id === 'none' || !enabled;
    const sd = {
      slot: k - 1,
      formulaId: isNone ? 0 : fid,
      formula: isNone ? null : cat,
      formulaIterations: num(slotValue(scene, P, k, 'formula_iterations'), 1),
      formulaWeight: num(slotValue(scene, P, k, 'formula_weight'), 1),
      formulaStartIteration: num(slotValue(scene, P, k, 'formula_start_iteration'), 0),
      formulaStopIteration: num(slotValue(scene, P, k, 'formula_stop_iteration'), 250),
      checkForBailout: bool(slotValue(scene, P, k, 'check_for_bailout')),
      dontAddCConstant: bool(slotValue(scene, P, k, 'dont_add_c_constant')),
      addCConstant: false,
      bailout: commonBailout,
      useAdditionalBailoutCond: false,
    };
    if (!hybrid) sd.checkForBailout = true;
    const cpixel = enumOf(CPIXEL, cat?.cpixel, 0);
    if (cpixel === 2) sd.addCConstant = false;
    else {
      sd.addCConstant = !sd.dontAddCConstant;
      if (cpixel === 1) sd.addCConstant = !sd.addCConstant;
    }
    const defBailout = num(cat?.bailout, 100);
    if (useDefaultBailout) {
      if (hybrid) { if (!isNone) maxBailout = Math.max(maxBailout, defBailout); } else sd.bailout = defBailout;
    }
    const def = enumOf(DE_FUNCTION, cat?.deFunction, 99);
    if (def === 3 || def === 4) sd.useAdditionalBailoutCond = true;
    slots.push(sd);
  }
  if (hybrid && useDefaultBailout) for (const sd of slots) sd.bailout = maxBailout || 100;

  const seq = {
    isHybrid: hybrid,
    juliaEnabled: bool(sceneValue(scene, P, 'julia_mode')),
    juliaConstant: toV3(sceneValue(scene, P, 'julia_c')),
    constantMultiplier: toV3(sceneValue(scene, P, 'fractal_constant_factor')),
    initialWAxis: num(sceneValue(scene, P, 'initial_waxis'), 0),
    formulaMaxiter: Math.max(1, num(sceneValue(scene, P, 'N'), 250)),
  };

  // generating the sequence
  const repeatFrom = num(sceneValue(scene, P, 'repeat_from'), 1);
  const repeatFromIndex = Math.max(0, Math.min(repeatFrom - 1, slots.length - 1));
  let length = seq.formulaMaxiter;
  const arr = new Int32Array(length);
  let fractalNo = 0, counter = 0, rapidEnd = false, lastIndex = 0;
  for (let i = 0; i < length; i++) {
    counter++;
    let searchRepeatCount = 0;
    while ((slots[fractalNo].formula === null
      || ((i < slots[fractalNo].formulaStartIteration || i > slots[fractalNo].formulaStopIteration) && hybrid))
      && searchRepeatCount < slots.length) {
      fractalNo++;
      if (fractalNo >= slots.length) fractalNo = repeatFromIndex;
      searchRepeatCount++;
    }
    if (searchRepeatCount >= slots.length) { rapidEnd = true; break; }
    arr[i] = fractalNo;
    lastIndex = i;
    if (counter >= slots[fractalNo].formulaIterations) {
      counter = 0;
      fractalNo++;
      if (fractalNo >= slots.length) fractalNo = repeatFromIndex;
    }
  }
  if (rapidEnd) length = lastIndex + 1;
  seq.length = length;
  seq.array = arr.slice(0, Math.max(1, length));

  // DE type and function
  const deltaDEMethod = num(sceneValue(scene, P, 'delta_DE_method'), 0);
  const deltaDEFunction = num(sceneValue(scene, P, 'delta_DE_function'), 0);
  let forceDeltaDE = deltaDEMethod === 1;
  const forceAnalyticDE = deltaDEMethod === 2;
  const used = slots.filter(s => s.formula);
  if (hybrid) {
    seq.DEType = 0;
    seq.DEFunctionType = 1;
    seq.DEAnalyticFunction = 1;
    if (deltaDEFunction === 0) {
      const count = [0, 0, 0, 0, 0, 0, 0];
      for (const s of used) {
        const f = enumOf(DE_FUNCTION, s.formula.deFunction, 99);
        if (f >= 1 && f <= 6) count[f] += s.formulaIterations;
        if (!forceDeltaDE && !forceAnalyticDE && enumOf(DE_TYPE, s.formula.deType, 0) === 1) {
          seq.DEType = 1;
          forceDeltaDE = true;
        }
      }
      if (count[5] > 0) seq.DEFunctionType = 5;
      else {
        let maxCount = -1;
        for (let i = 1; i <= 6; i++) if (count[i] > maxCount) { maxCount = count[i]; seq.DEFunctionType = i; }
      }
    } else {
      seq.DEFunctionType = deltaDEFunction;
      for (const s of used) if (enumOf(DE_TYPE, s.formula.deType, 0) === 1) { seq.DEType = 1; break; }
    }
    if (forceDeltaDE) seq.DEType = 1;
    if (forceAnalyticDE) seq.DEType = 0;
    seq.coloringFunction = -1;
  } else {
    const f = used[0]?.formula;
    seq.DEType = enumOf(DE_TYPE, f?.deType, 0);
    seq.DEFunctionType = enumOf(DE_FUNCTION, f?.deFunction, 99);
    seq.DEAnalyticFunction = enumOf(ANALYTIC, f?.analytic, -1);
    if (forceDeltaDE) seq.DEType = 1;
    if (forceAnalyticDE) seq.DEType = 0;
    if (deltaDEFunction !== 0) {
      seq.DEFunctionType = deltaDEFunction;
      seq.DEAnalyticFunction = { 2: 2, 1: 1, 3: 4, 4: 5, 5: 6, 6: 7 }[deltaDEFunction] ?? 1;
    }
    seq.coloringFunction = enumOf(COLORING, f?.coloring, 0);
  }
  seq.iterationWeight = slots.some(s => s.formula && s.formulaWeight !== 1.0);
  return { slots, seq };
}

// Sorted formula file stems used by the active slots (the pipeline cache key).
export function formulaSetForScene(scene, P, lookup) {
  const { slots } = buildSequence(scene, P, lookup);
  const set = new Set();
  for (const s of slots) if (s.formula) set.add(s.formula.file || s.formula.id);
  return [...set].sort();
}

// ------------------------------------------------------------------ camera, lights, material

// cCameraTarget::SetCameraTargetTop
export function cameraTarget(camera, target, top) {
  let forward = camera[0] === target[0] && camera[1] === target[1] && camera[2] === target[2]
    ? [0, 1, 0] : vsub(target, camera);
  forward = vnorm(forward);
  const correct = a => ((a + 3 * PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI;
  let yaw = Math.atan2(forward[1], forward[0]) - 0.5 * PI;
  let pitch = Math.atan2(forward[2], Math.hypot(forward[0], forward[1]));
  let t = vnorm(top);
  t = rotAround(t, [0, 0, 1], -yaw);
  t = rotAround(t, [1, 0, 0], -pitch);
  let roll = -Math.atan2(t[2], t[0]) + 0.5 * PI;
  yaw = correct(yaw); pitch = correct(pitch); roll = correct(roll);
  let topVector = [0, 0, 1];
  topVector = rotAround(topVector, [0, 1, 0], roll);
  topVector = rotAround(topVector, [1, 0, 0], pitch);
  topVector = rotAround(topVector, [0, 0, 1], yaw);
  const right = vcross(forward, topVector);
  return { forward, top: topVector, right, yaw, pitch, roll };
}

// CalcFOV (src/projection_3d.cpp)
function calcFOV(deg, persp) {
  return persp === 0 ? 2.0 * Math.tan(deg / 360.0 * PI) : deg / 180.0 * PI;
}

// cLight::setParameters -> LightCl values
export function lightFromScene(scene, P, id, cam) {
  const L = n => sceneValue(scene, P, `light${id}_${n}`);
  const type = num(L('type'), id === 1 ? 0 : 1);
  const allI = num(sceneValue(scene, P, 'all_lights_intensity'), 1);
  const allV = num(sceneValue(scene, P, 'all_lights_visibility'), 1);
  const allS = num(sceneValue(scene, P, 'all_lights_size'), 1);
  const coneAngle = num(L('cone_angle'), 10) / 180 * PI;
  const coneSoftAngle = num(L('cone_soft_angle'), 1) / 180 * PI;
  let rotation = vmul(toV3(L('rotation')), 1 / 180.8 * PI); // 180.8 as upstream
  rotation = type === 0 ? [rotation[0], -rotation[1], rotation[2]] : [-rotation[0], rotation[1], rotation[2]];
  const rotMatrix = setRotation(rotation);
  const useTarget = bool(L('use_target_point'));
  let position, target, lightDirection;
  if (bool(L('relative_position'))) {
    const dp = toV3(L('position'));
    position = vadd(cam.camera, vadd(vadd(vmul(cam.forward, dp[2]), vmul(cam.top, dp[1])), vmul(cam.right, dp[0])));
    const dt = toV3(L('target'));
    target = vadd(cam.camera, vadd(vadd(vmul(cam.forward, dt[2]), vmul(cam.top, dt[1])), vmul(cam.right, dt[0])));
    if (useTarget) {
      lightDirection = vsub(position, target);
      lightDirection = vlen(lightDirection) > 0 ? vnorm(lightDirection) : vmul(cam.forward, -1);
    } else {
      lightDirection = vmul(cam.forward, -1);
      lightDirection = rotAround(lightDirection, cam.forward, rotation[2]);
      lightDirection = rotAround(lightDirection, cam.right, rotation[1]);
      lightDirection = rotAround(lightDirection, cam.top, rotation[0]);
    }
  } else {
    position = toV3(L('position'));
    target = toV3(L('target'));
    if (useTarget) {
      lightDirection = vsub(position, target);
      lightDirection = vlen(lightDirection) > 0 ? vnorm(lightDirection) : [1, 0, 0];
    } else {
      lightDirection = mulV3(rotMatrix, [0, -1, 0]);
    }
  }
  return {
    color: rgb(L('color') ?? { r: 1, g: 1, b: 1 }),
    intensity: num(L('intensity'), 1) * allI,
    position, targetPos: target, lightDirection,
    size: num(L('size'), 0.5) * allS,
    visibility: num(L('visibility'), 1) * allV,
    softShadowCone: num(L('soft_shadow_cone'), 1) / 180 * PI,
    contourSharpness: num(L('contour_sharpness'), 1),
    coneRatio: Math.sin(coneAngle),
    coneSoftRatio: Math.sin(coneSoftAngle + coneAngle),
    volumetricVisibility: num(L('volumetric_visibility'), 1),
    enabled: bool(L('enabled')) ? 1 : 0,
    castShadows: bool(L('cast_shadows')) ? 1 : 0,
    penetrating: bool(L('penetrating')) ? 1 : 0,
    volumetric: bool(L('volumetric')) ? 1 : 0,
    ltype: type,
    decayFunction: num(L('decayFunction'), 1),
  };
}

// cColorGradient::SetColorsFromString + GetListOfSortedColors -> [[r, g, b, pos], ...]
export function parseGradient(str) {
  const split = String(str || '').trim().split(/\s+/).filter(Boolean);
  const colors = [];
  if (split.length < 2) return [[1, 1, 1, 0], [1, 1, 1, 1]];
  let position = 0;
  for (let i = 0; i < split.length; i++) {
    if (i % 2 === 0) position = parseInt(split[i], 10) / 10000.0;
    else {
      const hex = parseInt(split[i], 16) || 0;
      const c = [Math.floor(hex / 65536) / 256.0, (Math.floor(hex / 256) % 256) / 256.0, (hex % 256) / 256.0];
      colors.push([c[0], c[1], c[2], Math.min(1, Math.max(0, position))]);
      if (i === 1) colors.push([c[0], c[1], c[2], 1.0]);
    }
  }
  colors.sort((a, b) => a[3] - b[3]);
  return colors;
}

// material scene values for material id (fractal_coloring + shading subset)
function materialValues(scene, P, id, palette) {
  const Mv = n => sceneValue(scene, P, `mat${id}_${n}`);
  const fc = n => Mv(`fractal_coloring_${n}`);
  // defaults come from gen/params.json (templates.material); an empty string parses to white
  const pushGradient = name => {
    const g = parseGradient(Mv(name));
    const offset = palette.length;
    for (const c of g) if (palette.length < 128) palette.push(c);
    return [offset, palette.length - offset];
  };
  const [so, sl] = pushGradient('surface_color_gradient');
  const [po, pl] = pushGradient('specular_gradient');
  const [dofs, dl] = pushGradient('diffuse_gradient');
  const [lo, ll] = pushGradient('luminosity_gradient');
  const b = x => bool(x) ? 1 : 0;
  const ld = Mv('fractal_coloring_line_direction') || { x: 1, y: 0, z: 0, w: 0 };
  return {
    fractalColoring: {
      lineDirection: [ld.x ?? 1, ld.y ?? 0, ld.z ?? 0, ld.w ?? 0],
      xyz000: toV3(fc('xyz_000')), xyzC111: toV3(fc('xyzC_111')),
      addMax: num(fc('add_max'), 1), addSpread: num(fc('add_spread'), 1), addStartValue: num(fc('add_start_value')),
      auxColorHybridWeight: num(fc('aux_color_hybrid_weight')), auxColorWeight: num(fc('aux_color_weight'), 1),
      cosAdd: num(fc('cos_add'), 1), cosPeriod: num(fc('cos_period'), 1), cosStartValue: num(fc('cos_start_value')),
      hybridAuxColorScale1: num(fc('aux_color_scale1'), 1), hybridOrbitTrapScale1: num(fc('orbit_trap_scale1'), 1),
      hybridRadDivDeScale1: num(fc('rad_div_de_scale1'), 1), icRadWeight: num(fc('ic_rad_weight'), 1),
      initialColorValue: num(fc('initial_color_value')), iterAddScale: num(fc('iter_add_scale'), 1),
      iterScale: num(fc('iter_scale'), 1), maxColorValue: num(fc('max_color_value'), 1e5),
      minColorValue: num(fc('min_color_value')), orbitTrapWeight: num(fc('orbit_trap_weight'), 1),
      parabScale: num(fc('parab_scale'), 1), parabStartValue: num(fc('parab_start_value')),
      radDivDeWeight: num(fc('rad_div_de_weight'), 1), radWeight: num(fc('rad_weight'), 1),
      roundScale: num(fc('round_scale'), 1), sphereRadius: num(fc('sphere_radius'), 1),
      xyzIterScale: num(fc('xyz_iter_scale')),
      addEnabledFalse: b(fc('add_enabled_false')), auxColorFalse: b(fc('aux_color_false')),
      color4dEnabledFalse: b(fc('color_4D_enabled_false')), colorPreV215False: b(fc('color_preV215_false')),
      cosEnabledFalse: b(fc('cos_enabled_false')), extraColorOptionsEnabledFalse: b(fc('extra_color_options_false')),
      extraColorEnabledFalse: b(fc('extra_color_enabled_false')), globalPaletteFalse: b(fc('global_palette_false')),
      icFabsFalse: b(fc('ic_fabs_enabled_false')), icRadFalse: b(fc('ic_rad_enabled_false')),
      icXYZFalse: b(fc('ic_xyz_enabled_false')), initCondFalse: b(fc('init_cond_enabled_false')),
      iterAddScaleTrue: b(fc('iter_add_scale_enabled_true') ?? fc('iter_add_scale_true')),
      iterGroupFalse: b(fc('iter_group_enabled_false')), iterScaleFalse: b(fc('iter_scale_enabled_false')),
      orbitTrapTrue: b(fc('orbit_trap_true')), parabEnabledFalse: b(fc('parab_enabled_false')),
      radDiv1e13False: b(fc('rad_div_1e13_false')), radDivDE1e13False: b(fc('rad_div_de_1e13_false')),
      radDivDeFalse: b(fc('rad_div_de_enabled_false')), radDivDeSquaredFalse: b(fc('rad_div_de_squared_false')),
      radFalse: b(fc('rad_enabled_false')), radSquaredFalse: b(fc('rad_squared_enabled_false')),
      roundEnabledFalse: b(fc('round_enabled_false')), xyzBiasEnabledFalse: b(fc('xyz_bias_enabled_false')),
      xyzDiv1e13False: b(fc('xyz_div_1e13_false')), xyzFabsFalse: b(fc('xyz_fabs_enabled_false')),
      xyzXSqrdFalse: b(fc('xyz_x_sqrd_enabled_false')), xyzYSqrdFalse: b(fc('xyz_y_sqrd_enabled_false')),
      xyzZSqrdFalse: b(fc('xyz_z_sqrd_enabled_false')), tempLimitFalse: b(fc('temp_limit_false')),
      iStartValue: num(fc('i_start_value')), coloringAlgorithm: num(fc('algorithm')),
    },
    color: rgb(Mv('surface_color')),
    shading: num(Mv('shading'), 1),
    specularColor: rgb(Mv('specular_color') ?? { r: 1, g: 1, b: 1 }),
    specular: num(Mv('specular'), 5),
    luminosityColor: rgb(Mv('luminosity_color') ?? { r: 1, g: 1, b: 1 }),
    luminosity: num(Mv('luminosity')),
    specularWidth: num(Mv('specular_width'), 0.05),
    specularMetallic: num(Mv('specular_metallic'), 1),
    specularMetallicRoughness: num(Mv('specular_metallic_roughness'), 0.01),
    specularMetallicWidth: num(Mv('specular_metallic_width'), 1),
    paletteOffset: num(Mv('coloring_palette_offset')),
    coloring_speed: num(Mv('coloring_speed'), 1),
    surfaceRoughness: num(Mv('surface_roughness'), 0.01),
    luminosityEmissive: num(Mv('luminosity_emissive')),
    useColorsFromPalette: b(Mv('use_colors_from_palette')),
    specularPlasticEnable: b(Mv('specular_plastic_enable')),
    metallic: b(Mv('metallic')),
    roughSurface: b(Mv('rough_surface')),
    surfaceGradientEnable: b(Mv('surface_gradient_enable')),
    specularGradientEnable: b(Mv('specular_gradient_enable')),
    diffuseGradientEnable: b(Mv('diffuse_gradient_enable')),
    luminosityGradientEnable: b(Mv('luminosity_gradient_enable')),
    paletteSurfaceOffset: so, paletteSurfaceLength: sl,
    paletteSpecularOffset: po, paletteSpecularLength: pl,
    paletteDiffuseOffset: dofs, paletteDiffuseLength: dl,
    paletteLuminosityOffset: lo, paletteLuminosityLength: ll,
  };
}

// flatten a nested plain object into { "a.b.0": leaf } for packValues
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? prefix + '.' + k : k;
    const isLeaf = v === null || typeof v !== 'object'
      || (Array.isArray(v) && (typeof v[0] === 'number' || (Array.isArray(v[0]) && v.length <= 4)));
    if (isLeaf) out[p] = v;
    else if (Array.isArray(v)) v.forEach((x, i) => {
      if (x && typeof x === 'object' && !Array.isArray(x)) flatten(x, p + '.' + i, out);
      else out[p + '.' + i] = x;
    });
    else flatten(v, p, out);
  }
  return out;
}

// sParamRender + sequence + lights + material -> RenderParams values (nested object)
export function buildRenderParams(scene, P, seqInfo, formulaCases, width, height) {
  const S = n => sceneValue(scene, P, n);
  const persp = num(S('perspective_type'), 0);
  const camera = toV3(S('camera'));
  const target = toV3(S('target'));
  const top = toV3(S('camera_top'));
  const ct = cameraTarget(camera, target, top);

  // main rotation matrix (full_engine.cl)
  let rot = ident3();
  rot = rotZ(rot, ct.yaw);
  rot = rotX(rot, ct.pitch);
  rot = rotY(rot, ct.roll);
  const sweetH = num(S('sweet_spot_horizontal_angle')) / 180 * PI;
  const sweetV = num(S('sweet_spot_vertical_angle')) / 180 * PI;
  rot = rotZ(rot, -sweetH);
  rot = rotX(rot, sweetV);

  const cam = { camera, forward: ct.forward, top: ct.top, right: ct.right };
  const lights = [];
  for (let id = 1; id <= 4; id++) {
    const defined = id === 1 || bool(S(`light${id}_is_defined`))
      || Object.keys(scene.main || {}).some(k => k.startsWith(`light${id}_`));
    if (!defined) continue;
    lights.push(lightFromScene(scene, P, id, cam));
  }
  const anyShadows = lights.some(l => l.enabled && l.castShadows);
  while (lights.length < 4) lights.push(lightFromScene({ main: {} }, P, 9, cam));

  const palette = [];
  const material = materialValues(scene, P, 1, palette);
  while (palette.length < 128) palette.push([0, 0, 0, 0]);

  const { slots, seq } = seqInfo;
  const slotArr = [];
  for (let k = 0; k < 9; k++) {
    const s = slots[k];
    slotArr.push(s ? {
      formulaCase: s.formula ? formulaCases.get(s.formula.file || s.formula.id) ?? -1 : -1,
      formulaId: s.formulaId, formulaWeight: s.formulaWeight, bailout: s.bailout,
      addCConstant: s.addCConstant ? 1 : 0, checkForBailout: s.checkForBailout ? 1 : 0,
      useAdditionalBailoutCond: s.useAdditionalBailoutCond ? 1 : 0, pad0: 0,
    } : { formulaCase: -1, formulaId: 0, formulaWeight: 1, bailout: 100, addCConstant: 0,
      checkForBailout: 1, useAdditionalBailoutCond: 0, pad0: 0 });
  }

  const fogEnabled = bool(S('basic_fog_enabled'));
  const volFogEnabled = bool(S('volumetric_fog_enabled')) && num(S('volumetric_fog_density'), 0.5) > 0;
  const iterFogEnabled = bool(S('iteration_fog_enable'));
  const anyVolumetric = fogEnabled || volFogEnabled || iterFogEnabled;

  const fractalRotation = vmul(toV3(S('fractal_rotation')), PI / 180);
  const mRotFractal = setRotation2(fractalRotation);

  return {
    camera, fov: calcFOV(num(S('fov'), 53.13), persp), targetPoint: target, resolution: 1.0 / height,
    rotM1: rot[0], width, rotM2: rot[1], height, rotM3: rot[2], perspectiveType: persp,
    legacyCoordinateSystem: bool(S('legacy_coordinate_system')) ? 1 : 0,

    N: num(S('N'), 250), minN: num(S('minN'), 1),
    maxRaymarching: Math.min(num(S('max_raymarching_steps'), 10000), 20000),
    iterThreshMode: bool(S('iteration_threshold_mode')) ? 1 : 0,
    DEFactor: num(S('DE_factor'), 1), detailLevel: num(S('detail_level'), 1),
    DEThresh: num(S('DE_thresh'), 0.01), constantDEThreshold: bool(S('constant_DE_threshold')) ? 1 : 0,
    smoothness: num(S('smoothness'), 1), viewDistanceMax: num(S('view_distance_max'), 50),
    viewDistanceMin: num(S('view_distance_min'), 1e-15),
    deltaDERelativeDelta: num(S('deltade_relative_delta'), 0.01),
    advancedQuality: bool(S('advanced_quality')) ? 1 : 0,
    absMinMarchingStep: num(S('abs_min_marching_step'), 0), absMaxMarchingStep: num(S('abs_max_marching_step'), 1e6),
    relMinMarchingStep: num(S('rel_min_marching_step'), 0), relMaxMarchingStep: num(S('rel_max_marching_step'), 1e6),
    detailSizeMin: num(S('detail_size_min'), 0), detailSizeMax: num(S('detail_size_max'), 1e6),
    linearDEOffset: num(S('linear_DE_offset'), 0),
    limitsEnabled: bool(S('limits_enabled')) ? 1 : 0, interiorMode: bool(S('interior_mode')) ? 1 : 0,
    limitMin: toV3(S('limit_min')), limitMax: toV3(S('limit_max')),
    fractalPosition: toV3(S('fractal_position')), repeat: toV3(S('repeat')),
    mRotFractal1: mRotFractal[0], mRotFractal2: mRotFractal[1], mRotFractal3: mRotFractal[2],

    juliaConstant: seq.juliaConstant, initialWAxis: seq.initialWAxis,
    constantMultiplier: seq.constantMultiplier, formulaMaxiter: seq.formulaMaxiter,
    seqLength: seq.length, isHybrid: seq.isHybrid ? 1 : 0, juliaEnabled: seq.juliaEnabled ? 1 : 0,
    DEType: seq.DEType, DEFunctionType: seq.DEFunctionType, DEAnalyticFunction: seq.DEAnalyticFunction,
    coloringFunction: seq.coloringFunction, iterationWeight: seq.iterationWeight ? 1 : 0,
    slots: slotArr,

    ambientOcclusionEnabled: bool(S('ambient_occlusion_enabled')) ? 1 : 0,
    ambientOcclusionMode: num(S('ambient_occlusion_mode'), 2),
    ambientOcclusionQuality: num(S('ambient_occlusion_quality'), 4),
    ambientOcclusion: num(S('ambient_occlusion'), 1),
    ambientOcclusionColor: rgb(S('ambient_occlusion_color') ?? { r: 1, g: 1, b: 1 }),
    ambientOcclusionFastTune: num(S('ambient_occlusion_fast_tune'), 1),
    fillLightColor: rgb(S('fill_light_color')),
    numberOfLights: 4,

    background3ColorsEnable: bool(S('background_3_colors_enable')) ? 1 : 0,
    background_brightness: num(S('background_brightness'), 1), background_gamma: num(S('background_gamma'), 1),
    shadowsEnabled: anyShadows ? 1 : 0,
    background_color1: rgb(S('background_color_1')), background_color2: rgb(S('background_color_2')),
    background_color3: rgb(S('background_color_3')),

    glowEnabled: bool(S('glow_enabled')) ? 1 : 0, glowIntensity: num(S('glow_intensity'), 0.2),
    fogEnabled: fogEnabled ? 1 : 0, fogVisibility: num(S('basic_fog_visibility'), 20),
    glowColor1: rgb(S('glow_color_1')), fogCastShadows: fogEnabled && bool(S('basic_fog_cast_shadows')) ? 1 : 0,
    glowColor2: rgb(S('glow_color_2')), volFogEnabled: volFogEnabled ? 1 : 0,
    fogColor: rgb(S('basic_fog_color')), volFogDensity: num(S('volumetric_fog_density'), 0.5),
    volFogColour1: rgb(S('fog_color_1')), volFogDistanceFactor: num(S('volumetric_fog_distance_factor'), 1),
    volFogColour2: rgb(S('fog_color_2')), volFogDistanceFromSurface: num(S('volumetric_fog_distance_from_surface'), 0),
    volFogColour3: rgb(S('fog_color_3')), volFogColour1Distance: num(S('volumetric_fog_colour_1_distance'), 1),
    volFogColour2Distance: num(S('volumetric_fog_colour_2_distance'), 1),
    distanceFogShadows: volFogEnabled && bool(S('distance_fog_shadows')) ? 1 : 0,
    iterFogEnabled: iterFogEnabled ? 1 : 0, iterFogShadows: bool(S('iteration_fog_shadows')) ? 1 : 0,
    iterFogColour1: rgb(S('iteration_fog_color_1')), iterFogOpacity: num(S('iteration_fog_opacity'), 1000),
    iterFogColour2: rgb(S('iteration_fog_color_2')), iterFogOpacityTrim: num(S('iteration_fog_opacity_trim'), 4),
    iterFogColour3: rgb(S('iteration_fog_color_3')),
    iterFogOpacityTrimHigh: num(S('iteration_fog_opacity_trim_high'), 250),
    iterFogColor1Maxiter: num(S('iteration_fog_color_1_maxiter'), 8),
    iterFogColor2Maxiter: num(S('iteration_fog_color_2_maxiter'), 12),
    iterFogBrightnessBoost: num(S('iteration_fog_brightness_boost'), 1),
    volumetricLightDEFactor: num(S('volumetric_light_DE_Factor'), 1),
    simpleGlow: anyVolumetric ? 0 : 1,
    cloudsPeriod: num(S('clouds_period'), 1),

    lights, material, palette,
  };
}

// image adjustment values for present.wgsl
export function imageAdjustments(scene, P) {
  const S = n => sceneValue(scene, P, n);
  return {
    brightness: num(S('brightness'), 1), contrast: num(S('contrast'), 1),
    imageGamma: num(S('gamma'), 1) || 1, saturation: num(S('saturation'), 1),
    hdrEnabled: bool(S('hdr')) ? 1 : 0,
  };
}
