//! Rust port of ln examples/beads.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): 50 strings of 200 outline
//! spheres. Each string walks from the origin along low-pass noise.
//!
//! Change: ln starts each low-pass filter at 0. The first values then ramp
//! up from 0, and after the -1..1 normalize most steps point to +x +y +z,
//! so all strings run to the eye at (8, 8, 8). With this port's random
//! source a bead holds the eye and hides the whole image. The default
//! "Centered" start (the filter starts at 0.5, the mean of the samples)
//! takes the ramp away. The "ln" option keeps the Go start.

use super::*;
use crate::rng::Rng;
use crate::sphere::new_outline_sphere;

pub const EXAMPLE: Example = Example {
    key: "beads",
    title: "Beads",
    source: "examples/beads.go",
    blurb: "Strings of beads that wander out from one point. Each bead is an outline sphere, so ten thousand circles hide one another.",
    width: 1900.0,
    height: 1575.0,
    step: 0.01,
    camera: cam(v3(8.0, 8.0, 8.0), v3(0.0, 0.0, 0.0), Z_UP, 50.0, 0.1, 100.0),
    params: &[
        num("strings", "Strings", 5.0, 80.0, 1.0, 50.0),
        num("beads", "Beads per string", 20.0, 300.0, 10.0, 200.0),
        num("radius", "Bead radius", 0.04, 0.2, 0.005, 0.1),
        num("seed", "Seed", 0.0, 9999.0, 1.0, 1211.0),
        choice("start", "Filter start", 0.0, &["Centered", "ln (0)"]),
    ],
    build,
    camera_for: None,
    code: include_str!("beads.rs"),
    cost: 3,
};

// <scene>
fn build(p: &Params, c: &Camera) -> Built {
    let mut rng = Rng::new(p.seed());
    let mut scene = Scene::new();
    let n = p.int("beads") as usize;
    let y0 = if p.int("start") == 0 { 0.5 } else { 0.0 };
    for _ in 0..p.int("strings") {
        let xs = low_pass_noise(&mut rng, n, 0.3, 4, y0);
        let ys = low_pass_noise(&mut rng, n, 0.3, 4, y0);
        let zs = low_pass_noise(&mut rng, n, 0.3, 4, y0);
        let ss = low_pass_noise(&mut rng, n, 0.3, 4, y0);
        let mut position = Vector::default();
        for i in 0..n {
            scene.add(Box::new(new_outline_sphere(c.eye, c.up, position, p.get("radius"))));
            let s = (ss[i] + 1.0) / 2.0 * 0.1 + 0.01;
            let v = v3(xs[i], ys[i], zs[i]).normalize().mul_scalar(s);
            position = position.add(v);
        }
    }
    Built::scene(scene)
}

fn low_pass_noise(rng: &mut Rng, n: usize, alpha: f64, iterations: usize, y0: f64) -> Vec<f64> {
    let mut result: Vec<f64> = (0..n).map(|_| rng.float64()).collect();
    for _ in 0..iterations {
        result = low_pass(&result, alpha, y0);
    }
    normalize(&result, -1.0, 1.0)
}
// </scene>

fn normalize(values: &[f64], a: f64, b: f64) -> Vec<f64> {
    let lo = values.iter().cloned().fold(values[0], f64::min);
    let hi = values.iter().cloned().fold(values[0], f64::max);
    values.iter().map(|&x| a + (x - lo) / (hi - lo) * (b - a)).collect()
}

fn low_pass(values: &[f64], alpha: f64, y0: f64) -> Vec<f64> {
    let mut y = y0;
    values
        .iter()
        .map(|&x| {
            y -= alpha * (y - x);
            y
        })
        .collect()
}
