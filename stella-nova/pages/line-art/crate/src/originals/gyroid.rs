//! Original scene (not an ln example): a slab of a triply periodic minimal
//! surface, thickened to a sheet, as an Implicit solid (shapes.rs). The
//! texture is the level set cut by horizontal planes and by the box faces.

use super::shapes::{implicit_paths, Implicit};
use crate::bbox::BBox;
use crate::examples::*;
use crate::rng::Rng;
use std::f64::consts::{PI, TAU};

pub const EXAMPLE: Example = Example {
    key: "gyroid",
    title: "Gyroid slab",
    source: "",
    blurb: "A slab of a triply periodic minimal surface, thickened into a sheet. The solid is found by ray marching; the lines are its cuts by horizontal planes.",
    width: 1400.0,
    height: 1000.0,
    step: 0.02,
    camera: cam(v3(5.0, -6.2, 4.4), v3(0.0, 0.0, -0.1), Z_UP, 34.0, 0.1, 100.0),
    params: &[
        choice("surface", "Surface", 0.0, &["Gyroid", "Schwarz P", "Diamond"]),
        num("cells", "Cells across", 1.0, 4.0, 0.5, 2.0),
        num("wall", "Wall", 0.15, 0.9, 0.05, 0.45),
        num("slices", "Slices", 4.0, 30.0, 1.0, 14.0),
        num("seed", "Seed (phase)", 0.0, 999.0, 1.0, 1.0),
    ],
    build,
    camera_for: None,
    code: include_str!("gyroid.rs"),
    cost: 3,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let (ox, oy, oz) = (rng.float64() * TAU, rng.float64() * TAU, rng.float64() * TAU);
    let k = PI * p.get("cells") / 2.0; // 4 units hold `cells` periods
    let (wall, kind) = (p.get("wall"), p.int("surface"));
    let f = move |v: Vector| {
        let (x, y, z) = (v.x * k + ox, v.y * k + oy, v.z * k + oz);
        let g = match kind {
            0 => x.sin() * y.cos() + y.sin() * z.cos() + z.sin() * x.cos(),
            1 => x.cos() + y.cos() + z.cos(),
            _ => x.sin() * y.sin() * z.sin() + x.sin() * y.cos() * z.cos() + x.cos() * y.sin() * z.cos() + x.cos() * y.cos() * z.sin(),
        };
        g.abs() - wall
    };
    let bbox = BBox::new(v3(-2.0, -2.0, -0.75), v3(2.0, 2.0, 0.75));
    let paths = implicit_paths(&f, bbox, p.int("slices") as usize, 1, 0.025);
    let mut scene = Scene::new();
    scene.add(Box::new(Implicit { f: Box::new(f), bbox, step: 0.02, paths }));
    // </scene>
    Built::scene(scene)
}
