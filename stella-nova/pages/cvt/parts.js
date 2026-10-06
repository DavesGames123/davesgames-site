// ============================================================================
//  CVT  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the model.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, L0, sheaveS } from './model.js';

export const GROUP_COLOR = { 'Input': '#e9c27a', 'Output': '#e9a0a8', 'Fixed': '#9aa6c0', 'Control': '#8fb0ff', 'Traction': '#8fe0c0' };

export function partsFor(id) {
  const u = unit(id), D = 180 / Math.PI;
  if (id === 'belt') return {
    base: { name: 'Case', group: 'Fixed', role: 'The gearbox case holds the two shaft bearings at a fixed centre distance. That distance and the belt length fix how far one pulley must open when the other closes.', specs: [['Centre distance', `${u.C} mm`]] },
    in: { name: 'Input pulley', group: 'Input', role: 'Shaft, fixed sheave and servo cylinder, turned by the engine. The fixed sheave is one half of the V; the other half slides.', specs: [['Belt radius', `${u.R_MIN} … ${u.R_MAX} mm`], ['Sheave angle', `${(u.BETA * D).toFixed(0)}°`]], live: ['r1', 'in'] },
    out: { name: 'Output pulley', group: 'Output', role: 'The same parts as the input pulley, turned end for end, so its movable sheave is on the other side. It drives the wheels.', specs: [['Belt radius', `${u.R_MAX} … ${u.R_MIN} mm`]], live: ['r2', 'outw'] },
    move: { name: 'Movable sheave', group: 'Control', role: 'Oil pressure in the servo cylinder pushes this cone along the shaft. Closer to its partner, the V is narrower at each radius, so the belt rides out to a larger radius.', specs: [['Travel', `${(sheaveS(u, u.R_MIN) - sheaveS(u, u.R_MAX)).toFixed(1)} mm`]], live: ['travel'] },
    servo: { name: 'Servo cylinder', group: 'Control', role: 'A cup fixed to the shaft round the skirt of the movable sheave. Oil pumped into it pushes the sheave along the shaft, and the same pressure sets the clamping force on the belt.', specs: [['Bore', '120.8 mm']] },
    belt: { name: 'Push belt', group: 'Traction', role: `${u.N} thin steel elements on two band packs. The elements push against each other along the tight strand: the belt drives by compression, not tension. Their flanks grip the sheave cones.`, specs: [['Length', `${L0(u).toFixed(1)} mm`], ['Elements', String(u.N)], ['Width at pitch', `${u.BW} mm`]], live: ['ratio'] },
    band: { name: 'Band packs', group: 'Traction', role: 'Two stacks of thin steel rings sit in the saddles of the elements. They hold the elements in a loop and carry the hoop load; the elements slide along them.', specs: [['Length', `${L0(u).toFixed(1)} mm (fixed)`]], live: ['len'] },
  };
  return {
    in: { name: 'Input disc', group: 'Input', role: 'One half of the toroidal cavity, on the input shaft. The roller touches it at radius r_in. A hydraulic end load presses the discs on the rollers so the oil film can carry traction.', specs: [['Core radius E', `${u.E} mm`], ['Cavity radius R0', `${u.R0} mm`]], live: ['rin', 'in'] },
    out: { name: 'Output disc', group: 'Output', role: 'The other half of the cavity. It turns the other way, at r_in / r_out times the input speed.', specs: [['Ratio range', `${((u.E + u.R0 * Math.sin(u.G_MAX)) / (u.E - u.R0 * Math.sin(u.G_MAX))).toFixed(2)} … ${((u.E - u.R0 * Math.sin(u.G_MAX)) / (u.E + u.R0 * Math.sin(u.G_MAX))).toFixed(2)}`]], live: ['rout', 'outw'] },
    roller: { name: 'Power roller', group: 'Traction', role: 'Its rim sits on both discs. The steel never touches: a traction fluid, which goes nearly solid under the contact pressure, passes the force through a film about a micrometre thick. The page draws that film as a 0.4 mm gap.', specs: [['Rim radius', `${u.R0 - u.FILM} mm`], ['Rollers', String(u.N_ROLL)]], live: ['spin'] },
    carrier: { name: 'Roller carrier', group: 'Control', role: 'It holds the roller axle and tilts about the tangent of the cavity core circle. Tilt moves the input contact in and the output contact out, or the reverse: that is the ratio change.', specs: [['Tilt range', `±${(u.G_MAX * D).toFixed(1)}°`]], live: ['tilt'] },
    frame: { name: 'Reaction frame', group: 'Fixed', role: 'Holds the carrier pivots. In a Torotrak drive, pistons on the carriers set the reaction torque, and the rollers find the tilt that matches it.', specs: [] },
    base: { name: 'Base', group: 'Fixed', role: 'Bearing pedestals for the input shaft and the output sleeve.', specs: [] },
  };
}
