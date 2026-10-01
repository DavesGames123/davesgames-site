// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/wall.js — wall clock cases
// ────────────────────────────────────────────────────────────────────────────
//  build(B, spec, cal, dims, zF, zB) adds the case parts to the movement's
//  builder and returns { PARTS, toggles, pose(p, S, dt, now), has }. zF is
//  the dial face plane, zB the back of the movement (movement frame: mm, y
//  to 12, z out of the back, the dial faces -z; seen from the dial +x is 9).
// ============================================================================
import * as THREE from 'three';
import * as G from '../../watch-movement/geom.js';
import { circ, hole } from '../../watch-movement/kit.js';
import { lathe, cap, bezelOutline, dialRadius } from './common.js';
import { METALS, PAINTS, WOODS, LEATHERS } from '../palettes.js';
const { TAU, D, pol } = G;

// ── wall clock ──────────────────────────────────────────────────────────────
export function build(B, spec, cal, dims, zF, zB) {
  const c = spec.case, Rc = c.diameter / 2, Rd = dims.dialR, unit = 9;
  const k = v => v * Rc / unit;                 // explode offsets in case sizes
  B.layer('caseFront', -k(0.32)); B.layer('caseMid', 0); B.layer('caseBack', k(0.28));
  const zLip = zF - Rc * 0.1, zRear = zB + Rc * 0.18;
  const rimMat = c.style === 'schoolhouse' ? 'wood' : c.style === 'kitchen' ? 'paint' : c.style === 'station' ? 'black' : 'polished';
  const band = B.part('case', 'caseMid', [0, 0], { label: 'Case', labelAt: [-Rc, 0], labelZ: (zLip + zRear) / 2 });
  const prof = c.style === 'schoolhouse' ? [[Rd + 1, zF + 2], [Rd + 4, zLip], [Rc - 6, zLip - 1], [Rc - 1, zLip + 6], [Rc, zRear - 8], [Rc - 3, zRear], [Rd + 2, zRear]]
    : c.style === 'station' ? [[Rd + 1, zLip + 1], [Rc - 1, zLip], [Rc, zLip + 2], [Rc, zRear - 2], [Rc - 2, zRear], [Rd + 2, zRear]]
    : c.style === 'porthole' ? [[Rd + 1, zF], [Rd + 3, zLip], [Rc - 3, zLip], [Rc, zLip + 4], [Rc, zRear - 4], [Rc - 3, zRear], [Rd + 2, zRear]]
    : [[Rd + 1, zF], [Rd + 3, zLip + 1], [Rc - 2, zLip + 2], [Rc, zLip + 5], [Rc - 1, zRear - 3], [Rc - 6, zRear], [Rd + 2, zRear]];
  B.add(band, lathe(B, prof, rimMat, 160));
  if (c.style === 'porthole') for (let i = 0; i < 8; i++) {
    const at = pol((Rd + Rc) / 2, i / 8 * TAU + 0.2);
    B.add(band, B.cyl(3.2, zLip - 1.4, zLip, 'polished', 20).translateX(at[0]).translateY(at[1]));
  }
  // the large dial and its back plate
  const dial = B.part('dial', 'caseMid', [0, 0], { label: 'Dial', labelAt: [0, -Rd * 0.6], labelZ: zF });
  const dh = [hole(2.6, 24)];
  B.add(dial, B.slab(circ(Rd + 0.5, 180), dh, zF + 0.4, zF + 1.6, 'brass', 0.3), B.dialFace(Rd, zF, dh, dims.paint));
  // bezel ring and crystal
  const bz = B.part('bezel', 'caseFront', [0, 0], { label: 'Bezel and glass', labelAt: [Rd * 0.75, Rd * 0.75], labelZ: zLip });
  B.add(bz, lathe(B, [[Rd - 1, zLip - 1.5], [Rd + 3, zLip - 3], [Rd + 7, zLip - 1.5], [Rd + 7, zLip + 0.5], [Rd - 1, zLip + 0.5]], c.style === 'station' ? 'black' : 'polished', 128));
  const cry = B.part('crystal', 'caseFront', [0, 0], {});
  const glass = cap(B, Rd, Rd * 0.07, zLip - 1.0, 'glass'); glass.userData.noShadow = true;
  B.add(cry, glass);
  // the back: a plate with a window to the movement, and a hanger
  const back = B.part('caseback', 'caseBack', [0, 0], { label: 'Back and hanger', labelAt: [0, Rc * 0.9], labelZ: zRear });
  B.add(back, B.slab(circ(Rc - 3, 160), [hole(cal.plateR + 8, 96)], zRear, zRear + 2.5, rimMat === 'wood' ? 'wood' : 'black', 0.4));
  const hanger = new THREE.TorusGeometry(6, 1.1, 10, 32); hanger.translate(0, Rc * 0.82, zRear + 3.5);
  B.add(back, B.mesh(hanger, 'polished'));
  const m = METALS[c.metal];
  const PARTS = {
    case: { name: c.style === 'schoolhouse' ? 'Schoolhouse case' : c.style === 'station' ? 'Station clock case' : c.style === 'porthole' ? 'Porthole case' : 'Kitchen clock case', group: 'Case',
      role: c.style === 'schoolhouse' ? 'A turned wooden surround, as on the clocks of classrooms and railway offices.' : c.style === 'station' ? 'A heavy black ring, made to be read from across a platform.' : c.style === 'porthole' ? 'A ship\'s bulkhead case: a thick brass ring bolted round the glass.' : 'A painted surround with a soft, rounded profile.',
      specs: [['Diameter', `${c.diameter} mm`], ['Material', c.style === 'schoolhouse' ? `${c.wood} wood` : c.style === 'kitchen' ? `${c.paint} enamel paint` : c.style === 'station' ? 'black lacquer' : c.metal]] },
    dial: { name: 'Dial', group: 'Display', role: 'A large dial on a brass plate. The movement is small and sits behind it; its centre arbor carries the long hands.', specs: [['Diameter', `${(Rd * 2).toFixed(0)} mm`], ['Base', spec.face.base.replace('-', ' ')], ['Numerals', spec.face.numerals]] },
    bezel: { name: 'Bezel and glass', group: 'Case', role: 'A ring that clamps the domed glass over the dial; it hinges open to set the hands.', specs: [['Glass', 'domed']] },
    caseback: { name: 'Back and hanger', group: 'Case', role: 'The back plate, with a window here to show the movement, and the ring the clock hangs from.', specs: [] },
  };
  PARTS.crystal = PARTS.bezel;
  return {
    PARTS, palette: { polished: { color: m.color, roughness: m.roughness }, wood: { color: WOODS[c.wood] }, paint: { color: PAINTS[c.paint] } },
    toggles: ['case', 'bezel', 'crystal', 'caseback', 'dial'], pose() {}, has: {},
  };
}

