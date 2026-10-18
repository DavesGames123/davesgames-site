# Real human artwork: site audit

Date: 2026-10-18. The user asked: "let's also go out of our way to use real
human artwork". They chose two parts: a standing rule for all new work, and
an audit and replacement across the site now. This file is the audit.

## The rule for assets

1. Use only human-made art (photographs, paintings, engravings, drawings,
   scans) whose licence lets this site use it. Order of preference: CC0 or
   public domain first (Smithsonian Open Access, NASA, the Met, Rijksmuseum,
   National Gallery of Art, Art Institute of Chicago, Library of Congress,
   Wikimedia Commons files marked PD or CC0, Poly Haven, ambientCG, the
   Biodiversity Heritage Library, Internet Archive scans with the PD Mark).
   Then CC BY or CC BY-SA, with the full credit.
2. Never use NC, ND (when we crop or adapt), unknown licences, AI images
   shown as human art, or commercial game art. From the private Stella Nova
   repo, use only what its exporter publishes (`stella-nova/lib/game-data`).
3. Read the licence on the file's own page before the download. Fetch with
   the site User-Agent `davesgames-art-fetch/1.0 (+https://davesgames.io)`.
4. Put the file in `stella-nova/pages/<key>/artwork/`. Put one line for it
   in the page CREDITS.md (or CREDITS.txt): the file path, the author and
   the work, the source URL, the licence and the changes we made.
5. Keep each file at most 400 KB and 2048 px on the long side. Load it
   lazily (`loading="lazy"`, or load it on first use in code).
6. Run `node tools/credits-check.mjs <key>` before the commit. It fails on a
   file with no credits line, no https URL, no accepted licence, an NC or ND
   licence, or a file over the budget.

## Survey, ranked

Rank: value to the page against effort, with a clean licence. "Done" rows
landed in this pass. "Deferred" rows are on pages that other agents edit now.
"Open" rows are free for the next pass.

| # | Page | Procedural or placeholder now | Real human artwork (licence) | Effort | Status |
|---|---|---|---|---|---|
| 1 | sstv | The receiver opened on "Planet" and had "Sunset": both drawn from formulas to look like photos | NASA Apollo photos AS11-40-5903 (Aldrin, by Armstrong) and AS08-14-2383 (Earthrise, by Anders) (public domain) | S | Done |
| 2 | blackhole | Background mode 3 was a noise "Nebula" | ESO/S. Brunier, Milky Way panorama eso0932a (CC BY 4.0) | M | Done |
| 3 | chladni-plate | Only our own simulated sand, no historical figure | Chladni, Die Akustik (1802), Tab. IV and Tab. VI, Wellcome scan on the Internet Archive (PD Mark) | S | Done |
| 4 | neuron-lab | Procedural cell shapes with no real neuron for comparison | Santiago Ramón y Cajal: Purkinje cell (about 1900) and cortex column (1899), Wikimedia Commons (public domain) | S | Done |
| 5 | gravitational-imaging | Every figure is a toy lens; no real lens shown | ESA/Hubble & NASA, Cosmic Horseshoe potw1151a (CC BY 4.0) | S | Done |
| 6 | map-projections | The cards name historical maps but show none | Edward Wright, chart of the world, about 1599; Oronce Finé, double cordiform map, 1531, Wikimedia Commons (public domain) | S | Done |
| 7 | dice | Tray rim grain drawn from sine waves | Poly Haven, Sapele Veneer by Jenelle van Heerden (CC0) | S | Done |
| 8 | antikythera | Gear model only | Photos of the Antikythera fragments, National Archaeological Museum Athens, Wikimedia Commons (several CC BY or CC BY-SA, check each file) | S | Deferred: the working tree has edits from another agent |
| 9 | enigma-rotors, curta, pendulum-clock, pin-tumbler-lock, watch-movement, watch-randomizer, calculators | Models only, no photo of the real object | Museum photos on Wikimedia Commons (many CC BY-SA), Smithsonian Open Access (CC0) | S each | Deferred: the working tree has edits from another agent |
| 10 | Machine pages with the Explode pill (gear-types, planetary-gearbox, manual-gearbox, harmonic-drive, geneva-cams, linkages, ratchets, universal-joints, pumps, swashplate-pump, radial-engine, stirling-engine, wankel-engine, sewing-machine, four-stroke-engine and others) | Models only | Patent drawings (US patents are public domain), Smithsonian Open Access photos (CC0) | S each | Deferred: Explode pill agent |
| 11 | mushrooms, coral-species, coral-reef | Procedural specimens | Biodiversity Heritage Library plates (public domain), for example Haeckel, Kunstformen der Natur (1904) | M | Deferred: excluded pages |
| 12 | periodic-table | No photo of any element | Element photos on Wikimedia Commons (many CC BY 3.0 or CC BY-SA, check each), or Smithsonian mineral photos (CC0) | L (118 files, budget) | Open |
| 13 | virus-atlas, mrna-vaccine | Molecular models only, no micrograph | CDC Public Health Image Library electron micrographs (public domain, check each record); NIAID Flickr (CC BY 2.0) | M | Open |
| 14 | storm-globe, weather-map | Simulated storms; no satellite photo | NASA Earth Observatory and NOAA GOES images (public domain) | S | Open |
| 15 | galaxy | Galaxies from profiles; no photo for comparison | ESA/Hubble or ESA/Webb photos of real galaxies (CC BY 4.0) | S | Open |
| 16 | sstv screensaver | The saver sends only the drawn cards (CARDS_SAVER) | The same Apollo photos, once the saver can wait for an image | S | Open |
| 17 | color-table, postfx-table, fire-table and the other *-table pages | Shader tables; some example images | Paintings from Art Institute of Chicago or Rijksmuseum open access (CC0 or public domain) | M | Deferred: decomposition agent |
| 18 | cloth, soft-body-skinning | Procedural cloth colour | Fabric scans from ambientCG or Poly Haven (CC0) | M | Deferred: excluded pages |
| 19 | fishdraw | Procedural fish | BHL fish plates (public domain), for comparison only | S | Deferred: excluded page |
| 20 | city-atlas, leo-catalog, fly-duel, magnetlab, mandelbulber, manim-live, joints, alphafold-explained, ulam-spiral | Various | Not surveyed in depth | - | Deferred: excluded pages |
| 21 | dla-terrain, billiard, cnn-explainer, selection, breadboard-lab, fire-simulation, human-skeleton, human-skull, ship-designer, pattern-designer, pattern-animator | Various | Not surveyed in depth | - | Deferred: other agents |
| 22 | frqi-quantum-image-lab | Generated test images (cross, checker, gradient) | A public-domain painting | S | Low value: the grid is 2 x 2 to 32 x 32 pixels, so a painting reads only at 32 x 32 |
| 23 | retro-shelf | Our own drawn box covers | Real box art is commercial art; the freeware terms cover the game files, not the box art | - | Not licensable: keep our own covers |
| 24 | shan-shui, nonflowers, fractal-flames, context-free, dlaf, thread-art output | Generative art | The generation is the point of the page | - | Not a fit |

Pages that already use real art and need nothing: halftone and thread-art
(NASA photos, public-domain paintings), string-lab (CC0 wood scans),
ancient-earth and map-projections globe (NASA Blue Marble), and the game-data pages (crafting, wiki, research: sprites from the exporter only). planet-collision,
weather-map, chandrasekhar-limit and roche-limit ship image files with their
own CREDITS.txt; this pass did not review them.

## Done in this pass

| Commit | Page | Assets |
|---|---|---|
| 24db8f91 | tools | `tools/credits-check.mjs`, the credits and budget gate |
| 3aaa0d95 | blackhole | `artwork/eso-milky-way-2048.jpg` (ESO/S. Brunier, CC BY 4.0) |
| 5beb3969 | chladni-plate | `artwork/chladni-1802-tab4-square.jpg`, `artwork/chladni-1802-tab6-disc.jpg` (Chladni 1802, PD Mark) |
| 09bb06f5 | neuron-lab | `artwork/cajal-purkinje-cell.jpg`, `artwork/cajal-cortex-golgi.jpg` (Cajal, public domain) |
| db0b39e4 | gravitational-imaging | `artwork/hubble-horseshoe-einstein-ring.jpg` (ESA/Hubble & NASA, CC BY 4.0) |
| 265da406 | sstv | `artwork/apollo11-aldrin-as11-40-5903.jpg`, `artwork/apollo8-earthrise-as08-14-2383.jpg` (NASA, public domain) |
| bb6d2171 | map-projections | `artwork/wright-molyneux-1599-mercator.jpg`, `artwork/fine-1531-double-cordiform.jpg` (public domain) |
| 65fbda97 | dice | `artwork/sapele-veneer-rim.jpg` (Poly Haven, CC0) |

Each page keeps its tests green. No home thumbnail changed, so the home
tests and the thumbnail tools were not part of this pass. No browser ran:
the new images and the two texture loads (blackhole, dice) have not been
seen on screen.

## Left out on purpose

- Mercator's 1569 world map: the common Commons composite is a photo by
  Wilhelm Krücken, who keeps the copyright of his photos and only allows
  use of the medium scans. That is a permission, not a licence.
- Rumold Mercator's 1587 double-hemisphere map, for the stereographic card:
  no source at hand confirmed its projection.
