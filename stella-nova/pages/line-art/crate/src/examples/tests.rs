//! Tests of the example builders (`cargo test --release`).

use super::*;
use crate::sphere::lat_lng_to_xyz;

#[test]
fn earth_eye_is_the_ln_value() {
    let e = lat_lng_to_xyz(35.7806, -78.6389, 1.0).normalize().mul_scalar(2.46);
    assert!(e.distance(earth::EYE) < 1e-8, "{:?}", e);
}

/// Every example builds with its defaults and renders inside the image.
#[test]
fn every_example_renders() {
    for ex in all() {
        let p = Params::defaults(ex.params);
        let c = ex.camera_with(&p);
        let mut built = (ex.build)(&p, &c);
        let step = if ex.step > 0.0 { ex.step * 4.0 } else { 0.0 };
        let paths = built.scene.render(c.eye, c.center, c.up, 400.0, 300.0, c.fovy, c.near, c.far, step);
        let n = paths.len() + built.overlay.len();
        assert!(n > 0, "{} drew nothing", ex.key);
        for q in paths.iter().flatten() {
            assert!(q.x >= -1e-6 && q.x <= 400.0 + 1e-6 && q.y >= -1e-6 && q.y <= 300.0 + 1e-6, "{} point {:?}", ex.key, q);
        }
        assert!(!code_extract(ex.code).is_empty(), "{} has no code extract", ex.key);
        eprintln!("{:<12} shapes {:>6} paths {:>7} overlay {:>5} rays {:>9}", ex.key, built.scene.shapes.len(), paths.len(), built.overlay.len(), built.scene.rays.get());
    }
}

