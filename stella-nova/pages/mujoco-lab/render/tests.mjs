// ============================================================================
//  MUJOCO LAB  ·  render/tests.mjs — node checks of the renderer, no WebGL
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/mujoco-lab/render/tests.mjs
//  The renderer runs with three r160 and renderer: null. The checks read
//  the three scene graph, so they need no GPU and no browser.
//
//  GREP MAP
//    section('library ...... every model builds; mesh matrices match mjData
//    section('geom types ... primitive sizes, hfield heights, skin, flex
//    section('overlays ..... instance counts for each flag, finite matrices
//    section('cameras ...... free, track and model cameras
//    section('picking ...... ray to body, perturb translate and rotate
//    section('look ......... themes, floor modes, groups, material flags
//    section('allocation ... update() heap growth with overlays off
// ============================================================================
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import { loadMuJoCo, createSim } from '../core/engine.js';
import { MODELS, loadModel } from '../core/models.js';
import { createMjRenderer, DEFAULT_FLAGS } from './renderer.js';
import { GEOM } from './geoms.js';

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('  FAIL', msg); } };
const section = n => console.log(`\n── ${n}`);
const finite = a => { for (const v of a) if (!Number.isFinite(v)) return false; return true; };
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
const mj = await loadMuJoCo();
const W = 640, H = 400;
const mk = S => createMjRenderer(null, S, { THREE, renderer: null, width: W, height: H });
const v = new THREE.Vector3();
// world position of a mesh origin, back in MuJoCo axes
const meshMj = mesh => { mesh.updateWorldMatrix(true, false); v.setFromMatrixPosition(mesh.matrixWorld); return [v.x, -v.z, v.y]; };
const ALL = Object.fromEntries(Object.keys(DEFAULT_FLAGS).filter(k => !['transparent', 'wireframe'].includes(k)).map(k => [k, true]));

section('library: every model builds, and mesh matrices follow mjData');
for (const e of MODELS) {
  let S, R;
  try { S = await loadModel(mj, e); R = mk(S); } catch (err) { ok(false, `${e.key} build: ${err.stack}`); continue; }
  S.step(Math.round(0.5 / S.m.opt.timestep));
  R.setFlags(ALL); R.update();
  let worst = 0;
  for (const mesh of R.meshes) {
    const g = mesh.userData.geom, p = meshMj(mesh), X = S.d.geom_xpos;
    worst = Math.max(worst, Math.abs(p[0] - X[3 * g]), Math.abs(p[1] - X[3 * g + 1]), Math.abs(p[2] - X[3 * g + 2]));
  }
  ok(worst < 1e-5, `${e.key} mesh positions off by ${worst}`);
  const st = R.stats();
  ok(st.meshes > 0 || st.flexes > 0, `${e.key} has meshes`);
  ok(st.triangles > 0, `${e.key} has triangles`);
  let fin = true; for (const p of R.pools.list) if (!finite(p.M.subarray(0, 16 * p.n))) fin = false;
  ok(fin, `${e.key} overlay matrices finite with every flag on`);
  console.log(`  ${e.key.padEnd(16)} meshes ${String(st.meshes).padStart(3)} dynamic ${String(st.dynamic).padStart(3)} tris ${String(st.triangles).padStart(7)} overlays ${String(st.instances).padStart(4)} max err ${worst.toExponential(1)}`);
  R.dispose(); S.dispose();
}

section('geom types: sizes, hfield, skin, flex');
{
  const xml = `<mujoco><asset><hfield name="hf" nrow="3" ncol="4" size="1 .5 .2 .05" elevation="0 0 0 0  0 1 .5 0  0 0 0 0"/></asset>
  <worldbody><geom type="hfield" hfield="hf"/>
  <body name="a" pos="0 0 1"><freejoint/>
    <geom name="sph" type="sphere" size=".1"/><geom name="cap" type="capsule" size=".05 .2" pos=".5 0 0"/>
    <geom name="ell" type="ellipsoid" size=".1 .2 .3" pos="1 0 0"/><geom name="cyl" type="cylinder" size=".1 .25" pos="1.5 0 0"/>
    <geom name="box" type="box" size=".1 .2 .3" pos="2 0 0"/></body>
  <body name="b" pos="1 2 3"><geom type="sphere" size=".01"/></body></worldbody>
  <deformable><skin name="sk" vertex="0 0 0  .1 0 0  0 .1 0" face="0 1 2" rgba="1 0 0 1">
    <bone body="b" bindpos="0 0 0" bindquat="1 0 0 0" vertid="0 1 2" vertweight="1 1 1"/></skin></deformable></mujoco>`;
  const S = createSim(mj, { xml }), R = mk(S);
  const byName = n => R.meshes.find(x => x.name === n);
  const bb = n => { const g = byName(n).geometry; g.computeBoundingBox(); const b = g.boundingBox; return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(x => +x.toFixed(4)); };
  ok(JSON.stringify(bb('sph')) === '[0.2,0.2,0.2]', 'sphere extent ' + bb('sph'));
  ok(JSON.stringify(bb('cap')) === '[0.1,0.1,0.5]', 'capsule extent along z ' + bb('cap'));
  ok(JSON.stringify(bb('ell')) === '[0.2,0.4,0.6]', 'ellipsoid extent ' + bb('ell'));
  ok(JSON.stringify(bb('cyl')) === '[0.2,0.2,0.5]', 'cylinder extent along z ' + bb('cyl'));
  ok(JSON.stringify(bb('box')) === '[0.2,0.4,0.6]', 'box extent ' + bb('box'));
  const hf = R.meshes.find(x => S.m.geom_type[x.userData.geom] === GEOM.HFIELD);
  const P = hf.geometry.attributes.position.array;
  // MuJoCo row 1, col 1 (elevation 1) -> PlaneGeometry row 1 from the top (nrow 3)
  const at = (r, c) => P[3 * ((3 - 1 - r) * 4 + c) + 2];
  ok(near(at(1, 1), 0.2) && near(at(1, 2), 0.1) && near(at(0, 0), 0), `hfield heights ${at(1, 1)} ${at(1, 2)} ${at(0, 0)}`);
  ok(near(P[0], -1) && near(P[1], 0.5), 'hfield grid spans size');
  console.log(`  primitives ${bb('sph')} ${bb('cap')} ${bb('ell')} ${bb('cyl')} ${bb('box')}; hfield peak ${at(1, 1).toFixed(3)}`);
  R.update();
  const sk = R.scene.getObjectByProperty('type', 'Mesh') && R.root.children.find(o => o.isMesh && o.geometry.index && o.geometry.index.count === 3);
  const sp = sk && sk.geometry.attributes.position.array;
  ok(sp && near(sp[0], 1) && near(sp[1], 2) && near(sp[2], 3) && near(sp[3], 1.1), 'skin vertices follow the bone body ' + (sp && Array.from(sp)));
  console.log(`  skin vertex 0 at ${sp && Array.from(sp.subarray(0, 3)).map(x => x.toFixed(3))}`);
  R.dispose(); S.dispose();

  const C = await loadModel(mj, 'cloth'), RC = mk(C);
  C.step(300); RC.update();
  const fm = RC.root.children.find(o => o.isMesh && o.material.side === THREE.DoubleSide);
  const fp = fm.geometry.attributes.position.array, fx = C.d.flexvert_xpos;
  let err = 0; for (let i = 0; i < fp.length; i++) err = Math.max(err, Math.abs(fp[i] - fx[i]));
  ok(fm && err < 1e-5, `flex surface follows flexvert_xpos (err ${err})`);
  ok(finite(fm.geometry.attributes.normal.array), 'flex normals finite');
  console.log(`  cloth flex: ${fp.length / 3} vertices, ${fm.geometry.index.count / 3} triangles, err ${err.toExponential(1)}`);
  RC.dispose(); C.dispose();
}

section('overlays: counts for each flag');
{
  const S = await loadModel(mj, 'humanoid'), R = mk(S);
  S.step(400);
  const P = R.pools, cnt = () => ({ seg: P.seg.n, cone: P.cone.n, sph: P.sphere.n, box: P.box.n });
  const only = f => { R.setFlags(Object.fromEntries(Object.keys(ALL).map(k => [k, k === f]))); R.update(); return cnt(); };
  const nb = S.m.nbody, ncon = S.d.ncon;
  let c = only('frames'); ok(c.seg === 3 * nb && c.cone === 3 * nb, `frames: ${c.seg} shafts for ${nb} bodies`);
  c = only('contactPoints'); ok(c.seg === ncon, `contact points ${c.seg} = ncon ${ncon}`);
  c = only('contactForces'); ok(c.cone > 0 && c.cone <= ncon, `force arrows ${c.cone} of ${ncon} contacts`);
  c = only('com'); ok(c.sph >= nb - 1, `com spheres ${c.sph}`);
  c = only('inertia'); ok(c.box === nb - 1, `inertia boxes ${c.box}`);
  let hj = 0; for (let j = 0; j < S.m.njnt; j++) if (S.m.jnt_type[j] >= 2) hj++;
  c = only('jointAxes'); ok(c.cone === hj, `joint arrows ${c.cone} = hinge+slide ${hj}`);
  for (let a = 0; a < S.m.nu; a++) S.setCtrl(a, 0.5);
  S.step(5); c = only('actuators'); ok(c.cone > 0, `actuator arrows ${c.cone} of ${S.m.nu}`);
  c = only('tendons'); ok(c.seg === 0, `humanoid fixed tendons have no path (${c.seg} segments)`);
  c = only('none');
  ok(c.seg + c.cone + c.sph + c.box === 0, 'all flags off: no instances');
  console.log(`  humanoid: ${nb} bodies, ${ncon} contacts, ${hj} hinge joints, ${S.m.nu} actuators`);
  // the force arrow length follows the simulate scale
  R.setFlags({ contactForces: true }); R.update();
  const f = S.contacts()[0], M = P.seg.M, L = Math.hypot(M[4], M[5], M[6]) + Math.hypot(P.cone.M[4], P.cone.M[5], P.cone.M[6]);
  const want = Math.min(Math.hypot(...f.force) * S.m.vis.map.force / S.m.stat.meanmass, 1.5 * S.m.stat.extent);
  ok(near(L, want, 1e-4 * Math.max(1, want)), `arrow length ${L.toFixed(4)} = |f| map.force / meanmass ${want.toFixed(4)}`);
  // constraint violations: push a joint out of range
  R.setFlags({ contactForces: false, constraints: true });
  const j = S.m.jnt_type.findIndex((t, i) => t === 3 && S.m.jnt_limited[i]);
  S.d.qpos[S.m.jnt_qposadr[j]] = S.m.jnt_range[2 * j + 1] + 0.5; S.forward(); R.update();
  ok(P.sphere.n >= 1, `joint past its limit drawn red (${P.sphere.n})`);
  R.dispose(); S.dispose();
  const T = await loadModel(mj, 'tendon-arm'), RT = mk(T); T.step(100); RT.update();
  ok(RT.pools.seg.n > 0, `tendon-arm tendon segments ${RT.pools.seg.n}`);
  RT.dispose(); T.dispose();
}

section('cameras: free, track, model');
{
  const S = await loadModel(mj, 'humanoid'), R = mk(S);
  R.setCamera({ mode: 'free', azimuth: 90, elevation: -30, distance: 4, lookat: [1, 2, 0.5] });
  R.update();
  const c = R.camera.position, e = Math.PI / 6;
  const want = [1, 2 - 4 * Math.cos(e), 0.5 + 4 * Math.sin(e)];
  ok(near(c.x, want[0]) && near(-c.z, want[1]) && near(c.y, want[2]), `free camera at ${[c.x, -c.z, c.y].map(x => x.toFixed(3))}`);
  R.camera.getWorldDirection(v);
  ok(near(v.x, 0) && near(-v.z, Math.cos(e)) && near(v.y, -Math.sin(e)), 'free camera looks along (cos el sin az, sin el)');
  R.setCamera({ mode: 'model', index: 0 }); R.update();
  const cp = S.d.cam_xpos;
  ok(near(R.camera.position.x, cp[0]) && near(-R.camera.position.z, cp[1]) && near(R.camera.position.y, cp[2]), 'model camera 0 at cam_xpos');
  R.camera.getWorldDirection(v); const cm = S.d.cam_xmat;
  ok(near(v.x, -cm[2]) && near(-v.z, -cm[5]) && near(v.y, -cm[8]), 'model camera looks along -z of cam_xmat');
  ok(near(R.camera.fov, S.m.cam_fovy[0]), 'model camera fovy');
  ok(R.cameraNames.length === S.m.ncam, `camera names ${R.cameraNames.join(', ')}`);
  R.setCamera({ mode: 'track', body: 1, lookat: [5, 5, 5] });
  for (let i = 0; i < 60; i++) { S.step(2); R.update(); }
  const sc = S.d.subtree_com, la = R.getCamera().lookat;
  ok(Math.hypot(la[0] - sc[3], la[1] - sc[4], la[2] - sc[5]) < 0.01, `track camera lookat follows body 1 (${la.map(x => x.toFixed(3))})`);
  R.resetCamera(); ok(R.getCamera().distance === S.entry.camera.distance, 'resetCamera takes the entry camera');
  R.dispose(); S.dispose();
}

section('picking and perturbation');
{
  const xml = `<mujoco><option gravity="0 0 0" timestep="0.002"/><worldbody><geom type="plane" size="5 5 .1"/>
    <body name="blk" pos="0 0 1"><freejoint/><geom type="box" size=".2 .2 .2" mass="1"/></body></worldbody></mujoco>`;
  const S = createSim(mj, { xml }), R = mk(S);
  R.setCamera({ mode: 'free', azimuth: 90, elevation: -10, distance: 3, lookat: [0, 0, 1] });
  const hit = R.pick(W / 2, H / 2);
  ok(hit && hit.body === 1 && hit.name === 'blk', 'pick at the centre hits the block: ' + JSON.stringify(hit && { b: hit.body, n: hit.name }));
  ok(hit && near(hit.point[1], -0.2, 1e-3), 'hit point on the near face y = -0.2: ' + (hit && hit.point.map(x => x.toFixed(3))));
  ok(R.pick(5, 5) === null, 'pick on the sky is null');
  ok(R.pick(W / 2, H - 2) === null, 'the world plane is not picked');
  R.beginPerturb(hit, false);
  R.dragPerturb(W / 2, H / 2 - 80, 0, -80);
  ok(R.perturbing === 'translate' && S.perturbBody === 1, 'translate spring on body 1');
  for (let i = 0; i < 60; i++) { S.advance(1 / 60); R.update(); }
  const z = S.d.xpos[5];
  ok(z > 1.2, `the spring lifted the block to z = ${z.toFixed(3)}`);
  ok(R.pools.seg.n >= 1 && R.pools.sphere.n >= 2, 'perturb line and target drawn');
  R.endPerturb(); ok(S.perturbBody === -1 && R.perturbing === null, 'end releases the spring');
  S.reset(); R.update();
  const h2 = R.pick(W / 2, H / 2);
  R.beginPerturb(h2, true);
  for (let i = 0; i < 10; i++) R.dragPerturb(W / 2, H / 2, 10, 0);   // 1 rad about the camera up axis (world z here)
  for (let i = 0; i < 180; i++) { R.update(); S.advance(1 / 60); }
  R.update();
  const q = S.d.xquat, yaw = 2 * Math.atan2(q[7], q[4]);
  ok(near(Math.abs(yaw), 1, 0.08), `rotate spring turned the block ${yaw.toFixed(3)} rad about z (target 1)`);
  ok(R.perturbing === 'rotate', 'rotate mode');
  R.endPerturb();
  let f0 = 0; for (let k = 0; k < 6; k++) f0 += Math.abs(S.d.xfrc_applied[6 + k]);
  ok(f0 === 0, 'end clears xfrc_applied');
  R.select(1); ok(R.meshes.filter(x => x.userData.body === 1).every(x => x.material !== x.userData.base), 'select swaps in the highlight material');
  R.select(-1); ok(R.meshes.every(x => x.material === x.userData.base), 'deselect restores materials');
  console.log(`  pick ${hit && hit.name} at ${hit && hit.point.map(x => x.toFixed(3))}; lift z ${z.toFixed(3)}; yaw ${yaw.toFixed(3)} rad`);
  R.dispose(); S.dispose();
}

section('look: themes, floors, groups, material flags');
{
  const S = await loadModel(mj, 'humanoid'), R = mk(S);
  for (const t of ['night', 'paper', 'studio', 'ember']) { R.setLook({ theme: t }); R.update(); }
  ok(R.scene.background.equals(new THREE.Color('#0c0605')), 'ember background after four theme switches');
  R.setLook({ theme: 'paper' });
  ok(R.scene.background.equals(new THREE.Color('#f3efe6')), 'paper background');
  const floor = R.meshes.find(x => x.userData.body === 0);
  ok(floor && floor.material.map && floor.material.map.image.width === 256, 'theme floor has the grid texture');
  R.setLook({ floor: 'model' });
  const floor2 = R.meshes.find(x => x.userData.body === 0);
  ok(floor2 && floor2.material.map && floor2.material.map.image.width === 512, 'model floor has the model 2D texture (512 px)');
  R.setFlags({ transparent: true, wireframe: true });
  ok(R.meshes.every(x => x.material.transparent && x.material.opacity <= 0.35 && x.material.wireframe), 'transparent and wireframe on every geom');
  R.setFlags({ transparent: false, wireframe: false });
  ok(R.meshes.every(x => !x.material.wireframe && x.material.opacity === 1), 'flags off restore the materials');
  R.setGroups([0, 0, 0, 0, 0, 0]); ok(R.meshes.every(x => !x.visible), 'groups off hide all geoms');
  R.setGroups([1, 1, 1, 0, 0, 0]); ok(R.meshes.some(x => x.visible), 'groups on show geoms');
  // a new model replaces the scene
  const S2 = await loadModel(mj, 'double-pendulum');
  const before = R.root.children.length;
  R.setSim(S2);
  ok(R.meshes.every(x => x.userData.geom < S2.m.ngeom) && R.root.children.length < before, `setSim rebuilds (${before} -> ${R.root.children.length} root children)`);
  R.dispose();
  ok(R.meshes.length === 0, 'dispose clears the meshes');
  S.dispose(); S2.dispose();
}

section('allocation: update() with overlays off');
{
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const S = await loadModel(mj, 'ragdolls'), R = mk(S);
  R.setFlags({ tendons: false, perturb: false });
  S.step(10);
  for (let i = 0; i < 200; i++) R.update();
  gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 5000; i++) R.update();
  gc(); const h1 = process.memoryUsage().heapUsed;
  const per = (h1 - h0) / 5000;
  ok(per < 64, `heap growth ${per.toFixed(1)} bytes per update (after gc)`);
  console.log(`  ragdolls: ${R.stats().dynamic} dynamic meshes; heap ${(h0 / 1e6).toFixed(2)} -> ${(h1 / 1e6).toFixed(2)} MB over 5000 updates, ${per.toFixed(1)} bytes per update`);
  R.dispose(); S.dispose();
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
