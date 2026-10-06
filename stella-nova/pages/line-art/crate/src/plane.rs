//! Rust port of ln/plane.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman). Cut a mesh with a plane: each
//! triangle that the plane crosses gives one segment.

use crate::mesh::Mesh;
use crate::path::Paths;
use crate::triangle::Triangle;
use crate::util::EPS;
use crate::vector::Vector;

#[derive(Clone, Copy, Debug)]
pub struct Plane {
    pub point: Vector,
    pub normal: Vector,
}

impl Plane {
    pub fn new(point: Vector, normal: Vector) -> Plane {
        Plane { point, normal }
    }

    pub fn intersect_segment(&self, v0: Vector, v1: Vector) -> Option<Vector> {
        let u = v1.sub(v0);
        let w = v0.sub(self.point);
        let d = self.normal.dot(u);
        let n = -self.normal.dot(w);
        if d > -EPS && d < EPS {
            return None;
        }
        let t = n / d;
        if !(0.0..=1.0).contains(&t) {
            return None;
        }
        Some(v0.add(u.mul_scalar(t)))
    }

    pub fn intersect_triangle(&self, t: &Triangle) -> Option<(Vector, Vector)> {
        let v1 = self.intersect_segment(t.v1, t.v2);
        let v2 = self.intersect_segment(t.v2, t.v3);
        let v3 = self.intersect_segment(t.v3, t.v1);
        match (v1, v2, v3) {
            (Some(a), Some(b), _) => Some((a, b)),
            (Some(a), _, Some(c)) => Some((a, c)),
            (_, Some(b), Some(c)) => Some((b, c)),
            _ => None,
        }
    }

    pub fn intersect_mesh(&self, m: &Mesh) -> Paths {
        let mut result = Vec::new();
        for t in &m.triangles {
            if let Some((a, b)) = self.intersect_triangle(t) {
                result.push(vec![a, b]);
            }
        }
        result
    }
}
