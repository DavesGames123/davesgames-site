# Collapse City — credits

## Inspiration

- **marian42/wavefunctioncollapse** by Marian Kleineberg (MIT licence, Unity).
  <https://github.com/marian42/wavefunctioncollapse>
  The idea of an infinite city that a 3D wave function collapse solver builds
  round a walking player came from this project. We copy no code, models,
  module set, names or look from it.

## Algorithm

- **WaveFunctionCollapse** by Maxim Gumin (MIT licence).
  <https://github.com/mxgmn/WaveFunctionCollapse>
  The method: each slot holds the set of modules that are still possible.
  The solver collapses the slot with the lowest entropy, then removes from
  the neighbours each module that cannot fit (constraint propagation).

## Our own work

- The module set, the module geometry, the palette and the solver (Rust,
  compiled to WebAssembly with wasm-bindgen) are in `crate/`.
- The WebGPU renderer, the shaders, the controls, the screensaver director
  and the JavaScript stand-in world (`mock-world.js`) are in this folder.
- No external art, fonts or data. lib/sci.css supplies the site type.
