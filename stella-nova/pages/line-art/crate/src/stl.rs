//! Rust port of ln/stl.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! Binary STL: an 80-byte header, a u32 count, then 50 bytes per triangle
//! (normal, three corners as f32 little endian, a u16 attribute).
//! ASCII STL: every `vertex x y z` line, three per triangle.
//! The Go code reads and writes files; the port reads and writes bytes.

use crate::mesh::{new_mesh, Mesh};
use crate::triangle::new_triangle;
use crate::util::parse_floats;
use crate::vector::{v3, Vector};

fn f32_at(b: &[u8], o: usize) -> f64 {
    f32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) as f64
}

pub fn load_binary_stl(bytes: &[u8]) -> Result<Mesh, String> {
    if bytes.len() < 84 {
        return Err("stl: the file is shorter than its header".into());
    }
    let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as usize;
    if bytes.len() < 84 + count * 50 {
        return Err(format!("stl: the header says {} triangles, the file is too short", count));
    }
    let mut triangles = Vec::with_capacity(count);
    for i in 0..count {
        let o = 84 + i * 50 + 12; // skip the normal
        let p = |k: usize| v3(f32_at(bytes, o + k * 12), f32_at(bytes, o + k * 12 + 4), f32_at(bytes, o + k * 12 + 8));
        triangles.push(new_triangle(p(0), p(1), p(2)));
    }
    Ok(new_mesh(triangles))
}

pub fn save_binary_stl(mesh: &Mesh) -> Vec<u8> {
    let mut out = vec![0u8; 80];
    out.extend_from_slice(&(mesh.triangles.len() as u32).to_le_bytes());
    for t in &mesh.triangles {
        out.extend_from_slice(&[0u8; 12]);
        for v in [t.v1, t.v2, t.v3] {
            out.extend_from_slice(&(v.x as f32).to_le_bytes());
            out.extend_from_slice(&(v.y as f32).to_le_bytes());
            out.extend_from_slice(&(v.z as f32).to_le_bytes());
        }
        out.extend_from_slice(&[0u8; 2]);
    }
    out
}

pub fn load_stl(text: &str) -> Result<Mesh, String> {
    let mut vertexes: Vec<Vector> = Vec::new();
    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() == 4 && fields[0] == "vertex" {
            let f = parse_floats(&fields[1..]);
            vertexes.push(v3(f[0], f[1], f[2]));
        }
    }
    let mut triangles = Vec::new();
    let mut i = 0;
    while i + 2 < vertexes.len() {
        triangles.push(new_triangle(vertexes[i], vertexes[i + 1], vertexes[i + 2]));
        i += 3;
    }
    Ok(new_mesh(triangles))
}
