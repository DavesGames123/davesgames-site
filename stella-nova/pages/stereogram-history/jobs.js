// ============================================================================
//  STEREOGRAM HISTORY  ·  jobs.js — the heavy work, no DOM
// ----------------------------------------------------------------------------
//  Every image of the page comes from one call: handle(op, args). The
//  page runs it in worker.js (a module worker), or on the main thread
//  when a module worker cannot start (client.js). Node runs it too
//  (tests.mjs).
//
//  The engine and the models are the ones of the maker page, imported
//  read-only: ../stereogram-maker/engine/index.js (the API header lists
//  the shapes) and ../stereogram-maker/models/index.js. When the models
//  module is not there or a model does not load, a depth spec falls back
//  to an analytic torus and the result carries fallback: true.
//
//  DEPTH SPEC (one of)
//    { model: id, w, h, yaw, pitch, fov, norm }   a real 3D object
//    { sdf: shape, w, h, ...params }              engine SDF_SHAPES
//    { grating: { cycles, amp, orient }, w, h }   geometry.gratingDepth
//    { text: 'ABC', w, h }                        engine depthFromText
//  yaw and pitch default to the view of the model record.
//
//  OPS -> result
//    catalog                    { models, tiles, engine }
//    depth   { spec }           DepthMap
//    stereo  { spec, tile, opts, withDepth }  { img, depth? }
//      tile: a TILES id, 'dots' (black and white) or 'color' (coloured).
//    rds     { spec, opts }     { left, right, ana }  (Julesz form)
//    pair    { spec, tile, opts }  { left, right, ana } (Wheatstone form)
//    turn    { spec, n, tile, opts }  { frames }  (a turning model)
//    tile    { id, size }       Image
//
//  setModelReader(fn): tests only, fn(url) -> ArrayBuffer for node.
//
//  grep -n targets: "export async function handle", "async function depthOf",
//    "function tileFor", "export function transfers"
// ============================================================================
import * as E from '../stereogram-maker/engine/index.js';
import { gratingDepth } from './geometry.js';

let modelsMod = null;
async function models() {
  if (!modelsMod) modelsMod = await import('../stereogram-maker/models/index.js').catch(() => ({ MODELS: [], loadModel: null }));
  return modelsMod;
}

// Node has no fetch for file: URLs; tests.mjs passes a byte reader.
let readBytes = null;
export function setModelReader(fn) { readBytes = fn; meshes.clear(); }

const meshes = new Map();
async function meshOf(id) {
  if (meshes.has(id)) return meshes.get(id);
  const M = await models();
  if (!M.loadModel) return null;
  const p = M.loadModel(id, readBytes ? { readBytes } : {}).catch(() => null);
  meshes.set(id, p);
  return p;
}

function recordOf(M, id) { return (M.MODELS || []).find(m => m.id === id) || null; }

// A DepthMap for a spec (see header). Adds fallback: true when a model
// could not load.
async function depthOf(spec) {
  const w = spec.w | 0 || 320, h = spec.h | 0 || 200;
  if (spec.model) {
    const M = await models(), mesh = await meshOf(spec.model);
    if (mesh) {
      const v = (recordOf(M, spec.model) || {}).view || {};
      const d = E.depthFromMesh(mesh, {
        w, h, yaw: spec.yaw ?? v.yaw ?? 0, pitch: spec.pitch ?? v.pitch ?? 0, roll: spec.roll ?? v.roll ?? 0,
        fov: spec.fov ?? (spec.match ? undefined : 22), match: spec.match, fit: spec.fit ?? 0.9, norm: spec.norm ?? 'view', near: spec.near ?? 1, far: spec.far ?? 0.2,
      });
      return d;
    }
    const d = E.depthFromSDF('torus', { w, h });
    d.fallback = true;
    return d;
  }
  if (spec.grating) return gratingDepth(w, h, spec.grating.cycles ?? 6, spec.grating.amp ?? 0.8, spec.grating.orient ?? 'horizontal');
  if (spec.text) return E.depthFromText(spec.text, { w, h });
  return E.depthFromSDF(spec.sdf || 'sphere', Object.assign({}, spec, { w, h }));
}

const SLOW_TILES = new Set(['pd-vortex-lines', 'pd-curl-streams', 'pd-morphogen', 'pd-topo-lines']);
const tiles = new Map();
// A tile Image for a TILES id at a side of size px. null for dot sources.
function tileFor(id, size, seed = 1) {
  if (!id || id === 'dots' || id === 'color') return null;
  const key = id + '@' + size + '#' + seed;
  if (!tiles.has(key)) tiles.set(key, E.tilesFromPatterns([id], size, seed)[0] || null);
  return tiles.get(key);
}

// A single-image stereogram of a model takes the perspective that the
// fused image implies (engine matchedFov), unless the spec sets fov.
function matched(spec, opts = {}) {
  return spec && spec.model && spec.fov == null ? Object.assign({}, spec, { match: { mu: opts.mu ?? 1 / 3 } }) : spec;
}

function sirdsOpts(tile, opts = {}) {
  const o = Object.assign({}, opts);
  if (tile === 'color') o.source = 'color';
  else if (!tile || tile === 'dots') o.source = 'dots';
  else { const t = tileFor(tile, E.farSeparation(o), o.seed ?? 1); if (t) { o.source = 'tile'; o.tile = t; } else o.source = 'dots'; }
  return o;
}

export async function handle(op, a = {}) {
  switch (op) {
    case 'catalog': {
      const M = await models();
      return {
        models: (M.MODELS || []).map(m => ({ id: m.id, name: m.name, kind: m.kind, credit: m.credit, licence: m.licence, url: m.url, view: m.view })),
        // slow: tiles that take 0.5-1.6 s to draw (engine NOTES, 2026-10-24).
        tiles: (E.TILES || []).map(t => ({ id: t.id, name: t.name, family: t.familyName || t.family, slow: SLOW_TILES.has(t.id) })),
        engine: E.TILES.length > 0,
      };
    }
    case 'depth': return depthOf(a.spec);
    case 'stereo': {
      const d = await depthOf(matched(a.spec, a.opts));
      const img = E.sirds(d, sirdsOpts(a.tile, a.opts));
      return { img, depth: a.withDepth ? d : null, fallback: !!d.fallback };
    }
    case 'rds': {
      const d = await depthOf(a.spec);
      const p = E.randomDotStereogram(d, a.opts || {});
      const wall = (a.opts || {}).mode === 'cross' ? { left: p.right, right: p.left } : p;
      return { left: p.left, right: p.right, ana: E.anaglyph(wall.left, wall.right, { mode: 'gray' }), depth: a.withDepth ? d : null, fallback: !!d.fallback };
    }
    case 'pair': {
      const d = await depthOf(a.spec);
      const o = a.opts || {};
      const tex = tileFor(a.tile, o.texSize || 64, o.seed ?? 1);
      const p = E.wheatstonePair(d, tex, o);
      const wall = o.mode === 'cross' ? { left: p.right, right: p.left } : p;
      return { left: p.left, right: p.right, ana: E.anaglyph(wall.left, wall.right, { mode: 'gray' }), fallback: !!d.fallback };
    }
    case 'turn': {
      const n = a.n | 0 || 24, s = a.spec, frames = [];
      let fallback = false;
      for (let k = 0; k < n; k++) {
        const d = await depthOf(matched(Object.assign({}, s, { yaw: (s.yaw ?? 0) + 360 * k / n, norm: 'sphere' }), a.opts));
        fallback = fallback || !!d.fallback;
        frames.push(d);
      }
      return { frames: E.animate(frames, sirdsOpts(a.tile, a.opts)).frames, fallback };
    }
    case 'tile': { const t = tileFor(a.id, a.size | 0 || 96, a.seed ?? 1); return t ? { w: t.w, h: t.h, data: Uint8ClampedArray.from(t.data) } : null; }
    default: throw new Error('jobs: unknown op ' + op);
  }
}

// The ArrayBuffers in a result, for postMessage transfer (no repeats).
export function transfers(v, out = new Set()) {
  if (!v || typeof v !== 'object') return out;
  if (ArrayBuffer.isView(v)) { out.add(v.buffer); return out; }
  if (Array.isArray(v)) { v.forEach(x => transfers(x, out)); return out; }
  for (const k in v) transfers(v[k], out);
  return out;
}
