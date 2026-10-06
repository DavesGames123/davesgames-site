// ============================================================================
//  LINKAGES  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit } from './mech.js';

export const GROUP_COLOR = { 'Input': '#e9c27a', 'Links': '#8fb0ff', 'Output': '#e9a0a8', 'Frame': '#9aa6c0', 'Joints': '#c8a6ff' };

export function partsFor(id) {
  const u = unit(id), mm = v => `${v.toFixed(1)} mm`;
  const common = {
    base: { name: 'Backboard', group: 'Frame', role: 'The fixed link. Every linkage counts the frame as one of its bars: a four-bar has three moving links and the frame.', specs: [] },
    pin: { name: 'Pin joint', group: 'Joints', role: 'A revolute joint: the two links turn about it but cannot slide. Planar linkages here use only pin joints, so every joint is a circle-circle meeting.', specs: [['Diameter', '7 mm']] },
    hub: { name: 'Input hub', group: 'Input', role: 'The motor drives this hub at a steady speed. Everything else follows from the link lengths.', specs: [], live: ['input'] },
    trace: { name: id === 'peaucellier' ? 'Path of P' : id === 'jansen' ? 'Foot path' : 'Coupler curve', group: 'Output', role: id === 'peaucellier' ? 'The point P runs on an exact straight line, with no slide and no guide. Before 1864 nobody knew that pin joints alone could do this.' : id === 'jansen' ? 'The foot runs flat along the ground for about a third of the turn, then lifts and swings back: a walking step from a steady crank.' : 'The path of one point on the coupler. Different points on the coupler give very different curves; engineers pick one from an atlas of coupler curves.', specs: [], live: ['trace'] },
  };
  if (id === 'fourbar') return { ...common,
    crank: { name: 'Crank', group: 'Input', role: 'The shortest link. Grashof\'s rule (s + l ≤ p + q) lets it turn all the way round.', specs: [['Length a', mm(u.a)]], live: ['input'] },
    coupler: { name: 'Coupler', group: 'Links', role: 'The floating link between crank and rocker. A point on it, fixed to the bar, draws the coupler curve.', specs: [['Length b', mm(u.b)], ['Point', `${u.u} along, ${u.v} across`]], live: ['trace'] },
    rocker: { name: 'Rocker', group: 'Output', role: 'It swings back and forth between two limits while the crank turns round. At each limit the crank and coupler are in line.', specs: [['Length c', mm(u.c)], ['Frame d', mm(u.d)]], live: ['out'] },
  };
  if (id === 'peaucellier') return { ...common,
    arm: { name: 'Input arm', group: 'Input', role: 'Its pivot sits at distance r from the fixed pivot O, and it is r long, so the joint C runs on a circle through O.', specs: [['Length r', mm(u.r)]], live: ['input'] },
    long: { name: 'Long link', group: 'Links', role: 'Two equal links from O hold the rhombus. With the rhombus they make OC · OP = L² − s², an inversion in a circle.', specs: [['Length L', mm(u.L)]] },
    rhombus: { name: 'Rhombus link', group: 'Links', role: 'Four equal links make a rhombus C-A-P-B. P is the corner across from C.', specs: [['Side s', mm(u.s)]], live: ['trace'] },
    rail: { name: 'Straight line', group: 'Output', role: `A reference rail at x = (L² − s²)/(2r) = ${((u.L * u.L - u.s * u.s) / (2 * u.r)).toFixed(0)} mm. P runs along it but does not touch it.`, specs: [] },
  };
  return { ...common,
    frame: { name: 'Frame', group: 'Frame', role: 'The fixed link from the crank centre to the pivot Z. In a Strandbeest it is the spine that many legs share.', specs: [['a, l', `${u.J.a}, ${u.J.l} (×${u.k})`]] },
    crank: { name: 'Crank', group: 'Input', role: 'The wind (or a motor) turns this short crank. One turn makes one step.', specs: [['m', `${u.J.m} (×${u.k})`]], live: ['input'] },
    crankLink: { name: 'Crank link', group: 'Links', role: 'Two links from the crank pin push the upper and lower rockers.', specs: [['j, k', `${u.J.j}, ${u.J.k}`]] },
    rocker: { name: 'Rocker', group: 'Links', role: 'Two links on the fixed pivot Z. Their ends swing on arcs about Z.', specs: [['b, c', `${u.J.b}, ${u.J.c}`]] },
    frameLink: { name: 'Upper triangle', group: 'Links', role: 'With the top rocker it makes a rigid-looking triangle that pivots on Z and moves the knee.', specs: [['d, e', `${u.J.d}, ${u.J.e}`]] },
    knee: { name: 'Knee link', group: 'Links', role: 'Joins the upper triangle to the lower rocker at the knee.', specs: [['f, g', `${u.J.f}, ${u.J.g}`]] },
    foot: { name: 'Foot triangle', group: 'Output', role: 'The shin and foot link meet at the foot. Jansen found the link numbers by an evolutionary search for a flat, long stance.', specs: [['h, i', `${u.J.h}, ${u.J.i}`]], live: ['trace'] },
  };
}
