//! Rust port of ln/common.go, ln/axis.go and ln/util.go
//! (github.com/fogleman/ln, MIT, Copyright (C) 2016 Michael Fogleman).
//! The constants, the split axis of the tree, and the small helpers.

/// The "no hit" distance. A hit with `t >= INF` is a miss.
pub const INF: f64 = 1e9;
/// The tolerance of the triangle and plane tests.
pub const EPS: f64 = 1e-9;

/// The split axis of a tree node. `None` marks a leaf.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Axis {
    None,
    X,
    Y,
    Z,
}

pub fn radians(degrees: f64) -> f64 {
    degrees * std::f64::consts::PI / 180.0
}

pub fn degrees(radians: f64) -> f64 {
    radians * 180.0 / std::f64::consts::PI
}

/// The median of a sorted list (ln Median). An empty list gives 0.
pub fn median(items: &[f64]) -> f64 {
    let n = items.len();
    if n == 0 {
        0.0
    } else if n % 2 == 1 {
        items[n / 2]
    } else {
        (items[n / 2 - 1] + items[n / 2]) / 2.0
    }
}

/// Parse each item as a float. A bad item gives 0, as Go strconv does
/// when its error is not read.
pub fn parse_floats(items: &[&str]) -> Vec<f64> {
    items.iter().map(|s| s.parse::<f64>().unwrap_or(0.0)).collect()
}
