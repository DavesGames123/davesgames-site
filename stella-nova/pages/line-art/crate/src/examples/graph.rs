//! Rust port of ln examples/graph.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): a molecule-like graph of outline
//! spheres joined by outline cylinders. The Go program turns the eye about
//! z (`frame`); the page can also orbit.

use super::*;
use crate::cylinder::new_outline_cylinder;
use crate::matrix::{rotate, translate};
use crate::shape::new_transformed_shape;
use crate::sphere::new_outline_sphere;
use crate::util::radians;

pub const EXAMPLE: Example = Example {
    key: "graph",
    title: "Ball and stick",
    source: "examples/graph.go",
    blurb: "24 nodes and 25 edges as outline spheres and outline cylinders. Each outline is computed for the eye, so the silhouettes stay exact as the camera turns.",
    width: 750.0,
    height: 750.0,
    step: 0.01,
    camera: cam(v3(8.0, 0.0, 0.0), v3(0.0, 0.0, 0.0), Z_UP, 60.0, 0.1, 100.0),
    params: &[
        num("frame", "Frame (eye angle)", 0.0, 358.0, 2.0, 40.0),
        num("node", "Node radius", 0.15, 0.6, 0.01, 0.333),
        num("edge", "Edge radius", 0.03, 0.25, 0.01, 0.1),
    ],
    build,
    camera_for: Some(frame_camera),
    code: include_str!("graph.rs"),
    cost: 1,
};

pub const NODES: [[f64; 3]; 24] = [
    [1.047, -0.000, -1.312],
    [-0.208, -0.000, -1.790],
    [2.176, 0.000, -2.246],
    [1.285, -0.001, 0.016],
    [-1.276, -0.000, -0.971],
    [-0.384, 0.000, -2.993],
    [-2.629, -0.000, -1.533],
    [-1.098, -0.000, 0.402],
    [0.193, 0.005, 0.911],
    [-1.934, -0.000, 1.444],
    [2.428, -0.000, 0.437],
    [0.068, -0.000, 2.286],
    [-1.251, -0.000, 2.560],
    [1.161, -0.000, 3.261],
    [1.800, 0.001, -3.269],
    [2.783, 0.890, -2.082],
    [2.783, -0.889, -2.083],
    [-2.570, -0.000, -2.622],
    [-3.162, -0.890, -1.198],
    [-3.162, 0.889, -1.198],
    [-1.679, 0.000, 3.552],
    [1.432, -1.028, 3.503],
    [2.024, 0.513, 2.839],
    [0.839, 0.513, 4.167],
];

pub const EDGES: [[usize; 2]; 25] = [
    [0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 14], [2, 15], [2, 16], [3, 8], [3, 10],
    [4, 6], [4, 7], [6, 17], [6, 18], [6, 19], [7, 8], [7, 9], [8, 11], [9, 12], [11, 12],
    [11, 13], [12, 20], [13, 21], [13, 22], [13, 23],
];

/// The Go eye for a frame: on a circle of radius 8 about z. The page starts
/// from this eye and orbits from there.
pub fn frame_eye(frame: f64) -> Vector {
    v3(radians(frame).cos(), radians(frame).sin(), 0.0).mul_scalar(8.0)
}

fn frame_camera(p: &Params, c: Camera) -> Camera {
    Camera { eye: frame_eye(p.get("frame")), ..c }
}

fn build(p: &Params, c: &Camera) -> Built {
    // <scene>
    let (eye, up) = (c.eye, c.up);
    let mut scene = Scene::new();
    let nodes: Vec<Vector> = NODES.iter().map(|n| v3(n[0], n[1], n[2])).collect();
    for &v in &nodes {
        scene.add(Box::new(new_outline_sphere(eye, up, v, p.get("node"))));
    }
    for e in EDGES.iter() {
        let (v0, v1) = (nodes[e[0]], nodes[e[1]]);
        let d = v1.sub(v0);
        let z = d.length();
        let u = d.cross(up).normalize();
        let a = d.normalize().dot(up).acos();
        let mut m = translate(v0);
        if a != 0.0 {
            m = rotate(u, a).translate(v0);
        }
        let cyl = new_outline_cylinder(m.inverse().mul_position(eye), up, p.get("edge"), 0.0, z);
        scene.add(new_transformed_shape(Box::new(cyl), m));
    }
    // </scene>
    Built::scene(scene)
}
