# Fedora model credit

The fedora that the competitor fly wears in play mode is this model:

- Title: "Fedora"
- Author: Poly by Google
- Source page: https://poly.pizza/m/8TpZrCG3aRf (Poly Pizza)
- Source file: https://static.poly.pizza/d9ddb914-3405-47d9-9168-d297769d5914.glb
  (sha256 8b78a420c9bf97df637d00134300836912994943faccf7c4c815864bf661742f)
- Licence: Creative Commons Attribution 3.0 (CC BY 3.0),
  https://creativecommons.org/licenses/by/3.0/
- Licence checked on the source page on 2026-10-11.

## Changes we made

We changed the model. The file in this repository is
`models/fedora.glb`, and it is not the original file.

- We moved the origin to the crown centre on the brim plane.
- We scaled the model to the head-local units of `ui/fly3d/fly.js`.
  The brim is 0.51 wide, about 1.7 times the head width.
- We divided the dark source part into a brim and a band.
  The crown, the brim and the band are separate nodes.
- We replaced the two grey materials with a brown felt and a dark band.
- We removed the UV coordinates, because no texture uses them.

Poly by Google does not endorse this page or this use of the model.

## Candidates we did not use

We searched Poly Pizza for "fedora" on 2026-10-11.

- "Hat Stylised" by hat_my_guy (poly.pizza/m/lNN3PlrjSa) is CC0 1.0.
  The shape is a generic stylised hat and the title does not say fedora.
  The user asked for "an actual model fedora", so we used the model
  with the title "Fedora".
- "hat" by Minh Nguyen Tri (poly.pizza/m/8FHt9iCkDtG, 4Tdb1s3-kug,
  d_AsyX_R-S3) is CC BY 3.0. The shapes are a cowboy hat and a bowler.
- The other results were cowboy hats, top hats, a propeller hat, a fox
  hat and a Santa hat.
