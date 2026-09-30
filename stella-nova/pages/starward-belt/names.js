// names.js — station and belt names for random maps, in the voice of the
// Citizen Sleeper charts. No DOM. The generator passes in its seeded rng, so
// the same seed always gives the same names.
//
// Five name forms, each with its own word bank:
//   compound    one word from two parts        Rustwharf, Saltmoor
//   single      one found word                 Ballast, Spindrift
//   pair        adjective or sky word + place  Low Pylon, Vesper Relay
//   possessive  surname + place                Varga's Claim
//   the         'The' + place                  The Narrows
//   founder     a person's name                Esperanza
//
// grep: makeNamer  beltName  CANON  HEADS  TAILS  SINGLES  PAIR_A  PAIR_B
//       SURNAMES  CLAIMS  THE  FOUNDERS  WARD

// The ten names of the original chart. Random maps never use them.
export const CANON = [
  'Wellspring', "Holm's Rock", 'Flotsam', 'Far Spindle', 'Helion Gate',
  'Scatteryards', 'Darkside', 'Greenbelt', 'The Hollow', 'Olivera',
];

const HEADS = [
  'Rust', 'Cinder', 'Salt', 'Tide', 'Iron', 'Slag', 'Ash', 'Brine', 'Coal',
  'Wreck', 'Keel', 'Hull', 'Char', 'Grey', 'Glass', 'Mire', 'Deep', 'Still',
  'Cold', 'Tallow', 'Lamp', 'Pitch', 'Silt', 'Flint', 'Copper', 'Tin', 'Ember',
  'Soot', 'Fog', 'Gull', 'Kelp', 'Wind', 'Night', 'Scrap', 'Bright', 'Hollow',
  'Drift', 'Black', 'Red', 'Long', 'Sun', 'Stone',
];
const TAILS = [
  'spring', 'yards', 'side', 'reach', 'haven', 'hold', 'wake', 'fall', 'mark',
  'moor', 'water', 'works', 'stead', 'well', 'rest', 'field', 'light', 'wharf',
  'span', 'fast', 'sound', 'mouth', 'gate', 'hook', 'lock', 'marsh', 'quay',
  'shoal', 'crib', 'ditch', 'heap', 'mere', 'hearth', 'hollow',
];
const SINGLES = [
  'Jetsam', 'Ballast', 'Bilge', 'Sump', 'Cordage', 'Salvage', 'Dregs', 'Wrack',
  'Lagan', 'Tinder', 'Offcut', 'Swarf', 'Chaff', 'Gantry', 'Cistern', 'Crucible',
  'Tailings', 'Spindrift', 'Undertow', 'Moorage', 'Hawser', 'Halyard', 'Flux',
  'Kindling', 'Scupper', 'Gimbal', 'Sounding', 'Bulwark', 'Lodestone', 'Wharfage',
];
const PAIR_A = [
  'Far', 'Low', 'High', 'Outer', 'Inner', 'Last', 'Old', 'Lesser', 'Upper',
  'Broken', 'Silent', 'Sunward', 'Nadir', 'Apsis', 'Zenith', 'Halcyon', 'Vesper',
  'Umbra', 'Corona', 'Aphelion', 'Meridian', 'Pale', 'Lumen', 'Albedo',
  'Parallax', 'Perigee', 'Quiet', 'Second', 'North', 'Cold',
];
const PAIR_B = [
  'Spindle', 'Gate', 'Spire', 'Dock', 'Crossing', 'Relay', 'Rig', 'Array',
  'Hulk', 'Foundry', 'Lock', 'Terminus', 'Pylon', 'Cradle', 'Lattice', 'Mooring',
  'Beacon', 'Refuge', 'Kiln', 'Spoke', 'Tether', 'Yard', 'Shelf', 'Weir',
  'Sluice', 'Anchor', 'Mast', 'Drum', 'Coil', 'Well',
];
const SURNAMES = [
  'Okafor', 'Varga', 'Castell', 'Ibarra', 'Rook', 'Pell', 'Asher', 'Ngata',
  'Kovac', 'Lind', 'Quill', 'Tamsin', 'Oduya', 'Brandt', 'Sato', 'Reyes',
  'Mercer', 'Voss', 'Hale', 'Dunn', 'Esker', 'Faro', 'Mbeki', 'Orla', 'Juno',
];
const CLAIMS = [
  'Rock', 'Rest', 'Folly', 'Landing', 'Reach', 'Hold', 'Claim', 'Drift', 'Luck',
  'Stake', 'Hope', 'Knot', 'Berth', 'Hulk',
];
const THE = [
  'Narrows', 'Sump', 'Tangle', 'Shoals', 'Reef', 'Kettle', 'Maw', 'Cradle',
  'Spill', 'Rookery', 'Warren', 'Sieve', 'Knot', 'Crib', 'Shallows', 'Pale',
  'Scrapheap', 'Undercroft', 'Stacks', 'Sprawl',
];
const FOUNDERS = [
  'Esperanza', 'Valdane', 'Marisol', 'Castellan', 'Ostrova', 'Delacruz',
  'Amarante', 'Bellamy', 'Soledad', 'Novaya', 'Kestrel', 'Magdala', 'Sabine',
  'Corvina', 'Ilesanmi', 'Oriel',
];
const WARD = [
  'Lee', 'Dusk', 'Ember', 'Tide', 'Cold', 'Sun', 'Ash', 'Salt', 'Far', 'Grey',
  'Rust', 'Night', 'Moon', 'Drift', 'Wind', 'Cinder', 'Hollow', 'Sea', 'Down',
];
const BELT_SINGLES = [
  'Meridian', 'Halcyon', 'Vesper', 'Cinder', 'Lantern', 'Tallow', 'Umber',
  'Saltmarch', 'Greywater', 'Hollowmere', 'Kestrel', 'Brightwater', 'Perigee',
  'Farshore', 'Ashfall', 'Tidewrack',
];

// Name forms and their weights. max caps each form on one map.
const FORMS = [
  { id: 'compound',   w: 36, max: 5 },
  { id: 'single',     w: 12, max: 2 },
  { id: 'pair',       w: 26, max: 4 },
  { id: 'possessive', w: 11, max: 2 },
  { id: 'the',        w: 8,  max: 1 },
  { id: 'founder',    w: 7,  max: 1 },
];

const MAX_LEN = 13;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// A belt name, one word. Never 'Starward'.
export function beltName(rng) {
  if (rng.f() < 0.5) {
    const w = rng.pick(WARD) + 'ward';
    return w === 'Starward' ? 'Leeward' : w;
  }
  return rng.pick(BELT_SINGLES);
}

// makeNamer(rng, avoid) -> next(): a new unique station name each call.
// avoid holds words that must not come back (the belt name, for example).
export function makeNamer(rng, avoid = []) {
  const used = new Set(CANON.map(s => s.toLowerCase()));
  const parts = new Set(avoid.map(s => s.toLowerCase()));   // no word twice on one map
  const count = {};

  function one(form) {
    switch (form) {
      case 'compound': {
        const h = rng.pick(HEADS), t = rng.pick(TAILS);
        if (h.toLowerCase() === t) return null;
        return { name: h + t, words: [h, t] };
      }
      case 'single': { const s = rng.pick(SINGLES); return { name: s, words: [s] }; }
      case 'pair': {
        const a = rng.pick(PAIR_A), b = rng.pick(PAIR_B);
        return { name: `${a} ${b}`, words: [a, b] };
      }
      case 'possessive': {
        const s = rng.pick(SURNAMES), c = rng.pick(CLAIMS);
        return { name: `${s}'s ${c}`, words: [s, c] };
      }
      case 'the': { const w = rng.pick(THE); return { name: `The ${w}`, words: [w] }; }
      default: { const f = rng.pick(FOUNDERS); return { name: f, words: [f] }; }
    }
  }

  return function next() {
    for (let tries = 0; tries < 400; tries++) {
      const open = FORMS.filter(f => (count[f.id] || 0) < f.max);
      const form = rng.weighted(open, f => f.w).id;
      const c = one(form);
      if (!c || c.name.length > MAX_LEN || /(.)\1\1/i.test(c.name)) continue;
      const key = c.name.toLowerCase();
      if (used.has(key)) continue;
      if (c.words.some(w => parts.has(w.toLowerCase()))) continue;
      used.add(key);
      for (const w of c.words) parts.add(w.toLowerCase());
      count[form] = (count[form] || 0) + 1;
      return cap(c.name);
    }
    // The banks are far larger than one map needs. This is a safe floor.
    let i = 2;
    while (used.has(`relay ${i}`)) i++;
    used.add(`relay ${i}`);
    return `Relay ${i}`;
  };
}
