// ============================================================================
//  OUTBREAK  ·  ui.js — the page controls, the HUD and the phone dock
// ----------------------------------------------------------------------------
//  createUI(api) binds the static markup of index.html. It builds the
//  disease chips, the custom-disease sliders (from diseases.js SCHEMA), the
//  policy rows (toggle, strength, trigger), the globe style chips, the
//  speed chips, the HUD and the region table. It owns no simulation state:
//  every change goes to main.js through `api`, and sync() reads the state
//  back with api.getState().
//
//  api (from main.js, package N):
//    getState() -> { disease, policies, style, playing, speed, auto,
//                    seedNode, D, styles? }
//                  disease = the current Disease object; policies = the
//                  Policies object; D = the parsed nodes (data.js);
//                  styles = [{ id, label }] (optional, else STYLES)
//    setDisease(id | Disease), setPolicies(p), setStyle(id), play(bool),
//    setSpeed(daysPerSec), restart(seed?), seedAt(nodeIndex), auto(bool)
//    setChartLog(bool)   optional; else main.js reads ui.chartLog
//    onLayout()          optional; called when the panel or HUD changes
//
//  UI = { update(sim, now?), sync(), setOpen(grp), clearRect(),
//         chartLog, dispose() }
//    update(sim)  refreshes the HUD, the region table and the policy
//                 states, at most four times a second (now in ms)
//    sync()       re-reads api.getState(); call it after Auto or the
//                 director changes the disease, policies or style
//    clearRect()  { l, r, t, b } in CSS px from the top-left: the area
//                 the panel, HUD, base bar and dock leave clear
//
//  The helpers below the imports have no DOM, so node tests can run them.
//
//  grep -n targets: "export const SPEEDS", "export const TRIGGERS",
//    "export function fmtCount", "export function fmtSchema",
//    "export function policyApplies", "export function policyStatus",
//    "export function regionRows", "export function hudValues",
//    "export function responsePolicies", "export function seedChoices",
//    "export function createUI", "function buildPolicies", "function setOpen",
//    "function clearRect", "function bindSheet"
// ============================================================================
import { POLICY_DEFS, defaultPolicies } from './policies.js';
import { PRESETS, SCHEMA, customDisease } from './diseases.js';

export const SPEEDS = [1, 3, 10, 30, 90];                // days per second
export const TRIGGERS = [0, 100, 1000, 1e4, 1e5, 1e6];   // detected cases worldwide
export const STYLES = [
  { id: 'night', label: 'Night' }, { id: 'marble', label: 'Blue Marble' },
  { id: 'dots', label: 'Dots' }, { id: 'flat', label: 'Flat map' }, { id: 'holo', label: 'Hologram' },
];
export const ROUTE_NAMES = {
  resp: 'Respiratory (air and droplets)', contact: 'Close contact with body fluids',
  vector: 'Mosquito-borne', water: 'Water-borne', flea: 'Flea-borne, then person to person',
};
export const PHONE_QUERY = '(max-width:760px), (max-height:520px) and (pointer:coarse)';
const HUD_EVERY_MS = 250;

// ── DOM-free helpers ────────────────────────────────────────────────────────

// Compact people count: 950, 12.4 k, 3.1 M, 1.24 bn.
export function fmtCount(n) {
  n = Math.max(0, +n || 0);
  if (n < 1e3) return String(Math.round(n));
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + ' k';
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' M';
  return (n / 1e9).toFixed(2) + ' bn';
}

export function fmtPct(x) {
  x = (+x || 0) * 100;
  if (x === 0) return '0 %';
  if (x < 0.1) return x.toFixed(3) + ' %';
  if (x < 10) return x.toFixed(x < 1 ? 2 : 1) + ' %';
  return Math.round(x) + ' %';
}

export function fmtTrigger(t) { return t > 0 ? fmtCount(t) + ' cases' : 'day 0'; }

// One SCHEMA value for its slider label. A fraction key (ifr, detect,
// travel, immune0, seasonality) with unit '' or 'fraction' shows as a percentage.
const FRACTION_KEYS = new Set(['ifr', 'detect', 'travel', 'immune0', 'seasonality']);
export function fmtSchema(spec, v) {
  v = +v;
  if (!Number.isFinite(v)) return '—';
  if (spec.unit === '%' || (FRACTION_KEYS.has(spec.key) && (!spec.unit || spec.unit === 'fraction'))) return fmtPct(v);
  const dec = Math.max(0, Math.min(3, -Math.floor(Math.log10(+spec.step || 1))));
  const s = v.toFixed(dec);
  return spec.unit && spec.unit !== 'fraction' ? `${s} ${spec.unit}` : s;
}

// Index of the TRIGGERS entry nearest to `t` (on a log scale).
export function triggerIndex(t) {
  t = +t || 0;
  if (t <= 0) return 0;
  let best = 1, bd = Infinity;
  for (let i = 1; i < TRIGGERS.length; i++) {
    const d = Math.abs(Math.log10(TRIGGERS[i]) - Math.log10(t));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Does a policy change anything for this disease? { applies, why }
export function policyApplies(def, disease) {
  if (!disease) return { applies: true, why: '' };
  if (def.kind === 'vaccine') {
    const v = disease.vaccine;
    if (!v || (v.exists === false && !(+v.lagDays > 0))) return { applies: false, why: 'No vaccine for this disease' };
    if (v.exists === false || +v.lagDays > 0) return { applies: true, why: `Vaccine after ${Math.round(+v.lagDays || 0)} days` };
    return { applies: true, why: '' };
  }
  if (!def.routes || !def.routes.length) return { applies: true, why: '' };
  if (def.routes.includes(disease.route)) return { applies: true, why: '' };
  return { applies: false, why: 'No effect on this route' };
}

// Text for a policy's state: off, waiting for its trigger, or active.
export function policyStatus(p, startDay, detected) {
  if (!p || !p.on) return { state: 'off', text: 'off' };
  if (startDay !== undefined && startDay !== null) return { state: 'live', text: `since day ${Math.floor(startDay)}` };
  const t = +p.trigger || 0;
  if (t <= 0) return { state: 'wait', text: 'starts at day 0' };
  return { state: 'wait', text: `at ${fmtCount(t)} (${fmtCount(Math.min(detected || 0, t))} now)` };
}

// Per-region sums for the region table, sorted by cases (then name).
// D = parsed nodes (data.js: names in D.regions, node region in
// D.region[i] or D.nodes[i].region); sim = the model.js Sim.
export function regionRows(D, sim) {
  const names = (D && D.regions) || [];
  const rows = names.map((name, k) => ({ k, name, pop: 0, I: 0, cases: 0, deaths: 0, cities: 0, reached: 0 }));
  const N = sim ? sim.N : 0;
  for (let i = 0; i < N; i++) {
    const k = nodeRegion(D, i);
    const r = rows[k];
    if (!r) continue;
    const pop = (sim.S[i] || 0) + (sim.E[i] || 0) + (sim.I[i] || 0) + (sim.R[i] || 0) + (sim.D[i] || 0) + (sim.V[i] || 0);
    r.pop += pop; r.I += sim.I[i] || 0; r.cases += sim.cum ? sim.cum[i] || 0 : 0; r.deaths += sim.D[i] || 0;
    r.cities++; if (sim.firstDay && sim.firstDay[i] >= 0) r.reached++;
  }
  for (const r of rows) r.prev = r.pop > 0 ? r.I / r.pop : 0;
  return rows.sort((a, b) => b.cases - a.cases || (a.name < b.name ? -1 : 1));
}
function nodeRegion(D, i) {
  if (!D) return -1;
  if (D.region) return D.region[i];
  if (D.nodes && D.nodes[i]) return D.nodes[i].region;
  return -1;
}

// The HUD numbers from a Sim. reff is null before day 0 has data.
export function hudValues(sim) {
  if (!sim) return { day: 0, infected: 0, cases: 0, deaths: 0, detected: 0, reff: null, cities: 0, pop: 0 };
  const t = sim.totals();
  let cities = 0;
  if (sim.firstDay) for (let i = 0; i < sim.firstDay.length; i++) if (sim.firstDay[i] >= 0) cities++;
  const r = typeof sim.reffGlobal === 'function' ? sim.reffGlobal() : null;
  return { day: sim.day, infected: (t.E || 0) + (t.I || 0), cases: t.cases, deaths: t.deaths, detected: t.detected,
    reff: Number.isFinite(r) ? r : null, cities, pop: t.pop };
}

// One-tap response sets, on a copy of defaultPolicies(). The same pattern
// as the director's scenarios: 'none', 'late', 'early', 'route'.
export function responsePolicies(kind, route) {
  const p = defaultPolicies();
  const on = (id, strength, trigger) => { if (p[id]) Object.assign(p[id], { on: true, strength, trigger }); };
  const vec = route === 'vector' || route === 'flea';
  if (kind === 'late') {
    on('isolation', 0.6, 1e4); on('distancing', 0.5, 1e5); on('vaccination', 0.5, 1e4);
    if (route === 'resp') on('masks', 0.5, 1e5);
    if (vec) on('vectorControl', 0.5, 1e5);
    if (route === 'water') on('cleanWater', 0.5, 1e5);
  } else if (kind === 'early') {
    on('isolation', 0.8, 100); on('quarantine', 0.7, 100); on('travel', 0.8, 1000);
    on('distancing', 0.6, 1000); on('vaccination', 0.8, 1000);
    if (route === 'resp') on('masks', 0.6, 1000);
    if (vec) on('vectorControl', 0.7, 1000);
    if (route === 'water') on('cleanWater', 0.7, 1000);
  } else if (kind === 'route') {
    if (vec) on('vectorControl', 0.8, 1000);
    else if (route === 'water') on('cleanWater', 0.8, 1000);
    else if (route === 'contact') on('isolation', 0.9, 100);
    else { on('masks', 0.7, 1000); on('distancing', 0.6, 1000); }
    if (!p.isolation.on) on('isolation', 0.6, 1000);
  }
  return p;
}

// Which response chip matches the policies (or null).
export function matchResponse(policies, route) {
  for (const kind of ['none', 'late', 'early', 'route']) {
    const r = responsePolicies(kind, route);
    let same = true;
    for (const id of Object.keys(r)) {
      const a = r[id], b = policies && policies[id];
      if (!b || !!a.on !== !!b.on || (a.on && (Math.abs(a.strength - b.strength) > 1e-6 || a.trigger !== b.trigger))) { same = false; break; }
    }
    if (same) return kind;
  }
  return null;
}

// Cities for the start selector: the `n` largest by cityPop, by name.
export function seedChoices(D, n = 60) {
  if (!D) return [];
  const N = nodeCount(D);
  const idx = Array.from({ length: N }, (_, i) => i);
  const pop = i => nodeField(D, 'cityPop', i) || nodeField(D, 'pop', i) || 0;
  idx.sort((a, b) => pop(b) - pop(a));
  return idx.slice(0, Math.min(n, N))
    .map(i => ({ i, name: nodeField(D, 'name', i) || `City ${i}`, country: nodeField(D, 'country', i) || '' }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.i - b.i));
}
function nodeCount(D) { return D.N ?? (D.nodes ? D.nodes.length : D.name ? D.name.length : 0); }
function nodeField(D, k, i) {
  if (D[k] && D[k].length !== undefined && typeof D[k] !== 'string') return D[k][i];
  return D.nodes && D.nodes[i] ? D.nodes[i][k] : undefined;
}

// The disease list for the chips: every preset except 'custom'.
export function presetList() { return PRESETS.filter(d => d.id !== 'custom'); }

// ── the DOM part ────────────────────────────────────────────────────────────

export function createUI(api) {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const phoneQ = matchMedia(PHONE_QUERY);
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  const ui = { chartLog: true };
  let st = api.getState();
  let lastHud = -1e9, customBase = null, lastSim = null;
  const layout = () => { if (api.onLayout) api.onLayout(); };

  const el = (tag, props = {}, kids = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.includes('-') || k === 'role') e.setAttribute(k, v);
      else e[k] = v;
    }
    for (const c of [].concat(kids)) if (c) e.append(c);
    return e;
  };

  // ── disease ────────────────────────────────────────────────────────────
  function buildDiseases() {
    const box = $('diseaseChips');
    box.textContent = '';
    for (const d of presetList()) {
      box.append(el('button', { type: 'button', 'data-id': d.id, text: d.short || d.name, title: d.name, role: 'radio' }));
    }
    box.append(el('button', { type: 'button', 'data-id': 'custom', text: 'Custom', title: 'Edit the values of a disease', role: 'radio' }));
    box.addEventListener('click', e => {
      const b = e.target.closest('button[data-id]');
      if (!b) return;
      if (b.dataset.id === 'custom') {
        customBase = st.disease && st.disease.id !== 'custom' ? st.disease.id : (customBase || presetList()[0].id);
        api.setDisease(makeCustom({}));
      } else api.setDisease(b.dataset.id);
      sync();
    }, sig);
    const sel = $('customBase');
    for (const d of presetList()) sel.append(el('option', { value: d.id, text: d.name }));
    sel.addEventListener('change', () => { customBase = sel.value; api.setDisease(makeCustom({})); sync(); }, sig);
  }

  function baseDisease() { return PRESETS.find(d => d.id === customBase) || presetList()[0]; }
  function makeCustom(patch) {
    const d = customDisease(baseDisease(), patch);
    return { ...d, id: 'custom', name: `Custom (${baseDisease().short || baseDisease().name})` };
  }

  function buildSliders() {
    const box = $('customSliders');
    box.textContent = '';
    for (const s of SCHEMA) {
      const id = 'cs_' + s.key;
      const input = el('input', { type: 'range', id, min: s.min, max: s.max, step: s.step });
      const val = el('span', { class: 'val' });
      input.addEventListener('input', () => { val.textContent = fmtSchema(s, input.value); }, sig);
      input.addEventListener('change', () => {
        const patch = {};
        for (const q of SCHEMA) { const v = $('cs_' + q.key); if (v) patch[q.key] = +v.value; }
        api.setDisease(makeCustom(patch));
        sync();
      }, sig);
      box.append(el('div', { class: 'row' }, [el('label', { htmlFor: id, text: s.label }), input, val]));
    }
  }

  function showDisease() {
    const d = st.disease;
    const custom = d && d.id === 'custom';
    for (const b of $('diseaseChips').querySelectorAll('button')) {
      const on = custom ? b.dataset.id === 'custom' : !!d && b.dataset.id === d.id;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
    }
    $('customBox').hidden = !custom;
    if (custom) {
      if (!customBase) customBase = presetList()[0].id;
      for (const o of $('customBase').querySelectorAll('option')) o.selected = o.value === customBase;
      for (const s of SCHEMA) {
        const input = $('cs_' + s.key);
        if (!input) continue;
        const v = getPath(d, s.key);
        if (Number.isFinite(+v) && document.activeElement !== input) input.value = v;
        input.nextElementSibling.textContent = fmtSchema(s, input.value);
      }
    }
    const card = $('diseaseCard');
    card.textContent = '';
    if (!d) return;
    const vac = d.vaccine ? (d.vaccine.exists === false || +d.vaccine.lagDays > 0 ? `after ${Math.round(+d.vaccine.lagDays || 0)} d` : 'yes') : 'none';
    const cells = [
      ['R₀', (+d.R0).toFixed(d.R0 < 10 ? 1 : 0)],
      ['Latent', d.latent > 0 ? `${+d.latent} d` : 'none'],
      ['Infectious', `${+d.infectious} d`],
      ['Fatality', fmtPct(d.ifr) + (d.careSensitive ? '*' : '')],
      ['Immunity', d.waning > 0 ? `${Math.round(d.waning)} d` : 'lifelong'],
      ['Vaccine', vac],
    ];
    card.append(...[
      el('div', { class: 'd-name', text: d.name }),
      el('div', { class: 'd-route', text: ROUTE_NAMES[d.route] || d.route || '' }),
      d.blurb ? el('div', { class: 'd-blurb', text: d.blurb }) : null,
      el('dl', {}, cells.map(([k, v]) => el('div', {}, [el('dt', { text: k }), el('dd', { text: v })]))),
      el('div', { class: 'd-note', text: (d.careSensitive ? '* Higher where health care is weaker. ' : '') + 'All values are approximate and illustrative.' }),
    ].filter(Boolean));
  }
  function getPath(o, key) { return key.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }

  function buildSeeds() {
    const sel = $('seedCity');
    sel.textContent = '';
    sel.append(el('option', { value: '-1', text: 'A random large city' }));
    for (const c of seedChoices(st.D)) sel.append(el('option', { value: String(c.i), text: c.country ? `${c.name}, ${c.country}` : c.name }));
    sel.addEventListener('change', () => { if (+sel.value >= 0) api.seedAt(+sel.value); else api.restart(); sync(); }, sig);
    $('newRun').addEventListener('click', () => { api.restart((Math.random() * 4294967296) >>> 0); sync(); }, sig);
  }

  // ── policies ───────────────────────────────────────────────────────────
  const polEls = {};
  function buildPolicies() {
    const box = $('policyRows');
    box.textContent = '';
    for (const def of POLICY_DEFS) {
      const tg = el('button', { type: 'button', class: 'tg', 'aria-label': `${def.name} on or off` });
      const stt = el('span', { class: 'st' });
      const str = el('input', { type: 'range', min: 0, max: 100, step: 5, id: 'ps_' + def.id });
      const strV = el('span', { class: 'val' });
      const trg = el('input', { type: 'range', min: 0, max: TRIGGERS.length - 1, step: 1, id: 'pt_' + def.id });
      const trgV = el('span', { class: 'val' });
      const row = el('div', { class: 'pol', 'data-id': def.id }, [
        el('div', { class: 'pol-head' }, [tg, el('b', { text: def.name }), stt]),
        el('div', { class: 'blurb', text: def.blurb }),
        el('div', { class: 'row' }, [el('label', { htmlFor: str.id, text: 'Strength' }), str, strV]),
        el('div', { class: 'row' }, [el('label', { htmlFor: trg.id, text: 'Starts at' }), trg, trgV]),
      ]);
      polEls[def.id] = { row, tg, stt, str, strV, trg, trgV };
      const edit = fn => { const p = clonePolicies(st.policies); fn(p[def.id]); api.setPolicies(p); sync(); };
      tg.addEventListener('click', () => edit(q => { q.on = !q.on; }), sig);
      str.addEventListener('input', () => { strV.textContent = str.value + ' %'; }, sig);
      str.addEventListener('change', () => edit(q => { q.strength = str.value / 100; }), sig);
      trg.addEventListener('input', () => { trgV.textContent = fmtTriggerShort(TRIGGERS[trg.value]); }, sig);
      trg.addEventListener('change', () => edit(q => { q.trigger = TRIGGERS[trg.value]; }), sig);
      box.append(row);
    }
    $('responseChips').addEventListener('click', e => {
      const b = e.target.closest('button[data-resp]');
      if (!b) return;
      api.setPolicies(responsePolicies(b.dataset.resp, st.disease && st.disease.route));
      sync();
    }, sig);
  }
  const fmtTriggerShort = t => (t > 0 ? fmtCount(t) : 'day 0');

  function showPolicies() {
    const P = st.policies || {};
    for (const def of POLICY_DEFS) {
      const E = polEls[def.id], p = P[def.id];
      if (!E || !p) continue;
      const ap = policyApplies(def, st.disease);
      E.row.classList.toggle('on', !!p.on);
      E.row.classList.toggle('na', !ap.applies);
      E.tg.setAttribute('aria-pressed', !!p.on);
      if (document.activeElement !== E.str) E.str.value = Math.round((+p.strength || 0) * 100);
      E.strV.textContent = E.str.value + ' %';
      if (document.activeElement !== E.trg) E.trg.value = triggerIndex(p.trigger);
      E.trgV.textContent = fmtTriggerShort(TRIGGERS[E.trg.value]);
      E.row.title = ap.why;
    }
    const kind = matchResponse(P, st.disease && st.disease.route);
    for (const b of $('responseChips').querySelectorAll('button')) b.classList.toggle('on', b.dataset.resp === kind);
    showPolicyStates(lastSim);
  }

  function showPolicyStates(sim) {
    const P = st.policies || {};
    const active = (sim && sim.active) || {};
    const detected = sim ? (sim.totals().detected || 0) : 0;
    const live = [];
    for (const def of POLICY_DEFS) {
      const E = polEls[def.id];
      if (!E) continue;
      const s = policyStatus(P[def.id], active[def.id], detected);
      const ap = policyApplies(def, st.disease);
      E.stt.textContent = !ap.applies && P[def.id] && P[def.id].on ? ap.why.toLowerCase() : s.text;
      E.row.classList.toggle('live', s.state === 'live');
      if (s.state === 'live' && ap.applies) live.push(def.name);
    }
    const hp = $('hudPolicies');
    hp.textContent = '';
    for (const n of live) hp.append(el('span', { text: n }));
  }

  // ── view ───────────────────────────────────────────────────────────────
  function buildView() {
    const sc = $('styleChips');
    sc.textContent = '';
    for (const s of (st.styles && st.styles.length ? st.styles : STYLES)) sc.append(el('button', { type: 'button', 'data-id': s.id, text: s.label, role: 'radio' }));
    sc.addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (b) { api.setStyle(b.dataset.id); sync(); } }, sig);
    const sp = $('speedChips');
    sp.textContent = '';
    for (const v of SPEEDS) sp.append(el('button', { type: 'button', 'data-v': v, text: `${v} d/s`, role: 'radio' }));
    sp.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) { api.setSpeed(+b.dataset.v); sync(); } }, sig);
  }
  function showView() {
    for (const b of $('styleChips').querySelectorAll('button')) { const on = b.dataset.id === st.style; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
    for (const b of $('speedChips').querySelectorAll('button')) { const on = +b.dataset.v === st.speed; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
    $('speedBtn').textContent = `${st.speed} d/s`;
    const play = !!st.playing;
    $('play').classList.toggle('on', play);
    $('play').firstElementChild.textContent = play ? '❚❚' : '▶';
    $('play').setAttribute('aria-label', play ? 'Pause' : 'Play');
    $('dockPlay').firstElementChild.textContent = play ? '❚❚' : '▶';
    $('dockPlay').lastElementChild.textContent = play ? 'Pause' : 'Play';
    const auto = !!st.auto;
    $('autoBtn').classList.toggle('on', auto);
    $('dockAuto').classList.toggle('on', auto);
    if (root.classList.contains('auto') !== auto) {
      root.classList.toggle('auto', auto);
      if (auto) setOpen(null);
      layout();
    }
    $('chartScale').textContent = ui.chartLog ? 'Log' : 'Linear';
  }

  // ── HUD ────────────────────────────────────────────────────────────────
  function showHud(sim) {
    const h = hudValues(sim);
    $('hudDisease').textContent = st.disease ? st.disease.name : '—';
    $('hudDay').textContent = `Day ${Math.floor(h.day)}`;
    $('hudInfected').textContent = fmtCount(h.infected);
    $('hudCases').textContent = fmtCount(h.cases);
    $('hudDeaths').textContent = fmtCount(h.deaths);
    $('hudDetected').textContent = fmtCount(h.detected);
    $('hudCities').textContent = `${h.cities} / ${sim ? sim.N : 0}`;
    const r = $('hudReff');
    r.textContent = h.reff === null ? '—' : h.reff.toFixed(2);
    r.classList.toggle('up', h.reff !== null && h.reff > 1);
    r.classList.toggle('down', h.reff !== null && h.reff <= 1);
    if ($('hud').classList.contains('fold') || root.classList.contains('auto')) return;
    const rows = regionRows(st.D, sim);
    const maxPrev = Math.max(1e-12, ...rows.map(x => x.prev));
    const tb = $('regionRows');
    tb.textContent = '';
    for (const x of rows) {
      const name = el('td', {}, [document.createTextNode(x.name), el('i', { class: 'bar' })]);
      name.lastChild.style.width = `${Math.round(100 * x.prev / maxPrev)}%`;
      const tr = el('tr', { class: x.prev > 0.001 ? 'hot' : '' }, [
        name, el('td', { text: fmtCount(x.I) }), el('td', { text: fmtCount(x.cases) }), el('td', { text: fmtCount(x.deaths) })]);
      tr.title = `${x.reached} of ${x.cities} cities reached`;
      tb.append(tr);
    }
  }

  // ── panel, sheet and dock ──────────────────────────────────────────────
  function setOpen(grp) {
    const p = $('panel');
    if (!phoneQ.matches) { p.classList.remove('open', 'full'); p.dataset.grp = ''; for (const g of p.querySelectorAll('.grp')) g.classList.remove('show'); return; }
    const same = p.classList.contains('open') && p.dataset.grp === grp;
    if (!grp || same) { p.classList.remove('open', 'full'); p.dataset.grp = ''; }
    else { p.classList.add('open'); p.dataset.grp = grp; }
    for (const g of p.querySelectorAll('.grp')) g.classList.toggle('show', g.dataset.grp === p.dataset.grp);
    for (const t of document.querySelectorAll('#dock .tab[data-grp]')) t.classList.toggle('on', t.dataset.grp === p.dataset.grp);
    layout();
  }

  function bindSheet() {
    const g = $('sheetGrip');
    let y0 = null;
    g.addEventListener('pointerdown', e => { y0 = e.clientY; g.setPointerCapture(e.pointerId); }, sig);
    g.addEventListener('pointerup', e => {
      if (y0 === null) return;
      const d = e.clientY - y0, p = $('panel');
      y0 = null;
      if (d < -30) { p.classList.add('full'); layout(); }
      else if (d > 30) { if (p.classList.contains('full')) { p.classList.remove('full'); layout(); } else setOpen(null); }
    }, sig);
    g.addEventListener('pointercancel', () => { y0 = null; }, sig);
    $('panelClose').addEventListener('click', () => setOpen(null), sig);
    for (const t of document.querySelectorAll('#dock .tab[data-grp]')) t.addEventListener('click', () => setOpen(t.dataset.grp), sig);
    phoneQ.addEventListener('change', () => { setOpen(null); if (phoneQ.matches) $('hud').classList.add('fold'); layout(); }, sig);
    if (phoneQ.matches) $('hud').classList.add('fold');
  }

  // The clear area: the frame minus the panel, HUD, base bar and dock.
  // A panel that covers most of the width (a phone sheet) cuts the bottom;
  // a narrow one at the side cuts that side.
  function clearRect() {
    const W = innerWidth, H = innerHeight;
    const r = { l: 0, r: W, t: 0, b: H };
    const vis = id => {
      const e = $(id);
      if (!e || e.hidden) return null;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return null;
      const q = e.getBoundingClientRect();
      if (q.width < 2 || q.height < 2 || q.right <= 0 || q.left >= W || q.bottom <= 0 || q.top >= H) return null;
      return q;
    };
    for (const id of ['base', 'dock', 'panel', 'hud']) {
      const q = vis(id);
      if (!q) continue;
      if (q.width > W * 0.6) {
        if (q.top > H * 0.5) r.b = Math.min(r.b, q.top - 4);
        else r.t = Math.max(r.t, q.bottom + 4);
      } else if (q.left < W * 0.5) r.l = Math.max(r.l, q.right + 6);
      else r.r = Math.min(r.r, q.left - 6);
    }
    if (r.r - r.l < W * 0.3) { r.l = 0; r.r = W; }
    if (r.b - r.t < H * 0.25) { r.t = 0; r.b = H; }
    return r;
  }

  // ── base bar and keys ──────────────────────────────────────────────────
  function bindBase() {
    const togglePlay = () => { api.play(!st.playing); sync(); };
    $('play').addEventListener('click', togglePlay, sig);
    $('dockPlay').addEventListener('click', togglePlay, sig);
    $('speedBtn').addEventListener('click', () => {
      const i = (SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length;
      api.setSpeed(SPEEDS[i < 0 ? 1 : i]); sync();
    }, sig);
    $('restart').addEventListener('click', () => { api.restart(); sync(); }, sig);
    const toggleAuto = () => { api.auto(!st.auto); sync(); };
    $('autoBtn').addEventListener('click', toggleAuto, sig);
    $('dockAuto').addEventListener('click', toggleAuto, sig);
    $('chartScale').addEventListener('click', () => {
      ui.chartLog = !ui.chartLog;
      if (api.setChartLog) api.setChartLog(ui.chartLog);
      showView();
    }, sig);
    $('hudFold').addEventListener('click', () => { $('hud').classList.toggle('fold'); showHud(lastSim); layout(); }, sig);
    addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'a' || e.key === 'A') toggleAuto();
      else if (e.key === 'r' || e.key === 'R') { api.restart(); sync(); }
    }, sig);
  }

  // ── about: the model equations, typeset when equations.js exists ───────
  async function typesetAbout() {
    try {
      const [eq, sm] = await Promise.all([import('./equations.js'), import('../../lib/sci-math.js')]);
      const box = $('eqs');
      box.textContent = '';
      const list = st.disease && eq.texFor ? eq.texFor(st.disease) : Object.values(eq.TEX || {}).slice(0, 2);
      for (const tex of list) {
        const d = el('div', { class: 'sci-eq' });
        box.append(d);
        await sm.typeset(d, tex, { rules: eq.RULES || null });
      }
    } catch { /* equations.js or MathJax missing: the about text stands alone */ }
  }

  function sync() {
    st = api.getState();
    showDisease(); showPolicies(); showView();
    if (lastSim) showHud(lastSim);
  }

  buildDiseases(); buildSliders(); buildSeeds(); buildPolicies(); buildView();
  bindSheet(); bindBase();
  sync();
  typesetAbout();
  let eqDisease = st.disease && st.disease.id;

  ui.update = (sim, now = performance.now()) => {
    lastSim = sim;
    if (now - lastHud < HUD_EVERY_MS) return;
    lastHud = now;
    const s = api.getState();
    if (s.disease !== st.disease || s.policies !== st.policies || s.auto !== st.auto || s.playing !== st.playing || s.style !== st.style || s.speed !== st.speed) sync();
    if (st.disease && st.disease.id !== eqDisease) { eqDisease = st.disease.id; typesetAbout(); }
    showHud(sim);
    showPolicyStates(sim);
  };
  ui.sync = sync;
  ui.setOpen = setOpen;
  ui.clearRect = clearRect;
  ui.dispose = () => ac.abort();
  return ui;
}

function clonePolicies(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || defaultPolicies())) out[k] = { ...v };
  return out;
}
