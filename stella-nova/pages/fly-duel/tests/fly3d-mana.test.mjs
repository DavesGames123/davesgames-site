// ============================================================================
//  FLY DUEL  ·  node tests for the mana colours and land stacks
//  (node tests/fly3d-mana.test.mjs)
// ----------------------------------------------------------------------------
//  Checks ui/fly3d/mana.js. The colours come from game/cards.js at run
//  time. The test also makes its own five-colour pool with dual lands, so
//  the stack layout is checked for every mix of one to five colours, with
//  and without duals, whatever the card pool has today.
//    colours   every land colour and cost colour of the pool is a colour,
//              each has a '#rrggbb' and a token shape, shapes differ
//    produces  string, list, 'a/b' and colours fields
//    stacks    one stack per colour set, stacks in u order and inside the
//              half width, a cascade per stack, one tower token per
//              untapped land, counts, no NaN
//  Exit code 1 on any failure.
// ============================================================================
import { CARDS } from '../game/cards.js';
import { manaColours, landProduces, colourHex, tokenShape, costColours, stackKey, stackLayout, STACK } from '../ui/fly3d/mana.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL', m); } };

// --- the real pool -------------------------------------------------------------
const pool = manaColours();
ok(pool.length >= 2 && pool.includes('amber') && pool.includes('moss'), `pool colours: ${pool.join(' ')}`);
for (const k of CARDS) for (const c of landProduces(k)) ok(pool.includes(c), `land colour ${c} of ${k.id} is in the pool`);
for (const k of CARDS) for (const [c] of costColours(k.cost)) ok(pool.includes(c), `cost colour ${c} of ${k.id} is in the pool`);
for (const c of pool) ok(/^#[0-9a-f]{6}$/i.test(colourHex(c)), `hex of ${c}: ${colourHex(c)}`);
const shapes = pool.map(tokenShape);
ok(new Set(shapes).size === shapes.length && shapes.every(s => s >= 3), `one token shape per colour (${shapes.join(' ')})`);
ok(tokenShape('generic') === 0 && tokenShape('none') === 0, 'generic mana is a square box (shape 0)');

// --- produces fields -------------------------------------------------------------
ok(landProduces({ produces: 'amber' }).join() === 'amber', 'produces string');
ok(landProduces({ produces: ['Amber', 'moss'] }).join() === 'amber,moss', 'produces list, lower case');
ok(landProduces({ produces: 'amber/moss' }).join() === 'amber,moss', "produces 'a/b'");
ok(landProduces({ colours: ['dusk'] }).join() === 'dusk', 'colours field');
ok(landProduces({ type: 'creature' }).length === 0, 'no produces: no colour');
ok(costColours({ generic: 2, amber: 1, moss: 0, dusk: 2 }).map(x => x.join(':')).join() === 'amber:1,dusk:2', 'coloured part of a cost');

// --- five colours and duals: every mix ---------------------------------------
const FIVE = ['amber', 'moss', 'tide', 'dusk', 'ash'];
const fake = {};
FIVE.forEach(c => { fake['L-' + c] = { id: 'L-' + c, type: 'land', produces: c }; });
for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) fake[`D-${FIVE[i]}-${FIVE[j]}`] = { id: `D-${FIVE[i]}-${FIVE[j]}`, type: 'land', produces: [FIVE[j], FIVE[i]] };
fake.bug = { id: 'bug', type: 'creature' };
const card = id => fake[id];
let mixes = 0, bad = [];
for (let mask = 1; mask < 32; mask++) {
  const cols = FIVE.filter((_, i) => mask & (1 << i));
  for (const withDual of [false, true]) {
    if (withDual && cols.length < 2) continue;
    mixes++;
    const lands = [];
    let uid = 1;
    cols.forEach((c, i) => { for (let k = 0; k <= i + 1; k++) lands.push({ uid: uid++, id: 'L-' + c, tapped: k % 2 === 1 }); });
    if (withDual) { lands.push({ uid: uid++, id: `D-${cols[0]}-${cols[1]}`, tapped: false }); lands.push({ uid: uid++, id: `D-${cols[0]}-${cols[1]}`, tapped: true }); }
    lands.push({ uid: uid++, id: 'bug', tapped: false });
    const L = stackLayout(lands, { order: FIVE, card });
    const want = cols.length + (withDual ? 1 : 0);
    const nLand = lands.length - 1, nFree = lands.filter(x => x.id !== 'bug' && !x.tapped).length;
    const name = `${cols.join('+')}${withDual ? ' +dual' : ''}`;
    if (L.stacks.length !== want) bad.push(`${name}: ${L.stacks.length} stacks, want ${want}`);
    if (L.at.size !== nLand || L.tower.size !== nFree) bad.push(`${name}: ${L.at.size} placed, ${L.tower.size} tokens`);
    for (let i = 1; i < L.stacks.length; i++) if (!(L.stacks[i].u > L.stacks[i - 1].u)) bad.push(`${name}: stacks out of u order`);
    for (const s of L.stacks) {
      if (Math.abs(s.u) > STACK.half + 1e-9) bad.push(`${name}: stack outside the row`);
      if (s.untapped !== s.free.length || s.n !== s.uids.length) bad.push(`${name}: counts`);
    }
    if (withDual) {
      const d = L.stacks.find(s => s.colours.length === 2);
      if (!d || d.colours.join() !== `${cols[0]},${cols[1]}` || d.n !== 2) bad.push(`${name}: dual stack ${d && d.key}`);
    }
    for (const v of [...L.at.values(), ...L.tower.values()]) if (!Object.values(v).every(x => typeof x === 'boolean' || Number.isFinite(x))) bad.push(`${name}: NaN`);
    for (const v of L.at.values()) if (v.dv > STACK.spread + 1e-9) bad.push(`${name}: cascade too long`);
    const ys = [...L.tower.values()].filter(t => t.stack === 0).map(t => t.y).sort((a, b) => a - b);
    if (ys.some((y, i) => Math.abs(y - i * STACK.towerStep) > 1e-9)) bad.push(`${name}: tower heights`);
    // a dual land sorts after the single colour of its first colour
    if (stackKey(fake[`D-${FIVE[0]}-${FIVE[1]}`], FIVE) !== 'amber+moss') bad.push('dual key order');
  }
}
ok(mixes === 31 + 26 && bad.length === 0, `stack layout for ${mixes} colour mixes (${bad.slice(0, 4).join(' | ') || 'all good'})`);
// many lands of one colour: the cascade shortens, it does not grow
const many = Array.from({ length: 30 }, (_, i) => ({ uid: i + 1, id: 'L-amber', tapped: false }));
const M = stackLayout(many, { order: FIVE, card });
ok(Math.max(...[...M.at.values()].map(v => v.dv)) <= STACK.spread + 1e-9 && M.stacks[0].untapped === 30, '30 lands: one stack, short cascade, 30 tokens');
// the real decks: amber and moss lands
const real = stackLayout([{ uid: 1, id: 'amber-ridge' }, { uid: 2, id: 'moss-hollow', tapped: true }, { uid: 3, id: 'amber-ridge' }]);
ok(real.stacks.length === 2 && real.stacks[0].key === 'amber' && real.stacks[0].untapped === 2 && real.stacks[1].untapped === 0, 'real lands: amber stack (2 free), moss stack (0 free)');

console.log(`fly3d-mana: ${pass} pass, ${fail} fail (${pool.length} pool colours, ${mixes} mixes)`);
process.exit(fail ? 1 : 0);
