//! Rust port of ln/scene.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! A scene is a list of shapes and a tree over their boxes. The render:
//!   1. compile each shape and build the tree,
//!   2. collect the paths of each shape (3D polylines),
//!   3. chop each path into steps of `step` world units,
//!   4. filter each point with ClipFilter: a ray from the point to the eye
//!      must reach the eye before it hits a shape, and the projected point
//!      must be in the clip box,
//!   5. simplify each visible run (threshold 1e-6 in clip space),
//!   6. scale clip space to the image, `width` x `height`, y up.
//! Each step works on one path at a time. So `render_paths` can do the
//! work in slices (one shape, or some paths of one shape) and give the
//! same paths in the same order as one `render`. The web worker uses that
//! to stream the paths while the render runs. Not in ln:
//! `render_paths_depth` also gives the camera depth of each path.

use crate::bbox::BBox;
use crate::filter::{ClipFilter, Filter};
use crate::hit::Hit;
use crate::matrix::{look_at, translate, Matrix};
use crate::path::{Path, PathExt, Paths};
use crate::ray::Ray;
use crate::shape::Shape;
use crate::tree::Tree;
use crate::vector::{v3, Vector};
use std::cell::Cell;

#[derive(Default)]
pub struct Scene {
    pub shapes: Vec<Box<dyn Shape>>,
    pub tree: Option<Tree>,
    /// The number of visibility rays cast (for the stats line; not in ln).
    pub rays: Cell<u64>,
    /// Not in ln: when true, `visible` says yes to every point, so the
    /// render keeps hidden lines (a wireframe; the page "blueprint" shot).
    pub show_hidden: Cell<bool>,
}

impl Scene {
    pub fn new() -> Scene {
        Scene::default()
    }

    pub fn compile(&mut self) {
        for s in self.shapes.iter_mut() {
            s.compile();
        }
        if self.tree.is_none() {
            let boxes: Vec<BBox> = self.shapes.iter().map(|s| s.bounding_box()).collect();
            self.tree = Some(Tree::new(&boxes));
        }
    }

    pub fn add(&mut self, shape: Box<dyn Shape>) {
        self.shapes.push(shape);
        self.tree = None;
    }

    pub fn intersect(&self, r: &Ray) -> Hit {
        let shapes = &self.shapes;
        self.tree.as_ref().expect("scene not compiled").intersect(r, &|i, r| shapes[i].intersect(r))
    }

    /// Can the eye see `point`? The ray starts at the point and goes to the
    /// eye. Each shape skips hits closer than its own small offset, so the
    /// surface that holds the point does not hide it.
    pub fn visible(&self, eye: Vector, point: Vector) -> bool {
        if self.show_hidden.get() {
            return true;
        }
        self.rays.set(self.rays.get() + 1);
        let v = eye.sub(point);
        let r = Ray::new(point, v.normalize());
        let hit = self.intersect(&r);
        hit.t >= v.length()
    }

    pub fn paths(&self) -> Paths {
        let mut result = Vec::new();
        for s in &self.shapes {
            result.extend(s.paths());
        }
        result
    }

    /// The camera matrix of `render`: look_at, then perspective.
    pub fn camera_matrix(eye: Vector, center: Vector, up: Vector, width: f64, height: f64, fovy: f64, near: f64, far: f64) -> Matrix {
        let aspect = width / height;
        look_at(eye, center, up).perspective(fovy, aspect, near, far)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn render(&mut self, eye: Vector, center: Vector, up: Vector, width: f64, height: f64, fovy: f64, near: f64, far: f64, step: f64) -> Paths {
        let matrix = Scene::camera_matrix(eye, center, up, width, height, fovy, near, far);
        self.render_with_matrix(&matrix, eye, width, height, step)
    }

    pub fn render_with_matrix(&mut self, matrix: &Matrix, eye: Vector, width: f64, height: f64, step: f64) -> Paths {
        self.compile();
        let paths = self.paths();
        self.render_paths(&paths, matrix, eye, width, height, step)
    }

    /// Steps 3 to 6 of the render for some paths of a compiled scene.
    pub fn render_paths(&self, paths: &[Path], matrix: &Matrix, eye: Vector, width: f64, height: f64, step: f64) -> Paths {
        self.render_paths_depth(paths, matrix, eye, v3(0.0, 0.0, 0.0), width, height, step).0
    }

    /// Not in ln: `render_paths` that also gives the depth of each output
    /// path. The depth is the mean of (point - eye) . forward over the kept
    /// 3D points of the path (`forward` is the unit view direction). The
    /// split into runs is the same as `PathExt::filter`, so the paths are
    /// the same as `render_paths` gives. The web page draws the paths in
    /// order of this depth, near paths first.
    #[allow(clippy::too_many_arguments)]
    pub fn render_paths_depth(&self, paths: &[Path], matrix: &Matrix, eye: Vector, forward: Vector, width: f64, height: f64, step: f64) -> (Paths, Vec<f64>) {
        let screen = screen_matrix(width, height);
        let filter = ClipFilter { matrix: *matrix, eye, scene: self };
        let mut out = Vec::new();
        let mut depths = Vec::new();
        // One finished run: keep it when it has two or more points.
        let emit = |run: &mut Path, sum: f64, count: usize, out: &mut Paths, depths: &mut Vec<f64>| {
            if run.len() > 1 {
                let q = std::mem::take(run);
                let q = if step > 0.0 { q.simplify(1e-6) } else { q };
                out.push(q.transform(&screen));
                depths.push(sum / count.max(1) as f64);
            }
            run.clear();
        };
        for p in paths {
            let chopped;
            let src: &[Vector] = if step > 0.0 {
                chopped = p.chop(step);
                &chopped
            } else {
                p
            };
            let mut run: Path = Vec::new();
            let (mut sum, mut count) = (0.0, 0usize);
            for &v in src {
                let (w, ok) = filter.filter(v);
                if ok {
                    run.push(w);
                    sum += v.sub(eye).dot(forward);
                    count += 1;
                } else {
                    emit(&mut run, sum, count, &mut out, &mut depths);
                    sum = 0.0;
                    count = 0;
                }
            }
            emit(&mut run, sum, count, &mut out, &mut depths);
        }
        (out, depths)
    }
}

/// Clip space (-1..1) to the image (0..width, 0..height).
pub fn screen_matrix(width: f64, height: f64) -> Matrix {
    translate(v3(1.0, 1.0, 0.0)).scale(v3(width / 2.0, height / 2.0, 0.0))
}
