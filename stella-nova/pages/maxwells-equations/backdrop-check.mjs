// ============================================================================
//  MAXWELL'S EQUATIONS  ·  backdrop-check.mjs — no edge in the backdrop
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/maxwells-equations/backdrop-check.mjs
//  The user saw "a black rectangle over the fields sometimes": a flat dark
//  top over a lit bottom. The cause was a world floor disc (radius 9 at
//  y = -2.2) whose far rim fell inside the view at most chapter poses.
//  Part 1 prints, for each chapter pose, where that old rim falls.
//  Part 2 checks that stage.js now has a screen-space backdrop and no
//  world floor disc. The exit code is 1 when a check fails.
// ============================================================================
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const three = pathToFileURL(path.resolve(here, '../../vendor/three@0.160.0')).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${three}/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${three}/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

let fails = 0, n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };
const THREE = await import('three');
const { STEPS } = await import('./chapters.js');

// Part 1: screen y (-1 bottom .. 1 top) of the old floor rim straight ahead.
let inView = 0;
for (const st of STEPS) {
  const cam = new THREE.PerspectiveCamera(34, 1.4, 0.05, 200);
  cam.position.set(...st.cam.pos); cam.lookAt(new THREE.Vector3(...(st.cam.target || [0, 0, 0])));
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const dir = new THREE.Vector3(-cam.position.x, 0, -cam.position.z).normalize();
  const rim = dir.multiplyScalar(9).setY(-2.2).project(cam);
  if (Math.abs(rim.y) < 1 && rim.z < 1) inView++;
}
console.log(`info old floor rim inside the view at ${inView} of ${STEPS.length} chapter poses`);

// Part 2: the stage draws a screen-space backdrop, not a world floor.
const src = readFileSync(path.join(here, 'stage.js'), 'utf8');
check('stage.js has no world floor disc', !/CircleGeometry/.test(src));
const stage = await import('./stage.js');
check('stage.js exports makeBackdrop', typeof stage.makeBackdrop === 'function');
if (typeof stage.makeBackdrop === 'function') {
  const m = stage.makeBackdrop(), mat = m.material;
  check('backdrop is opaque and drawn first', !mat.transparent && m.renderOrder < 0, `renderOrder ${m.renderOrder}`);
  check('backdrop writes and tests no depth', !mat.depthWrite && !mat.depthTest);
  check('backdrop is never culled', m.frustumCulled === false);
  check('backdrop is in clip space (no camera matrices)', /gl_Position\s*=\s*vec4\(position\.xy/.test(mat.vertexShader) && !/projectionMatrix|modelViewMatrix/.test(mat.vertexShader));
  const p = m.geometry.attributes.position.array;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.length; i += 3) { lo = Math.min(lo, p[i], p[i + 1]); hi = Math.max(hi, p[i], p[i + 1]); }
  check('backdrop quad covers the whole view', lo <= -1 && hi >= 1, `x,y in [${lo}, ${hi}]`);
}
console.log(`\n${n - fails}/${n} checks passed`);
process.exit(fails ? 1 : 0);
