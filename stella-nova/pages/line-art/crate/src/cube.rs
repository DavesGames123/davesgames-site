//! Rust port of ln/cube.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! The default texture is the 12 edges. ln Cube.Paths has a second texture
//! after its `return` (dead code in Go): vertical stripes on the four sides.
//! The README StripedCube type uses the same stripes. The port gives both
//! with `CubeTexture`.

use crate::bbox::BBox;
use crate::hit::{Hit, NO_HIT};
use crate::path::Paths;
use crate::ray::Ray;
use crate::shape::Shape;
use crate::vector::{gmax, gmin, v3, Vector};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CubeTexture {
    Edges,
    /// Vertical stripes: `n` + 1 lines on each side face.
    Striped(u32),
}

#[derive(Clone, Debug)]
pub struct Cube {
    pub min: Vector,
    pub max: Vector,
    pub bbox: BBox,
    pub texture: CubeTexture,
}

pub fn new_cube(min: Vector, max: Vector) -> Cube {
    Cube { min, max, bbox: BBox::new(min, max), texture: CubeTexture::Edges }
}

impl Cube {
    pub fn with_texture(mut self, t: CubeTexture) -> Cube {
        self.texture = t;
        self
    }
    pub fn striped_paths(&self, stripes: u32) -> Paths {
        let (x1, y1, z1) = (self.min.x, self.min.y, self.min.z);
        let (x2, y2, z2) = (self.max.x, self.max.y, self.max.z);
        let mut paths = Vec::new();
        for i in 0..=stripes {
            let p = i as f64 / stripes as f64;
            let x = x1 + (x2 - x1) * p;
            let y = y1 + (y2 - y1) * p;
            paths.push(vec![v3(x, y1, z1), v3(x, y1, z2)]);
            paths.push(vec![v3(x, y2, z1), v3(x, y2, z2)]);
            paths.push(vec![v3(x1, y, z1), v3(x1, y, z2)]);
            paths.push(vec![v3(x2, y, z1), v3(x2, y, z2)]);
        }
        paths
    }
}

impl Shape for Cube {
    fn bounding_box(&self) -> BBox {
        self.bbox
    }
    fn contains(&self, v: Vector, f: f64) -> bool {
        if v.x < self.min.x - f || v.x > self.max.x + f {
            return false;
        }
        if v.y < self.min.y - f || v.y > self.max.y + f {
            return false;
        }
        if v.z < self.min.z - f || v.z > self.max.z + f {
            return false;
        }
        true
    }
    fn intersect(&self, r: &Ray) -> Hit {
        let n = self.min.sub(r.origin).div(r.direction);
        let f = self.max.sub(r.origin).div(r.direction);
        let (n, f) = (n.min(f), n.max(f));
        let t0 = gmax(gmax(n.x, n.y), n.z);
        let t1 = gmin(gmin(f.x, f.y), f.z);
        if t0 < 1e-3 && t1 > 1e-3 {
            return Hit::new(t1);
        }
        if t0 >= 1e-3 && t0 < t1 {
            return Hit::new(t0);
        }
        NO_HIT
    }
    fn paths(&self) -> Paths {
        if let CubeTexture::Striped(n) = self.texture {
            return self.striped_paths(n);
        }
        let (x1, y1, z1) = (self.min.x, self.min.y, self.min.z);
        let (x2, y2, z2) = (self.max.x, self.max.y, self.max.z);
        vec![
            vec![v3(x1, y1, z1), v3(x1, y1, z2)],
            vec![v3(x1, y1, z1), v3(x1, y2, z1)],
            vec![v3(x1, y1, z1), v3(x2, y1, z1)],
            vec![v3(x1, y1, z2), v3(x1, y2, z2)],
            vec![v3(x1, y1, z2), v3(x2, y1, z2)],
            vec![v3(x1, y2, z1), v3(x1, y2, z2)],
            vec![v3(x1, y2, z1), v3(x2, y2, z1)],
            vec![v3(x1, y2, z2), v3(x2, y2, z2)],
            vec![v3(x2, y1, z1), v3(x2, y1, z2)],
            vec![v3(x2, y1, z1), v3(x2, y2, z1)],
            vec![v3(x2, y1, z2), v3(x2, y2, z2)],
            vec![v3(x2, y2, z1), v3(x2, y2, z2)],
        ]
    }
}
