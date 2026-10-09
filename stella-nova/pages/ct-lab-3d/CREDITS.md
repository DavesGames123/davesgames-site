# CT Lab 3D — credits and licences

Every object on this page comes from an open source that allows reuse.
We checked each licence at its source on 2026-10-09 (the models' LICENSE.md and metadata.json, the Zenodo records' licence field). The page shows the
credit line of the selected object, and the screensaver plate shows it too.

The data files in `data/` are derived works: `tools/ct-lab-3d/` made them.
Each object is a 128³ volume of attenuation codes (`<id>.bin`), a gallery
image (`<id>.jpg`) and an entry in `data/objects.json`.

## Real CT scans

| Id | Object | Source | Licence | What we changed |
|---|---|---|---|---|
| `walnut` | Walnut 1 | H. Der Sarkissian, F. Lucka, M. van Eijnatten, G. Colacicco, S. B. Coban, K. J. Batenburg, "A cone-beam X-ray computed tomography data collection designed for machine learning", *Scientific Data* 6, 215 (2019), [doi:10.1038/s41597-019-0235-y](https://doi.org/10.1038/s41597-019-0235-y). Data: [doi:10.5281/zenodo.2686726](https://doi.org/10.5281/zenodo.2686726) (`Walnut1.zip`, `Reconstructions/full_AGD_50_*.tiff`) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Every 4th slice, 4 × 4 pixel means, scaled so that the shell is mu at 70 keV, padded to 128³. |
| `rabbit` | Post-mortem rabbit (RabbitCT) | C. Rohkohl, B. Keck, H. G. Hofmann, J. Hornegger, "RabbitCT — an open platform for benchmarking 3D cone-beam reconstruction algorithms", *Medical Physics* 36(9):3940–3944 (2009), [doi:10.1118/1.3180956](https://doi.org/10.1118/1.3180956). Data: [doi:10.5281/zenodo.21267885](https://doi.org/10.5281/zenodo.21267885) (`reference_256.vol`) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 2³ block means to 128³, air noise and the outside of the field-of-view cylinder set to 0, values scaled to mu at 70 keV. |

## 3D models (voxelized)

All from the Khronos Group [glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets)
(folder `Models/<Name>/glTF`). We read the geometry only: no texture, no
logo. Each part got a material and a fill mode (solid, a wall, or a shell),
so the insides of these objects are our choice, not a scan.

| Id | Model | Author | Licence | Materials we gave it |
|---|---|---|---|---|
| `skull` | ScatteringSkull | Vladimir Petkovic | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | a 6 mm bone wall around air |
| `watch` | ChronographWatch | Eric Chadwick (Darmstadt Graphics Group), from "Chronograph Watch Mudmaster" by graphiccompressor (CC BY 4.0) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | steel case, bezel, buttons and clasp; glass face; aluminium dial; plastic and carbon-fibre bands |
| `amber` | MosquitoInAmber | Loïc Norgeot (model), Geoffrey Marchal (mosquito scan), via Sketchfab | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | resin block; the insect's body as air, its skin as chitin; cracks as air |
| `teacup` | DiffuseTransmissionTeacup | Poly Haven and Eric Chadwick | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | porcelain cup and saucer |
| `toycar` | ToyCar | Guido Odendahl and Eric Chadwick | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | plastic body, glass windows, a fabric cloth |
| `pot` | PotOfCoals | Eric Chadwick (Darmstadt Graphics Group) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | copper pot, coals |

The Khronos, DGG and UX3D trademarks and logos in some of these models are
not used: we read no textures.

## Code

The scan and reconstruction code is ours (`lib/`, and the CT lab's
`../ct-lab/engine`, `../ct-lab/view3d`). The algorithms are textbook:
Joseph (1982) projector, Feldkamp, Davis and Kress (1984) FDK, SIRT
(Gilbert 1972). The real tool for this work is the
[ASTRA Toolbox](https://github.com/astra-toolbox/astra-toolbox)
(W. van Aarle et al., *Ultramicroscopy* 157 (2015) 35–47,
[doi:10.1016/j.ultramic.2015.05.002](https://doi.org/10.1016/j.ultramic.2015.05.002);
*Optics Express* 24(22) (2016) 25129–25147,
[doi:10.1364/OE.24.025129](https://doi.org/10.1364/OE.24.025129)). We did not
copy or port its code (GPL-3.0).

## Rebuild

```
python3 -I tools/ct-lab-3d/volumes.py fetch-walnut /tmp/walnut125.npy   # about 90 MB of range reads
python3 -I tools/ct-lab-3d/volumes.py walnut /tmp/walnut125.npy
python3 -I tools/ct-lab-3d/volumes.py rabbit reference_256.vol          # 64 MB from Zenodo 21267885
node tools/ct-lab-3d/build-meshes.mjs <glTF-Sample-Assets>/Models-folders
python3 -I tools/ct-lab-3d/volumes.py thumbs -
```
