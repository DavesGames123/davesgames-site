# engine/

Byte copies of the star map nebula engine, from the star map artifact v26
(published build, 2026-11-22). The source repo is on the Windows machine
(star map session astrotechs-7e). Keep these files byte-identical to it:
the shipped volume data/volume-w.smv carries the SHA-256 of the composition
and of every shader text, and a change to any of them makes the page bake
live at load (tests.mjs checks the match).

Copied: bake/, gl/{context,passes,registry}.js, render/ (no tunnels.js),
shaders/, data/composition.js, look/shuffle.js, params.js, boot-compile.js.

Left out on purpose: the route map (map/, data/v67-graph.js, render/tunnels.js),
the artifact UI (ui/, main.js, css/), io/png.js and the Hairline vendor copy.
The page code (../main.js, ../scroll.js, ../look.js, ../saver.js) replaces them.

Not yet in these copies: the outer-repo commits of 2026-11-22, df341f0
(fade-in fix) and 825cc16 (frames-in-flight limit). ../main.js has its own
frames-in-flight limit (MAX_IN_FLIGHT). To take a newer engine, copy the
files again and run `node ../tests.mjs`. If the shader hash test fails,
ship a new data/volume-w.smv from the same build.
