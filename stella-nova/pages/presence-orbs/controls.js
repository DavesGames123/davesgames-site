// ============================================================================
//  PRESENCE ORBS  ·  controls.js — state buttons, palette and play control
// ----------------------------------------------------------------------------
//  initControls() builds the six state buttons and wires the palette inputs,
//  the pause chip and the pointer tracker. setState() switches every tile to a
//  new state at once: it moves the tile's cur into prev, stamps changedAt so
//  the frame loop can crossfade, and restarts the arc species on thinking or
//  success. The palette inputs write G.tone / G.tone2 / G.ink; the second tone
//  follows the first until the reader edits it.
// ============================================================================
import { $, G, STATES, tiles, clock, hexToRgb } from './state.js';

let stateSeg = null;
let tone2Touched = false;

function setState(st) {
  if (st === G.state) return;
  const now = clock();
  for (const t of tiles) { t.prev = t.cur; t.cur = st; t.changedAt = now; if ((st === 'thinking' || st === 'success') && t.s.arc) { t.phase = 0; t.sig.fill(0); } }
  G.state = st; $('state-big').textContent = st;
  stateSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.state === st));
}
const setChip = (id, on) => { $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on)); };

export function initControls() {
  stateSeg = $('states');
  for (const st of STATES) {
    const b = document.createElement('button'); b.type = 'button'; b.className = st === G.state ? 'active' : ''; b.textContent = st; b.dataset.state = st;
    b.addEventListener('click', () => setState(st));
    stateSeg.appendChild(b);
  }
  $('tone').addEventListener('input', e => { G.tone = hexToRgb(e.target.value); if (!tone2Touched) { G.tone2 = G.tone; $('tone2').value = e.target.value; } });
  $('tone2').addEventListener('input', e => { tone2Touched = true; G.tone2 = hexToRgb(e.target.value); });
  $('inkc').addEventListener('input', e => { G.ink = hexToRgb(e.target.value); });
  $('pause').addEventListener('click', () => { G.paused = !G.paused; setChip('pause', !G.paused); $('pause').textContent = G.paused ? '▮▮ paused' : '▶ animate'; });
  window.addEventListener('pointermove', e => { G.pointer = [e.clientX, e.clientY]; }, { passive: true });
}
