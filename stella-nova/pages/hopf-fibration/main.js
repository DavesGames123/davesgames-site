// ============================================================================
//  HOPF FIBRATION  ·  main.js — state, controls, picking, framing, the loop
// ----------------------------------------------------------------------------
//  STATE  G holds what the user set. G.items are the things on the base
//  sphere (points, latitudes, great circles, painted curves, clouds; see
//  sampleItems in hopf.js). rebuild() turns the items into fibres (one base
//  point each, coloured by baseColor) and writes them to the instanced
//  mesh. A rebuild costs one pass over at most a few thousand fibres, so a
//  drag on the base sphere or a latitude sweep can rebuild each frame.
//
//  ROTATION  Each frame, a (the angle) grows by G.speed while playing.
//  M = rotationFor(G.mode, a, tilt) is the 4D rotation; the projection
//  point turns M by planeMat(x3, x4, pole). The product goes to the shader
//  as uRot (scene.setRotation). For the modes that keep fibres, the base
//  sphere shows rings at the images p(M q) of the base points.
//
//  LINKING  Two selected fibres (a tap on a tube picks one; the 'linked'
//  preset picks two) get a disc each: the flat disc that the projected
//  circle bounds. The other fibre crosses that disc at one point, which
//  shows as a bright dot. The readout gives the Gauss linking integral of
//  the two projected circles (linkingNumber in hopf.js).
//
//  FRAMING  occlusion() measures the panel, the dock and the top bar, and
//  camera.setViewOffset centres the origin in the clear part (the
//  wave-membrane pattern). The saver adds the clear band of the shell plate.
//
//  GREP MAP
//    grep -n 'function rebuild'        items -> fibres -> instance attributes
//    grep -n 'function applyPreset'    the presets
//    grep -n 'function onBasePointer'  tools on the base sphere
//    grep -n 'function pickFibre'      tap a tube in 3D
//    grep -n 'function updateLink'     discs, pierce points, Gauss integral
//    grep -n 'function occlusion'      the overlay margins for the framing
//    grep -n 'function fitDistance'    camera distance for the clear part
//    grep -n 'function frame'          the frame loop
//    grep -n 'function buildUI'        the controls
//    grep -n 'const app'               the api that saver.js drives
// ============================================================================
import * as H from './hopf.js';
import { createScene } from './scene.js';
import { createBaseSphere, createGauge } from './insets.js';
import { typesetPage, typesetRotation, typesetLive } from './equations.js';
import { installSaver } from './saver.js';

const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = window.matchMedia('(pointer:coarse)').matches;
const $ = id => document.getElementById(id);

const G = {
  preset: 'nested', items: [], density: COARSE ? 16 : 24,
  mode: 'along', speed: 0.25, tilt: 0, playing: true, a: 0,
  sweep: false, sweepPhase: 0, orbit: true, stripes: true, discs: true,
  rad: COARSE ? 0.04 : 0.032, conf: false, pole: 0, tool: 'point', seed: 1,
  sel: [], trace: null, thin: false, custom: false,
  pq: [1, 1],             // weights of the circle action; [1, 1] is the Hopf fibration
};
const isHopf = () => G.pq[0] === 1 && G.pq[1] === 1;
// The projected curve of the fibre over b at the weights in G.pq.
const curveOf = (b, M, n) => H.fibreCurve(b, M, n, G.pq);

// ------------------------------------------------------------------ scene
const canvas = $('view');
const S = createScene(canvas, { coarse: COARSE });
const base = createBaseSphere($('base'), { onPointer: onBasePointer, onTurn: () => { baseDirty = true; } });
const gauge = createGauge($('gauge'));
let fibres = [];          // [{ b, rgb, hex, item }]
let baseDirty = true, linkDirty = true, liveKey = '';

// ------------------------------------------------------------------ fibres
const toHex = rgb => H.hexOf(rgb);
// items -> fibres -> the instanced mesh. Trace fibres come last.
function rebuild() {
  const cap = S.CAP;
  const list = H.sampleItems(G.items, G.density, cap).map(f => {
    const rgb = H.baseColor(f.b);
    return { b: f.b, rgb, hex: toHex(rgb), item: f.item };
  });
  if (G.trace) {
    const T = G.trace;
    T.trail.forEach((b, i) => {
      const age = (T.trail.length - i) / T.trail.length, rgb = H.baseColor(b);
      list.push({ b, rgb: rgb.map(v => v * (0.25 + 0.65 * (1 - age))), hex: toHex(rgb), item: -1, rad: 0.5 + 0.4 * (1 - age), trail: true });
    });
    const rgb = H.baseColor(T.b);
    list.push({ b: T.b, rgb, hex: toHex(rgb), item: -2, rad: 1.9, glow: 0.35, head: true });
  }
  fibres = list.slice(0, cap);
  G.sel = G.sel.filter(i => i < fibres.length);
  const thin = G.thin ? 0.45 : 1;
  // G.focus (saver) dims every fibre that is not selected
  const dim = G.focus && G.sel.length;
  S.setFibres(fibres.map((f, i) => ({
    b: f.b, rgb: dim && !G.sel.includes(i) ? f.rgb.map(v => v * 0.28) : f.rgb,
    rad: (f.rad || 1) * thin * (G.sel.includes(i) ? (dim ? 2.4 : 1.7) : dim ? 0.7 : 1),
    glow: (f.glow || 0) + (G.sel.includes(i) ? 0.45 : 0),
    stripe: G.stripes ? (G.thin ? 0.5 : 1) : 0,
  })));
  $('roCount').textContent = String(fibres.length);
  baseDirty = true; linkDirty = true;
}

// ----------------------------------------------------------------- presets
function applyPreset(id, o = {}) {
  const P = H.PRESETS.find(p => p.id === id) || H.PRESETS[0];
  if (o.seed) G.seed = o.seed;
  if (o.density) G.density = o.density;
  const made = P.make(G.density, H.makeRng(G.seed));
  G.preset = P.id; G.custom = false;
  G.items = made.items.map(it => Object.assign({}, it, it.kind === 'lat' ? { beta0: Math.asin(it.z) } : {}));
  G.thin = !!made.thin;
  G.pq = made.pq ? made.pq.slice() : [1, 1];
  G.trace = made.trace ? { u: 0, b: H.loxodrome(0), trail: [], acc: 0 } : null;
  G.sel = made.discs ? [0, 1] : [];
  G.sweepPhase = 0;
  rebuild();
  syncPresetUI();
}
function syncPresetUI() {
  const P = H.PRESETS.find(p => p.id === G.preset);
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', !G.custom && b.dataset.id === G.preset));
  $('presetBlurb').textContent = G.custom ? 'Your own set of fibres. Each fibre has the colour of its point on the small sphere.' : P.blurb;
  $('dockTitle').textContent = G.custom ? 'Your own set' : P.name;
}
function markCustom() { if (!G.custom) { G.custom = true; G.trace = null; syncPresetUI(); } }

// ------------------------------------------------------------ base sphere
// Tools: point (add or drag), lat (add a latitude, drag its height),
// paint (a curve). 'turn' is handled in insets.js.
let edit = null;
function onBasePointer(type, b, info) {
  if (type === 'down') {
    markCustom();
    if (G.tool === 'point') {
      // grab an existing point near the pointer
      let hit = -1, best = 16 * (info.dpr || 1);
      G.items.forEach((it, k) => {
        if (it.kind !== 'point') return;
        const p = base.toScreen(it.b); if (p.z < 0) return;
        const d = Math.hypot(p.x - info.px, p.y - info.py); if (d < best) { best = d; hit = k; }
      });
      if (hit < 0) { G.items.push({ kind: 'point', b }); hit = G.items.length - 1; }
      else G.items[hit].b = b;
      edit = { k: hit };
    } else if (G.tool === 'lat') {
      // beta0 holds the height without the sweep phase, as in the 'move' case
      G.items.push({ kind: 'lat', z: b[2], beta0: Math.asin(Math.max(-1, Math.min(1, b[2]))) - G.sweepPhase });
      edit = { k: G.items.length - 1 };
    } else if (G.tool === 'paint') {
      G.items.push({ kind: 'curve', pts: [b] });
      edit = { k: G.items.length - 1 };
    }
    G.sel = [];
    rebuild();
    return;
  }
  if (type === 'move' && edit && b) {
    const it = G.items[edit.k];
    if (!it) return;
    if (it.kind === 'point') it.b = b;
    else if (it.kind === 'lat') { it.z = b[2]; it.beta0 = Math.asin(Math.max(-1, Math.min(1, b[2]))) - G.sweepPhase; }
    else if (it.kind === 'curve') {
      const last = it.pts[it.pts.length - 1];
      if (Math.acos(Math.max(-1, Math.min(1, last[0] * b[0] + last[1] * b[1] + last[2] * b[2]))) > 0.035) it.pts.push(b);
      else return;
    }
    rebuild();
    return;
  }
  if (type === 'up') edit = null;
}
function setTool(t) {
  G.tool = t; base.setTool(t);
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
}
// What the base sphere shows: item curves, fibre dots, image rings.
function baseState(M) {
  const curves = [];
  G.items.forEach(it => {
    if (it.kind === 'lat') {
      const r = Math.sqrt(Math.max(0, 1 - it.z * it.z)), span = it.span || H.TAU, ph0 = it.ph0 || 0;
      const pts = Array.from({ length: 73 }, (_, i) => { const ph = ph0 + span * i / 72; return [r * Math.cos(ph), r * Math.sin(ph), it.z]; });
      curves.push({ pts, hex: H.hexOf(H.baseColor([r, 0, it.z]).map(v => v * 0.9)), closed: false });
    } else if (it.kind === 'great') {
      const pts = H.sampleItems([Object.assign({}, it, { n: 96 })], 96).map(f => f.b);
      curves.push({ pts, hex: '#c9d3e6', closed: true });
    } else if (it.kind === 'loop') {
      curves.push({ pts: Array.from({ length: 160 }, (_, i) => H.loopPoint(it, i / 160)), hex: '#c9d3e6', closed: true });
    } else if (it.kind === 'curve' && it.pts.length > 1) curves.push({ pts: it.pts, hex: '#c9d3e6', closed: false });
  });
  if (G.trace) curves.push({ pts: Array.from({ length: 200 }, (_, i) => H.loxodrome(G.trace.u - 0.5 + i / 200)), hex: 'rgba(200,210,230,0.5)', closed: false });
  const many = fibres.length > 400, step = many ? Math.ceil(fibres.length / 400) : 1;
  const dots = [];
  for (let i = 0; i < fibres.length; i += step) dots.push({ b: fibres[i].b, hex: fibres[i].hex, sel: G.sel.includes(i) });
  G.sel.forEach(i => { if (fibres[i] && i % step) dots.push({ b: fibres[i].b, hex: fibres[i].hex, sel: true }); });
  const images = [];
  if (isHopf() && H.MODES[G.mode].keepsFibres && G.mode !== 'still' && G.mode !== 'along' && fibres.length <= 120) {
    for (const f of fibres) images.push({ b: H.hopf(H.matVec(M, H.fibrePoint(f.b, 0))), hex: f.hex });
  }
  return { curves, dots, images };
}

// ---------------------------------------------------------------- picking
// The fibre whose projected tube passes nearest the tap, within 18 px.
const _v = new S.THREE.Vector3();
function pickFibre(cx, cy, Mfull) {
  const rc = canvas.getBoundingClientRect(), n = 72;
  let best = 18, hit = -1;
  const step = fibres.length > 900 ? Math.ceil(fibres.length / 900) : 1;
  for (let i = 0; i < fibres.length; i += step) {
    if (fibres[i].trail) continue;
    const C = curveOf(fibres[i].b, Mfull, n);
    for (let k = 0; k < n; k++) {
      const x = C[k * 3], y = C[k * 3 + 1], z = C[k * 3 + 2];
      if (x * x + y * y + z * z > 900) continue;
      _v.set(x, y, z).project(S.camera);
      if (_v.z > 1) continue;
      const sx = rc.left + (_v.x + 1) / 2 * rc.width, sy = rc.top + (1 - _v.y) / 2 * rc.height;
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < best) { best = d; hit = i; }
    }
  }
  return hit;
}

// ---------------------------------------------------------------- linking
let linkFrame = 0, lastLk = null;
function updateLink(Mfull) {
  const pair = G.sel.length === 2 && fibres[G.sel[0]] && fibres[G.sel[1]];
  $('roLinkRow').hidden = !pair;
  if (!pair) { S.setDisc(0, null); S.setDisc(1, null); S.setDot(0, null); S.setDot(1, null); return; }
  const n = isHopf() ? 240 : 720, A = curveOf(fibres[G.sel[0]].b, Mfull, n), B = curveOf(fibres[G.sel[1]].b, Mfull, n);
  const curves = [A, B], fs = [fibres[G.sel[0]], fibres[G.sel[1]]];
  for (let k = 0; k < 2; k++) {
    const C = curves[k], P = i => [C[i * 3], C[i * 3 + 1], C[i * 3 + 2]];
    const circ = H.circleFrom3(P(0), P(n / 3), P(2 * n / 3));
    // a weighted orbit is a knot, not a circle: no disc
    const ok = G.discs && isHopf() && circ && circ.radius < 40 && Math.hypot(...circ.centre) < 40;
    S.setDisc(k, ok ? Object.assign(circ, { rgb: fs[k].rgb }) : null);
    const hits = ok ? H.pierce(circ, curves[1 - k]) : [];
    S.setDot(k, hits[0] || null, fs[1 - k].rgb, G.rad * 2.6);
  }
  if (linkDirty || ++linkFrame % 12 === 0) {
    linkDirty = false;
    const big = Math.max(...A.map(Math.abs), ...B.map(Math.abs));
    lastLk = big < 300 ? H.linkingNumber(A, B) : null;
    $('roLink').textContent = lastLk == null ? 'through infinity' : (lastLk >= 0 ? '+' : '−') + Math.abs(lastLk).toFixed(3);
  }
}

// ---------------------------------------------------------------- framing
const OVERLAYS = ['panel', 'dock'].map($).concat([document.querySelector('.topbar')]).filter(Boolean);
const occ = { l: 0, r: 0, t: 0, b: 0 };
let saverBand = null;     // set by saver.js: () => { t, b } or null
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  for (const el of OVERLAYS) {
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
    else { if (fh < 0.5) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
  }
  if (saverBand) { const bd = saverBand(h); if (bd) { o.t = Math.max(o.t, bd.t); o.b = Math.max(o.b, bd.b); } }
  return o;
}
// The camera distance that fits a ball of radius r in the clear part.
function fitDistance(r, w, h) {
  const wV = Math.max(80, w - occ.l - occ.r), hV = Math.max(80, h - occ.t - occ.b);
  const fov = S.camera.fov * Math.PI / 180, half = Math.atan(Math.tan(fov / 2) * Math.min(hV, wV) / h);
  return r / Math.sin(half);
}
function setDistance(d) {
  const c = S.camera, t = S.controls.target;
  _v.copy(c.position).sub(t).setLength(d); c.position.copy(t).add(_v);
}
let lastW = 0, lastH = 0;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w === lastW && h === lastH) return;
  lastW = w; lastH = h;
  S.resize(w, h);
}

// ------------------------------------------------------------------- loop
let last = performance.now(), frameNo = 0, Mcur = H.ident(), MfullCur = H.ident();
const hooks = [];        // per-frame hooks (saver.js)
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (document.hidden) return;
  resize();
  const w = lastW, h = lastH, o = occlusion(w, h);
  for (const k in occ) occ[k] += (o[k] - occ[k]) * 0.2;
  S.setOffset((occ.l - occ.r) / -2, (occ.t - occ.b) / -2);
  // the saver fades the tubes outside the clear band of its plate
  S.setBand(saverBand ? { t: occ.t, b: occ.b } : null);
  for (const f of hooks) f(dt, now);

  if (G.playing && G.mode !== 'still') G.a += dt * G.speed;
  let need = false;
  if (G.sweep && G.items.some(it => it.kind === 'lat')) {
    G.sweepPhase += dt * (G.sweepRate || 0.35);
    G.items.forEach(it => { if (it.kind === 'lat') it.z = Math.sin(it.beta0 + G.sweepPhase); });
    need = true;
  }
  if (G.trace) {
    const T = G.trace; T.u += dt * 0.035; T.b = H.loxodrome(T.u); T.acc += dt;
    if (T.acc > 0.2) { T.acc = 0; T.trail.push(T.b); if (T.trail.length > (COARSE ? 18 : 30)) T.trail.shift(); }
    need = true;
  }
  if (need) rebuild();

  const M = H.rotationFor(G.mode, G.a, { tilt: G.tilt });
  const Mfull = H.matMul(H.planeMat(2, 3, G.pole), M);
  Mcur = M; MfullCur = Mfull;
  S.setRotation(Mfull);
  S.uniforms.uPQ.value.set(G.pq[0], G.pq[1], G.pq[0], G.pq[1]);
  S.uniforms.uRad.value = G.rad;
  S.uniforms.uConf.value = G.conf ? 1 : 0;
  S.controls.autoRotate = G.orbit;
  S.controls.autoRotateSpeed = 0.35;
  S.controls.update();
  // the fog keeps the same strength at the subject, at any zoom
  S.scene.fog.density = 0.3 * (G.fogK || 1) / Math.max(1, S.camera.position.distanceTo(S.controls.target));
  updateLink(Mfull);
  S.render();

  // insets at about 30 fps
  if (++frameNo % 2 === 0 || baseDirty) {
    if (!document.body.classList.contains('no-sphere')) base.draw(baseState(M));
    baseDirty = false;
    const showGauge = G.mode !== 'still' && !PHONE_Q.matches;
    $('gaugeFig').hidden = !showGauge;
    if (showGauge) gauge.draw(Mcur);
  }
  // the live base point of the first selected fibre
  const s0 = G.sel.length ? fibres[G.sel[G.sel.length - 1]] : null;
  const key = s0 ? s0.b.map(v => v.toFixed(3)).join(',') : '';
  if (key !== liveKey && frameNo % 6 === 0) {
    liveKey = key;
    $('roSelRow').hidden = !s0;
    if (s0) { $('roSw').style.background = s0.hex; typesetLive($('roSel'), s0.b); }
  }
}

// --------------------------------------------------------------------- UI
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

const MODE_HINT = {
  still: 'No rotation. Drag to turn the camera; tap two tubes to see how they link.',
  along: 'q ↦ eⁱᵃq turns each fibre on itself. The circles keep their place and the stripes run along them.',
  isoclinic: 'q ↦ q·exp(au/2) sends every fibre onto another fibre and turns the base sphere by a. Watch the rings on the small sphere and the circles pass through infinity.',
  plane: 'A rotation in the x₁x₄ plane only. Points move toward the projection point and out through infinity. The circles stay circles and stay linked.',
  double: 'Two rotations at once, in the x₁x₄ and x₂x₃ planes, at rates with an irrational ratio. The picture never repeats.',
};
const MODE_CAP = {
  still: 'Each tube is one fibre: a great circle of S³ seen through a stereographic projection.',
  along: 'The 4D rotation q ↦ eⁱᵃq moves points along their own fibres: the fibration does not change.',
  isoclinic: 'The 4D rotation q ↦ q·exp(au/2) carries fibres to fibres. A circle that reaches the projection point opens into a line and comes back from infinity.',
  plane: 'A simple 4D rotation in the x₁x₄ plane. The tubes are still great circles, but no longer Hopf fibres.',
  double: 'A double rotation in two planes of ℝ⁴. Every circle stays a circle and every pair stays linked.',
};
const GAUGE_NOTE = {
  along: 'x₁x₂ and x₃x₄ planes turn together',
  isoclinic: 'right isoclinic: all planes turn by a/2',
  plane: 'only the x₁x₄ plane turns',
  double: 'x₁x₄ at a, x₂x₃ at a/φ',
};
function setMode(m) {
  G.mode = m;
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('modeHint').textContent = MODE_HINT[m];
  $('modeCap').textContent = MODE_CAP[m];
  $('gaugeNote').textContent = GAUGE_NOTE[m] || '';
  $('tiltRow').hidden = m !== 'isoclinic';
  typesetRotation([$('rotTex'), $('gaugeTex')], m);
  baseDirty = true;
}
function setPlaying(p) {
  G.playing = p;
  $('playBtn').textContent = p ? 'Pause' : 'Play';
  $('playBtn').classList.toggle('on', p);
  $('dockPlay').classList.toggle('on', p);
  $('dockPlayIcon').setAttribute('d', p ? 'M8 5h3v14H8zM13 5h3v14h-3z' : 'M8 5l11 7-11 7z');
}
function toggleBtn(id, key, after) {
  const b = $(id);
  const sync = () => { b.classList.toggle('on', !!G[key]); b.setAttribute('aria-pressed', String(!!G[key])); };
  b.addEventListener('click', () => { G[key] = !G[key]; sync(); if (after) after(); });
  sync();
}
function bindRange(id, key, fmt, after) {
  const inp = $(id), out = $(id + 'V');
  const show = () => { out.textContent = fmt(+inp.value); };
  inp.value = String(key === 'tilt' || key === 'pole' ? G[key] * 180 / Math.PI : G[key]);
  inp.addEventListener('input', () => {
    const v = +inp.value;
    G[key] = key === 'tilt' || key === 'pole' ? v * Math.PI / 180 : v;
    show(); if (after) after();
  });
  show();
}
function drawWheel() {
  const c = $('cwheel'), g = c.getContext('2d'), W = c.width, Hh = c.height, img = g.createImageData(W, Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    // across: longitude; down: from north (top) to south
    const ph = -Math.PI + 2 * Math.PI * x / W, z = 0.9 - 1.8 * y / (Hh - 1), r = Math.sqrt(1 - z * z);
    const s = H.toSRGB(H.baseColor([r * Math.cos(ph), r * Math.sin(ph), z])), k = (y * W + x) * 4;
    img.data[k] = s[0]; img.data[k + 1] = s[1]; img.data[k + 2] = s[2]; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const spans = c.parentElement.querySelectorAll('span');
  spans[0].textContent = 'hue: longitude φ'; spans[1].textContent = 'light: north on top';
}

function buildUI() {
  const pc = $('presets');
  H.PRESETS.forEach(p => {
    const b = document.createElement('button'); b.textContent = p.name; b.dataset.id = p.id;
    b.addEventListener('click', () => { if (p.id === 'random' && G.preset === 'random') G.seed++; applyPreset(p.id); });
    pc.append(b);
  });
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  const clear = () => { G.items = []; G.trace = null; G.sel = []; markCustom(); rebuild(); toast('Tap the small sphere to add fibres'); };
  $('clearBtn').addEventListener('click', clear); $('clearBtn2').addEventListener('click', clear);
  $('reseedBtn').addEventListener('click', () => { G.seed++; applyPreset('random'); });
  // a phone draws fewer segments per fibre, and gets a lower cap
  if (COARSE) $('dens').max = '32';
  bindRange('dens', 'density', v => String(v), () => { if (!G.custom) applyPreset(G.preset); else rebuild(); });
  document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => { setMode(b.dataset.mode); if (b.dataset.mode !== 'still') setPlaying(true); }));
  bindRange('speed', 'speed', v => v.toFixed(2) + ' rad/s');
  bindRange('tilt', 'tilt', v => Math.round(v) + '°');
  bindRange('pole', 'pole', v => Math.round(v) + '°', () => { linkDirty = true; });
  bindRange('rad', 'rad', v => v.toFixed(3));
  $('playBtn').addEventListener('click', () => setPlaying(!G.playing));
  $('dockPlay').addEventListener('click', () => { if (G.mode === 'still') setMode('isoclinic'); setPlaying(!G.playing || G.mode === 'still'); });
  $('zeroBtn').addEventListener('click', () => { G.a = 0; });
  toggleBtn('sweepBtn', 'sweep', () => {
    if (G.sweep && !G.items.some(it => it.kind === 'lat')) applyPreset('nested');
    if (!G.sweep) G.items.forEach(it => { if (it.kind === 'lat') it.beta0 = Math.asin(Math.max(-1, Math.min(1, it.z))) - G.sweepPhase; });
  });
  toggleBtn('orbitBtn', 'orbit');
  toggleBtn('stripeBtn', 'stripes', rebuild);
  toggleBtn('discBtn', 'discs', () => { linkDirty = true; });
  toggleBtn('confBtn', 'conf');
  $('resetView').addEventListener('click', resetView);

  const modes = Object.keys(H.MODES);
  $('dockMode').addEventListener('click', () => { const m = modes[(modes.indexOf(G.mode) + 1) % modes.length]; setMode(m); setPlaying(m !== 'still'); toast(H.MODES[m].label); });
  $('dockName').addEventListener('click', () => {
    const i = H.PRESETS.findIndex(p => p.id === G.preset);
    const p = H.PRESETS[G.custom ? i : (i + 1) % H.PRESETS.length];
    if (p.id === 'random') G.seed++;
    applyPreset(p.id);
  });
  $('dockSphere').addEventListener('click', () => {
    const off = document.body.classList.toggle('no-sphere');
    $('dockSphere').classList.toggle('on', !off);
    baseDirty = true;
  });

  const panel = $('panel'), dockPanel = $('dockPanel');
  function setOpen(open) {
    panel.classList.toggle('open', open);
    if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open);
    dockPanel.setAttribute('aria-expanded', String(open));
  }
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  dockPanel.addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => { setOpen(!e.matches); setTimeout(resetView, 350); });
  const grip = $('sheetGrip');
  let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });

  // a tap (no drag) on the 3D view picks a fibre
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dtp = performance.now() - down.t; down = null;
    if (moved > 6 || dtp > 450) return;
    const i = pickFibre(e.clientX, e.clientY, MfullCur);
    if (i < 0) { if (G.sel.length) { G.sel = []; rebuild(); } return; }
    if (G.sel.includes(i)) G.sel = G.sel.filter(k => k !== i);
    else { G.sel.push(i); if (G.sel.length > 2) G.sel.shift(); }
    rebuild();
    if (G.sel.length === 2) toast('Two fibres: each passes once through the disc of the other');
  });
  addEventListener('keydown', e => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!G.playing); }
  });
}
function resetView() {
  S.controls.target.set(0, 0, 0);
  S.camera.position.set(4.6, 3.4, 6.2);
  // settle the occlusion first, then fit
  const o = occlusion(lastW || innerWidth, lastH || innerHeight); Object.assign(occ, o);
  setDistance(fitDistance(PHONE_Q.matches ? 3.0 : 3.4, lastW || innerWidth, lastH || innerHeight));
  S.controls.update();
}

// -------------------------------------------------------------------- api
// What saver.js drives. It may change G, call applyPreset, set a band
// function for the framing, and add frame hooks.
const app = {
  G, S, H, applyPreset, rebuild, syncPresetUI, setMode, setPlaying, setDistance, fitDistance, occ,
  fibres: () => fibres, linking: () => lastLk, curveOf,
  // the rotation of the state in G now (not the last frame's)
  rotation: () => H.matMul(H.planeMat(2, 3, G.pole), H.rotationFor(G.mode, G.a, { tilt: G.tilt })),
  setBand(fn) { saverBand = fn; },
  addHook(f) { hooks.push(f); }, removeHook(f) { const i = hooks.indexOf(f); if (i >= 0) hooks.splice(i, 1); },
  size: () => ({ w: lastW, h: lastH }),
};
window.__hopf = app;

// ------------------------------------------------------------------- boot
resize();
buildUI();
setTool('point');
setMode(G.mode);
setPlaying(true);
applyPreset(G.preset);
$('dens').value = String(G.density); $('densV').textContent = String(G.density);
drawWheel();
resetView();
typesetPage().then(() => { window.__hopfReady = true; });
installSaver(app);
requestAnimationFrame(frame);
window.__hopfBooted = true;
