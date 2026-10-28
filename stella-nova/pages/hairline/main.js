// ============================================================================
//  HAIRLINE  ·  main.js — the showcase page: hero, gallery, focus view
// ----------------------------------------------------------------------------
//  Every figure on the page is the real library: vendor/hairline.js, a byte
//  copy of @lucasmarkes/hairline 0.5.1 (MIT, Lucas Marques). This file only
//  mounts figures and wires the controls around them.
//
//  STATE. One object, G: the gallery filter, intensity, palette, stroke and
//  play. A change goes to every mounted figure with fig.update() (intensity,
//  theme, play) or to the custom properties on #gallery (palette, stroke).
//  The palette and the stroke also go to the hero and the focus view.
//
//  MOUNTING. A gallery card mounts its figure when it comes within 600 px
//  of the screen (IntersectionObserver), and keeps it. The library itself
//  stops the work of a figure that is off screen or at rest.
//
//  FOCUS VIEW. #focus is a dialog with one large figure, its read-out, its
//  own intensity and play, and the code for it (code.js snippet()). The
//  arrow buttons and the arrow keys step through the filtered figures.
//
//  GREP MAP
//    grep -n 'function buildGallery'  the cards and the lazy mount
//    grep -n 'function applyLook'     palette and stroke as custom properties
//    grep -n 'function applyAll'      intensity and play to every figure
//    grep -n 'function openFocus'     the focus view
//    grep -n 'function renderCode'    the snippet tabs
//    grep -n 'function buildHero'     the hero figure and its stepper
//    grep -n 'function buildUse'      install tabs and the options table
//    grep -n 'installSaver'           the screensaver hook (saver.js)
// ============================================================================
import * as H from './vendor/hairline.js';
import { FIGURES, GROUPS, PALETTES, PALETTE_KEYS, REPO, figureOf, paletteOf } from './catalog.js';
import { KINDS, INSTALL, snippet } from './code.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const G = { group: 'all', intensity: 0.5, palette: 'ink', stroke: 0.9, play: true };
const cards = new Map();   // fn -> { el, host, read, fig }
const HERO_SET = ['terrain', 'exploded', 'turntable', 'vault', 'keyboard', 'relay', 'dish', 'branches'];

function safe(fn) { try { return fn(); } catch (e) { return null; } }
function load() {
  const s = safe(() => JSON.parse(localStorage.getItem('hairline.look') || 'null'));
  if (!s) return;
  if (PALETTES.some(p => p.id === s.palette)) G.palette = s.palette;
  if (Number.isFinite(s.intensity)) G.intensity = Math.max(0, Math.min(1, s.intensity));
  if (Number.isFinite(s.stroke)) G.stroke = Math.max(0.5, Math.min(2, s.stroke));
  if (typeof s.play === 'boolean') G.play = s.play;
}
function save() { safe(() => localStorage.setItem('hairline.look', JSON.stringify({ palette: G.palette, intensity: G.intensity, stroke: G.stroke, play: G.play }))); }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ------------------------------------------------------------------ LOOK
function applyLook() {
  const pal = paletteOf(G.palette);
  for (const root of [document.documentElement]) {
    for (const k of PALETTE_KEYS) root.style.setProperty('--hairline-' + k, pal.vars[k]);
    root.style.setProperty('--hairline-stroke', String(G.stroke));
  }
  document.documentElement.dataset.plate = pal.theme;
  for (const c of cards.values()) if (c.fig) c.fig.update({ theme: pal.theme });
  if (hero.fig) hero.fig.update({ theme: pal.theme });
  if (focus.fig) focus.fig.update({ theme: pal.theme });
  for (const b of document.querySelectorAll('#palettes button')) b.setAttribute('aria-pressed', String(b.dataset.id === G.palette));
  $('strokeVal').textContent = G.stroke.toFixed(2);
  if (focus.fn) renderCode();
}

function applyAll() {
  for (const c of cards.values()) if (c.fig) c.fig.update({ intensity: G.intensity, play: G.play });
  $('intensityVal').textContent = G.intensity.toFixed(2);
  $('play').setAttribute('aria-pressed', String(G.play));
  $('play').textContent = G.play ? 'Pause tours' : 'Play tours';
}

// --------------------------------------------------------------- GALLERY
function mountCard(c) {
  if (c.fig) return;
  c.fig = H[c.f.fn](c.host, {
    intensity: G.intensity, theme: paletteOf(G.palette).theme, play: G.play,
    onRead: t => { c.read.textContent = t; },
  });
}

function buildGallery() {
  const grid = $('grid');
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { mountCard(cards.get(e.target.dataset.fn)); io.unobserve(e.target); } }, { rootMargin: '600px 0px' })
    : null;
  FIGURES.forEach((f, i) => {
    const card = el('article', 'card');
    card.dataset.fn = f.fn; card.dataset.group = f.group;
    const host = el('div', 'fig');
    const meta = el('div', 'meta');
    const top = el('div', 'meta-top');
    const n = el('span', 'num', String(i + 1).padStart(2, '0'));
    const name = el('h3', null, f.name);
    const read = el('span', 'read');
    read.setAttribute('aria-live', 'off');
    top.append(n, name, read);
    const what = el('p', 'what', f.what);
    const open = el('button', 'open', 'Inspect');
    open.type = 'button';
    open.setAttribute('aria-label', `Inspect ${f.name} and get its code`);
    open.addEventListener('click', () => openFocus(f.fn));
    meta.append(top, what, open);
    card.append(host, meta);
    grid.appendChild(card);
    const c = { f, el: card, host, read, fig: null };
    cards.set(f.fn, c);
    if (io) io.observe(card); else mountCard(c);
  });

  const fl = $('filters');
  for (const g of GROUPS) {
    const b = el('button', null, g.label);
    b.type = 'button'; b.dataset.id = g.id;
    const count = g.id === 'all' ? FIGURES.length : FIGURES.filter(f => f.group === g.id).length;
    b.appendChild(el('span', 'ct', String(count)));
    b.setAttribute('aria-pressed', String(g.id === G.group));
    b.addEventListener('click', () => setGroup(g.id));
    fl.appendChild(b);
  }

  const pl = $('palettes');
  for (const p of PALETTES) {
    const b = el('button');
    b.type = 'button'; b.dataset.id = p.id; b.title = p.label;
    b.setAttribute('aria-label', 'Palette ' + p.label);
    b.style.background = `linear-gradient(135deg, ${p.vars.plate} 0 50%, ${p.vars.hi} 50% 62%, ${p.vars.edge} 62% 76%, ${p.vars.mid} 76%)`;
    b.addEventListener('click', () => { G.palette = p.id; applyLook(); save(); });
    pl.appendChild(b);
  }

  const it = $('intensity');
  it.value = String(G.intensity);
  it.addEventListener('input', () => { G.intensity = Number(it.value); applyAll(); save(); });
  const st = $('stroke');
  st.value = String(G.stroke);
  st.addEventListener('input', () => { G.stroke = Number(st.value); applyLook(); save(); });
  $('play').addEventListener('click', () => { G.play = !G.play; applyAll(); save(); });
}

function visibleFns() { return FIGURES.filter(f => G.group === 'all' || f.group === G.group).map(f => f.fn); }

function setGroup(id) {
  G.group = id;
  for (const b of document.querySelectorAll('#filters button')) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  for (const c of cards.values()) c.el.hidden = !(id === 'all' || c.f.group === id);
  $('shown').textContent = `${visibleFns().length} of ${FIGURES.length}`;
}

// ------------------------------------------------------------------ HERO
const hero = { i: 0, fig: null };
function showHero(i) {
  hero.i = (i + HERO_SET.length) % HERO_SET.length;
  const f = figureOf(HERO_SET[hero.i]);
  if (hero.fig) hero.fig.destroy();
  hero.fig = H[f.fn]($('heroFig'), { intensity: 0.6, theme: paletteOf(G.palette).theme, play: true, onRead: t => { $('heroRead').textContent = t; } });
  $('heroName').textContent = f.name;
  $('heroWhat').textContent = f.what;
  $('heroCount').textContent = `${hero.i + 1} / ${HERO_SET.length}`;
}
function buildHero() {
  $('heroPrev').addEventListener('click', () => showHero(hero.i - 1));
  $('heroNext').addEventListener('click', () => showHero(hero.i + 1));
  $('heroVer').textContent = 'v' + REPO.version;
  $('heroStars').textContent = REPO.stars;
  $('heroStarsOn').textContent = `stars on GitHub, ${REPO.starsOn}`;
  showHero(0);
}

// ----------------------------------------------------------------- FOCUS
const focus = { fn: null, fig: null, intensity: 0.5, play: false, kind: 'js', last: null };

function openFocus(fn) {
  const f = figureOf(fn);
  if (!f) return;
  if (!focus.fn) { focus.last = document.activeElement; focus.intensity = G.intensity; }
  focus.fn = fn;
  if (focus.fig) focus.fig.destroy();
  const dlg = $('focus');
  dlg.hidden = false;
  document.documentElement.classList.add('focus-open');
  focus.fig = H[fn]($('focusFig'), {
    intensity: focus.intensity, theme: paletteOf(G.palette).theme, play: focus.play,
    onRead: t => { $('focusRead').textContent = t; },
  });
  const i = FIGURES.indexOf(f);
  $('focusNum').textContent = String(i + 1).padStart(2, '0');
  $('focusName').textContent = f.name;
  $('focusWhat').textContent = f.what;
  $('focusMore').textContent = f.more;
  $('focusIntensity').value = String(focus.intensity);
  $('focusIntensityVal').textContent = focus.intensity.toFixed(2);
  $('focusPlay').setAttribute('aria-pressed', String(focus.play));
  renderCode();
  $('focusClose').focus({ preventScroll: true });
}

function closeFocus() {
  if (!focus.fn) return;
  if (focus.fig) focus.fig.destroy();
  focus.fig = null; focus.fn = null;
  $('focus').hidden = true;
  document.documentElement.classList.remove('focus-open');
  if (focus.last && focus.last.focus) focus.last.focus({ preventScroll: true });
}

function stepFocus(d) {
  const list = visibleFns();
  const i = list.indexOf(focus.fn);
  openFocus(list[(i + d + list.length) % list.length]);
}

function renderCode() {
  const f = figureOf(focus.fn);
  if (!f) return;
  const pal = paletteOf(G.palette);
  for (const b of document.querySelectorAll('#codeTabs button')) b.setAttribute('aria-selected', String(b.dataset.id === focus.kind));
  $('code').textContent = snippet(focus.kind, f, { intensity: focus.intensity, play: focus.play, vars: pal.vars, stroke: G.stroke });
}

function buildFocus() {
  const tabs = $('codeTabs');
  for (const k of KINDS) {
    const b = el('button', null, k.label);
    b.type = 'button'; b.dataset.id = k.id; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => { focus.kind = k.id; renderCode(); });
    tabs.appendChild(b);
  }
  $('focusIntensity').addEventListener('input', e => {
    focus.intensity = Number(e.target.value);
    $('focusIntensityVal').textContent = focus.intensity.toFixed(2);
    if (focus.fig) focus.fig.update({ intensity: focus.intensity });
    renderCode();
  });
  $('focusPlay').addEventListener('click', () => {
    focus.play = !focus.play;
    $('focusPlay').setAttribute('aria-pressed', String(focus.play));
    if (focus.fig) focus.fig.update({ play: focus.play });
    renderCode();
  });
  $('focusClose').addEventListener('click', closeFocus);
  $('focusPrev').addEventListener('click', () => stepFocus(-1));
  $('focusNext').addEventListener('click', () => stepFocus(1));
  $('focus').addEventListener('click', e => { if (e.target === $('focus')) closeFocus(); });
  $('copy').addEventListener('click', () => copy($('code').textContent, $('copy')));
  addEventListener('keydown', e => {
    if (!focus.fn) return;
    if (e.key === 'Escape') closeFocus();
    // Riffle walks its own cards with the arrow keys.
    else if (!e.target.closest('[data-hairline]') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) stepFocus(e.key === 'ArrowRight' ? 1 : -1);
  });
}

function copy(text, btn) {
  const done = ok => { const t = btn.textContent; btn.textContent = ok ? 'Copied' : 'Select and copy'; setTimeout(() => { btn.textContent = t; }, 1400); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  else done(false);
}

// ------------------------------------------------------------------- USE
function buildUse() {
  const tabs = $('installTabs'), out = $('installCmd');
  const show = id => {
    const it = INSTALL.find(x => x.id === id);
    out.textContent = it.text;
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.id === id));
  };
  for (const it of INSTALL) {
    const b = el('button', null, it.label);
    b.type = 'button'; b.dataset.id = it.id; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => show(it.id));
    tabs.appendChild(b);
  }
  show('npm');
  $('installCopy').addEventListener('click', () => copy(out.textContent, $('installCopy')));
  $('useJs').textContent = snippet('js', figureOf('terrain'), { play: true });
  $('useReact').textContent = snippet('react', figureOf('terrain'), {});
}

// ------------------------------------------------------------------ BOOT
function boot() {
  load();
  buildGallery();
  buildHero();
  buildFocus();
  buildUse();
  setGroup('all');
  applyLook();
  applyAll();
  installSaver({
    pause(on) {
      if (on) { closeFocus(); if (hero.fig) hero.fig.update({ play: false }); }
      else if (hero.fig) hero.fig.update({ play: true });
    },
    stroke: () => G.stroke,
  });
  const ns = $('noscript'); if (ns) ns.hidden = true;
  window.__hairline = { G, cards, focus, hero, openFocus, closeFocus };
}
boot();
