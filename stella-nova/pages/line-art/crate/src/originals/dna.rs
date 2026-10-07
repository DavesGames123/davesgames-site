//! Original scene (not an ln example): a DNA double helix. The two
//! backbones are tube meshes (geom.rs tube) with ring texture, the base
//! pairs are outline cylinders, and the phosphates are outline spheres.

use super::bar;
use super::geom::tube;
use crate::examples::*;
use crate::rng::Rng;
use crate::shape::WithPaths;
use crate::sphere::new_outline_sphere;
use std::f64::consts::TAU;

pub const EXAMPLE: Example = Example {
    key: "dna",
    title: "Double helix",
    source: "",
    blurb: "Two backbone tubes wound about one axis, ten base pairs per turn, the minor groove offset as in B-form DNA. Every rung and bead is an outline for the eye.",
    width: 1000.0,
    height: 1400.0,
    step: 0.01,
    camera: cam(v3(7.5, -9.0, 2.4), v3(0.0, 0.0, 0.0), Z_UP, 42.0, 0.1, 100.0),
    params: &[
        num("turns", "Turns", 1.0, 4.0, 0.25, 2.25),
        num("groove", "Groove angle (deg)", 90.0, 180.0, 1.0, 140.0),
        num("tube", "Backbone radius", 0.05, 0.25, 0.01, 0.14),
        num("tilt", "Tilt (deg)", -40.0, 40.0, 1.0, 18.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 1.0),
    ],
    build,
    camera_for: None,
    code: include_str!("dna.rs"),
    cost: 1,
};

fn build(p: &Params, c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let (turns, groove) = (p.get("turns"), p.get("groove").to_radians());
    let (radius, pitch) = (1.0, 3.4);
    let tilt = crate::matrix::rotate(v3(0.0, 1.0, 0.0), p.get("tilt").to_radians());
    let height = turns * pitch;
    let helix = |t: f64, phase: f64| -> Vector {
        let a = TAU * t / pitch + phase;
        tilt.mul_position(v3(radius * a.cos(), radius * a.sin(), t - height / 2.0))
    };
    let mut scene = Scene::new();
    for phase in [0.0, groove] {
        let curve: Vec<Vector> = (0..=(turns * 120.0) as usize).map(|i| helix(i as f64 / 120.0 * pitch, phase)).collect();
        let (mesh, rings) = tube(&curve, p.get("tube"), 8, false, 3, 0);
        scene.add(WithPaths::new(Box::new(mesh), rings));
    }
    let pairs = (turns * 10.0) as usize;
    for i in 0..=pairs {
        let t = i as f64 * pitch / 10.0;
        let (a, b) = (helix(t, 0.0), helix(t, groove));
        let mid = a.add(b).mul_scalar(0.5).add(v3(rng.float64() - 0.5, rng.float64() - 0.5, 0.0).mul_scalar(0.15));
        scene.add(bar(c.eye, c.up, a, mid, 0.05));
        scene.add(bar(c.eye, c.up, mid, b, 0.05));
        scene.add(Box::new(new_outline_sphere(c.eye, c.up, a, p.get("tube") * 1.7)));
        scene.add(Box::new(new_outline_sphere(c.eye, c.up, b, p.get("tube") * 1.7)));
    }
    // </scene>
    Built::scene(scene)
}
