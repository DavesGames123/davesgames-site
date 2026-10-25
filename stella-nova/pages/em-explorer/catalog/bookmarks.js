// em-explorer CATALOG: curated bookmarks.
//
// Each bookmark is a place in one dataset: x y z in voxels of scale 0
// (0-based, voxel_offset folded in), zoom in CSS px per scale-0 voxel (VIEW
// units: zoom 1 shows one voxel per CSS px), the plane, a short title, a
// one-line caption in plain words and a source link.
//
// `found` says how the place was found:
//   'annotation'  a published annotation (synapse tables, published views)
//   'groundtruth' the centre of a published OpenOrganelle ground-truth crop
//                 for that organelle class
//   'survey'      found by looking through the data
// Every place was checked on 2026-10-25: the catalog author fetched the
// tiles at that place, wrote a small PNG and looked at it (see tests.mjs,
// `--live`, for the fetch check that runs again).
//
// Find things (grep -n):
//   "dataset: 'hemibrain'"  "dataset: 'minnie65'"  "dataset: 'h01'"
//   "dataset: 'jrc_"         'const SRC'  (the shared source links)

const SRC = {
  hemibrain: 'https://doi.org/10.7554/eLife.57443',
  hemibrainSyn: 'https://www.janelia.org/project-team/flyem/hemibrain',
  microns: 'https://www.microns-explorer.org/cortical-mm3',
  h01: 'https://h01-release.storage.googleapis.com/landing.html',
  h01Paper: 'https://doi.org/10.1126/science.adk4858',
  oo: (id) => `https://openorganelle.janelia.org/datasets/${id}`,
};

export const BOOKMARKS = [
  // ---- Fly hemibrain (8 nm FIB-SEM) -------------------------------------
  {
    id: 'hb-whole', dataset: 'hemibrain', x: 17213, y: 19862, z: 20697, zoom: 0.02, plane: 'xy',
    title: 'The whole hemibrain',
    caption: 'One slice through half a fly brain: the grey middle is neuropil, the dense web of wiring; the rim holds the cell bodies.',
    source: SRC.hemibrain, found: 'survey',
  },
  {
    id: 'hb-cell-bodies', dataset: 'hemibrain', x: 3904, y: 29584, z: 20697, zoom: 0.4, plane: 'xy',
    title: 'Neuron cell bodies',
    caption: 'In insects the neuron cell bodies sit in a rind outside the wiring. Each round profile is a cell body with its nucleus.',
    source: SRC.hemibrain, found: 'survey',
  },
  {
    id: 'hb-tract', dataset: 'hemibrain', x: 19200, y: 13000, z: 20697, zoom: 0.2, plane: 'xy',
    title: 'A bundle of neurites',
    caption: 'A tract: many thin neurites run together here, cut along their length and across.',
    source: SRC.hemibrain, found: 'survey',
  },
  {
    id: 'hb-tbar-1', dataset: 'hemibrain', x: 11688, y: 16406, z: 10516, zoom: 2.3, plane: 'xy',
    title: 'A T-bar synapse',
    caption: 'The dark bar in the centre is a T-bar, the release site of a fly synapse; vesicles gather around it.',
    source: SRC.hemibrainSyn, found: 'annotation',
  },
  {
    id: 'hb-tbar-2', dataset: 'hemibrain', x: 6255, y: 22407, z: 15528, zoom: 2.3, plane: 'xy',
    title: 'One synapse, many partners',
    caption: 'A fly synapse is often one-to-many: one dark T-bar faces several small partner neurites at once.',
    source: SRC.hemibrainSyn, found: 'annotation',
  },
  {
    id: 'hb-microtubules', dataset: 'hemibrain', x: 17213, y: 19862, z: 20697, zoom: 1.6, plane: 'xy',
    title: 'Microtubules seen end on',
    caption: 'The fine dots inside this large neurite are microtubules cut across: the rails that carry cargo along the cell.',
    source: SRC.hemibrain, found: 'survey',
  },
  {
    id: 'hb-mito', dataset: 'hemibrain', x: 16234, y: 25264, z: 12880, zoom: 2.3, plane: 'xy',
    title: 'A mitochondrion',
    caption: 'A mitochondrion beside a synapse: its folded inner membrane (the cristae) shows as fine stripes.',
    source: SRC.hemibrain, found: 'survey',
  },

  // ---- MICrONS mouse visual cortex (8 x 8 x 40 nm TEM) -------------------
  {
    id: 'mm-whole', dataset: 'minnie65', x: 106496, y: 90112, z: 6544, zoom: 0.003, plane: 'xy',
    title: 'A cubic millimetre of cortex',
    caption: 'One section through the whole MICrONS volume. The pale dots are cell nuclei; white streaks are blood vessels.',
    source: SRC.microns, found: 'survey',
  },
  {
    id: 'mm-neuron', dataset: 'minnie65', x: 100080, y: 81260, z: 6000, zoom: 0.4, plane: 'xy',
    title: 'A neuron and its nucleus',
    caption: 'A neuron cell body: the smooth round nucleus sits in a thin rim of cytoplasm full of mitochondria.',
    source: SRC.microns, found: 'survey',
  },
  {
    id: 'mm-vessel', dataset: 'minnie65', x: 109600, y: 80008, z: 6000, zoom: 0.24, plane: 'xy',
    title: 'A blood vessel',
    caption: 'The white shape is the empty lumen of a blood vessel; the blood was washed out when the brain was fixed.',
    source: SRC.microns, found: 'survey',
  },
  {
    id: 'mm-white-matter', dataset: 'minnie65', x: 60000, y: 121000, z: 6000, zoom: 0.15, plane: 'xy',
    title: 'White matter',
    caption: 'At the bottom of the cortex, bundles of myelinated axons run to and from other brain areas.',
    source: SRC.microns, found: 'survey',
  },
  {
    id: 'mm-myelin', dataset: 'minnie65', x: 60000, y: 121000, z: 6000, zoom: 1, plane: 'xy',
    title: 'Myelin sheaths',
    caption: 'Each dark ring is myelin: many wraps of glial membrane that insulate an axon and speed its signals.',
    source: SRC.microns, found: 'survey',
  },
  {
    id: 'mm-axon', dataset: 'minnie65', x: 101108, y: 80548, z: 6000, zoom: 2.3, plane: 'xy',
    title: 'One myelinated axon',
    caption: 'A single axon in the grey matter, with a mitochondrion inside and a dark myelin sheath around it.',
    source: SRC.microns, found: 'survey',
  },
  {
    id: 'mm-mito', dataset: 'minnie65', x: 102011, y: 79356, z: 6000, zoom: 2.3, plane: 'xy',
    title: 'Mitochondria in the neuropil',
    caption: 'Mitochondria in fine neurites; the stripes across them are cristae, the folded inner membrane.',
    source: SRC.microns, found: 'survey',
  },

  // ---- H01 human cortex (4 x 4 x 33 nm multibeam SEM) ---------------------
  {
    id: 'h01-whole', dataset: 'h01', x: 515892, y: 356400, z: 2646, zoom: 0.0006, plane: 'xy',
    title: 'A fragment of human cortex',
    caption: 'One section through the whole H01 sample, from the brain surface on one side to the white matter on the other.',
    source: SRC.h01Paper, found: 'survey',
  },
  {
    id: 'h01-vessel', dataset: 'h01', x: 320434, y: 531615, z: 964, zoom: 0.03, plane: 'xy',
    title: 'A blood vessel',
    caption: 'A blood vessel runs across the section, with blood cells still inside it; the H01 team published this view.',
    source: SRC.h01, found: 'annotation',
  },
  {
    id: 'h01-red-cells', dataset: 'h01', x: 317328, y: 531928, z: 964, zoom: 0.2, plane: 'xy',
    title: 'Red blood cells',
    caption: 'Red blood cells packed in the vessel: smooth grey discs, each about 8 micrometres across, with no nucleus.',
    source: SRC.h01, found: 'annotation',
  },
  {
    id: 'h01-nucleus', dataset: 'h01', x: 604040, y: 298880, z: 2600, zoom: 0.2, plane: 'xy',
    title: 'A neuron nucleus',
    caption: 'The large round nucleus of a human neuron; the darker clumps inside are tightly packed DNA (heterochromatin).',
    source: SRC.h01Paper, found: 'survey',
  },
  {
    id: 'h01-myelin', dataset: 'h01', x: 330128, y: 528848, z: 964, zoom: 0.4, plane: 'xy',
    title: 'Myelinated axons',
    caption: 'Axons wrapped in thick dark myelin; the wraps let signals jump quickly along the axon.',
    source: SRC.h01Paper, found: 'survey',
  },
  {
    id: 'h01-synapse-1', dataset: 'h01', x: 733298, y: 358226, z: 2195, zoom: 1.5, plane: 'xy',
    title: 'An excitatory synapse',
    caption: 'An axon ending full of round synaptic vesicles meets a partner at a dark, thick patch: the synapse.',
    source: SRC.h01Paper, found: 'annotation',
  },
  {
    id: 'h01-synapse-2', dataset: 'h01', x: 429914, y: 499414, z: 712, zoom: 1.5, plane: 'xy',
    title: 'Synaptic vesicles',
    caption: 'Each small circle in this axon ending is a vesicle of about 40 nm that holds neurotransmitter.',
    source: SRC.h01Paper, found: 'annotation',
  },

  // ---- OpenOrganelle cells and tissue (4 to 8 nm FIB-SEM) -----------------
  {
    id: 'hela-whole', dataset: 'jrc_hela-2', x: 6000, y: 800, z: 3184, zoom: 0.05, plane: 'xz',
    title: 'A whole HeLa cell',
    caption: 'A whole human cell, seen from above as it lay on the dish: the nucleus is the big oval in the middle.',
    source: SRC.oo('jrc_hela-2'), found: 'survey',
  },
  {
    id: 'hela-nucleoli', dataset: 'jrc_hela-2', x: 6000, y: 800, z: 3184, zoom: 0.15, plane: 'xz',
    title: 'Nucleus and nucleoli',
    caption: 'The darker blobs inside the nucleus are nucleoli, where the cell builds its ribosomes.',
    source: SRC.oo('jrc_hela-2'), found: 'survey',
  },
  {
    id: 'hela-envelope', dataset: 'jrc_hela-2', x: 5335, y: 1264, z: 1907, zoom: 2.4, plane: 'xz',
    title: 'The nuclear envelope',
    caption: 'Two membranes wrap the nucleus; dark heterochromatin lines the inside, and nuclear pores pierce the wall.',
    source: SRC.oo('jrc_hela-2'), found: 'groundtruth',
  },
  {
    id: 'hela-golgi', dataset: 'jrc_hela-2', x: 6352, y: 284, z: 2843, zoom: 2.4, plane: 'xy',
    title: 'A Golgi stack',
    caption: 'A stack of thin curved sacs, the Golgi apparatus, finishes new proteins and sends them on in small vesicles.',
    source: SRC.oo('jrc_hela-2'), found: 'groundtruth',
  },
  {
    id: 'hela-mito', dataset: 'jrc_hela-2', x: 8128, y: 297, z: 4033, zoom: 1.2, plane: 'xz',
    title: 'Mitochondria',
    caption: 'Mitochondria make most of the cell\'s energy; the folds across them are the cristae.',
    source: SRC.oo('jrc_hela-2'), found: 'groundtruth',
  },
  {
    id: 'hela-er', dataset: 'jrc_hela-2', x: 6408, y: 453, z: 4442, zoom: 2.4, plane: 'xz',
    title: 'Rough ER and ribosomes',
    caption: 'Thin tubes and sheets of endoplasmic reticulum; the black dots are ribosomes, each about 25 nm, making proteins.',
    source: SRC.oo('jrc_hela-2'), found: 'groundtruth',
  },
  {
    id: 'jurkat-whole', dataset: 'jrc_jurkat-1', x: 5000, y: 1500, z: 4280, zoom: 0.15, plane: 'xz',
    title: 'T cells',
    caption: 'Human T cells: in these small round cells the nucleus takes up most of the space.',
    source: SRC.oo('jrc_jurkat-1'), found: 'survey',
  },
  {
    id: 'jurkat-golgi', dataset: 'jrc_jurkat-1', x: 1628, y: 1568, z: 4000, zoom: 0.6, plane: 'xz',
    title: 'The Golgi apparatus',
    caption: 'A stack of flat curved sacs: the Golgi apparatus sorts and labels new proteins before they ship out.',
    source: SRC.oo('jrc_jurkat-1'), found: 'groundtruth',
  },
  {
    id: 'jurkat-mito', dataset: 'jrc_jurkat-1', x: 5264, y: 1333, z: 3797, zoom: 0.6, plane: 'xz',
    title: 'Cristae up close',
    caption: 'Two mitochondria with their inner membrane folded into cristae, where the cell\'s energy is made.',
    source: SRC.oo('jrc_jurkat-1'), found: 'groundtruth',
  },
  {
    id: 'macro-whole', dataset: 'jrc_macrophage-2', x: 5000, y: 1000, z: 5543, zoom: 0.15, plane: 'xz',
    title: 'A macrophage',
    caption: 'A macrophage: a big nucleus with dark chromatin at its rim, and a cytoplasm crowded with mitochondria.',
    source: SRC.oo('jrc_macrophage-2'), found: 'survey',
  },
  {
    id: 'macro-golgi', dataset: 'jrc_macrophage-2', x: 5639, y: 831, z: 5525, zoom: 0.6, plane: 'xz',
    title: 'Golgi stacks',
    caption: 'Golgi stacks in a macrophage, with small transport vesicles budding at their edges.',
    source: SRC.oo('jrc_macrophage-2'), found: 'groundtruth',
  },
  {
    id: 'macro-lipid', dataset: 'jrc_macrophage-2', x: 3946, y: 317, z: 7522, zoom: 0.6, plane: 'xz',
    title: 'A lipid droplet',
    caption: 'The smooth grey oval is a lipid droplet, a store of fat wrapped in a single layer of lipid.',
    source: SRC.oo('jrc_macrophage-2'), found: 'groundtruth',
  },
  {
    id: 'liver-sinusoid', dataset: 'jrc_mus-liver', x: 6373, y: 6364, z: 4466, zoom: 0.15, plane: 'xy',
    title: 'Liver cells and a sinusoid',
    caption: 'Blood flows through the white channel, a sinusoid, past the big liver cells (hepatocytes) on each side.',
    source: SRC.oo('jrc_mus-liver'), found: 'survey',
  },
  {
    id: 'liver-peroxisome', dataset: 'jrc_mus-liver', x: 2979, y: 2979, z: 2283, zoom: 2.4, plane: 'xy',
    title: 'Peroxisome and glycogen',
    caption: 'A peroxisome, which breaks down fats and toxins, between mitochondria; the black rosettes are glycogen, stored sugar.',
    source: SRC.oo('jrc_mus-liver'), found: 'groundtruth',
  },
  {
    id: 'liver-glycogen', dataset: 'jrc_mus-liver', x: 3031, y: 2911, z: 2283, zoom: 3, plane: 'xy',
    title: 'Glycogen rosettes',
    caption: 'Each black rosette is a cluster of glycogen particles: the liver stores sugar this way between meals.',
    source: SRC.oo('jrc_mus-liver'), found: 'survey',
  },
];
