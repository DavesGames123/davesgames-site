// ============================================================================
//  MUJOCO LAB  ·  core/models.js — the model library
// ----------------------------------------------------------------------------
//  Each entry has a key, a name, a short text, a group, a default camera,
//  its source and licence, and how to load it. core/CREDITS.md has the
//  commits and the licence of each file. Thumbnails: thumbs/<key>.jpg (the
//  page agents add them; `thumb` is the path). `heavy: true` marks a model
//  that can run slower than real time on a phone (see CONTRACT.md step times).
//
//  GREP MAP
//    const MJ / LAB / MEN / UNI ..... source records
//    export const MODELS ............ the library, in menu order
//    export const GROUPS ............ group names in menu order
//    export function modelByKey ..... lookup
//    export function defaultGet ..... file reader: fetch (browser) or fs (node)
//    export async function modelFiles  entry -> { xml, files } for createSim
//    export async function loadModel . entry or key -> sim (createSim + start state)
//    function xmlRefs ............... file="" references and meshdir/assetdir
// ============================================================================
import { createSim } from './engine.js';
import { chainXML, generate } from './procedural.js';

const MJ_URL = 'https://github.com/google-deepmind/mujoco/tree/3.15.0/model/';
const MJ = (path, note) => ({ name: 'MuJoCo model folder', url: MJ_URL + path, commit: '3.15.0 (9ea3cdfcae93bf2cc4dc0e1a1627c5a39a1e06e5)', licence: 'Apache-2.0', copyright: 'DeepMind Technologies Limited', note });
const LAB = note => ({ name: 'MuJoCo Lab (this site)', url: '', commit: '', licence: 'Apache-2.0 (same terms as MuJoCo)', copyright: 'MuJoCo Lab', note });
const MEN_URL = 'https://github.com/google-deepmind/mujoco_menagerie/tree/0059d4335f8156206f63a35662313385f7ad6d74/';
const MEN = (dir, licence, copyright) => ({ name: 'MuJoCo Menagerie', url: MEN_URL + dir, commit: '0059d4335f8156206f63a35662313385f7ad6d74', licence, copyright, licenceFile: `models/menagerie/${dir}/LICENSE`, note: 'Visual meshes decimated to binary STL (*.dec.stl); collision meshes unchanged. See CREDITS.md.' });
const UNI = (path) => ({ name: 'Unitree (via the vendored unitree_rl_gym files of the Legged Robot Gym page)', url: path, commit: 'see vendor/unitree_rl_gym/CREDITS.md', licence: 'BSD-3-Clause', copyright: 'Unitree Robotics', licenceFile: '../../../vendor/unitree_rl_gym/LICENSE', note: 'Meshes are the convex hulls of the upstream meshes (collide.bin).' });

const cam = (azimuth, elevation, distance, lookat) => ({ azimuth, elevation, distance, lookat });

export const GROUPS = ['Mechanisms', 'Contact and stacking', 'Soft and flexible', 'Creatures', 'Robots'];

export const MODELS = [
  // ── mechanisms
  { key: 'double-pendulum', group: 'Mechanisms', name: 'Double pendulum', blurb: 'Two rods on hinges, no friction and no contacts. The total energy must stay constant, so this model shows how well each integrator keeps it.',
    source: LAB(), camera: cam(90, -5, 3.4, [0, 0, 1.2]), load: { dir: 'models/lab/', main: 'double_pendulum.xml' } },
  { key: 'cartpole', group: 'Mechanisms', name: 'Cart-pole', blurb: 'A pole on a cart, the standard control problem. One motor pushes the cart; the pole starts near upright and falls if nothing holds it.',
    source: LAB(), camera: cam(90, -8, 4, [0, 0, 1]), start: { key: 'near upright' }, load: { dir: 'models/lab/', main: 'cartpole.xml' } },
  { key: 'newtons-cradle', group: 'Mechanisms', name: "Newton's cradle", blurb: 'Steel balls on string tendons with elastic contacts (solref with zero damping). Momentum passes along the row.',
    source: MJ('replicate/newton_cradle.xml'), camera: cam(90, -10, 0.7, [0, 0, 0.1]), load: { dir: 'models/mujoco/replicate/', main: 'newton_cradle.xml' } },
  { key: 'slider-crank', group: 'Mechanisms', name: 'Slider-crank', blurb: 'A crank, a rod and a slider closed into a loop by an equality constraint, driven by a motor.',
    source: MJ('slider_crank/slider_crank.xml'), camera: cam(90, -15, 1.4, [0, 0, 0.3]), load: { dir: 'models/mujoco/slider_crank/', main: 'slider_crank.xml' } },
  { key: 'gears', group: 'Mechanisms', name: 'Gear train', blurb: 'Joint equality constraints act as gears (ratio 2:1, then 1:1) and a connect constraint closes a crank and slider.',
    source: LAB(), camera: cam(90, -5, 2.4, [0, 0, 0.7]), load: { dir: 'models/lab/', main: 'gears.xml' } },
  { key: 'tippe-top', group: 'Mechanisms', name: 'Tippe top', blurb: 'A top with a low centre of mass, spun fast. Friction at the contact turns it over onto its stem.',
    source: LAB('After the tippe top of the MuJoCo Python tutorial (Apache-2.0).'), camera: cam(90, -20, 0.25, [0, 0, 0.02]), start: { key: 'spinning' }, load: { dir: 'models/lab/', main: 'tippe_top.xml' } },
  // ── contact and stacking
  { key: 'balls-in-box', group: 'Contact and stacking', name: 'Balls in a box', blurb: 'Sixty-four spheres fall into an open box: many contacts at once.',
    source: LAB(), camera: cam(135, -35, 1.8, [0, 0, 0.15]), load: { dir: 'models/lab/', main: 'balls_box.xml' } },
  { key: 'bounce', group: 'Contact and stacking', name: 'Bouncing balls', blurb: 'Three balls with the same contact stiffness and different contact damping (solref): restitution about 1, 0.9 and 0.4.',
    source: LAB(), camera: cam(90, -5, 2.4, [0, 0, 0.5]), load: { dir: 'models/lab/', main: 'bounce.xml' } },
  { key: 'dominoes', group: 'Contact and stacking', name: 'Dominoes', blurb: 'A chain of dominoes with turns. Bodies that stop moving go to sleep and cost nothing.',
    source: MJ('sleep/dominos.xml'), camera: cam(120, -35, 3.5, [0.7, 0, 0]), load: { dir: 'models/mujoco/sleep/', main: 'dominos.xml' } },
  { key: 'card-house', group: 'Contact and stacking', name: 'House of cards', blurb: 'A 26-card house that stands on friction alone: elliptic cones, a large impratio and noslip iterations.',
    source: MJ('cards/house_of_cards.xml', 'The card-face PNG textures are removed; the cards are plain.'), camera: cam(150, -15, 0.7, [0, 0, 0.105]), heavy: true, load: { dir: 'models/mujoco/cards/', main: 'house_of_cards.xml' } },
  { key: 'stonehenge', group: 'Contact and stacking', name: 'Stone circle', blurb: 'Stones and lintels placed with the replicate element.',
    source: MJ('replicate/stonehenge.xml'), camera: cam(120, -25, 6, [0, 0, 0.5]), heavy: true, load: { dir: 'models/mujoco/replicate/', main: 'stonehenge.xml' } },
  { key: 'roman-arch', group: 'Contact and stacking', name: 'Roman arch', blurb: 'Free voussoirs that hold up only by contact and friction.',
    source: MJ('arch/roman.xml'), camera: cam(90, -10, 6, [0, 0, 1]), heavy: true, load: { dir: 'models/mujoco/arch/', main: 'roman.xml' } },
  // ── soft and flexible
  { key: 'rope', group: 'Soft and flexible', name: 'Rope', blurb: 'Thirty capsules on ball joints with a weight at the end; the rope swings into a post.',
    source: LAB('Made by procedural.js chainXML.'), camera: cam(90, -10, 3.5, [0, 0, 1]), build: () => ropeXML() },
  { key: 'cloth', group: 'Soft and flexible', name: 'Cloth', blurb: 'A square of cloth (a 2D flex with equality edges) falls over a ball.',
    source: LAB(), camera: cam(120, -25, 2.2, [0, 0, 0.35]), heavy: true, load: { dir: 'models/lab/', main: 'cloth.xml' } },
  { key: 'tendon-arm', group: 'Soft and flexible', name: 'Muscle arm', blurb: 'A two-joint arm moved by six muscle actuators on spatial tendons that wrap around the joints.',
    source: MJ('tendon_arm/arm26.xml'), camera: cam(90, -20, 1.6, [0, 0, 0.4]), load: { dir: 'models/mujoco/tendon_arm/', main: 'arm26.xml' } },
  { key: 'balloons', group: 'Soft and flexible', name: 'Balloons', blurb: 'Light ellipsoids on tendons in air: buoyancy and drag from the fluid model.',
    source: MJ('balloons/balloons.xml'), camera: cam(90, -10, 3, [0, 0, 1]), load: { dir: 'models/mujoco/balloons/', main: 'balloons.xml' } },
  // ── creatures
  { key: 'humanoid', group: 'Creatures', name: 'Humanoid', blurb: 'The MuJoCo humanoid: 21 joints and 21 motors. With no control it falls like a ragdoll; drag it with the mouse.',
    source: MJ('humanoid/humanoid.xml'), camera: cam(140, -15, 4, [0, 0, 1]), load: { dir: 'models/mujoco/humanoid/', main: 'humanoid.xml' } },
  { key: 'quadruped', group: 'Creatures', name: 'Quadruped', blurb: 'A four-legged walker of the ant kind: a ball body, eight hinges and eight motors.',
    source: LAB(), camera: cam(120, -25, 4, [0, 0, 0.4]), load: { dir: 'models/lab/', main: 'ant.xml' } },
  { key: 'car', group: 'Creatures', name: 'Car', blurb: 'A small car with two driven wheels on tendons: one control goes forward, one turns.',
    source: MJ('car/car.xml'), camera: cam(120, -30, 1, [0, 0, 0]), load: { dir: 'models/mujoco/car/', main: 'car.xml' } },
  { key: 'ragdolls', group: 'Creatures', name: 'Ragdolls', blurb: 'Random capsule figures dropped on the floor. Change the seed for a new pile.',
    source: LAB('Made by procedural.js.'), camera: cam(135, -25, 4, [0, 0, 0.6]), build: seed => generate('ragdolls', seed ?? 3).xml, seeded: true },
  // ── robots
  { key: 'panda', group: 'Robots', name: 'Franka Emika Panda arm', blurb: 'A seven-joint robot arm with a two-finger gripper and position actuators.',
    source: MEN('franka_emika_panda', 'Apache-2.0', 'MJCF by Google DeepMind from the franka_ros description (Franka Emika GmbH, Apache-2.0)'), camera: cam(150, -20, 2.2, [0, 0, 0.4]), start: { key: 'home' },
    load: { dir: 'models/menagerie/franka_emika_panda/', main: 'scene.xml' } },
  { key: 'shadow-hand', group: 'Robots', name: 'Shadow Hand (right)', blurb: 'A dexterous hand with 24 joints and 20 actuators, and an ellipsoid to hold.',
    source: MEN('shadow_hand', 'Apache-2.0', 'MJCF by Google DeepMind from assets of the Shadow Robot Company (Apache-2.0)'), camera: cam(220, -30, 0.6, [0.15, 0, 0.05]),
    load: { dir: 'models/menagerie/shadow_hand/', main: 'scene_right.xml' } },
  { key: 'go2', group: 'Robots', name: 'Unitree Go2', blurb: 'A quadruped robot with twelve motors. With no controller it folds; push it with the mouse.',
    source: UNI('https://github.com/unitreerobotics/unitree_mujoco/tree/1eb6642e3f3fdfb7fb13a9794fd6a2dd93ea0e7d/unitree_robots/go2'), camera: cam(135, -20, 1.6, [0, 0, 0.2]),
    unitree: { dir: 'unitree_mujoco/go2/', xml: 'go2.xml', derived: 'derived/go2/', meshPrefix: 'assets/' } },
  { key: 'h1', group: 'Robots', name: 'Unitree H1', blurb: 'A full-size humanoid robot. With no controller it falls like a ragdoll.',
    source: UNI('https://github.com/unitreerobotics/unitree_rl_gym/tree/276801e46c5d433564f24658bac64f254b7d2d4b/resources/robots/h1'), camera: cam(135, -15, 3.5, [0, 0, 0.9]),
    unitree: { dir: 'resources/robots/h1/', xml: 'h1.xml', scene: 'scene.xml', derived: 'derived/h1/', meshPrefix: 'meshes/' } },
];
for (const e of MODELS) e.thumb = `thumbs/${e.key}.jpg`;

export const modelByKey = k => MODELS.find(e => e.key === k);

function ropeXML() {
  return `<!-- MuJoCo Lab rope: 30 capsules on ball joints (procedural.js chainXML) -->
<mujoco model="rope">
  <option timestep="0.002" integrator="implicitfast"/>
  <worldbody>
    <light pos="0 0 4" dir="0 0 -1" directional="true"/>
    <geom name="floor" type="plane" size="4 4 .1" rgba=".22 .25 .3 1"/>
    <geom name="post" type="box" pos=".55 .15 .5" size=".06 .06 .5" rgba=".5 .55 .6 1"/>
    <geom name="anchor" type="sphere" pos="0 0 1.8" size=".03" rgba=".7 .7 .75 1" contype="0" conaffinity="0"/>
${chainXML('rope', { n: 30, len: 0.045, radius: 0.012, pos: [0, 0, 1.8], dir: [1, 0, 0], damping: 0.002, endBall: 0.06 })}  </worldbody>
</mujoco>
`;
}

// ── files ───────────────────────────────────────────────────────────────────
const CORE = new URL('./', import.meta.url);
const UNITREE = new URL('../../../vendor/unitree_rl_gym/', import.meta.url);
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';

// get(url: URL, kind: 'text' | 'buf') -> Promise<string | Uint8Array>
export async function defaultGet(url, kind) {
  if (isNode && url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    const b = await readFile(url);
    return kind === 'text' ? b.toString('utf8') : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  // never size from content-length (the site gzips): read the whole body
  return kind === 'text' ? r.text() : new Uint8Array(await r.arrayBuffer());
}

// file="..." references, and the compiler meshdir / assetdir of one XML text
function xmlRefs(xml) {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '');
  const dir = (body.match(/<compiler[^>]*\b(?:meshdir|assetdir)="([^"]*)"/) || [])[1] || '';
  const inc = [], assets = [];
  for (const m of body.matchAll(/<include\s+file="([^"]+)"/g)) inc.push(m[1]);
  for (const m of body.matchAll(/<(mesh|hfield|skin)\b[^>]*\bfile="([^"]+)"/g)) assets.push(m[2]);
  for (const m of body.matchAll(/<texture\b[^>]*\bfile="([^"]+)"/g)) assets.push(m[1]);
  return { dir: dir && !dir.endsWith('/') ? dir + '/' : dir, inc, assets };
}

// entry -> { xml, files } where files are the VFS entries for createSim
export async function modelFiles(entry, { get = defaultGet, seed } = {}) {
  if (entry.build) return { xml: entry.build(seed), files: {} };
  if (entry.unitree) return unitreeFiles(entry.unitree, get);
  const base = new URL(entry.load.dir, CORE), files = {};
  const xml = await get(new URL(entry.load.main, base), 'text');
  // includes first (they may set meshdir), then every referenced asset
  const queue = [xml], seen = new Set();
  let dir = '';
  const assets = [];
  while (queue.length) {
    const r = xmlRefs(queue.shift());
    if (r.dir) dir = r.dir;
    assets.push(...r.assets);
    for (const f of r.inc) if (!seen.has(f)) { seen.add(f); const t = await get(new URL(f, base), 'text'); files[f] = t; queue.push(t); }
  }
  await Promise.all([...new Set(assets)].map(async a => { files[dir + a] = await get(new URL(dir + a, base), 'buf'); }));
  return { xml, files };
}

async function unitreeFiles(U, get) {
  const { unpack, meshFile } = await import('../../legged-rl/robot.js');
  const base = new URL(U.dir, UNITREE);
  const [xml, scene, col] = await Promise.all([
    get(new URL(U.xml, base), 'text'), U.scene ? get(new URL(U.scene, base), 'text') : null,
    get(new URL(U.derived + 'collide.bin', UNITREE), 'buf'),
  ]);
  const files = { [U.xml]: xml }, C = unpack(col.buffer.slice(col.byteOffset, col.byteOffset + col.byteLength));
  for (const name in C) files[name] = meshFile(name, C[name].v, C[name].t);
  const top = scene || `<mujoco model="${U.xml.replace('.xml', '')} floor"><include file="${U.xml}"/><worldbody><light pos="0 0 3" dir="0 0 -1" directional="true"/><geom name="floor" size="0 0 0.05" type="plane"/></worldbody></mujoco>`;
  return { xml: top, files };
}

// entry or key -> sim; applies the start keyframe and option overrides
export async function loadModel(mj, entryOrKey, opts = {}) {
  const e = typeof entryOrKey === 'string' ? modelByKey(entryOrKey) : entryOrKey;
  if (!e) throw new Error(`no model ${entryOrKey}`);
  const spec = await modelFiles(e, opts);
  const S = createSim(mj, { ...spec, name: e.key });
  S.entry = e;
  if (e.start && e.start.key != null) S.keyframe(e.start.key);
  if (e.options) S.setOptions(e.options);
  S.restart = () => { S.reset(); if (e.start && e.start.key != null) S.keyframe(e.start.key); return S; };
  return S;
}
