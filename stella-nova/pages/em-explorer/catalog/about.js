// em-explorer CATALOG: the "about the data" text and the scale facts.
//
// ABOUT is plain text for the CORE about sheet: { title, paragraphs,
// sections: [{ title, paragraphs }] }. CORE sets it with textContent.
// SCALE_FACTS are sizes of things a reader can find in the data, each with
// a source, for captions, the saver plate or a scale hint.
//
// Find things (grep -n): 'export const ABOUT'  'export const SCALE_FACTS'

export const ABOUT = {
  title: 'About the data',
  paragraphs: [
    'Every image here streams live from public research archives. The page fetches only the small tiles you look at, so you can zoom from a whole specimen down to single membranes without a download.',
    'These are volume electron microscopy (volume EM) datasets. A light microscope cannot separate things closer than about 200 nanometres. Electrons have a far shorter wavelength, so an electron microscope can show membranes, vesicles and the folds inside mitochondria, which are only a few nanometres across.',
  ],
  sections: [
    {
      title: 'How a block of tissue becomes a 3D image',
      paragraphs: [
        'The sample is first fixed, stained with heavy metals such as osmium and uranium, and set in hard resin. The metals stick to membranes and proteins, so these show dark, and water and empty space show light.',
        'An electron microscope sees only a thin layer at a time. To get 3D data, the sample is imaged as a stack of very thin slices, and a computer lines up the slices into one block of voxels (3D pixels).',
      ],
    },
    {
      title: 'FIB-SEM: the hemibrain and the OpenOrganelle cells',
      paragraphs: [
        'In focused ion beam scanning electron microscopy (FIB-SEM), a beam of gallium ions mills a few nanometres off the face of the block, then a scanning electron beam images the fresh face. The cycle repeats thousands of times.',
        'Because the mill step can be as fine as the pixel size, FIB-SEM data can look the same from every direction (isotropic voxels, for example 8 x 8 x 8 nm). That is why the xz and yz views of these datasets look as sharp as xy. For the fly brain, the Janelia team first cut the sample into slabs with a heated knife, so that each slab fits the slow FIB-SEM.',
      ],
    },
    {
      title: 'Serial-section EM: MICrONS and H01',
      paragraphs: [
        'For the two big cortex volumes, a diamond knife cut the block into thousands of ultrathin sections, about 30 to 40 nm thick, which were collected on tape. Each section was then imaged: by transmission EM (TEM) for MICrONS and by a 61-beam scanning EM for H01.',
        'Each section is sharp in its own plane (4 to 8 nm pixels) but the step between sections is 33 to 40 nm. So views across the sections (xz, yz) look stretched and a little blurred. Seams, folds and cracks in single sections are normal in such data.',
      ],
    },
    {
      title: 'What you are looking at',
      paragraphs: [
        'Dark rings around axons are myelin. Round or long bodies with fine inner folds are mitochondria. Clusters of small circles, about 40 nm each, are synaptic vesicles. The large round body with a double membrane and dark clumps is the nucleus. White spaces in tissue are often blood vessels, or cracks made in preparation.',
        'Brightness and contrast differ between datasets and between zoom levels. Use the contrast controls if an area looks flat.',
      ],
    },
    {
      title: 'Licences',
      paragraphs: [
        'All datasets here are open data under the Creative Commons Attribution 4.0 licence (CC BY 4.0). The credits list the teams and papers to cite. The bookmarked places come from published annotations and from looking through the data, and each one was checked against its image.',
      ],
    },
  ],
};

export const SCALE_FACTS = [
  { name: 'Synaptic vesicle', nm: 40, text: 'A synaptic vesicle is about 40 nm across.', source: 'https://doi.org/10.1016/j.cell.2006.10.030' },
  { name: 'Microtubule', nm: 25, text: 'A microtubule is a hollow tube about 25 nm across.', source: 'https://doi.org/10.1146/annurev.biochem.69.1.277' },
  { name: 'Human red blood cell', nm: 8000, text: 'A human red blood cell is a disc about 8 micrometres across.', source: 'https://doi.org/10.1557/mrs2010.571' },
];
