//! Rust port of ln/tree.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! The bounding volume hierarchy of the scene and of each mesh: a k-d tree
//! that splits at the median of the box edges. The Go nodes hold the shapes.
//! The Rust nodes hold the index of each shape, and `intersect` takes a
//! closure that casts the ray at one index. So one tree type serves the
//! scene (boxed shapes) and the mesh (triangles).

use crate::bbox::BBox;
use crate::hit::{Hit, NO_HIT};
use crate::ray::Ray;
use crate::util::{median, Axis};
use crate::vector::gmin;

pub struct Tree {
    pub bbox: BBox,
    pub root: Node,
}

pub struct Node {
    pub axis: Axis,
    pub point: f64,
    /// The shape indices. Only a leaf keeps them (ln sets them to nil
    /// after a split).
    pub shapes: Vec<usize>,
    pub left: Option<Box<Node>>,
    pub right: Option<Box<Node>>,
}

impl Tree {
    /// `boxes[i]` is the bounding box of shape `i`.
    pub fn new(boxes: &[BBox]) -> Tree {
        let bbox = if boxes.is_empty() {
            BBox::default()
        } else {
            let mut b = boxes[0];
            for x in boxes {
                b = b.extend(*x);
            }
            b
        };
        let mut node = Node::new((0..boxes.len()).collect());
        node.split(boxes, 0);
        Tree { bbox, root: node }
    }

    pub fn intersect<F: Fn(usize, &Ray) -> Hit>(&self, r: &Ray, f: &F) -> Hit {
        let (tmin, tmax) = self.bbox.intersect(r);
        if tmax < tmin || tmax <= 0.0 {
            return NO_HIT;
        }
        self.root.intersect(r, tmin, tmax, f)
    }
}

impl Node {
    pub fn new(shapes: Vec<usize>) -> Node {
        Node { axis: Axis::None, point: 0.0, shapes, left: None, right: None }
    }

    pub fn intersect<F: Fn(usize, &Ray) -> Hit>(&self, r: &Ray, tmin: f64, tmax: f64, f: &F) -> Hit {
        let (tsplit, left_first) = match self.axis {
            Axis::None => return self.intersect_shapes(r, f),
            Axis::X => (
                (self.point - r.origin.x) / r.direction.x,
                (r.origin.x < self.point) || (r.origin.x == self.point && r.direction.x <= 0.0),
            ),
            Axis::Y => (
                (self.point - r.origin.y) / r.direction.y,
                (r.origin.y < self.point) || (r.origin.y == self.point && r.direction.y <= 0.0),
            ),
            Axis::Z => (
                (self.point - r.origin.z) / r.direction.z,
                (r.origin.z < self.point) || (r.origin.z == self.point && r.direction.z <= 0.0),
            ),
        };
        let (first, second) = if left_first {
            (self.left.as_ref().unwrap(), self.right.as_ref().unwrap())
        } else {
            (self.right.as_ref().unwrap(), self.left.as_ref().unwrap())
        };
        if tsplit > tmax || tsplit <= 0.0 {
            first.intersect(r, tmin, tmax, f)
        } else if tsplit < tmin {
            second.intersect(r, tmin, tmax, f)
        } else {
            let h1 = first.intersect(r, tmin, tsplit, f);
            if h1.t <= tsplit {
                return h1;
            }
            let h2 = second.intersect(r, tsplit, gmin(tmax, h1.t), f);
            if h1.t <= h2.t {
                h1
            } else {
                h2
            }
        }
    }

    pub fn intersect_shapes<F: Fn(usize, &Ray) -> Hit>(&self, r: &Ray, f: &F) -> Hit {
        let mut hit = NO_HIT;
        for &i in &self.shapes {
            let h = f(i, r);
            if h.t < hit.t {
                hit = h;
            }
        }
        hit
    }

    pub fn partition_score(&self, boxes: &[BBox], axis: Axis, point: f64) -> usize {
        let (mut left, mut right) = (0, 0);
        for &i in &self.shapes {
            let (l, r) = boxes[i].partition(axis, point);
            if l {
                left += 1;
            }
            if r {
                right += 1;
            }
        }
        if left >= right {
            left
        } else {
            right
        }
    }

    pub fn partition(&self, boxes: &[BBox], size: usize, axis: Axis, point: f64) -> (Vec<usize>, Vec<usize>) {
        let mut left = Vec::with_capacity(size);
        let mut right = Vec::with_capacity(size);
        for &i in &self.shapes {
            let (l, r) = boxes[i].partition(axis, point);
            if l {
                left.push(i);
            }
            if r {
                right.push(i);
            }
        }
        (left, right)
    }

    pub fn split(&mut self, boxes: &[BBox], depth: usize) {
        if self.shapes.len() < 8 {
            return;
        }
        let n = self.shapes.len();
        let mut xs = Vec::with_capacity(n * 2);
        let mut ys = Vec::with_capacity(n * 2);
        let mut zs = Vec::with_capacity(n * 2);
        for &i in &self.shapes {
            let b = boxes[i];
            xs.push(b.min.x);
            xs.push(b.max.x);
            ys.push(b.min.y);
            ys.push(b.max.y);
            zs.push(b.min.z);
            zs.push(b.max.z);
        }
        let cmp = |a: &f64, b: &f64| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal);
        xs.sort_by(cmp);
        ys.sort_by(cmp);
        zs.sort_by(cmp);
        let (mx, my, mz) = (median(&xs), median(&ys), median(&zs));
        let mut best = (n as f64 * 0.85) as usize;
        let mut best_axis = Axis::None;
        let mut best_point = 0.0;
        let sx = self.partition_score(boxes, Axis::X, mx);
        if sx < best {
            best = sx;
            best_axis = Axis::X;
            best_point = mx;
        }
        let sy = self.partition_score(boxes, Axis::Y, my);
        if sy < best {
            best = sy;
            best_axis = Axis::Y;
            best_point = my;
        }
        let sz = self.partition_score(boxes, Axis::Z, mz);
        if sz < best {
            best = sz;
            best_axis = Axis::Z;
            best_point = mz;
        }
        if best_axis == Axis::None {
            return;
        }
        let (l, r) = self.partition(boxes, best, best_axis, best_point);
        self.axis = best_axis;
        self.point = best_point;
        let mut left = Node::new(l);
        let mut right = Node::new(r);
        left.split(boxes, depth + 1);
        right.split(boxes, depth + 1);
        self.left = Some(Box::new(left));
        self.right = Some(Box::new(right));
        self.shapes = Vec::new(); // only needed at leaf nodes
    }
}
