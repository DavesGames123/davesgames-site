# Image to Three.js: sources and licences

## img2threejs (Apache License 2.0)

The three models on this page were generated with the img2threejs skill by its
authors: <https://github.com/img2threejs/img2threejs> (Apache-2.0,
<https://www.apache.org/licenses/LICENSE-2.0>, project site
<https://img2threejs.io>).

The skill (version 2.0.0, commit 6e60b5e of img2threejs/img2threejs; its pipeline,
scripts and the `generate_threejs_factory.py` generator) was run locally on reference images chosen for this page. Its output
is the set of factories in `models/<id>/<pass>.js`: the generator's TypeScript,
transpiled to JavaScript with the types removed and the map paths pointed at
`models/<id>/maps/`. The factories contain helper functions (lathe, tapered
sweep, extrude, material and texture builders) that the generator emits from
its own templates, so the Apache-2.0 licence text ships here as
`LICENSE-img2threejs.txt`. No other file of the skill is copied.

The img2threejs showcase gallery (<https://img2threejs.io>, repository
img2threejs/img2threejs-showcase) belongs to its authors and carries no
licence. None of its models or code are used on this page.

## Reference drawings (CC0 1.0)

All three are watercolour renderings from the National Gallery of Art's Index
of American Design, released under CC0 1.0 (public domain dedication) and hosted
on Wikimedia Commons. Stored here cropped to the object and downscaled to at most 800 px as `refs/<id>.jpg`.

| File | Artist | Work | ID | Source |
|---|---|---|---|---|
| refs/kettle.jpg | Clyde L. Cheney | Copper Tea Kettle, 1935-1942 | NGA 27044 | https://commons.wikimedia.org/wiki/File:Clyde_L._Cheney,_Copper_Tea_Kettle,_1935-1942,_NGA_27044.jpg |
| refs/chair.jpg | Clyde L. Cheney | Wooden Chair, c. 1938 | NGA 16658 | https://commons.wikimedia.org/wiki/File:Clyde_L._Cheney,_Wooden_Chair,_c._1938,_NGA_16658.jpg |
| refs/lantern.jpg | Alfred Farrell | Coal Oil Lantern, c. 1939 | NGA 24331 | https://commons.wikimedia.org/wiki/File:Alfred_Farrell,_Coal_Oil_Lantern,_c._1939,_NGA_24331.jpg |

The PBR maps in `models/<id>/maps/` were extracted from crops of these drawings
by the skill's `extract_pbr_evidence.py`, so they carry the same CC0 status.
