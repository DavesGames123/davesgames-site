// ============================================================================
//  LOCKSTITCH SEWING MACHINE  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  PARTS[info] = { name, group, role, specs, live }. The keys match the info
//  ids of scene.js. live names the rows that cards.js fills each frame
//  through main.js liveValue().
//
//  GREP MAP
//    export const PARTS ......... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { M, thC, thCast, DEG } from './mech.js';

export const GROUP_COLOR = { 'Drive': '#e9c27a', 'Needle': '#8fb0ff', 'Thread': '#e9a0a8', 'Hook': '#c8a6ff', 'Feed': '#9fd6b0', 'Frame': '#9aa6c0' };
const mm = v => `${v} mm`;

export const PARTS = {
  base: { name: 'Cast iron frame', group: 'Frame', role: 'The bed, the arm and the pillar. Here the front is cut away so that the shafts, the hook and the feed show.', specs: [] },
  plate: { name: 'Needle plate', group: 'Frame', role: 'A steel plate with a hole for the needle and two slots for the feed dog teeth. Its top is the zero of every height on this page.', specs: [['Needle hole', 'ø 2.8 mm']] },
  shaft: { name: 'Main shaft', group: 'Drive', role: 'One turn of this shaft is one stitch. The needle crank is on its head end; a toothed pulley drives the lower shaft at the same speed.', specs: [], live: ['shaft'] },
  wheel: { name: 'Handwheel', group: 'Drive', role: 'Turn it by hand to step through a stitch. Its top always turns toward the operator.', specs: [], live: ['shaft'] },
  crank: { name: 'Needle bar crank', group: 'Needle', role: 'A disc on the shaft end with a crank pin. The pin drives the needle bar link and carries the take-up lever.', specs: [['Crank radius a', mm(M.a)]], live: ['shaft'] },
  link: { name: 'Needle bar link', group: 'Needle', role: 'The connecting rod of a crank-slider. The needle bar is the slider: it moves 2a, 32 mm, for each turn.', specs: [['Length l', mm(M.l)]] },
  needlebar: { name: 'Needle bar', group: 'Needle', role: 'It slides in two bushings in the head. The needle clamp is at its lower end; a small guide above the clamp leads the thread to the eye.', specs: [['Stroke', mm(2 * M.a)]], live: ['needle'] },
  needle: { name: 'Needle', group: 'Needle', role: 'The eye is near the point. A long groove on the front protects the thread on the way down; a scarf on the hook side lets the beak come close.', specs: [['Eye above point', mm(M.EYE)], ['Point at top', '+20 mm'], ['Point at bottom', '−12 mm']], live: ['needle'] },
  takeup: { name: 'Take-up lever', group: 'Thread', role: 'A four-bar coupler on the crank pin. It gives thread while the hook spreads the loop round the bobbin case, then pulls the loop up and sets the stitch.', specs: [['b, c', `${M.TU.b}, ${M.TU.c} mm`], ['Eye u, v', `${M.TU.u}, ${M.TU.v} mm`]], live: ['takeup'] },
  tulink: { name: 'Take-up link', group: 'Thread', role: 'It joins the tail of the take-up lever to a fixed stud, so the lever rocks as well as moves with the crank pin.', specs: [['Length c', mm(M.TU.c)]] },
  tension: { name: 'Tension discs', group: 'Thread', role: 'Two discs pressed by a spring. The thread slips between them only when the take-up lever pulls hard, so each stitch gets the same tension.', specs: [] },
  spool: { name: 'Spool', group: 'Thread', role: 'The needle thread comes off the top of the spool, over a guide on the arm, to the tension discs.', specs: [] },
  presser: { name: 'Presser foot', group: 'Feed', role: 'A spring presses it on the cloth. The feed dog grips the cloth from below against it.', specs: [] },
  belt: { name: 'Timing belt', group: 'Drive', role: 'A toothed belt with two equal pulleys: the lower shaft turns once for each turn of the main shaft, and keeps its phase.', specs: [['Ratio', '1 : 1']] },
  lower: { name: 'Lower shaft', group: 'Drive', role: 'It carries the two feed eccentrics and a 32-tooth gear that drives the 16-tooth hook gear.', specs: [['Gear pair', '32 : 16']], live: ['shaft'] },
  hook: { name: 'Rotary hook', group: 'Hook', role: `It turns twice for each stitch. Its beak passes the needle when the needle has risen ${M.RISE} mm from the bottom, takes the loop and carries it round the bobbin case. The second turn is idle.`, specs: [['Beak radius', mm(M.RH)], ['Catch', `${(thC * DEG).toFixed(0)}° of the shaft`], ['Loop off', `${((thCast * DEG) % 360).toFixed(0)}°`]], live: ['hook'] },
  bobbin: { name: 'Bobbin case', group: 'Hook', role: 'It holds the bobbin and does not turn: a finger (not drawn) keeps it still while the hook turns round it. The needle thread loop passes all the way round it, so the two threads lock.', specs: [['Radius', mm(M.RB)]] },
  feeddog: { name: 'Feed dog', group: 'Feed', role: 'Four motions each stitch: up through the plate, back with the cloth, down, and forward under the plate. It only moves the cloth while the needle is out.', specs: [['Rise', `${(M.LIFT - M.DROP).toFixed(2)} mm`]], live: ['feed'] },
  eccentric: { name: 'Feed eccentric', group: 'Feed', role: 'Two eccentrics on the lower shaft: one lifts the feed bar, one pushes it to and fro. The stitch regulator sets how much of the push reaches the dog, and its sign for reverse.', specs: [['Lift', mm(M.LIFT)]], live: ['feed'] },
  cloth: { name: 'Cloth', group: 'Feed', role: 'Each stitch locks the needle thread (red) and the bobbin thread (blue) in the middle of the cloth.', specs: [['Thickness', mm(M.FABRIC)]], live: ['feed'] },
};
