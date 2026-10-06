//! Rust port of ln examples/suzanne.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): the Blender monkey from the ln
//! repository's suzanne.obj, with every triangle edge. Added: the sharp
//! edge texture (crate::mesh::MeshEdges::Sharp, not in ln).

use super::*;
use crate::matrix::rotate;
use crate::mesh::MeshEdges;
use crate::obj::load_obj;
use crate::shape::new_transformed_shape;

pub const EXAMPLE: Example = Example {
    key: "suzanne",
    title: "Suzanne",
    source: "examples/suzanne.go",
    blurb: "A triangle mesh from an OBJ file. The mesh has its own tree, so each visibility ray tests only a few of its 968 triangles.",
    width: 1024.0,
    height: 1024.0,
    step: 0.01,
    camera: cam(v3(-0.5, 0.5, 2.0), v3(0.0, 0.0, 0.0), v3(0.0, 1.0, 0.0), 35.0, 0.1, 100.0),
    params: &[
        num("turn", "Turn about y (rad)", -1.5, 1.5, 0.01, 0.5),
        choice("edges", "Edges", 0.0, &["Every triangle (ln)", "Sharp folds"]),
        num("fold", "Fold angle (deg)", 5.0, 60.0, 1.0, 22.0),
    ],
    build,
    camera_for: None,
    code: include_str!("suzanne.rs"),
    cost: 1,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut scene = Scene::new();
    let mut mesh = load_obj(SUZANNE_OBJ).expect("suzanne.obj");
    mesh.unit_cube();
    if p.int("edges") == 1 {
        mesh.edges = MeshEdges::Sharp(p.get("fold"));
    }
    let m = rotate(v3(0.0, 1.0, 0.0), p.get("turn"));
    scene.add(new_transformed_shape(Box::new(mesh), m));
    // </scene>
    Built::scene(scene)
}
