//! The ln examples/ directory (github.com/fogleman/ln, MIT, Copyright (C)
//! 2016 Michael Fogleman) as Rust scene builders. Each file is the Rust
//! port of the Go file with the same name. The Go programs write PNG files
//! and loop over frames; here each one is a function of its parameters
//! and of the camera, so the page can change them and orbit the camera.
//!
//! Changes that apply to all examples:
//!   - Go math/rand is not copied. A `seed` parameter feeds crate::rng, so
//!     random layouts are not the same as the Go output.
//!   - The camera (eye, center, up, fovy) is an input. A shape that draws
//!     its outline from the eye (OutlineSphere, OutlineCylinder,
//!     OutlineCone) gets the eye of that camera.
//!   - Data files that are not in the ln repository get a replacement:
//!     earth (Natural Earth 50m coastline, public domain), mountain (a
//!     generated height field), slices and voxelize (suzanne.obj from the
//!     ln repository, not bowser.stl).
//!
//! The text between the "// <scene>" and "// </scene>" lines of each file
//! is the code extract that the page and the screensaver plate show.
//!
//! GREP MAP
//!   grep -n 'pub static EXAMPLES'   the table: key, title, camera, params
//!   grep -n 'pub struct ParamSpec'  one slider or one option set
//!   grep -n 'pub struct Built'      what a builder returns

use crate::path::Paths;
use crate::scene::Scene;
use crate::vector::{v3, Vector};

pub mod beads;
pub mod cones;
pub mod csg;
pub mod earth;
pub mod example0;
pub mod example1;
pub mod function;
pub mod graph;
pub mod mountain;
pub mod outline;
pub mod skyscrapers;
pub mod slicer;
pub mod slices;
pub mod suzanne;
pub mod test;
pub mod textures;
pub mod voxelize;

#[cfg(test)]
mod tests;

/// One parameter. With `options` empty it is a number slider; with
/// options it is a choice and the value is the option index.
pub struct ParamSpec {
    pub key: &'static str,
    pub label: &'static str,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub value: f64,
    pub options: &'static [&'static str],
}

pub const fn num(key: &'static str, label: &'static str, min: f64, max: f64, step: f64, value: f64) -> ParamSpec {
    ParamSpec { key, label, min, max, step, value, options: &[] }
}

pub const fn choice(key: &'static str, label: &'static str, value: f64, options: &'static [&'static str]) -> ParamSpec {
    ParamSpec { key, label, min: 0.0, max: (options.len() - 1) as f64, step: 1.0, value, options }
}

#[derive(Clone, Copy, Debug)]
pub struct Camera {
    pub eye: Vector,
    pub center: Vector,
    pub up: Vector,
    pub fovy: f64,
    pub near: f64,
    pub far: f64,
}

/// The parameter values of one build, in the order of the spec list.
pub struct Params<'a> {
    pub specs: &'a [ParamSpec],
    pub values: Vec<f64>,
}

impl<'a> Params<'a> {
    pub fn defaults(specs: &'a [ParamSpec]) -> Params<'a> {
        Params { specs, values: specs.iter().map(|s| s.value).collect() }
    }
    /// Values out of range are clamped; missing values take the default.
    pub fn from_values(specs: &'a [ParamSpec], values: &[f64]) -> Params<'a> {
        let v = specs
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let x = values.get(i).copied().filter(|x| x.is_finite()).unwrap_or(s.value);
                x.max(s.min).min(s.max)
            })
            .collect();
        Params { specs, values: v }
    }
    pub fn get(&self, key: &str) -> f64 {
        for (i, s) in self.specs.iter().enumerate() {
            if s.key == key {
                return self.values[i];
            }
        }
        panic!("no parameter {}", key)
    }
    pub fn int(&self, key: &str) -> i64 {
        self.get(key).round() as i64
    }
    pub fn seed(&self) -> u64 {
        self.int("seed").max(0) as u64
    }
}

/// What a builder returns. `overlay` is flat art that is not part of the
/// 3D scene (the halo rings of the earth example, the slicer sheets). Its
/// units: y from -1 to 1 over the image height, x scaled the same, so a
/// circle stays round at any aspect. The overlay is not hidden by shapes.
pub struct Built {
    pub scene: Scene,
    pub overlay: Paths,
}

impl Built {
    pub fn scene(scene: Scene) -> Built {
        Built { scene, overlay: Vec::new() }
    }
}

pub struct Example {
    pub key: &'static str,
    pub title: &'static str,
    /// The ln source file, or "" for a scene that is not an ln example.
    pub source: &'static str,
    pub blurb: &'static str,
    /// The image size of the Go example (the page keeps its aspect).
    pub width: f64,
    pub height: f64,
    /// The chop step of the visibility test, in world units.
    pub step: f64,
    pub camera: Camera,
    pub params: &'static [ParamSpec],
    pub build: fn(&Params, &Camera) -> Built,
    /// The camera for these parameters, when a parameter moves the eye
    /// (graph `frame`). None: the camera above.
    pub camera_for: Option<fn(&Params, Camera) -> Camera>,
    /// The source of the Rust file (for the code extract).
    pub code: &'static str,
    /// 1 light, 2 medium, 3 heavy: the page uses it to plan previews.
    pub cost: u8,
}

impl Example {
    /// The camera for these parameters (see `camera_for`).
    pub fn camera_with(&self, p: &Params) -> Camera {
        match self.camera_for {
            Some(f) => f(p, self.camera),
            None => self.camera,
        }
    }
}

pub const Z_UP: Vector = v3(0.0, 0.0, 1.0);

pub const fn cam(eye: Vector, center: Vector, up: Vector, fovy: f64, near: f64, far: f64) -> Camera {
    Camera { eye, center, up, fovy, near, far }
}

pub static EXAMPLES: &[Example] = &[
    example0::EXAMPLE,
    example1::EXAMPLE,
    csg::EXAMPLE,
    skyscrapers::EXAMPLE,
    test::EXAMPLE,
    outline::EXAMPLE,
    textures::EXAMPLE,
    function::EXAMPLE,
    graph::EXAMPLE,
    beads::EXAMPLE,
    cones::EXAMPLE,
    earth::EXAMPLE,
    suzanne::EXAMPLE,
    slices::EXAMPLE,
    voxelize::EXAMPLE,
    slicer::EXAMPLE,
    mountain::EXAMPLE,
];

pub fn find(key: &str) -> Option<&'static Example> {
    EXAMPLES.iter().find(|e| e.key == key)
}

/// The lines between "// <scene>" and "// </scene>", with the common
/// indent removed.
pub fn code_extract(src: &str) -> String {
    let start = match src.find("// <scene>") {
        Some(i) => i,
        None => return String::new(),
    };
    let rest = &src[start..];
    let body_start = rest.find('\n').map(|i| i + 1).unwrap_or(rest.len());
    let end = rest.find("// </scene>").unwrap_or(rest.len());
    let body = &rest[body_start..end];
    let lines: Vec<&str> = body.lines().collect();
    let lines: Vec<&str> = {
        let mut l = lines;
        while l.last().map_or(false, |s| s.trim().is_empty()) {
            l.pop();
        }
        l
    };
    let indent = lines.iter().filter(|l| !l.trim().is_empty()).map(|l| l.len() - l.trim_start().len()).min().unwrap_or(0);
    lines.iter().map(|l| if l.len() >= indent { &l[indent..] } else { l.trim_start() }).collect::<Vec<_>>().join("\n")
}

/// The ln suzanne.obj (in the ln repository, under the ln MIT licence).
pub const SUZANNE_OBJ: &str = include_str!("../data/suzanne.obj");

/// Suzanne fitted in the -1..1 box with z up. The OBJ has y up and the
/// face toward +z. `face_y` picks the side the face turns to (+1 or -1).
pub fn suzanne_z_up(face_y: f64) -> crate::mesh::Mesh {
    use crate::bbox::BBox;
    use crate::matrix::rotate;
    use crate::shape::Shape;
    let mut mesh = crate::obj::load_obj(SUZANNE_OBJ).expect("suzanne.obj parses");
    // ln rotate(x, -90 deg): y -> z, and the face (+z) turns to -y. (The ln
    // rotate matrix turns by -a in the right-hand sense.)
    let mut m = rotate(v3(1.0, 0.0, 0.0), -std::f64::consts::FRAC_PI_2);
    if face_y > 0.0 {
        m = m.rotate(v3(0.0, 0.0, 1.0), std::f64::consts::PI);
    }
    mesh.transform(&m);
    mesh.fit_inside(BBox::new(v3(-1.0, -1.0, -1.0), v3(1.0, 1.0, 1.0)), v3(0.5, 0.5, 0.5));
    let _ = mesh.bounding_box();
    mesh
}
