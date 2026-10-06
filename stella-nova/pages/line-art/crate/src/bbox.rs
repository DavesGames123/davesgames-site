//! Rust port of ln/box.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! The Go type is `Box`. Rust uses that name for the heap pointer, so the
//! port calls the axis-aligned box `BBox`.

use crate::ray::Ray;
use crate::shape::Shape;
use crate::triangle::Triangle;
use crate::util::Axis;
use crate::vector::{gmax, gmin, v3, Vector};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BBox {
    pub min: Vector,
    pub max: Vector,
}

pub fn box_for_shapes(shapes: &[Box<dyn Shape>]) -> BBox {
    if shapes.is_empty() {
        return BBox::default();
    }
    let mut b = shapes[0].bounding_box();
    for s in shapes {
        b = b.extend(s.bounding_box());
    }
    b
}

pub fn box_for_triangles(shapes: &[Triangle]) -> BBox {
    if shapes.is_empty() {
        return BBox::default();
    }
    let mut b = shapes[0].bbox;
    for s in shapes {
        b = b.extend(s.bbox);
    }
    b
}

pub fn box_for_vectors(vectors: &[Vector]) -> BBox {
    if vectors.is_empty() {
        return BBox::default();
    }
    let mut min = vectors[0];
    let mut max = vectors[0];
    for &v in vectors {
        min = min.min(v);
        max = max.max(v);
    }
    BBox::new(min, max)
}

impl BBox {
    pub const fn new(min: Vector, max: Vector) -> BBox {
        BBox { min, max }
    }
    pub fn anchor(&self, anchor: Vector) -> Vector {
        self.min.add(self.size().mul(anchor))
    }
    pub fn center(&self) -> Vector {
        self.anchor(v3(0.5, 0.5, 0.5))
    }
    pub fn size(&self) -> Vector {
        self.max.sub(self.min)
    }
    pub fn contains(&self, b: Vector) -> bool {
        self.min.x <= b.x
            && self.max.x >= b.x
            && self.min.y <= b.y
            && self.max.y >= b.y
            && self.min.z <= b.z
            && self.max.z >= b.z
    }
    pub fn extend(&self, b: BBox) -> BBox {
        BBox::new(self.min.min(b.min), self.max.max(b.max))
    }
    /// The slab test: the entry and exit distances along the ray.
    pub fn intersect(&self, r: &Ray) -> (f64, f64) {
        let mut x1 = (self.min.x - r.origin.x) / r.direction.x;
        let mut y1 = (self.min.y - r.origin.y) / r.direction.y;
        let mut z1 = (self.min.z - r.origin.z) / r.direction.z;
        let mut x2 = (self.max.x - r.origin.x) / r.direction.x;
        let mut y2 = (self.max.y - r.origin.y) / r.direction.y;
        let mut z2 = (self.max.z - r.origin.z) / r.direction.z;
        if x1 > x2 {
            std::mem::swap(&mut x1, &mut x2);
        }
        if y1 > y2 {
            std::mem::swap(&mut y1, &mut y2);
        }
        if z1 > z2 {
            std::mem::swap(&mut z1, &mut z2);
        }
        let t1 = gmax(gmax(x1, y1), z1);
        let t2 = gmin(gmin(x2, y2), z2);
        (t1, t2)
    }
    /// Which sides of the split plane the box touches: (left, right).
    pub fn partition(&self, axis: Axis, point: f64) -> (bool, bool) {
        match axis {
            Axis::X => (self.min.x <= point, self.max.x >= point),
            Axis::Y => (self.min.y <= point, self.max.y >= point),
            Axis::Z => (self.min.z <= point, self.max.z >= point),
            Axis::None => (false, false),
        }
    }
}
