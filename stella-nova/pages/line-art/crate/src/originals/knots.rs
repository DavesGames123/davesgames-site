//! Original scene (not an ln example): a field of torus knot tubes. Each
//! tube is a triangle mesh swept along the knot (geom.rs tube); its
//! texture is rings around the tube and a few stripes along it.

use super::geom::tube;
use crate::examples::*;
use crate::matrix::rotate;
use crate::rng::{Rng};
use crate::shape::{new_transformed_shape, WithPaths};
use crate::vector::random_unit_vector;
use std::f64::consts::TAU;

pub const EXAMPLE: Example = Example {
    key: "knots",
    title: "Torus knots",
    source: "",
    blurb: "Tubes swept along (p, q) torus knots. The tubes are triangle meshes; the rings and stripes on them are the only lines, and each tube hides the others.",
    width: 1500.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(0.0, -9.5, 5.6), v3(0.0, 0.0, 0.0), Z_UP, 40.0, 0.1, 100.0),
    params: &[
        num("cols", "Columns", 1.0, 4.0, 1.0, 3.0),
        num("rows", "Rows", 1.0, 3.0, 1.0, 2.0),
        num("thick", "Tube radius", 0.05, 0.25, 0.01, 0.13),
        num("rings", "Ring spacing", 1.0, 8.0, 1.0, 4.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 3.0),
    ],
    build,
    camera_for: None,
    code: include_str!("knots.rs"),
    cost: 2,
};

const PQ: [(f64, f64); 8] = [(2.0, 3.0), (2.0, 5.0), (3.0, 4.0), (3.0, 5.0), (2.0, 7.0), (3.0, 7.0), (4.0, 5.0), (3.0, 2.0)];

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let mut scene = Scene::new();
    let (cols, rows) = (p.int("cols"), p.int("rows"));
    for j in 0..rows {
        for i in 0..cols {
            let (pp, q) = PQ[rng.intn(PQ.len())];
            let curve: Vec<Vector> = (0..=480)
                .map(|k| {
                    let t = TAU * k as f64 / 480.0;
                    let r = (q * t).cos() + 2.2;
                    v3(r * (pp * t).cos(), r * (pp * t).sin(), -(q * t).sin()).mul_scalar(0.46)
                })
                .collect();
            let (mesh, rings) = tube(&curve, p.get("thick"), 10, true, p.int("rings") as usize, 5);
            let at = v3((i as f64 - (cols - 1) as f64 / 2.0) * 3.2, (j as f64 - (rows - 1) as f64 / 2.0) * 3.2, 0.0);
            let m = rotate(random_unit_vector(&mut rng), rng.float64() * 1.2).translate(at);
            scene.add(new_transformed_shape(WithPaths::new(Box::new(mesh), rings), m));
        }
    }
    // </scene>
    Built::scene(scene)
}
