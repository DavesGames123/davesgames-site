//! Rust port of ln/cone.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! A cone on the z axis: base radius at z = 0, the tip at z = height. The
//! texture is 12 lines from the base to the tip. OutlineCone draws the base
//! circle and the two silhouette lines seen from `eye`. Contains is always
//! false in ln, so a cone cannot be a CSG operand.

use crate::bbox::BBox;
use crate::hit::{Hit, NO_HIT};
use crate::matrix::{rotate, translate};
use crate::path::Paths;
use crate::ray::Ray;
use crate::shape::{new_transformed_shape, Shape};
use crate::util::radians;
use crate::vector::{v3, Vector};

#[derive(Clone, Debug)]
pub struct Cone {
    pub radius: f64,
    pub height: f64,
}

pub fn new_cone(radius: f64, height: f64) -> Cone {
    Cone { radius, height }
}

impl Cone {
    pub fn intersect_cone(&self, ray: &Ray) -> Hit {
        let o = ray.origin;
        let d = ray.direction;
        let r = self.radius;
        let h = self.height;
        let mut k = r / h;
        k *= k;
        let a = d.x * d.x + d.y * d.y - k * d.z * d.z;
        let b = 2.0 * (d.x * o.x + d.y * o.y - k * d.z * (o.z - h));
        let c = o.x * o.x + o.y * o.y - k * (o.z - h) * (o.z - h);
        let q = b * b - 4.0 * a * c;
        if q <= 0.0 {
            return NO_HIT;
        }
        let s = q.sqrt();
        let mut t0 = (-b + s) / (2.0 * a);
        let mut t1 = (-b - s) / (2.0 * a);
        if t0 > t1 {
            std::mem::swap(&mut t0, &mut t1);
        }
        if t0 > 1e-6 {
            let p = ray.position(t0);
            if p.z > 0.0 && p.z < h {
                return Hit::new(t0);
            }
        }
        if t1 > 1e-6 {
            let p = ray.position(t1);
            if p.z > 0.0 && p.z < h {
                return Hit::new(t1);
            }
        }
        NO_HIT
    }
}

impl Shape for Cone {
    fn bounding_box(&self) -> BBox {
        let r = self.radius;
        BBox::new(v3(-r, -r, 0.0), v3(r, r, self.height))
    }
    fn contains(&self, _v: Vector, _f: f64) -> bool {
        false
    }
    fn intersect(&self, r: &Ray) -> Hit {
        self.intersect_cone(r)
    }
    fn paths(&self) -> Paths {
        let mut result = Vec::new();
        let mut a = 0;
        while a < 360 {
            let x = self.radius * radians(a as f64).cos();
            let y = self.radius * radians(a as f64).sin();
            result.push(vec![v3(x, y, 0.0), v3(0.0, 0.0, self.height)]);
            a += 30;
        }
        result
    }
}

pub struct OutlineCone {
    pub cone: Cone,
    pub eye: Vector,
    pub up: Vector,
}

pub fn new_outline_cone(eye: Vector, up: Vector, radius: f64, height: f64) -> OutlineCone {
    OutlineCone { cone: new_cone(radius, height), eye, up }
}

impl Shape for OutlineCone {
    fn bounding_box(&self) -> BBox {
        self.cone.bounding_box()
    }
    fn contains(&self, _v: Vector, _f: f64) -> bool {
        false
    }
    fn intersect(&self, r: &Ray) -> Hit {
        self.cone.intersect_cone(r)
    }
    fn paths(&self) -> Paths {
        let c = &self.cone;
        let center = v3(0.0, 0.0, 0.0);
        let hyp = center.sub(self.eye).length();
        let opp = c.radius;
        let theta = (opp / hyp).asin();
        let adj = opp / theta.tan();
        let d = theta.cos() * adj;
        let w = center.sub(self.eye).normalize();
        let u = w.cross(self.up).normalize();
        let c0 = self.eye.add(w.mul_scalar(d));
        let a0 = c0.add(u.mul_scalar(c.radius * 1.01));
        let b0 = c0.add(u.mul_scalar(-c.radius * 1.01));
        let mut p0 = Vec::with_capacity(360);
        for a in 0..360 {
            let x = c.radius * radians(a as f64).cos();
            let y = c.radius * radians(a as f64).sin();
            p0.push(v3(x, y, 0.0));
        }
        vec![
            p0,
            vec![v3(a0.x, a0.y, 0.0), v3(0.0, 0.0, c.height)],
            vec![v3(b0.x, b0.y, 0.0), v3(0.0, 0.0, c.height)],
        ]
    }
}

/// An outline cone with its base at v0 and its tip at v1.
pub fn new_transformed_outline_cone(eye: Vector, up: Vector, v0: Vector, v1: Vector, radius: f64) -> Box<dyn Shape> {
    let d = v1.sub(v0);
    let z = d.length();
    let a = d.normalize().dot(up).acos();
    let mut m = translate(v0);
    if a != 0.0 {
        let u = d.cross(up).normalize();
        m = rotate(u, a).translate(v0);
    }
    let c = new_outline_cone(m.inverse().mul_position(eye), up, radius, z);
    new_transformed_shape(Box::new(c), m)
}
