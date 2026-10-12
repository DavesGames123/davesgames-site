// ============================================================================
//  VIRUS ATLAS  ·  saver-look.js — looks, light rigs and plate facts of the
//  screensaver (no DOM, no three.js: tests.mjs imports it in Node)
// ----------------------------------------------------------------------------
//  VIRUSES  the 12 particles that the saver builds and takes apart, with
//    the facts for the plate: family, diameter (nm, for the order), the
//    assembly unit, and the explode styles that show the structure.
//    build    explode styles for the build (regions.js explodePlan mode)
//    apart    explode styles for the take-apart
//    mid      region kinds for the inspection (regions.js REGION_KINDS)
//    amp      how far a part flies, in particle radii (rod: nm / R)
//
//  LOOKS  6 curated looks: one colour scheme, palette, light rig and
//    backdrop that work together. A look holds for one whole virus.
//    okLook(key, look) keeps a look off a virus where it reads badly (one
//    main protein in the 'protein' scheme is one flat colour; the cone
//    has 1356 chains, so 'chain' is confetti).
//
//  RIGS  light rigs in the shape of colors.js LIGHTS, with more rim and a
//    fog colour (bg) that matches the backdrop near the subject.
//
//  fitLong(L, rr, view)  the camera distance that fits a long subject
//    (half length L along its axis, radius rr across) in the clear band,
//    and whether its axis lies across the screen (landscape band) or up
//    it (portrait band).
//
//  grep -n targets: "export const VIRUSES", "export const LOOKS",
//    "export const RIGS", "export function okLook", "export function fitLong",
//    "export function rigOf"
// ============================================================================

// d: diameter in nm (the particle on screen, from catalog.js size)
export const VIRUSES = {
  polio: { family: 'Picornaviridae', d: 30, unit: '12 pentamers', build: [5], apart: [3, 2, -1], mid: ['pentamer', 'hexamer'], amp: 0.75 },
  rhino: { family: 'Picornaviridae', d: 30, unit: '12 pentamers', build: [5], apart: [2, 3, -1], mid: ['pentamer', 'hexamer'], amp: 0.75 },
  noro: { family: 'Caliciviridae', d: 38, unit: '90 VP1 dimers', build: ['cap', 3], apart: [5, 2, -1], mid: ['hexamer', 'pentamer'], amp: 0.75 },
  hbv: { family: 'Hepadnaviridae', d: 34, unit: '120 core dimers', build: ['cap', 2], apart: [5, 3, -1], mid: ['hexamer', 'pentamer'], amp: 0.75 },
  hpv: { family: 'Papillomaviridae', d: 57, unit: '72 L1 pentamers', build: ['cap'], apart: [5, 3, -1], mid: ['pentamer6', 'pentamer'], amp: 0.7 },
  adeno: { family: 'Adenoviridae', d: 90, unit: '240 hexon trimers, 12 pentons', build: ['cap'], apart: [5, 3, 2], mid: ['face', 'pentamer'], amp: 0.6 },
  zika: { family: 'Flaviviridae', d: 50, unit: '90 E dimers in 30 rafts', build: [2, 3], apart: [5, -1], mid: ['face', 'pentamer'], amp: 0.7 },
  hk97: { family: 'Hendrixvirus (tailed phage)', d: 62, unit: '60 hexamers, 12 pentamers', build: ['cap', 5], apart: [3, 2, -1], mid: ['hexamer', 'pentamer'], amp: 0.7 },
  tmv: { family: 'Virgaviridae', d: 18, len: 300, unit: '16.3 subunits per turn', build: [-1], apart: [-1], mid: ['section'], amp: 0.12 },
  'hiv-cone': { family: 'Retroviridae', d: 60, len: 120, unit: '216 hexamers, 12 pentamers', build: ['cap'], apart: [-1, 'cap'], mid: ['pentamer', 'hexamer'], amp: 0.45 },
  'sars2-virion': { family: 'Coronaviridae', d: 130, unit: '≈ 24 spikes (26 drawn)', build: [-1], apart: [-1], mid: ['spike'], amp: 0.5 },
  'flu-virion': { family: 'Orthomyxoviridae', d: 127, unit: '260 HA and 40 NA drawn', build: [-1], apart: [-1], mid: ['spike'], amp: 0.45 },
};
export const VIRUS_KEYS = Object.keys(VIRUSES);
// main proteins and chains per asymmetric unit (from the data files; the
// tests check them)
export const TRAITS = {
  polio: { mains: 4, nc: 4 }, rhino: { mains: 4, nc: 4 }, noro: { mains: 1, nc: 3 }, hbv: { mains: 1, nc: 4 }, hpv: { mains: 1, nc: 6 },
  adeno: { mains: 6, nc: 21 }, zika: { mains: 2, nc: 9 }, hk97: { mains: 1, nc: 7 }, tmv: { mains: 1, nc: 2 }, 'hiv-cone': { mains: 1, nc: 1356 },
  'sars2-virion': { mains: 1, nc: 47 }, 'flu-virion': { mains: 2, nc: 17 },
};

export const RIGS = {
  studio: { id: 'studio', key: [-0.45, 0.65, 0.62], keyCol: [1, 0.98, 0.95], fill: [0.6, -0.2, 0.5], amb: 0.2, rim: 0.5, spec: 0.26 },
  warm: { id: 'warm', key: [-0.6, 0.45, 0.65], keyCol: [1, 0.87, 0.7], fill: [0.7, 0.0, 0.4], amb: 0.22, rim: 0.55, spec: 0.2 },
  cold: { id: 'cold', key: [0.5, 0.6, 0.6], keyCol: [0.8, 0.9, 1], fill: [-0.6, -0.3, 0.5], amb: 0.2, rim: 0.6, spec: 0.3 },
  top: { id: 'top', key: [0.1, 1.0, 0.35], keyCol: [1, 0.97, 0.92], fill: [0, -0.6, 0.6], amb: 0.22, rim: 0.5, spec: 0.3 },
};

// back: the backdrop gradient, inner (behind the subject) to outer
export const LOOKS = [
  { id: 'atlas', scheme: 'protein', pal: 'atlas', rig: 'studio', back: { inner: '#1a2440', outer: '#020309' } },
  { id: 'goodsell', scheme: 'protein', pal: 'goodsell', rig: 'warm', back: { inner: '#2c2219', outer: '#060403' } },
  { id: 'depth', scheme: 'radius', pal: 'atlas', rig: 'studio', back: { inner: '#14213a', outer: '#020309' } },
  { id: 'ice', scheme: 'radius', pal: 'ice', rig: 'cold', back: { inner: '#0d2538', outer: '#01040a' } },
  { id: 'ember', scheme: 'radius', pal: 'ember', rig: 'warm', back: { inner: '#2a1511', outer: '#050202' } },
  { id: 'chain', scheme: 'chain', pal: 'goodsell', rig: 'top', back: { inner: '#1c2030', outer: '#030306' } },
];
export const lookById = id => LOOKS.find(l => l.id === id) || LOOKS[0];

export function okLook(key, look) {
  const t = TRAITS[key] || { mains: 1, nc: 1 }, virion = key.endsWith('-virion');
  if (look.scheme === 'protein') return t.mains >= 2 || virion;
  if (look.scheme === 'chain') return t.nc >= 2 && t.nc <= 8;
  return true;
}
// the view of a look on an entry: blobs on the cone (1356 chains)
export const repOf = key => key === 'hiv-cone' ? 'blob' : 'space';

const hexMix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
// the light rig of a look, with the fog colour of its backdrop
export function rigOf(look) {
  const r = RIGS[look.rig] || RIGS.studio;
  return { ...r, bg: hexMix(look.back.inner, look.back.outer, 0.35) };
}

// view: { w, h, occ, fov }. -> { dist, across } (across: the axis lies
// along the screen x axis)
export function fitLong(L, rr, view) {
  const { w, h, occ } = view;
  const bw = Math.max(80, w - occ.l - occ.r), bh = Math.max(80, h - occ.t - occ.b);
  const t = Math.tan(view.fov * Math.PI / 360) / h;
  const across = bw >= bh;
  const long = across ? bw : bh, short = across ? bh : bw;
  const dist = Math.max(L * 1.06 / (t * long * 0.94), rr * 1.15 / (t * short)) + rr;
  return { dist, across };
}
