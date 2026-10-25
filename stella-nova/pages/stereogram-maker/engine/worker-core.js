// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/worker-core.js — the worker message handler
// ----------------------------------------------------------------------------
//  handle(msg) runs one request and gives { reply, transfer }. worker.js
//  wires it to self.onmessage; the node tests call it directly, so the
//  message shape is tested without a worker. The page side is client.js.
//
//  in   { id, op, args: [...] }   (args is the argument list of the op)
//  out  { id, ok: true, result } | { id, ok: false, error: string }
//  transfer: the ArrayBuffers of every typed array in result.
//
//  OPS: depthFromMesh, depthFromText, depthFromImage, depthFromSDF,
//  turntable, sirds, autostereogram, tilesFromPatterns, wheatstonePair,
//  randomDotStereogram, anaglyph, animate, farSeparation,
//  loadModel ([id]), modelDepth ([{ model, ...depth opts }]) and
//  modelTurntable ([{ model, ...depth opts }, n]). The worker keeps the
//  loaded meshes, so a model id loads its GLB once.
//
//  grep -n targets: "export async function handle", "const OPS",
//                   "export function transfers"
// ============================================================================
import { depthFromMesh, depthFromImage, depthFromSDF, turntable } from './depth.js';
import { depthFromMeshGL } from './depth-gl.js';
import { depthFromText } from './text.js';
import { sirds, autostereogram, farSeparation } from './sirds.js';
import { tilesFromPatterns } from './tiles.js';
import { wheatstonePair, randomDotStereogram, anaglyph } from './pairs.js';
import { animate } from './animate.js';
import { loadModel } from '../models/index.js';

const meshes = new Map();
function mesh(id) {
  if (!meshes.has(id)) meshes.set(id, loadModel(id));
  return meshes.get(id);
}
const depth = (m, o) => (o && o.gl && depthFromMeshGL(m, o)) || depthFromMesh(m, o);

const OPS = {
  depthFromMesh: depth, depthFromText, depthFromImage, depthFromSDF, turntable, sirds, autostereogram,
  tilesFromPatterns, wheatstonePair, randomDotStereogram, anaglyph, farSeparation,
  animate: (frames, opts) => animate(frames, opts),
  loadModel: async id => { const m = await mesh(id); return { id: m.id, record: m.record, positions: m.positions.slice(), indices: m.indices.slice(), triangleCount: m.triangleCount }; },
  modelDepth: async o => depth(await mesh(o.model), o),
  modelTurntable: async (o, n) => turntable(await mesh(o.model), n, o),
};
export const OP_NAMES = Object.keys(OPS);

// The ArrayBuffers in a result, each once.
export function transfers(v, out = new Set(), level = 0) {
  if (!v || typeof v !== 'object' || level > 5) return out;
  if (ArrayBuffer.isView(v)) { out.add(v.buffer); return out; }
  for (const k in v) transfers(v[k], out, level + 1);
  return out;
}

export async function handle(msg) {
  const id = msg && msg.id;
  try {
    if (!msg || typeof msg.op !== 'string' || !Object.hasOwn(OPS, msg.op)) throw new Error('unknown op ' + (msg && msg.op));
    const args = Array.isArray(msg.args) ? msg.args : [];
    const result = await OPS[msg.op](...args);
    return { reply: { id, ok: true, result }, transfer: [...transfers(result)] };
  } catch (e) {
    return { reply: { id, ok: false, error: String(e && e.message || e) }, transfer: [] };
  }
}
