// shapes.js — the object catalog of the wind tunnel. No DOM, no GPU.
//
// Each entry of SHAPES names one SDF in shaders/sdf.wgsl (by kind) and lists
// its parameters in slot order. Slot i of `params` is P(i) in the shader.
// main.js builds a slider per parameter and a button per preset, and calls
// packShape() to make the 160-byte ShapeU uniform that every pass reads.
//
// Sizes. An object is drawn in its local frame (one unit = the object's
// reference length). fit = [length, height] is the nominal box that packShape
// fits into the tunnel, so a parameter slider changes the object and not the
// zoom. The size slider then scales that fit.
//
// Real size. realScale is metres per local unit, and refLocal(v) is the
// characteristic length in local units. Re = V * refLocal * realScale / nu.
//
// Reference area for the coefficients. 'frontal' uses the blocked cells that
// the solver counts after each voxelize. 'plan' uses chord * span (wings and
// plates, as in aerodynamics texts).
//
// grep: export const SHAPES  export const FLUIDS  export const COMMON
//       export function packShape  export function defaults  function rotation

export const SHAPES = {
  cow: {
    label: 'Cow', kind: 0, grounded: true, ground: 'fixed',
    realScale: 2.4, refLocal: () => 1.0, ref: 'frontal',
    fit: [1.0, 0.68], center: [-0.12, 0.34], halfZ: 0.18,
    params: [
      { k: 'bl', label: 'Body length', min: 0.40, max: 0.90, step: 0.01, def: 0.62 },
      { k: 'g', label: 'Girth', min: 0.20, max: 0.45, step: 0.01, def: 0.32 },
      { k: 'll', label: 'Leg length', min: 0.12, max: 0.50, step: 0.01, def: 0.30 },
      { k: 'hs', label: 'Head size', min: 0.60, max: 1.60, step: 0.01, def: 1.0 },
      { k: 'ha', label: 'Head drop', min: -20, max: 75, step: 1, def: 12, unit: '°' },
      { k: 'hl', label: 'Horns', min: 0.0, max: 0.20, step: 0.005, def: 0.06 },
      { k: 'tl', label: 'Tail', min: 0.0, max: 0.45, step: 0.01, def: 0.30 },
      { k: 'sph', label: 'Sphericity', min: 0.0, max: 1.0, step: 0.01, def: 0.0 },
    ],
    presets: {
      Holstein: {},
      Grazing: { ha: 68, hl: 0.04 },
      Bull: { g: 0.40, bl: 0.66, hs: 1.2, hl: 0.16, ll: 0.28 },
      Calf: { bl: 0.48, g: 0.24, ll: 0.34, hs: 1.25, hl: 0.0, tl: 0.2 },
      'Spherical cow': { sph: 1.0 },
    },
  },
  car: {
    label: 'Car', kind: 1, grounded: true, ground: 'belt',
    realScale: 4.7, refLocal: () => 1.0, ref: 'frontal',
    fit: [1.0, 0.42], center: [0.0, 0.18], halfZ: 0.24,
    params: [
      { k: 'H', label: 'Height', min: 0.22, max: 0.50, step: 0.005, def: 0.31 },
      { k: 'W', label: 'Width', min: 0.30, max: 0.50, step: 0.005, def: 0.40 },
      { k: 'hood', label: 'Hood length', min: 0.10, max: 0.45, step: 0.005, def: 0.30 },
      { k: 'rake', label: 'Windshield angle', min: 18, max: 75, step: 1, def: 30, unit: '°' },
      { k: 'roof', label: 'Roof length', min: 0.05, max: 0.75, step: 0.005, def: 0.28 },
      { k: 'rear', label: 'Rear window angle', min: 12, max: 90, step: 1, def: 24, unit: '°' },
      { k: 'clr', label: 'Ride height', min: 0.01, max: 0.08, step: 0.001, def: 0.03 },
      { k: 'spl', label: 'Rear wing', min: 0.0, max: 0.07, step: 0.001, def: 0.0 },
      { k: 'wr', label: 'Wheel radius', min: 0.05, max: 0.10, step: 0.001, def: 0.068 },
    ],
    presets: {
      Sedan: {},
      Fastback: { H: 0.26, W: 0.42, hood: 0.36, rake: 22, roof: 0.14, rear: 15, clr: 0.02, spl: 0.035, wr: 0.07 },
      Hatchback: { H: 0.36, hood: 0.26, rake: 32, roof: 0.42, rear: 72 },
      SUV: { H: 0.43, W: 0.42, hood: 0.27, rake: 38, roof: 0.47, rear: 84, clr: 0.06, wr: 0.085 },
      Van: { H: 0.48, W: 0.40, hood: 0.12, rake: 55, roof: 0.76, rear: 88, clr: 0.04, wr: 0.07 },
    },
  },
  truck: {
    label: 'Truck', kind: 2, grounded: true, ground: 'belt',
    realScale: 16.5, refLocal: () => 1.0, ref: 'frontal',
    fit: [1.0, 0.5], center: [0.0, 0.22], halfZ: 0.09,
    params: [
      { k: 'gap', label: 'Cab gap', min: 0.0, max: 0.12, step: 0.002, def: 0.05 },
      { k: 'cabH', label: 'Cab height', min: 0.28, max: 0.48, step: 0.005, def: 0.34 },
      { k: 'trH', label: 'Trailer height', min: 0.30, max: 0.50, step: 0.005, def: 0.42 },
      { k: 'defl', label: 'Roof deflector', min: 0.0, max: 1.0, step: 0.01, def: 0.0 },
      { k: 'rnd', label: 'Cab edge radius', min: 0.004, max: 0.06, step: 0.001, def: 0.01 },
      { k: 'boat', label: 'Boat tail', min: 0.0, max: 0.10, step: 0.002, def: 0.0 },
      { k: 'skirt', label: 'Side skirts', min: 0, max: 1, step: 1, def: 0 },
    ],
    presets: {
      Bare: {},
      Deflector: { defl: 1.0, rnd: 0.03 },
      'Aero kit': { defl: 1.0, rnd: 0.045, gap: 0.02, boat: 0.07, skirt: 1 },
    },
  },
  airfoil: {
    label: 'Airfoil', kind: 3, grounded: false, ground: 'none',
    realScale: 1.0, refLocal: () => 1.0, ref: 'plan',
    plan: (v) => [1.0, v.span],
    fit: [1.15, 0.6], center: [0.25, 0.0], halfZ: 1.0,
    params: [
      { k: 'm', label: 'Camber', min: 0, max: 9, step: 0.1, def: 2, unit: '%' },
      { k: 'p', label: 'Camber position', min: 1, max: 7, step: 0.1, def: 4, unit: '/10' },
      { k: 't', label: 'Thickness', min: 4, max: 30, step: 0.1, def: 12, unit: '%' },
      { k: 'span', label: 'Span', min: 0.5, max: 4, step: 0.05, def: 2.0, unit: 'c' },
    ],
    presets: {
      'NACA 0012': { m: 0, p: 4, t: 12 },
      'NACA 2412': { m: 2, p: 4, t: 12 },
      'NACA 4412': { m: 4, p: 4, t: 12 },
      'NACA 6409': { m: 6, p: 4, t: 9 },
      'NACA 0024': { m: 0, p: 4, t: 24 },
    },
    pitch: 8,
  },
  cylinder: {
    label: 'Cylinder', kind: 4, grounded: false, ground: 'none',
    realScale: 1.0, refLocal: (v) => v.D, ref: 'frontal',
    fit: [1.0, 1.0], center: [0.0, 0.0], halfZ: 1.0,
    params: [
      { k: 'D', label: 'Diameter', min: 0.15, max: 0.8, step: 0.01, def: 0.5 },
      { k: 'len', label: 'Length', min: 0.2, max: 4.0, step: 0.05, def: 4.0 },
    ],
    presets: { Spanning: {}, Stub: { len: 0.6 }, Disc: { D: 0.7, len: 0.2 } },
  },
  sphere: {
    label: 'Sphere', kind: 5, grounded: false, ground: 'none',
    realScale: 1.0, refLocal: (v) => v.D, ref: 'frontal',
    fit: [1.0, 1.0], center: [0.0, 0.0], halfZ: 0.4,
    params: [{ k: 'D', label: 'Diameter', min: 0.15, max: 0.8, step: 0.01, def: 0.5 }],
    presets: { Ball: {} },
  },
  box: {
    label: 'Box', kind: 6, grounded: false, ground: 'none',
    realScale: 1.0, refLocal: (v) => v.H, ref: 'frontal',
    fit: [1.0, 1.0], center: [0.0, 0.0], halfZ: 0.5,
    params: [
      { k: 'L', label: 'Length', min: 0.1, max: 1.0, step: 0.01, def: 0.5 },
      { k: 'H', label: 'Height', min: 0.1, max: 0.8, step: 0.01, def: 0.5 },
      { k: 'W', label: 'Width', min: 0.1, max: 1.0, step: 0.01, def: 0.5 },
      { k: 'r', label: 'Edge rounding', min: 0.0, max: 1.0, step: 0.01, def: 0.08 },
    ],
    presets: { Cube: {}, Brick: { L: 0.9, H: 0.3, W: 0.45 }, Rounded: { r: 0.6 } },
  },
  plate: {
    label: 'Plate', kind: 7, grounded: false, ground: 'none',
    realScale: 1.0, refLocal: (v) => v.c, ref: 'plan',
    plan: (v) => [v.c, v.span],
    fit: [1.0, 0.8], center: [0.0, 0.0], halfZ: 1.0,
    params: [
      { k: 'c', label: 'Chord', min: 0.2, max: 1.0, step: 0.01, def: 0.6 },
      { k: 'th', label: 'Thickness', min: 0.01, max: 0.1, step: 0.002, def: 0.03 },
      { k: 'span', label: 'Span', min: 0.3, max: 4.0, step: 0.05, def: 1.6 },
    ],
    presets: { Flat: {}, 'Square plate': { c: 0.6, span: 0.6 } },
    pitch: 20,
  },
};

// Placement controls shared by every shape.
export const COMMON = [
  { k: 'size', label: 'Size', min: 0.5, max: 1.6, step: 0.01, def: 1.0, unit: '×' },
  { k: 'yaw', label: 'Yaw', min: -90, max: 90, step: 1, def: 0, unit: '°' },
  { k: 'pitch', label: 'Pitch / AoA', min: -30, max: 30, step: 0.5, def: 0, unit: '°' },
  { k: 'copies', label: 'Copies', min: 1, max: 4, step: 1, def: 1 },
  { k: 'spacing', label: 'Spacing', min: 1.0, max: 4.0, step: 0.05, def: 1.6, unit: 'L' },
];

// Kinematic viscosity, m^2/s.
export const FLUIDS = {
  air: { label: 'Air', nu: 1.5e-5 },
  water: { label: 'Water', nu: 1.0e-6 },
  oil: { label: 'Olive oil', nu: 8.0e-5 },
  honey: { label: 'Honey', nu: 4.0e-3 },
};

export function defaults(key) {
  const s = SHAPES[key];
  const v = {};
  for (const p of s.params) v[p.k] = p.def;
  return v;
}

export function commonDefaults(key) {
  const v = {};
  for (const p of COMMON) v[p.k] = p.def;
  v.pitch = SHAPES[key].pitch || 0;
  return v;
}

// World <- local rotation: yaw about y, then nose-up pitch about z. The
// shader needs world -> local, which is the transpose.
function rotation(yawDeg, pitchDeg) {
  const a = yawDeg * Math.PI / 180, b = pitchDeg * Math.PI / 180;
  const cy = Math.cos(a), sy = Math.sin(a), cp = Math.cos(b), sp = Math.sin(b);
  const Rz = [[cp, sp, 0], [-sp, cp, 0], [0, 0, 1]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    for (let k = 0; k < 3; k++) R[i][j] += Ry[i][k] * Rz[k][j];
  return [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
}

// dom: { nx, ny, nz, mode: '2d' | '3d', view: 'side' | 'top', ground }
// Returns the uniform bytes and the numbers the solver and readouts need.
export function packShape(key, v, c, dom) {
  const s = SHAPES[key];
  const is2D = dom.mode === '2d';
  const top = is2D && dom.view === 'top';
  const fx = is2D ? 0.19 : 0.22;
  const fy = is2D ? 0.34 : 0.42;
  const vert = top ? 2 * s.halfZ : s.fit[1];
  const groundOn = dom.ground !== 'none' && !top;
  const fyEff = groundOn && s.grounded ? fy : fy * 0.8;
  const scale = Math.min(fx * dom.nx / s.fit[0], fyEff * dom.ny / vert) * c.size;
  const copies = Math.round(c.copies);
  const spacing = c.spacing * s.fit[0] * scale;

  let x0 = dom.nx * 0.28 - (copies - 1) * spacing * 0.4;
  x0 = Math.max(x0, dom.nx * 0.1 + s.fit[0] * scale * 0.5);
  const ox = x0 - s.center[0] * scale;

  let oy, oz, sweepC = 0, extent;
  const reach = 0.75 * Math.max(s.fit[0], 2 * s.halfZ, s.fit[1]) * scale + 4;
  if (top) {
    oy = 0;
    oz = dom.ny * 0.5;
    sweepC = s.center[1] * scale;
    extent = reach;
  } else {
    if (s.grounded && groundOn) oy = 1.0;
    else oy = dom.ny * 0.5 - s.center[1] * scale;
    oz = is2D ? 0 : dom.nz * 0.5;
    extent = Math.min(reach, is2D ? 4 * scale : 0);
  }

  const inv = rotation(c.yaw, c.pitch);
  const buf = new ArrayBuffer(160);
  const f = new Float32Array(buf), u = new Uint32Array(buf);
  f.set([...inv[0], 0, ...inv[1], 0, ...inv[2], 0], 0);
  f.set([ox, oy, oz, scale], 12);
  s.params.forEach((p, i) => { f[16 + i] = v[p.k]; });
  u[32] = s.kind;
  u[33] = copies;
  u[34] = is2D ? (top ? 2 : 1) : 0;
  f[36] = spacing;
  f[37] = extent;
  f[38] = sweepC;

  let planCells = 0;
  if (s.ref === 'plan') {
    const [ch, span] = s.plan(v);
    planCells = is2D ? ch * scale : ch * scale * Math.min(span * scale, dom.nz - 2);
  }
  return {
    buf, scale, copies, spacing,
    origin: [ox, oy, oz],
    refCells: s.refLocal(v) * scale,
    planCells,
    realLen: s.refLocal(v) * s.realScale,
  };
}
