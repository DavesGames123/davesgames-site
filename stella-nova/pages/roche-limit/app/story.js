// ============================================================================
//  ROCHE LIMIT  ·  app/story.js — the four story phases
// ----------------------------------------------------------------------------
//  updatePhase() marks the phases that the run reaches. syncStory()
//  updates the phase strip and the caption; seekPhase() jumps back.
//
//  grep -n targets
//    phase test ...... "function updatePhase"
//    caption text .... "function storyText"
//    phase strip ..... "function syncStory"
//    seek ............ "function seekPhase"
// ============================================================================
import { STORY } from '../scenarios.js';
import { setPaused } from '../main.js';
import { $ } from './env.js';
import { restoreSnap } from './history.js';
import { satState } from './sat.js';
import { S } from './state.js';

// Called after each read of all moons (sat 0 decides). Times are in sim
// time; run.story holds the start time of each phase reached.
export function updatePhase(t) {
  const s = S.run.sats[0], st = S.run.story, L = S.run.limits;
  if (!s.an) return;
  const d = Math.hypot(...satState(s).r) / s.Rp;
  if (st.cross === undefined && (d < L.fluid)) st.cross = t;
  if (st.cross !== undefined && st.torn === undefined && s.an.f < 0.75) st.torn = t;
  if (st.torn !== undefined && st.ring === undefined && t - st.torn > (s.an.f < 0.25 ? 0.75 : 1.5) * S.run.T0) st.ring = t;
  const k = storyKeyAt(st);
  if (k !== S.run.storyKey) { S.run.storyKey = k; syncStory(); }
}
export function storyKeyAt(st) { return st.ring !== undefined ? 'ring' : st.torn !== undefined ? 'torn' : st.cross !== undefined ? 'cross' : 'approach'; }
export function storyText(key) {
  const spec = S.run.spec, Pn = spec.planetName || 'the planet';
  const subj = spec.kind === 'flyby' ? 'comet' : 'moon';
  let tx = STORY.find(x => x.key === key).text;
  if (key === 'approach') {
    if (spec.kind === 'flyby') tx = 'A loose comet falls toward {P}.';
    else if (spec.kind === 'compare') tx = 'Two moons circle {P}: one loose, one rough.';
    else if (spec.kind !== 'spiral') tx = `The ${subj} circles {P}, outside its Roche limit: the tide only stretches it a little.`;
    else if (spec.key !== 'saturn') tx = 'A moon spirals toward {P}, pulled in by a drag.';
  } else if (key === 'cross' && spec.kind !== 'spiral' && S.run.story.cross < 0.05 * S.run.T0) tx = `The ${subj} starts inside the Roche limit: {P}’s tide beats its own gravity.`;
  else if (key === 'torn' && spec.kind === 'flyby') tx = 'The comet is pulled into a long stream of rubble.';
  else if (key === 'ring' && spec.kind === 'flyby') tx = 'The stream’s own gravity gathers it into a chain of clumps.';
  else if (key === 'ring' && spec.key !== 'saturn') tx = 'The debris spreads into a ring around {P}.';
  tx = tx.split('{P}').join(Pn);
  return tx.charAt(0).toUpperCase() + tx.slice(1);
}
export function syncStory(reset) {
  const box = $('phases');
  if (reset || !box.children.length) {
    box.innerHTML = '';
    for (const p of STORY) {
      const b = document.createElement('button');
      b.dataset.p = p.key; b.innerHTML = `<i></i><span>${p.short}</span>`;
      b.addEventListener('click', () => seekPhase(p.key));
      box.appendChild(b);
    }
  }
  if (!S.run) return;
  const order = STORY.map(x => x.key), cur = order.indexOf(S.run.storyKey);
  for (const b of box.children) {
    const i = order.indexOf(b.dataset.p), reached = S.run.story[b.dataset.p] !== undefined || i === 0;
    b.classList.toggle('now', i === cur); b.classList.toggle('done', i < cur); b.disabled = !reached;
    b.title = reached ? 'Go back to: ' + b.textContent : 'Not reached yet';
  }
  $('caption').textContent = S.run.phase === 'orbit' || S.run.phase === 'placing' ? storyText(S.run.storyKey) : 'Building the moon from thousands of grains…';
}
// Jump to the first record at or after the start of a phase.
function seekPhase(key) {
  if (!S.run || S.run.phase !== 'orbit') return;
  const t0 = S.run.story[key] ?? (key === 'approach' ? 0 : undefined);
  if (t0 === undefined || !S.run.snaps.length) return;
  let i = S.run.snaps.findIndex(r => r.t >= t0 - 1e-9);
  if (i < 0) i = S.run.snaps.length - 1;
  setPaused(true);
  restoreSnap(i);
}
