// ============================================================================
//  PUMPS  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, gearDims, dims, displacement, D } from './mech.js';

export const GROUP_COLOR = { 'Input': '#e9c27a', 'Rotors': '#8fb0ff', 'Fluid': '#e2a63a', 'Ports': '#8fe0c0', 'Frame': '#9aa6c0' };

export function partsFor(id) {
  const u = unit(id), d = dims(u), mm = v => `${v.toFixed(1)} mm`, cc = `${(displacement(u) / 1000).toFixed(2)} cm³`;
  const common = {
    base: { name: 'Back plate', group: 'Frame', role: 'The rear wall of the pumping space and the stand. The rotor faces run 0.3 mm off it: that end clearance, with the tip clearance, sets most of the leakage of a real pump.', specs: [] },
    shaft: { name: 'Drive shaft', group: 'Input', role: 'A motor turns the shaft at a steady speed. The flow follows the speed: each turn moves the displacement V from the inlet to the outlet.', specs: [['Displacement V', cc]], live: ['rpm', 'th'] },
    pocket: { name: 'Fluid pocket', group: 'Fluid', role: 'The fluid that the rotors carry. Blue pockets are open to the inlet, amber pockets are sealed on all sides, red pockets are open to the outlet. A positive-displacement pump moves fixed pockets like these, so the flow does not depend on the outlet pressure.', specs: [], live: ['pockets'] },
    inlet: { name: 'Inlet', group: 'Ports', role: 'The low-pressure side, at the bottom. The pockets open here as the rotors turn, and the fluid fills them.', specs: [], live: ['flow'] },
    outlet: { name: 'Outlet', group: 'Ports', role: 'The high-pressure side, at the top. The pockets close here and push their fluid out. The flow has a ripple at the pocket frequency.', specs: [], live: ['flow', 'ripple'] },
  };
  if (id === 'gear') {
    const G = gearDims(u);
    return { ...common,
      casing: { name: 'Casing', group: 'Frame', role: 'A body with two bores that fit the tooth tips with 0.3 mm to spare. The fluid can pass a gear only in the tooth spaces, along the bore wall, from the inlet to the outlet.', specs: [['Bore', mm(2 * G.Rc)], ['Port width', mm(2 * u.port)]] },
      driveGear: { name: 'Drive gear', group: 'Rotors', role: 'The shaft turns this gear, and it turns the idler. Where the teeth mesh, a tooth fills a space, so the fluid cannot go back to the inlet. The contact point runs along the line of action.', specs: [['Teeth', String(u.Z)], ['Module', `${u.m} mm`], ['Pressure angle', `${(u.alpha / D).toFixed(0)}°`], ['Tip radius', mm(G.Ra)]], live: ['contact'] },
      idlerGear: { name: 'Idler gear', group: 'Rotors', role: 'It turns the other way at the same speed. The pockets on the outer side of both gears carry fluid round to the outlet.', specs: [['Face width', mm(u.b)], ['Backlash', `${u.j} mm`]] },
    };
  }
  if (id === 'vane') {
    return { ...common,
      ring: { name: 'Cam ring', group: 'Frame', role: `A bore ${u.e} mm off the rotor centre. The vanes follow it, so each chamber grows on the inlet side and shrinks on the outlet side. Move the ring to the centre and the flow stops: that is how a variable vane pump works.`, specs: [['Bore', mm(2 * u.R)], ['Offset e', mm(u.e)]] },
      rotor: { name: 'Rotor', group: 'Rotors', role: `A disc with ${u.n} radial slots, turned by the shaft. At the bottom of the ring it runs only ${(u.R - u.e - u.r).toFixed(1)} mm from the bore, which seals the outlet from the inlet.`, specs: [['Diameter', mm(2 * u.r)], ['Slots', String(u.n)]], live: ['th'] },
      vane: { name: 'Vane', group: 'Rotors', role: 'A flat blade that slides in its slot. The turn throws it out against the ring; real pumps also put outlet pressure under the vane. Each pair of vanes closes one chamber.', specs: [['Thickness', mm(u.t)], ['Length', mm(u.vaneL)]], live: ['reach'] },
      block: { name: 'Port manifold', group: 'Ports', role: 'Two kidney ports in the back plate lead into this block. The lands between the kidneys are wider than one vane pitch, so no chamber opens to both sides.', specs: [['Land', `${(2 * u.p0 / D).toFixed(0)}°`], ['Vane pitch', `${(360 / u.n).toFixed(0)}°`]] },
    };
  }
  return { ...common,
    casing: { name: 'Casing', group: 'Frame', role: 'Two bores that fit the lobe tips. Each half turn a rotor traps a pocket against the bore wall and carries it from the inlet to the outlet.', specs: [['Bore', mm(2 * d.Rc)], ['Port width', mm(2 * u.port)]] },
    rotorA: { name: 'Drive rotor', group: 'Rotors', role: 'A two-lobe rotor: each lobe is an epicycloid, each waist a hypocycloid of one rolling circle. The rotors do not drive each other: timing gears behind the back plate keep them in step, so the lobes never touch in a real blower.', specs: [['Pitch radius', mm(u.r)], ['Rolling circle', mm(u.a)], ['Tip radius', mm(d.Ra)]], live: ['contact'] },
    rotorB: { name: 'Driven rotor', group: 'Rotors', role: 'It turns the other way at the same speed. Air does not get compressed inside a Roots blower: the pocket opens to the outlet at inlet pressure and the outlet gas flows back into it.', specs: [['Width', mm(u.b)]] },
  };
}
