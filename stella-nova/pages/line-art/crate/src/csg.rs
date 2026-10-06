//! Rust port of ln/csg.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! Boolean shapes (constructive solid geometry). Each operand must have a
//! real `contains` (sphere, cube, cylinder, CSG, transformed shapes of
//! these). The ray test takes the nearer hit of the two operands. If that
//! point is not on the boundary of the result, the ray steps 0.01 past it
//! and tries again. The paths are the paths of both operands, chopped at
//! 0.01 and cut to the boundary of the result.
//!
//! ln has Intersection and Difference. Its Union is a comment. The port
//! adds Union (not in ln): a point is on the union boundary when it is
//! not deep inside A and not deep inside B. The ln boundary rule
//! ("contains with a 1e-3 tolerance") would keep every point for a union.
//!
//! Two ln details stay as they are. First, the retry returns the distance
//! from the retry origin, not from the first origin, so a hit after a
//! retry reads closer than it is. Second, Compile does nothing in ln; the
//! port passes it to the operands, so a mesh operand gets its tree.

use crate::bbox::BBox;
use crate::filter::Filter;
use crate::hit::Hit;
use crate::path::{Paths, PathsExt};
use crate::ray::Ray;
use crate::shape::{EmptyShape, Shape};
use crate::vector::Vector;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Intersection,
    Difference,
    /// Not in ln (a comment there).
    Union,
}

pub struct BooleanShape {
    pub op: Op,
    pub a: Box<dyn Shape>,
    pub b: Box<dyn Shape>,
}

/// Fold the shapes left to right: op(op(op(s0, s1), s2), ...).
pub fn new_boolean_shape(op: Op, shapes: Vec<Box<dyn Shape>>) -> Box<dyn Shape> {
    let mut it = shapes.into_iter();
    let mut shape = match it.next() {
        Some(s) => s,
        None => return Box::new(EmptyShape),
    };
    for s in it {
        shape = Box::new(BooleanShape { op, a: shape, b: s });
    }
    shape
}

pub fn new_intersection(shapes: Vec<Box<dyn Shape>>) -> Box<dyn Shape> {
    new_boolean_shape(Op::Intersection, shapes)
}

pub fn new_difference(shapes: Vec<Box<dyn Shape>>) -> Box<dyn Shape> {
    new_boolean_shape(Op::Difference, shapes)
}

/// Not in ln.
pub fn new_union(shapes: Vec<Box<dyn Shape>>) -> Box<dyn Shape> {
    new_boolean_shape(Op::Union, shapes)
}

const F: f64 = 1e-3;

impl BooleanShape {
    /// Is a surface point of A or B on the surface of the result?
    fn on_boundary(&self, v: Vector) -> bool {
        match self.op {
            Op::Intersection | Op::Difference => self.contains(v, 0.0),
            Op::Union => !(self.a.contains(v, -F) || self.b.contains(v, -F)),
        }
    }
}

impl Shape for BooleanShape {
    fn compile(&mut self) {
        self.a.compile();
        self.b.compile();
    }
    fn bounding_box(&self) -> BBox {
        // ln: "TODO: fix this" (the box of both operands).
        let a = self.a.bounding_box();
        let b = self.b.bounding_box();
        a.extend(b)
    }
    /// ln ignores `f` and uses 1e-3.
    fn contains(&self, v: Vector, _f: f64) -> bool {
        let f = F;
        match self.op {
            Op::Intersection => self.a.contains(v, f) && self.b.contains(v, f),
            Op::Difference => self.a.contains(v, f) && !self.b.contains(v, -f),
            Op::Union => self.a.contains(v, f) || self.b.contains(v, f),
        }
    }
    fn intersect(&self, r: &Ray) -> Hit {
        let mut ray = *r;
        loop {
            let h1 = self.a.intersect(&ray);
            let h2 = self.b.intersect(&ray);
            let h = h1.min(h2);
            let v = ray.position(h.t);
            if !h.ok() || self.on_boundary(v) {
                return h;
            }
            ray = Ray::new(ray.position(h.t + 0.01), ray.direction);
        }
    }
    fn paths(&self) -> Paths {
        let mut p = self.a.paths();
        p.extend(self.b.paths());
        p.chop(0.01).filter(self)
    }
}

impl Filter for BooleanShape {
    fn filter(&self, v: Vector) -> (Vector, bool) {
        (v, self.on_boundary(v))
    }
}
