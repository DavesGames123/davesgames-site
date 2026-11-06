// ============================================================================
//  ALTO SAX MECHANISM  ·  tests.mjs — node checks, no browser
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/alto-sax/tests.mjs      (V=1 shows each pass)
//  Exit code 1 when a check fails.
//
//  GREP MAP
//    section('link ........... node --check, imports, main.js link in node
//    section('data ........... ids, rods, spans, cups, holes, groups, chart
//    section('graph .......... every linkage resolves; the graph has no cycle
//    section('kinematics ..... every chart note: holes, vent, octave pip
//    section('mechanisms ..... octave swap, G# articulation, bars, low keys
//    section('scene .......... three.js build in node: parts, press direction,
//                              cup seat and lift
//    section('saver .......... plan, director with a stub view, cut(key)
//    section('page ........... head order, ids, [hidden] rule, scripts
// ============================================================================
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import * as M from './model.js';
import { buildSax } from './scene.js';
import { makePlan, startSaver, runNotes, bandFrame, PATTERNS, DUR, SAVER_GROUPS } from './saver.js';
import { envelope, createSynth } from './synth.js';

const here = new URL('./', import.meta.url);
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; if (process.env.V) console.log('  ok  ', msg); } else { fails++; console.log('  FAIL', msg); } };
const section = n => console.log(`\n-- ${n}`);
const uniq = a => new Set(a).size === a.length;
const finite = a => a.every(Number.isFinite);

section('link: syntax, imports, main.js in node');
{
  for (const f of ['model.js', 'scene.js', 'synth.js', 'saver.js', 'main.js', 'tests.mjs']) {
    const c = spawnSync(process.execPath, ['--check', new URL(f, here).pathname], { encoding: 'utf8' });
    ok(c.status === 0, `node --check ${f}${c.status ? ': ' + c.stderr : ''}`);
  }
  // main.js: resolve 'three' to the vendored copy, then import. Every named
  // import must link; the first browser global then throws ReferenceError.
  const vendor = new URL('../../vendor/three@0.160.0/', here).href;
  const hook = 'data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
    if (s === 'three') return next(${JSON.stringify(vendor + 'build/three.module.js')}, c);
    if (s.startsWith('three/addons/')) return next(${JSON.stringify(vendor + 'examples/jsm/')} + s.slice(13), c);
    return next(s, c); }`);
  const url = new URL('main.js', here).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { register } from 'node:module'; register(${JSON.stringify(hook)}); await import(${JSON.stringify(url)});`], { encoding: 'utf8' });
  const err = (r.stderr || '').split('\n').find(s => /Error/.test(s)) || '';
  ok(/ReferenceError: (document|window|matchMedia|addEventListener|requestAnimationFrame|innerWidth) is not defined/.test(err), `main.js links and stops at a browser global: ${err.trim() || 'no error'}`);
  ok(typeof makePlan === 'function' && typeof buildSax === 'function' && typeof M.solve === 'function', 'saver.js, scene.js and model.js exports');
}

section('data: ids, rods, spans, cups, holes, groups, chart');
{
  ok(uniq(M.HOLES.map(h => h.id)) && uniq(M.RODS.map(r => r.id)) && uniq(M.KEYS.map(k => k.id)), 'hole, rod and key ids are unique');
  ok(uniq(M.TOUCHES.map(t => t.id)) && uniq(M.LINKS.map(l => l.id)) && uniq(M.FINGERINGS.map(f => f.id)), 'touch, link and fingering ids are unique');
  const kinds = new Set(['pearl', 'pearl-small', 'thumb', 'palm', 'spatula', 'lever']);
  for (const k of M.KEYS) {
    const r = M.ROD[k.rod];
    ok(!!r, `${k.id}: rod ${k.rod} exists`);
    if (r && !r.neckAxis) ok(k.span[0] >= r.s0 && k.span[1] <= r.s1 && k.span[0] < k.span[1], `${k.id}: span ${k.span} is inside rod ${r.id} [${r.s0}, ${r.s1}]`);
    ok(!!M.GROUP[k.group], `${k.id}: group ${k.group} exists`);
    ok(k.what && k.what.length > 20, `${k.id}: has a description`);
    ok(k.spring === null || k.spring === 'needle' || k.spring === 'flat', `${k.id}: spring kind`);
    ok(k.cups.every(h => M.HOLE[h]), `${k.id}: every cup covers a hole that exists`);
    ok(k.touches.every(t => kinds.has(t.kind) && finite([t.s, t.phi, t.dr])), `${k.id}: touch kinds and places`);
    ok(k.cups.length || k.touches.length || M.LINKS.some(l => M.linkEnds(l)[1].includes(k.id)), `${k.id}: has a cup, a touch, or a link that drives it`);
  }
  // spans on one rod do not overlap
  const byRod = new Map();
  for (const k of M.KEYS) { if (!byRod.has(k.rod)) byRod.set(k.rod, []); byRod.get(k.rod).push(k); }
  for (const [rid, ks] of byRod) {
    const s = ks.filter(k => !M.ROD[rid].neckAxis).map(k => k.span).sort((a, b) => a[0] - b[0]);
    let good = true; for (let i = 1; i < s.length; i++) if (s[i][0] < s[i - 1][1] + 2) good = false;
    ok(good, `rod ${rid}: ${ks.length} key tube(s), no overlap, 2 mm gap or more`);
  }
  ok(M.RODS.every(r => byRod.has(r.id)), 'every rod carries a key');
  for (const h of M.HOLES) {
    const n = M.KEYS.filter(k => k.cups.includes(h.id)).length;
    ok(n === 1, `${h.id}: covered by exactly one cup (${n})`);
  }
  const chain = M.HOLES.filter(h => h.kind === 'chain').sort((a, b) => a.s - b.s);
  ok(chain.map(h => h.vent).join() === Array.from({ length: 15 }, (_, i) => 73 - i).join(), 'the chain has one hole for each semitone, C#5 down to B3, in order of s');
  // the body part of the chain follows the 6% rule (CONTRACT F2) within 35%
  const body = chain.filter(h => h.s < M.S_BOW);
  let law = true; for (let i = 1; i < body.length; i++) { const k = body[i - 1].s / body[i].s; if (k < 0.94 * 0.96 || k > 0.965) law = false; }
  ok(law, 'body chain: each hole is about 4 to 6% higher up than the next (CONTRACT F2)');
  ok(M.HOLES.filter(h => h.kind === 'register').length === 2, 'two register holes (body and neck pip)');
  ok(M.GROUPS.every(g => /^#[0-9a-f]{6}$/i.test(g.color) && g.text.length > 80), 'every group has a colour and an explanation');
  for (const f of M.FINGERINGS) ok(f.touches.every(t => M.TOUCH[t]) && uniq(f.touches), `fingering ${f.id}: every touch exists, no repeats`);
  const main = M.MAIN_FINGERINGS.map(f => f.note);
  ok(main.join() === Array.from({ length: M.HIGH - M.LOW + 1 }, (_, i) => M.LOW + i).join(), `the chart covers every note from Bb3 to F#6 (${main.length} notes)`);
  ok(M.FINGERINGS.length - main.length >= 8, `alternative fingerings: ${M.FINGERINGS.length - main.length}`);
  ok(M.LINKS.every(l => l.why && l.why.length > 20), 'every linkage has an explanation');
}

section('graph: every linkage resolves; no cycle');
{
  for (const l of M.LINKS) {
    const [d, t] = M.linkEnds(l);
    ok(['drive', 'hold', 'swap'].includes(l.kind) && !!M.KEY[d] && t.every(x => M.KEY[x]) && !t.includes(d), `${l.id} (${l.kind}): ${d} -> ${t.join(', ')} resolve`);
    if (l.kind === 'hold') ok(l.when === 'rest' || l.when === 'actuated', `${l.id}: hold state ${l.when}`);
    ok(['felt', 'cork', 'screw'].includes(l.adjust), `${l.id}: adjustment ${l.adjust}`);
  }
  ok(!!M.topoOrder(), 'Kahn order exists (no cycle)');
  // an independent depth-first check
  const adj = new Map(M.KEYS.map(k => [k.id, []]));
  for (const [a, b] of M.edges()) adj.get(a).push(b);
  const state = new Map(); let cyc = null;
  const dfs = (u, path) => { state.set(u, 1); for (const v of adj.get(u)) { if (state.get(v) === 1) { cyc = [...path, u, v]; return; } if (!state.get(v)) dfs(v, [...path, u]); if (cyc) return; } state.set(u, 2); };
  for (const k of M.KEYS) if (!state.get(k.id) && !cyc) dfs(k.id, []);
  ok(!cyc, `depth-first search finds no cycle${cyc ? ': ' + cyc.join(' > ') : ''}`);
  // every key that a touch cannot reach is a dead part
  const reach = new Set(M.TOUCHES.map(t => t.key)), q = [...reach];
  while (q.length) { const u = q.pop(); for (const v of adj.get(u)) if (!reach.has(v)) { reach.add(v); q.push(v); } }
  ok(M.KEYS.every(k => reach.has(k.id)), 'every key can be moved from some touch piece');
}

section('kinematics: every chart note');
{
  const chainAbove = s => M.HOLES.filter(h => h.vent != null && h.s < s);
  for (const f of M.FINGERINGS) {
    const r = M.solve(f.touches), nm = M.noteName(f.note) + (f.alt ? ` (${f.alt})` : '');
    ok(r.note === f.note, `${nm}: solver note ${M.noteName(r.note)}`);
    // the acoustic rule, checked from the hole states, not from the solver note
    const vent = r.vent ? M.HOLE[r.vent] : null;
    const above = vent ? chainAbove(vent.s) : M.HOLES.filter(h => h.vent != null);
    ok(above.every(h => !r.holes[h.id]), `${nm}: every tone hole above the first open hole is closed`);
    if (vent) ok(r.holes[vent.id], `${nm}: the vent ${vent.id} is open`);
    const want = f.note < 74 ? null : f.note <= 80 ? 'body' : 'neck';
    ok(r.octave === want && !(r.holes.h_oct_body && r.holes.h_oct_neck), `${nm}: octave pip ${r.octave || 'none'} (CONTRACT F5, F11)`);
    // the pad states that the note needs, from the rest state of each cup
    const pal = ['h_d5', 'h_eb5', 'h_e5', 'h_f5', 'h_fs5'];
    if (f.note < 86 && f.id !== 'F6-frontf') ok(pal.every(h => !r.holes[h]), `${nm}: palm and high holes closed`);
  }
  // a few notes in full, written by hand from CONTRACT section 3
  const openSet = r => M.HOLES.filter(h => r.holes[h.id]).map(h => h.id).sort().join(' ');
  const G4 = M.solve(['t_b', 't_a', 't_g']);
  ok(openSet(G4) === ['h_g4', 'h_fs4', 'h_f4', 'h_e4', 'h_d4', 'h_c4', 'h_b3'].sort().join(' '), `G4 open holes: ${openSet(G4)}`);
  const D4 = M.solve(['t_b', 't_a', 't_g', 't_f', 't_e', 't_d']);
  ok(openSet(D4) === ['h_d4', 'h_c4', 'h_b3'].sort().join(' '), `low D: three open holes (CONTRACT F6): ${openSet(D4)}`);
  const Cs4 = M.solve(['t_b', 't_a', 't_g', 't_f', 't_e', 't_d', 't_lcs']);
  ok(openSet(Cs4) === ['h_cs4', 'h_c4', 'h_b3'].sort().join(' '), `low C#: three open holes (CONTRACT F6, F27): ${openSet(Cs4)}`);
  const Bb3 = M.solve(['t_b', 't_a', 't_g', 't_f', 't_e', 't_d', 't_lbb']);
  ok(openSet(Bb3) === '', `low Bb: every tone hole closed, the bell end sounds: "${openSet(Bb3)}"`);
  const Cs5 = M.solve([]);
  ok(openSet(Cs5) === M.HOLES.filter(h => M.KEY[M.HOLE_CUP[h.id]].restOpen).map(h => h.id).sort().join(' '), 'no key down: exactly the sprung-open holes are open');
}

section('mechanisms: octave, G#, bars, low keys');
{
  const LH = ['t_b', 't_a', 't_g'], RH = ['t_f', 't_e', 't_d'];
  let r = M.solve(['t_oct']);
  ok(r.held.has('k_obody') && r.act.has('k_lift') && r.act.has('k_oneck') && !r.act.has('k_obody'), 'thumb alone: the G foot holds the body key, the swivel lifts the pin key and the neck key (F12)');
  ok(r.links.get('l_swap') === 'b' && r.links.get('l_gfoot') === 'hold', 'thumb alone: the swap goes to the pin key; the G foot holds');
  r = M.solve(['t_oct', 't_g']);
  ok(r.act.has('k_obody') && !r.act.has('k_oneck') && !r.held.has('k_obody') && r.links.get('l_swap') === 'a', 'thumb + G: the body key opens and the neck key stays shut (F12)');
  r = M.solve(['t_g']);
  ok(!r.act.has('k_obody') && !r.holes.h_oct_body, 'G alone: the body pip stays shut (no thumb)');
  for (const low of ['t_lcs', 't_lb', 't_lbb']) {
    r = M.solve([...LH, ...RH, 't_gs', low]);
    ok(!r.holes.h_gs4 && r.held.has('k_gs'), `G# touch held + ${low}: the G# cup is held shut (articulation, F17)`);
  }
  r = M.solve([...LH, 't_gs']);
  ok(r.holes.h_gs4 && !r.held.has('k_gs'), 'G# touch alone opens the G# cup (F15)');
  r = M.solve(['t_b', 't_f']);
  ok(!r.holes.h_b4 && r.act.has('k_fs') && r.links.get('l_bbbar') === 'carry', 'B + F: F# bar, then the Bb bar closes the bis cup (forked Bb, F20)');
  r = M.solve(['t_e']);
  ok(!r.holes.h_g4 && !r.holes.h_f4, 'E alone: the F# cup and the F vent close (F# bar, F23)');
  r = M.solve(['t_a']);
  ok(!r.holes.h_cs5 && !r.holes.h_b4 && r.holes.h_c5, 'A alone: the C# pad and the bis cup close, the C vent stays open (F18, F22)');
  r = M.solve(['t_b', 't_sbb']);
  ok(!r.holes.h_b4 && r.links.get('l_sbb') === 'carry', 'side Bb lever closes the bis cup (F19)');
  r = M.solve(['t_lbb']);
  ok(r.act.has('k_lbt') && r.act.has('k_lb') && r.act.has('k_lc') && r.act.has('k_lbb'), 'low Bb lever pulls low B, which closes low B and low C (F25, F26)');
  r = M.solve(['t_lb', 't_lcs']);
  ok(r.held.has('k_lcs') && !r.holes.h_cs4, 'low B holds the low C# cup shut (F9)');
  r = M.solve(['t_ff']);
  ok(r.holes.h_f5 && r.act.has('k_pf'), 'front F lifts the palm F cup (F28)');
  // every touch, pressed alone, changes at least one hole
  const rest = M.solve([]);
  for (const t of M.TOUCHES) {
    const a = M.solve([t.id]), diff = M.HOLES.filter(h => a.holes[h.id] !== rest.holes[h.id]).length;
    ok(diff > 0, `${t.id} alone changes ${diff} hole(s)`);
  }
  // movedBy: the path starts at the touch key and every step is a real link
  for (const t of M.TOUCHES) {
    const mv = M.movedBy(t.id, []);
    ok(mv.keys[0] === t.key && mv.path.every(([a, l, b]) => M.LINK[l] && mv.keys.includes(a) && mv.keys.includes(b)), `${t.id}: path ${mv.path.map(p => p[1]).join(' ') || '(no link)'}`);
  }
}

section('scene: three.js build in node');
{
  const THREE = await import(new URL('../../vendor/three@0.160.0/build/three.module.js', here).href);
  const t0 = Date.now(), S = buildSax(THREE, M), ms = Date.now() - t0;
  let meshes = 0, bad = 0; S.root.traverse(o => { if (o.isMesh) { meshes++; const p = o.geometry.attributes.position; for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) { bad++; break; } } });
  ok(meshes > 300 && bad === 0, `scene builds in ${ms} ms: ${meshes} meshes, all positions finite`);
  ok(S.keys.size === M.KEYS.length, `one key view for each key (${S.keys.size})`);
  ok(S.stats.pads === M.HOLES.length && S.stats.chimneys === M.HOLES.length, `pads ${S.stats.pads}, chimneys ${S.stats.chimneys}, holes ${M.HOLES.length}`);
  ok(S.stats.needle + S.stats.flat === M.KEYS.filter(k => k.spring).length, `springs: ${S.stats.needle} needle + ${S.stats.flat} flat`);
  ok(S.stats.contacts === M.LINKS.length + M.LINKS.filter(l => l.kind === 'swap').length, `link contacts: ${S.stats.contacts}`);
  const picks = new Set(S.touchMeshes.map(m => m.userData.touch));
  ok(M.TOUCHES.every(t => picks.has(t.id)), 'every touch piece has a pick mesh');
  const V = a => new THREE.Vector3(a[0], a[1], a[2]);
  const pose = (v, a) => { v.pivot.quaternion.setFromAxisAngle(v.axis, a); S.root.updateMatrixWorld(true); };
  for (const t of M.TOUCHES) {
    const v = S.keys.get(t.key), n = V(M.normalAt(t.s, t.phi));
    pose(v, v.restAngle); const p0 = S.touchPoint(t.id);
    pose(v, v.actAngle); const p1 = S.touchPoint(t.id);
    pose(v, v.restAngle);
    const din = -p1.clone().sub(p0).dot(n);
    ok(din > 0.8, `${t.id}: a press moves the touch in by ${din.toFixed(2)} mm`);
  }
  // the cups are built at the closed pose: turn 0 closes, the open turn lifts
  for (const k of M.KEYS) for (const hid of k.cups) {
    const v = S.keys.get(k.id), h = M.HOLE[hid], n = V(M.normalAt(h.s, h.phi));
    const seat = V(M.surf(h.s, h.phi, h.kind === 'register' ? 4.5 : 2.6));
    const closedA = k.restOpen ? v.actAngle : v.restAngle, openA = k.restOpen ? v.restAngle : v.actAngle;
    pose(v, closedA); const cupC = seat.clone().applyMatrix4(v.geom.matrixWorld);
    pose(v, openA); const cupO = seat.clone().applyMatrix4(v.geom.matrixWorld);
    pose(v, v.restAngle);
    const lift = cupO.clone().sub(seat).dot(n);
    ok(closedA === 0 && cupC.distanceTo(seat) < 0.01, `${hid}: the closed cup sits on its chimney`);
    ok(lift > 1.2, `${hid}: the open cup lifts ${lift.toFixed(2)} mm off the hole`);
  }
  // no arm, foot or link bar goes inside the tube (more than 1 mm)
  const C = []; for (let s = 0; s <= M.S_END; s += 2) { const c = M.center(s); C.push([c.p, M.radius(s)]); }
  const w = new THREE.Vector3(); let deep = 0, where = '';
  S.root.traverse(o => {
    if (!o.isMesh || !['link', 'arm', 'foot'].includes(o.userData.role)) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 4) {
      w.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      let best = 1e9; for (const [c, r] of C) { const d = Math.hypot(w.x - c[0], w.y - c[1], w.z - c[2]) - r; if (d < best) best = d; }
      if (best < deep) { deep = best; let k = o.parent; while (k && !k.name.startsWith('geom.')) k = k.parent; where = (k ? k.name : '?') + ' ' + o.userData.role; }
    }
  });
  ok(deep > -1, `no arm, foot or link bar is inside the tube (deepest ${deep.toFixed(2)} mm${where ? ', ' + where : ''})`);
  // cups do not overlap; parallel key tubes (4.3 mm wide) do not touch
  const cups = M.HOLES.map(h => ({ id: h.id, p: V(M.surf(h.s, h.phi, 4)), r: h.rh + 2.4 }));
  let cupHit = [];
  for (let i = 0; i < cups.length; i++) for (let j = i + 1; j < cups.length; j++) if (cups[i].p.distanceTo(cups[j].p) < cups[i].r + cups[j].r + 1) cupHit.push(cups[i].id + '/' + cups[j].id);
  ok(cupHit.length === 0, `no two pad cups overlap${cupHit.length ? ': ' + cupHit.join(' ') : ''}`);
  let rodHit = [];
  for (let i = 0; i < M.KEYS.length; i++) for (let j = i + 1; j < M.KEYS.length; j++) {
    const a = M.KEYS[i], b = M.KEYS[j], ra = M.ROD[a.rod], rb = M.ROD[b.rod];
    if (ra.neckAxis || rb.neckAxis || a.rod === b.rod) continue;
    for (let s = Math.max(a.span[0], b.span[0]); s <= Math.min(a.span[1], b.span[1]); s += 2)
      if (V(M.surf(s, ra.phi, ra.dr)).distanceTo(V(M.surf(s, rb.phi, rb.dr))) < 4.5) { rodHit.push(a.id + '/' + b.id + '@' + s); break; }
  }
  ok(rodHit.length === 0, `no two key tubes touch${rodHit.length ? ': ' + rodHit.join(' ') : ''}`);
  // state and animation settle
  S.setState(M.solve(['t_oct', 't_b', 't_a', 't_g', 't_gs']));
  let n = 0; while (S.tick(1 / 60) && n < 600) n++;
  ok(n < 600 && [...S.keys.values()].every(v => Math.abs(v.angle - v.target) < 1e-3), `animation settles in ${n} frames`);
  S.setGhost('oct'); S.setExplode('oct', 0.8); n = 0; while (S.tick(1 / 60) && n < 600) n++;
  const ov = S.keys.get('k_oct'); ok(ov.holder.position.length() > 15, `explode moves the octave keys out (${ov.holder.position.length().toFixed(1)} mm)`);
  ok([...S.groupMats.get('lh')].every(m => m.opacity < 0.5), 'ghost: the other groups go transparent');
  S.setGhost(null); S.setExplode(null, 0);
  const tr = S.tracePoints(M.movedBy('t_lbb', []).path, 't_lbb');
  ok(tr.length >= 4 && tr.every(p => p.length === 3 && p.every(q => q && Number.isFinite(q.x))), `trace of low Bb: ${tr.length} steps`);
  const box = S.groupBox(null);
  ok(box.max.y - box.min.y > 700 && box.max.y - box.min.y < 1000, `overall height ${(box.max.y - box.min.y).toFixed(0)} mm (an alto is about 700 mm without the neck)`);
}

section('saver: plan and director');
{
  const a = makePlan(1, 80), b = makePlan(2, 80), c = makePlan(1, 80);
  ok(JSON.stringify(a) === JSON.stringify(c), 'one seed gives one plan');
  ok(JSON.stringify(a) !== JSON.stringify(b), 'two seeds give two plans');
  ok(a.every(s => s.dur >= DUR[0] && s.dur <= DUR[1]), 'every shot is 6 to 12 s');
  let g2 = 0, k3 = 0;
  for (let i = 1; i < a.length; i++) { if (a[i].group && a[i].group === a[i - 1].group) g2++; if (i > 1 && a[i].kind === a[i - 1].kind && a[i].kind === a[i - 2].kind) k3++; }
  ok(g2 === 0 && k3 === 0, `no group twice in a row (${g2}), no kind three times in a row (${k3})`);
  ok(new Set(a.map(s => s.kind)).size === 3 && new Set(a.filter(s => s.group).map(s => s.group)).size >= 6, 'all three kinds and most groups come up');
  const notes = new Set(M.MAIN_FINGERINGS.map(f => f.note));
  ok(a.filter(s => s.kind === 'run').every(s => s.notes.length >= 4 && s.notes.every(n => notes.has(n))), 'every run note is in the chart');
  ok(Object.keys(PATTERNS).every(p => runNotes(p, 60).length >= 4), 'every run pattern has four notes or more');
  const bf = bandFrame(800, { t: 200, b: 260 });
  ok(bf.k > 1 && bf.dy === 30 && bandFrame(800, null).k === 1, 'bandFrame: moves back and shifts down for the plate band');
  // a stub view
  const log = { touches: 0, iso: [], look: 0, labels: [] };
  const env = {
    setTouches: ids => { log.touches++; log.last = ids; }, setIsolate: g => { log.iso.push(g); },
    sphere: g => ({ c: { x: 0, y: g ? 100 : 0, z: 0 }, r: g ? 120 : 430 }),
    lookAt: o => { if (finite([o.az, o.el, o.dist, o.dy, o.c.x, o.c.y, o.c.z])) log.look++; },
    touchPoint: () => ({ x: 10, y: 20, z: 30 }), fov: 32, height: () => 800,
  };
  const d = startSaver(env, { seed: 7, label: x => log.labels.push(x), band: { t: 120, b: 160 } });
  for (let i = 0; i < 30 * 70; i++) d.tick(1 / 30);
  const db = d.debug();
  ok(db.n >= 6 && db.n <= 13, `70 s of play cuts ${db.n} shots (6 to 12 s each)`);
  ok(log.look >= 2000 && log.touches > 10, `camera set ${log.look} times, keys set ${log.touches} times`);
  ok(log.labels.length > 6 && log.labels.every(l => l && l.title && Array.isArray(l.lines) && Array.isArray(l.eq)), `${log.labels.length} labels, each with title, lines, eq`);
  d.cut('oct'); ok(d.debug().group === 'oct' && d.debug().kind === 'group', 'cut("oct") isolates the octave mechanism');
  d.cut('t_lbb'); ok(d.debug().touch === 't_lbb' && d.debug().kind === 'press', 'cut("t_lbb") shows the low Bb path');
  d.cut('run'); ok(d.debug().kind === 'run', 'cut("run") starts a run');
  d.dispose(); ok(log.last && log.last.length === 0 && log.iso[log.iso.length - 1] === null, 'dispose releases every key and the isolation');
  ok(SAVER_GROUPS.every(g => M.GROUP[g]), 'saver groups exist');
}

section('synth: envelope (no audio in node)');
{
  const e = envelope(1.2);
  ok(e.attack > 0 && e.attack < e.hold && e.sustain > 0 && e.sustain < 1, 'envelope times');
  const s = createSynth(); s.play(440); ok(!s.ready, 'play() does nothing in node');
  ok(Math.abs(M.hz(69 + 9) - 440) < 1e-9 && Math.abs(M.hz(58) - 138.59) < 0.01, 'written Bb3 sounds Db3, 138.59 Hz (F4)');
}

section('dom: main.js and saver.js run in jsdom (a fake WebGL renderer)');
{
  // The child process loads index.html in jsdom, maps 'three' to a shim
  // that replaces WebGLRenderer and PMREMGenerator (no GPU in node), runs
  // main.js and saver.js, and drives the page: chart, touches by ray cast,
  // groups, keys and the saver hook. jsdom comes from NODE_PATH.
  const vendor = new URL('../../vendor/three@0.160.0/', here).href;
  const child = String.raw`
import { register, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const vendor = ${JSON.stringify(vendor)}, here = ${JSON.stringify(here.href)};
const shim = 'data:text/javascript,' + encodeURIComponent(
  "export * from '" + vendor + "build/three.module.js';" +
  "import { Texture } from '" + vendor + "build/three.module.js';" +
  "export class WebGLRenderer { constructor() { this.domElement = document.createElement('canvas'); globalThis.__renders = 0; }" +
  " setPixelRatio() {} setSize() {} render() { globalThis.__renders++; } }" +
  "export class PMREMGenerator { fromScene() { return { texture: new Texture() }; } }");
register('data:text/javascript,' + encodeURIComponent('export async function resolve(s, c, next) {' +
  'if (s === "three") return { url: ' + JSON.stringify(shim) + ', shortCircuit: true };' +
  'if (s.startsWith("three/addons/")) return next(' + JSON.stringify(vendor + 'examples/jsm/') + ' + s.slice(13), c);' +
  'return next(s, c); }'));
const require = createRequire(process.cwd() + '/');
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { console.log('RESULT ' + JSON.stringify({ skip: 'jsdom not found on NODE_PATH' })); process.exit(0); }
const html = readFileSync(new URL('index.html', here), 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: here + 'index.html', pretendToBeVisual: false });
const w = dom.window, errors = [];
w.addEventListener('error', e => errors.push(String(e.error || e.message)));
process.on('uncaughtException', e => errors.push(String(e && e.stack || e)));
process.on('unhandledRejection', e => errors.push(String(e && e.stack || e)));
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'getComputedStyle']) { try { globalThis[k] = k === 'window' ? w : w[k]; } catch (e) { Object.defineProperty(globalThis, k, { value: w[k], configurable: true }); } }
const W = 1280, H = 800;
const raf = []; let now = 0;
Object.assign(globalThis, { innerWidth: W, innerHeight: H, devicePixelRatio: 1,
  matchMedia: q => ({ matches: process.env.PHONE === '1', media: q, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: f => { raf.push(f); return raf.length; }, cancelAnimationFrame() {},
  addEventListener: (...a) => w.addEventListener(...a), removeEventListener: (...a) => w.removeEventListener(...a), dispatchEvent: e => w.dispatchEvent(e) });
w.matchMedia = globalThis.matchMedia; w.requestAnimationFrame = globalThis.requestAnimationFrame; w.innerWidth = W; w.innerHeight = H;
w.HTMLCanvasElement.prototype.getContext = () => null;
w.HTMLElement.prototype.getBoundingClientRect = function () { const p = this.id === 'panel' ? { left: W - 340, top: 0, right: W, bottom: H } : { left: 0, top: 0, right: W, bottom: H }; return { ...p, width: p.right - p.left, height: p.bottom - p.top, x: p.left, y: p.top }; };
w.HTMLElement.prototype.setPointerCapture = () => {}; w.HTMLElement.prototype.releasePointerCapture = () => {}; w.HTMLElement.prototype.hasPointerCapture = () => false;
const frames = (n, dt = 16.7) => { for (let i = 0; i < n; i++) { const q = raf.splice(0); now += dt; for (const f of q) f(now); } };
await import(here + 'saver.js');
await import(here + 'main.js');
frames(5);
const app = w.altoSax || globalThis.altoSax, $ = id => w.document.getElementById(id), out = {};
out.boot = !!(app && app.renderer) && $('boot').hidden;
out.chart = $('chart').children.length; out.alt = $('chartAlt').children.length;
out.groups = $('groups').children.length;
out.counts = $('counts').textContent;
// pick a note from the chart
[...$('chart').children].find(b => b.dataset.f === 'G4').click(); frames(40);
out.g4 = $('noteName').textContent; out.g4chips = $('pressed').children.length;
out.g4on = $('chart').querySelector('button.on') && $('chart').querySelector('button.on').dataset.f;
// press a touch piece by a ray cast: project its point to the screen
$('btnClear').click(); frames(2);
const P = app.S.touchPoint('t_lbb').project(app.camera);
const x = (P.x * 0.5 + 0.5) * W, y = (-P.y * 0.5 + 0.5) * H, cv = app.renderer.domElement;
const PE = w.PointerEvent || w.MouseEvent;
cv.dispatchEvent(new PE('pointerdown', { clientX: x, clientY: y, bubbles: true }));
cv.dispatchEvent(new PE('pointerup', { clientX: x, clientY: y, bubbles: true }));
frames(40);
out.pickNote = $('noteName').textContent; out.moves = $('moves').querySelectorAll('li').length;
out.path = app.path ? app.path.length : 0; out.pathMeshes = app.scene.children.find(c => c.renderOrder === 10)?.children.length || 0;
// groups, explode, labels
[...$('groups').children].find(b => b.dataset.g === 'oct').click(); frames(60);
out.labels = $('labels').children.length; out.gtext = $('groupText').textContent.slice(0, 40); out.parts = $('groupParts').children.length;
out.explodeHolder = app.S.keys.get('k_oct').holder.position.length();
w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight' })); frames(5);
out.next = $('noteName').textContent;
w.dispatchEvent(new w.KeyboardEvent('keydown', { key: '0' })); frames(30);
// saver hook
const labels = [];
const res = await w.snSaver.enter({ seed: 5, label: l => labels.push(l) });
for (let i = 0; i < 60 * 25; i++) frames(1);
out.saver = { canvas: res && res.canvas === cv, warm: res && res.warmupMs, labels: labels.length, debug: w.snSaver.debug(), cls: w.document.documentElement.classList.contains('as-saver') };
w.snSaver.cut('t_oct'); frames(10); out.cut = w.snSaver.debug().touch;
w.snSaver.exit(); frames(5);
out.after = { cls: w.document.documentElement.classList.contains('as-saver'), pressed: $('pressed').querySelectorAll('.chip').length };
out.panelOpen = $('panel').classList.contains('open'); out.renders = globalThis.__renders; out.errors = errors;
console.log('RESULT ' + JSON.stringify(out));
process.exit(0);
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8', cwd: new URL('.', here).pathname, env: { ...process.env, NODE_PATH: process.env.NODE_PATH || '' }, timeout: 120000 });
  const line = (r.stdout || '').split('\n').find(s => s.startsWith('RESULT '));
  if (!line) ok(false, `jsdom run: no result. ${(r.stderr || '').split('\n').filter(Boolean).slice(-6).join(' | ')}`);
  else {
    const o = JSON.parse(line.slice(7));
    if (o.skip) { console.log('  SKIP jsdom: ' + o.skip + ' (set NODE_PATH to a folder with jsdom)'); }
    else {
      ok(o.errors.length === 0, `no page error${o.errors.length ? ': ' + o.errors.slice(0, 3).join(' | ') : ''}`);
      ok(o.boot && o.renders > 0, `main.js boots and renders (${o.renders} frames)`);
      ok(o.chart === M.MAIN_FINGERINGS.length && o.alt === M.FINGERINGS.length - M.MAIN_FINGERINGS.length && o.groups === 9, `chart ${o.chart} + ${o.alt} buttons, ${o.groups} group buttons`);
      ok(/^\d+ keys, \d+ touch pieces/.test(o.counts), `counts line: ${o.counts}`);
      ok(o.g4 === 'G4' && o.g4chips === 3 && o.g4on === 'G4', `chart G4: readout ${o.g4}, ${o.g4chips} keys down, button on`);
      ok(o.pickNote === 'C♯5' || o.moves >= 4, `ray cast on the low Bb spatula: ${o.moves} steps listed, ${o.path} path steps, ${o.pathMeshes} path meshes`);
      ok(o.path >= 4 && o.pathMeshes >= 8, 'the low Bb path is traced');
      ok(o.labels === M.KEYS.filter(k => k.group === 'oct').length && o.parts > 5 && o.explodeHolder > 10, `isolate octave: ${o.labels} labels, ${o.parts} part lines, explode ${o.explodeHolder.toFixed(1)} mm`);
      ok(o.next === 'D5', `Right arrow after the low Bb lever alone (it sounds C#5): next note ${o.next}`);
      ok(o.saver.canvas && o.saver.cls && o.saver.labels >= 3 && o.saver.debug && o.saver.debug.n >= 2, `saver: own canvas, GUI hidden, ${o.saver.labels} labels, ${o.saver.debug && o.saver.debug.n} shots in 25 s`);
      ok(o.cut === 't_oct', 'saver cut("t_oct")');
      ok(!o.after.cls && o.after.pressed === 0, 'saver exit: GUI back, every key released');
      ok(o.panelOpen, 'desktop: the panel drawer is open');
    }
  }
  // the same run with the phone media query on
  const rp = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8', cwd: new URL('.', here).pathname, env: { ...process.env, PHONE: '1' }, timeout: 120000 });
  const lp = (rp.stdout || '').split('\n').find(s => s.startsWith('RESULT '));
  if (lp) {
    const o = JSON.parse(lp.slice(7));
    if (!o.skip) {
      ok(o.errors.length === 0 && o.boot, `phone: boots with no page error${o.errors.length ? ': ' + o.errors[0] : ''}`);
      ok(o.panelOpen === false, 'phone: the bottom sheet starts closed, so the model is clear');
      ok(o.g4 === 'G4' && o.saver.labels >= 3, 'phone: chart and saver work');
    }
  } else ok(false, `phone jsdom run: no result. ${(rp.stderr || '').split('\n').filter(Boolean).slice(-4).join(' | ')}`);
}

section('page: head, ids, hidden vs display, scripts');
{
  const html = await readFile(new URL('index.html', here), 'utf8'), css = await readFile(new URL('style.css', here), 'utf8');
  const main = await readFile(new URL('main.js', here), 'utf8');
  const i1 = html.indexOf('lib/gpu-guard.js'), i2 = html.indexOf('lib/wishlist.js'), i3 = html.indexOf('lib/stats-beacon.js');
  ok(i1 > 0 && i1 < i2 && i2 < i3 && i3 < html.indexOf('<meta'), 'head scripts: gpu-guard, wishlist, stats-beacon, first');
  ok(/name="viewport"[^>]*viewport-fit=cover/.test(html) && /<meta name="description" content="[^"]{60,}"/.test(html), 'viewport-fit=cover and a description');
  ok(html.indexOf('lib/sci.css') > 0 && html.indexOf('lib/sci.css') < html.indexOf('href="style.css"'), 'lib/sci.css, then style.css');
  ok(html.includes('"three": "../../vendor/three@0.160.0/build/three.module.js"') && html.includes('"three/addons/": "../../vendor/three@0.160.0/examples/jsm/"'), 'importmap points at the vendored three r160');
  ok(html.indexOf('src="saver.js"') > 0 && html.indexOf('src="saver.js"') < html.indexOf('src="main.js"'), 'saver.js loads before main.js');
  ok(/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(css), 'style.css has [hidden]{display:none!important}');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  ok(uniq(ids), `no id is used twice (${ids.length} ids)`);
  const idSet = new Set(ids);
  const used = [...new Set([...main.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))];
  const miss = used.filter(i => !idSet.has(i));
  ok(miss.length === 0, `every $('id') in main.js is in index.html (${used.length} ids)${miss.length ? ': missing ' + miss.join(' ') : ''}`);
  const banner = html.slice(html.indexOf('<!--'), html.indexOf('-->'));
  const bIds = [...new Set([...banner.matchAll(/#([a-zA-Z][\w-]+)/g)].map(m => m[1]))];
  const bMiss = bIds.filter(i => !idSet.has(i));
  ok(bIds.length > 20 && bMiss.length === 0, `every #id in the banner is in the page (${bIds.length})${bMiss.length ? ': ' + bMiss.join(' ') : ''}`);
  // hidden elements must have no display rule of their own
  const hid = new Set();
  for (const m of html.matchAll(/<[a-z]+\b([^>]*)>/g)) {
    const at = m[1]; if (!/\shidden(\s|=|$)/.test(at)) continue;
    const id = (at.match(/\sid="([^"]+)"/) || [])[1]; if (id) hid.add('#' + id);
    for (const c of ((at.match(/\sclass="([^"]+)"/) || [])[1] || '').split(/\s+/)) if (c) hid.add('.' + c);
  }
  for (const m of main.matchAll(/\$\('([\w-]+)'\)\.hidden\b/g)) {
    hid.add('#' + m[1]);
    const t = html.match(new RegExp(`<[a-z]+\\b[^>]*\\sid="${m[1]}"[^>]*>`));
    for (const c of ((t && (t[0].match(/\sclass="([^"]+)"/) || [])[1]) || '').split(/\s+/)) if (c) hid.add('.' + c);
  }
  if (/\.d\.hidden\b/.test(main)) hid.add('.lbl');
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, ''), bad = [];
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;|\s)display\s*:/.test(m[2])) continue;
    for (const sel of m[1].split(',').map(s => s.trim())) {
      if (sel === '[hidden]') continue;
      const lastSel = sel.split(/[\s>+~]+/).pop();
      for (const h of hid) if (new RegExp(`${h.replace(/[.#]/, '\\$&')}(?![\\w-])`).test(lastSel)) bad.push(`${sel} (${h})`);
    }
  }
  ok(hid.size > 0 && bad.length === 0, `no hidden element has a display rule (${[...hid].join(' ')})${bad.length ? ': ' + bad.join(', ') : ''}`);
  ok(!/Selmer|Yamaha|Yanagisawa|Keilwerth|Conn\b|logo/i.test(html + main), 'no brand name or logo in the page or main.js');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
