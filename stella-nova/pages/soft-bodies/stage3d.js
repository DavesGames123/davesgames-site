// ============================================================================
//  STAGE 3D  ·  pages/soft-bodies/stage3d.js — the site layer of the
//  three.js Ten Minute Physics ports (soft bodies, grab, skinning, cloth,
//  cloth self collision)
// ----------------------------------------------------------------------------
//  The upstream demos (main.js in each page, Matthias Müller, MIT) stay
//  as they are. They make the globals gThreeScene, gRenderer, gCamera,
//  gCameraControl, gGrabber and gPhysicsScene, and an update() loop. This
//  module gives each page, with the sim kit GUI (widgets/sim-kit):
//    - a new frame loop (install): kit transport, fixed 60 Hz steps, the
//      OrbitControls target, the clear-area view offset, the saver camera
//    - the look (themeScene, makeMaterial, clothTexture): kit themes on the
//      scene background, fog, ground, grid and lights; material styles;
//      cloth patterns from the kit palette
//    - obstacles: spheres and boxes, drawn, draggable with the upstream
//      grabber (userData startGrab/moveGrabbed/endGrab on layer 1), and a
//      particle collision pass (collide) that a page wraps around the
//      upstream solve
//    - a camera rig (Rig) for the saver: orbit, track, push, top, low
//  No DOM at import time, so the page tests import it in node.
//
//  grep -n targets
//    look ................. "export function themeScene"
//    material ............. "export function makeMaterial"
//    cloth pattern ........ "export function clothTexture"
//    obstacles ............ "export function makeObstacles", "export function collide"
//    wrap a solver ........ "export function wrapAfter"
//    camera rig ........... "export class Rig"
//    frame loop ........... "export function install"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';

// ---- look controls ------------------------------------------------------------
export const STYLES = [
  { id: 'satin', label: 'Satin' }, { id: 'gloss', label: 'Gloss' }, { id: 'matte', label: 'Matte' },
  { id: 'facet', label: 'Faceted' }, { id: 'toon', label: 'Toon' }, { id: 'jelly', label: 'Jelly' }, { id: 'glow', label: 'Glow' },
];
export const PATTERNS = [
  { id: 'solid', label: 'Solid' }, { id: 'stripes', label: 'Stripes' }, { id: 'check', label: 'Check' }, { id: 'gingham', label: 'Gingham' },
  { id: 'plaid', label: 'Plaid' }, { id: 'dots', label: 'Dots' }, { id: 'chevron', label: 'Chevron' }, { id: 'grid', label: 'Grid' },
];
// The look group shared by the five pages; extra controls go first.
export function lookGroup(extra = [], o = {}) {
  return { id: 'look', label: 'Look', controls: [
    ...extra,
    K.themeControl(o.theme || 'night'),
    K.paletteControl(o.palette || 'toybox'),
    { key: 'mat', type: 'choice', label: 'Material', value: o.mat || 'satin', seg: false, options: STYLES, random: { weights: { satin: 3, gloss: 3, matte: 1, facet: 2, toon: 1, jelly: 2, glow: 1 } } },
    { key: 'shadows', type: 'toggle', label: 'Shadows', value: true, random: false },
    { key: 'grid', type: 'toggle', label: 'Floor grid', value: true, random: { p: 0.6 } },
    { key: 'fog', type: 'toggle', label: 'Fog', value: true, random: { p: 0.7 } },
  ] };
}

// ---- theme on the three.js scene ------------------------------------------------------
// Finds the upstream ground plane, grid, and lights once, then recolours them.
function parts(G) {
  const sc = G.gThreeScene; if (!sc) return null;
  if (sc.userData.skParts) return sc.userData.skParts;
  const P = { ground: null, grid: null, amb: null, spot: null, dir: null };
  for (const c of sc.children) {
    if (c.isGridHelper) P.grid = c;
    else if (c.isMesh && c.geometry && /Plane/.test(c.geometry.type) && !P.ground) P.ground = c;
    else if (c.isAmbientLight) P.amb = c;
    else if (c.isSpotLight) P.spot = c;
    else if (c.isDirectionalLight) P.dir = c;
  }
  sc.userData.skParts = P;
  return P;
}
export function themeScene(G, st) {
  const THREE = G.THREE, sc = G.gThreeScene, P = parts(G); if (!P) return;
  const t = K.themeById(st.theme);
  const bg = new THREE.Color(t.bg);
  sc.background = bg;
  if (st.fog === false) sc.fog = null;
  else { if (!sc.fog) sc.fog = new THREE.Fog(t.bg, 2, 15); sc.fog.color.set(t.bg); sc.fog.near = 3; sc.fog.far = 14; }
  if (P.ground) {
    const g = t.dark ? K.mixHex(t.bg2, t.wall, 0.14) : K.mixHex(t.bg, t.wall, 0.07);
    P.ground.material.color.set(g);
    P.ground.material.shininess = t.dark ? 30 : 12;
    P.ground.receiveShadow = st.shadows !== false;
  }
  if (P.grid) { sc.remove(P.grid); P.grid.geometry.dispose(); P.grid.material.dispose(); P.grid = null; }
  if (st.grid !== false) {
    const major = K.mixHex(t.dark ? t.bg2 : t.bg, t.accent, t.dark ? 0.45 : 0.35), minor = K.mixHex(t.dark ? t.bg2 : t.bg, t.wall, t.dark ? 0.22 : 0.18);
    const gh = new THREE.GridHelper(20, 40, new THREE.Color(major), new THREE.Color(minor));
    gh.position.y = 0.002; gh.material.transparent = true; gh.material.opacity = 0.85;
    sc.add(gh); P.grid = gh;
  }
  if (P.amb) { P.amb.color.set(t.dark ? K.mixHex('#505050', t.accent, 0.12) : '#8c8c8c'); }
  // a sky fill light (ours): the upstream spot leaves the floor edges black
  if (!P.hemi) { P.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.5); sc.add(P.hemi); }
  P.hemi.color.set(K.mixHex('#ffffff', t.accent, 0.25)); P.hemi.groundColor.set(t.dark ? t.bg2 : t.bg); P.hemi.intensity = t.dark ? 0.55 : 0.75;
  if (P.spot) {
    if (!P.spotSet) { P.spotSet = true; P.spot.angle = Math.PI / 3.2; P.spot.penumbra = 0.55; P.spot.position.set(2.5, 6, 4); P.spot.shadow.camera.near = 2; P.spot.shadow.camera.far = 20; P.spot.shadow.mapSize.width = P.spot.shadow.mapSize.height = 2048; P.spot.intensity = 1.1; }
    P.spot.color.set(K.mixHex('#ffffff', t.accent, 0.10)); P.spot.castShadow = st.shadows !== false;
  }
  if (P.dir) { P.dir.color.set(t.dark ? K.mixHex('#55505a', t.accent, 0.25) : '#9a9aa4'); P.dir.castShadow = st.shadows !== false; }
  if (G.gRenderer) G.gRenderer.shadowMap.enabled = st.shadows !== false;
}

// ---- materials ----------------------------------------------------------------------------
export function makeMaterial(THREE, style, color, o = {}) {
  const c = new THREE.Color(color), side = o.side != null ? o.side : THREE.FrontSide;
  let m;
  switch (style) {
    case 'gloss': m = new THREE.MeshPhongMaterial({ color: c, shininess: 140, specular: 0x777777, side }); break;
    case 'matte': m = new THREE.MeshLambertMaterial({ color: c, side }); break;
    case 'facet': m = new THREE.MeshPhongMaterial({ color: c, shininess: 40, flatShading: true, side }); break;
    case 'toon': m = new THREE.MeshToonMaterial({ color: c, side }); break;
    case 'jelly': m = new THREE.MeshPhongMaterial({ color: c, shininess: 110, specular: 0x999999, transparent: true, opacity: 0.74, side }); break;
    case 'glow': m = new THREE.MeshPhongMaterial({ color: c, emissive: c.clone().multiplyScalar(0.45), shininess: 60, side }); break;
    default: m = new THREE.MeshPhongMaterial({ color: c, shininess: 45, specular: 0x333333, side });
  }
  if (o.map) { m.map = o.map; m.color.set(0xffffff); if (m.emissive && style === 'glow') m.emissive.set(0x333333); }
  return m;
}
// Swap the material of a mesh, keep the old one's side, dispose the old.
export function setMaterial(THREE, mesh, style, color, o = {}) {
  if (!mesh) return;
  const old = mesh.material;
  mesh.material = makeMaterial(THREE, style, color, Object.assign({ side: old ? old.side : THREE.FrontSide }, o));
  if (old && old !== mesh.material) { if (old.map && old.map !== o.map) old.map.dispose(); old.dispose(); }
}

// ---- cloth patterns -------------------------------------------------------------------------
// A tiling canvas texture in the palette colours; null without a DOM.
export function clothTexture(THREE, pattern, cols) {
  if (pattern === 'solid' || typeof document === 'undefined' || !document.createElement) return null;
  const S = 256, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const x = cv.getContext && cv.getContext('2d'); if (!x) return null;
  const a = cols[0], b = cols[1 % cols.length], c = cols[2 % cols.length], d = cols[3 % cols.length];
  x.fillStyle = a; x.fillRect(0, 0, S, S);
  switch (pattern) {
    case 'stripes': for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? b : a; x.fillRect(0, i * 32, S, 32); } x.fillStyle = c; for (let i = 0; i < 8; i++) x.fillRect(0, i * 32 + 14, S, 4); break;
    case 'check': for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? b : a; x.fillRect(i * 32, j * 32, 32, 32); } break;
    case 'gingham': x.globalAlpha = 0.55; x.fillStyle = b; for (let i = 0; i < 8; i += 2) { x.fillRect(i * 32, 0, 32, S); x.fillRect(0, i * 32, S, 32); } x.globalAlpha = 1; break;
    case 'plaid': x.globalAlpha = 0.5; for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? b : c; x.fillRect(i * 64, 0, 36, S); x.fillRect(0, i * 64, S, 36); } x.globalAlpha = 0.9; x.fillStyle = d; for (let i = 0; i < 4; i++) { x.fillRect(i * 64 + 48, 0, 4, S); x.fillRect(0, i * 64 + 48, S, 4); } x.globalAlpha = 1; break;
    case 'dots': x.fillStyle = b; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.beginPath(); x.arc(i * 32 + 16 + (j % 2) * 16, j * 32 + 16, 7, 0, 7); x.fill(); } break;
    case 'chevron': x.lineWidth = 12; x.lineJoin = 'miter'; for (let j = -1; j < 9; j++) { x.strokeStyle = j % 2 ? b : c; x.beginPath(); for (let i = 0; i <= 8; i++) x.lineTo(i * 32, j * 32 + (i % 2 ? 16 : 0)); x.stroke(); } break;
    case 'grid': x.strokeStyle = b; x.lineWidth = 3; for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, S); x.stroke(); x.beginPath(); x.moveTo(0, i * 32); x.lineTo(S, i * 32); x.stroke(); } break;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4;
  return tex;
}
// Planar UVs from the rest positions over the two widest axes, `rep`
// pattern repeats over the longer side.
export function planarUV(THREE, geom, rest, rep = 3) {
  const n = rest.length / 3, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = rest[3 * i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const ext = [0, 1, 2].map(k => hi[k] - lo[k]);
  const ax = [0, 1, 2].sort((p, q) => ext[q] - ext[p]);
  const u = ax[0], v = ax[1], L = Math.max(ext[u], 1e-6);
  const uv = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) { uv[2 * i] = (rest[3 * i + u] - lo[u]) / L * rep; uv[2 * i + 1] = (rest[3 * i + v] - lo[v]) / L * rep; }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---- obstacles ------------------------------------------------------------------------------
// A list of { type: 'sphere'|'box', c: [x,y,z], r, h: [hx,hy,hz], v: [vx,vy,vz] }.
// makeObstacles(r, n, o) draws n of them from the rng r inside the floor
// area o.area (half sizes), with sizes o.size = [min, max] and kinds o.kinds.
export function makeObstacles(r, n, o = {}) {
  const area = o.area || [0.8, 0.8], size = o.size || [0.12, 0.3], kinds = o.kinds || ['sphere', 'box'];
  const out = [];
  for (let tries = 0; out.length < n && tries < 60; tries++) {
    const type = kinds[Math.floor(r() * kinds.length)];
    const s = size[0] + (size[1] - size[0]) * r();
    const x = (2 * r() - 1) * area[0], z = (2 * r() - 1) * area[1];
    let ob;
    if (type === 'sphere') ob = { type, c: [x, s * (o.float ? 1.6 + r() : 1), z], r: s };
    else if (type === 'pillar') { const hy = s * (1.0 + 1.0 * r()); ob = { type: 'box', c: [x, hy, z], h: [s * 0.35, hy, s * 0.35] }; }
    else { const hx = s * (0.7 + 0.6 * r()), hy = s * (0.4 + 0.5 * r()), hz = s * (0.7 + 0.6 * r()); ob = { type: 'box', c: [x, hy, z], h: [hx, hy, hz] }; }
    ob.v = [0, 0, 0];
    const rad = ob.type === 'sphere' ? ob.r : Math.hypot(ob.h[0], ob.h[2]);
    if (out.some(p => Math.hypot(p.c[0] - ob.c[0], p.c[2] - ob.c[2]) < rad + (p.type === 'sphere' ? p.r : Math.hypot(p.h[0], p.h[2])) + 0.04)) continue;
    if (o.keepOut && Math.hypot(ob.c[0] - o.keepOut[0], ob.c[2] - o.keepOut[2]) < rad + o.keepOut[3]) continue;
    out.push(ob);
  }
  return out;
}
// Push particles out of the obstacles. pad: particle radius; fric 0..1:
// how much of the tangential slide (relative to the obstacle) is removed.
// dt: the substep (the obstacle moves by v dt). Returns the number of
// particles that touched an obstacle.
export function collide(obs, pos, prev, invMass, n, pad = 0.01, fric = 0.6, dt = 0) {
  if (!obs || !obs.length) return 0;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (invMass && invMass[i] === 0) continue;
    const i3 = 3 * i;
    for (let k = 0; k < obs.length; k++) {
      const o = obs[k];
      let nx = 0, ny = 0, nz = 0, depth = 0;
      const qx = pos[i3] - o.c[0], qy = pos[i3 + 1] - o.c[1], qz = pos[i3 + 2] - o.c[2];
      if (o.type === 'sphere') {
        const R = o.r + pad, d2 = qx * qx + qy * qy + qz * qz;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) || 1e-9; nx = qx / d; ny = qy / d; nz = qz / d; depth = R - d;
        if (d2 === 0) { nx = 0; ny = 1; nz = 0; depth = R; }
      } else {
        const ex = o.h[0] + pad - Math.abs(qx), ey = o.h[1] + pad - Math.abs(qy), ez = o.h[2] + pad - Math.abs(qz);
        if (ex <= 0 || ey <= 0 || ez <= 0) continue;
        if (ey <= ex && ey <= ez) { ny = qy < 0 ? -1 : 1; depth = ey; }
        else if (ex <= ez) { nx = qx < 0 ? -1 : 1; depth = ex; }
        else { nz = qz < 0 ? -1 : 1; depth = ez; }
      }
      pos[i3] += nx * depth; pos[i3 + 1] += ny * depth; pos[i3 + 2] += nz * depth;
      if (pos[i3 + 1] < 0) pos[i3 + 1] = 0;   // never push through the floor
      if (prev && fric > 0) {
        // the slide this substep, relative to the moving obstacle
        const v = o.v || [0, 0, 0];
        let sx = pos[i3] - prev[i3] - v[0] * dt, sy = pos[i3 + 1] - prev[i3 + 1] - v[1] * dt, sz = pos[i3 + 2] - prev[i3 + 2] - v[2] * dt;
        const sn = sx * nx + sy * ny + sz * nz; sx -= sn * nx; sy -= sn * ny; sz -= sn * nz;
        pos[i3] -= fric * sx; pos[i3 + 1] -= fric * sy; pos[i3 + 2] -= fric * sz;
      }
      hits++;
    }
  }
  return hits;
}
// Wrap proto[name] so fn(this, args) runs after it. Marks the wrap so a
// second call does not stack.
export function wrapAfter(proto, name, fn) {
  const orig = proto[name];
  if (!orig || orig.__sk) return;
  const w = function (...a) { const r = orig.apply(this, a); fn(this, a); return r; };
  w.__sk = true; w.__orig = orig;
  proto[name] = w;
}
export function wrapBefore(proto, name, fn) {
  const orig = proto[name];
  if (!orig || orig.__skb) return;
  const w = function (...a) { fn(this, a); return orig.apply(this, a); };
  w.__skb = true; w.__orig = orig;
  proto[name] = w;
}

// Obstacle meshes on layer 1, grabbable with the upstream grabber: a drag
// moves the obstacle (kinematic), its velocity pushes cloth and bodies.
export function obstacleMeshes(G, obs, cols, style, onMove) {
  const THREE = G.THREE, list = [];
  obs.forEach((o, i) => {
    const geom = o.type === 'sphere' ? new THREE.SphereGeometry(o.r, 40, 28) : new THREE.BoxGeometry(2 * o.h[0], 2 * o.h[1], 2 * o.h[2]);
    const mesh = new THREE.Mesh(geom, makeMaterial(THREE, style === 'jelly' ? 'satin' : style, cols[(i + 3) % cols.length]));
    mesh.position.set(o.c[0], o.c[1], o.c[2]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.layers.enable(1);
    const grab = { off: [0, 0, 0], last: [0, 0, 0] };
    mesh.userData = {
      obstacle: o,
      startGrab(p) { grab.off = [o.c[0] - p.x, o.c[1] - p.y, o.c[2] - p.z]; },
      moveGrabbed(p, v) {
        const lo = o.type === 'sphere' ? o.r : o.h[1];
        o.c[0] = p.x + grab.off[0]; o.c[1] = Math.max(lo, p.y + grab.off[1]); o.c[2] = p.z + grab.off[2];
        if (v) o.v = [v.x, v.y, v.z];
        mesh.position.set(o.c[0], o.c[1], o.c[2]); if (onMove) onMove(o);
      },
      endGrab() { o.v = [0, 0, 0]; },
    };
    G.gThreeScene.add(mesh);
    list.push(mesh);
  });
  return list;
}
export function disposeMeshes(G, list) {
  for (const m of list || []) { G.gThreeScene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } }
}

// ---- body helpers --------------------------------------------------------------------------------
// Rotate (yaw, then pitch) and move the particle arrays of a body about
// their centroid, then give it a velocity v plus a spin w (rad/s about y and x).
export function placeBody(b, o) {
  const n = b.numParticles, P = [b.pos, b.prevPos].filter(Boolean);
  let cx = 0, cy = 0, cz = 0, ymin = Infinity;
  for (let i = 0; i < n; i++) { cx += b.pos[3 * i]; cy += b.pos[3 * i + 1]; cz += b.pos[3 * i + 2]; }
  cx /= n; cy /= n; cz /= n;
  const cyw = Math.cos(o.yaw || 0), syw = Math.sin(o.yaw || 0), cp = Math.cos(o.pitch || 0), sp = Math.sin(o.pitch || 0);
  for (const A of P) for (let i = 0; i < n; i++) {
    let x = A[3 * i] - cx, y = A[3 * i + 1] - cy, z = A[3 * i + 2] - cz;
    let x1 = cyw * x + syw * z, z1 = -syw * x + cyw * z;
    let y1 = cp * y - sp * z1, z2 = sp * y + cp * z1;
    A[3 * i] = x1; A[3 * i + 1] = y1; A[3 * i + 2] = z2;
  }
  for (let i = 0; i < n; i++) ymin = Math.min(ymin, b.pos[3 * i + 1]);
  const at = o.at || [0, 0.5, 0];
  const dy = at[1] - ymin;
  for (const A of P) for (let i = 0; i < n; i++) { A[3 * i] += at[0]; A[3 * i + 1] += dy; A[3 * i + 2] += at[2]; }
  if (b.vel) {
    const v = o.v || [0, 0, 0], w = o.w || 0;
    for (let i = 0; i < n; i++) {
      const rx = b.pos[3 * i] - at[0], rz = b.pos[3 * i + 2] - at[2];
      b.vel[3 * i] = v[0] - w * rz; b.vel[3 * i + 1] = v[1]; b.vel[3 * i + 2] = v[2] + w * rx;
    }
  }
}
export function centroid(list) {
  let x = 0, y = 0, z = 0, n = 0;
  for (const b of list) { if (!b || !b.pos) continue; const m = b.numParticles; for (let i = 0; i < m; i += 7) { x += b.pos[3 * i]; y += b.pos[3 * i + 1]; z += b.pos[3 * i + 2]; n++; } }
  return n ? [x / n, y / n, z / n] : [0, 0.3, 0];
}
export function finiteBody(b) { const p = b.pos; for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) return false; return true; }
// Run f with Math.random replaced by the seeded r (upstream jitter).
export function seeded(r, f) { const m = Math.random; Math.random = r; try { return f(); } finally { Math.random = m; } }

// ---- camera rig (saver) ---------------------------------------------------------------------------
// cam = { mode, az, el, r, r1, w, target: [x,y,z], track: 0..1, lift }
// orbit: turn about the target; track: the target follows the subject;
// push: the radius eases from r to r1; top: high and slow; low: grazing.
export class Rig {
  constructor() { this.cam = null; this.t = 0; this.tg = [0, 0.3, 0]; this.az = 0; this.el = 0.3; this.r = 2; }
  // size: the subject scale (spread of the scene); radii scale with it
  set(cam, subject, size = 1) {
    this.cam = cam ? Object.assign({}, cam, { r: (cam.r || 2) * size, r1: cam.r1 != null ? cam.r1 * size : null }) : null; this.t = 0; if (!cam) return;
    cam = this.cam;
    this.az = cam.az || 0; this.el = cam.el != null ? cam.el : 0.3; this.r = cam.r;
    this.tg = (cam.target || subject || [0, 0.3, 0]).slice();
  }
  tick(dt, camera, subject) {
    const c = this.cam; if (!c || !camera) return;
    this.t += dt;
    this.az += (c.w || 0) * dt;
    const dur = c.dur || 10, u = Math.min(1, this.t / dur), e = u * u * (3 - 2 * u);
    const r = c.r1 != null ? c.r + (c.r1 - c.r) * e : c.r;
    const el = c.el1 != null ? c.el + (c.el1 - c.el) * e : this.el;
    if (subject && c.track) { const k = 1 - Math.exp(-dt * 2.2 * c.track); for (let i = 0; i < 3; i++) this.tg[i] += ((subject[i] + (i === 1 ? (c.lift || 0) : 0)) - this.tg[i]) * k; }
    const ce = Math.cos(el);
    camera.position.set(this.tg[0] + r * ce * Math.sin(this.az), Math.max(0.03, this.tg[1] + r * Math.sin(el)), this.tg[2] + r * ce * Math.cos(this.az));
    camera.lookAt(this.tg[0], this.tg[1], this.tg[2]);
  }
}
// A camera spec for a saver shot from the rng and a subject size s (m).
export function shotCam(r, kind, s, extra = {}) {
  const az = r() * 6.283, dir = r() < 0.5 ? -1 : 1;
  const base = {
    orbit: { mode: 'orbit', az, el: 0.25 + 0.25 * r(), r: 2.4 * s, w: dir * (0.12 + 0.1 * r()), track: 0.5 },
    track: { mode: 'track', az, el: 0.15 + 0.2 * r(), r: 1.7 * s, w: dir * 0.06, track: 1.6 },
    push: { mode: 'push', az, el: 0.2 + 0.2 * r(), r: 3.0 * s, r1: 1.4 * s, w: dir * 0.05, track: 0.8, dur: 10 },
    top: { mode: 'top', az, el: 1.05 + 0.25 * r(), r: 2.6 * s, w: dir * 0.08, track: 0.4 },
    low: { mode: 'low', az, el: 0.04 + 0.05 * r(), r: 1.9 * s, w: dir * 0.1, track: 1.0, lift: -0.05 * s },
    crane: { mode: 'crane', az, el: 0.05, el1: 0.85, r: 2.2 * s, w: dir * 0.07, track: 0.7, dur: 11 },
  }[kind] || {};
  return Object.assign(base, extra);
}

// ---- frame loop ---------------------------------------------------------------------------------------
// install(G, o) replaces the upstream update() loop. o = {
//   kit, simulate(), focus() -> [x,y,z], fov?, before?(dt), after?(dt),
//   rig (Rig), saver: () => D (director state, D.active) }
// The upstream simulate() still runs the physics (paused is set per frame).
export function install(G, o) {
  const kit = o.kit, P = G.gPhysicsScene;
  let last = 0, acc = 0, ctrl = null, band = null, view = { W: 0, H: 0, x: 0, y: 0 };
  const H = 1 / 60;
  const st = { band: null, setBand(b) { band = b; }, focus: o.focus, retarget: true };

  function clearRect() {
    const W = innerWidth, Ht = innerHeight;
    if (band) return { x: band.x, y: band.y, w: band.w, h: band.h };
    let x1 = W, y1 = Ht;
    const panel = typeof document !== 'undefined' && document.getElementById ? document.getElementById('sk-panel') : null;
    const tr = typeof document !== 'undefined' && document.querySelector ? document.querySelector('.sk-transport') : null;
    if (kit.panelOpen && panel && !kit.phone) x1 = Math.max(W * 0.45, panel.getBoundingClientRect().left || W);
    if (kit.panelOpen && kit.phone && panel) y1 = Math.min(y1, panel.getBoundingClientRect().top || Ht);
    if (tr && kit.phone) { const t = tr.getBoundingClientRect().top; if (t > 0) y1 = Math.min(y1, t); }
    return { x: 0, y: 0, w: x1, h: y1 };
  }
  function offset() {
    const cam = G.gCamera; if (!cam) return;
    const W = innerWidth, Ht = innerHeight, c = clearRect();
    const ox = Math.round(W / 2 - (c.x + c.w / 2)), oy = Math.round(Ht / 2 - (c.y + c.h / 2));
    if (view.W !== W || view.H !== Ht || view.x !== ox || view.y !== oy) {
      view = { W, H: Ht, x: ox, y: oy };
      cam.aspect = W / Ht;
      if (ox || oy) cam.setViewOffset(W, Ht, ox, oy, W, Ht); else cam.clearViewOffset();
      cam.fov = o.fov || cam.fov;
      cam.updateProjectionMatrix();
    }
  }
  function controls() {
    const c = G.gCameraControl; if (!c) return;
    if (c !== ctrl) {
      // upstream makes a new OrbitControls after each grab: keep the view
      const tgt = ctrl ? ctrl.target.clone() : null;
      if (ctrl && ctrl !== c) { ctrl.enabled = false; if (ctrl.dispose) ctrl.dispose(); }
      ctrl = c; c.enableDamping = true; c.dampingFactor = 0.12; c.zoomSpeed = 1.2; c.panSpeed = 0.5; c.maxPolarAngle = Math.PI * 0.495;
      if (tgt) c.target.copy(tgt); else { const f = st.focus(); c.target.set(f[0], f[1], f[2]); }
    }
    if (st.retarget) { const f = st.focus(); c.target.set(f[0], f[1], f[2]); st.retarget = false; }
  }
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, Math.max(0, (ts - last) / 1000)) : 0; last = ts;
    const saver = o.saver && o.saver();
    if (o.before) o.before(dt);
    let steps = 0;
    if (kit.playing) { acc += dt * kit.speed; steps = Math.min(3, Math.floor(acc / H + 1e-6)); acc -= steps * H; if (acc > H) acc = 0; }
    else if (kit.takeStep()) steps = 1;
    else if (G.gGrabber && G.gGrabber.physicsObject && !kit.saver) kit.setPlaying(true);
    if (steps) { P.dt = H; for (let i = 0; i < steps; i++) { P.paused = false; o.simulate(); } }
    P.paused = true;
    if (o.after) o.after(dt, steps);
    const active = saver && saver.active;
    if (active) { if (G.gCameraControl) G.gCameraControl.enabled = false; o.rig.tick(dt, G.gCamera, st.focus()); }
    else { controls(); if (G.gCameraControl && !(G.gGrabber && G.gGrabber.physicsObject)) { G.gCameraControl.enabled = true; G.gCameraControl.update(); } }
    offset();
    G.gRenderer.render(G.gThreeScene, G.gCamera);
  }
  // the upstream loop calls requestAnimationFrame(update) by name: the next
  // frame lands here, and this loop keeps itself going
  globalThis.update = frame;
  // the upstream resize keeps the full window; the offset is ours
  if (typeof addEventListener === 'function') addEventListener('resize', () => { view.W = 0; });
  return st;
}
