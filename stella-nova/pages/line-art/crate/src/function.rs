//! Rust port of ln/function.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! The surface z = f(x, y) inside a box. `Direction` says which side is
//! solid: Below fills under the surface, Above fills over it. The ray test
//! marches in steps of 1/64 up to t = 10 and stops where the side changes.
//! ln has three textures: Paths (the default: 72 radial lines out to r = 8,
//! twisted by -(-z)^1.4), Paths1 (a grid of x and y lines) and Paths3 (one
//! spiral). The port picks one with `FunctionTexture`.

use crate::bbox::BBox;
use crate::hit::{Hit, NO_HIT};
use crate::path::Paths;
use crate::ray::Ray;
use crate::shape::Shape;
use crate::util::radians;
use crate::vector::{gmax, gmin, v3, Vector};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Above,
    Below,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FunctionTexture {
    /// ln Paths.
    Radial,
    /// ln Paths1.
    Grid,
    /// ln Paths3.
    Spiral,
}

pub struct Function {
    pub function: Box<dyn Fn(f64, f64) -> f64>,
    pub bbox: BBox,
    pub direction: Direction,
    pub texture: FunctionTexture,
}

pub fn new_function(function: Box<dyn Fn(f64, f64) -> f64>, bbox: BBox, direction: Direction) -> Function {
    Function { function, bbox, direction, texture: FunctionTexture::Radial }
}

impl Function {
    pub fn with_texture(mut self, t: FunctionTexture) -> Function {
        self.texture = t;
        self
    }

    fn clamp_z(&self, z: f64) -> f64 {
        gmax(gmin(z, self.bbox.max.z), self.bbox.min.z)
    }

    /// ln Paths3.
    pub fn paths3(&self) -> Paths {
        let n = 10000;
        let mut path = Vec::with_capacity(n);
        for i in 0..n {
            let t = i as f64 / n as f64;
            let r = 8.0 - t.powf(0.1) * 8.0;
            let x = radians(t * 2.0 * std::f64::consts::PI * 3000.0).cos() * r;
            let y = radians(t * 2.0 * std::f64::consts::PI * 3000.0).sin() * r;
            let z = self.clamp_z((self.function)(x, y));
            path.push(v3(x, y, z));
        }
        vec![path]
    }

    /// ln Paths.
    pub fn paths_radial(&self) -> Paths {
        let mut paths = Vec::new();
        let fine = 1.0 / 256.0;
        let mut a = 0;
        while a < 360 {
            let mut path = Vec::new();
            let mut r = 0.0;
            while r <= 8.0 {
                let x = radians(a as f64).cos() * r;
                let y = radians(a as f64).sin() * r;
                let z = (self.function)(x, y);
                let o = -(-z).powf(1.4);
                let x = (radians(a as f64) - o).cos() * r;
                let y = (radians(a as f64) - o).sin() * r;
                let z = self.clamp_z(z);
                path.push(v3(x, y, z));
                r += fine;
            }
            paths.push(path);
            a += 5;
        }
        paths
    }

    /// ln Paths1.
    pub fn paths1(&self) -> Paths {
        let mut paths = Vec::new();
        let step = 1.0 / 8.0;
        let fine = 1.0 / 64.0;
        let mut x = self.bbox.min.x;
        while x <= self.bbox.max.x {
            let mut path = Vec::new();
            let mut y = self.bbox.min.y;
            while y <= self.bbox.max.y {
                path.push(v3(x, y, self.clamp_z((self.function)(x, y))));
                y += fine;
            }
            paths.push(path);
            x += step;
        }
        let mut y = self.bbox.min.y;
        while y <= self.bbox.max.y {
            let mut path = Vec::new();
            let mut x = self.bbox.min.x;
            while x <= self.bbox.max.x {
                path.push(v3(x, y, self.clamp_z((self.function)(x, y))));
                x += fine;
            }
            paths.push(path);
            y += step;
        }
        paths
    }
}

impl Shape for Function {
    fn bounding_box(&self) -> BBox {
        self.bbox
    }
    fn contains(&self, v: Vector, _eps: f64) -> bool {
        if self.direction == Direction::Below {
            v.z < (self.function)(v.x, v.y)
        } else {
            v.z > (self.function)(v.x, v.y)
        }
    }
    fn intersect(&self, ray: &Ray) -> Hit {
        let step = 1.0 / 64.0;
        let sign = self.contains(ray.position(step), 0.0);
        let mut t = step;
        while t < 10.0 {
            let v = ray.position(t);
            if self.contains(v, 0.0) != sign && self.bbox.contains(v) {
                return Hit::new(t);
            }
            t += step;
        }
        NO_HIT
    }
    fn paths(&self) -> Paths {
        match self.texture {
            FunctionTexture::Radial => self.paths_radial(),
            FunctionTexture::Grid => self.paths1(),
            FunctionTexture::Spiral => self.paths3(),
        }
    }
}
