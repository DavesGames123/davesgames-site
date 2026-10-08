//! Native unit tests of the port (`cargo test --release`). The expected
//! values come from the ln algorithms (no Go program was run): edge counts
//! of a cube from a known camera, the sphere ray test, CSG boundaries,
//! path simplify and chop, the tree against brute force, and the loaders.

use crate::bbox::BBox;
use crate::csg::{new_difference, new_union};
use crate::cube::new_cube;
use crate::matrix::{identity, look_at, rotate};
use crate::mesh::Mesh;
use crate::obj::load_obj;
use crate::path::{PathExt, PathsExt};
use crate::ray::Ray;
use crate::rng::Rng;
use crate::scene::Scene;
use crate::shape::Shape;
use crate::sphere::{lat_lng_to_xyz, new_sphere};
use crate::stl::{load_binary_stl, save_binary_stl};
use crate::tree::Tree;
use crate::vector::{v3, Vector};

const SUZANNE_OBJ: &str = include_str!("data/suzanne.obj");

fn close(a: f64, b: f64, eps: f64) -> bool {
    (a - b).abs() <= eps
}

/// example0: one cube from (4, 3, 2). Nine edges can show (six on the
/// outline, three at the near corner (1, 1, 1)); the three edges at the far
/// corner (-1, -1, -1) are hidden.
#[test]
fn cube_scene_edge_count_and_bounds() {
    let mut scene = Scene::new();
    scene.add(Box::new(new_cube(v3(-1.0, -1.0, -1.0), v3(1.0, 1.0, 1.0))));
    let (eye, center, up) = (v3(4.0, 3.0, 2.0), v3(0.0, 0.0, 0.0), v3(0.0, 0.0, 1.0));
    let paths = scene.render(eye, center, up, 1024.0, 1024.0, 50.0, 0.1, 10.0, 0.01);
    assert_eq!(paths.len(), 9, "visible edges");
    for p in &paths {
        assert_eq!(p.len(), 2, "a straight edge simplifies to two points");
    }
    let b = paths.bounding_box();
    assert!(b.min.x > 0.0 && b.min.y > 0.0 && b.max.x < 1024.0 && b.max.y < 1024.0, "{:?}", b);
    // The far corner projects inside the outline; no path may end there.
    let m = Scene::camera_matrix(eye, center, up, 1024.0, 1024.0, 50.0, 0.1, 10.0);
    let far = m.mul_position_w(v3(-1.0, -1.0, -1.0));
    let far = v3((far.x + 1.0) * 512.0, (far.y + 1.0) * 512.0, 0.0);
    for p in &paths {
        for q in p {
            assert!(q.distance(v3(far.x, far.y, q.z)) > 5.0, "a hidden corner shows: {:?}", q);
        }
    }
    // The output is in the image frame: the cube is near the middle.
    let c = b.center();
    assert!(close(c.x, 512.0, 80.0) && close(c.y, 512.0, 80.0), "{:?}", c);
}

#[test]
fn sphere_visibility() {
    let mut scene = Scene::new();
    scene.add(Box::new(new_sphere(v3(0.0, 0.0, 0.0), 1.0)));
    scene.compile();
    let eye = v3(0.0, 0.0, 5.0);
    assert!(scene.visible(eye, v3(0.0, 0.0, 1.0)), "the near pole shows");
    assert!(!scene.visible(eye, v3(0.0, 0.0, -1.0)), "the far pole is hidden");
    assert!(scene.visible(eye, lat_lng_to_xyz(30.0, 10.0, 1.0)), "the upper half shows");
    assert!(!scene.visible(eye, lat_lng_to_xyz(-30.0, 10.0, 1.0)), "the lower half is hidden");
    // The ray test skips hits closer than 1e-2 (the surface of the point).
    let h = new_sphere(v3(0.0, 0.0, 0.0), 1.0).intersect(&Ray::new(v3(0.0, 0.0, 5.0), v3(0.0, 0.0, -1.0)));
    assert!(close(h.t, 4.0, 1e-12));
}

#[test]
fn sphere_render_hides_far_rings() {
    let mut scene = Scene::new();
    scene.add(Box::new(new_sphere(v3(0.0, 0.0, 0.0), 1.0)));
    let eye = v3(0.0, -6.0, 0.0);
    let paths = scene.render(eye, v3(0.0, 0.0, 0.0), v3(0.0, 0.0, 1.0), 500.0, 500.0, 30.0, 0.1, 100.0, 0.01);
    assert!(!paths.is_empty());
    // Re-project: every kept point must be on the near half (y < 0.2).
    // The render keeps clip-space x, y; check by unprojecting the meridian
    // count instead: 37 meridians (0..=360 step 10) and 17 rings. Only the
    // near half of each ring shows, so the path count stays well under the
    // full count of 54 + their splits.
    let segs = paths.segment_count();
    let full = {
        let mut s = Scene::new();
        s.add(Box::new(new_sphere(v3(0.0, 0.0, 0.0), 1.0)));
        s.paths().segment_count()
    };
    assert!(segs < full * 3 / 5, "about half the texture must be hidden: {} of {}", segs, full);
    assert!(segs > full / 3, "the near half must show: {} of {}", segs, full);
}

/// CSG: a sphere minus the half space x > 0 (a big cube) is the left half.
#[test]
fn csg_difference_sphere_cube() {
    let shape = new_difference(vec![
        Box::new(new_sphere(v3(0.0, 0.0, 0.0), 1.0)),
        Box::new(new_cube(v3(0.0, -2.0, -2.0), v3(2.0, 2.0, 2.0))),
    ]);
    assert!(shape.contains(v3(-0.5, 0.0, 0.0), 0.0));
    assert!(!shape.contains(v3(0.5, 0.0, 0.0), 0.0));
    assert!(!shape.contains(v3(-1.5, 0.0, 0.0), 0.0));
    // From +x the ray meets the sphere at x = 1 (inside the cube, not on the
    // result), steps 0.01 past it and meets the cut face x = 0. ln returns
    // the distance from the retry origin (0.99), not from the eye (5).
    let h = shape.intersect(&Ray::new(v3(5.0, 0.0, 0.0), v3(-1.0, 0.0, 0.0)));
    assert!(h.ok());
    assert!(close(h.t, 0.99, 1e-9), "t = {}", h.t);
    // From -x the first hit is on the result: the sphere at x = -1.
    let h = shape.intersect(&Ray::new(v3(-5.0, 0.0, 0.0), v3(1.0, 0.0, 0.0)));
    assert!(close(h.t, 4.0, 1e-9));
    // The paths are cut to the result: every point has x <= 0 (+ tolerance)
    // and lies on the sphere or on the cut face.
    let paths = shape.paths();
    assert!(!paths.is_empty());
    for p in &paths {
        for v in p {
            assert!(v.x <= 1e-3 + 1e-9, "a point outside the result: {:?}", v);
            let on_sphere = close(v.length(), 1.0, 2e-3);
            let on_face = close(v.x, 0.0, 2e-3);
            assert!(on_sphere || on_face, "{:?}", v);
        }
    }
}

#[test]
fn csg_union_keeps_only_the_outer_surface() {
    let u = new_union(vec![
        Box::new(new_sphere(v3(-0.5, 0.0, 0.0), 1.0)),
        Box::new(new_sphere(v3(0.5, 0.0, 0.0), 1.0)),
    ]);
    for p in u.paths() {
        for v in p {
            let da = v.sub(v3(-0.5, 0.0, 0.0)).length();
            let db = v.sub(v3(0.5, 0.0, 0.0)).length();
            assert!(da >= 1.0 - 2e-3 && db >= 1.0 - 2e-3, "a point inside the union: {:?}", v);
        }
    }
    let h = u.intersect(&Ray::new(v3(5.0, 0.0, 0.0), v3(-1.0, 0.0, 0.0)));
    assert!(close(h.t, 3.5, 1e-9));
}

#[test]
fn path_simplify_and_chop() {
    let line: Vec<Vector> = (0..=10).map(|i| v3(i as f64, 0.0, 0.0)).collect();
    assert_eq!(line.simplify(1e-6), vec![v3(0.0, 0.0, 0.0), v3(10.0, 0.0, 0.0)]);
    let zig = vec![v3(0.0, 0.0, 0.0), v3(1.0, 1.0, 0.0), v3(2.0, 0.0, 0.0), v3(3.0, 0.0, 0.0), v3(4.0, 0.0, 0.0)];
    assert_eq!(zig.simplify(1e-6), vec![v3(0.0, 0.0, 0.0), v3(1.0, 1.0, 0.0), v3(2.0, 0.0, 0.0), v3(4.0, 0.0, 0.0)]);
    assert_eq!(zig.simplify(2.0).len(), 2);
    let seg = vec![v3(0.0, 0.0, 0.0), v3(1.0, 0.0, 0.0)];
    let c = seg.chop(0.1);
    assert!(c.len() == 11 || c.len() == 12, "len {}", c.len()); // float steps
    assert_eq!(c[0], v3(0.0, 0.0, 0.0));
    assert_eq!(*c.last().unwrap(), v3(1.0, 0.0, 0.0));
    for w in c.windows(2) {
        assert!(w[0].distance(w[1]) <= 0.1 + 1e-12);
    }
    assert!(vec![v3(1.0, 1.0, 1.0)].chop(0.1).is_empty(), "ln: a one-point path chops to nothing");
}

#[test]
fn svg_matches_ln_format() {
    let p = vec![vec![v3(1.0, 2.0, 0.0), v3(3.5, 4.25, 0.0)]];
    let s = p.to_svg(10.0, 20.0);
    assert!(s.starts_with("<svg width=\"10.000000\" height=\"20.000000\" version=\"1.1\""));
    assert!(s.contains("<g transform=\"translate(0,20.000000) scale(1,-1)\">"));
    assert!(s.contains("<polyline stroke=\"black\" fill=\"none\" points=\"1.000000,2.000000 3.500000,4.250000\" />"));
    assert!(s.ends_with("</g></svg>"));
}

#[test]
fn matrix_inverse_and_look_at() {
    let m = rotate(v3(1.0, 2.0, 3.0), 0.7).translate(v3(1.0, -2.0, 0.5)).scale(v3(2.0, 3.0, 4.0));
    let i = m.mul(&m.inverse());
    for k in 0..16 {
        assert!(close(i.m[k], identity().m[k], 1e-12));
    }
    let eye = v3(4.0, 3.0, 2.0);
    let v = look_at(eye, v3(0.0, 0.0, 0.0), v3(0.0, 0.0, 1.0));
    let e = v.mul_position(eye);
    assert!(e.length() < 1e-12, "the eye goes to the origin");
    let c = v.mul_position(v3(0.0, 0.0, 0.0));
    assert!(close(c.x, 0.0, 1e-12) && close(c.y, 0.0, 1e-12) && c.z < 0.0, "the center is on -z");
}

#[test]
fn tree_matches_brute_force() {
    let mut rng = Rng::new(5);
    let spheres: Vec<_> = (0..300)
        .map(|_| new_sphere(v3(rng.float64() * 20.0 - 10.0, rng.float64() * 20.0 - 10.0, rng.float64() * 20.0 - 10.0), 0.2 + rng.float64()))
        .collect();
    let boxes: Vec<BBox> = spheres.iter().map(|s| s.bounding_box()).collect();
    let tree = Tree::new(&boxes);
    for _ in 0..2000 {
        let o = v3(rng.float64() * 30.0 - 15.0, rng.float64() * 30.0 - 15.0, rng.float64() * 30.0 - 15.0);
        let d = crate::vector::random_unit_vector(&mut rng);
        let r = Ray::new(o, d);
        let a = tree.intersect(&r, &|i, r| spheres[i].intersect(r));
        let b = spheres.iter().map(|s| s.intersect(&r).t).fold(crate::util::INF, f64::min);
        assert!(close(a.t, b, 1e-9), "tree {} brute {}", a.t, b);
    }
}

#[test]
fn obj_and_stl_loaders() {
    let mesh = load_obj(SUZANNE_OBJ).unwrap();
    // 500 faces: quads give two triangles, triangles one.
    let quads = SUZANNE_OBJ.lines().filter(|l| l.starts_with("f ") && l.split_whitespace().count() == 5).count();
    let tris = SUZANNE_OBJ.lines().filter(|l| l.starts_with("f ") && l.split_whitespace().count() == 4).count();
    assert_eq!(quads + tris, 500);
    assert_eq!(mesh.triangles.len(), quads * 2 + tris);
    let bytes = save_binary_stl(&mesh);
    assert_eq!(bytes.len(), 84 + 50 * mesh.triangles.len());
    let back = load_binary_stl(&bytes).unwrap();
    assert_eq!(back.triangles.len(), mesh.triangles.len());
    assert!(back.triangles[7].v2.distance(mesh.triangles[7].v2) < 1e-5);
    let ascii = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
    assert_eq!(crate::stl::load_stl(ascii).unwrap().triangles.len(), 1);
}

#[test]
fn mesh_fit_and_voxelize() {
    let mut mesh: Mesh = load_obj(SUZANNE_OBJ).unwrap();
    mesh.unit_cube();
    let b = mesh.bounding_box();
    assert!(close(b.center().x, 0.0, 1e-9) && close(b.center().y, 0.0, 1e-9) && close(b.center().z, 0.0, 1e-9));
    assert!(close(b.size().x.max(b.size().y).max(b.size().z), 1.0, 1e-9));
    let a = mesh.voxelize(1.0 / 16.0);
    let c = mesh.voxelize(1.0 / 16.0);
    assert!(a.len() > 100);
    assert_eq!(a.len(), c.len());
    assert_eq!(a[10].min, c[10].min, "voxel order repeats");
}

/// The streamed render (paths in slices) gives the same paths as one call.
#[test]
fn streamed_render_equals_batch() {
    let build = || {
        let mut rng = Rng::new(3);
        let mut s = Scene::new();
        for x in -2..=2 {
            for y in -2..=2 {
                let v = v3(x as f64, y as f64, rng.float64());
                s.add(Box::new(new_cube(v.sub_scalar(0.5), v.add_scalar(0.5))));
            }
        }
        s.add(Box::new(new_sphere(v3(0.0, 0.0, 2.0), 0.8)));
        s
    };
    let (eye, center, up) = (v3(6.0, 5.0, 3.0), v3(0.0, 0.0, 0.0), v3(0.0, 0.0, 1.0));
    let batch = build().render(eye, center, up, 800.0, 500.0, 30.0, 0.1, 100.0, 0.01);
    let mut b = build();
    b.compile();
    let m = Scene::camera_matrix(eye, center, up, 800.0, 500.0, 30.0, 0.1, 100.0);
    let mut streamed = Vec::new();
    for s in &b.shapes {
        for p in s.paths() {
            streamed.extend(b.render_paths(&[p], &m, eye, 800.0, 500.0, 0.01));
        }
    }
    assert_eq!(batch, streamed);
}

/// Not in ln: render_paths_depth gives the same paths as render_paths, one
/// depth per path, and the depth grows with the distance from the eye.
#[test]
fn depth_render_matches_paths_and_orders_by_distance() {
    let mut s = Scene::new();
    s.add(Box::new(new_cube(v3(-0.5, -0.5, -0.5), v3(0.5, 0.5, 0.5))));
    s.add(Box::new(new_cube(v3(-0.5, 5.5, -0.5), v3(0.5, 6.5, 0.5))));
    s.compile();
    let (eye, center, up) = (v3(0.0, -6.0, 0.5), v3(0.0, 0.0, 0.0), v3(0.0, 0.0, 1.0));
    let m = Scene::camera_matrix(eye, center, up, 800.0, 500.0, 40.0, 0.1, 100.0);
    let fwd = center.sub(eye).normalize();
    let mut plain = Vec::new();
    let mut with = Vec::new();
    let mut near = Vec::new();
    let mut far = Vec::new();
    for (i, sh) in s.shapes.iter().enumerate() {
        for p in sh.paths() {
            plain.extend(s.render_paths(&[p.clone()], &m, eye, 800.0, 500.0, 0.01));
            let (q, d) = s.render_paths_depth(&[p], &m, eye, fwd, 800.0, 500.0, 0.01);
            assert_eq!(q.len(), d.len());
            if i == 0 { near.extend(d.iter().copied()); } else { far.extend(d.iter().copied()); }
            with.extend(q);
        }
    }
    assert_eq!(plain, with);
    assert!(!near.is_empty() && !far.is_empty());
    let near_max = near.iter().cloned().fold(f64::MIN, f64::max);
    let far_min = far.iter().cloned().fold(f64::MAX, f64::min);
    assert!(near_max < far_min, "near {} far {}", near_max, far_min);
}
