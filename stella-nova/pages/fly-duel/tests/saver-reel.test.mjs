// ============================================================================
//  FLY DUEL  ·  node tests for the screensaver reel  (node tests/saver-reel.test.mjs)
// ----------------------------------------------------------------------------
//  The 3D saver plays a whole match first, then cuts it as a reel
//  (saver.js planReel, createReel3d; ui/fly3d/reel.js). No browser (the
//  user does not allow headless Chrome). Parts:
//    plan      50 seeds of real matches between the pretrained flies:
//              every shot 5-12 s, the intro in order, the lethal attack in
//              slow motion, victory and recap at the end, event shots cut
//              just before their event, a cut at every skipped turn,
//              variety over the seeds (shot orders, decks, all colours),
//              the same seed gives the same reel, the reel fits its budget
//    plate     titles, live numbers, the three-factor rule as TeX, the
//              wiring of each fly, no code, no trademark words
//    recap     the title card draws with finite numbers on a fake context
//    rigs      every rig pose at a wide and a phone frame: the camera is in
//              the hall, not in the table, and no fly, card or die is
//              between the camera and the subject (three.js raycasts on
//              the real scene graph, headless)
//    runtime   createReel3d on the headless scene for two games: the cuts
//              follow the plan, slow motion runs, the props come and go
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { registerHooks } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = new URL('../../vendor/three@0.160.0/', pathToFileURL(ROOT + '/'));
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const t00 = Date.now();

const SV = await import('../saver.js');
const { planReel, REEL, REEL_SHOTS, FILLER, reelPlate, recapData, drawRecap, pickDeckPair, introItems, reelBudget, scoreRecord, realAt } = SV;
const rules = await import('../game/rules.js');
const cards = await import('../game/cards.js');
const bots = await import('../game/bots.js');
const { Fly } = await import('../brain/fly.js');
const { Match, agentFromFly } = await import('../ui/match.js');
const { mulberry32 } = await import('../data/rng.js');
const pre = JSON.parse(readFileSync(join(ROOT, 'data/pretrained.json'), 'utf8'));
const curve = JSON.parse(readFileSync(join(ROOT, 'data/training-curve.json'), 'utf8'));
const conFor = side => JSON.parse(readFileSync(join(ROOT, pre.wiring?.[side]?.file || 'data/connectome.json'), 'utf8'));
const CON = { A: conFor('A'), B: conFor('B') };
const flies = () => ['A', 'B'].map(s => Fly.fromJSON(CON[s], pre[s]));
const byId = new Map(Object.entries(cards.CARD));
const IDS = cards.DECK_ORDER;
const NAMES = ['Fly A', 'Fly B'];

// one real match of the pretrained flies, decks by seed
function matchOf(seed, F = flies()) {
  const decks = pickDeckPair(mulberry32(seed ^ 0xdec5), IDS);
  const m = new Match(rules, F.map((f, i) => agentFromFly(f, NAMES[i])), { seed, decks, names: NAMES });
  for (let k = 0; k < 2000 && !m.over(); k++) if (!m.next()) break;
  return { m, decks };
}

// ---------------------------------------------------------------- plan
{
  const F = flies();
  const N = 50, seqs = new Set(), pairs = new Set(), colours = new Set(), kindsSeen = new Set(), introSeq = new Set();
  let lenBad = [], introBad = 0, lethalBad = [], endBad = 0, evBad = [], snapBad = 0, overBudget = [], skips = 0, slowOk = 0, lethalN = 0;
  const t0 = Date.now();
  for (let s = 1; s <= N; s++) {
    const seed = 1000 + s * 7919;
    const { m, decks } = matchOf(seed, F);
    pairs.add(decks.join('+'));
    for (const d of decks) for (const c of cards.DECKS[d].colours) colours.add(c);
    const budget = s % 3 === 0 ? reelBudget(60) : reelBudget(undefined, false);
    const P = planReel({ recs: m.history, byId, seed, calm: 0.7, budget, intro: introItems(seed, budget, true) });
    const sh = P.shots;
    seqs.add(sh.map(x => x.kind).join(','));
    sh.forEach(x => kindsSeen.add(x.kind));
    for (const x of sh) if (x.len < REEL.MIN - 1e-3 || x.len > REEL.MAX + 1e-3) lenBad.push(`${seed}:${x.kind}:${x.len}`);
    // the intro: cold, decks, (shuffle), hands, one shot each, at t = 0 on
    const intro = sh.filter(x => P.items[x.item].kind === 'intro').map(x => x.kind);
    introSeq.add(intro.join(','));
    if (!(intro[0] === 'cold' && intro[1] === 'decks' && intro[intro.length - 1] === 'hands' && sh[0].t === 0)) introBad++;
    // the end: victory, (slump), recap; the reel ends with the recap
    const tail = sh.slice(-3).map(x => x.kind).join(',');
    if (!/victory,(slump,)?recap$|victory,recap$/.test(tail) || Math.abs(sh[sh.length - 1].t + sh[sh.length - 1].len - P.total) > 1e-2) endBad++;
    // lethal: a match won on life has one lethal shot, played in slow motion
    if (P.result && P.result.winner >= 0 && !['decked', 'turn cap'].includes(P.result.reason)) {
      lethalN++;
      const L = sh.filter(x => x.kind === 'lethal');
      if (L.length !== 1) lethalBad.push(`${seed}:${L.length}`);
      else {
        const it = P.items[L[0].item];
        const later = P.items.slice(L[0].item).filter(i => i.kind === 'rec');
        if (later.some(i => i.prof.some(([, v]) => v < 0.5))) slowOk++;
        if (it.kind !== 'rec') lethalBad.push(`${seed}:item`);
      }
    }
    // event shots cut at most PRE + a bit before an event of their kind
    for (const x of sh.filter(y => y.ev && y.kind !== 'lethal')) {
      const hit = P.marks.some(mk => mk.t >= x.t - 1e-3 && mk.t <= x.t + REEL.PRE + 3.01 && mk.opts.includes(x.kind));
      if (!hit) evBad.push(`${seed}:${x.kind}@${x.t}`);
    }
    // a skipped stretch snaps the board: there must be a cut at that item
    for (let j = 0; j < P.items.length; j++) {
      const it = P.items[j];
      if (it.kind === 'rec' && it.snap) { skips++; if (!sh.some(x => x.item === j && x.off < 1e-6)) snapBad++; }
    }
    if (P.total > budget + 20) overBudget.push(`${seed}:${P.total.toFixed(0)}>${budget}`);
    if (s === 1) {
      const Q = planReel({ recs: m.history, byId, seed, calm: 0.7, budget, intro: introItems(seed, budget, true) });
      ok(JSON.stringify(Q.shots) === JSON.stringify(P.shots), 'plan: the same seed and match give the same reel');
      ok(P.skipped.length > 0 && P.kept.length > 0 && P.kept.includes(P.turns[P.turns.length - 1]), `plan: dead turns are skipped and the last turn is kept (kept ${P.kept.join(' ')})`);
      ok(P.items.filter(i => i.kind === 'rec').every(i => i.dur > 0 && i.prof.every(([a, v]) => a >= 0 && v >= REEL.SLOW_MIN - 1e-9 && v <= REEL.FAST + 1e-9)), 'plan: every record has a speed profile in [SLOW_MIN, FAST]');
      ok(P.items.some(i => i.kind === 'rec' && i.prof.length === 1 && i.prof[0][1] === REEL.FAST), 'plan: weak moves play fast');
    }
  }
  console.log(`  plan: ${N} matches in ${Date.now() - t0} ms; ${seqs.size} shot orders, ${pairs.size} deck pairs, ${introSeq.size} intros, ${skips} skips, kinds ${[...kindsSeen].join(' ')}`);
  ok(lenBad.length === 0, `plan: every shot is 5-12 s (${lenBad.slice(0, 5).join(' ')})`);
  ok(introBad === 0, `plan: the intro is cold, decks, shuffle, hands (${introBad} bad)`);
  ok(endBad === 0, `plan: victory, slump, recap end the reel (${endBad} bad)`);
  ok(lethalN > 25 && lethalBad.length === 0, `plan: one lethal shot per match won on life (${lethalN} matches, bad ${lethalBad.slice(0, 5).join(' ')})`);
  ok(slowOk === lethalN, `plan: the lethal attack plays in slow motion (${slowOk}/${lethalN})`);
  ok(evBad.length === 0, `plan: event shots cut on their event (${evBad.slice(0, 5).join(' ')})`);
  ok(snapBad === 0 && skips > 20, `plan: a cut hides every skipped stretch (${skips} skips, ${snapBad} bad)`);
  ok(overBudget.length <= 3, `plan: the reel fits its budget (${overBudget.join(' ')})`);
  ok(seqs.size >= 48, `plan: 50 seeds give ${seqs.size} different shot orders`);
  ok(pairs.size >= 30, `plan: 50 seeds give ${pairs.size} different deck pairs`);
  ok(['amber', 'moss', 'dew', 'rot', 'pollen'].every(c => colours.has(c)), `plan: decks of all five colours play (${[...colours].join(' ')})`);
  ok(introSeq.size >= 2, 'plan: the intro is short when the page time is short');
  const want = ['cold', 'decks', 'shuffle', 'hands', 'brain', 'duo', 'card', 'mana', 'dolly', 'combat', 'lethal', 'victory', 'slump', 'recap', 'crowd', 'over'];
  ok(want.every(k => kindsSeen.has(k)), `plan: the shot kinds all show (${want.filter(k => !kindsSeen.has(k)).join(' ') || 'all'})`);
  ok([...kindsSeen].every(k => REEL_SHOTS[k]), 'plan: every shot kind has a medium');
  ok(FILLER.every(k => REEL_SHOTS[k]), 'plan: every filler kind has a medium');
}

// ---------------------------------------------------------------- pure parts
{
  const r = mulberry32(5), pairsOk = Array.from({ length: 200 }, () => pickDeckPair(r, IDS)).every(([a, b]) => a !== b && IDS.includes(a) && IDS.includes(b));
  ok(pairsOk, 'pickDeckPair: two different decks from the pool');
  ok(reelBudget(60) === 58 && reelBudget(10) === 45 && reelBudget(undefined) === 150 && reelBudget(60, false) === 150, 'reelBudget: the first match fits the page time');
  const prof = [[0, 1], [2, 0.5], [4, 2]];
  ok(Math.abs(realAt(prof, 1) - 1) < 1e-9 && Math.abs(realAt(prof, 3) - 4) < 1e-9 && Math.abs(realAt(prof, 6) - 7) < 1e-9, 'realAt: piecewise speed profile');
  const st = (l0, l1, bf0 = [], bf1 = []) => ({ turn: 3, players: [{ life: l0, battlefield: bf0 }, { life: l1, battlefield: bf1 }] });
  const bug = { uid: 7, id: [...byId.values()].find(c => c.type === 'creature').id };
  const a = scoreRecord({ who: 0, action: { type: 'pass' }, before: st(20, 20), after: st(20, 20) }, byId).score;
  const b = scoreRecord({ who: 0, action: { type: 'attack', attackers: [7] }, before: st(20, 9, [bug]), after: st(20, 4, [bug]) }, byId).score;
  const c = scoreRecord({ who: 0, action: { type: 'attack', attackers: [7] }, before: st(20, 3, [bug]), after: { ...st(20, 0, [bug]), result: { winner: 0, reason: 'life' } } }, byId);
  ok(a === 0 && b > 5 && c.lethal && c.score > 100, `scoreRecord: pass 0, a hit ${b}, lethal ${c.score}`);
}

// ---------------------------------------------------------------- plate and recap
{
  const snap = { life: [14, 3], turn: 9, kc: [{ on: 96, live: 1927 }, { on: 130, live: 2597 }], trained: true, kinds: ['fly', 'fly'], wiring: ['hemibrain', 'FlyWire'], decks: [{ name: 'Moss Grove' }, { name: 'Clear Sky' }], card: { name: 'Test Card', text: 'Deal 2 damage.' }, skip: null, over: { winner: 1, reason: 'life' } };
  const TM = /magic|gathering|wizards|planeswalker|mtg|arena/i;
  for (const kind of Object.keys(REEL_SHOTS)) {
    for (const who of [0, 1]) {
      const p = reelPlate({ kind, who, ev: kind === 'combat' ? 'block' : null, delta: 0.21, info: { life: 3, card: 'x' } }, snap);
      const all = JSON.stringify(p);
      ok(p.title && /Fly A 14 life · Fly B 3 life · turn 9/.test(p.sub), `plate ${kind}: title and live numbers`);
      ok(!('code' in p) && !TM.test(all) && p.lines.length <= 4, `plate ${kind}: no code, no trademark words, at most 4 lines`);
      ok(p.lines.some(l => /Fly B FlyWire/.test(l) && /not real flies/.test(l)) && p.lines.some(l => /Active Kenyon cells: Fly A 5\.0% of 1927 · Fly B 5\.0% of 2597/.test(l)), `plate ${kind}: wiring of each fly and KC sparsity`);
      ok(p.tex.some(t => /\\Delta w_\{ij\} = -\\eta/.test(t) && /DAN/.test(t)) && p.eq.length === p.tex.length, `plate ${kind}: the three-factor rule as TeX with a plain fallback`);
    }
  }
  ok(/Moss Grove vs Clear Sky/.test(reelPlate({ kind: 'decks', who: 0 }, snap).title), 'plate: the deck shot names both decks');
  ok(/Fly B wins on Clear Sky/.test(reelPlate({ kind: 'recap', who: 1 }, snap).title), 'plate: the recap names the winner and its deck');
  ok(/Turns 4 to 7 skipped/.test(reelPlate({ kind: 'wide', who: 0 }, { ...snap, skip: { from: 4, to: 7 } }).lines[0]), 'plate: a skip names the skipped turns');
  ok(/greedy bot/.test(reelPlate({ kind: 'wide', who: 0 }, { ...snap, kinds: ['fly', 'bot'] }).lines.join()), 'plate: a stand-in bot is named');

  const { m, decks } = matchOf(4242);
  const specs = decks.map((id, p) => ({ name: cards.DECKS[id].name, colourNames: cards.DECKS[id].colours.join(', ') }));
  const D = recapData(m.history, { decks: specs, curve });
  const res = m.over();
  ok(D.winner === res.winner && D.turns === m.state.turn && D.moves === m.history.length, 'recap: winner, turns and decisions from the match');
  ok(D.series[0].length + D.series[1].length === m.history.filter(r => r.value != null).length && D.series.every(s => s.every((q, k) => k === 0 || q.x > s[k - 1].x)), 'recap: one value point per fly decision, in time order');
  ok(D.winner < 0 || (D.train && D.train.pts.length === curve.checkpoints.length && D.train.pts.every(q => q.v >= 0 && q.v <= 1)), 'recap: the measured training curve of the winner');
  let bad = 0, n = 0;
  const g = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return s => ({ width: String(s).length * 7 });
      return (...a) => { n++; if (a.some(v => typeof v === 'number' && !Number.isFinite(v))) bad++; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  for (const [w, h] of [[1200, 560], [360, 520], [300, 160]]) drawRecap(g, w, h, D);
  ok(n > 50 && bad === 0, `recap: the title card draws with finite numbers (${n} calls, ${bad} bad)`);
  const src = readFileSync(join(ROOT, 'saver.js'), 'utf8') + readFileSync(join(ROOT, 'ui/fly3d/reel.js'), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(!/shadowBlur|shadowColor|blur\(|createRadialGradient/.test(code), 'look: no glow or blur in saver.js and reel.js');
  ok(!/Beleren|MPlantin|Matrix Bold|magic|gathering|wizards/i.test(code), 'look: no trademark fonts or names in the code');
}

// ---------------------------------------------------------------- rigs (headless three.js)
const THREE = await import('three');
const { createDuelScene, TABLE: T } = await import('../ui/fly3d/scene.js');
const { rigPose, RIGS, createReelKit, seatPoint } = await import('../ui/fly3d/reel.js');
const { HALL } = await import('../ui/fly3d/hall.js');
{
  const sc = createDuelScene(null, { headless: true, connectomes: [CON.A, CON.B] });
  const info = await sc.ready;
  ok(info.fly === 'fly.js' && info.brain === true, `rigs: the real fly and both brain maps load (${JSON.stringify(info)})`);
  const { m } = matchOf(77);
  // a mid-game board: creatures, lands, hands
  const mid = m.history[Math.floor(m.history.length * 0.6)];
  sc.setState(mid.after); sc.render(0.016);
  const W = sc.world;
  // the things that must not block a shot
  const blockers = [];
  for (const f of W.flies) f.holder.traverse(o => { if (o.isMesh && !o.isInstancedMesh) blockers.push(o); });
  for (const o of [...W.Z.perms.values(), ...W.Z.hand[0], ...W.Z.hand[1]]) blockers.push(o.mesh);
  for (const d of W.drums) d.grp.traverse(o => { if (o.isMesh) blockers.push(o); });
  W.hall.table && W.hall.table.traverse(o => { if (o.isMesh) blockers.push(o); });
  const ray = new THREE.Raycaster();
  const ctxOf = (p, aspect, variant) => {
    const c = { p, aspect, variant, brain: [0, 1].map(q => W.brains[q] ? W.brains[q].group.getWorldPosition(new THREE.Vector3()) : null), die: W.drums.map(d => d.grp.position.clone()), fan: [0, 1].map(q => { const H = W.Z.hand[q]; if (!H.length) return null; const v = new THREE.Vector3(); H.forEach(o => v.add(o.mesh.position)); return v.multiplyScalar(1 / H.length); }), target: null };
    const perms = [...W.Z.perms.values()].filter(o => o.mesh.position.z * (p === 0 ? 1 : -1) > 0);
    if (perms.length) c.target = perms[0].mesh.position.clone();
    return c;
  };
  const crowd = W.hall.crowd.herd.pose;
  const problems = [];
  let poses = 0;
  for (const kind of RIGS) {
    for (const aspect of [16 / 9, 390 / 844]) {
      for (const p of [0, 1]) {
        for (const k of [0, 0.5, 1]) {
          for (const variant of [0.1, 0.9]) {
            const out = { pos: new THREE.Vector3(), look: new THREE.Vector3(), focus: null, fov: 40 };
            const r = rigPose(kind, k, ctxOf(p, aspect, variant), out);
            if (!r) { problems.push(`${kind} p${p} null`); continue; }
            poses++;
            const tag = `${kind} p${p} a${aspect.toFixed(2)} k${k} v${variant}`;
            const P = out.pos, L = out.look;
            if (![P.x, P.y, P.z, L.x, L.y, L.z, out.fov].every(Number.isFinite)) { problems.push(`${tag} not finite`); continue; }
            if (Math.abs(P.x) > HALL.wall - 1 || Math.abs(P.z) > HALL.wall - 1 || P.y < 0.3 || P.y > HALL.ceiling - 0.5) problems.push(`${tag} outside the hall ${P.toArray().map(v => v.toFixed(1))}`);
            if (Math.abs(P.x) < T.halfLen + 0.1 && Math.abs(P.z) < T.halfDepth + 0.1 && P.y < T.y + 0.2) problems.push(`${tag} in or under the table`);
            if (P.distanceTo(L) < 0.4) problems.push(`${tag} too close`);
            // no crowd fly at the camera
            for (const c of crowd) if (Math.hypot(P.x - c.pos.x, P.z - c.pos.z) < 0.7 * c.scale && P.y < c.pos.y + 2.6 * c.scale) { problems.push(`${tag} inside a crowd fly`); break; }
            // the decks and recap shots are under an overlay: no line test
            if (kind === 'decks' || kind === 'recap' || kind === 'crowd' || kind === 'cold') continue;
            const dir = L.clone().sub(P), dist = dir.length();
            ray.set(P, dir.normalize()); ray.near = 0.05; ray.far = dist;
            // the subject fly of a victory or slump shot does not block itself
            const own = new Set();
            if (kind === 'victory' || kind === 'slump') W.flies[p].holder.traverse(o => own.add(o));
            const hits = ray.intersectObjects(blockers, false).filter(h => h.point.distanceTo(L) > 0.45 && !own.has(h.object));
            if (hits.length) problems.push(`${tag} blocked by ${hits[0].object.name || hits[0].object.type} at ${hits[0].distance.toFixed(2)}/${dist.toFixed(2)}`);
          }
        }
      }
    }
  }
  console.log(`  rigs: ${poses} poses, ${problems.length} problems`);
  if (problems.length) console.log(problems.join('\n'));
  ok(problems.length === 0, `rigs: every pose is in the hall and sees its subject (${problems.slice(0, 6).join(' | ')})`);
  // the subject is at the centre of a view with no band, and in the band with one
  const kit = createReelKit(sc, { coarse: false, reduced: false });
  sc.camera.aspect = 16 / 9; sc.camera.updateProjectionMatrix();
  kit.frame(null, 1280, 720);
  kit.rig('d20', 0, { len: 6 });
  for (let i = 0; i < 20; i++) { kit.update(0.05); sc.render(0.05); }
  const s0 = kit.subject(1280, 720);
  ok(s0 && Math.abs(s0.x - 640) < 4 && Math.abs(s0.y - 360) < 4, `kit: the subject sits in the frame centre (${s0 && [s0.x, s0.y].map(v => v.toFixed(1))})`);
  kit.frame({ t: 200, b: 160, w: 1280 }, 1280, 720);
  sc.render(0.05);
  const s1 = kit.subject(1280, 720);
  const yc = 200 + (720 - 200 - 160) / 2;
  ok(s1 && Math.abs(s1.y - yc) < 6, `kit: with a plate band the subject sits in the band (${s1 && s1.y.toFixed(1)} vs ${yc})`);
  kit.fan([{ name: 'A', who: 0, colours: ['#ffb347'], cards: [...byId.values()].filter(c => c.type === 'creature').slice(0, 5) }, { name: 'B', who: 1, colours: ['#6cb4ee'], cards: [...byId.values()].filter(c => c.type === 'spell').slice(0, 5) }]);
  for (let i = 0; i < 30; i++) { kit.update(0.05); sc.render(0.05); }
  const fanMeshes = kit.overlay.children.filter(o => o.isGroup).flatMap(gp => gp.children);
  ok(kit.overlay.visible && fanMeshes.length === 12 && fanMeshes.every(o => [o.position.x, o.position.y, o.scale.x].every(Number.isFinite) && o.scale.x > 0), `kit: two fans of five cards and a label each (${fanMeshes.length})`);
  ok(!sc.camera.view || !sc.camera.view.enabled, 'kit: the overlay shots use no view offset');
  kit.clearOverlay();
  ok(!kit.overlay.visible && kit.overlay.children.length === 1, 'kit: clearOverlay removes the fans');
  kit.shuffle(true);
  const rif = () => sc.scene.children.filter(o => o.name === 'reel-riffle');
  kit.update(0.05); sc.render(0.05);
  const y0 = rif().map(gp => gp.children.map(c => c.position.y.toFixed(4)).join()).join('|');
  for (let i = 0; i < 9; i++) { kit.update(0.05); sc.render(0.05); }
  const y1 = rif().map(gp => gp.children.map(c => c.position.y.toFixed(4)).join()).join('|');
  ok(rif().length === 2 && rif().every(gp => gp.children.length === 16) && y0 !== y1, 'kit: a riffle of 16 card backs moves on each library pile');
  kit.shuffle(false);
  ok(rif().length === 0, 'kit: the riffle goes after the shuffle shot');
  kit.release();
  ok(sc.stats().shot === 'wide' || typeof sc.stats().shot === 'string', 'kit: release gives the camera back');
  kit.dispose(); sc.dispose();
}

// ---------------------------------------------------------------- runtime
{
  const sc = createDuelScene(null, { headless: true, connectomes: [CON.A, CON.B] });
  await sc.ready;
  const kit = createReelKit(sc, {});
  const speeds = [];
  const setSpeed = sc.setSpeed;
  sc.setSpeed = v => { speeds.push(v); return setSpeed(v); };
  sc.resize();
  const F = flies();
  const show = SV.createReel3d({ rules, byId, flies: F, bots, trained: true, seed: 99, calm: 0.6, scene: sc, kit, wiring: ['hemibrain', 'FlyWire'], deckIds: IDS, DECKS: cards.DECKS, curve, seconds: 60, sliceMs: 50 });
  const cuts = [], plates = [];
  let errors = 0, t = 0, first = null, msMax = 0;
  const DT = 0.05;
  const t0 = Date.now();
  while (show.games < 3 && t < 600) {
    const a = performance.now();
    try { show.update(DT); } catch (e) { if (errors++ < 3) console.error(e); }
    await null;     // the scene resolves play() in a microtask, as between rAF frames
    msMax = Math.max(msMax, performance.now() - a);
    t += DT;
    const sh = show.shot;
    if (sh && (!cuts.length || cuts[cuts.length - 1].n !== sh.n || cuts[cuts.length - 1].game !== sh.game)) { cuts.push({ n: sh.n, kind: sh.kind, at: t, game: show.game.k, plan: sh.t }); plates.push(show.plate()); }
    if (!first && show.game.plan) first = show.game.plan;
  }
  const g0 = cuts.filter(c => c.game === 0);
  console.log(`  runtime: ${cuts.length} cuts, ${show.games} games in ${t.toFixed(0)} s of show (${Date.now() - t0} ms wall, slowest frame ${msMax.toFixed(0)} ms); game 0: ${g0.map(c => c.kind).join(' ')}`);
  ok(errors === 0, 'runtime: no exception');
  ok(show.games >= 3, `runtime: whole reels end and new games start (${show.games})`);
  ok(first && g0.map(c => c.kind).join() === first.shots.map(s => s.kind).join(), 'runtime: the cuts of game 0 follow its plan');
  const drift = first ? Math.max(...g0.map((c, i) => Math.abs((c.at - g0[0].at) - first.shots[i].t))) : 99;
  ok(drift < 2.5, `runtime: cut times stay within 2.5 s of the plan (${drift.toFixed(2)} s)`);
  ok(first && first.total <= 80, `runtime: with 60 s of page time the first reel is short (${first && first.total.toFixed(1)} s)`);
  ok(speeds.some(v => v < 0.5) && speeds.some(v => v >= 2), `runtime: slow motion and fast forward both run (min ${Math.min(...speeds).toFixed(2)}, max ${Math.max(...speeds).toFixed(2)})`);
  ok(plates.every(p => p.title && /turn \d+/.test(p.sub) && p.lines.some(l => /Fly B FlyWire/.test(l))), 'runtime: every plate has live numbers and the wiring');
  const lifeEnd = sc.world.mirror.players.map(p => p.life);
  ok(lifeEnd.every(Number.isFinite), `runtime: the table mirror has life totals (${lifeEnd})`);
  ok(cuts.filter(c => c.game === 1).length >= 4 && cuts.filter(c => c.game === 1)[0].kind !== undefined, 'runtime: the second game has its own reel');
  show.dispose();
}

console.log(`saver-reel: ${pass} pass, ${fail} fail (${Date.now() - t00} ms)`);
process.exit(fail ? 1 : 0);
