//! wfc-city: the engine of the Collapse City page.
//!
//! A 3D wave function collapse solver builds an infinite city around a
//! focus point. The idea comes from marian42/wavefunctioncollapse (MIT,
//! Unity) and the algorithm from Maxim Gumin's WaveFunctionCollapse (MIT).
//! The module set, the geometry, the palette and the solver code are our
//! own work. No code or data comes from those repositories.
//!
//! Files:
//!   rng.rs      the seeded generator (splitmix64), cell hashes, Fx hasher
//!   geom.rs     the triangle builder (flat normals, 32 byte vertices)
//!   modules.rs  connectors, prototypes, rotation expansion, adjacency
//!               masks, layer domains, static module geometry and boxes
//!   world.rs    the lazy chunk map, propagation, backtracking, repair
//!   mesher.rs   the chunk mesher (static geometry plus context trims)
//!   body.rs     the player body: AABB against module boxes, step-up
//!   wasm.rs     the wasm-bindgen API (wasm32 only)
//!   tests.rs    the native tests and the city quality report
//!
//! GREP MAP
//!   grep -n 'fn protos'          the prototype table and the weights
//!   grep -n 'fn h_compat'        the horizontal connector rules
//!   grep -n 'fn v_compat'        the vertical connector rules
//!   grep -n 'fn build_static'    the geometry of each prototype
//!   grep -n 'fn static_boxes'    the collision boxes of each prototype
//!   grep -n 'pub fn update'      the generation loop (world.rs)
//!   grep -n 'fn propagate'       the arc consistency pass
//!   grep -n 'fn resolve'         backtracking after a contradiction
//!   grep -n 'fn repair'          the last resort: clear and regenerate
//!   grep -n 'pub fn chunk_mesh'  the mesher (mesher.rs)
//!   grep -n 'fn facade'          the window and door walls of the blocks
//!   grep -n 'pub fn move_body'   the collision of the player
//!   grep -n 'fn quality'         the city quality numbers (tests.rs)

pub mod body;
pub mod geom;
pub mod mesher;
pub mod modules;
pub mod rng;
pub mod world;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

#[cfg(test)]
mod tests;

pub const VERSION: &str = "wfc-city 0.1.0";
