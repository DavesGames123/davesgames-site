// ============================================================================
//  MUJOCO LAB  ·  scenes.js — the scene generator of the page (no DOM)
// ----------------------------------------------------------------------------
//  The page generator has five kinds. Four come from core/procedural.js
//  (stacks, ragdoll rain, chains, mixed). Domino runs are made here: a
//  seeded curved path of thin boxes, with the first box tilted so that the
//  run starts by itself. The same kind and seed give the same XML.
//
//  GREP MAP
//    export const SCENE_KINDS ..... kind id -> { name, blurb }
//    export function sceneXML ..... (kind, seed) -> { xml, name, camera }
//    function dominoRun ........... the domino path and its MJCF
// ============================================================================
import { generate, rng } from './core/procedural.js';

export const SCENE_KINDS = {
  stacks: { name: 'Stacks', blurb: 'Towers of boxes and cylinders on a floor.' },
  ragdolls: { name: 'Ragdoll rain', blurb: 'Capsule figures dropped one above the other.' },
  dominoes: { name: 'Domino run', blurb: 'A curved run of dominoes; the first one is tilted.' },
  chains: { name: 'Chains', blurb: 'Hanging chains that swing into a post.' },
  mixed: { name: 'Stacks and ragdolls', blurb: 'Two towers and two figures.' },
};

const f = x => (Math.abs(x) < 5e-5 ? 0 : +x.toFixed(4));
const PALETTE = ['.92 .55 .22', '.3 .6 .92', '.55 .82 .4', '.9 .35 .35', '.85 .8 .35', '.65 .45 .85', '.35 .8 .8'];

// kind, seed -> { xml, name, camera, kind, seed }
export function sceneXML(kind, seed) {
  seed = (seed >>> 0) || 1;
  if (kind === 'dominoes') return dominoRun(seed);
  if (kind === 'ragdolls') {
    const r = rng(seed ^ 0x5bd1e995);
    const g = generate('ragdolls', seed, { count: 5 + Math.floor(r() * 5) });
    return { ...g, kind, name: `Ragdoll rain #${seed}`, camera: { azimuth: 135, elevation: -20, distance: 5.5, lookat: [0, 0, 1.2] } };
  }
  const g = generate(SCENE_KINDS[kind] ? kind : 'mixed', seed);
  return { ...g, name: `${SCENE_KINDS[g.kind].name} #${seed}` };
}

function dominoRun(seed) {
  const r = rng(seed);
  const n = 40 + Math.floor(r() * 30), gap = 0.105, hx = 0.011, hy = 0.05, hz = 0.1;
  let x = 0, y = 0, a = r() * Math.PI * 2, k = 0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    if (i % 8 === 0) k = (r() - 0.5) * 0.5;          // curvature per metre of path, changes every 8 boxes
    pts.push([x, y, a]);
    a += k * gap * 3;
    x += Math.cos(a) * gap; y += Math.sin(a) * gap;
  }
  // centre the run on the origin
  let cx = 0, cy = 0, R = 0;
  for (const p of pts) { cx += p[0] / n; cy += p[1] / n; }
  for (const p of pts) { p[0] -= cx; p[1] -= cy; R = Math.max(R, Math.hypot(p[0], p[1])); }
  const c0 = PALETTE[Math.floor(r() * PALETTE.length)], c1 = PALETTE[Math.floor(r() * PALETTE.length)];
  let body = '';
  pts.forEach(([px, py, pa], i) => {
    const col = (i % 2 ? c0 : c1) + ' 1';
    let quat, z = hz + 0.0005;
    if (i === 0) {
      // yaw about z, then a forward tilt of 22 degrees about the local y axis
      const t = 22 * Math.PI / 360, h = pa / 2;
      quat = [Math.cos(h) * Math.cos(t), -Math.sin(h) * Math.sin(t), Math.cos(h) * Math.sin(t), Math.sin(h) * Math.cos(t)];
      z += 0.01;
    } else quat = [Math.cos(pa / 2), 0, 0, Math.sin(pa / 2)];
    body += `    <body name="d${i}" pos="${f(px)} ${f(py)} ${f(z)}" quat="${quat.map(f).join(' ')}"><freejoint/><geom type="box" size="${hx} ${hy} ${hz}" rgba="${col}"/></body>\n`;
  });
  const name = `Domino run #${seed}`;
  const xml = `<!-- MuJoCo Lab procedural scene: dominoes, seed ${seed} -->
<mujoco model="${name}">
  <option timestep="0.002" cone="elliptic" impratio="2"/>
  <default><geom friction=".6 .005 .0001" density="700"/></default>
  <asset>
    <texture name="grid" type="2d" builtin="checker" rgb1=".18 .2 .24" rgb2=".24 .27 .31" width="64" height="64"/>
    <material name="grid" texture="grid" texrepeat="10 10" texuniform="true"/>
  </asset>
  <worldbody>
    <light pos="0 0 5" dir="0 0 -1" directional="true"/>
    <geom name="floor" type="plane" size="10 10 .1" material="grid"/>
${body}  </worldbody>
</mujoco>
`;
  return { kind: 'dominoes', seed, name, xml, camera: { azimuth: 120, elevation: -40, distance: Math.max(2, R * 2.6), lookat: [0, 0, 0.1] } };
}
