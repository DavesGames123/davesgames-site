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

## Literature

All numbers on the page come from `data/facts.js`, which lists each
source with its DOI. We resolved every DOI through doi.org on 2026-10-11.
Run `FLY_DUEL_NET=1 node tests/data.test.mjs` to resolve them again.

## Trademark

The card game on this page is our own design, inspired by Magic: The
Gathering. All card names, card text, symbols and art are original.
Not affiliated with or endorsed by Wizards of the Coast.
