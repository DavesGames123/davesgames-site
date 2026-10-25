# Electron Microscopy Explorer: data credits

The page streams image tiles live from the public archives below. No image
data is copied into this repository. The repository holds only metadata:
dataset records, bookmark positions and captions (`catalog/`).

Every dataset here is open data under the Creative Commons Attribution 4.0
International licence (CC BY 4.0,
https://creativecommons.org/licenses/by/4.0/). The licence statements and
credit requests below were read from each dataset's own pages on
2026-10-25.

## Fly hemibrain (`hemibrain`)

- Data: Janelia FlyEM hemibrain, 8 nm FIB-SEM, JPEG precomputed volume
  `https://storage.googleapis.com/neuroglancer-janelia-flyem-hemibrain/emdata/clahe_yz/jpeg`
- Licence: CC BY 4.0. The FlyEM page says: "Hemibrain is licensed under
  CC-BY" and links to CC BY 4.0.
- Credit: Janelia FlyEM hemibrain. Scheffer, L. K. et al. (2020). A
  connectome and analysis of the adult Drosophila central brain. eLife 9,
  e57443.
- Links: https://www.janelia.org/project-team/flyem/hemibrain ·
  https://doi.org/10.7554/eLife.57443
- Bookmark sources: two synapse positions come from the public hemibrain
  v1.2 synapse annotation layer
  (`gs://neuroglancer-janelia-flyem-hemibrain/v1.2/synapses`, spatial0
  sample, confidence above 0.98). The other places come from a survey of
  the image data.

## Mouse visual cortex, MICrONS (`minnie65`)

- Data: MICrONS cortical mm^3, 8 x 8 x 40 nm serial-section TEM,
  precomputed volume on BossDB
  `https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em`
- Licence: CC BY 4.0. The MICrONS Explorer terms
  (https://www.microns-explorer.org/terms-and-conditions) say: "We are making all
  the material on this website available under the Creative Commons
  Attribution 4.0 International".
- Credit: the citation policy asks to cite the source "in a manner that is
  clear, accurate and easily discoverable" and to link to
  www.microns-explorer.org. MICrONS Consortium et al. (2025). Functional
  connectomics spanning multiple areas of mouse visual cortex. Nature 640,
  435-447.
- Links: https://www.microns-explorer.org/cortical-mm3 ·
  https://doi.org/10.1038/s41586-025-08790-w ·
  https://bossdb.org/project/microns-minnie
- Bookmark sources: a survey of the image data.

## Human cortex, H01 (`h01`)

- Data: H01 release 2021-06-01, 4 x 4 x 33 nm multibeam SEM, precomputed
  volume `gs://h01-release/data/20210601/4nm_raw` (read through the GCS
  JSON API, which sends CORS headers).
- Licence: CC BY 4.0. The H01 data page says: "All released datasets are
  licensed under a Creative Commons Attribution 4.0 License".
- Credit: H01 dataset, released by the Lichtman Laboratory at Harvard
  University and the Connectomics team at Google. Shapson-Coe, A. et al.
  (2024). A petavoxel fragment of human cerebral cortex reconstructed at
  nanoscale resolution. Science 384, eadk4858.
- Links: https://h01-release.storage.googleapis.com/landing.html ·
  https://doi.org/10.1126/science.adk4858
- Tissue: the paper abstract says "a cubic millimeter of human temporal
  cortex that was surgically removed to gain access to an underlying
  epileptic focus" (read on Crossref, 2026-10-25).
- Bookmark sources: the blood-vessel view is the published H01 view
  `data/20210601/neuroglancer_states/bv_2d.json`. Two synapse positions
  come from the published synapse annotation layer
  (`data/20210601/c3/synapses/precomputed`, spatial0 sample, type
  excitatory). The other places come from a survey of the image data.

## OpenOrganelle cells and tissue (`jrc_hela-2`, `jrc_jurkat-1`, `jrc_macrophage-2`, `jrc_mus-liver`)

- Data: Janelia COSEM / OpenOrganelle, enhanced FIB-SEM, OME-Zarr volumes
  `https://janelia-cosem-datasets.s3.amazonaws.com/<id>/<id>.zarr/recon-1/em/fibsem-uint8`
- Licence: CC BY 4.0. The AWS Open Data registry entry
  (https://registry.opendata.aws/janelia-cosem/) lists the licence as
  "CC-BY-4.0", managed by Janelia Research Campus.
- Credit: OpenOrganelle, Janelia COSEM project team. Xu, C. S. et al.
  (2021). An open-access volume electron microscopy atlas of whole cells
  and tissues. Nature 599, 147-151. Heinrich, L. et al. (2021). Whole-cell
  organelle segmentation in volume electron microscopy. Nature 599,
  141-146.
- Links: https://openorganelle.janelia.org/datasets/jrc_hela-2 ·
  https://openorganelle.janelia.org/datasets/jrc_jurkat-1 ·
  https://openorganelle.janelia.org/datasets/jrc_macrophage-2 ·
  https://openorganelle.janelia.org/datasets/jrc_mus-liver ·
  https://doi.org/10.1038/s41586-021-03992-4 ·
  https://doi.org/10.1038/s41586-021-03977-3
- Bookmark sources: organelle places marked `groundtruth` are the centres
  of the published CellMap ground-truth crops
  (`recon-1/labels/groundtruth/crop<N>/<class>`) for that organelle class.
  The other places come from a survey of the image data.

## Scale facts

- Synaptic vesicle size: Takamori, S. et al. (2006). Molecular anatomy of
  a trafficking organelle. Cell 127, 831-846.
  https://doi.org/10.1016/j.cell.2006.10.030
- Microtubule size: Nogales, E. (2000). Structural insights into
  microtubule function. Annual Review of Biochemistry 69, 277-302.
  https://doi.org/10.1146/annurev.biochem.69.1.277
- Red blood cell size: Diez-Silva, M. et al. (2010). Shape and
  biomechanical characteristics of human red blood cells in health and
  disease. MRS Bulletin 35, 382-388. https://doi.org/10.1557/mrs2010.571
