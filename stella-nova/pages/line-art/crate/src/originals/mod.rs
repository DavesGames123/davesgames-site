//! Not in ln. Original scenes for the line-art page, built only from the
//! engine of this crate (the ln port) and the helpers in geom.rs and
//! shapes.rs. They use the same Example table type as the ln examples
//! (crate::examples), so the page and the saver treat both the same way.
//! The page lists them under "Originals".
//!
//! GREP MAP
//!   grep -n 'pub static ORIGINALS'  the table
//!   grep -n 'pub fn bar'            an outline cylinder from a to b
//!   geom.rs                         meshes, contours, gear profile
//!   shapes.rs                       Implicit and Carve solids

use crate::cylinder::new_outline_cylinder;
use crate::examples::Example;
use crate::matrix::{rotate, translate};
use crate::shape::{new_transformed_shape, Shape};
use crate::vector::{v3, Vector};

pub mod geom;
pub mod shapes;

pub mod bridge;
pub mod city;
pub mod clock;
pub mod cubes;
pub mod dna;
pub mod forest;
pub mod galaxy;
pub mod gears;
pub mod gyroid;
pub mod knots;
pub mod lattice;
pub mod lighthouse;
pub mod menger;
pub mod stairs;
pub mod terrain;
pub mod textures;
pub mod waves;

#[cfg(test)]
mod tests;

pub static ORIGINALS: &[Example] = &[
    gyroid::EXAMPLE,
    city::EXAMPLE,
    gears::EXAMPLE,
    knots::EXAMPLE,
    terrain::EXAMPLE,
    lattice::EXAMPLE,
    forest::EXAMPLE,
    stairs::EXAMPLE,
    bridge::EXAMPLE,
    dna::EXAMPLE,
    menger::EXAMPLE,
    cubes::EXAMPLE,
    galaxy::EXAMPLE,
    waves::EXAMPLE,
    clock::EXAMPLE,
    lighthouse::EXAMPLE,
    textures::EXAMPLE,
];

/// An outline cylinder of radius `r` from `a` to `b`, outlined for `eye`.
/// The same construction as ln NewTransformedOutlineCylinder, with the
/// angle clamped and a downward bar turned over, so a bar that is parallel
/// to `up` gives no NaN.
pub fn bar(eye: Vector, up: Vector, a: Vector, b: Vector, r: f64) -> Box<dyn Shape> {
    let (a, b) = if b.sub(a).dot(up) < 0.0 { (b, a) } else { (a, b) };
    let d = b.sub(a);
    let z = d.length();
    let cos = d.normalize().dot(up).clamp(-1.0, 1.0);
    let ang = cos.acos();
    let axis = d.cross(up);
    let m = if ang.abs() < 1e-9 || axis.length() < 1e-12 { translate(a) } else { rotate(axis.normalize(), ang).translate(a) };
    let c = new_outline_cylinder(m.inverse().mul_position(eye), up, r, 0.0, z);
    new_transformed_shape(Box::new(c), m)
}

/// A box drawn with its 12 edges and, when `stripes` > 0, the ln stripes
/// (cube.rs Striped) as well. The ln striped texture has no edges.
pub fn block(min: Vector, max: Vector, stripes: u32) -> Box<dyn Shape> {
    use crate::cube::{new_cube, CubeTexture};
    let c = new_cube(min, max);
    let mut lines = c.paths();
    if stripes > 0 {
        lines.extend(c.clone().with_texture(CubeTexture::Striped(stripes)).paths());
    }
    crate::shape::WithPaths::new(Box::new(c), lines)
}

/// A shape turned about z by `a` radians, then moved to `at`.
pub fn place(s: Box<dyn Shape>, a: f64, at: Vector) -> Box<dyn Shape> {
    new_transformed_shape(s, rotate(v3(0.0, 0.0, 1.0), a).translate(at))
}

/// Value noise in 2D on a seeded lattice, smooth, in 0..1.
pub struct Noise2 {
    g: Vec<f64>,
    n: usize,
}

impl Noise2 {
    pub fn new(rng: &mut crate::rng::Rng, n: usize) -> Noise2 {
        Noise2 { g: (0..n * n).map(|_| rng.float64()).collect(), n }
    }
    pub fn at(&self, x: f64, y: f64) -> f64 {
        let (ix, iy) = (x.floor(), y.floor());
        let (tx, ty) = (x - ix, y - iy);
        let (sx, sy) = (tx * tx * (3.0 - 2.0 * tx), ty * ty * (3.0 - 2.0 * ty));
        let n = self.n as i64;
        let g = |i: f64, j: f64| self.g[((j as i64).rem_euclid(n) * n + (i as i64).rem_euclid(n)) as usize];
        let a = g(ix, iy) + (g(ix + 1.0, iy) - g(ix, iy)) * sx;
        let b = g(ix, iy + 1.0) + (g(ix + 1.0, iy + 1.0) - g(ix, iy + 1.0)) * sx;
        a + (b - a) * sy
    }
    /// Fractal sum of `oct` octaves, in about 0..1.
    pub fn fbm(&self, x: f64, y: f64, oct: usize) -> f64 {
        let (mut s, mut a, mut f, mut norm) = (0.0, 1.0, 1.0, 0.0);
        for k in 0..oct {
            s += a * self.at(x * f + k as f64 * 17.3, y * f - k as f64 * 9.1);
            norm += a;
            a *= 0.5;
            f *= 2.0;
        }
        s / norm
    }
}
