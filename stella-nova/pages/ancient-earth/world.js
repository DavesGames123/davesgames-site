// ============================================================================
//  ANCIENT EARTH  ·  world.js  ·  climate estimate, captions, ancient names
// ----------------------------------------------------------------------------
//  No DOM, no THREE. Three tables the page reads at an age t (Ma):
//
//  1. CLIMATE: a coarse global mean surface temperature curve (GMST, deg C)
//     drawn by hand to follow the shape of published Phanerozoic curves
//     (for example Scotese et al. 2021, Judd et al. 2024). It is an
//     ESTIMATE for the look of the globe: ice, biome bands, sea ice. The
//     page labels it so. climateAt(t) turns it into the equator
//     temperature and the equator-to-pole drop that the shader uses:
//        T(lat, z) = Teq - dT * sin^2(lat) - 6.5 K/km * z
//     with the sphere mean of T = GMST (the mean of sin^2 is 1/3).
//     Land plants: none before about 470 Ma, forests from about 385 Ma,
//     grasslands from about 25 Ma (a ramp, not a date).
//
//  2. CAPTIONS: a short text of what the world was like, by interval.
//
//  3. NAMES: ancient continents and oceans. Each name has an age window
//     and an anchor on present-day crust that rides its plate:
//        at:   [lat, lon]                 a point on one plate
//        mid:  [[lat, lon], [lat, lon]]   the midpoint of two riding points
//        anti: [lat, lon]                 the antipode of a riding point
//     so an ocean label sits between the continents that bound it.
//
//  grep -n targets
//    temperature curve ..... "const GMST"
//    climate at t .......... "export function climateAt"
//    captions .............. "export const CAPTIONS"
//    ancient names ......... "export const NAMES"
// ============================================================================

// [age Ma, GMST deg C]. Estimate (see header).
const GMST = [
  [0, 14.5], [2.6, 15.5], [5, 17], [15, 19.5], [25, 18.5], [33.9, 17.5], [36, 21],
  [50, 26], [56, 27.5], [58, 22.5], [66, 21], [70, 21.5], [92, 28], [100, 25],
  [120, 22], [145, 21], [160, 22], [183, 25], [201, 21], [230, 24], [252, 30],
  [256, 24], [270, 20], [285, 15], [300, 12.5], [330, 14], [345, 17.5], [372, 22],
  [400, 22], [425, 20], [440, 15], [445, 12.5], [450, 18], [460, 21],
  [470, 23], [500, 26], [520, 24], [540, 22],
];

export function gmstAt(t) {
  // The Last Glacial Maximum (21 ka) is a 6 K dip on top of the curve.
  const lgm = Math.exp(-(((t - 0.021) / 0.008) ** 2));
  for (let i = 0; i < GMST.length - 1; i++) {
    const [a0, v0] = GMST[i], [a1, v1] = GMST[i + 1];
    if (t >= a0 && t <= a1) return v0 + (v1 - v0) * (t - a0) / (a1 - a0) - 6 * lgm;
  }
  return GMST[GMST.length - 1][1];
}

function ramp(t, old, young) { // 0 at age >= old, 1 at age <= young
  return Math.max(0, Math.min(1, (old - t) / (old - young)));
}

export function climateAt(t) {
  const g = gmstAt(t);
  // A warmer world has a flatter gradient (polar amplification).
  const dT = Math.max(16, Math.min(50, 37.5 - 1.6 * (g - 14.5)));
  const teq = g + dT / 3;
  const lgm = Math.exp(-(((t - 0.021) / 0.008) ** 2));
  return {
    gmst: g, teq, dT,
    // sea level shift in m, only for the ice age (the PaleoDEMs hold their
    // own sea level): -120 m at the LGM.
    sea: -120 * lgm,
    veg: ramp(t, 470, 380),          // land plants, 0..1
    tall: ramp(t, 390, 360),         // trees
    grass: ramp(t, 30, 8),           // open grassland
    state: g < 16 ? 'Icehouse' : g < 21 ? 'Cool greenhouse' : g < 25 ? 'Greenhouse' : 'Hothouse',
  };
}

// Captions. Written for this page. [from Ma (old), to Ma (young), title, text]
export const CAPTIONS = [
  [541, 515, 'Cambrian explosion', 'Most animal body plans appear in the fossil record within a few tens of millions of years: trilobites, early arthropods, the first chordates. Land is bare rock and microbial crust. Warm seas flood the continents, and Gondwana sprawls across the south.'],
  [515, 486, 'Late Cambrian seas', 'Shallow tropical seas cover Laurentia and Baltica. Trilobites dominate the sea floor. There are still no plants on land, so rain runs off bare rock and the continents look red and grey from space.'],
  [486, 450, 'Ordovician radiation', 'Marine life diversifies fast: corals, brachiopods, nautiloids, the first jawless fish. The first land plants, simple moss-like forms, start to green damp shores. The Iapetus Ocean narrows as Avalonia drifts north.'],
  [450, 443, 'Late Ordovician ice age', 'Gondwana sits over the South Pole and an ice sheet grows across what is now the Sahara. Sea level falls and the seas cool: about 85% of marine species die out in the second-largest mass extinction.'],
  [443, 419, 'Silurian greenhouse', 'The ice melts and reefs return. Jawed fish appear, and the first vascular plants and arthropods colonise the land. Laurentia, Baltica and Avalonia collide to raise the Caledonian mountains.'],
  [419, 383, 'Age of fishes', 'Armoured placoderms and lobe-finned fish fill the seas. Plants grow taller and form the first forests by about 385 Ma. Laurussia (the Old Red Sandstone continent) straddles the equator.'],
  [383, 359, 'Late Devonian', 'Tetrapods leave the water. Forests spread, roots break up rock and change ocean chemistry. A series of extinction pulses hits reef builders and armoured fish hardest.'],
  [359, 323, 'Mississippian', 'Shallow seas full of crinoids cover the continents. Gondwana closes in on Laurussia, and the Rheic Ocean shrinks. Ice begins to build in the far south.'],
  [323, 299, 'Coal swamps', 'Giant club mosses and tree ferns grow in equatorial swamps whose remains become coal. High oxygen lets dragonflies reach the size of hawks. Ice sheets wax and wane over southern Gondwana: an icehouse world.'],
  [299, 260, 'Pangea assembles', 'Almost all land joins into one supercontinent, Pangea, ringed by the Panthalassa Ocean. Its interior is far from the sea and very dry. Synapsids, the ancestors of mammals, are the large land animals.'],
  [260, 251.9, 'End-Permian extinction', 'Huge eruptions in Siberia release carbon, and the world heats fast. The seas lose oxygen and acidify. About 90% of marine species and most land vertebrates die: the largest mass extinction.'],
  [251.9, 237, 'Early Triassic recovery', 'A hot, harsh world. Life recovers slowly. Pangea is still whole, with deserts across much of its interior and the Tethys Ocean as a great bay in the east.'],
  [237, 201.4, 'First dinosaurs', 'The first dinosaurs, pterosaurs and mammals appear. A wet pulse (the Carnian pluvial episode) is followed by a drier world. The Triassic ends with rifting and eruptions as Pangea starts to split.'],
  [201.4, 174, 'Early Jurassic', 'Pangea begins to unzip. The Central Atlantic opens between North America and Africa. Dinosaurs become the dominant large land animals, and ichthyosaurs and plesiosaurs rule the seas.'],
  [174, 143, 'Late Jurassic giants', 'Long-necked sauropods and big theropods live on warm, seasonal plains. Archaeopteryx, an early bird, lives on islands in a shallow sea that is now Bavaria. Laurasia and Gondwana are drifting apart.'],
  [143, 100, 'Early Cretaceous', 'Flowering plants appear and spread. South America and Africa separate and the South Atlantic opens. India breaks away from Gondwana and heads north.'],
  [100, 72, 'Cretaceous hothouse', 'One of the warmest times of the Phanerozoic: no permanent ice, forests near the poles. Sea level is very high, and a seaway splits North America in two. Tyrannosaurs, ceratopsians and mosasaurs flourish.'],
  [72, 66, 'End of the Cretaceous', 'Huge lava floods build the Deccan Traps in India. At 66.0 Ma an asteroid about 10 km wide strikes Chicxulub on the Yucatan. Non-bird dinosaurs, pterosaurs and ammonites die out.'],
  [66, 56, 'Paleocene', 'Mammals radiate into the empty niches. Forests regrow quickly. India races north toward Asia.'],
  [56, 34, 'Eocene greenhouse', 'The Paleocene-Eocene Thermal Maximum (56 Ma) is a fast warming spike. Palms grow in the Arctic. India collides with Asia and the Himalayas start to rise. Whales take to the sea.'],
  [34, 23, 'Antarctic ice', 'Australia and South America pull away from Antarctica, and a cold current circles it. Antarctica freezes over at about 34 Ma and the world enters an icehouse that lasts to today.'],
  [23, 2.58, 'Neogene', 'Grasslands spread and grazing mammals with them. The Mediterranean nearly dries out (5.9 Ma). The Isthmus of Panama closes. Early hominins appear in Africa.'],
  [2.58, 0.03, 'Pleistocene ice ages', 'Ice sheets grow and shrink over northern continents in cycles of about 100 thousand years. Sea level swings by more than 100 m. Modern humans evolve in Africa and spread worldwide.'],
  [0.03, 0.0117, 'Last Glacial Maximum', 'About 21 thousand years ago ice covers much of North America and northern Europe. Sea level is about 120 m lower: Britain joins Europe, and a land bridge (Beringia) links Asia and Alaska.'],
  [0.0117, 0, 'Today', 'The Holocene. A world with two ice sheets, a warm interglacial climate and about eight billion people. The continents still move a few centimetres a year.'],
];
export function captionAt(t) {
  for (const c of CAPTIONS) if (t <= c[0] && t >= c[1]) return { title: c[2], text: c[3] };
  return { title: '', text: '' };
}

// Ancient names. kind: 'land' (a continent or terrane) or 'sea' (an ocean).
// [name, kind, from Ma, to Ma, anchor, size 1..3]
export const NAMES = [
  ['Gondwana', 'land', 540, 150, { at: [-20, 25] }, 3],
  ['Laurentia', 'land', 540, 425, { at: [55, -100] }, 2],
  ['Baltica', 'land', 540, 425, { at: [60, 35] }, 2],
  ['Avalonia', 'land', 495, 425, { at: [52.5, -1.5] }, 1],
  ['Siberia', 'land', 540, 260, { at: [64, 105] }, 2],
  ['Kazakhstania', 'land', 500, 290, { at: [48, 70] }, 1],
  ['North China', 'land', 540, 220, { at: [38, 113] }, 1],
  ['South China', 'land', 540, 220, { at: [27, 110] }, 1],
  ['Laurussia', 'land', 425, 300, { at: [50, -60] }, 2],
  ['Pangea', 'land', 300, 175, { at: [12, 5] }, 3],
  ['Cimmeria', 'land', 280, 200, { at: [33, 58] }, 1],
  ['Laurasia', 'land', 175, 60, { at: [55, 40] }, 2],
  ['India', 'land', 130, 45, { at: [22, 78] }, 1],
  ['Panthalassa', 'sea', 540, 190, { anti: [5, 20] }, 3],
  ['Pacific Ocean', 'sea', 190, 0, { anti: [5, 20] }, 3],
  ['Iapetus Ocean', 'sea', 540, 425, { mid: [[48, -65], [60, 15]] }, 2],
  ['Rheic Ocean', 'sea', 480, 320, { mid: [[52, -1], [20, -5]] }, 2],
  ['Paleo-Tethys', 'sea', 420, 200, { mid: [[50, 80], [-25, 133]] }, 2],
  ['Tethys Ocean', 'sea', 250, 30, { mid: [[10, 35], [48, 60]] }, 2],
  ['Atlantic Ocean', 'sea', 175, 0, { mid: [[35, -76], [24, -12]] }, 2],
  ['South Atlantic', 'sea', 120, 0, { mid: [[-12, -38], [-12, 13]] }, 1],
  ['Indian Ocean', 'sea', 120, 0, { mid: [[-15, 42], [-25, 115]] }, 2],
  ['Western Interior Seaway', 'sea', 100, 70, { at: [45, -102] }, 1],
];
