//! Original scene (not an ln example): a forest of stacked cones on a
//! hatched ground, with a moon. Trees stand on Poisson disc points (the
//! sampler of the cones example).

use super::bar;
use crate::cone::{new_cone, new_outline_cone};
use crate::cube::new_cube;
use crate::examples::cones::poisson_disc;
use crate::examples::*;
use crate::matrix::translate;
use crate::rng::Rng;
use crate::shape::{new_transformed_shape, Shape, WithPaths};
use crate::sphere::{new_sphere, SphereTexture};

pub const EXAMPLE: Example = Example {
    key: "forest",
    title: "Cone forest",
    source: "",
    blurb: "Fir trees of stacked cones on hatched ground. Near trees cut the hatching and the trees behind them; a moon of great circles hangs over the ridge.",
    width: 1600.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(0.0, -11.0, 2.6), v3(0.0, 0.0, 1.0), Z_UP, 46.0, 0.1, 100.0),
    params: &[
        num("spacing", "Tree spacing", 0.7, 2.5, 0.05, 1.1),
        num("tiers", "Tiers", 1.0, 5.0, 1.0, 3.0),
        choice("style", "Trees", 0.0, &["Needle lines", "Outlines"]),
        num("hatch", "Ground hatching", 0.08, 0.5, 0.01, 0.16),
        num("seed", "Seed", 0.0, 999.0, 1.0, 8.0),
    ],
    build,
    camera_for: None,
    code: include_str!("forest.rs"),
    cost: 2,
};

fn build(p: &Params, c: &Camera) -> Built {
    // <scene>
    let mut rng = Rng::new(p.seed());
    let mut scene = Scene::new();
    let size = 8.0;
    for (x, y) in poisson_disc(&mut rng, -size, -size * 0.6, size, size, p.get("spacing"), 30) {
        let h = 1.1 + rng.float64() * 1.6 + (y + size) * 0.06;
        let r = h * (0.24 + rng.float64() * 0.06);
        let tiers = p.int("tiers").max(1) as usize;
        scene.add(bar(c.eye, c.up, v3(x, y, 0.0), v3(x, y, h * 0.25), r * 0.12));
        for t in 0..tiers {
            let f = t as f64 / tiers as f64;
            let (z, rr, hh) = (h * (0.18 + 0.6 * f), r * (1.0 - 0.55 * f), h * (0.82 - 0.6 * f));
            let m = translate(v3(x, y, z));
            let cone: Box<dyn Shape> = if p.int("style") == 0 {
                Box::new(new_cone(rr, hh))
            } else {
                Box::new(new_outline_cone(m.inverse().mul_position(c.eye), c.up, rr, hh))
            };
            scene.add(new_transformed_shape(cone, m));
        }
    }
    // the ground: a flat box with hatch lines on its top face
    let mut hatch = Vec::new();
    let mut y = -size * 0.6;
    while y <= size {
        let wobble = rng.float64() * 0.4;
        hatch.push(vec![v3(-size - wobble, y, 1e-3), v3(size + wobble, y, 1e-3)]);
        y += p.get("hatch");
    }
    scene.add(WithPaths::new(Box::new(new_cube(v3(-size - 1.0, -size, -0.2), v3(size + 1.0, size + 1.0, 0.0))), hatch));
    scene.add(Box::new(new_sphere(v3(size * 0.45, size * 1.6, 6.8), 1.3).with_texture(SphereTexture::Circles(p.seed()))));
    // </scene>
    Built::scene(scene)
}
