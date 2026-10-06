// ============================================================================
//  GEAR TYPES  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, derive, D2R } from './mech.js';

export const GROUP_COLOR = { 'Driver': '#e9c27a', 'Driven': '#e9a0a8', 'Frame': '#9aa6c0', 'Drawing': '#8fb0ff', 'Forces': '#ff8a70' };

export function partsFor(id) {
  const u = unit(id), D = derive(u), f1 = v => v.toFixed(1), deg = v => `${(v / D2R).toFixed(2)}°`, N = v => `${v.toFixed(0)} N`;
  const common = {
    base: { name: 'Base plate', group: 'Frame', role: 'The fixed frame. It holds the shafts at their centre distance; an error there changes the backlash, not the ratio, because involute teeth keep a constant ratio at any centre distance.', specs: [] },
    block: { name: 'Bearing block', group: 'Frame', role: 'Carries one shaft. With helical, bevel and worm gears it also takes the axial thrust, so real blocks hold a thrust bearing.', specs: [['Bore', '17 mm']] },
    loa: { name: 'Line of action', group: 'Drawing', role: 'Involute teeth always touch on this one line, tangent to both base circles (blue). The push between the teeth acts along it, at the pressure angle to the pitch-line tangent. The red dots are the contacts now; the thick gold part is the length of action.', specs: [['Pressure angle', deg(D.at)], ['Base pitch', `${f1(D.pb)} mm`], ['Length of action', `${f1(D.sMax - D.sMin)} mm`]], live: ['pairs'] },
  };
  if (id === 'spur' || id === 'helical') {
    const hel = id === 'helical';
    return { ...common,
      pinion: { name: hel ? 'Helical pinion' : 'Spur pinion', group: 'Driver', role: hel ? 'Teeth cut on a helix of 20°. A tooth comes into mesh gradually from one face to the other, so the load passes smoothly and the pair runs quietly. Right-hand helix.' : 'Straight teeth, parallel to the shaft. A whole tooth width comes into mesh at once, so the load on a tooth starts and ends in a step: the usual noise of a spur gear.', specs: [['Teeth', String(u.N1)], ['Module', hel ? `${u.m} normal, ${f1(D.mt)} transverse` : `${u.m} mm`], ['Pitch radius', `${f1(D.r1)} mm`], ['Face width', `${D.b + 2} mm`]], live: ['in'] },
      gear: { name: hel ? 'Helical gear' : 'Spur gear', group: 'Driven', role: hel ? 'Left-hand helix: parallel helical gears have opposite hands. The axial thrust pushes it one way along its shaft and the pinion the other way.' : `${u.N2} teeth on ${u.N1}: the gear turns ${u.N1}/${u.N2} as fast, the other way.`, specs: [['Teeth', String(u.N2)], ['Pitch radius', `${f1(D.r2)} mm`], ['Ratio', `${(u.N2 / u.N1).toFixed(3)} : 1`]], live: ['out'] },
      forces: { name: 'Tooth forces', group: 'Forces', role: hel ? `At 20 N·m on the pinion: the tangential force Ft (gold) turns the gear, the radial force Fr (blue) pushes the shafts apart, and the helix adds the axial thrust Fa = Ft tan β (red, on the shaft ends).` : 'At 20 N·m on the pinion: the tangential force Ft (gold) turns the gear and the radial force Fr = Ft tan α (blue) pushes the shafts apart. Straight teeth make no axial thrust.', specs: [['Ft', N(D.Ft)], ['Fr', N(D.Fr)], ['Fa', hel ? N(D.Fa) : '0 N']] },
    };
  }
  if (id === 'bevel') return { ...common,
    pinion: { name: 'Bevel pinion', group: 'Driver', role: 'Straight teeth on a cone. Every tooth line runs to the apex that the two pitch cones share, so the teeth roll on each other like two cones in contact.', specs: [['Teeth', String(u.N1)], ['Pitch cone', deg(D.g1)], ['Heel radius', `${f1(D.R1)} mm`]], live: ['in'] },
    gear: { name: 'Bevel gear', group: 'Driven', role: 'Turns the drive through 90°. tan γ₁ = N₁/N₂ for a right-angle pair, so the cone angles set the ratio.', specs: [['Teeth', String(u.N2)], ['Pitch cone', deg(D.g2)], ['Cone distance', `${f1(D.A)} mm`]], live: ['out'] },
    cones: { name: 'Pitch cones', group: 'Drawing', role: 'Two cones with one apex that roll on each other without slip. The teeth are cut on them. In the transverse section each gear acts like a spur gear of N/cos γ teeth (Tredgold\'s virtual gear).', specs: [['Virtual teeth', `${D.Nv1.toFixed(1)} / ${D.Nv2.toFixed(1)}`], ['Contact ratio', D.epsA.toFixed(2)]] },
    forces: { name: 'Axial thrust', group: 'Forces', role: 'The tooth push has a part along each shaft. It always pushes a bevel gear away from the apex, out of mesh, so both shafts need thrust bearings.', specs: [['Ft (mean)', N(D.Ft)], ['Fa pinion', N(D.Fa1)], ['Fa gear', N(D.Fa2)]] },
  };
  if (id === 'worm') return { ...common,
    worm: { name: 'Worm', group: 'Driver', role: `A screw with ${u.z1} start. Each turn moves the thread one lead along its axis and turns the wheel by ${u.z1} tooth. Its lead angle is small, so the thread slides hard on the wheel teeth.`, specs: [['Starts', String(u.z1)], ['Pitch radius', `${f1(D.r1)} mm`], ['Lead', `${f1(D.L)} mm`], ['Lead angle λ', deg(D.lambda)]], live: ['in'] },
    wheel: { name: 'Worm wheel', group: 'Driven', role: `${u.N2} teeth cut at the lead angle, usually in bronze to slide well on the steel worm. Back-driving: the wheel cannot turn the worm, because λ is less than the friction angle.`, specs: [['Teeth', String(u.N2)], ['Ratio', `${D.ratio} : 1`], ['Friction μ', String(u.mu)], ['Friction angle', deg(D.phiF)]], live: ['out', 'lock'] },
  };
  return { ...common,
    pinion: { name: 'Pinion', group: 'Driver', role: 'Turns to and fro like a steering pinion. Each radian it turns moves the rack by one pitch radius.', specs: [['Teeth', String(u.N1)], ['Pitch radius r', `${f1(D.r1)} mm`]], live: ['in'] },
    rack: { name: 'Rack', group: 'Driven', role: 'A gear of infinite radius: its involute flanks are straight lines at the pressure angle. It moves at v = ω r.', specs: [['Pitch', `${f1(D.p)} mm`], ['Flank angle', deg(D.at)]], live: ['v'] },
    guide: { name: 'Rack guide', group: 'Frame', role: 'Holds the rack against the separating force Fr = Ft tan α, which tries to push it away from the pinion.', specs: [] },
    vel: { name: 'Rack speed', group: 'Forces', role: 'Its length shows the rack speed now: v = ω r, zero at each end of the swing.', specs: [], live: ['v'] },
  };
}
