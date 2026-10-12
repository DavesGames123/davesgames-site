// ============================================================================
//  FLY DUEL  ·  screensaver hook and match director  (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). enter() hides the
//  page, puts one full-window canvas on top (the canvas is in the document)
//  and plays real matches between the two model flies. main.js gives the
//  loaded modules and data through window.flyDuel, and its loop stops while
//  window.__fdSaver is true.
//
//  THE FLIES. Fly A and fly B load from data/pretrained.json when the file
//  is there (window.flyDuel.makeFly), else they are naive flies. Learning
//  is off during the show: the weights do not change. A fly that cannot
//  load is replaced by the greedy bot, and the plate says so.
//
//  THE DIRECTOR (pure, node-tested in tests/saver.test.mjs). Each decision
//  of the match goes through classify(), which gives events: lethal attack,
//  attack, block, spell, creature, brain burst (a large TD error) and win.
//  createDirector() holds one shot for SHOT_MIN to its planned length (5 to
//  12 s). After SHOT_MIN, an event of enough priority cuts to its shot.
//  With no event, the next idle shot comes from a seeded shuffle bag, so
//  each run gives a different order. A variety rule stops a run of weak
//  events (an attack, a cast) from filling every shot: after two event
//  shots in a row, only a strong event (lethal, double block, win) cuts
//  in. Shot kinds:
//      table   the whole table, both sides
//      combat  the creature rows, attack arrows and block lines
//      card    the card just cast, large, next to the caster's brain
//      brain   one mushroom body, large (the fly of the last decision)
//      duo     both mushroom bodies
//      values  the value of each legal move, next to the decider's brain
//      win     the end of a match
//
//  THE SHOW. createShow() runs the match at a calm-scaled pace, feeds the
//  brain views (ui/brain.js) and the director, and draws one frame into a
//  rectangle. It has no DOM access: it gets canvases and images from
//  factories, so the node test draws every shot kind on a fake context.
//
//  THE 3D REEL. When main.js gives window.flyDuel.makeScene3d, the saver
//  films each match on the 3D table as a cut reel (createReel3d). The
//  match plays first in the simulator (time-sliced, a few ms a frame),
//  then planReel() cuts it: a cold open on the crowd, the deck reveal
//  (the key cards of the two decks fanned), the shuffle, the opening
//  hands, then only the turns with the best moments. Skipped turns go at
//  a cut (the plate names them), weak moves play fast, big plays at
//  normal speed, the attack that ends the match in slow motion. Then the
//  victory pose, the slump of the loser and a title card (winner, deck,
//  turns, the V(s) curve of the match and the measured training curve).
//  Shots cut every 5-12 s on events: a cast, the mana taps, an attack, a
//  block, a hit on the life d20, deaths, the crowd, a dopamine burst in a
//  brain map at the think step of a real trace. Decks are random from all
//  13 decks (five colours). The seed sets decks, intro, event options and
//  the filler bag, so each run differs. ui/fly3d/reel.js has the camera
//  rigs, the deck fans, the riffle and the title card panel. Without the
//  3D table, createShow() draws the 2D shots.
//
//  THE CARDS. Every card the 2D show draws is drawCard() of ui/cardface.js:
//  the painted plate card of the gallery and the 3D table. wantArt()
//  starts the picture load once per card. No glow: a hot card gets a hard
//  ring.
//
//  THE PLATE. plateFor() (2D) and reelPlate() (3D) give the shell poster:
//  title per shot, a live line (life totals, turn), the wiring of each fly
//  (hemibrain, FlyWire), KC sparsity of each fly, the decks, the weights
//  state and the honesty line (models, not real flies). The 3D plate
//  shows the three-factor rule and the TD error as TeX. No code extract.
//  The subject sits in the clear band of the plate (plateBand from
//  ../../lib/saver-clear.js): the 2D show draws into the band, the 3D reel
//  moves the camera view into it (reel.js frame). The band holds for a
//  shot and only grows.
//
//  GREP MAP
//      grep -n 'export const SHOT_MIN'        shot limits and priorities
//      grep -n 'export function classify'     decision record -> events
//      grep -n 'export function createDirector' shot director
//      grep -n 'export function paceFor'      seconds between decisions
//      grep -n 'export function plateFor'     shell poster for a shot
//      grep -n 'export function createShow'   match + brains + director
//      grep -n 'export function camShot'      2D shot kind -> 3D camera shot
//      grep -n 'export const REEL'            reel limits and speeds
//      grep -n 'export function introItems'   cold open, decks, shuffle, hands
//      grep -n 'export function scoreRecord'  how much a move is worth showing
//      grep -n 'export function planReel'     match -> items, marks, shots
//      grep -n 'export function recapData'    facts of the title card
//      grep -n 'export function drawRecap'    the title card (2D canvas)
//      grep -n 'export function reelPlate'    shell poster of a reel shot
//      grep -n 'export function createReel3d' the reel on the 3D table
//      grep -n 'function drawTable'           the table (and combat)
//      grep -n 'function wantArt'             load the plate of a card once
//      grep -n 'function drawMini'            one card on the table
//      grep -n 'function drawCardFace'        one card, large
//      grep -n 'function drawValues'          legal moves and values
//      grep -n 'function drawBrain'           one brain view in a rect
//      grep -n 'function enter'               window.snSaver.enter
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { mulberry32, shuffle } from './data/rng.js';
import { BrainView } from './ui/brain.js';
import { Match, agentFromFly, agentFromBot } from './ui/match.js';
import { manaGlyph, colourKey, PALETTE } from './ui/art.js';
import { drawCard, loadCardArt, getCardArt, colourInfo } from './ui/cardface.js';
import { choreograph } from './ui/fly3d/choreo.js';
import { permInfo } from './ui/board.js';
import { TOKENS } from './ui/tokens.js';

// ----------------------------------------------------------- director
export const SHOT_MIN = 5, SHOT_MAX = 12;
export const FADE_IN = 0.45;            // seconds of the dip from black at a cut
export const IDLE = ['table', 'duo', 'values', 'brain'];
export const EVENT_SHOT = { win: 'win', lethal: 'combat', block: 'combat', attack: 'combat', spell: 'card', creature: 'card', burst: 'brain' };
export const PRIORITY = { win: 6, lethal: 5, block: 4, spell: 3, burst: 3, attack: 2, creature: 1 };
const CUT_PRI = 2;          // after SHOT_MIN, an event of this priority or more cuts
const STRONG = 4;           // lethal, double block, win: these cut through the variety rule
const STREAK = 2;           // after this many event shots in a row, a weak event waits
const PENDING_S = 6;        // an event older than this does not cut
const NAMES = ['Fly A', 'Fly B'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const cardOf = (byId, id) => (byId && (byId.get ? byId.get(id) : byId[id])) || null;
const powerOf = (byId, perm) => { const c = cardOf(byId, perm.id); return ((c && c.power) || 0) + (perm.pp | 0); };

// One decision record of ui/match.js -> events. ctx = { byId, burstAt }.
// burstAt is the |delta| that counts as a brain burst (the show sets it
// from the running mean of |delta|, because the scale of V depends on the
// weights). A record can give more than one event.
export function classify(rec, ctx = {}) {
  const out = [];
  if (!rec || !rec.action) return out;
  const { byId = null, burstAt = Infinity } = ctx;
  const a = rec.action, who = rec.who, opp = 1 - who;
  const ev = (kind, extra = {}) => out.push({ kind, pri: PRIORITY[kind], who, i: rec.i, ...extra });
  if (a.type === 'cast') {
    const c = cardOf(byId, a.card);
    if (c && c.type === 'creature') ev('creature', { card: a.card });
    else ev('spell', { card: a.card, target: a.target ?? null });
  } else if (a.type === 'attack' && a.attackers && a.attackers.length) {
    const bf = rec.before?.players?.[who]?.battlefield || [];
    const pow = a.attackers.reduce((s, u) => { const p = bf.find(x => x.uid === u); return s + (p ? powerOf(byId, p) : 0); }, 0);
    const life = rec.before?.players?.[opp]?.life ?? Infinity;
    ev(pow >= life ? 'lethal' : 'attack', { attackers: a.attackers.slice(), power: pow });
  } else if (a.type === 'block' && a.blocks && a.blocks.length) {
    ev('block', { blocks: a.blocks.map(p => p.slice()), pri: PRIORITY.block - (a.blocks.length > 1 ? 0 : 1) });
  }
  if (rec.delta != null && Number.isFinite(rec.delta) && Math.abs(rec.delta) >= burstAt) ev('burst', { delta: rec.delta });
  return out;
}

// The shot director. tick(now, events) -> { shot, changed }. now in
// seconds. A shot: { kind, n, len, who, pri, event }. The same seed and
// the same events give the same shots.
export function createDirector({ seed = 1, calm = 0.7 } = {}) {
  const rng = mulberry32((seed >>> 0) ^ 0x5eed);
  let bag = [], shot = null, t0 = 0, pending = null, n = 0, lastWho = 0, streak = 0;
  const lenOf = () => clamp(SHOT_MIN + (SHOT_MAX - SHOT_MIN) * (0.3 * calm + 0.7 * rng()), SHOT_MIN, SHOT_MAX);
  function nextIdle() {
    if (!bag.length) {
      bag = shuffle(IDLE, rng);
      // no idle kind twice in a row across a refill
      if (shot && bag[0] === shot.kind && bag.length > 1) bag.push(bag.shift());
    }
    let k = bag.shift();
    if (shot && k === shot.kind && bag.length) { bag.push(k); k = bag.shift(); }
    return k;
  }
  function start(now, kind, event) {
    n++;
    const who = event ? event.who : (rng() < 0.5 ? lastWho : 1 - lastWho);
    shot = { kind, n, len: lenOf(), who, pri: event ? event.pri : 0, event: event || null, t0: now };
    streak = event ? streak + 1 : 0;
    t0 = now;
    pending = null;
    return { shot, changed: true };
  }
  return {
    tick(now, events = []) {
      for (const e of events) {
        if (e.who === 0 || e.who === 1) lastWho = e.who;
        if (!pending || e.pri >= pending.pri || now - pending.at > PENDING_S) pending = { ...e, at: now };
      }
      if (pending && now - pending.at > PENDING_S) pending = null;
      if (!shot) return start(now, pending ? EVENT_SHOT[pending.kind] : nextIdle(), pending);
      const tau = now - t0;
      // Variety rule: a weak event does not make a third event shot in a
      // row, and does not cut early to the shot kind already on screen.
      const strong = pending && pending.pri >= STRONG;
      const usable = pending && (strong || streak < STREAK);
      if (tau >= SHOT_MIN && usable && pending.pri >= CUT_PRI && (strong || EVENT_SHOT[pending.kind] !== shot.kind)) return start(now, EVENT_SHOT[pending.kind], pending);
      if (tau >= shot.len) return usable ? start(now, EVENT_SHOT[pending.kind], pending) : start(now, nextIdle(), null);
      return { shot, changed: false };
    },
    get shot() { return shot; },
    get pending() { return pending; },
    state: () => ({ n, streak, kind: shot && shot.kind, len: shot && +shot.len.toFixed(2), pending: pending && pending.kind, bag: bag.slice() }),
  };
}

// Seconds the show waits after a decision before the next one. A pass or
// an empty attack or block is quick; a move that changes the board holds.
export function paceFor(action, calm = 0.7, over = false) {
  if (over) return 4 + 2 * calm;
  if (!action) return 0.5;
  const empty = action.type === 'pass' || (action.attackers && !action.attackers.length) || (action.blocks && !action.blocks.length);
  if (empty) return 0.3 + 0.4 * calm;
  if (action.type === 'land') return 0.7 + 0.6 * calm;
  return 1.2 + 1.3 * calm;
}

const pctOf = (on, live) => live > 0 ? `${(100 * on / live).toFixed(1)}%` : 'n/a';

// The shell poster for a shot. snap = { life, turn, kc: [{ on, live } | null, same for B],
// trained, kinds: ['fly'|'bot', ..], card, over, last, wiring: [A, B] }. Plain text; the
// TeX is the TD error and the value readout of the model.
export function plateFor(shot, snap = {}) {
  const life = snap.life || ['?', '?'], who = shot ? shot.who : 0, name = NAMES[who] || 'Fly A';
  const kinds = snap.kinds || ['fly', 'fly'];
  const sub = `${NAMES[0]} ${life[0]} life · ${NAMES[1]} ${life[1]} life · turn ${snap.turn ?? '?'}`;
  const kc = snap.kc || [];
  const lines = [];
  // kc[i] is fly i, or null before its first move. The two flies have
  // different wiring files, so each share names its own KC count.
  const kcPart = i => kc[i] ? `${NAMES[i]} ${pctOf(kc[i].on, kc[i].live)} of ${kc[i].live}` : `${NAMES[i]} n/a`;
  if (kc.some(Boolean)) lines.push(`Active Kenyon cells (share of those with PN input): ${kcPart(0)} · ${kcPart(1)}`);
  if (kinds.some(k => k !== 'fly')) lines.push('The fly model did not load: the greedy bot stands in');
  else lines.push(snap.trained ? 'Pretrained weights, learning off during the show' : 'Untrained flies: no pretrained weights yet');
  // snap.wiring: the connectome name of each fly (pretrained.json "wiring")
  const wr = snap.wiring || [];
  lines.push(wr[0] && wr[1] && wr[0] !== wr[1]
    ? `Models on traced wiring (${NAMES[0]} ${wr[0]}, ${NAMES[1]} ${wr[1]} mushroom body), not real flies`
    : `A model on ${wr[0] || 'hemibrain'} mushroom body wiring, not a real fly`);
  const td = { tex: ["\\delta = r + \\gamma\\,V(s') - V(s)"], rules: [['\\delta', 'm1'], ['V', 'm2'], ['\\gamma', 'm3']], eq: ["δ = r + γ·V(s′) − V(s)"] };
  const val = { tex: ['V(s) = \\sum_j v_j\\, m_j(s)'], rules: [['V', 'm2'], ['v_j', 'm4'], ['m_j', 'm5']], eq: ['V(s) = Σ v_j · m_j(s)'] };
  const k = shot ? shot.kind : 'table', e = shot && shot.event;
  let p;
  if (k === 'win') {
    const w = snap.over ? snap.over.winner : -1;
    p = { title: w === 0 || w === 1 ? `${NAMES[w]} wins` : 'A drawn match', ...td };
    lines.unshift(snap.over && snap.over.reason ? `The match ends: ${snap.over.reason}` : 'The match ends');
  } else if (k === 'combat') {
    const t = !e ? 'Combat' : e.kind === 'lethal' ? `${name} attacks for lethal` : e.kind === 'block' ? `${name} blocks` : `${name} attacks`;
    p = { title: t, ...val };
  } else if (k === 'card') {
    p = { title: snap.card ? `${name} casts ${snap.card.name}` : `${name} casts a card`, ...val };
    if (snap.card && snap.card.text) lines.unshift(snap.card.text);
  } else if (k === 'brain') {
    p = { title: `${name}: the mushroom body decides`, ...td };
    if (e && e.kind === 'burst') lines.unshift(`${e.delta > 0 ? 'PAM (reward)' : 'PPL1 (punishment)'} dopamine burst, δ = ${e.delta.toFixed(3)}`);
  } else if (k === 'duo') p = { title: 'Two mushroom bodies, one duel', ...td };
  else if (k === 'values') p = { title: `${name} scores every legal move`, ...val };
  else p = { title: 'Two model fly brains play a card duel', ...val };
  return { ...p, sub, lines: lines.slice(0, 4) };
}

// ----------------------------------------------------------- drawing
const INK = TOKENS.ink, INK2 = TOKENS.ink2, DIM = TOKENS.dim, BG = TOKENS.bg;
// seat colours (DESIGN.md 1.1): Fly A, Fly B
const SIDE_COL = [TOKENS.flyA, TOKENS.flyB];
const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';
const font = (px, w = 500) => `${w} ${Math.max(6, Math.round(px))}px ${FONT}`;

function rrect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// Cut s with an ellipsis so it fits in maxW at the current font.
function fitText(g, s, maxW) {
  s = String(s ?? '');
  if (maxW <= 0) return '';
  if (g.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
  return lo ? s.slice(0, lo) + '…' : '';
}

// Word wrap into at most maxLines lines.
function wrap(g, s, maxW, maxLines) {
  const words = String(s ?? '').split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.length) lines[maxLines - 1] = fitText(g, lines[maxLines - 1], maxW);
  return lines;
}

// SVG text -> loaded image, through the image factory. Null in node.
function svgImage(S, key, svg) {
  if (S.imgs.has(key)) return S.imgs.get(key);
  let img = null;
  if (S.makeImage) {
    const src = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    try { img = S.makeImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src)); } catch { img = null; }
  }
  S.imgs.set(key, img);
  return img;
}
const ready = img => !!(img && (img.complete === undefined || img.complete) && (img.naturalWidth === undefined || img.naturalWidth > 0));

// The plate picture of a card (ui/cardface.js loadCardArt). The first
// call starts the load; drawCard() uses the cached picture from the next
// frame on. Without a DOM the loader gives null, and drawCard() draws a
// flat placeholder.
function wantArt(S, card, small) {
  if (!card) return;
  const key = `${card.id}${small ? '@sm' : ''}`;
  if (S.art.has(key)) return;
  S.art.add(key);
  loadCardArt(card.id, { small }).catch(() => null);
}

function drawGlyph(S, g, kind, n, x, y, s) {
  const img = svgImage(S, `mana:${kind}:${n}`, manaGlyph(kind, n, 40));
  if (ready(img)) { g.drawImage(img, x, y, s, s); return; }
  const col = kind === 'amber' ? PALETTE.amber.ink : kind === 'moss' ? PALETTE.moss.ink : PALETTE.none.ink;
  g.strokeStyle = col; g.lineWidth = Math.max(1, s / 12);
  g.beginPath(); g.arc(x + s / 2, y + s / 2, s * 0.42, 0, Math.PI * 2); g.stroke();
}

// A permanent on the table: the painted card of ui/cardface.js at a small
// size, with its state (tapped, sick, damage, pump). A hot card (attacker
// or blocker of the shot) gets a hard ring in the card colour. No glow.
function drawMini(S, g, card, info, x, y, w, h, hot) {
  const P = PALETTE[colourKey(card && card.colour)];
  wantArt(S, card, true);
  g.save();
  if (info.tapped) { g.translate(x + w / 2, y + h / 2); g.rotate(0.22); g.translate(-x - w / 2, -y - h / 2); }
  drawCard(g, card || null, { x, y, w, h, art: card ? getCardArt(card.id, { small: true }) : null,
    state: { tapped: !!info.tapped, sick: !!info.sick, damage: info.damage | 0, pp: info.pp | 0, pt: info.pt | 0 } });
  if (hot) {
    // the card keeps 5:7 inside (w, h): ring its real box
    const u = Math.min(w / 100, h / 140), cw = 100 * u, ch = 140 * u;
    g.lineWidth = Math.max(2, cw * 0.03); g.strokeStyle = P.glow;
    g.strokeRect(x + (w - cw) / 2 - g.lineWidth, y + (h - ch) / 2 - g.lineWidth, cw + 2 * g.lineWidth, ch + 2 * g.lineWidth);
  }
  g.restore();
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

// One side of the table in rect (x, y, w, h). Returns uid -> card centre.
function drawSide(S, g, st, p, x, y, w, h, o) {
  const P = st.players[p], pos = new Map(), byId = S.byId;
  const perms = (P.battlefield || []).map(q => ({ info: permInfo(q), card: cardOf(byId, q.id) }));
  const lands = perms.filter(q => q.card && q.card.type === 'land');
  const crits = perms.filter(q => !q.card || q.card.type !== 'land');
  const hh = clamp(h * (o.combat ? 0.17 : 0.22), 16, 46), top = p === 1;
  const hy = top ? y : y + h - hh;           // header away from the midline
  const ry = top ? y + hh : y, rh = h - hh;
  // header: name, life, lands, hand and library
  const act = st.toAct === p;
  g.fillStyle = act ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.025)';
  rrect(g, x, hy + hh * 0.1, w, hh * 0.8, hh * 0.2); g.fill();
  g.textBaseline = 'middle'; g.textAlign = 'left';
  const cy = hy + hh / 2;
  g.fillStyle = SIDE_COL[p]; g.beginPath(); g.arc(x + hh * 0.4, cy, hh * 0.12, 0, Math.PI * 2); g.fill();
  g.fillStyle = INK; g.font = font(hh * 0.4, 600); g.fillText(S.names[p], x + hh * 0.65, cy);
  let cx = x + hh * 0.65 + g.measureText(S.names[p]).width + hh * 0.35;
  g.font = font(hh * 0.62, 700); g.fillStyle = P.life <= 5 ? TOKENS.dmg : INK;
  const lt = String(P.life); g.fillText(lt, cx, cy); cx += g.measureText(lt).width + hh * 0.15;
  g.font = font(hh * 0.3); g.fillStyle = DIM; g.fillText('life', cx, cy + hh * 0.06); cx += g.measureText('life').width + hh * 0.4;
  const meta = `hand ${(P.hand || []).length} · library ${(P.library || []).length}`;
  g.font = font(hh * 0.3); const mw = g.measureText(meta).width;
  g.textAlign = 'right'; g.fillStyle = DIM; g.fillText(meta, x + w - hh * 0.3, cy); g.textAlign = 'left';
  const gs = hh * 0.42, room = x + w - hh * 0.6 - mw - cx;
  const nShow = Math.max(0, Math.min(lands.length, Math.floor(room / (gs * 1.1))));
  for (let i = 0; i < nShow; i++) {
    const q = lands[i], k = colourKey(q.card.colour);
    g.globalAlpha = q.info.tapped ? 0.35 : 1;
    drawGlyph(S, g, k === 'none' ? 'generic' : k, 1, cx + i * gs * 1.1, cy - gs / 2, gs);
  }
  g.globalAlpha = 1;
  if (nShow < lands.length && room > gs * 2) { g.fillStyle = DIM; g.font = font(hh * 0.28); g.fillText(`+${lands.length - nShow}`, cx + nShow * gs * 1.1, cy); }
  // creature row
  const n = crits.length, pad = Math.max(4, w * 0.012);
  if (!n) {
    g.fillStyle = 'rgba(138,145,165,0.6)'; g.font = font(clamp(rh * 0.08, 10, 16)); g.textAlign = 'center';
    g.fillText('no creatures', x + w / 2, ry + rh / 2); g.textAlign = 'left';
  } else {
    let ch = rh - 2 * pad, cw = ch * 0.72;
    const fitW = (w - pad * (n + 1)) / n;
    if (cw > fitW) { cw = fitW; ch = cw / 0.72; }
    const total = n * cw + (n - 1) * pad, x0 = x + (w - total) / 2, y0 = ry + (rh - ch) / 2;
    crits.forEach((q, i) => {
      const xx = x0 + i * (cw + pad);
      drawMini(S, g, q.card, q.info, xx, y0, cw, ch, o.hot.has(q.info.uid));
      pos.set(q.info.uid, { x: xx + cw / 2, y: y0 + ch / 2, w: cw, h: ch });
    });
  }
  g.textBaseline = 'alphabetic';
  return { pos, life: { x: x + hh * 1.5, y: cy } };
}

function arrow(g, x0, y0, x1, y1, col, lw) {
  const a = Math.atan2(y1 - y0, x1 - x0), hl = lw * 4;
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - Math.cos(a) * hl * 0.6, y1 - Math.sin(a) * hl * 0.6); g.stroke();
  g.beginPath(); g.moveTo(x1, y1);
  g.lineTo(x1 - Math.cos(a - 0.45) * hl, y1 - Math.sin(a - 0.45) * hl);
  g.lineTo(x1 - Math.cos(a + 0.45) * hl, y1 - Math.sin(a + 0.45) * hl);
  g.closePath(); g.fill();
}

// The table: Fly B on top, Fly A below, a midline with the turn and the
// last move. o.combat: larger creature rows, attack arrows, block lines.
function drawTable(S, g, R, o = {}) {
  const st = S.match.state;
  const mid = clamp(R.h * 0.08, 18, 40), half = (R.h - mid) / 2;
  const hot = new Set(o.hot || []);
  const top = drawSide(S, g, st, 1, R.x, R.y, R.w, half, { hot, combat: o.combat });
  const bot = drawSide(S, g, st, 0, R.x, R.y + half + mid, R.w, half, { hot, combat: o.combat });
  // midline
  const my = R.y + half + mid / 2;
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(R.x, my); g.lineTo(R.x + R.w, my); g.stroke();
  g.font = font(mid * 0.42, 600); g.textBaseline = 'middle'; g.textAlign = 'left';
  const tt = `turn ${st.turn}`; const tw = g.measureText(tt).width + mid * 0.6;
  g.fillStyle = BG; g.fillRect(R.x, my - mid * 0.35, tw, mid * 0.7);
  g.fillStyle = INK2; g.fillText(tt, R.x + mid * 0.2, my);
  if (S.last) {
    g.font = font(mid * 0.38); const s = fitText(g, S.last.text, R.w - tw - mid);
    const sw = g.measureText(s).width;
    g.fillStyle = BG; g.fillRect(R.x + R.w - sw - mid * 0.5, my - mid * 0.35, sw + mid * 0.5, mid * 0.7);
    g.fillStyle = SIDE_COL[S.last.who]; g.textAlign = 'right'; g.fillText(s, R.x + R.w - mid * 0.2, my);
  }
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  // attack arrows (attackers in combat, or the last attack) and block lines
  const side = [bot, top];  // side[p] = layout of player p
  const lw = clamp(R.w / 260, 1.5, 4);
  const atk = st.combat ? { who: st.active, list: st.combat.attackers } : o.attack || null;
  if (atk && atk.list) {
    const blocked = new Set((o.blocks || []).map(b => b[0]));
    for (const u of atk.list) {
      const p0 = side[atk.who].pos.get(u); if (!p0 || blocked.has(u)) continue;
      const tgt = side[1 - atk.who].life;
      const y0 = p0.y + (atk.who === 0 ? -p0.h / 2 : p0.h / 2);
      arrow(g, p0.x, y0, tgt.x, tgt.y, SIDE_COL[atk.who], lw);
    }
  }
  for (const [a, b] of o.blocks || []) {
    let pa = null, pb = null;
    for (const s of side) { pa = pa || s.pos.get(a); pb = pb || s.pos.get(b); }
    if (pa && pb) arrow(g, pb.x, pb.y, pa.x, pa.y, SIDE_COL[atk ? 1 - atk.who : 0], lw);
  }
  return { x: R.x + R.w / 2, y: R.y + R.h / 2, w: R.w, h: R.h };
}

// One card, large: the painted card of ui/cardface.js (drawCard), the
// same face as the gallery and the 3D table. Height = 1.4 * w.
function drawCardFace(S, g, card, x, y, w) {
  const h = w * 1.4;
  wantArt(S, card, false);
  drawCard(g, card || null, { x, y, w, h, art: card ? getCardArt(card.id) : null });
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  return { x: x + w / 2, y: y + h / 2, w, h };
}

// One brain view into rect R through its own canvas (BrainView.draw
// clears its box, so it draws off screen and the show copies it in).
function drawBrain(S, g, i, R, dt) {
  const bv = S.bvs[i], c = S.brainCv[i];
  if (!bv || !c) return null;
  const dpr = S.dpr || 1;
  const W = Math.max(1, Math.round(R.w * dpr)), H = Math.max(1, Math.round(R.h * dpr));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const bg = c.getContext('2d');
  bg.setTransform(dpr, 0, 0, dpr, 0, 0);
  bv.draw(bg, R.w, R.h, dt);
  g.drawImage(c, R.x, R.y, R.w, R.h);
  g.strokeStyle = SIDE_COL[i]; g.globalAlpha = 0.35; g.lineWidth = 1;
  rrect(g, R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1, 6); g.stroke(); g.globalAlpha = 1;
  return { x: R.x + R.w / 2, y: R.y + R.h / 2, w: R.w, h: R.h };
}

// The legal moves of the last fly decision with their values.
function drawValues(S, g, rec, R) {
  if (!rec || !rec.values || !rec.legal) {
    g.fillStyle = DIM; g.font = font(14); g.textAlign = 'center';
    g.fillText('Waiting for a fly decision with more than one legal move', R.x + R.w / 2, R.y + R.h / 2);
    g.textAlign = 'left';
    return { x: R.x + R.w / 2, y: R.y + R.h / 2, w: R.w, h: R.h };
  }
  const rows = rec.legal.map((a, j) => ({ j, v: rec.values[j], a })).filter(r => Number.isFinite(r.v)).sort((p, q) => q.v - p.v);
  const show = rows.slice(0, 8);
  if (!show.some(r => r.j === rec.idx)) { const c = rows.find(r => r.j === rec.idx); if (c) show[show.length - 1] = c; }
  const vs = show.map(r => r.v), lo = Math.min(...vs, 0), hi = Math.max(...vs, 1e-6);
  const head = clamp(R.h * 0.11, 14, 30), rh = (R.h - head) / Math.max(4, show.length);
  g.fillStyle = INK; g.font = font(head * 0.5, 600); g.textBaseline = 'middle';
  g.fillText(fitText(g, `${S.names[rec.who]}: ${rec.legal.length} legal moves, V of each afterstate`, R.w), R.x, R.y + head * 0.45);
  const lab = R.w * 0.5;
  show.forEach((r, k) => {
    const y = R.y + head + k * rh, chosen = r.j === rec.idx;
    let txt = '';
    try { txt = S.rules.describe(r.a, rec.before); } catch { txt = r.a.type; }
    txt = txt.replace(/^Fly [AB] /, '').replace(/\.$/, '');
    g.font = font(clamp(rh * 0.38, 9, 16), chosen ? 650 : 450);
    g.fillStyle = chosen ? INK : INK2; g.textAlign = 'left';
    g.fillText(fitText(g, (chosen ? '▸ ' : '') + txt, lab - 8), R.x, y + rh / 2);
    const bx = R.x + lab, bw = R.w - lab - 52, z = (0 - lo) / (hi - lo || 1);
    const x0 = bx + bw * z, x1 = bx + bw * ((r.v - lo) / (hi - lo || 1));
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(bx, y + rh * 0.2, bw, rh * 0.6);
    g.fillStyle = chosen ? SIDE_COL[rec.who] : r.v >= 0 ? TOKENS.app : TOKENS.avoid;
    g.fillRect(Math.min(x0, x1), y + rh * 0.2, Math.max(1, Math.abs(x1 - x0)), rh * 0.6);
    g.fillStyle = chosen ? INK : DIM; g.textAlign = 'right'; g.font = font(clamp(rh * 0.34, 9, 14));
    g.fillText(r.v.toFixed(3), R.x + R.w, y + rh / 2);
  });
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  return { x: R.x + R.w / 2, y: R.y + R.h / 2, w: R.w, h: R.h };
}

// Split R in two: side by side when wide, stacked when tall. f = share of a.
function split(R, f = 0.5, gap = 12) {
  if (R.w >= R.h * 1.15) { const aw = (R.w - gap) * f; return [{ x: R.x, y: R.y, w: aw, h: R.h }, { x: R.x + aw + gap, y: R.y, w: R.w - aw - gap, h: R.h }]; }
  const ah = (R.h - gap) * f; return [{ x: R.x, y: R.y, w: R.w, h: ah }, { x: R.x, y: R.y + ah + gap, w: R.w, h: R.h - ah - gap }];
}

// ----------------------------------------------------------- the show
// The two players: the flies, or the greedy bot for a fly that did not
// load (kinds[i] becomes 'bot', the plate says so).
function agentsOf(env, kinds) {
  const agents = [0, 1].map(i => {
    const f = env.flies && env.flies[i];
    if (f) return agentFromFly(f, NAMES[i]);
    kinds[i] = 'bot';
    return env.bots && env.bots.greedyBot ? agentFromBot(env.bots.greedyBot(), `${NAMES[i]} (greedy bot)`) : null;
  });
  if (!agents[0] || !agents[1]) throw new Error('fly-duel saver: no players');
  return agents;
}

// env = { rules, byId, connectome, connectomes?: [A, B], flies: [A, B]
// (null = bot), bots,
// trained, seed, calm, wiring: [A, B] names for the plate, makeCanvas(),
// makeImage(src) | null, dpr }.
export function createShow(env) {
  const calm = clamp(env.calm ?? 0.7, 0, 1);
  const seed = (env.seed >>> 0) || 1;
  const rng = mulberry32(seed ^ 0xf1ead);
  const S = {
    rules: env.rules, byId: env.byId, names: NAMES.slice(), imgs: new Map(), art: new Set(), makeImage: env.makeImage || null, dpr: env.dpr || 1,
    // each fly's own wiring: env.connectomes [A, B] (Fly B = FlyWire),
    // else env.connectome for both
    bvs: [0, 1].map(i => new BrainView(env.connectomes?.[i] || env.connectome, { side: i ? 'B' : 'A', label: NAMES[i] })),
    brainCv: [0, 1].map(() => env.makeCanvas()),
    match: null, last: null, lastBy: [null, null], lastValues: null, kinds: ['fly', 'fly'],
  };
  for (const bv of S.bvs) bv.spin = 0.16 - 0.08 * calm;
  const agents = agentsOf(env, S.kinds);
  const dir = createDirector({ seed, calm });
  let wait = 0.8, acc = 0, games = 0, absMean = 0, nDelta = 0, overAt = -1, now = 0;
  const newMatch = () => { games++; const ms = (rng() * 2 ** 32) >>> 0 || 1; S.match = new Match(env.rules, agents, { seed: ms, names: NAMES, decks: env.deckIds ? pickDeckPair(rng, env.deckIds) : undefined }); S.last = null; S.lastBy = [null, null]; S.lastValues = null; overAt = -1; wait = 1; };
  newMatch();

  function decide() {
    let rec = null;
    try { rec = S.match.next(); } catch (e) { rec = null; newMatch(); return []; }
    if (!rec) return [];
    S.last = rec; S.lastBy[rec.who] = rec;
    if (rec.values && rec.values.length > 1 && S.kinds[rec.who] === 'fly') S.lastValues = rec;
    const bv = S.bvs[rec.who];
    if (rec.trace) bv.setTrace(rec.trace, rec.value);
    // brain bursts: |delta| against its running mean (V has no fixed scale)
    let burstAt = Infinity;
    if (rec.delta != null && Number.isFinite(rec.delta)) {
      const d = Math.abs(rec.delta);
      if (nDelta >= 6) burstAt = Math.max(3 * absMean, 1e-4);
      nDelta++; absMean += (d - absMean) / Math.min(nDelta, 40);
      bv.burst(rec.delta);
    }
    const ev = classify(rec, { byId: S.byId, burstAt });
    const over = S.match.over();
    if (over) {
      if (S.match.finalDelta) S.match.finalDelta.forEach((d, p) => { if (d != null) S.bvs[p].burst(d); });
      ev.push({ kind: 'win', pri: PRIORITY.win, who: over.winner === 1 ? 1 : 0, i: rec.i });
      overAt = now;
    }
    wait = paceFor(rec.action, calm, !!over);
    return ev;
  }

  return {
    S, dir,
    get games() { return games; },
    // Advance the match and the director by dt seconds. Returns the
    // director result of this tick ({ shot, changed }).
    update(dt) {
      now += dt;
      let ev = [];
      const over = S.match.over();
      if (over) {
        // hold the end until the win shot has been up for a while
        const sh = dir.shot, shown = sh && sh.kind === 'win' && now - sh.t0 >= 3 + 2 * calm;
        if (shown || now - overAt > 16) newMatch();
      } else {
        acc += dt;
        if (acc >= wait) { acc = 0; ev = decide(); }
      }
      return dir.tick(now, ev);
    },
    get now() { return now; },
    // A plate snapshot of now.
    snapshot() {
      const st = S.match.state, sh = dir.shot;
      const kc = [0, 1].map(i => { const t = S.lastBy[i] && S.lastBy[i].trace; return t ? { on: (t.kc || []).length, live: t.kcLive || 0 } : null; });
      const card = sh && sh.event && sh.event.card ? cardOf(S.byId, sh.event.card) : null;
      return { life: st.players.map(p => p.life), turn: st.turn, kc: kc.length === 2 ? kc : [], trained: !!env.trained, kinds: S.kinds, card, over: S.match.over(), wiring: env.wiring };
    },
    // Draw the shot into the band R (CSS px). Returns the subject box.
    draw(g, R, dt) {
      const sh = dir.shot; if (!sh) return null;
      const tau = now - sh.t0, k = clamp(tau / sh.len, 0, 1);
      const pad = Math.min(R.w, R.h) * 0.03;
      const Q = { x: R.x + pad, y: R.y + pad, w: R.w - 2 * pad, h: R.h - 2 * pad };
      // a slow push-in on the band centre
      const z = 1 + (0.05 + 0.04 * (1 - calm)) * smooth(k);
      const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
      g.save();
      g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
      g.translate(cx, cy); g.scale(z, z); g.translate(-cx, -cy);
      let subj = null;
      const e = sh.event, who = sh.who;
      if (sh.kind === 'table' || sh.kind === 'win') {
        subj = drawTable(S, g, Q, { hot: [] });
        if (sh.kind === 'win') {
          const ov = S.match.over(), t = !ov ? 'The match goes on' : ov.winner === -1 ? 'Draw' : `${NAMES[ov.winner]} wins`;
          const fs = clamp(Q.h * 0.12, 18, 64);
          g.font = font(fs, 750); g.textAlign = 'center'; g.textBaseline = 'middle';
          const tw = g.measureText(t).width + fs;
          g.fillStyle = 'rgba(5,7,12,0.82)'; rrect(g, cx - tw / 2, cy - fs * 0.8, tw, fs * 1.6, fs * 0.3); g.fill();
          g.fillStyle = ov && ov.winner >= 0 ? SIDE_COL[ov.winner] : INK; g.fillText(t, cx, cy);
          g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        }
      } else if (sh.kind === 'combat') {
        const hot = new Set();
        const atk = e && e.attackers ? { who: e.who, list: e.attackers } : null;
        const blocks = e && e.blocks ? e.blocks : null;
        if (atk) atk.list.forEach(u => hot.add(u));
        if (blocks) blocks.forEach(([a, b]) => { hot.add(a); hot.add(b); });
        subj = drawTable(S, g, Q, { hot: [...hot], combat: true, attack: atk, blocks: blocks || [] });
      } else if (sh.kind === 'card') {
        const card = e && e.card ? cardOf(S.byId, e.card) : null;
        const [a, b] = split(Q, 0.42);
        const w = Math.min(a.w * 0.9, a.h * 0.92 / 1.4);
        subj = drawCardFace(S, g, card, a.x + (a.w - w) / 2, a.y + (a.h - w * 1.4) / 2, w);
        drawBrain(S, g, who, b, dt);
      } else if (sh.kind === 'brain') {
        subj = drawBrain(S, g, who, Q, dt);
      } else if (sh.kind === 'duo') {
        const [a, b] = split(Q, 0.5);
        drawBrain(S, g, 0, a, dt); drawBrain(S, g, 1, b, dt);
        subj = { x: Q.x + Q.w / 2, y: Q.y + Q.h / 2, w: Q.w, h: Q.h };
      } else if (sh.kind === 'values') {
        const rec = S.lastValues;
        const [a, b] = split(Q, 0.56);
        subj = drawValues(S, g, rec, a);
        drawBrain(S, g, rec ? rec.who : who, b, dt);
      }
      g.restore();
      // dip from black at the cut
      const f = smooth(tau / FADE_IN);
      if (f < 1) { g.fillStyle = `rgba(5,7,12,${1 - f})`; g.fillRect(R.x, R.y, R.w, R.h); }
      if (subj) subj = { x: cx + (subj.x - cx) * z, y: cy + (subj.y - cy) * z, w: subj.w * z, h: subj.h * z };
      return subj;
    },
    plate() { return plateFor(dir.shot, this.snapshot()); },
  };
}

// ----------------------------------------------------------- the 3D shot names
// The old 3D show mapped each director shot kind to a scene shot. The
// reel below has its own shot list; SHOT_3D and camShot stay for the 2D
// director kinds (tests/hero3d.test.mjs reads them).
export const SHOT_3D = { table: 'wide', duo: 'wide', values: 'over', brain: 'over', card: 'close', combat: 'combat', win: 'win' };
const CLOSE_S = 1.5;
export function camShot(shot, now = 0) {
  if (!shot) return ['wide', 0];
  let s = SHOT_3D[shot.kind] || 'wide';
  if (s === 'close' && !(shot.event && now - (shot.event.at ?? -1e9) <= CLOSE_S)) s = 'over';
  return [s, shot.who === 1 ? 1 : 0];
}

// ----------------------------------------------------------- the reel plan
// The 3D saver does not film a match live. It plays the whole match first
// (a few ms per decision, in slices of a frame budget), then planReel()
// cuts it like a highlight reel:
//   intro    cold open on the crowd, the deck reveal (key cards fanned),
//            the shuffle, the opening hands
//   play     only the turns with the best moments (scoreRecord). Turns
//            between them are skipped at a cut (the table snaps to the
//            next kept turn, the plate names the skipped turns). Weak
//            moves in a kept turn play fast, big plays at normal speed.
//            The attack (or spell) that ends the match plays in slow
//            motion up to the win.
//   outro    the victory pose of the winner, the slump of the loser, then
//            a title card (winner, deck, turns, value curve).
// Shots cut every REEL.MIN to REEL.MAX seconds, on events where there are
// events: a cast card, the mana taps, an attack, a block, a big hit on the
// life die, deaths, the crowd, a dopamine burst in the brain. With no
// event, a filler shot from a seeded bag. Each run differs: the seed sets
// the decks, the intro, the option picked for each event and the bag.
//
// Times. An item is one step of the reel: an intro or outro shot, or one
// record of the match. A record plays at a speed profile [[sceneT,
// speed]...]; its real length is realAt(profile, total) plus a hold. A cut
// is (item, offset in real seconds), so the runtime follows the plan also
// when frames are late.
export const REEL = {
  MIN: 5, MAX: 12, PRE: 0.5,
  FAST: 2.4, MED: 1.5, NORMAL: 1, SLOW: 0.42, SLOW_MIN: 0.22,
  STRONG: 4, DEAD: 2.5,
};
// The medium of each reel shot: 'scene' is a shot of the scene director
// (scene.shoot), 'rig' a camera path of ui/fly3d/reel.js.
export const REEL_SHOTS = {
  cold: 'rig', decks: 'rig', shuffle: 'rig', hands: 'rig',
  wide: 'scene', over: 'scene', combat: 'scene',
  brain: 'rig', duo: 'rig', card: 'rig', mana: 'rig', d20: 'rig', dolly: 'rig', crane: 'rig', crowd: 'rig',
  lethal: 'rig', victory: 'rig', slump: 'rig', recap: 'rig',
};
export const FILLER = ['wide', 'duo', 'crane', 'over', 'crowd', 'mana', 'd20', 'brain'];
const ANCHOR_PRI = { cold: 10, decks: 10, shuffle: 10, hands: 10, recap: 10, lethal: 9, victory: 8, slump: 7 };
const NOT_LETHAL = new Set(['decked', 'turn cap']);

// Two different deck ids from the pool (all colours), by rng.
export function pickDeckPair(rng, ids) {
  const pool = ids && ids.length ? ids : ['amber', 'moss'];
  const a = pool[Math.floor(rng() * pool.length) % pool.length];
  let b = a;
  for (let k = 0; k < 16 && pool.length > 1 && b === a; k++) b = pool[Math.floor(rng() * pool.length) % pool.length];
  return [a, b];
}

// Seconds of the reel for one match. seconds: the time the shell gives the
// page (opts.seconds); the first match fits in it.
export function reelBudget(seconds, first = true) {
  const s = +seconds;
  if (first && Number.isFinite(s) && s > 0) return clamp(s - 2, 45, 300);
  return 150;
}

// The intro items, from their own rng stream (the runtime plays them while
// the match is still in the simulator).
export function introItems(seed, budget, first = true) {
  const rng = mulberry32(((seed >>> 0) ^ 0x1a7d0) >>> 0);
  const L = (a, b) => +(a + (b - a) * rng()).toFixed(2);
  const short = budget < 80;
  const out = [];
  const cold = first || rng() < 0.5;
  if (cold) out.push({ kind: 'intro', name: 'cold', len: short ? 5.2 : L(6, 8), p: 0, variant: rng() });
  out.push({ kind: 'intro', name: 'decks', len: short ? L(5.5, 6.5) : L(7, 9), p: 0, variant: rng() });
  if (!short) out.push({ kind: 'intro', name: 'shuffle', len: L(5, 6.5), p: rng() < 0.5 ? 0 : 1, variant: rng() });
  out.push({ kind: 'intro', name: 'hands', len: short ? 5.2 : L(5.2, 7), p: rng() < 0.5 ? 0 : 1, variant: rng() });
  return out;
}

const manaOf = c => { if (!c || !c.cost) return 0; let n = 0; for (const v of Object.values(c.cost)) n += +v || 0; return n; };
const lethalEnd = A => !!(A && A.result && A.result.winner >= 0 && !NOT_LETHAL.has(A.result.reason));

// How much one record is worth showing. tags: what happens in it.
export function scoreRecord(rec, byId, burstAt = Infinity) {
  const out = { score: 0, tags: [], dmg: 0, deaths: 0, mv: 0, lethal: false, burst: false };
  if (!rec || !rec.action || !rec.before || !rec.after) return out;
  const a = rec.action, who = rec.who === 1 ? 1 : 0, opp = 1 - who, B = rec.before, A = rec.after;
  const life = st => st.players.map(p => p.life);
  const lb = life(B), la = life(A);
  out.dmg = Math.max(0, lb[opp] - la[opp]) + Math.max(0, lb[who] - la[who]);
  const crit = st => new Set(st.players.flatMap(p => (p.battlefield || []).filter(x => (cardOf(byId, x.id) || {}).type !== 'land').map(x => x.uid)));
  const ca = crit(A); out.deaths = [...crit(B)].filter(u => !ca.has(u)).length;
  out.lethal = lethalEnd(A);
  let s = 0;
  if (a.type === 'cast') {
    const c = cardOf(byId, a.card); out.mv = manaOf(c);
    if (c && c.type === 'creature') { s += 1.5 + 0.6 * out.mv; out.tags.push('creature'); } else { s += 2.5 + 0.4 * out.mv; out.tags.push('spell'); }
  } else if (a.type === 'land') { s += 0.3; out.tags.push('land'); }
  else if (a.type === 'attack' && a.attackers && a.attackers.length) { s += 2 + 0.5 * a.attackers.length; out.tags.push('attack'); }
  else if (a.type === 'block' && a.blocks && a.blocks.length) { s += 2.5 + a.blocks.length; out.tags.push('block'); }
  s += 1.2 * out.dmg + 2.5 * out.deaths;
  if (rec.delta != null && Number.isFinite(rec.delta) && Math.abs(rec.delta) >= burstAt) { s += 2; out.burst = true; out.tags.push('burst'); }
  if (out.lethal) { s += 100; out.tags.push('lethal'); }
  out.score = +s.toFixed(3);
  return out;
}

// Real seconds at scene time s of a record with speed profile prof.
export function realAt(prof, s) {
  let r = 0;
  for (let k = 0; k < prof.length; k++) {
    const a = prof[k][0], b = k + 1 < prof.length ? prof[k + 1][0] : Infinity;
    if (s <= a) break;
    r += (Math.min(s, b) - a) / prof[k][1];
  }
  return r;
}
export function speedAt(prof, s) {
  let v = prof.length ? prof[0][1] : 1;
  for (const [a, sp] of prof) if (s >= a) v = sp;
  return v;
}

// |delta| that counts as a burst in this match: the top eighth of the fly
// decisions, and at least 1e-4 (V has no fixed scale).
function burstBar(recs) {
  const d = recs.filter(r => r.trace && r.delta != null && Number.isFinite(r.delta)).map(r => Math.abs(r.delta)).sort((x, y) => y - x);
  if (d.length < 6) return Infinity;
  return Math.max(1e-4, d[Math.floor(d.length / 8)]);
}

// The reel of one match. o = { recs, byId, seed, calm, budget, intro,
// reduced, choreo }. choreo(rec, { reduced }) -> { steps, total } is
// ui/fly3d/choreo.js choreograph (the scene plays the same steps).
export function planReel(o) {
  const recs = o.recs || [], byId = o.byId, calm = clamp(o.calm ?? 0.7, 0, 1);
  const seed = (o.seed >>> 0) || 1, budget = o.budget ?? 150;
  const rng = mulberry32((seed ^ 0x9e11) >>> 0);
  const choreo = o.choreo || choreograph;
  const intro = (o.intro || introItems(seed, budget, true)).map(x => ({ ...x, hold: 0 }));
  const bar = burstBar(recs);
  const NORMAL = REEL.NORMAL * (1.05 - 0.15 * calm);
  // ---- each record: steps, score, speed profile, real length
  const R = recs.map((rec, i) => {
    let plan;
    try { plan = choreo(rec, { reduced: !!o.reduced }); } catch { plan = { steps: [], total: 1 }; }
    const sc = scoreRecord(rec, byId, bar);
    const total = Math.max(0.05, plan.total || 0.05);
    const prof = sc.score >= REEL.STRONG ? [[0, NORMAL]] : sc.score >= 1.5 ? [[0, REEL.MED]] : [[0, REEL.FAST]];
    return { i, rec, plan, sc, prof, total, dur: 0, hold: sc.score >= REEL.STRONG && !sc.lethal ? 0.35 : 0, turn: rec.before ? rec.before.turn : 0 };
  });
  // The end in slow motion: from the key step (the attack, or the cast
  // that kills) to the win step. When the last record is a block, the
  // attack record before it leads in: the slow part starts at its attack.
  const fin = R[R.length - 1];
  let lead = null, keyAt = null;
  if (fin && fin.sc.lethal) {
    const st = fin.plan.steps, win = st.find(x => x.op === 'win');
    const a1 = win ? win.at : fin.total;
    const prev = R[R.length - 2];
    if (fin.rec.action.type === 'block' && prev && prev.rec.action.type === 'attack' && prev.turn === fin.turn) {
      lead = prev;
      const at = (prev.plan.steps.find(x => x.op === 'attack') || { at: 0 }).at;
      const a0 = Math.max(0, at - 0.1), leadSpan = prev.total - a0;
      const span = Math.max(0.1, leadSpan + a1);
      let slow = Math.min(REEL.SLOW, span / (REEL.MIN + 1));
      slow = Math.max(slow, span / 16, REEL.SLOW_MIN);
      prev.prof = [[0, NORMAL], [a0, slow]];
      fin.prof = [[0, slow], [a1, NORMAL]];
      keyAt = { r: prev, at: a0 };
      prev.hold = 0;
    } else {
      const key = st.find(x => x.op === 'attack') || st.find(x => x.op === 'lift') || st.find(x => x.op === 'strike' || x.op === 'spark' || x.op === 'life');
      const a0 = key ? Math.max(0, key.at - 0.1) : 0;
      const span = Math.max(0.1, a1 - a0);
      let slow = Math.min(REEL.SLOW, span / (REEL.MIN + 1));
      slow = Math.max(slow, span / 16, REEL.SLOW_MIN);
      fin.prof = a0 > 0 ? [[0, NORMAL], [a0, slow], [a1, NORMAL]] : [[0, slow], [a1, NORMAL]];
      keyAt = { r: fin, at: a0 };
    }
  }
  for (const r of R) r.dur = realAt(r.prof, r.total);
  // ---- turns: keep the best ones inside the play budget
  const turns = [];
  for (const r of R) { const last = turns[turns.length - 1]; if (last && last.turn === r.turn) last.recs.push(r); else turns.push({ turn: r.turn, recs: [r] }); }
  for (const t of turns) {
    t.dur = t.recs.reduce((s, r) => s + r.dur + r.hold, 0);
    t.score = t.recs.reduce((s, r) => s + r.sc.score, 0) + Math.max(0, ...t.recs.map(r => r.sc.score));
  }
  const victoryLen = +(6 + 2.5 * rng()).toFixed(2);
  const slumpOn = budget >= 90 && rng() < 0.8;
  const slumpLen = +(5 + 1.5 * rng()).toFixed(2);
  const recapLen = +(budget < 80 ? 7 : 9 + 2 * rng()).toFixed(2);
  const introLen = intro.reduce((s, x) => s + x.len, 0);
  const playBudget = Math.max(20, budget - introLen - victoryLen - (slumpOn ? slumpLen : 0) - recapLen);
  const keep = new Set();
  let used = 0;
  if (turns.length) { keep.add(turns.length - 1); used += turns[turns.length - 1].dur; }
  const order = turns.map((t, k) => k).filter(k => k !== turns.length - 1).sort((x, y) => turns[y].score - turns[x].score || x - y);
  for (const k of order) {
    if (turns[k].score < REEL.DEAD) break;
    if (used + turns[k].dur <= playBudget) { keep.add(k); used += turns[k].dur; }
  }
  // ---- items
  const items = intro.slice();
  let prevKept = -1;
  turns.forEach((t, k) => {
    if (!keep.has(k)) return;
    t.recs.forEach((r, j) => {
      const snap = j === 0 && r.i > 0 && prevKept !== k - 1;
      const skip = snap ? { from: turns[prevKept + 1].turn, to: turns[k - 1].turn } : null;
      items.push({ kind: 'rec', r: r.i, dur: r.dur, hold: r.hold, prof: r.prof, total: r.total, snap, skip, turn: t.turn, who: r.rec.who });
    });
    prevKept = k;
  });
  const lastRec = R[R.length - 1];
  const result = lastRec && lastRec.rec.after ? lastRec.rec.after.result || null : null;
  const winner = result ? result.winner : -1;
  const vItem = { kind: 'outro', name: 'victory', len: 0, hold: 0, p: winner };
  // the victory shot starts at the win step; the outro item holds the rest
  items.push(vItem);
  if (slumpOn && winner >= 0) items.push({ kind: 'outro', name: 'slump', len: slumpLen, hold: 0, p: 1 - winner, variant: rng() });
  items.push({ kind: 'outro', name: 'recap', len: recapLen, hold: 0, p: Math.max(0, winner) });
  const lenOf = it => (it.kind === 'rec' ? it.dur : it.len) + (it.hold || 0);
  const times = () => { let t = 0; for (const it of items) { it.t0 = t; t += lenOf(it); } return t; };
  // ---- marks (events) and anchors (forced cuts), as (item, offset)
  const marks = [], anchors = [];
  const A = (item, off, kind, extra = {}) => anchors.push({ item, off, kind, pri: kind ? ANCHOR_PRI[kind] || 5 : 0, ...extra });
  let firstRec = -1, winMark = null;
  items.forEach((it, idx) => {
    if (it.kind === 'intro') A(idx, 0, it.name, { who: it.p, variant: it.variant });
    if (it.kind !== 'rec') return;
    if (firstRec < 0) { firstRec = idx; A(idx, 0, null, { who: it.who }); } else if (it.snap) A(idx, 0, null, { who: it.who, skip: it.skip });
    const r = R[it.r], rec = r.rec, who = rec.who === 1 ? 1 : 0;
    const off = s => realAt(it.prof, s.at);
    const M = (s, pri, opts, extra = {}) => marks.push({ item: idx, off: off(s), pri, opts, who, rec: it.r, ...extra });
    const strong = r.sc.score >= 3;
    let tapped = false, deaths = 0;
    const nDeaths = r.plan.steps.filter(s => s.op === 'die').length;
    for (const s of r.plan.steps) {
      switch (s.op) {
        case 'think': if (strong && !s.bot) M(s, r.sc.burst ? 5 : 2, ['brain', 'duo', 'over'], { delta: rec.delta }); break;
        case 'lift': if (rec.action.type === 'cast') { const c = cardOf(byId, s.card); M(s, manaOf(c) >= 4 ? 4 : 3, ['card', 'over'], { info: { card: s.card, uid: (r.plan.steps.find(x => x.op === 'cast' && x.card === s.card) || {}).uid ?? null } }); } break;
        case 'tap': if (!tapped && rec.action.type === 'cast') { tapped = true; M(s, (s.of | 0) >= 3 ? 3 : 2, ['mana', 'card']); } break;
        case 'attack':
          if (keyAt && keyAt.r === r) A(idx, Math.max(0, off(s) - 0.4), 'lethal', { who, info: { uids: s.uids } });
          else M(s, s.uids.length >= 2 ? 5 : 4, ['dolly', 'combat'], { info: { uids: s.uids } });
          break;
        case 'block': M(s, 5, ['combat', 'dolly'], { who: s.p }); break;
        case 'life': if (s.to < s.from) { const n = s.from - s.to; if (n >= 3 || r.sc.lethal) M(s, r.sc.lethal ? 6 : n >= 5 ? 5 : 4, ['d20', 'crowd'], { who: s.p, info: { life: s.to } }); } break;
        case 'die': deaths++; if (deaths === 1) M(s, nDeaths >= 2 ? 5 : 3, ['crowd', 'wide']); break;
        case 'hold': if (s.reason === 'hit' || s.reason === 'deaths' || s.reason === 'lethal') M(s, 5, ['crowd', 'crane']); break;
        case 'win': winMark = { item: idx, off: Math.max(0, off(s) - 0.2) }; break;
        default: break;
      }
    }
    // a lethal cast (no attack step): the lethal cut at the key step
    if (keyAt && keyAt.r === r && !r.plan.steps.some(x => x.op === 'attack')) A(idx, Math.max(0, realAt(it.prof, keyAt.at) - 0.4), 'lethal', { who });
  });
  // the victory shot: from the win step (or the victory item) on
  const vIdx = items.indexOf(vItem);
  const setVictory = () => {
    times();
    const last = items[vIdx - 1];
    const tw = winMark ? items[winMark.item].t0 + winMark.off : items[vIdx].t0;
    const already = last ? last.t0 + lenOf(last) - tw : 0;
    vItem.len = Math.max(0.5, victoryLen - Math.max(0, already));
  };
  setVictory();
  if (winMark) A(winMark.item, winMark.off, 'victory', { who: winner }); else A(vIdx, 0, 'victory', { who: winner });
  items.forEach((it, idx) => { if (it.kind === 'outro' && it.name !== 'victory') A(idx, 0, it.name, { who: it.p, variant: it.variant }); });
  // ---- resolve anchors closer than MIN: pad the item before, or merge
  for (let guard = 0; guard < 400; guard++) {
    times();
    for (const a of anchors) a.t = items[a.item].t0 + a.off;
    anchors.sort((x, y) => x.t - y.t || y.pri - x.pri);
    let bad = -1;
    for (let k = 1; k < anchors.length; k++) if (anchors[k].t - anchors[k - 1].t < REEL.MIN - 1e-6) { bad = k; break; }
    if (bad < 0) break;
    const a = anchors[bad - 1], b = anchors[bad];
    const gap = b.t - a.t;
    if (b.item > a.item && items[b.item - 1].kind !== 'intro') {
      items[b.item - 1].hold = (items[b.item - 1].hold || 0) + (REEL.MIN - gap) + 0.02;
      if (b.item - 1 === vIdx || b.item === vIdx) setVictory();
    } else {
      // same item: the earlier cut takes the stronger kind. The victory
      // cut moves to the start of the victory item instead.
      if (b.kind === 'victory' && b.item !== vIdx) { b.item = vIdx; b.off = 0; continue; }
      if (a.kind === 'victory' && a.item !== vIdx) { a.item = vIdx; a.off = 0; continue; }
      if (b.pri > a.pri) Object.assign(a, { kind: b.kind, pri: b.pri, who: b.who, info: b.info ?? a.info, variant: b.variant ?? a.variant });
      anchors.splice(bad, 1);
    }
  }
  const total = times();
  for (const a of anchors) a.t = items[a.item].t0 + a.off;
  for (const m of marks) m.t = items[m.item].t0 + m.off;
  marks.sort((x, y) => x.t - y.t);
  // ---- cuts: anchors, then events and fillers between them
  let bag = [];
  const nextFiller = (prev, who) => {
    const r2 = recent();
    for (let k = 0; k < 2 * FILLER.length; k++) {
      if (!bag.length) bag = shuffle(FILLER, rng);
      const f = bag.shift();
      if (f !== prev && (k > FILLER.length || !r2.includes(f))) return f;
    }
    return prev === 'wide' ? 'crane' : 'wide';
  };
  const recent = () => cuts.slice(-2).map(c => c.kind);
  const pickOpt = (m, prev) => {
    const r2 = recent();
    let ok = m.opts.filter(x => x !== prev && !r2.includes(x));
    if (!ok.length) ok = m.opts.filter(x => x !== prev);
    if (!ok.length) return null;
    return rng() < 0.68 || ok.length === 1 ? ok[0] : ok[1 + Math.floor(rng() * (ok.length - 1)) % (ok.length - 1)];
  };
  const whoAt = t => {
    let w = 0;
    for (const it of items) { if (it.t0 > t) break; if (it.kind === 'rec') w = it.who; }
    return w;
  };
  const cuts = [];
  const push = (t, kind, who, ev = null, extra = {}) => cuts.push({ t: +t.toFixed(3), kind, who: who === 1 ? 1 : who === -1 ? -1 : 0, ev, ...extra });
  for (let k = 0; k < anchors.length; k++) {
    const an = anchors[k], end = k + 1 < anchors.length ? anchors[k + 1].t : total;
    const prev = cuts.length ? cuts[cuts.length - 1].kind : null;
    if (an.kind) push(an.t, an.kind, an.who, an.kind === 'lethal' ? 'lethal' : null, { info: an.info || null, variant: an.variant ?? rng(), skip: an.skip || null });
    else {
      const m = marks.filter(x => x.t >= an.t - 0.01 && x.t <= an.t + 3).sort((x, y) => y.pri - x.pri || x.t - y.t)[0];
      const kind = m ? pickOpt(m, prev) : null;
      if (m && kind) push(an.t, kind, m.who, m.opts[0], { info: m.info || null, delta: m.delta, variant: rng(), skip: an.skip || null });
      else push(an.t, nextFiller(prev, an.who), whoAt(an.t + 0.01), null, { variant: rng(), skip: an.skip || null });
    }
    let t = an.t;
    for (let guard = 0; guard < 40; guard++) {
      const gap = end - t;
      if (gap <= REEL.MIN * 2 - 1e-6 && gap <= REEL.MAX) break;
      const lo = t + REEL.MIN, hi = Math.min(t + REEL.MAX, end - REEL.MIN);
      if (hi < lo - 1e-6) break;
      const cand = marks.filter(x => x.t - REEL.PRE >= lo - 1e-6 && x.t - REEL.PRE <= hi + 1e-6).sort((x, y) => y.pri - x.pri || x.t - y.t)[0];
      const prevK = cuts[cuts.length - 1].kind;
      const need = gap > REEL.MAX;
      if (cand && (cand.pri >= 4 || (need && cand.pri >= 2))) {
        const kind = pickOpt(cand, prevK);
        if (kind) { const ct = clamp(cand.t - REEL.PRE, lo, hi); push(ct, kind, cand.who, cand.opts[0], { info: cand.info || null, delta: cand.delta, variant: rng() }); t = ct; continue; }
      }
      if (!need) break;
      const L = REEL.MIN + (REEL.MAX - REEL.MIN) * (0.3 * calm + 0.7 * rng());
      const ct = clamp(t + L, lo, hi);
      push(ct, nextFiller(prevK), whoAt(ct), null, { variant: rng() });
      t = ct;
    }
  }
  // ---- shots: (item, offset) and length
  const shots = cuts.map((c, n) => {
    const end = n + 1 < cuts.length ? cuts[n + 1].t : total;
    let item = 0;
    // t is rounded to ms: a cut within 2 ms of an item start is at that start
    for (let j = 0; j < items.length; j++) if (items[j].t0 <= c.t + 2e-3) item = j;
    return { n: n + 1, ...c, len: +(end - c.t).toFixed(3), item, off: Math.max(0, +(c.t - items[item].t0).toFixed(3)), medium: REEL_SHOTS[c.kind] || 'scene' };
  });
  const kept = turns.filter((t, k) => keep.has(k)).map(t => t.turn);
  return {
    seed, budget, items, shots, total: +total.toFixed(3), kept, turns: turns.map(t => t.turn), skipped: turns.filter((t, k) => !keep.has(k)).map(t => t.turn),
    winner, result, bar, lenOf, marks: marks.map(m => ({ t: +m.t.toFixed(3), pri: m.pri, opts: m.opts.slice(), who: m.who, rec: m.rec })),
  };
}

// The facts of the title card at the end of a match. curve: the training
// file (data/training-curve.json) or null.
export function recapData(recs, { decks = [null, null], names = NAMES, curve = null, kinds = ['fly', 'fly'] } = {}) {
  const last = recs[recs.length - 1];
  const after = last && last.after;
  const result = after && after.result ? after.result : null;
  const w = result ? result.winner : -1;
  const series = [0, 1].map(p => recs.filter(r => r.who === p && r.value != null && Number.isFinite(r.value)).map(r => ({ x: r.before.turn, v: r.value })));
  // spread the decisions of one turn over that turn
  for (const s of series) {
    const byTurn = new Map();
    for (const q of s) byTurn.set(q.x, (byTurn.get(q.x) || 0) + 1);
    const seen = new Map();
    for (const q of s) { const n = byTurn.get(q.x), j = seen.get(q.x) || 0; seen.set(q.x, j + 1); q.x += (j + 0.5) / n; }
  }
  let train = null;
  if (curve && Array.isArray(curve.checkpoints) && w >= 0) {
    const side = w === 1 ? 'B' : 'A';
    const pts = curve.checkpoints.filter(c => c.vsRandom && Number.isFinite(c.vsRandom[side])).map(c => ({ x: c.games, v: c.vsRandom[side] }));
    if (pts.length >= 2) train = { side, pts, note: curve.meta && curve.meta.checkpointEval ? String(curve.meta.checkpointEval) : '' };
  }
  const casts = [0, 1].map(p => recs.filter(r => r.who === p && r.action && r.action.type === 'cast').length);
  let biggest = 0;
  for (const r of recs) {
    if (!r.before || !r.after) continue;
    for (let p = 0; p < 2; p++) biggest = Math.max(biggest, r.before.players[p].life - r.after.players[p].life);
  }
  return {
    winner: w, reason: result ? result.reason : 'unfinished', names: names.slice(), kinds: kinds.slice(),
    decks, turns: after ? after.turn : 0, life: after ? after.players.map(p => p.life) : [20, 20],
    series, train, casts, biggest, moves: recs.length,
  };
}

// The title card (2D canvas, CSS px). Flat fills, 1 px rules, no glow.
export function drawRecap(g, w, h, D) {
  const ink = INK, dim = DIM;
  g.fillStyle = TOKENS.panel; g.fillRect(0, 0, w, h);
  g.strokeStyle = TOKENS.hair2; g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, h - 1);
  const pad = clamp(Math.min(w, h) * 0.06, 12, 40);
  const wc = D.winner === 0 || D.winner === 1 ? SIDE_COL[D.winner] : ink;
  g.fillStyle = wc; g.fillRect(0, 0, w, Math.max(3, h * 0.012));
  const fs = clamp(Math.min(w * 0.075, h * 0.12), 18, 64);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.font = font(fs, 750); g.fillStyle = wc;
  const head = D.winner === 0 || D.winner === 1 ? `${D.names[D.winner]} wins` : 'A drawn match';
  g.fillText(fitText(g, head, w - 2 * pad), pad, pad + fs * 0.9);
  const dk = D.winner === 0 || D.winner === 1 ? D.decks[D.winner] : null;
  const loser = D.winner === 0 || D.winner === 1 ? 1 - D.winner : -1;
  g.font = font(fs * 0.36, 500); g.fillStyle = ink;
  const line1 = dk ? `${dk.name}${dk.colourNames ? ' (' + dk.colourNames + ')' : ''} · ${D.turns} turns · ${D.moves} decisions` : `${D.turns} turns · ${D.reason}`;
  g.fillText(fitText(g, line1, w - 2 * pad), pad, pad + fs * 1.5);
  g.fillStyle = dim; g.font = font(fs * 0.3, 500);
  const vs = loser >= 0 && D.decks[loser] ? `beat ${D.names[loser]} on ${D.decks[loser].name} · life ${D.life[0]} to ${D.life[1]} · biggest hit ${D.biggest}` : `life ${D.life[0]} to ${D.life[1]}`;
  g.fillText(fitText(g, vs, w - 2 * pad), pad, pad + fs * 1.95);
  // charts: side by side when wide, stacked when tall
  const top = pad + fs * 2.35, R0 = { x: pad, y: top, w: w - 2 * pad, h: h - top - pad };
  if (R0.h < 40) return;
  const parts = D.train ? split(R0, 0.55, pad) : [R0];
  chart(g, parts[0], D.series.map((s, p) => ({ pts: s, col: SIDE_COL[p] })), {
    title: 'V(s) of each chosen move, this match (model value, learned weights)',
    xl: 'turn', fmt: v => v.toFixed(2),
  });
  if (D.train && parts[1]) {
    chart(g, parts[1], [{ pts: D.train.pts, col: SIDE_COL[D.train.side === 'B' ? 1 : 0] }], {
      title: `${D.names[D.train.side === 'B' ? 1 : 0]}: win rate vs a random player during training (measured)`,
      xl: 'training games', lo: 0, hi: 1, fmt: v => `${Math.round(v * 100)}%`, ref: 0.5,
    });
  }
}

// A line chart with crisp 1 px axes. series: [{ pts: [{x, v}], col }].
function chart(g, R, series, o = {}) {
  const fs = clamp(R.h * 0.075, 9, 15);
  g.font = font(fs, 600); g.fillStyle = INK2; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(fitText(g, o.title || '', R.w), R.x, R.y + fs);
  const P = { x: R.x + fs * 3.2, y: R.y + fs * 1.8, w: R.w - fs * 3.4, h: R.h - fs * 3.6 };
  if (P.w < 20 || P.h < 20) return;
  const all = series.flatMap(s => s.pts);
  if (!all.length) { g.fillStyle = DIM; g.fillText('no values', P.x, P.y + P.h / 2); return; }
  const x0 = Math.min(...all.map(q => q.x)), x1 = Math.max(...all.map(q => q.x), x0 + 1e-6);
  let lo = o.lo ?? Math.min(...all.map(q => q.v)), hi = o.hi ?? Math.max(...all.map(q => q.v));
  if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
  const X = x => P.x + ((x - x0) / (x1 - x0 || 1)) * P.w, Y = v => P.y + P.h - ((v - lo) / (hi - lo)) * P.h;
  g.strokeStyle = TOKENS.hair2; g.lineWidth = 1;
  g.beginPath(); g.moveTo(P.x + 0.5, P.y); g.lineTo(P.x + 0.5, P.y + P.h + 0.5); g.lineTo(P.x + P.w, P.y + P.h + 0.5); g.stroke();
  if (o.ref != null && o.ref > lo && o.ref < hi) { g.strokeStyle = TOKENS.hair; g.beginPath(); g.moveTo(P.x, Y(o.ref)); g.lineTo(P.x + P.w, Y(o.ref)); g.stroke(); }
  if (lo < 0 && hi > 0 && o.ref == null) { g.strokeStyle = TOKENS.hair; g.beginPath(); g.moveTo(P.x, Y(0)); g.lineTo(P.x + P.w, Y(0)); g.stroke(); }
  g.fillStyle = DIM; g.font = font(fs * 0.85, 500); g.textAlign = 'right'; g.textBaseline = 'middle';
  const fmt = o.fmt || (v => v.toFixed(2));
  g.fillText(fmt(hi), P.x - 4, P.y); g.fillText(fmt(lo), P.x - 4, P.y + P.h);
  g.textAlign = 'center'; g.textBaseline = 'top';
  g.fillText(o.xl || '', P.x + P.w / 2, P.y + P.h + 4);
  for (const s of series) {
    if (!s.pts.length) continue;
    g.strokeStyle = s.col; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath(); s.pts.forEach((q, k) => (k ? g.lineTo(X(q.x), Y(q.v)) : g.moveTo(X(q.x), Y(q.v)))); g.stroke();
    const q = s.pts[s.pts.length - 1];
    g.fillStyle = s.col; g.fillRect(X(q.x) - 3, Y(q.v) - 3, 6, 6);
  }
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

// The shell poster for a reel shot. snap = { life, turn, kc, trained,
// kinds, wiring, decks: [{ name }], card, skip, over, delta }.
const RULE_TEX = ['\\Delta w_{ij} = -\\eta\\,\\mathrm{DAN}_{c(j)}\\,e_i', "\\delta = r + \\gamma\\,V(s') - V(s)"];
const RULE_COL = [['\\Delta w_{ij}', 'm1'], ['\\eta', 'm3'], ['\\mathrm{DAN}_{c(j)}', 'm2'], ['e_i', 'm4'], ['\\delta', 'm2'], ['V', 'm5'], ['\\gamma', 'm3']];
const RULE_EQ = ['Δw_ij = −η · DAN_c(j) · e_i', 'δ = r + γ·V(s′) − V(s)'];
export function reelPlate(shot, snap = {}) {
  const life = snap.life || ['?', '?'], who = shot && (shot.who === 0 || shot.who === 1) ? shot.who : 0;
  const name = NAMES[who], other = NAMES[1 - who];
  const dk = snap.decks || [];
  const dn = p => (dk[p] && dk[p].name) || 'its deck';
  const sub = `${NAMES[0]} ${life[0]} life · ${NAMES[1]} ${life[1]} life · turn ${snap.turn ?? '?'}`;
  const k = shot ? shot.kind : 'wide', info = (shot && shot.info) || {};
  let title, first = null;
  switch (k) {
    case 'cold': title = 'Two model fly brains at the feature table'; first = 'A cut of a real match between the two model flies'; break;
    case 'decks': title = `${dn(0)} vs ${dn(1)}`; first = `${NAMES[0]} plays ${dn(0)}, ${NAMES[1]} plays ${dn(1)} (random decks from all five colours)`; break;
    case 'shuffle': title = 'Forty cards each, shuffled'; break;
    case 'hands': title = `${name} looks at its opening hand`; break;
    case 'brain': title = `${name}: Kenyon cells fire, dopamine teaches`; if (shot.delta != null && Number.isFinite(shot.delta)) first = `${shot.delta > 0 ? 'PAM (reward)' : 'PPL1 (punishment)'} signal of this move: δ = ${shot.delta.toFixed(3)}`; break;
    case 'duo': title = 'Two mushroom bodies, one duel'; break;
    case 'card': title = snap.card ? `${name} casts ${snap.card.name}` : `${name} casts a card`; if (snap.card && snap.card.text) first = snap.card.text; break;
    case 'mana': title = `${name} taps its lands for mana`; break;
    case 'd20': title = info.life != null ? `${name} drops to ${info.life} life` : `${name} keeps life on a d20`; break;
    case 'dolly': case 'combat': title = shot.ev === 'block' ? `${name} blocks` : `${name} attacks`; break;
    case 'lethal': title = `${name} attacks for the win`; first = 'Slow motion'; break;
    case 'crowd': title = 'The crowd reacts'; break;
    case 'victory': title = shot.who === 0 || shot.who === 1 ? `${name} wins` : 'A drawn match'; if (snap.over && snap.over.reason) first = `The match ends: ${snap.over.reason}`; break;
    case 'slump': title = `${name} is out`; first = `${other} takes the match`; break;
    case 'recap': title = snap.over && snap.over.winner >= 0 ? `${NAMES[snap.over.winner]} wins on ${dn(snap.over.winner)}` : 'The match is a draw'; break;
    case 'crane': case 'wide': case 'over': default: title = `Turn ${snap.turn ?? '?'}: ${name} to act`; break;
  }
  const lines = [];
  if (snap.skip) lines.push(snap.skip.from === snap.skip.to ? `Turn ${snap.skip.from} skipped: no big plays` : `Turns ${snap.skip.from} to ${snap.skip.to} skipped: no big plays`);
  else if (first) lines.push(first);
  const wr = snap.wiring || [];
  lines.push(`${NAMES[0]} ${wr[0] || 'hemibrain'} · ${NAMES[1]} ${wr[1] || wr[0] || 'hemibrain'} mushroom body wiring: models, not real flies`);
  const kc = snap.kc || [];
  if (kc.some(Boolean)) {
    const part = i => kc[i] ? `${NAMES[i]} ${pctOf(kc[i].on, kc[i].live)} of ${kc[i].live}` : `${NAMES[i]} n/a`;
    lines.push(`Active Kenyon cells: ${part(0)} · ${part(1)}`);
  }
  const kinds = snap.kinds || ['fly', 'fly'];
  lines.push(kinds.some(x => x !== 'fly') ? 'A fly model did not load: the greedy bot stands in'
    : `${dn(0)} vs ${dn(1)} · ${snap.trained ? 'pretrained weights, learning off' : 'untrained weights'}`);
  return { title, sub, lines: lines.slice(0, 4), tex: RULE_TEX.slice(), rules: RULE_COL.map(r => r.slice()), eq: RULE_EQ.slice() };
}

// ----------------------------------------------------------- the reel runtime
// env = { rules, byId, flies, bots, trained, seed, calm, scene, kit, wiring,
// deckIds, DECKS, curve, seconds, reduced, sliceMs }. scene: createDuelScene;
// kit: createReelKit of ui/fly3d/reel.js (null: every shot is a scene shot).
const CROWD_ON = { cold: ['lean', 0.7], crowd: ['buzz', 1], victory: ['cheer', 1], lethal: ['lean', 0.9], d20: ['gasp', 0.6] };
export function createReel3d(env) {
  const calm = clamp(env.calm ?? 0.7, 0, 1);
  const seed0 = (env.seed >>> 0) || 1;
  const scene = env.scene, kit = env.kit || null;
  const kinds = ['fly', 'fly'];
  const agents = agentsOf(env, kinds);
  const deckIds = env.deckIds && env.deckIds.length ? env.deckIds : ['amber', 'moss'];
  const DECKS = env.DECKS || {};
  const sliceMs = env.sliceMs ?? 6;
  const perf = () => (globalThis.performance && performance.now()) || Date.now();
  scene.setCamera?.('script');
  scene.setBrains?.(true);
  let now = 0, games = 0, gen = 0;
  let G = null, nextG = null;        // the game on screen and the next one in the simulator
  let shotN = 0, lastShot = null, cheerAt = 0;

  function deckSpec(id, p) {
    const d = DECKS[id] || { name: id, colours: [], list: [] };
    const cols = (d.colours || [d.colour]).filter(Boolean);
    const cards = (d.list || []).map(([cid]) => cardOf(env.byId, cid)).filter(c => c && c.type !== 'land')
      .sort((a, b) => manaOf(b) - manaOf(a) || (b.type === 'creature') - (a.type === 'creature'));
    const seen = new Set(), top = [];
    for (const c of cards) if (!seen.has(c.id)) { seen.add(c.id); top.push(c); if (top.length === 5) break; }
    const colourHex = c => colourInfo(c).hex;
    return { id, name: d.name || id, who: p, flyName: NAMES[p], colours: cols.map(colourHex), colourNames: cols.map(c => c[0].toUpperCase() + c.slice(1)).join(', '), cards: top.reverse() };
  }
  function newGame(k) {
    const s = (Math.imul(seed0, 2654435761) + k * 0x9e3779b9) >>> 0 || 1;
    const rng = mulberry32(s ^ 0xdec5);
    const decks = pickDeckPair(rng, deckIds);
    const m = new Match(env.rules, agents, { seed: s, decks, names: NAMES });
    const budget = reelBudget(env.seconds, k === 0);
    return { k, seed: s, m, decks, specs: decks.map(deckSpec), init: m.state, done: false, err: null, budget, intro: introItems(s, budget, k === 0), plan: null };
  }
  function simulate(g, ms) {
    if (!g || g.done) return;
    const t0 = perf();
    try {
      do { const r = g.m.next(); if (!r || g.m.over()) { g.done = true; break; } } while (perf() - t0 < ms);
    } catch (e) { g.err = e; g.done = true; }
    if (g.done && !g.plan) {
      if (g.err || !g.m.history.length) { g.plan = null; return; }
      g.plan = planReel({ recs: g.m.history, byId: env.byId, seed: g.seed, calm, budget: g.budget, intro: g.intro, reduced: !!env.reduced });
      g.recap = recapData(g.m.history, { decks: g.specs, curve: env.curve, kinds });
    }
  }
  const emptyHands = st => ({ ...st, players: st.players.map(p => ({ ...p, hand: [], library: [...p.hand, ...p.library] })) });
  // cursor: item k of the game, local real time, scene time of a record
  const C = { k: 0, local: 0, recS: 0, done: false, started: false, shot: 0 };
  function itemsOf(g) { return g.plan ? g.plan.items : g.intro; }
  function shotsOf(g) {
    if (g.plan) return g.plan.shots;
    return g.intro.map((it, i) => ({ n: i + 1, kind: it.name, who: it.p, item: i, off: 0, len: it.len, medium: 'rig', variant: it.variant }));
  }
  function begin(g) {
    G = g; games++; gen++;
    Object.assign(C, { k: 0, local: 0, recS: 0, done: false, started: false, shot: 0 });
    lastBy = [null, null]; skip = null;
    scene.setSpeed?.(1);
    scene.setState(emptyHands(g.init));
  }
  let lastBy = [null, null], skip = null;
  function startItem(it) {
    C.local = 0; C.recS = 0; C.done = false; C.started = true;
    if (it.kind === 'intro') {
      if (it.name === 'hands') scene.setState(G.init);
      scene.setSpeed?.(1);
    } else if (it.kind === 'rec') {
      const rec = G.m.history[it.r];
      skip = it.snap ? it.skip : skip;
      if (rec.trace) lastBy[rec.who] = rec;
      scene.setSpeed?.(speedAt(it.prof, 0));
      const g0 = gen;
      scene.play(rec).then(() => { if (g0 === gen) C.done = true; }, () => { if (g0 === gen) C.done = true; });
    } else {
      scene.setSpeed?.(1);
    }
  }
  function cutTo(sh) {
    shotN++; lastShot = { ...sh, at: now, game: G.k };
    const med = kit ? sh.medium || REEL_SHOTS[sh.kind] || 'scene' : 'scene';
    kit?.clearOverlay();
    kit?.shuffle(sh.kind === 'shuffle');
    if (med === 'scene') {
      kit?.release();
      const k = REEL_SHOTS[sh.kind] === 'scene' ? sh.kind : 'wide';
      scene.shoot?.(k, sh.who === 1 ? 1 : 0, { cut: true });
    } else {
      // the scene director holds a wide shot under the rig
      scene.shoot?.('wide', 0);
      kit.rig(sh.kind, sh.who, { len: sh.len, info: sh.info, variant: sh.variant });
      if (sh.kind === 'decks') kit.fan(G.specs);
      if (sh.kind === 'recap' && G.recap) { const D = G.recap; kit.title((g, w, h) => drawRecap(g, w, h, D)); }
    }
    const cr = CROWD_ON[sh.kind];
    if (cr) { scene.world?.hall?.react?.(cr[0], { side: sh.who, strength: cr[1] }); cheerAt = now; }
    if (sh.skip) skip = sh.skip; else if (sh.kind !== 'wide' && sh.kind !== 'crane') skip = null;
  }
  begin(newGame(0));

  return {
    scene, kit,
    get games() { return games; },
    get now() { return now; },
    get game() { return G; },
    get shot() { return lastShot; },
    get cursor() { return { ...C }; },
    update(dt) {
      now += dt;
      // the simulator: the game on screen first, then the next one
      if (!G.done) simulate(G, sliceMs);
      else if (G.done && !G.plan) { begin(newGame(G.k + 1)); }
      else if (!nextG) nextG = newGame(G.k + 1);
      else simulate(nextG, sliceMs * 0.5);
      const items = itemsOf(G);
      let it = items[C.k];
      if (it && !C.started) startItem(it);
      // cuts at (item, offset)
      const shots = shotsOf(G);
      while (C.shot < shots.length && (shots[C.shot].item < C.k || (shots[C.shot].item === C.k && C.local >= shots[C.shot].off - 1e-9))) cutTo(shots[C.shot++]);
      C.local += dt;
      if (it && it.kind === 'rec') {
        C.recS += dt * speedAt(it.prof, C.recS);
        scene.setSpeed?.(C.done ? 1 : speedAt(it.prof, C.recS));
      }
      // the end of the item
      if (it) {
        const len = it.kind === 'rec' ? it.dur + (it.hold || 0) : it.len + (it.hold || 0);
        let end = C.local >= len - 1e-9;
        if (it.kind === 'rec') end = (end && C.done) || C.local > len + 25;
        // the intro waits for the plan at the end of the hands shot
        if (end && it.kind === 'intro' && C.k === items.length - 1 && !G.plan) end = !!G.done;
        if (end) { C.k++; C.started = false; it = items[C.k]; if (it) startItem(it); }
      }
      if (!items[C.k] && G.plan) {
        // the reel of this game is over: the next game
        const g = nextG && nextG.k === G.k + 1 ? nextG : newGame(G.k + 1);
        nextG = null;
        begin(g);
      }
      // a running cheer on the victory shot
      if (lastShot && lastShot.kind === 'victory' && now - cheerAt > 1.7) { scene.world?.hall?.react?.('cheer', { side: lastShot.who, strength: 0.9 }); cheerAt = now; }
      kit?.update(dt);
      scene.render(dt);
      return lastShot;
    },
    snapshot() {
      const mir = scene.world?.mirror;
      const st = mir || G.init;
      const kc = [0, 1].map(i => { const t = lastBy[i] && lastBy[i].trace; return t ? { on: (t.kc || []).length, live: t.kcLive || 0 } : null; });
      const card = lastShot && lastShot.info && lastShot.info.card ? cardOf(env.byId, lastShot.info.card) : null;
      const over = lastShot && (lastShot.kind === 'victory' || lastShot.kind === 'slump' || lastShot.kind === 'recap') && G.plan ? G.plan.result : null;
      return { life: st.players.map(p => p.life), turn: st.turn, kc, trained: !!env.trained, kinds, wiring: env.wiring, decks: G.specs, card, skip, over };
    },
    plate() { return reelPlate(lastShot, this.snapshot()); },
    state() {
      return {
        n: shotN, kind: lastShot && lastShot.kind, len: lastShot && +lastShot.len.toFixed(2), game: G.k, item: C.k,
        items: itemsOf(G).length, planned: !!G.plan, decks: G.decks.slice(), kept: G.plan ? G.plan.kept : null,
      };
    },
    resize() { scene.resize(); },
    dispose() { gen++; try { kit?.dispose(); } catch { /* gone */ } try { scene.dispose(); } catch { /* gone */ } },
  };
}

// ----------------------------------------------------------- the hook
const PLATE_EVERY = 1, BAND_EVERY = 0.25;
const win = () => /** @type {any} */ (window);   // page globals: __fdSaver, flyDuel, snSaver
let run = null;

function enter(o = {}) {
  if (run) exit();
  const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
  const seed = (o.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0) || 1;
  const label = typeof o.label === 'function' ? o.label : null;
  const css = document.createElement('style');
  css.textContent = 'html,body{overflow:hidden!important}body>*:not(#fdSaverCv){visibility:hidden!important}'
    + `#fdSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none;background:${BG}}`;
  document.head.appendChild(css);
  const cv = document.createElement('canvas'); cv.id = 'fdSaverCv';
  document.body.appendChild(cv);
  win().__fdSaver = true;
  const me = run = { cv, css, raf: 0, show: null, err: null, last: 0, band: null, bandAt: -1e9, bandShot: -1, plateAt: -1e9, plateShot: -1, subj: null };
  const fd = win().flyDuel;
  // 3D when main.js gives makeScene3d. The canvas then must not get a 2D
  // context before the scene takes it, so the loading frames stay blank.
  me.try3d = !!(fd && fd.makeScene3d);
  Promise.resolve(fd && fd.ready).then(async () => {
    if (run !== me) return;
    if (!fd || !fd.M || !fd.M.rules) throw new Error('the rules engine did not load');
    const M = fd.M, D = fd.D || {};
    const byId = M.cards && M.cards.CARD ? new Map(Object.entries(M.cards.CARD)) : new Map([...(M.cards?.CARDS || []), ...(M.cards?.TOKENS || [])].map(c => [c.id, c]));
    const flies = [fd.makeFly ? fd.makeFly('A') : null, fd.makeFly ? fd.makeFly('B') : null];
    let trained = false;
    try { trained = !!(fd.heroFlies && fd.heroFlies().trained); } catch { trained = false; }
    const WN = { hemibrain: 'hemibrain', flywire: 'FlyWire' };
    const wiring = ['A', 'B'].map(k => { const id = D.pretrained?.wiring?.[k]?.id; return id ? (WN[id] || id) : null; });
    const deckIds = (M.cards?.DECK_ORDER || Object.keys(M.cards?.DECKS || {})).filter(id => M.cards?.DECKS?.[id]);
    let scene = null, kit = null;
    if (me.try3d) { try { scene = await fd.makeScene3d(cv); } catch (e) { scene = null; } }
    if (scene) {
      // the reel kit (rig shots, deck fans, riffle, title card)
      const mm = q => (typeof matchMedia === 'function' ? matchMedia(q).matches : false);
      try { const R = await import('./ui/fly3d/reel.js'); kit = R.createReelKit(scene, { coarse: mm('(pointer: coarse)'), reduced: mm('(prefers-reduced-motion: reduce)') }); } catch (e) { console.warn('fly-duel saver: the reel kit did not load, scene shots only', e); kit = null; }
    }
    if (run !== me) { try { kit && kit.dispose(); scene && scene.dispose(); } catch { /* gone */ } return; }
    if (scene) {
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      me.show = createReel3d({ rules: M.rules, byId, flies, bots: M.bots, trained, seed, calm, scene, kit, wiring, deckIds, DECKS: M.cards?.DECKS, curve: D.curve || null, seconds: o.seconds, reduced });
      me.mode = '3d';
      return;
    }
    me.try3d = false; me.mode = '2d';
    me.show = createShow({
      rules: M.rules, byId, connectome: D.connectome, flies, bots: M.bots, trained, seed, calm, wiring, deckIds,
      connectomes: fd.conOf ? [fd.conOf('A'), fd.conOf('B')] : null,
      makeCanvas: () => document.createElement('canvas'),
      makeImage: src => { const im = new Image(); im.decoding = 'async'; im.src = src; return im; },
      dpr: Math.min(2, window.devicePixelRatio || 1),
    });
  }).catch(e => { if (run === me) { me.err = String(e && e.message || e); me.try3d = false; } });

  let g = null;
  const frame = t => {
    if (run !== me) return;
    const dt = Math.min(0.05, me.last ? (t - me.last) / 1000 : 0.016); me.last = t;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
    const show = me.show;
    if (me.try3d) {
      // 3D: the scene owns the canvas and its size
      if (show) {
        if (me.w !== w || me.h !== h) { me.w = w; me.h = h; show.resize(); }
        bandOf(show.state().n, show.now, w, h);
        show.kit?.frame(me.band, w, h);
        try { show.update(dt); } catch (e) { console.error('fly-duel saver 3d', e); }
        me.subj = show.kit ? show.kit.subject(w, h) : { x: w / 2, y: h / 2, w: w * 0.6, h: h * 0.6 };
        plateOf(show, show.state().n, show.now);
      }
      me.raf = requestAnimationFrame(frame);
      return;
    }
    if (!g) g = cv.getContext('2d');
    if (!g) { me.raf = requestAnimationFrame(frame); return; }   // a GL context holds the canvas
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = BG; g.fillRect(0, 0, w, h);
    if (!show) {
      g.fillStyle = DIM; g.font = font(14); g.textAlign = 'center';
      g.fillText(me.err ? `The duel cannot start: ${me.err}` : 'Loading the flies…', w / 2, h / 2);
      g.textAlign = 'left';
      me.raf = requestAnimationFrame(frame);
      return;
    }
    show.S.dpr = dpr;
    try { show.update(dt); } catch (e) { console.error('fly-duel saver', e); }
    const sh = show.dir.shot, n = sh ? sh.n : 0;
    bandOf(n, show.now, w, h);
    const B = me.band;
    const bw = B ? B.w : w, bt = B ? B.t : 0, bb = B ? B.b : 0;
    const side = Math.max(16, bw * 0.03);
    const R = { x: (w - bw) / 2 + side, y: bt + 8, w: bw - 2 * side, h: Math.max(h * 0.3, h - bt - bb - 16) };
    try { me.subj = show.draw(g, R, dt); } catch (e) { console.error('fly-duel saver draw', e); }
    if (sh) plateOf(show, n, show.now);
    me.raf = requestAnimationFrame(frame);
  };
  // The clear band of the plate: held for a shot, it only grows.
  const bandOf = (n, now, w, h) => {
    if (!label || !(now - me.bandAt >= BAND_EVERY || me.bandShot !== n)) return;
    me.bandAt = now;
    const pb = plateBand(h);
    if (pb) {
      const grow = me.band && me.bandShot === n;
      const t = grow ? Math.max(me.band.t, pb.t) : pb.t, b = grow ? Math.max(me.band.b, pb.b) : pb.b;
      const bw = Math.min(w, grow ? Math.min(me.band.w, pb.w) : pb.w);
      me.band = { t, b, w: bw };
    }
    me.bandShot = n;
  };
  // The plate: new at a cut, refreshed each PLATE_EVERY for the live numbers.
  const plateOf = (show, n, now) => {
    if (!label || !n || (me.plateShot === n && now - me.plateAt < PLATE_EVERY)) return;
    me.plateAt = now; me.plateShot = n;
    try {
      label({ ...show.plate(), anchor: () => (run === me && me.subj ? { x: me.subj.x, y: me.subj.y, w: me.subj.w, h: me.subj.h, lead: false } : null) });
    } catch (e) { /* the plate is optional */ }
  };
  me.raf = requestAnimationFrame(frame);
  return { canvas: cv, warmupMs: 1200 };
}

function exit() {
  if (!run) return;
  cancelAnimationFrame(run.raf);
  if (run.mode === '3d' && run.show) {
    run.show.dispose();
    // free the GL context now, not at garbage collection (Safari)
    try { run.cv.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* no context */ }
  }
  run.cv.remove(); run.css.remove();
  run = null; win().__fdSaver = false;
  // the page views redraw on a resize event
  try { window.dispatchEvent(new Event('resize')); } catch { /* no window events */ }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  win().snSaver = {
    enter, exit,
    // The director state, for a probe: shot kind, length, game, item.
    debug: () => {
      if (!run || !run.show) return { loading: !!run, err: run && run.err };
      const s = run.show;
      const st = run.mode === '3d' ? s.state() : s.dir.state();
      return { games: s.games, now: +s.now.toFixed(2), mode: run.mode, ...st, band: run.band, camera: run.mode === '3d' ? s.scene.stats().shot : null, rig: run.mode === '3d' && s.kit ? s.kit.shot.kind : null };
    },
  };
}
