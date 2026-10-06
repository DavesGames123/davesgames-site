//! Rust port of ln examples/cones.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): a forest seen from the ground,
//! looking up. Each tree is an outline cone with 128 needle lines. The Go
//! file takes the tree places from pt.PoissonDisc (github.com/fogleman/pt);
//! `poisson_disc` here is an own Bridson sampler with the same arguments.

use super::*;
use crate::cone::new_transformed_outline_cone;
use crate::path::Path;
use crate::rng::Rng;
use crate::shape::{Shape, WithPaths};

pub const EXAMPLE: Example = Example {
    key: "cones",
    title: "Forest from below",
    source: "examples/cones.go",
    blurb: "Lie on the forest floor and look up a 90 degree lens. Trees are outline cones with needles, placed by Poisson disc sampling.",
    width: 2048.0,
    height: 2048.0,
    step: 0.1,
    camera: cam(v3(0.0, 0.0, 0.0), v3(0.5, 0.0, 8.0), Z_UP, 90.0, 0.1, 100.0),
    params: &[
        num("spacing", "Tree spacing", 1.2, 4.0, 0.1, 2.0),
        num("needles", "Needles per tree", 0.0, 256.0, 8.0, 128.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 10.0),
    ],
    build,
    camera_for: None,
    code: include_str!("cones.rs"),
    cost: 2,
};

// <scene>
fn build(p: &Params, c: &Camera) -> Built {
    let mut rng = Rng::new(p.seed());
    let (eye, up) = (c.eye, c.up);
    let mut scene = Scene::new();
    let n = 9.0;
    for (x, y) in poisson_disc(&mut rng, -n, -n, n, n, p.get("spacing"), 32) {
        let z = rng.float64() * 5.0 + 20.0;
        let v0 = v3(x, y, 0.0);
        let v1 = v3(x, y, z);
        if v0.distance(eye) < 1.0 {
            continue;
        }
        let cone = new_transformed_outline_cone(eye, up, v0, v1, z / 64.0);
        let mut paths = cone.paths();
        for _ in 0..p.int("needles") {
            let t = rng.float64().powf(1.5) * 0.5 + 0.5;
            let c = v0.add(v1.sub(v0).mul_scalar(t));
            let a = rng.float64() * 2.0 * std::f64::consts::PI;
            let l = (1.0 - t) * 8.0;
            let d = v3(a.cos(), a.sin(), -2.75).normalize();
            let e: Path = vec![c, c.add(d.mul_scalar(l))];
            paths.push(e);
        }
        scene.add(WithPaths::new(cone, paths));
    }
    Built::scene(scene)
}
// </scene>

/// Bridson's Poisson disc sampling in a rectangle: no two points closer
/// than `r`, `k` tries per active point.
pub fn poisson_disc(rng: &mut Rng, x0: f64, y0: f64, x1: f64, y1: f64, r: f64, k: usize) -> Vec<(f64, f64)> {
    let size = r / std::f64::consts::SQRT_2;
    let w = ((x1 - x0) / size).ceil() as usize + 1;
    let h = ((y1 - y0) / size).ceil() as usize + 1;
    let mut grid: Vec<Option<usize>> = vec![None; w * h];
    let mut points: Vec<(f64, f64)> = Vec::new();
    let mut active: Vec<usize> = Vec::new();
    let cell = |x: f64, y: f64| (((x - x0) / size) as usize, ((y - y0) / size) as usize);
    let first = (x0 + rng.float64() * (x1 - x0), y0 + rng.float64() * (y1 - y0));
    let (cx, cy) = cell(first.0, first.1);
    grid[cy * w + cx] = Some(0);
    points.push(first);
    active.push(0);
    while !active.is_empty() {
        let ai = rng.intn(active.len());
        let (px, py) = points[active[ai]];
        let mut found = false;
        for _ in 0..k {
            let a = rng.float64() * 2.0 * std::f64::consts::PI;
            let d = r * (1.0 + rng.float64());
            let (x, y) = (px + a.cos() * d, py + a.sin() * d);
            if x < x0 || x > x1 || y < y0 || y > y1 {
                continue;
            }
            let (gx, gy) = cell(x, y);
            let mut ok = true;
            'scan: for j in gy.saturating_sub(2)..(gy + 3).min(h) {
                for i in gx.saturating_sub(2)..(gx + 3).min(w) {
                    if let Some(q) = grid[j * w + i] {
                        let (qx, qy) = points[q];
                        if (qx - x).powi(2) + (qy - y).powi(2) < r * r {
                            ok = false;
                            break 'scan;
                        }
                    }
                }
            }
            if ok {
                grid[gy * w + gx] = Some(points.len());
                active.push(points.len());
                points.push((x, y));
                found = true;
                break;
            }
        }
        if !found {
            active.swap_remove(ai);
        }
    }
    points
}
