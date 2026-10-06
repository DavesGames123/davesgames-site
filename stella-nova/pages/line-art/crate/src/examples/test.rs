//! Rust port of ln examples/test.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): a 17 x 17 grid of spheres with
//! the lat/lng texture, seen from low down. The empty cube loop of the Go
//! file is left out.

use super::*;
use crate::sphere::new_sphere;

pub const EXAMPLE: Example = Example {
    key: "test",
    title: "Sphere grid",
    source: "examples/test.go",
    blurb: "Spheres in a grid, each with ln's latitude and longitude rings. The camera sits low, so far spheres show only their tops.",
    width: 1024.0,
    height: 1024.0,
    step: 0.01,
    camera: cam(v3(8.0, 8.0, 1.0), v3(0.0, 0.0, -4.25), Z_UP, 50.0, 0.1, 100.0),
    params: &[num("n", "Grid half width", 2.0, 10.0, 1.0, 8.0), num("radius", "Radius", 0.2, 0.5, 0.01, 0.45)],
    build,
    camera_for: None,
    code: include_str!("test.rs"),
    cost: 2,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut scene = Scene::new();
    let n = p.int("n");
    for x in -n..=n {
        for y in -n..=n {
            scene.add(Box::new(new_sphere(v3(x as f64, y as f64, 0.0), p.get("radius"))));
        }
    }
    // </scene>
    Built::scene(scene)
}
