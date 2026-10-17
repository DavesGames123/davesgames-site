// The source list of the nature pack: which real models go in, what
// kind they are, which biomes they belong to, and how to build them.
// build.mjs reads this file. Biome keys are snake case forms of the
// lib/dla-terrain.js BIOMES names (temperate forest -> temperate_forest).
//
// Fields:
//   from     'polyhaven' (CC0, https://polyhaven.com/license)
//   src      source asset id at the source
//   kind     manifest kind (tree, bush, rock, boulder, cliff, grass,
//            flower, fern, log, stump, mushroom, reed, cactus, succulent,
//            ground cover)
//   sub      free text sub kind (conifer, broadleaf, dead, sapling, ...)
//   biomes   biome keys where VEG may scatter it
//   variants 'nodes' = each top level object of the source is its own
//            asset (Poly Haven sheets show 2 to 6 variants in a row);
//            'one' = the whole source is one asset
//   pick     optional list of variant indices to keep (after sort by x)
//   lods     triangle targets for LOD 0, 1, 2 (upper limits)
//   impostor true = bake an impostor atlas for the far LOD
//   default  true = in the default-view subset (the 40 MB budget)
//   wind     0 rigid .. 1 very flexible (a hint for VEG sway)
//   crownNormals [k, y0]: above y0 (share of height) blend foliage normals
//            toward a crown ellipsoid by k
//   gain     colour scale for dark game textures (prep.mjs)
//   crown    [K0, K1, K2] = crown card counts per LOD (crown.mjs): the
//            dense leaf cards become K clustered cards with baked tiles

export const BIOME_KEYS = [
  'ocean', 'beach', 'desert', 'savanna', 'grassland', 'temperate_forest', 'rainforest',
  'boreal_forest', 'tundra', 'bare_rock', 'snow', 'wetland', 'river', 'lake', 'scree',
  'alpine_meadow',
];

const PH = 'polyhaven';
const MAN = 'mantissa';     // CC0, LICENSE-CC0.txt in each pack
const OGA = 'opengameart';  // CC0 per page; licence recorded per source
const PROC = 'procedural';  // our mesh, CC0 textures
const TREE_L = [60000, 12000, 2500];
const BIG_TREE_L = [90000, 18000, 3500];
const PLANT_L = [8000, 2000, 500];
const ROCK_L = [12000, 2500, 500];
const CLIFF_L = [30000, 6000, 1200];

export const SOURCES = [
  // ---- trees: conifers
  { from: PH, src: 'fir_tree_01', crown: [2400, 800, 220], lods: [30000, 8000, 2000], kind: 'tree', sub: 'conifer', name: 'Fir tree', biomes: ['boreal_forest', 'temperate_forest', 'alpine_meadow'], variants: 'nodes', impostor: true, default: true, wind: 0.3 },
  { from: PH, src: 'pine_tree_01', crown: [2400, 800, 220], lods: [30000, 8000, 2000], kind: 'tree', sub: 'conifer', name: 'Scots pine', biomes: ['boreal_forest', 'temperate_forest'], variants: 'nodes', impostor: true, default: false, wind: 0.3 },
  { from: PH, src: 'pine_sapling_medium', pick: [0, 1], crown: [1500, 500, 150], lods: [18000, 5000, 1300], kind: 'tree', sub: 'conifer young', name: 'Young pine', biomes: ['boreal_forest', 'temperate_forest', 'alpine_meadow'], variants: 'nodes', impostor: true, default: false, wind: 0.4 },
  { from: PH, src: 'fir_sapling_medium', crown: [1500, 500, 150], lods: [18000, 5000, 1300], kind: 'tree', sub: 'conifer young', name: 'Young fir', biomes: ['boreal_forest', 'alpine_meadow', 'tundra'], variants: 'nodes', impostor: true, default: false, wind: 0.4 },
  { from: PH, src: 'pine_sapling_small', crown: [700, 240, 80], lods: [7000, 2000, 600], kind: 'tree', sub: 'sapling', name: 'Pine sapling', biomes: ['boreal_forest', 'temperate_forest', 'alpine_meadow'], variants: 'nodes', default: false, wind: 0.6 },
  { from: PH, src: 'fir_sapling', crown: [700, 240, 80], lods: [7000, 2000, 600], kind: 'tree', sub: 'sapling', name: 'Fir sapling', biomes: ['boreal_forest', 'alpine_meadow', 'tundra'], variants: 'nodes', default: false, wind: 0.6 },
  // ---- trees: broadleaf
  { from: PH, src: 'island_tree_01', crown: [2400, 800, 220], lods: [30000, 8000, 2000], kind: 'tree', sub: 'broadleaf', name: 'Island tree', biomes: ['temperate_forest', 'grassland', 'rainforest'], variants: 'nodes', impostor: true, default: true, wind: 0.5 },
  { from: PH, src: 'island_tree_02', crown: [2400, 800, 220], lods: [30000, 8000, 2000], kind: 'tree', sub: 'broadleaf', name: 'Island tree, wide', biomes: ['temperate_forest', 'grassland', 'savanna'], variants: 'nodes', impostor: true, default: false, wind: 0.5 },
  { from: PH, src: 'island_tree_03', crown: [2400, 800, 220], lods: [30000, 8000, 2000], kind: 'tree', sub: 'broadleaf', name: 'Island tree, tall', biomes: ['temperate_forest', 'rainforest', 'wetland'], variants: 'nodes', impostor: true, default: false, wind: 0.5 },
  { from: PH, src: 'jacaranda_tree', crown: [2400, 800, 220], lods: [30000, 8000, 2000], kind: 'tree', sub: 'broadleaf flowering', name: 'Jacaranda', biomes: ['savanna', 'rainforest', 'grassland'], variants: 'one', impostor: true, default: false, wind: 0.4 },
  { from: PH, src: 'tree_small_02', crown: [1500, 500, 150], lods: [18000, 5000, 1300], kind: 'tree', sub: 'broadleaf small', name: 'Small tree', biomes: ['temperate_forest', 'grassland', 'wetland'], variants: 'nodes', impostor: true, default: true, wind: 0.5 },
  { from: PH, src: 'searsia_lucida', pick: [0, 2, 4], crown: [1500, 500, 150], lods: [18000, 5000, 1300], kind: 'tree', sub: 'broadleaf shrub tree', name: 'Glossy currant', biomes: ['savanna', 'grassland', 'desert'], variants: 'nodes', impostor: true, default: false, wind: 0.4 },
  { from: PH, src: 'searsia_burchellii', crown: [1500, 500, 150], lods: [18000, 5000, 1300], kind: 'tree', sub: 'broadleaf shrub tree', name: 'Karee', biomes: ['savanna', 'desert', 'scree'], variants: 'nodes', impostor: true, default: false, wind: 0.4 },
  // ---- trees: arid and dead
  { from: PH, src: 'quiver_tree_01', kind: 'tree', sub: 'succulent tree', name: 'Quiver tree', biomes: ['desert', 'savanna', 'scree'], variants: 'one', lods: TREE_L, impostor: true, default: false, wind: 0.05 },
  { from: PH, src: 'quiver_tree_02', kind: 'tree', sub: 'succulent tree', name: 'Quiver tree, young', biomes: ['desert', 'savanna', 'scree'], variants: 'one', lods: TREE_L, impostor: true, default: false, wind: 0.05 },
  { from: PH, src: 'dead_tree_trunk_02', kind: 'log', sub: 'dead tree, fallen', name: 'Fallen dead tree', biomes: ['wetland', 'tundra', 'boreal_forest', 'savanna', 'desert'], variants: 'one', lods: ROCK_L, default: false, wind: 0.0 },
  { from: PH, src: 'dead_quiver_trunk', kind: 'tree', sub: 'dead', name: 'Dead quiver trunk', biomes: ['desert', 'scree'], variants: 'one', lods: PLANT_L, default: false, wind: 0.0 },
  { from: PH, src: 'othonna_cerarioides', pick: [0, 2, 4], kind: 'succulent', sub: 'succulent shrub', name: 'Othonna', biomes: ['desert', 'scree'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.05 },
  // ---- bushes
  { from: PH, src: 'shrub_02', kind: 'bush', sub: 'shrub', name: 'Shrub', biomes: ['temperate_forest', 'grassland', 'boreal_forest', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.6 },
  { from: PH, src: 'shrub_04', kind: 'bush', sub: 'shrub', name: 'Low shrub', biomes: ['grassland', 'alpine_meadow', 'tundra', 'scree'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.6 },
  { from: PH, src: 'shrub_01', kind: 'bush', sub: 'flowering shrub', name: 'Flowering shrub', biomes: ['grassland', 'temperate_forest', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.6 },
  { from: PH, src: 'shrub_03', kind: 'bush', sub: 'shrub', name: 'Sparse shrub', biomes: ['grassland', 'savanna', 'scree'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.6 },
  { from: PH, src: 'wild_rooibos_bush', pick: [0, 2, 4], kind: 'bush', sub: 'fynbos', name: 'Wild rooibos', biomes: ['savanna', 'desert', 'scree'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.5 },
  { from: PH, src: 'didelta_spinosa', kind: 'bush', sub: 'succulent shrub', name: 'Didelta', biomes: ['desert', 'beach', 'savanna'], variants: 'one', lods: PLANT_L, default: false, wind: 0.3 },
  { from: PH, src: 'leipoldtia_schultzei', kind: 'succulent', sub: 'succulent ground', name: 'Leipoldtia', biomes: ['desert', 'beach', 'scree'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.2 },
  // ---- ferns, flowers, grass, ground cover
  { from: PH, src: 'fern_02', kind: 'fern', sub: 'fern', name: 'Fern', biomes: ['temperate_forest', 'rainforest', 'boreal_forest', 'wetland'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.7 },
  { from: PH, src: 'flower_gazania', pick: [1, 3, 5, 7], kind: 'flower', sub: 'daisy', name: 'Gazania', biomes: ['grassland', 'savanna', 'beach', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.7 },
  { from: PH, src: 'flower_ursinia', kind: 'flower', sub: 'daisy', name: 'Ursinia', biomes: ['grassland', 'alpine_meadow', 'savanna'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.8 },
  { from: PH, src: 'flower_empodium', pick: [0, 2, 4], kind: 'flower', sub: 'star flower', name: 'Empodium', biomes: ['grassland', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.8 },
  { from: PH, src: 'dandelion_01', pick: [0, 1, 3], kind: 'flower', sub: 'dandelion', name: 'Dandelion', biomes: ['grassland', 'alpine_meadow', 'temperate_forest'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.8 },
  { from: PH, src: 'celandine_01', pick: [0, 2, 4], kind: 'flower', sub: 'celandine', name: 'Celandine', biomes: ['temperate_forest', 'wetland', 'grassland'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.7 },
  { from: PH, src: 'periwinkle_plant', pick: [0, 2, 4], kind: 'flower', sub: 'periwinkle', name: 'Periwinkle', biomes: ['temperate_forest', 'rainforest'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.5 },
  { from: PH, src: 'flower_heliophila', kind: 'flower', sub: 'wild flower', name: 'Heliophila', biomes: ['grassland', 'savanna', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.8 },
  { from: PH, src: 'grass_medium_01', kind: 'grass', sub: 'grass clump', name: 'Grass clump', biomes: ['grassland', 'temperate_forest', 'alpine_meadow', 'savanna', 'wetland'], variants: 'nodes', pick: [0, 1, 3, 5, 8, 10], lods: PLANT_L, default: true, wind: 1.0 },
  { from: PH, src: 'grass_medium_02', kind: 'grass', sub: 'grass clump', name: 'Tall grass clump', biomes: ['grassland', 'savanna', 'wetland', 'river'], variants: 'nodes', lods: PLANT_L, default: true, wind: 1.0 },
  { from: PH, src: 'grass_bermuda_01', pick: [2, 6, 10, 14, 18], kind: 'grass', sub: 'turf grass', name: 'Bermuda grass', biomes: ['grassland', 'savanna', 'beach'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.9 },
  { from: PH, src: 'nettle_plant', pick: [0, 2, 4], kind: 'ground cover', sub: 'weed', name: 'Nettle', biomes: ['temperate_forest', 'wetland', 'river'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.6 },
  { from: PH, src: 'weed_plant_02', pick: [0, 2, 4], kind: 'ground cover', sub: 'weed', name: 'Weed', biomes: ['grassland', 'temperate_forest', 'river'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.7 },
  { from: PH, src: 'moss_01', pick: [0, 2, 4, 6], kind: 'ground cover', sub: 'moss', name: 'Moss', biomes: ['temperate_forest', 'boreal_forest', 'rainforest', 'wetland', 'tundra'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.0 },
  { from: PH, src: 'crystalline_iceplant', pick: [0, 2, 4], kind: 'succulent', sub: 'ice plant', name: 'Ice plant', biomes: ['beach', 'desert'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.1 },
  { from: PH, src: 'cheiridopsis_succulent', pick: [0, 3, 6], kind: 'succulent', sub: 'succulent', name: 'Cheiridopsis', biomes: ['desert', 'scree', 'beach'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.1 },
  // ---- rocks and boulders
  { from: PH, src: 'boulder_01', kind: 'boulder', sub: 'granite', name: 'Boulder', biomes: ['temperate_forest', 'grassland', 'alpine_meadow', 'scree', 'bare_rock', 'tundra', 'river'], variants: 'one', lods: ROCK_L, default: true, wind: 0 },
  { from: PH, src: 'namaqualand_boulder_02', kind: 'boulder', sub: 'granite', name: 'Granite boulder', biomes: ['desert', 'savanna', 'scree', 'bare_rock'], variants: 'one', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'namaqualand_boulder_03', kind: 'boulder', sub: 'granite', name: 'Granite boulder, tall', biomes: ['desert', 'savanna', 'scree', 'bare_rock', 'grassland'], variants: 'one', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'namaqualand_boulder_04', kind: 'boulder', sub: 'granite', name: 'Granite boulder, round', biomes: ['desert', 'savanna', 'scree', 'bare_rock', 'grassland', 'alpine_meadow'], variants: 'one', lods: ROCK_L, default: true, wind: 0 },
  { from: PH, src: 'namaqualand_boulder_05', kind: 'boulder', sub: 'granite', name: 'Granite boulder, flat', biomes: ['desert', 'savanna', 'beach', 'scree'], variants: 'one', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'namaqualand_boulder_06', kind: 'boulder', sub: 'granite', name: 'Granite boulder, small', biomes: ['desert', 'savanna', 'scree', 'river'], variants: 'one', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'rock_07', kind: 'rock', sub: 'stone', name: 'Rock', biomes: ['scree', 'river', 'bare_rock', 'alpine_meadow', 'tundra', 'beach'], variants: 'one', lods: ROCK_L, default: true, wind: 0 },
  { from: PH, src: 'rock_09', kind: 'rock', sub: 'stone', name: 'Flat rock', biomes: ['scree', 'river', 'beach', 'grassland'], variants: 'one', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'stone_01', kind: 'rock', sub: 'stone', name: 'Stone', biomes: ['river', 'beach', 'scree', 'grassland', 'temperate_forest'], variants: 'one', lods: ROCK_L, default: true, wind: 0 },
  { from: PH, src: 'namaqualand_rocks_01', kind: 'rock', sub: 'rock scatter', name: 'Rock scatter', biomes: ['desert', 'scree', 'savanna'], variants: 'nodes', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'coast_rocks_05', kind: 'boulder', sub: 'coastal rock', name: 'Coastal rock', biomes: ['beach', 'ocean', 'bare_rock'], variants: 'one', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'rock_moss_set_01', kind: 'rock', sub: 'mossy rock', name: 'Mossy rock', biomes: ['temperate_forest', 'boreal_forest', 'rainforest', 'wetland', 'river'], variants: 'nodes', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'rock_moss_set_02', pick: [0, 2, 4, 6], kind: 'rock', sub: 'mossy rock', name: 'Mossy rock, low', biomes: ['temperate_forest', 'boreal_forest', 'rainforest', 'wetland'], variants: 'nodes', lods: ROCK_L, default: false, wind: 0 },
  // ---- cliffs and rock faces
  { from: PH, src: 'rock_face_01', kind: 'cliff', sub: 'rock face', name: 'Rock face', biomes: ['bare_rock', 'scree', 'alpine_meadow', 'snow'], variants: 'one', lods: CLIFF_L, default: true, wind: 0 },
  { from: PH, src: 'rock_face_02', kind: 'cliff', sub: 'rock face', name: 'Rock face, broken', biomes: ['bare_rock', 'scree', 'alpine_meadow', 'snow'], variants: 'one', lods: CLIFF_L, default: false, wind: 0 },
  { from: PH, src: 'namaqualand_cliff_01', kind: 'cliff', sub: 'granite cliff', name: 'Granite cliff', biomes: ['desert', 'bare_rock', 'savanna', 'scree'], variants: 'one', lods: CLIFF_L, default: false, wind: 0 },
  { from: PH, src: 'mountainside', kind: 'cliff', sub: 'mountainside', name: 'Mountainside', biomes: ['bare_rock', 'scree', 'snow', 'alpine_meadow'], variants: 'one', lods: CLIFF_L, default: false, wind: 0 },
  // ---- logs, stumps, roots, debris
  { from: PH, src: 'dead_tree_trunk', kind: 'log', sub: 'fallen trunk', name: 'Fallen trunk', biomes: ['temperate_forest', 'boreal_forest', 'rainforest', 'wetland'], variants: 'one', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'tree_stump_01', kind: 'stump', sub: 'mossy stump', name: 'Tree stump', biomes: ['temperate_forest', 'boreal_forest', 'wetland'], variants: 'one', lods: ROCK_L, default: true, wind: 0 },
  { from: PH, src: 'tree_stump_02', kind: 'stump', sub: 'mossy stump', name: 'Tree stump, low', biomes: ['temperate_forest', 'boreal_forest', 'rainforest'], variants: 'one', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'root_cluster_01', kind: 'log', sub: 'root cluster', name: 'Root cluster', biomes: ['river', 'wetland', 'rainforest'], variants: 'nodes', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'pine_roots', kind: 'log', sub: 'roots', name: 'Pine roots', biomes: ['boreal_forest', 'temperate_forest'], variants: 'nodes', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'dry_branches_medium_01', kind: 'log', sub: 'dry branches', name: 'Dry branches', biomes: ['savanna', 'desert', 'temperate_forest', 'boreal_forest'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0 },
  // ---- second pack (ASSETS2): sources other than Poly Haven. prep.mjs
  // turns each one into a glTF in dl/prep/<src> (Blender for FBX, OBJ and
  // .blend files, proc.mjs for the procedural ones). Texture paths are
  // relative to the dl folder. `tex` rules match material names (regex,
  // first match wins): diff, nor (OpenGL normal), ao + rough (packed to
  // ARM), alpha (a file) or alphaFromDiff (the diffuse alpha channel),
  // foliage (leaf geometry cut to shape: crown and wind treat it as
  // foliage although it has no alpha). Input `drop` deletes the faces of
  // those materials (the Mantissa roots are below the ground plane).
  // ---- broadleaf trees: Mantissa (Midge Sinnaeve), CC0, real-scale FBX
  { from: MAN, src: 'mantissa_birch', pack: 'birch', kind: 'tree', sub: 'broadleaf birch', name: 'Silver birch', biomes: ['temperate_forest', 'boreal_forest', 'grassland', 'tundra'], variants: 'nodes', impostor: true, default: true, wind: 0.55,
    inputs: [1, 3, 5].map((k) => ({ file: `mantissa/birch/Mantissa_Birch_00${k}.FBX`, name: `birch_${k}`, drop: ['Roots'] })),
    crown: [2400, 800, 220], lods: [30000, 8000, 2000],
    tex: [
      { match: '^Leaf_0([123])', diff: 'mantissa/birch/Textures/Birch_Leaf_Front_512_DIFF_0$1.jpg', foliage: true },
      { match: '^(Twigs|Stems|Branches_SMALL)', diff: 'mantissa/birch/Textures/Birch_Bark_2K_DIFF.jpg', foliage: true },
      { match: '.', diff: 'mantissa/birch/Textures/Birch_Bark_2K_DIFF.jpg' },
    ],
    author: 'Midge Sinnaeve (mantissa.xyz)', url: 'https://mantissa.xyz/free.html', sourceName: 'Mantissa CG Birch Tree Pack',
    provenance: 'real CG model (FBX) with the photo textures of the pack' },
  { from: MAN, src: 'mantissa_japanese_maple', pack: 'maple', kind: 'tree', sub: 'broadleaf maple red leaf', name: 'Japanese maple', biomes: ['temperate_forest', 'grassland'], variants: 'nodes', impostor: true, default: false, wind: 0.5,
    inputs: [1, 4].map((k) => ({ file: `mantissa/maple/Mantissa_Japanese_Maple_00${k}.FBX`, name: `maple_${k}`, drop: ['Roots'] })),
    crown: [2400, 800, 220], lods: [30000, 8000, 2000],
    tex: [
      { match: '^Leaf_0([123])', diff: 'mantissa/maple/Textures/Leaf_0$1_DIFF.jpg', foliage: true },
      { match: '^(Twigs|Stems|Branches_Small)', diff: 'mantissa/maple/Textures/Bark_DIFF.jpg', foliage: true },
      { match: '.', diff: 'mantissa/maple/Textures/Bark_DIFF.jpg' },
    ],
    author: 'Midge Sinnaeve (mantissa.xyz)', url: 'https://mantissa.xyz/free.html', sourceName: 'Mantissa CG Japanese Maple Pack',
    provenance: 'real CG model (FBX) with the photo textures of the pack' },
  // The generic pack has no textures: furrowed or smooth bark from
  // ambientCG and the Mantissa birch leaf photos. The models are 4.7 to
  // 6 m high; x2.6 gives 12 to 16 m canopy trees.
  { from: MAN, src: 'mantissa_generic_furrowed', pack: 'generic', kind: 'tree', sub: 'broadleaf deciduous furrowed bark', name: 'Broadleaf tree, furrowed bark', biomes: ['temperate_forest', 'grassland', 'wetland', 'rainforest'], variants: 'nodes', impostor: true, default: true, wind: 0.45,
    inputs: [1, 4].map((k) => ({ file: `mantissa/generic/Mantissa_Generic_Tree_00${k}.FBX`, name: `generic_${k}`, scale: 2.6, drop: ['Roots'] })),
    crown: [2400, 800, 220], lods: [30000, 8000, 2000],
    tex: [
      { match: '^Leaf_0([123])', diff: 'mantissa/birch/Textures/Birch_Leaf_Front_512_DIFF_0$1.jpg', foliage: true },
      { match: '^(Twigs|Branches_SMALL)', diff: 'acg/Bark001/Bark001_1K-JPG_Color.jpg', foliage: true },
      { match: '.', diff: 'acg/Bark001/Bark001_1K-JPG_Color.jpg', nor: 'acg/Bark001/Bark001_1K-JPG_NormalGL.jpg', rough: 'acg/Bark001/Bark001_1K-JPG_Roughness.jpg' },
    ],
    author: 'Midge Sinnaeve (mantissa.xyz); bark Bark001 by Lennart Demes (ambientCG); leaf photos from the Mantissa birch pack', url: 'https://mantissa.xyz/free.html', sourceName: 'Mantissa CG Generic Tree Pack',
    provenance: 'real CG model (FBX, untextured in the pack), scaled x2.6, with CC0 photo textures (ambientCG Bark001, Mantissa birch leaves)' },
  { from: MAN, src: 'mantissa_generic_smooth', pack: 'generic', kind: 'tree', sub: 'broadleaf deciduous smooth bark', name: 'Broadleaf tree, smooth bark', biomes: ['temperate_forest', 'rainforest', 'grassland'], variants: 'nodes', impostor: true, default: false, wind: 0.45,
    inputs: [7, 9].map((k) => ({ file: `mantissa/generic/Mantissa_Generic_Tree_00${k}.FBX`, name: `generic_${k}`, scale: 2.6, drop: ['Roots'] })),
    crown: [2400, 800, 220], lods: [30000, 8000, 2000],
    tex: [
      { match: '^Leaf_0([123])', diff: 'mantissa/birch/Textures/Birch_Leaf_Front_512_DIFF_0$1.jpg', foliage: true },
      { match: '^(Twigs|Branches_SMALL)', diff: 'acg/Bark010/Bark010_1K-JPG_Color.jpg', foliage: true },
      { match: '.', diff: 'acg/Bark010/Bark010_1K-JPG_Color.jpg', nor: 'acg/Bark010/Bark010_1K-JPG_NormalGL.jpg', rough: 'acg/Bark010/Bark010_1K-JPG_Roughness.jpg' },
    ],
    author: 'Midge Sinnaeve (mantissa.xyz); bark Bark010 by Lennart Demes (ambientCG); leaf photos from the Mantissa birch pack', url: 'https://mantissa.xyz/free.html', sourceName: 'Mantissa CG Generic Tree Pack',
    provenance: 'real CG model (FBX, untextured in the pack), scaled x2.6, with CC0 photo textures (ambientCG Bark010, Mantissa birch leaves)' },
  // ---- Nobiax / Yughues (OpenGameArt, CC0): game models, one texture each.
  // The OBJ files are in centimetres (scale 0.01); palm x0.05 gives 9 to
  // 11 m, saguaro x0.015 gives 4.6 m, bamboo x0.025 gives 5 m.
  { from: OGA, src: 'nobiax_palm_trees', gain: 1.8, crownNormals: [0.5, 0.7], pack: 'palmv3', kind: 'tree', sub: 'palm', name: 'Palm tree', biomes: ['beach', 'rainforest', 'wetland'], variants: 'nodes', impostor: true, default: false, wind: 0.6,
    inputs: ['palm_straight', 'palm_bend', 'palm_dual', 'palm_trio'].map((n) => ({ file: `oga/palmv3/${n}.obj`, name: n, scale: 0.05 })),
    lods: [3000, 1400, 600], texTop: 1024,
    tex: [{ match: '.', diff: 'oga/palmv3/diffuse.tga', alphaFromDiff: true, nor: 'oga/palmv3/normal.tga' }],
    author: 'Nobiax (Yughues)', url: 'https://opengameart.org/content/free-palm-treez-v3', sourceName: 'OpenGameArt, Free palm treeZ v3',
    provenance: 'game model (OBJ) with its own painted-photo texture, colour scaled by gain' },
  { from: OGA, src: 'nobiax_huge_tree', gain: 2.4, crownNormals: [0.8, 0.45], pack: 'mundo', kind: 'tree', sub: 'broadleaf wide canopy acacia-like', name: 'Wide canopy tree', biomes: ['savanna', 'grassland', 'rainforest'], variants: 'one', impostor: true, default: false, wind: 0.4,
    inputs: [{ file: 'oga/mundo/huge tree/huge_tree.obj', name: 'huge_tree', scale: 0.01 }],
    lods: [1100, 700, 350], texTop: 1024,
    tex: [{ match: '.', diff: 'oga/mundo/huge tree/diffuse.tga', alphaFromDiff: true }],
    author: 'Nobiax (Yughues), made for R. Robles (Mundo)', url: 'https://opengameart.org/content/freebies-mundo-commissions', sourceName: 'OpenGameArt, Freebies - Mundo commissions',
    provenance: 'game model (OBJ) with its own texture, colour scaled by gain' },
  { from: OGA, src: 'nobiax_saguaro', gain: 2.2, pack: 'mundo', kind: 'cactus', sub: 'saguaro cactus', name: 'Saguaro cactus', biomes: ['desert', 'savanna', 'scree'], variants: 'one', impostor: true, default: false, wind: 0.0,
    inputs: [{ file: 'oga/mundo/cactus/cactus.obj', name: 'saguaro', scale: 0.015 }],
    lods: [1100, 500, 200], texTop: 1024,
    tex: [{ match: '.', diff: 'oga/mundo/cactus/diffuse.tga', alphaFromDiff: true }],
    author: 'Nobiax (Yughues), made for R. Robles (Mundo)', url: 'https://opengameart.org/content/freebies-mundo-commissions', sourceName: 'OpenGameArt, Freebies - Mundo commissions',
    provenance: 'game model (OBJ) with its own texture, colour scaled by gain' },
  { from: OGA, src: 'nobiax_bushes', gain: 1.6, pack: 'bushes', kind: 'bush', sub: 'shrub broadleaf', name: 'Leafy bush', biomes: ['temperate_forest', 'grassland', 'rainforest', 'wetland'], variants: 'nodes', default: false, wind: 0.6,
    inputs: [1, 2, 4, 5].map((k) => ({ file: `oga/bushes/0${k}/bush_0${k}.obj`, name: `bush_0${k}`, scale: 0.01 })),
    lods: [1200, 600, 250], texTop: 1024,
    tex: [1, 2, 4, 5].map((k) => ({ match: `bush_0${k}`, diff: `oga/bushes/0${k}/diffuse.tga`, alphaFromDiff: true, nor: `oga/bushes/0${k}/normal.tga` })),
    author: 'Nobiax (Yughues)', url: 'https://opengameart.org/content/bushes', sourceName: 'OpenGameArt, Bushes',
    provenance: 'game models (OBJ) with their own textures, colour scaled by gain' },
  { from: OGA, src: 'nobiax_tropical_shrubs', gain: 1.5, pack: 'tropshrubs', kind: 'bush', sub: 'tropical shrub bromeliad', name: 'Tropical shrub', biomes: ['rainforest', 'wetland'], variants: 'nodes', default: false, wind: 0.5,
    inputs: [1, 2, 3, 4, 5].map((k) => ({ file: `oga/tropshrubs/0${k}/trop_shrub_0${k}.obj`, name: `trop_shrub_0${k}`, scale: 0.01 })),
    lods: [1000, 500, 200], texTop: 512,
    tex: [1, 2, 3, 4, 5].map((k) => ({ match: `trop_shrub_0${k}`, diff: `oga/tropshrubs/0${k}/diffuse.tga`, alphaFromDiff: true, nor: `oga/tropshrubs/0${k}/normal.tga` })),
    author: 'Nobiax (Yughues)', url: 'https://opengameart.org/content/tropical-shrubs', sourceName: 'OpenGameArt, Tropical shrubs',
    provenance: 'game models (OBJ) with their own textures, colour scaled by gain' },
  { from: OGA, src: 'nobiax_bamboo', gain: 1.6, pack: 'bamboo', kind: 'bush', sub: 'bamboo clump', name: 'Bamboo', biomes: ['rainforest', 'wetland', 'river'], variants: 'one', impostor: true, default: false, wind: 0.7,
    inputs: [{ file: 'oga/bamboo/Bamboo 01.obj', name: 'bamboo', scale: 0.025 }],
    lods: [1500, 700, 300], texTop: 1024,
    tex: [{ match: '.', diff: 'oga/bamboo/diffuse.tga', alphaFromDiff: true, nor: 'oga/bamboo/normal.tga' }],
    author: 'Nobiax (Yughues)', url: 'https://opengameart.org/content/free-bamboo-v1', sourceName: 'OpenGameArt, Free Bamboo v1',
    provenance: 'game model (OBJ) with its own texture, colour scaled by gain' },
  // ---- mushrooms: rubberduck (OpenGameArt, CC0), hand-painted textures; the .blend units are not metres
  { from: OGA, src: 'rubberduck_mushrooms', pack: 'vegpack', kind: 'mushroom', sub: 'mushroom bolete', name: 'Mushroom', biomes: ['temperate_forest', 'boreal_forest', 'rainforest'], variants: 'nodes', default: false, wind: 0.0,
    inputs: [['mushroom1_higher', 0.05], ['mushroom2_higher', 0.045], ['mushroom3_higher', 0.05]].map(([o, s]) => ({ file: 'oga/vegpack/free_vegetation_pack.blend', objects: [o], name: o.replace('_higher', ''), scale: s })),
    lods: [900, 500, 240], texTop: 512,
    tex: [{ match: '.', diff: 'oga/vegpack/textures/mushroom.jpg' }],
    author: 'rubberduck', url: 'https://opengameart.org/content/free-vegetation-asset-pack', sourceName: 'OpenGameArt, free vegetation asset pack',
    provenance: 'game models (.blend) with hand-painted textures, scaled to 11 to 17 cm' },
  // ---- procedural meshes with real CC0 textures (no acceptable real model found)
  { from: PROC, src: 'proc_weeping_willow', gen: 'willow', kind: 'tree', sub: 'broadleaf willow weeping', name: 'Weeping willow', biomes: ['wetland', 'river', 'lake', 'temperate_forest'], variants: 'nodes', impostor: true, default: false, wind: 0.9,
    inputs: [11, 12, 13].map((seed) => ({ name: `willow_${seed - 10}`, seed })),
    crown: [1800, 600, 180], lods: [24000, 6000, 1600],
    tex: [
      { match: '^leaf', diff: 'mantissa/birch/Textures/Birch_Leaf_Front_512_DIFF_02.jpg', foliage: true },
      { match: '^twig', diff: 'acg/Bark002/Bark002_1K-JPG_Color.jpg', foliage: true },
      { match: '.', diff: 'acg/Bark002/Bark002_1K-JPG_Color.jpg', nor: 'acg/Bark002/Bark002_1K-JPG_NormalGL.jpg', ao: 'acg/Bark002/Bark002_1K-JPG_AmbientOcclusion.jpg', rough: 'acg/Bark002/Bark002_1K-JPG_Roughness.jpg' },
    ],
    author: 'davesgames.io (mesh); textures: Lennart Demes (ambientCG Bark002), Midge Sinnaeve (Mantissa birch leaf photo)', url: 'https://ambientcg.com/view?id=Bark002', sourceName: 'procedural (tools/nature-assets/proc.mjs)',
    provenance: 'procedural with CC0 textures' },
  { from: PROC, src: 'proc_reeds', gen: 'reeds', kind: 'reed', sub: 'reed cattail bulrush', name: 'Reeds with cattails', biomes: ['wetland', 'river', 'lake'], variants: 'nodes', default: true, wind: 0.9,
    inputs: [21, 22, 23].map((seed) => ({ name: `reeds_${seed - 20}`, seed })),
    lods: [2400, 900, 300], texTop: 512,
    tex: [
      { match: '^blade', diff: 'mantissa/birch/Textures/Birch_Leaf_Front_512_DIFF_02.jpg', foliage: true },
      { match: '.', diff: 'acg/Bark002/Bark002_1K-JPG_Color.jpg' },
    ],
    author: 'davesgames.io (mesh); textures: Midge Sinnaeve (Mantissa birch leaf photo, a strip along the midrib), Lennart Demes (ambientCG Bark002, cattail heads)', url: 'https://ambientcg.com/view?id=Bark002', sourceName: 'procedural (tools/nature-assets/proc.mjs)',
    provenance: 'procedural with CC0 textures' },
  { from: PROC, src: 'proc_grass_tufts', gen: 'tufts', kind: 'grass', sub: 'grass tuft', name: 'Grass tuft', biomes: ['grassland', 'savanna', 'alpine_meadow', 'temperate_forest', 'wetland'], variants: 'nodes', default: true, wind: 1.0,
    inputs: [1, 2, 3, 4, 5, 6].map((k) => ({ name: `tuft_0${k}`, seed: 30 + k, tex: k })),
    lods: [8, 6, 4], texTop: 512,
    tex: [1, 2, 3, 4, 5, 6].map((k) => ({ match: `^tuft_0${k}`, diff: `oga/grass0${k <= 3 ? 1 : 2}/grass_0${k}/diffus.tga`, alpha: `oga/grass0${k <= 3 ? 1 : 2}/grass_0${k}/opacity.tga` })),
    author: 'davesgames.io (crossed cards); textures: Nobiax (Yughues, Grass Pack #01 and #02, CC0)', url: 'https://opengameart.org/content/grass-pack-01', sourceName: 'procedural (tools/nature-assets/proc.mjs)',
    provenance: 'procedural crossed cards with CC0 textures' },
];

// Ground PBR sets, in texture array layer order. tile = metres per
// texture repeat at the source scale. VEG and GROUND pick layers by id.
const ACG = 'ambientcg';
export const GROUND = [
  { id: 'grass', from: ACG, src: 'Grass004', name: 'Dense grass', tile: 2.0, author: 'Lennart Demes (ambientCG)', biomes: ['grassland', 'temperate_forest', 'alpine_meadow'] },
  { id: 'meadow', from: ACG, src: 'Ground037', name: 'Damp forest grass', tile: 2.0, author: 'Lennart Demes (ambientCG)', biomes: ['alpine_meadow', 'wetland', 'temperate_forest'] },
  { id: 'dry_grass', from: PH, src: 'grass_ground', name: 'Dry grass and dirt', tile: 2.5, biomes: ['savanna', 'grassland', 'tundra'] },
  { id: 'forest_floor', from: PH, src: 'forest_leaves_02', name: 'Leaf litter with moss', tile: 3.0, biomes: ['temperate_forest', 'rainforest'] },
  { id: 'pine_floor', from: PH, src: 'forrest_ground_03', name: 'Pine needle floor', tile: 2.0, biomes: ['boreal_forest'] },
  { id: 'rock', from: PH, src: 'rock_face_03', name: 'Weathered rock face', tile: 2.7, biomes: ['bare_rock', 'scree', 'snow'] },
  { id: 'cliff', from: PH, src: 'rock_face', name: 'Granite cliff', tile: 2.4, biomes: ['bare_rock', 'desert'] },
  { id: 'scree', from: PH, src: 'rocks_ground_06', name: 'Broken scree', tile: 3.0, biomes: ['scree', 'tundra'] },
  { id: 'gravel', from: PH, src: 'river_small_rocks', name: 'River pebbles', tile: 2.9, biomes: ['river', 'lake', 'beach'] },
  { id: 'sand', from: PH, src: 'sand_02', name: 'Beach sand', tile: 2.1, biomes: ['beach', 'ocean'] },
  { id: 'desert', from: PH, src: 'dry_ground_01', name: 'Cracked dry ground', tile: 4.0, biomes: ['desert', 'savanna'] },
  { id: 'snow', from: PH, src: 'snow_02', name: 'Snow', tile: 2.0, biomes: ['snow', 'tundra'] },
  { id: 'mud', from: PH, src: 'brown_mud_02', name: 'Mud', tile: 1.3, biomes: ['wetland', 'river', 'lake'] },
];

// Archives for the second pack. fetch.mjs downloads each into
// dl/<dir>/ and unpacks it with bsdtar (zip and 7z). Sizes are the
// archive sizes on 2026-10-17. lic = the page that states the licence.
const OGAF = 'https://opengameart.org/sites/default/files/';
export const PACKS = [
  { dir: 'mantissa/birch', url: 'https://ftp.mantissa.xyz/resources/trees/mantissa_birch_tree_pack.zip', mb: 887, lic: 'https://mantissa.xyz/free.html (Public Domain (CC0) License; LICENSE-CC0.txt in the zip)' },
  { dir: 'mantissa/maple', url: 'https://ftp.mantissa.xyz/resources/trees/mantissa_japanese_maple_pack.zip', mb: 438, lic: 'https://mantissa.xyz/free.html (Public Domain (CC0) License; LICENSE-CC0.txt in the zip)' },
  { dir: 'mantissa/generic', url: 'https://ftp.mantissa.xyz/resources/trees/mantissa_generic_tree_pack_fbx.zip', mb: 1326, lic: 'https://mantissa.xyz/free.html (Public Domain (CC0) License; LICENSE-CC0.txt in the zip)' },
  { dir: 'oga/palmv3', url: OGAF + 'PACK%20V3_0.7z', mb: 34, lic: 'https://opengameart.org/content/free-palm-treez-v3 (CC0; readme.txt CC0 1.0)' },
  { dir: 'oga/mundo', url: OGAF + 'Mundo.7z', mb: 50, lic: 'https://opengameart.org/content/freebies-mundo-commissions (CC0)' },
  { dir: 'oga/bushes', url: OGAF + 'bushes.7z', mb: 40, lic: 'https://opengameart.org/content/bushes (CC0; readme.txt CC0 1.0)' },
  { dir: 'oga/tropshrubs', url: OGAF + 'tropical%20shrubs.7z', mb: 6, lic: 'https://opengameart.org/content/tropical-shrubs (CC0; readme.txt CC0 1.0)' },
  { dir: 'oga/bamboo', url: OGAF + 'bamboo%20v1.7z', mb: 2, lic: 'https://opengameart.org/content/free-bamboo-v1 (CC0; readme.txt CC0 1.0)' },
  { dir: 'oga/grass01', url: OGAF + 'grass_01.7z', mb: 7, lic: 'https://opengameart.org/content/grass-pack-01 (CC0)' },
  { dir: 'oga/grass02', url: OGAF + 'grass_02.7z', mb: 7, lic: 'https://opengameart.org/content/grass-pack-02 (CC0)' },
  { dir: 'oga/vegpack', url: OGAF + 'free_vegetation_pack.zip', mb: 13, lic: 'https://opengameart.org/content/free-vegetation-asset-pack (CC0)' },
  ...['Bark001', 'Bark002', 'Bark010'].map((id) => ({ dir: 'acg/' + id, url: `https://ambientcg.com/get?file=${id}_1K-JPG.zip`, mb: 10, lic: 'https://docs.ambientcg.com/license/ (CC0 1.0)' })),
];
