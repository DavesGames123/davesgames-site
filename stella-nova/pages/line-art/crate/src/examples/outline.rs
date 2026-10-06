//! Rust port of ln examples/outline.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): a field of outline spheres at
//! random heights. Each sphere draws only its silhouette circle.

use super::*;
use crate::rng::Rng;
use crate::sphere::new_outline_sphere;

pub const EXAMPLE: Example = Example {
    key: "outline",
    title: "Outline spheres",
    source: "examples/outline.go",
    blurb: "A 21 x 21 field of spheres that draw only their outlines. Near spheres cut arcs out of the circles behind them.",
    width: 1920.0,
    height: 1200.0,
    step: 0.01,
    camera: cam(v3(8.0, 8.0, 8.0), v3(0.0, 0.0, 0.0), Z_UP, 50.0, 0.1, 100.0),
    params: &[
        num("n", "Grid half width", 3.0, 14.0, 1.0, 10.0),
        num("radius", "Radius", 0.2, 0.7, 0.01, 0.45),
        num("height", "Height spread", 0.0, 6.0, 0.1, 3.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 1.0),
    ],
    build,
    camera_for: None,
    code: include_str!("outline.rs"),
    cost: 2,
};

fn build(p: &Params, c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let mut scene = Scene::new();
    let n = p.int("n");
    for x in -n..=n {
        for y in -n..=n {
            let z = rng.float64() * p.get("height");
            let v = v3(x as f64, y as f64, z);
            scene.add(Box::new(new_outline_sphere(c.eye, c.up, v, p.get("radius"))));
        }
    }
    // </scene>
    Built::scene(scene)
}
