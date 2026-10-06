// ============================================================================
//  PASCALINE & CURTA  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, LIFT0 } from './mech.js';

export const GROUP_COLOR = { 'Input': '#e9c27a', 'Carry': '#e9a0a8', 'Register': '#8fb0ff', 'Frame': '#9aa6c0', 'Drive': '#c8a6ff' };

export function partsFor(id) {
  const u = unit(id);
  if (id === 'pascaline') return {
    base: { name: 'Case', group: 'Frame', role: 'The box that holds the axles. Pascal built about fifty machines between 1642 and the 1650s, in wood and brass; this one is open at the front so the carry is in view.', specs: [['Wheels', String(u.N)]] },
    cover: { name: 'Cover', group: 'Frame', role: 'The top plate. It carries the fixed digit rings and the stop fingers, and it has a window over each digit drum.', specs: [] },
    dial: { name: 'Input dial', group: 'Input', role: 'Put the stylus between the spokes at the digit on the ring, and turn clockwise to the stop finger. The wheel turns that many tenths. The dials only turn one way: to subtract, Pascal used nines\' complements.', specs: [['Spokes', '10']], live: ['display'] },
    wheel: { name: 'Carry wheel', group: 'Carry', role: 'The horizontal axle of one digit. A lantern pinion meets the crown of the dial 1:1. Ten pins on the carry wheel take the push of the sautoir from the stage below; one long pin lifts the sautoir of the stage above.', specs: [['Drive pins', '10'], ['Lift pin', '1']], live: ['display'] },
    drum: { name: 'Digit drum', group: 'Register', role: 'The digits 0 to 9 round a drum on the axle. The window in the cover shows the digit at the top.', specs: [], live: ['display'] },
    sautoir: { name: 'Sautoir', group: 'Carry', role: `A weighted lever that pivots on the next axle. The lift pin of the wheel below raises it while that wheel turns from ${LIFT0} to 9. When the wheel goes from 9 to 0 the pin lets go, the weight falls, and its pawl pushes the next wheel one tenth. The weight stores the work of the carry, so a ripple through every wheel needs no more force at the stylus than one carry.`, specs: [['Fall', 'one tenth of a turn']], live: ['carries'] },
  };
  return {
    base: { name: 'Case', group: 'Frame', role: 'The body that you hold in one hand. Curt Herzstark designed the Curta in the Buchenwald camp and it was made in Liechtenstein from 1948 to 1972. Here a window shows the drum.', specs: [['Sliders', String(u.NS)]] },
    drum: { name: 'Stepped drum', group: 'Drive', role: 'Leibniz\'s stepped drum: nine teeth with lengths 1 to 9. One crank turn turns it once. A gear at level s meets s teeth, so it turns s tenths. The Curta has one drum for all digits, with the setting shafts round it.', specs: [['Teeth', '9 steps'], ['Carry teeth', String(u.NR) + ', on a helix']], live: ['turns'] },
    shaft: { name: 'Setting shaft', group: 'Drive', role: 'A square shaft beside the drum. Its gear slides along it, and a pinion at the top passes its turn to a result wheel in the carriage.', specs: [] },
    setgear: { name: 'Setting gear', group: 'Input', role: 'The slider moves this gear up or down the square shaft. At digit s it sits where s teeth of the drum reach it.', specs: [['Levels', '0 to 9']], live: ['set'] },
    slider: { name: 'Setting slider', group: 'Input', role: 'One slider for each digit of the number to add. It moves the setting gear to its level on the drum.', specs: [['Digits', String(u.NS)]], live: ['set'] },
    carriage: { name: 'Carriage', group: 'Register', role: 'The top ring with the result and the turn counter. Lift it and turn it to shift: each shift moves the result wheels one place over the setting shafts, so a turn adds ten times the setting.', specs: [['Positions', String(u.NC)]], live: ['shift'] },
    result: { name: 'Result wheels', group: 'Register', role: 'Eleven wheels. In each turn every wheel first takes its digit from the drum, then the carry teeth on a helix give each wheel its carry, lowest digit first. A ripple from the lowest digit to the top ends in one turn.', specs: [['Digits', String(u.NR)]], live: ['display', 'carries'] },
    counter: { name: 'Turn counter', group: 'Register', role: 'Adds 1 at the carriage position in each turn, so it counts the multiplier while the result builds the product.', specs: [['Digits', String(u.NC)]], live: ['count'] },
    crank: { name: 'Crank', group: 'Input', role: 'One turn adds the setting once. Pull it up before a turn to subtract (by nines\' complement); this page shows only addition.', specs: [], live: ['turns'] },
  };
}
