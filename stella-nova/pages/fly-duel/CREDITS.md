# Fly Duel: credits and licences

## Connectome data

- **Data set:** Janelia FlyEM hemibrain, release **v1.2** (neuPrint dataset
  `hemibrain:v1.2`, released 2020-12-23).
- **Files used:**
  - `exported-traced-adjacencies-v1.2.tar.gz` (the "compact connection
    matrix summary", exported 2020-12-22):
    https://storage.googleapis.com/hemibrain/v1.2/exported-traced-adjacencies-v1.2.tar.gz
  - `hemibrain-v1.2-skeletons.tar.gz`, streamed. We kept only the SWC files
    of the selected neurons, to get soma and centroid positions:
    https://storage.googleapis.com/hemibrain/v1.2/hemibrain-v1.2-skeletons.tar.gz
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/.
- **Licence text source:** the Janelia hemibrain project page,
  https://www.janelia.org/project-team/flyem/hemibrain, which says
  "Hemibrain is licensed under CC-BY" and links to CC BY 4.0. Read on
  2026-10-11.
- **Downloaded:** 2026-10-11, by `tools/build-connectome.mjs`.
- **Attribution:** Scheffer LK, Xu CS, Januszewski M, et al. A connectome
  and analysis of the adult Drosophila central brain. eLife 9, e57443
  (2020). https://doi.org/10.7554/eLife.57443
- **Why v1.2, not v1.2.1:** v1.2.1 is a neuPrint dataset only. The public
  bulk exports in the `hemibrain` bucket (listed on 2026-10-11) are v1.2.
  A v1.2.1 export needs a neuPrint account token, which this build does
  not use.

### What we changed (CC BY 4.0 requires that we say so)

`data/connectome.json` is a derived subset, not the full data set.

- We kept the mushroom body circuit of the right hemisphere: 108
  uniglomerular projection neurons, 1,927 Kenyon cells, 48 MBONs, 312
  dopaminergic neurons (PAM, PPL1, PPL2) and the APL neuron.
- We removed connections below a synapse threshold (3 synapses for PN to
  KC and KC to MBON, 5 for DAN to MBON). `meta.thresholds` in the file
  holds the values.
- We parsed the compartment of each MBON and DAN from its hemibrain
  instance name (Aso et al. 2014 notation).
- We added an approach or avoid sign for each MBON. This sign is a model
  rule (PAM compartment = -1, PPL1 compartment = +1). It is not part of
  the hemibrain data.
- We converted positions from 8 nm voxels to micrometres and rounded them
  to 0.1 um.

## Connectome data, Fly B: FlyWire

Fly B has the wiring of a second animal. The hemibrain and FlyWire are
two different adult female flies.

- **Data set:** FlyWire whole-brain connectome of the FAFB volume,
  materialization **783** (Dorkenwald et al. 2024), with the cell-type
  annotations of Schlegel et al. 2024.
- **Files used:**
  - `proofread_connections_783.feather` from Zenodo record 10676866
    ("FlyWire Whole-brain Connectome Connectivity Data", version 783.0,
    published 2024-06-02, creator FlyWire Consortium):
    https://zenodo.org/records/10676866, DOI 10.5281/zenodo.10676866.
  - `flywire_annotations-v3.2.0.zip` from Zenodo record 23037340
    ("flyconnectome/flywire_annotations: Version 3.2.0", published
    2026-09-29): https://zenodo.org/records/23037340, DOI
    10.5281/zenodo.23037340. We used `Supplemental_file1_neuron_annotations.tsv`
    (cell class, cell type, hemibrain type, side, positions) and
    `Supplemental_file5_hemibrain_meta.csv` (hemibrain instance names, for
    the compartments).
- **Licence:** CC BY 4.0, https://creativecommons.org/licenses/by/4.0/,
  for both files.
- **Licence text source:** the licence field of each Zenodo record
  ("cc-by-4.0", read from https://zenodo.org/api/records/10676866 and
  https://zenodo.org/api/records/23037340 on 2026-10-11). The GitHub
  repository flyconnectome/flywire_annotations has no licence file, so we
  used the Zenodo archive of the release, which has the CC BY 4.0 licence.
- **Downloaded:** 2026-10-11, by `tools/build-connectome-flywire.mjs`.
- **Attribution:** Dorkenwald S, Matsliah A, Sterling AR, et al. Neuronal
  wiring diagram of an adult brain. Nature 634, 124-138 (2024),
  https://doi.org/10.1038/s41586-024-07558-y. Schlegel P, Yin Y, Bates AS,
  et al. Whole-brain annotation and multi-connectome cell typing of
  Drosophila. Nature 634, 139-152 (2024),
  https://doi.org/10.1038/s41586-024-07686-5. The repository asks that
  users of release 3.2.0 also cite Berg et al. (2026), Tastekin et al.
  (2026) and Matsliah et al. (2024). Synapse detection: Buhmann J et al.
  Nature Methods 18, 771-774 (2021),
  https://doi.org/10.1038/s41592-021-01183-7.

### What we changed (CC BY 4.0 requires that we say so)

`data/connectome-flywire.json` is a derived subset, not the full data set.

- We kept the mushroom body circuit of the right hemisphere (soma side
  "right" in the annotations, the same side as the hemibrain MB): 121
  uniglomerular projection neurons, 2,597 Kenyon cells, 38 MBONs, 161
  dopaminergic neurons (PAM, PPL1, PPL2) and the APL neuron.
- We summed the synapse counts of each neuron pair over all neuropils.
  Then we removed connections below the same thresholds as the hemibrain
  file (3 synapses for PN to KC and KC to MBON, 5 for DAN to MBON).
- FlyWire has no instance names. We gave each MBON and DAN the
  compartments of the hemibrain instances of its hemibrain type (Aso et
  al. 2014 notation). The `instances` strings in the file are made by us
  in hemibrain style. They are not FlyWire names.
- We added the same model approach or avoid sign for each MBON as in the
  hemibrain file. It is not part of the FlyWire data.
- We converted positions from 4 x 4 x 40 nm voxels to micrometres and
  rounded them to 0.1 um. They stay in FAFB space, not hemibrain space.
  `cen` is the FlyWire anchor point on the neurite, not a centroid.
- Root ids are stored as strings, because they have 18 digits.

### The two flies compared (measured from the two shipped files)

| Count (right MB, same thresholds) | Fly A: hemibrain v1.2 | Fly B: FlyWire 783 |
|---|---:|---:|
| Kenyon cells | 1,927 | 2,597 |
| γ / α′β′ / αβ KCs | 701 / 337 / 889 | 1,270 / 467 / 860 |
| KCg-m (largest subtype) | 590 | 1,120 |
| KCs with uPN input | 1,750 | 2,378 |
| uPNs | 108 | 121 |
| uPN partners per KC, mean (median) | 5.56 (5) | 4.61 (5) |
| PN to KC synapses | 172,651 | 140,468 |
| MBONs | 48 | 38 |
| DANs (PAM / PPL1 / PPL2) | 312 (298 / 11 / 3) | 161 (149 / 10 / 2) |
| KC to MBON connections | 24,370 | 17,033 |
| KC to MBON synapses | 309,004 | 103,800 |

The two data sets use different synapse detection methods. The KC to MBON
synapse total in FlyWire is about one third of the hemibrain total. Some
MBONs and DANs therefore fall below the same threshold in FlyWire (for
example MBON10 and PAM12 cells). The KC count difference is in the
annotated cell counts and does not depend on a threshold.

## Literature

All numbers on the page come from `data/facts.js`, which lists each
source with its DOI. We resolved every DOI through doi.org on 2026-10-11.
Run `FLY_DUEL_NET=1 node tests/data.test.mjs` to resolve them again.

## Trademark

The card game on this page is our own design, inspired by Magic: The
Gathering. All card names, card text, symbols and art are original.
Not affiliated with or endorsed by Wizards of the Coast.
