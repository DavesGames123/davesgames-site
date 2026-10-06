//! Rust port of ln examples/voxelize.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): a mesh turned into cubes. The Go
//! file loads bowser.stl (not in the ln repo); the port uses the ln
//! suzanne.obj, turned so z is up and the face looks at the camera.
//!
//! ln Voxelize puts a cube only at the two ends of each plane cut. A mesh
//! with large triangles (suzanne has 968) then gives a sparse dust of
//! cubes. The default "Shell" fill (mesh.rs voxelize_shell, not in ln)
//! marks every cell along each cut; the "Cut ends (ln)" option is the ln
//! rule.

use super::*;

pub const EXAMPLE: Example = Example {
    key: "voxelize",
    title: "Voxels",
    source: "examples/voxelize.go",
    blurb: "Plane cuts of a mesh, snapped to a grid of cubes. Every cube is a real solid, so the ray test hides the cubes behind.",
    width: 2048.0,
    height: 2048.0,
    step: 0.01,
    camera: cam(v3(-1.0, -2.0, 0.0), v3(0.0, 0.0, 0.0), Z_UP, 60.0, 0.1, 100.0),
    params: &[
        num("grid", "Cubes per unit (ln: 64)", 8.0, 64.0, 1.0, 24.0),
        choice("fill", "Fill", 0.0, &["Shell", "Cut ends (ln)"]),
    ],
    build,
    camera_for: None,
    code: include_str!("voxelize.rs"),
    cost: 3,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mesh = suzanne_z_up(-1.0);
    let size = 1.0 / p.get("grid");
    let cubes = if p.int("fill") == 0 { mesh.voxelize_shell(size) } else { mesh.voxelize(size) };
    let mut scene = Scene::new();
    for cube in cubes {
        scene.add(Box::new(cube));
    }
    // </scene>
    Built::scene(scene)
}
