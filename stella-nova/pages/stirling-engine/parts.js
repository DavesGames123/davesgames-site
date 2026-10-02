// ============================================================================
//  STIRLING ENGINE  ·  parts.js — what each part is called and what it does
// ────────────────────────────────────────────────────────────────────────────
//  partsFor(E) returns PARTS[id] = { name, group, role, specs: [[k, v]],
//  live } for the engine E (engine.js). The ids match scene.js (the part's
//  info id: both main bearings share 'bearing', twin rods share 'pRod').
//  live names the live rows that cards.js fills each frame (main.js liveRows).
//
//  GREP MAP
//    export function partsFor ... the table, built from the engine numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
export const GROUP_COLOR = {
  'Hot end': '#f0a46a', 'Cold end': '#7fb8f0', 'Regenerator': '#e2c27a', 'Pistons': '#e9a0a8',
  'Crank train': '#c8a6ff', 'Frame': '#b9c0cf', 'Gas path': '#8fe0c0',
};
const mm = v => `${+v.toFixed(1)} mm`;
const cc = v => `${(v / 1000).toFixed(1)} cm³`;

export function partsFor(E) {
  const g = E.g, d = g.disp, p = g.pow, beta = E.beta;
  const P = {
    base: { name: 'Base', group: 'Frame', role: 'A walnut plinth. It carries the upright and the two main bearings, and it keeps the heat of the hot end away from the table.', specs: [['Material', 'walnut, lacquered']] },
    frame: { name: 'Upright', group: 'Frame', role: 'The enamelled back plate. The cylinders hang from it, so the crank, the rods and the cylinders stay in line while the engine runs.', specs: [['Material', 'cast iron, enamel']] },
    bracket: { name: 'Cylinder bracket', group: 'Frame', role: 'Holds the cylinder to the upright, square over the crankshaft.', specs: [] },
    bearing: { name: 'Main bearing', group: 'Crank train', role: 'A pedestal with a bronze bush. The two main bearings hold the crankshaft on its axis while the rods push it round.', specs: [['Bush', 'bronze, 10 mm bore']] },
    crank: { name: 'Crankshaft', group: 'Crank train', role: `A built-up crank with disc webs. The displacer pin is set ahead of the power pin by the phase angle, so the displacer moves the gas before the piston moves the volume. Turn the phase in the Run panel and the displacer pin turns on its webs.`, specs: [['Displacer throw', mm(d.r)], ['Power throw', mm(p.r)], ['Shaft', `Ø ${2 * g.shaft.r} mm`]], live: ['angle', 'phase', 'rpm'] },
    flywheel: { name: 'Flywheel', group: 'Crank train', role: 'Stores energy through the turn. The gas pushes the piston only in the expansion stroke; the flywheel carries the crank through compression, when the piston must push the cold gas back in.', specs: [['Diameter', `${2 * g.flywheel.R} mm`]], live: ['rpm', 'torque'] },
    dRod: { name: 'Displacer con-rod', group: 'Crank train', role: 'Joins the displacer crank pin to the displacer rod. It turns the crank\'s circle into the displacer\'s up-and-down stroke.', specs: [['Length', mm(d.l)], ['Throw', mm(d.r)], ['r / l', (d.r / d.l).toFixed(2)]], live: ['dRodAngle'] },
    pRod: { name: beta ? 'Power con-rods (twin)' : 'Power con-rod', group: 'Crank train', role: beta ? 'Two rods, one each side of the displacer link, join the power piston to the crank. The gap between them lets the displacer rod pass down the middle.' : 'Joins the power piston to its crank pin. The gas force on the piston becomes torque on the crank through this rod.', specs: [['Length', mm(p.l)], ['Throw', mm(p.r)], ['r / l', (p.r / p.l).toFixed(2)]], live: ['pRodAngle'] },
    dispRod: { name: 'Displacer rod', group: 'Pistons', role: beta ? 'Runs from the clevis under the power piston, through a bronze gland in the piston crown, to the displacer.' : 'Runs from the clevis up through a gland in the cold plate to the displacer. The gland seals the working gas from the air outside.', specs: [['Diameter', `Ø ${2 * d.rodR} mm`], ['Length', mm(d.rodLen)]], live: ['dispY'] },
    displacer: { name: 'Displacer', group: 'Pistons', role: 'A light, loose-fitting can. It does no work: it only shuttles the air. When it rises the air goes down to the cold end; when it falls the air goes up to the hot end. That changes the pressure without changing the volume.', specs: [['Diameter', `Ø ${(2 * d.dR).toFixed(1)} mm`], ['Length', mm(d.dLen)], ['Stroke', mm(2 * d.r)], ['Swept', cc(E.sweptD)]], live: ['dispY', 'gasHot'] },
    piston: { name: 'Power piston', group: 'Pistons', role: beta ? 'A close-fitting graphite piston at the cold end of the cylinder. High pressure in the hot phase pushes it down and turns the crank.' : 'A close-fitting graphite piston in its own cylinder. The cold space and this cylinder share one pressure through the transfer pipe.', specs: [['Bore', `Ø ${2 * p.bore} mm`], ['Stroke', mm(2 * p.r)], ['Swept', cc(E.sweptP)]], live: ['pistonY', 'force'] },
    dCyl: { name: 'Displacer cylinder', group: 'Gas path', role: 'A thin stainless tube. Thin walls let little heat creep from the hot cap down to the cooler.', specs: [['Bore', `Ø ${2 * d.bore} mm`], ['Wall', mm(d.wall)]], live: ['pressure'] },
    cylinder: { name: 'Cylinder', group: 'Gas path', role: 'One tube for both: the displacer runs in the upper part and the power piston in the lower part. Their strokes overlap, which a gamma engine cannot do.', specs: [['Bore', `Ø ${2 * d.bore} mm`], ['Wall', mm(d.wall)]], live: ['pressure'] },
    coldPlate: { name: 'Cold plate & gland', group: 'Cold end', role: 'Closes the bottom of the displacer cylinder and holds the brass gland that the displacer rod slides through.', specs: [] },
    cooler: { name: 'Cooler', group: 'Cold end', role: 'Aluminium fins round the cold end. They give the heat that the gas carries down from the hot end to the room.', specs: [['Fins', String(g.cooler.fins)], ['Tc', `${300} K`]], live: ['Tc', 'Qc'] },
    hotcap: { name: 'Hot cap', group: 'Hot end', role: 'Closes the top of the cylinder. Heat flows in through it to the gas in the hot space, which expands.', specs: [['Material', 'stainless steel']], live: ['Th', 'Qh'] },
    heater: { name: 'Heater band', group: 'Hot end', role: 'An electric band heater round the hot cap. Any heat source works: a flame, the sun, a cup of coffee. A Stirling engine is an external-combustion engine.', specs: [], live: ['Th', 'heatPower'] },
    regen: { name: 'Regenerator', group: 'Regenerator', role: 'A canister of fine wire screens in the path between the hot and cold spaces. Gas going down gives its heat to the screens; gas coming back up takes it again. Without it the heater would reheat the gas every turn.', specs: [['Void', cc(E.dead.regen)], ['Porosity', String(g.regen.porosity)]], live: ['Tr', 'gasRegen', 'flow'] },
    matrix: { name: 'Regenerator screens', group: 'Regenerator', role: 'Stacked discs of wire gauze. The temperature falls smoothly down the stack from Th at the top to Tc at the bottom, and it hardly changes during a turn.', specs: [], live: ['Tr', 'flow'] },
    hotPipe: { name: 'Hot pipe', group: 'Gas path', role: 'Joins the hot space under the cap to the top of the regenerator.', specs: [['Bore', `Ø ${2 * g.pipes.hot.rIn} mm`]], live: ['flow'] },
    coldPipe: { name: 'Cold pipe', group: 'Gas path', role: 'Joins the bottom of the regenerator to the cold space by the cooler.', specs: [['Bore', `Ø ${2 * g.pipes.cold.rIn} mm`]], live: ['flow'] },
    transferPipe: { name: 'Transfer pipe', group: 'Gas path', role: 'Joins the cold space of the displacer cylinder to the power cylinder, so both share one pressure. Its volume is dead volume: it adds gas that never gets hot.', specs: [['Volume', cc(E.dead.transfer || 0)]], live: ['pressure'] },
    pCyl: { name: 'Power cylinder', group: 'Cold end', role: 'The finned cylinder that the power piston runs in. It sits on the cold side of the engine.', specs: [['Bore', `Ø ${2 * p.bore} mm`]], live: ['pressure'] },
    pHead: { name: 'Power head', group: 'Cold end', role: 'Closes the power cylinder. The transfer pipe brings the gas in at its centre.', specs: [] },
  };
  return P;
}
