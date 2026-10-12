// ============================================================================
//  FLY DUEL  ·  the scorecards  (ES module; the model is pure, the card is DOM)
// ----------------------------------------------------------------------------
//  One scorecard per seat. Fly A's card sits top-left, Fly B's top-right.
//  In play mode the fly's card shows its brain and your card shows you.
//  A card is a tool, not a decoration: every part is a number the player
//  needs to decide.
//
//      ┌───────────────────────────────────────────┐
//      │ [A] Fly A            hemibrain v1.2   (d20)│  name, wiring source, life
//      │ ▮▮▮ ▮▮  ▯                                  │  mana stacks by colour
//      │ hand 5   library 28   graveyard 3          │  counts
//      │ ┌ KC raster ──────────┬ MBON ┐             │  live neural panel
//      │ └─────────────────────┴ DAN ─┘             │
//      │ 1 Cast Heat Pulse at You        +0.42 ███  │  top-3 move values
//      │ 2 Play Amber Ridge              +0.31 ██   │  (while it thinks, and
//      │ 3 Move to combat                -0.05 ▏    │   after, until the next)
//      └───────────────────────────────────────────┘
//
//  Life is a d20 (an icosahedron face-on, our own drawing) with the number
//  in it: the same die the 3D table shows. Mana: one stack per colour (a
//  dual land is a split stack), one pip per land, solid = untapped, hollow
//  = tapped. In play mode a white pip is a land that the selected card
//  taps (the auto-tap preview of ui/play/model.js paidLands). Seat is never told by colour only: the letter A or B is on
//  every card.
//
//  SLIM (opts.slim, the default of watch mode and the 3D play table): the
//  card is a low strip in its corner, translucent and low in contrast,
//  with small type: letter, name, status, life, mana pips and counts on
//  one or two lines. The neural panel and the top-3 hide behind the small
//  "brain" button (setOpen). The big brain of play mode is in the 3D
//  scene (ui/fly3d/scene.js 'big brain').
//
//  The neural panel is createBrainCard() of ui/fly3d/brain3d.js when that
//  module gives it, else the 2D raster of ui/hud/raster.js. Both get the
//  trace of each decision through fire(trace).
//
//  GREP MAP
//      grep -n 'export function scorecardModel'  state -> what the card shows
//      grep -n 'export function fmtValue'        +0.42 / -0.05
//      grep -n 'export function lifeTone'        ok | low | dead
//      grep -n 'export function manaColour'      colour id -> ink
//      grep -n 'export function d20Svg'          the life die
//      grep -n 'export function createScorecard' the DOM card
// ============================================================================
import { TOKENS } from '../tokens.js';
import { createRaster } from './raster.js';

// ------------------------------------------------------------ formatting
export const fmtValue = v => (Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) : '–');
export const lifeTone = life => (life <= 0 ? 'dead' : life <= 5 ? 'low' : 'ok');
export const fmtCount = n => String(Math.max(0, n | 0));

// Ink for a mana colour. colours: an optional COLOURS table of
// game/cards.js ({ id: { ink } }). Unknown colours are --none.
export function manaColour(kind, colours = null) {
  return colours?.[kind]?.ink || TOKENS[kind] || TOKENS.none;
}

// Lands by mana kind, untapped and total. Same rule as ui/play/model.js
// manaByColour (a dual land is its own stack 'a/b'). paying: the uids of
// the lands that the selected card taps (the auto-tap preview); pay is
// their count per stack.
function manaRows(CARD, player, paying = null) {
  const pay = new Set(paying || []);
  const rows = new Map();
  for (const x of player.battlefield) {
    const c = CARD[x.id];
    if (!c || c.type !== 'land') continue;
    const colours = Array.isArray(c.mana) && c.mana.length ? c.mana : [c.produces || c.colour || 'generic'];
    const kind = colours.join('/');
    let r = rows.get(kind);
    if (!r) { r = { kind, colours: colours.slice(), up: 0, total: 0, pay: 0 }; rows.set(kind, r); }
    r.total++;
    if (!x.tapped) { r.up++; if (pay.has(x.uid)) r.pay++; }
  }
  return [...rows.values()];
}

// What one card shows. opts:
//   state, seat, CARD           the game
//   kind      'fly' | 'human' | 'bot'
//   name, letter ('A'|'B'), source (wiring, for a fly), deckName
//   top       top-3 rows from ui/play/controller.js top3()
//   thinking  true while this seat decides
//   colours   COLOURS of game/cards.js (optional)
//   paying    land uids the selected card taps (play mode preview)
export function scorecardModel(o) {
  const { state, seat, CARD } = o;
  const p = state.players[seat];
  const creatures = p.battlefield.filter(x => CARD[x.id]?.type === 'creature').length;
  const res = state.result;
  let status;
  if (res) status = res.winner < 0 ? 'Draw' : res.winner === seat ? 'Won' : 'Lost';
  else if (o.thinking) status = o.kind === 'human' ? 'Your move' : 'Thinking';
  else if (state.toAct === seat) status = o.kind === 'human' ? 'Your move' : 'To act';
  else status = state.active === seat ? 'Turn' : 'Waiting';
  const top = (o.top || []).slice(0, 3);
  const vs = top.map(t => t.value).filter(Number.isFinite);
  const lo = vs.length ? Math.min(-1, ...vs) : -1, hi = vs.length ? Math.max(1, ...vs) : 1;
  return {
    seat, letter: o.letter || (seat ? 'B' : 'A'), kind: o.kind || 'fly',
    name: o.name || (o.kind === 'human' ? 'You' : `Fly ${seat ? 'B' : 'A'}`),
    source: o.source || '', deckName: o.deckName || '',
    life: p.life, lifeText: String(p.life), tone: lifeTone(p.life),
    counts: [
      { key: 'hand', label: 'hand', short: 'H', n: p.hand.length, text: fmtCount(p.hand.length) },
      { key: 'library', label: 'library', short: 'L', n: p.library.length, text: fmtCount(p.library.length) },
      { key: 'graveyard', label: 'graveyard', short: 'G', n: p.graveyard.length, text: fmtCount(p.graveyard.length) },
      { key: 'creatures', label: 'creatures', short: 'C', n: creatures, text: fmtCount(creatures) },
    ],
    mana: manaRows(CARD, p, o.paying).map(r => ({ ...r, label: r.pay ? `${r.up - r.pay}/${r.total}` : `${r.up}/${r.total}`, inks: r.colours.map(k => manaColour(k, o.colours)) })),
    active: state.active === seat, acting: !res && state.toAct === seat,
    thinking: !!o.thinking, status,
    top: top.map((t, i) => ({ rank: i + 1, text: t.text, value: t.value, valueText: fmtValue(t.value),
      bar: Math.max(0, Math.min(1, (t.value - lo) / (hi - lo || 1))), chosen: !!t.chosen })),
  };
}

// ---------------------------------------------------------------- the d20
// The life die, face-on: an outer hexagon, the front triangle and the
// three edges to the corners. Our own drawing. size in CSS px.
export function d20Svg(n, { size = 44, tone = 'ok', accent = TOKENS.ink } = {}) {
  const s = 50, r = 46;
  const P = a => [s + r * Math.cos(a), s + r * Math.sin(a)];
  const hex = [0, 1, 2, 3, 4, 5].map(i => P(-Math.PI / 2 + i * Math.PI / 3));
  const tri = [[s, s - r * 0.56], [s - r * 0.62, s + r * 0.34], [s + r * 0.62, s + r * 0.34]];
  const pts = a => a.map(q => q.map(v => v.toFixed(1)).join(',')).join(' ');
  const ink = tone === 'low' || tone === 'dead' ? TOKENS.dmg : accent;
  const edges = [[tri[0], hex[0]], [tri[1], hex[4]], [tri[2], hex[2]], [tri[1], hex[3]], [tri[2], hex[3]], [tri[0], hex[5]], [tri[0], hex[1]], [tri[1], hex[5]], [tri[2], hex[1]]];
  const fs = String(n).length > 2 ? 26 : 32;
  return `<svg class="hd-d20" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="life ${n}">`
    + `<polygon points="${pts(hex)}" fill="${TOKENS.panel2}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`
    + edges.map(([a, b]) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${TOKENS.faint}" stroke-width="2"/>`).join('')
    + `<polygon points="${pts(tri)}" fill="${TOKENS.panel}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`
    + `<text x="50" y="${(s + 6 + fs * 0.12).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" font-weight="700" fill="${ink}" font-family="ui-monospace,'SF Mono',Menlo,Consolas,monospace">${n}</text>`
    + '</svg>';
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------ the DOM card
// host: the element to fill. opts:
//   seat, side ('left'|'right'), kind ('fly'|'human'|'bot')
//   connectome, brainMod (the ui/fly3d/brain3d.js namespace, optional)
//   compact (phone)
//   slim     a low, translucent corner strip (watch and 3D play): the
//            neural panel and the top-3 hide behind the "brain" button
//   onPlayer(seat)  tap on the card: a player target in play mode
export function createScorecard(host, opts = {}) {
  const doc = host.ownerDocument;
  const accent = opts.seat ? TOKENS.flyB : TOKENS.flyA;
  const el = doc.createElement('section');
  el.className = `hd-card hd-${opts.side || (opts.seat ? 'right' : 'left')} hd-seat${opts.seat ? 'B' : 'A'}`;
  el.setAttribute('aria-label', `scorecard seat ${opts.seat ? 'B' : 'A'}`);
  el.innerHTML = `
    <header class="hd-head">
      <b class="hd-letter"></b>
      <span class="hd-id"><span class="hd-name"></span><span class="hd-src"></span></span>
      <span class="hd-status"></span>
      <button class="hd-more" type="button" aria-expanded="false" aria-label="show the neural panel" hidden>brain</button>
      <button class="hd-life" type="button" aria-label="life"></button>
    </header>
    <div class="hd-mana" aria-label="mana: untapped of total lands"></div>
    <div class="hd-counts"></div>
    <div class="hd-brain"><canvas class="hd-cv" aria-label="live mushroom body activity"></canvas><span class="hd-vd"></span></div>
    <ol class="hd-top" aria-label="best three moves by mushroom body value"></ol>`;
  host.appendChild(el);
  const q = s => el.querySelector(s);
  const cv = q('.hd-cv');
  const brainBox = q('.hd-brain');
  let neural = null;
  let compact = !!opts.compact;
  let slim = !!opts.slim;
  el.classList.toggle('hd-slim', slim);
  // slim: the neural panel and the top-3 open and close with this button
  const more = q('.hd-more');
  function setOpen(on) {
    el.classList.toggle('is-open', !!on);
    more.setAttribute('aria-expanded', String(!!on));
    more.setAttribute('aria-label', on ? 'hide the neural panel' : 'show the neural panel');
    if (on) neural?.resize?.();
  }
  more.addEventListener('click', e => { e.stopPropagation(); setOpen(!el.classList.contains('is-open')); });

  function makeNeural() {
    if (neural || (opts.kind !== 'fly') || !opts.connectome) return;
    const C = opts.connectome;
    const nKC = C?.kc?.n || 2000;
    if (opts.brainMod?.createBrainCard) {
      try { neural = opts.brainMod.createBrainCard(cv, C, { colour: accent, compact }); neural.kind = '3d'; return; }
      catch (e) { console.info('fly-duel: createBrainCard failed, the 2D raster draws', e); neural = null; }
    }
    neural = createRaster(cv, { nKC, rows: compact ? 20 : 32, cols: compact ? 28 : 44, accent });
    neural.kind = '2d';
  }

  const lifeBtn = q('.hd-life');
  lifeBtn.addEventListener('click', () => opts.onPlayer?.(opts.seat));
  el.addEventListener('click', e => { if (e.target.closest('.hd-more')) return; if (e.target === el || e.target.closest('.hd-head')) opts.onPlayer?.(opts.seat); });

  let lastLife = null;
  function update(m) {
    el.classList.toggle('is-acting', !!m.acting);
    el.classList.toggle('is-active', !!m.active);
    el.classList.toggle('is-human', m.kind === 'human');
    el.dataset.tone = m.tone;
    q('.hd-letter').textContent = m.letter;
    q('.hd-name').textContent = m.name;
    q('.hd-src').textContent = m.kind === 'fly' ? m.source : m.deckName;
    q('.hd-status').textContent = m.status;
    if (lastLife !== m.life) {
      lifeBtn.innerHTML = d20Svg(m.life, { size: slim ? 30 : compact ? 40 : 52, tone: m.tone, accent: TOKENS.ink });
      lifeBtn.setAttribute('aria-label', `life ${m.life}`);
      if (lastLife !== null) {
        lifeBtn.dataset.flash = m.life < lastLife ? 'dmg' : 'heal';
        setTimeout(() => { delete lifeBtn.dataset.flash; }, 260);
      }
      lastLife = m.life;
    }
    q('.hd-mana').innerHTML = m.mana.length ? m.mana.map(r => {
      const bg = r.inks.length > 1 ? `linear-gradient(90deg,${r.inks[0]} 50%,${r.inks[1]} 50%)` : r.inks[0];
      let pips = '';
      // untapped pips first; the top r.pay of them are the lands the
      // selected card taps (marked .pay); then the tapped pips
      for (let i = 0; i < r.total; i++) {
        const cls = i < r.up ? (i >= r.up - (r.pay || 0) ? 'up pay' : 'up') : 'dn';
        pips += `<i class="${cls}" style="--c:${r.inks[0]};${i < r.up ? `background:${bg}` : ''}"></i>`;
      }
      return `<span class="hd-stack${r.pay ? ' is-pay' : ''}" title="${esc(r.kind)}: ${r.label} untapped${r.pay ? `, ${r.pay} to pay` : ''}"><span class="hd-pips">${pips}</span><em>${r.label}</em></span>`;
    }).join('') : '<span class="hd-none">no lands yet</span>';
    q('.hd-counts').innerHTML = m.counts.map(c => `<span class="hd-c hd-c-${c.key}"><em><span class="l">${c.label}</span><span class="s" title="${c.label}">${c.short}</span></em><b>${c.text}</b></span>`).join('');
    brainBox.hidden = m.kind !== 'fly';
    more.hidden = !slim || m.kind !== 'fly';
    q('.hd-top').innerHTML = m.top.map(t => `<li class="${t.chosen ? 'chosen' : ''}"><span class="hd-t">${esc(t.text)}</span><b>${t.valueText}</b><i style="width:${Math.round(t.bar * 100)}%"></i></li>`).join('');
    q('.hd-top').hidden = !m.top.length;
    if (m.kind === 'fly') makeNeural();
  }

  function fire(trace) {
    if (!trace) return;
    makeNeural();
    try { neural?.fire?.(trace, trace.delta); } catch (e) { console.info('fly-duel: brain card fire', e); }
    const vd = q('.hd-vd');
    vd.textContent = `V ${fmtValue(trace.value)}  δ ${fmtValue(trace.delta)}`;
    vd.dataset.sign = trace.delta > 0.01 ? 'app' : trace.delta < -0.01 ? 'avoid' : '';
  }

  return {
    el, update, fire,
    setCompact(c) { if (compact === !!c) return; compact = !!c; el.classList.toggle('hd-compact', compact); lastLife = null; neural?.resize?.(); },
    setSlim(on) { if (slim === !!on) return; slim = !!on; el.classList.toggle('hd-slim', slim); lastLife = null; if (!slim) setOpen(false); },
    setOpen,
    get open() { return el.classList.contains('is-open'); },
    resize() { neural?.resize?.(); },
    setTarget(on) { el.classList.toggle('is-target', !!on); lifeBtn.disabled = false; },
    dispose() { neural?.dispose?.(); el.remove(); },
    get neural() { return neural; },
  };
}
