// ============================================================================
//  FOUR-STROKE ENGINE  ·  parts.js — the text of the part cards
// ────────────────────────────────────────────────────────────────────────────
//  KINDS[kind] = { name, group, role, specs: [[k, v]] }. scene.js gives each
//  part a kind and, for a per-cylinder part, its cylinder; partsFor() makes
//  the PARTS table the cards read. main.js adds the live rows (liveRows).
// ============================================================================
import { GEO, TRAINS, LOBE } from './engine.js';

export const GROUP_COLOR = { 'Bottom end': '#ffb46a', 'Valve train': '#9fd0ff', 'Timing drive': '#c8a6ff', Castings: '#b9c0cf', Ignition: '#ffd27a' };
const mm = v => `${+v.toFixed(1)} mm`;
export const KINDS = {
  block: { name: 'Cylinder block', group: 'Castings', role: 'The cast-iron body. The four bores guide the pistons, and the bulkheads below carry the crankshaft in five main bearings.', specs: [['Bore × stroke', `${GEO.bore} × ${GEO.stroke} mm`], ['Displacement', `${GEO.displacement.toFixed(0)} cc`], ['Bore spacing', `${GEO.pitch} mm`], ['Main bearings', '5']] },
  gasket: { name: 'Head gasket', group: 'Castings', role: 'A thin multi-layer steel sheet between block and head. It seals the combustion pressure, the coolant and the oil passages.', specs: [['Thickness', '1.2 mm'], ['Holds', 'up to ~50 bar']] },
  head: { name: 'Cylinder head', group: 'Castings', role: 'The aluminium casting above the bores. It holds the combustion chambers, the valve seats and guides, the ports, and the camshaft bearings.', specs: [['Chamber', 'pent roof'], ['Valve angle', `${GEO.incline}° from the bore axis`], ['Compression ratio', `${GEO.cr} : 1`]] },
  cover: { name: 'Cam cover', group: 'Castings', role: 'Closes the top of the head and keeps the oil that sprays off the cams inside.', specs: [['Material', 'cast aluminium, wrinkle paint']] },
  pan: { name: 'Oil pan', group: 'Castings', role: 'The sump. Oil drains here; the pump picks it up and feeds the bearings and the cams under pressure.', specs: [['Capacity', '≈ 4.5 L']] },
  crank: { name: 'Crankshaft', group: 'Bottom end', role: 'Turns the push of each rod into rotation. The throws for cylinders 1 and 4 point one way, 2 and 3 the other, so two pistons rise as two fall.', specs: [['Throw r', `${GEO.r} mm (stroke ${GEO.stroke})`], ['Throws', '1 & 4 at 0°, 2 & 3 at 180°'], ['Main journals', '5 × Ø50 mm'], ['Crank pins', '4 × Ø48 mm']] },
  flywheel: { name: 'Flywheel', group: 'Bottom end', role: 'A heavy disc that stores energy. It carries the crank through the three strokes in each cylinder that take work instead of giving it.', specs: [['Ring gear', '110 teeth (starter)'], ['Diameter', '282 mm']] },
  damper: { name: 'Crank pulley and damper', group: 'Bottom end', role: 'Drives the accessory belt. A rubber ring inside damps the twisting vibration of the crank.', specs: [['Diameter', '124 mm']] },
  piston: { name: 'Piston', group: 'Bottom end', role: 'Seals the bore with three rings and takes the gas force. It moves as x(θ) = r cos θ + √(l² − r² sin² θ).', specs: [['Diameter', `${GEO.bore} mm`], ['Rings', '2 compression, 1 oil'], ['Pin to crown', mm(GEO.compH)]] },
  rod: { name: 'Connecting rod', group: 'Bottom end', role: 'Links the piston pin to the crank pin. Its lean puts a side load on the piston and makes the stroke uneven: the piston moves faster near TDC than near BDC.', specs: [['Length l', `${GEO.l} mm`], ['Rod ratio l / r', (GEO.l / GEO.r).toFixed(2)]] },
  camIn: { name: 'Intake camshaft', group: 'Valve train', role: 'Turns at half crank speed. Each lobe opens one intake valve once per cycle.', specs: [['Speed', '½ × crank'], ['Base circle', `Ø${LOBE.Rb * 2} mm`], ['Lobe lift', mm(LOBE.L)]] },
  camEx: { name: 'Exhaust camshaft', group: 'Valve train', role: 'Turns at half crank speed. Each lobe opens one exhaust valve once per cycle.', specs: [['Speed', '½ × crank'], ['Base circle', `Ø${LOBE.Rb * 2} mm`], ['Lobe lift', mm(LOBE.L)]] },
  cam: { name: 'Camshaft', group: 'Valve train', role: 'One shaft at half crank speed with eight lobes: an intake and an exhaust lobe for each cylinder. The lobes push the rockers up.', specs: [['Speed', '½ × crank'], ['Base circle', `Ø${LOBE.Rb * 2} mm`], ['Lobe lift', mm(LOBE.L)]] },
  valveIn: { name: 'Intake valve', group: 'Valve train', role: 'A poppet valve. It opens to let the air and fuel charge in, then the spring shuts it on its seat.', specs: [['Opens', '10° before TDC'], ['Closes', '40° after BDC']] },
  valveEx: { name: 'Exhaust valve', group: 'Valve train', role: 'A poppet valve. It opens before BDC to let the burnt gas blow down, and shuts just after TDC.', specs: [['Opens', '40° before BDC'], ['Closes', '10° after TDC']] },
  spring: { name: 'Valve spring', group: 'Valve train', role: 'Holds the valve on its seat and keeps the follower on the lobe as the lobe falls away.', specs: [['Rate', '45 N/mm'], ['Seat load', '250 N']] },
  bucket: { name: 'Bucket tappet', group: 'Valve train', role: 'A cup between the lobe and the valve stem. Its flat face rides on the lobe, so the lift is the support function of the lobe shape.', specs: [['Diameter', '30 mm']] },
  rocker: { name: 'Rocker arm', group: 'Valve train', role: 'A lever on a shaft. The lobe pushes the pad end up; the other end goes down and opens the valve.', specs: [['Arms', `${TRAINS.sohc.rocker.aIn} : ${TRAINS.sohc.rocker.aOut.toFixed(1)} mm`], ['Ratio', (TRAINS.sohc.rocker.aOut / TRAINS.sohc.rocker.aIn).toFixed(2)]] },
  rockerShaft: { name: 'Rocker shaft', group: 'Valve train', role: 'The fixed pivot for the rocker arms, fed with oil from inside.', specs: [['Diameter', '16 mm']] },
  chain: { name: 'Timing chain', group: 'Timing drive', role: 'Drives the camshafts from the crank. The cam sprockets have twice the teeth, so the cams turn once for every two crank turns.', specs: [['Pitch', '8 mm'], ['Ratio', '18 : 36 = 1 : 2']] },
  crankSprocket: { name: 'Crank sprocket', group: 'Timing drive', role: 'The small sprocket on the crank nose that drives the chain.', specs: [['Teeth', '18']] },
  camSprocket: { name: 'Cam sprocket', group: 'Timing drive', role: 'Twice the teeth of the crank sprocket: the cam turns at half crank speed.', specs: [['Teeth', '36']] },
  guides: { name: 'Chain guides and tensioner', group: 'Timing drive', role: 'Plastic-faced rails that stop the chain from whipping. The tensioner takes up the slack as the chain wears.', specs: [] },
  plug: { name: 'Spark plug', group: 'Ignition', role: 'Fires the charge about 15° before TDC, so the peak pressure comes just after TDC.', specs: [['Spark', '15° before TDC'], ['Gap', '0.8 mm']] },
};
// PARTS[id] from the build's parts: { kind, cyl }
export function partsFor(B) {
  const out = {};
  for (const id in B.parts) {
    const q = B.parts[id], K = KINDS[q.kind];
    if (!K) continue;
    out[q.info] = { ...K, kind: q.kind, cyl: q.cyl || 0, name: q.cyl ? `${K.name} · cylinder ${q.cyl}` : K.name };
  }
  return out;
}
