//! Original scene (not an ln example): a lighthouse on a headland. The
//! land is a height field mesh with contour lines and a cliff; the tower,
//! gallery, lantern and roof are lathe meshes (geom.rs) with ring and
//! meridian texture; the sea is a flat box with wave strokes; the beams
//! are plain paths that the land and the tower can hide.

use super::geom::{annulus, contours, heightfield, lathe, lathe_rings};
use super::Noise2;
use crate::cube::new_cube;
use crate::examples::*;
use crate::rng::Rng;
use crate::shape::{new_transformed_shape, EmptyShape, Shape, WithPaths};
use crate::matrix::translate;

pub const EXAMPLE: Example = Example {
    key: "lighthouse",
    title: "Lighthouse",
    source: "",
    blurb: "A banded tower on a headland, contour lines on the land, strokes on the sea and two beams. All of it is lathe and height-field meshes with vector texture.",
    width: 1600.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(-5.0, -8.2, 3.4), v3(0.9, 1.3, 1.9), Z_UP, 42.0, 0.1, 100.0),
    params: &[
        num("beam", "Beam angle (deg)", 0.0, 360.0, 1.0, 200.0),
        num("bands", "Bands", 2.0, 7.0, 1.0, 4.0),
        num("cliff", "Cliff height", 0.6, 2.4, 0.1, 1.5),
        num("sea", "Sea strokes", 200.0, 2000.0, 50.0, 900.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 4.0),
    ],
    build,
    camera_for: None,
    code: include_str!("lighthouse.rs"),
    cost: 2,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let noise = Noise2::new(&mut rng, 24);
    let cliff = p.get("cliff");
    // the headland: inside a noisy blob the land is high, then a steep cliff
    let land = move |x: f64, y: f64| {
        let d = 1.0 - ((x - 1.0) / 4.2).powi(2) - ((y - 1.2) / 3.0).powi(2) + (noise.fbm(x * 0.6, y * 0.6, 4) - 0.5) * 0.9;
        let s = (d / 0.18).clamp(-1.0, 1.0);
        let top = cliff + (noise.fbm(x * 0.8 + 9.0, y * 0.8, 3) - 0.5) * 0.8 * (d.max(0.0)).min(1.0);
        -0.3 + (top + 0.3) * (s * 0.5 + 0.5).powi(2) * (3.0 - 2.0 * (s * 0.5 + 0.5))
    };
    let mut scene = Scene::new();
    let mesh = heightfield(&land, -5.0, 7.0, -3.0, 6.0, 132, 100);
    let mut lines = Vec::new();
    let mut z = 0.05;
    while z < cliff + 0.6 {
        lines.extend(contours(&|x, y| land(x, y) - z, -5.0, 7.0, -3.0, 6.0, 132, 100, &|x, y| v3(x, y, z + 0.004)));
        z += 0.12;
    }
    scene.add(WithPaths::new(Box::new(mesh), lines));
    // the tower at a high point of the land
    let (tx, ty) = (0.9, 1.3);
    let base = land(tx, ty);
    let tower = [(0.45, 0.0), (0.42, 0.6), (0.33, 2.4), (0.31, 2.6)];
    let bands = p.int("bands") as usize;
    let mut rings: Vec<f64> = Vec::new();
    for b in 0..bands {
        let (z0, z1) = (2.6 * (2 * b) as f64 / (2 * bands) as f64, 2.6 * (2 * b + 1) as f64 / (2 * bands) as f64);
        let mut z = z0;
        while z <= z1 { rings.push(z); z += 0.035; }
    }
    rings.push(2.6);
    let put = |s: Box<dyn Shape>, dz: f64| new_transformed_shape(s, translate(v3(tx, ty, base + dz)));
    scene.add(put(WithPaths::new(Box::new(lathe(&tower, 48)), lathe_rings(&tower, &rings, 8, 0.003)), -0.2));
    let gallery = annulus(0.2, 0.55, 2.4, 2.48, 48);
    let gp = gallery.sharp_edges(25.0);
    scene.add(put(WithPaths::new(Box::new(gallery), gp), 0.0));
    let lantern = [(0.24, 2.48), (0.24, 2.85)];
    scene.add(put(WithPaths::new(Box::new(lathe(&lantern, 32)), lathe_rings(&lantern, &[2.48, 2.85], 8, 0.003)), 0.0));
    let roof = [(0.32, 2.85), (0.05, 3.2), (0.0, 3.3)];
    scene.add(put(WithPaths::new(Box::new(lathe(&roof, 32)), lathe_rings(&roof, &[2.85], 16, 0.003)), 0.0));
    // two beams from the lantern
    let a = p.get("beam").to_radians();
    let c0 = v3(tx, ty, base + 2.66);
    let mut beams = Vec::new();
    for (da, s) in [(-0.06, 1.0), (0.06, 1.0), (std::f64::consts::PI - 0.06, 0.6), (std::f64::consts::PI + 0.06, 0.6)] {
        let d = v3((a + da).cos(), (a + da).sin(), -0.04);
        beams.push(vec![c0.add(d.mul_scalar(0.3)), c0.add(d.mul_scalar(11.0 * s))]);
    }
    scene.add(WithPaths::new(Box::new(EmptyShape), beams));
    // the sea
    let mut waves = Vec::new();
    for _ in 0..p.int("sea") {
        let (x, y) = (rng.float64() * 30.0 - 15.0, rng.float64() * 26.0 - 8.0);
        if land(x, y) > -0.05 { continue; }
        let l = 0.15 + rng.float64() * 0.5;
        waves.push(vec![v3(x, y, 0.001), v3(x + l, y + l * 0.15, 0.001)]);
    }
    scene.add(WithPaths::new(Box::new(new_cube(v3(-15.0, -8.0, -0.4), v3(15.0, 18.0, 0.0))), waves));
    // </scene>
    Built::scene(scene)
}
