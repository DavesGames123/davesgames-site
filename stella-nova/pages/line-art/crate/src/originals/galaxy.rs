//! Original scene (not an ln example): a spiral galaxy of outline spheres
//! on logarithmic arms around a core sphere with the ln lat/lng texture.

use crate::examples::*;
use crate::rng::Rng;
use crate::sphere::{new_outline_sphere, new_sphere, SphereTexture};
use std::f64::consts::TAU;

pub const EXAMPLE: Example = Example {
    key: "galaxy",
    title: "Spiral galaxy",
    source: "",
    blurb: "Stars as outline spheres on logarithmic spiral arms, smaller toward the rim, around a ringed core. Near stars cut the circles behind them.",
    width: 1600.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(0.0, -9.0, 4.6), v3(0.0, 0.0, -0.6), Z_UP, 46.0, 0.1, 100.0),
    params: &[
        num("arms", "Arms", 1.0, 6.0, 1.0, 3.0),
        num("stars", "Stars", 100.0, 1600.0, 50.0, 700.0),
        num("wind", "Winding", 0.12, 0.5, 0.01, 0.28),
        choice("core", "Core", 0.0, &["Lat/lng", "Great circles", "Circles"]),
        num("seed", "Seed", 0.0, 999.0, 1.0, 11.0),
    ],
    build,
    camera_for: None,
    code: include_str!("galaxy.rs"),
    cost: 2,
};

fn build(p: &Params, c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let mut scene = Scene::new();
    let (arms, b) = (p.int("arms").max(1) as usize, p.get("wind"));
    for i in 0..p.int("stars") as usize {
        let arm = i % arms;
        let t = rng.float64().powf(0.7) * 2.6 * TAU / arms as f64 * 1.4;
        let r = 0.9 * (b * t).exp();
        if r > 7.0 {
            continue;
        }
        let spread = 0.12 + r * 0.07;
        let a = t + TAU * arm as f64 / arms as f64;
        let (dx, dy) = ((rng.float64() - 0.5) * spread * 2.0, (rng.float64() - 0.5) * spread * 2.0);
        let z = (rng.float64() - 0.5) * 0.35 * (-r / 4.0).exp();
        let size = (0.16 * (-r / 3.5).exp() + 0.02) * (0.6 + rng.float64() * 0.8);
        scene.add(Box::new(new_outline_sphere(c.eye, c.up, v3(r * a.cos() + dx, r * a.sin() + dy, z), size)));
    }
    let tex = match p.int("core") { 0 => SphereTexture::LatLng, 1 => SphereTexture::GreatCircles(p.seed()), _ => SphereTexture::Circles(p.seed()) };
    scene.add(Box::new(new_sphere(v3(0.0, 0.0, 0.0), 0.75).with_texture(tex)));
    // </scene>
    Built::scene(scene)
}
