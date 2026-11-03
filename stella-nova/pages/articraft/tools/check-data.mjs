// ============================================================================
//  ARTICRAFT PLAYGROUND  ·  tools/check-data.mjs — node check of data/
// ----------------------------------------------------------------------------
//  This check loads every object of data/manifest.json with the vendored
//  MuJoCo, in a floor scene, and runs the physics. Node only, no browser.
//
//  Per object it asserts that:
//    - the manifest entry is complete (slug, title <= 40, group, joints, ...)
//    - model.xml has the text <body name="root" one time
//    - bytes on disk <= 400 KB and equal to the manifest "bytes"
//    - the model loads, and each joint with "act" has its actuator
//    - anchored, ctrl = qpos0 (clamped to ctrlrange), 2 s: qpos finite,
//      no body faster than 20 m/s
//    - anchored, ctrl = targets (range midpoints), 2 s: each actuated joint
//      moves >= 30 % toward its target in 1.5 s, qpos finite, speed < 20 m/s.
//      A joint that does not, gets a retry alone with four other targets.
//      A joint that moves only with no floor is a pass, flagged FLOOR-BLOCKED
//      (a wheel or a foot on the floor while the root is anchored).
//    - loose (freejoint on root), 2 s: qpos finite, speed < 20 m/s,
//      the object does not fall through the floor
//  The whole data folder must be <= 15 MB.
//
//  GREP MAP
//    function sceneXML ..... floor scene wrap (check only; lane B owns sim.js)
//    function run .......... step and watch qpos and body speeds
//    function checkObject .. all the checks for one object
//    LIMITS ................ the numbers above
//
//  Usage:  node tools/check-data.mjs [slug ...]     exit code 1 on a failure
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMuJoCo, createSim } from '../../mujoco-lab/core/engine.js';

const PAGE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(PAGE, 'data');
const LIMITS = { objBytes: 400 * 1024, allBytes: 15 * 1024 * 1024, vmax: 20, progress: 0.3, moveSec: 1.5, holdSec: 2, titleLen: 40 };

function sceneXML(xml, loose) {
  let s = xml.replace('<worldbody>', '<worldbody>\n    <geom name="floor" type="plane" size="10 10 0.1" contype="2" conaffinity="1"/>');
  if (loose) s = s.replace(/<body name="root"[^>]*>/, m => m + '<freejoint name="root_free"/>');
  return s;
}

function run(S, seconds, watch) {
  const m = S.m, d = S.d, dt = m.opt.timestep, n = Math.round(seconds / dt);
  let prev = Float64Array.from(d.xpos), vmax = 0, finite = true, zmin = Infinity;
  for (let i = 0; i < n; i++) {
    S.step(1);
    const x = d.xpos;
    for (let b = 1; b < m.nbody; b++) {
      const v = Math.hypot(x[3 * b] - prev[3 * b], x[3 * b + 1] - prev[3 * b + 1], x[3 * b + 2] - prev[3 * b + 2]) / dt;
      if (v > vmax) vmax = v;
      if (x[3 * b + 2] < zmin) zmin = x[3 * b + 2];
    }
    prev.set(x);
    for (let k = 0; k < m.nq; k++) if (!Number.isFinite(d.qpos[k])) { finite = false; break; }
    if (!finite) break;
    if (watch) watch(i + 1);
  }
  return { vmax, finite, zmin };
}

function filesOf(dir) {
  const files = {}; let bytes = fs.statSync(path.join(dir, 'model.xml')).size;
  for (const f of fs.readdirSync(path.join(dir, 'meshes'))) {
    const b = fs.readFileSync(path.join(dir, 'meshes', f)); files['meshes/' + f] = new Uint8Array(b); bytes += b.length;
  }
  return { files, bytes };
}

// Best progress of one joint, alone, from state `held`, over three targets.
function targetsOf(j) { const [lo, hi] = j.range; return [(lo + hi) / 2, lo + 0.8 * (hi - lo), lo + 0.2 * (hi - lo), hi, lo]; }
function soloBest(S, held, x, acts) {
  const n = Math.round(LIMITS.moveSec / S.m.opt.timestep); let best = -Infinity;
  for (const t of targetsOf(x.j)) {
    S.setState(held);
    const q0 = S.d.qpos[x.qa]; if (Math.abs(t - q0) < 1e-4) continue;
    S.setCtrl(x.j.act, t); S.step(n);
    best = Math.max(best, (S.d.qpos[x.qa] - q0) / (t - q0));
  }
  S.setState(held);
  return best;
}
function noFloorBest(mj, xml, files, x, acts) {
  const F = createSim(mj, { xml, files });
  try {
    for (const j of acts) { const ji = F.jointNames.indexOf(j.name); F.setCtrl(j.act, F.m.qpos0[F.m.jnt_qposadr[ji]]); }
    F.step(Math.round(LIMITS.holdSec / F.m.opt.timestep));
    return soloBest(F, F.getState(), x, acts);
  } finally { F.dispose(); }
}

function checkObject(mj, o, groups) {
  const fail = [], note = [], floorBlocked = [];
  const dir = path.join(DATA, 'objects', o.slug);
  for (const k of ['slug', 'title', 'group', 'category', 'prompt', 'record', 'revision', 'author', 'url', 'joints', 'bytes', 'extent'])
    if (o[k] == null || o[k] === '') fail.push('manifest: no ' + k);
  if (!/^[a-z0-9-]+$/.test(o.slug)) fail.push('slug format');
  if ((o.title || '').length > LIMITS.titleLen) fail.push('title > 40 chars');
  if (!groups.has(o.group)) fail.push('group not in groups');
  if (!fs.existsSync(path.join(dir, 'model.xml'))) return { fail: [...fail, 'no model.xml'], note, bytes: 0 };
  const xml = fs.readFileSync(path.join(dir, 'model.xml'), 'utf8');
  const { files, bytes } = filesOf(dir);
  if (xml.split('<body name="root"').length !== 2) fail.push('<body name="root" not once');
  if (bytes > LIMITS.objBytes) fail.push(`size ${bytes} > 400 KB`);
  if (bytes !== o.bytes) fail.push(`bytes ${bytes} != manifest ${o.bytes}`);
  let S;
  try { S = createSim(mj, { xml: sceneXML(xml, false), files, name: o.slug }); }
  catch (e) { return { fail: [...fail, 'load: ' + String(e.message || e).slice(0, 120)], note, bytes }; }
  try {
    const m = S.m, d = S.d;
    const acts = o.joints.filter(j => j.act);
    for (const j of acts) if (S.actuatorNames.indexOf(j.act) < 0) fail.push('no actuator ' + j.act);
    if (S.nu !== acts.length) fail.push(`nu ${S.nu} != ${acts.length}`);
    // hold: ctrl = qpos0, clamped by setCtrl
    for (const j of acts) { const ji = S.jointNames.indexOf(j.name); S.setCtrl(j.act, m.qpos0[m.jnt_qposadr[ji]]); }
    const h = run(S, LIMITS.holdSec);
    if (!h.finite) fail.push('hold: qpos not finite');
    if (h.vmax > LIMITS.vmax) fail.push(`hold: speed ${h.vmax.toFixed(1)} m/s`);
    // move: targets
    const tg = acts.map(j => {
      const ji = S.jointNames.indexOf(j.name), qa = m.jnt_qposadr[ji], q0 = d.qpos[qa];
      const [lo, hi] = j.range; let t = (lo + hi) / 2;
      if (Math.abs(t - q0) < 0.1 * (hi - lo)) t = lo + 0.8 * (hi - lo);
      if (Math.abs(t - q0) < 0.1 * (hi - lo)) t = lo + 0.2 * (hi - lo);
      S.setCtrl(j.act, t);
      return { j, qa, q0, t, at: null };
    });
    const nMove = Math.round(LIMITS.moveSec / m.opt.timestep);
    const held = S.getState();
    const mv = run(S, LIMITS.holdSec, i => { if (i === nMove) for (const x of tg) x.at = d.qpos[x.qa]; });
    if (!mv.finite) fail.push('move: qpos not finite');
    if (mv.vmax > LIMITS.vmax) fail.push(`move: speed ${mv.vmax.toFixed(1)} m/s`);
    let worst = Infinity;
    for (const x of tg) {
      let p = (x.at - x.q0) / (x.t - x.q0);
      if (!(p >= LIMITS.progress)) {
        // retry this joint alone, from the hold state, with other targets
        p = Math.max(p, soloBest(S, held, x, acts));
        if (!(p >= LIMITS.progress)) {
          const free = noFloorBest(mj, xml, files, x, acts);
          if (free >= LIMITS.progress) { floorBlocked.push(x.j.name); p = free; }
          else fail.push(`move: ${x.j.name} ${(100 * p).toFixed(0)} % to target`);
        }
      }
      worst = Math.min(worst, p);
    }
    if (floorBlocked.length) note.push(`FLOOR-BLOCKED in anchored mode: ${floorBlocked.join(' ')}`);
    note.push(`hold ${h.vmax.toFixed(2)} m/s`, `move ${mv.vmax.toFixed(2)} m/s`, `worst ${(100 * (tg.length ? worst : 1)).toFixed(0)} %`);
  } finally { S.dispose(); }
  // loose: freejoint on the root, dropped on the floor at rest pose
  try {
    const L = createSim(mj, { xml: sceneXML(xml, true), files });
    try {
      for (const j of o.joints.filter(j => j.act)) { const ji = L.jointNames.indexOf(j.name); L.setCtrl(j.act, L.m.qpos0[L.m.jnt_qposadr[ji]]); }
      const r = run(L, LIMITS.holdSec);
      if (!r.finite) fail.push('loose: qpos not finite');
      if (r.vmax > LIMITS.vmax) fail.push(`loose: speed ${r.vmax.toFixed(1)} m/s`);
      if (L.d.qpos[2] < -0.05 - (o.extent || 0)) fail.push('loose: fell through the floor');
      note.push(`loose ${r.vmax.toFixed(2)} m/s`);
    } finally { L.dispose(); }
  } catch (e) { fail.push('loose load: ' + String(e.message || e).slice(0, 100)); }
  return { fail, note, bytes };
}

async function main() {
  const only = process.argv.slice(2);
  const man = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  const groups = new Set(man.groups.map(g => g.id));
  const mj = await loadMuJoCo();
  let nfail = 0, nfloor = 0, total = 0, n = 0;
  const perGroup = {};
  const slugs = new Set();
  for (const o of man.objects) {
    if (slugs.has(o.slug)) { console.log(`FAIL ${o.slug}: slug not unique`); nfail++; }
    slugs.add(o.slug);
    if (only.length && !only.includes(o.slug)) continue;
    const r = checkObject(mj, o, groups);
    n++; total += r.bytes; perGroup[o.group] = (perGroup[o.group] || 0) + 1;
    const head = `${r.fail.length ? 'FAIL' : 'ok  '} ${o.slug.padEnd(34)} ${String(o.joints.length).padStart(2)} joints ${(r.bytes / 1024).toFixed(0).padStart(4)} KB`;
    console.log(head + '  ' + (r.fail.length ? r.fail.join('; ') : r.note.join(', ')));
    if (r.fail.length) nfail++;
    if (r.note.some(t => t.startsWith('FLOOR'))) nfloor++;
  }
  // whole data folder on disk
  let disk = 0;
  const walk = p => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); if (e.isDirectory()) walk(q); else disk += fs.statSync(q).size; } };
  walk(DATA);
  if (disk > LIMITS.allBytes) { console.log(`FAIL data folder ${(disk / 1048576).toFixed(2)} MB > 15 MB`); nfail++; }
  console.log(`groups: ${Object.entries(perGroup).map(([g, c]) => `${g} ${c}`).join(', ')}`);
  console.log(`summary: ${n} objects, ${n - nfail} pass (${nfloor} with a floor-blocked joint in anchored mode), ${nfail} fail; objects ${(total / 1048576).toFixed(2)} MB, data folder ${(disk / 1048576).toFixed(2)} MB`);
  process.exit(nfail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
