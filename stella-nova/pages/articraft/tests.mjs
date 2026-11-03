// ============================================================================
//  ARTICRAFT PLAYGROUND  ·  tests.mjs — node checks, no browser
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/articraft/tests.mjs
//  Exit code 1 when a check fails.
//
//  GREP MAP
//    section('scene ......... sceneXML text: one root, free joint, floor, props
//    section('load .......... fixture x Anchored/Loose x props in MuJoCo
//    section('drive ......... setTargets moves the joints, clamps to range
//    section('poses ......... poseAt smooth, periodic, in range; randomPose
//    section('drop .......... Loose drop falls and settles on the floor
//    section('manifest ...... fallback to the fixture; lane A data loads
//    section('view .......... the MuJoCo Lab renderer builds the scene
//    section('page .......... head order, [hidden] rule, hidden vs display,
//                             main.js import gives a browser ReferenceError
// ============================================================================
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadMuJoCo, createSim } from '../mujoco-lab/core/engine.js';
import { sceneXML, loadManifest, loadObject, fetchObject, setTargets, poseAt, randomPose, restPose, drop, jointRange, DEFAULT_PROPS, defaultGet, FIXTURE } from './sim.js';

const here = new URL('./', import.meta.url);
let fails = 0, passes = 0;
const ok = (c, msg) => { if (process.env.V) console.log("  ok", msg); if (c) passes++; else { fails++; console.log('  FAIL', msg); } };
const section = n => console.log(`\n── ${n}`);
const finite = a => { for (const v of a) if (!Number.isFinite(v)) return false; return true; };
const rng = (s = 1) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const exists = async u => { try { await access(u); return true; } catch (e) { return false; } };

const mj = await loadMuJoCo();
const fix = JSON.parse(await readFile(new URL(FIXTURE + 'manifest.json', here), 'utf8'));
for (const o of fix.objects) o.base = FIXTURE;
const arm = fix.objects.find(o => o.slug === 'fixture-arm'), drawer = fix.objects.find(o => o.slug === 'fixture-drawer');

// lowest world z of the object geoms (contype 1): exact for sphere,
// capsule, cylinder, box and mesh; ellipsoid by its bounding box
function objectMinZ(S) {
  const m = S.m, d = S.d, R = d.geom_xmat, p = d.geom_xpos, sz = m.geom_size; let z = Infinity;
  for (let g = 0; g < m.ngeom; g++) {
    if (m.geom_contype[g] !== 1) continue;
    const t = m.geom_type[g], r = [R[9 * g + 6], R[9 * g + 7], R[9 * g + 8]], s = [sz[3 * g], sz[3 * g + 1], sz[3 * g + 2]], pz = p[3 * g + 2];
    if (t === 2) z = Math.min(z, pz - s[0]);
    else if (t === 3) z = Math.min(z, pz - Math.abs(r[2]) * s[1] - s[0]);
    else if (t === 5) z = Math.min(z, pz - Math.abs(r[2]) * s[1] - s[0] * Math.sqrt(Math.max(0, 1 - r[2] * r[2])));
    else if (t === 4 || t === 6) z = Math.min(z, pz - Math.abs(r[0]) * s[0] - Math.abs(r[1]) * s[1] - Math.abs(r[2]) * s[2]);
    else if (t === 7 && m.geom_dataid[g] >= 0) {
      const id = m.geom_dataid[g], a = m.mesh_vertadr[id], n = m.mesh_vertnum[id];
      for (let k = 0; k < n; k++) { const v = 3 * (a + k); z = Math.min(z, pz + r[0] * m.mesh_vert[v] + r[1] * m.mesh_vert[v + 1] + r[2] * m.mesh_vert[v + 2]); }
    }
  }
  return z;
}

section('scene: sceneXML text');
{
  const { xml } = await fetchObject(arm);
  const a = sceneXML(xml, { loose: false, props: [] }), l = sceneXML(xml, { loose: true, props: DEFAULT_PROPS, extent: arm.extent });
  ok(!a.includes('root_free') && (l.match(/<freejoint name="root_free"\/>/g) || []).length === 1, 'Loose adds one root_free, Anchored none');
  ok((a.match(/<body name="root"/g) || []).length === 1 && (l.match(/<body name="root"/g) || []).length === 1, 'one <body name="root" after the wrap');
  ok(/name="floor"[^>]*contype="2" conaffinity="1"/.test(a), 'floor contype 2 conaffinity 1');
  ok((l.match(/<body name="prop_\d+"/g) || []).length === 4 && (l.match(/contype="3" conaffinity="3"/g) || []).length === 4, 'four props, contype 3 conaffinity 3');
  ok((l.match(/<light /g) || []).length === 2, 'two lights');
  const open = (l.match(/<(body|worldbody|mujoco|asset|actuator)\b[^>]*(?<!\/)>/g) || []).length, close = (l.match(/<\/(body|worldbody|mujoco|asset|actuator)>/g) || []).length;
  ok(open === close, `tags balance (${open} open, ${close} close)`);
  ok(/<body name="root" pos="0 0 0.002">/.test(a) && /<body name="root" pos="0 0 0">/.test(l), 'Anchored lifts the root 2 mm, Loose does not');
  let threw = false; try { sceneXML('<mujoco><worldbody/></mujoco>'); } catch (e) { threw = true; }
  ok(threw, 'sceneXML throws when there is no root body');
}

section('load: fixture in MuJoCo, Anchored and Loose, with and without props');
for (const e of fix.objects) for (const loose of [false, true]) for (const props of [[], DEFAULT_PROPS]) {
  const tag = `${e.slug} ${loose ? 'Loose' : 'Anchored'} props=${props.length}`;
  let S;
  try { S = await loadObject(mj, e, { loose, props }); } catch (err) { ok(false, `${tag}: ${err.message}`); continue; }
  const nj = e.joints.length + (loose ? 1 : 0) + props.length;
  ok(S.m.njnt === nj, `${tag}: njnt ${S.m.njnt} = ${nj}`);
  ok(S.nu === e.joints.length, `${tag}: one actuator for each joint`);
  ok(S.joints === e.joints, `${tag}: S.joints = entry.joints`);
  ok(S.entry && S.entry.camera && finite([S.entry.camera.distance, ...S.entry.camera.lookat]), `${tag}: camera`);
  S.step(500);
  ok(finite(S.qpos) && finite(S.qvel), `${tag}: 1 s of steps, finite state`);
  if (props.length) {
    const pb = S.bodyNames.indexOf('prop_0');
    ok(pb > 0 && S.d.xpos[3 * pb + 2] > 0 && S.d.xpos[3 * pb + 2] < 0.2, `${tag}: prop 0 rests on the floor (z ${S.d.xpos[3 * pb + 2].toFixed(3)})`);
  }
  if (!loose) ok(Math.abs(S.d.xpos[3 * S.rootBody + 2] - 0.002) < 1e-9, `${tag}: Anchored root stays 2 mm above the floor`);
  S.dispose();
}

section('drive: setTargets moves the joints');
for (const [e, tgt] of [[arm, { shoulder: 0.8, elbow: -1.0 }], [drawer, { drawer_slide: 0.15 }]]) for (const loose of [false, true]) {
  const S = await loadObject(mj, e, { loose });
  const before = Object.fromEntries(Object.keys(tgt).map(k => [k, S.jointValue(k)]));
  setTargets(S, tgt);
  S.step(500);   // 1 s
  for (const k in tgt) {
    const v = S.jointValue(k);
    ok(Math.abs(v - tgt[k]) < 0.06 && Math.abs(before[k] - tgt[k]) > 0.1, `${e.slug} ${loose ? 'Loose' : 'Anchored'} ${k}: ${before[k].toFixed(3)} -> ${v.toFixed(3)} (target ${tgt[k]}) in 1 s`);
  }
  S.dispose();
}
{
  const S = await loadObject(mj, arm, {});
  setTargets(S, { shoulder: 9, elbow: -9, nope: 1 });
  ok(S.targets.shoulder === 1.2 && S.targets.elbow === -2 && !('nope' in S.targets), 'setTargets clamps to the range and skips unknown joints');
  ok(Math.abs(S.d.ctrl[S.actuatorNames.indexOf('a_shoulder')] - 1.2) < 1e-12, 'setTargets writes d.ctrl of a_<joint>');
  S.dispose();
}

section('poses: poseAt and randomPose');
for (const e of fix.objects) {
  const N = 2000; let prev = poseAt(e, 0), worst = 0, inRange = true;
  for (let i = 1; i <= N; i++) {
    const p = poseAt(e, (i / N) % 1);
    for (const j of e.joints) {
      const [lo, hi] = jointRange(j);
      if (!(p[j.name] >= lo && p[j.name] <= hi)) inRange = false;
      worst = Math.max(worst, Math.abs(p[j.name] - prev[j.name]) / (hi - lo));
    }
    prev = p;
  }
  ok(inRange, `${e.slug}: poseAt inside every range`);
  ok(worst < 0.01, `${e.slug}: poseAt step for 1/${N} of a loop <= ${worst.toFixed(5)} of the range (smooth, wraps at 1)`);
  ok(Object.keys(poseAt(e, 0.3)).length === e.joints.length, `${e.slug}: poseAt gives every joint`);
  const r = rng(7); let rin = true;
  for (let i = 0; i < 500; i++) { const p = randomPose(e, r); for (const j of e.joints) { const [lo, hi] = jointRange(j); if (!(p[j.name] >= lo && p[j.name] <= hi)) rin = false; } }
  ok(rin, `${e.slug}: randomPose inside every range (500 draws)`);
  const rp = restPose(e); ok(e.joints.every(j => rp[j.name] >= jointRange(j)[0] && rp[j.name] <= jointRange(j)[1]), `${e.slug}: restPose inside every range`);
}

section('drop: Loose drop falls and settles on the floor');
for (const e of fix.objects) {
  const S = await loadObject(mj, e, { loose: true, props: DEFAULT_PROPS });
  ok(drop(S, { rand: rng(3) }), `${e.slug}: drop() returns true in Loose`);
  const z0 = objectMinZ(S);
  S.step(250);
  const zMid = objectMinZ(S);
  S.step(2250);   // 5 s in total
  const z1 = objectMinZ(S), j = S.jointNames.indexOf('root_free'), va = S.m.jnt_dofadr[j];
  const v = Math.max(...Array.from(S.d.qvel.subarray(va, va + 6), Math.abs));
  ok(z0 > 0.1 && zMid < z0 - 0.05, `${e.slug}: falls (lowest point ${z0.toFixed(3)} -> ${zMid.toFixed(3)} m after 0.5 s)`);
  ok(Math.abs(z1) < 0.01, `${e.slug}: rests on the floor (lowest point ${z1.toFixed(4)} m)`);
  ok(v < 0.05, `${e.slug}: settles (root speed ${v.toFixed(4)})`);
  S.dispose();
  const A = await loadObject(mj, e, {});
  ok(drop(A) === false, `${e.slug}: drop() does nothing in Anchored`);
  A.dispose();
}

section('manifest: fallback and lane A data');
{
  const fake = async (p, kind) => { if (p.startsWith('data/fixture/')) return defaultGet(p, kind); throw new Error('404'); };
  const m = await loadManifest({ get: fake });
  ok(m.base === FIXTURE && m.objects.every(o => o.base === FIXTURE), 'no data/manifest.json -> the fixture');
  const realURL = new URL('data/manifest.json', here);
  const raw = (await exists(realURL)) ? JSON.parse(await readFile(realURL, 'utf8')) : null;
  if (raw && !(raw.objects || []).length) {
    ok((await loadManifest()).base === FIXTURE, 'data/manifest.json has no objects yet -> the fixture');
    console.log('  data/manifest.json has no objects yet (lane A): only the fixture is checked');
  } else if (raw) {
    const man = await loadManifest();
    ok(man.base === 'data/', 'data/manifest.json is read first');
    const ids = new Set(man.groups.map(g => g.id));
    let loaded = 0; const notes = [];
    for (const e of man.objects) {
      const tag = `data ${e.slug}`;
      ok(/^[a-z0-9-]+$/.test(e.slug) && ids.has(e.group) && Array.isArray(e.joints), `${tag}: slug, group, joints fields`);
      try {
        const S = await loadObject(mj, e, {});
        const act = e.joints.filter(j => j.act);
        ok(S.nu === act.length, `${tag}: ${S.nu} actuators for ${act.length} joints with "act"`);
        for (const j of act) ok(S.actuatorNames.includes(j.act), `${tag}: actuator ${j.act}`);
        S.step(250);
        ok(finite(S.qpos), `${tag}: 0.5 s finite`);
        // notes for lane A, not failures: the drive reaches a pose in 1.5 s,
        // and a Loose drop settles on the floor in 5 s
        const tgt = poseAt(e, 0.2); setTargets(S, tgt); S.step(750);
        const slow = act.filter(j => { const [lo, hi] = jointRange(j); return Math.abs(S.jointValue(j.name) - S.targets[j.name]) > 0.1 * (hi - lo); });
        if (slow.length) notes.push(`${e.slug}: drive misses the target by > 10 % of the range: ${slow.map(j => `${j.name} ${S.jointValue(j.name).toFixed(3)} vs ${S.targets[j.name].toFixed(3)}`).join(', ')}`);
        S.dispose(); loaded++;
        const L = await loadObject(mj, e, { loose: true });
        drop(L, { rand: rng(5) }); L.step(2500);
        const fj = L.jointNames.indexOf('root_free'), va = L.m.jnt_dofadr[fj];
        const v = Math.max(...Array.from(L.d.qvel.subarray(va, va + 6), Math.abs)), zmin = objectMinZ(L);
        if (!finite(L.qpos) || Math.abs(zmin) > 0.02 || v > 0.1) notes.push(`${e.slug}: Loose drop after 5 s: lowest point ${zmin.toFixed(3)} m, root speed ${v.toFixed(3)}`);
        L.dispose();
      } catch (err) { ok(false, `${tag}: loadObject: ${err.message}`); }
    }
    console.log(`  data/manifest.json: ${loaded} of ${man.objects.length} objects load`);
    for (const n of notes) console.log('  note', n);
  } else console.log('  data/manifest.json is not there (lane A): only the fixture is checked');
}

section('view: the MuJoCo Lab renderer builds the scene (three r160, no WebGL)');
{
  const THREE = await import('../../vendor/three@0.160.0/build/three.module.js');
  const { createMjRenderer } = await import('../mujoco-lab/render/renderer.js');
  const S = await loadObject(mj, arm, { loose: true, props: DEFAULT_PROPS });
  const R = createMjRenderer(null, S, { THREE, renderer: null, width: 800, height: 500 });
  R.resize(800, 500); R.resetCamera(); R.render();
  const st = R.stats();
  ok(st.geoms >= S.ngeom - 1 && st.meshes >= 3, `renderer: ${st.geoms} geoms, ${st.meshes} meshes for ${S.ngeom} model geoms`);
  const c = R.getCamera();
  ok(Math.abs(c.distance - S.entry.camera.distance) < 1e-6, `renderer: S.entry.camera is the start camera (distance ${c.distance.toFixed(3)})`);
  const B = await loadObject(mj, drawer, {});
  R.setSim(B); R.render();
  ok(R.stats().meshes >= 2, 'renderer: setSim to the next object');
  R.dispose(); S.dispose(); B.dispose();
}

section('page: head, hidden vs display, main.js import');
{
  const html = await readFile(new URL('index.html', here), 'utf8'), css = await readFile(new URL('style.css', here), 'utf8');
  const main = await readFile(new URL('main.js', here), 'utf8');
  const i1 = html.indexOf('lib/gpu-guard.js'), i2 = html.indexOf('lib/wishlist.js'), i3 = html.indexOf('lib/stats-beacon.js');
  ok(i1 > 0 && i1 < i2 && i2 < i3 && i3 < html.indexOf('<meta'), 'head scripts: gpu-guard, wishlist, stats-beacon, first');
  ok(/name="viewport"[^>]*viewport-fit=cover/.test(html) && /<meta name="description" content="[^"]{40,}"/.test(html), 'viewport-fit=cover and a description');
  ok(/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(css), 'style.css has [hidden]{display:none!important}');
  // ids and classes of hidden elements (in the HTML, and ids main.js hides)
  const hid = new Set();
  for (const m of html.matchAll(/<[a-z]+\b([^>]*)>/g)) {
    const at = m[1];
    if (!/\shidden(\s|=|$)/.test(at)) continue;
    const id = (at.match(/\sid="([^"]+)"/) || [])[1]; if (id) hid.add('#' + id);
    for (const c of ((at.match(/\sclass="([^"]+)"/) || [])[1] || '').split(/\s+/)) if (c) hid.add('.' + c);
  }
  for (const m of main.matchAll(/\$\('([\w-]+)'\)\.hidden\b/g)) {
    hid.add('#' + m[1]);
    const t = html.match(new RegExp(`<[a-z]+\\b[^>]*\\sid="${m[1]}"[^>]*>`));
    for (const c of ((t && (t[0].match(/\sclass="([^"]+)"/) || [])[1]) || '').split(/\s+/)) if (c) hid.add('.' + c);
  }
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;|\s)display\s*:/.test(m[2])) continue;
    for (const sel of m[1].split(',').map(s => s.trim())) {
      if (sel === '[hidden]') continue;
      const last = sel.split(/[\s>+~]+/).pop();
      for (const h of hid) if (new RegExp(`${h.replace(/[.#]/, '\\$&')}(?![\\w-])`).test(last)) bad.push(`${sel} (${h})`);
    }
  }
  ok(hid.size > 0 && bad.length === 0, `no hidden element has a display rule (${[...hid].join(' ')})${bad.length ? ': ' + bad.join(', ') : ''}`);
  // main.js: a SyntaxError or a missing export stops the page; a browser
  // global ReferenceError is the correct result in node
  const url = new URL('main.js', here).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], { encoding: 'utf8' });
  const err = (r.stderr || '').split('\n').find(s => /Error/.test(s)) || '';
  ok(/ReferenceError: (document|window|matchMedia|location|navigator|addEventListener|requestAnimationFrame|innerWidth|history) is not defined/.test(err), `main.js import: ${err.trim() || 'no error'}`);
  for (const f of ['sim.js', 'main.js', 'tests.mjs']) {
    const c = spawnSync(process.execPath, ['--check', new URL(f, here).pathname], { encoding: 'utf8' });
    ok(c.status === 0, `node --check ${f}${c.status ? ': ' + c.stderr : ''}`);
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
