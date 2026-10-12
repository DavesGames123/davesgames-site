// ============================================================================
//  FLY DUEL 3D  ·  real games at the side tables  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  The other tables of the convention hall (ui/fly3d/hall.js) play real
//  games of our card game. User words (2026-10-11, verbatim): "can we have
//  flies aroudn them play magic the gathering as well instead of the
//  simulated cheapened backgroudn versions?" and "can we make sure we have
//  the boxes for the other decks and they actually switch between decks at
//  random between games?"
//
//  Games. Each side table runs its own game through game/rules.js
//  (newGame, legalActions, step, isOver). The players are the bots of
//  game/bots.js: greedy against greedy on the even tables, greedy against
//  random on the odd tables. Each table has its own seed. A table takes
//  one action every SIDE.pace seconds (slower than the feature match).
//  At the end of a game: a short hold (the winner cheers, the loser
//  slumps), a pack-up (all cards go back to the library), a shuffle, and
//  a new game. Each player then takes a new random deck from all 13
//  decks (seeded, never the deck of the last game, so the pair of decks
//  always changes). The deck box changes at the pack-up.
//
//  Budget. update() steps the games in a time slice in the main thread
//  (no worker): at most one action per table per frame, and no new action
//  when the slice (SIDE.budgetMs) is used. One decision of the greedy
//  bot takes 0.15 ms on average. A table that is out of the camera view
//  does not step, and no table steps while the document is hidden.
//
//  Look. All cards of all side tables are one InstancedMesh: a plane per
//  card with an instance attribute uvRect that picks a cell of one shared
//  atlas. The atlas has every card face (drawCard of ui/cardface.js at
//  64 x 90 px, 46 x 64 on a phone), the card back, a card edge cell, the
//  life numbers 0..40 and one deck box face per deck. Piles, deck boxes
//  and life cubes are a second InstancedMesh of unit boxes on the same
//  atlas. So the side tables add two draw calls. Seat-space layout as on
//  the feature table: lands in one stack per colour set (mana.js
//  stackLayout), creatures in a row, tapped cards turned, attackers
//  pushed forward for a moment, the library and the graveyard as piles,
//  the hand as a small fan in the hand of the fly (faces to the fly,
//  backs to the hall), a life cube.
//
//  The side flies (the 'extras' FlyHerd of hall.js) move from the real
//  actions: a reach and place for a land or a cast (a tap first when
//  the cast taps lands), a push for an attack, a guard for blocks, a nod
//  for a pass, a cheer or a slump at the end, a shuffle before a game.
//  The other fly watches. A fly with cards in hand holds the fan.
//
//  API
//      SIDE                                       numbers (pace, budget, sizes)
//      sideAtlas({ coarse })                      { canvas, texture, cells,
//                                                   keys, rect(key), cellOf(key), refresh() }
//      drawDeckBoxFace(g, w, h, deckId, { edge, label })  one box face
//      deckHexes(deckId)                          colour hexes of a deck
//      createSideGames({ tables, herd, seats, coarse, reduced, seed,
//                        layout }) -> { group, games, atlas, update(dt, time),
//                        setCamera(camera), cardsOn(t), stats(), dispose() }
//      tables: [{ x, y, z, yaw }]; seats: [{ i, table, side }] (side +1 is
//      player 0, side -1 is player 1).
//
//  GREP MAP
//      grep -n 'export const SIDE'            numbers
//      grep -n 'export function deckHexes'    deck colours
//      grep -n 'export function drawDeckBoxFace'  deck box print
//      grep -n 'export function sideAtlas'    the shared atlas
//      grep -n 'function atlasMaterial'       uvRect shader patch
//      grep -n 'function nextDecks'           new decks per game
//      grep -n 'function layoutTable'         cards of one table -> places
//      grep -n 'function flyMotion'           action -> fly gesture
//      grep -n 'export function createSideGames'  assembly and update
// ============================================================================
import * as THREE from 'three';
import { newGame, legalActions, step, isOver, actionKey } from '../../game/rules.js';
import { greedyBot, randomBot } from '../../game/bots.js';
import { CARDS, TOKENS as TOKEN_CARDS, CARD, DECKS, DECK_ORDER } from '../../game/cards.js';
import { drawCard, cardBack, colourInfo, getCardArt, loadCardArt } from '../cardface.js';
import { stackLayout } from './mana.js';
import { SANS } from '../tokens.js';

export const SIDE = {
  pace: [1.1, 1.9],     // seconds from one action to the next, per table
  budgetMs: 1,          // time slice for the game steps in one update
  endHold: 2.6, pack: 1.6, shuffle: 1.1,   // seconds between two games
  cardW: 0.5, cardH: 0.7,
  cell: [[64, 90], [46, 64]],             // atlas cell: desktop, phone
  cols: 16,
  lifeMax: 40,
  perTable: 96,         // card instances per table at most
  // seat space (u across, v from the centre line toward the seat)
  creatureV: 1.2, landV: 2.15, attackV: 0.55,
  libU: 2.35, libV: 1.35, graveU: 2.35, graveV: 0.45,
  boxU: 2.95, boxV: 1.35, lifeU: -2.6, lifeV: 1.2,
  handU: 0.25, handV: 3.2, handY: 0.7, handR: 0.42,
};

const TAU = Math.PI * 2;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

// ------------------------------------------------------------ deck boxes
export function deckHexes(deckId) {
  return (DECKS[deckId]?.colours || []).map(k => colourInfo(k).hex);
}

// One deck box face (our own design): a dark box, one colour band per
// deck colour across the top and the bottom, a lid seam, the deck name
// and a window with the deck colours in stripes. edge: an outline colour
// (the seat colour on the feature table), label: a small line at the foot.
export function drawDeckBoxFace(g, w, h, deckId, { edge = null, label = '' } = {}) {
  const cols = deckId ? deckHexes(deckId) : [];
  const bands = cols.length ? cols : [edge || '#5a6070'];
  g.fillStyle = '#171a22'; g.fillRect(0, 0, w, h);
  const band = Math.max(3, Math.round(h * 0.09)), bw = w / bands.length;
  bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * bw, 0, Math.ceil(bw), band); g.fillRect(i * bw, h - band, Math.ceil(bw), band); });
  const lid = Math.round(h * 0.24);
  g.fillStyle = '#05060a'; g.fillRect(0, lid, w, Math.max(1, Math.round(h / 90)));
  // the window: diagonal stripes in the deck colours
  const pad = Math.round(w * 0.14), wy = lid + Math.round(h * 0.07), wh = Math.round(h * 0.34);
  g.save(); g.beginPath(); g.rect(pad, wy, w - 2 * pad, wh); g.clip();
  const sw = Math.max(3, w / 7);
  for (let k = -8; k < 16; k++) { g.fillStyle = bands[((k % bands.length) + bands.length) % bands.length]; g.beginPath(); g.moveTo(pad + k * sw, wy + wh); g.lineTo(pad + (k + 1) * sw, wy + wh); g.lineTo(pad + (k + 1) * sw + wh, wy); g.lineTo(pad + k * sw + wh, wy); g.closePath(); g.fill(); }
  g.restore();
  g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(pad - 0.5, wy - 0.5, w - 2 * pad + 1, wh + 1);
  // the deck name, in two lines when long
  const name = deckId ? (DECKS[deckId]?.name || deckId) : label;
  g.fillStyle = '#eef0f5'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const words = String(name).toUpperCase().split(' ');
  const fs = Math.max(6, Math.round(w / 7.5));
  g.font = `800 ${fs}px ${SANS}`;
  const lines = words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : words;
  const y0 = wy + wh + (h - band - wy - wh) / 2 - (lines.length - 1) * fs * 0.55;
  lines.forEach((ln, i) => g.fillText(ln, w / 2, y0 + i * fs * 1.1, w - 4));
  if (label && deckId) { g.fillStyle = edge || '#9aa0b0'; g.font = `700 ${Math.max(5, Math.round(w / 11))}px ${SANS}`; g.fillText(label, w / 2, h - band - fs * 0.5, w - 4); }
  if (edge) { const lw = Math.max(2, Math.round(w / 24)); g.strokeStyle = edge; g.lineWidth = lw; g.strokeRect(lw / 2, lw / 2, w - lw, h - lw); }
}

// ------------------------------------------------------------ the atlas
// Cells, in order: every card of game/cards.js (CARDS and TOKENS), the
// card back, the card edge, life 0..lifeMax, one box face per deck.
export function sideAtlas({ coarse = false } = {}) {
  const [cw, ch] = SIDE.cell[coarse ? 1 : 0];
  const keys = [...CARDS.map(c => c.id), ...TOKEN_CARDS.map(c => c.id), 'back', 'edge'];
  for (let n = 0; n <= SIDE.lifeMax; n++) keys.push('life:' + n);
  for (const d of DECK_ORDER) keys.push('box:' + d);
  const cells = new Map(keys.map((k, i) => [k, i]));
  const cols = SIDE.cols, rows = Math.ceil(keys.length / cols);
  const W = cols * cw, H = rows * ch;
  const canvas = makeCanvas(W, H);
  const g = canvas?.getContext ? canvas.getContext('2d') : null;
  const texture = g ? new THREE.CanvasTexture(canvas) : null;
  if (texture) { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; }
  const hasArt = new Set();
  const cellXY = i => [(i % cols) * cw, Math.floor(i / cols) * ch];
  function paint(key) {
    if (!g) return;
    const i = cells.get(key); if (i == null) return;
    const [x, y] = cellXY(i);
    g.save(); g.beginPath(); g.rect(x, y, cw, ch); g.clip();
    g.fillStyle = '#0b0d12'; g.fillRect(x, y, cw, ch);
    try {
      if (key === 'back') cardBack(g, { w: cw, h: ch, x, y });
      else if (key === 'edge') {
        g.fillStyle = '#e6dfcf'; g.fillRect(x, y, cw, ch);
        g.fillStyle = '#bdb4a0'; for (let k = 2; k < ch; k += 3) g.fillRect(x, y + k, cw, 1);
      } else if (key.startsWith('life:')) {
        g.fillStyle = '#20232c'; g.fillRect(x, y, cw, ch);
        g.strokeStyle = '#c9a45a'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, cw - 4, ch - 4);
        g.fillStyle = '#f3f1ea'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `800 ${Math.round(cw * 0.55)}px ${SANS}`; g.fillText(key.slice(5), x + cw / 2, y + ch / 2, cw - 6);
      } else if (key.startsWith('box:')) {
        g.translate(x, y); drawDeckBoxFace(g, cw, ch, key.slice(4));
      } else {
        const art = getCardArt(key, { small: true });
        if (art) hasArt.add(key);
        drawCard(g, CARD[key], { w: cw, h: ch, x, y, mode: 'thumb', art });
      }
    } catch { /* a stub context in a test */ }
    g.restore();
  }
  if (g) for (const k of keys) paint(k);
  if (texture) texture.needsUpdate = true;
  const asked = new Set();
  return {
    canvas, texture, cells, keys, cols, rows, cw, ch, W, H,
    cellOf: key => cells.get(key) ?? cells.get('back'),
    // uv rect [x, y, w, h] of a cell, inset by half a pixel (flipY on)
    rect(key, out = [0, 0, 0, 0]) {
      const [x, y] = cellXY(this.cellOf(key));
      out[0] = (x + 0.5) / W; out[1] = 1 - (y + ch - 0.5) / H; out[2] = (cw - 1) / W; out[3] = (ch - 1) / H;
      return out;
    },
    // ask for the picture of a card on a table (browser only); refresh()
    // draws the cells again whose picture is now in the cache
    want(id) {
      if (!g || asked.has(id) || !CARD[id] || typeof fetch !== 'function') return;
      asked.add(id); loadCardArt(id, { small: true }).catch(() => {});
    },
    refresh() {
      if (!g) return 0;
      let n = 0;
      for (const id of asked) if (!hasArt.has(id) && getCardArt(id, { small: true })) { paint(id); n++; }
      if (n && texture) texture.needsUpdate = true;
      return n;
    },
    dispose() { texture?.dispose(); },
  };
}

// MeshStandardMaterial with an instance attribute uvRect (vec4: x, y, w,
// h in atlas uv): the map uv of each instance is uv * rect.zw + rect.xy.
function atlasMaterial(map, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: map || null, color: map ? 0xffffff : 0xd8d0bc, roughness: 0.7, ...opts });
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec4 uvRect;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vMapUv * uvRect.zw + uvRect.xy;\n#endif');
  };
  m.customProgramCacheKey = () => 'side-atlas-uvrect';
  return m;
}

// ------------------------------------------------------------ the games
// New decks for a game: each player takes a random deck that is not the
// deck of the last game. Thus the pair always changes.
function nextDecks(prev, R) {
  return [0, 1].map(p => {
    const pool = DECK_ORDER.filter(d => d !== prev?.[p]);
    return pool[Math.floor(R() * pool.length)];
  });
}

// Fly gesture from one action. Returns { kind, dur }.
function flyMotion(action, taps) {
  switch (action.type) {
    case 'land': return { kind: 'place', dur: 0.8 };
    case 'cast': return { kind: taps ? 'cast' : 'place', dur: taps ? 1.1 : 0.8 };
    case 'attack': return { kind: action.attackers.length ? 'push' : 'nod', dur: 0.9 };
    case 'block': return { kind: action.blocks.length ? 'guard' : 'nod', dur: 0.8 };
    default: return { kind: 'nod', dur: 0.6 };
  }
}

// Places of all cards of one table for this state. Returns a list of
// { key, id, zone, p, u, y, v, pitch, roll, back } in seat space, and the
// boxes: piles, deck boxes and life cubes.
function layoutTable(G) {
  const S = SIDE, cards = [], boxes = [];
  const st = G.state, gk = G.games;
  const packing = G.phase === 'pack' || G.phase === 'shuffle';
  for (let p = 0; p < 2; p++) {
    const P = st.players[p];
    const libN = packing ? 40 : P.library.length;
    const flat = (key, id, zone, u, v, y, roll = 0, back = false) => cards.push({ key, id, zone, p, u, v, y, pitch: -Math.PI / 2, roll, back });
    if (packing) {
      // every card back on the library: one pile, the top is a back
    } else {
      // hand: a fan, the faces to the fly
      const n = P.hand.length, seen = {};
      P.hand.forEach((id, k) => {
        const c = seen[id] = (seen[id] || 0) + 1;
        const f = n > 1 ? (k / (n - 1) - 0.5) * Math.min(1.1, n * 0.16) : 0;
        cards.push({ key: `g${gk}h${p}:${id}:${c}`, id, zone: 'hand', p, u: S.handU + Math.sin(f) * S.handR, v: S.handV + k * 0.004, y: S.handY + (Math.cos(f) - 1) * S.handR, pitch: -0.35, roll: -f, back: false, fan: true });
      });
      // battlefield: lands in stacks, creatures in a row
      const lands = P.battlefield.filter(x => CARD[x.id]?.type === 'land');
      const lay = stackLayout(lands, { half: 1.75, gap: 0.62 });
      for (const x of lands) {
        const a = lay.at.get(x.uid); if (!a) continue;
        flat(`g${gk}u${x.uid}`, x.id, 'land', a.u, S.landV + a.dv, 0.004 + a.dy, x.tapped ? -Math.PI / 2 : 0);
      }
      const cr = P.battlefield.filter(x => CARD[x.id]?.type !== 'land');
      const step = cr.length > 1 ? Math.min(0.6, 3.5 / (cr.length - 1)) : 0;
      cr.forEach((x, k) => {
        const lunge = G.lunge.get(x.uid) > G.clockT || st.combat?.attackers?.includes(x.uid);
        flat(`g${gk}u${x.uid}`, x.id, 'creature', -step * (cr.length - 1) / 2 + k * step, lunge ? S.attackV : S.creatureV, 0.004, x.tapped ? -Math.PI / 2 : 0);
      });
      // graveyard top
      const gt = P.graveyard[P.graveyard.length - 1];
      if (gt) flat(`g${gk}gy${p}:${P.graveyard.length}`, gt, 'grave', S.graveU, S.graveV, 0.004 + P.graveyard.length * 0.0035);
      if (P.graveyard.length > 1) boxes.push({ cell: 'edge', p, u: S.graveU, v: S.graveV, y: 0, sx: S.cardW, sy: (P.graveyard.length - 1) * 0.0035, sz: S.cardH });
    }
    // library pile with a back on top
    if (libN > 0) {
      boxes.push({ cell: 'edge', p, u: S.libU, v: S.libV, y: 0, sx: S.cardW, sy: Math.max(0.002, libN * 0.0035), sz: S.cardH });
      flat(`lib${p}`, 'back', 'library', S.libU, S.libV, libN * 0.0035 + 0.002, 0, true);
    }
    // deck box beside the library, life cube
    boxes.push({ cell: 'box:' + G.boxDeck[p], p, u: S.boxU, v: S.boxV, y: 0, sx: 0.36, sy: 0.52, sz: 0.3, deck: G.boxDeck[p] });
    const life = Math.max(0, Math.min(S.lifeMax, P.life | 0));
    boxes.push({ cell: 'life:' + life, p, u: S.lifeU, v: S.lifeV, y: 0, sx: 0.26, sy: 0.26, sz: 0.26, life });
  }
  return { cards, boxes };
}

export function createSideGames({ tables, herd, seats, coarse = false, reduced = false, seed = 7, layout }) {
  const S = SIDE, L = layout;
  const group = new THREE.Group(); group.name = 'side-games';
  const atlas = sideAtlas({ coarse });
  const cardGeo = new THREE.PlaneGeometry(S.cardW, S.cardH);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cardMat = atlasMaterial(atlas.texture, { side: THREE.FrontSide });
  const boxMat = atlasMaterial(atlas.texture, { roughness: 0.6 });
  const nCards = Math.max(1, tables.length * S.perTable), nBoxes = Math.max(1, tables.length * 12);
  const cardMesh = new THREE.InstancedMesh(cardGeo, cardMat, nCards); cardMesh.name = 'side-cards';
  const boxMesh = new THREE.InstancedMesh(boxGeo, boxMat, nBoxes); boxMesh.name = 'side-boxes';
  const cardUV = new THREE.InstancedBufferAttribute(new Float32Array(nCards * 4), 4);
  const boxUV = new THREE.InstancedBufferAttribute(new Float32Array(nBoxes * 4), 4);
  cardGeo.setAttribute('uvRect', cardUV); boxGeo.setAttribute('uvRect', boxUV);
  for (const m of [cardMesh, boxMesh]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.count = 0; group.add(m); }

  // per table
  const games = tables.map((T, t) => {
    const R = rng((seed * 7919 + t * 104729 + 13) >>> 0);
    const kinds = t % 2 === 0 ? ['greedy', 'greedy'] : (R() < 0.5 ? ['greedy', 'random'] : ['random', 'greedy']);
    const bots = kinds.map(k => (k === 'greedy' ? greedyBot() : randomBot(rng((seed * 31 + t * 977 + 5) >>> 0))));
    const decks = nextDecks(null, R);
    const G = {
      t, T, R, kinds, bots, decks, boxDeck: decks.slice(), games: 0, phase: 'play',
      clock: 0.5 + R() * S.pace[1], clockT: 0, actions: 0, gameSeed: 0, state: null,
      trace: [], last: null, history: [], lunge: new Map(), visible: true, cost: 0.2,
      flies: [0, 1].map(p => seats.find(s => s.table === t && s.side === (p === 0 ? 1 : -1))?.i ?? -1),
      motion: [null, null], view: new Map(), boxes: [],
    };
    start(G);
    return G;
  });

  function start(G) {
    G.gameSeed = (Math.floor(G.R() * 2 ** 31) ^ (G.t * 2654435761)) >>> 0;
    G.state = newGame({ seed: G.gameSeed, decks: G.decks.slice(), first: G.games % 2, log: true });
    G.trace = []; G.phase = 'play'; G.lunge.clear();
  }
  function act(G) {
    const s = G.state, legal = legalActions(s), p = s.toAct;
    const a = G.bots[p](s, legal);
    G.state = step(s, a);
    G.actions++;
    G.trace.push(actionKey(a));
    const taps = (G.state.events || []).filter(e => e.t === 'tap' && e.p === p).length;
    const m = flyMotion(a, taps);
    G.motion[p] = { ...m, t: 0 };
    G.motion[1 - p] = { kind: 'watch', dur: m.dur, t: 0 };
    if (a.type === 'attack') for (const u of a.attackers) G.lunge.set(u, G.clockT + 0.9);
    G.last = a;
    if (isOver(G.state)) {
      const r = G.state.result;
      G.history.push({ seed: G.gameSeed, decks: G.decks.slice(), first: G.games % 2, result: r, actions: G.trace.slice(), turn: G.state.turn });
      if (G.history.length > 8) G.history.shift();
      G.phase = 'end'; G.clock = S.endHold;
      for (let q = 0; q < 2; q++) G.motion[q] = { kind: r.winner === q ? 'cheer' : r.winner < 0 ? 'nod' : 'slump', dur: S.endHold, t: 0 };
    } else G.clock = S.pace[0] + G.R() * (S.pace[1] - S.pace[0]) + (a.type === 'cast' ? 0.4 : 0);
  }
  // phase clock outside play: end -> pack -> shuffle -> new game
  function between(G, dt) {
    G.clock -= dt;
    if (G.phase === 'pack' && G.clock < S.pack / 2 && G.boxDeck.join() !== G.decks.join()) G.boxDeck = G.decks.slice();
    if (G.clock > 0) return;
    if (G.phase === 'end') {
      G.phase = 'pack'; G.clock = S.pack;
      G.decks = nextDecks(G.decks, G.R);
      for (let q = 0; q < 2; q++) G.motion[q] = { kind: 'gather', dur: S.pack, t: 0 };
    } else if (G.phase === 'pack') {
      G.phase = 'shuffle'; G.clock = S.shuffle;
      for (let q = 0; q < 2; q++) G.motion[q] = { kind: 'shuffle', dur: S.shuffle, t: 0 };
    } else if (G.phase === 'shuffle') {
      G.games++; start(G); G.clock = 0.6;
    }
  }

  // ---- camera view: which tables to step (set from the hall floor)
  let camera = null, seenAt = -1, clock = 0;
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 5.5);
  function setCamera(cam) { camera = cam; seenAt = clock; }
  function viewCheck() {
    if (!camera) { for (const G of games) G.visible = true; return true; }
    if (clock - seenAt > 0.5) { for (const G of games) G.visible = false; return false; }   // the hall is not drawn
    camera.updateMatrixWorld?.();
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    for (const G of games) { sphere.center.set(G.T.x, G.T.y, G.T.z); G.visible = frustum.intersectsSphere(sphere); }
    return true;
  }

  // ---- seat space -> world for table T and player p
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
  const qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  function world(T, p, u, y, v, out) {
    const lx = p === 0 ? u : -u, lz = p === 0 ? v : -v, c = Math.cos(T.yaw), s = Math.sin(T.yaw);
    return out.set(T.x + c * lx + s * lz, T.y + y, T.z - s * lx + c * lz);
  }
  const seatYaw = (T, p) => T.yaw + (p === 0 ? 0 : Math.PI);

  // view objects: key -> { id, x, y, z, pitch, roll, back, tgt }
  const rect = [0, 0, 0, 0];
  function updateViews(G, dt) {
    const { cards, boxes } = layoutTable(G);
    G.boxes = boxes;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 7);
    const keep = new Set(cards.map(c => c.key));
    // cards that leave: in a pack-up they go to the library first; else
    // they go now, and a new card with the same id starts where they were
    // (hand -> table, table -> graveyard)
    const gone = new Map();
    for (const [key, o] of G.view) {
      if (keep.has(key)) continue;
      if (G.phase === 'pack') {
        if (!o.leaving) { o.leaving = true; o.tgt = world(G.T, o.c.p, S.libU, 0.15, S.libV, new THREE.Vector3()); o.c = { ...o.c, pitch: -Math.PI / 2, roll: 0, back: true, fan: false }; }
        continue;
      }
      if (!o.leaving && o.c.id !== 'back') gone.set(o.c.id + ':' + o.c.p, o);
      G.view.delete(key);
    }
    for (const c of cards) {
      let o = G.view.get(c.key);
      const tgtPos = world(G.T, c.p, c.u, c.y, c.v, new THREE.Vector3());
      if (!o) {
        const was = gone.get(c.id + ':' + c.p);
        // else a new card starts where it comes from: the library (a draw)
        // or the hand (a land, a cast, a discard)
        const from = was ? was.pos.clone()
          : c.zone === 'hand' ? world(G.T, c.p, S.libU, 0.1, S.libV, new THREE.Vector3())
          : c.zone === 'library' ? tgtPos.clone()
          : world(G.T, c.p, S.handU, S.handY, S.handV, new THREE.Vector3());
        o = { pos: from, pitch: was ? was.pitch : c.pitch, roll: was ? was.roll : c.roll };
        G.view.set(c.key, o);
        if (c.id !== 'back') atlas.want(c.id);
      }
      o.c = c; o.tgt = tgtPos;
    }
    for (const o of G.view.values()) {
      o.pos.lerp(o.tgt, k);
      o.pitch += (o.c.pitch - o.pitch) * k; o.roll += (o.c.roll - o.roll) * k;
    }
  }

  function writeMeshes() {
    let ci = 0, bi = 0;
    for (const G of games) {
      const yawOf = p => seatYaw(G.T, p);
      let n = 0;
      for (const o of G.view.values()) {
        if (n >= S.perTable || ci >= nCards) break;
        const c = o.c;
        _q.setFromEuler(_e.set(o.pitch, yawOf(c.p), o.roll, 'YXZ'));
        _m.compose(o.pos, _q, _s.set(1, 1, 1)); cardMesh.setMatrixAt(ci, _m);
        atlas.rect(c.back ? 'back' : c.id, rect); cardUV.setXYZW(ci, rect[0], rect[1], rect[2], rect[3]);
        o.inst = ci; ci++; n++;
        if (c.fan && ci < nCards) {
          // the back of a hand card, to the hall
          _q.multiply(qFlip);
          _v.set(0, 0, -0.003).applyQuaternion(_q);
          _m.compose(_v.add(o.pos), _q, _s.set(1, 1, 1)); cardMesh.setMatrixAt(ci, _m);
          atlas.rect('back', rect); cardUV.setXYZW(ci, rect[0], rect[1], rect[2], rect[3]);
          ci++; n++;
        }
      }
      for (const b of G.boxes) {
        if (bi >= nBoxes) break;
        world(G.T, b.p, b.u, b.y + b.sy / 2, b.v, _v);
        _q.setFromEuler(_e.set(0, yawOf(b.p), 0));
        _m.compose(_v, _q, _s.set(b.sx, b.sy, b.sz)); boxMesh.setMatrixAt(bi, _m);
        atlas.rect(b.cell, rect); boxUV.setXYZW(bi, rect[0], rect[1], rect[2], rect[3]);
        b.inst = bi; bi++;
      }
    }
    cardMesh.count = ci; boxMesh.count = bi;
    cardMesh.instanceMatrix.needsUpdate = true; boxMesh.instanceMatrix.needsUpdate = true;
    cardUV.needsUpdate = true; boxUV.needsUpdate = true;
  }

  // ---- the side flies
  function poseFlies(G, dt, time) {
    for (let p = 0; p < 2; p++) {
      const i = G.flies[p]; if (i < 0) continue;
      const P = herd.pose[i], m = G.motion[p];
      const hand = G.phase === 'play' && G.state.players[p].hand.length > 0;
      P.lean = 0.08; P.buzz = 0; P.hy = reduced ? 0 : 0.12 * Math.sin(time * 0.5 + i); P.hp = 0.4;
      P.legL = hand ? 0.38 : 0.15; P.legR = 0.15;
      if (!m) continue;
      m.t += dt;
      const u = Math.min(1, m.t / m.dur), env = reduced ? (u < 1 ? 1 : 0) : Math.sin(Math.PI * u);
      switch (m.kind) {
        case 'place': P.lean = 0.08 + 0.3 * env; P.legR = 0.15 + 0.6 * env; P.hp = 0.4 + 0.25 * env; break;
        case 'cast': {
          // a tap with the left leg, then a reach with the right
          const a = Math.min(1, u / 0.4), b = Math.max(0, (u - 0.4) / 0.6);
          if (u < 0.4) { P.legL = 0.38 + 0.35 * Math.abs(Math.sin(a * TAU)); P.lean = 0.2; }
          else { P.legR = 0.15 + 0.6 * Math.sin(Math.PI * b); P.lean = 0.08 + 0.3 * Math.sin(Math.PI * b); }
          P.hp = 0.55; break;
        }
        case 'push': P.lean = 0.08 + 0.4 * env; P.legL = P.legR = 0.15 + 0.6 * env; P.hp = 0.45; break;
        case 'guard': P.lean = 0.08 - 0.1 * env; P.legL = P.legR = 0.15 + 0.55 * env; P.hp = 0.3; break;
        case 'nod': P.hp = 0.4 + 0.2 * env; break;
        case 'watch': P.hp = 0.5; P.lean = 0.12; break;
        case 'cheer': P.legL = P.legR = 0.9 * env; P.buzz = reduced ? 0 : env; P.hp = -0.1; P.lean = 0; break;
        case 'slump': P.lean = 0.25 * env; P.hp = 0.4 + 0.45 * env; P.legL = P.legR = 0.1; break;
        case 'gather': P.lean = 0.08 + 0.25 * env; P.legL = P.legR = 0.2 + 0.4 * env; break;
        case 'shuffle': P.legL = 0.4 + (reduced ? 0 : 0.15 * Math.sin(time * 16 + i)); P.legR = 0.4 + (reduced ? 0 : 0.15 * Math.sin(time * 16 + i + Math.PI)); P.hp = 0.5; break;
        default: break;
      }
      if (m.t >= m.dur) G.motion[p] = null;
    }
  }

  let lastMs = 0, maxMs = 0, rr = 0, artTimer = 0;
  const hidden = () => typeof document !== 'undefined' && document.hidden === true;
  function update(dt, time) {
    clock += dt;
    const t0 = now();
    const drawn = viewCheck();
    if (!hidden() && drawn) {
      // game steps: one action per table at most, while the slice lasts
      let spent = 0;
      for (let k = 0; k < games.length; k++) {
        const G = games[(rr + k) % games.length];
        if (!G.visible) continue;
        G.clockT += dt;
        if (G.phase !== 'play') { between(G, dt); continue; }
        G.clock -= dt;
        if (G.clock > 0) continue;
        if (spent > 0 && spent + G.cost > S.budgetMs) continue;   // wait for the next frame
        const a0 = now();
        act(G);
        const c = now() - a0;
        G.cost = G.cost * 0.8 + c * 0.2; spent += c;
      }
      rr = (rr + 1) % Math.max(1, games.length);
    }
    for (const G of games) { updateViews(G, dt); poseFlies(G, dt, time); }
    writeMeshes();
    artTimer += dt;
    if (artTimer > 1.5) { artTimer = 0; atlas.refresh(); }
    lastMs = now() - t0; maxMs = Math.max(maxMs, lastMs);
  }

  // what the side table t shows, for tests: one entry per card instance
  function cardsOn(t) {
    const G = games[t], out = [];
    for (const o of G.view.values()) if (!o.leaving) out.push({ id: o.c.back ? 'back' : o.c.id, zone: o.c.zone, p: o.c.p, inst: o.inst, uid: o.c.key });
    return { cards: out, boxes: G.boxes.map(b => ({ ...b })) };
  }

  return {
    group, games, atlas, cardMesh, boxMesh, update, setCamera, cardsOn,
    stats: () => ({
      tables: games.length, games: games.reduce((a, G) => a + G.history.length, 0), actions: games.reduce((a, G) => a + G.actions, 0),
      cards: cardMesh.count, boxes: boxMesh.count, ms: lastMs, maxMs, drawCalls: 2,
      tris: (cardMesh.count * 2) + (boxMesh.count * 12),
    }),
    dispose() { atlas.dispose(); cardGeo.dispose(); boxGeo.dispose(); cardMat.dispose(); boxMat.dispose(); cardMesh.dispose?.(); boxMesh.dispose?.(); },
  };
}
