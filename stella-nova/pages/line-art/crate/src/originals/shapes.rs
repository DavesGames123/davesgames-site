//! Not in ln. Two solids for the original scenes:
//!   Implicit  a solid { f(p) < 0 } inside a box, found by ray marching
//!             (the way ln Function marches a height field). Its texture
//!             is the level set f = 0 cut by planes (marching squares).
//!   Carve     one base solid minus many cut solids, a k-d tree over the
//!             cuts. ln csg.go nests one BooleanShape per cut; a deep
//!             chain repeats each test per level, so the Menger sponge
//!             and the city use this flat form. The retry steps 0.01 past
//!             a hit that is not on the boundary, as in ln, but it adds
//!             the steps to the distance (ln returns the last leg only).

use crate::bbox::BBox;
use crate::filter::Filter;
use crate::hit::{Hit, NO_HIT};
use crate::path::{Paths, PathsExt};
use crate::ray::Ray;
use crate::shape::Shape;
use crate::tree::Tree;
use crate::vector::{v3, Vector};

pub struct Implicit {
    pub f: Box<dyn Fn(Vector) -> f64>,
    pub bbox: BBox,
    /// The march step, world units.
    pub step: f64,
    pub paths: Paths,
}

impl Shape for Implicit {
    fn bounding_box(&self) -> BBox {
        self.bbox
    }
    fn contains(&self, v: Vector, _f: f64) -> bool {
        self.bbox.contains(v) && (self.f)(v) < 0.0
    }
    fn intersect(&self, r: &Ray) -> Hit {
        let (t0, t1) = self.bbox.intersect(r);
        if t1 < t0 || t1 <= 0.0 {
            return NO_HIT;
        }
        let (mut t, sign) = if t0 > self.step { (t0 + 1e-9, false) } else { (self.step, self.contains(r.position(self.step), 0.0)) };
        while t <= t1 {
            if self.contains(r.position(t), 0.0) != sign {
                return Hit::new(t);
            }
            t += self.step;
        }
        NO_HIT
    }
    fn paths(&self) -> Paths {
        self.paths.clone()
    }
}

/// Level-set lines of an implicit solid: slices on `n` planes normal to
/// z (and x, y when `axes` is 3), plus the six faces of the box.
pub fn implicit_paths(f: &dyn Fn(Vector) -> f64, b: BBox, n: usize, axes: usize, res: f64) -> Paths {
    use super::geom::contours;
    let mut out = Vec::new();
    let s = b.size();
    let cells = |len: f64| ((len / res).ceil() as usize).max(4);
    let inside = 1e-4;
    for k in 0..=n {
        let p = k as f64 / n as f64;
        let z = b.min.z + inside + (s.z - 2.0 * inside) * p;
        out.extend(contours(&|x, y| f(v3(x, y, z)), b.min.x, b.max.x, b.min.y, b.max.y, cells(s.x), cells(s.y), &|x, y| v3(x, y, z)));
        if axes == 3 {
            let x = b.min.x + inside + (s.x - 2.0 * inside) * p;
            out.extend(contours(&|y, z| f(v3(x, y, z)), b.min.y, b.max.y, b.min.z, b.max.z, cells(s.y), cells(s.z), &|y, z| v3(x, y, z)));
            let y = b.min.y + inside + (s.y - 2.0 * inside) * p;
            out.extend(contours(&|x, z| f(v3(x, y, z)), b.min.x, b.max.x, b.min.z, b.max.z, cells(s.x), cells(s.z), &|x, z| v3(x, y, z)));
        }
    }
    // The solid where it meets each box face: the curve f = 0 on the face.
    for (x, flip) in [(b.min.x, -1.0), (b.max.x, 1.0)] {
        let x = x - flip * inside;
        out.extend(contours(&|y, z| f(v3(x, y, z)), b.min.y, b.max.y, b.min.z, b.max.z, cells(s.y), cells(s.z), &|y, z| v3(x, y, z)));
    }
    for (y, flip) in [(b.min.y, -1.0), (b.max.y, 1.0)] {
        let y = y - flip * inside;
        out.extend(contours(&|x, z| f(v3(x, y, z)), b.min.x, b.max.x, b.min.z, b.max.z, cells(s.x), cells(s.z), &|x, z| v3(x, y, z)));
    }
    out
}

pub struct Carve {
    pub base: Box<dyn Shape>,
    pub cuts: Vec<Box<dyn Shape>>,
    tree: Option<Tree>,
    /// The lines to cut to the boundary: base texture and cut rings.
    pub lines: Paths,
}

pub fn new_carve(base: Box<dyn Shape>, cuts: Vec<Box<dyn Shape>>, lines: Paths) -> Carve {
    Carve { base, cuts, tree: None, lines }
}

const F: f64 = 1e-3;

impl Carve {
    fn cut_hit(&self, r: &Ray) -> Hit {
        match &self.tree {
            Some(t) => {
                let cuts = &self.cuts;
                t.intersect(r, &|i, r| cuts[i].intersect(r))
            }
            None => self.cuts.iter().map(|c| c.intersect(r)).fold(NO_HIT, |a, b| a.min(b)),
        }
    }
    fn cut_contains(&self, v: Vector, f: f64) -> bool {
        self.cuts.iter().any(|c| c.bounding_box().contains(v) && c.contains(v, f))
    }
}

impl Shape for Carve {
    fn compile(&mut self) {
        self.base.compile();
        for c in self.cuts.iter_mut() {
            c.compile();
        }
        if self.tree.is_none() && !self.cuts.is_empty() {
            let boxes: Vec<BBox> = self.cuts.iter().map(|c| c.bounding_box()).collect();
            self.tree = Some(Tree::new(&boxes));
        }
    }
    fn bounding_box(&self) -> BBox {
        self.base.bounding_box()
    }
    fn contains(&self, v: Vector, _f: f64) -> bool {
        self.base.contains(v, F) && !self.cut_contains(v, -F)
    }
    fn intersect(&self, r: &Ray) -> Hit {
        let mut ray = *r;
        let mut acc = 0.0;
        for _ in 0..400 {
            let h = self.base.intersect(&ray).min(self.cut_hit(&ray));
            if !h.ok() {
                return NO_HIT;
            }
            if self.contains(ray.position(h.t), 0.0) {
                return Hit::new(acc + h.t);
            }
            acc += h.t + 0.01;
            ray = Ray::new(ray.position(h.t + 0.01), ray.direction);
        }
        NO_HIT
    }
    fn paths(&self) -> Paths {
        self.lines.chop(0.01).filter(self)
    }
}

impl Filter for Carve {
    fn filter(&self, v: Vector) -> (Vector, bool) {
        (v, self.contains(v, 0.0))
    }
}
