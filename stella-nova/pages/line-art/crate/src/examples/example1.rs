//! Rust port of ln examples/example1.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): a 5 x 5 grid of cubes at random
//! heights.

use super::*;
use crate::cube::new_cube;
use crate::rng::Rng;
use crate::shape::Shape;

pub const EXAMPLE: Example = Example {
    key: "example1",
    title: "Cube field",
    source: "examples/example1.go",
    blurb: "A grid of unit cubes, each lifted by a random height. Near cubes hide the edges of the cubes behind them.",
    width: 1920.0,
    height: 1200.0,
    step: 0.01,
    camera: cam(v3(6.0, 5.0, 3.0), v3(0.0, 0.0, 0.0), Z_UP, 30.0, 0.1, 100.0),
    params: &[num("n", "Grid half width", 1.0, 5.0, 1.0, 2.0), num("lift", "Height spread", 0.0, 3.0, 0.05, 1.0), num("seed", "Seed", 0.0, 999.0, 1.0, 1.0)],
    build,
    camera_for: None,
    code: include_str!("example1.rs"),
    cost: 1,
};

// <scene>
fn cube(x: f64, y: f64, z: f64) -> Box<dyn Shape> {
    let size = 0.5;
    let v = v3(x, y, z);
    Box::new(new_cube(v.sub_scalar(size), v.add_scalar(size)))
}

fn build(p: &Params, _c: &Camera) -> Built {
    let mut rng = Rng::new(p.seed());
    let mut scene = Scene::new();
    let n = p.int("n");
    for x in -n..=n {
        for y in -n..=n {
            let z = rng.float64() * p.get("lift");
            scene.add(cube(x as f64, y as f64, z));
        }
    }
    Built::scene(scene)
}
// </scene>
