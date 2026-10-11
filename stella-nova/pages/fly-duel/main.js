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
//  The ui/ modules (this package) load by static import.
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
//      grep -n 'function initHero'        hero live match
//      grep -n 'function initGame'        01 rules, decks, gallery
//      grep -n 'function initCentre'      02 point cloud, counts, facts
//      grep -n 'function initSmell'       03 features -> glomeruli
//      grep -n 'function initSparse'      04 KC sparse code, overlap
//      grep -n 'function initDopamine'    05 toy three-factor rule
//      grep -n 'function initTrain'       06 worker, live curves
//      grep -n 'function initWatch'       07 step-through match
//      grep -n 'function initResults'     08 measured curve and table
//      grep -n 'function initFacts'       [data-fact] and [data-cite] spans
//      grep -n 'function initSources'     references and credits
//      grep -n 'function initChips'       sticky section bar
//      grep -n 'function loop'            the one rAF loop
// ============================================================================
import { manaGlyph } from './ui/art.js';
import { renderBoard, renderDecks, renderGallery, setKeywordText, KEYWORD_TEXT } from './ui/board.js';
import { BrainView } from './ui/brain.js';
import { curveRows, toSeries, seriesLabel, drawChart, SERIES_COL, flattenRow } from './ui/charts.js';
import { ToyMB, drawToy, drawGlomeruli, drawSparse, jaccard, cosine } from './ui/explain.js';
import { Match, agentFromFly, agentFromBot } from './ui/match.js';
import { typesetAll } from '../../lib/sci-math.js';

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
  // brain/fly.js imports the rules, so it loads after them
  await tryImport('fly', './brain/fly.js');
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
  if (saved) {
    try { return Fly.fromJSON(D.connectome, saved); }
    catch (e) { console.warn(`fly-duel: weights for ${side} did not load`, e); }
  }
  try { return new Fly(D.connectome, { name: `Fly ${side}`, hemisphere: side, seed: side === 'A' ? 1 : 2 }); }
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
  const v = view(cv, dt => { const { g, w, h } = fit(cv); bv.draw(g, w, h, dt); }, () => bv.ok && !REDUCED || bv.pulse > 0 || bv.dan > 0);
  dragRotate(cv, bv, v);
  return v;
}

// A record from a Match -> the two brain views.
function feedBrains(rec, bvs, match) {
  if (!rec) return;
  const bv = bvs[rec.who];
  if (bv && rec.trace) bv.setTrace(rec.trace, rec.value);
  if (bv && rec.delta != null) bv.burst(rec.delta);
  if (match?.result && match.finalDelta) match.finalDelta.forEach((d, p) => { if (d != null && bvs[p]) bvs[p].burst(d); });
}

// ---------------------------------------------------------------- hero
const hero = { match: null, playing: !REDUCED, speed: 1, acc: 0, wait: 0, bvs: [], log: [], last: null };

function initHero() {
  const st = $('heroStatus');
  hero.bvs = [new BrainView(D.connectome, { side: 'A', label: 'Fly A' }), new BrainView(D.connectome, { side: 'B', label: 'Fly B' })];
  brainCanvas($('heroBrainA'), hero.bvs[0]);
  brainCanvas($('heroBrainB'), hero.bvs[1]);
  const byId = cardMap();
  if (!M.rules) { st.textContent = `The rules engine did not load (${status.rules}).`; renderBoard($('heroBoard'), null, { empty: 'The rules engine is not loaded yet.' }); return; }
  const F = heroFlies();
  const agents = agentsFor('ab', F.A, F.B);
  if (!agents) { st.textContent = 'No players could load.'; return; }
  hero.match = new Match(M.rules, agents, { seed: 1 + Math.floor(Math.random() * 1e6), names: NAMES });
  const who = F.A && F.B ? (F.trained ? 'Both flies play with their pretrained weights.' : 'Untrained flies: data/pretrained.json is not there yet.') : 'Stand-in bots play until the fly model loads.';
  const draw = () => renderBoard($('heroBoard'), hero.match.state, { byId, names: NAMES, hands: 'count', hot: hotOf(hero.last?.action), last: hero.last?.text || '' });
  const say = () => {
    const r = hero.match.over();
    st.classList.toggle('win', !!r);
    if (r) st.textContent = r.winner === -1 ? `Draw (${r.reason || 'turn cap'}). A new game starts soon.` : `${NAMES[r.winner]} wins${r.reason ? ` (${r.reason})` : ''}. A new game starts soon.`;
    else st.textContent = `${who} Seed ${hero.match.seed}.`;
  };
  const logLine = rec => {
    hero.log.unshift(rec);
    if (hero.log.length > 4) hero.log.length = 4;
    $('heroLog').innerHTML = hero.log.map(r => `<li class="p${r.who}">${esc(r.text)}${r.value != null ? ` <span class="v">V=${r.value.toFixed(2)}</span>` : ''}</li>`).join('');
  };
  draw(); say();
  const step = () => {
    if (hero.match.over()) { hero.match.reset(1 + Math.floor(Math.random() * 1e6)); hero.log = []; hero.last = null; $('heroLog').innerHTML = ''; draw(); say(); return; }
    let rec = null;
    try { rec = hero.match.next(); } catch (e) { console.error('hero step', e); st.textContent = `The match stopped: ${e.message}`; hero.playing = false; return; }
    if (!rec) return;
    hero.last = rec; logLine(rec); feedBrains(rec, hero.bvs, hero.match); draw(); say();
    hero.onDecision?.(rec);
    // pause longer on moves that change the board, shorter on a pass
    hero.wait = rec.action?.type === 'pass' || (rec.action?.attackers && !rec.action.attackers.length) || (rec.action?.blocks && !rec.action.blocks.length) ? 0.45 : 1.1;
    if (hero.match.over()) hero.wait = 4;
  };
  hero.stepNow = step;
  tickers.push(dt => {
    if (!hero.playing || !onScreen.has($('heroBrainA')) && !onScreen.has($('heroBoard'))) return;
    hero.acc += dt * hero.speed;
    if (hero.acc >= hero.wait) { hero.acc = 0; step(); }
  });
  io.observe($('heroBoard'));
  const play = $('heroPlay');
  const setPlay = on => { hero.playing = on; play.textContent = on ? 'Pause' : 'Play'; play.setAttribute('aria-pressed', String(on)); };
  setPlay(hero.playing);
  play.addEventListener('click', () => setPlay(!hero.playing));
  seg($('heroSpeed'), v => hero.speed = +v);
  $('heroNew').addEventListener('click', () => { hero.match.reset(1 + Math.floor(Math.random() * 1e6)); hero.log = []; hero.last = null; $('heroLog').innerHTML = ''; draw(); say(); });
  if (REDUCED) step();
}

function initHeroStats() {
  const C = D.connectome, items = [];
  if (C) {
    items.push([`${C.kc?.n ?? C.kc?.pos?.length}`, 'Kenyon cells in each model fly, one per traced KC of the connectome']);
    items.push([`${C.pn?.n}`, 'projection neurons carry the board "smell" in']);
    items.push([`${C.mbon?.n}`, 'output neurons (MBONs) read the KCs out']);
    items.push([`${C.dan?.n}`, 'dopamine neurons (DANs) gate the learning']);
  }
  const rows = curveRows(D.curve);
  if (rows.length) {
    const last = flattenRow(rows[rows.length - 1]);
    const k = Object.keys(last).find(x => /^A\b|^a\b|flyA/i.test(x) && /random/i.test(x) && last[x] <= 1) || Object.keys(last).find(x => /random/i.test(x) && last[x] <= 1);
    if (k) items.push([pct(last[k]), `win rate of ${/B/.test(k.split('.')[0]) ? 'Fly B' : 'Fly A'} against a random player after pretraining (measured)`]);
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
  const sw = c => `<i style="background:${c};width:9px;height:9px;border-radius:50%"></i>`;
  $('mbLegend').innerHTML = [
    `<span>${sw('#62c4ff')}PN ${C.pn?.n}</span>`,
    ...[...kcT].map(([t, n]) => `<span>${sw(/g/.test(t) && !/a/.test(t) ? '#ffd666' : /'/.test(t) ? '#e889dc' : '#ff9a62')}${esc(t)} ${n}</span>`),
    `<span>${sw('#86dc7c')}MBON approach ${val.get('approach') || 0}</span>`,
    `<span>${sw('#ff6a6a')}MBON avoid ${val.get('avoid') || 0}</span>`,
    ...[...danC].map(([t, n]) => `<span>${sw(/PAM/.test(t) ? '#86dc7c' : /PPL1/.test(t) ? '#ff6a6a' : '#a8a4ff')}DAN ${esc(t)} ${n}</span>`),
  ].join('');
  const m = C.meta || {};
  const e = C.edges || {};
  $('cxMeta').innerHTML = `${m.synthetic ? '<b>Wiring sampled from published statistics</b>, not traced. ' : ''}${esc(m.release || m.source || '')}${m.licence ? `, licence ${esc(m.licence)}` : ''}${m.retrieved ? `, retrieved ${esc(m.retrieved)}` : ''}. `
    + `${(e.pn_kc || []).length.toLocaleString('en-US')} PN→KC and ${(e.kc_mbon || []).length.toLocaleString('en-US')} KC→MBON connections. Positions are cable centroids in micrometres; drag to turn. ${esc(M.facts?.HONESTY?.valenceModel || 'MBON valence is a model rule from the dopamine cluster of each compartment.')} The lit KCs mirror Fly A in the hero match.`;
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
  const pickPair = () => {
    const hist = hero.match?.history || [];
    const cands = hist.filter(r => r.legal?.length >= 2);
    if (!cands.length && M.rules) {
      try {
        let s = M.rules.newGame({ seed: 11 });
        for (let i = 0; i < 40 && !M.rules.isOver(s); i++) { const l = M.rules.legalActions(s); if (l.length >= 3 && i > 8) return { s, l, me: s.toAct }; s = M.rules.step(s, l[l.length - 1]); }
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
  $('spNext').addEventListener('click', () => { pair = pickPair(); compute(); });
  // first pair once the hero has a few moves (or now, from a scripted game)
  const prev = hero.onDecision; let done = false;
  hero.onDecision = rec => { prev?.(rec); if (!done && (hero.match.history.length >= 8)) { done = true; pair = pickPair(); compute(); } };
  if (!hero.match) { pair = pickPair(); compute(); }
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
const train = { worker: null, running: false, batch: 50, series: new Map(), hide: new Set(), weights: null, games: 0, wasRunning: false };

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
    train.series.clear(); train.games = 0; train.running = false; legend(); chartV.dirty = true;
    try { train.worker = new Worker(new URL('./train/worker.js', import.meta.url), { type: 'module' }); }
    catch (e) { read.textContent = `The training worker did not start: ${e.message}`; return false; }
    train.worker.onmessage = e => {
      const m = e.data || {};
      if (m.type === 'progress') {
        train.games = m.game ?? m.games ?? train.games; add(m);
        read.textContent = `Game ${train.games}${m.winRateA != null ? `, Fly A won ${pct(m.winRateA)} of recent A vs B games` : ''}.`;
      } else if (m.type === 'weights') {
        train.weights = { A: m.A, B: m.B, games: train.games };
      } else if (m.type === 'eval') {
        add({ ...m, game: train.games });
        read.textContent = `Evaluation at game ${train.games}: ${Object.entries(flattenRow(m)).filter(([k, y]) => y >= 0 && y <= 1 && k !== 'type').map(([k, y]) => `${seriesLabel(k)} ${pct(y)}`).join(', ') || 'done'}.`;
      } else if (m.type === 'done' || m.type === 'paused' || m.type === 'idle') {
        if (m.type === 'done' && train.running) post({ cmd: 'train', games: train.batch });
        else if (m.type !== 'done') train.running = false;
      } else if (m.type === 'error') {
        read.textContent = `Worker error: ${m.message || m.error}`; train.running = false;
      }
    };
    train.worker.onerror = e => { read.textContent = `The training worker failed: ${e.message || 'train/worker.js did not load'}.`; train.running = false; };
    post({ cmd: 'init', connectome: D.connectome, weights: weights || undefined });
    return true;
  };
  btns[0].addEventListener('click', () => {
    if (!train.worker && !boot(null)) return;
    train.running = true; read.textContent = 'Training…';
    post({ cmd: 'train', games: train.batch });
  });
  btns[1].addEventListener('click', () => { if (!train.worker) return; train.running = false; post({ cmd: 'pause' }); read.textContent = `Paused at game ${train.games}.`; });
  btns[2].addEventListener('click', () => { if (boot(null)) read.textContent = 'Naive flies: every KC→MBON weight at its start value. Press Start.'; });
  btns[3].addEventListener('click', () => {
    if (!D.pretrained) { read.textContent = 'data/pretrained.json is not there yet.'; return; }
    if (boot({ A: weightsFor('A'), B: weightsFor('B') })) read.textContent = 'Pretrained flies loaded into the worker. Press Start to train more, or Evaluate.';
  });
  btns[4].addEventListener('click', () => { if (!train.worker && !boot(null)) return; read.textContent = 'Evaluating 200 games…'; post({ cmd: 'eval', n: 200 }); });
  seg($('trainSpeed'), x => train.batch = +x);
  // no training while the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!train.worker) return;
    if (document.hidden && train.running) { train.wasRunning = true; train.running = false; post({ cmd: 'pause' }); }
    else if (!document.hidden && train.wasRunning) { train.wasRunning = false; train.running = true; post({ cmd: 'train', games: train.batch }); }
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
      const vals = rec.values;
      if (vals) order.sort((x, y) => vals[y] - vals[x]);
      const lo = vals ? Math.min(...vals) : 0, hi = vals ? Math.max(...vals) : 1;
      const desc = a => { try { return M.rules.describe(a, rec.before); } catch { return a.type; } };
      $('wCands').innerHTML = `<li class="head">${esc(m.names[rec.who])} had ${rec.legal.length} options${vals ? ', ranked by the value of the board each leads to' : ' (a bot: no values)'}</li>`
        + order.map(i => `<li class="${i === rec.idx ? 'chosen' : ''}"><span>${esc(desc(rec.legal[i]))}</span><b>${vals ? vals[i].toFixed(3) : ''}</b>${vals ? `<i style="--v:${hi > lo ? (100 * (vals[i] - lo) / (hi - lo)).toFixed(0) : 100}%;--c:${rec.who ? '#86dc7c' : '#ffb347'}"></i>` : ''}</li>`).join('');
      const bv = W.bvs[rec.who];
      if (rec.trace) bv.setTrace(rec.trace, rec.value);
      if (rec.delta != null) bv.burst(rec.delta);
      const end = W.cur === m.history.length - 1 && m.result;
      $('wInfo').textContent = `Decision ${W.cur + 1}, turn ${rec.before.turn}. ${m.names[rec.who]} chose: ${rec.text}.${rec.delta != null ? ` TD error δ = ${rec.delta.toFixed(3)}.` : ''}${end ? ` Game over: ${m.result.winner === -1 ? 'draw' : `${m.names[m.result.winner]} wins`}.` : ''} Using ${W.src}.`;
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
  const flat = flattenRow(meta);
  const strs = Object.entries(meta).filter(([, x]) => typeof x === 'string');
  $('curveMeta').innerHTML = [...strs.map(([k, x]) => `<b>${esc(k)}</b> <code>${esc(x)}</code>`), ...Object.entries(flat).map(([k, x]) => `<b>${esc(k)}</b> ${esc(x)}`)].join(' · ') || 'No run details in the file.';
  const last = rows.length ? flattenRow(rows[rows.length - 1]) : {};
  const rateKeys = Object.keys(last).filter(k => k !== xKey && last[k] >= 0 && last[k] <= 1);
  const otherKeys = Object.keys(last).filter(k => k !== xKey && !rateKeys.includes(k));
  $('evalTable').innerHTML = `<thead><tr><th>${esc(xKey || 'checkpoint')}</th><td class="n">${esc(last[xKey] ?? rows.length)}</td></tr></thead><tbody>`
    + rateKeys.map(k => `<tr><th>${esc(seriesLabel(k))}</th><td class="n">${pct(last[k])}</td></tr>`).join('')
    + otherKeys.map(k => `<tr><th>${esc(k)}</th><td class="n">${esc(last[k])}</td></tr>`).join('') + '</tbody>';
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
  window.flyDuel = { ready, makeFly: (s, w) => makeFly(s, w), heroFlies, BrainView, Match, renderBoard, M, D };
  await ready;
  const steps = [initFacts, initWiring, initHeroStats, initHero, initGame, initCentre, linkCentre, initSmell, initSparse, initDopamine, initTrain, initWatch, initResults, initSources];
  for (const f of steps) { try { f(); } catch (e) { console.error(f.name, e); } }
  try { typesetAll(document.querySelector('#doc')); } catch (e) { console.warn(e); }
  import('./saver.js').catch(() => { /* package F lands later */ });
}
boot();
