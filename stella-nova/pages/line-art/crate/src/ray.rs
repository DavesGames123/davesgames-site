//! Rust port of ln/ray.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).

use crate::vector::Vector;

#[derive(Clone, Copy, Debug)]
pub struct Ray {
    pub origin: Vector,
    pub direction: Vector,
}

impl Ray {
    pub fn new(origin: Vector, direction: Vector) -> Ray {
        Ray { origin, direction }
    }
    pub fn position(&self, t: f64) -> Vector {
        self.origin.add(self.direction.mul_scalar(t))
    }
}
