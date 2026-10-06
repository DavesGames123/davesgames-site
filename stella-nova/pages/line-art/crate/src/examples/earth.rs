//! Rust port of ln examples/earth.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman): world coastlines on a sphere,
//! seen from above Raleigh, with three halo rings. The Go file reads the
//! Natural Earth 10m coastline shapefile, which is not in the ln repo. The
//! port embeds the Natural Earth 50m coastline (public domain), thinned
//! to 0.04 degrees (crate/tools/coast.mjs makes data/coast50.bin).

use super::*;
use crate::matrix::rotate;
use crate::path::Path;
use crate::shape::{new_transformed_shape, Shape, WithPaths};
use crate::sphere::{lat_lng_to_xyz, new_sphere};
use crate::util::radians;

pub const EXAMPLE: Example = Example {
    key: "earth",
    title: "Earth",
    source: "examples/earth.go",
    blurb: "Coastlines on a sphere. The sphere draws nothing itself; it only hides the far side of the world.",
    width: 1024.0,
    height: 1024.0,
    step: 0.01,
    camera: cam(EYE, v3(0.0, 0.0, 0.0), Z_UP, 60.0, 0.1, 100.0),
    params: &[
        num("turn", "Turn (frame angle)", 0.0, 358.0, 2.0, 0.0),
        choice("grid", "Graticule", 0.0, &["Off", "On"]),
        choice("halo", "Halo rings", 1.0, &["Off", "On"]),
    ],
    build,
    camera_for: None,
    code: include_str!("earth.rs"),
    cost: 2,
};

/// ln: LatLngToXYZ(35.7806, -78.6389, 1).Normalize().MulScalar(2.46).
/// The const is that value, computed once (see the test in tests.rs).
pub const EYE: Vector = v3(0.3931372589, -1.9565985823, 1.4383202297);

const COAST: &[u8] = include_bytes!("../data/coast50.bin");

/// The coastlines as paths on the unit sphere.
pub fn coast_paths() -> Vec<Path> {
    let rd16 = |o: usize| i16::from_le_bytes([COAST[o], COAST[o + 1]]) as f64 / 100.0;
    let count = u16::from_le_bytes([COAST[0], COAST[1]]) as usize;
    let mut o = 2;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let n = u16::from_le_bytes([COAST[o], COAST[o + 1]]) as usize;
        o += 2;
        let mut path = Vec::with_capacity(n);
        for _ in 0..n {
            let (lng, lat) = (rd16(o), rd16(o + 2));
            path.push(lat_lng_to_xyz(lat, lng, 1.0));
            o += 4;
        }
        out.push(path);
    }
    out
}

fn circle(r: f64) -> Path {
    (0..=360).map(|i| v3(radians(i as f64).cos() * r, radians(i as f64).sin() * r, 0.0)).collect()
}

fn build(p: &Params, _c: &Camera) -> Built {
    // <scene>
    let sphere = new_sphere(v3(0.0, 0.0, 0.0), 1.0);
    let mut lines = coast_paths();
    if p.int("grid") == 1 {
        lines.extend(sphere.paths()); // the commented line of the Go file
    }
    let earth = WithPaths::new(Box::new(sphere), lines);
    let m = rotate(v3(0.0, 0.0, 1.0), radians(p.get("turn")));
    let mut scene = Scene::new();
    scene.add(new_transformed_shape(earth, m));
    let mut overlay = Vec::new();
    if p.int("halo") == 1 {
        overlay = vec![circle(0.95), circle(0.953), circle(0.956)];
    }
    // </scene>
    Built { scene, overlay }
}
