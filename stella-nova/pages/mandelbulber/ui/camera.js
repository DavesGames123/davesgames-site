// ui/camera.js — Mandelbulber page: the camera math, after upstream cCameraTarget (src/camera_target.cpp).
//
// The scene keeps the camera as upstream does: camera, target, camera_top,
// camera_rotation and camera_distance_to_target. camFromScene reads them into a
// { target, yaw, pitch, roll, dist } state, and camToScene writes a state back. The
// input modules change a state with panBy, orbitBy and lookBy. frameView asks the engine
// for the surface extent and moves the camera back until the surface fits the view.
//
// grep: const V  function camFromScene  function camBasis  function camToScene  function resetCamera
//       async function frameView  function panBy  function orbitBy  function lookBy

import { canvas, clamp } from './dom.js';
import { P } from './data.js';
import { scene, engine } from './state.js';
import { flash } from './hud.js';
import { touch, sceneDirty, pushScene, scenePromise } from './scene.js';
import { refreshAll } from './controls.js';
import { stopInertia } from '../main.js';

export const V = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  mul: (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  norm: (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; },
  rot: (v, ax, ang) => {                             // CVector3::RotateAroundVectorByAngle
    const c = Math.cos(ang), s = Math.sin(ang);
    return V.add(V.add(V.mul(v, c), V.mul(V.cross(ax, v), s)), V.mul(ax, V.dot(ax, v) * (1 - c)));
  },
};

const AX = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };
const DEG = Math.PI / 180;

// Camera state from camera / target / camera_top (SetCameraTargetTop).
export function camFromScene() {
  const m = scene.main;
  const cam = m.camera, tgt = m.target;
  let fwd = V.sub(tgt, cam);
  const dist = V.len(fwd) || m.camera_distance_to_target || 1;
  fwd = V.len(fwd) > 0 ? V.norm(fwd) : { x: 0, y: 1, z: 0 };
  const yaw = Math.atan2(fwd.y, fwd.x) - Math.PI / 2;
  const pitch = Math.atan2(fwd.z, Math.hypot(fwd.x, fwd.y));
  let t = V.norm(m.camera_top || AX.z);
  t = V.rot(t, AX.z, -yaw);
  t = V.rot(t, AX.x, -pitch);
  const roll = -Math.atan2(t.z, t.x) + Math.PI / 2;
  return { target: { ...tgt }, yaw, pitch, roll, dist };
}

export function camBasis(c) {
  const fwd = { x: -Math.sin(c.yaw) * Math.cos(c.pitch), y: Math.cos(c.yaw) * Math.cos(c.pitch), z: Math.sin(c.pitch) };
  let top = V.rot(AX.z, AX.y, c.roll);
  top = V.rot(top, AX.x, c.pitch);
  top = V.rot(top, AX.z, c.yaw);
  return { fwd, top, right: V.cross(fwd, top) };
}

const wrapDeg = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return +a.toPrecision(12); };

export function camToScene(c, quiet) {
  const { fwd, top } = camBasis(c);
  const m = scene.main;
  m.target = c.target;
  m.camera = V.sub(c.target, V.mul(fwd, c.dist));
  m.camera_top = top;
  m.camera_rotation = { x: wrapDeg(c.yaw / DEG), y: wrapDeg(c.pitch / DEG), z: wrapDeg(c.roll / DEG) };
  m.camera_distance_to_target = c.dist;
  if (!quiet) refreshAll();
  touch();
}

export function resetCamera() {
  stopInertia();
  for (const k of ['camera', 'target', 'camera_top', 'camera_rotation', 'camera_distance_to_target']) {
    if (P.main[k]) scene.main[k] = structuredClone(P.main[k].default);
  }
  refreshAll();
  touch();
}

// Frame: the engine probes the surface extent (a center and a radius); the camera keeps its
// view direction and moves back until a sphere of that radius fits the narrower image axis.
let framing = 0;

export async function frameView(auto) {
  if (!engine?.frameView) return;
  stopInertia();
  const job = ++framing;
  if (sceneDirty) pushScene();
  await scenePromise;
  if (job !== framing) return;
  let r = null;
  try { r = await engine.frameView(); } catch (e) { console.error('[mandelbulber] frame', e); }
  if (job !== framing || !r) return;
  if (r.unbounded) return flash('frame: this shape fills space, the camera stays');
  if (r.empty) return flash('frame: no surface found near the target');
  const c = camFromScene();
  const deg = scene.main.fov ?? 53.13;
  const aspect = Math.max(canvas.clientWidth, 1) / Math.max(canvas.clientHeight, 1);
  const half = (scene.main.perspective_type ?? 0) === 0
    ? Math.atan(Math.tan(deg * DEG / 2) * Math.min(1, aspect)) : deg * DEG / 2 * Math.min(1, aspect);
  c.target = r.center;
  c.dist = r.radius / Math.sin(Math.max(half, 1 * DEG)) * 1.08;
  camToScene(c);
  flash(auto ? 'view framed to the new shape' : 'view framed');
}

// world units per CSS pixel at the target distance
const panScale = (c) => c.dist * 2 * Math.tan((scene.main.fov ?? 53) * DEG / 2) / Math.max(canvas.clientHeight, 1);
export function panBy(c, dx, dy) {
  const { right, top } = camBasis(c);
  const k = panScale(c);
  c.target = V.add(c.target, V.add(V.mul(right, -dx * k), V.mul(top, dy * k)));
}

export function orbitBy(c, dx, dy) {
  c.yaw -= dx * 0.006;
  c.pitch = clamp(c.pitch + dy * 0.006, -89.9 * DEG, 89.9 * DEG);
}

export function lookBy(c, dx, dy) {                           // turn around the eye, not the target
  const eye = V.sub(c.target, V.mul(camBasis(c).fwd, c.dist));
  c.yaw -= dx;
  c.pitch = clamp(c.pitch - dy, -89.9 * DEG, 89.9 * DEG);
  c.target = V.add(eye, V.mul(camBasis(c).fwd, c.dist));
}
