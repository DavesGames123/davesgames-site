// ============================================================================
//  CORAL REEF  ·  fauna/species.js  ·  the creatures of each depth region
// ----------------------------------------------------------------------------
//  DOM-free. The user said (2026-10-18): "let's get a vast assortment of
//  creatures from real biological archives", and "let's make sure that we
//  have creature features as well as we go deeper into the depths, and
//  have generative species ... starfish, cephalopods, crustacea, and all
//  manner of creatures belong there".
//
//  THREE KINDS OF SPECIES (src)
//    'scan' ....... a 3D scan of a museum specimen (assets/fauna, the
//                   licence and provenance in assets/fauna/manifest.json)
//    'procedural' . a real species drawn by our generators (fauna/gen):
//                   the name and the depth are real, the model is ours
//    'generated' .. a species that the seed makes up (generatedSpecies):
//                   no real name; the HUD calls it "generated"
//  DEPTHS. `depth` is [min, max] in metres. `depthRef` says where it comes
//  from: "OBIS p5-p95 (n)" is the 5th to 95th percentile of the depth of the
//  occurrence records in OBIS (api.obis.org, read 2026-10-18; n records),
//  "lit." a published range where OBIS has few or misleading records. The
//  spawner never puts a species outside its depth (tests/fauna.test.mjs).
//  `aphia` is the WoRMS AphiaID of the accepted name.
//
//  ENTRY FIELDS
//    id, name (common), sci, aphia, src, depth, depthRef, size [min, max] m
//    model ...... { asset: id } (scan) or { gen: fn, p: params } (gen/*.js)
//    habit ...... 'school' | 'swim' | 'hover' | 'drift' | 'crawl' | 'still'
//    place ...... 'sand' | 'rock' | 'any' | 'water' | 'vent' | 'fall' | 'coral'
//    alt ........ [min, max] m over the ground (swimmers)
//    group ...... [min, max] animals in one group
//    speed ...... m/s (cruise)
//    anim ....... ANIM code (fauna/glsl.js): the vertex motion
//    light ...... 'flee' | 'attract' | 'ignore' | 'curious' (the ROV lamps)
//    glow ....... { colour, k, halo } bioluminescence (a halo sprite)
//    gel ........ true: the see-through material
//    w .......... the spawn weight; family: for the HUD and the generated pools
//
//  grep -n targets: "export const REGIONS", "export const ANIM",
//  "export const SPECIES", "export const FEATURES", "export function generatedSpecies",
//  "export function regionOfDepth"
// ============================================================================

export const REGIONS = [
  { id: 'shallows', name: 'Shallows', depth: [0, 30] },
  { id: 'reef', name: 'Reef', depth: [5, 40] },
  { id: 'twilight', name: 'Twilight zone', depth: [40, 1000] },
  { id: 'abyss', name: 'Abyss / Trench', depth: [1000, 11000] },
];
export function regionOfDepth(d) { return d < 30 ? 'shallows' : d < 40 ? 'reef' : d < 1000 ? 'twilight' : 'abyss'; }

// vertex motion codes (fauna/glsl.js)
export const ANIM = { STILL: 0, FISH: 1, EEL: 2, FLAP: 3, BELL: 4, CEPH: 5, WALK: 6, ARMS: 7, DRIFT: 8, CRAWL: 9 };

const obis = (n, a, b) => ({ depth: [a, b], depthRef: `OBIS p5-p95 (${n} records)` });
const lit = (a, b, ref) => ({ depth: [a, b], depthRef: `lit.: ${ref}` });
const scan = id => ({ asset: id });
const g = (fn, p = {}) => ({ gen: fn, p });

// ── scans of museum specimens (Smithsonian NMNH, CC0; Khronos CC0) ─────────
const SCANS = [
  { id: 'acanthaster-brevispinus', name: 'short-spined sea star', sci: 'Acanthaster brevispinus', aphia: 213291, ...lit(10, 100, 'SeaLifeBase, soft bottoms 10-100 m (OBIS 6 records: 10-70)'), size: [0.25, 0.35], habit: 'crawl', place: 'sand', anim: 'ARMS', speed: 0.004, family: 'sea star', w: 2 },
  { id: 'culcita-novaeguineae', name: 'cushion star', sci: 'Culcita novaeguineae', aphia: 212298, ...obis(240, 0, 30), size: [0.18, 0.28], habit: 'crawl', place: 'any', anim: 'STILL', speed: 0.003, family: 'sea star', w: 3 },
  { id: 'goniaster-tessellatus', name: 'biscuit sea star', sci: 'Goniaster tessellatus', aphia: 124033, ...obis(266, 30, 100), size: [0.15, 0.22], habit: 'crawl', place: 'any', anim: 'ARMS', speed: 0.003, family: 'sea star', w: 3 },
  { id: 'myxaster-sol', name: 'deep-sea sun star', sci: 'Myxaster sol', aphia: 124126, ...obis(2, 1000, 2000), size: [0.25, 0.35], habit: 'crawl', place: 'any', anim: 'ARMS', speed: 0.003, family: 'sea star', w: 3 },
  { id: 'plazaster-borealis', name: 'many-armed sea star', sci: 'Plazaster borealis', aphia: 254846, ...lit(20, 300, 'NW Pacific shelf, approx. (no OBIS records)'), size: [0.3, 0.5], habit: 'crawl', place: 'any', anim: 'ARMS', speed: 0.004, family: 'sea star', w: 2 },
  { id: 'pycnopodia-helianthoides', name: 'sunflower sea star', sci: 'Pycnopodia helianthoides', aphia: 240764, ...obis(14637, 0, 30), size: [0.4, 0.8], habit: 'crawl', place: 'any', anim: 'ARMS', speed: 0.01, family: 'sea star', w: 2 },
  { id: 'astrophyton-muricatum', name: 'giant basket star', sci: 'Astrophyton muricatum', aphia: 243214, ...obis(603, 0, 300), size: [0.3, 0.5], habit: 'still', place: 'coral', anim: 'ARMS', family: 'brittle star', w: 2 },
  { id: 'astrothorax-waitei', name: 'deep basket star', sci: 'Astrothorax waitei', aphia: 214611, ...obis(445, 160, 1000), size: [0.25, 0.35], habit: 'still', place: 'coral', anim: 'ARMS', family: 'brittle star', w: 3 },
  { id: 'cidaris-blakei', name: 'pencil urchin', sci: 'Cidaris blakei', aphia: 422479, ...obis(49, 200, 800), size: [0.14, 0.2], habit: 'crawl', place: 'any', anim: 'STILL', speed: 0.002, family: 'sea urchin', w: 3 },
  { id: 'tylocidaris-ohshimai', name: 'club urchin', sci: 'Tylocidaris ohshimai', aphia: 829011, ...obis(9, 120, 180), size: [0.08, 0.12], habit: 'crawl', place: 'any', anim: 'STILL', speed: 0.002, family: 'sea urchin', w: 2 },
  { id: 'plagiobrissus-grandis', name: 'great red-footed heart urchin', sci: 'Plagiobrissus grandis', aphia: 422511, ...obis(78, 0, 110), size: [0.15, 0.22], habit: 'still', place: 'sand', anim: 'STILL', family: 'sea urchin', w: 2 },
  { id: 'rotula-deciesdigitata', name: 'rotula sand dollar', sci: 'Rotula deciesdigitata', aphia: 534505, ...lit(0, 20, 'West African surf sands (no OBIS records)'), size: [0.08, 0.1], habit: 'still', place: 'sand', anim: 'STILL', family: 'sea urchin', w: 2 },
  { id: 'tridacna-squamosa', name: 'fluted giant clam', sci: 'Tridacna squamosa', aphia: 207674, ...obis(112, 0, 30), size: [0.3, 0.4], habit: 'still', place: 'rock', anim: 'STILL', family: 'bivalve', w: 2 },
  { id: 'conus-gloriamaris', name: 'glory-of-the-sea cone', sci: 'Conus gloriamaris', aphia: 428137, ...obis(9, 10, 400), size: [0.1, 0.15], habit: 'crawl', place: 'sand', anim: 'STILL', speed: 0.002, family: 'sea snail', w: 1 },
  { id: 'harpa-costata', name: 'imperial harp', sci: 'Harpa costata', aphia: 208159, ...lit(0, 30, 'Mascarene sands (OBIS 1 record is a deep outlier)'), size: [0.07, 0.1], habit: 'crawl', place: 'sand', anim: 'STILL', speed: 0.002, family: 'sea snail', w: 1 },
  { id: 'chicoreus-cervicornis', name: 'antlered murex', sci: 'Chicoreus cervicornis', aphia: 558804, ...obis(155, 10, 110), size: [0.06, 0.09], habit: 'crawl', place: 'any', anim: 'STILL', speed: 0.002, family: 'sea snail', w: 1 },
  { id: 'lopha-cristagalli', name: "cockscomb oyster", sci: 'Lopha cristagalli', aphia: 216638, ...obis(16, 0, 70), size: [0.12, 0.18], habit: 'still', place: 'rock', anim: 'STILL', family: 'bivalve', w: 1 },
  { id: 'astraea-heliotropium', name: 'sunburst star turban', sci: 'Astraea heliotropium', aphia: 404992, ...obis(68, 0, 130), size: [0.07, 0.1], habit: 'crawl', place: 'any', anim: 'STILL', speed: 0.002, family: 'sea snail', w: 1 },
  { id: 'charybdis-lucifera', name: 'yellowish swimming crab', sci: 'Charybdis lucifer', aphia: 208832, ...obis(3, 20, 30), size: [0.1, 0.14], habit: 'crawl', place: 'sand', anim: 'WALK', speed: 0.06, family: 'crab', w: 2 },
  { id: 'ovalipes-ocellatus', name: 'lady crab', sci: 'Ovalipes ocellatus', aphia: 158434, ...obis(3302, 0, 50), size: [0.07, 0.1], habit: 'crawl', place: 'sand', anim: 'WALK', speed: 0.08, family: 'crab', w: 2 },
  { id: 'lauridromia-dehaani', name: 'sponge crab', sci: 'Lauridromia dehaani', aphia: 440092, ...obis(9, 10, 170), size: [0.12, 0.18], habit: 'crawl', place: 'any', anim: 'WALK', speed: 0.03, family: 'crab', w: 2 },
  { id: 'lopholithodes-foraminatus', name: 'box crab', sci: 'Echidnocerus foraminatus', aphia: 590147, ...obis(182, 80, 400), size: [0.18, 0.25], habit: 'crawl', place: 'any', anim: 'WALK', speed: 0.03, family: 'crab', w: 2 },
  { id: 'ibacus-ciliatus', name: 'Japanese fan lobster', sci: 'Ibacus ciliatus', aphia: 210364, ...lit(30, 400, 'Holthuis 1991, FAO lobsters'), size: [0.15, 0.22], habit: 'crawl', place: 'sand', anim: 'WALK', speed: 0.02, family: 'lobster', w: 2 },
  { id: 'scyllarides-astori', name: 'Galapagos slipper lobster', sci: 'Scyllarides astori', aphia: 382910, ...obis(4, 0, 300), size: [0.25, 0.35], habit: 'crawl', place: 'rock', anim: 'WALK', speed: 0.02, family: 'lobster', w: 2 },
  { id: 'limulus-polyphemus', name: 'Atlantic horseshoe crab', sci: 'Limulus polyphemus', aphia: 150514, ...obis(3110, 0, 80), size: [0.35, 0.55], habit: 'crawl', place: 'sand', anim: 'STILL', speed: 0.04, family: 'horseshoe crab', w: 2 },
  { id: 'phyllopteryx-taeniolatus', name: 'weedy seadragon', sci: 'Phyllopteryx taeniolatus', aphia: 282254, ...obis(56, 0, 80), size: [0.3, 0.45], habit: 'hover', place: 'water', alt: [0.4, 2], anim: 'FISH', speed: 0.05, light: 'ignore', family: 'fish', w: 2 },
  { id: 'lates-calcarifer', name: 'barramundi', sci: 'Lates calcarifer', aphia: 278957, ...obis(28133, 0, 10), size: [0.6, 1.0], habit: 'swim', place: 'water', alt: [0.5, 4], group: [1, 4], anim: 'FISH', speed: 0.5, light: 'flee', family: 'fish', w: 2, artist: true },
  // vent, seep and deep scale worms (polychaetes; legible: shown at about twice the real length)
  { id: 'photinopolynoe-burkensis', name: 'scale worm', sci: 'Photinopolynoe burkensis', aphia: 1783175, ...obis(6, 600, 4000), size: [0.06, 0.09], habit: 'crawl', place: 'vent', anim: 'CRAWL', speed: 0.01, family: 'polychaete', w: 3 },
  { id: 'levensteiniella-kincaidi', name: 'vent scale worm', sci: 'Levensteiniella kincaidi', aphia: 328835, ...obis(63, 1000, 4000), size: [0.05, 0.07], habit: 'crawl', place: 'vent', anim: 'CRAWL', speed: 0.01, family: 'polychaete', w: 3 },
  { id: 'branchinotogluma-hessleri', name: 'vent scale worm', sci: 'Branchinotogluma hessleri', aphia: 327273, ...obis(99, 1000, 3000), size: [0.06, 0.09], habit: 'crawl', place: 'vent', anim: 'CRAWL', speed: 0.01, family: 'polychaete', w: 3 },
  { id: 'branchipolynoe-seepensis', name: 'mussel scale worm', sci: 'Branchipolynoe seepensis', aphia: 327285, ...obis(184, 1000, 4000), size: [0.07, 0.1], habit: 'crawl', place: 'vent', anim: 'CRAWL', speed: 0.008, family: 'polychaete', w: 2 },
  { id: 'gorgoniapolynoe-guadalupensis', name: 'coral scale worm', sci: 'Gorgoniapolynoe guadalupensis', aphia: 328163, ...obis(5, 600, 3000), size: [0.05, 0.07], habit: 'crawl', place: 'coral', anim: 'CRAWL', speed: 0.005, family: 'polychaete', w: 2 },
  { id: 'bathyfauvelia-affinis', name: 'abyssal scale worm', sci: 'Bathyfauvelia affinis', aphia: 130728, ...obis(23, 2000, 6000), size: [0.06, 0.09], habit: 'crawl', place: 'sand', anim: 'CRAWL', speed: 0.008, family: 'polychaete', w: 2 },
  // sponges (the small specimens; the big glass-sponge gardens are SPECIES colonies)
  { id: 'staurocalyptus-tylotus', name: 'rossellid glass sponge', sci: 'Acanthascus (Staurocalyptus) tylotus', aphia: 1651927, ...obis(4, 150, 160), size: [0.4, 0.7], habit: 'still', place: 'rock', anim: 'STILL', family: 'glass sponge', w: 2 },
  { id: 'acanthascus-koltuni', name: 'rossellid glass sponge', sci: 'Acanthascus (Acanthascus) koltuni', aphia: 1651794, ...obis(3, 2000, 3000), size: [0.4, 0.7], habit: 'still', place: 'rock', anim: 'STILL', family: 'glass sponge', w: 2 },
  { id: 'tretodictyum-amchitkensis', name: 'ear glass sponge', sci: 'Tretodictyum amchitkense', aphia: 723377, ...obis(3, 800, 900), size: [0.3, 0.5], habit: 'still', place: 'rock', anim: 'STILL', family: 'glass sponge', w: 2 },
  { id: 'teichaxinella-morchella', name: 'morel sponge', sci: 'Axinella corrugata', aphia: 165472, ...obis(127, 10, 80), size: [0.2, 0.35], habit: 'still', place: 'rock', anim: 'STILL', family: 'sponge', w: 2 },
].map(s => Object.assign({ src: 'scan', model: scan(s.id), light: 'ignore', group: [1, 1] }, s, { anim: ANIM[s.anim] }));

// colour helper for the generator params
const fishCol = (back, belly, fin, pattern = 'plain', accent = back, n = 4, extra = {}) => Object.assign({ back, belly, fin, pattern, accent, n }, extra);

// ── real species, our procedural models ─────────────────────────────────────
const PROC = [
  // shallows and reef
  { id: 'caesio-teres', name: 'yellow-and-blueback fusilier', sci: 'Caesio teres', aphia: 219996, ...obis(1857, 0, 30), size: [0.2, 0.3], habit: 'school', place: 'water', alt: [1.5, 9], group: [24, 70], anim: 'FISH', speed: 0.7, light: 'flee', family: 'fish', w: 5, model: g('fish', { h: 0.11, w: 0.065, col: fishCol(0x2a62c0, 0xe8eef6, 0x90b0e0, 'saddle', 0xf2cc22, 1) }) },
  { id: 'chromis-viridis', name: 'blue-green chromis', sci: 'Chromis viridis', aphia: 212811, ...obis(1372, 0, 20), size: [0.06, 0.09], habit: 'school', place: 'coral', alt: [0.3, 2.5], group: [20, 60], anim: 'FISH', speed: 0.35, light: 'flee', family: 'fish', w: 5, model: g('fish', { body: 'deep', h: 0.2, w: 0.06, dorsal: [0.2, 0.7, 0.08], caudal: 'forked', col: fishCol(0x58c8b8, 0xd8f4ee, 0x8ad8cc) }) },
  { id: 'chlorurus-sordidus', name: 'bullethead parrotfish', sci: 'Chlorurus sordidus', aphia: 219082, ...obis(14821, 0, 20), size: [0.25, 0.4], habit: 'swim', place: 'water', alt: [0.5, 3], group: [2, 7], anim: 'FISH', speed: 0.45, light: 'flee', family: 'fish', w: 4, model: g('fish', { h: 0.17, w: 0.09, caudal: 'round', col: fishCol(0x2f8a74, 0x5cb89c, 0xd07090, 'spots', 0xa8e0c0, 3) }) },
  { id: 'acanthurus-triostegus', name: 'convict surgeonfish', sci: 'Acanthurus triostegus', aphia: 219630, ...obis(8858, 0, 20), size: [0.15, 0.25], habit: 'school', place: 'water', alt: [0.4, 4], group: [12, 40], anim: 'FISH', speed: 0.45, light: 'flee', family: 'fish', w: 4, model: g('fish', { body: 'deep', h: 0.3, w: 0.05, caudal: 'lunate', dorsal: [0.2, 0.8, 0.07], anal: [0.45, 0.8, 0.06], col: fishCol(0xc8d0c0, 0xf2f2ea, 0xb8c0b0, 'bars', 0x141414, 3) }) },
  { id: 'pterois-volitans', name: 'red lionfish', sci: 'Pterois volitans', aphia: 159559, ...obis(2514, 0, 60), size: [0.25, 0.38], habit: 'hover', place: 'water', alt: [0.3, 1.5], group: [1, 2], anim: 'FISH', speed: 0.08, light: 'ignore', family: 'fish', w: 2, model: g('fish', { h: 0.17, w: 0.09, pect: [0.38, 0.9], dorsal: [0.15, 0.6, 0.25], col: fishCol(0xb83a28, 0xf0e0d0, 0xd0a090, 'bars', 0xf4ece0, 7) }) },
  { id: 'carcharhinus-melanopterus', name: 'blacktip reef shark', sci: 'Carcharhinus melanopterus', aphia: 105795, ...obis(159996, 0, 20), size: [1.1, 1.6], habit: 'swim', place: 'water', alt: [0.8, 5], group: [1, 2], anim: 'FISH', speed: 0.9, light: 'curious', family: 'shark', w: 2, model: g('fish', { body: 'shark', h: 0.085, w: 0.075, caudal: 'hetero', caudalH: 0.17, dorsal: [0.3, 0.42, 0.13], dorsal2: [0.72, 0.78, 0.04], anal: [0.74, 0.8, 0.03], pect: [0.2, 0.55], eye: 0.012, col: fishCol(0x7c7a70, 0xf2f2ee, 0x5a584e) }) },
  { id: 'chelonia-mydas', name: 'green turtle', sci: 'Chelonia mydas', aphia: 137206, ...lit(0, 40, 'foraging dives, usually under 40 m (OBIS p5-p95: 0-10)'), size: [0.8, 1.1], habit: 'swim', place: 'water', alt: [0.5, 6], group: [1, 1], anim: 'FLAP', speed: 0.35, light: 'curious', family: 'turtle', w: 2, model: g('turtle') },
  { id: 'octopus-cyanea', name: 'day octopus', sci: 'Octopus cyanea', aphia: 210788, ...obis(147, 0, 20), size: [0.5, 0.8], habit: 'crawl', place: 'rock', anim: 'CEPH', speed: 0.05, light: 'flee', family: 'octopus', w: 2, model: g('ceph', { plan: 'octopus', col: { body: 0x8a5a38, under: 0xc09070, spots: 0xe0c8a0, web: 0x6a4028 } }) },
  { id: 'gymnothorax-javanicus', name: 'giant moray', sci: 'Gymnothorax javanicus', aphia: 217502, ...obis(408, 0, 40), size: [1.5, 2.2], habit: 'crawl', place: 'rock', anim: 'EEL', speed: 0.05, light: 'ignore', family: 'eel', w: 2, model: g('fish', { body: 'elongate', h: 0.055, w: 0.04, dorsal: [0.1, 0.97, 0.025], anal: [0.45, 0.97, 0.02], caudal: 'none', pect: [0, 0], eye: 0.008, jaw: 0.02, col: fishCol(0x6a5a2c, 0x7a6a40, 0x5a4a28, 'spots', 0x16120a, 6) }) },
  { id: 'taeniura-lymma', name: 'bluespotted ribbontail ray', sci: 'Taeniura lymma', aphia: 217422, ...obis(1605, 0, 10), size: [0.5, 0.7], habit: 'crawl', place: 'sand', anim: 'FLAP', speed: 0.08, light: 'flee', family: 'ray', w: 2, model: g('ray', { span: 0.55, disc: 0.55, tail: 0.6, pointed: 0.3, col: { back: 0xb08a50, belly: 0xf0ece0, accent: 0x2a8af0, pattern: 'spots', fin: 0x7a5a30 } }) },
  { id: 'aetobatus-narinari', name: 'spotted eagle ray', sci: 'Aetobatus narinari', aphia: 217426, ...obis(863, 0, 50), size: [1.5, 2.3], habit: 'swim', place: 'water', alt: [1, 6], group: [1, 4], anim: 'FLAP', speed: 0.6, light: 'flee', family: 'ray', w: 2, model: g('ray', { span: 1, disc: 0.42, tail: 1.4, pointed: 1.1, thick: 0.08, col: { back: 0x2a2a30, belly: 0xf4f4f0, accent: 0xf0f0f0, pattern: 'spots', fin: 0x202024 } }) },
  { id: 'diadema-setosum', name: 'long-spined sea urchin', sci: 'Diadema setosum', aphia: 213372, ...obis(208, 0, 30), size: [0.3, 0.45], habit: 'crawl', place: 'rock', anim: 'STILL', speed: 0.004, light: 'ignore', family: 'sea urchin', group: [2, 8], w: 3, model: g('urchin', { test: 0.15, spines: 90, spineL: 0.42, col: { test: 0x1a1018, spine: 0x0c0a0c, tip: 0x202028 } }) },
  { id: 'holothuria-atra', name: 'black sea cucumber', sci: 'Holothuria atra', aphia: 1672768, ...obis(2002, 0, 20), size: [0.25, 0.45], habit: 'crawl', place: 'sand', anim: 'CRAWL', speed: 0.004, light: 'ignore', family: 'sea cucumber', group: [1, 5], w: 3, model: g('cucumber', { plan: 'holothuria' }) },
  { id: 'linckia-laevigata', name: 'blue sea star', sci: 'Linckia laevigata', aphia: 207610, ...obis(405, 0, 30), size: [0.2, 0.3], habit: 'crawl', place: 'any', anim: 'ARMS', speed: 0.004, light: 'ignore', family: 'sea star', w: 3, model: g('star', { arms: 5, disc: 0.06, taper: 0.25, thick: 0.05, col: { top: 0x2a62d8, under: 0x6a90e0, tip: 0x3a72e8, spots: 0x2050c0 } }) },
  // twilight zone
  { id: 'myctophum-punctatum', name: 'spotted lanternfish', sci: 'Myctophum punctatum', aphia: 126627, ...lit(100, 1000, 'FishBase: day depth 225-750 m, near the surface at night (OBIS p5-p95: 0-2000)'), size: [0.07, 0.11], habit: 'school', place: 'water', alt: [3, 30], group: [40, 140], anim: 'FISH', speed: 0.4, light: 'attract', family: 'fish', w: 6, glow: { colour: 0x4aa8ff, k: 0.8, halo: 0.6 }, model: g('fish', { h: 0.12, w: 0.06, eye: 0.05, col: fishCol(0x283848, 0xb8c4cc, 0x506070), glow: { rows: 2, colour: 0x4aa8ff, k: 1, per: 14 } }) },
  { id: 'argyropelecus-aculeatus', name: 'lovely hatchetfish', sci: 'Argyropelecus aculeatus', aphia: 127306, ...obis(1775, 60, 3000), size: [0.05, 0.08], habit: 'school', place: 'water', alt: [3, 30], group: [12, 40], anim: 'FISH', speed: 0.25, light: 'ignore', family: 'fish', w: 5, glow: { colour: 0x5ab0ff, k: 0.9, halo: 0.5 }, model: g('fish', { body: 'hatchet', h: 0.24, w: 0.04, eye: 0.06, dorsal: [0.45, 0.6, 0.05], col: fishCol(0x3a4250, 0xdfe6ee, 0x9aa4b0), glow: { rows: 2, colour: 0x5ab0ff, k: 1.2, per: 12 } }) },
  { id: 'chauliodus-sloani', name: "Sloane's viperfish", sci: 'Chauliodus sloani', aphia: 127338, ...obis(6949, 120, 2000), size: [0.22, 0.35], habit: 'hover', place: 'water', alt: [2, 25], group: [1, 1], anim: 'EEL', speed: 0.15, light: 'ignore', family: 'fish', w: 3, glow: { colour: 0x50a0ff, k: 1, halo: 0.6 }, model: g('fish', { body: 'elongate', h: 0.07, w: 0.04, jaw: 0.08, eye: 0.03, barbel: 0.18, dorsal: [0.12, 0.2, 0.12], anal: [0.85, 0.92, 0.04], caudal: 'forked', caudalH: 0.06, col: fishCol(0x182028, 0x30404c, 0x203040), glow: { rows: 2, colour: 0x50a0ff, k: 1, per: 22 } }) },
  { id: 'xiphias-gladius', name: 'swordfish', sci: 'Xiphias gladius', aphia: 127094, ...lit(0, 800, 'FishBase: 0-550 m, dives to 2878 m (OBIS p5-p95: 0-3000)'), size: [2, 3], habit: 'swim', place: 'water', alt: [4, 30], group: [1, 1], anim: 'FISH', speed: 1.4, light: 'curious', family: 'fish', w: 1, model: g('fish', { h: 0.08, w: 0.07, sword: 0.42, caudal: 'lunate', caudalH: 0.22, dorsal: [0.18, 0.28, 0.12], pect: [0.12, 0.6], col: fishCol(0x3a3048, 0xb0a8b8, 0x2a2438) }) },
  { id: 'nanomia-bijuga', name: 'siphonophore', sci: 'Nanomia bijuga', aphia: 135495, ...obis(5720, 30, 500), size: [0.5, 1.0], habit: 'drift', place: 'water', alt: [2, 30], group: [1, 6], anim: 'DRIFT', speed: 0.06, light: 'ignore', family: 'siphonophore', w: 4, gel: true, glow: { colour: 0x60c0ff, k: 0.4, halo: 0.3 }, model: g('sipho', { glow: { colour: 0x60c0ff, k: 0.5 } }) },
  { id: 'bolinopsis-infundibulum', name: 'common northern comb jelly', sci: 'Bolinopsis infundibulum', aphia: 106393, ...obis(151, 0, 130), size: [0.08, 0.15], habit: 'drift', place: 'water', alt: [1, 20], group: [2, 12], anim: 'DRIFT', speed: 0.02, light: 'ignore', family: 'comb jelly', w: 3, gel: true, model: g('cteno', { form: 'lobate' }) },
  { id: 'beroe-forskalii', name: 'Forskal comb jelly', sci: 'Beroe forskalii', aphia: 106360, ...obis(179, 0, 500), size: [0.08, 0.15], habit: 'drift', place: 'water', alt: [1, 20], group: [1, 6], anim: 'DRIFT', speed: 0.03, light: 'ignore', family: 'comb jelly', w: 3, gel: true, model: g('cteno', { form: 'beroe', col: { body: 0xf0c8d0 } }) },
  { id: 'periphylla-periphylla', name: 'helmet jellyfish', sci: 'Periphylla periphylla', aphia: 135294, ...obis(1455, 100, 2000), size: [0.15, 0.3], habit: 'drift', place: 'water', alt: [2, 30], group: [1, 4], anim: 'BELL', speed: 0.03, light: 'flee', family: 'jellyfish', w: 4, gel: true, glow: { colour: 0x3c8cff, k: 0.9, halo: 0.8 }, model: g('medusa', { form: 'helmet', tentacles: 12, tentL: 0.9, arms: 0, col: { bell: 0xb03a30, rim: 0x6a1a18, gut: 0x4a0c10 }, glow: { colour: 0x3c8cff, k: 1 } }) },
  { id: 'dosidicus-gigas', name: 'Humboldt squid', sci: 'Dosidicus gigas', aphia: 342291, ...lit(200, 1200, 'day depth 200-1200 m, Gilly et al. 2006 (OBIS 43 records: 10-400)'), size: [0.8, 1.5], habit: 'school', place: 'water', alt: [3, 25], group: [6, 24], anim: 'CEPH', speed: 0.8, light: 'curious', family: 'squid', w: 3, model: g('ceph', { plan: 'squid', col: { body: 0xb02a20, under: 0xe08070, spots: 0xf0b0a0 } }) },
  { id: 'histioteuthis-heteropsis', name: 'jewel squid', sci: 'Histioteuthis heteropsis', aphia: 341868, ...obis(21, 110, 800), size: [0.2, 0.3], habit: 'hover', place: 'water', alt: [2, 25], group: [1, 3], anim: 'CEPH', speed: 0.08, light: 'ignore', family: 'squid', w: 3, glow: { colour: 0x6ab0ff, k: 1, halo: 0.6 }, model: g('ceph', { plan: 'squid', mantle: [0.42, 0.11], armL: 0.4, web: 0.25, fins: 0.4, col: { body: 0xa02028, under: 0xc04048, spots: 0xe0a0a8 }, glow: { colour: 0x6ab0ff, k: 1, spots: 0.25 } }) },
  { id: 'chimaera-monstrosa', name: 'rabbit fish (chimaera)', sci: 'Chimaera monstrosa', aphia: 105824, ...obis(15244, 140, 500), size: [0.7, 1.1], habit: 'hover', place: 'water', alt: [0.4, 3], group: [1, 3], anim: 'FLAP', speed: 0.25, light: 'curious', family: 'chimaera', w: 3, model: g('fish', { body: 'tadpole', h: 0.1, w: 0.07, eye: 0.035, pect: [0.32, 0.25], dorsal: [0.18, 0.26, 0.14], dorsal2: [0.3, 0.92, 0.03], caudal: 'point', anal: null, col: fishCol(0x8a7058, 0xd8d0c4, 0x6a5848, 'spots', 0xb0a090, 2) }) },
  { id: 'chaceon-quinquedens', name: 'red deep-sea crab', sci: 'Chaceon quinquedens', aphia: 158407, ...obis(1412, 70, 1000), size: [0.3, 0.45], habit: 'crawl', place: 'any', anim: 'WALK', speed: 0.05, light: 'attract', family: 'crab', group: [1, 6], w: 4, model: g('crab', { col: { top: 0xc04020, under: 0xf0c0a0, leg: 0xd05030, claw: 0xc84020, tip: 0x401010 } }) },
  { id: 'ophiura-ljungmani', name: 'deep brittle star', sci: 'Ophiura ljungmani', aphia: 124925, ...obis(906, 200, 4000), size: [0.06, 0.1], habit: 'crawl', place: 'sand', anim: 'ARMS', speed: 0.01, light: 'ignore', family: 'brittle star', group: [8, 40], w: 5, model: g('brittle', { armR: 0.02, col: { top: 0xb8a890, under: 0xe0d8c8, band: 0x8a7a60 } }) },
  { id: 'bathynomus-giganteus', name: 'giant isopod', sci: 'Bathynomus giganteus', aphia: 259252, ...obis(810, 400, 900), size: [0.25, 0.4], habit: 'crawl', place: 'any', anim: 'WALK', speed: 0.03, light: 'attract', family: 'isopod', group: [1, 3], w: 3, model: g('isopod', { plan: 'isopod' }) },
  { id: 'myxine-glutinosa', name: 'Atlantic hagfish', sci: 'Myxine glutinosa', aphia: 101170, ...obis(10523, 30, 400), size: [0.35, 0.6], habit: 'crawl', place: 'fall', anim: 'EEL', speed: 0.08, light: 'ignore', family: 'hagfish', group: [2, 10], w: 2, model: g('fish', { body: 'elongate', h: 0.05, w: 0.04, dorsal: [0.7, 0.97, 0.015], anal: [0.6, 0.97, 0.015], caudal: 'none', pect: [0, 0], eye: 0, col: fishCol(0xb08880, 0xd0b0a8, 0xa07870) }) },
  // the abyss and the trenches
  { id: 'melanocetus-johnsonii', name: 'humpback anglerfish', sci: 'Melanocetus johnsonii', aphia: 126556, ...lit(200, 3000, 'FishBase (OBIS p5-p95: 10-3000)'), size: [0.1, 0.18], habit: 'hover', place: 'water', alt: [1, 20], group: [1, 1], anim: 'FISH', speed: 0.04, light: 'ignore', family: 'anglerfish', w: 3, glow: { colour: 0x60e0ff, k: 1.2, halo: 1 }, model: g('fish', { body: 'globose', h: 0.32, w: 0.24, head: 1.2, jaw: 0.12, lure: 0.32, eye: 0.018, caudal: 'round', dorsal: [0.62, 0.74, 0.05], col: fishCol(0x0c0c0e, 0x18161a, 0x141216), lureColour: 0x60e0ff }) },
  { id: 'eurypharynx-pelecanoides', name: 'gulper eel', sci: 'Eurypharynx pelecanoides', aphia: 127165, ...lit(500, 3000, 'FishBase: 500-3000 m (OBIS p5-p95: 80-3000)'), size: [0.5, 0.75], habit: 'hover', place: 'water', alt: [2, 25], group: [1, 1], anim: 'EEL', speed: 0.06, light: 'ignore', family: 'eel', w: 2, glow: { colour: 0xff6aa0, k: 0.8, halo: 0.4 }, model: g('fish', { body: 'elongate', h: 0.035, w: 0.025, head: 3.4, jaw: 0.2, eye: 0.006, dorsal: [0.2, 0.95, 0.01], anal: [0.3, 0.95, 0.008], caudal: 'none', pect: [0, 0], col: fishCol(0x0a0a0c, 0x141418, 0x0c0c10), lure: 0, barbel: 0 }) },
  { id: 'grimpoteuthis', name: 'dumbo octopus', sci: 'Grimpoteuthis sp.', aphia: 138293, ...obis(792, 3000, 6000), size: [0.2, 0.3], habit: 'hover', place: 'water', alt: [0.5, 4], group: [1, 1], anim: 'CEPH', speed: 0.05, light: 'ignore', family: 'octopus', w: 3, model: g('ceph', { plan: 'dumbo', col: { body: 0xf0a080, under: 0xf8c8b0, spots: 0xffe0d0, web: 0xe08070 } }) },
  { id: 'enypniastes-eximia', name: 'swimming sea cucumber', sci: 'Enypniastes eximia', aphia: 124759, ...obis(1562, 1000, 6000), size: [0.15, 0.25], habit: 'drift', place: 'water', alt: [0.5, 8], group: [1, 4], anim: 'CRAWL', speed: 0.03, light: 'ignore', family: 'sea cucumber', w: 4, gel: true, glow: { colour: 0x6ac0ff, k: 0.6, halo: 0.4 }, model: g('cucumber', { plan: 'enypniastes', glow: { colour: 0x6ac0ff, k: 0.6 } }) },
  { id: 'bathypterois-grallator', name: 'tripod fish', sci: 'Bathypterois grallator', aphia: 126343, ...obis(58, 800, 4000), size: [0.25, 0.35], habit: 'still', place: 'sand', anim: 'STILL', light: 'ignore', family: 'fish', group: [1, 1], w: 3, model: g('fish', { h: 0.08, w: 0.06, rays: 0.32, eye: 0.012, col: fishCol(0x2a2c30, 0x3a3c40, 0x202226) }) },
  { id: 'coryphaenoides-armatus', name: 'abyssal grenadier', sci: 'Coryphaenoides armatus', aphia: 158952, ...obis(359, 800, 5000), size: [0.6, 0.9], habit: 'hover', place: 'water', alt: [0.3, 3], group: [1, 4], anim: 'EEL', speed: 0.2, light: 'curious', family: 'fish', w: 4, model: g('fish', { body: 'tadpole', h: 0.11, w: 0.08, eye: 0.03, dorsal: [0.18, 0.26, 0.1], dorsal2: [0.35, 0.98, 0.02], anal: [0.32, 0.98, 0.025], caudal: 'point', col: fishCol(0x5a5048, 0x8a8078, 0x4a4038) }) },
  { id: 'vampyroteuthis-infernalis', name: 'vampire squid', sci: 'Vampyroteuthis infernalis', aphia: 141887, ...obis(362, 500, 3000), size: [0.2, 0.3], habit: 'hover', place: 'water', alt: [1, 15], group: [1, 1], anim: 'CEPH', speed: 0.05, light: 'flee', family: 'cephalopod', w: 3, glow: { colour: 0x50b0ff, k: 1, halo: 0.8 }, model: g('ceph', { plan: 'vampire', col: { body: 0x3a0c14, under: 0x5a1820, spots: 0x6a2028, web: 0x200608 }, glow: { colour: 0x50b0ff, k: 1 } }) },
  { id: 'atolla-wyvillei', name: 'Atolla jellyfish', sci: 'Atolla wyvillei', aphia: 135282, ...lit(500, 3000, 'mostly 500-3000 m (OBIS p5-p95: 50-3000)'), size: [0.1, 0.17], habit: 'drift', place: 'water', alt: [1, 25], group: [1, 3], anim: 'BELL', speed: 0.03, light: 'flee', family: 'jellyfish', w: 4, gel: true, glow: { colour: 0x3a7cff, k: 1.3, halo: 1.2 }, model: g('medusa', { form: 'crown', tentacles: 22, tentL: 0.5, arms: 0, col: { bell: 0xa02818, rim: 0x701810, gut: 0x500808 }, glow: { colour: 0x3a7cff, k: 1.2 } }) },
  { id: 'psychropotes-longicauda', name: 'gummy squirrel (sea cucumber)', sci: 'Psychropotes longicauda', aphia: 124778, ...obis(5315, 4000, 5000), size: [0.4, 0.6], habit: 'crawl', place: 'sand', anim: 'CRAWL', speed: 0.004, light: 'ignore', family: 'sea cucumber', group: [1, 4], w: 4, model: g('cucumber', { plan: 'psychropotes' }) },
  { id: 'scotoplanes-globosa', name: 'sea pig', sci: 'Scotoplanes globosa', aphia: 148773, ...obis(189, 500, 7000), size: [0.1, 0.16], habit: 'crawl', place: 'sand', anim: 'WALK', speed: 0.01, light: 'ignore', family: 'sea cucumber', group: [5, 30], w: 5, model: g('cucumber', { plan: 'scotoplanes' }) },
  { id: 'freyella-elegans', name: 'brisingid sea star', sci: 'Freyella elegans', aphia: 123692, ...obis(179, 1000, 5000), size: [0.35, 0.6], habit: 'still', place: 'rock', anim: 'ARMS', light: 'ignore', family: 'sea star', w: 3, model: g('star', { arms: 14, disc: 0.05, taper: 0.9, thick: 0.025, wavy: 0.3, col: { top: 0xe89070, under: 0xf0c0a8, tip: 0xf0a888, spots: 0xffd8c8 } }) },
  { id: 'kiwa-hirsuta', name: 'yeti crab', sci: 'Kiwa hirsuta', aphia: 249751, ...lit(2200, 2400, 'Macpherson et al. 2005, Pacific-Antarctic Ridge vents'), size: [0.12, 0.16], habit: 'crawl', place: 'vent', anim: 'WALK', speed: 0.02, light: 'ignore', family: 'squat lobster', group: [3, 12], w: 4, model: g('shrimp', { plan: 'squat' }) },
  { id: 'riftia-pachyptila', name: 'giant tube worm', sci: 'Riftia pachyptila', aphia: 266010, ...obis(165, 2000, 3000), size: [1.2, 2], habit: 'still', place: 'vent', anim: 'STILL', light: 'ignore', family: 'tube worm', group: [1, 3], w: 5, model: g('tubeworm', { tubes: 26 }) },
  { id: 'bathymodiolus-thermophilus', name: 'vent mussel bed', sci: 'Bathymodiolus thermophilus', aphia: 183000, ...obis(119, 2000, 3000), size: [1, 1.8], habit: 'still', place: 'vent', anim: 'STILL', light: 'ignore', family: 'bivalve', group: [1, 3], w: 5, model: g('mussel', { n: 46 }) },
  { id: 'osedax-rubiplumus', name: 'whale fall (bone-eating Osedax worms)', sci: 'Osedax rubiplumus', aphia: 265981, ...obis(6, 700, 3000), size: [9, 14], habit: 'still', place: 'fall', anim: 'STILL', light: 'ignore', family: 'whale fall', group: [1, 1], w: 0, model: g('whalefall') },
  { id: 'hirondellea-gigas', name: 'hadal amphipod', sci: 'Hirondellea gigas', aphia: 428677, ...lit(6000, 10900, 'Mariana and Philippine trenches (Ritchie et al. 2015)'), size: [0.04, 0.06], habit: 'school', place: 'water', alt: [0.2, 2], group: [20, 80], anim: 'WALK', speed: 0.1, light: 'attract', family: 'amphipod', w: 5, model: g('isopod', { plan: 'amphipod' }) },
  { id: 'pseudoliparis-swirei', name: 'Mariana snailfish', sci: 'Pseudoliparis swirei', aphia: 1047485, ...lit(6198, 8076, 'Gerringer et al. 2017 (OBIS 2 records)'), size: [0.2, 0.28], habit: 'hover', place: 'water', alt: [0.3, 3], group: [1, 6], anim: 'EEL', speed: 0.08, light: 'curious', family: 'fish', w: 4, gel: true, model: g('fish', { body: 'tadpole', h: 0.14, w: 0.1, eye: 0.012, dorsal: [0.35, 0.95, 0.04], anal: [0.4, 0.95, 0.035], caudal: 'round', caudalH: 0.05, col: fishCol(0xf0c8c8, 0xf8e0e0, 0xf4d4d4) }) },
].map(s => Object.assign({ src: 'procedural', group: [1, 1], light: 'ignore' }, s, { anim: ANIM[s.anim] }));

export const SPECIES = [...SCANS, ...PROC];
export const SPECIES_BY_ID = new Map(SPECIES.map(s => [s.id, s]));

// ── features: the aggregations and landmarks (the coordinator, 2026-10-18:
// "brittle-star and sea-star fields on the sediment, ... crab and amphipod
// swarms at food falls (a whale fall is a good landmark), squid and
// siphonophore curtains in the water column, giant isopods, chimaeras,
// tripod-fish lines, tube-worm and mussel beds at seeps or vents") ───────────
//  chance: per chunk; members: [species id, count [min, max]]; the members
//  outside their depth at the site are left out.
export const FEATURES = [
  { id: 'reef-cloud', name: 'a cloud of reef fish', depth: [0, 40], chance: 0.35, members: [['chromis-viridis', [30, 70]], ['caesio-teres', [30, 60]], ['acanthurus-triostegus', [10, 30]]] },
  { id: 'sand-flat', name: 'rays and cucumbers on a sand flat', depth: [0, 40], chance: 0.18, members: [['taeniura-lymma', [1, 3]], ['holothuria-atra', [3, 8]], ['rotula-deciesdigitata', [6, 16]], ['ovalipes-ocellatus', [2, 5]]] },
  { id: 'star-field', name: 'a sea-star field', depth: [0, 3000], chance: 0.12, members: [['generated:star', [8, 22]], ['pycnopodia-helianthoides', [2, 6]], ['goniaster-tessellatus', [3, 8]], ['myxaster-sol', [3, 8]]] },
  { id: 'brittle-field', name: 'a brittle-star field', depth: [200, 6000], chance: 0.28, members: [['ophiura-ljungmani', [40, 110]], ['generated:brittle', [20, 60]]] },
  { id: 'sponge-garden', name: 'a glass-sponge garden', depth: [100, 3000], chance: 0.16, members: [['staurocalyptus-tylotus', [3, 8]], ['acanthascus-koltuni', [3, 8]], ['tretodictyum-amchitkensis', [3, 8]], ['generated:crab', [2, 6]], ['generated:shrimp', [4, 12]]] },
  { id: 'squid-curtain', name: 'a squid curtain', depth: [200, 1200], chance: 0.12, members: [['dosidicus-gigas', [14, 30]], ['generated:squid', [10, 24]]] },
  { id: 'sipho-curtain', name: 'a siphonophore curtain', depth: [30, 3000], chance: 0.14, members: [['nanomia-bijuga', [6, 14]], ['generated:sipho', [6, 14]], ['generated:jelly', [4, 10]]] },
  { id: 'lantern-layer', name: 'a deep scattering layer of lanternfish', depth: [100, 1000], chance: 0.3, members: [['myctophum-punctatum', [80, 160]], ['argyropelecus-aculeatus', [20, 50]]] },
  { id: 'tripod-line', name: 'a line of tripod fish', depth: [800, 4000], chance: 0.22, members: [['bathypterois-grallator', [5, 14]]] },
  { id: 'cucumber-herd', name: 'a herd of sea pigs', depth: [500, 7000], chance: 0.2, members: [['scotoplanes-globosa', [20, 60]], ['psychropotes-longicauda', [2, 6]], ['generated:cucumber', [6, 16]]] },
  { id: 'isopod-patrol', name: 'giant isopods and chimaeras', depth: [140, 1000], chance: 0.14, members: [['bathynomus-giganteus', [3, 8]], ['chimaera-monstrosa', [2, 5]], ['chaceon-quinquedens', [6, 16]]] },
  { id: 'whale-fall', name: 'a whale fall', depth: [300, 4000], chance: 0.035, landmark: 'osedax-rubiplumus', members: [['myxine-glutinosa', [6, 16]], ['chaceon-quinquedens', [8, 20]], ['bathynomus-giganteus', [2, 6]], ['generated:amphipod', [40, 90]], ['scotoplanes-globosa', [6, 14]], ['coryphaenoides-armatus', [3, 8]]] },
  { id: 'vent-field', name: 'a hydrothermal vent field', depth: [1500, 4000], chance: 0.05, landmark: 'riftia-pachyptila', members: [['riftia-pachyptila', [4, 9]], ['bathymodiolus-thermophilus', [3, 7]], ['kiwa-hirsuta', [8, 20]], ['branchinotogluma-hessleri', [6, 14]], ['levensteiniella-kincaidi', [6, 14]], ['photinopolynoe-burkensis', [4, 10]], ['branchipolynoe-seepensis', [4, 10]], ['generated:crab', [4, 10]]] },
  { id: 'trench-swarm', name: 'a swarm of hadal amphipods', depth: [6000, 11000], chance: 0.45, members: [['hirondellea-gigas', [60, 140]], ['pseudoliparis-swirei', [3, 9]]] },
  { id: 'jelly-bloom', name: 'a bloom of deep jellies', depth: [100, 4000], chance: 0.14, members: [['atolla-wyvillei', [4, 10]], ['periphylla-periphylla', [4, 10]], ['generated:jelly', [6, 16]]] },
];

// ── generated species ───────────────────────────────────────────────────────
// A province (a square of PROVINCE m) has its own made-up species: the
// same seed and province give the same species. More of them deeper (the
// user: variety "must increase with depth").
export const PROVINCE = 1024;
export const GEN_FAMILIES = ['star', 'brittle', 'urchin', 'cucumber', 'crab', 'shrimp', 'isopod', 'amphipod', 'jelly', 'sipho', 'squid', 'octopus', 'fish'];
const PER_REGION = { shallows: 3, reef: 4, twilight: 30, abyss: 48 };

function rngOf(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hashInts(...v) { let h = 0x811c9dc5; for (const x of v) { h ^= x | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 13; } return h >>> 0; }

// colours by depth: bright and varied in the light, red, black, white or
// see-through in the dark (red light is gone there, so red animals are dark)
function palette(R, region) {
  const pick = a => a[Math.floor(R() * a.length)];
  if (region === 'shallows' || region === 'reef') return pick([[0xd84a30, 0xf0d0b0], [0x2a70d8, 0xd8e4f0], [0xe0a020, 0xf8ecc0], [0x6a3a8a, 0xd0b8e0], [0x30a070, 0xd0f0e0], [0xc83878, 0xf0c0d8]]);
  if (region === 'twilight') return pick([[0xa02820, 0xd07060], [0x6a1418, 0xa04040], [0x8a8f9a, 0xe0e4ea], [0xc04030, 0xe8a088], [0x302830, 0x605058]]);
  return pick([[0x700c10, 0x9a2a2a], [0x101012, 0x2a2a30], [0xe8e0d8, 0xf8f0ea], [0xd09080, 0xf0c8b8], [0x8a1a20, 0xc05050], [0xe0b8c0, 0xf4dce0]]);
}
const hexName = n => (n >>> 0).toString(16).toUpperCase().padStart(6, '0').slice(-4);

function genOne(family, R, region, depth, code) {
  const [c1, c2] = palette(R, region), deep = region === 'twilight' || region === 'abyss';
  const glow = deep && R() < (region === 'abyss' ? 0.6 : 0.4) ? { colour: [0x3a90ff, 0x50c0ff, 0x40ffd0, 0x7a6aff][Math.floor(R() * 4)], k: 0.6 + R() * 0.8 } : null;
  const base = { src: 'generated', family, depth, depthRef: 'generated for this province', light: deep ? (R() < 0.4 ? 'attract' : 'ignore') : 'flee', group: [1, 1] };
  const L = (a, b) => a + (b - a) * R();
  const name = (k) => `generated ${k} ${code}`;
  switch (family) {
    case 'star': return Object.assign(base, { name: name('sea star'), size: [L(0.12, 0.3), L(0.3, 0.6)], habit: 'crawl', place: 'any', anim: ANIM.ARMS, speed: 0.004, group: [1, 4], model: g('star', { arms: R() < 0.6 ? 5 : 6 + Math.floor(R() * 16), disc: L(0.06, 0.2), taper: L(0.3, 0.95), thick: L(0.03, 0.09), wavy: L(0, 0.3), col: { top: c1, under: c2, tip: c1, spots: c2 } }) });
    case 'brittle': return Object.assign(base, { name: name('brittle star'), size: [0.06, L(0.1, 0.25)], habit: 'crawl', place: R() < 0.3 ? 'coral' : 'sand', anim: ANIM.ARMS, speed: 0.01, group: [4, 20], model: g('brittle', { arms: 5, disc: L(0.05, 0.1), armR: L(0.012, 0.025), col: { top: c1, under: c2, band: c2 } }) });
    case 'urchin': return Object.assign(base, { name: name('sea urchin'), size: [0.08, L(0.12, 0.3)], habit: 'crawl', place: 'any', anim: ANIM.STILL, speed: 0.002, group: [1, 8], model: g('urchin', { test: L(0.15, 0.3), spines: 40 + Math.floor(R() * 60), spineL: L(0.08, 0.4), flat: L(0.5, 0.9), col: { test: c1, spine: c2, tip: c1 } }) });
    case 'cucumber': return Object.assign(base, { name: name('sea cucumber'), size: [0.1, L(0.2, 0.5)], habit: 'crawl', place: 'sand', anim: deep && R() < 0.4 ? ANIM.WALK : ANIM.CRAWL, speed: 0.005, group: [2, 12], model: g('cucumber', { plan: deep ? ['scotoplanes', 'psychropotes', 'holothuria'][Math.floor(R() * 3)] : 'holothuria', col: { body: c1, under: c2, pap: c2 }, glow }) });
    case 'crab': return Object.assign(base, { name: name('crab'), size: [0.08, L(0.15, 0.35)], habit: 'crawl', place: 'any', anim: ANIM.WALK, speed: 0.05, group: [1, 6], model: g('crab', { carapace: [L(0.4, 0.6), L(0.3, 0.5), L(0.12, 0.2)], legL: L(0.35, 0.8), claw: L(0.25, 0.5), hairy: region === 'abyss' && R() < 0.3, col: { top: c1, under: c2, leg: c1, claw: c1, tip: 0x201010 } }) });
    case 'shrimp': return Object.assign(base, { name: name('shrimp'), size: [0.05, L(0.08, 0.2)], habit: R() < 0.5 ? 'crawl' : 'school', place: 'any', alt: [0.2, 3], anim: ANIM.WALK, speed: 0.06, group: [3, 20], model: g('shrimp', { plan: 'shrimp', antennaL: L(0.6, 1.6), col: { top: c1, under: c2, leg: c1 }, glow }) });
    case 'isopod': return Object.assign(base, { name: name('isopod'), size: [0.05, L(0.1, 0.3)], habit: 'crawl', place: 'any', anim: ANIM.WALK, speed: 0.02, group: [1, 6], model: g('isopod', { plan: 'isopod', w: L(0.3, 0.5), col: { top: c2, under: c1, leg: c2 } }) });
    case 'amphipod': return Object.assign(base, { name: name('amphipod'), size: [0.02, L(0.04, 0.08)], habit: 'school', place: 'water', alt: [0.2, 2], anim: ANIM.WALK, speed: 0.1, group: [20, 60], light: 'attract', model: g('isopod', { plan: 'amphipod', col: { top: c2, under: c1, leg: c2 } }) });
    case 'jelly': return Object.assign(base, { name: name('jellyfish'), size: [0.05, L(0.1, 0.4)], habit: 'drift', place: 'water', alt: [1, 25], anim: ANIM.BELL, speed: 0.03, group: [1, 6], gel: true, glow: glow && { ...glow, halo: 0.8 }, model: g('medusa', { form: ['bell', 'helmet', 'crown'][Math.floor(R() * 3)], tentacles: 8 + Math.floor(R() * 24), tentL: L(0.5, 2.5), arms: Math.floor(R() * 5), col: { bell: c2, rim: c1, gut: c1 }, glow }) });
    case 'sipho': return Object.assign(base, { name: name('siphonophore'), size: [0.3, L(0.6, 2)], habit: 'drift', place: 'water', alt: [2, 25], anim: ANIM.DRIFT, speed: 0.05, group: [1, 4], gel: true, glow: glow && { ...glow, halo: 0.4 }, model: g('sipho', { bells: 4 + Math.floor(R() * 10), stemL: L(0.5, 0.8), col: { body: c2, float: c1, tent: c1 }, glow }) });
    case 'squid': return Object.assign(base, { name: name('squid'), size: [0.1, L(0.2, 0.7)], habit: R() < 0.5 ? 'school' : 'hover', place: 'water', alt: [2, 20], anim: ANIM.CEPH, speed: 0.4, group: [1, 12], glow: glow && { ...glow, halo: 0.5 }, model: g('ceph', { plan: 'squid', mantle: [L(0.4, 0.65), L(0.05, 0.11)], fins: L(0.2, 0.7), col: { body: c1, under: c2, spots: c2 }, glow: glow && { ...glow, spots: L(0, 0.3) } }) });
    case 'octopus': return Object.assign(base, { name: name('octopus'), size: [0.1, L(0.2, 0.6)], habit: deep && R() < 0.5 ? 'hover' : 'crawl', place: deep ? 'water' : 'rock', alt: [0.3, 3], anim: ANIM.CEPH, speed: 0.04, model: g('ceph', { plan: deep && R() < 0.6 ? 'dumbo' : 'octopus', web: L(0.1, 0.9), col: { body: c1, under: c2, spots: c2, web: c1 }, glow: glow && { ...glow, spots: L(0, 0.2) } }) });
    case 'fish': default: {
      const body = deep ? ['fusiform', 'elongate', 'tadpole', 'hatchet', 'globose'][Math.floor(R() * 5)] : ['fusiform', 'deep', 'fusiform'][Math.floor(R() * 3)];
      return Object.assign(base, { name: name('fish'), family: 'fish', size: [0.05, L(0.1, 0.6)], habit: R() < 0.5 ? 'school' : 'hover', place: 'water', alt: [0.5, 15], anim: body === 'elongate' || body === 'tadpole' ? ANIM.EEL : ANIM.FISH, speed: 0.3, group: [1, 30], glow: glow && { ...glow, halo: 0.5 },
        model: g('fish', { body, h: L(0.07, 0.25), w: L(0.04, 0.09), eye: deep ? L(0.01, 0.06) : L(0.02, 0.035), jaw: deep && R() < 0.4 ? L(0.04, 0.12) : 0, lure: deep && body === 'globose' ? L(0.15, 0.35) : 0, barbel: deep && body === 'elongate' && R() < 0.5 ? L(0.1, 0.3) : 0, caudal: ['forked', 'round', 'lunate', 'point'][Math.floor(R() * 4)],
          col: { back: c1, belly: c2, fin: c1, pattern: deep ? 'plain' : ['plain', 'bars', 'stripes', 'spots', 'band'][Math.floor(R() * 5)], accent: c2, n: 2 + Math.floor(R() * 5) }, glow: glow && { rows: 1 + Math.floor(R() * 3), colour: glow.colour, k: glow.k }, lureColour: glow ? glow.colour : 0x60e0ff }) });
    }
  }
}

// The generated species of one province at one region: deterministic.
export function generatedSpecies(seed, px, pz, region) {
  const R = rngOf(hashInts(seed, px, pz, REGIONS.findIndex(r => r.id === region) + 17));
  const n = PER_REGION[region] || 4, out = [];
  const reg = REGIONS.find(r => r.id === region);
  for (let i = 0; i < n; i++) {
    const fam = GEN_FAMILIES[Math.floor(R() * GEN_FAMILIES.length)];
    // a depth band inside the region (generated animals keep to their band)
    // (the abyss bands stop at 6500 m: the world has few deeper places, and
    // the hadal animals there are the real ones of SPECIES)
    // a band in log depth (the life of the deep sea changes with log depth)
    const a = Math.max(1, reg.depth[0]), b = Math.min(reg.depth[1], 6500), la = Math.log(a), lb = Math.log(b);
    const c = la + (lb - la) * R(), w = (lb - la) * (0.35 + 0.4 * R());
    const lo = Math.exp(Math.max(la, c - w)), hi = Math.exp(Math.min(lb, c + w));
    const code = hexName(hashInts(seed, px, pz, i, 99));
    const sp = genOne(fam, R, region, [Math.round(lo), Math.round(hi)], code);
    sp.id = `gen-${region}-${px}-${pz}-${i}`;
    sp.sci = null;
    sp.w = 3;
    if (sp.habit === 'school' && sp.group[1] < 6) sp.group = [6, 24];
    out.push(sp);
  }
  // the deep regions also get one of each family that the features ask for
  if (region === 'twilight' || region === 'abyss') for (const fam of ['star', 'brittle', 'crab', 'shrimp', 'amphipod', 'jelly', 'sipho', 'squid', 'cucumber']) {
    if (out.some(s => s.family === fam || s.name.includes(fam))) continue;
    const a = reg.depth[0], b = Math.min(reg.depth[1], 6500), code = hexName(hashInts(seed, px, pz, fam.length, 7));
    const sp = genOne(fam, R, region, [a, b], code);
    sp.id = `gen-${region}-${px}-${pz}-${fam}`; sp.sci = null; sp.w = 1; sp.family = fam;
    out.push(sp);
  }
  return out;
}
