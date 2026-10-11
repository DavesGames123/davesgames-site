// ============================================================================
//  FLY DUEL  ·  page logic  (module)
// ----------------------------------------------------------------------------
//  Binds every card of index.html. The other packages load by dynamic
//  import(), so a missing or broken module gives a loading message in its
//  card and the rest of the page still works:
//    game/rules.js game/cards.js game/features.js game/bots.js   (package A)
//    data/connectome.json data/facts.js                          (package B)
//    brain/fly.js brain/mb.js                                    (package C)
//    train/worker.js data/pretrained.json data/training-curve.json (package D)
//    saver.js                                                    (package F)
//    ui/fly3d/scene.js (the 3D hero, three.js by the import map)
//  The ui/ modules (this package) load by static import. The 3D table
//  loads by import() too: in node or without WebGL, the 2D table and the
//  2D brains of #arena play the hero match instead.
//
//  One rAF loop draws only the canvases that are on screen, and runs the
//  autoplay tickers. The loop stops while window.__fdSaver is true (the
//  saver sets it). window.flyDuel gives the saver the loaded modules.
//
//  GREP MAP
//      grep -n 'function fit'             canvas size from CSS size and DPR
//      grep -n 'async function loadAll'   dynamic imports and data files
//      grep -n 'function weightsFor'      pretrained.json -> one fly
//      grep -n 'function makeFly'         Fly construction and weights
//      grep -n 'function dragRotate'      pointer drag on a brain canvas
//      grep -n 'export function hudHTML'  hero HUD card: life, mana, hand
//      grep -n 'function start3d'         the 3D table (ui/fly3d/scene.js)
//      grep -n 'function initHero'        hero live match, 3D or 2D driver
//      grep -n 'function setBrains'       hero brain maps: beside, close, off
//      grep -n 'function initGame'        01 rules, decks, gallery
//      grep -n 'function initCentre'      02 point cloud, counts, facts
//      grep -n 'function initSmell'       03 features -> glomeruli
//      grep -n 'function initSparse'      04 KC sparse code, overlap
//      grep -n 'function initDopamine'    05 toy three-factor rule
//      grep -n 'function initTrain'       06 worker, live curves
//      grep -n 'function initWatch'       07 step-through match
//      grep -n 'function initResults'     08 measured curve, held-out table
//      grep -n 'function finalOf'         meta.final of training-curve.json
//      grep -n 'function initFacts'       [data-fact] and [data-cite] spans
//      grep -n 'function initSources'     references and credits
//      grep -n 'function initChips'       sticky section bar
//      grep -n 'function loop'            the one rAF loop
// ============================================================================
import { manaGlyph } from './ui/art.js';
import { renderBoard, renderDecks, renderGallery, setKeywordText, KEYWORD_TEXT } from './ui/board.js';
import { BrainView } from './ui/brain.js';
import { curveRows, toSeries, seriesLabel, drawChart, SERIES_COL, flattenRow, evalVerdict } from './ui/charts.js';
import { ToyMB, drawToy, drawGlomeruli, drawSparse, jaccard, cosine } from './ui/explain.js';
import { Match, agentFromFly, agentFromBot } from './ui/match.js';
import { beatPlan, motionFor } from './ui/motion.js';
import { typesetAll } from '../../lib/sci-math.js';
import { TOKENS, KC_TYPE, FLY } from './ui/tokens.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = v => `${(100 * v).toFixed(1)}%`;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  mode: '2d', scene: null, busy: false, gen: 0, cam: 'auto', brains: 'beside', maps: [null, null], mapsLoading: null, poke: 0,
};

// The banner text of a game result (DESIGN.md 2.3).
export function resultBanner(r, names = NAMES) {
  if (!r) return null;
  if (r.winner === -1) return { text: `Draw · ${r.reason || 'turn cap'}`, seat: -1 };
  const why = r.reason === 'life' ? 'life 0' : r.reason === 'decked' ? `${names[1 - r.winner]} drew from an empty deck` : (r.reason || '');
  return { text: `${names[r.winner]} wins${why ? ` · ${why}` : ''}`, seat: r.winner };
}

// One HUD card: life, then one mana glyph per land (dim when tapped) and
// the untapped count, then hand, deck and creatures. Exported for the
// node test.
export function hudHTML(state, p, byId, { acting = false, over = null, names = NAMES } = {}) {
  const pl = state?.players?.[p];
  if (!pl) return '';
  const card = id => (byId && (byId.get ? byId.get(id) : byId[id])) || {};
  const lands = pl.battlefield.filter(x => card(x.id).type === 'land');
  const order = { amber: 0, moss: 1 };
  const kind = x => card(x.id).produces || 'generic';
  lands.sort((a, b) => (order[kind(a)] ?? 2) - (order[kind(b)] ?? 2) || (a.tapped - b.tapped));
  const up = lands.filter(x => !x.tapped).length;
  const shown = lands.slice(0, 12);
  const glyphs = shown.map(x => `<i class="m ${x.tapped ? 'off' : 'on'}" title="${esc(card(x.id).name || 'land')}${x.tapped ? ', tapped' : ''}">${manaGlyph(kind(x), 0, 16)}</i>`).join('');
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
  $('heroStage').hidden = hero.mode !== '3d';
  $('arena').hidden = hero.mode === '3d';
  if (hero.mode === '2d') { $('heroCam').hidden = true; $('heroBrains').hidden = true; document.querySelectorAll('.ctl-l').forEach(e => e.hidden = true); }
  $('manaLegGlyphs').innerHTML = `${manaGlyph('amber', 0, 16)} Amber ${manaGlyph('moss', 0, 16)} Moss ${manaGlyph('generic', 1, 16)} generic.`;
  hero.bvs = [new BrainView(D.connectome, { side: 'A', label: 'Fly A' }), new BrainView(D.connectome, { side: 'B', label: 'Fly B' })];
  brainCanvas($('heroBrainA'), hero.bvs[0]);
  brainCanvas($('heroBrainB'), hero.bvs[1]);
  if (!M.rules) { st.textContent = `The rules engine did not load (${status.rules}).`; renderBoard($('heroBoard'), null, { empty: `The rules engine did not load: ${status.rules}.` }); $('arena').hidden = false; $('heroStage').hidden = true; return; }
  const F = heroFlies();
  const agents = agentsFor('ab', F.A, F.B);
  if (!agents) { st.textContent = 'No players could load.'; return; }
  hero.match = new Match(M.rules, agents, { seed: 1 + Math.floor(Math.random() * 1e6), names: NAMES });
  const who = F.A && F.B ? (F.trained ? 'Both flies play with their pretrained weights.' : 'Untrained flies: no pretrained weights.') : 'Stand-in bots play until the fly model loads.';
  const draw = (state, banner = null) => {
    if (hero.mode === '2d') renderBoard($('heroBoard'), state, { byId, names: NAMES, hands: 'count', hot: hotOf(hero.last?.action), last: hero.last?.text || '', lastWho: hero.last?.who, banner });
    hud(state);
  };
  const hud = (state = hero.match.state) => {
    const over = hero.match.over();
    $('hudA').innerHTML = hudHTML(state, 0, byId, { acting: hero.focus === 0, over });
    $('hudB').innerHTML = hudHTML(state, 1, byId, { acting: hero.focus === 1, over });
    $('hudA').classList.toggle('acting', hero.focus === 0);
    $('hudB').classList.toggle('acting', hero.focus === 1);
  };
  const say = () => {
    const r = hero.match.over();
    st.classList.toggle('win', !!r);
    if (r) st.textContent = r.winner === -1 ? `Draw (${r.reason || 'turn cap'}). A new game starts soon.` : `${NAMES[r.winner]} wins${r.reason ? ` (${r.reason})` : ''}. A new game starts soon.`;
    else st.textContent = `${who} Seed ${hero.match.seed}, turn ${hero.match.state.turn}.`;
  };
  const logLine = rec => {
    hero.log.unshift(rec);
    if (hero.log.length > 4) hero.log.length = 4;
    $('heroLog').innerHTML = hero.log.map(r => `<li class="p${r.who}">${esc(r.text)}${r.value != null ? ` <span class="v">V=${r.value.toFixed(2)}</span>` : ''}</li>`).join('');
    $('heroMove').innerHTML = `<b class="s${rec.who}">${NAMES[rec.who]}</b> ${esc(rec.text)}`;
  };
  // Focus on the thinker: the acting pane gets the fly colour and
  // "choosing", the other pane steps back with "waiting". A cut.
  const setFocus = w => {
    hero.focus = w;
    [0, 1].forEach(p => {
      const on = p === w;
      const pane = $(p ? 'heroPaneB' : 'heroPaneA');
      pane.classList.toggle('acting', on); pane.classList.toggle('waiting', w >= 0 && !on);
      $(p ? 'heroCapB' : 'heroCapA').innerHTML = `<b class="seatmark s${p}">${p ? 'B' : 'A'}</b> ${NAMES[p]} · ${w < 0 ? 'game over' : on ? 'choosing' : 'waiting'}`;
    });
    const chip = document.querySelector('#chips a[data-target="s0"]');
    if (chip) chip.dataset.seat = w < 0 ? '' : String(w);
  };
  const newGame = () => {
    hero.match.reset(1 + Math.floor(Math.random() * 1e6));
    hero.log = []; hero.last = null; hero.rec = null; hero.plan = null; hero.hold = 0; hero.t = 0;
    hero.gen++; hero.busy = false;
    $('heroLog').innerHTML = ''; $('heroMove').innerHTML = '';
    if (hero.scene) hero.scene.setState(hero.match.state);
    setFocus(hero.match.state.toAct); draw(hero.match.state); say();
    hero.onReset?.();
  };
  // The end of a record: log, board, HUD, status, the page hooks.
  const landed = rec => {
    hero.last = rec;
    const r = hero.match.over();
    if (r) {
      if (hero.match.finalDelta) hero.match.finalDelta.forEach((d, p) => { if (d != null && hero.bvs[p]) hero.bvs[p].burst(d); });
      setFocus(-1);
    }
    draw(rec.after, r ? resultBanner(r) : null); say();
    hero.onDecision?.(rec);
  };
  // 2D: one step of the beat plan.
  const fire = (step) => {
    const rec = hero.rec, bv = hero.bvs[rec.who], P = hero.plan;
    if (step.key === 'focus') setFocus(rec.who);
    else if (step.key === 'pn') {
      const at = k => (P.steps.find(x => x.key === k)?.at ?? 0) - step.at;
      if (bv && rec.trace) bv.setTrace(rec.trace, rec.value, { pn: 0, kc: at('kc'), mbon: at('mbon') });
    } else if (step.key === 'decide') hero.onDecide?.(rec);
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
  // one starts. The close-up maps fire with the decision.
  const begin3d = () => {
    const rec = next();
    if (!rec) return false;
    const gen = hero.gen;
    hero.rec = rec; hero.busy = true;
    setFocus(rec.who); hud(rec.before); logLine(rec);
    if (rec.trace) hero.maps[rec.who]?.fire(rec.trace, rec.delta);
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
    if (hero.mode === '3d') { if (!hero.busy) begin3d(); return; }
    flush(true);
    if (begin()) flush(true);
    hero.plan = null;
  };
  hero.stepNow = stepNow; hero.newGame = newGame;
  if (hero.scene) hero.scene.setState(hero.match.state);
  setFocus(hero.match.state.toAct); draw(hero.match.state); say();
  const onStage = () => onScreen.has($('heroCv')) || onScreen.has($('heroBrainA')) || onScreen.has($('heroBoard'));
  tickers.push(dt => {
    if (hero.mode === '3d') {
      if (!onScreen.has($('heroCv'))) return;
      // paused: still draw for a moment after a drag or a control change
      if (hero.playing || hero.poke > 0) hero.scene.render(hero.playing ? dt : 0);
      hero.poke = Math.max(0, hero.poke - dt);
      if (!hero.playing || hero.busy) return;
      if (hero.match.over()) {
        hero.t += dt * 1000;
        if (hero.t >= motionFor(REDUCED).endHold + 1500) newGame();
        return;
      }
      hero.t = 0;
      begin3d();
      return;
    }
    if (!hero.playing || !onStage()) return;
    hero.t += dt * 1000;
    if (hero.plan) {
      flush();
      if (hero.t < hero.plan.beat) return;
      hero.plan = null;
      if (hero.match.over()) { hero.hold = motionFor(REDUCED).endHold; hero.t = 0; return; }
    }
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
  addEventListener('resize', () => { hero.scene?.resize(); hero.poke = 0.5; });
  if (REDUCED) stepNow();
}

// "brains": beside (the maps in the scene), close (two large WebGL brain
// views over the stage), off. The close-up views load on first use.
function setBrains(v) {
  hero.brains = v;
  hero.scene?.setBrains?.(v === 'beside');
  $('heroMaps').hidden = v !== 'close';
  hero.poke = 1;
  if (v === 'close' && !hero.maps[0] && !hero.mapsLoading) {
    hero.mapsLoading = import('./ui/fly3d/brain3d.js').then(async B => {
      for (const [p, side, id] of [[0, 'A', 'heroMapA'], [1, 'B', 'heroMapB']]) {
        const C = conOf(side);
        if (!C) continue;
        try {
          const view = B.createBrainView($(id), C, { colour: FLY[p] });
          hero.maps[p] = view;
          const np = await B.loadNeuropil(C, new URL('./data/', import.meta.url)).catch(() => null);
          if (np) view.setNeuropil(np);
          const last = [...(hero.match?.history || [])].reverse().find(r => r.who === p && r.trace);
          if (last) view.fire(last.trace, last.delta, { instant: true });
        } catch (e) { console.info('fly-duel: brain close-up did not start', e); }
      }
    }).catch(e => console.info('fly-duel: brain3d.js did not load', e));
  }
}

// Held-out numbers of the shipped flies (tools/train.mjs meta.final), or null.
function finalOf() { return D.curve?.meta?.final || D.pretrained?.meta?.final || null; }

function initHeroStats() {
  const C = D.connectome, items = [];
  if (C) {
    items.push([`${C.kc?.n ?? C.kc?.pos?.length}`, 'Kenyon cells in each model fly, one per traced KC of the connectome']);
    items.push([`${C.pn?.n}`, 'projection neurons carry the board "smell" in']);
    items.push([`${C.mbon?.n}`, 'output neurons (MBONs) read the KCs out']);
    items.push([`${C.dan?.n}`, 'dopamine neurons (DANs) gate the learning']);
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
  if (C.meta?.synthetic) {
    document.querySelectorAll('[data-wiring]').forEach(el => el.textContent = 'wired from patterns sampled from published statistics (not the traced connectome)');
    const t = $('wiringTag'); t.textContent = 'sampled from published statistics'; t.className = 'tag synth';
  }
}

// ---------------------------------------------------------------- 01
function initGame() {
  $('manaKey').innerHTML = `${manaGlyph('amber', 0, 16)} amber mana ${manaGlyph('moss', 0, 16)} moss mana ${manaGlyph('generic', 2, 16)} any two mana`;
  $('kwList').innerHTML = Object.entries(KEYWORD_TEXT).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v[1])}</li>`).join('');
  if (!M.cards) { $('deckLists').innerHTML = `<p class="none">The card pool did not load (${esc(status.cards)}).</p>`; return; }
  const cards = M.cards.CARDS || [];
  if (M.cards.DECKS) renderDecks($('deckLists'), [...cards, ...(M.cards.TOKENS || [])], M.cards.DECKS);
  let filter = 'all';
  const draw = () => renderGallery($('gallery'), cards, filter);
  seg($('galSeg'), v => { filter = v; draw(); });
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
  $('cxMeta').innerHTML = `${m.synthetic ? '<b>Wiring sampled from published statistics</b>, not traced. ' : ''}${esc(m.release || m.source || '')}${m.licence ? `, licence ${esc(m.licence)}` : ''}${m.retrieved ? `, retrieved ${esc(m.retrieved)}` : ''}. `
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

function factsHTML(measured) {
  const F = M.facts?.FACTS;
  if (!F) return measured ? '' : `<li class="none">data/facts.js did not load (${esc(status.facts)}).</li>`;
  return Object.entries(F).filter(([, f]) => !!f.measured === measured).map(([id, f]) => {
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
  W.bvs = [new BrainView(D.connectome, { side: 'A', label: 'Fly A' }), new BrainView(D.connectome, { side: 'B', label: 'Fly B' })];
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
  const m = D.connectome?.meta;
  $('credits').innerHTML = [
    m ? `<div><b>Connectome.</b> ${esc(m.source || '')}. ${esc(m.release || '')}. Licence: ${esc(m.licence || 'see CREDITS.md')}. ${m.citation ? esc(m.citation) + '.' : ''} ${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">data</a>` : ''}</div>` : '',
    `<div><b>Credits.</b> Data licences, releases and dates: <a href="CREDITS.md">CREDITS.md</a>. Game, cards, art, glyphs, model and code: our own.</div>`,
  ].join('');
}

// ---------------------------------------------------------------- chips
function initChips() {
  const links = [...document.querySelectorAll('#chips a')];
  const secs = links.map(a => $(a.dataset.target));
  const ol = $('chips').querySelector('ol');
  let cur = null;
  const update = () => {
    let best = null;
    for (const s of secs) if (s && s.getBoundingClientRect().top < innerHeight * 0.4) best = s;
    if (best === cur) return;
    cur = best;
    links.forEach(a => {
      const on = !!best && a.dataset.target === best.id;
      a.classList.toggle('on', on);
      // scroll the chip row only; scrollIntoView would move the window too
      if (on) ol.scrollTo({ left: a.offsetLeft - ol.offsetLeft - 20, behavior: 'smooth' });
    });
  };
  addEventListener('scroll', update, { passive: true });
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
  window.flyDuel = { ready, scene3d, makeScene3d, makeFly: (s, w) => makeFly(s, w), heroFlies, conOf, BrainView, Match, renderBoard, M, D, hero };
  // The saver installs window.snSaver at once and waits on flyDuel.ready
  // itself, so the shell finds the hook before the data has loaded.
  import('./saver.js').catch(e => console.warn('fly-duel: saver.js', e));
  await ready;
  const mod3d = await scene3d;
  const startHero = () => initHero(mod3d);
  const steps = [initFacts, initWiring, initHeroStats, startHero, initGame, initCentre, linkCentre, initSmell, initSparse, initDopamine, initTrain, initWatch, initResults, initSources];
  for (const f of steps) { try { f(); } catch (e) { console.error(f.name, e); } }
  try { typesetAll(document.querySelector('#doc')); } catch (e) { console.warn(e); }
}
boot();
