// ============================================================================
//  CURTA  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue(). Where the page
//  had to choose a mechanism detail, the role says "in this model".
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, geo, RES_CARRY, CNT_DRIVE } from './mech.js';

export const GROUP_COLOR = { Input: '#e9c27a', Drive: '#c8a6ff', Carry: '#ff9a8a', Register: '#8fb0ff', Frame: '#9aa6c0', Counter: '#7ee0c3' };

export function partsFor(id) {
  const U = unit(id), G = geo(U), mm = v => `${v.toFixed(1)} mm`;
  return {
    base: { name: 'Base and floor', group: 'Frame', role: 'The black cap under the body and the machined floor plate inside it. The floor holds the lower bearings of every station shaft and the crank detent.', specs: [['Diameter', `${U.dia} mm (published)`]] },
    shell: { name: 'Housing', group: 'Frame', role: `The black body that you hold in one hand. It has one slot for each slider, with the digits 0 to 9 engraved beside it. Type ${U.id} is about ${U.dia} mm across and ${U.height} mm tall, and weighs about ${U.mass} g.`, specs: [['Slots', String(U.NS)], ['Mass', `about ${U.mass} g`]] },
    detent: { name: 'Crank detent', group: 'Drive', role: 'A spring pawl that drops into a notch of the drum at the home position. It holds the crank at home, and you feel the end of each turn. The Curta has no bell: a result that is too large just wraps round.', specs: [['Notches', '1']], live: ['crankAt'] },
    drum: { name: 'Drum core', group: 'Carry', role: 'The core turns once for each crank turn and does not lift. It carries the red carry tooth for the result stations, the counter drive tooth and the counter carry tooth, and the detent wheel at the base.', specs: [['Carry tooth at', `${RES_CARRY}° + station × pitch`], ['Counter drive at', `${CNT_DRIVE}°`]], live: ['crankAt', 'carries'] },
    sleeve: { name: 'Stepped drum', group: 'Drive', role: 'Leibniz\'s stepped drum, as one central drum for all digits. Nine rows of teeth: a gear at level s meets s steel add teeth. Below each level is a half level with blued complement teeth: a gear there meets 9 − s. Pull the crank up and the sleeve lifts half a level, so every gear meets the complement teeth.', specs: [['Tooth rows', '9'], ['Level pitch', mm(G.Lp)], ['Lift', mm(G.sleeve.lift)]], live: ['mode', 'crankAt'] },
    shaft: { name: 'Setting shaft', group: 'Drive', role: 'A square shaft round the drum, one for each slider. Its setting gear slides on it; the turn goes up the shaft to a dog coupling under the carriage, and from there to a result wheel.', specs: [['Radius from axis', mm(G.RS)]] },
    nines: { name: 'Nines station', group: 'Drive', role: 'A station above the sliders, with its gear fixed at level 0. When adding it meets no teeth. When subtracting it meets nine complement teeth, so the result wheels above the setting also take the complement (in this model; it gives the full tens complement that a Curta shows).', specs: [['Stations', String(U.NR - U.NS)]] },
    setgear: { name: 'Setting gear', group: 'Input', role: 'A 10-tooth gear on the square shaft. Its slider moves it to the level of the digit; one drum turn then turns it that many tenths (or 9 − s tenths with the crank up).', specs: [['Teeth', '10'], ['Levels', '0 to 9']], live: ['set'] },
    carrygear: { name: 'Carry gear', group: 'Carry', role: 'A second gear on each station shaft. It waits above the plane of the carry tooth. When the wheel below it in the carriage goes from 9 to 0, its slide pushes this gear down, and the carry tooth turns the shaft one more tenth later in the same turn.', specs: [['Drop', mm(G.carry.idle - G.carry.eng)]], live: ['carries'] },
    slide: { name: 'Carry slide', group: 'Carry', role: 'A slide that holds the carry gear in its groove. Its top pin comes up through the deck, under the carry lever of the carriage. After the carry tooth has passed, it goes back up.', specs: [] , live: ['carries'] },
    slider: { name: 'Setting slider', group: 'Input', role: 'One slider for each digit of the number to set. The knob moves a block on a guide rail; a fork on the block holds the groove of the setting gear and moves it to its level. Drag a knob to set it.', specs: [['Sliders', String(U.NS)]], live: ['set'] },
    cdrive: { name: 'Counter drive', group: 'Counter', role: 'The fixed counter station under counter wheel c. The drive tooth on the drum gives it one tenth in each turn. A reversing pinion sets the direction.', specs: [] , live: ['count'] },
    cshaft: { name: 'Counter station', group: 'Counter', role: 'A counter station shaft. It has no drive gear, only a carry gear, so the counter takes one tenth per turn at place c and carries above it.', specs: [] , live: ['count'] },
    ccarry: { name: 'Counter carry gear', group: 'Counter', role: 'The counter carries work as the result carries: a wheel that passes 9 to 0 (or 0 to 9 going down) drops the carry gear of the next station, and the counter carry tooth turns it one tenth.', specs: [] , live: ['count'] },
    reverse: { name: 'Reversing pinion', group: 'Counter', role: 'In this model, a small idler between the counter drive and station 0. It moves out when exactly one of these is true: the crank is up, the reversing lever is on. Then the counter counts down.', specs: [] , live: ['dir'] },
    revlever: { name: 'Reversing lever', group: 'Counter', role: 'Turns the counter direction over. For division and square roots, set it on: then each subtraction turn counts up, and the counter shows the quotient or the root.', specs: [] , live: ['rev'] },
    deck: { name: 'Top deck', group: 'Frame', role: 'The machined plate over the drum. The station shafts and the carry slides come up through it. Its rim carries the shift scale 1 to ' + U.NC + ' that the carriage index points to.', specs: [] },
    carriage: { name: 'Carriage', group: 'Register', role: `The top ring with ${U.NR} result wheels and ${U.NC} counter wheels. To shift, lift it off the dog couplings and turn it one place: each turn then adds ten times the setting. It turns only when lifted.`, specs: [['Positions', String(U.NC)]], live: ['shift'] },
    decimal: { name: 'Decimal markers', group: 'Register', role: 'Small ivory tabs in the top plate that the user slides to mark the decimal point in each register. They do not touch the mechanism.', specs: [] },
    inter: { name: 'Intermediate pinion', group: 'Register', role: 'In the carriage: a short shaft with a dog coupling at the bottom and a pinion at the top. Over a station it takes the turn of the station shaft and passes it to the crown of the digit wheel.', specs: [['Ratio', '1 : 1']], live: ['display'] },
    result: { name: 'Result wheels', group: 'Register', role: `${U.NR} digit wheels. Each takes its digit from its station in the add phase, then its carry from the carry tooth in the carry phase, from the lowest wheel up. A wheel that passes 9 to 0 trips the carry lever of the next.`, specs: [['Digits', String(U.NR)]], live: ['display', 'carries'] },
    carrylever: { name: 'Carry lever', group: 'Carry', role: 'A rocker in the carriage. The trip tooth of the wheel before it (9 → 0) rocks it, and its foot pushes the carry slide of the station under its own wheel down.', specs: [] , live: ['carries'] },
    cinter: { name: 'Counter pinion', group: 'Counter', role: 'The counter wheels have their own pinions and dog couplings, as the result wheels.', specs: [] },
    counter: { name: 'Turn counter', group: 'Counter', role: `${U.NC} wheels that count the turns at the carriage place: up for an add turn, down for a subtract turn (and the other way with the reversing lever on). After a product it shows the multiplier.`, specs: [['Digits', String(U.NC)]], live: ['count', 'dir'] },
    clearing: { name: 'Clearing lever', group: 'Register', role: 'Lift the carriage and swing this lever once round. As its finger passes each wheel, the wheel turns forward to 0. Both registers clear; the sliders keep their setting.', specs: [] },
    crank: { name: 'Crank', group: 'Input', role: 'One clockwise turn turns the drum once. Pull it up at the home position to subtract: the red band shows, the stepped sleeve lifts half a level, and the subtraction carry slide goes down.', specs: [['Lift', mm(G.crank.lift)]], live: ['mode', 'crankAt'] },
  };
}
