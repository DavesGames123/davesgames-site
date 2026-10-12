// ============================================================================
//  FLY DUEL  ·  the playmat takes the colours of the deck of its seat
//  (node tests/fly3d-matcolour.test.mjs)
// ----------------------------------------------------------------------------
//  User direction 2026-10-12: "colors of the playmats should change based
//  on their current deck". The test builds a headless scene of
//  ui/fly3d/scene.js with an OffscreenCanvas stub that records each fill
//  and stroke colour of a canvas, and checks:
//    mono       an amber mat and a dew mat: other textures, and each print
//               uses the dark tint of its own colour only
//    cache      the same seat and colour set again gives the same texture
//    two        an amber-pollen mat uses both colours (gradient stops)
//    three      amber-moss-rot gives three colours
//    play       the first record of a game with other decks repaints both
//    custom     a custom list (play mode) gives the colours of its cards
//    dispose    many deck changes: the cache stays at MAT_CACHE, the
//               textures that leave it are disposed, and never a shown one
//    no canvas  the flat top colour of an amber mat and a dew mat differ
//  Exit code 1 on any failure.
// ============================================================================
import { registerHooks } from 'node:module';

const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

// A 2D context that accepts every call and records the colours it gets.
function stubCtx(log) {
  const store = {};
  const fn = () => proxy;
  const grad = { addColorStop: (o, c) => log.push(String(c).toLowerCase()) };
  const proxy = new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 10;
      if (k === 'then') return undefined;
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k in store) return store[k];
      if (k === 'width' || k === 'actualBoundingBoxAscent' || k === 'actualBoundingBoxDescent') return 10;
      return fn;
    },
    set(t, k, v) {
      store[k] = v;
      if ((k === 'fillStyle' || k === 'strokeStyle') && typeof v === 'string') log.push(v.toLowerCase());
      return true;
    },
  });
  return proxy;
}
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; this._log = []; this._g = stubCtx(this._log); } getContext() { return this._g; } };

const THREE = await import('three');
const rules = await import('../game/rules.js');
const { DECKS } = await import('../game/cards.js');
const { colourInfo } = await import('../ui/cardface.js');
const { greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const { createDuelScene } = await import('../ui/fly3d/scene.js');
const { MAT_CACHE, matColours } = await import('../ui/fly3d/hall.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const base = c => shade(colourInfo(c).hex, 0.13);
const mats = sc => { const m = []; sc.scene.traverse(o => { if (o.isMesh && o.name === 'playmat') m.push(o); }); return m; };
const mapOf = (sc, p) => mats(sc)[p]?.material?.[2]?.map ?? null;
const logOf = (sc, p) => mapOf(sc, p)?.image?._log ?? [];

const sc = createDuelScene(null, { headless: true });
const hall = sc.world.hall;
ok(typeof hall.matOf === 'function' && typeof hall.matTextures === 'function', 'the hall gives matOf(seat) and matTextures()');
ok(mats(sc).length === 2, 'two playmats');

// mono
sc.setState(rules.newGame({ seed: 3, decks: ['amber', 'dew'] }));
ok(hall.matOf?.(0).colours.join() === 'amber' && hall.matOf?.(1).colours.join() === 'dew', `mono: mat colours amber, dew (${hall.matOf?.(0).colours}, ${hall.matOf?.(1).colours})`);
const tA = mapOf(sc, 0), tD = mapOf(sc, 1);
ok(!!tA && !!tD && tA !== tD, 'mono: each mat has its own texture');
ok(logOf(sc, 0).includes(base('amber')) && !logOf(sc, 0).includes(base('dew')), 'mono: the amber mat prints the amber tint, not the dew tint');
ok(logOf(sc, 1).includes(base('dew')) && !logOf(sc, 1).includes(base('amber')), 'mono: the dew mat prints the dew tint, not the amber tint');

// cache: seat 0 changes to rot and back to amber
sc.setState(rules.newGame({ seed: 2, decks: ['rot', 'dew'] }));
ok(mapOf(sc, 0) !== tA && mapOf(sc, 1) === tD, 'cache: a new deck on seat 0 changes only the seat 0 texture');
sc.setState(rules.newGame({ seed: 6, decks: ['amber', 'dew'] }));
ok(mapOf(sc, 0) === tA, 'cache: the same seat and colour set gives the same texture');

// two colours
sc.setState(rules.newGame({ seed: 4, decks: ['amber-pollen', 'moss'] }));
ok(hall.matOf?.(0).colours.join() === 'amber,pollen', `two: amber-pollen mat colours (${hall.matOf?.(0).colours})`);
ok(logOf(sc, 0).includes(base('amber')) && logOf(sc, 0).includes(base('pollen')), 'two: the amber-pollen mat uses both tints');
ok(logOf(sc, 1).includes(base('moss')), 'two: the other seat takes moss');

// three colours
ok(matColours('amber-moss-rot').join() === 'amber,moss,rot', 'three: matColours of amber-moss-rot');

// play: a record of a game with other decks
const bots = [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')];
const M = new Match(rules, bots, { seed: 9, decks: ['rot', 'dew-pollen'] });
let done = false;
sc.play(M.next()).then(() => { done = true; });
for (let i = 0; i < 2000 && !done; i++) { sc.render(0.05); await new Promise(r => setImmediate(r)); }
ok(done, 'play: the scene plays the record');
ok(hall.matOf?.(0).colours.join() === 'rot' && hall.matOf?.(1).colours.join() === 'dew,pollen', `play: the mats follow the new decks (${hall.matOf?.(0).colours}, ${hall.matOf?.(1).colours})`);

// custom list (play mode with a deck of the deck builder)
sc.setState(rules.newGame({ seed: 5, decks: [DECKS['moss-rot'].list.map(r => r.slice()), 'amber'] }));
ok(hall.matOf?.(0).colours.join() === 'moss,rot', `custom: a custom list gives its card colours (${hall.matOf?.(0).colours})`);

const gone = new Set();
const watch = t => t && t.addEventListener('dispose', () => gone.add(t));
// dispose: many deck changes
const ids = Object.keys(DECKS);
const seen = new Set();
for (let i = 0; i < ids.length * 2; i++) {
  sc.setState(rules.newGame({ seed: 10 + i, decks: [ids[i % ids.length], ids[(i * 5 + 3) % ids.length]] }));
  watch(mapOf(sc, 0)); watch(mapOf(sc, 1)); seen.add(mapOf(sc, 0)); seen.add(mapOf(sc, 1));
}
const st = hall.matTextures?.() || {};
ok(st.cached <= MAT_CACHE, `dispose: the cache stays at ${MAT_CACHE} or less (${st.cached})`);
ok(st.disposed > 0 && gone.size > 0, `dispose: old textures are disposed (${st.disposed} counted, ${gone.size} seen)`);
ok(!gone.has(mapOf(sc, 0)) && !gone.has(mapOf(sc, 1)), 'dispose: the shown textures are not disposed');
ok(st.made - st.disposed === st.cached, `dispose: made - disposed = cached (${st.made} - ${st.disposed} = ${st.cached})`);
ok(seen.size > MAT_CACHE, `dispose: the run made more textures than the cache holds (${seen.size})`);
sc.dispose();
ok(hall.matTextures().cached === 0, 'dispose: the hall dispose empties the cache');

// no canvas: the flat top colour follows the deck
delete globalThis.OffscreenCanvas;
const sc2 = createDuelScene(null, { headless: true });
sc2.setState(rules.newGame({ seed: 3, decks: ['amber', 'dew'] }));
const [m0, m1] = mats(sc2);
ok(m0.material[2].map === null && m1.material[2].map === null, 'no canvas: no texture');
ok(!m0.material[2].color.equals(m1.material[2].color), 'no canvas: the amber top colour differs from the dew top colour');
const c0 = m0.material[2].color;
ok(c0.r > c0.b, `no canvas: the amber top is warm (${c0.getHexString()})`);
sc2.dispose();

console.log(`fly3d-matcolour: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
