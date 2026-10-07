// ============================================================================
//  NUCLEAR BLAST EFFECTS  ·  main.js — place, burst, time, map, scene, saver
// ----------------------------------------------------------------------------
//  Pick a place (search or click the map), set the yield and the burst type,
//  see the effect radii on the map, and watch the burst in the 3D scene over
//  that place. effects.js gives every number; mapview.js draws the map;
//  world.js draws the place (City Atlas buildings and rasters, or open land,
//  or a made-up place) with the rings on the ground; blast.js the burst;
//  plots.js the plots in the Details drawer.
//
//  TIME
//    S.t is the time after the burst in seconds; 0 means armed (before).
//    Playback 'log' multiplies t by 10 every 2.5 s, so one sweep shows the
//    microsecond flash and the ten-minute cloud; '1', '0.1' and '0.01' run
//    at real speed, or slower. The slider is log10 t, 1 µs to 15 min.
//
//  GREP MAP
//    const PRESETS ............ made-up bursts for the screensaver
//    const RINGS .............. the effect rings and their colours
//    function setGZ ........... ground zero at a real place
//    function apply ........... recompute the model and the scene
//    function setMode ......... map or scene
//    function fillLegend ...... the legend overlay (ring toggles)
//    function follow .......... the camera that keeps the blast framed
//    function fillPoint ....... the numbers at the picked point
//    function frame ........... the loop
//    window.snSaver ........... the screensaver tour (made-up places only)
// ============================================================================
import * as THREE from 'three';
import * as E from './effects.js';
import { createStage } from './stage.js';
import { createWorld } from './world.js';
import { createBlast } from './blast.js';
import { createPlot, makeCurves, fmtNum, fmtTime, fmtDist } from './plots.js';
import { createMap, fmtKm } from './mapview.js';
import { loadPlaces, search, atlasNear, loadAtlasCity } from './places.js';
import * as G from './geo.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LOW = COARSE || Math.min(screen.width, screen.height) < 700;
const DEG = Math.PI / 180, TEND = 900;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ── presets ────────────────────────────────────────────────────────────────
// Bursts named by yield and height only, for scale. h: metres, or a 'best
// height' rule. The places are made up.
const PRESETS = [
  { id: 'ref', name: '100 kt airburst', kind: 'best height for 5 psi', W: 100, hob: 'opt5', place: 'metro', tod: 'day', wind: 7, dir: 20, humid: 0.4, fission: 0.5,
    cap: 'A 100 kt burst at the height that carries 5 psi farthest along the ground. Use it to compare the others.' },
  { id: 'kt15', name: '15 kt airburst', kind: '15 kt · 600 m', W: 15, h: 600, place: 'delta', tod: 'day', wind: 3, dir: 60, humid: 0.6, fission: 1,
    cap: 'A small burst 600 m up, over a low town of light, wooden buildings. Most of them fall at 3 to 5 psi.' },
  { id: 'kt21', name: '21 kt airburst', kind: '21 kt · 500 m', W: 21, h: 500, place: 'delta', tod: 'day', wind: 4, dir: 120, humid: 0.6, fission: 1,
    cap: 'A 21 kt burst 500 m up. Compare it with 15 kt: the radii grow only as the cube root of the yield.' },
  { id: 'kt21low', name: '21 kt low burst', kind: '21 kt · 30 m', W: 21, h: 30, place: 'desert', tod: 'night', wind: 5, dir: 40, humid: 0.05, fission: 1,
    cap: 'The same yield only 30 m up, over open desert at night. The fireball touches the ground, so it lifts soil into the cloud.' },
  { id: 'modern', name: '300 kt airburst', kind: 'best height for 5 psi', W: 300, hob: 'opt5', place: 'metro', tod: 'sunset', wind: 8, dir: 330, humid: 0.4, fission: 0.5,
    cap: 'A 300 kt burst at the height that carries 5 psi farthest along the ground.' },
  { id: 'mt1', name: '1 Mt airburst', kind: 'best height for 5 psi', W: 1000, hob: 'opt5', place: 'metro', tod: 'day', wind: 10, dir: 20, humid: 0.3, fission: 0.5,
    cap: 'A 1 Mt burst at the height that carries 5 psi farthest. Its cloud rises through the tropopause.' },
  { id: 'surface', name: '1 Mt surface burst', kind: '1 Mt on the ground', W: 1000, hob: 'surface', place: 'metro', tod: 'day', wind: 10, dir: 20, humid: 0.3, fission: 0.5,
    cap: 'A 1 Mt burst on the ground: a smaller blast reach than the airburst, a crater, and a cloud full of soil.' },
  { id: 'mt15', name: '15 Mt surface burst', kind: '15 Mt on the ground', W: 15000, h: 2, place: 'atoll', tod: 'day', wind: 9, dir: 80, humid: 0.85, fission: 0.67,
    cap: 'A 15 Mt burst on a coral reef. The fireball is several kilometres across and the cloud rises to about 40 km.' },
  { id: 'mt50', name: '50 Mt airburst', kind: '50 Mt · 4 km', W: 50000, h: 4000, place: 'tundra', tod: 'day', wind: 8, dir: 200, humid: 0.2, fission: 0.03,
    cap: 'A 50 Mt burst 4 km up over an arctic coast. The cloud rises to about 64 km, far into the stratosphere.' },
];

// ── rings ──────────────────────────────────────────────────────────────────
const RINGS = [
  { key: 'fireball', name: 'Fireball', col: '#ffd36b', dash: 0, what: 'largest radius of the fireball (G&D 2.127)' },
  { key: 'psi20', name: '20 psi', col: '#ff5a4f', dash: 0, what: 'heavy concrete buildings destroyed' },
  { key: 'psi5', name: '5 psi', col: '#ff9b3d', dash: 0, what: 'most houses collapse' },
  { key: 'rem500', name: '500 rem', col: '#7ee08a', dash: 0, what: 'prompt radiation dose in the open (G&D Ch. VIII)' },
  { key: 'burn3', name: '3rd° burns', col: '#ff7ab8', dash: 1, what: 'third-degree burns on bare skin, 50% (G&D Fig. 12.65)' },
  { key: 'psi1', name: '1 psi', col: '#8fc4ff', dash: 0, what: 'windows break' },
  { key: 'burn1', name: '1st° burns', col: '#ffc2a1', dash: 1, what: 'first-degree burns on bare skin, 50%' },
];

// ── the scene and the map ────────────────────────────────────────────────
const stage = createStage({ canvas: $('view'), occluders: [$('drawer')], band: () => saverBand, coarse: LOW, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const world = createWorld(stage, { maxBuildings: LOW ? 7000 : 20000 });
const blast = createBlast(stage, { low: LOW });
const placesP = loadPlaces();
const map = createMap({ canvas: $('map'), places: placesP, onPick: (lon, lat) => setGZ(lon, lat), onHover: hover, scaleInset: () => 16 });
let saverOn = false, saverBand = null, saverTick = null;

const S = {
  preset: 'ref', W: 100, hob: 'opt5', hCustom: 600, h: 0, place: 'metro', tod: 'day', wind: 7, dir: 20, V: 20, humid: 0.4, fission: 0.5,
  t: 0, playing: false, mode: 'log', view: 'follow', follow: true, pick: null, on: Object.fromEntries(RINGS.map(r => [r.key, true])), fallOn: false,
  reveal: true, labels: true, fclock: 24, sum: null, curves: null, gz: null, ui: 'map', legend: !PHONE_Q.matches, drawer: false,
};

// ── apply: the model for a new burst ─────────────────────────────────────
function heightFor(hob, W) {
  if (hob === 'surface') return 0;
  if (hob === 'opt20') return E.optimumHeight(20 * E.PSI, W);
  if (hob === 'opt5') return E.optimumHeight(5 * E.PSI, W);
  if (hob === 'opt1') return E.optimumHeight(1 * E.PSI, W);
  return S.hCustom;
}
let applyTimer = 0;
function apply(light = false) {
  S.h = heightFor(S.hob, S.W);
  const b = { W: S.W, h: S.h, V: S.V, wind: S.wind, windDir: S.dir * DEG, fission: S.fission, humid: S.humid };
  S.sum = E.summary(S.W, S.h, { vis: S.V });
  S.sum.fireballRing = E.fireballSizes(S.W, S.h).max;
  stage.setVisibility(S.V);
  world.setBurst(b, light);
  blast.set(b);
  if (!S.pick) setPick(Math.max(S.sum.psi5 * 1.25, 300) * Math.cos(-0.6), Math.max(S.sum.psi5 * 1.25, 300) * Math.sin(-0.6));
  fillRings(); fillEqs(); refreshControls();
  S.curves = null;
}
function applySoon(light) { clearTimeout(applyTimer); applyTimer = setTimeout(() => apply(light), light ? 60 : 30); }

// ── ground zero at a real place ──────────────────────────────────────────
// A City Atlas city within 30 km gives the scene its buildings, water and
// land cover; anywhere else the scene is open land at the right scale.
let gzToken = 0;
async function setGZ(lon, lat, name = null) {
  const tok = ++gzToken;
  S.gz = { lon, lat, name };
  map.setGZ(S.gz);
  S.t = 0; S.playing = false; syncPlay();
  S.pick = null;
  const P = await placesP;
  const A = atlasNear(P, lon, lat);
  let city = null;
  if (A) { try { city = await loadAtlasCity(A.id); } catch (e) { city = null; } }
  if (tok !== gzToken) return;
  map.setCity(city);
  if (city) { const L = G.toLocal(lon, lat, city.meta.lon, city.meta.lat); world.setReal(city, L.x, -L.z); }
  else world.setReal(null);
  S.gz.atlas = city ? city.meta.title : null;
  apply();
  hideHint();
}
function hover(lon, lat, x, y) {
  const tip = $('maptip');
  if (lon == null || !S.gz) { tip.hidden = true; return; }
  const r = G.distance(S.gz.lon, S.gz.lat, lon, lat), p = E.psi(E.overpressure(Math.max(r, 1), S.W, S.h));
  const Q = E.thermalFluence(Math.hypot(r, S.h), S.W, S.h, S.V);
  tip.hidden = false;
  tip.innerHTML = `${fmtKm(r)} from ground zero<br>${fmtNum(p)} psi peak · ${fmtNum(Q)} cal/cm²`;
  tip.style.left = Math.min(x + 14, $('stage').clientWidth - 190) + 'px'; tip.style.top = (y + 14) + 'px';
}

// ── controls ───────────────────────────────────────────────────────────────
const yieldText = W => W >= 1000 ? `${+(W / 1000).toPrecision(3)} Mt` : W >= 1 ? `${+W.toPrecision(3)} kt` : `${Math.round(W * 1000)} t`;
const STOPS = [[1, '1 kt'], [15, '15 kt'], [100, '100 kt'], [1000, '1 Mt'], [10000, '10 Mt'], [50000, '50 Mt']];
function refreshControls() {
  $('yield').value = Math.log10(S.W); $('yieldV').textContent = yieldText(S.W);
  $('air').classList.toggle('on', S.hob === 'opt5'); $('surface').classList.toggle('on', S.hob === 'surface');
  $('height').value = Math.sqrt(clamp(S.h / 12000, 0, 1)); $('heightV').textContent = S.h < 1 ? 'ground' : fmtDist(S.h);
  $('fission').value = S.fission; $('fissionV').textContent = Math.round(S.fission * 100) + '%';
  $('wind').value = S.wind; $('windV').textContent = `${S.wind} m/s`;
  $('windDir').value = S.dir; $('windDirV').textContent = `${S.dir}°`;
  $('vis').value = S.V; $('visV').textContent = `${S.V} km`;
  $('humid').value = S.humid; $('humidV').textContent = Math.round(S.humid * 100) + '%';
  $('tFall').classList.toggle('on', S.fallOn);
  document.querySelectorAll('#tods button').forEach(b => b.classList.toggle('on', b.dataset.tod === S.tod));
}
// made-up places, for the screensaver
function setPreset(id, keepTime = false) {
  const P = PRESETS.find(p => p.id === id); if (!P) return;
  S.preset = id; S.W = P.W; S.hob = P.hob || 'custom'; if (P.h != null) S.hCustom = P.h;
  S.wind = P.wind; S.dir = P.dir; S.humid = P.humid; S.fission = P.fission;
  S.gz = null;
  if (world.place !== P.place) { S.place = P.place; world.setPlace(P.place); }
  setTOD(P.tod);
  S.pick = null;
  apply();
  if (!keepTime) { S.t = 0; S.playing = false; syncPlay(); }
}
function setTOD(tod) { S.tod = tod; stage.setTOD(tod); refreshControls(); }
function buildStops() {
  const lo = -1, hi = 4.699;
  $('stops').innerHTML = STOPS.map(([w, t]) => `<button type="button" data-w="${w}" style="left:${(Math.log10(w) - lo) / (hi - lo) * 100}%">${t}</button>`).join('');
  $('stops').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { S.W = +b.dataset.w; apply(); }));
}
$('yield').addEventListener('input', e => { S.W = Math.pow(10, +e.target.value); $('yieldV').textContent = yieldText(S.W); applySoon(true); });
$('yield').addEventListener('change', () => apply());
$('air').addEventListener('click', () => { S.hob = 'opt5'; apply(); });
$('surface').addEventListener('click', () => { S.hob = 'surface'; apply(); });
$('height').addEventListener('input', e => { S.hob = 'custom'; S.hCustom = Math.pow(+e.target.value, 2) * 12000; $('heightV').textContent = fmtDist(S.hCustom); applySoon(true); });
$('height').addEventListener('change', () => apply());
$('fission').addEventListener('input', e => { S.fission = +e.target.value; $('fissionV').textContent = Math.round(S.fission * 100) + '%'; applySoon(true); });
$('fission').addEventListener('change', () => apply());
$('wind').addEventListener('input', e => { S.wind = +e.target.value; $('windV').textContent = `${S.wind} m/s`; applySoon(true); });
$('wind').addEventListener('change', () => apply());
$('windDir').addEventListener('input', e => { S.dir = +e.target.value; $('windDirV').textContent = `${S.dir}°`; applySoon(true); });
$('windDir').addEventListener('change', () => apply());
$('vis').addEventListener('input', e => { S.V = +e.target.value; $('visV').textContent = `${S.V} km`; applySoon(true); });
$('vis').addEventListener('change', () => apply());
$('humid').addEventListener('input', e => { S.humid = +e.target.value; $('humidV').textContent = Math.round(S.humid * 100) + '%'; blast.burst && (blast.burst.humid = S.humid); });
$('tFall').addEventListener('click', () => { S.fallOn = !S.fallOn; fillRings(); refreshControls(); });
document.querySelectorAll('#tods button').forEach(b => b.addEventListener('click', () => setTOD(b.dataset.tod)));
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => { setMode('scene'); setView(b.dataset.view); }));
$('fclock').addEventListener('input', e => { S.fclock = +e.target.value; $('fclockV').textContent = S.fclock >= 24 ? 'H+1 map' : `${S.fclock.toFixed(1)} h`; });
$('fclockV').textContent = 'H+1 map';

// ── search ───────────────────────────────────────────────────────────────
let hits = [], hitI = 0;
function showResults() {
  const ul = $('results');
  ul.hidden = !hits.length;
  ul.innerHTML = hits.map((h, i) => `<li role="option" data-i="${i}" class="${i === hitI ? 'on' : ''}"><b>${esc(h.name)}</b><span>${esc(h.country)}</span>${h.atlas ? '<i>3D CITY</i>' : ''}</li>`).join('');
  ul.querySelectorAll('li').forEach(li => li.addEventListener('pointerdown', e => { e.preventDefault(); choose(hits[+li.dataset.i]); }));
}
function choose(h) {
  if (!h) return;
  $('search').value = h.name; hits = []; showResults(); $('search').blur();
  setGZ(h.lon, h.lat, h.name);
  map.fit(h.lon, h.lat, Math.max(heightFor(S.hob, S.W) ? E.summary(S.W, heightFor(S.hob, S.W)).psi1 : 3000, 1500));
  if (S.ui !== 'map') setMode('map');
}
$('search').addEventListener('input', async e => { const P = await placesP; hits = search(P, e.target.value, 8); hitI = 0; showResults(); });
$('search').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { hitI = Math.min(hits.length - 1, hitI + 1); showResults(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { hitI = Math.max(0, hitI - 1); showResults(); e.preventDefault(); }
  else if (e.key === 'Enter') choose(hits[hitI]);
  else if (e.key === 'Escape') { hits = []; showResults(); }
});
$('search').addEventListener('blur', () => setTimeout(() => { hits = []; showResults(); }, 150));

// ── map or scene ─────────────────────────────────────────────────────────
function setMode(m) {
  S.ui = m;
  document.body.classList.toggle('mode-map', m === 'map'); document.body.classList.toggle('mode-scene', m === 'scene');
  $('modeMap').classList.toggle('on', m === 'map'); $('modeScene').classList.toggle('on', m === 'scene');
  map.visible = m === 'map'; map.redraw();
  $('hint').textContent = m === 'map' ? (COARSE ? 'tap the map to set ground zero · drag to pan · pinch to zoom' : 'click the map to set ground zero · drag to pan · scroll to zoom')
    : (COARSE ? 'drag to orbit · pinch to zoom · tap the ground to read the effects there' : 'drag to orbit · scroll to zoom · click the ground to read the effects there');
  if (m === 'scene' && S.follow) { fol.r = stage.dist(); fol.y = stage.controls.target.y; }
}
$('modeMap').addEventListener('click', () => setMode('map'));
$('modeScene').addEventListener('click', () => setMode('scene'));

// ── time ─────────────────────────────────────────────────────────────────
function syncPlay() {
  const armed = S.t <= 0;
  $('play').textContent = S.playing ? 'Pause' : armed ? 'Detonate' : S.t >= TEND ? 'Replay' : 'Play';
}
function play() {
  if (S.playing) { S.playing = false; syncPlay(); return; }
  if (S.t <= 0 || S.t >= TEND) S.t = 1e-6;
  S.playing = true; syncPlay(); hideHint();
}
$('play').addEventListener('click', play);
$('reset').addEventListener('click', () => { S.t = 0; S.playing = false; syncPlay(); stage.exposure = stage.expoTarget = 1; map.setFront(0); });
$('tslider').addEventListener('input', e => { S.playing = false; syncPlay(); S.t = Math.pow(10, +e.target.value); });
$('rate').addEventListener('change', e => { S.mode = e.target.value; });
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return; if (e.code === 'Space' && !saverOn) { e.preventDefault(); play(); } });

// ── the Details drawer and the legend ────────────────────────────────────
const drawer = $('drawer');
function setDrawer(open) {
  S.drawer = open;
  drawer.classList.toggle('open', open);
  if (!open) drawer.classList.remove('full');
  $('detailsBtn').setAttribute('aria-expanded', String(open));
}
$('detailsBtn').addEventListener('click', () => setDrawer(!S.drawer));
$('drawerClose').addEventListener('click', () => setDrawer(false));
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
grip.addEventListener('pointerup', e => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) drawer.classList.toggle('full');
  else if (dy < -40) drawer.classList.add('full');
  else if (dy > 40) { if (drawer.classList.contains('full')) drawer.classList.remove('full'); else setDrawer(false); }
});
grip.addEventListener('pointercancel', () => { gripY = null; });
function setLegend(on) { S.legend = on; $('legend').hidden = !on; $('legendBtn').setAttribute('aria-expanded', String(on)); }
$('legendBtn').addEventListener('click', () => setLegend(!S.legend));
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
setTimeout(hideHint, 12000);

// ── camera: follow and fixed views ───────────────────────────────────────
const V3 = THREE.Vector3;
const sph = new THREE.Spherical(), tmpV = new V3();
// Follow: the subject radius is the larger of the fireball, the shock front
// (until it passes the 1 psi ring) and the cloud; the target slides from
// the fireball to the middle of the cloud.
function subject(t) {
  const sum = S.sum, I = blast.info;
  if (t <= 0 || !I.R) return { L: Math.max(sum.psi5 * 1.4, 900), y: Math.max(60, Math.min(S.h, sum.psi5) * 0.4) };
  const front = Math.min(I.Rs, sum.psi1 * 1.15);
  const top = I.top || 0;
  const L = Math.max(I.R * 4, front * 1.05, top * 0.62, (I.cap || 0) * (I.top > 0 ? 1.15 : 0), 60);
  const y = front > S.h * 0.8 || top > I.fbY + I.R * 2 ? Math.max(L * 0.28, Math.min(I.fbY, top * 0.52)) : I.fbY;
  return { L, y };
}
const fol = { r: 3000, y: 300 };
function follow(dt, t) {
  const s = subject(t), c = stage.controls;
  const wantR = clamp(s.L * 2.9, 25, 4e5), wantY = s.y;
  const k = 1 - Math.exp(-dt * (stage.dragging ? 1.2 : 2.6));
  fol.r = Math.exp(Math.log(fol.r) + (Math.log(wantR) - Math.log(fol.r)) * k);
  fol.y += (wantY - fol.y) * k;
  sph.setFromVector3(tmpV.copy(stage.camera.position).sub(c.target));
  c.target.set(0, fol.y, 0);
  sph.radius = fol.r;
  stage.camera.position.setFromSpherical(sph).add(c.target);
}
function sceneSize() { const s = S.sum; return { ring: Math.max(s.psi1, s.burn1), top: E.cloudTopFinal(S.W) }; }
function setView(name) {
  S.view = name; S.follow = name === 'follow';
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  const Z = sceneSize(), t = Math.max(S.t, 0);
  if (name === 'follow') { fol.r = stage.dist(); fol.y = stage.controls.target.y; return; }
  if (name === 'wide') stage.flyTo({ az: 35, el: 9, r: Math.max(Z.top, Z.ring) * 2.6, target: new V3(0, Z.top * 0.38, 0) });
  if (name === 'top') stage.flyTo({ az: 0, el: 88, r: Math.min(4e5, Z.ring * 2.9), target: new V3(0, 0, 0) });
  if (name === 'street') {
    const rs = clamp(S.sum.psi5 * 1.15, 500, 3e4), ty = t > 0 ? clamp((blast.info.top || 1000) * 0.45, 150, 2e4) : clamp(S.h * 0.6 + 120, 120, 3000);
    stage.flyTo({ az: 210, el: -Math.atan2(ty - 3, rs) / DEG, r: Math.hypot(rs, ty - 3), target: new V3(0, ty, 0) });
  }
  if (name === 'cloud') { const I = blast.info, cy = t > 0 ? (I.top || Z.top) * 0.75 : Z.top * 0.7, R = t > 0 ? (I.cap || 1000) : E.cloudRadius(S.W); stage.flyTo({ az: 60, el: 6, r: R * 3.4, target: new V3(0, cy, 0) }); }
  if (name === 'fallout') {
    // the fallout layer is opt-in: this view turns it on
    if (!S.fallOn) { S.fallOn = true; fillRings(); }
    const f = world.fall, d = S.dir * DEG;
    if (!f) { stage.flyTo({ az: 0, el: 88, r: Z.ring * 2.9, target: new V3(0, 0, 0) }); return; }
    const L = Math.min(f.x1, 2e6) * 0.5;
    stage.flyTo({ az: -S.dir + 90 + 25, el: 58, r: L * 2.3, target: new V3(Math.cos(d) * L, 0, Math.sin(d) * L) });
  }
}
stage.onWheel = () => { if (S.follow && !saverOn) setView('free'); };
stage.onStart = () => hideHint();

// ── picking the ground ───────────────────────────────────────────────────
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new V3(0, 1, 0), 0), hit = new V3();
let downAt = null;
$('view').addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY, performance.now()]; });
$('view').addEventListener('pointerup', e => {
  if (!downAt || saverOn) return;
  const [x, y, t0] = downAt; downAt = null;
  if (Math.hypot(e.clientX - x, e.clientY - y) > 6 || performance.now() - t0 > 600) return;
  pickAt(e.clientX, e.clientY);
});
function pickAt(cx, cy) {
  const r = $('view').getBoundingClientRect();
  ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  if (!ray.ray.intersectPlane(plane, hit)) return;
  setPick(hit.x, hit.z);
}
function setPick(x, z) {
  S.pick = { x, z };
  world.gU.uPick.value = saverOn ? 0 : 1; world.gU.uPickP.value.set(x, z);   // no marker in the saver
  S.curves = null;
}

// ── the point readout ────────────────────────────────────────────────────
const damage = p => p >= 20 ? 'Heavily built concrete buildings are destroyed or badly damaged.' : p >= 10 ? 'Reinforced concrete buildings are badly damaged; most other buildings are destroyed.'
  : p >= 5 ? 'Most houses and many commercial buildings collapse.' : p >= 3 ? 'Houses collapse or are badly damaged; serious injuries are common.'
  : p >= 1 ? 'Window glass breaks; light damage to houses; injuries from flying glass.' : 'Little damage to buildings; some windows may break.';
function pointValues() {
  const { x, z } = S.pick, r = Math.hypot(x, z), W = S.W, h = S.h, D = Math.hypot(r, h);
  const p = E.overpressure(r, W, h), q = E.dynamicPressure(r, W, h), ta = E.arrivalTime(r, W, h), dur = E.positiveDuration(r, W, h);
  const Q = E.thermalFluence(D, W, h, S.V), dose = E.promptDose(D, W);
  const d = S.dir * DEG, xd = x * Math.cos(d) + z * Math.sin(d), yd = -x * Math.sin(d) + z * Math.cos(d);
  const R1 = E.falloutRate(xd, yd, W, S.wind, S.fission, h), fa = E.falloutArrival(Math.hypot(xd, yd), W, S.wind);
  return { r, D, p, q, ta, dur, Q, dose, R1, fa, wind: E.windSpeed(p) };
}
let lastNums = '';
function fillPoint() {
  if (!S.pick) return;
  const v = pointValues(), W = S.W, psi = E.psi(v.p);
  const deg = v.Q >= E.burnThreshold(3, W) ? 3 : v.Q >= E.burnThreshold(2, W) ? 2 : v.Q >= E.burnThreshold(1, W) ? 1 : 0;
  const row = (k, val) => `<tr><td>${k}</td><td>${val}</td></tr>`;
  let html = `<tr><th>${fmtDist(v.r)} from ground zero</th><th></th></tr>`
    + row('Shock arrives', fmtTime(v.ta)) + row('Peak overpressure', `${fmtNum(v.p / 1000)} kPa · ${fmtNum(psi)} psi`)
    + row('Peak dynamic pressure', `${fmtNum(E.psi(v.q))} psi`) + row('Peak wind', `${fmtNum(v.wind)} m/s · ${fmtNum(v.wind * 3.6)} km/h`)
    + row('Positive phase', fmtTime(v.dur)) + row('Thermal exposure', `${fmtNum(v.Q)} cal/cm² · ${fmtNum(v.Q * 4.184)} J/cm²`)
    + row('Burns, bare skin', deg ? `${deg}${['', 'st', 'nd', 'rd'][deg]} degree likely` : 'none expected')
    + row('Prompt radiation', `${fmtNum(v.dose)} rem`);
  if (!S.fallOn) { /* the fallout layer is off: no fallout rows */ }
  else if (world.fall && v.R1 > 0) html += row('Fallout at H+1', `${fmtNum(v.R1)} rad/h`) + row('Fallout arrives', `${fmtNum(v.fa)} h`) + row('Dose, 24 h outdoors', `${fmtNum(E.falloutDose(v.R1, v.fa, v.fa + 24))} rad`);
  else if (world.fall) html += row('Fallout', 'outside the drawn plume');
  else html += row('Local fallout', 'little: the fireball does not touch the ground');
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
  // the headline at this moment
  const t = S.t;
  let head, sub;
  if (t <= 0) { head = `${fmtNum(psi)} psi`; sub = damage(psi); }
  else if (t < v.ta) { head = `Shock in ${fmtTime(v.ta - t)}`; sub = `The flash arrives first: ${fmtNum(v.Q * E.pulseEnergy(t / E.thermalPeakTime(W)))} of ${fmtNum(v.Q)} cal/cm² so far.`; }
  else { const pn = E.friedlander(t, v.ta, v.dur, psi); head = pn > 0.01 ? `${fmtNum(pn)} psi now` : pn < -0.01 ? `${fmtNum(pn)} psi (suction)` : 'Shock has passed'; sub = damage(psi); }
  $('now').innerHTML = `<b>${esc(head)}</b><span>${esc(sub)}</span>`;
  return { v, psi, deg };
}

// ── legend, ring labels and uniforms ─────────────────────────────────────
function ringRadius(key) { return key === 'fireball' ? S.sum.fireballRing : S.sum[key] || 0; }
function ringArrival(key) {
  const R = ringRadius(key), W = S.W, h = S.h;
  if (key.startsWith('psi')) return E.arrivalTime(R, W, h);
  if (key.startsWith('burn')) return E.thermalPeakTime(W) * 3;
  if (key === 'rem500') return 0.05;
  return E.tFireballMax(W);
}
function fillRings() {
  const g = world.gU;
  fillLegend();
  RINGS.forEach((r, i) => { g.uRingR.value[i] = ringRadius(r.key); g.uRingC.value[i].set(r.col).convertSRGBToLinear(); g.uRingDash.value[i] = r.dash; });
  map.setRings(RINGS.map(r => ({ name: r.name, col: r.col, dash: r.dash, R: ringRadius(r.key), on: S.on[r.key] })));
  $('labels').innerHTML = RINGS.map(r => `<div class="rl" data-ring="${r.key}" style="--c:${r.col}">${esc(r.name)} · ${fmtKm(ringRadius(r.key))}</div>`).join('') + '<div class="pin" id="pinLab"></div>';
  const f = world.fall;
  $('fallNote').textContent = f
    ? `Idealised H+1 dose rates (G&D Table 9.93) for ${fmtNum(S.wind)} m/s winds toward ${S.dir}°, ${Math.round(S.fission * 100)}% fission, drawn in the 3D scene only. Lines at each power of ten. The clock grows the plume as the cloud drifts.`
    : `No local fallout: the burst is above ${fmtDist(E.falloutCeiling(S.W))}, the height below which the fireball picks up soil (G&D 2.128).`;
  ringLabelEls = [...$('labels').querySelectorAll('.rl')];
}
// the legend overlay: one row per ring, a click turns the ring on or off
function fillLegend() {
  $('legend').innerHTML = RINGS.map(r => `<div class="lr${S.on[r.key] ? '' : ' off'}" data-ring="${r.key}" title="${esc(r.what)}"><i class="sw${r.dash ? ' dash' : ''}" style="--c:${r.col}"></i><b>${esc(r.name)}</b><span>${ringRadius(r.key) > 0 ? fmtKm(ringRadius(r.key)) : 'not reached'}</span></div>`).join('')
    + `<div class="lnote">${yieldText(S.W)} ${S.h < 1 ? 'on the ground' : 'at ' + fmtDist(S.h)}. Radii from Glasstone &amp; Dolan scaling, for flat, open ground.</div>`;
  $('legend').querySelectorAll('.lr').forEach(el => el.addEventListener('click', () => { S.on[el.dataset.ring] = !S.on[el.dataset.ring]; fillRings(); }));
}
let ringLabelEls = [];
const projV = new V3();
function project(x, y, z) {
  projV.set(x, y, z).project(stage.camera);
  const c = $('view'), r = c.getBoundingClientRect();
  return projV.z > 1 ? null : { x: (projV.x + 1) / 2 * r.width, y: (1 - projV.y) / 2 * r.height };
}
function updateRings(t) {
  const g = world.gU, armed = t <= 0;
  RINGS.forEach((r, i) => {
    let a = S.on[r.key] ? 1 : 0;
    if (S.reveal && !armed) a *= smooth(0, 0.15, Math.log10(Math.max(t, 1e-7) / ringArrival(r.key)) + 0.1);
    g.uRingA.value[i] = a * (ringRadius(r.key) > 0 ? 1 : 0);
  });
  // fallout: the H+1 map, grown by the clock as the cloud drifts
  g.uFallOn.value = S.fallOn && world.fall ? 1 : 0;
  g.uFallFront.value = S.fclock >= 24 ? 1e9 : E.cloudRadius(S.W) + S.wind * S.fclock * 3600;
  // labels at the ring edges, on the side toward the camera's right
  if (S.labels && !saverOn && S.ui === 'scene') {
    const cam = stage.camera.position, a0 = Math.atan2(cam.z, cam.x) + Math.PI / 2 * 0.7;
    let lastY = -1e9;
    const order = RINGS.map((r, i) => i).sort((p, q) => ringRadius(RINGS[p].key) - ringRadius(RINGS[q].key));
    for (const i of order) {
      const r = RINGS[i], el = ringLabelEls[i], R = ringRadius(r.key);
      const P = g.uRingA.value[i] > 0.3 && R > 0 ? project(R * Math.cos(a0), 0, R * Math.sin(a0)) : null;
      const vis = P && P.x > 10 && P.y > 10 && P.x < innerWidth - 10 && Math.abs(P.y - lastY) > 16;
      el.style.opacity = vis ? 1 : 0;
      if (vis) { el.style.transform = `translate(${P.x}px,${P.y}px) translate(-50%,-120%)`; lastY = P.y; }
    }
  } else ringLabelEls.forEach(el => { el.style.opacity = 0; });
  const pin = $('pinLab');
  if (pin && S.pick && !saverOn) {
    const P = project(S.pick.x, 0, S.pick.z);
    pin.style.opacity = P ? 1 : 0;
    if (P) pin.style.transform = `translate(${P.x}px,${P.y}px) translate(-50%,-140%)`;
  }
}

// ── relations and about ──────────────────────────────────────────────────
function fillEqs() {
  const W = S.W, F = E.fireballSizes(W, S.h);
  const E2 = [
    ['Cube-root scaling', 'd = d₁ W^⅓ ,  t = t₁ W^⅓', 'distances and times of a 1 kt burst (G&D 3.60–3.63)'],
    ['Surface burst', 'acts as a free-air burst of 2 W', 'the ground reflects the blast (G&D 3.34)'],
    ['Reflection', 'p_r = 2p (7P₀ + 4p) / (7P₀ + p)', '2p for weak shocks, 8p for strong ones (G&D 3.56)'],
    ['Dynamic pressure', 'q = 5p² / 2(7P₀ + p)', 'the wind behind the front (G&D 3.55)'],
    ['Fireball', 'R_max ≈ 2 × 100 W^0.4 ft', `${fmtDist(F.max)} for this burst (G&D 2.127)`],
    ['Thermal pulse', 't_max = 0.0417 W^0.44 s,  P_max = 3.18 W^0.56 kt/s', `${fmtTime(E.thermalPeakTime(W))} for this burst (G&D 7.85)`],
    ['Radiant exposure', 'Q = f W τ / 4πD²,  f = 0.35 (air), 0.18 (contact)', 'cal/cm², 1 kt = 10¹² cal (G&D 7.96, 7.101)'],
    ['Fallout decay', 'R(t) = R₁ t^−1.2', 'ten times less for each sevenfold time (G&D 9.15)'],
  ];
  $('eqs').innerHTML = E2.map(([hh, eq, sub]) => `<div class="eq"><span>${esc(hh)}</span><div>${esc(eq)}</div><em>${esc(sub)}</em></div>`).join('');
}
$('about').innerHTML = [
  ['What this is', 'An educational view of the effect radii of one nuclear explosion, built from the public scaling laws of S. Glasstone and P. J. Dolan, <i>The Effects of Nuclear Weapons</i> (3rd ed., US DoD and ERDA, 1977), cited as G&amp;D. It shows effects and scale only: no population, no casualty counts, and nothing on how weapons are made or used.'],
  ['The model', 'Blast: the DNA 1-kt free-air standard and height-of-burst fit (via NRDC 2001; equations read from the MIT-licensed <i>glasstone</i> library by E. Geist), checked against the worked examples of G&amp;D Ch. III. Thermal, fireball, cloud and fallout: G&amp;D Ch. II, VII and IX. Radiation: a fit to the summary values of G&amp;D Figs. 8.33 and 8.64. <code>tests.mjs</code> checks the model and the map scale.'],
  ['What it leaves out', 'The ground is flat and ideal; buildings and hills do not shield one another; the air is clear apart from the visibility you set; doses are for a person in the open. Real cities, weather and terrain change every number. The fallout pattern is the idealised one of G&amp;D 9.93. The cloud is drawn to the G&amp;D rise and size, not simulated.'],
  ['Map data', 'Coastlines, borders and place names: <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> (public domain). The 21 cities with buildings in 3D come from the City Atlas page: © OpenStreetMap contributors and Overture Maps Foundation, under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a>; land cover ESA WorldCover 2021 (CC BY 4.0). Elsewhere the scene is open land.'],
  ['Inspiration', 'Made in the spirit of <a href="https://nukesimulation.com" target="_blank" rel="noopener">nukesimulation.com</a>; this page shares no code, art or text with it. The classic of the genre is Alex Wellerstein\'s <a href="https://nuclearsecrecy.com/nukemap/" target="_blank" rel="noopener">NUKEMAP</a> (2012–).'],
].map(([hh, t]) => `<p><b>${hh}.</b> ${t}</p>`).join('');

// ── plots ────────────────────────────────────────────────────────────────
const kmFmt = v => v >= 1000 ? (v / 1000 >= 10 ? (v / 1000).toFixed(0) : +(v / 1000).toPrecision(2)) + ' km' : Math.round(v) + ' m';
const psiFmt = v => (Math.abs(v) >= 1000 ? +(v / 1000).toPrecision(2) + 'k' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? +v.toPrecision(3) : +v.toPrecision(2)) + ' psi';
const tFmt = v => fmtTime(Math.max(v, 1e-9));
const plots = {
  press: createPlot($('plotPress'), { xlog: true, ylog: true, xfmt: kmFmt, yfmt: psiFmt }),
  wave: createPlot($('plotWave'), { xfmt: v => fmtTime(Math.max(0, v)), yfmt: psiFmt }),
  thermal: createPlot($('plotThermal'), { xlog: true, xfmt: tFmt, yfmt: (v, tip) => tip ? (v * 100).toFixed(0) + '%' : v.toFixed(1) }),
  radius: createPlot($('plotRadius'), { xlog: true, ylog: true, xfmt: tFmt, yfmt: kmFmt }),
  cloud: createPlot($('plotCloud'), { xfmt: v => v >= 60 ? (v / 60).toFixed(0) + ' min' : v.toFixed(0) + ' s', yfmt: v => +v.toPrecision(3) + ' km' }),
};
function drawPlots(t) {
  if (!S.drawer) return;
  if (!S.curves && S.pick) {
    S.curves = makeCurves({ W: S.W, h: S.h, V: S.V }, Math.hypot(S.pick.x, S.pick.z));
    for (const k in plots) plots[k].set(S.curves[k]);
  }
  if (!S.curves) return;
  const tt = Math.max(t, 1e-9), I = blast.info;
  plots.press.draw(t > 0 ? I.rFront : null);
  plots.wave.draw(t > 0 ? t : null);
  plots.thermal.draw(t > 0 ? tt : null);
  plots.radius.draw(t > 0 ? tt : null);
  plots.cloud.draw(t > 0 ? t : null);
}

// ── readout and phase ────────────────────────────────────────────────────
function phase(t) {
  const W = S.W, I = blast.info;
  if (t <= 0) return 'armed';
  if (t < E.tThermalMin(W)) return 'first flash';
  if (t < E.thermalPeakTime(W) * 4) return 'thermal pulse';
  if (I.rFront < S.sum.psi1) return `shock ${fmtDist(I.rFront)} out, ${fmtNum(E.psi(E.overpressure(I.rFront, W, S.h)))} psi`;
  if (t < 480) return `cloud rising, top ${fmtDist(I.top)}`;
  return `cloud near its top, ${fmtDist(I.top)}`;
}
let readT = 0;
function placeName() {
  if (S.gz) return S.gz.name || `${Math.abs(S.gz.lat).toFixed(3)}° ${S.gz.lat >= 0 ? 'N' : 'S'}, ${Math.abs(S.gz.lon).toFixed(3)}° ${S.gz.lon >= 0 ? 'E' : 'W'}`;
  return S.ui === 'scene' ? 'Made-up city' : 'No place picked';
}
function readout(t, dt) {
  if ((readT += dt) < 0.12) return; readT = 0;
  const where = S.gz ? (S.gz.atlas ? '3D buildings' : 'open land in 3D') : COARSE ? 'search, or tap the map' : 'search, or click the map';
  $('read').innerHTML = `<span class="hi">${esc(placeName())}</span> <span class="lo">· ${yieldText(S.W)} · ${S.h < 1 ? 'surface' : fmtDist(S.h) + ' up'}</span><br><span class="lo">${t > 0 ? 't = ' + fmtTime(t) + ' · ' + esc(phase(t)) : esc(where)}</span>`;
  $('tlabel').textContent = t > 0 ? fmtTime(t) : 'armed';
  if (document.activeElement !== $('tslider')) $('tslider').value = t > 0 ? Math.log10(t) : -6;
  const r = fillPoint();
  const pin = $('pinLab');
  if (pin && r) pin.textContent = `${fmtNum(r.psi)} psi${r.deg ? ` · ${r.deg}° burn` : ''}`;
}

// ── loop ─────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, clock = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
  stage.U.uClock.value = clock;
  if (S.playing) {
    S.t = S.mode === 'log' ? S.t * Math.pow(10, dt / 2.5) : S.t + dt * +S.mode;
    if (S.t >= TEND) { S.t = TEND; S.playing = false; syncPlay(); }
  }
  if (saverTick) saverTick(dt);
  const t = S.t;
  if (S.ui === 'map' && !saverOn) {
    // the map: the shock front while it is within the 1 psi ring
    const f = t > 0 ? Math.sqrt(Math.max(0, E.shockRadius(t, S.W, S.h < 1) ** 2 - S.h * S.h)) : 0;
    map.setFront(f < S.sum.psi1 * 1.2 ? f : 0);
    map.frame();
    readout(t, dt); drawPlots(t);
    return;
  }
  world.setTime(t, t > 0);
  blast.update(t, dt);
  const I = blast.info;
  world.gU.uFront.value = t > 0 ? I.rFront || 0 : 0;
  world.gU.uFrontPsi.value = t > 0 && I.rFront ? E.psi(E.overpressure(I.rFront, S.W, S.h)) : 0;
  if (S.follow && !stage.fly) follow(dt, t);
  stage.frame(dt);
  // the camera stays above the ground
  if (stage.camera.position.y < 2) stage.camera.position.y = 2;
  updateRings(t);
  if (!saverOn) { readout(t, dt); drawPlots(t); }
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__nb = { S, stage, world, blast, E, map, setPreset, setView, play, setPick, apply, setGZ, setMode, setDrawer, choose: q => placesP.then(P => choose(search(P, q, 1)[0])), plots, follow: () => fol };

// ── boot ─────────────────────────────────────────────────────────────────
buildStops();
world.setPlace('metro');
setPreset('ref');
setLegend(S.legend);
setDrawer(false);
setMode('map');
stage.place({ az: 35, el: 14, r: Math.max(S.sum.psi5 * 4, 2500), target: new V3(0, 200, 0) });
fol.r = stage.dist(); fol.y = 200;
syncPlay();
requestAnimationFrame(frame);

// ── screensaver ──────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI and plays
// a seeded shuffle of neutral physics shots over the made-up places, a cut
// every 5-12 s (calm 1 = the longest):
//   rise ..... a wide shot of the cloud going up, day, sunset or night
//   shock .... a raised camera over the city; the shock crosses it, slowed
//   flash .... the fireball close: from the first minimum to its full size
// The saver draws no rings, no fallout and no dose: the ground decals are
// off. Each shot names itself on the plate with the yield, its numbers and
// a real extract of the scaling function behind it. No exit(): the shell
// reloads the page.
window.snSaver = {
  enter(o = {}) {
    saverOn = true;
    const calm = clamp(o.calm ?? 0.7, 0, 1);
    let seed = (o.seed >>> 0) || ((Math.random() * 4294967296) >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let x = seed; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    const pick = a => a[Math.floor(rnd() * a.length)];
    const label = typeof o.label === 'function' ? o.label : () => {};
    const st = document.createElement('style');
    st.textContent = '.topbar,#bar,#drawer,#map,#legend,#legendBtn,#maptip,#hint,#labels,#read,#nogl{display:none!important}#stage{top:0!important;bottom:0!important}#view{visibility:visible!important;cursor:none;transition:opacity 0.8s ease}';
    document.head.appendChild(st);
    // made-up places only: never a real place in the saver
    setDrawer(false); setMode('scene'); S.gz = null; gzToken++;
    S.labels = false; S.follow = false; S.playing = false; S.reveal = true;
    world.gU.uPick.value = 0;
    const canvas = $('view');
    let bandFn = null, bandT = 0;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
    // shot kinds, each with the bursts that suit it
    const KINDS = {
      rise: { presets: ['ref', 'kt15', 'kt21', 'kt21low', 'modern', 'mt1', 'surface', 'mt15', 'mt50'], tods: ['day', 'sunset', 'night', 'sunset'] },
      shock: { presets: ['ref', 'modern', 'kt15', 'kt21', 'mt1', 'surface'], tods: ['day', 'sunset', 'day'] },
      flash: { presets: ['ref', 'kt15', 'kt21', 'kt21low', 'modern', 'mt1', 'mt50'], tods: ['sunset', 'day', 'night'] },
    };
    const code = (fn, name) => ({ lang: 'js', name, text: fn.toString() });
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const RULES = [['W', 'm1'], ['h', 'm2'], ['t', 'm3'], ['p', 'm4'], ['Q', 'm5'], ['R', 'm6']];
    const params = () => [P('W', 'yield', yieldText(S.W), 'm1'), P('h', 'height', S.h < 1 ? 'surface' : fmtDist(S.h), 'm2'), P('t', 'time', S.t > 0 ? fmtTime(S.t) : '—', 'm3')];
    // a shuffled deck of shots, refilled when used up: varied per run
    let deck = [], lastKind = null;
    const nextShot = () => {
      if (!deck.length) { deck = ['rise', 'shock', 'flash', 'rise', 'shock', 'flash']; for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; } }
      // never the same kind twice in a row
      if (deck.length > 1 && deck[deck.length - 1] === lastKind) { const k = deck.findIndex(q => q !== lastKind); if (k >= 0) [deck[k], deck[deck.length - 1]] = [deck[deck.length - 1], deck[k]]; }
      lastKind = deck.pop();
      return lastKind;
    };
    const hold = () => (5 + 7 * calm) * (0.85 + 0.3 * rnd()) * 1000;
    let shot = null, shotT = 0, shotHold = 8000, swapping = false, labT = 0, lastLab = '';
    const anchorAt = (y, R) => () => {
      const c = project(0, y, 0), e = project(R, y, 0), rc = canvas.getBoundingClientRect();
      if (!c) return null;
      return { x: rc.left + c.x, y: rc.top + c.y, r: e ? Math.max(20, Math.hypot(e.x - c.x, e.y - c.y)) : 80 };
    };
    function begin(kind) {
      const K = KINDS[kind];
      let id = pick(K.presets);
      if (id === S.preset && K.presets.length > 1) id = pick(K.presets);
      setPreset(id, true);
      // sometimes a random yield instead of the preset's
      if (rnd() < 0.3) { S.W = Math.pow(10, -0.3 + rnd() * 4.3); S.preset = 'custom'; S.hob = kind === 'shock' ? 'opt5' : pick(['opt5', 'opt1', 'opt20', 'surface']); apply(); }
      setTOD(pick(K.tods));
      // no decals in the saver: no rings, no fallout
      S.fallOn = false;
      for (const k in S.on) S.on[k] = false;
      const W = S.W, h = S.h, sum = S.sum, top = E.cloudTopFinal(W), az0 = rnd() * 360;
      const sh = { kind, t0: 1e-3, t1: 300, log: true, cam: null, drift: (rnd() < 0.5 ? -1 : 1) * (1.2 + 2 * (1 - calm)) };
      if (kind === 'rise') {
        sh.t0 = 0.3 + rnd(); sh.t1 = 240 + 300 * rnd();
        sh.cam = { az: az0, el: 6 + 8 * rnd(), r: Math.max(top, sum.psi1) * (2.3 + 0.6 * rnd()), ty: top * 0.42 };
        sh.lab = () => ({ title: 'The cloud rises', sub: `${pName()} · top ${fmtDist(blast.info.top || 0)} of ${fmtDist(top)}`, params: params().concat([P('R', 'cloud radius', fmtDist(E.cloudRadius(W)), 'm6')]), eq: ['h(t) = H (1 − e^−(t/τ)^1.07),  τ = 96 s (W / 1 Mt)^0.12'], code: code(E.cloudTop, 'effects.js · cloudTop'), anchor: anchorAt(top * 0.55, E.cloudRadius(W) * 1.4) });
      } else if (kind === 'shock') {
        const r1 = clamp(sum.psi5 * (0.7 + 0.5 * rnd()), 300, 3e4), ta = E.arrivalTime(r1, W, h);
        sh.log = false; sh.t0 = Math.max(1e-3, ta - (0.6 + 0.4 * calm) * Math.cbrt(W) * 0.25); sh.t1 = ta + 0.5 * Math.cbrt(W) * 0.25;
        // a raised oblique: the target is half way out, the camera beyond the
        // point and above the roofs, so the front crosses the frame
        const ty = clamp(r1 * 0.08, 30, 2500), a = az0 * DEG;
        sh.cam = { az: az0, el: 11 + 6 * rnd(), r: r1 * 1.05, ty, tx: Math.sin(a) * r1 * 0.45, tz: Math.cos(a) * r1 * 0.45 };
        sh.r1 = r1;
        sh.lab = () => { const pk = E.psi(E.overpressure(r1, W, h)); return { title: 'The shock front', sub: `${pName()} · ${fmtDist(r1)} from ground zero · ${fmtNum(shotHold / 1000 / (sh.t1 - sh.t0))}× slower`, params: params().concat([P('p', 'peak here', `${fmtNum(pk)} psi`, 'm4'), P('u', 'peak wind', `${fmtNum(E.windSpeed(pk * E.PSI))} m/s`, 'm5')]), eq: ['t_a = t₁(r / W^⅓) · W^⅓', 'u = 5p c₀ / 7P₀ √(1 + 6p/7P₀)'], code: code(E.arrivalTime, 'effects.js · arrivalTime'), anchor: anchorAt(ty, r1 * 0.3) }; };
      } else {
        const F = E.fireballSizes(W, h);
        // from the end of the first flash: the ball grows and brightens again
        sh.t0 = E.tThermalMin(W) * 0.8; sh.t1 = E.tFireballMax(W) * 6;
        sh.cam = { az: az0, el: 4 + 6 * rnd(), r: F.max * (5 + 2 * rnd()), ty: Math.max(h, F.max * 0.6) };
        // the camera backs off as the ball grows: about 7 radii away
        sh.zoom = () => Math.max(25, E.fireballRadius(S.t, W, h) * 7.5);
        sh.aim = () => Math.max(blast.info.fbY || h, (blast.info.R || 10) * 0.7);
        sh.lab = () => ({ title: 'The fireball', sub: `${pName()} · ${fmtNum(blast.info.T || 0)} K, radius ${fmtDist(blast.info.R || 0)}`, params: params().concat([P('R', 'largest radius', fmtDist(F.max), 'm6'), P('Q', 'peak power', `${fmtNum(E.thermalPeakPower(W))} kt/s`, 'm5')]), eq: ['R_max ≈ 2 × 100 W^0.4 ft', 't_max = 0.0417 W^0.44 s'], code: code(E.fireballSizes, 'effects.js · fireballSizes'), anchor: () => anchorAt(blast.info.fbY || h, blast.info.R || 50)() });
      }
      S.t = sh.t0;
      const c = sh.cam;
      stage.place({ az: c.az, el: c.el, r: sh.zoom ? sh.zoom() : c.r, target: new V3(c.tx || 0, c.ty, c.tz || 0) });
      stage.exposure = stage.expoTarget = 1;
      return sh;
    }
    const pName = () => { const p = PRESETS.find(q => q.id === S.preset); return p ? `${p.name}, ${p.kind}` : `${yieldText(S.W)} ${S.h < 1 ? 'surface burst' : 'airburst'}`; };
    const show = () => { const l = shot.lab(); l.rules = RULES; lastLab = JSON.stringify(l); label(l); };
    const cut = async () => {
      swapping = true;
      canvas.style.opacity = '0';
      await new Promise(r => setTimeout(r, 850));
      shot = begin(nextShot()); shotT = 0; shotHold = hold();
      setTimeout(() => { canvas.style.opacity = '1'; swapping = false; show(); }, 250);
    };
    saverTick = dt => {
      if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { saverBand = bandFn(canvas.clientHeight); } catch (e) { saverBand = null; } }
      if (!shot) return;
      shotT += dt * 1000;
      const u = clamp(shotT / shotHold, 0, 1);
      if (!swapping) {
        S.t = shot.log ? shot.t0 * Math.pow(shot.t1 / shot.t0, u) : shot.t0 + (shot.t1 - shot.t0) * u;
        // a slow turn of the camera about the target
        const c = stage.controls, p = stage.camera.position;
        sph.setFromVector3(tmpV.copy(p).sub(c.target)); sph.theta += shot.drift * DEG * dt;
        if (shot.zoom) sph.radius = shot.zoom();
        if (shot.aim) c.target.y = shot.aim();
        p.setFromSpherical(sph).add(c.target);
      }
      if ((labT += dt) > 1 && !swapping) { labT = 0; const l = shot.lab(); l.rules = RULES; const js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
      if (shotT >= shotHold && !swapping) cut();
    };
    shot = begin(nextShot()); shotHold = hold(); show();
    window.snSaver.debug = () => ({ kind: shot && shot.kind, preset: S.preset, place: world.place, real: !!world.real || !!S.gz, W: S.W, h: S.h, t: S.t, tod: S.tod, u: shotT / shotHold, cam: stage.camera.position.toArray().map(Math.round) });
    return { canvas, warmupMs: 1500 };
  },
};
