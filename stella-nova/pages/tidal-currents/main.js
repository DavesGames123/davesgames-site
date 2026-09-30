// main.js — Tidal Currents page: poster layout, overlay text, clock, controls.
//
// engine.js draws the map into #map with WebGPU. This file does everything
// else. It fits the poster into the window, writes the title, legend, brand,
// credit and place labels from meta.json, runs the clock, and switches the
// location with a short fade through black.
//
//   Left / Right   previous / next location     Space   play / pause
//   I              caption on / off             Esc     close the caption
//   Click or drag the 7-day bar to set the time. #<id> in the URL picks a location.
//
// grep: function layoutPoster  function buildOverlay  function placeScale
//       function switchTo  function frame  const CAPTIONS  function captionHTML

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const poster = $('poster');
const canvas = $('map');
const overlay = $('overlay');
const fadeEl = $('fade');
const loadingEl = $('loading');
const fallbackEl = $('fallback');
const captionEl = $('caption');

const WEEK_SECONDS = 70;            // one week of model time in about 70 s
const MAX_BACKING = 3840;           // long side of the canvas backing store
const IDLE_MS = 2500;
const DESIGN_AREA = 720 * 1280;     // the design grid is one portrait poster
const STORE_KEY = 'tidal-currents.location';

// Used when data/index.json is not there yet.
const DEFAULT_LOCS = [
  { id: 'puget-sound', title: 'Puget Sound', aspect: 'portrait' },
  { id: 'sf-bay', title: 'San Francisco Bay', aspect: 'portrait' },
  { id: 'san-juan-islands', title: 'San Juan Islands', aspect: 'portrait' },
  { id: 'cook-inlet', title: 'Cook Inlet', aspect: 'landscape' },
  { id: 'straits-of-mackinac', title: 'Straits of Mackinac', aspect: 'landscape' },
];

// Editorial line breaks for the portrait titles.
const TITLE_LINES = {
  'puget-sound': ['Puget', 'Sound'],
  'sf-bay': ['San Francisco', 'Bay'],
  'san-juan-islands': ['San Juan', 'Islands'],
};

// One hand-written caption per location. Keep the facts plain and true.
const CAPTIONS = {
  'puget-sound': [
    'Puget Sound fills and drains through a few narrow passages. Twice a day, the whole of the South Sound pushes in and out through the Tacoma Narrows, a channel only about a mile wide, and the current there is among the fastest in the Sound.',
  ],
  'sf-bay': [
    'The tide turns under the Golden Gate Bridge about four times a day. The strait is the bay’s only opening to the Pacific, so every flood and every ebb for the whole bay squeezes through it.',
  ],
  'san-juan-islands': [
    'Twice a day, the tide carries Pacific water in through the Strait of Juan de Fuca and back out again. Among the islands it funnels into Haro Strait and Rosario Strait, the two main channels between the Strait of Juan de Fuca and the Strait of Georgia.',
  ],
  'cook-inlet': [
    'Cook Inlet has one of the largest tidal ranges in North America. Near Anchorage, the largest tides rise and fall by more than 30 feet, and on the flood a tidal bore can run up Turnagain Arm.',
  ],
  'straits-of-mackinac': [
    'Lake Michigan and Lake Huron are one lake, joined here at the Straits of Mackinac. The current through the straits often reverses, but not with the tide: wind piles water against one shore, and the lake sloshes back in a slow seiche.',
  ],
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="1.5" width="3" height="11" rx="0.6"/><rect x="8.5" y="1.5" width="3" height="11" rx="0.6"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1.6v10.8a.5.5 0 0 0 .76.43l8.6-5.4a.5.5 0 0 0 0-.86l-8.6-5.4a.5.5 0 0 0-.76.43z"/></svg>';

// ─── state ──────────────────────────────────────────────────────────────────
let locs = DEFAULT_LOCS;
let locIndex = 0;
let meta = null;              // meta.json of the current location
let dataset = null;
let engine = null;
let engineMod = null;
let rampCSS = null;
let hour = 0;
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let scrubbing = false;
let lastT = null;
let shownHour = -1;
let switchToken = 0;
let ui = {};                  // live overlay elements
let posterPx = { w: 720, h: 1280, u: 1 };
let coverGrid = null;         // { w, h, data } coarse water coverage

// ─── helpers ────────────────────────────────────────────────────────────────
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lastHour = () => Math.max(1, (meta?.hours ?? 169) - 1);
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s.-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

function storeGet() { try { return localStorage.getItem(STORE_KEY); } catch { return null; } }
function storeSet(v) { try { localStorage.setItem(STORE_KEY, v); } catch { /* private mode */ } }

// The local time at hour h, from meta.startLocal ("2026-09-21T00:00").
function localDate(h) {
  const m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(meta?.startLocal ?? '2026-09-21T00:00');
  const t0 = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return new Date(t0 + Math.floor(h) * 3600e3);
}
function stamp(h) {
  const d = localDate(h);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:00 ${meta?.tzLabel ?? ''}`.trim();
}

function modelShort(m) {
  return (m.modelShort || m.model || '').toUpperCase();
}

// ─── poster fit ─────────────────────────────────────────────────────────────
// A phone is a coarse pointer with a short side under 600 CSS px.
const coarse = matchMedia('(pointer: coarse)');
function device() {
  const short = Math.min(window.innerWidth, window.innerHeight);
  const phone = coarse.matches && short < 600;
  const tablet = coarse.matches && !phone;
  return { phone, tablet };
}

// Read env(safe-area-inset-*) through a probe element.
const insetProbe = el('div');
insetProbe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;' +
  'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
document.body.appendChild(insetProbe);
function safeInsets() {
  const cs = getComputedStyle(insetProbe);
  return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
}

// The layout has three modes.
//   poster   the blocks sit on the poster (desktop, tablet, a portrait poster on a phone)
//   stack-v  a portrait phone with a landscape poster: the title goes above the
//            poster, the legend, brand and credit go under it
//   stack-h  a landscape phone with a portrait poster: the title goes in the left
//            gutter, the legend, brand and credit go in the right gutter
let mode = 'poster';

function setBox(node, x, y, w, h) {
  node.style.left = Math.round(x) + 'px';
  node.style.top = Math.round(y) + 'px';
  node.style.width = Math.round(w) + 'px';
  if (h != null) node.style.height = Math.round(h) + 'px';
}

function layoutPoster() {
  const W = meta?.width ?? 720;
  const H = meta?.height ?? 1280;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ins = safeInsets();
  const S = { x: ins.l, y: ins.t, w: vw - ins.l - ins.r, h: vh - ins.t - ins.b };
  const { phone, tablet } = device();
  const strip = $('controls');
  document.body.classList.remove('strip-vert', 'dock-side', 'stack-h');   // measure the plain strip
  strip.style.left = '';
  const stripH = strip.offsetHeight + 20;
  const full = Math.min(S.w / W, S.h / H);
  const areaFrac = (W * H * full * full) / (S.w * S.h);

  mode = 'poster';
  if (phone && meta && areaFrac < 0.6) mode = S.h > S.w ? 'stack-v' : 'stack-h';
  document.body.classList.toggle('phone', phone);
  document.body.classList.toggle('stack-v', mode === 'stack-v');
  document.body.classList.toggle('stack-h', mode === 'stack-h');
  placeBlocks();

  let s = full, px, py, dock = false, below = false;
  const A = $('stackA'), B = $('stackB');
  if (mode === 'poster') {
    const gutter = (S.w - W * full) / 2;
    dock = gutter >= strip.offsetWidth + 32;
    if (!dock) {
      // Keep the strip off the poster when that costs 8 % of the size or less.
      const sA = Math.min(S.w / W, (S.h - stripH) / H);
      if (sA >= full * 0.92) { s = sA; below = true; }
    }
    const areaH = below ? S.h - stripH : S.h;
    px = S.x + (S.w - W * s) / 2;
    py = S.y + (areaH - H * s) / 2;
  } else if (mode === 'stack-v') {
    const pad = 18;
    const colW = Math.min(S.w - pad * 2, 560);
    const uText = Math.min(1.05, Math.max(0.62, colW / 520));
    for (const n of [A, B]) {
      n.style.setProperty('--u', uText.toFixed(4) + 'px');
      setBox(n, S.x + (S.w - colW) / 2, 0, colW);
      n.style.height = '';
    }
    const hA = A.offsetHeight, hB = B.offsetHeight;
    const gap = 22;
    const availH = S.h - stripH;
    s = Math.min(S.w / W, Math.max(40, availH - hA - hB - gap * 2) / H);
    const groupH = hA + gap + H * s + gap + hB;
    const y0 = S.y + Math.max(0, (availH - groupH) / 2);
    A.style.top = Math.round(y0) + 'px';
    px = S.x + (S.w - W * s) / 2;
    py = y0 + hA + gap;
    B.style.top = Math.round(py + H * s + gap) + 'px';
    below = true;
  } else {
    // stack-h: the poster fills the height, the gutters hold the text.
    s = full;
    px = S.x + (S.w - W * s) / 2;
    py = S.y + (S.h - H * s) / 2;
    const pad = 16;
    const gw = Math.max(0, px - S.x - pad * 2);
    const uText = Math.min(0.9, Math.max(0.5, gw / 300));
    for (const n of [A, B]) n.style.setProperty('--u', uText.toFixed(4) + 'px');
    setBox(A, S.x + pad, S.y + pad, gw, S.h - pad * 2);
    setBox(B, px + W * s + pad, S.y + pad, gw, S.h - pad * 2);
    dock = true;
  }
  // A phone on its side with a landscape poster: a vertical strip in the right gutter.
  const sideGap = S.x + S.w - (px + W * s);
  const vert = phone && mode === 'poster' && !dock && !below && sideGap >= 56 && S.h >= 250;
  document.body.classList.toggle('strip-vert', vert);
  document.body.classList.toggle('dock-side', dock);
  document.body.classList.toggle('strip-below', below);

  const pw = Math.round(W * s);
  const ph = Math.round(H * s);
  const u = Math.sqrt((pw * ph) / DESIGN_AREA);
  posterPx = { w: pw, h: ph, u };
  poster.style.width = pw + 'px';
  poster.style.height = ph + 'px';
  poster.style.left = Math.round(px) + 'px';
  poster.style.top = Math.round(py) + 'px';
  poster.style.setProperty('--u', u.toFixed(4) + 'px');
  poster.classList.toggle('tiny', u < 0.62);

  // In stack-h the strip sits in the left gutter, under the title.
  if (mode === 'stack-h') {
    strip.style.left = Math.round(S.x + 16 + Math.max(0, (px - S.x - 32 - strip.offsetWidth) / 2)) + 'px';
  } else {
    strip.style.left = '';
  }

  // Backing store: device px, capped harder on phones and tablets.
  const dprMax = phone || tablet ? 2 : 4;
  const longMax = phone ? 2400 : tablet ? 3200 : MAX_BACKING;
  const dpr = Math.min(window.devicePixelRatio || 1, dprMax);
  let bw = Math.max(1, Math.round(pw * dpr));
  let bh = Math.max(1, Math.round(ph * dpr));
  const k = Math.min(1, longMax / Math.max(bw, bh));
  bw = Math.max(1, Math.round(bw * k));
  bh = Math.max(1, Math.round(bh * k));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  if (engine) engine.resize(bw, bh);
}

// Put the four text blocks on the poster, or into the two stacks.
function placeBlocks() {
  const k = ui.blocks;
  if (!k) return;
  const A = $('stackA'), B = $('stackB');
  if (mode === 'poster') {
    for (const n of Object.values(k)) if (n.parentNode !== overlay) overlay.appendChild(n);
    return;
  }
  A.append(k.title);
  if (mode === 'stack-v') B.append(k.legend, k.credit, k.brand);
  else B.append(k.legend, k.brand, k.credit);
}

// Hide place labels that collide with each other or with a text block.
// The larger label wins. xs labels go first on a small poster.
function thinLabels() {
  const labels = [...overlay.querySelectorAll('.lbl')];
  for (const n of labels) n.hidden = false;
  const rank = { lg: 0, md: 1, sm: 2, xs: 3 };
  labels.sort((a, b) => rank[a.dataset.size] - rank[b.dataset.size]);
  const kept = [...overlay.querySelectorAll('.blk')].map((n) => n.getBoundingClientRect());
  const pr = poster.getBoundingClientRect();
  const pad = 3;
  const hit = (a, b) => a.left - pad < b.right && a.right + pad > b.left && a.top - pad < b.bottom && a.bottom + pad > b.top;
  for (const n of labels) {
    if (n.dataset.size === 'xs' && posterPx.u < 0.6) { n.hidden = true; continue; }
    const t = n.querySelector('.txt').getBoundingClientRect();
    const d = n.querySelector('.dot').getBoundingClientRect();
    const box = { left: Math.min(t.left, d.left), right: Math.max(t.right, d.right), top: Math.min(t.top, d.top), bottom: Math.max(t.bottom, d.bottom) };
    const off = box.left < pr.left - 1 || box.right > pr.right + 1;
    if (off || kept.some((k) => hit(box, k))) { n.hidden = true; continue; }
    kept.push(box);
  }
}

// Move a block down when it runs into the block above it.
function resolveOverlaps() {
  const blocks = [...overlay.querySelectorAll('.blk')];
  const gap = 20 * posterPx.u;
  for (const b of blocks) b.style.marginTop = '';
  for (let i = 0; i < blocks.length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i === j) continue;
      const a = blocks[j].getBoundingClientRect();
      const r = blocks[i].getBoundingClientRect();
      const horiz = a.left < r.right && a.right > r.left;
      if (horiz && a.top <= r.top && a.bottom + gap > r.top && r.bottom > a.top) {
        const shift = a.bottom + gap - r.top;
        blocks[i].style.marginTop = ((parseFloat(blocks[i].style.marginTop) || 0) + shift) + 'px';
      }
    }
  }
}

// ─── overlay ────────────────────────────────────────────────────────────────
function block(spec, cls) {
  const b = el('div', `blk ${cls} a-${spec?.align ?? 'left'}`);
  b.style.left = ((spec?.x ?? 0.05) * 100) + '%';
  b.style.top = ((spec?.y ?? 0.05) * 100) + '%';
  overlay.appendChild(b);
  return b;
}

function legendRamp() {
  if (rampCSS) return rampCSS;
  return 'linear-gradient(90deg, #3b2a8f, #3f5fd6, #2fb3e0, #3fd49a, #d8e04a, #f39a3a, #e0453a)';
}

const rank = (z) => (['xs', 'sm', 'md', 'lg'].includes(z) ? z : 'sm');

function buildOverlay() {
  overlay.textContent = '';
  $('stackA').textContent = '';
  $('stackB').textContent = '';
  const L = meta.layout ?? {};

  // title, subtitle, time, 7-day bar
  const t = block(L.title, 'title');
  const lines = TITLE_LINES[meta.id] ?? [meta.title];
  t.appendChild(el('div', 't-title', lines.map(esc).join('<br>')));
  t.appendChild(el('div', 't-sub', esc(meta.subtitle || 'A Week of Currents')));
  const time = el('div', 't-time mono');
  t.appendChild(time);
  const prog = el('div', 'prog');
  prog.setAttribute('role', 'slider');
  prog.setAttribute('aria-label', 'Time in the week');
  prog.setAttribute('aria-valuemin', '0');
  prog.setAttribute('aria-valuemax', String(lastHour()));
  const days = Math.round(lastHour() / 24);
  for (let i = 1; i < days; i++) {
    const tick = el('div', 'tick');
    tick.style.left = (i / days * 100) + '%';
    prog.appendChild(tick);
  }
  const fill = el('div', 'fill');
  const knob = el('div', 'knob');
  prog.append(fill, knob);
  t.appendChild(prog);
  bindScrub(prog);

  // legend
  const g = block(L.legend, 'legend');
  g.appendChild(el('div', 'l-head mono', 'Water temperature'));
  const bar = el('div', 'l-bar');
  bar.style.background = legendRamp();
  g.appendChild(bar);
  const lf = meta.legendF ?? { min: 51, max: 61 };
  g.appendChild(el('div', 'l-ends mono', `<span>${lf.min}°F</span><span>${lf.max}°F</span>`));
  g.appendChild(el('div', 'l-foot mono', 'Brightness = speed'));

  // brand
  const b = block(L.brand, 'brand');
  b.appendChild(el('div', 'b-name', '<span class="star">✦</span>STELLA NOVA'));
  b.appendChild(el('div', 'b-url mono', 'davesgames.io'));

  // credit
  const c = block(L.credit, 'credit');
  c.appendChild(el('div', 'c-line mono', esc(`NOAA ${modelShort(meta)} model`)));
  c.appendChild(el('div', 'c-line mono', esc(meta.dates ?? '')));

  // place labels
  for (const lb of meta.labels ?? []) {
    if (!(lb.x >= 0 && lb.x <= 1 && lb.y >= 0 && lb.y <= 1)) continue;
    const n = el('div', `lbl s-${lb.side === 'left' ? 'left' : 'right'} z-${lb.size || 'sm'}`);
    n.dataset.size = rank(lb.size);
    n.style.left = (lb.x * 100) + '%';
    n.style.top = (lb.y * 100) + '%';
    n.append(el('div', 'dot'), el('div', 'txt', esc(lb.name)));
    overlay.appendChild(n);
  }

  ui = { time, prog, fill, knob, blocks: { title: t, legend: g, brand: b, credit: c } };
  shownHour = -1;
  updateClockUI(true);
}

function updateClockUI(force) {
  if (!ui.fill) return;
  const f = Math.min(1, Math.max(0, hour / lastHour()));
  ui.fill.style.transform = `scaleX(${f})`;
  ui.knob.style.left = (f * 100) + '%';
  const h = Math.floor(hour);
  if (force || h !== shownHour) {
    shownHour = h;
    ui.time.textContent = stamp(h);
    ui.prog.setAttribute('aria-valuenow', String(h));
    ui.prog.setAttribute('aria-valuetext', stamp(h));
  }
}

function bindScrub(prog) {
  const setFrom = (e) => {
    const r = prog.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    hour = f * lastHour();
    updateClockUI();
  };
  prog.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    scrubbing = true;
    prog.setPointerCapture(e.pointerId);
    setFrom(e);
  });
  prog.addEventListener('pointermove', (e) => { if (scrubbing) setFrom(e); });
  const end = () => { scrubbing = false; };
  prog.addEventListener('pointerup', end);
  prog.addEventListener('pointercancel', end);
}

// Full layout pass: fit, blocks, labels, scale bar.
function relayout() {
  layoutPoster();
  if (mode === 'poster') resolveOverlaps();
  thinLabels();
  placeScale();
}

// ─── scale bar and north arrow ──────────────────────────────────────────────
// Read a coarse water mask from base.png (R = coverage).
function buildCoverGrid(base) {
  coverGrid = null;
  if (!base) return;
  try {
    const gw = 72;
    const gh = Math.max(1, Math.round(gw * base.height / base.width));
    const c = document.createElement('canvas');
    c.width = gw;
    c.height = gh;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(base, 0, 0, gw, gh);
    const px = cx.getImageData(0, 0, gw, gh).data;
    const data = new Float32Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) data[i] = px[i * 4] / 255;
    coverGrid = { w: gw, h: gh, data };
  } catch {
    coverGrid = null;
  }
}

function waterIn(r) {
  if (!coverGrid) return 0.5;
  const { w, h, data } = coverGrid;
  const x0 = Math.max(0, Math.floor(r.x0 * w)), x1 = Math.min(w, Math.ceil(r.x1 * w));
  const y0 = Math.max(0, Math.floor(r.y0 * h)), y1 = Math.min(h, Math.ceil(r.y1 * h));
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += data[y * w + x] > 0.15 ? 1 : 0; n++; }
  return n ? s / n : 1;
}

function niceLength(target) {
  const steps = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];
  let best = steps[0];
  for (const s of steps) if (Math.abs(Math.log(s / target)) < Math.abs(Math.log(best / target))) best = s;
  return best;
}

function placeScale() {
  overlay.querySelector('.scale')?.remove();
  if (!meta || posterPx.u < 0.45) return;       // too small to read
  const bb = meta.bbox;
  const midLat = bb ? (bb.lat0 + bb.lat1) / 2 : 45;
  const mppX = bb
    ? ((bb.lon1 - bb.lon0) * 111320 * Math.cos(midLat * Math.PI / 180)) / meta.width
    : meta.metersPerPixel;
  if (!(mppX > 0)) return;

  // Design pixels across the poster, and meters per design pixel.
  const designW = posterPx.w / posterPx.u;
  const mPerDesign = (mppX * meta.width) / designW;
  const TARGET = 78;                                   // design px
  const km = niceLength((TARGET * mPerDesign) / 1000);
  const mi = niceLength((TARGET * mPerDesign) / 1609.344);
  const kmLen = (km * 1000) / mPerDesign;
  const miLen = (mi * 1609.344) / mPerDesign;

  // Find the corner with the least water and no text on it.
  const pr = poster.getBoundingClientRect();
  const taken = [...overlay.querySelectorAll('.blk, .lbl .txt, .lbl .dot')].map((n) => {
    const r = n.getBoundingClientRect();
    return { x0: (r.left - pr.left) / pr.width, x1: (r.right - pr.left) / pr.width, y0: (r.top - pr.top) / pr.height, y1: (r.bottom - pr.top) / pr.height };
  });
  const bw = (Math.max(kmLen, miLen) + 90) * posterPx.u / pr.width;   // bars + text + arrow
  const bh = 44 * posterPx.u / pr.height;
  const mx = 0.055, my = 0.04 * Math.min(1, meta.width / meta.height) + 0.012;
  const corners = [
    { key: 'tl', x0: mx, y0: my },
    { key: 'tr', x0: 1 - mx - bw, y0: my },
    { key: 'bl', x0: mx, y0: 1 - my - bh },
    { key: 'br', x0: 1 - mx - bw, y0: 1 - my - bh },
  ].map((c) => ({ ...c, x1: c.x0 + bw, y1: c.y0 + bh }));
  const pad = 0.02;
  const hit = (a, b) => a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.y0 - pad < b.y1 && a.y1 + pad > b.y0;
  let best = null;
  for (const c of corners) {
    if (taken.some((t) => hit(c, t))) continue;
    const water = waterIn({ x0: c.x0 - 0.02, x1: c.x1 + 0.02, y0: c.y0 - 0.02, y1: c.y1 + 0.02 });
    if (!best || water < best.water) best = { ...c, water };
  }
  if (!best || best.water > 0.6) return;              // no quiet corner: leave it out

  const right = best.key[1] === 'r';
  const s = el('div', `scale a-${right ? 'right' : 'left'}`);
  s.style.left = ((right ? best.x1 : best.x0) * 100) + '%';
  s.style.top = (best.y0 * 100) + '%';
  s.innerHTML =
    `<div class="north"><svg viewBox="0 0 9 20" aria-hidden="true">` +
      `<path d="M4.5 0 L8.6 11 L4.5 8.6 L0.4 11 Z" fill="rgba(236,236,232,0.9)"/>` +
      `<line x1="4.5" y1="9" x2="4.5" y2="20" stroke="rgba(236,236,232,0.5)" stroke-width="0.8"/>` +
    `</svg><span>N</span></div>` +
    `<div class="bars">` +
      `<div class="row"><i style="width:calc(var(--u) * ${kmLen.toFixed(2)})"></i><span>${km} km</span></div>` +
      `<div class="row mi"><i style="width:calc(var(--u) * ${miLen.toFixed(2)})"></i><span>${mi} mi</span></div>` +
    `</div>`;
  s.setAttribute('aria-label', `Scale: ${km} kilometers, ${mi} miles. North is up.`);
  overlay.appendChild(s);
}

// ─── caption ────────────────────────────────────────────────────────────────
function fmtKnots(k) {
  const r = Math.round(k * 2) / 2;
  const n = Number.isInteger(r) ? String(r) : r.toFixed(1);
  const word = Math.abs(r - k) < 0.05 ? 'about' : r > k ? 'nearly' : 'just over';
  return `${word} ${n} knots`;
}

function nearestPlace(p) {
  let best = null;
  for (const lb of meta.labels ?? []) {
    const d = Math.hypot((lb.x - p.x) * meta.width, (lb.y - p.y) * meta.height) / Math.max(meta.width, meta.height);
    if (!best || d < best.d) best = { d, name: lb.name };
  }
  return best && best.d < 0.07 ? titleCase(best.name) : null;
}

function captionHTML() {
  const paras = (CAPTIONS[meta.id] ?? []).map((p) => `<p>${esc(p)}</p>`);
  const pk = meta.peak;
  if (pk && pk.knots > 0) {
    const near = pk.x != null ? nearestPlace(pk) : null;
    const when = pk.hour != null ? stamp(pk.hour).replace(/^(\d+) ([A-Z]+)/, (m, d, mo) => `${d} ${mo[0]}${mo.slice(1).toLowerCase()}`) : null;
    paras.push(`<p>At its strongest this week, the fastest surface water on this map ran at ${fmtKnots(pk.knots)}` +
      `${near ? `, near ${esc(near)}` : ''}${when ? ` (${esc(when)})` : ''}.</p>`);
  }
  paras.push(`<p>Color shows the water temperature at the surface. Brightness shows the speed of the current.</p>`);
  const model = meta.modelLong || `NOAA ${modelShort(meta)}`;
  paras.push(`<p class="data">Data: ${esc(model)} (${esc(modelShort(meta))}, model), ${esc(titleCase(meta.dates ?? ''))}. Hourly surface currents and temperature.</p>`);
  return paras.join('');
}

function setCaption(open) {
  captionEl.hidden = !open;
  $('info').setAttribute('aria-pressed', String(open));
  if (open && meta) {
    $('capTitle').innerHTML = `${esc(meta.title)}<small>${esc(meta.subtitle || 'A Week of Currents')}</small>`;
    $('capBody').innerHTML = captionHTML();
  }
}

// On a phone the caption is a bottom sheet. Drag the grip down to close it.
function bindSheetDrag() {
  const grip = $('capGrip');
  let y0 = null;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    const dy = Math.max(0, e.clientY - y0);
    captionEl.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    y0 = null;
    captionEl.style.transform = '';
    if (dy > 70) setCaption(false);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// ─── controls ───────────────────────────────────────────────────────────────
function buildDots() {
  const dots = $('dots');
  dots.textContent = '';
  locs.forEach((l, i) => {
    const d = el('button');
    d.type = 'button';
    d.title = l.title;
    d.setAttribute('aria-label', l.title);
    d.addEventListener('click', () => switchTo(i));
    dots.appendChild(d);
  });
}

function syncControls() {
  $('locName').textContent = locs[locIndex]?.title ?? '';
  [...$('dots').children].forEach((d, i) => d.setAttribute('aria-current', String(i === locIndex)));
  const p = $('play');
  p.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  p.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function setPlaying(v) {
  playing = v;
  syncControls();
}

function step(d) {
  switchTo((locIndex + d + locs.length) % locs.length);
}

let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), IDLE_MS);
}

function bindInput() {
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('play').addEventListener('click', () => setPlaying(!playing));
  $('info').addEventListener('click', () => setCaption(captionEl.hidden));
  $('capClose').addEventListener('click', () => setCaption(false));
  bindSheetDrag();

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    wake();
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'i' || e.key === 'I') setCaption(captionEl.hidden);
    else if (e.key === 'Escape') setCaption(false);
  });

  // On touch, the idle strip is hidden. The first tap only shows it again.
  let tapWhileIdle = false;
  window.addEventListener('pointerdown', (e) => {
    tapWhileIdle = e.pointerType !== 'mouse' && document.body.classList.contains('idle');
  }, { capture: true, passive: true });
  $('controls').addEventListener('click', (e) => {
    if (tapWhileIdle) { e.stopPropagation(); e.preventDefault(); tapWhileIdle = false; }
  }, { capture: true });
  for (const ev of ['pointermove', 'pointerdown', 'touchstart', 'wheel']) {
    window.addEventListener(ev, wake, { passive: true });
  }
  window.addEventListener('orientationchange', () => setTimeout(onResizeNow, 250));

  // No zoom and no scroll inside the page.
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 || !captionEl.contains(e.target)) e.preventDefault();
  }, { passive: false });
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {        // no double-tap zoom
    const now = e.timeStamp;
    if (now - lastTap < 320 && !e.target.closest('button')) e.preventDefault();
    lastTap = now;
  }, { passive: false });

  // Swipe left or right on the poster to change the location.
  let sw = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') sw = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  });
  stage.addEventListener('pointerup', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50 && e.timeStamp - sw.t < 600) step(dx < 0 ? 1 : -1);
    sw = null;
  });

  let rz = 0;
  function onResizeNow() { if (meta) relayout(); }
  const onResize = () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { if (meta) relayout(); });
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  window.addEventListener('hashchange', () => {
    const i = locs.findIndex((l) => l.id === location.hash.slice(1));
    if (i >= 0 && i !== locIndex) switchTo(i);
  });
  document.addEventListener('visibilitychange', () => { lastT = null; });
}

// ─── dataset switch ─────────────────────────────────────────────────────────
async function loadMetaOnly(url) {
  const res = await fetch(new URL('meta.json', url));
  if (!res.ok) throw new Error(`meta.json ${res.status}`);
  return { meta: await res.json(), images: null };
}

async function switchTo(i, initial = false) {
  const token = ++switchToken;
  locIndex = i;
  const loc = locs[i];
  syncControls();
  storeSet(loc.id);
  if (location.hash.slice(1) !== loc.id) history.replaceState(null, '', '#' + loc.id);

  fadeEl.classList.remove('clear');
  const slow = setTimeout(() => { if (token === switchToken) loadingEl.hidden = false; }, initial ? 0 : 380);
  const url = new URL(`data/${loc.id}/`, import.meta.url).href;
  let ds;
  try {
    const [d] = await Promise.all([
      engineMod?.loadDataset ? engineMod.loadDataset(url) : loadMetaOnly(url),
      wait(initial ? 0 : 320),
    ]);
    ds = d;
  } catch (err) {
    clearTimeout(slow);
    if (token !== switchToken) return;
    console.warn('tidal-currents: dataset load failed', loc.id, err);
    loadingEl.hidden = false;
    loadingEl.lastChild.textContent = `${loc.title}: data not available`;
    return;
  }
  clearTimeout(slow);
  if (token !== switchToken) return;

  dataset = ds;
  meta = { id: loc.id, ...ds.meta };
  if (!meta.id) meta.id = loc.id;
  hour = Math.min(hour, lastHour());
  buildOverlay();
  layoutPoster();
  buildCoverGrid(ds.images?.base);
  if (engine) engine.setDataset(ds);
  loadingEl.hidden = true;
  loadingEl.lastChild.textContent = 'Loading';
  if (!captionEl.hidden) setCaption(true);
  fillFallback();
  await document.fonts?.ready;
  if (token !== switchToken) return;
  relayout();
  requestAnimationFrame(() => fadeEl.classList.add('clear'));
}

// ─── frame loop ─────────────────────────────────────────────────────────────
function frame(t) {
  requestAnimationFrame(frame);
  const dt = lastT == null ? 0 : Math.min(0.1, Math.max(0, (t - lastT) / 1000));
  lastT = t;
  if (!meta) return;
  const span = lastHour();
  if (playing && !scrubbing) {
    hour += dt * (span / WEEK_SECONDS);
    if (hour >= span) hour -= span;
  }
  updateClockUI();
  if (engine && dataset) {
    try {
      engine.render(hour, dt);
    } catch (err) {
      console.error('tidal-currents: render failed', err);
      engine = null;
      showFallback();
    }
  }
}

function showFallback() {
  poster.classList.add('no-gpu');
  document.body.classList.add('no-gpu');
  fallbackEl.hidden = false;
  fillFallback();
}

// The fallback names the location, so the title block can stay hidden.
function fillFallback() {
  if (fallbackEl.hidden) return;
  const title = meta?.title ?? locs[locIndex]?.title ?? '';
  const when = meta ? stamp(hour) : '';
  fallbackEl.innerHTML =
    `<div class="f-title">${esc(title)}</div>` +
    `<h2>${esc(meta?.subtitle || 'A Week of Currents')}</h2>` +
    (when ? `<div class="f-time">${esc(when)}</div>` : '') +
    '<div class="rule"></div>' +
    '<p>This browser does not offer WebGPU,<br>so the map cannot draw here.<br>Try a recent Chrome, Edge or Safari.</p>';
}

// ─── start ──────────────────────────────────────────────────────────────────
async function start() {
  bindInput();
  wake();

  try {
    const res = await fetch(new URL('data/index.json', import.meta.url));
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length) locs = list;
    }
  } catch { /* keep DEFAULT_LOCS */ }
  buildDots();

  const want = location.hash.slice(1) || storeGet();
  locIndex = Math.max(0, locs.findIndex((l) => l.id === want));
  syncControls();

  try {
    const cm = await import('./colormap.js');
    if (typeof cm.rampCSS === 'function') rampCSS = cm.rampCSS();
    else if (Array.isArray(cm.RAMP)) {
      const n = cm.RAMP.length - 1;
      rampCSS = 'linear-gradient(90deg, ' + cm.RAMP.map((c, i) =>
        `rgb(${c.map((v) => Math.round(v * 255)).join(',')}) ${(i / n * 100).toFixed(1)}%`).join(', ') + ')';
    }
  } catch (err) {
    console.warn('tidal-currents: colormap.js not loaded', err);
  }

  try {
    engineMod = await import('./engine.js');
    engine = await engineMod.createEngine(canvas, { mobile: device().phone });
  } catch (err) {
    console.warn('tidal-currents: WebGPU engine unavailable', err?.message ?? err);
    engine = null;
    showFallback();
  }

  await switchTo(locIndex, true);
  requestAnimationFrame(frame);
}

start();
