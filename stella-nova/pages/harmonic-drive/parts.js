// ============================================================================
//  HARMONIC & CYCLOIDAL DRIVES  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the drive.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit } from './drive.js';

export const GROUP_COLOR = { 'Input': '#e9c27a', 'Output': '#e9a0a8', 'Fixed': '#9aa6c0', 'Flexible': '#8fb0ff', 'Rolling': '#8fe0c0' };

export function partsFor(id) {
  const u = unit(id);
  if (id === 'harmonic') return {
    cs: { name: 'Circular spline', group: 'Fixed', role: `A rigid ring with ${u.Nc} internal teeth, bolted to the robot arm. It has two teeth more than the flexspline.`, specs: [['Teeth', String(u.Nc)], ['Module', `${u.m} mm`]] },
    fs: { name: 'Flexspline', group: 'Flexible', role: `A thin steel cup with ${u.Nf} teeth round its open end. The wave generator bends it into an oval, so its teeth mesh with the circular spline only at the two ends of the long axis. Each input turn moves it back by two teeth.`, specs: [['Teeth', String(u.Nf)], ['Wave', `±${u.d} mm, two lobes`]], live: ['out'] },
    out: { name: 'Output shaft', group: 'Output', role: 'Bolted to the flexspline diaphragm. The closed end of the cup stays round, so it can carry the output torque.', specs: [['Ratio', `${u.Nf} / (${u.Nc} − ${u.Nf}) = ${u.Nf / (u.Nc - u.Nf)}`]], live: ['out'] },
    wg: { name: 'Wave generator', group: 'Input', role: 'An oval plug on the motor shaft. As it turns, the two engaged zones run round the circumference: the strain wave.', specs: [['Lobes', '2']], live: ['in'] },
    bearing: { name: 'Flexible bearing', group: 'Rolling', role: 'A thin-race ball bearing pressed onto the oval plug. Its races bend with the flexspline, so the plug can turn fast inside a cup that turns slowly.', specs: [] },
  };
  return {
    housing: { name: 'Pin housing', group: 'Fixed', role: `A fixed ring with ${u.Np} pins (often rollers) on a circle of radius ${u.R} mm.`, specs: [['Pins', String(u.Np)], ['Pin circle', `R ${u.R} mm`]] },
    pins: { name: 'Ring pins', group: 'Fixed', role: 'The disc lobes roll on these pins. About half the pins carry load at any time, which is why cycloidal drives take shock loads well.', specs: [['Radius', `${u.Rr} mm`]], live: ['touch'] },
    disc: { name: 'Cycloid disc', group: 'Rolling', role: `${u.Np - 1} lobes, one fewer than the pins. Its outline is the path of a pin centre seen from the disc, moved in by the pin radius. It wobbles on the eccentric and rolls round the pins, turning back one lobe per input turn.`, specs: [['Lobes', String(u.Np - 1)], ['Eccentricity', `${u.E} mm`], ['Discs', '2, at 180°']], live: ['out'] },
    ecc: { name: 'Eccentric input shaft', group: 'Input', role: 'Two cams 180° apart, one for each disc, so the two wobbling discs balance each other.', specs: [['Throw', `${u.E} mm`]], live: ['in'] },
    flange: { name: 'Output flange', group: 'Output', role: 'Its pins pass through holes in the discs that are larger by twice the throw. The pins stay in contact with the hole walls, so they take only the slow turn of the discs, not their wobble.', specs: [['Pins', String(u.nOut)], ['Ratio', `${u.Np - 1} : 1`]], live: ['out'] },
  };
}
