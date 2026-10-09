// ============================================================================
//  MUJOCO LAB  ·  core/procedural.js — seeded MJCF scenes
// ----------------------------------------------------------------------------
//  generate(kind, seed, opts) -> { xml, name, camera, kind, seed }
//  The same kind and seed give the same text, byte for byte.
//
//  GREP MAP
//    export function rng ............ mulberry32 in [0, 1)
//    function stacks ................ towers of boxes and cylinders
//    function ragdolls .............. capsule figures with ball joints
//    function chains ................ hanging chains and a rope (nested bodies)
//    export function chainXML ....... one chain as nested bodies (also the rope model)
//    export const KINDS ............. stacks, ragdolls, chains, mixed
//    export function generate ....... entry point
// ============================================================================

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const f = x => (Math.abs(x) < 5e-5 ? 0 : +x.toFixed(4));
const v3 = a => a.map(f).join(' ');
const PALETTE = ['.92 .55 .22', '.3 .6 .92', '.55 .82 .4', '.9 .35 .35', '.85 .8 .35', '.65 .45 .85', '.35 .8 .8'];
const col = (r) => PALETTE[Math.floor(r() * PALETTE.length)] + ' 1';

const head = (name, opt = '') => `<mujoco model="${name}">
  <option timestep="0.002" cone="elliptic" impratio="3"${opt}/>
  <asset>
    <texture name="grid" type="2d" builtin="checker" rgb1=".18 .2 .24" rgb2=".24 .27 .31" width="64" height="64"/>
    <material name="grid" texture="grid" texrepeat="10 10" texuniform="true"/>
  </asset>
  <worldbody>
    <light pos="0 0 5" dir="0 0 -1" directional="true"/>
    <geom name="floor" type="plane" size="10 10 .1" material="grid"/>
`;
const tail = (extra = '') => `  </worldbody>${extra}
</mujoco>
`;

function stacks(r, o) {
  const towers = o.towers || 2 + Math.floor(r() * 3);
  let s = '';
  for (let t = 0; t < towers; t++) {
    const x = (t - (towers - 1) / 2) * 0.7 + (r() - 0.5) * 0.2, y = (r() - 0.5) * 0.6;
    const n = 3 + Math.floor(r() * 6);
    let z = 0;
    for (let k = 0; k < n; k++) {
      const cyl = r() < 0.25, hx = 0.06 + r() * 0.1, hy = 0.06 + r() * 0.1, hz = 0.03 + r() * 0.06;
      z += hz;
      const yaw = (r() - 0.5) * 40, c = col(r);
      const g = cyl ? `<geom type="cylinder" size="${f(Math.min(hx, hy))} ${f(hz)}" rgba="${c}"/>` : `<geom type="box" size="${v3([hx, hy, hz])}" rgba="${c}"/>`;
      s += `    <body name="t${t}b${k}" pos="${v3([x + (r() - 0.5) * 0.02, y + (r() - 0.5) * 0.02, z + 0.001])}" euler="0 0 ${f(yaw)}"><freejoint/>${g}</body>\n`;
      z += hz + 0.002;
    }
  }
  return { body: s, camera: { azimuth: 120, elevation: -20, distance: 3.2, lookat: [0, 0, 0.4] } };
}

// one capsule figure; 10 bodies, ball joints with ranges
function ragdoll(id, p, yaw, c) {
  const cap = (a, b, r = 0.045) => `<geom type="capsule" fromto="${v3(a)} ${v3(b)}" size="${r}" rgba="${c}"/>`;
  const J = (n, range = 60) => `<joint name="${id}${n}" type="ball" range="0 ${range}" damping=".05" armature=".01"/>`;
  const limb = (n, side, top, sx) => `
      <body name="${id}${n}${side}" pos="${v3([0, sx * 0.1, top])}">${J(n + side + 'j', 70)}${cap([0, 0, 0], [0, 0, -0.26], 0.04)}
        <body name="${id}${n}${side}2" pos="0 0 -.28">${J(n + side + 'k', 70)}${cap([0, 0, 0], [0, 0, -0.26], 0.035)}</body>
      </body>`;
  return `    <body name="${id}" pos="${v3(p)}" euler="0 0 ${f(yaw)}"><freejoint/>
      ${cap([0, -0.08, 0], [0, 0.08, 0], 0.08)}
      <body name="${id}chest" pos="0 0 .25">${J('w', 40)}${cap([0, -0.1, 0], [0, 0.1, 0], 0.09)}
        <body name="${id}head" pos="0 0 .22">${J('n', 40)}<geom type="sphere" size=".09" rgba="${c}"/></body>
        <body name="${id}armL" pos="0 .2 .02">${J('sl', 90)}${cap([0, 0, 0], [0, 0.26, 0], 0.035)}</body>
        <body name="${id}armR" pos="0 -.2 .02">${J('sr', 90)}${cap([0, 0, 0], [0, -0.26, 0], 0.035)}</body>
      </body>${limb('leg', 'L', -0.08, 1)}${limb('leg', 'R', -0.08, -1)}
    </body>
`;
}
function ragdolls(r, o) {
  const n = o.count || 3 + Math.floor(r() * 4);
  let s = '';
  for (let i = 0; i < n; i++) s += ragdoll(`r${i}_`, [(r() - 0.5) * 1.2, (r() - 0.5) * 1.2, 0.9 + i * 0.7], r() * 360, col(r));
  return { body: s, camera: { azimuth: 135, elevation: -25, distance: 4, lookat: [0, 0, 0.6] } };
}

// a chain of n links hanging from a fixed point: nested bodies, ball joints.
// The links do not collide with each other (conaffinity 0), only with the
// floor and other bodies: this keeps the contact count low.
export function chainXML(id, { n = 24, len = 0.06, radius = 0.012, pos = [0, 0, 1.6], color = '.85 .3 .25 1', damping = 0.004, endBall = 0.05, dir = [1, 0, 0] } = {}) {
  const d = dir.map(x => x * len);
  let open = '', close = '';
  for (let k = 0; k < n; k++) {
    const p = k === 0 ? pos : d;
    open += `${'  '.repeat(k + 2)}<body name="${id}${k}" pos="${v3(p)}"><joint name="${id}j${k}" type="ball" damping="${damping}"/><geom type="capsule" fromto="0 0 0 ${v3(d)}" size="${radius}" rgba="${color}" density="2000" contype="1" conaffinity="0"/>\n`;
    close = `${'  '.repeat(k + 2)}</body>\n` + close;
  }
  const tip = endBall ? `${'  '.repeat(n + 2)}<geom type="sphere" pos="${v3(d)}" size="${endBall}" rgba=".9 .8 .4 1" density="3000"/>\n` : '';
  return open + tip + close;
}
function chains(r, o) {
  const n = o.count || 2 + Math.floor(r() * 3);
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    s += chainXML(`c${i}_`, { n: 12 + Math.floor(r() * 10), len: 0.05 + r() * 0.03, pos: [(i - (n - 1) / 2) * 0.5, (r() - 0.5) * 0.3, 1.8], dir: [Math.cos(a), Math.sin(a), 0], color: col(r), endBall: r() < 0.6 ? 0.04 + r() * 0.04 : 0 });
  }
  // something to swing into
  s += `    <body name="post" pos="0 0 .4"><geom type="box" size=".08 .08 .4" rgba=".5 .55 .6 1"/></body>\n`;
  return { body: s, camera: { azimuth: 90, elevation: -10, distance: 4, lookat: [0, 0, 1] } };
}
function mixed(r, o) {
  const a = stacks(r, { towers: 2 }), b = ragdolls(r, { count: 2 });
  return { body: a.body + b.body, camera: { azimuth: 130, elevation: -22, distance: 4, lookat: [0, 0, 0.5] } };
}

export const KINDS = { stacks: { name: 'Random stacks', make: stacks }, ragdolls: { name: 'Ragdolls', make: ragdolls }, chains: { name: 'Chains', make: chains }, mixed: { name: 'Stacks and ragdolls', make: mixed } };

export function generate(kind = 'mixed', seed = 1, opts = {}) {
  const K = KINDS[kind] || KINDS.mixed, r = rng(seed);
  const out = K.make(r, opts);
  const name = `${K.name} #${seed}`;
  return { kind, seed, name, camera: out.camera, xml: `<!-- MuJoCo Lab procedural scene: ${kind}, seed ${seed} -->\n` + head(name) + out.body + tail() };
}
