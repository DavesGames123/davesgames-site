// ============================================================================
//  PROTEIN FOLDING  ·  main.js — stage, controls, plots and the frame loop
// ----------------------------------------------------------------------------
//  Go mode: one sim host (worker) per replica runs model.js. Each frame it
//  sends the chain, fitted onto the native frame by Kabsch, plus Q, RMSD,
//  Rg, energy and samples every 50 steps. main.js keeps the time series,
//  the F(Q) and F(Q, Rg) histograms at the current T, the Q-vs-T curve,
//  and draws the chains and the cards.
//  HP mode: one host runs the lattice search; the view shows the coldest
//  replica and the best fold found so far.
//
//  CAMERA. The render camera is fixed. OrbitControls drive a hidden pivot
//  camera, and each replica turns in place by the inverse of its rotation,
//  so a grid of replicas never swings into itself. Pinch or scroll changes
//  the pivot distance, which maps to camera.zoom. frameCamera() sets the
//  view offset and zoom so the grid fits the part of the canvas that the
//  panel, the plots, the read-out and the dock leave clear.
//
//  GREP MAP
//    function loadPreset ....... build hosts, views and cards for a preset
//    function makeHost ......... worker, or the main-thread fallback
//    function onFrame .......... a Go frame into series and histograms
//    function onHpFrame ........ an HP frame into series
//    function drawPlots ........ every visible card
//    function frameCamera ...... occlusion, view offset, zoom, grid layout
//    function setTemp .......... temperature, ramp, melt and quench
//    function colours .......... residue colours for each colour mode
//    function tags ............. N, C, helix and strand tags over the chains
//    function fqStates ......... unfolded, native and barrier labels on F(Q)
//    function buildPanel ....... the control bindings
//    initXR .................... VR and AR view (xr.js, lib/xr-view.js)
//    window.snSaver ............ screensaver hook (lib/screensaver.js)
//    function saverPlate ....... screensaver label plate: protein, model, live T E Q
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PROTEINS } from './proteins.js';
import { PRESETS, GROUPS, presetById } from './presets.js';
import { ChainView, LatticeView, COL, LAT } from './render.js';
import { Card, SERIES, drawSeries, drawCurve, drawHeat, drawContactMap, drawPairMap, fmtSteps } from './plots.js';
import { mountEquations } from './equations.js';
import { createHost } from './sim-host.js';
import { initXR } from './xr.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── state ────────────────────────────────────────────────────────────────────
const S = {
  preset: null, kind: 'go', R: COARSE ? 2 : 4, start: 'extended', running: true,
  tFrac: 0.8, gamma: 0.5, speed: 50, pull: 0, colour: 'ss', ghost: true, lines: true, orbit: !REDUCED,
  ramp: null,
  hpDim: 2, hpMode: 'remc', hpLo: 0.25, hpHi: 1.6, hpR: COARSE ? 8 : 8, hpSpeed: 60,
  sims: [], views: [], hp: null, frameNo: 0,
};

// ── renderer, cameras, light ─────────────────────────────────────────────────
const canvas = $('view');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 2 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
} catch (e) { $('nogl').hidden = false; renderer = null; }

const scene = new THREE.Scene();
if (renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
}
const FOV = 32, D0 = 100;
const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);
camera.position.set(0, 0, D0);
const key = new THREE.DirectionalLight(0xfff3e6, 1.6); key.position.set(40, 60, 80);
const rim = new THREE.DirectionalLight(0x8fb0ff, 0.8); rim.position.set(-60, -20, -30);
scene.add(key, rim, new THREE.HemisphereLight(0x9fb4ff, 0x20140a, 0.35));
const world = new THREE.Group(); scene.add(world);
// the pivot camera that the user orbits; replicas take its inverse rotation
const pivot = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);
const controls = new OrbitControls(pivot, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
controls.minDistance = D0 * 0.3; controls.maxDistance = D0 * 3;
controls.rotateSpeed = COARSE ? 0.8 : 0.6;
controls.autoRotateSpeed = -0.6;
let idle = 0, dragging = false, saverOn = false;
controls.addEventListener('start', () => { dragging = true; idle = 0; hideHint(); });
controls.addEventListener('end', () => { dragging = false; });

// ── sim hosts ────────────────────────────────────────────────────────────────
function makeHost(onmsg) {
  let w = null, inline = null;
  const fallback = () => {
    if (inline) return;
    try { w && w.terminate(); } catch (e) {}
    w = null;
    inline = createHost(m => setTimeout(() => onmsg(m), 0), { budget: 4 });
    for (const m of queue) inline.handle(m);
  };
  const queue = [];
  try {
    w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = e => onmsg(e.data);
    w.onerror = e => { e.preventDefault && e.preventDefault(); console.warn('worker failed, running on the main thread'); fallback(); };
  } catch (e) { fallback(); }
  return {
    post(m) { queue.push(m); if (queue.length > 40) queue.splice(1, queue.length - 20); if (inline) inline.handle(m); else if (w) w.postMessage(m); },
    kill() { try { w && w.terminate(); } catch (e) {} if (inline) inline.stop(); w = null; inline = null; },
    get inline() { return !!inline; },
  };
}
function killAll() {
  for (const s of S.sims) s.host.kill();
  S.sims = [];
  if (S.hp) { S.hp.host.kill(); S.hp = null; }
  for (const v of S.views) { world.remove(v.group); v.dispose(); }
  S.views = [];
}

// ── series storage with decimation ─────────────────────────────────────────
class Series {
  constructor(keys, cap = 2400) {
    this.cap = cap; this.n = 0; this.stride = 1; this.count = 0;
    this.xs = new Float64Array(cap); this.keys = keys; this.v = {};
    for (const k of keys) this.v[k] = new Float32Array(cap);
  }
  push(x, vals) {
    if (this.count++ % this.stride) return;
    if (this.n === this.cap) {
      const h = this.cap >> 1;
      for (let i = 0; i < h; i++) { this.xs[i] = this.xs[2 * i]; for (const k of this.keys) this.v[k][i] = this.v[k][2 * i]; }
      this.n = h; this.stride *= 2;
    }
    this.xs[this.n] = x; for (const k of this.keys) this.v[k][this.n] = vals[k]; this.n++;
  }
}

// ── preset loading ───────────────────────────────────────────────────────────
const KD = { A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, Q: -3.5, E: -3.5, G: -0.4, H: -3.2, I: 4.5, L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2 };
let P = null;   // the active Go protein context
const NQ = 50, NG = 36;

function speedToRate(v, max) { return v >= 100 ? Infinity : Math.max(1, Math.round(Math.pow(10, v / 99 * max))); }
function rateLabel(r, unit) { return r === Infinity ? 'max' : `${r >= 1000 ? (r / 1000).toFixed(1) + 'k' : r} ${unit}`; }
function defaultSpeed(n) { const r = n <= 25 ? 120 : n <= 40 ? 300 : n <= 80 ? 1500 : Infinity; return r === Infinity ? 100 : Math.round(Math.log10(r) / 3.6 * 99); }

function loadPreset(id, keep = false) {
  const pr = presetById(id) || presetById('villin');
  killAll();
  S.preset = pr; S.kind = pr.kind; S.ramp = null;
  document.body.classList.toggle('mode-go', pr.kind === 'go');
  document.body.classList.toggle('mode-hp', pr.kind === 'hp');
  if (!saverOn) try { history.replaceState(null, '', '#' + pr.id); } catch (e) {}
  for (const b of document.querySelectorAll('.pcard')) b.classList.toggle('on', b.dataset.id === pr.id);
  $('presetSel').value = pr.id;
  const wasHp2 = S.lastView === 'hp2';
  if (pr.kind === 'go') loadGo(pr, keep); else loadHp(pr, keep);
  const view = pr.kind === 'hp' && S.hpDim === 2 ? 'hp2' : 'tilt';
  if (view !== S.lastView || (view === 'hp2' && !wasHp2)) {
    const d = pivot.position.length() || D0;
    if (view === 'hp2') pivot.position.set(0, 0, d); else pivot.position.set(0.32, 0.22, 1).normalize().multiplyScalar(d);
    controls.update();
  }
  S.lastView = view;
  buildCards();
  syncUI();
  fitGrid(true);
}

function loadGo(pr, keep) {
  const prot = PROTEINS[pr.id], N = prot.seq.length;
  const nc = prot.con.length / 2;
  const ci = new Int32Array(nc), cj = new Int32Array(nc);
  for (let c = 0; c < nc; c++) { ci[c] = prot.con[2 * c]; cj[c] = prot.con[2 * c + 1]; }
  const nat = Float64Array.from(prot.ca);
  let r0 = 0, rg = 0;
  for (let i = 0; i < N; i++) { const d = Math.hypot(nat[3 * i], nat[3 * i + 1], nat[3 * i + 2]); r0 = Math.max(r0, d); rg += d * d; }
  P = {
    pr, prot, N, nc, ci, cj, nat, radius: r0 + 2, rgNat: Math.sqrt(rg / N), tm: pr.tm,
    avg: new Float32Array(nc), resFrac: new Float32Array(N),
    hist: null, melt: { lo: 0.4, hi: 1.6, n: 48, sum: new Float64Array(48), cnt: new Float64Array(48) },
    firstFold: [], t0: performance.now(),
  };
  if (!keep) {
    S.tFrac = pr.fold;
    S.speed = defaultSpeed(N);
    S.start = N > 60 ? 'coil' : 'extended';
    S.pull = 0;
  }
  resetHist();
  for (let k = 0; k < S.R; k++) {
    const sim = { k, frame: null, fresh: false, series: new Series(['q', 'rmsd', 'rg', 'e']), stepsSeen: 0 };
    sim.host = makeHost(m => onFrame(sim, m));
    sim.host.post({ type: 'go-init', gen: S.gen || 0, protein: prot, seed: 1000 + 7919 * k + Math.floor(Math.random() * 1e6), T: S.tFrac * P.tm, gamma: S.gamma, pull: S.pull, start: S.start, rate: speedToRate(S.speed, 3.6), running: S.running });
    S.sims.push(sim);
    const v = new ChainView(prot, nat);
    v.ghost.visible = S.ghost; v.lines.visible = S.lines;
    world.add(v.group); S.views.push(v);
    v.set(nat, null);
  }
  colours(true);
}

function loadHp(pr, keep) {
  P = null;
  const seq = pr.seq;
  const hp = { pr, seq, N: seq.length, frame: null, fresh: false, series: null, best: new Series(['e'], 1200), hist: null, bestAt: 0 };
  hp.series = Array.from({ length: S.hpR }, () => new Series(['e'], 1600));
  hp.host = makeHost(m => onHpFrame(hp, m));
  hp.host.post({ type: 'hp-init', gen: S.gen || 0, seq, dim: S.hpDim, replicas: S.hpR, mode: S.hpMode, Tlo: S.hpLo, Thi: S.hpHi, Tfix: S.hpLo, seed: 1 + Math.floor(Math.random() * 1e6), rate: speedToRate(S.hpSpeed, 3), running: S.running });
  S.hp = hp;
  const live = new LatticeView(seq), best = new LatticeView(seq, { faint: false });
  world.add(live.group, best.group); S.views.push(live, best);
  const flat = new Int32Array(3 * seq.length); for (let i = 0; i < seq.length; i++) flat[3 * i] = i;
  live.set(flat); best.set(flat);
  // the extent of the view: a compact fold of N sites
  hp.radius = LAT * (S.hpDim === 2 ? Math.sqrt(seq.length) * 0.75 : Math.cbrt(seq.length) * 0.95) + 3;
}

function resetHist() {
  if (!P) return;
  // Q takes the values k / Nc only, so a small protein gets Nc + 1 bins
  P.nq = Math.min(NQ, P.nc + 1); P.ngq = Math.min(NG, P.nc + 1);
  P.hist = { T: S.tFrac * P.tm, n: 0, fq: new Float64Array(P.nq), fqr: new Float64Array(P.ngq * NG), rgLo: P.rgNat * 0.8, rgHi: P.rgNat * 2.6, since: P.steps0 || 0 };
}

// ── frames from the hosts ──────────────────────────────────────────────────
function onFrame(sim, m) {
  if (!P || !S.sims.includes(sim) || m.kind !== 'go' || (m.gen || 0) !== (S.gen || 0)) return;
  sim.frame = m; sim.fresh = true;
  const o = m.obs;
  sim.series.push(o.steps, { q: o.Q, rmsd: o.rmsd, rg: o.Rg, e: o.E });
  if (o.Q >= 0.8 && sim.firstFold === undefined && o.steps > 0 && S.start !== 'native') sim.firstFold = o.steps;
  if (o.steps < sim.stepsSeen) sim.firstFold = undefined;   // restarted
  sim.stepsSeen = o.steps;
  // histograms at the current temperature
  const H = P.hist, s = m.samples, mt = P.melt;
  for (let i = 0; i + 3 < s.length; i += 4) {
    const q = s[i], rg = s[i + 1], T = s[i + 3];
    const tb = Math.floor((T / P.tm - mt.lo) / (mt.hi - mt.lo) * mt.n);
    if (tb >= 0 && tb < mt.n) { mt.sum[tb] += q; mt.cnt[tb]++; }
    if (Math.abs(T - H.T) > 1e-6 || S.ramp) continue;
    H.n++;
    H.fq[Math.min(P.nq - 1, Math.round(q * (P.nq - 1)))]++;
    const gi = Math.min(P.ngq - 1, Math.round(q * (P.ngq - 1))), gj = Math.floor((rg - H.rgLo) / (H.rgHi - H.rgLo) * NG);
    if (gj >= 0 && gj < NG) H.fqr[gi * NG + gj]++;
  }
  // running average of formed contacts over replicas
  const a = 0.04 / S.sims.length, f = m.formed;
  for (let c = 0; c < P.nc; c++) P.avg[c] += a * (f[c] - P.avg[c]);
}
function onHpFrame(hp, m) {
  if (S.hp !== hp || m.kind !== 'hp' || (m.gen || 0) !== (S.gen || 0)) return;
  hp.frame = m; hp.fresh = true;
  const R = m.E.length, s = m.samples;
  // samples: R energies per sweep, in temperature-slot order
  const sweeps = s.length / R;
  for (let w = 0; w < sweeps; w++) {
    const moves = m.moves - (sweeps - 1 - w) * R * hp.N;
    for (let r = 0; r < R && r < hp.series.length; r++) hp.series[r].push(moves, { e: s[w * R + r] });
  }
  hp.best.push(m.moves, { e: m.bestE });
  if (!hp.hist) hp.hist = Array.from({ length: R }, () => new Map());
  for (let w = 0; w < sweeps; w++) for (let r = 0; r < R; r++) { const e = s[w * R + r], hm = hp.hist[r]; hm.set(e, (hm.get(e) || 0) + 1); }
}

// ── temperature ──────────────────────────────────────────────────────────────
function sendAll(m) { for (const s of S.sims) s.host.post(m); if (S.hp) S.hp.host.post(m); }
function setTemp(frac, fromRamp = false) {
  S.tFrac = clamp(frac, 0.4, 1.6);
  if (!fromRamp) S.ramp = null;
  if (P) { sendAll({ type: 'set', T: S.tFrac * P.tm }); if (!fromRamp) resetHist(); }
  syncTemp();
}
function rampTick() {
  if (!S.ramp || !P || !S.sims[0]?.frame) return;
  const steps = S.sims[0].frame.obs.steps;
  if (S.ramp.last === undefined || steps < S.ramp.last) S.ramp.last = steps;
  S.ramp.phase += (steps - S.ramp.last) / S.ramp.half; S.ramp.last = steps;
  const ph = S.ramp.phase % 2, u = ph < 1 ? ph : 2 - ph;   // 0..1..0
  const f = 1.3 - u * (1.3 - 0.5);
  if (Math.abs(f - S.tFrac) > 0.004) setTemp(f, true);
}
function startRamp() {
  if (!P) return;
  S.ramp = { phase: Math.max(0, (1.3 - S.tFrac) / 0.8), half: 1.5e5 * Math.pow(Math.max(1, P.N / 35), 1.3), last: undefined };
  syncTemp();
}

// ── colours ──────────────────────────────────────────────────────────────────
const tmpC = new THREE.Color();
function colours(force) {
  if (!P) return;
  const N = P.N, prot = P.prot;
  if (S.colour === 'con') {
    for (const [k, v] of S.views.entries()) {
      const f = S.sims[k]?.frame?.formed; if (!f && !force) continue;
      const on = new Float32Array(N), tot = new Float32Array(N);
      for (let c = 0; c < P.nc; c++) { const x = f ? f[c] : 0; on[P.ci[c]] += x; on[P.cj[c]] += x; tot[P.ci[c]]++; tot[P.cj[c]]++; }
      const rgb = new Float32Array(3 * N);
      for (let i = 0; i < N; i++) {
        const t = tot[i] ? on[i] / tot[i] : 0;
        tmpC.copy(COL.off).lerp(COL.on, t); if (!tot[i]) tmpC.multiplyScalar(0.6);
        rgb[3 * i] = tmpC.r; rgb[3 * i + 1] = tmpC.g; rgb[3 * i + 2] = tmpC.b;
      }
      v.colour(rgb);
    }
    return;
  }
  if (!force) return;
  const rgb = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) {
    if (S.colour === 'ss') tmpC.copy(prot.ss[i] === 'H' ? COL.helix : prot.ss[i] === 'E' ? COL.strand : COL.coil);
    else { const t = (KD[prot.seq[i]] ?? 0) / 4.5; tmpC.copy(COL.mid).lerp(t > 0 ? COL.hyd : COL.pol, Math.abs(t)); }
    rgb[3 * i] = tmpC.r; rgb[3 * i + 1] = tmpC.g; rgb[3 * i + 2] = tmpC.b;
  }
  for (const v of S.views) v.colour(rgb);
}
function legend() {
  const el = $('legend');
  const chip = (c, t) => `<span><i style="background:#${c.getHexString()}"></i>${t}</span>`;
  const bar = (a, b) => `<i class="bar" style="background:linear-gradient(90deg,#${a.getHexString()},#${b.getHexString()})"></i>`;
  let h = '';
  if (S.kind === 'hp') h = chip(COL.H, 'H hydrophobic') + chip(COL.P, 'P polar') + `<span><i style="background:#${COL.H.getHexString()};border-radius:2px;height:4px;width:14px"></i>H–H contact</span>`;
  else {
    if (S.colour === 'ss') h = chip(COL.helix, 'helix (α)') + chip(COL.strand, 'strand (β)') + chip(COL.coil, 'coil');
    else if (S.colour === 'hyd') h = `<span>polar${bar(COL.pol, COL.mid)}${bar(COL.mid, COL.hyd).replace('bar"', 'bar" ')}hydrophobic</span>`;
    else h = `<span>native contacts formed: none${bar(COL.off, COL.on)}all</span>`;
    if (S.ghost) h += chip(COL.ghost, 'native ghost');
    if (S.lines) h += `<span><i class="ln" style="background:#${COL.contact.getHexString()}"></i>formed native contact</span>`;
  }
  // the residue tags drawn by tags()
  h += `<span><b class="tk">N</b><b class="tk">C</b>chain ends</span>`;
  el.innerHTML = h;
}

// ── cards ────────────────────────────────────────────────────────────────────
let cards = {};
function buildCards() {
  const host = $('plots'); host.innerHTML = ''; cards = {};
  const add = (k, t, cls, sub) => (cards[k] = new Card(host, k, t, { cls, sub }));
  if (S.kind === 'go') {
    add('q', 'Native contacts Q', 'tall');
    add('rmsd', 'RMSD to native · Å', 'half');
    add('rg', 'Radius of gyration · Å', 'half');
    add('cmap', 'Contact map', 'half sq');
    add('fqrg', 'F(Q, Rg) / kT', 'half sq', 'Light: low free energy. Ring: replica 1 now.');
    add('fq', 'Free energy F(Q) / kT', '', 'F = −ln P(Q) at this T. A low well is a likely state.');
    add('e', 'Energy · ε', '', 'V = bonds + angles + dihedrals + native contacts + repulsion');
    add('melt', '⟨Q⟩ vs T / Tm', '');
  } else {
    add('hpE', 'E per replica, cold to hot', 'tall', 'E = −(number of H–H contacts)');
    add('hpBest', 'Best energy found', '');
    add('hpMap', 'H–H contacts', 'half sq');
    add('hpHist', 'E histogram', 'half sq');
  }
  const dots = $('plotDots'); dots.innerHTML = Object.keys(cards).map(() => '<i></i>').join('');
  updateDots();
}
function updateDots() {
  const host = $('plots'), dots = $('plotDots').children;
  if (!dots.length) return;
  const w = host.firstElementChild ? host.firstElementChild.getBoundingClientRect().width + 8 : 1;
  const k = clamp(Math.round(host.scrollLeft / w), 0, dots.length - 1);
  for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === k);
}
$('plots').addEventListener('scroll', updateDots, { passive: true });

const traces = (key, pick) => S.sims.map((s, k) => ({ xs: s.series.xs, ys: s.series.v[key], n: s.series.n, color: SERIES[k % 8], alpha: pick === undefined || pick === k ? 0.95 : 0.4 }));
function chips(vals, fmt) { return vals.map((v, k) => `<i style="background:${SERIES[k % 8]}"></i>${fmt(v)}`).join(''); }

// State labels for F(Q). The unfolded basin is Q < 0.3 and the native
// basin is Q > 0.7; their names sit at the top of the plot over each basin.
// The barrier is the highest point of the 3-bin smoothed F at 0.3 to 0.7,
// labelled only when it is at least 1 kT over both basin minima. Fixed
// basins, not a well search: a noisy curve gave false wells.
function fqStates(pts) {
  const ok = pts.filter(p => p.y !== null && isFinite(p.y));
  const out = [{ x: 0.13, y: 7, text: 'unfolded', dy: 0, color: '#c9cbd8' }, { x: 0.87, y: 7, text: 'native', dy: 0, color: '#c9cbd8' }];
  if (ok.length < 6) return out;
  const y = ok.map((p, k) => (p.y + (ok[k - 1] ?? p).y + (ok[k + 1] ?? p).y) / 3);
  let u = Infinity, n = Infinity, b = -1;
  ok.forEach((p, k) => {
    if (p.x < 0.3) u = Math.min(u, y[k]);
    else if (p.x > 0.7) n = Math.min(n, y[k]);
    else if (b < 0 || y[k] > y[b]) b = k;
  });
  if (b >= 0 && isFinite(u) && isFinite(n) && y[b] >= Math.max(u, n) + 1) out.push({ x: ok[b].x, y: ok[b].y, text: 'barrier' });
  return out;
}

function drawPlots() {
  const slow = S.frameNo % 4 === 0;
  if (S.kind === 'go' && P) {
    const fr = S.sims.map(s => s.frame?.obs).filter(Boolean);
    const c = cards;
    if (c.q.visible()) { drawSeries(c.q, traces('q'), { y0: 0, y1: 1, refs: [{ y: 0.8, label: 'folded' }], yticks: 4, vfmt: v => v.toFixed(2), xtitle: 'MD steps', ytitle: 'Q' }); c.q.val.innerHTML = chips(fr.map(o => o.Q), v => v.toFixed(2)); }
    if (c.rmsd.visible()) { drawSeries(c.rmsd, traces('rmsd'), { y0: 0, vfmt: v => v.toFixed(1), left: 28, xticks: 2, xtitle: 'MD steps', ytitle: 'RMSD (Å)' }); c.rmsd.val.textContent = fr[0] ? fr[0].rmsd.toFixed(1) : ''; }
    if (c.rg.visible()) { drawSeries(c.rg, traces('rg'), { refs: [{ y: P.rgNat, label: 'native' }], vfmt: v => v.toFixed(1), left: 28, xticks: 2, xtitle: 'MD steps', ytitle: 'Rg (Å)' }); c.rg.val.textContent = fr[0] ? fr[0].Rg.toFixed(1) : ''; }
    if (c.e.visible()) { drawSeries(c.e, traces('e'), { vfmt: v => v.toFixed(0), yticks: 3, xtitle: 'MD steps', ytitle: 'V (ε)' }); c.e.val.textContent = fr[0] ? fr[0].E.toFixed(1) : ''; }
    if (slow && c.cmap.visible()) {
      const k0 = 0, x = S.sims[k0]?.frame?.x;
      drawContactMap(c.cmap, P.N, P.ci, P.cj, P.avg, x);
      c.cmap.val.textContent = `${P.nc} native`;
    }
    const H = P.hist;
    if (slow && (c.fq.visible() || c.fqrg.visible())) {
      const tot = H.fq.reduce((a, b) => a + b, 0);
      const pts = [];
      let fmin = Infinity;
      for (let i = 0; i < P.nq; i++) if (H.fq[i] > 0) fmin = Math.min(fmin, -Math.log(H.fq[i] / tot));
      for (let i = 0; i < P.nq; i++) pts.push({ x: i / (P.nq - 1), y: H.fq[i] > 0 ? -Math.log(H.fq[i] / tot) - fmin : null });
      const curQ = S.sims[0]?.frame?.obs.Q;
      drawCurve(c.fq, tot > 40 ? pts : [], { x0: 0, x1: 1, y0: 0, y1: 7, xfmt: v => v.toFixed(1), xticks: 5, yticks: 3, color: '#ffd68c', fill: 'rgba(255,214,140,0.10)', marker: curQ, empty: S.ramp ? 'paused while the ramp runs' : 'collecting at this T…', yfmt: v => v.toFixed(0), xtitle: 'Q, fraction of native contacts', ytitle: 'F / kT', notes: fqStates(pts) });
      c.fq.val.textContent = S.ramp ? 'ramp' : `T ${(H.T / P.tm).toFixed(2)} Tm · ${tot.toLocaleString()} samples`;
      const ng = P.ngq * NG, g = new Float64Array(ng).fill(NaN); let gmin = Infinity;
      const gt = H.fqr.reduce((a, b) => a + b, 0);
      for (let i = 0; i < ng; i++) if (H.fqr[i] > 0) { g[i] = -Math.log(H.fqr[i] / gt); gmin = Math.min(gmin, g[i]); }
      for (let i = 0; i < ng; i++) g[i] -= gmin;
      const o0 = S.sims[0]?.frame?.obs;
      const hq = 0.5 / (P.ngq - 1);   // bin centres sit on k / (bins - 1)
      drawHeat(c.fqrg, gt > 40 ? g : new Float64Array(ng).fill(NaN), P.ngq, NG, { x0: -hq, x1: 1 + hq, y0: H.rgLo, y1: H.rgHi, fmax: 7, xfmt: v => v.toFixed(1), xticks: 2, yticks: 3, left: 26, point: o0 ? [o0.Q, clamp(o0.Rg, H.rgLo, H.rgHi)] : null, xtitle: 'Q', ytitle: 'Rg (Å)', notes: [{ x: 0.92, y: clamp(P.rgNat, H.rgLo, H.rgHi), text: 'native', color: '#ffd68c' }] });
      c.fqrg.val.textContent = 'Q × Rg';
    }
    if (slow && c.melt.visible()) {
      const m = P.melt, pts = [];
      for (let i = 0; i < m.n; i++) if (m.cnt[i] > 5) pts.push({ x: m.lo + (i + 0.5) / m.n * (m.hi - m.lo), y: m.sum[i] / m.cnt[i] });
      drawCurve(c.melt, pts, { x0: m.lo, x1: m.hi, y0: 0, y1: 1, xfmt: v => v.toFixed(1), xticks: 6, yticks: 2, dots: true, color: '#86b6ef', marker: S.tFrac, band: [0.95, 1.05], empty: 'use Ramp, or visit several T', yfmt: v => v.toFixed(1), xtitle: 'T / Tm', ytitle: '⟨Q⟩', notes: pts.length ? [{ x: m.lo + 0.12 * (m.hi - m.lo), y: 0.98, text: 'folded', dy: 0 }, { x: m.hi - 0.12 * (m.hi - m.lo), y: 0.2, text: 'unfolded', dy: 0 }, { x: 1, y: 0.62, text: 'Tm', dy: 0, color: '#ffd68c' }] : null });
      c.melt.val.textContent = `Tm ≈ ${P.tm.toFixed(2)} ε/kB`;
    }
  } else if (S.kind === 'hp' && S.hp?.frame) {
    const hp = S.hp, f = hp.frame, c = cards, R = f.E.length;
    const refs = [{ y: hp.pr.best, label: S.hpDim === 2 ? `best known ${hp.pr.best}` : `2D best ${hp.pr.best}` }];
    if (c.hpE.visible()) {
      const tr = hp.series.slice(0, Math.min(R, 8)).map((s, k) => ({ xs: s.xs, ys: s.v.e, n: s.n, color: SERIES[k % 8], alpha: 0.8 }));
      drawSeries(c.hpE, tr, { y1: 0.5, refs, vfmt: v => v.toFixed(0), xtitle: 'Monte Carlo moves', ytitle: 'E' });
      c.hpE.val.innerHTML = chips(f.T.slice(0, 8), v => 'T ' + v.toFixed(2));
    }
    if (c.hpBest.visible()) {
      drawSeries(c.hpBest, [{ xs: hp.best.xs, ys: hp.best.v.e, n: hp.best.n, color: '#ffd68c' }], { y1: 0.5, refs, vfmt: v => v.toFixed(0), xtitle: 'Monte Carlo moves', ytitle: 'E' });
      c.hpBest.val.textContent = `${f.bestE} at ${fmtSteps(f.bestAt)} moves`;
    }
    if (slow && c.hpMap.visible()) {
      drawPairMap(c.hpMap, hp.seq, hhPairs(hp.seq, f.bestPos, 0), hhPairs(hp.seq, f.pos, 0));
      c.hpMap.val.textContent = `${-f.bestE}`;
    }
    if (slow && c.hpHist.visible() && hp.hist) {
      let lo = 0; for (const m of hp.hist) for (const e of m.keys()) lo = Math.min(lo, e);
      const tr = hp.hist.slice(0, 8).map((m, k) => {
        let tot = 0; for (const v of m.values()) tot += v;
        const xs = [], ys = [];
        for (let e = lo; e <= 0; e++) { xs.push(e); ys.push((m.get(e) || 0) / Math.max(1, tot)); }
        return { xs: Float64Array.from(xs), ys: Float32Array.from(ys), n: xs.length, color: SERIES[k % 8], alpha: 0.85 };
      });
      drawSeries(c.hpHist, tr, { y0: 0, xfmt: v => v.toFixed(0), vfmt: v => (v * 100).toFixed(0) + '%', yfmt: v => (v * 100).toFixed(0) + '%', xticks: 4, left: 32, xunit: ' E', xtitle: 'E, energy', ytitle: 'share' });
      c.hpHist.val.textContent = S.hpMode === 'remc' ? `swap ${(f.swap * 100).toFixed(0)}%` : '';
    }
  }
}
function hhPairs(seq, pos, off) {
  const N = seq.length, m = new Map(), out = [];
  for (let i = 0; i < N; i++) m.set(`${pos[off + 3 * i]},${pos[off + 3 * i + 1]},${pos[off + 3 * i + 2]}`, i);
  for (let i = 0; i < N; i++) {
    if (seq[i] !== 'H') continue;
    for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]) {
      const j = m.get(`${pos[off + 3 * i] + dx},${pos[off + 3 * i + 1] + dy},${pos[off + 3 * i + 2] + dz}`);
      if (j !== undefined && j > i + 1 && seq[j] === 'H') out.push([i, j]);
    }
  }
  return out;
}

// ── read-out ─────────────────────────────────────────────────────────────────
function readout() {
  const el = $('read');
  if (S.kind === 'go' && P) {
    const fr = S.sims.map(s => s.frame).filter(Boolean);
    const o = fr[0]?.obs;
    const folded = S.sims.filter(s => s.frame && s.frame.obs.Q >= 0.8).length;
    const ff = S.sims.map(s => s.firstFold).filter(v => v !== undefined);
    const sps = fr.reduce((a, f) => a + f.sps, 0);
    const pull = S.pull ? ` · <span class="lo">pull</span> ${(S.pull * 69.5).toFixed(0)} pN<span class="lo">*</span> <span class="lo">end-end</span> ${o ? o.ree.toFixed(0) : '–'} Å` : '';
    el.innerHTML = `<b>${esc(P.pr.name)}</b> <span class="lo">· ${P.prot.pdb} · ${P.N} res · ${P.nc} contacts</span><br>` +
      (o ? `<span class="lo">Q</span> <span class="hi">${o.Q.toFixed(2)}</span> <span class="lo">RMSD</span> ${o.rmsd.toFixed(1)} Å <span class="lo">Rg</span> ${o.Rg.toFixed(1)} Å <span class="lo">T</span> ${S.tFrac.toFixed(2)} T<sub>m</sub>${S.ramp ? ' <span class="hi">ramp</span>' : ''}${pull}<br>` : '<br>') +
      (o ? `<span class="lo">steps</span> ${fmtSteps(o.steps)} <span class="lo">·</span> ${fmtSteps(sps)}<span class="lo">/s</span> <span class="lo">· folded</span> <span class="${folded ? 'ok' : ''}">${folded}/${S.sims.length}</span>${ff.length ? ` <span class="lo">first at</span> ${fmtSteps(Math.min(...ff))}` : ''}` : '');
  } else if (S.kind === 'hp' && S.hp) {
    const f = S.hp.frame, pr = S.hp.pr;
    el.innerHTML = `<b>${esc(pr.name)}</b> <span class="lo">· ${S.hpDim === 2 ? 'square' : 'cubic'} lattice · ${S.hpMode === 'remc' ? 'replica exchange' : S.hpMode === 'anneal' ? 'annealing' : 'fixed T'}</span><br>` +
      (f ? `<span class="lo">${grid.cols > 1 ? 'left' : 'top'}: coldest now</span> E ${f.E[0]} <span class="lo">· ${grid.cols > 1 ? 'right' : 'bottom'}: best found</span> <span class="hi">E ${f.bestE}</span> ${S.hpDim === 2 ? (f.bestE <= pr.best ? '<span class="ok">= best known</span>' : `<span class="lo">(best known ${pr.best})</span>`) : '<span class="lo">(cubic: no reference)</span>'}<br><span class="lo">moves</span> ${fmtSteps(f.moves)} <span class="lo">·</span> ${fmtSteps(f.sps * S.hp.N * f.E.length)}<span class="lo">/s</span>` : '');
  }
}

// ── residue tags ─────────────────────────────────────────────────────────────
// HTML labels over the canvas: N and C on each chain (on the first chain
// only when more than four replicas share the view), the helix and strand
// names (α1, β1 …, from the PDB secondary structure in proteins.js) on the
// first chain, and in HP mode a caption over each chain. tags() runs after
// each render and projects the bead positions with the render camera.
const tagHost = $('tags'), tagPool = [], tv = new THREE.Vector3();
function ssElements(ss) {
  const out = []; let nh = 0, ne = 0;
  for (let i = 0; i < ss.length;) {
    let j = i; while (j < ss.length && ss[j] === ss[i]) j++;
    if (ss[i] === 'H' && j - i >= 4) out.push({ i: (i + j - 1) >> 1, text: 'α' + (++nh), cls: 'h' });
    else if (ss[i] === 'E' && j - i >= 2) out.push({ i: (i + j - 1) >> 1, text: 'β' + (++ne), cls: 'e' });
    i = j;
  }
  return out;
}
function tags() {
  if (!tagHost || !renderer) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  let n = 0;
  const put = (x, y, text, cls) => {
    if (x < 0 || x > w || y < 0 || y > h) return;
    let el = tagPool[n];
    if (!el) { el = document.createElement('span'); tagHost.appendChild(el); tagPool.push(el); }
    el.textContent = text; el.className = 'tag ' + cls; el.hidden = false;
    el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
    n++;
  };
  const label = (v, i, text, cls) => {
    if (!v.x || i < 0 || 3 * i + 2 >= v.x.length) return;
    tv.set(v.x[3 * i], v.x[3 * i + 1], v.x[3 * i + 2]).applyMatrix4(v.group.matrixWorld).project(camera);
    if (tv.z < 1) put((tv.x + 1) / 2 * w, (1 - tv.y) / 2 * h - 7, text, cls);
  };
  if (S.kind === 'go' && P) {
    const many = S.views.length > 4;
    S.views.forEach((v, k) => { if (!many || k === 0) { label(v, 0, 'N', 'end'); label(v, v.N - 1, 'C', 'end'); } });
    if (P.ssTags === undefined) P.ssTags = ssElements(P.prot.ss || '');
    if (S.views[0]) for (const e of P.ssTags) label(S.views[0], e.i, e.text, e.cls);
  } else if (S.kind === 'hp') {
    const R = (S.hp?.radius || 20) * 1.02;
    S.views.forEach((v, k) => {
      label(v, 0, 'N', 'end'); label(v, v.N - 1, 'C', 'end');
      tv.copy(v.group.position).setY(v.group.position.y + R).project(camera);
      if (tv.z < 1) put((tv.x + 1) / 2 * w, (1 - tv.y) / 2 * h, k === 0 ? 'coldest replica now' : 'best fold found', 'cap');
    });
  }
  for (let k = n; k < tagPool.length; k++) tagPool[k].hidden = true;
}

// ── camera framing ───────────────────────────────────────────────────────────
const occ = { l: 0, r: 0, t: 0, b: 0 };
let grid = { cols: 1, rows: 1, cell: 40 };
function insets(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 }, cr = canvas.getBoundingClientRect();
  const els = [$('panel'), $('plots'), $('read'), $('dock'), $('legend')];
  for (const el of els) {
    if (!el || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el === $('panel') && !el.classList.contains('open')) continue;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (el === $('legend')) { if (PHONE_Q.matches) o.b = Math.max(o.b, cr.bottom - y0); continue; }
    if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) o.b = Math.max(o.b, cr.bottom - y0); else o.t = Math.max(o.t, y1 - cr.top); }
    else { if (x0 + x1 < cr.left * 2 + w) o.l = Math.max(o.l, x1 - cr.left); else o.r = Math.max(o.r, cr.right - x0); }
  }
  return o;
}
function fitGrid() {
  const n = S.kind === 'go' ? S.views.length : 2;
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  const cw = Math.max(40, w - occ.l - occ.r), ch = Math.max(40, h - occ.t - occ.b);
  const radius = S.kind === 'go' ? (P ? Math.max(P.radius, P.fitR || 0) : 20) : (S.hp?.radius || 20);
  const cell = radius * 2.15;
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols), sc = Math.min(cw / (cols * cell), ch / (rows * cell));
    if (!best || sc > best.sc + 1e-9) best = { cols, rows, sc };
  }
  grid = { cols: best.cols, rows: best.rows, cell };
  S.views.forEach((v, k) => {
    const r = Math.floor(k / grid.cols), c = k % grid.cols;
    const inRow = Math.min(grid.cols, n - r * grid.cols);
    v.group.position.set((c - (inRow - 1) / 2) * cell, ((grid.rows - 1) / 2 - r) * cell, 0);
  });
}
function frameCamera() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (renderer) renderer.setSize(w, h, false);
  const o = insets(w, h);
  let moved = false;
  for (const k in occ) { const nv = occ[k] + (o[k] - occ[k]) * 0.25; if (Math.abs(nv - occ[k]) > 0.3) moved = true; occ[k] = Math.abs(o[k] - nv) < 0.5 ? o[k] : nv; }
  fitGrid();
  const cw = Math.max(40, w - occ.l - occ.r), ch = Math.max(40, h - occ.t - occ.b);
  const W = grid.cols * grid.cell, H = grid.rows * grid.cell, tan = Math.tan(FOV / 2 * Math.PI / 180);
  const fitZoom = Math.min(cw / W, ch / H) * 2 * D0 * tan / h * 0.94;
  const user = D0 / pivot.position.length();
  camera.aspect = w / h;
  camera.zoom = fitZoom * user;
  camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
  camera.updateProjectionMatrix();
  return moved;
}

// ── loop ─────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, alive = true;
const qInv = new THREE.Quaternion();
function frame(now) {
  if (!alive) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  S.frameNo++;
  idle += dt;
  controls.autoRotate = S.orbit && !dragging && idle > 2 && !(S.kind === 'hp' && S.hpDim === 2);
  controls.update(dt);
  qInv.copy(pivot.quaternion).invert();
  for (const v of S.views) v.group.quaternion.copy(qInv);
  rampTick();
  if (S.kind === 'go') {
    S.sims.forEach((s, k) => {
      if (!s.fresh || !S.views[k]) return;
      s.fresh = false;
      S.views[k].set(s.frame.x, s.frame.formed);
    });
    if (S.colour === 'con' && S.frameNo % 3 === 0) colours(false);
    // under a pull force the chain grows far past the native size: fit it
    if (P) {
      let ext = 0;
      if (S.pull > 0) for (const s of S.sims) { const x = s.frame?.x; if (x) for (let i = 0; i < x.length; i += 3) ext = Math.max(ext, Math.hypot(x[i], x[i + 1], x[i + 2])); }
      P.fitR = (P.fitR || 0) + ((S.pull > 0 ? ext + 2 : 0) - (P.fitR || 0)) * 0.05;
    }
  } else if (S.hp?.fresh) {
    const f = S.hp.frame; S.hp.fresh = false;
    S.views[0].set(f.pos, 0); S.views[1].set(f.bestPos, 0);
  }
  frameCamera();
  if (renderer) renderer.render(scene, camera);
  tags();
  if (S.frameNo % 2 === 0) drawPlots();
  if (S.frameNo % 6 === 0) readout();
}

// ── panel and controls ───────────────────────────────────────────────────────
const panel = $('panel'), dockPanel = $('dockPanel');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open && PHONE_Q.matches);
  dockPanel.classList.toggle('on', open); dockPanel.setAttribute('aria-expanded', String(open));
}
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
setTimeout(hideHint, 9000);

function setRunning(on) {
  S.running = on; sendAll({ type: 'set', running: on && !document.hidden });
  $('runBtn').textContent = on ? 'Pause' : 'Run'; $('runBtn').classList.toggle('on', on);
  $('dockPlay').textContent = on ? '❚❚' : '▶'; $('dockPlay').setAttribute('aria-label', on ? 'Pause' : 'Run');
}
function restart() {
  if (S.kind === 'go' && P) {
    S.gen = (S.gen || 0) + 1;
    sendAll({ type: 'reset', start: S.start, gen: S.gen });
    for (const s of S.sims) { s.frame = null; s.series = new Series(['q', 'rmsd', 'rg', 'e']); s.firstFold = undefined; s.stepsSeen = 0; }
    P.avg.fill(0); resetHist();
  } else loadPreset(S.preset.id, true);
}
function syncTemp() {
  if (!P) return;
  $('temp').value = S.tFrac;
  $('tempV').textContent = `${S.tFrac.toFixed(2)} · ${(S.tFrac * P.tm).toFixed(2)}ε`;
  const ff = P.pr.fold;
  const which = S.ramp ? 'ramp' : Math.abs(S.tFrac - 0.55) < 0.005 ? 'quench' : Math.abs(S.tFrac - ff) < 0.005 ? 'fold' : Math.abs(S.tFrac - 1.3) < 0.005 ? 'melt' : '';
  for (const b of document.querySelectorAll('#tempBtns button, #dockSeg button[data-t]')) b.classList.toggle('on', b.dataset.t === which);
  $('tempNote').textContent = S.ramp ? 'Ramp: T sweeps 1.3 to 0.5 Tm and back, slowly. Watch ⟨Q⟩ vs T trace the melting curve, with hysteresis if the sweep outruns folding.'
    : `Tm ≈ ${P.tm.toFixed(2)} ε/kB, from a heating scan in this model (an upper estimate). Fold sets ${ff.toFixed(2)} Tm.`;
}
function syncUI() {
  const pr = S.preset;
  $('pKind').textContent = pr.kind === 'go' ? (GROUPS.find(g => g[0] === pr.group) || [])[1] || '' : 'HP lattice model';
  $('pName').textContent = pr.name;
  $('pNote').textContent = pr.note;
  if (pr.kind === 'go') {
    const p = PROTEINS[pr.id];
    $('pMeta').textContent = `PDB ${p.pdb} · chain ${p.chain} · ${p.from}–${p.to} · ${p.seq.length} residues · ${p.con.length / 2} contacts`;
    syncTemp();
    $('gamma').value = Math.log10(S.gamma); $('gammaV').textContent = `${S.gamma.toFixed(2)} /τ`;
    $('speed').value = S.speed; $('speedV').textContent = rateLabel(speedToRate(S.speed, 3.6), 'st/fr');
    $('pull').value = S.pull; $('pullV').textContent = S.pull ? `${S.pull.toFixed(2)} ε/Å` : 'off';
    for (const b of document.querySelectorAll('#reps button')) b.classList.toggle('on', +b.dataset.r === S.R);
    for (const b of document.querySelectorAll('#starts button')) b.classList.toggle('on', b.dataset.start === S.start);
    for (const b of document.querySelectorAll('#colours button')) b.classList.toggle('on', b.dataset.c === S.colour);
    $('tGhost').classList.toggle('on', S.ghost); $('tLines').classList.toggle('on', S.lines);
    $('dockSeg').innerHTML = '<button data-t="quench" type="button">Quench</button><button data-t="fold" type="button">Fold</button><button data-t="melt" type="button">Melt</button>';
    syncTemp();
  } else {
    $('pMeta').textContent = `${pr.seq.length} residues · ${[...pr.seq].filter(c => c === 'H').length} H · best known 2D E = ${pr.best}`;
    for (const b of document.querySelectorAll('#dims button')) b.classList.toggle('on', +b.dataset.d === S.hpDim);
    for (const b of document.querySelectorAll('#hpModes button')) b.classList.toggle('on', b.dataset.m === S.hpMode);
    for (const b of document.querySelectorAll('#hpReps button')) b.classList.toggle('on', +b.dataset.r === S.hpR);
    $('hpLo').value = S.hpLo; $('hpLoV').textContent = S.hpLo.toFixed(2);
    $('hpHi').value = S.hpHi; $('hpHiV').textContent = S.hpHi.toFixed(2);
    $('hpSpeed').value = S.hpSpeed; $('hpSpeedV').textContent = rateLabel(speedToRate(S.hpSpeed, 3), 'sw/fr');
    $('hpNote').textContent = S.hpMode === 'remc' ? 'Replica exchange: replicas sit on a ladder from T low to T high and swap neighbours, so a cold chain can escape a trap by visiting heat.'
      : S.hpMode === 'anneal' ? 'Annealing: each replica cools from T high to T low, then starts again. Fast cooling freezes in a trap.' : 'Fixed T: every replica at T low. Too cold and they freeze; too hot and they never settle.';
    $('dockSeg').innerHTML = '<button data-d="2" type="button">2D</button><button data-d="3" type="button">3D</button>';
    for (const b of document.querySelectorAll('#dockSeg button')) b.classList.toggle('on', +b.dataset.d === S.hpDim);
  }
  for (const b of document.querySelectorAll('#colours button')) b.classList.toggle('on', b.dataset.c === S.colour);
  $('tOrbit').classList.toggle('on', S.orbit);
  legend();
}

function buildPanel() {
  const host = $('presets');
  host.innerHTML = GROUPS.map(([g, label]) => {
    const list = PRESETS.filter(p => p.group === g);
    return `<div class="pgroup">${label}</div><div class="plist">${list.map(p => {
      const sub = p.kind === 'go' ? `${PROTEINS[p.id].pdb} · ${PROTEINS[p.id].seq.length} res` : `best ${p.best}`;
      return `<button class="pcard" type="button" data-id="${p.id}" title="${esc(p.note)}"><b>${esc(p.name)}</b><span>${sub}</span></button>`;
    }).join('')}</div>`;
  }).join('');
  $('presetSel').innerHTML = GROUPS.map(([g, label]) => `<optgroup label="${label}">${PRESETS.filter(p => p.group === g).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
  $('presetSel').onchange = e => loadPreset(e.target.value);
  host.addEventListener('click', e => { const b = e.target.closest('.pcard'); if (b) { loadPreset(b.dataset.id); if (PHONE_Q.matches) panel.scrollTo({ top: 0, behavior: 'smooth' }); } });

  $('runBtn').onclick = () => setRunning(!S.running);
  $('dockPlay').onclick = () => setRunning(!S.running);
  $('stepBtn').onclick = () => { if (S.running) setRunning(false); sendAll({ type: 'step', n: S.kind === 'go' ? Math.max(50, Math.min(2000, speedToRate(S.speed, 3.6))) : 1 }); };
  $('resetBtn').onclick = restart; $('dockReset').onclick = restart;
  for (const b of document.querySelectorAll('#starts button')) b.onclick = () => { S.start = b.dataset.start; syncUI(); restart(); };

  const tempPreset = t => {
    if (!P) return;
    if (t === 'ramp') { if (S.ramp) { S.ramp = null; resetHist(); syncTemp(); } else startRamp(); return; }
    setTemp(t === 'quench' ? 0.55 : t === 'melt' ? 1.3 : P.pr.fold);
  };
  for (const b of document.querySelectorAll('#tempBtns button')) b.onclick = () => tempPreset(b.dataset.t);
  $('dockSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t) tempPreset(b.dataset.t);
    if (b.dataset.d) { S.hpDim = +b.dataset.d; loadPreset(S.preset.id, true); }
  });
  $('temp').oninput = e => setTemp(+e.target.value);
  $('gamma').oninput = e => { S.gamma = Math.pow(10, +e.target.value); sendAll({ type: 'set', gamma: S.gamma }); $('gammaV').textContent = `${S.gamma.toFixed(2)} /τ`; };
  $('speed').oninput = e => { S.speed = +e.target.value; sendAll({ type: 'set', rate: speedToRate(S.speed, 3.6) }); $('speedV').textContent = rateLabel(speedToRate(S.speed, 3.6), 'st/fr'); };
  $('pull').oninput = e => { S.pull = +e.target.value; sendAll({ type: 'set', pull: S.pull }); $('pullV').textContent = S.pull ? `${S.pull.toFixed(2)} ε/Å` : 'off'; };
  for (const b of document.querySelectorAll('#reps button')) b.onclick = () => { S.R = +b.dataset.r; loadPreset(S.preset.id, true); };
  for (const b of document.querySelectorAll('#colours button')) b.onclick = () => { S.colour = b.dataset.c; colours(true); syncUI(); };
  $('tGhost').onclick = () => { S.ghost = !S.ghost; for (const v of S.views) if (v.ghost) v.ghost.visible = S.ghost; syncUI(); };
  $('tLines').onclick = () => { S.lines = !S.lines; for (const v of S.views) if (v.lines) v.lines.visible = S.lines; syncUI(); };
  $('tOrbit').onclick = () => { S.orbit = !S.orbit; syncUI(); };

  for (const b of document.querySelectorAll('#dims button')) b.onclick = () => { S.hpDim = +b.dataset.d; loadPreset(S.preset.id, true); };
  for (const b of document.querySelectorAll('#hpModes button')) b.onclick = () => { S.hpMode = b.dataset.m; S.hp?.host.post({ type: 'set', mode: S.hpMode, Tfix: S.hpLo }); syncUI(); };
  for (const b of document.querySelectorAll('#hpReps button')) b.onclick = () => { S.hpR = +b.dataset.r; loadPreset(S.preset.id, true); };
  $('hpLo').oninput = e => { S.hpLo = Math.min(+e.target.value, S.hpHi - 0.05); S.hp?.host.post({ type: 'set', Tlo: S.hpLo, Tfix: S.hpLo }); syncUI(); };
  $('hpHi').oninput = e => { S.hpHi = Math.max(+e.target.value, S.hpLo + 0.05); S.hp?.host.post({ type: 'set', Thi: S.hpHi }); syncUI(); };
  $('hpSpeed').oninput = e => { S.hpSpeed = +e.target.value; S.hp?.host.post({ type: 'set', rate: speedToRate(S.hpSpeed, 3) }); syncUI(); };

  // panel open and close; the sheet grip on phones
  $('gear').onclick = () => setOpen(true);
  dockPanel.onclick = () => setOpen(!panel.classList.contains('open'));
  $('panelClose').onclick = () => setOpen(false);
  const grip = $('sheetGrip'); let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });

  // the explainer
  const learn = $('learn');
  const openLearn = on => { learn.hidden = !on; if (on) learn.scrollTop = 0; };
  for (const id of ['learnBtn', 'learnBtn2', 'learnFab']) $(id).onclick = () => openLearn(true);
  $('learnClose').onclick = () => openLearn(false);
  addEventListener('keydown', e => { if (e.key === 'Escape') openLearn(false); if (e.key === ' ' && e.target === document.body) { e.preventDefault(); setRunning(!S.running); } });
  mountEquations(document);
}

// ── page lifetime ────────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => sendAll({ type: 'set', running: S.running && !document.hidden }));
addEventListener('pagehide', () => {
  alive = false; cancelAnimationFrame(raf);
  killAll();
  try { controls.dispose(); renderer && renderer.dispose(); renderer && renderer.forceContextLoss(); } catch (e) {}
});
PHONE_Q.addEventListener('change', e => setOpen(!e.matches));

// debug and headless checks
window.__fold = { S, get P() { return P; }, loadPreset, setTemp, startRamp, setRunning, restart, cards: () => cards, camera, pivot, controls, scene };

// The screensaver plate (opts.label) for the current preset: the protein
// (name, PDB id, residues, sequence and its helix/strand share), the energy
// model of model.js written in Unicode, and the live values: T, the replica
// mean energy E and the fraction of native contacts Q, with the ramp
// direction, as params with TeX symbols, and the TeX of typeset.mjs. The
// plain lines stay: push() in the hook compares them.
// Plate colours: the classes of typeset.mjs (r m1, V and E m2, Q m3, T m4,
// gamma m5, F m6). The TeX is the TeX of typeset.mjs.
const SV_RULES = [['\\mathbf r', 'm1'], ['r', 'm1'], ['V', 'm2'], ['E', 'm2'], ['Q', 'm3'], ['T', 'm4'], ['\\gamma', 'm5'], ['F', 'm6']];
// The chain on screen, for the plate leader, when one replica is shown:
// every bead (v.x in the group frame, through v.group.matrixWorld and the
// render camera, as tags() does) in page px. The centre is their mean, the
// radius holds all beads plus 10 px, and the key points are the N and C
// ends. Two or more replicas fill the window in a grid, so then the plate
// has no anchor (a 1440x900 run gave r = 611 px for four replicas).
const atv = new THREE.Vector3();
function chainAnchor() {
  if (!renderer || !S.views || S.views.length !== 1) return null;
  const b = canvas.getBoundingClientRect(), w = canvas.clientWidth, h = canvas.clientHeight, all = [], pts = [];
  const P2 = (v, i) => { atv.set(v.x[3 * i], v.x[3 * i + 1], v.x[3 * i + 2]).applyMatrix4(v.group.matrixWorld).project(camera);
    return atv.z < 1 ? { x: b.left + (atv.x + 1) / 2 * w, y: b.top + (1 - atv.y) / 2 * h } : null; };
  for (const v of S.views) {
    if (!v.x || !v.N) continue;
    for (let i = 0; i < v.N; i++) { const q = P2(v, i); if (q) all.push(q); }
    for (const i of [0, v.N - 1]) { const q = P2(v, i); if (q && pts.length < 8) pts.push(q); }
  }
  if (!all.length) return null;
  let x = 0, y = 0; for (const q of all) { x += q.x; y += q.y; } x /= all.length; y /= all.length;
  let r = 0; for (const q of all) r = Math.max(r, Math.hypot(q.x - x, q.y - y));
  return { x, y, r: r + 10, pts };
}
function seqSummary(seq) { return seq.length <= 36 ? seq : `${seq.slice(0, 14)}…${seq.slice(-14)}`; }
function saverPlate() {
  const pr = S.preset;
  if (!pr) return null;
  if (S.kind === 'hp' && S.hp) {
    const f = S.hp.frame, seq = pr.seq, nh = [...seq].filter(c => c === 'H').length;
    return {
      title: pr.name,
      sub: `HP lattice · ${S.hpDim === 2 ? 'square' : 'cubic'} · ${seq.length} beads · ${nh} H`,
      lines: [seqSummary(seq), f ? 'One H–H lattice contact is −1 ε.' : 'Searching…'],
      params: f ? [{ sym: 'E', name: 'energy now', value: f.E[0] + ' ε', cls: 'm2' }, { sym: 'E_{\\min}', name: 'best found', value: f.bestE + ' ε', cls: 'm2' }]
        .concat(S.hpDim === 2 ? [{ sym: 'E^{*}', name: 'best known', value: pr.best + ' ε', cls: 'm2' }] : []) : [],
      tex: [String.raw`E = -\sum_{i<j-1} h_i\,h_j\,\Delta(\mathbf r_i,\mathbf r_j), \qquad h_i = \begin{cases}1 & \text{H}\\ 0 & \text{P}\end{cases}`],
      rules: SV_RULES, anchor: chainAnchor,
      eq: ['E = −Σ hᵢ hⱼ Δ(rᵢ, rⱼ)   (|i − j| > 1)', 'hᵢ = 1 for H, 0 for P', 'one H–H lattice contact = −1 ε'],
    };
  }
  if (!P) return null;
  const fr = S.sims.map(s => s.frame).filter(Boolean);
  const n = fr.length || 1, mean = k => fr.reduce((a, f) => a + f.obs[k], 0) / n;
  const ss = P.prot.ss, h = (ss.match(/H/g) || []).length, e = (ss.match(/E/g) || []).length;
  const pc = v => Math.round(100 * v / P.N) + '%';
  const Q = mean('Q'), folded = fr.filter(f => f.obs.Q >= 0.8).length;
  return {
    title: pr.name,
    sub: `PDB ${P.prot.pdb} · ${P.N} residues · ${P.nc} native contacts`,
    lines: [seqSummary(P.prot.seq), `Helix ${pc(h)}, strand ${pc(e)}. Gō model, one bead per residue.`],
    params: [{ sym: 'T', name: S.ramp ? (S.ramp.phase % 2 < 1 ? 'cooling' : 'heating') : 'temperature', value: `${S.tFrac.toFixed(2)} Tₘ`, cls: 'm4' }]
      .concat(fr.length ? [{ sym: 'E', name: 'mean energy', value: mean('E').toFixed(1) + ' ε', cls: 'm2' },
        { sym: 'Q', name: 'native contacts', value: `${Q.toFixed(2)} (${Math.round(Q * P.nc)} of ${P.nc})`, cls: 'm3' },
        { sym: 'N_f', name: 'replicas folded', value: `${folded} of ${fr.length}` }] : []),
    tex: [String.raw`V_{\text{nat}}=\sum_{\text{native } ij}\varepsilon\Big[5\Big(\frac{\sigma_{ij}}{r_{ij}}\Big)^{12}-6\Big(\frac{\sigma_{ij}}{r_{ij}}\Big)^{10}\Big]`,
      String.raw`Q = \frac{1}{N_c}\sum_{ij\,\in\,\text{native}} \Theta\big(1.2\,\sigma_{ij} - r_{ij}\big)`,
      String.raw`m\,\ddot{\mathbf r}_i = -\nabla_i V - \gamma m\,\dot{\mathbf r}_i + \sqrt{2\gamma m\,k_B T}\;\eta_i(t)`],
    rules: SV_RULES, anchor: chainAnchor,
    eq: [
      'V = Σ K_b(r−r₀)² + Σ K_θ(θ−θ₀)²',
      '  + Σ K₁[1−cos(φ−φ₀)] + K₃[1−cos 3(φ−φ₀)]',
      '  + Σ_nat ε[5(σᵢⱼ/r)¹² − 6(σᵢⱼ/r)¹⁰]',
      '  + Σ_other ε(σ/r)¹²',
      'Q = (1/N_c) Σ_nat Θ(1.2σᵢⱼ − rᵢⱼ)',
    ],
  };
}

// screensaver hook for the shell (lib/screensaver.js). enter() hides the
// GUI so insets() frees the full canvas. Before, the saver kept the boot
// preset (villin, from the URL hash) with one ramp and one slow orbit, so
// every run showed the same fold. Now opts.seed shuffles a tour of runs and
// a new run fades in every seconds/5 (10 to 15 s). Each run draws from the
// seed:
//   protein ... a Go preset or an HP lattice benchmark, in shuffled order
//   start ..... extended chain or random coil (each replica has its own
//               coil seed); presets over 80 residues start native and melt
//   T plan .... fold at the preset T, quench at 0.55 Tm, or the melt and
//               refold ramp
//   gamma ..... Langevin friction 0.2 to 1.0
//   replicas .. 1, 2 or 4 (2 at most on a touch screen)
//   colour .... secondary structure, hydrophobicity or native contacts
//   camera .... a pivot direction, elevation, orbit speed and sense
// loadPreset does not write the URL hash while saverOn is set.
// The plate (saverPlate) goes to opts.label at each new run and then when T
// has moved 0.04 Tm, or Q 0.1, since the last call (on the HP lattice: when
// its energy line changes), at most once in 4 s.
const SAVER_COLOURS = [['ss', 'secondary structure'], ['hyd', 'hydrophobicity'], ['con', 'native contacts']];
let saverRun = null;
window.snSaver = {
  enter(o) {
    o = o || {};
    saverOn = true;
    const calm = clamp(o.calm != null ? o.calm : 0.7, 0, 1);
    const st = document.createElement('style');
    st.textContent = 'body *:not(#view){visibility:hidden!important;pointer-events:none!important}#view{visibility:visible!important;transition:opacity .6s ease}';
    document.head.appendChild(st);
    if (renderer) renderer.setClearColor(0x08090f, 1);   // --ink, so a recording is opaque
    S.orbit = true; idle = 3;
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const pick = a => a[Math.floor(rnd() * a.length)];
    // Go presets up to 80 residues fold in a hold; larger ones melt from
    // native. HP benchmarks up to 50 beads, so the search shows progress.
    const order = PRESETS.filter(p => p.kind === 'go' || p.seq.length <= 50).map(p => p.id);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const hold = clamp((o.seconds || 60) / 5, 10, 15) * 1000;
    let oi = 0, last = null, at = 0;
    const push = force => {
      if (typeof o.label !== 'function') return;
      const info = saverPlate(); if (!info) return;
      if (saverRun) info.lines = (info.lines || []).concat([saverRun.note]);
      const fr = S.sims.map(s => s.frame).filter(Boolean);
      const q = fr.length ? fr.reduce((a, f) => a + f.obs.Q, 0) / fr.length : -1;
      const now = performance.now();
      const txt = JSON.stringify(info.params || info.lines);
      const same = S.kind === 'hp' ? last && txt === last.txt
        : last && Math.abs(S.tFrac - last.t) < 0.04 && Math.abs(q - last.q) < 0.1 && (last.q >= 0 || q < 0);
      if (!force && (now - at < 4000 || same)) return;
      last = { t: S.tFrac, q, txt }; at = now;
      o.label(info);
    };
    const run = () => {
      const pr = presetById(order[oi++ % order.length]);
      S.R = pick(COARSE ? [1, 2, 2] : [1, 2, 4, 4]);
      S.colour = pick(SAVER_COLOURS)[0];
      S.gamma = 0.2 + 0.8 * rnd();
      loadPreset(pr.id);
      let note = '';
      if (S.kind === 'go') {
        const big = P.N > 80, plan = big ? 'melt' : pick(['fold', 'fold', 'quench', 'ramp']);
        S.start = big ? 'native' : pick(['extended', 'coil']);
        restart();
        if (plan === 'ramp') startRamp(); else setTemp(plan === 'melt' ? 1.3 : plan === 'quench' ? 0.55 : pr.fold);
        note = `Start ${S.start}, ${plan === 'ramp' ? 'melt and refold ramp' : plan === 'melt' ? 'melting at 1.3 Tm' : plan === 'quench' ? 'quench to 0.55 Tm' : `folding at ${pr.fold} Tm`}, γ ${S.gamma.toFixed(2)}, ${S.R} ${S.R === 1 ? 'replica' : 'replicas'}, coloured by ${SAVER_COLOURS.find(c => c[0] === S.colour)[1]}.`;
      } else note = `Replica-exchange search, ${S.hpR} replicas.`;
      colours(true);
      // the camera: a seeded direction and orbit (a 2D lattice stays face on)
      if (!(S.kind === 'hp' && S.hpDim === 2)) {
        const az = 6.2832 * rnd(), el = -0.35 + 1.0 * rnd(), d = pivot.position.length() || D0;
        pivot.position.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(d);
        controls.update();
      }
      controls.autoRotateSpeed = (rnd() < 0.5 ? -1 : 1) * (0.5 + 0.9 * rnd()) * (1 - 0.5 * calm);
      saverRun = { note };
      frameCamera();
      last = null; push(true);
    };
    setRunning(true);
    run();
    let t0 = performance.now(), fading = false;
    setInterval(() => {
      const now = performance.now();
      if (!fading && now - t0 > hold) {
        fading = true; canvas.style.opacity = '0';
        setTimeout(() => { run(); canvas.style.opacity = '1'; fading = false; t0 = performance.now(); }, 650);
      }
      push(false);
    }, 250);
    return { canvas, warmupMs: 2000 };
  },
};

// ── boot ─────────────────────────────────────────────────────────────────────
buildPanel();
setOpen(!PHONE_Q.matches);
pivot.position.set(0.32, 0.22, 1).normalize().multiplyScalar(D0);
controls.update();
S.lastView = 'tilt';
const startId = (location.hash || '').slice(1);
loadPreset(presetById(startId) ? startId : 'villin');
setRunning(true);
requestAnimationFrame(frame);

// VR and AR: the replica grid as the model. Its box is the cells round the
// replica centres, in scene units (Å).
if (renderer) window.__fold.xr = initXR({
  renderer, scene, camera, controls, S, $, setRunning, restart, loadPreset, PRESETS,
  cell: () => grid.cell,
  bounds: () => {
    const b = new THREE.Box3();
    for (const v of S.views) b.expandByPoint(v.group.position);
    return b.isEmpty() ? new THREE.Box3(new THREE.Vector3(-20, -20, -20), new THREE.Vector3(20, 20, 20)) : b.expandByScalar(grid.cell / 2);
  },
});
