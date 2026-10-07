//! Original scene (not an ln example): a skeleton clock. A chapter ring
//! with ticks, three hands at the set time, and a train of gears behind
//! the dial, all standing up and facing the viewer. The gears are the
//! gear builder of gears.rs.

use super::gears::gear;
use super::geom::{annulus, circle, extrude};
use crate::examples::*;
use crate::matrix::rotate;
use crate::rng::Rng;
use crate::shape::{new_transformed_shape, Shape, WithPaths};
use std::f64::consts::{FRAC_PI_2, TAU};

pub const EXAMPLE: Example = Example {
    key: "clock",
    title: "Skeleton clock",
    source: "",
    blurb: "A chapter ring and three hands over an open train of gears. The ring hides the gears behind it; the gears show through the open centre.",
    width: 1100.0,
    height: 1100.0,
    step: 0.01,
    camera: cam(v3(2.4, -9.5, 2.2), v3(0.0, 0.0, 0.0), Z_UP, 36.0, 0.1, 100.0),
    params: &[
        num("time", "Time (hours)", 0.0, 12.0, 0.01, 10.15),
        num("gears", "Gears", 2.0, 7.0, 1.0, 5.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 3.0),
    ],
    build,
    camera_for: None,
    code: include_str!("clock.rs"),
    cost: 1,
};

/// A hand: a long thin kite from the centre, pointing up at angle 0.
fn hand(len: f64, w: f64, z0: f64, z1: f64) -> crate::mesh::Mesh {
    extrude(&[(0.0, -len * 0.18), (w, 0.0), (w * 0.35, len * 0.85), (0.0, len), (-w * 0.35, len * 0.85), (-w, 0.0)], z0, z1)
}

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let mut parts: Vec<Box<dyn Shape>> = Vec::new();
    // the chapter ring: 60 ticks, 12 long ones, on its front face
    let ring = annulus(1.75, 2.45, 0.0, 0.12, 120);
    let mut ticks = ring.sharp_edges(25.0);
    for i in 0..60 {
        let a = TAU * i as f64 / 60.0;
        let (r0, r1) = if i % 5 == 0 { (1.85, 2.3) } else { (2.12, 2.3) };
        let d = if i % 5 == 0 { 0.012 } else { 0.0 };
        for o in [-d, d] {
            let (c, s) = ((a + o).cos(), (a + o).sin());
            ticks.push(vec![v3(c * r0, s * r0, 0.121), v3(c * r1, s * r1, 0.121)]);
        }
    }
    parts.push(WithPaths::new(Box::new(ring), ticks));
    // the hands: hour, minute, second
    let t = p.get("time");
    let angles = [t / 12.0 * TAU, (t.fract()) * TAU, (t * 60.0).fract() * TAU];
    for (k, (len, w)) in [(1.2, 0.09), (1.75, 0.06), (1.9, 0.02)].iter().enumerate() {
        let z = 0.25 + 0.06 * k as f64;
        parts.push(new_transformed_shape(Box::new(hand(*len, *w, z, z + 0.04)), rotate(v3(0.0, 0.0, 1.0), angles[k])));
    }
    parts.push(Box::new(extrude(&circle(0.1, 24), 0.0, 0.42)));
    // the train behind the dial, each gear meshing with the one before
    let mut at = v3(0.0, 0.0, 0.0);
    let mut prev_r = 0.0;
    let mut dir: f64 = rng.float64() * TAU;
    for i in 0..p.int("gears") as usize {
        let teeth = 16 + rng.intn(28);
        let r = 0.034 * teeth as f64;
        if i > 0 {
            at = at.add(v3(dir.cos(), dir.sin(), 0.0).mul_scalar(prev_r + r));
            dir += 1.0 + rng.float64() * 1.2;
        }
        let z = -0.5 - 0.14 * (i % 2) as f64;
        let spin = angles[1] * if i % 2 == 0 { 1.0 } else { -1.0 } * 3.0 / (i + 1) as f64;
        parts.push(new_transformed_shape(gear(teeth, r, 0.09, z, z + 0.1, 4 + i % 3), rotate(v3(0.0, 0.0, 1.0), spin).translate(at)));
        prev_r = r;
    }
    parts.push(Box::new(annulus(0.25, 2.6, -1.0, -0.92, 96)));
    // stand the clock up: its z axis turns to face -y (the viewer)
    let up = rotate(v3(1.0, 0.0, 0.0), -FRAC_PI_2);
    let mut scene = Scene::new();
    for s in parts {
        scene.add(new_transformed_shape(s, up));
    }
    // </scene>
    Built::scene(scene)
}
