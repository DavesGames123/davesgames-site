//! Original scene (not an ln example): a Menger sponge by constructive
//! solid geometry: one cube minus square bars through it, level by level
//! (shapes.rs Carve). The lines are the cube edges, the bar edges and the
//! bar cross sections on the grid planes, cut to the carved boundary.

use super::shapes::new_carve;
use crate::cube::new_cube;
use crate::examples::*;
use crate::matrix::rotate;
use crate::path::Paths;
use crate::shape::{new_transformed_shape, Shape};

pub const EXAMPLE: Example = Example {
    key: "menger",
    title: "Menger sponge",
    source: "",
    blurb: "A cube minus square bars, level after level: constructive solid geometry with 30 cuts at level 2. The ray test finds the tunnels through the holes.",
    width: 1200.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(3.6, -4.4, 3.1), v3(0.0, 0.0, 0.0), Z_UP, 36.0, 0.1, 100.0),
    params: &[
        num("level", "Level", 1.0, 3.0, 1.0, 2.0),
        num("turn", "Turn (deg)", 0.0, 90.0, 1.0, 20.0),
        choice("grid", "Grid lines", 0.0, &["Finest level", "Bar edges only"]),
        num("seed", "Seed", 0.0, 999.0, 1.0, 1.0),
    ],
    build,
    camera_for: None,
    code: include_str!("menger.rs"),
    cost: 2,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let level = p.int("level").clamp(1, 3) as u32;
    let base = new_cube(v3(-1.0, -1.0, -1.0), v3(1.0, 1.0, 1.0));
    let mut lines: Paths = base.paths();
    let mut cuts: Vec<Box<dyn Shape>> = Vec::new();
    let fine = 2.0 / 3f64.powi(level as i32);
    let planes: Vec<f64> = (0..=3usize.pow(level)).map(|i| -1.0 + i as f64 * fine).collect();
    for k in 1..=level {
        let s = 2.0 / 3f64.powi(k as i32);
        let m = 3usize.pow(k - 1);
        for i in 0..m {
            for j in 0..m {
                let (u, v) = (-1.0 + (3 * i + 1) as f64 * s, -1.0 + (3 * j + 1) as f64 * s);
                for axis in 0..3 {
                    // a bar along `axis` with cross section [u, u+s] x [v, v+s]
                    let at = |w: f64, a: f64, b: f64| match axis { 0 => v3(w, a, b), 1 => v3(a, w, b), _ => v3(a, b, w) };
                    let (lo, hi) = (at(-1.5, u, v), at(1.5, u + s, v + s));
                    cuts.push(Box::new(new_cube(lo.min(hi), lo.max(hi))));
                    for (a, b) in [(u, v), (u + s, v), (u + s, v + s), (u, v + s)] {
                        lines.push(vec![at(-1.0, a, b), at(1.0, a, b)]);
                    }
                    if p.int("grid") == 0 {
                        for &w in &planes {
                            lines.push(vec![at(w, u, v), at(w, u + s, v), at(w, u + s, v + s), at(w, u, v + s), at(w, u, v)]);
                        }
                    } else {
                        for w in [-1.0, 1.0] {
                            lines.push(vec![at(w, u, v), at(w, u + s, v), at(w, u + s, v + s), at(w, u, v + s), at(w, u, v)]);
                        }
                    }
                }
            }
        }
    }
    let sponge = new_carve(Box::new(base), cuts, lines);
    let mut scene = Scene::new();
    scene.add(new_transformed_shape(Box::new(sponge), rotate(v3(0.0, 0.0, 1.0), p.get("turn").to_radians())));
    // </scene>
    Built::scene(scene)
}
