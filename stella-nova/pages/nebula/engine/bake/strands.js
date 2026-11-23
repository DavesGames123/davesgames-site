// strands.js: the strand trace on the GPU, its readback, and the CPU binning (spec 2.10.1).
// Owner: row A6. Spec: nebula-spec.md 2.2 (StrandPts), 2.10.1, 3.1, 3.2, 7.4 (table), 7.4.4.
//
// Exports (grep -n "^export"):
//   STRAND_SLOTS, STRAND_COLS, STRAND_ROWS, STRAND_POINTS     the slot layout of 2.2
//   STRAND_CODE, CHANNEL, SEG_TEX_W, TILE_TEX_W, TILE_TEXELS  codes, channel index, texture widths
//   encodeStrandW(code, weight), decodeStrandW(w)             the w field of a valid point
//   strandConstants(comp) -> { gRef, gDiss }                  G_ref and G_diss (2.10.1, 2.3)
//   strandTraceChunks(ctx, state, comp)                       generator: trace, readback, release
//   binStrands(points, comp, tier) -> { segs, tiles, perSlab, stats }   CPU, deterministic
//   uploadStrandBins(ctx, state, bins)                        strandSegs, strandTiles (registry)
//
// Data path:
//   Vel (A4), IonH (A5) -> strandTraceChunks -> GPU strandPts -> readback -> state.strandPts (Float32Array)
//   -> binStrands -> uploadStrandBins -> state.strandSegs, state.strandTiles -> slab shell (A7).
//
// Readback layout (2.2): Float32Array(512 * 5856 * 4). Point i of slot s is at texel
// (column s % 512, row i * 183 + s / 512), and the array index is ((row * 512) + column) * 4.
// Each texel is (x, y, z px, w). w = 0: not valid. Valid: w = code + weight / (1 + weight), see
// strands.glsl.js. S strands: point 0 is the launch point. F strands: point 16 is the seed, points
// 17-31 go forward, points 15-0 go backward.
//
// Rules of 2.10.1 that binStrands applies:
//   - keep a polyline with at least 4 valid points;
//   - sort by weight (descending), then slot (ascending); keep at most comp.strands.maxStrands;
//   - one slab per strand: S at the z of its launch point, F at its length-weighted centroid z;
//   - segment ends go to slab texels with the mid-scroll mapping of 3.1: tx = (x - x0_p) W / L_p,
//     ty = y H / 1080 (y up, row 0 at the bottom), with the copies at x +- 5760 that fall inside the slab;
//   - bins of 32 x 32 texels per slab. A segment goes into every tile that its box, padded by
//     3 x widthTexel, touches.

import { TIERS, SLAB_COUNT, CONTENT_W, CONTENT_H, DEPTH, slabP, slabX0, slabSpan, tierOf } from '../params.js';
import { program } from '../gl/context.js';
import { runQuadPass, readFloat } from '../gl/passes.js';
import { STRAND_SEED_FS, STRAND_S_FS, STRAND_F_FS } from './shaders/strands.glsl.js';

export const STRAND_SLOTS = 93312, STRAND_COLS = 512, STRAND_ROWS = 183, STRAND_POINTS = 32;
export const STRAND_CODE = { S_H: 1, S_HE: 2, F_PAH: 3, F_DARK: 4, V_FLOW: 5 };
export const CHANNEL = { He: 0, H: 1, Front: 2, PAH: 3, H2: 4, Shock: 5, Ejecta: 6, Scatter: 7 };
export const SEG_TEX_W = 4096, TILE_TEX_W = 4096, TILE_TEXELS = 32;

const QHAT_DENOM = 1.2156e45;          // 4 pi alpha_B n0^2 l^3 (2.1)
const LOG_QFUV_O7V = 49.0;             // 2.1 table, O7 V
const F_SEED_POINT = 16;
const S_STEP_PX = 5;
const F_STEP_PX = 10;                  // attempt 2: F tubes up to 31 x 10 px
const F_ABSORB = 0.15;
const RHO_STOP = 1e-3;
const LATTICE_N = [144, 27, 24];

export function encodeStrandW(code, weight) {
  const c = Math.max(weight, 0);
  return code + Math.min(c / (1 + c), 0.999);
}

// Returns { code, weight } or null for a point that is not valid.
export function decodeStrandW(w) {
  if (!(w >= 1)) return null;
  const code = Math.floor(w);
  const f = w - code;
  return { code, weight: f / (1 - f) };
}

// G_ref = QhatFUV(cl1) / 60^2 (cl1 at 600 px, no dust). G_diss = QhatFUV(O7 V) e^-1 / 30^2 (2.3).
export function strandConstants(comp) {
  const cl1 = (comp.sources || []).find((s) => s.id === 'cl1');
  const logQfuv = cl1 && Number.isFinite(cl1.logQfuv) ? cl1.logQfuv : 50.09;
  const gRef = Math.pow(10, logQfuv) / QHAT_DENOM / 3600;
  const gDiss = Math.pow(10, LOG_QFUV_O7V) / QHAT_DENOM * Math.exp(-1) / 900;
  return { gRef, gDiss };
}

function tierObj(tier) {
  if (typeof tier === 'string') return TIERS[tier];
  if (tier && tier.dims) return tier;
  return TIERS.W;
}

function resource(ctx, state, name) {
  const v = state[name];
  if (v && v.tex) return v;
  const e = ctx.registry.get(name);
  if (!e) throw new Error(`[strands] ${name} is not live`);
  return e;
}

const programs = new WeakMap();   // gl -> { seed, s, f }
function strandPrograms(gl) {
  let p = programs.get(gl);
  if (!p) {
    p = {
      seed: program(gl, 'strands.seed', null, STRAND_SEED_FS),
      s: program(gl, 'strands.s', null, STRAND_S_FS),
      f: program(gl, 'strands.f', null, STRAND_F_FS),
    };
    programs.set(gl, p);
  }
  return p;
}

// Copy the 512 x 183 draw result into rows 183 p .. 183 p + 182 of strandPts.
// copyTexSubImage2D is the path of 2.10.1. If the driver refuses a float copy, a blit does the same.
function copyRows(ctx, src, dst, point, mode) {
  const { gl } = ctx;
  const y = point * STRAND_ROWS;
  if (mode.useBlit) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbos[0]);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbos[0]);
    gl.blitFramebuffer(0, 0, STRAND_COLS, STRAND_ROWS, 0, y, STRAND_COLS, y + STRAND_ROWS, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    return;
  }
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbos[0]);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindTexture(gl.TEXTURE_2D, dst.tex);
  gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, y, 0, 0, STRAND_COLS, STRAND_ROWS);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  if (!mode.checked) {
    mode.checked = true;
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      console.info(`[strands] copyTexSubImage2D of RGBA32F gave 0x${err.toString(16)}; a blit is used`);
      mode.useBlit = true;
      copyRows(ctx, src, dst, point, mode);
    }
  }
}

// Trace both families on the GPU, read back the [point][slot] history, release the GPU textures.
// Reads state.Vel (or registry 'Vel') and state.IonH (or registry 'IonH').
// Writes state.strandPts = Float32Array(512 * 5856 * 4) and state.diag.strands.
// comp.strands.S and comp.strands.F switch the families. Yields after each chunk of draws.
export function* strandTraceChunks(ctx, state, comp) {
  const { gl, registry } = ctx;
  const t0 = performance.now();
  const tier = tierObj(ctx.tier);
  const st = comp.strands || {};
  const { gRef, gDiss } = strandConstants(comp);
  const progs = strandPrograms(gl);
  const vel = resource(ctx, state, 'Vel');
  const ion = resource(ctx, state, 'IonH');

  const pos0 = registry.tex2D('strandPos0', STRAND_COLS, STRAND_ROWS, 'RGBA32F', { filter: 'nearest' });
  const pos1 = registry.tex2D('strandPos1', STRAND_COLS, STRAND_ROWS, 'RGBA32F', { filter: 'nearest' });
  const pts = registry.tex2D('strandPts', STRAND_COLS, STRAND_ROWS * STRAND_POINTS, 'RGBA32F', { filter: 'nearest' });
  state.strandPos0 = pos0; state.strandPos1 = pos1;

  const lattice = st.lattice || [40, 40, 80];
  const base = {
    _Box: [CONTENT_W, CONTENT_H, DEPTH],
    _Cell: tier.cell,
    _Lattice: lattice,
    _LatticeN: LATTICE_N,
    _StepPx: S_STEP_PX,
    _StepPxF: F_STEP_PX,
    _GRef: gRef,
    _GDiss: gDiss,
    _RhoStop: RHO_STOP,
    _EnableS: st.S === false ? 0 : 1,
    _EnableF: st.F === false ? 0 : 1,
    _KappaSeed: 0.02,
    _KappaKeep: 0.01,
    _SBand: 0.12,
    _FlowRho: 0.5,
  };
  const mode = { useBlit: false, checked: false };

  // Seed draw into strandPos0.
  runQuadPass(ctx, progs.seed, { target: pos0, uniforms: base, textures: { _Vel: vel, _IonH: ion } });
  yield 'strands: seed';

  const draw = (prog, point, from, prev, dirSign) => {
    runQuadPass(ctx, prog, {
      target: pos1,
      uniforms: { ...base, _Point: point, _From: from, _Prev: prev, _DirSign: dirSign },
      textures: { _Vel: vel, _IonH: ion, _Pts: pts, _Seed: pos0 },
    });
    copyRows(ctx, pos1, pts, point, mode);
  };

  // S pass: points 0 .. 31 in order. It writes every row, so stale data never survives.
  for (let p = 0; p < STRAND_POINTS; p++) {
    draw(progs.s, p, p - 1, -1, 1);
    if ((p & 7) === 7) yield `strands: S point ${p}`;
  }
  // F pass: the seed at 16, forward 17 .. 31, then backward 15 .. 0.
  draw(progs.f, F_SEED_POINT, -1, -1, 1);
  for (let p = F_SEED_POINT + 1; p < STRAND_POINTS; p++) draw(progs.f, p, p - 1, p - 1 > F_SEED_POINT ? p - 2 : -1, 1);
  yield 'strands: F forward';
  for (let p = F_SEED_POINT - 1; p >= 0; p--) draw(progs.f, p, p + 1, p + 1 < F_SEED_POINT ? p + 2 : -1, -1);
  yield 'strands: F backward';

  // Readback in chunks of 8 points (1464 rows, 12 MB each).
  const out = new Float32Array(STRAND_COLS * STRAND_ROWS * STRAND_POINTS * 4);
  const rowsPerChunk = STRAND_ROWS * 8;
  for (let y = 0; y < STRAND_ROWS * STRAND_POINTS; y += rowsPerChunk) {
    const h = Math.min(rowsPerChunk, STRAND_ROWS * STRAND_POINTS - y);
    const part = readFloat(ctx, pts, 0, [0, y, STRAND_COLS, h]);
    out.set(part, y * STRAND_COLS * 4);
    yield `strands: readback rows ${y}-${y + h - 1}`;
  }

  registry.release('strandPts');
  registry.release('strandPos0');
  registry.release('strandPos1');
  state.strandPos0 = null; state.strandPos1 = null;
  state.strandPts = out;

  let seededS = 0, seededF = 0, seededV = 0;
  for (let s = 0; s < STRAND_SLOTS; s++) {
    const i0 = ((Math.floor(s / STRAND_COLS)) * STRAND_COLS + (s % STRAND_COLS)) * 4 + 3;
    const iF = ((F_SEED_POINT * STRAND_ROWS + Math.floor(s / STRAND_COLS)) * STRAND_COLS + (s % STRAND_COLS)) * 4 + 3;
    const a = decodeStrandW(out[i0]);
    const b = decodeStrandW(out[iF]);
    if (a && a.code <= 2) seededS++;
    else if (b && b.code === STRAND_CODE.V_FLOW) seededV++;
    else if (b && b.code >= 3) seededF++;
  }
  state.diag = state.diag || {};
  state.diag.strands = {
    seededS, seededF, seededV, gRef, gDiss, copyPath: mode.useBlit ? 'blit' : 'copyTexSubImage2D',
    traceMs: performance.now() - t0,
  };
}

function texelIndex(point, slot) {
  const row = point * STRAND_ROWS + Math.floor(slot / STRAND_COLS);
  return (row * STRAND_COLS + (slot % STRAND_COLS)) * 4;
}

function segStyle(code, weight) {
  switch (code) {
    case STRAND_CODE.S_H: return { channel: CHANNEL.H, weight, absorb: 0, family: 'S' };
    case STRAND_CODE.S_HE: return { channel: CHANNEL.He, weight, absorb: 0, family: 'S' };
    case STRAND_CODE.F_PAH: return { channel: CHANNEL.PAH, weight, absorb: F_ABSORB, family: 'F' };
    case STRAND_CODE.V_FLOW: return { channel: CHANNEL.PAH, weight, absorb: F_ABSORB, family: 'F' };   // streamline, takes as F
    default: return { channel: CHANNEL.PAH, weight: 0, absorb: F_ABSORB, family: 'F' };
  }
}

// Foreground restraint (3.2, C3): strands in slabs 0-5 add no absorption, so they never add to the
// foreground tau cap of 0.35. They keep their emission.
const FG_SLABS = 6;
function slabOfZ(z) { return Math.min(SLAB_COUNT - 1, Math.max(0, Math.floor(z / 80))); }

// CPU binning of the readback. points: Float32Array(512 * 5856 * 4). tier: 'W', 'U' or a TIERS entry.
// Returns:
//   segs    Float32Array(8 n): per segment (ax, ay, bx, by) texels, (channel, weight, absorb, slab);
//           grouped by slab, then tile; a segment that touches more tiles is stored once per tile
//   tiles   Uint32Array(2 m): per tile (first segment, count); slab k starts at perSlab[k].tileBase
//   perSlab [{ slab, tier, layer, w, h, tilesX, tilesY, tileBase, segFirst, segCount, strands }] x 24
//   stats   { candidates, kept, dropped, S, F, segments, segEntries, bytes }
export function binStrands(points, comp, tier) {
  const T = tierObj(tier);
  const st = (comp && comp.strands) || {};
  const maxStrands = Number.isFinite(st.maxStrands) ? st.maxStrands : 20000;
  const pad = 3 * (Number.isFinite(st.widthTexel) ? st.widthTexel : 0.7);
  if (!points || points.length < STRAND_COLS * STRAND_ROWS * STRAND_POINTS * 4) {
    throw new Error('[strands] binStrands needs the 512 x 5856 x 4 readback');
  }

  // 1. Polylines with at least 4 valid points.
  const strands = [];
  for (let slot = 0; slot < STRAND_SLOTS; slot++) {
    let first = -1, valid = 0, w = 0;
    for (let i = 0; i < STRAND_POINTS; i++) {
      const v = points[texelIndex(i, slot) + 3];
      if (v >= 1) { valid++; if (first < 0) { first = i; w = v; } }
    }
    if (valid < 4) continue;
    const dec = decodeStrandW(w);
    strands.push({ slot, code: dec.code, weight: dec.weight });
  }
  const candidates = strands.length;

  // 2. Sort by weight (descending), then slot. Keep at most maxStrands.
  strands.sort((a, b) => (b.weight - a.weight) || (a.slot - b.slot));
  const kept = strands.slice(0, maxStrands);

  // 3. One slab per strand, and the segments in slab texels.
  const perSlab = [];
  for (let k = 0; k < SLAB_COUNT; k++) {
    const t = tierOf(k);
    const [w, h] = t.tier === 'near' ? T.near : T.far;
    const p = slabP(k);
    perSlab.push({
      slab: k, tier: t.tier, layer: t.layer, w, h,
      tilesX: Math.ceil(w / TILE_TEXELS), tilesY: Math.ceil(h / TILE_TEXELS),
      tileBase: 0, segFirst: 0, segCount: 0, strands: 0,
      x0: slabX0(p), span: slabSpan(p), p,
    });
  }
  let tileBase = 0;
  for (const s of perSlab) { s.tileBase = tileBase; tileBase += s.tilesX * s.tilesY; }
  const tileTotal = tileBase;

  const segList = [];      // { slab, ax, ay, bx, by, channel, weight, absorb, tx0, tx1, ty0, ty1 }
  let nS = 0, nF = 0;
  for (const s of kept) {
    const style = segStyle(s.code, s.weight);
    const pts = [];
    for (let i = 0; i < STRAND_POINTS; i++) {
      const j = texelIndex(i, s.slot);
      pts.push(points[j + 3] >= 1 ? [points[j], points[j + 1], points[j + 2]] : null);
    }
    let z;
    if (style.family === 'S') {
      const p0 = pts.find((q) => q);
      z = p0[2];
      nS++;
    } else {
      let sw = 0, sz = 0;
      for (let i = 0; i + 1 < STRAND_POINTS; i++) {
        const a = pts[i], b = pts[i + 1];
        if (!a || !b) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        sw += len; sz += len * 0.5 * (a[2] + b[2]);
      }
      if (sw > 0) z = sz / sw;
      else { const v = pts.filter((q) => q); z = v.reduce((acc, q) => acc + q[2], 0) / v.length; }
      nF++;
    }
    const k = slabOfZ(z);
    const sl = perSlab[k];
    sl.strands++;
    const sx = sl.w / sl.span, sy = sl.h / CONTENT_H;
    for (let i = 0; i + 1 < STRAND_POINTS; i++) {
      const a = pts[i], b = pts[i + 1];
      if (!a || !b) continue;
      for (const shift of [-CONTENT_W, 0, CONTENT_W]) {
        const ax = (a[0] + shift - sl.x0) * sx, bx = (b[0] + shift - sl.x0) * sx;
        const ay = a[1] * sy, by = b[1] * sy;
        const lx = Math.min(ax, bx) - pad, hx = Math.max(ax, bx) + pad;
        const ly = Math.min(ay, by) - pad, hy = Math.max(ay, by) + pad;
        if (hx < 0 || lx >= sl.w || hy < 0 || ly >= sl.h) continue;
        segList.push({
          slab: k, ax, ay, bx, by, channel: style.channel, weight: style.weight, absorb: k < FG_SLABS ? 0 : style.absorb,
          tx0: Math.max(0, Math.floor(lx / TILE_TEXELS)), tx1: Math.min(sl.tilesX - 1, Math.floor(hx / TILE_TEXELS)),
          ty0: Math.max(0, Math.floor(ly / TILE_TEXELS)), ty1: Math.min(sl.tilesY - 1, Math.floor(hy / TILE_TEXELS)),
        });
      }
    }
  }

  // 4. Tile bins: count, prefix sum, fill. The fill order is the segment order, so it is deterministic.
  const counts = new Uint32Array(tileTotal);
  for (const g of segList) {
    const sl = perSlab[g.slab];
    for (let ty = g.ty0; ty <= g.ty1; ty++) for (let tx = g.tx0; tx <= g.tx1; tx++) counts[sl.tileBase + ty * sl.tilesX + tx]++;
  }
  const tiles = new Uint32Array(tileTotal * 2);
  let acc = 0;
  for (let i = 0; i < tileTotal; i++) { tiles[2 * i] = acc; tiles[2 * i + 1] = counts[i]; acc += counts[i]; }
  const segEntries = acc;
  const segs = new Float32Array(segEntries * 8);
  const cursor = new Uint32Array(tileTotal);
  for (const g of segList) {
    const sl = perSlab[g.slab];
    for (let ty = g.ty0; ty <= g.ty1; ty++) for (let tx = g.tx0; tx <= g.tx1; tx++) {
      const ti = sl.tileBase + ty * sl.tilesX + tx;
      const o = (tiles[2 * ti] + cursor[ti]++) * 8;
      segs[o] = g.ax; segs[o + 1] = g.ay; segs[o + 2] = g.bx; segs[o + 3] = g.by;
      segs[o + 4] = g.channel; segs[o + 5] = g.weight; segs[o + 6] = g.absorb; segs[o + 7] = g.slab;
    }
  }
  for (const sl of perSlab) {
    const tEnd = sl.tileBase + sl.tilesX * sl.tilesY;
    sl.segFirst = tileTotal ? tiles[2 * sl.tileBase] : 0;
    sl.segCount = (tEnd < tileTotal ? tiles[2 * tEnd] : segEntries) - sl.segFirst;
  }

  const segRows = Math.max(1, Math.ceil((segEntries * 2) / SEG_TEX_W));
  const tileRows = Math.max(1, Math.ceil(tileTotal / TILE_TEX_W));
  return {
    segs, tiles, perSlab,
    stats: {
      candidates, kept: kept.length, dropped: candidates - kept.length, S: nS, F: nF,
      segments: segList.length, segEntries, bytes: (segRows * SEG_TEX_W + tileRows * TILE_TEX_W) * 16,
    },
  };
}

// Upload the bins as RGBA32F textures through the registry:
//   strandSegs  SEG_TEX_W wide, 2 texels per segment entry
//   strandTiles TILE_TEX_W wide, one texel per tile = (first, count, slab, 0)
// Sets state.strandSegs, state.strandTiles and state.strandBins = { perSlab, stats }.
export function uploadStrandBins(ctx, state, bins) {
  const { registry } = ctx;
  const nSeg = bins.segs.length / 8;
  const segRows = Math.max(1, Math.ceil((nSeg * 2) / SEG_TEX_W));
  const segData = new Float32Array(segRows * SEG_TEX_W * 4);
  segData.set(bins.segs);
  const nTile = bins.tiles.length / 2;
  const tileRows = Math.max(1, Math.ceil(nTile / TILE_TEX_W));
  const tileData = new Float32Array(tileRows * TILE_TEX_W * 4);
  for (const sl of bins.perSlab) {
    for (let i = 0; i < sl.tilesX * sl.tilesY; i++) {
      const ti = sl.tileBase + i;
      tileData[4 * ti] = bins.tiles[2 * ti];
      tileData[4 * ti + 1] = bins.tiles[2 * ti + 1];
      tileData[4 * ti + 2] = sl.slab;
    }
  }
  state.strandSegs = registry.tex2D('strandSegs', SEG_TEX_W, segRows, 'RGBA32F', { filter: 'nearest', data: segData });
  state.strandTiles = registry.tex2D('strandTiles', TILE_TEX_W, tileRows, 'RGBA32F', { filter: 'nearest', data: tileData });
  state.strandBins = { perSlab: bins.perSlab, stats: bins.stats };
  state.diag = state.diag || {};
  state.diag.strands = Object.assign(state.diag.strands || {}, bins.stats, {
    uploadBytes: state.strandSegs.bytes + state.strandTiles.bytes,
  });
}

// ---- Pass 3 filaments: the 3D tube store (pass3-filaments.md, attempt 1) ----
// The strands are now filaments that conserve light (F2). A tube does not add light. It takes the
// fraction phiE of the volume emission (and phiD of the dust) of the cells it passes through, and the
// pre-light writes the volume with the same fraction removed (TubeLen, F4.6). There is no 25 % cap.
// Steps:
//   (1) polylines with at least 4 valid points, sorted by weight (descending), then slot;
//   (2) dedupe (F4.4): an occupancy bitset per family with cell 0.5 dSep. A walk out from the seed
//       ends on a side at the first point whose cell or a face neighbour is set. Keep at least 4 points;
//   (3) segments of every 2nd S trace point (5 px step) or every F point (10 px step), plus the last
//       point, so a segment is at most 10 px. The end segments of a
//       tube with 3 or more segments carry half weight (taper);
//   (4) TubeLen: the tube length per volume, per family, on the 288 x 54 x 48 grid of 20 x 20 x 40 px
//       cells, smoothed with a 1-2-1 kernel per axis (the sum stays). f = lv dSep^2 is the share of the
//       cross-section that the tubes hold. The emission loses e = phiE min(1, fF + fS). The dust loses
//       phiD min(1, fF), but not in front of z = 480 (the foreground restraint of 3.2);
//   (5) each tube segment gets w = phiE dSep^2 min(1, f) / f / (1 - e) (px^2) at its mid point. The
//       march multiplies w by the reduced volume emission at the ray, so the tube gets back the share
//       that the volume lost. The dust ratio r = wD / w goes into the entry;
//   (6) each segment goes into every bin of the 144 x 27 x 96 grid (40 x 40 x 20 px, one bin per march
//       step) that its box touches after an expansion of 6.75 + 3 Re px in x and 3 Re px in y (x wraps);
//   (7) entries are 2 texels: (ax, ay, az, bx), (by, bz, w, c) relative to the bin origin,
//       c = 1 + r for the F family (Re 1.39 px) and -1 for the S family (Re 1.03 px);
//   (8) one RGBA8 index texel per bin (512 x 729): rgb = the first entry (24 bits), a = the count;
//   (9) caps: at most STORE_CAP entries and STORE_PER_BIN per bin; a strand that breaks a cap drops whole.
// Returns { seg: Float32Array(8 n), bin: Uint8Array(512 x 729 x 4), tube: Uint8Array(288 x 54 x 48 x 4), stats }.
// tube: r = e x 255, g = dust share x 255 (RGBA8 3D, linear, read by Prelight).
export const STORE_BINS = [144, 27, 96], STORE_BIN_PX = [40, 40, 20], STORE_CAP = 196608, STORE_PER_BIN = 32;
export const STORE_BIN_TEX = [512, 729];
export const TUBE_GRID = [288, 54, 48], TUBE_CELL = [20, 20, 40];
export const TUBE_RADIUS = { F: 1.3, S: 0.9 };
const FIL_DEFAULTS = { phiE: 0.5, phiD: 0.3, dSepF: 32, dSepS: 12, fgZ: 480 };
const reOf = (R) => Math.sqrt(R * R + 0.25);

function bitGrid(cellPx) {
  const n = [Math.ceil(CONTENT_W / cellPx), Math.ceil(CONTENT_H / cellPx), Math.ceil(DEPTH / cellPx)];
  return { cellPx, n, bits: new Uint32Array(Math.ceil((n[0] * n[1] * n[2]) / 32)) };
}
function cellOf(g, p) {
  const nx = g.n[0];
  let i = Math.floor(p[0] / g.cellPx) % nx; if (i < 0) i += nx;
  const j = Math.floor(p[1] / g.cellPx), k = Math.floor(p[2] / g.cellPx);
  if (j < 0 || j >= g.n[1] || k < 0 || k >= g.n[2]) return null;
  return [i, j, k];
}
function bitAt(g, i, j, k) {
  const nx = g.n[0];
  if (j < 0 || j >= g.n[1] || k < 0 || k >= g.n[2]) return 0;
  i = ((i % nx) + nx) % nx;
  const b = i + nx * (j + g.n[1] * k);
  return (g.bits[b >>> 5] >>> (b & 31)) & 1;
}
function setBit(g, p) {
  const c = cellOf(g, p); if (!c) return;
  const b = c[0] + g.n[0] * (c[1] + g.n[1] * c[2]);
  g.bits[b >>> 5] |= 1 << (b & 31);
}
function occupied(g, p) {
  const c = cellOf(g, p); if (!c) return true;
  const [i, j, k] = c;
  return !!(bitAt(g, i, j, k) || bitAt(g, i - 1, j, k) || bitAt(g, i + 1, j, k) || bitAt(g, i, j - 1, k)
    || bitAt(g, i, j + 1, k) || bitAt(g, i, j, k - 1) || bitAt(g, i, j, k + 1));
}
const wrapDx = (dx) => dx - CONTENT_W * Math.floor((dx + 0.5 * CONTENT_W) / CONTENT_W);

// 1-2-1 smoothing per axis: x periodic; y and z reflect at the walls. The sum stays, so the length does.
function smooth121(a, n) {
  const [NX, NY, NZ] = n;
  let src = a, dst = new Float32Array(a.length);
  const spare = new Float32Array(a.length);
  for (let ax = 0; ax < 3; ax++) {
    const N = n[ax], st = ax === 0 ? 1 : (ax === 1 ? NX : NX * NY);
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const idx = i + NX * (j + NY * k), c = ax === 0 ? i : (ax === 1 ? j : k);
      let lo, hi;
      if (ax === 0) { lo = c === 0 ? idx + (N - 1) : idx - 1; hi = c === N - 1 ? idx - (N - 1) : idx + 1; }
      else { lo = c === 0 ? idx : idx - st; hi = c === N - 1 ? idx : idx + st; }
      dst[idx] = 0.25 * src[lo] + 0.5 * src[idx] + 0.25 * src[hi];
    }
    const done = dst;
    dst = (src === a) ? spare : src;
    src = done;
  }
  return src;
}

export function binStrands3D(points, comp) {
  const st = (comp && comp.strands) || {};
  const fil = { ...FIL_DEFAULTS, ...(st.filaments || {}) };
  const maxStrands = Number.isFinite(st.maxStrands) ? Math.max(st.maxStrands, 60000) : 60000;
  if (!points || points.length < STRAND_COLS * STRAND_ROWS * STRAND_POINTS * 4) {
    throw new Error('[strands] binStrands3D needs the 512 x 5856 x 4 readback');
  }
  // 1. Candidates.
  const strands = [];
  for (let slot = 0; slot < STRAND_SLOTS; slot++) {
    let first = -1, valid = 0, w = 0;
    for (let i = 0; i < STRAND_POINTS; i++) {
      const v = points[texelIndex(i, slot) + 3];
      if (v >= 1) { valid++; if (first < 0) { first = i; w = v; } }
    }
    if (valid < 4) continue;
    const dec = decodeStrandW(w);
    strands.push({ slot, code: dec.code, weight: dec.weight });
  }
  const candidates = strands.length;
  strands.sort((a, b) => (b.weight - a.weight) || (a.slot - b.slot));
  const limited = strands.slice(0, maxStrands);
  // 2. Dedupe per family.
  const occ = { F: bitGrid(0.5 * fil.dSepF), S: bitGrid(0.5 * fil.dSepS) };
  const tubes = [];
  let dedupeDrops = 0;
  for (const s of limited) {
    const fam = segStyle(s.code, s.weight).family;
    const g = occ[fam];
    const at = (i) => { const j = texelIndex(i, s.slot); return points[j + 3] >= 1 ? [points[j], points[j + 1], points[j + 2]] : null; };
    let run = [];
    if (fam === 'S') {
      let i = 0; while (i < STRAND_POINTS && !at(i)) i++;
      for (; i < STRAND_POINTS; i++) { const p = at(i); if (!p || occupied(g, p)) break; run.push(p); }
    } else {
      const seed = at(F_SEED_POINT);
      if (seed && !occupied(g, seed)) {
        const fwd = [], back = [];
        for (let i = F_SEED_POINT + 1; i < STRAND_POINTS; i++) { const p = at(i); if (!p || occupied(g, p)) break; fwd.push(p); }
        for (let i = F_SEED_POINT - 1; i >= 0; i--) { const p = at(i); if (!p || occupied(g, p)) break; back.push(p); }
        run = back.reverse().concat([seed], fwd);
      }
    }
    if (run.length < 4) { dedupeDrops++; continue; }
    for (let i = 0; i < run.length; i++) {
      setBit(g, run[i]);
      if (i + 1 < run.length) {
        const a = run[i], b = run[i + 1];
        setBit(g, [a[0] + 0.5 * wrapDx(b[0] - a[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])]);
      }
    }
    tubes.push({ fam, weight: s.weight, pts: run });
  }
  // 3. Segments (every 2nd point and the last), with x continuous across the seam.
  for (const t of tubes) {
    const res = [];
    const stride = t.fam === 'S' ? 2 : 1;               // S points 5 px apart, F points 10 px apart
    for (let i = 0; i < t.pts.length; i += stride) res.push(t.pts[i]);
    if (res[res.length - 1] !== t.pts[t.pts.length - 1]) res.push(t.pts[t.pts.length - 1]);
    const segs = [];
    const n = res.length - 1;
    let prev = res[0];
    for (let i = 0; i < n; i++) {
      const a = prev, b = [a[0] + wrapDx(res[i + 1][0] - a[0]), res[i + 1][1], res[i + 1][2]];
      const taper = (n >= 3 && (i === 0 || i === n - 1)) ? 0.5 : 1.0;
      segs.push({ a, b, taper, len: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) });
      prev = b;
    }
    t.segs = segs;
  }
  // 4. TubeLen per family.
  const [GX, GY, GZ] = TUBE_GRID, nCell = GX * GY * GZ, cellV = TUBE_CELL[0] * TUBE_CELL[1] * TUBE_CELL[2];
  const cellIndex = (p) => {
    let i = Math.floor(p[0] / TUBE_CELL[0]) % GX; if (i < 0) i += GX;
    const j = Math.min(GY - 1, Math.max(0, Math.floor(p[1] / TUBE_CELL[1])));
    const k = Math.min(GZ - 1, Math.max(0, Math.floor(p[2] / TUBE_CELL[2])));
    return i + GX * (j + GY * k);
  };
  const lenF = new Float32Array(nCell), lenS = new Float32Array(nCell);
  for (const t of tubes) {
    const arr = t.fam === 'S' ? lenS : lenF;
    for (const s of t.segs) {
      for (let q = 0; q < 4; q++) {                        // 4 sub-points per segment (segments <= 10 px)
        const u = (q + 0.5) / 4;
        const p = [s.a[0] + u * (s.b[0] - s.a[0]), s.a[1] + u * (s.b[1] - s.a[1]), s.a[2] + u * (s.b[2] - s.a[2])];
        arr[cellIndex(p)] += 0.25 * s.len * s.taper / cellV;
      }
    }
  }
  const lvF = smooth121(lenF, TUBE_GRID), lvS = smooth121(lenS, TUBE_GRID);
  const dF2 = fil.dSepF * fil.dSepF, dS2 = fil.dSepS * fil.dSepS;
  const eRed = new Float32Array(nCell), dRed = new Float32Array(nCell);
  const tube = new Uint8Array(nCell * 4);
  const fgK = Math.floor(fil.fgZ / TUBE_CELL[2]);
  let eSum = 0, eN = 0;
  for (let c = 0; c < nCell; c++) {
    const fF = lvF[c] * dF2, fS = lvS[c] * dS2;
    const e = fil.phiE * Math.min(1, fF + fS);
    const k = Math.floor(c / (GX * GY));
    const d = k < fgK ? 0 : fil.phiD * Math.min(1, fF);
    const eq = Math.round(e * 255), dq = Math.round(d * 255);
    eRed[c] = eq / 255; dRed[c] = dq / 255;                // the values Prelight reads at the cell centre
    tube[4 * c] = eq; tube[4 * c + 1] = dq; tube[4 * c + 3] = 255;
    if (eq > 0) { eSum += eRed[c]; eN++; }
  }
  // 5. The light of each segment, from the cell of its mid point.
  const coef = (t, p) => {
    const c = cellIndex(p);
    const fF = lvF[c] * dF2, fS = lvS[c] * dS2, f = fF + fS;
    if (!(f > 1e-9)) return { w: 0, r: 0 };
    const dX2 = t.fam === 'S' ? dS2 : dF2;
    const w = fil.phiE * dX2 * Math.min(1, f) / f / Math.max(1 - eRed[c], 0.05);
    let r = 0;
    if (t.fam === 'F' && dRed[c] > 0) {
      const wD = fil.phiD * dF2 * Math.min(1, fF) / Math.max(fF, 1e-9) / Math.max(1 - dRed[c], 0.05);
      r = Math.min(wD / w, 3.9);
    }
    return { w, r };
  };
  // 6-9. Bins.
  const [NX, NY, NZ] = STORE_BINS, [BX, BY, BZ] = STORE_BIN_PX;
  const nBins = NX * NY * NZ;
  const lists = Array.from({ length: nBins }, () => []);
  let entries = 0, segments = 0, keptN = 0, capDrops = 0, binDrops = 0, nS = 0, nF = 0;
  for (const t of tubes) {
    const Re = reOf(TUBE_RADIUS[t.fam]);
    const padX = 6.75 + 3 * Re, padY = 3 * Re;
    const mine = [];
    let nSeg = 0;
    for (const s of t.segs) {
      const a = s.a, b = s.b;
      const { w, r } = coef(t, [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])]);
      const wt = w * s.taper;
      if (!(wt > 0)) continue;
      const c = t.fam === 'S' ? -1 : 1 + r;
      const x0 = Math.min(a[0], b[0]) - padX, x1 = Math.max(a[0], b[0]) + padX;
      const y0 = Math.max(0, Math.min(a[1], b[1]) - padY), y1 = Math.min(CONTENT_H - 1e-3, Math.max(a[1], b[1]) + padY);
      const z0 = Math.max(0, Math.min(a[2], b[2])), z1 = Math.min(DEPTH - 1e-3, Math.max(a[2], b[2]));
      if (y1 < y0 || z1 < z0) continue;
      for (let bz = Math.floor(z0 / BZ); bz <= Math.floor(z1 / BZ); bz++) {
        for (let by = Math.floor(y0 / BY); by <= Math.floor(y1 / BY); by++) {
          for (let bxu = Math.floor(x0 / BX); bxu <= Math.floor(x1 / BX); bxu++) {
            const bx = ((bxu % NX) + NX) % NX;
            const ox = bx * BX, oy = by * BY, oz = bz * BZ;
            const ax = wrapDx(a[0] - ox), bxr = ax + (b[0] - a[0]);
            mine.push([bx + NX * (by + NY * bz), ax, a[1] - oy, a[2] - oz, bxr, b[1] - oy, b[2] - oz, wt, c]);
          }
        }
      }
      nSeg++;
    }
    if (!mine.length) continue;
    if (entries + mine.length > STORE_CAP) { capDrops++; continue; }
    let full = false;
    for (const e of mine) if (lists[e[0]].length >= STORE_PER_BIN) { full = true; break; }
    if (full) { binDrops++; continue; }
    keptN++; segments += nSeg;
    if (t.fam === 'S') nS++; else nF++;
    for (const e of mine) { lists[e[0]].push(e); entries++; }
  }
  const seg = new Float32Array(entries * 8);
  const bin = new Uint8Array(STORE_BIN_TEX[0] * STORE_BIN_TEX[1] * 4);
  let at = 0, maxCount = 0;
  for (let i = 0; i < nBins; i++) {
    const l = lists[i];
    bin[4 * i] = at & 255; bin[4 * i + 1] = (at >> 8) & 255; bin[4 * i + 2] = (at >> 16) & 255; bin[4 * i + 3] = l.length;
    maxCount = Math.max(maxCount, l.length);
    for (const e of l) { seg.set(e.slice(1), 8 * at); at++; }
  }
  return {
    seg, bin, tube,
    stats: { candidates, tubes: tubes.length, kept: keptN, dropped: candidates - keptN, dedupeDrops, capDrops, binDrops,
      S: nS, F: nF, segments, entries, maxCount, meanEmissionShare: eN ? eSum / eN : 0, cellsReduced: eN,
      bytes: Math.max(1, Math.ceil(2 * entries / 1024)) * 1024 * 8 + STORE_BIN_TEX[0] * STORE_BIN_TEX[1] * 4 },
  };
}
