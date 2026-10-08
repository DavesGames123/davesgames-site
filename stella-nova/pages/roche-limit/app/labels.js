// ============================================================================
//  ROCHE LIMIT  ·  app/labels.js — DOM labels on the scene
// ----------------------------------------------------------------------------
//  placeLabels() puts the names of the circles, the rings, the drag
//  and L1 at their projected screen points.
//
//  grep -n targets
//    one label ..... "function label("
//    all labels .... "function placeLabels"
// ============================================================================
import { norm } from '../render.js';
import { SATURN_RINGS } from '../scenarios.js';
import { limitsFor } from '../main.js';
import { cam } from './camera.js';
import { $, UI, KM_SATURN } from './env.js';
import { satCentre, satState } from './sat.js';
import { S } from './state.js';

const labelEls = {};
function label(key, text, cls) {
  let el = labelEls[key];
  if (!el) { el = labelEls[key] = document.createElement('div'); el.className = 'lbl ' + (cls || ''); $('labels').appendChild(el); }
  if (el.textContent !== text) el.textContent = text;
  return el;
}
function hideLabel(key) { const el = labelEls[key]; if (el) el.style.display = 'none'; }
export function placeLabels(cssW, cssH, fp) {
  const show = (key, text, p, cls, dy = 0) => {
    const el = label(key, text, cls);
    const q = p && S.ren.project(p, cssW, cssH);
    if (!q || q.x < 0 || q.y < 0 || q.x > cssW || q.y > cssH) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.transform = `translate(${q.x.toFixed(1)}px, ${(q.y + dy).toFixed(1)}px)`;
  };
  const L = S.run.limits || limitsFor(S.run.spec);
  // names on the side of the circles nearest the viewer
  // (at az +- 1 rad: off to the sides, so no name sits on the planet)
  const a = cam.az + 1.0;
  const on = !S.saverOn;
  if (on && UI.rings) show('r_fluid', 'Roche limit', [L.fluid * Math.cos(a), L.fluid * Math.sin(a), 0], 'ring-fluid', -10);
  else hideLabel('r_fluid');
  if (on && UI.rings && L.rigid * Math.sin(1.0) > 1.35) show('r_rigid', 'limit for a solid moon', [L.rigid * Math.cos(a), L.rigid * Math.sin(a), 0], 'ring-rigid', -8);
  else hideLabel('r_rigid');
  // today's rings of Saturn: one name for the rings, one for the gap
  const realOn = on && UI.real && S.run.spec.rings;
  const A = SATURN_RINGS.find(r => r.name === 'A ring'), CD = SATURN_RINGS.find(r => r.name === 'Cassini Division');
  const b1 = cam.az - 1.15, b2 = cam.az - 1.6;
  if (realOn) show('sr_rings', 'today’s rings', [A.r1 / KM_SATURN * Math.cos(b1), A.r1 / KM_SATURN * Math.sin(b1), 0], 'ring-real', 8); else hideLabel('sr_rings');
  const cdr = (CD.r0 + CD.r1) / 2 / KM_SATURN;
  if (realOn && cssW >= 600) show('sr_cd', 'Cassini Division', [cdr * Math.cos(b2), cdr * Math.sin(b2), 0], 'ring-real', -14); else hideLabel('sr_cd');
  const s = S.run.sats[0];
  if (on && S.run.phase === 'orbit' && s.pl.drag > 0 && (!s.an || s.an.live)) {
    const c = satCentre(s), st = satState(s), v = norm(st.v), Rw = (s.Rs || s.C.Rs) * s.k;
    show('drag', 'drag (tides, sped up)', [0, 1, 2].map(i => c[i] - v[i] * (1.3 * Rw + 0.4)), 'drag', 0);
  } else hideLabel('drag');
  const showL1 = fp && UI.field === 1 && !S.saverOn && s.an && s.an.live;
  if (showL1) show('L1', 'L1', fp.L1, 'pt'); else hideLabel('L1');
}
