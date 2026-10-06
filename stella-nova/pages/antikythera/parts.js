// ============================================================================
//  ANTIKYTHERA MECHANISM  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor() returns PARTS[info] = { name, group, role, specs, live }. The
//  keys match the info ids of scene.js. live names the rows that cards.js
//  fills each frame through main.js liveValue(). The numbers come from
//  mech.js, so a card shows the counts and rates that tests.mjs checks.
//
//  GREP MAP
//    export function partsFor ... the table
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { TEETH, RATE, PERIOD, MODULE, YEAR, SLOT, DIALS } from './mech.js';

export const GROUP_COLOR = { 'Input': '#e9c27a', 'Moon train': '#8fb0ff', 'Pin and slot': '#e9a0a8', 'Calendar train': '#9fd6a8', 'Dials': '#c8a6ff', 'Frame': '#9aa6c0' };

const w = (...ws) => ws.map(x => `${x} ${TEETH[x]}`).join(' · ');
const per = (r, unit = 'd') => { const d = YEAR / Math.abs(r); return d > 2 * YEAR ? `${(d / YEAR).toFixed(2)} yr` : `${d.toFixed(3)} ${unit}`; };
const spec = (ws, r) => [['Teeth', w(...ws)], ['Module', `${MODULE[ws[0]]} mm`], ['One turn', per(r)]];

export function partsFor() {
  return {
    base: { name: 'Stand and pillars', group: 'Frame', role: 'A wooden stand and four pillars that hold the two plates apart. The original sat in a wooden case; this frame is open at the sides so the gears show.', specs: [] },
    spindle: { name: 'e spindle', group: 'Frame', role: 'A fixed pin that carries the turntable and the two pipes of the e axis.', specs: [] },
    plateF: { name: 'Front plate', group: 'Frame', role: 'Carries the front dial. A round window shows the main wheel b1 and its four spokes behind it.', specs: [] },
    plateB: { name: 'Back plate', group: 'Frame', role: 'Carries the two spiral dials. Five arbors come through it to the pointers.', specs: [] },
    frontDial: { name: 'Zodiac and calendar', group: 'Dials', role: 'The inner ring has 360 degrees in the twelve signs, ΚΡΙΟΣ to ΙΧΘΥΕΣ (ΧΗΛΑΙ, the Claws, for Libra). The outer ring is the Egyptian year: twelve months of 30 days and five extra days, 365 in all.', specs: [['Zodiac', '12 × 30°'], ['Calendar', '12 × 30 + 5 d']] },
    metonic: { name: 'Metonic dial', group: 'Dials', role: 'A five-turn spiral of 235 month cells: 19 years. A bead on the pointer runs in the groove, so it shows which turn of the spiral is the current one.', specs: [['Cells', `${DIALS.metonic.cells} in ${DIALS.metonic.turns} turns`], ['Cycle', `${(PERIOD.metonic / YEAR).toFixed(2)} yr`]], live: ['metonic'] },
    saros: { name: 'Saros dial', group: 'Dials', role: 'A four-turn spiral of 223 month cells. After 223 synodic months, eclipses come back in nearly the same order, so the cells told which months could have one.', specs: [['Cells', `${DIALS.saros.cells} in ${DIALS.saros.turns} turns`], ['Cycle', `${(PERIOD.saros / YEAR).toFixed(2)} yr`]], live: ['saros'] },
    games: { name: 'Games dial', group: 'Dials', role: 'Four sectors, one per year of the Olympiad, with the games held that year: Isthmia, Olympia, Nemea, Pythia, Naa and Halieia.', specs: [['Turn', '4 years']], live: ['games'] },
    exeligmos: { name: 'Exeligmos dial', group: 'Dials', role: 'A Saros is 223 months plus about 8 hours. After three Saros the hours add up to a day. This pointer tells how many hours to add to an eclipse time: 0, 8 (Η) or 16 (ΙϚ).', specs: [['Turn', `${(PERIOD.exeligmos / YEAR).toFixed(1)} yr`]] },
    crank: { name: 'Crank and contrate a1', group: 'Input', role: 'The handle on the side. A contrate wheel (face teeth) on its axle drives b1 at its rim. Each turn of the handle moves the dials by about 78 days.', specs: [['Teeth', `a1 ${TEETH.a1} → b1 ${TEETH.b1}`], ['One turn', `${PERIOD.crank.toFixed(2)} d`]], live: ['day'] },
    b: { name: 'Main wheel b1', group: 'Input', role: 'The four-spoke wheel that turns once a year. Its pipe carries the Sun pointer on the front dial; b2 on the same arbor drives the Moon and calendar trains.', specs: [['Teeth', w('b1', 'b2')], ['One turn', `${YEAR} d`]], live: ['sun'] },
    moon: { name: 'Moon pointer b3', group: 'Moon train', role: 'b3 takes the Moon motion from e1 and turns the Moon pointer, inside the Sun pipe. It turns 254 times in 19 years, but not at a steady rate: the pin and slot speed it up and slow it down.', specs: [['Teeth', w('b3')], ['Mean turn', per(RATE.b3)]], live: ['moon'] },
    phase: { name: 'Phase ball', group: 'Moon train', role: 'A small ball, half silver and half dark, on the Moon pointer. It turns with the angle between Moon and Sun, so it shows the phase: dark at new Moon, silver at full.', specs: [['Turn', `${PERIOD.synodic.toFixed(3)} d`]], live: ['phase'] },
    c: { name: 'Arbor c', group: 'Moon train', role: 'First step of the Moon train.', specs: spec(['c1', 'c2'], RATE.c) },
    d: { name: 'Arbor d', group: 'Moon train', role: 'd2, with 127 teeth, half of 254, gives the sidereal Moon its 254 / 19 turns a year.', specs: spec(['d1', 'd2'], RATE.d) },
    e25: { name: 'e2 and e5 pipe', group: 'Moon train', role: 'Turns at the sidereal Moon rate. e5 drives k1 on the turntable.', specs: spec(['e2', 'e5'], RATE.e25) },
    e61: { name: 'e6 and e1 pipe', group: 'Moon train', role: 'k2 drives e6; e1 on the same pipe drives b3 and the Moon pointer. On average it turns with e2, but the pin and slot add the lunar anomaly.', specs: [['Teeth', w('e6', 'e1')], ['Mean turn', per(RATE.e61)]] },
    e34: { name: 'Turntable e3', group: 'Pin and slot', role: 'A 223-tooth wheel that carries k1 and k2 round the e axis once in about 8.9 years: the turn of the line of apsides of the lunar orbit. e4 on its hub drives the Saros train.', specs: [['Teeth', w('e3', 'e4')], ['One turn', per(RATE.e34)]], live: ['apsides'] },
    k1: { name: 'Pin wheel k1', group: 'Pin and slot', role: `Driven by e5. A pin on its back, ${SLOT.r} mm from its axis, runs in the slot of k2.`, specs: [['Teeth', w('k1')], ['Pin radius', `${SLOT.r} mm`]], live: ['anomaly'] },
    k2: { name: 'Slot wheel k2', group: 'Pin and slot', role: `Its axis is ${SLOT.d} mm from the k1 axis. When the pin is near the k2 axis, k2 turns fast; on the far side, slow. That is the lunar anomaly: the Moon is fastest at perigee.`, specs: [['Teeth', w('k2')], ['Axis offset', `${SLOT.d} mm`], ['Peak', `±${(Math.asin(SLOT.d / SLOT.r) * 180 / Math.PI).toFixed(2)}°`]], live: ['anomaly'] },
    l: { name: 'Arbor l', group: 'Calendar train', role: 'From b2 toward the Metonic dial.', specs: spec(['l1', 'l2'], RATE.l) },
    m: { name: 'Arbor m', group: 'Calendar train', role: 'Three wheels: m1 from l2, m2 to the Metonic arbor, m3 to the turntable e3.', specs: [['Teeth', w('m1', 'm2', 'm3')], ['One turn', per(RATE.m)]] },
    n: { name: 'Metonic arbor n', group: 'Calendar train', role: '5 turns in 19 years: one turn per spiral turn of the Metonic dial. n3 drives the Games dial.', specs: spec(['n1', 'n3'], RATE.n), live: ['metonic'] },
    o: { name: 'Games arbor o', group: 'Calendar train', role: 'n3 57 → o1 60: 5/19 × 57/60 = 1/4 turn a year.', specs: spec(['o1'], RATE.o), live: ['games'] },
    f: { name: 'Arbor f', group: 'Calendar train', role: 'From e4 on the turntable toward the Saros dial.', specs: spec(['f1', 'f2'], RATE.f) },
    g: { name: 'Saros arbor g', group: 'Calendar train', role: 'Four turns in 223 synodic months.', specs: spec(['g1', 'g2'], RATE.g), live: ['saros'] },
    h: { name: 'Arbor h', group: 'Calendar train', role: 'Steps the Saros rate down by 3, then 4.', specs: spec(['h1', 'h2'], RATE.h) },
    i: { name: 'Exeligmos arbor i', group: 'Calendar train', role: 'One turn in three Saros cycles.', specs: spec(['i1'], RATE.i) },
  };
}
