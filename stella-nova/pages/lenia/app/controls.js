// ============================================================================
//  LENIA  ·  app/controls.js — the panel, the phone sheet, the dock and the view
// ----------------------------------------------------------------------------
//  buildStatic() binds every control that does not change per creature.
//  The set* functions keep S, the panel buttons and the dock in step.
//
//  GREP MAP
//    grep -n 'function buildStatic'  bind the static controls
//    grep -n 'function setOpen'      the panel and the phone sheet
//    grep -n 'function setPlaying'   play and pause
//    grep -n 'function setTool'      tool and its hint
//    grep -n 'function setFollow'    the follow camera
//    grep -n 'function setZoom'      the zoom
//    grep -n 'function pushView'     the engine view
//    grep -n 'function setMode'      world, potential or growth view
//    grep -n 'sheetGrip'             the phone sheet grip
// ============================================================================
import { PALETTES } from '../engine.js';
import { GENERAL } from './tex.js';
import { $, PHONE_Q, FINE_Q, TOOLS, S, setText, toast } from './state.js';
import { selectCreature, placeCreature, soup } from './creature.js';
import { buildRule } from './rule.js';
import { drawPlots } from './plots.js';
import { tex } from './equations.js';
import { fillList, openBrowser } from './browser.js';
import { sizeWorld } from './world.js';
import { bindKeys } from './keys.js';

export function setOpen(open) {
  const panel = $('panel');
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  if (open && PHONE_Q.matches) openBrowser(false);
}
export function setPlaying(on) {
  S.playing = on;
  $('playBtn').textContent = on ? 'Pause' : 'Play';
  $('playBtn').classList.toggle('on', !on);
  $('dockPlay').textContent = on ? '❚❚' : '▶';
  $('dockPlay').setAttribute('aria-label', on ? 'Pause' : 'Play');
}
export function setTool(t) {
  S.tool = t;
  for (const b of $('tools').children) b.classList.toggle('on', b.dataset.tool === t);
  $('dockTool').textContent = TOOLS[t];
  $('dockTool').setAttribute('aria-label', 'Tool: ' + t);
  const touch = !FINE_Q.matches;
  const how = {
    stamp: touch ? 'Tap the world to place a copy of the creature, turned at random.' : 'Click the world to place a copy of the creature, turned at random.',
    draw: 'Drag on the world to spray random cells. Some rules grow new creatures from them.',
    erase: 'Drag on the world to remove cells.',
  }[t];
  setText('toolHint', how + (touch ? ' Two fingers zoom and pan.' : ' The wheel zooms, a right drag pans.'));
}
export function setFollow(on) {
  S.view.follow = on;
  $('followBtn').textContent = on ? 'Follow on' : 'Follow off';
  $('followBtn').classList.toggle('on', on);
}
export function setZoom(z) {
  S.view.zoom = Math.max(0.5, Math.min(6, z));
  $('zoom').value = S.view.zoom;
  setText('zoomV', `×${S.view.zoom.toFixed(2)}`);
  pushView();
}
export function pushView() {
  if (!S.engine) return;
  S.engine.setView({ mode: S.view.mode, zoom: S.view.zoom, palette: S.view.palette });
}

export function buildStatic() {
  tex($('eq-general'), GENERAL);
  $('prevBtn').addEventListener('click', () => selectCreature(S.idx - 1));
  $('nextBtn').addEventListener('click', () => selectCreature(S.idx + 1));
  $('browseBtn').addEventListener('click', () => openBrowser());
  $('browserClose').addEventListener('click', () => openBrowser(false));

  $('playBtn').addEventListener('click', () => setPlaying(!S.playing));
  $('dockPlay').addEventListener('click', () => setPlaying(!S.playing));
  $('stepBtn').addEventListener('click', () => { setPlaying(false); if (S.engine) { S.engine.step(1); S.time += 1 / S.rule.T; } });
  $('resetBtn').addEventListener('click', placeCreature);
  $('dockReset').addEventListener('click', placeCreature);
  $('soupBtn').addEventListener('click', soup);
  $('clearBtn').addEventListener('click', () => { if (S.engine) { S.engine.clear(); S.time = 0; } });

  const sp = $('speed');
  sp.addEventListener('input', () => { S.speed = +sp.value; setText('speedV', `${S.speed} t/s`); });
  sp.dispatchEvent(new Event('input'));
  $('worldSel').addEventListener('change', e => { S.worldShort = +e.target.value; sizeWorld(); });
  $('detailSel').addEventListener('change', e => {
    S.detail = +e.target.value;
    if (S.c) buildRule();
    sizeWorld(true);
  });

  for (const b of $('tools').children) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('dockTool').addEventListener('click', () => {
    const order = Object.keys(TOOLS);
    setTool(order[(order.indexOf(S.tool) + 1) % order.length]);
    toast('Tool: ' + S.tool, false, 900);
  });
  const br = $('brush');
  br.addEventListener('input', () => { S.brush = +br.value; setText('brushV', `${S.brush.toFixed(2)} R`); });
  br.dispatchEvent(new Event('input'));
  setTool('stamp');

  const pal = $('palettes');
  for (const name of Object.keys(PALETTES)) {
    const b = document.createElement('button'); b.dataset.pal = name;
    const bar = document.createElement('span'); bar.className = 'bar';
    bar.style.background = `linear-gradient(90deg, ${PALETTES[name].join(', ')})`;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = name;
    b.append(bar, nm);
    b.classList.toggle('on', name === S.view.palette);
    b.addEventListener('click', () => {
      S.view.palette = name;
      for (const x of pal.children) x.classList.toggle('on', x === b);
      pushView();
      drawPlots();
      if (S.creatures.length) fillList();
    });
    pal.append(b);
  }
  for (const b of $('modes').children) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('zoom').addEventListener('input', e => setZoom(+e.target.value));
  setZoom(1);
  $('followBtn').addEventListener('click', () => setFollow(!S.view.follow));

  $('gear').addEventListener('click', () => setOpen(true));
  $('panelClose').addEventListener('click', () => setOpen(false));
  $('dockPanel').addEventListener('click', () => setOpen(!$('panel').classList.contains('open')));
  $('dockCreature').addEventListener('click', () => openBrowser());
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => { setOpen(!e.matches); openBrowser(false); });

  // The grip of the phone sheet. A tap switches half and full height. A drag
  // up gives full height. A drag down gives half height, then closes.
  const grip = $('sheetGrip'), panel = $('panel');
  let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* none */ } });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });
  new ResizeObserver(() => drawPlots()).observe($('plots'));

  // No browser pinch zoom, no double-tap zoom, no pull to refresh.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault());
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  bindKeys();
}
export function setMode(mode) {
  S.view.mode = mode;
  for (const b of $('modes').children) b.classList.toggle('on', b.dataset.mode === mode);
  pushView();
}
