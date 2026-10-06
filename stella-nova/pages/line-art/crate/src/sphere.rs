//! Rust port of ln/sphere.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! ln has four sphere textures: Paths (the lat/lng grid, the default),
//! Paths2 (100 random great circles), Paths3 (20000 random dots) and
//! Paths4 (140 sets of random nested circles). Go picks one by the method
//! name. The port picks one with `SphereTexture`. The random textures take
//! a seed (Go reads the global source).
//! OutlineSphere draws only the silhouette circle seen from `eye`.

use crate::bbox::BBox;
use crate::hit::{Hit, NO_HIT};
use crate::matrix::identity;
use crate::path::{Path, PathExt, Paths};
use crate::ray::Ray;
use crate::rng::Rng;
use crate::shape::Shape;
use crate::util::radians;
use crate::vector::{random_unit_vector, v3, Vector};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SphereTexture {
    /// ln Paths: latitude rings and meridians every 10 degrees.
    LatLng,
    /// ln Paths2: random great circles.
    GreatCircles(u64),
    /// ln Paths3: random dots (one-segment paths of zero length).
    Dots(u64),
    /// ln Paths4: random circles that do not overlap, each with 1-4 rings.
    Circles(u64),
}

#[derive(Clone, Debug)]
pub struct Sphere {
    pub center: Vector,
    pub radius: f64,
    pub bbox: BBox,
    pub texture: SphereTexture,
}

pub fn new_sphere(center: Vector, radius: f64) -> Sphere {
    let min = v3(center.x - radius, center.y - radius, center.z - radius);
    let max = v3(center.x + radius, center.y + radius, center.z + radius);
    Sphere { center, radius, bbox: BBox::new(min, max), texture: SphereTexture::LatLng }
}

impl Sphere {
    pub fn with_texture(mut self, t: SphereTexture) -> Sphere {
        self.texture = t;
        self
    }

    pub fn intersect_sphere(&self, r: &Ray) -> Hit {
        let radius = self.radius;
        let to = r.origin.sub(self.center);
        let b = to.dot(r.direction);
        let c = to.dot(to) - radius * radius;
        let mut d = b * b - c;
        if d > 0.0 {
            d = d.sqrt();
            let t1 = -b - d;
            if t1 > 1e-2 {
                return Hit::new(t1);
            }
            let t2 = -b + d;
            if t2 > 1e-2 {
                return Hit::new(t2);
            }
        }
        NO_HIT
    }

    /// ln Paths4.
    pub fn paths4(&self, seed: u64) -> Paths {
        let mut rng = Rng::new(seed);
        let mut paths = Vec::new();
        let mut seen: Vec<Vector> = Vec::new();
        let mut radii: Vec<f64> = Vec::new();
        for _ in 0..140 {
            let mut v;
            let mut m;
            let mut tries = 0;
            loop {
                v = random_unit_vector(&mut rng);
                m = rng.float64() * 0.25 + 0.05;
                let mut ok = true;
                for (i, other) in seen.iter().enumerate() {
                    let threshold = m + radii[i] + 0.02;
                    if other.sub(v).length() < threshold {
                        ok = false;
                        break;
                    }
                }
                tries += 1;
                // Not in ln: stop after many tries, so a full sphere
                // cannot hang the render. ln loops until it finds a place.
                if ok || tries > 20000 {
                    seen.push(v);
                    radii.push(m);
                    break;
                }
            }
            let p = v.cross(random_unit_vector(&mut rng)).normalize();
            let q = p.cross(v).normalize();
            let n = rng.intn(4) + 1;
            for _ in 0..n {
                let mut path = Vec::with_capacity(73);
                let mut j = 0;
                while j <= 360 {
                    let a = radians(j as f64);
                    let mut x = v;
                    x = x.add(p.mul_scalar(a.cos() * m));
                    x = x.add(q.mul_scalar(a.sin() * m));
                    x = x.normalize();
                    x = x.mul_scalar(self.radius).add(self.center);
                    path.push(x);
                    j += 5;
                }
                paths.push(path);
                m *= 0.75;
            }
        }
        paths
    }

    /// ln Paths3.
    pub fn paths3(&self, seed: u64) -> Paths {
        let mut rng = Rng::new(seed);
        let mut paths = Vec::with_capacity(20000);
        for _ in 0..20000 {
            let v = random_unit_vector(&mut rng).mul_scalar(self.radius).add(self.center);
            paths.push(vec![v, v]);
        }
        paths
    }

    /// ln Paths2.
    pub fn paths2(&self, seed: u64) -> Paths {
        let mut rng = Rng::new(seed);
        let mut equator: Path = Vec::with_capacity(361);
        for lng in 0..=360 {
            equator.push(lat_lng_to_xyz(0.0, lng as f64, self.radius));
        }
        let mut paths = Vec::with_capacity(100);
        for _ in 0..100 {
            let mut m = identity();
            for _ in 0..3 {
                let v = random_unit_vector(&mut rng);
                m = m.rotate(v, rng.float64() * 2.0 * std::f64::consts::PI);
            }
            m = m.translate(self.center);
            paths.push(equator.transform(&m));
        }
        paths
    }

    /// ln Paths (the default).
    pub fn paths_lat_lng(&self) -> Paths {
        let mut paths = Vec::new();
        let n = 10;
        let o = 10;
        let mut lat = -90 + o;
        while lat <= 90 - o {
            let mut path = Vec::with_capacity(361);
            for lng in 0..=360 {
                path.push(lat_lng_to_xyz(lat as f64, lng as f64, self.radius).add(self.center));
            }
            paths.push(path);
            lat += n;
        }
        let mut lng = 0;
        while lng <= 360 {
            let mut path = Vec::new();
            for lat in (-90 + o)..=(90 - o) {
                path.push(lat_lng_to_xyz(lat as f64, lng as f64, self.radius).add(self.center));
            }
            paths.push(path);
            lng += n;
        }
        paths
    }
}

impl Shape for Sphere {
    fn bounding_box(&self) -> BBox {
        self.bbox
    }
    fn contains(&self, v: Vector, f: f64) -> bool {
        v.sub(self.center).length() <= self.radius + f
    }
    fn intersect(&self, r: &Ray) -> Hit {
        self.intersect_sphere(r)
    }
    fn paths(&self) -> Paths {
        match self.texture {
            SphereTexture::LatLng => self.paths_lat_lng(),
            SphereTexture::GreatCircles(s) => self.paths2(s),
            SphereTexture::Dots(s) => self.paths3(s),
            SphereTexture::Circles(s) => self.paths4(s),
        }
    }
}

/// A point on a sphere at the origin. lat and lng are in degrees; z is up.
pub fn lat_lng_to_xyz(lat: f64, lng: f64, radius: f64) -> Vector {
    let (lat, lng) = (radians(lat), radians(lng));
    v3(radius * lat.cos() * lng.cos(), radius * lat.cos() * lng.sin(), radius * lat.sin())
}

/// A sphere that draws only its outline as seen from `eye`.
pub struct OutlineSphere {
    pub sphere: Sphere,
    pub eye: Vector,
    pub up: Vector,
}

pub fn new_outline_sphere(eye: Vector, up: Vector, center: Vector, radius: f64) -> OutlineSphere {
    OutlineSphere { sphere: new_sphere(center, radius), eye, up }
}

impl Shape for OutlineSphere {
    fn bounding_box(&self) -> BBox {
        self.sphere.bbox
    }
    fn contains(&self, v: Vector, f: f64) -> bool {
        self.sphere.contains(v, f)
    }
    fn intersect(&self, r: &Ray) -> Hit {
        self.sphere.intersect_sphere(r)
    }
    /// The tangent cone from the eye touches the sphere on a circle. That
    /// circle has center `c` (distance d from the eye) and radius `r`.
    fn paths(&self) -> Paths {
        let center = self.sphere.center;
        let radius = self.sphere.radius;
        let hyp = center.sub(self.eye).length();
        let opp = radius;
        let theta = (opp / hyp).asin();
        let adj = opp / theta.tan();
        let d = theta.cos() * adj;
        let r = theta.sin() * adj;
        let w = center.sub(self.eye).normalize();
        let u = w.cross(self.up).normalize();
        let v = w.cross(u).normalize();
        let c = self.eye.add(w.mul_scalar(d));
        let mut path = Vec::with_capacity(361);
        for i in 0..=360 {
            let a = radians(i as f64);
            let mut p = c;
            p = p.add(u.mul_scalar(a.cos() * r));
            p = p.add(v.mul_scalar(a.sin() * r));
            path.push(p);
        }
        vec![path]
    }
}
