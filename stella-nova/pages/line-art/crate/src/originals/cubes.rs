//! Original scene (not an ln example): a field of tumbling cubes, each
//! turned about a random axis (ln TransformedShape), some with the ln
//! striped texture.

use super::block;
use crate::examples::*;
use crate::matrix::rotate;
use crate::rng::Rng;
use crate::shape::{new_transformed_shape, Shape};
use crate::vector::random_unit_vector;

pub const EXAMPLE: Example = Example {
    key: "tumble",
    title: "Tumbling cubes",
    source: "",
    blurb: "A grid of cubes, each turned about its own random axis. Stripes and edges are the only texture; the ray test does the rest.",
    width: 1500.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(7.0, -9.0, 7.5), v3(0.0, 0.0, 0.0), Z_UP, 38.0, 0.1, 100.0),
    params: &[
        num("n", "Grid half width", 1.0, 6.0, 1.0, 4.0),
        num("spin", "Spin", 0.0, 1.0, 0.05, 0.6),
        num("striped", "Striped share", 0.0, 1.0, 0.05, 0.5),
        num("lift", "Height spread", 0.0, 3.0, 0.1, 1.2),
        num("seed", "Seed", 0.0, 999.0, 1.0, 9.0),
    ],
    build,
    camera_for: None,
    code: include_str!("cubes.rs"),
    cost: 1,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let mut scene = Scene::new();
    let n = p.int("n");
    for x in -n..=n {
        for y in -n..=n {
            let s = 0.32 + rng.float64() * 0.12;
            let stripes = if rng.float64() < p.get("striped") { 2 + rng.intn(7) as u32 } else { 0 };
            let cube = block(v3(-s, -s, -s), v3(s, s, s), stripes);
            let axis = random_unit_vector(&mut rng);
            let angle = rng.float64() * std::f64::consts::PI * p.get("spin");
            let z = rng.float64() * p.get("lift");
            let m = rotate(axis, angle).translate(v3(x as f64, y as f64, z));
            let shape: Box<dyn Shape> = new_transformed_shape(cube, m);
            scene.add(shape);
        }
    }
    // </scene>
    Built::scene(scene)
}
