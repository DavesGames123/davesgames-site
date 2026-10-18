// ============================================================================
//  HUMAN SKELETON  ·  app/chip.js — the "Isolated: <bone>" chip
// ────────────────────────────────────────────────────────────────────────────
//  While one bone is isolated, the chip at the base of the stage names it
//  and holds its controls: previous and next bone in the same region,
//  Ghost or Hide for the other bones, and Show all (Esc). The chip is in
//  occlusion() (camera.js), so the framed bone stays above it. The saver
//  hides every child of #stage but the canvas, so the chip never shows
//  in the saver; enter() also ends the isolation (main.js).
//
//  GREP MAP
//    const chip                                      the #isoChip element
//    function syncChip                               state to DOM
//    chip.addEventListener                           the chip buttons
// ============================================================================
import { $, esc, SIDE_NAME } from './env.js';
import { S, dirty } from './state.js';
import { isolate, exitIsolate, setIsoHide } from './inspect.js';
import { regionStep } from '../focus.js';

export const chip = $('isoChip');
export function syncChip() {
  const on = S.iso >= 0 && !S.saver;
  if (!on) { if (!chip.hidden) { chip.hidden = true; document.body.classList.remove('has-iso'); dirty(); } return; }
  const b = S.bones[S.iso];
  $('isoName').innerHTML = `${esc(b.name)}${b.side ? ` <i>${SIDE_NAME[b.side]}</i>` : ''}`;
  chip.querySelector('[data-act="ghost"]').classList.toggle('on', !S.isoHide);
  chip.querySelector('[data-act="hide"]').classList.toggle('on', S.isoHide);
  chip.querySelector('[data-act="ghost"]').setAttribute('aria-pressed', String(!S.isoHide));
  chip.querySelector('[data-act="hide"]').setAttribute('aria-pressed', String(S.isoHide));
  if (chip.hidden) { chip.hidden = false; document.body.classList.add('has-iso'); }
  dirty();
}
chip.addEventListener('click', e => {
  const x = e.target.closest('button');
  if (!x || S.iso < 0) return;
  const act = x.dataset.act;
  if (act === 'all') exitIsolate(true);
  else if (act === 'ghost') setIsoHide(false);
  else if (act === 'hide') setIsoHide(true);
  else if (act === 'prev' || act === 'next') {
    const j = regionStep(S.bones, S.vis, S.iso, act === 'next' ? 1 : -1);
    if (j >= 0 && j !== S.iso) isolate(j);
  }
});
