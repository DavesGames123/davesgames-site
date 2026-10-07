// ============================================================================
//  PARTICLE COLLIDER  ·  main.js — choose, collide, look, select
// ----------------------------------------------------------------------------
//  The page is the event: two chosen particles collide at a chosen energy,
//  the transport engine (worker.js) moves every product through the
//  detector, and the page shows it in a T: the 3D view of the collision
//  on top (display.js on stage.js, tracks and deposits only), the
//  transverse and longitudinal diagrams (diagram.js) below, the tower map
//  in the strip.
//
//  EVENTS (grep -n 'function runEvent')
//    generate(kind, { beam, sqrtS, ... }) on the main thread -> one share
//    of the primaries per worker -> mergeResults -> reconstruct ->
//    buildObjects (picking.js) -> every view.
//  TIME  S.t is the event time in ns, -4 (the beams 1.2 m apart) to the
//    last segment; it moves at S.speed ns per second (slow motion).
//  FOCUS (grep -n 'function setFocus')
//    hover or selection: one object, linked in every view; its cascade
//    (picking.js cascade) brightens, the rest dims: in the diagrams, the
//    tower map, and in 3D (display.js setCascade with picking.js
//    segFlags, and the halo and ring of overlay3d.js). Click (or Enter)
//    opens the detail panel (physinfo.js). Tab or the arrow keys move
//    through the objects.
//  3D (grep -n 'async function ensure3D')  labels as the products enter
//    (overlay3d.js, the label setting of the diagrams); tone per event
//    from the deposited energy (grep -n 'function toneFor').
//  STRIP  a slim bar; #stripMore opens the drawer (grep -n 'function setStrip').
//  PHONE  the 3D view on top; a swipe on the lower view moves through
//    r-phi, r-z and Towers (grep -n 'phoneList').
//  PREFERENCES  localStorage 'pc-prefs': layout, labels, outline,
//    hardware (off by default), per viewer. Prefs before v 2 lose their
//    layout, so the T (layout 't') is the default for every viewer.
//  SELECTION (grep -n 'selectstart')  no text selection outside the
//    prose (.about p, .dt-text); a canvas pointerdown takes no default.
//
//  GREP MAP
//    function runEvent / showEvent / fillCard / setFocus / openDetail
//    function setLayout / ensure3D / frame
//    function toneFor / setStrip / phoneList
//    window.snSaver .............. the screensaver tour (3D, T, wing, split)
// ============================================================================
import { generate, SCENARIOS, BEAMS, available } from './generators.js';
import { createEngine, mergeResults, splitPrims, makeRng, pack } from './transport.js';
import { reconstruct } from './reco.js';
import { buildObjects, cascade, segFlags } from './picking.js';
import { detail } from './physinfo.js';
import { createDiagram, createLego, LABEL_OF } from './diagram.js';
import { PART, CLASS_COLOR, CLASS_LABEL } from './particles.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GeV = v => (v / 1000).toFixed(Math.abs(v) < 10000 ? 2 : 1);

// ── preferences (per viewer) ────────────────────────────────────────────────
const PREF = Object.assign({ v: 2, layout: 't', labels: 'hard', outline: true, hardware: false, phoneView: 'rphi' }, (() => { try { const p = JSON.parse(localStorage.getItem('pc-prefs') || '{}'); if (p.v !== 2) { delete p.layout; delete p.phoneView; p.v = 2; } return p; } catch (e) { return {}; } })());
const savePref = () => { try { localStorage.setItem('pc-prefs', JSON.stringify(PREF)); } catch (e) { /* private mode */ } };

const S = { beam: 'pp', sqrtS: 13.6e6, scen: 'zmm', t: -4, playing: true, speed: 3, auto: false, busy: false, ev: null, seed: 1, pileup: 0,
  gun: { particle: 'e-', energy: 50000, eta: 0.3, phi: 0.6, count: 1 }, hover: null, sel: null, kbd: -1 };
let saverOn = false;

// ── views ───────────────────────────────────────────────────────────────────
const vR = createDiagram($('hRphi'), 'rphi'), vZ = createDiagram($('hRz'), 'rz'), lego = createLego($('lego'));
const VIEWS = [vR, vZ];
for (const v of VIEWS) { v.labels = PREF.labels; v.outline = PREF.outline; v.hardware = PREF.hardware; }
let v3 = null;   // the optional 3D view, made on first use

// ── workers ─────────────────────────────────────────────────────────────────
const NW = Math.max(2, Math.min(COARSE ? 3 : 8, (navigator.hardwareConcurrency || 4) - 1));
const ENG = { maxSeg: Math.round((COARSE ? 160000 : 420000) / NW), segShowerMinE: COARSE ? 12 : 6 };
let pool = null, local = null, jobN = 0;
const pending = new Map();
try {
  pool = Array.from({ length: NW }, () => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ev => { const p = pending.get(ev.data.id); if (p) { pending.delete(ev.data.id); ev.data.error ? p.rej(new Error(ev.data.error)) : p.res(ev.data.R); } };
    w.onerror = e => { for (const [, p] of pending) p.rej(e); pending.clear(); };
    return w;
  });
} catch (e) { pool = null; }
function transport(prims, seed) {
  const shares = splitPrims(prims, pool ? NW : 1);
  if (!pool) { local = local || createEngine(ENG); return Promise.resolve(mergeResults(shares.map((p, i) => pack(local.run(p, seed + i))))); }
  return Promise.all(shares.map((p, i) => new Promise((res, rej) => { const id = ++jobN; pending.set(id, { res, rej }); pool[i % NW].postMessage({ id, prims: p, seed: seed * 97 + i, opt: ENG }); })))
    .then(list => mergeResults(list))
    .catch(err => { console.warn('worker transport failed, running on the main thread', err); pool = null; return transport(prims, seed); });
}

// ── events ──────────────────────────────────────────────────────────────────
async function computeEvent(kind, seed, o = {}) {
  const beam = o.beam || S.beam, sqrtS = o.sqrtS || S.sqrtS;
  const g = generate(kind, { ...S.gun, ...o, beam, sqrtS, pileup: o.pileup ?? (BEAMS[beam].kind === 'hadron' ? (kind === 'mb' ? Math.max(1, S.pileup || 30) : S.pileup) : 0) }, makeRng(seed));
  const t0 = performance.now(), R = await transport(g.prims, seed), O = reconstruct(R, g.info);
  const ev = { kind, g, R, O, info: g.info, ms: performance.now() - t0, seed };
  ev.objs = buildObjects(R, O, g.info);
  return ev;
}
let evToken = 0;
async function runEvent(kind = S.scen, o = {}) {
  const tok = ++evToken;
  S.busy = true; $('busy').hidden = false;
  try {
    const seed = o.seed || (S.seed = (S.seed * 1103515245 + 12345) >>> 0 || 7);
    const E = o.ready || await computeEvent(kind, seed, o);
    if (tok === evToken) showEvent(E);
    return E;
  } finally { if (tok === evToken) { S.busy = false; $('busy').hidden = true; } }
}
function showEvent(E) {
  S.ev = E; S.hover = null; S.sel = null; S.kbd = -1;
  for (const v of VIEWS) { v.setEvent(E); v.setFocus(null, null); }
  lego.ev = E; lego.focusSet = null;
  if (v3) v3.show(E);
  let tEnd = 4; for (let i = 0; i < E.R.nSeg; i++) { const t1 = E.R.seg[i * 9 + 7]; if (t1 < 40 && t1 > tEnd) tEnd = t1; }
  E.tEnd = Math.min(32, Math.max(14, tEnd + 1));
  $('tSlide').max = Math.ceil(E.tEnd);
  S.t = -4; setPlay(true);
  closeDetail();
  if (!saverOn) fillCard();
}

// ── focus: hover and selection, linked across the views ─────────────────────
const cascadeOf = o => cascade(S.ev, o);
let focusKey = '';
function setFocus() {
  const o = S.hover || S.sel, key = o ? o.key : '';
  if (key === focusKey) return;
  focusKey = key;
  const set = o ? cascadeOf(o) : null;
  for (const v of VIEWS) v.setFocus(o, set);
  lego.focusSet = set;
  if (v3) v3.focus(o, set);
  document.querySelectorAll('#card tr[data-k]').forEach(r => r.classList.toggle('sel', !!S.sel && r.dataset.k === S.sel.key));
}
function select(o, open = true) {
  S.sel = o; setFocus();
  if (o && open) openDetail(o); else if (!o) closeDetail();
}
const tip = $('tip');
function showTip(o, x, y) {
  if (!o) { tip.hidden = true; return; }
  const P = PART[o.name], name = o.kind === 'track' ? `${LABEL_OF(o.name)}` : o.kind === 'jet' ? 'jet' : o.kind === 'tower' ? 'calorimeter tower' : o.kind === 'met' ? 'missing E<sub>T</sub>' : o.kind === 'muhit' ? 'muon-chamber hit' : o.kind === 'vertex' ? o.name : 'the collision';
  const q = P && o.kind === 'track' ? ` · charge ${P.q > 0 ? '+1' : P.q < 0 ? '−1' : '0'}` : '';
  const kin = o.pT != null ? `<br><i>p<sub>T</sub></i> ${GeV(o.pT)} GeV · <i>η</i> ${(o.eta ?? 0).toFixed(2)} · <i>φ</i> ${(o.phi ?? 0).toFixed(2)}${o.E ? ` · <i>E</i> ${GeV(o.E)} GeV` : ''}` : '';
  tip.innerHTML = `<b>${name}</b>${q}${kin}<br><i>click for a closer look</i>`;
  tip.hidden = false;
  const sr = $('stage').getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(sr.width - w - 6, x - sr.left + 14)}px`; tip.style.top = `${Math.max(4, Math.min(sr.height - h - 6, y - sr.top + 14))}px`;
}
// pointer on a diagram
function bindView(v, host) {
  const pick = e => { const r = host.getBoundingClientRect(); return v.hit(e.clientX - r.left, e.clientY - r.top, S.t, e.pointerType === 'touch' ? 16 : 7); };
  host.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; const o = pick(e); S.hover = o; setFocus(); showTip(o, e.clientX, e.clientY); });
  host.addEventListener('pointerleave', () => { S.hover = null; setFocus(); showTip(null); });
  host.addEventListener('click', e => { const o = pick(e); select(o); if (e.pointerType === 'touch' || !o) showTip(null); });
  // wheel zooms about the pointer; drag pans
  host.addEventListener('wheel', e => {
    e.preventDefault(); const r = host.getBoundingClientRect(), s0 = v.scale(), k = Math.exp(-e.deltaY * 0.0015);
    const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
    v.zoom = Math.max(0.9, Math.min(60, v.zoom * k)); const s1 = v.scale();
    v.cx += mx / s0 - mx / s1; v.cy -= my / s0 - my / s1; if (v.zoom <= v.home) { v.cx *= 0.5; v.cy *= 0.5; }
  }, { passive: false });
  let drag = null;
  host.addEventListener('pointerdown', e => { if (v.zoom > v.home) drag = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy }; });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('pointermove', e => { if (!drag) return; const s = v.scale(); v.cx = drag.cx - (e.clientX - drag.x) / s; v.cy = drag.cy + (e.clientY - drag.y) / s; });
  host.addEventListener('dblclick', () => { v.zoom = v.home; v.cx = 0; v.cy = 0; });
}
bindView(vR, $('hRphi')); bindView(vZ, $('hRz'));
$('lego').addEventListener('pointermove', e => { if (!S.ev) return; const r = $('lego').getBoundingClientRect(), o = lego.hit(e.clientX - r.left, e.clientY - r.top); S.hover = o; setFocus(); showTip(o, e.clientX, e.clientY); });
$('lego').addEventListener('pointerleave', () => { S.hover = null; setFocus(); showTip(null); });
$('lego').addEventListener('click', e => { const r = $('lego').getBoundingClientRect(); select(lego.hit(e.clientX - r.left, e.clientY - r.top)); });
// keyboard: the objects in order (hard first, then by pT)
const order = () => S.ev ? S.ev.objs.objs.filter(o => o.t0 <= S.t && o.kind !== 'muhit' && o.kind !== 'vertex').sort((a, b) => (b.hard - a.hard) || (b.pT || 0) - (a.pT || 0)) : [];
$('views').addEventListener('keydown', e => {
  const L = order(); if (!L.length) return;
  if (e.key === 'Tab' || e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault(); const back = e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    S.kbd = (S.kbd + (back ? L.length - 1 : 1)) % L.length; S.sel = L[S.kbd]; setFocus(); openDetail(S.sel);
  }
  if (e.key === 'Enter' && S.sel) openDetail(S.sel);
});
window.addEventListener('keydown', e => { if (e.key === 'Escape') { select(null); showTip(null); } });

// ── the detail panel ────────────────────────────────────────────────────────
function openDetail(o) {
  if (!o || !S.ev || saverOn) return;
  const d = detail(o, S.ev), col = CLASS_COLOR[o.cls] || (o.kind === 'jet' ? '#ffd45c' : '#9fd0ff');
  const tbl = rows => `<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  let h = `<div class="dt"><div class="dt-kind">${esc(d.sub || o.kind)}</div><div class="dt-title"><i style="color:${col};background:${col}"></i>${esc(d.title)}</div><p class="dt-text">${esc(d.text)}</p>`;
  if (d.props.length) h += `<div class="sec-label">What it is</div>${tbl(d.props)}`;
  if (d.meas.length) h += `<div class="sec-label">Measured in this event</div>${tbl(d.meas)}`;
  if (d.deposits && d.deposits.length) { const mx = d.deposits[0][1]; h += `<div class="sec-label">Energy deposited, by subsystem</div>${d.deposits.map(([k, v]) => `<div class="depbar"><span>${esc(k)}</span><i style="width:${Math.max(2, 100 * v / mx)}%"></i><em>${v > 1000 ? GeV(v) + ' GeV' : v.toFixed(1) + ' MeV'}</em></div>`).join('')}`; }
  if (d.mass) {
    const m = d.mass;
    h += `<div class="sec-label">Invariant mass of the ${esc(m.name)}</div><table class="masscalc">${m.rows.map(r => r.missing ? `<tr><td>${esc(LABEL_OF(r.name))}</td><td>not reconstructed</td></tr>` : `<tr><td>${esc(LABEL_OF(r.name))}</td><td>(${r.v.map(x => (x / 1000).toFixed(2)).join(', ')}) GeV</td></tr>`).join('')}
      <tr><td>sum (E, px, py, pz)</td><td>(${m.sum.map(x => (x / 1000).toFixed(2)).join(', ')})</td></tr><tr><td>m = √(E² − p²)</td><td><b>${GeV(m.m)} GeV</b> (true ${m.truth ? GeV(m.truth) : '—'})</td></tr></table>`;
  }
  h += `<div class="sec-label">Where it comes from</div><div class="chain">${d.lineage.map((x, i) => `<button type="button" ${x.key && x.key !== o.key ? `data-k="${x.key}"` : 'disabled'}><span class="lv">${'›'.repeat(Math.min(i, 6)) || '●'}</span>${esc(x.label)}</button>`).join('')}</div>`;
  if (d.parts.length) h += `<div class="sec-label">${o.kind === 'jet' ? 'Constituents' : o.kind === 'collision' ? 'The hard process' : 'Related'}</div><div class="parts">${d.parts.map(p => `<button type="button" ${p.key ? `data-k="${p.key}"` : 'disabled'}>${esc(p.label)}${p.value ? `<em>${esc(p.value)}</em>` : ''}</button>`).join('')}</div>`;
  h += '</div>';
  $('detailBody').innerHTML = h;
  $('detailBody').querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => { const q = S.ev.objs.byKey.get(b.dataset.k); if (q) select(q); }));
  $('detail').hidden = false; document.body.classList.add('detail-open');
  if (PHONE_Q.matches) setOpen(false);
}
function closeDetail() { $('detail').hidden = true; document.body.classList.remove('detail-open'); }
$('detailClose').addEventListener('click', () => select(null));

// ── the event card, trigger, energies ───────────────────────────────────────
function fillCard() {
  const E = S.ev; if (!E) return;
  const { info, O, R } = E, tr = info.truth || {}, B = BEAMS[info.beam];
  const m = [];
  if (tr.mass && E.kind !== 'jj') m.push(`true mass <b>${GeV(tr.mass)} GeV</b>`);
  for (const [k, l] of [['mumu', 'μμ'], ['ee', 'ee'], ['gg', 'γγ'], ['l4', '4ℓ']]) if (O.masses[k]) m.push(`m(${l}) <b>${GeV(O.masses[k])}</b>`);
  if (O.masses.jj && (E.kind === 'jj' || E.kind === 'tt')) m.push(`m(jj) <b>${GeV(O.masses.jj)}</b>`);
  if (tr.channel) m.push(esc(tr.channel)); if (tr.recoil) m.push(`recoil ${esc(tr.recoil)}`); if (tr.isr) m.push(`ISR γ ${GeV(tr.isr)} GeV`);
  const tag = (B.E.find(e => Math.abs(e[0] * 1000 - info.sqrtS) < 1) || [0, '', ''])[2];
  const rows = [];
  const sw = c => `<i class="sw" style="color:${c};background:${c}"></i>`;
  for (const o of E.objs.objs.filter(o => (o.kind === 'track' && o.hard && o.name !== 'nu') || o.kind === 'jet' || o.kind === 'met').sort((a, b) => b.pT - a.pT).slice(0, 8))
    rows.push(`<tr data-k="${o.key}"><td>${sw(CLASS_COLOR[o.cls] || '#ffd45c')}${o.kind === 'jet' ? 'jet' : o.kind === 'met' ? 'MET' : esc(LABEL_OF(o.name))}</td><td>${GeV(o.pT)}</td><td>${(o.eta ?? 0).toFixed(2)}</td><td>${(o.phi ?? 0).toFixed(2)}</td></tr>`);
  $('card').innerHTML = `<div class="kind">${esc(info.beamLabel || 'p + p')} · √s = ${(info.sqrtS / 1e6).toPrecision(4)} TeV${tag ? ` · ${tag === 'hyp' ? 'hypothetical' : 'design study'}` : ''} · ${info.pileup ? `${info.pileup} pile-up` : 'no pile-up'}</div>
    <h1>${esc(info.title)}</h1><div class="mass">${m.join(' · ') || esc(info.process)}</div>
    <table><tr><td></td><td>p<sub>T</sub> GeV</td><td>η</td><td>φ</td></tr>${rows.join('')}</table>`;
  $('card').querySelectorAll('tr[data-k]').forEach(r => r.addEventListener('click', () => select(E.objs.byKey.get(r.dataset.k))));
  $('trig').innerHTML = O.trigger.bits.map(([n, on]) => `<span class="${on ? 'on' : ''}">${esc(n)}</span>`).join('') + `<span class="${O.trigger.accept ? 'acc' : 'rej'}">${O.trigger.accept ? 'L1 ACCEPT' : 'L1 reject'}</span>`;
  const L = R.L, sub = [['Tracker', O.sub.tracker], ['ECAL', O.sub.ecal], ['HCAL', O.sub.hcal], ['Coil', O.sub.coil], ['Yoke', O.sub.yoke], ['Escaped', L.esc], ['Invisible', L.inv]];
  const mx = Math.max(...sub.map(s => s[1]));
  $('subs').innerHTML = sub.map(([n, v]) => `<div class="s"><span>${n}</span><i style="width:${Math.max(0.3, 100 * v / mx).toFixed(1)}%"></i><em>${v > 1000 ? GeV(v) + ' GeV' : v.toFixed(1) + ' MeV'}</em></div>`).join('');
}

// ── the chooser: beams, energy, process ─────────────────────────────────────
$('beam').innerHTML = Object.entries(BEAMS).map(([k, b]) => `<option value="${k}">${esc(b.label)}</option>`).join('');
function fillEnergy() {
  const B = BEAMS[S.beam];
  $('energy').innerHTML = B.E.map(([e, n, tag], i) => `<option value="${i}">${e >= 1000 ? (e / 1000).toPrecision(4).replace(/\.?0+$/, '') + ' TeV' : e + ' GeV'} · ${esc(n)}${tag === 'hyp' ? ' (hypothetical)' : tag === 'design' ? ' (design)' : ''}</option>`).join('');
  setEnergy(0);
}
function setEnergy(i) {
  const e = BEAMS[S.beam].E[i]; S.sqrtS = e[0] * 1000; $('energy').value = String(i);
  $('energyNote').textContent = e[2] === 'hyp' ? 'Hypothetical: no machine is planned at this energy. The generator scales the same physics up.' : e[2] === 'design' ? 'A design study, not a running machine.' : '';
  fillScen();
}
function fillScen() {
  const rts = S.sqrtS / 1000;
  $('scenarios').innerHTML = Object.entries(SCENARIOS).map(([k, s]) => { const why = available(S.beam, k, rts); return `<button class="card${k === S.scen ? ' on' : ''}" type="button" data-k="${k}" ${why ? `disabled title="${esc(why)}"` : ''}><b>${esc(s.short)}</b><span>${esc(why || s.process.replace(/^pp → /, ''))}</span></button>`; }).join('');
  $('scenarios').querySelectorAll('.card:not([disabled])').forEach(b => b.addEventListener('click', () => { pickScen(b.dataset.k); runEvent(b.dataset.k); if (PHONE_Q.matches) setOpen(false); }));
  if (available(S.beam, S.scen, rts)) { const ok = Object.keys(SCENARIOS).find(k => !available(S.beam, k, rts) && k !== 'gun'); if (ok) pickScen(ok); }
  $('puRow').hidden = BEAMS[S.beam].kind !== 'hadron';
}
function pickScen(k) { S.scen = k; document.querySelectorAll('#scenarios .card').forEach(b => b.classList.toggle('on', b.dataset.k === k)); $('gunBox').hidden = k !== 'gun'; }
$('beam').addEventListener('change', e => { S.beam = e.target.value; fillEnergy(); runEvent(S.scen); });
$('energy').addEventListener('change', e => { setEnergy(+e.target.value); runEvent(S.scen); });
const GUN = ['e-', 'gamma', 'mu-', 'pi+', 'pi-', 'K+', 'p', 'n', 'K0S', 'K0L'];
$('gunP').innerHTML = GUN.map(k => `<option value="${k}">${esc(PART[k].label)} · ${k}</option>`).join('');
$('gunP').addEventListener('change', e => { S.gun.particle = e.target.value; });
const setE = v => { S.gun.energy = Math.round(10 ** v * 1000); $('gunEV').textContent = `${(S.gun.energy / 1000).toPrecision(3)} GeV`; };
$('gunE').addEventListener('input', e => setE(+e.target.value)); setE(+$('gunE').value);
const bindG = (id, key) => { const set = v => { S.gun[key] = v; $(id + 'V').textContent = v.toFixed(2); }; $(id).addEventListener('input', e => set(+e.target.value)); set(+$(id).value); };
bindG('gunEta', 'eta'); bindG('gunPhi', 'phi');
const setPU = v => { S.pileup = v; $('pu').value = v; $('puV').textContent = String(v); };
$('pu').addEventListener('input', e => setPU(+e.target.value)); setPU(0);
$('fire').addEventListener('click', () => runEvent(S.scen));
$('auto').addEventListener('click', () => { S.auto = !S.auto; $('auto').classList.toggle('on', S.auto); });
const setSpeed = v => { S.speed = v; $('speedV').textContent = `${v.toFixed(1)} ns/s`; };
$('speed').addEventListener('input', e => setSpeed(+e.target.value)); setSpeed(+$('speed').value);
function setPlay(on) { S.playing = on; $('tPlay').textContent = on ? '❚❚' : '▶'; $('tPlay').setAttribute('aria-label', on ? 'Pause' : 'Play'); }
$('tPlay').addEventListener('click', () => { if (!S.playing && S.ev && S.t >= S.ev.tEnd) S.t = -4; setPlay(!S.playing); });
$('tSlide').addEventListener('input', e => { setPlay(false); S.t = +e.target.value; });

// ── views: layout, labels, outline, hardware ────────────────────────────────
function setLayout(l) {
  PREF.layout = l; savePref();
  const views = $('views'); views.className = l === '3d' ? 'd3' : l;
  document.querySelectorAll('#layouts button').forEach(b => b.classList.toggle('on', b.dataset.l === l));
  if (l === '3d' || l === 't') ensure3D();
  placeLego();
}
// the split layout on a wide screen: the tower map goes small, into the strip
function placeLego() {
  const sec = document.querySelector('.view[data-v="lego"]'), inStrip = PREF.layout !== 'lego' && !PHONE_Q.matches;
  const want = inStrip ? $('legoSlot') : $('views');
  if (sec.parentElement !== want) { if (inStrip) want.appendChild(sec); else $('views').insertBefore(sec, $('views').querySelector('.view[data-v="3d"]')); }
  $('strip').classList.toggle('withlego', inStrip);
}
document.querySelectorAll('#layouts button').forEach(b => b.addEventListener('click', () => setLayout(b.dataset.l)));
function setLabels(m) { PREF.labels = m; savePref(); for (const v of VIEWS) v.labels = m; if (v3) v3.labels = m; document.querySelectorAll('#labelMode button').forEach(b => b.classList.toggle('on', b.dataset.m === m)); }
document.querySelectorAll('#labelMode button').forEach(b => b.addEventListener('click', () => setLabels(b.dataset.m)));
function setOutline(on) { PREF.outline = on; savePref(); for (const v of VIEWS) v.outline = on; $('tOutline').classList.toggle('on', on); }
function setHardware(on) { PREF.hardware = on; savePref(); for (const v of VIEWS) v.hardware = on; $('tHardware').classList.toggle('on', on); if (v3) v3.hardware(on); }
$('tOutline').addEventListener('click', () => setOutline(!PREF.outline));
$('tHardware').addEventListener('click', () => setHardware(!PREF.hardware));
// phone: one view at a time
const phoneList = () => PREF.layout === 't' ? ['rphi', 'rz', 'lego'] : ['rphi', 'rz', 'lego', '3d'];
function setPhoneView(v, dir = 0) {
  if (PREF.layout === 't' && v === '3d') v = 'rphi';
  PREF.phoneView = v; savePref();
  document.querySelectorAll('#views .view').forEach(s => { s.classList.toggle('ph', s.dataset.v === v); s.classList.remove('from-l', 'from-r'); });
  if (dir) { const s = document.querySelector(`#views .view[data-v="${v}"]`); void s.offsetWidth; s.classList.add(dir > 0 ? 'from-r' : 'from-l'); }
  document.querySelectorAll('#vtabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('dockView').querySelector('span').textContent = { rphi: 'r-φ', rz: 'r-z', lego: 'Towers', '3d': '3D' }[v];
  if (v === '3d') ensure3D();
}
document.querySelectorAll('#vtabs button').forEach(b => b.addEventListener('click', () => setPhoneView(b.dataset.v)));
$('dockView').addEventListener('click', () => { const L = phoneList(); setPhoneView(L[(L.indexOf(PREF.phoneView) + 1) % L.length], 1); });
// phone: a horizontal swipe on the lower view moves to the next or the last
// view (r-phi, r-z, Towers). A diagram zoomed past its home pans instead.
{
  let sw = null;
  $('views').addEventListener('touchstart', e => {
    const sec = e.target.closest && e.target.closest('.view'); sw = null;
    if (!PHONE_Q.matches || e.touches.length !== 1 || !sec || sec.dataset.v === '3d') return;
    const v = sec.dataset.v === 'rphi' ? vR : sec.dataset.v === 'rz' ? vZ : null;
    if (v && v.zoom > v.home + 1e-6) return;
    sw = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  $('views').addEventListener('touchend', e => {
    if (!sw) return; const q = e.changedTouches[0], dx = q.clientX - sw.x, dy = q.clientY - sw.y; sw = null;
    if (Math.abs(dx) < 48 || Math.abs(dx) < 1.6 * Math.abs(dy)) return;
    const L = phoneList(), i = Math.max(0, L.indexOf(PREF.phoneView)), d = dx < 0 ? 1 : -1;
    setPhoneView(L[(i + d + L.length) % L.length], d);
  }, { passive: true });
}
$('stripMore').addEventListener('click', () => setStrip(!$('strip').classList.contains('open')));
function setStrip(open) { $('strip').classList.toggle('open', open); $('stripMore').textContent = open ? 'Less ▾' : 'Event ▴'; $('stripMore').setAttribute('aria-expanded', String(open)); }
$('dockCard').addEventListener('click', () => { document.body.classList.toggle('card-open'); setStrip(document.body.classList.contains('card-open')); $('dockCard').classList.toggle('on', document.body.classList.contains('card-open')); });
$('dockGo').addEventListener('click', () => runEvent(S.scen));

// ── the optional 3D view: tracks and deposits only (no housing) ─────────────
async function ensure3D() {
  if (v3) return v3;
  const [THREE, { createStage, gradientBackground }, { createDisplay }, { buildDetector }, { hitTest }, { createOverlay3D }] = await Promise.all([import('three'), import('./stage.js'), import('./display.js'), import('./geometry.js'), import('./picking.js'), import('./overlay3d.js')]);
  const canvas = $('view3d'), ov = createOverlay3D($('over3d'));
  const stage = createStage({ canvas, occluders: [], band: () => band3D, coarse: COARSE, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, onNoGL: () => {} });
  const scene = new THREE.Scene(); scene.background = gradientBackground('#05070d', '#04060b', '#020306');
  const disp = createDisplay(THREE), evScene = new THREE.Scene(); evScene.add(disp.group);
  // detector hardware: thin outlines only (no shells), off by default
  const hw = new THREE.Group(), lm = new THREE.LineBasicMaterial({ color: 0x8fa6d8, transparent: true, opacity: 0.10 });
  for (const v of buildDetector().V) {
    if (!['ecal', 'hcal', 'sol', 'yoke', 'mu'].includes(v.sys) || v.z1 - v.z0 < 2000) continue;
    for (const r of [v.rmax]) for (const z of [v.z0, v.z1]) { if (r < 1) continue; const pts = []; for (let i = 0; i <= 96; i++) pts.push(new THREE.Vector3(r * Math.cos(i / 96 * 6.2832), r * Math.sin(i / 96 * 6.2832), z)); hw.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm)); }
  }
  scene.add(hw);
  const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -9000), new THREE.Vector3(0, 0, 9000)]), new THREE.LineBasicMaterial({ color: 0x5f8dff, transparent: true, opacity: 0.35 }));
  scene.add(axis);
  stage.use(scene, { min: 600, max: 60000, near: 0.003, bloom: [0.7, 0.5, 0.3] }); stage.setOverlay(evScene);
  stage.place({ az: 40, el: 22, r: 11000, target: new THREE.Vector3() });
  const PV = new THREE.Vector3();
  let cw = 1, ch = 1;
  const project = (x, y, z) => { PV.set(x, y, z).project(stage.camera); if (PV.z > 1 || PV.z < -1) return null; return [(PV.x + 1) / 2 * cw, (1 - PV.y) / 2 * ch]; };
  let flags = null;
  const api = {
    labels: PREF.labels, focusObj: null, focusSet: null, stage, ov, canvas, overlay: $('over3d'),
    show(E) {
      const r = disp.show(E.R, E.O, E.info, { cones: COARSE ? 40 : 120 });
      flags = null; api.focusObj = null; api.focusSet = null;
      toneFor(r.energy, stage, disp);
    },
    focus(o, set) {
      api.focusObj = o; api.focusSet = set;
      if (!o || !set || !S.ev) { disp.setCascade(null); return; }
      flags = segFlags(S.ev.R, set, flags); disp.setCascade(flags);
    },
    hardware(on) { hw.visible = on; },
    get hwOn() { return hw.visible; },
    // bounds and reserved: the label area (the saver gives the 3D part of the T)
    frame(dt, t, o = {}) {
      if (!canvas.clientWidth) return;
      cw = canvas.clientWidth; ch = canvas.clientHeight;
      disp.setTime(t); disp.frame(stage.renderer); stage.frame(dt);
      ov.draw(S.ev, t, project, { focus: api.focusObj, focusSet: api.focusSet, labels: o.labels || api.labels, bounds: o.bounds, reserved: o.reserved || [{ x: 0, y: 0, w: 330, h: 28 }], small: cw < 520 });
    },
    hit(x, y, t) {
      if (!S.ev) return null;
      const h = hitTest(S.ev.objs.objs, project, x, y, 8, t, null);
      if (h) return h.obj;
      const k = ov.hitLabel(x, y); return k ? S.ev.objs.byKey.get(k) : null;
    },
  };
  hw.visible = PREF.hardware;
  canvas.addEventListener('pointermove', e => { if (e.buttons) return; stage.idle = Math.min(stage.idle, 1.5); const r = canvas.getBoundingClientRect(), o = api.hit(e.clientX - r.left, e.clientY - r.top, S.t); S.hover = o; setFocus(); showTip(o, e.clientX, e.clientY); });
  canvas.addEventListener('pointerleave', () => { S.hover = null; setFocus(); showTip(null); });
  canvas.addEventListener('click', e => { const r = canvas.getBoundingClientRect(); const o = api.hit(e.clientX - r.left, e.clientY - r.top, S.t); if (o) select(o); });
  v3 = api;
  if (S.ev) api.show(S.ev);
  return api;
}

// Tone for one event in the 3D view. The deposited energy sets how busy the
// event is (0: a lepton pair, 1: a dijet, ttbar or pile-up). A busy event
// gets a lower exposure, less bloom with a higher threshold, a lower clip
// knee and a lower cap per fragment, so jets and showers stay coloured.
function toneFor(eMeV, stage, disp) {
  const busy = Math.max(0, Math.min(1, Math.log10(Math.max(1, eMeV) / 40000) / 1.3));
  stage.setLook(1.0 - 0.18 * busy, 0.75 - 0.3 * busy, 0.3 + 0.25 * busy);
  stage.overlayK(1.25 - 0.5 * busy);
  disp.U.uCap.value = 2.2 - 1.2 * busy;
  return busy;
}
let band3D = null;   // the saver: { t, b } px the 3D subject keeps clear of

// ── legend ──────────────────────────────────────────────────────────────────
$('legend').innerHTML = ['mu', 'e', 'gamma', 'had', 'neu', 'shower'].map(k => `<span><i class="${k === 'neu' || k === 'gamma' ? 'dash' : ''}" style="color:${CLASS_COLOR[k]};background:${CLASS_COLOR[k]}"></i>${esc(CLASS_LABEL[k])}</span>`).join('') + `<span><i style="color:#ffd45c;background:#ffd45c"></i>jet</span><span><i style="color:${CLASS_COLOR.nu};background:${CLASS_COLOR.nu}"></i>missing E<sub>T</sub></span>`;

// ── no accidental text selection ────────────────────────────────────────────
// Only the prose takes a selection. A drag on a canvas or a grip takes no
// default action, and a selection that starts during a drag is cleared.
const PROSE = '.about p, .dt-text';
let dragging = false;
document.addEventListener('selectstart', e => { const t = e.target.nodeType === 1 ? e.target : e.target.parentElement; if (dragging || !t || !t.closest(PROSE)) e.preventDefault(); });
document.addEventListener('pointerdown', e => {
  const t = e.target;
  if (t.closest && t.closest('canvas, #sheetGrip, .host')) { e.preventDefault(); dragging = true; try { t.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } }
}, true);
const endDrag = () => { if (dragging) { dragging = false; const s = getSelection(); if (s && s.toString() && !(s.anchorNode && s.anchorNode.parentElement && s.anchorNode.parentElement.closest(PROSE))) s.removeAllRanges(); } };
window.addEventListener('pointerup', endDrag, true); window.addEventListener('pointercancel', endDrag, true);
document.addEventListener('dragstart', e => e.preventDefault());

// ── panel and sheet ─────────────────────────────────────────────────────────
const panel = $('panel');
function setOpen(open) {
  panel.classList.toggle('open', open); if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  panel.querySelectorAll('.grp').forEach(el => el.classList.toggle('on', true));
  document.querySelectorAll('#dock .tab').forEach(t => t.classList.toggle('on', open));
}
document.querySelectorAll('#dock .tab').forEach(t => t.addEventListener('click', () => setOpen(!panel.classList.contains('open'))));
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => { setOpen(!e.matches); placeLego(); });
{
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
  grip.addEventListener('pointerup', e => { if (gy === null) return; const dy = e.clientY - gy; gy = null; if (Math.abs(dy) < 8) panel.classList.toggle('full'); else if (dy < -40) panel.classList.add('full'); else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); } });
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), running = true, uiT = 0;
function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (S.ev && S.playing && !saverOn) {
    S.t += dt * S.speed;
    if (S.t > S.ev.tEnd) { S.t = S.ev.tEnd; if (S.auto && !S.busy) runEvent(S.scen); else setPlay(false); }
  }
  if (saverOn) { if (saverTick) saverTick(dt); return; }
  // the reserved corner: the time bar sits over the lower left of the views
  const vis = s => { const r = s.getBoundingClientRect(); return r.width > 0; };
  if (vis($('hRphi'))) vR.render(S.t);
  if (vis($('hRz'))) vZ.render(S.t);
  if (vis($('lego')) && (uiT += dt) > 0.05) { uiT = 0; lego.render(S.t); }
  if (v3 && vis($('view3d'))) v3.frame(dt, S.t);
  $('tSlide').value = S.t; $('tVal').textContent = `${S.t.toFixed(2)} ns`;
}
let saverTick = null;

// ── screensaver ──────────────────────────────────────────────────────────────
// Only collisions: a seeded shuffle of events (processes, beams and
// energies, the hypothetical ones named so). The main shots use the 3D
// view: the camera orbits the vertex while the products fly out with
// labels. Layouts of a shot (grep -n 'const LAYOUTS'):
//   't' ..... the T: the 3D view on top, the r-phi and r-z diagrams below
//             it, drawn in as the event plays (needs a tall clear band)
//   'wing' .. the T for a short band: the 3D view in the middle, a diagram
//             on each side
//   'd3' .... the 3D view alone, in the whole band
//   'split' . the two diagrams only (also the fallback without WebGL)
// The 3D camera moves (MOVES3): orbit, push in, from the side along the
// beams, down the beam axis, pull out. A cut (a short fade) every 5-12 s.
// The 3D WebGL canvas stays in the document but hidden; each frame it is
// drawn into the saver canvas in the same task as its render. No hardware.
const SAVER_EVENTS = [
  ['pp', 13.6e6, 'zmm'], ['pp', 13.6e6, 'zee'], ['pp', 13.6e6, 'hgg'], ['pp', 13.6e6, 'h4l'], ['pp', 13.6e6, 'tt'], ['pp', 13.6e6, 'jj'],
  ['pp', 13.6e6, 'mb'], ['pp', 1e8, 'jj'], ['pp', 1e8, 'tt'], ['pp', 1e8, 'hgg'], ['pp', 1e9, 'jj'], ['pp', 1e9, 'zmm'],
  ['ee', 250000, 'hgg'], ['ee', 91190, 'zmm'], ['ee', 3e6, 'jj'], ['mumu', 1e7, 'tt'], ['mumu', 1e8, 'jj'], ['PbPb', 5.36e6, 'mb'], ['ppbar', 1.96e6, 'tt'],
];
const LAYOUTS = ['t', 't', 'd3', 't', 'd3', 'split'];
const MOVES3 = ['orbit', 'push', 'beam', 'axis', 'pull'];
window.snSaver = {
  enter(o = {}) {
    saverOn = true;
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const label = typeof o.label === 'function' ? o.label : () => {};
    const st = document.createElement('style');
    // the 3D view stays laid out (full window) but hidden: the saver canvas draws it
    st.textContent = '.topbar,#panel,#detail,#dock,#strip,#vtabs,#clock,#tip,#busy,#nogl,#gear{display:none!important}#stage{inset:0!important}'
      + '#views{position:fixed!important;inset:0!important;display:block!important;visibility:hidden!important}#views .view{display:none!important}'
      + '#views .view[data-v="3d"]{display:block!important;position:absolute!important;inset:0!important;border:0!important;border-radius:0!important}#views .view header{display:none!important}';
    document.head.appendChild(st);
    const cv = document.createElement('canvas'); cv.id = 'saverCanvas';
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;background:#04060b;transition:opacity 0.35s ease;z-index:1';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    for (const v of VIEWS) { v.hardware = false; v.outline = true; v.labels = 'hard'; v.setFocus(null, null); }
    // source extracts for the plate
    const SRC = {}, grabs = [];
    const grab = (file, start, name) => grabs.push(fetch(file).then(r => r.text()).then(t => { const i = t.indexOf(start); if (i < 0) return; let k = t.indexOf('{', i), dp = 0, j = k; for (; j < t.length; j++) { if (t[j] === '{') dp++; else if (t[j] === '}' && --dp === 0) break; } SRC[name] = { lang: 'js', name: `${file} · ${name}`, text: t.slice(i, j + 1) }; }).catch(() => {}));
    grab('physics.js', 'export function bbHeavy', 'bbHeavy'); grab('physics.js', 'export function highland', 'highland'); grab('physics.js', 'export function sampleCompton', 'sampleCompton');
    grab('transport.js', 'const helix = (tr, s, h) =>', 'helix'); grab('reco.js', 'export function fitTrack', 'fitTrack');
    const code = n => SRC[n] || Object.values(SRC)[0];
    let bandFn = null, band = null;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => {});
    // the 3D view: made now, hardware off, no auto orbit (the shot moves the camera)
    let td = null;
    const ready3D = ensure3D().then(a => { td = a; a.hardware(false); a.stage.orbit = false; a.focus(null, null); }).catch(() => { td = null; });
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    // the first shot is a quick one; the heavy hypothetical events come later, computed during a shot
    let queue = [['pp', 13.6e6, ['zmm', 'hgg', 'h4l', 'zee'][Math.floor(rnd() * 4)]], ...shuffle(SAVER_EVENTS.slice())], next = null, nextSpec = null;
    const prepare = () => { if (!queue.length) queue = shuffle(SAVER_EVENTS.slice()); nextSpec = queue.shift(); const [beam, sqrtS, kind] = nextSpec; next = computeEvent(kind, (rnd() * 4e9) >>> 0, { beam, sqrtS, pileup: kind === 'mb' && beam === 'pp' ? 30 + Math.floor(rnd() * 20) : beam === 'pp' && rnd() < 0.3 ? 4 : 0 }); };
    prepare();
    const MOVES = ['push', 'pull', 'pan', 'hold', 'replay'];
    let shot = null, shotT = 0, shotDur = 8000, busy = false, layout = 't', move = 'push', move3 = 'orbit', cam = null, ev = null, n = 0, cutA = 1;
    const P = (sym, name, value) => ({ sym, name, value: String(value) });
    const start = async () => {
      if (busy) return; busy = true;
      try {
        if (shot) { cutA = 0; await new Promise(r => setTimeout(r, 360)); }
        await ready3D;
        const spec = nextSpec, E = await next; prepare();
        ev = E; S.ev = E; for (const v of VIEWS) v.setEvent(E);
        if (td) td.show(E);
        let tEnd = 4; for (let i = 0; i < E.R.nSeg; i++) { const t1 = E.R.seg[i * 9 + 7]; if (t1 < 40 && t1 > tEnd) tEnd = t1; }
        E.tEnd = Math.min(30, Math.max(14, tEnd + 1));
        shotDur = 1000 * Math.max(5.5, Math.min(12, (6 + 5 * calm) * (0.85 + 0.3 * rnd())));
        layout = td ? LAYOUTS[Math.floor(rnd() * LAYOUTS.length)] : 'split';
        if (shot && layout === shot.layout && layout !== 't') layout = 't';
        move = MOVES[Math.floor(rnd() * MOVES.length)]; if (move === shot?.move) move = MOVES[(MOVES.indexOf(move) + 1) % MOVES.length];
        move3 = MOVES3[Math.floor(rnd() * MOVES3.length)]; if (move3 === shot?.move3) move3 = MOVES3[(MOVES3.indexOf(move3) + 1) % MOVES3.length];
        const sg = rnd() < 0.5 ? -1 : 1;
        cam = {
          orbit: { az0: rnd() * 360, dAz: sg * (45 + 35 * rnd()), el0: 16 + 16 * rnd(), dEl: 0, r0: 13500, r1: 10500 },
          push: { az0: rnd() * 360, dAz: sg * 20, el0: 22, dEl: -8, r0: 16000, r1: 5600 },
          beam: { az0: 90 + 180 * (rnd() < 0.5) + 10 * sg, dAz: sg * 30, el0: 4, dEl: 16, r0: 14000, r1: 11500 },
          axis: { az0: 180 * (rnd() < 0.5) + 6 * sg, dAz: sg * 28, el0: 6, dEl: 12, r0: 12000, r1: 9500 },
          pull: { az0: rnd() * 360, dAz: sg * 35, el0: 26, dEl: -6, r0: 5200, r1: 15000 },
        }[move3];
        shot = { n: ++n, spec, move, move3, layout }; shotT = 0;
        const info = E.info, tr = info.truth || {}, O = E.O, B = BEAMS[info.beam], tag = (B.E.find(e => Math.abs(e[0] * 1000 - info.sqrtS) < 1) || [0, '', ''])[2];
        const params = [P('\\sqrt{s}', tag === 'hyp' ? 'hypothetical' : tag === 'design' ? 'design study' : info.beamLabel, `${(info.sqrtS / 1e6).toPrecision(3)} TeV`)];
        const MK = { zmm: ['m_{\\mu\\mu}', 'mumu'], zee: ['m_{ee}', 'ee'], hgg: ['m_{\\gamma\\gamma}', 'gg'], h4l: ['m_{4\\ell}', 'l4'], tt: ['m_{jj}', 'jj'], jj: ['m_{jj}', 'jj'] }[E.kind];
        if (tr.mass && !['mb', 'jj', 'tt'].includes(E.kind)) params.push(P('m', 'true mass', `${GeV(tr.mass)} GeV`));
        if (MK && O.masses[MK[1]]) params.push(P(MK[0], 'reconstructed', `${GeV(O.masses[MK[1]])} GeV`));
        const lead = [...O.muons, ...O.electrons, ...O.photons, ...O.jets].sort((a, b) => b.pT - a.pT)[0];
        if (lead) params.push(P('p_T', 'leading object', `${GeV(lead.pT)} GeV`));
        if (E.kind === 'mb') params.push(P('N', 'charged tracks', String(O.tracks.length)));
        label({ title: info.title, sub: `${info.process.startsWith(info.beamLabel) || info.process.startsWith('Pb') ? info.process : `${info.beamLabel} → ${info.process.replace(/^p ?p̄? → |^pp → /, '')}`}${tag === 'hyp' ? ' · hypothetical energy' : ''}`, params, code: code(['bbHeavy', 'helix', 'highland', 'sampleCompton', 'fitTrack'][n % 5]), anchor: () => anchor });
      } finally { busy = false; requestAnimationFrame(() => { cutA = 1; }); }
    };
    let anchor = null, alpha = 0, eff = 't';
    // the diagram rects of a layout inside [top, bot]: [mode, x, y, w, h]
    const rects2 = (lay, W, top, bot) => {
      const h = Math.max(80, bot - top), vert = W < (bot - top) * 1.4;
      if (lay === 'split' && vert) { const s = Math.min(W - 20, (h - 10) / 2); return [['rphi', (W - s) / 2, top + h / 2 - s - 5, s, s], ['rz', (W - s) / 2, top + h / 2 + 5, s, s]]; }
      if (lay === 'split') { const s = Math.min(h, (W - 52) / 2.7), x = (W - 2.7 * s - 12) / 2; return [['rphi', x, top + (h - s) / 2, s, s], ['rz', x + s + 12, top + (h - s) / 2, 1.7 * s, s]]; }
      if (lay === 't' && W < 700) { const s = Math.min(h, (W - 30) / 2); return [['rphi', W / 2 - s - 5, top + (h - s) / 2, s, s], ['rz', W / 2 + 5, top + (h - s) / 2, s, s]]; }
      const s = Math.min(h, (W - 52) / 2.7), x = (W - 2.7 * s - 12) / 2; return [['rphi', x, top + (h - s) / 2, s, s], ['rz', x + s + 12, top + (h - s) / 2, 1.7 * s, s]];
    };
    let bandT = 0, fN = 0, fT = 0, fps = 0;
    saverTick = dt => {
      fN++; fT += dt; if (fT >= 1) { fps = fN / fT; fN = 0; fT = 0; }
      if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { band = bandFn(innerHeight); } catch (e) { band = null; } }
      const d = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
      if (cv.width !== Math.round(W * d) || cv.height !== Math.round(H * d)) { cv.width = Math.round(W * d); cv.height = Math.round(H * d); }
      alpha += (cutA - alpha) * Math.min(1, dt * 7);
      g.setTransform(d, 0, 0, d, 0, 0); g.globalAlpha = 1; g.fillStyle = '#04060b'; g.fillRect(0, 0, W, H);
      if (!ev) return;
      shotT += dt * 1000;
      const u = Math.min(1, shotT / shotDur), e = u * u * (3 - 2 * u);
      // the event plays from the beams coming in to the end, in about 80 % of the shot
      const T = move === 'replay' && u > 0.55 ? -3 + (ev.tEnd + 3) * Math.min(1, (u - 0.55) / 0.42) : -3.5 + (ev.tEnd + 3.5) * Math.min(1, u / 0.8);
      S.t = T;
      const vtx = ev.info.vertex || [0, 0, 0];
      for (const v of VIEWS) {
        const z0 = v.mode === 'rz' ? 1.15 : 1.2;
        if (move === 'push') { v.zoom = z0 * (1 + 1.9 * e); v.cx = (v.mode === 'rz' ? vtx[2] : vtx[0]) * e; v.cy = 0; }
        else if (move === 'pull') { v.zoom = z0 * (2.6 - 1.6 * e); v.cx = (v.mode === 'rz' ? vtx[2] : 0) * (1 - e); v.cy = 0; }
        else if (move === 'pan') { v.zoom = z0 * 1.7; v.cx = v.mode === 'rz' ? -1800 + 3600 * e : -900 + 1800 * e; v.cy = v.mode === 'rz' ? 600 - 1200 * e : 300 - 600 * e; }
        else if (move === 'replay') { const k = u < 0.55 ? e : 1 - (u - 0.55) / 0.45 * 0.6; v.zoom = z0 * (1 + 1.4 * k); v.cx = 0; v.cy = 0; }
        else { v.zoom = z0 * (1.05 + 0.15 * e); v.cx = 0; v.cy = 0; }
      }
      const top = band ? band.t : H * 0.16, bot = band ? H - band.b : H * 0.84, h = Math.max(120, bot - top);
      // a T needs room: in a short band its diagrams go to the sides ('wing')
      eff = layout === 't' && h < 420 && W > h * 2.2 ? 'wing' : layout;
      g.globalAlpha = alpha;
      let A = null;   // the 3D part: [x, y, w, h]
      const diag = [];
      if (eff !== 'split' && td) {
        const split = eff === 't' ? top + h * 0.62 : bot;
        let side = 0;
        if (eff === 'wing') { const s = Math.min(h, W * 0.24); side = s + 24; diag.push(['rphi', 12, top + (h - s) / 2, s, s], ['rz', W - 12 - s, top + (h - s) / 2, s, s]); }
        else if (eff === 't') diag.push(...rects2('t', W, split + 8, bot));
        A = [side, top, W - 2 * side, split - top];
        band3D = { t: top, b: H - split, l: side, r: side };
        const c = cam, k = move3 === 'pull' ? e : u;
        const THREE = td.stage.THREE;
        td.stage.place({ az: c.az0 + c.dAz * u, el: c.el0 + c.dEl * e, r: c.r0 * Math.pow(c.r1 / c.r0, k) * (W < H ? 1.25 : 1), target: new THREE.Vector3(vtx[0], vtx[1], vtx[2]) });
        td.frame(dt, T, { labels: 'hard', bounds: { x: A[0] + 6, y: A[1] + 4, w: A[2] - 12, h: A[3] - 8 }, reserved: [] });
        g.drawImage(td.canvas, 0, 0, W, H); g.drawImage(td.overlay, 0, 0, W, H);
        // keep the 3D light inside its part: fade the rest to the field
        g.fillStyle = '#04060b';
        if (eff === 't') { const gr = g.createLinearGradient(0, split - 26, 0, split + 4); gr.addColorStop(0, 'rgba(4,6,11,0)'); gr.addColorStop(1, 'rgba(4,6,11,1)'); g.fillStyle = gr; g.fillRect(0, split - 26, W, 30); g.fillStyle = '#04060b'; g.fillRect(0, split + 4, W, H - split - 4); }
        g.fillRect(0, 0, W, Math.max(0, top - 2)); g.fillRect(0, bot + 2, W, H - bot - 2);
      } else diag.push(...rects2('split', W, top, bot));
      // the diagrams draw in: a short fade after the cut
      const din = Math.min(1, shotT / 900);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [m, x, y, w, hh] of diag) {
        const v = m === 'rphi' ? vR : vZ; v.reserved = [];
        g.globalAlpha = alpha * din;
        v.renderInto(g, x, y, w, hh, T);
        g.strokeStyle = 'rgba(127,214,255,0.12)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
        g.font = '600 10px "Space Grotesk", system-ui, sans-serif'; g.fillStyle = 'rgba(207,232,255,0.75)'; g.fillText(m === 'rphi' ? 'TRANSVERSE · r-φ' : 'LONGITUDINAL · r-z', x + 10, y + 16);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + hh);
      }
      if (A) { x0 = Math.min(x0, A[0]); y0 = Math.min(y0, A[1]); x1 = Math.max(x1, A[0] + A[2]); y1 = Math.max(y1, A[1] + A[3]); }
      g.globalAlpha = 1;
      anchor = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, lead: false };
      if (shotT >= shotDur && !busy) start();
    };
    window.snSaver.debug = () => ({ seed: o.seed, n, shot: shot && shot.spec.join(' '), layout, eff, move, move3, shotT: Math.round(shotT), shotDur: Math.round(shotDur), t: +S.t.toFixed(2), has3D: !!td,
      cam: td && (p => ({ az: Math.round(p.az), el: Math.round(p.el), r: Math.round(p.r) }))(td.stage.pose()), labels3D: td ? td.ov.placed.map(L => L.item.txt) : [],
      views: VIEWS.map(v => ({ mode: v.mode, zoom: +v.zoom.toFixed(3), cx: Math.round(v.cx), cy: Math.round(v.cy) })), rect: anchor && { x: Math.round(anchor.x), y: Math.round(anchor.y), w: Math.round(anchor.w), h: Math.round(anchor.h) }, band, H: innerHeight, W: innerWidth, hardware: VIEWS.some(v => v.hardware) || !!(td && td.hwOn), fps: +fps.toFixed(1) });
    Promise.race([Promise.all(grabs), new Promise(r => setTimeout(r, 1500))]).then(() => start());
    return { canvas: cv, warmupMs: 3000 };
  },
};
window.addEventListener('pagehide', () => { running = false; if (pool) pool.forEach(w => w.terminate()); });
window.__collider = { S, vR, vZ, lego, runEvent, computeEvent, showEvent, select, setLayout, setHardware, setLabels, ensure3D, get v3() { return v3; } };

// ── boot ────────────────────────────────────────────────────────────────────
fillEnergy();
setLayout(PREF.layout); setLabels(PREF.labels); setOutline(PREF.outline); setHardware(PREF.hardware); setPhoneView(PREF.phoneView);
const start = (location.hash || '').slice(1);
if (SCENARIOS[start]) pickScen(start); else pickScen('zmm');
runEvent(S.scen);
requestAnimationFrame(frame);
