//! Rust port of ln examples/function.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): the surface z = -1 / (x^2 + y^2)
//! with the solid below it. The second formula is the commented line of
//! the Go file. The texture choice gives the three Paths methods of
//! ln/function.go. The radial texture twists by -(-z)^1.4 and needs
//! z <= 0, so the second formula draws with the grid when radial is set.

use super::*;
use crate::bbox::BBox;
use crate::function::{new_function, Direction, FunctionTexture};

pub const EXAMPLE: Example = Example {
    key: "function",
    title: "Function well",
    source: "examples/function.go",
    blurb: "A height field z = f(x, y), solid below. The ray test marches in steps of 1/64 until it crosses the surface.",
    width: 1024.0,
    height: 1024.0,
    step: 0.01,
    camera: cam(v3(3.0, 0.0, 3.0), v3(1.1, 0.0, 0.0), Z_UP, 50.0, 0.1, 100.0),
    params: &[
        choice("formula", "Formula", 0.0, &["-1/(x\u{b2}+y\u{b2})", "cos(xy)(x\u{b2}-y\u{b2})"]),
        choice("texture", "Texture", 0.0, &["Radial", "Grid", "Spiral"]),
    ],
    build,
    camera_for: None,
    code: include_str!("function.rs"),
    cost: 2,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let formula = p.int("formula");
    let f: Box<dyn Fn(f64, f64) -> f64> = if formula == 0 {
        Box::new(|x, y| -1.0 / (x * x + y * y))
    } else {
        Box::new(|x, y| (x * y).cos() * (x * x - y * y))
    };
    let mut texture = [FunctionTexture::Radial, FunctionTexture::Grid, FunctionTexture::Spiral][p.int("texture") as usize];
    if formula != 0 && texture == FunctionTexture::Radial {
        texture = FunctionTexture::Grid;
    }
    let bbox = BBox::new(v3(-2.0, -2.0, -4.0), v3(2.0, 2.0, 2.0));
    let mut scene = Scene::new();
    scene.add(Box::new(new_function(f, bbox, Direction::Below).with_texture(texture)));
    // </scene>
    Built::scene(scene)
}
