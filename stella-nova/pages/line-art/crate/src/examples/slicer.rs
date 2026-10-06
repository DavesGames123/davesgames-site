//! Rust port of ln examples/slicer.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): cut suzanne.obj into 32 flat
//! slices. The Go program writes one PNG per slice; the port lays the
//! slices out on one contact sheet (flat overlay paths, no 3D render).

use super::*;
use crate::bbox::BBox;
use crate::obj::load_obj;
use crate::plane::Plane;

pub const EXAMPLE: Example = Example {
    key: "slicer",
    title: "Slicer",
    source: "examples/slicer.go",
    blurb: "The mesh cut by horizontal planes, one tile per slice, the way a 3D printer slicer sees it. Plane.intersect_mesh gives one segment per triangle crossed.",
    width: 1600.0,
    height: 1000.0,
    step: 0.0,
    camera: cam(v3(0.0, 0.0, 5.0), v3(0.0, 0.0, 0.0), v3(0.0, 1.0, 0.0), 50.0, 0.1, 100.0),
    params: &[num("slices", "Slices", 4.0, 64.0, 1.0, 32.0), num("cols", "Columns", 2.0, 10.0, 1.0, 8.0)],
    build,
    camera_for: None,
    code: include_str!("slicer.rs"),
    cost: 1,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut mesh = load_obj(SUZANNE_OBJ).expect("suzanne.obj");
    mesh.fit_inside(BBox::new(v3(-1.0, -1.0, -1.0), v3(1.0, 1.0, 1.0)), v3(0.5, 0.5, 0.5));
    let slices = p.int("slices") as usize;
    let cols = p.int("cols") as usize;
    let rows = (slices + cols - 1) / cols;
    let tile = (2.0 / rows as f64).min(3.2 / cols as f64);
    let bb = mesh.bbox;
    let k = tile * 0.92 / bb.size().x.max(bb.size().y);
    let mut overlay = Vec::new();
    for i in 0..slices {
        let z = (i as f64 / (slices - 1) as f64) * 2.0 - 1.0;
        let plane = Plane::new(v3(0.0, 0.0, z), v3(0.0, 0.0, 1.0));
        let (col, row) = ((i % cols) as f64, (i / cols) as f64);
        let cx = (col - (cols as f64 - 1.0) / 2.0) * tile;
        let cy = ((rows as f64 - 1.0) / 2.0 - row) * tile;
        for seg in plane.intersect_mesh(&mesh) {
            overlay.push(seg.iter().map(|v| v3(cx + v.x * k, cy + v.y * k, 0.0)).collect());
        }
    }
    // </scene>
    Built { scene: Scene::new(), overlay }
}
