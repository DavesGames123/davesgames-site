//! Rust port of ln/matrix.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! A 4x4 matrix, row major. `m[r * 4 + c]` is the Go field `x{r}{c}`.
//! The camera functions are here: look_at, perspective, frustum and
//! orthographic. The methods translate, scale and rotate multiply on the
//! left, as in ln: `m.translate(v)` is `Translate(v) * m`.

use crate::bbox::BBox;
use crate::ray::Ray;
use crate::vector::{v3, Vector};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix {
    pub m: [f64; 16],
}

impl Default for Matrix {
    fn default() -> Self {
        identity()
    }
}

pub fn identity() -> Matrix {
    Matrix {
        m: [
            1.0, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0, //
            0.0, 0.0, 0.0, 1.0,
        ],
    }
}

pub fn translate(v: Vector) -> Matrix {
    Matrix {
        m: [
            1.0, 0.0, 0.0, v.x, //
            0.0, 1.0, 0.0, v.y, //
            0.0, 0.0, 1.0, v.z, //
            0.0, 0.0, 0.0, 1.0,
        ],
    }
}

pub fn scale(v: Vector) -> Matrix {
    Matrix {
        m: [
            v.x, 0.0, 0.0, 0.0, //
            0.0, v.y, 0.0, 0.0, //
            0.0, 0.0, v.z, 0.0, //
            0.0, 0.0, 0.0, 1.0,
        ],
    }
}

/// A rotation of `a` radians about the axis `v`.
pub fn rotate(v: Vector, a: f64) -> Matrix {
    let v = v.normalize();
    let s = a.sin();
    let c = a.cos();
    let m = 1.0 - c;
    Matrix {
        m: [
            m * v.x * v.x + c,
            m * v.x * v.y + v.z * s,
            m * v.z * v.x - v.y * s,
            0.0,
            m * v.x * v.y - v.z * s,
            m * v.y * v.y + c,
            m * v.y * v.z + v.x * s,
            0.0,
            m * v.z * v.x + v.y * s,
            m * v.y * v.z - v.x * s,
            m * v.z * v.z + c,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
        ],
    }
}

pub fn frustum(l: f64, r: f64, b: f64, t: f64, n: f64, f: f64) -> Matrix {
    let t1 = 2.0 * n;
    let t2 = r - l;
    let t3 = t - b;
    let t4 = f - n;
    Matrix {
        m: [
            t1 / t2,
            0.0,
            (r + l) / t2,
            0.0,
            0.0,
            t1 / t3,
            (t + b) / t3,
            0.0,
            0.0,
            0.0,
            (-f - n) / t4,
            (-t1 * f) / t4,
            0.0,
            0.0,
            -1.0,
            0.0,
        ],
    }
}

pub fn orthographic(l: f64, r: f64, b: f64, t: f64, n: f64, f: f64) -> Matrix {
    Matrix {
        m: [
            2.0 / (r - l),
            0.0,
            0.0,
            -(r + l) / (r - l),
            0.0,
            2.0 / (t - b),
            0.0,
            -(t + b) / (t - b),
            0.0,
            0.0,
            -2.0 / (f - n),
            -(f + n) / (f - n),
            0.0,
            0.0,
            0.0,
            1.0,
        ],
    }
}

/// `fovy` is the vertical field of view in degrees.
pub fn perspective(fovy: f64, aspect: f64, near: f64, far: f64) -> Matrix {
    let ymax = near * (fovy * std::f64::consts::PI / 360.0).tan();
    let xmax = ymax * aspect;
    frustum(-xmax, xmax, -ymax, ymax, near, far)
}

/// The view matrix of a camera at `eye` that looks at `center`.
pub fn look_at(eye: Vector, center: Vector, up: Vector) -> Matrix {
    let up = up.normalize();
    let f = center.sub(eye).normalize();
    let s = f.cross(up).normalize();
    let u = s.cross(f).normalize();
    let m = Matrix {
        m: [
            s.x, u.x, -f.x, eye.x, //
            s.y, u.y, -f.y, eye.y, //
            s.z, u.z, -f.z, eye.z, //
            0.0, 0.0, 0.0, 1.0,
        ],
    };
    m.inverse()
}

impl Matrix {
    pub fn translate(&self, v: Vector) -> Matrix {
        translate(v).mul(self)
    }
    pub fn scale(&self, v: Vector) -> Matrix {
        scale(v).mul(self)
    }
    pub fn rotate(&self, v: Vector, a: f64) -> Matrix {
        rotate(v, a).mul(self)
    }
    pub fn frustum(&self, l: f64, r: f64, b: f64, t: f64, n: f64, f: f64) -> Matrix {
        frustum(l, r, b, t, n, f).mul(self)
    }
    pub fn orthographic(&self, l: f64, r: f64, b: f64, t: f64, n: f64, f: f64) -> Matrix {
        orthographic(l, r, b, t, n, f).mul(self)
    }
    pub fn perspective(&self, fovy: f64, aspect: f64, near: f64, far: f64) -> Matrix {
        perspective(fovy, aspect, near, far).mul(self)
    }

    pub fn mul(&self, b: &Matrix) -> Matrix {
        let a = &self.m;
        let b = &b.m;
        let mut m = [0.0; 16];
        for r in 0..4 {
            for c in 0..4 {
                m[r * 4 + c] = a[r * 4] * b[c]
                    + a[r * 4 + 1] * b[4 + c]
                    + a[r * 4 + 2] * b[8 + c]
                    + a[r * 4 + 3] * b[12 + c];
            }
        }
        Matrix { m }
    }

    pub fn mul_position(&self, b: Vector) -> Vector {
        let a = &self.m;
        v3(
            a[0] * b.x + a[1] * b.y + a[2] * b.z + a[3],
            a[4] * b.x + a[5] * b.y + a[6] * b.z + a[7],
            a[8] * b.x + a[9] * b.y + a[10] * b.z + a[11],
        )
    }

    /// The position after the perspective divide.
    pub fn mul_position_w(&self, b: Vector) -> Vector {
        let a = &self.m;
        let x = a[0] * b.x + a[1] * b.y + a[2] * b.z + a[3];
        let y = a[4] * b.x + a[5] * b.y + a[6] * b.z + a[7];
        let z = a[8] * b.x + a[9] * b.y + a[10] * b.z + a[11];
        let w = a[12] * b.x + a[13] * b.y + a[14] * b.z + a[15];
        v3(x / w, y / w, z / w)
    }

    pub fn mul_direction(&self, b: Vector) -> Vector {
        let a = &self.m;
        v3(
            a[0] * b.x + a[1] * b.y + a[2] * b.z,
            a[4] * b.x + a[5] * b.y + a[6] * b.z,
            a[8] * b.x + a[9] * b.y + a[10] * b.z,
        )
        .normalize()
    }

    pub fn mul_ray(&self, b: Ray) -> Ray {
        Ray::new(self.mul_position(b.origin), self.mul_direction(b.direction))
    }

    /// The axis-aligned box that holds the transformed box.
    /// See dev.theomader.com/transform-bounding-boxes (the ln reference).
    pub fn mul_box(&self, bx: BBox) -> BBox {
        let a = &self.m;
        let r = v3(a[0], a[4], a[8]);
        let u = v3(a[1], a[5], a[9]);
        let b = v3(a[2], a[6], a[10]);
        let t = v3(a[3], a[7], a[11]);
        let xa = r.mul_scalar(bx.min.x);
        let xb = r.mul_scalar(bx.max.x);
        let ya = u.mul_scalar(bx.min.y);
        let yb = u.mul_scalar(bx.max.y);
        let za = b.mul_scalar(bx.min.z);
        let zb = b.mul_scalar(bx.max.z);
        let (xa, xb) = (xa.min(xb), xa.max(xb));
        let (ya, yb) = (ya.min(yb), ya.max(yb));
        let (za, zb) = (za.min(zb), za.max(zb));
        let min = xa.add(ya).add(za).add(t);
        let max = xb.add(yb).add(zb).add(t);
        BBox::new(min, max)
    }

    pub fn transpose(&self) -> Matrix {
        let a = &self.m;
        let mut m = [0.0; 16];
        for r in 0..4 {
            for c in 0..4 {
                m[r * 4 + c] = a[c * 4 + r];
            }
        }
        Matrix { m }
    }

    pub fn determinant(&self) -> f64 {
        let [x00, x01, x02, x03, x10, x11, x12, x13, x20, x21, x22, x23, x30, x31, x32, x33] = self.m;
        x00 * x11 * x22 * x33 - x00 * x11 * x23 * x32 + x00 * x12 * x23 * x31
            - x00 * x12 * x21 * x33
            + x00 * x13 * x21 * x32
            - x00 * x13 * x22 * x31
            - x01 * x12 * x23 * x30
            + x01 * x12 * x20 * x33
            - x01 * x13 * x20 * x32
            + x01 * x13 * x22 * x30
            - x01 * x10 * x22 * x33
            + x01 * x10 * x23 * x32
            + x02 * x13 * x20 * x31
            - x02 * x13 * x21 * x30
            + x02 * x10 * x21 * x33
            - x02 * x10 * x23 * x31
            + x02 * x11 * x23 * x30
            - x02 * x11 * x20 * x33
            - x03 * x10 * x21 * x32
            + x03 * x10 * x22 * x31
            - x03 * x11 * x22 * x30
            + x03 * x11 * x20 * x32
            - x03 * x12 * x20 * x31
            + x03 * x12 * x21 * x30
    }

    pub fn inverse(&self) -> Matrix {
        let [x00, x01, x02, x03, x10, x11, x12, x13, x20, x21, x22, x23, x30, x31, x32, x33] = self.m;
        let d = self.determinant();
        let m = [
            (x12 * x23 * x31 - x13 * x22 * x31 + x13 * x21 * x32 - x11 * x23 * x32 - x12 * x21 * x33 + x11 * x22 * x33) / d,
            (x03 * x22 * x31 - x02 * x23 * x31 - x03 * x21 * x32 + x01 * x23 * x32 + x02 * x21 * x33 - x01 * x22 * x33) / d,
            (x02 * x13 * x31 - x03 * x12 * x31 + x03 * x11 * x32 - x01 * x13 * x32 - x02 * x11 * x33 + x01 * x12 * x33) / d,
            (x03 * x12 * x21 - x02 * x13 * x21 - x03 * x11 * x22 + x01 * x13 * x22 + x02 * x11 * x23 - x01 * x12 * x23) / d,
            (x13 * x22 * x30 - x12 * x23 * x30 - x13 * x20 * x32 + x10 * x23 * x32 + x12 * x20 * x33 - x10 * x22 * x33) / d,
            (x02 * x23 * x30 - x03 * x22 * x30 + x03 * x20 * x32 - x00 * x23 * x32 - x02 * x20 * x33 + x00 * x22 * x33) / d,
            (x03 * x12 * x30 - x02 * x13 * x30 - x03 * x10 * x32 + x00 * x13 * x32 + x02 * x10 * x33 - x00 * x12 * x33) / d,
            (x02 * x13 * x20 - x03 * x12 * x20 + x03 * x10 * x22 - x00 * x13 * x22 - x02 * x10 * x23 + x00 * x12 * x23) / d,
            (x11 * x23 * x30 - x13 * x21 * x30 + x13 * x20 * x31 - x10 * x23 * x31 - x11 * x20 * x33 + x10 * x21 * x33) / d,
            (x03 * x21 * x30 - x01 * x23 * x30 - x03 * x20 * x31 + x00 * x23 * x31 + x01 * x20 * x33 - x00 * x21 * x33) / d,
            (x01 * x13 * x30 - x03 * x11 * x30 + x03 * x10 * x31 - x00 * x13 * x31 - x01 * x10 * x33 + x00 * x11 * x33) / d,
            (x03 * x11 * x20 - x01 * x13 * x20 - x03 * x10 * x21 + x00 * x13 * x21 + x01 * x10 * x23 - x00 * x11 * x23) / d,
            (x12 * x21 * x30 - x11 * x22 * x30 - x12 * x20 * x31 + x10 * x22 * x31 + x11 * x20 * x32 - x10 * x21 * x32) / d,
            (x01 * x22 * x30 - x02 * x21 * x30 + x02 * x20 * x31 - x00 * x22 * x31 - x01 * x20 * x32 + x00 * x21 * x32) / d,
            (x02 * x11 * x30 - x01 * x12 * x30 - x02 * x10 * x31 + x00 * x12 * x31 + x01 * x10 * x32 - x00 * x11 * x32) / d,
            (x01 * x12 * x20 - x02 * x11 * x20 + x02 * x10 * x21 - x00 * x12 * x21 - x01 * x10 * x22 + x00 * x11 * x22) / d,
        ];
        Matrix { m }
    }
}
