// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  main.js — roll, build, swap, panel, loop
// ────────────────────────────────────────────────────────────────────────────
//  roll() makes a spec (generator.js) from a seed, builds the movement scene
//  of ../watch-movement with options from the spec (finish palette, dial art,
//  hands, hidden parts), adds the case (cases.js) to the same builder, and
//  cross-fades from the last piece. The stage and the part cards come from
//  ../watch-movement (stage.js, cards.js). The seed and the type live in the
//  URL hash, so a link brings back the same piece.
//
//  GREP MAP
//    function roll ............ spec, build, swap
//    function sceneOpts ....... the movement scene options for a spec
//    function fillSpec ........ the Spec rows and the title
//    const VIEWS .............. camera presets
//    function ringBell ........ the alarm sound (WebAudio, on a user tap)
//    function frame ........... step, pose, fades, stage, cards
//    const xr = wireXR ........ the headset view (../watch-movement/xr.js)
//    window.snSaver ........... screensaver hook: rolls pieces and tours views
// ============================================================================
import * as THREE from 'three';
import { loadCalibre } from '../watch-movement/calibres/index.js';
import { createBuild } from '../watch-movement/kit.js';
import { createStage, ease } from '../watch-movement/stage.js';
import { createCards, esc } from '../watch-movement/cards.js';
import { wireXR } from '../watch-movement/xr.js';
import * as Gen from './generator.js';
import { caseDims } from './dims.js';
import { buildCase } from './cases/index.js';

// every calibre's scene is ../watch-movement/scenes/<id>.js
const loadScene = id => import(`../watch-movement/scenes/${id}.js`);
const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const D = Math.PI / 180;

const stage = createStage({ canvas: $('view'), panel: $('panel'), coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], rate: 1, lastRate: 1, explode: 0, explodeTarget: 0, winding: false,
  type: '', keep: { movement: false, face: false, case: false }, showCase: true, showDial: true, showLabels: false,
  lidOpen: true, lidA: 1.95, backOpen: false, backA: 0, ringing: false, wrist: true, busy: false,
};
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur && { ...S.cur, PARTS: S.cur.PARTS },
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 ? 1 : 0,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();
function nowSeconds() { const d = new Date(); return (d.getHours() % 12) * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000; }

// ── the movement scene options for a spec ──────────────────────────────────
function sceneOpts(spec, dims) {
  const m = spec.movement, F = Gen.FINISH;
  const palette = Object.assign({}, F.plate[m.plate], F.wheels[m.wheels], F.screws[m.screws], F.jewels[m.jewels], F.balance[m.balance]);
  if (m.plate === 'two-tone') palette.giltPlate = { color: '#d8b06a' };
  return { palette, opts: { noDial: dims.noDial, dialPaint: dims.paint, hands: dims.hands, hide: dims.hide } };
}

// ── roll ────────────────────────────────────────────────────────────────────
async function roll(seed = Gen.newSeed(), first = false) {
  if (S.busy) return;
  S.busy = true;
  spinDice();
  try {
    const prev = S.cur && S.cur.spec;
    const spec = Gen.makeSpec(seed, { type: S.type || undefined, keep: prev ? S.keep : {}, prev });
    const cal = await loadCalibre(spec.movement.calibre);
    const dims = caseDims(spec, cal);
    const { palette, opts } = sceneOpts(spec, dims);
    const mod = await loadScene(spec.movement.calibre);
    const caseProbe = buildCaseProbe(spec);
    const B = createBuild({ palette: { ...palette, ...caseProbe }, wear: 1 });   // a used piece: scratches and prints
    const sc = mod.build(B, cal, opts);
    const kase = buildCase(B, spec, cal, dims);
    stage.root.add(B.root);
    const state = cal.createState(nowSeconds(), 0.85);
    state.still = !(S.wrist && spec.type === 'wrist');
    const next = { spec, cal, B, sc, kase, dims, state, alpha: 0, t0: performance.now(), per: cal.periods(), PARTS: { ...cal.PARTS, ...kase.PARTS } };
    next.spread = spreadFor(next);
    B.setAlpha(0.001);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now(), e0: S.explode });
    S.cur = next;
    S.explode = first ? 0 : 1.1;
    S.lidA = S.lidOpen ? 1.95 : 0; S.backA = S.backOpen ? 1.9 : 0;
    applyShow();
    cards.reset();
    fillSpec(spec);
    stage.setShadowExtent(dims.R);
    const r = fitDistance(dims);
    if (first) stage.place({ az: 152, el: 12, r: r * 1.6, target: new THREE.Vector3() });
    stage.fitTo(r, new THREE.Vector3(0, 0, 0));
    $('tLid').hidden = !kase.has.lid; $('tBack').hidden = !kase.has.back; $('tRing').hidden = !kase.has.ring;
    $('tWrist').hidden = !(spec.type === 'wrist' && spec.movement.calibre === 'automatic');
    if (!kase.has.ring) setRing(false);
    if (!saverOn) try { history.replaceState(null, '', `#seed=${seed}${S.type ? '&type=' + S.type : ''}`); } catch (e) {}
    $('seed').textContent = seed;
  } finally { S.busy = false; }
}
// the case's own palette, decided before the build so materials match
function buildCaseProbe(spec) {
  const T = Gen.TYPES[spec.type];
  return { ...(T.palette ? T.palette(spec) : {}), gold: { color: '#f0c46a', roughness: 0.15 } };
}
const fitDistance = dims => dims.R * 4.2 * (innerWidth < innerHeight * 0.8 ? 1.35 : 1);
// The movement scenes space their layers for the watch-movement page.
// Here the whole piece, case included, comes apart, so the layers move
// further along the axis at the same slider value: at least SPREAD times,
// and enough that the full explode adds SPAN_R half-widths of depth. The
// half-width is half the smaller side of the closed piece, so a tall
// regulator with a long pendulum does not get a huge spread. A big
// drum or box case (alarm, wall, mantel) needs the second term, or the
// movement stays behind the case body.
const SPREAD = 2.6, SPAN_R = 3;
const explodeAt = (q, e) => q.B.applyExplode(e, q.sc.unit * (q.spread || SPREAD));
const box = new THREE.Box3(), sphere = new THREE.Sphere(), size = new THREE.Vector3();
// the axial depth that the full explode adds at a spread factor of 1
function spreadFor(q) {
  const depth = e => { q.B.applyExplode(e, q.sc.unit); return box.setFromObject(q.B.root).getSize(size).z; };
  const added = -depth(0) + depth(1);
  q.B.applyExplode(0, q.sc.unit);
  box.setFromObject(q.B.root).getSize(size);
  const half = Math.min(size.x, size.y) / 2;
  return added > 0 ? Math.max(SPREAD, SPAN_R * half / added) : SPREAD;
}
// Camera distance that keeps the piece in view at explode e. It measures
// the bounds at e, then puts the current explode back.
function explodedDistance(q, e) {
  explodeAt(q, e);
  box.setFromObject(q.B.root).getBoundingSphere(sphere);
  explodeAt(q, S.explode);
  // 30 degree vertical fov: a sphere of radius s fills the view at s / sin(15)
  return sphere.radius / Math.sin(15 * Math.PI / 180) * 1.08 * (innerWidth < innerHeight * 0.8 ? 1.35 : 1);
}
function spinDice() {
  for (const el of [$('roll'), $('bigRoll'), $('dockRoll')]) { el.classList.remove('spin'); void el.offsetWidth; el.classList.add('spin'); }
}

// ── panel ───────────────────────────────────────────────────────────────────
function fillSpec(spec) {
  const box = $('calInfo');
  box.classList.add('fading');
  setTimeout(() => {
    $('title').textContent = spec.face.brand;
    $('kind').textContent = `${Gen.TYPES[spec.type].name} · ${Gen.CALIBRE_NAMES[spec.movement.calibre]}`;
    $('specRows').innerHTML = Gen.describe(spec).map(([k, v], i) => `<tr style="animation-delay:${i * 40}ms"><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
    $('moveLink').href = `../watch-movement/index.html#${spec.movement.calibre}`;
    box.classList.remove('fading');
  }, 200);
}
$('types').innerHTML = '<button data-type="" type="button" class="on">Any</button>' + Object.values(Gen.TYPES).map(t => `<button data-type="${t.id}" type="button">${esc(t.name.replace(/ (watch|clock)$/, ''))}</button>`).join('');
document.querySelectorAll('#types button').forEach(b => b.addEventListener('click', () => {
  S.type = b.dataset.type;
  document.querySelectorAll('#types button').forEach(x => x.classList.toggle('on', x === b));
  roll();
}));
document.querySelectorAll('#locks button').forEach(b => b.addEventListener('click', () => {
  S.keep[b.dataset.keep] = !S.keep[b.dataset.keep];
  b.classList.toggle('on', S.keep[b.dataset.keep]);
}));
for (const id of ['roll', 'bigRoll', 'dockRoll']) $(id).addEventListener('click', () => roll());
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('copy').textContent = 'Copied'; $('copy').classList.add('done'); }
  catch (e) { $('copy').textContent = 'Copy failed'; }
  setTimeout(() => { $('copy').textContent = 'Copy link'; $('copy').classList.remove('done'); }, 1600);
});

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  dial: { az: 162, el: 10, explode: 0 },
  back: { az: 18, el: 12, explode: 0 },
  side: { az: 95, el: 14, explode: 0 },
  exploded: { az: 128, el: 18, explode: 0.85 },
};
function setView(name) {
  const v = VIEWS[name], dims = S.cur.dims;
  stage.flyTo({ az: v.az, el: v.el, r: v.explode ? Math.max(fitDistance(dims) * 1.35, explodedDistance(S.cur, v.explode)) : fitDistance(dims), target: new THREE.Vector3(0, 0, 0) });
  setExplode(v.explode);
  if (name === 'back' && S.cur.kase.has.back) setBack(true);
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
function setExplode(x) { S.explodeTarget = x; $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%'; }
$('explode').addEventListener('input', e => setExplode(+e.target.value));

function applyShow() {
  if (!S.cur) return;
  const P = S.cur.B.parts;
  for (const id of S.cur.kase.toggles) if (P[id] && !P[id].removed && !['dial', 'alarmHand'].includes(id)) P[id].holder.visible = S.showCase;
  for (const id of ['dial', 'hourHand', 'minuteHand', 'secondHand', 'alarmHand']) if (P[id] && !P[id].removed) P[id].holder.visible = S.showDial;
}
const tog = (id, key, after) => $(id).addEventListener('click', () => { S[key] = !S[key]; $(id).classList.toggle('on', S[key]); if (after) after(); applyShow(); });
tog('tCase', 'showCase'); tog('tDial', 'showDial'); tog('tLabels', 'showLabels');
$('tOrbit').addEventListener('click', () => { stage.orbit = !stage.orbit; $('tOrbit').classList.toggle('on', stage.orbit); });
$('tOrbit').classList.toggle('on', stage.orbit);
function setLid(on) { S.lidOpen = on; $('tLid').classList.toggle('on', on); $('tLid').textContent = on ? 'Close lid' : 'Open lid'; }
function setBack(on) { S.backOpen = on; $('tBack').classList.toggle('on', on); $('tBack').textContent = on ? 'Close back' : 'Open back'; }
$('tLid').addEventListener('click', () => setLid(!S.lidOpen));
$('tBack').addEventListener('click', () => setBack(!S.backOpen));
setLid(true); setBack(false);
$('tWrist').addEventListener('click', () => {
  S.wrist = !S.wrist;
  if (S.cur) S.cur.state.still = !S.wrist;
  $('tWrist').classList.toggle('on', S.wrist);
  $('tWrist').textContent = S.wrist ? 'Wrist motion' : 'On a table';
});

// ── time ────────────────────────────────────────────────────────────────────
function setRate(r) {
  if (r > 0) S.lastRate = r;
  S.rate = r;
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.rate === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setRate(+b.dataset.rate)));
$('dockPlay').addEventListener('click', () => setRate(S.rate ? 0 : S.lastRate));
const windBtn = $('wind');
windBtn.addEventListener('pointerdown', e => { e.preventDefault(); S.winding = true; windBtn.classList.add('on'); try { windBtn.setPointerCapture(e.pointerId); } catch (x) {} });
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) windBtn.addEventListener(ev, () => { S.winding = false; windBtn.classList.remove('on'); });
windBtn.addEventListener('contextmenu', e => e.preventDefault());

// ── the alarm: a synthesized twin-bell ring (only after a tap) ──────────────
let actx = null, lastStrike = 0, strikeSide = 0;
function setRing(on) {
  S.ringing = on;
  $('tRing').classList.toggle('on', on); $('tRing').textContent = on ? 'Stop alarm' : 'Ring alarm';
  if (on && !actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (on && actx && actx.state === 'suspended') actx.resume().catch(() => {});   // the tap is the gesture
}
$('tRing').addEventListener('click', () => setRing(!S.ringing));
function ringBell(side) {
  if (!actx || actx.state !== 'running') return;     // silent until the browser allows sound
  const t = actx.currentTime, f0 = side ? 1180 : 1320, out = actx.createGain();
  out.gain.value = 0.06; out.connect(actx.destination);
  for (const [k, a, dec] of [[1, 1, 0.5], [2.76, 0.5, 0.25], [5.4, 0.25, 0.12]]) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = f0 * k; g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + 0.02);
  }
}

// ── panel and dock (one group per tab on a phone) ──────────────────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')];
let grp = 'roll';
function setOpen(open, g = grp) {
  grp = g;
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open);
  panel.querySelectorAll('.grp').forEach(el => el.classList.toggle('on', el.dataset.grp === grp));
  for (const t of tabs) t.classList.toggle('on', open && t.dataset.grp === grp);
  if (open && PHONE_Q.matches) panel.scrollTop = 0;
}
for (const t of tabs) t.addEventListener('click', () => setOpen(!(panel.classList.contains('open') && grp === t.dataset.grp), t.dataset.grp));
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
grip.addEventListener('pointerup', e => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) panel.classList.toggle('full');
  else if (dy < -40) panel.classList.add('full');
  else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
});
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
if (COARSE) $('hint').textContent = 'tap a part to name it · drag to orbit · pinch to zoom';
setTimeout(hideHint, 9000);

// ── readout ─────────────────────────────────────────────────────────────────
function fmtClock(sec) {
  sec = ((sec % 43200) + 43200) % 43200;
  const h = Math.floor(sec / 3600) || 12, m = Math.floor(sec / 60) % 60, s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}`;
}
let readTick = 0;
function readout(p) {
  if (++readTick % 6) return;
  const cur = S.cur, res = Math.max(0, p.reserve);
  $('read').innerHTML = `<span class="hi">${fmtClock(p.seconds)}</span> <span class="lo">· ${esc(cur.spec.face.brand)}</span><br><span class="lo">${esc(Gen.TYPES[cur.spec.type].name)} · ${esc(Gen.CALIBRE_NAMES[cur.spec.movement.calibre])}${cur.state.stopped ? '' : ` · ${cur.cal.freq.split(' · ')[0]}`}</span>${cur.state.stopped ? ' <span class="bad">stopped · wind it</span>' : ''}`;
  $('resBar').style.width = (res / cur.cal.CAL.reserveTurns * 100).toFixed(1) + '%';
  $('resV').textContent = `${(res * cur.cal.hoursPerTurn).toFixed(1)} h`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur;
  cur.cal.step(cur.state, dt * S.rate, S.winding ? dt * 0.35 : 0);
  const p = cur.cal.pose(cur.state);
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * 3.2);
  cur.sc.pose(p, dt);
  cur.kase.pose(p, S, dt, now);
  explodeAt(cur, S.explode);
  const age = (now - cur.t0) / 1000;
  const a = REDUCED ? 1 : ease((age - 0.15) / 0.9);
  if (a !== cur.alpha) { cur.alpha = a; cur.B.setAlpha(Math.max(0.001, a)); }
  cur.B.root.scale.setScalar(1 + 0.05 * (1 - ease(age / 1.1)));
  for (const old of S.leaving) {
    const t = (now - old.t0) / 700, k = ease(t);
    explodeAt(old, old.e0 + (1.6 - old.e0) * k);
    old.B.setAlpha(Math.max(0.001, 1 - k));
    old.B.root.scale.setScalar(1 - 0.08 * k);
    if (t >= 1) old.dead = true;
  }
  for (const old of S.leaving.filter(q => q.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(q => !q.dead);
  // the alarm strikes as the hammer swings through the middle
  if (S.ringing && now - lastStrike > 66) { lastStrike = now; ringBell(strikeSide ^= 1); }
  stage.frame(dt);
  cards.frame(p, now, dt);
  readout(p);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); try { actx && actx.close(); } catch (e) {} });

// ── headset ─────────────────────────────────────────────────────────────────
// VR and AR through ../watch-movement/xr.js. Roll makes a new piece in the
// headset and places it again once it has settled (its size can change).
const xr = wireXR({
  stage, cards, $, title: 'Timepiece randomizer',
  get: () => S.cur && { ...S.cur, PARTS: S.cur.PARTS },
  getExplode: () => S.explodeTarget, setExplode, getRate: () => S.rate, setRate,
  actions: [{ label: 'Roll a new piece', run: () => { roll(); xr.replace(); } }],
});

// debug and headless checks
window.__rand = { S, stage, cards, xr, roll, setView, setExplode, Gen };

// ── boot ────────────────────────────────────────────────────────────────────
setRate(1);
setExplode(0);
const hp = new URLSearchParams((location.hash || '').slice(1));
if (Gen.TYPES[hp.get('type')]) { S.type = hp.get('type'); document.querySelectorAll('#types button').forEach(x => x.classList.toggle('on', x.dataset.type === S.type)); }
roll(hp.get('seed') || Gen.newSeed(), true);
requestAnimationFrame(frame);

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI, makes the
// canvas opaque with the stage gradient, and plays a slow cycle: roll a new
// piece and show its dial, then the exploded view, then the back. Each
// step holds seconds/5 (at least 7 s). calm (1 = slowest) slows the orbit.
// The alarm never rings and the URL hash does not change while it plays.
// The seeds come from opts.seed. No exit(): the shell reloads the page.
let saverOn = false;
window.snSaver = {
  enter(o = {}) {
    saverOn = true;
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    let sd = (o.seed >>> 0) || 1;
    const rnd = () => { sd = (sd + 0x6D2B79F5) >>> 0; let t = sd; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const A = 'abcdefghjkmnpqrstuvwxyz23456789', seed = () => Array.from({ length: 8 }, () => A[Math.floor(rnd() * A.length)]).join('');
    const st = document.createElement('style');
    st.textContent = '.topbar,#panel,#dock,#hint,#labels,#leader,#read,#bigRoll,.tip,#nogl,#gear{display:none!important}#view{cursor:none}';
    document.head.appendChild(st);
    setOpen(false);
    setRing(false);
    S.showLabels = false;
    // the canvas is alpha over the #stage gradient: draw that gradient in the scene
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    setRate(1);
    const hold = Math.max(7, (o.seconds || 60) / 5) * 1000;
    let n = 0, viewName = 'dial side', seedNow = '';
    // The plate: the piece rolled (Gen.describe, the same rows as the Spec
    // panel) and the beat of its calibre. Live amplitude once a second.
    const plate = () => {
      if (!o.label || !S.cur || S.busy) return;
      const { spec, cal, state } = S.cur, c = cal.CAL;
      o.label({
        title: spec.face.brand,
        sub: `${Gen.TYPES[spec.type].name} · seed ${seedNow} · ${viewName}`,
        lines: [
          ...Gen.describe(spec).filter(r => r[0] !== 'Type').map(([k, v]) => `${k}: ${v}`),
          `Beat: ${cal.freq}` + (state.stopped ? ' · stopped' : ` · amplitude ${(state.amp / D).toFixed(0)}°`),
        ],
        eq: [`θ(t) = A · sin(2π f t),  f = ${c.fBal} Hz`, `beats/h = 2 · 3600 · f = ${(2 * 3600 * c.fBal).toLocaleString()}`],
      });
    };
    setInterval(plate, 1000);
    async function step() {
      const s = n++ % 3;
      if (s === 0) {
        while (S.busy) await new Promise(r => setTimeout(r, 100));
        setBack(false);
        seedNow = seed();
        await roll(seedNow);
        viewName = 'dial side'; plate();
        setTimeout(() => setView('dial'), 1300);
      } else { setView(s === 1 ? 'exploded' : 'back'); viewName = s === 1 ? 'exploded view' : 'case back'; plate(); }
      setTimeout(step, hold);
    }
    step();
    return { canvas: $('view'), warmupMs: 1500 };
  },
};
