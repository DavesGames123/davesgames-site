//! Rust port of ln examples/mountain.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): a voxel mountain, one unit cube
//! per block. The Go file reads mountain.csv, which is not in the ln
//! repository. The port makes its own blocks from a seeded height field:
//! a peak with ridges from value noise. It keeps the Go camera, lens,
//! far plane and the 0.1 chop step. Like the Go loader, each block is a
//! cube of size 1 at an integer point; only blocks that can show are made
//! (each column is filled down to its lowest neighbour).

use super::*;
use crate::cube::new_cube;
use crate::rng::Rng;

pub const EXAMPLE: Example = Example {
    key: "mountain",
    title: "Block mountain",
    source: "examples/mountain.go",
    blurb: "A mountain of unit cubes, the way a voxel map draws it. Each block is a cube; the ray test keeps only the faces in view.",
    width: 1920.0,
    height: 1080.0,
    step: 0.1,
    camera: cam(v3(90.0, -90.0, 70.0), v3(0.0, 0.0, -15.0), Z_UP, 50.0, 0.1, 1000.0),
    params: &[
        num("size", "Width in blocks", 24.0, 110.0, 2.0, 88.0),
        num("height", "Peak height", 8.0, 70.0, 1.0, 52.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 3.0),
    ],
    build,
    camera_for: None,
    code: include_str!("mountain.rs"),
    cost: 3,
};

// <scene>
fn build(p: &Params, _c: &Camera) -> Built {
    let n = p.int("size");
    let heights = height_field(p.seed(), n as usize, p.get("height"));
    let at = |x: i64, y: i64| -> i64 {
        if x < 0 || y < 0 || x >= n || y >= n { -1 } else { heights[(y * n + x) as usize] }
    };
    let mut scene = Scene::new();
    let size = v3(0.5, 0.5, 0.5);
    let base = -30.0;
    for y in 0..n {
        for x in 0..n {
            let h = at(x, y);
            let low = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].into_iter().min().unwrap().max(-1);
            for z in (low + 1).min(h)..=h {
                let v = v3((x - n / 2) as f64, (y - n / 2) as f64, base + z as f64);
                scene.add(Box::new(new_cube(v.sub(size), v.add(size))));
            }
        }
    }
    Built::scene(scene)
}
// </scene>

/// Block heights (0..=peak) on an n x n grid: a round peak, value-noise
/// ridges and a little roughness.
pub fn height_field(seed: u64, n: usize, peak: f64) -> Vec<i64> {
    let mut rng = Rng::new(seed);
    let g = 9usize;
    let lattice: Vec<f64> = (0..g * g * 4).map(|_| rng.float64()).collect();
    let noise = |x: f64, y: f64, octave: usize| -> f64 {
        let s = 2f64.powi(octave as i32) * 3.0;
        let (fx, fy) = (x * s, y * s);
        let (ix, iy) = (fx.floor(), fy.floor());
        let (tx, ty) = (fx - ix, fy - iy);
        let (sx, sy) = (tx * tx * (3.0 - 2.0 * tx), ty * ty * (3.0 - 2.0 * ty));
        let idx = |i: f64, j: f64| {
            let i = (i as i64).rem_euclid(g as i64) as usize;
            let j = (j as i64).rem_euclid(g as i64) as usize;
            lattice[(octave % 4) * g * g + j * g + i]
        };
        let a = idx(ix, iy) + (idx(ix + 1.0, iy) - idx(ix, iy)) * sx;
        let b = idx(ix, iy + 1.0) + (idx(ix + 1.0, iy + 1.0) - idx(ix, iy + 1.0)) * sx;
        a + (b - a) * sy
    };
    let ox = rng.float64() * 0.2 - 0.1;
    let oy = rng.float64() * 0.2 - 0.1;
    let mut out = Vec::with_capacity(n * n);
    for j in 0..n {
        for i in 0..n {
            let x = i as f64 / (n - 1) as f64;
            let y = j as f64 / (n - 1) as f64;
            let (dx, dy) = (x - 0.5 - ox, y - 0.5 - oy);
            let r = (dx * dx + dy * dy).sqrt();
            let dome = (-(r / 0.34).powi(2)).exp();
            let mut ridge = 0.0;
            let mut amp = 1.0;
            for o in 0..4 {
                ridge += amp * (1.0 - (noise(x, y, o) * 2.0 - 1.0).abs());
                amp *= 0.5;
            }
            let r = ridge / 1.875;
            let h = peak * (0.35 * dome + 0.65 * dome.sqrt() * r * r * r) + 2.5 * noise(x + 0.37, y + 0.11, 2);
            out.push(h.max(0.0).round() as i64);
        }
    }
    out
}
