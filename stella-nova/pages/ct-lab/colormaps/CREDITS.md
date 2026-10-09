# Colour map credits

The catalogue in `maps.js` keeps 33 even samples of each sourced map and
interpolates between them. The samples come from matplotlib 3.10.3 and
seaborn 0.13.2. Each licence below permits reuse with attribution.

| Map ids | Source | Authors | Licence |
|---|---|---|---|
| viridis, magma, inferno, plasma | matplotlib (`_cm_listed.py`) | Nathaniel J. Smith, Stefan van der Walt, Eric Firing | CC0 1.0 |
| cividis | matplotlib | Jamie R. Nunez, Christopher R. Anderton, Ryan S. Renslow (PLOS ONE 13(7), 2018) | Matplotlib licence (BSD-compatible) |
| turbo | matplotlib, from Google AI | Anton Mikhailov (2019) | Apache-2.0 |
| twilight, twilight-shifted | matplotlib | Bastian Bechtold | MIT |
| coolwarm | matplotlib (`CoolWarmFloat33`) | Kenneth Moreland, "Diverging Color Maps for Scientific Visualization" (2009) | Free use, as stated on kennethmoreland.com |
| red-blue (RdBu reversed), pink-green (PiYG), brown-teal (BrBG) | matplotlib, from ColorBrewer | Cynthia A. Brewer, Pennsylvania State University | Apache-2.0-style ColorBrewer licence |
| berlin, vanimo, managua | matplotlib, from Scientific colour maps v8 | Fabio Crameri (doi:10.5281/zenodo.1243862) | MIT |
| cubehelix | matplotlib | D. A. Green, Bull. Astr. Soc. India 39, 289 (2011) | Matplotlib licence (BSD-compatible) |
| bone, copper | matplotlib | Matplotlib development team | Matplotlib licence (BSD-compatible) |
| mako, rocket | seaborn (`cm.py`) | Michael Waskom | BSD-3-Clause |

## Our own maps

These maps are our own designs. No third-party licence applies.

grey, grey-inv, sepia, pink-tissue, hot-iron, pet-rainbow (NIH-style hue
order, own control points), ocean, ice, purple-orange (OKLCh, equal-weight
arms), phase-wheel (OKLCh, equal lightness), aurora, nebula, ember, glacier,
synthwave, gold-leaf, xray-blue, cyanotype, forest, rose, orchid.

## Kept out

ColorBrewer PuOr is not in the catalogue. Its two arms differ by about
24 L*, so the symmetry check in `tests.mjs` fails on it. The own
`purple-orange` map replaces it.
