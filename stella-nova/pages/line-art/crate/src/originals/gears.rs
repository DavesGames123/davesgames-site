//! Original scene (not an ln example): a gear train on a base plate. Each
//! gear is an extruded mesh (geom.rs extrude) drawn by its sharp edges,
//! with a hub, an axle and spoke lines on its face. The teeth of each
//! pair mesh: the phase of each gear follows from the one before.

use super::geom::{circle, extrude, gear_profile};
use super::{bar, place};
use crate::cube::new_cube;
use crate::examples::*;
use crate::path::Paths;
use crate::rng::Rng;
use crate::shape::{Shape, WithPaths};
use std::f64::consts::{PI, TAU};

pub const EXAMPLE: Example = Example {
    key: "gears",
    title: "Gear train",
    source: "",
    blurb: "Spur gears that mesh tooth to gap, each an extruded triangle mesh drawn by its sharp edges. Turn the drive and every gear follows its ratio.",
    width: 1500.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(3.0, -11.0, 11.0), v3(0.0, 0.0, -0.2), Z_UP, 34.0, 0.1, 100.0),
    params: &[
        num("count", "Gears", 2.0, 8.0, 1.0, 5.0),
        num("turn", "Drive angle (deg)", 0.0, 360.0, 1.0, 0.0),
        num("module", "Tooth size", 0.06, 0.16, 0.01, 0.1),
        num("spokes", "Spokes", 0.0, 8.0, 1.0, 5.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 2.0),
    ],
    build,
    camera_for: None,
    code: include_str!("gears.rs"),
    cost: 1,
};

/// One gear at the origin: the toothed body, a hub and the face lines.
pub fn gear(teeth: usize, r: f64, depth: f64, z0: f64, z1: f64, spokes: usize) -> Box<dyn Shape> {
    let mut body = extrude(&gear_profile(teeth, r, depth), z0, z1);
    let mut lines: Paths = body.sharp_edges(25.0);
    let lift = z1 + 1e-3;
    let rim = r - depth * 1.4;
    let ring = |rr: f64| -> Vec<Vector> { (0..=72).map(|i| v3(rr * (TAU * i as f64 / 72.0).cos(), rr * (TAU * i as f64 / 72.0).sin(), lift)).collect() };
    if spokes > 0 && rim > r * 0.45 {
        lines.push(ring(rim));
        lines.push(ring(r * 0.3));
        for s in 0..spokes {
            let a = TAU * s as f64 / spokes as f64;
            for d in [-0.06, 0.06] {
                let (c, sn) = ((a + d).cos(), (a + d).sin());
                lines.push(vec![v3(c * r * 0.3, sn * r * 0.3, lift), v3(c * rim, sn * rim, lift)]);
            }
        }
    }
    body.edges = crate::mesh::MeshEdges::All;
    Box::new(WithPaths { shape: Box::new(body), paths: lines })
}

fn build(p: &Params, c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let m = p.get("module");
    let mut scene = Scene::new();
    let mut prev: Option<(Vector, f64, f64, usize)> = None; // centre, radius, phase, teeth
    let mut dir = rng.float64() * 0.6 - 0.3;
    let mut lo = v3(1e9, 1e9, 0.0);
    let mut hi = v3(-1e9, -1e9, 0.0);
    let mut placed = Vec::new();
    for i in 0..p.int("count") as usize {
        let teeth = 10 + rng.intn(22);
        let r = m * teeth as f64 / 2.0;
        let (at, phase) = match prev {
            None => (v3(0.0, 0.0, 0.0), p.get("turn").to_radians()),
            Some((c0, r0, ph0, t0)) => {
                let at = c0.add(v3(dir.cos(), dir.sin(), 0.0).mul_scalar(r0 + r));
                // tooth phase of the driver at the contact point, mirrored
                let u1 = ((dir - ph0) * t0 as f64 / TAU).rem_euclid(1.0);
                (at, dir + PI - TAU / teeth as f64 * (0.5 - u1))
            }
        };
        placed.push((at, r, phase, teeth));
        lo = lo.min(at.sub_scalar(r));
        hi = hi.max(at.add_scalar(r));
        prev = Some((at, r, phase, teeth));
        dir += if i % 2 == 0 { 0.7 + rng.float64() * 0.7 } else { -0.7 - rng.float64() * 0.7 };
    }
    let mid = lo.add(hi).mul_scalar(0.5);
    for (at, r, phase, teeth) in placed {
        let at = v3(at.x - mid.x, at.y - mid.y, 0.0);
        scene.add(place(gear(teeth, r, m * 2.2, 0.0, 0.22, p.int("spokes") as usize), phase, at));
        scene.add(place(Box::new(super::geom::extrude(&circle(r * 0.18, 32), 0.22, 0.34)), 0.0, at));
        scene.add(bar(c.eye, c.up, at.add(v3(0.0, 0.0, -0.3)), at.add(v3(0.0, 0.0, 0.5)), 0.05));
    }
    let (w, h) = ((hi.x - lo.x) / 2.0 + 0.6, (hi.y - lo.y) / 2.0 + 0.6);
    scene.add(Box::new(new_cube(v3(-w, -h, -0.5), v3(w, h, -0.3))));
    // </scene>
    Built::scene(scene)
}
