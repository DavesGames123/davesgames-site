// ============================================================================
//  PLANT GROWTH  ·  controls, frame loop and screensaver hook
// ----------------------------------------------------------------------------
//  A plant grows live: grow.js steps the space colonisation model at the
//  growth speed, roots.js adds DLA root particles in a time budget per
//  frame, pose.js turns both into the GPU rows each frame (smooth growth,
//  pipe radius, wind), and render.js draws them.
//
//  CLOCK. clock counts growth steps (fractional). A step runs when clock
//  passes plant.iter. A segment born at step k grows over clock k..k+1, a
//  leaf unfolds over 3 steps, a flower over 6. After the plant is done the
//  clock runs on for 30 more steps, so the late leaves and flowers open.
//
//  FRAMING. The panel, the dock, the status bar and the explain drawer
//  cover parts of the canvas. occlusion() measures them, and
//  camera.setViewOffset puts the plant in the centre of the clear part.
//  On a new plant the camera glides to fit the sphere round the crown and
//  the soil (saver.js fitDistance). A drag stops the glide.
//
//  PHONES. A coarse pointer caps nodes (2600), attractors (60%), leaves
//  and root particles (1100), and spends less time per frame on roots.
//
//  grep -n targets
//    state ................. "const S = "
//    new plant ............. "function regrow"
//    frame loop ............ "function frame"
//    camera glide .......... "function frameTo"
//    overlays .............. "function occlusion"
//    controls .............. "function buildUI"
//    readout ............... "function readout"
//    screensaver ........... "window.snSaver"
// ============================================================================
import { SPECIES, SPECIES_IDS, createPlant, envelopeBounds } from './grow.js';
import { createRoots } from './roots.js';
import { COLOUR_MODES, plantView, rootsView, createPoser } from './pose.js';
import { fitDistance, bandFrame, makeShots, shotRate, codeExtract } from './saver.js';
import { createRender } from './render.js';
import { createDiagram } from './diagram.js';
import { GRADIENTS, cssGradient, mountGradientPicker } from '../../lib/growth-gradients.js';
import { rng } from '../../lib/dla-engine.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const CAP_NODES = COARSE ? 2600 : 6000, CAP_ROOTS = COARSE ? 1100 : 2400, CAP_LEAVES = CAP_NODES * 2 + 600;
const BASE_RATE = 5;          // growth steps per second at speed 1
const FOV = 40;

const S = {
  species: 'oak', seed: 7, crown: 1, di: 2.4, dk: 0.62, D: 0.32, tropism: 1, speed: 1, paused: false,
  leaves: true, roots: true, wind: 0.35, mode: 'natural', grad: 'forest', rev: false,
};
let plant = null, view = null, roots = null, rview = null, rootsAge = 0;
let clock = 0, time = 0, leafSeen = -1, saverOn = false, saverBand = null;
const poser = createPoser(), rposer = createPoser();

const R = createRender({ canvas: $('gl'), coarse: COARSE, capNodes: CAP_NODES, capRoots: CAP_ROOTS, capLeaves: CAP_LEAVES });
if (!R || !R.renderer.capabilities.isWebGL2) $('nogl').hidden = false;

// ----------------------------------------------------------- a new plant
function speciesDefaults(id) {
  const sp = SPECIES[id];
  S.di = sp.di; S.dk = sp.dk; S.D = sp.D;
}

function regrow() {
  const sp = SPECIES[S.species];
  plant = createPlant({
    species: S.species, seed: S.seed, crown: S.crown, D: S.D * S.crown, di: S.di * S.crown, dk: S.dk * S.crown,
    tropism: S.tropism, n: sp.n * (COARSE ? 0.6 : 1), maxNodes: CAP_NODES,
  });
  view = plantView(plant); poser.reset(); clock = 0; leafSeen = -1;
  const B = envelopeBounds(plant.env), rx = Math.max(B[3], -B[0]);
  const plR = Math.max(1.7, rx * 1.18), plD = Math.max(1.1, plR * 0.58);
  roots = createRoots({
    seed: (S.seed * 2654435761) >>> 0 || 1, max: CAP_ROOTS, scale: 0.78 * plD / (1.15 * Math.sqrt(CAP_ROOTS)),
    r0: 0.006 * S.crown, rTop: sp.r0 * 6 * S.crown, lean: [1, 1],
  });
  rview = rootsView(roots); rposer.reset(); rootsAge = 0;
  if (R) {
    R.setSpecies(sp, S.crown); R.setPlant(plant); R.setPlinth(plR, plD); R.setRootsOn(S.roots);
    R.setBlob(rx * 1.05); R.branches.setCount(0); R.roots.setCount(0);
    frameTo(true);
  }
  readout(true);
}

// The sphere round what the camera frames: the crown, the stem and, with
// roots on, the soil block.
function subject() {
  const B = envelopeBounds(plant.env), rx = Math.max(B[3], -B[0]);
  const pl = R ? R.plinth : { R: rx, D: 1 };
  const top = B[4], bot = S.roots ? -pl.D * 0.85 : 0;
  const w = Math.max(rx, S.roots ? pl.R * 0.8 : rx * 0.8);
  return { c: [0, (top + bot) / 2, 0], r: Math.hypot(w, (top - bot) / 2) * 0.86 };
}

// ----------------------------------------------------------- camera glide
const glide = { on: false, t: 0, from: null, to: null };
function frameTo(animate) {
  if (!R) return;
  const s = subject(), cam = R.camera, ctl = R.controls;
  const w = innerWidth, h = innerHeight, o = occlusion(w, h);
  const hF = Math.max(0.3, (h - o.t - o.b) / h), wF = Math.max(0.3, (w - o.l - o.r) / w);
  const d = fitDistance(s.r, FOV, w / h, hF, wF, saverOn ? 0.84 : 0.92);
  const dir = cam.position.clone().sub(ctl.target);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.4, 1);
  dir.y = Math.max(dir.y, 0.15 * dir.length()); dir.normalize();
  const to = { target: [s.c[0], s.c[1], s.c[2]], pos: [s.c[0] + dir.x * d, s.c[1] + dir.y * d, s.c[2] + dir.z * d] };
  if (!animate) { ctl.target.set(...to.target); cam.position.set(...to.pos); glide.on = false; return; }
  glide.on = true; glide.t = 0; glide.to = to;
  glide.from = { target: ctl.target.toArray(), pos: cam.position.toArray() };
}
function glideStep(dt) {
  if (!glide.on) return;
  glide.t = Math.min(1, glide.t + dt / 1.4);
  const e = glide.t * glide.t * (3 - 2 * glide.t), f = glide.from, t = glide.to;
  R.controls.target.set(...f.target.map((v, i) => v + (t.target[i] - v) * e));
  R.camera.position.set(...f.pos.map((v, i) => v + (t.pos[i] - v) * e));
  if (glide.t >= 1) glide.on = false;
}

// ------------------------------------------------------------- overlays
// Margins in CSS px that the overlays cover. An overlay wider than tall
// covers the top or the base; any other covers a side. It counts only when
// it spans half of that edge or more. In the saver, the plate band counts.
const OVERLAYS = ['panel', 'dock', 'status', 'explain', 'legend'].map($).concat([document.querySelector('.topbar')]).filter(Boolean);
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (saverOn) {
    const f = bandFrame(saverBand, w, h);
    o.t = f.t; o.b = f.b;
    return o;
  }
  for (const el of OVERLAYS) {
    if (el.hidden) continue;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) {
      if (fw < 0.5) continue;
      if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1);
    } else {
      if (fh < 0.5) continue;
      if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0);
    }
  }
  return o;
}
const occ = { l: 0, r: 0, t: 0, b: 0 };

// ---------------------------------------------------------------- frame
let last = performance.now(), frameNo = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  time += dt;
  if (!plant || !R) return;
  if (!S.paused) {
    const rate = (saverOn ? saverRate : BASE_RATE) * S.speed;
    clock += dt * rate;
    if (plant.done) clock = Math.min(clock, plant.iter + 30);
    let k = 0;
    while (!plant.done && plant.iter < clock && k++ < 3) plant.step();
    if (!plant.done && clock > plant.iter + 1) clock = plant.iter + 1;
    if (S.roots && roots.count < roots.max) {
      const target = roots.max * Math.min(1, 0.12 + 0.95 * plant.progress);
      if (roots.count < target) { roots.growFor(COARSE ? 2.5 : 4.5); roots.stamp(clock); rootsAge = clock; }
    }
  }
  if (plant.leafCount !== leafSeen) { R.setLeaves(plant.leaves, plant.leafCount); leafSeen = plant.leafCount; }
  const range = { yMin: S.roots ? -roots.depth : 0, yMax: Math.max(0.5, plant.maxY) };
  const ageRef = Math.max(1, plant.done ? plant.iter - 1 : clock - 1);
  const n = poser.fill(view, { clock, time, dt, wind: S.wind, mode: S.mode, range, ageRef }, R.branches.posData, R.branches.colData);
  R.branches.setCount(n);
  if (S.roots) {
    const m = rposer.fill(rview, { clock, time, dt, wind: 0, mode: S.mode, range, ageRef: Math.max(1e-3, rootsAge) }, R.roots.posData, R.roots.colData);
    R.roots.setCount(m);
  }
  R.frame({ clock, time, wind: S.wind });
  if (saverOn && saverTick) saverTick(dt);
  glideStep(dt);
  R.controls.update();
  const w = $('gl').clientWidth, h = $('gl').clientHeight, o = occlusion(w, h);
  for (const k in occ) occ[k] += (o[k] - occ[k]) * 0.18;
  R.camera.setViewOffset(w, h, (occ.r - occ.l) / 2, (occ.b - occ.t) / 2, w, h);
  R.render();
  if (++frameNo % 10 === 0) readout();
}

// -------------------------------------------------------------- readout
function readout(force) {
  if (!plant) return;
  const st = plant.done ? 'grown' : S.paused ? 'paused' : 'growing';
  $('rdNodes').textContent = plant.count.toLocaleString();
  $('rdTips').textContent = plant.tipCount.toLocaleString();
  $('rdHeight').textContent = plant.maxY.toFixed(2) + ' m';
  $('rdAge').textContent = plant.iter + ' steps';
  $('rdLeft').textContent = plant.aliveCount.toLocaleString() + ' of ' + plant.nAttractors.toLocaleString();
  $('rdRoots').textContent = S.roots ? roots.count.toLocaleString() : 'off';
  $('stMain').textContent = SPECIES[S.species].label + ' · ' + st;
  $('stRight').textContent = `${plant.count} nodes · ${plant.tipCount} tips · ${plant.maxY.toFixed(1)} m`;
  if (force) legend();
}
function legend() {
  const m = COLOUR_MODES.find(c => c.id === S.mode);
  $('legend').hidden = S.mode === 'natural' || saverOn;
  $('lgTitle').textContent = m.label;
  $('lgBar').style.background = cssGradient(S.grad, S.rev);
  const ends = { age: ['old', 'new'], order: ['trunk', 'outer'], flow: ['few tips', 'all tips'], height: ['deep', 'top'], light: ['shade', 'sun'] }[S.mode] || ['', ''];
  $('lgLo').textContent = ends[0]; $('lgHi').textContent = ends[1];
  $('colourHint').textContent = m.text;
}

// ------------------------------------------------------------- controls
let picker = null;
function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('#colourBtns button, #dockColours button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  if (R) R.setMode(mode);
  legend();
}
function setGradient(id, rev) {
  S.grad = id; S.rev = !!rev;
  if (R) R.setGradient(id, S.rev);
  if (picker && (picker.value !== id || picker.reversed !== S.rev)) picker.set(id, S.rev);
  legend();
}
function setPaused(p) {
  S.paused = p;
  $('playBtn').textContent = p ? 'Grow' : 'Pause';
  const d = $('dockPlay'); d.textContent = p ? '▶' : '❚❚'; d.classList.toggle('on', p); d.setAttribute('aria-label', p ? 'Grow' : 'Pause');
  readout();
}
function setRootsOn(on) {
  S.roots = on; const b = $('rootsBtn'); b.textContent = on ? 'Roots on' : 'Roots off'; b.classList.toggle('on', on);
  if (R) { R.setRootsOn(on); if (!on) R.roots.setCount(0); }
  if (plant) frameTo(true);
}
function setLeavesOn(on) {
  S.leaves = on; const b = $('leavesBtn'); b.textContent = on ? 'Leaves on' : 'Leaves off'; b.classList.toggle('on', on);
  if (R) R.setLeavesOn(on);
}
const fmt = { speed: v => v.toFixed(2) + '×', crown: v => v.toFixed(2) + '×', di: v => v.toFixed(2) + ' m', dk: v => v.toFixed(2) + ' m', D: v => v.toFixed(2) + ' m', trop: v => v.toFixed(2), wind: v => Math.round(v * 100) + '%' };
function syncSliders() {
  for (const [id, key] of [['speed', 'speed'], ['crown', 'crown'], ['di', 'di'], ['dk', 'dk'], ['D', 'D'], ['trop', 'tropism'], ['wind', 'wind']]) {
    $(id).value = S[key]; $(id + 'V').textContent = fmt[id](S[key]);
  }
  $('seed').value = S.seed;
}
function setSpecies(id) {
  S.species = id; speciesDefaults(id); syncSliders();
  document.querySelectorAll('#speciesBtns button').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  $('speciesHint').textContent = SPECIES[id].kind[0].toUpperCase() + SPECIES[id].kind.slice(1) + '.';
  regrow();
}

const panel = $('panel');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open); $('dockPanel').setAttribute('aria-expanded', String(open));
}
const diagram = createDiagram($('diagram'));
function setExplain(open) {
  $('explain').hidden = !open; diagram.setOn(open);
  if (open && PHONE_Q.matches) setOpen(false);
}

function buildUI() {
  const sb = $('speciesBtns');
  for (const id of SPECIES_IDS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = id; b.textContent = SPECIES[id].label;
    b.addEventListener('click', () => setSpecies(id)); sb.appendChild(b);
  }
  const cb = $('colourBtns');
  for (const m of COLOUR_MODES) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.mode = m.id; b.textContent = m.label;
    b.addEventListener('click', () => setMode(m.id)); cb.appendChild(b);
  }
  document.querySelectorAll('#dockColours button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  picker = mountGradientPicker($('gradPick'), { value: S.grad, reversed: S.rev, onChange: (id, rev) => setGradient(id, rev) });

  $('playBtn').addEventListener('click', () => setPaused(!S.paused));
  $('dockPlay').addEventListener('click', () => setPaused(!S.paused));
  $('regrowBtn').addEventListener('click', () => { setPaused(false); regrow(); });
  $('dockRegrow').addEventListener('click', () => { S.seed = 1 + Math.floor(Math.random() * 999998); syncSliders(); setPaused(false); regrow(); });
  $('seedBtn').addEventListener('click', () => { S.seed = 1 + Math.floor(Math.random() * 999998); syncSliders(); setPaused(false); regrow(); });
  $('seed').addEventListener('change', () => { S.seed = Math.max(1, Math.min(999999, Math.round(+$('seed').value) || 1)); syncSliders(); regrow(); });
  // live sliders
  for (const [id, key, after] of [['speed', 'speed'], ['wind', 'wind'], ['trop', 'tropism', () => plant && plant.setTropism(S.tropism)]]) {
    $(id).addEventListener('input', () => { S[key] = +$(id).value; $(id + 'V').textContent = fmt[id](S[key]); if (after) after(); });
  }
  // shape sliders: the label follows the drag, the plant regrows on release
  for (const [id, key] of [['crown', 'crown'], ['di', 'di'], ['dk', 'dk'], ['D', 'D']]) {
    $(id).addEventListener('input', () => { S[key] = +$(id).value; $(id + 'V').textContent = fmt[id](S[key]); });
    $(id).addEventListener('change', () => { S[key] = +$(id).value; regrow(); });
  }
  $('trop').addEventListener('change', () => regrow());
  $('leavesBtn').addEventListener('click', () => setLeavesOn(!S.leaves));
  $('rootsBtn').addEventListener('click', () => setRootsOn(!S.roots));
  $('explainBtn').addEventListener('click', () => setExplain(true));
  $('explainClose').addEventListener('click', () => setExplain(false));

  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  $('dockPanel').addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  // the sheet grip: a tap toggles half and full height, a drag down closes
  const grip = $('sheetGrip'); let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });

  // the canvas: a drag stops the camera glide; a double tap frames the plant
  const gl = $('gl');
  let lastTap = 0;
  gl.addEventListener('pointerdown', e => {
    glide.on = false; $('hint').classList.add('gone');
    if (e.pointerType === 'touch') { if (e.timeStamp - lastTap < 320) frameTo(true); lastTap = e.timeStamp; }
  });
  gl.addEventListener('dblclick', () => frameTo(true));
  gl.addEventListener('wheel', () => { glide.on = false; }, { passive: true });
  setTimeout(() => $('hint').classList.add('gone'), 7000);
  addEventListener('resize', () => R && R.resize());
}

// ------------------------------------------------------------------ boot
let saverRate = BASE_RATE, saverTick = null;
buildUI();
speciesDefaults(S.species); syncSliders();
document.querySelectorAll('#speciesBtns button').forEach(b => b.classList.toggle('on', b.dataset.id === S.species));
$('speciesHint').textContent = SPECIES[S.species].kind[0].toUpperCase() + SPECIES[S.species].kind.slice(1) + '.';
if (R) { R.resize(); R.setGradient(S.grad, S.rev); }
setMode(S.mode);
regrow();
if (R) frameTo(false);
requestAnimationFrame(frame);

// ============================================================ screensaver
// window.snSaver (protocol: lib/screensaver.js). enter() plays a seeded
// shuffle of shots (saver.js makeShots): each grows a new plant from its
// own seed, species, colour mode and gradient, in 5 to 12 s (shotRate).
// The camera frames the plant and its soil in the clear band of the label
// plate (plateBand, bandFrame, fitDistance), aims a little toward the
// growth front, and orbits slowly. calm 1 gives the slowest orbit and wind.
window.snSaver = {
  enter(o = {}) {
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    const rnd = rng((o.seed >>> 0) || 1);
    const label = typeof o.label === 'function' ? o.label : () => {};
    saverOn = true; saverBand = null;
    const html = document.documentElement, added = !html.classList.contains('sn-saver');
    html.classList.add('sn-saver');
    setOpen(false); setExplain(false); $('legend').hidden = true;
    let bandFn = null, bandAt = -1e9;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no plate */ });
    const shots = makeShots(rnd, 30, calm);
    const CODE = { lang: 'js', name: 'grow.js · one colonisation step', text: codeExtract(createPlant({ species: 'sapling' }).step.toString()) };
    let k = -1, shot = null, t = 0, az = 0, tgt = null;
    const params = () => [
      { sym: 'N', name: 'nodes', value: plant.count.toLocaleString(), cls: 'm1' },
      { sym: 'n_{\\mathrm{tip}}', name: 'tips', value: plant.tipCount.toLocaleString(), cls: 'm2' },
      { sym: 'h', name: 'height', value: plant.maxY.toFixed(2) + ' m', cls: 'm3' },
      { sym: 'A', name: 'attractors left', value: plant.aliveCount.toLocaleString(), cls: 'm4' },
    ];
    const plate = () => {
      if (!shot) return;
      const mode = COLOUR_MODES.find(c => c.id === shot.mode);
      label({
        title: SPECIES[shot.species].label,
        sub: 'Space colonisation · ' + (shot.mode === 'natural' ? 'natural colour' : 'coloured by ' + mode.label.toLowerCase() + ' · ' + GRADIENTS[shot.gradient].label) + (shot.roots ? ' · DLA roots after fogleman/dlaf' : ''),
        params: params(),
        tex: [String.raw`\hat{d}_v = \frac{\sum_{a \in S(v)} (a - v)/\lVert a - v\rVert}{\bigl\lVert \sum_{a \in S(v)} (a - v)/\lVert a - v\rVert \bigr\rVert},\qquad v' = v + D\,\hat{d}_v`,
          String.raw`r_{\mathrm{parent}}^{\,p} = \sum r_{\mathrm{child}}^{\,p}`],
        rules: [['D', 'm1'], ['p', 'm4']],
        eq: ['d̂ᵥ = unit mean of (a − v)/‖a − v‖ over the attractors within dᵢ', 'v′ = v + D d̂ᵥ', 'r_parentᵖ = Σ r_childᵖ'],
        lines: ['An attractor dies when a node comes within the kill distance.'],
        code: CODE,
      });
    };
    const next = () => {
      k = (k + 1) % shots.length; shot = shots[k]; t = 0;
      S.species = shot.species; speciesDefaults(shot.species);
      S.seed = shot.seed; S.crown = 1; S.tropism = 1; S.speed = 1; S.paused = false;
      S.wind = shot.wind * (1 - 0.5 * calm);
      S.roots = shot.roots; if (R) { R.setRootsOn(shot.roots); R.setLeavesOn(true); } S.leaves = true;
      setMode(shot.mode); setGradient(shot.gradient, shot.reversed);
      regrow();
      saverRate = shotRate(plant.estIters(), shot.dur);
      az = shot.az0; tgt = null; glide.on = false;
      plate();
    };
    saverTick = dt => {
      const now = performance.now();
      if (bandFn && now - bandAt > 400) { bandAt = now; const b = bandFn(innerHeight); if (b) saverBand = b; }
      t += dt;
      if (t > shot.dur) next();
      const s = subject(), w = innerWidth, h = innerHeight, f = bandFrame(saverBand, w, h);
      const d = fitDistance(s.r, FOV, w / h, f.hFrac, f.wFrac, 0.8);
      // the growth front: the mean height of the newest nodes
      let fy = 0, m = 0;
      for (let i = Math.max(0, plant.count - 40); i < plant.count; i++) { fy += plant.pos[i * 3 + 1]; m++; }
      const goal = s.c[1] + ((m ? fy / m : s.c[1]) - s.c[1]) * 0.25;
      tgt = tgt === null ? goal : tgt + (goal - tgt) * Math.min(1, dt * 1.2);
      az += shot.orbit * dt;
      const ce = Math.cos(shot.el);
      R.controls.target.set(0, tgt, 0);
      R.camera.position.set(Math.sin(az) * ce * d, tgt + Math.sin(shot.el) * d, Math.cos(az) * ce * d);
    };
    next();
    this._plate = setInterval(plate, 1000);
    this._added = added;
    return { canvas: $('gl'), warmupMs: 1200 };
  },
  exit() {
    saverOn = false; saverTick = null; saverBand = null;
    clearInterval(this._plate);
    if (this._added) document.documentElement.classList.remove('sn-saver');
    S.wind = 0.35; syncSliders(); legend(); setRootsOn(S.roots); setLeavesOn(true); setPaused(false);
    setOpen(!PHONE_Q.matches);
  },
};
