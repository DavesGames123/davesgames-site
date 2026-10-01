// ============================================================================
//  SDF FORGE  ·  tests.mjs — node tests.mjs
// ----------------------------------------------------------------------------
//  Pure checks of the modules the page is built on. Shaders are written to
//  OUT (env SDF_TEST_OUT, else the system temp dir) and validated with naga
//  (~/.cargo/bin/naga; the bare `naga` on PATH may be a different program).
//
//    doc ........ create, names, group, ungroup, clone, move, modifiers, paths
//    history .... undo and redo round trips, drag coalescing, no-op drop
//    codegen .... every primitive, boolean and modifier, every example: WGSL
//                 (renderer module and baked export) and GLSL through naga
//    field ...... the CPU field against closed forms, scale bounds, Lipschitz
//    mc ......... a closed sphere mesh with the right volume; examples closed
//    json ....... save and load round trip, rejection of bad files
//    gizmo / viewcube / panes ... the Forge invariants
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import * as D from './js/doc.js';
import * as M from './js/math.js';
import { History, applyRecord } from './js/history.js';
import * as C from './js/codegen.js';
import { compileField } from './js/field.js';
import { FRAME, PROBE } from './js/shader.js';
import { EXAMPLES } from './js/examples.js';
import * as MC from './js/mc.js';
import * as GZ from './js/gizmo.js';
import * as VC from './js/viewcube.js';
import * as PN from './js/panes.js';
import { projection, makeCam, basis } from './js/camera.js';

const OUT = process.env.SDF_TEST_OUT || join(tmpdir(), 'sdf-forge-tests');
const NAGA = join(homedir(), '.cargo/bin/naga');
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const section = s => console.log('\n== ' + s);
const close = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── doc ─────────────────────────────────────────────────────────────────────
section('doc');
{
  const d = D.newDoc();
  const ids = D.PRIM_TYPES.map((t, i) => D.addNode(d, D.makePrim(d, t, { pos: [i * 3, 1, 0] })).id);
  ok(d.nodes[ids[0]].name === 'Sphere001' && d.nodes[ids[1]].name === 'Box002', 'auto names Sphere001 Box002', d.nodes[ids[1]].name);
  ok(D.PRIM_TYPES.length === 12, '12 primitive types');
  const W0 = ids.slice(0, 3).map(id => D.worldMatrix(d, id));
  const g = D.groupNodes(d, ids.slice(0, 3), 'subtract', true, 0.2);
  ok(g && g.children.length === 3 && d.roots.includes(g.id) && !d.roots.includes(ids[0]), 'group wraps three nodes');
  ok(ids.slice(0, 3).every((id, i) => D.worldMatrix(d, id).every((v, j) => close(v, W0[i][j], 1e-9))), 'grouping keeps world transforms');
  g.rot = [0, 30, 0]; g.pos = [1, 2, 3];
  const W1 = ids.slice(0, 3).map(id => D.worldMatrix(d, id));
  const kids = D.ungroup(d, g.id);
  ok(kids.length === 3 && !d.nodes[g.id], 'ungroup removes the group');
  ok(kids.every((id, i) => D.worldMatrix(d, id).every((v, j) => close(v, W1[i][j], 1e-5))), 'ungroup bakes the group transform');
  const c = D.duplicate(d, ids[4], [2, 0, 0]);
  ok(c.id !== ids[4] && c.pos[0] === d.nodes[ids[4]].pos[0] + 2 && /\d{3}$/.test(c.name), 'clone has a new id, an offset and a new name');
  const g2 = D.groupNodes(d, [ids[5], ids[6]], 'union');
  const dg = D.duplicate(d, g2.id);
  ok(dg.children.length === 2 && dg.children.every(k => !g2.children.includes(k)), 'clone of a group copies the subtree');
  ok(!D.moveNode(d, g2.id, g2.children[0]), 'a group cannot move into its own child');
  ok(D.moveNode(d, ids[7], g2.id, 0) && g2.children[0] === ids[7], 'move into a group at an index');
  const m1 = D.addMod(d, ids[8], 'twist'), m2 = D.addMod(d, ids[8], 'round');
  ok(D.moveMod(d, ids[8], m2.id, -1) && d.nodes[ids[8]].mods[0].id === m2.id, 'reorder modifiers');
  ok(D.setPath(d, ids[8], `mods.${m1.id}.p.k`, 2.5) && D.getPath(d, ids[8], `mods.${m1.id}.p.k`) === 2.5, 'paths into the modifier stack');
  ok(D.removeMod(d, ids[8], m1.id) === 1 && d.nodes[ids[8]].mods.length === 1, 'remove a modifier');
  ok(D.isStructural('hidden') && D.isStructural(`mods.${m2.id}.on`) && !D.isStructural('p.r') && !D.isStructural('pos.0'), 'structural paths');
  const gone = D.removeNode(d, g2.id);
  ok(gone.length === 4 && gone.every(id => !d.nodes[id]), 'delete removes the subtree');
  // decision 16: eight corners
  const b = D.makePrim(d, 'box', { pos: [0, 1, 0], rot: [0, 45, 0], p: { w: 2, h: 2, d: 2 } }); D.addNode(d, b);
  const wb = D.worldBounds(d, b.id);
  ok(close(wb.hi[0], Math.SQRT2, 1e-9) && close(wb.lo[1], 0, 1e-9), 'rotated bounds use all eight corners', JSON.stringify(wb));
}

// ── history ─────────────────────────────────────────────────────────────────
section('history');
{
  let d = D.newDoc();
  const H = new History();
  const snaps = [D.toJSON(d)];
  const commit = (label, fn) => { const before = D.toJSON(d); fn(d); const after = D.toJSON(d); H.push({ kind: 'doc', label, before, after }); snaps.push(after); };
  const set = (id, path, value, opt) => { const before = D.getPath(d, id, path); D.setPath(d, id, path, value); H.push({ kind: 'set', label: 'set', changes: [{ id, path, before, after: value }] }, opt); };
  commit('a', x => D.addNode(x, D.makePrim(x, 'sphere')));
  commit('b', x => D.addNode(x, D.makePrim(x, 'box', { pos: [3, 1, 0] })));
  const sid = d.roots[0];
  H.begin('drag');
  for (let i = 1; i <= 30; i++) set(sid, 'pos', [i * 0.1, 0, 0]);
  H.end();
  snaps.push(D.toJSON(d));
  ok(H.done.length === 3, 'a drag of 30 writes is one record', H.done.length);
  H.begin('drag'); set(sid, 'p.r', 2); set(sid, 'p.r', 1); H.end();
  ok(H.done.length === 3, 'a drag back to the press point leaves no record');
  commit('c', x => D.groupNodes(x, x.roots.slice(), 'subtract', true, 0.3));
  commit('d', x => D.addMod(x, x.roots[0], 'twist'));
  set(sid, 'p.r', 1.4, { merge: true, now: 0 });
  H.push({ kind: 'set', label: 'set', changes: [{ id: sid, path: 'p.r', before: 1.4, after: 1.6 }] }, { merge: true, now: 100 });
  D.setPath(d, sid, 'p.r', 1.6);
  ok(H.done.length === 6, 'typed values within the merge window are one record', H.done.length);
  const final = D.toJSON(d);
  while (H.canUndo()) d = H.undo(d).doc;
  ok(D.toJSON(d) === snaps[0], 'undo all returns the empty document');
  while (H.canRedo()) d = H.redo(d).doc;
  ok(D.toJSON(d) === final, 'redo all returns the final document');
  d = H.undo(d).doc; d = H.undo(d).doc; d = H.redo(d).doc;
  ok(d.nodes[d.roots[0]].mods.length === 1 && d.nodes[sid].p.r === 1, 'undo, undo, redo lands between');
  const r = { kind: 'set', changes: [{ id: sid, path: 'pos', before: [0, 0, 0], after: [1, 1, 1] }] };
  applyRecord(d, r, 1); ok(d.nodes[sid].pos[1] === 1, 'applyRecord forward'); applyRecord(d, r, -1); ok(d.nodes[sid].pos[1] === 0, 'applyRecord back');
}

// ── codegen through naga ────────────────────────────────────────────────────
section('codegen (naga)');
const nagaRuns = [];
function naga(file, glsl = false) {
  try {
    const out = execFileSync(NAGA, glsl ? ['--input-kind', 'glsl', '--shader-stage', 'frag', file] : [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim();
  } catch (e) { return 'ERROR ' + (e.stdout || '') + (e.stderr || ''); }
}
function validateDoc(name, doc) {
  const L = C.buildLayout(doc), P = C.packParams(doc, L);
  const files = [
    [`${name}.wgsl`, C.genWGSL(doc, L) + FRAME, false],
    [`${name}.probe.wgsl`, C.genWGSL(doc, L) + PROBE, false],
    [`${name}.baked.wgsl`, C.genWGSLBaked(doc, L, P) + '\n@fragment fn fs(@builtin(position) q: vec4f) -> @location(0) vec4f { return vec4f(mapD(q.xyz)); }\n', false],
    [`${name}.frag`, '#version 450\n' + C.genGLSL(doc, L, P) + '\nlayout(location = 0) out vec4 o;\nvoid main() { o = vec4(mapD(gl_FragCoord.xyz)); }\n', true],
  ];
  for (const [f, code, gl] of files) {
    const p = join(OUT, f);
    writeFileSync(p, code);
    const res = naga(p, gl);
    nagaRuns.push(`${f}: ${res.split('\n').pop()}`);
    ok(/Validation successful/.test(res), 'naga ' + f, res.slice(0, 400));
  }
}
for (const t of D.PRIM_TYPES) {
  const d = D.newDoc();
  D.addNode(d, D.makePrim(d, t, { pos: [0.5, 1, -0.3], rot: [10, 20, 30], scl: [1, 1.5, 0.8] }));
  validateDoc('prim-' + t, d);
}
for (const op of Object.keys(D.OPS)) for (const smooth of [false, true]) {
  const d = D.newDoc();
  const a = D.addNode(d, D.makePrim(d, 'box')), b = D.addNode(d, D.makePrim(d, 'sphere', { pos: [0.6, 0.5, 0] })), c = D.addNode(d, D.makePrim(d, 'torus'));
  D.groupNodes(d, [a.id, b.id, c.id], op, smooth, 0.25);
  validateDoc(`bool-${op}${smooth ? '-smooth' : ''}`, d);
}
for (const m of D.MOD_TYPES) {
  const d = D.newDoc();
  const a = D.addNode(d, D.makePrim(d, 'roundbox'));
  D.addMod(d, a.id, m);
  const b = D.addNode(d, D.makePrim(d, 'capsule', { pos: [2, 0, 0] }));
  const g = D.groupNodes(d, [b.id], 'union'); D.addMod(d, g.id, m); D.addMod(d, g.id, 'round');
  validateDoc('mod-' + m, d);
}
{
  const d = D.newDoc();
  validateDoc('empty', d);
  const a = D.addNode(d, D.makePrim(d, 'sphere')); D.addMod(d, a.id, 'twist'); d.nodes[a.id].mods[0].on = false; d.nodes[a.id].hidden = false;
  const h = D.addNode(d, D.makePrim(d, 'box')); h.hidden = true;
  validateDoc('off-and-hidden', d);
}
for (const [k, e] of Object.entries(EXAMPLES)) validateDoc('example-' + k, e.build());

// ── the CPU field ───────────────────────────────────────────────────────────
section('field');
{
  const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const R = () => [rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4];
  const d = D.newDoc();
  D.addNode(d, D.makePrim(d, 'sphere', { pos: [1, 2, 3], p: { r: 1.5 } }));
  const F = compileField(d);
  let worst = 0;
  for (let i = 0; i < 200; i++) { const p = R(); worst = Math.max(worst, Math.abs(F.mapD(...p) - (Math.hypot(p[0] - 1, p[1] - 2, p[2] - 3) - 1.5))); }
  ok(worst < 2e-6, 'sphere field equals |p - c| - r', worst);
  const d2 = D.newDoc();
  D.addNode(d2, D.makePrim(d2, 'box', { pos: [0, 1, 0], rot: [0, 90, 0], p: { w: 2, h: 1, d: 4 } }));
  const F2 = compileField(d2);
  ok(close(F2.mapD(0, 1, 0), -0.5, 1e-6) && close(F2.mapD(3, 1, 0), 1, 1e-6) && close(F2.mapD(0, 1, 2), 1, 1e-6), 'rotated box: Y turn swaps width and depth');
  // non-uniform scale: same zero set sign, never more than the true distance
  const d3 = D.newDoc();
  D.addNode(d3, D.makePrim(d3, 'sphere', { scl: [2, 1, 1], p: { r: 1 } }));
  D.addNode(D.newDoc(), D.makePrim(D.newDoc(), 'sphere'));
  const F3 = compileField(d3);
  const ell = D.newDoc(); D.addNode(ell, D.makePrim(ell, 'ellipsoid', { p: { rx: 2, ry: 1, rz: 1 } }));
  const FE = compileField(ell);
  let signs = 0, over = 0;
  for (let i = 0; i < 400; i++) {
    const p = R(), a = F3.mapD(...p);
    const inside = (p[0] / 2) ** 2 + p[1] ** 2 + p[2] ** 2 < 1;
    if ((a < 0) !== inside) signs++;
    // a lower bound: a sphere of radius |a| around p holds no surface
    for (let k = 0; k < 6; k++) {
      const dir = M.norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]), q = M.add(p, M.scale(dir, Math.abs(a) * 0.999));
      const ins = (q[0] / 2) ** 2 + q[1] ** 2 + q[2] ** 2 < 1;
      if (ins !== inside) over++;
    }
  }
  ok(signs === 0 && over === 0, 'non-uniform scale keeps the sign and is a lower bound', `${signs} ${over}`);
  ok(Math.abs(FE.mapD(3, 0, 0) - 1) < 0.05, 'ellipsoid primitive is close to the true distance on its axis', FE.mapD(3, 0, 0));
  // Lipschitz: |d(p) - d(q)| <= L |p - q| for every example
  for (const [k, e] of Object.entries(EXAMPLES)) {
    const doc = e.build(), Fx = compileField(doc), L = 1 / Fx.stepK;
    let bad = 0;
    for (let i = 0; i < 300; i++) {
      const p = R(), q = M.add(p, M.scale(M.norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]), 0.05));
      if (Math.abs(Fx.mapD(...p) - Fx.mapD(...q)) > L * 0.05 * 1.02 + 1e-6) bad++;
    }
    ok(bad === 0, `example ${k}: the field obeys its Lipschitz bound ${L.toFixed(2)}`, bad);
  }
  // mapM agrees with mapD and names a real node
  const ex = EXAMPLES.flange.build(), FX = compileField(ex);
  let agree = 0, named = 0;
  for (let i = 0; i < 200; i++) { const p = R(); const m = FX.mapM(...p); if (Math.abs(m.d - FX.mapD(...p)) < 1e-9) agree++; if (FX.L.order[Math.round(m.id)] !== undefined) named++; }
  ok(agree === 200 && named === 200, 'mapM distance equals mapD; ids map to nodes', `${agree} ${named}`);
  // a parameter edit repacks without a recompile
  const before = FX.L.sig;
  ex.nodes[ex.roots[0]].pos = [0, 5, 0]; FX.update(ex);
  ok(C.buildLayout(ex).sig === before && FX.mapD(1.5, 5.25, 0) < 0, 'a parameter edit keeps the structure and moves the field');
}

// ── marching cubes ──────────────────────────────────────────────────────────
section('mc');
{
  const d = D.newDoc(); D.addNode(d, D.makePrim(d, 'sphere', { pos: [0, 1, 0], p: { r: 1 } }));
  const F = compileField(d);
  const m = MC.polygonize(F.mapD, { lo: [-1.1, -0.1, -1.1], hi: [1.1, 2.1, 1.1] }, 64);
  const s = MC.meshStats(m), V0 = 4 / 3 * Math.PI;
  ok(s.closed, 'sphere mesh is closed (each directed edge once, its reverse once)', JSON.stringify(s));
  ok(Math.abs(s.volume - V0) / V0 < 0.01, `sphere volume ${s.volume.toFixed(4)} within 1% of ${V0.toFixed(4)}`);
  for (const k of ['pawn', 'flange', 'chain']) {
    const doc = EXAMPLES[k].build(), Fx = compileField(doc), b = D.docBounds(doc);
    const pad = 0.1, bb = { lo: b.lo.map(v => v - pad), hi: b.hi.map(v => v + pad) };
    const mm = MC.polygonize(Fx.mapD, bb, 72, { stepK: Fx.stepK }), st = MC.meshStats(mm);
    ok(st.closed && st.volume > 0, `example ${k}: closed mesh, positive volume`, JSON.stringify({ closed: st.closed, vol: st.volume, tris: st.tris }));
    let out = 0;
    for (let i = 0; i < mm.pos.length; i += 3) for (let j = 0; j < 3; j++) if (mm.pos[i + j] < b.lo[j] - mm.h || mm.pos[i + j] > b.hi[j] + mm.h) out++;
    ok(out === 0, `example ${k}: every vertex inside the computed bounds`, out);
  }
  const obj = MC.toOBJ(m, MC.vertexNormals(F.mapD, m.pos, 0.01));
  ok(obj.split('\n').filter(l => l.startsWith('f ')).length === m.idx.length / 3, 'OBJ has one face line per triangle');
}

// ── JSON ────────────────────────────────────────────────────────────────────
section('json');
{
  for (const [k, e] of Object.entries(EXAMPLES)) {
    const doc = e.build(), t = D.toJSON(doc), back = D.fromJSON(t);
    ok(D.toJSON(back) === t, `example ${k}: save and load round trip`);
    ok(C.buildLayout(back).sig === C.buildLayout(doc).sig, `example ${k}: same structure after load`);
  }
  let threw = 0;
  for (const bad of ['{}', '{"version":1,"roots":[5],"nodes":{}}', '{"version":1,"roots":[1],"nodes":{"1":{"id":1,"kind":"prim","type":"teapot","pos":[0,0,0],"rot":[0,0,0],"scl":[1,1,1],"mods":[]}}}', 'null'])
    try { D.fromJSON(bad); } catch (e) { threw++; }
  ok(threw === 4, 'bad files are refused', threw);
}

// ── gizmo, view cube, panes ─────────────────────────────────────────────────
section('gizmo / viewcube / panes');
{
  const P = projection(makeCam('persp', { target: [0, 0, 0], dist: 10 }), 800, 600, false);
  const c = [0.5, 0.3, -0.2];
  for (const tool of ['move', 'rotate', 'scale']) {
    const G = GZ.build(P, c, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], tool);
    for (const h of G.handles) {
      const at = h.kind === 'axis' ? h.seg[1] : h.kind === 'plane' ? h.quad[0].map((v, i) => (h.quad[0][i] + h.quad[2][i]) / 2) : h.kind === 'center' ? G.pc : h.pts.find(p => p && p[2]);
      if (!at) continue;
      const S = GZ.begin(G, h.id, at[0], at[1]);
      GZ.drag(S, at[0] + 37, at[1] - 21); GZ.drag(S, at[0] - 80, at[1] + 44);
      const r = GZ.drag(S, at[0], at[1]);
      const zero = r.move ? r.move.every(v => Math.abs(v) < 1e-9) : r.rot ? Math.abs(r.rot.angle) < 1e-9 : r.scale.every(v => Math.abs(v - 1) < 1e-9);
      ok(zero, `gizmo ${tool} ${h.id}: back at the press point gives the identity`, JSON.stringify(r));
    }
  }
  const G = GZ.build(P, c, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 'rotate');
  const h = G.handles.find(x => x.id === 'r1'), p0 = h.pts.find(p => p && p[2]);
  const S = GZ.begin(G, 'r1', p0[0], p0[1]);
  const r = GZ.drag(S, p0[0] + 60, p0[1] + 25);
  const R = M.m3mul(M.axisAngleM3(r.rot.axis, r.rot.angle), M.eulerToM3([12, -40, 77]));
  ok(M.isOrtho(R, 1e-9) && Math.abs(r.rot.angle) > 0.01, 'a ring drag gives an orthonormal matrix');
  const back = M.eulerToM3(M.m3ToEuler(R));
  ok(back.every((v, i) => close(v, R[i], 1e-9)), 'Euler decomposition round trip');
  ok(GZ.hit(GZ.build(P, c, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 'move'), -50, -50) === null, 'no handle far from the gizmo');
  // view cube: corner beats edge beats face
  const B = basis(makeCam('iso'));
  const L = VC.layout({ x: 0, y: 0, size: 120 }, { right: B.right, up: B.up, fwd: B.fwd });
  ok(L.faces.length === 3 && L.faces.map(f => f.label).sort().join() === 'FRONT,RIGHT,TOP', 'iso view shows TOP FRONT RIGHT', L.faces.map(f => f.label).join());
  const top = L.faces.find(f => f.label === 'TOP');
  const centre = VC.pick(L, top.o[0], top.o[1]);
  ok(centre && centre.rank === 0 && centre.dir.join() === '0,1,0', 'face centre picks the face');
  const corner = top.quad[0].map((v, i) => v * 0.97 + top.o[i] * 0.03);
  const cp = VC.pick(L, corner[0], corner[1]);
  ok(cp && cp.rank === 2, 'a face corner picks the corner view', JSON.stringify(cp && cp.dir));
  const L2 = VC.layout({ x: 0, y: 0, size: 120 }, { ...B, eye: [999, 3, 1] });
  ok(JSON.stringify(L2.faces.map(f => f.quad)) === JSON.stringify(L.faces.map(f => f.quad)), 'the cube ignores the eye position');
  // panes
  const S4 = PN.newPanes(); S4.layout = 'quad';
  const Rq = PN.rects(S4, 800, 600);
  ok(Rq.length === 4 && PN.paneAt(Rq, Rq[0].w - 1, 10).slot === 0 && PN.paneAt(Rq, Rq[0].w, 10) === null && PN.paneAt(Rq, Rq[1].x, 10).slot === 1, 'half-open pane rectangles with a gutter');
  const cam = JSON.stringify(S4.slots[3].cam);
  S4.layout = 'single'; S4.layout = 'quad';
  ok(JSON.stringify(S4.slots[3].cam) === cam, 'a slot keeps its camera across layouts');
  ok(PN.gates(S4.slots[0]).join() === '1,0,0' && PN.gates(S4.slots[1]).join() === '0,1,0', 'axis panes grid their own plane only');
}

console.log('\nnaga runs:'); console.log(nagaRuns.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
