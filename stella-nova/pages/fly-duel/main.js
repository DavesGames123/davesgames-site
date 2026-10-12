// ============================================================================
//  FLY DUEL  ·  page logic  (module)
// ----------------------------------------------------------------------------
//  The page is a fullscreen game with two modes (index.html header):
//    watch  Fly A against Fly B on the 3D table, which fills the game
//           view. The two big live brains (initPanels) are transparent
//           overlays on it: A at the left and B at the right side, or A
//           at the top and B at the base on a portrait phone. The camera
//           frames the board between them (syncClear). The slim
//           scorecards sit in the top corners. One turn box
//           (turnLine) is the one voice of the game state; the table
//           holds still for a pause between turns.
//    play   You against a model fly: ui/play/play.js mountPlay() in
//           #playRoot. The 3D canvas of the watch table moves into the
//           play table, and play.js drives the scene. On exit the canvas
//           comes back and a new watch game starts.
//  The title screen (#chooser) is ui/chooser/chooser.js mountChooser:
//  the mode cards, a seat per player and one tile per deck of
//  game/cards.js DECK_ORDER, and a Random tile. The URL keeps the mode and the decks (parseQuery,
//  queryOf). The explainer sections 01 to 09 are in the "How it works"
//  drawer (#how), as CONTRACT.md asks.
//
//  The other packages load by dynamic import(), so a missing or broken
//  module gives a loading message and the rest of the page still works:
//    game/rules.js game/cards.js game/features.js game/bots.js   (package A)
//    data/connectome.json data/connectome-flywire.json data/facts.js (package B)
//    brain/fly.js brain/mb.js                                    (package C)
//    train/worker.js data/pretrained.json data/training-curve.json (package D)
//    saver.js                                                    (package F)
//    ui/fly3d/scene.js (the 3D table, three.js by the import map)
//    ui/hud/scorecard.js ui/play/controller.js ui/play/play.js
//  Fly A is wired from data/connectome.json (hemibrain v1.2) and Fly B
//  from data/connectome-flywire.json (FlyWire 783): two animals.
//  pretrained.json format 2 names the file of each fly, and conOf(side)
//  gives it. In node or without WebGL, the 2D table and the 2D brains of
//  #arena play the watch match instead of the 3D table.
//
//  One rAF loop draws only the canvases that are on screen, and runs the
//  tickers. The loop stops while window.__fdSaver is true (the saver
//  sets it). window.flyDuel gives the saver the loaded modules.
//
//  GREP MAP
//      grep -n 'function fit'             canvas size from CSS size and DPR
//      grep -n 'async function loadAll'   dynamic imports and data files
//      grep -n 'function weightsFor'      pretrained.json -> one fly
//      grep -n 'function makeFly'         Fly construction and weights
//      grep -n 'function dragRotate'      pointer drag on a brain canvas
//      grep -n 'export function hudHTML'  fallback HUD strip: life, mana
//      grep -n 'export function parseQuery'  URL -> mode, decks, opponent
//      grep -n 'export function queryOf'  mode, decks -> URL query
//      grep -n 'export function pickDecks'   'random' -> a deck id by seed
//      grep -n 'export function turnLine'    the one turn indicator
//      grep -n 'export function turnPauseMs' the pause between turns
//      grep -n 'function trainedDecks'    decks named in the training meta
//      grep -n 'function start3d'         the 3D table (ui/fly3d/scene.js)
//      grep -n 'function initHero'        watch match, 3D or 2D driver
//      grep -n 'function initScorecards'  watch scorecards, top-3, brains
//      grep -n 'function initPanels'      the two brain panels, one renderer
//      grep -n 'function initZoom'        right-click card zoom (watch)
//      grep -n 'function brainFire'       a decision -> its fly's panel
//      grep -n 'function capOf'           panel caption: KCs, V, δ
//      grep -n 'function syncClear'       overlay insets -> scene framing
//      grep -n 'function setBrains'       brains: panels, scene, off
//      grep -n 'function conOf'           the connectome of Fly A or Fly B
//      grep -n 'function initModes'       the title screen, URL
//      grep -n 'function startChoice'     a start of the title screen
//      grep -n 'async function enterPlay' watch -> play
//      grep -n 'function exitPlay'        play -> watch
//      grep -n 'function initHow'         the drawer, Esc and keys
//      grep -n 'function initHeroStats'   numbers in the drawer, per fly
//      grep -n 'function initGame'        01 rules, decks, gallery
//      grep -n 'function initGallery'     01 card grid and filter bar
//      grep -n 'function initCentre'      02 point cloud, counts, facts
//      grep -n 'function initCompare'     02 Fly A / Fly B table (COMPARE)
//      grep -n 'function initKcCode'      [data-kc] KC share, k, code
//      grep -n 'function initSmell'       03 features -> glomeruli
//      grep -n 'function initSparse'      04 KC sparse code, overlap
//      grep -n 'function initDopamine'    05 toy three-factor rule
//      grep -n 'function initTrain'       06 worker, live curves
//      grep -n 'function initWatch'       07 step-through match
//      grep -n 'function initResults'     08 measured curve, held-out table
//      grep -n 'function finalOf'         meta.final of training-curve.json
//      grep -n 'function initFacts'       [data-fact] and [data-cite] spans
//      grep -n 'function initSources'     references and credits
//      grep -n 'function initChips'       section bar of the drawer
//      grep -n 'function loop'            the one rAF loop
// ============================================================================
import { renderBoard, renderDecks, renderGallery, renderGalleryControls, GALLERY_ALL, setKeywordText, KEYWORD_TEXT } from './ui/board.js';
import { BrainView } from './ui/brain.js';
import { curveRows, toSeries, seriesLabel, drawChart, SERIES_COL, flattenRow, evalVerdict } from './ui/charts.js';
import { ToyMB, drawToy, drawGlomeruli, drawSparse, jaccard, cosine } from './ui/explain.js';
import { Match, agentFromFly, agentFromBot } from './ui/match.js';
import { beatPlan, motionFor } from './ui/motion.js';
import { typesetAll } from '../../lib/sci-math.js';
import { TOKENS, KC_TYPE, FLY } from './ui/tokens.js';
import { colourInfo, drawCard, paintWithArt } from './ui/cardface.js';
import { createCardZoom, attachCardZoom } from './ui/cardzoom.js';
import { glyphHTML, hydrate } from './ui/cardview.js';
import { mountChooser } from './ui/chooser/chooser.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = v => `${(100 * v).toFixed(1)}%`;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;
const NAMES = ['Fly A', 'Fly B'];

// Size a canvas to its CSS box at the device pixel ratio. Returns the 2D
// context with CSS-pixel units, plus the CSS width and height.
function fit(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

// Each view: { cv, draw(dt), live() }. live() true means it moves now.
const views = [];
const onScreen = new Set();
const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)), { rootMargin: '80px' });
function view(cv, draw, live = () => false) {
  const v = { cv, draw, live, dirty: true };
  views.push(v); io.observe(cv);
  return v;
}
addEventListener('resize', () => views.forEach(v => v.dirty = true));
// Tickers run each frame with dt (autoplay). Each one checks its own
// visibility; none runs while the tab is hidden (no rAF then).
const tickers = [];

// Segmented buttons: one is "on". Calls fn(value) on a change.
function seg(el, fn) {
  if (!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    fn(b.dataset.v);
  });
}

// ---------------------------------------------------------------- loading
const M = {};   // modules: rules, cards, features, bots, fly, facts
const D = {};   // data: connectome, pretrained, curve
const status = {};

async function tryImport(key, path) {
  try { M[key] = await import(path); status[key] = 'ok'; }
  catch (e) { M[key] = null; status[key] = String(e && e.message || e); console.warn(`fly-duel: ${path}`, e); }
}
async function quietImport(key, path) {
  try { M[key] = await import(path); status[key] = 'ok'; }
  catch (e) { M[key] = null; status[key] = String(e && e.message || e); console.info(`fly-duel: ${path}`, e); }
}
async function tryJSON(key, path) {
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    D[key] = await r.json(); status[key] = 'ok';
  } catch (e) { D[key] = null; status[key] = String(e && e.message || e); }
}

async function loadAll() {
  await Promise.all([
    tryImport('rules', './game/rules.js'), tryImport('cards', './game/cards.js'),
    tryImport('features', './game/features.js'), tryImport('bots', './game/bots.js'),
    tryImport('facts', './data/facts.js'),
    tryJSON('connectome', './data/connectome.json'),
    tryJSON('pretrained', './data/pretrained.json'),
    tryJSON('curve', './data/training-curve.json'),
  ]);
  // brain/fly.js imports the rules, so it loads after them.
  // train/selfplay.js gives TRAIN_MIX, TRAIN_EXPLORE and FLY_OPTS.
  // pretrained.json format 2: a wiring file per fly (fly B on FlyWire).
  D.cons = { A: D.connectome, B: D.connectome };
  for (const side of ['A', 'B']) {
    const f = D.pretrained?.wiring?.[side]?.file;
    if (!f || f === 'data/connectome.json') continue;
    try { const r = await fetch(`./${f}`); if (r.ok) D.cons[side] = await r.json(); } catch { /* keep connectome.json */ }
  }
  await tryImport('fly', './brain/fly.js');
  await tryImport('trainer', './train/selfplay.js');
  // the scorecards and the top-3 of a decision; without them the
  // fallback HUD strip (#hudBar) shows
  await Promise.all([quietImport('hud', './ui/hud/scorecard.js'), quietImport('ctrl', './ui/play/controller.js')]);
  if (M.cards?.KEYWORDS) setKeywordText(M.cards.KEYWORDS);
  return { M, D, status };
}

// card id -> definition, tokens too
function cardMap() {
  if (!M.cards) return new Map();
  if (M.cards.CARD) return new Map(Object.entries(M.cards.CARD));
  return new Map([...(M.cards.CARDS || []), ...(M.cards.TOKENS || [])].map(c => [c.id, c]));
}

// pretrained.json -> the saved fly for one side, or null.
function weightsFor(side, src = D.pretrained) {
  if (!src) return null;
  return src[side] ?? src.flies?.[side] ?? src[`fly${side}`] ?? (Array.isArray(src.flies) ? src.flies[side === 'A' ? 0 : 1] : null) ?? null;
}

// A Fly from saved weights, or a naive Fly. Returns null when brain/fly.js
// or the connectome is missing, or construction throws.
function makeFly(side, saved = weightsFor(side)) {
  const Fly = M.fly?.Fly;
  if (!Fly || !D.connectome) return null;
  // each fly on its own wiring file (pretrained.json "wiring"); the
  // section 06 worker trains on the same files
  const C = conOf(side);
  if (saved) {
    try { return Fly.fromJSON(C, saved); }
    catch (e) { console.warn(`fly-duel: weights for ${side} did not load`, e); }
  }
  try { return new Fly(C, { ...(M.trainer?.FLY_OPTS || {}), name: `Fly ${side}`, hemisphere: side, seed: side === 'A' ? 1 : 2 }); }
  catch (e) { console.warn('fly-duel: new Fly failed', e); return null; }
}

// Shared flies for the hero and sections 03, 04 (built once).
const flies = { A: null, B: null, trained: false };
function heroFlies() {
  if (flies.A || flies.B) return flies;
  flies.A = makeFly('A'); flies.B = makeFly('B');
  flies.trained = !!(D.pretrained && weightsFor('A') && weightsFor('B'));
  return flies;
}

// Two agents for a match. kind: 'ab' | 'ag' | 'ar'.
function agentsFor(kind, A, B, seed = 1) {
  const bots = M.bots;
  const bot = k => k === 'ar' && bots?.randomBot ? agentFromBot(bots.randomBot(mulberry(seed)), 'random bot')
    : bots?.greedyBot ? agentFromBot(bots.greedyBot(), 'greedy bot') : null;
  const a = A ? agentFromFly(A, 'Fly A') : bot('ag');
  const b = kind === 'ab' ? (B ? agentFromFly(B, 'Fly B') : bot('ag')) : bot(kind);
  if (a && !A) a.name = 'Fly A (stand-in: greedy bot)';
  if (b && kind === 'ab' && !B) b.name = 'Fly B (stand-in: greedy bot)';
  return a && b ? [a, b] : null;
}
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Uids to light for an action (attackers, blockers).
function hotOf(action) {
  const s = new Set();
  if (!action) return s;
  for (const u of action.attackers || []) s.add(u);
  for (const p of action.blocks || []) { s.add(p[0]); s.add(p[1]); }
  if (action.target != null) s.add(action.target);
  return s;
}

// Pointer drag turns a brain view. Vertical page scroll stays (pan-y).
function dragRotate(cv, bv, v) {
  let px = 0, py = 0, id = null;
  cv.addEventListener('pointerdown', e => { id = e.pointerId; px = e.clientX; py = e.clientY; bv.drag = true; cv.setPointerCapture(id); });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    bv.yaw += (e.clientX - px) * 0.01; bv.pitch = Math.max(-1.4, Math.min(1.4, bv.pitch + (e.clientY - py) * 0.006));
    px = e.clientX; py = e.clientY; v.dirty = true;
  });
  const up = e => { if (e.pointerId === id) { id = null; bv.drag = false; } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}

function brainCanvas(cv, bv) {
  const v = view(cv, dt => { const { g, w, h } = fit(cv); bv.draw(g, w, h, dt); }, () => bv.ok && !REDUCED || bv.busy || bv.pulse > 0 || bv.dan > 0);
  dragRotate(cv, bv, v);
  return v;
}

// ---------------------------------------------------------------- modes (pure)
// The mode and the decks in the URL. deckIds: the known deck ids (an id
// not in the list reads as 'random'). Result:
//   { mode: 'watch'|'play'|null, decks: [A, B], myDeck, opp, flyDeck }
// mode null means the URL names no mode: the chooser opens.
//   ?mode=watch&deck=amber-dew,rot   Fly A plays amber-dew, Fly B rot
//   ?mode=play&deck=moss&opp=A&fly=random
export function parseQuery(search, deckIds = []) {
  let q;
  try { q = new URLSearchParams(search || ''); } catch { q = new URLSearchParams(''); }
  const known = id => (id && deckIds.includes(id) ? id : 'random');
  const m = (q.get('mode') || '').toLowerCase();
  const mode = m === 'watch' || m === 'play' ? m : null;
  const parts = (q.get('deck') || '').split(',').map(x => x.trim()).filter(Boolean);
  const opp = ['A', 'B', 'bot'].includes(q.get('opp')) ? q.get('opp') : 'B';
  return {
    mode,
    decks: mode === 'play' ? ['random', 'random'] : [known(parts[0]), known(parts[1])],
    myDeck: mode === 'play' && deckIds.includes(parts[0]) ? parts[0] : (deckIds[0] || null),
    opp, flyDeck: known(q.get('fly')),
  };
}

// The URL query of a mode state (the inverse of parseQuery).
export function queryOf(st) {
  const q = new URLSearchParams();
  q.set('mode', st.mode === 'play' ? 'play' : 'watch');
  if (st.mode === 'play') {
    if (st.myDeck) q.set('deck', st.myDeck);
    q.set('opp', st.opp || 'B');
    if (st.flyDeck && st.flyDeck !== 'random') q.set('fly', st.flyDeck);
  } else if (st.decks && st.decks.some(d => d && d !== 'random')) q.set('deck', st.decks.map(d => d || 'random').join(','));
  return `?${q.toString()}`;
}

// 'random' -> a deck id, from the game seed: the same seed gives the same
// decks. The two random picks of one game are different decks when the
// pool has two or more.
export function pickDecks(sel, seed, deckIds) {
  const ids = deckIds && deckIds.length ? deckIds : ['amber', 'moss'];
  let a = (seed >>> 0) || 1;
  const next = () => { a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return a / 4294967296; };
  const out = [];
  for (let i = 0; i < 2; i++) {
    const want = sel?.[i];
    if (want && want !== 'random' && ids.includes(want)) { out.push(want); continue; }
    let pick = ids[Math.floor(next() * ids.length)];
    for (let k = 0; k < 8 && ids.length > 1 && out.includes(pick); k++) pick = ids[Math.floor(next() * ids.length)];
    out.push(pick);
  }
  return out;
}

// The one turn indicator (CONTRACT.md "one voice"): the turn, the fly
// whose turn it is and the step, or the result. Pure, for the tests.
//   { turn, seat, who, step, over, text }   text: "Turn 7 · Fly B · combat"
const STEP_WORD = { main: 'main', attack: 'combat', block: 'blocks', over: 'end' };
export function turnLine(state, names = NAMES) {
  const turn = state?.turn ?? 1, r = state?.result || null;
  if (r) {
    const who = r.winner === -1 ? 'Draw' : `${names[r.winner]} wins`;
    return { turn, seat: r.winner, who, step: '', over: true, text: `Turn ${turn} · ${who}` };
  }
  const seat = state?.active ?? 0, step = STEP_WORD[state?.phase] || state?.phase || '';
  return { turn, seat, who: names[seat], step, over: false, text: `Turn ${turn} · ${names[seat]}${step ? ` · ${step}` : ''}` };
}
function turnBoxHTML(t) {
  return `<b>Turn ${t.turn}</b><i aria-hidden="true">·</i><span class="s${t.seat}">${esc(t.who)}</span>${t.step ? `<i aria-hidden="true">·</i><em>${esc(t.step)}</em>` : ''}`;
}

// The pause between turns of the watch table, in ms. The table holds the
// board still and the turn box marks the new turn for this long. Speed 1 gives
// 1.4 s; reduced motion keeps the pause (it is a pause, not a motion).
export function turnPauseMs(speed = 1) { return Math.round(1400 / Math.max(0.25, speed || 1)); }

// The decks the flies trained with, from the meta of the measured files,
// or null when no file names them. The page never types them in.
function trainedDecks() {
  const d = D.curve?.meta?.decks ?? D.pretrained?.meta?.decks ?? D.curve?.meta?.curriculum?.decks ?? null;
  return Array.isArray(d) && d.length ? d : null;
}
const deckIdsOf = () => (M.cards?.DECK_ORDER?.length ? M.cards.DECK_ORDER : Object.keys(M.cards?.DECKS || {})).filter(k => M.cards?.DECKS?.[k]);
const deckName = id => (id === 'random' ? 'Random' : M.cards?.DECKS?.[id]?.name || id);

// ---------------------------------------------------------------- hero
// Two drivers share one Match.
//   3D (hero.mode '3d'): ui/fly3d/scene.js plays each record. The next
//   decision starts when scene.play(record) resolves, so the flies set
//   the pace. The HUD cards read life and mana from the state after the
//   record. "brains up close" adds two createBrainView canvases.
//   2D (hero.mode '2d', the stand-in when the scene cannot start): one
//   decision per beat (ui/motion.js beatPlan). The ticker runs the timed
//   steps of the beat: focus, PN/KC/MBON reveal, decision strip, table,
//   DAN burst.
// At a game end the last board holds with a banner, then a new game.
const hero = {
  match: null, playing: !REDUCED, speed: 1, bvs: [], log: [], last: null, rec: null, plan: null, t: 0, hold: 0, focus: -1,
  mode: '2d', scene: null, busy: false, gen: 0, cam: 'auto', brains: 'panels', panels: null, poke: 0,
  // watch mode: deck choice per fly ('random' or an id), the pause
  // between turns (ms left), the top-3 of each fly, the scorecards
  sel: ['random', 'random'], pause: 0, top: [[], []], cards: null, suspended: false,
};

// The banner text of a game result (DESIGN.md 2.3).
export function resultBanner(r, names = NAMES) {
  if (!r) return null;
  if (r.winner === -1) return { text: `Draw · ${r.reason || 'turn cap'}`, seat: -1 };
  const why = r.reason === 'life' ? 'life 0' : r.reason === 'decked' ? `${names[1 - r.winner]} drew from an empty deck` : (r.reason || '');
  return { text: `${names[r.winner]} wins${why ? ` · ${why}` : ''}`, seat: r.winner };
}

// One mana glyph of ui/cardface.js as page markup, in a wrapper with the
// class mana-<kind>. hydrate() of ui/cardview.js draws the canvas.
function glyphOf(kind, size = 16, n = 0) {
  const k = kind || 'generic';
  return `<i class="mana mana-${esc(k)}">${glyphHTML(k === 'generic' ? { generic: n || 1 } : { [k]: 1 }, size, k)}</i>`;
}
// Colour order of the pool (COLOUR_IDS of game/cards.js), then generic.
let colourIds = ['amber', 'moss'];

// The fallback HUD strip, one box per fly: life, then one mana glyph per
// land (dim when tapped) and the untapped count, then hand, deck and
// creatures. It shows only when ui/hud/scorecard.js does not load. A
// dual land shows its first colour. Exported for the node test.
export function hudHTML(state, p, byId, { acting = false, over = null, names = NAMES } = {}) {
  const pl = state?.players?.[p];
  if (!pl) return '';
  const card = id => (byId && (byId.get ? byId.get(id) : byId[id])) || {};
  const lands = pl.battlefield.filter(x => card(x.id).type === 'land');
  const kind = x => (Array.isArray(card(x.id).mana) ? card(x.id).mana[0] : card(x.id).produces) || 'generic';
  const rank = k => { const i = colourIds.indexOf(k); return i < 0 ? colourIds.length : i; };
  lands.sort((a, b) => rank(kind(a)) - rank(kind(b)) || (a.tapped - b.tapped));
  const up = lands.filter(x => !x.tapped).length;
  const shown = lands.slice(0, 12);
  const glyphs = shown.map(x => `<i class="m ${x.tapped ? 'off' : 'on'}" title="${esc(card(x.id).name || 'land')}${x.tapped ? ', tapped' : ''}">${glyphOf(kind(x), 16)}</i>`).join('');
  const more = lands.length > shown.length ? `<span class="none">+${lands.length - shown.length}</span>` : '';
  const creatures = pl.battlefield.filter(x => card(x.id).type === 'creature').length;
  const tag = over ? (over.winner === p ? 'wins' : over.winner === -1 ? 'draw' : 'loses') : acting ? 'choosing' : 'waiting';
  return `<div class="top"><b class="seatmark s${p}">${p ? 'B' : 'A'}</b>${esc(names[p])}<em>${tag}</em><span class="life${pl.life <= 5 ? ' low' : ''}" title="life">${pl.life}</span></div>`
    + `<div class="mana" title="mana: untapped lands of ${lands.length}">${lands.length ? `${glyphs}${more}<span class="n">${up}/${lands.length}</span>` : '<span class="none">no lands yet</span>'}</div>`
    + `<div class="row"><span>hand <b>${pl.hand.length}</b></span><span>deck <b>${pl.library.length}</b></span><span class="cr">creatures <b>${creatures}</b></span><span>grave <b>${pl.graveyard.length}</b></span></div>`;
}

// The connectome of one fly. pretrained.json format 2 names a wiring
// file per fly (fly B on FlyWire); format 1 puts both on connectome.json.
function conOf(side) { return D.cons?.[side] || D.connectome; }

// Start the 3D scene on #heroCv. Returns the scene, or null (no module,
// no WebGL): then the 2D stand-in plays.
function start3d(mod) {
  const cv = $('heroCv');
  if (!mod?.createDuelScene || !cv) return null;
  const headless = !!window.flyDuelOpts?.headless3d;   // node test seam
  try {
    const sc = mod.createDuelScene(headless ? null : cv, { connectomes: D.connectome ? [conOf('A'), conOf('B')] : null, names: NAMES, headless });
    sc.ready?.then(info => { hero.info3d = info; }).catch(() => {});
    return sc;
  } catch (e) {
    status.scene3d = String(e && e.message || e);
    console.info('fly-duel: the 3D table did not start, the 2D table plays', e);
    return null;
  }
}

function initHero(mod3d = null) {
  const st = $('heroStatus');
  const byId = cardMap();
  hero.byId = byId;
  hero.scene = M.rules ? start3d(mod3d) : null;
  hero.mode = hero.scene ? '3d' : '2d';
  $('app').dataset.table = hero.mode;
  $('heroStage').hidden = hero.mode !== '3d';
  $('arena').hidden = hero.mode === '3d';
  if (hero.mode === '2d') { $('heroCam').hidden = true; $('heroBrains').hidden = true; document.querySelectorAll('.ctl-l').forEach(e => e.hidden = true); }
  hero.bvs = [new BrainView(conOf('A'), { side: 'A', label: 'Fly A' }), new BrainView(conOf('B'), { side: 'B', label: 'Fly B' })];
  initPanels();
  initZoom();
  if (!M.rules) { st.textContent = `The rules engine did not load (${status.rules}).`; renderBoard($('heroBoard'), null, { empty: `The rules engine did not load: ${status.rules}.` }); $('arena').hidden = false; $('heroStage').hidden = true; return; }
  const F = heroFlies();
  const agents = agentsFor('ab', F.A, F.B);
  if (!agents) { st.textContent = 'No players could load.'; return; }
  const seed0 = 1 + Math.floor(Math.random() * 1e6);
  hero.match = new Match(M.rules, agents, { seed: seed0, names: NAMES, decks: pickDecks(hero.sel, seed0, deckIdsOf()) });
  const who = F.A && F.B ? (F.trained ? 'Both flies play with their pretrained weights.' : 'Untrained flies: no pretrained weights.') : 'Stand-in bots play until the fly model loads.';
  const draw = (state, banner = null) => {
    if (hero.mode === '2d') renderBoard($('heroBoard'), state, { byId, names: NAMES, hands: 'count', hot: hotOf(hero.last?.action), last: hero.last?.text || '', lastWho: hero.last?.who, banner, turn: false });
    hud(state);
  };
  const hud = (state = hero.match.state) => {
    const over = hero.match.over();
    $('hudA').innerHTML = hudHTML(state, 0, byId, { acting: hero.focus === 0, over });
    $('hudB').innerHTML = hudHTML(state, 1, byId, { acting: hero.focus === 1, over });
    hydrate($('hudBar'));
    $('hudA').classList.toggle('acting', hero.focus === 0);
    $('hudB').classList.toggle('acting', hero.focus === 1);
    // the one turn indicator of the page: it changes in place
    const tl = turnLine(state, NAMES);
    const box = $('heroTurn');
    box.innerHTML = turnBoxHTML(tl);
    box.dataset.seat = String(tl.seat);
    hero.cards?.update(state);
    // the 2D table starts under the scorecards; with the brain panels the
    // scorecards lie over the panels, and only the turn box is over it
    if (hero.mode === '2d') { const h = $(hero.brains === 'panels' ? 'heroTurn' : 'watchHud').getBoundingClientRect?.().height; if (h > 0) $('app').style?.setProperty?.('--hud-h', `${Math.round(h + 6)}px`); }
  };
  hero.hud = hud;
  const decksLine = () => `${deckName(hero.match.decks[0])} against ${deckName(hero.match.decks[1])}.`;
  const say = () => {
    const r = hero.match.over();
    st.classList.toggle('win', !!r);
    // the status line names the set-up only; the turn box has the game
    // state (one voice), the table has the end banner
    st.textContent = `${who} ${decksLine()} Seed ${hero.match.seed}.${r ? ' A new game starts soon.' : ''}`;
  };
  const logLine = rec => {
    hero.log.unshift(rec);
    if (hero.log.length > 4) hero.log.length = 4;
    $('heroLog').innerHTML = hero.log.map(r => `<li class="p${r.who}">${esc(r.text)}${r.value != null ? ` <span class="v">V=${r.value.toFixed(2)}</span>` : ''}</li>`).join('');
    $('heroMove').innerHTML = `<b class="s${rec.who}">${NAMES[rec.who]}</b> ${esc(rec.text)}`;
  };
  // Focus on the thinker: the name in the caption of the acting brain
  // panel takes the fly colour. No words: the turn box is the one voice
  // of the game state.
  const setFocus = w => {
    hero.focus = w;
    [0, 1].forEach(p => $(p ? 'heroPaneB' : 'heroPaneA').classList.toggle('acting', p === w));
  };
  // The pause between turns: the board holds still. The turn box (the one
  // voice of the game state) has the new turn already and is marked
  // (.is-new, a static border, no motion) for the pause. No banner.
  const turnPause = rec => {
    const a = rec.before, b = rec.after;
    if (!b || b.result || hero.match.over() || a.turn === b.turn) return;
    hero.pause = turnPauseMs(hero.speed);
    $('heroTurn').classList.add('is-new');
  };
  const endPause = () => { hero.pause = 0; $('heroTurn').classList.remove('is-new'); };
  const newGame = () => {
    const seed = 1 + Math.floor(Math.random() * 1e6);
    hero.match.decks = pickDecks(hero.sel, seed, deckIdsOf());
    hero.match.reset(seed);
    hero.log = []; hero.last = null; hero.rec = null; hero.plan = null; hero.hold = 0; hero.t = 0; hero.top = [[], []];
    hero.gen++; hero.busy = false; endPause();
    $('heroLog').innerHTML = ''; $('heroMove').innerHTML = '';
    if (hero.scene) hero.scene.setState(hero.match.state);
    hero.cards?.reset();
    setFocus(hero.match.state.toAct); draw(hero.match.state); say();
    hero.onReset?.();
  };
  // The end of a record: log, board, HUD, status, the page hooks.
  const landed = rec => {
    hero.last = rec;
    const r = hero.match.over();
    if (r) {
      if (hero.match.finalDelta && !hero.panels) hero.match.finalDelta.forEach((d, p) => { if (d != null && hero.bvs[p]) hero.bvs[p].burst(d); });
      setFocus(-1);
    }
    draw(rec.after, r ? resultBanner(r) : null); say();
    turnPause(rec);
    hero.onDecision?.(rec);
  };
  // The decision reaches the scorecard of the fly: its top-3 moves and
  // the trace of the chosen board on the neural panel.
  const decided = rec => {
    hero.top[rec.who] = M.ctrl?.top3 ? M.ctrl.top3(M.rules, rec) : [];
    if (rec.trace) hero.cards?.fire(rec.who, rec.delta != null ? { ...rec.trace, delta: rec.delta } : rec.trace);
  };
  // 2D: one step of the beat plan.
  const fire = (step) => {
    const rec = hero.rec, bv = hero.bvs[rec.who], P = hero.plan;
    if (step.key === 'focus') setFocus(rec.who);
    else if (step.key === 'pn') {
      const at = k => (P.steps.find(x => x.key === k)?.at ?? 0) - step.at;
      if (bv && rec.trace) bv.setTrace(rec.trace, rec.value, { pn: 0, kc: at('kc'), mbon: at('mbon') });
    } else if (step.key === 'decide') { decided(rec); capOf(rec.who, rec.trace, rec.delta); hero.onDecide?.(rec); }
    else if (step.key === 'burst') { if (bv) bv.burst(step.delta); }
    else if (step.key === 'table') { logLine(rec); landed(rec); }
  };
  const flush = (all = false) => {
    if (!hero.plan) return;
    for (const s of hero.plan.steps) if (!s.done && (all || hero.t >= s.at)) { s.done = true; fire(s); }
  };
  const next = () => {
    try { return hero.match.next(); } catch (e) { console.error('hero step', e); st.textContent = `The match stopped: ${e.message}`; hero.setPlay?.(false); return null; }
  };
  // 2D: start the next beat: the fly decides now, the steps play over the beat.
  const begin = () => {
    const rec = next();
    if (!rec) return false;
    hero.rec = rec; hero.plan = beatPlan(rec, hero.speed, REDUCED); hero.t = 0;
    flush();
    return true;
  };
  // 3D: the fly decides now; the scene plays the record, then the next
  // one starts. The brain panel and the scorecard of the fly get the
  // decision at once (brainFire, decided).
  const begin3d = () => {
    const rec = next();
    if (!rec) return false;
    const gen = hero.gen;
    hero.rec = rec; hero.busy = true;
    setFocus(rec.who); hud(rec.before); logLine(rec);
    if (rec.trace) brainFire(rec.who, rec.trace, rec.delta);
    decided(rec); hud(rec.before);
    hero.onDecide?.(rec);
    hero.scene.play(rec).then(() => {
      if (gen !== hero.gen) return;
      hero.busy = false; landed(rec);
    }, e => { console.error('hero 3d', e); hero.busy = false; });
    return true;
  };
  // A whole record at once (reduced motion start, the 2D stand-in).
  const stepNow = () => {
    if (hero.match.over()) { newGame(); return; }
    if (hero.mode === '3d') { if (!hero.busy) { endPause(); begin3d(); } return; }
    flush(true);
    if (begin()) flush(true);
    hero.plan = null;
  };
  hero.stepNow = stepNow; hero.newGame = newGame; hero.say = say; hero.endPause = endPause;
  if (hero.scene) hero.scene.setState(hero.match.state);
  setFocus(hero.match.state.toAct); draw(hero.match.state); say();
  const onStage = () => onScreen.has($('heroCv')) || onScreen.has($('heroBrainA')) || onScreen.has($('heroBoard'));
  tickers.push(dt => {
    // play mode drives the scene itself (ui/play/play.js); this loop
    // only draws it
    if (app.mode === 'play') { if (!app.covered()) { if (app.playScene) hero.scene.render(dt); hero.panels?.update(dt); } return; }
    if (hero.suspended) return;
    if (hero.mode === '3d') {
      if (app.covered()) return;
      hero.panels?.update(dt);
      if (!onScreen.has($('heroCv'))) return;
      // paused: still draw for a moment after a drag or a control change
      if (hero.playing || hero.poke > 0) hero.scene.render(hero.playing ? dt : 0);
      hero.poke = Math.max(0, hero.poke - dt);
      if (!hero.playing || hero.busy) return;
      if (hero.pause > 0) { hero.pause -= dt * 1000; if (hero.pause <= 0) endPause(); return; }
      if (hero.match.over()) {
        hero.t += dt * 1000;
        if (hero.t >= motionFor(REDUCED).endHold + 1500) newGame();
        return;
      }
      hero.t = 0;
      begin3d();
      return;
    }
    if (!hero.playing || !onStage() || app.covered()) return;
    hero.t += dt * 1000;
    if (hero.plan) {
      flush();
      if (hero.t < hero.plan.beat) return;
      hero.plan = null;
      if (hero.match.over()) { hero.hold = motionFor(REDUCED).endHold; hero.t = 0; return; }
    }
    if (hero.pause > 0) { hero.pause -= dt * 1000; if (hero.pause <= 0) { endPause(); hero.t = 0; } return; }
    if (hero.hold > 0) { if (hero.t < hero.hold) return; newGame(); return; }
    begin();
  });
  io.observe($('heroBoard')); io.observe($('heroCv'));
  const play = $('heroPlay');
  const setPlay = on => { hero.playing = on; play.textContent = on ? 'Pause' : 'Play'; play.setAttribute('aria-pressed', String(on)); hero.poke = 0.5; };
  hero.setPlay = setPlay;
  setPlay(hero.playing);
  play.addEventListener('click', () => setPlay(!hero.playing));
  seg($('heroSpeed'), v => { hero.speed = +v; hero.scene?.setSpeed(+v); });
  $('heroNew').addEventListener('click', () => { newGame(); hero.poke = 1; });
  seg($('heroCam'), v => { hero.cam = v; hero.scene?.setCamera?.(v); hero.poke = 2; });
  seg($('heroBrains'), v => setBrains(v));
  const cv = $('heroCv');
  for (const t of ['pointerdown', 'pointermove', 'wheel']) cv.addEventListener(t, () => { hero.poke = 1.5; }, { passive: true });
  addEventListener('resize', () => { hero.scene?.resize(); hero.panels?.resize(); syncClear(); hero.poke = 0.5; });
  setBrains(hero.brains);
  hero.syncClear = syncClear;
  if (REDUCED) stepNow();
}

// Watch mode: the two scorecards of ui/hud/scorecard.js in #scA (Fly A,
// over brain A) and #scB (Fly B, over brain B). They are slim strips (the
// user: "the fly a vs fly b cards should be much less visually
// obstrusive"). They have no neural canvas: the brain of each fly is its
// side panel (initPanels). A tap on "moves" opens the top-3 and V, δ.
// Without the scorecard module, the fallback strip #hudBar shows.
function initScorecards() {
  const S = M.hud, CARD = M.cards?.CARD;
  if (!S?.createScorecard || !S.scorecardModel || !CARD || !hero.match) { $('hudBar').hidden = false; return; }
  const compact = () => (window.innerWidth || 390) < 760;
  const src = side => (D.pretrained?.wiring?.[side]?.release || (side === 'A' ? 'hemibrain v1.2' : 'FlyWire 783')).split(/[;(]/)[0].trim();
  const F = heroFlies();
  let cards = [];
  const make = () => {
    cards.forEach(c => c?.dispose());
    cards = [0, 1].map(seat => {
      const host = $(seat ? 'scB' : 'scA');
      host.innerHTML = '';
      const side = seat ? 'B' : 'A';
      const isFly = !!F[side];
      try {
        // slim: a low corner strip, the neural panel behind its brain button
        // brain: false: the brain of the fly is in its side panel
        // quiet: no "Turn", "Waiting", "Thinking" on the card (one voice)
        const c = S.createScorecard(host, { seat, side: seat ? 'right' : 'left', kind: isFly ? 'fly' : 'bot', connectome: isFly ? conOf(side) : null, brain: false, quiet: true, compact: compact(), slim: true });
        c.setCompact(compact());
        return c;
      } catch (e) { console.info('fly-duel: scorecard', e); return null; }
    });
  };
  make();
  if (!cards[0] || !cards[1]) { $('hudBar').hidden = false; return; }
  $('hudBar').hidden = true;
  let wasCompact = compact();
  addEventListener('resize', () => {
    const c = compact();
    cards.forEach(x => { x?.setCompact(c); x?.resize(); });
    if (c !== wasCompact) { wasCompact = c; cards.forEach((x, seat) => x && update(hero.match.state, seat)); }
  });
  const update = (state, only = -1) => {
    for (let seat = 0; seat < 2; seat++) {
      if (only >= 0 && seat !== only) continue;
      const side = seat ? 'B' : 'A';
      const m = S.scorecardModel({
        state, seat, CARD, kind: F[side] ? 'fly' : 'bot', name: NAMES[seat], letter: side,
        source: src(side), deckName: deckName(hero.match.decks[seat]), top: hero.top[seat],
        thinking: hero.busy && hero.focus === seat, colours: M.cards.COLOURS,
      });
      // the deck of the fly goes under its name, with the wiring
      m.source = `${m.source} · ${deckName(hero.match.decks[seat])}`;
      cards[seat]?.update(m);
    }
  };
  hero.cards = {
    update: s => update(s),
    fire: (seat, trace) => cards[seat]?.fire(trace),
    // a new game keeps the cards (and their WebGL brain panels)
    reset: () => update(hero.match.state),
  };
  update(hero.match.state);
}

// The two brain panels (#heroPaneA, #heroPaneB): the main feature of the
// layout (CONTRACT.md), transparent overlays on the table. With the 3D table, ui/fly3d/brainpanels.js draws
// both maps with ONE shared WebGL renderer into the two 2D panel
// canvases, so the page has two WebGL contexts in all (the table and the
// panels). Without it (no WebGL, node, an error), the 2D BrainView of
// ui/brain.js draws the same canvases. The neuropil shell loads for a
// hemibrain-frame file only (Fly A); FlyWire has no matching meshes.
function initPanels() {
  for (const side of ['A', 'B']) {
    const el = document.querySelector(`[data-src="${side}"]`);
    if (el) el.textContent = srcOf(side);
  }
  const PM = app.panelMod;
  if (hero.mode === '3d' && PM?.createBrainPanels) {
    const headless = !!window.flyDuelOpts?.headless3d;
    try {
      hero.panels = PM.createBrainPanels([$('heroBrainA'), $('heroBrainB')], [conOf('A'), conOf('B')], { lite: COARSE, reducedMotion: REDUCED, headless });
    } catch (e) { hero.panels = null; console.info('fly-duel: the brain panels did not start, the 2D brains draw', e); }
    if (hero.panels && !headless && PM.loadNeuropil) {
      const base = new URL('./data/', import.meta.url);
      [0, 1].forEach(p => PM.loadNeuropil(conOf(p ? 'B' : 'A'), base).then(np => { if (np) hero.panels?.setNeuropil(p, np); }).catch(() => {}));
    }
  }
  if (!hero.panels) { brainCanvas($('heroBrainA'), hero.bvs[0]); brainCanvas($('heroBrainB'), hero.bvs[1]); }
}

// The card zoom of the watch table (ui/cardzoom.js): a right-click on a
// card of the 3D table (hand, table, the card being cast, graveyard)
// shows it large over the screen until the next right-click or Escape.
// A long press opens it on a touch screen. Play mode has its own
// inspector (ui/play/inspector.js), so the zoom input is off there.
function initZoom() {
  const sc = hero.scene, CARD = M.cards?.CARD;
  if (hero.mode !== '3d' || !sc?.pickFace || !CARD) return;
  try {
    hero.zoom = createCardZoom($('app'), { CARD, CF: { drawCard, paintWithArt }, view: () => [window.innerWidth || 390, window.innerHeight || 844] });
    hero.zoomIn = attachCardZoom($('heroCv'), hero.zoom, {
      pick: (x, y) => sc.pickFace(x, y),
      active: () => app.mode === 'watch' && !app.sheet && !app.how,
      doc: document,
    });
    addEventListener('resize', () => hero.zoom?.resize());
  } catch (e) { hero.zoom = null; console.info('fly-duel: card zoom', e); }
}

// One decision of the fly on seat p reaches the brain panel of that fly
// (Fly A = 0, Fly B = 1) and its caption.
function brainFire(p, trace, delta) {
  if (!trace) return;
  if (hero.panels) hero.panels.fire(p, trace, delta);
  else if (hero.bvs[p]) { hero.bvs[p].setTrace(trace, trace.value); if (Number.isFinite(delta)) hero.bvs[p].burst(delta); }
  capOf(p, trace, delta);
}

// The caption of a brain panel: the active KCs of the chosen board, the
// value V of that board and the TD error δ (the dopamine signal).
const signed = v => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}` : '');
function capOf(p, trace, delta) {
  const el = $(p ? 'heroCapB' : 'heroCapA')?.querySelector('.bp-kc');
  if (!el || !trace) return;
  const nKC = conOf(p ? 'B' : 'A')?.kc?.n;
  const d = Number.isFinite(delta) ? delta : trace.delta;
  el.textContent = `${(trace.kc || []).length}${nKC ? ` of ${nKC.toLocaleString('en-US')}` : ''} KCs active${Number.isFinite(trace.value) ? ` · V ${signed(trace.value)}` : ''}${Number.isFinite(d) ? ` · δ ${signed(d)}` : ''}`;
}

// The clear region of the table (ui/fly3d/scene.js setClear). The brain
// overlays are transparent and lie over the table canvas, so the camera
// frames the board in the region between them: the insets are how far
// each shown overlay reaches into the canvas (clearInsets of
// brainpanels.js). A wide screen keeps the wide framing (frame 'wide');
// a tall screen and play mode take the framing from the clear aspect.
const wideScreen = () => {
  try { if (typeof matchMedia === 'function') return matchMedia('(min-aspect-ratio: 11/10) and (min-width: 700px)').matches; } catch { /* no media queries */ }
  const w = window.innerWidth || 390, h = window.innerHeight || 844;
  return w / h >= 1.1 && w >= 700;
};
function shownPanes() {
  if (hero.brains !== 'panels' || hero.mode !== '3d') return [];
  if (app.mode === 'play') { const o = $('app').dataset.opp; return o === 'A' || o === 'B' ? [$(`heroPane${o}`)] : []; }
  return [$('heroPaneA'), $('heroPaneB')];
}
function syncClear() {
  const sc = hero.scene, PM = app.panelMod;
  if (!sc?.setClear) return null;
  const cv = app.mode === 'play' && app.playScene ? (app.cv || $('heroCv')) : $('heroCv');
  const box = el => (el?.getBoundingClientRect ? el.getBoundingClientRect() : null);
  const wide = wideScreen();
  const ins = PM?.clearInsets ? PM.clearInsets(box(cv), shownPanes().map(box), wide) : { l: 0, r: 0, t: 0, b: 0 };
  return sc.setClear({ ...ins, frame: wide && app.mode === 'watch' ? 'wide' : null });
}

// The brain control: panels (the default: a large live brain on each
// side), scene (the small maps beside the flies in the hall) or off. A
// brain shows in one place only: the panels turn the maps of the scene
// off, the big map of play mode too.
function setBrains(v) {
  hero.brains = v === 'scene' || v === 'off' ? v : 'panels';
  $('app').dataset.brains = hero.brains;
  hero.scene?.setBrains?.(hero.brains === 'scene');
  hero.scene?.setBigBrain?.(hero.brains === 'scene');
  $('heroBrains')?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === hero.brains));
  hero.scene?.resize?.();
  hero.panels?.resize();
  syncClear();
  views.forEach(x => { x.dirty = true; });
  hero.poke = 1;
}

// ---------------------------------------------------------------- modes
// The mode of the page and the choices of the chooser. covered() is true
// while the drawer hides the whole table (a phone): the watch table then
// does not draw and its match waits.
const app = {
  mode: 'watch', sheet: false, how: false, play: null, playScene: false, cv: null,
  myDeck: null, opp: 'B', flyDeck: 'random', panelMod: null, chooser: null,
  covered() { return this.how && (window.innerWidth || 390) < 860; },
};
const srcOf = side => (D.pretrained?.wiring?.[side]?.release || (side === 'A' ? 'hemibrain v1.2' : 'FlyWire 783')).split(/[;(]/)[0].trim();

// Choose an option of a select by its value. It marks the option
// selected (property and attribute), which also works where select.value
// has no setter (linkedom in the node tests).
function setSelect(sel, v) {
  const opts = [...(sel?.querySelectorAll?.('option') || [])];
  for (const o of opts) { o.selected = false; o.removeAttribute('selected'); }
  const t = opts.find(o => o.value === v);
  if (t) { t.setAttribute('selected', 'selected'); t.selected = true; }
}

function syncURL() {
  try {
    const q = queryOf(app.mode === 'play' ? { mode: 'play', myDeck: app.myDeck, opp: app.opp, flyDeck: app.flyDeck } : { mode: 'watch', decks: hero.sel });
    history.replaceState(null, '', q + (location.hash || ''));
  } catch { /* no history (node, a sandboxed frame) */ }
}

function initModes() {
  const ids = deckIdsOf();
  let search = '';
  try { search = location.search; } catch { search = ''; }
  const q = parseQuery(search, ids);
  hero.sel = q.decks.slice();
  app.myDeck = q.myDeck || ids[0] || null; app.opp = q.opp; app.flyDeck = q.flyDeck;
  const F = heroFlies();
  if (!(F.A && F.B)) app.opp = 'bot';
  // the title screen (ui/chooser/chooser.js); the URL wins over the
  // choice that the chooser keeps in localStorage
  const initial = q.mode === 'play' ? { mode: 'play', humanDeck: q.myDeck, opponent: app.opp, flyDeck: q.flyDeck }
    : q.mode === 'watch' ? { mode: 'watch', deckA: q.decks[0], deckB: q.decks[1] } : {};
  app.chooser = mountChooser($('chooser'), {
    decks: M.cards?.DECKS || {}, deckOrder: ids, colours: M.cards?.COLOURS || {}, cards: M.cards?.CARD || {},
    curve: D.curve, initial, flies: { A: !!F.A, B: !!F.B },
    onStart: c => startChoice(c),
    onHow: () => { closeChooser(); app.openHow?.(); },
    onClose: () => closeChooser(),
  });
  $('btnDecks').addEventListener('click', () => openChooser('watch'));
  $('btnPlay').addEventListener('click', () => openChooser('play'));
  if (q.mode === 'play') enterPlay();
  else if (q.mode === 'watch') syncURL();
  else openChooser();
}

// The title screen. pick: 'watch' or 'play' opens it on the decks of
// that mode with a Close button; no pick opens it on the mode cards.
function openChooser(pick) {
  app.sheet = true; $('app').dataset.sheet = 'on';
  app.chooser?.open({ mode: pick, closable: !!pick });
}
function closeChooser() {
  app.sheet = false;
  app.chooser?.close();
  delete $('app').dataset.sheet;
  if (app.mode === 'watch') syncURL();
}

// A start of the title screen. c: normalise() of ui/chooser/chooser.js.
function startChoice(c) {
  if (c.mode === 'play') {
    app.myDeck = c.humanDeck; app.opp = c.opponent; app.flyDeck = c.flyDeck;
    if (app.play) exitPlay(false);
    enterPlay();
    return;
  }
  hero.sel = [c.deckA, c.deckB];
  closeChooser();
  if (app.mode === 'play') exitPlay(false);
  hero.newGame?.();
  hero.setPlay?.(true);
  syncURL();
}

// Watch -> play. ui/play/play.js loads on first use. The 3D canvas moves
// into the play table when the scene can pick cards (pickPermanent);
// else play mode draws its flat table and the 3D table waits. The
// choices of the chooser go into the setup sheet of play.js, and its
// Start button is pressed, so the coin call comes next. When a control
// of that sheet is not there, the sheet stays open for the player.
async function enterPlay() {
  closeChooser();
  hero.zoom?.close();
  app.mode = 'play'; $('app').dataset.mode = 'play';
  hero.suspended = true; hero.gen++; hero.busy = false; hero.endPause?.();
  syncURL();
  let P = null;
  try { P = await import('./ui/play/play.js'); } catch (e) { console.info('fly-duel: ui/play/play.js', e); }
  if (!P?.mountPlay || !M.rules || !M.cards || !M.bots) {
    app.mode = 'watch'; $('app').dataset.mode = 'watch'; hero.suspended = false;
    $('heroStatus').textContent = `Play mode did not load (${!P ? 'ui/play/play.js' : 'the rules'}). The flies play each other.`;
    syncURL();
    return;
  }
  const F = heroFlies();
  const cv = $('heroCv');
  const sceneOK = hero.mode === '3d' && typeof hero.scene?.pickPermanent === 'function';
  app.cv = cv; app.playScene = sceneOK;
  $('playRoot').hidden = false;
  try {
    app.play = P.mountPlay($('playRoot'), {
      rules: M.rules, cards: M.cards, bots: M.bots,
      flies: { A: F.A, B: F.B }, connectomes: { A: conOf('A'), B: conOf('B') }, sources: { A: srcOf('A'), B: srcOf('B') },
      // the brain of the fly is in its side panel, not in its scorecard
      brainMod: null, cardBrain: false, scene: sceneOK ? hero.scene : null, sceneEl: sceneOK ? cv : null,
      trainedDecks: trainedDecks(), onExit: () => exitPlay(),
      onGame: g => { $('app').dataset.opp = g.opp; hero.panels?.resize(); syncClear(); },
      onFlyTrace: (side, trace, delta) => brainFire(side === 'A' ? 0 : 1, trace, delta),
    });
  } catch (e) {
    console.error('fly-duel: mountPlay', e);
    exitPlay();
    return;
  }
  if (sceneOK) { hero.scene.resize(); syncClear(); }
  presetPlay($('playRoot'));
}

function presetPlay(root) {
  const q = sel => root.querySelector(sel);
  const press = el => { el?.dispatchEvent(new Event('click', { bubbles: true })); return !!el; };
  const mine = app.myDeck === 'random' || !app.myDeck ? pickDecks(['random', 'random'], Date.now() >>> 0, deckIdsOf())[0] : app.myDeck;
  const okOpp = press(q(`.pl-seg[data-k="opp"] button[data-v="${app.opp}"]`));
  const okDeck = press(q(`.pl-deck[data-deck="${mine}"]`));
  const sel = q('select[data-k="flyDeck"]');
  if (sel) { setSelect(sel, app.flyDeck); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  if (okOpp && okDeck && sel) press(q('.pl-go'));
}

// Play -> watch. play.js destroy() empties #playRoot, so the canvas is
// held first and goes back to the stage. setFirstPerson(null) gives the
// camera mode of before. A new watch game starts.
function exitPlay(restart = true) {
  const cv = app.cv || $('heroCv');
  try { app.play?.destroy(); } catch (e) { console.info('fly-duel: play destroy', e); }
  app.play = null;
  $('playRoot').hidden = true;
  const stage = $('heroStage');
  if (cv && cv.parentNode !== stage) stage.insertBefore(cv, stage.firstChild);
  if (app.playScene) {
    try { hero.scene.highlight?.(null); hero.scene.setFirstPerson?.(null); hero.scene.resize(); } catch (e) { console.info('fly-duel: scene after play', e); }
  }
  app.playScene = false;
  app.mode = 'watch'; $('app').dataset.mode = 'watch'; delete $('app').dataset.opp;
  hero.scene?.resize?.(); hero.panels?.resize(); syncClear();
  hero.suspended = false;
  if (restart) { hero.newGame?.(); syncURL(); }
}

// The "How it works" drawer, and the keys of the watch table.
function initHow() {
  const how = $('how');
  const open = () => { app.how = true; how.hidden = false; $('app').dataset.how = 'on'; $('howClose').focus?.(); };
  const close = () => { app.how = false; how.hidden = true; delete $('app').dataset.how; hero.poke = 1; };
  app.openHow = open; app.closeHow = close;
  $('btnHow').addEventListener('click', open);
  $('howClose').addEventListener('click', close);
  // a link to a section or a source opens the drawer
  let hash = '';
  try { hash = location.hash; } catch { hash = ''; }
  if (/^#(s\d|refs|ref-|how)/.test(hash)) open();
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || '')) return;
    if (e.key === 'Escape') {
      if (app.how) { close(); return; }
      return;
    }
    if (app.mode !== 'watch' || app.how || app.sheet) return;
    if (e.key === ' ' && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); hero.setPlay?.(!hero.playing); }
    else if (e.key === 'n' || e.key === 'N') hero.newGame?.();
  });
}

// Held-out numbers of the shipped flies (tools/train.mjs meta.final), or null.
function finalOf() { return D.curve?.meta?.final || D.pretrained?.meta?.final || null; }

function initHeroStats() {
  const items = [];
  const n = (C, k) => C?.[k]?.n ?? C?.[k]?.pos?.length;
  const two = k => `${n(conOf('A'), k)} / ${n(conOf('B'), k)}`;
  if (conOf('A') && conOf('B')) {
    const sameFile = conOf('A') === conOf('B');
    items.push([two('kc'), sameFile ? 'Kenyon cells in Fly A / Fly B, one per traced KC (both on one file: the second wiring file did not load)' : 'Kenyon cells in Fly A (hemibrain) / Fly B (FlyWire), one per traced KC: two animals']);
    items.push([two('pn'), 'projection neurons carry the board "smell" in']);
    items.push([two('mbon'), 'output neurons (MBONs) read the KCs out']);
    items.push([two('dan'), 'dopamine neurons (DANs) gate the learning']);
  }
  const fin = finalOf();
  if (fin?.vsRandom?.A?.rate != null) items.push([pct(fin.vsRandom.A.rate), `of ${fin.vsRandom.A.n} held-out games Fly A won against a random player (measured)`]);
  else if (fin == null && D.curve) {
    const rows = curveRows(D.curve), last = rows.length ? rows[rows.length - 1] : null;
    if (last?.vsRandom?.A != null) items.push([pct(last.vsRandom.A), 'win rate of Fly A against a random player at the last checkpoint (measured)']);
  }
  $('heroStats').innerHTML = items.map(([v, t]) => `<div><b>${esc(v)}</b><span>${esc(t)}</span></div>`).join('');
}

// Text that depends on real or sampled wiring.
function initWiring() {
  const C = D.connectome;
  if (!C) return;
  if (C.meta?.synthetic || conOf('B')?.meta?.synthetic) {
    document.querySelectorAll('[data-wiring]').forEach(el => el.textContent = 'wired from patterns sampled from published statistics (not the traced connectome)');
    const t = $('wiringTag'); t.textContent = 'sampled from published statistics'; t.className = 'tag synth';
  }
}

// ---------------------------------------------------------------- 01
function initGame() {
  // mana glyphs of every colour of the pool (COLOUR_IDS), then generic
  const named = colourIds.map(k => `${glyphOf(k, 16)} ${esc(colourInfo(k).name)}`).join(' ');
  $('manaKey').innerHTML = `${colourIds.map(k => `${glyphOf(k, 16)} ${esc(colourInfo(k).name.toLowerCase())} mana`).join(' ')} ${glyphOf('generic', 16, 2)} any two mana`;
  $('manaLegGlyphs').innerHTML = `${named} ${glyphOf('generic', 16, 1)} generic.`;
  hydrate($('manaKey')); hydrate($('manaLeg'));
  $('kwList').innerHTML = Object.entries(KEYWORD_TEXT).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v[1])}</li>`).join('');
  if (!M.cards) { $('deckLists').innerHTML = `<p class="none">The card pool did not load (${esc(status.cards)}).</p>`; return; }
  const cards = M.cards.CARDS || [];
  const ids = deckIdsOf();
  const mono = ids.filter(id => (M.cards.DECKS[id].colours || []).length === 1).length;
  $('deckTag').textContent = `${ids.length} decks: ${mono} of one colour, ${ids.length - mono} mixed`;
  if (M.cards.DECKS) renderDecks($('deckLists'), [...cards, ...(M.cards.TOKENS || [])], M.cards.DECKS, { order: ids });
  initGallery(cards);
}

// 01 gallery: every card as the canvas card of the table (ui/cardview.js),
// with the filter bar of ui/board.js in place of the old #galSeg buttons.
// A tap opens the card in the inspector.
function initGallery(cards) {
  let filter = { ...GALLERY_ALL };
  const bar = renderGalleryControls($('galSeg'), cards, filter, f => { filter = f; draw(); });
  const draw = () => bar.set(renderGallery($('gallery'), cards, filter));
  draw();
}

// ---------------------------------------------------------------- 02
function initCentre() {
  const C = D.connectome;
  const bv = new BrainView(C, { side: 'A', label: 'Fly A, live' });
  bv.spin = 0.18;
  brainCanvas($('mbCv'), bv);
  centreView = bv;
  if (!C) { $('cxMeta').textContent = `data/connectome.json did not load (${status.connectome}).`; return; }
  const count = (arr) => { const m = new Map(); for (const t of arr || []) m.set(t, (m.get(t) || 0) + 1); return m; };
  const kcT = count(C.kc?.types), danC = count(C.dan?.cluster);
  const val = count((C.mbon?.valence || []).map(v => v > 0 ? 'approach' : v < 0 ? 'avoid' : 'neutral'));
  const sw = c => `<i style="background:${c};width:9px;height:9px"></i>`;
  $('mbLegend').innerHTML = [
    `<span>${sw(TOKENS.pn)}PN ${C.pn?.n}</span>`,
    ...[...kcT].map(([t, n]) => `<span>${sw(/g/.test(t) && !/a/.test(t) ? KC_TYPE.g : /'/.test(t) ? KC_TYPE.apbp : KC_TYPE.ab)}${esc(t)} ${n}</span>`),
    `<span>${sw(TOKENS.app)}MBON approach ${val.get('approach') || 0}</span>`,
    `<span>${sw(TOKENS.avoid)}MBON avoid ${val.get('avoid') || 0}</span>`,
    ...[...danC].map(([t, n]) => `<span>${sw(/PAM/.test(t) ? TOKENS.app : /PPL1/.test(t) ? TOKENS.avoid : TOKENS.dim)}DAN ${esc(t)} ${n}</span>`),
  ].join('');
  const m = C.meta || {};
  const e = C.edges || {};
  $('cxMeta').innerHTML = `<b>Fly A.</b> ${m.synthetic ? '<b>Wiring sampled from published statistics</b>, not traced. ' : ''}${esc(m.release || m.source || '')}${m.licence ? `, licence ${esc(m.licence)}` : ''}${m.retrieved ? `, retrieved ${esc(m.retrieved)}` : ''}. `
    + `${(e.pn_kc || []).length.toLocaleString('en-US')} PN→KC and ${(e.kc_mbon || []).length.toLocaleString('en-US')} KC→MBON connections. Positions are cable centroids in micrometres; neurons far from the Kenyon cells are drawn pulled in toward them, so the edges are not to scale. Drag to turn. ${esc(M.facts?.HONESTY?.valenceModel || 'MBON valence is a model rule from the dopamine cluster of each compartment.')} The lit KCs mirror Fly A in the hero match.`;
}
let centreView = null;

// A FACTS value as text: 0.05..0.10 fractions as "5-10%", big numbers
// with commas, null as "".
export function fmtFact(f) {
  if (!f || f.value == null) return '';
  const frac = /fraction/.test(f.unit || '');
  const one = v => frac ? `${+(v * 100).toFixed(1)}%` : typeof v === 'number' ? v.toLocaleString('en-US') : String(v);
  if (Array.isArray(f.value)) return frac ? `${f.value.map(v => +(v * 100).toFixed(1)).join('–')}%` : f.value.map(one).join('–');
  return one(f.value);
}

function citeLinks(ids) {
  const S = M.facts?.SOURCES;
  if (!S) return '';
  const keys = Object.keys(S);
  return ids.filter(id => S[id]).map(id => `<a href="#ref-${esc(id)}">[${keys.indexOf(id) + 1}]</a>`).join('');
}

// measured true: counts from the two shipped files (hemibrain `measured`,
// FlyWire `flywire`). false: numbers from the literature.
function factsHTML(measured) {
  const F = M.facts?.FACTS;
  if (!F) return measured ? '' : `<li class="none">data/facts.js did not load (${esc(status.facts)}).</li>`;
  return Object.entries(F).filter(([, f]) => !!(f.measured || f.flywire) === measured).map(([id, f]) => {
    const v = fmtFact(f);
    const unit = /fraction/.test(f.unit || '') ? '' : f.unit;
    return `<li><b>${v ? esc(v) : '·'}${v && unit ? ` <small>${esc(unit)}</small>` : ''}</b><span>${esc(f.text || id)} ${citeLinks([f.src, ...(f.also || [])])}</span></li>`;
  }).join('');
}

// [data-fact] and [data-cite] spans in the prose. A missing id keeps the
// words that the markup has.
function initFacts() {
  const mix = M.trainer?.TRAIN_MIX, ex = M.trainer?.TRAIN_EXPLORE;
  document.querySelectorAll('[data-mix]').forEach(el => {
    const k = el.dataset.mix;
    if (k === 'explore' && Number.isFinite(ex)) el.textContent = String(ex);
    else if (mix && Number.isFinite(mix[k])) el.textContent = `${Math.round(mix[k] * 100)}%`;
  });
  const F = M.facts?.FACTS;
  if (!F) return;
  document.querySelectorAll('[data-fact]').forEach(el => { const f = F[el.dataset.fact]; const v = fmtFact(f); if (v) el.textContent = v; });
  document.querySelectorAll('[data-cite]').forEach(el => { el.innerHTML = citeLinks(el.dataset.cite.split(/\s+/)); });
}

// Section 02: the Fly A / Fly B table. Each cell is one or more FACTS
// ids of data/facts.js COMPARE. The last column is Fly B / Fly A for the
// rows with one id per cell.
export function compareHTML(facts) {
  const F = facts?.FACTS, rows = facts?.COMPARE;
  if (!F || !rows) return '';
  const cell = ids => ids.map(id => fmtFact(F[id])).join(' / ');
  const ratio = (a, b) => a.length === 1 && F[a[0]]?.value ? (F[b[0]].value / F[a[0]].value).toFixed(2) : '';
  return '<thead><tr><th>right mushroom body, same thresholds</th><th class="n">Fly A · hemibrain v1.2</th><th class="n">Fly B · FlyWire 783</th><th class="n">B / A</th></tr></thead><tbody>'
    + rows.map(([label, a, b]) => `<tr><th>${esc(label)} ${citeLinks([...new Set([...a, ...b].map(id => F[id].src))])}</th><td class="n">${esc(cell(a))}</td><td class="n">${esc(cell(b))}</td><td class="n">${ratio(a, b)}</td></tr>`).join('')
    + '</tbody>';
}

function initCompare() {
  const t = compareHTML(M.facts);
  $('flyCompare').innerHTML = t || `<tbody><tr><td class="none">data/facts.js did not load (${esc(status.facts)}).</td></tr></tbody>`;
}

// [data-kc] spans: the KC code that the loaded flies use (brain/mb.js
// sparsity, k, live KCs, kcCode). With no model, the markup words stay.
export function kcCodeText(mbA, mbB) {
  if (!mbA) return null;
  const one = (mb, who) => `${who}: ${mb.k} of ${mb.nLive} KCs with PN input`;
  return {
    share: `${+(100 * mbA.sparsity).toFixed(1)}%`,
    count: [one(mbA, 'Fly A'), mbB ? one(mbB, 'Fly B') : null].filter(Boolean).join('; '),
    code: mbA.graded ? 'Each winner gets a graded rate: how far its drive is above the best KC that did not win, which stands for the APL level.' : 'Each winner has the same rate (a binary code).',
  };
}

function initKcCode() {
  const F = heroFlies();
  const t = kcCodeText(mbOf(F.A), mbOf(F.B));
  if (!t) return;
  document.querySelectorAll('[data-kc]').forEach(el => { const v = t[el.dataset.kc]; if (v) el.textContent = v; });
}

// ---------------------------------------------------------------- 03
function fromSide(st, me = 0) { try { return M.features.features(st, me); } catch { return null; } }
function mbOf(fly) { return fly?.mb || null; }

function initSmell() {
  const sel = $('featPick'), inp = $('featIn'), out = $('featOut'), bars = $('featBars');
  const spec = M.features?.FEATURE_SPEC || (M.features?.FEATURE_NAMES || []).map(n => [n, 1, n]);
  if (!M.features || !M.rules) { bars.innerHTML = `<li class="none">game/features.js did not load.</li>`; }
  sel.innerHTML = spec.map((r, i) => `<option value="${i}">${esc(r[2] || r[0])}</option>`).join('');
  let base = null, cur = null, fi = 0, rates = null, baseRates = null;
  const cv = $('glomCv');
  const v = view(cv, () => { const { g, w, h } = fit(cv); drawGlomeruli(g, w, h, rates, null); });
  const mb = () => mbOf(heroFlies().A);
  const recompute = () => {
    const m = mb();
    if (!cur || !m) { $('smellRead').textContent = m ? 'Waiting for a board.' : 'The brain model is not loaded yet.'; v.dirty = true; return; }
    rates = Float32Array.from(m.encode(cur));
    if (!baseRates) baseRates = Float32Array.from(m.encode(base));
    const on = rates.filter(x => x > 0.5).length;
    $('smellRead').textContent = `${rates.length} PN channels; ${on} above half rate. Cosine similarity to the unchanged board: ${cosine(rates, baseRates).toFixed(3)}.`;
    bars.innerHTML = spec.map((r, i) => `<li data-i="${i}" class="${i === fi ? 'on' : ''}"><span title="${esc(r[2])}">${esc(r[0])}</span><i style="--v:${(100 * cur[i]).toFixed(0)}%"></i></li>`).join('');
    v.dirty = true;
  };
  const setBase = st => {
    const f = st && fromSide(st, 0);
    if (!f) return;
    base = Float32Array.from(f); cur = Float32Array.from(f); baseRates = null;
    inp.value = cur[fi]; out.textContent = (+inp.value).toFixed(2);
    recompute();
  };
  sel.addEventListener('change', () => { fi = +sel.value; if (cur) { inp.value = cur[fi]; out.textContent = (+inp.value).toFixed(2); } recompute(); });
  inp.addEventListener('input', () => { if (!cur) return; cur[fi] = +inp.value; out.textContent = (+inp.value).toFixed(2); recompute(); });
  bars.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (!li) return; fi = +li.dataset.i; sel.value = fi; if (cur) { inp.value = cur[fi]; out.textContent = cur[fi].toFixed(2); } recompute(); });
  $('smellGrab').addEventListener('click', () => setBase(hero.match?.state));
  if (M.rules && M.features) {
    try { setBase(hero.match?.state || M.rules.newGame({ seed: 3 })); } catch (e) { console.warn(e); }
  }
  // take the first real mid-game board from the hero once
  let took = false;
  const prev = hero.onDecision;
  hero.onDecision = rec => { prev?.(rec); if (!took && (rec.after?.turn ?? 0) >= 6) { took = true; setBase(rec.after); } };
}

// ---------------------------------------------------------------- 04
function initSparse() {
  const cv = $('sparseCv'), inp = $('spIn'), out = $('spOut');
  let a = null, b = null, n = D.connectome?.kc?.n || 0, pair = null, mbCache = new Map();
  const v = view(cv, () => { const { g, w, h } = fit(cv); drawSparse(g, w, h, n, a, b); });
  const mbFor = sp => {
    const base = mbOf(heroFlies().A);
    if (!base) return null;
    if (Math.abs(sp - base.sparsity) < 1e-6) return base;
    if (!mbCache.has(sp)) {
      try {
        const MB = M.fly.MushroomBody;
        const cal = base.opts?.calibration;
        mbCache.set(sp, new MB(D.connectome, { ...base.opts, sparsity: sp, calibration: cal }));
      } catch (e) { console.warn(e); return base; }
    }
    return mbCache.get(sp);
  };
  // Two afterstates of one decision: two boards that differ by one move.
  // With no hero history (a new hero game), the greedy bot plays a
  // scripted game to a decision with 3 or more options. The last move
  // of each turn always gave 1 or 2 options, so that script found none.
  const pickPair = () => {
    const hist = hero.match?.history || [];
    const cands = hist.filter(r => r.legal?.length >= 2);
    if (!cands.length && M.rules) {
      try {
        const bot = M.bots?.greedyBot ? M.bots.greedyBot() : (st, l) => l[l.length - 1];
        let s = M.rules.newGame({ seed: 11 + Math.floor(Math.random() * 1000), names: NAMES });
        for (let i = 0; i < 80 && !M.rules.isOver(s); i++) { const l = M.rules.legalActions(s); if (l.length >= 3 && i > 8) return { s, l, me: s.toAct }; s = M.rules.step(s, bot(s, l)); }
      } catch { return null; }
      return null;
    }
    const r = cands[Math.floor(Math.random() * cands.length)];
    return { s: r.before, l: r.legal, me: r.who };
  };
  const compute = () => {
    const sp = +inp.value; out.textContent = `${Math.round(sp * 100)}%`;
    const mb = mbFor(sp);
    if (!mb || !pair) { $('spRead').innerHTML = `<div>${mb ? 'Waiting for a board.' : 'The brain model is not loaded yet.'}</div>`; v.dirty = true; return; }
    const i = Math.floor(Math.random() * pair.l.length);
    let j = Math.floor(Math.random() * (pair.l.length - 1)); if (j >= i) j++;
    const fa = fromSide(M.rules.step(pair.s, pair.l[i]), pair.me), fb = fromSide(M.rules.step(pair.s, pair.l[j]), pair.me);
    if (!fa || !fb) return;
    const ea = mb.evaluate(fa), eb = mb.evaluate(fb);
    a = ea.kc; b = eb.kc; n = mb.nKC || n;
    const desc = k => { try { return M.rules.describe(pair.l[k], pair.s); } catch { return pair.l[k].type; } };
    $('spRead').innerHTML = [
      `<div>board 1: <b>${esc(desc(i))}</b></div>`,
      `<div>board 2: <b>${esc(desc(j))}</b></div>`,
      `<div>feature similarity (cosine) <b>${cosine(fa, fb).toFixed(3)}</b></div>`,
      `<div>PN similarity (cosine) <b>${cosine(ea.pn, eb.pn).toFixed(3)}</b></div>`,
      `<div>KC overlap (Jaccard) <b>${jaccard(a, b).toFixed(3)}</b></div>`,
      `<div>active KCs <b>${a.length}</b> of ${mb.nLive ?? n} live (${pct(a.length / Math.max(1, mb.nLive ?? n))})</div>`,
    ].join('');
    v.dirty = true;
  };
  // the slider starts at the share of the loaded model (FLY_OPTS)
  const base0 = mbOf(heroFlies().A);
  if (base0 && Number.isFinite(base0.sparsity)) { inp.value = String(base0.sparsity); out.textContent = `${Math.round(base0.sparsity * 100)}%`; }
  inp.addEventListener('input', () => { out.textContent = `${Math.round(+inp.value * 100)}%`; });
  inp.addEventListener('change', compute);
  $('spNext').addEventListener('click', () => { pair = pickPair() || pair; compute(); });
  // first pair once the hero has a few moves (or now, from a scripted game)
  const prev = hero.onDecision; let done = false;
  hero.onDecision = rec => { prev?.(rec); if (!done && (hero.match.history.length >= 8)) { done = true; pair = pickPair(); compute(); } };
  if (!hero.match) pair = pickPair();
  compute();
}

// ---------------------------------------------------------------- 05
function initDopamine() {
  const toy = new ToyMB();
  let sel = 0, flash = 0;
  const cv = $('toyCv');
  const v = view(cv, dt => { flash = Math.max(0, flash - dt * 1.5); const { g, w, h } = fit(cv); drawToy(g, w, h, toy, sel, flash); }, () => flash > 0);
  const read = () => {
    $('toyRead').innerHTML = `δ = ${toy.lastDelta.toFixed(2)}${toy.lastDan > 0 ? ' → PAM burst: KC→avoid synapses of this board depress, so its value rises.' : toy.lastDan < 0 ? ' → PPL1 burst: KC→approach synapses of this board depress, so its value falls.' : '.'} V(A) = ${toy.value(0).toFixed(2)}, V(B) = ${toy.value(1).toFixed(2)}. The shared KC carries part of the change to the other board.`;
  };
  seg($('toySel'), x => { sel = +x; v.dirty = true; });
  $('toyRew').addEventListener('click', () => { toy.trial(sel, 1); flash = 1; read(); v.dirty = true; });
  $('toyPun').addEventListener('click', () => { toy.trial(sel, -1); flash = 1; read(); v.dirty = true; });
  $('toyReset').addEventListener('click', () => { toy.reset(); flash = 0; $('toyRead').textContent = 'Reset: all weights at 0.5, both boards worth 0.'; v.dirty = true; });
}

// ---------------------------------------------------------------- 06
// games per match-up for the Evaluate button (node: about 48 ms a game)
const EVAL_N = 100;
const train = { worker: null, running: false, pending: false, batch: 50, series: new Map(), hide: new Set(), weights: null, games: 0, wasRunning: false };

function initTrain() {
  const cv = $('trainCv'), read = $('trainRead');
  const chartV = view(cv, () => { const { g, w, h } = fit(cv); drawChart(g, w, h, [...train.series.values()], { chance: 0.5, hide: train.hide, empty: 'Press Start to train naive flies here' }); });
  const legend = () => {
    $('trainLegend').innerHTML = [...train.series.values()].map(s => `<button data-k="${esc(s.key)}" class="${train.hide.has(s.key) ? 'off' : ''}"><i style="background:${s.col}"></i>${esc(seriesLabel(s.key))}</button>`).join('');
  };
  $('trainLegend').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; const k = b.dataset.k; train.hide.has(k) ? train.hide.delete(k) : train.hide.add(k); legend(); chartV.dirty = true; });
  const btns = ['trainStart', 'trainPause', 'trainNaive', 'trainLoad', 'trainEval'].map($);
  if (!D.connectome || typeof Worker === 'undefined') { read.textContent = !D.connectome ? 'Training needs data/connectome.json, which did not load.' : 'This browser has no Web Workers.'; btns.forEach(b => b.disabled = true); return; }
  const add = (msg) => {
    const x = msg.game ?? msg.games ?? train.games;
    const flat = flattenRow(msg);
    for (const [k, y] of Object.entries(flat)) {
      if (/^(game|games|type|t|ms|elapsed|seed)$/i.test(k) || !(y >= 0 && y <= 1)) continue;
      if (!train.series.has(k)) train.series.set(k, { key: k, pts: [], col: SERIES_COL[train.series.size % SERIES_COL.length] });
      train.series.get(k).pts.push([x, y]);
    }
    legend(); chartV.dirty = true;
  };
  const post = m => { try { train.worker.postMessage(m); } catch (e) { read.textContent = `Worker message failed: ${e.message}`; } };
  const boot = (weights) => {
    if (train.worker) train.worker.terminate();
    train.series.clear(); train.games = 0; train.running = false; train.pending = false; legend(); chartV.dirty = true;
    try { train.worker = new Worker(new URL('./train/worker.js', import.meta.url), { type: 'module' }); }
    catch (e) { read.textContent = `The training worker did not start: ${e.message}`; return false; }
    // Contract protocol: progress, weights, eval. A batch ends with
    // 'weights' (or 'done'); while running, the next batch is posted then.
    train.worker.onmessage = e => {
      const m = e.data || {};
      if (m.type === 'progress') {
        train.games = m.game ?? m.games ?? train.games; add(m);
        if (train.running) read.textContent = `Game ${train.games}${m.winRateA != null ? `. Fly A won ${pct(m.winRateA)} of recent A vs B games` : ''}.`;
      } else if (m.type === 'weights' || m.type === 'done') {
        if (m.A && m.B) train.weights = { A: m.A, B: m.B, games: train.games };
        train.pending = false;
        if (train.running) { train.pending = true; post({ cmd: 'train', games: train.batch }); }
      } else if (m.type === 'eval') {
        // eval rates go in their own series, apart from the training rates
        add({ game: m.game ?? train.games, eval: { vsRandom: m.vsRandom, vsGreedy: m.vsGreedy, AvsB: m.AvsB } });
        const ev = flattenRow({ vsRandom: m.vsRandom, vsGreedy: m.vsGreedy, AvsB: m.AvsB });
        read.textContent = `Evaluation at game ${m.game ?? train.games}, ${m.n ?? '?'} games each, no exploration, no learning: ${Object.entries(ev).map(([k, y]) => `${seriesLabel(k)} ${pct(y)}`).join(', ') || 'done'}.`;
      } else if (m.type === 'paused' || m.type === 'idle') {
        train.running = false; train.pending = false;
      } else if (m.type === 'error') {
        read.textContent = `Worker error: ${m.message || m.error}`; train.running = false; train.pending = false;
      }
    };
    train.worker.onerror = e => { read.textContent = `The training worker failed: ${e.message || 'train/worker.js did not load'}.`; train.running = false; };
    post({ cmd: 'init', connectomes: { A: conOf('A'), B: conOf('B') }, weights: weights || undefined });
    return true;
  };
  btns[0].addEventListener('click', () => {
    if (!train.worker && !boot(null)) return;
    train.running = true; read.textContent = 'Training…';
    if (!train.pending) { train.pending = true; post({ cmd: 'train', games: train.batch }); }
  });
  btns[1].addEventListener('click', () => { if (!train.worker) return; train.running = false; train.pending = false; post({ cmd: 'pause' }); read.textContent = `Paused at game ${train.games}.`; });
  btns[2].addEventListener('click', () => { if (boot(null)) read.textContent = 'Naive flies: every KC→MBON weight at its start value. Press Start.'; });
  btns[3].addEventListener('click', () => {
    if (!D.pretrained) { read.textContent = 'data/pretrained.json is not there yet.'; return; }
    if (boot({ A: weightsFor('A'), B: weightsFor('B'), games: D.pretrained.meta?.games ?? D.pretrained.games })) read.textContent = 'Pretrained flies loaded into the worker. Press Start to train more, or Evaluate.';
  });
  btns[4].addEventListener('click', () => { if (!train.worker && !boot(null)) return; train.running = false; train.pending = false; read.textContent = `Evaluating: ${EVAL_N} games for each of five match-ups, with exploration and learning off. This can take a minute.`; post({ cmd: 'eval', n: EVAL_N }); });
  seg($('trainSpeed'), x => train.batch = +x);
  // chip 06 carries a square while the trainer runs (DESIGN.md 2.2)
  const chip = document.querySelector('#chips a[data-target="s6"]');
  if (chip) tickers.push(() => { if (chip.classList.contains('running') !== train.running) chip.classList.toggle('running', train.running); });
  // no training while the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!train.worker) return;
    if (document.hidden && train.running) { train.wasRunning = true; train.running = false; train.pending = false; post({ cmd: 'pause' }); }
    else if (!document.hidden && train.wasRunning) { train.wasRunning = false; train.running = true; train.pending = true; post({ cmd: 'train', games: train.batch }); }
  });
}

// ---------------------------------------------------------------- 07
function initWatch() {
  const W = { kind: 'ab', match: null, cur: -1, auto: false, acc: 0, bvs: [] };
  const byId = cardMap();
  // Fly B on its own wiring. A bot in seat B has no trace, so the
  // FlyWire cloud stays dark then.
  W.bvs = [new BrainView(conOf('A'), { side: 'A', label: 'Fly A' }), new BrainView(conOf('B'), { side: 'B', label: 'Fly B' })];
  brainCanvas($('wBrainA'), W.bvs[0]); brainCanvas($('wBrainB'), W.bvs[1]);
  if (!M.rules) { renderBoard($('wBoard'), null, { empty: 'The rules engine is not loaded yet.' }); return; }
  const fliesFor = () => {
    if (train.weights?.A) return { A: makeFly('A', train.weights.A), B: makeFly('B', train.weights.B), src: `weights from your training run (game ${train.weights.games})` };
    const F = heroFlies();
    return { A: F.A, B: F.B, src: F.trained ? 'pretrained weights' : 'untrained flies' };
  };
  const start = () => {
    const seed = Math.max(1, (+$('wSeed').value | 0) || 1);
    const F = fliesFor();
    const agents = agentsFor(W.kind, F.A, F.B, seed);
    if (!agents) { $('wInfo').textContent = 'No players could load.'; return; }
    W.bvs[1].label = agents[1].name;
    W.match = new Match(M.rules, agents, { seed, names: [agents[0].name, agents[1].name] });
    W.src = F.src; W.cur = -1;
    W.bvs.forEach(b => b.setTrace(null));
    show();
  };
  const show = () => {
    const m = W.match, rec = W.cur >= 0 ? m.history[W.cur] : null;
    const st = rec ? rec.before : m.history.length ? m.history[0].before : m.state;
    renderBoard($('wBoard'), rec ? rec.before : st, { byId, names: m.names, hands: 'open', hot: hotOf(rec?.action), last: rec ? `${m.names[rec.who]}: ${rec.text}` : 'start' });
    if (rec) {
      const order = rec.legal.map((a, i) => i);
      const vals = rec.scores || rec.values;
      if (vals) order.sort((x, y) => vals[y] - vals[x]);
      const lo = vals ? Math.min(...vals) : 0, hi = vals ? Math.max(...vals) : 1;
      const desc = a => { try { return M.rules.describe(a, rec.before); } catch { return a.type; } };
      const imag = i => rec.values && rec.scores && Math.abs(rec.scores[i] - rec.values[i]) > 1e-9;
      $('wCands').innerHTML = `<li class="head">${esc(m.names[rec.who])} had ${rec.legal.length} options${vals ? ', ranked by score (* = after the worst block the opponent could make)' : ' (a bot: no values)'}</li>`
        + order.map(i => `<li class="${i === rec.idx ? 'chosen' : ''}"><span>${esc(desc(rec.legal[i]))}</span><b title="${rec.values ? `MB value ${rec.values[i].toFixed(3)}` : ''}">${vals ? `${imag(i) ? '*' : ''}${vals[i].toFixed(3)}` : ''}</b>${vals ? `<i style="--v:${hi > lo ? (100 * (vals[i] - lo) / (hi - lo)).toFixed(0) : 100}%;--c:${FLY[rec.who]}"></i>` : ''}</li>`).join('');
      const bv = W.bvs[rec.who];
      if (rec.trace) bv.setTrace(rec.trace, rec.value);
      if (rec.delta != null) bv.burst(rec.delta);
      const end = W.cur === m.history.length - 1 && m.result;
      $('wInfo').textContent = `Decision ${W.cur + 1}, turn ${rec.before.turn}. ${m.names[rec.who]} chose: ${rec.text.replace(/\.$/, '')}.${rec.delta != null ? ` TD error δ = ${rec.delta.toFixed(3)}.` : ''}${end ? ` Game over: ${m.result.winner === -1 ? 'draw' : `${m.names[m.result.winner]} wins`}.` : ''} Using ${W.src}.`;
    } else {
      $('wCands').innerHTML = '<li class="head">Press Next to see the first decision.</li>';
      $('wInfo').textContent = `Seed ${m.seed}. Using ${W.src}.`;
    }
    $('wPrev').disabled = W.cur < 0;
    $('wNext').disabled = !!m.result && W.cur >= m.history.length - 1;
  };
  const next = () => {
    const m = W.match; if (!m) return;
    if (W.cur < m.history.length - 1) { W.cur++; show(); return; }
    let rec = null;
    try { rec = m.next(); } catch (e) { $('wInfo').textContent = `The match stopped: ${e.message}`; return; }
    if (rec) { W.cur = m.history.length - 1; show(); }
    else { W.auto = false; syncAuto(); show(); }
  };
  const syncAuto = () => { $('wAuto').setAttribute('aria-pressed', String(W.auto)); $('wAuto').textContent = W.auto ? 'Stop' : 'Auto'; };
  $('wNext').addEventListener('click', next);
  $('wPrev').addEventListener('click', () => { if (W.cur >= 0) { W.cur--; show(); } });
  $('wAuto').addEventListener('click', () => { W.auto = !W.auto; syncAuto(); });
  $('wNew').addEventListener('click', () => { $('wSeed').value = 1 + Math.floor(Math.random() * 99999); start(); });
  $('wSeed').addEventListener('change', start);
  seg($('wOpp'), k => { W.kind = k; start(); });
  tickers.push(dt => {
    if (!W.auto || !onScreen.has($('wBoard'))) return;
    W.acc += dt; if (W.acc > 0.8) { W.acc = 0; next(); }
  });
  io.observe($('wBoard'));
  start();
}

// ---------------------------------------------------------------- 08
function initResults() {
  const cv = $('curveCv');
  const rows = curveRows(D.curve);
  const { xKey, series } = toSeries(rows);
  series.forEach((s, i) => s.col = SERIES_COL[i % SERIES_COL.length]);
  const hide = new Set();
  const v = view(cv, () => { const { g, w, h } = fit(cv); drawChart(g, w, h, series, { chance: 0.5, hide, empty: D.curve ? 'no win-rate series in the file' : 'data/training-curve.json is not there yet' }); });
  const legend = () => { $('curveLegend').innerHTML = series.map(s => `<button data-k="${esc(s.key)}" class="${hide.has(s.key) ? 'off' : ''}"><i style="background:${s.col}"></i>${esc(seriesLabel(s.key))}</button>`).join(''); };
  $('curveLegend').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; const k = b.dataset.k; hide.has(k) ? hide.delete(k) : hide.add(k); legend(); v.dirty = true; });
  legend();
  if (!D.curve) { $('curveMeta').textContent = 'The pretraining run has not written its file yet. When it does, its numbers appear here.'; $('evalTable').innerHTML = '<tbody><tr><td class="none">No measured numbers yet.</td></tr></tbody>'; return; }
  const meta = D.curve.meta || {};
  const show = ['command', 'seed', 'date', 'wallSeconds', 'node', 'curriculum', 'checkpointEval', 'selection', 'flyOptions', 'note'];
  const txt = k => k === 'wallSeconds' ? `${Math.round(meta[k] / 60)} min (${meta[k]} s)` : String(meta[k]);
  $('curveMeta').innerHTML = show.filter(k => meta[k] != null).map(k => `<b>${esc(k)}</b> ${k === 'command' ? `<code>${esc(meta[k])}</code>` : esc(txt(k))}`).join(' · ')
    + (meta.trainingGamesByKind ? ` · <b>training games by kind</b> ${esc(Object.entries(meta.trainingGamesByKind).map(([k, n]) => `${k} ${n}`).join(', '))}` : '');
  const fin = finalOf();
  if (fin) {
    // held-out rows: label, result { wins, losses, draws, n, rate, ci95, pVsCoin }
    const R = [['Fly A vs random bot', fin.vsRandom?.A], ['Fly B vs random bot', fin.vsRandom?.B], ['Fly A vs greedy bot', fin.vsGreedy?.A], ['Fly B vs greedy bot', fin.vsGreedy?.B],
      ['Fly A vs Fly B', fin.AvsB], ['greedy bot vs random bot (scale)', fin.greedyVsRandom]].filter(r => r[1] && r[1].rate != null);
    const p = v => v == null ? '' : v < 1e-4 ? '< 0.0001' : String(v);
    $('evalTable').innerHTML = `<thead><tr><th>held-out games, kept flies (checkpoint ${esc(fin.games)})</th><th class="n">win</th><th class="n">95% CI</th><th class="n">W-L-D</th><th class="n">p vs coin</th></tr></thead><tbody>`
      + R.map(([lab, r]) => `<tr><th>${esc(lab)}</th><td class="n">${pct(r.rate)}</td><td class="n">${r.ci95 ? `${pct(r.ci95[0])}–${pct(r.ci95[1])}` : ''}</td><td class="n">${r.wins}-${r.losses}-${r.draws}</td><td class="n">${p(r.pVsCoin)}</td></tr>`).join('') + '</tbody>';
    const vd = $('evalVerdict');
    if (vd) { const t = evalVerdict(fin); vd.textContent = t.join(' '); vd.hidden = !t.length; }
    return;
  }
  const last = rows.length ? flattenRow(rows[rows.length - 1]) : {};
  const rateKeys = Object.keys(last).filter(k => k !== xKey && last[k] >= 0 && last[k] <= 1);
  $('evalTable').innerHTML = `<thead><tr><th>${esc(xKey || 'checkpoint')}</th><td class="n">${esc(last[xKey] ?? rows.length)}</td></tr></thead><tbody>`
    + rateKeys.map(k => `<tr><th>${esc(seriesLabel(k))}</th><td class="n">${pct(last[k])}</td></tr>`).join('') + '</tbody>';
}

// ---------------------------------------------------------------- sources
function initSources() {
  $('factList').innerHTML = factsHTML(false);
  $('ourList').innerHTML = factsHTML(true);
  const S = M.facts?.SOURCES;
  $('srcList').innerHTML = S ? Object.entries(S).map(([id, s]) => {
    const link = s.doi ? `https://doi.org/${s.doi}` : s.url;
    return `<li id="ref-${esc(id)}">${esc(s.cite || s.t || id)}${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">${esc(s.doi ? `doi:${s.doi}` : link.replace(/^https?:\/\//, ''))}</a>` : ''}</li>`;
  }).join('') : `<li class="none">data/facts.js did not load (${esc(status.facts)}).</li>`;
  const con = (who, C) => {
    const m = C?.meta;
    return m ? `<div><b>Connectome, ${who}.</b> ${esc(m.source || '')}. ${esc(m.release || '')}. Licence: ${esc(m.licence || 'see CREDITS.md')}. ${m.citation ? esc(m.citation) + '.' : ''} ${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">data</a>` : ''}</div>` : '';
  };
  const B = conOf('B');
  $('credits').innerHTML = [
    con('Fly A', D.connectome),
    B && B !== D.connectome ? con('Fly B', B) : '',
    `<div><b>FlyWire data.</b> Connections: FlyWire Consortium, release 783, <a href="https://doi.org/10.5281/zenodo.10676866" target="_blank" rel="noopener">doi:10.5281/zenodo.10676866</a>. Cell annotations: flywire_annotations v3.2.0, <a href="https://doi.org/10.5281/zenodo.23037340" target="_blank" rel="noopener">doi:10.5281/zenodo.23037340</a>. Both CC BY 4.0. We kept the right mushroom body and thresholded the synapse counts.</div>`,
    `<div><b>Card art.</b> Each card picture is a crop of a public-domain natural-history plate or painting from Wikimedia Commons. Work, author, year and licence of each: <a href="art/CREDITS-ART.md">art/CREDITS-ART.md</a>.</div>`,
    `<div><b>Credits.</b> Data licences, releases, dates and our changes: <a href="CREDITS.md">CREDITS.md</a>. Game, card names and text, card frame, card back, mana glyphs, 3D flies, model and code: our own.</div>`,
  ].join('');
}

// ---------------------------------------------------------------- chips
function initChips() {
  const links = [...document.querySelectorAll('#chips a')];
  const secs = links.map(a => $(a.dataset.target));
  const ol = $('chips').querySelector('ol');
  const box = $('how');
  let cur = null;
  const update = () => {
    let best = null;
    const top = box.getBoundingClientRect().top;
    for (const s of secs) if (s && s.getBoundingClientRect().top - top < (box.clientHeight || innerHeight) * 0.4) best = s;
    if (best === cur) return;
    cur = best;
    links.forEach(a => {
      const on = !!best && a.dataset.target === best.id;
      a.classList.toggle('on', on);
      // scroll the chip row only; scrollIntoView would move the drawer too
      if (on) ol.scrollTo({ left: a.offsetLeft - ol.offsetLeft - 20, behavior: 'smooth' });
    });
  };
  box.addEventListener('scroll', update, { passive: true });
  update();
}

// ---------------------------------------------------------------- loop
let lastT = 0;
function loop(now) {
  const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
  lastT = now;
  if (!window.__fdSaver) {
    for (const t of tickers) { try { t(dt); } catch (e) { console.error(e); } }
    for (const v of views) {
      if (!onScreen.has(v.cv)) continue;
      if (v.dirty || v.live()) { v.dirty = false; try { v.draw(dt); } catch (e) { console.error(e); } }
    }
  }
  requestAnimationFrame(loop);
}

// mirror Fly A of the hero into the section 02 cloud
function linkCentre() {
  const prev = hero.onDecision;
  hero.onDecision = rec => { prev?.(rec); if (centreView && rec.who === 0 && rec.trace) { centreView.setTrace(rec.trace, rec.value); if (rec.delta != null) centreView.burst(rec.delta); } };
}

async function boot() {
  initChips();
  requestAnimationFrame(loop);
  const ready = loadAll();
  // The 3D table loads beside the data. In node, or with no import map,
  // the import fails and the 2D stand-in plays.
  const scene3d = window.flyDuelOpts?.no3d ? Promise.resolve(null) : import('./ui/fly3d/scene.js').catch(e => { status.scene3d = String(e && e.message || e); return null; });
  // makeScene3d: a 3D table for the saver on its own canvas, or null.
  const makeScene3d = async (canvas, o = {}) => {
    const m = await scene3d;
    if (!m?.createDuelScene) return null;
    const off = !!window.flyDuelOpts?.headless3d;   // node test seam
    return m.createDuelScene(off ? null : canvas, { connectomes: D.connectome ? [conOf('A'), conOf('B')] : null, names: NAMES, headless: off, ...o });
  };
  window.flyDuel = { ready, scene3d, makeScene3d, makeFly: (s, w) => makeFly(s, w), heroFlies, conOf, BrainView, Match, renderBoard, M, D, hero, app, enterPlay, exitPlay, openChooser, closeChooser };
  // The saver installs window.snSaver at once and waits on flyDuel.ready
  // itself, so the shell finds the hook before the data has loaded.
  import('./saver.js').catch(e => console.warn('fly-duel: saver.js', e));
  await ready;
  const mod3d = await scene3d;
  // the two brain panels (one shared WebGL renderer); headless in the
  // node test seam
  app.panelMod = mod3d ? await import('./ui/fly3d/brainpanels.js').then(m => (m.createBrainPanels ? m : null), () => null) : null;
  if (M.cards?.COLOUR_IDS) colourIds = [...M.cards.COLOUR_IDS];
  const startHero = () => initHero(mod3d);
  const cards = () => initScorecards();
  const steps = [initFacts, initWiring, initHeroStats, startHero, cards, initHow, initModes, initKcCode, initGame, initCentre, initCompare, linkCentre, initSmell, initSparse, initDopamine, initTrain, initWatch, initResults, initSources];
  for (const f of steps) { try { f(); } catch (e) { console.error(f.name, e); } }
  try { typesetAll(document.querySelector('#doc')); } catch (e) { console.warn(e); }
}
boot();
