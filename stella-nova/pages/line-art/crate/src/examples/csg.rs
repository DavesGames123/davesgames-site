//! Rust port of ln examples/csg.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): (sphere & cube) - three
//! cylinders. The Go program writes 45 frames that turn the shape about z;
//! the `angle` parameter is that frame angle.

use super::*;
use crate::csg::{new_difference, new_intersection};
use crate::cube::new_cube;
use crate::cylinder::new_cylinder;
use crate::matrix::rotate;
use crate::shape::new_transformed_shape;
use crate::sphere::new_sphere;
use crate::util::radians;

pub const EXAMPLE: Example = Example {
    key: "csg",
    title: "Drilled die",
    source: "examples/csg.go",
    blurb: "Constructive solid geometry: a sphere cut by a cube, then drilled by three cylinders. Paths of each solid stay only on the boundary of the result.",
    width: 750.0,
    height: 750.0,
    step: 0.01,
    camera: cam(v3(0.0, 6.0, 2.0), v3(0.0, 0.0, 0.0), Z_UP, 20.0, 0.1, 100.0),
    params: &[
        num("angle", "Turn (frame angle)", 0.0, 90.0, 1.0, 30.0),
        num("box", "Cube half size", 0.6, 1.0, 0.01, 0.8),
        num("hole", "Drill radius", 0.1, 0.7, 0.01, 0.4),
    ],
    build,
    camera_for: None,
    code: include_str!("csg.rs"),
    cost: 2,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let (b, r) = (p.get("box"), p.get("hole"));
    let shape = new_difference(vec![
        new_intersection(vec![
            Box::new(new_sphere(v3(0.0, 0.0, 0.0), 1.0)),
            Box::new(new_cube(v3(-b, -b, -b), v3(b, b, b))),
        ]),
        Box::new(new_cylinder(r, -2.0, 2.0)),
        new_transformed_shape(Box::new(new_cylinder(r, -2.0, 2.0)), rotate(v3(1.0, 0.0, 0.0), radians(90.0))),
        new_transformed_shape(Box::new(new_cylinder(r, -2.0, 2.0)), rotate(v3(0.0, 1.0, 0.0), radians(90.0))),
    ]);
    let mut scene = Scene::new();
    let m = rotate(v3(0.0, 0.0, 1.0), radians(p.get("angle")));
    scene.add(new_transformed_shape(shape, m));
    // </scene>
    Built::scene(scene)
}
