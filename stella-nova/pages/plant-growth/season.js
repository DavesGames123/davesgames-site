// ============================================================================
//  PLANT GROWTH  ·  the calendar: seasons, leaf life, leaf fall (DOM-free)
// ----------------------------------------------------------------------------
//  The clock t counts years from the sowing (t = 0 is 1 January of year 0).
//  p = t - floor(t) is the phase of the year: 0.25 is about 1 April, 0.5 is
//  1 July, 0.75 is 1 October. Each species has its own bud break, autumn
//  colour and leaf fall (grow.js SPECIES[...].pheno).
//
//  This file holds each rule twice: in JavaScript (mesh.js, tests.mjs, the
//  readout) and in GLSL (SEASON_GLSL, pasted into the render.js shaders).
//  Keep the two in step: tests.mjs compares them at sample points through a
//  small GLSL-to-JS check of the constants.
//
//  LEAF LIFE in a year Y of its window [y0, y1] (deciduous):
//    open   from max(Y + brk + jitter, born of the node + one metamer time),
//           over OPEN_DUR (the leaf unfolds and grows to full size)
//    colour from Y + col + jitter, over COL_DUR (to the autumn palette)
//    detach at Y + fall + FALL_SPREAD * rand, then a fall of FALL_DUR
//    litter on the ground until next spring, then it rots away (LITTER_END)
//  An evergreen needle stays green and falls only in its last year y1.
//  Fern pinnae brown with the frond and do not detach (the frond collapses).
//  Flowers open at bloom, and their petals fall at bloomEnd.
//
//  grep -n targets
//    constants ........... "export const CAL"
//    season name ......... "export function seasonOf"
//    leaf state .......... "export function leafState"
//    snow cover .......... "export function snowCover"
//    the GLSL copy ....... "export const SEASON_GLSL"
// ============================================================================

export const CAL = {
  OPEN_DUR: 0.05,      // a leaf unfolds in about 18 days
  COL_DUR: 0.07,       // autumn colour turns in about 25 days
  COL_SPREAD: 0.06,
  FALL_SPREAD: 0.1,    // leaves of one tree fall over about 5 weeks
  FALL_DUR: 0.028,     // the fall itself, stretched so a time-lapse shows it
  LITTER_END: 0.12,    // litter rots away by the next bud break minus this
  FLOWER_OPEN: 0.03,
  PETAL_DUR: 0.035,
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// { year, p, month, season } for a clock t in years.
export function seasonOf(t) {
  const year = Math.floor(t), p = t - year;
  const month = MONTHS[Math.min(11, Math.floor(p * 12))];
  const season = p < 0.17 || p >= 0.92 ? 'winter' : p < 0.42 ? 'spring' : p < 0.69 ? 'summer' : 'autumn';
  return { year, p, month, season };
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The state of one leaf record at clock t.
//   ph: { brk, col, fall, bloom, bloomEnd } of the species
//   rec: { kind, y0, y1, rand, nodeBorn, ever, falls }
// Returns { show (0..1 size), colour (0..1 autumn), fall (-1 attached,
// 0..1 falling, 1 on the ground), litter (1 fresh .. 0 gone), year }.
export function leafState(ph, rec, t, out = {}) {
  const C = CAL, Y = Math.floor(t);
  out.show = 0; out.colour = 0; out.fall = -1; out.litter = 0; out.year = Y;
  const y1 = rec.y1;
  if (rec.kind === 1) {                     // flower: opens at bloom, petals fall
    const yy = t - Y < ph.bloom ? Y - 1 : Y;  // last year's petals on the ground
    if (yy < rec.y0 || yy > y1) return out;
    const o = yy + ph.bloom + 0.03 * rec.rand;
    const d = yy + ph.bloomEnd - 0.03 + 0.05 * rec.rand;
    out.year = yy;
    out.show = smoothstep(o, o + C.FLOWER_OPEN, t);
    if (t > d) { out.fall = Math.min(1, (t - d) / C.PETAL_DUR); out.litter = 1 - smoothstep(d + C.PETAL_DUR, d + C.PETAL_DUR + 0.08, t); }
    if (out.fall >= 1 && out.litter <= 0) out.show = 0;
    return out;
  }
  if (rec.kind === 2) {                     // cotyledon: two summers, then it withers
    const o = rec.nodeBorn + 0.012;
    out.show = smoothstep(o, o + 0.03, t);
    out.colour = smoothstep(1.35, 1.55, t);
    if (t > 1.6) { out.fall = Math.min(1, (t - 1.6) / 0.03); out.litter = 1 - smoothstep(1.65, 1.75, t); }
    if (t > 1.75) out.show = 0;
    return out;
  }
  // a leaf: this year's leaf, or last year's litter before the bud break
  const thisYear = Y >= rec.y0 && Y <= y1;
  const lastYear = Y - 1 >= rec.y0 && Y - 1 <= y1;
  const deciduous = !rec.ever && rec.falls;
  if (deciduous && lastYear && t - Y < ph.brk - C.LITTER_END + 0.02 && (!thisYear || t - Y < ph.brk)) {
    const fade = 1 - smoothstep(Y + ph.brk - C.LITTER_END - 0.06, Y + ph.brk - C.LITTER_END, t);
    if (fade > 0) { out.show = 1; out.colour = 1; out.fall = 1; out.litter = fade; out.year = Y - 1; return out; }
  }
  if (!thisYear && !(rec.ever && Y >= rec.y0 && Y <= y1 + 1)) return out;
  if (rec.ever) {
    if (Y > y1) {                           // an old needle: brown and down by spring
      out.show = 1; out.colour = 1; out.fall = 1; out.litter = 1 - smoothstep(Y + 0.05, Y + 0.2, t);
      if (out.litter <= 0) out.show = 0;
      return out;
    }
    const o = Math.max(rec.y0 + ph.brk, rec.nodeBorn + 0.01);
    out.show = smoothstep(o, o + C.OPEN_DUR * 1.4, t);
    if (Y === y1 && y1 < 9000) {           // its last autumn
      out.colour = smoothstep(Y + 0.7, Y + 0.8, t);
      const d = Y + 0.8 + C.FALL_SPREAD * rec.rand;
      if (t > d) out.fall = Math.min(1, (t - d) / C.FALL_DUR);
    }
    return out;
  }
  const o = Math.max(Y + ph.brk + 0.012 * rec.rand, rec.nodeBorn + 0.01);
  out.show = smoothstep(o, o + C.OPEN_DUR, t);
  const c0 = Y + ph.col + C.COL_SPREAD * (rec.rand - 0.5) * 2;
  out.colour = smoothstep(c0, c0 + C.COL_DUR, t);
  if (rec.falls) {
    const d = Y + ph.fall + C.FALL_SPREAD * rec.rand;
    if (t > d) out.fall = Math.min(1, (t - d) / C.FALL_DUR);
    if (out.fall >= 1) out.litter = 1;
  }
  return out;
}

// Snow on the ground and on the upper side of branches, 0..1.
export function snowCover(t) {
  const p = t - Math.floor(t);
  if (p < 0.13) return 1 - smoothstep(0.08, 0.13, p);
  if (p > 0.9) return smoothstep(0.9, 0.95, p);
  return 0;
}

// How far the radius has grown from last year's ring to this year's.
export function girthPhase(p) { return smoothstep(0.24, 0.7, p); }

// A dead node (a shed branch or a spent frond) drops to the ground.
// Returns the drop in metres at age a = t - died (years), for a node at
// height y; frond: a wilt, slower than a branch.
export function deathDrop(a, y, frond) {
  if (a <= 0) return 0;
  const k = frond ? a / 0.06 : a / 0.012;
  return Math.min(Math.max(0, y - 0.02), (frond ? 1.5 : 8) * k * k);
}
// The radius factor of a dead node: it lies on the ground, then rots away.
export function deathFade(a, frond) { return 1 - smoothstep(frond ? 0.12 : 0.04, frond ? 0.22 : 0.12, a); }

// The same rules for the shaders. The GLSL names match the JS names.
export const SEASON_GLSL = /* glsl */`
const float OPEN_DUR = ${CAL.OPEN_DUR.toFixed(4)};
const float COL_DUR = ${CAL.COL_DUR.toFixed(4)};
const float COL_SPREAD = ${CAL.COL_SPREAD.toFixed(4)};
const float FALL_SPREAD = ${CAL.FALL_SPREAD.toFixed(4)};
const float FALL_DUR = ${CAL.FALL_DUR.toFixed(4)};
const float LITTER_END = ${CAL.LITTER_END.toFixed(4)};
const float FLOWER_OPEN = ${CAL.FLOWER_OPEN.toFixed(4)};
const float PETAL_DUR = ${CAL.PETAL_DUR.toFixed(4)};
float sstep(float a, float b, float x) { return smoothstep(a, b, x); }
// ph: brk, col, fall, bloom; ph2.x: bloomEnd. rec: kind, y0, y1, rand.
// flags.x: evergreen, flags.y: the leaf falls. Returns show, colour, fall
// (-1 attached), litter.
vec4 leafState(vec4 ph, float bloomEnd, vec4 rec, float nodeBorn, vec2 flags, float t) {
  float Y = floor(t), p = t - Y;
  float kind = rec.x, y0 = rec.y, y1 = rec.z, rnd = rec.w;
  vec4 o = vec4(0.0, 0.0, -1.0, 0.0);
  if (kind > 0.5 && kind < 1.5) {
    float yy = p < ph.w ? Y - 1.0 : Y;
    if (yy < y0 || yy > y1) return o;
    float op = yy + ph.w + 0.03 * rnd;
    float d = yy + bloomEnd - 0.03 + 0.05 * rnd;
    o.x = sstep(op, op + FLOWER_OPEN, t);
    if (t > d) { o.z = min(1.0, (t - d) / PETAL_DUR); o.w = 1.0 - sstep(d + PETAL_DUR, d + PETAL_DUR + 0.08, t); }
    if (o.z >= 1.0 && o.w <= 0.0) o.x = 0.0;
    return o;
  }
  if (kind > 1.5) {
    float op = nodeBorn + 0.012;
    o.x = sstep(op, op + 0.03, t);
    o.y = sstep(1.35, 1.55, t);
    if (t > 1.6) { o.z = min(1.0, (t - 1.6) / 0.03); o.w = 1.0 - sstep(1.65, 1.75, t); }
    if (t > 1.75) o.x = 0.0;
    return o;
  }
  bool thisYear = Y >= y0 && Y <= y1;
  bool lastYear = Y - 1.0 >= y0 && Y - 1.0 <= y1;
  bool ever = flags.x > 0.5, falls = flags.y > 0.5;
  if (!ever && falls && lastYear && p < ph.x - LITTER_END + 0.02 && (!thisYear || p < ph.x)) {
    float fade = 1.0 - sstep(Y + ph.x - LITTER_END - 0.06, Y + ph.x - LITTER_END, t);
    if (fade > 0.0) return vec4(1.0, 1.0, 1.0, fade);
  }
  if (!thisYear && !(ever && Y >= y0 && Y <= y1 + 1.0)) return o;
  if (ever) {
    if (Y > y1) {
      float lit = 1.0 - sstep(Y + 0.05, Y + 0.2, t);
      return vec4(lit > 0.0 ? 1.0 : 0.0, 1.0, 1.0, lit);
    }
    float op = max(y0 + ph.x, nodeBorn + 0.01);
    o.x = sstep(op, op + OPEN_DUR * 1.4, t);
    if (Y == y1 && y1 < 9000.0) {
      o.y = sstep(Y + 0.7, Y + 0.8, t);
      float d = Y + 0.8 + FALL_SPREAD * rnd;
      if (t > d) o.z = min(1.0, (t - d) / FALL_DUR);
    }
    return o;
  }
  float op = max(Y + ph.x + 0.012 * rnd, nodeBorn + 0.01);
  o.x = sstep(op, op + OPEN_DUR, t);
  float c0 = Y + ph.y + COL_SPREAD * (rnd - 0.5) * 2.0;
  o.y = sstep(c0, c0 + COL_DUR, t);
  if (falls) {
    float d = Y + ph.z + FALL_SPREAD * rnd;
    if (t > d) o.z = min(1.0, (t - d) / FALL_DUR);
    if (o.z >= 1.0) o.w = 1.0;
  }
  return o;
}
float snowCover(float t) {
  float p = t - floor(t);
  if (p < 0.13) return 1.0 - sstep(0.08, 0.13, p);
  if (p > 0.9) return sstep(0.9, 0.95, p);
  return 0.0;
}
float girthPhase(float p) { return sstep(0.24, 0.7, p); }
float deathDrop(float a, float y, float frond) {
  if (a <= 0.0) return 0.0;
  float k = frond > 0.5 ? a / 0.06 : a / 0.012;
  return min(max(0.0, y - 0.02), (frond > 0.5 ? 1.5 : 8.0) * k * k);
}
float deathFade(float a, float frond) { return 1.0 - sstep(frond > 0.5 ? 0.12 : 0.04, frond > 0.5 ? 0.22 : 0.12, a); }
`;
