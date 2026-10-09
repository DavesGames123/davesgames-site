# Thread Art: credits and licences

## The idea

- **image-stylization-threading** by Jérémie Piellard:
  <https://github.com/piellardj/image-stylization-threading>,
  live demo <https://piellardj.github.io/image-stylization-threading/>.
  Licence: GPL-3.0.
  This page takes the published idea only: pegs on a frame, one thread (or
  three in colour) laid in straight lines from peg to peg, chosen greedily
  so that the lines build the image. No upstream source was read, copied
  or ported. The model (optical density), the objective (the exact
  decrease of the squared error), the integer line walk, the WGSL kernels
  and the rest of the code are this page's own.
- The upstream README names **Petros Vrellis** as the artist who made
  this kind of string art known.

## Images

All the built-in images are public domain or this page's own.

| File | Work | Status |
| --- | --- | --- |
| `img/mona-lisa.jpg` | Leonardo da Vinci, *Mona Lisa*, c. 1503-1506, Louvre. Wikimedia Commons file "Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg", cropped to a square (2480 px at 680, 720 of the 3840 px wide render) and scaled to 1200 px. | Public domain |
| `img/pearl.jpg` | Johannes Vermeer, *Girl with a Pearl Earring*, c. 1665, Mauritshuis. Wikimedia Commons file "1665 Girl with a Pearl Earring.jpg", cropped to a square (3040 px at 360, 560 of the 3840 px wide render) and scaled to 1200 px. | Public domain |
| `img/van-gogh.jpg` | Vincent van Gogh, *Self-Portrait*, 1887, Art Institute of Chicago. Wikimedia Commons file "Vincent van Gogh - Self-Portrait - Google Art Project (454045).jpg", cropped to a square (3040 px at 400, 360 of the 3840 px wide render) and scaled to 1200 px. | Public domain |
| `../halftone/img/aldrin.jpg` | Buzz Aldrin on the Moon, Apollo 11, 20 Jul 1969. NASA photo AS11-40-5903 (the halftone page's copy, read in place). | Public domain (NASA) |
| Eye, Star, Moon, Rings | Test shapes drawn by `engine.js shapeImage`. | This page's own |

Faithful reproductions of two-dimensional public-domain paintings are
public domain in the United States (Bridgeman v. Corel) and are marked so
on Wikimedia Commons.

## Code

All files in this folder are this site's own code:
`engine.js`, `draw.js`, `thread.wgsl`, `gpu.js`, `main.js`, `saver.js`, `saver-core.js`, `saver-draw.js`, `saver-worker.js`, `tests.mjs`, `jsdom-boot.mjs`,
`gpu-check.mjs`, `index.html`, `style.css`.
