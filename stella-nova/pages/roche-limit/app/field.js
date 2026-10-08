// ============================================================================
//  ROCHE LIMIT  ·  app/field.js — force map values
// ----------------------------------------------------------------------------
//  fieldParams() finds the values of the force map for the frame: the
//  masses, the turn rate, L1 and the colour scale. smoothField() eases
//  them when an analysis lands.
//
//  grep -n targets
//    values .... "function fieldParams"
//    easing .... "function smoothField"
// ============================================================================
import * as P from '../physics.js';
import { cross } from '../render.js';
import { UI } from './env.js';
import { satCentre, satState } from './sat.js';
import { S } from './state.js';

// World units: lengths in R_p, GM scaled by k^3, Omega in 1/sim time.
export function fieldParams() {
  const s = S.run.sats[0];
  const k = s.k, c = satCentre(s);
  // the bound mass while the moon lives; after that, the start mass at the
  // frame point (the lobe a moon of that mass would have there)
  const fM = s.an && s.an.live ? s.an.f : 1;
  const GMs = P.G * (s.M0 || 1) * fM * k ** 3, GMp = s.pl.GM * k ** 3;
  const st = satState(s);
  const r = Math.hypot(...st.r), h = Math.hypot(...cross(st.r, st.v));
  const omega = h / (r * r);
  const satR = (s.Rs || s.C.Rs) * k * Math.cbrt(fM);
  const phi = p => { const rp = Math.max(Math.hypot(...p), 1), rs = Math.max(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]), satR); return -GMp / rp - GMs / rs - 0.5 * omega * omega * (p[0] * p[0] + p[1] * p[1]); };
  // L1: the highest Phi on the line from the planet to the moon
  const dc = Math.hypot(...c), u = c.map(q => q / dc);
  let best = -Infinity, bx = 0;
  for (let i = 0; i <= 400; i++) { const x = dc * (0.55 + 0.45 * i / 400) - satR * 0.2; const v = phi(u.map(q => q * x)); if (x < dc - satR && v > best) { best = v; bx = x; } }
  // colour scale: the depth of the moon's lobe below L1
  const depth = Math.abs(best - phi([c[0] + u[0] * satR, c[1] + u[1] * satR, c[2] + u[2] * satR]));
  return { GMs, GMp, omega, phiL1: best, L1: u.map(q => q * bx), satR, c, scale: Math.max(depth, 1e-9), ext: Math.max(2.2, dc + 1.2) };
}
// The field values change in steps when an analysis lands (bound mass,
// L1): ease them over about a second, so the contours never jump.
let fieldS = null;
export function smoothField(f, dt) {
  if (!fieldS || fieldS.serial !== S.run.serial) { fieldS = Object.assign({ serial: S.run.serial }, f); return f; }
  const k = 1 - Math.exp(-Math.min(0.1, dt || 0.016) / (UI.calm ? 1.2 : 0.6));
  for (const key of ['GMs', 'omega', 'phiL1', 'scale', 'satR', 'ext']) fieldS[key] += (f[key] - fieldS[key]) * k;
  fieldS.L1 = fieldS.L1.map((q, i) => q + (f.L1[i] - q) * k);
  return Object.assign({}, f, fieldS, { c: f.c });
}
