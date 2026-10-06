//! Rust port of ln/shape.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! The Shape trait has the five methods of the Go interface. Two parts of
//! the contract do different work:
//!   - the solid part (intersect, contains, bounding_box) tells the engine
//!     what blocks the view. contains is only for CSG.
//!   - the drawing part (paths) gives 3D polylines on the surface: the
//!     "vector texture". Only these lines can show in the output.
//! Go overrides Paths by struct embedding (StripedCube, the Earth and Tree
//! types in the examples). Rust has no embedding, so `WithPaths` keeps the
//! solid of one shape and puts other paths on it.

use crate::bbox::BBox;
use crate::hit::{Hit, NO_HIT};
use crate::matrix::Matrix;
use crate::path::{Paths, PathsExt};
use crate::ray::Ray;
use crate::vector::Vector;

pub trait Shape {
    /// Build the acceleration data (the mesh tree). Most shapes need none.
    fn compile(&mut self) {}
    fn bounding_box(&self) -> BBox;
    /// Is `v` inside the solid, with the tolerance `f`? Only CSG reads it.
    fn contains(&self, v: Vector, f: f64) -> bool;
    fn intersect(&self, r: &Ray) -> Hit;
    fn paths(&self) -> Paths;
}

impl Shape for Box<dyn Shape> {
    fn compile(&mut self) {
        (**self).compile()
    }
    fn bounding_box(&self) -> BBox {
        (**self).bounding_box()
    }
    fn contains(&self, v: Vector, f: f64) -> bool {
        (**self).contains(v, f)
    }
    fn intersect(&self, r: &Ray) -> Hit {
        (**self).intersect(r)
    }
    fn paths(&self) -> Paths {
        (**self).paths()
    }
}

pub struct EmptyShape;

impl Shape for EmptyShape {
    fn bounding_box(&self) -> BBox {
        BBox::default()
    }
    fn contains(&self, _v: Vector, _f: f64) -> bool {
        false
    }
    fn intersect(&self, _r: &Ray) -> Hit {
        NO_HIT
    }
    fn paths(&self) -> Paths {
        Vec::new()
    }
}

/// A shape moved by a matrix. Rays and points go into the shape space by
/// the inverse; paths come out by the matrix.
pub struct TransformedShape {
    pub shape: Box<dyn Shape>,
    pub matrix: Matrix,
    pub inverse: Matrix,
}

pub fn new_transformed_shape(s: Box<dyn Shape>, m: Matrix) -> Box<dyn Shape> {
    Box::new(TransformedShape { shape: s, inverse: m.inverse(), matrix: m })
}

impl Shape for TransformedShape {
    fn compile(&mut self) {
        self.shape.compile()
    }
    fn bounding_box(&self) -> BBox {
        self.matrix.mul_box(self.shape.bounding_box())
    }
    fn contains(&self, v: Vector, f: f64) -> bool {
        self.shape.contains(self.inverse.mul_position(v), f)
    }
    fn intersect(&self, r: &Ray) -> Hit {
        self.shape.intersect(&self.inverse.mul_ray(*r))
    }
    fn paths(&self) -> Paths {
        self.shape.paths().transform(&self.matrix)
    }
}

/// The solid of `shape` with other paths: the Go embedding pattern
/// (`type StripedCube struct { ln.Cube }` with its own Paths method).
pub struct WithPaths {
    pub shape: Box<dyn Shape>,
    pub paths: Paths,
}

impl WithPaths {
    pub fn new(shape: Box<dyn Shape>, paths: Paths) -> Box<dyn Shape> {
        Box::new(WithPaths { shape, paths })
    }
}

impl Shape for WithPaths {
    fn compile(&mut self) {
        self.shape.compile()
    }
    fn bounding_box(&self) -> BBox {
        self.shape.bounding_box()
    }
    fn contains(&self, v: Vector, f: f64) -> bool {
        self.shape.contains(v, f)
    }
    fn intersect(&self, r: &Ray) -> Hit {
        self.shape.intersect(r)
    }
    fn paths(&self) -> Paths {
        self.paths.clone()
    }
}
