//! Rust port of ln/triangle.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman). The ray test is Moller-Trumbore.

use crate::bbox::BBox;
use crate::hit::{Hit, NO_HIT};
use crate::path::Paths;
use crate::ray::Ray;
use crate::shape::Shape;
use crate::util::EPS;
use crate::vector::Vector;

#[derive(Clone, Copy, Debug)]
pub struct Triangle {
    pub v1: Vector,
    pub v2: Vector,
    pub v3: Vector,
    pub bbox: BBox,
}

pub fn new_triangle(v1: Vector, v2: Vector, v3: Vector) -> Triangle {
    let mut t = Triangle { v1, v2, v3, bbox: BBox::default() };
    t.update_bounding_box();
    t
}

impl Triangle {
    pub fn update_bounding_box(&mut self) {
        let min = self.v1.min(self.v2).min(self.v3);
        let max = self.v1.max(self.v2).max(self.v3);
        self.bbox = BBox::new(min, max);
    }

    pub fn intersect_triangle(&self, r: &Ray) -> Hit {
        let e1x = self.v2.x - self.v1.x;
        let e1y = self.v2.y - self.v1.y;
        let e1z = self.v2.z - self.v1.z;
        let e2x = self.v3.x - self.v1.x;
        let e2y = self.v3.y - self.v1.y;
        let e2z = self.v3.z - self.v1.z;
        let px = r.direction.y * e2z - r.direction.z * e2y;
        let py = r.direction.z * e2x - r.direction.x * e2z;
        let pz = r.direction.x * e2y - r.direction.y * e2x;
        let det = e1x * px + e1y * py + e1z * pz;
        if det > -EPS && det < EPS {
            return NO_HIT;
        }
        let inv = 1.0 / det;
        let tx = r.origin.x - self.v1.x;
        let ty = r.origin.y - self.v1.y;
        let tz = r.origin.z - self.v1.z;
        let u = (tx * px + ty * py + tz * pz) * inv;
        if !(0.0..=1.0).contains(&u) {
            return NO_HIT;
        }
        let qx = ty * e1z - tz * e1y;
        let qy = tz * e1x - tx * e1z;
        let qz = tx * e1y - ty * e1x;
        let v = (r.direction.x * qx + r.direction.y * qy + r.direction.z * qz) * inv;
        if v < 0.0 || u + v > 1.0 {
            return NO_HIT;
        }
        let d = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if d < EPS {
            return NO_HIT;
        }
        Hit::new(d)
    }

    pub fn normal(&self) -> Vector {
        self.v2.sub(self.v1).cross(self.v3.sub(self.v1)).normalize()
    }
}

impl Shape for Triangle {
    fn bounding_box(&self) -> BBox {
        self.bbox
    }
    fn contains(&self, _v: Vector, _f: f64) -> bool {
        false
    }
    fn intersect(&self, r: &Ray) -> Hit {
        self.intersect_triangle(r)
    }
    fn paths(&self) -> Paths {
        vec![vec![self.v1, self.v2], vec![self.v2, self.v3], vec![self.v3, self.v1]]
    }
}
