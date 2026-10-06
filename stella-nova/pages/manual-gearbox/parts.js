// ============================================================================
//  MANUAL GEARBOX  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor() returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the box.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { SPEC, ratio, CD, M } from './box.js';

export const GROUP_COLOR = { 'Input': '#e9c27a', 'Gears': '#8fb0ff', 'Synchro': '#f0a46a', 'Selector': '#8fe0c0', 'Output': '#e9a0a8', 'Case': '#9aa6c0' };

export function partsFor() {
  const gear = g => ({ name: `${g}${['', 'st', 'nd', 'rd', 'th', 'th'][g]} gear`, group: 'Gears', role: `Free on the main shaft on a needle bearing, and always in mesh with its layshaft gear, so it always turns. It drives the car only when its sleeve locks it to the main shaft.`, specs: [['Teeth', `${SPEC.pairs[g].main} : ${SPEC.pairs[g].lay}`], ['Overall ratio', ratio(g).toFixed(3)]], live: ['g' + g] });
  return {
    case: { name: 'Gearbox case', group: 'Case', role: 'Cast aluminium or iron. It holds the shaft bearings at the exact centre distance and keeps the oil in. It is cut away here at the shaft line.', specs: [['Centre distance', `${CD} mm`]] },
    inShaft: { name: 'Input shaft', group: 'Input', role: 'Splined to the clutch disc, so it turns at engine speed when the clutch is in. Its gear drives the layshaft all the time.', specs: [['Input gear', `${SPEC.input.N} teeth`]], live: ['win'] },
    lay: { name: 'Layshaft cluster', group: 'Gears', role: 'One piece with five gears. It turns slower than the input, at 24/36 of its speed, and turns every free gear on the main shaft.', specs: [['Teeth', `${SPEC.layIn.N}, ${Object.values(SPEC.pairs).map(p => p.lay).join(', ')}`]], live: ['wlay'] },
    mainShaft: { name: 'Main shaft', group: 'Output', role: 'The output shaft to the propeller shaft. Its nose runs in a bearing inside the input shaft, so the two shafts line up but turn freely.', specs: [['Module', `${M} mm`]], live: ['wout', 'gear'] },
    gear1: gear(1), gear2: gear(2), gear3: gear(3), gear5: gear(5),
    hub: { name: 'Synchro hub', group: 'Synchro', role: 'Splined to the main shaft. Its outer splines carry the sleeve, so the sleeve always turns with the main shaft but can slide.', specs: [] },
    sleeve: { name: 'Synchro sleeve', group: 'Synchro', role: 'Slides to one side. First its blocker ring presses a brass cone onto the gear\'s cone; the friction brings the two speeds together. Then the sleeve teeth pass over the dog teeth and lock the gear.', specs: [['Travel', `${SPEC.travel} mm each way`]], live: ['gear'] },
    fork: { name: 'Selector fork', group: 'Selector', role: 'Sits in the sleeve groove and pushes it along the shaft. Each fork is fixed to its rail.', specs: [] },
    rail: { name: 'Selector rail', group: 'Selector', role: 'The lever picks one rail (across the gate) and slides it (along the gate). Interlocks stop two rails moving at once.', specs: [['Rails', '3: 1–2, 3–4, 5']] },
    lever: { name: 'Gear lever', group: 'Selector', role: 'A lever on a ball pivot. Left and right picks a rail; forward and back slides it. That is the H pattern.', specs: [['Pattern', '1 2 / 3 4 / 5']], live: ['gear'] },
  };
}
