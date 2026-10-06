// ============================================================================
//  PARTICLE COLLIDER  ·  main.js — modes, events, panels, loop, saver
// ----------------------------------------------------------------------------
//  Two scenes share one renderer (stage.js):
//    ring ...... the accelerator complex (ring.js), ten stations with live
//                plots (accplots.js) driven by accel.js
//    detector .. the barrel detector (detector.js) and the event display
//                (display.js, views2d.js) for events that the transport
//                engine computes in Web Workers (worker.js)
//  "Collide at IP5" flies down to the interaction point and fades into the
//  detector, where the event starts with the two bunches meeting at t = 0.
//
//  EVENTS (grep -n 'function runEvent')
//    generate() on the main thread -> splitPrims() into one share per
//    worker -> each worker runs the engine -> mergeResults() ->
//    reconstruct() -> display.show() and views.show(). Without module
//    workers the engine runs on the main thread.
//
//  TIME  S.t is the event time in ns; it moves at S.speed ns per second
//  (slow motion), from -4 ns (bunches 1.2 m apart) to the last segment.
//
//  GREP MAP
//    function setMode / selectStation / runEvent / fillEvent / fillStation
//    function frame ............. the loop
//    window.snSaver ............. the screensaver tour (seeded shot list)
// ============================================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createStage, gradientBackground } from './stage.js';
import { createRing } from './ring.js';
import { createDetector } from './detector.js';
import { createDisplay } from './display.js';
import { createViews } from './views2d.js';
import { createAccel, STATIONS } from './accplots.js';
import { buildDetector } from './geometry.js';
import { generate, SCENARIOS, SQRT_S } from './generators.js';
import { createEngine, mergeResults, splitPrims, makeRng, pack } from './transport.js';
import { reconstruct } from './reco.js';
import { PART, CLASS_COLOR, CLASS_LABEL } from './particles.js';
import { PRESETS, luminosity, ramp as rampAt } from './accel.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GeV = v => (v / 1000).toFixed(v < 10000 ? 2 : 1);

let saverOn = false, saverBand = null, saverTick = null;
const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel'), $('dock')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  mode: 'ring', station: 'source', scen: 'zmm', t: -4, playing: true, speed: 3, auto: false, busy: false, ev: null, seed: 1,
  gun: { particle: 'e-', energy: 50000, eta: 0.3, phi: 0.6, count: 1 }, pileup: 0, holdT: 0, labels: true, sel: -1,
  anaOpen: !PHONE_Q.matches,
};

// ── scenes ──────────────────────────────────────────────────────────────────
const ring = createRing(THREE, { target: () => stage.controls.target });
const detScene = new THREE.Scene();
detScene.background = gradientBackground('#0b1222', '#04060b', '#020306');
{
  const pm = new THREE.PMREMGenerator(stage.renderer);
  detScene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
  detScene.add(new THREE.HemisphereLight(0xaac4ff, 0x140f0c, 0.6));
  const key = new THREE.DirectionalLight(0xfff0e0, 1.2); key.position.set(9000, 12000, 14000); detScene.add(key);
}
const GEO = buildDetector();
const det = createDetector(THREE, GEO, { cut: 'wedge' });
detScene.add(det.group);
const disp = createDisplay(THREE);
detScene.add(disp.group);
{ // the beam line
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -9000), new THREE.Vector3(0, 0, 9000)]);
  detScene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x5f8dff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));
}
const views = createViews({ rphi: $('vRphi'), rz: $('vRz'), lego: $('vLego'), tip: $('legoTip') });
const acc = createAccel();

// ── workers ─────────────────────────────────────────────────────────────────
const NW = Math.max(2, Math.min(COARSE ? 3 : 8, (navigator.hardwareConcurrency || 4) - 1));
const ENG = { maxSeg: Math.round((COARSE ? 160000 : 420000) / NW), segShowerMinE: COARSE ? 20 : 10 };
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
  const rng = makeRng(seed);
  const pu = kind === 'mb' ? Math.round(o.pileup ?? Math.min(60, acc.lum().mu)) : (o.pileup ?? S.pileup);
  const g = generate(kind, { ...S.gun, ...o, pileup: pu }, rng);
  const t0 = performance.now();
  const R = await transport(g.prims, seed);
  const O = reconstruct(R, g.info);
  return { kind, g, R, O, ms: performance.now() - t0, seed };
}
let evToken = 0;
async function runEvent(kind = S.scen, o = {}) {
  const tok = ++evToken;
  S.busy = true; $('busy').hidden = false;
  try {
    const seed = o.seed || (S.seed = (S.seed * 1103515245 + 12345) >>> 0 || 7);
    const E = o.ready || await computeEvent(kind, seed, o);
    if (tok !== evToken) return E;
    showEvent(E);
    return E;
  } finally { if (tok === evToken) { S.busy = false; $('busy').hidden = true; } }
}
function showEvent(E) {
  S.ev = E; S.sel = -1; disp.setSel(-1);
  const r = disp.show(E.R, E.O, E.g.info, { cones: COARSE ? 60 : 160 });
  views.show(E.R, E.O);
  $('tSlide').max = Math.ceil(r.tEnd);
  S.t = -4; S.playing = true; S.holdT = 0; setPlay(true);
  if (!saverOn) fillEvent();
}

// ── modes ───────────────────────────────────────────────────────────────────
const DET_VIEW = { az: 44, el: 24, r: 31000, target: new THREE.Vector3(0, 0, 0) };
function setMode(m, o = {}) {
  S.mode = m;
  document.querySelectorAll('.mode').forEach(b => b.classList.toggle('on', b.dataset.mode === (m === 'ring' ? 'ring' : 'det')));
  $('ringCtl').hidden = m !== 'ring'; $('detCtl').hidden = m === 'ring';
  $('anaRing').hidden = m !== 'ring'; $('anaDet').hidden = m === 'ring';
  $('clock').hidden = m === 'ring';
  $('legend').hidden = m === 'ring';
  $('dockMode').querySelector('span').textContent = m === 'ring' ? 'Detector' : 'Accelerator';
  $('dockGo').querySelector('span').textContent = m === 'ring' ? 'Collide' : 'Event';
  buildLabels();
  if (m === 'ring') {
    stage.use(ring.scene, { min: 4, max: 42000, near: 0.0015, bloom: [0.85, 0.5, 0.25] });
    if (!o.keep) selectStation(S.station, { soft: true });
  } else {
    stage.use(detScene, { min: 600, max: 60000, near: 0.003, bloom: [0.75, 0.5, 0.3] });
    if (!o.keep) { stage.place({ ...DET_VIEW, r: 52000 }); stage.flyTo({ ...DET_VIEW, t: 2.2 }); }
    if (!S.ev && !o.noEvent) runEvent(S.scen);
  }
  if (!saverOn) try { history.replaceState(null, '', '#' + (m === 'ring' ? S.station : S.scen)); } catch (e) { /* file: */ }
}
document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode === 'ring' ? 'ring' : 'det')));

// ── accelerator stations ────────────────────────────────────────────────────
const SPEED = { source: 80, chain: 1500, dipole: 22, fodo: 30, tune: 14, rf: 40, ramp: 2400, ip: 30, sr: 160, dump: 600 };
function selectStation(id, o = {}) {
  S.station = id;
  const st = ring.stations[id];
  stage.flyTo({ az: st.az, el: st.el, r: st.r, target: st.target, t: o.soft ? 2.6 : 2.2 });
  ring.setSpeed(SPEED[id] || 60);
  ring.setCloseUp(id === 'fodo' || id === 'tune');
  document.querySelectorAll('#stations .card').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  fillStation();
  if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
}
function fillStation() {
  const st = STATIONS.find(s => s.id === S.station);
  $('stKind').textContent = st.kind; $('stTitle').textContent = st.name; $('stLede').textContent = st.lede;
  $('stEqs').innerHTML = st.eqs.map(([h, e, n]) => `<div class="eq"><span>${esc(h)}</span><div>${esc(e)}</div>${n ? `<em>${esc(n)}</em>` : ''}</div>`).join('');
  $('plotB').style.display = acc.plotsOf(S.station) > 1 ? '' : 'none';
  fillNums();
}
let lastNums = '';
function fillNums() {
  const html = acc.nums(S.station).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  if (html !== lastNums) { $('stNums').innerHTML = html; lastNums = html; }
}
$('stations').innerHTML = STATIONS.map((s, i) => `<button class="card" type="button" data-id="${s.id}"><em>${String(i + 1).padStart(2, '0')}</em><b>${esc(s.name)}</b><span>${esc(s.kind)}</span></button>`).join('');
$('stations').querySelectorAll('.card').forEach(b => b.addEventListener('click', () => { selectStation(b.dataset.id); if (PHONE_Q.matches) setOpen(false); }));
$('preset').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('');
$('preset').addEventListener('change', e => { acc.S.preset = e.target.value; fillNums(); });
const setClock = v => { acc.S.rampRate = Math.round(10 ** v); $('clockKV').textContent = `×${acc.S.rampRate}`; };
$('clockK').addEventListener('input', e => setClock(+e.target.value)); setClock(+$('clockK').value);
const setQp = v => { acc.S.Qp = v; $('qpV').textContent = (v > 0 ? '+' : '') + v; };
$('qp').addEventListener('input', e => setQp(+e.target.value)); setQp(+$('qp').value);
const setQh = v => { acc.S.qH = v; $('qhV').textContent = v.toFixed(3); };
$('qh').addEventListener('input', e => setQh(+e.target.value)); setQh(+$('qh').value);
$('dumpBtn').addEventListener('click', () => { selectStation('dump'); setTimeout(() => ring.dumpFlash(), 1600); });
$('collide').addEventListener('click', () => collide());
async function collide() {
  if (S.mode !== 'ring') return;
  selectStation('ip');
  const pre = computeEvent(S.scen === 'gun' ? 'zmm' : S.scen, (S.seed = (S.seed * 69069 + 1) >>> 0));
  await new Promise(r => setTimeout(r, 2300));
  $('view').style.opacity = '0';
  await new Promise(r => setTimeout(r, 700));
  setMode('det', { noEvent: true });
  $('view').style.opacity = '1';
  const E = await pre; showEvent(E);
}

// ── detector controls ───────────────────────────────────────────────────────
$('scenarios').innerHTML = Object.entries(SCENARIOS).map(([k, s]) => `<button class="card" type="button" data-k="${k}"><b>${esc(s.short)}</b><span>${esc(s.process)}</span></button>`).join('');
const pickScen = k => {
  S.scen = k; document.querySelectorAll('#scenarios .card').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  $('gunBox').hidden = k !== 'gun';
  if (k === 'mb') setPU(Math.round(Math.min(60, acc.lum().mu)));
};
$('scenarios').querySelectorAll('.card').forEach(b => b.addEventListener('click', () => { pickScen(b.dataset.k); runEvent(b.dataset.k); if (PHONE_Q.matches) setOpen(false); }));
const GUN = ['e-', 'gamma', 'mu-', 'pi+', 'pi-', 'K+', 'p', 'n', 'K0S', 'K0L'];
$('gunP').innerHTML = GUN.map(k => `<option value="${k}">${esc(PART[k].label)} · ${k}</option>`).join('');
$('gunP').addEventListener('change', e => { S.gun.particle = e.target.value; });
const setE = v => { S.gun.energy = Math.round(10 ** v * 1000); $('gunEV').textContent = `${(S.gun.energy / 1000).toPrecision(3)} GeV`; };
$('gunE').addEventListener('input', e => setE(+e.target.value)); setE(+$('gunE').value);
const bind = (id, key, f = v => v.toFixed(2)) => { const set = v => { S.gun[key] = v; $(id + 'V').textContent = f(v); }; $(id).addEventListener('input', e => set(+e.target.value)); set(+$(id).value); };
bind('gunEta', 'eta'); bind('gunPhi', 'phi'); bind('gunN', 'count', v => String(v));
const setPU = v => { S.pileup = v; $('pu').value = v; $('puV').textContent = String(v); };
$('pu').addEventListener('input', e => setPU(+e.target.value)); setPU(0);
$('fire').addEventListener('click', () => runEvent(S.scen));
$('auto').addEventListener('click', () => { S.auto = !S.auto; $('auto').classList.toggle('on', S.auto); });
const setSpeed = v => { S.speed = v; $('speedV').textContent = `${v.toFixed(1)} ns/s`; };
$('speed').addEventListener('input', e => setSpeed(+e.target.value)); setSpeed(+$('speed').value);
function setPlay(on) { S.playing = on; $('tPlay').textContent = on ? '❚❚' : '▶'; $('tPlay').setAttribute('aria-label', on ? 'Pause' : 'Play'); }
$('tPlay').addEventListener('click', () => { if (!S.playing && S.t >= disp.tEnd) S.t = -4; setPlay(!S.playing); });
$('tSlide').addEventListener('input', e => { setPlay(false); S.t = +e.target.value; });
document.querySelectorAll('#cuts button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.cut) { det.setCut(b.dataset.cut); document.querySelectorAll('#cuts [data-cut]').forEach(q => q.classList.toggle('on', q === b)); }
  if (b.dataset.v === 'side') { det.setOpacity(1); stage.flyTo({ az: 90, el: 4, r: 21000, target: new THREE.Vector3(), t: 1.6 }); }
  if (b.dataset.v === 'end') { det.setOpacity(0.35); stage.flyTo({ az: 0, el: 0.5, r: 19000, target: new THREE.Vector3(), t: 1.6 }); }
  if (b.dataset.cut) det.setOpacity(1);
}));
document.querySelector('#cuts [data-cut="wedge"]').classList.add('on');
document.querySelectorAll('#shows button').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.show, on = !b.classList.contains('on'); b.classList.toggle('on', on);
  if (k === 'labels') S.labels = on; else if (k === 'orbit') stage.orbit = on; else det.setShow(k, on);
}));
$('dockMode').addEventListener('click', () => setMode(S.mode === 'ring' ? 'det' : 'ring'));
$('dockGo').addEventListener('click', () => { if (S.mode === 'ring') collide(); else runEvent(S.scen); });

// ── legend and labels ───────────────────────────────────────────────────────
$('legend').innerHTML = ['mu', 'e', 'gamma', 'had', 'neu', 'shower'].map(k => `<span><i class="${k === 'neu' || k === 'gamma' ? 'dash' : ''}" style="color:${CLASS_COLOR[k]};background:${CLASS_COLOR[k]}"></i>${esc(CLASS_LABEL[k])}</span>`).join('') + `<span><i style="color:${CLASS_COLOR.nu};background:${CLASS_COLOR.nu}"></i>missing E<sub>T</sub></span>`;
let labelEls = [];
function buildLabels() {
  $('labels').innerHTML = '';
  const list = S.mode === 'ring' ? ring.labels : det.labels.map(l => ({ id: l.id, text: l.name, pos: new THREE.Vector3(...l.pos) }));
  labelEls = list.map(l => { const el = document.createElement('div'); el.className = 'lb'; el.innerHTML = `<i></i>${esc(l.text)}${l.sub ? ` <small>${esc(l.sub)}</small>` : ''}`; $('labels').appendChild(el); return { el, pos: l.pos }; });
}
const PV = new THREE.Vector3();
function placeLabels() {
  const cv = $('view'), w = cv.clientWidth, h = cv.clientHeight, show = S.labels && !saverOn;
  const d = stage.camera.position.distanceTo(stage.controls.target);
  for (const L of labelEls) {
    PV.copy(L.pos).project(stage.camera);
    const vis = show && PV.z < 1 && Math.abs(PV.x) < 1.05 && Math.abs(PV.y) < 1.05 && (S.mode !== 'ring' || d > 600 || L.pos.distanceTo(stage.controls.target) < 3 * d);
    L.el.style.opacity = vis ? '1' : '0';
    if (vis) L.el.style.transform = `translate(${((PV.x + 1) / 2 * w).toFixed(1)}px, ${((1 - PV.y) / 2 * h - 6).toFixed(1)}px) translate(-50%, -100%)`;
  }
}

// ── analysis: the event ─────────────────────────────────────────────────────
function fillEvent() {
  const E = S.ev; if (!E) return;
  const { g, O, R } = E, info = g.info, tr = info.truth || {};
  $('evKind').textContent = `pp · √s = ${(SQRT_S / 1e6).toFixed(1)} TeV · ${info.pileup ? `${info.pileup + (E.kind === 'mb' ? 1 : 0)} vertices` : 'no pile-up'}`;
  $('evTitle').textContent = info.title;
  const m = [];
  if (tr.mass) m.push(`true mass <b>${GeV(tr.mass)} GeV</b>`);
  if (O.masses.mumu) m.push(`m(μμ) <b>${GeV(O.masses.mumu)}</b>`);
  if (O.masses.ee) m.push(`m(ee) <b>${GeV(O.masses.ee)}</b>`);
  if (O.masses.gg) m.push(`m(γγ) <b>${GeV(O.masses.gg)}</b>`);
  if (O.masses.l4) m.push(`m(4ℓ) <b>${GeV(O.masses.l4)}</b>`);
  if (O.masses.jj && (E.kind === 'jj' || E.kind === 'tt')) m.push(`m(jj) <b>${GeV(O.masses.jj)}</b>`);
  if (tr.channel) m.push(esc(tr.channel));
  if (E.kind === 'gun') m.push(`${esc(PART[tr.particle].label)} · ${GeV(tr.E)} GeV · η ${tr.eta.toFixed(2)}`);
  $('evMass').innerHTML = m.join(' · ') || '&nbsp;';
  $('trig').innerHTML = O.trigger.bits.map(([n, on]) => `<span class="${on ? 'on' : ''}">${esc(n)}</span>`).join('') + `<span class="${O.trigger.accept ? 'acc' : 'rej'}">${O.trigger.accept ? 'L1 ACCEPT' : 'L1 reject'}</span>`;
  const rows = [];
  const sw = c => `<i class="sw" style="color:${c};background:${c}"></i>`;
  for (const q of O.muons.slice(0, 6)) rows.push([q.k, `${sw(CLASS_COLOR.mu)}μ${q.q > 0 ? '⁺' : '⁻'}`, q.pT, q.eta, q.phi0, `sagitta ${q.sag.toFixed(1)} mm`]);
  for (const q of O.electrons.slice(0, 6)) rows.push([q.track.k, `${sw(CLASS_COLOR.e)}e${q.q > 0 ? '⁺' : '⁻'}`, q.pT, q.eta, q.phi, `E/p ${(q.E / q.track.p).toFixed(2)}`]);
  for (const q of O.photons.slice(0, 6)) rows.push([-1, `${sw(CLASS_COLOR.gamma)}γ`, q.pT, q.eta, q.phi, `iso ${q.iso.toFixed(2)}`]);
  for (const q of O.jets.slice(0, 6)) rows.push([-1, `${sw('#ffd45c')}jet`, q.pT, q.eta, q.phi, `${q.n} towers · EM ${(q.emf * 100).toFixed(0)} %`]);
  const tk = O.tracks.filter(t => !t.mu && !O.electrons.some(e => e.track === t)).slice(0, 5);
  for (const q of tk) rows.push([q.k, `${sw(CLASS_COLOR.had)}track`, q.pT, q.eta, q.phi0, q.pTtrue ? `true ${GeV(q.pTtrue)}` : '']);
  $('objs').innerHTML = `<tr><th>Object</th><th>p<sub>T</sub> GeV</th><th>η</th><th>φ</th><th></th></tr>` + rows.map(([k, n, pT, eta, phi, x]) => `<tr ${k >= 0 ? `data-k="${k}"` : ''}><td>${n}</td><td>${GeV(pT)}</td><td>${eta.toFixed(2)}</td><td>${phi.toFixed(2)}</td><td class="x">${esc(x)}</td></tr>`).join('') +
    `<tr><td>${sw(CLASS_COLOR.nu)}MET</td><td>${GeV(O.met.et)}</td><td></td><td>${O.met.phi.toFixed(2)}</td><td>true ${GeV(O.met.trueEt)}</td></tr><tr><td>H<sub>T</sub></td><td>${GeV(O.ht)}</td><td></td><td></td><td></td></tr>`;
  $('objs').querySelectorAll('tr[data-k]').forEach(tr2 => tr2.addEventListener('click', () => {
    const k = +tr2.dataset.k, on = S.sel !== k; S.sel = on ? k : -1; disp.setSel(S.sel);
    $('objs').querySelectorAll('tr').forEach(q => q.classList.toggle('sel', on && q === tr2));
  }));
  const L = R.L, sub = [['Tracker', O.sub.tracker], ['ECAL', O.sub.ecal], ['HCAL', O.sub.hcal], ['Coil', O.sub.coil], ['Yoke', O.sub.yoke], ['Muon gas', O.sub.muon], ['Escaped', L.esc], ['Invisible', L.inv]];
  const mx = Math.max(...sub.map(s => s[1]));
  $('subs').innerHTML = sub.map(([n, v]) => `<div class="s"><span>${n}</span><i style="width:${(Math.max(0.3, 100 * v / mx)).toFixed(1)}%"></i><em>${v > 1e5 ? GeV(v) + ' GeV' : v > 1000 ? (v / 1000).toFixed(2) + ' GeV' : v.toFixed(1) + ' MeV'}</em></div>`).join('');
  const bal = L.in + L.borrow - (L.dep + L.esc + L.inv + L.ret), st = R.stats;
  $('eng').innerHTML = [
    ['Primaries', g.prims.length], ['Tracks transported', st.tracksAll.toLocaleString()], ['Steps', st.steps.toLocaleString()], ['Segments drawn', R.nSeg.toLocaleString()],
    ['Silicon / muon hits', `${R.hits.n} / ${R.mhits.n}`], ['Workers · wall time', `${pool ? NW : 1} · ${E.ms.toFixed(0)} ms`],
    ['Cherenkov photons (ECAL)', Math.round(R.cher.ecal || 0).toLocaleString()], ['Scintillation photons (HCAL)', Math.round(R.scint.hcalS || 0).toLocaleString()],
    ['Energy ledger', `${bal.toExponential(1)} MeV of ${GeV(L.in)} GeV`],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

// ── panels (as on the wave-membrane and geneva-cams pages) ──────────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'mode';
function placeAnalysis() {
  if (PHONE_Q.matches) { if (anaSec.parentNode !== panel) panel.appendChild(anaSec); }
  else if (anaSec.parentNode !== anaPanel) anaPanel.appendChild(anaSec);
  setAna(S.anaOpen);
}
function setAna(open) {
  S.anaOpen = open;
  const desk = !PHONE_Q.matches;
  anaPanel.classList.toggle('open', open && desk);
  $('anaOpen').hidden = !desk || open;
  document.body.classList.toggle('ana-open', open && desk);
}
$('anaClose').addEventListener('click', () => setAna(false));
$('anaOpen').addEventListener('click', () => setAna(true));
function setOpen(open, g = grp) {
  grp = g;
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open && PHONE_Q.matches);
  panel.querySelectorAll('.grp').forEach(el => el.classList.toggle('on', el.dataset.grp === grp));
  for (const t of tabs) { const on = open && t.dataset.grp === grp; t.classList.toggle('on', on); t.setAttribute('aria-expanded', String(on)); }
  if (open && PHONE_Q.matches) panel.scrollTop = 0;
}
for (const t of tabs) t.addEventListener('click', () => setOpen(!(panel.classList.contains('open') && grp === t.dataset.grp), t.dataset.grp));
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
placeAnalysis();
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => { placeAnalysis(); setOpen(!e.matches); });
{
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return; const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full'); else if (dy < -40) panel.classList.add('full'); else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}
let hintGone = false;
const hideHint = () => { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } };
stage.onStart = hideHint; setTimeout(hideHint, 9000);

// ── readout ─────────────────────────────────────────────────────────────────
let readT = 0;
function readout() {
  if (S.mode === 'ring') {
    const r = rampAt(acc.S.t), st = STATIONS.find(s => s.id === S.station);
    $('read').innerHTML = `<span class="hi">${esc(st.name)}</span><br><span class="lo">${esc(r.phase)} · p ${(r.p / 1000).toFixed(3)} TeV/c · B ${r.B.toFixed(3)} T · L ${luminosity(PRESETS[acc.S.preset]).L.toExponential(2)} cm⁻²s⁻¹</span>`;
  } else if (S.ev) {
    const E = S.ev, O = E.O, ms = [];
    for (const [k, l] of [['mumu', 'μμ'], ['ee', 'ee'], ['gg', 'γγ'], ['l4', '4ℓ']]) if (O.masses[k]) ms.push(`m<sub>${l}</sub> ${GeV(O.masses[k])} GeV`);
    $('read').innerHTML = `<span class="hi">${esc(E.g.info.title)}</span> <span class="lo">· t = ${S.t.toFixed(2)} ns</span><br><span class="lo">${ms.join(' · ') || `${O.tracks.length} tracks · ${O.jets.length} jets`} · </span><span class="${O.trigger.accept ? 'ok' : 'bad'}">${O.trigger.accept ? 'L1 accept' : 'L1 reject'}</span>`;
  } else $('read').innerHTML = '<span class="hi">Detector</span>';
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), running = true, numT = 0;
const RES = new THREE.Vector2();
function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  stage.renderer.getDrawingBufferSize(RES);
  if (S.mode === 'ring') {
    acc.tick(dt);
    ring.frame(dt, stage.camera, RES, stage.renderer.getPixelRatio());
  } else {
    if (S.ev && S.playing) {
      S.t += dt * S.speed;
      if (S.t > disp.tEnd) {
        S.t = disp.tEnd; S.holdT += dt;
        if (!saverOn && S.holdT > 4 && S.auto && !S.busy) runEvent(S.scen);
        else if (!saverOn && !S.auto && S.holdT > 0.05) setPlay(false);
      }
    }
    disp.setTime(S.t); disp.frame(stage.renderer);
  }
  stage.frame(dt);
  if (!saverOn) {
    placeLabels();
    if ((readT += dt) > 0.12) { readT = 0; readout(); if (S.mode === 'det') { $('tSlide').value = S.t; $('tVal').textContent = `${S.t.toFixed(2)} ns`; } }
    if (S.mode === 'ring') { if (S.anaOpen || PHONE_Q.matches) acc.draw(S.station, [$('plotA'), $('plotB')]); if ((numT += dt) > 0.25) { numT = 0; fillNums(); } }
    else if (S.anaOpen || PHONE_Q.matches) views.draw(S.t);
  } else if (saverTick) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; stage.dispose(); if (pool) pool.forEach(w => w.terminate()); });
window.__collider = { S, stage, ring, det, disp, acc, runEvent, setMode, selectStation, computeEvent, showEvent };

// ── boot ────────────────────────────────────────────────────────────────────
pickScen('zmm');
const start = (location.hash || '').slice(1);
if (SCENARIOS[start]) { pickScen(start); setMode('det'); }
else { if (STATIONS.some(s => s.id === start)) S.station = start; stage.place({ az: 0, el: 62, r: 30000, target: new THREE.Vector3() }); setMode('ring'); }
requestAnimationFrame(frame);

// ── screensaver ─────────────────────────────────────────────────────────────
// enter() hides the GUI and plays a seeded shuffle of shots, a cut every
// 5-12 s (longer when calm): bunches in the ring and the FODO cells, the
// ramp, a fly-in to IP5, collisions of random scenarios in slow motion, a
// close-up of a shower in the calorimeter, a busy pile-up event seen
// end-on. The subject is framed in the plate's clear band (plateBand).
// The plate shows the scenario, its numbers and a real extract of the
// engine's source. No exit(): the shell reloads the page.
window.snSaver = {
  enter(o = {}) {
    saverOn = true;
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const label = typeof o.label === 'function' ? o.label : () => {};
    const st = document.createElement('style');
    st.textContent = '.topbar,#panel,#anaPanel,#anaOpen,#dock,#hint,#labels,#read,#legend,#clock,#busy,#nogl,#gear{display:none!important}#stage{top:0!important;bottom:0!important}#view{cursor:none}';
    document.head.appendChild(st);
    setOpen(false); setAna(false); S.labels = false;
    stage.orbit = false;
    // source extracts for the plate
    const SRC = {};
    const grabs = [];
    const grab = (file, start, name) => grabs[grabs.length] = fetch(file).then(r => r.text()).then(t => {
      const i = t.indexOf(start); if (i < 0) return;
      let k = t.indexOf('{', i), depth = 0, j = k;
      for (; j < t.length; j++) { if (t[j] === '{') depth++; else if (t[j] === '}' && --depth === 0) break; }
      SRC[name] = { lang: 'js', name: `${file} · ${name}`, text: t.slice(i, j + 1) };
    }).catch(() => {});
    grab('physics.js', 'export function bbHeavy', 'bbHeavy'); grab('physics.js', 'export function highland', 'highland');
    grab('physics.js', 'export function sampleCompton', 'sampleCompton'); grab('physics.js', 'export function sampleBremK', 'sampleBremK');
    grab('transport.js', 'const helix = (tr, s, h) =>', 'helix'); grab('accel.js', 'export function luminosity', 'luminosity');
    grab('accel.js', 'export function rfMap', 'rfMap'); grab('accel.js', 'export function srLoss', 'srLoss');
    const code = (...names) => { for (const n of names) if (SRC[n]) return SRC[n]; return undefined; };
    let bandFn = null;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });

    const hold = () => 1000 * Math.max(5, Math.min(12, (5.5 + 5 * calm) * (0.85 + 0.3 * rnd())));
    const EV = ['zmm', 'zee', 'hgg', 'h4l', 'tt', 'jj'];
    const SHOTS = ['ring', 'fodo', 'ramp', 'chain', 'ipfly', 'ev', 'ev', 'ev', 'shower', 'pileup', 'rf'];
    let queue = [], shot = null, shotT = 0, shotDur = 6000, cam = null, next = null, nextKind = null;
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const prepare = () => {
      // compute the next event shot ahead
      const r = rnd(); nextKind = r < 0.7 ? EV[Math.floor(rnd() * EV.length)] : 'mb';
      next = computeEvent(nextKind, (rnd() * 4e9) >>> 0, nextKind === 'mb' ? { pileup: 28 + Math.floor(rnd() * 20) } : { pileup: rnd() < 0.4 ? 3 : 0 });
    };
    let shower = null;
    const prepShower = () => { const p = ['e-', 'gamma', 'pi+', 'pi-'][Math.floor(rnd() * 4)]; shower = computeEvent('gun', (rnd() * 4e9) >>> 0, { particle: p, energy: (p[0] === 'p' ? 80000 : 50000) + Math.floor(rnd() * 100000), eta: (rnd() - 0.5) * 1.6, phi: (rnd() - 0.5) * 1.2 + 0.78, count: 1 }); };
    prepare(); prepShower();
    // camera move over a shot: base pose plus a seeded drift
    const move = (base, kind) => ({ base, kind: kind || ['orbit', 'push', 'pull', 'crane'][Math.floor(rnd() * 4)], dir: rnd() < 0.5 ? -1 : 1 });
    const applyCam = u => {
      if (!cam || stage.fly) return;
      const b = cam.base, s = u * u * (3 - 2 * u);
      let az = b.az, el = b.el, r = b.r;
      if (cam.kind === 'orbit') az += cam.dir * 34 * (u - 0.5);
      if (cam.kind === 'push') r *= 1.18 - 0.3 * s;
      if (cam.kind === 'pull') r *= 0.86 + 0.3 * s;
      if (cam.kind === 'crane') { el += cam.dir * (18 * s - 9); az += 6 * cam.dir * (u - 0.5); }
      stage.place({ az, el: Math.max(-8, Math.min(80, el)), r, target: b.target });
    };
    const ringShot = (id, title, sub, params, cd, kind) => {
      if (S.mode !== 'ring') setMode('ring', { keep: true });
      const stn = ring.stations[id];
      stage.bloom.strength = 0.85;
      ring.setSpeed(SPEED[id] * (0.7 + 0.6 * rnd()));
      ring.setCloseUp(id === 'fodo' || id === 'tune');
      const base = { az: stn.az + (rnd() - 0.5) * 50, el: stn.el + (rnd() - 0.5) * 12, r: stn.r * (0.85 + 0.3 * rnd()), target: stn.target };
      stage.flyTo({ ...base, t: 1.4 }); cam = move(base, kind);
      label({ title, sub, params, code: cd, anchor: () => anchorAt(stn.target, stn.r * 0.18) });
    };
    const P = (sym, name, value) => ({ sym, name, value: String(value) });
    const evShot = async (E, look) => {
      if (S.mode !== 'det') setMode('det', { keep: true, noEvent: true });
      det.setCut(look === 'end' ? 'none' : ['wedge', 'half', 'quarter'][Math.floor(rnd() * 3)]);
      det.setOpacity(look === 'end' ? 0.35 : 1);
      showEvent(E);
      S.speed = (2.2 + 2.5 * (1 - calm)) * (0.8 + 0.4 * rnd()); S.t = -3.5;
      // end-on, every cell along z lands on the same ring: dim cells and lines
      if (look === 'end') { disp.U.uCellGain.value *= 0.25; disp.U.uGain.value *= 0.6; }
      stage.bloom.strength = look === 'end' ? 0.35 : 0.75;
      const base = look === 'end' ? { az: (rnd() - 0.5) * 6, el: (rnd() - 0.5) * 4, r: 46000, target: new THREE.Vector3() }
        : look === 'shower' ? showerPose(E) : { az: 20 + rnd() * 60, el: 12 + rnd() * 26, r: 22000 + rnd() * 6000, target: new THREE.Vector3() };
      stage.flyTo({ ...base, t: 1.2 }); cam = move(base, look === 'end' ? 'push' : null);
      const info = E.g.info, tr = info.truth || {}, O = E.O;
      const params = [P('\\sqrt{s}', 'collision energy', '13.6 TeV')];
      if (tr.mass && E.kind !== 'jj') params.push(P('m', 'true mass', `${GeV(tr.mass)} GeV`));
      const mk = O.masses.mumu ? ['m_{\\mu\\mu}', O.masses.mumu] : O.masses.ee ? ['m_{ee}', O.masses.ee] : O.masses.gg ? ['m_{\\gamma\\gamma}', O.masses.gg] : O.masses.l4 ? ['m_{4\\ell}', O.masses.l4] : O.masses.jj ? ['m_{jj}', O.masses.jj] : null;
      if (mk && E.kind !== 'mb') params.push(P(mk[0], 'reconstructed', `${GeV(mk[1])} GeV`));
      const lead = [...O.muons, ...O.electrons, ...O.photons, ...O.jets].sort((a, b) => b.pT - a.pT)[0];
      if (lead) params.push(P('p_T', 'leading object', `${GeV(lead.pT)} GeV`));
      if (E.kind === 'mb') params.push(P('\\mu', 'pile-up vertices', String(info.vertices.length)));
      if (E.kind === 'gun') params.push(P('E', PART[tr.particle].label, `${GeV(tr.E)} GeV`));
      const cd = E.kind === 'gun' ? code(tr.particle === 'e-' || tr.particle === 'gamma' ? 'sampleBremK' : 'bbHeavy', 'highland') : code(['bbHeavy', 'helix', 'highland', 'sampleCompton'][Math.floor(rnd() * 4)], 'bbHeavy');
      const sub = E.kind === 'gun' ? `${PART[tr.particle].label} shower in the ${Math.abs(tr.eta) < 1.4 ? 'barrel' : 'endcap'} calorimeters` : E.kind === 'mb' ? 'Minimum-bias collisions, one bunch crossing' : `${info.process}${tr.channel ? ' · ' + tr.channel : ''}`;
      label({ title: E.kind === 'gun' ? 'Calorimeter shower' : info.title, sub, params, code: cd, anchor: () => anchorAt(base.target, look === 'shower' ? 900 : 5200) });
    };
    const showerPose = E => {
      const tr = E.g.info.truth, th = 2 * Math.atan(Math.exp(-tr.eta)), r = Math.abs(tr.eta) < 1.4 ? 1700 : 3300 / Math.abs(Math.cos(th));
      const tg = new THREE.Vector3(Math.sin(th) * Math.cos(tr.phi), Math.sin(th) * Math.sin(tr.phi), Math.cos(th)).multiplyScalar(Math.min(r, 3600));
      return { az: 90 + (rnd() - 0.5) * 80, el: 8 + rnd() * 30, r: 4200 + rnd() * 1800, target: tg };
    };
    const anchorAt = (p, rad) => {
      const cv = $('view'), rc = cv.getBoundingClientRect();
      PV.copy(p).project(stage.camera); if (PV.z > 1) return null;
      const c = { x: rc.left + (PV.x + 1) / 2 * rc.width, y: rc.top + (1 - PV.y) / 2 * rc.height };
      const q = p.clone().add(stage.camera.up.clone().multiplyScalar(rad)).project(stage.camera);
      return { x: c.x, y: c.y, r: Math.max(30, Math.abs((q.y - PV.y) / 2 * rc.height)) };
    };
    const startShot = async kind => {
      shot = kind; shotT = 0; shotDur = hold();
      const P4 = PRESETS.design, L = luminosity(P4), r = rampAt(acc.S.t);
      switch (kind) {
        case 'ring': ringShot(rnd() < 0.5 ? 'dipole' : 'sr', 'Collider ring', 'Two beams of 2808 bunches, 1232 superconducting dipoles', [P('E', 'beam energy', '6.8 TeV'), P('B', 'dipole field', '8.09 T'), P('f_{rev}', 'revolution', '11.245 kHz'), P('U_0', 'radiated per turn', '6.0 keV')], code('srLoss', 'luminosity')); break;
        case 'fodo': ringShot('fodo', 'FODO cell', 'The beam envelope breathes through focusing and defocusing quadrupoles', [P('\\mu', 'phase advance', '90°'), P('\\beta_{max}', 'at QF', `${ring.cell.betaMax.toFixed(0)} m`), P('\\beta_{min}', 'at QD', `${ring.cell.betaMin.toFixed(0)} m`), P('D_{max}', 'dispersion', `${ring.cell.Dmax.toFixed(2)} m`)], code('luminosity'), 'orbit'); break;
        case 'ramp': acc.S.rampRate = 900; acc.S.t = 1700; ringShot('ramp', 'The energy ramp', 'The dipole field follows the momentum: B = p / (e ρ)', [P('p', 'injection', '450 GeV/c'), P('p', 'top', '6.8 TeV/c'), P('B', 'now', `${r.B.toFixed(2)} T`)], code('rfMap')); break;
        case 'chain': ringShot('chain', 'Injector chain', 'Linac4 → Booster → PS → SPS → collider', [P('E', 'Linac4', '160 MeV'), P('E', 'Booster', '2 GeV'), P('p', 'PS', '26 GeV/c'), P('p', 'SPS', '450 GeV/c')], code('srLoss')); break;
        case 'rf': ringShot('rf', 'RF cavities', '400 MHz superconducting cavities hold the bunches in their buckets', [P('h', 'harmonic', '35640'), P('V', 'RF voltage', '16 MV'), P('Q_s', 'synchrotron tune', '0.0019')], code('rfMap')); break;
        case 'ipfly': {
          ringShot('ip', 'Interaction point 5', 'The beams cross at an angle, squeezed to a few microns', [P('\\sigma^*', 'beam size', `${(L.sigma * 1e6).toFixed(1)} μm`), P('\\mathcal{L}', 'luminosity', '1.0×10³⁴ cm⁻²s⁻¹'), P('\\mu', 'pile-up', L.mu.toFixed(0))], code('luminosity'), 'push');
          setTimeout(async () => { if (shot !== 'ipfly') return; $('view').style.opacity = '0'; await new Promise(q => setTimeout(q, 600)); const E = await next; if (shot !== 'ipfly') { $('view').style.opacity = '1'; return; } prepare(); await evShot(E, 'wide'); $('view').style.opacity = '1'; }, Math.min(3200, shotDur * 0.45));
          shotDur = Math.max(shotDur, 9500);
          break;
        }
        case 'ev': { const E = await next; prepare(); await evShot(E, E.kind === 'mb' ? 'end' : 'wide'); shotDur = Math.max(shotDur, 1000 * (disp.tEnd + 4) / S.speed * 0.8); break; }
        case 'pileup': { const E = await computeEvent('mb', (rnd() * 4e9) >>> 0, { pileup: 30 + Math.floor(rnd() * 25) }); await evShot(E, 'end'); break; }
        case 'shower': { const E = await shower; prepShower(); await evShot(E, 'shower'); break; }
      }
      shotDur = Math.max(5000, Math.min(13000, shotDur));
    };
    let busyShot = false;
    const advance = async () => {
      if (busyShot) return; busyShot = true;
      try {
        if (!queue.length) queue = shuffle(SHOTS.slice());
        let k = queue.shift(); if (k === shot) { queue.push(k); k = queue.shift(); }
        await startShot(k);
      } finally { busyShot = false; shotT = 0; }
    };
    window.snSaver.debug = () => ({ shot, shotT, shotDur, mode: S.mode, t: S.t, cam: cam && cam.kind, ev: S.ev && S.ev.kind });
    let bandT = 0;
    saverTick = dt => {
      if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { saverBand = bandFn($('view').clientHeight); } catch (e) { saverBand = null; } }
      shotT += dt * 1000;
      applyCam(Math.min(1, shotT / shotDur));
      if (S.mode === 'det' && S.t >= disp.tEnd) S.t = disp.tEnd;
      if (shotT >= shotDur && !busyShot) advance();
    };
    // the first plate waits for the source extracts (at most 1.5 s)
    Promise.race([Promise.all(grabs), new Promise(r => setTimeout(r, 1500))]).then(() => advance());
    return { canvas: $('view'), warmupMs: 2500 };
  },
};
