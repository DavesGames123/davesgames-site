// ============================================================================
//  DIFFERENTIAL  ·  parts.js — what each part is called and what it does
// ────────────────────────────────────────────────────────────────────────────
//  partsFor(variant) returns PARTS[id] = { name, group, role, specs, live }.
//  The ids match the info ids of scene.js (both spiders share 'spider',
//  both half-shafts 'axle', and so on). live names the rows that cards.js
//  fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the diff.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { SPEC, BEV, HEL } from './diff.js';

export const GROUP_COLOR = {
  'Final drive': '#e9c27a', 'Differential gears': '#8fb0ff', 'Carrier': '#b9c0cf', 'Limited slip': '#f0a46a',
  'Axle': '#8fe0c0', 'Housing': '#9aa6c0', 'Bearings': '#c8a6ff', 'Wheels': '#e9a0a8',
};
const deg = r => `${(r * 180 / Math.PI).toFixed(1)}°`;

export function partsFor(variant) {
  const r = SPEC.ring, s = SPEC.side, h = SPEC.hel, torsen = variant === 'torsen', clutch = variant === 'clutch';
  return {
    housing: { name: 'Axle housing', group: 'Housing', role: 'A banjo housing of pressed or cast steel. It holds the carrier bearings and the pinion bearings in line, carries the axle tubes, and keeps the gear oil in. It is cut away here at the centre line.', specs: [['Cut', 'world y > 0 removed']] },
    pinion: { name: 'Drive pinion', group: 'Final drive', role: 'The propeller shaft turns this small spiral bevel gear. It drives the ring gear at a right angle, slows the drive by the final-drive ratio and multiplies the torque by the same number.', specs: [['Teeth', String(SPEC.pinion.N)], ['Pitch cone', deg(BEV.gP)], ['Spiral angle', deg(r.beta)]], live: ['wP', 'Tin'] },
    yoke: { name: 'Companion flange', group: 'Final drive', role: 'The propeller shaft bolts to this flange. A nut on the pinion stem clamps it and sets the preload of the two pinion bearings.', specs: [['Bolts', '4']], live: ['wP'] },
    pinionBrg: { name: 'Pinion bearings', group: 'Bearings', role: 'Two tapered roller bearings, set back to back. They take the end thrust that the spiral teeth make, which pushes the pinion along its axis.', specs: [['Type', 'tapered roller']] },
    carrierBrg: { name: 'Carrier bearings', group: 'Bearings', role: 'One tapered roller bearing on each trunnion of the case. Shims behind them set the backlash between ring and pinion.', specs: [['Type', 'tapered roller']], live: ['wC'] },
    ring: { name: 'Ring gear', group: 'Final drive', role: 'Bolted to the carrier, so the whole carrier turns at the ring gear speed. Every turn of the ring gear takes ' + (r.N / SPEC.pinion.N).toFixed(2) + ' turns of the pinion.', specs: [['Teeth', String(r.N)], ['Ratio', `${r.N}:${SPEC.pinion.N} = ${(r.N / SPEC.pinion.N).toFixed(3)}`], ['Pitch Ø', `${(r.N * r.m).toFixed(0)} mm`], ['Pitch cone', deg(BEV.gR)]], live: ['wC', 'Tc'] },
    case: { name: torsen ? 'Torsen case' : clutch ? 'Clutch case' : 'Carrier case', group: 'Carrier', role: torsen ? 'Holds the three pairs of element gears in pockets, parallel to the axle. Their ends rub on the pocket walls and the end faces: that friction is what biases the torque.' : clutch ? 'A closed case in two halves. Slots inside it hold the tabs of the steel plates, so those plates turn with the carrier.' : 'Carries the cross-shaft and the spiders round the axle. Its windows let oil in and let you see the gears.', specs: [['Halves', 'split at the centre line']], live: ['wC'] },
    crossShaft: { name: 'Cross-shaft', group: 'Carrier', role: 'The pin the spiders turn on. It is fixed in the case by a lock bolt, so the spiders are carried round with the ring gear and can also turn on the pin.', specs: [['Diameter', '16 mm']], live: ['wC'] },
    spider: { name: 'Spider gear', group: 'Differential gears', role: 'Also called a pinion mate or planet gear. When the two wheels turn at the same speed it does not turn on its pin: it is a lever that pushes both side gears equally. When one wheel turns faster, it rolls between the side gears and lets the speeds differ.', specs: [['Teeth', String(SPEC.spider.N)], ['Pitch cone', deg(BEV.gQ)]], live: ['spin', 'TL'] },
    side: { name: 'Side gear', group: 'Differential gears', role: 'Splined to a half-shaft. Each side gear meshes with both spiders, so each spider pushes on both side gears with the same force: the open differential always splits the torque equally.', specs: [['Teeth', String(s.N)], ['Pitch cone', deg(BEV.gS)], ['Module', `${s.m} mm`]], live: ['wL', 'wR'] },
    washer: { name: 'Thrust washer', group: 'Differential gears', role: 'A bronze washer behind each side gear. The gear separating force pushes the side gears outward against it.', specs: [] },
    axle: { name: 'Half-shaft', group: 'Axle', role: 'Splined into its side gear at the inner end, bolted to the wheel hub at the outer end. It turns at its wheel\'s speed and carries that wheel\'s share of the torque.', specs: [['Spline', '20 teeth']], live: ['wL', 'wR', 'TL', 'TR'] },
    wheelL: { name: 'Left wheel', group: 'Wheels', role: 'In a left turn this wheel is on the inside: it runs a shorter path and turns slower than the carrier.', specs: [['Tyre radius', `${SPEC.road.tire * 1000} mm`]], live: ['wL', 'TL'] },
    wheelR: { name: 'Right wheel', group: 'Wheels', role: 'In a left turn this wheel is on the outside: it runs a longer path and turns faster than the carrier, by as much as the left one is slower.', specs: [['Tyre radius', `${SPEC.road.tire * 1000} mm`]], live: ['wR', 'TR'] },
    steelPlate: { name: 'Steel plate', group: 'Limited slip', role: 'Tabs on the rim key these plates to the case, so they turn with the carrier. They are pressed against the lined plates between them.', specs: [['Per side', '4']], live: ['wC', 'slipRate'] },
    frictionPlate: { name: 'Lined plate', group: 'Limited slip', role: 'Splined to the side gear hub, so they turn with the wheel. When the wheel turns at a different speed from the carrier, these plates slip against the steel plates, and the friction pushes torque toward the slower wheel.', specs: [['Per side', '3'], ['Faces', '6 friction faces']], live: ['slipRate', 'Tf'] },
    spring: { name: 'Belleville preload spring', group: 'Limited slip', role: 'A dished spring washer that clamps the plate pack even with no throttle. It sets the preload torque: the torque it takes to turn one wheel against the other with the car on a lift.', specs: [['Preload', `${SPEC.clutch.pre} N·m`]], live: ['Tf'] },
    hside: { name: 'Helical side gear', group: 'Differential gears', role: 'Splined to its half-shaft. Its helical teeth mesh with one row of element gears. The helix makes an end thrust under load that presses the gear on its thrust washer: more torque, more friction.', specs: [['Teeth', String(h.NS)], ['Helix', deg(h.beta)], ['Pitch Ø', `${(2 * HEL.rS).toFixed(0)} mm`]], live: ['wL', 'wR'] },
    elemA: { name: 'Element gear (left)', group: 'Differential gears', role: 'Meshes with the left side gear and, in the middle, with its partner. It turns in a pocket of the case. Friction of its tips and ends on the pocket resists any speed difference.', specs: [['Teeth', String(h.NP)], ['Pairs', String(h.pairs)]], live: ['spin'] },
    elemB: { name: 'Element gear (right)', group: 'Differential gears', role: 'Meshes with the right side gear and with its partner. Because the two partners turn in opposite senses, the two side gears turn in opposite senses relative to the case.', specs: [['Teeth', String(h.NP)]], live: ['spin'] },
    spacer: { name: 'Centre spacer', group: 'Carrier', role: 'Keeps the two side gears apart, so the element gears can mesh with each other in the gap between them.', specs: [] },
  };
}
