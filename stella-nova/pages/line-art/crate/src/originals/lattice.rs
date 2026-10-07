//! Original scene (not an ln example): a crystal lattice of spheres with
//! the ln sphere textures, joined by outline cylinder bonds to their
//! nearest neighbours.

use super::bar;
use crate::examples::*;
use crate::sphere::{new_outline_sphere, new_sphere, SphereTexture};

pub const EXAMPLE: Example = Example {
    key: "lattice",
    title: "Crystal lattice",
    source: "",
    blurb: "Atoms on a cubic, body-centred or face-centred lattice, each a sphere with one of ln's vector textures, bonded to its nearest neighbours.",
    width: 1400.0,
    height: 1000.0,
    step: 0.01,
    camera: cam(v3(6.2, -8.0, 5.0), v3(0.0, 0.0, 0.0), Z_UP, 36.0, 0.1, 100.0),
    params: &[
        choice("kind", "Lattice", 1.0, &["Simple cubic", "Body-centred", "Face-centred"]),
        num("cells", "Cells each way", 1.0, 4.0, 1.0, 2.0),
        num("radius", "Atom radius", 0.12, 0.45, 0.01, 0.36),
        choice("texture", "Atoms", 0.0, &["Lat/lng", "Great circles", "Circles", "Outline"]),
        num("seed", "Seed", 0.0, 999.0, 1.0, 1.0),
    ],
    build,
    camera_for: None,
    code: include_str!("lattice.rs"),
    cost: 2,
};

fn build(p: &Params, c: &Camera) -> Built {
    // <scene>
    let n = p.int("cells");
    let a = 1.8; // the cell edge
    let basis: &[(f64, f64, f64)] = match p.int("kind") {
        0 => &[(0.0, 0.0, 0.0)],
        1 => &[(0.0, 0.0, 0.0), (0.5, 0.5, 0.5)],
        _ => &[(0.0, 0.0, 0.0), (0.5, 0.5, 0.0), (0.5, 0.0, 0.5), (0.0, 0.5, 0.5)],
    };
    let half = n as f64 * a / 2.0;
    let mut atoms: Vec<Vector> = Vec::new();
    for i in 0..=n {
        for j in 0..=n {
            for k in 0..=n {
                for b in basis {
                    let v = v3((i as f64 + b.0) * a - half, (j as f64 + b.1) * a - half, (k as f64 + b.2) * a - half);
                    if v.x <= half + 1e-9 && v.y <= half + 1e-9 && v.z <= half + 1e-9 {
                        atoms.push(v);
                    }
                }
            }
        }
    }
    // the nearest neighbour distance of each lattice
    let d = match p.int("kind") { 0 => a, 1 => a * 3f64.sqrt() / 2.0, _ => a / 2f64.sqrt() };
    let r = p.get("radius");
    let mut scene = Scene::new();
    for (i, &v) in atoms.iter().enumerate() {
        let s = p.seed() + i as u64;
        match p.int("texture") {
            0 => scene.add(Box::new(new_sphere(v, r))),
            1 => scene.add(Box::new(new_sphere(v, r).with_texture(SphereTexture::GreatCircles(s)))),
            2 => scene.add(Box::new(new_sphere(v, r).with_texture(SphereTexture::Circles(s)))),
            _ => scene.add(Box::new(new_outline_sphere(c.eye, c.up, v, r))),
        }
        for &w in &atoms[i + 1..] {
            if (v.distance(w) - d).abs() < 1e-6 {
                let u = w.sub(v).normalize();
                scene.add(bar(c.eye, c.up, v.add(u.mul_scalar(r * 0.95)), w.sub(u.mul_scalar(r * 0.95)), r * 0.22));
            }
        }
    }
    // </scene>
    Built::scene(scene)
}
