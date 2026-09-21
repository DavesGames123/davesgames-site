// ============================================================================
//  FIRE TABLE (EVOLVED 1)  ·  build.mjs — the single source of truth
// ────────────────────────────────────────────────────────────────────────────
//  A second fire page. It evolves the nine cells the user picked as favorites
//  into 60 refined, randomized variants, one family per favorite. Run with:
//      node build.mjs
//
//  The WGSL helper library is REUSED verbatim from the shipped fire-table pack
//  (../fire-table/shaders/pack.wgsl, the head before its cell marker), so the
//  flame, coal, spark, noise and palette code cannot drift between the two
//  pages. This generator only appends the 60 evolved fragment shaders.
//
//  EVOLUTION MODEL
//    A seeded PRNG (mulberry32, fixed seed) picks each variant's baked
//    constants — scale, rise, seeds, octaves, sharpness — and a few structural
//    mutations (a domain curl, a second layer, an ember underlay, a flicker).
//    The seed is fixed, so node build.mjs reproduces the same 60 every run.
//    Change the seed below to draw a fresh 60.
//
//  FAVORITES EVOLVED (family = the favorite it grew from)
//    firestorm · curtain · licks · firefly · sparkshower · cinders · sparks
//    · furnace · gasjet
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const SEED = 0xF12E5EED; // change this integer to draw a fresh 60

// ── reuse the proven helper library from the first fire table ────────────────
const src = readFileSync(join(DIR, '..', 'fire-table', 'shaders', 'pack.wgsl'), 'utf8');
const marker = '// ── the 60 cells';
if (!src.includes(marker)) throw new Error('helper marker not found in fire-table pack.wgsl');
const HELPERS = src.split(marker)[0];

// ── seeded PRNG and formatting helpers ───────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const R = (lo, hi) => lo + (hi - lo) * rng();          // random float in range
const wf = x => (Math.round(x * 1000) / 1000).toFixed(3); // WGSL float literal
const P = arr => arr[Math.floor(rng() * arr.length)];  // pick one
const C = p => rng() < p;                              // chance
const SD = () => `${Math.floor(rng() * 90000) + 1000}u`; // WGSL u32 seed
const OCT = () => P([3, 4, 5]);

// ── the nine evolution templates ─────────────────────────────────────────────
//  Each returns { knobs, tags, body }. body reads uv, t, k and returns a vec4f.

function tFirestorm() {
  const SX = R(2.2, 4.5), SY = R(1.6, 2.6), RISE = R(1.3, 2.6), O1 = OCT(), O2 = P([4, 5]),
    SA = SD(), SB = SD(), MUL = R(1.6, 2.6), TOP = R(1.05, 1.3), FALL = R(0.05, 0.2), CH = R(0.6, 1.3);
  const curl = C(0.5), ROT = R(1.0, 3.0), shape = P(['none', 'col', 'wall']), PW = R(1.0, 3.0), ember = C(0.4);
  const tags = []; if (curl) tags.push('curled'); if (shape !== 'none') tags.push(shape); if (ember) tags.push('ember'); if (RISE > 2.0) tags.push('fast');
  const L = [];
  L.push(`  var q = vec2f(uv.x * ${wf(SX)} * (0.7 + 0.6 * k.x), uv.y * ${wf(SY)} - t * ${wf(RISE)} * (0.6 + 0.8 * k.z));`);
  if (curl) L.push(`  q = rot2(uv.y * ${wf(ROT)}) * q;`);
  L.push(`  let m = ridged(q, ${O1}, ${SA}) * (0.5 + fbm01(q * ${wf(MUL)}, ${O2}, ${SB}));`);
  L.push(`  var sh = 1.0;`);
  if (shape === 'col') L.push(`  sh = exp(-uv.x * uv.x * ${wf(PW)});`);
  if (shape === 'wall') L.push(`  sh = 1.0 - 0.3 * abs(sin(uv.x * 6.0));`);
  L.push(`  var h = m * sh * smoothstep(${wf(TOP)}, -0.05, uv.y) * (1.0 + ${wf(CH)} * k.y) - uv.y * ${wf(FALL)};`);
  if (ember) L.push(`  h += coals(uv, t) * 0.4;`);
  L.push(`  return firePresent(clamp(h, 0.0, 2.0));`);
  return { knobs: ['scale', 'chaos', 'rise', ''], tags, body: L.join('\n') };
}

function tCurtain() {
  const SX = R(2.0, 5.0), SY = R(2.0, 2.6), RISE = R(1.2, 2.2), WARP = R(0.3, 1.4),
    FX = R(1.5, 2.6), FY = R(1.5, 2.6), TS = R(0.7, 1.3), O = P([4, 5]), SDv = SD(), AMP = R(1.4, 2.0), FALL = R(0.15, 0.3);
  const sharp = C(0.5), fold = C(0.35);
  const tags = []; if (sharp) tags.push('sharp'); if (fold) tags.push('folded'); if (WARP > 1.0) tags.push('billowy');
  const L = [];
  L.push(`  let q = vec2f(uv.x * ${wf(SX)} * (0.6 + 0.8 * k.x), uv.y * ${wf(SY)} - t * ${wf(RISE)} * (0.6 + 0.8 * k.z));`);
  L.push(`  let w = q + ${wf(WARP)} * (0.4 + 1.2 * k.y) * vec2f(sin(q.y * ${wf(FY)} + t * ${wf(TS)}), sin(q.x * ${wf(FX)} - t * ${wf(TS)}));`);
  L.push(`  var n = fbm01(w, ${O}, ${SDv});`);
  if (fold) L.push(`  n = abs(n - 0.5) * 2.0;`);
  if (sharp) L.push(`  n = pow(n, 1.8);`);
  L.push(`  return firePresent(clamp(n * smoothstep(1.15, -0.05, uv.y) * ${wf(AMP)} - uv.y * ${wf(FALL)}, 0.0, 2.0));`);
  return { knobs: ['warp scale', 'warp amt', 'rise', ''], tags, body: L.join('\n') };
}

function tLicks() {
  const SXX = R(2.5, 4.2), SYY = R(1.8, 2.4), SP = R(1.5, 3.0), SHARP = R(1.5, 3.5), PROFW = R(0.55, 0.85), AMP = R(1.5, 1.95), FALL = R(0.2, 0.3);
  const mirror = C(0.4);
  const tags = []; if (mirror) tags.push('mirrored'); if (SHARP > 2.6) tags.push('thin'); if (SP > 2.4) tags.push('fast');
  const L = [];
  L.push(`  let pp = vec2f(uv.x * ${wf(SXX)} * (0.7 + 0.6 * k.z), uv.y * ${wf(SYY)} - t * ${wf(SP)} * (0.6 + 0.8 * k.y));`);
  L.push(`  var s = sumSines(pp, ${wf(SHARP)} + 2.0 * k.x, 2.0, t);`);
  if (mirror) L.push(`  s = max(s, sumSines(vec2f(-pp.x, pp.y), ${wf(SHARP)} + 2.0 * k.x, 2.0, t + 4.0));`);
  L.push(`  let taper = smoothstep(1.1, -0.05, uv.y) * smoothstep(-0.1, 0.15, uv.y);`);
  L.push(`  let prof = 1.0 - smoothstep(0.0, ${wf(PROFW)}, abs(uv.x));`);
  L.push(`  return firePresent(clamp(s * taper * prof * ${wf(AMP)} - uv.y * ${wf(FALL)}, 0.0, 2.0));`);
  return { knobs: ['sharpen', 'speed', 'width', ''], tags, body: L.join('\n') };
}

function tFirefly() {
  const G = R(4.0, 11.0), TH = R(0.55, 0.78), RATE = R(1.0, 4.0), EXP = R(2.0, 3.5), SIZE = R(0.4, 0.6), SDv = SD();
  const drift = C(0.45), DR = R(0.1, 0.35);
  const tags = []; if (drift) tags.push('rising'); if (G > 8) tags.push('dense'); if (RATE > 3) tags.push('fast twinkle');
  const L = [];
  L.push(`  let uw = uv - vec2f(0.0, t * ${drift ? wf(DR) : '0.0'});`);
  L.push(`  let g = ${wf(G)} * (0.6 + 0.8 * k.x);`);
  L.push(`  let q = uw * g; let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;`);
  L.push(`  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {`);
  L.push(`    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), ${SDv});`);
  L.push(`    if (r.z < ${wf(TH)}) { continue; }`);
  L.push(`    let d = length(f - vec2f(o) - r.xy);`);
  L.push(`    let tw = 0.6 + 0.4 * sin(t * ${wf(RATE)} * (0.5 + k.y) + r.x * TAU);`);
  L.push(`    v += tw * pow(max(1.0 - d / ${wf(SIZE)}, 0.0), ${wf(EXP)});`);
  L.push(`  } }`);
  L.push(`  return firePresent(clamp(v * (1.2 + 0.8 * k.z), 0.0, 1.6));`);
  return { knobs: ['count', 'twinkle', 'glow', ''], tags, body: L.join('\n') };
}

function tSparkShower() {
  const DENS = R(0.6, 1.0), SP = R(0.8, 1.8), SA = SD(), SB = SD(), BASEW = R(0.25, 0.42), BASER = R(1.4, 2.0), BASEAMT = R(0.15, 0.5);
  const coal = C(0.5);
  const tags = []; if (coal) tags.push('coal bed'); if (SP > 1.4) tags.push('fast'); if (DENS > 0.85) tags.push('dense');
  const L = [];
  L.push(`  let dn = ${wf(DENS)} * (0.7 + 0.5 * k.x); let sp = ${wf(SP)} * (0.6 + 0.8 * k.y);`);
  L.push(`  let s = sparks(uv, t, dn, sp, ${SA}) + sparks(uv, t + 5.0, dn, sp, ${SB});`);
  L.push(`  var h = s * 1.3 + colFlame(uv, t, ${wf(BASEW)}, ${wf(BASER)}, 0.8) * (${wf(BASEAMT)} + 0.4 * k.z);`);
  if (coal) L.push(`  h += coals(uv, t) * 0.4;`);
  L.push(`  return firePresent(h);`);
  return { knobs: ['density', 'speed', 'base', ''], tags, body: L.join('\n') };
}

function tCinders() {
  const SX = R(5.0, 8.0), DRIFT = R(0.15, 0.45), W = R(0.1, 0.22), SDv = SD(), SD2 = SD();
  const layer2 = C(0.45), twinkle = C(0.45);
  const tags = []; if (layer2) tags.push('two layers'); if (twinkle) tags.push('twinkle'); if (DRIFT > 0.35) tags.push('fast drift');
  const L = [];
  L.push(`  let q = vec2f(uv.x * ${wf(SX)} + sin(t * 0.5) * 0.5, (uv.y - t * ${wf(DRIFT)} * (0.6 + 0.8 * k.y)) * ${wf(SX)});`);
  L.push(`  var s = spots(q, ${wf(W)} * (0.7 + 0.6 * k.x), ${SDv});`);
  if (layer2) L.push(`  s += spots(q * 1.3 + 3.0, ${wf(W)} * 0.8, ${SD2}) * 0.7;`);
  L.push(`  var h = smoothstep(0.3, 0.9, s) * smoothstep(1.1, -0.1, uv.y) * 1.4;`);
  if (twinkle) L.push(`  h *= 0.7 + 0.5 * sin(t * 3.0 + s * 6.0);`);
  L.push(`  return firePresent(h * (0.8 + 0.6 * k.z));`);
  return { knobs: ['size', 'drift', 'glow', ''], tags, body: L.join('\n') };
}

function tSparks() {
  const DENS = R(0.4, 0.9), SP = R(0.5, 1.3), SDv = SD(), COAL = R(0.3, 0.6), GLOW = R(1.0, 1.8);
  const twin = C(0.4), SD2 = SD();
  const tags = []; if (twin) tags.push('twin trails'); if (SP > 1.0) tags.push('fast'); if (COAL > 0.5) tags.push('hot bed');
  const L = [];
  L.push(`  let dn = ${wf(DENS)} * (0.6 + 0.8 * k.x); let sp = ${wf(SP)} * (0.6 + 0.8 * k.y);`);
  L.push(`  var s = sparks(uv, t, dn, sp, ${SDv});`);
  if (twin) L.push(`  s += sparks(uv, t + 7.0, dn * 0.8, sp * 1.2, ${SD2}) * 0.8;`);
  L.push(`  return firePresent(s * (${wf(GLOW)} * (0.7 + 0.6 * k.z)) + coals(uv, t) * ${wf(COAL)});`);
  return { knobs: ['density', 'speed', 'glow', ''], tags, body: L.join('\n') };
}

function tFurnace() {
  const W = R(0.32, 0.55), RISE = R(1.6, 2.8), DET = R(1.0, 2.0), COAL = R(0.3, 0.6), OFF = R(0.12, 0.28);
  const dbl = C(0.45), spark = C(0.4);
  const tags = []; if (dbl) tags.push('twin core'); if (spark) tags.push('sparking'); if (RISE > 2.3) tags.push('roaring');
  const L = [];
  L.push(`  var h = colFlame(uv, t, ${wf(W)} * (0.7 + 0.5 * k.x), ${wf(RISE)} * (0.6 + 0.8 * k.z), ${wf(DET)} + k.y);`);
  if (dbl) L.push(`  h = max(h, colFlame(uv + vec2f(${wf(OFF)}, 0.0), t + 3.0, ${wf(W)} * 0.9, ${wf(RISE)}, ${wf(DET)}));`);
  L.push(`  h = h * 1.15 + coals(uv, t) * ${wf(COAL)};`);
  if (spark) L.push(`  h += sparks(uv, t, 0.5, 1.0, 71u) * 0.8;`);
  L.push(`  return firePresent(h);`);
  return { knobs: ['width', 'detail', 'rise', ''], tags, body: L.join('\n') };
}

function tGasJet() {
  const W = R(0.07, 0.16), RISE = R(2.2, 3.6), COREW = R(0.04, 0.12), FR = R(6.0, 12.0);
  const flick = C(0.5);
  const tags = []; if (flick) tags.push('flickering'); if (RISE > 3.0) tags.push('fast'); if (W < 0.1) tags.push('needle');
  const L = [];
  L.push(`  var h = colFlame(uv, t, ${wf(W)} * (0.7 + 0.6 * k.x), ${wf(RISE)} * (0.7 + 0.6 * k.y), 0.3);`);
  if (flick) L.push(`  h *= 0.7 + 0.3 * sin(t * ${wf(FR)} + fbm(vec2f(t * 0.7, 0.0), 2, 9u) * 3.0);`);
  L.push(`  let core = (1.0 - smoothstep(0.0, ${wf(COREW)}, abs(uv.x))) * smoothstep(0.6, 0.0, uv.y);`);
  L.push(`  return firePresent(h + core * (0.5 + 0.4 * k.z));`);
  return { knobs: ['width', 'rise', 'core', ''], tags, body: L.join('\n') };
}

// ── families (legend order, fire-hued) and their counts ──────────────────────
const FAMS = [
  { key: 'firestorm',   label: 'Firestorm',    n: 8, t: tFirestorm,   legend: 'rgba(255,80,40,0.14)' },
  { key: 'curtain',     label: 'Curtain',      n: 6, t: tCurtain,     legend: 'rgba(255,140,60,0.13)' },
  { key: 'licks',       label: 'Licks',        n: 6, t: tLicks,       legend: 'rgba(255,120,40,0.14)' },
  { key: 'firefly',     label: 'Firefly coals', n: 7, t: tFirefly,    legend: 'rgba(255,200,90,0.13)' },
  { key: 'sparkshower', label: 'Spark shower', n: 7, t: tSparkShower, legend: 'rgba(255,170,70,0.14)' },
  { key: 'cinders',     label: 'Cinders',      n: 7, t: tCinders,     legend: 'rgba(255,150,60,0.13)' },
  { key: 'sparks',      label: 'Sparks',       n: 7, t: tSparks,      legend: 'rgba(255,100,50,0.14)' },
  { key: 'furnace',     label: 'Furnace',      n: 6, t: tFurnace,     legend: 'rgba(255,90,40,0.14)' },
  { key: 'gasjet',      label: 'Gas jet',      n: 6, t: tGasJet,      legend: 'rgba(120,180,255,0.13)' },
];
const FAM = {}; for (const f of FAMS) FAM[f.key] = f.legend;

// ── build the 60 cells ───────────────────────────────────────────────────────
const CELLS = [];
for (const f of FAMS) {
  for (let i = 1; i <= f.n; i++) {
    const v = f.t();
    const name = `${f.key}_${String(i).padStart(2, '0')}`;
    const species = `${f.label} variant · ${v.tags.length ? v.tags.join(', ') : 'clean'}`;
    CELLS.push([name, f.key, species, v.knobs, v.body]);
  }
}

// ── emit pack.wgsl ───────────────────────────────────────────────────────────
const frag = ([name, , , , body]) =>
  `@fragment fn fs_${name}(@builtin(position) fp: vec4f) -> @location(0) vec4f {\n  let uv = fuv(fp.xy);\n  let t = u.time;\n  let k = u.k;\n${body}\n}`;
const pack = HELPERS + '// ── the 60 evolved cells ─────────────────────────────────────────────────────\n' +
  CELLS.map(frag).join('\n\n') + '\n';

// ── emit spec.json ───────────────────────────────────────────────────────────
const spec = {
  cols: 6,
  uniform_bytes: 96,
  cells: CELLS.map(([name, family, species, knobs]) => ({ name, family, species, knobs, defaults: [0.5, 0.5, 0.5, 0.5], fn: 'fs_' + name })),
  gens: [
    { id: 'exposure', title: 'Exposure · brightness', fn: 'flat', period: 10, amp: 0.4, bias: 0.5, phase: 0,
      map: 'y => Math.pow(2, (y - 0.5) * 5)', unit: "v => (Math.log2(v) >= 0 ? '+' : '') + Math.log2(v).toFixed(1) + ' ev'" },
    { id: 'tempo', title: 'Tempo · hover speed', fn: 'flat', period: 8, amp: 0.0, bias: 0.5, phase: 0,
      map: 'y => 0.1 + 2.9 * y', unit: "v => v.toFixed(2) + 'x'" },
    { id: 'contrast', title: 'Contrast · flame edge', fn: 'flat', period: 10, amp: 0.3, bias: 0.5, phase: 0,
      map: 'y => 0.5 + 2.0 * y', unit: "v => v.toFixed(2) + 'x'" },
  ],
  swatches: [
    { id: 'ink', label: 'Char', hex: '#0a0503' },
    { id: 'tone', label: 'Flame', hex: '#e2531a' },
    { id: 'cream', label: 'Hot', hex: '#ffd27a' },
  ],
};

// ── emit index.html ──────────────────────────────────────────────────────────
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const legend = FAMS.map(f => `<span class="f-${f.key}"><i></i>${f.label}</span>`).join('');
const tiles = CELLS.map(([name, family, species]) =>
  `<div class="cell f-${family}" role="button" tabindex="0" id="tile-${name}" aria-label="${esc(name.replace(/_/g, ' ') + ': ' + species)}"><canvas></canvas><span class="orb-status"></span><span class="tag">${name.replace(/_/g, ' ')}</span></div>`).join('');
const swatchHtml = spec.swatches.map(s => `<label class="swatch"><span>${s.label}</span><input type="color" id="sw-${s.id}" value="${s.hex}"></label>`).join('');

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fire Table (Evolved 1) // Stella Nova</title>
<!--
  ════════════════════════════════════════════════════════════════════════════
   FIRE TABLE (EVOLVED 1)  ·  page shell (GENERATED by build.mjs)
  ────────────────────────────────────────────────────────────────────────────
   ${CELLS.length} refined, randomized evolutions of the nine favorite fire cells.
   One fragment shader per cell, on the shared table-engine. Regenerate with
   node build.mjs; the helper library is reused from ../fire-table.
  ════════════════════════════════════════════════════════════════════════════
-->
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<script>if(window!==window.top)document.documentElement.classList.add("in-frame")</script>
<div class="grid-bg"></div>
<div class="topbar">
  <div class="topbar-l"><span class="sys-name">Stella Nova</span><span class="sys-status">Fire Table · Evolved 1</span></div>
  <div class="topbar-r">SYS // <strong>WGSL SHADER LAB</strong></div>
</div>
<div id="side">
  <div class="side-head"><div class="big">fire · ev1</div><div class="sub">|${CELLS.length} evolved · ${FAMS.length} favorites⟩</div></div>
  <div class="legend">${legend}</div>
  <div id="gens"></div>
  <div class="sec"><div class="sec-lbl">Palette</div><div class="swatches">${swatchHtml}</div></div>
  <div class="sec"><button class="chip on" id="hoveronly" type="button" aria-pressed="true">◉ animate on hover only</button></div>
  <div class="fps" id="fps"></div>
</div>
<div id="nogpu" class="nogpu" hidden>WebGPU is not available in this browser, so the table cannot render. Chrome, Edge, and Safari 26 have it on by default; Firefox has it behind <code>dom.webgpu.enabled</code>.</div>
<div id="stage"><div id="table">${tiles}</div></div>
<div id="modal" role="dialog" aria-modal="true" aria-labelledby="m-name">
  <div class="sheet">
    <div class="sheet-side">
      <canvas id="m-orb" width="220" height="220"></canvas>
      <h3 id="m-name"></h3><div class="fn" id="m-fn"></div><p id="m-species"></p><div id="m-knobs"></div>
    </div>
    <div class="sheet-main">
      <div class="sheet-head"><span class="lbl" id="m-src-lbl">WGSL</span><button class="panel-btn" id="m-copy" type="button">Copy function</button><button class="panel-btn" id="m-copy-pack" type="button">Copy library</button><button class="panel-btn" id="m-close" type="button">Close ✕</button></div>
      <pre id="m-src" tabindex="0"></pre>
    </div>
  </div>
</div>

<script type="module" src="main.js"></script>

</body>
</html>
`;

// ── emit main.js and page.js (same contract as fire-table) ───────────────────
const mainJs = `// ============================================================================
//  FIRE TABLE (EVOLVED 1)  ·  main.js — data load and boot (GENERATED)
//  Regenerate with: node build.mjs
// ============================================================================
import { bootTable } from '../../lib/table-engine.js';
import { loadShaders } from '../../lib/shaders.js';
import { PAGE } from './page.js';

const SH = await loadShaders(import.meta.url, ['shaders/pack.wgsl']);
const spec = await (await fetch(new URL('spec.json', import.meta.url))).json();

bootTable(PAGE, { spec, pack: SH['shaders/pack.wgsl'] });
`;

const pageJs = `// ============================================================================
//  FIRE TABLE (EVOLVED 1)  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  ${CELLS.length} procedural fires; one fragment shader per cell, each reading only a
//  shared uniform buffer. Identical contract to the first fire table.
//  UNIFORM LAYOUT (96 bytes, struct FireU in shaders/pack.wgsl)
//    0..1 size · 2 time · 3 pixelScale · 4..7 ink · 8..11 tone · 12..15 cream
//    16 exposure · 17 contrast · 18 glow · 19 pad · 20..23 k
// ============================================================================
export const PAGE = {
  async init(ctx) {
    const { device, format, tiles, PACK } = ctx; this.ctx = ctx;
    this.bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    for (const t of tiles) device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_' + t.s.name, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      .then(p => { t.pipeline = p; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
  },
  bind(surf) { if (!surf.page.bind) surf.page.bind = this.ctx.device.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }] }); return surf.page.bind; },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d[16] = G.exposure; d[17] = G.contrast; d[18] = 1.0; d[19] = 0;
    d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('fs_' + t.s.name); },
};
`;

// ── emit style.css (clone color-table, append the fire families) ─────────────
const famCss = Object.entries(FAM).map(([f, c]) =>
  `.f-${f}{--fam:${c};--fam-bg:${c.replace(/[\d.]+\)$/, '0.06)')}}`).join('\n');
const baseCss = readFileSync(join(DIR, '..', 'color-table', 'style.css'), 'utf8');
const css = baseCss + `
/* ── fire families (appended by build.mjs) ───────────────────────────────── */
${famCss}
.side-head .big{color:#ff8a3c}
`;

// ── write everything ─────────────────────────────────────────────────────────
mkdirSync(join(DIR, 'shaders'), { recursive: true });
writeFileSync(join(DIR, 'shaders', 'pack.wgsl'), pack);
writeFileSync(join(DIR, 'spec.json'), JSON.stringify(spec));
writeFileSync(join(DIR, 'index.html'), indexHtml);
writeFileSync(join(DIR, 'main.js'), mainJs);
writeFileSync(join(DIR, 'page.js'), pageJs);
writeFileSync(join(DIR, 'style.css'), css);

const fam = {}; for (const [, f] of CELLS) fam[f] = (fam[f] || 0) + 1;
console.log('seed        : 0x' + SEED.toString(16));
console.log('cells       : ' + CELLS.length);
console.log('per family  : ' + JSON.stringify(fam));
console.log('fs_ entries : ' + (pack.match(/@fragment fn fs_/g) || []).length);
console.log('names unique: ' + (new Set(CELLS.map(c => c[0])).size === CELLS.length));
console.log('helpers head: reused ' + HELPERS.split('\n').length + ' lines from ../fire-table');
console.log('wrote pack.wgsl, spec.json, index.html, main.js, page.js, style.css');
