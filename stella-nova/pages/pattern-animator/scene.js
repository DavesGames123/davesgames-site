// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  scene.js — one animated pattern (no DOM)
// ----------------------------------------------------------------------------
//  The page, the saver, the tests and the thumbnail script build a scene
//  the same way:
//    1. view    the board on screen in design units (engine.js boardSize)
//    2. cover   the geometry board (motion.js coverFor). Its density is
//               D x cover.k, so the motifs keep their size on the larger
//               board.
//    3. run     the pattern-designer job (worker.js runJob, or its worker)
//    4. pack    the style mode (export.js applyMode), then motion.js pack.
//               Lines are cut into steps of S / 90 when a field channel
//               is on.
//    5. budget  when the points pass the frame budget (BUDGET x the
//               governor level), the density goes down and the job runs
//               again (at most twice). The caption shows the density in
//               use.
//    6. morph   the B geometry (a second seed or a second pattern) at the
//               same density, and the element pairs (pairUp).
//  buildScene(run, st, o) returns the scene; makePlayer(scene, anim, pal)
//  compiles the animation and holds the reused frame buffers; play(t)
//  fills them and returns the layers for render.js drawFrame.
//
//  BUDGET. Points in one frame: desktop 200 000, phone 60 000 (a circle
//  counts as six and a draw call as thirty, motion.js G.cost). The point count drives both the
//  motion time and the draw time. A field channel moves every point
//  through more maths, so its budget is FIELD_SHARE of that. A morph has
//  two geometries, each with MORPH_SHARE.
//
//  grep -n targets: "export const BUDGET", "export async function buildScene",
//                   "export function makePlayer", "export function viewBoard"
// ============================================================================
import { boardSize, defaults, clampParams } from '../pattern-designer/engine.js';
import { byId } from '../pattern-designer/patterns/index.js';
import { applyMode } from '../pattern-designer/export.js';
import { DENSE, clampD, densityCap, runCap } from '../pattern-designer/density.js';
import { boardById, boardDims } from '../pattern-designer/palettes.js';
import { pack, pairUp, compile, makeFrame, frame, coverFor, needsDeform, colourTable, cleanAnim } from './motion.js';
import { isComposed } from './presets.js';

export const BUDGET = { desktop: 200000, phone: 60000 };
export const FIELD_SHARE = 0.6, MORPH_SHARE = 0.6;
export const ANIM_BOARDS = ['4x5', 'sq', '9x16', 'desk'];
export const viewBoard = id => boardSize(boardDims(boardById(id), false).aspect);

// st: { pat, P, seed, D, detail, mode, board, mods, anim }. o: { coarse,
// budget (points), cap (element cap), view (overrides the board) }.
export async function buildScene(run, st, o = {}) {
  const pat = byId(st.pat);
  if (!pat) throw new Error('no pattern ' + st.pat);
  const coarse = !!o.coarse, anim = cleanAnim(st.anim), view = o.view || viewBoard(st.board || '4x5');
  const kaleido = (st.mods || []).some(m => m && !m.off && m.type === 'mirror' && m.kind === 'kaleido');
  const cover = coverFor(view, anim, isComposed(pat) || kaleido), dcap = densityCap(coarse), cap = o.cap || runCap(coarse);
  const morph = anim.morph, budget = (o.budget || (coarse ? BUDGET.phone : BUDGET.desktop)) * (morph ? MORPH_SHARE : 1) * (needsDeform(anim) ? FIELD_SHARE : 1);
  const S = Math.min(view.W, view.H), step = needsDeform(anim) ? S / 90 : 0;
  const P = clampParams(pat, st.P || defaults(pat));
  const D0 = clampD(st.D, dcap);
  let D = Math.min(4, D0 * cover.k);
  const t0 = now();
  const one = async (id, PP, seed, Dx) => {
    const res = await run({ pat: id, P: PP, seed, W: cover.W, H: cover.H, mods: st.mods || [], D: Dx, detail: st.detail || 0, cap });
    const items = applyMode(res.items, st.mode || 'auto');
    return { G: pack(items, { W: cover.W, H: cover.H, seed, step }), capped: res.capped };
  };
  let A = await one(pat.id, P, st.seed, D), tries = 0;
  while (A.G.cost > budget * 1.12 && tries < 2 && D > 0.5) {
    D = Math.max(0.5, D * Math.max(0.35, Math.min(0.95, Math.sqrt(budget / A.G.cost) * 0.97)));
    A = await one(pat.id, P, st.seed, D); tries++;
  }
  let B = null, pair = null, patB = null;
  if (morph) {
    patB = morph.pat ? byId(morph.pat) : null;
    const id = patB ? patB.id : pat.id, PP = patB ? defaults(patB) : P, seed = morph.seed || st.seed;
    B = (await one(id, PP, seed, D)).G;
    pair = pairUp(A.G, B);
  }
  const thin = !(DENSE[pat.id] && DENSE[pat.id].$thin === false);
  return {
    pat, patB, view, cover, anim, G: A.G, B, pair, capped: A.capped,
    D: D / cover.k, Dg: D, budget, points: A.G.nP + (B ? B.nP : 0), cost: A.G.cost + (B ? B.cost : 0),
    lwScale: thin ? Math.sqrt(cover.k) : 1, ms: now() - t0, seed: st.seed,
  };
}
const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

// A player for a scene: the compiled animation, the colour table and the
// frame buffers. setAnim and setPalette compile again (cheap). play(t)
// returns the layers; it allocates nothing.
export function makePlayer(scene, anim, pal) {
  const P = { scene, FA: makeFrame(scene.G), FB: scene.B ? makeFrame(scene.B) : null, C: null, lut: null, pal: null };
  P.setAnim = a => { P.anim = cleanAnim(a); P.C = compile(P.anim, scene.view, scene.G, P.pal ? P.pal.ink.length : 1, scene.seed); if (!scene.B) P.C.morph = null; };
  P.setPalette = p => { P.pal = p; P.lut = colourTable(p); if (P.anim) P.setAnim(P.anim); };
  P.setPalette(pal); P.setAnim(anim);
  const moA = scene.B ? { other: scene.B, pair: scene.pair, role: 'A' } : null;
  const moB = scene.B ? { other: scene.G, pair: scene.pair, role: 'B' } : null;
  const layers = scene.B ? [{ G: scene.G, F: P.FA }, { G: scene.B, F: P.FB }] : [{ G: scene.G, F: P.FA }];
  P.play = t => {
    frame(scene.G, P.C, t, P.FA, moA);
    if (scene.B) frame(scene.B, P.C, t, P.FB, moB);
    return layers;
  };
  return P;
}
