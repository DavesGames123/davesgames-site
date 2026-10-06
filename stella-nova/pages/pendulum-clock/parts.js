// ============================================================================
//  PENDULUM CLOCK  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, design, CLOCK, RATIO, DEG } from './mech.js';

export const GROUP_COLOR = { 'Regulator': '#e9c27a', 'Escapement': '#e9a0a8', 'Train': '#8fb0ff', 'Drive': '#8fe0c0', 'Frame': '#9aa6c0' };

export function partsFor(id) {
  const u = unit(id), D = design(u), d = v => `${(v / DEG).toFixed(1)}°`;
  // only the entry for this unit is built (the others need numbers it lacks)
  const pallets = {
    anchor: () => ({ name: 'Anchor', group: 'Escapement', role: 'Two inclined pallet faces on one arbor with the pendulum. A tooth slides down a face and pushes the pendulum, drops off the tip, and lands on the other face. The pendulum then swings on and pushes the wheel back: recoil.', specs: [['Spans', `${u.span + 0.5} teeth`], ['Release', `±${d(u.thr)}`], ['Drop', d(u.drop)], ['Face slope', `dφ/dθ = ${D.G.toFixed(2)}`]], live: ['pallet', 'recoil'] }),
    deadbeat: () => ({ name: 'Deadbeat pallets', group: 'Escapement', role: 'Graham\'s pallets. Each has an impulse face and a locking face, an arc about the pallet arbor. A tooth on the locking face stays dead still while the pendulum swings on: no recoil, and only a little friction.', specs: [['Spans', `${u.span + 0.5} teeth`], ['Lock', d(u.thl)], ['Lift', d(u.thr + u.thl)], ['Drop', d(u.drop)]], live: ['pallet', 'recoil'] }),
    grasshopper: () => ({ name: 'Pallet frame', group: 'Escapement', role: 'The frame turns with the pendulum and carries the two hinged pallet arms. Harrison made it light and ran it without oil.', specs: [['Spans', `${u.span + 0.5} teeth`], ['Arbor above the wheel', `${u.a} mm`]], live: ['pallet', 'recoil'] }),
  }[id]();
  const P = {
    base: { name: 'Backboard', group: 'Frame', role: 'The seat of the movement and the fixed frame for the pendulum. In a long-case clock this is the back of the trunk.', specs: [] },
    plates: { name: 'Plates and pillars', group: 'Frame', role: 'Two brass plates held apart by four pillars. Every arbor of the train runs in a pivot hole in each plate.', specs: [['Between plates', '40 mm']] },
    pendulum: { name: 'Pendulum', group: 'Regulator', role: 'It sets the rate. Its period depends only on its length and on g at small swings: T = 2π√(L/g). A seconds pendulum is about 994 mm long and beats once a second.', specs: [['Length L', `${(CLOCK.L * 1000).toFixed(0)} mm`], ['Period at small swings', '2.000 s']], live: ['period', 'amp'] },
    bob: { name: 'Bob', group: 'Regulator', role: 'A heavy lens of brass. The rating nut under it moves it up or down: up makes the clock gain. One turn of a 0.5 mm thread changes the rate by about 22 s a day.', specs: [['Mass', `${CLOCK.m} kg`], ['Q of the swing', String(CLOCK.Q)]], live: ['amp'] },
    pallets,
    escape: { name: 'Escape wheel', group: 'Escapement', role: `${CLOCK.N} teeth. It moves one tooth per pendulum period, so it turns once a minute and carries the seconds hand. It gives the pendulum a small push at each beat and holds the train still between beats.`, specs: [['Teeth', String(CLOCK.N)], ['Tip radius', `${CLOCK.Rw} mm`], ['Turns', '1 per minute']], live: ['wheel', 'recoil'] },
    third: { name: 'Third wheel', group: 'Train', role: 'The 60 tooth third wheel drives the 8 leaf escape pinion. The escape wheel turns 15 times for each 2 turns of the third wheel.', specs: [['Wheel', '60 teeth'], ['Pinion', '8 leaves'], ['Turns', '1 per 7.5 min']] },
    centre: { name: 'Centre wheel', group: 'Train', role: 'Its arbor turns once an hour; on a full clock it carries the minute hand. Its 64 teeth drive the 8 leaf third pinion.', specs: [['Wheel', '64 teeth'], ['Pinion', '8 leaves'], ['Turns', '1 per hour']] },
    barrel: { name: 'Great wheel and barrel', group: 'Drive', role: `The weight cord winds on the barrel. Its 96 tooth great wheel drives the 8 leaf centre pinion. From barrel to escape wheel the train gears up ${RATIO} times, so the large torque of the weight is a very small torque at the escape wheel.`, specs: [['Wheel', '96 teeth'], ['Barrel radius', `${CLOCK.rb * 1000} mm`], ['Turns', '1 per 12 hours']], live: ['torque'] },
    weight: { name: 'Drive weight', group: 'Drive', role: 'The only source of energy. It falls about 10 mm an hour. The escapement lets the train move one tooth per beat, so the weight runs the clock for days.', specs: [['Train efficiency', `${CLOCK.eta * 100}% (set)`]], live: ['torque', 'power'] },
  };
  if (id === 'grasshopper') P.legs = { name: 'Pallet arm (nib)', group: 'Escapement', role: 'A hinged arm with a nib at its end. The nib takes a tooth and stays on it with no sliding. When the other nib takes its tooth, it pushes the wheel back a little and this arm springs clear, like the leg of a grasshopper.', specs: [['Nib radius', `${u.rn} mm`]], live: ['pallet'] };
  return P;
}
