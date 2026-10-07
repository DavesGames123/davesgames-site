//! Original scene (not an ln example): ripples from point sources that
//! interfere, as an ln Function (z = f(x, y), solid below) with the ln
//! grid texture (function.go Paths1).

use crate::bbox::BBox;
use crate::examples::*;
use crate::function::{new_function, Direction, FunctionTexture};
use crate::rng::Rng;

pub const EXAMPLE: Example = Example {
    key: "waves",
    title: "Interference",
    source: "",
    blurb: "Circular waves from a few point sources add up to an interference pattern. The surface is an ln Function: the ray test marches until it crosses z = f(x, y).",
    width: 1500.0,
    height: 1000.0,
    step: 0.02,
    camera: cam(v3(5.2, -6.0, 4.4), v3(0.0, 0.0, -0.3), Z_UP, 40.0, 0.1, 100.0),
    params: &[
        num("sources", "Sources", 1.0, 4.0, 1.0, 2.0),
        num("k", "Wave number", 2.0, 10.0, 0.25, 5.0),
        num("amp", "Amplitude", 0.1, 0.6, 0.01, 0.32),
        num("phase", "Phase (deg)", 0.0, 360.0, 1.0, 0.0),
        num("seed", "Seed", 0.0, 999.0, 1.0, 2.0),
    ],
    build,
    camera_for: None,
    code: include_str!("waves.rs"),
    cost: 2,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let src: Vec<(f64, f64)> = (0..p.int("sources")).map(|_| (rng.float64() * 3.6 - 1.8, rng.float64() * 3.6 - 1.8)).collect();
    let (k, amp, ph) = (p.get("k"), p.get("amp"), p.get("phase").to_radians());
    let n = src.len() as f64;
    let f = move |x: f64, y: f64| {
        let mut z = 0.0;
        for &(sx, sy) in &src {
            let r = ((x - sx).powi(2) + (y - sy).powi(2)).sqrt();
            z += (k * r - ph).sin() / (1.0 + 0.35 * r);
        }
        amp * z / n.sqrt()
    };
    let bbox = BBox::new(v3(-3.0, -3.0, -1.5), v3(3.0, 3.0, 1.5));
    let mut scene = Scene::new();
    scene.add(Box::new(new_function(Box::new(f), bbox, Direction::Below).with_texture(FunctionTexture::Grid)));
    // </scene>
    Built::scene(scene)
}
