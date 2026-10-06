//! Rust port of ln examples/slices.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): a mesh drawn only by its cuts
//! with planes on three axes, 101 planes each. The Go file loads
//! bowser.stl, which is not in the ln repo (and is not free art); the port
//! uses the ln suzanne.obj, turned so z is up.

use super::*;
use crate::mesh::Mesh;
use crate::path::Paths;
use crate::plane::Plane;
use crate::shape::{Shape, WithPaths};

pub const EXAMPLE: Example = Example {
    key: "slices",
    title: "Contour slices",
    source: "examples/slices.go",
    blurb: "A mesh drawn only by its cross sections. Each plane cut gives one segment per triangle; the mesh hides the cuts behind it.",
    width: 2048.0,
    height: 2048.0,
    step: 0.01,
    camera: cam(v3(-2.0, 2.0, 1.0), v3(0.0, 0.0, 0.0), Z_UP, 50.0, 0.1, 100.0),
    params: &[
        num("planes", "Planes per axis", 10.0, 160.0, 1.0, 100.0),
        choice("axes", "Axes", 0.0, &["x, y and z", "z only", "x and y"]),
    ],
    build,
    camera_for: None,
    code: include_str!("slices.rs"),
    cost: 2,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mesh = suzanne_z_up(1.0);
    let paths = slice_paths(&mesh, p.int("planes") as usize, p.int("axes"));
    let mut scene = Scene::new();
    scene.add(WithPaths::new(Box::new(mesh), paths));
    // </scene>
    Built::scene(scene)
}

// <scene>
fn slice_paths(mesh: &Mesh, n: usize, axes: i64) -> Paths {
    let mut result = Vec::new();
    for i in 0..=n {
        let p = i as f64 / n as f64;
        if axes != 2 {
            result.extend(Plane::new(v3(0.0, 0.0, p * 2.0 - 1.0), v3(0.0, 0.0, 1.0)).intersect_mesh(mesh));
        }
        if axes != 1 {
            result.extend(Plane::new(v3(p * 2.0 - 1.0, 0.0, 0.0), v3(1.0, 0.0, 0.0)).intersect_mesh(mesh));
            result.extend(Plane::new(v3(0.0, p * 2.0 - 1.0, 0.0), v3(0.0, 1.0, 0.0)).intersect_mesh(mesh));
        }
    }
    result
}
// </scene>

#[allow(dead_code)]
fn bounds(mesh: &Mesh) -> crate::bbox::BBox {
    mesh.bounding_box()
}
