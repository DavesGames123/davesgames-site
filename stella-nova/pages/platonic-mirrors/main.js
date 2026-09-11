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
//      render loop ........ "RENDER LOOP"      orbit drift, uniforms, draw, FPS
// ============================================================================
(async () => {
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

// Random helpers: float range, inclusive int range, and array pick.
// ======== RANDOMIZE ========
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function randInt(lo, hi) { return Math.floor(rand(lo, hi + 1)); }
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Draw a whole new solid: symmetry, U/V/W, camera, optics, and every light, each
// from a hand-tuned range so the result stays renderable. Then sync the panel.
function randomize() {
  S.poly_type = randInt(2, 5);
  S.poly_U = rand(0, 2.5);
  S.poly_V = rand(0, 2.5);
  S.poly_W = rand(0, 2.5);
  S.poly_zoom = rand(1.2, 3.5);
  S.inner_sphere = rand(0.2, 2.0);
  S.edge_thick = rand(0.0008, 0.012);
  S.rot_x = rand(-3.14, 3.14);
  S.rot_y = rand(-3.14, 3.14);
  S.orbit_speed = rand(0.02, 0.4);
  S.refr_index = rand(0.4, 1.3);
  S.max_bounces = randInt(2, 10);
  S.fov = rand(1.0, 3.5);
  S.cam_y = rand(-1, 3);
  S.cam_z = rand(-8, -2.5);
  S.sun_h = rand(0, 1); S.sun_s = rand(0.4, 1); S.sun_i = rand(0.002, 0.05);
  S.floor_h = rand(0, 1); S.floor_s = rand(0.3, 1); S.floor_i = rand(0.2, 1.0);
  S.sky_h = rand(0, 1); S.sky_s = rand(0.3, 1); S.sky_i = rand(0.3, 1.5);
  S.glow0_h = rand(0, 1); S.glow0_s = rand(0.3, 1); S.glow0_i = rand(0.0003, 0.005);
  S.glow1_h = rand(0, 1); S.glow1_s = rand(0.3, 1); S.glow1_i = rand(0.0003, 0.005);
  S.beer_h = rand(0, 1); S.beer_s = rand(0.3, 1); S.beer_i = rand(0.5, 4.0);
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

  updateAllSwatches();

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
