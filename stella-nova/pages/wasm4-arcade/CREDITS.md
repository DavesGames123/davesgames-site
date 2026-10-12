# WASM-4 Arcade: credits and licences

This page runs carts for WASM-4, an open fantasy console by Bruno Garcia and contributors (https://wasm4.org, https://github.com/aduros/wasm4). The page does not load, link or mirror any commercial game or ROM.

## Runtime

`runtime/` is a JavaScript port of the WASM-4 web runtime (runtimes/web/src). Licence: ISC, Copyright (c) Bruno Garcia. The full text is in `runtime/LICENSE.txt`. The CRT shader, the cabinet, the input layer and the saver are our own.

## Carts

Each cart below is the binary that the wasm4.org showcase serves (aduros/wasm4, commit 9d6c962, site/static/carts). Each source repository has a licence that permits redistribution. The full licence text of each cart is in `carts/licenses/<id>.txt`. The sha256 values are in `carts.json`.

| Cart | Author | Source | Licence | Notice |
|---|---|---|---|---|
| 2048 | Peter Hellberg | https://github.com/peterhellberg/w4-2048 | MIT | Copyright (c) 2021 Peter Hellberg - https://c7.se |
| It's Corn! | Sander in 't Veld | https://github.com/SLiV9/corn | MIT | Copyright (c) 2022 Sander in 't Veld |
| Dodgeball | Sander in 't Veld | https://github.com/SLiV9/dodgeball-wasm-4 | MIT | Copyright (c) 2022 Sander in 't Veld |
| Earth Invaders | Yara F. Scramin | https://github.com/yarafs/earth-invaders | MIT | Copyright (c) 2025 yarafs |
| Escape Guldur | Chris Heyes | https://github.com/hazeycode/escape-guldur | MIT | Copyright (c) 2022 Chris Heyes |
| First Flight | bootra (boo and tra) | https://github.com/bootradev/first-flight | MIT | Copyright (c) 2022 bootra |
| Glowfish Chess | analog-hors | https://github.com/analog-hors/glowfish | MIT | Copyright (c) 2021 analog-hors |
| Hammer Joe | MFauzan26 | https://github.com/MFauzan26/Hammer-Joe | MIT | Copyright (c) 2022 MFauzan26 |
| Kitty Game | Cannon Tuttle | https://github.com/CanyonTurtle/kittygame | ISC | Copyright (c) CanyonTurtle |
| Lad 2024 | YAMAMOTO Takashi | https://github.com/yamt/lad2024 | BSD-2-Clause | Copyright (c)1994,2024,2025,2026 YAMAMOTO Takashi, |
| Mazethingie | Davy Willems | https://github.com/joyrider3774/mazethingie_wasm4 | MIT | Copyright (c) 2022 Willems Davy |
| Rubido | Davy Willems | https://github.com/joyrider3774/rubido_wasm4 | MIT | Copyright (c) 2024 Willems Davy |
| Space Delivery | kirinokirino | https://github.com/kirinokirino/space-delivery | MIT | Copyright (c) 2022 kirinokirino |
| Tau Flight Simulator | Jonathan Hähne (tau-dev) | https://github.com/tau-dev/tau-flight | MIT | Copyright © 2023 Jonathan Hähne |
| Tic Tac Toe | Christopher Kleine | https://github.com/christopher-kleine/tic-tac-toe-wasm4 | BSD-2-Clause | Copyright (c) 2021, Chris |
| Untangle | Mota Link | https://github.com/Mota-Link/untangle-rs | MIT | Copyright (c) [2023] [Mota Link] |
| Waternet | Davy Willems | https://github.com/joyrider3774/waternet_wasm4 | MIT | Copyright (c) 2022 Willems Davy |
| You Will Return | Sander in 't Veld | https://github.com/SLiV9/you-will-return | MIT | Copyright (c) 2022 Sander in 't Veld |
| ZxZ | Ścisław Dercz | https://github.com/drcz/ZxZ | BSD-2-Clause | Copyright (c) 2022, Ścisław Dercz (Michał Jędrzej Stańczyk) |

## Carts not on the shelf, and why

We looked at the 150 or so carts of the wasm4.org showcase. We kept a cart only when its source repository has a licence file that permits redistribution (MIT, ISC, Apache-2.0, BSD, CC0, CC-BY, zlib or Unlicense) and nothing in it points to third-party art with unknown terms.

- No licence file in the source repository (all rights reserved): break-it, lava-hop, panelpon4, PING, wasm4-rpg, wasmstein3d, meteoroids, miniciv, tankbattle, starfighter arena and creator, ioccc98flightsim, seal-adventure, wired, punch-em-up, strikeforce, starshard-scavengers, tankle, to-the-core, zigtris (the linked zigtris-wasm4), antcopter, lime-volleyball and about 90 more with no source link that we could verify.
- GPL-3.0, AGPL-3.0 or MPL-2.0 (not in the permitted list for this page): glitch-dungeon, tank-wars, tinypong, wasm4-city, zoopzoop, assemblio, wloku, journey-to-the-steam-planet, game-of-life, minesweeper, micro-quest.
- ISC only because the repository is a fork of the WASM-4 runtime (the licence is that of the console, not a grant by the game author): comic-sans, cosmic-hopper, particle-editor.
- Third-party art with terms that we could not verify: bombfighters (Apache-2.0, but it embeds an OpenZoo font) and the-romans-are-coming (MIT, but its wreath art is by another artist).
- Close to a commercial brand or a named commercial game: formula-1 (a Game & Watch remake), legend-of-geml (a Zelda pastiche), wasm-wars (an Advance Wars clone), pixel-vs-zombies, wasminvaders and zigtris-w4 (a Tetris clone).
- A player of game music files: wasm4-gbvgm-player.
