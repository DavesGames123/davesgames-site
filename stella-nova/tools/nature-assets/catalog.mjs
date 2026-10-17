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

export const BIOME_KEYS = [
  'ocean', 'beach', 'desert', 'savanna', 'grassland', 'temperate_forest', 'rainforest',
  'boreal_forest', 'tundra', 'bare_rock', 'snow', 'wetland', 'river', 'lake', 'scree',
  'alpine_meadow',
];

const PH = 'polyhaven';
const TREE_L = [60000, 12000, 2500];
const BIG_TREE_L = [90000, 18000, 3500];
const PLANT_L = [8000, 2000, 500];
const ROCK_L = [12000, 2500, 500];
const CLIFF_L = [30000, 6000, 1200];

export const SOURCES = [
  // ---- trees: conifers
  { from: PH, src: 'fir_tree_01', kind: 'tree', sub: 'conifer', name: 'Fir tree', biomes: ['boreal_forest', 'temperate_forest', 'alpine_meadow'], variants: 'nodes', lods: BIG_TREE_L, impostor: true, default: true, wind: 0.3 },
  { from: PH, src: 'pine_tree_01', kind: 'tree', sub: 'conifer', name: 'Scots pine', biomes: ['boreal_forest', 'temperate_forest'], variants: 'nodes', lods: BIG_TREE_L, impostor: true, default: true, wind: 0.3 },
  { from: PH, src: 'pine_sapling_medium', kind: 'tree', sub: 'conifer young', name: 'Young pine', biomes: ['boreal_forest', 'temperate_forest', 'alpine_meadow'], variants: 'nodes', lods: TREE_L, impostor: true, default: false, wind: 0.4 },
  { from: PH, src: 'fir_sapling_medium', kind: 'tree', sub: 'conifer young', name: 'Young fir', biomes: ['boreal_forest', 'alpine_meadow', 'tundra'], variants: 'nodes', lods: TREE_L, impostor: true, default: true, wind: 0.4 },
  { from: PH, src: 'pine_sapling_small', kind: 'tree', sub: 'sapling', name: 'Pine sapling', biomes: ['boreal_forest', 'temperate_forest', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.6 },
  { from: PH, src: 'fir_sapling', kind: 'tree', sub: 'sapling', name: 'Fir sapling', biomes: ['boreal_forest', 'alpine_meadow', 'tundra'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.6 },
  // ---- trees: broadleaf
  { from: PH, src: 'island_tree_01', kind: 'tree', sub: 'broadleaf', name: 'Island tree', biomes: ['temperate_forest', 'grassland', 'rainforest'], variants: 'nodes', lods: BIG_TREE_L, impostor: true, default: true, wind: 0.5 },
  { from: PH, src: 'island_tree_02', kind: 'tree', sub: 'broadleaf', name: 'Island tree, wide', biomes: ['temperate_forest', 'grassland', 'savanna'], variants: 'nodes', lods: BIG_TREE_L, impostor: true, default: false, wind: 0.5 },
  { from: PH, src: 'island_tree_03', kind: 'tree', sub: 'broadleaf', name: 'Island tree, tall', biomes: ['temperate_forest', 'rainforest', 'wetland'], variants: 'nodes', lods: BIG_TREE_L, impostor: true, default: false, wind: 0.5 },
  { from: PH, src: 'jacaranda_tree', kind: 'tree', sub: 'broadleaf flowering', name: 'Jacaranda', biomes: ['savanna', 'rainforest', 'grassland'], variants: 'one', lods: BIG_TREE_L, impostor: true, default: false, wind: 0.4 },
  { from: PH, src: 'tree_small_02', kind: 'tree', sub: 'broadleaf small', name: 'Small tree', biomes: ['temperate_forest', 'grassland', 'wetland'], variants: 'nodes', lods: TREE_L, impostor: true, default: true, wind: 0.5 },
  { from: PH, src: 'searsia_lucida', kind: 'tree', sub: 'broadleaf shrub tree', name: 'Glossy currant', biomes: ['savanna', 'grassland', 'desert'], variants: 'nodes', lods: TREE_L, impostor: true, default: false, wind: 0.4 },
  { from: PH, src: 'searsia_burchellii', kind: 'tree', sub: 'broadleaf shrub tree', name: 'Karee', biomes: ['savanna', 'desert', 'scree'], variants: 'nodes', lods: TREE_L, impostor: true, default: false, wind: 0.4 },
  // ---- trees: arid and dead
  { from: PH, src: 'quiver_tree_01', kind: 'tree', sub: 'succulent tree', name: 'Quiver tree', biomes: ['desert', 'savanna', 'scree'], variants: 'one', lods: TREE_L, impostor: true, default: false, wind: 0.05 },
  { from: PH, src: 'quiver_tree_02', kind: 'tree', sub: 'succulent tree', name: 'Quiver tree, young', biomes: ['desert', 'savanna', 'scree'], variants: 'one', lods: TREE_L, impostor: true, default: false, wind: 0.05 },
  { from: PH, src: 'dead_tree_trunk_02', kind: 'tree', sub: 'dead', name: 'Dead tree', biomes: ['wetland', 'tundra', 'boreal_forest', 'savanna', 'desert'], variants: 'one', lods: TREE_L, impostor: true, default: true, wind: 0.0 },
  { from: PH, src: 'dead_quiver_trunk', kind: 'tree', sub: 'dead', name: 'Dead quiver trunk', biomes: ['desert', 'scree'], variants: 'one', lods: PLANT_L, default: false, wind: 0.0 },
  { from: PH, src: 'othonna_cerarioides', kind: 'succulent', sub: 'succulent shrub', name: 'Othonna', biomes: ['desert', 'scree'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.05 },
  // ---- bushes
  { from: PH, src: 'shrub_02', kind: 'bush', sub: 'shrub', name: 'Shrub', biomes: ['temperate_forest', 'grassland', 'boreal_forest', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.6 },
  { from: PH, src: 'shrub_04', kind: 'bush', sub: 'shrub', name: 'Low shrub', biomes: ['grassland', 'alpine_meadow', 'tundra', 'scree'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.6 },
  { from: PH, src: 'shrub_01', kind: 'bush', sub: 'flowering shrub', name: 'Flowering shrub', biomes: ['grassland', 'temperate_forest', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.6 },
  { from: PH, src: 'shrub_03', kind: 'bush', sub: 'shrub', name: 'Sparse shrub', biomes: ['grassland', 'savanna', 'scree'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.6 },
  { from: PH, src: 'wild_rooibos_bush', kind: 'bush', sub: 'fynbos', name: 'Wild rooibos', biomes: ['savanna', 'desert', 'scree'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.5 },
  { from: PH, src: 'didelta_spinosa', kind: 'bush', sub: 'succulent shrub', name: 'Didelta', biomes: ['desert', 'beach', 'savanna'], variants: 'one', lods: PLANT_L, default: false, wind: 0.3 },
  { from: PH, src: 'leipoldtia_schultzei', kind: 'succulent', sub: 'succulent ground', name: 'Leipoldtia', biomes: ['desert', 'beach', 'scree'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.2 },
  // ---- ferns, flowers, grass, ground cover
  { from: PH, src: 'fern_02', kind: 'fern', sub: 'fern', name: 'Fern', biomes: ['temperate_forest', 'rainforest', 'boreal_forest', 'wetland'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.7 },
  { from: PH, src: 'flower_gazania', kind: 'flower', sub: 'daisy', name: 'Gazania', biomes: ['grassland', 'savanna', 'beach', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.7 },
  { from: PH, src: 'flower_ursinia', kind: 'flower', sub: 'daisy', name: 'Ursinia', biomes: ['grassland', 'alpine_meadow', 'savanna'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.8 },
  { from: PH, src: 'flower_empodium', kind: 'flower', sub: 'star flower', name: 'Empodium', biomes: ['grassland', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.8 },
  { from: PH, src: 'dandelion_01', kind: 'flower', sub: 'dandelion', name: 'Dandelion', biomes: ['grassland', 'alpine_meadow', 'temperate_forest'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.8 },
  { from: PH, src: 'celandine_01', kind: 'flower', sub: 'celandine', name: 'Celandine', biomes: ['temperate_forest', 'wetland', 'grassland'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.7 },
  { from: PH, src: 'periwinkle_plant', kind: 'flower', sub: 'periwinkle', name: 'Periwinkle', biomes: ['temperate_forest', 'rainforest'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.5 },
  { from: PH, src: 'flower_heliophila', kind: 'flower', sub: 'wild flower', name: 'Heliophila', biomes: ['grassland', 'savanna', 'alpine_meadow'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.8 },
  { from: PH, src: 'grass_medium_01', kind: 'grass', sub: 'grass clump', name: 'Grass clump', biomes: ['grassland', 'temperate_forest', 'alpine_meadow', 'savanna', 'wetland'], variants: 'nodes', pick: [0, 1, 3, 5, 8, 10], lods: PLANT_L, default: true, wind: 1.0 },
  { from: PH, src: 'grass_medium_02', kind: 'grass', sub: 'grass clump', name: 'Tall grass clump', biomes: ['grassland', 'savanna', 'wetland', 'river'], variants: 'nodes', lods: PLANT_L, default: true, wind: 1.0 },
  { from: PH, src: 'grass_bermuda_01', kind: 'grass', sub: 'turf grass', name: 'Bermuda grass', biomes: ['grassland', 'savanna', 'beach'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.9 },
  { from: PH, src: 'nettle_plant', kind: 'ground cover', sub: 'weed', name: 'Nettle', biomes: ['temperate_forest', 'wetland', 'river'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.6 },
  { from: PH, src: 'weed_plant_02', kind: 'ground cover', sub: 'weed', name: 'Weed', biomes: ['grassland', 'temperate_forest', 'river'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.7 },
  { from: PH, src: 'moss_01', kind: 'ground cover', sub: 'moss', name: 'Moss', biomes: ['temperate_forest', 'boreal_forest', 'rainforest', 'wetland', 'tundra'], variants: 'nodes', lods: PLANT_L, default: true, wind: 0.0 },
  { from: PH, src: 'crystalline_iceplant', kind: 'succulent', sub: 'ice plant', name: 'Ice plant', biomes: ['beach', 'desert'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.1 },
  { from: PH, src: 'cheiridopsis_succulent', kind: 'succulent', sub: 'succulent', name: 'Cheiridopsis', biomes: ['desert', 'scree', 'beach'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0.1 },
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
  { from: PH, src: 'rock_moss_set_01', kind: 'rock', sub: 'mossy rock', name: 'Mossy rock', biomes: ['temperate_forest', 'boreal_forest', 'rainforest', 'wetland', 'river'], variants: 'nodes', lods: ROCK_L, default: true, wind: 0 },
  { from: PH, src: 'rock_moss_set_02', kind: 'rock', sub: 'mossy rock', name: 'Mossy rock, low', biomes: ['temperate_forest', 'boreal_forest', 'rainforest', 'wetland'], variants: 'nodes', lods: ROCK_L, default: false, wind: 0 },
  // ---- cliffs and rock faces
  { from: PH, src: 'rock_face_01', kind: 'cliff', sub: 'rock face', name: 'Rock face', biomes: ['bare_rock', 'scree', 'alpine_meadow', 'snow'], variants: 'one', lods: CLIFF_L, default: true, wind: 0 },
  { from: PH, src: 'rock_face_02', kind: 'cliff', sub: 'rock face', name: 'Rock face, broken', biomes: ['bare_rock', 'scree', 'alpine_meadow', 'snow'], variants: 'one', lods: CLIFF_L, default: false, wind: 0 },
  { from: PH, src: 'namaqualand_cliff_01', kind: 'cliff', sub: 'granite cliff', name: 'Granite cliff', biomes: ['desert', 'bare_rock', 'savanna', 'scree'], variants: 'one', lods: CLIFF_L, default: false, wind: 0 },
  { from: PH, src: 'mountainside', kind: 'cliff', sub: 'mountainside', name: 'Mountainside', biomes: ['bare_rock', 'scree', 'snow', 'alpine_meadow'], variants: 'one', lods: CLIFF_L, default: false, wind: 0 },
  // ---- logs, stumps, roots, debris
  { from: PH, src: 'dead_tree_trunk', kind: 'log', sub: 'fallen trunk', name: 'Fallen trunk', biomes: ['temperate_forest', 'boreal_forest', 'rainforest', 'wetland'], variants: 'one', lods: ROCK_L, default: true, wind: 0 },
  { from: PH, src: 'tree_stump_01', kind: 'stump', sub: 'mossy stump', name: 'Tree stump', biomes: ['temperate_forest', 'boreal_forest', 'wetland'], variants: 'one', lods: ROCK_L, default: true, wind: 0 },
  { from: PH, src: 'tree_stump_02', kind: 'stump', sub: 'mossy stump', name: 'Tree stump, low', biomes: ['temperate_forest', 'boreal_forest', 'rainforest'], variants: 'one', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'root_cluster_01', kind: 'log', sub: 'root cluster', name: 'Root cluster', biomes: ['river', 'wetland', 'rainforest'], variants: 'nodes', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'pine_roots', kind: 'log', sub: 'roots', name: 'Pine roots', biomes: ['boreal_forest', 'temperate_forest'], variants: 'nodes', lods: ROCK_L, default: false, wind: 0 },
  { from: PH, src: 'dry_branches_medium_01', kind: 'log', sub: 'dry branches', name: 'Dry branches', biomes: ['savanna', 'desert', 'temperate_forest', 'boreal_forest'], variants: 'nodes', lods: PLANT_L, default: false, wind: 0 },
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
