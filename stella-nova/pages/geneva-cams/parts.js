// ============================================================================
//  GENEVA DRIVE & CAMS  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, geneva } from './mech.js';

export const GROUP_COLOR = {
  'Input': '#e9c27a', 'Output': '#8fb0ff', 'Locking': '#f0a46a', 'Follower': '#8fe0c0', 'Frame': '#9aa6c0',
};
const deg = r => `${(r * 180 / Math.PI).toFixed(1)}°`;

export function partsFor(id) {
  const u = unit(id), common = {
    base: { name: 'Base plate', group: 'Frame', role: 'A painted steel plate that holds the shaft bosses at their centre distance. Every motion here is relative to it.', specs: [] },
    shaft: { name: 'Shaft', group: 'Frame', role: 'A ground steel shaft in a bronze-bushed boss. It carries one wheel and turns with it.', specs: [['Diameter', '20 mm']], live: ['wIn'] },
    pulley: { name: 'Drive pulley', group: 'Input', role: 'A belt from a motor turns this pulley at a steady speed. All the stop-and-go motion comes from the mechanism, not from the motor.', specs: [['Groove', 'V-belt']], live: ['wIn'] },
  };
  if (u.n) {
    const G = geneva(u);
    return { ...common,
      crank: { name: 'Driver crank', group: 'Input', role: 'Turns at constant speed and carries the drive pin. It turns once for each step of the star.', specs: [['Pin radius r', `${G.r.toFixed(1)} mm`], ['Centre distance a', `${G.a} mm`]], live: ['wIn', 'theta'] },
      pin: { name: 'Drive pin', group: 'Input', role: `It enters a slot at a right angle to the line of centres, so it meets the slot along the slot axis and there is no shock. It pushes the star through ${(360 / G.n).toFixed(0)}° and leaves the slot the same way.`, specs: [['Diameter', `${2 * G.pinR} mm`], ['In a slot', `${(2 * G.alpha0 * 180 / Math.PI).toFixed(0)}° of each turn`]], live: ['phase'] },
      lock: { name: 'Locking disc', group: 'Locking', role: 'A disc on the driver that fits a concave arc of the star while the pin is out of the slots. The star cannot turn, so the output stays exactly in place in the dwell. A relief cut lets the star tips pass while the pin turns it.', specs: [['Radius', `${G.Rl.toFixed(1)} mm`], ['Clearance', `${u.clr} mm`]], live: ['phase'] },
      star: { name: `Star wheel, ${G.n} slots`, group: 'Output', role: `The driven wheel. It turns ${(360 / G.n).toFixed(0)}° while the pin is in a slot, then stands still for ${(G.dwell * 100).toFixed(0)}% of the turn. Its speed rises from zero to a peak in mid-step and back to zero.`, specs: [['Tip radius', `${G.R2.toFixed(1)} mm`], ['Step', `${(360 / G.n).toFixed(0)}°`], ['Dwell', `${(G.dwell * 100).toFixed(1)}% of a turn`]], live: ['psi', 'wOut'] },
      table: { name: 'Index table', group: 'Output', role: `A turntable on the star shaft with ${G.n} work stations. It stops each station at the same place so a tool can work on it: film advance, bottle filling, machine-tool turrets.`, specs: [['Stations', String(G.n)]], live: ['station'] },
    };
  }
  return { ...common,
    cam: { name: 'Disc cam', group: 'Input', role: 'The outline is the pitch curve of the roller centre moved in by the roller radius. Its radius sets the follower travel at every angle.', specs: [['Base circle', `${u.Rb} mm`], ['Lift', `${u.h} mm`], ['Program', `rise ${u.B1}°, dwell ${u.D1}°, return ${u.B2}°, dwell ${u.D2}°`], ['Law', 'cycloidal']], live: ['theta', 'seg'] },
    roller: { name: 'Roller', group: 'Follower', role: 'It rolls on the cam, so the contact has little sliding and little wear. The cam pushes it along the common normal, which is tilted by the pressure angle from the stem.', specs: [['Radius', `${u.Rr} mm`]], live: ['press'] },
    stem: { name: 'Follower', group: 'Follower', role: 'A clevis, a stem and a collar that slide together on the x axis. The cycloidal law starts and ends each move with zero speed and zero acceleration, so the stem does not jerk.', specs: [['Travel', `${u.h} mm`]], live: ['s', 'v'] },
    guide: { name: 'Guide bushing', group: 'Frame', role: 'A bronze bushing on a bracket. It takes the side load that the pressure angle makes; a large pressure angle would make the stem jam.', specs: [['Bore', '17 mm']] },
    spring: { name: 'Return spring', group: 'Follower', role: 'It holds the roller on the cam on the way back. Without it the follower would leave the cam on the return.', specs: [['Turns', '6'], ['Wire', '4 mm']], live: ['s'] },
  };
}
