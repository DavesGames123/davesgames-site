// em-explorer CATALOG: dataset records.
//
// One record for each public volume-EM dataset that the page streams.
// Each record gives the DATA package what openVolume() needs
// ({ id, format, url }) and gives CORE the text for the picker, the card
// and the credits. Licences and credit lines come from each dataset's own
// page (see CREDITS.md, checked 2026-10-25). Sizes are scale-0 voxels,
// x y z, read from the live `info` or `.zarray` files on 2026-10-25.
//
// Coordinates: every x y z in this package is in voxels of scale 0,
// 0-based from the start of the volume (DATA folds any voxel_offset in).
// `home` is the first view: zoom is CSS px per scale-0 voxel (VIEW units).
// `home.plane` matters for the OpenOrganelle cells: their y axis is the
// thin one (the cell height), so the wide view is the xz plane.
//
// Find things (grep -n):
//   "id: 'hemibrain'"   "id: 'minnie65'"   "id: 'h01'"
//   "id: 'jrc_hela-2'"  "id: 'jrc_jurkat-1'"  "id: 'jrc_macrophage-2'"
//   "id: 'jrc_mus-liver'"
//   'const CC_BY'      the licence fields that all records share

const CC_BY = { licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' };
const OO_BUCKET = 'https://janelia-cosem-datasets.s3.amazonaws.com';
const ooUrl = (id) => `${OO_BUCKET}/${id}/${id}.zarr/recon-1/em/fibsem-uint8`;
const OO_PAPERS = [
  { label: 'Xu et al. 2021, Nature', href: 'https://doi.org/10.1038/s41586-021-03992-4' },
  { label: 'Heinrich et al. 2021, Nature', href: 'https://doi.org/10.1038/s41586-021-03977-3' },
];
const OO_CREDIT = 'OpenOrganelle, Janelia COSEM (Xu et al. 2021; Heinrich et al. 2021)';

export const DATASETS = [
  {
    id: 'hemibrain',
    name: 'Fly hemibrain',
    short: 'Hemibrain',
    organism: 'Fruit fly (Drosophila melanogaster), adult female',
    tissue: 'Central brain, about half of it',
    method: 'FIB-SEM (focused ion beam scanning EM) of hot-knife slabs',
    blurb: 'A large part of a fruit fly brain, imaged slice by slice with an ion beam. Every neuron, synapse and mitochondrion is in this block.',
    voxel: [8, 8, 8],
    size: [34427, 39725, 41394],
    format: 'precomputed',
    url: 'https://storage.googleapis.com/neuroglancer-janelia-flyem-hemibrain/emdata/clahe_yz/jpeg',
    home: { x: 17213, y: 19862, z: 20697, zoom: 0.025, plane: 'xy' },
    ...CC_BY,
    credit: 'Janelia FlyEM hemibrain (Scheffer et al. 2020, eLife)',
    links: [
      { label: 'Janelia FlyEM hemibrain', href: 'https://www.janelia.org/project-team/flyem/hemibrain' },
      { label: 'Scheffer et al. 2020, eLife', href: 'https://doi.org/10.7554/eLife.57443' },
    ],
  },
  {
    id: 'minnie65',
    name: 'Mouse visual cortex (MICrONS)',
    short: 'MICrONS',
    organism: 'Mouse (Mus musculus)',
    tissue: 'Visual cortex, about 1 cubic millimetre, from the surface down to the white matter',
    method: 'Serial-section TEM (transmission EM) of 40 nm sections',
    blurb: 'A cubic millimetre of mouse visual cortex, cut into thousands of thin sections and imaged by transmission EM.',
    voxel: [8, 8, 40],
    size: [212992, 180224, 13088],
    format: 'precomputed',
    url: 'https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em',
    home: { x: 106496, y: 90112, z: 6544, zoom: 0.004, plane: 'xy' },
    ...CC_BY,
    credit: 'MICrONS Consortium et al. 2025, Nature; www.microns-explorer.org',
    links: [
      { label: 'MICrONS Explorer', href: 'https://www.microns-explorer.org/cortical-mm3' },
      { label: 'MICrONS Consortium 2025, Nature', href: 'https://doi.org/10.1038/s41586-025-08790-w' },
      { label: 'BossDB', href: 'https://bossdb.org/project/microns-minnie' },
    ],
  },
  {
    id: 'h01',
    name: 'Human cortex (H01)',
    short: 'H01',
    organism: 'Human (Homo sapiens)',
    tissue: 'Temporal cortex, a small fragment removed in epilepsy surgery',
    method: 'Multibeam SEM (scanning EM) of serial sections about 30 nm thick',
    blurb: 'About a cubic millimetre of human cerebral cortex, imaged at 4 nm by a 61-beam scanning electron microscope.',
    voxel: [4, 4, 33],
    size: [1031784, 712800, 5293],
    format: 'precomputed',
    url: 'gs://h01-release/data/20210601/4nm_raw',
    home: { x: 515892, y: 356400, z: 2646, zoom: 0.0009, plane: 'xy' },
    ...CC_BY,
    credit: 'H01, Lichtman Lab (Harvard) and Google (Shapson-Coe et al. 2024, Science)',
    links: [
      { label: 'H01 release', href: 'https://h01-release.storage.googleapis.com/landing.html' },
      { label: 'Shapson-Coe et al. 2024, Science', href: 'https://doi.org/10.1126/science.adk4858' },
    ],
  },
  {
    id: 'jrc_hela-2',
    name: 'HeLa cell',
    short: 'HeLa',
    organism: 'Human cell line (HeLa, from a cervical cancer)',
    tissue: 'One whole cultured cell and part of its neighbours',
    method: 'Enhanced FIB-SEM of a high-pressure-frozen cell',
    blurb: 'A whole human cell at 4 nm: nucleus, mitochondria, ER, Golgi and the rest, all in one block.',
    voxel: [4, 4, 5.24],
    size: [12000, 1600, 6368],
    format: 'zarr',
    url: ooUrl('jrc_hela-2'),
    home: { x: 6000, y: 800, z: 3184, zoom: 0.075, plane: 'xz' },
    ...CC_BY,
    credit: OO_CREDIT,
    links: [{ label: 'OpenOrganelle: jrc_hela-2', href: 'https://openorganelle.janelia.org/datasets/jrc_hela-2' }, ...OO_PAPERS],
  },
  {
    id: 'jrc_jurkat-1',
    name: 'Jurkat T cell',
    short: 'Jurkat',
    organism: 'Human cell line (Jurkat, from a T-cell leukaemia)',
    tissue: 'One whole cultured T cell',
    method: 'Enhanced FIB-SEM of a high-pressure-frozen cell',
    blurb: 'A human T cell, the kind of white blood cell that kills infected cells, imaged whole at 4 nm.',
    voxel: [4, 4, 3.44],
    size: [10000, 3000, 8560],
    format: 'zarr',
    url: ooUrl('jrc_jurkat-1'),
    home: { x: 5000, y: 1500, z: 4280, zoom: 0.09, plane: 'xz' },
    ...CC_BY,
    credit: OO_CREDIT,
    links: [{ label: 'OpenOrganelle: jrc_jurkat-1', href: 'https://openorganelle.janelia.org/datasets/jrc_jurkat-1' }, ...OO_PAPERS],
  },
  {
    id: 'jrc_macrophage-2',
    name: 'Macrophage',
    short: 'Macrophage',
    organism: 'Human cell line (THP-1 monocytes, grown into macrophages)',
    tissue: 'One whole cultured macrophage',
    method: 'Enhanced FIB-SEM of a high-pressure-frozen cell',
    blurb: 'A macrophage, the cell that eats debris and microbes, imaged whole at 4 nm.',
    voxel: [4, 4, 3.36],
    size: [10000, 2000, 11087],
    format: 'zarr',
    url: ooUrl('jrc_macrophage-2'),
    home: { x: 5000, y: 1000, z: 5543, zoom: 0.09, plane: 'xz' },
    ...CC_BY,
    credit: OO_CREDIT,
    links: [{ label: 'OpenOrganelle: jrc_macrophage-2', href: 'https://openorganelle.janelia.org/datasets/jrc_macrophage-2' }, ...OO_PAPERS],
  },
  {
    id: 'jrc_mus-liver',
    name: 'Mouse liver',
    short: 'Liver',
    organism: 'Mouse (Mus musculus)',
    tissue: 'Liver tissue: hepatocytes and the blood spaces between them',
    method: 'Enhanced FIB-SEM of tissue, 8 nm voxels',
    blurb: 'A block of mouse liver: big hepatocytes packed with mitochondria, ER, glycogen and peroxisomes.',
    voxel: [8, 8, 8],
    size: [12747, 12728, 8932],
    format: 'zarr',
    url: ooUrl('jrc_mus-liver'),
    home: { x: 6373, y: 6364, z: 4466, zoom: 0.07, plane: 'xy' },
    ...CC_BY,
    credit: OO_CREDIT,
    links: [{ label: 'OpenOrganelle: jrc_mus-liver', href: 'https://openorganelle.janelia.org/datasets/jrc_mus-liver' }, ...OO_PAPERS],
  },
];

export const DEFAULT_DATASET = 'hemibrain';
