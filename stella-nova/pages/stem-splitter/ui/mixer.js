// ============================================================================
//  STEM SPLITTER  ·  ui/mixer.js — stem rows: waveform, mute, solo, volume
// ----------------------------------------------------------------------------
//  CONTRACT 6.1 step 4. One row per stem plus an "Original" row (muted at
//  the start). Each row has the stem name and colour, a waveform canvas with
//  a play head, a mute button, a solo button and a volume slider. The mixer
//  keeps the state { volume, mute, solo } per row and calls onChange(states)
//  after each change. app.js gives the states to the player.
//
//  Presets (applyPreset, pure):
//    karaoke  vocals muted, other stems unmuted, Original muted, no solo
//    vocals   solo on vocals only, mutes stay as they are
//    all      every stem unmuted, Original muted, no solo
//
//  A click or a drag on a waveform calls onSeek(fraction 0..1). On touch,
//  a tap seeks on pointerup and only a horizontal drag scrubs, so a
//  vertical scroll that starts on a waveform does not seek.
//
//  GREP MAP
//    STEM_COLORS ....... the colours of CONTRACT 6.3
//    TAP_PX ............ tap / scroll limit of a touch on a waveform
//    waveform seek ..... "const fracAt" (pointer handlers below it)
//    STEM_LABELS ....... the row names
//    initialStates ..... { id: { volume, mute, solo } }
//    applyPreset ....... karaoke / vocals / all
//    createMixer ....... { el, states, set, preset, setHead, redraw, destroy }
// ============================================================================

import { computePeaks, canvasColumns, drawWaveform } from './waveform.js';

// A touch that moves less than this (CSS px) is a tap.
export const TAP_PX = 8;

export const STEM_COLORS = {
  drums: '#ff8a5c', bass: '#7a9cff', other: '#b48cff', vocals: '#ff8ac2',
  guitar: '#ffd166', piano: '#5fd3a8', original: '#9aa3b2',
};
export const STEM_LABELS = {
  drums: 'Drums', bass: 'Bass', other: 'Other', vocals: 'Vocals',
  guitar: 'Guitar', piano: 'Piano', original: 'Original',
};
export const ORIGINAL = 'original';

export function initialStates(ids) {
  return Object.fromEntries(ids.map(id => [id, { volume: 1, mute: id === ORIGINAL, solo: false }]));
}

export function applyPreset(states, preset) {
  const out = {};
  for (const [id, s] of Object.entries(states)) {
    const t = { ...s };
    if (preset === 'karaoke') { t.solo = false; t.mute = id === 'vocals' || id === ORIGINAL; }
    else if (preset === 'vocals') { t.solo = id === 'vocals'; }
    else if (preset === 'all') { t.solo = false; t.mute = id === ORIGINAL; }
    out[id] = t;
  }
  return out;
}

// rows: [{ id, channels: [L, R] }] in display order.
export function createMixer(parent, { rows, onChange, onSeek, doc = globalThis.document, win = globalThis } = {}) {
  const el = doc.createElement('div');
  el.className = 'ss-mixer';
  let states = initialStates(rows.map(r => r.id));
  const ui = new Map();

  for (const r of rows) {
    const color = STEM_COLORS[r.id] || STEM_COLORS.other;
    const row = doc.createElement('div');
    row.className = 'ss-row'; row.dataset.stem = r.id;
    row.style.setProperty('--stem', color);

    const name = doc.createElement('div'); name.className = 'ss-row-name';
    const sw = doc.createElement('span'); sw.className = 'ss-swatch';
    const label = doc.createElement('span'); label.textContent = STEM_LABELS[r.id] || r.id;
    name.append(sw, label);

    const wave = doc.createElement('div'); wave.className = 'ss-wave';
    const canvas = doc.createElement('canvas'); canvas.className = 'ss-wave-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const head = doc.createElement('div'); head.className = 'ss-head';
    wave.append(canvas, head);

    const mute = doc.createElement('button'); mute.type = 'button'; mute.className = 'ss-mute'; mute.textContent = 'M';
    mute.setAttribute('aria-label', `Mute ${label.textContent}`);
    const solo = doc.createElement('button'); solo.type = 'button'; solo.className = 'ss-solo'; solo.textContent = 'S';
    solo.setAttribute('aria-label', `Solo ${label.textContent}`);
    const vol = doc.createElement('input'); vol.type = 'range'; vol.className = 'ss-vol';
    vol.setAttribute('min', '0'); vol.setAttribute('max', '100'); vol.setAttribute('step', '1'); vol.value = '100';
    vol.setAttribute('aria-label', `${label.textContent} volume`);

    const ctl = doc.createElement('div'); ctl.className = 'ss-row-ctl';
    ctl.append(mute, solo, vol);
    row.append(name, wave, ctl);
    el.appendChild(row);

    mute.addEventListener('click', () => set(r.id, { mute: !states[r.id].mute }));
    solo.addEventListener('click', () => set(r.id, { solo: !states[r.id].solo }));
    vol.addEventListener('input', () => set(r.id, { volume: Math.max(0, Math.min(100, Number(vol.value) || 0)) / 100 }));

    // Mouse: seek on pointerdown, scrub while the button is down. Touch and
    // pen: the browser can still turn the gesture into a pan-y scroll, so
    // pointerdown only stores the point. A tap (< TAP_PX of movement) seeks
    // on pointerup. A drag that is more horizontal than vertical scrubs,
    // with at most one seek per animation frame.
    let drag = null;   // { x, y, mouse, scrub, pending, raf }
    const fracAt = x => { const b = wave.getBoundingClientRect(); return b.width > 0 ? Math.min(1, Math.max(0, (x - b.left) / b.width)) : null; };
    const seekX = x => { const f = fracAt(x); if (f !== null && onSeek) onSeek(f); };
    const flush = () => {
      if (!drag) return;
      if (drag.raf) { (win.cancelAnimationFrame || clearTimeout)(drag.raf); drag.raf = 0; }
      if (drag.pending !== null) { const x = drag.pending; drag.pending = null; seekX(x); }
    };
    const later = x => {
      drag.pending = x;
      if (drag.raf) return;
      const raf = win.requestAnimationFrame || (fn => setTimeout(fn, 16));
      drag.raf = raf(() => { if (drag) { drag.raf = 0; flush(); } });
    };
    wave.addEventListener('pointerdown', e => {
      const mouse = e.pointerType === 'mouse';
      drag = { x: e.clientX, y: e.clientY, mouse, scrub: mouse, pending: null, raf: 0 };
      if (mouse) {
        if (wave.setPointerCapture && e.pointerId !== undefined) try { wave.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        seekX(e.clientX);
      }
    });
    wave.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.scrub) {
        const dx = Math.abs(e.clientX - drag.x), dy = Math.abs((e.clientY || 0) - (drag.y || 0));
        if (dx < TAP_PX || dx <= dy) return;
        drag.scrub = true;
        if (wave.setPointerCapture && e.pointerId !== undefined) try { wave.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      }
      later(e.clientX);
    });
    wave.addEventListener('pointerup', e => {
      if (!drag) return;
      const d = drag;
      if (d.scrub) { if (!d.mouse) d.pending = e.clientX; flush(); }
      else if (Math.abs(e.clientX - d.x) < TAP_PX && Math.abs((e.clientY || 0) - (d.y || 0)) < TAP_PX) seekX(d.x);
      drag = null;
    });
    wave.addEventListener('pointercancel', () => { if (drag && drag.raf) (win.cancelAnimationFrame || clearTimeout)(drag.raf); drag = null; });

    ui.set(r.id, { row, canvas, head, mute, solo, vol, channels: r.channels, color, peaks: null, cols: 0 });
  }
  parent.appendChild(el);

  function paint() {
    const anySolo = Object.values(states).some(s => s.solo);
    for (const [id, u] of ui) {
      const s = states[id];
      u.mute.classList.toggle('on', s.mute); u.mute.setAttribute('aria-pressed', String(s.mute));
      u.solo.classList.toggle('on', s.solo); u.solo.setAttribute('aria-pressed', String(s.solo));
      u.vol.value = String(Math.round(s.volume * 100));
      const silent = anySolo ? !s.solo : s.mute;
      u.row.classList.toggle('silent', silent);
    }
  }

  function set(id, patch) {
    if (!states[id]) return;
    states = { ...states, [id]: { ...states[id], ...patch } };
    paint();
    if (onChange) onChange(states);
  }

  function redraw(force = false) {
    const dpr = win.devicePixelRatio || 1;
    for (const u of ui.values()) {
      const cols = canvasColumns(u.canvas, dpr);
      if (force || !u.peaks || cols !== u.cols) { u.peaks = computePeaks(u.channels, cols); u.cols = cols; }
      drawWaveform(u.canvas, u.peaks, { color: u.color, dpr });
    }
  }

  let ro = null, onResize = null, tid = null;
  const later = () => { clearTimeout(tid); tid = setTimeout(() => redraw(false), 120); };
  if (typeof win.ResizeObserver === 'function') { ro = new win.ResizeObserver(later); ro.observe(el); }
  else if (win.addEventListener) { onResize = later; win.addEventListener('resize', onResize); }

  paint();
  redraw(true);

  return {
    el,
    get states() { return states; },
    set,
    preset(name) { states = applyPreset(states, name); paint(); if (onChange) onChange(states); },
    setHead(frac) {
      const p = `${(Math.min(1, Math.max(0, frac)) * 100).toFixed(3)}%`;
      for (const u of ui.values()) u.head.style.left = p;
    },
    redraw,
    destroy() {
      clearTimeout(tid);
      if (ro) ro.disconnect();
      if (onResize && win.removeEventListener) win.removeEventListener('resize', onResize);
      el.remove();
    },
  };
}
