// ============================================================================
//  NEURON LAB  ·  randpanel.js  ·  the Randomize panel
// ----------------------------------------------------------------------------
//  Builds the controls in #randBody from engine/random.js RANGES: a dice
//  for all categories, a seed box, and one block per category with a lock,
//  a dice for that category, and one row per key (on/off, low, high). Type
//  chips for the cell type mix and choice chips for placement and wiring.
//  It holds no physics: it edits the state object RS and calls
//    onApply(cats)   after a dice or a seed (the page rebuilds those cats)
//    onRanges()      after a range edit (the page writes the hash)
//  RS: { seed, seeds: { cat: n }, lock: [cat], ranges: { cat: { key: {...} } } }
//
//  grep -n targets
//    "export function createRandPanel"  the factory
//    "function render"                  the markup
//    "function roll"                    new seeds for some categories
// ============================================================================
import { CATS, RANGES, catSeed } from './engine/random.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CH_LABEL = {
  pyramidal: 'Pyramidal', purkinje: 'Purkinje', motor: 'Motor', granule: 'Granule',
  line: 'Line', ring: 'Ring', layer: 'Layer', cluster: 'Cluster',
  chain: 'Chain', all: 'All-to-all', ff: 'Feed-forward', random: 'Random p', ei: 'E/I (Dale)', loop: 'Loop + inhibition',
};
const fmtN = v => { const a = Math.abs(v); return a === 0 ? '0' : a < 0.001 ? v.toExponential(1) : a < 0.1 ? v.toFixed(4) : a < 10 ? v.toFixed(2) : v.toFixed(1); };

export function createRandPanel({ host, RS, onApply, onRanges, values, netOK = () => true }) {
  const open = new Set();
  const newSeed = () => 1 + Math.floor(Math.random() * 999983);

  function roll(cats, master) {
    if (master != null) RS.seed = master;
    for (const c of cats) if (!RS.lock.includes(c)) RS.seeds[c] = master != null ? catSeed(master, c) : newSeed();
    onApply(cats.filter(c => !RS.lock.includes(c)));
    render();
  }
  const rng = (cat, k) => ({ ...RANGES[cat][k], ...((RS.ranges[cat] || {})[k] || {}) });
  const setR = (cat, k, o) => {
    const cur = { ...((RS.ranges[cat] || {})[k] || {}), ...o };
    const base = RANGES[cat][k];
    // drop fields equal to the defaults so the hash stays short
    if (cur.lo === base.lo) delete cur.lo; if (cur.hi === base.hi) delete cur.hi; if (cur.on !== false) delete cur.on;
    if (cur.choices && base.choices && cur.choices.length === base.choices.length) delete cur.choices;
    if (cur.lo != null && cur.hi == null) cur.hi = base.hi; if (cur.hi != null && cur.lo == null) cur.lo = base.lo;
    RS.ranges[cat] = RS.ranges[cat] || {};
    if (Object.keys(cur).length) RS.ranges[cat][k] = cur; else delete RS.ranges[cat][k];
    if (!Object.keys(RS.ranges[cat]).length) delete RS.ranges[cat];
    onRanges();
  };

  function keyRow(cat, k) {
    const r = rng(cat, k), on = r.on !== false, v = values(cat)[k];
    if (r.choices) {
      const pool = r.choices.length ? r.choices : RANGES[cat][k].choices;
      const all = RANGES[cat][k].choices;
      return `<div class="rkey ch"><span class="rl">${esc(r.label)}</span><div class="chips">${all.map(c =>
        `<button type="button" class="chip${pool.includes(c) ? ' on' : ''}" data-cat="${cat}" data-k="${k}" data-ch="${c}">${esc(CH_LABEL[c] || c)}</button>`).join('')}</div>
        <span class="rv">${esc(Array.isArray(v) ? '' : (CH_LABEL[v] || v || ''))}</span></div>`;
    }
    return `<div class="rkey${on ? '' : ' off'}">
      <label class="rck"><input type="checkbox" data-cat="${cat}" data-k="${k}" data-f="on"${on ? ' checked' : ''}><span>${esc(r.label)}</span></label>
      <input type="number" inputmode="decimal" step="any" data-cat="${cat}" data-k="${k}" data-f="lo" value="${r.lo}" aria-label="${esc(r.label)} low">
      <input type="number" inputmode="decimal" step="any" data-cat="${cat}" data-k="${k}" data-f="hi" value="${r.hi}" aria-label="${esc(r.label)} high">
      <span class="rv" title="${esc(r.unit || '')}">${v == null ? '' : fmtN(+v)}</span></div>`;
  }

  function render() {
    const body = CATS.map(C => {
      const locked = RS.lock.includes(C.id), isOpen = open.has(C.id), s = RS.seeds[C.id] || 0;
      const dis = C.id === 'wire' && !netOK();
      return `<div class="rcat${locked ? ' locked' : ''}" data-cat="${C.id}">
        <div class="rhead">
          <button type="button" class="rname" data-act="open" data-cat="${C.id}" aria-expanded="${isOpen}"><b>${esc(C.label)}</b><span>${esc(C.note)} · ${s ? 'seed ' + s : 'defaults'}</span></button>
          <button type="button" class="ricon${locked ? ' on' : ''}" data-act="lock" data-cat="${C.id}" aria-label="Lock ${esc(C.label)}" title="Lock: the dice leave it">${locked ? 'Locked' : 'Lock'}</button>
          <button type="button" class="ricon" data-act="roll" data-cat="${C.id}" aria-label="Randomize ${esc(C.label)}" title="Randomize this category"${locked ? ' disabled' : ''}>⚄</button>
        </div>
        ${dis ? '<p class="note">Network values apply in Network mode.</p>' : ''}
        <div class="rkeys"${isOpen ? '' : ' hidden'}>
          <div class="rkh"><span></span><span>low</span><span>high</span><span>now</span></div>
          ${Object.keys(RANGES[C.id]).map(k => keyRow(C.id, k)).join('')}
          <button type="button" class="tog rreset" data-act="defaults" data-cat="${C.id}">Back to defaults</button>
        </div>
      </div>`;
    }).join('');
    host.innerHTML = `
      <div class="rtop">
        <button type="button" class="big rdice" data-act="all">⚄ Randomize all</button>
        <div class="rseed"><label for="rseedIn">Seed</label><input id="rseedIn" type="number" inputmode="numeric" min="1" max="999999999" value="${RS.seed || ''}" placeholder="—"><button type="button" class="tog" data-act="seed">Use</button></div>
      </div>
      <p class="note">One seed per category. The URL keeps the seeds, the locks and any range you change, so a link gives the same lab. Ranges stay in physiological bounds unless you change them.</p>
      ${body}`;
  }

  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const cat = b.dataset.cat, act = b.dataset.act;
    if (b.dataset.ch) {
      const r = rng(cat, b.dataset.k), all = RANGES[cat][b.dataset.k].choices;
      let pool = (r.choices && r.choices.length ? r.choices : all).slice();
      if (pool.includes(b.dataset.ch)) { if (pool.length > 1) pool = pool.filter(x => x !== b.dataset.ch); } else pool.push(b.dataset.ch);
      setR(cat, b.dataset.k, { choices: all.filter(x => pool.includes(x)) }); render(); return;
    }
    if (act === 'all') roll(CATS.map(c => c.id), newSeed());
    else if (act === 'roll') roll([cat]);
    else if (act === 'lock') { RS.lock = RS.lock.includes(cat) ? RS.lock.filter(c => c !== cat) : [...RS.lock, cat]; onRanges(); render(); }
    else if (act === 'open') { if (open.has(cat)) open.delete(cat); else open.add(cat); render(); }
    else if (act === 'defaults') { delete RS.ranges[cat]; RS.seeds[cat] = 0; onApply([cat]); render(); }
    else if (act === 'seed') {
      const v = Math.floor(+host.querySelector('#rseedIn').value);
      if (v >= 1) roll(CATS.map(c => c.id), v);
    }
  });
  host.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'rseedIn') { e.preventDefault(); host.querySelector('[data-act="seed"]').click(); } });
  host.addEventListener('change', e => {
    const t = e.target; if (!t.dataset || !t.dataset.f) return;
    const { cat, k, f } = t.dataset, base = RANGES[cat][k];
    if (f === 'on') setR(cat, k, { on: t.checked });
    else {
      let v = +t.value; if (!Number.isFinite(v)) { render(); return; }
      if (base.int) v = Math.round(v);
      const r = rng(cat, k), o = f === 'lo' ? { lo: v, hi: Math.max(v, r.hi) } : { hi: v, lo: Math.min(v, r.lo) };
      setR(cat, k, o);
    }
    render();
  });
  render();
  return { render, roll };
}
