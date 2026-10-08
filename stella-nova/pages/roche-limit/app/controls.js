// ============================================================================
//  ROCHE LIMIT  ·  app/controls.js — the page controls
// ----------------------------------------------------------------------------
//  buildUI() fills the gallery, binds the buttons, the sliders, the
//  scrubber and the keys. applyScenario() loads the settings of a
//  scenario; syncButtons() marks the active choices.
//
//  grep -n targets
//    transport ....... "function setPaused", "function stepBy"
//    speed ........... "function setSpeed"
//    scrubber ........ "function syncScrub"
//    panels .......... "function openPanel"
//    bindings ........ "function buildUI"
//    scenario ........ "function applyScenario"
//    button state .... "function syncButtons"
// ============================================================================
import * as P from '../physics.js';
import { SCENARIOS, REAL } from '../scenarios.js';
import { cam } from './camera.js';
import { cardArt } from './card-art.js';
import { UI, $, SPEED_MIN, SPEED_MAX, N_OPTS, PHONE_Q, RM_Q, SPEED_STOPS } from './env.js';
import { truncateHistory, restoreSnap } from './history.js';
import { drawLegend } from './legend.js';
import { allFree } from './loop.js';
import { bindPointer } from './pointer.js';
import { setQuality } from './quality.js';
import { refreshReadout, fmtTime } from './readout.js';
import { startRun } from './runs.js';
import { S } from './state.js';
import { syncStory } from './story.js';

export function setPaused(p) {
  if (!p && UI.paused && S.run) truncateHistory();
  UI.paused = p;
  if (S.run) S.run.scrubbing = false;
  syncPlayButtons();
}
export function syncPlayButtons() {
  const p = UI.paused;
  for (const id of ['playBtn', 'dockPlay']) { const b = $(id); b.textContent = p ? '▶' : '❚❚'; b.setAttribute('aria-label', p ? 'Play' : 'Pause'); b.classList.toggle('on', p); }
  $('playBtn').title = p ? 'Play (Space)' : 'Pause (Space)';
  document.body.classList.toggle('paused', p);
}
function stepBy(frac) {
  if (!S.run || S.run.phase !== 'orbit') return;
  if (!UI.paused) setPaused(true);
  truncateHistory();
  S.run.stepLeft += Math.max(1, Math.round(frac * S.run.T0 / S.run.sats[0].C.dt));
}
function setSpeed(v) {
  UI.speedLog = Math.max(SPEED_MIN, Math.min(SPEED_MAX, v));
  $('speed').value = UI.speedLog;
  S.stepsMax = Math.max(S.stepsMax, 8);
  for (const b of $('stops').querySelectorAll('button')) b.classList.toggle('on', Math.abs(+b.dataset.s - UI.speedLog) < 0.02);
  refreshReadout(false);
}
export function syncScrub() {
  const sc = $('scrub'), n = S.run ? S.run.snaps.length : 0;
  sc.max = Math.max(0, n - 1); sc.disabled = n < 2;
  if (!S.run || !S.run.scrubbing) sc.value = S.run && S.run.viewIdx >= 0 ? S.run.viewIdx : 0;
  const live = !S.run || S.run.viewIdx >= n - 1;
  $('scrubInfo').textContent = n < 2 ? 'history fills as it runs' : live ? (UI.paused ? 'paused' : 'live') : `back in time: ${fmtTime(S.run.snaps[S.run.viewIdx].t * S.run.tUnitSec)} · press play to go on from here`;
  $('story').classList.toggle('past', !live);
}
// open one panel (drawer, popover, modal); null closes them all
const PANELS = ['gallery', 'display', 'advanced', 'details', 'explain', 'moreMenu'];
export function openPanel(id) {
  for (const p of PANELS) { const el = $(p), on = p === id && el.classList.contains('off'); el.classList.toggle('off', !on); }
  for (const [b, p] of [['scenBtn', 'gallery'], ['dispBtn', 'display'], ['advBtn', 'advanced'], ['detBtn', 'details'], ['helpBtn', 'explain'], ['dockDisp', 'display'], ['dockMore', 'moreMenu']]) $(b).classList.toggle('on', !$(p).classList.contains('off'));
  document.body.classList.toggle('drawer-open', !$('advanced').classList.contains('off') || !$('details').classList.contains('off'));
  if (id === 'details' && S.run) refreshReadout(true);
}
export function buildUI() {
  // the gallery
  const cards = $('cards');
  for (const sc of SCENARIOS) {
    const b = document.createElement('button');
    b.className = 'scard'; b.dataset.k = sc.key;
    b.innerHTML = `${cardArt(sc.key)}<b>${sc.name}</b><span>${sc.blurb}</span>`;
    b.addEventListener('click', () => { applyScenario(sc.key); startRun(); openPanel(null); });
    cards.appendChild(b);
  }
  const bBox = $('bodies');
  for (const [k, r] of Object.entries(REAL)) {
    const b = document.createElement('button'); b.dataset.b = k; b.textContent = r.name;
    b.addEventListener('click', () => { UI.body = k; applyScenario('bodies'); startRun(); });
    bBox.appendChild(b);
  }
  const nSel = $('nSel');
  for (const n of N_OPTS) { const o = document.createElement('option'); o.value = n; o.textContent = (n / 1024) + 'k' + (n >= 24576 ? ' (fast GPU)' : ''); nSel.appendChild(o); }
  nSel.value = UI.N;
  nSel.addEventListener('change', () => { UI.N = +nSel.value; });
  // Advanced: the values change on input; "Start again" applies them
  const bind = (id, key, fmt) => {
    const inp = $(id), out = $(id + 'V');
    const show = () => { UI[key] = +inp.value; if (out) out.textContent = fmt(+inp.value); };
    inp.addEventListener('input', show); show();
  };
  bind('d', 'd', v => v.toFixed(2));
  bind('peri', 'peri', v => v.toFixed(2));
  bind('ecc', 'e', v => v.toFixed(2));
  bind('q', 'qLog', v => Math.pow(10, v).toFixed(2));
  bind('j2', 'J2', v => v.toFixed(4));
  bind('mu', 'mu', v => v.toFixed(2));
  bind('coh', 'coh', v => v.toFixed(2));
  for (const b of $('materials').querySelectorAll('button')) b.addEventListener('click', () => {
    UI.material = b.dataset.m; const m = P.MATERIALS[UI.material]; UI.mu = m.mu; UI.coh = m.coh;
    $('mu').value = UI.mu; $('coh').value = UI.coh; $('muV').textContent = UI.mu.toFixed(2); $('cohV').textContent = UI.coh.toFixed(2);
    syncButtons();
  });
  $('applyBtn').addEventListener('click', () => { startRun(); if (PHONE_Q.matches) openPanel(null); });
  // Display
  const segBtns = (box, key, attr, conv = v => v) => { for (const b of $(box).querySelectorAll('button')) b.addEventListener('click', () => { UI[key] = conv(b.dataset[attr]); cam.boostUntil = performance.now() + 3000; if (key === 'cam') { cam.zoom = 1; } syncButtons(); }); };
  segBtns('cams', 'cam', 'c'); segBtns('colors', 'color', 'k', Number); segBtns('fields', 'field', 'f', Number);
  for (const b of $('quals').querySelectorAll('button')) b.addEventListener('click', () => { setQuality(b.dataset.q); syncButtons(); });
  // Reduce motion: on when the system asks for it, until the user sets it
  let calmSet = false;
  $('tCalm').addEventListener('change', () => { calmSet = true; });
  RM_Q.addEventListener('change', e => { if (!calmSet) { UI.calm = e.matches; $('tCalm').checked = UI.calm; } });
  for (const [id, key] of [['tCalm', 'calm'], ['tRings', 'rings'], ['tReal', 'real'], ['tHill', 'hill'], ['tPred', 'pred'], ['tRing', 'ringOn'], ['tBlur', 'blur']]) {
    const c = $(id); c.checked = UI[key]; c.addEventListener('change', () => { UI[key] = c.checked; refreshReadout(false); });
  }
  $('tFps').addEventListener('change', () => { UI.showFps = $('tFps').checked; $('fpsChip').classList.toggle('off', !UI.showFps); });
  // transport and speed
  $('resetBtn').addEventListener('click', () => startRun());
  $('playBtn').addEventListener('click', () => setPaused(!UI.paused));
  $('dockPlay').addEventListener('click', () => setPaused(!UI.paused));
  $('stepBtn').addEventListener('click', () => stepBy(0.01));
  $('dockStep').addEventListener('click', () => stepBy(0.01));
  $('blockBtn').addEventListener('click', () => stepBy(0.1));
  $('speed').addEventListener('input', () => setSpeed(+$('speed').value));
  for (const b of $('stops').querySelectorAll('button')) b.addEventListener('click', () => setSpeed(+b.dataset.s));
  for (const b of $('dockSpeed').querySelectorAll('button')) b.addEventListener('click', () => {
    let i = 0;
    SPEED_STOPS.forEach((x, k) => { if (Math.abs(x.v - UI.speedLog) < Math.abs(SPEED_STOPS[i].v - UI.speedLog)) i = k; });
    setSpeed(SPEED_STOPS[Math.max(0, Math.min(SPEED_STOPS.length - 1, i + +b.dataset.d))].v);
  });
  // the scrubber: drag to go back; it pauses
  const sc = $('scrub');
  sc.addEventListener('input', () => {
    if (!S.run || S.run.phase !== 'orbit') return;
    if (!UI.paused) setPaused(true);
    S.run.scrubbing = true;
    const i = +sc.value;
    if (allFree()) restoreSnap(i); else S.run.pendingRestore = i;
  });
  sc.addEventListener('change', () => { if (S.run) S.run.scrubbing = false; syncScrub(); });
  // panels
  $('scenBtn').addEventListener('click', () => openPanel('gallery'));
  $('dispBtn').addEventListener('click', () => openPanel('display'));
  $('advBtn').addEventListener('click', () => openPanel('advanced'));
  $('detBtn').addEventListener('click', () => openPanel('details'));
  $('helpBtn').addEventListener('click', () => openPanel('explain'));
  $('dockDisp').addEventListener('click', () => openPanel('display'));
  $('dockMore').addEventListener('click', () => openPanel('moreMenu'));
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => openPanel(null));
  for (const b of $('moreMenu').querySelectorAll('[data-open]')) b.addEventListener('click', () => openPanel(b.dataset.open));
  $('gallery').addEventListener('click', e => { if (e.target === $('gallery')) openPanel(null); });
  $('gpu').addEventListener('pointerdown', () => { for (const p of ['display', 'explain', 'moreMenu']) if (!$(p).classList.contains('off')) openPanel(null); });
  // keys
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'range' || e.target.tagName === 'SELECT')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); setPaused(!UI.paused); }
    else if (e.key === '.') stepBy(0.01);
    else if (e.key === ',') stepBy(0.1);
    else if (e.key === '[') setSpeed(UI.speedLog - 0.3);
    else if (e.key === ']') setSpeed(UI.speedLog + 0.3);
    else if (e.key === 'r' || e.key === 'R') startRun();
    else if (e.key === 'Escape') openPanel(null);
  });
  bindPointer();
  syncStory(true);
  applyScenario(UI.scen);
  setSpeed(UI.speedLog);
  syncPlayButtons();
}
export function applyScenario(key) {
  UI.scen = key;
  const sc = SCENARIOS.find(s => s.key === key);
  const src = sc.kind === 'real' ? REAL[UI.body] : sc;
  UI.d = src.d ?? UI.d; UI.peri = src.peri ?? UI.peri; UI.e = src.e ?? UI.e;
  UI.qLog = Math.log10(src.q ?? 1); UI.J2 = src.J2 || 0;
  UI.material = src.material || (sc.materials ? sc.materials[0] : 'fluid');
  const m = P.MATERIALS[UI.material]; UI.mu = m.mu; UI.coh = m.coh;
  UI.cam = 'story'; cam.zoom = 1; cam.el = sc.el ?? 0.42; cam.az = 0.9; cam.boostUntil = performance.now() + 3000;
  UI.color = sc.color ?? 4; UI.field = 0;
  if (sc.speed) setSpeed(Math.log10(sc.speed));
  UI.paused = false;
  for (const [id, key2, f] of [['d', 'd', v => v.toFixed(2)], ['peri', 'peri', v => v.toFixed(2)], ['ecc', 'e', v => v.toFixed(2)], ['q', 'qLog', v => Math.pow(10, v).toFixed(2)], ['j2', 'J2', v => v.toFixed(4)], ['mu', 'mu', v => v.toFixed(2)], ['coh', 'coh', v => v.toFixed(2)]]) {
    $(id).value = UI[key2]; $(id + 'V').textContent = f(UI[key2]);
  }
  const kind = sc.kind === 'real' ? REAL[UI.body].kind : sc.kind;
  $('rowD').style.display = kind === 'flyby' ? 'none' : '';
  $('rowPeri').style.display = kind === 'flyby' ? '' : 'none';
  $('rowEcc').style.display = kind === 'flyby' ? '' : 'none';
  $('scenName').textContent = sc.kind === 'real' ? REAL[UI.body].name : sc.name;
  $('explainSaturn').style.display = key === 'saturn' || (sc.kind === 'real' && UI.body === 'pan') ? '' : 'none';
  $('tReal').closest('label').style.display = (sc.kind === 'real' ? REAL[UI.body].rings : sc.rings) ? '' : 'none';
  syncButtons();
}
function syncButtons() {
  for (const b of $('cards').querySelectorAll('.scard')) b.classList.toggle('on', b.dataset.k === UI.scen);
  for (const b of $('bodies').querySelectorAll('button')) b.classList.toggle('on', UI.scen === 'bodies' && b.dataset.b === UI.body);
  for (const b of $('materials').querySelectorAll('button')) b.classList.toggle('on', b.dataset.m === UI.material);
  $('materials').classList.toggle('dim', UI.scen === 'compare');
  for (const b of $('cams').querySelectorAll('button')) b.classList.toggle('on', b.dataset.c === UI.cam);
  for (const b of $('colors').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.k === UI.color);
  for (const b of $('fields').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.f === UI.field);
  for (const b of $('quals').querySelectorAll('button')) b.classList.toggle('on', b.dataset.q === UI.quality);
  $('matHint').textContent = UI.scen === 'compare' ? 'This story runs one loose and one rough moon.' : P.MATERIALS[UI.material].note;
  $('camHint').textContent = UI.cam === 'story' ? (UI.calm ? 'Reduce motion is on: the story view stays on the planet.' : 'The camera tells the story: a wide shot, a push in to the moon as it breaks up (in slow motion), then a pull out to the ring. Drag or pinch to adjust it.') : UI.cam === 'follow' ? 'The view follows the moon, with its direction fixed in space. At high speed it stays on the planet instead.' : UI.cam === 'planet' ? 'The planet stays still; the moon goes round it.' : '';
  drawLegend();
}
