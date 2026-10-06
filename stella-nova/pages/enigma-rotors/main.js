// ============================================================================
//  ENIGMA ROTORS  ·  main.js — machine swap, typing, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one Enigma preset at a time: mech.js for the cipher, scene.js for
//  its 3D parts (kit.js), stage.js for the renderer and the camera, cards.js
//  for the part cards and labels. A copy of the linkages main.js with the
//  Enigma text, the typing, the step plot and the saver steps.
//
//  TIME
//    One number drives everything: S.t, the key press count. Press i runs
//    over t in [i, i + 1) (scene.js: step, then the current flows). The
//    tape types at S.rpm keys per minute. A typed key (keyboard or #kbd)
//    sets the next press to that letter, stops the tape, and runs to
//    S.goal = press + 0.75, where the lamp is lit.
//
//  GREP MAP
//    function swapTo ............ build a machine and cross-fade to it
//    const INFO / ABOUT ......... the panel text of each preset
//    const VIEWS / function setView  camera presets (and the x-ray)
//    function typeKey ........... a typed key: one press
//    function drawPlot .......... rotor positions over key presses, with
//                                 the double steps marked
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. advance, explode, pose, x-ray, stage
//    window.snSaver ............. screensaver hook: a seeded tour of each
//                                 preset with part close-ups
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, ALPHA } from './mech.js';
import { createBuild, ease } from './kit.js';
import { build, ROWS } from './scene.js';
import { createStage } from './stage.js';
import { createCards, esc } from './cards.js';
import { partsFor, GROUP_COLOR } from './parts.js';
import { createTour } from '../../lib/mech-tour.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const L = n => ALPHA[((n % 26) + 26) % 26];

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], t: 0.5, rpm: 40, lastRpm: 40, Q: null, view: 'three', goal: null,
  explode: 0, explodeTarget: 0, base: true, showLabels: !PHONE_Q.matches, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6, xray: 0, xrayTarget: 0, xrayUser: false,
};
let saverOn = false, saverTick = null, plotCache = null, saverBand = null;
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => S.Q ? -S.Q.disp[2] * Math.PI * 2 / 26 : 0,
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();

// ── machine swap ────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.id === id)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id);
    const next = { id, B, sc, PARTS: partsFor(id), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(false);
    B.parts.case.holder.visible = S.base;
    S.t = 0.5; S.goal = null;
    S.Q = sc.pose(S.t);
    stage.root.add(B.root);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    cards.reset();
    fillPanel();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = 120; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn) setView(S.view || 'three', true);
    plotCache = null;
  } finally { S.swapping = false; }
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  test: { title: 'Enigma I · test vector', kind: 'Rotors I II III · reflector B · rings AAA', lede: 'Set the rotors to AAA and type AAAAA: the lamps give BDZGO, the standard check of any Enigma model. The right rotor steps before every letter, so the same key lights a new lamp each time.' },
  double: { title: 'The double step', kind: 'Rotors I II III from ADS', lede: 'The middle rotor steps when the right rotor passes its notch (V on rotor III). On the next press, the pawl that rides on the middle rotor drops into its own notch (E on rotor II) and pushes the left rotor and the middle rotor again: ADU, ADV, AEW, BFX. An odometer never does this.' },
  barbarossa: { title: 'Barbarossa message, 1941', kind: 'Rotors II IV V · rings BUL · start BLA · ten plugs', lede: 'Part 1 of a German Army message of 7 July 1941. The machine types the cipher text and the lamps spell the plain text: AUFKL X ABTEILUNG X VON X KURTINOWA (a reconnaissance unit from Kurtinowa).' },
};
const ABOUT = {
  test: [
    ['Step first', 'A key first moves the pawls, and only at the bottom of its travel closes the circuit. So the first letter is encrypted at AAB, not at AAA.'],
    ['The path', 'Key, plugboard, entry wheel, right, middle and left rotor, reflector, then back through left, middle and right rotor, entry wheel, plugboard, lamp. Each rotor is a fixed wiring turned by its position.'],
    ['Its own inverse', 'The reflector sends the current back on a different wire. So pressing the lamp letter at the same positions lights the key letter: the same setting encrypts and decrypts. It also means no letter can become itself.'],
  ],
  double: [
    ['Three pawls', 'Pawl 1 always pushes the right rotor. Pawl 2 rides on the notch ring of the right rotor, pawl 3 on the notch ring of the middle rotor. A pawl that drops into a notch pushes the ratchet on its left.'],
    ['Why twice', 'Pawl 3 pushes the ratchet of the left rotor and, through the notch, the middle rotor too. So when the middle rotor reaches its notch, it moves again on the next press.'],
    ['The period', 'Without the double step the positions would repeat after 26³ = 17576 presses. With it they repeat after 26 · 25 · 26 = 16900.'],
  ],
  barbarossa: [
    ['Ring setting', 'The alphabet tyre and its notch turn against the wiring core. BUL (02 21 12) moves each core by that many places against the letters in the window.'],
    ['Plugboard', 'Ten cables swap ten letter pairs before and after the rotors: AV BS CG DL FU HZ IN KM OW RX. They add most of the key space, but they do not change the stepping.'],
    ['Message key', 'The operator set the start WXC, sent the message key BLA encrypted as KCH, then set the rotors to BLA for the text. The first group RFUGZ is the identification group, not cipher text.'],
  ],
};
function fillPanel() {
  const id = S.cur.id, box = $('engInfo'), I = INFO[id];
  box.classList.add('fading');
  setTimeout(() => {
    $('engTitle').textContent = I.title;
    $('engKind').textContent = I.kind;
    $('engLede').textContent = I.lede;
    const seen = new Set(), P = S.cur.PARTS;
    const ids = Object.values(S.cur.B.parts).map(q => q.info).filter(k => P[k] && !seen.has(k) && seen.add(k));
    $('partList').innerHTML = ids.map(k => `<button type="button" data-part="${k}" style="--gc:${GROUP_COLOR[P[k].group] || '#e9c27a'}"><i></i>${esc(P[k].name)}</button>`).join('');
    $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
    $('about').innerHTML = ABOUT[id].map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    fillEqs();
    box.classList.remove('fading');
  }, 200);
}
function buildPicker() {
  $('variants').innerHTML = UNITS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
  $('kbd').innerHTML = ROWS.map(r => `<div class="kr">${[...r].map(ch => `<button type="button" data-k="${ch}">${ch}</button>`).join('')}</div>`).join('');
  $('kbd').querySelectorAll('button').forEach(b => b.addEventListener('click', () => typeKey(b.dataset.k)));
}

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  three: { az: 26, el: 24, explode: 0, k: 1, at: null },
  close: { az: 12, el: 52, explode: 0, k: 0.42, at: 'window' },
  wiring: { az: 6, el: 30, explode: 0.6, k: 0.78, at: 'rotors', xray: true },
  back: { az: 152, el: 32, explode: 0, k: 0.6, at: 'pawls' },
  exploded: { az: 38, el: 24, explode: 1, k: 1.35, at: null },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name];
  const at = v.at ? S.cur.sc.keys[v.at] : S.cur.sc.box.c;
  stage.flyTo({ az: v.az, el: v.el, r: fitDist(v.k), target: new THREE.Vector3(...at), t: soft ? 1.8 : 1.4 });
  setExplode(v.explode);
  S.xrayTarget = v.xray || S.xrayUser ? 1 : 0;
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ── controls ────────────────────────────────────────────────────────────────
function setExplode(x) { S.explodeTarget = x; $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%'; }
$('explode').addEventListener('input', e => setExplode(+e.target.value));
$('assemble').addEventListener('click', () => setExplode(0));
$('burst').addEventListener('click', () => setExplode(1));
function setRpm(r) {
  r = Math.max(0, Math.min(600, r));
  if (r > 0) { S.lastRpm = r; S.goal = null; }
  S.rpm = r;
  $('rpm').value = r; $('rpmV').textContent = `${r}`;
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.rpm === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setRpm(+b.dataset.rpm)));
$('rpm').addEventListener('input', e => setRpm(+e.target.value));
$('dockPlay').addEventListener('click', () => setRpm(S.rpm ? 0 : S.lastRpm));
$('turn').addEventListener('input', e => { setRpm(0); S.goal = null; S.t = +e.target.value; });
function setShow(what, on) {
  if (what === 'base') { S.base = on; $('tBase').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.parts.case.holder.visible = on; }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
  if (what === 'xray') { S.xrayUser = on; S.xrayTarget = on || VIEWS[S.view]?.xray ? 1 : 0; $('tXray').classList.toggle('on', on); }
}
$('tBase').addEventListener('click', () => setShow('base', !S.base));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));
$('tXray').addEventListener('click', () => setShow('xray', !S.xrayUser));

// ── typing ──────────────────────────────────────────────────────────────────
// The next press gets the letter; the tape stops; the press runs to 0.75.
function typeKey(ch) {
  if (!S.cur || saverOn) return;
  ch = String(ch).toUpperCase();
  if (ALPHA.indexOf(ch) < 0) return;
  setRpm(0);
  const n = Math.max(0, Math.ceil(S.t - 0.02));
  S.cur.sc.setKey(n, ch);
  S.t = n; S.goal = n + 0.75;
  plotCache = null; hideHint();
  const b = document.querySelector(`#kbd button[data-k="${ch}"]`);
  if (b) { b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 300); }
}
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const tg = e.target && e.target.tagName;
  if (tg === 'INPUT' || tg === 'TEXTAREA') return;
  if (/^[a-zA-Z]$/.test(e.key)) { typeKey(e.key); e.preventDefault(); }
});

// ── panels: left controls, right analysis; on a phone one sheet ─────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'unit';
function placeAnalysis() {
  if (PHONE_Q.matches) { if (anaSec.parentNode !== panel) panel.appendChild(anaSec); }
  else if (anaSec.parentNode !== anaPanel) anaPanel.appendChild(anaSec);
  setAna(S.anaOpen);
  plotCache = null;
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
  document.body.classList.toggle('sheet-open', open);
  panel.querySelectorAll('.grp').forEach(el => el.classList.toggle('on', el.dataset.grp === grp));
  for (const t of tabs) { const on = open && t.dataset.grp === grp; t.classList.toggle('on', on); t.setAttribute('aria-expanded', String(on)); }
  if (open && PHONE_Q.matches) panel.scrollTop = 0;
  plotCache = null;
}
for (const t of tabs) t.addEventListener('click', () => setOpen(!(panel.classList.contains('open') && grp === t.dataset.grp), t.dataset.grp));
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
placeAnalysis();
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => { placeAnalysis(); setOpen(!e.matches); });
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
grip.addEventListener('pointerup', e => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) panel.classList.toggle('full');
  else if (dy < -40) panel.classList.add('full');
  else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
});
grip.addEventListener('pointercancel', () => { gripY = null; });
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
if (COARSE) $('hint').textContent = 'tap a letter in Type to press a key · drag to orbit · pinch to zoom';
setTimeout(hideHint, 9000);

// ── step plot ───────────────────────────────────────────────────────────────
// Three lanes (left, middle, right rotor), each the window letter 0..25
// after every press, over a window of WIN presses. A press where the middle
// rotor stepped on its own notch (the double step) gets a band, and the
// press before it (the middle rotor's first step) a tick.
const COL = { L: '#c8a6ff', M: '#e2c27a', R: '#8fb0ff', d: 'rgba(255,106,122,0.26)' };
const WIN = 56, PAGE = 40;
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; plotCache = null; }
  const g = c.getContext('2d');
  const i = Math.floor(S.t), w0 = Math.floor(i / PAGE) * PAGE;
  if (!plotCache || plotCache.w0 !== w0) {
    const sc = S.cur.sc, off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d'), padL = 18 * dpr, pad = 8 * dpr, X = k => padL + (w - padL - pad) * (k - w0 + 0.5) / WIN;
    const lane = (h - 2 * pad - 14 * dpr) / 3, top = j => pad + j * lane;
    o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    for (let k = w0; k < w0 + WIN; k++) {
      const R = sc.rec(k);
      if (R.dbl) {
        o.fillStyle = COL.d; o.fillRect(X(k) - (w - padL - pad) / WIN / 2, pad, (w - padL - pad) / WIN, 3 * lane);
        const P = sc.rec(k - 1 < 0 ? 0 : k - 1);
        if (k > 0 && P.why.includes('M')) { o.fillStyle = 'rgba(255,106,122,0.12)'; o.fillRect(X(k - 1) - (w - padL - pad) / WIN / 2, pad, (w - padL - pad) / WIN, 3 * lane); }
      }
    }
    ['L', 'M', 'R'].forEach((nm, j) => {
      o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
      o.beginPath(); o.moveTo(padL, top(j) + lane - 2 * dpr); o.lineTo(w - pad, top(j) + lane - 2 * dpr); o.stroke();
      o.fillStyle = COL[nm]; o.fillText(nm, 3 * dpr, top(j) + lane / 2 + 4 * dpr);
      o.strokeStyle = COL[nm]; o.lineWidth = 1.6 * dpr; o.beginPath();
      for (let k = w0; k < w0 + WIN; k++) {
        const v = sc.rec(k).pos[j], y = top(j) + lane - 3 * dpr - (lane - 8 * dpr) * v / 25;
        const xa = X(k) - (w - padL - pad) / WIN / 2, xb = X(k) + (w - padL - pad) / WIN / 2;
        k === w0 ? o.moveTo(xa, y) : o.lineTo(xa, y); o.lineTo(xb, y);
      }
      o.stroke();
    });
    o.fillStyle = 'rgba(141,144,166,0.9)';
    for (let k = w0; k <= w0 + WIN; k += 10) o.fillText(String(k), X(k) - 3 * dpr, h - 3 * dpr);
    $('legend').innerHTML = [['lr', 'right rotor', COL.R], ['lm', 'middle', COL.M], ['ll', 'left', COL.L], ['ld', 'double step', '#e9a0a8']].map(([k, t, cc]) => `<span class="${k}"><i style="background:${cc}"></i>${t}</span>`).join('');
    plotCache = { off, X, w0 };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const x = plotCache.X(S.t - 0.5);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 16 * dpr); g.stroke();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '', lastTape = '';
function pathText(R) {
  const a = R.a.map(L);
  return `${L(R.key)} → ${a[0]} │ R ${a[1]} M ${a[2]} L ${a[3]} │ UKW ${a[4]} │ L ${a[5]} M ${a[6]} R ${a[7]} → ${L(R.out)}`;
}
function fillNums() {
  const id = S.cur.id, u = unit(id), Q = S.Q, R = Q.R, done = Q.f >= 0.3;
  const win = (done ? R.pos : R.before).map(L).join('');
  let html = `<tr><th>${INFO[id].title}</th><th></th></tr>`
    + row('Rotor order', u.rotors.join(' · ')) + row('Rings', u.rings) + row('Plugs', u.plugs || 'none')
    + row('Windows', `<b>${win}</b>`) + row('Press', `${Q.i + 1}`) + row('Key → lamp', done ? `${L(R.key)} → ${L(R.out)}` : `${L(R.key)} → …`)
    + row('Pawls pushed', R.why.join(' ') + (R.dbl ? ' (double step)' : ''))
    + row('Contacts', done ? R.a.map(L).join(' ') : '—');
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
  $('now').innerHTML = !done ? `<b>Stepping</b><span>${R.before.map(L).join('')} → ${R.pos.map(L).join('')}${R.dbl ? ': the middle rotor steps on its own notch' : R.why.includes('M') ? ': the right rotor is at its notch' : ''}.</span>`
    : R.dbl ? `<b>Double step</b><span>The middle rotor moved again, and took the left rotor with it.</span>`
      : `<b>Current flows</b><span>${L(R.key)} lights ${L(R.out)}: ${pathText(R)}</span>`;
  // tape: the last 25 presses
  const a = Math.max(0, Q.i - 24), ks = [], os = [];
  for (let k = a; k <= Q.i; k++) { const P = S.cur.sc.rec(k), cur = k === Q.i; ks.push((k - a) % 5 === 0 && k > a ? ' ' : ''); os.push(ks[ks.length - 1]); ks.push(cur ? `<span class="cur">${L(P.key)}</span>` : L(P.key)); os.push(cur && !done ? '·' : cur ? `<span class="cur">${L(P.out)}</span>` : L(P.out)); }
  const tp = `<div class="k">key&nbsp; ${ks.join('')}</div><div class="o">lamp ${os.join('')}</div>`;
  if (tp !== lastTape) { $('tape').innerHTML = tp; lastTape = tp; }
}
function fillEqs() {
  const E = [
    ['Core offset', 's = p − r', 'window letter minus ring setting'],
    ['One rotor', "c′ = W(c + s) − s", 'absolute contact in, absolute contact out'],
    ['Machine', 'E = P R M L U L⁻¹ M⁻¹ R⁻¹ P', 'U pairs letters, so E = E⁻¹'],
    ['Stepping', 'M at notch ⇒ L+1, M+1;  R at notch ⇒ M+1', 'then R+1 on every press'],
    ['Period', '26 · 25 · 26 = 16900', 'the double step skips one middle place per cycle'],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q, R = Q.R, sc = S.cur.sc, done = Q.f >= 0.3, pos = done ? R.pos : R.before;
  const k = { posL: 0, posM: 1, posR: 2 }[key];
  if (k !== undefined) return ['Window', `${L(pos[k])}${pos[k] === sc.E.notch[k] ? ' · at its notch' : ''}`];
  switch (key) {
    case 'lamp': return ['Lamp', done ? L(R.out) : '—'];
    case 'key': return ['Key', `${L(R.key)} · press ${Q.i + 1}`];
    case 'window': return ['Windows', pos.map(L).join('')];
    case 'pawls': return ['Pushed', R.why.join(' ') + (R.dbl ? ' · double step' : '')];
    case 'path': return ['Contacts', done ? R.a.map(L).join(' ') : '—'];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const Q = S.Q, R = Q.R, done = Q.f >= 0.3;
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br><span class="lo">windows ${(done ? R.pos : R.before).map(L).join('')} · press ${Q.i + 1} · ${L(R.key)} → ${done ? L(R.out) : '…'}${R.dbl ? ' · double step' : ''}</span>`;
  $('turnV').textContent = `${Q.i + 1}`;
  const mx = Math.max(120, Math.ceil(S.t / 60) * 60 + 60);
  if (+$('turn').max !== mx) $('turn').max = mx;
  if (S.rpm || S.goal !== null) $('turn').value = S.t;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur;
  if (S.goal !== null) { S.t = Math.min(S.goal, S.t + dt * 1.6); if (S.t >= S.goal) S.goal = null; }
  else S.t += S.rpm / 60 * dt;
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  cur.B.applyExplode(S.explode);
  S.Q = cur.sc.pose(S.t);
  for (const o of S.leaving) o.sc.pose(S.t);
  const age = (now - cur.t0) / 1000, al = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (al !== cur.alpha) { cur.alpha = al; cur.B.setAlpha(Math.max(0.001, al)); cur.sc.resetXray(); }
  S.xray += (S.xrayTarget - S.xray) * Math.min(1, dt * 3);
  if (cur.alpha >= 0.999) cur.sc.xray(Math.abs(S.xray - S.xrayTarget) < 0.002 ? S.xrayTarget : S.xray);
  for (const old of S.leaving) {
    const t = (now - old.t0) / 600, kk = ease(t);
    old.B.setAlpha(Math.max(0.001, 1 - kk));
    old.B.applyExplode(Math.min(1, S.explode + 0.4 * kk));
    if (t >= 1) old.dead = true;
  }
  for (const old of S.leaving.filter(q => q.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(q => !q.dead);
  stage.frame(dt);
  cards.frame(now, dt);
  if (!saverOn) {
    readout();
    if ((numT += dt) > 0.15) { numT = 0; fillNums(); }
    drawPlot();
  } else if (saverTick) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__enigma = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna, typeKey };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(40); setExplode(0);
stage.place({ az: -40, el: 24, r: 1800, target: new THREE.Vector3(0, -10, 70) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'double');
requestAnimationFrame(frame);

// ── saver plate anchor ──────────────────────────────────────────────────────
// As on the differential page: the projected centre and radius of the
// visible meshes of the subject, in page CSS px, plus key points.
const PA = { box: new THREE.Box3(), mb: new THREE.Box3(), v: new THREE.Vector3(), c: new THREE.Vector3() };
function plateAnchor(objs, keys = []) {
  const cv = $('view'), rc = cv.getBoundingClientRect(), cam = stage.camera;
  if (!rc.width || !rc.height || cv.style.opacity === '0') return null;
  const px = w => { PA.v.copy(w).project(cam); return PA.v.z > 1 ? null : { x: rc.left + (PA.v.x + 1) / 2 * rc.width, y: rc.top + (1 - PA.v.y) / 2 * rc.height }; };
  const ms = [];
  PA.box.makeEmpty();
  for (const ob of objs) if (ob) ob.traverseVisible(m => {
    if (!m.isMesh || (m.material && m.material.opacity === 0)) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox; if (!b || b.isEmpty()) return;
    ms.push([m, b]); PA.mb.copy(b).applyMatrix4(m.matrixWorld); PA.box.union(PA.mb);
  });
  if (PA.box.isEmpty()) return null;
  const C = px(PA.box.getCenter(PA.c));
  if (!C) return null;
  let r = 0;
  for (const [m, b] of ms) for (let i = 0; i < 8; i++) {
    PA.c.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
    const q = px(PA.c); if (q) r = Math.max(r, Math.hypot(Math.max(rc.left, Math.min(rc.right, q.x)) - C.x, Math.max(rc.top, Math.min(rc.bottom, q.y)) - C.y));
  }
  if (C.x + r < rc.left || C.x - r > rc.right || C.y + r < rc.top || C.y - r > rc.bottom) return null;
  const pts = [];
  for (const k of keys) { const q = k && px(k); if (q && q.x >= rc.left && q.x <= rc.right && q.y >= rc.top && q.y <= rc.bottom) pts.push(q); }
  return { x: C.x, y: C.y, r, pts };
}

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI and tours
// each preset: the whole machine, the rotor windows, the wiring in x-ray,
// the pawls from behind, the exploded machine and close-ups of 3 parts
// (lib/mech-tour.js), then a fade to the next preset. Each step holds
// seconds/10 (at least 5 s). calm (1 = slowest) slows the typing, not the
// step time. opts.label names each step with the relations and live
// values. No exit(): the shell reloads the page.
window.snSaver = {
  enter(o = {}) {
    saverOn = true;
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const label = typeof o.label === 'function' ? o.label : () => {};
    const st = document.createElement('style');
    st.textContent = '.topbar,#panel,#anaPanel,#anaOpen,#dock,#hint,#labels,#leader,#read,.tip,#nogl,#gear{display:none!important}#stage{top:0!important;bottom:0!important}#view{cursor:none;transition:opacity 0.9s ease}';
    document.head.appendChild(st);
    setOpen(false); setAna(false); setShow('labels', false);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 2.4 - 0.8 * calm;
    const RPM = Math.round(60 - 30 * calm);
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id), first = Math.floor(rnd() * order.length);
    const canvas = $('view');
    const RULES = [['s', 'm1'], ['p', 'm2'], ['r', 'm3'], ['U', 'm4']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEX = [String.raw`E = P\,R\,M\,L\,U\,L^{-1}M^{-1}R^{-1}P`, String.raw`c' = W(c + s) - s,\quad s = p - r`];
    const EQ = ['E = P R M L U L⁻¹ M⁻¹ R⁻¹ P', 's = p − r'];
    const params = () => {
      const Q = S.Q; if (!Q) return [];
      const R = Q.R, done = Q.f >= 0.3;
      const out = [P('p', 'windows', (done ? R.pos : R.before).map(L).join(''), 'm2'), P('\\to', 'key to lamp', `${L(R.key)} → ${done ? L(R.out) : '…'}`, 'm1')];
      if (R.dbl) out.push(P('M', 'double step', 'middle rotor at its notch', 'm4'));
      return out;
    };
    const lab = (title, sub, objs) => () => ({ title, sub: typeof sub === 'function' ? sub() : sub, params: params(), tex: TEX, eq: EQ, anchor: () => plateAnchor(objs()) });
    const parts = (...ids) => () => ids.map(id => S.cur.B.parts[id]).filter(Boolean).map(q => q.holder);
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'case').map(q => q.holder);
    const STEPS = [
      { view: 'three', lab: () => lab(INFO[S.cur.id].title, INFO[S.cur.id].kind, all)() },
      { view: 'close', lab: () => lab('The rotor windows', () => `${unit(S.cur.id).rotors.join(' · ')}: the right rotor steps on every key`, parts('rotorL', 'rotorM', 'rotorR'))() },
      { view: 'wiring', lab: () => lab('The current path', 'Orange in, blue back out through reflector B', parts('rotorL', 'rotorM', 'rotorR', 'ukw', 'etw'))() },
      { view: 'back', lab: () => lab('Pawls and notches', 'At its notch the middle rotor steps twice', parts('pawl1', 'pawl2', 'pawl3', 'rotorM'))() },
      { view: 'exploded', still: true, lab: () => lab('Exploded view', INFO[S.cur.id].title, all)() },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, fill: 0.6, prefer: ['rotorM', 'pawl', 'ukw', 'rotorR', 'lamps'], skip: ['case', 'path', 'axle', 'index'] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, rules: RULES, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [];
    // the whole machine first; the other views and three close-ups in a
    // seeded order
    const makePlan = () => {
      tour.unit();
      const mid = [STEPS[1], STEPS[2], STEPS[3]];
      for (let i = mid.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [mid[i], mid[j]] = [mid[j], mid[i]]; }
      plan = [STEPS[0], ...mid, STEPS[4], ...tour.pick(3).map(focusStep)];
    };
    const show = s => {
      setRpm(s.still ? 0 : RPM);
      if (s.focus) { S.xrayTarget = 0; tour.show(s.focus); }
      else { tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded' }); }
      const l = s.lab(); lastLab = JSON.stringify(l); label(l);
    };
    const fadeSwap = async (id, then) => {
      canvas.style.opacity = '0';
      await new Promise(r => setTimeout(r, 950));
      setExplode(0); S.explode = 0;
      await swapTo(id);
      setTimeout(() => { canvas.style.opacity = '1'; then(); }, 250);
    };
    let n = 0, ord = first, stepT = 0, lastLab = '', labT = 0, now = null;
    const advance = () => {
      if (n === 0 || n >= plan.length) {
        const go = () => { makePlan(); n = 0; stepT = 0; now = plan[n++]; show(now); };
        if (now) { tour.clear(); fadeSwap(order[++ord % order.length], go); now = null; } else go();
        return;
      }
      now = plan[n++]; show(now);
    };
    window.__mechTour = tour;
    let bandFn = null, bandT = 0;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
    saverTick = dt => {
      if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { saverBand = bandFn($('view').clientHeight); } catch (e) { saverBand = null; } }
      tour.tick(dt);
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold && !S.swapping && now) { stepT = 0; advance(); }
      if (labT > 1 && now) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    (async () => { if (!S.cur || S.cur.id !== order[first]) await swapTo(order[first]); advance(); })();
    return { canvas, warmupMs: 1500 };
  },
};
