//! Rust port of ln/mesh.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! A triangle mesh with its own tree. The ln texture is every triangle
//! edge. `MeshEdges::Sharp` is not in ln: it keeps the edges where the two
//! faces meet at more than an angle, plus the open edges, so the
//! diagonals of flat quads go away.
//! Voxelize cuts the mesh with planes at each z step and puts a cube at
//! each cut point (snapped to the grid). Go collects the cubes in a map,
//! so their order is random; the port sorts them, so a render repeats.

use crate::bbox::{box_for_triangles, BBox};
use crate::cube::{new_cube, Cube};
use crate::hit::{Hit, NO_HIT};
use crate::matrix::{identity, translate, Matrix};
use crate::path::Paths;
use crate::plane::Plane;
use crate::ray::Ray;
use crate::shape::Shape;
use crate::tree::Tree;
use crate::triangle::Triangle;
use crate::vector::{v3, Vector};
use std::collections::{BTreeSet, HashMap};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MeshEdges {
    /// ln: the three edges of each triangle.
    All,
    /// Not in ln: edges with a dihedral angle above this many degrees.
    Sharp(f64),
}

pub struct Mesh {
    pub bbox: BBox,
    pub triangles: Vec<Triangle>,
    pub tree: Option<Tree>,
    pub edges: MeshEdges,
}

pub fn new_mesh(triangles: Vec<Triangle>) -> Mesh {
    let bbox = box_for_triangles(&triangles);
    Mesh { bbox, triangles, tree: None, edges: MeshEdges::All }
}

impl Mesh {
    pub fn update_bounding_box(&mut self) {
        self.bbox = box_for_triangles(&self.triangles);
    }

    /// Fit the mesh in the unit cube and center it at the origin.
    pub fn unit_cube(&mut self) {
        self.fit_inside(BBox::new(Vector::default(), v3(1.0, 1.0, 1.0)), Vector::default());
        self.move_to(Vector::default(), v3(0.5, 0.5, 0.5));
    }

    pub fn move_to(&mut self, position: Vector, anchor: Vector) {
        let matrix = translate(position.sub(self.bbox.anchor(anchor)));
        self.transform(&matrix);
    }

    pub fn fit_inside(&mut self, b: BBox, anchor: Vector) {
        let scale = b.size().div(self.bbox.size()).min_component();
        let extra = b.size().sub(self.bbox.size().mul_scalar(scale));
        let mut matrix = identity();
        matrix = matrix.translate(self.bbox.min.mul_scalar(-1.0));
        matrix = matrix.scale(v3(scale, scale, scale));
        matrix = matrix.translate(b.min.add(extra.mul(anchor)));
        self.transform(&matrix);
    }

    pub fn transform(&mut self, matrix: &Matrix) {
        for t in self.triangles.iter_mut() {
            t.v1 = matrix.mul_position(t.v1);
            t.v2 = matrix.mul_position(t.v2);
            t.v3 = matrix.mul_position(t.v3);
            t.update_bounding_box();
        }
        self.update_bounding_box();
        self.tree = None; // dirty
    }

    pub fn voxelize(&self, size: f64) -> Vec<Cube> {
        let z1 = self.bbox.min.z;
        let z2 = self.bbox.max.z;
        let mut set: BTreeSet<(i64, i64, i64)> = BTreeSet::new();
        let mut z = z1;
        while z <= z2 {
            let plane = Plane::new(v3(0.0, 0.0, z), v3(0.0, 0.0, 1.0));
            for path in plane.intersect_mesh(self) {
                for v in path {
                    let x = (v.x / size + 0.5).floor() as i64;
                    let y = (v.y / size + 0.5).floor() as i64;
                    let z = (v.z / size + 0.5).floor() as i64;
                    set.insert((x, y, z));
                }
            }
            z += size;
        }
        set.into_iter()
            .map(|(x, y, z)| {
                let v = v3(x as f64 * size, y as f64 * size, z as f64 * size);
                new_cube(v.sub_scalar(size / 2.0), v.add_scalar(size / 2.0))
            })
            .collect()
    }

    /// Not in ln: like `voxelize`, but each cut segment marks every cell it
    /// crosses (samples at half a cell), not only its two end points. A
    /// mesh with large triangles then gives a closed shell of cubes.
    pub fn voxelize_shell(&self, size: f64) -> Vec<Cube> {
        let mut set: BTreeSet<(i64, i64, i64)> = BTreeSet::new();
        let cell = |v: Vector| ((v.x / size + 0.5).floor() as i64, (v.y / size + 0.5).floor() as i64, (v.z / size + 0.5).floor() as i64);
        let mut z = self.bbox.min.z;
        while z <= self.bbox.max.z {
            let plane = Plane::new(v3(0.0, 0.0, z), v3(0.0, 0.0, 1.0));
            for path in plane.intersect_mesh(self) {
                let (a, b) = (path[0], path[1]);
                let n = (a.distance(b) / (size * 0.5)).ceil().max(1.0) as usize;
                for i in 0..=n {
                    set.insert(cell(a.add(b.sub(a).mul_scalar(i as f64 / n as f64))));
                }
            }
            z += size;
        }
        set.into_iter()
            .map(|(x, y, z)| {
                let v = v3(x as f64 * size, y as f64 * size, z as f64 * size);
                new_cube(v.sub_scalar(size / 2.0), v.add_scalar(size / 2.0))
            })
            .collect()
    }

    /// Not in ln: the edges with a fold above `degrees`, and the open edges.
    pub fn sharp_edges(&self, degrees: f64) -> Paths {
        let key = |v: Vector| ((v.x * 1e5).round() as i64, (v.y * 1e5).round() as i64, (v.z * 1e5).round() as i64);
        type K = (i64, i64, i64);
        let mut edges: HashMap<(K, K), (Vector, Vector, Vec<Vector>)> = HashMap::new();
        let mut order: Vec<(K, K)> = Vec::new();
        for t in &self.triangles {
            let n = t.normal();
            for (a, b) in [(t.v1, t.v2), (t.v2, t.v3), (t.v3, t.v1)] {
                let (ka, kb) = (key(a), key(b));
                let k = if ka <= kb { (ka, kb) } else { (kb, ka) };
                let e = edges.entry(k).or_insert_with(|| {
                    order.push(k);
                    (a, b, Vec::new())
                });
                e.2.push(n);
            }
        }
        let cos = degrees.to_radians().cos();
        let mut out = Vec::new();
        for k in order {
            let (a, b, ns) = &edges[&k];
            let keep = ns.len() != 2 || ns[0].dot(ns[1]) < cos;
            if keep {
                out.push(vec![*a, *b]);
            }
        }
        out
    }
}

impl Shape for Mesh {
    fn compile(&mut self) {
        if self.tree.is_none() {
            let boxes: Vec<BBox> = self.triangles.iter().map(|t| t.bbox).collect();
            self.tree = Some(Tree::new(&boxes));
        }
    }
    fn bounding_box(&self) -> BBox {
        self.bbox
    }
    fn contains(&self, _v: Vector, _f: f64) -> bool {
        false
    }
    fn intersect(&self, r: &Ray) -> Hit {
        match &self.tree {
            Some(tree) => {
                let tris = &self.triangles;
                tree.intersect(r, &|i, r| tris[i].intersect_triangle(r))
            }
            None => NO_HIT,
        }
    }
    fn paths(&self) -> Paths {
        match self.edges {
            MeshEdges::All => {
                let mut result = Vec::with_capacity(self.triangles.len() * 3);
                for t in &self.triangles {
                    result.extend(t.paths());
                }
                result
            }
            MeshEdges::Sharp(deg) => self.sharp_edges(deg),
        }
    }
}
