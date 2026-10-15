// ============================================================================
//  WEATHER MAP  ·  main.js (first version, package CORE)
// ----------------------------------------------------------------------------
//  Boots the core renderer and shows the globe with a simple camera:
//  drag moves the view, the wheel or a pinch zooms, a right-drag or a
//  two-finger vertical drag tilts and turns. Package UI replaces this file
//  in phase 2 (CONTRACT.md); the sections below are the seams it keeps.
//    APP       the app object (also window.WX)
//    CAMERA    pointer and wheel control of app.cam
//    LOOP      the frame loop
//    BOOT      createCore, the #nogpu message, the status line
//
//  grep -n targets: "── APP", "── CAMERA", "── LOOP", "── BOOT"
// ============================================================================
import { createCore } from './render/core.js';
import { camState, pick, ALT_MIN, ALT_MAX } from './camera.js';

// ── APP ─────────────────────────────────────────────────────────────────
const app = {
  t: Date.now(), playing: false, rate: 1, units: 'F', lightMode: 'day',
  layers: { clouds: true, radar: true, temp: true, isobars: false, fronts: true, labels: true },
  focus: null, data: { grid: null, fronts: null, radar: null, current: null },
  core: null, cam: camState(38.5, -97, 0.95, 0.32, 0),
};
window.WX = app;

const $ = id => document.getElementById(id);
const canvas = $('view');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── CAMERA ──────────────────────────────────────────────────────────────
const pointers = new Map();
let dragMoved = 0, lastPinch = 0, lastMid = null, vel = { lat: 0, lon: 0 };

function panBy(dx, dy) {
  const c = app.cam, h = canvas.clientHeight || 1;
  // ground radians per CSS px at the target: the view height covers about
  // 2 alt tan(fov / 2) radii there
  const k = 2 * c.alt * Math.tan((app.core ? app.core.fovY : 0.52) / 2) / h * 180 / Math.PI;
  const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  const north = dy * ch + dx * sh, east = -dx * ch + dy * sh;
  const dLat = north * k, dLon = east * k / Math.max(0.2, Math.cos(c.lat * Math.PI / 180));
  c.lat = clamp(c.lat + dLat, -85, 85);
  c.lon = ((c.lon + dLon + 540) % 360) - 180;
  vel = { lat: dLat, lon: dLon };
}

function zoomBy(f) { app.cam.alt = clamp(app.cam.alt * f, ALT_MIN * 2, ALT_MAX); }

function tiltBy(dx, dy) {
  const c = app.cam;
  c.tilt = clamp(c.tilt + dy * 0.004, 0, 1.15);
  c.heading = c.heading - dx * 0.004;
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
  dragMoved = 0; vel = { lat: 0, lon: 0 }; lastPinch = 0; lastMid = null;
  canvas.classList.add('drag');
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (lastPinch) zoomBy(lastPinch / Math.max(d, 1));
    if (lastMid) tiltBy(0, mid.y - lastMid.y);
    lastPinch = d; lastMid = mid;
  } else if (p.button === 2 || p.shift) tiltBy(dx, dy);
  else panBy(dx, dy);
  hideHint();
});
const up = e => {
  pointers.delete(e.pointerId);
  lastPinch = 0; lastMid = null;
  if (!pointers.size) canvas.classList.remove('drag');
  if (dragMoved < 5 && e.type === 'pointerup' && app.core && app.core.lastFrame) {
    const r = canvas.getBoundingClientRect();
    const ll = pick(app.core.lastFrame.m, e.clientX - r.left, e.clientY - r.top);
    if (ll && typeof app.onPick === 'function') app.onPick(ll);
    vel = { lat: 0, lon: 0 };
  }
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  hideHint();
}, { passive: false });

let hintTimer = setTimeout(() => hideHint(), 9000);
function hideHint() { clearTimeout(hintTimer); $('hint').classList.add('gone'); }

// ── LOOP ────────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!pointers.size && (vel.lat || vel.lon)) {
    // glide after a drag, then stop
    const c = app.cam, k = Math.exp(-dt * 4);
    c.lat = clamp(c.lat + vel.lat * dt * 50, -85, 85);
    c.lon = ((c.lon + vel.lon * dt * 50 + 540) % 360) - 180;
    vel = { lat: vel.lat * k, lon: vel.lon * k };
    if (Math.abs(vel.lat) + Math.abs(vel.lon) < 1e-4) vel = { lat: 0, lon: 0 };
  }
  app.t = app.playing ? app.t + dt * 1000 * app.rate * 3600 : Date.now();
  if (app.core) app.core.render(app.cam, app);
  requestAnimationFrame(frame);
}

// ── BOOT ────────────────────────────────────────────────────────────────
function setStatus(s) { $('status').textContent = s; }

$('lightBtn').addEventListener('click', () => {
  app.lightMode = app.lightMode === 'real' ? 'day' : 'real';
  $('lightBtn').setAttribute('aria-pressed', String(app.lightMode === 'real'));
});

async function boot() {
  if (!navigator.gpu) { $('nogpu').hidden = false; setStatus('WebGPU is not available'); return; }
  try {
    app.core = await createCore(canvas);
  } catch (e) {
    console.error(e);
    $('nogpu').hidden = false;
    setStatus('The renderer did not start');
    return;
  }
  setStatus('Loading Earth imagery…');
  addEventListener('resize', () => app.core && app.core.resize());
  requestAnimationFrame(frame);
  const st = await app.core.textures;
  const have = ['day', 'detail', 'night', 'height', 'water'].filter(k => st[k]);
  setStatus(have.length ? 'Earth imagery: NASA Blue Marble and Black Marble' : 'Earth imagery is not available, flat colours shown');
}
boot();
