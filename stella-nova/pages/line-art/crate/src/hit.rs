//! Rust port of ln/hit.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! The Go Hit also holds the shape that was hit. No ln code reads that
//! field, so the port keeps the distance only.

use crate::util::INF;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    pub t: f64,
}

pub const NO_HIT: Hit = Hit { t: INF };

impl Hit {
    pub fn new(t: f64) -> Hit {
        Hit { t }
    }
    pub fn ok(&self) -> bool {
        self.t < INF
    }
    pub fn min(self, b: Hit) -> Hit {
        if self.t <= b.t {
            self
        } else {
            b
        }
    }
    pub fn max(self, b: Hit) -> Hit {
        if self.t > b.t {
            self
        } else {
            b
        }
    }
}
