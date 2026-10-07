//! Original scene (not an ln example): stair flights that climb around a
//! courtyard of block towers, seen through a long lens, so the drawing
//! is near an isometric view.

use super::block;
use crate::cube::new_cube;
use crate::examples::*;
use crate::rng::Rng;

pub const EXAMPLE: Example = Example {
    key: "stairs",
    title: "Endless stairs",
    source: "",
    blurb: "Flights of steps that climb around a square of block towers. A long lens flattens the depth, so the climb reads like an Escher print.",
    width: 1200.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(26.0, -30.0, 27.0), v3(0.0, 0.0, 1.6), Z_UP, 12.0, 0.1, 200.0),
    params: &[
        num("steps", "Steps per side", 3.0, 12.0, 1.0, 7.0),
        num("rise", "Rise", 0.05, 0.4, 0.01, 0.18),
        num("towers", "Towers", 0.0, 16.0, 1.0, 9.0),
        num("stripes", "Tower stripes", 0.0, 8.0, 1.0, 2.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 6.0),
    ],
    build,
    camera_for: None,
    code: include_str!("stairs.rs"),
    cost: 1,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let mut scene = Scene::new();
    let n = p.int("steps").max(2) as usize;
    let (w, rise) = (0.7, p.get("rise"));
    let side = n as f64 * w;
    let half = side / 2.0;
    let mut z = 1.0;
    // four flights around the square, each step a block from the ground
    for s in 0..4 {
        for i in 0..n {
            let t = -half + i as f64 * w;
            let (x, y) = match s { 0 => (t, -half), 1 => (half, t), 2 => (-t, half), _ => (-half, -t) };
            scene.add(Box::new(new_cube(v3(x - w / 2.0, y - w / 2.0, 0.0), v3(x + w / 2.0, y + w / 2.0, z))));
            z += rise;
        }
    }
    // block towers in the courtyard and outside it
    let stripes = p.int("stripes") as u32;
    for _ in 0..p.int("towers") {
        let inside = rng.float64() < 0.5;
        let (x, y) = if inside {
            ((rng.float64() - 0.5) * (side - 2.0 * w), (rng.float64() - 0.5) * (side - 2.0 * w))
        } else {
            let a = rng.float64() * std::f64::consts::TAU;
            (a.cos() * (half + 1.6 + rng.float64() * 2.0), a.sin() * (half + 1.6 + rng.float64() * 2.0))
        };
        let (s, h) = (0.25 + rng.float64() * 0.45, 0.6 + rng.float64() * (z + 0.8));
        let st = if rng.float64() < 0.6 { stripes } else { 0 };
        scene.add(block(v3(x - s, y - s, 0.0), v3(x + s, y + s, h), st));
    }
    // </scene>
    Built::scene(scene)
}
