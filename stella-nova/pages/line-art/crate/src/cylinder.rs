//! Rust port of ln/cylinder.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! A cylinder on the z axis from z0 to z1, open at the ends (the ray test
//! has no caps). The texture is 36 lines along the side. OutlineCylinder
//! draws the two end circles and the two silhouette lines seen from `eye`.
//! new_transformed_outline_cylinder puts one between two points.

use crate::bbox::BBox;
use crate::hit::{Hit, NO_HIT};
use crate::matrix::{rotate, translate};
use crate::path::Paths;
use crate::ray::Ray;
use crate::shape::{new_transformed_shape, Shape};
use crate::util::radians;
use crate::vector::{v3, Vector};

#[derive(Clone, Debug)]
pub struct Cylinder {
    pub radius: f64,
    pub z0: f64,
    pub z1: f64,
}

pub fn new_cylinder(radius: f64, z0: f64, z1: f64) -> Cylinder {
    Cylinder { radius, z0, z1 }
}

impl Cylinder {
    pub fn intersect_cylinder(&self, ray: &Ray) -> Hit {
        let r = self.radius;
        let o = ray.origin;
        let d = ray.direction;
        let a = d.x * d.x + d.y * d.y;
        let b = 2.0 * o.x * d.x + 2.0 * o.y * d.y;
        let c = o.x * o.x + o.y * o.y - r * r;
        let q = b * b - 4.0 * a * c;
        if q < 0.0 {
            return NO_HIT;
        }
        let s = q.sqrt();
        let mut t0 = (-b + s) / (2.0 * a);
        let mut t1 = (-b - s) / (2.0 * a);
        if t0 > t1 {
            std::mem::swap(&mut t0, &mut t1);
        }
        let z0 = o.z + t0 * d.z;
        let z1 = o.z + t1 * d.z;
        if t0 > 1e-6 && self.z0 < z0 && z0 < self.z1 {
            return Hit::new(t0);
        }
        if t1 > 1e-6 && self.z0 < z1 && z1 < self.z1 {
            return Hit::new(t1);
        }
        NO_HIT
    }
}

impl Shape for Cylinder {
    fn bounding_box(&self) -> BBox {
        let r = self.radius;
        BBox::new(v3(-r, -r, self.z0), v3(r, r, self.z1))
    }
    fn contains(&self, v: Vector, f: f64) -> bool {
        let xy = v3(v.x, v.y, 0.0);
        if xy.length() > self.radius + f {
            return false;
        }
        v.z >= self.z0 - f && v.z <= self.z1 + f
    }
    fn intersect(&self, r: &Ray) -> Hit {
        self.intersect_cylinder(r)
    }
    fn paths(&self) -> Paths {
        let mut result = Vec::new();
        let mut a = 0;
        while a < 360 {
            let x = self.radius * radians(a as f64).cos();
            let y = self.radius * radians(a as f64).sin();
            result.push(vec![v3(x, y, self.z0), v3(x, y, self.z1)]);
            a += 10;
        }
        result
    }
}

pub struct OutlineCylinder {
    pub cylinder: Cylinder,
    pub eye: Vector,
    pub up: Vector,
}

pub fn new_outline_cylinder(eye: Vector, up: Vector, radius: f64, z0: f64, z1: f64) -> OutlineCylinder {
    OutlineCylinder { cylinder: new_cylinder(radius, z0, z1), eye, up }
}

impl Shape for OutlineCylinder {
    fn bounding_box(&self) -> BBox {
        self.cylinder.bounding_box()
    }
    fn contains(&self, v: Vector, f: f64) -> bool {
        self.cylinder.contains(v, f)
    }
    fn intersect(&self, r: &Ray) -> Hit {
        self.cylinder.intersect_cylinder(r)
    }
    fn paths(&self) -> Paths {
        let c = &self.cylinder;
        let center = v3(0.0, 0.0, c.z0);
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

        let center = v3(0.0, 0.0, c.z1);
        let hyp = center.sub(self.eye).length();
        let theta = (opp / hyp).asin();
        let adj = opp / theta.tan();
        let d = theta.cos() * adj;
        let w = center.sub(self.eye).normalize();
        let u = w.cross(self.up).normalize();
        let c1 = self.eye.add(w.mul_scalar(d));
        let a1 = c1.add(u.mul_scalar(c.radius * 1.01));
        let b1 = c1.add(u.mul_scalar(-c.radius * 1.01));

        let mut p0 = Vec::with_capacity(360);
        let mut p1 = Vec::with_capacity(360);
        for a in 0..360 {
            let x = c.radius * radians(a as f64).cos();
            let y = c.radius * radians(a as f64).sin();
            p0.push(v3(x, y, c.z0));
            p1.push(v3(x, y, c.z1));
        }
        vec![
            p0,
            p1,
            vec![v3(a0.x, a0.y, c.z0), v3(a1.x, a1.y, c.z1)],
            vec![v3(b0.x, b0.y, c.z0), v3(b1.x, b1.y, c.z1)],
        ]
    }
}

/// An outline cylinder from v0 to v1. The eye goes into the cylinder space,
/// so the silhouette lines are right after the transform.
pub fn new_transformed_outline_cylinder(eye: Vector, up: Vector, v0: Vector, v1: Vector, radius: f64) -> Box<dyn Shape> {
    let d = v1.sub(v0);
    let z = d.length();
    let a = d.normalize().dot(up).acos();
    let mut m = translate(v0);
    if a != 0.0 {
        let u = d.cross(up).normalize();
        m = rotate(u, a).translate(v0);
    }
    let c = new_outline_cylinder(m.inverse().mul_position(eye), up, radius, 0.0, z);
    new_transformed_shape(Box::new(c), m)
}
