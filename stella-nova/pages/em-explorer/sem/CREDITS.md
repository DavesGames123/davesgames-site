# Surface scans: credits and licences

The "Surface scans" mode of the Electron Microscopy Explorer shows ten 3D
surfaces made with scanning electron microscopes (SEM). Each licence below
was read on the item's own record on 2026-10-25. The build script
`sem/build/build.py` downloads each file by the URL and checksum in
`sem/build/sources.json` and writes the GLB files in `sem/models/`.

## 3D meshes from SEM photogrammetry (CC BY 4.0)

The authors took many SEM images round each specimen and joined them into
one closed mesh. This page decimates each mesh (quadric, to 90 000 to 120 000
triangles), turns it so the long axis is horizontal, and, for the two
fossils, copies the grey of their texture to the vertices. Nothing else is
changed.

| Scan | Record | Licence (as on the record) |
|---|---|---|
| Prorocentrum micans (dinoflagellate) | Xuerong Sun, "STL file of Prorocentrum micans", Figshare, https://doi.org/10.6084/m9.figshare.25764384 | CC BY 4.0 |
| Halamphora sp. (diatom) | Xuerong Sun, "STL file of Halamphora sp.", Figshare, https://doi.org/10.6084/m9.figshare.25764540 | CC BY 4.0 |
| Pistoprion sp. (scolecodont, specimen PT172_1, K57, Kosov Quarry, Ludlow, Czech Republic) | Petra Tonarová, Ondřej Svagera, Martina Nohejlová, "3D photogrammetry models of chitinozoa and Pistoprion created using SEM images", Figshare, https://doi.org/10.6084/m9.figshare.32896022 | CC BY 4.0 |
| Chitinozoan (specimen PT171_4, Saku Quarry, Estonia) | the same record, https://doi.org/10.6084/m9.figshare.32896022 | CC BY 4.0 |

The phytoplankton method is in: X. Sun, R. J. W. Brewin, C. Hacker,
J. J. Viljoen, M. Li (2024), "Generating open-source 3D phytoplankton
models by integrating photogrammetry with scanning electron microscopy",
Frontiers in Microbiology 15:1429179, https://doi.org/10.3389/fmicb.2024.1429179
(CC BY). The paper gives the cell sizes (P. micans about 40 by 25 µm),
which agree with the mesh units (µm).

## Height maps from SEM stereo pairs (CC BY-SA 3.0)

Each source is a red-cyan anaglyph of two SEM images at two tilts. This
page made a height map from each pair: the red channel is the left view
and the green channel is the right view; SIFT matches give the epipolar
geometry, OpenCV StereoSGBM gives the parallax, and a left-right check
removes bad matches. The scale bar in the SEM data bar gives the width.
The tilt angle is not on the records, so all heights use 4 degrees, an
estimate from the round puffball spores (their height must be about their
width). The heights can be wrong by a factor of about 1.5. A stereo pair
sees one side only, so steep sides are open. The texture is the left SEM
image.

The height maps are adaptations of the images, so they have the same
licence, CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/).
The images are also under the GFDL on Commons.

| Scan | Image (author: SecretDisc, Wikimedia Commons) | Licence |
|---|---|---|
| Bee eye, x500 | https://commons.wikimedia.org/wiki/File:Bee%C2%B4s_eye_SEM_anaglyph.JPG | CC BY-SA 3.0 |
| Black bean aphid (Aphis fabae), x100 | https://commons.wikimedia.org/wiki/File:Aphis_fabae_STEREO,_0100x.JPG | CC BY-SA 3.0 |
| Lady's mantle leaf, underside, x500 | https://commons.wikimedia.org/wiki/File:Alchemilla_SEM_Stereo_500x.JPG | CC BY-SA 3.0 |
| Puffball spores, x2000 | https://commons.wikimedia.org/wiki/File:Puffball_spores_in_SEM_stereoscopic,_magnification_2000x.JPG | CC BY-SA 3.0 |
| Dragonfly larva skin, x100 | https://commons.wikimedia.org/wiki/File:Dragonfly_larva_skin_SEM_stereo_100x.png | CC BY-SA 3.0 |
| Glass reinforced plastic, fracture, x200 | https://commons.wikimedia.org/wiki/File:Glass_reinforced_plastic_SEM_Stereo_200x.JPG | CC BY-SA 3.0 |

## Left out

- 3DSEM dataset (Tafti and others, Data in Brief 2016; MINDS@UW
  1793/90991): the data record has no licence ("free for academic use").
- Sparavigna 2025, Zenodo 14740366 (CC BY 4.0): the meshes use the grey
  level of one SEM image as the height, which is not a measured surface.
- "Fly Eye 3D SEM Image" (Commons): shape from shading of one image, 528 px.
- Ostracod stereo pairs by Kempf EK (Commons): 446 px wide, no scale bar.
- "Jumping spider fang 3D" (Commons): no scale bar.
- "Fused Electrical Filament SEM Stereo 200x" (Commons, CC BY-SA 3.0):
  built, but only 38 % of the pixels passed the left-right check (smooth
  metal, deep gaps), so the surface was mostly guessed. Not shipped.
- Sketchfab and MorphoSource SEM models: a login is needed, or the licence
  is per item and mostly NC.

## Tools

The build uses OpenCV (Apache 2.0) and fast-simplification 0.1.9 (MIT).
They run only in the build; nothing is vendored. The page code (the GLB
reader and the WebGL2 turntable) is original to this page.
