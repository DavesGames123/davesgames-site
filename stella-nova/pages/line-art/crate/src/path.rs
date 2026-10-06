//! Rust port of ln/path.go (github.com/fogleman/ln, MIT,
//! Copyright (C) 2016 Michael Fogleman).
//!
//! A Path is a polyline of 3D points; Paths is a list of them. The render
//! chops each path into short steps, filters each point (the hidden line
//! test), simplifies what is left, and transforms it to the image.
//! Go has methods on the slice types. Rust puts the same methods on
//! `Vec<Vector>` and `Vec<Path>` through the PathExt and PathsExt traits.
//! WriteToPNG (the gg library) is not ported: the web page draws the paths.

use crate::bbox::BBox;
use crate::filter::Filter;
use crate::matrix::Matrix;
use crate::vector::Vector;
use std::fmt::Write;

pub type Path = Vec<Vector>;
pub type Paths = Vec<Path>;

pub trait PathExt {
    fn bounding_box(&self) -> BBox;
    fn transform(&self, matrix: &Matrix) -> Path;
    fn chop(&self, step: f64) -> Path;
    fn filter(&self, f: &dyn Filter) -> Paths;
    fn simplify(&self, threshold: f64) -> Path;
    fn to_string_ln(&self) -> String;
    fn to_svg(&self) -> String;
}

impl PathExt for [Vector] {
    fn bounding_box(&self) -> BBox {
        let mut b = BBox::new(self[0], self[0]);
        for &v in self {
            b = b.extend(BBox::new(v, v));
        }
        b
    }

    fn transform(&self, matrix: &Matrix) -> Path {
        self.iter().map(|&v| matrix.mul_position(v)).collect()
    }

    /// Add points so that no segment is longer than `step`. A path with one
    /// point gives an empty path, as in ln.
    fn chop(&self, step: f64) -> Path {
        let mut result = Vec::new();
        for i in 0..self.len().saturating_sub(1) {
            let a = self[i];
            let b = self[i + 1];
            let v = b.sub(a);
            let l = v.length();
            if i == 0 {
                result.push(a);
            }
            let mut d = step;
            while d < l {
                result.push(a.add(v.mul_scalar(d / l)));
                d += step;
            }
            result.push(b);
        }
        result
    }

    /// Cut the path where the filter drops a point. Each run of two or more
    /// kept points becomes one path.
    fn filter(&self, f: &dyn Filter) -> Paths {
        let mut result = Vec::new();
        let mut path: Path = Vec::new();
        for &v in self {
            let (v, ok) = f.filter(v);
            if ok {
                path.push(v);
            } else {
                if path.len() > 1 {
                    result.push(std::mem::take(&mut path));
                }
                path.clear();
            }
        }
        if path.len() > 1 {
            result.push(path);
        }
        result
    }

    /// Ramer-Douglas-Peucker with the distance `threshold`.
    fn simplify(&self, threshold: f64) -> Path {
        if self.len() < 3 {
            return self.to_vec();
        }
        let a = self[0];
        let b = self[self.len() - 1];
        let mut index = 0usize;
        let mut found = false;
        let mut distance = 0.0;
        for i in 1..self.len() - 1 {
            let d = self[i].segment_distance(a, b);
            if d > distance {
                index = i;
                found = true;
                distance = d;
            }
        }
        if found && distance > threshold {
            let mut r1 = self[..=index].simplify(threshold);
            let r2 = self[index..].simplify(threshold);
            r1.pop();
            r1.extend(r2);
            r1
        } else {
            vec![a, b]
        }
    }

    /// "x,y;x,y;..." with Go %g numbers (ln String).
    fn to_string_ln(&self) -> String {
        self.iter().map(|v| format!("{},{}", v.x, v.y)).collect::<Vec<_>>().join(";")
    }

    fn to_svg(&self) -> String {
        let mut coords = String::new();
        for (i, v) in self.iter().enumerate() {
            if i > 0 {
                coords.push(' ');
            }
            let _ = write!(coords, "{:.6},{:.6}", v.x, v.y);
        }
        format!("<polyline stroke=\"black\" fill=\"none\" points=\"{}\" />", coords)
    }
}

pub trait PathsExt {
    fn bounding_box(&self) -> BBox;
    fn transform(&self, matrix: &Matrix) -> Paths;
    fn chop(&self, step: f64) -> Paths;
    fn filter(&self, f: &dyn Filter) -> Paths;
    fn simplify(&self, threshold: f64) -> Paths;
    fn to_string_ln(&self) -> String;
    fn to_svg(&self, width: f64, height: f64) -> String;
    fn to_svg_styled(&self, width: f64, height: f64, style: &SvgStyle) -> String;
    fn segment_count(&self) -> usize;
}

impl PathsExt for [Path] {
    fn bounding_box(&self) -> BBox {
        let mut b = self[0].bounding_box();
        for p in self {
            b = b.extend(p.bounding_box());
        }
        b
    }
    fn transform(&self, matrix: &Matrix) -> Paths {
        self.iter().map(|p| p.transform(matrix)).collect()
    }
    fn chop(&self, step: f64) -> Paths {
        self.iter().map(|p| p.chop(step)).collect()
    }
    fn filter(&self, f: &dyn Filter) -> Paths {
        let mut result = Vec::new();
        for p in self {
            result.extend(p.filter(f));
        }
        result
    }
    fn simplify(&self, threshold: f64) -> Paths {
        self.iter().map(|p| p.simplify(threshold)).collect()
    }
    fn to_string_ln(&self) -> String {
        self.iter().map(|p| p.to_string_ln()).collect::<Vec<_>>().join("\n")
    }
    /// The SVG of ln ToSVG: black polylines, y up (a flip in a group).
    fn to_svg(&self, width: f64, height: f64) -> String {
        let mut lines = Vec::with_capacity(self.len() + 3);
        lines.push(format!(
            "<svg width=\"{:.6}\" height=\"{:.6}\" version=\"1.1\" baseProfile=\"full\" xmlns=\"http://www.w3.org/2000/svg\">",
            width, height
        ));
        lines.push(format!("<g transform=\"translate(0,{:.6}) scale(1,-1)\">", height));
        for p in self {
            lines.push(p.to_svg());
        }
        lines.push("</g></svg>".to_string());
        lines.join("\n")
    }
    /// Not in ln: the same document with a paper fill, an ink color and a
    /// line width, and shorter numbers. The page export uses it.
    fn to_svg_styled(&self, width: f64, height: f64, style: &SvgStyle) -> String {
        let mut s = String::with_capacity(self.len() * 64 + 512);
        let _ = write!(
            s,
            "<svg width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\" version=\"1.1\" baseProfile=\"full\" xmlns=\"http://www.w3.org/2000/svg\">\n",
            w = fmt_num(width),
            h = fmt_num(height)
        );
        if !style.title.is_empty() {
            let _ = write!(s, "<title>{}</title>\n", xml_escape(&style.title));
        }
        if !style.background.is_empty() {
            let _ = write!(s, "<rect width=\"100%\" height=\"100%\" fill=\"{}\" />\n", xml_escape(&style.background));
        }
        let _ = write!(
            s,
            "<g transform=\"translate(0,{}) scale(1,-1)\" stroke=\"{}\" stroke-width=\"{}\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n",
            fmt_num(height),
            xml_escape(&style.stroke),
            fmt_num(style.line_width)
        );
        for p in self {
            s.push_str("<polyline points=\"");
            for (i, v) in p.iter().enumerate() {
                if i > 0 {
                    s.push(' ');
                }
                let _ = write!(s, "{},{}", fmt_num(v.x), fmt_num(v.y));
            }
            s.push_str("\" />\n");
        }
        s.push_str("</g></svg>\n");
        s
    }
    fn segment_count(&self) -> usize {
        self.iter().map(|p| p.len().saturating_sub(1)).sum()
    }
}

/// The paper, ink and line width of `to_svg_styled`.
pub struct SvgStyle {
    pub stroke: String,
    pub background: String,
    pub line_width: f64,
    pub title: String,
}

/// Two decimals, with the trailing zeros cut.
fn fmt_num(x: f64) -> String {
    let s = format!("{:.2}", x);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" {
        "0".to_string()
    } else {
        s.to_string()
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}
