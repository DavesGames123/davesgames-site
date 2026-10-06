//! Rust port of ln/filter.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! A filter maps a point and says if it stays. ClipFilter is the hidden
//! line test of the render: it projects the point, casts a ray from the
//! point to the eye, and drops the point if a shape blocks the ray or if
//! the projected point is outside the clip box.

use crate::bbox::BBox;
use crate::matrix::Matrix;
use crate::scene::Scene;
use crate::vector::{v3, Vector};

pub trait Filter {
    fn filter(&self, v: Vector) -> (Vector, bool);
}

pub struct ClipFilter<'a> {
    pub matrix: Matrix,
    pub eye: Vector,
    pub scene: &'a Scene,
}

pub const CLIP_BOX: BBox = BBox::new(v3(-1.0, -1.0, -1.0), v3(1.0, 1.0, 1.0));

impl<'a> Filter for ClipFilter<'a> {
    fn filter(&self, v: Vector) -> (Vector, bool) {
        let w = self.matrix.mul_position_w(v);
        if !self.scene.visible(self.eye, v) {
            return (w, false);
        }
        if !CLIP_BOX.contains(w) {
            return (w, false);
        }
        (w, true)
    }
}
