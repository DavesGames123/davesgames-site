// ============================================================================
//  SIM KIT UI  ·  widgets/sim-kit/ui.js
// ----------------------------------------------------------------------------
//  mount(opts) builds the sim page GUI from a schema (core.js) and returns
//  the kit object. The page keeps its own canvas and loop; it reads
//  kit.playing, kit.speed and kit.takeStep() each frame, and it gets every
//  control change through opts.onChange.
//
//  Parts (all under #sk-root, styles in sim-kit.css):
//    .sk-title      page title and sub, top left
//    .sk-panel      the control panel: seed, new scene, share link, then
//                   the schema groups; each group folds and has a lock and
//                   a dice button. A right drawer on desktop; a bottom
//                   sheet over the dock on a phone (portrait).
//    .sk-transport  play/pause, step, reset, speed, slow motion, new scene,
//                   panel button. On a phone it is the dock (44 px targets).
//    .sk-toast      one-line notes ("Link copied").
//
//  Keys (not in a text field): Space play/pause, "." step, R reset,
//  N new scene, S slow motion, H hide or show the panel.
//
//  The DOM calls are few (createElement, appendChild, setAttribute,
//  addEventListener, classList, style.setProperty) so tests.mjs runs this
//  file under a small DOM stub.
//
//  grep -n targets
//    entry ................ "export function mount"
//    one control .......... "function control("
//    colour map control ... "function cmapControl"
//    group header ......... "function groupEl"
//    transport ............ "function transportEl"
//    url hash write ....... "function writeHash"
//    keys ................. "function onKey"
//    theme apply .......... "function applyTheme"
// ============================================================================
import * as K from './core.js';

const CM_URL = new URL('../../pages/ct-lab/colormaps/maps.js', import.meta.url).href;
let CM = null, cmWait = null;
export function loadColormaps() {
  if (!cmWait) cmWait = import(CM_URL).then(m => (CM = m)).catch(() => null);
  return cmWait;
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor"/></svg>',
  step: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5.5v13l9-6.5zM16.5 5.5h2.5v13h-2.5z" fill="currentColor"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 1 1-6.6 4.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 4.5v5.2h5.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  slow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 0 8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 8v4.5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  dice: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/><circle cx="15" cy="15" r="1.5" fill="currentColor"/><circle cx="15" cy="9" r="1.5" fill="currentColor"/><circle cx="9" cy="15" r="1.5" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2" fill="currentColor"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.9"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

// Small element helper: h('button', { class, text, title, on: { click } }, [children])
function h(tag, p, kids) {
  const el = document.createElement(tag);
  if (p) for (const k in p) {
    const v = p[k];
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'icon') el.innerHTML = ICON[v] || '';
    else if (k === 'on') for (const e in v) el.addEventListener(e, v[e]);
    else if (k === 'style') for (const s in v) el.style.setProperty(s, v[s]);
    else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
    else el.setAttribute(k, v);
  }
  if (p && p.type) el.setAttribute('type', p.type);
  if (kids) for (const c of kids) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

const phoneQuery = '(max-width: 768px), ((pointer: coarse) and (max-height: 520px))';
export function isPhone() { try { return !!(globalThis.matchMedia && globalThis.matchMedia(phoneQuery).matches); } catch (e) { return false; } }

export function applyTheme(id, el) {
  el = el || (typeof document !== 'undefined' && document.documentElement);
  if (!el) return null;
  const t = K.themeById(id), v = K.themeVars(t);
  for (const k in v) el.style.setProperty(k, v[k]);
  el.classList.toggle('sk-light', !t.dark);
  return t;
}

export function mount(opts) {
  const S = K.normalize(opts.schema);
  const actions = opts.actions || {};
  const ev = { change: [], play: [], step: [], reset: [], scene: [], panel: [] };
  const emit = (n, ...a) => { for (const f of ev[n]) try { f(...a); } catch (e) { console.error(e); } };
  const phone = isPhone();
  const themeKey = opts.themeKey === undefined ? (S.byKey.has('theme') ? 'theme' : null) : opts.themeKey;
  const useHash = opts.hash !== false;

  const kit = {
    schema: S, state: K.defaults(S), seed: opts.seed != null ? opts.seed >>> 0 : K.newSeed(),
    locks: new Set(opts.locks || []), playing: opts.autoplay !== false, baseSpeed: 1, slow: false,
    get speed() { return this.baseSpeed * (this.slow ? 0.2 : 1); },
    phone, root: null, panelOpen: false,
    on(n, f) { (ev[n] = ev[n] || []).push(f); return kit; },
  };
  if (phone) for (const [k, c] of S.byKey) if (c.phone !== undefined) kit.state[k] = c.phone;

  // ---- read the url hash ------------------------------------------------
  let fromHash = false;
  if (useHash && typeof location !== 'undefined' && location.hash.length > 1) {
    const d = K.decodeHash(S, location.hash);
    if (d.seed != null || d.n) {
      fromHash = true;
      if (d.seed != null) kit.seed = d.seed;
      Object.assign(kit.state, d.state);
      if (d.extra.lock) for (const id of d.extra.lock.split(',')) if (id) kit.locks.add(id);
    }
  }
  if (!fromHash && opts.randomStart) kit.state = K.randomize(S, kit.seed, kit.state, { locks: kit.locks }).state;

  // ---- DOM -----------------------------------------------------------------
  const root = h('div', { id: 'sk-root', class: 'sk-root' + (phone ? ' sk-phone' : '') });
  kit.root = root;
  const views = new Map();   // key -> { set(v) }
  const groupEls = new Map();

  if (opts.title) root.appendChild(h('header', { class: 'sk-title' }, [h('h1', { text: opts.title }), opts.sub ? h('p', { text: opts.sub }) : null]));

  const seedIn = h('input', { class: 'sk-seed', type: 'text', inputmode: 'numeric', 'aria-label': 'Scene seed', value: String(kit.seed), spellcheck: false });
  seedIn.addEventListener('change', () => { const n = parseInt(seedIn.value, 10); if (isFinite(n)) newScene(n >>> 0); else seedIn.value = String(kit.seed); });
  const panel = h('aside', { class: 'sk-panel', id: 'sk-panel', 'aria-label': 'Simulation controls' });
  const head = h('div', { class: 'sk-phead' }, [
    h('span', { class: 'sk-ptitle', text: opts.panelTitle || 'Controls' }),
    h('button', { class: 'sk-ib', type: 'button', title: 'Close the panel (H)', 'aria-label': 'Close the panel', icon: 'close', on: { click: () => setPanel(false) } }),
  ]);
  const seedRow = h('div', { class: 'sk-seedrow' }, [
    h('label', { class: 'sk-seedlab' }, ['Seed ', seedIn]),
    h('button', { class: 'sk-btn sk-accent', type: 'button', title: 'New random scene (N)', on: { click: () => newScene() } }, [h('span', { class: 'sk-i', icon: 'dice' }), 'New scene']),
    h('button', { class: 'sk-ib', type: 'button', title: 'Copy a link to this scene', 'aria-label': 'Copy a link to this scene', icon: 'link', on: { click: copyLink } }),
  ]);
  const grip = h('button', { class: 'sk-grip', type: 'button', 'aria-label': 'Close the panel', on: { click: () => setPanel(false) } });
  const body = h('div', { class: 'sk-pbody' });
  panel.appendChild(grip); panel.appendChild(head); panel.appendChild(seedRow); panel.appendChild(body);
  for (const g of S.groups) body.appendChild(groupEl(g));
  if (opts.footer) body.appendChild(h('p', { class: 'sk-foot', text: opts.footer }));
  root.appendChild(panel);

  const tr = transportEl();
  root.appendChild(tr.el);
  const toast = h('div', { class: 'sk-toast', role: 'status', 'aria-live': 'polite' });
  root.appendChild(toast);

  function groupEl(g) {
    const sec = h('section', { class: 'sk-group' + (g.open ? ' open' : ''), 'data-group': g.id });
    const bodyId = 'sk-g-' + g.id;
    const fold = h('button', { class: 'sk-gh', type: 'button', 'aria-expanded': String(g.open), 'aria-controls': bodyId, on: { click: () => { const o = !sec.classList.contains('open'); sec.classList.toggle('open', o); fold.setAttribute('aria-expanded', String(o)); } } },
      [h('span', { class: 'sk-chev', icon: 'chev' }), h('span', { text: g.label })]);
    const tools = h('span', { class: 'sk-gtools' });
    const drawable = g.random && g.controls.some(c => K.isStateful(c) && c.random !== false);
    let lockB = null;
    if (drawable) {
      lockB = h('button', { class: 'sk-ib sk-lock', type: 'button', title: 'Lock: new scenes keep ' + g.label.toLowerCase(), 'aria-label': 'Lock ' + g.label, 'aria-pressed': 'false', icon: 'unlock', on: { click: () => toggleLock(g.id) } });
      tools.appendChild(lockB);
      tools.appendChild(h('button', { class: 'sk-ib', type: 'button', title: 'Randomize ' + g.label.toLowerCase(), 'aria-label': 'Randomize ' + g.label, icon: 'dice', on: { click: () => randomizeGroup(g.id) } }));
    }
    sec.appendChild(h('div', { class: 'sk-ghead' }, [fold, tools]));
    const gb = h('div', { class: 'sk-gbody', id: bodyId });
    if (g.hint) gb.appendChild(h('p', { class: 'sk-hint', text: g.hint }));
    for (const c of g.controls) gb.appendChild(control(c));
    sec.appendChild(gb);
    groupEls.set(g.id, { sec, lockB });
    return sec;
  }

  function control(c) {
    const id = 'sk-c-' + (c.key || c.action || Math.random().toString(36).slice(2));
    switch (c.type) {
      case 'range': {
        const out = h('output', { class: 'sk-val', for: id });
        const inp = h('input', { id, type: 'range', min: String(c.min), max: String(c.max), step: String(c.step), 'aria-label': c.label });
        const set = v => { inp.value = String(v); out.textContent = K.fmtValue(c, v); };
        inp.addEventListener('input', () => { const v = K.snap(c, parseFloat(inp.value)); out.textContent = K.fmtValue(c, v); if (!c.rebuild) change({ [c.key]: v }, 'input'); });
        inp.addEventListener('change', () => change({ [c.key]: K.snap(c, parseFloat(inp.value)) }, 'input'));
        views.set(c.key, { set });
        return h('div', { class: 'sk-row sk-range' + cls(c) }, [h('label', { for: id, text: c.label }), out, inp]);
      }
      case 'toggle': {
        const b = h('button', { id, class: 'sk-switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': c.label, on: { click: () => change({ [c.key]: !kit.state[c.key] }, 'input') } }, [h('span', { class: 'sk-knob' })]);
        views.set(c.key, { set: v => b.setAttribute('aria-checked', String(!!v)) });
        return h('div', { class: 'sk-row sk-toggle' + cls(c) }, [h('label', { for: id, text: c.label }), b]);
      }
      case 'choice': {
        const seg = c.seg != null ? c.seg : c.options.length <= 4;
        if (seg) {
          const row = h('div', { class: 'sk-seg', role: 'radiogroup', 'aria-label': c.label });
          const bs = c.options.map(o => { const b = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', text: o.label, title: o.title || o.label, on: { click: () => change({ [c.key]: o.id }, 'input') } }); row.appendChild(b); return b; });
          views.set(c.key, { set: v => c.options.forEach((o, i) => bs[i].setAttribute('aria-checked', String(o.id === v))) });
          return h('div', { class: 'sk-row sk-choice' + cls(c) }, [h('span', { class: 'sk-lab', text: c.label }), row]);
        }
        const sel = h('select', { id, 'aria-label': c.label });
        for (const o of c.options) sel.appendChild(h('option', { value: o.id, text: o.label }));
        sel.addEventListener('change', () => change({ [c.key]: sel.value }, 'input'));
        views.set(c.key, { set: v => { sel.value = v; } });
        return h('div', { class: 'sk-row sk-select' + cls(c) }, [h('label', { for: id, text: c.label }), h('span', { class: 'sk-selw' }, [sel])]);
      }
      case 'swatch': {
        const row = h('div', { class: 'sk-swatches', role: 'radiogroup', 'aria-label': c.label });
        const bs = c.options.map(o => {
          const b = h('button', { type: 'button', class: 'sk-sw', role: 'radio', 'aria-checked': 'false', title: o.label, 'aria-label': o.label, on: { click: () => change({ [c.key]: o.id }, 'input') } });
          for (const col of (o.colors || []).slice(0, 6)) b.appendChild(h('i', { style: { background: col } }));
          row.appendChild(b); return b;
        });
        let rb = null;
        if (c.dice) {
          rb = h('button', { type: 'button', class: 'sk-sw sk-swr', role: 'radio', 'aria-checked': 'false', title: 'Random palette', 'aria-label': 'Random palette', on: { click: () => change({ [c.key]: 'rnd-' + K.newSeed() }, 'input') } }, [h('span', { class: 'sk-i', icon: 'dice' })]);
          row.appendChild(rb);
        }
        views.set(c.key, { set: v => {
          c.options.forEach((o, i) => bs[i].setAttribute('aria-checked', String(o.id === v)));
          if (rb) { const on = /^rnd-/.test(v); rb.setAttribute('aria-checked', String(on)); rb.style.setProperty('background', on ? 'linear-gradient(90deg,' + K.paletteColors(v).join(',') + ')' : ''); }
        } });
        return h('div', { class: 'sk-row sk-swatch' + cls(c) }, [h('span', { class: 'sk-lab', text: c.label }), row]);
      }
      case 'color': {
        const inp = h('input', { id, type: 'color', 'aria-label': c.label });
        inp.addEventListener('input', () => change({ [c.key]: inp.value }, 'input'));
        views.set(c.key, { set: v => { inp.value = v; } });
        return h('div', { class: 'sk-row sk-color' + cls(c) }, [h('label', { for: id, text: c.label }), inp]);
      }
      case 'cmap': return cmapControl(c, id);
      case 'button': return h('button', { class: 'sk-btn sk-wide' + cls(c), type: 'button', title: c.title || c.label, text: c.label, on: { click: () => act(c.action || c.key) } });
      case 'buttons': {
        const row = h('div', { class: 'sk-btns' + cls(c) });
        for (const it of c.items) row.appendChild(h('button', { class: 'sk-btn', type: 'button', title: it.title || it.label, text: it.label, on: { click: () => act(c.action || c.key, it.id) } }));
        return c.label ? h('div', { class: 'sk-row sk-col' }, [h('span', { class: 'sk-lab', text: c.label }), row]) : row;
      }
      case 'note': return h('p', { class: 'sk-hint' + cls(c), text: c.text });
    }
    return h('span');
  }
  function cls(c) { return c.cls ? ' ' + c.cls : ''; }
  function act(name, arg) { const f = actions[name]; if (f) try { f(arg, kit); } catch (e) { console.error(e); } }

  // A colour map control: a gradient button that opens a grid of all maps.
  function cmapControl(c, id) {
    const btn = h('button', { id, class: 'sk-cmapb', type: 'button', 'aria-expanded': 'false', 'aria-label': c.label + ': choose a colour map' }, [h('span', { class: 'sk-cmbar' }), h('span', { class: 'sk-cmname' })]);
    const grid = h('div', { class: 'sk-cmgrid', role: 'listbox', 'aria-label': c.label });
    grid.hidden = true;
    const dice = h('button', { class: 'sk-ib', type: 'button', title: 'Random colour map', 'aria-label': 'Random colour map', icon: 'dice', on: { click: () => change({ [c.key]: K.rng(K.newSeed()).pick((c.random && c.random.pick) || S.cmapIds || K.CMAP_DRAW) }, 'input') } });
    let built = false;
    const build = () => {
      if (built || !CM) return; built = true;
      for (const g of CM.GROUPS) {
        grid.appendChild(h('span', { class: 'sk-cmg', text: CM.GROUP_NAMES[g] || g }));
        for (const m of CM.list(g)) grid.appendChild(h('button', { type: 'button', class: 'sk-cmi', role: 'option', 'data-id': m.id, title: m.name + (m.use ? ' — ' + m.use : ''), 'aria-label': m.name, style: { background: CM.cssGradient(m.id) }, on: { click: () => { change({ [c.key]: m.id }, 'input'); } } }));
      }
    };
    btn.addEventListener('click', () => { loadColormaps().then(() => { build(); grid.hidden = !grid.hidden; btn.setAttribute('aria-expanded', String(!grid.hidden)); }); });
    const paint = v => {
      const bar = btn.firstChild, name = btn.lastChild;
      if (CM) { bar.style.setProperty('background', CM.cssGradient(v)); name.textContent = CM.get(v).name; }
      else { name.textContent = v; loadColormaps().then(() => { if (CM) paint(kit.state[c.key]); }); }
    };
    views.set(c.key, { set: paint });
    return h('div', { class: 'sk-row sk-cmap' + cls(c) }, [h('span', { class: 'sk-lab', text: c.label }), h('div', { class: 'sk-cmrow' }, [btn, dice]), grid]);
  }

  function transportEl() {
    const el = h('nav', { class: 'sk-transport', 'aria-label': 'Simulation transport' });
    const play = h('button', { class: 'sk-tb sk-play', type: 'button', on: { click: () => setPlaying(!kit.playing) } });
    const step = h('button', { class: 'sk-tb', type: 'button', title: 'Step one frame (.)', 'aria-label': 'Step one frame', icon: 'step', on: { click: doStep } });
    const reset = h('button', { class: 'sk-tb', type: 'button', title: 'Reset the scene (R)', 'aria-label': 'Reset the scene', icon: 'reset', on: { click: doReset } });
    const speeds = [0.25, 0.5, 1, 2];
    const seg = h('div', { class: 'sk-speed', role: 'radiogroup', 'aria-label': 'Speed' });
    const sbs = speeds.map(s => { const b = h('button', { type: 'button', role: 'radio', text: s === 0.25 ? '¼×' : s === 0.5 ? '½×' : s + '×', 'aria-label': 'Speed ' + s, on: { click: () => setSpeed(s) } }); seg.appendChild(b); return b; });
    const slow = h('button', { class: 'sk-tb', type: 'button', title: 'Slow motion (S)', 'aria-label': 'Slow motion', 'aria-pressed': 'false', icon: 'slow', on: { click: () => setSlow(!kit.slow) } });
    const dice = h('button', { class: 'sk-tb sk-accent', type: 'button', title: 'New random scene (N)', 'aria-label': 'New random scene', icon: 'dice', on: { click: () => newScene() } });
    const gear = h('button', { class: 'sk-tb sk-gear', type: 'button', title: 'Controls (H)', 'aria-label': 'Show the controls', 'aria-expanded': 'false', 'aria-controls': 'sk-panel', icon: 'gear', on: { click: () => setPanel(!kit.panelOpen) } });
    for (const b of [play, step, reset, seg, slow, dice, gear]) el.appendChild(b);
    const paint = () => {
      play.innerHTML = ICON[kit.playing ? 'pause' : 'play'];
      play.setAttribute('aria-label', kit.playing ? 'Pause (Space)' : 'Play (Space)'); play.setAttribute('title', kit.playing ? 'Pause (Space)' : 'Play (Space)');
      speeds.forEach((s, i) => sbs[i].setAttribute('aria-checked', String(s === kit.baseSpeed)));
      slow.setAttribute('aria-pressed', String(kit.slow));
      gear.setAttribute('aria-expanded', String(kit.panelOpen));
    };
    return { el, paint };
  }

  // ---- state flow ----------------------------------------------------------
  let pendingStep = 0;
  function setPlaying(p) { kit.playing = !!p; tr.paint(); emit('play', kit.playing); }
  function setSpeed(s) { kit.baseSpeed = s; tr.paint(); }
  function setSlow(s) { kit.slow = !!s; tr.paint(); }
  function doStep() { if (kit.playing) setPlaying(false); pendingStep++; emit('step'); }
  function doReset() { emit('reset'); }
  kit.takeStep = () => { if (pendingStep > 0) { pendingStep--; return true; } return false; };
  kit.setPlaying = setPlaying; kit.setSpeed = setSpeed; kit.setSlow = setSlow; kit.step = doStep; kit.reset = doReset;

  function change(delta, why) {
    const out = {};
    for (const k in delta) {
      const c = S.byKey.get(k);
      const v = c ? K.coerce(c, delta[k]) : undefined;
      if (v === undefined || v === kit.state[k]) continue;
      kit.state[k] = v; out[k] = v;
      const vw = views.get(k); if (vw) vw.set(v);
    }
    if (!Object.keys(out).length) return out;
    if (themeKey && themeKey in out) applyTheme(out[themeKey], opts.themeEl);
    emit('change', out, kit.state, why || 'set');
    writeHash();
    return out;
  }
  kit.set = (k, v, why) => change({ [k]: v }, why);
  kit.load = (state, why) => change(state, why || 'load');

  function newScene(seed) {
    kit.seed = seed != null ? seed >>> 0 : K.newSeed();
    const r = K.randomize(S, kit.seed, kit.state, { locks: kit.locks, guard: opts.guard });
    kit.seed = r.seed; seedIn.value = String(kit.seed);
    const out = change(r.state, 'scene');
    emit('scene', kit.seed, kit.state, out);
    writeHash();
    return r;
  }
  function randomizeGroup(gid) {
    const r = K.randomize(S, K.newSeed(), kit.state, { locks: kit.locks, group: gid, guard: opts.guard });
    const out = change(r.state, 'group');
    emit('scene', kit.seed, kit.state, out, gid);
  }
  function toggleLock(gid, on) {
    const v = on != null ? !!on : !kit.locks.has(gid);
    if (v) kit.locks.add(gid); else kit.locks.delete(gid);
    const g = groupEls.get(gid);
    if (g && g.lockB) { g.lockB.setAttribute('aria-pressed', String(v)); g.lockB.innerHTML = ICON[v ? 'lock' : 'unlock']; g.sec.classList.toggle('locked', v); }
    writeHash();
  }
  kit.newScene = newScene; kit.randomizeAll = () => newScene(); kit.randomizeGroup = randomizeGroup; kit.toggleLock = toggleLock;

  // ---- hash -----------------------------------------------------------------
  let hashT = 0;
  kit.hashString = () => K.encodeHash(S, kit.state, kit.seed, kit.locks.size ? { lock: [...kit.locks].join(',') } : null);
  function writeHash() {
    if (!useHash || typeof history === 'undefined' || kit.saver) return;
    clearTimeout(hashT);
    hashT = setTimeout(() => { try { history.replaceState(null, '', '#' + kit.hashString()); } catch (e) { /* sandboxed */ } }, 250);
  }
  kit.shareURL = () => (typeof location !== 'undefined' ? location.href.split('#')[0] : '') + '#' + kit.hashString();
  function copyLink() {
    const url = kit.shareURL();
    const done = () => say('Link copied: seed ' + kit.seed);
    try { navigator.clipboard.writeText(url).then(done, () => say(url)); } catch (e) { say(url); }
  }
  function say(t) { toast.textContent = t; toast.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => toast.classList.remove('on'), 2200); }
  kit.say = say;

  // ---- panel -----------------------------------------------------------------
  function setPanel(o) { kit.panelOpen = !!o; root.classList.toggle('sk-open', kit.panelOpen); tr.paint(); emit('panel', kit.panelOpen); }
  kit.setPanel = setPanel;

  function onKey(e) {
    const t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey || kit.saver) return;
    const k = e.key;
    if (k === ' ' && tag !== 'button') { e.preventDefault(); setPlaying(!kit.playing); }
    else if (k === '.') doStep();
    else if (k === 'r' || k === 'R') doReset();
    else if (k === 'n' || k === 'N') newScene();
    else if (k === 's' || k === 'S') setSlow(!kit.slow);
    else if (k === 'h' || k === 'H') setPanel(!kit.panelOpen);
    else if (k === 'Escape' && kit.panelOpen && phone) setPanel(false);
  }
  const onHash = () => {
    if (kit.saver) return;
    const want = location.hash.replace(/^#/, '');
    if (want === kit.hashString()) return;
    const d = K.decodeHash(S, want);
    if (d.seed != null) { kit.seed = d.seed; seedIn.value = String(kit.seed); }
    change(d.state, 'hash');
  };
  if (typeof addEventListener === 'function') { addEventListener('keydown', onKey); if (useHash) addEventListener('hashchange', onHash); }
  kit.destroy = () => { if (typeof removeEventListener === 'function') { removeEventListener('keydown', onKey); removeEventListener('hashchange', onHash); } root.remove && root.remove(); };

  // Paint every control from state, apply the theme, and attach.
  kit.refresh = () => { for (const [k, vw] of views) vw.set(kit.state[k]); tr.paint(); seedIn.value = String(kit.seed); };
  kit.refresh();
  for (const id of kit.locks) toggleLock(id, true);
  if (themeKey) applyTheme(kit.state[themeKey], opts.themeEl);
  (opts.parent || document.body).appendChild(root);
  setPanel(opts.panelOpen != null ? opts.panelOpen : !phone);
  if (S.byKey.size && [...S.byKey.values()].some(c => c.type === 'cmap')) loadColormaps();
  // The TMP credit bar is fixed at the base: keep the dock and sheet above it.
  const measure = () => { const c = document.getElementById && document.getElementById('tmp-credit'); const v = (c && c.offsetHeight ? c.offsetHeight : 0) + 'px'; document.documentElement.style.setProperty('--sk-credit', v); };
  measure(); setTimeout(measure, 300);
  if (typeof addEventListener === 'function') addEventListener('resize', measure);
  kit.fromHash = fromHash;
  return kit;
}

export { K as core };
