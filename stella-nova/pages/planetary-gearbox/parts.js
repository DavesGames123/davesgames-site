// ============================================================================
//  PLANETARY GEARBOX  ·  parts.js — what each part is called and what it does
// ────────────────────────────────────────────────────────────────────────────
//  partsFor(L) returns PARTS[info] = { name, group, role, specs: [[k, v]],
//  live } for the layout L (layout.js). The keys match the layout's info
//  ids (all planets of a set share one card). live names the live rows that
//  cards.js fills each frame (main.js liveValue):
//    w:<member> .... speed of that member      role:<member> . input / held / output
//    pspin:<set> ... planet spin on its pin    band:<id> ...... applied or released
//
//  GREP MAP
//    export function partsFor ... the table, built from the tooth counts
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
export const GROUP_COLOR = {
  'Sun': '#ffd27a', 'Planets': '#9fd0ff', 'Ring': '#ff9f80', 'Carrier': '#8fa8ff',
  'Shafts': '#c9ced8', 'Drums': '#d8b07a', 'Bands': '#ff7a7a',
};
const mm = v => `${+v.toFixed(1)} mm`;

export function partsFor(L) {
  const S = L.sets[0], m = S.m;
  const gearSpecs = (Z, r) => [['Teeth', String(Z)], ['Module', `${m} mm`], ['Pitch Ø', mm(2 * r)]];
  if (L.id === 'simple') return {
    sun: { name: 'Sun gear', group: 'Sun', role: 'The small gear at the centre, cut on the end of the input shaft. Every planet meshes with it at once, so the load is shared N ways.', specs: [...gearSpecs(S.Zs, S.rs), ['Tip Ø', mm(2 * S.rsT)]], live: ['role:S', 'w:S'] },
    planet: { name: 'Planet gear', group: 'Planets', role: `${S.N} equal gears between the sun and the ring. Each spins on its own pin and is carried round the sun by the carrier. A planet is an idler: its tooth count drops out of the ratio, but it sets the ring size, Zr = Zs + 2Zp.`, specs: [...gearSpecs(S.Zp, S.rp), ['Planets', String(S.N)], ['Centre distance', mm(S.a)]], live: ['pspin:0', 'w:C'] },
    ring: { name: 'Ring gear', group: 'Ring', role: 'An internal gear (an annulus) round the outside. Its teeth point inward; a planet rolls round inside it. Hold it and the carrier is a slow, strong output.', specs: [...gearSpecs(S.Zr, S.rr), ['Zr = Zs + 2Zp', `${S.Zs} + 2·${S.Zp}`]], live: ['role:R', 'w:R'] },
    carrier: { name: 'Planet carrier', group: 'Carrier', role: 'Two plates joined by the planet pins. Its speed is a weighted mean of the sun and ring speeds — the third member of the set, and often the output.', specs: [['Centre distance', mm(S.a)], ['Planets', String(S.N)], ['Weight of ring', `Zr/(Zs+Zr) = ${(S.Zr / (S.Zs + S.Zr)).toFixed(3)}`]], live: ['role:C', 'w:C'] },
    pins: { name: 'Planet pins', group: 'Carrier', role: 'Hardened pins pressed into both carrier plates. Each planet turns on its pin on a ring of needle rollers (the brass cage at each face).', specs: [['Pin Ø', mm(2 * S.pr)]], live: ['pspin:0'] },
  };
  const R = L.sets[1], G = L.g;
  return {
    sun2: { name: 'Sun gear (shared)', group: 'Sun', role: 'One long sun gear that both sets mesh with. The intermediate band holds it for 2nd gear; the direct clutch drives it for 3rd and reverse.', specs: [...gearSpecs(S.Zs, S.rs), ['Length', mm(G.zS1 - G.zS0)]], live: ['role:S', 'w:S'] },
    input: { name: 'Input shell', group: 'Shafts', role: 'The input shaft and its web, driven by the forward clutch from the torque converter. It turns the front ring in every forward gear.', specs: [['Web Ø', mm(2 * S.rrO)]], live: ['role:R1', 'w:R1'] },
    ring1: { name: 'Front ring gear', group: 'Ring', role: 'The input of the front set. The front carrier is the output, so a held sun (2nd) gives 1 + Zs/Zr.', specs: gearSpecs(S.Zr, S.rr), live: ['role:R1', 'w:R1'] },
    carrier1: { name: 'Front carrier', group: 'Carrier', role: 'Carries the front planets. It is fixed to the output drum and, through it, to the rear ring.', specs: [['Planets', String(S.N)], ['Centre distance', mm(S.a)]], live: ['role:C1', 'w:C1'] },
    planetF: { name: 'Front planet', group: 'Planets', role: 'Meshes the shared sun with the front ring.', specs: [...gearSpecs(S.Zp, S.rp), ['Planets', String(S.N)]], live: ['pspin:0'] },
    outDrum: { name: 'Output drum', group: 'Drums', role: 'Joins the front carrier to the rear ring. The transfer gear on its outside takes the power to the final drive. Its speed is the output speed.', specs: [['Transfer gear', `${G.ZT} teeth, m ${G.mT}`]], live: ['role:C1', 'w:C1'] },
    ring2: { name: 'Rear ring gear', group: 'Ring', role: 'Bolted to the output drum, so it turns with the output. In 1st and reverse it is the output of the rear set.', specs: gearSpecs(R.Zr, R.rr), live: ['w:C1'] },
    carrier2: { name: 'Rear carrier', group: 'Carrier', role: 'Carries the rear planets. The low/reverse band holds its drum in 1st and reverse; then the rear set turns the sun backward against the output, or (in reverse) the output backward.', specs: [['Planets', String(R.N)], ['Drum Ø', mm(2 * G.rC2)]], live: ['role:C2', 'w:C2'] },
    planetR: { name: 'Rear planet', group: 'Planets', role: 'Meshes the shared sun with the rear ring.', specs: [...gearSpecs(R.Zp, R.rp), ['Planets', String(R.N)]], live: ['pspin:1'] },
    sunDrum: { name: 'Sun drum', group: 'Drums', role: 'Splined to the end of the sun shaft. The intermediate band grips it to hold the sun.', specs: [['Drum Ø', mm(2 * G.rSD)]], live: ['w:S', 'band:band1'] },
    band1: { name: 'Intermediate band', group: 'Bands', role: 'A steel strap lined with friction material, fixed to the case at one ear. A servo pulls the other ear and the band wraps tight on the sun drum: the sun stops (2nd gear).', specs: [['Applied in', '2nd']], live: ['band:band1'] },
    band2: { name: 'Low/reverse band', group: 'Bands', role: 'Wraps the rear carrier drum. Applied, it holds the rear carrier for 1st gear and reverse.', specs: [['Applied in', '1st, R']], live: ['band:band2'] },
  };
}
