//! Rust port of ln/obj.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! Read a Wavefront OBJ text: `v` lines and `f` lines. A face with more
//! than three corners becomes a fan of triangles. Negative indices count
//! from the end, as in ln. The Go code reads a file; the port reads a
//! string (the web build has no file system).

use crate::mesh::{new_mesh, Mesh};
use crate::triangle::new_triangle;
use crate::util::parse_floats;
use crate::vector::{v3, Vector};

fn parse_index(value: &str, length: usize) -> usize {
    let n: i64 = value.parse().unwrap_or(0);
    let n = if n < 0 { n + length as i64 } else { n };
    n.max(0) as usize
}

pub fn load_obj(text: &str) -> Result<Mesh, String> {
    let mut vs: Vec<Vector> = vec![Vector::default()]; // 1-based indexing
    let mut triangles = Vec::new();
    for (ln, line) in text.lines().enumerate() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.is_empty() {
            continue;
        }
        let args = &fields[1..];
        match fields[0] {
            "v" => {
                let f = parse_floats(args);
                if f.len() < 3 {
                    return Err(format!("obj line {}: a vertex needs 3 numbers", ln + 1));
                }
                vs.push(v3(f[0], f[1], f[2]));
            }
            "f" => {
                let mut fvs = Vec::with_capacity(args.len());
                for arg in args {
                    let first = arg.split('/').next().unwrap_or("");
                    let i = parse_index(first, vs.len());
                    if i >= vs.len() {
                        return Err(format!("obj line {}: vertex index {} is out of range", ln + 1, first));
                    }
                    fvs.push(i);
                }
                for i in 1..fvs.len().saturating_sub(1) {
                    triangles.push(new_triangle(vs[fvs[0]], vs[fvs[i]], vs[fvs[i + 1]]));
                }
            }
            _ => {}
        }
    }
    Ok(new_mesh(triangles))
}
