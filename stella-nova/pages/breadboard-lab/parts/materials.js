// ============================================================================
//  BREADBOARD LAB  ·  parts/materials.js — material specs, presets, builder
// ----------------------------------------------------------------------------
//  A MaterialSpec is plain data (CONTRACT 3.6). The document stores custom
//  specs; the presets below ship with the page. makeMaterial turns a spec
//  into one THREE.MeshPhysicalMaterial.
//
//  ONE MATERIAL PER LOOK. makeMaterial caches by a hash of the look fields
//  (not the id or the name), per THREE instance. Two specs that look the same
//  share one material, so 60 resistors cost one tin material. A part that
//  must glow (an LED lens) clones its material; it never edits a cached one.
//
//  PATTERNS ARE MADE IN CODE. Each surface pattern is a small tileable height
//  field. Its normal map comes from finite differences of the heights and
//  goes into a DataTexture, so it builds in node with no canvas.
//
//  GREP MAP
//    PATTERNS / heightFns ... none brushed knurl pcb grain bumps
//    MATERIAL_PRESETS ....... the shipped looks (gold-pin ... mat-teal)
//    presetById ............. lookup
//    validateMaterial ....... spec -> error strings
//    materialHash ........... the cache key
//    patternTexture ......... the normal map of one pattern (cached)
//    makeMaterial ........... spec -> MeshPhysicalMaterial (cached)
//    materialResolver ....... (id) => material, presets + custom specs
// ============================================================================

export const PATTERNS = ['none', 'brushed', 'knurl', 'pcb', 'grain', 'bumps'];

// ---------------------------------------------------------------- presets
const P = (id, name, color, roughness, metalness, more = {}) => ({ id, name, color, roughness, metalness, ...more });
export const MATERIAL_PRESETS = [
  P('gold-pin', 'Gold pin', '#d6b04a', 0.28, 1),
  P('tin', 'Tin lead', '#c9ccd1', 0.32, 1),
  P('copper', 'Copper', '#c98a4b', 0.3, 1),
  P('brass', 'Brass', '#b9973f', 0.35, 1, { pattern: 'brushed', patternScale: 2 }),
  P('chrome', 'Chrome', '#e6e8ec', 0.08, 1),
  P('aluminium', 'Brushed aluminium', '#b8bcc2', 0.38, 1, { pattern: 'brushed', patternScale: 3 }),
  P('steel-knurl', 'Knurled steel', '#a9adb3', 0.4, 1, { pattern: 'knurl', patternScale: 6 }),
  P('fr4-green', 'FR4 green', '#1f6b3a', 0.45, 0, { clearcoat: 0.6, clearcoatRoughness: 0.35, pattern: 'pcb', patternScale: 4 }),
  P('pcb-black', 'Matte black PCB', '#1b1d1f', 0.7, 0, { clearcoat: 0.25, clearcoatRoughness: 0.6, pattern: 'pcb', patternScale: 4 }),
  P('pcb-blue', 'Blue PCB', '#1f4f9a', 0.45, 0, { clearcoat: 0.6, clearcoatRoughness: 0.35, pattern: 'pcb', patternScale: 4 }),
  P('pcb-red', 'Red PCB', '#8c1f24', 0.45, 0, { clearcoat: 0.6, clearcoatRoughness: 0.35, pattern: 'pcb', patternScale: 4 }),
  P('pcb-purple', 'Purple PCB', '#4b2a6b', 0.45, 0, { clearcoat: 0.6, clearcoatRoughness: 0.35, pattern: 'pcb', patternScale: 4 }),
  P('epoxy-black', 'Black epoxy', '#17181a', 0.55, 0, { pattern: 'bumps', patternScale: 8 }),
  P('ceramic-tan', 'Ceramic tan', '#c9a46a', 0.6, 0, { pattern: 'bumps', patternScale: 6 }),
  P('ceramic-blue', 'Ceramic blue', '#3d63b8', 0.55, 0, { pattern: 'bumps', patternScale: 6 }),
  P('ceramic-yellow', 'Ceramic yellow', '#d8b43a', 0.55, 0, { pattern: 'bumps', patternScale: 6 }),
  P('glass', 'Glass', '#f2f6f8', 0.05, 0, { transmission: 0.95, ior: 1.5, thickness: 1, opacity: 1 }),
  P('led-red', 'Red LED epoxy', '#e0242a', 0.12, 0, { transmission: 0.55, ior: 1.5, thickness: 3, clearcoat: 1, clearcoatRoughness: 0.05 }),
  P('led-orange', 'Orange LED epoxy', '#f26a12', 0.12, 0, { transmission: 0.55, ior: 1.5, thickness: 3, clearcoat: 1, clearcoatRoughness: 0.05 }),
  P('led-yellow', 'Yellow LED epoxy', '#f2cf1d', 0.12, 0, { transmission: 0.55, ior: 1.5, thickness: 3, clearcoat: 1, clearcoatRoughness: 0.05 }),
  P('led-green', 'Green LED epoxy', '#2fc24a', 0.12, 0, { transmission: 0.55, ior: 1.5, thickness: 3, clearcoat: 1, clearcoatRoughness: 0.05 }),
  P('led-blue', 'Blue LED epoxy', '#2f6be8', 0.12, 0, { transmission: 0.55, ior: 1.5, thickness: 3, clearcoat: 1, clearcoatRoughness: 0.05 }),
  P('led-white', 'Water-clear epoxy', '#eef3f6', 0.08, 0, { transmission: 0.85, ior: 1.5, thickness: 3, clearcoat: 1, clearcoatRoughness: 0.05 }),
  P('led-ir', 'IR LED epoxy', '#3a2a4a', 0.15, 0, { transmission: 0.35, ior: 1.5, thickness: 3, clearcoat: 1, clearcoatRoughness: 0.05 }),
  P('led-diffuse', 'Diffused white epoxy', '#e8e6df', 0.45, 0, { transmission: 0.4, ior: 1.5, thickness: 3 }),
  P('abs-white', 'White ABS', '#ecebe6', 0.55, 0),
  P('abs-black', 'Black ABS', '#1e1f22', 0.5, 0),
  P('abs-grey', 'Grey ABS', '#6c6f75', 0.5, 0),
  P('abs-red', 'Red ABS', '#c9332c', 0.45, 0),
  P('abs-blue', 'Blue ABS', '#2d5fc4', 0.45, 0),
  P('abs-yellow', 'Yellow ABS', '#e5bd22', 0.45, 0),
  P('abs-green', 'Green ABS', '#3b9a4a', 0.45, 0),
  P('abs-dark', 'Instrument grey', '#2b2d33', 0.6, 0, { pattern: 'bumps', patternScale: 10 }),
  P('rubber', 'Rubber', '#232323', 0.9, 0, { pattern: 'bumps', patternScale: 12 }),
  P('rubber-yellow', 'Yellow rubber boot', '#e3b81f', 0.85, 0, { pattern: 'bumps', patternScale: 12 }),
  P('resistor-beige', 'Resistor beige', '#d8c49a', 0.5, 0, { clearcoat: 0.3, clearcoatRoughness: 0.5 }),
  P('resistor-blue', 'Resistor blue', '#5f9fd6', 0.45, 0, { clearcoat: 0.35, clearcoatRoughness: 0.5 }),
  P('sleeve-black', 'Capacitor sleeve black', '#1d1e24', 0.4, 0, { clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  P('sleeve-blue', 'Capacitor sleeve blue', '#1e3e8c', 0.4, 0, { clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  P('sleeve-stripe', 'Sleeve stripe', '#c9ccd4', 0.4, 0),
  P('board-white', 'Breadboard white', '#efede6', 0.62, 0, { pattern: 'bumps', patternScale: 16 }),
  P('board-hole', 'Breadboard hole', '#141414', 0.9, 0),
  P('rail-red', 'Rail red', '#d23a35', 0.6, 0),
  P('rail-blue', 'Rail blue', '#2e63c4', 0.6, 0),
  P('silk-white', 'Silkscreen white', '#f4f4f0', 0.7, 0),
  P('lcd-green', 'LCD yellow-green', '#9fbf3a', 0.3, 0, { clearcoat: 1, clearcoatRoughness: 0.1 }),
  P('lcd-blue', 'LCD blue', '#2a55d0', 0.3, 0, { clearcoat: 1, clearcoatRoughness: 0.1 }),
  P('screen-dark', 'Dark screen glass', '#0b0f10', 0.15, 0, { clearcoat: 1, clearcoatRoughness: 0.05 }),
  P('solar-cell', 'Solar cell', '#18264a', 0.25, 0.3, { clearcoat: 1, clearcoatRoughness: 0.08, pattern: 'pcb', patternScale: 3 }),
  P('ferrite', 'Ferrite', '#2a2826', 0.8, 0.1, { pattern: 'bumps', patternScale: 10 }),
  P('enamel-copper', 'Enamelled copper', '#b5652c', 0.25, 1, { pattern: 'brushed', patternScale: 8 }),
  P('wood', 'Wood', '#9b7046', 0.7, 0, { pattern: 'grain', patternScale: 1 }),
  P('mat-teal', 'Anti-static mat', '#2f4a46', 0.85, 0, { pattern: 'bumps', patternScale: 20 }),
  P('char', 'Charred', '#17110d', 0.95, 0, { pattern: 'bumps', patternScale: 9 }),
];
const PRESET_MAP = new Map(MATERIAL_PRESETS.map(p => [p.id, p]));
export const presetById = id => PRESET_MAP.get(id) || null;

// ---------------------------------------------------------------- validate
const HEX = /^#[0-9a-fA-F]{6}$/;
const RANGES = { roughness: [0, 1], metalness: [0, 1], clearcoat: [0, 1], clearcoatRoughness: [0, 1],
  transmission: [0, 1], ior: [1, 2.5], thickness: [0, 100], opacity: [0, 1], emissiveIntensity: [0, 10],
  patternScale: [0.01, 100] };
export function validateMaterial(spec) {
  const E = [];
  if (!spec || typeof spec !== 'object') return ['material is not an object'];
  const who = spec.id || '(no id)';
  if (typeof spec.id !== 'string' || !spec.id) E.push(`${who}: id missing`);
  if (typeof spec.name !== 'string') E.push(`${who}: name missing`);
  if (!HEX.test(spec.color || '')) E.push(`${who}: color must be #rrggbb`);
  for (const k of ['roughness', 'metalness']) if (typeof spec[k] !== 'number') E.push(`${who}: ${k} missing`);
  for (const k in RANGES) {
    if (spec[k] === undefined) continue;
    const v = spec[k], [lo, hi] = RANGES[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) E.push(`${who}: ${k} must be in ${lo}..${hi}`);
  }
  if (spec.emissive !== undefined && !HEX.test(spec.emissive)) E.push(`${who}: emissive must be #rrggbb`);
  if (spec.pattern !== undefined && !PATTERNS.includes(spec.pattern)) E.push(`${who}: unknown pattern ${spec.pattern}`);
  return E;
}

// ---------------------------------------------------------------- hash
const LOOK_KEYS = ['color', 'roughness', 'metalness', 'clearcoat', 'clearcoatRoughness', 'transmission',
  'ior', 'thickness', 'opacity', 'emissive', 'emissiveIntensity', 'pattern', 'patternScale'];
export function materialHash(spec) {
  return LOOK_KEYS.map(k => {
    const v = spec[k];
    return v === undefined ? '' : typeof v === 'number' ? +v.toFixed(4) : String(v).toLowerCase();
  }).join('|');
}

// ---------------------------------------------------------------- patterns
// Seeded lattice noise that wraps at `per` cells, so the map tiles.
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(u, v, per, seed) {
  const x = u * per, y = v * per;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = n => ((n % per) + per) % per;
  const a = hash2(w(x0), w(y0), seed), b = hash2(w(x0 + 1), w(y0), seed);
  const c = hash2(w(x0), w(y0 + 1), seed), d = hash2(w(x0 + 1), w(y0 + 1), seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}
const TAU = Math.PI * 2;
const heightFns = {
  // fine streaks along u: noise in v only, with a slow wobble in u
  brushed: (u, v) => 0.7 * vnoise(0.5, v, 96, 3) + 0.3 * vnoise(u, v, 8, 4) * 0.5 + 0.15 * vnoise(u * 0.25, v, 48, 5),
  // a diamond knurl: two crossed ridged gratings
  knurl: (u, v) => {
    const a = Math.abs(Math.sin(TAU * 6 * (u + v))), b = Math.abs(Math.sin(TAU * 6 * (u - v)));
    return Math.min(a, b);
  },
  // copper traces under solder mask: straight runs and pads on a coarse grid
  pcb: (u, v) => {
    const cell = 8, x = u * cell, y = v * cell;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const r = hash2(ix, iy, 11);
    let h = 0;
    if (r < 0.45 && Math.abs(fy - 0.5) < 0.07) h = 1;                    // a run along u
    else if (r > 0.6 && Math.abs(fx - 0.5) < 0.07) h = 1;                // a run along v
    if (r > 0.88) { const dx = fx - 0.5, dy = fy - 0.5; if (dx * dx + dy * dy < 0.04) h = 1; }   // a via pad
    return h * 0.8 + 0.2 * vnoise(u, v, 32, 12);
  },
  // wood: rings bent by low noise
  grain: (u, v) => 0.5 + 0.5 * Math.sin(TAU * (6 * v + 1.5 * vnoise(u, v, 4, 21) + 0.3 * vnoise(u, v, 16, 22))),
  // fine bumps: two octaves of noise
  bumps: (u, v) => 0.65 * vnoise(u, v, 24, 31) + 0.35 * vnoise(u, v, 48, 32),
};
const PAT_STRENGTH = { brushed: 0.35, knurl: 1.2, pcb: 0.6, grain: 0.25, bumps: 0.45 };

const perThree = new WeakMap();
function cacheFor(THREE) {
  let c = perThree.get(THREE);
  if (!c) { c = { mats: new Map(), pats: new Map() }; perThree.set(THREE, c); }
  return c;
}

export const PATTERN_SIZE = 128;
// Raw normal-map bytes (RGBA) of one pattern. Exported for tests.
export function patternBytes(pattern, size = PATTERN_SIZE) {
  const fn = heightFns[pattern];
  if (!fn) return null;
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = fn(x / size, y / size);
  const k = PAT_STRENGTH[pattern] * size / 16;
  const out = new Uint8Array(size * size * 4);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * k, dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * k;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    out[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
    out[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
    out[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    out[i + 3] = 255;
  }
  return out;
}
export function patternTexture(THREE, pattern) {
  if (!pattern || pattern === 'none' || !heightFns[pattern]) return null;
  const c = cacheFor(THREE);
  if (c.pats.has(pattern)) return c.pats.get(pattern);
  const tex = new THREE.DataTexture(patternBytes(pattern), PATTERN_SIZE, PATTERN_SIZE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  c.pats.set(pattern, tex);
  return tex;
}

// ---------------------------------------------------------------- build
const clamp = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
export function makeMaterial(THREE, spec) {
  const s = spec || {};
  const c = cacheFor(THREE);
  const key = materialHash(s);
  const hit = c.mats.get(key);
  if (hit) return hit;
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(HEX.test(s.color || '') ? s.color : '#888888'),
    roughness: clamp(s.roughness, 0, 1, 0.5),
    metalness: clamp(s.metalness, 0, 1, 0),
  });
  m.clearcoat = clamp(s.clearcoat, 0, 1, 0);
  m.clearcoatRoughness = clamp(s.clearcoatRoughness, 0, 1, 0);
  const tr = clamp(s.transmission, 0, 1, 0);
  if (tr > 0) { m.transmission = tr; m.thickness = clamp(s.thickness, 0, 100, 1); }
  m.ior = clamp(s.ior, 1, 2.5, 1.5);
  const op = clamp(s.opacity, 0, 1, 1);
  if (op < 1) { m.transparent = true; m.opacity = op; m.depthWrite = op > 0.6; }
  if (s.emissive && HEX.test(s.emissive)) { m.emissive = new THREE.Color(s.emissive); m.emissiveIntensity = clamp(s.emissiveIntensity, 0, 10, 1); }
  const tex = patternTexture(THREE, s.pattern);
  if (tex) {
    // one texture per pattern; the scale lives on the material through a
    // cloned texture that shares the image data
    const sc = clamp(s.patternScale, 0.01, 100, 1);
    const t = sc === 1 ? tex : tex.clone();
    if (t !== tex) { t.repeat.set(sc, sc); t.needsUpdate = true; }
    m.normalMap = t;
    m.normalScale = new THREE.Vector2(1, 1);
  }
  m.name = s.id || key;
  m.userData.specHash = key;
  m.userData.cached = true;
  c.mats.set(key, m);
  return m;
}

// (id) => material: presets first, then the custom specs of a document.
// The view and the tests pass it to buildPart as ctx.materials.
export function materialResolver(THREE, customSpecs = []) {
  const custom = new Map(customSpecs.map(s => [s.id, s]));
  return id => {
    const spec = custom.get(id) || presetById(id) || presetById('abs-grey');
    return makeMaterial(THREE, spec);
  };
}
