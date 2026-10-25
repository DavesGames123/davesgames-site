// ============================================================================
//  BLACK OCTOBER  ·  main.js — the page: panel, time bar, card, pan and zoom
// ----------------------------------------------------------------------------
//  Builds the layout once (grow.js, model.js LAYOUT_OPTS), then draws it on
//  #cv on demand: a draw happens only after a change (view, playhead,
//  filter, hover) or while the growth plays. All text that main.js puts in
//  the page comes from data/events.js or model.js, and goes in with
//  textContent, not innerHTML. Source links get target=_blank and
//  rel="noopener noreferrer".
//
//  grep -n targets
//    state .................. "const S ="
//    intro, counts, filters . "function buildPanel"
//    record card ............ "function showCard"
//    crowded-tap choice ..... "function showChoice"
//    event search ........... "function buildFinder"
//    card swipe (phone) ..... "function bindCardSwipe"
//    select + keep in view .. "function select"
//    playhead ............... "function setK"
//    play loop .............. "function tick"
//    pan, zoom, pinch, tap .. "function bindPointer"
//    phone sheet ............ "function setPanel"
//    one frame .............. "function draw"
// ============================================================================
import { EVENTS } from './data/events.js';
import { layout } from './grow.js';
import * as M from './model.js';
import { drawScene, PAL } from './render.js';
import './saver.js';

const PHONE_Q = '(max-width:768px), (max-height:500px) and (pointer:coarse)';
const L = layout(EVENTS, M.LAYOUT_OPTS);
const N = L.nodes.length;
const INDEX = new Map(L.nodes.map((n, i) => [n.id, i]));
const COLORS = M.threadColors(L.threads);
const $ = id => document.getElementById(id);
const cv = $('cv'), g = cv.getContext('2d');
const coarse = () => matchMedia('(pointer:coarse)').matches;
const phone = () => matchMedia(PHONE_Q).matches;

const S = {
  view: null, fit: null, w: 0, h: 0, dpr: 1,
  k: N, frac: 1, playing: false, speed: 1, stepT: 0, last: 0,
  hidden: new Set(), confOff: new Set(),
  hover: null, sel: null, moved: false, raf: 0, anim: null,
};

// el('p', { class: 'x' }, 'text', child) -> element. Strings go in as text.
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  return fill(e, ...kids);
}
// Replace the children of node. Arrays at any depth are flattened, and
// null or false is skipped. A bare replaceChildren() would turn an array
// into "[object HTMLHeadingElement]" text and a null into "null".
function fill(node, ...kids) {
  node.replaceChildren();
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}
const svgGlyph = conf => {
  const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 14 14'); s.setAttribute('aria-hidden', 'true');
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', 7); c.setAttribute('cy', 7); c.setAttribute('r', conf === 'confirmed' ? 4.5 : 4);
  c.setAttribute('fill', conf === 'confirmed' ? '#c3c8d4' : 'none'); c.setAttribute('stroke', '#c3c8d4'); c.setAttribute('stroke-width', 1.3);
  s.append(c);
  if (conf === 'disputed') { const l = document.createElementNS(ns, 'path'); l.setAttribute('d', 'M2 12 L12 2'); l.setAttribute('stroke', '#c3c8d4'); l.setAttribute('stroke-width', 1.3); s.append(l); }
  return s;
};

// ---------------------------------------------------------------- panel
function buildPanel() {
  const c = M.counts(EVENTS), first = L.nodes[0], last = L.nodes[N - 1];
  const post = L.byId.get('label-viral-post'), study = L.byId.get('label-securitytoday');
  const go = (n, text) => el('button', { class: 'inl', onclick: () => select(n.id, true) }, text);
  const lede = $('lede');
  lede.append('A run of security incidents and disclosures got one name, ', el('b', {}, 'Black October'), ', from a widely shared post on X');
  if (post) lede.append(' (', go(post, M.fmtUTC(post.t, 'day')), ')');
  lede.append('. This page is a record of that run, drawn as a growth: ', el('b', {}, `${c.events} events`), ' in ',
    el('b', {}, `${c.threads} threads`), ', from ', go(first, M.fmtUTC(first.t, 'day')), ' to ', go(last, M.fmtUTC(last.t, 'day')),
    ', each with the sources that report it.');
  if (study) lede.append(' ', go(study, 'One analysis in the record'), ' found that most of the listed items were disclosures of attacks that began weeks or months before. The threads stay apart unless a source links them.');
  if (L.band) $('keyBefore').textContent = `${L.band.label} (${L.band.count} events)`;

  const cells = [['events', c.events], ['threads', c.threads], ['sources', c.sources],
    ['confirmed', c.confirmed], ['reported', c.reported], ['disputed', c.disputed]];
  $('counts').append(...cells.map(([k, v]) => el('div', {}, el('b', {}, v), el('span', {}, k))));

  const list = $('threadList');
  for (const th of L.threads) {
    const row = el('button', { class: 'trow', style: `--c:${COLORS.get(th.id)}`, 'aria-pressed': 'true',
      onclick: () => { S.hidden.has(th.id) ? S.hidden.delete(th.id) : S.hidden.add(th.id); syncFilters(); } },
      el('span', { class: 'sw' }), el('span', {}, M.threadName(th.id)), el('span', { class: 'n' }, th.count));
    row.dataset.th = th.id;
    const only = el('button', { class: 'only', 'aria-label': `Show only ${M.threadName(th.id)}`,
      onclick: () => { S.hidden = new Set(L.threads.map(t => t.id).filter(id => id !== th.id)); syncFilters(); } }, 'only');
    list.append(el('li', {}, row, only));
  }
  $('thAll').onclick = () => { S.hidden.clear(); syncFilters(); };
  $('thNone').onclick = () => { S.hidden = new Set(L.threads.map(t => t.id)); syncFilters(); };
  for (const conf of ['confirmed', 'reported', 'disputed']) {
    const b = el('button', { 'aria-pressed': 'true', title: M.CONF_TEXT[conf],
      onclick: () => { S.confOff.has(conf) ? S.confOff.delete(conf) : S.confOff.add(conf); syncFilters(); } },
      svgGlyph(conf), `${conf} ${c[conf]}`);
    b.dataset.conf = conf;
    $('confList').append(b);
  }
}

function syncFilters() {
  for (const b of document.querySelectorAll('.trow')) {
    const off = S.hidden.has(b.dataset.th);
    b.classList.toggle('off', off); b.setAttribute('aria-pressed', String(!off));
  }
  for (const b of document.querySelectorAll('#confList button')) {
    const off = S.confOff.has(b.dataset.conf);
    b.classList.toggle('off', off); b.setAttribute('aria-pressed', String(!off));
  }
  if (S.sel && !visible(L.byId.get(S.sel))) closeCard();
  if (S.hover && !visible(L.byId.get(S.hover))) S.hover = null;
  request();
}
const visible = n => !!n && INDEX.get(n.id) < S.k && !S.hidden.has(n.thread) && !S.confOff.has(n.ev.confidence);

// ---------------------------------------------------------------- card
// A button that selects one event: its title, then its time.
function refBtn(rid) {
  const m = L.byId.get(rid);
  return el('button', { style: `--c:${COLORS.get(m.thread)}`, onclick: () => select(rid, true) },
    m.ev.title, ' ', el('small', {}, M.fmtUTC(m.t, m.ev.tPrecision)));
}
function showCard(id) {
  const n = L.byId.get(id), card = $('card'), body = $('cardBody');
  if (!n) { card.hidden = true; return; }
  const e = n.ev, lk = M.linksOf(L, id), i = INDEX.get(id), ref = refBtn;
  card.style.setProperty('--c', COLORS.get(n.thread));
  const host = u => { try { const x = new URL(u); return x.host + (x.pathname.length > 1 ? x.pathname : ''); } catch (err) { return u; } };
  fill(body,
    el('div', { class: 'th' }, M.threadName(n.thread)),
    el('h3', {}, e.title),
    el('dl', { class: 'meta' },
      el('dt', {}, 'time'), el('dd', {}, `${M.fmtUTC(n.t, e.tPrecision)} · ${M.PREC_TEXT[e.tPrecision] || e.tPrecision}`),
      el('dt', {}, 'kind'), el('dd', {}, M.KIND_TEXT[e.kind] || e.kind),
      el('dt', {}, 'confidence'), el('dd', { class: 'conf-' + e.confidence }, `${e.confidence}: ${M.CONF_TEXT[e.confidence]}`),
      el('dt', {}, 'order'), el('dd', {}, `event ${i + 1} of ${N} in time`)),
    e.summary ? el('p', { class: 'sum' }, e.summary) : null,
    e.note ? el('p', { class: 'note' }, e.note) : null,
    el('h4', {}, e.sources.length === 1 ? '1 source' : `${e.sources.length} sources`),
    el('ol', { class: 'src' }, e.sources.map(s => el('li', {},
      el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.publisher || host(s.url)),
      s.primary ? el('span', { class: 'prim' }, 'primary') : null,
      el('small', {}, host(s.url))))),
    lk.parent ? [el('h4', {}, 'Follows from'), el('div', { class: 'rel' }, ref(lk.parent))] : null,
    lk.children.length ? [el('h4', {}, 'Leads to'), el('div', { class: 'rel' }, lk.children.map(ref))] : null,
    lk.related.length ? [el('h4', {}, 'Linked across threads'), el('div', { class: 'rel' }, lk.related.map(ref))] : null,
  );
  $('cardPrev').disabled = !stepVisible(i, -1);
  $('cardNext').disabled = !stepVisible(i, 1);
  card.hidden = false;
  body.scrollTop = 0; card.scrollTop = 0;
}
function stepVisible(i, d) {
  for (let j = i + d; j >= 0 && j < N; j += d) if (!S.hidden.has(L.nodes[j].thread) && !S.confOff.has(L.nodes[j].ev.confidence)) return L.nodes[j];
  return null;
}
function closeCard() { S.sel = null; $('card').hidden = true; request(); }

// A touch tap on a spot with several dots close together: the card lists
// them, nearest first, and offers a zoom on that spot.
const CHOICE_MAX = 8;
function showChoice(list, x, y) {
  const card = $('card'), more = list.length - CHOICE_MAX;
  S.sel = null;
  if (phone()) setPanel(false);
  card.style.removeProperty('--c');
  fill($('cardBody'),
    el('h3', {}, `${list.length} events at this spot`),
    el('p', { class: 'sum' }, 'Choose one, or zoom in to pull them apart.'),
    el('div', { class: 'rel' }, list.slice(0, CHOICE_MAX).map(n => refBtn(n.id))),
    more > 0 ? el('p', { class: 'sum' }, `and ${more} more`) : null,
    el('button', { class: 'zoomhere', onclick: () => { closeCard(); zoomBy(3, x, y); } }, 'Zoom in here'));
  $('cardPrev').disabled = true; $('cardNext').disabled = true;
  card.hidden = false; card.scrollTop = 0;
  request();
}

// Phone card gestures. Sideways on the card: earlier or later. Down on the
// grip or the button row: close. The card body keeps its vertical scroll
// (touch-action pan-y in style.css), so a downward swipe there scrolls.
function bindCardSwipe() {
  const card = $('card');
  let s = null, swiped = false;
  card.addEventListener('pointerdown', e => {
    s = phone() && e.pointerType !== 'mouse' ? { x: e.clientX, y: e.clientY, top: !!e.target.closest('#cardGrip, .card-nav') } : null;
  });
  card.addEventListener('pointerup', e => {
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y, top = s.top;
    s = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
      const b = $(dx < 0 ? 'cardNext' : 'cardPrev');
      if (!b.disabled) b.click();
      swiped = true;
    } else if (top && dy > 50 && dy > 1.5 * Math.abs(dx)) { closeCard(); swiped = true; }
    if (swiped) setTimeout(() => { swiped = false; }, 400);
  });
  card.addEventListener('pointercancel', () => { s = null; });
  // The swipe does not also press the button it started on. The
  // b.click() above is not trusted, so it goes through.
  card.addEventListener('click', e => { if (swiped && e.isTrusted) { e.preventDefault(); e.stopPropagation(); swiped = false; } }, true);
}

// ---------------------------------------------------------------- finder
// Event search in the panel. No query lists the newest events. A tap
// selects the event; on a phone the sheet closes and the card opens.
const FIND_PAGE = 12;
function buildFinder() {
  const q = $('findQ');
  let shown = FIND_PAGE, timer = 0;
  const run = () => {
    const all = M.findEvents(L.nodes, q.value), word = q.value.trim();
    $('findNote').textContent = !word ? 'Newest first.' : all.length ? `${all.length} ${all.length === 1 ? 'event matches' : 'events match'}, newest first.` : 'No event matches.';
    fill($('findList'), ...all.slice(0, shown).map(n => el('li', {},
      el('button', { class: 'frow', style: `--c:${COLORS.get(n.thread)}`, onclick: () => { q.blur(); select(n.id, true); } },
        el('span', { class: 'sw' }),
        el('span', { class: 'ft' }, n.ev.title, el('small', {}, `${M.fmtUTC(n.t, n.ev.tPrecision)} · ${M.threadName(n.thread)}`))))));
    $('findMore').hidden = all.length <= shown;
    $('findMore').textContent = `Show more (${all.length - shown} more)`;
  };
  q.addEventListener('input', () => { shown = FIND_PAGE; clearTimeout(timer); timer = setTimeout(run, 120); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') q.blur(); });
  // On a phone the keyboard covers the base of the screen: open the sheet
  // to full height so the box and the first results stay above it.
  q.addEventListener('focus', () => { if (phone()) { $('panel').classList.add('full'); setTimeout(() => q.scrollIntoView({ block: 'start', behavior: 'smooth' }), 320); } });
  $('findMore').onclick = () => { shown += FIND_PAGE; run(); };
  run();
}

// Select a node. From a link (fromUI): show it even when the playhead or a
// filter hides it, and move the view when an overlay covers it.
function select(id, fromUI = false) {
  const n = L.byId.get(id);
  if (!n) return;
  if (fromUI) {
    if (INDEX.get(id) >= S.k) { stop(); setK(N); }
    S.hidden.delete(n.thread); S.confOff.delete(n.ev.confidence); syncFilters();
  }
  S.sel = id;
  if (phone()) setPanel(false);
  showCard(id);
  keepInView(n);
  request();
}

// The part of the canvas that no overlay covers, in CSS px.
function freeRect() {
  const r = { x0: 0, y0: document.documentElement.classList.contains('in-frame') ? 0 : 44, x1: S.w, y1: $('timebar').getBoundingClientRect().top };
  const p = $('panel').getBoundingClientRect(), c = $('card').hidden ? null : $('card').getBoundingClientRect();
  if (!phone() && document.body.classList.contains('panel-open')) r.x0 = p.right;
  if (c) { if (phone() && c.width > S.w * 0.8) r.y1 = Math.min(r.y1, c.top); else r.x1 = Math.min(r.x1, c.left); }
  if (phone() && document.body.classList.contains('panel-open') && p.width > S.w * 0.8) r.y1 = Math.min(r.y1, p.top);
  if (r.y1 - r.y0 < 80) r.y1 = r.y0 + 80;
  return r;
}
function keepInView(n) {
  const r = freeRect(), [x, y] = M.toScreen(S.view, n.x, n.y), m = 28;
  if (x > r.x0 + m && x < r.x1 - m && y > r.y0 + m && y < r.y1 - m) return;
  const to = M.centreOn(S.view, n.x, n.y, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
  S.anim = { from: { ...S.view }, to, t0: performance.now() };
  S.moved = true;
  request();
}

// ---------------------------------------------------------------- playhead
function setK(k, frac = 1) {
  S.k = Math.max(0, Math.min(N, k)); S.frac = frac;
  $('scrub').value = S.k;
  const n = S.k ? L.nodes[S.k - 1] : null;
  $('tLabel').textContent = n ? `${M.fmtUTC(n.t, n.ev.tPrecision)} · ${n.ev.title}` : `${M.fmtUTC(L.nodes[0].t, L.nodes[0].ev.tPrecision)} is the first event`;
  $('tCount').textContent = `${S.k} of ${N}`;
  if (S.sel && INDEX.get(S.sel) >= S.k) closeCard();
  request();
}
// Seconds for one event: a long step in time gets a longer step on screen,
// so the growth front moves at an even pace.
function stepSec(k) {
  if (k <= 0 || k >= N) return 0.3;
  return Math.min(0.9, Math.max(0.12, 0.12 + 2.6 * (L.nodes[k].r - L.nodes[k - 1].r)));
}
function play() {
  if (S.k >= N) setK(0);
  S.playing = true; S.stepT = 0; S.last = 0;
  $('play').textContent = '❚❚'; $('play').classList.add('on'); $('play').setAttribute('aria-label', 'Pause');
  request();
}
function stop() {
  S.playing = false; S.frac = 1;
  $('play').textContent = '▶'; $('play').classList.remove('on'); $('play').setAttribute('aria-label', 'Play the growth');
  request();
}
function tick(now) {
  const dt = S.last ? Math.min(0.1, (now - S.last) / 1000) : 0; S.last = now;
  S.stepT += dt * S.speed;
  while (S.playing && S.stepT >= stepSec(S.k)) {
    S.stepT -= stepSec(S.k);
    if (S.k + 1 >= N) { setK(N); stop(); break; }
    setK(S.k + 1);
  }
  if (S.playing) S.frac = Math.min(1, S.stepT / stepSec(S.k));
}

// ---------------------------------------------------------------- panel open
function setPanel(open) {
  document.body.classList.toggle('panel-open', open);
  document.body.classList.toggle('panel-closed', !open);
  $('panelBtn').setAttribute('aria-expanded', String(open));
  if (!open) $('panel').classList.remove('full');
  if (open && phone() && S.sel) closeCard();
  resize();
}
function bindSheet() {
  const grip = $('sheetGrip'), panel = $('panel');
  let y0 = null;
  grip.addEventListener('pointerdown', e => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setPanel(false); }
  });
}

// ---------------------------------------------------------------- view
function resize() {
  const dpr = Math.min(3, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  S.w = w; S.h = h; S.dpr = dpr;
  const r = freeRect(), cardOpen = !$('card').hidden;
  if (cardOpen && !phone()) r.x1 = w;          // the fit does not shrink for the card
  if (cardOpen && phone()) r.y1 = $('timebar').getBoundingClientRect().top;
  S.fit = M.fitView({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 });
  if (!S.view || !S.moved) S.view = { ...S.fit };
  request();
}
const minS = () => S.fit.s * 0.5, maxS = () => S.fit.s * 60;
function zoomBy(f, px = S.fit.ox, py = S.fit.oy) {
  S.view = M.zoomAt(S.view, f, px, py, minS(), maxS()); S.moved = true; S.anim = null; hideHint(); request();
}
function fitAll() {
  S.anim = { from: { ...S.view }, to: { ...S.fit }, t0: performance.now() };
  S.moved = false; request();
}
let hinted = false;
function hideHint() { if (!hinted) { hinted = true; $('hint').style.opacity = 0; } }

function bindPointer() {
  const pts = new Map();
  let drag = null, pinch = null, lastTap = { t: 0, x: 0, y: 0 };
  const reach = () => coarse() ? 22 : 12;
  // Crowded: the second dot is not clearly farther from the finger than the
  // first, so the nearest one may not be the one the user meant.
  const crowded = (near, x, y) => {
    if (near.length < 2) return false;
    const d = n => { const [a, b] = M.toScreen(S.view, n.x, n.y); return Math.hypot(a - x, b - y); };
    return d(near[1]) - d(near[0]) < 10;
  };
  const at = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    pts.set(e.pointerId, { x, y });
    S.anim = null;
    if (pts.size === 1) drag = { x0: x, y0: y, view: { ...S.view }, moved: false, type: e.pointerType };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view: { ...S.view } };
      if (drag) drag.moved = true;
    }
  });
  cv.addEventListener('pointermove', e => {
    const [x, y] = at(e);
    if (!pts.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        const n = M.pick(L.nodes, S.view, x, y, reach(), (m, i) => visible(m));
        const id = n ? n.id : null;
        cv.classList.toggle('over', !!n);
        if (id !== S.hover) { S.hover = id; if (!S.sel) { if (id) showCard(id); else $('card').hidden = true; } request(); }
      }
      return;
    }
    pts.set(e.pointerId, { x, y });
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      let v = M.zoomAt(pinch.view, d / pinch.d, pinch.mx, pinch.my, minS(), maxS());
      v = { ...v, cx: v.cx - (mx - pinch.mx) / v.s, cy: v.cy - (my - pinch.my) / v.s };
      S.view = v; S.moved = true; hideHint(); request();
    } else if (drag) {
      const dx = x - drag.x0, dy = y - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; cv.classList.add('drag'); }
      if (drag.moved) { S.view = { ...drag.view, cx: drag.view.cx - dx / drag.view.s, cy: drag.view.cy - dy / drag.view.s }; S.moved = true; hideHint(); request(); }
    }
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    const [x, y] = at(e);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) { const [p] = [...pts.values()]; drag = { x0: p.x, y0: p.y, view: { ...S.view }, moved: true }; return; }
    cv.classList.remove('drag');
    if (drag && !drag.moved && e.type === 'pointerup') {
      const near = M.pickAll(L.nodes, S.view, x, y, reach(), m => visible(m)), n = near[0];
      const now = performance.now();
      if (n && drag.type !== 'mouse' && crowded(near, x, y)) showChoice(near, x, y);
      else if (n) select(n.id);
      else if (drag.type !== 'mouse' && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) zoomBy(2, x, y);
      else if (S.sel) closeCard();
      lastTap = { t: now, x, y };
    }
    drag = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  // Leaving the canvas (for example into the card) keeps the card open.
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && S.hover) { S.hover = null; cv.classList.remove('over'); request(); } });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = at(e), k = e.deltaMode === 1 ? 16 : 1;
    zoomBy(Math.exp(-e.deltaY * k * (e.ctrlKey ? 0.01 : 0.0016)), x, y);
  }, { passive: false });
  cv.addEventListener('dblclick', e => { const [x, y] = at(e); zoomBy(2, x, y); });
}

// On a small screen the fit view holds 900+ dots in a disc of about 170 px:
// smaller dots there, so fewer dots cover others. Full size at 2x zoom.
function dotScale(zoom) {
  return Math.min(S.w, S.h) >= 560 ? 1 : Math.min(1, 0.7 * Math.sqrt(Math.max(1, zoom)));
}

// ---------------------------------------------------------------- frame
function request() { if (!S.raf) S.raf = requestAnimationFrame(frame); }
function frame(now) {
  S.raf = 0;
  if (window.__boSaver) return;
  if (S.playing) tick(now);
  if (S.anim) {
    const u = Math.min(1, (now - S.anim.t0) / 380), s = u * u * (3 - 2 * u), a = S.anim.from, b = S.anim.to;
    S.view = { cx: a.cx + (b.cx - a.cx) * s, cy: a.cy + (b.cy - a.cy) * s, s: a.s * Math.pow(b.s / a.s, s), ox: b.ox, oy: b.oy };
    if (u >= 1) S.anim = null;
  }
  draw();
  if (S.playing || S.anim) request();
}
function draw() {
  g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  const growing = S.playing && S.k < N;
  const front = growing ? L.nodes[Math.max(0, S.k - 1)].t + ((L.nodes[S.k] || L.nodes[N - 1]).t - L.nodes[Math.max(0, S.k - 1)].t) * S.frac : null;
  drawScene(g, L, {
    w: S.w, h: S.h, view: S.view, zoom: S.view.s / S.fit.s,
    k: growing ? S.k + 1 : S.k, frac: growing ? S.frac : 1,
    colors: COLORS, hidden: S.hidden, confOff: S.confOff, hover: S.hover, sel: S.sel,
    front, labels: 'auto', font: coarse() ? 12 : 11, names: M.threadName, index: INDEX,
    dotScale: dotScale(S.view.s / S.fit.s),
  });
}

// ---------------------------------------------------------------- start
function start() {
  buildPanel();
  $('scrub').max = N;
  setK(N);
  setPanel(!phone());
  bindPointer();
  bindSheet();
  bindCardSwipe();
  buildFinder();
  $('panelBtn').onclick = () => setPanel(!document.body.classList.contains('panel-open'));
  $('panelClose').onclick = () => setPanel(false);
  $('play').onclick = () => (S.playing ? stop() : play());
  $('speed').onclick = () => { S.speed = S.speed >= 8 ? 1 : S.speed * 2; $('speed').textContent = `${S.speed}×`; };
  $('scrub').addEventListener('input', e => { stop(); setK(+e.target.value); });
  $('zIn').onclick = () => zoomBy(1.6);
  $('zOut').onclick = () => zoomBy(1 / 1.6);
  $('zFit').onclick = fitAll;
  $('cardClose').onclick = closeCard;
  $('cardPrev').onclick = () => { const n = S.sel && stepVisible(INDEX.get(S.sel), -1); if (n) select(n.id, true); };
  $('cardNext').onclick = () => { const n = S.sel && stepVisible(INDEX.get(S.sel), 1); if (n) select(n.id, true); };
  addEventListener('resize', resize);
  matchMedia(PHONE_Q).addEventListener?.('change', () => setPanel(!phone()));
  addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && tag !== 'button') { e.preventDefault(); S.playing ? stop() : play(); }
    else if (e.key === 'ArrowRight') { stop(); setK(S.k + 1); }
    else if (e.key === 'ArrowLeft') { stop(); setK(S.k - 1); }
    else if (e.key === 'Escape') { if (S.sel) closeCard(); else if (phone()) setPanel(false); }
    else if (e.key === '+' || e.key === '=') zoomBy(1.4);
    else if (e.key === '-') zoomBy(1 / 1.4);
    else if (e.key === '0') fitAll();
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(request);
  setTimeout(hideHint, 9000);
  resize();
}
start();
// For a probe and for saver.js.
window.__bo = { L, S, COLORS, PAL, request };
