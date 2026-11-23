// catalogue.js: catalogue stars and feature objects of the star map (spec 4.3, 4.4, 7.4.8). Row A9.
// The Unity twin is StarMapCatalogBuilder (row U6). Both must give the same dump for the same input.
//
// Exports (grep -n "^export"):
//   buildCatalogue(comp, sites, layers, opts) -> { stars, starCount, slabRange, objects, objectCount, ... }
//   exportCatalogue(cat) -> object          the 7.4.8 dump, read from the packed arrays
//   hash3(cx, cy, salt) -> [3 floats]       the PCG3D Hash3 of nebula-math.hlsli, in JS
//   giantMixTemperature(u1, u2)             the GiantMixTemperature of nebula-math.hlsli, in JS
//   siteSetSha256(sites)                    SHA-256 of the canonical site set text
//   sha256Hex(text)                         synchronous SHA-256 of a UTF-8 string
//   lightCurveDump(cat) -> [rows]           per star: structure, class, time and amplitude law (fusion stars 5.1)
//
// Fusion stars (pass3-fusion-stars.md 5.1, spec 11.3): cat.lc[i] (packed order) holds the structure (mass,
// L, R, Teff, burning mode) and the mode table of star i, from stellar.js. lightcurve.js sums the modes per
// frame. The 7.4.8 dump keeps its revision 3 shape (the Unity twin compares it); lightCurveDump is separate.
//
// Packing (4.3, 4.4). Sorted by slab, stable inside one slab.
//   stars[8i..8i+3]   = (x_content, y, p, flux)       stars[8i+4..8i+7] = (teffK, spikeGain, kind, periodSec)
//   slabRange[4k..]   = (start, count, 0, 0)
//   objects[16i..]    = (x, y, p, kind), (boundPx, axisDeg, periodSec, phase),
//                       (spacingPx, lobeLengthPx, tiltDeg, farLobeGain), (colour.rgb, gain)
// kind of a star: 0 field, 2 WR, 3 B star, 4 protostar, 5 seat, 6 Cepheid, 7 embedded hot star, 8 runaway.
// kind of an object: 1 WR rings, 2 jet spine, 3 outflow cavity.
//
// Flux unit: the cell star unit of 4.2. FLIM is the flux of the faintest cell star (core peak 0.03).
// A star "dm magnitudes above the limit" has flux FLIM 10^(0.4 dm). opts.fluxScale multiplies every flux.
//
// opts = { seats: [{ id, x, y }] (kept seats), cepheids: false, palette: 'nircam' | 'sho', fluxScale: 1 }
// sites = [{ id, x, y }] in content px (y from the bottom). layers is read for slabP only, when present.

import { slabP as slabPOf, CONTENT_W, CONTENT_H, SLAB_COUNT } from '../params.js';
import { compositionSha256 } from '../data/composition.js';
import { structureOf, lightCurveOf, idHash, MS } from './stellar.js';

export const FLIM = 0.0923628;
export const MAX_STARS = 128, MAX_OBJECTS = 16;
const PSF_PEAK = 0.92 / (2 * Math.PI * 0.7 * 0.7);        // core peak per unit flux (4.5)
const LUMA = [0.2126, 0.7152, 0.0722];

// Tuning constants [I]. Unity row U6 must use the same values.
export const CAT = {
  hotDm0: 9.5, hotDmPerLogL: 1.0, hotDmMin: 8.0, hotDmMax: 11.5,  // dm = 9.5 + (logL - 4), clamped
  protoDm0: 7.0,                                                   // dm = 7 - own A_V
  seatDm: 7.0, seatTeffK: 25000, seatCoreRadiusPx: 2.5,            // peak clamp: core above 0.03 within 2.5 px
  fieldCellPx: 400, fieldSalt: 300, fieldKeep: 0.9, fieldDm: [9.5, 11.0],
  fieldSiteGapPx: 120, fieldGapPx: 200, fieldYMin: 40, fieldYMax: 1040,
  cepheidPeriods: [37, 53], cepheidDm: 6.0, cepheidSalt: 320,
  spikeSiteGapPx: 120,
  ringGain: 1.5, jetGain: 1.5, cavityGain: 0.6,
  ringAxisDeg: 35, ringSpacingPx: 14, ringPeriodSec: 45, ringBoundPx: 160,
  jetPeriodSec: 30, jetHalfWidthPx: 40, farLobeGain: Math.exp(-1.5),
  cavityLobePx: 160, cavityBoundPx: 170, cavityTint: [0.75, 0.85, 1.15],
};
const EMBEDDED_SLABS = [7, 10, 13, 16, 19, 22];

// ---------------------------------------------------------------------------------------------
// Shared math, ported from nebula-math.hlsli (uint32 arithmetic is exact in JS with Math.imul).
// ---------------------------------------------------------------------------------------------
function pcg3d(x, y, z) {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0; z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  return [x, y, z];
}
export function hash3(cx, cy, salt) {
  const v = pcg3d((cx + 1073741824) >>> 0, (cy + 1073741824) >>> 0, salt >>> 0);
  return [(v[0] >>> 8) / 16777216, (v[1] >>> 8) / 16777216, (v[2] >>> 8) / 16777216];
}
export function giantMixTemperature(u1, u2) {
  let lo = 9000, hi = 30000;
  if (u1 < 0.35) { lo = 3700; hi = 4900; } else if (u1 < 0.65) { lo = 4900; hi = 6200; } else if (u1 < 0.85) { lo = 6200; hi = 9000; }
  return lo * Math.pow(hi / lo, Math.min(1, Math.max(0, u2)));
}

// Slab index of parallax p (the same rule as SmSlabOf in starmap-composite.hlsli).
export function slabOfP(p) { return Math.min(SLAB_COUNT - 1, Math.max(0, Math.floor((1 - p) / 0.025 + 6.5))); }

// ---------------------------------------------------------------------------------------------
// Synchronous SHA-256 (FIPS 180-4) of a UTF-8 string. Small and slow; used on short texts only.
// ---------------------------------------------------------------------------------------------
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const n = bytes.length, total = ((n + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total); m.set(bytes); m[n] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(n / 0x20000000)); dv.setUint32(total - 4, (n << 3) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, r) => (x >>> r) | (x << (32 - r));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + 4 * i);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

// Canonical site set text: JSON of [{ id, x, y }] in input order, no spaces, LF only.
export function siteSetSha256(sites) {
  const list = (sites || []).map((s) => ({ id: String(s.id), x: Number(s.x), y: Number(s.y) }));
  return sha256Hex(JSON.stringify(list));
}

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------
const fluxOfDm = (dm) => FLIM * Math.pow(10, 0.4 * dm);
const near = (x, y, list, r) => list.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < r * r);

function palNorm(c) {
  const l = Math.max(1e-6, c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]);
  return [c[0] / l, c[1] / l, c[2] / l];
}

// Time from a feature step to the end of the bake, in code time units (tier U values; tier W is the same).
function bakeTimeAfter(comp, step) {
  const s = comp.steps.U;
  const a = Math.max(0, s.A - step) * s.dtA;
  const b = Math.max(0, s.A + s.B - Math.max(step, s.A)) * s.dtB;
  return a + b;
}

function catalogueSources(comp) {
  const out = [];
  const s = comp.steps.U, pxPerL = comp.units.pxPerL;
  for (const src of comp.sources) {
    let [x, y, p] = src.pos;
    let kind = -1, dm = 0, spike = 0;
    switch (src.kind) {
      case 'WolfRayet': kind = 2; break;
      case 'BStar': kind = 3; break;
      case 'EmbeddedHot': kind = 7; break;
      case 'Runaway': kind = 8; break;
      case 'Protostar': kind = 4; break;
      case 'Sink': if (src.teffK != null) kind = 4; break;        // k1: a protostar entry on a sink
      default: break;                                              // DistantCluster (above the frame), Seat
    }
    if (kind < 0) continue;
    if (kind === 8 && src.move) {                                  // the end position of phase B (2.4)
      const L = src.move.v * s.B * s.dtB * pxPerL;
      x += src.move.dir[0] * L; y += src.move.dir[1] * L;
    }
    if (kind === 4) dm = CAT.protoDm0 - (src.ownAv || 0);
    else {
      dm = Math.min(CAT.hotDmMax, Math.max(CAT.hotDmMin, CAT.hotDm0 + CAT.hotDmPerLogL * ((src.logL ?? 4) - 4)));
      spike = 1;
    }
    out.push({ id: src.id, x, y, p, flux: fluxOfDm(dm), teffK: src.teffK, spikeGain: spike, kind, periodSec: 0,
               logL: src.logL, jet: !!src.jet, ownAv: src.ownAv || 0 });
  }
  return out;
}

// cellPx and dmShift come from comp.stars (the Stars group of the shuffle panel). At the defaults the list
// is the same as before: the cell lattice and the hashes do not change.
function fieldSpikedStars(sites, taken, keep = CAT.fieldKeep, cellPx = CAT.fieldCellPx, dmShift = 0) {
  const out = [];
  const c = cellPx;
  for (let cy = 0; cy * c < CONTENT_H; cy++) {
    for (let cx = 0; cx * c < CONTENT_W; cx++) {
      const h = hash3(cx, cy, CAT.fieldSalt);
      if (h[2] > keep) continue;
      const x = (cx + h[0]) * c, y = (cy + h[1]) * c;
      if (x >= CONTENT_W || y < CAT.fieldYMin || y > CAT.fieldYMax) continue;
      if (near(x, y, sites, CAT.fieldSiteGapPx)) continue;
      if (near(x, y, out, CAT.fieldGapPx) || near(x, y, taken, CAT.fieldGapPx)) continue;
      const h2 = hash3(cx + 7919, cy + 104729, CAT.fieldSalt + 1);
      const h3 = hash3(cx + 15485, cy + 32452, CAT.fieldSalt + 2);
      const slab = EMBEDDED_SLABS[Math.min(5, Math.floor(h2[0] * 6))];
      const dm = CAT.fieldDm[0] + (CAT.fieldDm[1] - CAT.fieldDm[0]) * h3[0] + dmShift;
      out.push({ id: `field_${cx}_${cy}`, x, y, p: slabPOf(slab), flux: fluxOfDm(dm),
                 teffK: giantMixTemperature(h2[1], h2[2]), spikeGain: 1, kind: 0, periodSec: 0,
                 hs: hash3(cx + 31337, cy + 27183, CAT.fieldSalt + 3) });
    }
  }
  return out;
}

function cepheids(sites, taken) {
  const out = [];
  for (let i = 0; i < CAT.cepheidPeriods.length; i++) {
    // Try cells in a fixed order until one is clear of sites and other stars.
    for (let tryN = 0; tryN < 64; tryN++) {
      const h = hash3(i, tryN, CAT.cepheidSalt);
      const x = h[0] * CONTENT_W, y = CAT.fieldYMin + h[1] * (CAT.fieldYMax - CAT.fieldYMin);
      if (near(x, y, sites, CAT.fieldSiteGapPx) || near(x, y, taken, CAT.fieldGapPx) || near(x, y, out, CAT.fieldGapPx)) continue;
      const slab = EMBEDDED_SLABS[Math.min(5, Math.floor(h[2] * 6))];
      out.push({ id: `cepheid_${i}`, x, y, p: slabPOf(slab), flux: fluxOfDm(CAT.cepheidDm),
                 teffK: 6000, spikeGain: 0, kind: 6, periodSec: CAT.cepheidPeriods[i],
                 cepheidTrueDays: MS.cepheidTrueDays[i % MS.cepheidTrueDays.length] });
      break;
    }
  }
  return out;
}

function seatStars(seats) {
  // Peak clamp: the core stays above 0.03 only inside seatCoreRadiusPx.
  const fMax = 0.03 * Math.exp((CAT.seatCoreRadiusPx ** 2) / (2 * 0.49)) / PSF_PEAK;
  return (seats || []).slice(0, 15).map((s, i) => ({
    id: s.id != null ? String(s.id) : `seat_${i}`, x: s.x, y: s.y, p: 1,
    flux: Math.min(fluxOfDm(CAT.seatDm), fMax), teffK: CAT.seatTeffK, spikeGain: 0, kind: 5, periodSec: 0 }));
}

function featureObjects(comp, paletteName) {
  const pal = (comp.palette && (comp.palette[paletteName] || comp.palette.nircam)) || {};
  const pPah = palNorm(pal.PAH || [1, 0.55, 0.16]);
  const pH2 = palNorm(pal.H2 || [1, 0.3, 0.1]);
  const objs = [];
  for (const src of comp.sources) {
    const [x, y, p] = src.pos;
    if (src.kind === 'WolfRayet' && CAT.wrRingsOn) { // Off: the user rejected the crescent marks (2026-11-20).
      objs.push({ x, y, p, kind: 1, boundPx: CAT.ringBoundPx, axisDeg: CAT.ringAxisDeg, periodSec: CAT.ringPeriodSec, phase: 0,
                  spacingPx: CAT.ringSpacingPx, lobeLengthPx: 0, tiltDeg: 0, farLobeGain: 1, colour: pPah, gain: CAT.ringGain });
    }
    if (src.jet) {
      const j = src.jet;
      const t = bakeTimeAfter(comp, j.step);
      const cyc = t / (8 * j.period);
      const phase = 2 * Math.PI * (cyc - Math.floor(cyc));
      objs.push({ x, y, p, kind: 2, boundPx: j.lobePx + CAT.jetHalfWidthPx, axisDeg: j.axisDeg, periodSec: CAT.jetPeriodSec, phase,
                  spacingPx: j.spacingPx, lobeLengthPx: j.lobePx, tiltDeg: j.tiltDeg, farLobeGain: CAT.farLobeGain,
                  colour: pH2, gain: CAT.jetGain });
      if (src.id === 'hubjet') {
        objs.push({ x, y, p, kind: 3, boundPx: CAT.cavityBoundPx, axisDeg: j.axisDeg, periodSec: 0, phase: 0,
                    spacingPx: 0, lobeLengthPx: CAT.cavityLobePx, tiltDeg: j.tiltDeg, farLobeGain: CAT.farLobeGain,
                    colour: CAT.cavityTint.slice(), gain: CAT.cavityGain });
      }
    }
  }
  return objs.slice(0, MAX_OBJECTS);
}

export function buildCatalogue(comp, sites, layers, opts) {
  sites = sites || []; opts = opts || {};
  const fluxScale = opts.fluxScale ?? 1;
  const pOf = (k) => (layers && layers.slabP ? layers.slabP[k] : slabPOf(k));

  // comp.stars (the Stars group of the shuffle panel, pass3-shuffle S2.7) overrides the CAT and MS defaults.
  const cs = comp.stars || {};
  let list = catalogueSources(comp);
  list = list.concat(seatStars(opts.seats));
  list = list.concat(fieldSpikedStars(sites, list, cs.fieldKeep ?? CAT.fieldKeep, cs.fieldCellPx ?? CAT.fieldCellPx, cs.fieldDmShift ?? 0));
  if (cs.spikeGain != null) for (const s of list) s.spikeGain *= cs.spikeGain;
  if (opts.cepheids) list = list.concat(cepheids(sites, list));

  // Spike rule (4.3): no spikes within 120 px of a site. Seats and protostars never spike.
  for (const s of list) if (s.spikeGain > 0 && near(s.x, s.y, sites, CAT.spikeSiteGapPx)) s.spikeGain = 0;
  list = list.slice(0, MAX_STARS);
  list.forEach((s, i) => { s.slab = slabOfP(s.p); s.order = i; });
  list.sort((a, b) => a.slab - b.slab || a.order - b.order);

  // Fusion stars: structure, class and modes per star. A Cepheid keeps its periodSec slot as tau_display.
  const lcOpts = { timeBaseSec: opts.timeBaseSec ?? cs.timeBaseSec, varCapMag: opts.varCapMag ?? cs.varCapMag, jetPeriodSec: CAT.jetPeriodSec };
  const lcs = list.map((s) => {
    const st = structureOf(s, s.hs || idHash(s.id));
    const lc = lightCurveOf(s, st, lcOpts);
    lc.structure = st; lc.id = s.id; lc.ownAv = s.ownAv || 0;
    if (s.kind === 6) s.periodSec = lc.tauDisp;
    return lc;
  });

  const stars = new Float32Array(256 * 4);
  const slabRange = new Float32Array(24 * 4);
  list.forEach((s, i) => {
    stars.set([s.x, s.y, s.p, s.flux * fluxScale, s.teffK, s.spikeGain, s.kind, s.periodSec], 8 * i);
  });
  for (let k = 0; k < 24; k++) {
    let start = list.findIndex((s) => s.slab === k);
    const count = list.filter((s) => s.slab === k).length;
    if (start < 0) start = 0;
    slabRange.set([start, count, 0, 0], 4 * k);
  }

  const objList = featureObjects(comp, opts.palette || 'nircam');
  const objects = new Float32Array(64 * 4);
  objList.forEach((o, i) => {
    objects.set([o.x, o.y, o.p, o.kind, o.boundPx, o.axisDeg, o.periodSec, o.phase,
                 o.spacingPx, o.lobeLengthPx, o.tiltDeg, o.farLobeGain, o.colour[0], o.colour[1], o.colour[2], o.gain], 16 * i);
  });

  return {
    stars, starCount: list.length, slabRange, objects, objectCount: objList.length, lc: lcs,
    ids: list.map((s) => s.id), slabP: Array.from({ length: 24 }, (_, k) => pOf(k)),
    compositionSha256, siteSetSha256: siteSetSha256(sites),
  };
}

// The 7.4.8 dump. Every number comes from the packed Float32 arrays, so both runtimes compare float32 values.
export function exportCatalogue(cat) {
  const st = cat.stars, ob = cat.objects, sr = cat.slabRange;
  const stars = [];
  for (let i = 0; i < cat.starCount; i++) {
    const b = 8 * i;
    stars.push({ x: st[b], y: st[b + 1], p: st[b + 2], flux: st[b + 3], teffK: st[b + 4], spikeGain: st[b + 5],
                 kind: st[b + 6], periodSec: st[b + 7], slab: slabOfP(st[b + 2]) });
  }
  const slabRange = [];
  for (let k = 0; k < 24; k++) slabRange.push([sr[4 * k], sr[4 * k + 1]]);
  const objects = [];
  for (let i = 0; i < cat.objectCount; i++) {
    const b = 16 * i;
    objects.push({ x: ob[b], y: ob[b + 1], p: ob[b + 2], kind: ob[b + 3], boundPx: ob[b + 4], axisDeg: ob[b + 5],
                   periodSec: ob[b + 6], phase: ob[b + 7], spacingPx: ob[b + 8], lobeLengthPx: ob[b + 9],
                   tiltDeg: ob[b + 10], farLobeGain: ob[b + 11], colour: [ob[b + 12], ob[b + 13], ob[b + 14]], gain: ob[b + 15] });
  }
  return { version: 1, compositionSha256: cat.compositionSha256 || compositionSha256,
           siteSetSha256: cat.siteSetSha256 || siteSetSha256([]), stars, slabRange, objects };
}

// Fusion stars dump (5.1): one row per star in packed order. Numbers the render uses, for the card and tests.
export function lightCurveDump(cat) {
  return (cat.lc || []).map((lc, i) => {
    const st = lc.structure || {};
    return { id: lc.id, kind: cat.stars[8 * i + 6], teffK: cat.stars[8 * i + 4], mass: st.mass, lum: st.lum, radius: st.radius,
             teffDerived: st.teffDerived, burning: st.burning, stage: st.stage, cls: lc.cls, nModes: lc.nu.length,
             tauTrueSec: lc.tauTrue, tauDisplaySec: lc.tauDisp, cStar: lc.cStar, dmTrue: lc.dmTrue, dmDisplay: lc.dmDisp,
             numaxUhz: lc.numaxUhz, dnuUhz: lc.dnuUhz, burstPeriod: lc.burstPeriod };
  });
}
