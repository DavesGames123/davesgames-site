# Neuropil outline: credits

The 3D brain map (`ui/fly3d/brain3d.js`) draws the outline of the right
mushroom body and the right antennal lobe from `data/neuropil-hemibrain.json`.
This file is the credit for that data. `CREDITS.md` holds the credit for the
connectome wiring.

- Data: Janelia FlyEM hemibrain v1.2, region-of-interest (ROI) surface meshes.
- Regions: CA(R) calyx, PED(R) pedunculus, aL(R), a'L(R), bL(R), b'L(R),
  gL(R) lobes, AL(R) antennal lobe (ROI ids 13, 37, 57, 55, 61, 59, 63, 4 in
  `rois/segment_properties/info`).
- URL: https://storage.googleapis.com/neuroglancer-janelia-flyem-hemibrain/v1.2/rois/mesh/
  (neuroglancer precomputed, multi-resolution Draco meshes).
- Retrieved: 2026-10-11.
- Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), as
  stated for the hemibrain data on
  https://www.janelia.org/project-team/flyem/hemibrain.
- Citation: Scheffer LK et al. (2020) A connectome and analysis of the adult
  Drosophila central brain. eLife 9:e57443. doi:10.7554/eLife.57443.

## What we changed

`tools/build-neuropil.mjs` decodes the level-of-detail 1 meshes (the second
finest of four, about 2 um), converts them to micrometres, rounds each vertex
to 0.1 um and merges equal vertices. It does not change the shapes in another
way. The brain map draws the mesh edges with a crease angle of 28 degrees and
a faint surface. The Draco decoder (`draco3d` 1.5.7, Apache-2.0) runs only in
the build tool. The site does not ship it.

The outline is shown only for a connectome file in the hemibrain frame. A
FlyWire (FAFB) file has no matching meshes here, so its map shows the neurons
without an outline.
