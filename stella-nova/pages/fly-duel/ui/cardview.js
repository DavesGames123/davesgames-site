// ============================================================================
//  FLY DUEL  ·  one card on the page as a DOM element  (DOM module)
// ----------------------------------------------------------------------------
//  Every card on the page is drawCard() of ui/cardface.js on a canvas: the
//  gallery, the deck lists, the hand, the 2D table, the inspector and the
//  hover preview. The 3D table and the screensaver call drawCard() on
//  their own canvases. So each card has one design everywhere.
//
//  A card element is a shell:
//      <div class="fcard fx cv f-<frame> t-<type> [mini] [tapped] ..."
//           data-id data-state data-mode data-zoom>
//        <canvas aria-hidden="true"></canvas>
//        <div class="cv-sr"> name, type line, rules, P/T, credit </div>
//      </div>
//  The canvas has the picture. The cv-sr layer has the same words as text
//  for screen readers and for find-in-page. It is not visible.
//
//  cardHTML() (ui/board.js) writes the shell as a string, so a table can
//  set innerHTML. hydrate(root) then finds each new shell and draws it.
//  cardEl() does both steps and returns the element.
//
//  Drawing rules:
//    - The canvas has CSS width x devicePixelRatio pixels (maximum 3).
//    - mode 'auto': thumbnail below 180 CSS px, full card above.
//    - A shell off screen draws when it comes within 300 px of the view
//      (IntersectionObserver). A shell on screen draws at once, so a table
//      that sets innerHTML again does not flash empty cards.
//    - A shell draws again when its picture loads, when the web fonts
//      load, and when its width changes (ResizeObserver).
//    - Drawn faces stay in a small cache (id, state, size), so a new
//      shell with the same face copies the bitmap.
//
//  Zoom. An element with data-zoom and data-id (a shell, a deck row) opens
//  the inspector on a click or tap: a large card and its text in a
//  dialog. A mouse that stays on a card for 0.3 s shows a large preview
//  next to it. A page that uses the click for something else (play a
//  card) calls preventDefault() in its own listener. A long press (0.5 s)
//  then opens the inspector.
//
//  No DOM work at import time. node tests can import this module.
//
//  GREP MAP
//      grep -n 'export function registerCard'  a card not in game/cards.js
//      grep -n 'export function cardOf'        id -> card definition
//      grep -n 'export function shellHTML'     the shell as a string
//      grep -n 'export function cardEl'        the shell as an element
//      grep -n 'export function hydrate'       draw the shells in a root
//      grep -n 'export function redrawAll'     draw every live shell again
//      grep -n 'function paint'                one shell -> its canvas
//      grep -n 'export function glyphHTML'     cost glyphs as a canvas
//      grep -n 'export function openInspector' the large card dialog
//      grep -n 'function preview'              hover preview
//      grep -n 'function installZoom'          click, hover, long press
// ============================================================================
import * as CM from '../game/cards.js';
import { drawCard, drawManaGlyph, costList, loadCardArt, getCardArt, typeLine, rulesRuns, artCredit, frameKind, hasPlate, artURL, TOKEN_NOTE, cardMode, loadArtIndex } from './cardface.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hasDOM = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

// ------------------------------------------------------------ card lookup
const extra = new Map();
// A card that is not in game/cards.js (a test card, a preview of a new
// card). Shells find it by id.
export function registerCard(card) { if (card && card.id != null && !CM.CARD?.[card.id]) extra.set(String(card.id), card); return card; }
export function cardOf(id) { return CM.CARD?.[id] || extra.get(String(id)) || null; }

// ------------------------------------------------------------ the shell
const STATE_KEYS = ['tapped', 'sick', 'attacking', 'blocking', 'hot', 'dead', 'dim', 'damage', 'pp', 'pt'];
function cleanState(st = {}) {
  const o = {};
  for (const k of STATE_KEYS) if (st[k]) o[k] = typeof st[k] === 'number' ? st[k] | 0 : true;
  return o;
}

function rulesHTML(card) {
  return rulesRuns(card).map(r => r.s === 'b' ? `<b>${esc(r.t)}</b>` : r.s === 'i' ? `<i>${esc(r.t)}</i>` : esc(r.t)).join('');
}

// The shell as an HTML string. opts: { mini, state, size (CSS px width),
// mode ('auto' | 'thumb' | 'full'), zoomable (default true), count,
// uid, cls, art: a fallback picture (SVG string) for an unknown id }.
export function shellHTML(card, opts = {}) {
  if (!card) return `<div class="fcard fx cv unknown${opts.mini ? ' mini' : ''}"><div class="cv-sr"><span class="fx-name">?</span></div></div>`;
  registerCard(card);
  const st = cleanState(opts.state);
  const pp = st.pp | 0, pt = st.pt | 0;
  const cls = ['fcard', 'fx', 'cv', `f-${frameKind(card)}`, `t-${esc(card.type)}`, card.token ? 'token' : '', opts.mini ? 'mini' : '',
    st.tapped ? 'tapped' : '', st.sick ? 'sick' : '', st.hot ? 'hot' : '', st.attacking ? 'attacking' : '', st.blocking ? 'blocking' : '',
    (pp || pt) ? 'pumped' : '', opts.cls || ''].filter(Boolean).join(' ');
  const zoom = opts.zoomable === false ? '' : ' data-zoom="1" tabindex="0" role="button"';
  const size = opts.size ? ` style="width:${+opts.size}px"` : '';
  const mode = opts.mode || 'auto';
  const plate = hasPlate(card.id) ? ` data-art="${esc(artURL(card.id, { small: !!opts.mini }))}"` : '';
  const uid = (opts.uid != null ? ` data-uid="${esc(opts.uid)}"` : '') + (opts.count ? ` data-count="${opts.count | 0}"` : '');
  const pw = (card.power ?? 0) + pp, tw = (card.toughness ?? 0) + pt;
  const ptHTML = card.type === 'creature'
    ? `<span class="fx-pt${(pp || pt) ? ' pumped' : ''}">${st.damage ? `<span class="fx-dmg">${st.damage} damage, </span>` : ''}<span>${pw}/${tw}</span></span>` : '';
  const flav = card.flavour || (card.token ? TOKEN_NOTE : '');
  const credit = artCredit(card.id);
  const fallback = !hasPlate(card.id) && !CM.CARD?.[card.id] && opts.art ? `<span class="fx-art">${opts.art}</span>` : '';
  const label = `${card.name}, ${typeLine(card)}${card.type === 'creature' ? `, ${pw}/${tw}` : ''}`;
  return `<div class="${cls}" data-id="${esc(card.id)}" data-mode="${esc(mode)}" data-state="${esc(JSON.stringify(st))}"${plate}${uid}${zoom}${size} aria-label="${esc(label)}">`
    + `<canvas aria-hidden="true"></canvas>`
    + (opts.count ? `<span class="cv-count">${opts.count | 0}×</span>` : '')
    + `<div class="cv-sr"><span class="fx-name">${esc(card.name)}</span> <span class="fx-type">${esc(typeLine(card))}</span> `
    + `<span class="fx-text">${rulesHTML(card)}${flav ? ` <i>${esc(flav)}</i>` : ''}</span> ${ptHTML}`
    + (credit ? ` <span class="fx-credit">${esc(credit)}</span>` : '') + fallback
    + `</div></div>`;
}

// The shell as an element, drawn (or queued to draw when it comes near
// the view). Without a DOM, returns null.
export function cardEl(card, opts = {}) {
  if (!hasDOM()) return null;
  const box = document.createElement('div');
  box.innerHTML = shellHTML(card, { ...opts, state: opts.state });
  const el = box.firstElementChild || box.firstChild;
  if (!el) return null;
  if (typeof box.removeChild === 'function') box.removeChild(el);
  queueMicrotask(() => hydrateOne(el));
  installZoom();
  return el;
}

// ------------------------------------------------------------ drawing
const live = new Set();
let io = null, ro = null;
const faceCache = new Map();            // key -> canvas
const FACE_CACHE_MAX = 160;
let fontsHooked = false, fontsLoaded = false;

function dprNow() { return Math.min(3, Math.max(1, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1)); }

function parseState(el) {
  try { return JSON.parse(el.dataset?.state || el.getAttribute?.('data-state') || '{}') || {}; } catch { return {}; }
}

function inView(el, margin = 300) {
  if (typeof el.getBoundingClientRect !== 'function') return true;
  const r = el.getBoundingClientRect();
  const vh = (typeof innerHeight === 'number' && innerHeight) || 800, vw = (typeof innerWidth === 'number' && innerWidth) || 1200;
  return r.bottom > -margin && r.top < vh + margin && r.right > -margin && r.left < vw + margin;
}

function observers() {
  if (!io && typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); paint(e.target); }
    }, { rootMargin: '300px' });
  }
  if (!ro && typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(es => {
      for (const e of es) {
        const el = e.target, w = Math.round(e.contentRect?.width || 0);
        if (w && (!el._cvW || Math.abs(w - el._cvW) >= 1)) paint(el);
      }
    });
  }
  if (!fontsHooked && typeof document !== 'undefined' && document.fonts) {
    fontsHooked = true;
    const again = () => { fontsLoaded = true; faceCache.clear(); redrawAll(); };
    document.fonts.ready?.then?.(again);
    document.fonts.addEventListener?.('loadingdone', again);
  }
}

function hydrateOne(el) {
  if (!el || el._cvLive) return;
  el._cvLive = true;
  live.add(el);
  observers();
  ro?.observe(el);
  if (inView(el) || !io) paint(el);
  else io.observe(el);
}

// Draw every new shell under root (after root.innerHTML = ...).
export function hydrate(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  const els = root.querySelectorAll('.cv');
  let n = 0;
  for (const el of els) if (!el._cvLive) { hydrateOne(el); n++; }
  if (n || root.querySelector?.('[data-zoom]')) installZoom();
  hydrateGlyphs(root);
  hydrateThumbs(root);
  return n;
}

// Draw every live shell again (fonts loaded, a theme changed).
export function redrawAll() {
  for (const el of live) {
    if (!el.isConnected) { live.delete(el); ro?.unobserve(el); continue; }
    if (el._cvW) paint(el);
  }
}

// Draw one shell on its canvas. Width from layout (or the size style).
function paint(el) {
  const cv = el.querySelector?.('canvas');
  if (!cv || typeof cv.getContext !== 'function') return;
  const card = cardOf(el.dataset?.id);
  const cssW = Math.round(el.getBoundingClientRect?.().width || el.clientWidth || 0);
  if (!cssW) return;                       // hidden: the ResizeObserver draws it later
  const dpr = dprNow();
  const cssH = Math.round(cssW * 1.4);
  const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
  const state = parseState(el);
  const mode = cardMode(el.dataset?.mode || 'auto', W, dpr);
  const small = W < 300;
  const id = card ? card.id : '?';
  const art = card ? getCardArt(id, { small }) || fallbackArt(el) : null;
  const key = `${id}|${JSON.stringify(state)}|${W}x${H}|${mode}`;
  el._cvW = cssW;
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const hit = faceCache.get(key);
  if (hit) { g.drawImage(hit, 0, 0); return; }
  drawCard(g, card, { w: W, h: H, state, mode, dpr, art });
  if (art && fontsLoaded) remember(key, cv);
  if (card && !art && !el._cvWait) {
    el._cvWait = true;
    loadCardArt(id, { small }).then(() => { el._cvWait = false; if (el.isConnected !== false) paint(el); }, () => { el._cvWait = false; });
  }
}

function remember(key, cv) {
  if (!hasDOM()) return;
  const c = document.createElement('canvas');
  c.width = cv.width; c.height = cv.height;
  const g = c.getContext?.('2d');
  if (!g) return;
  g.drawImage(cv, 0, 0);
  faceCache.set(key, c);
  if (faceCache.size > FACE_CACHE_MAX) faceCache.delete(faceCache.keys().next().value);
}

// The fallback picture of an unknown card: the SVG in its shell, drawn
// into an image once.
function fallbackArt(el) {
  if (el._cvArt !== undefined) return el._cvArt;
  el._cvArt = null;
  const svg = el.querySelector?.('.fx-art svg');
  if (svg && typeof Image === 'function' && typeof XMLSerializer === 'function') {
    const im = new Image();
    const src = new XMLSerializer().serializeToString(svg).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" ');
    im.onload = () => { el._cvArt = im; paint(el); };
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
  }
  return null;
}

// ------------------------------------------------------------ cost glyphs
// The cost of a card as one small canvas (deck rows, filters). hydrate()
// draws it.
export function glyphHTML(cost, size = 14, label = '') {
  const list = costList(cost);
  if (!list.length) return '';
  const json = esc(JSON.stringify(list));
  const txt = label || list.map(([k, n]) => (k === 'generic' ? String(n) : k)).join(' ');
  return `<canvas class="cv-glyphs" data-glyphs="${json}" data-size="${size | 0}" role="img" aria-label="${esc(txt)}" style="width:${list.length * (size + 1)}px;height:${size}px"></canvas>`;
}

function hydrateGlyphs(root) {
  const els = root.querySelectorAll?.('canvas.cv-glyphs') || [];
  const dpr = dprNow();
  for (const cv of els) {
    if (cv._cvDone) continue;
    cv._cvDone = true;
    let list = [];
    try { list = JSON.parse(cv.dataset.glyphs || '[]'); } catch { list = []; }
    const s = +cv.dataset.size || 14;
    cv.width = Math.round(list.length * (s + 1) * dpr); cv.height = Math.round(s * dpr);
    const g = cv.getContext?.('2d');
    if (!g) continue;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    list.forEach(([k, n], i) => drawManaGlyph(g, k, i * (s + 1), 0, s, n));
  }
}

// The picture of a card in a small canvas (a deck row of a card with no
// plate): <canvas class="dl-art" data-art-id>.
function hydrateThumbs(root) {
  const els = root.querySelectorAll?.('canvas[data-art-id]') || [];
  const dpr = dprNow();
  for (const cv of els) {
    if (cv._cvDone) continue;
    cv._cvDone = true;
    const id = cv.dataset.artId;
    const w = +cv.getAttribute('width') || 32, h = +cv.getAttribute('height') || 24;
    loadCardArt(id, { small: true }).then(img => {
      if (!img) return;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
      const g = cv.getContext?.('2d');
      if (!g) return;
      const iw = img.width || 1, ih = img.height || 1, s = Math.max(cv.width / iw, cv.height / ih);
      g.drawImage(img, (iw - cv.width / s) / 2, (ih - cv.height / s) / 2, cv.width / s, cv.height / s, 0, 0, cv.width, cv.height);
    }, () => {});
  }
}

// ------------------------------------------------------------ inspector
let insp = null, lastFocus = null;

function inspectorEl() {
  if (insp) return insp;
  insp = document.createElement('div');
  insp.className = 'cv-inspect';
  insp.hidden = true;
  insp.setAttribute('role', 'dialog');
  insp.setAttribute('aria-modal', 'true');
  insp.setAttribute('aria-label', 'Card');
  insp.innerHTML = `<div class="cv-inspect-box"><div class="cv-inspect-card"></div><div class="cv-inspect-text"></div>`
    + `<button type="button" class="cv-inspect-close" aria-label="Close">Close</button></div>`;
  insp.addEventListener('click', e => { if (e.target === insp || e.target.closest?.('.cv-inspect-close')) closeInspector(); });
  document.body.appendChild(insp);
  return insp;
}

function detailHTML(card, count) {
  const kws = (card.keywords || []).map(k => {
    const t = String(CM.KEYWORDS?.[k] || '').replace(/^[^:]*:\s*/, '');
    return `<li><b>${esc(CM.KEYWORD_NAMES?.[k] || k)}</b>${t ? ` ${esc(t)}` : ''}</li>`;
  }).join('');
  const flav = card.flavour || (card.token ? TOKEN_NOTE : '');
  const credit = artCredit(card.id);
  return `<h3>${esc(card.name)}</h3><p class="cv-i-type">${esc(typeLine(card))}${count ? ` · ${count} in the deck` : ''}</p>`
    + `<p class="cv-i-cost">${glyphHTML(card.cost, 18) || '<span>no cost</span>'}</p>`
    + (card.text ? `<p class="cv-i-rules">${rulesHTML(card)}</p>` : '')
    + (kws ? `<ul class="cv-i-kws">${kws}</ul>` : '')
    + (flav ? `<p class="cv-i-flav">${esc(flav)}</p>` : '')
    + (credit ? `<p class="cv-i-credit">${esc(credit)}. Public-domain plate.</p>` : '');
}

// Open the large card in a dialog. card: a definition or an id.
export function openInspector(card, { state = {}, count = 0 } = {}) {
  if (!hasDOM()) return;
  if (typeof card !== 'object') card = cardOf(card);
  if (!card) return;
  hidePreview();
  const box = inspectorEl();
  lastFocus = document.activeElement;
  const slot = box.querySelector('.cv-inspect-card');
  slot.innerHTML = shellHTML(card, { state, mode: 'full', zoomable: false });
  box.querySelector('.cv-inspect-text').innerHTML = detailHTML(card, count);
  box.hidden = false;
  document.documentElement.classList?.add('cv-locked');
  hydrate(box);
  box.querySelector('.cv-inspect-close')?.focus?.({ preventScroll: true });
}

export function closeInspector() {
  if (!insp || insp.hidden) return;
  insp.hidden = true;
  document.documentElement.classList?.remove('cv-locked');
  lastFocus?.focus?.({ preventScroll: true });
}

// ------------------------------------------------------------ hover preview
let pv = null, pvTimer = 0, pvFor = null;

function preview(el) {
  const card = cardOf(el.dataset.id);
  if (!card || insp && !insp.hidden) return;
  if (!pv) {
    pv = document.createElement('div');
    pv.className = 'cv-preview';
    pv.hidden = true;
    pv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(pv);
  }
  pvFor = el;
  pv.innerHTML = shellHTML(card, { state: parseState(el), mode: 'full', zoomable: false });
  const r = el.getBoundingClientRect();
  const W = 300, H = 420, gap = 12;
  const vw = innerWidth, vh = innerHeight;
  let x = r.right + gap;
  if (x + W > vw - 8) x = r.left - gap - W;
  if (x < 8) x = Math.max(8, Math.min(vw - W - 8, r.left + r.width / 2 - W / 2));
  const y = Math.max(8, Math.min(vh - H - 8, r.top + r.height / 2 - H / 2));
  pv.style.left = `${Math.round(x)}px`; pv.style.top = `${Math.round(y)}px`;
  pv.hidden = false;
  hydrate(pv);
}

function hidePreview() { clearTimeout(pvTimer); pvFor = null; if (pv) pv.hidden = true; }

// ------------------------------------------------------------ zoom events
let zoomOn = false;
function installZoom() {
  if (zoomOn || !hasDOM() || typeof document.addEventListener !== 'function') return;
  zoomOn = true;
  const canHover = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
  let press = 0, pressEl = null, pressXY = null, longFired = false;
  const zoomTarget = e => e.target?.closest?.('[data-zoom]');
  document.addEventListener('click', e => {
    const el = zoomTarget(e);
    if (longFired) { longFired = false; e.preventDefault(); return; }
    if (!el || e.defaultPrevented) return;
    e.preventDefault();
    openInspector(el.dataset.id, { state: parseState(el), count: +(el.dataset.count || 0) });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeInspector(); hidePreview(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target?.matches?.('[data-zoom]')) {
      e.preventDefault();
      openInspector(e.target.dataset.id, { state: parseState(e.target), count: +(e.target.dataset.count || 0) });
    }
  });
  document.addEventListener('pointerdown', e => {
    const el = zoomTarget(e);
    if (!el || e.pointerType === 'mouse') return;
    pressEl = el; pressXY = [e.clientX, e.clientY]; longFired = false;
    clearTimeout(press);
    press = setTimeout(() => { if (pressEl === el) { longFired = true; openInspector(el.dataset.id, { state: parseState(el) }); } }, 500);
  }, { passive: true });
  const cancel = e => {
    if (!pressEl) return;
    if (e.type === 'pointermove' && pressXY && Math.hypot(e.clientX - pressXY[0], e.clientY - pressXY[1]) < 10) return;
    clearTimeout(press); pressEl = null;
  };
  document.addEventListener('pointermove', cancel, { passive: true });
  document.addEventListener('pointerup', cancel, { passive: true });
  document.addEventListener('pointercancel', cancel, { passive: true });
  if (canHover) {
    document.addEventListener('pointerover', e => {
      const el = zoomTarget(e);
      if (!el || e.pointerType !== 'mouse' || el === pvFor) return;
      clearTimeout(pvTimer);
      pvTimer = setTimeout(() => preview(el), 300);
    });
    document.addEventListener('pointerout', e => {
      const el = zoomTarget(e);
      if (el && !el.contains(e.relatedTarget)) hidePreview();
    });
    addEventListener('scroll', hidePreview, { passive: true });
  }
  loadArtIndex();
}
