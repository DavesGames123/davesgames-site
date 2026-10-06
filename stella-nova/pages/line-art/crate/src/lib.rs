//! line-art: a Rust port of ln, the 3D line art engine by Michael Fogleman
//! (github.com/fogleman/ln, MIT, Copyright (C) 2016 Michael Fogleman).
//! See LICENSE-ln and CREDITS.txt next to this crate.
//!
//! ln draws a 3D scene as 2D vector paths. Each shape gives 3D polylines on
//! its surface. The engine chops them into short steps and casts a ray from
//! each point to the eye. A point stays only if no shape blocks that ray.
//! The visible runs are projected to the image.
//!
//! MODULES (one per ln Go file, same names; box.go is bbox.rs)
//!   util      common.go, axis.go, util.go: INF, EPS, Axis, radians, median
//!   vector    vector.go           matrix    matrix.go (camera matrices)
//!   ray       ray.go              hit       hit.go
//!   bbox      box.go              tree      tree.go (k-d tree)
//!   shape     shape.go (Shape trait, TransformedShape, WithPaths)
//!   scene     scene.go (render)   filter    filter.go (ClipFilter)
//!   path      path.go (chop, filter, simplify, SVG)
//!   plane     plane.go (mesh slices)
//!   sphere cube cylinder cone triangle mesh function csg  the shapes
//!   obj stl   the mesh loaders
//!   rng       not in ln: the seeded random source (Go uses math/rand)
//!
//! GREP MAP
//!   grep -n 'pub fn render'        scene.rs   the whole render
//!   grep -n 'pub fn render_paths'  scene.rs   the streamable part
//!   grep -n 'pub fn visible'       scene.rs   the hidden line ray
//!   grep -n 'fn filter'            path.rs    cut a path at hidden points
//!   grep -n 'pub enum Op'          csg.rs     intersection, difference, union

pub mod bbox;
pub mod cone;
pub mod csg;
pub mod cube;
pub mod cylinder;
pub mod filter;
pub mod function;
pub mod hit;
pub mod matrix;
pub mod mesh;
pub mod obj;
pub mod path;
pub mod plane;
pub mod ray;
pub mod rng;
pub mod scene;
pub mod shape;
pub mod sphere;
pub mod stl;
pub mod tree;
pub mod triangle;
pub mod util;
pub mod vector;

#[cfg(test)]
mod tests;
