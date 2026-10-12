// ============================================================================
//  FLY DUEL  ·  scorecard checks  (node tests/hud.test.mjs)
// ----------------------------------------------------------------------------
//  The play agent owns this file. No browser (user ban).
//      ui/hud/scorecard.js   model formatting, the d20, the DOM card on a
//                            stub document (update and fire run)
//      ui/hud/raster.js      KC bins, MBON bars, DAN cells, the painter on
//                            a stub 2D context (whole pixels, no blur)
//  The traces are real: the pretrained fly decides on real boards.
//
//  GREP MAP   (grep -n "^// ---" tests/hud.test.mjs)
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const rules = await import('../game/rules.js');
const cards = await import('../game/cards.js');
const { CARD } = cards;
const { TOKENS } = await import('../ui/tokens.js');
const { scorecardModel, fmtValue, lifeTone, manaColour, d20Svg, createScorecard } = await import('../ui/hud/scorecard.js');
const { kcBins, mbonBars, danCells, createRasterModel, drawRaster, createRaster } = await import('../ui/hud/raster.js');

// a real trace from the pretrained fly
const pre = JSON.parse(readFileSync(join(ROOT, 'data/pretrained.json'), 'utf8'));
const C = JSON.parse(readFileSync(join(ROOT, pre.wiring?.A?.file || 'data/connectome.json'), 'utf8'));
const { Fly } = await import('../brain/fly.js');
const fly = Fly.fromJSON(C, pre.A);
let s = rules.newGame({ seed: 21, first: 0 });
const traces = [];
for (let i = 0; i < 30 && !rules.isOver(s); i++) {
  const legal = rules.legalActions(s);
  const r = fly.choose(s, legal, {});
  traces.push(r.trace);
  s = rules.step(s, r.action);
}

// --------------------------------------------------------------- 1 formatting
{
  ok(fmtValue(0.4219) === '+0.42', 'fmtValue +0.42');
  ok(fmtValue(-0.05) === '−0.05', 'fmtValue uses a true minus sign');
  ok(fmtValue(NaN) === '–', 'fmtValue of NaN is a dash');
  ok(lifeTone(20) === 'ok' && lifeTone(5) === 'low' && lifeTone(0) === 'dead', 'lifeTone bands (<= 5 low)');
  ok(manaColour('amber') === TOKENS.amber, 'amber ink is the --amber token');
  ok(manaColour('dew', { dew: { ink: '#6cc4e8' } }) === '#6cc4e8', 'a COLOURS table gives the ink');
  ok(manaColour('nope') === TOKENS.none, 'an unknown colour is --none');
}

// --------------------------------------------------------------- 2 scorecard model
{
  let g = rules.newGame({ seed: 8, first: 0 });
  g = rules.withPermanent(g, 0, 'amber-ridge');
  g = rules.withPermanent(g, 0, 'amber-ridge', { tapped: true });
  g = rules.withPermanent(g, 0, 'moss-hollow');
  const m = scorecardModel({ state: g, seat: 0, CARD, kind: 'fly', letter: 'A', name: 'Fly A', source: 'hemibrain v1.2',
    top: [{ text: 'x', value: 0.5, chosen: true }, { text: 'y', value: -0.25 }, { text: 'z', value: 0.1 }], thinking: true });
  ok(m.life === 20 && m.lifeText === '20' && m.tone === 'ok', 'life 20');
  ok(m.counts.map(c => c.key).join() === 'hand,library,graveyard,creatures', 'four counts in order');
  ok(m.counts[0].n === 7 && m.counts[1].n === 33, 'hand 7, library 33');
  const am = m.mana.find(r => r.kind === 'amber');
  ok(am && am.up === 1 && am.total === 2 && am.label === '1/2', 'amber stack 1/2 untapped');
  ok(m.mana.find(r => r.kind === 'moss')?.label === '1/1', 'moss stack 1/1');
  ok(m.status === 'Thinking' && m.acting, 'a thinking fly says Thinking');
  ok(m.top.length === 3 && m.top[0].valueText === '+0.50' && m.top[0].chosen, 'top rows formatted');
  ok(m.top.every(t => t.bar >= 0 && t.bar <= 1) && m.top[0].bar > m.top[2].bar && m.top[2].bar > m.top[1].bar, 'top bars ordered by value');
  const h = scorecardModel({ state: g, seat: 1, CARD, kind: 'human', deckName: 'Moss Grove' });
  ok(h.name === 'You' && h.letter === 'B' && h.status === 'Waiting', 'human card: You, B, Waiting');
  ok(h.mana.length === 0, 'no lands, no stacks');
  const dual = scorecardModel({ state: { players: [{ life: 3, hand: [], library: [], graveyard: [], battlefield: [{ id: 'd', tapped: false }] }], active: 0, toAct: 0, result: null },
    seat: 0, CARD: { d: { id: 'd', type: 'land', mana: ['dew', 'rot'] } }, colours: cards.COLOURS });
  ok(dual.mana[0].inks.length === 2 && dual.tone === 'low', 'a dual stack has two inks; life 3 is low');
  const over = scorecardModel({ state: { ...g, result: { winner: 0, reason: 'life' } }, seat: 0, CARD });
  ok(over.status === 'Won' && !over.acting, 'winner says Won');
}

// --------------------------------------------------------------- 3 the d20
{
  const svg = d20Svg(17);
  ok(svg.startsWith('<svg') && svg.endsWith('</svg>') && />17</.test(svg), 'd20 shows the number');
  ok((svg.match(/<polygon/g) || []).length === 2 && (svg.match(/<line/g) || []).length === 9, 'd20: hexagon, front face, nine edges');
  ok(!/filter|blur|gradient/.test(svg), 'd20 is flat and hard-edged');
  ok(d20Svg(4, { tone: 'low' }).includes(TOKENS.dmg), 'low life inks the die --dmg');
  ok(d20Svg(-3).includes('>-3<'), 'negative life still shows');
}

// --------------------------------------------------------------- 4 raster pieces
{
  const t = traces[traces.length - 1];
  ok(t && t.kc && t.kc.length > 0, `real trace has active KCs (${t?.kc?.length})`);
  const bins = kcBins(t, C.kc.n, 32);
  ok(bins.length === 32 && bins.every(v => v >= 0 && v <= 1), 'kcBins in [0, 1]');
  ok(bins.some(v => v > 0), 'some KC bin is lit');
  const one = kcBins({ kc: Uint16Array.from([0]) }, 64, 8);
  ok(one[0] > 0 && one.slice(1).every(v => v === 0), 'one active KC lights its own bin only');
  const bars = mbonBars(t);
  ok(bars.length === t.mbon.length && bars.every(b => b.v >= 0 && b.v <= 1), 'one bar per MBON, scaled');
  ok(bars.some(b => b.valence !== 0), 'bars carry valence');
  const dc = danCells({ danCompartment: Float32Array.from([0.5, -1, 0]) });
  ok(dc[0].sign === 1 && dc[1].sign === -1 && dc[1].v === 1 && dc[2].v === 0, 'DAN cells: sign and scale');
  const rm = createRasterModel({ nKC: C.kc.n, rows: 16, cols: 5 });
  for (const tr of traces) rm.push(tr);
  ok(rm.columns.length === 5 && rm.last === traces[traces.length - 1], 'raster keeps the last cols decisions');
}

// --------------------------------------------------------------- 5 painter on a stub context
function stubCtx() {
  const calls = [];
  let shadow = false;
  return {
    calls,
    get shadowBlur() { return 0; }, set shadowBlur(v) { shadow = true; },
    get usedShadow() { return shadow; },
    fillStyle: '', imageSmoothingEnabled: true,
    fillRect(x, y, w, h) { calls.push([x, y, w, h, this.fillStyle]); },
  };
}
{
  const rm = createRasterModel({ nKC: C.kc.n, rows: 32, cols: 44 });
  for (const tr of traces) rm.push(tr);
  const g = stubCtx();
  drawRaster(g, rm, { w: 360, h: 128, accent: TOKENS.flyA });
  ok(g.calls.length > 50, `painter draws cells (${g.calls.length} rects)`);
  ok(g.calls.every(([x, y, w, h]) => [x, y, w, h].every(Number.isInteger)), 'every rect is on whole pixels');
  ok(g.calls.every(([x, y, w, h]) => x >= 0 && y >= 0 && x + w <= 360 && y + h <= 128), 'every rect is inside the canvas');
  ok(!g.usedShadow, 'no shadowBlur');
  ok(g.calls.some(c => c[4] === TOKENS.app) || g.calls.some(c => c[4] === TOKENS.avoid), 'MBON bars use the valence tokens');
  ok(g.calls.some(c => c[4] === TOKENS.flyA), 'the newest column has the fly colour line');
  const e = stubCtx();
  drawRaster(e, createRasterModel({}), { w: 80, h: 30 });
  ok(e.calls.length >= 2, 'an empty raster draws its ground');
}

// --------------------------------------------------------------- 6 DOM card on a stub document
function stubEl(tag = 'div') {
  const kids = new Map();
  const cls = new Set();
  const el = {
    tagName: tag, innerHTML: '', textContent: '', hidden: false, dataset: {}, style: {}, disabled: false,
    className: '', width: 0, height: 0, listeners: {},
    classList: { toggle: (c, on) => { (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c); }, add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
    setAttribute() {}, appendChild(c) { return c; }, remove() {},
    addEventListener(t, f) { el.listeners[t] = f; },
    querySelector(sel) { if (!kids.has(sel)) kids.set(sel, stubEl(sel)); return kids.get(sel); },
    getBoundingClientRect: () => ({ width: 180, height: 40 }),
    getContext: () => stubCtx(),
    closest: () => null,
    ownerDocument: null,
    get cls() { return cls; },
  };
  return el;
}
{
  const host = stubEl('main');
  host.ownerDocument = { createElement: t => stubEl(t) };
  let tapped = -1;
  const sc = createScorecard(host, { seat: 1, kind: 'fly', connectome: C, onPlayer: p => { tapped = p; }, compact: true });
  const m = scorecardModel({ state: s, seat: 1, CARD, kind: 'fly', name: 'Fly B', source: 'FlyWire 783', top: [{ text: 'Play a land', value: 0.3, chosen: true }] });
  let threw = null;
  try { sc.update(m); for (const tr of traces.slice(0, 5)) sc.fire(tr); sc.update({ ...m, life: m.life - 3, tone: lifeTone(m.life - 3) }); }
  catch (e) { threw = e; }
  ok(!threw, `scorecard update and fire run on a stub DOM (${threw && threw.message})`);
  ok(sc.neural && sc.neural.kind === '2d', 'with no createBrainCard the 2D raster draws');
  ok(sc.el.querySelector('.hd-name').textContent === 'Fly B', 'the name is set');
  ok(/library/.test(sc.el.querySelector('.hd-counts').innerHTML), 'counts are written');
  ok(/class="chosen"/.test(sc.el.querySelector('.hd-top').innerHTML), 'the chosen top move is marked');
  ok(/V [+−]\d/.test(sc.el.querySelector('.hd-vd').textContent), 'the value and delta line is written');
  sc.el.querySelector('.hd-life').listeners.click?.();
  ok(tapped === 1, 'a tap on the life die names the seat (player target)');
  // createBrainCard is used when the module gives it
  const host2 = stubEl('main'); host2.ownerDocument = host.ownerDocument;
  let fired = 0;
  const sc2 = createScorecard(host2, { seat: 0, kind: 'fly', connectome: C, brainMod: { createBrainCard: () => ({ fire() { fired++; }, dispose() {} }) } });
  sc2.update(scorecardModel({ state: s, seat: 0, CARD, kind: 'fly' }));
  sc2.fire(traces[0]);
  ok(sc2.neural.kind === '3d' && fired === 1, 'createBrainCard is used when present');
  const host3 = stubEl('main'); host3.ownerDocument = host.ownerDocument;
  const sc3 = createScorecard(host3, { seat: 0, kind: 'human' });
  sc3.update(scorecardModel({ state: s, seat: 0, CARD, kind: 'human', deckName: 'Amber Swarm' }));
  ok(sc3.el.querySelector('.hd-brain').hidden === true && !sc3.neural, 'the human card has no brain panel');
  const r = createRaster(stubEl('canvas'), { nKC: 100 });
  r.fire(traces[0]);
  ok(r.model.columns.length === 1, 'createRaster.fire pushes a column');
}

// --------------------------------------------------------------- 7 look greps
{
  for (const f of ['ui/hud/scorecard.js', 'ui/hud/raster.js', 'ui/hud/hud.css']) {
    const t = readFileSync(join(ROOT, f), 'utf8');
    ok(!/shadowBlur\s*=|filter:\s*blur|text-shadow|backdrop-filter|radial-gradient/.test(t), `${f}: no soft glow`);
    ok(!/box-shadow:[^;]*\d+px\s+\d+px\s+[1-9]/.test(t), `${f}: box-shadow only as a hard ring`);
    ok(!/Playfair|Cormorant|JetBrains|Beleren|MPlantin/.test(t), `${f}: no banned fonts`);
  }
  const css = readFileSync(join(ROOT, 'ui/hud/hud.css'), 'utf8');
  ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css), 'hud.css has the [hidden] rule');
  ok(/min-width:\s*44px/.test(css) && /min-height:\s*44px/.test(css), 'the life die is a 44 px target');
}

console.log(`hud: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
