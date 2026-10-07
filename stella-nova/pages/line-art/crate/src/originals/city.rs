//! Original scene (not an ln example): a city of towers carved by
//! constructive solid geometry. Each tower is a Carve (shapes.rs): a box
//! minus arches (cylinders) and slots (boxes). The cut rings at the tower
//! faces and the tunnel lines are cut to the boundary, as ln csg.go does.

use super::shapes::new_carve;
use crate::cube::{new_cube, CubeTexture};
use crate::cylinder::new_cylinder;
use crate::examples::*;
use crate::matrix::rotate;
use crate::path::Paths;
use crate::rng::Rng;
use crate::shape::{new_transformed_shape, Shape};
use std::f64::consts::{FRAC_PI_2, PI};

pub const EXAMPLE: Example = Example {
    key: "city",
    title: "Carved city",
    source: "",
    blurb: "Towers cut by arches and slots with constructive solid geometry. Each line is kept only where it lies on the carved boundary.",
    width: 1600.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(9.0, -11.0, 7.5), v3(0.0, 0.0, 1.0), Z_UP, 38.0, 0.1, 100.0),
    params: &[
        num("n", "Blocks each way", 2.0, 8.0, 1.0, 4.0),
        num("height", "Height spread", 1.0, 7.0, 0.5, 4.0),
        num("carve", "Carved share", 0.0, 1.0, 0.05, 0.75),
        num("floors", "Floor bands", 0.0, 1.0, 1.0, 1.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 4.0),
    ],
    build,
    camera_for: None,
    code: include_str!("city.rs"),
    cost: 2,
};

/// A ring (closed rectangle or circle points) as one path.
fn ring(pts: Vec<Vector>) -> Vec<Vector> {
    let mut p = pts;
    p.push(p[0]);
    p
}

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let mut scene = Scene::new();
    let n = p.int("n");
    for gx in -n..=n {
        for gy in -n..=n {
            let (cx, cy) = (gx as f64 * 2.4, gy as f64 * 2.4);
            let w = 0.55 + rng.float64() * 0.35;
            let h = 1.4 + rng.float64() * p.get("height");
            let (x0, x1, y0, y1) = (cx - w, cx + w, cy - w, cy + w);
            let base = new_cube(v3(x0, y0, 0.0), v3(x1, y1, h));
            let mut lines: Paths = base.clone().with_texture(CubeTexture::Striped(4)).paths();
            let floor = |z: f64| ring(vec![v3(x0, y0, z), v3(x1, y0, z), v3(x1, y1, z), v3(x0, y1, z)]);
            lines.push(floor(h));
            if p.int("floors") == 1 {
                let mut z = 0.6;
                while z < h - 0.2 {
                    lines.push(floor(z));
                    z += 0.6;
                }
            }
            let mut cuts: Vec<Box<dyn Shape>> = Vec::new();
            if rng.float64() < p.get("carve") {
                // an arch through the base, along x or y
                let along_x = rng.float64() < 0.5;
                let r = w * (0.62 + rng.float64() * 0.25);
                let zc = r * 0.55;
                let turn = if along_x { rotate(v3(0.0, 1.0, 0.0), FRAC_PI_2) } else { rotate(v3(1.0, 0.0, 0.0), FRAC_PI_2) };
                let m = turn.translate(v3(cx, cy, zc));
                cuts.push(new_transformed_shape(Box::new(new_cylinder(r, -3.0, 3.0)), m));
                for s in [-w, w, -w * 0.5, 0.0, w * 0.5] {
                    let c: Vec<Vector> = (0..=64).map(|i| {
                        let a = PI * 2.0 * i as f64 / 64.0;
                        let (u, z) = (r * a.cos(), zc + r * a.sin());
                        if along_x { v3(cx + s, cy + u, z) } else { v3(cx + u, cy + s, z) }
                    }).collect();
                    lines.push(c);
                }
                for k in 0..=8 {
                    let a = PI * k as f64 / 8.0;
                    let (u, z) = (r * a.cos(), zc + r * a.sin());
                    lines.push(if along_x { vec![v3(x0 - 0.1, cy + u, z), v3(x1 + 0.1, cy + u, z)] } else { vec![v3(cx + u, y0 - 0.1, z), v3(cx + u, y1 + 0.1, z)] });
                }
            }
            if rng.float64() < p.get("carve") {
                // a slot through the crown, across the other way
                let sw = w * (0.2 + rng.float64() * 0.2);
                let sd = 0.4 + rng.float64() * 0.9;
                let across_x = rng.float64() < 0.5;
                let (a, b) = if across_x {
                    (v3(x0 - 1.0, cy - sw, h - sd), v3(x1 + 1.0, cy + sw, h + 1.0))
                } else {
                    (v3(cx - sw, y0 - 1.0, h - sd), v3(cx + sw, y1 + 1.0, h + 1.0))
                };
                cuts.push(Box::new(new_cube(a, b)));
                for s in [-w, w] {
                    let r = if across_x {
                        vec![v3(cx + s, a.y, a.z), v3(cx + s, b.y, a.z), v3(cx + s, b.y, h), v3(cx + s, a.y, h)]
                    } else {
                        vec![v3(a.x, cy + s, a.z), v3(b.x, cy + s, a.z), v3(b.x, cy + s, h), v3(a.x, cy + s, h)]
                    };
                    lines.push(ring(r));
                }
                if across_x {
                    lines.push(vec![v3(x0, a.y, a.z), v3(x1, a.y, a.z)]);
                    lines.push(vec![v3(x0, b.y, a.z), v3(x1, b.y, a.z)]);
                } else {
                    lines.push(vec![v3(a.x, y0, a.z), v3(a.x, y1, a.z)]);
                    lines.push(vec![v3(b.x, y0, a.z), v3(b.x, y1, a.z)]);
                }
            }
            scene.add(Box::new(new_carve(Box::new(base), cuts, lines)));
        }
    }
    // </scene>
    Built::scene(scene)
}
