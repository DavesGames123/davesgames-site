// ============================================================================
//  STEREOGRAM MAKER  ·  engine-api.js — the one door to engine/ and models/
// ----------------------------------------------------------------------------
//  ENGINE owns engine/ and models/. The page, the worker, the saver and
//  the tests import the engine only through this file, so a change of a
//  name or a path costs one line here. Shapes: engine/index.js header.
//
//  grep -n targets: "export {", "export function tileMeta", "export function modelMeta"
// ============================================================================
export {
  depthFromMesh, depthFromText, depthFromImage, depthFromSDF, SDF_SHAPES, turntable,
  sirds, autostereogram, farSeparation, TILES, tilesFromPatterns, animate,
} from './engine/index.js';
export { MODELS, KINDS, loadModel } from './models/index.js';
import { TILES } from './engine/index.js';
import { MODELS } from './models/index.js';

export const tileMeta = id => TILES.find(t => t.id === id) || null;
export const modelMeta = id => MODELS.find(m => m.id === id) || null;
