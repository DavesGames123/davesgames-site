//! Not an ln example. A showcase of the four sphere textures in ln
//! ln/sphere.go (github.com/fogleman/ln, MIT, Copyright (C) 2016 Michael
//! Fogleman): Paths (lat/lng), Paths2 (great circles), Paths3 (dots) and
//! Paths4 (nested circles), one sphere each.

use super::*;
use crate::sphere::{new_sphere, SphereTexture};

pub const EXAMPLE: Example = Example {
    key: "textures",
    title: "Sphere textures",
    source: "",
    blurb: "The four vector textures of ln's sphere: latitude and longitude, random great circles, random dots and nested circles. The same ray test hides the far side of each.",
    width: 1600.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(0.0, -9.0, 3.2), v3(0.0, 0.0, 0.0), Z_UP, 36.0, 0.1, 100.0),
    params: &[
        choice("layout", "Spheres", 0.0, &["All four", "Lat/lng", "Great circles", "Dots", "Circles"]),
        num("seed", "Seed", 0.0, 999.0, 1.0, 7.0),
    ],
    build,
    camera_for: None,
    code: include_str!("textures.rs"),
    cost: 2,
};

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let s = p.seed();
    let textures = [SphereTexture::LatLng, SphereTexture::GreatCircles(s), SphereTexture::Dots(s), SphereTexture::Circles(s)];
    let mut scene = Scene::new();
    match p.int("layout") {
        0 => {
            for (i, t) in textures.iter().enumerate() {
                let x = (i as f64 - 1.5) * 2.3;
                scene.add(Box::new(new_sphere(v3(x, 0.0, 0.0), 1.0).with_texture(*t)));
            }
        }
        k => {
            let t = textures[(k - 1) as usize];
            scene.add(Box::new(new_sphere(v3(0.0, 0.0, 0.0), 2.6).with_texture(t)));
        }
    }
    // </scene>
    Built::scene(scene)
}
