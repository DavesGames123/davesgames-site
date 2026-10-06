//! Rust port of ln/vector.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman). The 3D vector of the engine.

use crate::rng::Rng;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vector {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// Shorthand for `Vector { x, y, z }`.
pub const fn v3(x: f64, y: f64, z: f64) -> Vector {
    Vector { x, y, z }
}

/// A random unit vector: rejection sample in the unit ball, then normalize.
pub fn random_unit_vector(rng: &mut Rng) -> Vector {
    loop {
        let x = rng.float64() * 2.0 - 1.0;
        let y = rng.float64() * 2.0 - 1.0;
        let z = rng.float64() * 2.0 - 1.0;
        if x * x + y * y + z * z > 1.0 {
            continue;
        }
        return v3(x, y, z).normalize();
    }
}

impl Vector {
    pub fn length(self) -> f64 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }
    pub fn distance(self, b: Vector) -> f64 {
        self.sub(b).length()
    }
    pub fn length_squared(self) -> f64 {
        self.x * self.x + self.y * self.y + self.z * self.z
    }
    pub fn distance_squared(self, b: Vector) -> f64 {
        self.sub(b).length_squared()
    }
    pub fn dot(self, b: Vector) -> f64 {
        self.x * b.x + self.y * b.y + self.z * b.z
    }
    pub fn cross(self, b: Vector) -> Vector {
        v3(
            self.y * b.z - self.z * b.y,
            self.z * b.x - self.x * b.z,
            self.x * b.y - self.y * b.x,
        )
    }
    pub fn normalize(self) -> Vector {
        let d = self.length();
        v3(self.x / d, self.y / d, self.z / d)
    }
    pub fn add(self, b: Vector) -> Vector {
        v3(self.x + b.x, self.y + b.y, self.z + b.z)
    }
    pub fn sub(self, b: Vector) -> Vector {
        v3(self.x - b.x, self.y - b.y, self.z - b.z)
    }
    pub fn mul(self, b: Vector) -> Vector {
        v3(self.x * b.x, self.y * b.y, self.z * b.z)
    }
    pub fn div(self, b: Vector) -> Vector {
        v3(self.x / b.x, self.y / b.y, self.z / b.z)
    }
    pub fn add_scalar(self, b: f64) -> Vector {
        v3(self.x + b, self.y + b, self.z + b)
    }
    pub fn sub_scalar(self, b: f64) -> Vector {
        v3(self.x - b, self.y - b, self.z - b)
    }
    pub fn mul_scalar(self, b: f64) -> Vector {
        v3(self.x * b, self.y * b, self.z * b)
    }
    pub fn div_scalar(self, b: f64) -> Vector {
        v3(self.x / b, self.y / b, self.z / b)
    }
    /// Go math.Min: a NaN operand gives NaN. Rust f64::min drops the NaN,
    /// so the port uses the Go rule.
    pub fn min(self, b: Vector) -> Vector {
        v3(gmin(self.x, b.x), gmin(self.y, b.y), gmin(self.z, b.z))
    }
    pub fn max(self, b: Vector) -> Vector {
        v3(gmax(self.x, b.x), gmax(self.y, b.y), gmax(self.z, b.z))
    }
    pub fn min_axis(self) -> Vector {
        let (x, y, z) = (self.x.abs(), self.y.abs(), self.z.abs());
        if x <= y && x <= z {
            v3(1.0, 0.0, 0.0)
        } else if y <= x && y <= z {
            v3(0.0, 1.0, 0.0)
        } else {
            v3(0.0, 0.0, 1.0)
        }
    }
    pub fn min_component(self) -> f64 {
        gmin(gmin(self.x, self.y), self.z)
    }
    /// The distance from this point to the segment v-w.
    pub fn segment_distance(self, v: Vector, w: Vector) -> f64 {
        let l2 = v.distance_squared(w);
        if l2 == 0.0 {
            return self.distance(v);
        }
        let t = self.sub(v).dot(w.sub(v)) / l2;
        if t < 0.0 {
            return self.distance(v);
        }
        if t > 1.0 {
            return self.distance(w);
        }
        v.add(w.sub(v).mul_scalar(t)).distance(self)
    }
}

/// Go math.Min (NaN wins).
pub fn gmin(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

/// Go math.Max (NaN wins).
pub fn gmax(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}
