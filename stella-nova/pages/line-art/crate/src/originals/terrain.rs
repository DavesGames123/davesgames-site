//! Original scene (not an ln example): a block diagram of terrain. The
//! ground is z = f(x, y) from seeded fractal noise, as a triangle mesh
//! with skirt walls. The texture is contour lines (marching squares on f)
//! and the profile of the cut edges.

use super::geom::{contours, heightfield, quad};
use super::Noise2;
use crate::examples::*;
use crate::mesh::new_mesh;
use crate::path::Paths;
use crate::rng::Rng;
use crate::shape::WithPaths;

pub const EXAMPLE: Example = Example {
    key: "terrain",
    title: "Contour block",
    source: "",
    blurb: "A cut block of land, drawn the way a geologist draws it: contour lines on top, the profile on the cut faces. The ground is a mesh of z = f(x, y).",
    width: 1500.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(6.5, -8.0, 6.5), v3(0.0, 0.0, -0.2), Z_UP, 38.0, 0.1, 100.0),
    params: &[
        num("relief", "Relief", 0.4, 3.0, 0.1, 1.6),
        num("levels", "Contour interval", 0.05, 0.4, 0.01, 0.1),
        num("rough", "Roughness", 1.0, 6.0, 1.0, 5.0),
        choice("texture", "Texture", 0.0, &["Contours", "Grid", "Both"]),
        num("seed", "Seed", 0.0, 999.0, 1.0, 5.0),
    ],
    build,
    camera_for: None,
    code: include_str!("terrain.rs"),
    cost: 2,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let noise = Noise2::new(&mut rng, 32);
    let (relief, oct) = (p.get("relief"), p.int("rough") as usize);
    let f = move |x: f64, y: f64| {
        let e = noise.fbm(x * 0.45 + 3.0, y * 0.45 + 7.0, oct);
        relief * (e * e * 2.2 - 0.35)
    };
    let (a, n, base) = (3.0, 120, -0.9);
    let mut mesh = heightfield(&f, -a, a, -a, a, n, n);
    // skirt walls down to the base
    let edge = |t: f64, s: usize| match s {
        0 => v3(-a + 2.0 * a * t, -a, 0.0),
        1 => v3(a, -a + 2.0 * a * t, 0.0),
        2 => v3(a - 2.0 * a * t, a, 0.0),
        _ => v3(-a, a - 2.0 * a * t, 0.0),
    };
    let mut lines: Paths = Vec::new();
    for s in 0..4 {
        let pts: Vec<Vector> = (0..=n).map(|i| { let e = edge(i as f64 / n as f64, s); v3(e.x, e.y, f(e.x, e.y)) }).collect();
        for i in 0..n {
            let (p0, p1) = (pts[i], pts[i + 1]);
            quad(&mut mesh.triangles, v3(p0.x, p0.y, base), v3(p1.x, p1.y, base), p1, p0);
        }
        // the profile, a hair outside the wall, and the strata on the wall
        let out = |v: Vector| { let o = v3(v.x.signum() * (v.x.abs() > a - 1e-9) as i32 as f64, v.y.signum() * (v.y.abs() > a - 1e-9) as i32 as f64, 0.0); v.add(o.mul_scalar(2e-3)) };
        lines.push(pts.iter().map(|&v| out(v)).collect());
        lines.push(vec![out(v3(pts[0].x, pts[0].y, base)), out(v3(pts[n].x, pts[n].y, base))]);
        lines.push(vec![out(v3(pts[0].x, pts[0].y, base)), out(pts[0])]);
        let mut z = base + 0.15;
        while z < relief * 1.9 {
            let seg: Vec<Vector> = pts.iter().filter(|v| v.z > z).map(|&v| out(v3(v.x, v.y, z))).collect();
            if seg.len() > 1 { lines.push(seg); }
            z += 0.15;
        }
    }
    let mesh = new_mesh(mesh.triangles);
    let lift = 0.004;
    let tex = p.int("texture");
    if tex != 1 {
        let dz = p.get("levels");
        let mut level = -relief;
        while level < relief * 2.0 {
            lines.extend(contours(&|x, y| f(x, y) - level, -a, a, -a, a, n, n, &|x, y| v3(x, y, level + lift)));
            level += dz;
        }
    }
    if tex != 0 {
        for k in 0..=24 {
            let t = -a + 2.0 * a * k as f64 / 24.0;
            lines.push((0..=n).map(|i| { let s = -a + 2.0 * a * i as f64 / n as f64; v3(t, s, f(t, s) + lift) }).collect());
            lines.push((0..=n).map(|i| { let s = -a + 2.0 * a * i as f64 / n as f64; v3(s, t, f(s, t) + lift) }).collect());
        }
    }
    let mut scene = Scene::new();
    scene.add(WithPaths::new(Box::new(mesh), lines));
    // </scene>
    Built::scene(scene)
}
