//! Not in ln. Mesh and path builders for the original scenes: extrusion,
//! rings, lathe, tube sweep, height field, marching squares contours and
//! a segment stitcher. The meshes are plain ln triangle meshes; the paths
//! are plain ln paths, so the engine treats them like any other shape.
//!
//! GREP MAP
//!   grep -n 'pub fn extrude'     a prism from a star-shaped polygon
//!   grep -n 'pub fn annulus'     a flat ring with walls
//!   grep -n 'pub fn lathe'       a surface of revolution
//!   grep -n 'pub fn tube'        a tube along a 3D curve
//!   grep -n 'pub fn heightfield' z = f(x, y) as triangles
//!   grep -n 'pub fn contours'    marching squares, stitched polylines
//!   grep -n 'pub fn gear_profile'

use crate::mesh::{new_mesh, Mesh, MeshEdges};
use crate::path::{Path, Paths};
use crate::triangle::{new_triangle, Triangle};
use crate::vector::{v3, Vector};
use std::collections::HashMap;
use std::f64::consts::TAU;

/// Two triangles a-b-c and a-c-d (counter-clockwise seen from outside).
pub fn quad(t: &mut Vec<Triangle>, a: Vector, b: Vector, c: Vector, d: Vector) {
    t.push(new_triangle(a, b, c));
    t.push(new_triangle(a, c, d));
}

/// A prism: the polygon (counter-clockwise, star-shaped from its mean
/// point) from z0 to z1. The texture is the sharp edges.
pub fn extrude(poly: &[(f64, f64)], z0: f64, z1: f64) -> Mesh {
    let n = poly.len();
    let (mut cx, mut cy) = (0.0, 0.0);
    for p in poly {
        cx += p.0;
        cy += p.1;
    }
    let (cx, cy) = (cx / n as f64, cy / n as f64);
    let mut t = Vec::with_capacity(n * 4);
    for i in 0..n {
        let (a, b) = (poly[i], poly[(i + 1) % n]);
        quad(&mut t, v3(a.0, a.1, z0), v3(b.0, b.1, z0), v3(b.0, b.1, z1), v3(a.0, a.1, z1));
        t.push(new_triangle(v3(cx, cy, z0), v3(b.0, b.1, z0), v3(a.0, a.1, z0)));
        t.push(new_triangle(v3(cx, cy, z1), v3(a.0, a.1, z1), v3(b.0, b.1, z1)));
    }
    let mut m = new_mesh(t);
    m.edges = MeshEdges::Sharp(25.0);
    m
}

/// A circle polygon of `n` points.
pub fn circle(r: f64, n: usize) -> Vec<(f64, f64)> {
    (0..n).map(|i| (r * (TAU * i as f64 / n as f64).cos(), r * (TAU * i as f64 / n as f64).sin())).collect()
}

/// A flat ring between radii r0 < r1, from z0 to z1.
pub fn annulus(r0: f64, r1: f64, z0: f64, z1: f64, n: usize) -> Mesh {
    let mut t = Vec::new();
    for i in 0..n {
        let (a0, a1) = (TAU * i as f64 / n as f64, TAU * (i + 1) as f64 / n as f64);
        let p = |r: f64, a: f64, z: f64| v3(r * a.cos(), r * a.sin(), z);
        quad(&mut t, p(r1, a0, z0), p(r1, a1, z0), p(r1, a1, z1), p(r1, a0, z1));
        quad(&mut t, p(r0, a1, z0), p(r0, a0, z0), p(r0, a0, z1), p(r0, a1, z1));
        quad(&mut t, p(r0, a0, z1), p(r1, a0, z1), p(r1, a1, z1), p(r0, a1, z1));
        quad(&mut t, p(r0, a1, z0), p(r1, a1, z0), p(r1, a0, z0), p(r0, a0, z0));
    }
    let mut m = new_mesh(t);
    m.edges = MeshEdges::Sharp(25.0);
    m
}

/// A surface of revolution about z: the profile is (radius, z) points
/// from the base up. Returns the mesh; `lathe_rings` gives its texture.
pub fn lathe(profile: &[(f64, f64)], n: usize) -> Mesh {
    let mut t = Vec::new();
    for k in 0..profile.len() - 1 {
        let (r0, z0) = profile[k];
        let (r1, z1) = profile[k + 1];
        for i in 0..n {
            let (a0, a1) = (TAU * i as f64 / n as f64, TAU * (i + 1) as f64 / n as f64);
            let p = |r: f64, a: f64, z: f64| v3(r * a.cos(), r * a.sin(), z);
            quad(&mut t, p(r0, a0, z0), p(r0, a1, z0), p(r1, a1, z1), p(r1, a0, z1));
        }
    }
    new_mesh(t)
}

/// Rings of a lathe profile at heights `zs` (interpolated radius), and
/// `meridians` lines from the base to the top.
pub fn lathe_rings(profile: &[(f64, f64)], zs: &[f64], meridians: usize, lift: f64) -> Paths {
    let radius_at = |z: f64| {
        for k in 0..profile.len() - 1 {
            let (r0, z0) = profile[k];
            let (r1, z1) = profile[k + 1];
            if z >= z0.min(z1) && z <= z0.max(z1) && (z1 - z0).abs() > 1e-12 {
                return r0 + (r1 - r0) * (z - z0) / (z1 - z0);
            }
        }
        profile.last().unwrap().0
    };
    let mut out = Vec::new();
    for &z in zs {
        let r = radius_at(z) + lift;
        out.push((0..=96).map(|i| v3(r * (TAU * i as f64 / 96.0).cos(), r * (TAU * i as f64 / 96.0).sin(), z)).collect());
    }
    for m in 0..meridians {
        let a = TAU * m as f64 / meridians as f64;
        out.push(profile.iter().map(|&(r, z)| v3((r + lift) * a.cos(), (r + lift) * a.sin(), z)).collect());
    }
    out
}

/// A tube of `radius` along `curve` with `sides` facets, frames by
/// parallel transport. Returns the mesh and one ring path per curve point
/// (`ring_every` picks every k-th) plus `stripes` lines along the tube.
pub fn tube(curve: &[Vector], radius: f64, sides: usize, closed: bool, ring_every: usize, stripes: usize) -> (Mesh, Paths) {
    let n = curve.len();
    let tangent = |i: usize| {
        let a = if i == 0 { if closed { curve[n - 2] } else { curve[0] } } else { curve[i - 1] };
        let b = if i == n - 1 { if closed { curve[1] } else { curve[n - 1] } } else { curve[i + 1] };
        b.sub(a).normalize()
    };
    let mut frames = Vec::with_capacity(n);
    let t0 = tangent(0);
    let mut u = t0.cross(t0.min_axis()).normalize();
    for i in 0..n {
        let t = tangent(i);
        u = u.sub(t.mul_scalar(u.dot(t))).normalize();
        let w = t.cross(u).normalize();
        frames.push((u, w));
    }
    let ring = |i: usize, r: f64| -> Vec<Vector> {
        let (u, w) = frames[i];
        (0..=sides).map(|k| {
            let a = TAU * k as f64 / sides as f64;
            curve[i].add(u.mul_scalar(a.cos() * r)).add(w.mul_scalar(a.sin() * r))
        }).collect()
    };
    let rings: Vec<Vec<Vector>> = (0..n).map(|i| ring(i, radius)).collect();
    let mut t = Vec::new();
    for i in 0..n - 1 {
        for k in 0..sides {
            quad(&mut t, rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]);
        }
    }
    let mut paths: Paths = Vec::new();
    let lifted: Vec<Vec<Vector>> = (0..n).map(|i| ring(i, radius * 1.004)).collect();
    for i in (0..n).step_by(ring_every.max(1)) {
        paths.push(lifted[i].clone());
    }
    for s in 0..stripes {
        let k = s * sides / stripes.max(1);
        paths.push((0..n).map(|i| lifted[i][k]).collect());
    }
    (new_mesh(t), paths)
}

/// z = f(x, y) on an nx x ny grid, as triangles.
pub fn heightfield(f: &dyn Fn(f64, f64) -> f64, x0: f64, x1: f64, y0: f64, y1: f64, nx: usize, ny: usize) -> Mesh {
    let p = |i: usize, j: usize| {
        let x = x0 + (x1 - x0) * i as f64 / nx as f64;
        let y = y0 + (y1 - y0) * j as f64 / ny as f64;
        v3(x, y, f(x, y))
    };
    let mut t = Vec::with_capacity(nx * ny * 2);
    for j in 0..ny {
        for i in 0..nx {
            quad(&mut t, p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1));
        }
    }
    new_mesh(t)
}

/// The level set f(u, v) = 0 on an nu x nv grid over [u0,u1] x [v0,v1],
/// by marching squares. The segments are stitched into polylines, and
/// `map` puts each (u, v) point in 3D.
pub fn contours(f: &dyn Fn(f64, f64) -> f64, u0: f64, u1: f64, v0: f64, v1: f64, nu: usize, nv: usize, map: &dyn Fn(f64, f64) -> Vector) -> Paths {
    let du = (u1 - u0) / nu as f64;
    let dv = (v1 - v0) / nv as f64;
    let mut g = vec![0.0; (nu + 1) * (nv + 1)];
    for j in 0..=nv {
        for i in 0..=nu {
            g[j * (nu + 1) + i] = f(u0 + du * i as f64, v0 + dv * j as f64);
        }
    }
    let at = |i: usize, j: usize| g[j * (nu + 1) + i];
    // An edge key: (0, i, j) the edge (i,j)-(i+1,j); (1, i, j) the edge (i,j)-(i,j+1).
    type K = (u8, usize, usize);
    let point = |k: K| -> (f64, f64) {
        let (a, b, ua, va, ub, vb) = if k.0 == 0 {
            (at(k.1, k.2), at(k.1 + 1, k.2), k.1, k.2, k.1 + 1, k.2)
        } else {
            (at(k.1, k.2), at(k.1, k.2 + 1), k.1, k.2, k.1, k.2 + 1)
        };
        let s = if (a - b).abs() < 1e-300 { 0.5 } else { a / (a - b) };
        let s = s.clamp(0.0, 1.0);
        (u0 + du * (ua as f64 + (ub as f64 - ua as f64) * s), v0 + dv * (va as f64 + (vb as f64 - va as f64) * s))
    };
    let mut segs: Vec<(K, K)> = Vec::new();
    for j in 0..nv {
        for i in 0..nu {
            let (f00, f10, f11, f01) = (at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
            let e = [(0u8, i, j), (1u8, i + 1, j), (0u8, i, j + 1), (1u8, i, j)];
            let cross = [(f00 < 0.0) != (f10 < 0.0), (f10 < 0.0) != (f11 < 0.0), (f01 < 0.0) != (f11 < 0.0), (f00 < 0.0) != (f01 < 0.0)];
            let hits: Vec<usize> = (0..4).filter(|&k| cross[k]).collect();
            if hits.len() == 2 {
                segs.push((e[hits[0]], e[hits[1]]));
            } else if hits.len() == 4 {
                let c = (f00 + f10 + f11 + f01) / 4.0;
                if (c < 0.0) == (f00 < 0.0) {
                    segs.push((e[0], e[1]));
                    segs.push((e[2], e[3]));
                } else {
                    segs.push((e[3], e[0]));
                    segs.push((e[1], e[2]));
                }
            }
        }
    }
    let chains = stitch(&segs);
    chains.into_iter().map(|c| c.into_iter().map(|k| { let (u, v) = point(k); map(u, v) }).collect()).collect()
}

/// Join segments that share end keys into chains (a closed loop repeats
/// its first key at the end).
pub fn stitch<K: Copy + Eq + std::hash::Hash>(segs: &[(K, K)]) -> Vec<Vec<K>> {
    let mut adj: HashMap<K, Vec<usize>> = HashMap::new();
    for (i, s) in segs.iter().enumerate() {
        adj.entry(s.0).or_default().push(i);
        adj.entry(s.1).or_default().push(i);
    }
    let mut used = vec![false; segs.len()];
    let mut out = Vec::new();
    let next = |k: K, used: &Vec<bool>, adj: &HashMap<K, Vec<usize>>| adj.get(&k).and_then(|v| v.iter().copied().find(|&i| !used[i]));
    for start in 0..segs.len() {
        if used[start] {
            continue;
        }
        used[start] = true;
        let mut chain = vec![segs[start].0, segs[start].1];
        // forward
        loop {
            let k = *chain.last().unwrap();
            match next(k, &used, &adj) {
                Some(i) => {
                    used[i] = true;
                    chain.push(if segs[i].0 == k { segs[i].1 } else { segs[i].0 });
                }
                None => break,
            }
        }
        // backward
        loop {
            let k = chain[0];
            match next(k, &used, &adj) {
                Some(i) => {
                    used[i] = true;
                    chain.insert(0, if segs[i].0 == k { segs[i].1 } else { segs[i].0 });
                }
                None => break,
            }
        }
        out.push(chain);
    }
    out
}

/// Join 3D segments (each a two-point path) whose ends match to 1e-6.
pub fn stitch_paths(segs: &[Path]) -> Paths {
    let key = |v: Vector| ((v.x * 1e6).round() as i64, (v.y * 1e6).round() as i64, (v.z * 1e6).round() as i64);
    let mut pos: HashMap<(i64, i64, i64), Vector> = HashMap::new();
    let keyed: Vec<_> = segs
        .iter()
        .filter(|s| s.len() == 2)
        .map(|s| {
            let (a, b) = (key(s[0]), key(s[1]));
            pos.insert(a, s[0]);
            pos.insert(b, s[1]);
            (a, b)
        })
        .collect();
    stitch(&keyed).into_iter().map(|c| c.into_iter().map(|k| pos[&k]).collect()).collect()
}

/// A spur gear outline: `teeth` trapezoid teeth on pitch radius `r`,
/// tooth depth `depth`, counter-clockwise, tooth 0 centred at angle 0.
pub fn gear_profile(teeth: usize, r: f64, depth: f64) -> Vec<(f64, f64)> {
    let (ro, ri) = (r + depth * 0.5, r - depth * 0.6);
    let mut pts = Vec::new();
    let step = TAU / teeth as f64;
    for k in 0..teeth {
        let a = step * k as f64;
        // root arc, flank up, tip arc, flank down (fractions of a pitch)
        let marks = [(-0.5, ri), (-0.32, ri), (-0.17, ro), (0.17, ro), (0.32, ri)];
        for (m, (f, rr)) in marks.iter().enumerate() {
            pts.push(((a + f * step).cos() * rr, (a + f * step).sin() * rr));
            if m == 2 {
                // tip arc points
                for s in 1..3 {
                    let ff = -0.17 + 0.34 * s as f64 / 3.0;
                    pts.push(((a + ff * step).cos() * ro, (a + ff * step).sin() * ro));
                }
            }
        }
    }
    pts
}
