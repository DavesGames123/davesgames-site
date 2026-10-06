// ============================================================================
//  RADIAL ENGINE  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, makeEngine, survey } from './mech.js';

export const GROUP_COLOR = { 'Crank train': '#e9c27a', 'Cylinders': '#8fb0ff', 'Valve train': '#c8a6ff', 'Frame': '#9aa6c0', 'Combustion': '#ff9a6a' };

export function partsFor(id) {
  const u = unit(id), E = makeEngine(u), S = survey(E), mm = v => `${v.toFixed(1)} mm`;
  const links = S.slice(1), lo = Math.min(...links.map(q => q.stroke)), hi = Math.max(...links.map(q => q.stroke));
  return {
    base: { name: 'Stand', group: 'Frame', role: 'A display stand on the rear mount. In an aircraft, a welded tube mount holds the engine by the same rear face.', specs: [] },
    case: { name: 'Crankcase', group: 'Frame', role: `One flat pad for each of the ${u.n} cylinders. The front section is off, so you can see the crank, the rods and the cam ring.`, specs: [['Cylinders', `${u.n}, one row`]] },
    cyl: { name: 'Cylinder barrel', group: 'Cylinders', role: 'Air-cooled: thin fins carry the heat into the slipstream. A window is cut in the front of each barrel to show the piston.', specs: [['Bore', mm(u.bore)], ['Swept volume', `${(S.reduce((a, q) => a + q.swept, 0) / 1e6).toFixed(2)} L, all cylinders`]] },
    head: { name: 'Cylinder head', group: 'Cylinders', role: 'The roof of the combustion chamber, with two spark plugs and the rocker brackets. Every head sits at the same radius, so the ratio changes with the piston, not the head.', specs: [['Roof radius', mm(E.H)]] },
    piston: { name: 'Piston', group: 'Cylinders', role: 'Each piston runs on its own cylinder axis. Only piston 1 has a true crank motion; the others follow the knuckle pins.', specs: [['Stroke 1', mm(S[0].stroke)], ['Strokes 2…' + u.n, `${lo.toFixed(2)}–${hi.toFixed(2)} mm`]], live: ['piston'] },
    flame: { name: 'Burning charge', group: 'Combustion', role: 'It glows from just before top dead centre to 60° after. With an odd number of cylinders, every other cylinder fires, so the firing comes round the engine twice in two turns.', specs: [['Order', E.order.join('-')]], live: ['fire'] },
    master: { name: 'Master rod', group: 'Crank train', role: `The only rod on the crank pin. Its big end carries ${u.n - 1} knuckle pins, one for each link rod. It rocks as the crank turns, and that rocking moves the knuckle pins off a true circle.`, specs: [['Length L', mm(u.L)], ['Knuckle radius ρ', mm(u.rho)]], live: ['master'] },
    link: { name: 'Link rod', group: 'Crank train', role: 'An articulated rod from a knuckle pin to a piston. It is shorter than the master rod by the knuckle radius, so the pistons reach nearly the same top.', specs: [['Length l', mm(u.l)], ['TDC shift', `up to ${(Math.max(...links.map(q => Math.abs(q.shift))) * 180 / Math.PI).toFixed(2)}°`]] },
    crank: { name: 'Crankshaft', group: 'Crank train', role: 'A single throw for all the cylinders. The big counterweight balances the crank pin and much of the rods.', specs: [['Throw r', mm(u.r)]], live: ['crank'] },
    cam: { name: 'Cam ring', group: 'Valve train', role: `${E.N} lobes on each track. It turns at 1/${2 * E.N} of crank speed, against the crank, so the next lobe meets the next cylinder in the firing order.`, specs: [['Lobes', `${E.N} inlet, ${E.N} exhaust`], ['Speed', `−1/${2 * E.N} × crank`]], live: ['cam'] },
    tappet: { name: 'Tappet', group: 'Valve train', role: 'A roller rides on its cam track and lifts when a lobe passes.', specs: [['Lift', mm(u.lift)]] },
    pushrod: { name: 'Pushrod', group: 'Valve train', role: 'It carries the tappet lift out to the rocker on the head.', specs: [] },
    rocker: { name: 'Rocker arm', group: 'Valve train', role: 'It turns the push of the pushrod into a push on the valve stem in the head.', specs: [] },
  };
}
