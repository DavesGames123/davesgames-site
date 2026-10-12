// ============================================================================
//  MAXWELL'S EQUATIONS  ·  smoke.mjs — run every step's scene in node
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/maxwells-equations/smoke.mjs
//  No browser and no WebGL: three.js builds geometry and materials in node.
//  For each step of chapters.js the script builds the scene, enters the
//  mode, moves each control from min to max, runs 240 frames of update()
//  and reads the readout. A thrown error, a NaN in a readout or a NaN in a
//  geometry position fails the run (exit code 1). It also runs saver.js
//  shots when the module exists.
//  The import map of index.html is copied by a resolve hook below.
// ============================================================================
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const three = pathToFileURL(path.resolve(here, '../../vendor/three@0.160.0')).href;
const hook = `
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${three}/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${three}/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

let fails = 0, n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };

const { STEPS } = await import('./chapters.js');
const THREE = await import('three');
const labels = [];
const ctx = { label: (html, cls, fn) => { labels.push(fn); return {}; }, stage: null };
const mods = {};
const built = {};
async function scene(key) {
  if (!built[key]) {
    mods[key] = mods[key] || await import(`./scenes/${key}.js`);
    built[key] = mods[key].build(ctx);
  }
  return built[key];
}
function nanIn(obj) {
  let bad = 0;
  obj.traverse(o => {
    const a = o.geometry && o.geometry.attributes && (o.geometry.attributes.position || o.geometry.attributes.instanceStart);
    const arr = a && (a.array || (a.data && a.data.array));
    if (arr) for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { bad++; break; }
    if (o.isInstancedMesh) { const m = o.instanceMatrix.array; for (let i = 0; i < o.count * 16; i++) if (!Number.isFinite(m[i])) { bad++; break; } }
  });
  return bad;
}
for (const st of STEPS) {
  let err = null, rows = [];
  const t0 = performance.now();
  try {
    const s = await scene(st.scene);
    s.enter(st.mode, { ...(st.params || {}) });
    let t = 0;
    for (let f = 0; f < 240; f++) { t += 1 / 60; s.update(1 / 60, t); }
    rows = s.readout();
    for (const c of st.controls || []) {
      if (c.toggle) { s.set(c.toggle, false); s.set(c.toggle, true); continue; }
      for (const v of [c.min, (c.min + c.max) / 2, c.max]) { s.set(c.key, v); s.update(1 / 60, t += 1 / 60); }
    }
    s.set('auto', false);
    for (let f = 0; f < 30; f++) s.update(1 / 60, t += 1 / 60);
    rows = rows.concat(s.readout());
    for (const fn of labels) fn();
    const bad = nanIn(s.group);
    if (bad) throw new Error(`${bad} objects with NaN positions`);
  } catch (e) { err = e; }
  const nanRow = rows.find(r => /NaN|undefined|Infinity/.test(String(r[1])));
  check(`step ${st.id} (${st.scene}/${st.mode})`, !err && !nanRow && rows.length > 0,
    err ? String(err.stack || err).split('\n').slice(0, 3).join(' | ') : nanRow ? `bad row ${nanRow}` : `${rows.length} rows, ${(performance.now() - t0).toFixed(0)} ms  ${rows.slice(0, 4).map(r => r[0] + ' ' + r[1]).join('; ')}`);
}

// the screensaver shots, when saver.js exists
try {
  const sv = await import('./saver.js');
  if (sv.SHOTS) for (const k of Object.keys(sv.SHOTS)) {
    let err = null;
    try {
      const sh = sv.SHOTS[k];
      const s = await scene(sh.scene);
      s.enter(sh.mode, { ...(sh.params || {}) });
      let t = 0;
      for (let f = 0; f < 120; f++) { t += 1 / 60; s.update(1 / 60, t); }
      const lab = sv.plateFor(k, s);
      if (!lab || !lab.title || !lab.tex) throw new Error('no plate');
    } catch (e) { err = e; }
    check(`saver shot ${k}`, !err, err ? String(err.stack || err).split('\n').slice(0, 2).join(' | ') : '');
  }
} catch (e) {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') check('saver.js loads in node', false, String(e.stack || e).split('\n').slice(0, 2).join(' | '));
}
void THREE;
console.log(`\n${n - fails}/${n} smoke checks passed`);
process.exit(fails ? 1 : 0);
