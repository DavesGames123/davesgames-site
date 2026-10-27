// ============================================================================
//  ULAM SPIRAL  ·  app/tiles.js — when and where to ask for a CPU tile
// ----------------------------------------------------------------------------
//  The GPU classifies n up to its cover (the bitset, or the arithmetic
//  table). Past that, or past 23000 cells from the origin, the field
//  pass reads a CPU tile: worker.js classifies each cell of a window
//  (Miller-Rabin) and numbers.js uploads the result.
//
//  GREP MAP
//    grep -n 'function gpuCover'          the largest n the GPU can classify
//    grep -n 'export function tileCheck'  does this view need a tile; ask
//    grep -n 'export function sendTile'   post one tile request
// ============================================================================
import * as T from '../numtheory.js';
import * as L from '../layouts.js';
import { S, rt } from './state.js';
import { PHONE_Q } from './dom.js';
import { worldRect, cellRect } from './camera.js';
import { nSpan } from './framing.js';

const M = T.MODE;
const TILE_MAX = () => (PHONE_Q.matches ? 320 : 512);
const isArith = mode => mode >= M.divisors && mode <= M.totient;

function gpuCover() {
  if (!S.bits) return 0;
  if (isArith(S.mode)) return rt.R.arith.mode === S.mode ? rt.R.arith.N - 1 : 0;
  if (S.mode === M.sophie) return (S.limit - 1) / 2;
  if (S.mode >= M.twin && S.mode <= M.sexy) return S.limit - 6;
  return S.limit;
}
function tileKey() { return `${S.shape.key}|${JSON.stringify(S.P)}|${S.mode}|${S.quad.on ? [S.quad.a, S.quad.b, S.quad.c, S.quad.max].join(',') : ''}`; }
export function tileCheck(v) {
  const sh = S.shape;
  if (!L.isLattice(sh) || !S.bits) return false;
  const sp = nSpan(sh, v);
  let need = sp.hi > gpuCover() || sp.far > 22000;
  if (sh.lattice === 'gauss') need = need || 2 * sp.far * sp.far > S.limit;
  if (sh.lattice === 'eisen') need = need || 3 * sp.far * sp.far > S.limit;
  if (!need) return false;
  const cr = cellRect(sh, worldRect(v));
  const cap = isArith(S.mode) ? (PHONE_Q.matches ? 160 : 256) : TILE_MAX();
  const cx = (cr[0] + cr[2]) / 2, cy = (cr[1] + cr[3]) / 2;
  const w = Math.min(cap, Math.ceil((cr[2] - cr[0]) * 1.3) + 4), h = Math.min(cap, Math.ceil((cr[3] - cr[1]) * 1.3) + 4);
  // a view wider than one tile: no tile (the GPU marks what it can)
  if (cr[2] - cr[0] > cap || cr[3] - cr[1] > cap) return false;
  const want = { key: tileKey(), x0: Math.floor(cx - w / 2), y0: Math.floor(cy - h / 2), w, h };
  const have = S.tile.have, inner = [Math.max(cr[0], Math.floor(cx - cap / 2)), Math.max(cr[1], Math.floor(cy - cap / 2)), Math.min(cr[2], Math.floor(cx + cap / 2)), Math.min(cr[3], Math.floor(cy + cap / 2))];
  const covers = t => t && t.key === want.key && t.x0 <= inner[0] && t.y0 <= inner[1] && t.x0 + t.w > inner[2] && t.y0 + t.h > inner[3];
  if (!covers(have) && !covers(S.tile.pend)) {
    if (S.tile.pending) S.tile.want = want;
    else sendTile(want);
  }
  return true;
}
export function sendTile(want) {
  const id = ++S.tile.id;
  S.tile.pending = id; S.tile.pend = want; S.tile.want = null;
  rt.worker.postMessage({ type: 'tile', id, key: S.shape.key, P: S.P, mode: S.mode, quad: S.quad.on ? { on: true, a: S.quad.a, b: S.quad.b, c: S.quad.c, max: S.quad.max } : null, x0: want.x0, y0: want.y0, w: want.w, h: want.h });
}
