// ct-lab/colormaps/picker.js -- colour map picker component, no framework.
//
// The picker shows the catalogue from maps.js as a grouped grid of swatch
// buttons. It has a search field, group chips, a reverse toggle, a gamma
// slider and a random button. It sends a 'change' event with
// detail { id, reverse, gamma, map } each time the state changes.
//
// grep -n targets:
//   export class ColormapPicker     constructor(host, opts), value, set(), destroy()
//   export function createPicker
//   export function matchMap        search filter
//   export function gammaFromSlider / sliderFromGamma   log gamma scale
//   onGridKey                       arrow, Home, End keys (roving tabindex)
//   _paint                          swatch gradients after reverse or gamma
//
// Keyboard: Tab enters the grid on the selected swatch. Arrow keys move the
// selection, Up and Down move by one grid row. Home and End go to the first
// and last visible swatch. "/" in the picker moves focus to the search field.
// Load picker.css with this module.
import * as M from './maps.js';

const GAMMA_SPAN = Math.log2(3); // slider -1..1 maps to gamma 1/3..3

export function gammaFromSlider(s) {
  return Math.round(Math.pow(2, Math.max(-1, Math.min(1, +s || 0)) * GAMMA_SPAN) * 100) / 100;
}
export function sliderFromGamma(g) {
  return Math.max(-1, Math.min(1, Math.log2(g > 0 ? g : 1) / GAMMA_SPAN));
}

/** True when the map matches every word of the query (name, id, group, kind, use). */
export function matchMap(map, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return true;
  const hay = `${map.name} ${map.id} ${map.group} ${M.GROUP_NAMES[map.group] || ''} ${map.kind} ${map.use}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

let uid = 0;

export class ColormapPicker extends EventTarget {
  /**
   * host: element to fill. opts: { value, reverse, gamma, groups, compact,
   * label }. groups limits the catalogue (for example ['diverging']).
   */
  constructor(host, opts = {}) {
    super();
    this.host = host;
    this.doc = host.ownerDocument || globalThis.document;
    this.groups = (opts.groups || M.GROUPS).filter((g) => M.GROUPS.includes(g));
    this.maps = M.list().filter((m) => this.groups.includes(m.group));
    this.state = {
      id: this.maps.some((m) => m.id === opts.value) ? opts.value : this.maps[0].id,
      reverse: !!opts.reverse,
      gamma: opts.gamma > 0 ? +opts.gamma : 1,
    };
    this.query = '';
    this.groupFilter = null;
    this.swatches = new Map(); // id -> button
    this.sections = new Map(); // group -> { el, ids }
    this._raf = 0;
    this._build(opts);
    this._sync();
  }

  get value() { return { ...this.state }; }

  /** Change state. { silent: true } skips the change event. */
  set(next = {}, { silent = false } = {}) {
    const s = this.state;
    const id = next.id !== undefined && this.swatches.has(next.id) ? next.id : s.id;
    const reverse = next.reverse !== undefined ? !!next.reverse : s.reverse;
    const gamma = next.gamma > 0 ? +next.gamma : s.gamma;
    const look = reverse !== s.reverse || gamma !== s.gamma;
    const changed = look || id !== s.id;
    this.state = { id, reverse, gamma };
    this._sync(look);
    if (changed && !silent) this._emit();
    return this;
  }

  random() {
    const pool = this.maps.filter((m) => m.id !== this.state.id && this._visible(m));
    const from = pool.length ? pool : this.maps;
    const pick = from[Math.floor(Math.random() * from.length)];
    this.set({ id: pick.id });
    this.swatches.get(pick.id)?.scrollIntoView?.({ block: 'nearest' });
  }

  destroy() {
    if (this._raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._raf);
    this.root.remove();
  }

  // ---------------------------------------------------------------- build
  _el(tag, cls, attrs = {}, text) {
    const e = this.doc.createElement(tag);
    if (cls) e.className = cls;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  _build(opts) {
    const n = ++uid;
    const root = this._el('div', `cmp${opts.compact ? ' cmp-compact' : ''}`, { role: 'group', 'aria-label': opts.label || 'Colour map' });
    this.root = root;

    // Current map preview.
    const cur = this._el('div', 'cmp-current');
    this.curBar = this._el('div', 'cmp-current-bar', { 'aria-hidden': 'true' });
    const curText = this._el('div', 'cmp-current-text');
    this.curName = this._el('div', 'cmp-current-name', { id: `cmp-name-${n}`, 'aria-live': 'polite' });
    this.curUse = this._el('div', 'cmp-current-use');
    curText.append(this.curName, this.curUse);
    cur.append(this.curBar, curText);

    // Tools: search, reverse, random.
    const tools = this._el('div', 'cmp-tools');
    this.search = this._el('input', 'cmp-search', {
      type: 'search', placeholder: 'Search maps', 'aria-label': 'Search colour maps', autocomplete: 'off', spellcheck: 'false',
    });
    this.revBtn = this._el('button', 'cmp-btn cmp-rev', { type: 'button', 'aria-pressed': 'false', title: 'Reverse the map' }, 'Reverse');
    this.randBtn = this._el('button', 'cmp-btn cmp-rand', { type: 'button', title: 'Pick a random map' }, 'Random');
    tools.append(this.search, this.revBtn, this.randBtn);

    // Gamma.
    const gw = this._el('label', 'cmp-gamma');
    const gl = this._el('span', 'cmp-gamma-label', {}, 'Gamma');
    this.gamma = this._el('input', 'cmp-gamma-range', {
      type: 'range', min: '-1', max: '1', step: '0.01', value: '0', 'aria-label': 'Gamma',
    });
    this.gammaOut = this._el('output', 'cmp-gamma-out', {}, '1.00');
    gw.append(gl, this.gamma, this.gammaOut);

    // Group chips.
    const chips = this._el('div', 'cmp-chips', { role: 'toolbar', 'aria-label': 'Groups' });
    this.chips = [];
    if (this.groups.length > 1) {
      for (const g of [null, ...this.groups]) {
        const c = this._el('button', 'cmp-chip', { type: 'button', 'aria-pressed': g === null ? 'true' : 'false' }, g ? M.GROUP_NAMES[g] : 'All');
        c.addEventListener('click', () => { this.groupFilter = g; this._filter(); });
        this.chips.push([g, c]);
        chips.append(c);
      }
    } else chips.hidden = true;

    // Grid.
    const list = this._el('div', 'cmp-list', { role: 'radiogroup', 'aria-labelledby': `cmp-name-${n}` });
    this.list = list;
    for (const g of this.groups) {
      const sec = this._el('section', 'cmp-section');
      const h = this._el('h3', 'cmp-section-title', {}, M.GROUP_NAMES[g]);
      const grid = this._el('div', 'cmp-grid');
      const ids = [];
      for (const m of M.list(g)) {
        const b = this._el('button', 'cmp-sw', {
          type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-id': m.id, title: m.use,
        });
        const bar = this._el('span', 'cmp-sw-bar', { 'aria-hidden': 'true' });
        const name = this._el('span', 'cmp-sw-name', {}, m.name);
        b.append(bar, name);
        b._bar = bar;
        b.addEventListener('click', () => { this.set({ id: m.id }); b.focus(); });
        this.swatches.set(m.id, b);
        ids.push(m.id);
        grid.append(b);
      }
      sec.append(h, grid);
      sec._grid = grid;
      this.sections.set(g, { el: sec, ids });
      list.append(sec);
    }
    this.empty = this._el('p', 'cmp-empty', {}, 'No maps match.');
    this.empty.hidden = true;
    list.append(this.empty);

    root.append(cur, tools, gw, chips, list);
    this.host.append(root);

    // Events.
    this.search.addEventListener('input', () => { this.query = this.search.value; this._filter(); });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        const first = this._visibleIds()[0];
        if (first) { this.set({ id: first }); this.swatches.get(first).focus(); }
      } else if (e.key === 'Escape' && this.search.value) {
        e.preventDefault(); this.search.value = ''; this.query = ''; this._filter();
      }
    });
    this.revBtn.addEventListener('click', () => this.set({ reverse: !this.state.reverse }));
    this.randBtn.addEventListener('click', () => this.random());
    this.gamma.addEventListener('input', () => this.set({ gamma: gammaFromSlider(this.gamma.value) }));
    this.gamma.addEventListener('dblclick', () => this.set({ gamma: 1 }));
    list.addEventListener('keydown', (e) => this.onGridKey(e));
    root.addEventListener('keydown', (e) => {
      if (e.key === '/' && e.target !== this.search) { e.preventDefault(); this.search.focus(); }
    });
  }

  // ---------------------------------------------------------------- state -> DOM
  _sync(look = true) {
    const { id, reverse, gamma } = this.state;
    const m = M.get(id);
    for (const [sid, b] of this.swatches) {
      const on = sid === id;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
      b.classList.toggle('is-on', on);
    }
    // When the selection is hidden by a filter, keep the grid reachable.
    if (!this._visible(m)) {
      const f = this._visibleIds()[0];
      if (f) this.swatches.get(f).setAttribute('tabindex', '0');
    }
    this.curName.textContent = `${m.name}${reverse ? ' (reversed)' : ''}`;
    this.curUse.textContent = m.use;
    this.revBtn.setAttribute('aria-pressed', reverse ? 'true' : 'false');
    this.gammaOut.textContent = gamma.toFixed(2);
    this.gamma.value = String(sliderFromGamma(gamma));
    this.gamma.setAttribute('aria-valuetext', `gamma ${gamma.toFixed(2)}`);
    this.curBar.style.background = M.cssGradient(id, { reverse, gamma });
    if (look) this._paint();
  }

  _paint() {
    const run = () => {
      this._raf = 0;
      const { reverse, gamma } = this.state;
      for (const [sid, b] of this.swatches) b._bar.style.background = M.cssGradient(sid, { reverse, gamma }, '90deg', 12);
    };
    if (typeof requestAnimationFrame === 'function') {
      if (!this._raf) this._raf = requestAnimationFrame(run);
    } else run();
  }

  _visible(m) {
    return (this.groupFilter === null || m.group === this.groupFilter) && matchMap(m, this.query);
  }

  _visibleIds() {
    const out = [];
    for (const g of this.groups) for (const id of this.sections.get(g).ids) if (this._visible(M.get(id))) out.push(id);
    return out;
  }

  _filter() {
    let any = false;
    for (const [g, sec] of this.sections) {
      let n = 0;
      for (const id of sec.ids) {
        const v = this._visible(M.get(id));
        this.swatches.get(id).hidden = !v;
        if (v) n++;
      }
      sec.el.hidden = n === 0;
      any = any || n > 0;
    }
    this.empty.hidden = any;
    for (const [g, c] of this.chips) c.setAttribute('aria-pressed', g === this.groupFilter ? 'true' : 'false');
    this._sync(false);
  }

  _columns(id) {
    const grid = this.swatches.get(id)?.parentNode;
    const view = this.doc.defaultView;
    if (!grid || !view?.getComputedStyle) return 1;
    const cols = view.getComputedStyle(grid).gridTemplateColumns || '';
    return Math.max(1, cols.split(' ').filter(Boolean).length);
  }

  /** Arrow keys move the selection inside the visible swatches. */
  onGridKey(e) {
    const vis = this._visibleIds();
    if (!vis.length) return;
    const curId = e.target?.getAttribute?.('data-id') || this.state.id;
    let i = vis.indexOf(curId);
    if (i < 0) i = 0;
    const cols = this._columns(curId);
    // Up and Down stay inside the group grid and then cross to the next group.
    const grp = M.get(curId).group;
    const inGrp = vis.filter((id) => M.get(id).group === grp);
    const gi = inGrp.indexOf(curId);
    let next = null;
    switch (e.key) {
      case 'ArrowRight': next = vis[Math.min(vis.length - 1, i + 1)]; break;
      case 'ArrowLeft': next = vis[Math.max(0, i - 1)]; break;
      case 'ArrowDown':
        next = gi + cols < inGrp.length ? inGrp[gi + cols]
          : vis[Math.min(vis.length - 1, i + (inGrp.length - gi))];
        break;
      case 'ArrowUp':
        next = gi - cols >= 0 ? inGrp[gi - cols] : vis[Math.max(0, i - gi - 1)];
        break;
      case 'Home': next = vis[0]; break;
      case 'End': next = vis[vis.length - 1]; break;
      default: return;
    }
    e.preventDefault?.();
    if (next && next !== this.state.id) this.set({ id: next });
    this.swatches.get(next)?.focus?.();
  }

  _emit() {
    const detail = { ...this.state, map: M.get(this.state.id) };
    this.dispatchEvent(new CustomEvent('change', { detail }));
    this.host.dispatchEvent?.(new CustomEvent('cmapchange', { detail, bubbles: true }));
  }
}

/** Make a picker inside host. See ColormapPicker for opts. */
export function createPicker(host, opts) {
  return new ColormapPicker(host, opts);
}
