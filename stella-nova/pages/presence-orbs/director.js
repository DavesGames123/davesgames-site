// ============================================================================
//  PRESENCE ORBS  ·  director.js — the screensaver shot director (no DOM)
// ----------------------------------------------------------------------------
//  This module plans the screensaver shots and gives the state of each orb at
//  a time in a shot. It touches no DOM and no GPU, so node can test it
//  (tests.mjs). main.js "function saverFrame" reads it once per frame.
//
//  A shot is a list of species (cells), a kind, a duration and a script. The
//  script gives each cell a list of segments { t, st, v }: from time t the
//  cell is in state st, and v names its voice (idle breath, user speech, own
//  speech, or the echo of a speaker). sampleShot() reads the script at a time
//  and gives the state, the voice level, the activity and the tone per cell.
//
//  SHOT KINDS  (grep "kind: '")
//      wave ... a grid of 12 to 18 species; waves cross the grid and wake each
//               orb they reach: listening, thinking, responding, success/error
//      tint ... a grid; each wave also carries a new palette tone
//      solo ... one species with a push-in; it goes through all six states
//      talk ... 2 to 4 species take turns; the others listen to the speaker
//      relay .. 5 to 8 species of one family pass a baton of speech, and back
//
//  EXPORTS
//      STATES ............ the six assistant states (the same order as state.js)
//      TONES ............. the saver palette
//      makeDirector(o) ... { next() } gives the next shot; o = { seed, calm, pool }
//      sampleShot(sh, t) . per-cell { st, level, activity, tone } and the focus cell
//      layoutShot(sh, r, t)  cell squares { x, y, s } (centre, side) in a rect
//      shotLabel(sh) ..... { title, sub, line } for the label plate
//      speech(t, s) ...... a voice envelope 0..1 (phrases and syllables)
//      saverDpr(w, h, n, dpr, coarse)  the pixel ratio of the saver canvas
//
//  Timing: a shot lasts 5 to 12 s. calm 0..1 stretches the shot and every
//  script time by k = 1 + 0.7 calm, so calm 1 is slower but never static.
// ============================================================================

export const STATES = ['idle', 'listening', 'thinking', 'responding', 'success', 'error'];
export const TONES = ['#5a8cc0', '#7a72c8', '#4fa39a', '#c0905a', '#8fb0d8', '#b07aa8', '#c07a6a', '#6ab07a'];
export const SHOT_MIN = 5, SHOT_MAX = 12;

const sstep = x => { const t = Math.min(Math.max(x, 0), 1); return t * t * (3 - 2 * t); };
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

// mulberry32: the same generator main.js used for the old saver order
export function rng(seed) {
  let r = (seed >>> 0) || 1;
  return () => { r = (r + 0x6D2B79F5) >>> 0; let x = Math.imul(r ^ (r >>> 15), 1 | r); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

// A voice envelope in 0..1: phrases with gaps, and syllables at about 3 Hz
// inside a phrase. s moves the voice to a different place in the pattern.
export function speech(t, s) {
  const x = t + s * 13.7;
  const phrase = sstep((Math.sin(x * 1.3) + 0.6 * Math.sin(x * 0.71 + 1.3) + 0.45) * 2.2);
  const syl = Math.max(0, 0.6 * Math.sin(x * 19.0) + 0.4 * Math.sin(x * 27.3 + s));
  return Math.min(1, phrase * (0.25 + 0.85 * syl));
}

// one cell's script: segments sorted by t; a later write from time t0 cuts
// every segment at or after t0 (a new wave restarts the orb)
function put(seg, t0, list) {
  while (seg.length && seg[seg.length - 1].t >= t0) seg.pop();
  for (const q of list) seg.push(q);
}

// the wave sequence an orb runs when a wave reaches it at time a
function waveRun(a, k, rnd, tone) {
  const j = () => k * (0.85 + 0.3 * rnd());
  const l = 0.55 * j(), th = 0.5 * j(), re = 1.3 * j(), en = 0.55 * j();
  const end = rnd() < 0.14 ? 'error' : 'success';
  return [{ t: a, st: 'listening', v: 'user', tone }, { t: a + l, st: 'thinking', v: 'think', tone },
    { t: a + l + th, st: 'responding', v: 'self', tone }, { t: a + l + th + re, st: end, v: 'end', tone },
    { t: a + l + th + re + en, st: 'idle', v: 'idle', tone }];
}

function planWave(sh, rnd, k, tinted) {
  const n = sh.cols * sh.rows, scripts = Array.from({ length: n }, () => [{ t: -1, st: 'idle', v: 'idle', tone: 0 }]);
  const corners = [[0, 0], [sh.cols - 1, 0], [0, sh.rows - 1], [sh.cols - 1, sh.rows - 1], [(sh.cols - 1) / 2, (sh.rows - 1) / 2]];
  const waves = [];
  let tw = 0.15 + 0.25 * rnd(), w = 0;
  while (tw < sh.dur - 0.8 * k) {
    const o = rnd() < 0.7 ? corners[Math.floor(rnd() * corners.length)] : [rnd() * (sh.cols - 1), rnd() * (sh.rows - 1)];
    const delay = (0.13 + 0.08 * rnd()) * k;
    waves.push({ t: tw, o, delay, tone: tinted ? w + 1 : 0 });
    tw += (1.9 + 1.1 * rnd()) * k; w++;
  }
  for (const wv of waves) for (let i = 0; i < n; i++) {
    const cx = i % sh.cols, cy = Math.floor(i / sh.cols);
    const a = wv.t + wv.delay * Math.hypot(cx - wv.o[0], cy - wv.o[1]);
    put(scripts[i], a, waveRun(a, k, rnd, wv.tone));
  }
  sh.waves = waves; sh.scripts = scripts;
}

function planSolo(sh, rnd, k) {
  const long = sh.dur >= 8.5;
  const seq = long
    ? [['idle', 0.5], ['listening', 1.5], ['thinking', 1.2], ['responding', 2.2], ['error', 0.7], ['thinking', 0.8], ['responding', 1.6], ['success', 0.9]]
    : [['idle', 0.4], ['listening', 1.4], ['thinking', 1.1], ['responding', 1.8], ['error', 0.6], ['success', 0.9]];
  const sum = seq.reduce((a, q) => a + q[1], 0), sc = (sh.dur - 0.3) / sum;
  const voice = { idle: 'idle', listening: 'user', thinking: 'think', responding: 'self', success: 'end', error: 'end' };
  const seg = [{ t: -1, st: 'idle', v: 'idle', tone: 0 }]; let t = 0;
  for (const [st, d] of seq) { if (t > 0 || st !== 'idle') seg.push({ t, st, v: voice[st], tone: 0 }); t += d * sc * (0.9 + 0.2 * rnd()); }
  sh.scripts = [seg];
  sh.zoom = [0.5 + 0.12 * rnd(), 0.9 + 0.1 * rnd()];
}

function planTalk(sh, rnd, k) {
  const n = sh.cells.length, scripts = Array.from({ length: n }, () => [{ t: -1, st: 'idle', v: 'idle', tone: 0 }]);
  let t = 0.2, who = Math.floor(rnd() * n), prev = -1;
  const turns = [];
  while (t < sh.dur) {
    const len = (1.3 + 1.3 * rnd()) * k;
    turns.push({ t, who });
    for (let i = 0; i < n; i++) {
      if (i === who) put(scripts[i], t, [{ t, st: 'thinking', v: 'think', tone: 0 }, { t: t + 0.4 * k, st: 'responding', v: 'self', tone: 0 }]);
      else if (i === prev) put(scripts[i], t, [{ t, st: rnd() < 0.2 ? 'error' : 'success', v: 'end', tone: 0 }, { t: t + 0.5 * k, st: 'listening', v: 'echo', echo: who, tone: 0 }]);
      else put(scripts[i], t, [{ t, st: 'listening', v: 'echo', echo: who, tone: 0 }]);
    }
    prev = who; who = (who + 1 + Math.floor(rnd() * (n - 1))) % n; t += len;
  }
  sh.turns = turns; sh.scripts = scripts;
}

function planRelay(sh, rnd, k) {
  const n = sh.cells.length, scripts = Array.from({ length: n }, () => [{ t: -1, st: 'idle', v: 'idle', tone: 0 }]);
  const step = (0.55 + 0.25 * rnd()) * k;
  let t = 0.2, h = rnd() < 0.5 ? 0 : n - 1, dir = h === 0 ? 1 : -1;
  const holders = [];
  while (t < sh.dur) {
    holders.push({ t, h });
    const last = holders.length > 1 ? holders[holders.length - 2].h : -1, nx = h + dir;
    put(scripts[h], t, [{ t, st: 'responding', v: 'self', tone: 0 }]);
    if (nx >= 0 && nx < n) put(scripts[nx], t, [{ t, st: 'listening', v: 'echo', echo: h, tone: 0 }]);
    if (last >= 0 && last !== h && last !== nx) put(scripts[last], t, [{ t, st: 'success', v: 'end', tone: 0 }, { t: t + 1.6 * step, st: 'idle', v: 'idle', tone: 0 }]);
    if (h + dir < 0 || h + dir >= n) dir = -dir;
    h += dir; t += step;
  }
  sh.holders = holders; sh.scripts = scripts;
}

// ── the director ────────────────────────────────────────────────────────────
// pool: [{ name, family, species }] (the species the saver may show)
export function makeDirector({ seed = 1, calm = 0.7, pool }) {
  calm = Math.min(1, Math.max(0, +calm || 0));
  const rnd = rng(seed), k = 1 + 0.7 * calm;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let deck = [], bag = [], lastKind = '', lastTone = -1, count = 0;
  const kinds = ['wave', 'solo', 'talk', 'relay', 'tint', 'solo', 'talk', 'wave'];
  const nextKind = () => {
    if (!deck.length) deck = shuffle(kinds.slice());
    let i = deck.findIndex(q => q !== lastKind);
    if (i < 0) { deck = deck.concat(shuffle(kinds.slice())); i = deck.findIndex(q => q !== lastKind); }
    return deck.splice(i, 1)[0];
  };
  // species come from a shuffled bag, so every species shows before one repeats
  const take = (n, fam) => {
    const out = [];
    if (fam) return shuffle(pool.filter(p => p.family === fam)).slice(0, n);
    while (out.length < n) {
      if (!bag.length) bag = shuffle(pool.slice());
      const p = bag.pop(); if (!out.includes(p)) out.push(p);
    }
    return out;
  };
  const tone = () => { let i; do i = Math.floor(rnd() * TONES.length); while (i === lastTone && TONES.length > 1); lastTone = i; return TONES[i]; };
  function next() {
    const kind = nextKind(); lastKind = kind;
    const dur = Math.min(SHOT_MAX, Math.max(SHOT_MIN, 5 + 4.5 * rnd() + 2.5 * calm));
    const sh = { kind, dur, k, n: count++, tones: [tone()] };
    if (kind === 'wave' || kind === 'tint') {
      const g = kind === 'wave' ? [[4, 3], [5, 3], [6, 3]] : [[4, 2], [5, 3], [4, 3]];
      [sh.cols, sh.rows] = g[Math.floor(rnd() * g.length)];
      sh.cells = take(sh.cols * sh.rows);
      if (kind === 'tint') while (sh.tones.length < 6) sh.tones.push(tone());
      planWave(sh, rnd, k, kind === 'tint');
    } else if (kind === 'solo') {
      sh.cells = take(1); planSolo(sh, rnd, k);
    } else if (kind === 'talk') {
      sh.cells = take(2 + Math.floor(rnd() * 3)); planTalk(sh, rnd, k);
    } else {
      const fams = {};
      for (const p of pool) fams[p.family] = (fams[p.family] || 0) + 1;
      const ok = Object.keys(fams).filter(f => fams[f] >= 5);
      sh.family = ok.length ? ok[Math.floor(rnd() * ok.length)] : null;
      sh.cells = sh.family ? take(Math.min(fams[sh.family], 5 + Math.floor(rnd() * 4)), sh.family) : take(6);
      planRelay(sh, rnd, k);
    }
    sh.seeds = sh.cells.map(() => rnd() * 100);
    return sh;
  }
  return { next, k, calm };
}

// ── sampling ────────────────────────────────────────────────────────────────
function segAt(seg, t) { let i = seg.length - 1; while (i > 0 && seg[i].t > t) i--; return i; }

// per-cell { st, level, activity, tone: [r,g,b] } at time t (s) in the shot,
// plus focus: the cell that holds the eye (the speaker, the newest woken orb)
export function sampleShot(sh, t) {
  const k = sh.k, ts = t / k, cells = [];
  let focus = 0, best = -Infinity;
  for (let i = 0; i < sh.cells.length; i++) {
    const seg = sh.scripts[i], j = segAt(seg, t), q = seg[j], s = sh.seeds[i], u = t - q.t;
    const breath = 0.06 + 0.05 * Math.sin(ts * 1.7 + s);
    let level, activity;
    switch (q.v) {
      case 'user':  level = 0.12 + 0.8 * speech(ts, s + 3); activity = 0.35 + 0.15 * speech(ts, s + 5); break;
      case 'think': level = 0.15 + 0.08 * Math.sin(ts * 5 + s); activity = 0.72 + 0.2 * Math.sin(ts * 7.3 + s) * Math.sin(ts * 3.1); break;
      case 'self':  { const v = speech(ts, s); level = 0.12 + 0.88 * v; activity = 0.45 + 0.35 * v; break; }
      case 'echo':  level = 0.1 + 0.5 * speech(ts, sh.seeds[q.echo]); activity = 0.3; break;
      case 'end':   level = 0.15 + 0.5 * Math.exp(-u / (0.4 * k)); activity = q.st === 'error' ? 0.6 : 0.3; break;
      default:      level = breath; activity = 0.06;
    }
    // tone: crossfade from the tone of the last segment with another tone
    let tone = hexRgb(sh.tones[q.tone % sh.tones.length]);
    if (q.tone) {
      let p = j; while (p > 0 && seg[p - 1].tone === q.tone) p--;
      const a = sstep((t - seg[p].t) / (0.9 * k)), from = hexRgb(sh.tones[(p > 0 ? seg[p - 1].tone : 0) % sh.tones.length]);
      tone = tone.map((c, n) => from[n] + (c - from[n]) * a);
    }
    if (q.st !== 'idle') { const w = (q.v === 'self' ? 1000 : 0) + q.t; if (w > best) { best = w; focus = i; } }
    cells.push({ st: q.st, level: Math.min(1, Math.max(0, level)), activity: Math.min(1, Math.max(0, activity)), tone });
  }
  return { cells, focus };
}

// ── layout ──────────────────────────────────────────────────────────────────
// Cell squares in rect r = { x, y, w, h } (CSS px). A grid keeps its planned
// columns in a landscape rect and turns them in a portrait rect (the wave
// geometry turns with it). The other kinds take the column count that gives
// the largest cell. Every shot has a slow push-in.
export function layoutShot(sh, r, t) {
  const n = sh.cells.length, p = sstep(t / sh.dur);
  if (sh.kind === 'solo') {
    const z = sh.zoom[0] + (sh.zoom[1] - sh.zoom[0]) * p, s = Math.min(r.w, r.h) * z;
    return [{ x: r.x + r.w / 2, y: r.y + r.h / 2, s }];
  }
  let cols, rows, turn = false;
  if (sh.cols) { turn = r.h > r.w * 1.05; cols = turn ? sh.rows : sh.cols; rows = turn ? sh.cols : sh.rows; }
  else {
    let bestC = 1, bestS = 0;
    for (let c = 1; c <= n; c++) { const s = Math.min(r.w / c, r.h / Math.ceil(n / c)); if (s > bestS) { bestS = s; bestC = c; } }
    cols = bestC; rows = Math.ceil(n / cols);
  }
  const cap = sh.kind === 'talk' ? 0.62 : sh.kind === 'relay' ? 0.5 : 1;
  const cell = Math.min(r.w / cols, r.h / rows, Math.min(r.w, r.h) * cap) * (0.9 + 0.1 * p);
  const fill = sh.kind === 'talk' ? 0.86 : 0.92;
  const out = [];
  for (let i = 0; i < n; i++) {
    let cx = i % (sh.cols || cols), cy = Math.floor(i / (sh.cols || cols));
    if (turn) [cx, cy] = [cy, cx];
    const inRow = sh.cols ? cols : Math.min(cols, n - cy * cols);   // centre a short last row
    out.push({ x: r.x + r.w / 2 + (cx - (inRow - 1) / 2) * cell, y: r.y + r.h / 2 + (cy - (rows - 1) / 2) * cell, s: cell * fill });
  }
  return out;
}

// ── plate text ──────────────────────────────────────────────────────────────
export function shotLabel(sh) {
  const n = sh.cells.length, names = sh.cells.map(c => c.name);
  switch (sh.kind) {
    case 'wave': return { title: 'Presence orbs · activity wave', sub: `${n} species; each wave wakes the orbs it reaches`,
      line: `${sh.waves.length} waves: listening, thinking, responding, then success or error` };
    case 'tint': return { title: 'Presence orbs · colour wave', sub: `each wave carries a new tone across ${n} species`,
      line: `${sh.waves.length} waves; an orb crossfades to the new tone when the wave wakes it` };
    case 'solo': return { title: 'Presence orb · ' + names[0], sub: sh.cells[0].species || names[0],
      line: 'push-in: idle, listening, thinking, responding, error, success' };
    case 'talk': return { title: 'Presence orbs · conversation', sub: names.join(', ') + ' take turns',
      line: `${sh.turns.length} turns: the speaker thinks, then responds; the others listen to its voice` };
    default: return { title: `Presence orbs · ${sh.family || 'mixed'} relay`, sub: `a baton of speech passes along ${n} species and back`,
      line: 'the holder responds, the next orb listens, the last one ends in success' };
  }
}

// The pixel ratio of the saver canvas: w x h CSS px, n orbs in the shot,
// dpr the device ratio, coarse true on a touch screen. One orb draws at up
// to 2 (1.5 on a touch screen). A grid shot draws at up to 1.5 (1.25 on a
// touch screen), because each orb is small. The canvas also stays under a
// device px cap: 3840 x 2160 on a desktop, 1.6 Mpx on a touch screen, so a
// phone never fills a full 3x canvas.
export const SAVER_MAX_PX = 3840 * 2160, SAVER_PHONE_PX = 1.6e6;
export function saverDpr(w, h, n, dpr, coarse) {
  const top = n > 1 ? (coarse ? 1.25 : 1.5) : (coarse ? 1.5 : 2);
  const area = Math.max(1, w * h), cap = Math.sqrt((coarse ? SAVER_PHONE_PX : SAVER_MAX_PX) / area);
  return Math.max(0.5, Math.min(dpr || 1, top, cap));
}
