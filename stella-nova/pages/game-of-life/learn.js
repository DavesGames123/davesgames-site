// learn.js - the diagrams in the explainer panel (#learn).
//
// Every diagram runs the real rule from life.js, so the counts and the
// results on screen come from the same code as the simulator.
//   mooreFig     the eight neighbours of one cell (static SVG)
//   ruleCards    birth, survival, loneliness, crowding: before and after
//   worked step  a blinker or a glider, with the neighbour count in each
//                cell and the fate of each cell, one generation at a time
//   class cards  six small worlds that run while the panel is open
//
// API: initLearn({onTry}) -> {setVisible(bool)}
//   onTry(id)    the page loads pattern id alone (a "Try it" button)
import * as L from './life.js';
import { PATTERNS } from './patterns.js';
import { cellColour } from './engine-cpu.js';

const $ = id => document.getElementById(id);
const LIFE = L.parseRule('B3/S23');
const PAT = Object.fromEntries(PATTERNS.map(p => [p.id, p]));
const LIVE = '#4fc79f', DEAD = '#0b0f14', EDGE = '#26323a', GOLD = '#ffd66e', ROSE = '#e0708f';
const svgNS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(svgNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}
function svg(w, h, label) {
  const s = el('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: 'img' });
  if (label) s.setAttribute('aria-label', label);
  return s;
}

// --------------------------------------------------------------- Moore
function mooreFig() {
  const c = 30, s = svg(c * 3 + 2, c * 3 + 2, 'A cell and its eight neighbours');
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const centre = x === 1 && y === 1;
    s.appendChild(el('rect', { x: 1 + x * c, y: 1 + y * c, width: c - 2, height: c - 2, rx: 3,
      fill: centre ? '#2a2412' : 'rgba(79,199,159,0.16)', stroke: centre ? GOLD : 'rgba(127,227,189,0.45)', 'stroke-width': centre ? 2 : 1 }));
    if (!centre) {
      const k = y * 3 + x - (y * 3 + x > 4 ? 1 : 0) + 1;
      s.appendChild(el('text', { x: 1 + x * c + c / 2 - 1, y: 1 + y * c + c / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#9fdcc5', 'font-family': 'ui-monospace,Menlo,monospace' }, String(k)));
    }
  }
  $('mooreFig').appendChild(s);
}

// ------------------------------------------------------------ rule cards
const CARDS = [
  { cls: 'birth', title: 'Birth', grid: '010/000/101', say: 'A dead cell with exactly 3 live neighbours comes alive.' },
  { cls: 'live', title: 'Survival', grid: '100/010/001', say: 'A live cell with 2 or 3 live neighbours stays alive.' },
  { cls: 'die', title: 'Loneliness', grid: '000/010/100', say: 'A live cell with 0 or 1 live neighbours dies.' },
  { cls: 'die', title: 'Crowding', grid: '101/010/101', say: 'A live cell with 4 or more live neighbours dies.' },
];
function ruleCards() {
  const box = $('ruleCards');
  for (const card of CARDS) {
    const g = card.grid.split('/').map(r => r.split('').map(Number));
    const centre = g[1][1], n = g.flat().reduce((a, b) => a + b, 0) - centre;
    const after = L.nextValue(centre, n, LIFE.birth, LIFE.survive) & 0xff ? 1 : 0;
    const c = 17, s = svg(c * 3 + 28 + c * 3, c * 3, card.title);
    const cell = (ox, x, y, live, ring) => {
      s.appendChild(el('rect', { x: ox + x * c + 1, y: y * c + 1, width: c - 2, height: c - 2, rx: 2, fill: live ? LIVE : DEAD, stroke: ring || EDGE, 'stroke-width': ring ? 2 : 1 }));
    };
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cell(0, x, y, g[y][x], x === 1 && y === 1 ? GOLD : null);
    s.appendChild(el('text', { x: c * 3 + 14, y: c * 1.5 + 5, 'text-anchor': 'middle', 'font-size': 14, fill: '#8d9a9f' }, '→'));
    const ox = c * 3 + 28;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      if (x === 1 && y === 1) cell(ox, x, y, after, after ? (centre ? LIVE : GOLD) : ROSE);
      else s.appendChild(el('rect', { x: ox + x * c + 1, y: y * c + 1, width: c - 2, height: c - 2, rx: 2, fill: 'none', stroke: '#1a2228' }));
    }
    const div = document.createElement('div');
    div.className = 'rcard';
    div.innerHTML = `<div class="rt ${card.cls}">${card.title} · ${n}</div>`;
    div.appendChild(s);
    const p = document.createElement('div'); p.className = 'rs'; p.textContent = card.say;
    div.appendChild(p);
    box.appendChild(div);
  }
}

// ----------------------------------------------------------- worked step
const WORKED = {
  blinker: { size: 5, start: [[1, 2], [2, 2], [3, 2]], period: 2 },
  glider: { size: 6, start: [[2, 1], [3, 2], [1, 3], [2, 3], [3, 3]], period: 4 },
};
let ws = { name: 'blinker', g: 0 };
function liveAt(name, g) {
  let s = L.toSet(WORKED[name].start);
  for (let k = 0; k < g; k++) s = L.stepSparse(s, LIFE.birth, LIFE.survive);
  return s;
}
function countAt(s, x, y) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && s.has(L.key(x + dx, y + dy))) n++;
  return n;
}
function workedStep() {
  const w = WORKED[ws.name], N = w.size, c = 26;
  const now = liveAt(ws.name, ws.g), next = L.stepSparse(now, LIFE.birth, LIFE.survive);
  const box = $('worked');
  box.textContent = '';
  let born = 0, died = 0, kept = 0;
  const a = svg(N * c + 2, N * c + 2, 'Generation ' + ws.g + ' with neighbour counts');
  const b = svg(N * c + 2, N * c + 2, 'Generation ' + (ws.g + 1));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = L.key(x, y), live = now.has(k), will = next.has(k), n = countAt(now, x, y);
    const X = 1 + x * c, Y = 1 + y * c;
    let stroke = EDGE, sw = 1, dash = null;
    if (live && !will) { stroke = ROSE; sw = 2.5; died++; }
    else if (!live && will) { stroke = GOLD; sw = 2; dash = '3 2'; born++; }
    else if (live) kept++;
    const r = el('rect', { x: X + 1, y: Y + 1, width: c - 2, height: c - 2, rx: 3, fill: live ? LIVE : DEAD, stroke, 'stroke-width': sw });
    if (dash) r.setAttribute('stroke-dasharray', dash);
    a.appendChild(r);
    if (n > 0) a.appendChild(el('text', { x: X + c / 2, y: Y + c / 2 + 4.5, 'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': (!live && will) ? 700 : 500,
      fill: live ? '#08241a' : (!live && will) ? GOLD : '#71808a', 'font-family': 'ui-monospace,Menlo,monospace' }, String(n)));
    b.appendChild(el('rect', { x: X + 1, y: Y + 1, width: c - 2, height: c - 2, rx: 3, fill: will ? (live ? LIVE : GOLD) : DEAD, stroke: EDGE }));
  }
  const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '→';
  box.append(a, arrow, b);
  $('wsGen').textContent = `Generation ${ws.g} → ${ws.g + 1}`;
  let say = `${kept} cell${kept === 1 ? '' : 's'} survive${kept === 1 ? 's' : ''}, ${died} die${died === 1 ? 's' : ''}, ${born} ${born === 1 ? 'is' : 'are'} born.`;
  if (ws.name === 'blinker') say += ws.g % 2 === 0
    ? ' The middle cell has 2 neighbours and stays. The two ends have 1 each and die. Above and below the middle, 3 neighbours give birth.'
    : ' The same rules turn the column back into a row. The blinker repeats every 2 generations.';
  else say += ws.g === 3
    ? ' After 4 generations the glider has its first shape again, one cell down and one cell right.'
    : ' Watch the shape: it changes, but the count of live cells is 5 again after each step.';
  $('wsSay').textContent = say;
}
function bindWorked() {
  document.querySelectorAll('#wsTabs button').forEach(btn => btn.addEventListener('click', () => {
    ws = { name: btn.dataset.ws, g: 0 };
    document.querySelectorAll('#wsTabs button').forEach(x => x.classList.toggle('on', x === btn));
    workedStep();
  }));
  $('wsNext').addEventListener('click', () => { ws.g = (ws.g + 1) % WORKED[ws.name].period; workedStep(); });
  $('wsPrev').addEventListener('click', () => { const p = WORKED[ws.name].period; ws.g = (ws.g + p - 1) % p; workedStep(); });
  workedStep();
}

// ----------------------------------------------------------- class cards
// Each card runs a small bounded world and draws a window of it. reset is
// the generation at which the world starts again, before debris from the
// edge can reach the window.
const CLASS_CARDS = [
  { title: 'Still lifes', try: 'beehive', W: 36, H: 24, view: [0, 0, 36, 24], reset: 400,
    place: [['block', 4, 4], ['beehive', 13, 3], ['loaf', 24, 3], ['boat', 5, 15], ['tub', 15, 16], ['eater', 25, 15]],
    say: 'No cell is born and none dies. The cells grow old and turn blue. Most random soups end as a scatter of these.' },
  { title: 'Oscillators', try: 'pulsar', W: 36, H: 24, view: [0, 0, 36, 24], reset: 120,
    place: [['pulsar', 2, 5], ['blinker', 22, 4], ['toad', 22, 12], ['beacon', 29, 9], ['figure8', 27, 16]],
    say: 'They return to the same shape after a fixed period. Pulsar: 3. Blinker, toad and beacon: 2. Since 2023, an oscillator is known for every period.' },
  { title: 'Spaceships', try: 'lwss', label: 'LWSS', W: 64, H: 46, view: [2, 4, 62, 44], reset: 96,
    place: [['lwss', 50, 6], ['mwss', 50, 18], ['hwss', 52, 30], ['glider', 59, 41, 2]],
    say: 'They move. A glider goes one cell diagonally every 4 generations (speed c/4). The LWSS goes c/2, the top speed along a row.' },
  { title: 'Guns', try: 'gosper', label: 'Gosper gun', W: 130, H: 100, view: [0, 0, 66, 44], reset: 240,
    place: [['gosper', 2, 2]],
    say: 'A gun is an oscillator that fires spaceships. Gosper\'s gun fires a glider every 30 generations, so the population grows forever.' },
  { title: 'Puffers', try: 'puffer', W: 170, H: 90, view: [8, 22, 96, 64], reset: 170,
    place: [['puffer', 12, 36]],
    say: 'A puffer moves and leaves debris behind it. Some puffers leave guns or other puffers behind, and grow very fast.' },
  { title: 'Methuselahs', try: 'rpent', W: 150, H: 110, view: [45, 33, 105, 77], reset: 420,
    place: [['rpent', 74, 54]],
    say: 'Small starts with long lives. The R-pentomino has 5 cells and settles only after 1103 generations.' },
];
function buildWorld(card) {
  const a = new Uint32Array(card.W * card.H);
  for (const [id, x0, y0, rot] of card.place) {
    for (const [x, y] of L.orient(L.parseRLE(PAT[id].rle), rot || 0, false)) {
      const X = x0 + x, Y = y0 + y;
      if (X >= 0 && Y >= 0 && X < card.W && Y < card.H) a[Y * card.W + X] = 1;
    }
  }
  return a;
}
let cards = [], timer = 0, visible = false;
function drawCard(k) {
  const cv = k.cv, d = k.card, [vx0, vy0, vx1, vy1] = d.view;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  const vw = vx1 - vx0, vh = vy1 - vy0, s = Math.min(w / vw, h / vh);
  const ox = (w - vw * s) / 2, oy = (h - vh * s) / 2;
  g.fillStyle = '#06080b'; g.fillRect(0, 0, w, h);
  const gap = s >= 5 ? 1 : 0;
  for (let y = vy0; y < vy1; y++) for (let x = vx0; x < vx1; x++) {
    const v = k.a[y * d.W + x];
    if (!v) continue;
    const c = cellColour(v, 'age', true);
    g.fillStyle = `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`;
    g.fillRect(ox + (x - vx0) * s, oy + (y - vy0) * s, s - gap, s - gap);
  }
}
function tick() {
  for (const k of cards) {
    if (k.card.reset && k.gen >= k.card.reset) { k.a = buildWorld(k.card); k.gen = 0; }
    else { k.a = L.stepDense(k.a, k.card.W, k.card.H, LIFE.birth, LIFE.survive, !!k.card.wrap); k.gen++; }
    drawCard(k);
  }
}
function classCards(onTry) {
  const grid = $('clsGrid');
  for (const card of CLASS_CARDS) {
    const div = document.createElement('div');
    div.className = 'cls';
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-label', card.title + ', running');
    const h = document.createElement('h3'); h.textContent = card.title;
    const p = document.createElement('p'); p.textContent = card.say;
    const b = document.createElement('button'); b.className = 'try'; b.textContent = 'Try the ' + (card.label || PAT[card.try].name) + ' ▶';
    b.addEventListener('click', () => onTry(card.try));
    div.append(cv, h, p, b);
    grid.appendChild(div);
    cards.push({ card, cv, a: buildWorld(card), gen: 0 });
  }
}

export function initLearn({ onTry }) {
  mooreFig();
  ruleCards();
  bindWorked();
  classCards(onTry);
  const learn = $('learn');
  // Table of contents: scroll inside the panel, not the page.
  learn.querySelectorAll('.ln-toc a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const t = learn.querySelector(a.getAttribute('href'));
    if (t) learn.scrollTo({ top: t.offsetTop - 40, behavior: 'smooth' });
  }));
  return {
    setVisible(on) {
      visible = on;
      clearInterval(timer); timer = 0;
      if (on) { requestAnimationFrame(() => cards.forEach(drawCard)); timer = setInterval(() => { if (!document.hidden && visible) tick(); }, 110); }
    },
  };
}
