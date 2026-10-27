// ============================================================================
//  FOOT  ·  city-atlas/app/foot.js — the head, the foot and the place labels
// ----------------------------------------------------------------------------
//  The head and the foot in the look of the shell screensaver plate (as
//  Tidal Currents does): the title, the parameter row, the note line and the
//  time bar of the current data. The place labels sit at their 3D place each
//  frame. app/forms.js makes the HTML strings.
//
//  grep -n targets
//    head and labels ...... "export function buildOverlay"
//    foot parameters ...... "export function fillParams"
//    time bar and clock ... "export function updateClockUI"
//    time bar drag ........ "export function bindScrub"
//    label placement ...... "export function placeLabels"
//    keep-out boxes ....... "export function forgetBoxes"
// ============================================================================

import { project } from '../camera.js';
import { S, ov, cam, lastHour, invalidate } from './state.js';
import { $, el, overlay, scrubEl, headEl, footEl, layersEl, atlasEl, captionEl } from './dom.js';
import { esc, clamp, titleCase, stamp } from './text.js';
import { paramsHTML, notesHTML } from './forms.js';

export function buildOverlay() {
  const meta = S.meta;
  overlay.textContent = '';
  $('ttl').textContent = meta.title;
  $('sub').textContent = [meta.country, meta.region].filter((s) => s && s !== meta.title).join(' · ');
  const days = Math.round(lastHour() / 24);
  scrubEl.querySelectorAll('.tick').forEach((t) => t.remove());
  scrubEl.setAttribute('aria-valuemax', String(lastHour()));
  for (let i = 1; i < days; i++) {
    const tick = el('i', 'tick');
    tick.style.left = (i / days * 100) + '%';
    scrubEl.prepend(tick);
  }
  const labels = [];
  for (const lb of meta.labels ?? []) {
    const n = el('div', `lbl s-right z-${lb.size || 'sm'}${lb.water ? ' water' : ''}`);
    n.append(el('div', 'dot'), el('div', 'txt', esc(lb.water ? titleCase(lb.name) : lb.name)));
    n.dataset.size = lb.size || 'sm';
    overlay.appendChild(n);
    labels.push({ node: n, lb });
  }
  S.ui = { labels };
  fillParams();
}

export function fillParams() {
  invalidate(3);
  const meta = S.meta;
  if (!meta) return;
  $('params').innerHTML = paramsHTML(meta, ov);
  S.ui.time = $('pTime');
  $('notes').innerHTML = notesHTML(meta, ov);
  scrubEl.classList.toggle('off', !(ov.ocean.on && meta.current));
  updateClockUI(true);
}

let shownHour = -1, shownF = -1;
const scrubFill = scrubEl.querySelector('.fill'), scrubKnob = scrubEl.querySelector('.knob');
export function updateClockUI(force) {
  const f = clamp(S.hour / lastHour(), 0, 1);
  // the bar moves only when it moves a visible amount: no style work per frame
  if (force || Math.abs(f - shownF) > 5e-4) {
    shownF = f;
    scrubFill.style.transform = `scaleX(${f})`;
    scrubKnob.style.left = (f * 100) + '%';
  }
  const h = Math.floor(S.hour);
  if (force || h !== shownHour) {
    shownHour = h;
    const text = stamp(S.meta, h);
    if (S.ui.time) S.ui.time.textContent = text;
    scrubEl.setAttribute('aria-valuenow', String(h));
    scrubEl.setAttribute('aria-valuetext', text);
    const t = $('ocTime');
    if (t) { t.value = String(h); $('ocTimeOut').textContent = text.replace(/ [A-Z+0-9:-]+$/, ''); }
  }
}

export function bindScrub(prog) {
  const setFrom = (e) => {
    const r = prog.getBoundingClientRect();
    S.hour = clamp((e.clientX - r.left) / r.width, 0, 1) * lastHour();
    updateClockUI();
  };
  prog.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    S.scrubbing = true;
    try { prog.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    setFrom(e);
  });
  prog.addEventListener('pointermove', (e) => { if (S.scrubbing) setFrom(e); });
  const end = () => { S.scrubbing = false; };
  prog.addEventListener('pointerup', end);
  prog.addEventListener('pointercancel', end);
}

const hits = (a, b, pad = 0) => a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.y0 - pad < b.y1 && a.y1 + pad > b.y0;
function contentBox(node) {
  let box = null;
  for (const c of node.children) {
    if (c.offsetParent === null) continue;
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    box = box ? { x0: Math.min(box.x0, r.left), y0: Math.min(box.y0, r.top), x1: Math.max(box.x1, r.right), y1: Math.max(box.y1, r.bottom) }
      : { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
  }
  return box;
}

// Labels at their 3D place, each frame. Hidden behind the camera, off
// screen, under the head or the foot, or on a larger label. The keep-out
// boxes of the head, the foot and the open sheets refresh every 500 ms.
let keepBoxes = [], keepAt = -1e9;
export function forgetBoxes() { keepAt = -1e9; }
export function placeLabels(t) {
  const vp = S.renderer?.info?.vp;
  if (!vp || !S.ui.labels) return;
  const w = window.innerWidth, h = window.innerHeight;
  if (t - keepAt > 500) {
    keepAt = t;
    keepBoxes = [contentBox(headEl), contentBox(footEl)].filter(Boolean);
    for (const sh of [layersEl, atlasEl, captionEl]) {
      if (sh.hidden) continue;
      const r = sh.getBoundingClientRect();
      keepBoxes.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    }
  }
  const E = ov.terrain.exag * ov.terrain.amt;
  const kept = keepBoxes.slice();
  const small = Math.min(w, h) < 520;
  for (const it of S.ui.labels) {
    const p = project(vp, [it.lb.x, it.lb.y, it.lb.z * E + 40], w, h);
    const n = it.node;
    if (!p || (small && it.lb.size === 'sm' && !it.lb.water)) { n.hidden = true; continue; }
    n.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    const far = p.d > cam.dist * 2.6;
    const tw = (it.w ||= n.querySelector('.txt').getBoundingClientRect().width || 80);
    const box = { x0: p.x - 3, x1: p.x + 10 + tw, y0: p.y - 8, y1: p.y + 8 };
    const off = box.x0 < 4 || box.y0 < 4 || box.x1 > w - 4 || box.y1 > h - 4;
    if (far || off || kept.some((k) => hits(box, k, 6))) { n.hidden = true; continue; }
    n.hidden = false;
    kept.push(box);
  }
}
