// ============================================================================
//  CORAL SPECIES  ·  main script (ES module, three r160)
// ----------------------------------------------------------------------------
//  One colony of one coral species grows ONCE from a seed on a small rock,
//  from the ground up, in a 360 degree underwater view. When the colony is
//  full it stays; the view goes on and nothing starts again by itself.
//
//  WHAT COMES FROM pages/coral-reef (imports, read only):
//    reef.js ......... SPECIES, the DLA growth (in the worker), the mirror
//    mesh-worker.js .. createReefRunner (worker.js wraps it; the fall back
//                      runs it on this thread through coral-link.js)
//    coral-sdf.js .... SHAPES (the polyp sizes); the mesher runs in the worker
//    colour.js ....... the colour-by modes (natural, age, depth, ...)
//    scene.js ........ water, caustics, lamps, shadow, volume pass, the
//                      coral and polyp materials (shaders.js)
//    layout.js ....... the phone breakpoints, the clear area, the sheet snap
//    budget.js ....... the device profile (shadow, volume, pixel cap)
//    saver.js ........ frameFit (the subject fit in a clear area)
//  Our own: base.js (the rock), species.js (pace, framing, saver plan),
//  worker.js (the worker wrapper).
//
//  TEXTURES. scene.js loads the sand and rock textures by paths relative
//  to the coral-reef page ('assets/tex/...'). A URL modifier on the three
//  default loading manager maps them to '../coral-reef/assets/tex/...'.
//
//  CLOCK. nowMs = performance.now() - T0. The shader gets nowMs / 1000 as
//  uTime; each particle birth is in the worker clock, moved by coral.off.
//
//  CAMERA. scene.js OrbitControls (drag, pinch, wheel; no pan), a full
//  360 degree turn, auto rotate after 3 s idle. lib/action-camera.js
//  frames the particles of the colony and the rock: the target follows
//  its centre, and the distance is the frameFit distance times the zoom
//  of the user. So the camera keeps the colony framed while it grows,
//  with no lunges.
//
//  GREP MAP
//    grep -n 'function makeCoral'    the reef worker link
//    grep -n 'function startColony'  one new colony in the worker
//    grep -n 'function onCoral'      the worker messages
//    grep -n 'function refresh'      radii, natural colours and t to the GPU
//    grep -n 'function frameCamera'  the action camera and the orbit
//    grep -n 'function buildUI'      the controls
//    grep -n 'function frame'        the loop
//    grep -n 'window.snSaver'        the screensaver hook
// ============================================================================
import * as THREE from 'three';
import { createScene } from '../coral-reef/scene.js';
import { SPECIES, polypRadius, speciesHook, createReefMirror } from '../coral-reef/reef.js';
import { MODES, colourT, naturalRGB, radiiOf, fieldsOf } from '../coral-reef/colour.js';
import { SHAPES } from '../coral-reef/coral-sdf.js';
import { createReefRunner } from '../coral-reef/mesh-worker.js';
import { createCoralLink } from '../coral-reef/coral-link.js';
import { PHONE_QUERY, clearFromRects, sheetSnap } from '../coral-reef/layout.js';
import { PROFILES, detectProfile, pageEnv, profileFor, pixelRatioFor } from '../coral-reef/budget.js';
import { frameFit } from '../coral-reef/saver.js';
import { mountErrorBox, installErrorHandlers } from '../coral-reef/crash.js';
import { lut, cssGradient, mountGradientPicker } from '../../lib/growth-gradients.js';
import { createActionCamera } from '../../lib/action-camera.js';
import { createBase, PLOT_R } from './base.js';
import {
  SPECIES_LIST, GROW_S, SAVER_GROW_S, shortName, sizeFor, rateFor, ageYears, ageText,
  frameSample, saverClear, saverPlan, shotPose,
} from './species.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia(PHONE_QUERY);
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const T0 = performance.now();
const nowMs = () => performance.now() - T0;
const URLQ = new URLSearchParams(location.search || '');

const box = mountErrorBox(document);
installErrorHandlers(window, box);

// the device profile of the coral-reef page (budget.js); ?profile= wins
const PROFILE_ID = PROFILES[URLQ.get('profile')] ? URLQ.get('profile') : detectProfile(pageEnv());
const PROF = profileFor(PROFILE_ID);
const PHONEISH = PROFILE_ID === 'phone' || PROFILE_ID === 'phone-min';
// reef.js QUALITY: 'phone' is a coarser particle spacing (fewer particles)
const QUAL = PHONEISH ? 'phone' : 'desktop';
const BUDGET = { particles: 20000, colonies: 1, tris: PHONEISH ? 450000 : 1200000, polyps: PROF.cap.polyps ?? 1 };
const MAX_P = 24576;

const G = {
  species: SPECIES_LIST[0].id, seed: 1, rockSeed: 3, sizeU: 0.55,
  mode: 'natural', gradient: 'reef', rev: false,
  playing: true, speed: 1, dir: 20, caust: 1, down: 0.7, orbit: true, polyps: true, beam: true, snow: true,
};
let saverOn = false, sv = null;

// ── textures of scene.js: page paths of coral-reef ──────────────────────────
THREE.DefaultLoadingManager.setURLModifier(u => (/^assets\/tex\//.test(u) ? '../coral-reef/' + u : u));

// ── scene ───────────────────────────────────────────────────────────────────
const canvas = $('view');
const S = createScene({
  canvas, coarse: COARSE || PHONEISH, R: PLOT_R, profile: PROF, maxParticles: MAX_P,
  onNoGL: () => { $('nogl').hidden = false; },
  onShaderError: text => box.show({ title: 'A shader did not compile on this GPU', text }),
});
const base = createBase({ seed: G.rockSeed, quality: PROF.rock === 'high' ? 'high' : 'low' });
let lostNow = false;
const keyLamp = S ? new THREE.SpotLight(0xfff0dc, 760, 24, 0.5, 0.65, 2) : null;
const fillLamp = S ? new THREE.SpotLight(0xbfdcff, 170, 24, 0.75, 0.75, 2) : null;
// The look of this small scene. coral-reef tunes its volume pass for ROV
// beams far from the eye; here both lamps light the colony from 3 to 6 m
// and every eye ray crosses their cones, so the full in-scatter gave a
// milky veil over the coral (and the auto exposure lifted it more).
// scatter, shaft: the volume pass (lamp in-scatter, downwell shafts);
// expMax: the most exposure that the auto exposure may set.
export const LOOK = { scatter: 0.16, shaft: 0.45, expMax: 3 };
if (S) {
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); lostNow = true;
    if (coral) coral.kill();
    box.show({ title: 'The GPU context was lost', text: 'The browser took the GPU back (memory). Reload the page to start again.' });
  }, false);
  S.setPlot(PLOT_R);
  S.setRock(base);
  S.setPolypSizes(SHAPES);
  S.setLut(lut(G.gradient, 256, G.rev));
  S.U.uDown.value = G.down; S.U.uCaust.value = G.caust;
  if (S.passes) { S.passes.volU.uScatter.value = LOOK.scatter; S.passes.volU.uShaft.value = LOOK.shaft; }
  for (const L of [keyLamp, fillLamp]) { L.target = new THREE.Object3D(); S.scene.add(L, L.target); }
  S.setLights([keyLamp, fillLamp], 1);          // one main lamp: the key lamp casts the shadow
  const C = S.controls;
  C.enablePan = false; C.enableDamping = true; C.dampingFactor = 0.08;
  C.minDistance = 0.25; C.maxDistance = 40; C.minPolarAngle = 0.05; C.maxPolarAngle = 1.5;
  C.autoRotateSpeed = 1.1; C.rotateSpeed = COARSE ? 0.6 : 0.8; C.zoomSpeed = 0.8;
  C.target.set(0, base.top + 0.4, 0);
  S.camera.position.set(2.6, base.top + 1.2, 3.2);
  S.camera.near = 0.03; S.camera.updateProjectionMatrix();
}

// ── the coral driver ────────────────────────────────────────────────────────
// gen: each 'single' starts a new gen in the worker (init is gen 1). The
// page drops older gens; the first message of a new gen clears the mirror.
let coral = null;
let radBuf = new Float32Array(4096), tBuf = new Float32Array(4096), natBuf = new Float32Array(4096 * 3);
let hMax = 0, pendingStart = false;
const SWAY = id => Math.round(((SPECIES[id] && SPECIES[id].sway) || 0) * 4);

function makeCoral() {
  const D = { reef: createReefMirror(4096), gen: -1, want: 0, singles: 0, ready: false, off: Infinity, prog: null, cap: 0, done: false, t0: 0, doneT: 0, rateSent: 0, growS: GROW_S };
  D.reef.env = { temp: 27 };
  const link = createCoralLink({
    makeWorker: () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
    makeRunner: post => createReefRunner({ post, makeRock: () => createBase({ seed: G.rockSeed, mesh: false }) }),
    onMessage: m => onCoral(D, m),
    onFallback: why => {
      // the runner counts from 0 again and replays init and the last single
      D.gen = -1; D.want = D.singles ? 2 : 0; D.singles = Math.min(D.singles, 1);
      console.warn('coral-species: ' + why);
      box.show({ title: 'The coral runs on the main thread', text: `${why}. It grows a little slower.`, level: 'note' });
    },
  });
  D.post = (m, tr) => link.post(m, tr);
  D.kill = () => link.kill();
  D.post({ type: 'budget', growMs: PHONEISH ? 6 : 9, meshMs: PHONEISH ? 6 : 9, maxPost: 1500 });
  D.post({
    type: 'init', seed: G.seed, quality: QUAL, radius: PLOT_R, rockSeed: G.rockSeed, rockQuality: 'high',
    sites: [], colonies: 0, rate: 0, budget: BUDGET, lod: false, env: { speed: G.speed, nutrient: 1, temp: 27 },
  });
  D.post({ type: 'current', deg: G.dir, strength: 0.35 });
  return D;
}

// One new colony of G.species from G.seed: the worker resets the reef.
// growS: the seconds for a full colony at speed 1.
function startColony(growS = GROW_S) {
  if (!coral || !coral.ready) { pendingStart = growS; return; }
  pendingStart = false;
  coral.singles++;
  coral.want = 1 + coral.singles;
  coral.cap = 0; coral.done = false; coral.doneT = 0; coral.rateSent = 0; coral.growS = growS;
  coral.post({ type: 'current', deg: G.dir, strength: 0.35 });
  coral.post({ type: 'single', site: base.site, species: G.species, size: sizeFor(G.species, G.sizeU), seed: G.seed, rate: 0 });
  coral.post({ type: 'env', env: { speed: G.speed, nutrient: 1 } });
  coral.post({ type: 'play', on: G.playing });
  ac.reset(); zoom.user = 1; zoom.last = 0;
  readout(true);
}

function onCoral(D, m) {
  if (D !== coral) return;
  if (m.type === 'error') { console.error('coral-species: reef worker', m.message); box.show({ title: 'The reef worker reported an error', text: String(m.message || '').split('\n').slice(0, 6).join('\n') }); return; }
  if (m.type === 'ready') { D.ready = true; if (pendingStart) startColony(pendingStart); return; }
  if (m.gen === undefined || m.gen < D.want) return;
  if (m.gen !== D.gen) {
    D.gen = m.gen; D.t0 = nowMs();
    D.reef.reset(); hMax = 0;
    if (S) S.clearColonies();
  }
  if (m.type === 'colonies') {
    D.reef.setColonies(m.list);
    const c = m.list[0];
    if (c && c.cap && !D.cap) { D.cap = c.cap; D.rateSent = rateFor(c.cap, D.growS); D.post({ type: 'rate', value: D.rateSent }); }
  } else if (m.type === 'particles') {
    let mb = -Infinity; for (let o = 5; o < m.data.length; o += 8) if (m.data[o] > mb) mb = m.data[o];
    if (mb > -Infinity) D.off = Math.min(D.off, nowMs() - mb);
    if (D.reef.addParticles(m.from, m.data)) refresh();
  } else if (m.type === 'bricks') {
    if (S) S.applyBricks(m.list);
  } else if (m.type === 'progress') {
    D.prog = m;
    if (m.done && !D.done && D.reef.count > 0) { D.done = true; D.doneT = nowMs(); readout(true); }
  }
}

function sizeBuffers(n) {
  if (radBuf.length >= n) return;
  let c = radBuf.length; while (c < n) c *= 2;
  const r = new Float32Array(c), t = new Float32Array(c), q = new Float32Array(c * 3);
  r.set(radBuf); t.set(tBuf); q.set(natBuf);
  radBuf = r; tBuf = t; natBuf = q;
}
// All particle data to the GPU textures: radius, natural colour, t of the
// mode, birth, sway and tip, height over the base. A colony has a few
// thousand particles, so a full pass per message is cheap.
function refresh() {
  if (!S || !coral) return;
  const reef = coral.reef, n = Math.min(reef.count, MAX_P);
  if (!n || !reef.colonies[0]) return;
  for (let g = 0; g < n; g += 61) if (!reef.colonies[reef.col[g]]) return;
  sizeBuffers(n);
  const F = fieldsOf(reef);
  radiiOf(reef, radBuf, F); naturalRGB(reef, natBuf, F); colourT(reef, G.mode, tBuf, F);
  for (let g = 0; g < n; g++) { const h = reef.py[g] - reef.gy[g]; if (h > hMax) hMax = h; }
  const off = Number.isFinite(coral.off) ? coral.off : 0;
  S.setParticles(0, n, (g, A, B, o) => {
    const c = reef.colonies[reef.col[g]];
    A[o] = natBuf[g * 3]; A[o + 1] = natBuf[g * 3 + 1]; A[o + 2] = natBuf[g * 3 + 2]; A[o + 3] = tBuf[g];
    const tip = Math.max(0, Math.min(0.999, 1 - Math.log2(F.sub[g]) / 5));
    B[o] = (reef.birth[g] + off) / 1000; B[o + 1] = radBuf[g] || polypRadius(c.sp, 1); B[o + 2] = (c ? SWAY(c.id) : 0) * 2 + tip; B[o + 3] = reef.py[g] - reef.gy[g];
  });
}

// ── colour ──────────────────────────────────────────────────────────────────
const LEG = {
  age: ['Age', 'old', 'new'], depth: ['Depth (hops to the seed)', 'seed', 'tips'], height: ['Height over the base', 'low', 'high'],
  flow: ['Flow (subtree size)', 'tips', 'trunk'], light: ['Light and nutrient exposure', 'shaded', 'open'],
};
const MODE_NOTE = {
  natural: 'The colours of the species. New growth glows a little as it joins.',
  age: 'The order of joining. The growing front is at the hot end of the gradient, so the colours move while the colony grows.',
  depth: 'Hops from the seed along the branches.',
  height: 'Height over the seed.',
  flow: 'The size of the subtree that a particle feeds: the trunk carries the most.',
  light: 'An estimate: high particles with few close neighbours get the most light and food.',
};
const PAGE_MODES = MODES.filter(m => m.id !== 'colony');
function setGradient(id, rev) {
  G.gradient = id; G.rev = !!rev;
  if (S) S.setLut(lut(id, 256, G.rev));
  if (picker && picker.value !== id) picker.set(id);
  drawLegend();
}
function setMode(m) {
  G.mode = m;
  if (S) { S.U.uMode.value = m === 'natural' ? 0 : m === 'age' ? 1 : 2; refresh(); }
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.id === m));
  $('modeNote').textContent = MODE_NOTE[m] || '';
  drawLegend();
}
function drawLegend() {
  const L = LEG[G.mode];
  $('legend').classList.toggle('off', !L);
  if (!L) return;
  $('lgTitle').textContent = L[0]; $('lgLo').textContent = L[1]; $('lgHi').textContent = L[2];
  $('lgBar').style.background = cssGradient(G.gradient, G.rev);
}

// ── camera ──────────────────────────────────────────────────────────────────
const ac = createActionCamera({ fill: 0.62, percentile: 0.92, actionK: 0, deadZone: 0.12, halfLife: 1.6, maxZoomRate: 0.25, minRadius: 0.45, maxRadius: 6 });
const zoom = { user: 1, last: 0 };
let sampBuf = null, lastInput = -1e9, hintGone = false;
const V3 = new THREE.Vector3();
// The parts of the canvas under the panel and the dock (px at each edge).
function clearArea(w, h) {
  if (saverOn) return saverClear(sv && sv.band, w, h);
  const rects = [];
  for (const el of [$('panel'), $('dock')]) {
    if (!el || getComputedStyle(el).display === 'none') continue;
    if (el.id === 'panel' && !el.classList.contains('open')) continue;
    const q = el.getBoundingClientRect();
    rects.push({ x0: q.left, y0: q.top, x1: q.right, y1: q.bottom });
  }
  return clearFromRects(rects, w, h);
}
function frameCamera(dt, now) {
  const C = S.controls, cam = S.camera;
  const reef = coral ? coral.reef : null;
  sampBuf = frameSample(reef, base.site.p, 2500, sampBuf);
  const g = ac.update(sampBuf, dt);
  if (!g) return;
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  const fit = frameFit({ w, h, clear: clearArea(w, h), radius: g.radius, fov: cam.fov, fill: saverOn ? 0.74 : 0.8 });
  S.view.tox = fit.ox; S.view.toy = fit.oy;
  if (saverOn && sv && sv.stage) {
    C.enabled = false;
    const P = shotPose(sv.stage, sv.t);
    const d = fit.dist * P.zoom, ce = Math.cos(P.elev);
    const goal = [g.center[0] + d * ce * Math.sin(P.az), g.center[1] + d * Math.sin(P.elev), g.center[2] + d * ce * Math.cos(P.az)];
    goal[1] = Math.max(goal[1], base.sand.heightAt(goal[0], goal[2]) + 0.25);
    const k = sv.cut ? 1 : 1 - Math.exp(-dt * 2.2);
    sv.cut = false;
    cam.position.x += (goal[0] - cam.position.x) * k; cam.position.y += (goal[1] - cam.position.y) * k; cam.position.z += (goal[2] - cam.position.z) * k;
    C.target.set(g.center[0], g.center[1], g.center[2]);
    cam.lookAt(C.target);
    return;
  }
  C.enabled = true;
  C.autoRotate = G.orbit && !REDUCED && now - lastInput > 3000;
  C.update(dt);
  // the target follows the framed centre; the eye moves with it (no turn)
  V3.set(g.center[0] - C.target.x, g.center[1] - C.target.y, g.center[2] - C.target.z);
  C.target.add(V3); cam.position.add(V3);
  // the distance: the fit distance times the user zoom (a wheel or a pinch
  // changed the distance since the last frame: that is the new zoom)
  V3.copy(cam.position).sub(C.target);
  const dist = V3.length();
  if (zoom.last > 0 && Math.abs(dist - zoom.last) > zoom.last * 0.004) zoom.user = Math.min(4, Math.max(0.12, zoom.user * dist / zoom.last));
  const want = Math.min(C.maxDistance, Math.max(C.minDistance, fit.dist * zoom.user));
  V3.setLength(want); cam.position.copy(C.target).add(V3);
  if (cam.position.y < 0.12) cam.position.y = 0.12;
  zoom.last = cam.position.distanceTo(C.target);
}
// The lamps: a warm key light above and to one side, a cool fill from
// the other side, both aimed at the colony, at a distance that grows with it.
function placeLamps(g) {
  if (!g) return;
  const c = g.center, r = Math.max(0.6, g.radius), d = 2.2 * r + 2.4;
  keyLamp.position.set(c[0] + d * 0.55, c[1] + d * 0.8, c[2] + d * 0.45);
  fillLamp.position.set(c[0] - d * 0.7, c[1] + d * 0.35, c[2] - d * 0.55);
  keyLamp.target.position.set(c[0], c[1] - r * 0.2, c[2]); fillLamp.target.position.set(c[0], c[1], c[2]);
  keyLamp.distance = fillLamp.distance = d * 2.6;
}

// ── readout ─────────────────────────────────────────────────────────────────
let readT = 0;
function stats() {
  const reef = coral ? coral.reef : null, sp = SPECIES[G.species];
  const n = reef ? reef.count : 0, h = hMax;
  const grown = coral && coral.t0 ? ((coral.done ? coral.doneT : nowMs()) - coral.t0) / 1000 : 0;
  return { sp, n, h, polyps: S ? S.polypTotal : 0, years: ageYears(G.species, h), frac: coral && coral.cap ? Math.min(1, n / coral.cap) : 0, done: !!(coral && coral.done), grown };
}
function readout(force) {
  if (!force && readT < 0.25) return;
  readT = 0;
  const s = stats();
  $('rSp').textContent = s.sp.label;
  $('rN').textContent = s.n.toLocaleString();
  $('rH').textContent = `${(s.h * 100).toFixed(1)} cm`;
  $('rP').textContent = s.polyps.toLocaleString();
  $('rAge').textContent = ageText(s.years);
  $('rBar').style.width = `${(s.done ? 1 : s.frac) * 100}%`;
  $('rState').textContent = !coral || !coral.ready ? 'Starting the reef worker…'
    : s.done ? `Full grown in ${Math.round(s.grown)} s` : !G.playing ? 'Paused' : s.n ? '' : 'Seeding…';
}

// ── UI ──────────────────────────────────────────────────────────────────────
let picker = null;
const css = c => `rgb(${c.map(v => Math.round(Math.min(1, v) * 255)).join(',')})`;
function setPlaying(on) {
  G.playing = !!on;
  if (coral) coral.post({ type: 'play', on: G.playing });
  const t = G.playing ? '❚❚ Pause' : '▶ Grow';
  $('bPlay').textContent = t; $('bPlay').classList.toggle('on', G.playing);
  $('dockPlay').innerHTML = G.playing ? '<i>❚❚</i><span>Pause</span>' : '<i>▶</i><span>Grow</span>';
  readout(true);
}
function setSpecies(id, regrow = true) {
  G.species = id;
  document.querySelectorAll('#species button').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  const sp = SPECIES[id];
  $('spNote').innerHTML = `<i>${sp.latin}</i> · ${sp.form}. ${NOTE[id] || ''}`;
  $('dockSpName').textContent = shortName(id);
  if (regrow) { setPlaying(true); startColony(); }
}
const NOTE = {
  staghorn: 'Tips are favoured: a busy particle, or a flake from below, rarely sticks, so thin branches race up.',
  fan: 'Every new particle is put into one vertical plane across the current: a flat, webbed fan.',
  table: 'A short stalk grows up, then only side joins stick: a flat plate.',
  boulder: 'High stubbornness, and each new particle is laid on a compact dome: a brain coral with grooves.',
  finger: 'Low stickiness: flakes creep into the gaps before they stick, so the lobes stay thick and soft.',
};
function setPanel(open) {
  const p = $('panel');
  p.classList.toggle('open', open);
  if (!open) p.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockMenu').setAttribute('aria-expanded', String(open));
  $('dockMenu').classList.toggle('on', open);
}
function bindRange(id, fmt, on) {
  const el = $(id), v = $(id.replace(/^s/, 'v'));
  const show = () => { v.textContent = fmt(+el.value); };
  el.addEventListener('input', () => { show(); on(+el.value); });
  show();
}
function toggle(id, key, on) {
  const b = $(id);
  b.classList.toggle('on', !!G[key]);
  b.addEventListener('click', () => { G[key] = !G[key]; b.classList.toggle('on', G[key]); on(G[key]); });
}
function buildUI() {
  const spBox = $('species');
  for (const s of SPECIES_LIST) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.id = s.id;
    b.innerHTML = `<span class="sw" style="background:${css(SPECIES[s.id].tip)}"></span>${s.label}`;
    b.addEventListener('click', () => setSpecies(s.id));
    spBox.appendChild(b);
  }
  const mBox = $('modes');
  for (const m of PAGE_MODES) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.id = m.id; b.textContent = m.label;
    b.addEventListener('click', () => setMode(m.id));
    mBox.appendChild(b);
  }
  picker = mountGradientPicker($('gradPick'), { value: G.gradient, reversed: G.rev, label: 'Choose a gradient', onChange: (id, rev) => { setGradient(id, rev); if (G.mode === 'natural') setMode('age'); } });
  $('bPlay').addEventListener('click', () => setPlaying(!G.playing));
  $('dockPlay').addEventListener('click', () => setPlaying(!G.playing));
  const regrow = () => { setPlaying(true); startColony(); };
  $('bRegrow').addEventListener('click', regrow);
  $('dockRegrow').addEventListener('click', regrow);
  $('bSeed').addEventListener('click', () => { G.seed = (G.seed % 9973) + 1; regrow(); });
  $('dockSp').addEventListener('click', () => {
    const i = SPECIES_LIST.findIndex(s => s.id === G.species);
    setSpecies(SPECIES_LIST[(i + 1) % SPECIES_LIST.length].id);
  });
  bindRange('sSpeed', v => `${v.toFixed(2)}×`, v => { G.speed = v; if (coral) coral.post({ type: 'env', env: { speed: v } }); });
  bindRange('sCaust', v => v.toFixed(2), v => { G.caust = v; if (S) { S.U.uCaust.value = v; S.opts.caustics = v > 0; } });
  bindRange('sDown', v => v.toFixed(2), v => { G.down = v; if (S) S.U.uDown.value = v; });
  toggle('tOrbit', 'orbit', () => {});
  toggle('tPolyps', 'polyps', on => S && S.setPolypsVisible(on));
  toggle('tBeam', 'beam', on => { if (S) S.opts.volume = on; });
  toggle('tSnow', 'snow', on => { if (S) S.opts.snow = on; });
  $('panelClose').addEventListener('click', () => setPanel(false));
  $('gear').addEventListener('click', () => setPanel(true));
  $('dockMenu').addEventListener('click', () => setPanel(!$('panel').classList.contains('open')));
  // the sheet grip: a drag or a tap (layout.js sheetSnap)
  const grip = $('sheetGrip');
  let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const p = $('panel'), st = p.classList.contains('full') ? 'full' : 'half';
    const nx = sheetSnap(st, e.clientY - gy); gy = null;
    if (nx === 'closed') setPanel(false); else p.classList.toggle('full', nx === 'full');
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
  const mark = () => { lastInput = nowMs(); if (!hintGone) { hintGone = true; setTimeout(() => $('hint').classList.add('gone'), 2500); } };
  if (S) { S.controls.addEventListener('start', mark); S.controls.addEventListener('end', mark); }
  setSpecies(G.species, false);
  setMode(G.mode);
  setPanel(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setPanel(!e.matches));
}

function resize() {
  if (!S) return;
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  S.renderer.setPixelRatio(pixelRatioFor(PROF, devicePixelRatio || 1, w, h));
  S.resize();
}

// ── the loop ────────────────────────────────────────────────────────────────
let last = performance.now(), slowT = 0, lowered = false;
function frame(t) {
  if (lostNow) return;
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, t - last); last = t;
  const dt = dtMs / 1000, now = nowMs();
  readT += dt;
  if (saverOn && sv) sv.tick(dt);
  readout(false);
  if (!S) return;
  // slow frames for 4 s on a phone: a lighter volume pass and shadow
  if (dtMs > 45) slowT += dt; else slowT = Math.max(0, slowT - dt * 0.5);
  if (!lowered && slowT > 4) { lowered = true; S.setLoads({ volSteps: 8, volScale: 0.3, shadow: 512, polypDraw: 12000 }); }
  S.flushChunks(PHONEISH ? 2.5 : 3.5, now, 120);
  S.U.uTime.value = now / 1000;
  S.U.uCount.value = coral ? Math.max(1, coral.reef.count) : 1;
  S.U.uSwayK.value = REDUCED ? 0.3 : 1;
  frameCamera(dt, now);
  placeLamps(ac.goal());
  // cap the auto exposure (scene.js sets uExposure from post.exposure)
  if (S.post && S.post.exposure > LOOK.expMax) { S.post.exposure = LOOK.expMax; if (S.passes) S.passes.compU.uExposure.value = LOOK.expMax; }
  S.render(dt, now);
}

// The look state for the node checks (tests.mjs)
window.__speciesLook = () => ({ down: S ? S.U.uDown.value : null, scatter: S && S.passes ? S.passes.volU.uScatter.value : null, shaft: S && S.passes ? S.passes.volU.uShaft.value : null, exposure: S && S.post ? S.post.exposure : null, uExposure: S && S.passes ? S.passes.compU.uExposure.value : null, fill: fillLamp ? fillLamp.intensity : null, key: keyLamp ? keyLamp.intensity : null });
buildUI();
resize();
addEventListener('resize', resize);
if (S) { coral = makeCoral(); startColony(); }
readout(true);
requestAnimationFrame(frame);

// ── screensaver ─────────────────────────────────────────────────────────────
// enter({ calm, seconds, caption, seed, label }) -> { canvas, warmupMs }.
// A seeded plan of the species (species.js saverPlan): each colony grows
// once (about SAVER_GROW_S s), stays full for the hold, then the view
// fades to the next species. Calm shots of 8 to 12 s turn round it. The
// subject is framed in the clear band of the label plate (plateBand of
// lib/saver-clear.js) for 16:9 and 9:16.
window.snSaver = {
  enter(o = {}) {
    if (!S) return { canvas, warmupMs: 0 };
    saverOn = true;
    document.documentElement.classList.add('sn-saver');
    setPanel(false);
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    const label = typeof o.label === 'function' ? o.label : () => {};
    const seed = (o.seed >>> 0) || 1;
    const plan = saverPlan(seed, { n: 12, calm });
    const saved = { species: G.species, seed: G.seed, mode: G.mode, gradient: G.gradient, rev: G.rev, dir: G.dir, speed: G.speed, playing: G.playing };
    sv = { plan, i: -1, stage: null, t: 0, band: null, bandFn: null, bandT: 0, labT: 0, fading: false, cut: true, saved, label };
    import('../../lib/saver-clear.js').then(m => { if (sv) sv.bandFn = m.plateBand; }).catch(() => { /* no plate */ });
    G.speed = 1;
    function makeLabel() {
      const d = sv.stage; if (!d) return null;
      const s = stats(), H = speciesHook(d.species), src = H.fn.toString();
      const modeLbl = (MODES.find(m => m.id === d.mode) || MODES[0]).label;
      return {
        title: s.sp.label,
        sub: `${s.sp.latin} · ${s.sp.form.toLowerCase()} · one colony grows from a seed on a rock`,
        params: [
          { sym: 'N', name: 'particles', value: s.n.toLocaleString(), cls: 'm1' },
          { sym: 'h', name: 'height', value: `${(s.h * 100).toFixed(1)} cm`, cls: 'm2' },
          { sym: 'P', name: 'polyps', value: s.polyps.toLocaleString(), cls: 'm3' },
          { sym: 't', name: 'age (from a typical extension rate)', value: ageText(s.years), cls: 'm4' },
        ],
        tex: [String.raw`\mathbf{v} = \boldsymbol{\xi} + d\,\mathbf{u} - f\,\hat{\mathbf{y}}`],
        eq: ['v = ξ + d u − f ŷ'],
        rules: [['N', 'm1'], ['h', 'm2'], ['P', 'm3'], ['t', 'm4']],
        lines: [s.done ? `Full grown. Colour by ${modeLbl.toLowerCase()}.` : `Colour by ${modeLbl.toLowerCase()}. Marine snow drifts down with the current and sticks to the tips that it meets first.`],
        code: src.split('\n').length <= 14 ? { lang: 'js', name: `reef.js · ${s.sp.label.toLowerCase()} · ${H.name}`, text: src } : undefined,
      };
    }
    function begin(d) {
      sv.stage = d; sv.t = 0; sv.cut = true; sv.labT = 0;
      G.species = d.species; G.seed = d.seed; G.dir = d.current;
      setGradient(d.gradient, d.reversed);
      setMode(d.mode);
      G.playing = true;
      if (coral) coral.post({ type: 'env', env: { speed: 1 } });
      startColony(SAVER_GROW_S);
      label(makeLabel());
    }
    function next() {
      sv.i = (sv.i + 1) % plan.length;
      const d = plan[sv.i];
      sv.fading = true; canvas.style.opacity = '0';
      setTimeout(() => { if (!saverOn || !sv) return; begin(d); canvas.style.opacity = '1'; sv.fading = false; }, sv.stage ? 900 : 0);
    }
    sv.tick = dt => {
      if (sv.bandFn && (sv.bandT += dt) > 0.4) { sv.bandT = 0; try { sv.band = sv.bandFn(canvas.clientHeight); } catch (e) { sv.band = null; } }
      const d = sv.stage;
      if (!d) { if (!sv.fading) next(); return; }
      sv.t += dt; sv.labT += dt;
      if (sv.labT > 1) { sv.labT = 0; label(makeLabel()); }
      if (sv.fading) return;
      // the next species: the hold after the colony is full, or a cap on time
      const full = coral && coral.done && coral.gen >= coral.want;
      const heldS = full ? (nowMs() - coral.doneT) / 1000 : 0;
      if ((full && heldS > d.hold) || sv.t > d.grow * 2.2 + d.hold) next();
    };
    next();
    return { canvas, warmupMs: 1500 };
  },
  // the state for node checks
  debug() {
    return { on: saverOn, stage: sv && sv.stage ? { i: sv.i, species: sv.stage.species, t: sv.t } : null, band: sv ? sv.band : null, count: coral ? coral.reef.count : 0, done: !!(coral && coral.done) };
  },
  exit() {
    if (!saverOn) return;
    saverOn = false;
    document.documentElement.classList.remove('sn-saver');
    canvas.style.opacity = '';
    const s = sv && sv.saved; sv = null;
    if (S) S.controls.enabled = true;
    if (s) {
      G.seed = s.seed; G.dir = s.dir; G.speed = s.speed;
      if (coral) coral.post({ type: 'env', env: { speed: s.speed } });
      setGradient(s.gradient, s.rev);
      setMode(s.mode);
      setSpecies(s.species, false);
      startColony();
      setPlaying(s.playing);
    }
    setPanel(!PHONE_Q.matches);
  },
};
