// ============================================================================
//  PLATONIC MIRRORS  ·  raw WebGL2 raymarched Wythoff polyhedron
// ----------------------------------------------------------------------------
//  No Three.js. A single fragment shader ray-marches a reflecting/refracting
//  polyhedron built by Wythoff kaleidoscopic folding. main.js is the loader,
//  the control panel, and the per-frame uniform push. computePoly() turns the
//  U/V/W sliders and the symmetry order into the fold planes the shader uses;
//  all geometry and optics live in shaders/raymarch.frag.glsl.
//
//  RENDER PIPELINE
//  ───────────────
//      fetch .glsl ─▶ compile + link program ─▶ fullscreen quad (4 verts)
//                                     │
//      S (slider state) ─▶ computePoly() ─▶ fold planes ┐
//      S colours ─▶ hsv2rgb() ─────────────────────────┤ frame(): push uniforms
//                                                       ▼
//                       gl.drawArrays(TRIANGLE_STRIP, 0, 4)
//                                     ▼
//                                <canvas id=c>
//
//  WYTHOFF PARAMS
//  ──────────────
//      poly_type = symmetry order (2..5) → mirror plane normal nc
//      U,V,W     = barycentric weights of the seed point p over the three
//                  fundamental-domain corners (pab, pbc, pca)
//      The shader folds space across nc poly_type times, then measures distance
//      to the seed point's planes/edges/corner: a whole solid family from 5
//      numbers.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ────────────────────────────────────────────────────────────────────────
//      shader fetch ....... "fetch(new URL"    load .glsl before GL setup
//      state .............. "======== STATE"   the mutable parameter object S
//      presets ............ "const PRESETS"    named solids
//      hsv ................ "hsv2rgb"          colour pickers → RGB uniforms
//      poly params ........ "computePoly"      Wythoff fold planes from U/V/W
//      webgl setup ........ "======== WEBGL"   context, program, quad, uniforms
//      resize ............. "function resize"  size buffer to DPR + res_scale
//      ui ................. "======== UI"      sections, sliders, colour groups
//      presets grid ....... "======== PRESETS" build preset buttons
//      randomize .......... "======== RANDOMIZE" draw a whole random solid
//      input .............. "WHEEL ZOOM"       wheel, drag, touch, panel toggle
//      screensaver ........ "======== SCREENSAVER" seeded look A, drift to B
//      render loop ........ "RENDER LOOP"      orbit drift, uniforms, draw, FPS
//
//  SCREENSAVER  window.snSaver, for lib/screensaver.js
//  ────────────────────────────────────────────────────────────────────────
//      The hook is set before the shader fetch, so the shell finds it at
//      once. enter() waits for GL setup, then hides the GUI and draws a
//      chain of looks from opts.seed. Each look is one named solid with its
//      own colours, optics and camera. The frame loop holds a look, then
//      eases S to the next look with a cosine ease, so no change is a hard
//      cut. All looks in one visit share poly_type and max_bounces, because
//      integers cannot ease. When the named solid changes, opts.label gets
//      its name, F/E/V counts and Schläfli symbol (table "const SOLIDS").
// ============================================================================
(async () => {
// The screensaver hook must exist before the first await. enter() waits on
// glReady and then calls saverEnter (defined in the SCREENSAVER section).
let glReadyResolve, saverEnter = null;
const glReady = new Promise(r => { glReadyResolve = r; });
window.snSaver = { enter(o) { return glReady.then(() => saverEnter(o || {})); } };

// Fetch both shader stages as text before any GL setup.
const SH = {};
for (const _n of ['shaders/raymarch.vert.glsl', 'shaders/raymarch.frag.glsl']) {
  SH[_n] = await (await fetch(new URL(_n, document.baseURI))).text();
}

// The one mutable state object read every frame. Geometry, camera, per-light
// HSV colours, and quality knobs; each field maps to a slider and/or uniform.
// ======== STATE ========
const S = {
  rot_x: 0.3, rot_y: 0.0, orbit_speed: 0.15,
  poly_type: 3,
  poly_U: 1.0, poly_V: 0.5, poly_W: 1.0,
  poly_zoom: 2.0,
  inner_sphere: 1.0,
  refr_index: 0.9,
  max_bounces: 6,
  fov: 2.0,
  cam_y: 1.0, cam_z: -5.0,
  sun_h: 0.06, sun_s: 0.90, sun_i: 0.01,
  floor_h: 0.66, floor_s: 0.80, floor_i: 0.5,
  sky_h: 0.60, sky_s: 0.90, sky_i: 1.0,
  glow0_h: 0.05, glow0_s: 0.70, glow0_i: 0.001,
  glow1_h: 0.95, glow1_s: 0.70, glow1_i: 0.001,
  beer_h: 0.65, beer_s: 0.70, beer_i: 2.0,
  edge_thick: 0.002,
  marches_inner: 50,
  marches_outer: 90,
  res_scale: 1.0,
};

// Snapshot of the initial state (kept for reference; not wired to a reset here).
const DEFAULTS = { ...S };

// Named solids. Each preset sets only the Wythoff numbers (symmetry order and
// U/V/W weights) plus zoom, so a click reshapes the polyhedron without touching
// camera or colours.
const PRESETS = {
  'Default':     { poly_type:3, poly_U:1.0, poly_V:0.5, poly_W:1.0, poly_zoom:2.0 },
  'Icosa':       { poly_type:3, poly_U:1.0, poly_V:1.0, poly_W:0.0, poly_zoom:2.0 },
  'Octa':        { poly_type:3, poly_U:0.0, poly_V:1.0, poly_W:0.0, poly_zoom:2.2 },
  'Cube':        { poly_type:4, poly_U:1.0, poly_V:0.0, poly_W:0.0, poly_zoom:1.8 },
  'Dodeca':      { poly_type:5, poly_U:1.0, poly_V:0.0, poly_W:0.0, poly_zoom:2.2 },
  'Truncated':   { poly_type:3, poly_U:1.0, poly_V:1.0, poly_W:1.0, poly_zoom:2.5 },
  'Stellated':   { poly_type:5, poly_U:0.3, poly_V:1.0, poly_W:0.3, poly_zoom:2.8 },
  'Prism':       { poly_type:2, poly_U:1.0, poly_V:0.5, poly_W:0.5, poly_zoom:2.0 },
  'Gem':         { poly_type:4, poly_U:0.5, poly_V:0.5, poly_W:1.0, poly_zoom:2.0 },
};

// Convert a colour picker's H,S,V into linear RGB for the shader. Each light in
// the scene is stored as HSV in S and pushed as an RGB uniform every frame.
// ======== HSV→RGB ========
function hsv2rgb(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const k = [1, 2/3, 1/3, 3];
  const p = [
    Math.abs(((h + k[0]) % 1) * 6 - k[3]),
    Math.abs(((h + k[1]) % 1) * 6 - k[3]),
    Math.abs(((h + k[2]) % 1) * 6 - k[3]),
  ];
  return [
    v * (1 - s + s * Math.max(0, Math.min(1, p[0] - 1))),
    v * (1 - s + s * Math.max(0, Math.min(1, p[1] - 1))),
    v * (1 - s + s * Math.max(0, Math.min(1, p[2] - 1))),
  ];
}

// Build the Wythoff fundamental domain for the current symmetry order. nc is the
// third mirror plane normal; pab/pbc/pca are the three corner directions of the
// spherical triangle. The seed point p is their U/V/W-weighted, normalized sum.
// The shader folds space across these mirrors and measures distance to p, so
// these few vectors define the entire solid. Mirrors kaleido code in the shader.
// ======== POLY PARAMS ========
function computePoly() {
  const t = S.poly_type;
  // Half-angle of the symmetry wedge sets the mirror geometry.
  const cospin = Math.cos(Math.PI / t);
  const scospin = Math.sqrt(Math.max(0, 0.75 - cospin * cospin));
  // Third mirror normal and the three fundamental-domain corner directions.
  const nc = [-0.5, -cospin, scospin];
  const pab = [0, 0, 1];
  const pbc_ = [scospin, 0, 0.5];
  const pca_ = [0, scospin, cospin];
  // Seed point p: weight the three corners by U/V/W, then normalize. pbc/pca are
  // also returned normalized because the shader uses them as plane normals.
  const pr = [
    S.poly_U * pab[0] + S.poly_V * pbc_[0] + S.poly_W * pca_[0],
    S.poly_U * pab[1] + S.poly_V * pbc_[1] + S.poly_W * pca_[1],
    S.poly_U * pab[2] + S.poly_V * pbc_[2] + S.poly_W * pca_[2],
  ];
  const pl = Math.sqrt(pr[0]*pr[0]+pr[1]*pr[1]+pr[2]*pr[2]) || 1;
  const p = pr.map(x=>x/pl);
  const bl = Math.sqrt(pbc_[0]**2+pbc_[1]**2+pbc_[2]**2) || 1;
  const pbc = pbc_.map(x=>x/bl);
  const cl = Math.sqrt(pca_[0]**2+pca_[1]**2+pca_[2]**2) || 1;
  const pca = pca_.map(x=>x/cl);
  return { nc, pab, pbc, pca, p };
}

// WebGL2 context, opaque and without MSAA (a single shaded quad needs neither).
// ======== WEBGL ========
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
if (!gl) { document.body.innerHTML = '<h1 style="color:#fff;padding:40px">WebGL2 required</h1>'; throw 'no gl'; }
// The tab shell removes this iframe on a page swap. Drop the context so the
// browser does not run out of live WebGL contexts during heavy swapping.
window.addEventListener('pagehide', function () { try { if (gl) gl.getExtension('WEBGL_lose_context').loseContext(); } catch (e) {} });

const VERT = SH['shaders/raymarch.vert.glsl'];

const FRAG = SH['shaders/raymarch.frag.glsl'];

// Compile one shader stage; log and return null on error.
function compileShader(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

// Compile both stages, link, and use the program.
const vs = compileShader(VERT, gl.VERTEX_SHADER);
const fs = compileShader(FRAG, gl.FRAGMENT_SHADER);
const prog = gl.createProgram();
gl.attachShader(prog, vs);
gl.attachShader(prog, fs);
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
  console.error(gl.getProgramInfoLog(prog));
}
gl.useProgram(prog);

// The covering geometry: four clip-space corners drawn as a triangle strip so
// the fragment shader runs once per pixel. a_pos is wired to it.
// Fullscreen quad
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'a_pos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

// Cache every uniform location once, keyed by name, so the frame loop does not
// look them up per draw.
// Uniform locations
const U = {};
const uNames = [
  'u_resolution','u_rot_x','u_rot_y','u_poly_type','u_poly_zoom',
  'u_inner_sphere','u_refr_index','u_max_bounces','u_fov','u_ray_origin',
  'u_sun_col','u_bottom_col','u_top_col','u_glow_col0','u_glow_col1','u_beer_col',
  'u_poly_nc','u_poly_p','u_poly_pab','u_poly_pbc','u_poly_pca',
  'u_marches_inner','u_marches_outer','u_edge_thick',
];
for (const n of uNames) U[n] = gl.getUniformLocation(prog, n);

// Size the drawing buffer to the window times device pixel ratio times the
// res_scale quality slider, then match the GL viewport. Lowering res_scale is
// the cheapest way to raise frame rate on this heavy shader.
// ======== RESIZE ========
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const s = S.res_scale;
  canvas.width = Math.floor(window.innerWidth * dpr * s);
  canvas.height = Math.floor(window.innerHeight * dpr * s);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// Declarative panel description: a list of collapsible sections, each holding
// either slider params or HSV colour groups. buildUI() renders this to the DOM.
// ======== UI ========
const SECTIONS = [
  { id: 'shape', label: 'Shape', params: [
    { key:'poly_type', label:'Poly Type', min:2, max:5, step:1, fmt: v=>v },
    { key:'poly_U', label:'U', min:0, max:3, step:0.01 },
    { key:'poly_V', label:'V', min:0, max:3, step:0.01 },
    { key:'poly_W', label:'W', min:0, max:3, step:0.01 },
    { key:'poly_zoom', label:'Zoom', min:0.5, max:5, step:0.01 },
    { key:'inner_sphere', label:'Inner Sphere', min:0, max:3, step:0.01 },
    { key:'edge_thick', label:'Edge Width', min:0.0005, max:0.02, step:0.0001 },
  ]},
  { id: 'rotation', label: 'Rotation', params: [
    { key:'orbit_speed', label:'Orbit Speed', min:0, max:1, step:0.005 },
    { key:'rot_x', label:'Pitch', min:-3.14159, max:3.14159, step:0.001 },
    { key:'rot_y', label:'Yaw', min:-3.14159, max:3.14159, step:0.001 },
  ], extra: 'rotation' },
  { id: 'optics', label: 'Optics', params: [
    { key:'refr_index', label:'Refraction', min:0.3, max:1.5, step:0.01 },
    { key:'max_bounces', label:'Bounces', min:1, max:12, step:1, fmt: v=>v },
  ]},
  { id: 'colors', label: 'Colors', colors: [
    { prefix:'sun', label:'Sun' },
    { prefix:'floor', label:'Floor' },
    { prefix:'sky', label:'Sky' },
    { prefix:'glow0', label:'Outer Glow' },
    { prefix:'glow1', label:'Inner Glow' },
    { prefix:'beer', label:'Absorption' },
  ]},
  { id: 'camera', label: 'Camera', params: [
    { key:'fov', label:'FOV', min:0.5, max:5, step:0.01 },
    { key:'cam_y', label:'Height', min:-3, max:6, step:0.01 },
    { key:'cam_z', label:'Distance', min:-12, max:-1, step:0.01 },
  ]},
  { id: 'quality', label: 'Quality', params: [
    { key:'res_scale', label:'Resolution', min:0.25, max:1.0, step:0.05, fmt: v=>(v*100).toFixed(0)+'%' },
    { key:'marches_inner', label:'Inner Marches', min:10, max:120, step:1, fmt: v=>v },
    { key:'marches_outer', label:'Outer Marches', min:20, max:200, step:1, fmt: v=>v },
  ]},
];

// Format a value for its readout: a param's custom fmt wins, else pick decimals
// by magnitude so small values keep precision.
function fmtVal(v, p) {
  if (p && p.fmt) return p.fmt(v);
  return Number(v).toFixed(v < 0.01 ? 4 : v < 1 ? 3 : 2);
}

// Render every section into #controls: a collapsible header, then its sliders or
// colour groups, plus the rotation reset button where requested.
function buildUI() {
  const container = document.getElementById('controls');
  container.innerHTML = '';

  for (const sec of SECTIONS) {
    const div = document.createElement('div');
    div.className = 'section';
    div.id = 'sec-'+sec.id;

    const head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = `<span>${sec.label}</span><span class="section-arrow">▼</span>`;
    head.onclick = () => div.classList.toggle('collapsed');
    div.appendChild(head);

    const body = document.createElement('div');
    body.className = 'section-body';

    if (sec.params) {
      for (const p of sec.params) {
        body.appendChild(makeSlider(p));
      }
    }

    if (sec.colors) {
      for (const c of sec.colors) {
        body.appendChild(makeColorGroup(c));
      }
    }

    if (sec.extra === 'rotation') {
      const row = document.createElement('div');
      row.className = 'btn-row';
      const resetBtn = document.createElement('button');
      resetBtn.className = 'sm-btn';
      resetBtn.textContent = 'Reset Angles';
      resetBtn.onclick = () => { S.rot_x = 0.3; S.rot_y = 0; syncSlider('rot_x'); syncSlider('rot_y'); };
      row.appendChild(resetBtn);
      const hint = document.createElement('span');
      hint.style.cssText = 'font-size:9px;color:#556;margin-left:6px;line-height:26px;';
      hint.textContent = 'drag canvas to rotate';
      row.appendChild(hint);
      body.appendChild(row);
    }

    div.appendChild(body);
    container.appendChild(div);
  }
}

// Build one slider row bound to S[p.key]. Integer-step params store ints; the
// res_scale slider also triggers a resize so the change takes effect at once.
function makeSlider(p) {
  const row = document.createElement('div');
  row.className = 'param-row';
  const lbl = document.createElement('div');
  lbl.className = 'param-label';
  const valSpan = document.createElement('span');
  valSpan.className = 'val';
  valSpan.id = 'val-'+p.key;
  valSpan.textContent = fmtVal(S[p.key], p);
  lbl.innerHTML = `<label>${p.label}</label>`;
  lbl.appendChild(valSpan);
  row.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'range';
  input.id = 'sl-'+p.key;
  input.min = p.min; input.max = p.max; input.step = p.step;
  input.value = S[p.key];
  input.oninput = () => {
    S[p.key] = p.step >= 1 ? parseInt(input.value) : parseFloat(input.value);
    valSpan.textContent = fmtVal(S[p.key], p);
    if (p.key === 'res_scale') resize();
  };
  row.appendChild(input);
  return row;
}

// Build a colour control: a swatch plus H/S/I sliders. Intensity ranges differ
// per light (log-scale glows and sun, wider for absorption), hence isLog/iMax.
function makeColorGroup(c) {
  const group = document.createElement('div');
  group.className = 'color-group';
  const lbl = document.createElement('div');
  lbl.className = 'color-group-label';
  const swatch = document.createElement('span');
  swatch.className = 'color-swatch';
  swatch.id = 'swatch-'+c.prefix;
  lbl.appendChild(swatch);
  lbl.appendChild(document.createTextNode(c.label));
  group.appendChild(lbl);

  const isLog = ['sun','glow0','glow1','beer'].includes(c.prefix);
  const iMax = c.prefix === 'beer' ? 5 : (isLog ? 1 : 2);
  const iStep = isLog ? 0.0001 : 0.01;

  const sliders = [
    { key: c.prefix+'_h', label:'H', min:0, max:1, step:0.001 },
    { key: c.prefix+'_s', label:'S', min:0, max:1, step:0.01 },
    { key: c.prefix+'_i', label:'I', min:0, max:iMax, step:iStep },
  ];
  for (const s of sliders) {
    group.appendChild(makeSlider(s));
  }
  updateSwatch(c.prefix);
  return group;
}

// Repaint one colour group's swatch from its current HSV (intensity clamped to 1
// so the swatch stays a visible colour rather than blowing out).
function updateSwatch(prefix) {
  const el = document.getElementById('swatch-'+prefix);
  if (!el) return;
  const rgb = hsv2rgb(S[prefix+'_h'], S[prefix+'_s'], Math.min(S[prefix+'_i'], 1));
  el.style.background = `rgb(${rgb.map(v=>Math.round(v*255)).join(',')})`;
}

// Repaint every colour swatch (called each frame so drift/randomize show live).
function updateAllSwatches() {
  for (const sec of SECTIONS) {
    if (sec.colors) sec.colors.forEach(c => updateSwatch(c.prefix));
  }
}

// Build one button per preset. A click copies the preset's values into S, syncs
// those sliders, and marks the button active.
// ======== PRESETS ========
const presetsDiv = document.getElementById('presets');
for (const [name, vals] of Object.entries(PRESETS)) {
  const btn = document.createElement('button');
  btn.className = 'preset-btn';
  btn.textContent = name;
  btn.onclick = () => {
    for (const [k, v] of Object.entries(vals)) {
      S[k] = v;
      syncSlider(k);
    }
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };
  presetsDiv.appendChild(btn);
}

// Render the panel now that sections and presets are defined.
buildUI();

// Push S[key] back onto its slider and readout. Used whenever code (preset,
// randomize, drag, drift) changes a value so the panel stays in step.
// ======== SYNC HELPER ========
function syncSlider(key) {
  const sl = document.getElementById('sl-'+key);
  const vl = document.getElementById('val-'+key);
  if (sl) sl.value = S[key];
  if (vl) {
    const param = SECTIONS.flatMap(s=>s.params||[]).concat(
      SECTIONS.flatMap(s=>(s.colors||[]).flatMap(c=>[
        {key:c.prefix+'_h',fmt:undefined},{key:c.prefix+'_s',fmt:undefined},{key:c.prefix+'_i',fmt:undefined}
      ]))
    ).find(p=>p.key===key);
    vl.textContent = fmtVal(S[key], param);
  }
}

// Sync every slider from S at once (after randomize).
function syncAll() {
  for (const k of Object.keys(S)) syncSlider(k);
}

// Random helpers on a generator rnd (Math.random or a seeded one): float
// range and inclusive int range.
// ======== RANDOMIZE ========
function rand(lo, hi, rnd = Math.random) { return lo + rnd() * (hi - lo); }
function randInt(lo, hi, rnd = Math.random) { return Math.floor(rand(lo, hi + 1, rnd)); }

// Draw a whole new solid: symmetry, U/V/W, camera, optics, and every light, each
// from a hand-tuned range so the result stays renderable. Returns the values;
// it does not change S.
function drawParams(rnd = Math.random) {
  const P = {};
  const r = (lo, hi) => rand(lo, hi, rnd), ri = (lo, hi) => randInt(lo, hi, rnd);
  P.poly_type = ri(2, 5);
  P.poly_U = r(0, 2.5);
  P.poly_V = r(0, 2.5);
  P.poly_W = r(0, 2.5);
  P.poly_zoom = r(1.2, 3.5);
  P.inner_sphere = r(0.2, 2.0);
  P.edge_thick = r(0.0008, 0.012);
  P.rot_x = r(-3.14, 3.14);
  P.rot_y = r(-3.14, 3.14);
  P.orbit_speed = r(0.02, 0.4);
  P.refr_index = r(0.4, 1.3);
  P.max_bounces = ri(2, 10);
  P.fov = r(1.0, 3.5);
  P.cam_y = r(-1, 3);
  P.cam_z = r(-8, -2.5);
  P.sun_h = r(0, 1); P.sun_s = r(0.4, 1); P.sun_i = r(0.002, 0.05);
  P.floor_h = r(0, 1); P.floor_s = r(0.3, 1); P.floor_i = r(0.2, 1.0);
  P.sky_h = r(0, 1); P.sky_s = r(0.3, 1); P.sky_i = r(0.3, 1.5);
  P.glow0_h = r(0, 1); P.glow0_s = r(0.3, 1); P.glow0_i = r(0.0003, 0.005);
  P.glow1_h = r(0, 1); P.glow1_s = r(0.3, 1); P.glow1_i = r(0.0003, 0.005);
  P.beer_h = r(0, 1); P.beer_s = r(0.3, 1); P.beer_i = r(0.5, 4.0);
  return P;
}

// The Random button: copy one draw into S, then sync the panel.
function randomize() {
  Object.assign(S, drawParams());
  syncAll();
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
}

// Prepend the Randomize button to the preset row.
// Add randomize button
const randBtn = document.createElement('button');
randBtn.className = 'preset-btn rand';
randBtn.textContent = '🎲 Random';
randBtn.onclick = randomize;
presetsDiv.insertBefore(randBtn, presetsDiv.firstChild);

// Wheel zoom: move the camera along its distance axis within limits.
// ======== MOUSE WHEEL ZOOM ========
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY * 0.008;
  S.cam_z = Math.max(-12, Math.min(-1, S.cam_z + delta));
  syncSlider('cam_z');
}, { passive: false });

// Drag to rotate: pointer delta feeds yaw (rot_y) and pitch (rot_x). While
// dragging, the auto orbit drift in the render loop pauses.
// ======== MOUSE DRAG ROTATION ========
let dragging = false, dragX = 0, dragY = 0;
canvas.addEventListener('mousedown', (e) => {
  dragging = true; dragX = e.clientX; dragY = e.clientY;
  canvas.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragX, dy = e.clientY - dragY;
  dragX = e.clientX; dragY = e.clientY;
  S.rot_y += dx * 0.005;
  S.rot_x += dy * 0.005;
  syncSlider('rot_x'); syncSlider('rot_y');
});
window.addEventListener('mouseup', () => {
  dragging = false;
  canvas.style.cursor = 'crosshair';
});

// Single-finger touch drag, tracked by touch identifier, mirrors mouse rotation.
// Touch drag
let touchId = null;
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    touchId = e.touches[0].identifier;
    dragX = e.touches[0].clientX; dragY = e.touches[0].clientY;
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === touchId) {
      const dx = t.clientX - dragX, dy = t.clientY - dragY;
      dragX = t.clientX; dragY = t.clientY;
      S.rot_y += dx * 0.005;
      S.rot_x += dy * 0.005;
      syncSlider('rot_x'); syncSlider('rot_y');
      e.preventDefault();
    }
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { touchId = null; });

// Show/hide the control panel and flip the toggle arrow.
// Toggle panel
const toggleBtn = document.getElementById('toggle-btn');
const panel = document.getElementById('panel');
toggleBtn.onclick = () => {
  panel.classList.toggle('hidden');
  toggleBtn.classList.toggle('open');
  toggleBtn.textContent = panel.classList.contains('hidden') ? '▶' : '◀';
};

// Seeded generator (mulberry32). Returns floats in [0,1).
// ======== SCREENSAVER ========
function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// The seed point sits at U·A + V·B + W·C on the fundamental triangle. The
// corner A is a 2-fold axis, B is a q-fold axis, and C is a 3-fold axis (q is
// poly_type). The zero weights select the Wythoff solid. The table below was
// checked by vertex-orbit counts.
// Each row: [weights on, name, F, E, V, Schläfli symbol].
const SOLIDS = {
  3: [['A','Octahedron (rectified tetrahedron)',8,12,6,'r{3,3}'],
      ['B','Tetrahedron',4,6,4,'{3,3}'], ['C','Tetrahedron',4,6,4,'{3,3}'],
      ['AB','Truncated tetrahedron',8,18,12,'t{3,3}'], ['AC','Truncated tetrahedron',8,18,12,'t{3,3}'],
      ['BC','Cuboctahedron (cantellated tetrahedron)',14,24,12,'rr{3,3}'],
      ['ABC','Truncated octahedron (omnitruncated tetrahedron)',14,36,24,'tr{3,3}']],
  4: [['A','Cuboctahedron',14,24,12,'r{4,3}'],
      ['B','Octahedron',8,12,6,'{3,4}'], ['C','Cube',6,12,8,'{4,3}'],
      ['AB','Truncated octahedron',14,36,24,'t{3,4}'], ['AC','Truncated cube',14,36,24,'t{4,3}'],
      ['BC','Rhombicuboctahedron',26,48,24,'rr{4,3}'],
      ['ABC','Truncated cuboctahedron',26,72,48,'tr{4,3}']],
  5: [['A','Icosidodecahedron',32,60,30,'r{5,3}'],
      ['B','Icosahedron',20,30,12,'{3,5}'], ['C','Dodecahedron',12,30,20,'{5,3}'],
      ['AB','Truncated icosahedron',32,90,60,'t{3,5}'], ['AC','Truncated dodecahedron',32,90,60,'t{5,3}'],
      ['BC','Rhombicosidodecahedron',62,120,60,'rr{5,3}'],
      ['ABC','Truncated icosidodecahedron',62,180,120,'tr{5,3}']],
};
const GROUP = { 3: 'tetrahedral symmetry [3,3]', 4: 'octahedral symmetry [4,3]', 5: 'icosahedral symmetry [5,3]' };

// The row of SOLIDS for the current S. computePoly() does not normalize the
// B and C corners before it adds them, so their weights get the corner
// lengths here. A weight under 8% of the largest one counts as zero, because
// a cut that small does not show at screen size.
function solidNow() {
  const c = Math.cos(Math.PI / S.poly_type), s2 = Math.max(0, 0.75 - c * c);
  const w = { A: S.poly_U, B: S.poly_V * Math.sqrt(s2 + 0.25), C: S.poly_W * Math.sqrt(s2 + c * c) };
  const m = Math.max(w.A, w.B, w.C, 1e-6);
  const on = ['A','B','C'].filter(k => w[k] > 0.08 * m).join('');
  return (SOLIDS[S.poly_type] || []).find(r => r[0] === on) || null;
}

// One screensaver look: drawParams() with the camera and optics held in a
// range where the solid fills the frame and stays clear. The look picks a
// corner set and sets the other weights to exactly zero, so each look is
// one named solid. The Platonic corners (B, C) get the most picks.
const PATTERNS = ['B','C','B','C','A','AB','AC','BC','ABC'];
function saverLook(rnd) {
  const L = drawParams(rnd);
  const r = (a, b) => a + rnd() * (b - a);
  const pat = PATTERNS[Math.floor(rnd() * PATTERNS.length)];
  L.poly_U = pat.includes('A') ? r(0.5, 2) : 0;
  L.poly_V = pat.includes('B') ? r(0.5, 2) : 0;
  L.poly_W = pat.includes('C') ? r(0.5, 2) : 0;
  L.poly_zoom = r(1.4, 2.1);
  L.inner_sphere = r(0.4, 1.6);
  L.edge_thick = r(0.001, 0.006);
  L.refr_index = r(0.6, 1.2);
  L.fov = r(1.7, 2.5);
  L.cam_y = r(-0.5, 2.5);
  L.cam_z = r(-6, -4);
  return L;
}

// Keys that ease from one look to the next. Hues (_h) take the short way
// round the colour circle. Rotation is left to the orbit drift. poly_type and
// max_bounces are integers, so they stay fixed for the whole visit.
const DRIFT_KEYS = ['poly_U','poly_V','poly_W','poly_zoom','inner_sphere','edge_thick',
  'refr_index','fov','cam_y','cam_z',
  ...['sun','floor','sky','glow0','glow1','beer'].flatMap(c => [c+'_h', c+'_s', c+'_i'])];
// While the screensaver plays: { A, B, t0, hold, dur, rnd, label, name }.
// Each leg holds look A for hold ms, then eases to look B over dur ms.
let drift = null;

// Set S at u in [0,1] between look A and look B.
function driftTo(u) {
  const { A, B } = drift;
  for (const k of DRIFT_KEYS) {
    let d = B[k] - A[k];
    if (k.endsWith('_h')) d = ((d % 1) + 1.5) % 1 - 0.5;
    S[k] = A[k] + d * u;
  }
}

// One frame of the drift. When a leg ends, B becomes A and a new look B
// comes from the same seeded generator. The cosine ease starts and ends at
// zero speed, so no leg has a hard edge.
function driftStep(now) {
  let x = (now - drift.t0 - drift.hold) / drift.dur;
  if (x >= 1) {
    const B = saverLook(drift.rnd);
    B.poly_type = drift.A.poly_type; B.max_bounces = drift.A.max_bounces;
    drift.A = drift.B; drift.B = B; drift.t0 = now; x = -drift.hold / drift.dur;
  }
  driftTo(0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, x)));
  const row = solidNow();
  const name = row ? row[1] : '';
  if (name !== drift.name) { drift.name = name; saverLabel(row); }
}

// Send the label plate for one row of SOLIDS to the shell: the fold, the
// seed point, the face distance and the Fresnel mix of the shader, with
// the live Wythoff weights. Colours: p, r m1 (ray), d and the seed s m2,
// the mirror normals and corners m3, phi and eta m4, L m5, m, U, V, W, z
// m6.
const PLATE_RULES = [['\\mathbf{p}', 'm1'], ['\\mathbf{r}', 'm1'], ['d', 'm2'], ['\\mathbf{s}', 'm2'],
  ['\\mathbf{n}_c', 'm3'], ['\\mathbf{n}_k', 'm3'], ['\\mathbf{n}', 'm3'], ['\\mathbf{a}', 'm3'], ['\\mathbf{b}', 'm3'], ['\\mathbf{c}', 'm3'],
  ['\\phi', 'm4'], ['\\eta', 'm4'], ['L', 'm5'], ['m', 'm6'], ['U', 'm6'], ['V', 'm6'], ['W', 'm6'], ['z', 'm6']];
function saverLabel(row) {
  if (!drift.label || !row) return;
  const [, name, F, E, V, sch] = row, f2 = v => (+v).toFixed(2);
  try {
    drift.label({ title: name, sub: 'Wythoff construction, ' + GROUP[S.poly_type],
      params: [{ sym: 'm', name: 'mirror order', value: String(S.poly_type), cls: 'm6' },
        { sym: 'U, V, W', name: 'seed weights', value: f2(S.poly_U) + ', ' + f2(S.poly_V) + ', ' + f2(S.poly_W), cls: 'm6' },
        { sym: 'z', name: 'zoom', value: f2(S.poly_zoom), cls: 'm6' },
        { sym: '\\eta', name: 'refraction ratio', value: f2(S.refr_index), cls: 'm4' }],
      lines: [F + ' faces, ' + E + ' edges, ' + V + ' vertices; Schläfli symbol ' + sch,
              'Euler: ' + V + ' − ' + E + ' + ' + F + ' = 2'],
      tex: ['\\mathbf{p}_{xy} \\leftarrow |\\mathbf{p}_{xy}|, \\quad \\mathbf{p} \\leftarrow \\mathbf{p} - 2\\min(0,\\, \\mathbf{p}\\cdot\\mathbf{n}_c)\\,\\mathbf{n}_c \\quad (m\\ \\text{times})',
        'd(\\mathbf{p}) = z \\max_k \\bigl((\\mathbf{p}/z - \\mathbf{s})\\cdot\\mathbf{n}_k\\bigr)',
        '\\mathbf{s} = \\frac{U\\mathbf{a} + V\\mathbf{b} + W\\mathbf{c}}{\\lVert U\\mathbf{a} + V\\mathbf{b} + W\\mathbf{c}\\rVert}',
        '\\phi = (1 + \\mathbf{r}\\cdot\\mathbf{n})^2, \\quad L = (0.5 + 0.5\\phi)\\,L_{\\text{refl}} + (1 - 0.75\\phi)\\,L_{\\text{in}}'],
      rules: PLATE_RULES,
      eq: ['V − E + F = ' + V + ' − ' + E + ' + ' + F + ' = 2'],
      anchor: solidAnchor });
  } catch (e) {}
}
// The solid on screen, for the shell's label plate. The shader looks from
// (0, cam_y, cam_z) at the origin, so the centre of the solid is the
// centre of #c. Its circumradius is z (the seed point is a unit vector,
// scaled by zoom), and the ray of a pixel at p (short side -1..1) is
// -p.x u + p.y v + fov w, so the silhouette radius is
// z / sqrt(D^2 - z^2) * fov * (height / 2). No key points: one solid.
function solidAnchor() {
  const R = canvas.getBoundingClientRect(), z = S.poly_zoom, D = Math.hypot(S.cam_y, S.cam_z);
  if (!(D > z) || R.width < 2) return null;
  return { x: R.left + R.width / 2, y: R.top + R.height / 2, r: z / Math.sqrt(D * D - z * z) * S.fov * R.height / 2 };
}

// Hide the GUI, set the first look, and start the chain of legs. calm
// (1 = slowest) sets the orbit speed and the leg length.
saverEnter = (o) => {
  const calm = Math.max(0, Math.min(1, o.calm != null ? o.calm : 0.7));
  const st = document.createElement('style');
  st.textContent = 'body>*:not(#c){display:none!important}';
  document.head.appendChild(st);
  const rnd = mulberry((o.seed != null ? o.seed : Math.random() * 1e9) | 0);
  const A = saverLook(rnd), B = saverLook(rnd);
  A.poly_type = 3 + Math.floor(rnd() * 3);
  A.max_bounces = 4 + Math.floor(rnd() * 5);
  B.poly_type = A.poly_type; B.max_bounces = A.max_bounces;
  Object.assign(S, A);
  S.orbit_speed = 0.03 + 0.12 * (1 - calm);
  const leg = (10 + 16 * calm) * 1000;
  drift = { A, B, t0: performance.now(), hold: 0.35 * leg, dur: leg, rnd,
            label: typeof o.label === 'function' ? o.label : null, name: null };
  driftStep(performance.now());
  // The weights and the zoom drift, so the plate refreshes in place each second.
  setInterval(() => saverLabel(solidNow()), 1000);
  return { canvas, warmupMs: 1000 };
};
glReadyResolve();

// FPS accounting: lastTime for dt, accTime/frameCount to average over 0.5 s.
// ======== RENDER LOOP ========
let lastTime = 0;
let accTime = 0;
let frameCount = 0;
let displayFps = 0;

// Per-frame loop: update the FPS readout, apply auto orbit drift, recompute the
// Wythoff planes, push every uniform, and draw the covering quad.
function frame(now) {
  requestAnimationFrame(frame);
  const nowSec = now / 1000;
  const dt = nowSec - lastTime;
  lastTime = nowSec;

  frameCount++;
  accTime += dt;
  if (accTime >= 0.5) {
    displayFps = Math.round(frameCount / accTime);
    document.getElementById('fps').textContent = displayFps + ' fps';
    const sh = document.getElementById('stats-hud');
    if (sh) sh.textContent = displayFps + ' fps \u00b7 ' + canvas.width + '\u00d7' + canvas.height;
    frameCount = 0; accTime = 0;
  }

  // Screensaver: ease through the chain of seeded looks.
  if (drift) driftStep(performance.now());
  else updateAllSwatches();

  // Auto-rotate when idle. The two irrational-looking factors keep pitch and yaw
  // out of phase so the solid never settles into a repeating pose.
  // Orbit drift
  if (S.orbit_speed > 0 && !dragging) {
    const d = Math.min(dt, 0.1) * S.orbit_speed;
    S.rot_x += d * 0.7071;
    S.rot_y += d * 0.9131;
    syncSlider('rot_x'); syncSlider('rot_y');
  }

  // Rebuild the fold planes for this frame's U/V/W and symmetry order.
  const poly = computePoly();

  // Push scalar and vector uniforms: resolution, rotation, geometry, optics,
  // camera origin.
  gl.uniform2f(U.u_resolution, canvas.width, canvas.height);
  gl.uniform1f(U.u_rot_x, S.rot_x);
  gl.uniform1f(U.u_rot_y, S.rot_y);
  gl.uniform1i(U.u_poly_type, S.poly_type);
  gl.uniform1f(U.u_poly_zoom, S.poly_zoom);
  gl.uniform1f(U.u_inner_sphere, S.inner_sphere);
  gl.uniform1f(U.u_refr_index, S.refr_index);
  gl.uniform1i(U.u_max_bounces, S.max_bounces);
  gl.uniform1f(U.u_fov, S.fov);
  gl.uniform3f(U.u_ray_origin, 0, S.cam_y, S.cam_z);

  // Convert every light from HSV to RGB and push it. The absorption colour is
  // negated because the shader uses it as a Beer-Lambert extinction coefficient.
  const sun = hsv2rgb(S.sun_h, S.sun_s, S.sun_i);
  const floor = hsv2rgb(S.floor_h, S.floor_s, S.floor_i);
  const sky = hsv2rgb(S.sky_h, S.sky_s, S.sky_i);
  const g0 = hsv2rgb(S.glow0_h, S.glow0_s, S.glow0_i);
  const g1 = hsv2rgb(S.glow1_h, S.glow1_s, S.glow1_i);
  const beer = hsv2rgb(S.beer_h, S.beer_s, S.beer_i);

  gl.uniform3fv(U.u_sun_col, sun);
  gl.uniform3fv(U.u_bottom_col, floor);
  gl.uniform3fv(U.u_top_col, sky);
  gl.uniform3fv(U.u_glow_col0, g0);
  gl.uniform3fv(U.u_glow_col1, g1);
  gl.uniform3fv(U.u_beer_col, beer.map(v => -v));

  // Push the Wythoff fold planes and seed point computed above.
  gl.uniform3fv(U.u_poly_nc, poly.nc);
  gl.uniform3fv(U.u_poly_p, poly.p);
  gl.uniform3fv(U.u_poly_pab, poly.pab);
  gl.uniform3fv(U.u_poly_pbc, poly.pbc);
  gl.uniform3fv(U.u_poly_pca, poly.pca);

  // March-count and edge-width quality uniforms.
  gl.uniform1i(U.u_marches_inner, S.marches_inner);
  gl.uniform1i(U.u_marches_outer, S.marches_outer);
  gl.uniform1f(U.u_edge_thick, S.edge_thick);

  // One draw: the covering quad runs the ray-march shader per pixel.
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// Start the render loop.
requestAnimationFrame(frame);
})();
