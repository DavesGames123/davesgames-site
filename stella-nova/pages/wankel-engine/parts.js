// ============================================================================
//  WANKEL ENGINE  ·  parts.js — what each part is called and what it does
// ────────────────────────────────────────────────────────────────────────────
//  partsFor(V) returns PARTS[id] = { name, group, role, specs: [[k, v]],
//  live } for the layout V (engine.js VARIANTS). The ids are the info ids
//  of scene.js: parts of the same kind share one id (every apex seal is
//  'apexSeal', both plugs are 'plug'). live names the live rows that
//  main.js liveValue fills each frame.
//
//  GREP MAP
//    export function partsFor ... the table
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { GEO, SWEPT, LEAN_MAX, K, D, volumes } from './engine.js';

export const GROUP_COLOR = {
  Housing: '#b9c0cf', Rotor: '#e9c27a', Seals: '#9fd0ff', Gearing: '#c8a6ff',
  Shaft: '#8fe0c0', Ignition: '#ff9f80', Breathing: '#ffb46a', Frame: '#d8c6a8',
};
const cc = v => `${(v / 1000).toFixed(1)} cm³`;

export function partsFor(V) {
  const { R, e, W, gear } = GEO, vt = volumes(), twin = V.rotors.length > 1;
  return {
    rotorHousing: { name: 'Rotor housing', group: 'Housing', role: 'An aluminium casting whose bore is the epitrochoid. Its chrome-plated running face is where the apex seals slide. The spark plugs screw into one waist and the ports open at the other.', specs: [['Curve', 'epitrochoid'], ['R / e', `${R} / ${e} mm`], ['K = R/e', K.toFixed(1)], ['Width', `${W} mm`]], live: ['shaft'] },
    frontPlate: { name: 'Front side housing', group: 'Housing', role: 'Closes the front of the rotor housing. The rotor faces slide on it. The stationary gear is bolted into it, and it carries the front main bearing of the eccentric shaft.', specs: [['Material', 'cast iron, ground face']] },
    rearPlate: { name: 'Rear side housing', group: 'Housing', role: twin ? 'Closes the rear rotor housing. It holds the second stationary gear and the rear main bearing.' : 'Closes the rear of the rotor housing and holds the rear main bearing.', specs: [['Material', 'cast iron, ground face']] },
    midPlate: { name: 'Intermediate housing', group: 'Housing', role: 'The wall between the two rotor housings. Its bore is large enough for an eccentric lobe to pass, so the one-piece shaft can go in from the end.', specs: [['Bore', `Ø ${2 * 54} mm`]] },
    bolt: { name: 'Tension bolts', group: 'Frame', role: 'Long bolts that clamp the stack of housings together. The housings have no gaskets: the bolts hold the ground faces tight enough to seal.', specs: [['Thread', 'M10']] },
    rotor: { name: 'Rotor', group: 'Rotor', role: 'A triangle with curved flanks. It turns on the eccentric lobe at one third of the shaft speed, and each flank makes a chamber with the housing. All three chambers go through intake, compression, power and exhaust in one rotor turn.', specs: [['Flank', 'inner envelope of the housing'], ['Width', `${W} mm`], ['Speed', '1/3 shaft']], live: ['rotorAngle', 'rotorRpm'] },
    pocket: { name: 'Combustion pocket', group: 'Rotor', role: 'A recess in each flank. At the top waist it keeps the chamber from being cut in two, so the flame can travel across, and its volume sets the compression ratio.', specs: [['Pockets', cc(vt.pocketVol)], ['Ratio', `${vt.CR.toFixed(1)} : 1`]], live: ['chamberV'] },
    ringGear: { name: 'Internal ring gear', group: 'Gearing', role: 'Fixed in the rotor face. It rolls round the stationary gear. Its pitch radius is 1.5 times that of the stationary gear, so the rotor turns once while the shaft turns three times.', specs: [['Teeth', String(gear.ring)], ['Module', `${gear.m} mm`], ['Pitch radius', `${gear.m * gear.ring / 2} mm`]], live: ['rotorAngle'] },
    pinion: { name: 'Stationary gear', group: 'Gearing', role: 'The phasing gear. It never turns: it is bolted to the side housing round the shaft. It does not drive anything. It only keeps the rotor in phase with the shaft.', specs: [['Teeth', String(gear.fixed)], ['Pitch radius', `${gear.m * gear.fixed / 2} mm`], ['Ratio', `${gear.ring} : ${gear.fixed} = 3 : 2`]] },
    bearing: { name: 'Rotor bearing', group: 'Rotor', role: 'A plain bearing in the rotor bore. The gas force on the flanks goes through it into the eccentric lobe, and that force times the eccentricity is the torque.', specs: [['Bore', `Ø ${2 * GEO.lobe} mm`]], live: ['torque'] },
    shaft: { name: 'Eccentric shaft', group: 'Shaft', role: twin ? 'The output shaft. Two lobes, 180 degrees apart, carry the two rotors, so the forces on the shaft balance and there is a power stroke every half turn.' : 'The output shaft. Its lobe is the crank: the rotor centre goes round it at shaft speed, offset by e.', specs: [['Eccentricity', `${e} mm`], ['Lobe', `Ø ${2 * GEO.lobe} mm`], ['Journal', `Ø ${2 * GEO.journal} mm`]], live: ['shaft', 'torque'] },
    flywheel: { name: 'Flywheel', group: 'Shaft', role: 'Stores energy between power strokes. The ring of teeth on its rim is for the starter motor.', specs: [['Diameter', '160 mm'], ['Starter teeth', '96']], live: ['shaft'] },
    mainBearing: { name: 'Main bearing', group: 'Shaft', role: 'A plain bearing in the side housing that holds the shaft on its axis.', specs: [] },
    apexSeal: { name: 'Apex seal', group: 'Seals', role: 'A blade in a slot at each tip of the rotor. Gas pressure and a small spring push it out against the housing. It must lean over as the rotor turns, because the housing surface is not square to the rotor radius.', specs: [['Lean, largest', `±${(LEAN_MAX / D).toFixed(1)}° = asin(3/K)`]], live: ['lean', 'apexSpeed'] },
    sideSeal: { name: 'Side seals', group: 'Seals', role: 'Thin strips along each flank on both rotor faces. They seal the chambers against the side housings.', specs: [] },
    cornerSeal: { name: 'Corner seals', group: 'Seals', role: 'Small buttons where the apex seal meets the two side seals. They close the gap at each corner.', specs: [] },
    oilSeal: { name: 'Oil seal rings', group: 'Seals', role: 'Rings on the rotor faces round the bearing. They keep the oil in the middle of the rotor out of the chambers.', specs: [] },
    plug: { name: 'Spark plugs', group: 'Ignition', role: 'Two per rotor at the top waist. The leading plug fires first; the trailing plug, behind it, burns the mixture that the rotor pushes away from the first one.', specs: [['Timing', `${(GEO.spark / D * 3).toFixed(0)}° shaft before the waist`]], live: ['spark'] },
    intake: { name: 'Intake port', group: 'Breathing', role: 'A peripheral port just after the bottom waist. The chamber that has just closed on the waist grows past it and pulls in the mixture.', specs: [['Pressure', `${GEO.pIn} bar`]], live: ['intakeV'] },
    exhaust: { name: 'Exhaust port', group: 'Breathing', role: 'Just before the bottom waist. The chamber after its power stroke shrinks past it and pushes the burnt gas out. There are no valves: the apexes open and close both ports.', specs: [], live: ['exhaustV'] },
  };
}
