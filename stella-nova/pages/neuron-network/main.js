// ============================================================================
//  NEURAL NETWORK  ·  main.js  ·  page logic
// ----------------------------------------------------------------------------
//  Binds index.html. Runs ../neuron-lab/engine/network.js on the CPU (a
//  few hundred to 3000 two-compartment HH cells; one step of 3000 cells
//  costs about 0.08 ms of CPU, so no WebGPU path is needed) and draws:
//    - each cell as a soft point that flashes white when it spikes
//    - each spike as up to K sparks that fly along K of its NetCons and
//      land at the target when the event is due (delay = synaptic + axon)
//    - a sample of NetCons as faint lines, and the column or ring guides
//  The raster and the population rate (E and I) are 2D canvases; the
//  rhythm readout is the peak of the E rate spectrum.
//
//  grep -n targets
//    "function build"       network, points, links, pulses, guides
//    "function emit"        spikes become sparks along NetCons
//    "function drawRaster"  raster and rates
//    "function layout"      desktop columns or phone sheet; clear area
//    "function frame"       the loop
//    "installSaver"         the screensaver (saver.js)
// ============================================================================
import * as THREE from 'three';
import { makeNetwork, MODELS, popRate, peakFreq } from '../neuron-lab/engine/network.js';
import { createStage } from '../neuron-lab/shared/stage.js';
import { typesetAll } from '../../lib/sci-math.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const PMAX = COARSE ? 3000 : 9000; // sparks in the pool

const P = { model: 'ping', N: COARSE ? 600 : 1200, seed: 1, speed: 15, paused: false, pulses: true, links: true, orbit: true, drive: 1, wei: 1, wie: 1, wee: 1, tauI: MODELS.ping.tauI, celsius: MODELS.ping.celsius };
try { const h = location.hash.slice(1); if (MODELS[h]) P.model = h; } catch (e) { /* file: */ }

const stage = createStage({ canvas: $('view'), coarse: COARSE, onNoGL: () => { $('nogl').hidden = false; }, bloom: { strength: 1.1, radius: 0.6, threshold: 0.12 } });
const W = { net: null, pts: null, links: null, sparks: null, guides: null, group: new THREE.Group(), saver: false, saverTick: null, rhythm: null, rhythmT: 0, R: Math.random };
if (stage) stage.scene.add(W.group);

// ── materials ───────────────────────────────────────────────────────────
const pointMat = () => new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uSize: { value: 1 }, uFlash: { value: 3.0 } },
  vertexShader: `
    attribute float aType; attribute float aLast; uniform float uT; uniform float uSize; uniform float uFlash;
    varying vec3 vCol; varying float vA;
    void main(){
      float age = uT - aLast; float f = age >= 0.0 ? exp(-age / uFlash) : 0.0;
      vec3 base = aType > 0.5 ? vec3(1.0, 0.36, 0.6) : vec3(0.37, 0.66, 1.0);
      vCol = base * (0.30 + 0.25 * aType) + vec3(1.0, 0.95, 0.85) * f * 1.6 + base * f * 1.2;
      vA = 0.55 + 0.45 * f;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = uSize * (1.0 + 1.8 * f) * (1.0 + 0.3 * aType) / max(1.0, -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying vec3 vCol; varying float vA;
    void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
      float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vCol * a, a * vA);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const sparkMat = () => new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uSize: { value: 1 } },
  vertexShader: `
    attribute vec3 aTo; attribute vec2 aTime; attribute float aType; uniform float uT; uniform float uSize;
    varying vec3 vCol; varying float vA;
    void main(){
      float f = (uT - aTime.x) / max(0.001, aTime.y - aTime.x);
      vec3 p = mix(position, aTo, clamp(f, 0.0, 1.0));
      float on = step(0.0, f) * step(f, 1.0);
      vCol = aType > 0.5 ? vec3(1.0, 0.45, 0.75) : vec3(0.55, 0.9, 1.0);
      vA = on * (0.5 + 0.5 * sin(3.14159 * clamp(f, 0.0, 1.0)));
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = on * uSize / max(1.0, -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying vec3 vCol; varying float vA;
    void main(){ if (vA <= 0.0) discard; vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
      float a = smoothstep(0.5, 0.0, r) * vA; gl_FragColor = vec4(vCol * a * 1.6, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

// ── build ───────────────────────────────────────────────────────────────
function clearGroup() {
  for (const o of [...W.group.children]) { W.group.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }
}
function build(o = {}) {
  const t0 = performance.now();
  const net = makeNetwork({ model: P.model, N: P.N, seed: P.seed, celsius: P.celsius, params: { tauI: P.tauI } });
  W.net = net; W.buildMs = performance.now() - t0;
  net.setDrive(P.drive); net.scaleWeights({ ee: P.wee, ei: P.wei, ie: P.wie, ii: 1 });
  net.onSpike = (i, tc) => emit(i, tc);
  W.spikeQ = [];
  if (stage) {
    clearGroup();
    const N = net.N, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(net.pos, 3));
    const ty = new Float32Array(N); for (let i = net.NE; i < N; i++) ty[i] = 1;
    g.setAttribute('aType', new THREE.BufferAttribute(ty, 1));
    W.last = new THREE.BufferAttribute(new Float32Array(N).fill(-1e9), 1); W.last.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aLast', W.last);
    W.pts = new THREE.Points(g, pointMat()); W.pts.frustumCulled = false; W.group.add(W.pts);
    // sparks
    const sg = new THREE.BufferGeometry();
    W.sp = { from: new Float32Array(PMAX * 3), to: new Float32Array(PMAX * 3), time: new Float32Array(PMAX * 2).fill(-1), type: new Float32Array(PMAX), k: 0 };
    sg.setAttribute('position', new THREE.BufferAttribute(W.sp.from, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aTo', new THREE.BufferAttribute(W.sp.to, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aTime', new THREE.BufferAttribute(W.sp.time, 2).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aType', new THREE.BufferAttribute(W.sp.type, 1).setUsage(THREE.DynamicDrawUsage));
    W.sparks = new THREE.Points(sg, sparkMat()); W.sparks.frustumCulled = false; W.group.add(W.sparks);
    // a sample of NetCons as lines
    const nl = Math.min(net.nNetCon, COARSE ? 900 : 2400), lp = new Float32Array(nl * 6), lc = new Float32Array(nl * 6), R = rngLocal(P.seed + 5);
    for (let q = 0; q < nl; q++) {
      const c = Math.floor(R() * net.nNetCon); let pre = 0; { let lo = 0, hi = net.N; while (lo < hi) { const m = (lo + hi) >> 1; if (net.ptr[m + 1] <= c) lo = m + 1; else hi = m; } pre = lo; }
      const post = net.tgt[c];
      for (let k = 0; k < 3; k++) { lp[q * 6 + k] = net.pos[pre * 3 + k]; lp[q * 6 + 3 + k] = net.pos[post * 3 + k]; }
      const col = pre < net.NE ? [0.25, 0.45, 0.8] : [0.8, 0.25, 0.5];
      for (let k = 0; k < 3; k++) { lc[q * 6 + k] = col[k]; lc[q * 6 + 3 + k] = col[k] * 0.4; }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    W.links = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false }));
    W.links.visible = P.links; W.group.add(W.links);
    // guides
    const gl = [], ring = (r, y, n = 96) => { for (let k = 0; k < n; k++) { const a = k / n * 6.2832, b = (k + 1) / n * 6.2832; gl.push(r * Math.cos(a), y, r * Math.sin(a), r * Math.cos(b), y, r * Math.sin(b)); } };
    if (net.M.layout === 'ring') { ring(520, 0, 160); ring(470, 0, 160); ring(570, 0, 160); }
    else { ring(310, 470); ring(310, -470); ring(310, 240, 64); ring(310, -260, 64); for (let k = 0; k < 8; k++) { const a = k / 8 * 6.2832; gl.push(310 * Math.cos(a), -470, 310 * Math.sin(a), 310 * Math.cos(a), 470, 310 * Math.sin(a)); } }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
    W.guides = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x2a5a8a, transparent: true, opacity: 0.35, depthWrite: false }));
    W.group.add(W.guides);
    W.size = pointSize(net.N);
  }
  W.rhythm = null;
  fillInfo();
  if (o.fit !== false && stage && !W.saver) fitCamera(o.soft);
  if (net.M.layout === 'ring' && o.kick !== false) setTimeout(() => kick(), 300);
}
// gl_PointSize = uSize / depth: px at the fit distance (about 1900 um) times that distance
function pointSize(N) { return Math.max(3, 220 / Math.sqrt(N)) * Math.max(0.6, stage.H / 800) * Math.min(2, devicePixelRatio || 1) * 1900; }
function rngLocal(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// A spike: up to K sparks along random outgoing NetCons, landing when the event is due.
function emit(i, tc) {
  if (!stage || !P.pulses) return;
  const net = W.net, sp = W.sp, a = net.ptr[i], b = net.ptr[i + 1], n = b - a; if (!n) return;
  const K = net.N > 2000 ? 2 : net.N > 900 ? 3 : 5;
  for (let q = 0; q < K; q++) {
    const c = a + Math.floor(W.R() * n), t = net.tgt[c], k = sp.k; sp.k = (k + 1) % PMAX;
    for (let d = 0; d < 3; d++) { sp.from[k * 3 + d] = net.pos[i * 3 + d]; sp.to[k * 3 + d] = net.pos[t * 3 + d]; }
    sp.time[k * 2] = tc; sp.time[k * 2 + 1] = tc + net.dsteps[c] * net.dt; sp.type[k] = i < net.NE ? 0 : 1;
  }
  W.sparkDirty = true;
}

// ── stimuli ─────────────────────────────────────────────────────────────
function pulseAt(p, r = 120, amp = 1.5) { const n = W.net.stimulate({ p, r, amp, dur: 2, sel: 'E' }); W.lastStim = { p, t: W.net.t }; return n; }
function randomCellPos(sel = 'E') { const net = W.net, i = sel === 'E' ? Math.floor(W.R() * net.NE) : net.NE + Math.floor(W.R() * (net.N - net.NE)); return [net.pos[i * 3], net.pos[i * 3 + 1], net.pos[i * 3 + 2]]; }
function kick() { const net = W.net; if (net.M.layout === 'ring') pulseAt([520, 0, 0], 90, 2); else pulseAt(randomCellPos(), 140, 2); }
let sweepState = null;
function sweep() { sweepState = { t0: W.net.t, dur: 40 }; }
function sweepStep() {
  if (!sweepState) return; const net = W.net, k = (net.t - sweepState.t0) / sweepState.dur;
  if (k > 1) { sweepState = null; return; }
  const ring = net.M.layout === 'ring';
  for (let q = 0; q < 3; q++) {
    const p = ring ? [520 * Math.cos(k * 6.283), 0, 520 * Math.sin(k * 6.283)] : [-320 + 640 * k, (W.R() - 0.5) * 900, (W.R() - 0.5) * 500];
    net.stimulate({ p, r: 80, amp: 1.5, dur: 1.5, sel: 'E' });
  }
}

// ── plots ───────────────────────────────────────────────────────────────
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w: r.width, h: r.height };
}
// span ms of raster ending at net.t; opts.t0 fixes the left edge (the saver score)
export function drawRaster(cv, opts = {}) {
  const net = W.net, { g, w, h } = fitCanvas(cv), span = opts.span || 400;
  const t1 = opts.t0 != null ? opts.t0 + span : net.t, t0 = t1 - span;
  g.fillStyle = opts.bg || '#060a13'; g.fillRect(0, 0, w, h);
  const top = opts.pad || 6, hh = h - top * 2, yE = hh * net.NE / net.N;
  g.fillStyle = 'rgba(95,168,255,0.05)'; g.fillRect(0, top, w, yE);
  g.fillStyle = 'rgba(255,92,154,0.06)'; g.fillRect(0, top + yE, w, hh - yE);
  const S = net.spikes, dot = opts.dot || Math.max(1.2, Math.min(2.4, hh / net.N * 1.6));
  for (let q = S.length - 2; q >= 0; q -= 2) {
    const t = S[q]; if (t < t0) break; if (t > t1) continue;
    const c = S[q + 1], x = (t - t0) / span * w, y = top + c / net.N * hh;
    const age = net.t - t;
    g.fillStyle = age < 3 ? '#fff3d8' : c < net.NE ? '#5fa8ff' : '#ff5c9a';
    g.fillRect(x, y, dot, dot);
  }
  if (opts.t0 != null) { const x = (net.t - t0) / span * w; g.fillStyle = 'rgba(255,243,216,0.8)'; g.fillRect(x, top, 1.5, hh); }
  if (!opts.bare) { g.font = '10px ui-monospace, Menlo, monospace'; g.fillStyle = '#56627a'; g.fillText(span + ' ms', w - 46, h - 3); g.fillText('E', 3, top + 10); g.fillText('I', 3, top + yE + 10); }
}
function drawRate(cv) {
  const net = W.net, { g, w, h } = fitCanvas(cv), span = 400;
  g.fillStyle = '#060a13'; g.fillRect(0, 0, w, h);
  const E = popRate(net, span, 1, 0, net.NE), I = popRate(net, span, 1, net.NE, net.N);
  let mx = 20; for (let k = 0; k < span; k++) mx = Math.max(mx, E[k], I[k]);
  const line = (H, col) => { g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath(); for (let k = 0; k < span; k++) { const s = (H[Math.max(0, k - 1)] + H[k] + H[Math.min(span - 1, k + 1)]) / 3, x = k / (span - 1) * w, y = h - 4 - (h - 12) * s / mx; if (k) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); };
  line(I, '#ff5c9a'); line(E, '#5fa8ff');
  g.font = '10px ui-monospace, Menlo, monospace'; g.fillStyle = '#56627a'; g.fillText(Math.round(mx) + ' Hz', 3, 11);
}
function rhythm() {
  const net = W.net; if (net.t < 300) return null;
  const H = popRate(net, 500, 1, 0, net.NE); let tot = 0; for (const x of H) tot += x;
  const meanHz = tot / H.length, pk = peakFreq(H, 1, 8, 150);
  return { f: pk.f, ratio: pk.ratio, meanHz };
}
function bandName(f) { return f < 13 ? 'alpha/theta' : f < 30 ? 'beta' : f <= 90 ? 'gamma' : 'fast'; }

// ── UI ──────────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function fillInfo() {
  const M = MODELS[P.model], net = W.net;
  $('modelNote').textContent = M.note;
  $('netStats').textContent = `${net.N} cells (${net.NE} E, ${net.N - net.NE} I) · ${net.nNetCon.toLocaleString('en-US')} NetCons · built in ${Math.round(W.buildMs)} ms · dt ${net.dt} ms`;
  document.querySelectorAll('#models button').forEach(b => b.classList.toggle('on', b.dataset.id === P.model));
}
const fmt = { ncell: v => v, speed: v => v + ' ms', drive: v => Math.round(v * 100) + '%', wei: v => (+v).toFixed(2), wie: v => (+v).toFixed(2), wee: v => (+v).toFixed(2), taui: v => (+v).toFixed(1) + ' ms', celsius: v => (+v).toFixed(1) + ' °C' };
function showVals() { for (const k in fmt) { const e = $(k), o = $(k + 'V'); if (e && o) o.textContent = fmt[k](e.value); } }
function setInputs() { $('ncell').value = P.N; $('speed').value = P.speed; $('drive').value = P.drive; $('wei').value = P.wei; $('wie').value = P.wie; $('wee').value = P.wee; $('taui').value = P.tauI; $('celsius').value = P.celsius; showVals(); }
function bindRange(id, fn) { $(id).addEventListener('input', () => { fn(+$(id).value); showVals(); }); }
let rebuildT = 0;
function bindUI() {
  $('models').innerHTML = Object.entries(MODELS).map(([id, M]) => `<button type="button" data-id="${id}"><b>${esc(M.short)}</b><span>${esc(M.name)}</span></button>`).join('');
  $('models').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (P.model === b.dataset.id) return; P.model = b.dataset.id; const M = MODELS[P.model];
    P.tauI = M.tauI; P.celsius = M.celsius; P.wei = P.wie = P.wee = 1; P.drive = 1; setInputs(); build({ soft: true });
    try { history.replaceState(null, '', '#' + P.model); } catch (e) { /* file: */ }
  }));
  bindRange('ncell', v => { P.N = v; clearTimeout(rebuildT); rebuildT = setTimeout(() => build({ fit: false }), 250); });
  bindRange('speed', v => { P.speed = v; });
  bindRange('drive', v => { P.drive = v; W.net.setDrive(v); });
  const sc = () => W.net.scaleWeights({ ee: P.wee, ei: P.wei, ie: P.wie, ii: 1 });
  bindRange('wei', v => { P.wei = v; sc(); }); bindRange('wie', v => { P.wie = v; sc(); }); bindRange('wee', v => { P.wee = v; sc(); });
  bindRange('taui', v => { P.tauI = v; W.net.M.tauI = v; });
  bindRange('celsius', v => { P.celsius = v; W.net.setCelsius(v); });
  const tog = (id, key, after) => $(id).addEventListener('click', () => { P[key] = !P[key]; $(id).classList.toggle('on', P[key]); if (after) after(); });
  tog('pause', 'paused'); tog('tPulses', 'pulses'); tog('tLinks', 'links', () => { if (W.links) W.links.visible = P.links; }); tog('autoOrbit', 'orbit');
  $('rewire').addEventListener('click', () => { P.seed = (P.seed % 9973) + 1; build({ fit: false }); });
  $('pulseAll').addEventListener('click', () => W.net.stimulate({ p: [0, 0, 0], r: 1e5, amp: 1.5, dur: 2, sel: 'E' }));
  $('sweep').addEventListener('click', sweep);
  $('kick').addEventListener('click', kick);
  $('silence').addEventListener('click', () => W.net.stimulate({ p: [0, 0, 0], r: 1e5, amp: -3, dur: 60, sel: 'I' }));
  $('fire').addEventListener('click', kick); $('dockFire').addEventListener('click', kick);
  document.querySelectorAll('#dock button[data-grp]').forEach(b => b.addEventListener('click', () => openGroup(b.dataset.grp === openG ? null : b.dataset.grp)));
  $('panelClose').addEventListener('click', () => openGroup(null));
  setInputs();
}
let openG = null;
function openGroup(g) {
  openG = g;
  $('panel').classList.toggle('open', !!g);
  document.querySelectorAll('#panel .grp').forEach(s => s.classList.toggle('show', s.dataset.grp === g));
  document.querySelectorAll('#dock button[data-grp]').forEach(b => b.classList.toggle('on', b.dataset.grp === g));
  setTimeout(layout, 320);
}
function layout() {
  const phone = PHONE_Q.matches, ana = $('anaPanel'), panel = $('panel');
  document.querySelectorAll('.grp.ana').forEach(s => { const host = phone ? panel : ana; if (s.parentNode !== host) host.appendChild(s); });
  if (!stage) return;
  stage.resize();
  if (W.net) W.size = pointSize(W.net.N);
  if (W.saver) return;
  const v = $('view').getBoundingClientRect();
  let x0 = 0, x1 = v.width, y0 = 0, y1 = v.height;
  if (!phone) { x0 = panel.getBoundingClientRect().right - v.left; x1 = ana.getBoundingClientRect().left - v.left; }
  else {
    const dk = $('dock').getBoundingClientRect();
    if (dk.width > dk.height) y1 = dk.top - v.top; else x0 = dk.right - v.left;
    if (panel.classList.contains('open')) { const pr = panel.getBoundingClientRect(); if (pr.width > v.width * 0.8) y1 = Math.min(y1, pr.top - v.top); else x1 = Math.min(x1, pr.left - v.left); }
  }
  stage.frame({ x0, y0, x1, y1 });
}
function fitCamera(soft) {
  const ring = W.net.M.layout === 'ring', R = ring ? 620 : 640, fov = stage.camera.fov * Math.PI / 180;
  const o = { az: 0.6, el: ring ? 0.75 : 0.18, r: R / Math.tan(fov / 2) / stage.fit, target: [0, 0, 0] };
  if (soft) stage.flyTo(o, 2); else stage.jump(o);
}

// ── picking ─────────────────────────────────────────────────────────────
const _v = new THREE.Vector3();
function pickCell(cx, cy) {
  const net = W.net, rect = $('view').getBoundingClientRect(), lim = COARSE ? 44 : 30;
  let best = -1, bd = lim * lim;
  for (let i = 0; i < net.N; i++) {
    _v.set(net.pos[i * 3], net.pos[i * 3 + 1], net.pos[i * 3 + 2]).project(stage.camera);
    if (_v.z > 1) continue;
    const d = ((_v.x + 1) / 2 * rect.width - (cx - rect.left)) ** 2 + ((1 - _v.y) / 2 * rect.height - (cy - rect.top)) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function bindPick() {
  let down = null;
  $('view').addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  $('view').addEventListener('pointerup', e => {
    if (!down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 600) {
      const i = pickCell(e.clientX, e.clientY);
      if (i >= 0) { const n = W.net; pulseAt([n.pos[i * 3], n.pos[i * 3 + 1], n.pos[i * 3 + 2]]); $('hint').classList.add('gone'); }
    }
    down = null;
  });
}

// ── loop ────────────────────────────────────────────────────────────────
function stepSim(ms) {
  const net = W.net, n = Math.min(600, Math.round(ms / net.dt));
  for (let i = 0; i < n; i++) { sweepStep(); net.step(); }
  // keep 1.5 s of spikes
  const S = net.spikes; if (S.length > 400000) { let k = 0; while (k < S.length && S[k] < net.t - 1500) k += 2; S.splice(0, k); }
}
let last = 0, plotT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
  if (!W.net) return;
  if (W.saver) { if (W.saverTick) W.saverTick(dt, now); }
  else {
    if (!P.paused) stepSim(P.speed * dt);
    stage.controls.autoRotate = P.orbit && !stage.springOn; stage.controls.autoRotateSpeed = 0.3;
  }
  if (!stage) return;
  const net = W.net, la = W.last.array;
  for (let i = 0; i < net.N; i++) la[i] = net.lastSpike[i];
  W.last.needsUpdate = true;
  W.pts.material.uniforms.uT.value = net.t; W.pts.material.uniforms.uSize.value = W.size;
  W.sparks.material.uniforms.uT.value = net.t; W.sparks.material.uniforms.uSize.value = W.size * 0.55;
  if (W.sparkDirty) { const a = W.sparks.geometry.attributes; a.position.needsUpdate = a.aTo.needsUpdate = a.aTime.needsUpdate = a.aType.needsUpdate = true; W.sparkDirty = false; }
  stage.update(dt);
  stage.render();
  if (!W.saver && now - plotT > 60) {
    plotT = now;
    if ($('raster').offsetParent !== null) drawRaster($('raster'));
    if ($('rate').offsetParent !== null) drawRate($('rate'));
    if (now - W.rhythmT > 300) { W.rhythmT = now; W.rhythm = rhythm(); readout(); }
  }
}
function readout() {
  const net = W.net, r = W.rhythm, M = MODELS[P.model];
  const rtxt = !r ? 'warming up' : r.ratio > 12 ? `${r.f} Hz ${bandName(r.f)}` : 'no clear rhythm';
  $('rhythm').innerHTML = `rhythm: <b>${esc(rtxt)}</b>${r ? ` · E mean ${r.meanHz.toFixed(1)} Hz` : ''}`;
  $('read').innerHTML = `${esc(M.short)} · ${net.N} cells · t <span class="hi">${net.t.toFixed(0)}</span> ms<br>rhythm <span class="hi">${esc(rtxt)}</span><br><span class="lo">${(net.spikes.length / 2).toLocaleString('en-US')} spikes kept</span>`;
}

// ── boot ────────────────────────────────────────────────────────────────
bindUI();
if (stage) {
  bindPick();
  layout();
  build({ soft: false });
  addEventListener('resize', layout);
  PHONE_Q.addEventListener('change', () => { openGroup(null); layout(); });
  requestAnimationFrame(frame);
  installSaver({ W, P, stage, THREE, build, stepSim, pulseAt, kick, randomCellPos, drawRaster, rhythm, bandName, MODELS });
}
typesetAll(document, [['\\theta', 'm1'], ['\\ell', 'm2'], ['\\tau', 'm3'], ['w', 'm2']]);
window.__neuronNet = { W, P };
