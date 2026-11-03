// ============================================================================
//  ARTICRAFT PLAYGROUND  ·  data/fixture/make-fixture.mjs
// ----------------------------------------------------------------------------
//  This script writes the test fixture: two small objects in the format of
//  CONTRACT.md "Data layout". The page uses the fixture when
//  data/manifest.json is not there. The tests (tests.mjs) also use it.
//    fixture-arm     root base + shoulder hinge + elbow hinge (box and cylinder)
//    fixture-drawer  root cabinet + one drawer on a slide joint
//  Run:  node stella-nova/pages/articraft/data/fixture/make-fixture.mjs
//
//  GREP MAP
//    function stl ........... triangles -> binary STL
//    function boxTris ....... box from z0 to z1, centred in x and y
//    function cylTris ....... cylinder on the z axis from z0 to z1
//    const OBJECTS .......... the two objects (MJCF text + meshes)
// ============================================================================
import { mkdir, writeFile, stat } from 'node:fs/promises';

const here = new URL('./', import.meta.url);

function stl(tris) {
  const b = Buffer.alloc(84 + 50 * tris.length);
  b.write('articraft fixture', 0);
  b.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const [a, c, d] of tris) {
    const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    for (const x of [n[0] / l, n[1] / l, n[2] / l, ...a, ...c, ...d]) { b.writeFloatLE(x, o); o += 4; }
    o += 2;
  }
  return b;
}
// quad a b c d (counter-clockwise from outside) -> two triangles
const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
function boxTris(sx, sy, z0, z1, x0 = 0) {
  const X = [x0 - sx / 2, x0 + sx / 2], Y = [-sy / 2, sy / 2], Z = [z0, z1];
  const p = (i, j, k) => [X[i], Y[j], Z[k]];
  return [
    ...quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)), ...quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)),
    ...quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)), ...quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)),
    ...quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)), ...quad(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)),
  ];
}
function cylTris(r, z0, z1, n = 24) {
  const t = [];
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n, b = 2 * Math.PI * (i + 1) / n;
    const A = [r * Math.cos(a), r * Math.sin(a)], B = [r * Math.cos(b), r * Math.sin(b)];
    t.push([[0, 0, z0], [B[0], B[1], z0], [A[0], A[1], z0]]);
    t.push([[0, 0, z1], [A[0], A[1], z1], [B[0], B[1], z1]]);
    t.push(...quad([A[0], A[1], z0], [B[0], B[1], z0], [B[0], B[1], z1], [A[0], A[1], z1]));
  }
  return t;
}

const G = 'contype="1" conaffinity="2"';
const head = name => `<mujoco model="${name}">
  <compiler angle="radian" meshdir="meshes" autolimits="true"/>
  <option timestep="0.002" integrator="implicitfast"/>`;

const OBJECTS = [
  {
    slug: 'fixture-arm', title: 'Two-joint test arm', group: 'robotic_arms_and_manipulators', category: 'Test Arm',
    prompt: 'A small test arm with a round base, a shoulder hinge and an elbow hinge. (Fixture, not a dataset record.)',
    joints: [{ name: 'shoulder', type: 'hinge', range: [-1.2, 1.2], act: 'a_shoulder' }, { name: 'elbow', type: 'hinge', range: [-2, 2], act: 'a_elbow' }],
    extent: 0.56,
    meshes: { base: cylTris(0.07, 0, 0.06), link1: boxTris(0.04, 0.04, 0, 0.24), link2: cylTris(0.018, 0, 0.2) },
    xml: `${head('fixture-arm')}
  <asset>
    <mesh name="base" file="base.stl"/>
    <mesh name="link1" file="link1.stl"/>
    <mesh name="link2" file="link2.stl"/>
  </asset>
  <worldbody>
    <body name="root" pos="0 0 0">
      <inertial pos="0 0 0.03" mass="1" diaginertia="0.0015 0.0015 0.0025"/>
      <geom name="g_base" type="mesh" mesh="base" ${G} rgba="0.35 0.38 0.45 1"/>
      <body name="link1" pos="0 0 0.08">
        <inertial pos="0 0 0.12" mass="0.3" diaginertia="0.0015 0.0015 0.00008"/>
        <joint name="shoulder" type="hinge" axis="0 1 0" range="-1.2 1.2" damping="1.2"/>
        <geom name="g_link1" type="mesh" mesh="link1" ${G} rgba="0.92 0.55 0.2 1"/>
        <body name="link2" pos="0 0 0.24">
          <inertial pos="0 0 0.1" mass="0.12" diaginertia="0.0004 0.0004 0.00002"/>
          <joint name="elbow" type="hinge" axis="0 1 0" range="-2 2" damping="0.2"/>
          <geom name="g_link2" type="mesh" mesh="link2" ${G} rgba="0.7 0.7 0.72 1"/>
        </body>
      </body>
    </body>
  </worldbody>
  <actuator>
    <position name="a_shoulder" joint="shoulder" kp="20" ctrlrange="-1.2 1.2"/>
    <position name="a_elbow" joint="elbow" kp="5" ctrlrange="-2 2"/>
  </actuator>
</mujoco>
`,
  },
  {
    slug: 'fixture-drawer', title: 'Test drawer cabinet', group: 'furniture', category: 'Test Cabinet',
    prompt: 'A box cabinet with one drawer that slides out on a straight rail. (Fixture, not a dataset record.)',
    joints: [{ name: 'drawer_slide', type: 'slide', range: [0, 0.2], act: 'a_drawer_slide' }],
    extent: 0.3,
    meshes: { cabinet: boxTris(0.3, 0.3, 0, 0.3), drawer: boxTris(0.26, 0.26, -0.04, 0.04, 0.02) },
    xml: `${head('fixture-drawer')}
  <asset>
    <mesh name="cabinet" file="cabinet.stl"/>
    <mesh name="drawer" file="drawer.stl"/>
  </asset>
  <worldbody>
    <body name="root" pos="0 0 0">
      <inertial pos="0 0 0.15" mass="2" diaginertia="0.03 0.03 0.03"/>
      <geom name="g_cabinet" type="mesh" mesh="cabinet" ${G} rgba="0.55 0.42 0.3 1"/>
      <body name="drawer" pos="0 0 0.2">
        <inertial pos="0.02 0 0" mass="0.3" diaginertia="0.002 0.002 0.003"/>
        <joint name="drawer_slide" type="slide" axis="1 0 0" range="0 0.2" damping="8"/>
        <geom name="g_drawer" type="mesh" mesh="drawer" ${G} rgba="0.8 0.68 0.5 1"/>
      </body>
    </body>
  </worldbody>
  <actuator>
    <position name="a_drawer_slide" joint="drawer_slide" kp="60" ctrlrange="0 0.2"/>
  </actuator>
</mujoco>
`,
  },
];

const manifest = {
  version: 1, generated: '2026-11-03', fixture: true,
  groups: [{ id: 'robotic_arms_and_manipulators', title: 'Robotic Arms & Manipulators' }, { id: 'furniture', title: 'Furniture' }],
  objects: [],
};
for (const o of OBJECTS) {
  const dir = new URL(`objects/${o.slug}/`, here), md = new URL('meshes/', dir);
  await mkdir(md, { recursive: true });
  let bytes = Buffer.byteLength(o.xml);
  await writeFile(new URL('model.xml', dir), o.xml);
  for (const [n, tris] of Object.entries(o.meshes)) { const b = stl(tris); bytes += b.length; await writeFile(new URL(`${n}.stl`, md), b); }
  manifest.objects.push({
    slug: o.slug, title: o.title, group: o.group, category: o.category, prompt: o.prompt,
    record: 'fixture', revision: 'rev_000000', author: 'davesgames.io (test fixture)',
    url: 'https://github.com/mattzh72/articraft-data', joints: o.joints, bytes, extent: o.extent,
  });
}
await writeFile(new URL('manifest.json', here), JSON.stringify(manifest, null, 2) + '\n');
console.log('fixture:', manifest.objects.map(o => `${o.slug} ${o.bytes} B`).join(', '), (await stat(new URL('manifest.json', here))).size, 'B manifest');
