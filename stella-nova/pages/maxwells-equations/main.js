// ============================================================================
//  MAXWELL'S EQUATIONS  ·  main.js — the stepper
// ----------------------------------------------------------------------------
//  Five chapters of steps (chapters.js). Each step names a scene module and
//  its mode. go(i) fades the stage, shows the scene, flies the camera,
//  typesets the TeX (lib/sci-math.js, MathJax SVG) and builds the controls.
//  The frame loop calls the active scene's update, and the readout shows
//  its live numbers.
//
//  The scenes work in geom.js coordinates (z up). WORLD turns them so that
//  z is three.js y: (x, y, z) -> (x, z, -y).
//
//  GREP MAP   (grep -n "<anchor>" main.js)
//    "const SCENES"   scene modules       "function go"        change step
//    "function buildControls"             "function renderReadout"
//    "function layoutPhone"  sheet, dock and occlusion
//    "function bindKeys"     keys          "saver.js"           screensaver
// ============================================================================
import { THREE } from './kit.js';
import { createStage } from './stage.js';
import { CHAPTERS, STEPS } from './chapters.js';
import { typeset } from '../../lib/sci-math.js';
import * as forms from './scenes/forms.js';
import * as stokes from './scenes/stokes.js';
import * as laws from './scenes/laws.js';
import * as wave from './scenes/wave.js';

const $ = id => document.getElementById(id);
const canvas = $('stage');

// WebGL check: without it the text still works.
let stage = null;
try { stage = createStage(canvas); } catch (e) { $('nogl').hidden = false; console.warn('maxwell: no WebGL', e); }

const WORLD = new THREE.Group();
WORLD.rotation.x = -Math.PI / 2;
if (stage) stage.scene.add(WORLD);
const toWorld = p => [p[0], p[2], -p[1]];

// A label that follows a 3D point (geom coordinates). fn returns the point
// or null to hide it.
function label(html, cls, fn) {
  const el = document.createElement('div');
  el.className = 'lb ' + (cls || '');
  el.innerHTML = html;
  $('labels').appendChild(el);
  if (stage) stage.addLabel(el, () => { const p = fn(); return p ? toWorld(p).concat(p[3] ?? 1) : null; });
  return el;
}

const ctx = { label, stage };
const MODULES = { forms, stokes, laws, wave };
const SCENES = {};
function scene(key) {
  if (!SCENES[key]) {
    const s = MODULES[key].build(ctx);
    s.group.visible = false;
    WORLD.add(s.group);
    SCENES[key] = s;
  }
  return SCENES[key];
}

let cur = -1, active = null;
const S = { saver: false, userTouched: false };

// ── chapters and steps ─────────────────────────────────────────────────────
function buildChapters() {
  const nav = $('chapters');
  nav.innerHTML = '';
  CHAPTERS.forEach((c, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="n">${i + 1}</span>${c.short}`;
    b.title = c.name;
    b.onclick = () => go(STEPS.findIndex(s => s.ch === i));
    nav.appendChild(b);
  });
}

function go(i, { instant = false } = {}) {
  i = Math.max(0, Math.min(STEPS.length - 1, i));
  if (i === cur) return;
  const st = STEPS[i];
  cur = i;
  history.replaceState(null, '', '#' + st.id);
  // text
  const chap = CHAPTERS[st.ch];
  $('stepNum').textContent = `${st.ch + 1} · ${chap.name}`;
  $('stepTitle').textContent = st.title;
  $('stepText').innerHTML = st.text;
  const tex = $('stepTex');
  tex.innerHTML = '';
  for (const e of st.tex || []) {
    const box = document.createElement('div');
    box.className = 'eq' + (e.small ? ' small' : '');
    const m = document.createElement('div');
    box.appendChild(m);
    if (e.cap) { const cp = document.createElement('span'); cp.className = 'cap'; cp.textContent = e.cap; box.appendChild(cp); }
    tex.appendChild(box);
    typeset(m, e.t);
  }
  $('count').textContent = `${i + 1} / ${STEPS.length}`;
  $('prev').disabled = $('dockPrev').disabled = i === 0;
  $('next').disabled = $('dockNext').disabled = i === STEPS.length - 1;
  $('dockNum').textContent = `${i + 1}/${STEPS.length}`;
  $('dockName').textContent = st.title;
  [...$('chapters').children].forEach((b, k) => b.classList.toggle('on', k === st.ch));
  $('step').scrollTop = 0;
  buildControls(st);
  // scene
  if (!stage) return;
  const swap = () => {
    for (const k in SCENES) SCENES[k].group.visible = false;
    active = scene(st.scene);
    active.group.visible = true;
    active.enter(st.mode, { ...(st.params || {}) });
    stage.flyTo(st.cam, instant ? 0 : 1.8);
    stage.fadeTarget = 1;
  };
  if (instant || !active) { stage.fade = 0; swap(); }
  else {
    stage.fadeTarget = 0;
    clearTimeout(go.t);
    go.t = setTimeout(swap, 380);
  }
}

// ── controls ───────────────────────────────────────────────────────────────
function buildControls(st) {
  const box = $('controls');
  box.innerHTML = '';
  const tg = document.createElement('div');
  tg.className = 'toggles';
  for (const c of st.controls || []) {
    if (c.toggle) {
      const b = document.createElement('button');
      b.textContent = c.label;
      const on = (st.params || {})[c.toggle] !== false;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      b.onclick = () => {
        const v = !b.classList.contains('on');
        b.classList.toggle('on', v); b.setAttribute('aria-pressed', v);
        if (active) active.set(c.toggle, v);
      };
      b.dataset.key = c.toggle;
      tg.appendChild(b);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'ctl';
    const id = 'c-' + c.key;
    const v0 = (st.params && st.params[c.key] != null) ? st.params[c.key] : c.value;
    row.innerHTML = `<label for="${id}">${c.sym ? `<span class="sym ${c.cls}">${c.sym}</span>` : ''}${c.label}</label><span class="val"></span><input type="range" id="${id}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v0}">`;
    const inp = row.querySelector('input'), val = row.querySelector('.val');
    val.textContent = c.fmt ? c.fmt(+v0) : v0;
    inp.oninput = () => {
      const v = +inp.value;
      val.textContent = c.fmt ? c.fmt(v) : v;
      if (!active) return;
      // a hand on a slider stops the animation of this step
      if (active.P && active.P.auto) {
        active.set('auto', false);
        const t = box.querySelector('[data-key="auto"]');
        if (t) { t.classList.remove('on'); t.setAttribute('aria-pressed', false); }
      }
      active.set(c.key, v);
    };
    box.appendChild(row);
  }
  if (tg.children.length) box.appendChild(tg);
}

// ── readout ────────────────────────────────────────────────────────────────
let lastRead = '';
function renderReadout() {
  if (!active || !active.readout) return;
  const rows = active.readout();
  const html = rows.map(([k, v, cls]) => `<div class="row"><span>${k}</span><b class="${cls || ''}">${v}</b></div>`).join('');
  if (html !== lastRead) { lastRead = html; $('readout').innerHTML = html; }
}

if (stage) {
  stage.tick = (dt, t) => { if (active && active.group.visible) active.update(dt, t); };
  setInterval(renderReadout, 120);
}

// ── phone: sheet, dock and occlusion ───────────────────────────────────────
const phoneMQ = matchMedia('(max-width:768px), (pointer:coarse) and (max-height:520px)');
const landMQ = matchMedia('(pointer:coarse) and (max-height:520px) and (orientation:landscape)');
const panel = $('panel');
function setSheet(state) {
  panel.classList.toggle('closed', state === 'closed');
  panel.classList.toggle('full', state === 'full');
  $('dockTitle').setAttribute('aria-expanded', state !== 'closed');
  layoutPhone();
}
function layoutPhone() {
  if (!stage) return;
  if (!phoneMQ.matches || S.saver) { stage.setOcclusion({}); return; }
  const dock = $('dock').getBoundingClientRect().height;
  if (panel.classList.contains('closed')) { stage.setOcclusion({ b: dock }); return; }
  if (landMQ.matches) { stage.setOcclusion({ r: panel.getBoundingClientRect().width, b: dock }); return; }
  const h = panel.classList.contains('full') ? innerHeight * 0.5 : panel.getBoundingClientRect().height;
  stage.setOcclusion({ b: h + dock });
}
$('dockTitle').onclick = () => setSheet(panel.classList.contains('closed') ? 'half' : 'closed');
$('dockPrev').onclick = () => go(cur - 1);
$('dockNext').onclick = () => go(cur + 1);
$('prev').onclick = () => go(cur - 1);
$('next').onclick = () => go(cur + 1);
{
  // grip: a tap toggles half and full; a drag down closes the sheet
  const grip = $('sheetGrip');
  let y0 = null, moved = false;
  grip.addEventListener('pointerdown', e => { y0 = e.clientY; moved = false; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', e => { if (y0 != null && Math.abs(e.clientY - y0) > 8) moved = true; });
  grip.addEventListener('pointerup', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    if (!moved) setSheet(panel.classList.contains('full') ? 'half' : 'full');
    else if (dy > 40) setSheet(panel.classList.contains('full') ? 'half' : 'closed');
    else if (dy < -40) setSheet('full');
  });
}
addEventListener('resize', layoutPhone);
panel.addEventListener('transitionend', layoutPhone);

// ── keys ───────────────────────────────────────────────────────────────────
function bindKeys() {
  addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(cur + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(cur - 1); e.preventDefault(); }
  });
}

// the hint fades after the first drag
canvas.addEventListener('pointerdown', () => $('hint').classList.add('gone'), { once: true });

buildChapters();
bindKeys();
const start = Math.max(0, STEPS.findIndex(s => '#' + s.id === location.hash));
go(start, { instant: true });
layoutPhone();

// The page state for the screensaver module and for debugging.
window.__mx = { go, get cur() { return cur; }, STEPS, SCENES, scene, stage, WORLD, S, layoutPhone, get active() { return active; } };
