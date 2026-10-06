// ============================================================================
//  UNIVERSAL & CV JOINTS  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table for each joint
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { SIZE } from './mech.js';

export const GROUP_COLOR = { 'Input': '#e9c27a', 'Output': '#e9a0a8', 'Coupling': '#8fb0ff', 'Rolling': '#8fe0c0', 'Frame': '#9aa6c0', 'Marker': '#e07a6a' };

export function partsFor(id) {
  const common = {
    base: { name: 'Base and pillow blocks', group: 'Frame', role: 'A base plate with a pillow block on each outer shaft. The blocks slide along the plate when you change the shaft angle, so each shaft keeps its line through the joint centre.', specs: [['Shaft height', '70 mm']] },
    fin: { name: 'Index fins', group: 'Marker', role: 'A red fin on the input shaft and one on the output shaft. Watch them against each other: on a single Cardan joint the output fin runs ahead, then falls behind, twice per turn.', specs: [], live: ['in', 'out', 'err'] },
  };
  if (id === 'rzeppa') return { ...common,
    bell: { name: 'Outer race (bell)', group: 'Input', role: 'A hollow sphere with six curved grooves on its inside. Here the grooves are cut through, so you can see the balls. In a car the bell is on the wheel side.', specs: [['Inner sphere', 'R 42.5 mm'], ['Grooves', '6']], live: ['in'] },
    inner: { name: 'Inner race', group: 'Output', role: 'A sphere with six grooves on its outside, splined to the drive shaft. The balls carry the torque from groove to groove.', specs: [['Sphere', 'R 33.5 mm']], live: ['out'] },
    cage: { name: 'Ball cage', group: 'Coupling', role: 'A ring with six windows. The groove shapes steer it so that it always lies on the plane that bisects the angle between the shafts. That plane is the reason the joint is constant-velocity.', specs: [['Tilt', 'half the shaft angle']], live: ['tilt'] },
    ball: { name: 'Balls', group: 'Rolling', role: 'Six steel balls. Each ball is in one input groove and one output groove at the same time, at the same distance from both shaft axes. So both shafts turn at the same speed.', specs: [['Diameter', `${2 * SIZE.rb} mm`], ['Pitch radius', `${SIZE.rp} mm`]], live: ['shift'] },
  };
  return { ...common,
    inYoke: { name: 'Input yoke', group: 'Input', role: 'A fork on the input shaft. Its two ears hold one arm pair of the cross in needle bearings.', specs: [['Shaft', '20 mm']], live: ['in'] },
    cross: { name: 'Cross (spider)', group: 'Coupling', role: 'Four arms at 90°. One pair turns in the input fork, the other pair in the output fork. Because the arms stay square while the forks are at an angle, the output cannot keep pace with the input at every instant.', specs: [['Arm length', `${SIZE.arm} mm`]] },
    outYoke: { name: 'Output yoke', group: 'Output', role: id === 'cardan' ? 'Turns at a speed that swings between cos β and 1/cos β times the input speed, twice per turn.' : 'The second joint takes out the ripple of the first, so this shaft turns at the input speed.', specs: [], live: ['out', 'ratio'] },
    ...(id === 'cardan' ? {} : {
      midShaft: { name: 'Intermediate shaft', group: 'Coupling', role: 'It turns with the ripple of the first joint. Its two forks must lie in one plane (in phase), and the two joint angles must be equal. Then the second joint puts the ripple back the other way.', specs: [['Length', `${SIZE.Lm} mm`]], live: ['mid'] },
    }),
  };
}
