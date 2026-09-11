(async () => {
const SH = {};
for (const _n of ['shaders/raymarch.vert.glsl', 'shaders/raymarch.frag.glsl']) {
  SH[_n] = await (await fetch(new URL(_n, document.baseURI))).text();
}

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

const DEFAULTS = { ...S };

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

// ======== POLY PARAMS ========
function computePoly() {
  const t = S.poly_type;
  const cospin = Math.cos(Math.PI / t);
  const scospin = Math.sqrt(Math.max(0, 0.75 - cospin * cospin));
  const nc = [-0.5, -cospin, scospin];
  const pab = [0, 0, 1];
  const pbc_ = [scospin, 0, 0.5];
  const pca_ = [0, scospin, cospin];
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

// ======== WEBGL ========
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
if (!gl) { document.body.innerHTML = '<h1 style="color:#fff;padding:40px">WebGL2 required</h1>'; throw 'no gl'; }

const VERT = SH['shaders/raymarch.vert.glsl'];

const FRAG = SH['shaders/raymarch.frag.glsl'];

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

// Fullscreen quad
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'a_pos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

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

function fmtVal(v, p) {
  if (p && p.fmt) return p.fmt(v);
  return Number(v).toFixed(v < 0.01 ? 4 : v < 1 ? 3 : 2);
}

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

function updateSwatch(prefix) {
  const el = document.getElementById('swatch-'+prefix);
  if (!el) return;
  const rgb = hsv2rgb(S[prefix+'_h'], S[prefix+'_s'], Math.min(S[prefix+'_i'], 1));
  el.style.background = `rgb(${rgb.map(v=>Math.round(v*255)).join(',')})`;
}

function updateAllSwatches() {
  for (const sec of SECTIONS) {
    if (sec.colors) sec.colors.forEach(c => updateSwatch(c.prefix));
  }
}

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

buildUI();

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

function syncAll() {
  for (const k of Object.keys(S)) syncSlider(k);
}

// ======== RANDOMIZE ========
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function randInt(lo, hi) { return Math.floor(rand(lo, hi + 1)); }
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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

// Add randomize button
const randBtn = document.createElement('button');
randBtn.className = 'preset-btn rand';
randBtn.textContent = '🎲 Random';
randBtn.onclick = randomize;
presetsDiv.insertBefore(randBtn, presetsDiv.firstChild);

// ======== MOUSE WHEEL ZOOM ========
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY * 0.008;
  S.cam_z = Math.max(-12, Math.min(-1, S.cam_z + delta));
  syncSlider('cam_z');
}, { passive: false });

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

// Toggle panel
const toggleBtn = document.getElementById('toggle-btn');
const panel = document.getElementById('panel');
toggleBtn.onclick = () => {
  panel.classList.toggle('hidden');
  toggleBtn.classList.toggle('open');
  toggleBtn.textContent = panel.classList.contains('hidden') ? '▶' : '◀';
};

// ======== RENDER LOOP ========
let lastTime = 0;
let accTime = 0;
let frameCount = 0;
let displayFps = 0;

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

  // Orbit drift
  if (S.orbit_speed > 0 && !dragging) {
    const d = Math.min(dt, 0.1) * S.orbit_speed;
    S.rot_x += d * 0.7071;
    S.rot_y += d * 0.9131;
    syncSlider('rot_x'); syncSlider('rot_y');
  }

  const poly = computePoly();

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

  gl.uniform3fv(U.u_poly_nc, poly.nc);
  gl.uniform3fv(U.u_poly_p, poly.p);
  gl.uniform3fv(U.u_poly_pab, poly.pab);
  gl.uniform3fv(U.u_poly_pbc, poly.pbc);
  gl.uniform3fv(U.u_poly_pca, poly.pca);

  gl.uniform1i(U.u_marches_inner, S.marches_inner);
  gl.uniform1i(U.u_marches_outer, S.marches_outer);
  gl.uniform1f(U.u_edge_thick, S.edge_thick);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

requestAnimationFrame(frame);
})();
