//! Tests of the original scenes and their helpers (`cargo test --release`).

use super::geom::{contours, extrude, gear_profile, stitch};
use super::shapes::{implicit_paths, new_carve, Implicit};
use super::ORIGINALS;
use crate::bbox::BBox;
use crate::cube::new_cube;
use crate::examples::{find, group_of, Params};
use crate::ray::Ray;
use crate::shape::Shape;
use crate::vector::{v3, Vector};

#[test]
fn sixteen_originals_and_one_table() {
    assert!(ORIGINALS.len() >= 16, "{} originals", ORIGINALS.len());
    for e in ORIGINALS {
        assert_eq!(group_of(e), "original", "{}", e.key);
        assert!(find(e.key).is_some());
        assert!(e.params.iter().any(|p| p.key == "seed"), "{} has no seed", e.key);
    }
    let mut keys: Vec<&str> = crate::examples::all().map(|e| e.key).collect();
    let n = keys.len();
    keys.sort();
    keys.dedup();
    assert_eq!(keys.len(), n, "keys are unique");
}

/// A seed changes a seeded scene, and the same seed gives the same paths.
#[test]
fn seeds_repeat_and_vary() {
    for key in ["city", "forest", "knots", "galaxy"] {
        let e = find(key).unwrap();
        let mut p = Params::defaults(e.params);
        let draw = |p: &Params| -> u64 { let s: f64 = (e.build)(p, &e.camera).scene.paths().iter().flatten().map(|v| v.x * 1.3 + v.y * 0.7 + v.z).sum(); (s * 1e6).round() as i64 as u64 };
        let a = draw(&p);
        assert_eq!(a, draw(&p), "{} repeats", key);
        let i = e.params.iter().position(|s| s.key == "seed").unwrap();
        p.values[i] += 1.0;
        assert_ne!(a, draw(&p), "{} varies with the seed", key);
    }
}

#[test]
fn marching_squares_closes_a_circle() {
    let paths = contours(&|x, y| x * x + y * y - 1.0, -2.0, 2.0, -2.0, 2.0, 64, 64, &|x, y| v3(x, y, 0.0));
    assert_eq!(paths.len(), 1, "one loop");
    let p = &paths[0];
    assert_eq!(p[0], *p.last().unwrap(), "the loop is closed");
    for v in p {
        assert!((v.length() - 1.0).abs() < 0.01, "{:?}", v);
    }
    let segs = vec![(1, 2), (3, 4), (2, 3)];
    assert_eq!(stitch(&segs), vec![vec![1, 2, 3, 4]]);
}

#[test]
fn gear_mesh_is_closed_and_sharp() {
    let m = extrude(&gear_profile(12, 1.0, 0.2), 0.0, 0.3);
    // every edge of a closed mesh has two faces: no open edges in the texture
    let edges = m.sharp_edges(25.0);
    assert!(edges.len() > 12 * 8, "teeth edges: {}", edges.len());
    for e in &edges {
        let z = (e[0].z + e[1].z) / 2.0;
        // cap fan edges (flat) are not sharp; sharp ones are on a rim or a vertical flank
        assert!(z.abs() < 1e-9 || (z - 0.3).abs() < 1e-9 || (e[0].z - e[1].z).abs() > 0.29, "{:?}", e);
    }
}

#[test]
fn carve_cuts_a_hole_through() {
    let base = new_cube(v3(-1.0, -1.0, -1.0), v3(1.0, 1.0, 1.0));
    let bar = new_cube(v3(-0.3, -0.3, -2.0), v3(0.3, 0.3, 2.0));
    let mut c = new_carve(Box::new(base), vec![Box::new(bar)], Vec::new());
    c.compile();
    assert!(c.contains(v3(0.8, 0.0, 0.0), 0.0));
    assert!(!c.contains(v3(0.0, 0.0, 0.0), 0.0), "the hole is empty");
    // down the hole: no hit
    assert!(!c.intersect(&Ray::new(v3(0.0, 0.0, 5.0), v3(0.0, 0.0, -1.0))).ok());
    // beside the hole: the top face at distance 4
    let h = c.intersect(&Ray::new(v3(0.6, 0.0, 5.0), v3(0.0, 0.0, -1.0)));
    assert!((h.t - 4.0).abs() < 1e-9, "{}", h.t);
    // from the side the ray meets the outer wall, not the far wall
    let h = c.intersect(&Ray::new(v3(5.0, 0.0, 0.0), v3(-1.0, 0.0, 0.0)));
    assert!((h.t - 4.0).abs() < 1e-9, "{}", h.t);
}

#[test]
fn implicit_sphere_matches_the_sphere() {
    let f = |v: Vector| v.length() - 1.0;
    let b = BBox::new(v3(-1.5, -1.5, -1.5), v3(1.5, 1.5, 1.5));
    let s = Implicit { f: Box::new(f), bbox: b, step: 0.005, paths: implicit_paths(&f, b, 8, 1, 0.05) };
    let h = s.intersect(&Ray::new(v3(0.0, 0.0, 5.0), v3(0.0, 0.0, -1.0)));
    assert!((h.t - 4.0).abs() < 0.006, "{}", h.t);
    assert!(!s.paths.is_empty());
    for p in &s.paths {
        for v in p {
            assert!(v.length() < 1.03, "{:?}", v);
        }
    }
}
