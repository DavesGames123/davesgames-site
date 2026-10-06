// ============================================================================
//  STEAM LOCOMOTIVE  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor() returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { G } from './mech.js';

export const GROUP_COLOR = { 'Running gear': '#e9c27a', 'Valve gear': '#8fb0ff', 'Cylinder': '#e9a0a8', 'Reverser': '#8fe0c0', 'Frame': '#9aa6c0' };

export function partsFor() {
  const mm = v => `${Math.round(v)} mm`;
  return {
    wheel: { name: 'Driving wheel', group: 'Running gear', role: 'Three coupled wheels of 1880 mm. The main rod drives the middle one; the coupling rods share the push with the other two. The balance weight sits opposite the crank pin.', specs: [['Diameter', mm(2 * G.WHEEL_R)], ['Crank radius', mm(G.r)]], live: ['wheel'] },
    coupling: { name: 'Coupling rods', group: 'Running gear', role: 'All three crank pins are at the same angle, so the coupling rods move as a parallelogram: they go round without turning.', specs: [['Axle pitch', mm(G.PITCH)]] },
    mainrod: { name: 'Main rod', group: 'Running gear', role: 'The connecting rod from the crosshead to the main crank pin. It turns the push and pull of the piston into the turn of the wheel.', specs: [['Length', mm(G.L)], ['L / r', (G.L / G.r).toFixed(1)]], live: ['piston'] },
    crosshead: { name: 'Crosshead', group: 'Cylinder', role: 'Slides between the slide bars and takes the side thrust of the main rod, so the piston rod only pushes straight. Its drop arm drives the union link.', specs: [['Stroke', mm(G.STROKE)]], live: ['piston'] },
    piston: { name: 'Piston', group: 'Cylinder', role: 'Steam pushes it one way, then the other: a double-acting cylinder. Each end gets steam once a turn.', specs: [['Bore', mm(G.BORE)], ['Stroke', mm(G.STROKE)]], live: ['press'] },
    cylinder: { name: 'Cylinder', group: 'Cylinder', role: 'Cut open here so the piston shows. The colour of each end shows its steam pressure: bright when full of boiler steam, dark when open to the exhaust.', specs: [['Clearance', `${G.CLEAR * 100} % of stroke`]], live: ['press'] },
    chest: { name: 'Steam chest', group: 'Cylinder', role: 'Holds the piston valve. Live steam fills the space between the two valve heads; the exhaust leaves from the ends. Two ports lead to the two ends of the cylinder.', specs: [['Port width', mm(G.PORT)]], live: ['valve'] },
    ports: { name: 'Steam ports', group: 'Cylinder', role: 'The passages from the valve to each end of the cylinder. Warm when open to steam, blue when open to the exhaust, dark when the valve covers them.', specs: [['Width', mm(G.PORT)]], live: ['valve'] },
    steam: { name: 'Steam', group: 'Cylinder', role: 'The colour is the pressure of the ideal indicator diagram: boiler pressure while the port is open, falling as the steam expands after cut-off.', specs: [], live: ['press'] },
    valve: { name: 'Piston valve', group: 'Valve gear', role: `Inside admission: steam enters between the heads. Each head overlaps its port by the lap (${G.LAP} mm) when the valve is central, so the valve must move more than the lap before steam enters.`, specs: [['Steam lap', mm(G.LAP)], ['Exhaust lap', mm(G.EXL)]], live: ['valve', 'cut'] },
    retcrank: { name: 'Return crank', group: 'Valve gear', role: 'Fixed on the main crank pin and set at about a right angle to it. It gives the valve gear a motion a quarter turn ahead of the piston.', specs: [['Throw', mm(G.e)], ['Angle to crank', `${(G.DELTA * 180 / Math.PI).toFixed(1)}°`]] },
    eccrod: { name: 'Eccentric rod', group: 'Valve gear', role: 'Rocks the expansion link about its trunnion.', specs: [['Length', mm(G.Le)]] },
    link: { name: 'Expansion link', group: 'Valve gear', role: 'A curved slotted link that rocks on a fixed trunnion. Its curve has the radius of the radius rod, so moving the die along it at dead centre does not move the valve: the lead stays the same at every cut-off.', specs: [['Slot radius', mm(G.Rr)], ['Foot below trunnion', mm(G.a)]], live: ['cut'] },
    die: { name: 'Die block', group: 'Valve gear', role: 'Slides in the link slot. Below the trunnion it drives the valve for forward running, above it for reverse; at the trunnion (mid gear) the link adds nothing.', specs: [['Full gear', `±${G.S_MAX} mm from the trunnion`]], live: ['cut'] },
    radius: { name: 'Radius rod', group: 'Valve gear', role: 'Carries the link motion forward to the top of the combination lever.', specs: [['Length', mm(G.Rr)]] },
    lever: { name: 'Combination lever', group: 'Valve gear', role: 'Adds two motions: the link motion at its top and the crosshead motion at its bottom. The crosshead part gives the lap and lead; the link part sets the cut-off and the direction.', specs: [['Ratio', `${G.cv} : ${G.cu}`]], live: ['valve'] },
    union: { name: 'Union link', group: 'Valve gear', role: 'Joins the bottom of the combination lever to the drop arm of the crosshead.', specs: [['Length', mm(G.Lu)]] },
    weigh: { name: 'Weigh shaft', group: 'Reverser', role: 'A cross shaft with arms. The driver turns it from the cab with the reach rod, and its lifting arm raises or lowers the radius rod and the die in the link.', specs: [['Lifting arm', mm(G.LA)]], live: ['cut'] },
    lifting: { name: 'Lifting link', group: 'Reverser', role: 'Hangs the radius rod from the lifting arm, so the die stays at the set place in the slot.', specs: [['Length', mm(G.LL)]] },
    reach: { name: 'Reach rod', group: 'Reverser', role: 'Runs back to the reverser in the cab. A screw there sets the cut-off: the driver "notches up" from full gear to a short cut-off as the train gains speed.', specs: [], live: ['cut'] },
    frame: { name: 'Frames', group: 'Frame', role: 'Steel plate frames carry the axleboxes, the cylinders, the slide bars and the valve gear brackets.', specs: [] },
    body: { name: 'Boiler and cab', group: 'Frame', role: 'The boiler makes the steam; the smokebox at the front holds the blast pipe that the exhaust goes up, which draws the fire.', specs: [] },
    track: { name: 'Track', group: 'Frame', role: 'Standard gauge, 1435 mm. The sleepers move back under the engine as it runs.', specs: [] },
  };
}
