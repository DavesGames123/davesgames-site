// ============================================================================
//  ENIGMA ROTORS  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js presets
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, ROTORS, REFLECTORS } from './mech.js';

export const GROUP_COLOR = { 'Rotors': '#e9c27a', 'Stepping': '#8fb0ff', 'Current': '#e9a0a8', 'Frame': '#9aa6c0', 'Operator': '#c8a6ff' };

export function partsFor(id) {
  const u = unit(id);
  const rotor = (k, side) => {
    const n = u.rotors[k], R = ROTORS[n];
    return { name: `${side} rotor (${n})`, group: 'Rotors',
      role: k === 2 ? 'The fast rotor. Pawl 1 pushes its ratchet on every key press, so it turns one letter each time.' : k === 1 ? 'The middle rotor. It steps when the right rotor is at its notch, and again when it is at its own notch: the double step.' : 'The slow rotor. It steps only when the middle rotor is at its notch.',
      specs: [['Wiring A→', R.wiring], ['Notch', `${R.notch} (turnover on ${R.notch}→next)`], ['Ring', u.rings[k]]], live: ['pos' + 'LMR'[k]] };
  };
  return {
    rotorL: rotor(0, 'Left'), rotorM: rotor(1, 'Middle'), rotorR: rotor(2, 'Right'),
    ukw: { name: 'Reflector B', group: 'Current', role: 'It joins the 26 contacts in 13 pairs and sends the current back through the rotors. So the machine is its own inverse, and no letter can encrypt to itself.', specs: [['Pairs A→', REFLECTORS[u.reflector]]] },
    etw: { name: 'Entry wheel', group: 'Current', role: 'Fixed contacts in plain A-Z order (Enigma I). The current from the key (after the plugboard) enters here, and the return current leaves here to the lamp.', specs: [['Order', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']], live: ['path'] },
    pawl: { name: 'Pawl', group: 'Stepping', role: 'Three pawls move each time a key goes down. A pawl that rides on a notch ring cannot reach the ratchet; at the notch it drops, and pushes both the ratchet on its left and the notch ring on its right.', specs: [['Teeth', '26 per ratchet']], live: ['pawls'] },
    axle: { name: 'Rotor axle', group: 'Frame', role: 'The rotors, the reflector and the entry wheel turn on one axle. The operator lifts it out to change the rotor order.', specs: [] },
    index: { name: 'Window index', group: 'Frame', role: 'The red pointers mark the three letters in the windows of the lid: the rotor positions (Grundstellung at the start of a message).', specs: [], live: ['window'] },
    case: { name: 'Case', group: 'Frame', role: 'The frame that holds the rotor axle and the decks.', specs: [] },
    lamps: { name: 'Lamp board', group: 'Operator', role: 'Twenty-six lamps in the QWERTZ order of the keys. The current from the last rotor (through the plugboard) lights one lamp: the cipher letter.', specs: [['Plugs', u.plugs || 'none']], live: ['lamp'] },
    keys: { name: 'Keyboard', group: 'Operator', role: 'A key press first moves the pawls (the rotors step), and only then closes the circuit. So the letter is encrypted with the new rotor positions.', specs: [], live: ['key'] },
    path: { name: 'Current path', group: 'Current', role: 'Orange: in from the key through the rotors to the reflector. Blue: back out to the lamp. With the x-ray on, the wires inside each rotor show.', specs: [], live: ['path'] },
  };
}
