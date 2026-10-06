// ============================================================================
//  SWASHPLATE PISTON PUMP  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, area, retainerR, LAYOUT, D } from './mech.js';

export const GROUP_COLOR = { 'Input': '#e9c27a', 'Pistons': '#8fb0ff', 'Swash': '#f0a46a', 'Ports': '#8fe0c0', 'Frame': '#9aa6c0' };

export function partsFor(id) {
  const u = unit(id), deg = r => `${(r / D).toFixed(0)}°`;
  return {
    base: { name: 'Base and cradle', group: 'Frame', role: 'A painted bed with the front bearing and two cradle blocks. The swashplate trunnions turn in the cradle bores, so the plate can tilt but cannot turn with the shaft.', specs: [['Trunnion bore', '20.8 mm']] },
    shaft: { name: 'Drive shaft', group: 'Input', role: 'A motor turns the shaft at a steady speed. A spline on the shaft turns the cylinder barrel. The shaft passes through a hole in the swashplate and does not touch it.', specs: [['Diameter', '24 mm']], live: ['rpm', 'th'] },
    coupling: { name: 'Drive coupling', group: 'Input', role: 'The flange that joins the pump shaft to the motor. The torque it passes is the pressure times the displacement, divided by 2π.', specs: [], live: ['torque'] },
    swash: { name: 'Swashplate', group: 'Swash', role: 'A flat plate that does not turn, tilted by the swash angle b. Each slipper slides round on its face, so each piston goes in and out once a turn by 2 Rp tan b. At b = 0 the pistons do not move and the pump gives no flow; a servo tilts the plate to set the flow.', specs: [['Tilt range', `0 – ${deg(u.bMax)}`], ['Face radius', `${LAYOUT.plateR} mm`]], live: ['beta', 'stroke'] },
    slipper: { name: 'Slipper', group: 'Pistons', role: 'A bronze shoe on the piston ball. Oil from the piston comes through a small hole and holds the shoe on a thin film, so the slipper slides on the plate with almost no wear. In the plate frame its centre runs on an ellipse.', specs: [['Flange', `${2 * u.flange} mm`], ['Ball height', `${u.hs} mm`]] },
    retainer: { name: 'Retainer plate', group: 'Pistons', role: 'A ring that turns with the barrel and holds the slipper flanges on the plate on the suction stroke. Its holes are on a circle, the slippers are on an ellipse, so each hole has a small clearance round the neck.', specs: [['Hole circle', `${(2 * retainerR(u)).toFixed(1)} mm`], ['Hole', `${2 * u.hole} mm`]] },
    piston: { name: 'Piston', group: 'Pistons', role: `One of ${u.N}. It goes into its bore while its slipper climbs the plate (delivery) and comes out while it goes down (suction). It moves like a sine of the barrel angle; the flow is the sum of the pistons that deliver.`, specs: [['Diameter', `${u.d} mm`], ['Pitch radius', `${u.Rp} mm`], ['Area', `${area(u).toFixed(0)} mm²`]], live: ['nDel', 'stroke'] },
    barrel: { name: 'Cylinder barrel', group: 'Pistons', role: `A steel block with ${u.N} bores that turns with the shaft. Its bronze back face slides on the valve plate, and a kidney port at the end of each bore opens to the suction or the delivery side.`, specs: [['Bores', String(u.N)], ['Bore', `${2 * LAYOUT.boreR} mm`]], live: ['th'] },
    valve: { name: 'Valve plate', group: 'Ports', role: `A fixed plate with two kidney slots. The bridges between them are wider than a barrel port (${deg(2 * u.bh)} against about ${deg(2 * (u.pa + Math.asin(u.pw / u.Rp)))}), so a cylinder is never open to both sides. The bridges sit where each piston is at the end of its stroke.`, specs: [['Bridge', deg(2 * u.bh)], ['Kidneys', 'suction · delivery']], live: ['nDel'] },
    block: { name: 'Port block', group: 'Ports', role: 'The rear cover with the oil passages from the two kidneys to the two pipes. The delivery side holds the full pressure.', specs: [['Rated pressure', `${u.p} bar`]] },
    inlet: { name: 'Suction port', group: 'Ports', role: 'The large pipe on the suction kidney. Oil comes in at low pressure, so the pipe is wide to keep the speed of the oil low and stop cavitation.', specs: [['Bore', '30 mm']], live: ['flow'] },
    outlet: { name: 'Delivery port', group: 'Ports', role: 'The small pipe on the delivery kidney. The oil leaves at high pressure with a ripple of the same frequency as the piston pulses.', specs: [['Bore', '18 mm']], live: ['flow', 'ripple'] },
  };
}
