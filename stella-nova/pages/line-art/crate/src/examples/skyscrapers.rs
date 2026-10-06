//! Rust port of ln examples/skyscrapers.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): a city of boxes seen from above
//! with a 100 degree lens. Added: the striped texture of the ln README
//! (StripedCube), as an option.

use super::*;
use crate::cube::{new_cube, CubeTexture};
use crate::rng::Rng;

pub const EXAMPLE: Example = Example {
    key: "skyscrapers",
    title: "Skyscrapers",
    source: "examples/skyscrapers.go",
    blurb: "A 31 x 31 city block of random towers under a wide lens. One lot at (2, 1) stays empty, as in the Go file.",
    width: 1024.0,
    height: 1024.0,
    step: 0.01,
    camera: cam(v3(1.75, 1.25, 6.0), v3(0.0, 0.0, 0.0), Z_UP, 100.0, 0.1, 100.0),
    params: &[
        num("n", "Blocks each way", 4.0, 20.0, 1.0, 15.0),
        num("height", "Height spread", 0.5, 6.0, 0.1, 3.0),
        num("stripes", "Stripes (0 = edges)", 0.0, 12.0, 1.0, 0.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 1.0),
    ],
    build,
    camera_for: None,
    code: include_str!("skyscrapers.rs"),
    cost: 2,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let mut scene = Scene::new();
    let n = p.int("n");
    let stripes = p.int("stripes") as u32;
    for x in -n..=n {
        for y in -n..=n {
            let s = rng.float64() * 0.25 + 0.2;
            let _dx = rng.float64() * 0.5 - 0.25; // drawn but not used, as in ln
            let _dy = rng.float64() * 0.5 - 0.25;
            let (fx, fy) = (x as f64, y as f64);
            let fz = rng.float64() * p.get("height") + 1.0;
            if x == 2 && y == 1 {
                continue;
            }
            let mut cube = new_cube(v3(fx - s, fy - s, 0.0), v3(fx + s, fy + s, fz));
            if stripes > 0 {
                cube = cube.with_texture(CubeTexture::Striped(stripes));
            }
            scene.add(Box::new(cube));
        }
    }
    // </scene>
    Built::scene(scene)
}
