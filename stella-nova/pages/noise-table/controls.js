// ============================================================================
//  NOISE TABLE  ·  controls.js — palette and the hover-mode chip
// ----------------------------------------------------------------------------
//  initControls() wires the three palette inputs and the hover chip. The
//  palette inputs write G.ink / G.tone / G.cream; the frame loop notices the
//  change and repaints every tile once. The chip flips G.hoverOnly between
//  "animate on hover only" and "animate everything".
// ============================================================================
import { $, G, hexToRgb } from './state.js';

const setChip = (id, on) => { $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on)); };

export function initControls() {
  $('inkc').addEventListener('input', e => { G.ink = hexToRgb(e.target.value); });
  $('tone').addEventListener('input', e => { G.tone = hexToRgb(e.target.value); });
  $('cream').addEventListener('input', e => { G.cream = hexToRgb(e.target.value); });
  $('hoveronly').addEventListener('click', () => { G.hoverOnly = !G.hoverOnly; setChip('hoveronly', G.hoverOnly); $('hoveronly').textContent = G.hoverOnly ? '◉ animate on hover only' : '◉ animate everything'; });
}
