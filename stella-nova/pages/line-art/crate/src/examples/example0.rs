//! Rust port of ln examples/example0.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): the hello world, one cube.
//! Added: the `stripes` texture of ln cube.go (dead code there) and of the
//! README StripedCube.

use super::*;
use crate::cube::{new_cube, CubeTexture};

pub const EXAMPLE: Example = Example {
    key: "example0",
    title: "One cube",
    source: "examples/example0.go",
    blurb: "The ln hello world: one cube, seen from (4, 3, 2). The back edges are hidden by the ray test.",
    width: 1024.0,
    height: 1024.0,
    step: 0.01,
    camera: cam(v3(4.0, 3.0, 2.0), v3(0.0, 0.0, 0.0), Z_UP, 50.0, 0.1, 10.0),
    params: &[num("size", "Half size", 0.5, 1.5, 0.05, 1.0), num("stripes", "Stripes (0 = edges)", 0.0, 24.0, 1.0, 0.0)],
    build,
    camera_for: None,
    code: include_str!("example0.rs"),
    cost: 1,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    // create a scene and add a single cube
    let mut scene = Scene::new();
    let s = p.get("size");
    let mut cube = new_cube(v3(-s, -s, -s), v3(s, s, s));
    if p.int("stripes") > 0 {
        cube = cube.with_texture(CubeTexture::Striped(p.int("stripes") as u32));
    }
    scene.add(Box::new(cube));
    // </scene>
    Built::scene(scene)
}
