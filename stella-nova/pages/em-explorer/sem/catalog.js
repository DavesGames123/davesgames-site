// ============================================================================
//  EM EXPLORER  ·  sem/catalog.js — the surface scans (SEM package)
// ----------------------------------------------------------------------------
//  SCANS: one record per GLB in sem/models/ (sem/build/build.py makes them;
//  sem/build/sources.json has the URLs, checksums and build parameters).
//    id, file        the GLB in sem/models/
//    title, kind     the name, and what it is (organism or material)
//    method          'mesh'   : SEM photogrammetry, a closed 3D mesh
//                    'stereo' : a height map from one SEM tilt pair (one
//                               side only; the height scale is an estimate)
//    caption         one or two plain sentences, from the source record
//    credit, licence, licenceUrl, source (the record), paper (optional)
//  Text is plain text: the page sets it with textContent.
//  SEM_ABOUT: the short "how these were made" text for the panel.
//
//  grep -n targets: "export const SCANS", "export const SEM_ABOUT",
//                   "export function scanById"
// ============================================================================

const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';
const CC_BY_SA_3 = 'https://creativecommons.org/licenses/by-sa/3.0/';
const SUN = 'Xuerong Sun; Sun, Brewin, Hacker, Viljoen and Li 2024, Frontiers in Microbiology 15:1429179';
const TONAROVA = 'Petra Tonarová, Ondřej Svagera, Martina Nohejlová (Figshare 2026)';
const SECRETDISC = 'SecretDisc, Wikimedia Commons. Height map made from the stereo pair by this page';

export const SCANS = [
  {
    id: 'prorocentrum', file: 'prorocentrum.glb', method: 'mesh',
    title: 'Prorocentrum micans', kind: 'Dinoflagellate (marine plankton)',
    caption: 'A single-celled alga with a wall of two plates, covered in fine pores, and a short spine at the front end. About 45 µm long.',
    credit: SUN, licence: 'CC BY 4.0', licenceUrl: CC_BY_4,
    source: 'https://doi.org/10.6084/m9.figshare.25764384', paper: 'https://doi.org/10.3389/fmicb.2024.1429179',
  },
  {
    id: 'halamphora', file: 'halamphora.glb', method: 'mesh',
    title: 'Halamphora', kind: 'Diatom (marine plankton)',
    caption: 'A diatom: a single cell inside a wall of silica glass. The rows of small holes are pores through the wall. About 16 µm long.',
    credit: SUN, licence: 'CC BY 4.0', licenceUrl: CC_BY_4,
    source: 'https://doi.org/10.6084/m9.figshare.25764540', paper: 'https://doi.org/10.3389/fmicb.2024.1429179',
  },
  {
    id: 'pistoprion', file: 'pistoprion.glb', method: 'mesh',
    title: 'Pistoprion', kind: 'Fossil worm jaw (scolecodont)',
    caption: 'A jaw part of a bristle worm (polychaete), from Silurian rock of the Ludlow age at Kosov Quarry, Czech Republic. About 0.55 mm long.',
    credit: TONAROVA, licence: 'CC BY 4.0', licenceUrl: CC_BY_4,
    source: 'https://doi.org/10.6084/m9.figshare.32896022',
  },
  {
    id: 'chitinozoan', file: 'chitinozoan.glb', method: 'mesh',
    title: 'Chitinozoan', kind: 'Microfossil',
    caption: 'A flask-shaped microfossil with an organic wall, from Saku Quarry, Estonia. Chitinozoans lived in Palaeozoic seas; which animal made them is not known. About 0.25 mm long.',
    credit: TONAROVA, licence: 'CC BY 4.0', licenceUrl: CC_BY_4,
    source: 'https://doi.org/10.6084/m9.figshare.32896022',
  },
  {
    id: 'bee-eye', file: 'bee-eye.glb', method: 'stereo',
    title: 'Bee eye', kind: 'Insect compound eye',
    caption: 'Part of the compound eye of a bee. Each six-sided facet is the lens of one ommatidium, and long hairs grow between the facets.',
    credit: SECRETDISC, licence: 'CC BY-SA 3.0', licenceUrl: CC_BY_SA_3,
    source: 'https://commons.wikimedia.org/wiki/File:Bee%C2%B4s_eye_SEM_anaglyph.JPG',
  },
  {
    id: 'aphid', file: 'aphid.glb', method: 'stereo',
    title: 'Black bean aphid', kind: 'Insect (Aphis fabae)',
    caption: 'The head, antennae and legs of a black bean aphid on a plant surface, at 100 times.',
    credit: SECRETDISC, licence: 'CC BY-SA 3.0', licenceUrl: CC_BY_SA_3,
    source: 'https://commons.wikimedia.org/wiki/File:Aphis_fabae_STEREO,_0100x.JPG',
  },
  {
    id: 'alchemilla', file: 'alchemilla.glb', method: 'stereo',
    title: 'Lady’s mantle leaf', kind: 'Plant (Alchemilla), lower leaf surface',
    caption: 'The underside of a lady’s mantle leaf, dried in air and coated with 15 nm of platinum. The long twisted strands are leaf hairs.',
    credit: SECRETDISC, licence: 'CC BY-SA 3.0', licenceUrl: CC_BY_SA_3,
    source: 'https://commons.wikimedia.org/wiki/File:Alchemilla_SEM_Stereo_500x.JPG',
  },
  {
    id: 'puffball', file: 'puffball.glb', method: 'stereo',
    title: 'Puffball spores', kind: 'Fungus spores',
    caption: 'Spores of a puffball fungus on a flat support, at 2000 times. Each spore is about 4 µm across and has short spines.',
    credit: SECRETDISC, licence: 'CC BY-SA 3.0', licenceUrl: CC_BY_SA_3,
    source: 'https://commons.wikimedia.org/wiki/File:Puffball_spores_in_SEM_stereoscopic,_magnification_2000x.JPG',
  },
  {
    id: 'dragonfly', file: 'dragonfly.glb', method: 'stereo',
    title: 'Dragonfly larva skin', kind: 'Insect cuticle (shed skin)',
    caption: 'The empty skin that a dragonfly larva left when it moulted, coated with 25 nm of platinum. Plates of cuticle meet at seams with small spines.',
    credit: SECRETDISC, licence: 'CC BY-SA 3.0', licenceUrl: CC_BY_SA_3,
    source: 'https://commons.wikimedia.org/wiki/File:Dragonfly_larva_skin_SEM_stereo_100x.png',
  },
  {
    id: 'glass-fibre', file: 'glass-fibre.glb', method: 'stereo',
    title: 'Glass fibre plastic, broken', kind: 'Material (fracture surface)',
    caption: 'The broken surface of a glass-fibre reinforced plastic. The short cylinders are glass fibres that pulled out of the plastic; the holes are where fibres pulled out of the other half.',
    credit: SECRETDISC, licence: 'CC BY-SA 3.0', licenceUrl: CC_BY_SA_3,
    source: 'https://commons.wikimedia.org/wiki/File:Glass_reinforced_plastic_SEM_Stereo_200x.JPG',
  },
];

export const METHOD_LABEL = {
  mesh: 'SEM photogrammetry · all sides',
  stereo: 'SEM stereo pair · one side',
};

export const SEM_ABOUT = [
  'A scanning electron microscope (SEM) moves a fine electron beam over a surface and counts the electrons that come back. One SEM image is flat, but two or more images from different angles hold the depth.',
  'The four plankton and fossil objects are 3D meshes made by SEM photogrammetry: the authors took many SEM images around each specimen and joined them into one closed surface.',
  'The other six are height maps that this page made from SEM stereo pairs (two images with the specimen tilted by a few degrees). A computer matches each point in the two images; the shift between them gives the height. A stereo pair sees only one side, so the back and the steep sides are open. The image scale bar gives the width. The tilt angle is not recorded, so the heights use 4 degrees, estimated from the round puffball spores; heights can be wrong by a factor of about 1.5.',
  'The grey shading copies an SEM: edges that turn away from the beam are bright, and the light comes from a side detector.',
];

export function scanById(id) { return SCANS.find((s) => s.id === id) || null; }
