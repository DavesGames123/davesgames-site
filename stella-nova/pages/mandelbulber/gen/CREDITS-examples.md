# Example collection credits

gen/collections.json holds scenes from the example collection folders of Mandelbulber2
(github.com/buddhi1980/mandelbulber2, commit 600da8d,
`mandelbulber2/deploy/share/mandelbulber2/examples/<folder>/`). Each folder name states the
author and the licence. The page shows the author and the licence on every scene from a
collection. tools/catalog.mjs migrates each file to the current settings, as for the main
examples. It changes no value of the scene.

## Included

| Collection | Author | Licence | Files | Included |
| --- | --- | --- | --- | --- |
| gannjondal - newton- license Creative Commons (CC-BY 4.0) | gannjondal | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 8 | 8 |
| Graeme McLaren  collection - license Creative Commons  (CC-BY 4.0) | Graeme McLaren | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 350 | 322 |
| Krzysztof Marczak collection - license Creative Commons (CC-BY 4.0) | Krzysztof Marczak | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 197 | 142 |
| Robert Pancoast collection - license Creative Commons (CC-BY 4.0) | Robert Pancoast | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 30 | 24 |
| Sebastian Jennen collection - license Creative Commons  (CC-BY 4.0) | Sebastian Jennen | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 8 | 7 |

A scene is left out when it turns on a feature that the WebGPU port does not render, or when
it failed the headless render check (tools/collections-drop.json):

- Graeme McLaren:
  - amazing_surf_mod2_mandelbulb.fract: primitive objects
  - amazingIFS boxFrame.fract: textures
  - amazingIFS shroom.fract: textures
  - asurf_fakelights_backgroundl.fract: fake lights
  - asurfKlein_difsGreek.fract: primitive objects
  - boolean_boxFoldBulb_quat.fract: boolean operators (objects tree)
  - DIFS Box DiagV1 complex primitive.fract: primitive objects
  - DIFS Polyhedra_hexgrid.fract: fake lights
  - DIFS Torus polyhedron.fract: fake lights
  - fakeLights_JuliaBulb.fract: fake lights
  - KIFS_mandelbulb_trapLights.fract: fake lights
  - mandelbox_menger_inv 001.fract: textures
  - mandelbulb_boxFoldBulb_hybrid.fract: textures
  - mandelbulb_pow2V3 tglad.fract: fake lights
  - menger addConstCond.fract: primitive objects
  - MengerMid_RotVary_SphOffsetVCL.fract: textures
  - OctahedronMandalayMenger.fract: fake lights
  - pseudoKleinian_std_DE_flat_surfaces.fract: textures
  - pseudoKleinianMod4 rec.fract: primitive objects
  - spheretree_2.fract: primitive objects
  - spheretreeV4 aaa3.fract: render check: black frame (mean 0)
  - T_bxFoldInfy_menger3_bxFrame.fract: textures
  - T_bxFoldInfy_sphGrid3.fract: textures
  - T_DIFS Chessboard hybrid color.fract: fake lights
  - T-DifsTorusMenger_menger7.fract: fake lights
  - transf_sincosHelix_juliaBulb.fract: render check: flat frame (sd 0)
  - transfAbsRecFoldXY - sierpinski.fract: primitive objects
  - transfSphereInvV3_abxTetra_OT.fract: fake lights
- Krzysztof Marczak:
  - aexion06.fract: clouds
  - benesi t1 pine tree.fract: fake lights
  - bug.fract: textures
  - clouds 006.fract: clouds
  - clouds 007.fract: clouds
  - clouds 2_v2.fract: clouds
  - clouds 2_v3.fract: clouds
  - colored orbit trap menger sponge.fract: fake lights
  - Construct by Ectoplaz 2.fract: fake lights
  - dune.fract: boolean operators (objects tree)
  - GeneralizedFoldBox02.fract: primitive objects
  - GeneralizedFoldBox03_2.fract: primitive objects
  - hexgrid_v2.fract: primitive objects
  - hybrid animacja - background.fract: fake lights
  - hypercomplex v2 001.fract: clouds
  - IFS 26.fract: primitive objects
  - IFS 34.fract: fake lights
  - iter fog 007.fract: render check: black frame (mean 0)
  - iter fog 008.fract: primitive objects
  - light beam.fract: primitive objects
  - light circle.fract: clouds
  - lightning tower.fract: clouds
  - luminosity.fract: primitive objects
  - mandalay.fract: primitive objects
  - mandelbox15 - rotations.fract: fake lights
  - mandelbox24.fract: fake lights
  - mandelbox27.fract: render check: black frame (mean 0.000360088)
  - mandelbox28.fract: render check: black frame (mean 0.00248143)
  - mandelbox49.fract: primitive objects
  - mandelbox51.fract: primitive objects
  - mandelbox53.fract: primitive objects
  - mandelbox59.fract: fake lights
  - mandelbulb power 2 - slice 5.fract: primitive objects
  - mandelbulb power 3.fract: fake lights
  - mandelbulb power 4 - water.fract: primitive objects
  - mandelbulb power 8 - 4_2.fract: render check: black frame (mean 0.00392157)
  - mandelbulb power 8 - 8.fract: primitive objects
  - mandelnest.fract: fake lights
  - menger v7.fract: textures
  - modified mandelbulb 001.fract: clouds
  - monte carlo DOF 005.fract: render check: black frame (mean 0.0048275)
  - monte carlo global illumination.fract: textures
  - orbitTraps 003.fract: fake lights
  - orbitTraps 004.fract: fake lights
  - orbitTraps 005.fract: fake lights
  - orbitTraps 006.fract: fake lights
  - orbitTraps 007.fract: fake lights
  - planet.fract: boolean operators (objects tree)
  - primitive objects - inverted box.fract: primitive objects
  - primitive objects - water.fract: primitive objects
  - repeat.fract: primitive objects
  - two pseudo klienian.fract: boolean operators (objects tree)
  - volumetricLight001.fract: render check: black frame (mean 0.00187903)
  - winter (sss).fract: clouds
  - winter.fract: clouds
- Robert Pancoast:
  - box-deuce-deuce.fract: render check: black frame (mean 0.00152076)
  - hybrid77-stereo.fract: stereo
  - menger-4D.fract: stereo
  - menger-FabsAddTgladFold4D.fract: render check: black frame (mean 0.00924415)
  - neuron.fract: fake lights
  - RoadToExascale.fract: render check: black frame (mean 0.00418118)
- Sebastian Jennen:
  - hybrid 01 - mandelbox sponge with sphere.fract: primitive objects

## Excluded

These folders carry a non-commercial licence, so the site does not ship them:

- Jorge Abalo - license Creative Commons (CC-BY-NC-SA 4.0) (45 files): CC-BY-NC-SA 4.0, not free for commercial use

## Site originals

gen/originals.json holds scenes made for this site (tools/originals.mjs). They use the
Mandelbulber formulas and the same GPL-3.0 terms as the page.
