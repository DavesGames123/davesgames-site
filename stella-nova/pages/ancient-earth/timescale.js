// ============================================================================
//  ANCIENT EARTH  ·  timescale.js  ·  the geological time scale (no DOM)
// ----------------------------------------------------------------------------
//  The units of the ICS International Chronostratigraphic Chart (v2024/12
//  boundaries, as served by the Macrostrat API) from 541 Ma to today, with
//  the CGMW standard colours. tests.mjs checks every boundary and colour
//  against tests/ics.json (Macrostrat, fetched by build/build_data.py).
//  Each unit: [name, top age Ma, base age Ma, colour].
//
//  The scrubber is not linear in age: the Cenozoic is short but busy, so
//  "ageToX" gives each era a fixed share of the bar (ERA_SHARE).
//
//  grep -n targets
//    chart units ......... "export const EONS" / ERAS / PERIODS / EPOCHS
//    unit at an age ...... "export function unitAt"
//    bar mapping ......... "export function ageToX" / "xToAge"
//    key events .......... "export const EVENTS"
// ============================================================================

export const MAX_AGE = 540;

export const EONS = [
  ['Phanerozoic', 0, 538.8, '#9AD9DD'],
  ['Proterozoic', 538.8, 2500, '#F73563'],
];
export const ERAS = [
  ['Cenozoic', 0, 66, '#F2F91D'],
  ['Mesozoic', 66, 251.902, '#67C5CA'],
  ['Paleozoic', 251.902, 538.8, '#99C08D'],
  ['Neoproterozoic', 538.8, 1000, '#FEB342'],
];
export const PERIODS = [
  ['Quaternary', 0, 2.58, '#F9F97F'],
  ['Neogene', 2.58, 23.04, '#FFE619'],
  ['Paleogene', 23.04, 66, '#FD9A52'],
  ['Cretaceous', 66, 143.1, '#7FC64E'],
  ['Jurassic', 143.1, 201.4, '#34B2C9'],
  ['Triassic', 201.4, 251.902, '#812B92'],
  ['Permian', 251.902, 298.9, '#F04028'],
  ['Carboniferous', 298.9, 358.86, '#67A599'],
  ['Devonian', 358.86, 419.62, '#CB8C37'],
  ['Silurian', 419.62, 443.1, '#B3E1B6'],
  ['Ordovician', 443.1, 486.85, '#009270'],
  ['Cambrian', 486.85, 538.8, '#7FA056'],
  ['Ediacaran', 538.8, 635, '#FED96A'],
];
export const EPOCHS = [
  ['Holocene', 0, 0.0117, '#FEF2E0'],
  ['Pleistocene', 0.0117, 2.58, '#FFF2AE'],
  ['Pliocene', 2.58, 5.333, '#FFFF99'],
  ['Miocene', 5.333, 23.04, '#FFFF00'],
  ['Oligocene', 23.04, 33.9, '#FDC07A'],
  ['Eocene', 33.9, 56, '#FDB46C'],
  ['Paleocene', 56, 66, '#FDA75F'],
  ['Late Cretaceous', 66, 100.5, '#A6D84A'],
  ['Early Cretaceous', 100.5, 143.1, '#8CCD57'],
  ['Late Jurassic', 143.1, 161.5, '#B3E3EE'],
  ['Middle Jurassic', 161.5, 174.7, '#80CFD8'],
  ['Early Jurassic', 174.7, 201.4, '#42AED0'],
  ['Late Triassic', 201.4, 237, '#BD8CC3'],
  ['Middle Triassic', 237, 246.7, '#B168B1'],
  ['Early Triassic', 246.7, 251.902, '#983999'],
  ['Lopingian', 251.902, 259.51, '#FBA794'],
  ['Guadalupian', 259.51, 274.4, '#FB745C'],
  ['Cisuralian', 274.4, 298.9, '#EF5845'],
  ['Pennsylvanian', 298.9, 323.4, '#99C2B5'],
  ['Mississippian', 323.4, 358.86, '#678F66'],
  ['Late Devonian', 358.86, 382.31, '#F1E19D'],
  ['Middle Devonian', 382.31, 393.47, '#F1C868'],
  ['Early Devonian', 393.47, 419.62, '#E5AC4D'],
  ['Pridoli', 419.62, 422.7, '#E6F5E1'],
  ['Ludlow', 422.7, 426.7, '#BFE6CF'],
  ['Wenlock', 426.7, 432.9, '#B3E1C2'],
  ['Llandovery', 432.9, 443.1, '#99D7B3'],
  ['Late Ordovician', 443.1, 458.2, '#7FCA93'],
  ['Middle Ordovician', 458.2, 471.3, '#4DB47E'],
  ['Early Ordovician', 471.3, 486.85, '#1A9D6F'],
  ['Furongian', 486.85, 497, '#B3E095'],
  ['Miaolingian', 497, 506.5, '#A6CF86'],
  ['Series 2', 506.5, 521, '#99C078'],
  ['Terreneuvian', 521, 538.8, '#8CB06C'],
  ['Ediacaran', 538.8, 635, '#FED96A'],
];

// The unit of a list that holds age t (top <= t < base; t = 0 is in the
// youngest unit).
export function unitAt(list, t) {
  for (const u of list) if (t >= u[1] && t < u[2]) return u;
  return list[list.length - 1];
}
export function describeAge(t) {
  return { eon: unitAt(EONS, t), era: unitAt(ERAS, t), period: unitAt(PERIODS, t), epoch: unitAt(EPOCHS, t) };
}
export function fmtAge(t) {
  if (t <= 0.0005) return 'today';
  if (t < 0.1) return Math.round(t * 1000) + ' thousand years ago';
  if (t < 10) return t.toFixed(1) + ' million years ago';
  return Math.round(t) + ' million years ago';
}
export function fmtMa(t) {
  if (t <= 0.0005) return '0 Ma';
  if (t < 0.1) return Math.round(t * 1000) + ' ka';
  if (t < 10) return t.toFixed(1) + ' Ma';
  return Math.round(t) + ' Ma';
}

// Bar mapping: x in 0..1 from the left (oldest, 540 Ma) to the right
// (today). The Cenozoic gets 0.24 of the bar, the Mesozoic 0.30 and the
// Paleozoic (with the Ediacaran sliver) 0.46. Linear inside each era.
const KNOTS = [[MAX_AGE, 0], [251.902, 0.46], [66, 0.76], [0, 1]];
export function ageToX(t) {
  t = Math.max(0, Math.min(MAX_AGE, t));
  for (let i = 0; i < KNOTS.length - 1; i++) {
    const [a0, x0] = KNOTS[i], [a1, x1] = KNOTS[i + 1];
    if (t <= a0 && t >= a1) return x0 + (x1 - x0) * (a0 - t) / (a0 - a1);
  }
  return 1;
}
export function xToAge(x) {
  x = Math.max(0, Math.min(1, x));
  for (let i = 0; i < KNOTS.length - 1; i++) {
    const [a0, x0] = KNOTS[i], [a1, x1] = KNOTS[i + 1];
    if (x >= x0 && x <= x1) return a0 - (a0 - a1) * (x - x0) / (x1 - x0);
  }
  return 0;
}

// Key events: the jump-to presets. Ages are the commonly cited values.
export const EVENTS = [
  { id: 'cambrian', age: 525, name: 'Cambrian explosion', short: 'Cambrian' },
  { id: 'gobe', age: 470, name: 'Ordovician radiation', short: 'Ordovician' },
  { id: 'hirnantian', age: 445, name: 'Late Ordovician ice age', short: 'Ice 445' },
  { id: 'forests', age: 385, name: 'First forests', short: 'Forests' },
  { id: 'coal', age: 305, name: 'Coal swamps and the Late Paleozoic ice age', short: 'Coal' },
  { id: 'pangea', age: 260, name: 'Pangea', short: 'Pangea' },
  { id: 'permian', age: 251.9, name: 'End-Permian extinction', short: 'P–T' },
  { id: 'dinos', age: 230, name: 'First dinosaurs', short: 'Dinosaurs' },
  { id: 'breakup', age: 180, name: 'Pangea breaks up', short: 'Breakup' },
  { id: 'jurassic', age: 150, name: 'Late Jurassic giants', short: 'Jurassic' },
  { id: 'seaway', age: 90, name: 'Cretaceous hothouse', short: 'Hothouse' },
  { id: 'kpg', age: 66, name: 'K–Pg impact', short: 'K–Pg' },
  { id: 'petm', age: 56, name: 'Paleocene–Eocene thermal maximum', short: 'PETM' },
  { id: 'antarctica', age: 34, name: 'Antarctic ice sheet', short: 'Ice 34' },
  { id: 'lgm', age: 0.021, name: 'Last Glacial Maximum', short: 'Ice age' },
  { id: 'today', age: 0, name: 'Today', short: 'Today' },
];

// Loop ranges for the time player.
export const RANGES = [
  { id: 'all', name: 'Whole Phanerozoic', from: 540, to: 0 },
  { id: 'pangea', name: 'Pangea to today', from: 320, to: 0 },
  { id: 'assembly', name: 'Pangea assembles', from: 480, to: 280 },
  { id: 'mesozoic', name: 'Age of dinosaurs', from: 252, to: 66 },
  { id: 'cenozoic', name: 'Age of mammals', from: 66, to: 0 },
  { id: 'paleozoic', name: 'Paleozoic', from: 540, to: 252 },
];
