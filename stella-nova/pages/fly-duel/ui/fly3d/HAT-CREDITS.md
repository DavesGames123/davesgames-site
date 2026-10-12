# Fedora model credit

The fedora that the competitor fly wears in play mode is this model:

- Title: "Fedora"
- Author: Mac BanCheese (Printables user MacBanCheese_1794352)
- Source page: https://www.printables.com/model/804464-fedora (Printables),
  published 2024-06-15
- Source file: "fedora thin brim.stl" (Printables file id 3449527),
  sha256 f2403b7e1f1c58cbdb85b67e3e726a020b6ac859aced276e67cd16ddf486ca6d,
  134804 triangles
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/
- Licence checked on 2026-10-12. The Printables model data for print
  804464 (api.printables.com/graphql, the data that the page shows) gives
  the licence "Creative Commons — Attribution", abbreviation "CC-BY", with
  the text "This work is licensed under a Creative Commons (4.0
  International License) Attribution" and a link to
  http://creativecommons.org/licenses/by/4.0/. The same licence block
  marks "Commercial Use" and "Remix Culture allowed" as permitted.

## Changes we made

We changed the model. The file in this repository is
`models/fedora.glb`, and it is not the original file.

- We used the thin-brim file, not the thick-brim print file.
- We turned the axes to head-local axes: +Y up, the front of the hat to +Z.
- We moved the origin to the crown centre at the bottom edge of the band.
- We divided the hat into three parts: crown, brim and band.
- We removed the inner disc and the inner wall of the band. They are
  inside the crown and cannot be seen.
- We pressed a centre crease into the crown top, along the front-back
  line. The source crown top has only a shallow groove.
- We simplified the mesh from 134804 to 4514 triangles
  (gltf-transform 4.1.1 weld and simplify, meshoptimizer).
- We scaled the hat to the head-local units of `ui/fly3d/fly.js`.
  The brim is 0.495 wide, about 1.65 times the head width.
- We calculated new normals (50 degree crease angle).
- We added a brown felt material and a dark band material.

Mac BanCheese does not endorse this page or this use of the model.

## Previous model

Before 2026-10-12 the fly wore "Fedora" by Poly by Google (Poly Pizza,
poly.pizza/m/8TpZrCG3aRf, CC BY 3.0). The user said that its shape was
not correct, so we replaced it. No part of that model stays in this
repository.

## Candidates we did not use

We searched on 2026-10-12.

- Sketchfab has many CC BY fedoras, but a download needs a signed-in
  account (the download API gave HTTP 401). We did not use Sketchfab.
- Poly Pizza: "Adventurers Hat" by Michael Fuchs (CC BY 3.0) has a brim
  that curls up like a cowboy hat. The other results were cowboy hats,
  top hats, caps and other hats that are not fedoras.
- Printables: "Red Sparkletime Fedora" is copied from Roblox, and
  "Among Us Fedora" is for Among Us figures. We did not use them,
  because the licence of the original design is not clear.
- Poly Haven, OpenGameArt and Smithsonian Open Access gave no fedora.
