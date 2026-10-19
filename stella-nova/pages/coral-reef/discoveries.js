// ============================================================================
//  CORAL REEF  ·  discoveries.js  ·  what the ROVs found, on the maps and in 3D
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "if an rov has discovered something, it
//  should get marked on the minimap, and it should be available for us to
//  hover over and click on to orbit. we should have a cool highlight
//  there". Later: "render a little marine snow particle effect that really
//  sells the underwater feeling".
//
//  LOG (createDiscoveryLog). One entry per subject, at most DISC_CAP (300,
//  the oldest go): { id, cat ('coral' | 'feature' | 'creature'), kind,
//  name, p [x, y, z] world m, r (bounding sphere m), ground (y), depth,
//  region, rov, t (squad time s), at (wall clock s) }. scanSquad adds
//  entries once a second from the squad: a colony that an ROV inspects
//  (S.tasks() subject, the ROV near it), a rock feature near an ROV
//  (W.features: arches, pinnacles, overhangs, canyons, and any later kind
//  such as a cave, a whale fall, a vent, a sponge garden), and a creature
//  species in the view of an ROV (fauna lookAt).
//
//  MARKS (drawDiscoveryMarks). A small icon by category in the colour of
//  the ROV that found it: coral a dot with three branches, feature a
//  diamond, creature a fish. A new mark pulses for PULSE s. The minimap
//  (squad-hud.js drawMap) and the large map (map-view.js draw) call
//  marks.draw(ctx, view, key); the hits of the last draw make hover and
//  click possible (pickMark).
//
//  HOVER AND CLICK. A mouse over a mark shows the card (#dscCard: name,
//  kind, depth, region, found by, time ago). A click flies the camera into
//  an orbit round it (orbitFrame: the bounding sphere fills FILL of the
//  view height, a clear direction, o.flyTo glides) and selects it. On
//  touch, the first tap shows the card and its "Orbit" button.
//
//  HIGHLIGHT (createHighlight, three.js). On the selected discovery: a
//  soft rim glow shell, a ring of light on the seabed with a slow ripple,
//  rising light motes, a local cloud of marine snow (lib/marine-snow.js
//  aggregates, centred on the subject, lit by the ROV lamps and the
//  highlight light), and a DOM label (#dscLabel). It fades in, and fades
//  out when the camera leaves, when another one is selected, or on Esc.
//
//  INSPECTION LIGHT (focus-light.js). The user said (2026-10-18): "focusing
//  on objects does not light them up in deep water". select() calls
//  o.inspect(e) (main.js: one ROV flies to the subject and aims its lamps
//  at it, rov/squad.js S.inspect), clear() calls o.release(id). Each frame
//  tick() gives o.keyLight a soft key light near the orbit eye (keyFrame,
//  times the highlight alpha), and null when the highlight has faded.
//
//  TOAST (#dscToast). "ROV 3 found a bubblegum coral", at most one each
//  TOAST_GAP s; the newest waiting entry shows next with a count.
//
//  grep -n targets
//    "export function createDiscoveryLog"   the log
//    "export function scanSquad"            the discovery rules
//    "export function drawDiscoveryMarks"   the icons; "export function pickMark"
//    "export function orbitFrame"           the camera frame of a discovery
//    "export function toastText"            the toast words
//    "export function createHighlight"      the 3D highlight
//    "export function mountDiscoveries"     the DOM part (card, toast, label, keys)
// ============================================================================
import { createMarineSnow, marineSnowVS, MS_LIGHT_SPOTS, MARINE_SNOW_FS } from '../../lib/marine-snow.js';
import { keyFrame } from './focus-light.js';

export const DISC_CAP = 300;
export const TOAST_GAP = 4;          // s between two toasts
export const PULSE = 2.6;            // s of the pulse of a new mark
export const FILL = 0.42;            // the share of the view height that the subject fills
export const PICK_R = 11;            // px: a pointer this near a mark is on it
export const SCAN_EVERY = 1;         // s
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const FEATURE_NAME = {
  arch: 'Natural arch', pinnacle: 'Pinnacle', overhang: 'Rock overhang', canyon: 'Canyon', cave: 'Sea cave',
  'whale-fall': 'Whale fall', whalefall: 'Whale fall', vent: 'Hydrothermal vent', 'sponge-garden': 'Sponge garden', sponges: 'Sponge garden',
};
const CAT_TEXT = { coral: 'Coral colony', feature: 'Rock feature', creature: 'Creature' };
const nowS = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

// ── the log ─────────────────────────────────────────────────────────────────
export function createDiscoveryLog({ cap = DISC_CAP } = {}) {
  const byId = new Map(), ears = [];
  const L = {
    get size() { return byId.size; },
    has: id => byId.has(id), get: id => byId.get(id) || null,
    list: () => [...byId.values()],
    // e needs id; returns the entry when it is new, else null
    add(e) {
      if (!e || e.id == null || byId.has(e.id)) return null;
      byId.set(e.id, e);
      while (byId.size > cap) byId.delete(byId.keys().next().value);
      for (const f of ears) { try { f(e); } catch (err) { console.error('coral-reef: discovery', err); } }
      return e;
    },
    onAdd(f) { ears.push(f); },
    clear() { byId.clear(); },
  };
  return L;
}

// ── the rules ───────────────────────────────────────────────────────────────
// env: { colonies(), speciesLabel(id), features(x, z, r), lookAt(p, dir, max),
//        ground(x, z), regionAt(x, z), surfaceY, now() }
// Returns the new entries.
export function scanSquad(log, sq, env, t = 0) {
  if (!sq || !sq.vehicles) return [];
  const out = [], at = env.now ? env.now() : nowS(), surf = env.surfaceY ?? 55;
  const make = (id, cat, kind, name, p, r, rov) => {
    if (log.has(id)) return;
    const g = env.ground ? env.ground(p[0], p[2]) : p[1] - r;
    const rg = env.regionAt ? env.regionAt(p[0], p[2]) : null;
    const e = log.add({ id, cat, kind, name, p: p.slice(), r, ground: Number.isFinite(g) ? g : p[1] - r, depth: Math.round(surf - (Number.isFinite(g) ? g : p[1])), region: rg ? rg.name || rg.id : '', rov, t, at });
    if (e) out.push(e);
  };
  const tasks = typeof sq.tasks === 'function' ? sq.tasks() : [];
  let cols = null;
  for (const tk of tasks) {
    if (tk.kind !== 'inspect' || tk.subject == null || !env.colonies) continue;
    if (log.has('coral:' + tk.subject)) continue;
    if (!cols) { cols = new Map(); try { for (const c of env.colonies() || []) if (c && c.key != null) cols.set(c.key, c); } catch { /* no colonies */ } }
    const c = cols.get(tk.subject), v = sq.vehicles.find(q => q.id === tk.id);
    if (!c || !v) continue;
    const ctr = c.center || c.base, r = Math.max(0.8, c.radius || (c.size || 2) / 2);
    if (!ctr || Math.hypot(ctr[0] - v.state.p[0], ctr[1] - v.state.p[1], ctr[2] - v.state.p[2]) > r + 12) continue;
    const name = (env.speciesLabel && env.speciesLabel(c.id)) || 'Coral colony';
    make('coral:' + tk.subject, 'coral', 'colony', name, ctr, r, v.id);
  }
  for (const v of sq.vehicles) {
    const p = v.state.p;
    if (env.features) {
      let fs = []; try { fs = env.features(p[0], p[2], 16) || []; } catch { fs = []; }
      for (const f of fs) {
        if (!f || !f.center || !f.kind) continue;
        const r = f.kind === 'canyon' ? Math.max(4, (f.width || 8) / 2) : Math.max(1.5, (f.size || 3) / 2, f.radius || 0);
        if (Math.hypot(f.center[0] - p[0], f.center[2] - p[2]) > Math.min(r, 10) + 10) continue;
        const id = f.id || `${f.kind}:${Math.round(f.center[0])},${Math.round(f.center[2])}`;
        const name = f.kind === 'pinnacle' && f.hoodoo ? 'Hoodoo pinnacle' : f.name || FEATURE_NAME[f.kind] || (f.kind[0].toUpperCase() + f.kind.slice(1).replace(/[-_]/g, ' '));
        make('feature:' + id, 'feature', f.kind, name, f.center, r, v.id);
      }
    }
    if (env.lookAt && v.state.look) {
      const l = v.state.look, d = [l[0] - p[0], l[1] - p[1], l[2] - p[2]], n = Math.hypot(d[0], d[1], d[2]) || 1;
      let hit = null; try { hit = env.lookAt(p, [d[0] / n, d[1] / n, d[2] / n], 10); } catch { hit = null; }
      if (hit && hit.name) {
        const dist = hit.dist || 3;
        make('creature:' + hit.name, 'creature', 'creature', hit.name, [p[0] + d[0] / n * dist, p[1] + d[1] / n * dist, p[2] + d[2] / n * dist], 1.6, v.id);
      }
    }
  }
  return out;
}

// ── the marks ───────────────────────────────────────────────────────────────
// view: minimap.js { cx, cz, k, w, h }. o: { colourOf(id), now (s), sel, hover, small }
// Returns the hits [{ id, x, y }] (view px).
export function drawDiscoveryMarks(ctx, list, view, o = {}) {
  const hits = [], now = o.now ?? nowS(), s = o.small ? 0.85 : 1;
  const colour = o.colourOf || (() => '#9ff0e6');
  ctx.save();
  for (const e of list) {
    const x = (e.p[0] - view.cx) * view.k + view.w / 2, y = (e.p[2] - view.cz) * view.k + view.h / 2;
    if (x < -12 || y < -12 || x > view.w + 12 || y > view.h + 12) continue;
    const c = colour(e.rov), on = e.id === o.sel || e.id === o.hover, R = (on ? 6.2 : 4.6) * s;
    const age = now - (e.at ?? -1e9);
    if (age >= 0 && age < PULSE) {
      const u = age / PULSE;
      ctx.globalAlpha = 0.85 * (1 - u); ctx.strokeStyle = c; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, R + 4 + u * 16, 0, TAU); ctx.stroke();
    }
    if (on) { ctx.globalAlpha = 0.35; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, R + 5, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.strokeStyle = 'rgba(2,7,12,0.92)'; ctx.lineWidth = 1.3;
    ctx.beginPath();
    if (e.cat === 'feature') { ctx.moveTo(x, y - R); ctx.lineTo(x + R, y); ctx.lineTo(x, y + R); ctx.lineTo(x - R, y); ctx.closePath(); }
    else if (e.cat === 'creature') { ctx.ellipse(x - R * 0.15, y, R * 0.8, R * 0.5, 0, 0, TAU); ctx.moveTo(x + R * 0.55, y); ctx.lineTo(x + R * 1.1, y - R * 0.55); ctx.lineTo(x + R * 1.1, y + R * 0.55); ctx.closePath(); }
    else ctx.arc(x, y, R * 0.62, 0, TAU);
    ctx.fill(); ctx.stroke();
    if (e.cat === 'coral') {
      ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 0.9; ctx.moveTo(x + Math.cos(a) * R * 0.6, y + Math.sin(a) * R * 0.6); ctx.lineTo(x + Math.cos(a) * R * 1.25, y + Math.sin(a) * R * 1.25); }
      ctx.stroke();
    }
    hits.push({ id: e.id, x, y });
  }
  ctx.restore();
  return hits;
}
export function pickMark(hits, px, py, r = PICK_R) {
  let best = null, bd = r;
  for (const h of hits || []) { const d = Math.hypot(h.x - px, h.y - py); if (d <= bd) { bd = d; best = h; } }
  return best;
}

// ── the camera frame ────────────────────────────────────────────────────────
// e: an entry; o: { fov (deg, vertical), eye [x, y, z] | null, clear(p) -> m | null,
// fill, maxDist }. The bounding sphere fills `fill` of the view height; the
// yaw is the first clear one from the eye side (12 tries); the pitch 0.5.
export function orbitFrame(e, o = {}) {
  const fill = o.fill ?? FILL, half = (o.fov ?? 50) * Math.PI / 360;
  const dist = clamp(e.r / Math.tan(half * fill), 2.5, o.maxDist ?? 110);
  const target = [e.p[0], e.p[1], e.p[2]], pitch = 0.5;
  let yaw0 = o.eye ? Math.atan2(o.eye[2] - target[2], o.eye[0] - target[0]) : 0.6;
  if (!Number.isFinite(yaw0)) yaw0 = 0.6;
  let yaw = yaw0;
  if (o.clear) {
    for (let k = 0; k < 12; k++) {
      const a = yaw0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 12), cp = Math.cos(pitch);
      let okk = true;
      for (let s = 0.35; s <= 1.001 && okk; s += 0.13) {
        const d = e.r * 1.05 + (dist - e.r * 1.05) * s;
        const m = o.clear([target[0] + Math.cos(a) * cp * d, target[1] + Math.sin(pitch) * d, target[2] + Math.sin(a) * cp * d]);
        if (m != null && m < 0.8) okk = false;
      }
      if (okk) { yaw = a; break; }
    }
  }
  return { target, dist, yaw, pitch };
}

// ── words ───────────────────────────────────────────────────────────────────
const article = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');
export function toastText(e, more = 0) {
  const n = e.name.toLowerCase();
  return `ROV ${e.rov} found ${article(n)} ${n}${more > 0 ? ` (+${more} more)` : ''}`;
}
export function agoText(s) {
  s = Math.max(0, s);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${(s / 3600).toFixed(1)} h ago`;
}

// ── the 3D highlight ────────────────────────────────────────────────────────
const RIM_VS = /* glsl */`
out vec3 vN;
out vec3 vV;
out float vY;
void main() {
  vec4 mv = (viewMatrix * modelMatrix) * vec4(position, 1.0);
  vN = normalize(mat3(viewMatrix * modelMatrix) * normal); vV = normalize(-mv.xyz); vY = position.y;
  gl_Position = projectionMatrix * mv;
}`;
const RIM_FS = /* glsl */`
uniform vec3 uC;
uniform float uA;
uniform float uT;
uniform float uR;
in vec3 vN;
in vec3 vV;
in float vY;
out vec4 oCol;
float sq(float x) { return x * x; }
void main() {
  float f = pow(max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vV)))), 2.6);
  float band = exp(-sq((fract(vY / (2.2 * uR) + 0.5 - uT * 0.09) - 0.5) * 9.0));
  float b = (0.42 + 0.08 * sin(uT * 1.7)) * f + 0.10 * band * f;
  oCol = vec4(uC * b * uA, 1.0);
}`;
const RING_VS = /* glsl */`
out vec2 vU;
void main() { vU = uv * 2.0 - 1.0; gl_Position = projectionMatrix * (viewMatrix * modelMatrix) * vec4(position, 1.0); }`;
const RING_FS = /* glsl */`
uniform vec3 uC;
uniform float uA;
uniform float uT;
in vec2 vU;
out vec4 oCol;
float sq(float x) { return x * x; }
void main() {
  float d = length(vU) * 1.3;
  float ring = exp(-sq((d - 1.0) / 0.035)) * 0.75;
  float rp = fract(uT * 0.22);
  float wave = exp(-sq((d - 0.25 - rp * 0.85) / 0.05)) * (1.0 - rp) * 0.45;
  float disc = 0.07 * (1.0 - smoothstep(0.2, 1.0, d));
  float b = (ring + wave + disc) * (1.0 - smoothstep(1.1, 1.28, d));
  oCol = vec4(uC * b * uA, 1.0);
}`;
const MOTE_VS = /* glsl */`
in vec3 aSeed;
uniform float uT;
uniform float uR;
uniform float uH;
uniform float uPx;
out float vA;
void main() {
  float h = fract(uT * 0.05 + aSeed.z);
  float a = aSeed.x * 6.2831853 + uT * 0.05 * (aSeed.y - 0.5);
  float rr = uR * (0.35 + 0.75 * aSeed.y);
  vec3 p = vec3(cos(a) * rr, h * uH, sin(a) * rr);
  vec4 mv = (viewMatrix * modelMatrix) * vec4(p, 1.0);
  vA = sin(3.14159 * h) * (0.5 + 0.5 * aSeed.y);
  gl_PointSize = clamp(uPx * 0.05 / max(-mv.z, 0.1), 1.5, 5.0);
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FS = /* glsl */`
uniform vec3 uC;
uniform float uA;
in float vA;
out vec4 oCol;
float sq(float x) { return x * x; }
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float m = exp(-dot(q, q) * 3.0);
  oCol = vec4(uC * m * vA * uA * 0.6, 1.0);
}`;
// the GLSL of the highlight (tests/discoveries.test.mjs checks it with naga)
export const HL_PROGRAMS = [{ name: 'rim', vs: RIM_VS, fs: RIM_FS }, { name: 'ring', vs: RING_VS, fs: RING_FS }, { name: 'motes', vs: MOTE_VS, fs: MOTE_FS }];
// the marine snow of the highlight: lib/marine-snow.js with the far box
// centred on the subject (uHlBox), the near box round the eye (bokeh), and
// one more light: the highlight light (uHlL place and range, uHlLC colour).
export const HL_SNOW_LIGHT = /* glsl */`
uniform vec3 uHlBox;
uniform vec4 uHlL;
uniform vec3 uHlLC;
${MS_LIGHT_SPOTS.replace('vec3 msLight(', 'vec3 msLightSpots(')}
vec3 msLight(vec3 p, vec3 V) {
  vec3 d = uHlL.xyz - p;
  float dist = max(length(d), 0.05);
  vec3 L = d / dist;
  float att = 1.0 / (1.0 + dist * dist / (uHlL.w * uHlL.w));
  return msLightSpots(p, V) + uHlLC * (att * msPhase(dot(-L, V)));
}
`;
export function highlightSnowVS() {
  let vs = marineSnowVS(HL_SNOW_LIGHT);
  const a = 'vec3 base = cameraPosition - 0.5 * B;', b = 'fadeR, dist))';
  if (!vs.includes(a) || !vs.includes(b)) throw new Error('marine-snow.js changed: the highlight snow box cannot be placed');
  vs = vs.replace(a, 'vec3 base = (nearL ? cameraPosition : uHlBox) - 0.5 * B;').replace(b, 'fadeR, nearL ? dist : length(q - uHlBox)))');
  return vs;
}

// THREE: the three module; o: { scene, atlas (lib/marine-snow.js), ext,
// snowCount, phone }. Points in render space (world - origin).
export function createHighlight(THREE, o = {}) {
  const grp = new THREE.Group(); grp.name = 'discovery-highlight'; grp.visible = false;
  const col = new THREE.Color('#9ff0e6');
  const add = { glslVersion: THREE.GLSL3, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const U0 = () => ({ uC: { value: col }, uA: { value: 0 }, uT: { value: 0 }, uR: { value: 1 } });
  const rimU = U0(), ringU = U0(), moteU = Object.assign(U0(), { uH: { value: 3 }, uPx: { value: 900 } });
  const rim = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), new THREE.ShaderMaterial({ vertexShader: RIM_VS, fragmentShader: RIM_FS, uniforms: rimU, ...add }));
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: ringU, ...add, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  const NM = o.phone ? 16 : 28, seeds = new Float32Array(NM * 3);
  for (let i = 0; i < NM * 3; i++) seeds[i] = ((Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1 + 1) % 1;
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NM * 3), 3));
  mg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const motes = new THREE.Points(mg, new THREE.ShaderMaterial({ vertexShader: MOTE_VS, fragmentShader: MOTE_FS, uniforms: moteU, ...add }));
  for (const m of [rim, ring, motes]) { m.frustumCulled = false; m.renderOrder = 9; }
  const base = new THREE.Group(); base.add(ring, motes);
  grp.add(rim, base);
  // the local snow: a few hundred flakes
  let snow = null;
  try {
    snow = createMarineSnow(THREE, {
      count: o.snowCount ?? (o.phone ? 220 : 480), atlas: o.atlas, atlasSize: 128, seed: 7, nearShare: 0.15,
      box: 8, nearBox: 3, maxPx: o.phone ? 12 : 20, gain: 0, ext: o.ext,
      vertexShader: highlightSnowVS(), fragmentShader: MARINE_SNOW_FS,
      uniforms: { uHlBox: { value: new THREE.Vector3() }, uHlL: { value: new THREE.Vector4(0, 0, 0, 4) }, uHlLC: { value: new THREE.Vector3() } },
    });
    snow.mesh.renderOrder = 11;
    snow.setDepth(400);
    grp.add(snow.mesh);
  } catch (err) { console.warn('coral-reef: no highlight snow', err); snow = null; }
  if (o.scene) o.scene.add(grp);
  const H = { entry: null, alpha: 0, want: 0, t: 0, group: grp, snow, rim, ring, motes, light: [0, 0, 0] };
  H.attach = (e, colour) => {
    H.entry = e; H.want = 1; H.alpha = 0; grp.visible = true;
    col.set(colour || '#9ff0e6').lerp(new THREE.Color('#d8fffa'), 0.35);
    const R = e.r * 1.12;
    rim.scale.setScalar(R); rimU.uR.value = 1;
    const rr = Math.max(1.6, e.r * 1.35);
    ring.scale.setScalar(rr * 1.3); moteU.uR.value = rr; moteU.uH.value = Math.max(2.5, e.p[1] - e.ground + e.r * 1.4);
    if (snow) { const B = clamp(e.r * 3, 5, 14); snow.uniforms.uMsBox.value.set(B, B, B, 3); snow.uniforms.uHlL.value.w = Math.max(3, e.r * 2); }
  };
  H.clear = () => { H.want = 0; };
  // dt s, t s, origin [ox, oz], o2: { lamps, current [x, y, z], focus, camera }
  H.update = (dt, t, origin, o2 = {}) => {
    const e = H.entry;
    H.alpha += (H.want - H.alpha) * (1 - Math.exp(-dt * (H.want ? 1.6 : 3)));
    if (!H.want && H.alpha < 0.01) { H.alpha = 0; grp.visible = false; if (e) H.entry = null; return; }
    if (!e) return;
    const ox = origin[0], oz = origin[1], a = H.alpha;
    rim.position.set(e.p[0] - ox, e.p[1], e.p[2] - oz);
    base.position.set(e.p[0] - ox, e.ground + 0.15, e.p[2] - oz);
    for (const U of [rimU, ringU, moteU]) { U.uA.value = a; U.uT.value = t; }
    moteU.uPx.value = o2.px || 900;
    H.light = [e.p[0] - ox, e.p[1] + e.r * 0.6, e.p[2] - oz];
    if (snow) {
      snow.uniforms.uHlBox.value.set(e.p[0] - ox, e.p[1], e.p[2] - oz);
      snow.uniforms.uHlL.value.set(H.light[0], H.light[1], H.light[2], snow.uniforms.uHlL.value.w);
      snow.uniforms.uHlLC.value.set(col.r * 0.9 * a, col.g * 0.9 * a, col.b * 0.9 * a);
      snow.setOrigin(ox, 0, oz);
      if (o2.current) snow.setCurrent(o2.current[0], o2.current[1], o2.current[2]);
      if (o2.lamps) snow.setSpots(o2.lamps);
      if (o2.focus) snow.setFocus(o2.focus);
      snow.setGain(3.2 * a);
      snow.update(o2.camera || null, t);
    }
  };
  H.dispose = () => {
    if (o.scene) o.scene.remove(grp);
    for (const m of [rim, ring, motes]) { m.geometry.dispose(); m.material.dispose(); }
    if (snow) { snow.geometry.dispose(); for (const m of snow.meshes) m.material.dispose(); }
  };
  return H;
}

// ── the DOM part ────────────────────────────────────────────────────────────
// o: { doc, win, THREE?, scene?, snowAtlas?, ext?, getSquad, env (scanSquad),
//      colourOf(id), getCam() (camera.js), camera() (three camera), origin(),
//      lamps(), current(), flyTo(frame, e), onClear(), isSaver(), phoneQ,
//      mapOpen(), closeMap(), mmView(), inspect(e) -> id, release(id),
//      keyLight(K | null) }
export function mountDiscoveries(o) {
  const doc = o.doc, win = o.win || doc.defaultView;
  const log = o.log || createDiscoveryLog();
  const touchUI = () => !!(win.matchMedia && win.matchMedia('(pointer:coarse)').matches);
  const D = { scanT: 0, hover: null, sel: null, hits: { mini: [], big: [] }, toastAt: -1e9, waiting: [], toasts: [], flights: [], selAt: 0, tapId: null };
  const mk = (cls, id) => { const e = doc.createElement('div'); e.className = cls; if (id) e.id = id; return e; };
  const card = mk('dsc-card', 'dscCard'); card.hidden = true; card.setAttribute('role', 'tooltip');
  const toast = mk('dsc-toast', 'dscToast'); toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  const label = mk('dsc-label', 'dscLabel'); label.hidden = true; label.setAttribute('aria-hidden', 'true');
  doc.body.append(card, label);
  (doc.getElementById('minimap') || doc.body).appendChild(toast);
  if (!doc.getElementById('minimap')) toast.classList.add('free');
  let HL = null;
  if (o.THREE && o.scene) { try { HL = createHighlight(o.THREE, { scene: o.scene, atlas: o.snowAtlas, ext: o.ext, phone: !!(o.phoneQ && o.phoneQ.matches) }); } catch (err) { console.warn('coral-reef: no highlight', err); HL = null; } }
  const colour = id => (o.colourOf ? o.colourOf(id) : '#9ff0e6');

  log.onAdd(e => { D.waiting.push(e); });
  function stepToast(now) {
    if (!D.waiting.length || now - D.toastAt < TOAST_GAP) return;
    const e = D.waiting[D.waiting.length - 1], more = D.waiting.length - 1;
    D.waiting.length = 0; D.toastAt = now;
    toast.textContent = toastText(e, more); toast.style.setProperty('--c', colour(e.rov));
    toast.classList.remove('on'); void toast.offsetWidth; toast.classList.add('on');
    D.toasts.push({ id: e.id, text: toast.textContent, at: now });
    clearTimeout(D.toastT); D.toastT = setTimeout(() => toast.classList.remove('on'), 3200);
  }

  // the card
  function showCard(e, cx, cy, withBtn) {
    const age = nowS() - (e.at ?? nowS());
    card.innerHTML = '';
    const b = doc.createElement('b'); b.textContent = e.name;
    const k = doc.createElement('span'); k.className = 'dsc-kind'; k.textContent = e.cat === 'feature' ? `${CAT_TEXT.feature} · ${e.kind}` : e.cat === 'coral' ? `${CAT_TEXT.coral} · ${(e.r * 2).toFixed(1)} m` : CAT_TEXT.creature;
    const m = doc.createElement('span'); m.className = 'dsc-meta'; m.textContent = `${e.depth} m deep${e.region ? ' · ' + e.region : ''}`;
    const f = doc.createElement('span'); f.className = 'dsc-by'; f.textContent = `Found by ROV ${e.rov} · ${agoText(age)}`;
    card.append(b, k, m, f);
    if (withBtn) {
      const go = doc.createElement('button'); go.type = 'button'; go.className = 'dsc-go'; go.textContent = 'Orbit';
      go.addEventListener('click', ev => { ev.stopPropagation(); select(e.id); });
      card.append(go);
    } else { const h = doc.createElement('span'); h.className = 'dsc-hint'; h.textContent = 'Click to orbit'; card.append(h); }
    card.style.setProperty('--c', colour(e.rov));
    card.hidden = false; card.dataset.id = e.id;
    const W = win.innerWidth || 1280, Hh = win.innerHeight || 800, cw = 230, ch = 120;
    card.style.left = `${clamp(cx + 14, 8, W - cw - 8)}px`;
    card.style.top = `${clamp(cy - ch - 10, 8, Hh - ch - 8)}px`;
  }
  function hideCard() { card.hidden = true; delete card.dataset.id; }

  // the maps: draw, hover, click (key 'mini' or 'big'; px in view px)
  const marks = {
    draw(ctx, view, key = 'mini') { D.hits[key] = drawDiscoveryMarks(ctx, log.list(), view, { colourOf: colour, sel: D.sel, hover: D.hover, small: key === 'mini' }); return D.hits[key]; },
    hit(key, px, py) { const h = pickMark(D.hits[key], px, py); return h ? log.get(h.id) : null; },
    hover(key, px, py, cx, cy) {
      const e = marks.hit(key, px, py);
      const id = e ? e.id : null;
      if (id !== D.hover) { D.hover = id; D.dirty = true; }
      if (e) showCard(e, cx, cy, false); else if (!D.tapId) hideCard();
      return !!e;
    },
    // a click or a tap; touch: the first tap shows the card
    click(key, px, py, cx, cy, touch) {
      const e = marks.hit(key, px, py);
      if (!e) { if (D.tapId) { D.tapId = null; hideCard(); } return false; }
      if (touch && D.tapId !== e.id) { D.tapId = e.id; showCard(e, cx, cy, true); return true; }
      select(e.id); return true;
    },
    leave() { if (D.hover) { D.hover = null; D.dirty = true; } if (!D.tapId) hideCard(); },
    animating: () => log.list().some(e => nowS() - (e.at ?? -1e9) < PULSE) || !!D.dirty,
    get list() { return log.list(); },
  };

  // the minimap: listeners on the box in the capture phase, so a mark
  // hit stops the "open the large map" click of squad-hud.js
  const box = doc.getElementById('minimap'), mmc = doc.getElementById('mmCanvas');
  if (box && mmc) {
    const local = ev => { const r = mmc.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    const onMm = ev => ev.target === mmc;
    let downOn = null;
    box.addEventListener('pointermove', ev => { if (!onMm(ev) || ev.pointerType === 'touch') return; const p = local(ev); const on = marks.hover('mini', p[0], p[1], ev.clientX, ev.clientY); mmc.style.cursor = on ? 'pointer' : 'zoom-in'; }, true);
    box.addEventListener('pointerleave', () => marks.leave());
    box.addEventListener('pointerdown', ev => { if (!onMm(ev)) return; const p = local(ev); downOn = marks.hit('mini', p[0], p[1]) ? p : null; if (downOn) ev.stopImmediatePropagation(); }, true);
    box.addEventListener('pointerup', ev => {
      if (!onMm(ev) || !downOn) return;
      const p = local(ev); downOn = null;
      if (marks.click('mini', p[0], p[1], ev.clientX, ev.clientY, ev.pointerType === 'touch' || touchUI())) { ev.stopImmediatePropagation(); ev.preventDefault(); }
    }, true);
  }
  doc.addEventListener('pointerdown', ev => { if (D.tapId && !card.contains(ev.target) && ev.target !== mmc) { D.tapId = null; hideCard(); } }, true);

  // select: fly into the orbit and light it up
  function select(id) {
    const e = log.get(id); if (!e) return false;
    if (o.mapOpen && o.mapOpen() && o.closeMap) o.closeMap();
    D.tapId = null; hideCard();
    const cam = o.getCam ? o.getCam() : null, tc = o.camera ? o.camera() : null;
    const fr = orbitFrame(e, { fov: tc && tc.fov ? tc.fov : 50, eye: cam ? cam.eye : null, clear: o.clear || null, maxDist: o.maxDist });
    D.flights.push({ id, frame: fr });
    if (o.flyTo) o.flyTo(fr, e);
    D.sel = id; D.selAt = nowS(); D.frame = fr; D.dirty = true;
    if (HL) HL.attach(e, colour(e.rov));
    if (o.release && D.inspector != null) o.release(D.inspector);
    D.inspector = o.inspect ? o.inspect(e) : null;
    label.textContent = ''; const lb = doc.createElement('b'); lb.textContent = e.name; const ls = doc.createElement('span'); ls.textContent = `ROV ${e.rov} · ${e.depth} m`;
    label.append(lb, ls); label.style.setProperty('--c', colour(e.rov));
    return true;
  }
  function clear(why = 'clear') {
    if (!D.sel) return false;
    D.sel = null; D.dirty = true; D.cleared = why;
    if (HL) HL.clear();
    if (o.release && D.inspector != null) o.release(D.inspector);
    D.inspector = null;
    label.hidden = true;
    if (o.onClear) o.onClear(why);
    return true;
  }
  win.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (D.tapId || !card.hidden) { D.tapId = null; hideCard(); }
    if (clear('esc')) ev.preventDefault();
  });

  // each frame
  const v3 = o.THREE ? new o.THREE.Vector3() : null;
  function tick(dt, t3) {
    const now = nowS();
    if ((D.scanT += dt) >= SCAN_EVERY && !(o.isSaver && o.isSaver())) {
      D.scanT = 0;
      const sq = o.getSquad ? o.getSquad() : null;
      if (sq) scanSquad(log, sq, o.env || {}, sq.stats ? sq.stats.t || 0 : 0);
    }
    stepToast(now);
    // the camera left: a grace time for the glide or the far move
    if (D.sel) {
      const cam = o.getCam ? o.getCam() : null, e = log.get(D.sel);
      if (!e) clear('gone');
      else if (cam && now - D.selAt > 2.5) {
        const tg = cam.orbit ? cam.orbit.target : cam.look;
        const away = cam.mode !== 'orbit' || !tg || Math.hypot(tg[0] - e.p[0], tg[1] - e.p[1], tg[2] - e.p[2]) > Math.max(6, e.r * 3);
        if (away) clear('left');
      }
    }
    if (HL) {
      const og = o.origin ? o.origin() : [0, 0], tc = o.camera ? o.camera() : null;
      HL.update(dt, t3 ?? now, og, { lamps: o.lamps ? o.lamps() : null, current: o.current ? o.current() : null, focus: D.frame ? D.frame.dist : null, camera: tc, px: (win.innerHeight || 800) * 1.2 });
    }
    // the inspection key light: on while the highlight shows, off after
    if (o.keyLight) {
      const he = HL ? HL.entry : D.sel ? log.get(D.sel) : null, ha = HL ? HL.alpha : D.sel ? 1 : 0, cc = o.camera ? o.camera() : null;
      if (he && ha > 0.004 && cc && cc.position) {
        const og = o.origin ? o.origin() : [0, 0], fk = o.ext && o.ext.value ? [o.ext.value.x, o.ext.value.y, o.ext.value.z] : undefined;
        D.key = keyFrame([cc.position.x, cc.position.y, cc.position.z], [he.p[0] - og[0], he.p[1], he.p[2] - og[1]], he.r || 1, ha, fk);
        o.keyLight(D.key);
      } else if (D.key) { D.key = null; o.keyLight(null); }
    }
    // the floating label
    const e = D.sel ? log.get(D.sel) : null, tc = o.camera ? o.camera() : null;
    if (e && tc && v3 && !(o.mapOpen && o.mapOpen())) {
      const og = o.origin ? o.origin() : [0, 0];
      v3.set(e.p[0] - og[0], e.p[1] + e.r * 1.25 + 0.4, e.p[2] - og[1]).project(tc);
      const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
      label.hidden = !vis;
      if (vis) { label.style.left = `${(v3.x * 0.5 + 0.5) * (win.innerWidth || 1)}px`; label.style.top = `${(0.5 - v3.y * 0.5) * (win.innerHeight || 1)}px`; label.style.opacity = String(HL ? clamp(HL.alpha * 1.2, 0, 1) : 1); }
    } else if (!e) label.hidden = true;
    const d = D.dirty; D.dirty = false;
    return d;
  }

  return {
    log, marks, select, clear, tick, highlight: HL,
    get selected() { return D.sel; },
    debug: () => ({ size: log.size, sel: D.sel, key: D.key || null, inspector: D.inspector ?? null, hover: D.hover, card: card.hidden ? null : card.dataset.id, toasts: D.toasts.slice(), waiting: D.waiting.length, flights: D.flights.slice(), cleared: D.cleared || null, hl: HL ? { alpha: HL.alpha, want: HL.want, visible: HL.group.visible, entry: HL.entry && HL.entry.id } : null, hits: { mini: D.hits.mini.length, big: D.hits.big.length } }),
    dispose() { if (HL) HL.dispose(); card.remove(); toast.remove(); label.remove(); },
  };
}
