// ============================================================================
//  FLY DUEL 3D  ·  table numbers and seat space  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  Split out of ui/fly3d/scene.js. The table and layout numbers, the watch
//  framing numbers and the change from seat space to world space.
//  Seat 0 (Fly A) sits at +z and looks to -z. Seat 1 (Fly B) sits at -z.
//  u is to the right of the seat, v is the distance from the centre.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'export const TABLE'           table and layout numbers
//      grep -n 'export const YAW'             seat yaw
//      grep -n 'export const CLOSE_TO_BOARD'  the close shot keeps the board
//      grep -n 'export const WATCH'           watch framing numbers
//      grep -n 'export function seatPos'      seat space -> world
//      grep -n 'export function seatQuat'     seat yaw, then local euler
// ============================================================================
import * as THREE from 'three';

// ------------------------------------------------------------ dimensions
export const TABLE = {
  y: 2.0, thick: 0.09, halfLen: 4.6, halfDepth: 3.45,
  cardW: 0.56, cardH: 0.784, cardT: 0.008,
  landV: 2.2, creatureV: 1.2, attackV: 0.48, rowHalf: 1.75,
  deckU: 2.35, deckV: 1.35, graveU: 2.35, graveV: 0.45,
  lifeU: -2.52, lifeV: 1.12, lifeSize: 0.27,
  handV: 3.75, handY: 0.12, handR: 0.38,
  stageU: 0.7, stageV: 2.0, stageY: 1.0,
  seatV: 4.2, seatTop: 1.16,
  flyScale: 2.0, handScale: 0.78, fanR: 0.3,
};
const T = TABLE;
export const YAW = [0, Math.PI];
// Watch-mode framing of the wide (and win) shot and of the tall-frame
// wide and combat shots: radius, elevation, look height above the table,
// the side drift, and the field of view of every watch shot. Tuned so the
// flies fill the frame with both heads, both seats and both maps in it
// (tests/fly3d.test.mjs 'camera framing').
// fillTall: the tall shot radius factor of a fill frame (setClear fill):
// the camera goes nearer, the table ends may lie under the brains.
// The close shot looks this far from the held card toward the centre of
// the board (0: at the card, 1: at the centre).
export const CLOSE_TO_BOARD = 0.7;
export const WATCH = { wideR: 7.6, wideEl: 0.42, wideLook: 0.7, drift: 0.3, tallR: 11.5, tallEl: 0.55, fov: 40, fitAspect: 1.7, fillTall: 0.78 };

// Seat space (u, y above the table top, v) -> world.
export function seatPos(p, u, y, v, out = new THREE.Vector3()) {
  return p === 0 ? out.set(u, T.y + y, v) : out.set(-u, T.y + y, -v);
}
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
// Seat yaw, then local XYZ euler (radians).
export function seatQuat(p, x = 0, y = 0, z = 0, out = new THREE.Quaternion()) {
  out.setFromEuler(_e.set(0, YAW[p], 0));
  return out.multiply(_q.setFromEuler(_e.set(x, y, z, 'YXZ')));
}
