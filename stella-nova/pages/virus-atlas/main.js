// ============================================================================
//  VIRUS ATLAS  ·  main.js — state, loading, animation, camera and controls
// ----------------------------------------------------------------------------
//  Loads an entry of catalog.js (its bead files from data/), builds its
//  parts in view.js and animates them. Every animation is a uniform that
//  the vertex shader reads, so a frame never rebuilds geometry:
//    assembly   uAsm 0 -> 1 when an entry opens (units fly in by delay)
//    explode    units move out along their 5-fold axis (or radially)
//    peel       the units on the camera side lift off and fade
//    slice      a plane cuts the beads on the camera side
//    breathe    a slow swell of the whole particle
//    sway       spikes bend on their stalks (virions)
//    orbit      the camera turns slowly when idle
//  Changing entries: the old parts fade and fly out, the camera flies (log
//  distance, slerp of the direction) to frame the new particle.
//
//  The ladder mode puts eleven structures side by side at true scale and
//  zooms out from a 4 nm protein to the 300 nm TMV rod (ladderView).
//
//  grep -n targets:
//    'function buildEntry'   an entry -> parts, membrane, stalks, axes
//    'function show'         open an entry (fade out, build, fly)
//    'function enterLadder'  the lineup and the zoom
//    'function flyTo'        camera flights
//    'function occlusion'    overlay margins for the framing
//    'function frame'        the frame loop
//    'function fillCard'     the info card and credit
//    'function buildUI'      the controls
//    'const app'             the api that saver.js drives
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ENTRIES, GROUPS, CREDIT, LADDER_KEYS, entryByKey, pdbsOf } from './catalog.js';
import { decode, copyOps, fetchBin } from './format.js';
import { bounds, envelopeOps, makeRng, lineupLayout, ladderView, ladderX, niceRuler, LADDER_MARKS, LADDER_FIT, smooth, easeInOut, axesOf } from './symmetry.js';
import { createView } from './view.js';
import { maxInstances, strideFor } from './budget.js';
import { installSaver } from './saver.js';

const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = window.matchMedia('(pointer:coarse)').matches;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);

const G = {
  key: 'polio', color: 'auto', axes: false, hideAb: false, hideGly: false,
  orbit: true, breathe: true, sway: true, bead: 1, mode: 'entry',
};
// animation state (not the user's)
const A = {
  asm: 1, asmDur: 4, explode: 0, explodeT: 0, peel: 0, peelT: 0, slice: 0, sliceT: 0,
  peelN: new THREE.Vector3(0, 0, 1), sliceN: new THREE.Vector3(0, 0, 1), time: 0,
  ladderU: 0, ladderPlay: false, hiK: -1,
  camLock: false,   // saver.js drives the camera
};

const canvas = $('view');
const V = createView(canvas, { coarse: COARSE });
const controls = new OrbitControls(V.camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.rotateSpeed = 0.7;
controls.autoRotateSpeed = 0.5; controls.enablePan = false;
let userAt = -1e9;
controls.addEventListener('start', () => { userAt = performance.now(); fly = null; });

// ── data ───────────────────────────────────────────────────────────────────
const cache = new Map();   // pdb -> Promise<decoded>
function load(pdb, onProgress) {
  if (!cache.has(pdb)) {
    cache.set(pdb, fetchBin(new URL('data/' + pdb.toLowerCase() + '.bin', import.meta.url).href, onProgress).then(decode)
      .catch(e => { cache.delete(pdb); throw e; }));
  }
  return cache.get(pdb);
}

// ── building an entry ─────────────────────────────────────────────────────
// -> { entry, parts, membrane, stalks, axes (list), axesObj, r, size, kind,
//      offset, dispose() }
async function buildEntry(e, opt = {}) {
  const datas = await Promise.all(pdbsOf(e).map(p => load(p, opt.onProgress)));
  const cap = opt.cap || maxInstances(COARSE);
  const off = opt.offset || [0, 0, 0];
  const B = { entry: e, parts: [], membrane: null, stalks: null, axes: [], axesObj: null, offset: off };
  if (e.look === 'virion') {
    const rng = makeRng(opt.seed || 11);
    const spec = { R: e.membrane.r, tilt: e.tilt || 0, parts: e.parts.map((p, i) => ({ count: p.count, stalk: p.stalk, base: datas[i].info.anchor.base / 10 })) };
    const env = envelopeOps(spec, rng.next);
    let top = 0;
    const totalInst = e.parts.reduce((a, p, i) => a + p.count * datas[i].n, 0);
    const stride = Math.max(1, Math.ceil(totalInst / cap));
    e.parts.forEach((p, i) => {
      const d = datas[i], an = d.info.anchor, h = (an.top - an.base) / 10;
      top = Math.max(top, e.membrane.r + p.stalk + h);
      const vd = virionDelays(env.ops[i]), nc = d.info.chains.length, del = new Float32Array(vd.length * nc);
      for (let k = 0; k < vd.length; k++) del.fill(vd[k], k * nc, (k + 1) * nc);
      const part = V.makePart(d, env.ops[i], { kind: 'none', stride, phase: env.phase[i], sway: { h, base: an.base / 10 }, radius: e.membrane.r + p.stalk + h, offset: off, delays: del });
      part.uniforms.uSway.value = 0;
      B.parts.push(part);
    });
    B.membrane = V.makeMembrane(e.membrane.r);
    B.membrane.mesh.position.set(...off);
    B.stalks = V.makeStalks(env.stalks);
    B.stalks.mesh.position.set(...off);
    B.r = top; B.size = 2 * top; B.kind = 'virion';
  } else {
    const d = datas[0], ops = copyOps(d.info, e.layers), m = ops.length / 12;
    const stride = strideFor(d.n, m, cap);
    const kind = d.info.sym.type === 'none' ? 'single' : d.info.sym.type;
    const b = bounds(d, ops, Math.max(1, Math.floor(d.n * m / 200000)));
    const part = V.makePart(d, ops, { kind, stride, fibril: !!d.info.sym.fibril, radius: b.r, offset: off });
    B.parts.push(part);
    B.r = b.r; B.size = Math.max(...b.size); B.kind = kind; B.bounds = b;
    if (kind === 'icosa' || kind === 'cyclic') B.axes = part.axes.length ? part.axes : axesOf(ops);
    else if (kind === 'helix') B.axes = [{ order: 0, dir: [0, 1, 0] }];
    if (e.membrane) { B.membrane = V.makeMembrane(e.membrane.r, '#c99a68'); B.membrane.mesh.position.set(...off); }
  }
  B.dispose = () => {
    B.parts.forEach(p => p.dispose()); B.membrane && B.membrane.dispose(); B.stalks && B.stalks.dispose(); B.axesObj && B.axesObj.dispose();
    B.parts = []; B.membrane = B.stalks = B.axesObj = null;
  };
  applyLook(B);
  return B;
}
// spikes arrive from the top of the virion down, a ring at a time
function virionDelays(ops) {
  const m = ops.length / 12, out = new Float32Array(m);
  for (let k = 0; k < m; k++) out[k] = Math.min(0.999, (1 - ops[12 * k + 7] / (Math.hypot(ops[12 * k + 3], ops[12 * k + 7], ops[12 * k + 11]) || 1)) / 2);
  return out;
}

function colorModeFor(B) {
  if (G.color !== 'auto') return G.color;
  if (B.entry.look === 'capsid' || B.entry.look === 'cone') return B.entry.key === 'zika' || B.entry.key === 'adeno' || B.entry.key === 'polio' || B.entry.key === 'rhino' ? 'protein' : 'radius';
  if (B.entry.look === 'rod') return 'protein';
  if (B.entry.look === 'fibril') return 'copy';
  return 'protein';
}
function applyLook(B) {
  const mode = colorModeFor(B);
  B.parts.forEach((p, i) => {
    if (B.entry.look === 'virion') p.tint = ['#e86f5a', '#f2c14e'][i] || null;
    p.setColors(mode, { antibody: G.hideAb, glycan: G.hideGly });
    p.uniforms.uRad.value = 0.3 * G.bead * (1 + 0.3 * (p.stride - 1)) * (B.entry.look === 'fibril' ? 1.1 : 1);
  });
  if (B.axesObj) { B.axesObj.dispose(); B.axesObj = null; }
  if (G.axes && B.axes.length && G.mode === 'entry') {
    B.axesObj = B.kind === 'helix'
      ? V.makeAxes([{ order: 0, dir: [0, 1, 0] }], Math.max(B.r, B.size / 2) * 0.8)
      : V.makeAxes(B.axes, B.r);
    B.axesObj.group.position.set(...B.offset);
  }
}

// ── showing an entry ──────────────────────────────────────────────────────
let cur = null, leaving = [], showToken = 0;
async function show(key, opt = {}) {
  const e = entryByKey(key) || ENTRIES[0];
  const token = ++showToken;
  G.key = e.key; G.mode = 'entry';
  writeHash();
  syncEntryUI();
  setLoading(0.02);
  let B;
  try { B = await buildEntry(e, { onProgress: f => token === showToken && setLoading(f) }); }
  catch (err) { setLoading(null); toast('Could not load ' + e.name + ': ' + err.message); return null; }
  if (token !== showToken) { B.dispose(); return null; }
  setLoading(null);
  exitLadderUI();
  // the old particle fades and flies out
  if (cur) { leaving.push({ B: cur, t: 0 }); }
  for (const L of lineup) leaving.push({ B: L, t: 0 });
  lineup = [];
  cur = B;
  A.explode = A.explodeT = 0; A.peel = A.peelT = 0; A.slice = A.sliceT = 0; A.hiK = -1;
  syncAnimButtons();
  startAssembly(opt.instant || REDUCED ? 1 : 0);
  fillCard(e, B);
  // fly the camera to frame the new particle
  const dist = fitDistance(B.r);
  const dir = opt.dir || defaultDir(B);
  flyTo(new THREE.Vector3(0, 0, 0), dist, dir, opt.instant ? 0 : 1.6);
  controls.minDistance = B.r * 0.35; controls.maxDistance = B.r * 14;
  return B;
}
function defaultDir(B) {
  if (B.entry.look === 'rod') return new THREE.Vector3(0.95, 0.12, 0.3).normalize();
  if (B.entry.look === 'fibril') return new THREE.Vector3(1, 0.25, 0.55).normalize();
  if (B.entry.look === 'cone') return new THREE.Vector3(1, 0.1, 0.25).normalize();
  return new THREE.Vector3(0.35, 0.3, 1).normalize();
}
function startAssembly(t0 = 0) {
  if (!cur) return;
  const look = cur.entry.look;
  A.asm = t0;
  A.asmDur = look === 'rod' ? 7 : look === 'fibril' ? 7.5 : look === 'cone' ? 6 : look === 'virion' ? 4 : look === 'capsid' ? 5.2 : 2.6;
  for (const p of cur.parts) {
    const u = p.uniforms;
    u.uFly.value = look === 'rod' ? 22 : look === 'fibril' ? cur.size * 0.25 : look === 'virion' ? 40 : cur.r * 1.4;
    u.uJitter.value = look === 'fibril' ? 4.5 : look === 'protein' ? 1.5 : 0;
    u.uSpread.value = look === 'protein' ? 0.5 : 0.78;
  }
  if (cur.membrane) cur.membrane.mesh.scale.setScalar(t0 >= 1 ? 1 : 0.001);
}

// ── the ladder (lineup at true scale) ─────────────────────────────────────
let lineup = [], ladderLayout = null;
async function enterLadder(opt = {}) {
  const token = ++showToken;
  G.mode = 'ladder';
  writeHash(); syncEntryUI();
  setLoading(0.02);
  const items = LADDER_KEYS.map(k => entryByKey(k));
  const capEach = COARSE ? 45000 : 140000;
  let built;
  try {
    // sizes first (the layout needs them), then build with offsets
    const datas = await Promise.all(items.map(e => Promise.all(pdbsOf(e).map(p => load(p, f => token === showToken && setLoading(f))))));
    const sizes = items.map((e, i) => {
      if (e.look === 'virion') { const d = datas[i][0]; return 2 * (e.membrane.r + e.parts[0].stalk + (d.info.anchor.top - d.info.anchor.base) / 10); }
      const d = datas[i][0], ops = copyOps(d.info, e.layers), b = bounds(d, ops, Math.max(1, Math.floor(d.n * ops.length / 12 / 60000)));
      return Math.max(...b.size);
    });
    ladderLayout = lineupLayout(items.map((e, i) => ({ key: e.key, size: sizes[i] })));
    if (token !== showToken) return;
    built = await Promise.all(items.map((e, i) => buildEntry(e, { cap: capEach, offset: [ladderLayout[i].x, 0, 0], seed: 5 })));
  } catch (err) { setLoading(null); toast('Could not load the ladder: ' + err.message); return; }
  if (token !== showToken) { built.forEach(b => b.dispose()); return; }
  setLoading(null);
  if (cur) leaving.push({ B: cur, t: 0 });
  for (const L of lineup) leaving.push({ B: L, t: 0 });
  cur = null; lineup = built;
  for (const B of lineup) for (const p of B.parts) {
    p.uniforms.uAsm.value = 1;
    p.uniforms.uRadialR.value = B.r;
    if (B.entry.look === 'fibril') p.uniforms.uColMode.value = 1;
  }
  A.ladderU = opt.u ?? 0; A.ladderPlay = opt.play !== false;
  fly = null; controls.enabled = false;
  $('ladder').hidden = false; document.body.classList.add('laddering');
  buildLadderBar();
  fillLadderCard();
}
function exitLadderUI() {
  $('ladder').hidden = true; document.body.classList.remove('laddering');
  controls.enabled = true;
  $('ladderLabels').replaceChildren();
}
function ladderCamera(dt) {
  if (!ladderLayout) return;
  if (A.ladderPlay) { A.ladderU += dt / 16; if (A.ladderU >= 1) { A.ladderU = 1; A.ladderPlay = false; syncLadderPlay(); } }
  const v = ladderView(smooth(A.ladderU) * 0.15 + A.ladderU * 0.85, ladderLayout);
  const { w, h } = size(), cw = Math.max(80, w - occ.l - occ.r);
  const vfov = V.camera.fov * Math.PI / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * cw / h);
  const dist = (v.width / 2) / Math.tan(hfov / 2);
  const tgt = new THREE.Vector3(v.x, 0, 0);
  const dir = new THREE.Vector3(0.18, 0.16, 1).normalize();
  V.camera.position.copy(tgt).addScaledVector(dir, dist);
  controls.target.copy(tgt);
  V.camera.lookAt(tgt);
  A.ladderW = v.width;
  updateLadderBar(v.width);
  placeLadderLabels();
  $('ladderScrub').value = String(Math.round(A.ladderU * 1000));
}

// ── camera flights ────────────────────────────────────────────────────────
let fly = null;
function flyTo(target, dist, dir, dur = 1.6) {
  const c = V.camera, t0 = controls.target.clone();
  const d0 = c.position.distanceTo(t0) || dist;
  const dir0 = c.position.clone().sub(t0).normalize();
  if (dur <= 0) {
    controls.target.copy(target); c.position.copy(target).addScaledVector(dir, dist); controls.update(); fly = null; return;
  }
  fly = { t: 0, dur, t0, t1: target.clone(), d0, d1: dist, q0: dir0, q1: dir.clone().normalize() };
}
function stepFly(dt) {
  if (!fly) return;
  fly.t += dt;
  const s = easeInOut(fly.t / fly.dur);
  const tg = fly.t0.clone().lerp(fly.t1, s);
  const d = Math.exp(Math.log(fly.d0) + (Math.log(fly.d1) - Math.log(fly.d0)) * s);
  // slerp of the view direction
  const q = new THREE.Quaternion().setFromUnitVectors(fly.q0, fly.q1);
  const qs = new THREE.Quaternion().slerp(q, s);
  const dir = fly.q0.clone().applyQuaternion(qs);
  controls.target.copy(tg);
  V.camera.position.copy(tg).addScaledVector(dir, d);
  V.camera.lookAt(tg);
  if (fly.t >= fly.dur) fly = null;
}
// the camera distance that fits a ball of radius r in the clear part
function fitDistance(r) {
  const { w, h } = size();
  const wV = Math.max(80, w - occ.l - occ.r), hV = Math.max(80, h - occ.t - occ.b);
  const fov = V.camera.fov * Math.PI / 180, half = Math.atan(Math.tan(fov / 2) * Math.min(hV, wV) / h);
  return r / Math.sin(half) * 1.04;
}

// ── framing: the overlays that cover the view ─────────────────────────────
const occ = { l: 0, r: 0, t: 0, b: 0 };
let saverBand = null;
const OVERLAYS = ['panel', 'dock', 'card', 'ladder'].map($).filter(Boolean);
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (!document.documentElement.classList.contains('sn-saver')) for (const el of OVERLAYS) {
    if (el.hidden) continue;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
    else { if (fh < 0.45) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
  }
  if (saverBand) { const bd = saverBand(h); if (bd) { o.t = Math.max(o.t, bd.t); o.b = Math.max(o.b, bd.b); } }
  return o;
}
let lastW = 0, lastH = 0;
const size = () => ({ w: lastW, h: lastH });
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w === lastW && h === lastH) return;
  lastW = w; lastH = h;
  V.resize(w, h);
}

// ── the frame loop ────────────────────────────────────────────────────────
let last = performance.now(), running = true;
const hooks = [];
const _v = new THREE.Vector3();
function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (document.hidden) return;
  resize();
  const { w, h } = size(), o = occlusion(w, h);
  for (const k in occ) occ[k] += (o[k] - occ[k]) * 0.2;
  V.camera.setViewOffset(w, h, -(occ.l - occ.r) / 2, -(occ.t - occ.b) / 2, w, h);
  A.time += dt;
  for (const f of hooks) f(dt);

  // leaving particles: fade and fly out, then free their GPU objects
  for (let i = leaving.length - 1; i >= 0; i--) {
    const L = leaving[i]; L.t += dt;
    const s = Math.min(1, L.t / 0.55);
    for (const p of L.B.parts) { p.uniforms.uFade.value = 1 - s; p.uniforms.uExplode.value += dt * L.B.r * 1.6; }
    if (L.B.membrane) L.B.membrane.mesh.scale.setScalar(Math.max(0.001, 1 - s));
    if (L.B.stalks) L.B.stalks.mesh.visible = false;
    if (L.B.axesObj) L.B.axesObj.group.visible = false;
    if (s >= 1) { L.B.dispose(); leaving.splice(i, 1); }
  }

  if (cur) {
    if (A.asm < 1) A.asm = Math.min(1, A.asm + dt / A.asmDur);
    const k = 1 - Math.exp(-dt * 4);
    A.explode += (A.explodeT - A.explode) * k;
    A.peel += (A.peelT - A.peel) * (1 - Math.exp(-dt * 2.2));
    A.slice += (A.sliceT - A.slice) * (1 - Math.exp(-dt * 2.2));
    const breath = G.breathe && !REDUCED ? 0.012 * Math.sin(A.time * 0.9) : 0;
    const R = cur.r;
    for (const p of cur.parts) {
      const u = p.uniforms;
      u.uAsm.value = A.asm; u.uTime.value = A.time; u.uBreath.value = breath;
      u.uExplode.value = A.explode * R * (cur.entry.look === 'fibril' ? 0.9 : cur.entry.look === 'rod' ? 0.15 : 0.45);
      u.uPeelOn.value = A.peel > 0.002 ? 1 : 0; u.uPeelN.value.copy(A.peelN);
      // the plane sweeps from in front of the particle to just behind its centre
      u.uPeelD.value = R * (1 - 1.15 * A.peel); u.uPeelW.value = R * 0.35;
      u.uSliceOn.value = A.slice > 0.002 ? 1 : 0; u.uSliceN.value.copy(A.sliceN);
      u.uSliceD.value = R * 1.05 * (1 - A.slice) + (cur.entry.look === 'rod' ? -R * 0.0 : 0);
      u.uSway.value = cur.entry.look === 'virion' && G.sway && !REDUCED ? 0.09 : 0;
      u.uHiK.value = A.hiK; u.uRadialR.value = R;
    }
    if (cur.membrane) {
      const e = easeInOut(Math.min(1, A.asm * 1.6));
      cur.membrane.mesh.scale.setScalar(Math.max(0.001, e * (1 + breath)));
      cur.membrane.mat.uniforms.uTime.value = A.time;
      cur.membrane.mesh.visible = A.slice < 0.02 && A.peel < 0.02;
    }
    if (cur.stalks) cur.stalks.mesh.visible = A.asm > 0.3;
    controls.autoRotate = G.orbit && !REDUCED && !fly && performance.now() - userAt > 5000;
  }
  if (G.mode === 'ladder') ladderCamera(dt);
  else if (!A.camLock) { stepFly(dt); if (!fly) controls.update(); }
  const dist = V.camera.position.distanceTo(controls.target);
  const rr = G.mode === 'ladder' ? (A.ladderW || 100) : cur ? cur.r : 50;
  V.frameScale(dist, rr);
  V.render();
  updateRuler(dist);
}

// ── UI ────────────────────────────────────────────────────────────────────
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}
function setLoading(f) {
  const el = $('loading');
  if (f == null) { el.hidden = true; return; }
  el.hidden = false; el.style.setProperty('--f', String(Math.max(0.02, Math.min(1, f))));
}
function updateRuler(dist) {
  const el = $('ruler');
  if (G.mode === 'ladder' || !lastH) { el.hidden = true; return; }
  el.hidden = false;
  const nmPerPx = 2 * dist * Math.tan(V.camera.fov * Math.PI / 360) / lastH;
  const r = niceRuler(nmPerPx, PHONE_Q.matches ? 90 : 130);
  el.querySelector('i').style.width = r.px.toFixed(1) + 'px';
  el.querySelector('span').textContent = r.label;
}

async function typesetInto(el, tex) {
  try { const M = await import('../../lib/sci-math.js'); await M.typeset(el, tex, { display: false }); }
  catch (e) { el.textContent = tex; }
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function credLine(id) {
  const c = CREDIT[id];
  return `<div class="cred"><a href="https://www.rcsb.org/structure/${id}" target="_blank" rel="noopener">PDB ${id}</a> · ${esc(c[0])}. ${esc(c[1])} (${c[2]}). <a href="https://doi.org/${esc(c[3])}" target="_blank" rel="noopener">doi:${esc(c[3])}</a></div>`;
}
function measured(e, B) {
  if (e.look === 'rod') return `${(B.size).toFixed(0)} × ${(Math.max(B.bounds.size[0], B.bounds.size[2])).toFixed(1)} nm`;
  if (e.look === 'capsid') return `${(2 * B.r).toFixed(1)} nm across`;
  if (e.look === 'virion') return `${(2 * e.membrane.r).toFixed(0)} nm membrane, ${(2 * B.r).toFixed(0)} nm with spikes`;
  if (e.look === 'fibril') return `${B.size.toFixed(0)} nm long as drawn (${e.layers} layers), ${Math.max(B.bounds.size[0], B.bounds.size[2]).toFixed(1)} nm wide`;
  return `${B.size.toFixed(1)} nm (largest extent)`;
}
function fillCard(e, B) {
  const card = $('card');
  const ids = pdbsOf(e);
  const d0 = B.parts[0].d, copies = B.parts.reduce((a, p) => a + p.m, 0);
  const chains = B.parts.reduce((a, p) => a + p.m * p.d.info.chains.filter(c => p.d.info.entities[c[2]].role !== 'glycan').length, 0);
  const beads = B.parts.reduce((a, p) => a + p.m * p.d.n, 0);
  const shown = B.parts.reduce((a, p) => a + p.instances, 0);
  const lod = B.parts.some(p => p.stride > 1) ? ` · ${shown.toLocaleString()} drawn (every ${B.parts[0].stride}th)` : '';
  card.innerHTML = `
    <div class="grp">${esc(GROUPS.find(g => g.id === e.group).label)}${e.illus ? ' <b class="illus">contains illustration</b>' : ''}</div>
    <h2>${esc(e.name)}</h2>
    <dl>
      <dt>Disease</dt><dd>${esc(e.disease)}</dd>
      <dt>Host</dt><dd>${esc(e.host)}</dd>
      <dt>Size</dt><dd>${esc(e.size)} <small>· model: ${esc(measured(e, B))}</small></dd>
      <dt>Symmetry</dt><dd>${esc(e.sym)}</dd>
      ${e.T ? `<dt>Lattice</dt><dd><span class="tex" id="cardTex"></span></dd>` : ''}
      ${e.look === 'rod' || e.look === 'fibril' ? `<dt>Screw</dt><dd>${(Math.abs(d0.info.helix.twist) * 180 / Math.PI).toFixed(2)}° and ${Math.abs(d0.info.helix.rise).toFixed(2)} Å per ${e.look === 'rod' ? 'subunit' : 'layer'}</dd>` : ''}
      <dt>Model</dt><dd>${chains.toLocaleString()} chains · ${beads.toLocaleString()} residues${lod}${copies > 1 ? ` · ${copies.toLocaleString()} copies` : ''}</dd>
    </dl>
    <p class="blurb">${esc(e.blurb)}</p>
    <p class="note">${esc(e.note || '')}</p>
    ${ids.map(credLine).join('')}`;
  card.hidden = false;
  if (e.T) typesetInto($('cardTex'), `T = h^2 + hk + k^2 = ${e.T.h}^2 + ${e.T.h}\\cdot${e.T.k} + ${e.T.k}^2 = ${e.T.T}${e.T.hand ? '\\,' + e.T.hand : ''}${e.T.pseudo ? '\\ (\\text{pseudo})' : ''}`);
}
function fillLadderCard() {
  const card = $('card');
  card.innerHTML = `<div class="grp">Scale ladder</div><h2>From one protein to a 300 nm rod</h2>
    <p class="blurb">Eleven structures side by side at true scale, from the folded prion protein (about 4 nm) to the tobacco mosaic virus rod (300 nm). A red blood cell, 7.5 µm across, would be 25 times wider than the rod; an E. coli bacterium about 2 µm long.</p>
    <p class="note">Drag the slider, or press play. Larger particles draw every 2nd to 6th residue here, to keep the GPU load small.</p>`;
  card.hidden = false;
}
function buildLadderBar() {
  const bar = $('ladderBar');
  const ticks = [0.1, 1, 10, 100, 1000, 10000].map(nm => `<i class="tick" style="left:${(ladderX(nm) * 100).toFixed(2)}%"><b>${nm >= 1000 ? nm / 1000 + ' µm' : nm + ' nm'}</b></i>`).join('');
  const marks = LADDER_MARKS.map(m => `<i class="mark" style="left:${(ladderX(m.nm) * 100).toFixed(2)}%" title="${esc(m.label)}"><span>${esc(m.label)}</span></i>`).join('');
  const items = (ladderLayout || []).map(it => `<i class="item" style="left:${(ladderX(it.size) * 100).toFixed(2)}%"></i>`).join('');
  bar.innerHTML = `<div class="track">${ticks}${marks}${items}<i id="ladderCur" class="cur"></i></div>`;
  const lab = $('ladderLabels');
  lab.replaceChildren(...(ladderLayout || []).map(it => {
    const s = document.createElement('div'); s.className = 'll';
    s.textContent = entryByKey(it.key).name; s.dataset.key = it.key; return s;
  }));
}
function updateLadderBar(width) {
  const c = $('ladderCur'); if (!c) return;
  c.style.left = (ladderX(width) * 100).toFixed(2) + '%';
  $('ladderRead').textContent = 'View width ' + (width >= 1000 ? (width / 1000).toFixed(2) + ' µm' : width >= 10 ? width.toFixed(0) + ' nm' : width.toFixed(1) + ' nm');
}
function placeLadderLabels() {
  const els = $('ladderLabels').children;
  for (let i = 0; i < els.length; i++) {
    const it = ladderLayout[i];
    _v.set(it.x, -it.size / 2 - Math.max(1.5, it.size * 0.08), 0).project(V.camera);
    const x = (_v.x * 0.5 + 0.5) * lastW, y = (-_v.y * 0.5 + 0.5) * lastH;
    const vis = _v.z < 1 && x > -200 && x < lastW + 200 && it.size * LADDER_FIT > (A.ladderW || 1) * 0.03;
    els[i].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;
    els[i].style.opacity = vis ? '1' : '0';
  }
}
function syncLadderPlay() { $('ladderPlay').textContent = A.ladderPlay ? 'Pause' : 'Play'; }

function buildUI() {
  const list = $('entries');
  for (const g of GROUPS) {
    const h = document.createElement('div'); h.className = 'grp'; h.textContent = g.label; list.appendChild(h);
    const row = document.createElement('div'); row.className = 'chips';
    for (const e of ENTRIES.filter(x => x.group === g.id)) {
      const b = document.createElement('button'); b.dataset.key = e.key; b.textContent = e.name;
      b.onclick = () => { show(e.key); closeSheetOnPhone(); };
      row.appendChild(b);
    }
    list.appendChild(row);
  }
  $('ladderBtn').onclick = () => { enterLadder(); closeSheetOnPhone(); };
  $('credits').innerHTML = Object.keys(CREDIT).map(credLine).join('') +
    '<p>Structures: wwPDB / RCSB Protein Data Bank (rcsb.org), CC0 1.0. Each entry is credited to its authors above. ' +
    'The bead files keep one atom per residue and the symmetry of each entry; the virion membranes, stalks, spike layouts and the build animations are illustrations made by this page. ' +
    '3D: three.js r160 (MIT licence). Code and illustrations of this page are original.</p>';
  $('asmBtn').onclick = () => replay();
  $('explodeBtn').onclick = () => toggleExplode();
  $('peelBtn').onclick = () => togglePeel();
  $('sliceBtn').onclick = () => toggleSlice();
  const tog = (id, k, after) => { const b = $(id); b.classList.toggle('on', !!G[k]); b.setAttribute('aria-pressed', String(!!G[k])); b.onclick = () => { G[k] = !G[k]; b.classList.toggle('on', !!G[k]); b.setAttribute('aria-pressed', String(!!G[k])); after && after(); }; };
  tog('orbitBtn', 'orbit'); tog('breatheBtn', 'breathe'); tog('swayBtn', 'sway');
  tog('axesBtn', 'axes', () => cur && applyLook(cur));
  tog('abBtn', 'hideAb', () => cur && applyLook(cur));
  tog('glyBtn', 'hideGly', () => cur && applyLook(cur));
  $('colorSel').onchange = ev => { G.color = ev.target.value; cur && applyLook(cur); };
  $('bead').oninput = ev => { G.bead = +ev.target.value; $('beadV').textContent = G.bead.toFixed(2) + '×'; cur && applyLook(cur); };
  $('beadV').textContent = G.bead.toFixed(2) + '×';
  $('ladderPlay').onclick = () => { if (A.ladderU >= 1) A.ladderU = 0; A.ladderPlay = !A.ladderPlay; syncLadderPlay(); };
  $('ladderScrub').oninput = ev => { A.ladderU = +ev.target.value / 1000; A.ladderPlay = false; syncLadderPlay(); };
  $('ladderClose').onclick = () => show(G.key);
  // dock
  $('dockPrev').onclick = () => step(-1);
  $('dockName').onclick = () => step(1);
  $('dockAsm').onclick = () => replay();
  $('dockExplode').onclick = () => toggleExplode();
  $('dockPanel').onclick = () => toggleSheet();
  $('gear').onclick = () => { $('panel').classList.add('open'); document.body.classList.remove('panel-closed'); };
  $('panelClose').onclick = () => { $('panel').classList.remove('open'); document.body.classList.add('panel-closed'); };
  $('cardToggle').onclick = () => document.body.classList.toggle('card-min');
  sheetDrag();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', ev => {
    if (ev.target.closest && ev.target.closest('input, select, textarea')) return;
    if (ev.key === 'ArrowRight') step(1); else if (ev.key === 'ArrowLeft') step(-1);
    else if (ev.key === 'e') toggleExplode(); else if (ev.key === 'p') togglePeel(); else if (ev.key === 's') toggleSlice();
    else if (ev.key === 'a') replay();
  });
}
function step(d) {
  const i = Math.max(0, ENTRIES.findIndex(e => e.key === G.key));
  show(ENTRIES[(i + d + ENTRIES.length) % ENTRIES.length].key);
}
function replay() { if (G.mode === 'ladder') { A.ladderU = 0; A.ladderPlay = true; syncLadderPlay(); return; } startAssembly(0); A.explodeT = 0; A.peelT = 0; A.sliceT = 0; syncAnimButtons(); }
function camDir() { return V.camera.position.clone().sub(controls.target).normalize(); }
function toggleExplode() { A.explodeT = A.explodeT > 0 ? 0 : 1; syncAnimButtons(); }
function togglePeel() { if (A.peelT > 0) A.peelT = 0; else { A.peelN.copy(camDir()); A.peelT = 1; A.sliceT = 0; } syncAnimButtons(); }
function toggleSlice() { if (A.sliceT > 0) A.sliceT = 0; else { A.sliceN.copy(camDir()); A.sliceT = 1; A.peelT = 0; } syncAnimButtons(); }
function syncAnimButtons() {
  for (const [id, on] of [['explodeBtn', A.explodeT > 0], ['peelBtn', A.peelT > 0], ['sliceBtn', A.sliceT > 0], ['dockExplode', A.explodeT > 0]]) {
    const b = $(id); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
}
function syncEntryUI() {
  document.querySelectorAll('#entries button').forEach(b => b.classList.toggle('on', G.mode === 'entry' && b.dataset.key === G.key));
  $('ladderBtn').classList.toggle('on', G.mode === 'ladder');
  const e = entryByKey(G.key);
  $('dockTitle').textContent = G.mode === 'ladder' ? 'Scale ladder' : e ? e.name : '';
  $('heroName').textContent = G.mode === 'ladder' ? 'Scale ladder' : e ? e.name : '';
  $('heroSub').textContent = G.mode === 'ladder' ? 'True relative sizes, 4 nm to 300 nm' : e ? e.disease : '';
}

// tap: highlight one copy (protomer) of the particle
let downAt = null;
function onDown(ev) { downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }; }
function onUp(ev) {
  if (!downAt || !cur || G.mode !== 'entry') return;
  const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y), dtp = performance.now() - downAt.t;
  downAt = null;
  if (moved > 6 || dtp > 400) return;
  const p = cur.parts[0];
  if (p.m < 2) { A.hiK = -1; return; }
  // nearest unit centroid on screen, front half only
  let best = -1, bd = 26 * 26;
  const cd = camDir();
  for (let u = 0; u < p.cent.length / 3; u++) {
    _v.set(p.cent[3 * u], p.cent[3 * u + 1], p.cent[3 * u + 2]);
    if (cur.kind === 'icosa' && _v.dot(cd) < 0) continue;
    _v.project(V.camera);
    const x = (_v.x * 0.5 + 0.5) * lastW, y = (-_v.y * 0.5 + 0.5) * lastH;
    const dd = (x - ev.clientX) ** 2 + (y - ev.clientY) ** 2;
    if (dd < bd) { bd = dd; best = Math.floor(u / p.nc); }
  }
  A.hiK = best === A.hiK ? -1 : best;
  if (A.hiK >= 0) toast(`Copy ${A.hiK + 1} of ${p.m}${cur.kind === 'icosa' ? ': one asymmetric unit (' + p.d.info.chains.filter(c => p.d.info.entities[c[2]].role !== 'glycan').length + ' chains)' : ''}`);
}

// phone sheet
function closeSheetOnPhone() { if (PHONE_Q.matches) { $('panel').classList.remove('open', 'full'); $('dockPanel').setAttribute('aria-expanded', 'false'); } }
function toggleSheet() {
  const p = $('panel'), open = !p.classList.contains('open');
  p.classList.toggle('open', open); if (!open) p.classList.remove('full');
  $('dockPanel').setAttribute('aria-expanded', String(open));
}
function sheetDrag() {
  const grip = $('sheetGrip'), p = $('panel');
  let y0 = null;
  grip.addEventListener('pointerdown', ev => { y0 = ev.clientY; grip.setPointerCapture(ev.pointerId); });
  grip.addEventListener('pointerup', ev => {
    if (y0 == null) return;
    const dy = ev.clientY - y0; y0 = null;
    if (dy < -30) p.classList.add('full');
    else if (dy > 30) { if (p.classList.contains('full')) p.classList.remove('full'); else { p.classList.remove('open'); $('dockPanel').setAttribute('aria-expanded', 'false'); } }
    else p.classList.toggle('full');
  });
}

// URL hash: #<entry key> or #ladder
function writeHash() {
  const h = G.mode === 'ladder' ? '#ladder' : '#' + G.key;
  if (location.hash !== h) history.replaceState(null, '', h);
}
function readHash() {
  const k = decodeURIComponent(location.hash.slice(1));
  if (k === 'ladder') return 'ladder';
  return entryByKey(k) ? k : null;
}

// ── the api for saver.js ──────────────────────────────────────────────────
const app = {
  G, A, V, controls, show, enterLadder, startAssembly, flyTo, fitDistance, occ, size, defaultDir,
  get cur() { return cur; },
  setBand(f) { saverBand = f; },
  addHook(f) { hooks.push(f); }, removeHook(f) { const i = hooks.indexOf(f); if (i >= 0) hooks.splice(i, 1); },
  setPeel(on, n) { if (n) A.peelN.copy(n); A.peelT = on ? 1 : 0; syncAnimButtons(); },
  setSlice(on, n) { if (n) A.sliceN.copy(n); A.sliceT = on ? 1 : 0; syncAnimButtons(); },
  setExplode(on) { A.explodeT = on ? 1 : 0; syncAnimButtons(); },
  applyLook: () => cur && applyLook(cur),
};
window.__va = app;

// ── boot ──────────────────────────────────────────────────────────────────
buildUI();
if (PHONE_Q.matches) { $('panel').classList.remove('open'); document.body.classList.add('card-min'); }
resize();
installSaver(app);
const first = readHash();
if (first === 'ladder') enterLadder({ u: 0 });
else show(first || 'polio', { dir: new THREE.Vector3(0.35, 0.3, 1).normalize() });
V.camera.position.set(0, 0, 400);
requestAnimationFrame(frame);
window.addEventListener('hashchange', () => { const k = readHash(); if (k === 'ladder') { if (G.mode !== 'ladder') enterLadder(); } else if (k && (k !== G.key || G.mode !== 'entry')) show(k); });
// free the GPU when the page goes away (the shell also releases it)
window.addEventListener('pagehide', () => {
  running = false;
  if (cur) cur.dispose();
  lineup.forEach(b => b.dispose());
  leaving.forEach(L => L.B.dispose());
  controls.dispose();
  V.dispose();
});
