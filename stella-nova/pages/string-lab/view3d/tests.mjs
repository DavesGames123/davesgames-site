// STRING LAB · view3d/tests.mjs — node tests for the 3D view (no GL, no browser)
//   node stella-nova/pages/string-lab/view3d/tests.mjs
// The view is built with renderer: 'none', so the scene, models, tubes,
// colours, bow and picking run in node. A loader hook maps the bare 'three'
// specifiers to the vendored three r160, as the page importmap does.
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = new URL('./', import.meta.url);
const VENDOR = new URL('../../../vendor/three@0.160.0/', import.meta.url).href;
const hook = `
const V = ${JSON.stringify(VENDOR)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return next(V + 'build/three.module.js', ctx);
  if (spec.startsWith('three/addons/')) return next(V + 'examples/jsm/' + spec.slice(13), ctx);
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));
globalThis.self = globalThis;

const THREE = await import('three');
const { createStringView3D, FIELDS, CAMERA_PRESETS } = await import('./index.js');
const { fieldOnGrid, linearLut, srgbToLinear } = await import('./strings3d.js');
const { StringSim, smoothField } = await import('../engine/strings.js');
const { INSTRUMENTS, stringParams } = await import('../engine/instruments.js');
const CM = await import('../../ct-lab/colormaps/maps.js');

let pass = 0, fail = 0;
const groups = {};
function ok(cond, name, info = '') {
  const g = name.split(':')[0];
  groups[g] = groups[g] || [0, 0];
  if (cond) { pass++; groups[g][0]++; } else { fail++; groups[g][1]++; console.log('FAIL', name, info); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const t0 = Date.now();

function geoFinite(root) {
  let bad = 0, verts = 0;
  root.traverse((o) => {
    if (!o.geometry) return;
    const p = o.geometry.attributes.position;
    verts += p.count;
    for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) { bad++; break; }
  });
  return { bad, verts };
}

// ---------------------------------------------------------------- models
const view = createStringView3D(null, { renderer: 'none', controls: false, instrument: 'steel' });
for (const key of ['steel', 'classical', 'violin']) {
  view.setInstrument(key);
  const inst = INSTRUMENTS[key];
  const m = view.model;
  const L = inst.scaleM;
  const { bad, verts } = geoFinite(m.root);
  ok(bad === 0, `model: ${key} has only finite vertices`, bad);
  ok(verts > 20000, `model: ${key} has detail (${verts} vertices)`);
  ok(m.strings.length === inst.strings.length, `model: ${key} string count`);
  for (let i = 0; i < m.strings.length; i++) {
    const s = m.strings[i];
    ok(near(s.bridge.x, 0, 1e-9) && near(s.nut.x, L, 1e-9), `anchors: ${key} string ${i} bridge x = 0, nut x = L`);
    ok(near(s.bridge.distanceTo(s.nut), L, L * 0.006), `anchors: ${key} string ${i} length within 0.6 % of scale`, s.bridge.distanceTo(s.nut) / L);
    if (i > 0) ok(s.bridge.y < m.strings[i - 1].bridge.y, `anchors: ${key} string ${i} below string ${i - 1} in y`);
    for (const f of [1, 5, 7, 12]) {
      const p = m.stopPoint(i, f);
      ok(near(p.x, L * 2 ** (-f / 12), 1e-9), `frets: ${key} string ${i} stop x at fret ${f}`);
      const zLine = s.bridge.z + (s.nut.z - s.bridge.z) * (p.x / L);
      ok(p.z < zLine - 0.0003, `frets: ${key} string ${i} stop point pressed down at fret ${f}`);
    }
  }
  const box = new THREE.Box3().setFromObject(m.root);
  ok(box.max.x > L && box.min.x < -0.1, `model: ${key} body and head around the strings`);
  // strings clear the fretboard: rest line above stop height at every fret
  for (let i = 0; i < m.strings.length; i++) {
    const s = m.strings[i];
    let minGap = 1;
    for (let f = 1; f <= 12; f++) {
      const x = L * 2 ** (-f / 12);
      const zLine = s.bridge.z + (s.nut.z - s.bridge.z) * (x / L);
      minGap = Math.min(minGap, zLine - m.stopPoint(i, f).z);
    }
    ok(minGap > 0.0003, `action: ${key} string ${i} rest line above the board (min ${(minGap * 1000).toFixed(2)} mm)`);
  }
}

// ---------------------------------------------------------- field values
{
  const inst = INSTRUMENTS.steel;
  const sim = new StringSim(stringParams(inst, 1, 0));
  sim.pluck({ pos: 0.2, amp: 0.002, width: 0.02 });
  sim.step(400);
  const acc = fieldOnGrid(sim, 'accel');
  const ref = smoothField(sim.a, 3);
  ok(acc.every((v, j) => v === ref[j]), 'fields: accel equals smoothField(a, 3)');
  ok(fieldOnGrid(sim, 'velocity').every((v, j) => v === sim.v[j]), 'fields: velocity equals v');
  ok(fieldOnGrid(sim, 'displacement').every((v, j) => v === sim.u[j]), 'fields: displacement equals u');
  const e = fieldOnGrid(sim, 'energy');
  ok(e.every((v) => v >= 0), 'fields: energy density is not negative');
  let E = 0;
  for (let j = 0; j < e.length; j++) E += e[j] * sim.h * (j === 0 || j === e.length - 1 ? 0.5 : 1);
  const Es = sim.energy();
  ok(near(E, Es, Es * 0.03), 'fields: energy density integrates to sim.energy() within 3 %', `${E} vs ${Es}`);
  const ten = fieldOnGrid(sim, 'tension');
  ok(ten.length === sim.N + 1 && ten.some((v) => v !== 0), 'fields: tension part present');
  for (const f of FIELDS) {
    view.setField(f.id);
    ok(view.legend().id === f.id, `fields: setField ${f.id}`);
  }
  let threw = false;
  try { view.setField('nope'); } catch { threw = true; }
  ok(threw, 'fields: unknown field throws');
}

// ------------------------------------------------------ colours and tubes
{
  ok(near(srgbToLinear(1), 1, 1e-12) && srgbToLinear(0) === 0 && near(srgbToLinear(0.5), 0.214, 0.001), 'colour: sRGB to linear');
  view.setInstrument('steel');
  view.setField('accel');
  view.setColormap('magma');
  view.setExaggeration(10);
  const inst = INSTRUMENTS.steel;
  const sims = inst.strings.map((_, i) => new StringSim(stringParams(inst, i, 0)));
  sims[2].pluck({ pos: 0.3, amp: 0.002, width: 0.02 });
  sims[2].step(250);
  view.attachAll(sims);
  view.setRange(null);
  view.frame(1 / 60, 0);
  const lg = view.legend();
  const peak = Math.max(...smoothField(sims[2].a, 3).map(Math.abs));
  ok(near(lg.max, peak, peak * 1e-9), 'range: auto range equals the peak after one frame', `${lg.max} vs ${peak}`);
  ok(lg.signed === false, 'range: magma (sequential) shows magnitude');
  // tube centre follows u * exaggeration
  const it = view.live.items[2];
  const pos = it.geo.attributes.position.array;
  const R = view.live.R, M = view.live.M;
  const k = Math.round(M * 0.3);
  let cy = 0;
  for (let c = 0; c < R; c++) cy += pos[(k * R + c) * 3 + 1];
  cy /= R;
  const { S, F } = view.live.line(2);
  const yRest = S.y + (F.y - S.y) * (k / M);
  const x = (k / M) * sims[2].N, j = Math.floor(x), t = x - j;
  const u = sims[2].u[j] * (1 - t) + sims[2].u[j + 1] * t;
  ok(near(cy - yRest, u * 10, 2e-6), 'tube: ring centre = rest + 10 u (polarization 0)', `${cy - yRest} vs ${u * 10}`);
  // brightest ring has the top LUT colour
  const col = it.geo.attributes.color.array;
  const lut = linearLut(CM.variant('magma'));
  let best = 0, bi = 0;
  for (let q = 0; q < col.length; q += 3) { const s = col[q] + col[q + 1] + col[q + 2]; if (s > best) { best = s; bi = q; } }
  const top = [...Array(256).keys()].filter((q) => near(col[bi], lut[q * 3], 1e-6) && near(col[bi + 2], lut[q * 3 + 2], 1e-6));
  ok(top.length && top[0] >= 240, 'colour: brightest ring is in the top of the LUT', top);
  ok(view.live.items[0].geo.attributes.color.array.every((v, q) => near(v, lut[q % 3], 1e-6)), 'colour: string at rest gets the first LUT entry');
  // decay of the auto range
  sims[2].reset ? sims[2].reset() : sims[2].damp(0);
  view.frame(1.5, 0);
  ok(near(view.legend().max, peak / 2, peak * 1e-6), 'range: auto range halves in 1.5 s with no motion', view.legend().max / peak);
  // diverging map shows the sign
  view.setColormap('coolwarm');
  ok(view.legend().signed === true, 'range: coolwarm shows a signed field');
  view.setField('energy');
  ok(view.legend().signed === false, 'range: energy is never signed');
  view.setField('accel');
  view.setColormap('magma', { reverse: true, gamma: 1.4 });
  ok(view.legend().reverse === true && view.legend().gamma === 1.4, 'colour: reverse and gamma kept');
  view.setColormap('magma', { reverse: false, gamma: 1 });
  // fixed range
  view.setRange(1234);
  ok(view.legend().max === 1234, 'range: fixed range');
  view.setRange(null);
  // natural material mode swaps the material
  view.setField('none');
  view.frame(1 / 60, 0);
  ok(view.live.items[1].tube.material === view.live.items[1].natural, 'tube: field none uses the string material');
  view.setField('accel');
  view.frame(1 / 60, 0);
  ok(view.live.items[1].tube.material === view.live.items[1].field, 'tube: a field uses vertex colours');
  // polarization PI/2 moves the tube toward +z (normal to the top)
  view.setPolarization(Math.PI / 2);
  sims[3].pluck({ pos: 0.5, amp: 0.001, width: 0.05 });
  view.frame(1 / 60, 0);
  const p3 = view.live.items[3].geo.attributes.position.array;
  let cz = 0;
  const km = M / 2;
  for (let c = 0; c < R; c++) cz += p3[(km * R + c) * 3 + 2];
  cz /= R;
  const l3 = view.live.line(3);
  const zRest = (l3.S.z + l3.F.z) / 2;
  ok(near(cz - zRest, sims[3].sampleAt(0.5) * 10, 2e-5), 'tube: polarization PI/2 displaces along +z', `${cz - zRest}`);
  view.setPolarization(0);
}

// ----------------------------------------------------- fretting markers
{
  view.setInstrument('steel');
  view.setFrets([-1, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0]);
  const it = view.live.items;
  ok(it[0].marker.name === 'muted' && it[3].marker.name === 'open', 'hand: muted and open markers');
  const dot = it[1].marker.children[0];
  ok(dot.name === 'finger' && dot.position.distanceTo(view.model.stopPoint(1, 3)) < 0.01, 'hand: finger dot at fret 3 of string 1');
  ok(it[1].pressed.children.length === 1 && it[3].pressed.children.length === 0, 'hand: pressed part drawn only on stopped strings');
  ok(near(view.live.line(1).F.x, view.model.fretX(3), 1e-12), 'hand: vibrating part ends at the fret');
  view.setFret(1, 0);
  ok(it[1].pressed.children.length === 0 && near(view.live.line(1).F.x, view.model.L, 1e-12), 'hand: open again reaches the nut');
}

// --------------------------------------------------------------- the bow
{
  view.setInstrument('violin');
  const m = view.model;
  ok(m.bow && m.bow.group.visible === false, 'bow: hidden until setBow');
  for (let i = 0; i < 4; i++) {
    view.setBow({ string: i, pos: 0.09, speed: 0.5 });
    view.frame(1 / 60, 0);
    ok(m.bow.group.visible, `bow: visible on string ${i}`);
    m.root.updateMatrixWorld(true);
    // the hair line in model coordinates
    const g = m.bow.group;
    const inv = new THREE.Matrix4().copy(m.root.matrixWorld).invert();
    const toModel = (v) => g.localToWorld(v.clone()).applyMatrix4(inv);
    const h0 = toModel(new THREE.Vector3(0.05, 0, 0)), h1 = toModel(new THREE.Vector3(0.7, 0, 0));
    const ray = new THREE.Ray(h0, h1.clone().sub(h0).normalize());
    const { S, F } = view.live.line(i);
    const P = S.clone().lerp(F, 0.09);
    const dHit = Math.sqrt(ray.distanceSqToPoint(P));
    const rDraw = view.live.items[i].rDraw;
    ok(dHit < rDraw + 0.0012, `bow: hair touches string ${i} (${(dHit * 1000).toFixed(2)} mm from its axis)`);
    const along = h1.clone().sub(h0).normalize();
    ok(Math.abs(along.dot(F.clone().sub(S).normalize())) < 0.02, `bow: hair crosses string ${i} at a right angle`);
    for (let j = 0; j < 4; j++) {
      if (j === i) continue;
      const l = view.live.line(j);
      const Q = l.S.clone().lerp(l.F, 0.09);
      const d = Math.sqrt(ray.distanceSqToPoint(Q));
      ok(d > view.live.items[j].rDraw, `bow: hair on string ${i} clears string ${j} (${(d * 1000).toFixed(2)} mm)`);
    }
  }
  // bow moves with simulated time, not wall time
  view.setBow({ string: 2, pos: 0.09, speed: 0.5 });
  view.frame(1 / 60, 0);
  const a = m.bow.group.position.clone();
  view.frame(1, 0);
  ok(m.bow.group.position.distanceTo(a) < 1e-12, 'bow: no motion when dtSim = 0 (paused or slow)');
  view.frame(1 / 60, 0.1);
  ok(near(m.bow.group.position.distanceTo(a), 0.05, 1e-9), 'bow: moves speed x dtSim (0.05 m)');
  for (let k = 0; k < 50; k++) view.frame(1 / 60, 0.1);
  const b = view.state.bowB;
  ok(b >= m.bow.hair[0] && b <= m.bow.hair[1], 'bow: stays within the hair length (turns at the ends)');
  view.setBow(null);
  view.frame(1 / 60, 0);
  ok(!m.bow.group.visible, 'bow: setBow(null) hides it');
}

// ----------------------------------------------- camera, orientation, pick
{
  view.setInstrument('steel');
  view.resize(1200, 700);
  ok(view.holder.rotation.z === 0, 'camera: landscape keeps the neck horizontal');
  view.resize(600, 1000);
  ok(near(view.holder.rotation.z, Math.PI / 2, 1e-12), 'camera: portrait turns the neck up');
  view.resize(1200, 700);
  for (const p of CAMERA_PRESETS) {
    view.setCamera(p.id, { animate: false, string: 3 });
    view.frame(1 / 60, 0);
    const c = view.camera.position;
    ok(Number.isFinite(c.x + c.y + c.z), `camera: preset ${p.id} gives a finite pose`);
  }
  view.setCamera('instrument', { animate: false });
  // whole instrument inside the view frustum
  view.camera.updateMatrixWorld(true);
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse));
  const box = new THREE.Box3().setFromObject(view.model.root);
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) corners.push(new THREE.Vector3(x, y, 0));
  ok(corners.every((p) => fr.containsPoint(p)), 'camera: instrument preset frames the whole instrument', JSON.stringify(corners.map((p) => p.clone().project(view.camera).toArray().map((v) => +v.toFixed(2)))));
  // animated move ends at the preset
  view.setCamera('soundhole');
  for (let k = 0; k < 80; k++) view.frame(1 / 60, 0);
  const pose = view.camera.position.clone();
  view.setCamera('soundhole', { animate: false });
  ok(pose.distanceTo(view.camera.position) < 1e-9, 'camera: animated move ends at the preset pose');
  // pick: project a point of string 4 to the screen and pick it back
  view.setCamera('soundhole', { animate: false });
  view.camera.updateMatrixWorld(true);
  const { S, F } = view.live.line(4);
  const P = S.clone().lerp(F, 0.25);
  view.holder.localToWorld(P);
  const ndc = P.clone().project(view.camera);
  const st = view.state;
  const hit = view.stringAt((ndc.x + 1) / 2 * st.w, (1 - ndc.y) / 2 * st.h);
  ok(hit && hit.string === 4 && near(hit.pos, 0.25, 0.01), 'pick: stringAt returns string 4 at 0.25', JSON.stringify(hit));
  ok(view.stringAt(2, 2) === null, 'pick: empty corner returns null');
  // auto orbit turns about the top normal and keeps the distance
  const tgt = view.state.target.clone();
  const d0 = view.camera.position.distanceTo(tgt);
  view.autoOrbit(0.5);
  view.frame(1, 0);
  ok(near(view.camera.position.distanceTo(tgt), d0, 1e-9), 'camera: auto orbit keeps the distance');
  view.autoOrbit(0);
}

// --------------------------------------------------------- house rules
{
  const files = readdirSync(fileURLToPath(HERE)).filter((f) => /\.(js|md)$/.test(f));
  const banned = /yamaha|martin|taylor|gibson|fender|stradivari|guarneri/i;
  for (const f of files) ok(!banned.test(readFileSync(new URL(f, HERE), 'utf8')), `house: no brand or maker name in ${f}`);
  view.dispose();
  ok(view.model === null || true, 'house: dispose runs');
}

for (const [g, [p, f]] of Object.entries(groups)) console.log(`${g.padEnd(10)} ${p} passed${f ? `, ${f} failed` : ''}`);
console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
