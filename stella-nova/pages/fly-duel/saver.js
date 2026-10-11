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
//  THE 3D SHOW. When main.js gives window.flyDuel.makeScene3d (the 3D
//  table of ui/fly3d/scene.js can start), createShow3d() films the duel
//  on that table: the same director, the same events, and SHOT_3D maps
//  each shot kind to a camera shot of the scene (camShot). The flies at
//  the table play the real match; the brain maps float beside them.
//  Without the 3D table, createShow() draws the 2D shots.
//
//  THE CARDS. Every card the 2D show draws is drawCard() of ui/cardface.js:
//  the painted plate card of the gallery and the 3D table. wantArt()
//  starts the picture load once per card. No glow: a hot card gets a hard
//  ring.
//
//  THE PLATE. plateFor() gives the shell poster: title per shot, a live
//  line (life totals, turn), KC sparsity of each fly, the weights state
//  and the honesty line (model, not a real fly). No code extract. The
//  subject sits in the clear band of the plate (plateBand from
//  ../../lib/saver-clear.js). The band holds for a shot and only grows.
//
//  GREP MAP
//      grep -n 'export const SHOT_MIN'        shot limits and priorities
//      grep -n 'export function classify'     decision record -> events
//      grep -n 'export function createDirector' shot director
//      grep -n 'export function paceFor'      seconds between decisions
//      grep -n 'export function plateFor'     shell poster for a shot
//      grep -n 'export function createShow'   match + brains + director
//      grep -n 'export function camShot'      shot kind -> 3D camera shot
//      grep -n 'export function createShow3d' the duel on the 3D table
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
import { drawCard, loadCardArt, getCardArt } from './ui/cardface.js';
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
  const newMatch = () => { games++; S.match = new Match(env.rules, agents, { seed: (rng() * 2 ** 32) >>> 0 || 1, names: NAMES }); S.last = null; S.lastBy = [null, null]; S.lastValues = null; overAt = -1; wait = 1; };
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

// ----------------------------------------------------------- the 3D show
// The saver films the 3D table of ui/fly3d/scene.js. The director above
// picks the shots from the same events. SHOT_3D gives the camera shot of
// the scene for each shot kind. A card shot is a close-up only while the
// card is still in the air (up to CLOSE_S after the cast), else the shot
// looks over the shoulder of the caster.
export const SHOT_3D = { table: 'wide', duo: 'wide', values: 'over', brain: 'over', card: 'close', combat: 'combat', win: 'win' };
const CLOSE_S = 1.5;
export function camShot(shot, now = 0) {
  if (!shot) return ['wide', 0];
  let s = SHOT_3D[shot.kind] || 'wide';
  if (s === 'close' && !(shot.event && now - (shot.event.at ?? -1e9) <= CLOSE_S)) s = 'over';
  return [s, shot.who === 1 ? 1 : 0];
}

// env = { rules, byId, flies, bots, trained, seed, calm, scene } with
// scene from createDuelScene (main.js flyDuel.makeScene3d). The scene
// plays each record; the next decision waits until the record has
// played, plus a short pause. The win event goes to the director when
// the last record has played, so the lethal attack is on screen first.
export function createShow3d(env) {
  const calm = clamp(env.calm ?? 0.7, 0, 1);
  const seed = (env.seed >>> 0) || 1;
  const rng = mulberry32(seed ^ 0xf1ead);
  const scene = env.scene;
  const S = { byId: env.byId, match: null, last: null, lastBy: [null, null], kinds: ['fly', 'fly'] };
  const agents = agentsOf(env, S.kinds);
  const dir = createDirector({ seed, calm });
  let now = 0, games = 0, busy = false, gen = 0, wait = 1, acc = 0, overAt = -1, absMean = 0, nDelta = 0, later = [];
  scene.setCamera?.('script');
  scene.setSpeed?.(1.1 - 0.4 * calm);
  scene.setBrains?.(true);
  const newMatch = () => {
    games++; gen++; busy = false; later = [];
    S.match = new Match(env.rules, agents, { seed: (rng() * 2 ** 32) >>> 0 || 1, names: NAMES });
    S.last = null; S.lastBy = [null, null]; overAt = -1; wait = 1; acc = 0;
    scene.setState(S.match.state);
  };
  newMatch();

  function decide() {
    let rec = null;
    try { rec = S.match.next(); } catch (e) { rec = null; newMatch(); return []; }
    if (!rec) return [];
    S.last = rec; S.lastBy[rec.who] = rec;
    let burstAt = Infinity;
    if (rec.delta != null && Number.isFinite(rec.delta)) {
      const d = Math.abs(rec.delta);
      if (nDelta >= 6) burstAt = Math.max(3 * absMean, 1e-4);
      nDelta++; absMean += (d - absMean) / Math.min(nDelta, 40);
    }
    const ev = classify(rec, { byId: S.byId, burstAt }).map(e => ({ ...e, at: now }));
    const over = S.match.over();
    busy = true;
    const g = gen;
    scene.play(rec).then(() => {
      if (g !== gen) return;
      busy = false; acc = 0;
      if (over) { overAt = now; later.push({ kind: 'win', pri: PRIORITY.win, who: over.winner === 1 ? 1 : 0, i: rec.i, at: now }); }
    }, () => { if (g === gen) busy = false; });
    wait = 0.25 + 0.5 * calm;
    return ev;
  }

  return {
    S, dir, scene,
    get games() { return games; },
    get now() { return now; },
    update(dt) {
      now += dt;
      let ev = later; later = [];
      if (S.match.over() && !busy) {
        const sh = dir.shot, shown = sh && sh.kind === 'win' && now - sh.t0 >= 3 + 2 * calm;
        if (shown || (overAt >= 0 && now - overAt > 16)) newMatch();
      } else if (!busy) {
        acc += dt;
        if (acc >= wait) { acc = 0; ev = ev.concat(decide()); }
      }
      const r = dir.tick(now, ev);
      if (r.changed) { const [shot, p] = camShot(r.shot, now); scene.shoot?.(shot, p); }
      scene.render(dt);
      return r;
    },
    snapshot() {
      const st = S.match.state, sh = dir.shot;
      const kc = [0, 1].map(i => { const t = S.lastBy[i] && S.lastBy[i].trace; return t ? { on: (t.kc || []).length, live: t.kcLive || 0 } : null; });
      const card = sh && sh.event && sh.event.card ? cardOf(S.byId, sh.event.card) : null;
      return { life: st.players.map(p => p.life), turn: st.turn, kc: kc.length === 2 ? kc : [], trained: !!env.trained, kinds: S.kinds, card, over: S.match.over(), wiring: env.wiring };
    },
    plate() { return plateFor(dir.shot, this.snapshot()); },
    resize() { scene.resize(); },
    dispose() { gen++; try { scene.dispose(); } catch { /* gone */ } },
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
    const M = fd.M, D = fd.D;
    const byId = M.cards && M.cards.CARD ? new Map(Object.entries(M.cards.CARD)) : new Map([...(M.cards?.CARDS || []), ...(M.cards?.TOKENS || [])].map(c => [c.id, c]));
    const flies = [fd.makeFly ? fd.makeFly('A') : null, fd.makeFly ? fd.makeFly('B') : null];
    let trained = false;
    try { trained = !!(fd.heroFlies && fd.heroFlies().trained); } catch { trained = false; }
    const WN = { hemibrain: 'hemibrain', flywire: 'FlyWire' };
    const wiring = ['A', 'B'].map(k => { const id = D.pretrained?.wiring?.[k]?.id; return id ? (WN[id] || id) : null; });
    let scene = null;
    if (me.try3d) { try { scene = await fd.makeScene3d(cv); } catch (e) { scene = null; } }
    if (run !== me) { try { scene && scene.dispose(); } catch { /* gone */ } return; }
    if (scene) {
      me.show = createShow3d({ rules: M.rules, byId, flies, bots: M.bots, trained, seed, calm, scene, wiring });
      me.mode = '3d';
      return;
    }
    me.try3d = false; me.mode = '2d';
    me.show = createShow({
      rules: M.rules, byId, connectome: D.connectome, flies, bots: M.bots, trained, seed, calm, wiring,
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
        try { show.update(dt); } catch (e) { console.error('fly-duel saver 3d', e); }
        afterShow(show, w, h, R => ({ x: R.x + R.w / 2, y: R.y + R.h / 2, w: R.w * 0.6, h: R.h * 0.6 }));
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
    afterShow(show, w, h, R => show.draw(g, R, dt));
    me.raf = requestAnimationFrame(frame);
  };
  // The clear band of the plate, the subject box (draw(R) gives it) and
  // the plate itself. One path for the 2D and the 3D show.
  const afterShow = (show, w, h, draw) => {
    const sh = show.dir.shot, n = sh ? sh.n : 0, now = show.now;
    // the clear band: held for a shot, it only grows
    if (label && (now - me.bandAt >= BAND_EVERY || me.bandShot !== n)) {
      me.bandAt = now;
      const pb = plateBand(h);
      if (pb) {
        const grow = me.band && me.bandShot === n;
        const t = grow ? Math.max(me.band.t, pb.t) : pb.t, b = grow ? Math.max(me.band.b, pb.b) : pb.b;
        const bw = Math.min(w, grow ? Math.min(me.band.w, pb.w) : pb.w);
        me.band = { t, b, w: bw };
      }
      me.bandShot = n;
    }
    const B = me.band;
    const bw = B ? B.w : w, bt = B ? B.t : 0, bb = B ? B.b : 0;
    const side = Math.max(16, bw * 0.03);
    const R = { x: (w - bw) / 2 + side, y: bt + 8, w: bw - 2 * side, h: Math.max(h * 0.3, h - bt - bb - 16) };
    try { me.subj = draw(R); } catch (e) { console.error('fly-duel saver draw', e); }
    if (label && sh && (me.plateShot !== n || now - me.plateAt >= PLATE_EVERY)) {
      me.plateAt = now; me.plateShot = n;
      try {
        label({ ...show.plate(), anchor: () => (run === me && me.subj ? { x: me.subj.x, y: me.subj.y, w: me.subj.w, h: me.subj.h, lead: false } : null) });
      } catch (e) { /* the plate is optional */ }
    }
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
    // The director state, for a probe: shot kind, length, pending event.
    debug: () => (run && run.show ? { games: run.show.games, now: +run.show.now.toFixed(2), mode: run.mode, ...run.show.dir.state(), band: run.band, camera: run.mode === '3d' ? run.show.scene.stats().shot : null } : { loading: !!run, err: run && run.err }),
  };
}
