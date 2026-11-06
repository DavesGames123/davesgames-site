//! The triangle builder.
//!
//! A vertex is 8 floats (32 bytes): [px, py, pz, nx, ny, nz, colour, birth].
//! The builder works in the local frame of one cell: x, y and z in [0, 2].
//! It turns the points `rot` quarter turns about the vertical axis through
//! the cell centre (+x goes to +z for one turn), then adds `off`.
//!
//! Each face gets a hint direction. The builder flips the winding so that
//! the flat normal points along the hint. Thus all faces are counter
//! clockwise when you look at the front, and back face culling is safe.

pub const STRIDE: usize = 8;

pub struct B<'a> {
    pub v: &'a mut Vec<f32>,
    pub rot: u8,
    pub off: [f32; 3],
    pub birth: f32,
}

#[inline]
pub fn rot_xz(x: f32, z: f32, r: u8) -> (f32, f32) {
    match r & 3 {
        0 => (x, z),
        1 => (2.0 - z, x),
        2 => (2.0 - x, 2.0 - z),
        _ => (z, 2.0 - x),
    }
}

#[inline]
fn rot_dir(x: f32, z: f32, r: u8) -> (f32, f32) {
    match r & 3 {
        0 => (x, z),
        1 => (-z, x),
        2 => (-x, -z),
        _ => (z, -x),
    }
}

#[inline]
fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
#[inline]
fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
#[inline]
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub const PX: [f32; 3] = [1.0, 0.0, 0.0];
pub const NX: [f32; 3] = [-1.0, 0.0, 0.0];
pub const PY: [f32; 3] = [0.0, 1.0, 0.0];
pub const NY: [f32; 3] = [0.0, -1.0, 0.0];
pub const PZ: [f32; 3] = [0.0, 0.0, 1.0];
pub const NZ: [f32; 3] = [0.0, 0.0, -1.0];

impl<'a> B<'a> {
    pub fn tri(&mut self, a: [f32; 3], b: [f32; 3], c: [f32; 3], col: u8, hint: [f32; 3]) {
        let mut n = cross(sub(b, a), sub(c, a));
        let (b, c) = if dot(n, hint) < 0.0 {
            n = [-n[0], -n[1], -n[2]];
            (c, b)
        } else {
            (b, c)
        };
        let len = dot(n, n).sqrt();
        if len < 1e-9 {
            return;
        }
        let (nx, nz) = rot_dir(n[0] / len, n[2] / len, self.rot);
        let ny = n[1] / len;
        for p in [a, b, c] {
            let (x, z) = rot_xz(p[0], p[2], self.rot);
            self.v.extend_from_slice(&[
                x + self.off[0],
                p[1] + self.off[1],
                z + self.off[2],
                nx,
                ny,
                nz,
                col as f32,
                self.birth,
            ]);
        }
    }

    /// A convex quad a b c d (in order around the edge).
    pub fn quad(&mut self, a: [f32; 3], b: [f32; 3], c: [f32; 3], d: [f32; 3], col: u8, hint: [f32; 3]) {
        self.tri(a, b, c, col, hint);
        self.tri(a, c, d, col, hint);
    }

    /// A triangle that faces away from `centre`.
    pub fn tri_out(&mut self, a: [f32; 3], b: [f32; 3], c: [f32; 3], col: u8, centre: [f32; 3]) {
        let m = [(a[0] + b[0] + c[0]) / 3.0, (a[1] + b[1] + c[1]) / 3.0, (a[2] + b[2] + c[2]) / 3.0];
        self.tri(a, b, c, col, sub(m, centre));
    }

    /// An axis aligned box. Mask bits: 1 +x, 2 +z, 4 -x, 8 -z, 16 +y, 32 -y.
    pub fn cuboid(&mut self, lo: [f32; 3], hi: [f32; 3], col: u8, mask: u8) {
        let [x0, y0, z0] = lo;
        let [x1, y1, z1] = hi;
        if mask & 1 != 0 {
            self.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], col, PX);
        }
        if mask & 2 != 0 {
            self.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, PZ);
        }
        if mask & 4 != 0 {
            self.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, NX);
        }
        if mask & 8 != 0 {
            self.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], col, NZ);
        }
        if mask & 16 != 0 {
            self.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], col, PY);
        }
        if mask & 32 != 0 {
            self.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, NY);
        }
    }

    pub fn boxc(&mut self, lo: [f32; 3], hi: [f32; 3], col: u8) {
        self.cuboid(lo, hi, col, 31);
    }

    /// A prism with `n` sides about a vertical axis (a low poly cylinder).
    pub fn prism(&mut self, cx: f32, cz: f32, r: f32, y0: f32, y1: f32, n: usize, col: u8, cap: bool) {
        let c = [cx, (y0 + y1) * 0.5, cz];
        for s in 0..n {
            let a0 = s as f32 / n as f32 * std::f32::consts::TAU;
            let a1 = (s + 1) as f32 / n as f32 * std::f32::consts::TAU;
            let (p0x, p0z) = (cx + r * a0.cos(), cz + r * a0.sin());
            let (p1x, p1z) = (cx + r * a1.cos(), cz + r * a1.sin());
            let mid = [(p0x + p1x) * 0.5 - cx, 0.0, (p0z + p1z) * 0.5 - cz];
            self.quad([p0x, y0, p0z], [p1x, y0, p1z], [p1x, y1, p1z], [p0x, y1, p0z], col, mid);
            if cap {
                self.tri([cx, y1, cz], [p0x, y1, p0z], [p1x, y1, p1z], col, PY);
            }
        }
        let _ = c;
    }

    /// A cone or pyramid with `n` sides, from radius r at y0 to a point.
    pub fn cone(&mut self, cx: f32, cz: f32, r: f32, y0: f32, yt: f32, n: usize, col: u8, phase: f32) {
        let c = [cx, y0, cz];
        for s in 0..n {
            let a0 = (s as f32 + phase) / n as f32 * std::f32::consts::TAU;
            let a1 = (s as f32 + 1.0 + phase) / n as f32 * std::f32::consts::TAU;
            let p0 = [cx + r * a0.cos(), y0, cz + r * a0.sin()];
            let p1 = [cx + r * a1.cos(), y0, cz + r * a1.sin()];
            self.tri_out(p0, p1, [cx, yt, cz], col, c);
        }
    }

    /// A faceted ball: a 6 sided ring at the equator, two rings at +-0.55 r.
    pub fn blob(&mut self, c: [f32; 3], r: f32, col: u8) {
        let n = 6;
        let ring = |lat: f32, rr: f32, ph: f32| -> Vec<[f32; 3]> {
            (0..n)
                .map(|s| {
                    let a = (s as f32 + ph) / n as f32 * std::f32::consts::TAU;
                    [c[0] + rr * a.cos(), c[1] + lat, c[2] + rr * a.sin()]
                })
                .collect()
        };
        let top = [c[0], c[1] + r, c[2]];
        let bot = [c[0], c[1] - r * 0.8, c[2]];
        let up = ring(r * 0.55, r * 0.83, 0.5);
        let mid = ring(0.0, r, 0.0);
        let dn = ring(-r * 0.5, r * 0.8, 0.5);
        for s in 0..n {
            let t = (s + 1) % n;
            self.tri_out(top, up[s], up[t], col, c);
            self.tri_out(up[s], mid[s], mid[t], col, c);
            self.tri_out(up[s], mid[t], up[t], col, c);
            self.tri_out(mid[s], dn[s], mid[t], col, c);
            self.tri_out(mid[t], dn[s], dn[t], col, c);
            self.tri_out(dn[s], bot, dn[t], col, c);
        }
    }

    /// A railing along an axis aligned segment at base height y.
    pub fn railing(&mut self, x0: f32, z0: f32, x1: f32, z1: f32, y: f32, col: u8) {
        let t = 0.04;
        let len = ((x1 - x0).abs()).max((z1 - z0).abs());
        let posts = ((len / 0.65).ceil() as usize).max(1);
        for p in 0..=posts {
            let f = p as f32 / posts as f32;
            let x = x0 + (x1 - x0) * f;
            let z = z0 + (z1 - z0) * f;
            self.cuboid([x - t, y, z - t], [x + t, y + 1.0, z + t], col, 15);
        }
        let (lx, hx) = (x0.min(x1) - t, x0.max(x1) + t);
        let (lz, hz) = (z0.min(z1) - t, z0.max(z1) + t);
        self.boxc([lx, y + 1.0, lz], [hx, y + 1.07, hz], col);
        let s = 0.02;
        self.cuboid([lx + 0.02, y + 0.5, lz + 0.02 - s * 0.0], [hx - 0.02, y + 0.54, hz - 0.02], col, 63);
    }
}

/// Turn a local box (rotation 0) by `r` quarter turns.
pub fn rot_box(b: [f32; 6], r: u8) -> [f32; 6] {
    let (ax, az) = rot_xz(b[0], b[2], r);
    let (bx, bz) = rot_xz(b[3], b[5], r);
    [ax.min(bx), b[1], az.min(bz), ax.max(bx), b[4], az.max(bz)]
}
