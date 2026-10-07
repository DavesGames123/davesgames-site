//! Original scene (not an ln example): a Warren truss bridge on two piers
//! over hatched water. Every member is an outline cylinder (super::bar);
//! the deck and the piers are boxes.

use super::bar;
use super::block;
use crate::cube::new_cube;
use crate::examples::*;
use crate::rng::Rng;
use crate::shape::WithPaths;

pub const EXAMPLE: Example = Example {
    key: "bridge",
    title: "Truss bridge",
    source: "",
    blurb: "Two Warren trusses with cross bracing on a striped deck. Each member is an outline cylinder, so its silhouette is exact for the eye.",
    width: 1600.0,
    height: 900.0,
    step: 0.01,
    camera: cam(v3(7.5, -9.0, 3.2), v3(0.0, 0.0, -0.4), Z_UP, 44.0, 0.1, 100.0),
    params: &[
        num("panels", "Panels", 4.0, 14.0, 1.0, 8.0),
        num("height", "Truss height", 0.8, 2.4, 0.05, 1.4),
        num("bar", "Member radius", 0.02, 0.09, 0.005, 0.045),
        choice("brace", "Top bracing", 0.0, &["X braces", "Struts only"]),
        num("seed", "Seed", 0.0, 999.0, 1.0, 1.0),
    ],
    build,
    camera_for: None,
    code: include_str!("bridge.rs"),
    cost: 1,
};

fn build(p: &Params, c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let (n, h, r) = (p.int("panels") as usize, p.get("height"), p.get("bar"));
    let (span, wy) = (12.0, 0.9);
    let dx = span / n as f64;
    let x = |i: f64| -span / 2.0 + i * dx;
    let mut scene = Scene::new();
    let mut add = |a: Vector, b: Vector| scene.add(bar(c.eye, c.up, a, b, r));
    for y in [-wy, wy] {
        for i in 0..n {
            add(v3(x(i as f64), y, 0.0), v3(x(i as f64 + 1.0), y, 0.0)); // bottom chord
            add(v3(x(i as f64), y, 0.0), v3(x(i as f64 + 0.5), y, h)); // diagonals
            add(v3(x(i as f64 + 0.5), y, h), v3(x(i as f64 + 1.0), y, 0.0));
            if i + 1 < n {
                add(v3(x(i as f64 + 0.5), y, h), v3(x(i as f64 + 1.5), y, h)); // top chord
            }
        }
    }
    for i in 0..n {
        let xt = x(i as f64 + 0.5);
        add(v3(xt, -wy, h), v3(xt, wy, h));
        if p.int("brace") == 0 && i + 1 < n {
            add(v3(xt, -wy, h), v3(x(i as f64 + 1.5), wy, h));
            add(v3(xt, wy, h), v3(x(i as f64 + 1.5), -wy, h));
        }
    }
    scene.add(block(v3(-span / 2.0 - 0.6, -wy - 0.25, -0.22), v3(span / 2.0 + 0.6, wy + 0.25, -0.04), 2 * n as u32));
    for sx in [-1.0, 1.0] {
        let px = sx * (span / 2.0 + 0.2);
        scene.add(block(v3(px - 0.5, -wy - 0.5, -3.0), v3(px + 0.5, wy + 0.5, -0.22), 3));
    }
    // the water: short strokes on a flat box
    let mut waves = Vec::new();
    for _ in 0..700 {
        let (wx, wyy) = (rng.float64() * 40.0 - 20.0, rng.float64() * 30.0 - 10.0);
        let l = 0.2 + rng.float64() * 0.7;
        waves.push(vec![v3(wx, wyy, -2.999), v3(wx + l, wyy, -2.999)]);
    }
    scene.add(WithPaths::new(Box::new(new_cube(v3(-20.0, -10.0, -3.2), v3(20.0, 20.0, -3.0))), waves));
    // </scene>
    Built::scene(scene)
}
