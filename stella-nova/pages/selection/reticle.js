// ============================================================================
//  SELECTION  ·  reticle.js — corner-bracket reticles and the drag box (no DOM)
// ----------------------------------------------------------------------------
//  Geometry and style only. main.js strokes the result on the 2D canvas in
//  screen space, after the camera transform, so a reticle stays sharp at
//  any zoom. This file has no game code: the look follows what the game
//  shows on screen (four L brackets in the colour of the entity type, a
//  soft glow, a slow pulse on a selected entity, a thin solid drag box
//  with a faint fill).
//
//  STATES
//    sel       selected: full colour, glow, a slow pulse in brightness and
//              glow. On a new pick the brackets close in from a wider box.
//    hover     the click target under the mouse: thin, dim, no pulse.
//    preview   what the drag box will take: medium, no pulse.
//
//  CRISP LINES  The stroke width is a whole number of device pixels. Every
//  point sits on the device pixel grid, at a half pixel when the width is
//  odd. The width does not change with zoom; only the box size does.
//
//  grep -n targets: "const COLORS", "const STATES", "function snap",
//  "function reticle(", "function dragBox", "function rgba"
// ============================================================================
(function (root) {
  'use strict';

  // Bracket colour per entity type (own ships blue, enemies red, and so on).
  var COLORS = {
    ship: '#6ec8ff', enemy: '#ff5046', planet: '#6fa0ff', station: '#6ab8de',
    module: '#90a4cc', asteroid: '#9ccc6a', star: '#ffc86a'
  };
  // width: stroke in CSS px (rounded to device px); arm: arm length over
  // the half side; alpha and glow: base strengths; pulse: brightness swing.
  var STATES = {
    sel:     { width: 1.75, arm: 0.36, alpha: 0.95, glow: 0.32, pulse: 0.22, minArm: 5 },
    hover:   { width: 1.0,  arm: 0.28, alpha: 0.6,  glow: 0.0,  pulse: 0,    minArm: 4 },
    preview: { width: 1.25, arm: 0.32, alpha: 0.8,  glow: 0.14, pulse: 0,    minArm: 4 }
  };
  var SNAP_MS = 240;      // time for a new pick to close in
  var SNAP_GROW = 0.5;    // how much wider the box starts
  var PAD = 3;            // CSS px between the entity and the brackets
  var MIN_HALF = 8;       // smallest half side in CSS px

  function ease(t) { t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 3); }

  // Put v (CSS px) on the device grid: on a pixel edge for an even width,
  // on a pixel centre for an odd width.
  function snap(v, dpr, odd) { return (Math.round(v * dpr - (odd ? 0.5 : 0)) + (odd ? 0.5 : 0)) / dpr; }

  // A reticle round the screen point (cx, cy). extent is the entity half
  // size in CSS px (world size times zoom). t is the clock in ms, born the
  // time of the pick (or null), phase a per-entity offset.
  // Returns { lw, half, alpha, glow, pts }. pts holds 4 corners of 3
  // points (arm end, corner, arm end) as x,y pairs: 24 numbers.
  function reticle(cx, cy, extent, state, dpr, t, born, phase) {
    var S = STATES[state] || STATES.sel;
    dpr = dpr || 1;
    var dev = Math.max(1, Math.round(S.width * dpr)), lw = dev / dpr, odd = dev % 2 === 1;
    var half = Math.max(MIN_HALF, extent + PAD);
    var alpha = S.alpha, glow = S.glow;
    if (state === 'sel') {
      var p = 0.5 + 0.5 * Math.sin((t || 0) * 0.0026 + (phase || 0));
      alpha = Math.min(1, S.alpha * (1 - S.pulse + S.pulse * p) + 0.05);
      glow = S.glow * (0.6 + 0.4 * p);
      if (born != null) {
        var age = (t || 0) - born;
        if (age >= 0 && age < SNAP_MS) {
          var k = ease(age / SNAP_MS);
          half *= 1 + SNAP_GROW * (1 - k);
          alpha *= 0.35 + 0.65 * k;
          glow *= 1 + 1.5 * (1 - k);
        }
      }
    }
    var arm = Math.max(S.minArm, half * S.arm);
    arm = Math.min(arm, half);
    var x0 = snap(cx - half, dpr, odd), x1 = snap(cx + half, dpr, odd);
    var y0 = snap(cy - half, dpr, odd), y1 = snap(cy + half, dpr, odd);
    var a = Math.round(arm * dpr) / dpr;
    var pts = [
      x0, y0 + a, x0, y0, x0 + a, y0,
      x1 - a, y0, x1, y0, x1, y0 + a,
      x1, y1 - a, x1, y1, x1 - a, y1,
      x0 + a, y1, x0, y1, x0, y1 - a
    ];
    return { lw: lw, half: (x1 - x0) / 2, arm: a, alpha: alpha, glow: glow, pts: pts };
  }

  // The drag box between two screen points: a crisp rect, a stroke colour
  // and a faint fill.
  function dragBox(ax, ay, bx, by, dpr) {
    dpr = dpr || 1;
    var dev = Math.max(1, Math.round(1.25 * dpr)), lw = dev / dpr, odd = dev % 2 === 1;
    var x0 = snap(Math.min(ax, bx), dpr, odd), x1 = snap(Math.max(ax, bx), dpr, odd);
    var y0 = snap(Math.min(ay, by), dpr, odd), y1 = snap(Math.max(ay, by), dpr, odd);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, lw: lw, stroke: '#1ec8ff', fill: 'rgba(30,175,255,0.07)' };
  }

  // '#rrggbb' and an alpha to an rgba() string.
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
  }

  var API = { COLORS: COLORS, STATES: STATES, SNAP_MS: SNAP_MS, PAD: PAD, MIN_HALF: MIN_HALF, snap: snap, reticle: reticle, dragBox: dragBox, rgba: rgba };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SNReticle = API;
})(this);
