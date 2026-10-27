// ============================================================================
//  LENIA  ·  app/saver/label.js — the saver label plate and its anchor
// ----------------------------------------------------------------------------
//  saverLabel() sends the creature name, the live rule and its equations to
//  the shell label plate. creatureAnchor() puts the plate pointer on the
//  tracked creature. trackAt() moves the tracked point by its velocity.
//
//  GREP MAP
//    grep -n 'function saverLabel'      the plate content
//    grep -n 'function creatureAnchor'  the creature on the screen
//    grep -n 'function trackAt'         the tracked point now
// ============================================================================
import { wrap, wrapDelta } from '../torus.js';
import { RULES, GENERAL, CORE_TEX, GROWTH_SYM, SAVER_GROWTH, SAVER_CORE } from '../tex.js';
import { $, S, det } from '../state.js';
import { shownTime } from '../frame.js';

// The values on the plate are the live rule (S.rule), so a slider change in
// the panel shows here too. tex is the panel TeX (GENERAL, growthTeX,
// CORE_TEX) in the RULES colours. The growth line holds the values of m
// and s already, so the plate gets the symbol form.
export function saverLabel(label) {
  const c = S.c;
  if (!label || !c) return;
  const R = Math.round(c.R * S.rule.scale * det() * 10) / 10;
  const params = [
    { sym: 'm', name: 'growth centre', value: S.rule.m.toFixed(3), cls: 'm5' },
    { sym: 's', name: 'growth width', value: S.rule.s.toFixed(4), cls: 'm6' },
    { sym: 'T', name: 'time resolution', value: String(S.rule.T), cls: 'm4' },
    { sym: 'R', name: 'kernel radius', value: R + ' cells' },
  ];
  if (c.b.length > 1) params.push({ sym: '\\beta', name: 'ring heights', value: '(' + c.b.map(v => +v.toFixed(3)).join(', ') + ')' });
  const growth = GROWTH_SYM[c.gn - 1] || '';
  label({
    title: c.name, sub: `Lenia · ${c.code}${c.cname ? ' · ' + c.cname : ''}`, params,
    lines: c.cls === 'grow' ? ['Grows without limit'] : [],
    tex: [GENERAL, growth, CORE_TEX[c.kn - 1] || CORE_TEX[0]].filter(Boolean), rules: RULES,
    eq: ['A(t + Δt) = clip₀¹[A(t) + (1/T)·G(K ∗ A(t))]', SAVER_GROWTH[c.gn - 1] || SAVER_GROWTH[0],
      'K(r) = β⌊Br/R⌋ · k(Br/R mod 1)', SAVER_CORE[c.kn - 1] || SAVER_CORE[0]],
    anchor: c.cls === 'grow' ? null : creatureAnchor,
  });
}
// The creature on screen, for the shell's label plate. In the saver it is
// the tracked creature (saverTrack), moved forward by its velocity. It maps
// as the render shader does: canvas centre + offset + (cell - view centre)
// x cellPx. r is the kernel radius on the screen. Null when no creature is
// tracked or it is off the canvas. Page CSS px.
function creatureAnchor() {
  const tr = S.saverTrack, E = S.engine;
  if (!E || !tr || !tr.p) return null;
  const rc = $('gl').getBoundingClientRect(), { W, H } = E.info, v = E.view, k = E.cellPx();
  const q = trackAt(tr);
  const x = rc.left + rc.width / 2 + v.ox + wrapDelta(q.x - v.cx, W) * k, y = rc.top + rc.height / 2 + v.oy + wrapDelta(q.y - v.cy, H) * k;
  if (x < rc.left || x > rc.right || y < rc.top || y > rc.bottom) return null;
  return { x, y, r: E.info.R * k, pts: [{ x, y }] };
}
// The tracked point now: the last grid centroid moved by the velocity.
export function trackAt(tr) {
  const { W, H } = S.engine.info, age = shownTime() - tr.t;
  return { x: wrap(tr.p.x + tr.v.x * age, W), y: wrap(tr.p.y + tr.v.y * age, H) };
}
