// ============================================================================
//  ARTICRAFT PLAYGROUND  ·  sim.js — scene wrap, object load, modes, props,
//  joint drive. No DOM: the same file runs in the browser and in node.
// ----------------------------------------------------------------------------
//  The objects come from lane A (CONTRACT.md "Data layout"). One object is
//  one MJCF file (model.xml) and its binary STL meshes. This module puts the
//  object in a scene (floor, lights, props), adds the free joint for Loose
//  mode, compiles the scene with the MuJoCo Lab core (createSim) and drives
//  the position actuators of the object.
//
//  Anchored mode: the root body has no joint, so MuJoCo welds it to the
//  world. Loose mode: sceneXML puts <freejoint name="root_free"/> in the root
//  body, so the object can fall, slide and turn over.
//
//  Collision bits: object geoms contype 1 conaffinity 2 (lane A), the floor
//  contype 2 conaffinity 1, props contype 3 conaffinity 3. Thus the parts of
//  one object do not collide with each other, and the props touch all.
//
//  API (lane C and main.js use it)
//    sceneXML(objectXML, { loose, props, extent, lift }) -> MJCF string
//                                     (Anchored: root body 2 mm above the floor)
//    loadManifest({ get })            data/manifest.json, else the fixture
//    fetchObject(entry, { get })      -> { xml, files } (cached for each object)
//    loadObject(mj, entry, { get, loose, props }) -> S (createSim sim)
//                                     S.joints = entry.joints, S.targets,
//                                     S.loose, S.entry.camera, S.jointValue(n)
//    setTargets(S, { joint: value })  position actuator targets, clamped
//    poseAt(entry, phase)             smooth periodic pose, phase in [0, 1)
//    randomPose(entry, rand)          a pose inside 10..90 % of each range
//    restPose(entry)                  0 clamped into each range
//    drop(S, { rand, height })        Loose only: lift, tilt, release
//    jointRange(j)                    [lo, hi] for a manifest joint
//
//  GREP MAP
//    export async function defaultGet  fetch (browser) or fs (node)
//    export function propsXML ......... ball and blocks around the object
//    export function sceneXML ......... the scene wrap
//    export async function loadManifest
//    export async function fetchObject
//    export async function loadObject
//    export function setTargets / poseAt / randomPose / restPose / drop
// ============================================================================
import { createSim } from '../mujoco-lab/core/engine.js';

export const DATA = 'data/';
export const FIXTURE = 'data/fixture/';
export const PAPER = { title: 'Articraft: An Agentic System for Scalable Articulated 3D Asset Generation', authors: 'Zhou et al. 2026', arxiv: 'https://arxiv.org/abs/2605.15187', site: 'https://articraft3d.github.io/' };
export const DEFAULT_PROPS = ['ball', 'block', 'block', 'block'];

const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);
const HERE = new URL('./', import.meta.url);

// path relative to this folder (string) or a URL; kind 'text' | 'buf' | 'json'
export async function defaultGet(path, kind) {
  const url = path instanceof URL ? path : new URL(path, HERE);
  if (isNode && url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    const b = await readFile(url);
    if (kind === 'buf') return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    const t = b.toString('utf8');
    return kind === 'json' ? JSON.parse(t) : t;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  // never size a buffer from content-length (the site gzips): read the body
  if (kind === 'buf') return new Uint8Array(await r.arrayBuffer());
  return kind === 'json' ? r.json() : r.text();
}

export function jointRange(j) {
  const r = j && j.range;
  if (Array.isArray(r) && r.length === 2 && isFinite(r[0]) && isFinite(r[1]) && r[1] > r[0]) return [r[0], r[1]];
  return j && j.type === 'slide' ? [-0.1, 0.1] : [-Math.PI, Math.PI];
}
// joints that a scalar position actuator can drive (a ball joint cannot)
const driven = entry => (entry.joints || []).filter(j => j.type !== 'ball' && j.act !== null);
const f4 = x => +x.toFixed(4);

// props: 'ball' | 'block' | { type, size, pos }. The default ring sits just
// outside the bounding sphere of the object, on the floor.
export function propsXML(props = [], extent = 0.3) {
  const e = Math.max(0.05, extent || 0.3);
  const s = Math.min(0.12, Math.max(0.02, e * 0.13));
  let out = '';
  props.forEach((p, i) => {
    const q = typeof p === 'string' ? { type: p } : p;
    const size = q.size || (q.type === 'ball' ? s : s * 0.85);
    const a = 0.6 + i * 2 * Math.PI / Math.max(3, props.length), r = e * 1.15 + size * 1.5;
    const pos = q.pos || [r * Math.cos(a), r * Math.sin(a), size + 0.002];
    const col = q.type === 'ball' ? '0.86 0.24 0.3 1' : ['0.25 0.55 0.85 1', '0.95 0.78 0.25 1', '0.35 0.75 0.45 1'][i % 3];
    const geom = q.type === 'ball'
      ? `<geom type="sphere" size="${f4(size)}" density="300" rgba="${col}" contype="3" conaffinity="3" condim="6" friction="0.8 0.02 0.002"/>`
      : `<geom type="box" size="${f4(size)} ${f4(size)} ${f4(size)}" density="300" rgba="${col}" contype="3" conaffinity="3"/>`;
    out += `\n    <body name="prop_${i}" pos="${pos.map(f4).join(' ')}"><freejoint name="prop_${i}_free"/>${geom}</body>`;
  });
  return out;
}

const SCENE = `
    <light name="key" directional="true" pos="1 -1 3" dir="-0.3 0.3 -1" diffuse="0.8 0.8 0.8"/>
    <light name="fill" directional="true" pos="-1 1 2" dir="0.3 -0.3 -1" diffuse="0.3 0.3 0.3" castshadow="false"/>
    <geom name="floor" type="plane" size="0 0 0.05" rgba="0.3 0.32 0.36 1" contype="2" conaffinity="1"/>`;

// Anchored mode lifts the root body by `lift` (2 mm). Lane A puts the
// lowest vertex at z = 0, so without the gap wheels and feet touch the floor,
// and floor friction locks their joints while the root cannot move.
export function sceneXML(objectXML, { loose = false, props = [], extent = 0.3, lift = loose ? 0 : 0.002 } = {}) {
  let xml = String(objectXML);
  const roots = xml.match(/<body name="root"/g) || [];
  if (roots.length !== 1) throw new Error(`sceneXML: the object needs one <body name="root" (found ${roots.length})`);
  const end = xml.lastIndexOf('</worldbody>');
  if (end < 0) throw new Error('sceneXML: no </worldbody>');
  xml = xml.slice(0, end) + SCENE + propsXML(props, extent) + '\n  ' + xml.slice(end);
  if (lift) {
    xml = xml.replace(/<body name="root"([^>]*?)(\/?)>/, (all, attrs, self) => {
      const m = attrs.match(/\spos="([^"]*)"/), p = m ? m[1].trim().split(/\s+/).map(Number) : [0, 0, 0];
      p[2] = f4((p[2] || 0) + lift);
      const a = m ? attrs.replace(m[0], ` pos="${p.join(' ')}"`) : `${attrs} pos="${p.join(' ')}"`;
      return `<body name="root"${a}${self}>`;
    });
  }
  if (loose) {
    xml = xml.replace(/<body name="root"([^>]*?)(\/?)>/, (all, attrs, self) =>
      self ? `<body name="root"${attrs}><freejoint name="root_free"/></body>` : `<body name="root"${attrs}><freejoint name="root_free"/>`);
  }
  return xml;
}

function xmlAssets(xml) {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '');
  const dir = (body.match(/<compiler[^>]*\bmeshdir="([^"]*)"/) || [])[1] || '';
  const files = new Set();
  for (const m of body.matchAll(/<(?:mesh|hfield|skin|texture)\b[^>]*\bfile="([^"]+)"/g)) files.add(m[1]);
  return { dir: dir && !dir.endsWith('/') ? dir + '/' : dir, files: [...files] };
}

// data/manifest.json when lane A has written it, else the fixture
export async function loadManifest({ get = defaultGet } = {}) {
  let man = null, base = DATA;
  try { man = await get(DATA + 'manifest.json', 'json'); } catch (e) { man = null; }
  if (!man || !Array.isArray(man.objects) || !man.objects.length) { base = FIXTURE; man = await get(FIXTURE + 'manifest.json', 'json'); }
  man.base = base;
  for (const o of man.objects) o.base = o.base || base;
  return man;
}

const cache = new Map();
export function objectDir(entry) { return (entry.base || DATA) + 'objects/' + entry.slug + '/'; }
export async function fetchObject(entry, { get = defaultGet } = {}) {
  const key = objectDir(entry);
  if (!cache.has(key)) {
    const p = (async () => {
      const xml = await get(key + 'model.xml', 'text');
      const { dir, files } = xmlAssets(xml), out = {};
      await Promise.all(files.map(async f => { out[dir + f] = await get(key + dir + f, 'buf'); }));
      return { xml, files: out };
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return cache.get(key);
}
export function clearCache() { cache.clear(); }

export async function loadObject(mj, entry, { get = defaultGet, loose = false, props = [] } = {}) {
  const { xml, files } = await fetchObject(entry, { get });
  const S = createSim(mj, { xml: sceneXML(xml, { loose, props, extent: entry.extent }), files, name: entry.slug });
  S.joints = entry.joints || [];
  S.loose = !!loose;
  S.props = props.slice();
  S.targets = {};
  const jid = name => S.jointNames.indexOf(name);
  S.jointValue = name => { const i = jid(name); return i < 0 ? NaN : S.d.qpos[S.m.jnt_qposadr[i]]; };
  S.rootBody = S.bodyNames.indexOf('root');
  // camera: look at the subtree centre of mass of the object
  const e = Math.max(0.05, entry.extent || 0.3), rb = Math.max(1, S.rootBody), c = S.d.subtree_com;
  S.entry = { ...entry, camera: { azimuth: 135, elevation: -20, distance: Math.max(0.35, 2.6 * e), lookat: [f4(c[3 * rb]), f4(c[3 * rb + 1]), f4(Math.max(c[3 * rb + 2], 0.35 * e))] } };
  setTargets(S, restPose(entry));
  S.restart = () => { S.reset(); setTargets(S, S.targets); return S; };
  return S;
}

export function setTargets(S, values = {}) {
  for (const name in values) {
    const j = S.joints.find(x => x.name === name);
    if (!j || j.type === 'ball') continue;
    const i = S.actuatorNames.indexOf(j.act || 'a_' + name);
    if (i < 0) continue;
    const [lo, hi] = jointRange(j), v = Math.min(hi, Math.max(lo, +values[name]));
    if (!isFinite(v)) continue;
    S.setCtrl(i, v);
    S.targets[name] = v;
  }
  return S.targets;
}

export function restPose(entry) {
  const out = {};
  for (const j of driven(entry)) { const [lo, hi] = jointRange(j); out[j.name] = Math.min(hi, Math.max(lo, 0)); }
  return out;
}

// Each joint swings in 8 to 92 % of its range: a sine with 1 or 2 periods
// in each loop and a phase offset for each joint, so phase 0 and phase 1
// give the same pose and the motion has no step.
export function poseAt(entry, phase) {
  const out = {}, p = ((phase % 1) + 1) % 1;
  driven(entry).forEach((j, i) => {
    const [lo, hi] = jointRange(j), mid = (lo + hi) / 2, amp = 0.42 * (hi - lo);
    out[j.name] = mid + amp * Math.sin(2 * Math.PI * ((1 + (i % 2)) * p + i * 0.618));
  });
  return out;
}

export function randomPose(entry, rand = Math.random) {
  const out = {};
  for (const j of driven(entry)) { const [lo, hi] = jointRange(j); out[j.name] = lo + (0.1 + 0.8 * rand()) * (hi - lo); }
  return out;
}

// Loose mode only: lift the object, tilt it a little and let it fall.
export function drop(S, { rand = Math.random, height } = {}) {
  if (!S.loose) return false;
  const j = S.jointNames.indexOf('root_free');
  if (j < 0) return false;
  const m = S.m, d = S.d, qa = m.jnt_qposadr[j], va = m.jnt_dofadr[j];
  const e = Math.max(0.05, (S.entry && S.entry.extent) || 0.3);
  const h = height != null ? height : 0.6 * e + 0.15;
  d.qpos[qa] = m.qpos0[qa] + (rand() - 0.5) * 0.2 * e;
  d.qpos[qa + 1] = m.qpos0[qa + 1] + (rand() - 0.5) * 0.2 * e;
  d.qpos[qa + 2] = m.qpos0[qa + 2] + h;
  // tilt: a random axis in the xy plane, 0.15 .. 0.6 rad
  const th = 0.15 + 0.45 * rand(), az = 2 * Math.PI * rand(), s = Math.sin(th / 2);
  const q0 = [m.qpos0[qa + 3], m.qpos0[qa + 4], m.qpos0[qa + 5], m.qpos0[qa + 6]], t = [Math.cos(th / 2), s * Math.cos(az), s * Math.sin(az), 0];
  const q = [
    t[0] * q0[0] - t[1] * q0[1] - t[2] * q0[2] - t[3] * q0[3],
    t[0] * q0[1] + t[1] * q0[0] + t[2] * q0[3] - t[3] * q0[2],
    t[0] * q0[2] - t[1] * q0[3] + t[2] * q0[0] + t[3] * q0[1],
    t[0] * q0[3] + t[1] * q0[2] - t[2] * q0[1] + t[3] * q0[0],
  ];
  for (let k = 0; k < 4; k++) d.qpos[qa + 3 + k] = q[k];
  for (let k = 0; k < 6; k++) d.qvel[va + k] = 0;
  S.forward();
  return true;
}
