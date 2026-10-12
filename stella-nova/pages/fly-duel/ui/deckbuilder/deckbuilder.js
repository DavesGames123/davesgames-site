// ============================================================================
//  FLY DUEL  ·  the deck builder  (DOM module)
// ----------------------------------------------------------------------------
//  Build a 40-card deck from the card pool, then play it against a model
//  fly. ui/chooser/chooser.js opens the builder over the title screen. The
//  pure rules (lists, Fill lands, share codes, storage) are in
//  ui/deckbuilder/deckstore.js. validateDeck() of game/cards.js is the one
//  judge of a legal deck.
//
//  Layout. Desktop (900 px and wider): the card pool on the left, the deck
//  panel on the right. Phone: the pool is a grid of three columns, and a
//  bar at the base (count, a small curve, legal or not) opens the deck
//  panel as a bottom sheet. Every target is 44 px on a phone. No control
//  needs hover.
//    pool    every card of the pool as a real card (cardEl of
//            ui/cardview.js, drawn by drawCard). Click or tap adds one
//            copy. Right-click or a long press (0.5 s) opens the big
//            inspector. Filters: colour glyphs (also two or more colours
//            and colourless), type, mana value, keyword, and text search.
//    deck    your saved decks, start from a preset, the count, a mana
//            curve, the lands for each colour, the messages of
//            validateDeck, Fill lands, Undo, Clear, the share code, and
//            the list by type. Click a row or its minus button to take
//            one copy out.
//    play    "Play this deck vs a fly" calls opts.onPlay(customDeckOf()).
//
//  Saving. Each change saves the deck in localStorage at once (deckstore
//  saveDecks, in try/catch). When storage fails, the panel says so and
//  the deck stays in memory.
//
//  Keys. Escape closes the share panel, the sheet, or the builder (not
//  while the inspector is open). On a pool card: Enter adds, "i" opens the
//  inspector. Ctrl or Cmd + Z is Undo.
//
//  ensureStyles() adds deckbuilder.css to the document once, so the page
//  index.html needs no new link.
//
//  GREP MAP
//      grep -n 'export function ensureStyles'      the stylesheet link
//      grep -n 'export function curveHTML'         the mana curve bars
//      grep -n 'export function mountDeckBuilder'  the layer and events
//      grep -n 'function shellHTML'                the fixed markup
//      grep -n 'function buildPool'                one tile per card
//      grep -n 'function applyFilters'             pool filters -> hidden
//      grep -n 'function renderDeck'               deck panel from the list
//      grep -n 'function change'                   undo, autosave, render
//      grep -n 'function onClick'                  every button
//      grep -n 'function inspect'                  right-click, long press
// ============================================================================
import { CARD, COLOUR_IDS, COLOURS, KEYWORDS, KEYWORD_NAMES } from '../../game/cards.js';
import { cardEl, glyphHTML, hydrate, openInspector } from '../cardview.js';
import { drawManaGlyph, colourInfo } from '../cardface.js';
import * as DS from './deckstore.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hasDOM = () => typeof document !== 'undefined' && typeof document.createElement === 'function';
const TYPES = [['creature', 'Creatures'], ['spell', 'Spells'], ['land', 'Lands']];
const MV_LABEL = ['0', '1', '2', '3', '4', '5', '6+'];

export function ensureStyles(doc = hasDOM() ? document : null) {
  if (!doc || doc.getElementById?.('fdb-css')) return false;
  let href = 'deckbuilder.css';
  try { href = new URL('./deckbuilder.css', import.meta.url).href; } catch { /* a relative link */ }
  const l = doc.createElement('link');
  l.id = 'fdb-css'; l.rel = 'stylesheet'; l.href = href;
  (doc.head || doc.documentElement).appendChild(l);
  return true;
}

// The mana curve as bars. curve: 7 counts (0..5, 6+). mini: no labels.
export function curveHTML(curve, mini = false) {
  const top = Math.max(6, ...curve);
  return curve.map((n, i) => `<span class="fdb-cb" style="--h:${(n / top).toFixed(3)}">`
    + (mini ? '' : `<em>${n || ''}</em>`) + `<i></i>` + (mini ? '' : `<small>${MV_LABEL[i]}</small>`) + `</span>`).join('');
}

// Choose an option of a select by its value: property and attribute, so
// it also works where select.value has no setter (linkedom in node).
function setSelect(sel, v) {
  for (const o of sel?.querySelectorAll?.('option') || []) {
    const on = o.value === v;
    o.selected = on;
    if (on) o.setAttribute('selected', 'selected'); else o.removeAttribute('selected');
  }
}

const PIP = (k, s = 18) => `<canvas class="fdb-glyph" data-k="${esc(k)}" width="${s}" height="${s}" style="width:${s}px;height:${s}px" aria-hidden="true"></canvas>`;
const colourHex = k => { try { return colourInfo(k).hex; } catch { return '#8a91a5'; } };

function shellHTML() {
  const kws = Object.keys(KEYWORDS);
  return `<div class="fdb-in">
  <header class="fdb-head">
    <button type="button" class="fdb-back" data-act="close">Back</button>
    <h2 class="fdb-title">Deck builder</h2>
    <label class="fdb-namebox"><span class="fdb-sr">Deck name</span><input class="fdb-name" type="text" maxlength="${DS.NAME_MAX}" autocomplete="off" spellcheck="false" placeholder="Name your deck"></label>
    <span class="fdb-saved" aria-live="polite"></span>
  </header>
  <section class="fdb-poolwrap" aria-label="Card pool">
    <div class="fdb-filters">
      <div class="fdb-frow">
        <label class="fdb-qbox"><span class="fdb-sr">Search the cards</span><input class="fdb-q" type="search" placeholder="Search name, type or text" autocomplete="off" spellcheck="false"></label>
        <button type="button" class="fdb-ftoggle" data-act="filters" aria-expanded="false">Filters<b class="fdb-fn"></b></button>
      </div>
      <div class="fdb-fmore">
        <span class="fdb-pips" role="group" aria-label="Colour">${COLOUR_IDS.map(k => `<button type="button" data-col="${k}" aria-pressed="false" aria-label="${esc(COLOURS[k].name)}" title="${esc(COLOURS[k].name)}">${PIP(k, 20)}</button>`).join('')}`
    + `<button type="button" data-col="multi" aria-pressed="false" aria-label="Two or more colours" title="Two or more colours"><span class="fdb-multi" aria-hidden="true"></span></button>`
    + `<button type="button" data-col="none" aria-pressed="false" aria-label="Colourless" title="Colourless"><span class="fdb-none" aria-hidden="true"></span></button></span>
        <span class="fdb-seg" role="radiogroup" aria-label="Type">${[['all', 'All'], ['creature', 'Creature'], ['spell', 'Spell'], ['land', 'Land']].map(([v, n]) => `<button type="button" role="radio" data-type="${v}" aria-checked="${v === 'all'}">${n}</button>`).join('')}</span>
        <span class="fdb-mvs" role="group" aria-label="Mana value">${MV_LABEL.map((n, i) => `<button type="button" data-mv="${i}" aria-pressed="false" aria-label="Mana value ${n}">${n}</button>`).join('')}</span>
        <label class="fdb-kwbox"><span class="fdb-sr">Keyword</span><select class="fdb-kw"><option value="">Any keyword</option>${kws.map(k => `<option value="${k}">${esc(KEYWORD_NAMES[k] || k)}</option>`).join('')}<option value="dice">Rolls dice</option><option value="counters">Counters</option></select></label>
        <button type="button" class="fdb-fclear" data-act="clearf">Clear filters</button>
      </div>
    </div>
    <p class="fdb-poolcount" aria-live="polite"></p>
    <div class="fdb-pool" role="list"></div>
    <p class="fdb-empty" hidden>No card matches the filters.</p>
    <p class="fdb-hint">Tap a card to add it. Right-click or hold to read it.</p>
  </section>
  <aside class="fdb-deck" aria-label="Your deck">
    <div class="fdb-sheethead"><b>Your deck</b><button type="button" class="fdb-shx" data-act="sheet-close">Close</button></div>
    <div class="fdb-scroll">
      <div class="fdb-mine">
        <label class="fdb-pickbox"><span class="fdb-lab">My decks</span><select class="fdb-pick"></select></label>
        <button type="button" data-act="new">New</button>
        <button type="button" class="fdb-del" data-act="delete">Delete</button>
      </div>
      <label class="fdb-presetbox"><span class="fdb-lab">Start from a preset</span><select class="fdb-preset"><option value="">Copy a preset deck</option>${DS.presets().map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
      <div class="fdb-sum"><b class="fdb-count"></b><span class="fdb-sumt"></span></div>
      <div class="fdb-curve fdb-cmain" role="img"></div>
      <div class="fdb-sources"></div>
      <ul class="fdb-msgs" aria-live="polite"></ul>
      <div class="fdb-tools">
        <button type="button" data-act="lands">Fill lands</button>
        <button type="button" data-act="undo">Undo</button>
        <button type="button" data-act="clear">Clear</button>
        <button type="button" data-act="share" aria-expanded="false">Share code</button>
      </div>
      <div class="fdb-share" hidden>
        <label><span class="fdb-lab">Code of this deck</span><input class="fdb-code" type="text" readonly></label>
        <div class="fdb-row2"><button type="button" data-act="copy">Copy code</button><button type="button" data-act="copylink">Copy link</button></div>
        <label><span class="fdb-lab">Paste a code to import a deck</span><input class="fdb-import" type="text" autocomplete="off" spellcheck="false" placeholder="1A..."></label>
        <div class="fdb-row2"><button type="button" data-act="import">Import</button></div>
        <p class="fdb-share-msg" aria-live="polite"></p>
      </div>
      <div class="fdb-list"></div>
    </div>
    <div class="fdb-playbox"><button type="button" class="fdb-play" data-act="play">Play this deck vs a fly</button><p class="fdb-why" aria-live="polite"></p></div>
  </aside>
  <div class="fdb-bar">
    <button type="button" class="fdb-bar-open" data-act="sheet" aria-label="Open your deck"><b class="fdb-bar-n"></b><span class="fdb-bar-curve fdb-curve mini" aria-hidden="true"></span><span class="fdb-bar-st"></span></button>
    <button type="button" class="fdb-bar-play" data-act="play">Play</button>
  </div>
  <div class="fdb-scrim" data-act="sheet-close" hidden></div>
</div>`;
}

// Mount the builder in root. opts:
//   deck       a saved deck { id, name, list } to open with (optional)
//   onPlay(deck)   deck: customDeckOf() of the saved deck (a legal deck)
//   onClose()      Back or Escape
//   onSaved(decks) after each save (the chooser updates its tiles)
//   storage        a localStorage-like object (tests); default localStorage
//   shareBase      the page URL for links (default: the fly-duel page)
// Returns { open(deck?), close(), destroy(), state(), el }.
export function mountDeckBuilder(root, opts = {}) {
  const st = opts.storage;
  const load = () => (st ? DS.loadDecks(st) : DS.loadDecks());
  const save = ds => (st ? DS.saveDecks(ds, st) : DS.saveDecks(ds));
  let saved = load();
  const S = {
    id: null, name: '', list: [], hist: [], open: false, sheet: false, filters: false, share: false, delArm: false,
    f: { cols: new Set(), type: 'all', mv: new Set(), kw: '', q: '' }, stored: true,
  };
  ensureStyles(root.ownerDocument);
  root.classList.add('fdb');
  root.innerHTML = shellHTML();
  root.hidden = true;
  const $ = s => root.querySelector(s);
  const $$ = s => [...root.querySelectorAll(s)];
  const tiles = new Map();

  // ---- glyphs on small canvases
  function paintGlyphs(scope = root) {
    for (const cv of scope.querySelectorAll('canvas.fdb-glyph')) {
      if (cv._fdbDone || typeof cv.getContext !== 'function') continue;
      const s = parseInt(cv.style.width, 10) || 18;
      const dpr = Math.min(2, Math.max(1, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
      cv.width = Math.round(s * dpr); cv.height = Math.round(s * dpr);
      let g = null;
      try { g = cv.getContext('2d'); } catch { g = null; }
      if (!g || typeof g.setTransform !== 'function') continue;
      cv._fdbDone = true;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { drawManaGlyph(g, cv.dataset.k, 0, 0, s); } catch { /* an unknown key draws nothing */ }
    }
  }

  // ---- the pool: one tile per card, built once; filters set hidden
  function buildPool() {
    const box = $('.fdb-pool');
    for (const id of DS.poolOrder()) {
      const c = CARD[id];
      const tile = root.ownerDocument.createElement('div');
      tile.className = 'fdb-pc'; tile.setAttribute('role', 'listitem'); tile.dataset.id = id;
      const b = root.ownerDocument.createElement('button');
      b.type = 'button'; b.className = 'fdb-add'; b.dataset.id = id;
      const el = cardEl(c, { zoomable: false, mode: 'auto' });
      if (el) b.appendChild(el);
      else b.textContent = c.name;
      const n = root.ownerDocument.createElement('span');
      n.className = 'fdb-pcn'; n.setAttribute('aria-hidden', 'true');
      tile.appendChild(b); tile.appendChild(n);
      box.appendChild(tile);
      tiles.set(id, { tile, b, n });
    }
  }
  function applyFilters() {
    let shown = 0;
    for (const [id, t] of tiles) {
      const vis = DS.matchCard(CARD[id], S.f);
      t.tile.hidden = !vis;
      if (vis) shown++;
    }
    $('.fdb-poolcount').textContent = `${shown} of ${tiles.size} cards`;
    $('.fdb-empty').hidden = shown > 0;
    const nf = S.f.cols.size + S.f.mv.size + (S.f.type !== 'all' ? 1 : 0) + (S.f.kw ? 1 : 0);
    $('.fdb-fn').textContent = nf ? ` ${nf}` : '';
    $$('.fdb-pips button').forEach(b => b.setAttribute('aria-pressed', String(S.f.cols.has(b.dataset.col))));
    $$('.fdb-seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.type === S.f.type)));
    $$('.fdb-mvs button').forEach(b => b.setAttribute('aria-pressed', String(S.f.mv.has(+b.dataset.mv))));
    setSelect($('.fdb-kw'), S.f.kw);
    root.dataset.filters = S.filters ? 'on' : 'off';
    $('.fdb-ftoggle').setAttribute('aria-expanded', String(S.filters));
  }

  // ---- the deck panel
  function rowHTML(id, n) {
    const c = CARD[id];
    const cs = c.type === 'land' ? c.mana : c.colours;
    const edge = cs.length === 1 ? colourHex(cs[0]) : cs.length ? '#c9a45a' : '#8a91a5';
    const max = DS.countOf(S.list, id) >= DS.maxCopies(id);
    return `<div class="fdb-row" data-id="${esc(id)}" style="--edge:${edge}">`
      + `<button type="button" class="fdb-rm" data-act="rm" data-id="${esc(id)}" aria-label="Take out one ${esc(c.name)}">−</button>`
      + `<button type="button" class="fdb-rmain" data-act="rm" data-id="${esc(id)}" aria-label="${n} ${esc(c.name)}. Take out one."><span class="fdb-rn">${n}</span><span class="fdb-rname">${esc(c.name)}</span>${c.type === 'land' ? '' : glyphHTML(c.cost, 13)}</button>`
      + `<button type="button" class="fdb-ad" data-act="add1" data-id="${esc(id)}" aria-label="Add one ${esc(c.name)}"${max ? ' disabled' : ''}>+</button></div>`;
  }
  function renderDeck() {
    const v = DS.deckMessages(S.list);
    const s = v.stats;
    root.dataset.valid = v.ok ? 'yes' : 'no';
    $('.fdb-count').textContent = `${s.cards}/${DS.DECK_SIZE}`;
    $('.fdb-sumt').textContent = `${s.creatures} creatures · ${s.spells} spells · ${s.lands} lands${s.others ? ` · average cost ${s.avgMV.toFixed(1)}` : ''}`;
    const cv = $('.fdb-cmain');
    cv.innerHTML = curveHTML(s.curve);
    cv.setAttribute('aria-label', `Mana curve of the cards that are not lands: ${s.curve.map((n, i) => `${n} at ${MV_LABEL[i]}`).join(', ')}`);
    $('.fdb-bar-curve').innerHTML = curveHTML(s.curve, true);
    $('.fdb-bar-n').textContent = `${s.cards}/${DS.DECK_SIZE}`;
    $('.fdb-bar-st').textContent = v.ok ? 'Ready to play' : `${v.messages.length} to fix`;
    // lands for each colour that the cards need
    const src = $('.fdb-sources');
    src.innerHTML = s.colours.length
      ? s.colours.map(c => `<span class="fdb-src${s.sources[c] < DS.SOURCES_MIN ? ' low' : ''}" title="${esc(COLOURS[c].name)}">${PIP(c, 16)}<b>${s.sources[c]}</b><small>lands · ${s.pips[c]} symbols</small></span>`).join('')
      : '<span class="fdb-src none"><small>No coloured cards yet.</small></span>';
    paintGlyphs(src);
    $('.fdb-msgs').innerHTML = v.ok
      ? `<li class="ok">Legal deck: ${DS.DECK_SIZE} cards, ${s.lands} lands, enough lands for each colour.</li>`
      : v.messages.map(m => `<li class="${m.kind}">${esc(m.text)}</li>`).join('');
    // the list by type
    const byType = Object.fromEntries(TYPES.map(([t]) => [t, []]));
    for (const [id, n] of S.list) if (CARD[id]) byType[CARD[id].type].push([id, n]);
    $('.fdb-list').innerHTML = S.list.length
      ? TYPES.filter(([t]) => byType[t].length).map(([t, name]) => `<section class="fdb-grp"><h3>${name} <span>${byType[t].reduce((a, [, n]) => a + n, 0)}</span></h3>${byType[t].map(([id, n]) => rowHTML(id, n)).join('')}</section>`).join('')
      : '<p class="fdb-blank">The deck is empty. Tap cards in the pool to add them, or copy a preset.</p>';
    hydrate($('.fdb-list'));
    // pool badges
    for (const [id, t] of tiles) {
      const n = DS.countOf(S.list, id);
      const full = n >= DS.maxCopies(id);
      t.n.textContent = n ? (Number.isFinite(DS.maxCopies(id)) ? `${n}/${DS.COPIES_MAX}` : `${n}`) : '';
      t.tile.dataset.n = String(n);
      t.tile.dataset.full = String(full);
      t.b.setAttribute('aria-label', `${CARD[id].name}${n ? `, ${n} in the deck` : ''}${full ? ', the limit' : '. Add one'}`);
    }
    // play
    const why = v.ok ? '' : `Fix the deck first: ${v.messages[0]?.text || 'it is not legal.'}`;
    for (const b of $$('[data-act="play"]')) b.setAttribute('aria-disabled', String(!v.ok));
    $('.fdb-why').textContent = '';
    $('.fdb-why').dataset.why = why;
    $('[data-act="undo"]').disabled = !S.hist.length;
    $('[data-act="clear"]').disabled = !S.list.length;
    if (S.share) $('.fdb-code').value = DS.encodeDeck({ list: S.list, name: S.name });
    renderMine();
  }
  function renderMine() {
    const sel = $('.fdb-pick');
    const opts2 = saved.map(d => `<option value="${esc(d.id)}"${d.id === S.id ? ' selected' : ''}>${esc(d.name)}</option>`);
    if (!S.id) opts2.unshift(`<option value="" selected>${esc(S.name || 'New deck')} (not saved yet)</option>`);
    sel.innerHTML = opts2.join('');
    const del = $('.fdb-del');
    del.disabled = !S.id;
    del.textContent = S.delArm ? 'Tap again to delete' : 'Delete';
    del.dataset.arm = String(S.delArm);
    $('.fdb-name').value !== S.name && ($('.fdb-name').value = S.name);
  }
  function status(t) { $('.fdb-saved').textContent = t; }

  // ---- changes: undo, autosave, render
  function persist() {
    if (!S.id) S.id = DS.newDeckId();
    saved = DS.upsertDeck(saved, { id: S.id, name: S.name || 'My deck', list: S.list, updated: Date.now() });
    S.stored = save(saved);
    status(S.stored ? 'Saved on this device' : 'Not saved: this browser blocks storage');
    opts.onSaved?.(saved.slice());
  }
  function change(list, { undo = true } = {}) {
    if (!list) return false;
    if (undo) { S.hist.push(S.list); if (S.hist.length > 60) S.hist.shift(); }
    S.list = list; S.delArm = false;
    persist();
    renderDeck();
    return true;
  }
  function loadDeck(d) {
    S.id = d?.id || null;
    S.list = DS.sortList(d?.list || []);
    S.name = d?.name || DS.freeName(saved);
    S.hist = []; S.delArm = false;
    status(S.id ? 'Saved on this device' : '');
    renderDeck();
  }
  function addOne(id) {
    const next = DS.addCard(S.list, id);
    if (!next) { status(`${CARD[id]?.name}: ${DS.COPIES_MAX} copies is the limit`); return false; }
    return change(next);
  }
  function play(btn) {
    const v = DS.deckMessages(S.list);
    if (!v.ok) {
      const why = $('.fdb-why');
      why.textContent = why.dataset.why;
      if (btn?.classList.contains('fdb-bar-play')) { status(why.dataset.why); }
      return false;
    }
    if (!S.id) persist();
    const d = saved.find(x => x.id === S.id) || { id: S.id, name: S.name, list: S.list };
    opts.onPlay?.(DS.customDeckOf(d));
    return true;
  }
  function setSheet(on) { S.sheet = !!on; root.dataset.sheet = S.sheet ? 'on' : 'off'; $('.fdb-scrim').hidden = !S.sheet; }
  function setShare(on) {
    S.share = !!on;
    $('.fdb-share').hidden = !S.share;
    $('[data-act="share"]').setAttribute('aria-expanded', String(S.share));
    if (S.share) { $('.fdb-code').value = DS.encodeDeck({ list: S.list, name: S.name }); $('.fdb-share-msg').textContent = ''; }
  }
  function shareLink() {
    const code = DS.encodeDeck({ list: S.list, name: S.name });
    let base = opts.shareBase;
    if (!base) { try { base = new URL('../../', import.meta.url).href; } catch { base = ''; } }
    return `${base}?mydeck=${encodeURIComponent(code)}`;
  }
  async function copy(text, what) {
    const msg = $('.fdb-share-msg');
    try {
      await globalThis.navigator.clipboard.writeText(text);
      msg.textContent = `${what} copied.`;
    } catch {
      const inp = $('.fdb-code');
      inp.value = text; inp.select?.();
      msg.textContent = `Copy did not work here. The ${what.toLowerCase()} is selected in the box: copy it from there.`;
    }
  }
  function importCode() {
    const r = DS.decodeDeck($('.fdb-import').value);
    const msg = $('.fdb-share-msg');
    if (!r.ok) { msg.textContent = r.error; return false; }
    S.id = null; S.hist = [];
    S.name = DS.freeName(saved, r.name || 'Imported deck');
    S.list = r.list;
    persist(); renderDeck();
    $('.fdb-import').value = '';
    msg.textContent = `Imported "${S.name}".`;
    return true;
  }

  // ---- inspector: right-click, long press, the "i" key
  let press = 0, pressId = null, pressXY = null, eatClick = false;
  function inspect(id) {
    if (!CARD[id]) return;
    openInspector(CARD[id], { count: DS.countOf(S.list, id) });
  }
  const idOf = e => e.target?.closest?.('[data-id]')?.dataset.id || null;
  function onContext(e) {
    const id = idOf(e);
    if (!id || !root.contains(e.target)) return;
    e.preventDefault();
    clearTimeout(press); pressId = null;
    inspect(id);
  }
  function onDown(e) {
    const id = idOf(e);
    if (!id || e.pointerType === 'mouse') return;
    pressId = id; pressXY = [e.clientX, e.clientY];
    clearTimeout(press);
    press = setTimeout(() => { if (pressId === id) { eatClick = true; pressId = null; inspect(id); } }, 500);
  }
  function onMoveUp(e) {
    if (!pressId) return;
    if (e.type === 'pointermove' && pressXY && Math.hypot(e.clientX - pressXY[0], e.clientY - pressXY[1]) < 10) return;
    clearTimeout(press); pressId = null;
  }

  // ---- clicks
  function onClick(e) {
    if (eatClick) { eatClick = false; e.preventDefault?.(); return; }
    const t = e.target?.closest?.('button,[data-act]');
    if (!t || !root.contains(t)) return;
    if (t.disabled) return;
    if (t.classList.contains('fdb-add')) { e.preventDefault?.(); addOne(t.dataset.id); return; }
    if (t.dataset.col) { const k = t.dataset.col; if (S.f.cols.has(k)) S.f.cols.delete(k); else S.f.cols.add(k); applyFilters(); return; }
    if (t.dataset.type) { S.f.type = t.dataset.type; applyFilters(); return; }
    if (t.dataset.mv != null && t.closest('.fdb-mvs')) { const m = +t.dataset.mv; if (S.f.mv.has(m)) S.f.mv.delete(m); else S.f.mv.add(m); applyFilters(); return; }
    const act = t.dataset.act;
    if (act === 'rm') { change(DS.removeCard(S.list, t.dataset.id)); return; }
    if (act === 'add1') { addOne(t.dataset.id); return; }
    if (act === 'filters') { S.filters = !S.filters; applyFilters(); return; }
    if (act === 'clearf') { S.f = { cols: new Set(), type: 'all', mv: new Set(), kw: '', q: '' }; $('.fdb-q').value = ''; applyFilters(); return; }
    if (act === 'lands') {
      const next = DS.suggestLands(S.list);
      change(next);
      const ls = DS.deckStats(next);
      status(`Lands: ${ls.lands - ls.duals} basic, ${ls.duals} dual`);
      return;
    }
    if (act === 'undo') { if (S.hist.length) { S.list = S.hist.pop(); persist(); renderDeck(); } return; }
    if (act === 'clear') { change([]); return; }
    if (act === 'share') { setShare(!S.share); return; }
    if (act === 'copy') { copy(DS.encodeDeck({ list: S.list, name: S.name }), 'Code'); return; }
    if (act === 'copylink') { copy(shareLink(), 'Link'); return; }
    if (act === 'import') { importCode(); return; }
    if (act === 'new') { loadDeck(null); return; }
    if (act === 'delete') {
      if (!S.id) return;
      if (!S.delArm) { S.delArm = true; renderMine(); return; }
      saved = DS.deleteDeck(saved, S.id);
      S.stored = save(saved);
      opts.onSaved?.(saved.slice());
      loadDeck(saved[0] || null);
      status('Deck deleted');
      return;
    }
    if (act === 'sheet') { setSheet(true); return; }
    if (act === 'sheet-close') { setSheet(false); return; }
    if (act === 'play') { play(t); return; }
    if (act === 'close') { close(); opts.onClose?.(); }
  }
  function onInput(e) {
    const t = e.target;
    if (t.classList.contains('fdb-q')) { S.f.q = t.value; applyFilters(); return; }
    if (t.classList.contains('fdb-name')) {
      S.name = t.value.slice(0, DS.NAME_MAX);
      if (S.id || S.list.length) persist();
      renderMine();
    }
  }
  function onChange(e) {
    const t = e.target;
    if (t.classList.contains('fdb-kw')) { S.f.kw = t.value; applyFilters(); return; }
    if (t.classList.contains('fdb-pick')) { const d = saved.find(x => x.id === t.value); if (d) loadDeck(d); return; }
    if (t.classList.contains('fdb-preset')) {
      const p = DS.presets().find(x => x.id === t.value);
      setSelect(t, '');
      if (!p) return;
      S.id = null; S.hist = [];
      S.name = DS.freeName(saved, `${p.name} (copy)`);
      S.list = p.list;
      persist(); renderDeck();
    }
  }
  function onKey(e) {
    if (!S.open) return;
    const insp = root.ownerDocument.querySelector('.cv-inspect');
    if (insp && !insp.hidden) return;
    const a = root.ownerDocument.activeElement;
    if (e.key === 'Escape') {
      e.stopPropagation?.(); e.preventDefault?.();
      if (S.share) setShare(false);
      else if (S.sheet) setSheet(false);
      else { close(); opts.onClose?.(); }
      return;
    }
    if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey) && !(a && /^(INPUT|TEXTAREA)$/.test(a.tagName || ''))) {
      e.preventDefault?.();
      if (S.hist.length) { S.list = S.hist.pop(); persist(); renderDeck(); }
      return;
    }
    if (a?.classList?.contains('fdb-add') && (e.key === 'i' || e.key === 'I' || e.key === 'ContextMenu')) { e.preventDefault?.(); inspect(a.dataset.id); }
  }

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('contextmenu', onContext);
  root.addEventListener('pointerdown', onDown, { passive: true });
  root.addEventListener('pointermove', onMoveUp, { passive: true });
  root.addEventListener('pointerup', onMoveUp, { passive: true });
  root.addEventListener('pointercancel', onMoveUp, { passive: true });
  const doc = root.ownerDocument;
  doc.addEventListener('keydown', onKey, true);

  buildPool();
  paintGlyphs();
  applyFilters();
  loadDeck(null);

  function close() {
    if (!S.open) return;
    S.open = false; root.hidden = true; setSheet(false); setShare(false);
  }
  return {
    el: root,
    open(deck) {
      saved = load();
      if (deck && typeof deck === 'object') loadDeck(saved.find(d => d.id === deck.id) || deck);
      else if (!S.id && !S.list.length) loadDeck(null);
      S.open = true; root.hidden = false;
      setSheet(false);
      applyFilters();
      $('.fdb-q')?.focus?.({ preventScroll: true });
    },
    close,
    destroy() {
      close();
      clearTimeout(press);
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('contextmenu', onContext);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMoveUp);
      root.removeEventListener('pointerup', onMoveUp);
      root.removeEventListener('pointercancel', onMoveUp);
      doc.removeEventListener('keydown', onKey, true);
      root.innerHTML = ''; root.classList.remove('fdb');
    },
    state: () => ({ id: S.id, name: S.name, list: S.list.map(r => r.slice()), open: S.open, sheet: S.sheet, filters: { ...S.f, cols: [...S.f.cols], mv: [...S.f.mv] }, stored: S.stored }),
    // test hooks: the same paths as the buttons
    _add: addOne, _play: () => play(null), _import: code => { $('.fdb-import').value = code; return importCode(); },
  };
}
