// ============================================================================
//  BALL SCREW & LEAD SCREW  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id, L) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, screw, effLead, effBall, MU_SLIDE, MU_ROLL, DEG } from './mech.js';

export const GROUP_COLOR = {
  'Drive': '#e9c27a', 'Screw': '#8fb0ff', 'Nut': '#f0a46a', 'Load': '#8fe0c0', 'Frame': '#9aa6c0',
};
const pct = x => `${(x * 100).toFixed(1)}%`;

export function partsFor(id, L, mu = MU_SLIDE) {
  const u = unit(id), g = screw(u, L ?? u.L), ball = g.type === 'ball';
  const E = ball ? effBall(g.lam) : effLead(g.lam, mu);
  const P = {
    base: { name: 'Base plate', group: 'Frame', role: 'A painted steel plate that holds the motor, the two end plates and the travel scale in line.', specs: [] },
    motor: { name: 'Stepper motor', group: 'Drive', role: 'Turns the screw through the coupling. It reverses at each end of the stroke. When a load pushes the nut it must hold or brake the screw, unless the screw is self-locking.', specs: [['Frame', 'NEMA 23']], live: ['rpm', 'torque'] },
    coupling: { name: 'Jaw coupling', group: 'Drive', role: 'Two aluminium hubs and a red elastomer spider. It takes up a small misalignment between the motor shaft and the screw. The red key shows the turns.', specs: [['Bores', '8 mm and 12 mm']], live: ['turns'] },
    endplate: { name: 'End plate', group: 'Frame', role: 'The fixed end holds the screw in a pair of angular-contact bearings, so it takes the thrust both ways. The support end holds the other journal in a plain bearing that lets the screw grow with heat.', specs: [['Bore', '12 mm']] },
    rails: { name: 'Guide rods', group: 'Frame', role: 'Two ground rods that stop the carriage turning. The nut must not turn, or the screw would only spin it and it would not move.', specs: [['Diameter', '12 mm'], ['Spacing', '96 mm']] },
    screw: { name: ball ? 'Ball screw shaft' : (g.n > 1 ? `${g.n}-start ACME screw` : 'ACME lead screw'), group: 'Screw', role: ball
      ? 'A ground shaft with a round groove. The balls roll in it, so the contact has almost no sliding.'
      : `A rolled thread with 29° flanks. The nut slides on the flanks, so the friction sets the efficiency.${g.n > 1 ? ` ${g.n} starts give a lead of ${g.L} mm at a pitch of ${g.p} mm.` : ''}`,
      specs: [['Diameter', `${g.d} mm`], ['Lead L', `${g.L} mm`], ['Pitch', `${g.p} mm`], ['Starts', String(g.n)], ['Lead angle λ', `${(g.lam / DEG).toFixed(2)}°`]], live: ['turns', 'theta'] },
    nut: { name: ball ? 'Ball nut' : 'Bronze nut', group: 'Nut', role: ball
      ? `A steel nut with the mirror groove. ${g.n > 1 ? `${g.n} circuits` : 'One circuit'} of balls carry the load. Rolling friction is about μ = ${MU_ROLL}, so it drives at ${pct(E.fwd)} and a thrust turns the screw back at ${pct(E.back)}.`
      : `A bronze nut that slides on the steel thread at μ = ${mu.toFixed(2)}. It drives at ${pct(E.fwd)}. ${E.back > 0 ? `A thrust turns the screw back at ${pct(E.back)}.` : 'A thrust cannot turn the screw: it is self-locking.'}`,
      specs: [['Length', '50 mm'], ['Drive η', pct(E.fwd)], ['Back-drive η′', E.back > 0 ? pct(E.back) : 'locks']], live: ['x', 'v'] },
    carriage: { name: 'Carriage', group: 'Load', role: 'Bolted to the nut flange. It slides on the guide rods and carries the load. Its pointer reads the travel on the scale: lead × turns.', specs: [['Stroke', '150 mm']], live: ['x'] },
    load: { name: 'Load F', group: 'Load', role: 'The axial force on the carriage. When the motor drives, the load resists the motion. When the load drives, it pushes the nut and tries to turn the screw.', specs: [], live: ['F', 'torque'] },
  };
  if (ball) {
    P.balls = { name: 'Balls', group: 'Nut', role: 'Steel balls between the screw groove and the nut groove. They roll, and their centres turn at about half the screw speed, so they move along the nut and must come back.', specs: [['Diameter', `${g.Db.toFixed(3)} mm`], ['Contact angle', '45°']], live: ['ballRate'] };
    P.tube = { name: 'Return tube', group: 'Nut', role: `It picks the balls up at the end of the circuit and puts them back at the start. Each circuit has ${g.Nt.toFixed(2)} turns of groove.`, specs: [['Circuits', String(g.n)]] };
  }
  return P;
}
